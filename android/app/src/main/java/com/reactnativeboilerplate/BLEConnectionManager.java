package com.reactnativeboilerplate;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGatt;
import android.bluetooth.BluetoothGattCallback;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothProfile;
import android.bluetooth.le.BluetoothLeScanner;
import android.bluetooth.le.ScanCallback;
import android.bluetooth.le.ScanFilter;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanSettings;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.util.Log;
import androidx.core.app.ActivityCompat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Singleton ConnectionManager to handle BLE operations outside of Activities/Fragments
 * Following the Punch Through guide recommendations for reliable BLE connections
 */
public class BLEConnectionManager {
    private static final String TAG = "BLEConnectionManager";
    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    private static BLEConnectionManager instance;
    private static final Object lock = new Object();
    
    // Context and BLE components
    private Context context;
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    private BLEForegroundService foregroundService;
    private BLECompanionDeviceService companionService;
    
    // Background scan with PendingIntent (Android 12+)
    private android.app.PendingIntent pendingIntent;
    private Intent scanIntent;
    
    // Connection management
    private Map<String, BluetoothGatt> connectedGatts = new ConcurrentHashMap<>();
    private final Object gattLock = new Object(); // ✅ FIX #2: Synchronization lock for connectedGatts
    private Map<String, DeviceConnectionState> deviceStates = new ConcurrentHashMap<>();
    private Map<String, List<BLEOperation>> operationQueues = new ConcurrentHashMap<>();
    private Map<String, AtomicReference<BLEOperation>> pendingOperations = new ConcurrentHashMap<>();
    
    // Operation queue management
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    private AtomicBoolean isProcessingQueue = new AtomicBoolean(false);
    
    // Callbacks
    private Map<String, BLEConnectionCallback> connectionCallbacks = new ConcurrentHashMap<>();
    private Map<String, BLEDataCallback> dataCallbacks = new ConcurrentHashMap<>();
    
