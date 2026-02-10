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
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
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
    private static final String CCC_DESCRIPTOR_UUID = "00002902-0000-1000-8000-00805f9b34fb";
    private static BLEConnectionManager instance;
    private static final Object lock = new Object();
    
    // Context and BLE components
    private Context context;
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    private BLEForegroundService foregroundService;
    
    // Background scan with PendingIntent (Android 12+)
    private android.app.PendingIntent pendingIntent;
    private Intent scanIntent;
    
    // Connection management
    // ✅ REFACTORED: Removed GATT storage - GATT objects stored ONLY in SampleBridgeAndroid
    // ✅ REFACTORED: Removed operation queue - SampleBridgeAndroid.GattOperationQueue handles all GATT operations
    // This class only manages connection state and reconnection strategy
    private Map<String, DeviceConnectionState> deviceStates = new ConcurrentHashMap<>();
    
    // Connection state management
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    
    // Callbacks
    private Map<String, BLEConnectionCallback> connectionCallbacks = new ConcurrentHashMap<>();
    private Map<String, BLEDataCallback> dataCallbacks = new ConcurrentHashMap<>();
    
    /** Pending disconnect timeout runnables (deviceId -> Runnable). Cancelled when disconnect callback arrives or when starting DFU. */
    private final Map<String, Runnable> disconnectTimeoutRunnables = new ConcurrentHashMap<>();
    
    // Bond state tracking
    private BroadcastReceiver bondStateReceiver;
    private boolean isBondReceiverRegistered = false;

    // Reconnection policy (kept in sync with JS RECONNECTION_CONSTANTS)
    private static final int MAX_RECONNECT_ATTEMPTS = 5;
    private static final long INITIAL_BACKOFF_MS = 1000;   // 1s
    private static final long MAX_BACKOFF_MS = 60000;      // 60s
    private static final long BACKOFF_JITTER_MS = 1000;    // 0–1s jitter
    private static final long COOLDOWN_AFTER_MAX_FAILURES_MS = 30000; // 30s cooldown
    
    // Connection state enum
    public enum ConnectionState {
        DISCONNECTED,
        CONNECTING,
        CONNECTED,
        DISCONNECTING,
        FAILED
    }
    
    // Device connection state
    // ✅ REFACTORED: Removed 'gatt' field - GATT objects stored ONLY in SampleBridgeAndroid.connectedGatts
    // This class manages connection state and strategy, not GATT objects
    public static class DeviceConnectionState {
        public String deviceId;
        public ConnectionState state;
        // ❌ REMOVED: public BluetoothGatt gatt; - moved to SampleBridgeAndroid
        public long lastConnectionTime;
        public long lastConnectionAttemptTime; // When we started CONNECTING state
        public int reconnectAttempts;
        public boolean isManualDisconnect;
        public long lastDisconnectTime;
        public long reconnectBlockedUntilMs;
        /** When true, caller (e.g. SampleBridgeAndroid) drives service discovery via GATT queue; do not call discoverServices() here. */
        public boolean discoverServicesHandledByCaller;
        
        public DeviceConnectionState(String deviceId) {
            this.deviceId = deviceId;
            this.state = ConnectionState.DISCONNECTED;
            this.lastConnectionTime = 0;
            this.lastConnectionAttemptTime = 0;
            this.reconnectAttempts = 0;
            this.isManualDisconnect = false;
            this.lastDisconnectTime = 0;
            this.reconnectBlockedUntilMs = 0;
            this.discoverServicesHandledByCaller = false;
        }
    }
    
    // ❌ REMOVED: BLEOperation interface - moved to SampleBridgeAndroid.GattOperation
    // All GATT operations now handled by SampleBridgeAndroid.GattOperationQueue
    
    // Callback interfaces
    // ✅ REFACTORED: Added BluetoothGatt parameter to callbacks
    // Callbacks now pass GATT object instead of storing it internally
    public interface BLEConnectionCallback {
        void onConnectionStateChanged(String deviceId, ConnectionState state, BluetoothGatt gatt);
        void onServicesDiscovered(String deviceId, BluetoothGatt gatt, List<BluetoothGattService> services);
        void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status);
        void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status);
        void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic);
        
        // ✅ ADDED: Additional GATT callbacks for complete operation support
        default void onDescriptorWrite(String deviceId, BluetoothGattDescriptor descriptor, int status) {
            // Default implementation: no-op (can be overridden if needed)
        }
        
        default void onMtuChanged(String deviceId, int mtu, int status) {
            // Default implementation: no-op (can be overridden if needed)
        }
        
        default void onReadRemoteRssi(String deviceId, int rssi, int status) {
            // Default implementation: no-op (can be overridden if needed)
        }
    }
    
    public interface BLEDataCallback {
        void onDataReceived(String deviceId, byte[] data);
        void onError(String deviceId, String error);
    }
    
    /**
     * Callback for manual connection approval gate.
     * Bridge requests approval; manager decides delay/cooldown/retry. When approved, bridge runs startGattConnectionInternal().
     */
    public interface ConnectionApprovalCallback {
        void onConnectApproved();
        void onConnectRejected(String reason);
    }
    
    /** Error code for GATT status 133 (industry-standard retry handling) */
    public static final int ERROR_133 = 133;
    
    /** Exponential backoff delays for status 133 retries (ms) - manager owns retry policy */
    private static final long[] STATUS_133_RETRY_DELAYS_MS = { 2000, 5000, 20000 };
    public static final int MAX_STATUS_133_RETRIES = STATUS_133_RETRY_DELAYS_MS.length;
    private final Map<String, Integer> status133RetryCounts = new ConcurrentHashMap<>();
    
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
        
        // ════════════════════════════════════════════════════════════════════════════
        // BEST PRACTICE: Register bond state receiver to handle bonding events
        // (Source: Martijn van Welie - Making Android BLE Work Part 4)
        // ════════════════════════════════════════════════════════════════════════════
        setupBondStateReceiver();
        
        // ✅ REMOVED: Background scan setup - BLEBackgroundReceiver removed
        // setupBackgroundScan();
    }
    
    /**
     * BEST PRACTICE: Setup bond state receiver to monitor bonding process
     * Required to handle bonding triggered by connection or encrypted characteristics
     */
    private void setupBondStateReceiver() {
        bondStateReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                final String action = intent.getAction();
                if (action == null) return;
                
                if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                    final BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
                    if (device == null) return;
                    
                    final String deviceId = device.getAddress();
                    final int bondState = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                    final int previousBondState = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                    
                    Log.d(TAG, "🔐 Bond state changed for " + deviceId + ": " + 
                          bondStateToString(previousBondState) + " -> " + bondStateToString(bondState));
                    
                    DeviceConnectionState deviceState = deviceStates.get(deviceId);
                    if (deviceState == null) {
                        // Not our device or not connected
                        return;
                    }
                    
                    // ✅ REFACTORED: Bond state receiver only logs bond changes
                    // Service discovery is triggered by onConnectionStateChange callback
                    // GATT operations handled by SampleBridgeAndroid, not here
                    
                    switch (bondState) {
                        case BluetoothDevice.BOND_BONDING:
                            Log.d(TAG, "⏳ Bonding started for: " + deviceId);
                            break;
                            
                        case BluetoothDevice.BOND_BONDED:
                            Log.d(TAG, "✅ Bonding succeeded for: " + deviceId);
                            // Service discovery will be handled by onConnectionStateChange callback
                            // in the connectToDevice flow
                            break;
                            
                        case BluetoothDevice.BOND_NONE:
                            // ════════════════════════════════════════════════════════════════
                            // BEST PRACTICE: Handle bond loss or bonding failure
                            // Must disconnect to prevent communication issues
                            // (Source: Martijn van Welie - Making Android BLE Work Part 4)
                            // ════════════════════════════════════════════════════════════════
                            if (previousBondState == BluetoothDevice.BOND_BONDING) {
                                Log.e(TAG, "❌ Bonding failed for: " + deviceId);
                            } else if (previousBondState == BluetoothDevice.BOND_BONDED) {
                                Log.w(TAG, "⚠️ Bond lost for: " + deviceId);
                                // Bond loss detected - caller (SampleBridgeAndroid) should handle disconnection
                            }
                            break;
                    }
                }
            }
        };
        
        try {
            IntentFilter filter = new IntentFilter(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
            context.registerReceiver(bondStateReceiver, filter);
            isBondReceiverRegistered = true;
            Log.d(TAG, "✅ Bond state receiver registered");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to register bond state receiver", e);
        }
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
            
            // ════════════════════════════════════════════════════════════════════════
            // BEST PRACTICE: Configure scan settings appropriately
            // - SCAN_MODE_LOW_POWER: Scans 0.5s, pauses 4.5s (low power consumption)
            // - CALLBACK_TYPE_ALL_MATCHES: Get callback for every advertisement
            // - MATCH_MODE_AGGRESSIVE: Find devices quickly with few advertisements
            // (Source: Martijn van Welie - Making Android BLE Work Part 1)
            // ════════════════════════════════════════════════════════════════════════
            ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                    .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                    .setNumOfMatches(ScanSettings.MATCH_NUM_ONE_ADVERTISEMENT)
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

    /**
     * Returns true if any GATT connection is active or in progress.
     */
    public boolean isConnectionInProgress() {
        return hasActiveOrConnectingGatt();
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
    
    public boolean isDeviceConnected(String deviceId) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        return state != null && state.state == ConnectionState.CONNECTED;
    }
    
    // ❌ REMOVED: getGatt() method - GATT objects no longer stored in BLEConnectionManager
    // Use SampleBridgeAndroid.connectedGatts.get(deviceId) instead
    
    // ✅ FIX #1: Single source of truth - Public accessors for connected devices
    /**
     * Get the count of connected devices (for health checks)
     */
    public int getConnectedDeviceCount() {
        int count = 0;
        for (DeviceConnectionState state : deviceStates.values()) {
            if (state.state == ConnectionState.CONNECTED) {
                count++;
            }
        }
        return count;
    }
    
    /**
     * Get all connected device IDs
     */
    public Set<String> getConnectedDeviceIds() {
        Set<String> connectedIds = new HashSet<>();
        for (Map.Entry<String, DeviceConnectionState> entry : deviceStates.entrySet()) {
            if (entry.getValue().state == ConnectionState.CONNECTED) {
                connectedIds.add(entry.getKey());
            }
        }
        return connectedIds;
    }
    
    /**
     * Check if device is in connected map (for idempotency checks)
     */
    public boolean isDeviceInConnectedMap(String deviceId) {
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
    
    // Connection timeout handlers (one per device)
    private Map<String, Runnable> connectionTimeoutHandlers = new ConcurrentHashMap<>();
    
    /**
     * Connect to device with automatic strategy selection.
     * Uses direct connect (autoConnect=false) by default for faster connection.
     */
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        connectToDevice(deviceId, device, callback, false, false);
    }
    
    /**
     * Connect to device with explicit autoConnect parameter.
     */
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback, boolean useAutoConnect) {
        connectToDevice(deviceId, device, callback, useAutoConnect, false);
    }
    
    /**
     * Connect to device with queue-driven service discovery (caller drives discovery via GATT queue).
     * Use this for manual connection flow.
     */
    public void connectToDeviceWithQueueDrivenDiscovery(String deviceId, BluetoothDevice device, BLEConnectionCallback callback) {
        connectToDevice(deviceId, device, callback, false, true);
    }
    
    /**
     * Connect to device with explicit autoConnect and discoverServicesHandledByCaller.
     * When discoverServicesHandledByCaller is true, do not call discoverServices() on CONNECTED;
     * caller (SampleBridgeAndroid) will run it via GATT queue after 400ms delay.
     */
    public void connectToDevice(String deviceId, BluetoothDevice device, BLEConnectionCallback callback, boolean useAutoConnect, boolean discoverServicesHandledByCaller) {
        if (device == null) {
            Log.e(TAG, "Device is null for ID: " + deviceId);
            return;
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // BEST PRACTICE: Validate device is cached before using autoConnect=true
        // autoConnect only works for cached or bonded devices!
        // (Source: Martijn van Welie - Making Android BLE Work Part 2)
        // ════════════════════════════════════════════════════════════════════════════
        boolean isCached = isDeviceCached(device);
        boolean isBonded = isDeviceBonded(device);
        
        if (useAutoConnect && !isCached && !isBonded) {
            Log.w(TAG, "⚠️ Device not cached/bonded and using autoConnect=true!");
            Log.w(TAG, "   Device type: " + deviceTypeToString(device.getType()));
            Log.w(TAG, "   Bond state: " + bondStateToString(device.getBondState()));
            Log.w(TAG, "   Recommendation: Scan for device first to cache it, then use autoConnect");
            Log.w(TAG, "   Falling back to autoConnect=false for this connection");
            
            // Force direct connect instead
            useAutoConnect = false;
        } else {
            Log.d(TAG, "✅ Device validation: cached=" + isCached + ", bonded=" + isBonded + 
                  ", using autoConnect=" + useAutoConnect);
        }
        
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) {
            state = new DeviceConnectionState(deviceId);
            deviceStates.put(deviceId, state);
        }
        state.discoverServicesHandledByCaller = discoverServicesHandledByCaller;
        
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
        
        // ✅ REFACTORED: No longer check for stale GATT here - handled by SampleBridgeAndroid
        // Connection state is tracked, but GATT lifecycle managed by caller
        
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
        // BEST PRACTICE: Start connection timeout handler
        // Sometimes connectGatt hangs and no callback is received
        // (Source: Martijn van Welie - Making Android BLE Work Part 2)
        // ════════════════════════════════════════════════════════════════════════════
        Runnable timeoutHandler = () -> {
            DeviceConnectionState currentState = deviceStates.get(deviceId);
            if (currentState != null && currentState.state == ConnectionState.CONNECTING) {
                Log.e(TAG, "⏱️ Connection timeout - no callback received for: " + deviceId);
                
                // ✅ REFACTORED: GATT cleanup handled by SampleBridgeAndroid
                // Only update connection state here
                currentState.state = ConnectionState.DISCONNECTED;
                
                // Notify callback of failure (with null GATT since connection timed out)
                BLEConnectionCallback cb = connectionCallbacks.get(deviceId);
                if (cb != null) {
                    cb.onConnectionStateChanged(deviceId, ConnectionState.FAILED, null);
                }
                // Reconnection handled by SampleBridgeAndroid restore/auto-connect loop when enabled
            }
            
            connectionTimeoutHandlers.remove(deviceId);
        };
        
        connectionTimeoutHandlers.put(deviceId, timeoutHandler);
        mainHandler.postDelayed(timeoutHandler, CONNECTION_TIMEOUT_MS + 5000); // 35 seconds total
        
        // ════════════════════════════════════════════════════════════════════════════
        // INDUSTRY STANDARD: Choose connection strategy based on context
        // - Direct connect (autoConnect=false): Fast, use when device is in range
        // - Background connect (autoConnect=true): Slow but patient, use for link loss
        // ════════════════════════════════════════════════════════════════════════════
        // ════════════════════════════════════════════════════════════════════════════
        // BEST PRACTICE: Always use TRANSPORT_LE to avoid unpredictable behavior
        // Using TRANSPORT_AUTO can lead to unpredictable results on dual-mode devices
        // (Source: Martijn van Welie - Making Android BLE Work Part 2)
        // ════════════════════════════════════════════════════════════════════════════
        Log.d(TAG, "🔗 [INDUSTRY] Connecting to " + deviceId + " with autoConnect=" + useAutoConnect + 
              (useAutoConnect ? " (background/patient)" : " (direct/fast)"));
        Log.d(TAG, "🔗 connectGatt(device=" + deviceId + ", autoConnect=" + useAutoConnect + ") <- actual value passed to Android");
        
        BluetoothGatt gatt = device.connectGatt(
            context, 
            useAutoConnect, 
            new BluetoothGattCallback() {
            @Override
            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                String deviceId = gatt.getDevice().getAddress();
                BluetoothDevice device = gatt.getDevice();
                DeviceConnectionState deviceState = deviceStates.get(deviceId);
                
                if (deviceState == null) {
                    Log.e(TAG, "No device state found for: " + deviceId);
                    return;
                }
                
                // ════════════════════════════════════════════════════════════════════════════
                // BEST PRACTICE: Always check status field first, not just newState
                // (Source: Martijn van Welie - Making Android BLE Work Part 2)
                // ════════════════════════════════════════════════════════════════════════════
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    // ════════════════════════════════════════════════════════════════════════
                    // SUCCESS CASE: Handle connection/disconnection
                    // ════════════════════════════════════════════════════════════════════════
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        // Cancel connection timeout
                        Runnable timeoutHandler = connectionTimeoutHandlers.remove(deviceId);
                        if (timeoutHandler != null) {
                            mainHandler.removeCallbacks(timeoutHandler);
                        }
                        
                        deviceState.state = ConnectionState.CONNECTED;
                        // ❌ REMOVED: deviceState.gatt = gatt; - no longer store GATT here
                        deviceState.lastConnectionTime = System.currentTimeMillis();
                        deviceState.reconnectAttempts = 0;
                        
                        Log.d(TAG, "✅ Device connected successfully: " + deviceId);
                        
                        // Notify foreground service
                        if (foregroundService != null) {
                            Log.d(TAG, "🔔 Notifying foreground service of device connection: " + deviceId);
                            foregroundService.addConnectedDevice(deviceId);
                        } else {
                            Log.w(TAG, "⚠️ Foreground service is null - cannot show connection notification");
                        }
                        
                        // ════════════════════════════════════════════════════════════════════
                        // AUTO-CONNECT FIX: When caller drives discovery via GATT queue (like 1st attempt
                        // after 133 reconnect), do NOT call discoverServices() here. Let queue run
                        // requestMtu/discoverServices so BLE stack delivers callbacks consistently.
                        // ════════════════════════════════════════════════════════════════════
                        if (deviceState.discoverServicesHandledByCaller) {
                            Log.d(TAG, "🔍 [GATT] Service discovery handled by caller (queue-driven), skipping direct discoverServices: " + deviceId);
                        } else {
                            // BEST PRACTICE: Check bond state before service discovery
                            int bondState = device.getBondState();
                            Log.d(TAG, "📱 Bond state: " + bondStateToString(bondState));
                            
                            if (bondState == BluetoothDevice.BOND_NONE || bondState == BluetoothDevice.BOND_BONDED) {
                                // Safe to proceed with service discovery
                                int delayWhenBonded = 0;
                                if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.N) {
                                    delayWhenBonded = 1000; // 1 second delay for Android 7 and lower
                                }
                                final int delay = bondState == BluetoothDevice.BOND_BONDED ? delayWhenBonded : 0;
                                
                                if (gatt.getServices().isEmpty()) {
                                    mainHandler.postDelayed(() -> {
                                        Log.d(TAG, "🔍 [GATT] Starting service discovery for: " + deviceId +
                                              (delay > 0 ? " (delayed " + delay + "ms for bonded device)" : ""));
                                        boolean result = gatt.discoverServices();
                                        if (!result) {
                                            Log.e(TAG, "❌ discoverServices failed to start");
                                        }
                                    }, delay);
                                } else {
                                    Log.d(TAG, "✅ [GATT] Services already cached, notifying callback directly: " + deviceId);
                                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                                    if (callback != null) {
                                        callback.onServicesDiscovered(deviceId, gatt, gatt.getServices());
                                    }
                                }
                            } else if (bondState == BluetoothDevice.BOND_BONDING) {
                                Log.i(TAG, "⏳ Bonding in progress, waiting for completion before service discovery: " + deviceId);
                            }
                        }
                        
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        // Cancel disconnect timeout so we don't close again in the timeout runnable
                        cancelDisconnectTimeout(deviceId);
                        // ════════════════════════════════════════════════════════════════════
                        // BEST PRACTICE: Successful disconnect - always call close()
                        // (Source: Martijn van Welie - Making Android BLE Work Part 2)
                        // ════════════════════════════════════════════════════════════════════
                        Log.d(TAG, "✅ Device disconnected successfully (status=GATT_SUCCESS): " + deviceId);
                        
                        deviceState.state = ConnectionState.DISCONNECTED;
                        
                        // Notify foreground service
                        if (foregroundService != null) {
                            Log.d(TAG, "🔔 Notifying foreground service of device disconnection: " + deviceId);
                            foregroundService.removeConnectedDevice(deviceId);
                        }
                        
                        // Close GATT to free resources
                        try {
                            gatt.close();
                            Log.d(TAG, "🧹 GATT closed for: " + deviceId);
                        } catch (Exception e) {
                            Log.w(TAG, "⚠️ Error closing GATT: " + e.getMessage());
                        }
                        
                        // ❌ REMOVED: deviceState.gatt = null; - no longer store GATT here
                        
                        // Clean up if manual disconnect
                        if (deviceState.isManualDisconnect) {
                            Log.d(TAG, "🧹 Manual disconnect - cleaning up callbacks: " + deviceId);
                            connectionCallbacks.remove(deviceId);
                            dataCallbacks.remove(deviceId);
                            
                            if (foregroundService != null) {
                                foregroundService.removeMonitoredDevice(deviceId);
                            }
                        }
                        
                        // Handle reconnection if not manual disconnect
                        if (!deviceState.isManualDisconnect) {
                            long now = System.currentTimeMillis();
                            deviceState.lastDisconnectTime = now;

                            // Check cooldown window
                            if (deviceState.reconnectBlockedUntilMs > now) {
                                long remainingMs = deviceState.reconnectBlockedUntilMs - now;
                                Log.w(TAG, "🚫 [RECONNECT_COOLDOWN] Skipping reconnect for "
                                        + deviceId + " (" + remainingMs + "ms remaining)");
                                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                                if (callback != null) {
                                    callback.onConnectionStateChanged(deviceId, deviceState.state, null);
                                }
                                return;
                            }
                        }
                        
                    } else if (newState == BluetoothProfile.STATE_CONNECTING) {
                        Log.d(TAG, "⏳ Device connecting: " + deviceId);
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTING) {
                        Log.d(TAG, "⏳ Device disconnecting: " + deviceId);
                    }
                    
                } else {
                    // Cancel connection timeout
                    Runnable timeoutHandler = connectionTimeoutHandlers.remove(deviceId);
                    if (timeoutHandler != null) {
                        mainHandler.removeCallbacks(timeoutHandler);
                    }
                    
                    // ════════════════════════════════════════════════════════════════════════
                    // ERROR CASE: Handle connection/disconnection errors
                    // (Source: Martijn van Welie - Making Android BLE Work Part 2)
                    // ════════════════════════════════════════════════════════════════════════
                    Log.e(TAG, "❌ Connection state change error for " + deviceId + 
                          " - status: " + status + " (" + statusToString(status) + 
                          "), newState: " + connectionStateToString(newState));
                    
                    // Handle specific error cases
                    if (status == 133) { // GATT_ERROR
                        Log.e(TAG, "🚨 Error 133 (GATT_ERROR) - this often resolves with retry");
                        // Error 133 can have many causes - often resolves with retry
                        
                    } else if (status == 8) { // GATT_CONN_TIMEOUT
                        Log.e(TAG, "⏱️ Connection timeout (status 8)");
                        
                    } else if (status == 19) { // GATT_CONN_TERMINATE_PEER_USER
                        Log.d(TAG, "📱 Device disconnected itself (status 19) - normal behavior");
                        
                    } else if (status == 22) { // GATT_CONN_TERMINATE_LOCAL_HOST
                        Log.d(TAG, "📱 Local disconnect (status 22) - normal behavior");
                        
                    } else if (status == 62) { // GATT_CONN_LMP_TIMEOUT
                        Log.e(TAG, "⏱️ LMP Response Timeout (status 62)");
                        
                    } else if (status == 34) { // GATT_CONN_FAIL_ESTABLISH
                        Log.e(TAG, "❌ Connection failed to establish (status 34)");
                    }
                    
                    // Clean up and close GATT
                    deviceState.state = ConnectionState.DISCONNECTED;
                    
                    try {
                        gatt.close();
                        Log.d(TAG, "🧹 GATT closed after error for: " + deviceId);
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ Error closing GATT: " + e.getMessage());
                    }
                    
                    // ❌ REMOVED: deviceState.gatt = null; - no longer store GATT here
                    
                    // Notify foreground service
                    if (foregroundService != null) {
                        foregroundService.removeConnectedDevice(deviceId);
                    }
                    
                }
                
                // Notify callback
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onConnectionStateChanged(deviceId, deviceState.state, gatt);
                }
            }
            
            @Override
            public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // ════════════════════════════════════════════════════════════════════════════
                // BEST PRACTICE: Check if service discovery succeeded
                // If it fails (typically GATT_INTERNAL_ERROR = 129), must disconnect
                // (Source: Martijn van Welie - Making Android BLE Work Part 2)
                // ════════════════════════════════════════════════════════════════════════════
                if (status != BluetoothGatt.GATT_SUCCESS) {
                    Log.e(TAG, "❌ Service discovery failed for " + deviceId + " with status: " + status + 
                          " (" + statusToString(status) + ")");
                    
                    // Must disconnect - can't do anything meaningful without services
                    if (status == 129) { // GATT_INTERNAL_ERROR
                        Log.e(TAG, "🚨 GATT_INTERNAL_ERROR (129) - disconnecting and will retry");
                    }
                    
                    DeviceConnectionState deviceState = deviceStates.get(deviceId);
                    if (deviceState != null) {
                        deviceState.isManualDisconnect = false; // Allow reconnection
                    }
                    
                    // Disconnect to trigger reconnection
                    gatt.disconnect();
                    return;
                }
                
                List<BluetoothGattService> services = gatt.getServices();
                Log.d(TAG, "✅ Services discovered for " + deviceId + ": " + services.size() + " services");
                
                BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                if (callback != null) {
                    callback.onServicesDiscovered(deviceId, gatt, services);
                }
            }
            
            @Override
            public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // Process callback on main handler
                mainHandler.post(() -> {
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onCharacteristicRead(deviceId, characteristic, status);
                    }
                });
            }
            
            @Override
            public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // Process callback on main handler
                mainHandler.post(() -> {
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onCharacteristicWrite(deviceId, characteristic, status);
                    }
                });
            }
            
            @Override
            public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // Process callback on main handler
                mainHandler.post(() -> {
                    BluetoothGattCharacteristic characteristic = descriptor.getCharacteristic();
                    
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        Log.e(TAG, "❌ Descriptor write failed for " + deviceId + 
                              " - characteristic: " + characteristic.getUuid() + 
                              ", status: " + statusToString(status));
                    }
                    
                    // Check if this is the CCC descriptor (for notifications/indications)
                    if (CCC_DESCRIPTOR_UUID.equals(descriptor.getUuid().toString())) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            byte[] value = descriptor.getValue();
                            if (value != null && value.length > 0) {
                                if (value[0] != 0) {
                                    Log.d(TAG, "✅ Notifications enabled for: " + characteristic.getUuid());
                                } else {
                                    Log.d(TAG, "🔕 Notifications disabled for: " + characteristic.getUuid());
                                }
                            }
                        }
                    }
                    
                    // ✅ Notify callback for descriptor write completion
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        Log.d(TAG, "[onDescriptorWrite] Invoking app callback for " + deviceId + " char=" + characteristic.getUuid() + " status=" + status);
                        callback.onDescriptorWrite(deviceId, descriptor, status);
                    } else {
                        Log.w(TAG, "[onDescriptorWrite] No callback registered for " + deviceId + " - queue will not advance!");
                    }
                });
            }
            
            @Override
            public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // Process callback on main handler
                mainHandler.post(() -> {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        Log.d(TAG, "✅ MTU changed for " + deviceId + ": " + mtu + " bytes");
                    } else {
                        Log.e(TAG, "❌ MTU change failed for " + deviceId + 
                              " - status: " + statusToString(status));
                    }
                    
                    // ✅ Notify callback for MTU change
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onMtuChanged(deviceId, mtu, status);
                    }
                });
            }
            
            @Override
            public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                String deviceId = gatt.getDevice().getAddress();
                
                // Process callback on main handler  
                mainHandler.post(() -> {
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        Log.d(TAG, "📶 RSSI read for " + deviceId + ": " + rssi + " dBm");
                    } else {
                        Log.e(TAG, "❌ RSSI read failed for " + deviceId + 
                              " - status: " + statusToString(status));
                    }
                    
                    // ✅ Notify callback for RSSI reading
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onReadRemoteRssi(deviceId, rssi, status);
                    }
                });
            }
            
            @Override
            public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                String deviceId = gatt.getDevice().getAddress();
                
                // ════════════════════════════════════════════════════════════════════════
                // BEST PRACTICE: Always make a copy of the byte array to avoid threading issues
                // Android reuses BluetoothGattCharacteristic objects internally
                // (Source: Martijn van Welie - Making Android BLE Work Part 3)
                // ════════════════════════════════════════════════════════════════════════
                final byte[] value = characteristic.getValue();
                final byte[] valueCopy;
                if (value != null && value.length > 0) {
                    valueCopy = new byte[value.length];
                    System.arraycopy(value, 0, valueCopy, 0, value.length);
                } else {
                    valueCopy = new byte[0];
                }
                
                // Process on main handler
                mainHandler.post(() -> {
                    BLEConnectionCallback callback = connectionCallbacks.get(deviceId);
                    if (callback != null) {
                        callback.onCharacteristicChanged(deviceId, characteristic);
                    }
                    
                    // Notify data callback with the copied value
                    BLEDataCallback dataCallback = dataCallbacks.get(deviceId);
                    if (dataCallback != null) {
                        dataCallback.onDataReceived(deviceId, valueCopy);
                    }
                });
            }
        }, BluetoothDevice.TRANSPORT_LE); // ✅ CRITICAL: Always use TRANSPORT_LE for BLE connections
        
        // ❌ REMOVED: state.gatt = gatt; - GATT passed to callback instead of stored here
        // Callback receives GATT and stores it in SampleBridgeAndroid.connectedGatts
    }
    
    // ════════════════════════════════════════════════════════════════════════════════
    // BEST PRACTICE: Proper disconnect sequence
    // 1. Call disconnect()
    // 2. Wait for onConnectionStateChange callback
    // 3. Call close() in the callback
    // 4. Dispose of gatt object
    // (Source: Martijn van Welie - Making Android BLE Work Part 2)
    // ════════════════════════════════════════════════════════════════════════════════
    // ✅ REFACTORED: disconnectDevice now accepts GATT as parameter
    // Caller (SampleBridgeAndroid) provides GATT from its connectedGatts map
    public void disconnectDevice(String deviceId, BluetoothGatt gatt) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) {
            Log.w(TAG, "No device state for: " + deviceId);
            return;
        }
        
        if (gatt == null) {
            Log.w(TAG, "No active GATT connection for device: " + deviceId);
            return;
        }
        
        Log.d(TAG, "🔌 Initiating manual disconnect for: " + deviceId);
        
        state.isManualDisconnect = true;
        state.state = ConnectionState.DISCONNECTING;
        
        // ✅ BEST PRACTICE: Only call disconnect() here
        // close() will be called in onConnectionStateChange callback
        gatt.disconnect();
        
        // ✅ SAFETY: If callback doesn't arrive within 2 seconds, force cleanup
        final BluetoothGatt finalGatt = gatt;
        Runnable timeoutRunnable = () -> {
            disconnectTimeoutRunnables.remove(deviceId);
            DeviceConnectionState currentState = deviceStates.get(deviceId);
            if (currentState != null && currentState.state == ConnectionState.DISCONNECTING) {
                Log.w(TAG, "⚠️ Disconnect callback timeout, forcing cleanup: " + deviceId);
                
                if (finalGatt != null) {
                    try {
                        finalGatt.close();
                    } catch (Exception e) {
                        Log.w(TAG, "Error closing GATT during timeout: " + e.getMessage());
                    }
                }
                
                currentState.state = ConnectionState.DISCONNECTED;
                
                // Clean up
                connectionCallbacks.remove(deviceId);
                dataCallbacks.remove(deviceId);
                
                // Notify foreground service
                if (foregroundService != null) {
                    foregroundService.removeConnectedDevice(deviceId);
                    foregroundService.removeMonitoredDevice(deviceId);
                }
            }
        };
        disconnectTimeoutRunnables.put(deviceId, timeoutRunnable);
        mainHandler.postDelayed(timeoutRunnable, 2000);
        
        Log.d(TAG, "📤 Disconnect initiated, waiting for callback: " + deviceId);
    }
    
    /**
     * Cancel the 2s disconnect timeout for a device. Call this when disconnecting for DFU
     * so the timeout does not fire and close our GATT after McuMgr has connected (which
     * can kill the DFU connection on some stacks).
     */
    public void cancelDisconnectTimeout(String deviceId) {
        Runnable runnable = disconnectTimeoutRunnables.remove(deviceId);
        if (runnable != null) {
            mainHandler.removeCallbacks(runnable);
            Log.d(TAG, "✅ Disconnect timeout cancelled for: " + deviceId + " (e.g. DFU started)");
        }
    }
    
    /**
     * ❌ REMOVED: cleanupStaleConnection - No longer manages GATT objects
     * SampleBridgeAndroid is responsible for closing GATT connections
     * This class only manages connection state tracking
     */
    private void cleanupStaleConnection(String deviceId, DeviceConnectionState state) {
        Log.d(TAG, "🧹 [INDUSTRY] Cleaning up stale connection state for: " + deviceId);
        
        // Reset connection state only - GATT cleanup handled by SampleBridgeAndroid
        state.state = ConnectionState.DISCONNECTED;
        state.lastConnectionAttemptTime = 0;
        
        Log.d(TAG, "   ✅ Connection state reset");
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
     * Approval gate for manual GATT connection (SampleBridgeAndroid manual flow).
     * Manager decides allow/cooldown; when approved, bridge calls startGattConnectionInternal().
     */
    public void requestConnectionApproval(String deviceId, BluetoothDevice device, ConnectionApprovalCallback callback) {
        if (device == null || callback == null) {
            if (callback != null) callback.onConnectRejected("device or callback null");
            return;
        }
        long now = System.currentTimeMillis();
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) {
            state = new DeviceConnectionState(deviceId);
            deviceStates.put(deviceId, state);
        }
        if (state.reconnectBlockedUntilMs > now) {
            long remaining = state.reconnectBlockedUntilMs - now;
            Log.w(TAG, "Connection rejected (cooldown): " + deviceId + " - " + remaining + "ms remaining");
            callback.onConnectRejected("Connection in cooldown. Retry in " + (remaining / 1000) + "s.");
            return;
        }
        // Prevent double-connect / re-entry: reject if connection already in progress
        if (state.state == ConnectionState.CONNECTING) {
            long timeSince = now - state.lastConnectionAttemptTime;
            if (timeSince < CONNECTION_TIMEOUT_MS + 5000) {
                Log.w(TAG, "Connection rejected (already in progress): " + deviceId);
                callback.onConnectRejected("Connection already in progress for this device.");
                return;
            }
            // Stale CONNECTING - treat as new attempt
        }
        state.state = ConnectionState.CONNECTING;
        state.lastConnectionAttemptTime = now;
        Log.d(TAG, "Connection approved for manual GATT: " + deviceId);
        callback.onConnectApproved();
    }
    
    /**
     * Report connection failure (e.g. status 133). Manager decides retry delay or give-up.
     * @return retry delay in ms, or -1 to give up (caller should reject promise).
     */
    public long onConnectionFailed(String deviceId, BluetoothDevice device, int errorCode) {
        if (errorCode != ERROR_133) return -1;
        int count = status133RetryCounts.getOrDefault(deviceId, 0);
        if (count >= MAX_STATUS_133_RETRIES) {
            status133RetryCounts.remove(deviceId);
            Log.e(TAG, "[STATUS 133] Max retries reached for " + deviceId);
            return -1;
        }
        long delay = STATUS_133_RETRY_DELAYS_MS[count];
        status133RetryCounts.put(deviceId, count + 1);
        Log.d(TAG, "[STATUS 133] Retry " + (count + 1) + "/" + MAX_STATUS_133_RETRIES + " in " + (delay / 1000) + "s for " + deviceId);
        return delay;
    }
    
    /**
     * Reset status 133 retry count and set CONNECTED when manual connection succeeds (call from bridge on STATE_CONNECTED).
     */
    public void onConnectionSucceeded(String deviceId) {
        status133RetryCounts.remove(deviceId);
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state != null) {
            state.state = ConnectionState.CONNECTED;
            state.lastConnectionTime = System.currentTimeMillis();
        }
    }
    
    /**
     * Clear CONNECTING (or CONNECTED) when manual connection attempt fails or device disconnects.
     * Call from bridge on failure / STATE_DISCONNECTED. Prevents device stuck in CONNECTING and allows future approval.
     */
    public void onConnectionAttemptFailed(String deviceId) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state != null && (state.state == ConnectionState.CONNECTING || state.state == ConnectionState.CONNECTED)) {
            state.state = ConnectionState.DISCONNECTED;
        }
    }
    
    // ❌ REMOVED: scheduleReconnection - manual connection only, no auto-reconnect
    
    // ❌ REMOVED: All operation queue methods (readCharacteristic, writeCharacteristic, enqueueOperation, etc.)
    // All GATT operations now handled by SampleBridgeAndroid.GattOperationQueue
    // BLEConnectionManager only manages connection state and reconnection strategy
    
    // Getters
    public Map<String, DeviceConnectionState> getDeviceStates() {
        return new ConcurrentHashMap<>(deviceStates);
    }
    
    public DeviceConnectionState getDeviceState(String deviceId) {
        return deviceStates.get(deviceId);
    }
    
    /**
     * Returns true if a connection attempt is currently in progress for this device
     * (e.g. from auto-connect). Used by the bridge to treat manual connect as "already connecting"
     * instead of rejecting with "Connection already in progress".
     */
    public boolean isConnectionInProgress(String deviceId) {
        DeviceConnectionState state = deviceStates.get(deviceId);
        if (state == null) return false;
        if (state.state != ConnectionState.CONNECTING) return false;
        long timeSince = System.currentTimeMillis() - state.lastConnectionAttemptTime;
        return timeSince < CONNECTION_TIMEOUT_MS + 5000;
    }
    
    // ❌ REMOVED: getConnectedGatt() - GATT objects no longer stored here
    // Use SampleBridgeAndroid.connectedGatts.get(deviceId) instead
    
    // Device presence (no-op; manual connection only - no auto-reconnect)
    public void onDevicePresenceChanged(String deviceId, boolean inRange) {
        // Manual connection only - no auto-reconnect on presence change
    }
    
    // ════════════════════════════════════════════════════════════════════════════════
    // BEST PRACTICE: Validate device is cached before using autoConnect
    // (Source: Martijn van Welie - Making Android BLE Work Part 1 & 2)
    // ════════════════════════════════════════════════════════════════════════════════
    
    /**
     * Check if device is cached by Android's Bluetooth stack.
     * A device must be cached (or bonded) for autoConnect=true to work properly.
     * 
     * @param device BluetoothDevice to check
     * @return true if device is cached, false if device type is UNKNOWN (not cached)
     */
    public boolean isDeviceCached(BluetoothDevice device) {
        if (device == null) return false;
        
        int deviceType = device.getType();
        boolean isCached = deviceType != BluetoothDevice.DEVICE_TYPE_UNKNOWN;
        
        Log.d(TAG, "📱 Device " + device.getAddress() + " cached: " + isCached + 
              " (type: " + deviceTypeToString(deviceType) + ")");
        
        return isCached;
    }
    
    /**
     * Check if device is bonded (paired).
     * Bonded devices are always cached.
     */
    public boolean isDeviceBonded(BluetoothDevice device) {
        if (device == null) return false;
        return device.getBondState() == BluetoothDevice.BOND_BONDED;
    }
    
    // ❌ REMOVED: clearServicesCache() and setCharacteristicNotification()
    // These operations moved to SampleBridgeAndroid where GATT objects are stored
    // Use SampleBridgeAndroid.GattOperationQueue for all GATT operations
    
    // ════════════════════════════════════════════════════════════════════════════════
    // Helper methods for debugging and logging
    // ════════════════════════════════════════════════════════════════════════════════
    
    private String statusToString(int status) {
        switch (status) {
            case BluetoothGatt.GATT_SUCCESS: return "GATT_SUCCESS (0)";
            case 8: return "GATT_CONN_TIMEOUT (8)";
            case 19: return "GATT_CONN_TERMINATE_PEER_USER (19)";
            case 22: return "GATT_CONN_TERMINATE_LOCAL_HOST (22)";
            case 34: return "GATT_CONN_FAIL_ESTABLISH (34)";
            case 62: return "GATT_CONN_LMP_TIMEOUT (62)";
            case 129: return "GATT_INTERNAL_ERROR (129)";
            case 133: return "GATT_ERROR (133)";
            case 257: return "GATT_FAILURE (257)";
            default: return "UNKNOWN (" + status + ")";
        }
    }
    
    private String connectionStateToString(int state) {
        switch (state) {
            case BluetoothProfile.STATE_CONNECTED: return "STATE_CONNECTED";
            case BluetoothProfile.STATE_CONNECTING: return "STATE_CONNECTING";
            case BluetoothProfile.STATE_DISCONNECTED: return "STATE_DISCONNECTED";
            case BluetoothProfile.STATE_DISCONNECTING: return "STATE_DISCONNECTING";
            default: return "UNKNOWN (" + state + ")";
        }
    }
    
    private String bondStateToString(int bondState) {
        switch (bondState) {
            case BluetoothDevice.BOND_NONE: return "BOND_NONE";
            case BluetoothDevice.BOND_BONDING: return "BOND_BONDING";
            case BluetoothDevice.BOND_BONDED: return "BOND_BONDED";
            default: return "UNKNOWN (" + bondState + ")";
        }
    }
    
    private String deviceTypeToString(int type) {
        switch (type) {
            case BluetoothDevice.DEVICE_TYPE_CLASSIC: return "CLASSIC";
            case BluetoothDevice.DEVICE_TYPE_LE: return "LE";
            case BluetoothDevice.DEVICE_TYPE_DUAL: return "DUAL";
            case BluetoothDevice.DEVICE_TYPE_UNKNOWN: return "UNKNOWN (not cached)";
            default: return "UNKNOWN (" + type + ")";
        }
    }
    
    // Cleanup
    public void cleanup() {
        Log.d(TAG, "🧹 Cleaning up BLEConnectionManager");
        
        // Unregister bond state receiver
        if (isBondReceiverRegistered && bondStateReceiver != null) {
            try {
                context.unregisterReceiver(bondStateReceiver);
                isBondReceiverRegistered = false;
                Log.d(TAG, "✅ Bond state receiver unregistered");
            } catch (Exception e) {
                Log.w(TAG, "Error unregistering bond state receiver", e);
            }
        }
        
        // Cancel all connection timeouts
        for (Runnable timeoutHandler : connectionTimeoutHandlers.values()) {
            if (timeoutHandler != null) {
                mainHandler.removeCallbacks(timeoutHandler);
            }
        }
        connectionTimeoutHandlers.clear();
        
        // Note: Actual GATT disconnection handled by SampleBridgeAndroid
        // This only clears connection state tracking
        
        // Clear all handlers
        mainHandler.removeCallbacksAndMessages(null);
        
        deviceStates.clear();
        connectionCallbacks.clear();
        dataCallbacks.clear();
        
        if (foregroundService != null) {
            foregroundService = null;
        }
        
        Log.d(TAG, "✅ Cleanup complete");
    }
}
