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
        public int reconnectAttempts;
        public boolean isManualDisconnect;
        
        public DeviceConnectionState(String deviceId) {
            this.deviceId = deviceId;
            this.state = ConnectionState.DISCONNECTED;
            this.lastConnectionTime = 0;
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
        
        setupBackgroundScan();
    }
    
    private void setupBackgroundScan() {
        Log.d(TAG, "🔧 Setting up background scan with PendingIntent");
        
        // Create intent for background scan results
        scanIntent = new Intent(context, BLEBackgroundReceiver.class);
        scanIntent.setAction("com.reactnativeboilerplate.BLE_SCAN_RESULT");
        
        // Create PendingIntent for background scanning
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? 
                   android.app.PendingIntent.FLAG_UPDATE_CURRENT | android.app.PendingIntent.FLAG_IMMUTABLE :
                   android.app.PendingIntent.FLAG_UPDATE_CURRENT;
        
        pendingIntent = android.app.PendingIntent.getBroadcast(context, 0, scanIntent, flags);
        
        Log.d(TAG, "✅ Background scan setup complete");
    }
    
    public void setForegroundService(BLEForegroundService service) {
        this.foregroundService = service;
    }
    
    public void setCompanionService(BLECompanionDeviceService service) {
        this.companionService = service;
    }
    
    public void startBackgroundScan() {
        Log.d(TAG, "🔍 Starting background scan");
        
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
    
    // Connection management methods
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        if (device == null) {
            Log.e(TAG, "Device is null for ID: " + deviceId);
            return;
        }
        
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) {
            state = new DeviceConnectionState(deviceId);
            deviceStates.put(deviceId, state);
        }
        
        if (state.state == ConnectionState.CONNECTED || state.state == ConnectionState.CONNECTING) {
            Log.w(TAG, "Device " + deviceId + " already connected or connecting");
            return;
        }
        
        state.state = ConnectionState.CONNECTING;
        state.isManualDisconnect = false;
        connectionCallbacks.put(deviceId, callback);
        
        // Notify foreground service
        if (foregroundService != null) {
            foregroundService.addMonitoredDevice(deviceId);
        }
        
        // Connect to GATT server with autoConnect=true for background reconnection
        // This is crucial for auto-reconnection when device comes back in range
        BluetoothGatt gatt = device.connectGatt(context, true, new BluetoothGattCallback() {
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
                    
                    connectedGatts.put(deviceId, gatt);
                    
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
                    
                    connectedGatts.remove(deviceId);
                    
                    // Notify foreground service
                    if (foregroundService != null) {
                        Log.d(TAG, "🔔 Notifying foreground service of device disconnection: " + deviceId);
                        foregroundService.removeConnectedDevice(deviceId);
                    } else {
                        Log.w(TAG, "⚠️ Foreground service is null - cannot show disconnection notification");
                    }
                    
                    Log.d(TAG, "Disconnected from device: " + deviceId);
                    
                    // Enhanced reconnection logic for companion devices
                    if (!deviceState.isManualDisconnect) {
                        if (companionService != null && companionService.isDeviceInRange(deviceId)) {
                            // Device is in range but disconnected - immediate reconnection
                            Log.d(TAG, "🔄 Device in range but disconnected, attempting immediate reconnection: " + deviceId);
                            scheduleReconnection(deviceId, device, 1000); // 1 second delay
                        } else if (deviceState.reconnectAttempts < 5) {
                            // Device out of range - exponential backoff with longer delays
                            Log.d(TAG, "🔄 Device out of range, scheduling reconnection with backoff: " + deviceId);
                            scheduleReconnection(deviceId, device, 0); // Use exponential backoff
                        } else {
                            Log.d(TAG, "❌ Max reconnection attempts reached for device: " + deviceId);
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
        connectedGatts.remove(deviceId);
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
    
    private void scheduleReconnection(String deviceId, BluetoothDevice device, long customDelay) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) return;
        
        state.reconnectAttempts++;
        
        long delay;
        if (customDelay > 0) {
            // Use custom delay (for immediate reconnection when device is in range)
            delay = customDelay;
        } else {
            // Use exponential backoff for out-of-range devices
            delay = Math.min(1000 * (1L << state.reconnectAttempts), 60000); // Max 60s
        }
        
        Log.d(TAG, "Scheduling reconnection for " + deviceId + " in " + delay + "ms (attempt " + state.reconnectAttempts + ")");
        
        mainHandler.postDelayed(() -> {
            if (!state.isManualDisconnect && state.state == ConnectionState.DISCONNECTED) {
                // Check if device is still in range before attempting reconnection
                if (companionService == null || companionService.isDeviceInRange(deviceId)) {
                    Log.d(TAG, "🔄 Attempting reconnection to device: " + deviceId);
                    connectToDevice(deviceId, device, connectionCallbacks.get(deviceId));
                } else {
                    Log.d(TAG, "⏸️ Device not in range, skipping reconnection: " + deviceId);
                }
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
        if (state == null) return;
        
        if (inRange && state.state == ConnectionState.DISCONNECTED && !state.isManualDisconnect) {
            // Device came back in range and we're not manually disconnected
            Log.d(TAG, "🔄 Device came back in range, attempting reconnection: " + deviceId);
            
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
                connectToDevice(deviceId, device, connectionCallbacks.get(deviceId));
            } else {
                Log.w(TAG, "⚠️ Device not found in bonded devices: " + deviceId);
            }
        }
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
