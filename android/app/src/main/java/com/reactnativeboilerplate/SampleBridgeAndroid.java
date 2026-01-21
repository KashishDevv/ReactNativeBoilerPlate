/*
 * SampleBridgeAndroid.java
 * 
 * React Native Bridge Module for Bluetooth Low Energy (BLE) Smart Tag Device Communication
 * 
 * This module provides comprehensive BLE functionality for React Native applications, including:
 * - Device scanning and discovery
 * - Connection management with auto-reconnect capabilities
 * - GATT service and characteristic operations
 * - Secure pairing and bonding
 * - Data synchronization and real-time monitoring
 * - DFU (Device Firmware Update) support
 * - Background operation with foreground service
 * - Battery optimization handling
 * 
 * @author Your Team Name
 * @version 1.0
 * @since 2025-01-13
 */

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
import android.os.HandlerThread;
import android.os.Looper;
import android.os.PowerManager;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.MediaType;
import okhttp3.RequestBody;
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
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.Manifest;
import android.app.ActivityManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.os.Binder;
import androidx.core.app.NotificationCompat;
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
import java.lang.reflect.Method;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import javax.crypto.spec.IvParameterSpec;
import com.reactnativeboilerplate.BLEConnectionManager.BLEConnectionCallback;
import com.reactnativeboilerplate.BLEConnectionManager.ConnectionState;
import no.nordicsemi.android.dfu.DfuProgressListener;
import no.nordicsemi.android.dfu.DfuProgressListenerAdapter;
import no.nordicsemi.android.dfu.DfuServiceInitiator;
import no.nordicsemi.android.dfu.DfuServiceListenerHelper;
import no.nordicsemi.android.dfu.DfuBaseService;
import android.net.Uri;

/**
 * DescriptorWriteRequest
 * 
 * Internal class to queue BLE descriptor write operations.
 * Ensures sequential processing of descriptor writes to prevent GATT 133 errors.
 */
class DescriptorWriteRequest {
    /** The GATT connection instance */
    BluetoothGatt gatt;
    
    /** The characteristic containing the descriptor */
    BluetoothGattCharacteristic characteristic;
    
    /** The descriptor to write to */
    BluetoothGattDescriptor descriptor;
    
    /** Unique device identifier (MAC address) */
    String deviceId;
    
    /** UUID of the characteristic */
    String charUuid;
    
    /**
     * Constructs a descriptor write request.
     * 
     * @param gatt The GATT connection
     * @param characteristic The parent characteristic
     * @param descriptor The descriptor to write
     * @param deviceId Device MAC address
     * @param charUuid Characteristic UUID string
     */
    DescriptorWriteRequest(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, 
                          BluetoothGattDescriptor descriptor, String deviceId, String charUuid) {
        this.gatt = gatt;
        this.characteristic = characteristic;
        this.descriptor = descriptor;
        this.deviceId = deviceId;
        this.charUuid = charUuid;
    }
}

/**
 * SampleBridgeAndroid
 * 
 * Main BLE Bridge Module for React Native
 * 
 * This class serves as the primary interface between React Native JavaScript and 
 * Android's Bluetooth Low Energy (BLE) stack. It handles all aspects of BLE communication
 * including device discovery, connection management, data transfer, and firmware updates.
 * 
 * Key Features:
 * - Concurrent device management with thread-safe operations
 * - Automatic reconnection and state restoration
 * - Queue-based operation handling to prevent GATT errors
 * - Comprehensive error handling and recovery
 * - Background service support for continuous monitoring
 * - MTU negotiation for optimized data transfer
 * - Secure pairing with passkey management
 * 
 * Thread Safety:
 * This class uses ConcurrentHashMap and synchronized collections for thread-safe
 * operations across multiple BLE devices and callbacks.
 */
public class SampleBridgeAndroid extends ReactContextBaseJavaModule {
    
    // ============================================================================
    // CONSTANTS - Logging and HTTP Client
    // ============================================================================
    
    /** Tag for Android logging */
    private static final String TAG = "SampleBridgeAndroid";
    
    /** HTTP client for API communication */
    private OkHttpClient client = new OkHttpClient();
    
    // ============================================================================
    // CONSTANTS - BLE Service UUIDs
    // ============================================================================
    
    /** Custom Smart Tag service UUID for proprietary device communication */
    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    
    /** Standard BLE Battery Service UUID (0x180F) */
    private static final String BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
    
    /** Standard BLE Device Information Service UUID (0x180A) */
    private static final String DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
    
    /** Standard BLE Generic Access Service UUID (0x1800) */
    private static final String GENERIC_ACCESS_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
    
    /** Nordic DFU (Device Firmware Update) service UUID */
    private static final String DFU_SERVICE_UUID = "8ec90003-f315-4f60-9fb8-838830daea50";
    
    // ============================================================================
    // CONSTANTS - BLE Characteristic UUIDs
    // ============================================================================
    
    /** System command characteristic for sending control commands */
    private static final String SYSTEM_COMMAND_CHAR_UUID = "4f4e4d4c-4b4a-4948-4746-454443424140";
    
    /** Device status characteristic for receiving device state updates */
    private static final String DEVICE_STATUS_CHAR_UUID = "5f5e5d5c-5b5a-5958-5756-555453525150";
    
    /** Data transfer characteristic for bulk data synchronization */
    private static final String DATA_TRANSFER_CHAR_UUID = "6f6e6d6c-6b6a-6968-6766-656463626160";
    
    /** Standard Battery Level characteristic UUID (0x2A19) */
    private static final String BATTERY_LEVEL_CHAR_UUID = "00002a19-0000-1000-8000-00805f9b34fb";
    
    /** Standard Manufacturer Name String characteristic UUID (0x2A29) */
    private static final String MANUFACTURER_NAME_CHAR_UUID = "00002a29-0000-1000-8000-00805f9b34fb";
    
    /** Standard Model Number String characteristic UUID (0x2A24) */
    private static final String MODEL_NUMBER_CHAR_UUID = "00002a24-0000-1000-8000-00805f9b34fb";
    
    /** Standard Firmware Revision String characteristic UUID (0x2A26) */
    private static final String FIRMWARE_REVISION_CHAR_UUID = "00002a26-0000-1000-8000-00805f9b34fb";
    
    // ============================================================================
    // CONSTANTS - Device Identification
    // ============================================================================
    
    /** Manufacturer ID used in BLE advertisement for device filtering */
    private static final int SMART_TAG_MANUFACTURER_ID = 0x1234;
    
    /** Maximum number of devices to track in memory to prevent memory leaks */
    private static final int MAX_DEVICE_MAP_SIZE = 50;
    
    /**
     * BLEErrorType
     * 
     * Categorizes BLE errors for appropriate error handling and recovery strategies.
     */
    enum BLEErrorType {
        /** Temporary error that may resolve with retry (e.g., connection timeout) */
        TRANSIENT,
        
        /** Permanent error requiring user intervention (e.g., device out of range) */
        PERMANENT,
        
        /** Error requiring user action (e.g., enable Bluetooth, grant permissions) */
        USER_ACTION
    }
    
    // ============================================================================
    // CONSTANTS - Protocol Packet Identifiers
    // ============================================================================
    
    /** Packet header byte identifying a request message */
    private static final byte REQUEST_ID = (byte) 0xAA;
    
    /** Packet header byte identifying a response message */
    private static final byte RESPONSE_ID = (byte) 0xBB;
    
    /** Status byte indicating successful command execution */
    private static final byte STATUS_SUCCESS = 0x00;
    
    /** Status byte indicating failed command execution */
    private static final byte STATUS_FAILURE = 0x01;
    
    // ============================================================================
    // CONSTANTS - System Command IDs
    // ============================================================================
    
    /** Command: Set device system time (RTC synchronization) */
    private static final byte CMD_SET_SYSTEM_TIME = 0x01;
    
    /** Command: Set advertising interval for BLE broadcasts */
    private static final byte CMD_SET_ADV_INTERVAL = 0x02;
    
    /** Command: Set connection interval for active BLE connections */
    private static final byte CMD_SET_CONN_INTERVAL = 0x03;
    
    /** Command: Set data acquisition interval for sensor readings */
    private static final byte CMD_SET_DATA_INTERVAL = 0x04;
    
    /** Command: Get firmware version information */
    private static final byte CMD_GET_FW_VERSION = 0x05;
    
    /** Command: Get hardware version information */
    private static final byte CMD_GET_HW_VERSION = 0x06;
    
    /** Command: Get device diagnostics and health information */
    private static final byte CMD_GET_DIAGNOSTICS = 0x07;
    
    /** Command: Start historical data synchronization */
    private static final byte CMD_DATA_SYNC_START = 0x08;
    
    /** Command: Stop ongoing data synchronization */
    private static final byte CMD_DATA_SYNC_STOP = 0x09;
    
    /** Command: Enter DFU (Device Firmware Update) mode */
    private static final byte CMD_ENTER_DFU_MODE = 0x0A;
    
    /** Command: Restart the device */
    private static final byte CMD_SYSTEM_RESTART = 0x10;
    
    /** Command: Toggle device buzzer for locating device */
    private static final byte CMD_TOGGLE_BUZZER = 0x11;
    
    /** Command: Unpair device (remove bonding) */
    private static final byte CMD_UNPAIR_DEVICE = 0x12;
    
    /** Command: Factory reset device to default settings */
    private static final byte CMD_FACTORY_RESET = 0x13;
    
    /** Command: Update device passkey for secure pairing */
    private static final byte CMD_PASSKEY_UPDATE = 0x14;
    
    // ============================================================================
    // CONSTANTS - Security
    // ============================================================================
    
    /** Default static passkey for device pairing (6 digits) */
    private static final String STATIC_PASSKEY = "123456";
    
    // ============================================================================
    // SECURITY METHODS
    // ============================================================================
    
    /**
     * Retrieves the pairing passkey for a specific device.
     * 
     * First checks if a custom passkey has been stored for the device. If a valid
     * 6-digit passkey exists, it is returned. Otherwise, returns the default static passkey.
     * 
     * @param deviceId The MAC address of the device
     * @return 6-digit passkey string for pairing
     */
    private String getPasskeyForDevice(String deviceId) {
        String storedPasskey = devicePasskeys.get(deviceId);
        if (storedPasskey != null && storedPasskey.length() == 6) {
            return storedPasskey;
        }
        return STATIC_PASSKEY;
    }
    
    /**
     * BroadcastReceiver for handling Bluetooth pairing events.
     * 
     * This receiver monitors:
     * - ACTION_PAIRING_REQUEST: Handles pairing variant detection and passkey entry
     * - ACTION_BOND_STATE_CHANGED: Tracks bonding state transitions
     * 
     * Key Features:
     * - Detects and rejects OOB (Out of Band) pairing attempts to force PIN entry
     * - Handles automatic and manual pairing confirmation
     * - Manages connection flow after successful bonding
     * - Implements retry logic for failed OOB pairing attempts
     * - Provides user-friendly error messages with passkey information
     * 
     * Android Limitations:
     * Programmatic pairing confirmation requires BLUETOOTH_PRIVILEGED permission,
     * which is only available to system apps. For regular apps, users must confirm
     * pairing manually through the system dialog.
     */
    private BroadcastReceiver pairingReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            BluetoothDevice device = intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
            if (device == null) return;
            String deviceId = device.getAddress();            if (BluetoothDevice.ACTION_PAIRING_REQUEST.equals(action)) {
                devicesWithPairingRequest.add(deviceId);
                try {
                    int pairingVariant = intent.getIntExtra(BluetoothDevice.EXTRA_PAIRING_VARIANT,
                                                              BluetoothDevice.PAIRING_VARIANT_PIN);
                    if (pairingVariant == 1) { 
                        Log.w(TAG, "⚠️ [PAIRING] OOB variant detected (variant=" + pairingVariant + ") - rejecting to force PIN entry");
                        Log.w(TAG, "   Android is trying OOB pairing, but device needs Passkey Entry");
                        try {
                            device.setPairingConfirmation(false);
                            Log.d(TAG, "   🔄 Rejected OOB pairing - Android should retry with PIN entry");
                        } catch (SecurityException e) {
                            Log.w(TAG, "⚠️ [PAIRING] Cannot reject OOB programmatically (requires BLUETOOTH_PRIVILEGED permission)");
                            Log.w(TAG, "   ✅ User will need to handle pairing manually in system dialog");
                        } catch (Exception e) {
                            Log.e(TAG, "❌ [PAIRING] Error rejecting OOB: " + e.getMessage());
                        }
                        return; 
                    }
                    if (pairingVariant == BluetoothDevice.PAIRING_VARIANT_PIN) {
                        String passkey = getPasskeyForDevice(deviceId);
                        Log.d(TAG, "   ✅ NOT setting PIN programmatically - user will enter it manually");
                    } else if (pairingVariant == BluetoothDevice.PAIRING_VARIANT_PASSKEY_CONFIRMATION) {
                        try {
                            device.setPairingConfirmation(true);
                            Log.d(TAG, "   ✅ Pairing confirmation sent programmatically");
                        } catch (SecurityException e) {
                            Log.w(TAG, "⚠️ [PAIRING] Cannot confirm programmatically (requires BLUETOOTH_PRIVILEGED permission)");
                            Log.w(TAG, "   ✅ This is normal - user will confirm pairing manually in system dialog");
                            Log.w(TAG, "   💡 Pairing will proceed when user confirms the passkey in the dialog");
                        } catch (Exception e) {
                            Log.e(TAG, "❌ [PAIRING] Error confirming pairing: " + e.getMessage());
                        }
                    } else {
                        try {
                            device.setPairingConfirmation(true);
                            Log.d(TAG, "   ✅ Pairing confirmation sent programmatically");
                        } catch (SecurityException e) {
                            Log.w(TAG, "⚠️ [PAIRING] Cannot confirm programmatically (requires BLUETOOTH_PRIVILEGED permission)");
                            Log.w(TAG, "   ✅ This is normal - user will confirm pairing manually in system dialog");
                        } catch (Exception e) {
                            Log.e(TAG, "❌ [PAIRING] Error confirming pairing: " + e.getMessage());
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "❌ [PAIRING] Error handling pairing request: " + e.getMessage(), e);
                }
            } else if (BluetoothDevice.ACTION_BOND_STATE_CHANGED.equals(action)) {
                int bondState = intent.getIntExtra(BluetoothDevice.EXTRA_BOND_STATE, BluetoothDevice.BOND_NONE);
                int previousBondState = intent.getIntExtra(BluetoothDevice.EXTRA_PREVIOUS_BOND_STATE, BluetoothDevice.BOND_NONE);
                if (bondState == BluetoothDevice.BOND_BONDED) {
                    BluetoothDevice waitingDevice = devicesWaitingForBonding.remove(deviceId);
                    if (waitingDevice != null) {
                        Log.d(TAG, "✅ Bonding completed for device: " + deviceId + " - waiting 800ms before GATT connection");
                        String promiseKey = "connect_" + deviceId;
                        // Industry best practice: Increase timeout to 15-20s for first connect
                        long timeoutMs = 15000; // 15 seconds (was 12s) 
                        mainHandler.postDelayed(() -> {
                            int currentBondState = waitingDevice.getBondState();
                            if (currentBondState == BluetoothDevice.BOND_BONDED) {
                                Log.d(TAG, "✅ Proceeding with GATT connection after bonding delay for: " + deviceId);
                                proceedWithGattConnection(waitingDevice, deviceId);
                                ScheduledFuture<?> timeoutTimer = executorService.schedule(() -> {
                                    synchronized(gattLock) {
                                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                                        if (gatt != null) {
                                            try {
                                                int connectionState = bluetoothManager.getConnectionState(gatt.getDevice(), BluetoothProfile.GATT);
                                                if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                                                    Log.d(TAG, "✅ Timeout fired but device is connected (after bonding) - ignoring timeout for: " + deviceId);
                                                    connectionTimeoutTimers.remove(deviceId);
                                                    return; 
                                                }
                                            } catch (Exception e) {
                                                Log.e(TAG, "❌ Error checking connection state in timeout (after bonding): " + e.getMessage());
                                            }
                                        }
                                    }
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        pendingPromise.reject("CONNECTION_TIMEOUT", "Connection timeout after " + (timeoutMs/1000) + "s");
                                        Log.w(TAG, "⏱️ Connection timeout for device (after bonding): " + deviceId);
                                        synchronized(gattLock) {
                                            BluetoothGatt gatt = connectedGatts.remove(deviceId);
                                            if (gatt != null) {
                                                try {
                                                    gatt.disconnect();
                                                    gatt.close();
                                                } catch (Exception e) {
                                                    Log.e(TAG, "❌ Error cleaning up after timeout: " + e.getMessage());
                                                }
                                            }
                                        }
                                    }
                                    connectionTimeoutTimers.remove(deviceId);
                                }, timeoutMs, TimeUnit.MILLISECONDS);
                                connectionTimeoutTimers.put(deviceId, timeoutTimer);
                                Log.d(TAG, "✅ Connection timeout set after bonding: " + (timeoutMs/1000) + "s");
                            } else {
                                Log.w(TAG, "⚠️ Bond state changed to " + currentBondState + " during delay - connection cancelled for: " + deviceId);
                                Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                if (pendingPromise != null) {
                                    pendingPromise.reject("BONDING_CANCELLED", "Bonding was cancelled or failed");
                                }
                            }
                        }, 800); 
                    } else {
                        if (devicesPendingPairingVerification.containsKey(deviceId)) {
                            BluetoothGatt gatt = connectedGatts.get(deviceId);
                            if (gatt != null) {
                                ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                if (timer != null) {
                                    timer.cancel(false);
                                }
                                addToBondedDevices(deviceId, device);
                                verifyPairingAndConfirmConnection(deviceId, gatt);
                            } else {
                                Log.w(TAG, "⚠️ [BONDING] Device pending verification but no GATT connection found");
                            }
                        } else if (devicesWaitingForBonding.containsKey(deviceId)) {
                            devicesWaitingForBonding.remove(deviceId);
                            addToBondedDevices(deviceId, device);
                            mainHandler.postDelayed(() -> {
                                proceedWithGattConnection(device, deviceId);
                            }, 500);
                        } else {
                        }
                    }
                } else if (bondState == BluetoothDevice.BOND_NONE &&
                          previousBondState == BluetoothDevice.BOND_BONDING) {
                    boolean wasOOBFailure = !devicesWithPairingRequest.contains(deviceId) && devicesWaitingForBonding.containsKey(deviceId);
                    if (wasOOBFailure) {
                        Log.w(TAG, "❌ [BONDING] OOB pairing failed silently for device: " + deviceId);
                        Log.w(TAG, "   Android tried OOB pairing but no ACTION_PAIRING_REQUEST was received");
                        Log.w(TAG, "   This means Android attempted OOB pairing without user interaction");
                        devicesWaitingForBonding.remove(deviceId);
                        try {
                            if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                                java.lang.reflect.Method removeBondMethod = device.getClass().getMethod("removeBond");
                                removeBondMethod.invoke(device);                            }
                        } catch (Exception e) {
                            Log.w(TAG, "⚠️ Could not remove failed bond: " + e.getMessage());
                        }
                        devicesWaitingForBonding.put(deviceId, device);
                        executorService.schedule(() -> {
                            if (devicesWaitingForBonding.containsKey(deviceId)) {
                                try {
                                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                                        java.lang.reflect.Method createBondMethod = device.getClass().getMethod("createBond", int.class);
                                        int TRANSPORT_LE = 2;
                                        Object result = createBondMethod.invoke(device, TRANSPORT_LE);
                                        boolean bondResult = (Boolean) result;
                                        if (!bondResult) {
                                            devicesWaitingForBonding.remove(deviceId);
                                            String promiseKey = "connect_" + deviceId;
                                            Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                            if (pendingPromise != null) {
                                                String passkey = getPasskeyForDevice(deviceId);
                                                pendingPromise.reject("BONDING_FAILED", 
                                                    "Unable to trigger pairing dialog. Please pair the device manually via Android Bluetooth settings (passkey: " + passkey + ")");
                                            }
                                        }
                                    }
                                } catch (Exception e) {
                                    Log.e(TAG, "❌ [OOB RETRY] Error retrying createBond: " + e.getMessage(), e);
                                    devicesWaitingForBonding.remove(deviceId);
                                    String promiseKey = "connect_" + deviceId;
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        String passkey = getPasskeyForDevice(deviceId);
                                        pendingPromise.reject("BONDING_FAILED", 
                                            "Pairing failed. Please pair manually via Android Bluetooth settings (passkey: " + passkey + ")");
                                    }
                                }
                            }
                        }, 2, TimeUnit.SECONDS);
                        return; 
                    }
                    Log.w(TAG, "❌ [BONDING] Bonding failed for device: " + deviceId);
                    Log.w(TAG, "   Possible reasons: user cancelled, incorrect passkey, or pairing timeout");
                    devicesWithPairingRequest.remove(deviceId); 
                    devicesWaitingForBonding.remove(deviceId);
                    try {
                        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                            java.lang.reflect.Method removeBondMethod = device.getClass().getMethod("removeBond");
                            removeBondMethod.invoke(device);                        }
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ Could not remove failed bond: " + e.getMessage());
                    }
                    String promiseKey = "connect_" + deviceId;
                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                    if (pendingPromise != null) {
                        String passkey = getPasskeyForDevice(deviceId);
                        String errorMessage = "Pairing failed. Please try connecting again and enter passkey: " + passkey + " when prompted.";
                        pendingPromise.reject("BONDING_FAILED", errorMessage);
                    }
                }
            }
        }
    };
    
    // ============================================================================
    // CONSTANTS - Data Transfer Protocol
    // ============================================================================
    
    /** Data transfer packet type: Synchronization start notification */
    private static final byte DATA_TRANSFER_SYNC_START = 0x01;
    
    /** Data transfer packet type: Synchronization complete notification */
    private static final byte DATA_TRANSFER_SYNC_COMPLETE = 0x02;
    
    /** Data transfer packet type: Health data record */
    private static final byte DATA_TRANSFER_RECORD = 0x03;
    
    /** Data transfer packet type: Read error occurred on device */
    private static final byte DATA_TRANSFER_READ_ERROR = 0x04;
    
    // ============================================================================
    // CONSTANTS - Data Packet Offsets (Device Status)
    // ============================================================================
    
    /** Byte offset for timestamp in device status packets */
    private static final int TIMESTAMP_OFFSET = 0;
    
    /** Byte offset for record count in device status packets */
    private static final int RECORD_COUNT_OFFSET = 4;
    
    /** Byte offset for battery voltage in device status packets */
    private static final int BATTERY_VOLTAGE_OFFSET = 6;
    
    /** Total size in bytes of device status packet */
    private static final int DEVICE_STATUS_SIZE = 8;
    
    // ============================================================================
    // CONSTANTS - Data Packet Offsets (Health Records)
    // ============================================================================
    
    /** Byte offset for timestamp in health record packets */
    private static final int RECORD_TIMESTAMP_OFFSET = 0;
    
    /** Byte offset for step count in health record packets */
    private static final int RECORD_STEPS_OFFSET = 4;
    
    /** Byte offset for temperature in health record packets */
    private static final int RECORD_TEMP_OFFSET = 6;
    
    /** Byte offset for flags in health record packets */
    private static final int RECORD_FLAGS_OFFSET = 7;
    
    /** Total size in bytes of a single health record */
    private static final int RECORD_SIZE = 8;
    
    // ============================================================================
    // CONSTANTS - API Configuration
    // ============================================================================
    
    /** API key for backend authentication */
    private static final String API_KEY = "34A4601F-0930-4A22-8993-97B951881F83";
    
    /** API password for backend authentication */
    private static final String API_PASSWORD = "xxxaeexrkp";
    
    /** Base URL for backend API endpoints */
    private static final String API_BASE_URL = "https://your-api-endpoint.com";
    
    // ============================================================================
    // INSTANCE VARIABLES - Bluetooth Core Components
    // ============================================================================
    
    /** Android Bluetooth adapter for BLE operations */
    private BluetoothAdapter bluetoothAdapter;
    
    /** BLE scanner for discovering nearby devices */
    private BluetoothLeScanner bluetoothLeScanner;
    
    /** Bluetooth manager for connection state queries */
    private BluetoothManager bluetoothManager;
    
    // ============================================================================
    // INSTANCE VARIABLES - Device Management
    // ============================================================================
    
    /** Map of bonded (paired) devices: deviceId -> BluetoothDevice */
    private Map<String, BluetoothDevice> bondedDevices = new ConcurrentHashMap<>();
    
    /** Set of bonded device IDs for quick lookup */
    private Set<String> bondedDeviceIds = Collections.synchronizedSet(new HashSet<>());
    
    /** Set of device IDs that were manually forgotten by user */
    private Set<String> forgottenDeviceIds = Collections.synchronizedSet(new HashSet<>());
    
    /** Set of devices pending unbonding operation */
    private Set<String> devicesPendingUnbond = Collections.synchronizedSet(new HashSet<>());
    
    /** Map of active GATT connections: deviceId -> BluetoothGatt */
    private Map<String, BluetoothGatt> connectedGatts = new ConcurrentHashMap<>();
    
    /** Map of device data cache: deviceId -> DeviceData */
    private Map<String, DeviceData> deviceDataMap = new ConcurrentHashMap<>();
    
    /** Devices waiting for bonding to complete before connecting */
    private Map<String, BluetoothDevice> devicesWaitingForBonding = new ConcurrentHashMap<>();
    
    /** Devices that have received a pairing request from Android */
    private Set<String> devicesWithPairingRequest = Collections.synchronizedSet(new HashSet<>());
    
    /** Cached GATT characteristics for quick access: key -> characteristic */
    private Map<String, BluetoothGattCharacteristic> deviceCharacteristics = new ConcurrentHashMap<>();
    
    /** Track consecutive health check failures: deviceId -> failureCount */
    private Map<String, Integer> healthCheckFailures = new ConcurrentHashMap<>();
    
    /** Devices currently undergoing manual disconnect to prevent auto-reconnect */
    private Set<String> manualDisconnectInProgress = Collections.synchronizedSet(new HashSet<>());
    
    /** Devices with pending write operations to prevent concurrent writes */
    private Set<String> pendingWrites = Collections.synchronizedSet(new HashSet<>());
    
    /** Devices currently in connection process to prevent duplicate attempts */
    private Set<String> connectingDevices = Collections.synchronizedSet(new HashSet<>());
    
    /** ✅ FIX: Track devices that have already emitted ServicesDiscovered event to prevent duplicates */
    private Set<String> hasEmittedServicesDiscovered = Collections.synchronizedSet(new HashSet<>());
    private Set<String> notificationsEnableInProgress = Collections.synchronizedSet(new HashSet<>());
    
    /**
     * SystemCommandRequest
     * 
     * Internal class representing a queued system command to be sent to a device.
     * Commands are queued to ensure sequential processing and prevent GATT write conflicts.
     */
    private static class SystemCommandRequest {
        /** Target device MAC address */
        String deviceId;
        
        /** Command identifier byte */
        byte commandId;
        
        /** Command payload data */
        byte[] payload;
        
        /**
         * Constructs a system command request.
         * 
         * @param deviceId Target device MAC address
         * @param commandId Command identifier
         * @param payload Command payload bytes
         */
        SystemCommandRequest(String deviceId, byte commandId, byte[] payload) {
            this.deviceId = deviceId;
            this.commandId = commandId;
            this.payload = payload;
        }
    }
    
    // ============================================================================
    // INSTANCE VARIABLES - Command and Transaction Management
    // ============================================================================
    
    /** Queue of system commands per device to ensure sequential execution */
    private Map<String, Queue<SystemCommandRequest>> systemCommandQueues = new ConcurrentHashMap<>();
    
    /** Flag indicating if a system command write is in progress for a device */
    private Map<String, Boolean> systemCommandWriteInProgress = new ConcurrentHashMap<>();
    
    /** Transaction manager for tracking BLE operation transactions */
    private TransactionManager transactionManager = new TransactionManager();
    
    /** Map of active write transaction IDs: deviceId -> transactionId */
    private Map<String, String> writeTransactionIds = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Promise Management (React Native Bridge)
    // ============================================================================
    
    /** Pending promises for characteristic read operations */
    private Map<String, Promise> pendingReadPromises = new ConcurrentHashMap<>();
    
    /** Pending promises for service discovery operations */
    private Map<String, Promise> pendingServiceDiscoveryPromises = new ConcurrentHashMap<>();
    
    /** Pending promises for RSSI read operations */
    private Map<String, Promise> pendingRSSIPromises = new ConcurrentHashMap<>();
    
    /** Pending promises for characteristic operations */
    private Map<String, Promise> pendingCharacteristicPromises = new ConcurrentHashMap<>();
    
    /** Pending promises for descriptor write operations */
    private Map<String, Promise> pendingDescriptorPromises = new ConcurrentHashMap<>();
    
    /** Pending promises for connection operations: key -> promise */
    private Map<String, Promise> pendingConnectionPromises = new ConcurrentHashMap<>();
    
    /** Characteristics currently being monitored for notifications */
    private Map<String, BluetoothGattCharacteristic> monitoredCharacteristics = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Threading and Scheduling
    // ============================================================================
    
    /** Thread-safe flag indicating if BLE scanning is active */
    private AtomicBoolean isScanning = new AtomicBoolean(false);
    
    /** Thread-safe flag indicating if auto-connect feature is enabled */
    private AtomicBoolean autoConnectEnabled = new AtomicBoolean(false);
    
    /** Main thread handler for UI and callback operations */
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    
    /** Executor service for scheduled tasks (4 threads for concurrent operations) */
    private ScheduledExecutorService executorService = Executors.newScheduledThreadPool(4);
    
    /** Minimum interval between scan stop and start to prevent Android limitations */
    private static final long MIN_SCAN_INTERVAL_MS = 2000;
    
    /** Timestamp of last scan stop for interval enforcement */
    private long lastScanStopTime = 0;
    
    /** Dedicated background thread for BLE operations */
    private HandlerThread bleHandlerThread;
    
    /** Handler for executing operations on BLE thread */
    private Handler bleHandler;
    
    // ============================================================================
    // INSTANCE VARIABLES - Retry and Monitoring Management
    // ============================================================================
    
    /** Track retry attempts for characteristic read operations */
    private Map<String, Integer> readRetryAttempts = new ConcurrentHashMap<>();
    
    /** Active health data API monitoring tasks: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> healthApiTasks = new ConcurrentHashMap<>();
    
    /** Active RSSI monitoring tasks: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> rssiMonitoringTasks = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Data Synchronization State
    // ============================================================================
    
    /** Current data sync state: deviceId -> state (e.g., "syncing", "complete") */
    private Map<String, String> dataSyncState = new ConcurrentHashMap<>();
    
    /** Data sync retry attempt counters: deviceId -> retryCount */
    private Map<String, Integer> dataSyncRetryCount = new ConcurrentHashMap<>();
    
    /** Active data sync timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> dataSyncTimers = new ConcurrentHashMap<>();
    
    /** Total record count reported by device: deviceId -> recordCount */
    private Map<String, Integer> deviceRecordCounts = new ConcurrentHashMap<>();
    
    /** Flag indicating data sync was requested: deviceId -> requested */
    private Map<String, Boolean> dataSyncRequested = new ConcurrentHashMap<>();
    
    /** FIX: Flag indicating sync command was actually sent (not just preparing): deviceId -> sent */
    private Map<String, Boolean> syncCommandSentFlags = new ConcurrentHashMap<>();
    
    /** Flag indicating set time response received: deviceId -> received */
    private Map<String, Boolean> setTimeResponseReceived = new ConcurrentHashMap<>();
    
    /** Active set time timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> setTimeTimeoutTimers = new ConcurrentHashMap<>();
    
    /** Set time command retry attempts: deviceId -> attemptCount */
    private Map<String, Integer> setTimeRetryAttempts = new ConcurrentHashMap<>();
    
    /** Maximum records per data file for chunking large sync operations */
    private static final int RECORDS_PER_FILE = 500;
    
    /** Maximum total records to prevent memory overflow */
    private static final int MAX_TOTAL_RECORDS = 25000;
    
    /** Total records expected in current sync session: deviceId -> totalCount */
    private Map<String, Integer> syncTotalRecords = new ConcurrentHashMap<>();
    
    /** Records received in current file chunk: deviceId -> receivedCount */
    private Map<String, Integer> syncRecordsReceived = new ConcurrentHashMap<>();
    
    /** Current file number in multi-file sync: deviceId -> fileNumber */
    private Map<String, Integer> syncCurrentFileNumber = new ConcurrentHashMap<>();
    
    /** Grand total records received across all files: deviceId -> grandTotal */
    private Map<String, Integer> syncGrandTotalReceived = new ConcurrentHashMap<>();
    
    /** Count of device status notifications received: deviceId -> count */
    private Map<String, Integer> deviceStatusNotificationCount = new ConcurrentHashMap<>();
    
    /** Flag indicating system commands have been sent: deviceId -> sent */
    private Map<String, Boolean> systemCommandsSent = new ConcurrentHashMap<>();
    
    /** Pending passkey update commands: deviceId -> passkey */
    private Map<String, String> pendingPasskeyUpdates = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Device State Tracking
    // ============================================================================
    
    /** Device RTC (Real-Time Clock) validity status: deviceId -> isValid */
    private Map<String, Boolean> deviceRTCValidity = new ConcurrentHashMap<>();
    
    /** Flag to check RTC before enabling notifications: deviceId -> pending */
    private Map<String, Boolean> rtcCheckPendingBeforeNotifications = new ConcurrentHashMap<>();
    
    /** Flag to enable notifications after set time completes: deviceId -> enable */
    private Map<String, Boolean> enableNotificationsAfterSetTime = new ConcurrentHashMap<>();
    
    /** Devices pending pairing verification: deviceId -> timestamp */
    private Map<String, Long> devicesPendingPairingVerification = new ConcurrentHashMap<>();
    
    /** Active pairing verification timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> pairingVerificationTimers = new ConcurrentHashMap<>();
    
    /** Connection type (true=manual, false=auto): deviceId -> isManual */
    private Map<String, Boolean> deviceConnectionType = new ConcurrentHashMap<>();
    
    /** Devices restored from system on app launch */
    private Set<String> systemRestoredDevices = ConcurrentHashMap.newKeySet();
    
    /** Flag indicating device was already bonded before connection: deviceId -> wasBonded */
    private Map<String, Boolean> deviceWasAlreadyBonded = new ConcurrentHashMap<>();
    
    /** Flag indicating Device Status read is complete and RTC validity is known: deviceId -> isComplete */
    private Map<String, Boolean> deviceStatusReadComplete = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - MTU (Maximum Transmission Unit) Management
    // ============================================================================
    
    /** Negotiated MTU size for each device: deviceId -> mtuSize */
    private Map<String, Integer> negotiatedMtuMap = new ConcurrentHashMap<>();
    
    /** Default BLE MTU size (20 bytes payload after 3-byte header) */
    private static final int DEFAULT_MTU = 23;
    
    /** Requested MTU size for optimized data transfer (509 bytes payload) */
    private static final int REQUESTED_MTU = 512;
    
    /** Timeout for MTU negotiation in milliseconds */
    private static final int MTU_NEGOTIATION_TIMEOUT_MS = 5000;
    
    /** Active MTU negotiation timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> mtuNegotiationTimeouts = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Notification Management (CCC = Client Characteristic Configuration)
    // ============================================================================
    
    /** CCC descriptor write retry attempts: deviceId -> attemptCount */
    private Map<String, Integer> cccRetryAttempts = new ConcurrentHashMap<>();
    
    /** Timestamp of first notification received: deviceId -> timestamp */
    private Map<String, Long> firstNotificationTimestamp = new ConcurrentHashMap<>();
    
    /** Active CCC retry timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> cccRetryTimers = new ConcurrentHashMap<>();
    
    /** Maximum attempts to enable notifications via CCC descriptor */
    private static final int MAX_CCC_RETRY_ATTEMPTS = 2;
    
    /** Delay between CCC retry attempts in milliseconds */
    private static final long CCC_RETRY_DELAY_MS = 2000;
    
    /** Track secure connection ready states for each device */
    private Map<String, SecureReadyState> secureReadyStates = new ConcurrentHashMap<>();
    
    /**
     * SecureReadyState
     * 
     * Represents the current state in the secure connection establishment process.
     * Devices must progress through these states before being fully ready for data exchange.
     */
    private enum SecureReadyState {
        /** Initial connection in progress */
        CONNECTING,
        
        /** MTU negotiation in progress */
        MTU_NEGOTIATING,
        
        /** Service discovery in progress */
        SERVICES_DISCOVERING,
        
        /** Enabling notifications on characteristics */
        NOTIFICATIONS_ENABLING,
        
        /** Verifying pairing/bonding status */
        PAIRING_VERIFYING,
        
        /** Fully connected and ready for secure operations */
        SECURE_READY
    }
    
    /** Flag indicating first read was successful: deviceId -> successful */
    private Map<String, Boolean> firstReadSuccessful = new ConcurrentHashMap<>();
    
    /** Flag indicating first notification was received: deviceId -> received */
    private Map<String, Boolean> firstNotificationReceived = new ConcurrentHashMap<>();
    
    /** Flag indicating disconnection occurred during pairing: deviceId -> disconnected */
    private Map<String, Boolean> disconnectionDuringPairing = new ConcurrentHashMap<>();
    
    /** Active service discovery timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> serviceDiscoveryTimeouts = new ConcurrentHashMap<>();
    
    /** Active connection timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> connectionTimeoutTimers = new ConcurrentHashMap<>();
    
    /** Number of notification enables pending for device: deviceId -> count */
    private Map<String, Integer> pendingNotificationEnables = new ConcurrentHashMap<>();
    
    /** Number of notification enables completed for device: deviceId -> count */
    private Map<String, Integer> completedNotificationEnables = new ConcurrentHashMap<>();
    
    /** Maximum attempts to enable a single notification */
    private static final int MAX_NOTIFICATION_ENABLE_ATTEMPTS = 3;
    
    /** Delay between notification enable retry attempts in milliseconds */
    private static final int NOTIFICATION_ENABLE_RETRY_DELAY_MS = 200;
    
    /** Notification enable attempt counters: key -> attemptCount */
    private Map<String, Integer> notificationEnableAttempts = new ConcurrentHashMap<>();
    
    /** Requested data acquisition intervals: deviceId -> intervalMs */
    private Map<String, Integer> requestedDataAcquisitionIntervals = new ConcurrentHashMap<>();
    
    /** Timestamp of last sync complete: deviceId -> timestamp */
    private Map<String, Long> lastSyncCompleteTimestamps = new ConcurrentHashMap<>();
    
    /** Grace period after sync complete before allowing new sync (ms) */
    private static final long SYNC_COMPLETE_GRACE_PERIOD_MS = 10000;
    
    /** Last notification sent timestamp for debouncing: key -> timestamp */
    private Map<String, Long> lastNotificationTime = new ConcurrentHashMap<>();
    
    /** Last notification type sent: key -> type */
    private Map<String, String> lastNotificationType = new ConcurrentHashMap<>();
    
    /** Minimum interval between duplicate notifications (ms) */
    private static final long NOTIFICATION_DEBOUNCE_MS = 5000;
    
    /** Cooldown period for connection notifications (ms) */
    private static final long CONNECTION_NOTIFICATION_COOLDOWN_MS = 10000;
    
    // ============================================================================
    // INSTANCE VARIABLES - Connection Queue Management
    // ============================================================================
    
    /** Queue for sequential connection processing */
    private Queue<String> connectionQueue = new LinkedList<>();
    
    /** Flag indicating connection queue is being processed */
    private AtomicBoolean isProcessingConnection = new AtomicBoolean(false);
    
    /** Connection cooldown timestamps: deviceId -> cooldownEndTime */
    private Map<String, Long> connectionCooldown = new ConcurrentHashMap<>();
    
    /** Minimum cooldown between connection attempts (ms) */
    private static final long CONNECTION_COOLDOWN_MS = 3000;
    
    /** Connection retry attempt counters: deviceId -> attemptCount */
    private Map<String, Integer> connectionRetryAttempts = new ConcurrentHashMap<>();
    
    /** Maximum connection retry attempts before giving up */
    private static final int MAX_CONNECTION_RETRY_ATTEMPTS = 1;
    
    /** Delay between connection retry attempts (ms) */
    private static final long CONNECTION_RETRY_DELAY_MS = 2000;
    
    /** Industry best practice: Exponential backoff delays for status 133 retries (ms) */
    private static final long[] STATUS_133_RETRY_DELAYS = {2000, 5000, 20000}; // 2s, 5s, 20s (industry standard)
    private static final int MAX_STATUS_133_RETRIES = STATUS_133_RETRY_DELAYS.length;
    
    /** Track status 133 retry attempts per device */
    private Map<String, Integer> status133RetryCounts = new ConcurrentHashMap<>();
    
    /** Store connection metadata for DeviceConnected event (connectionType, wasAlreadyBonded, etc.) */
    private Map<String, WritableMap> connectionMetadata = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Scan Management
    // ============================================================================
    
    /** Set of devices currently visible in scan results */
    private Set<String> activeScannedDevices = Collections.synchronizedSet(new HashSet<>());
    
    /** Timestamp when device was last seen in scan: deviceId -> timestamp */
    private Map<String, Long> deviceLastSeen = new ConcurrentHashMap<>();
    
    /** Time before considering a scanned device as stale (ms) */
    private static final long DEVICE_STALE_TIMEOUT_MS = 30000;
    
    // ============================================================================
    // INSTANCE VARIABLES - Descriptor Write Queue Management
    // ============================================================================
    
    /** Queue of descriptor write requests per device for sequential processing */
    private Map<String, Queue<DescriptorWriteRequest>> descriptorWriteQueues = new ConcurrentHashMap<>();
    
    /** Flag indicating descriptor write is in progress: deviceId -> inProgress */
    private Map<String, Boolean> isDescriptorWriteInProgress = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Persistence and Storage
    // ============================================================================
    
    /** SharedPreferences for persistent storage of device data */
    private SharedPreferences sharedPreferences;
    
    /** SharedPreferences file name */
    private static final String PREFS_NAME = "SmartTagPrefs";
    
    /** Key for storing bonded devices in SharedPreferences */
    private static final String BONDED_DEVICES_KEY = "bonded_devices";
    
    /** Key for storing device passkeys in SharedPreferences */
    private static final String DEVICE_PASSKEYS_KEY = "device_passkeys";
    
    /** Map of device-specific passkeys: deviceId -> passkey */
    private Map<String, String> devicePasskeys = new ConcurrentHashMap<>();
    
    // ============================================================================
    // INSTANCE VARIABLES - Services and Managers
    // ============================================================================
    
    /** Foreground service for background BLE operations */
    private BLEForegroundService bleService;
    
    /** Flag indicating if foreground service is running */
    private boolean isServiceRunning = false;
    
    /** Connection manager for handling BLE connection lifecycle */
    private BLEConnectionManager connectionManager;
    
    /** Companion device service for Android Companion Device Manager API */
    private BLECompanionDeviceService companionService;
    
    // ============================================================================
    // INSTANCE VARIABLES - Power Management
    // ============================================================================
    
    /** Current active power profile name */
    private String currentPowerProfile = "default";
    
    /** Available power profiles with configuration: profileName -> settings */
    private Map<String, Map<String, Object>> powerProfiles = new ConcurrentHashMap<>();
    
    /** Timer for periodic health checks */
    private Timer healthCheckTimer;
    
    /** Lock object for synchronized GATT operations to prevent concurrent access */
    private final Object gattLock = new Object();
    
    /**
     * Power Profile Default Configurations
     * 
     * Defines three power management profiles for balancing performance vs battery life:
     * 
     * 1. default: Balanced profile for normal operation
     *    - Fast health checks (30s)
     *    - Low latency scanning
     *    - Quick connection intervals (50ms)
     * 
     * 2. lowPower: Reduced power consumption while maintaining reliability
     *    - Slower health checks (60s)
     *    - Balanced scanning
     *    - Moderate connection intervals (100ms)
     * 
     * 3. ultraLowPower: Maximum battery savings for long-term monitoring
     *    - Slowest health checks (60s)
     *    - Low power scanning
     *    - Slow connection intervals (200ms)
     */
    private static final Map<String, Map<String, Object>> POWER_PROFILE_DEFAULTS = new HashMap<String, Map<String, Object>>() {{
        put("default", new HashMap<String, Object>() {{
            put("healthCheckMs", 30000);  // Health check every 30 seconds
            put("rssiCycleIntervalMs", 30000);  // RSSI monitoring every 30 seconds
            put("maxScanDurationMs", 15000);  // Maximum scan duration 15 seconds
            put("connectionIntervalMs", 50);  // Fast connection interval (50ms)
            put("scanMode", "LowLatency");  // Prioritize speed over battery
        }});
        put("lowPower", new HashMap<String, Object>() {{
            put("healthCheckMs", 60000);  // Health check every 60 seconds
            put("rssiCycleIntervalMs", 30000);  // RSSI monitoring every 30 seconds
            put("maxScanDurationMs", 8000);  // Maximum scan duration 8 seconds
            put("connectionIntervalMs", 100);  // Balanced connection interval (100ms)
            put("scanMode", "Balanced");  // Balance speed and battery
        }});
        put("ultraLowPower", new HashMap<String, Object>() {{
            put("healthCheckMs", 60000);  // Health check every 60 seconds
            put("rssiCycleIntervalMs", 60000);  // RSSI monitoring every 60 seconds
            put("maxScanDurationMs", 5000);  // Maximum scan duration 5 seconds
            put("connectionIntervalMs", 200);  // Slow connection interval (200ms)
            put("scanMode", "LowPower");  // Prioritize battery over speed
        }});
    }};
    
    // ============================================================================
    // POWER MANAGEMENT METHODS
    // ============================================================================
    
    /**
     * Updates connection parameters for all currently connected devices.
     * 
     * Applies the current power profile's connection interval settings to all
     * active GATT connections. Called when the power profile changes.
     */
    private void updateConnectionParametersForAllDevices() {
        for (Map.Entry<String, BluetoothGatt> entry : connectedGatts.entrySet()) {
            String deviceId = entry.getKey();
            BluetoothGatt gatt = entry.getValue();
            if (gatt != null) {
                requestConnectionParameters(gatt, deviceId);
            }
        }
    }
    
    /**
     * Requests connection parameters for a specific device based on power profile.
     * 
     * Maps the power profile's connection interval to Android's connection priority:
     * - ≤ 50ms: CONNECTION_PRIORITY_HIGH (7.5-11.25ms interval)
     * - ≤ 100ms: CONNECTION_PRIORITY_BALANCED (30-50ms interval)
     * - > 100ms: CONNECTION_PRIORITY_LOW_POWER (100-125ms interval)
     * 
     * @param gatt The GATT connection to configure
     * @param deviceId Device MAC address for logging
     */
    private void requestConnectionParameters(BluetoothGatt gatt, String deviceId) {
        try {
            Map<String, Object> profileSettings = powerProfiles.get(currentPowerProfile);
            if (profileSettings != null) {
                Integer connectionIntervalMs = (Integer) profileSettings.get("connectionIntervalMs");
                if (connectionIntervalMs != null) {
                    // Map connection interval to Android priority levels
                    int priority;
                    if (connectionIntervalMs <= 50) {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_HIGH;
                    } else if (connectionIntervalMs <= 100) {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_BALANCED;
                    } else {
                        priority = BluetoothGatt.CONNECTION_PRIORITY_LOW_POWER;
                    }
                    
                    // Request the connection priority change
                    boolean success = gatt.requestConnectionPriority(priority);
                    if (!success) {
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
    
    /**
     * Sets the active power profile.
     * 
     * React Native Method
     * 
     * Changes the power management profile which affects:
     * - Health check frequency
     * - RSSI monitoring intervals
     * - Scan duration and mode
     * - Connection intervals for all devices
     * 
     * @param profileName Name of profile: "default", "lowPower", or "ultraLowPower"
     * @param promise Resolves with old/new profile info on success
     */
    @ReactMethod
    public void setPowerProfile(String profileName, Promise promise) {
        try {
            if (!POWER_PROFILE_DEFAULTS.containsKey(profileName)) {
                promise.reject("INVALID_PROFILE", "Invalid power profile: " + profileName);
                return;
            }
            String oldProfile = currentPowerProfile;
            currentPowerProfile = profileName;
            updatePowerProfileSettings();
            restartHealthChecks();
            updateConnectionParametersForAllDevices();
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
    
    /**
     * Gets the current active power profile and its settings.
     * 
     * React Native Method
     * 
     * @param promise Resolves with profile name and settings map
     */
    @ReactMethod
    public void getCurrentPowerProfile(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putString("profile", currentPowerProfile);
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
    
    /**
     * Updates the power profile settings from defaults.
     * 
     * Copies the default settings for the current profile into the active
     * powerProfiles map. Called when switching profiles.
     */
    private void updatePowerProfileSettings() {
        Map<String, Object> profileSettings = POWER_PROFILE_DEFAULTS.get(currentPowerProfile);
        if (profileSettings != null) {
            powerProfiles.put(currentPowerProfile, new HashMap<>(profileSettings));
        }
    }
    
    /**
     * Restarts the health check timer with new profile settings.
     * 
     * Cancels the existing timer and creates a new one with the current
     * profile's health check interval.
     */
    private void restartHealthChecks() {
        if (healthCheckTimer != null) {
            healthCheckTimer.cancel();
            healthCheckTimer = null;
        }
        startHealthChecks();
    }
    
    /**
     * Starts periodic health checks for all connected devices.
     * 
     * Uses the current power profile's healthCheckMs interval to schedule
     * RSSI reads for connection monitoring.
     */
    private void startHealthChecks() {
        Map<String, Object> settings = powerProfiles.get(currentPowerProfile);
        if (settings != null) {
            int healthCheckMs = (Integer) settings.get("healthCheckMs");
            healthCheckTimer = new Timer();
            healthCheckTimer.scheduleAtFixedRate(new TimerTask() {
                @Override
                public void run() {
                    performHealthChecks();
                }
            }, healthCheckMs, healthCheckMs);
        } else {
            Log.w(TAG, "⚠️ No settings found for profile: " + currentPowerProfile);
        }
    }
    
    /**
     * Converts a string scan mode to Android's ScanSettings constant.
     * 
     * @param scanMode String representation: "lowlatency", "balanced", or "lowpower"
     * @return Android ScanSettings scan mode constant
     */
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
    
    /**
     * Performs health checks on all connected devices.
     * 
     * For each connected device:
     * 1. Attempts to read remote RSSI
     * 2. Tracks consecutive failures (max 3)
     * 3. Marks device as disconnected after 3 failures
     * 4. Sends disconnection events to React Native
     * 
     * This prevents zombie connections where Android thinks the device is connected
     * but communication has actually failed.
     */
    private void performHealthChecks() {
        int connectedCount = connectionManager.getConnectedDeviceCount();        if (connectedCount == 0) {            return;
        }
        Set<String> connectedDeviceIds = connectionManager.getConnectedDeviceIds();
        for (String deviceId : connectedDeviceIds) {
            BluetoothGatt gatt = connectionManager.getGatt(deviceId);
            try {
                boolean rssiSuccess = gatt.readRemoteRssi();
                if (rssiSuccess) {
                    healthCheckFailures.remove(deviceId);
                } else {
                    Log.w(TAG, "⚠️ Health check RSSI request failed for device: " + deviceId);
                    Integer failureCount = healthCheckFailures.getOrDefault(deviceId, 0) + 1;
                    healthCheckFailures.put(deviceId, failureCount);
                    Log.w(TAG, "⚠️ Health check failure count for " + deviceId + ": " + failureCount + "/3");
                    if (failureCount >= 3) {
                        Log.e(TAG, "💀 Device " + deviceId + " failed 3 consecutive health checks - marking as disconnected");
                        connectedGatts.remove(deviceId);
                        healthCheckFailures.remove(deviceId);
                        DeviceData deviceData = deviceDataMap.get(deviceId);
                        if (deviceData != null) {
                            deviceData.connectionState = "disconnected";
                            sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                            sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Health check error for device " + deviceId + ": " + e.getMessage());
                connectedGatts.remove(deviceId);
                DeviceData deviceData = deviceDataMap.get(deviceId);
                if (deviceData != null) {
                    deviceData.connectionState = "disconnected";
                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                    sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                }
            }
        }
    }
    
    /**
     * DeviceData
     * 
     * Internal class for caching device information and sensor data.
     * 
     * This class aggregates all data for a single BLE device including:
     * - Basic device info (ID, name, RSSI)
     * - Sensor readings (battery, temperature, steps)
     * - Connection state
     * - GATT services and characteristics
     * 
     * Used to maintain device state across connection cycles and provide
     * consistent data to React Native layer.
     */
    private static class DeviceData {
        /** Device MAC address (unique identifier) */
        public String deviceId;
        
        /** Human-readable device name */
        public String deviceName;
        
        /** Received Signal Strength Indicator in dBm */
        public int rssi;
        
        /** Battery level percentage (0-100), null if not available */
        public Integer batteryLevel;
        
        /** Temperature reading in Celsius */
        public float temperature;
        
        /** Step count from pedometer */
        public int steps;
        
        /** Timestamp of last data update (milliseconds since epoch) */
        public long timestamp;
        
        /** Flag indicating if this is a Smart Tag device */
        public boolean isSmartTag;
        
        /** Current connection state: "disconnected", "connecting", "connected" */
        public String connectionState = "disconnected";
        
        /** Map of discovered GATT services: serviceUUID -> BluetoothGattService */
        public Map<String, BluetoothGattService> services = new HashMap<>();
        
        /** Map of discovered GATT characteristics: charUUID -> BluetoothGattCharacteristic */
        public Map<String, BluetoothGattCharacteristic> characteristics = new HashMap<>();
        
        /**
         * Constructs a new DeviceData instance.
         * 
         * @param deviceId Device MAC address
         * @param deviceName Device name
         */
        public DeviceData(String deviceId, String deviceName) {
            this.deviceId = deviceId;
            this.deviceName = deviceName;
            this.timestamp = System.currentTimeMillis();
            this.batteryLevel = null;  // Initially unknown
        }
    }
    
    // ============================================================================
    // CONSTRUCTOR AND INITIALIZATION
    // ============================================================================
    
    /**
     * Constructor for SampleBridgeAndroid.
     * 
     * Initializes the BLE bridge module with:
     * 1. Bluetooth adapter and manager
     * 2. SharedPreferences for persistence
     * 3. BLE handler thread for background operations
     * 4. Connection manager and companion device service
     * 5. Auto-connection callbacks
     * 6. Saved device data (bonded devices, passkeys)
     * 
     * @param reactContext The React Native application context
     */
    public SampleBridgeAndroid(ReactApplicationContext reactContext) {
        super(reactContext);
        bluetoothManager = (BluetoothManager) reactContext.getSystemService(Context.BLUETOOTH_SERVICE);
        if (bluetoothManager == null) {
            Log.e(TAG, "❌ BluetoothManager is null - Bluetooth not supported on this device");
        } else {
            bluetoothAdapter = bluetoothManager.getAdapter();
            if (bluetoothAdapter == null) {
                Log.e(TAG, "❌ BluetoothAdapter is null - Bluetooth not supported on this device");
            } else {
                bluetoothLeScanner = bluetoothAdapter.getBluetoothLeScanner();            }
        }
        sharedPreferences = reactContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        initBLEHandlerThread();
        connectionManager = BLEConnectionManager.getInstance(reactContext);
        companionService = new BLECompanionDeviceService(reactContext);
        companionService.setAutoConnectionCallback(new BLECompanionDeviceService.AutoConnectionCallback() {
            @Override
            public void onAutoConnected(String deviceId, BluetoothGatt gatt) {
                Log.d(TAG, "📢 Received auto-connection notification: " + deviceId);
                handleAutoConnectedDevice(deviceId, gatt);
            }
            @Override
            public void onAutoDisconnected(String deviceId) {
                Log.d(TAG, "📢 Received auto-disconnection notification: " + deviceId);
                handleAutoDisconnectedDevice(deviceId);
            }
            @Override
            public void onServicesDiscovered(String deviceId, BluetoothGatt gatt) {
                Log.d(TAG, "📢 Received services discovered notification for auto-connected device: " + deviceId);
                // Mark as auto-connection type before handleServicesDiscovered
                deviceConnectionType.put(deviceId, true);
                // handleServicesDiscovered will call finalizeConnectionReady() which sets SECURE_READY
                handleServicesDiscovered(gatt);
            }
            @Override
            public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                Log.d(TAG, "📢 Received characteristic read notification for auto-connected device: " + deviceId + " - " + characteristic.getUuid());
                if (status == BluetoothGatt.GATT_SUCCESS) {
                    handleCharacteristicData(deviceId, characteristic);
                } else {
                    Log.e(TAG, "❌ Characteristic read failed for auto-connected device: " + deviceId + " - Status: " + status);
                }
            }
            @Override
            public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                Log.d(TAG, "📢 Received characteristic changed (notification) for auto-connected device: " + deviceId + " - " + characteristic.getUuid());
                // Process the live notification data (temperature, steps, battery, etc.)
                handleCharacteristicData(deviceId, characteristic);
            }
        });
        companionService.setConnectionManager(connectionManager);
        requestNotificationPermissionsIfNeeded();
        loadBondedDevices();
        loadForgottenDevices(); 
        loadDevicePasskeys(); 
        if (companionService != null && !bondedDeviceIds.isEmpty()) {
            Log.d(TAG, "🔄 Initializing companion service with " + bondedDeviceIds.size() + " bonded devices");
            for (String deviceId : bondedDeviceIds) {
                BluetoothDevice device = bondedDevices.get(deviceId);
                if (device != null) {
                    companionService.addCompanionDevice(deviceId, device);
                } else {
                    Log.w(TAG, "  ⚠️ Device not found in bondedDevices map: " + deviceId);
                }
            }        }
        if (!bondedDeviceIds.isEmpty()) {
            Log.d("SampleBridgeAndroid", "🚀 Auto-initializing BLE due to bonded devices: " + bondedDeviceIds.size());
            autoConnectEnabled.set(true);
            startForegroundService();
            scheduleBackgroundWork();
            startAutoConnectToBondedDevices();
        }
        IntentFilter pairingFilter = new IntentFilter();
        pairingFilter.addAction(BluetoothDevice.ACTION_PAIRING_REQUEST);
        pairingFilter.addAction(BluetoothDevice.ACTION_BOND_STATE_CHANGED);
        pairingFilter.setPriority(1000); 
        getReactApplicationContext().registerReceiver(pairingReceiver, pairingFilter);
        updatePowerProfileSettings();
        startHealthChecks();
        initializeStateRestoration();
    }
    
    /**
     * Initializes the BLE handler thread for background BLE operations.
     * 
     * Creates a dedicated background thread to handle BLE operations off the main thread,
     * preventing UI blocking during BLE communication.
     */
    private void initBLEHandlerThread() {
        if (bleHandlerThread == null) {
            bleHandlerThread = new HandlerThread("BLEHandlerThread");
            bleHandlerThread.start();
            bleHandler = new Handler(bleHandlerThread.getLooper());
        }
    }
    
    /**
     * Executes a runnable on the BLE background thread.
     * 
     * @param runnable The task to execute on the BLE thread
     */
    private void executeOnBLEThread(Runnable runnable) {
        if (bleHandler != null) {
            bleHandler.post(runnable);
        } else {
            // Fallback to executor service if handler not initialized
            executorService.execute(runnable);
        }
    }
    
    /**
     * Initializes state restoration for app lifecycle management.
     * 
     * Restores existing BLE connections and starts monitoring app state changes
     * to handle foreground/background transitions gracefully.
     */
    private void initializeStateRestoration() {
        restoreExistingConnections();
        startAppStateMonitoring();
    }
    
    /**
     * Queries Android system for currently connected BLE devices.
     * 
     * Synchronizes app state with Android's BLE stack to handle:
     * - Devices connected outside the app
     * - Connections surviving app restart
     * - System-level bond state
     * 
     * This prevents discrepancies between app state and system state.
     */
    private void querySystemConnectedDevices() {
        try {
            if (!checkBluetoothEnabled() || !checkPermissions()) {
                Log.w(TAG, "⚠️ Cannot query system devices: Bluetooth disabled or permissions missing");
                return;
            }
            BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (bluetoothManager == null) {
                Log.w(TAG, "⚠️ BluetoothManager is null - cannot query system devices");
                return;
            }
            List<BluetoothDevice> systemConnectedDevices = bluetoothManager.getConnectedDevices(BluetoothProfile.GATT);
            Log.d(TAG, "📋 System reports " + systemConnectedDevices.size() + " connected GATT device(s)");
            if (systemConnectedDevices.isEmpty()) {                return;
            }
            for (BluetoothDevice device : systemConnectedDevices) {
                String deviceId = device.getAddress();
                String deviceName = device.getName() != null ? device.getName() : "Unknown";                if (bondedDeviceIds.contains(deviceId)) {
                    Log.d(TAG, "✅ System-connected device is bonded: " + deviceId);
                    if (connectedGatts.containsKey(deviceId)) {
                        Log.d(TAG, "✅ Device already tracked in app: " + deviceId);
                        ensureDataExchangeActive(deviceId);
                        continue;
                    }
                    Log.d(TAG, "🔄 Restoring system-connected device in app: " + deviceId);
                    restoreSystemConnectedDevice(deviceId, device);
                } else {
                    if (device.getBondState() == BluetoothDevice.BOND_BONDED) {
                        Log.d(TAG, "✅ System-connected device is bonded at system level: " + deviceId);
                        if (!forgottenDeviceIds.contains(deviceId)) {
                            Log.d(TAG, "   ✅ Syncing system-bonded device to bondedDeviceIds: " + deviceId);
                            addToBondedDevices(deviceId, device);
                        }
                    } else {                    }
                }
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception querying system devices: " + e.getMessage());
        } catch (Exception e) {
            Log.e(TAG, "❌ Error querying system-connected devices: " + e.getMessage());
        }
    }
    
    /**
     * Synchronizes app's bonded device list with Android system's bonded devices.
     * 
     * Ensures that devices bonded at the Android system level are tracked in the app,
     * except for devices explicitly marked as "forgotten" by the user.
     * 
     * This handles cases where:
     * - User pairs device through Android Settings
     * - App is reinstalled but device remains paired
     * - System pairing survives app data clear
     */
    // ============================================================================
    // STATE RESTORATION & DEVICE SYNCHRONIZATION
    // ============================================================================
    
    /**
     * Synchronize Android system-bonded devices with app's internal bonded device list
     * 
     * Purpose:
     * - Ensures app's bond list matches Android system's bond list
     * - Prevents discrepancies between system-level and app-level bonding
     * - Called on app startup and when Bluetooth state changes
     * 
     * Behavior:
     * - Queries Android system for all bonded devices (bluetoothAdapter.getBondedDevices())
     * - Adds any system-bonded devices to app's bondedDeviceIds list
     * - Skips devices that are already in app's bondedDeviceIds or forgottenDeviceIds
     * - Persists changes to SharedPreferences
     * 
     * Android 12+ Requirements:
     * - Requires BLUETOOTH_CONNECT permission (throws SecurityException if missing)
     * 
     * @throws SecurityException if BLUETOOTH_CONNECT permission not granted (Android 12+)
     */
    private void syncSystemBondedDevices() {
        try {
            // Ensure Bluetooth adapter is available
            if (bluetoothAdapter == null) {
                Log.w(TAG, "⚠️ BluetoothAdapter is null - cannot sync system bonds");
                return;
            }
            
            // Query Android system for bonded devices
            Set<BluetoothDevice> systemBondedDevices = bluetoothAdapter.getBondedDevices();
            Log.d(TAG, "📋 System reports " + systemBondedDevices.size() + " bonded device(s)");
            
            if (systemBondedDevices.isEmpty()) {
                Log.d(TAG, "   ℹ️ No system-bonded devices found");
                return;
            }
            
            // Sync system bonds with app's bond list
            int syncedCount = 0;
            for (BluetoothDevice device : systemBondedDevices) {
                String deviceId = device.getAddress();
                
                // Only add devices not already tracked by the app
                if (!bondedDeviceIds.contains(deviceId) && !forgottenDeviceIds.contains(deviceId)) {
                    Log.d(TAG, "   ✅ Syncing system-bonded device to bondedDeviceIds: " + deviceId);
                    addToBondedDevices(deviceId, device);
                    syncedCount++;
                }
            }
            
            // Log sync results
            if (syncedCount > 0) {            } else {            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception syncing system bonds: " + e.getMessage());
            Log.e(TAG, "   💡 Ensure app has BLUETOOTH_CONNECT permission (Android 12+)");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error syncing system-bonded devices: " + e.getMessage());
        }
    }
    /**
     * Restore a system-connected BLE device (Android maintained connection in background)
     * 
     * Purpose:
     * - Android can maintain BLE connections even when app is terminated/in background
     * - This method reconnects the app to a device that Android kept connected
     * - Ensures app regains control of the GATT connection
     * 
     * Process:
     * 1. Check if device is already connecting (avoid duplicate attempts)
     * 2. Check if GATT connection already exists and is active
     * 3. If GATT exists and connected, ensure full setup (services, notifications)
     * 4. If no GATT, create new connection with autoConnect=false for immediate connection
     * 5. Set up GATT callback to handle connection state changes and service discovery
     * 
     * GATT Callback Handles:
     * - Connection state changes (connected/disconnected)
     * - Service discovery
     * - Characteristic reads and notifications
     * - MTU changes
     * 
     * @param deviceId Device MAC address (e.g., "AA:BB:CC:DD:EE:FF")
     * @param device BluetoothDevice object from Android system
     * @throws SecurityException if BLUETOOTH_CONNECT permission not granted (Android 12+)
     */
    private void restoreSystemConnectedDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔄 Restoring system-connected device: " + deviceId);
        try {
            // Prevent duplicate restore attempts
            if (connectingDevices.contains(deviceId)) {
                Log.d(TAG, "⏭️ Device already connecting, skipping restore: " + deviceId);
                return;
            }
            
            // Check if GATT connection already exists
            BluetoothGatt existingGatt = connectedGatts.get(deviceId);
            if (existingGatt != null) {
                // Verify connection state with Android system
                BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                
                if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                    Log.d(TAG, "✅ Device already connected, ensuring setup: " + deviceId);
                    ensureFullConnectionSetup(deviceId, existingGatt);
                    return;
                }
            }
            
            // Add to bonded devices map if not already present
            if (!bondedDevices.containsKey(deviceId)) {
                bondedDevices.put(deviceId, device);
            }
            
            // Mark as connecting to prevent duplicate attempts
            connectingDevices.add(deviceId);
            // Create GATT connection with autoConnect=false for immediate connection
            // (autoConnect=true would wait for device advertisement, but system already has connection)
            BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                false,  // autoConnect=false: connect immediately (system already connected)
                new BluetoothGattCallback() {
                    /**
                     * Called when connection state changes (connecting → connected → disconnected)
                     * - Handles successful connection: stores GATT, creates DeviceData, requests MTU
                     * - Handles disconnection: cleans up resources, emits event to React Native
                     */
                    @Override
                    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "🔗 System-restored device connection state: " + deviceId + " - Status: " + status + " - New State: " + newState);
                        
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ System-restored device connected successfully: " + deviceId);
                            
                            // Store GATT connection (thread-safe)
                            synchronized(gattLock) {
                                connectedGatts.put(deviceId, gatt);
                            }
                            
                            // Remove from connecting set (now connected)
                            connectingDevices.remove(deviceId);
                            
                            // Request optimal connection parameters (low latency for fast communication)
                            requestConnectionParameters(gatt, deviceId);
                            
                            // Create or retrieve device data structure
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData == null) {
                                String deviceName = gatt.getDevice().getName();
                                if (deviceName == null || deviceName.isEmpty()) {
                                    deviceName = "Unknown Device";
                                }
                                deviceData = new DeviceData(deviceId, deviceName);
                                deviceDataMap.put(deviceId, deviceData);
                            }
                            
                            // Request MTU increase for larger data packets (512 bytes)
                            gatt.requestMtu(512);
                            
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "❌ System-restored device disconnected: " + deviceId);
                            
                            // Clean up resources
                            connectedGatts.remove(deviceId);
                            connectingDevices.remove(deviceId);
                            
                            // Emit disconnection event to React Native
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.connectionState = "disconnected";
                                sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                            }
                        }
                    }
                    /**
                     * Called when BLE services are discovered on the device
                     * - Handles service enumeration and characteristic discovery
                     * - Enables notifications for relevant characteristics
                     * - Confirms connection to React Native layer
                     */
                    @Override
                    public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "✅ Services discovered for system-restored device: " + deviceId);
                            
                            // Process services and enable notifications
                            handleServicesDiscovered(gatt);
                            
                            // Track as system-restored for special handling
                            systemRestoredDevices.add(deviceId);
                            
                            // Confirm connection to React Native layer
                            confirmConnection(deviceId, gatt);
                        } else {
                            Log.e(TAG, "❌ Service discovery failed for system-restored device: " + deviceId + " - Status: " + status);
                        }
                    }
                    
                    /**
                     * Called when a characteristic is read (explicit read request)
                     * - Parses and processes the characteristic data
                     * - Emits events to React Native layer
                     */
                    @Override
                    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            handleCharacteristicData(deviceId, characteristic);
                        }
                    }
                    
                    /**
                     * Called when a characteristic value changes (notification received)
                     * - Processes real-time data updates from device
                     * - Handles device status, data transfer, and system command responses
                     */
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                        String deviceId = gatt.getDevice().getAddress();
                        handleCharacteristicData(deviceId, characteristic);
                    }
                    
                    /**
                     * Called when descriptor write completes (notification enable/disable)
                     * - Tracks notification enable progress
                     * - Queues next descriptor write if multiple characteristics need notifications
                     */
                    @Override
                    public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String descriptorUuid = descriptor.getUuid().toString();
                        String characteristicUuid = descriptor.getCharacteristic().getUuid().toString();
                        onDescriptorWriteComplete(deviceId, descriptor, status);
                    }
                    
                    /**
                     * Called when MTU (Maximum Transmission Unit) size changes
                     * - Larger MTU allows bigger data packets (less fragmentation, better throughput)
                     * - Triggers service discovery after MTU change (success or failure)
                     */
                    @Override
                    public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "✅ MTU changed for system-restored device: " + deviceId + " - MTU: " + mtu);
                            gatt.discoverServices();
                        } else {
                            Log.e(TAG, "❌ MTU change failed for system-restored device: " + deviceId + " - Status: " + status);
                            // Proceed with service discovery anyway
                            gatt.discoverServices();
                        }
                    }
                    
                    /**
                     * Called when RSSI (signal strength) is read from the device
                     * - Updates device data with new RSSI value
                     * - Emits RSSIUpdate event to React Native
                     */
                    @Override
                    public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "📶 [SYSTEM-RESTORE] RSSI read for " + deviceId + ": " + rssi);
                            
                            // Resolve any pending promise
                            Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                            if (pendingPromise != null) {
                                pendingPromise.resolve(rssi);
                            }
                            
                            // Update device data
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.rssi = rssi;
                                deviceData.timestamp = System.currentTimeMillis();
                                
                                // Send DeviceDataUpdated event
                                WritableMap deviceDataUpdateEvent = Arguments.createMap();
                                deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
                                deviceDataUpdateEvent.putString("type", "rssi_update");
                                deviceDataUpdateEvent.putInt("rssi", rssi);
                                if (deviceData.batteryLevel != null) {
                                    deviceDataUpdateEvent.putInt("batteryLevel", deviceData.batteryLevel);
                                } else {
                                    deviceDataUpdateEvent.putNull("batteryLevel");
                                }
                                // Send null for uninitialized temperature to avoid 0.0°C display
                                if (deviceData.temperature > 0) {
                                    deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                } else {
                                    deviceDataUpdateEvent.putNull("temperature");
                                }
                                deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                            }
                            
                            // Send RSSIUpdate event
                            WritableMap rssiMap = Arguments.createMap();
                            rssiMap.putString("deviceId", deviceId);
                            rssiMap.putInt("rssi", rssi);
                            rssiMap.putDouble("timestamp", System.currentTimeMillis());
                            sendEvent("RSSIUpdate", rssiMap);
                        } else {
                            Log.e(TAG, "❌ [SYSTEM-RESTORE] RSSI read failed for " + deviceId + " with status: " + status);
                        }
                    }
                }
            );
            if (gatt != null) {
                Log.d(TAG, "✅ GATT connection initiated for system-restored device: " + deviceId);
            } else {
                Log.e(TAG, "❌ Failed to create GATT connection for system-restored device: " + deviceId);
                connectingDevices.remove(deviceId);
            }
        } catch (SecurityException e) {
            Log.e(TAG, "❌ Security exception restoring system device: " + e.getMessage());
            connectingDevices.remove(deviceId);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error restoring system-connected device: " + e.getMessage());
            connectingDevices.remove(deviceId);
        }
    }
    /**
     * Restore existing connections to bonded devices (app restart scenario)
     * 
     * Purpose:
     * - Called when app returns to foreground or restarts
     * - Checks if bonded devices are still connected at system level
     * - Restores GATT connections and resumes data exchange
     * - Initiates reconnection for disconnected bonded devices
     * 
     * Process:
     * 1. Skip if no bonded devices exist
     * 2. For each bonded device:
     *    - If GATT connection exists: ensure data exchange is active
     *    - If disconnected: attempt reconnection (respects companion service range check)
     * 3. Log connection restoration summary
     * 
     * Companion Service Integration:
     * - If available, checks if device is in BLE range before reconnecting
     * - Prevents wasted reconnection attempts to out-of-range devices
     * 
     * @see #ensureDataExchangeActive(String) Resumes monitoring for active connections
     * @see #restoreConnectionToDevice(String, BluetoothDevice) Reconnects disconnected devices
     */
    private void restoreExistingConnections() {
        // Skip if no bonded devices to restore
        if (bondedDeviceIds.isEmpty()) {            return;
        }
        
        // Track connection restoration progress
        boolean hasActiveConnections = false;
        boolean hasDisconnectedBondedDevices = false;
        int reconnectAttemptsCount = 0;
        
        // Process each bonded device
        for (String deviceId : bondedDeviceIds) {
            // Check if device has active GATT connection
            if (connectedGatts.containsKey(deviceId)) {
                hasActiveConnections = true;
                Log.d(TAG, "  ✅ Found active connection to restore: " + deviceId);
                
                // Resume data exchange (RSSI monitoring, health data API calls)
                ensureDataExchangeActive(deviceId);
                
            } else {
                // Device is bonded but not connected
                hasDisconnectedBondedDevices = true;
                Log.d(TAG, "  🔄 Found disconnected bonded device - attempting reconnection: " + deviceId);
                
                // Check if device is in BLE range (via companion service)
                boolean shouldReconnect = true;
                if (companionService != null) {
                    boolean inRange = companionService.isDeviceInRange(deviceId);
                    if (!inRange) {
                        Log.d(TAG, "  ⏸️ Device not in range yet, will reconnect when it comes in range: " + deviceId);
                        shouldReconnect = false;
                    }
                } else {
                    Log.d(TAG, "  ⚠️ Companion service not available - attempting reconnection anyway");
                }
                
                // Attempt reconnection if device is in range (or range check unavailable)
                if (shouldReconnect) {
                    BluetoothDevice device = bondedDevices.get(deviceId);
                    if (device != null) {
                        Log.d(TAG, "  🚀 Attempting to restore connection to: " + deviceId);
                        reconnectAttemptsCount++;
                        restoreConnectionToDevice(deviceId, device);
                    } else {
                        Log.w(TAG, "  ⚠️ Device not found in bonded devices map: " + deviceId);
                    }
                }
            }
        }
        
        // Log connection restoration summary
        if (!hasActiveConnections && !hasDisconnectedBondedDevices) {        } else {
            Log.d(TAG, "  • Total bonded devices: " + bondedDeviceIds.size());
            Log.d(TAG, "  • Active connections: " + (hasActiveConnections ? "Yes" : "No"));
            Log.d(TAG, "  • Reconnection attempts: " + reconnectAttemptsCount);        }
    }
    /**
     * Restore connection to a specific bonded device
     * 
     * Purpose:
     * - Creates new GATT connection to a previously bonded device
     * - Used during app restart or when device comes back in range
     * - Uses autoConnect=true for opportunistic background reconnection
     * 
     * AutoConnect Behavior (autoConnect=true):
     * - Android will automatically connect when device advertises
     * - Works in background even when app is not active
     * - More battery efficient than continuous scanning
     * - May take longer to connect (waits for advertisement)
     * 
     * Process:
     * 1. Check if already connected (resume data exchange)
     * 2. Check if already connecting (prevent duplicates)
     * 3. Create GATT connection with autoConnect=true
     * 4. Set up callbacks for connection lifecycle
     * 5. Start immediate data reading after 500ms delay
     * 
     * @param deviceId Device MAC address (e.g., "AA:BB:CC:DD:EE:FF")
     * @param device BluetoothDevice object
     * @throws SecurityException if BLUETOOTH_CONNECT permission missing (Android 12+)
     */
    private void restoreConnectionToDevice(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔄 Restoring connection to device: " + deviceId);
        try {
            // Check if device is already connected
            if (connectedGatts.containsKey(deviceId)) {
                Log.d(TAG, "✅ Device already connected: " + deviceId);
                ensureDataExchangeActive(deviceId);
                return;
            }
            
            // Prevent duplicate connection attempts
            if (connectingDevices.contains(deviceId)) {                return;
            }
            
            // Mark as connecting
            connectingDevices.add(deviceId);
            BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                true, 
                new BluetoothGattCallback() {
                    @Override
                    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "🔄 State restoration connection change: " + deviceId + " - Status: " + status + " - New State: " + newState);
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ State restoration successful: " + deviceId);
                            connectingDevices.remove(deviceId);
                            synchronized(gattLock) {
                                connectedGatts.put(deviceId, gatt);
                            }
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData == null) {
                                String deviceName = gatt.getDevice().getName();
                                if (deviceName == null || deviceName.isEmpty()) {
                                    deviceName = getDeviceName(deviceId); 
                                    if (deviceName == null || deviceName.isEmpty()) {
                                        deviceName = "Unknown Device";
                                    }
                                }
                                deviceData = new DeviceData(deviceId, deviceName);
                                deviceDataMap.put(deviceId, deviceData);
                                Log.d(TAG, "✅ Created DeviceData for restored device: " + deviceId + " (" + deviceName + ")");
                            }
                            // Don't set connectionState to "connected" yet - let checkAndEmitDeviceConnected handle it
                            // This ensures React Native state is consistent with SECURE_READY state
                            deviceData.timestamp = System.currentTimeMillis();
                            gatt.discoverServices();
                            Log.d(TAG, "📊 State restoration: Starting immediate data reading for: " + deviceId);
                            mainHandler.postDelayed(() -> {
                                if (connectedGatts.containsKey(deviceId)) {                                    requestDeviceData(deviceId);
                                    startRSSIMonitoringForDevice(deviceId);
                                    startHealthDataApiMonitoringForDevice(deviceId);
                                }
                            }, 500); 
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "❌ State restoration failed: " + deviceId);
                            connectingDevices.remove(deviceId);
                            connectedGatts.remove(deviceId);
                            cleanupDeviceResources(deviceId);
                        }
                    }
                    @Override
                    public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "✅ State restoration services discovered: " + deviceId);
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            // handleServicesDiscovered will call finalizeConnectionReady() which sets SECURE_READY
                            handleServicesDiscovered(gatt);
                        }
                    }
                    @Override
                    public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        Log.d(TAG, "📖 State restoration characteristic read: " + characteristicUuid + " on device " + deviceId + " - Status: " + status);
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            handleCharacteristicData(deviceId, characteristic);
                        }
                    }
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        Log.d(TAG, "📡 State restoration characteristic changed: " + characteristicUuid + " on device " + deviceId);
                        handleCharacteristicData(deviceId, characteristic);
                    }
                    
                    @Override
                    public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "📶 [STATE-RESTORE] RSSI read for " + deviceId + ": " + rssi);
                            
                            // Resolve any pending promise
                            Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                            if (pendingPromise != null) {
                                pendingPromise.resolve(rssi);
                            }
                            
                            // Update device data
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.rssi = rssi;
                                deviceData.timestamp = System.currentTimeMillis();
                                
                                // Send DeviceDataUpdated event
                                WritableMap deviceDataUpdateEvent = Arguments.createMap();
                                deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
                                deviceDataUpdateEvent.putString("type", "rssi_update");
                                deviceDataUpdateEvent.putInt("rssi", rssi);
                                if (deviceData.batteryLevel != null) {
                                    deviceDataUpdateEvent.putInt("batteryLevel", deviceData.batteryLevel);
                                } else {
                                    deviceDataUpdateEvent.putNull("batteryLevel");
                                }
                                // Send null for uninitialized temperature to avoid 0.0°C display
                                if (deviceData.temperature > 0) {
                                    deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                } else {
                                    deviceDataUpdateEvent.putNull("temperature");
                                }
                                deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                            }
                            
                            // Send RSSIUpdate event
                            WritableMap rssiMap = Arguments.createMap();
                            rssiMap.putString("deviceId", deviceId);
                            rssiMap.putInt("rssi", rssi);
                            rssiMap.putDouble("timestamp", System.currentTimeMillis());
                            sendEvent("RSSIUpdate", rssiMap);
                        } else {
                            Log.e(TAG, "❌ [STATE-RESTORE] RSSI read failed for " + deviceId + " with status: " + status);
                        }
                    }
                    
                    @Override
                    public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String charUuid = descriptor.getCharacteristic().getUuid().toString();
                        Log.d(TAG, "📝 [STATE-RESTORE] Descriptor write for " + charUuid + " on " + deviceId + " - Status: " + status);
                        onDescriptorWriteComplete(deviceId, descriptor, status);
                    }
                }
            );
            Log.d(TAG, "🚀 State restoration connection attempt initiated for: " + deviceId);
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to restore connection to device: " + deviceId, e);
            connectingDevices.remove(deviceId);
        }
    }
    private void ensureDataExchangeActive(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ Cannot ensure data exchange - GATT not found for: " + deviceId);
            return;
        }
        requestDeviceData(deviceId);
        startRSSIMonitoringForDevice(deviceId);
        startHealthDataApiMonitoringForDevice(deviceId);
    }
    private void ensureFullConnectionSetup(String deviceId, BluetoothGatt gatt) {
        if (gatt == null) {
            Log.w(TAG, "⚠️ [RECONNECT] Cannot ensure setup - GATT is null");
            return;
        }
        pendingNotificationEnables.remove(deviceId);
        completedNotificationEnables.remove(deviceId);
        List<BluetoothGattService> services = gatt.getServices();
        if (services != null && services.size() > 0) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (connectedGatts.containsKey(deviceId)) {
                        handleServicesDiscovered(gatt);
                    }
                }
            }, 100); 
        } else {
            gatt.requestMtu(512);
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (!connectedGatts.containsKey(deviceId)) {
                        return; 
                    }
                    List<BluetoothGattService> services = gatt.getServices();
                    if (services != null && services.size() > 0) {
                        Integer pending = pendingNotificationEnables.get(deviceId);
                        if (pending == null) {
                            handleServicesDiscovered(gatt);
                        }
                    } else {
                        Log.w(TAG, "⚠️ [RECONNECT FALLBACK] Still no services after delay - may need to disconnect/reconnect");
                    }
                }
            }, 2000); 
        }
    }
    // ============================================================================
    // APP STATE MONITORING & LIFECYCLE MANAGEMENT
    // ============================================================================
    
    /**
     * Initialize app state monitoring (placeholder for future implementation)
     * - Currently empty, monitoring triggered by React Native AppState listener
     * - Could be enhanced with Android lifecycle observers
     */
    private void startAppStateMonitoring() {    }
    
    /**
     * Handle app state changes (active, background, inactive)
     * Called from React Native AppState listener via bridge
     * 
     * Active State (Foreground):
     * - Starts or verifies foreground service is running
     * - Re-initializes companion device monitoring
     * - Restores existing connections
     * - Starts scanning if auto-connect is enabled
     * 
     * Background State:
     * - Ensures foreground service continues running
     * - Maintains health checks and RSSI monitoring
     * - Keeps connections alive
     * 
     * Purpose:
     * - Seamless connection management across app state transitions
     * - Prevents connection drops when app backgrounds
     * - Resumes operations when app returns to foreground
     * 
     * Android Requirements:
     * - Foreground service required for background BLE operations (Android 8+)
     * - Notification required for foreground service visibility
     * 
     * @param newState "active" (foreground), "background", or "inactive"
     * @param promise React Native promise to resolve/reject
     */
    @ReactMethod
    public void onAppStateChanged(String newState, Promise promise) {
        Log.d(TAG, "📱 App state changed to: " + newState);
        try {
            // Handle foreground state (app becomes active)
            if ("active".equals(newState)) {
                Log.d(TAG, "📊 Current state - Bonded devices: " + bondedDeviceIds.size() + ", Connected: " + connectedGatts.size());
                
                // Ensure foreground service is running (required for background BLE)
                if (!isServiceRunning || bleService == null) {
                    startForegroundService(); 
                } else {                }
                
                // Re-initialize companion device monitoring
                if (companionService != null) {
                    Log.d(TAG, "📋 Re-initializing monitoring for " + bondedDeviceIds.size() + " bonded devices");
                    
                    // Add all bonded devices to companion service for range monitoring
                    for (String deviceId : bondedDeviceIds) {
                        BluetoothDevice device = bondedDevices.get(deviceId);
                        if (device != null) {
                            companionService.addCompanionDevice(deviceId, device);
                        } else {
                            Log.w(TAG, "  ⚠️ Device not found in bondedDevices map: " + deviceId);
                        }
                    }
                } else {
                    Log.w(TAG, "⚠️ Companion service is null - cannot re-initialize monitoring");
                }
                
                // Restore connections and start scanning (delayed to allow service initialization)
                mainHandler.postDelayed(() -> {
                    // Restore existing GATT connections
                    restoreExistingConnections();
                    
                    // Start scanning if auto-connect is enabled
                    if (autoConnectEnabled.get()) {
                        startScanningForBondedDevices();
                    } else {                    }
                }, 500);  // 500ms delay for service initialization
                
            } else if ("background".equals(newState)) {
                // Handle background state (app backgrounded)
                ensureBackgroundOperationsContinue();
            }
            
            promise.resolve("App state change handled");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error handling app state change: " + e.getMessage(), e);
            promise.reject("APP_STATE_ERROR", e.getMessage());
        }
    }
    /**
     * Ensure critical background operations continue when app is backgrounded
     * 
     * Purpose:
     * - Maintains BLE operations when app is not in foreground
     * - Prevents Android from killing BLE connections
     * - Ensures continuous health monitoring and data collection
     * 
     * Operations Maintained:
     * 1. Foreground service (required for background BLE on Android 8+)
     * 2. Health checks (periodic connection validation)
     * 3. RSSI monitoring (signal strength tracking for all connected devices)
     * 
     * Android Background Restrictions:
     * - Android 8+ requires foreground service for background BLE
     * - Foreground service requires persistent notification
     * - Without foreground service, connections may be killed after ~1 minute
     * 
     * @see #startForegroundService() Creates foreground service with notification
     * @see #startHealthChecks() Periodic connection health validation
     * @see #startRSSIMonitoringForDevice(String) Signal strength monitoring
     */
    private void ensureBackgroundOperationsContinue() {
        // Ensure foreground service is running (required for background BLE)
        if (!isServiceRunning) {
            startForegroundService();
        }
        
        // Restart health checks if stopped
        if (healthCheckTimer == null) {
            startHealthChecks();
        }
        
        // Ensure RSSI monitoring is active for all connected devices
        for (String deviceId : connectedGatts.keySet()) {
            startRSSIMonitoringForDevice(deviceId);
        }
    }
    
    /**
     * Start RSSI (signal strength) monitoring for a specific device
     * 
     * Purpose:
     * - Continuously tracks Bluetooth signal strength (-90 to 0 dBm)
     * - Helps detect when device is moving out of range
     * - Provides connection quality metrics
     * - Triggers events to React Native layer for UI updates
     * 
     * Monitoring Interval:
     * - Reads RSSI every 30 seconds (configurable via power profile)
     * - Balanced between responsiveness and battery efficiency
     * 
     * Error Handling:
     * - Detects DeadObjectException (device disconnected unexpectedly)
     * - Cleans up stale GATT connections
     * - Automatically removes device from connected list
     * 
     * @param deviceId Device MAC address to monitor
     */
    private void startRSSIMonitoringForDevice(String deviceId) {
        // =========================================================================
        // DISABLED: RSSI monitoring consolidated into performHealthChecks() only
        // =========================================================================
        // Previously, this function ran a separate 30-second RSSI polling task.
        // This caused DUPLICATE RSSI reads because performHealthChecks() also
        // calls gatt.readRemoteRssi() every 30 seconds.
        // 
        // Now RSSI monitoring is handled ONLY by performHealthChecks() to:
        // 1. Eliminate duplicate RSSI reads that were causing log spam
        // 2. Reduce BLE stack load and battery consumption
        // 3. Simplify connection health monitoring to a single source
        //
        // RSSI updates are sent to JS via the RSSIUpdate event from onReadRemoteRssi()
        // =========================================================================
        Log.d(TAG, "📶 [RSSI] Monitoring handled by health checks for: " + deviceId);
    }
    /**
     * Start periodic health data API monitoring for a device
     * 
     * Purpose:
     * - Sends device health data to backend API at regular intervals
     * - Enables cloud-based health tracking and analytics
     * - Provides data for remote monitoring and alerts
     * 
     * Monitoring Interval:
     * - Sends health data every 60 seconds
     * - Configurable based on power profile (future enhancement)
     * 
     * Data Sent:
     * - Device ID, name, connection state
     * - Battery level (if available)
     * - Steps count (if available)
     * - Temperature (if available)
     * - Last update timestamp
     * 
     * Event Flow:
     * 1. Retrieve device data from deviceDataMap
     * 2. Create device info map (formatted data)
     * 3. Emit "HealthDataApiRequest" event to React Native
     * 4. React Native layer makes actual API call
     * 
     * @param deviceId Device MAC address to monitor
     * @see #sendHealthDataApiEvent(String, WritableMap) Emits event to React Native
     * @see #createDeviceInfoMap(DeviceData) Formats device data for transmission
     */
    private void startHealthDataApiMonitoringForDevice(String deviceId) {
        // Cancel existing monitoring task if present (prevent duplicates)
        ScheduledFuture<?> existingTask = healthApiTasks.get(deviceId);
        if (existingTask != null && !existingTask.isCancelled()) {
            existingTask.cancel(false);
            healthApiTasks.remove(deviceId);
        }
        
        // Schedule periodic health data API calls (every 60 seconds)
        ScheduledFuture<?> healthTask = executorService.scheduleAtFixedRate(() -> {
            try {
                // Only send data if device is still connected
                if (connectedGatts.containsKey(deviceId)) {
                    DeviceData deviceData = deviceDataMap.get(deviceId);
                    if (deviceData != null) {
                        Log.d(TAG, "📊 Sending health data API call for auto-connected device: " + deviceId);
                        // Emit event to React Native layer (which makes actual API call)
                        sendHealthDataApiEvent(deviceId, createDeviceInfoMap(deviceData));
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error in health data API monitoring for device " + deviceId + ": " + e.getMessage());
            }
        }, 0, 60, TimeUnit.SECONDS);  // Initial delay: 0s, Repeat: every 60s
        
        // Store task reference for later cancellation
        healthApiTasks.put(deviceId, healthTask);
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
            if (companionService != null) {
                companionService.addCompanionDevice(deviceId, device);
            }
        }
    }
    private void handleAutoConnectedDevice(String deviceId, BluetoothGatt gatt) {
        Log.d(TAG, "🔗 Handling auto-connected device: " + deviceId);
        synchronized(gattLock) {
            if (connectedGatts.containsKey(deviceId)) {
                Log.w(TAG, "⚠️ Device already in connected map, skipping duplicate handleAutoConnectedDevice: " + deviceId);
                return;
            }
        }
        try {
            synchronized(gattLock) {
                connectedGatts.put(deviceId, gatt);
                Log.d(TAG, "✅ Added device to SampleBridgeAndroid connected map: " + deviceId);
            }
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData == null) {
                String deviceName = gatt.getDevice().getName();
                if (deviceName == null || deviceName.isEmpty()) {
                    deviceName = getDeviceName(deviceId);
                    if (deviceName == null || deviceName.isEmpty()) {
                        deviceName = "Unknown Device";
                    }
                }
                deviceData = new DeviceData(deviceId, deviceName);
                deviceDataMap.put(deviceId, deviceData);
                Log.d(TAG, "✅ Created DeviceData for auto-connected device: " + deviceId + " (" + deviceName + ")");
            }
            // Don't set connectionState to "connected" yet - let checkAndEmitDeviceConnected handle it
            // This ensures React Native state is consistent with native state
            deviceData.timestamp = System.currentTimeMillis();
            deviceConnectionType.put(deviceId, true); // Mark as auto-connection
            
            List<BluetoothGattService> services = gatt.getServices();
            if (services != null && !services.isEmpty()) {
                Log.d(TAG, "📊 Services already discovered for auto-connected device, processing now: " + deviceId);
                // handleServicesDiscovered will call finalizeConnectionReady() which sets SECURE_READY
                handleServicesDiscovered(gatt);
            } else {
                Log.d(TAG, "⏳ Services not yet discovered for auto-connected device, will process when ready: " + deviceId);
                // SECURE_READY will be set when services are discovered via onServicesDiscovered callback
            }
            boolean rssiReadInitiated = gatt.readRemoteRssi();
            if (!rssiReadInitiated) {
                Log.w(TAG, "⚠️ Failed to initiate RSSI read for auto-connected device: " + deviceId);
            }
            startRSSIMonitoringForDevice(deviceId);
            manualDisconnectInProgress.remove(deviceId);
            activeScannedDevices.add(deviceId);
            deviceLastSeen.put(deviceId, System.currentTimeMillis());
        } catch (Exception e) {
            Log.e(TAG, "❌ Error handling auto-connected device: " + deviceId, e);
        }
    }
    private void handleAutoDisconnectedDevice(String deviceId) {
        Log.d(TAG, "🔌 Handling auto-disconnected device: " + deviceId);
        try {
            synchronized(gattLock) {
                BluetoothGatt gatt = connectedGatts.remove(deviceId);
                if (gatt != null) {
                    gatt.close();
                }
            }
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData != null) {
                deviceData.connectionState = "disconnected";
                deviceData.timestamp = System.currentTimeMillis();
                WritableMap deviceInfo = createDeviceInfoMap(deviceData);
                sendEvent("DeviceDisconnected", deviceInfo);
                Log.d(TAG, "📢 Sent DeviceDisconnected event for auto-disconnected device: " + deviceId);
            }
            cleanupDeviceResources(deviceId);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error handling auto-disconnected device: " + deviceId, e);
        }
    }
    private void requestNotificationPermissionsIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            NotificationManager manager = (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                boolean areNotificationsEnabled = manager.areNotificationsEnabled();
                if (!areNotificationsEnabled) {
                    Log.w(TAG, "⚠️ Notifications are disabled - auto-connection notifications may not appear");
                } else {                }
            }
        } else {
        }
    }
    private void sendLocalNotification(String title, String body) {
        try {
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
                .setColor(0xFF4CAF50) 
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
                .build();
            NotificationManager manager = (NotificationManager) getReactApplicationContext().getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                int notificationId = (int) System.currentTimeMillis();
                manager.notify(notificationId, notification);            } else {
                Log.e(TAG, "❌ NotificationManager is null");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to send local notification", e);
        }
    }
    private void sendLocalNotificationIfBackground(String title, String body) {
        String notificationKey = title + "|" + body;
        long currentTime = System.currentTimeMillis();
        Long lastTime = lastNotificationTime.get(notificationKey);
        if (lastTime != null && (currentTime - lastTime) < NOTIFICATION_DEBOUNCE_MS) {
            return; 
        }
        if (title.contains("Connected") || title.contains("Restored") || title.contains("Auto connected")) {
            String deviceId = extractDeviceIdFromNotification(body);
            if (deviceId != null) {
                Long lastConnectionTime = lastNotificationTime.get("connection_" + deviceId);
                if (lastConnectionTime != null && (currentTime - lastConnectionTime) < CONNECTION_NOTIFICATION_COOLDOWN_MS) {
                    Log.d(TAG, "🔔 Skipping connection notification (cooldown): " + title + " - " + body);
                    return; 
                }
                lastNotificationTime.put("connection_" + deviceId, currentTime);
            }
        }
        lastNotificationTime.put(notificationKey, currentTime);
        lastNotificationType.put(notificationKey, title);
        sendLocalNotification(title, body);
    }
    private String extractDeviceIdFromNotification(String body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        java.util.regex.Pattern pattern = java.util.regex.Pattern.compile("([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})");
        java.util.regex.Matcher matcher = pattern.matcher(body);
        if (matcher.find()) {
            return matcher.group().replace("-", ":").toUpperCase();
        }
        return null;
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
    private boolean checkBluetoothEnabled() {
        if (bluetoothAdapter == null) {
            Log.e(TAG, "❌ Bluetooth adapter is null - Bluetooth not supported on this device");
            return false;
        }
        boolean isEnabled = bluetoothAdapter.isEnabled();
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
        }
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
    private void loadForgottenDevices() {
        try {
            Set<String> forgottenSet = sharedPreferences.getStringSet("forgotten_devices", new HashSet<>());
            forgottenDeviceIds.clear();
            forgottenDeviceIds.addAll(forgottenSet);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error loading forgotten devices: " + e.getMessage());
        }
    }
    private void loadDevicePasskeys() {
        try {
            String passkeysJson = sharedPreferences.getString(DEVICE_PASSKEYS_KEY, "{}");
            if (passkeysJson != null && !passkeysJson.isEmpty()) {
                org.json.JSONObject jsonObject = new org.json.JSONObject(passkeysJson);
                devicePasskeys.clear();
                org.json.JSONArray names = jsonObject.names();
                if (names != null) {
                    for (int i = 0; i < names.length(); i++) {
                        String deviceId = names.getString(i);
                        String passkey = jsonObject.getString(deviceId);
                        devicePasskeys.put(deviceId, passkey);
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error loading device passkeys: " + e.getMessage());
        }
    }
    private void saveDevicePasskeys() {
        try {
            org.json.JSONObject jsonObject = new org.json.JSONObject();
            for (Map.Entry<String, String> entry : devicePasskeys.entrySet()) {
                jsonObject.put(entry.getKey(), entry.getValue());
            }
            sharedPreferences.edit()
                .putString(DEVICE_PASSKEYS_KEY, jsonObject.toString())
                .apply();
        } catch (Exception e) {
            Log.e(TAG, "❌ Error saving device passkeys: " + e.getMessage());
        }
    }
    private void saveForgottenDevices() {
        try {
            Set<String> forgottenSet = new HashSet<>(forgottenDeviceIds);
            sharedPreferences.edit()
                .putStringSet("forgotten_devices", forgottenSet)
                .apply();
        } catch (Exception e) {
            Log.e(TAG, "❌ Error saving forgotten devices: " + e.getMessage());
        }
    }
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
    private String getDeviceName(String deviceId) {
        try {
            return sharedPreferences.getString("device_name_" + deviceId, null);
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Get device name error: " + e.getMessage());
            return null;
        }
    }
    // ============================================================================
    // BLE SCANNING METHODS
    // ============================================================================
    
    /**
     * Start BLE scanning for bonded devices (rate-limited wrapper)
     * 
     * Purpose:
     * - Discovers bonded devices that are advertising
     * - Enables automatic reconnection when devices come in range
     * - Respects minimum scan interval to prevent excessive battery drain
     * 
     * Rate Limiting:
     * - Minimum 1 second between scan operations (MIN_SCAN_INTERVAL_MS)
     * - Prevents rapid scan start/stop cycles that drain battery
     * - Delays scan start if called too soon after previous scan
     * 
     * Prerequisites Checked:
     * 1. Bluetooth is enabled
     * 2. Required permissions are granted (BLUETOOTH_SCAN, BLUETOOTH_CONNECT, ACCESS_FINE_LOCATION)
     * 3. Not already scanning
     * 4. Sufficient time elapsed since last scan
     * 
     * @see #startScanningForBondedDevicesInternal() Actual scan implementation
     * @see #checkBluetoothEnabled() Verifies Bluetooth state
     * @see #checkPermissions() Verifies runtime permissions
     */
    private void startScanningForBondedDevices() {
        // Check if already scanning (prevent duplicate scans)
        if (isScanning.get()) {
            return;
        }
        
        // Verify Bluetooth is enabled and permissions are granted
        if (!checkBluetoothEnabled() || !checkPermissions()) {
            Log.e("SampleBridgeAndroid", "Cannot start scanning: BT disabled or permissions missing");
            return;
        }
        
        // Enforce minimum scan interval (rate limiting)
        long currentTime = System.currentTimeMillis();
        long timeSinceLastScan = currentTime - lastScanStopTime;
        
        if (timeSinceLastScan < MIN_SCAN_INTERVAL_MS) {
            // Too soon since last scan, delay start
            long delayMs = MIN_SCAN_INTERVAL_MS - timeSinceLastScan;
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    // Check again before starting (state may have changed)
                    if (!isScanning.get()) {
                        startScanningForBondedDevicesInternal();
                    }
                }
            }, delayMs);
            return;
        }
        
        // Start scanning immediately (sufficient time elapsed)
        startScanningForBondedDevicesInternal();
    }
    private void startScanningForBondedDevicesInternal() {
        if (isScanning.get()) {
            return;
        }
        isScanning.set(true);
        boolean isBackground = !isAppInForeground();
        List<ScanFilter> filters = new ArrayList<>();
        ScanFilter.Builder mfgFilter = new ScanFilter.Builder();
        mfgFilter.setManufacturerData(SMART_TAG_MANUFACTURER_ID, null); 
        filters.add(mfgFilter.build());
        Log.d(TAG, "✅ Added manufacturer ID filter (0x" + String.format("%04X", SMART_TAG_MANUFACTURER_ID) + ")");
        ScanFilter.Builder serviceFilter = new ScanFilter.Builder();
        serviceFilter.setServiceUuid(ParcelUuid.fromString(SMART_TAG_SERVICE_UUID));
        filters.add(serviceFilter.build());        Map<String, Object> profileSettings = powerProfiles.get(currentPowerProfile);
        String scanMode = profileSettings != null ? (String) profileSettings.get("scanMode") : "LowLatency";
        if (isBackground) {
            Log.d("SampleBridgeAndroid", "🔍 Background scan with " + filters.size() + " filters (low power mode)");
            scanMode = "LowPower"; 
        } else {
            Log.d("SampleBridgeAndroid", "🔍 Foreground scan with " + filters.size() + " filters");
        }
        ScanSettings settings = new ScanSettings.Builder()
            .setScanMode(getScanModeFromString(scanMode))
            .setReportDelay(isBackground ? 1000 : 0) 
            .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
            .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
            .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT)
            .build();
        try {
            Log.d("SampleBridgeAndroid", "🔍 Starting " + (isBackground ? "background" : "foreground") + " scan with " + filters.size() + " filters");
            Log.d("SampleBridgeAndroid", "🔍 Scan settings: mode=" + scanMode + ", reportDelay=" + (isBackground ? 1000 : 0) + ", callbackType=ALL_MATCHES");
            bluetoothLeScanner.startScan(filters, settings, scanCallback);
            Log.d("SampleBridgeAndroid", "✅ Successfully started " + (isBackground ? "background" : "foreground") + " scanning");
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
        try {
            android.app.ActivityManager.RunningAppProcessInfo appProcessInfo = 
                new android.app.ActivityManager.RunningAppProcessInfo();
            android.app.ActivityManager.getMyMemoryState(appProcessInfo);
            return (appProcessInfo.importance == android.app.ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND);
        } catch (Exception e) {
            Log.w(TAG, "⚠️ Error checking app foreground state: " + e.getMessage());
            return true;
        }
    }
    private void stopScanning() {
        if (isScanning.get()) {
            bluetoothLeScanner.stopScan(scanCallback);
            isScanning.set(false);
            lastScanStopTime = System.currentTimeMillis();
            Log.d("SampleBridgeAndroid", "🛑 Stopped scanning");
            cleanupStaleDevices();
        }
    }
    private void cleanupStaleDevices() {
        long currentTime = System.currentTimeMillis();
        Set<String> devicesToRemove = new HashSet<>();
        for (Map.Entry<String, DeviceData> entry : deviceDataMap.entrySet()) {
            String deviceId = entry.getKey();
            DeviceData deviceData = entry.getValue();
            if ("connected".equals(deviceData.connectionState)) {
                continue;
            }
            Long lastSeen = deviceLastSeen.get(deviceId);
            if (lastSeen == null || (currentTime - lastSeen) > DEVICE_STALE_TIMEOUT_MS) {
                if (!activeScannedDevices.contains(deviceId)) {
                    devicesToRemove.add(deviceId);
                }
            }
        }
        for (String deviceId : devicesToRemove) {
            deviceDataMap.remove(deviceId);
            deviceLastSeen.remove(deviceId);
        }
        if (!devicesToRemove.isEmpty()) {
        }
    }
    private boolean shouldAllowConnection(String deviceId, boolean isManualConnection) {
        if (forgottenDeviceIds.contains(deviceId) && !isManualConnection) {
            Log.w(TAG, "🚫 Blocking auto-reconnect to forgotten device: " + deviceId);
            return false;
        }
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
        Log.d(TAG, "   Reconnection managed by BLECompanionDeviceService: " + deviceId);
    }
    private void handleServicesDiscovered(BluetoothGatt gatt) {
        String deviceId = gatt.getDevice().getAddress();
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            deviceData = new DeviceData(deviceId, gatt.getDevice().getName());
            deviceDataMap.put(deviceId, deviceData);
        }
        List<BluetoothGattService> services = gatt.getServices();
        int notificationsToEnable = 0;
        for (BluetoothGattService service : services) {
            String serviceUuid = service.getUuid().toString();
            deviceData.services.put(serviceUuid, service);
            List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
            for (BluetoothGattCharacteristic characteristic : characteristics) {
                String charUuid = characteristic.getUuid().toString();
                String key = deviceId + "_" + charUuid;
                deviceCharacteristics.put(key, characteristic);
                deviceData.characteristics.put(charUuid, characteristic);
                if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                    charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    notificationsToEnable++;
                }
            }
        }
        if (!pendingNotificationEnables.containsKey(deviceId)) {
            pendingNotificationEnables.put(deviceId, notificationsToEnable);
            completedNotificationEnables.put(deviceId, 0);
        } else {
            Integer existingPending = pendingNotificationEnables.get(deviceId);
            Integer existingCompleted = completedNotificationEnables.get(deviceId);
        }
        deviceData.isSmartTag = deviceData.services.containsKey(SMART_TAG_SERVICE_UUID);
        
        // CORRECT FLOW (SDD v1.5): Enable notifications FIRST, then check RTC
        // Reason: To send/receive commands (like Set System Time), notifications must be enabled
        // 1. Enable notifications for all critical characteristics
        // 2. When notifications are ready, read Device Status to check RTC
        // 3. If RTC invalid, send Set System Time (response comes via System Command notification)
        // 4. Proceed with Data Sync
        Log.d(TAG, "🔔 [FLOW] Starting notification enable (SDD v1.5 correct flow)");
        enableNotificationsFirst(gatt, deviceId, services, notificationsToEnable);
        for (String serviceUuid : deviceData.services.keySet()) {
        }
        for (String charUuid : deviceData.characteristics.keySet()) {
        }
        
        // ✅ FIX: Only emit ServicesDiscovered/ServiceDiscoveryComplete once per connection
        // This prevents duplicate logs when handleServicesDiscovered is called multiple times
        if (hasEmittedServicesDiscovered.contains(deviceId)) {
            Log.d(TAG, "⏭️ [FLOW] ServicesDiscovered already emitted for " + deviceId + " - skipping duplicate");
        } else {
            hasEmittedServicesDiscovered.add(deviceId);
            sendEvent("ServicesDiscovered", createServiceInfoMap(deviceData));
            boolean hasSystemCommand = deviceData.characteristics.containsKey(SYSTEM_COMMAND_CHAR_UUID);
            boolean hasDeviceStatus = deviceData.characteristics.containsKey(DEVICE_STATUS_CHAR_UUID);
            boolean hasDataTransfer = deviceData.characteristics.containsKey(DATA_TRANSFER_CHAR_UUID);
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
        }
        requestDeviceData(deviceId);
        
        // Industry best practice: Don't emit AutoConnectDeviceConnected here
        // Wait for SECURE_READY state - checkAndEmitDeviceConnected() will handle it
        // This ensures device is fully ready before JS layer starts sending commands
        // AutoConnectDeviceConnected will be emitted when SECURE_READY is reached
        
        // ════════════════════════════════════════════════════════════════════════════
        // UNIFIED CONNECTION READY: Set SECURE_READY for all connection types
        // This is the single point where we transition to SECURE_READY after services
        // are discovered, regardless of connection type (auto, manual, state-restore)
        // ════════════════════════════════════════════════════════════════════════════
        finalizeConnectionReady(deviceId, gatt);
    }
    
    /**
     * UNIFIED METHOD: Finalizes device connection after services are discovered.
     * This is called from handleServicesDiscovered() and handles:
     * - Setting SECURE_READY state
     * - Creating connection metadata if needed
     * - Triggering DeviceConnected event to React Native
     * 
     * This consolidates the duplicate SECURE_READY logic that was in:
     * - Auto-reconnection flow (setAutoConnectionCallback.onServicesDiscovered)
     * - State restoration flow (initializeStateRestoration.onServicesDiscovered)
     * - Manual connection flow
     */
    private void finalizeConnectionReady(String deviceId, BluetoothGatt gatt) {
        SecureReadyState currentState = secureReadyStates.get(deviceId);
        Log.d(TAG, "🔍 [UNIFIED] Checking SECURE_READY state for " + deviceId + ": " + (currentState != null ? currentState.name() : "null"));
        
        if (currentState == SecureReadyState.SECURE_READY) {
            Log.d(TAG, "   ⏸️ Already SECURE_READY, skipping");
            return;
        }
        
        // Ensure GATT is in connectedGatts map (may have been added by other flows)
        synchronized(gattLock) {
            if (!connectedGatts.containsKey(deviceId)) {
                connectedGatts.put(deviceId, gatt);
                Log.d(TAG, "   ✅ Added GATT to connectedGatts map");
            }
        }
        
        // Ensure DeviceData exists
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            String deviceName = gatt.getDevice().getName();
            if (deviceName == null || deviceName.isEmpty()) {
                deviceName = getDeviceName(deviceId);
                if (deviceName == null || deviceName.isEmpty()) {
                    deviceName = "Unknown Device";
                }
            }
            deviceData = new DeviceData(deviceId, deviceName);
            deviceDataMap.put(deviceId, deviceData);
            Log.d(TAG, "   ✅ Created DeviceData for device: " + deviceId);
        }
        
        // Determine connection type for metadata
        String connectionType = "manual"; // default
        if (deviceConnectionType.containsKey(deviceId) && deviceConnectionType.get(deviceId)) {
            connectionType = "auto";
        }
        
        // Create connection metadata if not exists
        if (!connectionMetadata.containsKey(deviceId)) {
            WritableMap metadata = Arguments.createMap();
            metadata.putString("connectionType", connectionType);
            metadata.putBoolean("pairingVerified", true);
            metadata.putBoolean("isBonded", gatt.getDevice().getBondState() == BluetoothDevice.BOND_BONDED);
            metadata.putBoolean("wasAlreadyBonded", bondedDeviceIds.contains(deviceId));
            connectionMetadata.put(deviceId, metadata);
            Log.d(TAG, "   ✅ Created connection metadata (type: " + connectionType + ")");
        }
        
        // Set SECURE_READY state - this triggers checkAndEmitDeviceConnected()
        Log.d(TAG, "🔒 [UNIFIED] Setting SECURE_READY state for: " + deviceId);
        updateSecureReadyState(deviceId, SecureReadyState.SECURE_READY);
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
        for (String uuid : deviceData.characteristics.keySet()) {
        }
        BluetoothGattCharacteristic batteryChar = deviceData.characteristics.get(BATTERY_LEVEL_CHAR_UUID);
        if (batteryChar != null) {
            gatt.readCharacteristic(batteryChar);
        }
        BluetoothGattCharacteristic manufacturerChar = deviceData.characteristics.get(MANUFACTURER_NAME_CHAR_UUID);
        if (manufacturerChar != null) {
            gatt.readCharacteristic(manufacturerChar);
        }
        BluetoothGattCharacteristic modelChar = deviceData.characteristics.get(MODEL_NUMBER_CHAR_UUID);
        if (modelChar != null) {
            gatt.readCharacteristic(modelChar);
        }
        BluetoothGattCharacteristic firmwareChar = deviceData.characteristics.get(FIRMWARE_REVISION_CHAR_UUID);
        if (firmwareChar != null) {
            gatt.readCharacteristic(firmwareChar);
        }
        if (deviceData.isSmartTag) {
            BluetoothGattCharacteristic dataTransferChar = deviceData.characteristics.get(DATA_TRANSFER_CHAR_UUID);
            if (dataTransferChar != null) {
                gatt.readCharacteristic(dataTransferChar);
            }
        } else {
        }
    }
    private void enableNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        String charUuid = characteristic.getUuid().toString();
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
    private void enableNotificationsWithTracking(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, String deviceId) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        String charUuid = characteristic.getUuid().toString();
        boolean notificationResult = gatt.setCharacteristicNotification(characteristic, true);
        if (!notificationResult) {
            Log.e(TAG, "❌ setCharacteristicNotification failed for: " + charUuid);
            onNotificationEnabled(deviceId);
            return;
        }
        BluetoothGattDescriptor descriptor = characteristic.getDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        );
        if (descriptor != null) {
            descriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
            if (queue == null) {
                queue = new LinkedList<>();
                descriptorWriteQueues.put(deviceId, queue);
                isDescriptorWriteInProgress.put(deviceId, false);
            }
            notificationEnableAttempts.putIfAbsent(deviceId + "_" + charUuid, 0);
            queue.add(new DescriptorWriteRequest(gatt, characteristic, descriptor, deviceId, charUuid));
            processDescriptorWriteQueue(deviceId);
        } else {
            Log.w(TAG, "⚠️ CCCD descriptor not found for: " + charUuid);
            onNotificationEnabled(deviceId);
        }
    }
    /**
     * CORRECT FLOW (SDD v1.5): Enable notifications FIRST before any other operations
     * This must be called immediately after characteristic discovery completes.
     * Flow: Enable notifications → Read Device Status → Check RTC → Send Set Time if needed → Data Sync
     */
    private void enableNotificationsFirst(BluetoothGatt gatt, String deviceId, List<BluetoothGattService> services, int notificationsToEnable) {
        Log.d(TAG, "🔔 [NOTIFICATIONS] enableNotificationsFirst called for " + deviceId + " (SDD v1.5 correct flow)");
        
        // Guard against duplicate calls - only enable notifications once per connection
        if (notificationsEnableInProgress.contains(deviceId)) {
            Log.d(TAG, "⏭️ [NOTIFICATIONS] Already enabling notifications for " + deviceId + " - skipping duplicate call");
            return;
        }
        notificationsEnableInProgress.add(deviceId);
        
        if (!pendingNotificationEnables.containsKey(deviceId)) {
            pendingNotificationEnables.put(deviceId, notificationsToEnable);
            completedNotificationEnables.put(deviceId, 0);
        }
        
        // Collect characteristics to enable notifications for
        WritableArray characteristicsList = Arguments.createArray();
        
        for (BluetoothGattService service : services) {
            List<BluetoothGattCharacteristic> serviceCharacteristics = service.getCharacteristics();
            for (BluetoothGattCharacteristic characteristic : serviceCharacteristics) {
                String charUuid = characteristic.getUuid().toString();
                if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                    charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    
                    // Add to list for connection log
                    WritableMap charInfo = Arguments.createMap();
                    charInfo.putString("uuid", charUuid);
                    charInfo.putString("name", getCharacteristicName(charUuid));
                    characteristicsList.pushMap(charInfo);
                    
                    enableNotificationsWithTracking(gatt, characteristic, deviceId);
                }
            }
        }
        
        // Send connection log event for notifications being enabled
        WritableMap logEvent = Arguments.createMap();
        logEvent.putString("deviceId", deviceId);
        logEvent.putString("action", "Enabling Notifications");
        logEvent.putInt("count", notificationsToEnable);
        logEvent.putArray("characteristics", characteristicsList);
        logEvent.putString("platform", "Android");
        sendEvent("ConnectionLog", logEvent);
    }
    
    /**
     * Helper to get human-readable characteristic name
     */
    private String getCharacteristicName(String uuid) {
        if (uuid.equals(SYSTEM_COMMAND_CHAR_UUID)) return "System Command";
        if (uuid.equals(DEVICE_STATUS_CHAR_UUID)) return "Device Status";
        if (uuid.equals(DATA_TRANSFER_CHAR_UUID)) return "Data Transfer";
        if (uuid.equals(BATTERY_LEVEL_CHAR_UUID)) return "Battery Level";
        return "Unknown";
    }
    
    /** Legacy function - kept for backward compatibility, now delegates to enableNotificationsFirst */
    private void enableNotificationsAfterRTCCheck(BluetoothGatt gatt, String deviceId, List<BluetoothGattService> services, int notificationsToEnable) {
        Log.d(TAG, "🔔 [NOTIFICATIONS] enableNotificationsAfterRTCCheck called - delegating to enableNotificationsFirst");
        enableNotificationsFirst(gatt, deviceId, services, notificationsToEnable);
    }
    private int getNotificationsToEnableCount(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            return 0;
        }
        int count = 0;
        for (BluetoothGattService service : gatt.getServices()) {
            for (BluetoothGattCharacteristic characteristic : service.getCharacteristics()) {
                String charUuid = characteristic.getUuid().toString();
                if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                    charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    count++;
                }
            }
        }
        return count;
    }
    private void onNotificationEnabled(String deviceId) {
        Integer completed = completedNotificationEnables.get(deviceId);
        Integer pending = pendingNotificationEnables.get(deviceId);
        if (completed == null || pending == null) {
            Log.w(TAG, "⚠️ [NOTIFICATIONS] onNotificationEnabled called but tracking not initialized for: " + deviceId);
            Log.w(TAG, "   completed: " + completed + ", pending: " + pending);
            return;
        }
        completed++;
        completedNotificationEnables.put(deviceId, completed);
        if (completed >= pending) {
            Log.d(TAG, "✅ [NOTIFICATIONS] All " + pending + " notifications enabled for " + deviceId);
            
            // NOTE: Do NOT clear notificationsEnableInProgress here!
            // It should remain set until device disconnects (cleared in cleanupDeviceResources)
            // This prevents duplicate notification enables from multiple handleServicesDiscovered calls
            
            // Send connection log event for all notifications enabled
            WritableMap logEvent = Arguments.createMap();
            logEvent.putString("deviceId", deviceId);
            logEvent.putString("action", "Notifications Enabled");
            logEvent.putInt("totalEnabled", pending);
            logEvent.putString("status", "success");
            logEvent.putString("platform", "Android");
            logEvent.putString("note", "All BLE notifications active - ready for data exchange");
            sendEvent("ConnectionLog", logEvent);
            
            // CORRECT FLOW (SDD v1.5): Now that notifications are enabled, read Device Status to check RTC
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    BluetoothGatt gatt = connectedGatts.get(deviceId);
                    if (gatt != null) {
                        // Read battery level first
                        BluetoothGattCharacteristic batteryChar = findCharacteristic(gatt, BATTERY_LEVEL_CHAR_UUID);
                        if (batteryChar != null) {
                            boolean readSuccess = gatt.readCharacteristic(batteryChar);
                            if (!readSuccess) {
                                Log.w(TAG, "⚠️ [BATTERY READ] Failed to initiate read");
                            }
                        }
                    }
                    
                    // Small delay then read Device Status to check RTC
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            onAllNotificationsEnabled(deviceId);
                        }
                    }, 300);
                }
            }, 500); 
            
            // Fallback timeout in case Device Status read doesn't complete
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    Boolean commandsSent = systemCommandsSent.get(deviceId);
                    String syncState = dataSyncState.getOrDefault(deviceId, "idle");
                    if ((commandsSent == null || !commandsSent) && "idle".equals(syncState)) {
                        Log.w(TAG, "⚠️ [FALLBACK TIMEOUT] Command sequence not started after 8s - triggering manually");
                        proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
                    }
                }
            }, 8000); 
            
            pendingNotificationEnables.remove(deviceId);
            completedNotificationEnables.remove(deviceId);
        }
    }
    
    /**
     * Called when all critical notifications are confirmed enabled
     * This is the CORRECT place to check RTC (after notifications are ready)
     * Flow: Read Device Status → Check RTC → Send Set Time if needed → Data Sync
     */
    private void onAllNotificationsEnabled(String deviceId) {
        Log.d(TAG, "✅ [FLOW] All notifications enabled for " + deviceId + " - now reading Device Status to check RTC");
        
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ [RTC CHECK] GATT not found - proceeding without RTC check");
            proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
            return;
        }
        
        // Check if device is a smart tag
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null || !deviceData.isSmartTag) {
            Log.d(TAG, "📱 [FLOW] Not a smart tag - skipping RTC check");
            proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
            return;
        }
        
        // Read Device Status to check RTC
        BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
        if (deviceStatusChar != null) {
            Log.d(TAG, "📖 [RTC CHECK] Reading Device Status characteristic to check RTC...");
            rtcCheckPendingBeforeNotifications.put(deviceId, true);
            boolean readSuccess = gatt.readCharacteristic(deviceStatusChar);
            if (!readSuccess) {
                Log.w(TAG, "⚠️ [RTC CHECK] Failed to read Device Status - proceeding anyway");
                rtcCheckPendingBeforeNotifications.remove(deviceId);
                proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
            }
            // parseDeviceStatusData will be called when read completes, which handles RTC check
        } else {
            Log.w(TAG, "⚠️ [RTC CHECK] Device Status characteristic not found - skipping RTC check");
            proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
        }
    }
    
    /**
     * Wait for Device Status read to complete before proceeding with command sequence
     * 
     * Purpose:
     * - Ensures RTC validity is known before deciding on time sync
     * - Prevents race condition where time sync decision is made before Device Status read completes
     * - Implements timeout to avoid indefinite blocking
     * 
     * @param deviceId Device MAC address
     * @param initialDelayMs Initial delay before checking (allows read to complete)
     */
    private void waitForDeviceStatusReadAndProceed(String deviceId, long initialDelayMs) {
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                Boolean isComplete = deviceStatusReadComplete.get(deviceId);
                if (isComplete != null && isComplete) {
                    // Device Status read is complete - proceed with command sequence
                    proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
                } else {
                    // Device Status read not complete yet - wait a bit more (max 2 seconds total)
                    long elapsed = initialDelayMs;
                    if (elapsed < 2000) {
                        waitForDeviceStatusReadAndProceed(deviceId, 200);
                    } else {
                        // Timeout - proceed anyway (RTC will be treated as unknown)
                        Log.w(TAG, "⚠️ [DEVICE STATUS TIMEOUT] Device Status read not complete after 2s - proceeding with RTC as unknown for " + deviceId);
                        proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
                    }
                }
            }
        }, initialDelayMs);
    }
    
    /**
     * Proceed with command sequence after Device Status read is complete
     * 
     * Purpose:
     * - Makes time sync decision based on known RTC validity
     * - Proceeds with data sync if RTC is valid
     * - Sends Set System Time command if RTC is invalid or unknown
     * 
     * @param deviceId Device MAC address
     */
    private void proceedWithCommandSequenceAfterDeviceStatusRead(String deviceId) {
        Boolean rtcValid = deviceRTCValidity.get(deviceId);
        if (rtcValid == null || !rtcValid) {
            Log.d(TAG, "🕐 [COMMAND SEQUENCE] RTC invalid or unknown - sending Set System Time command for " + deviceId);
            sendSetSystemTimeCommand(deviceId);
        } else {
            Log.d(TAG, "✅ [COMMAND SEQUENCE] RTC valid - proceeding with data sync for " + deviceId);
            sendDataAcquisitionAndLiveNotifications(deviceId);
        }
    }
    
    private void processDescriptorWriteQueue(String deviceId) {
        Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
        Boolean inProgress = isDescriptorWriteInProgress.get(deviceId);
        if (queue == null || queue.isEmpty()) {
            return;
        }
        if (inProgress != null && inProgress) {
            return;
        }
        DescriptorWriteRequest request = queue.peek();
        if (request == null) {
            return;
        }
        isDescriptorWriteInProgress.put(deviceId, true);
        boolean writeResult = request.gatt.writeDescriptor(request.descriptor);
        if (!writeResult) {
            Log.e(TAG, "❌ [SEQUENTIAL] Descriptor write failed to initiate for: " + request.charUuid);
            handleDescriptorWriteFailure(deviceId, request);
        } else {
        }
    }
    private void onDescriptorWriteComplete(String deviceId, BluetoothGattDescriptor descriptor, int status) {
        Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
        if (queue == null || queue.isEmpty()) {
            Log.w(TAG, "⚠️ Descriptor write complete but queue is empty for: " + deviceId);
            isDescriptorWriteInProgress.put(deviceId, false);
            return;
        }
        DescriptorWriteRequest completedRequest = queue.poll();
        isDescriptorWriteInProgress.put(deviceId, false);
        if (completedRequest != null) {
            String charName = getCharacteristicName(completedRequest.charUuid);
            
            if (status == BluetoothGatt.GATT_SUCCESS) {
                notificationEnableAttempts.remove(deviceId + "_" + completedRequest.charUuid);
                
                // Log individual characteristic notification enabled
                Log.d(TAG, "✅ [NOTIFICATION] Enabled for: " + charName + " (" + completedRequest.charUuid + ")");
                
                // Send connection log event for this characteristic
                WritableMap logEvent = Arguments.createMap();
                logEvent.putString("deviceId", deviceId);
                logEvent.putString("action", "Notification Enabled");
                logEvent.putString("characteristic", charName);
                logEvent.putString("uuid", completedRequest.charUuid);
                logEvent.putString("status", "success");
                logEvent.putString("platform", "Android");
                sendEvent("ConnectionLog", logEvent);
                
                onNotificationEnabled(deviceId);
            } else {
                Log.e(TAG, "❌ [SEQUENTIAL] Descriptor write FAILED (status=" + status + ") for: " + completedRequest.charUuid);
                
                // Log failed notification enable
                WritableMap logEvent = Arguments.createMap();
                logEvent.putString("deviceId", deviceId);
                logEvent.putString("action", "Notification Enable Failed");
                logEvent.putString("characteristic", charName);
                logEvent.putString("uuid", completedRequest.charUuid);
                logEvent.putInt("gattStatus", status);
                logEvent.putString("status", "failed");
                logEvent.putString("platform", "Android");
                sendEvent("ConnectionLog", logEvent);
                
                handleDescriptorWriteFailure(deviceId, completedRequest);
            }
        }
        if (!queue.isEmpty()) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    processDescriptorWriteQueue(deviceId);
                }
            }, 100); 
        } else {
            Integer pending = pendingNotificationEnables.get(deviceId);
            Integer completed = completedNotificationEnables.get(deviceId);
            if (pending == null || completed == null) {
                int estimatedNotifications = 4; 
                DeviceData deviceData = deviceDataMap.get(deviceId);
                if (deviceData != null && deviceData.services.containsKey(SMART_TAG_SERVICE_UUID)) {
                    int actualCount = 0;
                    for (BluetoothGattService service : deviceData.services.values()) {
                        List<BluetoothGattCharacteristic> chars = service.getCharacteristics();
                        for (BluetoothGattCharacteristic characteristic : chars) {
                            String charUuid = characteristic.getUuid().toString();
                            if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                                charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                                charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                                charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                                actualCount++;
                            }
                        }
                    }
                    if (actualCount > 0) {
                        estimatedNotifications = actualCount;
                    }
                }
                pendingNotificationEnables.put(deviceId, estimatedNotifications);
                completedNotificationEnables.put(deviceId, estimatedNotifications); 
                onNotificationEnabled(deviceId);
            } else {
                if (completed < pending) {
                    Log.w(TAG, "⚠️ [SEQUENTIAL] Queue empty but tracking incomplete - manually triggering onNotificationEnabled");
                    onNotificationEnabled(deviceId);
                } else if (completed >= pending) {
                    onNotificationEnabled(deviceId);
                }
            }
        }
    }
    private void handleDescriptorWriteFailure(String deviceId, DescriptorWriteRequest request) {
        String key = deviceId + "_" + request.charUuid;
        int attempts = notificationEnableAttempts.getOrDefault(key, 0) + 1;
        notificationEnableAttempts.put(key, attempts);
        Queue<DescriptorWriteRequest> queue = descriptorWriteQueues.get(deviceId);
        if (queue != null && !queue.isEmpty()) {
            queue.poll();
        }
        isDescriptorWriteInProgress.put(deviceId, false);
        if (attempts < MAX_NOTIFICATION_ENABLE_ATTEMPTS) {
            Log.w(TAG, "⚠️ Descriptor write failed for " + request.charUuid + " attempt " + attempts + "/" + MAX_NOTIFICATION_ENABLE_ATTEMPTS + " - retrying");
            if (queue != null) {
                queue.add(new DescriptorWriteRequest(request.gatt, request.characteristic, request.descriptor, request.deviceId, request.charUuid));
            }
            mainHandler.postDelayed(() -> processDescriptorWriteQueue(deviceId), NOTIFICATION_ENABLE_RETRY_DELAY_MS);
        } else {
            Log.e(TAG, "❌ Descriptor write failed after retries for: " + request.charUuid + " - marking as complete and proceeding");
            notificationEnableAttempts.remove(key);
            onNotificationEnabled(deviceId); 
            if (queue != null) {
                queue.clear();
            }
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
        if (charUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
            if (data != null && data.length >= 8) {
                ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
                buffer.position(6); 
                int bytes6_7 = buffer.getShort() & 0xFFFF;
                boolean isFullFormat = (bytes6_7 >= 2000 && bytes6_7 <= 3300);
                if (isFullFormat) {
                    parseDeviceStatusData(deviceData, data);
                } else {
                    parseCompactDeviceStatusData(deviceData, data);
                }
            } else {
                parseDeviceStatusData(deviceData, data);
            }
            return;
        } else if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID)) {
            // Fix: Add debug logging to track System Command responses
            if (data != null && data.length > 0) {
                Log.d(TAG, "📥 [SYSTEM COMMAND] Received notification data: " + bytesToHex(data) + " (length: " + data.length + ")");
            } else {
                Log.w(TAG, "⚠️ [SYSTEM COMMAND] Received null or empty data");
            }
            parseSystemCommandResponse(deviceData, data);
            return;
        } else if (charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                deviceData.batteryLevel = data[0] & 0xFF;
                WritableMap batteryUpdate = Arguments.createMap();
                batteryUpdate.putString("deviceId", deviceData.deviceId);
                batteryUpdate.putInt("batteryLevel", deviceData.batteryLevel);
                sendEvent("DeviceDataUpdated", batteryUpdate);
            }
            return;
        } else if (charUuid.equals(MANUFACTURER_NAME_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String manufacturerName = new String(data).trim();
            }
            return;
        } else if (charUuid.equals(MODEL_NUMBER_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String modelNumber = new String(data).trim();
            }
            return;
        } else if (charUuid.equals(FIRMWARE_REVISION_CHAR_UUID)) {
            if (data != null && data.length > 0) {
                String firmwareRevision = new String(data).trim();
            }
            return;
        } else if (charUuid.equals(DATA_TRANSFER_CHAR_UUID)) {
            parseDataTransferData(deviceData, data);
            return;
        } else {
            return;
        }
    }
    private boolean isValidSmartHealthTagData(byte[] data) {
        if (data == null || data.length < 11) {
            return false;
        }
        int version = data[0] & 0xFF;
        if (version > 10) {
            Log.w(TAG, "⚠️ [VALIDATION] Suspicious version number: " + version + " (expected 0-10)");
            return false;
        }
        if (data.length > 1) {
            int deviceStatus = data[1] & 0xFF;
            if (deviceStatus > 1) {
                Log.w(TAG, "⚠️ [VALIDATION] Invalid device status: " + deviceStatus + " (expected 0 or 1)");
                return false;
            }
        }
        if (data.length >= 9) {
            boolean allZero = true;
            boolean allFF = true;
            for (int i = 3; i < 9; i++) {
                if (data[i] != 0x00) allZero = false;
                if (data[i] != (byte)0xFF) allFF = false;
            }
            if (allZero || allFF) {
                Log.w(TAG, "⚠️ [VALIDATION] Invalid MAC address (all zeros or all FFs)");
                return false;
            }
        }
        return true;
    }
    // ============================================================================
    // MANUFACTURER DATA PARSING (SDD v1.3/v1.4 Compliance)
    // ============================================================================
    
    /**
     * Parse BLE manufacturer data from Smart Health Tag device
     * Implements SDD (Smart Device Design) v1.3/v1.4 specification
     * 
     * Data Structure (11-13 bytes):
     * - Byte 0: Version (0-10)
     * - Byte 1: Device Peripheral Status (0=Good, 1=Problem)
     * - Byte 2: Device Status Flags (connect indication, time set, factory defaults)
     * - Bytes 3-8: MAC Address (6 bytes, little-endian)
     * - Bytes 9-10: Record Count (uint16, little-endian)
     * - Bytes 11-12: Battery Voltage (optional, SDD v1.4)
     * 
     * Device Status Flags (Byte 2):
     * - Bit 0: Connect Indication (device requesting connection)
     * - Bit 1: Time Set (RTC has been synchronized)
     * - Bit 2: Factory Defaults (device in factory default state)
     * - Bits 3-7: Reserved
     * 
     * Validation Checks:
     * - Minimum length: 11 bytes (SDD v1.3)
     * - Version must be ≤ 10 (detect data corruption)
     * - Record count must be ≤ 1000 (detect corruption)
     * - MAC address cannot be all 0x00 or 0xFF (invalid)
     * 
     * @param data Raw manufacturer data bytes from BLE advertisement
     * @return WritableMap containing parsed device information
     */
    private WritableMap parseManufacturerData(byte[] data) {
        WritableMap result = Arguments.createMap();
        
        // Define expected data lengths
        // v1.4: Company ID (2) + Version (1) + Fault (1) + Status (1) + MAC (6) + Records (2) = 13 bytes
        // v1.5: Company ID (2) + Version (1) + Fault (1) + Status (1) + Restart Reason (2) + MAC (6) + Records (2) = 15 bytes
        int minLengthV14 = 13;
        int minLengthV15 = 15;
        
        // Validate data length
        if (data == null || data.length < minLengthV14) {
            Log.w(TAG, "⚠️ Manufacturer data too short: " + (data != null ? data.length : 0) + " bytes (expected " + minLengthV14 + "+ for SDD v1.4, " + minLengthV15 + "+ for v1.5)");
            Log.w(TAG, "   Device may be using older firmware or truncated advertisement");
            return result;
        }
        
        // Detect firmware version based on data length
        boolean isV15 = data.length >= minLengthV15;
        String sddVersion = isV15 ? "1.5" : "1.4";
        
        // Log raw data for debugging
        StringBuilder hex = new StringBuilder();
        for (byte b : data) {
            hex.append(String.format("%02X ", b));
        }
        Log.d(TAG, "🔍 RAW MANUFACTURER DATA (SDD v" + sddVersion + "): " + hex.toString());
        
        // Parse Company ID (bytes 0-1, little-endian)
        int companyId = 0x1234;  // Default, will be validated
        if (data.length >= 2) {
            companyId = ((data[1] & 0xFF) << 8) | (data[0] & 0xFF);
        }
        
        // Parse version (byte 2)
        if (data.length < 3) return result;
        int version = data[2] & 0xFF;
        
        // Parse device peripheral status (byte 3)
        if (data.length < 4) return result;
        int devicePeripheralStatus = data[3] & 0xFF;
        
        // Parse device status (byte 4)
        if (data.length < 5) return result;
        int deviceStatusRaw = data[4] & 0xFF;
        boolean connectIndication = (deviceStatusRaw & 0x01) != 0;    
        boolean timeSet = (deviceStatusRaw & 0x02) != 0;              
        boolean factoryDefaults = (deviceStatusRaw & 0x04) != 0;      
        int reservedBits = (deviceStatusRaw & 0xF8) >> 3;
        
        // Firmware v1.5: Parse restart reason (bytes 5-6, little-endian)
        int restartReason = 0;
        WritableArray restartReasonFlags = Arguments.createArray();
        int macStartIdx = 5;  // v1.4: MAC starts at byte 5
        int recordStartIdx = 11;  // v1.4: Record count starts at byte 11
        
        if (isV15 && data.length > 6) {
            // v1.5: Restart reason at bytes 5-6, MAC shifted to 7-12, Records shifted to 13-14
            restartReason = ((data[6] & 0xFF) << 8) | (data[5] & 0xFF);
            macStartIdx = 7;
            recordStartIdx = 13;
            
            // Parse restart reason flags
            if (restartReason != 0) {
                if ((restartReason & 0x0001) != 0) restartReasonFlags.pushString("ExternalPinReset");
                if ((restartReason & 0x0002) != 0) restartReasonFlags.pushString("SoftwareReset");
                if ((restartReason & 0x0004) != 0) restartReasonFlags.pushString("BrownoutReset");
                if ((restartReason & 0x0008) != 0) restartReasonFlags.pushString("PowerOnReset");
                if ((restartReason & 0x0010) != 0) restartReasonFlags.pushString("WatchdogReset");
                if ((restartReason & 0x0020) != 0) restartReasonFlags.pushString("DebugEventReset");
                if ((restartReason & 0x0040) != 0) restartReasonFlags.pushString("SecurityViolationReset");
                if ((restartReason & 0x0080) != 0) restartReasonFlags.pushString("LowPowerWakeup");
                if ((restartReason & 0x0100) != 0) restartReasonFlags.pushString("CPULockupReset");
                if ((restartReason & 0x0200) != 0) restartReasonFlags.pushString("ParityErrorReset");
                if ((restartReason & 0x0400) != 0) restartReasonFlags.pushString("PLLFaultReset");
                if ((restartReason & 0x0800) != 0) restartReasonFlags.pushString("ClockFailureReset");
                if ((restartReason & 0x1000) != 0) restartReasonFlags.pushString("HardwareReset");
                if ((restartReason & 0x2000) != 0) restartReasonFlags.pushString("UserReset");
                if ((restartReason & 0x4000) != 0) restartReasonFlags.pushString("TemperatureThresholdReset");
            }
        }
        
        // Parse MAC ID (6 bytes starting at macStartIdx)
        // Fix: Format MAC address with colons to match iOS format (e.g., "00:00:00:00:00:00")
        String macId = "00:00:00:00:00:00"; 
        boolean macIdValid = false;
        int macEndIdx = macStartIdx + 5;
        if (data.length > macEndIdx) {
            macId = String.format("%02X:%02X:%02X:%02X:%02X:%02X",
                    data[macEndIdx], data[macEndIdx - 1], data[macEndIdx - 2],
                    data[macEndIdx - 3], data[macEndIdx - 4], data[macEndIdx - 5]);
            // Validate MAC address: check if all bytes are 0x00 or 0xFF (invalid)
            boolean allZero = true;
            boolean allFF = true;
            for (int i = macStartIdx; i <= macEndIdx; i++) {
                if (data[i] != 0x00) allZero = false;
                if (data[i] != (byte)0xFF) allFF = false;
            }
            macIdValid = !allZero && !allFF;
        } else if (data.length > macStartIdx) {
            StringBuilder macBuilder = new StringBuilder();
            int actualEndIdx = Math.min(macEndIdx, data.length - 1);
            boolean hasValidBytes = false;
            for (int i = actualEndIdx; i >= macStartIdx; i--) {
                if (macBuilder.length() > 0) {
                    macBuilder.append(":");
                }
                macBuilder.append(String.format("%02X", data[i]));
                if (data[i] != 0x00 && data[i] != (byte)0xFF) {
                    hasValidBytes = true;
                }
            }
            while (macBuilder.length() < 17) { // "00:00:00:00:00:00" = 17 chars
                if (macBuilder.length() > 0) {
                    macBuilder.insert(0, ":");
                }
                macBuilder.insert(0, "00");
            }
            macId = macBuilder.toString();
            macIdValid = hasValidBytes;
            Log.w(TAG, "⚠️ [VALIDATION] Partial MAC ID (truncated data): " + macId);
        }
        
        // Parse record count (2 bytes, little-endian starting at recordStartIdx)
        int recordCount = 0;
        if (data.length > recordStartIdx + 1) {
            recordCount = ((data[recordStartIdx + 1] & 0xFF) << 8) | (data[recordStartIdx] & 0xFF);
        } else if (data.length > recordStartIdx) {
            recordCount = data[recordStartIdx] & 0xFF;
            Log.w(TAG, "⚠️ [VALIDATION] Partial record count (truncated data): " + recordCount);
        }
        int batteryMillivolts = 0;
        boolean isCorrupted = false;
        String corruptionReason = "";
        int expectedLength = 11; 
        if (data.length < expectedLength) {
            Log.w(TAG, "⚠️ [VALIDATION] Data length shorter than expected: " + data.length + " (expected " + expectedLength + " for SDD v1.4)");
        }
        if (recordCount > 1000) {
            isCorrupted = true;
            corruptionReason = "Record count too high: " + recordCount + " (max 1000)";
        }
        if (version > 10) {
            Log.w(TAG, "⚠️ [VALIDATION] High version number: " + version + " - may indicate corrupted data");
        }
        if (isCorrupted) {
            Log.w(TAG, "⚠️ MANUFACTURER DATA VALIDATION FAILED!");
            Log.w(TAG, "   Reason: " + corruptionReason);
            Log.w(TAG, "   Using safe defaults");
        }
        int safeRecordCount = isCorrupted ? 0 : recordCount;
        String deviceStatus = devicePeripheralStatus == 0 ? "Good" : "Problem";
        if (isCorrupted) {
            Log.w(TAG, "   ⚠️ Using safe defaults due to validation failure");
        }
        Log.d(TAG, "   ✅ Parsed Values (SDD v" + sddVersion + "):");
        Log.d(TAG, "      Company ID: 0x" + String.format("%04X", companyId));
        Log.d(TAG, "      Version: " + version);
        Log.d(TAG, "      Device Peripheral Status: " + deviceStatus);
        Log.d(TAG, "      Device Status Bits: Connect=" + connectIndication + ", TimeSet=" + timeSet + ", FactoryDefaults=" + factoryDefaults);
        if (isV15 && restartReason != 0) {
            StringBuilder flagsStr = new StringBuilder();
            for (int i = 0; i < restartReasonFlags.size(); i++) {
                if (i > 0) flagsStr.append(", ");
                flagsStr.append(restartReasonFlags.getString(i));
            }
            Log.d(TAG, "      Restart Reason: 0x" + String.format("%04X", restartReason) + " - " + flagsStr.toString());
        }
        Log.d(TAG, "      📍 MAC Address: " + macId);
        Log.d(TAG, "      Record Count: " + safeRecordCount);
        
        result.putInt("companyId", companyId);
        result.putInt("version", version);
        result.putInt("devicePeripheralStatus", devicePeripheralStatus);
        result.putString("deviceStatus", deviceStatus);
        result.putInt("deviceStatusRaw", deviceStatusRaw);
        result.putBoolean("connectIndication", connectIndication);
        result.putBoolean("timeSet", timeSet);
        result.putBoolean("factoryDefaults", factoryDefaults);
        result.putString("macId", macId);
        result.putBoolean("macIdValid", macIdValid);  // Fix: Add macIdValid to match iOS
        result.putInt("recordCount", safeRecordCount);
        result.putInt("rawRecordCount", recordCount);
        result.putInt("batteryMillivolts", 0); 
        result.putInt("rawBatteryMillivolts", 0);
        result.putInt("batteryLevel", 0); 
        result.putBoolean("isCorrupted", isCorrupted);
        result.putString("corruptionReason", isCorrupted ? corruptionReason : "");
        result.putString("sddVersion", sddVersion);
        
        // Add restart reason for v1.5
        if (isV15) {
            result.putInt("restartReason", restartReason);
            result.putArray("restartReasonFlags", restartReasonFlags);
        }
        
        return result;
    }
    private byte[] parseManufacturerDataFromRawBytes(byte[] scanRecordBytes, int targetCompanyId) {
        if (scanRecordBytes == null || scanRecordBytes.length < 5) {
            return null;
        }
        byte companyIdLow = (byte) (targetCompanyId & 0xFF);
        byte companyIdHigh = (byte) ((targetCompanyId >> 8) & 0xFF);
        int index = 0;
        while (index < scanRecordBytes.length) {
            int length = scanRecordBytes[index] & 0xFF;
            if (length == 0) {
                break;
            }
            if (index + 1 + length > scanRecordBytes.length) {
                break;
            }
            int type = scanRecordBytes[index + 1] & 0xFF;
            if (type == 0xFF && length >= 3) {
                byte lowByte = scanRecordBytes[index + 2];
                byte highByte = scanRecordBytes[index + 3];
                if (lowByte == companyIdLow && highByte == companyIdHigh) {
                    int dataLength = length - 3; 
                    byte[] manufacturerData = new byte[dataLength];
                    System.arraycopy(scanRecordBytes, index + 4, manufacturerData, 0, dataLength);
                    return manufacturerData;
                }
            }
            index += 1 + length;
        }
        return null;
    }
    // ============================================================================
    // DEVICE STATUS CHARACTERISTIC PARSING (SDD v1.4)
    // ============================================================================
    
    /**
     * Parse Device Status characteristic data (UUID: 5f5e5d5c-5b5a-5958-5756-555453525150)
     * Provides real-time device state information
     * 
     * Data Structure (8 bytes - SDD v1.4):
     * - Bytes 0-3: Unix Timestamp (uint32, little-endian) - seconds since 1970-01-01
     * - Bytes 4-5: Record Count (uint16, little-endian) - number of stored health records
     * - Bytes 6-7: Battery Voltage (uint16, little-endian) - millivolts (0-3000mV)
     * 
     * Validation:
     * - Timestamp validity: > 1577836800 (2020-01-01) indicates RTC is set
     * - Record count sentinels: 0xFFFE or 0xFFFF treated as 0 (invalid/not initialized)
     * - Record count sanity: > 100,000 treated as corruption (max expected ~25,000)
     * - Battery voltage: 0-3000mV range, converted to percentage (3000mV = 100%)
     * 
     * RTC (Real-Time Clock) Check:
     * - Valid RTC required for accurate timestamp on synced records
     * - If RTC invalid, app sends SET_SYSTEM_TIME command
     * - If pending RTC check, enables notifications after validation
     * 
     * Sync Complete Grace Period:
     * - After sync completes, ignores status updates for 20 seconds
     * - Prevents "0 records" event immediately after sync (firmware needs time to clear flash)
     * 
     * Events Emitted:
     * - "DeviceDataUpdated": Simple format (batteryVoltage, recordCount, rtcValid, timestamp)
     * - "deviceDataUpdate": Detailed format (includes type: "device_status")
     * - "RTCRead": RTC validation info (device time vs system time, difference)
     * 
     * @param deviceData Device data object to update
     * @param data Raw characteristic data (8 bytes)
     */
    private void parseDeviceStatusData(DeviceData deviceData, byte[] data) {
        // Validate data length (must be exactly 8 bytes)
        if (data == null || data.length < DEVICE_STATUS_SIZE) {
            Log.w(TAG, "Invalid device status data length: " + (data != null ? data.length : 0) + ", expected " + DEVICE_STATUS_SIZE + " bytes (SDD v1.4)");
            return;
        }
        
        // Parse data using little-endian byte order
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        
        // Parse timestamp (bytes 0-3): Unix timestamp in seconds
        long timestampSeconds = buffer.getInt() & 0xFFFFFFFFL;
        deviceData.timestamp = timestampSeconds;  // Store in seconds for now
        
        // Parse record count (bytes 4-5): number of stored records
        int recordCount = buffer.getShort() & 0xFFFF; 
        if (recordCount == 0xFFFE || recordCount == 0xFFFF) {
            Log.w(TAG, "⚠️ [RECORD COUNT] Invalid sentinel value detected: " + recordCount + " (0x" + String.format("%04X", recordCount) + ")");
            Log.w(TAG, "   Treating as 0 (no records available or device not initialized)");
            recordCount = 0;
        }
        if (recordCount > 100000) {
            Log.w(TAG, "⚠️ [RECORD COUNT] Unreasonably high value: " + recordCount);
            Log.w(TAG, "   This may indicate data corruption - treating as 0");
            recordCount = 0;
        }
        int batteryVoltage = buffer.getShort() & 0xFFFF; 
        final int BATTERY_MIN_MV = 0;    
        final int BATTERY_MAX_MV = 3000; 
        int batteryPercentage = 0;
        if (batteryVoltage >= BATTERY_MIN_MV && batteryVoltage <= BATTERY_MAX_MV) {
            batteryPercentage = Math.round((batteryVoltage * 100.0f) / BATTERY_MAX_MV);
        } else if (batteryVoltage > BATTERY_MAX_MV) {
            batteryPercentage = 100;
        } else if (batteryVoltage < BATTERY_MIN_MV) {
            batteryPercentage = 0;
        }
        java.util.Date timestampDate = new java.util.Date(timestampSeconds * 1000);
        java.util.Date currentDate = new java.util.Date();
        long currentSystemTime = System.currentTimeMillis() / 1000;
        long timeDifference = currentSystemTime - timestampSeconds;
        long timeDiffAbsolute = Math.abs(timeDifference);
        
        // RTC validation: Check both that timestamp is after Jan 1, 2020 AND within reasonable range of system time
        // FIX: Previously only checked if timestamp > 1577836800 (Jan 2020), which allowed devices with
        // significantly drifted clocks to be considered "valid" (e.g., 5+ days behind)
        // Now we also check if device time is within ±1 hour (3600 seconds) of phone time
        final long MAX_ALLOWED_TIME_DRIFT_SECONDS = 3600; // 1 hour
        boolean isTimestampAfterJan2020 = timestampSeconds > 1577836800L;
        boolean isWithinReasonableRange = timeDiffAbsolute <= MAX_ALLOWED_TIME_DRIFT_SECONDS;
        boolean isRTCValid = isTimestampAfterJan2020 && isWithinReasonableRange;
        
        // Log detailed RTC validation info
        if (!isRTCValid) {
            if (!isTimestampAfterJan2020) {
                Log.w(TAG, "⚠️ [RTC VALIDATION] Device RTC is INVALID - timestamp before Jan 2020: " + timestampSeconds);
            } else if (!isWithinReasonableRange) {
                Log.w(TAG, "⚠️ [RTC VALIDATION] Device RTC has SIGNIFICANT DRIFT - " + String.format("%.2f", timeDiffAbsolute / 3600.0) + " hours from system time");
                Log.w(TAG, "   Device time: " + timestampDate.toString());
                Log.w(TAG, "   System time: " + currentDate.toString());
                Log.w(TAG, "   Time difference: " + timeDifference + " seconds (" + String.format("%.2f", timeDifference / 3600.0) + " hours)");
                Log.w(TAG, "   Max allowed drift: " + MAX_ALLOWED_TIME_DRIFT_SECONDS + " seconds (1 hour)");
                Log.w(TAG, "   → Will send SET_SYSTEM_TIME command to synchronize device clock");
            }
        } else {
            Log.d(TAG, "✅ [RTC VALIDATION] Device RTC is VALID and synchronized (drift: " + timeDiffAbsolute + "s)");
        }
        
        deviceRTCValidity.put(deviceData.deviceId, isRTCValid);
        // Mark Device Status read as complete - RTC validity is now known
        deviceStatusReadComplete.put(deviceData.deviceId, true);
        Log.d(TAG, "✅ [DEVICE STATUS READ] RTC validity determined: " + (isRTCValid ? "VALID" : "INVALID") + " for " + deviceData.deviceId);
        // Proceed with command sequence if waiting for Device Status read
        proceedWithCommandSequenceAfterDeviceStatusRead(deviceData.deviceId);
        WritableMap rtcLogEvent = Arguments.createMap();
        rtcLogEvent.putString("deviceId", deviceData.deviceId);
        rtcLogEvent.putString("type", "rtc_read");
        rtcLogEvent.putLong("deviceRTC", timestampSeconds);
        rtcLogEvent.putString("deviceRTCISO", timestampDate.toString());
        rtcLogEvent.putLong("systemTime", currentSystemTime);
        rtcLogEvent.putString("systemTimeISO", currentDate.toString());
        rtcLogEvent.putLong("timeDifference", timeDifference);
        rtcLogEvent.putLong("timeDifferenceAbsolute", timeDiffAbsolute);
        rtcLogEvent.putBoolean("rtcValid", isRTCValid);
        rtcLogEvent.putString("timeDifferenceFormatted", String.format("%.2f hours", timeDifference / 3600.0));
        rtcLogEvent.putLong("maxAllowedDriftSeconds", MAX_ALLOWED_TIME_DRIFT_SECONDS);
        // Add reason for invalid RTC if applicable
        if (!isRTCValid) {
            if (!isTimestampAfterJan2020) {
                rtcLogEvent.putString("invalidReason", "timestamp_before_jan_2020");
            } else if (!isWithinReasonableRange) {
                rtcLogEvent.putString("invalidReason", "significant_time_drift");
            }
        }
        sendEvent("RTCRead", rtcLogEvent);
        String deviceId = deviceData.deviceId;
        if (rtcCheckPendingBeforeNotifications.containsKey(deviceId)) {
            rtcCheckPendingBeforeNotifications.remove(deviceId);
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                Log.w(TAG, "⚠️ [RTC CHECK] GATT connection lost - cannot proceed");
                return;
            }
            
            // CORRECT FLOW (SDD v1.5): Notifications are ALREADY enabled at this point
            // Now we just need to handle RTC and proceed with data sync
            if (!isRTCValid) {
                // RTC invalid - send Set System Time command
                // Response (0xBB) will be received via System Command notification (already enabled)
                Log.d(TAG, "📤 [RTC CHECK] RTC invalid - sending Set System Time command...");
                sendSetSystemTimeCommand(deviceId);
            } else {
                // RTC is valid - proceed directly to data sync
                Log.d(TAG, "✅ [RTC CHECK] RTC valid - proceeding with data sync...");
                // proceedWithCommandSequenceAfterDeviceStatusRead already called above
            }
        }
        String syncState = dataSyncState.getOrDefault(deviceData.deviceId, "unknown");
        Integer currentCount = deviceStatusNotificationCount.get(deviceData.deviceId);
        int notificationNum = (currentCount != null ? currentCount : 0) + 1;
        deviceStatusNotificationCount.put(deviceData.deviceId, notificationNum);
        Log.d(TAG, "   RTC Valid: " + (isRTCValid ? "✅ YES" : "❌ NO"));
        Log.d(TAG, "   ✅ Records Available: " + recordCount);
        Log.d(TAG, "   ✅ Battery: " + batteryVoltage + "mV (" + batteryPercentage + "%)");
        Log.d(TAG, "   Sync State: " + syncState);
        if (notificationNum > 1) {
        }
        deviceRecordCounts.put(deviceData.deviceId, recordCount);
        long timestampMs = timestampSeconds * 1000L;
        deviceData.timestamp = timestampMs;
        Long lastSyncTime = lastSyncCompleteTimestamps.get(deviceData.deviceId);
        boolean inGracePeriod = false;
        if (lastSyncTime != null) {
            long timeSinceSync = System.currentTimeMillis() - lastSyncTime;
            inGracePeriod = timeSinceSync < SYNC_COMPLETE_GRACE_PERIOD_MS;
            if (inGracePeriod) {
                Log.d(TAG, "   Reason: Firmware needs time to clear flash. Will accept updates after " + ((SYNC_COMPLETE_GRACE_PERIOD_MS - timeSinceSync)/1000) + "s");
                return; 
            } else {
                lastSyncCompleteTimestamps.remove(deviceData.deviceId);
            }
        }
        WritableMap simpleDeviceData = Arguments.createMap();
        simpleDeviceData.putString("deviceId", deviceData.deviceId);
        simpleDeviceData.putInt("batteryVoltage", batteryVoltage);  
        simpleDeviceData.putInt("recordCount", recordCount);        
        simpleDeviceData.putBoolean("rtcValid", isRTCValid);       
        simpleDeviceData.putDouble("timestamp", timestampMs);       
        Log.d(TAG, "📤 Sending device status update (SDD v1.4) for: " + deviceData.deviceId +
              " - Battery Voltage: " + batteryVoltage + "mV (percentage from 2A19), Records: " + recordCount + ", RTC Valid: " + isRTCValid);
        sendEvent("DeviceDataUpdated", simpleDeviceData);
        WritableMap deviceDataUpdateEvent = Arguments.createMap();
        deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
        deviceDataUpdateEvent.putString("type", "device_status");
        WritableMap deviceDataMapForEvent = Arguments.createMap();
        deviceDataMapForEvent.putInt("batteryVoltage", batteryVoltage);  
        deviceDataMapForEvent.putInt("recordCount", recordCount);
        deviceDataMapForEvent.putBoolean("rtcValid", isRTCValid);
        deviceDataMapForEvent.putDouble("lastUpdate", timestampMs);
        deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
        sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
        if (recordCount > 0) {
            Log.d(TAG, "📦 " + recordCount + " records available for sync on " + deviceData.deviceId + " - JS layer will handle auto-sync");
        }
    }
    private void parseCompactDeviceStatusData(DeviceData deviceData, byte[] data) {
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        int timestampSeconds = buffer.getInt();
        long currentTimeSeconds = System.currentTimeMillis() / 1000;
        long timeDiffAbsolute = Math.abs(currentTimeSeconds - timestampSeconds);
        // FIX: Also check if timestamp is within reasonable range (±1 hour) of system time
        final long MAX_ALLOWED_TIME_DRIFT_SECONDS = 3600; // 1 hour
        boolean isValidTimestamp = timestampSeconds > 1577836800 && timeDiffAbsolute <= MAX_ALLOWED_TIME_DRIFT_SECONDS;
        if (!isValidTimestamp) {
            Log.w(TAG, "⚠️ Invalid or drifted timestamp detected in compact format: " + timestampSeconds + 
                  " (drift: " + timeDiffAbsolute + "s), using current time");
            timestampSeconds = (int) currentTimeSeconds;
        }
        deviceData.timestamp = timestampSeconds; 
        deviceData.steps = buffer.getShort() & 0xFFFF; 
        int temperatureRaw = buffer.get() & 0xFF; 
        int flags = buffer.get() & 0xFF; 
        deviceData.temperature = temperatureRaw;
        long timestampMs = timestampSeconds * 1000L;
        Log.d(TAG, "📊 Parsed compact device data - Steps: " + deviceData.steps + 
              ", Temp: " + deviceData.temperature + "°C, Timestamp: " + timestampSeconds + 
              "s (" + timestampMs + "ms), Flags: " + flags);
        deviceData.timestamp = timestampMs;
        WritableMap simpleDeviceData = Arguments.createMap();
        simpleDeviceData.putString("deviceId", deviceData.deviceId);
        if (deviceData.batteryLevel != null) {
            simpleDeviceData.putInt("batteryLevel", deviceData.batteryLevel);
        } else {
            simpleDeviceData.putNull("batteryLevel");
        }
        simpleDeviceData.putInt("steps", deviceData.steps);
        simpleDeviceData.putInt("temperature", (int) deviceData.temperature);
        simpleDeviceData.putDouble("timestamp", timestampMs); 
        Log.d(TAG, "📤 Sending compact device data update event for: " + deviceData.deviceId + 
              " - Steps: " + deviceData.steps + ", Temp: " + deviceData.temperature + "°C, RTC Valid: " + isValidTimestamp);
        sendEvent("DeviceDataUpdated", simpleDeviceData);
        WritableMap deviceDataUpdateEvent = Arguments.createMap();
        deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
        deviceDataUpdateEvent.putString("type", "live_data"); 
        WritableMap deviceDataMapForEvent = Arguments.createMap();
        if (deviceData.batteryLevel != null) {
            deviceDataMapForEvent.putInt("batteryLevel", deviceData.batteryLevel);
        }
        deviceDataMapForEvent.putInt("steps", deviceData.steps);
        deviceDataMapForEvent.putInt("temperature", (int) deviceData.temperature);
        deviceDataMapForEvent.putDouble("lastUpdate", timestampMs);
        deviceDataMapForEvent.putString("dataSource", isValidTimestamp ? "live" : "cached");
        deviceDataMapForEvent.putBoolean("rtcValid", isValidTimestamp);
        deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
        sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
    }
    private void parseDataTransferData(DeviceData deviceData, byte[] data) {
        if (data == null || data.length < 1) {
            Log.w(TAG, "Invalid data transfer data length: " + (data != null ? data.length : 0) + ", expected at least 1 byte");
            return;
        }
        Boolean wasRequested = dataSyncRequested.get(deviceData.deviceId);
        boolean isRequested = (wasRequested != null && wasRequested);
        String syncState = dataSyncState.getOrDefault(deviceData.deviceId, "unknown");
        // "ready" is a connection state, not a sync state. Only check actual sync states.
        boolean isSyncActive = "syncing".equals(syncState) || "time_syncing".equals(syncState);
        
        // Check data type early to determine if it's a push-generated record
        byte transferType = data[0];
        
        // Firmware v1.5: Accept push-generated records (type 0x03) even when not in sync
        // These are automatic notifications sent at each data acquisition interval
        boolean isPushGeneratedRecord = (transferType == DATA_TRANSFER_RECORD) && !isRequested && !isSyncActive;
        boolean shouldAcceptData = isRequested || isSyncActive || isPushGeneratedRecord;
        
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "🔍 RAW DATA TRANSFER ANALYSIS");
        Log.d(TAG, "═══════════════════════════════════════════════════════");
        Log.d(TAG, "Device: " + deviceData.deviceId);
        Log.d(TAG, "Data Sync Requested: " + (isRequested ? "YES ✅" : "NO ❌"));
        Log.d(TAG, "Data Sync State: " + syncState);
        Log.d(TAG, "Data Type: 0x" + String.format("%02X", transferType));
        Log.d(TAG, "Is Push-Generated: " + (isPushGeneratedRecord ? "YES ✅ (v1.5 live record)" : "NO ❌"));
        Log.d(TAG, "Should Accept Data: " + (shouldAcceptData ? "YES ✅" : "NO ❌ (UNSOLICITED)"));
        StringBuilder allBytes = new StringBuilder();
        for (int i = 0; i < data.length; i++) {
            allBytes.append(String.format("[%d]:%02X ", i, data[i]));
        }
        if (!shouldAcceptData) {
            Log.w(TAG, "⚠️ IGNORING UNSOLICITED DATA TRANSFER!");
            Log.w(TAG, "   This is auto-transmitted cached/test data from device");
            Log.w(TAG, "   Waiting for explicit data sync request or active sync state");
            Log.w(TAG, "═══════════════════════════════════════════════════════");
            return;
        }
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        transferType = buffer.get();  // Re-read after buffer creation
        switch (transferType) {
            case DATA_TRANSFER_SYNC_START:
                parseSyncStartData(deviceData, buffer);
                break;
            case DATA_TRANSFER_SYNC_COMPLETE:
                parseSyncCompleteData(deviceData, buffer);
                break;
            case DATA_TRANSFER_RECORD:
                parseDataRecordData(deviceData, buffer, isPushGeneratedRecord);
                break;
            case DATA_TRANSFER_READ_ERROR:
                parseReadErrorData(deviceData, buffer);
                break;
            default:
                Log.w(TAG, "Unknown data transfer type: 0x" + String.format("%02X", transferType));
                break;
        }
    }
    private void parseSyncStartData(DeviceData deviceData, ByteBuffer buffer) {        if (buffer.remaining() < 5) {  
            Log.e(TAG, "❌ Data Sync Start payload too short: " + buffer.remaining() + " bytes");
            return;
        }
        byte length = buffer.get();  
        dataSyncState.put(deviceData.deviceId, "syncing");
        int totalRecords = buffer.getInt();
        byte[] payloadBytes = new byte[4];
        buffer.position(buffer.position() - 4); 
        buffer.get(payloadBytes);
        Log.d(TAG, "   Raw bytes: " + String.format("0x%02X 0x%02X 0x%02X 0x%02X", 
            payloadBytes[0], payloadBytes[1], payloadBytes[2], payloadBytes[3]));
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
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "sync_start");
        eventData.putInt("totalRecords", totalRecords);
        eventData.putString("deviceId", deviceData.deviceId);
        sendEvent("DataTransfer", eventData);
        String deviceId = deviceData.deviceId;
        int previousTotal = syncTotalRecords.getOrDefault(deviceId, 0);
        syncTotalRecords.put(deviceId, totalRecords);
        if (previousTotal != totalRecords && previousTotal > 0) {
        }
        if (!syncRecordsReceived.containsKey(deviceId)) {
            syncRecordsReceived.put(deviceId, 0);
            syncCurrentFileNumber.put(deviceId, 1);
            syncGrandTotalReceived.put(deviceId, 0);
        }
    }
    private void parseSyncCompleteData(DeviceData deviceData, ByteBuffer buffer) {        if (buffer.remaining() < 3) {  
            Log.e(TAG, "❌ Data Sync Complete payload too short: " + buffer.remaining() + " bytes");
            return;
        }
        byte length = buffer.get();  
        int value = buffer.getShort() & 0xFFFF;
        final String deviceId = deviceData.deviceId;
        dataSyncState.put(deviceId, "complete");
        dataSyncRetryCount.remove(deviceId);
        syncCommandSentFlags.put(deviceId, false);  // FIX: Reset the sent flag on sync complete
        ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
        if (syncTimer != null) {
            syncTimer.cancel(false);
            dataSyncTimers.remove(deviceId);
        }
        // Firmware v1.5: Removed 0xFFFF force termination. Valid range is 0x0001 to 0x01F4
        // Any value in this range indicates successful sync completion
        if (value >= 0x0001 && value <= 0x01F4) {
            // Valid record count - process normally
            int actualCount = value;
                int recordsInThisChunk = Math.min(actualCount, RECORDS_PER_FILE); 
                if (actualCount > RECORDS_PER_FILE) {
                    Log.w(TAG, "⚠️ [SDD v1.4 COMPLIANCE] Device reported " + actualCount + " records (exceeds " + RECORDS_PER_FILE + " limit)");
                    Log.w(TAG, "   This indicates device sent multiple files in one sync session");
                    Log.w(TAG, "   Treating as " + RECORDS_PER_FILE + " records for this chunk, " + (actualCount - RECORDS_PER_FILE) + " for next");
                }
                int totalRecords = syncTotalRecords.getOrDefault(deviceId, 0);
                int grandTotal = syncGrandTotalReceived.getOrDefault(deviceId, 0) + recordsInThisChunk;
                syncGrandTotalReceived.put(deviceId, grandTotal);
                int currentFileNum = syncCurrentFileNumber.getOrDefault(deviceId, 1);
                boolean hasMoreChunks = (grandTotal < totalRecords) || (actualCount > RECORDS_PER_FILE);
                if (actualCount > RECORDS_PER_FILE) {
                    int excessRecords = actualCount - RECORDS_PER_FILE;                    if (totalRecords < grandTotal + excessRecords) {
                        syncTotalRecords.put(deviceId, grandTotal + excessRecords);
                    }
                }
                if (hasMoreChunks) {
                } else {
                }
                int remainingRecords = Math.max(0, totalRecords - grandTotal);
                deviceRecordCounts.put(deviceId, remainingRecords);
                Log.d(TAG, "✅ Updated record count to " + remainingRecords + " after file #" + currentFileNum);
                WritableMap eventData = Arguments.createMap();
                eventData.putString("type", hasMoreChunks ? "chunk_complete" : "sync_complete");
                eventData.putBoolean("success", true);
                eventData.putInt("recordsTransmitted", value);
                eventData.putInt("chunkNumber", currentFileNum);
                eventData.putInt("grandTotal", grandTotal);
                eventData.putInt("totalExpected", totalRecords);
                eventData.putBoolean("hasMoreChunks", hasMoreChunks);
                eventData.putString("deviceId", deviceId);
                sendEvent("DataTransfer", eventData);
                if (!hasMoreChunks) {
                    int finalRecordCount = remainingRecords; 
                    WritableMap deviceDataUpdateEvent = Arguments.createMap();
                    deviceDataUpdateEvent.putString("deviceId", deviceId);
                    deviceDataUpdateEvent.putString("type", "sync_complete");
                    deviceDataUpdateEvent.putInt("recordCount", finalRecordCount);
                    deviceDataUpdateEvent.putInt("recordsTransmitted", value);
                    deviceDataUpdateEvent.putInt("totalRecords", grandTotal);
                    WritableMap deviceDataMapForEvent = Arguments.createMap();
                    DeviceData deviceDataObj = deviceDataMap.get(deviceId);
                    if (deviceDataObj != null) {
                        deviceDataMapForEvent.putInt("recordCount", finalRecordCount);
                        Integer batteryLevel = deviceDataObj.batteryLevel;
                        if (batteryLevel != null) {
                            deviceDataMapForEvent.putInt("batteryLevel", batteryLevel);
                        }
                    } else {
                        deviceDataMapForEvent.putInt("recordCount", finalRecordCount);
                    }
                    deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
                    sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
                    lastSyncCompleteTimestamps.put(deviceId, System.currentTimeMillis());
                }
                // SDD v1.5: Send Data Sync Stop immediately after sync_complete notification
                // Firmware v1.5: Send 2-byte record count (500 = 0x01F4) instead of 1-byte 0x01
                int recordsTransmitted = 500;  // RECORDS_PER_FILE
                byte[] stopPayload = new byte[]{
                    (byte)(recordsTransmitted & 0xFF),           // LSB
                    (byte)((recordsTransmitted >> 8) & 0xFF)     // MSB
                };
                boolean success = sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
                if (success) {
                    Log.d(TAG, "✅ [SDD v1.5] DATA_SYNC_STOP sent immediately after sync_complete - file #" + currentFileNum + " will be cleared (v1.5: " + recordsTransmitted + " records)");
                } else {
                    Log.e(TAG, "❌ Failed to send DATA_SYNC_STOP command");
                }
                
                // Use postDelayed only for next file sync (if needed)
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (hasMoreChunks) {
                                int nextFileNum = currentFileNum + 1;
                                syncCurrentFileNumber.put(deviceId, nextFileNum);
                                syncRecordsReceived.put(deviceId, 0);
                                Log.d(TAG, "📦 [MULTI-FILE SYNC] File #" + currentFileNum + " complete. Progress: " + grandTotal + "/" + totalRecords + " records. Starting file #" + nextFileNum + "...");
                                mainHandler.postDelayed(new Runnable() {
                                    @Override
                                    public void run() {
                                        boolean startSuccess = sendDataSyncStartCommand(deviceId, 0);
                                        if (startSuccess) {
                                            Log.d(TAG, "✅ [MULTI-FILE SYNC] Started file #" + nextFileNum + " sync for " + deviceId);
                                        } else {
                                            Log.e(TAG, "❌ [MULTI-FILE SYNC] Failed to start file #" + nextFileNum);
                                        }
                                    }
                                }, 1000);  
                            } else {
                                String finalState = dataSyncState.getOrDefault(deviceId, "complete");
                                if (!"complete".equals(finalState)) {
                                    dataSyncState.put(deviceId, "complete");
                                }
                                dataSyncRequested.put(deviceId, false);
                                syncCommandSentFlags.put(deviceId, false);  // FIX: Reset the sent flag
                                syncTotalRecords.remove(deviceId);
                                syncRecordsReceived.remove(deviceId);
                                syncCurrentFileNumber.remove(deviceId);
                                syncGrandTotalReceived.remove(deviceId);
                            }  
                        }
                    }, 1500); 
                }, 1000); 
        } else {
            // Firmware v1.5: Invalid record count (outside 0x0001-0x01F4 range)
            Log.e(TAG, "❌ Data Sync Complete - Invalid record count: 0x" + String.format("%04X", value) + " (" + value + ")");
            Log.e(TAG, "   Firmware v1.5: Valid range is 0x0001 to 0x01F4");
            dataSyncState.put(deviceId, "failed");
            dataSyncRequested.put(deviceId, false);
            WritableMap eventData = Arguments.createMap();
            eventData.putString("type", "sync_complete");
            eventData.putBoolean("success", false);
            eventData.putString("reason", "invalid_record_count");
            eventData.putString("deviceId", deviceId);
            sendEvent("DataTransfer", eventData);
        }
    }
    private void parseDataRecordData(DeviceData deviceData, ByteBuffer buffer, boolean isPushGenerated) {
        if (buffer.remaining() < 1) {
            Log.e(TAG, "❌ Record Data missing Length byte");
            return;
        }
        byte length = buffer.get();  // SDD v1.5: Length byte indicates data payload size (6-18 bytes)
        int remainingBytes = buffer.remaining();
        int declaredLength = length & 0xFF;  // Convert to unsigned
        
        // SDD v1.5 Table 15: Record Data length is 6-18 bytes
        // Each complete record is 8 bytes (Timestamp 4 + Steps 2 + Temp 1 + Flags 1)
        // Minimum valid data: at least declaredLength bytes OR at least 8 bytes for one record
        int minRequired = Math.min(declaredLength, 8);
        
        // FIX: Handle truncated packets gracefully
        // If declared length doesn't match remaining bytes, use what we have
        if (remainingBytes < minRequired) {
            // Check if we have at least SOME data to work with
            if (remainingBytes >= 6 && declaredLength >= 6) {
                // SDD v1.5: Length can be 6-18. If we have 6+ bytes, try to parse partial record
                Log.w(TAG, "⚠️ Record Data payload shorter than declared: " + remainingBytes + " bytes (declared: " + declaredLength + ")");
                Log.d(TAG, "   Attempting to parse with available data...");
                // Fall through to parsing with reduced bytesToRead
            } else if (remainingBytes > 0 && remainingBytes < 6) {
                // Not enough for even a minimal record - log and skip
                Log.w(TAG, "⚠️ Record Data too short for any valid record: " + remainingBytes + " bytes");
                Log.d(TAG, "   Buffer position: " + buffer.position() + ", limit: " + buffer.limit());
                byte[] rawBytes = new byte[remainingBytes];
                buffer.mark();
                buffer.get(rawBytes);
                buffer.reset();
                StringBuilder sb = new StringBuilder();
                for (byte b : rawBytes) {
                    sb.append(String.format("%02X ", b));
                }
                Log.d(TAG, "   Raw remaining bytes: " + sb.toString());
                return;
            } else {
                Log.e(TAG, "❌ Record Data payload too short: " + remainingBytes + " bytes (declared length: " + declaredLength + ", min required: " + minRequired + ")");
                return;
            }
        }
        
        // Determine how many bytes to actually read (minimum of declared length and remaining bytes)
        int bytesToRead = Math.min(declaredLength, remainingBytes);
        
        List<WritableMap> records = new ArrayList<>();
        int bytesRead = 0;
        
        // Parse complete 8-byte records from the payload
        while (bytesRead + 8 <= bytesToRead && buffer.remaining() >= 8) {
            int timestamp = buffer.getInt();           
            int steps = buffer.getShort() & 0xFFFF;    
            int temperature = buffer.get() & 0xFF;     
            int flags = buffer.get() & 0xFF;   
            bytesRead += 8;
            
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
        }
        
        // FIX: Handle partial records (when we have 6-7 bytes - missing flags or temp+flags)
        // SDD v1.5 allows length 6-18, and partial data may occur in certain firmware conditions
        int remainingAfterFullRecords = bytesToRead - bytesRead;
        int bufferRemaining = buffer.remaining();
        
        if (remainingAfterFullRecords >= 6 && bufferRemaining >= 6 && remainingAfterFullRecords < 8) {
            // Try to parse partial record (at least timestamp + steps + temp = 7 bytes, or timestamp + steps = 6 bytes)
            Log.d(TAG, "📝 Attempting to parse partial record with " + bufferRemaining + " bytes");
            
            int timestamp = buffer.getInt();  // 4 bytes
            int steps = buffer.getShort() & 0xFFFF;  // 2 bytes
            bytesRead += 6;
            
            int temperature = 0;
            int flags = 0;
            
            if (bufferRemaining >= 7 && (remainingAfterFullRecords - 6) >= 1) {
                temperature = buffer.get() & 0xFF;  // 1 byte
                bytesRead += 1;
            }
            if (bufferRemaining >= 8 && (remainingAfterFullRecords - 7) >= 1 && buffer.remaining() >= 1) {
                flags = buffer.get() & 0xFF;  // 1 byte
                bytesRead += 1;
            }
            
            java.util.Date date = new java.util.Date(timestamp * 1000L);
            java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            String dateString = formatter.format(date);
            WritableMap record = Arguments.createMap();
            record.putInt("timestamp", timestamp);
            record.putString("timestampDate", dateString);
            record.putInt("steps", steps);
            record.putInt("temperature", temperature);
            record.putInt("flags", flags);
            record.putBoolean("isPartialRecord", true);  // Flag to indicate this was a partial record
            records.add(record);
            
            Log.d(TAG, "✅ Parsed partial record: timestamp=" + timestamp + ", steps=" + steps + ", temp=" + temperature);
        }
        
        // Log any remaining bytes that couldn't form even a partial record
        int remainingUnparsed = bytesToRead - bytesRead;
        if (remainingUnparsed > 0 && buffer.remaining() > 0) {
            Log.w(TAG, "⚠️ " + remainingUnparsed + " bytes remaining after parsing " + records.size() + " records (padding or unknown data)");
        }
        
        String deviceId = deviceData.deviceId;
        
        // Firmware v1.5: Distinguish between push-generated records (live data) and sync records
        if (isPushGenerated) {
            // Push-generated record: Process as live data, don't count in sync progress
            Log.d(TAG, "📤 Push-Generated Record (v1.5 live data) - " + records.size() + " record(s)");
            Log.d(TAG, "   Processing as live data (not counting in sync progress)");
            WritableArray recordsArray = Arguments.createArray();
            for (WritableMap record : records) {
                recordsArray.pushMap(record);
            }
            WritableMap eventData = Arguments.createMap();
            eventData.putString("type", "record");
            eventData.putArray("records", recordsArray);
            eventData.putInt("recordCount", records.size());
            eventData.putString("deviceId", deviceId);
            eventData.putBoolean("isPushGenerated", true);  // Flag to indicate this is push-generated (live data)
            eventData.putBoolean("isLiveData", true);
            sendEvent("DataTransfer", eventData);
            return;
        }
        
        // Sync record: Process as part of sync operation
        Log.d(TAG, "✅ Received " + records.size() + " health records (sync mode)");
        int currentReceived = syncRecordsReceived.getOrDefault(deviceId, 0);
        int newTotal = currentReceived + records.size();
        List<WritableMap> recordsForThisChunk = records;
        int excessRecords = 0;
        if (newTotal >= RECORDS_PER_FILE) {
            Log.w(TAG, "⚠️ [SDD v1.4 COMPLIANCE] Received " + newTotal + " records in chunk (limit: " + RECORDS_PER_FILE + ")");
            Log.w(TAG, "   Device should have stopped at 500 records. Enforcing limit and stopping chunk.");
            excessRecords = newTotal - RECORDS_PER_FILE;
            int recordsToTake = RECORDS_PER_FILE - currentReceived;
            if (excessRecords > 0) {
                recordsForThisChunk = records.subList(0, Math.min(recordsToTake, records.size()));
            }
            syncRecordsReceived.put(deviceId, RECORDS_PER_FILE);
        } else {
            syncRecordsReceived.put(deviceId, newTotal);
        }
        WritableArray recordsArray = Arguments.createArray();
        for (WritableMap record : recordsForThisChunk) {
            recordsArray.pushMap(record);
        }
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "record");
        eventData.putArray("records", recordsArray);
        eventData.putInt("recordCount", recordsForThisChunk.size());
        eventData.putString("deviceId", deviceId);
        eventData.putBoolean("isPushGenerated", false);  // This is a sync record
        eventData.putBoolean("isLiveData", false);
        sendEvent("DataTransfer", eventData);
        int currentChunkRecords = syncRecordsReceived.getOrDefault(deviceId, 0);
        int totalExpected = syncTotalRecords.getOrDefault(deviceData.deviceId, 0);
        int currentGrandTotal = syncGrandTotalReceived.getOrDefault(deviceData.deviceId, 0);
        WritableMap syncUpdateEvent = Arguments.createMap();
        syncUpdateEvent.putString("deviceId", deviceData.deviceId);
        syncUpdateEvent.putString("type", "sync_records");
        syncUpdateEvent.putInt("recordsReceived", recordsForThisChunk.size());
        syncUpdateEvent.putInt("totalReceived", currentChunkRecords); 
        syncUpdateEvent.putInt("totalExpected", totalExpected);
        syncUpdateEvent.putInt("recordCount", recordsForThisChunk.size());
        sendEvent("deviceDataUpdate", syncUpdateEvent);
        if (newTotal >= RECORDS_PER_FILE) {
            syncRecordsReceived.put(deviceId, excessRecords);
            // NOTE: According to SDD v1.5, DATA_SYNC_STOP should be sent after sync_complete notification (0x02)
            // This is a fallback safety mechanism in case sync_complete doesn't arrive within reasonable time
            // The primary DATA_SYNC_STOP is sent in parseSyncCompleteData() when sync_complete notification is received
            mainHandler.postDelayed(() -> {
                // Check if sync_complete was already received (primary path should have handled it)
                String syncState = dataSyncState.getOrDefault(deviceId, "idle");
                if ("complete".equals(syncState)) {
                    Log.d(TAG, "✅ [FALLBACK] sync_complete already received - DATA_SYNC_STOP already sent via primary path");
                    return;
                }
                // Fallback: Send DATA_SYNC_STOP if sync_complete hasn't arrived
                Log.w(TAG, "⚠️ [FALLBACK] sync_complete not received yet - sending DATA_SYNC_STOP as fallback after " + RECORDS_PER_FILE + " records");
                // Firmware v1.5: Send 2-byte record count (500 = 0x01F4) instead of 1-byte 0x01
                int recordsTransmitted = 500;  // RECORDS_PER_FILE
                byte[] stopPayload = new byte[]{
                    (byte)(recordsTransmitted & 0xFF),           // LSB
                    (byte)((recordsTransmitted >> 8) & 0xFF)     // MSB
                };
                boolean success = sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
                if (success) {
                    Log.d(TAG, "✅ [FALLBACK] DATA_SYNC_STOP sent after " + RECORDS_PER_FILE + " records (v1.5: " + recordsTransmitted + " records)");
                } else {
                    Log.e(TAG, "❌ [FALLBACK] Failed to send DATA_SYNC_STOP command");
                }
                int totalRecords = syncTotalRecords.getOrDefault(deviceId, 0);
                int grandTotal = syncGrandTotalReceived.getOrDefault(deviceId, 0) + RECORDS_PER_FILE;
                syncGrandTotalReceived.put(deviceId, grandTotal);
                boolean hasMoreChunks = (grandTotal < totalRecords);
                if (hasMoreChunks) {
                    int currentFileNum = syncCurrentFileNumber.getOrDefault(deviceId, 1);
                    int nextFileNum = currentFileNum + 1;
                    syncCurrentFileNumber.put(deviceId, nextFileNum);
                    Log.d(TAG, "📦 [MULTI-FILE SYNC] File #" + currentFileNum + " complete. Progress: " + grandTotal + "/" + totalRecords + " records. Starting file #" + nextFileNum + "...");
                    mainHandler.postDelayed(() -> {
                        boolean startSuccess = sendDataSyncStartCommand(deviceId, 0);
                        if (startSuccess) {
                            Log.d(TAG, "✅ [MULTI-FILE SYNC] Started file #" + nextFileNum + " sync for " + deviceId);
                        } else {
                            Log.e(TAG, "❌ [MULTI-FILE SYNC] Failed to start next chunk (file #" + nextFileNum + ")");
                        }
                    }, 1000); 
                }
            }, 500); 
        }
    }
    private void parseReadErrorData(DeviceData deviceData, ByteBuffer buffer) {
        if (buffer.remaining() < 2) {  
            Log.e(TAG, "❌ Read Error payload too short");
            return;
        }
        byte length = buffer.get();  
        byte errorCode = buffer.get();
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "read_error");
        eventData.putInt("errorCode", errorCode & 0xFF);
        eventData.putString("deviceId", deviceData.deviceId);
        sendEvent("DataTransfer", eventData);
    }
    private void sendDeviceDataUpdateEvent(DeviceData deviceData) {
        WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
        sendEvent("DeviceDataUpdated", deviceInfoMap);
        sendHealthDataApiEvent(deviceData.deviceId, deviceInfoMap);
    }
    private String getCommandName(int commandId) {
        switch (commandId) {
            case CMD_SET_SYSTEM_TIME: return "SET_SYSTEM_TIME";
            case CMD_SET_ADV_INTERVAL: return "SET_ADVERTISING_INTERVAL";
            case CMD_SET_CONN_INTERVAL: return "SET_CONNECTION_INTERVAL";
            case CMD_SET_DATA_INTERVAL: return "SET_DATA_ACQUISITION_INTERVAL";
            case CMD_GET_FW_VERSION: return "GET_FIRMWARE_VERSION";
            case CMD_GET_HW_VERSION: return "GET_HARDWARE_VERSION";
            case CMD_GET_DIAGNOSTICS: return "GET_DIAGNOSTICS";
            case CMD_DATA_SYNC_START: return "DATA_SYNC_START";
            case CMD_DATA_SYNC_STOP: return "DATA_SYNC_STOP";
            case CMD_SYSTEM_RESTART: return "SYSTEM_RESTART";
            case CMD_TOGGLE_BUZZER: return "TOGGLE_BUZZER";
            case CMD_UNPAIR_DEVICE: return "UNPAIR_DEVICE";
            case CMD_FACTORY_RESET: return "FACTORY_RESET";
            case CMD_PASSKEY_UPDATE: return "PASSKEY_UPDATE";
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
        ByteBuffer buffer = ByteBuffer.wrap(data).order(ByteOrder.LITTLE_ENDIAN);
        byte responseId = buffer.get();
        byte commandId = buffer.get();
        byte responseLength = buffer.get();
        byte responseStatus = buffer.get();
        Log.d(TAG, "🔧 System command response - ResponseID: 0x" + String.format("%02x", responseId) + 
              ", CommandID: 0x" + String.format("%02x", commandId) + 
              ", Length: " + responseLength + 
              ", Status: 0x" + String.format("%02x", responseStatus));
        if (responseId != RESPONSE_ID) {
            Log.w(TAG, "Invalid response ID: 0x" + String.format("%02x", responseId) + ", expected 0x" + String.format("%02x", RESPONSE_ID));
            return;
        }
        onSystemCommandWriteComplete(deviceData.deviceId, responseStatus == 0x00 ? BluetoothGatt.GATT_SUCCESS : BluetoothGatt.GATT_FAILURE);
        String commandMessage = null;
        if (responseStatus != 0x00) {
            Log.w(TAG, "System command failed with status: 0x" + String.format("%02x", responseStatus));
            if (commandId == CMD_SET_SYSTEM_TIME) {
                setTimeResponseReceived.put(deviceData.deviceId, true); 
                ScheduledFuture<?> timeoutTimer = setTimeTimeoutTimers.remove(deviceData.deviceId);
                if (timeoutTimer != null) {
                    timeoutTimer.cancel(false);
                }
                int currentRetry = setTimeRetryAttempts.getOrDefault(deviceData.deviceId, 0);
                if (currentRetry < 1) {
                    Log.w(TAG, "⚠️ [TIME SYNC FAILED] Set System Time command failed with status 0x" + String.format("%02X", responseStatus));
                    Log.w(TAG, "   Retrying SET TIME command (attempt " + (currentRetry + 1) + "/2)...");
                    setTimeRetryAttempts.put(deviceData.deviceId, currentRetry + 1);
                    mainHandler.postDelayed(() -> {
                        sendSetSystemTimeCommand(deviceData.deviceId, currentRetry + 1);
                    }, 3000);
                } else {
                    Log.e(TAG, "❌ [TIME SYNC FAILED] Set System Time command failed after 2 attempts");
                    Log.e(TAG, "   Proceeding with other commands, but RTC may remain invalid");
                    Log.e(TAG, "   Device may not have valid time, but live updates will still work");
                    dataSyncState.put(deviceData.deviceId, "time_sync_failed");
                    setTimeRetryAttempts.remove(deviceData.deviceId);
                    
                    // CORRECT FLOW (SDD v1.5): Notifications are already enabled, just proceed with data sync
                    sendDataAcquisitionAndLiveNotifications(deviceData.deviceId);
                }
            }
            return;
        }
                // ============================================================================
        // SYSTEM COMMAND RESPONSE HANDLING (Switch Statement)
        // ============================================================================
        // Process different command types and perform follow-up actions
        
        switch (commandId) {
            // ----------------------------------------------------------------
            // SET_SYSTEM_TIME: RTC synchronization
            // ----------------------------------------------------------------
            case CMD_SET_SYSTEM_TIME:
                    commandMessage = "System time synchronized successfully - RTC synchronized";
                    Log.d(TAG, "✅ Set System Time command successful - RTC synchronized");
                    
                    // Mark response received and cancel timeout timer
                    setTimeResponseReceived.put(deviceData.deviceId, true);
                    ScheduledFuture<?> timeoutTimer = setTimeTimeoutTimers.remove(deviceData.deviceId);
                    if (timeoutTimer != null) {
                        timeoutTimer.cancel(false);
                    }
                    
                    // Update sync state and clear retry counter
                    dataSyncState.put(deviceData.deviceId, "time_synced");
                    setTimeRetryAttempts.remove(deviceData.deviceId);
                    
                    // CORRECT FLOW (SDD v1.5): Notifications are already enabled
                    // After successful time sync, proceed directly to data sync
                    sendDataAcquisitionAndLiveNotifications(deviceData.deviceId);
                    break;
            
            // ----------------------------------------------------------------
            // SET_ADV_INTERVAL: Advertising interval configuration
            // ----------------------------------------------------------------
            case CMD_SET_ADV_INTERVAL:
                commandMessage = "Advertising interval updated";
                break;
            
            // ----------------------------------------------------------------
            // SET_CONN_INTERVAL: Connection interval configuration
            // ----------------------------------------------------------------
            case CMD_SET_CONN_INTERVAL:
                commandMessage = "Connection interval updated";
                break;
            
            // ----------------------------------------------------------------
            // SET_DATA_INTERVAL: Data acquisition interval configuration
            // ----------------------------------------------------------------
            case CMD_SET_DATA_INTERVAL:
                commandMessage = "Data acquisition interval updated";
                
                // Retrieve and validate requested interval
                Integer requestedInterval = requestedDataAcquisitionIntervals.get(deviceData.deviceId);
                if (requestedInterval != null) {
                    int actualInterval = Math.max(30, requestedInterval);  // Minimum 30 seconds
                    requestedDataAcquisitionIntervals.remove(deviceData.deviceId);
                }
                break;
            // ----------------------------------------------------------------
            // DATA_SYNC_START: Initiate historical data transfer
            // ----------------------------------------------------------------
            case CMD_DATA_SYNC_START:
                if (responseStatus == 0x00) {
                    // Success: Device accepted sync request
                    commandMessage = "Data sync initiated";
                    dataSyncState.put(deviceData.deviceId, "syncing");
                    dataSyncRequested.put(deviceData.deviceId, true);
                    dataSyncRetryCount.remove(deviceData.deviceId);  // Clear retry counter
                } else {
                    // Failure: Device rejected sync request
                    Log.w(TAG, "❌ Data Sync Start failed (Status: 0x" + String.format("%02X", responseStatus) + ")");
                    Log.w(TAG, "   Possible reasons:");
                    Log.w(TAG, "   1. Device RTC not synchronized yet (needs more time)");
                    Log.w(TAG, "   2. Device flash not ready for read operations");
                    Log.w(TAG, "   3. Device has no data to sync (expected if new device)");
                    
                    // Retry up to 3 times with longer delays
                    int retryCount = dataSyncRetryCount.getOrDefault(deviceData.deviceId, 0);
                    if (retryCount < 3) {
                        Log.d(TAG, "🔄 Will retry data sync (attempt " + (retryCount + 1) + "/3) after longer delay...");
                        commandMessage = "Data sync failed - retrying with longer delay...";
                        retryDataSyncStart(deviceData.deviceId);
                    } else {
                        Log.w(TAG, "❌ Max retries reached. Device may not have data or RTC issue persists.");
                        commandMessage = "Data sync failed - max retries reached";
                        dataSyncState.put(deviceData.deviceId, "failed");
                        dataSyncRetryCount.remove(deviceData.deviceId);
                    }
                }
                break;
            
            // ----------------------------------------------------------------
            // DATA_SYNC_STOP: Terminate data transfer and clear device flash
            // ----------------------------------------------------------------
            case CMD_DATA_SYNC_STOP:
                if (responseStatus == 0x00) {
                    commandMessage = "Data sync stopped and flash cleared";
                } else {
                    // Non-zero status may be normal for some firmware versions
                    Log.w(TAG, "⚠️ Data Sync Stop returned status: 0x" + String.format("%02X", responseStatus));
                    Log.w(TAG, "   This is expected if device auto-clears flash or doesn't support this command");
                    Log.w(TAG, "   Device may handle flash management automatically");
                    commandMessage = "Data sync stop acknowledged (device manages flash)";
                }
                break;
            case CMD_GET_DIAGNOSTICS:
                if (responseLength > 0) {                } else {                }
                break;
            case CMD_GET_FW_VERSION:
                if (responseLength > 0) {                } else {                }
                break;
            case CMD_GET_HW_VERSION:
                if (responseLength > 0) {                } else {                }
                break;
            case CMD_SYSTEM_RESTART:                commandMessage = "Device restarting";
                break;
            case CMD_TOGGLE_BUZZER:                commandMessage = "Buzzer state changed";
                break;
            // ----------------------------------------------------------------
            // UNPAIR_DEVICE: Remove device bonding and forget device
            // ----------------------------------------------------------------
            case CMD_UNPAIR_DEVICE:
                if (responseStatus == STATUS_SUCCESS) {
                    commandMessage = "Device unpaired successfully";
                    final String deviceIdToUnpair = deviceData.deviceId;
                    
                    // Disable all characteristic notifications before disconnecting
                    BluetoothGatt gattForUnpair = connectedGatts.get(deviceIdToUnpair);
                    if (gattForUnpair != null) {
                        List<BluetoothGattService> services = gattForUnpair.getServices();
                        if (services != null) {
                            for (BluetoothGattService service : services) {
                                List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                                if (characteristics != null) {
                                    for (BluetoothGattCharacteristic characteristic : characteristics) {
                                        if (characteristic != null) {
                                            gattForUnpair.setCharacteristicNotification(characteristic, false);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // Clean up all device state and timers
                    dataSyncState.remove(deviceIdToUnpair);
                    dataSyncRetryCount.remove(deviceIdToUnpair);
                    ScheduledFuture<?> syncTimer = dataSyncTimers.remove(deviceIdToUnpair);
                    if (syncTimer != null) {
                        syncTimer.cancel(false);
                    }
                    cleanupDeviceResources(deviceIdToUnpair);
                    
                    // Move device from bonded to forgotten list
                    bondedDeviceIds.remove(deviceIdToUnpair);
                    forgottenDeviceIds.add(deviceIdToUnpair);
                    saveBondedDevices();
                    saveForgottenDevices();
                    BluetoothGatt gatt = connectedGatts.get(deviceIdToUnpair);
                    boolean isAlreadyDisconnected = (gatt == null);
                    if (isAlreadyDisconnected) {
                        try {
                            if (bluetoothAdapter != null && ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                                BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceIdToUnpair);
                                if (device != null) {
                                    java.lang.reflect.Method removeBondMethod = device.getClass().getMethod("removeBond");
                                    boolean removeBondResult = (Boolean) removeBondMethod.invoke(device);
                                    if (removeBondResult) {
                                    } else {
                                        Log.w(TAG, "⚠️ [UNPAIR] removeBond() returned false for: " + deviceIdToUnpair + " - device may already be unbonded");
                                    }
                                }
                            }
                        } catch (Exception e) {
                            Log.w(TAG, "⚠️ [UNPAIR] Could not remove bond from Android system: " + e.getMessage());
                        }
                    } else {
                        devicesPendingUnbond.add(deviceIdToUnpair);
                    }
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            BluetoothGatt gatt = connectedGatts.get(deviceIdToUnpair);
                            if (gatt != null) {
                                gatt.disconnect();
                            }
                            devicesWaitingForBonding.remove(deviceIdToUnpair);
                            pairingVerificationTimers.remove(deviceIdToUnpair);
                            devicesPendingPairingVerification.remove(deviceIdToUnpair);
                            WritableMap disconnectInfo = Arguments.createMap();
                            disconnectInfo.putString("deviceId", deviceIdToUnpair);
                            disconnectInfo.putString("deviceName", deviceData.deviceName != null ? deviceData.deviceName : "Unknown");
                            disconnectInfo.putString("reason", "unpaired");
                            disconnectInfo.putBoolean("unpaired", true);
                            sendEvent("DeviceDisconnected", disconnectInfo);
                            Log.d(TAG, "   💡 Device will need to be manually re-paired if reconnection is desired");
                        }
                    }, 500);
                } else {
                    Log.w(TAG, "❌ Unpair Device command failed");
                }
                break;
            case CMD_FACTORY_RESET:
                if (responseStatus == STATUS_SUCCESS) {                    commandMessage = "Device reset to factory settings";
                    final String deviceIdToCleanup = deviceData.deviceId;
                    bondedDeviceIds.remove(deviceIdToCleanup);
                    forgottenDeviceIds.add(deviceIdToCleanup);
                    saveBondedDevices();
                    saveForgottenDevices();
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            BluetoothGatt gattForFactoryReset = connectedGatts.get(deviceIdToCleanup);
                            if (gattForFactoryReset != null) {
                                List<BluetoothGattService> services = gattForFactoryReset.getServices();
                                if (services != null) {
                                    for (BluetoothGattService service : services) {
                                        List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                                        if (characteristics != null) {
                                            for (BluetoothGattCharacteristic characteristic : characteristics) {
                                                if (characteristic != null) {
                                                    gattForFactoryReset.setCharacteristicNotification(characteristic, false);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                            dataSyncState.remove(deviceIdToCleanup);
                            dataSyncRetryCount.remove(deviceIdToCleanup);
                            ScheduledFuture<?> syncTimer = dataSyncTimers.remove(deviceIdToCleanup);
                            if (syncTimer != null) {
                                syncTimer.cancel(false);
                            }
                            cleanupDeviceResources(deviceIdToCleanup);
                            BluetoothGatt gatt = connectedGatts.get(deviceIdToCleanup);
                            if (gatt != null) {
                                gatt.disconnect();
                                gatt.close();
                                connectedGatts.remove(deviceIdToCleanup);
                            }
                            WritableMap disconnectInfo = Arguments.createMap();
                            disconnectInfo.putString("deviceId", deviceIdToCleanup);
                            disconnectInfo.putString("deviceName", deviceData.deviceName != null ? deviceData.deviceName : "Unknown");
                            disconnectInfo.putString("reason", "factory_reset");
                            disconnectInfo.putBoolean("factory_reset", true);
                            sendEvent("DeviceDisconnected", disconnectInfo);
                            Log.d(TAG, "   💡 Device will need to be manually re-paired if reconnection is desired");
                        }
                    }, 500);
                } else {
                    Log.w(TAG, "❌ Factory Reset command failed");
                }
                break;
            case CMD_PASSKEY_UPDATE:
                if (responseStatus == STATUS_SUCCESS) {                    final String deviceIdToRepair = deviceData.deviceId;
                    commandMessage = "Pairing passkey updated successfully - device will disconnect for re-pairing";
                    String newPasskey = pendingPasskeyUpdates.get(deviceIdToRepair);
                    if (newPasskey != null && newPasskey.length() == 6) {
                        devicePasskeys.put(deviceIdToRepair, newPasskey);
                        saveDevicePasskeys();
                        pendingPasskeyUpdates.remove(deviceIdToRepair);
                    } else {
                        Log.w(TAG, "⚠️ [PASSKEY UPDATE] No passkey found in pending updates for device " + deviceIdToRepair);
                    }
                    boolean wasInBondedList = bondedDeviceIds.contains(deviceIdToRepair);
                    bondedDeviceIds.remove(deviceIdToRepair);
                    saveBondedDevices();
                    if (wasInBondedList) {
                    }
                    BluetoothGatt gatt = connectedGatts.get(deviceIdToRepair);
                    if (gatt == null) {
                        Log.d(TAG, "   ✅ Bonding cleared - ready for re-pairing with new passkey");                        Log.d(TAG, "   If reconnection fails, user must FORGET device from Android Bluetooth settings:");
                    } else {
                        BluetoothGatt gattForPasskey = connectedGatts.get(deviceIdToRepair);
                        if (gattForPasskey != null) {
                            List<BluetoothGattService> services = gattForPasskey.getServices();
                            if (services != null) {
                                for (BluetoothGattService service : services) {
                                    List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                                    if (characteristics != null) {
                                        for (BluetoothGattCharacteristic characteristic : characteristics) {
                                            if (characteristic != null) {
                                                gattForPasskey.setCharacteristicNotification(characteristic, false);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        dataSyncState.remove(deviceIdToRepair);
                        dataSyncRetryCount.remove(deviceIdToRepair);
                        ScheduledFuture<?> syncTimer = dataSyncTimers.remove(deviceIdToRepair);
                        if (syncTimer != null) {
                            syncTimer.cancel(false);
                        }
                    cleanupDeviceResources(deviceIdToRepair);
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            BluetoothGatt finalGatt = connectedGatts.get(deviceIdToRepair);
                            if (finalGatt != null) {
                                finalGatt.disconnect();
                                finalGatt.close();
                                connectedGatts.remove(deviceIdToRepair);
                            }
                            devicesWaitingForBonding.remove(deviceIdToRepair);
                            pairingVerificationTimers.remove(deviceIdToRepair);
                            devicesPendingPairingVerification.remove(deviceIdToRepair);
                            WritableMap disconnectInfo = Arguments.createMap();
                            disconnectInfo.putString("deviceId", deviceIdToRepair);
                            disconnectInfo.putString("deviceName", deviceData.deviceName != null ? deviceData.deviceName : "Unknown");
                            disconnectInfo.putString("reason", "passkey_changed");
                            disconnectInfo.putBoolean("passkeyChanged", true);
                            disconnectInfo.putBoolean("requiresRepairing", true);
                            sendEvent("DeviceDisconnected", disconnectInfo);
                            Log.d(TAG, "   💡 User must manually reconnect and enter NEW passkey to pair");
                        }
                    }, 500);
                    }
                } else {
                    Log.w(TAG, "❌ Passkey Update command failed");
                }
                break;
            default:
                break;
        }
        byte[] responseData = null;
        String firmwareVersion = null;
        String hardwareVersion = null;
        Integer batteryLevel = null;
        if (responseLength > 0) {
            responseData = new byte[responseLength];
            buffer.get(responseData);
            switch (commandId) {
                case CMD_GET_FW_VERSION:
                    if (responseData.length > 0) {
                        try {
                            firmwareVersion = new String(responseData, "UTF-8");
                            Log.d(TAG, "✅ Firmware Version: " + firmwareVersion);
                        } catch (Exception e) {
                            Log.e(TAG, "❌ Failed to parse firmware version: " + e.getMessage());
                            firmwareVersion = "Unknown";
                        }
                    }
                    break;
                case CMD_GET_HW_VERSION:
                    if (responseData.length > 0) {
                        try {
                            hardwareVersion = new String(responseData, "UTF-8");
                            Log.d(TAG, "✅ Hardware Version: " + hardwareVersion);
                        } catch (Exception e) {
                            Log.e(TAG, "❌ Failed to parse hardware version: " + e.getMessage());
                            hardwareVersion = "Unknown";
                        }
                    }
                    break;
                case CMD_GET_DIAGNOSTICS:
                    if (responseData.length >= 1) {
                        batteryLevel = responseData[0] & 0xFF;                        if (batteryLevel > 0 && batteryLevel <= 100) {
                            WritableMap deviceDataUpdateEvent = Arguments.createMap();
                            deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
                            deviceDataUpdateEvent.putString("type", "diagnostics");
                            WritableMap deviceDataMapForEvent = Arguments.createMap();
                            deviceDataMapForEvent.putInt("batteryLevel", batteryLevel);
                            deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
                            sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
                        }
                    }
                    break;
            }
        } else {
            responseData = new byte[0]; 
        }
        byte[] fullResponse = new byte[4 + responseLength];
        fullResponse[0] = responseId;
        fullResponse[1] = commandId;
        fullResponse[2] = responseLength;
        fullResponse[3] = responseStatus;
        if (responseLength > 0) {
            System.arraycopy(responseData, 0, fullResponse, 4, responseLength);
        }
        WritableMap systemResponseData = Arguments.createMap();
        systemResponseData.putString("type", "system_command_response");
        systemResponseData.putString("deviceId", deviceData.deviceId);
        systemResponseData.putInt("commandId", commandId);
        systemResponseData.putString("commandName", getCommandName(commandId));
        systemResponseData.putString("rawData", bytesToHex(fullResponse)); 
        systemResponseData.putInt("dataLength", responseData.length);
        systemResponseData.putInt("responseStatus", responseStatus);
        systemResponseData.putInt("status", responseStatus);
        if (commandMessage != null) {
            systemResponseData.putString("message", commandMessage);
        }
        if (firmwareVersion != null) {
            systemResponseData.putString("firmwareVersion", firmwareVersion);
        }
        if (hardwareVersion != null) {
            systemResponseData.putString("hardwareVersion", hardwareVersion);
        }
        if (batteryLevel != null) {
            systemResponseData.putInt("batteryLevel", batteryLevel);
        }
        final WritableMap finalResponseData = systemResponseData;
        mainHandler.post(new Runnable() {
            @Override
            public void run() {
                sendEvent("SystemCommandResponse", finalResponseData);
            }
        });
    }
    // ============================================================================
    // DATA MAPPING & EVENT EMISSION
    // ============================================================================
    
    /**
     * Create service info map for React Native event emission
     * 
     * Purpose:
     * - Formats device services and characteristics for JavaScript layer
     * - Used for "ServicesDiscovered" event
     * - Includes service UUIDs, types, and characteristic properties
     * 
     * Data Structure:
     * - deviceId: Device MAC address
     * - deviceName: Human-readable device name
     * - isSmartTag: Whether device is a Smart Health Tag
     * - connectionState: Current connection state
     * - services: Array of service objects with characteristics
     * 
     * Characteristic Properties:
     * - isReadable: Supports read operations
     * - isWritable: Supports write operations
     * - isNotifiable: Supports notifications
     * 
     * @param deviceData Device data object containing services and characteristics
     * @return WritableMap formatted for React Native bridge
     */
    private WritableMap createServiceInfoMap(DeviceData deviceData) {
        WritableMap map = Arguments.createMap();
        
        // Add device identification
        map.putString("deviceId", deviceData.deviceId);
        map.putString("deviceName", deviceData.deviceName);
        map.putBoolean("isSmartTag", deviceData.isSmartTag);
        map.putString("connectionState", deviceData.connectionState);
        
        // Build services array
        WritableArray servicesArray = Arguments.createArray();
        for (String serviceUuid : deviceData.services.keySet()) {
            BluetoothGattService service = deviceData.services.get(serviceUuid);
            if (service != null) {
                WritableMap serviceMap = Arguments.createMap();
                serviceMap.putString("uuid", serviceUuid);
                serviceMap.putBoolean("isPrimary", service.getType() == BluetoothGattService.SERVICE_TYPE_PRIMARY);
                
                // Build characteristics array for this service
                WritableArray characteristicsArray = Arguments.createArray();
                List<BluetoothGattCharacteristic> characteristics = service.getCharacteristics();
                for (BluetoothGattCharacteristic characteristic : characteristics) {
                    WritableMap charMap = Arguments.createMap();
                    charMap.putString("uuid", characteristic.getUuid().toString());
                    
                    // Extract characteristic properties (read, write, notify)
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
    /**
     * Create comprehensive device info map for React Native event emission
     * 
     * Purpose:
     * - Formats complete device data for JavaScript layer
     * - Used for all device-related events (connection, disconnection, updates, etc.)
     * - Includes health data, connection state, and service information
     * 
     * Data Structure:
     * - deviceId: Device MAC address
     * - deviceName: Human-readable device name
     * - rssi: Signal strength in dBm (-90 to 0)
     * - isSmartTag: Whether device is a Smart Health Tag
     * - connectionState: "connected", "connecting", "disconnected"
     * - batteryLevel: Battery percentage (0-100) or null
     * - temperature: Temperature in Celsius
     * - steps: Step count
     * - timestamp: Last update timestamp in milliseconds
     * - services: Array of discovered BLE services
     * 
     * Note: Data availability depends on connection state and device capabilities
     * 
     * @param deviceData Device data object containing all device information
     * @return WritableMap formatted for React Native bridge
     */
    private WritableMap createDeviceInfoMap(DeviceData deviceData) {
        WritableMap map = Arguments.createMap();
        
        // Basic device identification
        map.putString("deviceId", deviceData.deviceId);
        map.putString("deviceName", deviceData.deviceName);
        map.putInt("rssi", deviceData.rssi);
        map.putBoolean("isSmartTag", deviceData.isSmartTag);
        map.putString("connectionState", deviceData.connectionState);
        
        // Health data (available for both connected and disconnected states)
        boolean isConnected = "connected".equals(deviceData.connectionState);
        
        // Battery level (may be null if not yet read)
        if (deviceData.batteryLevel != null) {
            map.putInt("batteryLevel", deviceData.batteryLevel);
        } else {
            map.putNull("batteryLevel");
        }
        
        // Health metrics (send null for uninitialized values to avoid 0.0°C display)
        if (deviceData.temperature > 0) {
            map.putDouble("temperature", deviceData.temperature);
        } else {
            map.putNull("temperature");
        }
        map.putInt("steps", deviceData.steps);
        map.putDouble("timestamp", deviceData.timestamp * 1000.0);  // Convert to milliseconds
        WritableArray servicesArray = Arguments.createArray();
        for (String serviceUuid : deviceData.services.keySet()) {
            BluetoothGattService service = deviceData.services.get(serviceUuid);
            if (service != null) {
                WritableMap serviceMap = Arguments.createMap();
                serviceMap.putString("uuid", serviceUuid);
                serviceMap.putBoolean("isPrimary", service.getType() == BluetoothGattService.SERVICE_TYPE_PRIMARY);
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
        StringBuilder json = new StringBuilder("{");
        json.append("}");
        return json.toString();
    }
    private boolean isStandardBLECharacteristic(String characteristicUuid) {
        return characteristicUuid.equals("00002a19-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a29-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a24-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a26-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a25-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a27-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a28-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a23-0000-1000-8000-00805f9b34fb") || 
               characteristicUuid.equals("00002a2a-0000-1000-8000-00805f9b34fb");   
    }
    private void sendEvent(String eventName, WritableMap params) {
        getReactApplicationContext()
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
            .emit(eventName, params);
    }
    @ReactMethod
    public void triggerHealthDataApiCall(String deviceId, Promise promise) {
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
            WritableMap deviceDataMap = createDeviceInfoMap(deviceData);
            sendHealthDataApiEvent(deviceId, deviceDataMap);
            promise.resolve(true);        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to trigger health data API call", e);
            promise.reject("API_TRIGGER_FAILED", "Failed to trigger health data API call: " + e.getMessage());
        }
    }
    private void sendHealthDataApiEvent(String deviceId, WritableMap deviceData) {
        WritableMap eventData = Arguments.createMap();
        eventData.putString("deviceId", deviceId);
        eventData.putMap("deviceData", deviceData);
        eventData.putString("timestamp", String.valueOf(System.currentTimeMillis()));
        sendEvent("HealthDataApiRequest", eventData);
    }
    private void rejectWithBLEError(Promise promise, BLEError bleError) {
        Log.e(TAG, "BLE Error: " + bleError.toString());
        promise.reject(bleError.errorCode.name(), bleError.toJSString());
    }
    private void handleBLEError(String deviceId, BLEError error, Runnable retryOperation) {
        BLEError.ErrorType errorType = error.getErrorType();
        switch (errorType) {
            case TRANSIENT:
                if (retryOperation != null) {
                    Log.d(TAG, "🔄 Scheduling automatic retry for transient error: " + error.errorCode.name());
                    executeOnBLEThread(() -> {
                        try {
                            Thread.sleep(1000); 
                            retryOperation.run();
                        } catch (InterruptedException e) {
                            Log.e(TAG, "❌ Retry interrupted: " + e.getMessage());
                        }
                    });
                }
                break;
            case PERMANENT:
                Log.w(TAG, "🛑 Permanent error - no retry: " + error.errorCode.name());
                break;
            case USER_ACTION:
                Log.w(TAG, "👤 User action required - no automatic retry: " + error.errorCode.name());
                break;
        }
    }
    private void rejectWithContext(Promise promise, String errorCode, String message, String deviceId, String characteristicUuid) {
        BLEError bleError = new BLEError(BLEError.ErrorCode.UNKNOWN_ERROR, message, 
                                       "Operation failed", deviceId, null, characteristicUuid);
        rejectWithBLEError(promise, bleError);
    }
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
    private boolean validateDeviceConnection(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.d(TAG, "🔍 Device not in connected GATT map: " + deviceId);
            return false;
        }
        BluetoothDevice device = gatt.getDevice();
        if (device == null) {
            return false;
        }
        boolean hasCharacteristics = false;
        for (String key : deviceCharacteristics.keySet()) {
            if (key.startsWith(deviceId + "_")) {
                hasCharacteristics = true;
                break;
            }
        }
        if (!hasCharacteristics) {
            return false;
        }
        Log.d(TAG, "✅ Device connection validated: " + deviceId);
        return true;
    }
    private boolean isForegroundServiceActuallyRunning() {
        try {
            ActivityManager manager = (ActivityManager) getReactApplicationContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (manager != null) {
                for (ActivityManager.RunningServiceInfo service : manager.getRunningServices(Integer.MAX_VALUE)) {
                    if (BLEForegroundService.class.getName().equals(service.service.getClassName())) {                        return true;
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking if service is running: " + e.getMessage());
        }
        return false;
    }
    // ============================================================================
    // FOREGROUND SERVICE MANAGEMENT (Android 8+ Requirement)
    // ============================================================================
    
    /**
     * Start and bind to foreground service for background BLE operations
     * 
     * Purpose:
     * - Android 8+ requires foreground service for background BLE operations
     * - Foreground service displays persistent notification to user
     * - Prevents Android from killing BLE connections when app is backgrounded
     * 
     * Service Lifecycle:
     * 1. Check if service is already running (avoid duplicate starts)
     * 2. If running but not bound, rebind to existing service
     * 3. If not running, start new service and bind to it
     * 4. Update connection manager with service reference
     * 
     * Android Requirements:
     * - Foreground service must display notification (BLEForegroundService handles this)
     * - Requires FOREGROUND_SERVICE permission in manifest
     * - On Android 9+, requires FOREGROUND_SERVICE_LOCATION permission for BLE
     * 
     * @see BLEForegroundService Service implementation with notification
     * @see #isForegroundServiceActuallyRunning() Verifies service is running in system
     */
    private void startForegroundService() {
        // Check if service is actually running (via ActivityManager)
        boolean serviceActuallyRunning = isForegroundServiceActuallyRunning();
        
        // Service already running and bound - nothing to do
        if (isServiceRunning && bleService != null) {
            return;
        }
        
        // Service running but not bound - rebind to existing service
        if (serviceActuallyRunning && (bleService == null || !isServiceRunning)) {
            Intent bindIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
            boolean bindResult = getReactApplicationContext().bindService(bindIntent, new android.content.ServiceConnection() {
                @Override
                public void onServiceConnected(android.content.ComponentName name, IBinder service) {
                    // Retrieve service instance via binder
                    BLEForegroundService.LocalBinder binder = (BLEForegroundService.LocalBinder) service;
                    bleService = binder.getService();
                    
                    // Update connection manager reference
                    connectionManager.setForegroundService(bleService);
                    isServiceRunning = true;
                    Log.d(TAG, "  Connection manager updated: " + (connectionManager != null ? "YES" : "NO"));
                }
                
                @Override
                public void onServiceDisconnected(android.content.ComponentName name) {
                    // Service crashed or was killed - clean up references
                    bleService = null;
                    connectionManager.setForegroundService(null);
                    isServiceRunning = false;
                }
            }, Context.BIND_AUTO_CREATE);
            
            if (!bindResult) {
                Log.e(TAG, "❌ Failed to rebind to foreground service");
            } else {            }
            return;
        }
        Intent serviceIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
        getReactApplicationContext().startForegroundService(serviceIntent);
        Intent bindIntent = new Intent(getReactApplicationContext(), BLEForegroundService.class);
        boolean bindResult = getReactApplicationContext().bindService(bindIntent, new android.content.ServiceConnection() {
            @Override
            public void onServiceConnected(android.content.ComponentName name, IBinder service) {
                BLEForegroundService.LocalBinder binder = (BLEForegroundService.LocalBinder) service;
                bleService = binder.getService();
                connectionManager.setForegroundService(bleService);
                isServiceRunning = true;            }
            @Override
            public void onServiceDisconnected(android.content.ComponentName name) {
                bleService = null;
                connectionManager.setForegroundService(null);
                isServiceRunning = false;            }
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
        try {
            if (connectionManager != null) {
                connectionManager.connectToBondedDevices();
            }        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to schedule background work", e);
        }
    }
    public void startBackgroundScan() {
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
                    }
                    @Override
                    public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                    }
                    @Override
                    public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                    }
                });
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to connect to device in background", e);
        }
    }
    private void startAutoConnectToBondedDevices() {        try {
            if (!checkBluetoothEnabled() || !checkPermissions()) {
                Log.e(TAG, "❌ Cannot start auto-connect: Bluetooth disabled or permissions missing");
                return;
            }
            Log.d(TAG, "📋 Auto-connecting to " + bondedDeviceIds.size() + " bonded devices");
            cleanupStaleGattConnections();
            querySystemConnectedDevices();
            startScanningForBondedDevices();
            mainHandler.postDelayed(() -> {
                executorService.execute(() -> {
                    for (String deviceId : bondedDeviceIds) {
                        if (connectedGatts.containsKey(deviceId)) {
                            Log.d(TAG, "⏭️ Device already connected from system query: " + deviceId);
                            continue;
                        }
                        BluetoothDevice device = bondedDevices.get(deviceId);
                        if (device != null) {
                            Log.d(TAG, "🔗 Attempting direct connection to bonded device: " + deviceId);
                            connectToDeviceDirect(deviceId, device);
                        }
                    }
                });
            }, 300); 
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start auto-connect to bonded devices", e);
        }
    }
    private void cleanupStaleGattConnections() {        try {
            BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
            if (bluetoothManager == null) {
                Log.w(TAG, "⚠️ BluetoothManager is null - cannot check connection states");
                return;
            }
            synchronized(gattLock) {
                for (String deviceId : bondedDeviceIds) {
                    BluetoothDevice device = bondedDevices.get(deviceId);
                    if (device == null) continue;
                    int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                    if (connectionState == BluetoothProfile.STATE_DISCONNECTED) {
                        BluetoothGatt staleGatt = connectedGatts.get(deviceId);
                        if (staleGatt != null) {
                            Log.d(TAG, "🧹 Found stale GATT connection for " + deviceId + " - cleaning up");
                            try {
                                staleGatt.disconnect();
                                staleGatt.close();
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error cleaning up stale GATT for " + deviceId + ": " + e.getMessage());
                            }
                            connectedGatts.remove(deviceId);
                            connectingDevices.remove(deviceId);
                        }
                    } else if (connectionState == BluetoothProfile.STATE_CONNECTING) {
                        Log.d(TAG, "🧹 System shows device " + deviceId + " is connecting - clearing stale tracking");
                        connectingDevices.remove(deviceId);
                    }
                }
            }        } catch (Exception e) {
            Log.e(TAG, "❌ Error during stale GATT cleanup: " + e.getMessage());
        }
    }
    private void connectToDeviceDirect(String deviceId, BluetoothDevice device) {
        Log.d(TAG, "🔗 Direct connection attempt to: " + deviceId);
        try {
            if (connectedGatts.containsKey(deviceId)) {
                Log.d(TAG, "✅ Device already connected: " + deviceId);
                return;
            }
            if (connectingDevices.contains(deviceId)) {                return;
            }
            connectingDevices.add(deviceId);
            deviceConnectionType.put(deviceId, true); 
            boolean wasAlreadyBonded = device.getBondState() == BluetoothDevice.BOND_BONDED;
            deviceWasAlreadyBonded.put(deviceId, wasAlreadyBonded);
            Log.d(TAG, "📝 Stored connection metadata (direct/auto) - WasAlreadyBonded: " + wasAlreadyBonded);
            BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                false, 
                new BluetoothGattCallback() {
                    @Override
                    public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "🔗 Direct connection state change: " + deviceId + " - Status: " + status + " - New State: " + newState);
                        if (newState == BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "✅ Direct connection successful: " + deviceId);
                            connectingDevices.remove(deviceId);
                            synchronized(gattLock) {
                                connectedGatts.put(deviceId, gatt);
                            }
                            requestConnectionParameters(gatt, deviceId);
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData == null) {
                                String deviceName = gatt.getDevice().getName();
                                if (deviceName == null || deviceName.isEmpty()) {
                                    deviceName = getDeviceName(deviceId); 
                                    if (deviceName == null || deviceName.isEmpty()) {
                                        deviceName = "Unknown Device";
                                    }
                                }
                                deviceData = new DeviceData(deviceId, deviceName);
                                deviceDataMap.put(deviceId, deviceData);
                                Log.d(TAG, "✅ Created DeviceData for auto-connected device: " + deviceId + " (" + deviceName + ")");
                            }
                            Log.d(TAG, "📡 Auto-connect: Reading RSSI immediately for: " + deviceId);
                            boolean rssiReadInitiated = gatt.readRemoteRssi();
                            if (!rssiReadInitiated) {
                                Log.w(TAG, "⚠️ Failed to initiate RSSI read for auto-connected device: " + deviceId);
                            }
                            // Industry best practice: Don't mark as "connected" or emit AutoConnectDeviceConnected here
                            // Wait for SECURE_READY state - device is still in CONNECTED_LOW_LEVEL state
                            deviceData.connectionState = "connecting"; // Still completing setup
                            gatt.discoverServices();
                            startRSSIMonitoringForDevice(deviceId);
                            startHealthDataApiMonitoringForDevice(deviceId);
                        } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                            Log.d(TAG, "❌ Direct connection failed: " + deviceId + " - Status: " + status);
                            if (status == 133) {
                                int bondState = device.getBondState();
                                if (bondState == BluetoothDevice.BOND_BONDED) {
                                    try {
                                        if (gatt != null) {
                                            gatt.disconnect();
                                            gatt.close();
                                        }
                                    } catch (Exception e) {
                                        Log.e(TAG, "❌ Error closing failed GATT: " + e.getMessage());
                                    }
                                    connectingDevices.remove(deviceId);
                                    connectedGatts.remove(deviceId);
                                    mainHandler.postDelayed(() -> {
                                        if (bondedDeviceIds.contains(deviceId)) {
                                            BluetoothDevice retryDevice = bondedDevices.get(deviceId);
                                            if (retryDevice != null && !connectingDevices.contains(deviceId)) {
                                                connectToDeviceDirect(deviceId, retryDevice);
                                            } else {
                                            }
                                        } else {
                                        }
                                    }, 800); 
                                    return; 
                                } else {
                                }
                            }
                            connectingDevices.remove(deviceId);
                            connectedGatts.remove(deviceId);
                            cleanupDeviceResources(deviceId);
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.connectionState = "disconnected";
                                sendEvent("AutoConnectDeviceDisconnected", createDeviceInfoMap(deviceData));
                            }
                        }
                    }
                    @Override
                    public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        Log.d(TAG, "✅ Services discovered for direct connection: " + deviceId);
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            synchronized(gattLock) {
                                connectedGatts.put(deviceId, gatt);
                            }
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
                            handleCharacteristicData(deviceId, characteristic);
                        } else {
                            Log.e(TAG, "❌ Characteristic read failed for direct connection: " + characteristicUuid + " - Status: " + status);
                        }
                    }
                    @Override
                    public void onCharacteristicWrite(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                        Log.d(TAG, "✍️ Characteristic write for direct connection: " + characteristic.getUuid());
                    }
                    @Override
                    public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                        String deviceId = gatt.getDevice().getAddress();
                        String characteristicUuid = characteristic.getUuid().toString();
                        Log.d(TAG, "📡 Characteristic changed for direct connection: " + characteristicUuid + " on device " + deviceId);
                        handleCharacteristicData(deviceId, characteristic);
                        byte[] data = characteristic.getValue();
                        if (data != null && data.length > 0) {
                            String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                            WritableMap eventData = Arguments.createMap();
                            eventData.putString("deviceId", deviceId);
                            eventData.putString("characteristicUuid", characteristicUuid); 
                            eventData.putString("data", base64Data); 
                            sendEvent("CharacteristicData", eventData);
                        }
                    }
                    @Override
                    public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        String descriptorUuid = descriptor.getUuid().toString();
                        String characteristicUuid = descriptor.getCharacteristic().getUuid().toString();
                        onDescriptorWriteComplete(deviceId, descriptor, status);
                        String promiseKey = deviceId + "_" + descriptorUuid;
                        Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
                        if (pendingPromise != null) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {                                pendingPromise.resolve(true);
                            } else {
                                Log.e(TAG, "❌ Rejecting manual descriptor write promise for direct connection");
                                pendingPromise.reject("WRITE_ERROR", "Descriptor write failed with status: " + status);
                            }
                        }
                    }
                    
                    @Override
                    public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                        String deviceId = gatt.getDevice().getAddress();
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "📶 [DIRECT-CONNECT] RSSI read for " + deviceId + ": " + rssi);
                            
                            // Resolve any pending promise
                            Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                            if (pendingPromise != null) {
                                pendingPromise.resolve(rssi);
                            }
                            
                            // Update device data
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                deviceData.rssi = rssi;
                                deviceData.timestamp = System.currentTimeMillis();
                                
                                // Send DeviceDataUpdated event
                                WritableMap deviceDataUpdateEvent = Arguments.createMap();
                                deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
                                deviceDataUpdateEvent.putString("type", "rssi_update");
                                deviceDataUpdateEvent.putInt("rssi", rssi);
                                if (deviceData.batteryLevel != null) {
                                    deviceDataUpdateEvent.putInt("batteryLevel", deviceData.batteryLevel);
                                } else {
                                    deviceDataUpdateEvent.putNull("batteryLevel");
                                }
                                // Send null for uninitialized temperature to avoid 0.0°C display
                                if (deviceData.temperature > 0) {
                                    deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                } else {
                                    deviceDataUpdateEvent.putNull("temperature");
                                }
                                deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                            }
                            
                            // Send RSSIUpdate event
                            WritableMap rssiMap = Arguments.createMap();
                            rssiMap.putString("deviceId", deviceId);
                            rssiMap.putInt("rssi", rssi);
                            rssiMap.putDouble("timestamp", System.currentTimeMillis());
                            sendEvent("RSSIUpdate", rssiMap);
                        } else {
                            Log.e(TAG, "❌ [DIRECT-CONNECT] RSSI read failed for " + deviceId + " with status: " + status);
                        }
                    }
                }
            );
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to create direct connection to: " + deviceId, e);
            connectingDevices.remove(deviceId);
        }
    }
    private void scheduleAutoConnectToBondedDevices() {        try {
            if (connectionManager != null) {
                connectionManager.connectToBondedDevices();
            }        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to schedule auto-connect to bonded devices", e);
        }
    }
    private ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String deviceId = device.getAddress();
            String deviceName = device.getName() != null ? device.getName() : "Unknown Device";
            int rssi = result.getRssi();
            Log.d("SampleBridgeAndroid", "🔍 SCAN CALLBACK: Discovered device: " + deviceName + " (" + deviceId + ") RSSI: " + rssi);
            Log.d("SampleBridgeAndroid", "🔍 Callback type: " + callbackType + ", Scan record: " + (result.getScanRecord() != null ? "present" : "null"));
            if (deviceId.equals("F9:D3:EF:CB:52:1F") || deviceName.contains("8A0CEFED") || deviceName.contains("Health Tag")) {
                if (result.getScanRecord() != null) {
                    android.bluetooth.le.ScanRecord scanRecord = result.getScanRecord();
                    android.util.SparseArray<byte[]> mfgData = scanRecord.getManufacturerSpecificData();
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
                        byte[] ourData = mfgData.get(0x1234);
                    } else {
                        Log.w(TAG, "⚠️ NO MANUFACTURER DATA in scan record!");
                    }
                    byte[] rawBytes = scanRecord.getBytes();
                    if (rawBytes != null) {
                        StringBuilder fullHex = new StringBuilder();
                        for (int i = 0; i < Math.min(rawBytes.length, 62); i++) {
                            fullHex.append(String.format("%02X ", rawBytes[i]));
                        }
                    }
                } else {
                    Log.w(TAG, "⚠️ SCAN RECORD IS NULL!");
                }
            }
            if (deviceName != null && !deviceName.equals("Unknown Device")) {
                saveDeviceName(deviceId, deviceName);
            }
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData == null) {
                deviceData = new DeviceData(deviceId, deviceName);
                deviceDataMap.put(deviceId, deviceData);
            }
            deviceData.rssi = rssi;
            deviceData.timestamp = System.currentTimeMillis();
            if (deviceDataMap.size() > MAX_DEVICE_MAP_SIZE) {
                cleanupStaleDevices();
            }
            boolean isSmartTag = false;
            boolean hasCorrectService = false;
            boolean hasDyreIDName = deviceName.contains("DyreID") || deviceName.contains("Health Tag") || "DyreID".equals(deviceName);
            if (result.getScanRecord() != null) {
                List<ParcelUuid> serviceUuids = result.getScanRecord().getServiceUuids();
                if (serviceUuids != null) {
                    for (ParcelUuid uuid : serviceUuids) {
                        if (SMART_TAG_SERVICE_UUID.equals(uuid.toString())) {
                            hasCorrectService = true;
                            isSmartTag = true;
                            break;
                        }
                    }
                }
            }
            if (hasDyreIDName) {
                isSmartTag = true;
            }
            deviceData.isSmartTag = isSmartTag;
            WritableMap manufacturerInfo = Arguments.createMap();
            boolean hasOurManufacturerData = false;
            if (result.getScanRecord() != null) {
                android.util.SparseArray<byte[]> allManufacturerData = result.getScanRecord().getManufacturerSpecificData();
                if (allManufacturerData.size() > 0) {
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
                byte[] mfgData = result.getScanRecord().getManufacturerSpecificData(0x1234);
                if (mfgData == null && result.getScanRecord().getBytes() != null) {
                    mfgData = parseManufacturerDataFromRawBytes(result.getScanRecord().getBytes(), 0x1234);
                    if (mfgData != null) {                    }
                }
                // Fix: Android's getManufacturerSpecificData() returns data WITHOUT company ID,
                // but parseManufacturerData() expects it WITH company ID (like iOS).
                // Validate first (isValidSmartHealthTagData expects data without company ID),
                // then prepend company ID before parsing.
                if (mfgData != null && mfgData.length >= 11 && isValidSmartHealthTagData(mfgData)) {
                    // Check if company ID is already present (first 2 bytes should be 0x34 0x12 in little-endian)
                    boolean hasCompanyId = mfgData.length >= 2 && 
                                         ((mfgData[1] & 0xFF) << 8 | (mfgData[0] & 0xFF)) == 0x1234;
                    if (!hasCompanyId) {
                        // Prepend company ID (little-endian: 0x34, 0x12)
                        byte[] mfgDataWithId = new byte[mfgData.length + 2];
                        mfgDataWithId[0] = (byte) 0x34;  // Low byte
                        mfgDataWithId[1] = (byte) 0x12;  // High byte
                        System.arraycopy(mfgData, 0, mfgDataWithId, 2, mfgData.length);
                        mfgData = mfgDataWithId;
                        Log.d(TAG, "   ✅ Prepended company ID to manufacturer data (Android API returns data without ID)");
                    }
                    hasOurManufacturerData = true;
                    isSmartTag = true; 
                    deviceData.isSmartTag = true;
                    manufacturerInfo = parseManufacturerData(mfgData);
                    if (!"connected".equals(deviceData.connectionState)) {
                        if (manufacturerInfo.hasKey("batteryLevel")) {
                            deviceData.batteryLevel = manufacturerInfo.getInt("batteryLevel");
                        }
                        if (manufacturerInfo.hasKey("temperature")) {
                            deviceData.temperature = (float) manufacturerInfo.getDouble("temperature");
                        }
                        if (manufacturerInfo.hasKey("steps")) {
                            deviceData.steps = manufacturerInfo.getInt("steps");
                        }
                        deviceData.timestamp = System.currentTimeMillis() / 1000; 
                    }
                    if (manufacturerInfo.hasKey("devicePeripheralStatus")) {
                        int devicePeripheralStatus = manufacturerInfo.getInt("devicePeripheralStatus");
                        if (devicePeripheralStatus != 0) {
                            Log.w(TAG, "⚠️ Device " + deviceName + " reports PROBLEM status in manufacturer data (status=" + devicePeripheralStatus + ")");
                        }
                    }
                    if (manufacturerInfo.hasKey("recordCount")) {
                        int recordCount = manufacturerInfo.getInt("recordCount");
                        deviceRecordCounts.put(deviceId, recordCount);
                        if (recordCount > 0) {
                            WritableMap mfgDataEvent = Arguments.createMap();
                            mfgDataEvent.putString("deviceId", deviceId);
                            mfgDataEvent.putString("type", "manufacturer_data");
                            mfgDataEvent.putInt("companyId", manufacturerInfo.getInt("companyId"));
                            mfgDataEvent.putInt("recordCount", recordCount);
                            mfgDataEvent.putInt("batteryLevel", manufacturerInfo.getInt("batteryLevel"));
                            mfgDataEvent.putInt("batteryMillivolts", manufacturerInfo.getInt("batteryMillivolts"));
                            if (manufacturerInfo.hasKey("devicePeripheralStatus")) {
                                mfgDataEvent.putInt("deviceStatus", manufacturerInfo.getInt("devicePeripheralStatus"));
                            }
                            if (manufacturerInfo.hasKey("connectIndication")) {
                                mfgDataEvent.putBoolean("indication", manufacturerInfo.getBoolean("connectIndication"));
                            }
                            mfgDataEvent.putString("rawData", bytesToHex(mfgData));
                            sendEvent("DataTransfer", mfgDataEvent);
                        }
                    }
                } else if (allManufacturerData.size() > 0) {
                }
            }
            boolean shouldAcceptDevice = false;
            String acceptReason = "";
            if (hasOurManufacturerData) {
                shouldAcceptDevice = true;
                acceptReason = "Valid manufacturer ID (0x1234) with proper data structure";
            } else if (hasCorrectService && hasDyreIDName) {
                shouldAcceptDevice = true;
                acceptReason = "Correct service UUID AND DyreID/Health Tag name";
            } else if (hasDyreIDName && (result.getScanRecord() == null || result.getScanRecord().getServiceUuids() == null || result.getScanRecord().getServiceUuids().isEmpty())) {
                shouldAcceptDevice = true;
                acceptReason = "DyreID/Health Tag name (no service UUIDs advertised)";
            }
            if (!shouldAcceptDevice) {
                return;
            }
            activeScannedDevices.add(deviceId);
            deviceLastSeen.put(deviceId, System.currentTimeMillis());
            Log.d("SampleBridgeAndroid", "📱 Sending device discovery event: " + deviceName + " (" + deviceId + ")");
            WritableMap deviceInfoMap = createDeviceInfoMap(deviceData);
            deviceInfoMap.putMap("manufacturerData", manufacturerInfo);
            deviceInfoMap.putBoolean("hasManufacturerData", hasOurManufacturerData);
            deviceInfoMap.putBoolean("isSmartTag", isSmartTag);
            deviceInfoMap.putBoolean("isBonded", bondedDeviceIds.contains(deviceId));
            sendEvent("DeviceFound", deviceInfoMap);
            boolean isTargetDevice = bondedDevices.containsKey(deviceId);
            if (!isTargetDevice) {            }
            if (isTargetDevice) {
                Log.d("SampleBridgeAndroid", "🎯 TARGET DEVICE FOUND (bonded): " + deviceName + " (" + deviceId + ")");
                if (isScanning.get()) {
                    stopScanning();
                }
                if (!shouldAllowConnection(deviceId, false)) { 
                    Log.d("SampleBridgeAndroid", "🚫 Connection blocked for device: " + deviceName + " - device is forgotten or manually disconnected");
                    return;
                }
                if (autoConnectEnabled.get() && !connectedGatts.containsKey(deviceId)) {
                    Log.d("SampleBridgeAndroid", "🔗 Auto-connecting to bonded device: " + deviceName);
                }
            }
        }
        @Override
        public void onScanFailed(int errorCode) {
            Log.e("SampleBridgeAndroid", "❌ Scan failed with error code: " + errorCode);
            isScanning.set(false);
        }
    };
    @ReactMethod
    public void requestPermissions(Promise promise) {
        try {
            boolean hasPermissions = checkPermissions();
            if (hasPermissions) {
                WritableMap result = Arguments.createMap();
                result.putBoolean("granted", true);
                result.putBoolean("bluetoothEnabled", checkBluetoothEnabled());
                result.putBoolean("permissionsGranted", true);
                promise.resolve(result);
            } else {
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
                    promise.resolve(result); 
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
    public void refreshSystemConnectedDevices(Promise promise) {
        executeOnBLEThread(() -> {
            try {
                int before = connectedGatts.size();
                querySystemConnectedDevices();
                int after = connectedGatts.size();
                int restored = Math.max(0, after - before);
                WritableMap result = Arguments.createMap();
                result.putBoolean("success", true);
                result.putInt("restoredCount", restored);
                promise.resolve(result);
            } catch (Exception e) {
                promise.reject("REFRESH_SYSTEM_CONNECTED_ERROR", e.getMessage());
            }
        });
    }
    @ReactMethod
    public void startScanningWithOptions(ReadableMap options, Promise promise) {
        try {
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.reject("BT_NOT_READY", "Bluetooth not ready");
                return;
            }
            if (isScanning.get()) {
                WritableMap result = Arguments.createMap();
                result.putString("status", "already_scanning");
                promise.resolve(result);
                return;
            }
            Map<String, Object> profileSettings = powerProfiles.get(currentPowerProfile);
            if (profileSettings == null) {
                profileSettings = POWER_PROFILE_DEFAULTS.get("default");
            }
            int maxScanDurationMs = options.hasKey("maxScanDurationMs") ? 
                options.getInt("maxScanDurationMs") : 
                (Integer) profileSettings.get("maxScanDurationMs");
            String scanMode = options.hasKey("scanMode") ? 
                options.getString("scanMode") : 
                (String) profileSettings.get("scanMode");
            boolean allowDuplicates = options.hasKey("allowDuplicates") ? 
                options.getBoolean("allowDuplicates") : 
                true;
            if (bluetoothLeScanner != null && isScanning.get()) {
                try {
                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                        bluetoothLeScanner.stopScan(scanCallback);
                    }
                } catch (Exception e) {
                    Log.w(TAG, "⚠️ Error stopping previous scan: " + e.getMessage());
                }
            }
            ScanSettings.Builder settingsBuilder = new ScanSettings.Builder()
                .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                .setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE)
                .setNumOfMatches(ScanSettings.MATCH_NUM_MAX_ADVERTISEMENT);
            int androidScanMode = getScanModeFromString(scanMode);
            settingsBuilder.setScanMode(androidScanMode);
            settingsBuilder.setReportDelay(0);
            ScanSettings scanSettings = settingsBuilder.build();
            List<ScanFilter> filters = new ArrayList<>();
            ScanFilter.Builder mfgFilter = new ScanFilter.Builder();
            mfgFilter.setManufacturerData(SMART_TAG_MANUFACTURER_ID, null);
            filters.add(mfgFilter.build());
            ScanFilter.Builder serviceFilter = new ScanFilter.Builder();
            serviceFilter.setServiceUuid(ParcelUuid.fromString(SMART_TAG_SERVICE_UUID));
            filters.add(serviceFilter.build());
            Log.d(TAG, "✅ Using " + filters.size() + " scan filters (manufacturer ID + service UUID)");
            try {
                if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                    bluetoothLeScanner.startScan(filters, scanSettings, scanCallback);
                    isScanning.set(true);
                    Log.d(TAG, "✅ Scan started with " + scanMode + " mode");
                    mainHandler.postDelayed(() -> {
                        if (isScanning.get()) {
                            try {
                                if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_SCAN) == PackageManager.PERMISSION_GRANTED) {
                                    bluetoothLeScanner.stopScan(scanCallback);
                                    isScanning.set(false);
                                }
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error auto-stopping scan: " + e.getMessage());
                            }
                        }
                    }, maxScanDurationMs);
                    WritableMap result = Arguments.createMap();
                    result.putString("status", "scanning_started");
                    result.putInt("duration", maxScanDurationMs);
                    result.putString("mode", scanMode);
                    result.putString("powerProfile", currentPowerProfile);
                    boolean isInBackground = !isAppInForeground();
                    result.putBoolean("isBackground", isInBackground);
                    promise.resolve(result);
                } else {
                    promise.reject("PERMISSION_DENIED", "BLUETOOTH_SCAN permission not granted");
                }
            } catch (SecurityException e) {
                promise.reject("PERMISSION_ERROR", "Security exception: " + e.getMessage());
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting scan with options: " + e.getMessage(), e);
            promise.reject("SCAN_ERROR", "Failed to start scan: " + e.getMessage());
        }
    }
    @ReactMethod
    public void startScanning(Promise promise) {
        try {
            WritableMap defaultOptions = Arguments.createMap();
            startScanningWithOptions(defaultOptions, promise);
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
    // ============================================================================
    // DEVICE CONNECTION METHODS (React Native Bridge)
    // ============================================================================
    
    /**
     * Connect to a BLE device with configuration options (called from React Native)
     * 
     * Purpose:
     * - Establishes GATT connection to a previously scanned device
     * - Supports both manual (user-initiated) and auto (background) connections
     * - Handles pairing, bonding, and forgotten device logic
     * - Implements connection timeout and retry mechanisms
     * 
     * Connection Flow:
     * 1. Validate Bluetooth state and permissions
     * 2. Check if device is forgotten (allow manual, block auto)
     * 3. Verify device was previously scanned
     * 4. Check for existing connection
     * 5. Clean up stale GATT connections
     * 6. Queue connection if another is in progress
     * 7. Proceed with GATT connection
     * 
     * Options:
     * - isManualConnection: true for user-initiated, false for auto-connect
     * - connectionIntervalMs: BLE connection interval (default 50ms)
     * - supervisionTimeoutMs: Connection timeout (default 15000ms - industry best practice)
     * 
     * Error Handling:
     * - BT_NOT_READY: Bluetooth disabled or unavailable
     * - DEVICE_FORGOTTEN: Auto-connect blocked for forgotten device
     * - DEVICE_NOT_FOUND: Device not in scan results
     * - CONNECTION_TIMEOUT: Connection exceeded timeout
     * - CONNECTION_ERROR: General connection failure
     * 
     * @param deviceId Device MAC address (e.g., "AA:BB:CC:DD:EE:FF")
     * @param options Connection configuration options
     * @param promise React Native promise to resolve/reject
     */
    @ReactMethod
    public void connectToDeviceWithOptions(String deviceId, ReadableMap options, Promise promise) {
        try {
            // Validate Bluetooth state
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.reject("BT_NOT_READY", "Bluetooth not ready");
                return;
            }
            
            // Parse connection options
            boolean isManualConnection = options.hasKey("isManualConnection") ? 
                options.getBoolean("isManualConnection") : 
                false;
            int connectionIntervalMs = options.hasKey("connectionIntervalMs") ? 
                options.getInt("connectionIntervalMs") : 
                50;  // Default 50ms (balanced latency/power)
            // ✅ FIX: Increased default timeout from 12s to 20s
            // Android BLE connections can take 15-20 seconds especially on first connect when:
            // 1. Service discovery needs to complete
            // 2. Bonding/pairing may be initiated by the device
            // 3. GATT characteristic discovery runs after service discovery
            // The first connection attempt was consistently timing out at 12s
            int supervisionTimeoutMs = options.hasKey("supervisionTimeoutMs") ? 
                options.getInt("supervisionTimeoutMs") : 
                20000;  // Default 20 seconds (was 12s)
            
            Log.d(TAG, "🔗 Connecting to device with options - ID: " + deviceId + ", Manual: " + isManualConnection);
            if (forgottenDeviceIds.contains(deviceId)) {
                if (!isManualConnection) {
                    promise.reject("DEVICE_FORGOTTEN", "Device has been forgotten and cannot be auto-connected");
                    return;
                }
                forgottenDeviceIds.remove(deviceId);
                saveForgottenDevices();
                Log.d(TAG, "🔄 Removed device from forgotten list for manual connection: " + deviceId);
            }
            if (isManualConnection) {
                manualDisconnectInProgress.remove(deviceId);
                Log.d(TAG, "🔄 Cleared manual disconnect tracking for manual connection: " + deviceId);
            }
            DeviceData scannedDevice = deviceDataMap.get(deviceId);
            if (scannedDevice == null) {
                Log.w(TAG, "⚠️ Device not found in scanned devices: " + deviceId);
                Log.w(TAG, "   Device must be scanned first before connecting");
                if (!activeScannedDevices.contains(deviceId)) {
                    promise.reject("DEVICE_NOT_FOUND", "Device not found in scanned devices. Please scan for devices first.");
                    return;
                } else {                    mainHandler.postDelayed(() -> {
                        DeviceData refreshedDevice = deviceDataMap.get(deviceId);
                        if (refreshedDevice == null) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found in scanned devices. Please scan for devices first.");
                        } else {
                            connectToDeviceWithOptions(deviceId, options, promise);
                        }
                    }, 500);
                    return;
                }
            }
            synchronized(gattLock) {
                BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                if (existingGatt != null) {
                    BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                    BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                    int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                    if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                        Log.d(TAG, "✅ Device already connected (verified via BLE Manager): " + deviceId);
                        ensureFullConnectionSetup(deviceId, existingGatt);
                        WritableMap result = Arguments.createMap();
                        result.putString("status", "already_connected");
                        result.putString("deviceId", deviceId);
                        promise.resolve(result);
                        return;
                    }
                }
            }
            String promiseKey = "connect_" + deviceId;
            if (connectingDevices.contains(deviceId)) {
                Log.d(TAG, "✅ Device already connecting: " + deviceId);
                WritableMap result = Arguments.createMap();
                result.putString("status", "already_connecting");
                result.putString("deviceId", deviceId);
                promise.resolve(result);
                return;
            }
            if (devicesWaitingForBonding.containsKey(deviceId)) {
                Log.d(TAG, "✅ Device waiting for bonding: " + deviceId);
                WritableMap result = Arguments.createMap();
                result.putString("status", "already_connecting");
                result.putString("deviceId", deviceId);
                promise.resolve(result);
                return;
            }
            Long lastSeen = deviceLastSeen.get(deviceId);
            if (lastSeen != null) {
                long timeSinceLastSeen = System.currentTimeMillis() - lastSeen;
                if (timeSinceLastSeen > DEVICE_STALE_TIMEOUT_MS) {
                    Log.w(TAG, "⚠️ Device not seen in scan results for " + (timeSinceLastSeen / 1000) + " seconds - may be out of range");
                    Log.w(TAG, "   Consider scanning again to ensure device is advertising");
                } else {
                    Log.d(TAG, "✅ Device was recently seen in scan (last seen: " + (timeSinceLastSeen / 1000) + "s ago)");
                }
            }
            if (scannedDevice != null && scannedDevice.rssi != 0) {
                int rssi = scannedDevice.rssi;
                final int MIN_RSSI = -90; 
                if (rssi < MIN_RSSI) {
                    Log.w(TAG, "⚠️ Device RSSI is weak (" + rssi + " dBm < " + MIN_RSSI + " dBm) - connection may fail");
                    Log.w(TAG, "   Device may be out of range or signal is weak");
                } else {
                    Log.d(TAG, "✅ Device RSSI is good (" + rssi + " dBm) - should be in range");
                }
            }
            if (pendingConnectionPromises.containsKey(promiseKey)) {
                Log.d(TAG, "🔄 Retry connection detected - removing stale promise for: " + deviceId);
                pendingConnectionPromises.remove(promiseKey);
            }
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
            if (device == null) {
                promise.reject("DEVICE_NOT_FOUND", "Device not found");
                return;
            }
            synchronized(gattLock) {
                BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                int bondState = device.getBondState();
                if (existingGatt != null) {
                    if (connectionState != BluetoothProfile.STATE_CONNECTED) {
                        Log.d(TAG, "🔄 Cleaning up stale GATT connection before retry (state=" + connectionState + "): " + deviceId);
                        try {
                            existingGatt.disconnect();
                            existingGatt.close();
                            // Industry best practice: Explicitly set to null to prevent reuse
                            existingGatt = null;
                        } catch (Exception e) {
                            Log.e(TAG, "❌ Error cleaning up stale GATT: " + e.getMessage());
                        }
                        connectedGatts.remove(deviceId);
                        systemCommandsSent.remove(deviceId);
                        dataSyncState.remove(deviceId);
                        final BluetoothDevice finalDevice = device;
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                proceedWithConnectionAfterCleanup(finalDevice, deviceId, promise, promiseKey, isManualConnection, supervisionTimeoutMs);
                            }
                        }, 500);
                        return; 
                    }
                } else if (bondState == BluetoothDevice.BOND_BONDED && 
                          connectionState != BluetoothProfile.STATE_CONNECTED &&
                          connectionState != BluetoothProfile.STATE_DISCONNECTED) {
                    Log.w(TAG, "⚠️ Device is paired but in transitional connection state (" + connectionState + ")");
                    Log.w(TAG, "   This can cause immediate disconnection. Waiting for system to settle...");
                    final BluetoothDevice finalDevice = device;
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            proceedWithConnectionAfterCleanup(finalDevice, deviceId, promise, promiseKey, isManualConnection, supervisionTimeoutMs);
                        }
                    }, 1000); 
                    return; 
                }
            }
            if (!isProcessingConnection.get() && connectionQueue.isEmpty()) {
                proceedWithConnectionAfterCleanup(device, deviceId, promise, promiseKey, isManualConnection, supervisionTimeoutMs);
            } else {
                Log.d(TAG, "📋 Connection queue is busy - adding device to queue: " + deviceId);
                enqueueConnection(deviceId);
                pendingConnectionPromises.put(promiseKey, promise);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error connecting to device with options: " + e.getMessage(), e);
            String promiseKey = "connect_" + deviceId;
            pendingConnectionPromises.remove(promiseKey);
            promise.reject("CONNECTION_ERROR", "Failed to connect: " + e.getMessage());
        }
    }
    @ReactMethod
    public void connectToDevice(String deviceId, Promise promise) {
        try {
            WritableMap defaultOptions = Arguments.createMap();
            defaultOptions.putBoolean("isManualConnection", true); 
            connectToDeviceWithOptions(deviceId, defaultOptions, promise);
        } catch (Exception e) {
            promise.reject("CONNECTION_ERROR", e.getMessage());
        }
    }
    private void proceedWithConnectionAfterCleanup(BluetoothDevice device, String deviceId, Promise promise, String promiseKey, boolean isManualConnection, int supervisionTimeoutMs) {
        deviceConnectionType.put(deviceId, !isManualConnection); 
        if (device != null) {
            boolean wasAlreadyBonded = device.getBondState() == BluetoothDevice.BOND_BONDED;
            deviceWasAlreadyBonded.put(deviceId, wasAlreadyBonded);
            Log.d(TAG, "📝 Stored connection metadata - Type: " + (isManualConnection ? "manual" : "auto") + 
                  ", WasAlreadyBonded: " + wasAlreadyBonded);
        }
        pendingConnectionPromises.put(promiseKey, promise);
        int bondState = device.getBondState();
        boolean needsPairing = (bondState == BluetoothDevice.BOND_NONE);
        proceedWithGattConnection(device, deviceId);
        if (!needsPairing || bondState == BluetoothDevice.BOND_BONDED) {
            long timeoutMs = supervisionTimeoutMs;
            ScheduledFuture<?> timeoutTimer = executorService.schedule(() -> {
                synchronized(gattLock) {
                    BluetoothGatt gatt = connectedGatts.get(deviceId);
                    if (gatt != null) {
                        try {
                            int connectionState = bluetoothManager.getConnectionState(gatt.getDevice(), BluetoothProfile.GATT);
                            if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                                Log.d(TAG, "✅ Timeout fired but device is connected - ignoring timeout for: " + deviceId);
                                connectionTimeoutTimers.remove(deviceId);
                                return; 
                            }
                        } catch (Exception e) {
                            Log.e(TAG, "❌ Error checking connection state in timeout: " + e.getMessage());
                        }
                    }
                }
                Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                if (pendingPromise != null) {
                    pendingPromise.reject("CONNECTION_TIMEOUT", "Connection timeout after " + (timeoutMs/1000) + "s");
                    Log.w(TAG, "⏱️ Connection timeout for device: " + deviceId);
                    synchronized(gattLock) {
                        BluetoothGatt gatt = connectedGatts.remove(deviceId);
                        if (gatt != null) {
                            try {
                                gatt.disconnect();
                                gatt.close();
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error cleaning up after timeout: " + e.getMessage());
                            }
                        }
                    }
                }
                connectionTimeoutTimers.remove(deviceId);
            }, timeoutMs, TimeUnit.MILLISECONDS);
            connectionTimeoutTimers.put(deviceId, timeoutTimer);
            Log.d(TAG, "✅ Connection initiated with timeout: " + (timeoutMs/1000) + "s");
        } else {
            long pairingTimeoutMs = 60000; 
            executorService.schedule(() -> {
                if (device.getBondState() == BluetoothDevice.BOND_NONE || 
                    device.getBondState() == BluetoothDevice.BOND_BONDING) {
                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                    if (pendingPromise != null) {
                        String passkey = getPasskeyForDevice(deviceId);
                        pendingPromise.reject("PAIRING_TIMEOUT", "Pairing timeout after " + (pairingTimeoutMs/1000) + "s. Please enter passkey: " + passkey);
                        Log.w(TAG, "⏱️ Pairing timeout for device: " + deviceId);
                        devicesWaitingForBonding.remove(deviceId);
                    }
                }
            }, pairingTimeoutMs, TimeUnit.MILLISECONDS);
            String passkey = getPasskeyForDevice(deviceId);
            Log.d(TAG, "✅ Connection initiated - waiting for pairing (timeout: " + (pairingTimeoutMs/1000) + "s)");
            Log.d(TAG, "   ⏳ Pairing dialog should appear - user can enter passkey: " + passkey);
        }
    }
    /**
     * Proceed with GATT connection (handles bonding/pairing logic)
     * 
     * Purpose:
     * - Establishes BLE GATT connection to device
     * - Handles pairing dialog for unbonded devices
     * - Manages bond states (BOND_NONE, BOND_BONDING, BOND_BONDED)
     * - Uses LE transport for proper Passkey Entry pairing
     * 
     * Bond States:
     * - BOND_NONE: Device not paired - initiate createBond() before connecting
     * - BOND_BONDING: Pairing in progress - wait for completion
     * - BOND_BONDED: Already paired - proceed with GATT connection
     * 
     * Pairing Flow (BOND_NONE):
     * 1. Call device.createBond() to trigger pairing dialog
     * 2. Use reflection to force LE transport (avoids OOB pairing issues)
     * 3. Wait for user to enter passkey in Android system dialog
     * 4. BroadcastReceiver detects bond state change
     * 5. Proceed with GATT connection after bonding completes
     * 
     * Connection Strategy:
     * - autoConnect=false for immediate connection (bonded devices)
     * - Cleans up stale GATT connections before retry
     * - Handles STATUS 133 (GATT_ERROR) with bonding retry logic
     * 
     * Android Quirks:
     * - Some devices require bonding before GATT connection
     * - createBond(TRANSPORT_LE) ensures Passkey Entry pairing method
     * - Stale system state can cause STATUS 133 on bonded devices
     * 
     * @param device BluetoothDevice object to connect to
     * @param deviceId Device MAC address
     * @throws SecurityException if BLUETOOTH_CONNECT permission missing
     */
    private void proceedWithGattConnection(BluetoothDevice device, String deviceId) {
        try {
            // Check current bond state
            int bondState = device.getBondState();
            Log.d(TAG, "🔍 [BONDING CHECK] Device " + deviceId + " bond state: " + 
                  (bondState == BluetoothDevice.BOND_NONE ? "BOND_NONE" : 
                   bondState == BluetoothDevice.BOND_BONDING ? "BOND_BONDING" : 
                   bondState == BluetoothDevice.BOND_BONDED ? "BOND_BONDED" : "UNKNOWN"));
            
            // Handle unbonded device - initiate pairing before GATT connection
            if (bondState == BluetoothDevice.BOND_NONE) {
                Log.d(TAG, "   💡 Device is not bonded - initiating pairing before GATT connection");
                Log.d(TAG, "   💡 This ensures pairing dialog appears even if device firmware has keys stored");
                
                // Prevent duplicate bonding attempts
                if (devicesWaitingForBonding.containsKey(deviceId)) {                    return;
                }
                
                // Track device as waiting for bonding
                devicesWaitingForBonding.put(deviceId, device);
                String passkey = getPasskeyForDevice(deviceId);
                Log.d(TAG, "   💡 User should enter passkey: " + passkey + " when pairing dialog appears");
                try {
                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                        boolean bondResult = false;
                        try {
                            java.lang.reflect.Method createBondMethod = device.getClass().getMethod("createBond", int.class);
                            int TRANSPORT_LE = 2; 
                            Object result = createBondMethod.invoke(device, TRANSPORT_LE);
                            bondResult = (Boolean) result;
                            Log.d(TAG, "   ✅ Forced LE transport - should prefer Passkey Entry over OOB");
                        } catch (Exception reflectionEx) {
                            Log.w(TAG, "⚠️ [PRE-CONNECTION] Reflection failed, using createBond(): " + reflectionEx.getMessage());
                            bondResult = device.createBond();
                        }
                        if (bondResult) {
                            Log.d(TAG, "   ✅ createBond() returned true - pairing dialog should appear");
                            Log.d(TAG, "   ✅ User can enter passkey: " + passkey + " in the dialog");
                            Log.d(TAG, "   ✅ After bonding completes, GATT connection will proceed automatically");
                            return; 
                        } else {
                            Log.e(TAG, "❌ [PRE-CONNECTION] createBond() returned false - pairing dialog may not appear");
                            Log.e(TAG, "   ⚠️ This may happen if device is already in bonding state or pairing was cancelled");
                            Log.e(TAG, "   ⚠️ Will attempt GATT connection anyway - may fail with STATUS 133 if bonding is required");
                            devicesWaitingForBonding.remove(deviceId);
                        }
                    } else {
                        Log.e(TAG, "❌ [PRE-CONNECTION] BLUETOOTH_CONNECT permission not granted");
                        devicesWaitingForBonding.remove(deviceId);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "❌ [PRE-CONNECTION] Error calling createBond(): " + e.getMessage(), e);
                    devicesWaitingForBonding.remove(deviceId);
                }
            } else if (bondState == BluetoothDevice.BOND_BONDING) {
                Log.d(TAG, "   ⏳ Device is currently bonding - waiting for completion");
                if (!devicesWaitingForBonding.containsKey(deviceId)) {
                    devicesWaitingForBonding.put(deviceId, device);
                }
                return; 
            } else {            }
            // Check for existing GATT connection (prevent duplicates)
            synchronized(gattLock) {
                if (connectedGatts.containsKey(deviceId)) {
                    BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                    Log.d(TAG, "⚠️ Found existing GATT connection for: " + deviceId);
                    
                    // Verify actual connection state with Android system
                    BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                    int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                    
                    if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                        // Device is actually connected - resolve promise and return
                        Log.d(TAG, "✅ Device already connected (verified via BLE Manager): " + deviceId);
                        String promiseKey = "connect_" + deviceId;
                        Promise storedPromise = pendingConnectionPromises.remove(promiseKey);
                        if (storedPromise != null) {
                            storedPromise.resolve(true);
                        }
                        return;
                    } else {
                        // Stale GATT connection - clean up before retry
                        Log.d(TAG, "🔄 Stale GATT connection detected (state=" + connectionState + ") - cleaning up before reconnect");
                        try {
                            existingGatt.close();
                        } catch (Exception e) {
                            Log.e(TAG, "❌ Error closing stale GATT: " + e.getMessage());
                        }
                        connectedGatts.remove(deviceId);
                        systemCommandsSent.remove(deviceId);
                        dataSyncState.remove(deviceId);
                    }
                }
            } 
            // Check system connection state and bond state
            BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
            int systemConnectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
            bondState = device.getBondState();  // Re-check bond state
            
            // Handle bad connection state (bonded but in transitional state)
            if (bondState == BluetoothDevice.BOND_BONDED && 
                systemConnectionState != BluetoothProfile.STATE_CONNECTED &&
                systemConnectionState != BluetoothProfile.STATE_DISCONNECTED) {
                Log.w(TAG, "⚠️ Device is paired but in bad connection state (" + systemConnectionState + ") - forcing cleanup");
                Log.w(TAG, "   This can happen when device was disconnected improperly. Cleaning up system state...");
                try {
                    Thread.sleep(200);  // Brief delay to let system stabilize
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            } else if (bondState == BluetoothDevice.BOND_BONDED && 
                       systemConnectionState == BluetoothProfile.STATE_DISCONNECTED) {
                // Normal case: bonded and disconnected - ready to connect
            }
            
            // ============================================================================
            // CREATE GATT CONNECTION WITH CALLBACKS
            // ============================================================================
            // autoConnect=false: Connect immediately (don't wait for advertisement)
            // Provides comprehensive callbacks for connection lifecycle management
            
            BluetoothGatt gatt = device.connectGatt(
                    getReactApplicationContext(),
                    false,  // autoConnect=false for immediate connection
                    new BluetoothGattCallback() {
                        /**
                         * GATT Connection State Change Callback
                         * 
                         * Called when connection state changes:
                         * - STATE_CONNECTING (1): Connection in progress
                         * - STATE_CONNECTED (2): Successfully connected
                         * - STATE_DISCONNECTING (3): Disconnection in progress
                         * - STATE_DISCONNECTED (0): Fully disconnected
                         * 
                         * Status Codes:
                         * - 0 (GATT_SUCCESS): Operation successful
                         * - 8: Insufficient authorization
                         * - 15: Insufficient encryption
                         * - 19: Connection timeout (Android BLE stack timeout)
                         * - 133: GATT_ERROR (generic error, often cache/bonding issue)
                         * - 147: Insufficient authorization
                         * - 257: Insufficient authentication (pairing required)
                         * 
                         * Handles:
                         * - STATUS 133: Bonding/cache issues with retry logic
                         * - STATUS 19: Timeout with automatic retry
                         * - STATUS 147/257: Authorization/authentication errors
                         * - Successful connection: MTU negotiation, service discovery
                         * - Disconnection: Resource cleanup, event emission
                         */
                        @Override
                        public void onConnectionStateChange(BluetoothGatt gatt, int status, int newState) {
                            String deviceId = gatt.getDevice().getAddress();
                            Log.d(TAG, "🔗 Connection state change for device: " + deviceId + " - Status: " + status + " - New State: " + newState);
                            
                            // ----------------------------------------------------------------
                            // ERROR HANDLING (status != GATT_SUCCESS)
                            // ----------------------------------------------------------------
                            if (status != BluetoothGatt.GATT_SUCCESS) {
                                Log.e(TAG, "❌ Connection failed with status: " + status + " for device: " + deviceId);
                                
                                // Clean up pairing verification
                                devicesPendingPairingVerification.remove(deviceId);
                                ScheduledFuture<?> pairingTimer = pairingVerificationTimers.remove(deviceId);
                                if (pairingTimer != null) {
                                    pairingTimer.cancel(false);
                                }
                                
                                // Reject promise for non-133 errors (133 handled separately)
                                if (status != 133) {
                                    String promiseKey = "connect_" + deviceId;
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        pendingPromise.reject("CONNECTION_ERROR", "Connection failed with status: " + status);
                                    }
                                }
                                
                                // ----------------------------------------------------------------
                                // STATUS 133: GATT_ERROR (Most common BLE error)
                                // ----------------------------------------------------------------
                                // Causes:
                                // - Stale GATT cache
                                // - Bonding keys mismatch
                                // - Device out of range
                                // - Firmware issues
                                if (status == 133) {
                                    int bondState = device.getBondState();
                                    if (bondState == BluetoothDevice.BOND_NONE) {
                                        if (devicesWaitingForBonding.containsKey(deviceId)) {
                                            Log.d(TAG, "   ⏳ Waiting for bonding to complete - STATUS 133 is expected here");
                                            try {
                                                gatt.close();
                                            } catch (Exception e) {
                                                Log.w(TAG, "⚠️ Error closing GATT: " + e.getMessage());
                                            }
                                            connectedGatts.remove(deviceId);
                                            return; 
                                        }
                                        String passkey = getPasskeyForDevice(deviceId);                                        try {
                                            gatt.close();
                                        } catch (Exception e) {
                                            Log.w(TAG, "⚠️ Error closing GATT: " + e.getMessage());
                                        }
                                        connectedGatts.remove(deviceId);
                                        devicesWaitingForBonding.put(deviceId, device);
                                        try {
                                            if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                                                boolean bondResult = false;
                                                try {
                                                    java.lang.reflect.Method createBondMethod = device.getClass().getMethod("createBond", int.class);
                                                    int TRANSPORT_LE = 2; 
                                                    Object result = createBondMethod.invoke(device, TRANSPORT_LE);
                                                    bondResult = (Boolean) result;
                                                    Log.d(TAG, "   ✅ Forced LE transport - should prefer Passkey Entry over OOB");
                                                } catch (Exception reflectionEx) {
                                                    Log.w(TAG, "⚠️ Reflection failed, using createBond(): " + reflectionEx.getMessage());
                                                    bondResult = device.createBond();
                                                }
                                                if (bondResult) {
                                                } else {
                                                    Log.e(TAG, "❌ [PAIRING] createBond() returned false - pairing dialog may not appear");
                                                    devicesWaitingForBonding.remove(deviceId);
                                                    String promiseKey = "connect_" + deviceId;
                                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                                    if (pendingPromise != null) {
                                                        pendingPromise.reject("BONDING_ERROR", "Failed to start pairing. Try pairing via Android Bluetooth settings first.");
                                                    }
                                                    return;
                                                }
                                            }
                                        } catch (Exception e) {
                                            Log.e(TAG, "❌ [PAIRING] Error calling createBond(): " + e.getMessage(), e);
                                            devicesWaitingForBonding.remove(deviceId);
                                            String promiseKey = "connect_" + deviceId;
                                            Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                            if (pendingPromise != null) {
                                                pendingPromise.reject("BONDING_ERROR", "Failed to initiate pairing: " + e.getMessage());
                                            }
                                            return;
                                        }
                                        executorService.schedule(() -> {
                                            if (devicesWaitingForBonding.containsKey(deviceId)) {
                                                Log.e(TAG, "❌ [PAIRING] Timeout - pairing dialog may not have appeared");
                                                devicesWaitingForBonding.remove(deviceId);
                                                String promiseKey = "connect_" + deviceId;
                                                Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                                if (pendingPromise != null) {
                                                    pendingPromise.reject("PAIRING_TIMEOUT", 
                                                        "Pairing timeout. Please pair the device via Android Bluetooth settings, then try connecting again. Enter passkey: " + passkey);
                                                }
                                            }
                                        }, 60, TimeUnit.SECONDS);
                                        return; 
                                    } else if (bondState == BluetoothDevice.BOND_BONDING) {
                                        try {
                                            gatt.close();
                                        } catch (Exception e) {
                                            Log.w(TAG, "⚠️ Error closing GATT: " + e.getMessage());
                                        }
                                        connectedGatts.remove(deviceId);
                                        return; 
                                    } else {
                                        Log.e(TAG, "🔄 [STATUS 133] BLE stack issue (device is bonded) - may be out of range or cache issue");
                                        handleStatus133ForBondedDevice(deviceId, device, gatt);
                                    }
                                    return;
                                }
                                gatt.close();
                                connectedGatts.remove(deviceId);
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.connectionState = "disconnected";
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                return;
                            }
                            // ----------------------------------------------------------------
                            // STATE_CONNECTED: Successfully connected to device
                            // ----------------------------------------------------------------
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                // Cancel connection timeout timer (connection succeeded)
                                ScheduledFuture<?> timeoutTimer = connectionTimeoutTimers.remove(deviceId);
                                if (timeoutTimer != null && !timeoutTimer.isDone()) {
                                    boolean cancelled = timeoutTimer.cancel(false);
                                    if (cancelled) {
                                    } else {
                                        Log.w(TAG, "⚠️ [CONNECTION] Timeout timer could not be cancelled (may already be executing)");
                                    }
                                }
                                
                                // Get pending promise (will be resolved after pairing verification)
                                String promiseKey = "connect_" + deviceId;
                                Promise pendingPromise = pendingConnectionPromises.get(promiseKey);
                                if (pendingPromise != null) {
                                    // Promise kept in map for later resolution after pairing verification
                                }
                                
                                // Store GATT connection (thread-safe)
                                synchronized(gattLock) {
                                    connectedGatts.put(deviceId, gatt);
                                }
                                
                                // Clear retry counters (connection successful)
                                connectionRetryAttempts.remove(deviceId);
                                status133RetryCounts.remove(deviceId); // Industry best practice: Clear status 133 retry count on success
                                
                                // Request optimal connection parameters (low latency)
                                requestConnectionParameters(gatt, deviceId);
                                
                                // Check bond state and add to bonded devices if bonded
                                int bondState = device.getBondState();
                                if (bondState == BluetoothDevice.BOND_BONDED) {
                                    addToBondedDevices(deviceId, device);
                                } else {
                                    // Not bonded yet - pairing may be in progress
                                }
                                
                                // Mark device as pending pairing verification
                                devicesPendingPairingVerification.put(deviceId, System.currentTimeMillis());
                                
                                // Create or retrieve DeviceData
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData == null) {
                                    String deviceName = gatt.getDevice().getName();
                                    if (deviceName == null || deviceName.isEmpty()) {
                                        deviceName = getDeviceName(deviceId);  // Try cached name
                                        if (deviceName == null || deviceName.isEmpty()) {
                                            deviceName = "Unknown Device";
                                        }
                                    }
                                    deviceData = new DeviceData(deviceId, deviceName);
                                    deviceDataMap.put(deviceId, deviceData);
                                    Log.d(TAG, "✅ Created DeviceData for manual connection: " + deviceId + " (" + deviceName + ")");
                                }
                                
                                // Update connection state
                                deviceData.connectionState = "connecting";  // Still completing setup
                                
                                // Clear notification tracking (fresh connection)
                                pendingNotificationEnables.remove(deviceId);
                                completedNotificationEnables.remove(deviceId);
                                
                                // Start MTU negotiation (request larger packet size)
                                secureReadyStates.put(deviceId, SecureReadyState.MTU_NEGOTIATING);
                                gatt.requestMtu(REQUESTED_MTU);  // Request 512 bytes (default is 23)
                                
                                // Set MTU negotiation timeout (fallback to default MTU)
                                ScheduledFuture<?> mtuTimeout = executorService.schedule(() -> {
                                    if (!negotiatedMtuMap.containsKey(deviceId)) {
                                        negotiatedMtuMap.put(deviceId, DEFAULT_MTU);
                                        Log.w(TAG, "⚠️ MTU negotiation timeout for " + deviceId + " - using default MTU: " + DEFAULT_MTU);
                                        
                                        // Proceed with service discovery despite MTU timeout
                                        updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                        List<BluetoothGattService> existingServices = gatt.getServices();
                                        if (existingServices != null && existingServices.size() > 0) {
                                            handleServicesDiscovered(gatt);
                                        } else {
                                            gatt.discoverServices();
                                        }
                                    }
                                }, MTU_NEGOTIATION_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                                mtuNegotiationTimeouts.put(deviceId, mtuTimeout);
                                
                                // Industry best practice: Encryption wait timing
                                // Bonded: 2-3s (encryption already established)
                                // Unbonded: 8-10s (needs pairing + encryption)
                                int verificationDelay = (bondState == BluetoothDevice.BOND_BONDED) ? 2 : 8;
                                ScheduledFuture<?> pairingTimer = executorService.schedule(() -> {
                                    verifyPairingAndConfirmConnection(deviceId, gatt);
                                }, verificationDelay, TimeUnit.SECONDS);
                                pairingVerificationTimers.put(deviceId, pairingTimer);
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                Log.d("SampleBridgeAndroid", "❌ Disconnected from: " + deviceId);
                                boolean wasPendingPairing = devicesPendingPairingVerification.containsKey(deviceId);
                                if (wasPendingPairing && status != BluetoothGatt.GATT_SUCCESS) {
                                    if (status == 133 || status == 257 || status == 147 || status == 15 || status == 8 || status == 19) {
                                        String errorMessage = getGATTErrorMessage(status);
                                        Log.e(TAG, "❌ [PAIRING FAILURE] Device disconnected during pairing verification with error: " + status + " - " + errorMessage);
                                        BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                                        if (existingGatt != null) {
                                            handlePairingFailure(deviceId, existingGatt);
                                            return; 
                                        }
                                    }
                                }
                                if (status == 19) {
                                    Log.e(TAG, "⏱️ [ANDROID STACK TIMEOUT - STATUS 19] Connection timed out for device: " + deviceId + " (Android BLE stack timeout, not application timeout)");
                                    int retryCount = connectionRetryAttempts.getOrDefault(deviceId, 0);
                                    String promiseKey = "connect_" + deviceId;
                                    if (retryCount < MAX_CONNECTION_RETRY_ATTEMPTS) {
                                        connectionRetryAttempts.put(deviceId, retryCount + 1);
                                        Log.d(TAG, "🔄 [RETRY] Attempting automatic retry " + (retryCount + 1) + "/" + MAX_CONNECTION_RETRY_ATTEMPTS + " for status 19 timeout");
                                        ScheduledFuture<?> timeoutTimer = connectionTimeoutTimers.remove(deviceId);
                                        if (timeoutTimer != null) {
                                            timeoutTimer.cancel(false);
                                        }
                                        synchronized(gattLock) {
                                            BluetoothGatt gattToClose = connectedGatts.remove(deviceId);
                                            if (gattToClose != null) {
                                                try {
                                                    gattToClose.disconnect();
                                                    gattToClose.close();
                                                    // Industry best practice: Explicitly set to null to prevent reuse
                                                    gattToClose = null;
                                                } catch (Exception e) {
                                                    Log.e(TAG, "❌ Error cleaning up GATT before retry: " + e.getMessage());
                                                }
                                            }
                                        }
                                        connectingDevices.remove(deviceId);
                                        long retryDelay = CONNECTION_RETRY_DELAY_MS;
                                        Log.d(TAG, "   ⏳ Retrying connection in " + (retryDelay / 1000) + " seconds...");
                                        mainHandler.postDelayed(() -> {
                                            try {
                                                Promise retryPromise = pendingConnectionPromises.get(promiseKey);
                                                if (retryPromise != null) {
                                                    BluetoothDevice retryDevice = bluetoothAdapter.getRemoteDevice(deviceId);
                                                    if (retryDevice != null) {
                                                        Log.d(TAG, "🔄 Retrying connection to: " + deviceId + " with 15s timeout");
                                                        proceedWithConnectionAfterCleanup(retryDevice, deviceId, retryPromise, promiseKey, true, 15000);
                                                    } else {
                                                        connectionRetryAttempts.remove(deviceId);
                                                        retryPromise.reject("DEVICE_NOT_FOUND", "Device not found during retry");
                                                        pendingConnectionPromises.remove(promiseKey);
                                                    }
                                                } else {
                                                    connectionRetryAttempts.remove(deviceId);
                                                    Log.w(TAG, "⚠️ Retry cancelled - promise no longer exists");
                                                }
                                            } catch (Exception e) {
                                                Log.e(TAG, "❌ Error during connection retry: " + e.getMessage());
                                                connectionRetryAttempts.remove(deviceId);
                                                Promise retryPromise = pendingConnectionPromises.remove(promiseKey);
                                                if (retryPromise != null) {
                                                    retryPromise.reject("CONNECTION_TIMEOUT", "Connection timed out after retry. Please ensure device is in range and try again.");
                                                }
                                            }
                                        }, retryDelay);
                                        return; 
                                    }
                                    Log.e(TAG, "❌ Max retry attempts reached for status 19 - connection failed");
                                    connectionRetryAttempts.remove(deviceId);
                                    ScheduledFuture<?> timeoutTimer = connectionTimeoutTimers.remove(deviceId);
                                    if (timeoutTimer != null) {
                                        timeoutTimer.cancel(false);
                                        Log.d(TAG, "   ✅ Cancelled application timeout timer (Android stack already timed out)");
                                    }
                                    setConnectionCooldown(deviceId, CONNECTION_COOLDOWN_MS);
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        pendingPromise.reject("CONNECTION_TIMEOUT", "Connection timed out after " + (retryCount + 1) + " attempts. Please ensure device is in range and try again.");
                                    }
                                }
                                if (status == 147) {
                                    Log.e(TAG, "🔐 [AUTHORIZATION ERROR] Status 147 - Insufficient authorization for device: " + deviceId);
                                    String promiseKey = "connect_" + deviceId;
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        pendingPromise.reject("AUTHORIZATION_ERROR", "Device requires authorization. Please check device permissions.");
                                    }
                                }
                                if (status == 257) {
                                    Log.e(TAG, "🔐 [AUTHENTICATION ERROR] Status 257 - Insufficient authentication for device: " + deviceId);
                                    String promiseKey = "connect_" + deviceId;
                                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                                    if (pendingPromise != null) {
                                        pendingPromise.reject("AUTHENTICATION_ERROR", "Device requires pairing. Please enter passkey when prompted.");
                                    }
                                }
                                BluetoothGatt gattToClose = connectedGatts.remove(deviceId);
                                if (gattToClose != null) {
                                    try {
                                        gattToClose.disconnect();
                                        gattToClose.close();
                                        // Industry best practice: Explicitly set to null to prevent reuse
                                        gattToClose = null;
                                        Log.d(TAG, "✅ GATT connection closed for: " + deviceId);
                                    } catch (Exception e) {
                                        Log.e(TAG, "❌ Error closing GATT: " + e.getMessage());
                                    }
                                }
                                if (devicesPendingUnbond.remove(deviceId)) {
                                    try {
                                        if (bluetoothAdapter != null && ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                                            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                                            if (device != null) {
                                                java.lang.reflect.Method removeBondMethod = device.getClass().getMethod("removeBond");
                                                boolean removeBondResult = (Boolean) removeBondMethod.invoke(device);
                                                if (removeBondResult) {
                                                } else {
                                                    Log.w(TAG, "⚠️ [UNPAIR] removeBond() returned false for: " + deviceId + " - device may already be unbonded");
                                                }
                                            }
                                        }
                                    } catch (Exception e) {
                                        Log.w(TAG, "⚠️ [UNPAIR] Could not remove bond from Android system: " + e.getMessage());
                                    }
                                }
                                cleanupDeviceResources(deviceId);
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.connectionState = "disconnected";
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                boolean isManualDisconnect = manualDisconnectInProgress.contains(deviceId);
                                if (!isManualDisconnect && !wasPendingPairing && companionService != null) {
                                    Log.d(TAG, "🔍 Notifying companion service of disconnect for aggressive reconnection: " + deviceId);
                                    companionService.onDeviceDisconnected(deviceId);
                                }
                            }
                        }
                        @Override
                        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            if (status == BluetoothGatt.GATT_SUCCESS) {                                handleServicesDiscovered(gatt);
                                if (devicesPendingPairingVerification.containsKey(deviceId)) {                                    DeviceData deviceData = deviceDataMap.get(deviceId);
                                    if (deviceData != null && deviceData.characteristics.containsKey(DEVICE_STATUS_CHAR_UUID)) {
                                        BluetoothGattCharacteristic deviceStatusChar = deviceData.characteristics.get(DEVICE_STATUS_CHAR_UUID);
                                        if (deviceStatusChar != null) {
                                            boolean readResult = gatt.readCharacteristic(deviceStatusChar);
                                            Log.d(TAG, "📊 Device Status read initiated for pairing verification: " + readResult);
                                        } else {                                            ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                            if (timer != null) {
                                                timer.cancel(false);
                                            }
                                            confirmConnection(deviceId, gatt);
                                        }
                                    } else {                                        ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                        if (timer != null) {
                                            timer.cancel(false);
                                        }
                                        confirmConnection(deviceId, gatt);
                                    }
                                }
                                ScheduledFuture<?> timeoutTask = serviceDiscoveryTimeouts.remove(deviceId);
                                if (timeoutTask != null) {
                                    timeoutTask.cancel(false);                                }
                                String promiseKey = "discover_services_" + deviceId;
                                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(promiseKey);
                                if (pendingPromise == null) {
                                    pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                }
                                if (pendingPromise != null) {
                                    pendingPromise.resolve(true);
                                }
                            } else {
                                Log.e(TAG, "❌ Service discovery failed for device " + deviceId + ": " + status);
                                ScheduledFuture<?> timeoutTask = serviceDiscoveryTimeouts.remove(deviceId);
                                if (timeoutTask != null) {
                                    timeoutTask.cancel(false);
                                }
                                if (devicesPendingPairingVerification.containsKey(deviceId)) {
                                    if (status == 133 || status == 257 || status == 15) {
                                        Log.e(TAG, "❌ [PAIRING ERROR] Service discovery failed due to pairing error: " + status);
                                        handlePairingFailure(deviceId, gatt);
                                        String promiseKey = "discover_services_" + deviceId;
                                        Promise pendingPromise = pendingServiceDiscoveryPromises.remove(promiseKey);
                                        if (pendingPromise == null) {
                                            pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                        }
                                        if (pendingPromise != null) {
                                            String errorMessage = getGATTErrorMessage(status);
                                            pendingPromise.reject("PAIRING_FAILED", errorMessage);
                                        }
                                        return;
                                    }
                                }
                                String promiseKey = "discover_services_" + deviceId;
                                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(promiseKey);
                                if (pendingPromise == null) {
                                    pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                }
                                if (pendingPromise != null) {
                                    pendingPromise.reject("DISCOVERY_ERROR", "Service discovery failed with status: " + status);
                                }
                            }
                        }
                        @Override
                        public void onCharacteristicChanged(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
                            String deviceId = gatt.getDevice().getAddress();
                            String characteristicUuid = characteristic.getUuid().toString();
                            byte[] data = characteristic.getValue();
                            if (!firstNotificationReceived.containsKey(deviceId)) {
                                firstNotificationReceived.put(deviceId, true);
                                firstNotificationTimestamp.put(deviceId, System.currentTimeMillis());                                ScheduledFuture<?> cccRetryTimer = cccRetryTimers.remove(deviceId);
                                if (cccRetryTimer != null) {
                                    cccRetryTimer.cancel(false);
                                }
                            }
                            if (characteristicUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
                            }
                            handleCharacteristicData(deviceId, characteristic);
                            if (data != null && data.length > 0) {
                                String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                WritableMap eventData = Arguments.createMap();
                                eventData.putString("deviceId", deviceId);
                                eventData.putString("characteristicUuid", characteristicUuid); 
                                eventData.putString("data", base64Data); 
                                sendEvent("CharacteristicData", eventData);
                            }
                        }
                        @Override
                        public void onDescriptorWrite(BluetoothGatt gatt, BluetoothGattDescriptor descriptor, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String descriptorUuid = descriptor.getUuid().toString();
                            String characteristicUuid = descriptor.getCharacteristic().getUuid().toString();
                            onDescriptorWriteComplete(deviceId, descriptor, status);
                            String promiseKey = deviceId + "_" + descriptorUuid;
                            Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
                            if (pendingPromise != null) {
                                if (status == BluetoothGatt.GATT_SUCCESS) {
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
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ Characteristic read successful: " + characteristicUuid);
                                if (characteristicUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
                                    byte[] data = characteristic.getValue();
                                    if (data != null && data.length > 0) {
                                    }
                                }
                                if (devicesPendingPairingVerification.containsKey(deviceId)) {
                                    if (characteristicUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
                                        ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                        if (timer != null) {
                                            timer.cancel(false);
                                        }
                                        BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                                        if (existingGatt != null) {
                                            confirmConnection(deviceId, existingGatt);
                                        }
                                    }
                                }
                                String promiseKey = deviceId + "_" + characteristicUuid;
                                Promise pendingPromise = pendingReadPromises.remove(promiseKey);
                                Promise pendingCharacteristicPromise = pendingCharacteristicPromises.remove(promiseKey);
                                if (characteristicUuid.equals(DEVICE_STATUS_CHAR_UUID)) {
                                    handleCharacteristicData(deviceId, characteristic);
                                }
                                if (pendingPromise != null) {
                                    byte[] data = characteristic.getValue();
                                    if (data != null && data.length > 0) {
                                        String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                        pendingPromise.resolve(base64Data);
                                    } else {
                                        pendingPromise.resolve(null);
                                    }
                                } else if (pendingCharacteristicPromise != null) {
                                    byte[] data = characteristic.getValue();
                                    if (data != null && data.length > 0) {
                                        String base64Data = android.util.Base64.encodeToString(data, android.util.Base64.NO_WRAP);
                                        pendingCharacteristicPromise.resolve(base64Data);
                                    } else {
                                        pendingCharacteristicPromise.resolve(null);
                                    }
                                } else {
                                    handleCharacteristicData(deviceId, characteristic);
                                }
                            } else {
                                Log.e(TAG, "❌ Characteristic read failed: " + characteristicUuid + " with status: " + status);
                                if (devicesPendingPairingVerification.containsKey(deviceId)) {
                                    if (status == 133 || status == 257 || status == 15 || status == 8) {
                                        Log.e(TAG, "❌ [PAIRING ERROR] Characteristic read failed due to pairing error: " + status);
                                        BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                                        if (existingGatt != null) {
                                            handlePairingFailure(deviceId, existingGatt);
                                        }
                                        return;
                                    }
                                }
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
                            String transactionId = writeTransactionIds.remove(writeKey);
                            boolean isSystemCommand = characteristicUuid.equals(SYSTEM_COMMAND_CHAR_UUID);
                            if (transactionId != null) {
                                if (status == BluetoothGatt.GATT_SUCCESS) {
                                    Log.d(TAG, "✅ Write completed successfully for characteristic: " + characteristicUuid);
                                    WritableMap result = Arguments.createMap();
                                    result.putString("deviceId", deviceId);
                                    result.putString("characteristicUuid", characteristicUuid);
                                    result.putBoolean("success", true);
                                    transactionManager.resolveTransaction(transactionId, result);
                                } else {
                                    Log.e(TAG, "❌ Write failed for characteristic: " + characteristicUuid + " with status: " + status);
                                    if (devicesPendingPairingVerification.containsKey(deviceId)) {
                                        if (status == 133 || status == 257 || status == 15 || status == 8) {
                                            Log.e(TAG, "❌ [PAIRING ERROR] Characteristic write failed due to pairing error: " + status);
                                            BluetoothGatt existingGatt = connectedGatts.get(deviceId);
                                            if (existingGatt != null) {
                                                handlePairingFailure(deviceId, existingGatt);
                                            }
                                            return;
                                        }
                                    }
                                    transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED.name(), 
                                        "Write failed with status: " + status);
                                }
                                } else {
                                    if (!isSystemCommand) {
                                        Log.w(TAG, "⚠️ No transaction ID found for write callback: " + writeKey);
                                    } else {
                                        if (status == BluetoothGatt.GATT_SUCCESS) {
                                        } else {
                                            Log.e(TAG, "❌ [QUEUE] System command write failed with status: " + status);
                                            Log.e(TAG, "   Device: " + deviceId);
                                            Log.e(TAG, "   Characteristic: " + characteristicUuid);
                                        }
                                        onSystemCommandWriteComplete(deviceId, status);
                                    }
                                }
                            pendingWrites.remove(writeKey);
                            Log.d(TAG, "🔄 Removed pending write flag for: " + writeKey);
                        }
                        /**
                         * MTU (Maximum Transmission Unit) Changed Callback
                         * 
                         * Purpose:
                         * - MTU determines maximum packet size for BLE data transfer
                         * - Default MTU: 23 bytes (20 bytes data + 3 bytes overhead)
                         * - Requested MTU: 512 bytes (for larger data transfers)
                         * - Negotiated MTU: Minimum of requested and device-supported
                         * 
                         * Benefits of Larger MTU:
                         * - Fewer packets needed for large data transfers
                         * - Reduced overhead (fewer packet headers)
                         * - Better throughput and efficiency
                         * - Important for historical data sync (100s of records)
                         * 
                         * Flow After MTU Change:
                         * 1. Cancel MTU timeout timer
                         * 2. Store negotiated MTU value
                         * 3. Update connection ready state
                         * 4. Trigger service discovery
                         * 
                         * Fallback:
                         * - If MTU change fails, use DEFAULT_MTU (23 bytes)
                         * - Service discovery proceeds regardless
                         */
                        @Override
                        public void onMtuChanged(BluetoothGatt gatt, int mtu, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                // MTU negotiation successful
                                negotiatedMtuMap.put(deviceId, mtu);
                                
                                // Cancel MTU timeout (negotiation completed)
                                ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                if (mtuTimeout != null) {
                                    mtuTimeout.cancel(false);
                                }
                                
                                // Update connection state and proceed with service discovery
                                updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                
                                // Check if services already discovered (some devices pre-cache)
                                List<BluetoothGattService> existingServices = gatt.getServices();
                                if (existingServices != null && existingServices.size() > 0) {
                                    // Services already available - process immediately
                                    handleServicesDiscovered(gatt);
                                } else {
                                    // Initiate service discovery
                                    boolean discoverResult = gatt.discoverServices();
                                    
                                    // Fallback: If services appear after delay, process them
                                    mainHandler.postDelayed(new Runnable() {
                                        @Override
                                        public void run() {
                                            List<BluetoothGattService> services = gatt.getServices();
                                            if (services != null && services.size() > 0) {
                                                // Only process if not already being handled
                                                Integer pending = pendingNotificationEnables.get(deviceId);
                                                if (pending == null) {
                                                    handleServicesDiscovered(gatt);
                                                }
                                            }
                                        }
                                    }, 1000);  // 1 second delay
                                }
                            } else {
                                // MTU negotiation failed - use default MTU
                                negotiatedMtuMap.put(deviceId, DEFAULT_MTU);
                                Log.w(TAG, "⚠️ MTU change failed for device " + deviceId + ": " + status + " - using default MTU: " + DEFAULT_MTU);
                                
                                // Cancel MTU timeout
                                ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                if (mtuTimeout != null) {
                                    mtuTimeout.cancel(false);
                                }
                                
                                // Proceed with service discovery despite MTU failure
                                updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                boolean discoverResult = gatt.discoverServices();
                                
                                // Fallback handling (same as success case)
                                mainHandler.postDelayed(new Runnable() {
                                    @Override
                                    public void run() {
                                        List<BluetoothGattService> services = gatt.getServices();
                                        if (services != null && services.size() > 0) {
                                            Integer pending = pendingNotificationEnables.get(deviceId);
                                            if (pending == null) {
                                                handleServicesDiscovered(gatt);
                                            }
                                        }
                                    }
                                }, 1000);
                            }
                        }
                        @Override
                        public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                                if (pendingPromise != null) {
                                    pendingPromise.resolve(rssi);
                                }
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    deviceData.rssi = rssi;
                                    deviceData.timestamp = System.currentTimeMillis();
                                    WritableMap deviceDataUpdateEvent = Arguments.createMap();
                                    deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
                                    deviceDataUpdateEvent.putString("type", "rssi_update");
                                    deviceDataUpdateEvent.putInt("rssi", rssi);
                                    if (deviceData.batteryLevel != null) {
                                        deviceDataUpdateEvent.putInt("batteryLevel", deviceData.batteryLevel);
                                    } else {
                                        deviceDataUpdateEvent.putNull("batteryLevel");
                                    }
                                    // Send null for uninitialized temperature to avoid 0.0°C display
                                    if (deviceData.temperature > 0) {
                                        deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                    } else {
                                        deviceDataUpdateEvent.putNull("temperature");
                                    }
                                    deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                    deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                    // FIX: Use consistent event name 'DeviceDataUpdated' (was 'DeviceDataUpdate')
                                    sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                                }
                                WritableMap rssiMap = Arguments.createMap();
                                rssiMap.putString("deviceId", deviceId);
                                rssiMap.putInt("rssi", rssi);
                                rssiMap.putDouble("timestamp", System.currentTimeMillis());
                                sendEvent("RSSIUpdate", rssiMap);
                            } else {
                                Log.e(TAG, "❌ RSSI read failed for device " + deviceId + " with status: " + status);
                                String promiseKey = deviceId + "_rssi";
                                Promise pendingPromise = pendingReadPromises.remove(promiseKey);
                                if (pendingPromise != null) {
                                    pendingPromise.reject("RSSI_ERROR", "RSSI read failed with status: " + status);
                                }
                            }
                        }
                    }
                );
                synchronized(gattLock) {
                    connectedGatts.put(deviceId, gatt);
                }
        } catch (SecurityException e) {
            Log.e("SampleBridgeAndroid", "Security exception during GATT connection: " + e.getMessage());
            String promiseKey = "connect_" + deviceId;
            Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
            if (pendingPromise != null) {
                pendingPromise.reject("SECURITY_ERROR", "Security exception: " + e.getMessage());
            }
        } catch (Exception e) {
            Log.e("SampleBridgeAndroid", "Exception during GATT connection: " + e.getMessage());
            String promiseKey = "connect_" + deviceId;
            Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
            if (pendingPromise != null) {
                pendingPromise.reject("CONNECTION_ERROR", "Failed to create GATT connection: " + e.getMessage());
            }
        }
    }
    // ============================================================================
    // CHARACTERISTIC OPERATIONS (React Native Bridge Methods)
    // ============================================================================
    
    /**
     * Read characteristic value from a connected BLE device
     * 
     * Purpose:
     * - Reads current value of a BLE characteristic
     * - Result received asynchronously in onCharacteristicRead callback
     * - Supports transaction tracking with timeout (5 seconds)
     * 
     * Transaction Flow:
     * 1. Validate device connection and characteristic existence
     * 2. Create transaction ID for tracking
     * 3. Add promise to pending read map
     * 4. Initiate GATT read operation
     * 5. Wait for onCharacteristicRead callback
     * 6. Resolve promise with Base64-encoded data
     * 
     * Error Handling:
     * - CHARACTERISTIC_NOT_FOUND: Characteristic doesn't exist or not discovered
     * - DEVICE_NOT_CONNECTED: Device disconnected before read
     * - CHARACTERISTIC_READ_FAILED: Read operation failed
     * - Timeout after 5 seconds
     * 
     * @param deviceId Device MAC address
     * @param characteristicUuid UUID of characteristic to read
     * @param promise React Native promise (resolves with Base64 string)
     */
    @ReactMethod
    public void readCharacteristic(String deviceId, String characteristicUuid, Promise promise) {
        try {
            // Validate operation (device connected, characteristic exists)
            if (!validateOperation(deviceId, characteristicUuid, "READ_CHARACTERISTIC")) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            
            // Retrieve GATT connection and characteristic
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            
            // Create transaction for tracking and timeout
            String transactionId = TransactionManager.generateReadTransactionId(deviceId, characteristicUuid);
            transactionManager.addTransaction(transactionId, promise, "READ_CHARACTERISTIC", deviceId, 5000);
            
            // Add to pending reads map (for callback resolution)
            String promiseKey = deviceId + "_" + characteristicUuid;
            pendingReadPromises.put(promiseKey, promise);
            
            // Initiate read operation
            if (gatt.readCharacteristic(characteristic)) {
                // Read initiated successfully - wait for callback
            } else {
                // Read initiation failed
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
            pendingServiceDiscoveryPromises.put(deviceId, promise);
            executorService.schedule(() -> {
                Promise timeoutPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                if (timeoutPromise != null) {
                    Log.e(TAG, "⏰ Service discovery timeout for device: " + deviceId);
                    timeoutPromise.reject("DISCOVERY_TIMEOUT", "Service discovery timed out");
                }
            }, 10, TimeUnit.SECONDS);            boolean discoverResult = gatt.discoverServices();
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
            List<BluetoothGattService> services = gatt.getServices();
            if (services == null || services.size() == 0) {
                String discoveryKey = "getServices_" + deviceId;
                if (pendingServiceDiscoveryPromises.containsKey(discoveryKey)) {
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            getDeviceServices(deviceId, promise);
                        }
                    }, 1000); 
                    return;
                }
                pendingServiceDiscoveryPromises.put(discoveryKey, promise);
                gatt.discoverServices();
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        pendingServiceDiscoveryPromises.remove(discoveryKey);
                        getDeviceServices(deviceId, promise);
                    }
                }, 1500); 
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
                    int properties = characteristic.getProperties();
                    charMap.putBoolean("isReadable", (properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
                    charMap.putBoolean("isWritableWithResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
                    charMap.putBoolean("isWritableWithoutResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0);
                    charMap.putBoolean("isNotifiable", (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
                    charMap.putBoolean("isIndicatable", (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0);
                    charMap.putString("value", null); 
                    characteristicsArray.pushMap(charMap);
                }
                serviceMap.putArray("characteristics", characteristicsArray);
                servicesArray.pushMap(serviceMap);
            }
            WritableMap result = Arguments.createMap();
            result.putArray("services", servicesArray);
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting device services: " + e.getMessage());
            promise.reject("SERVICES_ERROR", e.getMessage());
        }
    }
    /**
     * Write data to a BLE characteristic
     * 
     * Purpose:
     * - Writes hex-encoded data to a BLE characteristic
     * - Supports both write with response and write without response
     * - Result received asynchronously in onCharacteristicWrite callback
     * - Prevents concurrent writes to same characteristic
     * 
     * Write Types:
     * - WRITE_TYPE_DEFAULT (with response): Requires acknowledgment from device
     *   - Slower but reliable
     *   - Guarantees delivery
     *   - Used for critical commands
     * 
     * - WRITE_TYPE_NO_RESPONSE (without response): No acknowledgment
     *   - Faster but no delivery guarantee
     *   - Used for continuous data streaming
     * 
     * Transaction Flow:
     * 1. Validate device connection and characteristic existence
     * 2. Check for concurrent write (reject if pending)
     * 3. Create transaction ID for tracking
     * 4. Convert hex string to byte array
     * 5. Set characteristic value and write type
     * 6. Initiate GATT write operation
     * 7. Wait for onCharacteristicWrite callback
     * 8. Resolve/reject promise based on callback result
     * 
     * Timeout:
     * - System commands: 30 seconds (DFU, data sync can be slow)
     * - Regular writes: 10 seconds
     * 
     * Error Handling:
     * - CHARACTERISTIC_NOT_FOUND: Characteristic doesn't exist
     * - DEVICE_NOT_CONNECTED: Device disconnected before write
     * - WRITE_ALREADY_PENDING: Concurrent write attempted
     * - INVALID_WRITE_DATA: Hex string conversion failed
     * - CHARACTERISTIC_WRITE_FAILED: Write operation failed
     * - PERMISSION_DENIED: Missing BLUETOOTH_CONNECT permission
     * 
     * @param deviceId Device MAC address
     * @param characteristicUuid UUID of characteristic to write
     * @param data Hex-encoded string (e.g., "01020304")
     * @param promise React Native promise (resolves on success)
     */
    @ReactMethod
    public void writeCharacteristic(String deviceId, String characteristicUuid, String data, Promise promise) {
        String writeKey = deviceId + "_" + characteristicUuid;
        try {
            // Validate operation (device connected, characteristic exists)
            if (!validateOperation(deviceId, characteristicUuid, "WRITE_CHARACTERISTIC")) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            
            // Prevent concurrent writes to same characteristic
            if (pendingWrites.contains(writeKey)) {
                Log.w(TAG, "⚠️ Write already pending for characteristic: " + characteristicUuid + " on device: " + deviceId);
                rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED, 
                    "Write already pending", "Concurrent write operation", deviceId, null, characteristicUuid));
                return;
            }
            
            // Double-check device connection (additional safety)
            if (!validateDeviceConnection(deviceId)) {
                rejectWithBLEError(promise, BLEError.deviceNotConnected(deviceId));
                return;
            }
            
            // Retrieve GATT connection and characteristic
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            
            // Create transaction for tracking and timeout
            String transactionId = TransactionManager.generateWriteTransactionId(deviceId, characteristicUuid);
            writeTransactionIds.put(writeKey, transactionId);
            
            // Set timeout based on characteristic (system commands take longer)
            int timeoutMs = characteristicUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ? 30000 : 10000;
            transactionManager.addTransaction(transactionId, promise, "WRITE_CHARACTERISTIC", deviceId, timeoutMs);
            
            // Mark write as pending
            pendingWrites.add(writeKey);
            
            // Convert hex string to byte array
            byte[] dataBytes;
            try {
                dataBytes = BLEUtils.hexToBytes(data);
            } catch (IllegalArgumentException e) {
                Log.e(TAG, "❌ Failed to convert hex string to byte array: " + data, e);
                pendingWrites.remove(writeKey);
                writeTransactionIds.remove(writeKey);
                transactionManager.rejectTransaction(transactionId, BLEError.invalidWriteData(data, characteristicUuid));
                return;
            }
            
            // Set characteristic value
            characteristic.setValue(dataBytes);
            
            // Determine write type based on characteristic properties
            int properties = characteristic.getProperties();
            if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0) {
                // Write with response (reliable)
                characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            } else if ((properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0) {
                // Write without response (fast)
                characteristic.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            }
            
            // Initiate write operation
            boolean writeResult = gatt.writeCharacteristic(characteristic);
            
            if (writeResult) {
                // Write initiated successfully - wait for callback
                Log.d(TAG, "✅ Successfully initiated write to characteristic: " + characteristicUuid);
                
                // Auto-clear pending write flag after 2 seconds (safety timeout)
                executorService.schedule(() -> {
                    pendingWrites.remove(writeKey);
                    Log.d(TAG, "🔄 Removed pending write flag for: " + writeKey);
                }, 2, TimeUnit.SECONDS);
            } else {
                // Write initiation failed
                Log.e(TAG, "❌ Failed to initiate write to characteristic: " + characteristicUuid);
                Log.e(TAG, "📊 Failed write data: " + BLEUtils.formatBytesForLogging(dataBytes) + " (" + dataBytes.length + " bytes)");
                Log.e(TAG, "📊 Characteristic properties: 0x" + String.format("%02x", characteristic.getProperties()));
                Log.e(TAG, "📊 Write type: " + characteristic.getWriteType());
                
                // Clean up and reject promise
                pendingWrites.remove(writeKey);
                writeTransactionIds.remove(writeKey);
                transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_WRITE_FAILED.name(), 
                    "Failed to initiate write operation");
            }
        } catch (SecurityException e) {
            // Missing BLUETOOTH_CONNECT permission
            Log.e(TAG, "❌ Security exception during write: " + e.getMessage());
            pendingWrites.remove(writeKey);
            writeTransactionIds.remove(writeKey);
            rejectWithBLEError(promise, BLEError.permissionDenied("BLUETOOTH_CONNECT"));
        } catch (Exception e) {
            // Generic error handling
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
    private byte[] hexStringToByteArray(String hexString) {
        int len = hexString.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hexString.charAt(i), 16) << 4)
                                 + Character.digit(hexString.charAt(i+1), 16));
        }
        return data;
    }
    private boolean isDeviceConnected(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.d(TAG, "🔍 Device not in connected GATT map: " + deviceId);
            return false;
        }
        BluetoothDevice device = gatt.getDevice();
        if (device == null) {
            return false;
        }
        boolean hasCharacteristics = false;
        for (String key : deviceCharacteristics.keySet()) {
            if (key.startsWith(deviceId + "_")) {
                hasCharacteristics = true;
                break;
            }
        }
        if (!hasCharacteristics) {
            return false;
        }
        Log.d(TAG, "✅ Device connection validated: " + deviceId);
        return true;
    }
    private boolean isCharacteristicWritable(String deviceId, String characteristicUuid) {
        BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
        if (characteristic == null) {
            return false;
        }
        int properties = characteristic.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0 ||
                          (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        Log.d(TAG, "🔍 Characteristic " + characteristicUuid + " writable: " + canWrite + 
              " (properties: 0x" + String.format("%02x", properties) + ")");
        return canWrite;
    }
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
        } catch (Exception e) {
            promise.reject("QUEUE_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void signalOperationComplete(String deviceId) {
        connectionManager.onOperationComplete(deviceId);    }
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
            if (!isServiceRunning || bleService == null) {
                startForegroundService();
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
                }, 1000); 
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
            startForegroundService();
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    promise.resolve(isServiceRunning && bleService != null);
                } catch (Exception e) {
                    promise.reject("SERVICE_START_ERROR", e.getMessage());
                }
            }, 2000); 
        } catch (Exception e) {
            promise.reject("SERVICE_START_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void testForegroundService(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            boolean isRunning = isServiceRunning && bleService != null;
            result.putBoolean("isServiceRunning", isRunning);
            result.putBoolean("isServiceBound", bleService != null);
            if (!isRunning) {
                startForegroundService();
                new Handler(Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        boolean started = isServiceRunning && bleService != null;
                        result.putBoolean("startedSuccessfully", started);
                        promise.resolve(result);
                    } catch (Exception e) {
                        promise.reject("SERVICE_TEST_ERROR", e.getMessage());
                    }
                }, 3000); 
            } else {
                result.putBoolean("startedSuccessfully", true);
                promise.resolve(result);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error testing foreground service: " + e.getMessage());
            promise.reject("SERVICE_TEST_ERROR", e.getMessage());
        }
    }
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
    @ReactMethod
    public void cancelAllTransactionsForDevice(String deviceId, Promise promise) {
        try {
            int cancelledCount = transactionManager.cancelAllTransactionsForDevice(deviceId);
            promise.resolve(cancelledCount);
        } catch (Exception e) {
            rejectWithBLEError(promise, new BLEError(BLEError.ErrorCode.SYSTEM_ERROR, 
                "Failed to cancel transactions", e.getMessage(), deviceId));
        }
    }
    @ReactMethod
    public void getEnhancedCharacteristicInfo(String deviceId, String characteristicUuid, Promise promise) {
        try {
            BluetoothGattCharacteristic characteristic = deviceCharacteristics.get(deviceId + "_" + characteristicUuid);
            if (characteristic == null) {
                rejectWithBLEError(promise, BLEError.characteristicNotFound(characteristicUuid, deviceId));
                return;
            }
            WritableMap characteristicInfo = Arguments.createMap();
            characteristicInfo.putString("uuid", characteristic.getUuid().toString());
            characteristicInfo.putString("deviceId", deviceId);
            characteristicInfo.putInt("instanceId", characteristic.getInstanceId());
            int properties = characteristic.getProperties();
            characteristicInfo.putBoolean("isReadable", (properties & BluetoothGattCharacteristic.PROPERTY_READ) != 0);
            characteristicInfo.putBoolean("isWritableWithResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0);
            characteristicInfo.putBoolean("isWritableWithoutResponse", (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0);
            characteristicInfo.putBoolean("isNotifiable", (properties & BluetoothGattCharacteristic.PROPERTY_NOTIFY) != 0);
            characteristicInfo.putBoolean("isIndicatable", (properties & BluetoothGattCharacteristic.PROPERTY_INDICATE) != 0);
            characteristicInfo.putInt("properties", properties);
            characteristicInfo.putInt("writeType", characteristic.getWriteType());
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
    @ReactMethod
    public void setBLELogLevel(String logLevel, Promise promise) {
        try {
            BLELogLevel.setLogLevel(logLevel);
            promise.resolve(BLELogLevel.getCurrentLogLevelString());
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to set log level", e.getMessage()));
        }
    }
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
    @ReactMethod
    public void clearDeviceIDs(String deviceId, Promise promise) {
        try {
            int removedCount = BLEIdGenerator.removeDeviceIds(deviceId);
            promise.resolve(removedCount);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to clear device IDs", e.getMessage()));
        }
    }
    @ReactMethod
    public void generateServiceId(String deviceId, String serviceUuid, Promise promise) {
        try {
            int serviceId = BLEIdGenerator.generateServiceId(deviceId, serviceUuid);
            promise.resolve(serviceId);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to generate service ID", e.getMessage()));
        }
    }
    @ReactMethod
    public void generateCharacteristicId(String deviceId, int serviceId, String characteristicUuid, Promise promise) {
        try {
            int characteristicId = BLEIdGenerator.generateCharacteristicId(deviceId, serviceId, characteristicUuid);
            promise.resolve(characteristicId);
        } catch (Exception e) {
            rejectWithBLEError(promise, BLEError.systemError("Failed to generate characteristic ID", e.getMessage()));
        }
    }
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
            byte[] payloadBytes = new byte[payload != null ? payload.size() : 0];
            if (payload != null) {
                for (int i = 0; i < payload.size(); i++) {
                    payloadBytes[i] = (byte) payload.getInt(i);
                }
            }
            boolean success = sendSystemCommand(deviceId, (byte) command, payloadBytes);
            if (success) {                promise.resolve(true);
            } else {
                promise.reject("WRITE_FAILED", "Failed to write system command");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error sending system command: " + e.getMessage());
            promise.reject("SYSTEM_COMMAND_ERROR", e.getMessage());
        }
    }
    private DeviceData findDeviceData(String deviceId) {
        if (deviceId == null || deviceId.isEmpty()) {
            return null;
        }
        return deviceDataMap.get(deviceId);
    }
    private void cleanupGattConnection(String deviceId) {
        synchronized(gattLock) {
            BluetoothGatt gatt = connectedGatts.remove(deviceId);
            if (gatt != null) {
                try {
                    gatt.disconnect();
                    gatt.close(); 
                    Log.d(TAG, "✅ GATT connection cleaned up for: " + deviceId);
                } catch (Exception e) {
                    Log.e(TAG, "❌ Error cleaning up GATT: " + e.getMessage());
                }
            }
        }
        systemCommandsSent.remove(deviceId);
        dataSyncState.remove(deviceId);
    }
    /**
     * Clean up all resources associated with a device
     * 
     * Purpose:
     * - Release all resources when device disconnects
     * - Cancel all timers and scheduled tasks
     * - Clear all state tracking maps
     * - Reset device data to default state
     * - Prevent memory leaks and resource exhaustion
     * 
     * Resources Cleaned:
     * 1. Timers:
     *    - Pairing verification timer
     *    - Connection timeout timer
     *    - Data sync timeout timer
     *    - Set time retry timer
     *    - RSSI monitoring task
     *    - Health API monitoring task
     * 
     * 2. State Maps:
     *    - System command tracking
     *    - Data sync state
     *    - Notification enable tracking
     *    - Descriptor write queues
     *    - RTC validity
     *    - Health check failures
     * 
     * 3. DeviceData:
     *    - Reset sensor values (battery, temperature, steps)
     *    - Clear services and characteristics
     *    - Update connection state to "disconnected"
     * 
     * Called From:
     * - onConnectionStateChange (STATE_DISCONNECTED)
     * - cancelConnection (manual disconnect)
     * - Error handlers (connection failures)
     * 
     * Note:
     * - Does NOT close GATT connection (handled separately)
     * - Does NOT remove from bonded devices (persisted)
     * - Does NOT clear device from deviceDataMap (kept for reconnection)
     * 
     * @param deviceId Device MAC address
     */
    private void cleanupDeviceResources(String deviceId) {
        // Cancel pairing verification timer
        ScheduledFuture<?> pairingTimer = pairingVerificationTimers.remove(deviceId);
        if (pairingTimer != null) {
            pairingTimer.cancel(false);
        }
        devicesPendingPairingVerification.remove(deviceId);
        
        // Cancel connection timeout timer
        ScheduledFuture<?> connectionTimeoutTimer = connectionTimeoutTimers.remove(deviceId);
        if (connectionTimeoutTimer != null) {
            connectionTimeoutTimer.cancel(false);
        }
        
        // Clear system command tracking
        systemCommandsSent.remove(deviceId);
        systemCommandsSent.remove(deviceId + "_DATA_INTERVAL");
        systemCommandsSent.remove(deviceId + "_DATA_ACQUISITION");
        
        // Clear data sync state
        dataSyncState.remove(deviceId);
        dataSyncRetryCount.remove(deviceId);
        deviceRecordCounts.remove(deviceId);
        dataSyncRequested.remove(deviceId);
        
        // Clear notification tracking
        pendingNotificationEnables.remove(deviceId);
        completedNotificationEnables.remove(deviceId);
        
        // Clear descriptor write state
        deviceRTCValidity.remove(deviceId);
        descriptorWriteQueues.remove(deviceId);
        isDescriptorWriteInProgress.remove(deviceId);
        
        // Cancel data sync timer
        ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
        if (syncTimer != null) {
            syncTimer.cancel(false);
            dataSyncTimers.remove(deviceId);
        }
        
        // Cancel set time timer and clear retry tracking
        ScheduledFuture<?> setTimeTimer = setTimeTimeoutTimers.remove(deviceId);
        if (setTimeTimer != null) {
            setTimeTimer.cancel(false);
        }
        setTimeRetryAttempts.remove(deviceId);
        setTimeResponseReceived.remove(deviceId);
        
        // Cancel RSSI monitoring
        ScheduledFuture<?> rssiTask = rssiMonitoringTasks.remove(deviceId);
        if (rssiTask != null && !rssiTask.isCancelled()) {
            rssiTask.cancel(false);
        }
        
        // Cancel health API monitoring
        ScheduledFuture<?> healthTask = healthApiTasks.remove(deviceId);
        if (healthTask != null && !healthTask.isCancelled()) {
            healthTask.cancel(false);
        }
        healthCheckFailures.remove(deviceId);
        
        // Reset device data (keep in map for reconnection)
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData != null) {
            deviceData.batteryLevel = null;
            deviceData.temperature = 0;
            deviceData.steps = 0;
            deviceData.timestamp = System.currentTimeMillis();
            deviceData.connectionState = "disconnected";
            deviceData.services.clear();
            deviceData.characteristics.clear();
        }
        
        // ✅ FIX: Clear emitted event flags on disconnect (will be re-emitted on reconnect)
        hasEmittedServicesDiscovered.remove(deviceId);
        notificationsEnableInProgress.remove(deviceId);
        
        // ✅ FIX: Clear SECURE_READY state on disconnect so it can be re-triggered on reconnect
        // This is critical for auto-reconnection to emit DeviceConnected events to React Native
        SecureReadyState oldState = secureReadyStates.remove(deviceId);
        if (oldState != null) {
            Log.d(TAG, "🧹 [CLEANUP] Cleared SECURE_READY state (" + oldState.name() + ") for disconnected device: " + deviceId);
        }
        
        // Clear connection metadata (will be re-created on reconnect)
        connectionMetadata.remove(deviceId);
    }
    @ReactMethod
    public void cancelConnection(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔌 Manual disconnect from device: " + deviceId + " (system-style)");
            manualDisconnectInProgress.add(deviceId);
            mainHandler.postDelayed(() -> {
                if (manualDisconnectInProgress.contains(deviceId)) {
                    Log.d(TAG, "⏰ Clearing manual disconnect tracking after 30 minutes for: " + deviceId);
                    manualDisconnectInProgress.remove(deviceId);
                }
            }, 1800000); 
            cleanupDeviceResources(deviceId);
            if (connectionManager != null) {
                connectionManager.disconnectDevice(deviceId);
                promise.resolve(true);
            } else {
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                    connectedGatts.remove(deviceId);
                    promise.resolve(true);
                } else {
                    Log.w(TAG, "Device not connected: " + deviceId);
                    promise.resolve(true); 
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error cancelling connection: " + e.getMessage());
            promise.reject("CANCEL_ERROR", e.getMessage());
        }
    }
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
    @ReactMethod
    public void startHealthDataApiMonitoring(String deviceId, int intervalMs, Promise promise) {
        try {
            stopHealthDataApiMonitoringInternal(deviceId);
            Runnable healthApiTask = new Runnable() {
                @Override
                public void run() {
                    try {
                        DeviceData deviceData = deviceDataMap.get(deviceId);
                        if (deviceData != null && deviceData.connectionState != null && deviceData.connectionState.equals("connected")) {
                            WritableMap deviceDataMap = createDeviceInfoMap(deviceData);
                            sendHealthDataApiEvent(deviceId, deviceDataMap);
                        } else {
                            Log.d(TAG, "📤 Device not connected, skipping health data API call for: " + deviceId);
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Health data API monitoring error: " + e.getMessage());
                    }
                }
            };
            ScheduledFuture<?> task = executorService.scheduleAtFixedRate(healthApiTask, 0, intervalMs, TimeUnit.MILLISECONDS);
            healthApiTasks.put(deviceId, task);
            promise.resolve(true);        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting health data API monitoring: " + e.getMessage());
            promise.reject("HEALTH_API_MONITORING_ERROR", e.getMessage());
        }
    }
    private void stopHealthDataApiMonitoringInternal(String deviceId) {
        try {
            ScheduledFuture<?> task = healthApiTasks.remove(deviceId);
            if (task != null) {
                task.cancel(true);            } else {
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
    private void verifyPairingAndConfirmConnection(String deviceId, BluetoothGatt gatt) {
        ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
        if (timer != null) {
            timer.cancel(false);
        }
        if (gatt == null || connectedGatts.get(deviceId) == null) {
            if (gatt != null) {
                handlePairingFailure(deviceId, gatt);
            }
            return;
        }
        BluetoothDevice device = gatt.getDevice();
        int bondState = device.getBondState();
        List<BluetoothGattService> services = gatt.getServices();
        if (bondState == BluetoothDevice.BOND_BONDED && services != null && !services.isEmpty()) {
            confirmConnection(deviceId, gatt);
        } else if (bondState == BluetoothDevice.BOND_BONDED && (services == null || services.isEmpty())) {
            ScheduledFuture<?> extendedTimer = executorService.schedule(() -> {
                verifyPairingAndConfirmConnection(deviceId, gatt);
            }, 2, TimeUnit.SECONDS);
            pairingVerificationTimers.put(deviceId, extendedTimer);
        } else if (bondState == BluetoothDevice.BOND_BONDING) {
            ScheduledFuture<?> extendedTimer = executorService.schedule(() -> {
                verifyPairingAndConfirmConnection(deviceId, gatt);
            }, 5, TimeUnit.SECONDS);
            pairingVerificationTimers.put(deviceId, extendedTimer);
        } else if (bondState == BluetoothDevice.BOND_NONE) {
            int connectionState = 0;
            try {
                connectionState = gatt.getConnectionState(device);
            } catch (Exception e) {
                Log.e(TAG, "❌ Error checking connection state: " + e.getMessage());
            }
            if (connectionState == BluetoothProfile.STATE_CONNECTED && (services != null && !services.isEmpty())) {
                confirmConnection(deviceId, gatt);
            } else if (connectionState == BluetoothProfile.STATE_CONNECTED) {
                ScheduledFuture<?> extendedTimer = executorService.schedule(() -> {
                    verifyPairingAndConfirmConnection(deviceId, gatt);
                }, 3, TimeUnit.SECONDS);
                pairingVerificationTimers.put(deviceId, extendedTimer);
            } else {
                Log.e(TAG, "❌ [PAIRING VERIFICATION] Device not connected and not bonded - pairing failed");
                handlePairingFailure(deviceId, gatt);
            }
        }
    }
    private void confirmConnection(String deviceId, BluetoothGatt gatt) {
        String deviceName = gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId;
        ScheduledFuture<?> timeoutTimer = connectionTimeoutTimers.remove(deviceId);
        if (timeoutTimer != null && !timeoutTimer.isDone()) {
            timeoutTimer.cancel(false);
        }
        devicesPendingPairingVerification.remove(deviceId);
        DeviceData deviceData = deviceDataMap.get(deviceId);
        BluetoothDevice device = gatt.getDevice();
        int bondState = device.getBondState();
        if (bondState == BluetoothDevice.BOND_BONDED) {
            addToBondedDevices(deviceId, device);
        }
        
        // Industry best practice: Don't mark as "connected" or emit DeviceConnected here
        // Only set SECURE_READY state - checkAndEmitDeviceConnected() will emit when fully ready
        // This ensures STATE_CONNECTED ≠ ready (industry rule)
        if (deviceData != null) {
            deviceData.connectionState = "connecting"; // Still completing setup, not ready yet
        }
        
        // Set SECURE_READY state - this will trigger checkAndEmitDeviceConnected() 
        // which only emits DeviceConnected when all setup is complete
        updateSecureReadyState(deviceId, SecureReadyState.SECURE_READY);
        
        // Store connection metadata for DeviceConnected event (will be used by checkAndEmitDeviceConnected)
        WritableMap metadata = Arguments.createMap();
        metadata.putBoolean("pairingVerified", true);
        metadata.putBoolean("isBonded", bondState == BluetoothDevice.BOND_BONDED);
        
        if (systemRestoredDevices.contains(deviceId)) {
            metadata.putString("connectionType", "system_restored");
            systemRestoredDevices.remove(deviceId); 
        } else {
            Boolean isAutoConnection = deviceConnectionType.get(deviceId);
            if (isAutoConnection != null) {
                metadata.putString("connectionType", isAutoConnection ? "auto" : "manual");
            } else {
                metadata.putString("connectionType", "manual");
            }
        }
        
        Boolean wasAlreadyBonded = deviceWasAlreadyBonded.get(deviceId);
        if (wasAlreadyBonded != null) {
            metadata.putBoolean("wasAlreadyBonded", wasAlreadyBonded);
        } else {
            metadata.putBoolean("wasAlreadyBonded", bondState == BluetoothDevice.BOND_BONDED);
        }
        
        connectionMetadata.put(deviceId, metadata);
        
        // Clean up temporary connection tracking
        deviceConnectionType.remove(deviceId);
        deviceWasAlreadyBonded.remove(deviceId);
        List<BluetoothGattService> services = gatt.getServices();
        if (services != null && !services.isEmpty()) {
        }
        if (isScanning.get()) {
            stopScanning();
        }
        activeScannedDevices.add(deviceId);
        deviceLastSeen.put(deviceId, System.currentTimeMillis());
        isProcessingConnection.set(false);
        processConnectionQueue();
    }
    private void handleStatus133ForBondedDevice(String deviceId, BluetoothDevice device, BluetoothGatt failedGatt) {
        // Industry best practice #2: Always fully close GATT (disconnect + close + null)
        try {
            if (failedGatt != null) {
                failedGatt.disconnect();
                failedGatt.close();
                // Explicitly set to null to prevent reuse
                failedGatt = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error closing failed GATT: " + e.getMessage());
        }
        connectedGatts.remove(deviceId);
        synchronized(gattLock) {
            BluetoothGatt existingGatt = connectedGatts.get(deviceId);
            if (existingGatt != null && existingGatt != failedGatt) {
                try {
                    existingGatt.disconnect();
                    existingGatt.close();
                } catch (Exception e) {
                    Log.e(TAG, "❌ Error cleaning up stale GATT: " + e.getMessage());
                }
                connectedGatts.remove(deviceId);
            }
            try {
                BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                if (bluetoothManager != null) {
                    int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                    if (connectionState == BluetoothProfile.STATE_CONNECTED || connectionState == BluetoothProfile.STATE_CONNECTING) {
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Error checking system connection state: " + e.getMessage());
            }
        }
        try {
            Method refreshMethod = BluetoothGatt.class.getMethod("refresh");
            if (refreshMethod != null && failedGatt != null) {
                try {
                    boolean refreshed = (Boolean) refreshMethod.invoke(failedGatt);
                } catch (Exception e) {
                }
            }
        } catch (NoSuchMethodException e) {
        } catch (Exception e) {
        }
        connectingDevices.remove(deviceId);
        String promiseKey = "connect_" + deviceId;
        Promise pendingPromise = pendingConnectionPromises.get(promiseKey);
        if (pendingPromise != null) {
            // Industry best practice #1: Exponential backoff for reconnect
            int retryCount = status133RetryCounts.getOrDefault(deviceId, 0);
            if (retryCount < MAX_STATUS_133_RETRIES) {
                long retryDelay = STATUS_133_RETRY_DELAYS[retryCount];
                status133RetryCounts.put(deviceId, retryCount + 1);
                Log.d(TAG, "🔄 [STATUS 133] Retry " + (retryCount + 1) + "/" + MAX_STATUS_133_RETRIES + 
                      " after " + (retryDelay / 1000) + "s (exponential backoff)");
                
                mainHandler.postDelayed(() -> {
                    Promise stillPending = pendingConnectionPromises.get(promiseKey);
                    if (stillPending != null) {
                        executorService.execute(() -> {
                            try {
                                boolean isManual = !deviceConnectionType.getOrDefault(deviceId, false);
                                WritableMap retryOptions = Arguments.createMap();
                                retryOptions.putBoolean("isManualConnection", isManual);
                                connectToDeviceWithOptions(deviceId, retryOptions, stillPending);
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error retrying connection after status 133: " + e.getMessage());
                                Promise finalPromise = pendingConnectionPromises.remove(promiseKey);
                                if (finalPromise != null) {
                                    finalPromise.reject("GATT_ERROR", "Connection retry failed after cache refresh. Device may be out of range.");
                                }
                                status133RetryCounts.remove(deviceId);
                            }
                        });
                    } else {
                        status133RetryCounts.remove(deviceId);
                    }
                }, retryDelay);
            } else {
                // Max retries reached - give up
                Log.e(TAG, "❌ [STATUS 133] Max retries (" + MAX_STATUS_133_RETRIES + ") reached for " + deviceId);
                status133RetryCounts.remove(deviceId);
                Promise finalPromise = pendingConnectionPromises.remove(promiseKey);
                if (finalPromise != null) {
                    finalPromise.reject("GATT_ERROR", "Connection failed after " + MAX_STATUS_133_RETRIES + 
                                       " retries with exponential backoff. Device may be out of range or needs re-pairing.");
                }
            } 
        } else {
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData != null) {
                deviceData.connectionState = "disconnected";
                sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
            }
        }
    }
    private String getGATTErrorMessage(int status) {
        switch (status) {
            case 0: 
                return "Connection successful";
            case 1: 
                return "Invalid handle";
            case 2: 
                return "Read not permitted";
            case 3: 
                return "Write not permitted";
            case 4: 
                return "Invalid PDU";
            case 5: 
                return "Insufficient authentication - pairing required";
            case 6: 
                return "Request not supported";
            case 7: 
                return "Invalid offset";
            case 8: 
                return "Insufficient authorization - please check permissions";
            case 15: 
                return "Insufficient encryption - device requires encryption";
            case 19: 
                return "Connection timeout - device may be out of range";
            case 22: 
                return "Attribute not found";
            case 133: 
                return "GATT error - connection failed";
            case 147: 
                return "Insufficient authorization - please check device permissions";
            case 257: 
                return "Insufficient authentication - pairing required. Please enter passkey when prompted";
            default:
                return "Connection failed with status: " + status;
        }
    }
    private void processConnectionQueue() {
        if (isProcessingConnection.get()) {
            return; 
        }
        synchronized(connectionQueue) {
            if (connectionQueue.isEmpty()) {
                return; 
            }
            isProcessingConnection.set(true);
            String nextDeviceId = connectionQueue.poll();
            if (nextDeviceId == null) {
                isProcessingConnection.set(false);
                return;
            }
            Long cooldownExpiry = connectionCooldown.get(nextDeviceId);
            if (cooldownExpiry != null && System.currentTimeMillis() < cooldownExpiry) {                connectionQueue.offer(nextDeviceId);
                isProcessingConnection.set(false);
                long delay = cooldownExpiry - System.currentTimeMillis() + 500; 
                executorService.schedule(() -> processConnectionQueue(), delay, TimeUnit.MILLISECONDS);
                return;
            }
            Log.d(TAG, "🔗 Processing connection queue - connecting to: " + nextDeviceId);
            DeviceData deviceData = deviceDataMap.get(nextDeviceId);
            if (deviceData == null) {
                Log.w(TAG, "⚠️ Device not found in scanned devices: " + nextDeviceId);
                isProcessingConnection.set(false);
                processConnectionQueue(); 
                return;
            }
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(nextDeviceId);
            if (device != null) {
                proceedWithGattConnection(device, nextDeviceId);
            } else {
                Log.e(TAG, "❌ Failed to get BluetoothDevice for: " + nextDeviceId);
                isProcessingConnection.set(false);
                processConnectionQueue(); 
            }
        }
    }
    private void enqueueConnection(String deviceId) {
        synchronized(connectionQueue) {
            if (!connectionQueue.contains(deviceId)) {
                connectionQueue.offer(deviceId);
                Log.d(TAG, "📋 Added device to connection queue: " + deviceId + " (queue size: " + connectionQueue.size() + ")");
            } else {
                Log.d(TAG, "📋 Device already in connection queue: " + deviceId);
            }
        }
        processConnectionQueue();
    }
    private void setConnectionCooldown(String deviceId, long cooldownMs) {
        connectionCooldown.put(deviceId, System.currentTimeMillis() + cooldownMs);
        Log.d(TAG, "⏳ Set connection cooldown for " + deviceId + ": " + (cooldownMs/1000) + " seconds");
    }
    private void handlePairingFailure(String deviceId, BluetoothGatt gatt) {
        String deviceName = gatt != null && gatt.getDevice() != null ? 
                           (gatt.getDevice().getName() != null ? gatt.getDevice().getName() : deviceId) : deviceId;
        Log.e(TAG, "❌ [PAIRING FAILURE] Pairing failed for " + deviceName);
        devicesPendingPairingVerification.remove(deviceId);
        ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
        if (timer != null) {
            timer.cancel(false);
        }
        if (gatt != null) {
            try {
                gatt.disconnect();
            } catch (Exception e) {
                Log.e(TAG, "❌ Error disconnecting: " + e.getMessage());
            }
        }
        connectedGatts.remove(deviceId);
        String promiseKey = "connect_" + deviceId;
        Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
        if (pendingPromise != null) {
            pendingPromise.reject("PAIRING_FAILED", "Pairing failed - incorrect passkey or timeout");
        }
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData != null) {
            deviceData.connectionState = "disconnected";
            WritableMap deviceInfo = createDeviceInfoMap(deviceData);
            deviceInfo.putBoolean("pairingFailed", true); 
            sendEvent("DeviceDisconnected", deviceInfo);
        }
        sendLocalNotificationIfBackground("Pairing Failed", "Failed to pair with " + deviceName + ". Please try again.");
    }
    // ============================================================================
    // SYSTEM COMMAND QUEUE MANAGEMENT
    // ============================================================================
    
    /**
     * Send a system command to a BLE device via queue
     * 
     * Purpose:
     * - Sends commands to System Command characteristic (0x1500)
     * - Queues commands to prevent concurrent writes (BLE limitation)
     * - Ensures sequential command execution
     * - Tracks requested data acquisition intervals
     * 
     * System Commands:
     * - CMD_SET_SYSTEM_TIME (0x01): Synchronize device RTC
     * - CMD_SET_DATA_INTERVAL (0x02): Set data sampling interval
     * - CMD_SET_DATA_ACQUISITION (0x03): Start/stop data acquisition
     * - CMD_DATA_SYNC_START (0x04): Initiate historical data sync
     * - CMD_DATA_SYNC_STOP (0x05): Stop data sync
     * - CMD_RESTART_DEVICE (0x06): Reboot device
     * - CMD_START_DFU (0x07): Enter DFU mode
     * - CMD_CLEAR_RECORDS (0x08): Clear stored data
     * 
     * Queue Flow:
     * 1. Add command to queue (per device)
     * 2. Process queue if not busy
     * 3. Send command via BLE
     * 4. Wait for onCharacteristicWrite callback
     * 5. Mark write complete
     * 6. Process next command (100ms delay)
     * 
     * Special Handling:
     * - CMD_SET_DATA_INTERVAL: Tracks requested interval for validation
     * 
     * @param deviceId Device MAC address
     * @param commandId Command ID byte
     * @param payload Command payload (parameters)
     * @return true if queued successfully
     */
    private boolean sendSystemCommand(String deviceId, byte commandId, byte[] payload) {
        // Track requested data acquisition interval for validation
        if (commandId == CMD_SET_DATA_INTERVAL && payload != null && payload.length >= 4) {
            ByteBuffer buffer = ByteBuffer.wrap(payload).order(ByteOrder.LITTLE_ENDIAN);
            int intervalMs = buffer.getInt();
            int requestedIntervalSeconds = intervalMs / 1000;
            requestedDataAcquisitionIntervals.put(deviceId, requestedIntervalSeconds);
        }
        
        // Get or create command queue for device
        Queue<SystemCommandRequest> queue = systemCommandQueues.get(deviceId);
        if (queue == null) {
            queue = new LinkedList<>();
            systemCommandQueues.put(deviceId, queue);
            systemCommandWriteInProgress.put(deviceId, false);
        }
        
        // Add command to queue
        queue.add(new SystemCommandRequest(deviceId, commandId, payload));
        
        // Process queue (will skip if write in progress)
        processSystemCommandQueue(deviceId);
        
        return true;  // Command queued successfully
    }
    
    /**
     * Process system command queue for a device
     * 
     * Purpose:
     * - Ensures sequential command execution (one at a time)
     * - Prevents concurrent writes to System Command characteristic
     * - Handles queue processing after each command completes
     * 
     * Flow:
     * 1. Check if queue exists and has commands
     * 2. Check if write already in progress (skip if busy)
     * 3. Peek at next command (don't remove yet)
     * 4. Mark write in progress
     * 5. Send command with retry logic
     * 6. Wait for onSystemCommandWriteComplete callback
     * 
     * Called From:
     * - sendSystemCommand (new command added)
     * - onSystemCommandWriteComplete (command finished)
     * 
     * @param deviceId Device MAC address
     */
    private void processSystemCommandQueue(String deviceId) {
        Queue<SystemCommandRequest> queue = systemCommandQueues.get(deviceId);
        Boolean inProgress = systemCommandWriteInProgress.get(deviceId);
        
        // No queue or empty queue - nothing to do
        if (queue == null || queue.isEmpty()) {
            return;
        }
        
        // Write already in progress - wait for completion
        if (inProgress != null && inProgress) {
            return;
        }
        
        // Peek at next command (don't remove until write completes)
        SystemCommandRequest request = queue.peek();
        if (request == null) {
            return;
        }
        
        // Mark write in progress
        systemCommandWriteInProgress.put(deviceId, true);
        
        // Send command with retry logic (0 = first attempt)
        sendSystemCommandWithRetry(request.deviceId, request.commandId, request.payload, 0);
    }
    
    /**
     * Handle system command write completion
     * 
     * Purpose:
     * - Called from onCharacteristicWrite callback
     * - Removes completed command from queue
     * - Processes next command in queue (100ms delay)
     * - Logs success/failure for debugging
     * 
     * Flow:
     * 1. Remove completed command from queue (poll)
     * 2. Mark write no longer in progress
     * 3. Log result (success/failure)
     * 4. Schedule next command processing (100ms delay)
     * 
     * Delay Rationale:
     * - 100ms delay between commands allows device to process
     * - Prevents overwhelming device with rapid commands
     * - Improves reliability on slower devices
     * 
     * @param deviceId Device MAC address
     * @param status GATT write status (0 = success)
     */
    private void onSystemCommandWriteComplete(String deviceId, int status) {
        Queue<SystemCommandRequest> queue = systemCommandQueues.get(deviceId);
        if (queue == null) {
            Log.w(TAG, "⚠️ [QUEUE DEBUG] No queue found for device: " + deviceId);
            systemCommandWriteInProgress.put(deviceId, false);
            return;
        }
        
        if (queue.isEmpty()) {
            systemCommandWriteInProgress.put(deviceId, false);
            return;
        }
        
        // Remove completed command from queue
        SystemCommandRequest completedRequest = queue.poll();
        
        // Mark write no longer in progress
        systemCommandWriteInProgress.put(deviceId, false);
        
        // Log result
        if (completedRequest != null) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                // Success - logged elsewhere with more detail
            } else {
                Log.e(TAG, "❌ [SYSTEM COMMAND] Write failed (status=" + status + ") for command 0x" + 
                      String.format("%02X", completedRequest.commandId) + " (" + getCommandName(completedRequest.commandId) + ")");
            }
        } else {
            Log.w(TAG, "⚠️ [QUEUE DEBUG] Completed request was null after poll");
        }
        
        // Process next command (100ms delay for device processing)
        if (!queue.isEmpty()) {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    processSystemCommandQueue(deviceId);
                }
            }, 100);  // 100ms delay between commands
        } else {
            // Queue empty - all commands processed
        }
    }
        // ============================================================================
    // SYSTEM COMMAND RETRY LOGIC
    // ============================================================================
    
    /** Maximum number of retry attempts for system command writes */
    private static final int MAX_SYSTEM_COMMAND_RETRIES = 3;
    
    /** Delay between retry attempts (200ms base, multiplied by attempt number) */
    private static final long SYSTEM_COMMAND_RETRY_DELAY_MS = 200;
    
    /**
     * Send a system command with automatic retry logic
     * 
     * Purpose:
     * - Sends system commands to device with retry on failure
     * - Validates device connection state before sending
     * - Builds command packet with proper formatting
     * - Emits events for command tracking
     * - Handles BLE stack busy conditions
     * 
     * Retry Strategy:
     * - Attempt 1: Immediate send
     * - Attempt 2: Retry after 200ms
     * - Attempt 3: Retry after 400ms
     * - Attempt 4: Retry after 600ms
     * - Max retries: 3 (4 total attempts)
     * 
     * Command Types:
     * - 0x01: CMD_SET_SYSTEM_TIME - Sync device RTC
     * - 0x02: CMD_SET_DATA_INTERVAL - Set sampling interval
     * - 0x03: CMD_SET_DATA_ACQUISITION - Start/stop acquisition
     * - 0x04: CMD_DATA_SYNC_START - Start historical data sync
     * - 0x05: CMD_DATA_SYNC_STOP - Stop data sync
     * - 0x06: CMD_RESTART_DEVICE - Reboot device
     * - 0x07: CMD_START_DFU - Enter DFU mode
     * - 0x08: CMD_CLEAR_RECORDS - Clear stored data
     * - 0x09: CMD_PASSKEY_UPDATE - Update device passkey
     * 
     * Write Type Selection:
     * - Prefers WRITE_TYPE_DEFAULT (with response) for reliability
     * - Falls back to WRITE_TYPE_NO_RESPONSE if default not supported
     * 
     * Event Emission:
     * - Emits "NativeCommandSent" event on first attempt only
     * - Contains command details, payload, and timestamp
     * - Used for debugging and flow tracking
     * 
     * Error Conditions:
     * - Device not connected: Returns false immediately
     * - Characteristic not found: Returns false immediately
     * - Characteristic not writable: Returns false immediately
     * - Write initiation failed: Schedules retry or returns false
     * 
     * @param deviceId Device MAC address
     * @param commandId Command ID byte (0x01-0x09)
     * @param payload Command payload (parameters)
     * @param attempt Current attempt number (0-based)
     * @return true if write initiated successfully, false otherwise
     */
    private boolean sendSystemCommandWithRetry(String deviceId, byte commandId, byte[] payload, int attempt) {
        // Validate GATT connection exists
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "❌ [SYSTEM COMMAND] Failed to send command 0x" + String.format("%02X", commandId) + ": Device not connected");
            return false;
        }
        
        // Verify device is in connected state (additional safety check)
        try {
            BluetoothDevice device = gatt.getDevice();
            if (bluetoothManager != null) {
                int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                if (connectionState != BluetoothProfile.STATE_CONNECTED) {
                    Log.e(TAG, "❌ [SYSTEM COMMAND] Device not in connected state: " + deviceId + " (state: " + connectionState + ")");
                    return false;
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [SYSTEM COMMAND] Could not verify connection state, proceeding anyway: " + e.getMessage());
        }
        // Find System Command characteristic
        BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
        if (systemCommandChar == null) {
            Log.e(TAG, "❌ [SYSTEM COMMAND] Failed to send command 0x" + String.format("%02X", commandId) + ": SYSTEM_COMMAND characteristic not found");
            Log.e(TAG, "   Device: " + deviceId);
            Log.e(TAG, "   UUID: " + SYSTEM_COMMAND_CHAR_UUID);
            return false;
        }
        
        // Validate characteristic is writable
        int properties = systemCommandChar.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        boolean canWriteNoResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        
        if (!canWrite && !canWriteNoResponse) {
            Log.e(TAG, "❌ [SYSTEM COMMAND] System Command characteristic is not writable!");
            Log.e(TAG, "   Device: " + deviceId);
            Log.e(TAG, "   Properties: 0x" + String.format("%02X", properties));
            return false;
        }
        
        // Set write type (prefer with response for reliability)
        if (canWrite) {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        }
        
        // Build command packet (20 bytes: REQUEST_ID + COMMAND_ID + LENGTH + PAYLOAD)
        byte[] packet = buildSystemCommandPacket(commandId, payload);
        if (packet == null || packet.length == 0) {
            Log.e(TAG, "❌ [SYSTEM COMMAND] Failed to build packet for command 0x" + String.format("%02X", commandId));
            return false;
        }
        
        // Set characteristic value
        systemCommandChar.setValue(packet);
        boolean writeResult = gatt.writeCharacteristic(systemCommandChar);
        if (writeResult && attempt == 0) { 
            WritableMap commandEvent = Arguments.createMap();
            commandEvent.putString("deviceId", deviceId);
            commandEvent.putInt("commandId", commandId);
            commandEvent.putString("commandName", getCommandName(commandId));
            if (payload != null && payload.length > 0) {
                StringBuilder payloadHex = new StringBuilder();
                for (int i = 0; i < payload.length && i < 20; i++) { 
                    payloadHex.append(String.format("0x%02X", payload[i]));
                    if (i < payload.length - 1 && i < 19) {
                        payloadHex.append(" ");
                    }
                }
                if (payload.length > 20) {
                    payloadHex.append("...");
                }
                commandEvent.putString("payload", payloadHex.toString());
                commandEvent.putInt("payloadLength", payload.length);
            } else {
                commandEvent.putString("payload", "No payload");
                commandEvent.putInt("payloadLength", 0);
            }
            sendEvent("NativeCommandSent", commandEvent);
        }
        if (!writeResult) {
            if (attempt < MAX_SYSTEM_COMMAND_RETRIES) {
                long delay = SYSTEM_COMMAND_RETRY_DELAY_MS * (attempt + 1); 
                Log.w(TAG, "⚠️ [SYSTEM COMMAND] writeCharacteristic returned false for command 0x" + String.format("%02X", commandId) + 
                      " (attempt " + (attempt + 1) + "/" + MAX_SYSTEM_COMMAND_RETRIES + ") - retrying in " + delay + "ms");
                Log.w(TAG, "   Device: " + deviceId);
                Log.w(TAG, "   Command: " + getCommandName(commandId));
                Log.w(TAG, "   This may indicate BLE stack is busy - will retry");
                final int nextAttempt = attempt + 1;
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        boolean retryResult = sendSystemCommandWithRetry(deviceId, commandId, payload, nextAttempt);
                        if (!retryResult && nextAttempt >= MAX_SYSTEM_COMMAND_RETRIES) {
                            Log.e(TAG, "❌ [SYSTEM COMMAND] All retries failed for command 0x" + String.format("%02X", commandId) + 
                                  " - notifying queue");
                            onSystemCommandWriteComplete(deviceId, BluetoothGatt.GATT_FAILURE);
                        }
                    }
                }, delay);
                return true; 
            } else {
                Log.e(TAG, "❌ [SYSTEM COMMAND] writeCharacteristic returned false for command 0x" + String.format("%02X", commandId) + 
                      " after " + MAX_SYSTEM_COMMAND_RETRIES + " attempts");
                Log.e(TAG, "   Device: " + deviceId);
                Log.e(TAG, "   Packet length: " + packet.length);
                Log.e(TAG, "   Command: " + getCommandName(commandId));
                Log.e(TAG, "   BLE stack may be permanently busy or device is not ready");
                return false;
            }
        } else {
            if (attempt > 0) {
            } else {
            }
        }
        return writeResult;
    }
    // ============================================================================
    // MTU AND CONNECTION STATE UTILITIES
    // ============================================================================
    
    /**
     * Get negotiated MTU for a device
     * 
     * Purpose:
     * - Retrieves the negotiated MTU (Maximum Transmission Unit)
     * - Falls back to DEFAULT_MTU (23 bytes) if not negotiated
     * 
     * MTU Values:
     * - Default: 23 bytes (Android BLE minimum)
     * - Requested: 512 bytes (for large data transfers)
     * - Typical negotiated: 247-517 bytes (device dependent)
     * 
     * @param deviceId Device MAC address
     * @return Negotiated MTU or DEFAULT_MTU (23 bytes)
     */
    private int getNegotiatedMtu(String deviceId) {
        Integer mtu = negotiatedMtuMap.get(deviceId);
        if (mtu != null && mtu > 0) {
            return mtu;
        }
        return DEFAULT_MTU;
    }
    
    /**
     * Get maximum payload size for BLE packets
     * 
     * Purpose:
     * - Calculates usable payload size from MTU
     * - Accounts for 3-byte ATT header overhead
     * 
     * Calculation:
     * - Payload Size = MTU - 3 bytes (ATT overhead)
     * - Default MTU (23) → 20 bytes payload
     * - Negotiated MTU (247) → 244 bytes payload
     * 
     * @param deviceId Device MAC address
     * @return Maximum payload size in bytes
     */
    private int getPayloadSize(String deviceId) {
        return getNegotiatedMtu(deviceId) - 3;
    }
    
    /**
     * Update secure ready state for device connection
     * 
     * Purpose:
     * - Tracks connection setup progress through states
     * - Emits DeviceConnected event when fully ready
     * - Logs state transitions for debugging
     * 
     * State Flow:
     * 1. MTU_NEGOTIATING: Requesting larger MTU
     * 2. SERVICES_DISCOVERING: Discovering GATT services
     * 3. NOTIFICATIONS_ENABLING: Enabling characteristic notifications
     * 4. SECURE_READY: Fully connected and ready for data
     * 
     * When SECURE_READY:
     * - All notifications enabled
     * - Services discovered
     * - MTU negotiated
     * - Device ready for commands and data sync
     * 
     * @param deviceId Device MAC address
     * @param newState New secure ready state
     */
    private void updateSecureReadyState(String deviceId, SecureReadyState newState) {
        SecureReadyState oldState = secureReadyStates.get(deviceId);
        secureReadyStates.put(deviceId, newState);
        Log.d(TAG, "🔒 [SECURE_READY] " + deviceId + ": " + 
              (oldState != null ? oldState.name() : "null") + " → " + newState.name());
        
        // Emit DeviceConnected event when fully ready
        if (newState == SecureReadyState.SECURE_READY) {
            checkAndEmitDeviceConnected(deviceId);
        }
    }
    private void checkAndEmitDeviceConnected(String deviceId) {
        Log.d(TAG, "🔍 [checkAndEmitDeviceConnected] Checking device: " + deviceId);
        
        SecureReadyState state = secureReadyStates.get(deviceId);
        if (state != SecureReadyState.SECURE_READY) {
            Log.d(TAG, "   ⏸️ Not SECURE_READY yet, state=" + (state != null ? state.name() : "null"));
            return; 
        }
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "   ⚠️ GATT is null in connectedGatts - device not in SampleBridgeAndroid map");
            return; 
        }
        DeviceData deviceData = deviceDataMap.get(deviceId);
        if (deviceData == null) {
            Log.w(TAG, "   ⚠️ DeviceData is null");
            return; 
        }
        if ("connected".equals(deviceData.connectionState)) {
            Log.d(TAG, "   ⏸️ Device already marked as connected, skipping duplicate event");
            return; 
        }
        Log.d(TAG, "✅ [SECURE_READY] Device " + deviceId + " is fully ready - emitting DeviceConnected");
        deviceData.connectionState = "connected";
        
        // Industry best practice: Only emit DeviceConnected when SECURE_READY
        // Include connection metadata stored during pairing verification
        WritableMap metadata = connectionMetadata.remove(deviceId);
        
        // Extract metadata values before consuming (WritableMap can only be used once)
        String connectionType = null;
        boolean wasAlreadyBonded = false;
        boolean pairingVerified = false;
        boolean isBonded = false;
        
        if (metadata != null) {
            if (metadata.hasKey("connectionType")) {
                connectionType = metadata.getString("connectionType");
            }
            if (metadata.hasKey("wasAlreadyBonded")) {
                wasAlreadyBonded = metadata.getBoolean("wasAlreadyBonded");
            }
            if (metadata.hasKey("pairingVerified")) {
                pairingVerified = metadata.getBoolean("pairingVerified");
            }
            if (metadata.hasKey("isBonded")) {
                isBonded = metadata.getBoolean("isBonded");
            }
        }
        
        // Create device info for DeviceConnected event
        WritableMap deviceInfo = createDeviceInfoMap(deviceData);
        if (connectionType != null) {
            deviceInfo.putString("connectionType", connectionType);
        }
        deviceInfo.putBoolean("wasAlreadyBonded", wasAlreadyBonded);
        deviceInfo.putBoolean("pairingVerified", pairingVerified);
        deviceInfo.putBoolean("isBonded", isBonded);
        
        // Emit DeviceConnected event (for manual connections)
        sendEvent("DeviceConnected", deviceInfo);
        
        // Industry best practice: Also emit AutoConnectDeviceConnected if this was an auto-connection
        if ("auto".equals(connectionType) || "system_restored".equals(connectionType)) {
            // Create a new WritableMap for AutoConnectDeviceConnected (can't reuse deviceInfo)
            WritableMap autoConnectInfo = createDeviceInfoMap(deviceData);
            autoConnectInfo.putString("connectionType", connectionType);
            autoConnectInfo.putBoolean("wasAlreadyBonded", wasAlreadyBonded);
            autoConnectInfo.putBoolean("pairingVerified", pairingVerified);
            autoConnectInfo.putBoolean("isBonded", isBonded);
            
            // Add auto-connect specific fields
            if (deviceData.temperature == 0) {
                autoConnectInfo.putNull("temperature");
            }
            if (deviceData.steps == 0) {
                autoConnectInfo.putNull("steps");
            }
            sendEvent("AutoConnectDeviceConnected", autoConnectInfo);
            Log.d(TAG, "📢 Sent AutoConnectDeviceConnected event for auto-connected device: " + deviceId + " (after SECURE_READY)");
        }
        
        String promiseKey = "connect_" + deviceId;
        Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
        if (pendingPromise != null) {
            WritableMap result = Arguments.createMap();
            result.putString("status", "connected");
            result.putString("deviceId", deviceId);
            result.putBoolean("wasBonded", isBonded);
            pendingPromise.resolve(result);
        }
    }
    @ReactMethod
    public void startCommandSequence(String deviceId, Promise promise) {
        Boolean previousValue = systemCommandsSent.get(deviceId);
        if (previousValue != null && previousValue) {
            systemCommandsSent.remove(deviceId);
            systemCommandsSent.remove(deviceId + "_DATA_INTERVAL");
        }
        Boolean wasAlreadySet = systemCommandsSent.putIfAbsent(deviceId, true);
        if (wasAlreadySet != null && wasAlreadySet) {
            Log.w(TAG, "⚠️ [NATIVE SEQUENCE] Command sequence already running for " + deviceId);
            WritableMap result = Arguments.createMap();
            result.putString("status", "already_running");
            result.putString("message", "Command sequence already running for this device");
            promise.resolve(result);
            return;
        }
        dataSyncState.put(deviceId, "idle");
        dataSyncRequested.put(deviceId, false);
        DeviceData deviceData = deviceDataMap.get(deviceId);
        // Initialize Device Status read tracking
        deviceStatusReadComplete.put(deviceId, false);
        
        if (deviceData != null && deviceData.isSmartTag) {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt != null) {
                BluetoothGattCharacteristic deviceStatusChar = deviceData.characteristics.get(DEVICE_STATUS_CHAR_UUID);
                if (deviceStatusChar != null) {
                    Log.d(TAG, "📊 [NATIVE SEQUENCE] Reading Device Status to determine RTC validity for " + deviceId);
                    boolean readResult = gatt.readCharacteristic(deviceStatusChar);
                    if (!readResult) {
                        Log.w(TAG, "⚠️ [NATIVE SEQUENCE] Device status read failed - will proceed with RTC as unknown (will send SET time)");
                        // Mark as complete even on failure to avoid blocking
                        deviceStatusReadComplete.put(deviceId, true);
                    }
                } else {
                    Log.w(TAG, "⚠️ [NATIVE SEQUENCE] Device status characteristic not found - will proceed with RTC as unknown");
                    // Mark as complete to avoid blocking
                    deviceStatusReadComplete.put(deviceId, true);
                }
            } else {
                Log.w(TAG, "⚠️ [NATIVE SEQUENCE] GATT not found - will proceed with RTC as unknown");
                // Mark as complete to avoid blocking
                deviceStatusReadComplete.put(deviceId, true);
            }
        } else {
            // Not a smart tag or device data not available - mark as complete
            deviceStatusReadComplete.put(deviceId, true);
        }
        WritableMap result = Arguments.createMap();
        result.putString("status", "success");
        result.putString("message", "Command sequence will start when notifications are ready");
        result.putString("deviceId", deviceId);
        promise.resolve(result);
    }
    private void sendDataAcquisitionAndLiveNotifications(String deviceId) {
        String acquisitionKey = deviceId + "_DATA_ACQUISITION";
        if (systemCommandsSent.getOrDefault(acquisitionKey, false)) {
            return;
        }
        systemCommandsSent.put(acquisitionKey, true);
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        boolean isAlreadyConnected = (gatt != null);
        if (isAlreadyConnected) {
            String currentState = dataSyncState.getOrDefault(deviceId, "idle");
            if (!"syncing".equals(currentState) && !"complete".equals(currentState)) {
                dataSyncState.put(deviceId, "ready");
            }
            dataSyncRetryCount.put(deviceId, 0);
            boolean success = sendDataSyncStartCommand(deviceId, 0);
            if (success) {
            } else {
                Log.e(TAG, "❌ [DATA ACQUISITION] Data sync command failed");
                dataSyncState.put(deviceId, "idle");
            }
        } else {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    String currentState = dataSyncState.getOrDefault(deviceId, "idle");
                    if (!"idle".equals(currentState) && !"ready".equals(currentState)) {
                        Log.w(TAG, "⚠️ [DATA ACQUISITION] Sync already in progress (state: " + currentState + "), skipping duplicate sync");
                        return;
                    }
                    dataSyncRetryCount.put(deviceId, 0);
                    boolean success = sendDataSyncStartCommand(deviceId, 0);
                    if (success) {
                    } else {
                        Log.e(TAG, "❌ [DATA ACQUISITION] Data sync command failed");
                    }
                }
            }, 10000); 
        }
    }
    // ============================================================================
    // TIME SYNCHRONIZATION COMMANDS
    // ============================================================================
    
    /**
     * Send Set System Time command (entry point)
     * 
     * Purpose:
     * - Synchronizes device RTC (Real-Time Clock) with phone time
     * - Required before historical data sync for accurate timestamps
     * - Delegates to overloaded method with retry attempt = 0
     * 
     * @param deviceId Device MAC address
     */
    private void sendSetSystemTimeCommand(String deviceId) {
        sendSetSystemTimeCommand(deviceId, 0);
    }
    
    /**
     * Send Set System Time command with retry tracking
     * 
     * Purpose:
     * - Synchronizes device RTC with current system time
     * - Critical for accurate historical data timestamps
     * - Implements retry logic with 3-second timeout per attempt
     * - Proceeds with data sync even if time sync fails (live data still works)
     * 
     * Time Sync Flow:
     * 1. Update sync state to "time_syncing"
     * 2. Get current Unix timestamp (seconds since epoch)
     * 3. Convert to little-endian 4-byte payload
     * 4. Send CMD_SET_SYSTEM_TIME command
     * 5. Wait for response (3 seconds timeout)
     * 6. Retry if no response (max 2 attempts)
     * 7. Proceed with data sync regardless
     * 
     * Payload Format (4 bytes, little-endian):
     * - Byte 0: Timestamp bits 0-7
     * - Byte 1: Timestamp bits 8-15
     * - Byte 2: Timestamp bits 16-23
     * - Byte 3: Timestamp bits 24-31
     * 
     * Example:
     * - Timestamp: 1640000000 (Unix seconds)
     * - Hex: 0x61C46680
     * - Payload: [0x80, 0x66, 0xC4, 0x61] (little-endian)
     * 
     * Retry Logic:
     * - Attempt 1: Send immediately
     * - Wait 3 seconds for response
     * - Attempt 2: Retry if no response
     * - Wait 3 seconds for response
     * - After 2 attempts: Proceed anyway (RTC may remain invalid)
     * 
     * Response Handling:
     * - Response received: Proceed with data sync
     * - No response after retries: Log error, proceed with data sync
     * - Device will still work for live data even without valid RTC
     * 
     * Event Emission:
     * - Emits "NativeCommandSent" with timestamp details
     * - Includes system timestamp, ISO format, and hex payload
     * - Includes device RTC validity status if known
     * 
     * @param deviceId Device MAC address
     * @param retryAttempt Current retry attempt (0-based, max 1)
     */
    private void sendSetSystemTimeCommand(String deviceId, int retryAttempt) {
        // Update sync state
        dataSyncState.put(deviceId, "time_syncing");
        setTimeResponseReceived.put(deviceId, false);
        
        // Get current Unix timestamp (seconds since epoch)
        long currentTimestamp = System.currentTimeMillis() / 1000;
        
        // Convert timestamp to little-endian 4-byte payload
        byte[] payload = new byte[4];
        payload[0] = (byte) (currentTimestamp & 0xFF);           // LSB (bits 0-7)
        payload[1] = (byte) ((currentTimestamp >> 8) & 0xFF);    // Bits 8-15
        payload[2] = (byte) ((currentTimestamp >> 16) & 0xFF);   // Bits 16-23
        payload[3] = (byte) ((currentTimestamp >> 24) & 0xFF);   // MSB (bits 24-31)
        
        String timestampHex = String.format("%02X%02X%02X%02X", payload[0], payload[1], payload[2], payload[3]);
        if (retryAttempt > 0) {
        } else {
        }
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
        int properties = systemCommandChar.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        boolean canWriteNoResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        if (!canWrite && !canWriteNoResponse) {
            Log.e(TAG, "❌ System Command characteristic is not writable!");
            dataSyncState.put(deviceId, "idle");
            return;
        }
        if (canWrite) {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        }
        byte[] packet = buildSystemCommandPacket(CMD_SET_SYSTEM_TIME, payload);
        systemCommandChar.setValue(packet);
        boolean success = gatt.writeCharacteristic(systemCommandChar);
        if (success && retryAttempt == 0) { 
            WritableMap commandEvent = Arguments.createMap();
            commandEvent.putString("deviceId", deviceId);
            commandEvent.putInt("commandId", CMD_SET_SYSTEM_TIME);
            commandEvent.putString("commandName", "Set System Time");
            if (payload != null && payload.length > 0) {
                StringBuilder payloadHex = new StringBuilder();
                for (int i = 0; i < payload.length && i < 20; i++) {
                    payloadHex.append(String.format("0x%02X", payload[i]));
                    if (i < payload.length - 1 && i < 19) {
                        payloadHex.append(" ");
                    }
                }
                if (payload.length > 20) {
                    payloadHex.append("...");
                }
                commandEvent.putString("payload", payloadHex.toString());
                commandEvent.putInt("payloadLength", payload.length);
            } else {
                commandEvent.putString("payload", "No payload");
                commandEvent.putInt("payloadLength", 0);
            }
            commandEvent.putLong("systemTimestamp", currentTimestamp);
            commandEvent.putString("systemTimestampISO", new java.util.Date(currentTimestamp * 1000).toString());
            commandEvent.putString("timestampHex", timestampHex);
            Boolean rtcValid = deviceRTCValidity.get(deviceId);
            if (rtcValid != null) {
                commandEvent.putBoolean("deviceRTCValid", rtcValid);
            }
            sendEvent("NativeCommandSent", commandEvent);
        }
        if (success) {            ScheduledFuture<?> timeoutTimer = executorService.schedule(() -> {
                Boolean responseReceived = setTimeResponseReceived.get(deviceId);
                if (responseReceived == null || !responseReceived) {
                    int currentRetry = setTimeRetryAttempts.getOrDefault(deviceId, 0);
                    if (currentRetry < 1) {
                        Log.w(TAG, "⚠️ [TIME SYNC TIMEOUT] Set System Time response not received within 3 seconds");
                        Log.w(TAG, "   Retrying SET TIME command (attempt " + (currentRetry + 1) + "/2)...");
                        setTimeRetryAttempts.put(deviceId, currentRetry + 1);
                        setTimeTimeoutTimers.remove(deviceId);
                        mainHandler.postDelayed(() -> {
                            sendSetSystemTimeCommand(deviceId, currentRetry + 1);
                        }, 3000);
                    } else {
                        Log.e(TAG, "❌ [TIME SYNC FAILED] Set System Time response not received after 2 attempts");
                        Log.e(TAG, "   Proceeding with other commands, but RTC may remain invalid");
                        Log.e(TAG, "   Device may not have valid time, but live updates will still work");
                        setTimeTimeoutTimers.remove(deviceId);
                        dataSyncState.put(deviceId, "time_sync_failed");
                        sendDataAcquisitionAndLiveNotifications(deviceId);
                    }
                } else {
                    setTimeTimeoutTimers.remove(deviceId);
                }
            }, 3, java.util.concurrent.TimeUnit.SECONDS);
            setTimeTimeoutTimers.put(deviceId, timeoutTimer);
        } else {
            Log.e(TAG, "❌ Failed to send Set System Time command - writeCharacteristic returned false");
            Log.e(TAG, "   This usually means:");
            Log.e(TAG, "   1. BLE stack is busy with another operation");
            Log.e(TAG, "   2. Connection is in an invalid state");
            Log.e(TAG, "   3. Write queue is full");
            dataSyncState.put(deviceId, "idle");
            setTimeTimeoutTimers.remove(deviceId);
            if (retryAttempt > 0) {
                Log.w(TAG, "⚠️ [RETRY FAILED] Set System Time command failed on retry attempt");
                Log.w(TAG, "   Proceeding with other commands, but RTC may remain invalid");
                sendDataAcquisitionAndLiveNotifications(deviceId);
            }
        }
    }
    // ============================================================================
    // DATA SYNC COMMANDS
    // ============================================================================
    
    /**
     * Send Data Sync Start command to device
     * 
     * Purpose:
     * - Initiates historical data sync from device to app
     * - Retrieves stored records (temperature, steps, etc.)
     * - Implements retry logic and timeout protection
     * - Supports chunked transfer for SDD v1.4 (1000 records per chunk)
     * 
     * Sync Flow:
     * 1. Check if sync already in progress (prevent duplicates)
     * 2. Initialize sync tracking counters
     * 3. Calculate expected chunks for SDD v1.4
     * 4. Update sync state to "syncing"
     * 5. Set 60-second timeout timer
     * 6. Send CMD_DATA_SYNC_START command
     * 7. Wait for sync_start notification from device
     * 8. Receive data records via Data Transfer characteristic
     * 9. Receive sync_complete notification
     * 
     * Sync Tracking (initialized on first attempt):
     * - syncTotalRecords: Expected total records from device
     * - syncRecordsReceived: Count of records received in current chunk
     * - syncCurrentFileNumber: Current chunk number (SDD v1.4)
     * - syncGrandTotalReceived: Total records received across all chunks
     * 
     * Chunking (SDD v1.4):
     * - Device sends max 1000 records per sync
     * - Multiple syncs required for >1000 records
     * - Each sync: CMD_DATA_SYNC_START → records → CMD_DATA_SYNC_STOP
     * - App tracks chunk number and total received
     * 
     * Retry Logic:
     * - Attempt 1: Immediate send
     * - Attempt 2: Retry after 300ms
     * - Attempt 3: Retry after 600ms
     * - Attempt 4: Retry after 1200ms (exponential backoff)
     * - Max retries: 3 (4 total attempts)
     * 
     * Timeout Protection:
     * - 60-second timeout per sync attempt
     * - Clears sync state if no completion
     * - Allows new sync requests after timeout
     * 
     * State Guard:
     * - Prevents duplicate sync commands
     * - Checks "syncing" state before sending
     * - Only applies on first attempt (retries bypass)
     * 
     * Payload:
     * - Single byte: 0x00 (standard sync start)
     * 
     * @param deviceId Device MAC address
     * @param retryAttempt Current retry attempt (0-based)
     * @return true if command sent successfully, false otherwise
     */
    private boolean sendDataSyncStartCommand(String deviceId, int retryAttempt) {
        // FIX: Use a separate flag for "waiting to retry" state to prevent SYNC_GUARD from blocking retries
        // The issue was: we set state to "syncing" before notifications were enabled, then when
        // the retry happened, SYNC_GUARD blocked it because state was already "syncing"
        
        String currentState = dataSyncState.getOrDefault(deviceId, "idle");
        
        // Only block if we're truly syncing (command was actually sent), not if we're waiting to enable notifications
        // FIX: Check if command was actually sent by checking if syncCommandSent flag is set
        Boolean syncCommandActuallySent = syncCommandSentFlags.getOrDefault(deviceId, false);
        
        if ("syncing".equals(currentState) && retryAttempt == 0 && syncCommandActuallySent) {
            Log.w(TAG, "⚠️ [SYNC GUARD] Sync already in progress (state: " + currentState + ", commandSent: true) for " + deviceId + " - skipping duplicate sync command");
            return false;
        }
        
        // Get expected record count from device status
        int recordCount = deviceRecordCounts.getOrDefault(deviceId, 0);
        
        // Initialize sync tracking counters (first attempt only, not on notification-enable retries)
        if (retryAttempt == 0 && !syncCommandActuallySent) {
            syncTotalRecords.put(deviceId, recordCount);
            syncRecordsReceived.put(deviceId, 0);
            syncCurrentFileNumber.put(deviceId, 1);
            syncGrandTotalReceived.put(deviceId, 0);
            
            // Calculate expected chunks for SDD v1.5 (500 records per file)
            int expectedChunks = (recordCount + RECORDS_PER_FILE - 1) / RECORDS_PER_FILE;
            if (expectedChunks > 1) {
                Log.d(TAG, "📦 [MULTI-FILE SYNC] Starting sync for " + deviceId + ": " + recordCount + " records across " + expectedChunks + " files");
            }
        }
        
        int currentFileNum = syncCurrentFileNumber.getOrDefault(deviceId, 1);
        
        // Log record count (for debugging)
        if (recordCount == 0) {
            // No records - sync will complete immediately
            Log.d(TAG, "📊 [DATA SYNC] No records to sync for " + deviceId);
        } else {
            // Has records - expect data transfer
            Log.d(TAG, "📊 [DATA SYNC] Starting file #" + currentFileNum + " sync for " + deviceId + " (" + recordCount + " total records)");
        }
        
        // FIX: Only set state to "syncing" AFTER we've verified we can send the command
        // For now, set it to "preparing" to indicate we're working on it but haven't sent yet
        if (!"syncing".equals(currentState)) {
            dataSyncState.put(deviceId, "preparing");
        }
        
        // Cancel any existing timeout timer
        ScheduledFuture<?> existingTimer = dataSyncTimers.get(deviceId);
        if (existingTimer != null) {
            existingTimer.cancel(false);
        }
        
        // Set 60-second timeout for sync completion
        ScheduledFuture<?> syncTimeoutTimer = executorService.schedule(() -> {
            String timeoutState = dataSyncState.getOrDefault(deviceId, "unknown");
            if ("syncing".equals(timeoutState) || "preparing".equals(timeoutState)) {
                Log.w(TAG, "⚠️ [SYNC TIMEOUT] Data sync did not complete within 60 seconds for " + deviceId);
                Log.w(TAG, "   Clearing sync state to allow new syncs");
                dataSyncState.put(deviceId, "idle");
                dataSyncRequested.put(deviceId, false);
                dataSyncRetryCount.remove(deviceId);
                syncCommandSentFlags.put(deviceId, false);  // Reset the sent flag
            }
            dataSyncTimers.remove(deviceId);
        }, 60, TimeUnit.SECONDS);
        dataSyncTimers.put(deviceId, syncTimeoutTimer);
        
        // Mark sync as requested
        dataSyncRequested.put(deviceId, true);
        
        // FIX: Check if descriptor writes are still in progress before sending command
        // This prevents "BLE stack busy" errors caused by overlapping BLE operations
        Boolean descriptorWriteInProgress = isDescriptorWriteInProgress.get(deviceId);
        Queue<DescriptorWriteRequest> pendingQueue = descriptorWriteQueues.get(deviceId);
        boolean hasPendingDescriptorWrites = (descriptorWriteInProgress != null && descriptorWriteInProgress) || 
                                              (pendingQueue != null && !pendingQueue.isEmpty());
        
        if (hasPendingDescriptorWrites) {
            Log.w(TAG, "⚠️ [DATA SYNC START] Descriptor writes still in progress - waiting before sending command");
            Log.d(TAG, "   inProgress: " + descriptorWriteInProgress + ", queueSize: " + (pendingQueue != null ? pendingQueue.size() : 0));
            // Wait for descriptor writes to complete, then retry
            // FIX: Don't increment retryAttempt for descriptor-wait retries
            mainHandler.postDelayed(() -> {
                sendDataSyncStartCommand(deviceId, retryAttempt);  // Keep same retryAttempt
            }, 500);  // 500ms delay to allow descriptor writes to complete
            return true;  // Return true to indicate we're handling it
        }
        
        // Fix: Ensure System Command characteristic notifications are enabled before sending command
        // This is critical because the device sends BB08 response via notifications
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.e(TAG, "❌ Failed to send Data Sync Start command: Device not connected");
            dataSyncState.put(deviceId, "idle");
            dataSyncRequested.put(deviceId, false);
            syncCommandSentFlags.put(deviceId, false);
            return false;
        }
        BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
        if (systemCommandChar == null) {
            Log.e(TAG, "❌ Failed to send Data Sync Start command: SYSTEM_COMMAND characteristic not found");
            dataSyncState.put(deviceId, "idle");
            dataSyncRequested.put(deviceId, false);
            syncCommandSentFlags.put(deviceId, false);
            return false;
        }
        
        // Check if notifications are enabled - if not, enable them and retry after a delay
        BluetoothGattDescriptor descriptor = systemCommandChar.getDescriptor(
            UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        );
        boolean notificationsEnabled = false;
        if (descriptor != null) {
            byte[] descriptorValue = descriptor.getValue();
            if (descriptorValue != null && descriptorValue.length > 0) {
                // Check if descriptor is set to enable notifications (0x01 0x00)
                notificationsEnabled = (descriptorValue[0] == 0x01 && descriptorValue.length > 1 && descriptorValue[1] == 0x00);
            }
        }
        
        if (!notificationsEnabled) {
            Log.w(TAG, "⚠️ [DATA SYNC START] System Command notifications not enabled - enabling now and will retry");
            enableNotificationsWithTracking(gatt, systemCommandChar, deviceId);
            // Retry after a delay to allow notification enable to complete (descriptor write + confirmation)
            // FIX: Don't increment retryAttempt for notification-enable retries
            mainHandler.postDelayed(() -> {
                sendDataSyncStartCommand(deviceId, retryAttempt);  // Keep same retryAttempt
            }, 800); // Increased delay to ensure descriptor write completes
            return true; // Return true to indicate we're handling it (will retry)
        }
        
        // Now we're ready to actually send the command - set state to "syncing"
        dataSyncState.put(deviceId, "syncing");
        
        // Additional safety: Add small delay even if notifications appear enabled
        // This ensures any pending descriptor writes complete before sending command
        mainHandler.postDelayed(() -> {
            sendDataSyncStartCommandInternal(deviceId, retryAttempt, systemCommandChar, gatt);
        }, 200);
        return true;
    }
    
    private boolean sendDataSyncStartCommandInternal(String deviceId, int retryAttempt, BluetoothGattCharacteristic systemCommandChar, BluetoothGatt gatt) {
        Log.d(TAG, "📤 Sending Data Sync Start command to " + deviceId + " (attempt " + (retryAttempt + 1) + "/3)");
        // Firmware v1.5: Send 2-byte record count (500 = 0x01F4) instead of 1-byte 0x00
        int recordsToSync = 500;  // RECORDS_PER_FILE
        byte[] payload = new byte[]{
            (byte)(recordsToSync & 0xFF),           // LSB
            (byte)((recordsToSync >> 8) & 0xFF)     // MSB
        };
        Log.d(TAG, "   Command: AA 08 02 F4 01 (v1.5: sending " + recordsToSync + " records)");
        int properties = systemCommandChar.getProperties();
        boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
        boolean canWriteNoResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
        if (!canWrite && !canWriteNoResponse) {
            Log.e(TAG, "❌ [DATA SYNC START] System Command characteristic is not writable!");
            dataSyncState.put(deviceId, "ready");
            dataSyncRequested.put(deviceId, false);
            return false;
        }
        if (canWrite) {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
        } else {
            systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
        }
        byte[] packet = buildSystemCommandPacket(CMD_DATA_SYNC_START, payload);
        systemCommandChar.setValue(packet);
        boolean success = gatt.writeCharacteristic(systemCommandChar);
        if (success && retryAttempt == 0) { 
            WritableMap commandEvent = Arguments.createMap();
            commandEvent.putString("deviceId", deviceId);
            commandEvent.putInt("commandId", CMD_DATA_SYNC_START);
            commandEvent.putString("commandName", "Data Sync Start");
            if (payload != null && payload.length > 0) {
                StringBuilder payloadHex = new StringBuilder();
                for (int i = 0; i < payload.length && i < 20; i++) {
                    payloadHex.append(String.format("0x%02X", payload[i]));
                    if (i < payload.length - 1 && i < 19) {
                        payloadHex.append(" ");
                    }
                }
                if (payload.length > 20) {
                    payloadHex.append("...");
                }
                commandEvent.putString("payload", payloadHex.toString());
                commandEvent.putInt("payloadLength", payload.length);
            } else {
                commandEvent.putString("payload", "No payload");
                commandEvent.putInt("payloadLength", 0);
            }
            sendEvent("NativeCommandSent", commandEvent);
        }
        if (success) {
            // FIX: Mark that command was actually sent successfully
            syncCommandSentFlags.put(deviceId, true);
            Log.d(TAG, "✅ [DATA SYNC START] Command written successfully for " + deviceId);
            
            executorService.schedule(() -> {
                boolean stillRequested = dataSyncRequested.getOrDefault(deviceId, false);
                String debugState = dataSyncState.getOrDefault(deviceId, "unknown");
                Log.d(TAG, "      - dataSyncRequested still true: " + stillRequested);
                Log.d(TAG, "      - Current state: " + debugState);
                if (stillRequested && "syncing".equals(debugState)) {
                    Log.d(TAG, "      - Firmware should send sync_start (0x01) notification after DATA_SYNC_START");
                }
            }, 5, TimeUnit.SECONDS);
        } else {
            Log.w(TAG, "⚠️ [DATA SYNC START] Write failed - BLE stack busy (likely descriptor writes in progress)");
            if (retryAttempt < 3) {
                long retryDelayMs = 300 * (1L << retryAttempt);
                mainHandler.postDelayed(() -> {
                    sendDataSyncStartCommand(deviceId, retryAttempt + 1);
                }, retryDelayMs);
                return true;
            } else {
                Log.e(TAG, "❌ [DATA SYNC START] Max retries exceeded - giving up");
                dataSyncState.put(deviceId, "idle");
                dataSyncRequested.put(deviceId, false);
                syncCommandSentFlags.put(deviceId, false);  // Reset the sent flag
                return false;
            }
        }
        return success;
    }
    private void retryDataSyncStart(String deviceId) {
        int currentRetry = dataSyncRetryCount.getOrDefault(deviceId, 0);
        if (currentRetry >= 3) {
            Log.w(TAG, "❌ Max retry attempts reached for device " + deviceId + ". Giving up on data sync.");
            Log.w(TAG, "   Device may not have data OR RTC failed to sync properly.");
            dataSyncState.put(deviceId, "failed");
            dataSyncRetryCount.remove(deviceId);
            return;
        }
        long baseDelayMs = 5000; 
        long delayMs = baseDelayMs * (1L << currentRetry); 
        Log.d(TAG, "🔄 Scheduling data sync retry for device " + deviceId + " in " + (delayMs / 1000) + "s");
        Log.d(TAG, "   Retry reason: Device RTC may need more time to stabilize");
        Log.d(TAG, "   Attempt: " + (currentRetry + 2) + "/4");
        ScheduledFuture<?> existingTimer = dataSyncTimers.remove(deviceId);
        if (existingTimer != null) {
            existingTimer.cancel(false);
        }
        ScheduledFuture<?> retryTimer = executorService.schedule(() -> {
            Log.d(TAG, "⏰ Retrying data sync for device " + deviceId + " (attempt " + (currentRetry + 2) + "/4)");
            Log.d(TAG, "   Total wait time since time sync: " + (10 + (delayMs / 1000)) + "s");
            dataSyncRetryCount.put(deviceId, currentRetry + 1);
            boolean success = sendDataSyncStartCommand(deviceId, currentRetry + 1);
            if (!success) {
                Log.e(TAG, "❌ Retry data sync start failed for device " + deviceId);
            }
        }, delayMs, java.util.concurrent.TimeUnit.MILLISECONDS);
        dataSyncTimers.put(deviceId, retryTimer);
    }
    private boolean sendPasskeyUpdateCommand(String deviceId, String passkey) {
        if (passkey == null || passkey.length() != 6) {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Invalid passkey length: " + (passkey != null ? passkey.length() : 0) + " (expected 6 digits)");
            return false;
        }
        if (!passkey.matches("[0-9]+")) {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Passkey contains non-numeric characters: " + passkey);
            return false;
        }
        int passkeyInt;
        try {
            passkeyInt = Integer.parseInt(passkey);
        } catch (NumberFormatException e) {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Failed to convert passkey to integer: " + passkey);
            return false;
        }
        if (passkeyInt > 999999) {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Passkey out of range: " + passkeyInt + " (max 999999)");
            return false;
        }
        byte[] payload = new byte[3];
        payload[0] = (byte) (passkeyInt & 0xFF);           
        payload[1] = (byte) ((passkeyInt >> 8) & 0xFF);   
        payload[2] = (byte) ((passkeyInt >> 16) & 0xFF);  
        String payloadHex = bytesToHex(payload);
        pendingPasskeyUpdates.put(deviceId, passkey);
        boolean success = sendSystemCommand(deviceId, CMD_PASSKEY_UPDATE, payload);
        if (success) {
        } else {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Failed to send Passkey Update command");
            pendingPasskeyUpdates.remove(deviceId);
        }
        return success;
    }
    private byte[] buildSystemCommandPacket(byte commandId, byte[] payload) {
        byte[] packet = new byte[20];
        packet[0] = REQUEST_ID;
        packet[1] = commandId;
        packet[2] = (byte) (payload != null ? payload.length : 0);
        if (payload != null && payload.length > 0) {
            System.arraycopy(payload, 0, packet, 3, Math.min(payload.length, 17));
        }
        if (commandId == CMD_SET_DATA_INTERVAL) {
            if (payload != null && payload.length >= 4) {
                int intervalMs = ((payload[3] & 0xFF) << 24) | 
                                 ((payload[2] & 0xFF) << 16) | 
                                 ((payload[1] & 0xFF) << 8) | 
                                 (payload[0] & 0xFF);
            }
        }
        return packet;
    }
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
    @ReactMethod
    public void startDataSync(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "📤 Data Sync Start requested for " + deviceId);
            String currentState = dataSyncState.getOrDefault(deviceId, "idle");
            if ("syncing".equals(currentState) || "time_syncing".equals(currentState)) {
                Log.w(TAG, "⚠️ [SYNC GUARD] Sync already in progress (state: " + currentState + ") for " + deviceId + " - rejecting duplicate sync request");
                WritableMap result = Arguments.createMap();
                result.putString("status", "already_syncing");
                result.putString("message", "Data sync already in progress for this device");
                result.putString("deviceId", deviceId);
                result.putString("currentState", currentState);
                promise.resolve(result);
                return;
            }
            Boolean rtcValid = deviceRTCValidity.get(deviceId);
            dataSyncState.put(deviceId, "idle");
            dataSyncRequested.put(deviceId, false);
            if (rtcValid == null || !rtcValid) {
                sendSetSystemTimeCommand(deviceId);
                executorService.schedule(() -> {
                    dataSyncRequested.put(deviceId, true);
                    boolean success = sendDataSyncStartCommand(deviceId, 0);
                    if (success) {
                        WritableMap result = Arguments.createMap();
                        result.putString("status", "success");
                        result.putString("message", "Data sync started (time synced first)");
                        result.putString("deviceId", deviceId);
                        result.putString("state", dataSyncState.getOrDefault(deviceId, "unknown"));
                        result.putBoolean("timeSyncRequired", true);
                        promise.resolve(result);
                    } else {
                        dataSyncRequested.put(deviceId, false);
                        Log.w(TAG, "⚠️ [SYNC] Cleared data sync requested flag due to sync start failure");
                        promise.reject("SYNC_START_ERROR", "Failed to send data sync start command after time sync");
                    }
                }, 6, TimeUnit.SECONDS);
            } else {
                dataSyncRequested.put(deviceId, true);
                boolean success = sendDataSyncStartCommand(deviceId, 0);
                if (success) {
                    WritableMap result = Arguments.createMap();
                    result.putString("status", "success");
                    result.putString("message", "Data sync started (RTC already valid)");
                    result.putString("deviceId", deviceId);
                    result.putString("state", dataSyncState.getOrDefault(deviceId, "unknown"));
                    result.putBoolean("timeSyncRequired", false);
                    promise.resolve(result);
                } else {
                    dataSyncRequested.put(deviceId, false);
                    Log.w(TAG, "⚠️ [SYNC] Cleared data sync requested flag due to sync start failure");
                    promise.reject("SYNC_START_ERROR", "Failed to send data sync start command");
                }
            }
        } catch (Exception e) {
            promise.reject("ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void readDeviceStatus(String deviceId, Promise promise) {
        try {
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
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                Log.w(TAG, "Device not connected: " + deviceId);
                promise.reject("CONNECTION_ERROR", "Device not connected");
                return;
            }
            pendingRSSIPromises.put(deviceId, promise);
            try {
                boolean success = gatt.readRemoteRssi();
                if (!success) {
                    pendingRSSIPromises.remove(deviceId);
                    promise.reject("RSSI_ERROR", "Failed to request RSSI reading");
                }
            } catch (Exception e) {
                String exceptionType = e.getClass().getName();
                if (exceptionType.contains("DeadObjectException")) {
                    Log.w(TAG, "⚠️ DeadObjectException reading RSSI - device disconnected: " + deviceId);
                    pendingRSSIPromises.remove(deviceId);
                    connectedGatts.remove(deviceId);
                    promise.reject("RSSI_ERROR", "Device disconnected");
                } else if (e instanceof IllegalStateException) {
                    Log.w(TAG, "⚠️ IllegalStateException reading RSSI - GATT closed: " + deviceId);
                    pendingRSSIPromises.remove(deviceId);
                    connectedGatts.remove(deviceId);
                    promise.reject("RSSI_ERROR", "GATT connection closed");
                } else {
                    Log.e(TAG, "❌ Unexpected exception reading RSSI: " + deviceId + " - " + exceptionType + ": " + e.getMessage());
                    pendingRSSIPromises.remove(deviceId);
                    promise.reject("RSSI_ERROR", e.getMessage());
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error reading RSSI: " + e.getMessage());
            pendingRSSIPromises.remove(deviceId);
            promise.reject("RSSI_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void startRSSIMonitoring(String deviceId, int intervalMs, Promise promise) {
        try {
            stopRSSIMonitoring(deviceId);
            Runnable rssiTask = new Runnable() {
                @Override
                public void run() {
                    try {
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (gatt != null) {
                            try {
                                gatt.readRemoteRssi();
                            } catch (Exception e) {
                                String exceptionType = e.getClass().getName();
                                if (exceptionType.contains("DeadObjectException")) {
                                    Log.w(TAG, "⚠️ DeadObjectException in RSSI monitoring - device disconnected: " + deviceId);
                                    connectedGatts.remove(deviceId);
                                } else if (e instanceof IllegalStateException) {
                                    Log.w(TAG, "⚠️ IllegalStateException in RSSI monitoring - GATT closed: " + deviceId);
                                    connectedGatts.remove(deviceId);
                                } else {
                                    Log.e(TAG, "❌ Unexpected exception in RSSI monitoring: " + deviceId + " - " + exceptionType + ": " + e.getMessage());
                                }
                            }
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "❌ RSSI monitoring error: " + e.getMessage());
                    }
                }
            };
            ScheduledFuture<?> scheduledTask = executorService.scheduleAtFixedRate(rssiTask, 0, intervalMs, TimeUnit.MILLISECONDS);
            rssiMonitoringTasks.put(deviceId + "_rssi", scheduledTask);
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting RSSI monitoring: " + e.getMessage());
            promise.reject("RSSI_MONITORING_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void stopRSSIMonitoring(String deviceId, Promise promise) {
        try {
            rssiMonitoringTasks.remove(deviceId + "_rssi");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping RSSI monitoring: " + e.getMessage());
            promise.reject("RSSI_MONITORING_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void startAutoConnect(Promise promise) {
        try {            syncSystemBondedDevices();
            if (bondedDeviceIds.isEmpty()) {                promise.resolve(true);
                return;
            }
            autoConnectEnabled.set(true);
            startForegroundService();
            connectionManager.startBackgroundScan();
            connectionManager.connectToBondedDevices();            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting auto-connect: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void stopAutoConnect(Promise promise) {
        try {            autoConnectEnabled.set(false);
            connectionManager.stopBackgroundScan();
            for (String deviceId : connectedGatts.keySet()) {
                connectionManager.disconnectDevice(deviceId);
            }            promise.resolve(true);
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
            bondedDeviceIds.add(deviceId);
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
            DeviceData deviceData = deviceDataMap.get(deviceId);
            boolean wasConnected = false;
            synchronized(gattLock) {
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt != null) {
                    wasConnected = true;
                    try {
                        gatt.disconnect();
                        gatt.close();
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Error disconnecting GATT during forget: " + e.getMessage());
                    }
                    connectedGatts.remove(deviceId);
                    cleanupDeviceResources(deviceId);
                }
            }
            if (deviceData != null) {
                deviceData.connectionState = "disconnected";
                deviceDataMap.put(deviceId, deviceData);
                if (wasConnected) {
                    WritableMap disconnectInfo = createDeviceInfoMap(deviceData);
                    disconnectInfo.putString("reason", "forgotten");
                    disconnectInfo.putBoolean("forgotten", true);
                    sendEvent("DeviceDisconnected", disconnectInfo);
                }
            }
            bondedDeviceIds.remove(deviceId);
            forgottenDeviceIds.add(deviceId);
            saveBondedDevices();
            saveForgottenDevices(); 
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
    @ReactMethod
    public void disconnectFromDevice(String deviceId, Promise promise) {
        try {
            synchronized(gattLock) {
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt != null) {
                    manualDisconnectInProgress.add(deviceId);
                    mainHandler.postDelayed(() -> {
                        manualDisconnectInProgress.remove(deviceId);
                        Log.d(TAG, "🔄 Cleared manual disconnect tracking for: " + deviceId + " after timeout");
                    }, 1800000); 
                    gatt.disconnect();
                    devicesWaitingForBonding.remove(deviceId);
                    pendingServiceDiscoveryPromises.remove(deviceId);
                    ScheduledFuture<?> pairingTimer = pairingVerificationTimers.remove(deviceId);
                    if (pairingTimer != null) {
                        pairingTimer.cancel(false);
                    }
                    devicesPendingPairingVerification.remove(deviceId);
                    ScheduledFuture<?> connectionTimeoutTimer = connectionTimeoutTimers.remove(deviceId);
                    if (connectionTimeoutTimer != null) {
                        connectionTimeoutTimer.cancel(false);
                    }                    WritableMap result = Arguments.createMap();
                    result.putString("status", "disconnection_initiated");
                    result.putString("deviceId", deviceId);
                    promise.resolve(result);
                } else {
                    promise.reject("DEVICE_NOT_CONNECTED", "Device not connected");
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error disconnecting from device: " + e.getMessage(), e);
            promise.reject("DISCONNECT_ERROR", "Failed to disconnect: " + e.getMessage());
        }
    }
    @ReactMethod
    public void disconnectFromNative(String deviceId, Promise promise) {
        try {
            synchronized(gattLock) {
                BluetoothGatt gatt = connectedGatts.get(deviceId);
                if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                    connectedGatts.remove(deviceId);
                    systemCommandsSent.remove(deviceId);
                    dataSyncState.remove(deviceId);
                    Log.d(TAG, "🔌 Device disconnected from native: " + deviceId);
                    WritableMap result = Arguments.createMap();
                    result.putBoolean("success", true);
                    result.putString("message", "Device disconnected from native Android");
                    result.putString("deviceId", deviceId);
                    promise.resolve(result);
                } else {
                    WritableMap result = Arguments.createMap();
                    result.putBoolean("success", true);
                    result.putString("message", "Device not in native connected list");
                    result.putString("deviceId", deviceId);
                    promise.resolve(result);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error disconnecting from native: " + e.getMessage(), e);
            promise.reject("DISCONNECT_ERROR", "Failed to disconnect from native: " + e.getMessage());
        }
    }
    @ReactMethod
    public void readRSSI(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected");
                return;
            }
            String promiseKey = "rssi_" + deviceId;
            pendingRSSIPromises.put(promiseKey, promise);
            boolean readSuccess = gatt.readRemoteRssi();
            if (!readSuccess) {
                pendingRSSIPromises.remove(promiseKey);
                promise.reject("RSSI_READ_FAILED", "Failed to initiate RSSI read");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error reading RSSI: " + e.getMessage(), e);
            promise.reject("RSSI_ERROR", "Failed to read RSSI: " + e.getMessage());
        }
    }
    @ReactMethod
    public void discoverServices(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected");
                return;
            }
            String promiseKey = "discover_services_" + deviceId;
            pendingServiceDiscoveryPromises.put(promiseKey, promise);
            ScheduledFuture<?> timeoutTask = executorService.schedule(() -> {
                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(promiseKey);
                if (pendingPromise != null) {
                    pendingPromise.reject("SERVICE_DISCOVERY_TIMEOUT", "Service discovery timeout after 10 seconds");
                    Log.w(TAG, "⏱️ Service discovery timeout for device: " + deviceId);
                }
            }, 10, TimeUnit.SECONDS);
            serviceDiscoveryTimeouts.put(deviceId, timeoutTask);
            boolean discoverSuccess = gatt.discoverServices();
            if (!discoverSuccess) {
                pendingServiceDiscoveryPromises.remove(promiseKey);
                if (timeoutTask != null) {
                    timeoutTask.cancel(false);
                }
                serviceDiscoveryTimeouts.remove(deviceId);
                promise.reject("SERVICE_DISCOVERY_FAILED", "Failed to initiate service discovery");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error discovering services: " + e.getMessage(), e);
            promise.reject("SERVICE_DISCOVERY_ERROR", "Failed to discover services: " + e.getMessage());
        }
    }
    @ReactMethod
    public void getManufacturerInfo(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putInt("manufacturerId", SMART_TAG_MANUFACTURER_ID);
            result.putString("manufacturerIdHex", String.format("0x%04X", SMART_TAG_MANUFACTURER_ID));
            result.putString("manufacturerIdLittleEndian", 
                String.format("0x%02X%02X", 
                    SMART_TAG_MANUFACTURER_ID & 0xFF, 
                    (SMART_TAG_MANUFACTURER_ID >> 8) & 0xFF));
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting manufacturer info: " + e.getMessage());
            promise.reject("MANUFACTURER_INFO_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void updatePasskey(String deviceId, String passkey, Promise promise) {
        try {
            if (passkey == null || passkey.length() != 6) {
                promise.reject("INVALID_PASSKEY", "Passkey must be exactly 6 digits (0-9), got " + (passkey != null ? passkey.length() : 0) + " characters");
                return;
            }
            if (!passkey.matches("[0-9]+")) {
                promise.reject("INVALID_PASSKEY", "Passkey must contain only numeric digits (0-9)");
                return;
            }
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.reject("DEVICE_NOT_CONNECTED", "Device not connected: " + deviceId);
                return;
            }
            boolean success = sendPasskeyUpdateCommand(deviceId, passkey);
            if (success) {
                WritableMap result = Arguments.createMap();
                result.putBoolean("success", true);
                result.putString("deviceId", deviceId);
                result.putString("message", "Passkey update command sent successfully");
                result.putString("passkey", passkey);
                promise.resolve(result);
            } else {
                promise.reject("PASSKEY_UPDATE_ERROR", "Failed to send passkey update command");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ [PASSKEY UPDATE] Error updating passkey: " + e.getMessage());
            promise.reject("PASSKEY_UPDATE_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void debugConnectionStatus(Promise promise) {
        try {
            WritableMap status = Arguments.createMap();
            if (bluetoothAdapter != null) {
                status.putInt("centralManagerState", bluetoothAdapter.getState());
                status.putBoolean("isScanning", isScanning.get());
            } else {
                status.putInt("centralManagerState", -1);
                status.putBoolean("isScanning", false);
            }
            status.putInt("connectingDevicesCount", 0); 
            status.putInt("connectedDevicesCount", connectedGatts.size());
            status.putInt("bondedDevicesCount", bondedDeviceIds.size());
            status.putBoolean("autoConnectEnabled", autoConnectEnabled.get());
            WritableArray connectedDevices = Arguments.createArray();
            for (Map.Entry<String, BluetoothGatt> entry : connectedGatts.entrySet()) {
                WritableMap deviceInfo = Arguments.createMap();
                BluetoothDevice device = entry.getValue().getDevice();
                try {
                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                        deviceInfo.putString("name", device.getName() != null ? device.getName() : "Unknown");
                    } else {
                        deviceInfo.putString("name", "Unknown (no permission)");
                    }
                } catch (SecurityException e) {
                    deviceInfo.putString("name", "Unknown (security exception)");
                }
                deviceInfo.putString("uuid", device.getAddress());
                deviceInfo.putInt("state", bluetoothManager.getConnectionState(device, BluetoothProfile.GATT));
                connectedDevices.pushMap(deviceInfo);
            }
            status.putArray("connectedDevices", connectedDevices);
            WritableArray bondedDevices = Arguments.createArray();
            for (String deviceId : bondedDeviceIds) {
                bondedDevices.pushString(deviceId);
            }
            status.putArray("bondedDevices", bondedDevices);
            Log.d(TAG, "🔍 Debug connection status: " + status.toString());
            promise.resolve(status);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting debug connection status: " + e.getMessage(), e);
            promise.reject("DEBUG_STATUS_ERROR", "Failed to get debug status: " + e.getMessage());
        }
    }
    @ReactMethod
    public void connectToKnownPeripherals(Promise promise) {
        try {
            if (bluetoothAdapter == null || !bluetoothAdapter.isEnabled()) {
                promise.reject("BT_NOT_READY", "Bluetooth not ready");
                return;
            }
            if (bondedDeviceIds.isEmpty()) {
                WritableMap result = Arguments.createMap();
                result.putString("status", "No bonded devices to connect");
                result.putInt("attempted", 0);
                promise.resolve(result);
                return;
            }
            int attempted = 0;
            for (String deviceId : bondedDeviceIds) {
                try {
                    if (connectedGatts.containsKey(deviceId)) {
                        Log.d(TAG, "⏭️ Device already connected: " + deviceId);
                        continue;
                    }
                    BluetoothDevice device = bluetoothAdapter.getRemoteDevice(deviceId);
                    if (device != null) {
                        BluetoothManager bluetoothManager = (BluetoothManager) getReactApplicationContext().getSystemService(Context.BLUETOOTH_SERVICE);
                        int connectionState = bluetoothManager.getConnectionState(device, BluetoothProfile.GATT);
                        if (connectionState != BluetoothProfile.STATE_CONNECTED) {
                            Log.d(TAG, "🔗 Attempting to connect to known peripheral: " + deviceId);
                            mainHandler.post(() -> {
                                try {
                                    proceedWithGattConnection(device, deviceId);
                                } catch (Exception e) {
                                    Log.e(TAG, "❌ Error connecting to known peripheral " + deviceId + ": " + e.getMessage());
                                }
                            });
                            attempted++;
                        } else {
                            Log.d(TAG, "✅ Device already connected (system level): " + deviceId);
                        }
                    }
                } catch (Exception e) {
                    Log.e(TAG, "❌ Error processing bonded device " + deviceId + ": " + e.getMessage());
                }
            }
            WritableMap result = Arguments.createMap();
            result.putString("status", "Connection attempts started");
            result.putInt("attempted", attempted);
            result.putInt("knownPeripherals", bondedDeviceIds.size());
            promise.resolve(result);
            Log.d(TAG, "🔗 Connection attempts completed: " + attempted + " devices");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error connecting to known peripherals: " + e.getMessage(), e);
            promise.reject("CONNECT_ERROR", "Failed to connect to known peripherals: " + e.getMessage());
        }
    }
    @ReactMethod
    public void getResourceStatus(Promise promise) {
        try {
            WritableMap status = Arguments.createMap();
            status.putInt("connectedDevices", connectedGatts.size());
            status.putInt("connectingDevices", 0); 
            status.putInt("bondedDevices", bondedDeviceIds.size());
            status.putInt("forgottenDevices", forgottenDeviceIds.size());
            WritableMap activeTimers = Arguments.createMap();
            activeTimers.putInt("serviceDiscovery", serviceDiscoveryTimeouts.size());
            activeTimers.putInt("reconnect", 0); 
            activeTimers.putInt("dataSync", dataSyncTimers.size());
            status.putMap("activeTimers", activeTimers);
            WritableMap activeState = Arguments.createMap();
            activeState.putInt("dataSyncStates", dataSyncState.size());
            activeState.putInt("deviceServices", 0); 
            activeState.putInt("deviceCharacteristics", 0); 
            status.putMap("activeState", activeState);
            WritableMap memoryPressure = Arguments.createMap();
            memoryPressure.putInt("pendingPromises", pendingConnectionPromises.size() + pendingRSSIPromises.size() + pendingServiceDiscoveryPromises.size());
            memoryPressure.putInt("pendingRejecters", 0); 
            memoryPressure.putInt("errorContexts", 0); 
            status.putMap("memoryPressure", memoryPressure);
            promise.resolve(status);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error getting resource status: " + e.getMessage(), e);
            promise.reject("RESOURCE_STATUS_ERROR", "Failed to get resource status: " + e.getMessage());
        }
    }
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
            rssiMonitoringTasks.remove(deviceId + "_rssi");
        } catch (Exception e) {
            Log.e(TAG, "Error stopping RSSI monitoring: " + e.getMessage());
        }
    }
    @ReactMethod
    public void readCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
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
        int properties = characteristic.getProperties();
        if ((properties & BluetoothGattCharacteristic.PROPERTY_READ) == 0) {
            Log.w(TAG, "⚠️ Characteristic " + characteristicUUID + " does not support read operation (properties: 0x" + 
                  Integer.toHexString(properties) + ")");
            promise.reject("READ_NOT_SUPPORTED", "Characteristic " + characteristicUUID + " does not support read operation");
            return;
        }
        String promiseKey = deviceId + "_" + characteristicUUID;
        pendingCharacteristicPromises.put(promiseKey, promise);
        boolean success = gatt.readCharacteristic(characteristic);
        if (!success) {
            pendingCharacteristicPromises.remove(promiseKey);
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            Integer attempts = readRetryAttempts.getOrDefault(errorKey, 0);
            int maxRetries = 3; 
            if (attempts < maxRetries) {
                readRetryAttempts.put(errorKey, attempts + 1);
                long delayMs = (attempts + 1) * 2000L; 
            Log.w(TAG, "⚠️ Failed to initiate read for characteristic " + characteristicUUID + 
                      " - scheduling retry in " + delayMs + "ms (attempt " + (attempts + 1) + "/" + maxRetries + ")");
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        retryReadCharacteristic(deviceId, serviceUUID, characteristicUUID);
                    }
                }, delayMs);
            } else {
                readRetryAttempts.remove(errorKey);
                Log.w(TAG, "⚠️ Failed to initiate read for characteristic " + characteristicUUID + 
                      " after " + maxRetries + " attempts - BLE stack may be busy or characteristic is not readable in current state");
                promise.reject("READ_FAILED", "Failed to initiate read for characteristic " + characteristicUUID + " after " + maxRetries + " attempts");
            }
        } else {
            Log.d(TAG, "✅ Read initiated successfully for characteristic " + characteristicUUID);
        }
    }
    private void retryReadCharacteristic(String deviceId, String serviceUUID, String characteristicUUID) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ Cannot retry read - device not connected: " + deviceId);
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            readRetryAttempts.remove(errorKey);
            return;
        }
        BluetoothGattService service = gatt.getService(UUID.fromString(serviceUUID));
        if (service == null) {
            Log.w(TAG, "⚠️ Cannot retry read - service not found: " + serviceUUID);
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            readRetryAttempts.remove(errorKey);
            return;
        }
        BluetoothGattCharacteristic characteristic = service.getCharacteristic(UUID.fromString(characteristicUUID));
        if (characteristic == null) {
            Log.w(TAG, "⚠️ Cannot retry read - characteristic not found: " + characteristicUUID);
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            readRetryAttempts.remove(errorKey);
            return;
        }
        int properties = characteristic.getProperties();
        if ((properties & BluetoothGattCharacteristic.PROPERTY_READ) == 0) {
            Log.w(TAG, "⚠️ Cannot retry read - characteristic does not support read: " + characteristicUUID);
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            readRetryAttempts.remove(errorKey);
            return;
        }
        Log.d(TAG, "🔄 Retrying read for characteristic " + characteristicUUID + " on device " + deviceId);
        boolean success = gatt.readCharacteristic(characteristic);
        if (!success) {
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            Integer attempts = readRetryAttempts.getOrDefault(errorKey, 0);
            int maxRetries = 3;
            if (attempts < maxRetries) {
                readRetryAttempts.put(errorKey, attempts + 1);
                long delayMs = (attempts + 1) * 2000L; 
                Log.w(TAG, "⚠️ Retry read failed - scheduling another retry in " + delayMs + "ms (attempt " + (attempts + 1) + "/" + maxRetries + ")");
                mainHandler.postDelayed(new Runnable() {
                    @Override
                    public void run() {
                        retryReadCharacteristic(deviceId, serviceUUID, characteristicUUID);
                    }
                }, delayMs);
            } else {
                readRetryAttempts.remove(errorKey);
                String promiseKey = deviceId + "_" + characteristicUUID;
                Promise promise = pendingCharacteristicPromises.remove(promiseKey);
                if (promise != null) {
                    Log.w(TAG, "❌ Max retry attempts reached for read operation on " + characteristicUUID);
                    promise.reject("READ_FAILED", "Failed to read characteristic " + characteristicUUID + " after " + maxRetries + " retry attempts");
                }
            }
        } else {
            String errorKey = deviceId + "_" + characteristicUUID + "_read";
            readRetryAttempts.remove(errorKey);
            Log.d(TAG, "✅ Retry read initiated successfully for characteristic " + characteristicUUID);
        }
    }
    @ReactMethod
    public void writeDescriptorForService(String deviceId, String serviceUUID, String characteristicUUID, String descriptorUUID, String value, Promise promise) {
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
        byte[] valueBytes = hexStringToByteArray(value);
        descriptor.setValue(valueBytes);
        pendingDescriptorPromises.put(deviceId + "_" + descriptorUUID, promise);
        boolean success = gatt.writeDescriptor(descriptor);
        if (!success) {
            pendingDescriptorPromises.remove(deviceId + "_" + descriptorUUID);
            promise.reject("WRITE_FAILED", "Failed to initiate write for descriptor " + descriptorUUID);
        }
    }
    @ReactMethod
    public void monitorCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
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
        boolean success = gatt.setCharacteristicNotification(characteristic, true);
        if (!success) {
            promise.reject("NOTIFICATION_FAILED", "Failed to enable notifications for characteristic " + characteristicUUID);
            return;
        }
        BluetoothGattDescriptor cccdDescriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (cccdDescriptor != null) {
            cccdDescriptor.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(cccdDescriptor);
        }
        String key = deviceId + "_" + characteristicUUID;
        monitoredCharacteristics.put(key, characteristic);
        promise.resolve(true);
    }
    @ReactMethod
    public void stopMonitoringCharacteristicForService(String deviceId, String serviceUUID, String characteristicUUID, Promise promise) {
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
        boolean success = gatt.setCharacteristicNotification(characteristic, false);
        if (!success) {
            promise.reject("NOTIFICATION_FAILED", "Failed to disable notifications for characteristic " + characteristicUUID);
            return;
        }
        BluetoothGattDescriptor cccdDescriptor = characteristic.getDescriptor(UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"));
        if (cccdDescriptor != null) {
            cccdDescriptor.setValue(BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
            gatt.writeDescriptor(cccdDescriptor);
        }
        String key = deviceId + "_" + characteristicUUID;
        monitoredCharacteristics.remove(key);
        promise.resolve(true);
    }
    // ============================================================================
    // CLEANUP AND LIFECYCLE MANAGEMENT
    // ============================================================================
    
    /**
     * Clean up all BLE resources and connections
     * 
     * Purpose:
     * - Gracefully releases all BLE resources
     * - Disconnects all active GATT connections
     * - Stops all background tasks and timers
     * - Clears all state tracking maps
     * - Unregisters broadcast receivers
     * - Prevents memory leaks and resource exhaustion
     * 
     * Cleanup Order:
     * 1. Shutdown transaction manager
     * 2. Stop BLE scanning
     * 3. Disconnect all devices
     * 4. Clear bonded devices cache
     * 5. Clear connection maps
     * 6. Clear device data
     * 7. Clear characteristics cache
     * 8. Clear manual disconnect tracking
     * 9. Clear pending writes
     * 10. Clear pending promises
     * 11. Stop health API monitoring tasks
     * 12. Shutdown executor service (graceful → forced)
     * 13. Stop foreground service
     * 14. Unregister pairing receiver
     * 
     * Executor Shutdown:
     * - Graceful shutdown: Wait up to 5 seconds
     * - Force shutdown: Interrupt all tasks if timeout
     * - Restore interrupt flag if interrupted
     * 
     * Broadcast Receiver:
     * - Unregisters pairing receiver safely
     * - Logs but doesn't fail on errors
     * 
     * Called From:
     * - onCatalystInstanceDestroy (React Native lifecycle)
     * - cleanupResources (React Native bridge method)
     * - Module teardown
     * 
     * Note:
     * - Safe to call multiple times
     * - Should be called before app termination
     * - Prevents "Receiver not registered" exceptions
     */
    private void cleanup() {
        // Shutdown transaction manager
        if (transactionManager != null) {
            transactionManager.shutdown();
        }
        
        // Stop BLE scanning
        stopScanning();
        
        // Disconnect all devices
        for (String deviceId : connectedGatts.keySet()) {
            disconnectDevice(deviceId);
        }
        
        // Clear all state maps
        bondedDevices.clear();
        connectedGatts.clear();
        deviceDataMap.clear();
        deviceCharacteristics.clear();
        manualDisconnectInProgress.clear();
        pendingWrites.clear();
        writeTransactionIds.clear();
        pendingReadPromises.clear();
        pendingServiceDiscoveryPromises.clear();
        
        // Stop all health API monitoring tasks
        for (String deviceId : healthApiTasks.keySet()) {
            stopHealthDataApiMonitoringInternal(deviceId);
        }
        healthApiTasks.clear();
        
        // Shutdown executor service (graceful → forced)
        if (executorService != null && !executorService.isShutdown()) {
            executorService.shutdown();  // Initiate graceful shutdown
            try {
                // Wait up to 5 seconds for tasks to complete
                if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                    // Force shutdown if timeout exceeded
                    executorService.shutdownNow();
                }
            } catch (InterruptedException e) {
                // Force shutdown if interrupted
                executorService.shutdownNow();
                Thread.currentThread().interrupt();
            }
        }
        
        // Stop foreground service
        stopForegroundService();
        
        // Unregister pairing receiver
        try {
            if (pairingReceiver != null) {
                getReactApplicationContext().unregisterReceiver(pairingReceiver);
            }
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [PAIRING] Error unregistering pairing receiver: " + e.getMessage());
        }
    }
    /**
     * React Native lifecycle callback - module instance is being destroyed
     * 
     * Purpose:
     * - Called when React Native context is being torn down
     * - Ensures complete cleanup of all BLE resources
     * - Prevents memory leaks and resource exhaustion
     * - Handles graceful shutdown of background tasks
     * 
     * Cleanup Phases:
     * 
     * Phase 1: Cancel Health Check Timer
     * - Stops periodic health check timer
     * - Prevents timer callbacks after destruction
     * 
     * Phase 2: Cancel Scheduled Tasks
     * - Health API monitoring tasks (per device)
     * - Data sync timeout timers (per device)
     * - Connection timeout timers (per device)
     * - Clears all task maps
     * 
     * Phase 3: Shutdown BLE Handler Thread
     * - Gracefully quits HandlerThread
     * - Waits up to 1 second for termination
     * - Interrupts thread if timeout exceeded
     * - Nullifies thread and handler references
     * 
     * Phase 4: Shutdown Executor Service
     * - Graceful shutdown (5 seconds timeout)
     * - Force shutdown if tasks don't complete
     * - Handles interruption correctly
     * 
     * Phase 5: Disconnect All Devices
     * - Iterates through connected GATT connections
     * - Disconnects and closes each connection
     * - Logs but doesn't fail on errors
     * 
     * Phase 6: Clear All Maps
     * - Connected GATT connections
     * - Device data cache
     * - Characteristics cache
     * - Bonded devices cache
     * - RSSI monitoring tasks
     * 
     * Phase 7: Final Cleanup
     * - Calls cleanup() for complete resource release
     * - Stops foreground service
     * - Unregisters broadcast receivers
     * 
     * Error Handling:
     * - Logs errors but continues cleanup
     * - Ensures all cleanup phases execute
     * - Prevents partial cleanup state
     * 
     * Threading:
     * - Called on main thread by React Native
     * - Some cleanup operations use background threads
     * - Waits for background operations to complete
     * 
     * Note:
     * - Should complete quickly (< 6 seconds total)
     * - Android may kill process if too slow
     * - Critical to prevent ANR (Application Not Responding)
     */
    @Override
    public void onCatalystInstanceDestroy() {
        super.onCatalystInstanceDestroy();
        
        // Phase 1: Cancel health check timer
        if (healthCheckTimer != null) {
            healthCheckTimer.cancel();
            healthCheckTimer = null;
        }
        
        // Phase 2: Cancel all scheduled tasks
        // Cancel health API tasks
        for (ScheduledFuture<?> future : healthApiTasks.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        healthApiTasks.clear();
        
        // Cancel data sync timers
        for (ScheduledFuture<?> future : dataSyncTimers.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        dataSyncTimers.clear();
        
        // Cancel connection timeout timers
        for (ScheduledFuture<?> future : connectionTimeoutTimers.values()) {
            if (future != null && !future.isCancelled()) {
                future.cancel(true);
            }
        }
        connectionTimeoutTimers.clear();
        
        // Phase 3: Shutdown BLE handler thread
        if (bleHandlerThread != null) {
            try {
                bleHandlerThread.quitSafely();
                bleHandlerThread.join(1000);  // Wait up to 1 second
                
                if (bleHandlerThread.isAlive()) {
                    Log.w(TAG, "⚠️ BLE HandlerThread did not terminate gracefully");
                } else {
                    // Thread terminated successfully
                }
            } catch (InterruptedException e) {
                Log.e(TAG, "❌ Error shutting down BLE HandlerThread: " + e.getMessage());
                bleHandlerThread.interrupt();
            }
            bleHandlerThread = null;
            bleHandler = null;
        }
        
        // Phase 4: Shutdown executor service
        if (executorService != null && !executorService.isShutdown()) {
            executorService.shutdown();
            try {
                // Wait up to 5 seconds for tasks to complete
                if (!executorService.awaitTermination(5, TimeUnit.SECONDS)) {
                    executorService.shutdownNow();
                }
            } catch (InterruptedException e) {
                executorService.shutdownNow();
            }
        }
        
        // Phase 5: Disconnect all devices
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
        
        // Phase 6: Clear all maps
        connectedGatts.clear();
        deviceDataMap.clear();
        deviceCharacteristics.clear();
        bondedDevices.clear();
        rssiMonitoringTasks.clear();
        
        // Phase 7: Final cleanup
        cleanup();
    }
    @ReactMethod
    public void isDeviceBonded(String deviceId, Promise promise) {
        try {            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
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
            boolean isBonded = device.getBondState() == BluetoothDevice.BOND_BONDED;
            Log.d(TAG, "🔐 Device " + deviceId + " bonding status: " + (isBonded ? "BONDED" : "NOT BONDED"));
            promise.resolve(isBonded);
        } catch (Exception e) {
            Log.e(TAG, "❌ Error checking bonding status: " + e.getMessage());
            promise.reject("BONDING_CHECK_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void initiateSecurePairing(String deviceId, Promise promise) {
        try {            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
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
            if (device.getBondState() == BluetoothDevice.BOND_BONDED) {                promise.resolve(true);
                return;
            }            promise.reject("NOT_SUPPORTED", "Pairing happens automatically during connection. Use connectToDevice() instead.");
        } catch (Exception e) {
            Log.e(TAG, "❌ Error initiating secure pairing: " + e.getMessage());
            promise.reject("PAIRING_ERROR", e.getMessage());
        }
    }
    // ============================================================================
    // DFU (DEVICE FIRMWARE UPDATE) IMPLEMENTATION
    // ============================================================================
    
    /**
     * Current device address undergoing DFU
     * - Tracks active DFU operation
     * - Null when no DFU in progress
     * - Used to prevent concurrent DFU operations
     */
    private String currentDfuDeviceAddress = null;
    
    /**
     * DFU progress listener for event callbacks
     * - Registered with Nordic DFU library
     * - Receives DFU state changes and progress updates
     * - Emits events to React Native
     */
    private DfuProgressListener dfuProgressListener = null;
    
    /**
     * Enter DFU (Device Firmware Update) mode
     * 
     * Purpose:
     * - Sends command to reboot device into DFU bootloader
     * - Required before starting firmware update
     * - Device disconnects and restarts in DFU mode
     * 
     * DFU Mode Entry Flow:
     * 1. Validate device is connected
     * 2. Find System Command characteristic
     * 3. Send Enter DFU Mode command (0xAA0A0000)
     * 4. Device receives command
     * 5. Device disconnects
     * 6. Device reboots into DFU bootloader (~3 seconds)
     * 7. Device advertises with DFU service UUID
     * 8. App can now connect and start DFU
     * 
     * Command Format:
     * - Byte 0: 0xAA (REQUEST_ID)
     * - Byte 1: 0x0A (CMD_START_DFU)
     * - Byte 2: 0x00 (Length = 0)
     * - Byte 3: 0x00 (No payload)
     * 
     * Device Behavior:
     * - Saves current state to flash
     * - Disconnects BLE connection
     * - Resets MCU
     * - Boots into DFU bootloader
     * - Starts advertising as DFU device
     * 
     * DFU Service:
     * - UUID: 0x0000fe59-0000-1000-8000-00805f9b34fb (Nordic DFU)
     * - Secure DFU: Signed firmware images
     * - Supports Zip packages with init packet
     * 
     * Timing:
     * - Command send: < 100ms
     * - Device disconnect: Immediate
     * - Reboot time: ~3 seconds
     * - DFU advertisement: After reboot
     * 
     * Error Handling:
     * - DEVICE_NOT_CONNECTED: Device not in connected map
     * - CHARACTERISTIC_NOT_FOUND: System Command char missing
     * - WRITE_FAILED: BLE write operation failed
     * - ENTER_DFU_ERROR: General exception
     * 
     * Next Steps:
     * 1. Wait 3+ seconds for device reboot
     * 2. Scan for device with DFU service UUID
     * 3. Connect to device in DFU mode
     * 4. Call startDFU() with firmware file path
     * 
     * @param deviceId Device MAC address
     * @param promise React Native promise
     *                Resolves with status and estimated reboot time
     *                Rejects on error
     */
    @ReactMethod
    public void enterDFUMode(String deviceId, Promise promise) {
        try {
            // Validate device is connected
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
            
            // Build Enter DFU Mode command
            byte[] command = new byte[]{
                (byte) 0xAA,  // REQUEST_ID
                (byte) 0x0A,  // CMD_START_DFU
                (byte) 0x00,  // Length = 0
                (byte) 0x00   // No payload
            };
            
            // Set characteristic value
            systemCommandChar.setValue(command);
            
            // Send command to device
            boolean success = gatt.writeCharacteristic(systemCommandChar);
            
            if (success) {
                // Command sent successfully
                WritableMap result = Arguments.createMap();
                result.putString("status", "entering_dfu");
                result.putString("message", "Device rebooting into DFU mode");
                result.putString("deviceId", deviceId);
                result.putInt("estimatedRebootTimeMs", 3000);
                promise.resolve(result);
            } else {
                // Write initiation failed
                Log.e(TAG, "❌ [DFU] Failed to send Enter DFU Mode command");
                promise.reject("WRITE_FAILED", "Failed to write Enter DFU Mode command");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error entering DFU mode: " + e.getMessage());
            promise.reject("ENTER_DFU_ERROR", e.getMessage());
        }
    }
    /**
     * Start DFU (Device Firmware Update) process
     * 
     * Purpose:
     * - Initiates firmware update using Nordic DFU library
     * - Updates device firmware from application or bootloader
     * - Supports secure DFU with signed packages
     * - Provides progress callbacks to React Native
     * 
     * Prerequisites:
     * 1. Device must be in DFU mode (call enterDFUMode first)
     * 2. Device must be advertising with DFU service UUID
     * 3. Firmware file must be valid Zip package
     * 4. File must be accessible via provided URI
     * 
     * DFU Process Flow:
     * 1. Parse firmware file URI
     * 2. Setup progress listener
     * 3. Configure DFU service initiator
     * 4. Start DFU service
     * 5. Service connects to device
     * 6. Service validates firmware signature
     * 7. Service transfers firmware
     * 8. Device validates and installs firmware
     * 9. Device reboot with new firmware
     * 
     * DFU Configuration:
     * - Device Name: "Smart Health Tag" (for notifications)
     * - Keep Bond: true (preserve pairing after update)
     * - Force DFU: false (don't force unsafe updates)
     * - Packet Receipt Notifications: Enabled (every 12 packets)
     * - Buttonless DFU: Enabled (experimental)
     * 
     * Packet Receipt Notifications:
     * - Acknowledgment every 12 packets
     * - Improves reliability on unstable connections
     * - Trade-off: Slower but more reliable
     * 
     * Buttonless DFU:
     * - Allows DFU without manual mode entry
     * - Device switches to DFU automatically
     * - Experimental feature - may not work on all devices
     * 
     * Firmware Package Format:
     * - Zip file containing:
     *   - manifest.json (metadata)
     *   - application.bin (firmware binary)
     *   - application.dat (init packet with signature)
     * - Must be signed with private key matching device's public key
     * 
     * Progress Events:
     * - DFUStateChanged: State transitions (connecting, uploading, etc.)
     * - DFUProgress: Progress percentage, speed, parts
     * - DFUCompleted: Update successful
     * - DFUAborted: Update cancelled
     * - DFUError: Update failed with error
     * 
     * Error Handling:
     * - INVALID_FIRMWARE_PATH: File URI parsing failed
     * - DFU_START_ERROR: Service initialization failed
     * - Progress listener receives detailed error codes
     * 
     * Performance:
     * - Typical speed: 2-5 KB/s (depends on packet receipt config)
     * - 100 KB firmware: 20-50 seconds
     * - Connection quality affects speed significantly
     * 
     * Security:
     * - Secure DFU verifies firmware signature
     * - Prevents unauthorized firmware installation
     * - Device rejects unsigned or tampered packages
     * 
     * @param deviceAddress Device MAC address (in DFU mode)
     * @param firmwarePath File URI path to firmware Zip package
     * @param promise React Native promise
     *                Resolves when DFU service starts
     *                Rejects on initialization error
     */
    @ReactMethod
    public void startDFU(String deviceAddress, String firmwarePath, Promise promise) {
        try {
            // Parse firmware file URI
            Uri fileUri = Uri.parse(firmwarePath);
            if (fileUri == null) {
                promise.reject("INVALID_FIRMWARE_PATH", "Invalid firmware file path");
                return;
            }
            
            // Track current DFU device
            currentDfuDeviceAddress = deviceAddress;
            
            // Setup progress listener for events
            setupDfuProgressListener();
            
            // Configure DFU service
            final DfuServiceInitiator starter = new DfuServiceInitiator(deviceAddress)
                    .setDeviceName("Smart Health Tag")  // Display name in notifications
                    .setKeepBond(true)  // Preserve pairing after update
                    .setForceDfu(false)  // Don't force unsafe updates
                    .setPacketsReceiptNotificationsEnabled(true)  // Enable ACKs for reliability
                    .setPacketsReceiptNotificationsValue(12)  // ACK every 12 packets
                    .setUnsafeExperimentalButtonlessServiceInSecureDfuEnabled(true);  // Allow buttonless DFU
            
            // Set firmware package
            starter.setZip(fileUri);
            
            // Start DFU service (runs in background)
            starter.start(getReactApplicationContext(), DfuServiceWrapper.class);
            
            // Resolve promise (DFU continues in background)
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
    @ReactMethod
    public void cancelDFU(Promise promise) {
        try {
            if (currentDfuDeviceAddress == null) {
                promise.reject("NO_DFU_IN_PROGRESS", "No DFU operation in progress");
                return;
            }
            Intent stopIntent = new Intent(getReactApplicationContext(), DfuServiceWrapper.class);
            getReactApplicationContext().stopService(stopIntent);
            currentDfuDeviceAddress = null;
            WritableMap result = Arguments.createMap();
            result.putString("status", "cancelled");
            result.putString("deviceId", currentDfuDeviceAddress);
            promise.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error cancelling DFU: " + e.getMessage());
            promise.reject("DFU_CANCEL_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void isDeviceInDFUMode(String deviceId, Promise promise) {
        try {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                promise.resolve(false);
                return;
            }
            List<BluetoothGattService> services = gatt.getServices();
            for (BluetoothGattService service : services) {
                if (service.getUuid().toString().equalsIgnoreCase(DFU_SERVICE_UUID)) {
                    promise.resolve(true);
                    return;
                }
            }
            promise.resolve(false);
        } catch (Exception e) {
            Log.e(TAG, "❌ [DFU] Error checking DFU mode: " + e.getMessage());
            promise.reject("DFU_CHECK_ERROR", e.getMessage());
        }
    }
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
     * Setup DFU progress listener for callbacks
     * 
     * Purpose:
     * - Registers listener with Nordic DFU library
     * - Receives DFU state changes and progress updates
     * - Converts DFU callbacks to React Native events
     * - Provides real-time feedback to UI
     * 
     * Listener Registration:
     * - Unregisters existing listener (if any)
     * - Creates new listener adapter
     * - Registers with DFU service helper
     * - Receives callbacks on background thread
     * 
     * DFU State Flow:
     * 1. onDeviceConnecting: Connecting to device
     * 2. onDeviceConnected: Connected successfully
     * 3. onEnablingDfuMode: Switching to DFU mode (buttonless)
     * 4. onDfuProcessStarting: Preparing firmware transfer
     * 5. onDfuProcessStarted: Firmware transfer started
     * 6. onProgressChanged: Progress updates (0-100%)
     * 7. onFirmwareValidating: Device validating firmware
     * 8. onDeviceDisconnecting: Disconnecting after transfer
     * 9. onDeviceDisconnected: Disconnected
     * 10. onDfuCompleted: Update successful (device reboots)
     * 
     * Progress Information:
     * - progress: Percentage complete (0-100)
     * - currentSpeed: Current transfer speed (bytes/sec)
     * - avgSpeed: Average transfer speed (bytes/sec)
     * - currentPart: Current part number (for multi-part updates)
     * - totalParts: Total number of parts
     * 
     * Events Emitted:
     * 
     * DFUStateChanged:
     * - state: Current state name
     * - deviceId: Device MAC address
     * - progress: Current progress percentage
     * 
     * DFUProgress:
     * - deviceId: Device MAC address
     * - progress: Percentage complete
     * - currentSpeed: Current speed (bytes/sec)
     * - avgSpeed: Average speed (bytes/sec)
     * - part: Current part number
     * - totalParts: Total parts
     * 
     * DFUCompleted:
     * - state: "completed"
     * - deviceId: Device MAC address
     * - progress: 100
     * - Clears currentDfuDeviceAddress
     * 
     * DFUAborted:
     * - state: "aborted"
     * - deviceId: Device MAC address
     * - progress: 0
     * - Clears currentDfuDeviceAddress
     * 
     * DFUError:
     * - deviceId: Device MAC address
     * - errorCode: DFU error code
     * - errorType: DFU error type
     * - message: Human-readable error message
     * - Clears currentDfuDeviceAddress
     * 
     * Error Codes (Common):
     * - 4101: File not found
     * - 4102: File error
     * - 4103: Connection timeout
     * - 4104: GATT error
     * - 4105: Initialization error
     * - 4106: Invalid firmware
     * - 4107: Signature mismatch
     * 
     * Threading:
     * - Callbacks received on background thread
     * - Events sent to React Native on JS thread
     * - No synchronization needed for event emission
     * 
     * Cleanup:
     * - Listener unregistered on module destroy
     * - currentDfuDeviceAddress cleared on completion/error
     * - Allows new DFU operations after completion
     */
    private void setupDfuProgressListener() {
        // Unregister existing listener (if any)
        if (dfuProgressListener != null) {
            DfuServiceListenerHelper.unregisterProgressListener(getReactApplicationContext(), dfuProgressListener);
        }
        
        // Create new progress listener
        dfuProgressListener = new DfuProgressListenerAdapter() {
            @Override
            public void onDeviceConnecting(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "connecting", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceConnected(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "connected", deviceAddress, 0);
            }
            
            @Override
            public void onDfuProcessStarting(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "starting", deviceAddress, 0);
            }
            
            @Override
            public void onDfuProcessStarted(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "uploading", deviceAddress, 0);
            }
            
            @Override
            public void onEnablingDfuMode(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "enabling_dfu", deviceAddress, 0);
            }
            
            @Override
            public void onProgressChanged(String deviceAddress, int percent, float speed, 
                                         float avgSpeed, int currentPart, int partsTotal) {
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
                sendDfuEvent("DFUStateChanged", "validating", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceDisconnecting(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "disconnecting", deviceAddress, 0);
            }
            
            @Override
            public void onDeviceDisconnected(String deviceAddress) {
                sendDfuEvent("DFUStateChanged", "disconnected", deviceAddress, 0);
            }
            
            @Override
            public void onDfuCompleted(String deviceAddress) {
                sendDfuEvent("DFUCompleted", "completed", deviceAddress, 100);
                currentDfuDeviceAddress = null;  // Allow new DFU operations
            }
            
            @Override
            public void onDfuAborted(String deviceAddress) {
                sendDfuEvent("DFUAborted", "aborted", deviceAddress, 0);
                currentDfuDeviceAddress = null;  // Allow new DFU operations
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
                
                currentDfuDeviceAddress = null;  // Allow new DFU operations
            }
        };
        
        // Register listener with DFU service
        DfuServiceListenerHelper.registerProgressListener(getReactApplicationContext(), dfuProgressListener);
    }
    private void sendDfuEvent(String eventName, String state, String deviceId, int progress) {
        WritableMap params = Arguments.createMap();
        params.putString("state", state);
        params.putString("deviceId", deviceId);
        params.putInt("progress", progress);
        sendEvent(eventName, params);
    }
}

// ============================================================================
// DFU SERVICE WRAPPER
// ============================================================================

/**
 * DFU Service Wrapper for Nordic DFU Library
 * 
 * Purpose:
 * - Extends Nordic DFU base service
 * - Provides configuration for DFU operations
 * - Handles notification taps during DFU
 * - Controls debug logging
 * 
 * Nordic DFU Library:
 * - Open-source library by Nordic Semiconductor
 * - Implements secure DFU protocol
 * - Supports Android and iOS
 * - Handles firmware transfer and validation
 * 
 * Service Lifecycle:
 * 1. Started by DfuServiceInitiator.start()
 * 2. Runs in foreground with notification
 * 3. Connects to device in DFU mode
 * 4. Transfers firmware
 * 5. Validates and installs firmware
 * 6. Stops when complete/aborted/error
 * 
 * Notification:
 * - Shows DFU progress to user
 * - Allows cancellation via notification action
 * - Tapping notification opens MainActivity
 * - Required for foreground service on Android O+
 * 
 * Debug Mode:
 * - Enabled in debug builds (BuildConfig.DEBUG)
 * - Provides verbose logging for troubleshooting
 * - Disabled in release builds for performance
 * 
 * Thread Safety:
 * - Service runs on background thread
 * - BLE operations executed sequentially
 * - Progress callbacks on main thread
 * 
 * Error Handling:
 * - Service handles all DFU errors internally
 * - Errors reported via progress listener
 * - Service stops gracefully on error
 * 
 * Resource Management:
 * - Service holds partial wake lock during DFU
 * - Released when DFU completes
 * - Prevents device sleep during update
 * 
 * Security:
 * - Verifies firmware signature before installation
 * - Uses device's public key for verification
 * - Rejects unsigned or tampered firmware
 * 
 * Note:
 * - Must be declared in AndroidManifest.xml
 * - Requires FOREGROUND_SERVICE permission
 * - Requires WAKE_LOCK permission for partial wake lock
 */
class DfuServiceWrapper extends DfuBaseService {
    /**
     * Get notification target activity
     * 
     * Purpose:
     * - Specifies activity to launch when notification tapped
     * - Opens MainActivity to show DFU progress
     * - Returns null if MainActivity class not found
     * 
     * Implementation:
     * - Uses reflection to find MainActivity
     * - Handles ClassNotFoundException gracefully
     * - Returns null on error (notification still works)
     * 
     * Activity Launch:
     * - Tapping notification launches MainActivity
     * - Activity should handle DFU state display
     * - Allows user to monitor progress from notification
     * 
     * @return MainActivity class or null if not found
     */
    @Override
    protected Class<? extends android.app.Activity> getNotificationTarget() {
        try {
            return (Class<? extends android.app.Activity>) Class.forName("com.reactnativeboilerplate.MainActivity");
        } catch (ClassNotFoundException e) {
            return null;
        }
    }
    
    /**
     * Check if debug mode is enabled
     * 
     * Purpose:
     * - Controls verbose logging in DFU library
     * - Enabled in debug builds for troubleshooting
     * - Disabled in release builds for performance
     * 
     * Debug Logging Includes:
     * - BLE connection details
     * - GATT operations (read/write)
     * - Firmware transfer progress
     * - Packet receipt notifications
     * - Error details and stack traces
     * 
     * Performance Impact:
     * - Minimal overhead in debug mode
     * - No impact in release mode
     * - Logs written to logcat only
     * 
     * @return true if debug build, false if release build
     */
    @Override
    protected boolean isDebug() {
        return BuildConfig.DEBUG;
    }
}
