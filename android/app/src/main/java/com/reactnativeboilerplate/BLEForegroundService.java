package com.reactnativeboilerplate;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import java.util.concurrent.ConcurrentHashMap;
import java.util.Map;
import java.util.Set;
import java.util.HashSet;

public class BLEForegroundService extends Service {
    private static final String CHANNEL_ID = "BLEForegroundServiceChannel";
    private static final int NOTIFICATION_ID = 1;
    private static final String TAG = "BLEForegroundService";
    
    private final IBinder binder = new LocalBinder();
    private PowerManager.WakeLock wakeLock;
    private Map<String, Boolean> connectedDevices = new ConcurrentHashMap<>();
    private Set<String> monitoredDevices = new HashSet<>();
    private boolean isServiceActive = false;
    
    public class LocalBinder extends Binder {
        BLEForegroundService getService() {
            return BLEForegroundService.this;
        }
    }
    
    // Interface for BLE operations
    public interface BLEOperationCallback {
        void onOperationComplete(boolean success, String error);
    }
    
    // Connection management methods
    public void addConnectedDevice(String deviceId) {
        connectedDevices.put(deviceId, true);
        updateNotification();
        Log.d(TAG, "Device connected: " + deviceId);
        
        // Show connection notification
        // COMMENTED OUT: Local notifications for connection/disconnection/restore/auto-connect
        // showConnectionNotification(deviceId, true);
    }
    
    public void removeConnectedDevice(String deviceId) {
        connectedDevices.remove(deviceId);
        updateNotification();
        Log.d(TAG, "Device disconnected: " + deviceId);
        
        // Show disconnection notification
        // COMMENTED OUT: Local notifications for connection/disconnection/restore/auto-connect
        // showConnectionNotification(deviceId, false);
    }
    
    public void addMonitoredDevice(String deviceId) {
        monitoredDevices.add(deviceId);
        Log.d(TAG, "Device added to monitoring: " + deviceId);
    }
    
    public void removeMonitoredDevice(String deviceId) {
        monitoredDevices.remove(deviceId);
        Log.d(TAG, "Device removed from monitoring: " + deviceId);
    }
    
    public boolean isDeviceConnected(String deviceId) {
        return connectedDevices.containsKey(deviceId);
    }
    
    public int getConnectedDeviceCount() {
        return connectedDevices.size();
    }
    
