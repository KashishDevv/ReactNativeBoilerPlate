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
    
    private Context context;
    private BLEConnectionManager connectionManager;
    private Map<String, BluetoothDevice> companionDevices = new ConcurrentHashMap<>();
    private Map<String, Boolean> devicePresence = new ConcurrentHashMap<>();
    private Map<String, Handler> presenceCheckHandlers = new ConcurrentHashMap<>();
    
    // BLE components for device monitoring
    private BluetoothManager bluetoothManager;
    private BluetoothAdapter bluetoothAdapter;
    private BluetoothLeScanner bluetoothLeScanner;
    
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
        Log.d(TAG, "👁️ Device " + deviceId + " out of range, continuing to monitor");
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
        if (bluetoothLeScanner == null || !hasBluetoothPermissions()) {
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
            ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_POWER)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_FIRST_MATCH)
                    .setReportDelay(0);
            
            ScanSettings settings = settingsBuilder.build();
            
            // Start a short scan to detect device presence
            bluetoothLeScanner.startScan(filters, settings, presenceScanCallback);
            
            // Stop scan after 2 seconds
            Handler stopHandler = new Handler(Looper.getMainLooper());
            stopHandler.postDelayed(() -> {
                try {
                    bluetoothLeScanner.stopScan(presenceScanCallback);
                } catch (Exception e) {
                    Log.w(TAG, "Error stopping presence scan", e);
                }
            }, 2000);
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to perform presence scan for: " + deviceId, e);
        }
    }
    
    private void connectToCompanionDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔗 Connecting to companion device: " + deviceId);
        
        // Check if already connected
        if (connectionManager.isDeviceConnected(deviceId)) {
            Log.d(TAG, "✅ Device already connected: " + deviceId);
            return;
        }
        
        // Use connection manager to connect with auto-connect enabled
        connectionManager.connectToDevice(deviceId, device, new BLEConnectionManager.BLEConnectionCallback() {
            @Override
            public void onConnectionStateChanged(String deviceId, BLEConnectionManager.ConnectionState state) {
                Log.d(TAG, "🔗 Companion device connection state changed: " + deviceId + " = " + state);
                
                if (state == BLEConnectionManager.ConnectionState.CONNECTED) {
                    Log.d(TAG, "✅ Companion device connected successfully: " + deviceId);
                    
                    // Send local notification for auto-connection (like iOS)
                    String deviceName = getDeviceName(deviceId);
                    sendLocalNotificationIfBackground("Device Connected", "Connected to " + deviceName);
                    
                } else if (state == BLEConnectionManager.ConnectionState.DISCONNECTED) {
                    Log.d(TAG, "❌ Companion device disconnected: " + deviceId);
                    
                    // Send local notification for disconnection
                    String deviceName = getDeviceName(deviceId);
                    sendLocalNotificationIfBackground("Device Disconnected", deviceName + " has disconnected");
                    
                    // Device will be monitored for reconnection automatically
                }
            }
            
            @Override
            public void onServicesDiscovered(String deviceId, List<BluetoothGattService> services) {
                Log.d(TAG, "✅ Companion device services discovered: " + deviceId);
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
}
