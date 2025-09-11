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

public class SampleBridgeAndroid extends ReactContextBaseJavaModule {
    private static final String TAG = "SampleBridgeAndroid";
    private OkHttpClient client = new OkHttpClient();
    
    // BLE Constants (matching iOS implementation)
    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    private static final String BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
    private static final String DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
    private static final String GENERIC_ACCESS_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
    private static final String DFU_SERVICE_UUID = "0000fe59-0000-1000-8000-00805f9b34fb";
    
    // Smart Tag Characteristics
    private static final String SYSTEM_COMMAND_CHAR_UUID = "4f4e4d4c-4b4a-4948-4746-454443424140";
    private static final String DEVICE_STATUS_CHAR_UUID = "5f5e5d5c-5b5a-5958-5756-555453525150";
    private static final String DATA_TRANSFER_CHAR_UUID = "6f6e6d6c-6b6a-6968-6766-656463626160";
    private static final String LOCATION_DATA_CHAR_UUID = "7f7e7d7c-7b7a-7978-7776-757473727170";
    
    // Standard Characteristics
    private static final String BATTERY_LEVEL_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb";
    private static final String MANUFACTURER_NAME_CHAR_UUID = "00002a29-0000-1000-8000-00805f9b34fb";
    private static final String MODEL_NUMBER_CHAR_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
    private static final String FIRMWARE_REVISION_CHAR_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
    
    // System Command Constants
    private static final byte REQUEST_ID = (byte) 0xAA;
    private static final byte RESPONSE_ID = (byte) 0xBB;
    private static final byte STATUS_SUCCESS = 0x00;
    private static final byte STATUS_FAILURE = 0x01;
    
    // Command IDs
    private static final byte CMD_SET_SYSTEM_TIME = 0x01;
    private static final byte CMD_SET_ADV_INTERVAL = 0x02;
    private static final byte CMD_SET_CONN_INTERVAL = 0x03;
    private static final byte CMD_SET_DATA_INTERVAL = 0x04;
    private static final byte CMD_GET_FW_VERSION = 0x05;
    private static final byte CMD_GET_HW_VERSION = 0x06;
    private static final byte CMD_GET_DIAGNOSTICS = 0x07;
    private static final byte CMD_DATA_SYNC_START = 0x08;
    private static final byte CMD_DATA_SYNC_STOP = 0x09;
    private static final byte CMD_SYSTEM_RESTART = 0x10;
    
    // Device Status Layout (20 bytes)
    private static final int TIMESTAMP_OFFSET = 0;
    private static final int STEPS_OFFSET = 4;
    private static final int TEMP_OFFSET = 8;
    private static final int FLAGS_OFFSET = 12;
    private static final int RESERVED_OFFSET = 16;
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
    private Set<String> bondedDeviceIds = new HashSet<>();
    private Map<String, BluetoothGatt> connectedGatts = new ConcurrentHashMap<>();
    private Map<String, DeviceData> deviceDataMap = new ConcurrentHashMap<>();
    private Map<String, BluetoothGattCharacteristic> deviceCharacteristics = new ConcurrentHashMap<>();
    private Map<String, Integer> healthCheckFailures = new ConcurrentHashMap<>();
    private Set<String> manualDisconnectInProgress = new HashSet<>();
    private Set<String> pendingWrites = new HashSet<>();
    
    // Enhanced operation tracking with TransactionManager
    private TransactionManager transactionManager = new TransactionManager();
    
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
    private Map<String, Map<String, Object>> powerProfiles = new HashMap<>();
    private Timer healthCheckTimer;
    
