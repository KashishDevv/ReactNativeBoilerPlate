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
import com.facebook.fbreact.specs.NativeBridgingCodeModuleSpec;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactApplicationContext;
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
import java.util.function.Consumer;
import javax.crypto.Cipher;
import javax.crypto.spec.SecretKeySpec;
import javax.crypto.spec.IvParameterSpec;
import com.reactnativeboilerplate.BLEConnectionManager.BLEConnectionCallback;
import com.reactnativeboilerplate.BLEConnectionManager.ConnectionState;
import com.reactnativeboilerplate.config.BLEClientConfigHolder;
import android.net.Uri;
import java.io.InputStream;
import java.io.FileInputStream;
import java.io.File;

// MCUboot DFU over SMP (McuMgr) - matches nRF Connect / Zephyr flow (not Nordic Secure DFU FE59)
import io.runtime.mcumgr.ble.McuMgrBleTransport;
import io.runtime.mcumgr.dfu.FirmwareUpgradeCallback;
import io.runtime.mcumgr.dfu.FirmwareUpgradeController;
import io.runtime.mcumgr.dfu.mcuboot.FirmwareUpgradeManager;
import io.runtime.mcumgr.exception.McuMgrException;

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
 * Industry pattern: one GATT operation at a time per device.
 * Each BLE action (write, read, descriptor, MTU, RSSI) implements this.
 */
interface GattOperation {
    void execute(BluetoothGatt gatt);
    void onComplete(int status);
    void onTimeout();
    String name();
    /** Per-op timeout (ms). Default 10000. Use shorter (e.g. 3000) for CCCD on auto-connect to fail fast. */
    default int getTimeoutMs() { return 10000; }
}

/**
 * Single global GATT operation queue per device (Fitbit/Tile/Garmin-style).
 * One BLE device = one queue = one in-flight GATT operation.
 * Callbacks drive the queue forward via onOperationComplete(deviceId, status).
 */
class GattOperationQueue {
    private static final String TAG = "GattOperationQueue";
    // Most production BLE apps use ~5–10s per op as a safety net.
    private static final int DEFAULT_OP_TIMEOUT_MS = 10000;

    private final Queue<GattOperation> queue = new LinkedList<>();
    private boolean inFlight = false;
    private BluetoothGatt gatt;
    private final String deviceId;
    private final Handler mainHandler;
    private final ScheduledExecutorService executorService;
    private final int timeoutMs;
    private GattOperation currentOp = null;
    private ScheduledFuture<?> timeoutFuture = null;
    /** For debug: when currentOp started (ms since epoch). Used to log how long op was in flight. */
    private long currentOpStartTime = 0;

    GattOperationQueue(String deviceId, Handler mainHandler, ScheduledExecutorService executorService) {
        this(deviceId, mainHandler, executorService, DEFAULT_OP_TIMEOUT_MS);
    }

    GattOperationQueue(String deviceId, Handler mainHandler, ScheduledExecutorService executorService, int timeoutMs) {
        this.deviceId = deviceId;
        this.mainHandler = mainHandler;
        this.executorService = executorService;
        this.timeoutMs = timeoutMs > 0 ? timeoutMs : DEFAULT_OP_TIMEOUT_MS;
    }

    void setGatt(BluetoothGatt gatt) {
        this.gatt = gatt;
        if (gatt != null) {
            android.util.Log.d(TAG, "[GATT QUEUE] setGatt [" + deviceId + "] assigned (queue ready for ops)");
        } else {
            android.util.Log.d(TAG, "[GATT QUEUE] setGatt [" + deviceId + "] cleared");
        }
    }

    BluetoothGatt getGatt() {
        return gatt;
    }

    synchronized void enqueue(GattOperation op) {
        queue.add(op);
        long inFlightMs = (currentOpStartTime > 0) ? (System.currentTimeMillis() - currentOpStartTime) : 0;
        if (inFlight) {
            android.util.Log.d(TAG, "[GATT QUEUE] enqueue [" + deviceId + "] op=" + op.name() + " queueSize=" + queue.size()
                + " inFlight=true currentOp=" + (currentOp != null ? currentOp.name() : "null") + " inFlightMs=" + inFlightMs);
        } else {
            android.util.Log.d(TAG, "[GATT QUEUE] enqueue [" + deviceId + "] op=" + op.name() + " queueSize=" + queue.size() + " inFlight=false");
        }
        if (!inFlight) {
            mainHandler.post(this::executeNext);
        }
    }

    /**
     * Call from GATT callbacks (onCharacteristicWrite, onDescriptorWrite, onCharacteristicRead, onReadRemoteRssi, onMtuChanged).
     * Runs current op's onComplete(status), then advances to next op.
     * Note: status=257 (GATT_FAILURE) can come from (1) the BLE stack callback, or (2) our 10s timeout
     * (startTimeout -> onOperationComplete(GATT_FAILURE)) when the stack never invokes the callback.
     */
    synchronized void onOperationComplete(int status) {
        String opName = currentOp != null ? currentOp.name() : "null";
        int pending = queue.size();
        long durationMs = (currentOpStartTime > 0) ? (System.currentTimeMillis() - currentOpStartTime) : -1;
        int opTimeout = (currentOp != null) ? currentOp.getTimeoutMs() : timeoutMs;
        if (opTimeout <= 0) opTimeout = timeoutMs;
        String source = (status == android.bluetooth.BluetoothGatt.GATT_FAILURE && durationMs >= (opTimeout - 500))
            ? " (TIMEOUT - no callback from BLE stack)" : " (callback received)";
        android.util.Log.d(TAG, "[GATT QUEUE] onOperationComplete [" + deviceId + "] status=" + status + " op=" + opName
            + " pending=" + pending + " durationMs=" + durationMs + source);
        cancelTimeout();
        currentOpStartTime = 0;
        if (currentOp != null) {
            try {
                currentOp.onComplete(status);
            } catch (Exception e) {
                android.util.Log.e(TAG, "Op onComplete error [" + deviceId + "] " + currentOp.name() + ": " + e.getMessage());
            }
            currentOp = null;
        }
        inFlight = false;
        android.util.Log.d(TAG, "[GATT QUEUE] onOperationComplete -> executeNext in 30ms [" + deviceId + "] pending=" + pending);
        mainHandler.postDelayed(this::executeNext, 30);
    }

    private void cancelTimeout() {
        if (timeoutFuture != null) {
            timeoutFuture.cancel(false);
            timeoutFuture = null;
        }
    }

    private synchronized void executeNext() {
        if (queue.isEmpty() || gatt == null) {
            android.util.Log.d(TAG, "[GATT QUEUE] executeNext SKIP [" + deviceId + "] empty=" + queue.isEmpty() + " gattNull=" + (gatt == null));
            return;
        }
        if (inFlight) {
            long inFlightMs = (currentOpStartTime > 0) ? (System.currentTimeMillis() - currentOpStartTime) : 0;
            android.util.Log.d(TAG, "[GATT QUEUE] executeNext BLOCKED [" + deviceId + "] op=" + (currentOp != null ? currentOp.name() : "null")
                + " inFlightMs=" + inFlightMs + " (waiting for BLE callback) pending=" + queue.size());
            return;
        }
        GattOperation op = queue.poll();
        if (op == null) return;

        currentOp = op;
        currentOpStartTime = System.currentTimeMillis();
        inFlight = true;
        android.util.Log.d(TAG, "[GATT QUEUE] executeNext RUN [" + deviceId + "] op=" + op.name() + " remaining=" + queue.size()
            + " (waiting for onServicesDiscovered|onReadRemoteRssi|onDescriptorWrite|onCharacteristicRead|onMtuChanged)");
        try {
            op.execute(gatt);
        } catch (Exception e) {
            android.util.Log.e(TAG, "[GATT QUEUE] Op execute error [" + deviceId + "] " + op.name() + ": " + e.getMessage());
            inFlight = false;
            currentOp = null;
            currentOpStartTime = 0;
            mainHandler.post(this::executeNext);
            return;
        }
        startTimeout(op);
    }
    
    /**
     * ✅ FIX: Priority enqueue for critical operations (e.g., POST-SET_TIME Device Status read)
     * Adds operation to the front of the queue instead of the back.
     * Use sparingly - only for operations that must complete before sync can start.
     */
    synchronized void enqueuePriority(GattOperation op) {
        ((LinkedList<GattOperation>) queue).addFirst(op);
        android.util.Log.d(TAG, "[GATT QUEUE] enqueuePriority [" + deviceId + "] op=" + op.name() + " queueSize=" + queue.size() + " inFlight=" + inFlight);
        if (!inFlight) {
            mainHandler.post(this::executeNext);
        }
    }

    private void startTimeout(GattOperation op) {
        int opTimeout = op.getTimeoutMs();
        if (opTimeout <= 0) opTimeout = timeoutMs;
        final int timeoutMsForOp = opTimeout;
        if (executorService == null || timeoutMsForOp <= 0) return;
        timeoutFuture = executorService.schedule(() -> {
            mainHandler.post(() -> {
                synchronized (GattOperationQueue.this) {
                    if (currentOp == op) {
                        long inFlightMs = (currentOpStartTime > 0) ? (System.currentTimeMillis() - currentOpStartTime) : timeoutMsForOp;
                        android.util.Log.w(TAG, "⏱️ [GATT QUEUE] TIMEOUT [" + deviceId + "] op=" + op.name()
                            + " after " + inFlightMs + "ms - BLE stack did not invoke callback (onServicesDiscovered/onReadRemoteRssi/onDescriptorWrite/...)");
                        try {
                            op.onTimeout();
                        } catch (Exception e) {
                            android.util.Log.e(TAG, "Op onTimeout error: " + e.getMessage());
                        }
                        onOperationComplete(android.bluetooth.BluetoothGatt.GATT_FAILURE);
                    }
                }
            });
        }, timeoutMsForOp, TimeUnit.MILLISECONDS);
    }

    /** For nuclear safety: how long current op has been in flight (0 if none). */
    long getInFlightDurationMs() {
        return (currentOpStartTime > 0) ? (System.currentTimeMillis() - currentOpStartTime) : 0;
    }

    boolean isInFlight() {
        return inFlight;
    }

    boolean hasPendingOps() {
        return !queue.isEmpty() || inFlight;
    }

    int queueSize() {
        return queue.size();
    }

    /** For diagnostics: name of op currently in flight (or null). */
    String getCurrentOpName() {
        return currentOp != null ? currentOp.name() : null;
    }
}

/**
 * Adapter: wraps a Runnable (execute) + Consumer<Integer> (onComplete) as a GattOperation.
 * Used to migrate existing enqueueGattOp(deviceId, runnable) + pendingGattComplete logic.
 */
class RunnableGattOp implements GattOperation {
    private final Runnable executeBody;
    private final Consumer<Integer> onCompleteBody;
    private final String opName;
    private final int opTimeoutMs;

    RunnableGattOp(Runnable executeBody, Consumer<Integer> onCompleteBody, String opName) {
        this(executeBody, onCompleteBody, opName, 0);
    }

    RunnableGattOp(Runnable executeBody, Consumer<Integer> onCompleteBody, String opName, int opTimeoutMs) {
        this.executeBody = executeBody;
        this.onCompleteBody = onCompleteBody;
        this.opName = opName != null ? opName : "RunnableOp";
        this.opTimeoutMs = opTimeoutMs > 0 ? opTimeoutMs : 10000;
    }

    @Override
    public int getTimeoutMs() { return opTimeoutMs; }

    @Override
    public void execute(BluetoothGatt gatt) {
        if (executeBody != null) executeBody.run();
    }

    @Override
    public void onComplete(int status) {
        if (onCompleteBody != null) onCompleteBody.accept(status);
    }

    @Override
    public void onTimeout() {
        // Optional: onCompleteBody could be called with GATT_FAILURE from queue timeout
    }

    @Override
    public String name() {
        return opName;
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
public class SampleBridgeAndroid extends NativeBridgingCodeModuleSpec {

    public static final String NAME = "BridgingCodeModule";

    // ============================================================================
    // CONSTANTS - Logging and HTTP Client
    // ============================================================================
    
    /** Tag for Android logging */
    private static final String TAG = "SampleBridgeAndroid";
    
    /** HTTP client for API communication */
    private OkHttpClient client = new OkHttpClient();
    
    // ============================================================================
    // CONSTANTS - BLE Service UUIDs (client-specific UUID in BLEClientConfig)
    // ============================================================================
    
    /** Standard BLE Battery Service UUID (0x180F) */
    private static final String BATTERY_SERVICE_UUID = "0000180f-0000-1000-8000-00805f9b34fb";
    
    /** Standard BLE Device Information Service UUID (0x180A) */
    private static final String DEVICE_INFO_SERVICE_UUID = "0000180a-0000-1000-8000-00805f9b34fb";
    
    /** Standard BLE Generic Access Service UUID (0x1800) */
    private static final String GENERIC_ACCESS_SERVICE_UUID = "00001800-0000-1000-8000-00805f9b34fb";
    
    // ============================================================================
    // CONSTANTS - BLE Characteristic UUIDs
    // ============================================================================
    
    /** System command characteristic for sending control commands */
    private static final String SYSTEM_COMMAND_CHAR_UUID = "4f4e4d4c-4b4a-4948-4746-454443424140";
    
    /** Device status characteristic for receiving device state updates (record count, RTC, battery).
     * SDD v1.5: READ-ONLY METADATA. Never starts sync, never sends data. Sync starts only on DATA_SYNC_START (Command char). */
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
    // CONSTANTS - Device Identification (manufacturer ID in BLEClientConfig)
    // ============================================================================
    
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
    // SECURITY METHODS (default passkey from BLEClientConfig)
    // ============================================================================
    
    /**
     * Retrieves the pairing passkey for a specific device.
     * First checks stored passkey; otherwise uses client config default (white-label).
     */
    private String getPasskeyForDevice(String deviceId) {
        String storedPasskey = devicePasskeys.get(deviceId);
        if (storedPasskey != null && storedPasskey.length() == 6) {
            return storedPasskey;
        }
        String defaultPasskey = BLEClientConfigHolder.get().getDefaultPasskey();
        return (defaultPasskey != null && defaultPasskey.length() == 6) ? defaultPasskey : "123456";
    }

    /** Returns true if deviceName matches any of the client's accepted name patterns (white-label). */
    private boolean matchesAcceptedDeviceName(String deviceName) {
        if (deviceName == null) return false;
        for (String pattern : BLEClientConfigHolder.get().getAcceptedDeviceNamePatterns()) {
            if (pattern != null && deviceName.contains(pattern)) return true;
            if (pattern != null && pattern.equals(deviceName)) return true;
        }
        return false;
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
                    // nRF-style: bond completed after connect — wait 1600ms then MTU + discover (same as nRF Connect)
                    if (devicesWaitingForBondAfterConnect.remove(deviceId)) {
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (gatt != null) {
                            addToBondedDevices(deviceId, device);
                            Log.d(TAG, "✅ [nRF-style] Device bonded - waiting 1600ms then discovering services: " + deviceId);
                            mainHandler.postDelayed(() -> {
                                BluetoothGatt g = connectedGatts.get(deviceId);
                                if (g == null) return;
                                secureReadyStates.put(deviceId, SecureReadyState.MTU_NEGOTIATING);
                                enqueueGattOp(deviceId, () -> {
                                    BluetoothGatt gattForMtu = connectedGatts.get(deviceId);
                                    if (gattForMtu == null) {
                                        advanceGattQueue(deviceId);
                                        return;
                                    }
                                    pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                                    gattForMtu.requestMtu(REQUESTED_MTU);
                                }, "requestMtu_after_bond");
                                ScheduledFuture<?> mtuTimeout = executorService.schedule(() -> {
                                    if (!negotiatedMtuMap.containsKey(deviceId)) {
                                        negotiatedMtuMap.put(deviceId, DEFAULT_MTU);
                                        Log.w(TAG, "⚠️ MTU negotiation timeout (after bond) for " + deviceId + " - using default MTU: " + DEFAULT_MTU);
                                        updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                        BluetoothGatt g2 = connectedGatts.get(deviceId);
                                        if (g2 != null) {
                                            List<BluetoothGattService> existingServices = g2.getServices();
                                            if (existingServices != null && !existingServices.isEmpty()) {
                                                handleServicesDiscovered(g2);
                                            } else {
                                                enqueueDiscoverServicesOp(deviceId, g2, "mtu_timeout_after_bond");
                                            }
                                        }
                                    }
                                }, MTU_NEGOTIATION_TIMEOUT_MS, TimeUnit.MILLISECONDS);
                                mtuNegotiationTimeouts.put(deviceId, mtuTimeout);
                                int verificationDelaySec = 2;
                                pairingVerificationTimers.put(deviceId, executorService.schedule(() -> {
                                    BluetoothGatt gattForVerify = connectedGatts.get(deviceId);
                                    if (gattForVerify != null) {
                                        verifyPairingAndConfirmConnection(deviceId, gattForVerify);
                                    }
                                }, verificationDelaySec, TimeUnit.SECONDS));
                            }, 1600);
                        }
                        return;
                    }
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
    
    /**
     * ✅ Helper method: Get connection state from BLEConnectionManager (single source of truth)
     */
    private String getConnectionState(String deviceId) {
        BLEConnectionManager.DeviceConnectionState state = connectionManager.getDeviceState(deviceId);
        if (state == null || state.state == null) {
            return "disconnected";
        }
        switch (state.state) {
            case CONNECTED:
                return "connected";
            case CONNECTING:
                return "connecting";
            case DISCONNECTING:
                return "disconnecting";
            case DISCONNECTED:
            default:
                return "disconnected";
        }
    }
    
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

    /** ✅ FIX: Track devices that have a pending post-sync device status read to detect new records accumulated during sync */
    private Set<String> pendingPostSyncDeviceStatusRead = Collections.synchronizedSet(new HashSet<>());
    /** Match iOS: For post-sync, defer sync_start to BB08 handler — use device's BB08 totalRecords as authoritative (avoids stale device status). */
    private Map<String, Integer> pendingPostSyncSyncStart = new ConcurrentHashMap<>();
    
    /** Track if ConnectionLog "Connected" event has been emitted for this connection (prevents duplicates) */
    private Map<String, Long> hasEmittedConnectedLog = new ConcurrentHashMap<>();
    
    /** Deduplication window for ConnectionLog "Connected" events (milliseconds) */
    private static final long CONNECTED_LOG_DEDUPE_WINDOW_MS = 2000; // 2 seconds
    
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
    
    /**
     * Industry gold standard: Single global GATT operation queue per device.
     * All of these go through one queue: writeCharacteristic, readCharacteristic,
     * writeDescriptor (CCCD), readRSSI, MTU requests, RTC read, DATA_SYNC_START/STOP.
     * Only dequeue after the callback of the previous op. Gives Android iOS-like determinism.
     */
    private static final int GATT_QUEUE_ADVANCE_DELAY_MS = 80;
    /** Industry pattern: one GattOperationQueue per device. Replaces gattOpQueues + gattOpInProgress. */
    private Map<String, GattOperationQueue> gattQueues = new ConcurrentHashMap<>();
    /** Per-device callback for in-flight Runnable op: invoked by runPendingGattComplete then queue advances. */
    private Map<String, Consumer<Integer>> pendingGattComplete = new ConcurrentHashMap<>();

    private GattOperationQueue getOrCreateGattQueue(String deviceId) {
        GattOperationQueue q = gattQueues.get(deviceId);
        if (q == null) {
            q = new GattOperationQueue(deviceId, mainHandler, executorService);
            gattQueues.put(deviceId, q);
        }
        return q;
    }

    /** @deprecated Replaced by GattOperationQueue; kept only for reference */
    private Map<String, Queue<SystemCommandRequest>> systemCommandQueues = new ConcurrentHashMap<>();
    
    /** @deprecated Replaced by gattOpInProgress */
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
    
    
    /** Main thread handler for UI and callback operations */
    private Handler mainHandler = new Handler(Looper.getMainLooper());
    
    /** Executor service for scheduled tasks (4 threads for concurrent operations) */
    private ScheduledExecutorService executorService = Executors.newScheduledThreadPool(4);

    /**
     * Single-thread executor for Data Transfer notification parsing.
     * BLE onCharacteristicChanged runs on a limited callback thread; if we parse synchronously
     * we block and the stack can drop notifications (causing actualCount vs recordsReceived mismatch).
     * Offloading parsing here keeps the callback fast so we don't lose packets.
     */
    private final java.util.concurrent.ExecutorService dataTransferParseExecutor =
        Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "BLE-DataTransferParse");
            t.setPriority(Thread.NORM_PRIORITY);
            return t;
        });
    
    /** Minimum interval between scan stop and start to prevent Android limitations */
    private static final long MIN_SCAN_INTERVAL_MS = 2000;
    
    /** Timestamp of last scan stop for interval enforcement */
    private long lastScanStopTime = 0;
    
    /** Auto-connect: when true, periodically restore + scan for bonded devices (industry: manual reconnect + backoff) */
    private volatile boolean autoConnectEnabled = false;
    
    /** Interval between auto-connect restore/scan cycles (ms). Industry: avoid flooding; 30s balanced. */
    private static final long AUTO_CONNECT_SCAN_INTERVAL_MS = 30_000;
    
