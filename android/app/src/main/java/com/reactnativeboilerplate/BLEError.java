package com.reactnativeboilerplate;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;

/**
 * Structured error handling for BLE operations
 * Based on React Native BLE PLX error management patterns
 */
public class BLEError {
    
    public enum ErrorCode {
        // Bluetooth Manager Errors
        BLUETOOTH_MANAGER_DESTROYED(100, "BluetoothManager has been destroyed"),
        BLUETOOTH_STATE_CHANGE_FAILED(101, "Failed to change Bluetooth adapter state"),
        BLUETOOTH_UNAUTHORIZED(102, "Bluetooth operation not authorized"),
        
        // Device Errors
        DEVICE_NOT_FOUND(200, "Device not found"),
        DEVICE_NOT_CONNECTED(201, "Device not connected"),
        DEVICE_SERVICES_NOT_DISCOVERED(202, "Device services not discovered"),
        DEVICE_CONNECTION_FAILED(203, "Device connection failed"),
        
        // Service Errors
        SERVICE_NOT_FOUND(300, "Service not found"),
        SERVICE_DISCOVERY_FAILED(301, "Service discovery failed"),
        
        // Characteristic Errors
        CHARACTERISTIC_NOT_FOUND(400, "Characteristic not found"),
        CHARACTERISTIC_READ_FAILED(401, "Characteristic read failed"),
        CHARACTERISTIC_WRITE_FAILED(402, "Characteristic write failed"),
        CHARACTERISTIC_NOT_READABLE(403, "Characteristic is not readable"),
        CHARACTERISTIC_NOT_WRITABLE(404, "Characteristic is not writable"),
        
        // Descriptor Errors
        DESCRIPTOR_NOT_FOUND(500, "Descriptor not found"),
        DESCRIPTOR_READ_FAILED(501, "Descriptor read failed"),
        DESCRIPTOR_WRITE_FAILED(502, "Descriptor write failed"),
        DESCRIPTOR_WRITE_NOT_ALLOWED(503, "Descriptor write not allowed"),
        
        // Operation Errors
        OPERATION_TIMEOUT(600, "Operation timed out"),
        OPERATION_CANCELLED(601, "Operation was cancelled"),
        OPERATION_FAILED(602, "Operation failed"),
        INVALID_WRITE_DATA(603, "Invalid write data"),
        INVALID_IDENTIFIERS(604, "Invalid identifiers"),
        
        // Permission Errors
        PERMISSION_DENIED(700, "Permission denied"),
        LOCATION_PERMISSION_REQUIRED(701, "Location permission required"),
        BLUETOOTH_PERMISSION_REQUIRED(702, "Bluetooth permission required"),
        
        // System Errors
        SYSTEM_ERROR(800, "System error"),
        UNKNOWN_ERROR(999, "Unknown error");
        
        public final int code;
        public final String defaultMessage;
        
        ErrorCode(int code, String defaultMessage) {
            this.code = code;
            this.defaultMessage = defaultMessage;
        }
    }
    
    public ErrorCode errorCode;
    public Integer androidCode;
    public String reason;
    public String deviceID;
    public String serviceUUID;
    public String characteristicUUID;
    public String descriptorUUID;
    public String internalMessage;
    
    public BLEError(ErrorCode errorCode, String reason, String internalMessage) {
        this.errorCode = errorCode;
        this.reason = reason;
        this.internalMessage = internalMessage;
    }
    
    public BLEError(ErrorCode errorCode, String reason, String internalMessage, String deviceID) {
        this.errorCode = errorCode;
        this.reason = reason;
        this.internalMessage = internalMessage;
        this.deviceID = deviceID;
    }
    
    public BLEError(ErrorCode errorCode, String reason, String internalMessage, String deviceID, String serviceUUID, String characteristicUUID) {
        this.errorCode = errorCode;
        this.reason = reason;
        this.internalMessage = internalMessage;
        this.deviceID = deviceID;
        this.serviceUUID = serviceUUID;
        this.characteristicUUID = characteristicUUID;
    }
    
    /**
     * Convert BLEError to JavaScript-readable format
     */
    public WritableMap toJSObject() {
        WritableMap errorMap = Arguments.createMap();
        errorMap.putInt("errorCode", errorCode.code);
        errorMap.putString("errorName", errorCode.name());
        errorMap.putString("reason", reason != null ? reason : errorCode.defaultMessage);
        errorMap.putString("internalMessage", internalMessage);
        
        // Add context information
        if (deviceID != null) {
            errorMap.putString("deviceID", deviceID);
        }
        if (serviceUUID != null) {
            errorMap.putString("serviceUUID", serviceUUID);
        }
        if (characteristicUUID != null) {
            errorMap.putString("characteristicUUID", characteristicUUID);
        }
        if (descriptorUUID != null) {
            errorMap.putString("descriptorUUID", descriptorUUID);
        }
        if (androidCode != null) {
            errorMap.putInt("androidCode", androidCode);
        }
        
        return errorMap;
    }
    