    // Power Profile Constants (matching JavaScript BLEConstants.js)
    private static final Map<String, Map<String, Object>> POWER_PROFILE_DEFAULTS = new HashMap<String, Map<String, Object>>() {{
        put("default", new HashMap<String, Object>() {{
            put("healthCheckMs", 60000); // 60s health checks (less aggressive)
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
        public int batteryLevel;
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
                
                // Enable notifications for important characteristics
                if (charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    Log.d(TAG, "🔔 Enabling notifications for characteristic: " + charUuid);
                    enableNotifications(gatt, characteristic);
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
            
            BluetoothGattCharacteristic locationChar = deviceData.characteristics.get(LOCATION_DATA_CHAR_UUID);
            if (locationChar != null) {
                Log.d(TAG, "📍 Reading location data for Smart Tag: " + deviceId);
                gatt.readCharacteristic(locationChar);
            }
        } else {
            Log.d(TAG, "📋 Device is not a Smart Tag, skipping Smart Tag specific characteristics");
        }
    }
    
    private void enableNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        
        gatt.setCharacteristicNotification(characteristic, true);
        
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        );
        if (descriptor != null) {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(descriptor);
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
        
        if (charUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
            Log.d(TAG, "📊 Parsing device status data for: " + deviceId);
            parseDeviceStatusData(deviceData, data);
        } else if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID)) {
            Log.d(TAG, "🔧 Parsing system command response for: " + deviceId);
            parseSystemCommandResponse(deviceData, data);
        } else if (charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                deviceData.batteryLevel = data[0] & 0xFF;
                Log.d(TAG, "🔋 Battery level updated for " + deviceId + ": " + deviceData.batteryLevel + "%");
            }
        } else if (charUuid.equals(MANUFACTURER_NAME_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String manufacturerName = new String(data).trim();
                Log.d(TAG, "🏭 Manufacturer name for " + deviceId + ": " + manufacturerName);
            }
        } else if (charUuid.equals(MODEL_NUMBER_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String modelNumber = new String(data).trim();
                Log.d(TAG, "📱 Model number for " + deviceId + ": " + modelNumber);
            }
        } else if (charUuid.equals(FIRMWARE_REVISION_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String firmwareRevision = new String(data).trim();
                Log.d(TAG, "🔧 Firmware revision for " + deviceId + ": " + firmwareRevision);
            }
        } else if (charUuid.equals(DATA_TRANSFER_CHAR_UUID)) {
            Log.d(TAG, "📡 Data transfer characteristic for " + deviceId + " - Data length: " + (data != null ? data.length : 0));
        } else if (charUuid.equals(LOCATION_DATA_CHAR_UUID)) {
            Log.d(TAG, "📍 Location data characteristic for " + deviceId + " - Data length: " + (data != null ? data.length : 0));
        } else {
            Log.d(TAG, "❓ Unknown characteristic for " + deviceId + ": " + charUuid + " - Data length: " + (data != null ? data.length : 0));
        }
        
        // Send data update event
        Log.d(TAG, "📤 Sending DeviceDataUpdated event for " + deviceId + " - Battery: " + deviceData.batteryLevel + "%, Steps: " + deviceData.steps + ", Temp: " + deviceData.temperature + "°C");
        WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
        Log.d(TAG, "📤 DeviceInfoMap contents: " + deviceInfoMap.toString());
        sendEvent("DeviceDataUpdated", deviceInfoMap);
        
        // Also trigger health data API call from native side
        // This ensures API calls continue even when the app is in background
        Log.d(TAG, "📤 Triggering health data API call from native side for device: " + deviceId);
        sendHealthDataApiEvent(deviceId, deviceInfoMap);
    }
    
    private void parseDeviceStatusData(DeviceData deviceData, byte[] data) {
        if (data == null || data.length < DEVICE_STATUS_SIZE) {
            Log.w(TAG, "Invalid device status data length: " + (data != null ? data.length : 0) + ", expected: " + DEVICE_STATUS_SIZE);
            return;
        }
        
        Log.d(TAG, "📊 Parsing device status data - Raw data length: " + data.length);
        Log.d(TAG, "📊 Raw data hex: " + bytesToHex(data));
        
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // Parse timestamp (4 bytes) - Keep as Unix seconds to match iOS BLEDataParser.js
        int timestampSeconds = buffer.getInt();
        deviceData.timestamp = timestampSeconds; // Store as Unix seconds, not milliseconds
        
        // Parse steps (4 bytes)
        deviceData.steps = buffer.getInt();
        
        // Parse temperature (4 bytes) - Use FloatLE to match iOS BLEDataParser.js
        deviceData.temperature = buffer.getFloat();
        
        // Parse flags (4 bytes)
        int flags = buffer.getInt();
        
        // Convert timestamp to milliseconds for JavaScript (matching iOS behavior)
        long timestampMs = timestampSeconds * 1000L;
        
        Log.d(TAG, "📊 Parsed device data - Steps: " + deviceData.steps + 
              ", Temp: " + deviceData.temperature + "°C, Timestamp: " + timestampSeconds + 
              "s (" + timestampMs + "ms), Flags: " + flags);
        
        // Update the timestamp to milliseconds for JavaScript consumption
        deviceData.timestamp = timestampMs;
        
        // Send data update event to JavaScript
        Log.d(TAG, "📤 Sending device data update event for: " + deviceData.deviceId);
        sendDeviceDataUpdateEvent(deviceData);
    }
    