    /** Reconnect loop runnable for auto-connect; held for cancel on stop. */
    private final Runnable autoConnectReconnectRunnable = new Runnable() {
        @Override
        public void run() {
            if (!autoConnectEnabled) return;
            try {
                syncSystemBondedDevices();
                restoreExistingConnections();
                boolean allBondedConnected = allBondedDevicesConnectedOrConnecting();
                if (autoConnectEnabled && !bondedDeviceIds.isEmpty() && !allBondedConnected) {
                    startScanningForBondedDevices();
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Auto-connect reconnect loop error: " + e.getMessage());
            }
            if (autoConnectEnabled) {
                mainHandler.postDelayed(this, AUTO_CONNECT_SCAN_INTERVAL_MS);
            }
        }
    };
    
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

    /**
     * Industry rule (kept sacred): While a device is syncing, the ONLY allowed GATT traffic is
     * DATA_SYNC_START/DATA_SYNC_STOP commands and notification traffic on Data Transfer.
     *
     * - While dataSyncState == \"syncing\":
     *   - ❌ No RSSI reads
     *   - ❌ No extra status reads
     *   - ❌ No extra system commands
     *   - ✅ Only notifications + DATA_SYNC_STOP
     *
     * This helper is used as a guard before enqueueing competing ops (e.g. RSSI) so that even
     * with the global queue we never *schedule* work that would violate the protocol.
     *
     * Returns true if we must not issue readRSSI or other competing GATT ops for this device.
     * Uses global GATT queue: busy if sync active or any GATT op in progress / queued.
     */
    private boolean isGattBusyOrSyncActive(String deviceId) {
        if (deviceId == null) return false;
        if ("syncing".equals(dataSyncState.get(deviceId))) return true;
        GattOperationQueue q = gattQueues.get(deviceId);
        return (q != null && q.hasPendingOps());
    }
    
    /** True only if GATT queue has pending ops. Used for continuation chunks so we don't block on "syncing" state. */
    private boolean isGattQueueBusy(String deviceId) {
        if (deviceId == null) return false;
        GattOperationQueue q = gattQueues.get(deviceId);
        return (q != null && q.hasPendingOps());
    }
    
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
    
    /** Retry attempt for queued DATA_SYNC_START; used when queue write fails to retry sendDataSyncStartCommand. */
    private Map<String, Integer> dataSyncStartRetryAttemptForQueue = new ConcurrentHashMap<>();
    
    /** Device IDs for which we enqueued a Device Status read before starting sync; when that read completes we start sync with actual count. */
    private final Set<String> pendingAutoSyncAfterDeviceStatusRead = ConcurrentHashMap.newKeySet();
    /** Timeout fallback for pending auto-sync read: deviceId -> ScheduledFuture; cancelled when read completes. */
    private Map<String, ScheduledFuture<?>> pendingAutoSyncReadTimeout = new ConcurrentHashMap<>();
    
    /** Flag indicating set time response received: deviceId -> received */
    private Map<String, Boolean> setTimeResponseReceived = new ConcurrentHashMap<>();
    
    /** Active set time timeout timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> setTimeTimeoutTimers = new ConcurrentHashMap<>();
    
    /** Set time command retry attempts: deviceId -> attemptCount */
    private Map<String, Integer> setTimeRetryAttempts = new ConcurrentHashMap<>();
    
    /** Maximum records per data file for chunking large sync operations */
    private static final int RECORDS_PER_FILE = 500;
    /** Delay (ms) before sending next START after SYNC_COMPLETE (0x02). 150–200ms recommended for BLE stack after notification burst. */
    private static final int NEXT_CHUNK_START_DELAY_MS = 200;
    /** Maximum total records to prevent memory overflow */
    private static final int MAX_TOTAL_RECORDS = 25000;
    
    /** Total records expected in current sync session: deviceId -> totalCount (from 0x01 or Device Status; used for display only) */
    private Map<String, Integer> syncTotalRecords = new ConcurrentHashMap<>();
    /** Remaining records to sync: decremented by actualCount after each 0x02 (do NOT recompute from totalRecords; handles new records during sync). */
    private Map<String, Integer> syncRemainingRecords = new ConcurrentHashMap<>();

    /** Records received in current file chunk: deviceId -> receivedCount */
    private Map<String, Integer> syncRecordsReceived = new ConcurrentHashMap<>();
    
    /** Current file number in multi-file sync: deviceId -> fileNumber */
    private Map<String, Integer> syncCurrentFileNumber = new ConcurrentHashMap<>();
    
    /** Grand total records received across all files: deviceId -> grandTotal */
    private Map<String, Integer> syncGrandTotalReceived = new ConcurrentHashMap<>();
    
    /** Last chunk number for which we already processed Sync Complete (0x02) — skip duplicate 0x02 for same chunk (minimal dedupe) */
    private Map<String, Integer> syncCompleteProcessedForChunk = new ConcurrentHashMap<>();
    /** Chunk number for which we already added 500 to grandTotal in 500-boundary path — avoid double-add when 0x02 arrives */
    private Map<String, Integer> chunkGrandTotalAdvancedInRecordPath = new ConcurrentHashMap<>();

    /** Manual sync with record limit: do NOT auto-continue to next chunk. Set by startDataSyncWithRecordCount. */
    private Map<String, Boolean> syncSingleChunkOnly = new ConcurrentHashMap<>();
    /** Record count for next DATA_SYNC_START when using manual sync (overrides RECORDS_PER_FILE). Cleared after send. */
    private Map<String, Integer> pendingSyncRecordCount = new ConcurrentHashMap<>();

    /** Throttle sync_records progress events so bridge queue doesn't delay sync_complete by seconds (emit at most every N records or T ms) */
    private static final int SYNC_RECORDS_THROTTLE_RECORDS = 250;
    private static final long SYNC_RECORDS_THROTTLE_MS = 500;
    private Map<String, Integer> lastSyncRecordsEmitGrandTotal = new ConcurrentHashMap<>();
    private Map<String, Long> lastSyncRecordsEmitTime = new ConcurrentHashMap<>();

    /** Batch sync records before sending to JS (reduces 17k bridge events to ~85). Industry practice: never 1 event per record. */
    private static final int SYNC_RECORD_BATCH_SIZE = 200;
    private Map<String, List<WritableMap>> syncRecordBuffer = new ConcurrentHashMap<>();

    // ============================================================================
    // 🔒 SYNC LOCK MECHANISM - Prevents GATT disruption during history sync
    // ============================================================================
    
    /** 
     * History sync lock: prevents GATT disconnect/reconnect during active sync.
     * Industry best practice (Fitbit, Garmin): lock connection during data transfer.
     * 
     * ⚠️ CRITICAL: Lock is tied to GATT instance to prevent deadlock on reconnect.
     * If GATT dies and reconnects, old lock is auto-released.
     * 
     * When true for a device:
     * - Block manual disconnect requests
     * - Block reconnect timers
     * - Block timeout logic
     * - Increase GATT operation timeout
     * 
     * Auto-released on:
     * - Sync complete (DATA_TRANSFER_SYNC_COMPLETE)
     * - Connection lost (onConnectionStateChange DISCONNECTED)
     * - Timeout (120s failsafe)
     */
    private static class SyncLockState {
        final long startTime;
        final BluetoothGatt gattInstance; // Tie lock to specific GATT instance
        
        SyncLockState(BluetoothGatt gatt) {
            this.startTime = System.currentTimeMillis();
            this.gattInstance = gatt;
        }
        
        boolean isStale(BluetoothGatt currentGatt) {
            return gattInstance != currentGatt; // Lock is stale if GATT changed
        }
    }
    
    
    private Map<String, SyncLockState> historySyncLock = new ConcurrentHashMap<>();
    
    /** Sync lock timeout: 120 seconds (2 minutes) - conservative for low-MTU devices */
    private static final long SYNC_LOCK_TIMEOUT_MS = 120000;
    
    /** Last time a record was received during sync (for timeout detection) */
    private Map<String, Long> lastRecordReceivedTime = new ConcurrentHashMap<>();
    
    /** Sync timeout: 30 seconds of no records = assume sync complete */
    private static final long SYNC_TIMEOUT_MS = 30000;
    
    /** Timer for checking sync timeouts */
    private Map<String, ScheduledFuture<?>> syncTimeoutCheckers = new ConcurrentHashMap<>();
    
    
    // ============================================================================
    // 📊 PARTIAL RECORD METRICS - Track data loss
    // ============================================================================
    
    /** Counter for dropped partial records per device */
    private Map<String, Integer> partialRecordsDropped = new ConcurrentHashMap<>();
    
    /** Last partial record drop log time to prevent log spam */
    private Map<String, Long> lastPartialDropLogTime = new ConcurrentHashMap<>();
    
    /** Minimum interval between partial drop logs: 5 seconds */
    private static final long PARTIAL_DROP_LOG_INTERVAL_MS = 5000;
    
    /** Cleared on disconnect; was used for hex dedupe — dedupe is now in live/history layers only */
    private Map<String, String> lastDataTransferHex = new ConcurrentHashMap<>();
    private Map<String, Long> lastDataTransferTime = new ConcurrentHashMap<>();
    
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
    
    /** nRF-style: Device connected but bonding in progress; defer MTU/discovery until BOND_BONDED then wait 1600ms */
    private Set<String> devicesWaitingForBondAfterConnect = ConcurrentHashMap.newKeySet();
    
    /** Active pairing verification timers: deviceId -> ScheduledFuture */
    private Map<String, ScheduledFuture<?>> pairingVerificationTimers = new ConcurrentHashMap<>();
    
    /** Devices restored from system on app launch */
    private Set<String> systemRestoredDevices = ConcurrentHashMap.newKeySet();
    
    /** Flag indicating device was already bonded before connection: deviceId -> wasBonded */
    private Map<String, Boolean> deviceWasAlreadyBonded = new ConcurrentHashMap<>();
    
    /** Flag indicating Device Status read is complete and RTC validity is known: deviceId -> isComplete */
    private Map<String, Boolean> deviceStatusReadComplete = new ConcurrentHashMap<>();

    /** Guards proceedWithCommandSequenceAfterDeviceStatusRead to run at most once per device per connection (SDD v1.5). Cleared in cleanupDeviceResources. */
    private Set<String> commandSequenceProceeded = ConcurrentHashMap.newKeySet();

    /** Industry fix: After SET_SYSTEM_TIME success we explicitly read Device Status once (via GATT queue) and then set ready. Cleared in cleanupDeviceResources. */
    private Map<String, Boolean> deviceStatusReadAfterSetTimePending = new ConcurrentHashMap<>();

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
    
    /** Service discovery retry attempt counters: deviceId -> attemptCount */
    private Map<String, Integer> serviceDiscoveryRetryAttempts = new ConcurrentHashMap<>();
    
    /** Maximum service discovery retry attempts */
    private static final int MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS = 3;
    
    /** Service discovery timeout duration (seconds) */
    private static final int SERVICE_DISCOVERY_TIMEOUT_SECONDS = 12;
    
    /** Timestamp when service discovery was initiated: deviceId -> timestamp */
    private Map<String, Long> serviceDiscoveryStartTimes = new ConcurrentHashMap<>();
    
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

    /** Max retries for state restoration when reconnect fails (e.g. GATT 133); same backoff as STATUS_133 */
    private static final int MAX_RESTORATION_RETRIES = 3;
    /** Track state restoration retry attempt per device (cleared on success or after max retries) */
    private Map<String, Integer> restorationRetryCounts = new ConcurrentHashMap<>();

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
    
    // Descriptor (CCCD) writes now go through global GATT queue (gattOpQueues) — no separate descriptor queue.
    
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
    
    // ============================================================================
    // INSTANCE VARIABLES - MCUboot DFU (SMP / McuMgr)
    // ============================================================================
    
    /** SMP Service UUID (MCUboot DFU over BLE - matches nRF Connect / Zephyr) */
    private static final String SMP_SERVICE_UUID = "8D53DC1D-1DB7-4CD3-868B-8A527460AA84";
    /** SMP Characteristic UUID (McuMgr transport channel) */
    private static final String SMP_CHAR_UUID = "DA2E7828-FBCE-4E01-AE9E-261174997C48";
    
    /** Current McuMgr DFU manager (one at a time) */
    private FirmwareUpgradeManager mcuMgrDfuManager = null;
    /** Device ID currently undergoing DFU */
    private String currentMcuMgrDfuDeviceId = null;
    
    /** True if this device is currently in McuMgr DFU; do not reconnect/restore or we steal the connection and kill upload. */
    private boolean isDeviceInMcuMgrDfu(String deviceId) {
        return deviceId != null && deviceId.equals(currentMcuMgrDfuDeviceId);
    }
    
    /** Devices that failed DFU and need connection interval restored to 360ms (firmware default). Cleared on reconnect + restore. */
    private final java.util.Set<String> dfuFailedNeedsConnIntervalRestore = java.util.Collections.newSetFromMap(new java.util.concurrent.ConcurrentHashMap<>());
    
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
            // Industry rule: During sync no RSSI reads — only DATA_SYNC_START/STOP + notifications
            if (isGattBusyOrSyncActive(deviceId)) {
                continue; // skip this device this round
            }
            // ✅ REFACTORED: Get GATT from connectedGatts (single source of truth)
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            try {
                final String devId = deviceId;
                enqueueGattOp(deviceId, () -> {
                    pendingGattComplete.put(devId, (status) -> {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            healthCheckFailures.remove(devId);
                        } else {
                            Log.w(TAG, "⚠️ Health check RSSI failed for device: " + devId);
                            Integer failureCount = healthCheckFailures.getOrDefault(devId, 0) + 1;
                            healthCheckFailures.put(devId, failureCount);
                            Log.w(TAG, "⚠️ Health check failure count for " + devId + ": " + failureCount + "/3");
                            if (failureCount >= 3) {
                                Log.e(TAG, "💀 Device " + devId + " failed 3 consecutive health checks - marking as disconnected");
                                connectedGatts.remove(devId);
                                healthCheckFailures.remove(devId);
                                DeviceData deviceData = deviceDataMap.get(devId);
                                if (deviceData != null) {
                                    // ✅ connectionState managed by BLEConnectionManager
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                            }
                        }
                        advanceGattQueue(devId);
                    });
                    boolean rssiSuccess = gatt.readRemoteRssi();
                    if (!rssiSuccess) {
                        pendingGattComplete.remove(devId);
                        Integer failureCount = healthCheckFailures.getOrDefault(devId, 0) + 1;
                        healthCheckFailures.put(devId, failureCount);
                        if (failureCount >= 3) {
                            connectedGatts.remove(devId);
                            healthCheckFailures.remove(devId);
                            DeviceData deviceData = deviceDataMap.get(devId);
                            if (deviceData != null) {
                                // ✅ connectionState managed by BLEConnectionManager
                                sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                            }
                        }
                        advanceGattQueue(devId);
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "❌ Health check error for device " + deviceId + ": " + e.getMessage());
                connectedGatts.remove(deviceId);
                DeviceData deviceData = deviceDataMap.get(deviceId);
                if (deviceData != null) {
                    // ✅ connectionState managed by BLEConnectionManager
                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
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
     * - GATT services and characteristics
     * 
     * ✅ NOTE: Connection state is NOT stored here - it's managed by BLEConnectionManager
     * This follows Single Source of Truth principle.
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
        
        /** ✅ REMOVED: connectionState - use connectionManager.getDeviceState() instead */
        // Connection state is managed by BLEConnectionManager (single source of truth)
        
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
        requestNotificationPermissionsIfNeeded();
        loadBondedDevices();
        loadForgottenDevices(); 
        loadDevicePasskeys(); 
        if (!bondedDeviceIds.isEmpty()) {
            startForegroundService();
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
                    if (isDeviceInMcuMgrDfu(deviceId)) {
                        Log.d(TAG, "⏭️ [SYSTEM_RESTORE] Skipping - device in McuMgr DFU: " + deviceId);
                        continue;
                    }
                    if (connectedGatts.containsKey(deviceId)) {
                        // ✅ FIX: Skip system restore if device is currently in auto-connect flow
                        // Auto-connect already handles initialization, so skip duplicate processing
                        SecureReadyState deviceState = secureReadyStates.get(deviceId);
                        if (deviceState != null && deviceState != SecureReadyState.SECURE_READY) {
                            Log.d(TAG, "⏭️ [SYSTEM_RESTORE] Device in auto-connect flow (" + deviceState.name() + "), skipping: " + deviceId);
                            continue;
                        }
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
        if (isDeviceInMcuMgrDfu(deviceId)) {
            Log.d(TAG, "⏭️ Skipping restoreSystemConnectedDevice - device in McuMgr DFU: " + deviceId);
            return;
        }
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
            
            // ════════════════════════════════════════════════════════════════════════════
            // Same flow as manual: queue-driven discovery (no direct discoverServices).
            // Use connectToDeviceWithQueueDrivenDiscovery so BLE stack gets same requestMtu → discoverServices order.
            // ════════════════════════════════════════════════════════════════════════════
            Log.d(TAG, "🔗 [BLEConnectionManager] System-restored connection (queue-driven): " + deviceId);
            
            connectingDevices.add(deviceId);
            connectionManager.connectToDeviceWithQueueDrivenDiscovery(deviceId, device, new BLEConnectionCallback() {
                    @Override
                    public void onConnectionStateChanged(String deviceId, ConnectionState state, BluetoothGatt gatt) {
                        if (state == ConnectionState.CONNECTED && gatt != null) {
                            Log.d(TAG, "✅ [BLEConnectionManager] System-restored device connected: " + deviceId);
                            
                            synchronized(gattLock) { connectedGatts.put(deviceId, gatt); }
                            getOrCreateGattQueue(deviceId).setGatt(gatt);
                            connectingDevices.remove(deviceId);
                            requestConnectionParameters(gatt, deviceId);
                            
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData == null) {
                                String deviceName = gatt.getDevice().getName();
                                if (deviceName == null || deviceName.isEmpty()) deviceName = "Unknown Device";
                                deviceData = new DeviceData(deviceId, deviceName);
                                deviceDataMap.put(deviceId, deviceData);
                            }
                            
                            // Same flow as manual/auto-connect: delay then requestMtu → onMtuChanged enqueues discoverServices
                            final int AUTO_CONNECT_STABILIZE_MS = 900;
                            mainHandler.postDelayed(() -> {
                                if (!connectedGatts.containsKey(deviceId)) return;
                                BluetoothGatt g = connectedGatts.get(deviceId);
                                if (g == null) return;
                                final String devId = deviceId;
                                enqueueGattOp(deviceId, () -> {
                                    pendingGattComplete.put(devId, (st) -> advanceGattQueue(devId));
                                    g.requestMtu(REQUESTED_MTU);
                                }, "requestMtu");
                            }, AUTO_CONNECT_STABILIZE_MS);
                            
                        } else if (state == ConnectionState.DISCONNECTED || state == ConnectionState.FAILED) {
                            Log.d(TAG, "❌ [BLEConnectionManager] System-restored device disconnected/failed: " + deviceId);
                            failGattQueueOnDisconnect(deviceId);
                            connectedGatts.remove(deviceId);
                            connectingDevices.remove(deviceId);
                            cleanupDeviceResources(deviceId);
                            DeviceData deviceData = deviceDataMap.get(deviceId);
                            if (deviceData != null) {
                                sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                            }
                        }
                    }
                    @Override
                    public void onServicesDiscovered(String deviceId, BluetoothGatt gatt, List<BluetoothGattService> services) {
                        Log.d(TAG, "✅ [BLEConnectionManager] Services discovered for system-restored device: " + deviceId);
                        
                        // Process services and enable notifications
                        handleServicesDiscovered(gatt);
                        
                        // Track as system-restored for special handling
                        systemRestoredDevices.add(deviceId);
                        
                        // Confirm connection to React Native layer
                        confirmConnection(deviceId, gatt);
                        
                        runPendingGattComplete(deviceId, BluetoothGatt.GATT_SUCCESS);
                    }
                    
                    @Override
                    public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        if (runPendingGattComplete(deviceId, status)) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                handleCharacteristicData(deviceId, characteristic);
                            }
                            return;
                        }
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            handleCharacteristicData(deviceId, characteristic);
                        }
                    }
                    
                    @Override
                    public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                        runPendingGattComplete(deviceId, status);
                    }
                    
                    @Override
                    public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                        handleCharacteristicData(deviceId, characteristic);
                    }
                    
                    /**
                     * Called when descriptor write completes (notification enable/disable)
                     * - Tracks notification enable progress
                     * - Queues next descriptor write if multiple characteristics need notifications
                     */
                    @Override
                    public void onDescriptorWrite(String deviceId, BluetoothGattDescriptor descriptor, int status) {
                        if (runPendingGattComplete(deviceId, status)) {
                            handleDescriptorWritePromise(deviceId, descriptor, status);
                            return;
                        }
                        handleDescriptorWritePromise(deviceId, descriptor, status);
                    }
                    
                    @Override
                    public void onMtuChanged(String deviceId, int mtu, int status) {
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (runPendingGattComplete(deviceId, status)) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Log.d(TAG, "✅ MTU changed for system-restored device: " + deviceId + " - MTU: " + mtu);
                            } else {
                                Log.e(TAG, "❌ MTU change failed for system-restored device: " + deviceId + " - Status: " + status);
                            }
                            if (gatt != null) {
                                enqueueDiscoverServicesOp(deviceId, gatt, "mtu_changed_system_restore");
                            }
                            return;
                        }
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Log.d(TAG, "✅ MTU changed for system-restored device: " + deviceId + " - MTU: " + mtu);
                        } else {
                            Log.e(TAG, "❌ MTU change failed for system-restored device: " + deviceId + " - Status: " + status);
                        }
                        if (gatt != null) {
                            enqueueDiscoverServicesOp(deviceId, gatt, "mtu_changed_system_restore");
                        }
                    }
                    
                    @Override
                    public void onReadRemoteRssi(String deviceId, int rssi, int status) {
                        if (runPendingGattComplete(deviceId, status)) {
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                Promise p = pendingRSSIPromises.remove(deviceId);
                                if (p == null) p = pendingRSSIPromises.remove("rssi_" + deviceId);
                                if (p != null) p.resolve(rssi);
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
                                    if (deviceData.temperature > 0) {
                                        deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                    } else {
                                        deviceDataUpdateEvent.putNull("temperature");
                                    }
                                    deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                    deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                    sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                                }
                                WritableMap rssiMap = Arguments.createMap();
                                rssiMap.putString("deviceId", deviceId);
                                rssiMap.putInt("rssi", rssi);
                                rssiMap.putDouble("timestamp", System.currentTimeMillis());
                                sendEvent("RSSIUpdate", rssiMap);
                            }
                            return;
                        }
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
            });
            
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

        // ════════════════════════════════════════════════════════════════════════════
        // SERIALIZED RESTORATION: Connect devices one at a time with a staggered
        // delay. Connecting two devices simultaneously saturates the Android BLE
        // controller queue and is a primary cause of GATT error 133. A 3-second gap
        // between connection attempts gives the first device's GATT handshake
        // (MTU + service discovery + CCCD writes ≈ 2.4 s) time to complete before
        // the second device starts, preventing stack overload.
        // ════════════════════════════════════════════════════════════════════════════
        int connectionDelayMs = 0;
        final int RESTORE_SERIALIZATION_GAP_MS = 3000;

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
                if (isDeviceInMcuMgrDfu(deviceId)) {
                    Log.d(TAG, "  ⏭️ Skipping restore - device in McuMgr DFU: " + deviceId);
                    continue;
                }
                hasDisconnectedBondedDevices = true;
                Log.d(TAG, "  🔄 Found disconnected bonded device - attempting reconnection: " + deviceId);
                
                BluetoothDevice device = bondedDevices.get(deviceId);
                if (device == null && bluetoothAdapter != null) {
                    try {
                        device = bluetoothAdapter.getRemoteDevice(deviceId);
                        bondedDevices.put(deviceId, device);
                    } catch (Exception e) {
                        Log.w(TAG, "  ⚠️ getRemoteDevice failed for " + deviceId + ": " + e.getMessage());
                    }
                }
                if (device != null) {
                    final BluetoothDevice finalDevice = device;
                    final String finalDeviceId = deviceId;
                    final int delayForThisDevice = connectionDelayMs;
                    reconnectAttemptsCount++;
                    if (delayForThisDevice == 0) {
                        Log.d(TAG, "  🚀 Restoring connection to: " + finalDeviceId + " (immediate)");
                        restoreConnectionToDevice(finalDeviceId, finalDevice);
                    } else {
                        Log.d(TAG, "  🕐 Queuing restore for: " + finalDeviceId + " (delay=" + delayForThisDevice + "ms — serialized to avoid BLE stack overload)");
                        mainHandler.postDelayed(() -> {
                            if (!connectedGatts.containsKey(finalDeviceId) && !connectingDevices.contains(finalDeviceId)) {
                                Log.d(TAG, "  🚀 Restoring connection to: " + finalDeviceId + " (after " + delayForThisDevice + "ms stagger)");
                                restoreConnectionToDevice(finalDeviceId, finalDevice);
                            } else {
                                Log.d(TAG, "  ⏭️ Skipping staggered restore — device already connecting/connected: " + finalDeviceId);
                            }
                        }, delayForThisDevice);
                    }
                    connectionDelayMs += RESTORE_SERIALIZATION_GAP_MS;
                } else {
                    Log.w(TAG, "  ⚠️ Device not found in bonded devices map: " + deviceId);
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
     * 3. Create GATT connection with autoConnect=true (via connectToDeviceForStateRestoration)
     * 4. Set up callbacks for connection lifecycle
     * 5. Start immediate data reading after 500ms delay
     * 
     * @param deviceId Device MAC address (e.g., "AA:BB:CC:DD:EE:FF")
     * @param device BluetoothDevice object
     * @throws SecurityException if BLUETOOTH_CONNECT permission missing (Android 12+)
     */
    private void restoreConnectionToDevice(String deviceId, BluetoothDevice device) {
        if (isDeviceInMcuMgrDfu(deviceId)) {
            Log.d(TAG, "⏭️ Skipping restoreConnectionToDevice - device in McuMgr DFU: " + deviceId);
            return;
        }
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
            
            // ════════════════════════════════════════════════════════════════════════════
            // State restoration uses autoConnect=true (via connectToDeviceForStateRestoration).
            // autoConnect=true lets the Android BLE controller manage connection timing:
            //   • Avoids GATT error 133 caused by aggressive parallel connectGatt calls
            //   • Works reliably for bonded-but-uncached (DEVICE_TYPE_UNKNOWN) devices
            //   • discoverServicesHandledByCaller=true preserved — GATT queue drives
            //     requestMtu → discoverServices as before
            // ════════════════════════════════════════════════════════════════════════════
            Log.d(TAG, "🔗 [BLEConnectionManager] State restoration (autoConnect=true): " + deviceId);
            
            connectingDevices.add(deviceId);
            connectionManager.connectToDeviceForStateRestoration(deviceId, device, new BLEConnectionCallback() {
                @Override
                public void onConnectionStateChanged(String deviceId, ConnectionState state, BluetoothGatt gatt) {
                    if (state == ConnectionState.CONNECTED && gatt != null) {
                        Log.d(TAG, "✅ [BLEConnectionManager] State restoration successful: " + deviceId);
                        connectingDevices.remove(deviceId);
                        restorationRetryCounts.remove(deviceId);
                            synchronized(gattLock) {
                                connectedGatts.put(deviceId, gatt);
                            }
                            getOrCreateGattQueue(deviceId).setGatt(gatt);
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
                            // Industry: wait before first GATT op so stack can stabilize (same as other auto-connect paths)
                            final int AUTO_CONNECT_STABILIZE_MS = 900;
                            Log.d(TAG, "📊 State restoration: delaying first GATT op by " + AUTO_CONNECT_STABILIZE_MS + "ms (stabilization)");
                            mainHandler.postDelayed(() -> {
                                if (!connectedGatts.containsKey(deviceId)) return;
                                enqueueDiscoverServicesOp(deviceId, gatt, "state_restore_connected");
                                // requestDeviceData + enableNotifications run from handleServicesDiscovered (after 1500ms delay) when onServicesDiscovered fires
                                // Do NOT run requestDeviceData here - discovery is async and may not be done yet
                                final int RSSI_HEALTH_DELAY_MS = 3000;
                                mainHandler.postDelayed(() -> {
                                    if (connectedGatts.containsKey(deviceId)) {
                                        startRSSIMonitoringForDevice(deviceId);
                                        startHealthDataApiMonitoringForDevice(deviceId);
                                    }
                                }, RSSI_HEALTH_DELAY_MS);
                            }, AUTO_CONNECT_STABILIZE_MS); 
                    } else if (state == ConnectionState.DISCONNECTED || state == ConnectionState.FAILED) {
                        Log.d(TAG, "❌ [BLEConnectionManager] State restoration failed: " + deviceId + " (state=" + (state == ConnectionState.FAILED ? "FAILED" : "DISCONNECTED") + ")");
                        failGattQueueOnDisconnect(deviceId);
                        connectingDevices.remove(deviceId);
                        connectedGatts.remove(deviceId);
                        cleanupDeviceResources(deviceId);
                        // Retry restoration with backoff (GATT 133 and similar often resolve with retry)
                        int attempt = restorationRetryCounts.getOrDefault(deviceId, 0);
                        if (attempt < MAX_RESTORATION_RETRIES) {
                            restorationRetryCounts.put(deviceId, attempt + 1);
                            long delayMs = attempt < STATUS_133_RETRY_DELAYS.length ? STATUS_133_RETRY_DELAYS[attempt] : STATUS_133_RETRY_DELAYS[STATUS_133_RETRY_DELAYS.length - 1];
                            Log.d(TAG, "🔄 [BLEConnectionManager] State restoration retry " + (attempt + 1) + "/" + MAX_RESTORATION_RETRIES + " in " + delayMs + "ms for " + deviceId);
                            final String retryDeviceId = deviceId;
                            mainHandler.postDelayed(() -> {
                                BluetoothDevice retryDevice = bondedDevices.get(retryDeviceId);
                                if (retryDevice == null && bluetoothAdapter != null) {
                                    try {
                                        retryDevice = bluetoothAdapter.getRemoteDevice(retryDeviceId);
                                        bondedDevices.put(retryDeviceId, retryDevice);
                                    } catch (Exception e) {
                                        Log.w(TAG, "⚠️ getRemoteDevice failed for restoration retry: " + e.getMessage());
                                    }
                                }
                                if (retryDevice != null && !connectedGatts.containsKey(retryDeviceId) && !connectingDevices.contains(retryDeviceId)) {
                                    restoreConnectionToDevice(retryDeviceId, retryDevice);
                                } else {
                                    restorationRetryCounts.remove(retryDeviceId);
                                }
                            }, delayMs);
                        } else {
                            Log.w(TAG, "❌ [BLEConnectionManager] State restoration gave up after " + MAX_RESTORATION_RETRIES + " attempts: " + deviceId);
                            restorationRetryCounts.remove(deviceId);
                        }
                    }
                }
                
                @Override
                public void onServicesDiscovered(String deviceId, BluetoothGatt gatt, List<BluetoothGattService> services) {
                    Log.d(TAG, "✅ [BLEConnectionManager] State restoration services discovered: " + deviceId);
                    // handleServicesDiscovered will call finalizeConnectionReady() which sets SECURE_READY
                    handleServicesDiscovered(gatt);
                    runPendingGattComplete(deviceId, BluetoothGatt.GATT_SUCCESS);
                }
                
                @Override
                public void onCharacteristicRead(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                    String characteristicUuid = characteristic.getUuid().toString();
                    if (runPendingGattComplete(deviceId, status)) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            handleCharacteristicData(deviceId, characteristic);
                        }
                        return;
                    }
                    Log.d(TAG, "📖 State restoration characteristic read: " + characteristicUuid + " on device " + deviceId + " - Status: " + status);
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        handleCharacteristicData(deviceId, characteristic);
                    }
                }
                
                @Override
                public void onCharacteristicWrite(String deviceId, BluetoothGattCharacteristic characteristic, int status) {
                    runPendingGattComplete(deviceId, status);
                }
                
                @Override
                public void onCharacteristicChanged(String deviceId, BluetoothGattCharacteristic characteristic) {
                    String characteristicUuid = characteristic.getUuid().toString();
                    Log.d(TAG, "📡 State restoration characteristic changed: " + characteristicUuid + " on device " + deviceId);
                    handleCharacteristicData(deviceId, characteristic);
                }
                
                @Override
                public void onReadRemoteRssi(String deviceId, int rssi, int status) {
                    if (runPendingGattComplete(deviceId, status)) {
                        if (status == BluetoothGatt.GATT_SUCCESS) {
                            Promise p = pendingRSSIPromises.remove(deviceId);
                            if (p == null) p = pendingRSSIPromises.remove("rssi_" + deviceId);
                            if (p != null) p.resolve(rssi);
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
                                if (deviceData.temperature > 0) {
                                    deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                } else {
                                    deviceDataUpdateEvent.putNull("temperature");
                                }
                                deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                            }
                            WritableMap rssiMap = Arguments.createMap();
                            rssiMap.putString("deviceId", deviceId);
                            rssiMap.putInt("rssi", rssi);
                            rssiMap.putDouble("timestamp", System.currentTimeMillis());
                            sendEvent("RSSIUpdate", rssiMap);
                        }
                        return;
                    }
                    if (status == BluetoothGatt.GATT_SUCCESS) {
                        Log.d(TAG, "📶 [STATE-RESTORE] RSSI read for " + deviceId + ": " + rssi);
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
                            if (deviceData.temperature > 0) {
                                deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                            } else {
                                deviceDataUpdateEvent.putNull("temperature");
                            }
                            deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                            deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                            sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                        }
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
                public void onDescriptorWrite(String deviceId, BluetoothGattDescriptor descriptor, int status) {
                    String charUuid = descriptor.getCharacteristic().getUuid().toString();
                    Log.d(TAG, "📝 [STATE-RESTORE] Descriptor write for " + charUuid + " on " + deviceId + " - Status: " + status);
                    if (runPendingGattComplete(deviceId, status)) {
                        handleDescriptorWritePromise(deviceId, descriptor, status);
                        return;
                    }
                    handleDescriptorWritePromise(deviceId, descriptor, status);
                }
            });
            
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
            // 100ms lets main thread settle; handleServicesDiscovered then delays ALL GATT ops (reads + notifications) by 1500ms
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (connectedGatts.containsKey(deviceId)) {
                        handleServicesDiscovered(gatt);
                    }
                }
            }, 100); 
        } else {
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (status) -> {
                    advanceGattQueue(deviceId);
                });
                gatt.requestMtu(512);
            });
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
                
                // Restore connections (delayed to allow service initialization)
                mainHandler.postDelayed(() -> {
                    restoreExistingConnections();
                    if (autoConnectEnabled && !bondedDeviceIds.isEmpty() && !allBondedDevicesConnectedOrConnecting()) {
                        startScanningForBondedDevices();
                    }
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
        return NAME;
    }
    private void addToBondedDevices(String deviceId, BluetoothDevice device) {
        if (!bondedDeviceIds.contains(deviceId)) {
            bondedDeviceIds.add(deviceId);
            bondedDevices.put(deviceId, device);
            saveBondedDevices();
            Log.d(TAG, "🔗 Added device to bonded list: " + deviceId);
        }
    }
    private void handleAutoDisconnectedDevice(String deviceId) {
        Log.d(TAG, "🔌 Handling auto-disconnected device: " + deviceId);
        try {
            failGattQueueOnDisconnect(deviceId);
            synchronized(gattLock) {
                BluetoothGatt gatt = connectedGatts.remove(deviceId);
                if (gatt != null) {
                    gatt.close();
                }
            }
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData != null) {
                // ✅ connectionState managed by BLEConnectionManager
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
        int mfgId = BLEClientConfigHolder.get().getManufacturerId();
        String serviceUuid = BLEClientConfigHolder.get().getSmartTagServiceUuid();
        List<ScanFilter> filters = new ArrayList<>();
        ScanFilter.Builder mfgFilter = new ScanFilter.Builder();
        mfgFilter.setManufacturerData(mfgId, null);
        filters.add(mfgFilter.build());
        Log.d(TAG, "✅ Added manufacturer ID filter (0x" + String.format("%04X", mfgId) + ")");
        ScanFilter.Builder serviceFilter = new ScanFilter.Builder();
        serviceFilter.setServiceUuid(ParcelUuid.fromString(serviceUuid));
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
            // ✅ Use helper to get connection state from BLEConnectionManager
            if ("connected".equals(getConnectionState(deviceId))) {
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
    
    /** True if every bonded device is either connected or connecting (skip scan this cycle when all good). */
    private boolean allBondedDevicesConnectedOrConnecting() {
        if (bondedDeviceIds.isEmpty()) return true;
        for (String deviceId : bondedDeviceIds) {
            if (connectedGatts.containsKey(deviceId) || connectingDevices.contains(deviceId)) continue;
            return false;
        }
        return true;
    }
    private static final long DISCONNECT_AFTER_STOP_DELAY_MS = 600;
    private void disconnectDevice(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) return;
        if (ensureDataSyncStopSent(deviceId)) {
            final BluetoothGatt gattToClose = gatt;
            mainHandler.postDelayed(() -> {
                if (connectedGatts.get(deviceId) == gattToClose) {
                    try {
                        gattToClose.disconnect();
                        gattToClose.close();
                    } catch (Exception e) {
                        Log.e(TAG, "❌ Error disconnecting after STOP: " + e.getMessage());
                    }
                    connectedGatts.remove(deviceId);
                }
            }, DISCONNECT_AFTER_STOP_DELAY_MS);
        } else {
            gatt.disconnect();
            gatt.close();
            connectedGatts.remove(deviceId);
        }
    }
    /**
     * Start service discovery with retry mechanism and timeout handling
     * 
     * @param gatt BluetoothGatt connection
     * @param deviceId Device MAC address
     * @param retryAttempt Current retry attempt (0 for first attempt)
     */
    private void startServiceDiscoveryWithRetry(BluetoothGatt gatt, String deviceId, int retryAttempt) {
        if (gatt == null) {
            Log.e(TAG, "❌ [SERVICE DISCOVERY] Cannot start - GATT is null for " + deviceId);
            return;
        }
        
        if (!connectedGatts.containsKey(deviceId)) {
            Log.w(TAG, "⚠️ [SERVICE DISCOVERY] Device not in connected map - skipping: " + deviceId);
            return;
        }
        
        // Check if services already discovered (some devices pre-cache)
        List<BluetoothGattService> existingServices = gatt.getServices();
        if (existingServices != null && existingServices.size() > 0) {
            Log.d(TAG, "✅ [SERVICE DISCOVERY] Services already available for " + deviceId + 
                " (" + existingServices.size() + " services) - processing immediately");
            
            WritableMap existingLogEvent = Arguments.createMap();
            existingLogEvent.putString("deviceId", deviceId);
            existingLogEvent.putString("action", "Service Discovery");
            existingLogEvent.putString("status", "success");
            existingLogEvent.putInt("serviceCount", existingServices.size());
            existingLogEvent.putString("platform", "Android");
            existingLogEvent.putString("note", "Services pre-cached - processing immediately");
            sendEvent("ConnectionLog", existingLogEvent);
            
            handleServicesDiscovered(gatt);
            return;
        }
        
        // Record start time for duration tracking
        serviceDiscoveryStartTimes.put(deviceId, System.currentTimeMillis());
        
        // Initialize retry tracking if this is the first attempt
        if (retryAttempt == 0) {
            serviceDiscoveryRetryAttempts.put(deviceId, 0);
        } else {
            // Ensure retry count matches the attempt number
            serviceDiscoveryRetryAttempts.put(deviceId, retryAttempt);
        }
        
        // Log service discovery initiation
        if (retryAttempt == 0) {
            Log.d(TAG, "🔍 [SERVICE DISCOVERY] Starting for " + deviceId);
        } else {
            Log.d(TAG, "🔄 [SERVICE DISCOVERY] Retry attempt " + retryAttempt + " for " + deviceId);
        }
        
        WritableMap startLogEvent = Arguments.createMap();
        startLogEvent.putString("deviceId", deviceId);
        startLogEvent.putString("action", "Service Discovery Start");
        startLogEvent.putInt("retryAttempt", retryAttempt);
        startLogEvent.putString("platform", "Android");
        startLogEvent.putString("note", retryAttempt == 0 ? 
            "Initiating service discovery" : 
            "Retrying service discovery (attempt " + retryAttempt + ")");
        sendEvent("ConnectionLog", startLogEvent);
        
        // Set up timeout timer
        ScheduledFuture<?> existingTimeout = serviceDiscoveryTimeouts.remove(deviceId);
        if (existingTimeout != null) {
            existingTimeout.cancel(false);
        }
        
        ScheduledFuture<?> timeoutTask = executorService.schedule(() -> {
            if (connectedGatts.containsKey(deviceId)) {
                Log.e(TAG, "⏰ [SERVICE DISCOVERY] Timeout after " + SERVICE_DISCOVERY_TIMEOUT_SECONDS + 
                    " seconds for " + deviceId);
                
                WritableMap timeoutLogEvent = Arguments.createMap();
                timeoutLogEvent.putString("deviceId", deviceId);
                timeoutLogEvent.putString("action", "Service Discovery Timeout");
                timeoutLogEvent.putString("status", "timeout");
                timeoutLogEvent.putInt("timeoutSeconds", SERVICE_DISCOVERY_TIMEOUT_SECONDS);
                timeoutLogEvent.putString("platform", "Android");
                timeoutLogEvent.putString("note", "Service discovery timed out - checking for cached services");
                sendEvent("ConnectionLog", timeoutLogEvent);
                
                // Check if services are available despite timeout
                List<BluetoothGattService> services = gatt.getServices();
                if (services != null && services.size() > 0) {
                    Log.w(TAG, "⚠️ [SERVICE DISCOVERY] Timeout but services found (" + services.size() + 
                        ") - processing anyway");
                    handleServicesDiscovered(gatt);
                } else {
                    // Retry if attempts remaining
                    Integer retryCount = serviceDiscoveryRetryAttempts.getOrDefault(deviceId, 0);
                    if (retryCount < MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS) {
                        retryCount++;
                        serviceDiscoveryRetryAttempts.put(deviceId, retryCount);
                        Log.d(TAG, "🔄 [SERVICE DISCOVERY] Timeout - retrying (" + retryCount + "/" + 
                            MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS + ") for " + deviceId);
                        
                        // Create final copy for inner class
                        final int finalRetryCount = retryCount;
                        final BluetoothGatt finalGatt = gatt;
                        final String finalDeviceId = deviceId;
                        
                        mainHandler.postDelayed(new Runnable() {
                            @Override
                            public void run() {
                                if (connectedGatts.containsKey(finalDeviceId)) {
                                    startServiceDiscoveryWithRetry(finalGatt, finalDeviceId, finalRetryCount);
                                }
                            }
                        }, 1000 * finalRetryCount);
                    } else {
                        Log.e(TAG, "❌ [SERVICE DISCOVERY] Max retries reached after timeout for " + deviceId);
                        serviceDiscoveryRetryAttempts.remove(deviceId);
                        serviceDiscoveryStartTimes.remove(deviceId);
                    }
                }
            }
        }, SERVICE_DISCOVERY_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        
        serviceDiscoveryTimeouts.put(deviceId, timeoutTask);
        
        // Initiate service discovery via the per-device GATT queue (no direct gatt.discoverServices() outside queue)
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
            boolean discoverResult = gatt.discoverServices();
            if (!discoverResult) {
                Log.e(TAG, "❌ [SERVICE DISCOVERY] Failed to initiate for " + deviceId);
                
                // Cancel timeout
                timeoutTask.cancel(false);
                serviceDiscoveryTimeouts.remove(deviceId);
                serviceDiscoveryStartTimes.remove(deviceId);
                
                WritableMap failLogEvent = Arguments.createMap();
                failLogEvent.putString("deviceId", deviceId);
                failLogEvent.putString("action", "Service Discovery Failed");
                failLogEvent.putString("status", "initiation_failed");
                failLogEvent.putString("platform", "Android");
                failLogEvent.putString("note", "gatt.discoverServices() returned false");
                sendEvent("ConnectionLog", failLogEvent);
                
                // Retry if attempts remaining
                Integer retryCount = serviceDiscoveryRetryAttempts.getOrDefault(deviceId, 0);
                if (retryCount < MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS) {
                    retryCount++;
                    serviceDiscoveryRetryAttempts.put(deviceId, retryCount);
                    Log.d(TAG, "🔄 [SERVICE DISCOVERY] Retrying after initiation failure (" + retryCount + "/" + 
                        MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS + ") for " + deviceId);
                    
                    // Create final copies for inner class
                    final int finalRetryCount = retryCount;
                    final BluetoothGatt finalGatt = gatt;
                    final String finalDeviceId = deviceId;
                    
                    mainHandler.postDelayed(new Runnable() {
                        @Override
                        public void run() {
                            if (connectedGatts.containsKey(finalDeviceId)) {
                                startServiceDiscoveryWithRetry(finalGatt, finalDeviceId, finalRetryCount);
                            }
                        }
                    }, 1000 * finalRetryCount);
                } else {
                    Log.e(TAG, "❌ [SERVICE DISCOVERY] Max retries reached after initiation failure for " + deviceId);
                    serviceDiscoveryRetryAttempts.remove(deviceId);
                }
                
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
            } else {
                Log.d(TAG, "✅ [SERVICE DISCOVERY] Initiated successfully for " + deviceId);
            }
        });
        
        // Fallback: Check for services after delay (in case callback doesn't fire)
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (connectedGatts.containsKey(deviceId)) {
                    List<BluetoothGattService> services = gatt.getServices();
                    if (services != null && services.size() > 0) {
                        // Only process if notifications haven't been enabled yet
                        Integer pending = pendingNotificationEnables.get(deviceId);
                        if (pending == null) {
                            Log.d(TAG, "✅ [SERVICE DISCOVERY] Fallback: Found " + services.size() + 
                                " services for " + deviceId + " - processing");
                            handleServicesDiscovered(gatt);
                        }
                    }
                }
            }
        }, 2000); // 2 second fallback delay
    }
    
    /**
     * ═══════════════════════════════════════════════════════════════════════════════
     * UNIFIED ENTRY POINT: handleServicesDiscovered()
     * ═══════════════════════════════════════════════════════════════════════════════
     * 
     * This is the SINGLE, UNIFIED entry point where both manual and auto-connect flows
     * converge after GATT service discovery completes.
     * 
     * CONNECTION FLOW DIAGRAM:
     * 
     *   Manual Connect              Auto Connect
     *        ↓                           ↓
     *   connectToDevice()      [BLEConnectionManager]
     *        ↓                           ↓
     *   onConnectionStateChange    onConnectionStateChange
     *        ↓                           ↓
     *   discoverServices()         discoverServices()
     *        ↓                           ↓
     *   onServicesDiscovered       onServicesDiscovered
     *        ↓                           ↓
     *        ╰───────────┬───────────────╯
     *                    ↓
     *       handleServicesDiscovered()  ← YOU ARE HERE (UNIFIED ENTRY POINT)
     *                    ↓
     *         (All same methods from here)
     *                    ↓
     *       enableNotificationsFirst()
     *                    ↓
     *       onAllNotificationsEnabled()
     *                    ↓
     *       readDeviceStatusToCheckRTC()
     *                    ↓
     *       proceedWithCommandSequenceAfterDeviceStatusRead()
     *                    ↓
     *       sendDataAcquisitionAndLiveNotifications()
     *                    ↓
     *            DEVICE READY! ✅
     * 
     * Key differences handled in THIS method:
     * - Auto-connect: Uses 800-1500ms delay before enabling notifications
     * - Manual connect: Uses 0-300ms delay based on service cache status
     * 
     * Everything else flows through IDENTICAL code paths.
     * ═══════════════════════════════════════════════════════════════════════════════
     */
    private void handleServicesDiscovered(BluetoothGatt gatt) {
        String deviceId = gatt.getDevice().getAddress();
        // Industry rule: No CCCD, reads, or RSSI until services are discovered.
        // All such ops are enqueued only from this path (after onServicesDiscovered).
        
        // ✅ CRITICAL FIX: Cancel service discovery timeout to prevent retry
        // This is the UNIFIED entry point for both manual and auto-connect, so we cancel here
        ScheduledFuture<?> timeoutTask = serviceDiscoveryTimeouts.remove(deviceId);
        if (timeoutTask != null) {
            timeoutTask.cancel(false);
            Log.d(TAG, "✅ [SERVICE DISCOVERY] Timeout canceled for " + deviceId);
        }
        
        // Clear retry counter and start time on success
        serviceDiscoveryRetryAttempts.remove(deviceId);
        serviceDiscoveryStartTimes.remove(deviceId);
        
        // ✅ FIX: Guard against duplicate service discovery processing
        // This prevents duplicate notification enables when handleServicesDiscovered is called multiple times
        // (e.g., from both onServicesDiscovered callback AND fallback timer in auto-connect)
        if (notificationsEnableInProgress.contains(deviceId)) {
            Log.d(TAG, "⏭️ [FLOW] Service discovery already in progress for " + deviceId + " - skipping duplicate call");
            return;
        }
        if (hasEmittedServicesDiscovered.contains(deviceId)) {
            Log.d(TAG, "⏭️ [FLOW] Services already discovered and processed for " + deviceId + " - skipping duplicate call");
            return;
        }
        
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
        deviceData.isSmartTag = deviceData.services.containsKey(BLEClientConfigHolder.get().getSmartTagServiceUuid());
        
        // CORRECT FLOW (SDD v1.5): Enable notifications FIRST, then check RTC
        // Reason: To send/receive commands (like Set System Time), notifications must be enabled
        // 1. Enable notifications for all critical characteristics
        // 2. When notifications are ready, read Device Status to check RTC
        // 3. If RTC invalid, send Set System Time (response comes via System Command notification)
        // 4. Proceed with Data Sync
        
        // Industry standard: 1500–2000ms after service discovery before ANY GATT op (reads AND writeDescriptor).
        // Android BLE stack needs this delay before readCharacteristic/writeDescriptor or callbacks are dropped.
        boolean servicesWereCached = gatt.getServices() != null && !gatt.getServices().isEmpty();
        final int DELAY_AFTER_DISCOVERY_MS_MIN = 1500;
        final int DELAY_AFTER_DISCOVERY_MS_SAFE = 2000;
        int delayMs = servicesWereCached ? DELAY_AFTER_DISCOVERY_MS_MIN : DELAY_AFTER_DISCOVERY_MS_SAFE;
        Log.d(TAG, "🔔 [FLOW] Manual connect - waiting " + delayMs + "ms after discovery before ANY GATT ops (reads + notifications) cached=" + servicesWereCached);
        final BluetoothGatt finalGatt = gatt;
        final int finalNotificationsToEnable = notificationsToEnable;
        mainHandler.postDelayed(new Runnable() {
            @Override
            public void run() {
                Log.d(TAG, "🔔 [FLOW] After " + delayMs + "ms delay - queuing reads then notifications");
                requestDeviceData(deviceId);
                enableNotificationsFirst(finalGatt, deviceId, services, finalNotificationsToEnable);
            }
        }, delayMs);
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
        // ✅ ROOT CAUSE FIX: Do NOT call requestDeviceData(deviceId) here!
        // Reads were firing ~25ms after discovery and gatt.readCharacteristic() returned false.
        // All GATT ops (reads + notification enable) now run AFTER the same delay (1500–2000ms) in the runnables above.
        
        // ✅ CRITICAL FIX: DO NOT call finalizeConnectionReady() here!
        // SECURE_READY should only be set AFTER:
        // 1. Notifications are enabled
        // 2. Device Status is read
        // 3. RTC is validated
        // 4. Command sequence completes
        // 
        // finalizeConnectionReady() will be called from sendDataAcquisitionAndLiveNotifications()
        // which is the END of the unified flow for both manual and auto-connect
        //
        // Previous bug: Calling finalizeConnectionReady() here set SECURE_READY immediately
        // after service discovery, skipping the entire notification → RTC → command flow!
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
        // Restore connection interval to 360ms if DFU failed earlier (firmware stayed at 15ms)
        if (dfuFailedNeedsConnIntervalRestore.remove(deviceId)) {
            Log.i(TAG, "📤 [DFU RESTORE] Restoring connection interval to 360ms for " + deviceId + " (DFU had failed)");
            byte[] payload360 = new byte[] { (byte) 0x68, (byte) 0x01, (byte) 0x00, (byte) 0x00 }; // 360 LE
            sendSystemCommand(deviceId, CMD_SET_CONN_INTERVAL, payload360);
        }
        SecureReadyState currentState = secureReadyStates.get(deviceId);
        Log.d(TAG, "🔍 [UNIFIED] Checking SECURE_READY state for " + deviceId + ": " + (currentState != null ? currentState.name() : "null"));
        
        if (currentState == SecureReadyState.SECURE_READY) {
            Log.d(TAG, "   ⏸️ Already SECURE_READY");
            // SDD v1.5: Sync is started by JS when it receives Device Status (maybeTriggerAutoSyncFromDeviceStatus → startDataSync).
            // Do NOT trigger native AUTO-SYNC here – it causes a second sync when SECURE_READY is set on the 1s delayed runnable
            // (proceedWithCommandSequenceAfterDeviceStatusRead), after JS has already started and completed the first sync.
            return;
        }
        
        // Ensure GATT is in connectedGatts map (may have been added by other flows)
        synchronized(gattLock) {
            if (!connectedGatts.containsKey(deviceId)) {
                connectedGatts.put(deviceId, gatt);
                Log.d(TAG, "   ✅ Added GATT to connectedGatts map");
            }
        }
        getOrCreateGattQueue(deviceId).setGatt(gatt);
        
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
        
        // Connection type: manual only (auto-connect removed)
        String connectionType = "manual";
        
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
        
        // SDD v1.5: Do NOT start sync here. Sync is started by JS when it receives Device Status
        // (handleDeviceStatusUpdate → maybeTriggerAutoSyncFromDeviceStatus → startDataSync).
        // This method runs from sendDataAcquisitionAndLiveNotifications(), which is invoked on a 1s delay
        // (proceedWithCommandSequenceAfterDeviceStatusRead). By then JS has already received Device Status
        // and started the first sync – triggering AUTO-SYNC here would start a redundant second sync.
    }
    
    /**
     * Before starting sync from native (AUTO-SYNC ON READY), read Device Status characteristic once to get
     * the actual record count. When that read completes, we start sync. Device Status is only for count
     * (how many records to sync); sync protocol (e.g. >500 / <500, chunking) is unchanged.
     */
    private void startAutoSyncAfterDeviceStatusRead(String deviceId) {
        try {
            if (Boolean.TRUE.equals(dataSyncRequested.get(deviceId))) {
                Log.d(TAG, "   [AUTO-SYNC] Sync already requested by JS, skipping native auto-sync");
                return;
            }
            if ("complete".equals(dataSyncState.getOrDefault(deviceId, "idle"))) {
                Log.d(TAG, "   [AUTO-SYNC] Sync already complete for " + deviceId + ", skipping (defensive)");
                return;
            }
            DeviceData deviceData = deviceDataMap.get(deviceId);
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (deviceData == null || gatt == null) {
                Log.e(TAG, "❌ [AUTO-SYNC] Cannot read Device Status - deviceData or gatt null for " + deviceId);
                return;
            }
            BluetoothGattCharacteristic deviceStatusChar = deviceData.characteristics.get(DEVICE_STATUS_CHAR_UUID);
            if (deviceStatusChar == null) {
                Log.e(TAG, "❌ [AUTO-SYNC] Device Status characteristic not found for " + deviceId);
                return;
            }
            pendingAutoSyncAfterDeviceStatusRead.add(deviceId);
            Log.d(TAG, "📖 [AUTO-SYNC] Reading Device Status for actual record count before starting sync: " + deviceId);
            enqueueReadCharacteristicOp(deviceId, gatt, deviceStatusChar, "autoSync_deviceStatus");
            // Fallback: if read never completes (e.g. GATT error), start sync with last known count after 5s
            ScheduledFuture<?> existing = pendingAutoSyncReadTimeout.put(deviceId, executorService.schedule(() -> {
                pendingAutoSyncReadTimeout.remove(deviceId);
                if (pendingAutoSyncAfterDeviceStatusRead.remove(deviceId)) {
                    Log.w(TAG, "⚠️ [AUTO-SYNC] Device Status read timeout - starting sync with last known count");
                    mainHandler.post(() -> doStartAutoSyncAfterDeviceStatusRead(deviceId));
                }
            }, 5, TimeUnit.SECONDS));
            if (existing != null) existing.cancel(false);
        } catch (Exception e) {
            Log.e(TAG, "❌ [AUTO-SYNC] Error before Device Status read: " + e.getMessage());
            pendingAutoSyncAfterDeviceStatusRead.remove(deviceId);
        }
    }
    
    /** Runs on main thread after Device Status read (or timeout): start sync with current deviceRecordCounts. */
    private void doStartAutoSyncAfterDeviceStatusRead(String deviceId) {
        try {
            if (Boolean.TRUE.equals(dataSyncRequested.get(deviceId))) {
                Log.d(TAG, "   [AUTO-SYNC] Sync already requested by JS, skipping");
                return;
            }
            if ("complete".equals(dataSyncState.getOrDefault(deviceId, "idle"))) {
                Log.d(TAG, "   [AUTO-SYNC] Sync already complete for " + deviceId + ", skipping (defensive)");
                return;
            }
            Integer recordCount = deviceRecordCounts.get(deviceId);
            if (recordCount == null || recordCount <= 0) {
                Log.d(TAG, "   [AUTO-SYNC] No records to sync (recordCount=" + recordCount + ") - skipping");
                return;
            }
            Log.d(TAG, "📤 [AUTO-SYNC ON READY] Sending Data Sync Start command for " + deviceId + " (actual count: " + recordCount + ")");
            Boolean rtcValid = deviceRTCValidity.get(deviceId);
            dataSyncState.put(deviceId, "idle");
            dataSyncRequested.put(deviceId, false);
            if (rtcValid != null && rtcValid) {
                dataSyncRequested.put(deviceId, true);
                boolean success = sendDataSyncStartCommand(deviceId, 0);
                if (success) {
                    Log.d(TAG, "✅ [AUTO-SYNC ON READY] Data sync started successfully (RTC already valid)");
                } else {
                    dataSyncRequested.put(deviceId, false);
                    Log.e(TAG, "❌ [AUTO-SYNC ON READY] Failed to send data sync start command");
                }
            } else {
                Log.d(TAG, "⏰ [AUTO-SYNC ON READY] RTC invalid - syncing time first");
                sendSetSystemTimeCommand(deviceId);
                executorService.schedule(() -> {
                    dataSyncRequested.put(deviceId, true);
                    boolean success = sendDataSyncStartCommand(deviceId, 0);
                    if (success) {
                        Log.d(TAG, "✅ [AUTO-SYNC ON READY] Data sync started successfully (after time sync)");
                    } else {
                        dataSyncRequested.put(deviceId, false);
                        Log.e(TAG, "❌ [AUTO-SYNC ON READY] Failed to send data sync start command after time sync");
                    }
                }, 6, TimeUnit.SECONDS);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ [AUTO-SYNC ON READY] Error starting sync: " + e.getMessage());
        }
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
            enqueueReadCharacteristicOp(deviceId, gatt, batteryChar, "requestDeviceData_battery");
        }
        BluetoothGattCharacteristic manufacturerChar = deviceData.characteristics.get(MANUFACTURER_NAME_CHAR_UUID);
        if (manufacturerChar != null) {
            enqueueReadCharacteristicOp(deviceId, gatt, manufacturerChar, "requestDeviceData_manufacturer");
        }
        BluetoothGattCharacteristic modelChar = deviceData.characteristics.get(MODEL_NUMBER_CHAR_UUID);
        if (modelChar != null) {
            enqueueReadCharacteristicOp(deviceId, gatt, modelChar, "requestDeviceData_model");
        }
        BluetoothGattCharacteristic firmwareChar = deviceData.characteristics.get(FIRMWARE_REVISION_CHAR_UUID);
        if (firmwareChar != null) {
            enqueueReadCharacteristicOp(deviceId, gatt, firmwareChar, "requestDeviceData_firmware");
        }
        if (deviceData.isSmartTag) {
            BluetoothGattCharacteristic dataTransferChar = deviceData.characteristics.get(DATA_TRANSFER_CHAR_UUID);
            if (dataTransferChar != null) {
                enqueueReadCharacteristicOp(deviceId, gatt, dataTransferChar, "requestDeviceData_dataTransfer");
            }
        } else {
        }
    }
    private void enableNotifications(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        // Always route CCCD writes through the per-device GATT queue.
        String deviceId = gatt.getDevice() != null ? gatt.getDevice().getAddress() : null;
        if (deviceId == null) {
            Log.w(TAG, "⚠️ Cannot enable notifications: deviceId is null");
            return;
        }
        enableNotificationsWithTracking(gatt, characteristic, deviceId);
    }
    private static final java.util.UUID CCC_DESCRIPTOR_UUID = java.util.UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    /**
     * Industry fix: get fresh service/characteristic/descriptor from gatt before each writeDescriptor.
     * Caching objects from service discovery and reusing them can cause onDescriptorWrite to never be called.
     */
    private void enableNotificationsWithTracking(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, String deviceId) {
        if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) != PackageManager.PERMISSION_GRANTED) {
            Log.e(TAG, "❌ Cannot enable notifications: BLUETOOTH_CONNECT permission not granted");
            return;
        }
        java.util.UUID serviceUuid = characteristic.getService().getUuid();
        java.util.UUID charUuid = characteristic.getUuid();
        String charUuidStr = charUuid.toString();
        // 🔍 [FRESH] Log fresh object fetch (before queue) - must use gatt.getService/getCharacteristic/getDescriptor
        Log.d(TAG, "🔍 [FRESH] Fetching fresh objects for notification enable");
        Log.d(TAG, "🔍 [FRESH] GATT object: " + gatt);
        Log.d(TAG, "🔍 [FRESH] Looking for service: " + serviceUuid);
        BluetoothGattService service = gatt.getService(serviceUuid);
        Log.d(TAG, "🔍 [FRESH] Service found: " + service);
        if (service == null) {
            Log.e(TAG, "❌ [FRESH] Service is NULL! Cannot enable notifications for: " + charUuidStr);
            onNotificationEnabled(deviceId);
            return;
        }
        BluetoothGattCharacteristic freshChar = service.getCharacteristic(charUuid);
        Log.d(TAG, "🔍 [FRESH] Characteristic found: " + freshChar);
        if (freshChar == null) {
            Log.e(TAG, "❌ [FRESH] Characteristic is NULL! for: " + charUuidStr);
            onNotificationEnabled(deviceId);
            return;
        }
        BluetoothGattDescriptor descriptor = freshChar.getDescriptor(CCC_DESCRIPTOR_UUID);
        Log.d(TAG, "🔍 [FRESH] Descriptor found: " + descriptor);
        if (descriptor == null) {
            Log.e(TAG, "❌ [FRESH] CCC Descriptor is NULL! for: " + charUuidStr);
            onNotificationEnabled(deviceId);
            return;
        }
        // Do NOT call setCharacteristicNotification here - Android allows only one GATT op at a time.
        // Call it inside the queue op so it runs when no read/write is in flight (avoids "setCharacteristicNotification failed").
        notificationEnableAttempts.putIfAbsent(deviceId + "_" + charUuidStr, 0);
        final DescriptorWriteRequest req = new DescriptorWriteRequest(gatt, freshChar, descriptor, deviceId, charUuidStr);
        int cccdTimeoutMs = 0;
        enqueueGattOp(deviceId, () -> {
            Log.d(TAG, "🔍 [QUEUE] writeDesc operation executing NOW for: " + charUuidStr);
            BluetoothGatt g = connectedGatts.get(deviceId);
            if (g == null) {
                Log.e(TAG, "❌ [QUEUE] GATT is null for device: " + deviceId);
                pendingGattComplete.remove(deviceId);
                onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                advanceGattQueue(deviceId);
                return;
            }
            Log.d(TAG, "🔍 [QUEUE] Fetching fresh descriptor again from GATT");
            BluetoothGattService s = g.getService(serviceUuid);
            BluetoothGattCharacteristic c = s != null ? s.getCharacteristic(charUuid) : null;
            BluetoothGattDescriptor d = c != null ? c.getDescriptor(CCC_DESCRIPTOR_UUID) : null;
            Log.d(TAG, "🔍 [QUEUE] service=" + (s != null ? s : "null") + " char=" + (c != null ? c : "null") + " descriptor=" + (d != null ? d : "null"));
            if (d == null) {
                Log.e(TAG, "❌ [QUEUE] CCC descriptor is NULL for: " + charUuidStr);
                pendingGattComplete.remove(deviceId);
                onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                advanceGattQueue(deviceId);
                return;
            }
            // setCharacteristicNotification inside queue op so no other GATT op is in flight (fixes "setCharacteristicNotification failed").
            boolean notificationResult = g.setCharacteristicNotification(c, true);
            if (!notificationResult) {
                Log.e(TAG, "❌ [QUEUE] setCharacteristicNotification failed for: " + charUuidStr + " (GATT busy or invalid)");
                pendingGattComplete.remove(deviceId);
                onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                advanceGattQueue(deviceId);
                return;
            }
            d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
            Log.d(TAG, "🔍 [QUEUE] About to call writeDescriptor");
            Log.d(TAG, "🔍 [QUEUE] Descriptor: " + d);
            Log.d(TAG, "🔍 [QUEUE] Descriptor value: " + Arrays.toString(d.getValue()));
            // Do NOT call advanceGattQueue here: queue already advances in onOperationComplete when BLE callback fires.
            // Calling it caused DATA_SYNC_STOP to be force-completed with 257 when Battery CCCD completed (race).
            pendingGattComplete.put(deviceId, (status) -> {
                onDescriptorWriteCompleteWithRequest(deviceId, req, status);
            });
            boolean success = g.writeDescriptor(d);
            Log.d(TAG, "🔍 [QUEUE] writeDescriptor returned: " + success);
            if (!success) {
                Log.e(TAG, "❌ [QUEUE] writeDescriptor returned FALSE! for: " + charUuidStr);
                pendingGattComplete.remove(deviceId);
                onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                advanceGattQueue(deviceId);
            }
        }, "writeDesc:" + charUuidStr, cccdTimeoutMs);
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
        final java.util.List<BluetoothGattCharacteristic> toEnable = new java.util.ArrayList<>();
        for (BluetoothGattService service : services) {
            List<BluetoothGattCharacteristic> serviceCharacteristics = service.getCharacteristics();
            for (BluetoothGattCharacteristic characteristic : serviceCharacteristics) {
                String charUuid = characteristic.getUuid().toString();
                if (charUuid.equals(SYSTEM_COMMAND_CHAR_UUID) ||
                    charUuid.equals(DEVICE_STATUS_CHAR_UUID) ||
                    charUuid.equals(DATA_TRANSFER_CHAR_UUID) ||
                    charUuid.equals(BATTERY_LEVEL_CHAR_UUID)) {
                    WritableMap charInfo = Arguments.createMap();
                    charInfo.putString("uuid", charUuid);
                    charInfo.putString("name", getCharacteristicName(charUuid));
                    characteristicsList.pushMap(charInfo);
                    toEnable.add(characteristic);
                }
            }
        }
        // Industry: 100ms between each descriptor write so BLE stack delivers callbacks (avoid phantom success)
        final BluetoothGatt finalGatt = gatt;
        for (int i = 0; i < toEnable.size(); i++) {
            final BluetoothGattCharacteristic ch = toEnable.get(i);
            final int delayMs = i * 100;
            mainHandler.postDelayed(() -> enableNotificationsWithTracking(finalGatt, ch, deviceId), delayMs);
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
                            enqueueReadCharacteristicOp(deviceId, gatt, batteryChar, "post_notifications_battery");
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
            
            // ✅ FIX: Increased fallback timeout from 8s to 15s to give GATT queue time to clear
            // This prevents premature timeout in auto-connect when queue is congested
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    if (commandSequenceProceeded.contains(deviceId)) return;
                    // Skip if device disconnected (e.g. for McuMgr DFU) — avoids "Failed to send Set System Time: Device not connected"
                    if (connectedGatts.get(deviceId) == null) {
                        Log.d(TAG, "⚠️ [FALLBACK TIMEOUT] Skipping command sequence - device no longer connected (e.g. DFU)");
                        return;
                    }
                    Log.w(TAG, "⚠️ [FALLBACK TIMEOUT] Command sequence not started after 15s - triggering once");
                    proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
                }
            }, 15000); 
            
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
        
        // Read Device Status to check RTC (via global GATT queue)
        BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
        if (deviceStatusChar != null) {
            Log.d(TAG, "📖 [RTC CHECK] Reading Device Status characteristic to check RTC...");
            rtcCheckPendingBeforeNotifications.put(deviceId, true);
            final BluetoothGattCharacteristic charToRead = deviceStatusChar;
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (status) -> {
                    advanceGattQueue(deviceId);
                });
                boolean readSuccess = gatt.readCharacteristic(charToRead);
                if (!readSuccess) {
                    Log.w(TAG, "⚠️ [RTC CHECK] Failed to initiate Device Status read - proceeding anyway");
                    pendingGattComplete.remove(deviceId);
                    rtcCheckPendingBeforeNotifications.remove(deviceId);
                    advanceGattQueue(deviceId);
                    proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
                }
            });
            // parseDeviceStatusData will be called in onCharacteristicRead when read completes
        } else {
            Log.w(TAG, "⚠️ [RTC CHECK] Device Status characteristic not found - skipping RTC check");
            proceedWithCommandSequenceAfterDeviceStatusRead(deviceId);
        }
    }
    
    /**
     * Industry fix (Issue 1): Immediately after SET_SYSTEM_TIME success, trigger one Device Status read
     * via the global GATT queue. When the read completes, parseDeviceStatusData runs (updates recordCount,
     * RTC validity) and then we call sendDataAcquisitionAndLiveNotifications so JS gets ready with fresh
     * recordCount and can start sync without waiting for async status notifications (~55s delay removed).
     */
    /**
     * ✅ FIX: Immediately read Device Status after SET_TIME to get fresh recordCount.
     * Uses PRIORITY queue to bypass other pending operations (notification enables, etc).
     * This eliminates the 43-second delay seen in auto-connect flow.
     * 
     * Industry practice: Critical operations that gate sync should jump the queue.
     */
    private void triggerDeviceStatusReadAfterSetTime(String deviceId) {
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt == null) {
            Log.w(TAG, "⚠️ [POST SET TIME] GATT null - setting ready without re-read");
            sendDataAcquisitionAndLiveNotifications(deviceId);
            return;
        }
        BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
        if (deviceStatusChar == null) {
            Log.w(TAG, "⚠️ [POST SET TIME] Device Status char not found - setting ready without re-read");
            sendDataAcquisitionAndLiveNotifications(deviceId);
            return;
        }
        deviceStatusReadAfterSetTimePending.put(deviceId, true);
        Log.d(TAG, "📖 [POST SET TIME] Reading Device Status with PRIORITY (bypassing queue congestion)");
        final BluetoothGattCharacteristic charToRead = deviceStatusChar;
        
        if (checkGattQueueWedgedAndReset(deviceId)) return;
        // ✅ FIX: Use enqueuePriority instead of enqueueGattOp to jump to front of queue
        GattOperationQueue q = gattQueues.get(deviceId);
        if (q == null) {
            Log.w(TAG, "⚠️ [POST SET TIME] No queue for " + deviceId);
            sendDataAcquisitionAndLiveNotifications(deviceId);
            return;
        }
        
        q.enqueuePriority(new RunnableGattOp(
            () -> {
                boolean readSuccess = gatt.readCharacteristic(charToRead);
                if (!readSuccess) {
                    deviceStatusReadAfterSetTimePending.remove(deviceId);
                    Log.w(TAG, "⚠️ [POST SET TIME] Device Status read failed - setting ready anyway");
                    sendDataAcquisitionAndLiveNotifications(deviceId);
                    q.onOperationComplete(BluetoothGatt.GATT_FAILURE);
                }
            },
            (status) -> {
                // onComplete handled in parseDeviceStatusData when read completes
            },
            "ReadDeviceStatus_PostSetTime_PRIORITY"
        ));
    }

    /**
     * Proceed with command sequence after Device Status read is complete.
     * 
     * SDD v1.5: Device Status never starts sync. This method only decides RTC→Set Time or "ready".
     * It must NEVER call sendDataSyncStartCommand. Sync starts only when JS calls startDataSync(deviceId).
     * 
     * - RTC invalid/unknown → sendSetSystemTimeCommand (device will ack via Command char; then we call sendDataAcquisitionAndLiveNotifications)
     * - RTC valid → sendDataAcquisitionAndLiveNotifications ("ready" only; JS decides and calls startDataSync)
     */
    private void proceedWithCommandSequenceAfterDeviceStatusRead(String deviceId) {
        if (connectedGatts.get(deviceId) == null) {
            Log.d(TAG, "📌 [COMMAND SEQUENCE] Skipping - device not connected (e.g. disconnected for DFU)");
            return;
        }
        if (!commandSequenceProceeded.add(deviceId)) {
            Log.d(TAG, "📌 [COMMAND SEQUENCE] Already proceeded for " + deviceId + " - skipping duplicate (SDD v1.5)");
            return;
        }
        Boolean rtcValid = deviceRTCValidity.get(deviceId);
        
        // ✅ CRITICAL FIX: Check advertisement data if Device Status read didn't populate RTC validity
        if (rtcValid == null) {
            Log.d(TAG, "⚠️ [COMMAND SEQUENCE] RTC validity unknown from Device Status - checking advertisement data...");
            // Try to get RTC validity from advertisement data (already stored in deviceRTCValidity during scan)
            rtcValid = deviceRTCValidity.get(deviceId);
            if (rtcValid != null) {
                Log.d(TAG, "✅ [COMMAND SEQUENCE] RTC validity recovered from advertisement data: " + (rtcValid ? "VALID" : "INVALID"));
            } else {
                Log.w(TAG, "⚠️ [COMMAND SEQUENCE] RTC validity unavailable from both Device Status and advertisement - will set time");
            }
        }
        
        // ✅ FIX: Only set time if RTC is explicitly invalid or truly unknown
        // If RTC is valid (from Device Status OR advertisement), skip time setting
        // Wait 1 second in both cases for consistent timing
        if (rtcValid != null && rtcValid) {
            Log.d(TAG, "✅ [COMMAND SEQUENCE] RTC valid - waiting 1 second before setting ready (SDD v1.5: no sync start here; JS calls startDataSync)");
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    sendDataAcquisitionAndLiveNotifications(deviceId);
                }
            }, 1000);
        } else {
            Log.d(TAG, "🕐 [COMMAND SEQUENCE] RTC invalid or unknown - waiting 1 second before sending Set System Time command for " + deviceId);
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    sendSetSystemTimeCommand(deviceId);
                }
            }, 1000);
        }
    }
    
    /**
     * Called from global GATT queue consumer when a CCCD descriptor write completes.
     * Handles success/failure and retries via enqueueGattOp (no per-descriptor queue).
     */
    private void onDescriptorWriteCompleteWithRequest(String deviceId, DescriptorWriteRequest req, int status) {
        String charName = getCharacteristicName(req.charUuid);
        if (status == BluetoothGatt.GATT_SUCCESS) {
            notificationEnableAttempts.remove(deviceId + "_" + req.charUuid);
            Log.d(TAG, "✅ [NOTIFICATION] Enabled for: " + charName + " (" + req.charUuid + ")");
            WritableMap logEvent = Arguments.createMap();
            logEvent.putString("deviceId", deviceId);
            logEvent.putString("action", "Notification Enabled");
            logEvent.putString("characteristic", charName);
            logEvent.putString("uuid", req.charUuid);
            logEvent.putString("status", "success");
            logEvent.putString("platform", "Android");
            sendEvent("ConnectionLog", logEvent);
            onNotificationEnabled(deviceId);
        } else {
            Log.e(TAG, "❌ [GATT QUEUE] Descriptor write FAILED (status=" + status + ") for: " + req.charUuid);
            // Only log "Notification Enable Failed" to user after all retries are exhausted (see handleDescriptorWriteFailure)
            handleDescriptorWriteFailure(deviceId, req);
        }
    }

    private void handleDescriptorWriteFailure(String deviceId, DescriptorWriteRequest request) {
        String key = deviceId + "_" + request.charUuid;
        int attempts = notificationEnableAttempts.getOrDefault(key, 0) + 1;
        notificationEnableAttempts.put(key, attempts);
        if (attempts < MAX_NOTIFICATION_ENABLE_ATTEMPTS) {
            Log.w(TAG, "⚠️ Descriptor write failed for " + request.charUuid + " attempt " + attempts + "/" + MAX_NOTIFICATION_ENABLE_ATTEMPTS + " - retrying via GATT queue");
            final DescriptorWriteRequest req = request;
            mainHandler.postDelayed(() -> {
                enqueueGattOp(deviceId, () -> {
                    BluetoothGatt g = connectedGatts.get(deviceId);
                    if (g == null) {
                        pendingGattComplete.remove(deviceId);
                        onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                        advanceGattQueue(deviceId);
                        return;
                    }
                    java.util.UUID svcUuid = req.characteristic.getService().getUuid();
                    java.util.UUID chUuid = req.characteristic.getUuid();
                    BluetoothGattService s = g.getService(svcUuid);
                    BluetoothGattCharacteristic ch = s != null ? s.getCharacteristic(chUuid) : null;
                    BluetoothGattDescriptor d = ch != null ? ch.getDescriptor(CCC_DESCRIPTOR_UUID) : null;
                    if (d == null) {
                        pendingGattComplete.remove(deviceId);
                        onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                        advanceGattQueue(deviceId);
                        return;
                    }
                    d.setValue(BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE);
                    Log.d(TAG, "[writeDesc RETRY] About to call gatt.writeDescriptor() for: " + req.charUuid);
                    pendingGattComplete.put(deviceId, (status) -> {
                        onDescriptorWriteCompleteWithRequest(deviceId, req, status);
                    });
                    boolean writeResult = g.writeDescriptor(d);
                    Log.d(TAG, "[writeDesc RETRY] writeDescriptor() returned: " + writeResult + " for: " + req.charUuid);
                    if (!writeResult) {
                        pendingGattComplete.remove(deviceId);
                        onDescriptorWriteCompleteWithRequest(deviceId, req, BluetoothGatt.GATT_FAILURE);
                        advanceGattQueue(deviceId);
                    }
                });
            }, NOTIFICATION_ENABLE_RETRY_DELAY_MS);
        } else {
            Log.e(TAG, "❌ Descriptor write failed after retries for: " + request.charUuid + " - marking as complete and proceeding");
            notificationEnableAttempts.remove(key);
            String charName = getCharacteristicName(request.charUuid);
            WritableMap logEvent = Arguments.createMap();
            logEvent.putString("deviceId", deviceId);
            logEvent.putString("action", "Notification Enable Failed");
            logEvent.putString("characteristic", charName);
            logEvent.putString("uuid", request.charUuid);
            logEvent.putInt("gattStatus", 257); // GATT failure / auth error (same as callback when all retries exhausted)
            logEvent.putString("status", "failed");
            logEvent.putString("platform", "Android");
            sendEvent("ConnectionLog", logEvent);
            onNotificationEnabled(deviceId);
        }
    }

    /** Resolve/reject manual descriptor write promises (non-CCCD path). */
    private void handleDescriptorWritePromise(String deviceId, BluetoothGattDescriptor descriptor, int status) {
        String promiseKey = deviceId + "_" + descriptor.getUuid().toString();
        Promise pendingPromise = pendingDescriptorPromises.remove(promiseKey);
        if (pendingPromise != null) {
            if (status == BluetoothGatt.GATT_SUCCESS) {
                pendingPromise.resolve(true);
            } else {
                pendingPromise.reject("WRITE_ERROR", "Descriptor write failed with status: " + status);
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
            // SDD v1.5: Device Status NEVER starts sync. Metadata only → parseDeviceStatusData →
            // proceedWithCommandSequence (Set Time or "ready"). Sync only via startDataSync(deviceId) from JS.
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
            // Only start sync when this read was the one we enqueued for auto-sync (not on every device status read/notification).
            if (pendingAutoSyncAfterDeviceStatusRead.remove(deviceId)) {
                ScheduledFuture<?> timeout = pendingAutoSyncReadTimeout.remove(deviceId);
                if (timeout != null) timeout.cancel(false);
                Log.d(TAG, "✅ [AUTO-SYNC] Device Status read complete - starting sync with actual count: " + deviceRecordCounts.get(deviceId));
                mainHandler.post(() -> doStartAutoSyncAfterDeviceStatusRead(deviceId));
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
            // Offload parsing so BLE callback returns immediately; prevents notification drops when tag sends fast
            if (data != null && data.length > 0) {
                final byte[] dataCopy = Arrays.copyOf(data, data.length);
                final String deviceIdForParse = deviceId;
                dataTransferParseExecutor.execute(() -> {
                    DeviceData deviceDataForParse = deviceDataMap.get(deviceIdForParse);
                    if (deviceDataForParse != null) {
                        parseDataTransferData(deviceDataForParse, dataCopy);
                    }
                });
            }
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
     * - Record count must be ≤ 25000 (SDD v1.5: "record count can be configured up to a maximum of 25,000")
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
        
        // Parse Company ID (bytes 0-1, little-endian); expected value from client config (white-label)
        int companyId = BLEClientConfigHolder.get().getManufacturerId();
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
        if (recordCount > MAX_TOTAL_RECORDS) {
            isCorrupted = true;
            corruptionReason = "Record count too high: " + recordCount + " (SDD max " + MAX_TOTAL_RECORDS + ")";
        }
        if (version > 15) {
            Log.w(TAG, "⚠️ [VALIDATION] Suspicious version number: " + version + " (expected 0-15)");
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
     * 
     * SDD v1.5 – Device Status NEVER starts sync:
     * This path only updates metadata and may call proceedWithCommandSequenceAfterDeviceStatusRead
     * (→ Set Time or "ready"). History sync is started ONLY when the app sends DATA_SYNC_START on
     * the Command characteristic, i.e. via startDataSync(deviceId) from JS. Do not call
     * sendDataSyncStartCommand or startDataSync from this method or any path triggered by it.
     * 
     * @param deviceData Device data object to update
     * @param data Raw characteristic data (8 bytes)
     */
    private void parseDeviceStatusData(DeviceData deviceData, byte[] data) {
        // SDD v1.5: Device Status = metadata only. Never start sync here.
        if (deviceData == null) return;
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
        
        // ✅ NEW FLOW: Manual Device Status read drives history sync decision
        // Device Status notifications are ONLY for metadata updates (battery, record count changes)
        // They do NOT trigger sync - only this manual read after SET_TIME does
        if (Boolean.TRUE.equals(deviceStatusReadAfterSetTimePending.remove(deviceData.deviceId))) {
            int storedRecordCount = deviceRecordCounts.getOrDefault(deviceData.deviceId, 0);
            Log.d(TAG, "✅ [POST SET TIME] Device Status manual read complete with recordCount: " + storedRecordCount);
            
            // Industry flow: Decide based on recordCount from MANUAL read (not notifications)
            if (storedRecordCount > 0) {
                Log.d(TAG, "🔄 [HISTORY SYNC] Starting history sync - " + storedRecordCount + " records available");
                // Set ready state and notify JS to start history sync
                dataSyncState.put(deviceData.deviceId, "ready");
                
                // Emit event with recordCount so JS can start history sync
                WritableMap readyEvent = Arguments.createMap();
                readyEvent.putString("deviceId", deviceData.deviceId);
                readyEvent.putString("type", "ready_for_sync");
                readyEvent.putInt("recordCount", storedRecordCount);
                readyEvent.putBoolean("shouldStartHistorySync", true);
                readyEvent.putString("trigger", "manual_device_status_read_post_set_time");
                sendEvent("DeviceStatusRead", readyEvent);
                
            } else {
                Log.d(TAG, "⏭️ [SKIP HISTORY SYNC] No records available - entering live mode directly");
                // No history - skip directly to live mode
                dataSyncState.put(deviceData.deviceId, "live");
                
                // Emit event to notify JS to skip history sync and enable live mode
                WritableMap liveEvent = Arguments.createMap();
                liveEvent.putString("deviceId", deviceData.deviceId);
                liveEvent.putString("type", "ready_for_live");
                liveEvent.putInt("recordCount", 0);
                liveEvent.putBoolean("shouldStartHistorySync", false);
                liveEvent.putString("trigger", "manual_device_status_read_no_records");
                sendEvent("DeviceStatusRead", liveEvent);
            }
        } else {
            // Initial Device Status read during connection setup - proceed with RTC check/SET_TIME
            proceedWithCommandSequenceAfterDeviceStatusRead(deviceData.deviceId);
        }
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
            // proceedWithCommandSequenceAfterDeviceStatusRead already ran above (Set Time or "ready") - no duplicate (SDD v1.5)
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
        long timestampMs = timestampSeconds * 1000L;
        deviceData.timestamp = timestampMs;
        Long lastSyncTime = lastSyncCompleteTimestamps.get(deviceData.deviceId);
        boolean inGracePeriod = false;
        boolean isPostSyncCheck = pendingPostSyncDeviceStatusRead.remove(deviceData.deviceId);
        if (lastSyncTime != null) {
            long timeSinceSync = System.currentTimeMillis() - lastSyncTime;
            inGracePeriod = timeSinceSync < SYNC_COMPLETE_GRACE_PERIOD_MS;
            if (inGracePeriod) {
                if (recordCount > 0) {
                    Log.d(TAG, "   [GRACE] Device reports " + recordCount + " records during grace period (isPostSyncCheck=" + isPostSyncCheck + ")");
                    if (isPostSyncCheck) {
                        // Records accumulated during sync – auto-trigger a continuation sync
                        Log.d(TAG, "   🔄 [POST-SYNC AUTO-SYNC] " + recordCount + " new records detected after sync – starting auto-sync for complete history");
                        lastSyncCompleteTimestamps.remove(deviceData.deviceId);
                        deviceRecordCounts.put(deviceData.deviceId, recordCount);
                        dataSyncState.put(deviceData.deviceId, "idle");
                        // Send the real record count to JS so it can trigger sync
                        // (fall through to normal event sending below)
                    } else {
                        Log.d(TAG, "   [GRACE] Accepting tag record count " + recordCount + " (more records) – next chunk can start");
                    }
                } else {
                    Log.d(TAG, "   Reason: Firmware needs time to clear flash. Ignoring stale zero until grace ends.");
                    return;
                }
            } else {
                lastSyncCompleteTimestamps.remove(deviceData.deviceId);
            }
        }
        // ✅ FIX: Always store and send the REAL record count from the device.
        // deviceRecordCounts now exclusively holds the real device count (never overwritten by chunk math).
        // During sync, still update deviceRecordCounts — if the device reports a mid-transfer count,
        // that's the real current state. The sync progress is tracked separately in syncRemainingRecords.
        int recordCountToSend = recordCount;
        if ("syncing".equals(syncState) || "stopping".equals(syncState) || "preparing".equals(syncState)) {
            // During active sync: update deviceRecordCounts with real device count, but for UI
            // we show the real count (not the stale pre-sync count). The device may report
            // decreasing counts as records are consumed during sync — that's accurate.
            deviceRecordCounts.put(deviceData.deviceId, recordCount);
            Log.d(TAG, "   [SYNC IN PROGRESS] Device reports " + recordCount + " records (real device count, sync in progress)");
        } else if ("complete".equals(syncState) && !isPostSyncCheck && inGracePeriod && recordCount > 0) {
            // Just completed sync, grace period active: device may report stale count that hasn't
            // cleared yet in firmware. Trust it but log for debugging.
            deviceRecordCounts.put(deviceData.deviceId, recordCount);
            Log.d(TAG, "   [POST-SYNC GRACE] Device reports " + recordCount + " records during grace period (may be stale or new)");
        } else {
            deviceRecordCounts.put(deviceData.deviceId, recordCount);
        }
        // Industry flow: during history sync, JS must not trigger StartSync from device status (SDD v1.5)
        boolean historySyncInProgress = "syncing".equals(syncState);
        WritableMap simpleDeviceData = Arguments.createMap();
        simpleDeviceData.putString("deviceId", deviceData.deviceId);
        simpleDeviceData.putInt("batteryVoltage", batteryVoltage);  
        simpleDeviceData.putInt("recordCount", recordCountToSend);        
        simpleDeviceData.putBoolean("rtcValid", isRTCValid);       
        simpleDeviceData.putDouble("timestamp", timestampMs);
        simpleDeviceData.putBoolean("historySyncInProgress", historySyncInProgress);
        Log.d(TAG, "📤 Sending device status update (SDD v1.4) for: " + deviceData.deviceId +
              " - Battery Voltage: " + batteryVoltage + "mV (percentage from 2A19), Records: " + recordCountToSend + ", RTC Valid: " + isRTCValid + ", historySyncInProgress: " + historySyncInProgress);
        sendEvent("DeviceDataUpdated", simpleDeviceData);
        WritableMap deviceDataUpdateEvent = Arguments.createMap();
        deviceDataUpdateEvent.putString("deviceId", deviceData.deviceId);
        deviceDataUpdateEvent.putString("type", "device_status");
        deviceDataUpdateEvent.putBoolean("historySyncInProgress", historySyncInProgress);
        WritableMap deviceDataMapForEvent = Arguments.createMap();
        deviceDataMapForEvent.putInt("batteryVoltage", batteryVoltage);  
        deviceDataMapForEvent.putInt("recordCount", recordCountToSend);
        deviceDataMapForEvent.putBoolean("rtcValid", isRTCValid);
        deviceDataMapForEvent.putDouble("lastUpdate", timestampMs);
        deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
        sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
        if (recordCountToSend > 0) {
            Log.d(TAG, "📦 " + recordCountToSend + " records available for sync on " + deviceData.deviceId);
        }
        // ✅ FIX: If this is a post-sync check and device has more records, auto-trigger sync for complete history.
        // This catches records that accumulated during the previous sync session.
        if (isPostSyncCheck && recordCount > 0 && !"syncing".equals(syncState)) {
            Log.d(TAG, "🔄 [POST-SYNC AUTO-SYNC] Triggering auto-sync for " + recordCount + " remaining records on " + deviceData.deviceId);
            final String postSyncDeviceId = deviceData.deviceId;
            final int postSyncRecordCount = recordCount;
            mainHandler.postDelayed(() -> {
                String currentState = dataSyncState.getOrDefault(postSyncDeviceId, "idle");
                if ("syncing".equals(currentState) || "stopping".equals(currentState)) {
                    Log.d(TAG, "⏭️ [POST-SYNC AUTO-SYNC] Skipping – sync already in progress for " + postSyncDeviceId);
                    return;
                }
                Log.d(TAG, "📦 [POST-SYNC AUTO-SYNC] Starting sync for " + postSyncRecordCount + " accumulated records on " + postSyncDeviceId);
                // Use "preparing" not "syncing" - sendDataSyncStartCommand sets "syncing" when it actually sends.
                // If we set "syncing" here, isGattBusyOrSyncActive blocks the send and we never start.
                dataSyncState.put(postSyncDeviceId, "preparing");
                dataSyncRequested.put(postSyncDeviceId, true);
                syncCommandSentFlags.put(postSyncDeviceId, false);
                syncRecordsReceived.remove(postSyncDeviceId);
                syncTotalRecords.remove(postSyncDeviceId);
                syncRemainingRecords.remove(postSyncDeviceId);
                syncCurrentFileNumber.remove(postSyncDeviceId);
                syncGrandTotalReceived.remove(postSyncDeviceId);
                syncCompleteProcessedForChunk.remove(postSyncDeviceId);
                chunkGrandTotalAdvancedInRecordPath.remove(postSyncDeviceId);
                lastSyncRecordsEmitGrandTotal.remove(postSyncDeviceId);
                lastSyncRecordsEmitTime.remove(postSyncDeviceId);
                BluetoothGatt postSyncGatt = connectedGatts.get(postSyncDeviceId);
                if (postSyncGatt != null) {
                    historySyncLock.put(postSyncDeviceId, new SyncLockState(postSyncGatt));
                }
                // Match iOS: Defer sync_start to BB08 handler — use device's response as authoritative.
                // Device status during grace period can be stale; BB08 totalRecords is the truth.
                pendingPostSyncSyncStart.put(postSyncDeviceId, postSyncRecordCount);
                boolean startSuccess = sendDataSyncStartCommand(postSyncDeviceId, 0);
                if (startSuccess) {
                    Log.d(TAG, "✅ [POST-SYNC AUTO-SYNC] Started sync for " + postSyncDeviceId + " — sync_start will be sent when BB08 arrives");
                } else {
                    pendingPostSyncSyncStart.remove(postSyncDeviceId);
                    Log.e(TAG, "❌ [POST-SYNC AUTO-SYNC] Failed to start sync for " + postSyncDeviceId);
                    dataSyncState.put(postSyncDeviceId, "idle");
                    dataSyncRequested.put(postSyncDeviceId, false);
                    historySyncLock.remove(postSyncDeviceId);
                }
            }, 300);
        }
        // Do NOT start sync here on every device status read/notification. Sync is started only from:
        // 1) JS startDataSync(deviceId) when JS receives Device Status (maybeTriggerAutoSyncFromDeviceStatus). SDD v1.5: native does not start sync on SECURE_READY.
        // 2) POST-SYNC AUTO-SYNC (above): After sync completes, if device reports more records, auto-sync them for complete history.
    }
    /** SDD v1.5: Device Status path (compact format). Metadata only – never start sync. */
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
        String deviceId = deviceData.deviceId;
        // No hex-level dedupe here: sync must receive and count every notification from the tag.
        // Dedupe is done in live data and history data (UI/store) layers.
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
        // Always accept Data Sync Complete (0x02) — completion signal (match iOS)
        boolean isSyncComplete = (transferType == DATA_TRANSFER_SYNC_COMPLETE);
        // Accept Read Error (0x04) so initial characteristic read / device error doesn't get IGNORED (no spam, handle it)
        boolean isReadError = (transferType == DATA_TRANSFER_READ_ERROR);
        // Accept 0x00 (empty / no data from initial characteristic read) so we don't log IGNORING
        boolean isEmptyOrUnknown = (transferType == 0x00);
        boolean shouldAcceptData = isRequested || isSyncActive || isPushGeneratedRecord || isSyncComplete || isReadError || isEmptyOrUnknown;
        
        // Throttle verbose logging: during sync, record data (0x03) is very frequent — log one-liner instead of full analysis
        boolean isRecordDuringSync = (transferType == DATA_TRANSFER_RECORD) && isSyncActive && shouldAcceptData;
        if (!isRecordDuringSync) {
            Log.d(TAG, "═══════════════════════════════════════════════════════");
            Log.d(TAG, "🔍 RAW DATA TRANSFER ANALYSIS");
            Log.d(TAG, "═══════════════════════════════════════════════════════");
            Log.d(TAG, "Device: " + deviceData.deviceId);
            Log.d(TAG, "Data Sync Requested: " + (isRequested ? "YES ✅" : "NO ❌"));
            Log.d(TAG, "Data Sync State: " + syncState);
            Log.d(TAG, "Data Type: 0x" + String.format("%02X", transferType));
            Log.d(TAG, "Is Push-Generated: " + (isPushGeneratedRecord ? "YES ✅ (v1.5 live record)" : "No (sync record)"));
            Log.d(TAG, "Should Accept Data: " + (shouldAcceptData ? "YES ✅" : "NO ❌ (UNSOLICITED)"));
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
            case 0x00:
                // Empty / no data (e.g. initial characteristic read); accept silently
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
        
        // 🔒 ACTIVATE SYNC LOCK: Prevent GATT disruption during history transfer
        String deviceId = deviceData.deviceId;
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt != null) {
            historySyncLock.put(deviceId, new SyncLockState(gatt));
            Log.d(TAG, "🔒 [SYNC LOCK] Activated for " + deviceId + " - connection protected during history sync");
            Log.d(TAG, "   Lock tied to GATT instance: " + gatt.hashCode());
        } else {
            Log.w(TAG, "⚠️ [SYNC LOCK] Cannot activate - no GATT instance for " + deviceId);
        }
        
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
        int chunkNumber = syncCurrentFileNumber.getOrDefault(deviceId, 1);
        Log.d(TAG, "✅ Data Sync Started - Chunk #" + chunkNumber + ", device will send " + totalRecords + " records");
        WritableMap eventData = Arguments.createMap();
        // Match iOS: For post-sync, BB08 totalRecords is authoritative (device status during grace can be stale).
        Integer postSyncRecordCount = pendingPostSyncSyncStart.remove(deviceId);
        boolean isPostSyncContinuation = (postSyncRecordCount != null);
        int realTotal;
        if (isPostSyncContinuation) {
            realTotal = totalRecords; // Use BB08 — device says what it will send this chunk
            syncTotalRecords.put(deviceId, realTotal);
            Log.d(TAG, "📦 [POST-SYNC BB08] Using device total: " + realTotal + " (authoritative, was " + postSyncRecordCount + " from device status)");
        } else {
            // Normal sync: syncTotalRecords from sendDataSyncStartCommand (deviceRecordCounts)
            realTotal = syncTotalRecords.getOrDefault(deviceId, 0);
            if (realTotal <= 0) {
                realTotal = deviceRecordCounts.getOrDefault(deviceId, totalRecords);
                syncTotalRecords.put(deviceId, realTotal);
            }
        }
        int chunkRecords = totalRecords;
        Log.d(TAG, "📦 [SYNC START] Chunk #" + chunkNumber + ": device will send " + chunkRecords + " records this chunk. Real total: " + realTotal);

        eventData.putString("type", "sync_start");
        eventData.putInt("totalRecords", realTotal);
        eventData.putInt("chunkRecords", chunkRecords);
        eventData.putInt("chunkNumber", chunkNumber);
        eventData.putString("deviceId", deviceData.deviceId);
        if (isPostSyncContinuation) eventData.putBoolean("isPostSyncContinuation", true);
        sendEvent("DataTransfer", eventData);

        // Only initialize remaining/counters on the first chunk.
        // For chunk 2+, remaining was already decremented by parseSyncCompleteData.
        boolean isFirstChunk = (syncCurrentFileNumber.getOrDefault(deviceId, 1) == 1) && 
                               (syncGrandTotalReceived.getOrDefault(deviceId, 0) == 0);
        if (isFirstChunk) {
            syncRemainingRecords.put(deviceId, realTotal);
            syncRecordsReceived.put(deviceId, 0);
            syncCurrentFileNumber.put(deviceId, 1);
            syncGrandTotalReceived.put(deviceId, 0);
        }
    }
    /**
     * Handle SYNC_COMPLETE (0x02). Flow: validate actualCount vs recordsReceived (log if mismatch),
     * state=STOPPING, send STOP(actualCount) immediately, no wait for ACK.
     * remainingRecords -= actualCount (do NOT recompute from totalRecords; safe if new records logged during sync).
     * if remainingRecords > 0 → delay 200ms → START(500); else state=COMPLETE.
     */
    private void parseSyncCompleteData(DeviceData deviceData, ByteBuffer buffer) {
        if (buffer.remaining() < 3) {
            Log.e(TAG, "❌ Data Sync Complete payload too short: " + buffer.remaining() + " bytes");
            return;
        }
        byte length = buffer.get();
        int value = buffer.getShort() & 0xFFFF;
        final String deviceId = deviceData.deviceId;

        if ("complete".equals(dataSyncState.get(deviceId)) && syncTotalRecords.getOrDefault(deviceId, 0) == 0) {
            return;
        }
        dataSyncRetryCount.remove(deviceId);
        syncCommandSentFlags.put(deviceId, false);
        ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
        if (syncTimer != null) {
            syncTimer.cancel(false);
            dataSyncTimers.remove(deviceId);
        }
        if (value >= 0x0001 && value <= 0x01F4) {
            int actualCount = value;
            int currentFileNum = syncCurrentFileNumber.getOrDefault(deviceId, 1);
            Integer lastProcessedChunk = syncCompleteProcessedForChunk.get(deviceId);
            if (lastProcessedChunk != null && lastProcessedChunk == currentFileNum) {
                Log.d(TAG, "⏭️ [DEDUPE 0x02] Skipping duplicate Sync Complete for chunk #" + currentFileNum);
                return;
            }
            syncCompleteProcessedForChunk.put(deviceId, currentFileNum);

            int recordsReceived = syncRecordsReceived.getOrDefault(deviceId, 0);
            if (actualCount != recordsReceived) {
                Log.w(TAG, "⚠️ [SYNC COMPLETE] Mismatch: device reported actualCount=" + actualCount + ", app received recordsReceived=" + recordsReceived);
            }
            dataSyncState.put(deviceId, "stopping");
            int totalRecords = syncTotalRecords.getOrDefault(deviceId, 0);
            int grandTotal = syncGrandTotalReceived.getOrDefault(deviceId, 0);
            byte[] stopPayload = new byte[]{
                (byte)(actualCount & 0xFF),
                (byte)((actualCount >> 8) & 0xFF)
            };
            boolean stopSent = sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
            if (stopSent) {
                Log.d(TAG, "✅ DATA_SYNC_STOP(" + actualCount + ") sent (no ACK wait). Chunk #" + currentFileNum);
            } else {
                Log.e(TAG, "❌ Failed to send DATA_SYNC_STOP(" + actualCount + ")");
            }
            // Flush any buffered sync records so JS receives them before chunk_complete/sync_complete
            flushSyncRecordBuffer(deviceId);
            // After STOP sent: remainingRecords -= actualCount (ref: do NOT recompute from totalRecords)
            int remainingBefore = syncRemainingRecords.containsKey(deviceId) ? syncRemainingRecords.get(deviceId) : totalRecords;
            int remainingAfter = Math.max(0, remainingBefore - actualCount);
            syncRemainingRecords.put(deviceId, remainingAfter);
            // Manual sync (startDataSyncWithRecordCount): single chunk only, do NOT auto-continue
            boolean isSingleChunkOnly = Boolean.TRUE.equals(syncSingleChunkOnly.remove(deviceId));
            boolean hasMoreChunks = !isSingleChunkOnly && remainingAfter > 0;
            if (isSingleChunkOnly) {
                Log.d(TAG, "📦 [SYNC COMPLETE] Manual sync (single chunk) - not auto-continuing. remaining=" + remainingAfter);
            }
            // ✅ FIX: Do NOT overwrite deviceRecordCounts with chunk-based remainingAfter.
            // deviceRecordCounts holds the REAL device count from Device Status characteristic.
            // syncRemainingRecords already tracks chunk progress separately.
            // Old bug: deviceRecordCounts.put(deviceId, remainingAfter) caused UI to show 500/1000/1500
            // instead of real count, and corrupted subsequent sync logic.
            Log.d(TAG, "📦 [SYNC COMPLETE] actualCount=" + actualCount + ", remaining " + remainingBefore + " -> " + remainingAfter + " (grandTotal=" + grandTotal + "), hasMoreChunks=" + hasMoreChunks);

            int totalSyncedForEvent = hasMoreChunks ? actualCount : Math.min(grandTotal, totalRecords);
            WritableMap eventData = Arguments.createMap();
            eventData.putString("type", hasMoreChunks ? "chunk_complete" : "sync_complete");
            eventData.putBoolean("success", true);
            eventData.putInt("recordsTransmitted", totalSyncedForEvent);
            eventData.putInt("chunkNumber", currentFileNum);
            eventData.putInt("grandTotal", hasMoreChunks ? grandTotal : Math.min(grandTotal, totalRecords));
            eventData.putInt("totalExpected", totalRecords);
            eventData.putBoolean("hasMoreChunks", hasMoreChunks);
            eventData.putString("deviceId", deviceId);
            sendEvent("DataTransfer", eventData);

            final boolean hasMoreChunksFinal = hasMoreChunks;
            final int grandTotalFinal = grandTotal;
            final int totalRecordsFinal = totalRecords;

            if (hasMoreChunksFinal) {
                mainHandler.postDelayed(() -> {
                    syncRecordsReceived.put(deviceId, 0);
                    int nextFileNum = currentFileNum + 1;
                    syncCurrentFileNumber.put(deviceId, nextFileNum);
                    Log.d(TAG, "📦 Chunk #" + currentFileNum + " done. Progress " + grandTotalFinal + "/" + totalRecordsFinal + ". Starting chunk #" + nextFileNum + " (START(500)) after 200ms.");
                    syncCommandSentFlags.put(deviceId, false);
                    dataSyncState.put(deviceId, "syncing");
                    boolean startSuccess = sendDataSyncStartCommand(deviceId, 0);
                    if (startSuccess) {
                        Log.d(TAG, "✅ Started chunk #" + nextFileNum + " for " + deviceId);
                    } else {
                        Log.e(TAG, "❌ Failed to start chunk #" + nextFileNum);
                    }
                }, NEXT_CHUNK_START_DELAY_MS);
            } else {
                SyncLockState lockState = historySyncLock.remove(deviceId);
                if (lockState != null) {
                    long duration = System.currentTimeMillis() - lockState.startTime;
                    Log.d(TAG, "🔓 [SYNC LOCK] Released for " + deviceId + " - sync complete after " + (duration / 1000) + "s");
                }
                dataSyncState.put(deviceId, "complete");
                dataSyncRequested.put(deviceId, false);
                syncCommandSentFlags.put(deviceId, false);
                syncTotalRecords.remove(deviceId);
                syncRemainingRecords.remove(deviceId);
                syncRecordsReceived.remove(deviceId);
                syncCurrentFileNumber.remove(deviceId);
                syncGrandTotalReceived.remove(deviceId);
                syncCompleteProcessedForChunk.remove(deviceId);
                chunkGrandTotalAdvancedInRecordPath.remove(deviceId);
                lastSyncRecordsEmitGrandTotal.remove(deviceId);
                lastSyncRecordsEmitTime.remove(deviceId);
                syncRecordBuffer.remove(deviceId);
                lastSyncCompleteTimestamps.put(deviceId, System.currentTimeMillis());
                int totalSynced = Math.min(grandTotalFinal, totalRecordsFinal);
                WritableMap deviceDataUpdateEvent = Arguments.createMap();
                deviceDataUpdateEvent.putString("deviceId", deviceId);
                deviceDataUpdateEvent.putString("type", "sync_complete");
                deviceDataUpdateEvent.putInt("recordCount", totalSynced);
                deviceDataUpdateEvent.putInt("recordsTransmitted", totalSynced);
                deviceDataUpdateEvent.putInt("totalRecords", totalSynced);
                deviceDataUpdateEvent.putInt("grandTotal", grandTotalFinal);
                deviceDataUpdateEvent.putInt("totalExpected", totalRecordsFinal);
                deviceDataUpdateEvent.putBoolean("hasMoreChunks", false);
                WritableMap deviceDataMapForEvent = Arguments.createMap();
                DeviceData deviceDataObj = deviceDataMap.get(deviceId);
                if (deviceDataObj != null) {
                    deviceDataMapForEvent.putInt("recordCount", totalSynced);
                    Integer batteryLevel = deviceDataObj.batteryLevel;
                    if (batteryLevel != null) {
                        deviceDataMapForEvent.putInt("batteryLevel", batteryLevel);
                    }
                } else {
                    deviceDataMapForEvent.putInt("recordCount", totalSynced);
                }
                deviceDataUpdateEvent.putMap("deviceData", deviceDataMapForEvent);
                sendEvent("deviceDataUpdate", deviceDataUpdateEvent);
                Log.d(TAG, "✅ [SYNC] All chunks complete. Total synced: " + totalSynced + " records.");

                // ✅ Manual sync: skip POST-SYNC CHECK – user requested N records only; don't re-trigger history sync.
                // Full/auto sync: after sync completes, read device status to check if new records accumulated.
                if (!isSingleChunkOnly) {
                    mainHandler.postDelayed(() -> {
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (gatt != null) {
                            Log.d(TAG, "🔄 [POST-SYNC CHECK] Reading device status to check for records accumulated during sync...");
                            BluetoothGattCharacteristic deviceStatusChar = findCharacteristic(gatt, DEVICE_STATUS_CHAR_UUID);
                            if (deviceStatusChar != null) {
                                pendingPostSyncDeviceStatusRead.add(deviceId);
                                enqueueReadCharacteristicOp(deviceId, gatt, deviceStatusChar, "PostSyncRecordCheck");
                            } else {
                                Log.w(TAG, "⚠️ [POST-SYNC CHECK] Device Status characteristic not found for " + deviceId);
                            }
                        } else {
                            Log.w(TAG, "⚠️ [POST-SYNC CHECK] GATT not connected for " + deviceId + " - skipping post-sync check");
                        }
                    }, 500);
                } else {
                    Log.d(TAG, "⏭️ [MANUAL SYNC] Skipping post-sync check – manual sync is independent of history sync flow");
                }
            }
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
    /**
     * If we sent DATA_SYNC_START but are about to disconnect or timeout without having sent
     * DATA_SYNC_STOP, send STOP now so the device can enable live notifications.
     * Device requires STOP after START to resume live mode.
     * @return true if STOP was queued (caller should delay disconnect so write can complete)
     */
    private boolean ensureDataSyncStopSent(String deviceId) {
        String state = dataSyncState.get(deviceId);
        if (!"syncing".equals(state) && !"stopping".equals(state)) {
            return false;
        }
        flushSyncRecordBuffer(deviceId);
        int count = syncRecordsReceived.getOrDefault(deviceId, 0);
        byte[] stopPayload = new byte[]{
            (byte)(count & 0xFF),
            (byte)((count >> 8) & 0xFF)
        };
        Log.d(TAG, "📤 [SYNC GUARANTEE] Sending DATA_SYNC_STOP(" + count + ") so device can enable live mode (state=" + state + ")");
        sendSystemCommand(deviceId, CMD_DATA_SYNC_STOP, stopPayload);
        return true;
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
                // SDD v1.5: Length can be 6-18. 7-byte (declared 8) is common for live records without flags.
                if (remainingBytes == 7 && declaredLength == 8) {
                    String s = dataSyncState.getOrDefault(deviceData.deviceId, "idle");
                    boolean duringSync = "syncing".equals(s) || "time_syncing".equals(s) || "stopping".equals(s);
                    if (!duringSync) Log.d(TAG, "Record Data: 7 bytes (declared 8) - parsing as 7-byte record (no flags byte)");
                } else {
                    Log.w(TAG, "⚠️ Record Data payload shorter than declared: " + remainingBytes + " bytes (declared: " + declaredLength + ")");
                }
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
            byte[] recordBytes = new byte[8];
            buffer.get(recordBytes);
            bytesRead += 8;
            String recordHex = bytesToHex(recordBytes);
            ByteBuffer rb = java.nio.ByteBuffer.wrap(recordBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            int timestamp = rb.getInt();
            int steps = rb.getShort() & 0xFFFF;
            int temperature = rb.get() & 0xFF;
            int flags = rb.get() & 0xFF;
            
            long currentTimeSeconds = System.currentTimeMillis() / 1000;
            long oneYearAgo = currentTimeSeconds - (365L * 24 * 3600);
            long oneDayAhead = currentTimeSeconds + (24L * 3600);
            boolean isPastOneYear = timestamp < oneYearAgo;
            boolean isFutureOneDayOrMore = timestamp > oneDayAhead;
            if (isPastOneYear || isFutureOneDayOrMore) {
                String reason = isPastOneYear ? "past_1_year" : "future_1_day_or_more";
                Log.w(TAG, "⚠️ [INVALID TIMESTAMP] Record " + reason + " - timestamp=" + timestamp + ", date=" +
                    new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date(timestamp * 1000L)) +
                    " | hex=" + recordHex);
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
            record.putString("rawData", recordHex);
            records.add(record);
        }
        
        
        // FIX: Handle 7-byte records (timestamp + steps + temp, missing flags byte)
        // SDD v1.5 allows length 6-18. Many devices send 7-byte records without flags.
        int remainingAfterFullRecords = bytesToRead - bytesRead;
        int bufferRemaining = buffer.remaining();
        
        if (remainingAfterFullRecords == 7 && bufferRemaining >= 7) {
            // Parse 7-byte record (valid complete record per SDD v1.5, just missing optional flags byte)
            byte[] recordBytes = new byte[7];
            buffer.get(recordBytes);
            bytesRead += 7;
            String recordHex = bytesToHex(recordBytes);
            ByteBuffer rb = java.nio.ByteBuffer.wrap(recordBytes).order(java.nio.ByteOrder.LITTLE_ENDIAN);
            int timestamp = rb.getInt();
            int steps = rb.getShort() & 0xFFFF;
            int temperature = rb.get() & 0xFF;
            
            long currentTimeSeconds = System.currentTimeMillis() / 1000;
            long oneYearAgo = currentTimeSeconds - (365L * 24 * 3600);
            long oneDayAhead = currentTimeSeconds + (24L * 3600);
            boolean isPastOneYear = timestamp < oneYearAgo;
            boolean isFutureOneDayOrMore = timestamp > oneDayAhead;
            if (isPastOneYear || isFutureOneDayOrMore) {
                String reason = isPastOneYear ? "past_1_year" : "future_1_day_or_more";
                Log.w(TAG, "⚠️ [INVALID TIMESTAMP] Record " + reason + " - timestamp=" + timestamp + ", date=" +
                    new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss").format(new java.util.Date(timestamp * 1000L)) +
                    " | hex=" + recordHex);
            }
            
            java.util.Date date = new java.util.Date(timestamp * 1000L);
            java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss");
            String dateString = formatter.format(date);
            WritableMap record = Arguments.createMap();
            record.putInt("timestamp", timestamp);
            record.putString("timestampDate", dateString);
            record.putInt("steps", steps);
            record.putInt("temperature", temperature);
            record.putInt("flags", 0);  // Default flags to 0 for 7-byte records
            record.putString("rawData", recordHex);
            // DO NOT mark as isPartialRecord - 7-byte records are valid per SDD v1.5
            records.add(record);
            // Skip verbose per-record log during sync (thousands of records)
            String state = dataSyncState.getOrDefault(deviceData.deviceId, "idle");
            boolean syncActive = "syncing".equals(state) || "time_syncing".equals(state) || "stopping".equals(state);
            if (!syncActive) {
                Log.d(TAG, "✅ Parsed 7-byte record (no flags byte): " + dateString + ", steps=" + steps + ", temp=" + temperature);
            }
        } else if (remainingAfterFullRecords >= 6 && bufferRemaining >= 6 && remainingAfterFullRecords < 7) {
            // 📊 TRACK METRICS: Increment drop counter for truly partial records (< 7 bytes)
            String deviceId = deviceData.deviceId;
            int currentCount = partialRecordsDropped.getOrDefault(deviceId, 0) + 1;
            partialRecordsDropped.put(deviceId, currentCount);
            
            // ⏱️ RATE-LIMITED LOGGING: Log once per 5 seconds to prevent spam
            long now = System.currentTimeMillis();
            Long lastLogTime = lastPartialDropLogTime.get(deviceId);
            if (lastLogTime == null || (now - lastLogTime) > PARTIAL_DROP_LOG_INTERVAL_MS) {
                Log.w(TAG, "⚠️ [PARTIAL RECORD] Detected incomplete record with " + bufferRemaining + " bytes - DROPPING");
                Log.w(TAG, "   Reason: Connection may have been interrupted mid-packet");
                Log.w(TAG, "   Total dropped this session: " + currentCount);
                lastPartialDropLogTime.put(deviceId, now);
            }
            
            // Skip the partial bytes without parsing
            buffer.position(buffer.position() + remainingAfterFullRecords);
            bytesRead += remainingAfterFullRecords;
            
            // DO NOT add to records array - partial records are dropped
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
        
        
        // Sync record: Process as part of sync operation. Flow: only recordsReceived++, grandTotal++ per record.
        // ✅ Suppress sync_records progress after sync is complete/stopping (prevents late progress due to BLE callback ordering)
        String syncState = dataSyncState.getOrDefault(deviceId, "idle");
        boolean syncAlreadyEnded = "complete".equals(syncState) || "stopping".equals(syncState);
        if (syncAlreadyEnded) {
            Log.d(TAG, "⏭️ [SYNC] Ignoring sync_records emit – sync already " + syncState + " (late notification)");
            // Still send DataTransfer(record) so records are not lost; only skip progress update
            WritableArray recordsArray = Arguments.createArray();
            for (WritableMap record : records) {
                recordsArray.pushMap(record);
            }
            WritableMap eventData = Arguments.createMap();
            eventData.putString("type", "record");
            eventData.putArray("records", recordsArray);
            eventData.putInt("recordCount", records.size());
            eventData.putString("deviceId", deviceId);
            eventData.putBoolean("isPushGenerated", false);
            eventData.putBoolean("isLiveData", false);
            sendEvent("DataTransfer", eventData);
            return;
        }

        // ⏱️ UPDATE TIMEOUT TRACKING: Record when we last received data
        lastRecordReceivedTime.put(deviceId, System.currentTimeMillis());
        startSyncTimeoutChecker(deviceId);
        
        int currentReceived = syncRecordsReceived.getOrDefault(deviceId, 0);
        int newReceived = currentReceived + records.size();
        int currentGrandTotal = syncGrandTotalReceived.getOrDefault(deviceId, 0);
        int newGrandTotal = currentGrandTotal + records.size();
        syncRecordsReceived.put(deviceId, newReceived);
        syncGrandTotalReceived.put(deviceId, newGrandTotal);
        // When sync was force-completed or cleaned up, syncTotalRecords may be 0; use device record count for UI
        int totalExpected = syncTotalRecords.getOrDefault(deviceId, 0);
        if (totalExpected <= 0) {
            totalExpected = deviceRecordCounts.getOrDefault(deviceId, 0);
        }
        // 🚀 BATCH: Add to buffer and send to JS only when buffer reaches BATCH_SIZE (reduces 17k events to ~85)
        List<WritableMap> buf = syncRecordBuffer.get(deviceId);
        if (buf == null) {
            buf = new ArrayList<>();
            syncRecordBuffer.put(deviceId, buf);
        }
        buf.addAll(records);
        if (buf.size() >= SYNC_RECORD_BATCH_SIZE) {
            flushSyncRecordBuffer(deviceId);
        }
        // Log progress only periodically to avoid log spam (every 500 records)
        if (newGrandTotal % 500 == 0 || newGrandTotal == totalExpected) {
            Log.d(TAG, "📊 Chunk progress: " + newReceived + " records this chunk. Grand total: " + newGrandTotal + "/" + totalExpected);
        }
        // Re-check state immediately before emit to avoid race: 0x02 may have been processed on another callback
        String stateBeforeEmit = dataSyncState.getOrDefault(deviceId, "idle");
        if ("complete".equals(stateBeforeEmit) || "stopping".equals(stateBeforeEmit)) {
            Log.d(TAG, "⏭️ [SYNC] Skipping sync_records emit – state changed to " + stateBeforeEmit + " before send");
            return;
        }
        // Throttle sync_records so bridge queue doesn't grow (500 events delay sync_complete by ~9s). Emit at most every SYNC_RECORDS_THROTTLE_RECORDS or SYNC_RECORDS_THROTTLE_MS, or when we hit totalExpected
        long now = System.currentTimeMillis();
        int lastEmitTotal = lastSyncRecordsEmitGrandTotal.getOrDefault(deviceId, 0);
        long lastEmitTime = lastSyncRecordsEmitTime.getOrDefault(deviceId, 0L);
        boolean throttlePass = (newGrandTotal - lastEmitTotal >= SYNC_RECORDS_THROTTLE_RECORDS)
            || (now - lastEmitTime >= SYNC_RECORDS_THROTTLE_MS)
            || (totalExpected > 0 && newGrandTotal >= totalExpected);
        if (!throttlePass) {
            return;
        }
        lastSyncRecordsEmitGrandTotal.put(deviceId, newGrandTotal);
        lastSyncRecordsEmitTime.put(deviceId, now);
        WritableMap syncUpdateEvent = Arguments.createMap();
        syncUpdateEvent.putString("deviceId", deviceData.deviceId);
        syncUpdateEvent.putString("type", "sync_records");
        syncUpdateEvent.putInt("recordsReceived", records.size());
        syncUpdateEvent.putInt("totalReceived", newGrandTotal);
        syncUpdateEvent.putInt("totalExpected", totalExpected);
        syncUpdateEvent.putInt("recordCount", records.size());
        sendEvent("deviceDataUpdate", syncUpdateEvent);
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
    
    /**
     * Flush buffered sync records for a device to JS (single DataTransfer event).
     * Reduces bridge crossings from 17k to ~85 during large syncs.
     */
    private void flushSyncRecordBuffer(String deviceId) {
        List<WritableMap> buf = syncRecordBuffer.get(deviceId);
        if (buf == null || buf.isEmpty()) return;
        WritableArray recordsArray = Arguments.createArray();
        for (WritableMap record : buf) {
            recordsArray.pushMap(record);
        }
        int count = buf.size();
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "record");
        eventData.putArray("records", recordsArray);
        eventData.putInt("recordCount", count);
        eventData.putString("deviceId", deviceId);
        eventData.putBoolean("isPushGenerated", false);
        eventData.putBoolean("isLiveData", false);
        sendEvent("DataTransfer", eventData);
        buf.clear();
    }
    
    // ============================================================================
    // ⏱️ SYNC TIMEOUT DETECTION - Auto-complete when device stops sending
    // ============================================================================
    
    /**
     * Start/restart the sync timeout checker for a device.
     * If no records are received for SYNC_TIMEOUT_MS (30s), assume sync is complete.
     */
    private void startSyncTimeoutChecker(String deviceId) {
        // Cancel existing checker if any
        ScheduledFuture<?> existingChecker = syncTimeoutCheckers.get(deviceId);
        if (existingChecker != null) {
            existingChecker.cancel(false);
        }
        
        // Start new checker that runs every 5 seconds
        ScheduledFuture<?> checker = executorService.scheduleAtFixedRate(() -> {
            checkSyncTimeout(deviceId);
        }, 5, 5, TimeUnit.SECONDS);
        
        syncTimeoutCheckers.put(deviceId, checker);
    }
    
    /**
     * Check if sync has timed out (no records for 30 seconds).
     * If timed out, force sync completion.
     */
    private void checkSyncTimeout(String deviceId) {
        String syncState = dataSyncState.get(deviceId);
        if (!"syncing".equals(syncState)) {
            // Not syncing, cancel checker
            ScheduledFuture<?> checker = syncTimeoutCheckers.remove(deviceId);
            if (checker != null) {
                checker.cancel(false);
            }
            return;
        }
        
        Long lastTime = lastRecordReceivedTime.get(deviceId);
        if (lastTime == null) return;
        
        long timeSinceLastRecord = System.currentTimeMillis() - lastTime;
        if (timeSinceLastRecord > SYNC_TIMEOUT_MS) {
            Log.w(TAG, "⏱️ [SYNC TIMEOUT] No records for " + (timeSinceLastRecord / 1000) + "s - completing sync for " + deviceId);
            
            // Cancel checker
            ScheduledFuture<?> checker = syncTimeoutCheckers.remove(deviceId);
            if (checker != null) {
                checker.cancel(false);
            }
            
            // Force sync completion
            forceSyncComplete(deviceId);
        }
    }
    
    /**
     * Force sync completion when device stops sending records.
     * This handles the case where device doesn't send DATA_SYNC_COMPLETE (0x02).
     */
    private void forceSyncComplete(String deviceId) {
        flushSyncRecordBuffer(deviceId);
        int recordsReceived = syncRecordsReceived.getOrDefault(deviceId, 0);
        int grandTotal = syncGrandTotalReceived.getOrDefault(deviceId, 0) + recordsReceived;
        int totalRecords = syncTotalRecords.getOrDefault(deviceId, 0);
        
        Log.d(TAG, "🔄 [FORCE COMPLETE] Forcing sync completion for " + deviceId);
        Log.d(TAG, "   Records received: " + recordsReceived + " in current chunk");
        Log.d(TAG, "   Grand total: " + grandTotal + " / " + totalRecords);
        
        // Release sync lock
        SyncLockState lockState = historySyncLock.remove(deviceId);
        if (lockState != null) {
            long duration = System.currentTimeMillis() - lockState.startTime;
            Log.d(TAG, "🔓 [SYNC LOCK] Released on timeout for " + deviceId + " (was active for " + (duration / 1000) + "s)");
        }
        
        // Update state
        dataSyncState.put(deviceId, "complete");
        dataSyncRequested.put(deviceId, false);
        dataSyncRetryCount.remove(deviceId);
        syncCommandSentFlags.put(deviceId, false);
        
        // Clean up
        lastRecordReceivedTime.remove(deviceId);
        syncRecordsReceived.remove(deviceId);
        syncTotalRecords.remove(deviceId);
        syncRemainingRecords.remove(deviceId);
        syncCurrentFileNumber.remove(deviceId);
        syncGrandTotalReceived.remove(deviceId);
        syncCompleteProcessedForChunk.remove(deviceId);
        chunkGrandTotalAdvancedInRecordPath.remove(deviceId);
        syncSingleChunkOnly.remove(deviceId);
        pendingSyncRecordCount.remove(deviceId);
        lastSyncRecordsEmitGrandTotal.remove(deviceId);
        lastSyncRecordsEmitTime.remove(deviceId);
        syncRecordBuffer.remove(deviceId);

        // Do NOT clear deviceRecordCounts — keep last known count so retry sync and late-arriving records
        // have a valid totalExpected (avoids "X/0" progress after force-complete).
        
        // Send sync complete event to JS
        WritableMap eventData = Arguments.createMap();
        eventData.putString("type", "sync_complete");
        eventData.putBoolean("success", true);
        eventData.putInt("recordsTransmitted", grandTotal);
        eventData.putString("deviceId", deviceId);
        eventData.putBoolean("forcedByTimeout", true);
        sendEvent("DataTransfer", eventData);
        
        Log.d(TAG, "✅ [FORCE COMPLETE] Sync completed via timeout - " + grandTotal + " records total");
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
        // Industry-correct: Do NOT advance system command queue here. Queue advances only in onCharacteristicWrite (GATT write callback).
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
                        enqueueSetSystemTimeCommand(deviceData.deviceId, currentRetry + 1);
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
                    
                    // Industry fix (Issue 1): After SET_TIME success, explicitly read Device Status once
                    // instead of waiting for async notifications. Use that result to update recordCount
                    // and set ready immediately — removes ~55s delay and matches Fitbit/Garmin/Whoop behavior.
                    triggerDeviceStatusReadAfterSetTime(deviceData.deviceId);
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
            
            // DATA_SYNC_STOP: Device confirms stop. If we previously logged "Write failed" for STOP, that was a
            // false positive (advanceGattQueue completed the op before onCharacteristicWrite); device got the command.
            case CMD_DATA_SYNC_STOP:
                commandMessage = "Data sync stopped";
                if (responseStatus == 0x00) {
                    Log.d(TAG, "✅ DATA_SYNC_STOP acknowledged by device (write succeeded; ignore any earlier 'Write failed' for STOP)");
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
                    failGattQueueOnDisconnect(deviceIdToUnpair);
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
                            failGattQueueOnDisconnect(deviceIdToCleanup);
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
                    failGattQueueOnDisconnect(deviceIdToRepair);
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
        // ✅ Get connection state from BLEConnectionManager (single source of truth)
        map.putString("connectionState", getConnectionState(deviceData.deviceId));
        
        // Build services array (snapshot to avoid ConcurrentModificationException)
        WritableArray servicesArray = Arguments.createArray();
        for (String serviceUuid : new java.util.ArrayList<>(deviceData.services.keySet())) {
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
        
        // ✅ Get connection state from BLEConnectionManager (single source of truth)
        String connectionState = getConnectionState(deviceData.deviceId);
        map.putString("connectionState", connectionState);
        
        // Health data (available for both connected and disconnected states)
        boolean isConnected = "connected".equals(connectionState);
        
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
        // Snapshot to avoid ConcurrentModificationException (cleanup may clear services from BLE callback thread)
        for (String serviceUuid : new java.util.ArrayList<>(deviceData.services.keySet())) {
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
            // ✅ Get connection state from BLEConnectionManager (single source of truth)
            if (!"connected".equals(getConnectionState(deviceId))) {
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
        // Android 14+ (API 34+): FGS type connectedDevice requires BLUETOOTH_CONNECT (and optionally BLUETOOTH_SCAN) at runtime
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            boolean hasConnect = ContextCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED;
            if (!hasConnect) {
                Log.w(TAG, "⚠️ Cannot start BLE foreground service: BLUETOOTH_CONNECT permission not granted (required on Android 14+)");
                return;
            }
        }

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
        // Manual connection only; auto-connect removed.
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
        // Manual connection only; background/auto-connect removed.
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
    private ScanCallback scanCallback = new ScanCallback() {
        @Override
        public void onScanResult(int callbackType, ScanResult result) {
            BluetoothDevice device = result.getDevice();
            String deviceId = device.getAddress();
            String deviceName = device.getName() != null ? device.getName() : "Unknown Device";
            int rssi = result.getRssi();
            Log.d("SampleBridgeAndroid", "🔍 SCAN CALLBACK: Discovered device: " + deviceName + " (" + deviceId + ") RSSI: " + rssi);
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
            String smartTagServiceUuid = BLEClientConfigHolder.get().getSmartTagServiceUuid();
            int manufacturerId = BLEClientConfigHolder.get().getManufacturerId();
            boolean isSmartTag = false;
            boolean hasCorrectService = false;
            boolean hasAcceptedName = matchesAcceptedDeviceName(deviceName);
            if (result.getScanRecord() != null) {
                List<ParcelUuid> serviceUuids = result.getScanRecord().getServiceUuids();
                if (serviceUuids != null) {
                    for (ParcelUuid uuid : serviceUuids) {
                        if (smartTagServiceUuid.equals(uuid.toString())) {
                            hasCorrectService = true;
                            isSmartTag = true;
                            break;
                        }
                    }
                }
            }
            if (hasAcceptedName) {
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
                byte[] mfgData = result.getScanRecord().getManufacturerSpecificData(manufacturerId);
                if (mfgData == null && result.getScanRecord().getBytes() != null) {
                    mfgData = parseManufacturerDataFromRawBytes(result.getScanRecord().getBytes(), manufacturerId);
                }
                // Fix: Android's getManufacturerSpecificData() returns data WITHOUT company ID,
                // but parseManufacturerData() expects it WITH company ID (like iOS).
                // Validate first (isValidSmartHealthTagData expects data without company ID),
                // then prepend company ID before parsing.
                if (mfgData != null && mfgData.length >= 11 && isValidSmartHealthTagData(mfgData)) {
                    // Check if company ID is already present (first 2 bytes should be 0x34 0x12 in little-endian)
                    boolean hasCompanyId = mfgData.length >= 2 &&
                                         ((mfgData[1] & 0xFF) << 8 | (mfgData[0] & 0xFF)) == manufacturerId;
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
                    
                    // ✅ FIX: Store RTC validity from advertisement packet
                    // This allows us to skip unnecessary time setting if RTC is already valid
                    if (manufacturerInfo.hasKey("timeSet")) {
                        boolean timeSetFromAdv = manufacturerInfo.getBoolean("timeSet");
                        deviceRTCValidity.put(deviceId, timeSetFromAdv);
                        Log.d(TAG, "   📡 [ADV DATA] RTC validity from advertisement: " + (timeSetFromAdv ? "VALID" : "INVALID") + " for " + deviceId);
                    }
                    
                    // ✅ Use helper to get connection state from BLEConnectionManager
                    if (!"connected".equals(getConnectionState(deviceId))) {
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
                acceptReason = "Valid manufacturer ID (0x" + Integer.toHexString(manufacturerId) + ") with proper data structure";
            } else if (hasCorrectService && hasAcceptedName) {
                shouldAcceptDevice = true;
                acceptReason = "Correct service UUID AND accepted device name";
            } else if (hasAcceptedName && (result.getScanRecord() == null || result.getScanRecord().getServiceUuids() == null || result.getScanRecord().getServiceUuids().isEmpty())) {
                shouldAcceptDevice = true;
                acceptReason = "Accepted device name (no service UUIDs advertised)";
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
            boolean isTargetDevice = bondedDeviceIds.contains(deviceId);
            if (!isTargetDevice) {            }
            if (isTargetDevice) {
                Log.d("SampleBridgeAndroid", "🎯 TARGET DEVICE FOUND (bonded): " + deviceName + " (" + deviceId + ")");
                if (!shouldAllowConnection(deviceId, false)) {
                    Log.d("SampleBridgeAndroid", "🚫 Connection blocked for device: " + deviceName + " - device is forgotten or manually disconnected");
                    return;
                }
                if (isDeviceInMcuMgrDfu(deviceId)) {
                    Log.d("SampleBridgeAndroid", "⏭️ Skipping connect - device in McuMgr DFU: " + deviceId);
                    return;
                }
                if (connectedGatts.containsKey(deviceId) || connectingDevices.contains(deviceId)) {
                    Log.d("SampleBridgeAndroid", "⏭️ Bonded device already connected/connecting: " + deviceId);
                    return;
                }
                BluetoothDevice bondDevice = bondedDevices.get(deviceId);
                if (bondDevice == null && bluetoothAdapter != null) {
                    try {
                        bondDevice = bluetoothAdapter.getRemoteDevice(deviceId);
                        bondedDevices.put(deviceId, bondDevice);
                    } catch (Exception e) {
                        Log.w(TAG, "⚠️ getRemoteDevice failed for scan target " + deviceId + ": " + e.getMessage());
                    }
                }
                if (bondDevice != null) {
                    if (isScanning.get()) stopScanning();
                    final BluetoothDevice dev = bondDevice;
                    mainHandler.post(() -> restoreConnectionToDevice(deviceId, dev));
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

    /**
     * Returns current BLE client config for white-label (brand name, device patterns, service UUID, manufacturer ID).
     * JS layer uses this for UI strings and device acceptance; no hardcoded brand in core.
     */
    @Override
    @ReactMethod
    public void getBLEClientConfig(Promise promise) {
        try {
            com.reactnativeboilerplate.config.BLEClientConfig c = BLEClientConfigHolder.get();
            WritableMap map = Arguments.createMap();
            map.putString("brandName", c.getBrandName());
            map.putArray("acceptedDeviceNamePatterns", Arguments.fromList(new ArrayList<>(c.getAcceptedDeviceNamePatterns())));
            map.putString("smartTagServiceUuid", c.getSmartTagServiceUuid());
            map.putInt("manufacturerId", c.getManufacturerId());
            if (c.getDefaultPasskey() != null) {
                map.putString("defaultPasskey", c.getDefaultPasskey());
            }
            promise.resolve(map);
        } catch (Exception e) {
            Log.e(TAG, "❌ getBLEClientConfig error: " + e.getMessage());
            promise.reject("GET_BLE_CONFIG_ERROR", e.getMessage());
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
                // Notify JS of ServicesDiscovered for restored devices so UI can sync
                final List<WritableMap> servicesDiscoveredEvents = new ArrayList<>();
                synchronized (gattLock) {
                    for (String deviceId : connectedGatts.keySet()) {
                        DeviceData deviceData = deviceDataMap.get(deviceId);
                        if (deviceData != null && !deviceData.services.isEmpty()) {
                            servicesDiscoveredEvents.add(createServiceInfoMap(deviceData));
                        }
                    }
                }
                mainHandler.post(() -> {
                    for (WritableMap serviceInfo : servicesDiscoveredEvents) {
                        String deviceId = serviceInfo.getString("deviceId");
                        sendEvent("ServicesDiscovered", serviceInfo);
                        Log.d(TAG, "📢 [SYSTEM_REFRESH] Sent ServicesDiscovered for " + deviceId + " (JS sync)");
                    }
                });
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
            int mfgIdFilter = BLEClientConfigHolder.get().getManufacturerId();
            String serviceUuidFilter = BLEClientConfigHolder.get().getSmartTagServiceUuid();
            ScanFilter.Builder mfgFilter = new ScanFilter.Builder();
            mfgFilter.setManufacturerData(mfgIdFilter, null);
            filters.add(mfgFilter.build());
            ScanFilter.Builder serviceFilter = new ScanFilter.Builder();
            serviceFilter.setServiceUuid(ParcelUuid.fromString(serviceUuidFilter));
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
            // Manual connect: if manager has CONNECTING (e.g. from auto-connect), treat as already connecting
            if (connectionManager != null && connectionManager.isConnectionInProgress(deviceId)) {
                Log.d(TAG, "✅ Connection already in progress (manager) for " + deviceId + " - resolving as already_connecting");
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
     * Bond States (per ET-DSSID-SSD & nRF: firmware expects app to initiate pairing):
     * - BOND_NONE: Call createBond() first to show passkey dialog; wait for BOND_BONDED, then connect
     * - BOND_BONDING: Pairing in progress - wait for completion
     * - BOND_BONDED: Already paired - proceed with GATT connection
     * 
     * Pairing Flow (firmware/doc: "app initiates BLE Secure Connection using Passkey"):
     * 1. BOND_NONE → createBond() to trigger passkey dialog (default 123456)
     * 2. User enters passkey; BOND_BONDED broadcast
     * 3. Wait 800ms, then connectGatt()
     * 4. After connect, wait 1600ms (nRF), then requestMtu → discoverServices
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
            
            // Firmware expects app to initiate pairing (ET-DSSID-SSD: "app initiates BLE Secure Connection using Passkey")
            // createBond() triggers the passkey popup; without it, passkey dialog never appears
            if (bondState == BluetoothDevice.BOND_NONE) {
                Log.d(TAG, "   💡 Device not bonded - initiating createBond() to show passkey dialog (firmware expects app to initiate)");
                if (devicesWaitingForBonding.containsKey(deviceId)) {
                    return;
                }
                devicesWaitingForBonding.put(deviceId, device);
                String passkey = getPasskeyForDevice(deviceId);
                Log.d(TAG, "   💡 User should enter passkey when dialog appears: " + passkey);
                try {
                    if (ActivityCompat.checkSelfPermission(getReactApplicationContext(), Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
                        boolean bondResult = false;
                        try {
                            java.lang.reflect.Method createBondMethod = device.getClass().getMethod("createBond", int.class);
                            int TRANSPORT_LE = 2;
                            Object result = createBondMethod.invoke(device, TRANSPORT_LE);
                            bondResult = (Boolean) result;
                            Log.d(TAG, "   ✅ createBond(TRANSPORT_LE) - Passkey Entry pairing");
                        } catch (Exception reflectionEx) {
                            Log.w(TAG, "⚠️ [PRE-CONNECTION] Reflection failed, using createBond(): " + reflectionEx.getMessage());
                            bondResult = device.createBond();
                        }
                        if (bondResult) {
                            Log.d(TAG, "   ✅ createBond() returned true - passkey dialog should appear");
                            return;
                        } else {
                            Log.e(TAG, "❌ [PRE-CONNECTION] createBond() returned false");
                            devicesWaitingForBonding.remove(deviceId);
                        }
                    } else {
                        Log.e(TAG, "❌ [PRE-CONNECTION] BLUETOOTH_CONNECT permission not granted");
                        devicesWaitingForBonding.remove(deviceId);
                    }
                } catch (Exception e) {
                    Log.e(TAG, "❌ [PRE-CONNECTION] Error createBond(): " + e.getMessage(), e);
                    devicesWaitingForBonding.remove(deviceId);
                }
            } else if (bondState == BluetoothDevice.BOND_BONDING) {
                Log.d(TAG, "   ⏳ Device is currently bonding - waiting for completion");
                if (!devicesWaitingForBonding.containsKey(deviceId)) {
                    devicesWaitingForBonding.put(deviceId, device);
                }
                return; 
            }
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
            // CREATE GATT CONNECTION WITH CALLBACKS (via ConnectionManager approval gate)
            // ============================================================================
            // autoConnect=false: Connect immediately (don't wait for advertisement)
            // Provides comprehensive callbacks for connection lifecycle management
            
            BluetoothGattCallback gattCallback = new BluetoothGattCallback() {
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
                                connectionManager.onConnectionAttemptFailed(deviceId);
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
                                    // ✅ connectionState managed by BLEConnectionManager
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                return;
                            }
                            // ----------------------------------------------------------------
                            // STATE_CONNECTED: Successfully connected to device
                            // ----------------------------------------------------------------
                            if (newState == BluetoothProfile.STATE_CONNECTED) {
                                connectionManager.onConnectionSucceeded(deviceId);
                                // Log successful connection
                                Log.d(TAG, "✅ [CONNECTION] Device connected: " + deviceId);
                                
                                // ✅ FIX: Prevent duplicate ConnectionLog "Connected" events
                                // onConnectionStateChange can fire multiple times from different callback paths
                                Long lastConnectedLogTime = hasEmittedConnectedLog.get(deviceId);
                                long currentTime = System.currentTimeMillis();
                                boolean shouldEmitConnectedLog = lastConnectedLogTime == null || 
                                    (currentTime - lastConnectedLogTime) > CONNECTED_LOG_DEDUPE_WINDOW_MS;
                                
                                if (shouldEmitConnectedLog) {
                                    hasEmittedConnectedLog.put(deviceId, currentTime);
                                    
                                    WritableMap connectionLogEvent = Arguments.createMap();
                                    connectionLogEvent.putString("deviceId", deviceId);
                                    connectionLogEvent.putString("action", "Connected");
                                    connectionLogEvent.putInt("status", status);
                                    connectionLogEvent.putString("platform", "Android");
                                    connectionLogEvent.putString("note", "BLE connection established - starting MTU negotiation");
                                    sendEvent("ConnectionLog", connectionLogEvent);
                                } else {
                                    Log.d(TAG, "⏭️ [CONNECTION] Skipping duplicate ConnectionLog 'Connected' event for " + deviceId + 
                                        " (last emitted " + (currentTime - lastConnectedLogTime) + "ms ago)");
                                }
                                
                                // Cancel connection timeout timer (connection succeeded)
                                ScheduledFuture<?> timeoutTimer = connectionTimeoutTimers.remove(deviceId);
                                if (timeoutTimer != null && !timeoutTimer.isDone()) {
                                    boolean cancelled = timeoutTimer.cancel(false);
                                    if (cancelled) {
                                        Log.d(TAG, "✅ [CONNECTION] Timeout timer cancelled for " + deviceId);
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
                                getOrCreateGattQueue(deviceId).setGatt(gatt);
                                
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
                                
                                // ✅ connectionState managed by BLEConnectionManager (will be "connecting")
                                
                                // Clear notification tracking (fresh connection)
                                pendingNotificationEnables.remove(deviceId);
                                completedNotificationEnables.remove(deviceId);
                                
                                // nRF-style: If bonding in progress, defer MTU/discovery until BOND_BONDED then wait 1600ms
                                if (bondState == BluetoothDevice.BOND_BONDING) {
                                    devicesWaitingForBondAfterConnect.add(deviceId);
                                    Log.i(TAG, "⏳ [nRF-style] Bonding in progress - deferring MTU/discovery until bonded, then 1600ms delay: " + deviceId);
                                } else {
                                    // Start MTU negotiation (request larger packet size) via global GATT queue
                                    secureReadyStates.put(deviceId, SecureReadyState.MTU_NEGOTIATING);
                                    enqueueGattOp(deviceId, () -> {
                                        pendingGattComplete.put(deviceId, (st) -> {
                                            advanceGattQueue(deviceId);
                                        });
                                        gatt.requestMtu(REQUESTED_MTU);  // Request 512 bytes (default is 23)
                                    }, "requestMtu");
                                    
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
                                                enqueueDiscoverServicesOp(deviceId, gatt, "mtu_timeout_discover_services");
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
                                }
                            } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                                failGattQueueOnDisconnect(deviceId);
                                connectionManager.onConnectionAttemptFailed(deviceId);
                                Log.d("SampleBridgeAndroid", "❌ Disconnected from: " + deviceId);
                                
                                // Check if service discovery was in progress
                                boolean wasDiscovering = serviceDiscoveryTimeouts.containsKey(deviceId) || 
                                                         serviceDiscoveryStartTimes.containsKey(deviceId);
                                boolean notificationsEnabled = pendingNotificationEnables.containsKey(deviceId) && 
                                                              completedNotificationEnables.containsKey(deviceId);
                                Integer pendingNotifications = pendingNotificationEnables.get(deviceId);
                                Integer completedNotifications = completedNotificationEnables.get(deviceId);
                                // Check if device was in/after sync (read before cleanup clears dataSyncState)
                                String syncState = dataSyncState.get(deviceId);
                                boolean wasInSyncOrComplete = "syncing".equals(syncState) || "complete".equals(syncState);
                                
                                if (wasDiscovering) {
                                    Log.w(TAG, "⚠️ [DISCONNECTION] Service discovery was in progress when device disconnected: " + deviceId);
                                }
                                if (!notificationsEnabled && pendingNotifications != null && pendingNotifications > 0) {
                                    Log.w(TAG, "⚠️ [DISCONNECTION] Notifications not fully enabled before disconnection: " + deviceId + 
                                        " (" + (completedNotifications != null ? completedNotifications : 0) + "/" + pendingNotifications + " enabled)");
                                }
                                
                                WritableMap disconnectLogEvent = Arguments.createMap();
                                disconnectLogEvent.putString("deviceId", deviceId);
                                disconnectLogEvent.putString("action", "Disconnected");
                                disconnectLogEvent.putInt("status", status);
                                disconnectLogEvent.putBoolean("wasDiscovering", wasDiscovering);
                                disconnectLogEvent.putBoolean("notificationsEnabled", notificationsEnabled);
                                if (pendingNotifications != null && completedNotifications != null) {
                                    disconnectLogEvent.putInt("notificationsPending", pendingNotifications);
                                    disconnectLogEvent.putInt("notificationsCompleted", completedNotifications);
                                }
                                disconnectLogEvent.putString("platform", "Android");
                                String disconnectNote = wasDiscovering ? 
                                    "Disconnected during service discovery" : 
                                    (wasInSyncOrComplete ? "Normal disconnection (after sync)" :
                                     (notificationsEnabled ? "Normal disconnection" : 
                                      (pendingNotifications != null && pendingNotifications > 0 ? 
                                       "Disconnected before notifications enabled (" + completedNotifications + "/" + pendingNotifications + ")" :
                                       "Disconnected before service discovery")));
                                disconnectLogEvent.putString("note", disconnectNote);
                                sendEvent("ConnectionLog", disconnectLogEvent);
                                
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
                                failGattQueueOnDisconnect(deviceId);
                                cleanupDeviceResources(deviceId);
                                DeviceData deviceData = deviceDataMap.get(deviceId);
                                if (deviceData != null) {
                                    // ✅ connectionState managed by BLEConnectionManager
                                    sendEvent("DeviceDisconnected", createDeviceInfoMap(deviceData));
                                }
                                boolean isManualDisconnect = manualDisconnectInProgress.contains(deviceId);
                            }
                        }
                        @Override
                        public void onServicesDiscovered(BluetoothGatt gatt, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            
                            // Log service discovery result
                            Long discoveryStartTime = serviceDiscoveryStartTimes.remove(deviceId);
                            long discoveryDuration = discoveryStartTime != null ? 
                                (System.currentTimeMillis() - discoveryStartTime) : -1;
                            
                            WritableMap discoveryLogEvent = Arguments.createMap();
                            discoveryLogEvent.putString("deviceId", deviceId);
                            discoveryLogEvent.putString("action", "Service Discovery");
                            discoveryLogEvent.putInt("status", status);
                            discoveryLogEvent.putLong("durationMs", discoveryDuration);
                            discoveryLogEvent.putString("platform", "Android");
                            
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                // Cancel service discovery timeout
                                ScheduledFuture<?> timeoutTask = serviceDiscoveryTimeouts.remove(deviceId);
                                if (timeoutTask != null) {
                                    timeoutTask.cancel(false);
                                }
                                
                                // Clear retry counter on success
                                serviceDiscoveryRetryAttempts.remove(deviceId);
                                
                                List<BluetoothGattService> services = gatt.getServices();
                                int serviceCount = services != null ? services.size() : 0;
                                
                                Log.d(TAG, "✅ [SERVICE DISCOVERY] Success for " + deviceId + 
                                    " - " + serviceCount + " services discovered" + 
                                    (discoveryDuration > 0 ? " (took " + discoveryDuration + "ms)" : ""));
                                
                                discoveryLogEvent.putString("status", "success");
                                discoveryLogEvent.putInt("serviceCount", serviceCount);
                                discoveryLogEvent.putString("note", "Service discovery completed - proceeding with notification setup");
                                sendEvent("ConnectionLog", discoveryLogEvent);
                                
                                // Process discovered services
                                handleServicesDiscovered(gatt);
                                
                                if (devicesPendingPairingVerification.containsKey(deviceId)) {
                                    DeviceData deviceData = deviceDataMap.get(deviceId);
                                    if (deviceData != null && deviceData.characteristics.containsKey(DEVICE_STATUS_CHAR_UUID)) {
                                        BluetoothGattCharacteristic deviceStatusChar = deviceData.characteristics.get(DEVICE_STATUS_CHAR_UUID);
                                        if (deviceStatusChar != null) {
                                            enqueueReadCharacteristicOp(deviceId, gatt, deviceStatusChar, "pairing_verify_device_status");
                                        } else {
                                            ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                            if (timer != null) {
                                                timer.cancel(false);
                                            }
                                            confirmConnection(deviceId, gatt);
                                        }
                                    } else {
                                        ScheduledFuture<?> timer = pairingVerificationTimers.remove(deviceId);
                                        if (timer != null) {
                                            timer.cancel(false);
                                        }
                                        confirmConnection(deviceId, gatt);
                                    }
                                }
                                
                                String promiseKey = "discover_services_" + deviceId;
                                Promise pendingPromise = pendingServiceDiscoveryPromises.remove(promiseKey);
                                if (pendingPromise == null) {
                                    pendingPromise = pendingServiceDiscoveryPromises.remove(deviceId);
                                }
                                if (pendingPromise != null) {
                                    pendingPromise.resolve(true);
                                }
                            } else {
                                // Service discovery failed
                                Log.e(TAG, "❌ [SERVICE DISCOVERY] Failed for device " + deviceId + ": " + status + 
                                    (discoveryDuration > 0 ? " (took " + discoveryDuration + "ms)" : ""));
                                
                                discoveryLogEvent.putString("status", "failed");
                                discoveryLogEvent.putString("error", getGATTErrorMessage(status));
                                discoveryLogEvent.putString("note", "Service discovery failed - will retry if attempts remaining");
                                sendEvent("ConnectionLog", discoveryLogEvent);
                                
                                // Cancel timeout
                                ScheduledFuture<?> timeoutTask = serviceDiscoveryTimeouts.remove(deviceId);
                                if (timeoutTask != null) {
                                    timeoutTask.cancel(false);
                                }
                                
                                // Check if we should retry
                                Integer retryCount = serviceDiscoveryRetryAttempts.getOrDefault(deviceId, 0);
                                if (retryCount < MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS && 
                                    connectedGatts.containsKey(deviceId)) {
                                    // Retry service discovery
                                    retryCount++;
                                    serviceDiscoveryRetryAttempts.put(deviceId, retryCount);
                                    Log.d(TAG, "🔄 [SERVICE DISCOVERY] Retrying (" + retryCount + "/" + 
                                        MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS + ") for " + deviceId);
                                    
                                    // Create final copies for inner class
                                    final int finalRetryCount = retryCount;
                                    final BluetoothGatt finalGatt = gatt;
                                    final String finalDeviceId = deviceId;
                                    
                                    mainHandler.postDelayed(new Runnable() {
                                        @Override
                                        public void run() {
                                            if (connectedGatts.containsKey(finalDeviceId)) {
                                                startServiceDiscoveryWithRetry(finalGatt, finalDeviceId, finalRetryCount);
                                            }
                                        }
                                    }, 1000 * finalRetryCount); // Exponential backoff: 1s, 2s, 3s
                                } else {
                                    // Max retries reached or device disconnected
                                    if (retryCount >= MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS) {
                                        Log.e(TAG, "❌ [SERVICE DISCOVERY] Max retries reached for " + deviceId);
                                        
                                        WritableMap maxRetryLogEvent = Arguments.createMap();
                                        maxRetryLogEvent.putString("deviceId", deviceId);
                                        maxRetryLogEvent.putString("action", "Service Discovery Failed");
                                        maxRetryLogEvent.putString("status", "max_retries_reached");
                                        maxRetryLogEvent.putInt("retryCount", retryCount);
                                        maxRetryLogEvent.putString("platform", "Android");
                                        maxRetryLogEvent.putString("note", "Service discovery failed after " + 
                                            MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS + " attempts");
                                        sendEvent("ConnectionLog", maxRetryLogEvent);
                                    }
                                    
                                    serviceDiscoveryRetryAttempts.remove(deviceId);
                                    
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
                            // If discoverServices() was queued, advance the queue from this callback.
                            runPendingGattComplete(deviceId, status);
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
                            if (runPendingGattComplete(deviceId, status)) {
                                handleDescriptorWritePromise(deviceId, descriptor, status);
                                return;
                            }
                            handleDescriptorWritePromise(deviceId, descriptor, status);
                        }
                        @Override
                        public void onCharacteristicRead(BluetoothGatt gatt, BluetoothGattCharacteristic characteristic, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            String characteristicUuid = characteristic.getUuid().toString();
                            if (runPendingGattComplete(deviceId, status)) {
                                if (status == BluetoothGatt.GATT_SUCCESS) {
                                    handleCharacteristicData(deviceId, characteristic);
                                }
                                return;
                            }
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
                            Log.d(TAG, "[GATT QUEUE] onCharacteristicWrite CB [" + deviceId + "] char=" + characteristicUuid + " status=" + status);
                            boolean advanced = runPendingGattComplete(deviceId, status);
                            if (advanced) {
                                pendingWrites.remove(writeKey);
                                return;
                            }
                            String transactionId = writeTransactionIds.remove(writeKey);
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
                                boolean isSystemCommand = characteristicUuid.equals(SYSTEM_COMMAND_CHAR_UUID);
                                if (!isSystemCommand) {
                                    Log.w(TAG, "⚠️ No transaction ID found for write callback: " + writeKey);
                                } else if (status != BluetoothGatt.GATT_SUCCESS) {
                                    Log.e(TAG, "❌ [GATT QUEUE] System command write failed with status: " + status);
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
                            if (runPendingGattComplete(deviceId, status)) {
                                WritableMap mtuLogEvent = Arguments.createMap();
                                mtuLogEvent.putString("deviceId", deviceId);
                                mtuLogEvent.putString("action", "MTU Negotiation");
                                mtuLogEvent.putInt("mtu", mtu);
                                mtuLogEvent.putInt("status", status);
                                mtuLogEvent.putString("platform", "Android");
                                if (status == BluetoothGatt.GATT_SUCCESS) {
                                    negotiatedMtuMap.put(deviceId, mtu);
                                    Log.d(TAG, "✅ [MTU] Negotiation successful for " + deviceId + ": " + mtu + " bytes");
                                    mtuLogEvent.putString("status", "success");
                                    mtuLogEvent.putString("note", "MTU negotiation completed - proceeding with service discovery");
                                    sendEvent("ConnectionLog", mtuLogEvent);
                                    ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                    if (mtuTimeout != null) mtuTimeout.cancel(false);
                                    updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                    startServiceDiscoveryWithRetry(gatt, deviceId, 0);
                                } else {
                                    negotiatedMtuMap.put(deviceId, DEFAULT_MTU);
                                    Log.w(TAG, "⚠️ [MTU] Negotiation failed for device " + deviceId + ": " + status + " - using default MTU: " + DEFAULT_MTU);
                                    mtuLogEvent.putString("status", "failed");
                                    mtuLogEvent.putString("note", "MTU negotiation failed - using default MTU (" + DEFAULT_MTU + " bytes)");
                                    sendEvent("ConnectionLog", mtuLogEvent);
                                    ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                    if (mtuTimeout != null) mtuTimeout.cancel(false);
                                    updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                    startServiceDiscoveryWithRetry(gatt, deviceId, 0);
                                }
                                return;
                            }
                            WritableMap mtuLogEvent = Arguments.createMap();
                            mtuLogEvent.putString("deviceId", deviceId);
                            mtuLogEvent.putString("action", "MTU Negotiation");
                            mtuLogEvent.putInt("mtu", mtu);
                            mtuLogEvent.putInt("status", status);
                            mtuLogEvent.putString("platform", "Android");
                            if (status == BluetoothGatt.GATT_SUCCESS) {
                                negotiatedMtuMap.put(deviceId, mtu);
                                Log.d(TAG, "✅ [MTU] Negotiation successful for " + deviceId + ": " + mtu + " bytes");
                                mtuLogEvent.putString("status", "success");
                                mtuLogEvent.putString("note", "MTU negotiation completed - proceeding with service discovery");
                                sendEvent("ConnectionLog", mtuLogEvent);
                                ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                if (mtuTimeout != null) mtuTimeout.cancel(false);
                                updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                startServiceDiscoveryWithRetry(gatt, deviceId, 0);
                            } else {
                                negotiatedMtuMap.put(deviceId, DEFAULT_MTU);
                                Log.w(TAG, "⚠️ [MTU] Negotiation failed for device " + deviceId + ": " + status + " - using default MTU: " + DEFAULT_MTU);
                                mtuLogEvent.putString("status", "failed");
                                mtuLogEvent.putString("note", "MTU negotiation failed - using default MTU (" + DEFAULT_MTU + " bytes)");
                                sendEvent("ConnectionLog", mtuLogEvent);
                                ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
                                if (mtuTimeout != null) mtuTimeout.cancel(false);
                                updateSecureReadyState(deviceId, SecureReadyState.SERVICES_DISCOVERING);
                                startServiceDiscoveryWithRetry(gatt, deviceId, 0);
                            }
                        }
                        @Override
                        public void onReadRemoteRssi(BluetoothGatt gatt, int rssi, int status) {
                            String deviceId = gatt.getDevice().getAddress();
                            if (runPendingGattComplete(deviceId, status)) {
                                Promise pendingPromise = pendingRSSIPromises.remove(deviceId);
                                if (pendingPromise == null) {
                                    pendingPromise = pendingRSSIPromises.remove("rssi_" + deviceId);
                                }
                                if (pendingPromise != null) {
                                    if (status == BluetoothGatt.GATT_SUCCESS) {
                                        pendingPromise.resolve(rssi);
                                    } else {
                                        pendingPromise.reject("RSSI_ERROR", "RSSI read failed with status: " + status);
                                    }
                                }
                                if (status == BluetoothGatt.GATT_SUCCESS) {
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
                                        if (deviceData.temperature > 0) {
                                            deviceDataUpdateEvent.putDouble("temperature", deviceData.temperature);
                                        } else {
                                            deviceDataUpdateEvent.putNull("temperature");
                                        }
                                        deviceDataUpdateEvent.putInt("steps", deviceData.steps);
                                        deviceDataUpdateEvent.putDouble("timestamp", deviceData.timestamp);
                                        sendEvent("DeviceDataUpdated", deviceDataUpdateEvent);
                                    }
                                    WritableMap rssiMap = Arguments.createMap();
                                    rssiMap.putString("deviceId", deviceId);
                                    rssiMap.putInt("rssi", rssi);
                                    rssiMap.putDouble("timestamp", System.currentTimeMillis());
                                    sendEvent("RSSIUpdate", rssiMap);
                                } else {
                                    Log.e(TAG, "❌ RSSI read failed for device " + deviceId + " with status: " + status);
                                }
                                return;
                            }
                        }
            };
            connectionManager.requestConnectionApproval(deviceId, device, new BLEConnectionManager.ConnectionApprovalCallback() {
                @Override
                public void onConnectApproved() {
                    startGattConnectionInternal(device, deviceId, gattCallback);
                }
                @Override
                public void onConnectRejected(String reason) {
                    Log.w(TAG, "Connection rejected: " + reason);
                    String promiseKey = "connect_" + deviceId;
                    Promise pendingPromise = pendingConnectionPromises.remove(promiseKey);
                    if (pendingPromise != null) {
                        pendingPromise.reject("CONNECTION_REJECTED", reason);
                    }
                }
            });
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
    
    /**
     * Internal: perform actual connectGatt after ConnectionManager approval.
     * Only door into the manual GATT lifecycle; all MTU/retry/pairing logic remains in the callback above.
     */
    private void startGattConnectionInternal(BluetoothDevice device, String deviceId, BluetoothGattCallback gattCallback) {
        BluetoothGatt gatt = device.connectGatt(
                getReactApplicationContext(),
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE
        );
        synchronized (gattLock) {
            connectedGatts.put(deviceId, gatt);
        }
        getOrCreateGattQueue(deviceId).setGatt(gatt);
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
            
            // Route through global GATT queue (single op at a time per device)
            final BluetoothGattCharacteristic charToRead = characteristic;
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (status) -> {
                    advanceGattQueue(deviceId);
                });
                boolean ok = gatt.readCharacteristic(charToRead);
                if (!ok) {
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                    transactionManager.rejectTransaction(transactionId, BLEError.ErrorCode.CHARACTERISTIC_READ_FAILED.name(), 
                        "Failed to initiate characteristic read");
                    pendingReadPromises.remove(promiseKey);
                }
            });
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
            }, 10, TimeUnit.SECONDS);
            // Route through per-device queue (no direct gatt.discoverServices outside queue)
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                boolean discoverResult = gatt.discoverServices();
                if (!discoverResult) {
                    pendingServiceDiscoveryPromises.remove(deviceId);
                    promise.reject("DISCOVERY_ERROR", "Failed to initiate service discovery");
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                }
            });
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
                enqueueDiscoverServicesOp(deviceId, gatt, "getDeviceServices");
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
            for (Map.Entry<String, BluetoothGattService> entry : new java.util.ArrayList<>(deviceData.services.entrySet())) {
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
            
            // Initiate write operation via per-device queue (no direct gatt.writeCharacteristic outside queue)
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
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
                    
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                }
            });
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
        // Legacy API: route to the single per-device GATT operation queue.
        readCharacteristic(deviceId, characteristicUuid, promise);
    }
    @ReactMethod
    public void enqueueWriteOperation(String deviceId, String characteristicUuid, String data, Promise promise) {
        // Legacy API: route to the single per-device GATT operation queue.
        writeCharacteristic(deviceId, characteristicUuid, data, promise);
    }
    @ReactMethod
    public void signalOperationComplete(String deviceId) {
        // ❌ REMOVED: connectionManager.onOperationComplete() - operation queue removed from BLEConnectionManager
        // All GATT operations now handled by GattOperationQueue in SampleBridgeAndroid
        // This method is deprecated and no longer needed
        Log.w(TAG, "⚠️ signalOperationComplete() is deprecated - operation queue managed locally");
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
    @Override
    @ReactMethod
    public void sendSystemCommand(String deviceId, double commandId, ReadableArray payload, Promise promise) {
        int command = (int) commandId;
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
        devicesWaitingForBondAfterConnect.remove(deviceId);
        
        // Cancel MTU negotiation timeout (e.g. from normal path or nRF-style after-bond path)
        ScheduledFuture<?> mtuTimeout = mtuNegotiationTimeouts.remove(deviceId);
        if (mtuTimeout != null) {
            mtuTimeout.cancel(false);
        }
        
        // Cancel connection timeout timer
        ScheduledFuture<?> connectionTimeoutTimer = connectionTimeoutTimers.remove(deviceId);
        if (connectionTimeoutTimer != null) {
            connectionTimeoutTimer.cancel(false);
        }
        
        // Cancel service discovery timeout timer
        ScheduledFuture<?> serviceDiscoveryTimeout = serviceDiscoveryTimeouts.remove(deviceId);
        if (serviceDiscoveryTimeout != null) {
            serviceDiscoveryTimeout.cancel(false);
        }
        
        // Clear service discovery retry tracking
        serviceDiscoveryRetryAttempts.remove(deviceId);
        serviceDiscoveryStartTimes.remove(deviceId);
        
        // Clear system command tracking
        systemCommandsSent.remove(deviceId);
        systemCommandsSent.remove(deviceId + "_DATA_INTERVAL");
        systemCommandsSent.remove(deviceId + "_DATA_ACQUISITION");
        
        // Clear data sync state
        dataSyncState.remove(deviceId);
        dataSyncRetryCount.remove(deviceId);
        deviceRecordCounts.remove(deviceId);
        dataSyncRequested.remove(deviceId);
        syncCommandSentFlags.remove(deviceId);
        dataSyncStartRetryAttemptForQueue.remove(deviceId);
        lastDataTransferHex.remove(deviceId);
        lastDataTransferTime.remove(deviceId);
        
        // Clear notification tracking
        pendingNotificationEnables.remove(deviceId);
        completedNotificationEnables.remove(deviceId);
        
        // Clear global GATT queue (industry pattern: one queue per device)
        GattOperationQueue q = gattQueues.remove(deviceId);
        if (q != null) {
            int pending = q.queueSize();
            boolean wasInFlight = q.isInFlight();
            String currentOp = q.getCurrentOpName();
            q.setGatt(null);
            Log.d(TAG, "[GATT QUEUE] CLEARED [" + deviceId + "] pending=" + pending + " wasInFlight=" + wasInFlight + " currentOp=" + currentOp);
        }
        
        // Clear descriptor write state and command-sequence guard (SDD v1.5)
        deviceRTCValidity.remove(deviceId);
        deviceStatusReadComplete.remove(deviceId);
        commandSequenceProceeded.remove(deviceId);
        rtcCheckPendingBeforeNotifications.remove(deviceId);
        deviceStatusReadAfterSetTimePending.remove(deviceId);
        pendingPostSyncDeviceStatusRead.remove(deviceId);
        pendingPostSyncSyncStart.remove(deviceId);

        // Industry fix: Clear sync session state so next connection = fresh session (no stale sync state)
        flushSyncRecordBuffer(deviceId);
        syncTotalRecords.remove(deviceId);
        syncRemainingRecords.remove(deviceId);
        syncGrandTotalReceived.remove(deviceId);
        syncRecordsReceived.remove(deviceId);
        syncCurrentFileNumber.remove(deviceId);
        syncCompleteProcessedForChunk.remove(deviceId);
        chunkGrandTotalAdvancedInRecordPath.remove(deviceId);
        syncSingleChunkOnly.remove(deviceId);
        pendingSyncRecordCount.remove(deviceId);
        lastSyncRecordsEmitGrandTotal.remove(deviceId);
        lastSyncRecordsEmitTime.remove(deviceId);
        syncRecordBuffer.remove(deviceId);

        // 🔓 SYNC LOCK CLEANUP: Release lock on disconnect (auto-release on GATT death)
        SyncLockState lockState = historySyncLock.remove(deviceId);
        if (lockState != null) {
            long duration = System.currentTimeMillis() - lockState.startTime;
            Log.d(TAG, "🔓 [SYNC LOCK] Released on disconnect for " + deviceId + " (was active for " + (duration / 1000) + "s)");
        }
        
        // 📊 LOG PARTIAL RECORD METRICS: Report data loss on disconnect
        Integer droppedCount = partialRecordsDropped.remove(deviceId);
        if (droppedCount != null && droppedCount > 0) {
            Log.w(TAG, "📊 [METRICS] Dropped " + droppedCount + " partial records for " + deviceId + " during this session");
        }
        lastPartialDropLogTime.remove(deviceId);
        
        // Cancel data sync timer
        ScheduledFuture<?> syncTimer = dataSyncTimers.get(deviceId);
        if (syncTimer != null) {
            syncTimer.cancel(false);
            dataSyncTimers.remove(deviceId);
        }
        
        // Cancel sync timeout checker (no records for 30s) so it doesn't fire after disconnect
        ScheduledFuture<?> syncChecker = syncTimeoutCheckers.remove(deviceId);
        if (syncChecker != null) {
            syncChecker.cancel(false);
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
            // ✅ connectionState managed by BLEConnectionManager
            deviceData.services.clear();
            deviceData.characteristics.clear();
        }
        
        // ✅ FIX: Clear emitted event flags on disconnect (will be re-emitted on reconnect)
        hasEmittedServicesDiscovered.remove(deviceId);
        notificationsEnableInProgress.remove(deviceId);
        hasEmittedConnectedLog.remove(deviceId);
        
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
            // 🔒 SYNC LOCK GUARD: Block disconnect during active history sync
            SyncLockState lockState = historySyncLock.get(deviceId);
            if (lockState != null) {
                BluetoothGatt currentGatt = connectedGatts.get(deviceId);
                
                // Check if lock is stale (GATT instance changed)
                if (currentGatt != null && lockState.isStale(currentGatt)) {
                    Log.w(TAG, "🔓 [SYNC LOCK] Stale lock detected - GATT instance changed, releasing");
                    historySyncLock.remove(deviceId);
                } else {
                    // Lock is valid - check timeout
                    long lockDuration = System.currentTimeMillis() - lockState.startTime;
                    if (lockDuration < SYNC_LOCK_TIMEOUT_MS) {
                        Log.w(TAG, "🔒 [SYNC LOCK] Cannot disconnect " + deviceId + " - history sync in progress");
                        Log.w(TAG, "   Sync started " + (lockDuration / 1000) + "s ago, please wait for completion");
                        promise.reject("SYNC_IN_PROGRESS", "Cannot disconnect during history sync. Please wait for sync to complete.");
                        return;
                    } else {
                        // Timeout exceeded - force release lock and allow disconnect
                        Log.w(TAG, "⏱️ [SYNC LOCK] Timeout exceeded (" + (lockDuration / 1000) + "s) - forcing lock release");
                        historySyncLock.remove(deviceId);
                    }
                }
            }
            
            Log.d(TAG, "🔌 Manual disconnect from device: " + deviceId + " (system-style)");
            manualDisconnectInProgress.add(deviceId);
            mainHandler.postDelayed(() -> {
                if (manualDisconnectInProgress.contains(deviceId)) {
                    Log.d(TAG, "⏰ Clearing manual disconnect tracking after 30 minutes for: " + deviceId);
                    manualDisconnectInProgress.remove(deviceId);
                }
            }, 1800000);
            final BluetoothGatt gatt = connectedGatts.get(deviceId);
            Runnable doCleanupAndDisconnect = () -> {
                failGattQueueOnDisconnect(deviceId);
                cleanupDeviceResources(deviceId);
                if (connectionManager != null) {
                    if (gatt != null) {
                        connectionManager.disconnectDevice(deviceId, gatt);
                    } else {
                        Log.w(TAG, "⚠️ No GATT found for device: " + deviceId);
                    }
                } else if (gatt != null) {
                    gatt.disconnect();
                    gatt.close();
                    connectedGatts.remove(deviceId);
                }
                promise.resolve(true);
            };
            if (ensureDataSyncStopSent(deviceId)) {
                mainHandler.postDelayed(doCleanupAndDisconnect, DISCONNECT_AFTER_STOP_DELAY_MS);
            } else {
                doCleanupAndDisconnect.run();
            }
            if (gatt == null) {
                Log.w(TAG, "⚠️ No GATT found for device: " + deviceId);
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
                        // ✅ Use helper to get connection state from BLEConnectionManager
                        if (deviceData != null && "connected".equals(getConnectionState(deviceId))) {
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
        // ✅ connectionState managed by BLEConnectionManager (will be "connecting")
        
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
            metadata.putString("connectionType", "manual");
        }
        
        Boolean wasAlreadyBonded = deviceWasAlreadyBonded.get(deviceId);
        if (wasAlreadyBonded != null) {
            metadata.putBoolean("wasAlreadyBonded", wasAlreadyBonded);
        } else {
            metadata.putBoolean("wasAlreadyBonded", bondState == BluetoothDevice.BOND_BONDED);
        }
        
        connectionMetadata.put(deviceId, metadata);
        
        // Clean up temporary connection tracking
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
        connectionManager.onConnectionAttemptFailed(deviceId);

        // ════════════════════════════════════════════════════════════════════════════
        // GATT cache refresh (hidden API, best-effort).
        // Must be called BEFORE disconnect()/close() — the hidden refresh() method
        // needs a live GATT instance. Calling it after close() silently no-ops.
        // Store the reference first, then close the connection below.
        // ════════════════════════════════════════════════════════════════════════════
        final BluetoothGatt gattForRefresh = failedGatt;
        try {
            java.lang.reflect.Method refreshMethod = BluetoothGatt.class.getMethod("refresh");
            if (gattForRefresh != null) {
                boolean refreshed = (Boolean) refreshMethod.invoke(gattForRefresh);
                Log.d(TAG, "🔄 [STATUS 133] GATT cache refresh result for " + deviceId + ": " + refreshed);
            }
        } catch (NoSuchMethodException e) {
            Log.d(TAG, "⚠️ [STATUS 133] BluetoothGatt.refresh() not available on this device");
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [STATUS 133] GATT cache refresh failed: " + e.getMessage());
        }

        // Industry best practice: Always fully close GATT (disconnect + close)
        try {
            if (failedGatt != null) {
                failedGatt.disconnect();
                failedGatt.close();
                failedGatt = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error closing failed GATT: " + e.getMessage());
        }
        connectedGatts.remove(deviceId);
        synchronized(gattLock) {
            BluetoothGatt existingGatt = connectedGatts.get(deviceId);
            if (existingGatt != null && existingGatt != gattForRefresh) {
                try {
                    existingGatt.disconnect();
                    existingGatt.close();
                } catch (Exception e) {
                    Log.e(TAG, "❌ Error cleaning up stale GATT: " + e.getMessage());
                }
                connectedGatts.remove(deviceId);
            }
        }
        connectingDevices.remove(deviceId);
        String promiseKey = "connect_" + deviceId;
        Promise pendingPromise = pendingConnectionPromises.get(promiseKey);
        if (pendingPromise != null) {
            // ConnectionManager decides delay, retry count, cooldown, give-up
            long retryAfter = connectionManager.onConnectionFailed(deviceId, device, BLEConnectionManager.ERROR_133);
            if (retryAfter >= 0) {
                mainHandler.postDelayed(() -> {
                    Promise stillPending = pendingConnectionPromises.get(promiseKey);
                    if (stillPending != null) {
                        executorService.execute(() -> {
                            try {
                                WritableMap retryOptions = Arguments.createMap();
                                retryOptions.putBoolean("isManualConnection", true);
                                connectToDeviceWithOptions(deviceId, retryOptions, stillPending);
                            } catch (Exception e) {
                                Log.e(TAG, "❌ Error retrying connection after status 133: " + e.getMessage());
                                Promise finalPromise = pendingConnectionPromises.remove(promiseKey);
                                if (finalPromise != null) {
                                    finalPromise.reject("GATT_ERROR", "Connection retry failed after cache refresh. Device may be out of range.");
                                }
                            }
                        });
                    }
                }, retryAfter);
            } else {
                Promise finalPromise = pendingConnectionPromises.remove(promiseKey);
                if (finalPromise != null) {
                    finalPromise.reject("GATT_ERROR", "Connection failed after " + BLEConnectionManager.MAX_STATUS_133_RETRIES + 
                                       " retries with exponential backoff. Device may be out of range or needs re-pairing.");
                }
            }
        } else {
            DeviceData deviceData = deviceDataMap.get(deviceId);
            if (deviceData != null) {
                // ✅ connectionState managed by BLEConnectionManager
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
            // ✅ connectionState managed by BLEConnectionManager
            WritableMap deviceInfo = createDeviceInfoMap(deviceData);
            deviceInfo.putBoolean("pairingFailed", true); 
            sendEvent("DeviceDisconnected", deviceInfo);
        }
        sendLocalNotificationIfBackground("Pairing Failed", "Failed to pair with " + deviceName + ". Please try again.");
    }
    // ============================================================================
    // GLOBAL GATT OPERATION QUEUE (industry pattern: one queue per device)
    // ============================================================================
    
    /**
     * Enqueue a GATT operation. All of: writeCharacteristic, readCharacteristic,
     * writeDescriptor (CCCD), readRSSI, MTU, RTC read, DATA_SYNC_* go through this.
     * Only one op at a time per device; callbacks drive the queue via onOperationComplete.
     */
    private void enqueueGattOp(String deviceId, GattOperation op) {
        if (deviceId == null || op == null) return;
        mainHandler.post(() -> {
            if (checkGattQueueWedgedAndReset(deviceId)) return;
            getOrCreateGattQueue(deviceId).enqueue(op);
        });
    }

    /**
     * Enqueue a Runnable as a GattOperation. The runnable must register its completion callback
     * via pendingGattComplete.put(deviceId, callback). When the GATT callback fires, runPendingGattComplete
     * calls queue.onOperationComplete(status), which runs this callback then advances the queue.
     */
    private void enqueueGattOp(String deviceId, Runnable runnable) {
        enqueueGattOp(deviceId, runnable, "Runnable");
    }

    /** Same as above but with a distinct op name for logging (e.g. timeout shows which op stuck). */
    private void enqueueGattOp(String deviceId, Runnable runnable, String opName) {
        enqueueGattOp(deviceId, runnable, opName, 0);
    }

    /** Enqueue with optional per-op timeout (ms). Use 3000 for CCCD on auto-connect to fail fast. */
    private void enqueueGattOp(String deviceId, Runnable runnable, String opName, int opTimeoutMs) {
        if (deviceId == null || runnable == null) return;
        Consumer<Integer> onComplete = (status) -> {
            Consumer<Integer> cb = pendingGattComplete.remove(deviceId);
            if (cb != null) cb.accept(status);
        };
        String name = (opName != null && !opName.isEmpty()) ? opName : "Runnable";
        int timeout = opTimeoutMs > 0 ? opTimeoutMs : 10000;
        mainHandler.post(() -> {
            if (checkGattQueueWedgedAndReset(deviceId)) return;
            getOrCreateGattQueue(deviceId).enqueue(new RunnableGattOp(runnable, onComplete, name, timeout));
        });
    }

    /**
     * Advance the queue. Two valid use cases:
     * (1) Init failed: gatt.writeDescriptor/readCharacteristic/readRemoteRssi returned false — call this to
     *     complete the current op with GATT_FAILURE and run the next op.
     * (2) Do NOT call from inside an op's onComplete (when BLE callback fired). The queue already advances
     *     in GattOperationQueue.onOperationComplete (it posts executeNext). If you also post advanceGattQueue
     *     from that callback, it runs later and can see the *next* op in flight, then incorrectly force-complete
     *     it (e.g. DATA_SYNC_STOP reported as failed even though the write succeeded). Root cause of STOP
     *     "Write failed (257)" with device ACK 0x09 0x00: Battery descriptor completion callback called
     *     advanceGattQueue; that runnable ran after the next op (STOP) had started, so we forced STOP with 257.
     */
    private void advanceGattQueue(String deviceId) {
        if (deviceId == null) return;
        mainHandler.post(() -> {
            GattOperationQueue q = gattQueues.get(deviceId);
            if (q != null && q.isInFlight()) {
                String opName = q.getCurrentOpName();
                Log.d(TAG, "[GATT QUEUE] advanceGattQueue FORCE [" + deviceId + "] op=" + opName
                    + " (gatt.writeDescriptor/readCharacteristic/readRemoteRssi returned false or init failed) -> GATT_FAILURE");
                q.onOperationComplete(BluetoothGatt.GATT_FAILURE);
            }
        });
    }

    /**
     * Industry fix: On DISCONNECTED, fail the in-flight GATT op immediately so the queue advances.
     * Without this, one op stays "in flight" and the queue is dead forever (no callback will ever come).
     * Call this at the start of every DISCONNECTED handler before cleanupDeviceResources.
     */
    private void failGattQueueOnDisconnect(String deviceId) {
        if (deviceId == null) return;
        GattOperationQueue q = gattQueues.get(deviceId);
        if (q != null && q.isInFlight()) {
            Log.w(TAG, "⛔ [GATT QUEUE] Connection lost with op in-flight [" + deviceId + "] op=" + q.getCurrentOpName() + " — failing and clearing");
            q.onOperationComplete(BluetoothGatt.GATT_FAILURE);
        }
    }

    /** Nuclear safety: if inFlight=1, pending>=10, and same op in flight >12s, force reset (gatt.close, cleanup, reconnect). */
    private static final int GATT_QUEUE_WEDGED_PENDING_THRESHOLD = 10;
    private static final long GATT_QUEUE_WEDGED_DURATION_MS = 12000;

    /** @return true if a reset was performed (caller should not proceed with queue ops). */
    private boolean checkGattQueueWedgedAndReset(String deviceId) {
        if (deviceId == null) return false;
        GattOperationQueue q = gattQueues.get(deviceId);
        if (q == null) return false;
        if (!q.isInFlight() || q.queueSize() < GATT_QUEUE_WEDGED_PENDING_THRESHOLD) return false;
        long durationMs = q.getInFlightDurationMs();
        if (durationMs < GATT_QUEUE_WEDGED_DURATION_MS) return false;
        Log.e(TAG, "💥 [GATT QUEUE] Queue wedged [" + deviceId + "] inFlight=1 pending=" + q.queueSize()
            + " op=" + q.getCurrentOpName() + " inFlightMs=" + durationMs + " — forcing reset (gatt.close, cleanup)");
        BluetoothGatt gatt = connectedGatts.get(deviceId);
        if (gatt != null) {
            try {
                gatt.close();
            } catch (Exception e) {
                Log.e(TAG, "Error closing GATT on wedged reset: " + e.getMessage());
            }
        }
        cleanupDeviceResources(deviceId);
        return true;
    }

    /**
     * Invoke from onCharacteristicWrite, onDescriptorWrite, onCharacteristicRead, onReadRemoteRssi, onMtuChanged.
     * If this device has an in-flight queued op, run its onComplete(status) and advance the queue; return true.
     * Run completion synchronously when already on main thread so the queue advances immediately (fixes auto-connect
     * where posting could be delayed and timeout could fire first, or callback could be reordered).
     */
    private boolean runPendingGattComplete(String deviceId, int status) {
        GattOperationQueue q = gattQueues.get(deviceId);
        if (q != null && q.isInFlight()) {
            Log.d(TAG, "[GATT QUEUE] runPendingGattComplete CALLBACK RECEIVED [" + deviceId + "] status=" + status
                + " op=" + q.getCurrentOpName() + " pending=" + q.queueSize() + " -> advancing queue");
            if (Looper.myLooper() == mainHandler.getLooper()) {
                q.onOperationComplete(status);
            } else {
                mainHandler.post(() -> q.onOperationComplete(status));
            }
            return true;
        }
        if (q == null) {
            Log.w(TAG, "[GATT QUEUE] runPendingGattComplete SKIP [" + deviceId + "] q=null (no queue for device - callback ignored)");
        } else {
            Log.w(TAG, "[GATT QUEUE] runPendingGattComplete SKIP [" + deviceId + "] status=" + status
                + " isInFlight=false (no op waiting - callback duplicate/stale or op already timed out) pending=" + q.queueSize());
        }
        return false;
    }

    /** discoverServices timeout: manual connection 10s. */
    private static final int DISCOVER_SERVICES_TIMEOUT_MANUAL_MS = 10000;

    /**
     * Queue a BluetoothGatt.discoverServices() call so it cannot collide with other GATT ops.
     * Industry fix: discoverServices() can hang forever (Android BLE bug).
     * - On timeout: disconnect(), close(), cleanupDeviceResources — do NOT continue queue.
     * The queue advances from onServicesDiscovered() via runPendingGattComplete(deviceId, status).
     */
    private void enqueueDiscoverServicesOp(String deviceId, BluetoothGatt gatt, String reason) {
        if (deviceId == null || gatt == null) return;
        String opName = "discoverServices" + (reason != null ? ":" + reason : "");
        int timeoutMs = DISCOVER_SERVICES_TIMEOUT_MANUAL_MS;
        final String fid = deviceId;
        GattOperation op = new GattOperation() {
            @Override
            public void execute(BluetoothGatt g) {
                pendingGattComplete.put(fid, (status) -> advanceGattQueue(fid));
                boolean ok = g.discoverServices();
                if (!ok) {
                    Log.e(TAG, "❌ [GATT QUEUE] discoverServices() failed to initiate for " + fid + (reason != null ? (" (" + reason + ")") : ""));
                    pendingGattComplete.remove(fid);
                    advanceGattQueue(fid);
                }
            }
            @Override
            public void onComplete(int status) {
                Consumer<Integer> cb = pendingGattComplete.remove(fid);
                if (cb != null) cb.accept(status);
            }
            @Override
            public void onTimeout() {
                Log.e(TAG, "⏱️ [GATT QUEUE] discoverServices TIMEOUT [" + fid + "] — disconnect, close, cleanup (do not continue queue)");
                BluetoothGatt g = connectedGatts.get(fid);
                if (g != null) {
                    try { g.disconnect(); } catch (Exception e) { Log.w(TAG, "disconnect on discoverServices timeout: " + e.getMessage()); }
                    try { g.close(); } catch (Exception e) { Log.w(TAG, "close on discoverServices timeout: " + e.getMessage()); }
                }
                connectedGatts.remove(fid);
                cleanupDeviceResources(fid);
            }
            @Override
            public int getTimeoutMs() { return timeoutMs; }
            @Override
            public String name() { return opName; }
        };
        mainHandler.post(() -> {
            if (checkGattQueueWedgedAndReset(deviceId)) return;
            getOrCreateGattQueue(deviceId).enqueue(op);
        });
    }

    /**
     * Queue a BluetoothGatt.readCharacteristic() call so it cannot collide with other GATT ops.
     * The queue advances from onCharacteristicRead() via runPendingGattComplete(deviceId, status).
     */
    private void enqueueReadCharacteristicOp(String deviceId, BluetoothGatt gatt, BluetoothGattCharacteristic ch, String reason) {
        if (deviceId == null || gatt == null || ch == null) return;
        String opName = "readChar" + (reason != null ? ":" + reason : "");
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (status) -> {
                advanceGattQueue(deviceId);
            });
            boolean ok = gatt.readCharacteristic(ch);
            if (!ok) {
                Log.e(TAG, "❌ [GATT QUEUE] readCharacteristic() failed to initiate for " + deviceId +
                    " ch=" + ch.getUuid() + (reason != null ? (" (" + reason + ")") : ""));
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
            }
        }, opName);
    }
    
    // ============================================================================
    // SYSTEM COMMAND QUEUE MANAGEMENT (now routed through global GATT queue)
    // ============================================================================
    
    /**
     * Send a system command to a BLE device via global GATT queue
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
        final byte cmd = commandId;
        final byte[] pl = payload != null ? payload : new byte[0];
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (status) -> {
                onSystemCommandWriteComplete(deviceId, status, cmd);
                advanceGattQueue(deviceId);
            });
            sendSystemCommandWithRetry(deviceId, cmd, pl, 0);
        });
        return true;
    }
    
    /**
     * Command-specific logic when a system command write completes (called from global GATT queue consumer).
     * Does NOT advance queue — consumer calls advanceGattQueue(deviceId).
     */
    private void onSystemCommandWriteComplete(String deviceId, int status, byte commandId) {
        if (status == BluetoothGatt.GATT_SUCCESS) {
            if (commandId == CMD_DATA_SYNC_START) {
                syncCommandSentFlags.put(deviceId, true);
                dataSyncStartRetryAttemptForQueue.remove(deviceId);
                Log.d(TAG, "✅ [DATA SYNC START] Queued command write completed for " + deviceId);
            }
        } else {
            Log.e(TAG, "❌ [SYSTEM COMMAND] Write failed (status=" + status + ") for command 0x" +
                  String.format("%02X", commandId) + " (" + getCommandName(commandId) + ")");
            if (commandId == CMD_DATA_SYNC_START) {
                syncCommandSentFlags.put(deviceId, false);
                // Clear "syncing" so retry can pass isGattBusyOrSyncActive (was causing ~19s stall: retries kept seeing "syncing" and delaying 500ms until 60s timeout).
                dataSyncState.put(deviceId, "idle");
                int att = dataSyncStartRetryAttemptForQueue.getOrDefault(deviceId, 0);
                dataSyncStartRetryAttemptForQueue.remove(deviceId);
                if (att < 3) {
                    Log.w(TAG, "⚠️ [DATA SYNC START] Write failed - retrying (attempt " + (att + 2) + "/4)");
                    mainHandler.post(() -> sendDataSyncStartCommand(deviceId, att + 1));
                } else {
                    Log.e(TAG, "❌ [DATA SYNC START] Write failed after retries - giving up");
                    dataSyncRequested.put(deviceId, false);
                }
            } else if (commandId == CMD_DATA_SYNC_STOP) {
                // When STOP fails, clear "stopping" so POST-SYNC AUTO-SYNC or continuation chunk can send START.
                // Otherwise we stay stuck and DATA_SYNC_START is blocked forever by isGattBusyOrSyncActive.
                String prevState = dataSyncState.getOrDefault(deviceId, "unknown");
                dataSyncState.put(deviceId, "idle");
                Log.w(TAG, "⚠️ [DATA SYNC STOP] Write failed - cleared sync state from " + prevState + " to idle so next START can run");
            }
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
                            onSystemCommandWriteComplete(deviceId, BluetoothGatt.GATT_FAILURE, commandId);
                            advanceGattQueue(deviceId);
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
        // ✅ Always emit DeviceConnected and resolve connect promise when SECURE_READY.
        // Do NOT skip when getConnectionState() is "connected" - manager is set CONNECTED on
        // STATE_CONNECTED, so we would always skip and the JS promise would never resolve (loading forever).
        Log.d(TAG, "✅ [SECURE_READY] Device " + deviceId + " is fully ready - emitting DeviceConnected");
        
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
        
        // Emit DeviceConnected event (manual connections only)
        sendEvent("DeviceConnected", deviceInfo);
        
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
                    enqueueGattOp(deviceId, () -> {
                        pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                        boolean readResult = gatt.readCharacteristic(deviceStatusChar);
                        if (!readResult) {
                            Log.w(TAG, "⚠️ [NATIVE SEQUENCE] Device status read failed - will proceed with RTC as unknown (will send SET time)");
                            pendingGattComplete.remove(deviceId);
                            advanceGattQueue(deviceId);
                            // Mark as complete even on failure to avoid blocking
                            deviceStatusReadComplete.put(deviceId, true);
                        }
                    });
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
    /** SDD v1.5: Sets "ready" only. NEVER starts sync. Device Status and this path never call sendDataSyncStartCommand. */
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
            // SDD v1.5: Device Status never starts sync. Native only sets "ready"; JS calls startDataSync(deviceId) after decide.
            Log.d(TAG, "📦 [SDD v1.5] GATT ready for " + deviceId + " - sync starts only when JS calls startDataSync (Device Status never starts sync)");
            
            // ✅ CRITICAL FIX: Set SECURE_READY here, AFTER the full flow completes
            // This is the correct place - after notifications enabled, RTC checked, and command sequence completed
            // This ensures both manual and auto-connect go through the same unified flow
            finalizeConnectionReady(deviceId, gatt);
        } else {
            mainHandler.postDelayed(new Runnable() {
                @Override
                public void run() {
                    String currentState = dataSyncState.getOrDefault(deviceId, "idle");
                    if (!"idle".equals(currentState) && !"ready".equals(currentState)) {
                        Log.w(TAG, "⚠️ [DATA ACQUISITION] Sync already in progress (state: " + currentState + "), skipping duplicate sync");
                        return;
                    }
                    dataSyncState.put(deviceId, "ready");
                    dataSyncRetryCount.put(deviceId, 0);
                    Log.d(TAG, "📦 [RECOMMENDED FLOW] GATT ready for " + deviceId + " (delayed) - sync from JS");
                    
                    // ✅ CRITICAL FIX: Set SECURE_READY here too (delayed path)
                    BluetoothGatt delayedGatt = connectedGatts.get(deviceId);
                    if (delayedGatt != null) {
                        finalizeConnectionReady(deviceId, delayedGatt);
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
        enqueueSetSystemTimeCommand(deviceId, retryAttempt);
    }

    /**
     * Enqueue Set System Time write on the GATT queue so it runs when the queue is ready.
     * Fixes "writeCharacteristic returned false" when BLE stack is busy (e.g. right after notification enables).
     * When RTC is invalid we send Set Time; this ensures the write is sent after the queue drains.
     */
    private void enqueueSetSystemTimeCommand(String deviceId, int retryAttempt) {
        enqueueGattOp(deviceId, () -> {
            BluetoothGatt gatt = connectedGatts.get(deviceId);
            if (gatt == null) {
                Log.e(TAG, "❌ Failed to send Set System Time command: Device not connected");
                dataSyncState.put(deviceId, "idle");
                advanceGattQueue(deviceId);
                return;
            }
            dataSyncState.put(deviceId, "time_syncing");
            setTimeResponseReceived.put(deviceId, false);
            long currentTimestamp = System.currentTimeMillis() / 1000;
            byte[] payload = new byte[4];
            payload[0] = (byte) (currentTimestamp & 0xFF);
            payload[1] = (byte) ((currentTimestamp >> 8) & 0xFF);
            payload[2] = (byte) ((currentTimestamp >> 16) & 0xFF);
            payload[3] = (byte) ((currentTimestamp >> 24) & 0xFF);
            String timestampHex = String.format("%02X%02X%02X%02X", payload[0], payload[1], payload[2], payload[3]);
            BluetoothGattCharacteristic systemCommandChar = findCharacteristic(gatt, SYSTEM_COMMAND_CHAR_UUID);
            if (systemCommandChar == null) {
                Log.e(TAG, "❌ Failed to send Set System Time command: SYSTEM_COMMAND characteristic not found");
                dataSyncState.put(deviceId, "idle");
                advanceGattQueue(deviceId);
                return;
            }
            int properties = systemCommandChar.getProperties();
            boolean canWrite = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE) != 0;
            boolean canWriteNoResponse = (properties & BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE) != 0;
            if (!canWrite && !canWriteNoResponse) {
                Log.e(TAG, "❌ System Command characteristic is not writable!");
                dataSyncState.put(deviceId, "idle");
                advanceGattQueue(deviceId);
                return;
            }
            if (canWrite) {
                systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT);
            } else {
                systemCommandChar.setWriteType(BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE);
            }
            byte[] packet = buildSystemCommandPacket(CMD_SET_SYSTEM_TIME, payload);
            systemCommandChar.setValue(packet);
            final long ts = currentTimestamp;
            final String tsHex = timestampHex;
            pendingGattComplete.put(deviceId, (status) -> onSetSystemTimeWriteComplete(deviceId, status, retryAttempt, ts, tsHex));
            boolean success = gatt.writeCharacteristic(systemCommandChar);
            if (!success) {
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
            }
        }, "SetSystemTime", 5000);
    }

    private void onSetSystemTimeWriteComplete(String deviceId, int status, int retryAttempt, long currentTimestamp, String timestampHex) {
        if (status != BluetoothGatt.GATT_SUCCESS) {
            Log.e(TAG, "❌ Failed to send Set System Time command - writeCharacteristic returned false (status=" + status + ")");
            Log.e(TAG, "   BLE stack may have been busy; retrying once after 2s if attempt " + (retryAttempt + 1) + "/2");
            setTimeTimeoutTimers.remove(deviceId);
            if (retryAttempt < 1) {
                mainHandler.postDelayed(() -> enqueueSetSystemTimeCommand(deviceId, retryAttempt + 1), 2000);
            } else {
                Log.w(TAG, "⚠️ [RETRY FAILED] Set System Time command failed on retry - proceeding with other commands");
                dataSyncState.put(deviceId, "idle");
                sendDataAcquisitionAndLiveNotifications(deviceId);
            }
            return;
        }
        if (retryAttempt == 0) {
            WritableMap commandEvent = Arguments.createMap();
            commandEvent.putString("deviceId", deviceId);
            commandEvent.putInt("commandId", CMD_SET_SYSTEM_TIME);
            commandEvent.putString("commandName", "Set System Time");
            commandEvent.putString("payload", String.format("0x%02X 0x%02X 0x%02X 0x%02X",
                (int) (currentTimestamp & 0xFF), (int) ((currentTimestamp >> 8) & 0xFF),
                (int) ((currentTimestamp >> 16) & 0xFF), (int) ((currentTimestamp >> 24) & 0xFF)));
            commandEvent.putInt("payloadLength", 4);
            commandEvent.putLong("systemTimestamp", currentTimestamp);
            commandEvent.putString("systemTimestampISO", new java.util.Date(currentTimestamp * 1000).toString());
            commandEvent.putString("timestampHex", timestampHex);
            Boolean rtcValid = deviceRTCValidity.get(deviceId);
            if (rtcValid != null) {
                commandEvent.putBoolean("deviceRTCValid", rtcValid);
            }
            sendEvent("NativeCommandSent", commandEvent);
        }
        ScheduledFuture<?> timeoutTimer = executorService.schedule(() -> {
            Boolean responseReceived = setTimeResponseReceived.get(deviceId);
            if (responseReceived == null || !responseReceived) {
                int currentRetry = setTimeRetryAttempts.getOrDefault(deviceId, 0);
                if (currentRetry < 1) {
                    Log.w(TAG, "⚠️ [TIME SYNC TIMEOUT] Set System Time response not received within 3 seconds");
                    Log.w(TAG, "   Retrying SET TIME command (attempt " + (currentRetry + 1) + "/2)...");
                    setTimeRetryAttempts.put(deviceId, currentRetry + 1);
                    setTimeTimeoutTimers.remove(deviceId);
                    mainHandler.postDelayed(() -> enqueueSetSystemTimeCommand(deviceId, currentRetry + 1), 3000);
                } else {
                    Log.e(TAG, "❌ [TIME SYNC FAILED] Set System Time response not received after 2 attempts");
                    setTimeTimeoutTimers.remove(deviceId);
                    dataSyncState.put(deviceId, "time_sync_failed");
                    sendDataAcquisitionAndLiveNotifications(deviceId);
                }
            } else {
                setTimeTimeoutTimers.remove(deviceId);
            }
        }, 3, java.util.concurrent.TimeUnit.SECONDS);
        setTimeTimeoutTimers.put(deviceId, timeoutTimer);
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
        
        // Get expected record count from device status (remaining when continuing, full when fresh)
        int recordCount = deviceRecordCounts.getOrDefault(deviceId, 0);
        int grandTotalSoFar = syncGrandTotalReceived.getOrDefault(deviceId, 0);
        boolean isContinuation = (grandTotalSoFar > 0);
        
        // Initialize sync tracking counters (first attempt only, not on notification-enable retries)
        // Industry fix (Issue 2): Each history sync is a fresh session. Use current device recordCount only.
        // Do NOT reuse stale syncTotalRecords from previous sessions — that caused multiple DATA_SYNC_START
        // for 196 records (phantom "remaining" from old 500). Multi-START only within same session when
        // syncTotalRecords > 500 and syncGrandTotalReceived < syncTotalRecords.
        if (retryAttempt == 0 && !syncCommandActuallySent) {
            if (!isContinuation) {
                // Fresh sync: use manual requested count if set (startDataSyncWithRecordCount), else device recordCount.
                // Manual sync must be independent — e.g. "sync 5 records" → total=5, remaining=5, not device total (241).
                Integer manualCount = pendingSyncRecordCount.get(deviceId);
                int sessionTotal = (manualCount != null && manualCount > 0) ? Math.min(0x01F4, Math.max(1, manualCount)) : recordCount;
                syncTotalRecords.put(deviceId, sessionTotal);
                syncRecordsReceived.put(deviceId, 0);
                syncCurrentFileNumber.put(deviceId, 1);
                syncGrandTotalReceived.put(deviceId, 0);
                if (manualCount != null && manualCount > 0) {
                    Log.d(TAG, "📦 [MANUAL SYNC] Session total=" + sessionTotal + " (user requested, independent of device total " + recordCount + ")");
                } else {
                int expectedChunks = (recordCount + RECORDS_PER_FILE - 1) / RECORDS_PER_FILE;
                if (expectedChunks > 1) {
                    Log.d(TAG, "📦 [MULTI-FILE SYNC] Starting sync for " + deviceId + ": " + recordCount + " records across " + expectedChunks + " files");
                }
                }
            } else {
                // Next chunk (same session): only reset per-chunk counter; keep grandTotal and file number
                syncRecordsReceived.put(deviceId, 0);
                int totalExpected = syncTotalRecords.getOrDefault(deviceId, 0);
                Log.d(TAG, "📦 [MULTI-FILE SYNC] Continuing sync for " + deviceId + ": file #" + syncCurrentFileNumber.getOrDefault(deviceId, 1) + ", progress " + grandTotalSoFar + "/" + totalExpected);
            }
        }
        
        int currentFileNum = syncCurrentFileNumber.getOrDefault(deviceId, 1);
        
        // Log record count (for debugging)
        int totalExpectedForLog = syncTotalRecords.getOrDefault(deviceId, recordCount);
        if (recordCount == 0) {
            // No records - sync will complete immediately
            Log.d(TAG, "📊 [DATA SYNC] No records to sync for " + deviceId);
        } else {
            // Has records - expect data transfer
            Log.d(TAG, "📊 [DATA SYNC] Starting file #" + currentFileNum + " sync for " + deviceId + " (" + totalExpectedForLog + " total records, requesting " + RECORDS_PER_FILE + " this chunk)");
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
                // Send STOP so device can enable live notifications (every START must have a STOP)
                ensureDataSyncStopSent(deviceId);
                Log.w(TAG, "   Clearing sync state to allow new syncs");
                dataSyncState.put(deviceId, "idle");
                dataSyncRequested.put(deviceId, false);
                dataSyncRetryCount.remove(deviceId);
                syncCommandSentFlags.put(deviceId, false);  // Reset the sent flag
                // Clear sync progress maps so next sync starts clean
                syncRecordsReceived.remove(deviceId);
                syncTotalRecords.remove(deviceId);
                syncRemainingRecords.remove(deviceId);
                syncGrandTotalReceived.remove(deviceId);
                syncSingleChunkOnly.remove(deviceId);
                pendingSyncRecordCount.remove(deviceId);
                SyncLockState lockState = historySyncLock.remove(deviceId);
                if (lockState != null) {
                    Log.d(TAG, "🔓 [SYNC LOCK] Released on 60s timeout for " + deviceId);
                }
                // Notify JS so it transitions from history_sync to live (otherwise phase guard keeps blocking live data)
                final String timeoutDeviceId = deviceId;
                mainHandler.post(() -> {
                    WritableMap timeoutEvent = Arguments.createMap();
                    timeoutEvent.putString("deviceId", timeoutDeviceId);
                    timeoutEvent.putString("type", "sync_complete");
                    timeoutEvent.putBoolean("success", false);
                    timeoutEvent.putString("reason", "sync_timeout");
                    timeoutEvent.putInt("recordCount", 0);
                    timeoutEvent.putInt("recordsTransmitted", 0);
                    sendEvent("DeviceDataUpdated", timeoutEvent);
                });
            }
            dataSyncTimers.remove(deviceId);
        }, 60, TimeUnit.SECONDS);
        dataSyncTimers.put(deviceId, syncTimeoutTimer);
        
        // Mark sync as requested
        dataSyncRequested.put(deviceId, true);
        
        // Continuation chunk (file #2+): only wait for GATT queue idle, not "syncing" state (we stay "syncing" during multi-chunk).
        // First chunk: wait for both "syncing" and GATT queue so we don't overlap with other setup.
        int currentFileNumForBusyCheck = syncCurrentFileNumber.getOrDefault(deviceId, 1);
        boolean isContinuationChunk = (currentFileNumForBusyCheck > 1);
        boolean shouldWait = isContinuationChunk ? isGattQueueBusy(deviceId) : isGattBusyOrSyncActive(deviceId);
        if (shouldWait) {
            GattOperationQueue qBusy = gattQueues.get(deviceId);
            int pending = qBusy != null ? qBusy.queueSize() : -1;
            boolean inF = qBusy != null && qBusy.isInFlight();
            String opName = qBusy != null ? qBusy.getCurrentOpName() : "n/a";
            // Busy = pending queued ops OR 1 op in flight (waiting for BLE callback). So pending=0 can still be busy when inFlight=true.
            String reason = (pending > 0) ? ("pending=" + pending) : (inF ? "inFlight=1 (waiting for callback: " + opName + ")" : "busy");
            Log.w(TAG, "⚠️ [DATA SYNC START] GATT busy - waiting before sending command [" + reason + "]" + (isContinuationChunk ? " (continuation chunk)" : ""));
            mainHandler.postDelayed(() -> {
                sendDataSyncStartCommand(deviceId, retryAttempt);
            }, 500);
            return true;
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
        
        // Now we're ready to send the command - set state to "syncing"
        dataSyncState.put(deviceId, "syncing");
        
        // SDD: Default 500 records per DATA_SYNC_START. Manual sync (startDataSyncWithRecordCount) uses pendingSyncRecordCount.
        mainHandler.postDelayed(() -> {
            Integer pendingCount = pendingSyncRecordCount.remove(deviceId);
            int recordsToSync = (pendingCount != null && pendingCount > 0) ? Math.min(0x01F4, Math.max(1, pendingCount)) : RECORDS_PER_FILE;
            byte[] payload = new byte[]{
                (byte)(recordsToSync & 0xFF),
                (byte)((recordsToSync >> 8) & 0xFF)
            };
            Log.d(TAG, "📤 Queuing Data Sync Start to " + deviceId + " (attempt " + (retryAttempt + 1) + "/4, requesting " + recordsToSync + " records)");
            dataSyncStartRetryAttemptForQueue.put(deviceId, retryAttempt);
            sendSystemCommand(deviceId, CMD_DATA_SYNC_START, payload);
            executorService.schedule(() -> {
                boolean stillRequested = dataSyncRequested.getOrDefault(deviceId, false);
                String debugState = dataSyncState.getOrDefault(deviceId, "unknown");
                if (stillRequested && "syncing".equals(debugState)) {
                    Log.d(TAG, "   Firmware should send sync_start (0x01) after DATA_SYNC_START");
                }
            }, 5, TimeUnit.SECONDS);
        }, 200);
        return true;
    }
    
    /** Legacy path: DATA_SYNC_START now goes through system command queue; this is unused. */
    @SuppressWarnings("unused")
    private boolean sendDataSyncStartCommandInternal(String deviceId, int retryAttempt, BluetoothGattCharacteristic systemCommandChar, BluetoothGatt gatt) {
        byte[] payload = new byte[]{ (byte)(RECORDS_PER_FILE & 0xFF), (byte)((RECORDS_PER_FILE >> 8) & 0xFF) };
        dataSyncStartRetryAttemptForQueue.put(deviceId, retryAttempt);
        return sendSystemCommand(deviceId, CMD_DATA_SYNC_START, payload);
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

    /**
     * Manual sync with a specific record count (e.g. 50). Sends DATA_SYNC_START(count) and does NOT
     * auto-continue to the next chunk when the device has more records. Use for "Start Sync" with
     * user-entered limit.
     */
    @Override
    @ReactMethod
    public void startDataSyncWithRecordCount(String deviceId, double recordCount, Promise promise) {
        try {
            int count = Math.min(0x01F4, Math.max(1, (int) recordCount));
            Log.d(TAG, "📤 Data Sync Start (manual, " + count + " records) requested for " + deviceId);
            String currentState = dataSyncState.getOrDefault(deviceId, "idle");
            if ("syncing".equals(currentState) || "time_syncing".equals(currentState)) {
                Log.w(TAG, "⚠️ [SYNC GUARD] Sync already in progress for " + deviceId + " - rejecting");
                WritableMap result = Arguments.createMap();
                result.putString("status", "already_syncing");
                result.putString("message", "Data sync already in progress");
                result.putString("deviceId", deviceId);
                promise.resolve(result);
                return;
            }
            pendingSyncRecordCount.put(deviceId, count);
            syncSingleChunkOnly.put(deviceId, true);
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
                        result.putString("message", "Manual sync started (" + count + " records, time synced first)");
                        result.putString("deviceId", deviceId);
                        result.putInt("recordCount", count);
                        result.putBoolean("timeSyncRequired", true);
                        promise.resolve(result);
                    } else {
                        pendingSyncRecordCount.remove(deviceId);
                        syncSingleChunkOnly.remove(deviceId);
                        dataSyncRequested.put(deviceId, false);
                        promise.reject("SYNC_START_ERROR", "Failed to send data sync start command after time sync");
                    }
                }, 6, TimeUnit.SECONDS);
            } else {
                dataSyncRequested.put(deviceId, true);
                boolean success = sendDataSyncStartCommand(deviceId, 0);
                if (success) {
                    WritableMap result = Arguments.createMap();
                    result.putString("status", "success");
                    result.putString("message", "Manual sync started (" + count + " records)");
                    result.putString("deviceId", deviceId);
                    result.putInt("recordCount", count);
                    result.putBoolean("timeSyncRequired", false);
                    promise.resolve(result);
                } else {
                    pendingSyncRecordCount.remove(deviceId);
                    syncSingleChunkOnly.remove(deviceId);
                    dataSyncRequested.put(deviceId, false);
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
            enqueueReadCharacteristicOp(deviceId, gatt, deviceStatusChar, "readDeviceStatus");
            WritableMap result = Arguments.createMap();
            result.putString("status", "success");
            result.putString("message", "Reading device status");
            result.putString("deviceId", deviceId);
            promise.resolve(result);
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
            if (isGattBusyOrSyncActive(deviceId)) {
                Log.d(TAG, "⏸️ [GATT QUEUE] Skipping readDeviceRSSI for " + deviceId + " — sync active or GATT queue busy");
                promise.reject("GATT_BUSY", "RSSI read skipped: sync in progress or GATT queue busy");
                return;
            }
            pendingRSSIPromises.put(deviceId, promise);
            try {
                enqueueGattOp(deviceId, () -> {
                    pendingGattComplete.put(deviceId, (status) -> {
                        advanceGattQueue(deviceId);
                    });
                    boolean success = gatt.readRemoteRssi();
                    if (!success) {
                        pendingGattComplete.remove(deviceId);
                        advanceGattQueue(deviceId);
                        Promise p = pendingRSSIPromises.remove(deviceId);
                        if (p != null) {
                            p.reject("RSSI_ERROR", "Failed to request RSSI reading");
                        }
                    }
                });
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
                        if (isGattBusyOrSyncActive(deviceId)) {
                            return; // skip this tick — sync active or GATT queue busy
                        }
                        BluetoothGatt gatt = connectedGatts.get(deviceId);
                        if (gatt != null) {
                            try {
                                enqueueGattOp(deviceId, () -> {
                                    pendingGattComplete.put(deviceId, (status) -> {
                                        advanceGattQueue(deviceId);
                                    });
                                    gatt.readRemoteRssi();
                                });
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
        try {
            if (bondedDeviceIds.isEmpty()) {
                Log.d(TAG, "⏸️ Auto-connect start skipped: no bonded devices");
                promise.resolve(true);
                return;
            }
            if (autoConnectEnabled) {
                Log.d(TAG, "✅ Auto-connect already enabled");
                promise.resolve(true);
                return;
            }
            autoConnectEnabled = true;
            syncSystemBondedDevices();
            mainHandler.postDelayed(() -> {
                restoreExistingConnections();
                if (!allBondedDevicesConnectedOrConnecting()) {
                    startScanningForBondedDevices();
                }
                mainHandler.postDelayed(autoConnectReconnectRunnable, AUTO_CONNECT_SCAN_INTERVAL_MS);
            }, 500);
            Log.d(TAG, "✅ Auto-connect started (restore + periodic scan every " + (AUTO_CONNECT_SCAN_INTERVAL_MS / 1000) + "s)");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ startAutoConnect error: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void stopAutoConnect(Promise promise) {
        try {
            autoConnectEnabled = false;
            mainHandler.removeCallbacks(autoConnectReconnectRunnable);
            if (isScanning.get()) {
                stopScanning();
            }
            Log.d(TAG, "🛑 Auto-connect stopped");
            promise.resolve(true);
        } catch (Exception e) {
            Log.e(TAG, "❌ stopAutoConnect error: " + e.getMessage());
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void getAutoConnectStatus(Promise promise) {
        try {
            WritableMap result = Arguments.createMap();
            result.putBoolean("enabled", autoConnectEnabled);
            result.putBoolean("serviceRunning", isServiceRunning && bleService != null);
            result.putInt("connectedDevices", connectedGatts.size());
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("AUTO_CONNECT_ERROR", e.getMessage());
        }
    }
    @ReactMethod
    public void addBondedDevice(String deviceId, Promise promise) {
        try {
            Log.d(TAG, "🔗 Adding device to bonded list: " + deviceId);
            bondedDeviceIds.add(deviceId);
            if (bluetoothAdapter != null && !bondedDevices.containsKey(deviceId)) {
                try {
                    bondedDevices.put(deviceId, bluetoothAdapter.getRemoteDevice(deviceId));
                } catch (Exception e) {
                    Log.w(TAG, "⚠️ getRemoteDevice for addBondedDevice: " + e.getMessage());
                }
            }
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
                    failGattQueueOnDisconnect(deviceId);
                    connectedGatts.remove(deviceId);
                    cleanupDeviceResources(deviceId);
                }
            }
            if (deviceData != null) {
                // ✅ connectionState managed by BLEConnectionManager
                deviceDataMap.put(deviceId, deviceData);
                if (wasConnected) {
                    WritableMap disconnectInfo = createDeviceInfoMap(deviceData);
                    disconnectInfo.putString("reason", "forgotten");
                    disconnectInfo.putBoolean("forgotten", true);
                    sendEvent("DeviceDisconnected", disconnectInfo);
                }
            }
            bondedDeviceIds.remove(deviceId);
            bondedDevices.remove(deviceId);
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
                    
                    // ════════════════════════════════════════════════════════════════════════════
                    // ✅ REFACTORED: Use BLEConnectionManager for disconnection
                    // This ensures proper disconnection flow and state tracking
                    // ════════════════════════════════════════════════════════════════════════════
                    Log.d(TAG, "🔌 [BLEConnectionManager] Using connection manager for disconnect: " + deviceId);
                    connectionManager.disconnectDevice(deviceId, gatt);
                    
                    // Clean up pending operations
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
                    }
                    
                    WritableMap result = Arguments.createMap();
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
                    // ════════════════════════════════════════════════════════════════════════════
                    // ✅ REFACTORED: Use BLEConnectionManager for disconnection
                    // This ensures proper disconnection flow and state tracking
                    // ════════════════════════════════════════════════════════════════════════════
                    Log.d(TAG, "🔌 [BLEConnectionManager] Using connection manager for disconnect (native): " + deviceId);
                    connectionManager.disconnectDevice(deviceId, gatt);
                    
                    // Clean up local state (GATT will be removed in disconnection callback)
                    systemCommandsSent.remove(deviceId);
                    dataSyncState.remove(deviceId);

                    Log.d(TAG, "🔌 Device disconnection initiated from native: " + deviceId);
                    WritableMap result = Arguments.createMap();
                    result.putBoolean("success", true);
                    result.putString("message", "Device disconnection initiated from native Android");
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
            // Industry rule: During sync only DATA_SYNC_START/STOP + notifications. No RSSI reads.
            if (isGattBusyOrSyncActive(deviceId)) {
                Log.d(TAG, "⏸️ [GATT QUEUE] Skipping readRSSI for " + deviceId + " — sync active or GATT queue busy");
                promise.reject("GATT_BUSY", "RSSI read skipped: sync in progress or GATT queue busy");
                return;
            }
            String promiseKey = "rssi_" + deviceId;
            pendingRSSIPromises.put(promiseKey, promise);
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (status) -> {
                    advanceGattQueue(deviceId);
                });
                boolean readSuccess = gatt.readRemoteRssi();
                if (!readSuccess) {
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                    Promise p = pendingRSSIPromises.remove(promiseKey);
                    if (p != null) {
                        p.reject("RSSI_READ_FAILED", "Failed to initiate RSSI read");
                    }
                }
            });
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
            // Route through per-device queue (no direct gatt.discoverServices outside queue)
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                boolean discoverSuccess = gatt.discoverServices();
                if (!discoverSuccess) {
                    pendingServiceDiscoveryPromises.remove(promiseKey);
                    if (timeoutTask != null) {
                        timeoutTask.cancel(false);
                    }
                    serviceDiscoveryTimeouts.remove(deviceId);
                    promise.reject("SERVICE_DISCOVERY_FAILED", "Failed to initiate service discovery");
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "❌ Error discovering services: " + e.getMessage(), e);
            promise.reject("SERVICE_DISCOVERY_ERROR", "Failed to discover services: " + e.getMessage());
        }
    }
    @ReactMethod
    public void getManufacturerInfo(Promise promise) {
        try {
            int mfgId = BLEClientConfigHolder.get().getManufacturerId();
            WritableMap result = Arguments.createMap();
            result.putInt("manufacturerId", mfgId);
            result.putString("manufacturerIdHex", String.format("0x%04X", mfgId));
            result.putString("manufacturerIdLittleEndian",
                String.format("0x%02X%02X", mfgId & 0xFF, (mfgId >> 8) & 0xFF));
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
            status.putBoolean("autoConnectEnabled", autoConnectEnabled);
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
        // Route initiation through per-device queue (no direct gatt.readCharacteristic outside queue)
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
            boolean success = gatt.readCharacteristic(characteristic);
            if (!success) {
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
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
        });
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
        // Route initiation through per-device queue (no direct gatt.readCharacteristic outside queue)
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
            boolean success = gatt.readCharacteristic(characteristic);
            if (!success) {
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
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
        });
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
        // Route initiation through per-device queue (no direct gatt.writeDescriptor outside queue)
        enqueueGattOp(deviceId, () -> {
            pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
            boolean success = gatt.writeDescriptor(descriptor);
            if (!success) {
                pendingGattComplete.remove(deviceId);
                advanceGattQueue(deviceId);
                pendingDescriptorPromises.remove(deviceId + "_" + descriptorUUID);
                promise.reject("WRITE_FAILED", "Failed to initiate write for descriptor " + descriptorUUID);
            }
        });
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
            // Route CCCD write through per-device queue
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                boolean ok = gatt.writeDescriptor(cccdDescriptor);
                if (!ok) {
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                }
            });
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
            // Route CCCD write through per-device queue
            enqueueGattOp(deviceId, () -> {
                pendingGattComplete.put(deviceId, (st) -> advanceGattQueue(deviceId));
                boolean ok = gatt.writeDescriptor(cccdDescriptor);
                if (!ok) {
                    pendingGattComplete.remove(deviceId);
                    advanceGattQueue(deviceId);
                }
            });
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
    // MCUboot DFU over SMP (McuMgr) - Zephyr / nRF Connect style (not Nordic Secure DFU)
    // Flow aligned with nRF Connect app: disconnect only after full DFU complete (device reset).
    // ============================================================================
    
    /**
     * Start MCUboot DFU over SMP. Matches nRF Connect app flow step-by-step:
     * 1. Release app BLE connection (so only one central connection; peripheral accepts single link).
     * 2. McuMgr connects → discovers SMP service → enables notifications → device ready.
     * 3. Request McuMgr params / bootloader info (optional; may be "not supported").
     * 4. Validate (image state / list).
     * 5. Upload image (or skip if already in slot).
     * 6. Confirm image.
     * 7. Reset device.
     * 8. Disconnect happens only after step 7 — when device reboots (connection drops). We do not
     *    disconnect earlier; the library sends Reset and the link goes away when the device resets.
     *
     * Device must expose SMP service 8D53DC1D-... and characteristic DA2E7828-... (McuMgr transport).
     *
     * @param deviceId   BLE MAC address
     * @param firmwarePath File path (file://...) or content URI to a .bin image
     * @param promise   Resolves when DFU start is initiated; progress via events
     */
    /** Requests HIGH connection priority for DFU (nRF Connect does this — critical for avoiding timeouts).
     * Uses McuMgrBleTransport.requestConnPriority() which calls BleManager.requestConnectionPriority()
     * on the correct GATT — switches interval from ~360ms to ~15ms for fast SMP throughput. */
    private void requestMcuMgrConnectionPriorityHigh(McuMgrBleTransport transport) {
        try {
            transport.requestConnPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH);
            Log.i(TAG, "📤 [McuMgr DFU] Requested connection priority HIGH (interval ~15ms, latency 0) — same as nRF Connect");
        } catch (Exception e) {
            Log.w(TAG, "⚠️ [McuMgr DFU] Could not request HIGH priority: " + (e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName()));
        }
    }
    
    /** Sends CMD_SET_CONN_INTERVAL to firmware before DFU (15ms for fast SMP).
     * Uses GATT queue (not direct write) because direct write fails when queue has pending ops (GATT busy).
     * Waits 2.5s for queue to process existing ops + this command before we disconnect. */
    private void sendSetConnIntervalBeforeDfu(String deviceId, int intervalMs) {
        byte[] payload = new byte[4];
        payload[0] = (byte) (intervalMs & 0xFF);
        payload[1] = (byte) ((intervalMs >> 8) & 0xFF);
        payload[2] = (byte) ((intervalMs >> 16) & 0xFF);
        payload[3] = (byte) ((intervalMs >> 24) & 0xFF);
        boolean queued = sendSystemCommand(deviceId, CMD_SET_CONN_INTERVAL, payload);
        Log.i(TAG, "📤 [McuMgr DFU] CMD_SET_CONN_INTERVAL(" + intervalMs + "ms) " + (queued ? "queued" : "failed (not connected?)") + " — waiting 2.5s for queue to drain before disconnect");
        try { Thread.sleep(2500); } catch (InterruptedException ignored) {}
    }

    @ReactMethod
    public void startMcuMgrDfu(String deviceId, String firmwarePath, Promise promise) {
        if (currentMcuMgrDfuDeviceId != null) {
            promise.reject("DFU_IN_PROGRESS", "A DFU is already in progress for " + currentMcuMgrDfuDeviceId);
            return;
        }
        executeOnBLEThread(() -> {
            try {
                // Set immediately so restoreExistingConnections and any other path skip this device during DFU
                currentMcuMgrDfuDeviceId = deviceId;
                BluetoothAdapter adapter = bluetoothAdapter;
                if (adapter == null) {
                    currentMcuMgrDfuDeviceId = null;
                    promise.reject("BLUETOOTH_UNAVAILABLE", "Bluetooth not available");
                    return;
                }
                // Step 0: Tell firmware to use 15ms connection interval for fast SMP (same as nRF Connect).
                // McuMgr will connect with this faster interval — avoids McuMgrTimeoutException.
                Log.i(TAG, "📤 [McuMgr DFU] Step 0: Sending CMD_SET_CONN_INTERVAL(15ms) so McuMgr connects with fast interval");
                sendSetConnIntervalBeforeDfu(deviceId, 15);
                // Step 1 (nRF-aligned): Release app BLE connection so McuMgr can have the only link.
                // We do NOT disconnect at the end — disconnect happens only when device resets after Reset command.
                Log.i(TAG, "📤 [McuMgr DFU] Step 1: Releasing app connection so DFU can use the link (disconnect only after full DFU + device reset)");
                synchronized (gattLock) {
                    BluetoothGatt gatt = connectedGatts.get(deviceId);
                    if (gatt != null) {
                        connectionManager.disconnectDevice(deviceId, gatt);
                        connectedGatts.remove(deviceId);
                    }
                }
                mainHandler.post(() -> {
                    // Notify JS so UI shows "Disconnected" immediately (connection manager callback may not emit)
                    DeviceData deviceData = deviceDataMap.get(deviceId);
                    if (deviceData != null) {
                        WritableMap map = createDeviceInfoMap(deviceData);
                        map.putString("connectionState", "disconnected");
                        map.putString("reason", "released_for_dfu");
                        sendEvent("DeviceDisconnected", map);
                        Log.d(TAG, "📢 [McuMgr DFU] Sent DeviceDisconnected so UI updates (released for DFU)");
                    }
                    failGattQueueOnDisconnect(deviceId);
                    cleanupDeviceResources(deviceId);
                    Log.d(TAG, "🧹 [McuMgr DFU] Cleared GATT queue and resources for " + deviceId);
                });
                connectionManager.cancelDisconnectTimeout(deviceId);
                Log.d(TAG, "📤 [McuMgr DFU] Step 2: Waiting 5s for link release and any in-flight connection to settle (align with nRF behavior)...");
                try { Thread.sleep(5000); } catch (InterruptedException ignored) {}
                Log.d(TAG, "📤 [McuMgr DFU] Step 3: Creating transport, reading firmware (McuMgr will connect → discover SMP → validate → upload → confirm → reset; disconnect when device reboots)");
                BluetoothDevice device = adapter.getRemoteDevice(deviceId);
                byte[] imageData = readFirmwareFileBytes(firmwarePath);
                if (imageData == null || imageData.length == 0) {
                    currentMcuMgrDfuDeviceId = null;
                    promise.reject("INVALID_FIRMWARE", "Could not read firmware file: " + firmwarePath);
                    return;
                }
                final int imageSizeBytes = imageData.length;
                final long dfuStartTimeMs = System.currentTimeMillis();
                // Per Nordic Android-nRF-Connect-Device-Manager: setEstimatedSwapTime, setWindowCapacity (1 = one
                // request at a time, more reliable; 2+ needs MCUMGR_BUF_COUNT on device).
                final FirmwareUpgradeManager.Settings settings = new FirmwareUpgradeManager.Settings.Builder()
                    .setEstimatedSwapTime(7000)
                    .setWindowCapacity(1)
                    .build();
                // Multiple retries on transaction timeout (Nordic issue #58: retrying often succeeds)
                final int[] dfuRetryCount = {0};
                final int maxDfuRetries = 3;
                final Runnable[] startUploadRef = new Runnable[1];
                startUploadRef[0] = new Runnable() {
                    @Override
                    public void run() {
                        Log.i(TAG, "📤 [McuMgr DFU] Starting upload: device=" + deviceId + " imageSize=" + imageSizeBytes + " bytes (" + (imageSizeBytes / 1024) + " KB) windowCapacity=1 (attempt " + (dfuRetryCount[0] + 1) + ")");
                        McuMgrBleTransport tr = new McuMgrBleTransport(getReactApplicationContext(), device);
                        FirmwareUpgradeCallback<FirmwareUpgradeManager.State> cb = new FirmwareUpgradeCallback<FirmwareUpgradeManager.State>() {
                            private int lastLoggedPercent = -1;
                            @Override
                            public void onUpgradeStarted(FirmwareUpgradeController controller) {
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                Log.i(TAG, "📤 [McuMgr DFU] onUpgradeStarted (elapsed " + elapsed + " ms)");
                                // NOTE: Don't request HIGH here — connection isn't established yet (connect happens after)
                                sendDfuStateEvent(deviceId, "STARTED", 0);
                            }
                            @Override
                            public void onStateChanged(FirmwareUpgradeManager.State previous, FirmwareUpgradeManager.State current) {
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                Log.i(TAG, "📤 [McuMgr DFU] State " + (previous != null ? previous.name() : "?") + " -> " + current.name() + " (elapsed " + elapsed + " ms)");
                                if (current == FirmwareUpgradeManager.State.VALIDATE || current == FirmwareUpgradeManager.State.UPLOAD) {
                                    // nRF Connect requests HIGH before image list — request as soon as VALIDATE (connected) so
                                    // params have time to update before upload. Connection param update is async (~5–8s).
                                    requestMcuMgrConnectionPriorityHigh(tr);
                                }
                                if (current == FirmwareUpgradeManager.State.RESET) {
                                    Log.i(TAG, "📤 [McuMgr DFU] Reset sent; disconnect will happen when device reboots (nRF-aligned)");
                                }
                                sendDfuStateEvent(deviceId, current.name(), 0);
                            }
                            @Override
                            public void onUploadProgressChanged(int current, int total, long timestamp) {
                                int percent = total > 0 ? (int) (100 * current / total) : 0;
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                if (percent >= lastLoggedPercent + 5 || percent == 0 || percent == 100) {
                                    lastLoggedPercent = percent;
                                    Log.i(TAG, "📤 [McuMgr DFU] progress " + percent + "% (" + current + "/" + total + " bytes) elapsed " + elapsed + " ms");
                                }
                                sendDfuProgressEvent(deviceId, percent, current, total);
                            }
                            @Override
                            public void onUpgradeCompleted() {
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                Log.i(TAG, "✅ [McuMgr DFU] Upgrade complete (elapsed " + elapsed + " ms); Reset sent — disconnect when device reboots (nRF-aligned)");
                                sendDfuStateEvent(deviceId, "COMPLETED", 100);
                                currentMcuMgrDfuDeviceId = null;
                                mcuMgrDfuManager = null;
                            }
                            @Override
                            public void onUpgradeFailed(FirmwareUpgradeManager.State state, McuMgrException error) {
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                String errMsg = error != null ? error.getMessage() : "";
                                String errClass = error != null ? error.getClass().getSimpleName() : "UNKNOWN";
                                boolean isTimeout = errMsg != null && errMsg.toLowerCase().contains("timed out");
                                Log.e(TAG, "❌ [McuMgr DFU] onUpgradeFailed state=" + (state != null ? state.name() : "null") + " error=" + errClass + " msg=" + errMsg + " (elapsed " + elapsed + " ms, last progress " + lastLoggedPercent + "%)");
                                if (isTimeout && dfuRetryCount[0] < maxDfuRetries) {
                                    dfuRetryCount[0]++;
                                    mcuMgrDfuManager = null;
                                    final int retryDelaySec = 5;
                                    Log.i(TAG, "🔄 [McuMgr DFU] Transaction timeout — automatic retry " + dfuRetryCount[0] + "/" + maxDfuRetries + " in " + retryDelaySec + "s (nRF issue #58: retry often succeeds)");
                                    if (bleHandler != null) {
                                        bleHandler.postDelayed(startUploadRef[0], retryDelaySec * 1000L);
                                    } else {
                                        executorService.schedule(startUploadRef[0], retryDelaySec, java.util.concurrent.TimeUnit.SECONDS);
                                    }
                                    return;
                                }
                                sendDfuErrorEvent(deviceId, errClass, errMsg);
                                currentMcuMgrDfuDeviceId = null;
                                mcuMgrDfuManager = null;
                                // Mark device to restore 360ms interval when we reconnect (DFU failed; firmware stayed at 15ms)
                                dfuFailedNeedsConnIntervalRestore.add(deviceId);
                                Log.i(TAG, "📤 [McuMgr DFU] Added " + deviceId + " to dfuFailedNeedsConnIntervalRestore (will send 360ms on reconnect)");
                            }
                            @Override
                            public void onUpgradeCanceled(FirmwareUpgradeManager.State state) {
                                long elapsed = System.currentTimeMillis() - dfuStartTimeMs;
                                Log.w(TAG, "⚠️ [McuMgr DFU] onUpgradeCanceled state=" + (state != null ? state.name() : "null") + " (elapsed " + elapsed + " ms)");
                                sendDfuStateEvent(deviceId, "CANCELED", 0);
                                currentMcuMgrDfuDeviceId = null;
                                mcuMgrDfuManager = null;
                                dfuFailedNeedsConnIntervalRestore.add(deviceId);
                            }
                        };
                        mcuMgrDfuManager = new FirmwareUpgradeManager(tr, cb);
                        mcuMgrDfuManager.setMode(FirmwareUpgradeManager.Mode.CONFIRM_ONLY);
                        try {
                            mcuMgrDfuManager.start(imageData, settings);
                        } catch (McuMgrException e) {
                            Log.e(TAG, "❌ [McuMgr DFU] start() threw", e);
                            sendDfuErrorEvent(deviceId, e.getClass().getSimpleName(), e.getMessage());
                            currentMcuMgrDfuDeviceId = null;
                            mcuMgrDfuManager = null;
                        }
                    }
                };
                Log.i(TAG, "📤 [McuMgr DFU] Calling FirmwareUpgradeManager.start() now (McuMgr will connect and then upload)");
                startUploadRef[0].run();
                long postStartMs = System.currentTimeMillis() - dfuStartTimeMs;
                Log.d(TAG, "📤 [McuMgr DFU] start() returned (took " + postStartMs + " ms); progress will come via callbacks");
                WritableMap result = Arguments.createMap();
                result.putString("status", "started");
                result.putString("deviceId", deviceId);
                result.putString("firmwarePath", firmwarePath);
                result.putInt("imageSize", imageData.length);
                promise.resolve(result);
            } catch (Exception e) {
                Log.e(TAG, "❌ [McuMgr DFU] start failed", e);
                currentMcuMgrDfuDeviceId = null;
                mcuMgrDfuManager = null;
                promise.reject("DFU_START_ERROR", e.getMessage());
            }
        });
    }
    
    /**
     * Cancel ongoing McuMgr DFU.
     */
    @ReactMethod
    public void cancelMcuMgrDfu(Promise promise) {
        try {
            if (mcuMgrDfuManager == null) {
                promise.reject("NO_DFU_IN_PROGRESS", "No DFU in progress");
                return;
            }
            mcuMgrDfuManager.cancel();
            WritableMap result = Arguments.createMap();
            result.putString("status", "cancelled");
            result.putString("deviceId", currentMcuMgrDfuDeviceId);
            promise.resolve(result);
        } catch (Exception e) {
            promise.reject("DFU_CANCEL_ERROR", e.getMessage());
        }
    }
    
    /**
     * Read firmware file into byte array. Supports file:// and content:// URIs.
     */
    private byte[] readFirmwareFileBytes(String path) {
        if (path == null || path.isEmpty()) return null;
        try {
            Uri uri = path.startsWith("file://") ? Uri.parse(path) : Uri.parse(path);
            InputStream is;
            if ("file".equals(uri.getScheme())) {
                String filePath = uri.getPath();
                if (filePath == null) return null;
                File f = new File(filePath);
                if (!f.exists()) return null;
                is = new FileInputStream(f);
            } else {
                is = getReactApplicationContext().getContentResolver().openInputStream(uri);
            }
            if (is == null) return null;
            java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            is.close();
            return bos.toByteArray();
        } catch (Exception e) {
            Log.e(TAG, "❌ [McuMgr DFU] read firmware file failed: " + e.getMessage());
            return null;
        }
    }
    
    private void sendDfuStateEvent(String deviceId, String state, int progress) {
        WritableMap params = Arguments.createMap();
        params.putString("deviceId", deviceId);
        params.putString("state", state);
        params.putInt("progress", progress);
        sendEvent("DFUStateChanged", params);
    }
    
    private void sendDfuProgressEvent(String deviceId, int progress, int current, int total) {
        WritableMap params = Arguments.createMap();
        params.putString("deviceId", deviceId);
        params.putInt("progress", progress);
        params.putInt("current", current);
        params.putInt("total", total);
        sendEvent("DFUProgress", params);
    }
    
    private void sendDfuErrorEvent(String deviceId, String errorCode, String message) {
        WritableMap params = Arguments.createMap();
        params.putString("deviceId", deviceId);
        params.putString("errorCode", errorCode != null ? errorCode : "UNKNOWN");
        params.putString("message", message != null ? message : "");
        sendEvent("DFUError", params);
    }

    // ============================================================================
    // TurboModule required: event emitter lifecycle stubs
    // ============================================================================

    @Override
    @ReactMethod
    public void addListener(String eventName) {
        // No-op: Android events are emitted via DeviceEventManagerModule, not tracked here
    }

    @Override
    @ReactMethod
    public void removeListeners(double count) {
        // No-op: see addListener
    }

    // ============================================================================
    // TurboModule required: platform-specific stubs for cross-platform spec
    // ============================================================================

    @ReactMethod
    public void forceScanForBondedDevices(Promise promise) {
        // Android: no-op (auto-connect uses startAutoConnect/scanning internally)
        WritableMap result = Arguments.createMap();
        result.putBoolean("success", true);
        promise.resolve(result);
    }

    @ReactMethod
    public void openBluetoothSettings(Promise promise) {
        try {
            Intent intent = new Intent(android.provider.Settings.ACTION_BLUETOOTH_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getReactApplicationContext().startActivity(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("SETTINGS_ERROR", e.getMessage());
        }
    }
}
