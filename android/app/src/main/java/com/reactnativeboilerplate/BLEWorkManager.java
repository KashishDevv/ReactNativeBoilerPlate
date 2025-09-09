package com.reactnativeboilerplate;

import android.content.Context;
import android.content.Intent;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import androidx.work.Constraints;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.OneTimeWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Data;
import java.util.concurrent.TimeUnit;

public class BLEWorkManager extends Worker {
    private static final String TAG = "BLEWorkManager";
    private static final String WORK_TAG = "ble_background_work";
    
    public BLEWorkManager(@NonNull Context context, @NonNull WorkerParameters workerParams) {
        super(context, workerParams);
    }
    
    @NonNull
    @Override
    public Result doWork() {
        Log.d(TAG, "🚀 BLE Background Work started");
        
        try {
            // Get input data
            Data inputData = getInputData();
            String action = inputData.getString("action");
            String deviceId = inputData.getString("device_id");
            
            Log.d(TAG, "📋 Work action: " + action + ", device: " + deviceId);
            
            switch (action != null ? action : "scan") {
                case "scan":
                    return performBackgroundScan();
                case "connect":
                    return performBackgroundConnect(deviceId);
                case "monitor":
                    return performBackgroundMonitor(deviceId);
                default:
                    Log.w(TAG, "⚠️ Unknown work action: " + action);
                    return Result.failure();
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ BLE Background Work failed", e);
            return Result.failure();
        }
    }
    
    private Result performBackgroundScan() {
        Log.d(TAG, "🔍 Performing background scan");
        
        try {
            // Start foreground service for BLE operations
            Context context = getApplicationContext();
            Intent serviceIntent = new Intent(context, BLEForegroundService.class);
            serviceIntent.putExtra("action", "start_monitoring");
            context.startForegroundService(serviceIntent);
            
            // Perform BLE scan using connection manager
            BLEConnectionManager connectionManager = new BLEConnectionManager(context);
            connectionManager.startBackgroundScan();
            
            return Result.success();
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Background scan failed", e);
            return Result.failure();
        }
    }
    
    private Result performBackgroundConnect(String deviceId) {
        Log.d(TAG, "🔗 Performing background connect to: " + deviceId);
        
        try {
            if (deviceId == null) {
                Log.w(TAG, "⚠️ No device ID provided for background connect");
                return Result.failure();
            }
            
            // Start foreground service
            Context context = getApplicationContext();
            Intent serviceIntent = new Intent(context, BLEForegroundService.class);
            serviceIntent.putExtra("action", "start_monitoring");
            serviceIntent.putExtra("device_id", deviceId);
            context.startForegroundService(serviceIntent);
            
            // Perform connection
            BLEConnectionManager connectionManager = new BLEConnectionManager(context);
            connectionManager.connectToBondedDevices();
            
            return Result.success();
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Background connect failed", e);
            return Result.failure();
        }
    }
    
    private Result performBackgroundMonitor(String deviceId) {
        Log.d(TAG, "👁️ Performing background monitor for: " + deviceId);
        
        try {
            if (deviceId == null) {
                Log.w(TAG, "⚠️ No device ID provided for background monitor");
                return Result.failure();
            }
            
            // Update foreground service
            Context context = getApplicationContext();
            Intent serviceIntent = new Intent(context, BLEForegroundService.class);
            serviceIntent.putExtra("action", "start_monitoring");
            serviceIntent.putExtra("device_id", deviceId);
            context.startForegroundService(serviceIntent);
            
            return Result.success();
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Background monitor failed", e);
            return Result.failure();
        }
    }
    
    // Static methods for scheduling work
    public static void schedulePeriodicScan(Context context) {
        Log.d(TAG, "📅 Scheduling periodic BLE scan");
        
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .setRequiresBatteryNotLow(false)
                .build();
        
        PeriodicWorkRequest scanWork = new PeriodicWorkRequest.Builder(
                BLEWorkManager.class,
                15, TimeUnit.MINUTES, // Minimum interval for periodic work
                5, TimeUnit.MINUTES   // Flex interval
        )
                .setConstraints(constraints)
                .setInputData(new Data.Builder()
                        .putString("action", "scan")
                        .build())
                .addTag(WORK_TAG)
                .build();
        
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                "ble_periodic_scan",
                androidx.work.ExistingPeriodicWorkPolicy.KEEP,
                scanWork
        );
    }
    
    public static void scheduleOneTimeConnect(Context context, String deviceId) {
        Log.d(TAG, "📅 Scheduling one-time BLE connect for: " + deviceId);
        
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .setRequiresBatteryNotLow(false)
                .build();
        
        OneTimeWorkRequest connectWork = new OneTimeWorkRequest.Builder(BLEWorkManager.class)
                .setConstraints(constraints)
                .setInputData(new Data.Builder()
                        .putString("action", "connect")
                        .putString("device_id", deviceId)
                        .build())
                .addTag(WORK_TAG)
                .build();
        
        WorkManager.getInstance(context).enqueueUniqueWork(
                "ble_connect_" + deviceId,
                androidx.work.ExistingWorkPolicy.REPLACE,
                connectWork
        );
    }
    
    public static void scheduleOneTimeMonitor(Context context, String deviceId) {
        Log.d(TAG, "📅 Scheduling one-time BLE monitor for: " + deviceId);
        
        Constraints constraints = new Constraints.Builder()
                .setRequiredNetworkType(NetworkType.NOT_REQUIRED)
                .setRequiresBatteryNotLow(false)
                .build();
        
        OneTimeWorkRequest monitorWork = new OneTimeWorkRequest.Builder(BLEWorkManager.class)
                .setConstraints(constraints)
                .setInputData(new Data.Builder()
                        .putString("action", "monitor")
                        .putString("device_id", deviceId)
                        .build())
                .addTag(WORK_TAG)
                .build();
        
        WorkManager.getInstance(context).enqueueUniqueWork(
                "ble_monitor_" + deviceId,
                androidx.work.ExistingWorkPolicy.KEEP,
                monitorWork
        );
    }
    
    public static void cancelAllWork(Context context) {
        Log.d(TAG, "🛑 Cancelling all BLE background work");
        WorkManager.getInstance(context).cancelAllWorkByTag(WORK_TAG);
    }
}
