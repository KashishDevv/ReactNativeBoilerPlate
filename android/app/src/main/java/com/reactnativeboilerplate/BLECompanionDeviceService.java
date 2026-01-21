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
import androidx.annotation.NonNull;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Enhanced BLE Auto-Connection Service for reliable background reconnection
 * Uses Android's built-in BLE APIs for device presence monitoring and auto-connection
 */
public class BLECompanionDeviceService {
    private static final String TAG = "BLECompanionDeviceService";
    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    
    // ✅ Callback interface to notify parent about auto-connection events
    public interface AutoConnectionCallback {
        void onAutoConnected(String deviceId, BluetoothGatt gatt);
        void onAutoDisconnected(String deviceId);
        void onServicesDiscovered(String deviceId, BluetoothGatt gatt);
        void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status);
        void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic);
    }
    
    private Context context;
    private BLEConnectionManager connectionManager;
    private AutoConnectionCallback autoConnectionCallback; // ✅ Callback to SampleBridgeAndroid
    private Map<String, BluetoothDevice> companionDevices = new ConcurrentHashMap<>();
    private Map<String, Boolean> devicePresence = new ConcurrentHashMap<>();
    private Map<String, Handler> presenceCheckHandlers = new ConcurrentHashMap<>();
    private Map<String, Handler> continuousScanHandlers = new ConcurrentHashMap<>(); // For continuous scanning when disconnected
    private Map<String, Handler> directConnectionHandlers = new ConcurrentHashMap<>(); // For direct connection attempts
    private Map<String, Integer> reconnectAttempts = new ConcurrentHashMap<>(); // Track reconnection attempts
    
    // BLE components for device monitoring
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    
    // Reconnection constants (matching iOS)
    private static final int MAX_RECONNECT_ATTEMPTS = 10;
    private static final long INITIAL_RECONNECT_DELAY_MS = 2000; // 2 seconds
    private static final long MAX_RECONNECT_DELAY_MS = 30000; // 30 seconds
    
    // Scan callback for device presence detection
    private ScanCallback presenceScanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String deviceId = device.getAddress();
            
            if (companionDevices.containsKey(deviceId)) {
                Log.d(TAG, "📡 Device detected in range: " + deviceId + " (RSSI: " + result.getRssi() + ")");
                onDeviceAppeared(deviceId);
            }
        }
        
        @Override
        public void onScanFailed(int errorCode) {
            Log.e(TAG, "❌ Presence scan failed with error: " + errorCode);
        }
    };
    
    public BLECompanionDeviceService(Context context) {
        this.context = context.getApplicationContext();
        initializeBLE();
    }
    
    private void initializeBLE() {
        Log.d(TAG, "🏁 BLE Companion Device Service initializing");
        
        bluetoothManager = (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager != null) {
            bluetoothAdapter = bluetoothManager.getAdapter();
            bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();
        }
        
        if (bluetoothAdapter == null) {
            Log.e(TAG, "❌ Bluetooth adapter not available");
        }
        
        connectionManager = BLEConnectionManager.getInstance(context);
        connectionManager.setCompanionService(this);
        
        // Start monitoring bonded devices
        startMonitoringBondedDevices();
    }
    
    public void onDeviceAppeared(String deviceId) {
        Log.d(TAG, "📡 Device appeared: " + deviceId);
        
        devicePresence.put(deviceId, true);
        
        // Stop continuous reconnection attempts since device is detected
        stopContinuousReconnection(deviceId);
        
        // Reset reconnection attempts since device is back
        reconnectAttempts.remove(deviceId);
        
        // Notify connection manager about device presence change
        if (connectionManager != null) {
            connectionManager.onDevicePresenceChanged(deviceId, true);
        }
        
        // Check if this is a companion device we should auto-connect to
        if (companionDevices.containsKey(deviceId)) {
            BluetoothDevice device = companionDevices.get(deviceId);
            if (device != null) {
                Log.d(TAG, "🔗 Auto-connecting to companion device: " + deviceId);
                connectToCompanionDevice(deviceId, device);
            }
        }
    }
    
    public void onDeviceDisappeared(String deviceId) {
        Log.d(TAG, "📡 Device disappeared: " + deviceId);
        
        devicePresence.put(deviceId, false);
        
        // Notify connection manager about device presence change
        if (connectionManager != null) {
            connectionManager.onDevicePresenceChanged(deviceId, false);
        }
        
        // Device is out of range, but keep monitoring for reconnection
        // Ensure we continue monitoring this device even after it disappears
        if (companionDevices.containsKey(deviceId)) {
            Log.d(TAG, "👁️ Device " + deviceId + " out of range, continuing to monitor for reconnection");
            // The periodic presence check will continue via startObservingDevicePresence
        }
    }
    
    /**
     * Triggered when a device disconnects - start aggressive reconnection strategy
     * Similar to iOS: continuous scanning + direct connection attempts
     */
    public void onDeviceDisconnected(String deviceId) {
        Log.d(TAG, "🔍 Device disconnected, starting aggressive reconnection for: " + deviceId);
        
        // If device is still in our companion devices list, start reconnection process
        if (companionDevices.containsKey(deviceId)) {
            // Reset reconnection attempts
            reconnectAttempts.put(deviceId, 0);
            
            // Stop any existing continuous scanning/connection attempts
            stopContinuousReconnection(deviceId);
            
            // Start continuous scanning (like iOS continuous scanning)
            startContinuousScanning(deviceId);
            
            // Start direct connection attempts (like iOS connectToKnownPeripheralsNative)
            startDirectConnectionAttempts(deviceId);
            
            // Also ensure periodic monitoring continues
            if (!presenceCheckHandlers.containsKey(deviceId)) {
                Log.d(TAG, "🔄 Restarting presence monitoring for disconnected device: " + deviceId);
                startObservingDevicePresence(deviceId);
            }
        }
    }
    
    /**
     * Start continuous scanning for a disconnected device (like iOS continuous scanning)
     */
    private void startContinuousScanning(String deviceId) {
        Log.d(TAG, "🔍 Starting continuous scanning for: " + deviceId);
        
        Handler handler = new Handler(Looper.getMainLooper());
        continuousScanHandlers.put(deviceId, handler);
        
        Runnable scanRunnable = new Runnable() {
            @Override
            public void run() {
                // Check if device is still disconnected and we should continue scanning
                if (companionDevices.containsKey(deviceId) && 
                    connectionManager != null && 
                    !connectionManager.isDeviceConnected(deviceId)) {
                    
                    // Perform a scan (longer duration for better detection)
                    performPresenceScan(deviceId, 5000); // 5 second scan
                    
                    // Schedule next scan in 3 seconds (more frequent than periodic)
                    handler.postDelayed(this, 3000);
                } else {
                    // Device connected or removed, stop continuous scanning
                    Log.d(TAG, "🛑 Stopping continuous scanning for: " + deviceId);
                    continuousScanHandlers.remove(deviceId);
                }
            }
        };
        
        // Start immediately
        handler.post(scanRunnable);
    }
    
    /**
     * Start direct connection attempts (like iOS connectToKnownPeripheralsNative)
     * Tries to connect directly even without scan results
     */
    private void startDirectConnectionAttempts(String deviceId) {
        Log.d(TAG, "🔗 Starting direct connection attempts for: " + deviceId);
        
        BluetoothDevice device = companionDevices.get(deviceId);
        if (device == null) {
            Log.w(TAG, "⚠️ Device not found in companion devices: " + deviceId);
            return;
        }
        
        Handler handler = new Handler(Looper.getMainLooper());
        directConnectionHandlers.put(deviceId, handler);
        
        Runnable connectionRunnable = new Runnable() {
            private int attemptCount = 0;
            
            @Override
            public void run() {
                // Check if device is still disconnected and we should continue
                if (companionDevices.containsKey(deviceId) && 
                    connectionManager != null && 
                    !connectionManager.isDeviceConnected(deviceId)) {
                    
                    int attempts = reconnectAttempts.getOrDefault(deviceId, 0);
                    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
                        Log.d(TAG, "❌ Max reconnection attempts reached for: " + deviceId);
                        directConnectionHandlers.remove(deviceId);
                        return;
                    }
                    
                    // Increment attempt count
                    reconnectAttempts.put(deviceId, attempts + 1);
                    
                    Log.d(TAG, "🔗 Direct connection attempt #" + (attempts + 1) + " for: " + deviceId);
                    
                    // Try direct connection (like iOS retrievePeripherals + connect)
                    // Use onDevicePresenceChanged to trigger reconnection, which handles callback creation
                    if (connectionManager != null) {
                        // Mark device as in range to trigger reconnection logic
                        // This will create a callback if needed and attempt connection
                        connectionManager.onDevicePresenceChanged(deviceId, true);
                    }
                    
                    // Calculate next delay with exponential backoff
                    long delay = Math.min(
                        INITIAL_RECONNECT_DELAY_MS * (long) Math.pow(2, attempts),
                        MAX_RECONNECT_DELAY_MS
                    );
                    
                    // Schedule next attempt
                    handler.postDelayed(this, delay);
                } else {
                    // Device connected or removed, stop attempts
                    Log.d(TAG, "🛑 Stopping direct connection attempts for: " + deviceId);
                    directConnectionHandlers.remove(deviceId);
                    reconnectAttempts.remove(deviceId);
                }
            }
        };
        
        // Start first attempt after 2 seconds
        handler.postDelayed(connectionRunnable, INITIAL_RECONNECT_DELAY_MS);
    }
    
    /**
     * Stop continuous reconnection attempts for a device
     */
    private void stopContinuousReconnection(String deviceId) {
        Handler scanHandler = continuousScanHandlers.remove(deviceId);
        if (scanHandler != null) {
            scanHandler.removeCallbacksAndMessages(null);
            Log.d(TAG, "🛑 Stopped continuous scanning for: " + deviceId);
        }
        
        Handler connectionHandler = directConnectionHandlers.remove(deviceId);
        if (connectionHandler != null) {
            connectionHandler.removeCallbacksAndMessages(null);
            Log.d(TAG, "🛑 Stopped direct connection attempts for: " + deviceId);
        }
        
        reconnectAttempts.remove(deviceId);
    }
    
    private void startMonitoringBondedDevices() {
        Log.d(TAG, "🔍 Starting monitoring of bonded devices");
        
        if (!hasBluetoothPermissions()) {
            Log.e(TAG, "❌ Missing Bluetooth permissions for device monitoring");
            return;
        }
        
        if (bluetoothAdapter == null) {
            Log.e(TAG, "❌ Bluetooth adapter not available");
            return;
        }
        
        Set<BluetoothDevice> bondedDevices = bluetoothAdapter.getBondedDevices();
        Log.d(TAG, "📋 Found " + bondedDevices.size() + " bonded devices");
        
        for (BluetoothDevice device : bondedDevices) {
            if (isSmartTagDevice(device)) {
                String deviceId = device.getAddress();
                companionDevices.put(deviceId, device);
                
                Log.d(TAG, "🏷️ Added Smart Tag as companion device: " + deviceId);
                
                // Start monitoring device presence
                startObservingDevicePresence(deviceId);
            }
        }
    }
    
    private void startObservingDevicePresence(String deviceId) {
        Log.d(TAG, "👁️ Starting device presence observation for: " + deviceId);
        
        // Create a handler for periodic presence checks
        Handler handler = new Handler(Looper.getMainLooper());
        presenceCheckHandlers.put(deviceId, handler);
        
        // Start periodic scanning to detect device presence
        Runnable presenceCheckRunnable = new Runnable() {
            @Override
            public void run() {
                if (companionDevices.containsKey(deviceId)) {
                    performPresenceScan(deviceId);
                    // Schedule next check in 10 seconds
                    handler.postDelayed(this, 10000);
                }
            }
        };
        
        handler.post(presenceCheckRunnable);
        Log.d(TAG, "✅ Device presence observation started for: " + deviceId);
    }
    
    private void performPresenceScan(String deviceId) {
        performPresenceScan(deviceId, 2000); // Default 2 second scan
    }
    
    /**
     * Perform an immediate presence scan for a device
     * This is called when a device disconnects to check if it's still in range
     * or when we need to actively check for a device coming back in range
     */
    public void performImmediatePresenceScan(String deviceId) {
        Log.d(TAG, "🔍 Performing immediate presence scan for: " + deviceId);
        performPresenceScan(deviceId, 5000); // Longer scan (5 seconds) for immediate checks
    }
    
    private void performPresenceScan(String deviceId, long scanDurationMs) {
        if (bluetoothLeScanner == null || !hasBluetoothPermissions()) {
            Log.w(TAG, "⚠️ Cannot perform presence scan - scanner or permissions unavailable");
            return;
        }
        
        try {
            // Create scan filter for the specific device
            List<ScanFilter> filters = new ArrayList<>();
            ScanFilter filter = new ScanFilter.Builder()
                    .setDeviceAddress(deviceId)
                    .build();
            filters.add(filter);
            
            // Configure scan settings for presence detection
            // Use BALANCED or LOW_LATENCY mode for better detection
            // Use ALL_MATCHES instead of FIRST_MATCH to catch device even if it wasn't advertising initially
            ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                    .setScanMode(scanDurationMs > 2000 ? ScanSettings.SCAN_MODE_LOW_LATENCY : ScanSettings.SCAN_MODE_BALANCED)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES) // Changed from FIRST_MATCH to catch device even if scan started before it began advertising
                    .setReportDelay(0);
            
            ScanSettings settings = settingsBuilder.build();
            
            // Start a scan to detect device presence
            bluetoothLeScanner.startScan(filters, settings, presenceScanCallback);
            Log.d(TAG, "✅ Started presence scan for " + deviceId + " (duration: " + scanDurationMs + "ms)");
            
            // Stop scan after specified duration
            Handler stopHandler = new Handler(Looper.getMainLooper());
            stopHandler.postDelayed(() -> {
                try {
                    bluetoothLeScanner.stopScan(presenceScanCallback);
                    Log.d(TAG, "🛑 Stopped presence scan for " + deviceId);
                } catch (Exception e) {
                    Log.w(TAG, "Error stopping presence scan", e);
                }
            }, scanDurationMs);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to perform presence scan for: " + deviceId, e);
        }
    }
    
    private void connectToCompanionDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔗 Connecting to companion device: " + deviceId);
        
        // Check if already connected
        if (connectionManager.isDeviceConnected(deviceId)) {
            Log.d(TAG, "✅ Device already connected: " + deviceId);
            // Stop continuous reconnection attempts since device is connected
            stopContinuousReconnection(deviceId);
            return;
        }
        
        // Stop continuous reconnection attempts since we're actively connecting
        stopContinuousReconnection(deviceId);
        
        // ════════════════════════════════════════════════════════════════════════════
        // INDUSTRY STANDARD: Use DIRECT CONNECT (autoConnect=false) for detected devices
        // This method is only called when device has been detected in range via scanning,
        // so direct connect provides faster connection (1-2s vs 30+ seconds)
        // ════════════════════════════════════════════════════════════════════════════
        Log.d(TAG, "🚀 [INDUSTRY] Using DIRECT CONNECT for detected device: " + deviceId);
        connectionManager.directConnectToDevice(deviceId, device, new BLEConnectionManager.BLEConnectionCallback() {
            @Override
            public void onConnectionStateChanged(String deviceId, BLEConnectionManager.ConnectionState state) {
                Log.d(TAG, "🔗 Companion device connection state changed: " + deviceId + " = " + state);
                
                if (state == BLEConnectionManager.ConnectionState.CONNECTED) {
                    Log.d(TAG, "✅ Companion device connected successfully: " + deviceId);
                    // Ensure continuous reconnection is stopped
                    stopContinuousReconnection(deviceId);
                    
                    // Send local notification for auto-connection (like iOS)
                    // COMMENTED OUT: Local notifications for connection/disconnection/restore/auto-connect
                    // String deviceName = getDeviceName(deviceId);
                    // sendLocalNotificationIfBackground("Device Connected", "Connected to " + deviceName);
                    
                    // ✅ Notify parent about auto-connection success (do NOT wait for services)
                    // Parent needs to know immediately so it can update UI
                    if (autoConnectionCallback != null) {
                        BluetoothGatt gatt = connectionManager.getGatt(deviceId);
                        if (gatt != null) {
                            Log.d(TAG, "📢 Notifying parent about auto-connection: " + deviceId);
                            autoConnectionCallback.onAutoConnected(deviceId, gatt);
                        }
                    }
                    
                } else if (state == BLEConnectionManager.ConnectionState.DISCONNECTED) {
                    Log.d(TAG, "❌ Companion device disconnected: " + deviceId);
                    
                    // Send local notification for disconnection
                    // COMMENTED OUT: Local notifications for connection/disconnection/restore/auto-connect
                    // String deviceName = getDeviceName(deviceId);
                    // sendLocalNotificationIfBackground("Device Disconnected", deviceName + " has disconnected");
                    
                    // ✅ Notify parent about auto-disconnection
                    if (autoConnectionCallback != null) {
                        Log.d(TAG, "📢 Notifying parent about auto-disconnection: " + deviceId);
                        autoConnectionCallback.onAutoDisconnected(deviceId);
                    }
                    
                    // Device will be monitored for reconnection automatically
                }
            }
            
            @Override
            public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                Log.d(TAG, "✅ Companion device services discovered: " + deviceId);
            }
            
            @Override
            public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                // ✅ Forward to parent (SampleBridgeAndroid) for auto-connected devices
                notifyCharacteristicRead(deviceId, characteristic, status);
            }
            
            @Override
            public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                // Handle characteristic writes
            }
            
            @Override
            public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                Log.d(TAG, "📡 Companion device characteristic changed: " + deviceId);
            }
        });
    }
    
    private boolean isSmartTagDevice(BluetoothDevice device) {
        // Check device name pattern for Smart Tag devices
        String deviceName = device.getName();
        if (deviceName != null) {
            // Look for Smart Tag naming patterns
            if (deviceName.toLowerCase().contains("smart") || 
                deviceName.matches("^[0-9A-F]{16}$") || // 16-character hex string
                deviceName.length() == 16) {
                return true;
            }
        }
        
        // For now, include all discovered devices for testing
        // In production, you'd want more specific filtering
        return true;
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
    
    public void addCompanionDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔗 Adding companion device: " + deviceId);
        
        companionDevices.put(deviceId, device);
        
        // Start monitoring device presence
        startObservingDevicePresence(deviceId);
        
        Log.d(TAG, "✅ Companion device added and monitoring started: " + deviceId);
    }
    
    public boolean isDeviceInRange(String deviceId) {
        return devicePresence.getOrDefault(deviceId, false);
    }
    
    public Map<String, Boolean> getAllDevicePresence() {
        return new ConcurrentHashMap<>(devicePresence);
    }
    
    public void cleanup() {
        Log.d(TAG, "🛑 BLE Companion Device Service cleanup");
        
        // Stop all presence check handlers
        for (Handler handler : presenceCheckHandlers.values()) {
            handler.removeCallbacksAndMessages(null);
        }
        presenceCheckHandlers.clear();
        
        // Stop any ongoing scans
        if (bluetoothLeScanner != null) {
            try {
                bluetoothLeScanner.stopScan(presenceScanCallback);
            } catch (Exception e) {
                Log.w(TAG, "Error stopping scan during cleanup", e);
            }
        }
        
        if (connectionManager != null) {
            connectionManager.setCompanionService(null);
        }
    }
    
    // Local notification helpers (like iOS implementation)
    private void sendLocalNotification(String title, String body) {
        try {
            Log.d(TAG, "🔔 Sending local notification: " + title + " - " + body);
            
            // Create notification channel for local notifications
            String channelId = "BLE_COMPANION_NOTIFICATIONS";
            createLocalNotificationChannel(channelId);
            
            Intent notificationIntent = new Intent(context, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context, 0, notificationIntent, 
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );
            
            Notification notification = new NotificationCompat.Builder(context, channelId)
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
            
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
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
                "BLE Companion Notifications",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            
            channel.setDescription("Local notifications for BLE companion device events");
            channel.setShowBadge(true);
            channel.enableLights(true);
            channel.enableVibration(true);
            
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
    
    private String getDeviceName(String deviceId) {
        // Try to get device name from companion devices
        BluetoothDevice device = companionDevices.get(deviceId);
        if (device != null && device.getName() != null) {
            return device.getName();
        }
        
        // Fallback to shortened device ID
        if (deviceId.length() > 8) {
            return "Device " + deviceId.substring(deviceId.length() - 8);
        }
        return "Device " + deviceId;
    }
    
    // ✅ Set callback for auto-connection notifications
    public void setAutoConnectionCallback(AutoConnectionCallback callback) {
        this.autoConnectionCallback = callback;
        Log.d(TAG, "✅ Auto-connection callback registered");
    }
    
    public void setConnectionManager(BLEConnectionManager manager) {
        this.connectionManager = manager;
    }
    
    /**
     * ✅ CRITICAL FIX: Method called by BLEConnectionManager's default callback
     * This method bridges the gap between the default callback and SampleBridgeAndroid
     */
    public void notifyConnectionStateChanged(String deviceId, BLEConnectionManager.ConnectionState state) {
        Log.d(TAG, "📢 Received connection state notification: " + deviceId + " = " + state);
        
        if (state == BLEConnectionManager.ConnectionState.CONNECTED) {
            Log.d(TAG, "✅ Device connected via default callback: " + deviceId);
            
            // Notify parent about auto-connection
            if (autoConnectionCallback != null) {
                BluetoothGatt gatt = connectionManager.getGatt(deviceId);
                if (gatt != null) {
                    Log.d(TAG, "📢 Notifying parent about auto-connection: " + deviceId);
                    autoConnectionCallback.onAutoConnected(deviceId, gatt);
                } else {
                    Log.w(TAG, "⚠️ GATT is null for connected device: " + deviceId);
                }
            } else {
                Log.w(TAG, "⚠️ autoConnectionCallback is null, cannot notify parent");
            }
            
            // Stop continuous reconnection since device is connected
            stopContinuousReconnection(deviceId);
            
        } else if (state == BLEConnectionManager.ConnectionState.DISCONNECTED) {
            Log.d(TAG, "❌ Device disconnected via default callback: " + deviceId);
            
            // Notify parent about auto-disconnection
            if (autoConnectionCallback != null) {
                Log.d(TAG, "📢 Notifying parent about auto-disconnection: " + deviceId);
                autoConnectionCallback.onAutoDisconnected(deviceId);
            }
        }
    }
    
    /**
     * ✅ Method called when services are discovered for auto-connected device
     */
    public void notifyServicesDiscovered(String deviceId) {
        Log.d(TAG, "📢 Received services discovered notification: " + deviceId);
        
        if (autoConnectionCallback != null) {
            BluetoothGatt gatt = connectionManager.getGatt(deviceId);
            if (gatt != null) {
                Log.d(TAG, "📢 Notifying parent about services discovered: " + deviceId);
                autoConnectionCallback.onServicesDiscovered(deviceId, gatt);
            } else {
                Log.w(TAG, "⚠️ GATT is null for services discovered: " + deviceId);
            }
        } else {
            Log.w(TAG, "⚠️ autoConnectionCallback is null, cannot notify about services discovered");
        }
    }
    
    /**
     * ✅ CRITICAL FIX: Forward characteristic read events to parent (SampleBridgeAndroid)
     * This allows SampleBridgeAndroid to process Device Status, battery, etc. for auto-connected devices
     */
    public void notifyCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
        Log.d(TAG, "📢 Received characteristic read notification: " + deviceId + " - " + characteristic.getUuid());
        
        if (autoConnectionCallback != null) {
            autoConnectionCallback.onCharacteristicRead(deviceId, characteristic, status);
        } else {
            Log.w(TAG, "⚠️ autoConnectionCallback is null, cannot notify about characteristic read");
        }
    }
    
    /**
     * ✅ CRITICAL FIX: Forward characteristic changed (notification) events to parent (SampleBridgeAndroid)
     * This allows SampleBridgeAndroid to process live data (temperature, steps, battery, etc.) for auto-reconnected devices
     */
    public void notifyCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
        Log.d(TAG, "📢 Received characteristic changed notification: " + deviceId + " - " + characteristic.getUuid());
        
        if (autoConnectionCallback != null) {
            autoConnectionCallback.onCharacteristicChanged(deviceId, characteristic);
        } else {
            Log.w(TAG, "⚠️ autoConnectionCallback is null, cannot notify about characteristic changed");
        }
    }
}
