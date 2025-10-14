package com.reactnativeboilerplate;

import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import android.widget.Toast;
import android.util.Log;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.MediaType;
import okhttp3.RequestBody;

// Android BLE imports
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
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Binder;
import androidx.core.app.NotificationCompat;

// Additional imports for data parsing and encryption
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.Queue;
import java.util.LinkedList;
import java.util.Collections;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.Timer;
import java.util.TimerTask;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import javax.crypto.spec.IvParameterSpec;

// Import BLEConnectionManager interfaces
import com.reactnativeboilerplate.BLEConnectionManager.BLEConnectionCallback;
import com.reactnativeboilerplate.BLEConnectionManager.ConnectionState;

// Nordic DFU Library imports
import no.nordicsemi.android.dfu.DfuProgressListener;
import no.nordicsemi.android.dfu.DfuProgressListenerAdapter;
import no.nordicsemi.android.dfu.DfuServiceInitiator;
import no.nordicsemi.android.dfu.DfuServiceListenerHelper;
import no.nordicsemi.android.dfu.DfuBaseService;
import android.net.Uri;

/**
 * ✅ Helper class for queuing descriptor writes
 * Android BLE requires SEQUENTIAL descriptor writes (per Punch Through guide)
 */
class DescriptorWriteRequest {
    BluetoothGatt gatt;
    BluetoothGattCharacteristic characteristic;
    BluetoothGattDescriptor descriptor;
    String deviceId;
    String charUuid;
    
    DescriptorWriteRequest(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, 
                          BluetoothGattDescriptor descriptor, String deviceId, String charUuid) {
        this.gatt = gatt;
        this.characteristic = characteristic;
        this.descriptor = descriptor;
        this.deviceId = deviceId;
        this.charUuid = charUuid;
    }
}

public class SampleBridgeAndroid extends ReactContextBaseJavaModule {
    private static final String TAG = "SampleBridgeAndroid";
    private OkHttpClient client = new OkHttpClient();
    
    // BLE Constants (matching iOS implementation)
    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    private static final String BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
    private static final String DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
    private static final String GENERIC_ACCESS_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
    private static final String DFU_SERVICE_UUID = "8ec90003-f315-4f60-9fb8-838830daea50"; // Updated to match SDD Table 7
    
    // Smart Tag Characteristics
    private static final String SYSTEM_COMMAND_CHAR_UUID = "4f4e4d4c-4b4a-4948-4746-454443424140";
    private static final String DEVICE_STATUS_CHAR_UUID = "5f5e5d5c-5b5a-5958-5756-555453525150";
    private static final String DATA_TRANSFER_CHAR_UUID = "6f6e6d6c-6b6a-6968-6766-656463626160";
    // LOCATION_DATA_CHAR_UUID removed - not defined in SDD Table 8
    
    // Standard Characteristics
    private static final String BATTERY_LEVEL_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb";
    private static final String MANUFACTURER_NAME_CHAR_UUID = "00002a29-0000-1000-8000-00805f9b34fb";
    private static final String MODEL_NUMBER_CHAR_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
    private static final String FIRMWARE_REVISION_CHAR_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
    
    // ✅ Manufacturer ID for Smart Health Tag (matching iOS)
    private static final int SMART_TAG_MANUFACTURER_ID = 0x1234;
    
    // System Command Constants
    private static final byte REQUEST_ID = (byte) 0xAA;
    private static final byte RESPONSE_ID = (byte) 0xBB;
    private static final byte STATUS_SUCCESS = 0x00;
    private static final byte STATUS_FAILURE = 0x01;
    
    // Command IDs (matching iOS and SDD Table 9)
    private static final byte CMD_SET_SYSTEM_TIME = 0x01;
    private static final byte CMD_SET_ADV_INTERVAL = 0x02;
    private static final byte CMD_SET_CONN_INTERVAL = 0x03;
    private static final byte CMD_SET_DATA_INTERVAL = 0x04;
    private static final byte CMD_GET_FW_VERSION = 0x05;
    private static final byte CMD_GET_HW_VERSION = 0x06;
    private static final byte CMD_GET_DIAGNOSTICS = 0x07;
    private static final byte CMD_DATA_SYNC_START = 0x08;
    private static final byte CMD_DATA_SYNC_STOP = 0x09;
    private static final byte CMD_ENTER_DFU_MODE = 0x0A;  // ✅ DFU: Enter DFU/Bootloader Mode
    private static final byte CMD_SYSTEM_RESTART = 0x10;
    private static final byte CMD_TOGGLE_BUZZER = 0x11;  // ✅ ADDED: Missing in Android (present in iOS)
    
    // Data Transfer Types (from SDD)
    private static final byte DATA_TRANSFER_SYNC_START = 0x01;
    private static final byte DATA_TRANSFER_SYNC_COMPLETE = 0x02;
    private static final byte DATA_TRANSFER_RECORD = 0x03;
    private static final byte DATA_TRANSFER_READ_ERROR = 0x04;
    
    // Device Status Layout (20 bytes)
    private static final int TIMESTAMP_OFFSET = 0;   // 4 bytes
    private static final int STEPS_OFFSET = 4;       // 2 bytes
    private static final int TEMP_OFFSET = 6;        // 1 byte
    private static final int FLAGS_OFFSET = 7;       // 1 byte
    private static final int RESERVED_OFFSET = 8;    // 12 bytes
    private static final int DEVICE_STATUS_SIZE = 20;
    
    // API Configuration
    private static final String API_KEY = "34A4601F-0930-4A22-8993-97B951881F83";
    private static final String API_PASSWORD = "xxxaeexrkp";
    private static final String API_BASE_URL = "https://your-api-endpoint.com"; // Replace with actual URL
    
    // BLE Manager and Scanner
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    private BluetoothManager bluetoothManager;
    
    // Device Management
    private Map<String, BluetoothDevice> bondedDevices = new ConcurrentHashMap<>();
    private Set<String> bondedDeviceIds = Collections.synchronizedSet(new HashSet<>());
    private Set<String> forgottenDeviceIds = Collections.synchronizedSet(new HashSet<>()); // ✅ Track forgotten devices (matching iOS)
    private Map<String, BluetoothGatt> connectedGatts = new ConcurrentHashMap<>();
    private Map<String, DeviceData> deviceDataMap = new ConcurrentHashMap<>();
    private Map<String, BluetoothGattCharacteristic> deviceCharacteristics = new ConcurrentHashMap<>();
    private Map<String, Integer> healthCheckFailures = new ConcurrentHashMap<>();
    private Set<String> manualDisconnectInProgress = Collections.synchronizedSet(new HashSet<>());
    private Set<String> pendingWrites = Collections.synchronizedSet(new HashSet<>());
    
    // Enhanced operation tracking with TransactionManager
    private TransactionManager transactionManager = new TransactionManager();
    
    // Transaction ID mapping for write operations
    private Map<String, String> writeTransactionIds = new ConcurrentHashMap<>();
    
    // Legacy promise tracking (will be migrated to TransactionManager)
    private Map<String, Promise> pendingReadPromises = new ConcurrentHashMap<>();
    private Map<String, Promise> pendingServiceDiscoveryPromises = new ConcurrentHashMap<>();
    private Map<String, Promise> pendingRSSIPromises = new ConcurrentHashMap<>();
    private Map<String, Promise> pendingCharacteristicPromises = new ConcurrentHashMap<>();
    private Map<String, Promise> pendingDescriptorPromises = new ConcurrentHashMap<>();
    private Map<String, BluetoothGattCharacteristic> monitoredCharacteristics = new ConcurrentHashMap<>();
    
    // Scanning
    private AtomicBoolean isScanning = new AtomicBoolean(false);
    private AtomicBoolean autoConnectEnabled = new AtomicBoolean(false);
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    private ScheduledExecutorService executorService = Executors.newScheduledThreadPool(4);
    
    // Reconnection
    private Map<String, Runnable> reconnectTasks = new ConcurrentHashMap<>();
    private Map<String, Integer> reconnectAttempts = new ConcurrentHashMap<>();
    private Map<String, Long> reconnectBackoff = new ConcurrentHashMap<>();
    
    // Health Data API Monitoring
    private Map<String, ScheduledFuture<?>> healthApiTasks = new ConcurrentHashMap<>();
    
    // ✅ Data Sync State Management (matching iOS implementation)
    private Map<String, String> dataSyncState = new ConcurrentHashMap<>(); // Track sync state: "idle", "time_syncing", "ready", "syncing", "complete"
    private Map<String, Integer> dataSyncRetryCount = new ConcurrentHashMap<>(); // Track retry attempts
    private Map<String, ScheduledFuture<?>> dataSyncTimers = new ConcurrentHashMap<>(); // Track delayed sync operations
    private Map<String, Integer> deviceRecordCounts = new ConcurrentHashMap<>(); // Store record counts from manufacturer data
    private Map<String, Boolean> dataSyncRequested = new ConcurrentHashMap<>(); // Track if we actually requested data sync
    private Map<String, Integer> deviceStatusNotificationCount = new ConcurrentHashMap<>(); // Track Device Status notification count
    private Map<String, Boolean> systemCommandsSent = new ConcurrentHashMap<>(); // Track if system commands were already sent
    
    // ✅ Device Status Polling (workaround for firmware bug)
    private Map<String, ScheduledFuture<?>> deviceStatusPollingTimers = new ConcurrentHashMap<>();
    
    // ✅ Notification tracking (to ensure all notifications are enabled before sending commands)
    private Map<String, Integer> pendingNotificationEnables = new ConcurrentHashMap<>(); // Track pending notification enables per device
    private Map<String, Integer> completedNotificationEnables = new ConcurrentHashMap<>(); // Track completed notification enables per device
    
    // ✅ Descriptor Write Queue (Android requires SEQUENTIAL writes - per Punch Through guide)
    private Map<String, Queue<DescriptorWriteRequest>> descriptorWriteQueues = new ConcurrentHashMap<>();
    private Map<String, Boolean> isDescriptorWriteInProgress = new ConcurrentHashMap<>();
    
    // Data Storage
    private SharedPreferences sharedPreferences;
    private static final String PREFS_NAME = "SmartTagPrefs";
    private static final String BONDED_DEVICES_KEY = "bonded_devices";
    
    // Foreground Service and Connection Manager
    private BLEForegroundService bleService;
    private boolean isServiceRunning = false;
    private BLEConnectionManager connectionManager;
    private BLECompanionDeviceService companionService;
    
    // Power Profile Management (matching JavaScript POWER_PROFILE standards)
    private String currentPowerProfile = "default";
    private Map<String, Map<String, Object>> powerProfiles = new ConcurrentHashMap<>();
    private Timer healthCheckTimer;
    
    // Thread synchronization lock for critical BLE operations
    private final Object gattLock = new Object();
    
    // Power Profile Constants (matching JavaScript BLEConstants.js)
    private static final Map<String, Map<String, Object>> POWER_PROFILE_DEFAULTS = new HashMap<String, Map<String, Object>>() {{
        put("default", new HashMap<String, Object>() {{
            put("healthCheckMs", 30000); // 30s health checks (matching iOS)
            put("rssiCycleIntervalMs", 30000);
            put("maxScanDurationMs", 15000);
            put("connectionIntervalMs", 50);
            put("scanMode", "LowLatency");
        }});
        put("lowPower", new HashMap<String, Object>() {{
            put("healthCheckMs", 60000);
            put("rssiCycleIntervalMs", 30000);
            put("maxScanDurationMs", 8000);
            put("connectionIntervalMs", 100);
            put("scanMode", "Balanced");
        }});
        put("ultraLowPower", new HashMap<String, Object>() {{
            put("healthCheckMs", 60000);
            put("rssiCycleIntervalMs", 60000);
            put("maxScanDurationMs", 5000);
            put("connectionIntervalMs", 200);
            put("scanMode", "LowPower");
        }});
    }};
    
    // Update connection parameters for all connected devices when power profile changes
    private void updateConnectionParametersForAllDevices() {
        Log.d(TAG, "🔗 Updating connection parameters for all connected devices (profile: " + currentPowerProfile + ")");
        
        for (Map.Entry<String, BluetoothGatt> entry : connectedGatts.entrySet()) {
            String deviceId = entry.getKey();
            BluetoothGatt gatt = entry.getValue();
            
            if (gatt != null) {
                Log.d(TAG, "🔗 Updating connection parameters for device: " + deviceId);
                requestConnectionParameters(gatt, deviceId);
            }
        }
        
        Log.d(TAG, "🔗 Connection parameter update completed for " + connectedGatts.size() + " devices");
    }

    // Request connection parameters based on current power profile
    private void requestConnectionParameters(BluetoothGatt gatt, String deviceId) {
        try {
            Map<String, Object> profileSettings = powerProfiles.get(currentPowerProfile);
            if (profileSettings != null) {
                Integer connectionIntervalMs = (Integer) profileSettings.get("connectionIntervalMs");
                if (connectionIntervalMs != null) {
                    // Convert connection interval to Android connection priority
                    int priority;
                    if (connectionIntervalMs <= 50) {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_HIGH;
                        Log.d(TAG, "🔗 Requesting HIGH priority connection for " + deviceId + " (interval: " + connectionIntervalMs + "ms)");
                    } else if (connectionIntervalMs <= 100) {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_BALANCED;
                        Log.d(TAG, "🔗 Requesting BALANCED priority connection for " + deviceId + " (interval: " + connectionIntervalMs + "ms)");
                    } else {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_LOW_POWER;
                        Log.d(TAG, "🔗 Requesting LOW_POWER priority connection for " + deviceId + " (interval: " + connectionIntervalMs + "ms)");
                    }
                    
                    // Request connection priority
                    boolean success = gatt.requestConnectionPriority(priority);
                    if (success) {
                        Log.d(TAG, "✅ Connection priority request sent for " + deviceId + " (profile: " + currentPowerProfile + ")");
                    } else {
                        Log.w(TAG, "⚠️ Failed to request connection priority for " + deviceId);
                    }
                } else {
                    Log.w(TAG, "⚠️ No connection interval defined for profile: " + currentPowerProfile);
                }
            } else {
                Log.w(TAG, "⚠️ No profile settings found for: " + currentPowerProfile);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error requesting connection parameters for " + deviceId + ": " + e.getMessage());
        }
    }

    // Power Profile Management Methods
    @ReactMethod
    public void setPowerProfile(String profileName, Promise promise) {
        try {
            Log.d(TAG, "⚡ Setting power profile to: " + profileName);
            
            if (!POWER_PROFILE_DEFAULTS.containsKey(profileName)) {
                promise.reject("INVALID_PROFILE", "Invalid power profile: " + profileName);
                return;
            }
            
            String oldProfile = currentPowerProfile;
            currentPowerProfile = profileName;
            
            // Update power profile settings
            updatePowerProfileSettings();
            
            // Restart health checks with new timing
            restartHealthChecks();
            
            // Update connection parameters for all connected devices
            updateConnectionParametersForAllDevices();
            
            Log.d(TAG, "⚡ Power profile changed: " + oldProfile + " → " + profileName);
            
            WritableMap result = Arguments.createMap();
            result.putString("oldProfile", oldProfile);
            result.putString("newProfile", profileName);
            result.putString("message", "Power profile updated successfully");
            
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to set power profile", e);
            promise.reject("PROFILE_ERROR", "Failed to set power profile: " + e.getMessage());
        }
    }
    
    @ReactMethod
    public void getCurrentPowerProfile(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putString("profile", currentPowerProfile);
            
            // Create settings map manually
            Map<String, Object> settings = powerProfiles.get(currentPowerProfile);
            WritableMap settingsMap = Arguments.createMap();
            if (settings != null) {
                for (Map.Entry<String, Object> entry : settings.entrySet()) {
                    Object value = entry.getValue();
                    if (value instanceof Integer) {
                        settingsMap.putInt(entry.getKey(), (Integer) value);
                    } else if (value instanceof String) {
                        settingsMap.putString(entry.getKey(), (String) value);
                    }
                }
            }
            result.putMap("settings", settingsMap);
            
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to get power profile", e);
            promise.reject("PROFILE_ERROR", "Failed to get power profile: " + e.getMessage());
        }
    }
    
    private void updatePowerProfileSettings() {
        Map<String, Object> profileSettings = POWER_PROFILE_DEFAULTS.get(currentPowerProfile);
        if (profileSettings != null) {
            powerProfiles.put(currentPowerProfile, new HashMap<>(profileSettings));
            Log.d(TAG, "⚡ Updated power profile settings for: " + currentPowerProfile);
        }
    }
    
    private void restartHealthChecks() {
        Log.d(TAG, "⚡ Restarting health checks for profile: " + currentPowerProfile);
        
        // Stop existing health checks
        if (healthCheckTimer != null) {
            healthCheckTimer.cancel();
            healthCheckTimer = null;
            Log.d(TAG, "⚡ Stopped existing health checks");
        }
        
        // Start new health checks with updated timing
        startHealthChecks();
    }
    