    /**
     * Convert BLEError to JavaScript error string
     */
    public String toJSString() {
        StringBuilder sb = new StringBuilder();
        sb.append("{");
        sb.append("\"errorCode\":").append(errorCode.code);
        sb.append(",\"errorName\":\"").append(errorCode.name()).append("\"");
        sb.append(",\"reason\":\"").append(reason != null ? reason : errorCode.defaultMessage).append("\"");
        
        if (internalMessage != null) {
            sb.append(",\"internalMessage\":\"").append(internalMessage).append("\"");
        }
        if (deviceID != null) {
            sb.append(",\"deviceID\":\"").append(deviceID).append("\"");
        }
        if (serviceUUID != null) {
            sb.append(",\"serviceUUID\":\"").append(serviceUUID).append("\"");
        }
        if (characteristicUUID != null) {
            sb.append(",\"characteristicUUID\":\"").append(characteristicUUID).append("\"");
        }
        if (descriptorUUID != null) {
            sb.append(",\"descriptorUUID\":\"").append(descriptorUUID).append("\"");
        }
        if (androidCode != null) {
            sb.append(",\"androidCode\":").append(androidCode);
        }
        
        sb.append("}");
        return sb.toString();
    }
    
    @Override
    public String toString() {
        return "BLEError{" +
                "errorCode=" + errorCode +
                ", reason='" + reason + '\'' +
                ", deviceID='" + deviceID + '\'' +
                ", serviceUUID='" + serviceUUID + '\'' +
                ", characteristicUUID='" + characteristicUUID + '\'' +
                ", internalMessage='" + internalMessage + '\'' +
                '}';
    }
    
    // Static factory methods for common errors
    public static BLEError bluetoothManagerDestroyed() {
        return new BLEError(ErrorCode.BLUETOOTH_MANAGER_DESTROYED, 
                           "BLEManager has been destroyed", 
                           "BLEManager cannot perform operations because it has been destroyed");
    }
    
    public static BLEError deviceNotFound(String deviceId) {
        return new BLEError(ErrorCode.DEVICE_NOT_FOUND, 
                           "Device not found", 
                           "Device with ID " + deviceId + " was not found", 
                           deviceId);
    }
    
    public static BLEError deviceNotConnected(String deviceId) {
        return new BLEError(ErrorCode.DEVICE_NOT_CONNECTED, 
                           "Device not connected", 
                           "Device " + deviceId + " is not connected", 
                           deviceId);
    }
    
