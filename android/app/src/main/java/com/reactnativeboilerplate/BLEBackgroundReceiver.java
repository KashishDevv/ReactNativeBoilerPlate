package com.reactnativeboilerplate;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.bluetooth.le.ScanResult;
import android.bluetooth.le.ScanRecord;
import android.bluetooth.BluetoothDevice;
import android.util.Log;
import java.util.List;

public class BLEBackgroundReceiver extends BroadcastReceiver {
    private static final String TAG = "BLEBackgroundReceiver";
    
    @Override
    public void onReceive(Context context, Intent intent) {
        Log.d(TAG, "📡 Received BLE background scan result");
        
        if ("com.reactnativeboilerplate.BLE_SCAN_RESULT".equals(intent.getAction())) {
            handleScanResult(context, intent);
        }
    }
    
    private void handleScanResult(Context context, Intent intent) {
        Log.d(TAG, "🔍 Handling background scan result");
        
        try {
            // Get scan results from intent
            List<ScanResult> results = intent.getParcelableArrayListExtra("android.bluetooth.le.extra.LIST_SCAN_RESULT");
            
            if (results != null) {
                Log.d(TAG, "📋 Found " + results.size() + " devices in background scan");
                
                for (ScanResult result : results) {
                    BluetoothDevice device = result.getDevice();
                    ScanRecord record = result.getScanRecord();
                    
                    Log.d(TAG, "📱 Device: " + device.getAddress() + 
                          ", RSSI: " + result.getRssi() + 
                          ", Name: " + device.getName());
                    
                    // Check if this is a Smart Tag device
                    if (isSmartTagDevice(device, record)) {
                        Log.d(TAG, "🏷️ Found Smart Tag device: " + device.getAddress());
                        
                        // Start foreground service and connect
                        startForegroundServiceAndConnect(context, device);
                    }
                }
            } else {
                Log.w(TAG, "⚠️ No scan results found in intent");
            }
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Error handling scan result", e);
        }
    }
    
    private boolean isSmartTagDevice(BluetoothDevice device, ScanRecord record) {
        if (record == null) return false;
        
        // Check for Smart Tag service UUID in advertised services
        List<android.os.ParcelUuid> serviceUuids = record.getServiceUuids();
        if (serviceUuids != null) {
            for (android.os.ParcelUuid uuid : serviceUuids) {
                if ("0f0e0d0c-0b0a-0908-0706-050403020100".equals(uuid.toString())) {
                    return true;
                }
            }
        }
        
        // Check device name pattern
        String deviceName = device.getName();
        if (deviceName != null && deviceName.toLowerCase().contains("smart")) {
            return true;
        }
        
        return false;
    }
    
    private void startForegroundServiceAndConnect(Context context, BluetoothDevice device) {
        Log.d(TAG, "🚀 Starting foreground service and connecting to: " + device.getAddress());
        
        try {
            // Start foreground service
            Intent serviceIntent = new Intent(context, BLEForegroundService.class);
            serviceIntent.putExtra("action", "start_monitoring");
            serviceIntent.putExtra("device_id", device.getAddress());
            context.startForegroundService(serviceIntent);
            
            // Schedule connection work
            BLEWorkManager.scheduleOneTimeConnect(context, device.getAddress());
            
            Log.d(TAG, "✅ Foreground service started and connection scheduled");
            
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start foreground service", e);
        }
    }
}