    public boolean hasActiveConnections() {
        return !connectedDevices.isEmpty();
    }
    
    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        checkNotificationPermissions();
        acquireWakeLock();
        isServiceActive = true;
        Log.d(TAG, "🏁 BLE Foreground Service created");
    }
    
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "🚀 BLE Foreground Service started");
        
        // Handle different intent actions
        if (intent != null) {
            String action = intent.getStringExtra("action");
            if ("start_monitoring".equals(action)) {
                String deviceId = intent.getStringExtra("device_id");
                if (deviceId != null) {
                    addMonitoredDevice(deviceId);
                }
            } else if ("stop_monitoring".equals(action)) {
                String deviceId = intent.getStringExtra("device_id");
                if (deviceId != null) {
                    removeMonitoredDevice(deviceId);
                }
            }
        }
        
        updateNotification();
        
        // Return START_STICKY to ensure service restarts if killed
        return START_STICKY;
    }
    
    @Override
    public IBinder onBind(Intent intent) {
        return binder;
    }
    
    @Override
    public void onDestroy() {
        super.onDestroy();
        releaseWakeLock();
        isServiceActive = false;
        Log.d(TAG, "🛑 BLE Foreground Service destroyed");
    }
    
    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK,
                    "BLEForegroundService::WakeLock"
                );
                wakeLock.acquire(10*60*1000L /*10 minutes*/);
                Log.d(TAG, "Wake lock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire wake lock", e);
        }
    }
    
    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            Log.d(TAG, "Wake lock released");
        }
    }
    
    private void updateNotification() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent, 
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );
        
        int connectedCount = getConnectedDeviceCount();
        String contentText;
        
        if (connectedCount > 0) {
            contentText = "Maintaining " + connectedCount + " BLE connection" + 
                         (connectedCount > 1 ? "s" : "") + " in background";
        } else if (!monitoredDevices.isEmpty()) {
            contentText = "Monitoring " + monitoredDevices.size() + " device" + 
                         (monitoredDevices.size() > 1 ? "s" : "") + " for reconnection";
        } else {
            contentText = "BLE service active - ready for connections";
        }
        
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Smart Tag BLE Service")
            .setContentText(contentText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
        
        startForeground(NOTIFICATION_ID, notification);
    }
    
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel serviceChannel = new NotificationChannel(
                CHANNEL_ID,
                "BLE Foreground Service Channel",
                NotificationManager.IMPORTANCE_LOW
            );
            
            serviceChannel.setDescription("Maintains BLE connections in the background");
            serviceChannel.setShowBadge(false);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(serviceChannel);
            }
        }
    }
    
    // Public methods for external access
    public boolean isServiceRunning() {
        return isServiceActive;
    }
    
    public Set<String> getMonitoredDevices() {
        return new HashSet<>(monitoredDevices);
    }
    
    public Map<String, Boolean> getConnectedDevices() {
        return new ConcurrentHashMap<>(connectedDevices);
    }
    
    // ✅ FIX: Notification deduplication tracking
    private Map<String, Long> lastConnectionNotificationTime = new ConcurrentHashMap<>();
    private static final long CONNECTION_NOTIFICATION_COOLDOWN_MS = 10000; // 10 seconds between connection notifications
    
    // Notification methods for connection events
    private void showConnectionNotification(String deviceId, boolean connected) {
        try {
            // ✅ FIX: Add debouncing to prevent notification spam
            long currentTime = System.currentTimeMillis();
            String notificationKey = deviceId + "_" + (connected ? "connected" : "disconnected");
            
            Long lastTime = lastConnectionNotificationTime.get(notificationKey);
            if (lastTime != null && (currentTime - lastTime) < CONNECTION_NOTIFICATION_COOLDOWN_MS) {
                Log.d(TAG, "🔔 Skipping duplicate connection notification (debounced) for device: " + deviceId);
                return; // Skip duplicate notification
            }
            
            lastConnectionNotificationTime.put(notificationKey, currentTime);
            
            Log.d(TAG, "🔔 Attempting to show connection notification for device: " + deviceId + ", connected: " + connected);
            
            String deviceName = getDeviceName(deviceId);
            String title = connected ? "Smart Tag Connected" : "Smart Tag Disconnected";
            String message = connected ? 
                deviceName + " is now connected" : 
                deviceName + " has disconnected";
            
            Log.d(TAG, "📱 Notification details - Title: " + title + ", Message: " + message);
            
            int icon = connected ? android.R.drawable.ic_dialog_info : android.R.drawable.ic_dialog_alert;
            int color = connected ? 0xFF4CAF50 : 0xFFF44336; // Green for connect, Red for disconnect
            
            // Create notification channel for connection events
            String channelId = "BLE_CONNECTION_EVENTS";
            createConnectionNotificationChannel(channelId);
            Log.d(TAG, "📺 Created notification channel: " + channelId);
            
            Intent notificationIntent = new Intent(this, MainActivity.class);
            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent, 
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
            );
            
            Notification notification = new NotificationCompat.Builder(this, channelId)
                .setContentTitle(title)
                .setContentText(message)
                .setSmallIcon(icon)
                .setColor(color)
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
                .build();
            
            // Use a unique notification ID for each device
            int notificationId = deviceId.hashCode();
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                Log.d(TAG, "📱 About to show notification with ID: " + notificationId);
                manager.notify(notificationId, notification);
                Log.d(TAG, "✅ Connection notification shown successfully: " + message);
            } else {
                Log.e(TAG, "❌ NotificationManager is null - cannot show notification");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to show connection notification", e);
        }
    }
    
    private void createConnectionNotificationChannel(String channelId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                channelId,
                "BLE Connection Events",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            
            channel.setDescription("Notifications for BLE device connections and disconnections");
            channel.setShowBadge(true);
            channel.enableLights(true);
            channel.enableVibration(true);
            
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.createNotificationChannel(channel);
            }
        }
    }
    
    private void checkNotificationPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                boolean areNotificationsEnabled = manager.areNotificationsEnabled();
                Log.d(TAG, "📱 Notification permissions status: " + areNotificationsEnabled);
                
                if (!areNotificationsEnabled) {
                    Log.w(TAG, "⚠️ Notifications are disabled - connection notifications may not appear");
                }
            }
        } else {
            Log.d(TAG, "📱 Android version < 13 - notification permissions not required");
        }
    }
    
    private String getDeviceName(String deviceId) {
        // Try to get device name from SharedPreferences or return shortened ID
        try {
            SharedPreferences prefs = getSharedPreferences("SmartTagPrefs", Context.MODE_PRIVATE);
            String deviceName = prefs.getString("device_name_" + deviceId, null);
            if (deviceName != null && !deviceName.isEmpty()) {
                return deviceName;
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed to get device name from preferences", e);
        }
        
        // Fallback to shortened device ID
        if (deviceId.length() > 8) {
            return "Device " + deviceId.substring(deviceId.length() - 8);
        }
        return "Device " + deviceId;
    }
}