    private void sendDeviceDataUpdateEvent(DeviceData deviceData) {
        WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
        Log.d(TAG, "📤 DeviceInfoMap contents: " + deviceInfoMap.toString());
        sendEvent("DeviceDataUpdated", deviceInfoMap);
        
        // Also trigger health data API call from native side
        Log.d(TAG, "📤 Triggering health data API call from native side for device: " + deviceData.deviceId);
        sendHealthDataApiEvent(deviceData.deviceId, deviceInfoMap);
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
        
        // Parse command-specific data
        if (commandId == CMD_GET_DIAGNOSTICS && responseLength > 0) {
            // GET_DIAGNOSTICS response should contain battery level and other diagnostic info
            byte[] responseData = new byte[responseLength];
            buffer.get(responseData);
            
            Log.d(TAG, "🔧 Diagnostics response data: " + bytesToHex(responseData));
            
            // Parse diagnostics data - this might contain battery level
            // The exact format depends on the device firmware
            if (responseData.length >= 1) {
                // Assume first byte is battery level (this might need adjustment based on actual device response)
                int batteryLevel = responseData[0] & 0xFF;
                if (batteryLevel > 0 && batteryLevel <= 100) {
                    deviceData.batteryLevel = batteryLevel;
                    Log.d(TAG, "🔋 Battery level from diagnostics: " + batteryLevel + "%");
                }
            }
            
            // Parse other diagnostic data if available
            if (responseData.length >= 4) {
                // Additional diagnostic data parsing can be added here
                Log.d(TAG, "🔧 Additional diagnostics data available: " + (responseData.length - 1) + " bytes");
            }
        }
        
        // Send updated device data
        Log.d(TAG, "📤 Sending updated device data after system command response");
        WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
        sendEvent("DeviceDataUpdated", deviceInfoMap);
        
        // Also trigger health data API call from native side
        Log.d(TAG, "📤 Triggering health data API call from native side after system command response for device: " + deviceData.deviceId);
        sendHealthDataApiEvent(deviceData.deviceId, deviceInfoMap);
    }
    
    private byte[] buildSystemCommandPacket(int commandId, ReadableArray payload) {
        byte[] packet = new byte[20];
        packet[0] = REQUEST_ID;
        packet[1] = (byte) commandId;
        
        int payloadLength = payload != null ? payload.size() : 0;
        packet[2] = (byte) payloadLength;
        
        if (payload != null && payloadLength > 0) {
            for (int i = 0; i < Math.min(payloadLength, 17); i++) {
                packet[3 + i] = (byte) payload.getInt(i);
            }
        }
        
        return packet;
    }
    
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
        map.putInt("batteryLevel", deviceData.batteryLevel);
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
                        
