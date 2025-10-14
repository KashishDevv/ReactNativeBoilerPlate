import Foundation

/// BLE Error Codes
/// Structured error types for BLE operations (matching Android implementation)
enum BLEErrorCode: String {
    case deviceNotConnected = "DEVICE_NOT_CONNECTED"
    case characteristicNotFound = "CHARACTERISTIC_NOT_FOUND"
    case characteristicReadFailed = "CHARACTERISTIC_READ_FAILED"
    case characteristicWriteFailed = "CHARACTERISTIC_WRITE_FAILED"
    case serviceDiscoveryFailed = "SERVICE_DISCOVERY_FAILED"
    case permissionDenied = "PERMISSION_DENIED"
    case bluetoothOff = "BLUETOOTH_OFF"
    case bluetoothUnsupported = "BLUETOOTH_UNSUPPORTED"
    case timeout = "TIMEOUT"
    case invalidData = "INVALID_DATA"
    case invalidUUID = "INVALID_UUID"
    case notificationFailed = "NOTIFICATION_FAILED"
    case descriptorWriteFailed = "DESCRIPTOR_WRITE_FAILED"
    case deviceDisconnected = "DEVICE_DISCONNECTED"
    case mtuRequestFailed = "MTU_REQUEST_FAILED"
    case unknownError = "UNKNOWN_ERROR"
}

/// BLE Error class with structured error information
class BLEError: NSError {
    let errorCode: BLEErrorCode  // Renamed from 'code' to avoid NSError.code conflict
    let reason: String
    let deviceId: String?
    let characteristicUuid: String?
    let context: String
    