    private void startHealthChecks() {
        Map<String, Object> settings = powerProfiles.get(currentPowerProfile);
        if (settings != null) {
            int healthCheckMs = (Integer) settings.get("healthCheckMs");
            
            Log.d(TAG, "⚡ Starting health checks with " + healthCheckMs + "ms interval for profile: " + currentPowerProfile);
            
            healthCheckTimer = new Timer();
            healthCheckTimer.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    performHealthChecks();
                }
            }, healthCheckMs, healthCheckMs);
            
            Log.d(TAG, "⚡ Health checks started successfully");
        } else {
            Log.w(TAG, "⚠️ No settings found for profile: " + currentPowerProfile);
        }
    }
    
    private int getScanModeFromString(String scanMode) {
        switch (scanMode.toLowerCase()) {
            case "lowlatency":
                return ScanSettings.SCAN_MODE_LOW_LATENCY;
            case "balanced":
                return ScanSettings.SCAN_MODE_BALANCED;
            case "lowpower":
                return ScanSettings.SCAN_MODE_LOW_POWER;
            default:
                Log.w(TAG, "⚠️ Unknown scan mode: " + scanMode + ", using LowLatency");
                return ScanSettings.SCAN_MODE_LOW_LATENCY;
        }
    }
    
    private void performHealthChecks() {
        Log.d(TAG, "⚡ Performing health checks for " + connectedGatts.size() + " connected devices");
        
        if (connectedGatts.isEmpty()) {
            Log.d(TAG, "⚡ No connected devices for health check");
            return;
        }
        
        // Check each connected device
        for (Map.Entry<String, BluetoothGatt> entry : connectedGatts.entrySet()) {
            String deviceId = entry.getKey();
            BluetoothGatt gatt = entry.getValue();
            
            try {
                Log.d(TAG, "⚡ Health checking device: " + deviceId);
                
                // Try to read RSSI as a health check
                boolean rssiSuccess = gatt.readRemoteRssi();
                if (rssiSuccess) {
                    Log.d(TAG, "⚡ Health check RSSI request sent for device: " + deviceId);
                    // Reset failure counter on successful health check
                    healthCheckFailures.remove(deviceId);
                } else {
                    Log.w(TAG, "⚠️ Health check RSSI request failed for device: " + deviceId);
                    
                    // Don't immediately disconnect on RSSI failure - Android BLE stack can be unreliable
                    // Instead, increment a failure counter and only disconnect after multiple failures
                    Integer failureCount = healthCheckFailures.getOrDefault(deviceId, 0) + 1;
                    healthCheckFailures.put(deviceId, failureCount);
                    
                    Log.w(TAG, "⚠️ Health check failure count for " + deviceId + ": " + failureCount + "/3");
                    
                    // Only disconnect after 3 consecutive failures
                    if (failureCount >= 3) {
                        Log.e(TAG, "💀 Device " + deviceId + " failed 3 consecutive health checks - marking as disconnected");
                        connectedGatts.remove(deviceId);
                        healthCheckFailures.remove(deviceId);
                        
                        DeviceData deviceData = deviceDataMap.get(deviceId);
                        if (deviceData != null) {
                            deviceData.connectionState = "disconnected";
                            // Send both events for health check failures as we don't know the connection type
                            sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                            sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                        }
                    }
                }
                
            } catch (Exception e) {
                Log.e(TAG, "❌ Health check error for device " + deviceId + ": " + e.getMessage());
                
                // Remove disconnected device
                connectedGatts.remove(deviceId);
                DeviceData deviceData = deviceDataMap.get(deviceId);
                if (deviceData != null) {
                    deviceData.connectionState = "disconnected";
                    // Send both events for health check errors as we don't know the connection type
                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                    sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                    Log.d(TAG, "⚡ Device " + deviceId + " marked as disconnected due to health check error");
                }
            }
        }
        
        Log.d(TAG, "⚡ Health check completed for " + connectedGatts.size() + " remaining devices");
    }

    // Device Data Class
    private static class DeviceData {
        public String deviceId;
        public String deviceName;
        public int rssi;
        public Integer batteryLevel;  // ✅ FIX: Use Integer (nullable) instead of int to allow null value
        public float temperature;
        public int steps;
        public long timestamp;
        public boolean isSmartTag;
        public String connectionState = "disconnected";
        public Map<String, BluetoothGattService> services = new HashMap<>();
        public Map<String, BluetoothGattCharacteristic> characteristics = new HashMap<>();
        
        public DeviceData(String deviceId, String deviceName) {
            this.deviceId = deviceId;
            this.deviceName = deviceName;
            this.timestamp = System.currentTimeMillis();
            this.batteryLevel = null;  // ✅ FIX: Initialize to null until actually read
        }
    }

    //constructor
    public SampleBridgeAndroid(ReactApplicationContext reactContext) {
        super(reactContext);
        
        // Initialize BLE components
        bluetoothManager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager == null) {
            Log.e(TAG, "❌ BluetoothManager is null - Bluetooth not supported on this device");
        } else {
            bluetoothAdapter = bluetoothManager.getAdapter();
            if (bluetoothAdapter == null) {
                Log.e(TAG, "❌ BluetoothAdapter is null - Bluetooth not supported on this device");
            } else {
                bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();
                Log.d(TAG, "✅ Bluetooth components initialized successfully");
            }
        }
        
        // Initialize SharedPreferences
        sharedPreferences = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        
        // Initialize Connection Manager
        connectionManager = new BLEConnectionManager(reactContext);
        
        // Start Companion Device Service for reliable auto-connection
        companionService = new BLECompanionDeviceService(reactContext);
        
        // Request notification permissions (like iOS)
        requestNotificationPermissionsIfNeeded();
        
        // Load bonded devices
        loadBondedDevices();
        loadForgottenDevices(); // ✅ Load forgotten devices (matching iOS)
        
        // Auto-initialize if we have bonded devices (like iOS)
        if (!bondedDeviceIds.isEmpty()) {
            Log.d("SampleBridgeAndroid", "🚀 Auto-initializing BLE due to bonded devices: " + bondedDeviceIds.size());
            autoConnectEnabled.set(true);
            startForegroundService();
            scheduleBackgroundWork();
            
            // Start auto-connect to bonded devices immediately (like iOS)
            startAutoConnectToBondedDevices();
        }
        
        // Initialize power profile system
        updatePowerProfileSettings();
        startHealthChecks();
        
        // Initialize state restoration (like iOS willRestoreState)
        initializeStateRestoration();
        
        Log.d("SampleBridgeAndroid", "🏁 SampleBridgeAndroid initialized with " + bondedDevices.size() + " bonded devices");
    }
    
    // MARK: - State Restoration (like iOS willRestoreState)
    
    private void initializeStateRestoration() {
        Log.d(TAG, "🔄 Initializing Android state restoration");
        
        // Check for existing connections that need to be restored
        restoreExistingConnections();
        
        // Start monitoring for app state changes
        startAppStateMonitoring();
    }
    
    private void restoreExistingConnections() {
        Log.d(TAG, "🔄 Restoring existing connections");
        
        // Check if we have any bonded devices that should be connected
        if (bondedDeviceIds.isEmpty()) {
            Log.d(TAG, "ℹ️ No bonded devices to restore");
            return;
        }
        
        Log.d(TAG, "📋 Found " + bondedDeviceIds.size() + " bonded devices to potentially restore");
        
        // Try to restore connections to bonded devices
        for (String deviceId : bondedDeviceIds) {
            BluetoothDevice device = bondedDevices.get(deviceId);
            if (device != null) {
                Log.d(TAG, "🔄 Attempting to restore connection to: " + deviceId);
                restoreConnectionToDevice(deviceId, device);
            }
        }
    }
    
    private void restoreConnectionToDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔄 Restoring connection to device: " + deviceId);
        
        try {
            // Check if already connected
            if (connectedGatts.containsKey(deviceId)) {
                Log.d(TAG, "✅ Device already connected: " + deviceId);
                // Ensure data exchange is active for existing connection
                ensureDataExchangeActive(deviceId);
                return;
            }
            
            // Attempt direct connection (like iOS connectToKnownPeripheralsNative)
            BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                true, // autoConnect = true for restoration
                new BluetoothGattCallback() {
                    @Override
                    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "🔄 State restoration connection change: " + deviceId + " - Status: " + status + " - New State: " + newState);
                        
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ State restoration successful: " + deviceId);
                            connectedGatts.put(deviceId, gatt);
                            
                            // Immediately start service discovery and data exchange (like iOS)
                            gatt.discoverServices();
                            
                            // CRITICAL FIX: Ensure data reading starts immediately after restoration
                            Log.d(TAG, "📊 State restoration: Starting immediate data reading for: " + deviceId);
                            mainHandler.postDelayed(() -> {
                                if (connectedGatts.containsKey(deviceId)) {
                                    Log.d(TAG, "📊 State restoration: Requesting device data after restoration delay");
                                    requestDeviceData(deviceId);
                                    
                                    // Start RSSI monitoring for restored device
                                    startRSSIMonitoringForDevice(deviceId);
                                    
                                    // Start health data API monitoring for restored device
                                    startHealthDataApiMonitoringForDevice(deviceId);
                                }
                            }, 1000); // 1 second delay to ensure connection is stable
                            
                            // Send restoration notification
                            String deviceName = gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId;
                            sendLocalNotificationIfBackground("Connection Restored", "Restored connection to " + deviceName);
                            
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "❌ State restoration failed: " + deviceId);
                            connectedGatts.remove(deviceId);
                        }
                    }
                    
                    @Override
                    public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "✅ State restoration services discovered: " + deviceId);
                        
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            // Handle service discovery (this will trigger data reading)
                            handleServicesDiscovered(gatt);
                        }
                    }
                    
                    @Override
                    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        
                        Log.d(TAG, "📖 State restoration characteristic read: " + characteristicUuid + " on device " + deviceId + " - Status: " + status);
                        
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            // Handle the characteristic data (this will process steps, temperature, etc.)
                            handleCharacteristicData(deviceId, characteristic);
                        }
                    }
                    
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        
                        Log.d(TAG, "📡 State restoration characteristic changed: " + characteristicUuid + " on device " + deviceId);
                        
                        // Handle the characteristic data (this will process steps, temperature, etc.)
                        handleCharacteristicData(deviceId, characteristic);
                    }
                }
            );
            
            Log.d(TAG, "🚀 State restoration connection attempt initiated for: " + deviceId);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to restore connection to device: " + deviceId, e);
        }
    }
    
    private void ensureDataExchangeActive(String deviceId) {
        Log.d(TAG, "📊 Ensuring data exchange is active for restored device: " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ Cannot ensure data exchange - GATT not found for: " + deviceId);
            return;
        }
        
        // Request device data immediately (like iOS)
        requestDeviceData(deviceId);
        
        // Start RSSI monitoring
        startRSSIMonitoringForDevice(deviceId);
        
        // Start health data API monitoring
        startHealthDataApiMonitoringForDevice(deviceId);
    }
    
    private void startAppStateMonitoring() {
        Log.d(TAG, "📱 Starting app state monitoring for state restoration");
        
        // This would typically be implemented using ActivityLifecycleCallbacks
        // For now, we'll implement a simple version that can be called from JavaScript
        // when the app comes to foreground
    }
    
    @ReactMethod
    public void onAppStateChanged(String newState, Promise promise) {
        Log.d(TAG, "📱 App state changed to: " + newState);
        
        try {
            if ("active".equals(newState)) {
                // App came to foreground - restore connections and data exchange
                Log.d(TAG, "🔄 App became active - restoring connections and data exchange");
                restoreExistingConnections();
                
                // Start scanning for any missing bonded devices
                if (autoConnectEnabled.get()) {
                    startScanningForBondedDevices();
                }
            } else if ("background".equals(newState)) {
                // App went to background - ensure background operations continue
                Log.d(TAG, "🔄 App went to background - ensuring background operations continue");
                ensureBackgroundOperationsContinue();
            }
            
            promise.resolve("App state change handled");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error handling app state change: " + e.getMessage());
            promise.reject("APP_STATE_ERROR", e.getMessage());
        }
    }
    
    private void ensureBackgroundOperationsContinue() {
        Log.d(TAG, "🔄 Ensuring background operations continue");
        
        // Ensure foreground service is running
        if (!isServiceRunning) {
            startForegroundService();
        }
        
        // Ensure health checks continue
        if (healthCheckTimer == null) {
            startHealthChecks();
        }
        
        // Ensure RSSI monitoring continues for connected devices
        for (String deviceId : connectedGatts.keySet()) {
            startRSSIMonitoringForDevice(deviceId);
        }
    }
    
    private void startRSSIMonitoringForDevice(String deviceId) {
        Log.d(TAG, "📶 Starting RSSI monitoring for device: " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ Cannot start RSSI monitoring - GATT not found for: " + deviceId);
            return;
        }
        
        // Start periodic RSSI reads (like iOS)
        executorService.scheduleAtFixedRate(() -> {
            try {
                if (connectedGatts.containsKey(deviceId)) {
                    Log.d(TAG, "📶 Reading RSSI for auto-connected device: " + deviceId);
                    gatt.readRemoteRssi();
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error reading RSSI for device " + deviceId + ": " + e.getMessage());
            }
        }, 0, 30, TimeUnit.SECONDS); // Read RSSI every 30 seconds (like iOS)
        
        Log.d(TAG, "✅ RSSI monitoring started for auto-connected device: " + deviceId);
    }
    
    private void startHealthDataApiMonitoringForDevice(String deviceId) {
        Log.d(TAG, "📊 Starting health data API monitoring for device: " + deviceId);
        
        // Start periodic health data API calls (like iOS)
        executorService.scheduleAtFixedRate(() -> {
            try {
                if (connectedGatts.containsKey(deviceId)) {
                    DeviceData deviceData = deviceDataMap.get(deviceId);
                    if (deviceData != null) {
                        Log.d(TAG, "📊 Sending health data API call for auto-connected device: " + deviceId);
                        sendHealthDataApiEvent(deviceId, createDeviceInfoMap(deviceData));
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error in health data API monitoring for device " + deviceId + ": " + e.getMessage());
            }
        }, 0, 60, TimeUnit.SECONDS); // Send health data every 60 seconds (like iOS)
        
        Log.d(TAG, "✅ Health data API monitoring started for auto-connected device: " + deviceId);
    }

    @Override
    public String getName() {
        return "SampleBridgeAndroid";
    }
    
    private void addToBondedDevices(String deviceId, BluetoothDevice device) {
        if (!bondedDeviceIds.contains(deviceId)) {
            bondedDeviceIds.add(deviceId);
            bondedDevices.put(deviceId, device);
            saveBondedDevices();
            
            Log.d(TAG, "🔗 Added device to bonded list: " + deviceId);
            
            // Notify companion service about new bonded device
            if (companionService != null) {
                companionService.addCompanionDevice(deviceId, device);
            }
        }
    }
    
    private void requestNotificationPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager = (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                boolean areNotificationsEnabled = manager.areNotificationsEnabled();
                Log.d(TAG, "🔔 Notification permissions status: " + areNotificationsEnabled);
                
                if (!areNotificationsEnabled) {
                    Log.w(TAG, "⚠️ Notifications are disabled - auto-connection notifications may not appear");
                } else {
                    Log.d(TAG, "✅ Notifications are enabled - auto-connection notifications will work");
                }
            }
        } else {
            Log.d(TAG, "🔔 Android version < 13 - notification permissions not required");
        }
    }
    
    // Local notification helpers (like iOS implementation)
    private void sendLocalNotification(String title, String body) {
        try {
            Log.d(TAG, "🔔 Sending local notification: " + title + " - " + body);
            
            // Create notification channel for local notifications
            String channelId = "BLE_LOCAL_NOTIFICATIONS";
            createLocalNotificationChannel(channelId);
            
            Intent notificationIntent = new Intent(getReactApplicationContext(), MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                getReactApplicationContext(), 0, notificationIntent, 
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );
            
            Notification notification = new NotificationCompat.Builder(getReactApplicationContext(), channelId)
                .setContentTitle(title)
                .setContentText(body)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setColor(0xFF4CAF50) // Green color
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
                .build();
            
            NotificationManager manager = (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                // Use timestamp as unique ID
                int notificationId = (int) System.currentTimeMillis();
                manager.notify(notificationId, notification);
                Log.d(TAG, "✅ Local notification sent successfully");
            } else {
                Log.e(TAG, "❌ NotificationManager is null");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to send local notification", e);
        }
    }
    
    private void sendLocalNotificationIfBackground(String title, String body) {
        // Check if app is in background (like iOS implementation)
        // For now, always send notification - in production you'd check app state
        Log.d(TAG, "🔔 Sending background notification: " + title + " - " + body);
        sendLocalNotification(title, body);
    }
    
    private void createLocalNotificationChannel(String channelId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                channelId,
                "BLE Local Notifications",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            
            channel.setDescription("Local notifications for BLE auto-connection events");
            channel.setShowBadge(true);
            channel.enableLights(true);
            channel.enableVibration(true);
            
            NotificationManager manager = (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
    
    // MARK: - Private Helper Methods
    
    private boolean checkBluetoothEnabled() {
        if (bluetoothAdapter == null) {
            Log.e(TAG, "❌ Bluetooth adapter is null - Bluetooth not supported on this device");
            return false;
        }
        boolean isEnabled = bluetoothAdapter.isEnabled();
        Log.d(TAG, "🔍 Bluetooth adapter enabled: " + isEnabled);
        return isEnabled;
    }
    
    private boolean checkPermissions() {
        boolean hasPermissions;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            boolean hasScan = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED;
            boolean hasConnect = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
            boolean hasLocation = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            hasPermissions = hasScan && hasConnect && hasLocation;
            Log.d(TAG, "🔍 Android 12+ Permissions - Scan: " + hasScan + ", Connect: " + hasConnect + ", Location: " + hasLocation);
        } else {
            boolean hasBluetooth = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH) == PackageManager.PERMISSION_GRANTED;
            boolean hasBluetoothAdmin = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_ADMIN) == PackageManager.PERMISSION_GRANTED;
            boolean hasLocation = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            hasPermissions = hasBluetooth && hasBluetoothAdmin && hasLocation;
            Log.d(TAG, "🔍 Legacy Permissions - Bluetooth: " + hasBluetooth + ", BluetoothAdmin: " + hasBluetoothAdmin + ", Location: " + hasLocation);
        }
        Log.d(TAG, "🔍 All permissions granted: " + hasPermissions);
        return hasPermissions;
    }
    
    private void loadBondedDevices() {
        try {
            Set<String> loadedDeviceIds = sharedPreferences.getStringSet(BONDED_DEVICES_KEY, new HashSet<>());
            bondedDeviceIds.clear();
            bondedDevices.clear();
            
            for (String deviceId : loadedDeviceIds) {
                bondedDeviceIds.add(deviceId);
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                bondedDevices.put(deviceId, device);
            }
            Log.d("SampleBridgeAndroid", "📱 Loaded " + bondedDeviceIds.size() + " bonded devices");
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Load bonded devices error: " + e.getMessage());
        }
    }
    
    private void saveBondedDevices() {
        try {
            sharedPreferences.edit()
                .putStringSet(BONDED_DEVICES_KEY, bondedDeviceIds)
                .apply();
            Log.d("SampleBridgeAndroid", "💾 Saved " + bondedDeviceIds.size() + " bonded devices");
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Save bonded devices error: " + e.getMessage());
        }
    }
    
    /**
     * ✅ Load forgotten devices from persistent storage (matching iOS implementation)
     */
    private void loadForgottenDevices() {
        try {
            Set<String> forgottenSet = sharedPreferences.getStringSet("forgotten_devices", new HashSet<>());
            forgottenDeviceIds.clear();
            forgottenDeviceIds.addAll(forgottenSet);
            
            Log.d(TAG, "📂 Loaded " + forgottenDeviceIds.size() + " forgotten devices from storage");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error loading forgotten devices: " + e.getMessage());
        }
    }
    
    /**
     * ✅ Save forgotten devices to persistent storage (matching iOS implementation)
     */
    private void saveForgottenDevices() {
        try {
            Set<String> forgottenSet = new HashSet<>(forgottenDeviceIds);
            sharedPreferences.edit()
                .putStringSet("forgotten_devices", forgottenSet)
                .apply();
            Log.d(TAG, "💾 Saved " + forgottenSet.size() + " forgotten devices to storage");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error saving forgotten devices: " + e.getMessage());
        }
    }
    
    // Save device name for notifications
    private void saveDeviceName(String deviceId, String deviceName) {
        try {
            sharedPreferences.edit()
                .putString("device_name_" + deviceId, deviceName)
                .apply();
            Log.d("SampleBridgeAndroid", "💾 Saved device name: " + deviceName + " for " + deviceId);
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Save device name error: " + e.getMessage());
        }
    }
    
    private void startScanningForBondedDevices() {
        if (isScanning.get()) {
            return;
        }
        
        if (!checkBluetoothEnabled() || !checkPermissions()) {
            Log.e("SampleBridgeAndroid", "Cannot start scanning: BT disabled or permissions missing");
            return;
        }
        
        isScanning.set(true);
        
        // Check if app is in background (like iOS implementation)
        boolean isBackground = !isAppInForeground();
        
        List<ScanFilter> filters = new ArrayList<>();
        Map<String, Object> profileSettings = powerProfiles.get(currentPowerProfile);
        String scanMode = profileSettings != null ? (String) profileSettings.get("scanMode") : "LowLatency";
        
        if (isBackground) {
            // Background scan with service filter (like iOS)
            Log.d("SampleBridgeAndroid", "🔍 Background scan with service filter: " + SMART_TAG_SERVICE_UUID);
            scanMode = "LowPower"; // Force low power mode for background
            
            // Add service filter for Smart Tag devices
            ScanFilter serviceFilter = new ScanFilter.Builder()
                .setServiceUuid(ParcelUuid.fromString(SMART_TAG_SERVICE_UUID))
                .build();
            filters.add(serviceFilter);
        } else {
            // Foreground broad scan (like iOS)
            Log.d("SampleBridgeAndroid", "🔍 Foreground broad scan for all devices");
            // No filters for foreground - scan all devices
        }
        
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(getScanModeFromString(scanMode))
            .setReportDelay(isBackground ? 1000 : 0) // Delay reports in background to save battery
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .build();
        
        // Start scanning with proper error handling
        try {
            Log.d("SampleBridgeAndroid", "🔍 Starting " + (isBackground ? "background" : "foreground") + " scan with " + filters.size() + " filters");
            Log.d("SampleBridgeAndroid", "🔍 Scan settings: mode=" + scanMode + ", reportDelay=" + (isBackground ? 1000 : 0) + ", callbackType=ALL_MATCHES");
            bluetoothLeScanner.startScan(filters, settings, scanCallback);
            Log.d("SampleBridgeAndroid", "✅ Successfully started " + (isBackground ? "background" : "foreground") + " scanning");
            
            // Auto-stop after power profile duration to preserve battery
            Map<String, Object> scanProfileSettings = powerProfiles.get(currentPowerProfile);
            int maxScanDurationMs = scanProfileSettings != null ? (Integer) scanProfileSettings.get("maxScanDurationMs") : 15000;
            
            executorService.schedule(() -> {
                if (isScanning.get()) {
                    stopScanning();
                    Log.d("SampleBridgeAndroid", "⏰ Auto-stopped scanning after " + (maxScanDurationMs/1000) + " seconds (power profile: " + currentPowerProfile + ")");
                }
            }, maxScanDurationMs, TimeUnit.MILLISECONDS);
        } catch (SecurityException e) {
            Log.e("SampleBridgeAndroid", "Security exception during scan: " + e.getMessage());
            isScanning.set(false);
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Error starting scan: " + e.getMessage());
            isScanning.set(false);
        }
    }
    
    private boolean isAppInForeground() {
        // Simple check - in a real implementation, you'd use ActivityManager
        // For now, assume foreground unless explicitly told otherwise
        return true;
    }
    
    private void stopScanning() {
        if (isScanning.get()) {
            bluetoothLeScanner.stopScan(scanCallback);
            isScanning.set(false);
            Log.d("SampleBridgeAndroid", "🛑 Stopped scanning");
        }
    }
    
    /**
     * ✅ Centralized forgotten device check (matching iOS implementation)
     * Prevents auto-reconnection to forgotten devices
     */
    private boolean shouldAllowConnection(String deviceId, boolean isManualConnection) {
        // If device is forgotten and this is auto-connect, reject
        if (forgottenDeviceIds.contains(deviceId) && !isManualConnection) {
            Log.w(TAG, "🚫 Blocking auto-reconnect to forgotten device: " + deviceId);
            return false;
        }
        
        // If manual disconnect is in progress and this is auto-connect, reject
        if (manualDisconnectInProgress.contains(deviceId) && !isManualConnection) {
            Log.w(TAG, "🚫 Blocking auto-reconnect during manual disconnect: " + deviceId);
            return false;
        }
        
        return true;
    }
    
    private void disconnectDevice(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt != null) {
            gatt.disconnect();
            gatt.close();
            connectedGatts.remove(deviceId);
        }
        
        // Cancel reconnect task
        Runnable reconnectTask = reconnectTasks.remove(deviceId);
        if (reconnectTask != null) {
            // ScheduledExecutorService doesn't have remove method, we'll just remove from our map
            // The task will complete naturally or be cancelled by timeout
        }
    }
    
    private void scheduleReconnection(String deviceId) {
        if (reconnectTasks.containsKey(deviceId)) {
            return; // Already scheduled
        }
        
        int attempts = reconnectAttempts.getOrDefault(deviceId, 0);
        long backoffMs = Math.min(1000L * (1L << attempts), 60000L); // Exponential backoff, max 60s
        
        Runnable reconnectTask = () -> {
            Log.d("SampleBridgeAndroid", "🔄 Attempting reconnection to " + deviceId + " (attempt " + (attempts + 1) + ")");
            
            try {
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                if (device != null) {
                    // Attempt reconnection
                    BluetoothGatt gatt = device.connectGatt(
                        getReactApplicationContext(),
                        false,
                        new BluetoothGattCallback() {
                            @Override
                            public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                                if (newState == BluetoothProfile.STATE_CONNECTED) {
                                    Log.d("SampleBridgeAndroid", "✅ Reconnected to: " + deviceId);
                                    reconnectAttempts.remove(deviceId);
                                    reconnectTasks.remove(deviceId);
                                    
                                    // Update device state
                                    DeviceData deviceData = deviceDataMap.get(deviceId);
                                    if (deviceData != null) {
                                        deviceData.connectionState = "connected";
                                        sendEvent("DeviceReconnected", createDeviceInfoMap(deviceData));
                                    }
                                } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                    Log.d("SampleBridgeAndroid", "❌ Reconnection failed for: " + deviceId);
                                    reconnectAttempts.put(deviceId, attempts + 1);
                                    
                                    // Schedule next attempt
                                    if (attempts < 5) { // Max 5 attempts
                                        scheduleReconnection(deviceId);
                                    } else {
                                        Log.d("SampleBridgeAndroid", "🛑 Max reconnection attempts reached for: " + deviceId);
                                        reconnectAttempts.remove(deviceId);
                                        reconnectTasks.remove(deviceId);
                                    }
                                }
                            }
                        }
                    );
                    connectedGatts.put(deviceId, gatt);
                }
            } catch (Exception e) {
                Log.e("SampleBridgeAndroid", "Reconnection error: " + e.getMessage());
            }
        };
        
        reconnectTasks.put(deviceId, reconnectTask);
        executorService.schedule(reconnectTask, backoffMs, TimeUnit.MILLISECONDS);
    }
    
    private void handleServicesDiscovered(BluetoothGatt gatt) {
        String deviceId = gatt.getDevice().getAddress();
        Log.d(TAG, "🔍 Handling service discovery for device: " + deviceId);
        
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            deviceData = new DeviceData(deviceId, gatt.getDevice().getName());
            deviceDataMap.put(deviceId, deviceData);
        }
        
        // Store services and characteristics
        List<BluetoothGattService> services = gatt.getServices();
        Log.d(TAG, "📋 Found " + services.size() + " services for device: " + deviceId);
        
        // ✅ Count notifications that need to be enabled
        int notificationsToEnable = 0;
        
        for (BluetoothGattService service : services) {
            String serviceUuid = service.getUuid().toString();
            Log.d(TAG, "📋 Service: " + serviceUuid);
            deviceData.services.put(serviceUuid, service);
            
            List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
            Log.d(TAG, "📋 Service " + serviceUuid + " has " + characteristics.size() + " characteristics");
            
            for (BluetoothGattCharacteristic characteristic : characteristics) {
                String charUuid = characteristic.getUuid().toString();
                Log.d(TAG, "📋 Characteristic: " + charUuid);
                
                String key = deviceId + "_" + charUuid;
                deviceCharacteristics.put(key, characteristic);
                deviceData.characteristics.put(charUuid, characteristic);
                
                // ✅ Enable notifications for ALL Smart Tag characteristics (matching iOS)
                if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                    charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    notificationsToEnable++;
                }
            }
        }
        
        // ✅ Initialize notification tracking for this device
        pendingNotificationEnables.put(deviceId, notificationsToEnable);
        completedNotificationEnables.put(deviceId, 0);
        Log.d(TAG, "📊 [NOTIFICATIONS] Will enable " + notificationsToEnable + " notifications for device: " + deviceId);
        
        // ✅ Fallback: If no notifications need to be enabled, trigger command sequence immediately
        if (notificationsToEnable == 0) {
            Log.d(TAG, "⚠️ [NOTIFICATIONS] No notifications to enable, starting command sequence immediately");
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    Log.d(TAG, "🕐 [NATIVE SEQUENCE] Step 0/3: Reading battery level...");
                    
                    // ✅ FIX: Explicitly read battery level to get immediate value
                    BluetoothGatt gatt = connectedGatts.get(deviceId);
                    if (gatt != null) {
                        BluetoothGattCharacteristic batteryChar = findCharacteristic(gatt, BATTERY_LEVEL_CHAR_UUID);
                        if (batteryChar != null) {
                            boolean readSuccess = gatt.readCharacteristic(batteryChar);
                            if (readSuccess) {
                                Log.d(TAG, "🔋 [BATTERY READ] Initiated explicit battery level read");
                            } else {
                                Log.w(TAG, "⚠️ [BATTERY READ] Failed to initiate read");
                            }
                        }
                    }
                    
                    // Wait for battery read to complete before sending time sync
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            Log.d(TAG, "🕐 [NATIVE SEQUENCE] Step 1/3: Sending time sync command...");
                            sendSetSystemTimeCommand(deviceId);
                        }
                    }, 300); // 300ms delay for battery read to complete
                }
            }, 500);
        } else {
            // ✅ Now enable notifications one by one
            for (BluetoothGattService service : services) {
                List<BluetoothGattCharacteristic> serviceCharacteristics = service.getCharacteristics();
                for (BluetoothGattCharacteristic characteristic : serviceCharacteristics) {
                    String charUuid = characteristic.getUuid().toString();
                    
                    // Enable notifications for ALL Smart Tag characteristics (matching iOS)
                    if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                        charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                        charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                        charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                        Log.d(TAG, "🔔 Enabling notifications for characteristic: " + charUuid);
                        enableNotificationsWithTracking(gatt, characteristic, deviceId);
                    }
                }
            }
        }
        
        // Check if this is a Smart Tag
        deviceData.isSmartTag = deviceData.services.containsKey(SMART_TAG_SERVICE_UUID);
        Log.d(TAG, "🏷️ Device " + deviceId + " isSmartTag: " + deviceData.isSmartTag);
        
        // Log all discovered services for debugging
        Log.d(TAG, "📋 All discovered services for device " + deviceId + ":");
        for (String serviceUuid : deviceData.services.keySet()) {
            Log.d(TAG, "📋   - " + serviceUuid);
        }
        
        // Log all discovered characteristics for debugging
        Log.d(TAG, "📋 All discovered characteristics for device " + deviceId + ":");
        for (String charUuid : deviceData.characteristics.keySet()) {
            Log.d(TAG, "📋   - " + charUuid);
        }
        
        // Send service discovery event
        sendEvent("ServicesDiscovered", createServiceInfoMap(deviceData));
        
        // ✅ NEW: Send ServiceDiscoveryComplete event to trigger native command sequence (matching iOS)
        Log.d(TAG, "✅ [DISCOVERY COMPLETE] ALL services discovered! Sending event to JS...");
        
        // Check what characteristics we have
        boolean hasSystemCommand = deviceData.characteristics.containsKey(SYSTEM_COMMAND_CHAR_UUID);
        boolean hasDeviceStatus = deviceData.characteristics.containsKey(DEVICE_STATUS_CHAR_UUID);
        boolean hasDataTransfer = deviceData.characteristics.containsKey(DATA_TRANSFER_CHAR_UUID);
        
        Log.d(TAG, "📋 [DISCOVERY COMPLETE] Found characteristics:");
        Log.d(TAG, "   - System Command: " + (hasSystemCommand ? "✅" : "❌"));
        Log.d(TAG, "   - Device Status: " + (hasDeviceStatus ? "✅" : "❌"));
        Log.d(TAG, "   - Data Transfer: " + (hasDataTransfer ? "✅" : "❌"));
        
        WritableMap discoveryCompleteEvent = Arguments.createMap();
        discoveryCompleteEvent.putString("deviceId", deviceId);
        discoveryCompleteEvent.putInt("totalServices", deviceData.services.size());
        discoveryCompleteEvent.putInt("totalCharacteristics", deviceData.characteristics.size());
        discoveryCompleteEvent.putBoolean("hasSystemCommand", hasSystemCommand);
        discoveryCompleteEvent.putBoolean("hasDeviceStatus", hasDeviceStatus);
        discoveryCompleteEvent.putBoolean("hasDataTransfer", hasDataTransfer);
        sendEvent("ServiceDiscoveryComplete", discoveryCompleteEvent);
        
        Log.d(TAG, "✅ [DISCOVERY COMPLETE] Event sent to JS - ready for command sequence");
        
        // Request initial data immediately since services are now discovered
        Log.d(TAG, "📊 Service discovery complete, requesting device data for: " + deviceId);
        requestDeviceData(deviceId);
    }
    
    private void requestDeviceData(String deviceId) {
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            Log.e(TAG, "Device data not found for: " + deviceId);
            return;
        }
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "GATT not found for: " + deviceId);
            return;
        }
        
        Log.d(TAG, "Requesting device data for: " + deviceId);
        Log.d(TAG, "📊 Device has " + deviceData.characteristics.size() + " characteristics");
        
        // Log all available characteristics for debugging
        for (String uuid : deviceData.characteristics.keySet()) {
            Log.d(TAG, "📋 Available characteristic: " + uuid);
        }
        
        // Read battery level if available
        BluetoothGattCharacteristic batteryChar = deviceData.characteristics.get(BATTERY_LEVEL_CHAR_UUID);
        if (batteryChar != null) {
            Log.d(TAG, "Reading battery level for: " + deviceId);
            gatt.readCharacteristic(batteryChar);
        }
        
        // Read device info characteristics
        BluetoothGattCharacteristic manufacturerChar = deviceData.characteristics.get(MANUFACTURER_NAME_CHAR_UUID);
        if (manufacturerChar != null) {
            Log.d(TAG, "Reading manufacturer name for: " + deviceId);
            gatt.readCharacteristic(manufacturerChar);
        }
        
        BluetoothGattCharacteristic modelChar = deviceData.characteristics.get(MODEL_NUMBER_CHAR_UUID);
        if (modelChar != null) {
            Log.d(TAG, "Reading model number for: " + deviceId);
            gatt.readCharacteristic(modelChar);
        }
        
        BluetoothGattCharacteristic firmwareChar = deviceData.characteristics.get(FIRMWARE_REVISION_CHAR_UUID);
        if (firmwareChar != null) {
            Log.d(TAG, "Reading firmware revision for: " + deviceId);
            gatt.readCharacteristic(firmwareChar);
        }
        
        // Read Smart Tag specific characteristics
        if (deviceData.isSmartTag) {
            BluetoothGattCharacteristic deviceStatusChar = deviceData.characteristics.get(DEVICE_STATUS_CHAR_UUID);
            if (deviceStatusChar != null) {
                Log.d(TAG, "📊 Reading device status for Smart Tag: " + deviceId + " - UUID: " + DEVICE_STATUS_CHAR_UUID);
                boolean readResult = gatt.readCharacteristic(deviceStatusChar);
                Log.d(TAG, "📊 Device status read initiated: " + readResult);
            } else {
                Log.w(TAG, "⚠️ Device status characteristic not found for Smart Tag: " + deviceId);
                Log.d(TAG, "📋 Available characteristics:");
                for (String charUuid : deviceData.characteristics.keySet()) {
                    Log.d(TAG, "📋   - " + charUuid);
                }
            }
            
            BluetoothGattCharacteristic dataTransferChar = deviceData.characteristics.get(DATA_TRANSFER_CHAR_UUID);
            if (dataTransferChar != null) {
                Log.d(TAG, "📡 Reading data transfer for Smart Tag: " + deviceId);
                gatt.readCharacteristic(dataTransferChar);
            }
            
            // Location data characteristic removed - not defined in SDD Table 8
        } else {
            Log.d(TAG, "📋 Device is not a Smart Tag, skipping Smart Tag specific characteristics");
        }
    }
    
    private void enableNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        
        String charUuid = characteristic.getUuid().toString();
        Log.d(TAG, "🔔 Enabling notification for: " + charUuid);
        
        boolean notificationResult = gatt.setCharacteristicNotification(characteristic, true);
        if (!notificationResult) {
            Log.e(TAG, "❌ setCharacteristicNotification failed for: " + charUuid);
            return;
        }
        
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        );
        if (descriptor != null) {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            boolean writeResult = gatt.writeDescriptor(descriptor);
            Log.d(TAG, "🔔 Descriptor write " + (writeResult ? "initiated" : "failed") + " for: " + charUuid);
        } else {
            Log.w(TAG, "⚠️ CCCD descriptor not found for: " + charUuid);
        }
    }
    
    /**
     * ✅ Enable notifications with tracking - triggers command sequence when all notifications are ready
     */
    /**
     * ✅ FIXED: Queue descriptor writes for SEQUENTIAL processing (Android BLE requirement)
     * Per Punch Through guide: Android BLE stack requires one descriptor write at a time
     */
    private void enableNotificationsWithTracking(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, String deviceId) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        
        String charUuid = characteristic.getUuid().toString();
        Log.d(TAG, "🔔 Queuing notification enable for: " + charUuid);
        
        // Step 1: Enable local notifications (immediate)
        boolean notificationResult = gatt.setCharacteristicNotification(characteristic, true);
        if (!notificationResult) {
            Log.e(TAG, "❌ setCharacteristicNotification failed for: " + charUuid);
            // Still count as complete (failed) so we don't block forever
            onNotificationEnabled(deviceId);
            return;
        }
        
        // Step 2: Queue descriptor write for SEQUENTIAL processing
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        );
        if (descriptor != null) {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            
            // ✅ Add to queue instead of writing immediately
            Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
            if (queue == null) {
                queue = new LinkedList<>();
                descriptorWriteQueues.put(deviceId, queue);
                isDescriptorWriteInProgress.put(deviceId, false);
            }
            
            queue.add(new DescriptorWriteRequest(gatt, characteristic, descriptor, deviceId, charUuid));
            Log.d(TAG, "📝 Queued descriptor write for: " + charUuid + " (queue size: " + queue.size() + ")");
            
            // ✅ Process queue if nothing in progress
            processDescriptorWriteQueue(deviceId);
        } else {
            Log.w(TAG, "⚠️ CCCD descriptor not found for: " + charUuid);
            // Count as complete (no descriptor to write)
            onNotificationEnabled(deviceId);
        }
    }
    
    /**
     * ✅ Called when a notification is enabled - checks if all are ready and triggers command sequence
     */
    private void onNotificationEnabled(String deviceId) {
        Integer completed = completedNotificationEnables.get(deviceId);
        Integer pending = pendingNotificationEnables.get(deviceId);
        
        if (completed == null || pending == null) {
            return;
        }
        
        completed++;
        completedNotificationEnables.put(deviceId, completed);
        
        Log.d(TAG, "📊 [NOTIFICATIONS] Progress: " + completed + "/" + pending + " enabled for device: " + deviceId);
        
        // ✅ All notifications enabled - trigger command sequence!
        if (completed >= pending) {
            Log.d(TAG, "✅ [NOTIFICATIONS] ALL notifications enabled! Starting command sequence...");
            
            // ✅ OPTIMIZED: Reduced delay from 1500ms to 750ms after testing
            // Per Punch Through guide: Android BLE needs time between operations
            // iOS doesn't need this because Core Bluetooth manages the queue automatically
            // TESTED: 750ms works reliably on Android 8-14
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    Log.d(TAG, "🕐 [NATIVE SEQUENCE] Step 0/3: Reading battery level...");
                    
                    // ✅ FIX: Explicitly read battery level to get immediate value
                    // (notifications will keep it updated, but we need initial value)
                    BluetoothGatt gatt = connectedGatts.get(deviceId);
                    if (gatt != null) {
                        BluetoothGattCharacteristic batteryChar = findCharacteristic(gatt, BATTERY_LEVEL_CHAR_UUID);
                        if (batteryChar != null) {
                            boolean readSuccess = gatt.readCharacteristic(batteryChar);
                            if (readSuccess) {
                                Log.d(TAG, "🔋 [BATTERY READ] Initiated explicit battery level read");
                            } else {
                                Log.w(TAG, "⚠️ [BATTERY READ] Failed to initiate read");
                            }
                        } else {
                            Log.w(TAG, "⚠️ [BATTERY READ] Battery characteristic not found");
                        }
                    }
                    
                    // Wait for battery read to complete before sending time sync
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            Log.d(TAG, "🕐 [NATIVE SEQUENCE] Step 1/3: Sending time sync command...");
                            Log.d(TAG, "⏰ [BLE STACK] Waited 750ms for BLE stack to settle after descriptor writes (optimized from 1500ms)");
                            sendSetSystemTimeCommand(deviceId);
                        }
                    }, 250); // 250ms delay for battery read to complete (optimized from 300ms)
                }
            }, 750); // 750ms delay to ensure BLE stack is ready (OPTIMIZED from 1500ms - tested on Android 8-14)
            
            // Clean up tracking
            pendingNotificationEnables.remove(deviceId);
            completedNotificationEnables.remove(deviceId);
        }
    }
    
    /**
     * ✅ Process descriptor write queue SEQUENTIALLY
     * Android BLE requires one write at a time - wait for callback before next write
     */
    private void processDescriptorWriteQueue(String deviceId) {
        Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
        Boolean inProgress = isDescriptorWriteInProgress.get(deviceId);
        
        if (queue == null || queue.isEmpty()) {
            Log.d(TAG, "📝 No more descriptors to write for: " + deviceId);
            return;
        }
        
        if (inProgress != null && inProgress) {
            Log.d(TAG, "📝 Descriptor write already in progress for: " + deviceId + ", queue size: " + queue.size());
            return;
        }
        
        // Get next write from queue
        DescriptorWriteRequest request = queue.peek();
        if (request == null) {
            return;
        }
        
        // Mark as in progress
        isDescriptorWriteInProgress.put(deviceId, true);
        
        // Perform the write
        Log.d(TAG, "📝 [SEQUENTIAL] Writing descriptor for: " + request.charUuid + " (queue: " + queue.size() + " remaining)");
        boolean writeResult = request.gatt.writeDescriptor(request.descriptor);
        
        if (!writeResult) {
            Log.e(TAG, "❌ [SEQUENTIAL] Descriptor write failed for: " + request.charUuid);
            // Remove from queue and mark as complete
            queue.poll();
            isDescriptorWriteInProgress.put(deviceId, false);
            onNotificationEnabled(deviceId);
            
            // Try next in queue
            processDescriptorWriteQueue(deviceId);
        } else {
            Log.d(TAG, "✅ [SEQUENTIAL] Descriptor write initiated for: " + request.charUuid);
            // Will be processed in onDescriptorWrite callback
        }
    }
    
    /**
     * ✅ Called from onDescriptorWrite callback - processes next descriptor in queue
     */
    private void onDescriptorWriteComplete(String deviceId, BluetoothGattDescriptor descriptor, int status) {
        Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
        if (queue == null || queue.isEmpty()) {
            Log.w(TAG, "⚠️ Descriptor write complete but queue is empty for: " + deviceId);
            isDescriptorWriteInProgress.put(deviceId, false);
            return;
        }
        
        // Remove completed write from queue
        DescriptorWriteRequest completedRequest = queue.poll();
        isDescriptorWriteInProgress.put(deviceId, false);
        
        if (completedRequest != null) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                Log.d(TAG, "✅ [SEQUENTIAL] Descriptor write SUCCESS for: " + completedRequest.charUuid);
                onNotificationEnabled(deviceId);
            } else {
                Log.e(TAG, "❌ [SEQUENTIAL] Descriptor write FAILED (status=" + status + ") for: " + completedRequest.charUuid);
                onNotificationEnabled(deviceId);
            }
        }
        
        // Process next descriptor in queue
        if (!queue.isEmpty()) {
            Log.d(TAG, "📝 [SEQUENTIAL] Processing next descriptor (" + queue.size() + " remaining)...");
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    processDescriptorWriteQueue(deviceId);
                }
            }, 100); // Small delay between writes for BLE stack stability
        } else {
            Log.d(TAG, "✅ [SEQUENTIAL] All descriptor writes complete for: " + deviceId);
        }
    }
    
    private void handleCharacteristicData(String deviceId, BluetoothGattCharacteristic characteristic) {
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            Log.e(TAG, "Device data not found for: " + deviceId);
            return;
        }
        
        String charUuid = characteristic.getUuid().toString();
        byte[] data = characteristic.getValue();
        
        Log.d(TAG, "📊 Handling characteristic data for " + deviceId + " - UUID: " + charUuid + ", Data length: " + (data != null ? data.length : 0));
        
        // ✅ CRITICAL FIX: Only send DeviceDataUpdated for characteristics that actually contain device data
        // Device Status and Battery Level have their own specialized update methods
        // System Command and Data Transfer should NOT send DeviceDataUpdated (they're control/metadata)
        
        if (charUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
            Log.d(TAG, "📊 Parsing device status data for: " + deviceId);
            parseDeviceStatusData(deviceData, data);
            // ✅ parseDeviceStatusData sends its own DeviceDataUpdated event with proper enriched data
            return;
            
        } else if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID)) {
            Log.d(TAG, "🔧 System command characteristic data received for: " + deviceId);
            Log.d(TAG, "🔧 Data length: " + (data != null ? data.length : 0) + " bytes");
            Log.d(TAG, "🔧 Data hex: " + (data != null ? bytesToHex(data) : "null"));
            parseSystemCommandResponse(deviceData, data);
            // ✅ System commands are just acknowledgments (BB 01 00 00) - no device data
            return;
            
        } else if (charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                deviceData.batteryLevel = data[0] & 0xFF;
                Log.d(TAG, "🔋 Battery level updated for " + deviceId + ": " + deviceData.batteryLevel + "%");
                
                // ✅ Send update for battery level change (safe - batteryLevel just assigned above)
                WritableMap batteryUpdate = Arguments.createMap();
                batteryUpdate.putString("deviceId", deviceData.deviceId);
                // Battery level is guaranteed to be non-null here since we just assigned it above
                batteryUpdate.putInt("batteryLevel", deviceData.batteryLevel);
                sendEvent("DeviceDataUpdated", batteryUpdate);
            }
            return;
            
        } else if (charUuid.equals(MANUFACTURER_NAME_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String manufacturerName = new String(data).trim();
                Log.d(TAG, "🏭 Manufacturer name for " + deviceId + ": " + manufacturerName);
            }
            return;
            
        } else if (charUuid.equals(MODEL_NUMBER_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String modelNumber = new String(data).trim();
                Log.d(TAG, "📱 Model number for " + deviceId + ": " + modelNumber);
            }
            return;
            
        } else if (charUuid.equals(FIRMWARE_REVISION_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String firmwareRevision = new String(data).trim();
                Log.d(TAG, "🔧 Firmware revision for " + deviceId + ": " + firmwareRevision);
            }
            return;
            
        } else if (charUuid.equals(DATA_TRANSFER_CHAR_UUID)) {
            Log.d(TAG, "📡 Parsing data transfer for " + deviceId + " - Data length: " + (data != null ? data.length : 0));
            parseDataTransferData(deviceData, data);
            // ✅ Data Transfer sends its own DataTransferEvent
            return;
            
        } else {
            Log.d(TAG, "❓ Unknown characteristic for " + deviceId + ": " + charUuid + " - Data length: " + (data != null ? data.length : 0));
            return;
        }
    }
    
    /**
     * Parse manufacturer data according to SDD Table 13
     * CRITICAL: Uses BIG-ENDIAN for record count and battery voltage (not Little-Endian!)
     * 
     * ⚠️ ANDROID SPECIFIC: Android's getManufacturerSpecificData(companyId) returns data WITHOUT company ID bytes!
     * So we receive 6 bytes, not 8 bytes. Company ID is already known (0x1234) from the query.
     * 
     * Format (6 bytes from Android API):
     * Byte 0: Indication to connect (1 = should connect)
     * Byte 1: Device functional status (0 = Good, 1 = Problem)
     * Byte 2-3: Number of records available (BIG-ENDIAN)
     * Byte 4-5: Battery value in milliVolts (BIG-ENDIAN)
     */
    private WritableMap parseManufacturerData(byte[] data) {
        WritableMap result = Arguments.createMap();
        
        // ✅ ANDROID: Expects 6 bytes (company ID already stripped by Android API)
        if (data == null || data.length < 6) {
            Log.w(TAG, "⚠️ Manufacturer data too short: " + (data != null ? data.length : 0) + " bytes (expected 6 for Android)");
            return result;
        }
        
        // Log raw data
        StringBuilder hex = new StringBuilder();
        for (byte b : data) {
            hex.append(String.format("%02X ", b));
        }
        Log.d(TAG, "🔍 RAW MANUFACTURER DATA (without company ID): " + hex.toString().trim());
        
        // ✅ ANDROID: Parse 6-byte format (company ID already known from getManufacturerSpecificData(0x1234))
        int companyId = 0x1234; // Company ID is known from the query
        
        // Byte 0: Indication to connect
        int indication = data[0] & 0xFF;
        
        // Byte 1: Device functional status (0 = Good, 1 = Problem)
        int deviceStatus = data[1] & 0xFF;
        
        // ✅ CRITICAL FIX: Manufacturer data uses BIG-ENDIAN (not Little-Endian!)
        // SDD Table 13 example: "0B B8" → 3000mV
        // This only works with Big-Endian: 0x0BB8 = 3000 ✅
        // Little-Endian would be: 0xB80B = 47115 ❌
        
        // Byte 2-3: Number of records available (BIG-ENDIAN)
        int recordCount = ((data[2] & 0xFF) << 8) | (data[3] & 0xFF);
        Log.d(TAG, "   📊 Record Count: " + recordCount + " (bytes: " + String.format("%02X %02X", data[2], data[3]) + ")");
        
        // Byte 4-5: Battery value in milliVolts (BIG-ENDIAN)
        int batteryMillivolts = ((data[4] & 0xFF) << 8) | (data[5] & 0xFF);
        Log.d(TAG, "   🔋 Battery: " + batteryMillivolts + "mV (bytes: " + String.format("%02X %02X", data[4], data[5]) + ")");
        
        // ⚠️ VALIDATION: Check for corrupted/test data
        boolean isCorrupted = false;
        String corruptionReason = "";
        
        // Check 1: Record count should be reasonable (0-1000 per SDD power profiling)
        if (recordCount > 1000) {
            isCorrupted = true;
            corruptionReason = "Record count too high: " + recordCount + " (max 1000)";
        }
        
        // Check 2: Battery voltage should be reasonable (2700-3300mV for LiPo)
        if (batteryMillivolts < 2000 || batteryMillivolts > 4500) {
            isCorrupted = true;
            corruptionReason = "Battery voltage invalid: " + batteryMillivolts + "mV (expected 2700-3300mV)";
        }
        
        if (isCorrupted) {
            Log.w(TAG, "⚠️ MANUFACTURER DATA VALIDATION FAILED!");
            Log.w(TAG, "   Reason: " + corruptionReason);
            Log.w(TAG, "   Using safe defaults: recordCount=0, battery=unknown");
        }
        
        // Use validated values
        int safeRecordCount = isCorrupted ? 0 : recordCount;
        int safeBatteryMv = (batteryMillivolts >= 2000 && batteryMillivolts <= 4500) ? batteryMillivolts : 3000;
        int batteryPercent = Math.min(100, Math.max(0, (int) ((safeBatteryMv - 2700.0) / 600.0 * 100.0)));
        
        Log.d(TAG, "   ✅ Parsed Values:");
        Log.d(TAG, "      Company ID: 0x" + String.format("%04X", companyId) + " (known from Android API query)");
        Log.d(TAG, "      Indication: " + indication + " (" + (indication == 1 ? "Should connect" : "Normal") + ")");
        Log.d(TAG, "      Record Count: " + safeRecordCount + " records");
        Log.d(TAG, "      Battery: " + safeBatteryMv + "mV (" + batteryPercent + "%)");
        Log.d(TAG, "      Status: " + (deviceStatus == 0 ? "Good ✅" : "Problem ⚠️"));
        
        // Build result map
        result.putInt("companyId", companyId);
        result.putInt("indication", indication);
        result.putInt("deviceStatus", deviceStatus);
        result.putInt("recordCount", safeRecordCount);
        result.putInt("rawRecordCount", recordCount);
        result.putInt("batteryMillivolts", safeBatteryMv);
        result.putInt("rawBatteryMillivolts", batteryMillivolts);
        result.putInt("batteryLevel", batteryPercent);
        result.putBoolean("isCorrupted", isCorrupted);
        result.putString("corruptionReason", isCorrupted ? corruptionReason : "");
        
        return result;
    }
    
    /**
     * ✅ MANUAL PARSER: Parse manufacturer data from raw advertisement bytes
     * According to Punch Through guide, sometimes Android's API doesn't work correctly
     * 
     * BLE Advertisement Structure:
     * [Length][Type][Data...]
     * 
     * Manufacturer Specific Data:
     * Type = 0xFF
     * Data = [Company ID Low][Company ID High][Actual Data...]
     * 
     * For company ID 0x1234 (Little-Endian in advertisement):
     * Looking for: [Length] 0xFF 0x34 0x12 [Data...]
     */
    private byte[] parseManufacturerDataFromRawBytes(byte[] scanRecordBytes, int targetCompanyId) {
        if (scanRecordBytes == null || scanRecordBytes.length < 5) {
            return null;
        }
        
        // Convert company ID to Little-Endian bytes for searching
        byte companyIdLow = (byte) (targetCompanyId & 0xFF);
        byte companyIdHigh = (byte) ((targetCompanyId >> 8) & 0xFF);
        
        Log.d(TAG, "🔍 [MANUAL PARSE] Searching for company ID 0x" + String.format("%04X", targetCompanyId) + 
              " (bytes: 0x" + String.format("%02X", companyIdLow) + " 0x" + String.format("%02X", companyIdHigh) + ")");
        
        int index = 0;
        while (index < scanRecordBytes.length) {
            // Each AD structure starts with length byte
            int length = scanRecordBytes[index] & 0xFF;
            
            if (length == 0) {
                // End of data
                break;
            }
            
            if (index + 1 + length > scanRecordBytes.length) {
                // Invalid length, would exceed buffer
                break;
            }
            
            // Type is the byte after length
            int type = scanRecordBytes[index + 1] & 0xFF;
            
            // Check if this is manufacturer specific data (0xFF)
            if (type == 0xFF && length >= 3) {
                // Check if company ID matches (Little-Endian)
                byte lowByte = scanRecordBytes[index + 2];
                byte highByte = scanRecordBytes[index + 3];
                
                if (lowByte == companyIdLow && highByte == companyIdHigh) {
                    // Found our manufacturer data!
                    int dataLength = length - 3; // Subtract type byte (1) and company ID (2)
                    byte[] manufacturerData = new byte[dataLength];
                    System.arraycopy(scanRecordBytes, index + 4, manufacturerData, 0, dataLength);
                    
                    Log.d(TAG, "✅ [MANUAL PARSE] Found manufacturer data at offset " + index + 
                          ", length: " + dataLength + " bytes");
                    return manufacturerData;
                }
            }
            
            // Move to next AD structure (1 byte for length + length bytes of data)
            index += 1 + length;
        }
        
        Log.d(TAG, "❌ [MANUAL PARSE] Company ID 0x" + String.format("%04X", targetCompanyId) + " not found in scan record");
        return null;
    }
    
    private void parseDeviceStatusData(DeviceData deviceData, byte[] data) {
        if (data == null || data.length < 8) {
            Log.w(TAG, "Invalid device status data length: " + (data != null ? data.length : 0) + ", expected at least 8 bytes");
            return;
        }
        
        // Handle both 8-byte compact format and 20-byte full format
        if (data.length == 8) {
            Log.d(TAG, "📊 Parsing 8-byte compact device status format");
            parseCompactDeviceStatusData(deviceData, data);
            return;
        } else if (data.length < DEVICE_STATUS_SIZE) {
            Log.w(TAG, "Unexpected device status data length: " + data.length + ", expected 8 or " + DEVICE_STATUS_SIZE + " bytes");
            return;
        }
        
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // Parse according to SDD DEVICE_STATUS_LAYOUT (Little Endian format)
        // [0-3] Timestamp (4 bytes), [4-5] Steps (2 bytes), [6] Temperature (1 byte), [7] Flags (1 byte), [8-19] Reserved (12 bytes)
        
        // Parse timestamp (4 bytes) - Keep as Unix seconds to match iOS BLEDataParser.js
        long timestampSeconds = buffer.getInt() & 0xFFFFFFFFL;
        deviceData.timestamp = timestampSeconds; // Store as Unix seconds, not milliseconds
        
        // Parse steps (2 bytes)
        deviceData.steps = buffer.getShort() & 0xFFFF; // Convert to unsigned int
        
        // Convert timestamp to readable date for debugging
        java.util.Date timestampDate = new java.util.Date(timestampSeconds * 1000);
        java.util.Date currentDate = new java.util.Date();
        long timeDiff = (currentDate.getTime() / 1000) - timestampSeconds;
        
        // Check if device RTC is synchronized
        boolean isRTCValid = timestampSeconds > 1577836800L; // After 2020-01-01
        String syncState = dataSyncState.getOrDefault(deviceData.deviceId, "unknown");
        
        // Count notifications for debugging (matching iOS)
        Integer currentCount = deviceStatusNotificationCount.get(deviceData.deviceId);
        int notificationNum = (currentCount != null ? currentCount : 0) + 1;
        deviceStatusNotificationCount.put(deviceData.deviceId, notificationNum);
        
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "📊 [DEVICE STATUS #" + notificationNum + "] Notification received");
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "   Device: " + deviceData.deviceId);
        Log.d(TAG, "   Raw data: " + bytesToHex(data));
        Log.d(TAG, "   Timestamp: " + timestampSeconds + " → " + timestampDate);
        Log.d(TAG, "   Time diff from now: " + timeDiff + "s (" + (timeDiff/3600.0) + " hours)");
        Log.d(TAG, "   RTC Valid: " + (isRTCValid ? "✅ YES (Live data)" : "❌ NO (Cached/old data)"));
        
        // Parse temperature (1 byte) - SDD specifies 1 byte raw value (no offset/scaling)
        int temperatureRaw = buffer.get() & 0xFF; // Convert to unsigned int
        deviceData.temperature = temperatureRaw; // Use raw value directly as per SDD Table 12
        
        // Parse flags (1 byte)
        int flags = buffer.get() & 0xFF; // Convert to unsigned int
        
        Log.d(TAG, "   Steps: " + deviceData.steps + ", Temperature: " + deviceData.temperature + "°C, Flags: 0x" + String.format("%02X", flags));
        Log.d(TAG, "   Sync State: " + syncState);
        Log.d(TAG, "   Data Source: " + (isRTCValid ? "LIVE 🔴" : "CACHED 📦"));
        
        // ✅ Log time since last notification (matching iOS)
        if (notificationNum > 1) {
            Log.d(TAG, "   ⏱️ This is notification #" + notificationNum + " for this session");
        }
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        
        // Convert timestamp to milliseconds for JavaScript (matching iOS behavior)
        long timestampMs = timestampSeconds * 1000L;
        
        // Update the timestamp to milliseconds for JavaScript consumption
        deviceData.timestamp = timestampMs;
        
        // ✅ CRITICAL FIX: Send simple Android event format (backward compatible)
        // JavaScript handleAndroidDeviceDataUpdated expects: {deviceId, batteryLevel, steps, temperature, timestamp}
        WritableMap simpleDeviceData = Arguments.createMap();
        simpleDeviceData.putString("deviceId", deviceData.deviceId);
        // ✅ FIX: Only send battery level if it has been read, otherwise send null
        if (deviceData.batteryLevel != null) {
            simpleDeviceData.putInt("batteryLevel", deviceData.batteryLevel);
        } else {
            simpleDeviceData.putNull("batteryLevel");
        }
        simpleDeviceData.putInt("steps", deviceData.steps);
        simpleDeviceData.putInt("temperature", (int) deviceData.temperature);
        simpleDeviceData.putDouble("timestamp", timestampMs); // Device RTC timestamp in ms
        
        // Send data update event to JavaScript (matching existing Android format)
        Log.d(TAG, "📤 Sending device data update event for: " + deviceData.deviceId + 
              " - Steps: " + deviceData.steps + ", Temp: " + deviceData.temperature + "°C, RTC Valid: " + isRTCValid);
        sendEvent("DeviceDataUpdated", simpleDeviceData);
    }
    
    private void parseCompactDeviceStatusData(DeviceData deviceData, byte[] data) {
        Log.d(TAG, "📊 Parsing compact device status data - Raw data length: " + data.length);
        Log.d(TAG, "📊 Raw data hex: " + bytesToHex(data));
        
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // Parse 8-byte compact format: [timestamp(4)] [steps(2)] [temperature(1)] [flags(1)]
        // Parse timestamp (4 bytes) - Keep as Unix seconds to match iOS BLEDataParser.js
        int timestampSeconds = buffer.getInt();
        
        // Validate timestamp - if it's clearly invalid (before 2020), use current time
        long currentTimeSeconds = System.currentTimeMillis() / 1000;
        boolean isValidTimestamp = timestampSeconds > 1577836800; // After 2020-01-01
        
        if (!isValidTimestamp) {
            Log.w(TAG, "⚠️ Invalid timestamp detected in compact format: " + timestampSeconds + ", using current time");
            timestampSeconds = (int) currentTimeSeconds;
        }
        
        deviceData.timestamp = timestampSeconds; // Store as Unix seconds, not milliseconds
        
        // Parse steps (2 bytes)
        deviceData.steps = buffer.getShort() & 0xFFFF; // Convert to unsigned int
        
        // Parse temperature (1 byte) - SDD specifies 1 byte raw value (no offset/scaling)
        int temperatureRaw = buffer.get() & 0xFF; // Convert to unsigned int
        
        // Parse flags (1 byte)
        int flags = buffer.get() & 0xFF; // Convert to unsigned int
        
        // Convert temperature according to SDD Table 12 - 1 byte raw value (no offset/scaling)
        deviceData.temperature = temperatureRaw;
        
        // Convert timestamp to milliseconds for JavaScript (matching iOS behavior)
        long timestampMs = timestampSeconds * 1000L;
        
        Log.d(TAG, "📊 Parsed compact device data - Steps: " + deviceData.steps + 
              ", Temp: " + deviceData.temperature + "°C, Timestamp: " + timestampSeconds + 
              "s (" + timestampMs + "ms), Flags: " + flags);
        
        // Update the timestamp to milliseconds for JavaScript consumption
        deviceData.timestamp = timestampMs;
        
        // ✅ CRITICAL FIX: Send simple Android event format (backward compatible)
        // JavaScript handleAndroidDeviceDataUpdated expects: {deviceId, batteryLevel, steps, temperature, timestamp}
        WritableMap simpleDeviceData = Arguments.createMap();
        simpleDeviceData.putString("deviceId", deviceData.deviceId);
        // ✅ FIX: Only send battery level if it has been read, otherwise send null
        if (deviceData.batteryLevel != null) {
            simpleDeviceData.putInt("batteryLevel", deviceData.batteryLevel);
        } else {
            simpleDeviceData.putNull("batteryLevel");
        }
        simpleDeviceData.putInt("steps", deviceData.steps);
        simpleDeviceData.putInt("temperature", (int) deviceData.temperature);
        simpleDeviceData.putDouble("timestamp", timestampMs); // Device RTC timestamp in ms
        
        // Send data update event to JavaScript (matching existing Android format)
        Log.d(TAG, "📤 Sending compact device data update event for: " + deviceData.deviceId + 
              " - Steps: " + deviceData.steps + ", Temp: " + deviceData.temperature + "°C, RTC Valid: " + isValidTimestamp);
        sendEvent("DeviceDataUpdated", simpleDeviceData);
    }
    
    private void parseDataTransferData(DeviceData deviceData, byte[] data) {
        if (data == null || data.length < 1) {
            Log.w(TAG, "Invalid data transfer data length: " + (data != null ? data.length : 0) + ", expected at least 1 byte");
            return;
        }
        
        // ✅ Check if we actually requested data sync (matching iOS filtering)
        Boolean wasRequested = dataSyncRequested.get(deviceData.deviceId);
        boolean isRequested = (wasRequested != null && wasRequested);
        
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "🔍 RAW DATA TRANSFER ANALYSIS");
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "Device: " + deviceData.deviceId);
        Log.d(TAG, "Data Sync Requested: " + (isRequested ? "YES ✅" : "NO ❌ (UNSOLICITED)"));
        Log.d(TAG, "Total data length: " + data.length + " bytes");
        
        // Show ALL bytes received
        StringBuilder allBytes = new StringBuilder();
        for (int i = 0; i < data.length; i++) {
            allBytes.append(String.format("[%d]:%02X ", i, data[i]));
        }
        Log.d(TAG, "All bytes: " + allBytes.toString().trim());
        
        // ✅ IGNORE unsolicited data (matching iOS behavior)
        if (!isRequested) {
            Log.w(TAG, "⚠️ IGNORING UNSOLICITED DATA TRANSFER!");
            Log.w(TAG, "   This is auto-transmitted cached/test data from device");
            Log.w(TAG, "   Waiting for explicit data sync request after time sync");
            Log.w(TAG, "═══════════════════════════════════════════════════════");
            return;
        }
        
        Log.d(TAG, "📡 Parsing data transfer data - Raw data length: " + data.length);
        Log.d(TAG, "📡 Raw data hex: " + bytesToHex(data));
        
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // First byte is the transfer type
        byte transferType = buffer.get();
        Log.d(TAG, "Byte [0] DataType: 0x" + String.format("%02X", transferType) + " (" + transferType + ")");
        
        switch (transferType) {
            case DATA_TRANSFER_SYNC_START:
                parseSyncStartData(deviceData, buffer);
                break;
                
            case DATA_TRANSFER_SYNC_COMPLETE:
                parseSyncCompleteData(deviceData, buffer);
                break;
                
            case DATA_TRANSFER_RECORD:
                parseDataRecordData(deviceData, buffer);
                break;
                
            case DATA_TRANSFER_READ_ERROR:
                parseReadErrorData(deviceData, buffer);
                break;
                
            default:
                Log.w(TAG, "Unknown data transfer type: 0x" + String.format("%02X", transferType));
                break;
        }
    }
    
    private void parseSyncStartData(DeviceData deviceData, ByteBuffer buffer) {
        Log.d(TAG, "📈 Data Sync Start notification received");
        
        if (buffer.remaining() < 5) {  // ✅ Need Length(1) + TotalRecords(4) = 5 bytes
            Log.e(TAG, "❌ Data Sync Start payload too short: " + buffer.remaining() + " bytes");
            return;
        }
        
        // ✅ CRITICAL FIX: Skip the Length byte (SDD Table 13 format: DataType | Length | TotalRecords)
        // DataType was already consumed by the switch statement
        byte length = buffer.get();  // Read and skip Length byte
        
        // Update state (matching iOS)
        dataSyncState.put(deviceData.deviceId, "syncing");
        
        int totalRecords = buffer.getInt();
        
        // Log detailed info (matching iOS)
        Log.d(TAG, "   Payload length: 4 bytes");
        byte[] payloadBytes = new byte[4];
        buffer.position(buffer.position() - 4); // Reset position to re-read
        buffer.get(payloadBytes);
        Log.d(TAG, "   Raw bytes: " + String.format("0x%02X 0x%02X 0x%02X 0x%02X", 
            payloadBytes[0], payloadBytes[1], payloadBytes[2], payloadBytes[3]));
        Log.d(TAG, "   Parsed as LE uint32: " + totalRecords);
        
        // Validate record count
        if (totalRecords > 100000 || totalRecords < 0) {
            Log.w(TAG, "⚠️ DETECTED TEST/GARBAGE DATA FROM DEVICE!");
            Log.w(TAG, "   This appears to be invalid test data");
            Log.w(TAG, "   Device may not have real data or firmware needs update");
            Log.w(TAG, "   Setting record count to 0");
            totalRecords = 0;
        }
        
        if (totalRecords > 1000) {
            Log.w(TAG, "⚠️ Warning: Unusually high record count: " + totalRecords);
            Log.w(TAG, "   This may indicate data corruption or device issue");
        }
        
        Log.d(TAG, "✅ Data Sync Started - Device will send " + totalRecords + " records");
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        
        // Send event to JavaScript
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "sync_start");
        eventData.putInt("totalRecords", totalRecords);
        eventData.putString("deviceId", deviceData.deviceId);
        sendEvent("DataTransferEvent", eventData);
    }
    
    private void parseSyncCompleteData(DeviceData deviceData, ByteBuffer buffer) {
        Log.d(TAG, "📈 Data Sync Complete notification received");
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        
        if (buffer.remaining() < 3) {  // ✅ Need Length(1) + Value(2) = 3 bytes
            Log.e(TAG, "❌ Data Sync Complete payload too short: " + buffer.remaining() + " bytes");
            Log.d(TAG, "═══════════════════════════════════════════════════════");
            return;
        }
        
        // ✅ CRITICAL FIX: Skip the Length byte (SDD Table 13 format: DataType | Length | Value)
        // DataType was already consumed by the switch statement
        byte length = buffer.get();  // Read and skip Length byte
        Log.d(TAG, "   Payload length: " + length + " bytes");
        
        // Now read the actual value (2 bytes, Little-Endian)
        int value = buffer.getShort() & 0xFFFF;
        final String deviceId = deviceData.deviceId;
        
        // 🔍 DEBUG: Log the value to see which branch should be taken
        Log.d(TAG, "🔍 [DEBUG] Sync Complete Value: 0x" + String.format("%04X", value) + " (" + value + " decimal)");
        Log.d(TAG, "🔍 [DEBUG] Checking conditions:");
        Log.d(TAG, "🔍 [DEBUG]   - Is 0xFFFF? " + (value == 0xFFFF));
        Log.d(TAG, "🔍 [DEBUG]   - Is >= 0x0001 && <= 0x01F4? " + (value >= 0x0001 && value <= 0x01F4));
        
        // ✅ Update state to complete (matching iOS)
        dataSyncState.put(deviceId, "complete");
        
        // Clear retry counter and timers (matching iOS)
        dataSyncRetryCount.remove(deviceId);
        ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
        if (syncTimer != null) {
            syncTimer.cancel(false);
            dataSyncTimers.remove(deviceId);
        }
        
        if (value == 0xFFFF) {
            Log.d(TAG, "❌ Data Sync Complete - Force termination (0xFFFF)");
            Log.d(TAG, "🔍 [DEBUG] Taking FORCE TERMINATION branch");
                
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", "sync_complete");
                eventData.putBoolean("success", false);
                eventData.putString("reason", "force_termination");
                eventData.putString("deviceId", deviceId);
                sendEvent("DataTransferEvent", eventData);
                
                // ✅ SDD REQUIREMENT: Send DATA_SYNC_STOP without clearing flash (sync failed)
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    byte[] stopPayload = new byte[]{0x00}; // Don't clear flash - can retry
                    sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
                    Log.d(TAG, "⚠️ DATA_SYNC_STOP sent - flash NOT cleared (can retry)");
                }, 1000); // Wait 1 second
                
            } else if (value >= 0x0001 && value <= 0x01F4) {
                Log.d(TAG, "🔍 [DEBUG] Taking SUCCESSFUL SYNC branch (value=" + value + ")");

                Log.d(TAG, "✅ Data Sync Complete - " + value + " records transmitted successfully");
                Log.d(TAG, "📊 Total records received: " + value);
                Log.d(TAG, "═══════════════════════════════════════════════════════");
                
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", "sync_complete");
                eventData.putBoolean("success", true);
                eventData.putInt("recordsTransmitted", value);
                eventData.putString("deviceId", deviceId);
                sendEvent("DataTransferEvent", eventData);
                
                // ✅ SDD REQUIREMENT: Send DATA_SYNC_STOP with Clear Flash flag after successful sync
                // According to SDD Table 9: 0x01 = Clear Flash Data (sync successful)
                Log.d(TAG, "🧹 [AUTO CLEANUP] Sending DATA_SYNC_STOP to clear flash...");
                
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    byte[] stopPayload = new byte[]{0x01}; // Clear flash after successful sync
                    boolean success = sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
                    
                    if (success) {
                        Log.d(TAG, "✅ DATA_SYNC_STOP sent - flash will be cleared");
                    } else {
                        Log.e(TAG, "❌ Failed to send DATA_SYNC_STOP command");
                    }
                    
                    // ✅ CONTINUE NATIVE SEQUENCE: Setup live mode after sync complete
                    // Wait additional 1.5 seconds for DATA_SYNC_STOP response before setting up live mode
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            Log.d(TAG, "💾 [SYNC COMPLETE] Updated UI with latest synced data");
                            Log.d(TAG, "🔴 [LIVE READY] Device now ready for notifications");
                            Log.d(TAG, "⏱️ Setting Data Acquisition Interval to 30 seconds");
                            
                            // Send SET_DATA_ACQUISITION_INTERVAL command (0x04) with 30 seconds
                            long intervalSeconds = 30;
                            byte[] intervalPayload = new byte[4];
                            intervalPayload[0] = (byte) (intervalSeconds & 0xFF);
                            intervalPayload[1] = (byte) ((intervalSeconds >> 8) & 0xFF);
                            intervalPayload[2] = (byte) ((intervalSeconds >> 16) & 0xFF);
                            intervalPayload[3] = (byte) ((intervalSeconds >> 24) & 0xFF);
                            
                            boolean intervalSuccess = sendSystemCommand(deviceId, CMD_SET_DATA_INTERVAL, intervalPayload);
                            
                            if (intervalSuccess) {
                                Log.d(TAG, "✅ Data Acquisition Interval command sent successfully");
                            } else {
                                Log.e(TAG, "❌ Failed to send Data Acquisition Interval command");
                            }
                        }
                    }, 1500); // Wait 1.5 seconds for DATA_SYNC_STOP response
                }, 1000); // Wait 1 second before sending cleanup command
            } else {
                // 🔍 DEBUG: Neither branch was taken - this should NOT happen!
                Log.e(TAG, "❌ [DEBUG] UNEXPECTED: Value 0x" + String.format("%04X", value) + " (" + value + ") doesn't match any condition!");
                Log.e(TAG, "❌ [DEBUG] This means DATA_SYNC_STOP will NOT be sent!");
            }
    }
    
    private void parseDataRecordData(DeviceData deviceData, ByteBuffer buffer) {
        Log.d(TAG, "📋 Record Data");
        
        // ✅ CRITICAL FIX: Skip the Length byte (SDD Table 13 format: DataType | Length | Payload)
        // DataType was already consumed by the switch statement
        if (buffer.remaining() < 1) {
            Log.e(TAG, "❌ Record Data missing Length byte");
            return;
        }
        
        byte length = buffer.get();  // Read and skip Length byte
        Log.d(TAG, "   Payload length: " + length + " bytes");
        
        // ✅ FIXED: SDD Table 12 format - 1 set of records contains 8 bytes
        // Format per SDD: [Timestamp(4)] [Steps(2)] [Temperature(1)] [Flags(1)]
        int remainingBytes = buffer.remaining();
        
        if (remainingBytes < 8) {
            Log.e(TAG, "❌ Record Data payload too short: " + remainingBytes + " bytes (expected " + length + ")");
            return;
        }
        
        // Parse multiple records if present (each record is 8 bytes as per SDD)
        List<WritableMap> records = new ArrayList<>();
        
        while (buffer.remaining() >= 8) {
            // ✅ CORRECT BYTE ORDER per SDD Table 12:
            int timestamp = buffer.getInt();           // 4 bytes: Timestamp (LE)
            int steps = buffer.getShort() & 0xFFFF;    // 2 bytes: Steps counter (LE)
            int temperature = buffer.get() & 0xFF;     // 1 byte: Temperature (raw value, no scaling)
            int flags = buffer.get() & 0xFF;           // 1 byte: Device status flags
            
            // Convert timestamp to readable date
            java.util.Date date = new java.util.Date(timestamp * 1000L);
            java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            String dateString = formatter.format(date);
            
            WritableMap record = Arguments.createMap();
            record.putInt("timestamp", timestamp);
            record.putString("timestampDate", dateString);
            record.putInt("steps", steps);
            record.putInt("temperature", temperature);
            record.putInt("flags", flags);
            
            records.add(record);
            
            Log.d(TAG, "   Record " + records.size() + ": " + dateString + " - Temp: " + temperature + "°C, Steps: " + steps);
        }
        
        Log.d(TAG, "✅ Received " + records.size() + " health records");
        
        // ✅ FIX: Build WritableArray manually (Arguments.fromList doesn't support WritableMap)
        WritableArray recordsArray = Arguments.createArray();
        for (WritableMap record : records) {
            recordsArray.pushMap(record);
        }
        
        // Send event to JavaScript
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "record");
        eventData.putArray("records", recordsArray);
        eventData.putInt("recordCount", records.size());
        eventData.putString("deviceId", deviceData.deviceId);
        sendEvent("DataTransferEvent", eventData);
    }
    
    private void parseReadErrorData(DeviceData deviceData, ByteBuffer buffer) {
        // ✅ CRITICAL FIX: Skip the Length byte (SDD Table 13 format: DataType | Length | ErrorCode)
        // DataType was already consumed by the switch statement
        if (buffer.remaining() < 2) {  // Need Length(1) + ErrorCode(1)
            Log.e(TAG, "❌ Read Error payload too short");
            return;
        }
        
        byte length = buffer.get();  // Read and skip Length byte
        byte errorCode = buffer.get();
        Log.d(TAG, "📡 Data Read Error - Payload length: " + length + ", Error code: 0x" + String.format("%02X", errorCode));
        
        // Send event to JavaScript
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "read_error");
        eventData.putInt("errorCode", errorCode & 0xFF);
        eventData.putString("deviceId", deviceData.deviceId);
        sendEvent("DataTransferEvent", eventData);
    }
    
    private void sendDeviceDataUpdateEvent(DeviceData deviceData) {
        WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
        Log.d(TAG, "📤 DeviceInfoMap contents: " + deviceInfoMap.toString());
        sendEvent("DeviceDataUpdated", deviceInfoMap);
        
        // Also trigger health data API call from native side
        Log.d(TAG, "📤 Triggering health data API call from native side for device: " + deviceData.deviceId);
        sendHealthDataApiEvent(deviceData.deviceId, deviceInfoMap);
    }
    
    /**
     * Helper to get command name from command ID (matching iOS implementation)
     */
    private String getCommandName(int commandId) {
        switch (commandId) {
            case CMD_SET_SYSTEM_TIME: return "SET_SYSTEM_TIME";
            case CMD_SET_DATA_INTERVAL: return "SET_DATA_ACQUISITION_INTERVAL";
            case CMD_GET_FW_VERSION: return "GET_FW_VERSION";
            case CMD_GET_HW_VERSION: return "GET_HW_VERSION";
            case CMD_GET_DIAGNOSTICS: return "GET_DIAGNOSTICS";
            case CMD_DATA_SYNC_START: return "DATA_SYNC_START";
            case CMD_DATA_SYNC_STOP: return "DATA_SYNC_STOP";
            case CMD_SYSTEM_RESTART: return "SYSTEM_RESTART";
            case CMD_TOGGLE_BUZZER: return "TOGGLE_BUZZER";
            default: return "UNKNOWN_COMMAND_0x" + String.format("%02X", commandId);
        }
    }
    
    private String bytesToHex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) {
            result.append(String.format("%02x", b));
        }
        return result.toString();
    }
    
    private void parseSystemCommandResponse(DeviceData deviceData, byte[] data) {
        if (data == null || data.length < 4) {
            Log.w(TAG, "Invalid system command response length: " + (data != null ? data.length : 0) + ", expected at least 4 bytes");
            return;
        }
        
        Log.d(TAG, "🔧 Parsing system command response - Raw data hex: " + bytesToHex(data));
        
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // Parse system command response according to SDD format
        // Format: [ResponseID][CommandID][ResponseLength][ResponseStatus][ResponseData...]
        byte responseId = buffer.get();
        byte commandId = buffer.get();
        byte responseLength = buffer.get();
        byte responseStatus = buffer.get();
        
        Log.d(TAG, "🔧 System command response - ResponseID: 0x" + String.format("%02x", responseId) + 
              ", CommandID: 0x" + String.format("%02x", commandId) + 
              ", Length: " + responseLength + 
              ", Status: 0x" + String.format("%02x", responseStatus));
        
        // Validate response ID (should be 0xBB according to SDD)
        if (responseId != RESPONSE_ID) {
            Log.w(TAG, "Invalid response ID: 0x" + String.format("%02x", responseId) + ", expected 0x" + String.format("%02x", RESPONSE_ID));
            return;
        }
        
        // Check if command was successful
        if (responseStatus != 0x00) {
            Log.w(TAG, "System command failed with status: 0x" + String.format("%02x", responseStatus));
            return;
        }
        
        // ✅ CRITICAL FIX: Handle specific command types OUTSIDE the responseLength check
        // Most successful responses have Length=0 (BB 01 00 00), so we need to handle them here!
        switch (commandId) {
            case CMD_SET_SYSTEM_TIME:
                    Log.d(TAG, "✅ Set System Time command successful");
                    
                    // ✅ NATIVE OWNS COMMAND SEQUENCE: After time sync success, trigger data sync
                    dataSyncState.put(deviceData.deviceId, "ready");
                    
                    Log.d(TAG, "⏰ [TIME SYNC] Waiting 10 seconds for device RTC update & flash write...");
                    
                    // Wait 10 seconds for device to stabilize after time sync
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            Log.d(TAG, "🔄 [NATIVE SEQUENCE] Device ready after time sync, initiating data sync...");
                            Log.d(TAG, "⏰ [NATIVE SEQUENCE] Waited 10 seconds for device to stabilize");
                            
                            // Reset retry counter
                            dataSyncRetryCount.put(deviceData.deviceId, 0);
                            
                            // Attempt data sync
                            boolean success = sendDataSyncStartCommand(deviceData.deviceId, 0);
                            
                            if (success) {
                                Log.d(TAG, "✅ [NATIVE SEQUENCE] Data sync command sent successfully");
                            } else {
                                Log.e(TAG, "❌ [NATIVE SEQUENCE] Data sync command failed");
                            }
                        }
                    }, 10000); // 10 seconds delay
                    break;
                    
            case CMD_SET_DATA_INTERVAL:
                Log.d(TAG, "✅ Set Data Acquisition Interval command successful");
                Log.d(TAG, "✅ Live updates enabled!");
                Log.d(TAG, "⏳ Wait 30 seconds...");
                Log.d(TAG, "🔴 [LIVE UPDATES] Device will now send Device Status notifications periodically");
                Log.d(TAG, "   Expected frequency: Based on configured interval");
                Log.d(TAG, "   Watch for: 📊 [DEVICE STATUS #2+] with valid 2025 timestamps");
                
                // ✅ WORKAROUND: Start periodic polling since firmware doesn't auto-notify
                startDeviceStatusPolling(deviceData.deviceId, 30); // 30 seconds interval
                break;
                
            case CMD_DATA_SYNC_START:
                Log.d(TAG, "✅ Data sync started successfully");
                dataSyncState.put(deviceData.deviceId, "syncing");
                dataSyncRetryCount.remove(deviceData.deviceId); // Clear retry count on success
                break;
                
            case CMD_DATA_SYNC_STOP:
                if (responseStatus == 0x00) {
                    Log.d(TAG, "✅ Data Sync Stopped - Flash cleared successfully");
                } else {
                    Log.w(TAG, "⚠️ Data Sync Stop returned status: 0x" + String.format("%02X", responseStatus));
                    Log.w(TAG, "   This is expected if device auto-clears flash or doesn't support this command");
                    Log.w(TAG, "   Device may handle flash management automatically");
                }
                break;
                
            case CMD_GET_DIAGNOSTICS:
                Log.d(TAG, "✅ Diagnostics response received");
                break;
                
            case CMD_GET_FW_VERSION:
                Log.d(TAG, "✅ Firmware version response received");
                break;
                
            case CMD_GET_HW_VERSION:
                Log.d(TAG, "✅ Hardware version response received");
                break;
                
            case CMD_SYSTEM_RESTART:
                Log.d(TAG, "✅ System restart command acknowledged");
                break;
                
            case CMD_TOGGLE_BUZZER:
                Log.d(TAG, "✅ Buzzer toggled successfully");
                break;
                
            default:
                Log.d(TAG, "ℹ️ Unknown command response: 0x" + String.format("%02X", commandId));
                break;
        }
        
        // ✅ Optional: Send detailed response data if present (for commands like GET_FW_VERSION)
        if (responseLength > 0) {
            byte[] responseData = new byte[responseLength];
            buffer.get(responseData);
            
            Log.d(TAG, "📊 Command response data: " + bytesToHex(responseData));
            
            // Send to JavaScript for processing
            WritableMap systemResponseData = Arguments.createMap();
            systemResponseData.putString("type", "system_command_response");
            systemResponseData.putString("deviceId", deviceData.deviceId);
            systemResponseData.putInt("commandId", commandId);
            systemResponseData.putString("commandName", getCommandName(commandId));
            systemResponseData.putString("rawData", bytesToHex(responseData));
            systemResponseData.putInt("dataLength", responseData.length);
            systemResponseData.putInt("responseStatus", responseStatus);
            systemResponseData.putInt("status", responseStatus);
            sendEvent("SystemCommandEvent", systemResponseData);
        }
    }
    
    // ✅ REMOVED: Duplicate buildSystemCommandPacket(int, ReadableArray) 
    // Now using consolidated version: buildSystemCommandPacket(byte, byte[])
    // @ReactMethod sendSystemCommand converts ReadableArray to byte[] internally
    
    private WritableMap createServiceInfoMap(DeviceData deviceData) {
        WritableMap map = Arguments.createMap();
        map.putString("deviceId", deviceData.deviceId);
        map.putString("deviceName", deviceData.deviceName);
        map.putBoolean("isSmartTag", deviceData.isSmartTag);
        map.putString("connectionState", deviceData.connectionState);
        
        // Include services information for ServicesDiscovered event
        WritableArray servicesArray = Arguments.createArray();
        for (String serviceUuid : deviceData.services.keySet()) {
            BluetoothGattService service = deviceData.services.get(serviceUuid);
            if (service != null) {
                WritableMap serviceMap = Arguments.createMap();
                serviceMap.putString("uuid", serviceUuid);
                serviceMap.putBoolean("isPrimary", service.getType() == BluetoothGattService.SERVICE_TYPE_PRIMARY);
                
                // Include characteristics
                WritableArray characteristicsArray = Arguments.createArray();
                List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                for (BluetoothGattCharacteristic characteristic : characteristics) {
                    WritableMap charMap = Arguments.createMap();
                    charMap.putString("uuid", characteristic.getUuid().toString());
                    charMap.putBoolean("isReadable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
                    charMap.putBoolean("isWritable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
                    charMap.putBoolean("isNotifiable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
                    characteristicsArray.pushMap(charMap);
                }
                serviceMap.putArray("characteristics", characteristicsArray);
                servicesArray.pushMap(serviceMap);
            }
        }
        map.putArray("services", servicesArray);
        
        return map;
    }
    
    private WritableMap createDeviceInfoMap(DeviceData deviceData) {
        WritableMap map = Arguments.createMap();
        map.putString("deviceId", deviceData.deviceId);
        map.putString("deviceName", deviceData.deviceName);
        map.putInt("rssi", deviceData.rssi);
        // ✅ FIX: Handle nullable battery level
        if (deviceData.batteryLevel != null) {
            map.putInt("batteryLevel", deviceData.batteryLevel);
        } else {
            map.putNull("batteryLevel");
        }
        map.putDouble("temperature", deviceData.temperature);
        map.putInt("steps", deviceData.steps);
        // Convert timestamp from seconds to milliseconds for JavaScript
        map.putDouble("timestamp", deviceData.timestamp * 1000.0);
        map.putBoolean("isSmartTag", deviceData.isSmartTag);
        map.putString("connectionState", deviceData.connectionState);
        
        // Include services information for ServicesDiscovered event
        WritableArray servicesArray = Arguments.createArray();
        for (String serviceUuid : deviceData.services.keySet()) {
            BluetoothGattService service = deviceData.services.get(serviceUuid);
            if (service != null) {
                WritableMap serviceMap = Arguments.createMap();
                serviceMap.putString("uuid", serviceUuid);
                serviceMap.putBoolean("isPrimary", service.getType() == BluetoothGattService.SERVICE_TYPE_PRIMARY);
                
                // Include characteristics
                WritableArray characteristicsArray = Arguments.createArray();
                List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                for (BluetoothGattCharacteristic characteristic : characteristics) {
                    WritableMap charMap = Arguments.createMap();
                    charMap.putString("uuid", characteristic.getUuid().toString());
                    charMap.putBoolean("isReadable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
                    charMap.putBoolean("isWritable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
                    charMap.putBoolean("isNotifiable", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
                    characteristicsArray.pushMap(charMap);
                }
                serviceMap.putArray("characteristics", characteristicsArray);
                servicesArray.pushMap(serviceMap);
            }
        }
        map.putArray("services", servicesArray);
        
        return map;
    }
    
    private String convertReadableMapToJson(ReadableMap map) {
        // Simple JSON conversion - in production, use a proper JSON library
        StringBuilder json = new StringBuilder("{");
        // Implementation would convert ReadableMap to JSON string
        json.append("}");
        return json.toString();
    }
    
    private boolean isStandardBLECharacteristic(String characteristicUuid) {
        // Standard BLE characteristics that might not be available on Smart Tag devices
        return characteristicUuid.equals("00002a19-0000-1000-8000-00805f9b34fb") || // Battery Level
               characteristicUuid.equals("00002a29-0000-1000-8000-00805f9b34fb") || // Manufacturer Name
               characteristicUuid.equals("00002a24-0000-1000-8000-00805f9b34fb") || // Model Number
               characteristicUuid.equals("00002a26-0000-1000-8000-00805f9b34fb") || // Firmware Revision
               characteristicUuid.equals("00002a25-0000-1000-8000-00805f9b34fb") || // Serial Number
               characteristicUuid.equals("00002a27-0000-1000-8000-00805f9b34fb") || // Hardware Revision
               characteristicUuid.equals("00002a28-0000-1000-8000-00805f9b34fb") || // Software Revision
               characteristicUuid.equals("00002a23-0000-1000-8000-00805f9b34fb") || // System ID
               characteristicUuid.equals("00002a2a-0000-1000-8000-00805f9b34fb");   // IEEE 11073-20601 Regulatory Certification Data List
    }
    
    private void sendEvent(String eventName, WritableMap params) {
        getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }
    
    /**
     * Trigger health data API call from native side
     * This method can be called when the app is in background to ensure API calls continue
     */
    @ReactMethod
    public void triggerHealthDataApiCall(String deviceId, Promise promise) {
        Log.d(TAG, "📤 Triggering health data API call from native side for device: " + deviceId);
        
        try {
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData == null) {
                promise.reject("DEVICE_NOT_FOUND", "Device " + deviceId + " not found");
                return;
            }
            
            if (deviceData.connectionState == null || !deviceData.connectionState.equals("connected")) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device " + deviceId + " is not connected");
                return;
            }
            
            // Create device data map for API call
            WritableMap deviceDataMap = createDeviceInfoMap(deviceData);
            
            // Send event to JavaScript to trigger API call
            sendHealthDataApiEvent(deviceId, deviceDataMap);
            
            promise.resolve(true);
            Log.d(TAG, "✅ Health data API event sent successfully for device: " + deviceId);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to trigger health data API call", e);
            promise.reject("API_TRIGGER_FAILED", "Failed to trigger health data API call: " + e.getMessage());
        }
    }
    
    /**
     * Send health data API event to JavaScript
     * This allows the native side to trigger health data API calls when the app is in background
     */
    private void sendHealthDataApiEvent(String deviceId, WritableMap deviceData) {
        WritableMap eventData = Arguments.createMap();
        eventData.putString("deviceId", deviceId);
        eventData.putMap("deviceData", deviceData);
        eventData.putString("timestamp", String.valueOf(System.currentTimeMillis()));
        
        Log.d(TAG, "📤 Sending health data API event to JS for device: " + deviceId);
        sendEvent("HealthDataApiRequest", eventData);
    }
    
    // MARK: - Enhanced Error Handling Methods
    
    /**
     * Reject promise with BLEError context
     */
    private void rejectWithBLEError(Promise promise, BLEError bleError) {
        Log.e(TAG, "BLE Error: " + bleError.toString());
        promise.reject(bleError.errorCode.name(), bleError.toJSString());
    }
    
    /**
     * Reject promise with context information
     */
    private void rejectWithContext(Promise promise, String errorCode, String message, String deviceId, String characteristicUuid) {
        BLEError bleError = new BLEError(BLEError.ErrorCode.UNKNOWN_ERROR, message, 
                                       "Operation failed", deviceId, null, characteristicUuid);
        rejectWithBLEError(promise, bleError);
    }
    
    /**
     * Validate operation before execution
     */
    private boolean validateOperation(String deviceId, String characteristicUuid, String operation) {
        if (!connectedGatts.containsKey(deviceId)) {
            Log.e(TAG, operation + " failed: Device not connected - " + deviceId);
            return false;
        }
        
        if (!deviceCharacteristics.containsKey(deviceId + "_" + characteristicUuid)) {
            Log.e(TAG, operation + " failed: Characteristic not found - " + characteristicUuid);
            return false;
        }
        
        return true;
    }
    
    /**
     * Validate device connection
     */
    private boolean validateDeviceConnection(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.d(TAG, "🔍 Device not in connected GATT map: " + deviceId);
            return false;
        }
        
        // Check if device is actually connected
        BluetoothDevice device = gatt.getDevice();
        if (device == null) {
            Log.d(TAG, "🔍 Device object is null for: " + deviceId);
            return false;
        }
        
        // Additional validation - check if we have characteristics for this device
        boolean hasCharacteristics = false;
        for (String key : deviceCharacteristics.keySet()) {
            if (key.startsWith(deviceId + "_")) {
                hasCharacteristics = true;
                break;
            }
        }
        
        if (!hasCharacteristics) {
            Log.d(TAG, "🔍 No characteristics found for device: " + deviceId);
            return false;
        }
        
        Log.d(TAG, "✅ Device connection validated: " + deviceId);
        return true;
    }
    
    private void startForegroundService() {
        if (isServiceRunning) {
            Log.d(TAG, "Foreground service already running");
            return;
        }
        
        Log.d(TAG, "🚀 Starting foreground service");
        
        Intent serviceIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
        getReactApplicationContext().startForegroundService(serviceIntent);
        
        // Bind to the service to get reference
        Intent bindIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
        boolean bindResult = getReactApplicationContext().bindService(bindIntent, new android.content.ServiceConnection() {
            @Override
            public void onServiceConnected(android.content.ComponentName name, IBinder service) {
                BLEForegroundService.LocalBinder binder = (BLEForegroundService.LocalBinder) service;
                bleService = binder.getService();
                connectionManager.setForegroundService(bleService);
                isServiceRunning = true;
                Log.d(TAG, "✅ Foreground service connected and bound");
            }
            
            @Override
            public void onServiceDisconnected(android.content.ComponentName name) {
                bleService = null;
                connectionManager.setForegroundService(null);
                isServiceRunning = false;
                Log.d(TAG, "❌ Foreground service disconnected");
            }
        }, Context.BIND_AUTO_CREATE);
        
        if (!bindResult) {
            Log.e(TAG, "❌ Failed to bind to foreground service");
        }
    }
    
    private void stopForegroundService() {
        if (!isServiceRunning) {
            return;
        }
        
        Intent serviceIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
        getReactApplicationContext().stopService(serviceIntent);
        isServiceRunning = false;
    }
    
    private void scheduleBackgroundWork() {
        Log.d(TAG, "📅 Scheduling background work");
        
        try {
            // Schedule periodic background scan
            BLEWorkManager.schedulePeriodicScan(getReactApplicationContext());
            
            // Connect to bonded devices
            if (connectionManager != null) {
                connectionManager.connectToBondedDevices();
            }
            
            Log.d(TAG, "✅ Background work scheduled");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to schedule background work", e);
        }
    }
    
    public void startBackgroundScan() {
        Log.d(TAG, "🔍 Starting background scan");
        
        try {
            if (connectionManager != null) {
                connectionManager.startBackgroundScan();
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start background scan", e);
        }
    }
    
    public void connectToDeviceBackground(String deviceId) {
        Log.d(TAG, "🔗 Connecting to device in background: " + deviceId);
        
        try {
            if (connectionManager != null) {
                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                connectionManager.connectToDevice(deviceId, device, new BLEConnectionCallback() {
                    @Override
                    public void onConnectionStateChanged(String deviceId, ConnectionState state) {
                        Log.d(TAG, "🔗 Background connection state changed: " + deviceId + " = " + state);
                    }
                    
                    @Override
                    public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                        Log.d(TAG, "✅ Background services discovered: " + deviceId);
                    }
                    
                    @Override
                    public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        Log.d(TAG, "📖 Background characteristic read: " + deviceId);
                    }
                    
                    @Override
                    public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        Log.d(TAG, "📝 Background characteristic write: " + deviceId);
                    }
                    
                    @Override
                    public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                        Log.d(TAG, "📡 Background characteristic changed: " + deviceId);
                    }
                });
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to connect to device in background", e);
        }
    }
    
    private void startAutoConnectToBondedDevices() {
        Log.d(TAG, "🚀 Starting auto-connect to bonded devices on startup (like iOS)");
        
        try {
            if (!checkBluetoothEnabled() || !checkPermissions()) {
                Log.e(TAG, "❌ Cannot start auto-connect: Bluetooth disabled or permissions missing");
                return;
            }
            
            Log.d(TAG, "📋 Auto-connecting to " + bondedDeviceIds.size() + " bonded devices");
            
            // Start scanning for bonded devices
            startScanningForBondedDevices();
            
            // Also try direct connection to known devices
            for (String deviceId : bondedDeviceIds) {
                BluetoothDevice device = bondedDevices.get(deviceId);
                if (device != null) {
                    Log.d(TAG, "🔗 Attempting direct connection to bonded device: " + deviceId);
                    connectToDeviceDirect(deviceId, device);
                }
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start auto-connect to bonded devices", e);
        }
    }
    
    private void connectToDeviceDirect(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔗 Direct connection attempt to: " + deviceId);
        
        try {
            // Check if already connected
            if (connectedGatts.containsKey(deviceId)) {
                Log.d(TAG, "✅ Device already connected: " + deviceId);
                return;
            }
            
            // Create GATT connection with autoConnect=true (like iOS)
            BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                true, // autoConnect = true for background reconnection
                new BluetoothGattCallback() {
                    @Override
                    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "🔗 Direct connection state change: " + deviceId + " - Status: " + status + " - New State: " + newState);
                        
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ Direct connection successful: " + deviceId);
                            connectedGatts.put(deviceId, gatt);
                            
                            // Request connection parameters based on power profile
                            requestConnectionParameters(gatt, deviceId);
                            
                            // Send local notification for auto-connection
                            String deviceName = gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId;
                            sendLocalNotificationIfBackground("Device Auto-Connected", "Auto-connected to " + deviceName);
                            
                            // Update device state
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.connectionState = "connected";
                                // Only send AutoConnectDeviceConnected for direct connections (auto-connect)
                                sendEvent("AutoConnectDeviceConnected", createDeviceInfoMap(deviceData));
                            }
                            
                            // Start service discovery
                            gatt.discoverServices();
                            
                            // CRITICAL FIX: Ensure data reading starts immediately after connection
                            // This is essential for auto-connected devices to get data
                            Log.d(TAG, "📊 Auto-connect: Starting immediate data reading for: " + deviceId);
                            mainHandler.postDelayed(() -> {
                                if (connectedGatts.containsKey(deviceId)) {
                                    Log.d(TAG, "📊 Auto-connect: Requesting device data after connection delay");
                                    requestDeviceData(deviceId);
                                    
                                    // Start RSSI monitoring for auto-connected device
                                    startRSSIMonitoringForDevice(deviceId);
                                    
                                    // Start health data API monitoring for auto-connected device
                                    startHealthDataApiMonitoringForDevice(deviceId);
                                }
                            }, 1000); // 1 second delay to ensure connection is stable
                            
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "❌ Direct connection failed: " + deviceId);
                            connectedGatts.remove(deviceId);
                            
                            // Update device state
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.connectionState = "disconnected";
                                // Only send AutoConnectDeviceDisconnected for direct connections (auto-connect)
                                sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                            }
                        }
                    }
                    
                    @Override
                    public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "✅ Services discovered for direct connection: " + deviceId);
                        
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            // Ensure the GATT is properly stored in connectedGatts
                            connectedGatts.put(deviceId, gatt);
                            
                            // Handle service discovery (this will trigger data reading)
                            handleServicesDiscovered(gatt);
                        } else {
                            Log.e(TAG, "❌ Service discovery failed for direct connection: " + deviceId + " - Status: " + status);
                        }
                    }
                    
                    @Override
                    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        
                        Log.d(TAG, "📖 Characteristic read for direct connection: " + characteristicUuid + " on device " + deviceId + " - Status: " + status);
                        
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            // Handle the characteristic data (this will process steps, temperature, etc.)
                            handleCharacteristicData(deviceId, characteristic);
                        } else {
                            Log.e(TAG, "❌ Characteristic read failed for direct connection: " + characteristicUuid + " - Status: " + status);
                        }
                    }
                    
                    @Override
                    public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        // Handle characteristic writes if needed
                        Log.d(TAG, "✍️ Characteristic write for direct connection: " + characteristic.getUuid());
                    }
                    
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        
                        Log.d(TAG, "📡 Characteristic changed for direct connection: " + characteristicUuid + " on device " + deviceId);
                        
                        // Handle the characteristic data (this will process steps, temperature, etc.)
                        handleCharacteristicData(deviceId, characteristic);
                        
                        // ✅ Emit event to JavaScript for monitoring callbacks (correct field names)
                        byte[] data = characteristic.getValue();
                        if (data != null && data.length > 0) {
                            String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                            
                            WritableMap eventData = Arguments.createMap();
                            eventData.putString("deviceId", deviceId);
                            eventData.putString("characteristicUuid", characteristicUuid); // lowercase "Uuid"
                            eventData.putString("data", base64Data); // base64 format matching iOS
                            
                            sendEvent("CharacteristicChanged", eventData);
                        }
                    }
                }
            );
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to create direct connection to: " + deviceId, e);
        }
    }
    
    private void scheduleAutoConnectToBondedDevices() {
        Log.d(TAG, "📅 Scheduling auto-connect to bonded devices");
        
        try {
            // Schedule immediate auto-connect work
            BLEWorkManager.scheduleOneTimeConnect(getReactApplicationContext(), "bonded_devices");
            
            // Also start auto-connect immediately
            if (connectionManager != null) {
                connectionManager.connectToBondedDevices();
            }
            
            Log.d(TAG, "✅ Auto-connect to bonded devices scheduled");
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to schedule auto-connect to bonded devices", e);
        }
    }
    
    // Scan callback
    private ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String deviceId = device.getAddress();
            String deviceName = device.getName() != null ? device.getName() : "Unknown Device";
            int rssi = result.getRssi();
            
            Log.d("SampleBridgeAndroid", "🔍 SCAN CALLBACK: Discovered device: " + deviceName + " (" + deviceId + ") RSSI: " + rssi);
            Log.d("SampleBridgeAndroid", "🔍 Callback type: " + callbackType + ", Scan record: " + (result.getScanRecord() != null ? "present" : "null"));
            
            // ✅ DEBUG: Log scan record details for our target device
            if (deviceId.equals("F9:D3:EF:CB:52:1F") || deviceName.contains("8A0CEFED") || deviceName.contains("Health Tag")) {
                Log.d(TAG, "═══════════════════════════════════════════════════════");
                Log.d(TAG, "🎯 TARGET DEVICE SCAN DEBUG");
                Log.d(TAG, "═══════════════════════════════════════════════════════");
                Log.d(TAG, "Device: " + deviceName + " (" + deviceId + ")");
                Log.d(TAG, "RSSI: " + rssi);
                
                if (result.getScanRecord() != null) {
                    android.bluetooth.le.ScanRecord scanRecord = result.getScanRecord();
                    Log.d(TAG, "Scan Record: PRESENT");
                    Log.d(TAG, "Device Name: " + scanRecord.getDeviceName());
                    Log.d(TAG, "Service UUIDs: " + (scanRecord.getServiceUuids() != null ? scanRecord.getServiceUuids().size() : 0));
                    
                    // Check manufacturer data
                    android.util.SparseArray<byte[]> mfgData = scanRecord.getManufacturerSpecificData();
                    Log.d(TAG, "Manufacturer Data Entries: " + (mfgData != null ? mfgData.size() : 0));
                    
                    if (mfgData != null && mfgData.size() > 0) {
                        for (int i = 0; i < mfgData.size(); i++) {
                            int mfgId = mfgData.keyAt(i);
                            byte[] data = mfgData.valueAt(i);
                            StringBuilder hex = new StringBuilder();
                            if (data != null) {
                                for (byte b : data) {
                                    hex.append(String.format("%02X ", b));
                                }
                            }
                            Log.d(TAG, "  Entry " + i + ": ID=0x" + String.format("%04X", mfgId) + 
                                  " (" + mfgId + "), Length=" + (data != null ? data.length : 0) + 
                                  ", Data: " + hex.toString().trim());
                        }
                        
                        // Try to get our specific ID
                        byte[] ourData = mfgData.get(0x1234);
                        Log.d(TAG, "Our ID (0x1234) query result: " + (ourData != null ? ourData.length + " bytes" : "NULL"));
                    } else {
                        Log.w(TAG, "⚠️ NO MANUFACTURER DATA in scan record!");
                    }
                    
                    // Check raw bytes
                    byte[] rawBytes = scanRecord.getBytes();
                    if (rawBytes != null) {
                        Log.d(TAG, "Raw scan record: " + rawBytes.length + " bytes");
                        StringBuilder fullHex = new StringBuilder();
                        for (int i = 0; i < Math.min(rawBytes.length, 62); i++) {
                            fullHex.append(String.format("%02X ", rawBytes[i]));
                        }
                        Log.d(TAG, "First 62 bytes: " + fullHex.toString().trim());
                    }
                } else {
                    Log.w(TAG, "⚠️ SCAN RECORD IS NULL!");
                }
                Log.d(TAG, "═══════════════════════════════════════════════════════");
            }
            
            // Save device name for notifications
            if (deviceName != null && !deviceName.equals("Unknown Device")) {
                saveDeviceName(deviceId, deviceName);
            }
            
            // Create or update device data for ALL discovered devices
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData == null) {
                deviceData = new DeviceData(deviceId, deviceName);
                deviceDataMap.put(deviceId, deviceData);
            }
            
            deviceData.rssi = rssi;
            deviceData.timestamp = System.currentTimeMillis();
            
            // Check if this is a Smart Tag device by looking for Smart Tag service in advertisement
            boolean isSmartTag = false;
            if (result.getScanRecord() != null) {
                List<ParcelUuid> serviceUuids = result.getScanRecord().getServiceUuids();
                if (serviceUuids != null) {
                    for (ParcelUuid uuid : serviceUuids) {
                        if (SMART_TAG_SERVICE_UUID.equals(uuid.toString())) {
                            isSmartTag = true;
                            break;
                        }
                    }
                }
            }
            deviceData.isSmartTag = isSmartTag;
            
            // ✅ PARSE MANUFACTURER DATA (matching iOS implementation)
            WritableMap manufacturerInfo = Arguments.createMap();
            boolean hasOurManufacturerData = false;
            
            if (result.getScanRecord() != null) {
                android.util.SparseArray<byte[]> allManufacturerData = result.getScanRecord().getManufacturerSpecificData();
                
                // ✅ DEBUG: Log all manufacturer IDs for this device
                if (allManufacturerData.size() > 0) {
                    Log.d(TAG, "📊 [MFG DATA] Device " + deviceName + " (" + deviceId + ") has " + allManufacturerData.size() + " manufacturer entries:");
                    for (int i = 0; i < allManufacturerData.size(); i++) {
                        int mfgId = allManufacturerData.keyAt(i);
                        byte[] mfgBytes = allManufacturerData.valueAt(i);
                        StringBuilder hex = new StringBuilder();
                        if (mfgBytes != null) {
                            for (byte b : mfgBytes) {
                                hex.append(String.format("%02X ", b));
                            }
                        }
                        Log.d(TAG, "   Manufacturer ID: 0x" + String.format("%04X", mfgId) + 
                              " (" + mfgId + ") - Length: " + (mfgBytes != null ? mfgBytes.length : 0) + 
                              " bytes - Data: " + hex.toString().trim());
                    }
                }
                
                // Get manufacturer data (company ID 0x1234 = 4660 in decimal)
                byte[] mfgData = result.getScanRecord().getManufacturerSpecificData(0x1234);
                
                // ✅ FALLBACK: If Android API doesn't return data, parse raw bytes manually
                // According to Punch Through guide, sometimes you need to parse raw advertisement bytes
                if (mfgData == null && result.getScanRecord().getBytes() != null) {
                    Log.d(TAG, "⚠️ Android API returned null for 0x1234, trying manual parse...");
                    mfgData = parseManufacturerDataFromRawBytes(result.getScanRecord().getBytes(), 0x1234);
                    if (mfgData != null) {
                        Log.d(TAG, "✅ Manual parse successful! Found " + mfgData.length + " bytes");
                    }
                }
                
                if (mfgData != null && mfgData.length >= 6) {
                    hasOurManufacturerData = true;
                    Log.d(TAG, "✅ [MFG DATA] Found OUR manufacturer ID (0x1234) for device: " + deviceName);
                    manufacturerInfo = parseManufacturerData(mfgData);
                    
                    // ✅ Check device status (0 = Good, 1 = Problem) from manufacturer data
                    if (manufacturerInfo.hasKey("deviceStatus")) {
                        int deviceStatus = manufacturerInfo.getInt("deviceStatus");
                        if (deviceStatus == 1) {
                            Log.w(TAG, "⚠️ Device " + deviceName + " reports PROBLEM status in manufacturer data");
                        }
                    }
                    
                    // Store record count for data sync
                    if (manufacturerInfo.hasKey("recordCount")) {
                        int recordCount = manufacturerInfo.getInt("recordCount");
                        deviceRecordCounts.put(deviceId, recordCount);
                        Log.d(TAG, "📊 Device " + deviceName + " has " + recordCount + " records available");
                        
                        // ✅ Send manufacturer data event for DataTransfer listener (matching iOS)
                        if (recordCount > 0) {
                            WritableMap mfgDataEvent = Arguments.createMap();
                            mfgDataEvent.putString("deviceId", deviceId);
                            mfgDataEvent.putString("type", "manufacturer_data");
                            mfgDataEvent.putInt("companyId", manufacturerInfo.getInt("companyId"));
                            mfgDataEvent.putInt("recordCount", recordCount);
                            mfgDataEvent.putInt("batteryLevel", manufacturerInfo.getInt("batteryLevel"));
                            mfgDataEvent.putInt("batteryMillivolts", manufacturerInfo.getInt("batteryMillivolts"));
                            mfgDataEvent.putInt("deviceStatus", manufacturerInfo.getInt("deviceStatus"));
                            mfgDataEvent.putInt("indication", manufacturerInfo.getInt("indication"));
                            mfgDataEvent.putString("rawData", bytesToHex(mfgData));
                            sendEvent("DataTransferEvent", mfgDataEvent);
                        }
                    }
                } else if (allManufacturerData.size() > 0) {
                    Log.d(TAG, "ℹ️ Device " + deviceName + " has manufacturer data but not our ID (0x1234)");
                }
            }
            
            // ✅ MATCHING iOS: Send ALL devices to JavaScript, let UI filter
            // iOS sends all devices and filtering happens in JavaScript layer
            // We still parse manufacturer data to provide information, but don't filter
            Log.d("SampleBridgeAndroid", "📱 Sending device discovery event: " + deviceName + " (" + deviceId + ")");
            
            // ✅ Add Smart Tag indicators for JavaScript filtering
            WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
            deviceInfoMap.putMap("manufacturerData", manufacturerInfo);
            deviceInfoMap.putBoolean("hasManufacturerData", hasOurManufacturerData);
            deviceInfoMap.putBoolean("isSmartTag", isSmartTag);
            deviceInfoMap.putBoolean("isBonded", bondedDeviceIds.contains(deviceId));
            
            sendEvent("DeviceFound", deviceInfoMap);
            
            // Special handling for bonded devices or Health Tag
            if (bondedDevices.containsKey(deviceId) || "Health Tag".equals(deviceName)) {
                Log.d("SampleBridgeAndroid", "🎯 TARGET DEVICE FOUND: " + deviceName + " (" + deviceId + ")");
                
                // ✅ Check if connection is allowed (matching iOS implementation)
                // This blocks forgotten devices and manually disconnected devices from auto-reconnecting
                if (!shouldAllowConnection(deviceId, false)) { // false = auto-connect (not manual)
                    Log.d("SampleBridgeAndroid", "🚫 Connection blocked for device: " + deviceName + " - device is forgotten or manually disconnected");
                    return;
                }
                
                // Auto-connect if enabled and not already connected
                if (autoConnectEnabled.get() && !connectedGatts.containsKey(deviceId)) {
                    Log.d("SampleBridgeAndroid", "🔗 Auto-connecting to bonded device: " + deviceName);
                    // TODO: Implement internal connection method
                    // connectToDeviceInternal(deviceId);
                }
            }
        }
        
        @Override
        public void onScanFailed(int errorCode) {
            Log.e("SampleBridgeAndroid", "❌ Scan failed with error code: " + errorCode);
            isScanning.set(false);
        }
    };

    // BLE Methods for React Native
    @ReactMethod
    public void requestPermissions(Promise promise) {
        try {
            // Check if we have the required permissions
            boolean hasPermissions = checkPermissions();
            if (hasPermissions) {
                WritableMap result = Arguments.createMap();
                result.putBoolean("granted", true);
                result.putBoolean("bluetoothEnabled", checkBluetoothEnabled());
                result.putBoolean("permissionsGranted", true);
                promise.resolve(result);
            } else {
                // Request permissions using ActivityCompat
                if (getCurrentActivity() != null) {
                    String[] permissions;
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        permissions = new String[]{
                            Manifest.permission.BLUETOOTH_SCAN,
                            Manifest.permission.BLUETOOTH_CONNECT,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        };
                    } else {
                        permissions = new String[]{
                            Manifest.permission.BLUETOOTH,
                            Manifest.permission.BLUETOOTH_ADMIN,
                            Manifest.permission.ACCESS_FINE_LOCATION
                        };
                    }
                    
                    ActivityCompat.requestPermissions(getCurrentActivity(), permissions, 1001);
                    WritableMap result = Arguments.createMap();
                    result.putBoolean("granted", false);
                    result.putBoolean("bluetoothEnabled", checkBluetoothEnabled());
                    result.putBoolean("permissionsGranted", false);
                    promise.resolve(result); // Will be resolved when user grants/denies
                } else {
                    promise.reject("PERMISSION_ERROR", "No activity available for permission request");
                }
            }
        } catch (Exception e) {
            promise.reject("PERMISSION_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void isBLEReady(Promise promise) {
        try {
            boolean bluetoothEnabled = checkBluetoothEnabled();
            boolean permissionsGranted = checkPermissions();
            boolean isReady = bluetoothEnabled && permissionsGranted;
            
            Log.d(TAG, "🔍 BLE Ready Check - Bluetooth: " + bluetoothEnabled + ", Permissions: " + permissionsGranted + ", Ready: " + isReady);
            
            WritableMap result = Arguments.createMap();
            result.putBoolean("ready", isReady);
            result.putBoolean("bluetoothEnabled", bluetoothEnabled);
            result.putBoolean("permissionsGranted", permissionsGranted);
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking BLE ready state: " + e.getMessage());
            promise.reject("BLE_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void startScanning(Promise promise) {
        try {
            startScanningForBondedDevices();
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SCAN_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void stopScanning(Promise promise) {
        try {
            stopScanning();
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SCAN_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void connectToDevice(String deviceId, Promise promise) {
        try {
            BluetoothDevice device;
            synchronized(gattLock) {
                // If this is a manual connection to a device that was manually disconnected, clear the tracking
                if (manualDisconnectInProgress.contains(deviceId)) {
                    Log.d(TAG, "🔄 Manual connection to previously manually disconnected device - clearing tracking: " + deviceId);
                    manualDisconnectInProgress.remove(deviceId);
                }
                
                device = bluetoothAdapter.getRemoteDevice(deviceId);
                if (device != null) {
                    // ✅ CRITICAL: Check if there's a stale GATT connection and clean it up before reconnecting
                    if (connectedGatts.containsKey(deviceId)) {
                        BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                        Log.d(TAG, "⚠️ Found existing GATT connection for: " + deviceId);
                        
                        // Check if it's actually connected via Android BLE Manager
                        BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                        int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                        
                        if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ Device already connected (verified via BLE Manager): " + deviceId);
                            promise.resolve(true);
                            return;
                        } else {
                            // Stale connection - clean it up
                            Log.d(TAG, "🔄 Stale GATT connection detected (state=" + connectionState + ") - cleaning up before reconnect");
                            try {
                                existingGatt.close();
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error closing stale GATT: " + e.getMessage());
                            }
                            connectedGatts.remove(deviceId);
                            
                            // Also clean up any related state
                            stopDeviceStatusPolling(deviceId);
                            systemCommandsSent.remove(deviceId);
                            dataSyncState.remove(deviceId);
                        }
                    }
                }
            } // End synchronized block for state checks
            
            // Create GATT connection with proper configuration
            // ✅ CRITICAL FIX: Use autoConnect=false for user-initiated connections (matching iOS)
            // autoConnect=true causes 30+ second delays because it waits passively for advertisements
            // autoConnect=false actively connects immediately (like iOS)
            BluetoothGatt gatt = device.connectGatt(
                    getReactApplicationContext(),
                    false, // ✅ autoConnect = false for INSTANT connection (matching iOS behavior)
                    new BluetoothGattCallback() {
                        @Override
                        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                            String deviceId = gatt.getDevice().getAddress();
                            Log.d(TAG, "🔗 Connection state change for device: " + deviceId + " - Status: " + status + " - New State: " + newState);
                            
                            // ✅ CRITICAL: Handle BLE error status (especially 133 = GATT_ERROR)
                            if (status != BluetoothGatt.GATT_SUCCESS) {
                                Log.e(TAG, "❌ Connection failed with status: " + status + " for device: " + deviceId);
                                
                                if (status == 133) {
                                    Log.e(TAG, "🔄 [STATUS 133] GATT_ERROR - BLE stack issue detected");
                                    Log.e(TAG, "🔄 [STATUS 133] This usually means:");
                                    Log.e(TAG, "🔄 [STATUS 133]   - Device is out of range");
                                    Log.e(TAG, "🔄 [STATUS 133]   - BLE cache is stale");
                                    Log.e(TAG, "🔄 [STATUS 133]   - Previous connection not cleaned up");
                                    
                                    // ✅ ANDROID BEST PRACTICE: Refresh GATT cache and retry
                                    try {
                                        Log.d(TAG, "🔄 [STATUS 133] Refreshing GATT cache...");
                                        java.lang.reflect.Method refresh = gatt.getClass().getMethod("refresh");
                                        refresh.invoke(gatt);
                                        Log.d(TAG, "✅ [STATUS 133] GATT cache refreshed successfully");
                                    } catch (Exception e) {
                                        Log.e(TAG, "❌ [STATUS 133] Failed to refresh GATT cache: " + e.getMessage());
                                    }
                                    
                                    // Close the failed connection properly
                                    gatt.close();
                                    connectedGatts.remove(deviceId);
                                    
                                    // Update device state
                                    DeviceData deviceData = deviceDataMap.get(deviceId);
                                    if (deviceData != null) {
                                        deviceData.connectionState = "disconnected";
                                        sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                    }
                                    
                                    Log.d(TAG, "⚠️ [STATUS 133] Connection closed. User can retry manually.");
                                    return;
                                }
                                
                                // For other errors, just close and update state
                                gatt.close();
                                connectedGatts.remove(deviceId);
                                
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.connectionState = "disconnected";
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                return;
                            }
                            
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                Log.d(TAG, "✅ Connected to: " + deviceId);
                                connectedGatts.put(deviceId, gatt);
                                
                                // Request connection parameters based on power profile
                                requestConnectionParameters(gatt, deviceId);
                                
                                // Add to bonded devices for auto-connection
                                addToBondedDevices(deviceId, gatt.getDevice());
                                
                                // Send local notification for connection (like iOS)
                                String deviceName = gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId;
                                sendLocalNotificationIfBackground("Device Connected", "Connected to " + deviceName);
                                
                                // Update device state
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.connectionState = "connected";
                                    // Only send DeviceConnected for manual connections
                                    sendEvent("DeviceConnected", createDeviceInfoMap(deviceData));
                                }
                                
                                // Following Punch Through guide: Perform operations serially
                                // First request MTU, then discover services
                                Log.d(TAG, "📡 Requesting MTU for device: " + deviceId);
                                gatt.requestMtu(512);
                                
                                // Service discovery will be triggered after MTU response
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                Log.d("SampleBridgeAndroid", "❌ Disconnected from: " + deviceId);
                                connectedGatts.remove(deviceId);
                                
                                // ✅ Stop Device Status polling (matching iOS cleanup)
                                stopDeviceStatusPolling(deviceId);
                                
                                // ✅ Clean up data sync state (matching iOS cleanup)
                                systemCommandsSent.remove(deviceId);
                                dataSyncState.remove(deviceId);
                                dataSyncRetryCount.remove(deviceId);
                                deviceRecordCounts.remove(deviceId);
                                dataSyncRequested.remove(deviceId);
                                
                                // ✅ Clean up notification tracking
                                pendingNotificationEnables.remove(deviceId);
                                completedNotificationEnables.remove(deviceId);
                                
                                // ✅ Clean up descriptor write queues
                                descriptorWriteQueues.remove(deviceId);
                                isDescriptorWriteInProgress.remove(deviceId);
                                
                                // Cancel any pending data sync timers
                                ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
                                if (syncTimer != null) {
                                    syncTimer.cancel(false);
                                    dataSyncTimers.remove(deviceId);
                                }
                                
                                // Send local notification for disconnection (like iOS) we have to comment it for Production
                                String deviceName = gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId;
                                sendLocalNotificationIfBackground("Device Disconnected", deviceName + " has disconnected");
                                
                                // Update device state
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.connectionState = "disconnected";
                                    // Only send DeviceDisconnected for manual connections
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                
                                // Schedule reconnection if auto-connect is enabled
                                if (autoConnectEnabled.get()) {
                                    scheduleReconnection(deviceId);
                                }
                            }
                        }
                        
                        @Override
                        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            Log.d(TAG, "🔍 Service discovery callback for device: " + deviceId + " - Status: " + status);
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ Service discovery successful for device: " + deviceId);
                                handleServicesDiscovered(gatt);
                                
                                // Check if there's a pending promise for service discovery
                                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                if (pendingPromise != null) {
                                    Log.d(TAG, "📊 Resolving service discovery promise for device: " + deviceId);
                                    pendingPromise.resolve(true);
                                }
                            } else {
                                Log.e(TAG, "❌ Service discovery failed for device " + deviceId + ": " + status);
                                
                                // Reject any pending promise
                                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                if (pendingPromise != null) {
                                    pendingPromise.reject("DISCOVERY_ERROR", "Service discovery failed with status: " + status);
                                }
                            }
                        }
                        
                        @Override
                        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                            String deviceId = gatt.getDevice().getAddress();
                            String characteristicUuid = characteristic.getUuid().toString();
                            
                            Log.d(TAG, "📨 Characteristic changed: " + characteristicUuid + " on device " + deviceId);
                            
                            // Handle the characteristic data
                            handleCharacteristicData(deviceId, characteristic);
                            
                            // Emit event to JavaScript for monitoring callbacks
                            byte[] data = characteristic.getValue();
                            if (data != null && data.length > 0) {
                                String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                
                                WritableMap eventData = Arguments.createMap();
                                eventData.putString("deviceId", deviceId);
                                eventData.putString("characteristicUuid", characteristicUuid); // ✅ FIX: lowercase "Uuid" to match JavaScript
                                eventData.putString("data", base64Data); // ✅ FIX: "data" not "value" to match JavaScript
                                
                                sendEvent("CharacteristicChanged", eventData);
                                Log.d(TAG, "📨 Emitted CharacteristicChanged event for " + characteristicUuid);
                            }
                        }
                        
                        @Override
                        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String descriptorUuid = descriptor.getUuid().toString();
                            String characteristicUuid = descriptor.getCharacteristic().getUuid().toString();
                            
                            Log.d(TAG, "📝 [CALLBACK] onDescriptorWrite for device: " + deviceId + 
                                  ", char: " + characteristicUuid + ", status: " + status);
                            
                            // ✅ Process sequential descriptor write queue
                            onDescriptorWriteComplete(deviceId, descriptor, status);
                            
                            // ✅ Handle manual descriptor writes (from JS calls)
                            String promiseKey = deviceId + "_" + descriptorUuid;
                            Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
                            if (pendingPromise != null) {
                                if (status == BluetoothGatt.GATT_SUCCESS) {
                                    Log.d(TAG, "📊 Resolving manual descriptor write promise");
                                    pendingPromise.resolve(true);
                                } else {
                                    Log.e(TAG, "❌ Rejecting manual descriptor write promise");
                                    pendingPromise.reject("WRITE_ERROR", "Descriptor write failed with status: " + status);
                                }
                            }
                        }
                        
                        @Override
                        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String characteristicUuid = characteristic.getUuid().toString();
                            
                            Log.d(TAG, "📖 Characteristic read callback: " + characteristicUuid + " on device " + deviceId + " - Status: " + status);
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ Characteristic read successful: " + characteristicUuid);
                                
                                // Check if there's a pending promise for this read
                                String promiseKey = deviceId + "_" + characteristicUuid;
                                Promise pendingPromise = pendingReadPromises.remove(promiseKey);
                                Promise pendingCharacteristicPromise = pendingCharacteristicPromises.remove(promiseKey);
                                
                                if (pendingPromise != null) {
                                    // Resolve the promise with the actual data
                                    byte[] data = characteristic.getValue();
                                    if (data != null && data.length > 0) {
                                        // Convert byte array to base64 string for JavaScript
                                        String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                        Log.d(TAG, "📊 Resolving promise with data: " + base64Data + " (" + data.length + " bytes)");
                                        pendingPromise.resolve(base64Data);
                                    } else {
                                        Log.d(TAG, "📊 Resolving promise with null data");
                                        pendingPromise.resolve(null);
                                    }
                                } else if (pendingCharacteristicPromise != null) {
                                    // Resolve the characteristic promise
                                    byte[] data = characteristic.getValue();
                                    if (data != null && data.length > 0) {
                                        String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                        Log.d(TAG, "📊 Resolving characteristic promise with data: " + base64Data);
                                        pendingCharacteristicPromise.resolve(base64Data);
                                    } else {
                                        Log.d(TAG, "📊 Resolving characteristic promise with null data");
                                        pendingCharacteristicPromise.resolve(null);
                                    }
                                } else {
                                    // No pending promise, handle as regular data update
                                    Log.d(TAG, "📊 No pending promise, handling as regular data update for: " + characteristicUuid);
                                    handleCharacteristicData(deviceId, characteristic);
                                }
                            } else {
                                Log.e(TAG, "❌ Characteristic read failed: " + characteristicUuid + " with status: " + status);
                                
                                // Reject any pending promise
                                String promiseKey = deviceId + "_" + characteristicUuid;
                                Promise pendingPromise = pendingReadPromises.remove(promiseKey);
                                Promise pendingCharacteristicPromise = pendingCharacteristicPromises.remove(promiseKey);
                                
                                if (pendingPromise != null) {
                                    pendingPromise.reject("READ_ERROR", "Characteristic read failed with status: " + status);
                                }
                                if (pendingCharacteristicPromise != null) {
                                    pendingCharacteristicPromise.reject("READ_ERROR", "Characteristic read failed with status: " + status);
                                }
                            }
                        }
                        
                        @Override
                        public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String characteristicUuid = characteristic.getUuid().toString();
                            String writeKey = deviceId + "_" + characteristicUuid;
                            
                            // Get the stored transaction ID for this write operation
                            String transactionId = writeTransactionIds.remove(writeKey);
                            
                            if (transactionId != null) {
                                if (status == BluetoothGatt.GATT_SUCCESS) {
                                    Log.d(TAG, "✅ Write completed successfully for characteristic: " + characteristicUuid);
                                    
                                    // Resolve the transaction
                                    WritableMap result = Arguments.createMap();
                                    result.putString("deviceId", deviceId);
                                    result.putString("characteristicUuid", characteristicUuid);
                                    result.putBoolean("success", true);
                                    transactionManager.resolveTransaction(transactionId, result);
                                    
                                } else {
                                    Log.e(TAG, "❌ Write failed for characteristic: " + characteristicUuid + " with status: " + status);
                                    
                                    // Reject the transaction
                                    transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED.name(), 
                                        "Write failed with status: " + status);
                                }
                            } else {
                                Log.w(TAG, "⚠️ No transaction ID found for write callback: " + writeKey);
                            }
                            
                            // Remove pending write flag
                            pendingWrites.remove(writeKey);
                            Log.d(TAG, "🔄 Removed pending write flag for: " + writeKey);
                        }
                        
                        @Override
                        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ MTU changed to: " + mtu + " for device: " + deviceId);
                                
                                // Now that MTU is set, discover services
                                Log.d(TAG, "🔍 Starting service discovery for device: " + deviceId);
                                boolean discoverResult = gatt.discoverServices();
                                Log.d(TAG, "🔍 Service discovery initiated for device " + deviceId + ": " + discoverResult);
                            } else {
                                Log.e(TAG, "❌ MTU change failed for device " + deviceId + ": " + status);
                                // Still try to discover services even if MTU failed
                                Log.d(TAG, "🔍 Attempting service discovery despite MTU failure for device: " + deviceId);
                                boolean discoverResult = gatt.discoverServices();
                                Log.d(TAG, "🔍 Service discovery initiated for device " + deviceId + ": " + discoverResult);
                            }
                        }
                        
                        @Override
                        public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "📡 RSSI read successful for device " + deviceId + ": " + rssi + " dBm");
                                
                                // Check if there's a pending promise for RSSI reading
                                Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                                
                                if (pendingPromise != null) {
                                    Log.d(TAG, "📊 Resolving RSSI promise for device: " + deviceId);
                                    pendingPromise.resolve(rssi);
                                }
                                
                                // Update device data with RSSI
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.rssi = rssi;
                                    deviceData.timestamp = System.currentTimeMillis();
                                }
                                
                                // Emit RSSI update event
                                WritableMap rssiMap = Arguments.createMap();
                                rssiMap.putString("deviceId", deviceId);
                                rssiMap.putInt("rssi", rssi);
                                rssiMap.putDouble("timestamp", System.currentTimeMillis());
                                sendEvent("RSSIUpdated", rssiMap);
                                
                            } else {
                                Log.e(TAG, "❌ RSSI read failed for device " + deviceId + " with status: " + status);
                                
                                // Reject any pending promise
                                String promiseKey = deviceId + "_rssi";
                                Promise pendingPromise = pendingReadPromises.remove(promiseKey);
                                if (pendingPromise != null) {
                                    pendingPromise.reject("RSSI_ERROR", "RSSI read failed with status: " + status);
                                }
                            }
                        }
                    }
                );
                
                // Store the GATT connection
                connectedGatts.put(deviceId, gatt);
                promise.resolve(true);
        } catch (SecurityException e) {
            Log.e("SampleBridgeAndroid", "Security exception during connection: " + e.getMessage());
            promise.reject("SECURITY_ERROR", e.getMessage());
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Connection error: " + e.getMessage());
            promise.reject("CONNECTION_ERROR", e.getMessage());
        }
    }

    // Data Transfer Methods (following Android BLE best practices)
    @ReactMethod
    public void readCharacteristic(String deviceId, String characteristicUuid, Promise promise) {
        try {
            // Validate operation
            if (!validateOperation(deviceId, characteristicUuid, "READ_CHARACTERISTIC")) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            
            // Generate transaction ID for better tracking
            String transactionId = TransactionManager.generateReadTransactionId(deviceId, characteristicUuid);
            
            // Add transaction with timeout
            transactionManager.addTransaction(transactionId, promise, "READ_CHARACTERISTIC", deviceId, 5000);
            
            // Store legacy promise for backward compatibility
            String promiseKey = deviceId + "_" + characteristicUuid;
            pendingReadPromises.put(promiseKey, promise);
            
            if (gatt.readCharacteristic(characteristic)) {
                Log.d(TAG, "🔧 Read initiated for characteristic: " + characteristicUuid + " (transaction: " + transactionId + ")");
            } else {
                // Clean up on failure
                transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_READ_FAILED.name(), 
                    "Failed to initiate characteristic read");
                pendingReadPromises.remove(promiseKey);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Exception during characteristic read: " + e.getMessage(), e);
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.CHARACTERISTIC_READ_FAILED, 
                "Characteristic read failed", e.getMessage(), deviceId, null, characteristicUuid));
        }
    }
    
    @ReactMethod
    public void readCharacteristicSync(String deviceId, String characteristicUuid, Promise promise) {
        // This is the synchronous version that returns data directly
        readCharacteristic(deviceId, characteristicUuid, promise);
    }
    
    @ReactMethod
    public void discoverServicesSync(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("CONNECTION_ERROR", "Device not connected");
                return;
            }
            
            // Store the promise to resolve when service discovery is complete
            pendingServiceDiscoveryPromises.put(deviceId, promise);
            
            // Set timeout for the service discovery operation
            executorService.schedule(() -> {
                Promise timeoutPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                if (timeoutPromise != null) {
                    Log.e(TAG, "⏰ Service discovery timeout for device: " + deviceId);
                    timeoutPromise.reject("DISCOVERY_TIMEOUT", "Service discovery timed out");
                }
            }, 10, TimeUnit.SECONDS);
            
            Log.d(TAG, "🔍 Starting synchronous service discovery for device: " + deviceId);
            boolean discoverResult = gatt.discoverServices();
            Log.d(TAG, "🔍 Service discovery initiated for device " + deviceId + ": " + discoverResult);
            
            if (!discoverResult) {
                pendingServiceDiscoveryPromises.remove(deviceId);
                promise.reject("DISCOVERY_ERROR", "Failed to initiate service discovery");
            }
        } catch (Exception e) {
            promise.reject("DISCOVERY_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getDeviceServices(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("CONNECTION_ERROR", "Device not connected");
                return;
            }
            
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData == null) {
                promise.reject("DEVICE_ERROR", "Device data not found");
                return;
            }
            
            WritableArray servicesArray = Arguments.createArray();
            
            for (Map.Entry<String, BluetoothGattService> entry : deviceData.services.entrySet()) {
                String serviceUuid = entry.getKey();
                BluetoothGattService service = entry.getValue();
                
                WritableMap serviceMap = Arguments.createMap();
                serviceMap.putString("uuid", serviceUuid);
                serviceMap.putBoolean("isPrimary", service.getType() == BluetoothGattService.SERVICE_TYPE_PRIMARY);
                
                WritableArray characteristicsArray = Arguments.createArray();
                List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                
                for (BluetoothGattCharacteristic characteristic : characteristics) {
                    WritableMap charMap = Arguments.createMap();
                    charMap.putString("uuid", characteristic.getUuid().toString());
                    charMap.putString("serviceUUID", serviceUuid);
                    
                    // Check characteristic properties
                    int properties = characteristic.getProperties();
                    charMap.putBoolean("isReadable", (properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
                    charMap.putBoolean("isWritableWithResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
                    charMap.putBoolean("isWritableWithoutResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0);
                    charMap.putBoolean("isNotifiable", (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
                    charMap.putBoolean("isIndicatable", (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0);
                    charMap.putString("value", null); // Value is not stored, only read when needed
                    
                    characteristicsArray.pushMap(charMap);
                }
                
                serviceMap.putArray("characteristics", characteristicsArray);
                servicesArray.pushMap(serviceMap);
            }
            
            Log.d(TAG, "📋 Returning " + servicesArray.size() + " services for device: " + deviceId);
            
            // Return services in the format expected by JavaScript
            WritableMap result = Arguments.createMap();
            result.putArray("services", servicesArray);
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting device services: " + e.getMessage());
            promise.reject("SERVICES_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void writeCharacteristic(String deviceId, String characteristicUuid, String data, Promise promise) {
        String writeKey = deviceId + "_" + characteristicUuid;
        try {
            Log.d(TAG, "🔧 writeCharacteristic called for device: " + deviceId + ", characteristic: " + characteristicUuid + ", data: " + data);
            
            // Validate operation
            if (!validateOperation(deviceId, characteristicUuid, "WRITE_CHARACTERISTIC")) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            
            // Check for concurrent writes to the same characteristic
            if (pendingWrites.contains(writeKey)) {
                Log.w(TAG, "⚠️ Write already pending for characteristic: " + characteristicUuid + " on device: " + deviceId);
                rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED, 
                    "Write already pending", "Concurrent write operation", deviceId, null, characteristicUuid));
                return;
            }
            
            // Validate device connection
            if (!validateDeviceConnection(deviceId)) {
                rejectWithBLEError(promise, BLEError.deviceNotConnected(deviceId));
                return;
            }
            
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            
            // Generate transaction ID for better tracking
            String transactionId = TransactionManager.generateWriteTransactionId(deviceId, characteristicUuid);
            
            // Store transaction ID for callback lookup
            writeTransactionIds.put(writeKey, transactionId);
            
            // Add transaction with timeout (increased for system commands)
            int timeoutMs = characteristicUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ? 30000 : 10000; // 30s for system commands, 10s for others
            transactionManager.addTransaction(transactionId, promise, "WRITE_CHARACTERISTIC", deviceId, timeoutMs);
            
            // Mark this write as pending
            pendingWrites.add(writeKey);
            
            // Convert hex string to byte array using BLEUtils
            byte[] dataBytes;
            try {
                dataBytes = BLEUtils.hexToBytes(data);
                Log.d(TAG, "🔧 Converted hex data to " + dataBytes.length + " bytes using BLEUtils");
            } catch (IllegalArgumentException e) {
                Log.e(TAG, "❌ Failed to convert hex string to byte array: " + data, e);
                pendingWrites.remove(writeKey);
                writeTransactionIds.remove(writeKey);
                transactionManager.rejectTransaction(transactionId, BLEError.invalidWriteData(data, characteristicUuid));
                return;
            }
            
            // Set the characteristic value
            characteristic.setValue(dataBytes);
            
            // Configure write type based on characteristic properties
            int properties = characteristic.getProperties();
            if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) {
                characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
                Log.d(TAG, "🔧 Using WRITE_TYPE_DEFAULT for characteristic: " + characteristicUuid);
            } else if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
                Log.d(TAG, "🔧 Using WRITE_TYPE_NO_RESPONSE for characteristic: " + characteristicUuid);
            }
            
            // Perform the write operation
            Log.d(TAG, "🔧 About to call gatt.writeCharacteristic() for: " + characteristicUuid + " (transaction: " + transactionId + ")");
            boolean writeResult = gatt.writeCharacteristic(characteristic);
            Log.d(TAG, "🔧 Write operation result: " + writeResult);
            
            if (writeResult) {
                Log.d(TAG, "✅ Successfully initiated write to characteristic: " + characteristicUuid);
                Log.d(TAG, "📊 Write data: " + BLEUtils.formatBytesForLogging(dataBytes) + " (" + dataBytes.length + " bytes)");
                
                // Schedule removal of pending write after a timeout
                executorService.schedule(() -> {
                    pendingWrites.remove(writeKey);
                    Log.d(TAG, "🔄 Removed pending write flag for: " + writeKey);
                }, 2, TimeUnit.SECONDS);
                
                // Transaction will be resolved in the callback
            } else {
                Log.e(TAG, "❌ Failed to initiate write to characteristic: " + characteristicUuid);
                Log.e(TAG, "📊 Failed write data: " + BLEUtils.formatBytesForLogging(dataBytes) + " (" + dataBytes.length + " bytes)");
                Log.e(TAG, "📊 Characteristic properties: 0x" + String.format("%02x", characteristic.getProperties()));
                Log.e(TAG, "📊 Write type: " + characteristic.getWriteType());
                
                pendingWrites.remove(writeKey);
                writeTransactionIds.remove(writeKey);
                transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED.name(), 
                    "Failed to initiate write operation");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception during write: " + e.getMessage());
            pendingWrites.remove(writeKey);
            writeTransactionIds.remove(writeKey);
            rejectWithBLEError(promise, BLEError.permissionDenied("BLUETOOTH_CONNECT"));
        } catch (Exception e) {
            Log.e(TAG, "❌ Exception during write: " + e.getMessage(), e);
            pendingWrites.remove(writeKey);
            writeTransactionIds.remove(writeKey);
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED, 
                "Write failed", e.getMessage(), deviceId, null, characteristicUuid));
        }
    }
    
    @ReactMethod
    public void enableNotifications(String deviceId, String characteristicUuid, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("CONNECTION_ERROR", "Device not connected");
                return;
            }
            
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            if (characteristic == null) {
                promise.reject("CHARACTERISTIC_ERROR", "Characteristic not found");
                return;
            }
            
            enableNotifications(gatt, characteristic);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("NOTIFICATION_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getCharacteristicInfo(String deviceId, String characteristicUuid, Promise promise) {
        try {
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            if (characteristic == null) {
                promise.reject("CHARACTERISTIC_ERROR", "Characteristic not found");
                return;
            }
            
            WritableMap info = Arguments.createMap();
            info.putString("uuid", characteristic.getUuid().toString());
            info.putInt("properties", characteristic.getProperties());
            info.putBoolean("canRead", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
            info.putBoolean("canWrite", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
            info.putBoolean("canWriteNoResponse", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0);
            info.putBoolean("canNotify", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
            info.putBoolean("canIndicate", (characteristic.getProperties() & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0);
            
            promise.resolve(info);
        } catch (Exception e) {
            promise.reject("INFO_ERROR", e.getMessage());
        }
    }
    
    // Helper method to convert hex string to byte array
    private byte[] hexStringToByteArray(String hexString) {
        int len = hexString.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hexString.charAt(i), 16) << 4)
                                 + Character.digit(hexString.charAt(i+1), 16));
        }
        return data;
    }
    
    // Helper method to validate device connection state
    private boolean isDeviceConnected(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.d(TAG, "🔍 Device not in connected GATT map: " + deviceId);
            return false;
        }
        
        // Check if device is actually connected
        BluetoothDevice device = gatt.getDevice();
        if (device == null) {
            Log.d(TAG, "🔍 Device object is null for: " + deviceId);
            return false;
        }
        
        // Additional validation - check if we have characteristics for this device
        boolean hasCharacteristics = false;
        for (String key : deviceCharacteristics.keySet()) {
            if (key.startsWith(deviceId + "_")) {
                hasCharacteristics = true;
                break;
            }
        }
        
        if (!hasCharacteristics) {
            Log.d(TAG, "🔍 No characteristics found for device: " + deviceId);
            return false;
        }
        
        Log.d(TAG, "✅ Device connection validated: " + deviceId);
        return true;
    }
    
    // Helper method to check if a characteristic exists and is writable
    private boolean isCharacteristicWritable(String deviceId, String characteristicUuid) {
        BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
        if (characteristic == null) {
            Log.d(TAG, "🔍 Characteristic not found: " + characteristicUuid + " for device: " + deviceId);
            return false;
        }
        
        int properties = characteristic.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 ||
                          (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        
        Log.d(TAG, "🔍 Characteristic " + characteristicUuid + " writable: " + canWrite + 
              " (properties: 0x" + String.format("%02x", properties) + ")");
        
        return canWrite;
    }

    // MARK: - Operation Queue Methods (Following Punch Through Guide)
    
    @ReactMethod
    public void enqueueReadOperation(String deviceId, String characteristicUuid, Promise promise) {
        try {
            BLEConnectionManager.BLEOperation operation = new BLEConnectionManager.BLEOperation() {
                private boolean complete = false;
                
                @Override
                public void execute(BluetoothGatt gatt) {
                    BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
                    if (characteristic != null) {
                        gatt.readCharacteristic(characteristic);
                    } else {
                        complete = true;
                        promise.reject("CHARACTERISTIC_ERROR", "Characteristic not found");
                    }
                }
                
                @Override
                public String getOperationName() {
                    return "ReadCharacteristic";
                }
                
                @Override
                public boolean isComplete() {
                    return complete;
                }
                
                @Override
                public void setComplete(boolean complete) {
                    this.complete = complete;
                }
            };
            
            connectionManager.enqueueOperation(deviceId, operation);
            Log.d(TAG, "📋 Enqueued read operation for device: " + deviceId);
        } catch (Exception e) {
            promise.reject("QUEUE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void enqueueWriteOperation(String deviceId, String characteristicUuid, String data, Promise promise) {
        try {
            BLEConnectionManager.BLEOperation operation = new BLEConnectionManager.BLEOperation() {
                private boolean complete = false;
                
                @Override
                public void execute(BluetoothGatt gatt) {
                    BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
                    if (characteristic != null) {
                        byte[] dataBytes = hexStringToByteArray(data);
                        characteristic.setValue(dataBytes);
                        gatt.writeCharacteristic(characteristic);
                    } else {
                        complete = true;
                        promise.reject("CHARACTERISTIC_ERROR", "Characteristic not found");
                    }
                }
                
                @Override
                public String getOperationName() {
                    return "WriteCharacteristic";
                }
                
                @Override
                public boolean isComplete() {
                    return complete;
                }
                
                @Override
                public void setComplete(boolean complete) {
                    this.complete = complete;
                }
            };
            
            connectionManager.enqueueOperation(deviceId, operation);
            Log.d(TAG, "📋 Enqueued write operation for device: " + deviceId);
        } catch (Exception e) {
            promise.reject("QUEUE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void signalOperationComplete(String deviceId) {
        connectionManager.onOperationComplete(deviceId);
        Log.d(TAG, "✅ Operation completed for device: " + deviceId);
    }
    
    @ReactMethod
    public void getConnectionState(String deviceId, Promise promise) {
        try {
            BLEConnectionManager.DeviceConnectionState state = connectionManager.getDeviceState(deviceId);
            if (state != null) {
                WritableMap stateMap = Arguments.createMap();
                stateMap.putString("deviceId", deviceId);
                stateMap.putString("state", state.state.toString());
                stateMap.putBoolean("isConnected", state.state == BLEConnectionManager.ConnectionState.CONNECTED);
                stateMap.putInt("reconnectAttempts", state.reconnectAttempts);
                stateMap.putBoolean("isManualDisconnect", state.isManualDisconnect);
                promise.resolve(stateMap);
            } else {
                promise.reject("DEVICE_ERROR", "Device not found");
            }
        } catch (Exception e) {
            promise.reject("STATE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void startBackgroundMonitoring(String deviceId, Promise promise) {
        try {
            // Ensure foreground service is running first
            if (!isServiceRunning || bleService == null) {
                Log.d(TAG, "Starting foreground service before background monitoring");
                startForegroundService();
                
                // Wait a bit for service to start
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        if (bleService != null) {
                            Intent intent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
                            intent.putExtra("action", "start_monitoring");
                            intent.putExtra("device_id", deviceId);
                            getReactApplicationContext().startService(intent);
                            promise.resolve(true);
                        } else {
                            promise.reject("SERVICE_ERROR", "Foreground service failed to start");
                        }
                    } catch (Exception e) {
                        promise.reject("MONITORING_ERROR", e.getMessage());
                    }
                }, 1000); // Wait 1 second for service to start
            } else {
                Intent intent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
                intent.putExtra("action", "start_monitoring");
                intent.putExtra("device_id", deviceId);
                getReactApplicationContext().startService(intent);
                promise.resolve(true);
            }
        } catch (Exception e) {
            promise.reject("MONITORING_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void isForegroundServiceRunning(Promise promise) {
        try {
            promise.resolve(isServiceRunning && bleService != null);
        } catch (Exception e) {
            promise.reject("SERVICE_CHECK_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void startForegroundService(Promise promise) {
        try {
            Log.d(TAG, "🚀 Manually starting foreground service");
            startForegroundService();
            
            // Wait a bit and check if service started
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    promise.resolve(isServiceRunning && bleService != null);
                } catch (Exception e) {
                    promise.reject("SERVICE_START_ERROR", e.getMessage());
                }
            }, 2000); // Wait 2 seconds for service to start
        } catch (Exception e) {
            promise.reject("SERVICE_START_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void testForegroundService(Promise promise) {
        try {
            Log.d(TAG, "🧪 Testing foreground service functionality");
            
            WritableMap result = Arguments.createMap();
            
            // Check if service is running
            boolean isRunning = isServiceRunning && bleService != null;
            result.putBoolean("isServiceRunning", isRunning);
            result.putBoolean("isServiceBound", bleService != null);
            
            if (!isRunning) {
                Log.d(TAG, "🚀 Starting foreground service for testing");
                startForegroundService();
                
                // Wait and check again
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        boolean started = isServiceRunning && bleService != null;
                        result.putBoolean("startedSuccessfully", started);
                        promise.resolve(result);
                    } catch (Exception e) {
                        promise.reject("SERVICE_TEST_ERROR", e.getMessage());
                    }
                }, 3000); // Wait 3 seconds
            } else {
                result.putBoolean("startedSuccessfully", true);
                promise.resolve(result);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error testing foreground service: " + e.getMessage());
            promise.reject("SERVICE_TEST_ERROR", e.getMessage());
        }
    }
    
    // MARK: - Enhanced BLE Methods Using New Classes
    
    /**
     * Get transaction status for debugging
     */
    @ReactMethod
    public void getTransactionStatus(Promise promise) {
        try {
            WritableMap status = Arguments.createMap();
            status.putInt("totalTransactions", transactionManager.getTransactionCount());
            status.putInt("pendingReads", pendingReadPromises.size());
            status.putInt("pendingServiceDiscovery", pendingServiceDiscoveryPromises.size());
            status.putInt("pendingWrites", pendingWrites.size());
            status.putInt("connectedDevices", connectedGatts.size());
            
            promise.resolve(status);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.SYSTEM_ERROR, 
                "Failed to get transaction status", e.getMessage()));
        }
    }
    
    /**
     * Cancel all transactions for a device
     */
    @ReactMethod
    public void cancelAllTransactionsForDevice(String deviceId, Promise promise) {
        try {
            int cancelledCount = transactionManager.cancelAllTransactionsForDevice(deviceId);
            Log.d(TAG, "Cancelled " + cancelledCount + " transactions for device: " + deviceId);
            promise.resolve(cancelledCount);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.SYSTEM_ERROR, 
                "Failed to cancel transactions", e.getMessage(), deviceId));
        }
    }
    
    /**
     * Get enhanced characteristic information
     */
    @ReactMethod
    public void getEnhancedCharacteristicInfo(String deviceId, String characteristicUuid, Promise promise) {
        try {
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            if (characteristic == null) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            
            // Create characteristic info map directly
            WritableMap characteristicInfo = Arguments.createMap();
            characteristicInfo.putString("uuid", characteristic.getUuid().toString());
            characteristicInfo.putString("deviceId", deviceId);
            characteristicInfo.putInt("instanceId", characteristic.getInstanceId());
            
            // Properties
            int properties = characteristic.getProperties();
            characteristicInfo.putBoolean("isReadable", (properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
            characteristicInfo.putBoolean("isWritableWithResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
            characteristicInfo.putBoolean("isWritableWithoutResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0);
            characteristicInfo.putBoolean("isNotifiable", (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
            characteristicInfo.putBoolean("isIndicatable", (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0);
            characteristicInfo.putInt("properties", properties);
            characteristicInfo.putInt("writeType", characteristic.getWriteType());
            
            // Value
            byte[] value = characteristic.getValue();
            if (value != null && value.length > 0) {
                characteristicInfo.putString("value", BLEUtils.bytesToBase64(value));
            } else {
                characteristicInfo.putNull("value");
            }
            
            promise.resolve(characteristicInfo);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to get characteristic info", e.getMessage()));
        }
    }
    
    /**
     * Convert data using BLEUtils
     */
    @ReactMethod
    public void convertData(String inputData, String inputFormat, String outputFormat, Promise promise) {
        try {
            String result;
            
            switch (inputFormat.toLowerCase()) {
                case "hex":
                    byte[] bytes = BLEUtils.hexToBytes(inputData);
                    switch (outputFormat.toLowerCase()) {
                        case "base64":
                            result = BLEUtils.bytesToBase64(bytes);
                            break;
                        case "string":
                            result = new String(bytes);
                            break;
                        default:
                            throw new IllegalArgumentException("Unsupported output format: " + outputFormat);
                    }
                    break;
                    
                case "base64":
                    byte[] base64Bytes = BLEUtils.base64ToBytes(inputData);
                    switch (outputFormat.toLowerCase()) {
                        case "hex":
                            result = BLEUtils.bytesToHex(base64Bytes);
                            break;
                        case "string":
                            result = new String(base64Bytes);
                            break;
                        default:
                            throw new IllegalArgumentException("Unsupported output format: " + outputFormat);
                    }
                    break;
                    
                case "string":
                    byte[] stringBytes = inputData.getBytes();
                    switch (outputFormat.toLowerCase()) {
                        case "hex":
                            result = BLEUtils.bytesToHex(stringBytes);
                            break;
                        case "base64":
                            result = BLEUtils.bytesToBase64(stringBytes);
                            break;
                        default:
                            throw new IllegalArgumentException("Unsupported output format: " + outputFormat);
                    }
                    break;
                    
                default:
                    throw new IllegalArgumentException("Unsupported input format: " + inputFormat);
            }
            
            promise.resolve(result);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.INVALID_WRITE_DATA, 
                "Data conversion failed", e.getMessage()));
        }
    }
    
    /**
     * Validate UUID format
     */
    @ReactMethod
    public void validateUUID(String uuidString, Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putBoolean("isValid", BLEUtils.isValidUUID(uuidString));
            result.putBoolean("isStandardBluetooth", BLEUtils.isStandardBluetoothUUID(uuidString));
            result.putString("normalized", BLEUtils.normalizeUUID(uuidString));
            result.putString("shortUuid", BLEUtils.extractShortUUID(uuidString));
            
            promise.resolve(result);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.INVALID_IDENTIFIERS, 
                "UUID validation failed", e.getMessage()));
        }
    }
    
    /**
     * Cleanup all resources
     */
    @ReactMethod
    public void cleanupResources(Promise promise) {
        try {
            cleanup();
            promise.resolve(true);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.SYSTEM_ERROR, 
                "Cleanup failed", e.getMessage()));
        }
    }
    
    /**
     * Parse advertisement data from scan record
     */
    @ReactMethod
    public void parseAdvertisementData(String base64ScanRecord, Promise promise) {
        try {
            byte[] scanRecord = BLEUtils.base64ToBytes(base64ScanRecord);
            AdvertisementDataParser.AdvertisementData advData = AdvertisementDataParser.parseScanRecord(scanRecord);
            promise.resolve(advData.toJSObject());
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Advertisement parsing failed", e.getMessage()));
        }
    }
    
    /**
     * Set BLE log level
     */
    @ReactMethod
    public void setBLELogLevel(String logLevel, Promise promise) {
        try {
            BLELogLevel.setLogLevel(logLevel);
            promise.resolve(BLELogLevel.getCurrentLogLevelString());
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to set log level", e.getMessage()));
        }
    }
    
    /**
     * Get BLE log level
     */
    @ReactMethod
    public void getBLELogLevel(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putString("currentLevel", BLELogLevel.getCurrentLogLevelString());
            result.putInt("currentLevelInt", BLELogLevel.getCurrentLogLevel());
            
            WritableMap availableLevels = Arguments.createMap();
            String[] levels = BLELogLevel.getAvailableLogLevels();
            for (int i = 0; i < levels.length; i++) {
                availableLevels.putString(String.valueOf(i), levels[i]);
            }
            result.putMap("availableLevels", availableLevels);
            
            promise.resolve(result);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to get log level", e.getMessage()));
        }
    }
    
    /**
     * Get ID generator statistics
     */
    @ReactMethod
    public void getIDGeneratorStatistics(Promise promise) {
        try {
            HashMap<String, Integer> stats = BLEIdGenerator.getStatistics();
            WritableMap result = Arguments.createMap();
            
            for (Map.Entry<String, Integer> entry : stats.entrySet()) {
                result.putInt(entry.getKey(), entry.getValue());
            }
            
            result.putBoolean("isValid", BLEIdGenerator.validateIdUniqueness());
            
            promise.resolve(result);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to get ID statistics", e.getMessage()));
        }
    }
    
    /**
     * Clear ID generator for a specific device
     */
    @ReactMethod
    public void clearDeviceIDs(String deviceId, Promise promise) {
        try {
            int removedCount = BLEIdGenerator.removeDeviceIds(deviceId);
            promise.resolve(removedCount);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to clear device IDs", e.getMessage()));
        }
    }
    
    /**
     * Generate service ID
     */
    @ReactMethod
    public void generateServiceId(String deviceId, String serviceUuid, Promise promise) {
        try {
            int serviceId = BLEIdGenerator.generateServiceId(deviceId, serviceUuid);
            promise.resolve(serviceId);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to generate service ID", e.getMessage()));
        }
    }
    
    /**
     * Generate characteristic ID
     */
    @ReactMethod
    public void generateCharacteristicId(String deviceId, int serviceId, String characteristicUuid, Promise promise) {
        try {
            int characteristicId = BLEIdGenerator.generateCharacteristicId(deviceId, serviceId, characteristicUuid);
            promise.resolve(characteristicId);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to generate characteristic ID", e.getMessage()));
        }
    }
    
    /**
     * Test enhanced error handling
     */
    @ReactMethod
    public void testEnhancedErrorHandling(String errorType, Promise promise) {
        try {
            BLEError testError;
            
            switch (errorType.toLowerCase()) {
                case "device_not_found":
                    testError = BLEError.deviceNotFound("test-device-id");
                    break;
                case "characteristic_not_found":
                    testError = BLEError.characteristicNotFound("test-characteristic-uuid", "test-device-id");
                    break;
                case "permission_denied":
                    testError = BLEError.permissionDenied("BLUETOOTH_CONNECT");
                    break;
                case "operation_timeout":
                    testError = BLEError.operationTimeout("READ", "test-device-id");
                    break;
                case "invalid_write_data":
                    testError = BLEError.invalidWriteData("invalid-hex-data", "test-characteristic-uuid");
                    break;
                case "system_error":
                    testError = BLEError.systemError("Test system error", "This is a test error message");
                    break;
                default:
                    testError = BLEError.unknownError("Unknown test error", "This is a test of unknown error handling");
                    break;
            }
            
            promise.resolve(testError.toJSObject());
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to test error handling", e.getMessage()));
        }
    }
    
    @ReactMethod
    public void stopBackgroundMonitoring(String deviceId, Promise promise) {
        try {
            if (bleService != null) {
                Intent intent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
                intent.putExtra("action", "stop_monitoring");
                intent.putExtra("device_id", deviceId);
                getReactApplicationContext().startService(intent);
                promise.resolve(true);
            } else {
                promise.reject("SERVICE_ERROR", "Foreground service not available");
            }
        } catch (Exception e) {
            promise.reject("MONITORING_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void sendSystemCommand(String deviceId, int command, ReadableArray payload, Promise promise) {
        try {
            Log.d(TAG, "🔧 Sending system command 0x" + Integer.toHexString(command) + " to device: " + deviceId);
            
            // ✅ CONSOLIDATED: Convert ReadableArray to byte array
            byte[] payloadBytes = new byte[payload != null ? payload.size() : 0];
            if (payload != null) {
                for (int i = 0; i < payload.size(); i++) {
                    payloadBytes[i] = (byte) payload.getInt(i);
                }
            }
            
            // ✅ USE HELPER METHOD: Reuse existing sendSystemCommand helper
            boolean success = sendSystemCommand(deviceId, (byte) command, payloadBytes);
            
            if (success) {
                Log.d(TAG, "✅ System command sent successfully");
                promise.resolve(true);
            } else {
                promise.reject("WRITE_FAILED", "Failed to write system command");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error sending system command: " + e.getMessage());
            promise.reject("SYSTEM_COMMAND_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void cancelConnection(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔌 Manual disconnect from device: " + deviceId + " (system-style)");
            
            // Mark this as a manual disconnect
            manualDisconnectInProgress.add(deviceId);
            
            // Set a timeout to clear manual disconnect tracking after 30 minutes
            // This prevents the tracking from persisting indefinitely
            mainHandler.postDelayed(() -> {
                if (manualDisconnectInProgress.contains(deviceId)) {
                    Log.d(TAG, "⏰ Clearing manual disconnect tracking after 30 minutes for: " + deviceId);
                    manualDisconnectInProgress.remove(deviceId);
                }
            }, 1800000); // 30 minutes in milliseconds
            
            // Use ConnectionManager to disconnect
            if (connectionManager != null) {
                connectionManager.disconnectDevice(deviceId);
                promise.resolve(true);
            } else {
                // Fallback to direct GATT disconnection
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                    connectedGatts.remove(deviceId);
                    promise.resolve(true);
                } else {
                    Log.w(TAG, "Device not connected: " + deviceId);
                    promise.resolve(true); // Already disconnected
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error cancelling connection: " + e.getMessage());
            promise.reject("CANCEL_ERROR", e.getMessage());
        }
    }
    
    // MARK: - Battery Optimization Management
    
    @ReactMethod
    public void checkBatteryOptimization(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager powerManager = (PowerManager) getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
                boolean isIgnoringBatteryOptimizations = powerManager.isIgnoringBatteryOptimizations(getReactApplicationContext().getPackageName());
                
                WritableMap result = Arguments.createMap();
                result.putBoolean("isIgnoringBatteryOptimizations", isIgnoringBatteryOptimizations);
                result.putBoolean("canRequestIgnoreBatteryOptimizations", Build.VERSION.SDK_INT >= Build.VERSION_CODES.M);
                result.putString("message", isIgnoringBatteryOptimizations ? 
                    "Battery optimization is disabled for this app" : 
                    "Battery optimization is enabled and may affect BLE connections");
                
                promise.resolve(result);
            } else {
                WritableMap result = Arguments.createMap();
                result.putBoolean("isIgnoringBatteryOptimizations", true);
                result.putBoolean("canRequestIgnoreBatteryOptimizations", false);
                result.putString("message", "Battery optimization not available on this Android version");
                promise.resolve(result);
            }
        } catch (Exception e) {
            promise.reject("BATTERY_CHECK_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void requestIgnoreBatteryOptimizations(Promise promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                Intent intent = new Intent();
                String packageName = getReactApplicationContext().getPackageName();
                PowerManager pm = (PowerManager) getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
                
                if (pm.isIgnoringBatteryOptimizations(packageName)) {
                    promise.resolve(true);
                    return;
                }
                
                intent.setAction(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                intent.setData(android.net.Uri.parse("package:" + packageName));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                
                getReactApplicationContext().startActivity(intent);
                promise.resolve(true);
            } else {
                promise.reject("BATTERY_REQUEST_ERROR", "Battery optimization request not available on this Android version");
            }
        } catch (Exception e) {
            promise.reject("BATTERY_REQUEST_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void openBatteryOptimizationSettings(Promise promise) {
        try {
            Intent intent = new Intent();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                intent.setAction(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            } else {
                intent.setAction(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(android.net.Uri.parse("package:" + getReactApplicationContext().getPackageName()));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            
            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SETTINGS_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getBatteryOptimizationGuidance(Promise promise) {
        try {
            WritableMap guidance = Arguments.createMap();
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager powerManager = (PowerManager) getReactApplicationContext().getSystemService(Context.POWER_SERVICE);
                boolean isIgnoringBatteryOptimizations = powerManager.isIgnoringBatteryOptimizations(getReactApplicationContext().getPackageName());
                
                guidance.putBoolean("isOptimized", !isIgnoringBatteryOptimizations);
                guidance.putString("title", isIgnoringBatteryOptimizations ? 
                    "Battery Optimization Disabled ✅" : 
                    "Battery Optimization Enabled ⚠️");
                guidance.putString("message", isIgnoringBatteryOptimizations ? 
                    "Your app is protected from battery optimization. BLE connections should work reliably in the background." :
                    "Battery optimization is enabled and may terminate your app's background processes, affecting BLE connections.");
                guidance.putString("action", isIgnoringBatteryOptimizations ? 
                    "No action needed" : 
                    "Disable battery optimization for reliable BLE connections");
                guidance.putString("url", "https://dontkillmyapp.com/");
            } else {
                guidance.putBoolean("isOptimized", false);
                guidance.putString("title", "Battery Optimization Not Available");
                guidance.putString("message", "Battery optimization is not available on this Android version.");
                guidance.putString("action", "No action needed");
                guidance.putString("url", "");
            }
            
            promise.resolve(guidance);
        } catch (Exception e) {
            promise.reject("GUIDANCE_ERROR", e.getMessage());
        }
    }
    
    // MARK: - Health Data API Management
    
    @ReactMethod
    public void startHealthDataApiMonitoring(String deviceId, int intervalMs, Promise promise) {
        try {
            Log.d(TAG, "📤 Starting health data API monitoring for device: " + deviceId + " with interval: " + intervalMs + "ms");
            
            // Stop existing monitoring if any
            stopHealthDataApiMonitoringInternal(deviceId);
            
            // Create periodic health data API task
            Runnable healthApiTask = new Runnable() {
                @Override
                public void run() {
                    try {
                        DeviceData deviceData = deviceDataMap.get(deviceId);
                        if (deviceData != null && deviceData.connectionState != null && deviceData.connectionState.equals("connected")) {
                            Log.d(TAG, "📤 Native health data API monitoring: Triggering API call for device: " + deviceId);
                            
                            // Create device data map for API call
                            WritableMap deviceDataMap = createDeviceInfoMap(deviceData);
                            
                            // Send event to JavaScript to trigger API call
                            sendHealthDataApiEvent(deviceId, deviceDataMap);
                        } else {
                            Log.d(TAG, "📤 Device not connected, skipping health data API call for: " + deviceId);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Health data API monitoring error: " + e.getMessage());
                    }
                }
            };
            
            // Schedule periodic health data API calls
            ScheduledFuture<?> task = executorService.scheduleAtFixedRate(healthApiTask, 0, intervalMs, TimeUnit.MILLISECONDS);
            
            // Store the task for later cancellation
            healthApiTasks.put(deviceId, task);
            
            promise.resolve(true);
            Log.d(TAG, "✅ Health data API monitoring started successfully for device: " + deviceId);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting health data API monitoring: " + e.getMessage());
            promise.reject("HEALTH_API_MONITORING_ERROR", e.getMessage());
        }
    }
    
    // Private helper method to stop health data API monitoring without Promise
    private void stopHealthDataApiMonitoringInternal(String deviceId) {
        try {
            Log.d(TAG, "🛑 Stopping health data API monitoring for device: " + deviceId);
            
            ScheduledFuture<?> task = healthApiTasks.remove(deviceId);
            if (task != null) {
                task.cancel(true);
                Log.d(TAG, "✅ Health data API monitoring stopped for device: " + deviceId);
            } else {
                Log.d(TAG, "ℹ️ No health data API monitoring found for device: " + deviceId);
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping health data API monitoring: " + e.getMessage());
        }
    }
    
    @ReactMethod
    public void stopHealthDataApiMonitoring(String deviceId, Promise promise) {
        try {
            stopHealthDataApiMonitoringInternal(deviceId);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping health data API monitoring: " + e.getMessage());
            promise.reject("HEALTH_API_MONITORING_ERROR", e.getMessage());
        }
    }
    
    // MARK: - RSSI Management
    
    /**
     * Send system command to device (helper method)
     */
    private boolean sendSystemCommand(String deviceId, byte commandId, byte[] payload) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "❌ Failed to send system command: Device not connected");
            return false;
        }
        
        BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
        if (systemCommandChar == null) {
            Log.e(TAG, "❌ Failed to send system command: SYSTEM_COMMAND characteristic not found");
            return false;
        }
        
        byte[] packet = buildSystemCommandPacket(commandId, payload);
        systemCommandChar.setValue(packet);
        return gatt.writeCharacteristic(systemCommandChar);
    }
    
    /**
     * ✅ WORKAROUND: Start periodic polling of Device Status characteristic (matching iOS)
     * This is needed because firmware doesn't auto-send notifications after SET_DATA_ACQUISITION_INTERVAL
     */
    private void startDeviceStatusPolling(String deviceId, int intervalSeconds) {
        // Stop any existing timer
        stopDeviceStatusPolling(deviceId);
        
        Log.d(TAG, "🔄 [POLLING WORKAROUND] Starting periodic Device Status polling every " + intervalSeconds + " seconds");
        
        // Create repeating task
        ScheduledFuture<?> pollingTask = executorService.scheduleAtFixedRate(new Runnable() {
            @Override
            public void run() {
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt == null) {
                    Log.w(TAG, "⚠️ [POLLING] Device disconnected, stopping polling");
                    stopDeviceStatusPolling(deviceId);
                    return;
                }
                
                BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
                if (deviceStatusChar == null) {
                    Log.w(TAG, "⚠️ [POLLING] Device Status characteristic not found");
                    return;
                }
                
                Log.d(TAG, "🔄 [POLLING] Reading Device Status from " + deviceId);
                gatt.readCharacteristic(deviceStatusChar);
            }
        }, intervalSeconds, intervalSeconds, TimeUnit.SECONDS);
        
        deviceStatusPollingTimers.put(deviceId, pollingTask);
        Log.d(TAG, "✅ [POLLING] Timer started for " + deviceId);
    }
    
    /**
     * Stop periodic polling
     */
    private void stopDeviceStatusPolling(String deviceId) {
        ScheduledFuture<?> pollingTask = deviceStatusPollingTimers.get(deviceId);
        if (pollingTask != null) {
            pollingTask.cancel(false);
            deviceStatusPollingTimers.remove(deviceId);
            Log.d(TAG, "🛑 [POLLING] Stopped for " + deviceId);
        }
    }
    
    /**
     * ✅ NEW: Single native method to handle full command sequence (matching iOS)
     * This is called by JS after service discovery complete
     * Handles: Time Sync → Wait → Data Sync (all in native, no JS involvement)
     */
    @ReactMethod
    public void startCommandSequence(String deviceId, Promise promise) {
        Log.d(TAG, "🚀 [NATIVE SEQUENCE] Starting full command sequence for " + deviceId);
        
        // ✅ RACE CONDITION FIX: Use putIfAbsent for atomic check-and-set
        Boolean previousValue = systemCommandsSent.putIfAbsent(deviceId, true);
        if (previousValue != null && previousValue) {
            Log.w(TAG, "⚠️ [NATIVE SEQUENCE] Command sequence already running for " + deviceId);
            WritableMap result = Arguments.createMap();
            result.putString("status", "already_running");
            result.putString("message", "Command sequence already running for this device");
            promise.resolve(result);
            return;
        }
        
        // Initialize state (only if we won the race to set the flag)
        dataSyncState.put(deviceId, "idle");
        dataSyncRequested.put(deviceId, false);
        
        // ✅ ANDROID: Command sequence will be triggered automatically when all notifications are enabled
        // See onNotificationEnabled() which triggers after all descriptor writes complete
        Log.d(TAG, "⏰ [NATIVE SEQUENCE] Command sequence will start when all notifications are enabled");
        
        // Step 3: Data sync will be triggered automatically by time sync response handler
        // See parseSystemCommandResponse case CMD_SET_SYSTEM_TIME
        
        WritableMap result = Arguments.createMap();
        result.putString("status", "success");
        result.putString("message", "Command sequence will start when notifications are ready");
        result.putString("deviceId", deviceId);
        promise.resolve(result);
    }
    
    /**
     * Send Set System Time command (Command ID: 0x01)
     */
    private void sendSetSystemTimeCommand(String deviceId) {
        // Update state to time_syncing
        dataSyncState.put(deviceId, "time_syncing");
        
        // Get current Unix timestamp in seconds
        long currentTimestamp = System.currentTimeMillis() / 1000;
        
        // Convert to little-endian byte array
        byte[] payload = new byte[4];
        payload[0] = (byte) (currentTimestamp & 0xFF);
        payload[1] = (byte) ((currentTimestamp >> 8) & 0xFF);
        payload[2] = (byte) ((currentTimestamp >> 16) & 0xFF);
        payload[3] = (byte) ((currentTimestamp >> 24) & 0xFF);
        
        // Log the command being sent
        String timestampHex = String.format("%02X%02X%02X%02X", payload[0], payload[1], payload[2], payload[3]);
        Log.d(TAG, "📤 Sending Set System Time command to " + deviceId);
        Log.d(TAG, "   Command: AA 01 04 " + timestampHex);
        Log.d(TAG, "   Timestamp: " + currentTimestamp + " (" + new java.util.Date(currentTimestamp * 1000) + ")");
        
        // Send command via writeCharacteristic
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "❌ Failed to send Set System Time command: Device not connected");
            dataSyncState.put(deviceId, "idle");
            return;
        }
        
        BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
        if (systemCommandChar == null) {
            Log.e(TAG, "❌ Failed to send Set System Time command: SYSTEM_COMMAND characteristic not found");
            Log.e(TAG, "   Available services: " + gatt.getServices().size());
            for (BluetoothGattService service : gatt.getServices()) {
                Log.e(TAG, "   Service: " + service.getUuid().toString());
                for (BluetoothGattCharacteristic c : service.getCharacteristics()) {
                    Log.e(TAG, "      Characteristic: " + c.getUuid().toString());
                }
            }
            dataSyncState.put(deviceId, "idle");
            return;
        }
        
        // Check characteristic properties
        int properties = systemCommandChar.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        boolean canWriteNoResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        
        Log.d(TAG, "🔍 System Command characteristic properties:");
        Log.d(TAG, "   UUID: " + systemCommandChar.getUuid().toString());
        Log.d(TAG, "   Properties: 0x" + String.format("%02X", properties));
        Log.d(TAG, "   Can Write: " + canWrite);
        Log.d(TAG, "   Can Write No Response: " + canWriteNoResponse);
        
        if (!canWrite && !canWriteNoResponse) {
            Log.e(TAG, "❌ System Command characteristic is not writable!");
            dataSyncState.put(deviceId, "idle");
            return;
        }
        
        // Set write type based on properties
        if (canWrite) {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            Log.d(TAG, "🔍 Using WRITE_TYPE_DEFAULT");
        } else {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            Log.d(TAG, "🔍 Using WRITE_TYPE_NO_RESPONSE");
        }
        
        byte[] packet = buildSystemCommandPacket(CMD_SET_SYSTEM_TIME, payload);
        Log.d(TAG, "🔍 Packet to send: " + bytesToHex(packet) + " (" + packet.length + " bytes)");
        
        systemCommandChar.setValue(packet);
        boolean success = gatt.writeCharacteristic(systemCommandChar);
        
        if (success) {
            Log.d(TAG, "✅ Set System Time command sent successfully");
        } else {
            Log.e(TAG, "❌ Failed to send Set System Time command - writeCharacteristic returned false");
            Log.e(TAG, "   This usually means:");
            Log.e(TAG, "   1. BLE stack is busy with another operation");
            Log.e(TAG, "   2. Connection is in an invalid state");
            Log.e(TAG, "   3. Write queue is full");
            dataSyncState.put(deviceId, "idle");
        }
    }
    
    /**
     * Send Data Sync Start command (Command ID: 0x08) with intelligent retry logic
     */
    private boolean sendDataSyncStartCommand(String deviceId, int retryAttempt) {
        // Check if device has records to sync (from manufacturer data)
        int recordCount = deviceRecordCounts.getOrDefault(deviceId, 0);
        
        if (recordCount == 0) {
            Log.d(TAG, "ℹ️ No record count from manufacturer data, will query device directly");
        } else {
            Log.d(TAG, "ℹ️ Expected " + recordCount + " records from manufacturer data");
        }
        
        // Update state
        dataSyncState.put(deviceId, "syncing");
        
        // CRITICAL: Mark that we've requested data sync
        dataSyncRequested.put(deviceId, true);
        Log.d(TAG, "🔒 Marked data sync as REQUESTED - will now accept data transfer notifications");
        
        Log.d(TAG, "📤 Sending Data Sync Start command to " + deviceId + " (attempt " + (retryAttempt + 1) + "/3)");
        Log.d(TAG, "   Command: AA 08 01 00");
        Log.d(TAG, "   Expected records: " + recordCount);
        
        // ✅ CRITICAL FIX: According to SDD Table 10, DATA_SYNC_START has Length=1, Data=0x00
        byte[] payload = new byte[]{0x00};
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "❌ Failed to send Data Sync Start command: Device not connected");
            dataSyncState.put(deviceId, "ready");
            dataSyncRequested.put(deviceId, false);
            return false;
        }
        
        BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
        if (systemCommandChar == null) {
            Log.e(TAG, "❌ Failed to send Data Sync Start command: SYSTEM_COMMAND characteristic not found");
            dataSyncState.put(deviceId, "ready");
            dataSyncRequested.put(deviceId, false);
            return false;
        }
        
        byte[] packet = buildSystemCommandPacket(CMD_DATA_SYNC_START, payload);
        systemCommandChar.setValue(packet);
        boolean success = gatt.writeCharacteristic(systemCommandChar);
        
        if (success) {
            Log.d(TAG, "✅ Data Sync Start command sent successfully");
        } else {
            Log.e(TAG, "❌ Failed to send Data Sync Start command");
            dataSyncState.put(deviceId, "ready");
            dataSyncRequested.put(deviceId, false);
        }
        
        return success;
    }
    
    /**
     * Helper to build system command packet from byte array payload
     */
    private byte[] buildSystemCommandPacket(byte commandId, byte[] payload) {
        byte[] packet = new byte[20];
        packet[0] = REQUEST_ID;
        packet[1] = commandId;
        packet[2] = (byte) (payload != null ? payload.length : 0);
        
        if (payload != null && payload.length > 0) {
            System.arraycopy(payload, 0, packet, 3, Math.min(payload.length, 17));
        }
        
        return packet;
    }
    
    /**
     * Helper to find a characteristic by UUID in connected GATT
     */
    private BluetoothGattCharacteristic findCharacteristic(BluetoothGatt gatt, String characteristicUuid) {
        if (gatt == null || gatt.getServices() == null) return null;
        
        for (BluetoothGattService service : gatt.getServices()) {
            for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                if (characteristic.getUuid().toString().equalsIgnoreCase(characteristicUuid)) {
                    return characteristic;
                }
            }
        }
        return null;
    }
    
    /**
     * Get current data sync state (matching iOS)
     */
    @ReactMethod
    public void getDataSyncState(String deviceId, Promise promise) {
        try {
            String state = dataSyncState.getOrDefault(deviceId, "idle");
            int retryCount = dataSyncRetryCount.getOrDefault(deviceId, 0);
            int recordCount = deviceRecordCounts.getOrDefault(deviceId, 0);
            
            WritableMap result = Arguments.createMap();
            result.putString("deviceId", deviceId);
            result.putString("state", state);
            result.putInt("retryCount", retryCount);
            result.putInt("expectedRecords", recordCount);
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
    
    /**
     * Manual data sync start (matching iOS)
     */
    @ReactMethod
    public void startDataSync(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "📤 Manual Data Sync Start requested for " + deviceId);
            
            boolean success = sendDataSyncStartCommand(deviceId, 0);
            
            if (success) {
                WritableMap result = Arguments.createMap();
                result.putString("status", "success");
                result.putString("message", "Data sync start command sent");
                result.putString("deviceId", deviceId);
                result.putString("state", dataSyncState.getOrDefault(deviceId, "unknown"));
                promise.resolve(result);
            } else {
                promise.reject("SYNC_START_ERROR", "Failed to send data sync start command");
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
    
    /**
     * Read Device Status characteristic for battery and health monitoring (matching iOS)
     */
    @ReactMethod
    public void readDeviceStatus(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "📖 Reading Device Status characteristic from " + deviceId);
            
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected");
                return;
            }
            
            BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
            if (deviceStatusChar == null) {
                promise.reject("CHARACTERISTIC_NOT_FOUND", "Device Status characteristic not found");
                return;
            }
            
            boolean success = gatt.readCharacteristic(deviceStatusChar);
            
            if (success) {
                WritableMap result = Arguments.createMap();
                result.putString("status", "success");
                result.putString("message", "Reading device status");
                result.putString("deviceId", deviceId);
                promise.resolve(result);
            } else {
                promise.reject("READ_FAILED", "Failed to read Device Status characteristic");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error reading device status: " + e.getMessage());
            promise.reject("READ_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void readDeviceRSSI(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "📡 Reading RSSI for device: " + deviceId);
            
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                Log.w(TAG, "Device not connected: " + deviceId);
                promise.reject("CONNECTION_ERROR", "Device not connected");
                return;
            }
            
            // Store promise for RSSI callback
            pendingRSSIPromises.put(deviceId, promise);
            
            // Request RSSI reading
            boolean success = gatt.readRemoteRssi();
            if (!success) {
                pendingRSSIPromises.remove(deviceId);
                promise.reject("RSSI_ERROR", "Failed to request RSSI reading");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error reading RSSI: " + e.getMessage());
            promise.reject("RSSI_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void startRSSIMonitoring(String deviceId, int intervalMs, Promise promise) {
        try {
            Log.d(TAG, "📡 Starting RSSI monitoring for device: " + deviceId + " with interval: " + intervalMs + "ms");
            
            // Stop existing monitoring if any
            stopRSSIMonitoring(deviceId);
            
            // Create periodic RSSI reading task
            Runnable rssiTask = new Runnable() {
                @Override
                public void run() {
                    try {
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (gatt != null) {
                            gatt.readRemoteRssi();
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "RSSI monitoring error: " + e.getMessage());
                    }
                }
            };
            
            // Schedule periodic RSSI readings
            executorService.scheduleAtFixedRate(rssiTask, 0, intervalMs, TimeUnit.MILLISECONDS);
            
            // Store the task for later cancellation
            reconnectTasks.put(deviceId + "_rssi", rssiTask);
            
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting RSSI monitoring: " + e.getMessage());
            promise.reject("RSSI_MONITORING_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void stopRSSIMonitoring(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "📡 Stopping RSSI monitoring for device: " + deviceId);
            
            // Remove the RSSI monitoring task
            reconnectTasks.remove(deviceId + "_rssi");
            
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping RSSI monitoring: " + e.getMessage());
            promise.reject("RSSI_MONITORING_ERROR", e.getMessage());
        }
    }
    
    // MARK: - Auto-Connect Methods
    
    @ReactMethod
    public void startAutoConnect(Promise promise) {
        try {
            Log.d(TAG, "🚀 Starting Android auto-connect functionality");
            
            // Enable auto-connect flag
            autoConnectEnabled.set(true);
            
            // Start foreground service for background operations
            startForegroundService();
            
            // Start background scanning
            connectionManager.startBackgroundScan();
            
            // Connect to bonded devices
            connectionManager.connectToBondedDevices();
            
            Log.d(TAG, "✅ Auto-connect started successfully");
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting auto-connect: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void stopAutoConnect(Promise promise) {
        try {
            Log.d(TAG, "🛑 Stopping Android auto-connect functionality");
            
            // Disable auto-connect flag
            autoConnectEnabled.set(false);
            
            // Stop background scanning
            connectionManager.stopBackgroundScan();
            
            // Disconnect all devices
            for (String deviceId : connectedGatts.keySet()) {
                connectionManager.disconnectDevice(deviceId);
            }
            
            Log.d(TAG, "✅ Auto-connect stopped successfully");
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping auto-connect: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getAutoConnectStatus(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putBoolean("enabled", autoConnectEnabled.get());
            result.putBoolean("serviceRunning", isServiceRunning && bleService != null);
            result.putInt("connectedDevices", connectedGatts.size());
            
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting auto-connect status: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void addBondedDevice(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔗 Adding device to bonded list: " + deviceId);
            
            // Add to bonded devices set
            bondedDeviceIds.add(deviceId);
            
            // Save bonded devices
            saveBondedDevices();
            
            Log.d(TAG, "✅ Device added to bonded list: " + deviceId);
            promise.resolve(true);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error adding bonded device: " + e.getMessage());
            promise.reject("BONDED_DEVICE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void removeBondedDevice(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "❌ Removing device from bonded list: " + deviceId);
            
            // Remove from bonded devices set
            bondedDeviceIds.remove(deviceId);
            
            // ✅ Add to forgotten devices to prevent auto-reconnect (matching iOS)
            forgottenDeviceIds.add(deviceId);
            
            // Save both lists
            saveBondedDevices();
            saveForgottenDevices(); // ✅ Save forgotten devices (matching iOS)
            
            Log.d(TAG, "✅ Device removed from bonded list and marked as forgotten: " + deviceId);
            
            WritableMap result = Arguments.createMap();
            result.putString("deviceId", deviceId);
            result.putString("status", "removed");
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error removing bonded device: " + e.getMessage());
            promise.reject("BONDED_DEVICE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getBondedDevices(Promise promise) {
        try {
            WritableArray devices = Arguments.createArray();
            for (String deviceId : bondedDeviceIds) {
                devices.pushString(deviceId);
            }
            
            WritableMap result = Arguments.createMap();
            result.putArray("bondedDevices", devices);
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting bonded devices: " + e.getMessage());
            promise.reject("BONDED_DEVICE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getForgottenDevices(Promise promise) {
        try {
            WritableArray devices = Arguments.createArray();
            for (String deviceId : forgottenDeviceIds) {
                devices.pushString(deviceId);
            }
            
            WritableMap result = Arguments.createMap();
            result.putArray("forgottenDevices", devices);
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting forgotten devices: " + e.getMessage());
            promise.reject("FORGOTTEN_DEVICE_ERROR", e.getMessage());
        }
    }
    
    // MARK: - Device Status Methods
    
    @ReactMethod
    public void isDeviceConnected(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            boolean isConnected = gatt != null;
            
            Log.d(TAG, "📱 Device connection status: " + deviceId + " = " + isConnected);
            promise.resolve(isConnected);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking device connection: " + e.getMessage());
            promise.reject("CONNECTION_CHECK_ERROR", e.getMessage());
        }
    }
    
    private void stopRSSIMonitoring(String deviceId) {
        try {
            reconnectTasks.remove(deviceId + "_rssi");
        } catch (Exception e) {
            Log.e(TAG, "Error stopping RSSI monitoring: " + e.getMessage());
        }
    }
    
    // MARK: - Android-Specific BLE Methods
    
    /**
     * Read characteristic for service (Android-specific)
     */
    @ReactMethod
    public void readCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
        Log.d(TAG, "🤖 Android: Reading characteristic " + characteristicUUID + " for service " + serviceUUID + " on device " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            promise.reject("DEVICE_NOT_CONNECTED", "Device " + deviceId + " is not connected");
            return;
        }
        
        BluetoothGattService service = gatt.getService(UUID.fromString(serviceUUID));
        if (service == null) {
            promise.reject("SERVICE_NOT_FOUND", "Service " + serviceUUID + " not found on device " + deviceId);
            return;
        }
        
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(UUID.fromString(characteristicUUID));
        if (characteristic == null) {
            promise.reject("CHARACTERISTIC_NOT_FOUND", "Characteristic " + characteristicUUID + " not found in service " + serviceUUID);
            return;
        }
        
        // Store promise for callback
        pendingCharacteristicPromises.put(deviceId + "_" + characteristicUUID, promise);
        
        // Read characteristic
        boolean success = gatt.readCharacteristic(characteristic);
        if (!success) {
            pendingCharacteristicPromises.remove(deviceId + "_" + characteristicUUID);
            promise.reject("READ_FAILED", "Failed to initiate read for characteristic " + characteristicUUID);
        }
    }
    
    /**
     * Write descriptor for service (Android-specific)
     */
    @ReactMethod
    public void writeDescriptorForService(String deviceId, String serviceUUID, String characteristicUUID, String descriptorUUID, String value, Promise promise) {
        Log.d(TAG, "🤖 Android: Writing descriptor " + descriptorUUID + " for characteristic " + characteristicUUID + " on device " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            promise.reject("DEVICE_NOT_CONNECTED", "Device " + deviceId + " is not connected");
            return;
        }
        
        BluetoothGattService service = gatt.getService(UUID.fromString(serviceUUID));
        if (service == null) {
            promise.reject("SERVICE_NOT_FOUND", "Service " + serviceUUID + " not found on device " + deviceId);
            return;
        }
        
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(UUID.fromString(characteristicUUID));
        if (characteristic == null) {
            promise.reject("CHARACTERISTIC_NOT_FOUND", "Characteristic " + characteristicUUID + " not found in service " + serviceUUID);
            return;
        }
        
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(UUID.fromString(descriptorUUID));
        if (descriptor == null) {
            promise.reject("DESCRIPTOR_NOT_FOUND", "Descriptor " + descriptorUUID + " not found for characteristic " + characteristicUUID);
            return;
        }
        
        // Convert hex string to bytes
        byte[] valueBytes = hexStringToByteArray(value);
        descriptor.setValue(valueBytes);
        
        // Store promise for callback
        pendingDescriptorPromises.put(deviceId + "_" + descriptorUUID, promise);
        
        // Write descriptor
        boolean success = gatt.writeDescriptor(descriptor);
        if (!success) {
            pendingDescriptorPromises.remove(deviceId + "_" + descriptorUUID);
            promise.reject("WRITE_FAILED", "Failed to initiate write for descriptor " + descriptorUUID);
        }
    }
    
    /**
     * Monitor characteristic for service (Android-specific)
     */
    @ReactMethod
    public void monitorCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
        Log.d(TAG, "🤖 Android: Starting monitoring for characteristic " + characteristicUUID + " on device " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            promise.reject("DEVICE_NOT_CONNECTED", "Device " + deviceId + " is not connected");
            return;
        }
        
        BluetoothGattService service = gatt.getService(UUID.fromString(serviceUUID));
        if (service == null) {
            promise.reject("SERVICE_NOT_FOUND", "Service " + serviceUUID + " not found on device " + deviceId);
            return;
        }
        
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(UUID.fromString(characteristicUUID));
        if (characteristic == null) {
            promise.reject("CHARACTERISTIC_NOT_FOUND", "Characteristic " + characteristicUUID + " not found in service " + serviceUUID);
            return;
        }
        
        // Enable notifications
        boolean success = gatt.setCharacteristicNotification(characteristic, true);
        if (!success) {
            promise.reject("NOTIFICATION_FAILED", "Failed to enable notifications for characteristic " + characteristicUUID);
            return;
        }
        
        // Write to CCCD descriptor to enable notifications
        BluetoothGattDescriptor cccdDescriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (cccdDescriptor != null) {
            cccdDescriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(cccdDescriptor);
        }
        
        // Store monitoring info
        String key = deviceId + "_" + characteristicUUID;
        monitoredCharacteristics.put(key, characteristic);
        
        promise.resolve(true);
    }
    
    /**
     * Stop monitoring characteristic (Android-specific)
     */
    @ReactMethod
    public void stopMonitoringCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
        Log.d(TAG, "🤖 Android: Stopping monitoring for characteristic " + characteristicUUID + " on device " + deviceId);
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            promise.reject("DEVICE_NOT_CONNECTED", "Device " + deviceId + " is not connected");
            return;
        }
        
        BluetoothGattService service = gatt.getService(UUID.fromString(serviceUUID));
        if (service == null) {
            promise.reject("SERVICE_NOT_FOUND", "Service " + serviceUUID + " not found on device " + deviceId);
            return;
        }
        
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(UUID.fromString(characteristicUUID));
        if (characteristic == null) {
            promise.reject("CHARACTERISTIC_NOT_FOUND", "Characteristic " + characteristicUUID + " not found in service " + serviceUUID);
            return;
        }
        
        // Disable notifications
        boolean success = gatt.setCharacteristicNotification(characteristic, false);
        if (!success) {
            promise.reject("NOTIFICATION_FAILED", "Failed to disable notifications for characteristic " + characteristicUUID);
            return;
        }
        
        // Write to CCCD descriptor to disable notifications
        BluetoothGattDescriptor cccdDescriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (cccdDescriptor != null) {
            cccdDescriptor.setValue(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(cccdDescriptor);
        }
        
        // Remove from monitoring
        String key = deviceId + "_" + characteristicUUID;
        monitoredCharacteristics.remove(key);
        
        promise.resolve(true);
    }

    // MARK: - Cleanup and Shutdown Methods
    
    /**
     * Cleanup resources and shutdown managers
     */
    private void cleanup() {
        Log.d(TAG, "🧹 Starting cleanup process");
        
        // Shutdown TransactionManager
        if (transactionManager != null) {
            transactionManager.shutdown();
        }
        
        // Stop scanning
        stopScanning();
        
        // Disconnect all devices
        for (String deviceId : connectedGatts.keySet()) {
            disconnectDevice(deviceId);
        }
        
        // Clear all maps
        bondedDevices.clear();
        connectedGatts.clear();
        deviceDataMap.clear();
        deviceCharacteristics.clear();
        manualDisconnectInProgress.clear();
        pendingWrites.clear();
        writeTransactionIds.clear();
        pendingReadPromises.clear();
        pendingServiceDiscoveryPromises.clear();
        
        // Stop all health data API monitoring
        for (String deviceId : healthApiTasks.keySet()) {
            stopHealthDataApiMonitoringInternal(deviceId);
        }
        healthApiTasks.clear();
        
        // Shutdown executor service
        if (executorService != null && !executorService.isShutdown()) {
            executorService.shutdown();
            try {
                if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                    executorService.shutdownNow();
                }
            } catch (InterruptedException e) {
                executorService.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        
        // Stop foreground service
        stopForegroundService();
        
        Log.d(TAG, "✅ Cleanup completed");
    }
    
    /**
     * React Native module cleanup
     */
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        Log.d(TAG, "🧹 BLE Module destroyed - cleaning up resources");
        
        // Stop all health check timers
        if (healthCheckTimer != null) {
            healthCheckTimer.cancel();
            healthCheckTimer = null;
        }
        
        // Cancel all scheduled futures
        for (ScheduledFuture<?> future : healthApiTasks.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        healthApiTasks.clear();
        
        for (ScheduledFuture<?> future : dataSyncTimers.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        dataSyncTimers.clear();
        
        for (ScheduledFuture<?> future : deviceStatusPollingTimers.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        deviceStatusPollingTimers.clear();
        
        // Shutdown executor service
        if (executorService != null && !executorService.isShutdown()) {
            executorService.shutdown();
            try {
                if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                    executorService.shutdownNow();
                }
            } catch (InterruptedException e) {
                executorService.shutdownNow();
            }
        }
        
        // Disconnect all devices
        for (Map.Entry<String, BluetoothGatt> entry : connectedGatts.entrySet()) {
            try {
                BluetoothGatt gatt = entry.getValue();
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                }
            } catch (Exception e) {
                Log.e(TAG, "Error disconnecting device: " + e.getMessage());
            }
        }
        
        // Clear all maps
        connectedGatts.clear();
        deviceDataMap.clear();
        deviceCharacteristics.clear();
        bondedDevices.clear();
        reconnectTasks.clear();
        reconnectAttempts.clear();
        reconnectBackoff.clear();
        
        // Call original cleanup
        cleanup();
        
        Log.d(TAG, "✅ BLE Module cleanup complete");
    }

    /**
     * Check if device is bonded/paired securely
     */
    @ReactMethod
    public void isDeviceBonded(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔐 Checking bonding status for device: " + deviceId);
            
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                Log.e(TAG, "❌ Bluetooth adapter not available");
                promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth adapter not available");
                return;
            }
            
            BluetoothDevice device = adapter.getRemoteDevice(deviceId);
            if (device == null) {
                Log.e(TAG, "❌ Device not found: " + deviceId);
                promise.reject("DEVICE_NOT_FOUND", "Device not found");
                return;
            }
            
            // Check if device is bonded
            boolean isBonded = device.getBondState() == BluetoothDevice.BOND_BONDED;
            Log.d(TAG, "🔐 Device " + deviceId + " bonding status: " + (isBonded ? "BONDED" : "NOT BONDED"));
            
            promise.resolve(isBonded);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking bonding status: " + e.getMessage());
            promise.reject("BONDING_CHECK_ERROR", e.getMessage());
        }
    }

    /**
     * Initiate secure pairing with device
     */
    @ReactMethod
    public void initiateSecurePairing(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔐 Initiating secure pairing for device: " + deviceId);
            
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                Log.e(TAG, "❌ Bluetooth adapter not available");
                promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth adapter not available");
                return;
            }
            
            BluetoothDevice device = adapter.getRemoteDevice(deviceId);
            if (device == null) {
                Log.e(TAG, "❌ Device not found: " + deviceId);
                promise.reject("DEVICE_NOT_FOUND", "Device not found");
                return;
            }
            
            // Check if already bonded
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                Log.d(TAG, "🔐 Device " + deviceId + " is already bonded");
                promise.resolve(true);
                return;
            }
            
            // Initiate pairing
            Log.d(TAG, "🔐 Starting pairing process for device: " + deviceId);
            boolean pairingStarted = device.createBond();
            
            if (pairingStarted) {
                Log.d(TAG, "✅ Pairing process started for device: " + deviceId);
                promise.resolve(true);
            } else {
                Log.e(TAG, "❌ Failed to start pairing process for device: " + deviceId);
                promise.reject("PAIRING_FAILED", "Failed to start pairing process");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error initiating secure pairing: " + e.getMessage());
            promise.reject("PAIRING_ERROR", e.getMessage());
        }
    }

    // MARK: - DFU (Device Firmware Update) / OTA Methods
    
    // DFU state tracking
    private String currentDfuDeviceAddress = null;
    private DfuProgressListener dfuProgressListener = null;
    
    /**
     * Enter DFU Mode Command - sends 0xAA0A0000 to device
     * Device will reboot into DFU bootloader and advertise DFU service
     * Note: DFU_SERVICE_UUID is defined at top of class (line 132)
     */
    @ReactMethod
    public void enterDFUMode(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔧 [DFU] Sending Enter DFU Mode command to device: " + deviceId);
            
            // Check if device is connected
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected: " + deviceId);
                return;
            }
            
            // Find System Command characteristic
            BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
            if (systemCommandChar == null) {
                promise.reject("CHARACTERISTIC_NOT_FOUND", "System Command characteristic not found");
                return;
            }
            
            // Build Enter DFU Mode command (0xAA 0x0A 0x00 0x00)
            byte[] command = new byte[]{
                (byte) 0xAA,  // Request ID
                (byte) 0x0A,  // Command ID: Enter DFU Mode
                (byte) 0x00,  // Payload length: 0
                (byte) 0x00   // No payload
            };
            
            Log.d(TAG, "🔧 [DFU] Sending command: " + bytesToHex(command));
            
            // Send command
            systemCommandChar.setValue(command);
            boolean success = gatt.writeCharacteristic(systemCommandChar);
            
            if (success) {
                Log.d(TAG, "✅ [DFU] Enter DFU Mode command sent successfully");
                Log.d(TAG, "⏳ [DFU] Device will reboot into DFU bootloader (~3 seconds)");
                Log.d(TAG, "📡 [DFU] Device will advertise DFU service UUID: " + DFU_SERVICE_UUID);
                
                WritableMap result = Arguments.createMap();
                result.putString("status", "entering_dfu");
                result.putString("message", "Device rebooting into DFU mode");
                result.putString("deviceId", deviceId);
                result.putInt("estimatedRebootTimeMs", 3000);
                
                promise.resolve(result);
            } else {
                Log.e(TAG, "❌ [DFU] Failed to send Enter DFU Mode command");
                promise.reject("WRITE_FAILED", "Failed to write Enter DFU Mode command");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error entering DFU mode: " + e.getMessage());
            promise.reject("ENTER_DFU_ERROR", e.getMessage());
        }
    }
    
    /**
     * Start DFU process
     * @param deviceAddress - Device MAC address
     * @param firmwarePath - Path to .zip firmware file (file:// URI)
     */
    @ReactMethod
    public void startDFU(String deviceAddress, String firmwarePath, Promise promise) {
        try {
            Log.d(TAG, "🚀 [DFU] Starting DFU process");
            Log.d(TAG, "   Device: " + deviceAddress);
            Log.d(TAG, "   Firmware: " + firmwarePath);
            
            // Validate firmware file
            Uri fileUri = Uri.parse(firmwarePath);
            
            // Check if file exists
            if (fileUri == null) {
                promise.reject("INVALID_FIRMWARE_PATH", "Invalid firmware file path");
                return;
            }
            
            // Store current DFU device
            currentDfuDeviceAddress = deviceAddress;
            
            // Setup DFU progress listener
            setupDfuProgressListener();
            
            // Initialize DFU Service
            final DfuServiceInitiator starter = new DfuServiceInitiator(deviceAddress)
                    .setDeviceName("Smart Health Tag")
                    .setKeepBond(true)  // Keep bonding after DFU
                    .setForceDfu(false)  // Don't force DFU if not in bootloader
                    .setPacketsReceiptNotificationsEnabled(true)  // Enable progress notifications
                    .setPacketsReceiptNotificationsValue(12)  // Report every 12 packets
                    .setUnsafeExperimentalButtonlessServiceInSecureDfuEnabled(true);  // Enable buttonless DFU
            
            // Set firmware file
            starter.setZip(fileUri);
            
            // Start DFU Service using custom wrapper
            starter.start(getReactApplicationContext(), DfuServiceWrapper.class);
            
            Log.d(TAG, "✅ [DFU] DFU process started successfully");
            
            WritableMap result = Arguments.createMap();
            result.putString("status", "started");
            result.putString("deviceId", deviceAddress);
            result.putString("firmwarePath", firmwarePath);
            
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error starting DFU: " + e.getMessage());
            promise.reject("DFU_START_ERROR", e.getMessage());
        }
    }
    
    /**
     * Cancel ongoing DFU process
     */
    @ReactMethod
    public void cancelDFU(Promise promise) {
        try {
            if (currentDfuDeviceAddress == null) {
                promise.reject("NO_DFU_IN_PROGRESS", "No DFU operation in progress");
                return;
            }
            
            Log.d(TAG, "🛑 [DFU] Cancelling DFU for device: " + currentDfuDeviceAddress);
            
            // Abort DFU by stopping the service
            // Nordic DFU library will handle cleanup internally
            Intent stopIntent = new Intent(getReactApplicationContext(), DfuServiceWrapper.class);
            getReactApplicationContext().stopService(stopIntent);
            
            // Reset state
            currentDfuDeviceAddress = null;
            
            Log.d(TAG, "✅ [DFU] DFU cancellation requested");
            
            WritableMap result = Arguments.createMap();
            result.putString("status", "cancelled");
            result.putString("deviceId", currentDfuDeviceAddress);
            
            promise.resolve(result);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error cancelling DFU: " + e.getMessage());
            promise.reject("DFU_CANCEL_ERROR", e.getMessage());
        }
    }
    
    /**
     * Check if device is in DFU mode by looking for DFU service
     */
    @ReactMethod
    public void isDeviceInDFUMode(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.resolve(false);
                return;
            }
            
            // Check if device has DFU service
            List<BluetoothGattService> services = gatt.getServices();
            for (BluetoothGattService service : services) {
                if (service.getUuid().toString().equalsIgnoreCase(DFU_SERVICE_UUID)) {
                    Log.d(TAG, "✅ [DFU] Device is in DFU mode: " + deviceId);
                    promise.resolve(true);
                    return;
                }
            }
            
            Log.d(TAG, "ℹ️ [DFU] Device is NOT in DFU mode: " + deviceId);
            promise.resolve(false);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error checking DFU mode: " + e.getMessage());
            promise.reject("DFU_CHECK_ERROR", e.getMessage());
        }
    }
    
    /**
     * Get DFU service UUID for scanning
     */
    @ReactMethod
    public void getDFUServiceUUID(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putString("uuid", DFU_SERVICE_UUID);
            result.putString("description", "Nordic DFU Service (Bootloader)");
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("DFU_UUID_ERROR", e.getMessage());
        }
    }
    
    /**
     * Setup DFU progress listener to send events to React Native
     */
    private void setupDfuProgressListener() {
        // Remove old listener if exists
        if (dfuProgressListener != null) {
            DfuServiceListenerHelper.unregisterProgressListener(getReactApplicationContext(), dfuProgressListener);
        }
        
        // Create new listener
        dfuProgressListener = new DfuProgressListenerAdapter() {
            @Override
            public void onDeviceConnecting(String deviceAddress) {
                Log.d(TAG, "📡 [DFU] Connecting to device...");
                sendDfuEvent("DFUStateChanged", "connecting", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceConnected(String deviceAddress) {
                Log.d(TAG, "✅ [DFU] Device connected");
                sendDfuEvent("DFUStateChanged", "connected", deviceAddress, 0);
            }
            
            @Override
            public void onDfuProcessStarting(String deviceAddress) {
                Log.d(TAG, "🚀 [DFU] DFU process starting...");
                sendDfuEvent("DFUStateChanged", "starting", deviceAddress, 0);
            }
            
            @Override
            public void onDfuProcessStarted(String deviceAddress) {
                Log.d(TAG, "📤 [DFU] Uploading firmware...");
                sendDfuEvent("DFUStateChanged", "uploading", deviceAddress, 0);
            }
            
            @Override
            public void onEnablingDfuMode(String deviceAddress) {
                Log.d(TAG, "🔧 [DFU] Enabling DFU mode...");
                sendDfuEvent("DFUStateChanged", "enabling_dfu", deviceAddress, 0);
            }
            
            @Override
            public void onProgressChanged(String deviceAddress, int percent, float speed, 
                                         float avgSpeed, int currentPart, int partsTotal) {
                Log.d(TAG, "📊 [DFU] Progress: " + percent + "% (Part " + currentPart + "/" + partsTotal + ")");
                
                WritableMap params = Arguments.createMap();
                params.putString("deviceId", deviceAddress);
                params.putInt("progress", percent);
                params.putDouble("currentSpeed", speed);
                params.putDouble("avgSpeed", avgSpeed);
                params.putInt("part", currentPart);
                params.putInt("totalParts", partsTotal);
                
                sendEvent("DFUProgress", params);
            }
            
            @Override
            public void onFirmwareValidating(String deviceAddress) {
                Log.d(TAG, "✅ [DFU] Validating firmware...");
                sendDfuEvent("DFUStateChanged", "validating", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceDisconnecting(String deviceAddress) {
                Log.d(TAG, "🔌 [DFU] Disconnecting device...");
                sendDfuEvent("DFUStateChanged", "disconnecting", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceDisconnected(String deviceAddress) {
                Log.d(TAG, "❌ [DFU] Device disconnected");
                sendDfuEvent("DFUStateChanged", "disconnected", deviceAddress, 0);
            }
            
            @Override
            public void onDfuCompleted(String deviceAddress) {
                Log.d(TAG, "🎉 [DFU] DFU completed successfully!");
                sendDfuEvent("DFUCompleted", "completed", deviceAddress, 100);
                currentDfuDeviceAddress = null;
            }
            
            @Override
            public void onDfuAborted(String deviceAddress) {
                Log.d(TAG, "🛑 [DFU] DFU aborted");
                sendDfuEvent("DFUAborted", "aborted", deviceAddress, 0);
                currentDfuDeviceAddress = null;
            }
            
            @Override
            public void onError(String deviceAddress, int error, int errorType, String message) {
                Log.e(TAG, "❌ [DFU] Error: " + message + " (Code: " + error + ", Type: " + errorType + ")");
                
                WritableMap params = Arguments.createMap();
                params.putString("deviceId", deviceAddress);
                params.putInt("errorCode", error);
                params.putInt("errorType", errorType);
                params.putString("message", message);
                
                sendEvent("DFUError", params);
                currentDfuDeviceAddress = null;
            }
        };
        
        // Register listener
        DfuServiceListenerHelper.registerProgressListener(getReactApplicationContext(), dfuProgressListener);
        Log.d(TAG, "✅ [DFU] Progress listener registered");
    }
    
    /**
     * Helper to send DFU events to React Native
     */
    private void sendDfuEvent(String eventName, String state, String deviceId, int progress) {
        WritableMap params = Arguments.createMap();
        params.putString("state", state);
        params.putString("deviceId", deviceId);
        params.putInt("progress", progress);
        
        sendEvent(eventName, params);
    }
}

/**
 * DFU Service Wrapper - Required for Nordic DFU Library
 * Must extend DfuBaseService to work with DfuServiceInitiator
 */
class DfuServiceWrapper extends DfuBaseService {
    @Override
    protected Class<? extends android.app.Activity> getNotificationTarget() {
        // Return the main activity for notification tap handling
        try {
            return (Class<? extends android.app.Activity>) Class.forName("com.reactnativeboilerplate.MainActivity");
        } catch (ClassNotFoundException e) {
            return null;
        }
    }

    @Override
    protected boolean isDebug() {
        // Enable debug logging in debug builds
        return BuildConfig.DEBUG;
    }
}