    public static BLEError characteristicNotFound(String characteristicUuid, String deviceId) {
        return new BLEError(ErrorCode.CHARACTERISTIC_NOT_FOUND, 
                           "Characteristic not found", 
                           "Characteristic " + characteristicUuid + " not found on device " + deviceId, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError operationTimeout(String operation, String deviceId) {
        return new BLEError(ErrorCode.OPERATION_TIMEOUT, 
                           "Operation timed out", 
                           operation + " operation timed out for device " + deviceId, 
                           deviceId);
    }
    
    public static BLEError operationCancelled(String operation, String deviceId) {
        return new BLEError(ErrorCode.OPERATION_CANCELLED, 
                           "Operation cancelled", 
                           operation + " operation was cancelled for device " + deviceId, 
                           deviceId);
    }
    
    public static BLEError permissionDenied(String permission) {
        return new BLEError(ErrorCode.PERMISSION_DENIED, 
                           "Permission denied", 
                           "Required permission " + permission + " was denied");
    }
    
    public static BLEError invalidWriteData(String data, String characteristicUuid) {
        return new BLEError(ErrorCode.INVALID_WRITE_DATA, 
                           "Invalid write data", 
                           "Invalid write data format: " + data + " for characteristic " + characteristicUuid, 
                           null, null, characteristicUuid);
    }
    
    // Additional factory methods based on BLE PLX patterns
    
    public static BLEError cancelled() {
        return new BLEError(ErrorCode.OPERATION_CANCELLED, 
                           "Operation cancelled", 
                           "Operation was cancelled by user or system");
    }
    
    public static BLEError invalidIdentifiers(String... identifiers) {
        StringBuilder identifiersJoined = new StringBuilder();
        for (String identifier : identifiers) {
            identifiersJoined.append(identifier).append(", ");
        }
        
        BLEError bleError = new BLEError(ErrorCode.INVALID_IDENTIFIERS, 
                                       "Invalid identifiers", 
                                       "Invalid identifiers provided: " + identifiersJoined.toString());
        return bleError;
    }
    
    public static BLEError invalidWriteDataForCharacteristic(String data, String characteristicUuid) {
        return new BLEError(ErrorCode.INVALID_WRITE_DATA, 
                           "Invalid write data for characteristic", 
                           "Invalid write data format: " + data + " for characteristic " + characteristicUuid, 
                           null, null, characteristicUuid);
    }
    
    public static BLEError descriptorNotFound(String descriptorUuid) {
        return new BLEError(ErrorCode.DESCRIPTOR_NOT_FOUND, 
                           "Descriptor not found", 
                           "Descriptor " + descriptorUuid + " was not found");
    }
    
    public static BLEError invalidWriteDataForDescriptor(String data, String descriptorUuid) {
        return new BLEError(ErrorCode.DESCRIPTOR_WRITE_FAILED, 
                           "Invalid write data for descriptor", 
                           "Invalid write data format: " + data + " for descriptor " + descriptorUuid);
    }
    
    public static BLEError descriptorWriteNotAllowed(String descriptorUuid) {
        return new BLEError(ErrorCode.DESCRIPTOR_WRITE_NOT_ALLOWED, 
                           "Descriptor write not allowed", 
                           "Write operation not allowed for descriptor " + descriptorUuid);
    }
    
    public static BLEError serviceNotFound(String serviceUuid) {
        return new BLEError(ErrorCode.SERVICE_NOT_FOUND, 
                           "Service not found", 
                           "Service " + serviceUuid + " was not found", 
                           null, serviceUuid, null);
    }
    
    public static BLEError cannotMonitorCharacteristic(String reason, String deviceId, String serviceUuid, String characteristicUuid) {
        return new BLEError(ErrorCode.CHARACTERISTIC_READ_FAILED, 
                           "Cannot monitor characteristic", 
                           reason, 
                           deviceId, serviceUuid, characteristicUuid);
    }
    
    public static BLEError deviceServicesNotDiscovered(String deviceId) {
        return new BLEError(ErrorCode.DEVICE_SERVICES_NOT_DISCOVERED, 
                           "Device services not discovered", 
                           "Services for device " + deviceId + " have not been discovered", 
                           deviceId);
    }
    
    public static BLEError characteristicNotReadable(String characteristicUuid, String deviceId) {
        return new BLEError(ErrorCode.CHARACTERISTIC_NOT_READABLE, 
                           "Characteristic not readable", 
                           "Characteristic " + characteristicUuid + " is not readable on device " + deviceId, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError characteristicNotWritable(String characteristicUuid, String deviceId) {
        return new BLEError(ErrorCode.CHARACTERISTIC_NOT_WRITABLE, 
                           "Characteristic not writable", 
                           "Characteristic " + characteristicUuid + " is not writable on device " + deviceId, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError characteristicNotNotifiable(String characteristicUuid, String deviceId) {
        return new BLEError(ErrorCode.CHARACTERISTIC_NOT_FOUND, 
                           "Characteristic not notifiable", 
                           "Characteristic " + characteristicUuid + " does not support notifications on device " + deviceId, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError bluetoothStateChangeFailed(String reason) {
        return new BLEError(ErrorCode.BLUETOOTH_STATE_CHANGE_FAILED, 
                           "Bluetooth state change failed", 
                           reason);
    }
    
    public static BLEError bluetoothUnauthorized(String reason) {
        return new BLEError(ErrorCode.BLUETOOTH_UNAUTHORIZED, 
                           "Bluetooth operation not authorized", 
                           reason);
    }
    
    public static BLEError locationPermissionRequired() {
        return new BLEError(ErrorCode.LOCATION_PERMISSION_REQUIRED, 
                           "Location permission required", 
                           "Location permission is required for BLE scanning");
    }
    
    public static BLEError bluetoothPermissionRequired() {
        return new BLEError(ErrorCode.BLUETOOTH_PERMISSION_REQUIRED, 
                           "Bluetooth permission required", 
                           "Bluetooth permission is required for BLE operations");
    }
    
    public static BLEError systemError(String reason, String internalMessage) {
        return new BLEError(ErrorCode.SYSTEM_ERROR, 
                           "System error", 
                           internalMessage);
    }
    
    public static BLEError unknownError(String reason, String internalMessage) {
        return new BLEError(ErrorCode.UNKNOWN_ERROR, 
                           "Unknown error", 
                           internalMessage);
    }
    
    public static BLEError operationFailed(String operation, String deviceId, String reason) {
        return new BLEError(ErrorCode.OPERATION_FAILED, 
                           operation + " operation failed", 
                           reason, 
                           deviceId);
    }
    
    public static BLEError connectionFailed(String deviceId, String reason) {
        return new BLEError(ErrorCode.DEVICE_CONNECTION_FAILED, 
                           "Connection failed", 
                           reason, 
                           deviceId);
    }
    
    public static BLEError serviceDiscoveryFailed(String deviceId, String reason) {
        return new BLEError(ErrorCode.SERVICE_DISCOVERY_FAILED, 
                           "Service discovery failed", 
                           reason, 
                           deviceId);
    }
    
    public static BLEError characteristicReadFailed(String characteristicUuid, String deviceId, String reason) {
        return new BLEError(ErrorCode.CHARACTERISTIC_READ_FAILED, 
                           "Characteristic read failed", 
                           reason, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError characteristicWriteFailed(String characteristicUuid, String deviceId, String reason) {
        return new BLEError(ErrorCode.CHARACTERISTIC_WRITE_FAILED, 
                           "Characteristic write failed", 
                           reason, 
                           deviceId, null, characteristicUuid);
    }
    
    public static BLEError descriptorReadFailed(String descriptorUuid, String deviceId, String reason) {
        return new BLEError(ErrorCode.DESCRIPTOR_READ_FAILED, 
                           "Descriptor read failed", 
                           reason, 
                           deviceId);
    }
    
    public static BLEError descriptorWriteFailed(String descriptorUuid, String deviceId, String reason) {
        return new BLEError(ErrorCode.DESCRIPTOR_WRITE_FAILED, 
                           "Descriptor write failed", 
                           reason, 
                           deviceId);
    }
    
    // ✅ OPTIMIZATION: Error Classification (Priority 2 - Industry Standard)
    /**
     * Classify error type for automatic retry logic
     * TRANSIENT: Can retry (timeout, temporary disconnection)
     * PERMANENT: Cannot retry (device not found, pairing failed)
     * USER_ACTION: Requires user action (permissions, pairing)
     */
    public enum ErrorType {
        TRANSIENT,      // Can retry (timeout, temporary disconnection)
        PERMANENT,      // Cannot retry (device not found, pairing failed)
        USER_ACTION     // Requires user action (permissions, pairing)
    }
    
    /**
     * Classify error type based on error code
     */
    public ErrorType getErrorType() {
        switch (errorCode) {
            // Transient errors - can retry
            case OPERATION_TIMEOUT:
            case DEVICE_CONNECTION_FAILED:
            case SERVICE_DISCOVERY_FAILED:
            case CHARACTERISTIC_READ_FAILED:
            case CHARACTERISTIC_WRITE_FAILED:
            case DESCRIPTOR_READ_FAILED:
            case DESCRIPTOR_WRITE_FAILED:
            case OPERATION_FAILED:
                return ErrorType.TRANSIENT;
            
            // Permanent errors - cannot retry
            case DEVICE_NOT_FOUND:
            case DEVICE_NOT_CONNECTED:
            case DEVICE_SERVICES_NOT_DISCOVERED:
            case SERVICE_NOT_FOUND:
            case CHARACTERISTIC_NOT_FOUND:
            case DESCRIPTOR_NOT_FOUND:
            case CHARACTERISTIC_NOT_READABLE:
            case CHARACTERISTIC_NOT_WRITABLE:
            case INVALID_WRITE_DATA:
            case INVALID_IDENTIFIERS:
                return ErrorType.PERMANENT;
            
            // User action required
            case PERMISSION_DENIED:
            case LOCATION_PERMISSION_REQUIRED:
            case BLUETOOTH_PERMISSION_REQUIRED:
            case BLUETOOTH_UNAUTHORIZED:
            case BLUETOOTH_STATE_CHANGE_FAILED:
                return ErrorType.USER_ACTION;
            
            // System errors - usually transient but may require user action
            case SYSTEM_ERROR:
            case BLUETOOTH_MANAGER_DESTROYED:
            case OPERATION_CANCELLED:
            case UNKNOWN_ERROR:
            default:
                return ErrorType.TRANSIENT; // Default to transient for unknown errors
        }
    }
    
    /**
     * Check if error can be retried automatically
     */
    public boolean canRetry() {
        return getErrorType() == ErrorType.TRANSIENT;
    }
    
    /**
     * Check if error requires user action
     */
    public boolean requiresUserAction() {
        return getErrorType() == ErrorType.USER_ACTION;
    }
}