                        // Emit event to JavaScript for monitoring callbacks
                        byte[] data = characteristic.getValue();
                        if (data != null && data.length > 0) {
                            WritableMap eventData = Arguments.createMap();
                            eventData.putString("deviceId", deviceId);
                            eventData.putString("characteristicUuid", characteristicUuid);
                            eventData.putString("data", bytesToHex(data));
                            
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
            
            // Send discovery event for ALL devices (including those with "Unknown Device" names)
            // Many BLE devices don't advertise their names properly, so we include them all
            Log.d("SampleBridgeAndroid", "📱 Sending device discovery event: " + deviceName + " (" + deviceId + ")");
            sendEvent("DeviceFound", createDeviceInfoMap(deviceData));
            
            // Special handling for bonded devices or Health Tag
            if (bondedDevices.containsKey(deviceId) || "Health Tag".equals(deviceName)) {
                Log.d("SampleBridgeAndroid", "🎯 TARGET DEVICE FOUND: " + deviceName + " (" + deviceId + ")");
                
                // Check if device was manually disconnected - prevent auto-connection during scanning
                if (manualDisconnectInProgress.contains(deviceId)) {
                    Log.d("SampleBridgeAndroid", "🔌 Device " + deviceName + " was manually disconnected - skipping auto-connection during scan");
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
            // If this is a manual connection to a device that was manually disconnected, clear the tracking
            if (manualDisconnectInProgress.contains(deviceId)) {
                Log.d(TAG, "🔄 Manual connection to previously manually disconnected device - clearing tracking: " + deviceId);
                manualDisconnectInProgress.remove(deviceId);
            }
            
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
            if (device != null) {
                // Check if already connected
                if (connectedGatts.containsKey(deviceId)) {
                    Log.d("SampleBridgeAndroid", "Device already connected: " + deviceId);
                    promise.resolve(true);
                    return;
                }
                
                // Create GATT connection with proper configuration
                BluetoothGatt gatt = device.connectGatt(
                    getReactApplicationContext(),
                    true, // autoConnect = true for auto-reconnection
                    new BluetoothGattCallback() {
                        @Override
                        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                            String deviceId = gatt.getDevice().getAddress();
                            Log.d(TAG, "🔗 Connection state change for device: " + deviceId + " - Status: " + status + " - New State: " + newState);
                            
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
                                eventData.putString("characteristicUUID", characteristicUuid);
                                eventData.putString("value", base64Data);
                                
                                sendEvent("CharacteristicChanged", eventData);
                                Log.d(TAG, "📨 Emitted CharacteristicChanged event for " + characteristicUuid);
                            }
                        }
                        
                        @Override
                        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String descriptorUuid = descriptor.getUuid().toString();
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ Descriptor write successful: " + descriptorUuid);
                                
                                // Check if there's a pending promise for this descriptor write
                                String promiseKey = deviceId + "_" + descriptorUuid;
                                Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
                                
                                if (pendingPromise != null) {
                                    Log.d(TAG, "📊 Resolving descriptor write promise");
                                    pendingPromise.resolve(true);
                                }
                            } else {
                                Log.e(TAG, "❌ Descriptor write failed: " + descriptorUuid + " with status: " + status);
                                
                                // Reject any pending promise
                                String promiseKey = deviceId + "_" + descriptorUuid;
                                Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
                                if (pendingPromise != null) {
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
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ Write completed successfully for characteristic: " + characteristicUuid);
                            } else {
                                Log.e(TAG, "❌ Write failed for characteristic: " + characteristicUuid + " with status: " + status);
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
            } else {
                promise.reject("DEVICE_ERROR", "Device not found");
            }
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
            
            // Add transaction with timeout
            transactionManager.addTransaction(transactionId, promise, "WRITE_CHARACTERISTIC", deviceId, 10000);
            
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
                transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED.name(), 
                    "Failed to initiate write operation");
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception during write: " + e.getMessage());
            pendingWrites.remove(writeKey);
            rejectWithBLEError(promise, BLEError.permissionDenied("BLUETOOTH_CONNECT"));
        } catch (Exception e) {
            Log.e(TAG, "❌ Exception during write: " + e.getMessage(), e);
            pendingWrites.remove(writeKey);
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
            
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected: " + deviceId);
                return;
            }
            
            // Convert ReadableArray to byte array
            byte[] payloadBytes = new byte[payload.size()];
            for (int i = 0; i < payload.size(); i++) {
                payloadBytes[i] = (byte) payload.getInt(i);
            }
            
            // Create packet according to system command format
            byte[] packet = new byte[20]; // 20-byte packet
            
            // Byte 0: Request ID (0xAA)
            packet[0] = (byte) 0xAA;
            
            // Byte 1: Command ID
            packet[1] = (byte) command;
            
            // Byte 2: Command Length
            packet[2] = (byte) payloadBytes.length;
            
            // Bytes 3-19: Command Data (up to 17 bytes)
            for (int i = 0; i < payloadBytes.length && i < 17; i++) {
                packet[3 + i] = payloadBytes[i];
            }
            
            // Find the system command characteristic
            BluetoothGattCharacteristic sysCmdChar = null;
            BluetoothGattService smartTagService = gatt.getService(UUID.fromString("0F0E0D0C-0B0A-0908-0706-050403020100"));
            if (smartTagService != null) {
                sysCmdChar = smartTagService.getCharacteristic(UUID.fromString("5F5E5D5C-5B5A-5958-5756-555453525150"));
            }
            
            if (sysCmdChar == null) {
                promise.reject("CHARACTERISTIC_NOT_FOUND", "System command characteristic not found");
                return;
            }
            
            // Write the packet to the characteristic
            sysCmdChar.setValue(packet);
            boolean success = gatt.writeCharacteristic(sysCmdChar);
            
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
            
            // Save bonded devices
            saveBondedDevices();
            
            Log.d(TAG, "✅ Device removed from bonded list: " + deviceId);
            promise.resolve(true);
            
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
            
            promise.resolve(devices);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting bonded devices: " + e.getMessage());
            promise.reject("BONDED_DEVICE_ERROR", e.getMessage());
        }
    }
    
    @ReactMethod
    public void getForgottenDevices(Promise promise) {
        try {
            WritableArray devices = Arguments.createArray();
            // Android doesn't have a forgotten devices concept like iOS
            // Return empty array for consistency with iOS
            promise.resolve(devices);
            
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
        Log.d(TAG, "📱 React Native module destroying, cleaning up BLE resources");
        cleanup();
    }
}