    // Connection state enum
    public enum ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED,
        DISCONNECTING,
        FAILED
    }
    
    // Device connection state
    public static class DeviceConnectionState {
        public String deviceId;
        public ConnectionState state;
        public BluetoothGatt gatt;
        public long lastConnectionTime;
        public long lastConnectionAttemptTime; // When we started CONNECTING state
        public int reconnectAttempts;
        public boolean isManualDisconnect;
        
        public DeviceConnectionState(String deviceId) {
            this.deviceId = deviceId;
            this.state = ConnectionState.DISCONNECTED;
            this.lastConnectionTime = 0;
            this.lastConnectionAttemptTime = 0;
            this.reconnectAttempts = 0;
            this.isManualDisconnect = false;
        }
    }
    
    // BLE Operation interface
    public interface BLEOperation {
        void execute(BluetoothGatt gatt);
        String getOperationName();
        boolean isComplete();
        void setComplete(boolean complete);
    }
    
    // Callback interfaces
    public interface BLEConnectionCallback {
        void onConnectionStateChanged(String deviceId, ConnectionState state);
        void onServicesDiscovered(String deviceId, List<BluetoothGattService> services);
        void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status);
        void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status);
        void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic);
    }
    
    public interface BLEDataCallback {
        void onDataReceived(String deviceId, byte[] data);
        void onError(String deviceId, String error);
    }
    
    public BLEConnectionManager(Context context) {
        this.context = context.getApplicationContext();
        initializeBLE();
    }
    
    public static BLEConnectionManager getInstance(Context context) {
        if (instance == null) {
            synchronized (lock) {
                if (instance == null) {
                    instance = new BLEConnectionManager(context);
                }
            }
        }
        return instance;
    }
    
    private void initializeBLE() {
        bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            bluetoothAdapter = bluetoothManager.getAdapter();
            bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();
        }
        
        if (bluetoothAdapter == null) {
            Log.e(TAG, "Bluetooth adapter not available");
        }
        
        // ✅ REMOVED: Background scan setup - BLEBackgroundReceiver removed
        // setupBackgroundScan();
    }
    
    // ✅ REMOVED: setupBackgroundScan() - BLEBackgroundReceiver removed
    // Background scanning now handled by foreground service only
    // private void setupBackgroundScan() {
    //     Log.d(TAG, "🔧 Setting up background scan with PendingIntent");
    //     
    //     // Create intent for background scan results
    //     scanIntent = new Intent(context, BLEBackgroundReceiver.class);
    //     scanIntent.setAction("com.reactnativeboilerplate.BLE_SCAN_RESULT");
    //     // Explicitly scope to our package to satisfy ContextMap lookups
    //     scanIntent.setPackage(context.getPackageName());
    //     
    //     // Create PendingIntent for background scanning
    //     int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? 
    //                android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE :
    //                android.app.PendingIntent.FLAG_UPDATE_CURRENT;
    //     
    //     pendingIntent = android.app.PendingIntent.getBroadcast(context, 0, scanIntent, flags);
    //     
    //     Log.d(TAG, "✅ Background scan setup complete");
    // }
    
    public void setForegroundService(BLEForegroundService service) {
        this.foregroundService = service;
    }
    
    public void setCompanionService(BLECompanionDeviceService service) {
        this.companionService = service;
    }
    
    public void startBackgroundScan() {
        Log.d(TAG, "🔍 Starting background scan");
        
        if (bluetoothAdapter == null) {
            Log.e(TAG, "❌ BluetoothAdapter not available - cannot start background scan");
            return;
        }

        // Avoid starting a background scan while we already have an active or pending connection.
        if (hasActiveOrConnectingGatt()) {
            Log.d(TAG, "⏸️ Skipping background scan - connection in progress/active");
            return;
        }
        
        // Skip background scan if we have no bonded devices to target
        Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
        if (bondedDevices == null || bondedDevices.isEmpty()) {
            Log.d(TAG, "⏸️ Skipping background scan - no bonded devices available");
            return;
        }
        
        if (!hasBluetoothPermissions()) {
            Log.e(TAG, "❌ Missing Bluetooth permissions for background scan");
            return;
        }
        
        if (bluetoothLeScanner == null) {
            Log.e(TAG, "❌ BluetoothLeScanner not available");
            return;
        }
        
        try {
            // Create scan filter for Smart Tag devices
            List<ScanFilter> filters = new ArrayList<>();
            ScanFilter filter = new ScanFilter.Builder()
                    .setServiceUuid(ParcelUuid.fromString(SMART_TAG_SERVICE_UUID))
                    .build();
            filters.add(filter);
            
            // Configure scan settings for background
            ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                    .setReportDelay(0);
            
            // Use background scan settings for Android 8.0+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                settingsBuilder.setLegacy(false);
            }
            
            ScanSettings settings = settingsBuilder.build();
            
            // Start scan with PendingIntent (works in background)
            bluetoothLeScanner.startScan(filters, settings, pendingIntent);
            
            Log.d(TAG, "✅ Background scan started successfully");
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start background scan", e);
        }
    }

    private boolean hasActiveOrConnectingGatt() {
        for (DeviceConnectionState state : deviceStates.values()) {
            if (state.state == ConnectionState.CONNECTED || state.state == ConnectionState.CONNECTING) {
                return true;
            }
        }
        return false;
    }
    
    public void stopBackgroundScan() {
        Log.d(TAG, "🛑 Stopping background scan");
        
        if (bluetoothLeScanner != null) {
            try {
                bluetoothLeScanner.stopScan(pendingIntent);
                Log.d(TAG, "✅ Background scan stopped successfully");
            } catch (Exception e) {
                Log.e(TAG, "❌ Failed to stop background scan", e);
            }
        }
    }
    
    public void connectToBondedDevices() {
        Log.d(TAG, "🔗 Auto-connecting to bonded devices");
        
        if (!hasBluetoothPermissions()) {
            Log.e(TAG, "❌ Missing Bluetooth permissions");
            return;
        }
        
        Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
        Log.d(TAG, "📋 Found " + bondedDevices.size() + " bonded devices");
        
        for (BluetoothDevice device : bondedDevices) {
            if (isSmartTagDevice(device)) {
                String deviceId = device.getAddress();
                
                // Check if already connected
                if (isDeviceConnected(deviceId)) {
                    Log.d(TAG, "✅ Device already connected: " + deviceId);
                    continue;
                }
                
                // Check if already connecting
                DeviceConnectionState state = deviceStates.get(deviceId);
                if (state != null && state.state == ConnectionState.CONNECTING) {
                    Log.d(TAG, "⏳ Device already connecting: " + deviceId);
                    continue;
                }
                
                Log.d(TAG, "🔗 Auto-connecting to bonded Smart Tag: " + deviceId);
                connectToDevice(deviceId, device, new BLEConnectionCallback() {
                    @Override
                    public void onConnectionStateChanged(String deviceId, ConnectionState state) {
                        Log.d(TAG, "🔗 Auto-connect state changed: " + deviceId + " = " + state);
                    }
                    
                    @Override
                    public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                        Log.d(TAG, "✅ Auto-connect services discovered: " + deviceId);
                    }
                    
                    @Override
                    public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        // Handle characteristic reads
                    }
                    
                    @Override
                    public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        // Handle characteristic writes
                    }
                    
                    @Override
                    public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                        Log.d(TAG, "📡 Auto-connect characteristic changed: " + deviceId);
                    }
                });
            }
        }
    }
    
    public boolean isDeviceConnected(String deviceId) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        return state != null && state.state == ConnectionState.CONNECTED;
    }
    
    // ✅ Get GATT connection for a device
    public BluetoothGatt getGatt(String deviceId) {
        synchronized(gattLock) {
            return connectedGatts.get(deviceId);
        }
    }
    
    // ✅ FIX #1: Single source of truth - Public accessors for connected devices
    /**
     * Get the count of connected devices (for health checks)
     */
    public int getConnectedDeviceCount() {
        synchronized(gattLock) {
            return connectedGatts.size();
        }
    }
    
    /**
     * Get all connected device IDs
     */
    public Set<String> getConnectedDeviceIds() {
        synchronized(gattLock) {
            return new HashSet<>(connectedGatts.keySet());
        }
    }
    
    /**
     * Check if device is in connected map (for idempotency checks)
     */
    public boolean isDeviceInConnectedMap(String deviceId) {
        synchronized(gattLock) {
            return connectedGatts.containsKey(deviceId);
        }
    }
    
    private boolean isSmartTagDevice(BluetoothDevice device) {
        // Check if device has Smart Tag service UUID in its advertised services
        // This is a simplified check - in practice, you'd need to scan for the device first
        return true; // For now, assume all bonded devices are Smart Tags
    }
    
    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED &&
                   ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
        } else {
            return ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED &&
                   ActivityCompat.checkSelfPermission(context, android.Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED;
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════════
    // INDUSTRY-STANDARD BLE CONNECTION STRATEGY (Nordic/Punch Through Best Practices)
    // ════════════════════════════════════════════════════════════════════════════════
    // 
    // 1. DIRECT CONNECT (autoConnect=false):
    //    - Use for user-initiated connections or when device is KNOWN to be in range
    //    - Fast connection (high-duty scan: 30ms window every 60ms)
    //    - Times out after ~30 seconds if device not found
    //    - Best for: Initial connection, reconnection when device detected via scan
    //
    // 2. BACKGROUND CONNECT (autoConnect=true):
    //    - Use for link-loss recovery when device may be out of range
    //    - Slow but power-efficient (low-duty scan: 48ms window every 1280ms)
    //    - Never times out - waits indefinitely for device
    //    - Best for: Automatic recovery after unexpected disconnection
    //
    // Strategy: 
    //    - When device detected in range → Direct connect (fast)
    //    - After link loss, device out of range → Background connect (patient)
    // ════════════════════════════════════════════════════════════════════════════════
    
    // Connection timeout for CONNECTING state (industry standard: 30 seconds)
    private static final long CONNECTION_TIMEOUT_MS = 30000;
    
    /**
     * Connect to device with automatic strategy selection.
     * Uses direct connect (autoConnect=false) by default for faster connection.
     */
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        connectToDevice(deviceId, device, callback, false); // Default: direct connect
    }
    
    /**
     * Connect to device with explicit autoConnect parameter.
     * 
     * @param deviceId Device MAC address
     * @param device BluetoothDevice instance
     * @param callback Connection callback
     * @param useAutoConnect true = background connect (slow, patient), false = direct connect (fast)
     */
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback, boolean useAutoConnect) {
        if (device == null) {
            Log.e(TAG, "Device is null for ID: " + deviceId);
            return;
        }
        
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) {
            state = new DeviceConnectionState(deviceId);
            deviceStates.put(deviceId, state);
        }
        
        // Check if already connected
        boolean isInConnectedMap = isDeviceInConnectedMap(deviceId);
        if (isInConnectedMap || state.state == ConnectionState.CONNECTED) {
            Log.w(TAG, "Device " + deviceId + " already connected - skipping duplicate connection");
            return;
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // INDUSTRY STANDARD: Handle stale CONNECTING state
        // If a previous connection attempt is stuck, clean it up before retrying
        // ════════════════════════════════════════════════════════════════════════════
        if (state.state == ConnectionState.CONNECTING) {
            long timeSinceConnecting = System.currentTimeMillis() - state.lastConnectionAttemptTime;
            
            if (timeSinceConnecting > CONNECTION_TIMEOUT_MS) {
                // Connection attempt timed out - clean up and retry
                Log.d(TAG, "🔄 [INDUSTRY] Connection attempt timed out after " + (timeSinceConnecting / 1000) + "s, cleaning up: " + deviceId);
                cleanupStaleConnection(deviceId, state);
            } else {
                // Connection still in progress within timeout window
                Log.w(TAG, "Device " + deviceId + " connection in progress (" + (timeSinceConnecting / 1000) + "s), waiting...");
                return;
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // INDUSTRY STANDARD: Always clean up previous GATT before new connection
        // This prevents resource leaks and error 133 (GATT_ERROR)
        // ════════════════════════════════════════════════════════════════════════════
        if (state.gatt != null) {
            Log.d(TAG, "🧹 [INDUSTRY] Cleaning up previous GATT before new connection: " + deviceId);
            cleanupStaleConnection(deviceId, state);
        }
        
        // Update state
        state.state = ConnectionState.CONNECTING;
        state.lastConnectionAttemptTime = System.currentTimeMillis();
        state.isManualDisconnect = false;
        connectionCallbacks.put(deviceId, callback);
        
        // Notify foreground service
        if (foregroundService != null) {
            foregroundService.addMonitoredDevice(deviceId);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // INDUSTRY STANDARD: Choose connection strategy based on context
        // - Direct connect (autoConnect=false): Fast, use when device is in range
        // - Background connect (autoConnect=true): Slow but patient, use for link loss
        // ════════════════════════════════════════════════════════════════════════════
        Log.d(TAG, "🔗 [INDUSTRY] Connecting to " + deviceId + " with autoConnect=" + useAutoConnect + 
              (useAutoConnect ? " (background/patient)" : " (direct/fast)"));
        
        BluetoothGatt gatt = device.connectGatt(context, useAutoConnect, new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                String deviceId = gatt.getDevice().getAddress();
                DeviceConnectionState deviceState = deviceStates.get(deviceId);
                
                if (deviceState == null) {
                    Log.e(TAG, "No device state found for: " + deviceId);
                    return;
                }
                
                if (newState == BluetoothProfile.STATE_CONNECTED) {
                    deviceState.state = ConnectionState.CONNECTED;
                    deviceState.gatt = gatt;
                    deviceState.lastConnectionTime = System.currentTimeMillis();
                    deviceState.reconnectAttempts = 0;
                    
                    // ✅ FIX #2 & #4: Synchronized write with duplicate guard
                    synchronized(gattLock) {
                        if (!connectedGatts.containsKey(deviceId)) {
                            connectedGatts.put(deviceId, gatt);
                            Log.d(TAG, "✅ Added device to connected devices map: " + deviceId);
                        } else {
                            Log.w(TAG, "⚠️ Device already in connected map, skipping duplicate add: " + deviceId);
                        }
                    }
                    
                    // Notify foreground service
                    if (foregroundService != null) {
                        Log.d(TAG, "🔔 Notifying foreground service of device connection: " + deviceId);
                        foregroundService.addConnectedDevice(deviceId);
                    } else {
                        Log.w(TAG, "⚠️ Foreground service is null - cannot show connection notification");
                    }
                    
                    // Start service discovery
                    gatt.discoverServices();
                    
                    Log.d(TAG, "Connected to device: " + deviceId);
                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    deviceState.state = ConnectionState.DISCONNECTED;
                    deviceState.gatt = null;
                    
                    // ✅ FIX #2: Synchronized removal
                    synchronized(gattLock) {
                        connectedGatts.remove(deviceId);
                        Log.d(TAG, "✅ Removed device from connected devices map: " + deviceId);
                    }
                    
                    // Notify foreground service
                    if (foregroundService != null) {
                        Log.d(TAG, "🔔 Notifying foreground service of device disconnection: " + deviceId);
                        foregroundService.removeConnectedDevice(deviceId);
                    } else {
                        Log.w(TAG, "⚠️ Foreground service is null - cannot show disconnection notification");
                    }
                    
                    Log.d(TAG, "Disconnected from device: " + deviceId);
                    
                    // ════════════════════════════════════════════════════════════════════════
                    // INDUSTRY STANDARD: Link Loss Recovery
                    // 1. Notify companion service of disconnection
                    // 2. Let companion service handle aggressive scanning and detection
                    // 3. When device detected, use DIRECT CONNECT (fast)
                    // 4. If device not found after scan, use BACKGROUND CONNECT (patient)
                    // ════════════════════════════════════════════════════════════════════════
                    if (!deviceState.isManualDisconnect) {
                        // Notify companion service of disconnection - it will handle scanning
                        if (companionService != null) {
                            Log.d(TAG, "🔍 [INDUSTRY] Link loss detected, notifying companion service: " + deviceId);
                            companionService.onDeviceDisconnected(deviceId);
                        }
                        
                        // ════════════════════════════════════════════════════════════════════
                        // INDUSTRY STANDARD: Immediate check - is device still in range?
                        // If yes: Direct connect (fast)
                        // If no: Background connect (patient, let OS handle)
                        // ════════════════════════════════════════════════════════════════════
                        if (companionService != null && companionService.isDeviceInRange(deviceId)) {
                            Log.d(TAG, "🚀 [INDUSTRY] Device still in range after link loss, using DIRECT CONNECT");
                            scheduleReconnection(deviceId, device, 500); // Short delay for stack to stabilize
                        } else {
                            // ════════════════════════════════════════════════════════════════
                            // INDUSTRY STANDARD: Device not in range - use BACKGROUND CONNECT
                            // Let the companion service scan and detect device, then trigger
                            // direct connect via onDevicePresenceChanged when device appears
                            // ════════════════════════════════════════════════════════════════
                            Log.d(TAG, "⏳ [INDUSTRY] Device out of range, companion service will scan and detect");
                            // Don't call background connect here - let companion service scan first
                            // When device is detected, onDevicePresenceChanged will use direct connect
                        }
                    }
                }
                
                // Notify callback
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onConnectionStateChanged(deviceId, deviceState.state);
                }
            }
            
            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    List<BluetoothGattService> services = gatt.getServices();
                    Log.d(TAG, "Services discovered for " + deviceId + ": " + services.size() + " services");
                    
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onServicesDiscovered(deviceId, services);
                    }
                } else {
                    Log.e(TAG, "Service discovery failed for " + deviceId + " with status: " + status);
                }
            }
            
            @Override
            public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onCharacteristicRead(deviceId, characteristic, status);
                }
            }
            
            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onCharacteristicWrite(deviceId, characteristic, status);
                }
            }
            
            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                String deviceId = gatt.getDevice().getAddress();
                
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onCharacteristicChanged(deviceId, characteristic);
                }
                
                // Notify data callback
                BLEDataCallback dataCallback = dataCallbacks.get(deviceId);
                if (dataCallback != null) {
                    dataCallback.onDataReceived(deviceId, characteristic.getValue());
                }
            }
        });
        
        state.gatt = gatt;
    }
    
    public void disconnectDevice(String deviceId) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null || state.gatt == null) {
            Log.w(TAG, "No active connection for device: " + deviceId);
            return;
        }
        
        state.isManualDisconnect = true;
        state.state = ConnectionState.DISCONNECTING;
        
        BluetoothGatt gatt = state.gatt;
        gatt.disconnect();
        gatt.close();
        
        // Clean up
        // ✅ FIX #2: Synchronized removal
        synchronized(gattLock) {
            connectedGatts.remove(deviceId);
        }
        connectionCallbacks.remove(deviceId);
        dataCallbacks.remove(deviceId);
        operationQueues.remove(deviceId);
        pendingOperations.remove(deviceId);
        
        // Notify foreground service
        if (foregroundService != null) {
            foregroundService.removeConnectedDevice(deviceId);
            foregroundService.removeMonitoredDevice(deviceId);
        }
        
        Log.d(TAG, "Manually disconnected device: " + deviceId);
    }
    
    /**
     * INDUSTRY STANDARD: Clean up stale GATT connection
     * This prevents resource leaks and error 133 (GATT_ERROR)
     * Must be called before attempting a new connection to the same device
     */
    private void cleanupStaleConnection(String deviceId, DeviceConnectionState state) {
        Log.d(TAG, "🧹 [INDUSTRY] Cleaning up stale connection for: " + deviceId);
        
        // Close any existing GATT
        if (state.gatt != null) {
            try {
                // Industry best practice: disconnect then close
                state.gatt.disconnect();
                state.gatt.close();
                Log.d(TAG, "   ✅ Closed stale GATT object");
            } catch (Exception e) {
                Log.w(TAG, "   ⚠️ Error closing stale GATT: " + e.getMessage());
            }
            state.gatt = null;
        }
        
        // Remove from connected map
        synchronized(gattLock) {
            if (connectedGatts.containsKey(deviceId)) {
                BluetoothGatt existingGatt = connectedGatts.remove(deviceId);
                if (existingGatt != null && existingGatt != state.gatt) {
                    try {
                        existingGatt.disconnect();
                        existingGatt.close();
                        Log.d(TAG, "   ✅ Closed orphaned GATT from connected map");
                    } catch (Exception e) {
                        Log.w(TAG, "   ⚠️ Error closing orphaned GATT: " + e.getMessage());
                    }
                }
            }
        }
        
        // Reset state
        state.state = ConnectionState.DISCONNECTED;
        state.lastConnectionAttemptTime = 0;
        
        // Small delay for BLE stack to stabilize (industry recommendation: 300-600ms)
        try {
            Thread.sleep(300);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
    
    /**
     * INDUSTRY STANDARD: Direct connect for when device is known to be in range.
     * Uses autoConnect=false for fast connection (~1-2 seconds vs 30+ seconds)
     */
    public void directConnectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        Log.d(TAG, "🚀 [INDUSTRY] Direct connect to device in range: " + deviceId);
        connectToDevice(deviceId, device, callback, false); // autoConnect=false for fast connection
    }
    
    /**
     * INDUSTRY STANDARD: Background connect for link-loss recovery.
     * Uses autoConnect=true to let Android manage reconnection.
     */
    public void backgroundConnectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        Log.d(TAG, "⏳ [INDUSTRY] Background connect for link-loss recovery: " + deviceId);
        connectToDevice(deviceId, device, callback, true); // autoConnect=true for patient reconnection
    }
    
    /**
     * INDUSTRY STANDARD: Schedule reconnection with proper strategy selection.
     * Uses direct connect when device is confirmed in range for faster reconnection.
     */
    private void scheduleReconnection(String deviceId, BluetoothDevice device, long customDelay) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) return;
        
        state.reconnectAttempts++;
        
        // Industry recommendation: Short delay for stack stabilization (300-600ms minimum)
        long delay = Math.max(customDelay, 300);
        
        Log.d(TAG, "⏱️ [INDUSTRY] Scheduling reconnection for " + deviceId + " in " + delay + "ms (attempt " + state.reconnectAttempts + ")");
        
        mainHandler.postDelayed(() -> {
            // Re-check state in case it changed during delay
            DeviceConnectionState currentState = deviceStates.get(deviceId);
            if (currentState == null || currentState.isManualDisconnect || currentState.state != ConnectionState.DISCONNECTED) {
                Log.d(TAG, "⏸️ Skipping reconnection - state changed: " + deviceId);
                return;
            }
            
            // ════════════════════════════════════════════════════════════════════════
            // INDUSTRY STANDARD: Scan first, then connect with appropriate strategy
            // ════════════════════════════════════════════════════════════════════════
            if (companionService != null) {
                Log.d(TAG, "🔍 [INDUSTRY] Scanning to verify device presence before reconnection: " + deviceId);
                companionService.performImmediatePresenceScan(deviceId);
                
                // Wait for scan to complete
                mainHandler.postDelayed(() -> {
                    DeviceConnectionState stateAfterScan = deviceStates.get(deviceId);
                    if (stateAfterScan == null || stateAfterScan.isManualDisconnect || stateAfterScan.state != ConnectionState.DISCONNECTED) {
                        Log.d(TAG, "⏸️ Skipping reconnection after scan - state changed: " + deviceId);
                        return;
                    }
                    
                    if (companionService.isDeviceInRange(deviceId)) {
                        // ════════════════════════════════════════════════════════════════
                        // INDUSTRY STANDARD: Device confirmed in range - DIRECT CONNECT
                        // ════════════════════════════════════════════════════════════════
                        Log.d(TAG, "🚀 [INDUSTRY] Device confirmed in range, using DIRECT CONNECT: " + deviceId);
                        BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                        if (callback == null) {
                            callback = createDefaultAutoReconnectCallback(deviceId);
                            connectionCallbacks.put(deviceId, callback);
                        }
                        directConnectToDevice(deviceId, device, callback);
                    } else {
                        // Device not in range - companion service will detect it and trigger reconnection
                        Log.d(TAG, "⏸️ [INDUSTRY] Device not in range, waiting for companion service to detect: " + deviceId);
                    }
                }, 2000); // Wait 2 seconds for scan to complete
            } else {
                // No companion service, attempt reconnection anyway
                Log.d(TAG, "🔄 Attempting reconnection to device (no companion service): " + deviceId);
                connectToDevice(deviceId, device, connectionCallbacks.get(deviceId));
            }
        }, delay);
    }
    
    private void scheduleReconnection(String deviceId, BluetoothDevice device) {
        scheduleReconnection(deviceId, device, 0);
    }
    
    // Operation queue management
    public void enqueueOperation(String deviceId, BLEOperation operation) {
        if (operation == null) return;
        
        List<BLEOperation> queue = operationQueues.computeIfAbsent(deviceId, k -> new ArrayList<>());
        queue.add(operation);
        
        processOperationQueue(deviceId);
    }
    
    private void processOperationQueue(String deviceId) {
        if (isProcessingQueue.get()) {
            return; // Another thread is processing
        }
        
        List<BLEOperation> queue = operationQueues.get(deviceId);
        if (queue == null || queue.isEmpty()) {
            return;
        }
        
        AtomicReference<BLEOperation> pendingOp = pendingOperations.get(deviceId);
        if (pendingOp != null && pendingOp.get() != null) {
            return; // Operation already in progress
        }
        
        isProcessingQueue.set(true);
        
        BLEOperation operation = queue.remove(0);
        pendingOperations.put(deviceId, new AtomicReference<>(operation));
        
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null || state.gatt == null || state.state != ConnectionState.CONNECTED) {
            Log.w(TAG, "Cannot execute operation - device not connected: " + deviceId);
            signalEndOfOperation(deviceId);
            return;
        }
        
        Log.d(TAG, "Executing operation: " + operation.getOperationName() + " for device: " + deviceId);
        operation.execute(state.gatt);
    }
    
    private void signalEndOfOperation(String deviceId) {
        AtomicReference<BLEOperation> pendingOp = pendingOperations.get(deviceId);
        if (pendingOp != null) {
            BLEOperation operation = pendingOp.get();
            if (operation != null) {
                Log.d(TAG, "End of operation: " + operation.getOperationName());
                operation.setComplete(true);
            }
            pendingOp.set(null);
        }
        
        isProcessingQueue.set(false);
        
        // Process next operation if available
        List<BLEOperation> queue = operationQueues.get(deviceId);
        if (queue != null && !queue.isEmpty()) {
            processOperationQueue(deviceId);
        }
    }
    
    // Public methods for operation completion
    public void onOperationComplete(String deviceId) {
        signalEndOfOperation(deviceId);
    }
    
    // Getters
    public Map<String, DeviceConnectionState> getDeviceStates() {
        return new ConcurrentHashMap<>(deviceStates);
    }
    
    public DeviceConnectionState getDeviceState(String deviceId) {
        return deviceStates.get(deviceId);
    }
    
    public BluetoothGatt getConnectedGatt(String deviceId) {
        return connectedGatts.get(deviceId);
    }
    
    // Device presence management
    public void onDevicePresenceChanged(String deviceId, boolean inRange) {
        Log.d(TAG, "📡 Device presence changed: " + deviceId + " in range: " + inRange);
        
        DeviceConnectionState state = deviceStates.get(deviceId);
        
        // ✅ CRITICAL FIX: Handle case where device state might not exist yet
        // This can happen if device was bonded but never connected, or if state was cleared
        if (state == null) {
            // Check if this is a bonded device that should be reconnected
            if (inRange) {
                Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
                for (BluetoothDevice bondedDevice : bondedDevices) {
                    if (bondedDevice.getAddress().equals(deviceId)) {
                        Log.d(TAG, "🔄 Device came back in range but no state exists, creating state and reconnecting: " + deviceId);
                        // Create a new state for this device (constructor requires deviceId)
                        state = new DeviceConnectionState(deviceId);
                        state.state = ConnectionState.DISCONNECTED;
                        state.isManualDisconnect = false;
                        state.reconnectAttempts = 0;
                        deviceStates.put(deviceId, state);
                        
                        // Get callback if it exists, otherwise create a default one for auto-reconnection
                        BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                        if (callback == null) {
                            Log.d(TAG, "📝 Creating default callback for auto-reconnection: " + deviceId);
                            // ✅ CRITICAL FIX: Default callback should delegate to companion service
                            // This ensures the callback chain reaches SampleBridgeAndroid
                            callback = new BLEConnectionCallback() {
                                @Override
                                public void onConnectionStateChanged(String deviceId, ConnectionState state) {
                                    Log.d(TAG, "🔗 Auto-reconnect state changed: " + deviceId + " = " + state);
                                    // ✅ Delegate to companion service which will notify SampleBridgeAndroid
                                    if (companionService != null) {
                                        Log.d(TAG, "📢 Delegating to companionService.notifyConnectionStateChanged()");
                                        companionService.notifyConnectionStateChanged(deviceId, state);
                                    } else {
                                        Log.w(TAG, "⚠️ companionService is null, cannot delegate connection state change");
                                    }
                                }
                                
                                @Override
                                public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                                    Log.d(TAG, "✅ Auto-reconnect services discovered: " + deviceId);
                                    // ✅ Delegate to companion service to trigger device info reading
                                    if (companionService != null) {
                                        Log.d(TAG, "📢 Delegating onServicesDiscovered to companionService");
                                        companionService.notifyServicesDiscovered(deviceId);
                                    } else {
                                        Log.w(TAG, "⚠️ companionService is null, cannot delegate services discovered");
                                    }
                                }
                                
                                @Override
                                public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                                    // ✅ Forward to companionService for auto-connected devices
                                    if (companionService != null) {
                                        Log.d(TAG, "📢 Delegating onCharacteristicRead to companionService for: " + deviceId);
                                        companionService.notifyCharacteristicRead(deviceId, characteristic, status);
                                    } else {
                                        Log.w(TAG, "⚠️ companionService is null, cannot delegate characteristic read");
                                    }
                                }
                                
                                @Override
                                public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                                    // Handle characteristic writes if needed
                                }
                                
                                @Override
                                public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                                    Log.d(TAG, "📡 Auto-reconnect characteristic changed: " + deviceId + " - " + characteristic.getUuid());
                                    if (companionService != null) {
                                        companionService.notifyCharacteristicChanged(deviceId, characteristic);
                                    }
                                }
                            };
                            // Store the callback for future use
                            connectionCallbacks.put(deviceId, callback);
                        }
                        // ════════════════════════════════════════════════════════════════════
                        // INDUSTRY STANDARD: Use DIRECT CONNECT when device is detected in range
                        // This is faster than autoConnect=true (1-2s vs 30+ seconds)
                        // ════════════════════════════════════════════════════════════════════
                        directConnectToDevice(deviceId, bondedDevice, callback);
                        return;
                    }
                }
            }
            return;
        }
        
        if (inRange && state.state == ConnectionState.DISCONNECTED && !state.isManualDisconnect) {
            // ════════════════════════════════════════════════════════════════════════════
            // INDUSTRY STANDARD: Device detected in range - use DIRECT CONNECT (fast)
            // autoConnect=false provides faster connection when we know device is available
            // ════════════════════════════════════════════════════════════════════════════
            Log.d(TAG, "🚀 [INDUSTRY] Device detected in range, using DIRECT CONNECT: " + deviceId);
            
            // Get the device from bonded devices
            BluetoothDevice device = null;
            Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
            for (BluetoothDevice bondedDevice : bondedDevices) {
                if (bondedDevice.getAddress().equals(deviceId)) {
                    device = bondedDevice;
                    break;
                }
            }
            
            if (device != null) {
                // Reset reconnection attempts since device is back in range
                state.reconnectAttempts = 0;
                
                // Get callback - if it doesn't exist, create a default one for auto-reconnection
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback == null) {
                    Log.d(TAG, "📝 Creating default callback for auto-reconnection: " + deviceId);
                    callback = createDefaultAutoReconnectCallback(deviceId);
                    connectionCallbacks.put(deviceId, callback);
                }
                
                // ════════════════════════════════════════════════════════════════════════
                // INDUSTRY STANDARD: DIRECT CONNECT (autoConnect=false) when device in range
                // ════════════════════════════════════════════════════════════════════════
                directConnectToDevice(deviceId, device, callback);
            } else {
                Log.w(TAG, "⚠️ Device not found in bonded devices: " + deviceId);
            }
        } else if (inRange && state.state == ConnectionState.DISCONNECTED && state.isManualDisconnect) {
            Log.d(TAG, "⏸️ Device came back in range but was manually disconnected, skipping auto-reconnect: " + deviceId);
        }
    }
    
    /**
     * Creates a default callback for auto-reconnection that delegates to companionService.
     * This ensures the callback chain reaches SampleBridgeAndroid for proper event emission.
     */
    private BLEConnectionCallback createDefaultAutoReconnectCallback(String deviceId) {
        return new BLEConnectionCallback() {
            @Override
            public void onConnectionStateChanged(String deviceId, ConnectionState state) {
                Log.d(TAG, "🔗 Auto-reconnect state changed: " + deviceId + " = " + state);
                if (companionService != null) {
                    Log.d(TAG, "📢 Delegating to companionService.notifyConnectionStateChanged()");
                    companionService.notifyConnectionStateChanged(deviceId, state);
                }
            }
            
            @Override
            public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                Log.d(TAG, "✅ Auto-reconnect services discovered: " + deviceId);
                if (companionService != null) {
                    Log.d(TAG, "📢 Delegating onServicesDiscovered to companionService");
                    companionService.notifyServicesDiscovered(deviceId);
                }
            }
            
            @Override
            public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                if (companionService != null) {
                    companionService.notifyCharacteristicRead(deviceId, characteristic, status);
                }
            }
            
            @Override
            public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                // Handle characteristic writes if needed
            }
            
            @Override
            public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                Log.d(TAG, "📡 Auto-reconnect characteristic changed: " + deviceId + " - " + characteristic.getUuid());
                if (companionService != null) {
                    companionService.notifyCharacteristicChanged(deviceId, characteristic);
                }
            }
        };
    }
    
    // Cleanup
    public void cleanup() {
        for (String deviceId : new ArrayList<>(connectedGatts.keySet())) {
            disconnectDevice(deviceId);
        }
        
        deviceStates.clear();
        operationQueues.clear();
        pendingOperations.clear();
        connectionCallbacks.clear();
        dataCallbacks.clear();
        
        if (foregroundService != null) {
            foregroundService = null;
        }
    }
}