    init(
        code: BLEErrorCode,
        reason: String,
        context: String = "",
        deviceId: String? = nil,
        characteristicUuid: String? = nil
    ) {
        self.errorCode = code
        self.reason = reason
        self.context = context
        self.deviceId = deviceId
        self.characteristicUuid = characteristicUuid
        
        var userInfo: [String: Any] = [
            NSLocalizedDescriptionKey: reason,
            "errorCode": code.rawValue,
            "context": context
        ]
        
        if let deviceId = deviceId {
            userInfo["deviceId"] = deviceId
        }
        if let characteristicUuid = characteristicUuid {
            userInfo["characteristicUuid"] = characteristicUuid
        }
        
        super.init(domain: "com.ble.error", code: 0, userInfo: userInfo)
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) not implemented")
    }
    
    // MARK: - Factory Methods
    
    static func deviceNotConnected(deviceId: String) -> BLEError {
        return BLEError(
            code: .deviceNotConnected,
            reason: "Device not connected",
            context: "Connection required for this operation",
            deviceId: deviceId
        )
    }
    
    static func characteristicNotFound(uuid: String, deviceId: String) -> BLEError {
        return BLEError(
            code: .characteristicNotFound,
            reason: "Characteristic not found",
            context: "Service discovery may be incomplete",
            deviceId: deviceId,
            characteristicUuid: uuid
        )
    }
    
    static func characteristicReadFailed(uuid: String, deviceId: String, error: Error? = nil) -> BLEError {
        let reason = error?.localizedDescription ?? "Read operation failed"
        return BLEError(
            code: .characteristicReadFailed,
            reason: reason,
            context: "Failed to read characteristic value",
            deviceId: deviceId,
            characteristicUuid: uuid
        )
    }
    
    static func characteristicWriteFailed(uuid: String, deviceId: String, error: Error? = nil) -> BLEError {
        let reason = error?.localizedDescription ?? "Write operation failed"
        return BLEError(
            code: .characteristicWriteFailed,
            reason: reason,
            context: "Failed to write characteristic value",
            deviceId: deviceId,
            characteristicUuid: uuid
        )
    }
    
    static func serviceDiscoveryFailed(deviceId: String, error: Error? = nil) -> BLEError {
        let reason = error?.localizedDescription ?? "Service discovery failed"
        return BLEError(
            code: .serviceDiscoveryFailed,
            reason: reason,
            context: "Failed to discover device services",
            deviceId: deviceId
        )
    }
    
    static func permissionDenied(permission: String) -> BLEError {
        return BLEError(
            code: .permissionDenied,
            reason: "Permission denied: \(permission)",
            context: "Bluetooth permission required"
        )
    }
    
    static func bluetoothOff() -> BLEError {
        return BLEError(
            code: .bluetoothOff,
            reason: "Bluetooth is powered off",
            context: "Enable Bluetooth to continue"
        )
    }
    
    static func bluetoothUnsupported() -> BLEError {
        return BLEError(
            code: .bluetoothUnsupported,
            reason: "Bluetooth not supported on this device",
            context: "Device hardware does not support Bluetooth"
        )
    }
    
    static func timeout(operation: String, deviceId: String, timeoutSeconds: TimeInterval) -> BLEError {
        return BLEError(
            code: .timeout,
            reason: "\(operation) operation timed out after \(timeoutSeconds)s",
            context: "Operation exceeded maximum wait time",
            deviceId: deviceId
        )
    }
    
    static func invalidData(data: String) -> BLEError {
        return BLEError(
            code: .invalidData,
            reason: "Invalid data format: \(data)",
            context: "Data must be valid hex string"
        )
    }
    
    static func invalidUUID(uuid: String) -> BLEError {
        return BLEError(
            code: .invalidUUID,
            reason: "Invalid UUID: \(uuid)",
            context: "UUID must be valid Bluetooth UUID format"
        )
    }
    
    static func notificationFailed(uuid: String, deviceId: String) -> BLEError {
        return BLEError(
            code: .notificationFailed,
            reason: "Failed to enable notifications",
            context: "Characteristic may not support notifications",
            deviceId: deviceId,
            characteristicUuid: uuid
        )
    }
    
    static func descriptorWriteFailed(uuid: String, deviceId: String) -> BLEError {
        return BLEError(
            code: .descriptorWriteFailed,
            reason: "Failed to write descriptor",
            context: "CCCD write operation failed",
            deviceId: deviceId,
            characteristicUuid: uuid
        )
    }
    
    static func deviceDisconnected(deviceId: String) -> BLEError {
        return BLEError(
            code: .deviceDisconnected,
            reason: "Device disconnected",
            context: "Connection lost during operation",
            deviceId: deviceId
        )
    }
    
    static func mtuRequestFailed(deviceId: String, error: Error? = nil) -> BLEError {
        let reason = error?.localizedDescription ?? "MTU negotiation failed"
        return BLEError(
            code: .mtuRequestFailed,
            reason: reason,
            context: "Failed to negotiate MTU size",
            deviceId: deviceId
        )
    }
    
    static func unknownError(message: String, deviceId: String? = nil) -> BLEError {
        return BLEError(
            code: .unknownError,
            reason: message,
            context: "An unexpected error occurred",
            deviceId: deviceId
        )
    }
    
    // MARK: - Conversion Methods
    
    /// Convert to React Native error tuple (code, message, userInfo)
    func toReactNativeError() -> (String, String, [String: Any]?) {
        var userInfo: [String: Any] = [
            "errorCode": errorCode.rawValue,
            "reason": reason,
            "context": context
        ]
        
        if let deviceId = deviceId {
            userInfo["deviceId"] = deviceId
        }
        if let characteristicUuid = characteristicUuid {
            userInfo["characteristicUuid"] = characteristicUuid
        }
        
        return (errorCode.rawValue, reason, userInfo)
    }
    
    /// Convert to string representation
    func toJSString() -> String {
        var parts = ["BLEError:", errorCode.rawValue, "-", reason]
        
        if let deviceId = deviceId {
            parts.append("(Device: \(deviceId)")
            if let charUuid = characteristicUuid {
                parts.append(", Characteristic: \(charUuid))")
            } else {
                parts.append(")")
            }
        }
        
        return parts.joined(separator: " ")
    }
    
    override var description: String {
        return toJSString()
    }
}

