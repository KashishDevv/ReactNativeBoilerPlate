//
//  BridgingCodeModule.swift
//  ReactNativeBoilerPlate
//
//  Created by: BLE Team
//  Description: Core BLE module for Smart Health Tag device communication
//               Implements SDD v1.5 flow (PROPER_FLOW_ANALYSIS_SDD_V1.5)
//

import Foundation
import AVFoundation
import CoreBluetooth
import React
import UserNotifications
import UIKit
import iOSMcuManagerLibrary
// MARK: - Protocol Constants

/// BLE protocol constants as per Smart Device Design (SDD) specification
/// Defines packet structure and response codes for device communication
struct BLEProtocolConstants {
  /// Maximum payload size in bytes (17 bytes data + 3 bytes header = 20 total)
  static let maxPayloadSize = 17
  
  /// Total BLE packet size (20 bytes as per BLE standard)
  static let packetSize = 20
  
  /// Request packet identifier (0xAA = mobile -> device)
  static let requestId: UInt8 = 0xAA
  
  /// Response packet identifier (0xBB = device -> mobile)
  static let responseId: UInt8 = 0xBB
  
  /// Success status code (0x00 = operation successful)
  static let successStatus: UInt8 = 0x00
  
  /// Minimum manufacturer data size in advertisement (8 bytes)
  static let minManufacturerDataSize = 8
  
  /// Minimum device status characteristic size (8 bytes)
  static let minDeviceStatusSize = 8
  
  /// Minimum data transfer packet size (2 bytes: type + length)
  static let minDataTransferSize = 2
  
  /// Device status record size (8 bytes per record)
  static let deviceStatusRecordSize = 8
}
// MARK: - Power Profile Constants

/// Power management profiles for optimizing battery vs performance trade-offs
/// Three profiles available: default (balanced), lowPower (battery saver), highPerformance (fast response)
struct PowerProfileConstants {
  static let profiles: [String: [String: Any]] = [
    // Balanced profile: good mix of battery life and responsiveness
    "default": [
      "healthCheckMs": 30000,              // Health check every 30 seconds
      "healthRssiEveryNTicks": 3,          // Read RSSI every 3rd health check
      "rssiCycleIntervalMs": 30000,        // RSSI cycle every 30 seconds
      "rssiCycleDurationMs": 3000,         // RSSI measurement duration: 3 seconds
      "pruneIntervalMs": 300000,           // Clean stale devices every 5 minutes
      "pruneAgeMs": 600000,                // Remove devices older than 10 minutes
      "scanMode": "LowLatency",            // Fast scan mode
      "maxScanDurationMs": 15000,          // Max scan time: 15 seconds
      "connectionIntervalMs": 50,          // Connection interval: 50ms (fast)
      "connectionLatency": 0,              // No latency (instant response)
      "supervisionTimeoutMs": 8000,        // Disconnect if no response for 8 seconds
      "mtuSize": 512                       // Maximum transmission unit: 512 bytes
    ],
    
    // Battery saver profile: extends battery life, slower response
    "lowPower": [
      "healthCheckMs": 60000,              // Health check every 60 seconds
      "healthRssiEveryNTicks": 6,          // Read RSSI every 6th health check
      "rssiCycleIntervalMs": 30000,        // RSSI cycle every 30 seconds
      "rssiCycleDurationMs": 2000,         // RSSI measurement duration: 2 seconds
      "pruneIntervalMs": 600000,           // Clean stale devices every 10 minutes
      "pruneAgeMs": 1200000,               // Remove devices older than 20 minutes
      "scanMode": "LowPower",              // Power-efficient scan mode
      "maxScanDurationMs": 10000,          // Max scan time: 10 seconds
      "connectionIntervalMs": 100,         // Connection interval: 100ms (slower)
      "connectionLatency": 2,              // Allow 2 connection events latency
      "supervisionTimeoutMs": 8000,        // Disconnect if no response for 8 seconds
      "mtuSize": 256                       // Smaller MTU to save power
    ],
    
    // High performance profile: fastest response, higher battery drain
    "highPerformance": [
      "healthCheckMs": 15000,              // Health check every 15 seconds
      "healthRssiEveryNTicks": 1,          // Read RSSI on every health check
      "rssiCycleIntervalMs": 15000,        // RSSI cycle every 15 seconds
      "rssiCycleDurationMs": 5000,         // RSSI measurement duration: 5 seconds
      "pruneIntervalMs": 120000,           // Clean stale devices every 2 minutes
      "pruneAgeMs": 300000,                // Remove devices older than 5 minutes
      "scanMode": "LowLatency",            // Fastest scan mode
      "maxScanDurationMs": 20000,          // Max scan time: 20 seconds
      "connectionIntervalMs": 30,          // Connection interval: 30ms (fastest)
      "connectionLatency": 0,              // No latency (instant response)
      "supervisionTimeoutMs": 6000,        // Shorter timeout for faster detection
      "mtuSize": 512                       // Maximum MTU for throughput
    ]
  ]
}
// MARK: - Main BLE Module Class

/// Core BLE module bridging iOS CoreBluetooth to React Native
/// Handles device discovery, connection, pairing, and data sync
/// Implements SDD v1.3/v1.4 protocol specification for Smart Health Tag devices
@objc(BridgingCodeModule)
class BridgingCodeModule: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  
  // MARK: - React Native Event Registration
  
  /// Defines all events that can be sent to React Native JavaScript layer
  /// - Returns: Array of event names that JavaScript can subscribe to
  override func supportedEvents() -> [String]! {
    return [
      "CharacteristicData",              // Raw characteristic data received
      "AutoConnectDeviceConnected",      // Device auto-connected successfully
      "AutoConnectDeviceDisconnected",   // Device auto-disconnected
      "NativeCommandSent",               // System command sent to device
      "DataTransfer",                    // Data sync transfer event
      "SystemCommandResponse",           // Response from device system command
      "DeviceDisconnected",              // Device disconnected
      "DeviceDataUpdated",               // Device status/data updated
      "HealthDataApiRequest",            // Health data ready for API upload
      "DeviceConnected",                 // Device connected successfully
      "DeviceFound",                     // Device discovered during scan
      "ServiceDiscoveryComplete",        // All services/characteristics discovered
      "ServicesDiscovered",              // BLE services discovered
      "CharacteristicsDiscovered",       // BLE characteristics discovered
      "RSSIUpdate",                      // Signal strength update
      "RTCRead",                         // Real-time clock read from device
      "ConnectionLog",                   // Connection-related logs (notifications enabled, etc.)
      "DFUStateChanged",                 // McuMgr DFU state (STARTED, UPLOAD, CONFIRM, RESET, COMPLETED, CANCELED)
      "DFUProgress",                     // McuMgr DFU progress (percent, current, total)
      "DFUError"                         // McuMgr DFU error
    ]
  }
  // MARK: - BLE Service UUIDs
  
  /// Custom Smart Tag service UUID (proprietary, defined in SDD)
  private let SMART_TAG_SERVICE_UUID = CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
  
  /// Standard BLE Battery Service UUID (0x180F)
  private let BATTERY_SERVICE_UUID = CBUUID(string: "0000180f-0000-1000-8000-00805f9b34fb")
  
  /// Standard BLE Device Information Service UUID (0x180A)
  private let DEVICE_INFO_SERVICE_UUID = CBUUID(string: "0000180a-0000-1000-8000-00805f9b34fb")
  
  /// Standard BLE Generic Access Service UUID (0x1800)
  private let GENERIC_ACCESS_SERVICE_UUID = CBUUID(string: "00001800-0000-1000-8000-00805f9b34fb")
  
  /// Nordic DFU (Device Firmware Update) Service UUID for bootloader
  private let DFU_SERVICE_UUID = CBUUID(string: "8ec90003-f315-4f60-9fb8-838830daea50")
  
  // MARK: - BLE Characteristic UUIDs
  
  /// System Command characteristic - send commands to device (write with response)
  private let SYSTEM_COMMAND_CHAR_UUID = CBUUID(string: "4f4e4d4c-4b4a-4948-4746-454443424140")
  
  /// Device Status characteristic - receive device state updates (notify + read)
  private let DEVICE_STATUS_CHAR_UUID = CBUUID(string: "5f5e5d5c-5b5a-5958-5756-555453525150")
  
  /// Data Transfer characteristic - sync historical records (notify + read)
  private let DATA_TRANSFER_CHAR_UUID = CBUUID(string: "6f6e6d6c-6b6a-6968-6766-656463626160")
  
  /// Standard Battery Level characteristic (0x2A19) - returns 0-100%
  private let BATTERY_LEVEL_CHAR_UUID = CBUUID(string: "00002a19-0000-1000-8000-00805f9b34fb")
  
  /// Helper to get human-readable characteristic name
  private func getCharacteristicName(_ uuid: String) -> String {
    let uppercasedUuid = uuid.uppercased()
    if uppercasedUuid == SYSTEM_COMMAND_CHAR_UUID.uuidString.uppercased() { return "System Command" }
    if uppercasedUuid == DEVICE_STATUS_CHAR_UUID.uuidString.uppercased() { return "Device Status" }
    if uppercasedUuid == DATA_TRANSFER_CHAR_UUID.uuidString.uppercased() { return "Data Transfer" }
    if uppercasedUuid == BATTERY_LEVEL_CHAR_UUID.uuidString.uppercased() { return "Battery Level" }
    return "Unknown"
  }
  
  /// Standard Manufacturer Name characteristic (0x2A29) - device maker
  private let MANUFACTURER_NAME_CHAR_UUID = CBUUID(string: "00002a29-0000-1000-8000-00805f9b34fb")
  
  /// Standard Model Number characteristic (0x2A24) - device model
  private let MODEL_NUMBER_CHAR_UUID = CBUUID(string: "00002a24-0000-1000-8000-00805f9b34fb")
  
  /// Standard Firmware Revision characteristic (0x2A26) - firmware version
  private let FIRMWARE_REVISION_CHAR_UUID = CBUUID(string: "00002a26-0000-1000-8000-00805f9b34fb")
  
  // MARK: - Device Identification
  
  /// Manufacturer ID used in BLE advertisement data (0x1234 as per SDD)
  private let SMART_TAG_MANUFACTURER_ID: UInt16 = 0x1234
  
  // MARK: - Connection Management Constants
  
  /// Maximum number of automatic reconnection attempts before giving up
  private static let MAX_RECONNECT_ATTEMPTS = 5
  
  /// Initial backoff delay for first reconnection attempt (1 second)
  private static let INITIAL_RECONNECT_BACKOFF_MS: TimeInterval = 1.0
  
  /// Maximum backoff delay between reconnection attempts (60 seconds)
  private static let MAX_RECONNECT_BACKOFF_MS: TimeInterval = 60.0
  
  /// Random jitter added to backoff to prevent thundering herd (1 second)
  private static let JITTER_MS: TimeInterval = 1.0
  
  /// Minimum RSSI signal strength required for reconnection (-90 dBm)
  private static let MIN_RSSI_FOR_RECONNECTION = -90
  
  /// Maximum number of devices to keep in scanned devices map (memory limit)
  private static let MAX_DEVICE_MAP_SIZE = 50  
  // MARK: - Error Classification
  
  /// BLE error categories for intelligent retry logic
  enum BLEErrorType: String {
    /// Transient errors (temporary, can retry automatically)
    /// Examples: timeout, connection lost, temporary unavailable
    case TRANSIENT = "TRANSIENT"
    
    /// Permanent errors (cannot retry, requires different approach)
    /// Examples: device not found, unsupported operation
    case PERMANENT = "PERMANENT"
    
    /// User action required (user must intervene)
    /// Examples: permissions denied, pairing failed, authentication needed
    case USER_ACTION = "USER_ACTION"
  }
  
  // MARK: - Connection States
  
  /// Progressive connection states from initial connect to fully ready
  enum ConnectionState: String {
    /// Physical BLE connection established
    case CONNECTED = "CONNECTED"
    
    /// Services and characteristics discovered
    case SERVICES_READY = "SERVICES_READY"
    
    /// Pairing/encryption verified (can read encrypted characteristics)
    case SECURE_READY = "SECURE_READY"
    
    /// Fully ready (notifications enabled, time synced, ready for commands)
    case READY = "READY"
  }
  // MARK: - Core BLE Properties
  
  /// iOS CoreBluetooth central manager (manages scanning and connections)
  private var centralManager: CBCentralManager?
  
  /// Array of currently connected peripherals
  private var connectedPeripherals: [CBPeripheral] = []
  
  /// Map of devices currently in the connection process (deviceId -> peripheral)
  private var connectingPeripherals: [String: CBPeripheral] = [:]
  
  /// Set of device IDs that have been successfully paired/bonded (persisted)
  private var bondedDeviceIDs: Set<String> = []
  
  /// Set of device IDs that user has explicitly forgotten (prevents auto-reconnect)
  private var forgottenDeviceIDs: Set<String> = []
  
  /// Flag indicating if auto-connect feature is enabled
  private var autoConnectEnabled: Bool = false
  
  /// Queue of pending permission request promises (resolve/reject pairs)
  private var pendingPermissionResolvers: [(RCTPromiseResolveBlock, RCTPromiseRejectBlock)] = []
  
  /// Smart Tag service UUID (duplicate for compatibility)
  private let smartTagServiceUUID = CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
  
  // MARK: - Reconnection Management
  
  /// Timers for scheduled reconnection attempts (deviceId -> timer)
  private var reconnectTimers: [String: Timer] = [:]
  
  /// Current backoff delay for each device (deviceId -> seconds)
  private var reconnectBackoff: [String: TimeInterval] = [:]
  
  /// Number of reconnection attempts made for each device (deviceId -> count)
  private var reconnectAttempts: [String: Int] = [:]
  
  /// Devices being manually disconnected (prevents auto-reconnect for 30 mins)
  private var manualDisconnectInProgress: Set<String> = []
  
  /// Last known RSSI signal strength for each device (deviceId -> dBm)
  private var deviceRSSI: [String: Int] = [:] 
  // MARK: - Power Management
  
  /// Currently active power profile name ("default", "lowPower", or "highPerformance")
  private var currentPowerProfile: String = "default"
  
  /// All available power profiles and their settings
  private var powerProfiles: [String: [String: Any]] = [:]
  
  /// Timer for periodic health checks (RSSI, connection state)
  private var healthCheckTimer: Timer?
  
  /// Count of consecutive health check failures per device
  private var healthCheckFailures: [String: Int] = [:]
  
  /// Counter for health check ticks (used for RSSI reading frequency)
  private var healthCheckTickCount: Int = 0
  
  /// Transaction manager for thread-safe BLE operations
  private var transactionManager: TransactionManager?
  
  // MARK: - Error Handling & Retry Logic
  
  /// Error context information for debugging (errorKey -> context data)
  private var errorContexts: [String: [String: Any]] = [:]
  
  /// Retry attempt counters for operations (operationKey -> count)
  private var retryAttempts: [String: Int] = [:]
  
  /// Maximum number of retry attempts for operations
  private var maxRetryAttempts: Int = 3
  
  // MARK: - Device Discovery & Service Management
  
  /// All devices discovered during scanning (deviceId -> peripheral)
  private var scannedDevices: [String: CBPeripheral] = [:]
  
  /// Discovered BLE services per device (deviceId -> services)
  private var deviceServices: [String: [CBService]] = [:]
  
  /// Discovered BLE characteristics per device (deviceId -> characteristics)
  private var deviceCharacteristics: [String: [CBCharacteristic]] = [:]
  
  /// Pending promise resolvers for async operations (operationKey -> resolver)
  private var pendingPromises: [String: RCTPromiseResolveBlock] = [:]
  
  /// Pending promise rejecters for async operations (operationKey -> rejecter)
  private var pendingRejecters: [String: RCTPromiseRejectBlock] = [:]
  
  /// Timers for service discovery timeout (deviceId -> timer)
  private var serviceDiscoveryTimers: [String: Timer] = [:]
  
  /// Service discovery retry attempt counters (deviceId -> count)
  private var serviceDiscoveryRetryAttempts: [String: Int] = [:]
  
  /// Maximum service discovery retry attempts
  private let MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS = 3
  
  /// Service discovery timeout duration (seconds)
  private let SERVICE_DISCOVERY_TIMEOUT_SECONDS: TimeInterval = 12.0
  
  /// Timestamp when service discovery was initiated (deviceId -> timestamp)
  private var serviceDiscoveryStartTimes: [String: Date] = [:]
  
  /// Timers for connection timeout (deviceId -> work item)
  private var connectionTimeoutTimers: [String: DispatchWorkItem] = [:]
  
  /// Connection retry attempt counters (deviceId -> count)
  private var connectionRetryAttempts: [String: Int] = [:]
  
  /// Maximum connection retry attempts before failing (industry standard: 3 attempts)
  private let MAX_CONNECTION_RETRY_ATTEMPTS = 3
  
  /// Delay between connection retry attempts (industry standard: 1-2s, 5s, 10-15s)
  private let CONNECTION_RETRY_DELAY_MS: TimeInterval = 1.5
  private let CONNECTION_RETRY_DELAY_2: TimeInterval = 5.0
  private let CONNECTION_RETRY_DELAY_3: TimeInterval = 12.0
  
  /// Flag indicating if BLE scanning is currently active
  private var isScanning: Bool = false
  
  /// Tracks if system commands have been sent to device (prevents duplicates)
  private var systemCommandsSent: [String: Bool] = [:]
  
  /// Background queue for service/characteristic discovery operations
  private let discoveryQueue = DispatchQueue(label: "com.reactnativeboilerplate.discovery", qos: .userInitiated)
  
  /// Services awaiting characteristic discovery (deviceId -> pending service UUIDs)
  private var servicesWithPendingCharDiscovery: [String: Set<CBUUID>] = [:]
  
  /// Tracks if discovery complete event has been sent (prevents duplicates)
  private var discoveryCompleteEventSent: [String: Bool] = [:] 
  // MARK: - Data Sync Management
  
  /// Current data sync state per device ("idle", "syncing", "time_syncing", "complete", "failed")
  private var dataSyncState: [String: String] = [:]
  
  /// Number of data sync retry attempts per device
  private var dataSyncRetryCount: [String: Int] = [:]
  
  /// Requested data acquisition intervals per device (in seconds)
  private var requestedDataAcquisitionIntervals: [String: Int] = [:]
  
  /// Timers for data sync retry delays
  private var dataSyncTimers: [String: Timer] = [:]
  
  /// Number of records available on each device (from device status)
  private var deviceRecordCounts: [String: Int] = [:]
  
  /// Flag indicating if data sync was explicitly requested (vs unsolicited data)
  private var dataSyncRequested: [String: Bool] = [:]
  
  /// Count of device status notifications received (for debugging)
  private var deviceStatusNotificationCount: [String: Int] = [:]
  
  /// Track notification enable state for each device (deviceId -> Set of enabled characteristic UUIDs)
  /// Used to ensure all critical notifications are enabled before sending commands (matching nRF Connect pattern)
  private var deviceNotificationStates: [String: Set<String>] = [:]
  
  // MARK: - McuMgr DFU (SMP / MCUboot - matches Android and nRF Connect)
  
  /// Current McuMgr DFU manager (one at a time)
  private var mcuMgrDfuManager: FirmwareUpgradeManager?
  /// Device ID for the ongoing DFU (used in events and to skip reconnect)
  private var currentMcuMgrDfuDeviceId: String?
  /// Delegate wrapper for DFU callbacks (retained by manager)
  private var mcuMgrDfuDelegate: DFUEventForwarder?
  
  /// Returns true if the device is currently in McuMgr DFU (do not reconnect/restore)
  private func isDeviceInMcuMgrDfu(_ deviceId: String) -> Bool {
    guard let current = currentMcuMgrDfuDeviceId else { return false }
    return current == deviceId
  }
  
  /// Forwarder for McuMgr DFU delegate callbacks to React Native events (must be retained by manager)
  private class DFUEventForwarder: FirmwareUpgradeDelegate {
    weak var module: BridgingCodeModule?
    let deviceId: String
    init(module: BridgingCodeModule, deviceId: String) {
      self.module = module
      self.deviceId = deviceId
    }
    func upgradeDidStart(controller: FirmwareUpgradeController) {
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUStateChanged", body: [
          "deviceId": self.deviceId,
          "state": "STARTED",
          "progress": 0
        ])
      }
    }
    func upgradeStateDidChange(from previousState: FirmwareUpgradeState, to newState: FirmwareUpgradeState) {
      let stateName = dfuStateName(newState)
      let progress = (newState == .confirm || newState == .reset || newState == .success) ? 100 : 0
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUStateChanged", body: [
          "deviceId": self.deviceId,
          "state": stateName,
          "progress": progress
        ])
      }
    }
    func upgradeDidComplete() {
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUStateChanged", body: [
          "deviceId": self.deviceId,
          "state": "COMPLETED",
          "progress": 100
        ])
        self.module?.currentMcuMgrDfuDeviceId = nil
        self.module?.mcuMgrDfuManager = nil
        self.module?.mcuMgrDfuDelegate = nil
        self.module?.manualDisconnectInProgress.remove(self.deviceId)
      }
    }
    func upgradeDidFail(inState state: FirmwareUpgradeState, with error: Error) {
      let errMsg = error.localizedDescription
      let errCode = (error as NSError).domain
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUError", body: [
          "deviceId": self.deviceId,
          "errorCode": errCode,
          "message": errMsg
        ])
        self.module?.currentMcuMgrDfuDeviceId = nil
        self.module?.mcuMgrDfuManager = nil
        self.module?.mcuMgrDfuDelegate = nil
        self.module?.manualDisconnectInProgress.remove(self.deviceId)
      }
    }
    func upgradeDidCancel(state: FirmwareUpgradeState) {
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUStateChanged", body: [
          "deviceId": self.deviceId,
          "state": "CANCELED",
          "progress": 0
        ])
        self.module?.currentMcuMgrDfuDeviceId = nil
        self.module?.mcuMgrDfuManager = nil
        self.module?.mcuMgrDfuDelegate = nil
        self.module?.manualDisconnectInProgress.remove(self.deviceId)
      }
    }
    func uploadProgressDidChange(bytesSent: Int, imageSize: Int, timestamp: Date) {
      let percent = imageSize > 0 ? Int(100 * bytesSent / imageSize) : 0
      DispatchQueue.main.async {
        self.module?.sendEvent(withName: "DFUProgress", body: [
          "deviceId": self.deviceId,
          "progress": percent,
          "current": bytesSent,
          "total": imageSize
        ])
      }
    }
    private func dfuStateName(_ state: FirmwareUpgradeState) -> String {
      switch state {
      case .none: return "NONE"
      case .requestMcuMgrParameters: return "REQUEST_MCU_MGR_PARAMETERS"
      case .bootloaderInfo: return "BOOTLOADER_INFO"
      case .eraseAppSettings: return "ERASE_APP_SETTINGS"
      case .validate: return "VALIDATE"
      case .upload: return "UPLOAD"
      case .test: return "TEST"
      case .confirm: return "CONFIRM"
      case .reset: return "RESET"
      case .success: return "SUCCESS"
      case .resetIntoFirmwareLoader: return "RESET_INTO_FIRMWARE_LOADER"
      @unknown default: return String(describing: state).uppercased()
      }
    }
  }
  
  // MARK: - Time Synchronization
  
  /// Flag indicating if device RTC (real-time clock) is valid
  private var deviceRTCValidity: [String: Bool] = [:]
  
  /// Number of SET_TIME command retry attempts per device
  private var setTimeRetryAttempts: [String: Int] = [:]
  
  /// Timers for SET_TIME command response timeout
  private var setTimeTimeoutTimers: [String: Timer] = [:]
  
  /// Timers for post-sync keep-alive reads (maintains connection)
  private var keepAliveTimers: [String: Timer] = [:]
  
  /// Timestamp of last sync completion per device (for disconnect detection)
  private var lastSyncCompleteTime: [String: Date] = [:]
  
  /// Flag to track if initial sync has been completed per device (prevents repeated sync starts)
  private var hasCompletedInitialSync: [String: Bool] = [:]
  
  /// Flag to track if initial command sequence has STARTED (prevents duplicate sync starts before completion)
  /// This is different from hasCompletedInitialSync - this prevents starting sync twice while sync is in progress
  private var hasStartedInitialSync: [String: Bool] = [:]
  
  /// Flag to track if DeviceConnected event has been emitted (prevents duplicate events)
  private var hasEmittedDeviceConnected: [String: Bool] = [:]
  
  /// Track if ConnectionLog "Connected" event has been emitted (prevents duplicates)
  private var hasEmittedConnectedLog: [String: Date] = [:]
  
  /// Deduplication window for ConnectionLog "Connected" events (seconds)
  private let CONNECTED_LOG_DEDUPE_WINDOW_SECONDS: TimeInterval = 2.0
  
  /// Interval between keep-alive reads (3 seconds)
  private let KEEP_ALIVE_INTERVAL: TimeInterval = 3.0
  
  /// Duration to maintain connection after sync (30 seconds)
  private let POST_SYNC_KEEP_ALIVE_DURATION: TimeInterval = 30.0
  
  /// Flag indicating RTC check is pending before enabling notifications
  private var rtcCheckPendingBeforeNotifications: [String: Bool] = [:]
  
  /// Flag indicating to enable notifications after SET_TIME completes
  private var enableNotificationsAfterSetTime: [String: Bool] = [:]
  
  /// Flag indicating if SET_TIME response was received
  private var setTimeResponseReceived: [String: Bool] = [:]
  
  /// Prevents duplicate enableNotificationsFirst calls (race condition guard per device)
  private var notificationEnableInProgress: [String: Bool] = [:]
  
  /// Timestamp information for SET_TIME command (for logging)
  private var setTimeTimestampInfo: [String: [String: Any]] = [:]
  
  // MARK: - Multi-File Sync (SDD v1.4)
  
  /// Maximum records per file/chunk as per SDD v1.4 (500 records)
  private let RECORDS_PER_FILE = 500
  
  /// Maximum total records device can store (25,000 records)
  private let MAX_TOTAL_RECORDS = 25000
  
  /// Total number of records to sync for current session
  private var syncTotalRecords: [String: Int] = [:]
  
  /// Number of records received in current file/chunk
  private var syncRecordsReceived: [String: Int] = [:]
  
  /// Current file number being synced (1-based)
  private var syncCurrentFileNumber: [String: Int] = [:]
  
  /// Grand total of records received across all files
  private var syncGrandTotalReceived: [String: Int] = [:]
  
  /// Grace period after sync complete: don't overwrite deviceRecordCounts with tag value (tag may report stale count before flash cleared)
  private let SYNC_COMPLETE_GRACE_PERIOD_SECONDS: TimeInterval = 10
  
  /// Flag: true when record path (500 boundary) already sent STOP+Start — skip duplicate in DATA_SYNC_COMPLETE handler
  private var recordPathChunkAdvanced: [String: Bool] = [:]
  
  /// Pending "start next chunk" — runs 200ms after STOP ACK (BB 09). Matches Android: no next START until device acknowledges STOP.
  private var pendingStartNextChunkAfterStopResponse: [String: () -> Void] = [:]
  
  // MARK: - Data Transfer Deduplication
  
  /// Last processed data transfer hex per device (prevents duplicate notification processing)
  /// iOS BLE can sometimes deliver the same notification multiple times in quick succession
  private var lastDataTransferHex: [String: String] = [:]
  
  /// Timestamp of last processed data transfer per device (for time-based deduplication)
  private var lastDataTransferTime: [String: Date] = [:]
  
  /// Deduplication time window in seconds (ignore duplicate data within this window)
  private let DATA_TRANSFER_DEDUPE_WINDOW: TimeInterval = 0.5  // 500ms
  
  // MARK: - Scanning Management
  
  /// Minimum interval between scan operations (1 second, prevents rapid scan churn)
  private static let MIN_SCAN_INTERVAL_MS: TimeInterval = 1000.0 / 1000.0
  
  /// Timestamp of last scan stop (for enforcing minimum interval)
  private var lastScanStopTime: Date? = nil
  // MARK: - Initialization
  
  /// Initialize the BLE module
  /// - Sets up power profiles, loads persisted device bonds, requests permissions
  /// - If bonded devices exist, enables state restoration and auto-connect
  override init() {
    super.init()
    
    // Load persisted device lists
    loadBondedDevices()
    loadForgottenDevices()
    
    // Initialize power management profiles
    initializePowerProfiles()
    
    // Create transaction manager for thread-safe operations
    transactionManager = TransactionManager()
    
    // Request notification permissions for background alerts
    requestNotificationPermissionsIfNeeded()
    
    // If we have bonded devices, enable iOS state restoration and auto-connect
    if bondedDeviceIDs.count > 0 {
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
      autoConnectEnabled = true
    }
  }
  /// Load power profiles from constants into runtime dictionary
  private func initializePowerProfiles() {
    powerProfiles = PowerProfileConstants.profiles
  }
  
  // MARK: - Power Profile Management (React Native API)
  
  /// Set the active power profile (default, lowPower, or highPerformance)
  /// - Parameters:
  ///   - profileName: Name of the profile to activate
  ///   - resolve: Promise resolver returning new profile settings
  ///   - reject: Promise rejecter for invalid profile name
  @objc(setPowerProfile:resolver:rejecter:)
  func setPowerProfile(profileName: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let profile = powerProfiles[profileName] else {
      reject("INVALID_PROFILE", "Power profile '\(profileName)' not found", nil)
      return
    }
    
    // Switch to new profile
    currentPowerProfile = profileName
    
    // Apply new settings
    updatePowerProfileSettings()
    updateConnectionParametersForAllDevices()
    restartHealthChecks()
    
    resolve([
      "profileName": profileName,
      "settings": profile,
      "status": "success"
    ])
  }
  
  /// Get the currently active power profile
  /// - Parameters:
  ///   - resolve: Promise resolver returning current profile info
  ///   - reject: Promise rejecter (unused, always succeeds)
  @objc(getCurrentPowerProfile:rejecter:)
  func getCurrentPowerProfile(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let currentSettings = powerProfiles[currentPowerProfile] ?? [:]
    resolve([
      "currentProfile": currentPowerProfile,
      "settings": currentSettings,
      "availableProfiles": Array(powerProfiles.keys)
    ])
  }
  private func updatePowerProfileSettings() {
    guard let settings = powerProfiles[currentPowerProfile] else { return }
    if let scanMode = settings["scanMode"] as? String {
    }
    if let maxScanDuration = settings["maxScanDurationMs"] as? Int {
    }
  }
  private func updateConnectionParametersForAllDevices() {
    guard let settings = powerProfiles[currentPowerProfile] else { return }
    for peripheral in connectedPeripherals {
      let deviceId = peripheral.identifier.uuidString
      requestConnectionParameters(peripheral: peripheral, deviceId: deviceId)
    }
  }
  private func requestConnectionParameters(peripheral: CBPeripheral, deviceId: String) {
    guard let settings = powerProfiles[currentPowerProfile] else { return }
    if let connectionInterval = settings["connectionIntervalMs"] as? Int {
    }
    if let supervisionTimeout = settings["supervisionTimeoutMs"] as? Int {
    }
  }
  private func restartHealthChecks() {
    healthCheckTimer?.invalidate()
    healthCheckTimer = nil
    healthCheckTickCount = 0  // Reset tick counter on restart
    startHealthChecks()
  }
  private func startHealthChecks() {
    guard let settings = powerProfiles[currentPowerProfile],
          let healthCheckInterval = settings["healthCheckMs"] as? Int else {
      return
    }
    let interval = Double(healthCheckInterval) / 1000.0
    healthCheckTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
      self?.performHealthChecks()
    }
  }
  private func performHealthChecks() {
    // Increment tick counter
    healthCheckTickCount += 1
    
    // Get RSSI read frequency from power profile settings
    let settings = powerProfiles[currentPowerProfile] ?? PowerProfileConstants.profiles["default"]!
    let rssiEveryNTicks = settings["healthRssiEveryNTicks"] as? Int ?? 3
    
    // Determine if we should read RSSI this tick
    let shouldReadRssi = (healthCheckTickCount % rssiEveryNTicks) == 0
    
    for peripheral in connectedPeripherals {
      let deviceId = peripheral.identifier.uuidString
      if peripheral.state != .connected {
        handleHealthCheckFailure(deviceId: deviceId)
        continue
      }
      
      // Only read RSSI every N ticks based on power profile
      if shouldReadRssi {
        peripheral.readRSSI()
      }
      healthCheckFailures[deviceId] = 0
    }
  }
  private func handleHealthCheckFailure(deviceId: String) {
    let failures = healthCheckFailures[deviceId] ?? 0
    let newFailures = failures + 1
    healthCheckFailures[deviceId] = newFailures
    if newFailures >= 3 {
      scheduleReconnection(deviceId: deviceId)
      healthCheckFailures[deviceId] = 0 
    }
  }
  private func scheduleReconnection(deviceId: String) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
        return
      }
      let attempts = self.reconnectAttempts[deviceId] ?? 0
      if attempts >= Self.MAX_RECONNECT_ATTEMPTS {
        self.reconnectAttempts.removeValue(forKey: deviceId)
        self.reconnectBackoff.removeValue(forKey: deviceId)
        return
      }
      if let lastRSSI = self.deviceRSSI[deviceId], lastRSSI < Self.MIN_RSSI_FOR_RECONNECTION {
        self.reconnectAttempts.removeValue(forKey: deviceId) 
        self.reconnectBackoff.removeValue(forKey: deviceId)
        return
      }
      self.centralManager?.cancelPeripheralConnection(peripheral)
      let baseBackoff = min(Self.INITIAL_RECONNECT_BACKOFF_MS * pow(2.0, Double(attempts)), Self.MAX_RECONNECT_BACKOFF_MS)
      let jitter = Double.random(in: 0...Self.JITTER_MS)
      let backoffMs = baseBackoff + jitter
      DispatchQueue.main.asyncAfter(deadline: .now() + backoffMs) { [weak self] in
        self?.attemptReconnection(deviceId: deviceId, peripheral: peripheral)
      }
    }
  }
  private func attemptReconnection(deviceId: String, peripheral: CBPeripheral) {
    DispatchQueue.main.async { [weak self] in
      guard let self = self else { return }
      if self.forgottenDeviceIDs.contains(deviceId) {
        self.reconnectAttempts.removeValue(forKey: deviceId)
        self.reconnectBackoff.removeValue(forKey: deviceId)
        return
      }
      let currentAttempts = self.reconnectAttempts[deviceId] ?? 0
      self.reconnectAttempts[deviceId] = currentAttempts + 1
      self.connectingPeripherals[deviceId] = peripheral
      peripheral.delegate = self
      let connectionOptions: [String: Any] = [
        CBConnectPeripheralOptionNotifyOnConnectionKey: true,
        CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
        CBConnectPeripheralOptionNotifyOnNotificationKey: true
      ]
      self.centralManager?.connect(peripheral, options: connectionOptions)
    }
  }
  // MARK: - Bluetooth Permissions (React Native API)
  
  /// Request Bluetooth permissions and check Bluetooth state
  /// - iOS handles Bluetooth permissions automatically when accessing CBCentralManager
  /// - This method initializes the manager and returns current state
  /// - Parameters:
  ///   - resolve: Promise resolver returning permission status
  ///   - reject: Promise rejecter for permission denied or BT unavailable
  @objc(requestPermissions:rejecter:)
  func requestPermissions(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Initialize central manager if not already created
    if centralManager == nil {
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
    }
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    // Check current Bluetooth state and respond accordingly
    switch manager.state {
    case .poweredOn:
      // Bluetooth is ready to use
      resolve(["status": "granted", "state": "poweredOn"])
      
    case .poweredOff:
      // User needs to enable Bluetooth in Settings
      reject("BLUETOOTH_OFF", "Bluetooth is powered off", nil)
      
    case .unauthorized:
      // App lacks Bluetooth permissions
      reject("UNAUTHORIZED", "Bluetooth access unauthorized", nil)
      
    case .unsupported:
      // Device doesn't support Bluetooth
      reject("UNSUPPORTED", "Bluetooth not supported", nil)
      
    case .resetting:
      // Bluetooth stack is resetting (temporary state)
      reject("RESETTING", "Bluetooth is resetting", nil)
      
    case .unknown:
      // State not yet determined, wait for delegate callback
      pendingPermissionResolvers.append((resolve, reject))
      
    @unknown default:
      reject("UNKNOWN", "Unknown Bluetooth state", nil)
    }
  }
  /// Check if Bluetooth is ready for operations
  /// - Parameters:
  ///   - resolve: Promise resolver returning ready state
  ///   - reject: Promise rejecter if manager not initialized
  @objc(isBLEReady:rejecter:)
  func isBLEReady(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    let isReady = manager.state == .poweredOn
    resolve(["isReady": isReady, "state": manager.state.rawValue])
  }
  // MARK: - Device Scanning (React Native API)
  
  /// Start BLE scanning for Smart Health Tag devices with configurable options
  /// - Supports targeted scanning (service UUID filter) and broad scanning (all devices)
  /// - Automatically falls back to broad scan if no devices found after 5 seconds
  /// - Parameters:
  ///   - options: Scan configuration (maxScanDurationMs, scanMode, useTargetedScan, allowDuplicates)
  ///   - resolve: Promise resolver returning scan status
  ///   - reject: Promise rejecter for BT not ready or other errors
  @objc(startScanningWithOptions:resolver:rejecter:)
  func startScanningWithOptions(options: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      rejectWithContext(reject: reject, errorCode: "NO_MANAGER", message: "Central manager not initialized", deviceId: "", characteristicUuid: "")
      return
    }
    
    guard manager.state == .poweredOn else {
      rejectWithContext(reject: reject, errorCode: "BT_NOT_READY", message: "Bluetooth not ready", deviceId: "", characteristicUuid: "")
      return
    }
    
    // Prevent duplicate scan starts
    if isScanning {
      resolve(["status": "already_scanning"])
      return
    }
    let settings = powerProfiles[currentPowerProfile] ?? PowerProfileConstants.profiles["default"]!
    let maxScanDurationMs = options["maxScanDurationMs"] as? Int ?? settings["maxScanDurationMs"] as? Int ?? 15000
    let scanMode = options["scanMode"] as? String ?? settings["scanMode"] as? String ?? "LowLatency"
    let allowDuplicates = options["allowDuplicates"] as? Bool ?? true
    manager.stopScan()
    var scanOptions: [String: Any] = [
      CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates
    ]
    if #available(iOS 13.0, *) {
      switch scanMode {
      case "LowPower":
        scanOptions[CBCentralManagerScanOptionSolicitedServiceUUIDsKey] = []
      case "Balanced":
        break
      case "LowLatency":
        break
      default:
        break
      }
    }
    let useTargetedScan = options["useTargetedScan"] as? Bool ?? false
    let servicesToScan: [CBUUID]?
    if useTargetedScan {
      servicesToScan = [smartTagServiceUUID]
      NSLog("🔍 [iOS] Starting FAST targeted BLE scan...")
      NSLog("   - Strategy: Service UUID filter (⚡ Fast)")
      NSLog("   - Service UUID: 0f0e0d0c-0b0a-0908-0706-050403020100")
    } else {
      servicesToScan = nil
      NSLog("🔍 [iOS] Starting BROAD BLE scan...")
      NSLog("   - Strategy: No filter (🐌 Slower but catches all)")
    }
    NSLog("   - Scan mode: \(scanMode)")
    NSLog("   - Allow duplicates: \(allowDuplicates)")
    NSLog("   - Duration: \(maxScanDurationMs)ms")
    NSLog("   - Also looking for: DyreID, Health Tag device name")
    NSLog("   - Or Manufacturer ID: 0x1234")
    
    // First, sync any system-connected devices to our bonded list
    syncSystemBondedDevices()
    
    // CRITICAL FIX: iOS hides connected peripherals from scan results
    // We must retrieve and emit them explicitly so they appear in the UI
    // Use multiple service UUIDs to catch devices connected with different service discovery states
    let allServiceUUIDs = [
      smartTagServiceUUID,
      BATTERY_SERVICE_UUID,
      DEVICE_INFO_SERVICE_UUID,
      GENERIC_ACCESS_SERVICE_UUID
    ]
    
    var allConnectedPeripherals: [CBPeripheral] = []
    var seenIdentifiers: Set<UUID> = []
    
    // Try each service UUID - iOS only returns peripherals that have discovered that service
    for serviceUUID in allServiceUUIDs {
      let peripheralsForService = manager.retrieveConnectedPeripherals(withServices: [serviceUUID])
      for peripheral in peripheralsForService {
        if !seenIdentifiers.contains(peripheral.identifier) {
          seenIdentifiers.insert(peripheral.identifier)
          allConnectedPeripherals.append(peripheral)
        }
      }
    }
    
    NSLog("   📱 Checking for system-connected peripherals...")
    NSLog("      - Queried \(allServiceUUIDs.count) service UUIDs")
    NSLog("      - Found \(allConnectedPeripherals.count) unique connected peripheral(s)")
    
    if !allConnectedPeripherals.isEmpty {
      NSLog("   ✅ Found already-connected peripheral(s) - emitting to UI:")
      for peripheral in allConnectedPeripherals {
        let deviceId = peripheral.identifier.uuidString
        let deviceName = peripheral.name ?? "Unknown"
        let isDyreID = deviceName.contains("DyreID") || deviceName.contains("Health Tag")
        NSLog("      • \(deviceName) (\(deviceId)) - ALREADY CONNECTED (isDyreID: \(isDyreID))")
        
        // Store the peripheral reference in scannedDevices so it can be connected to
        scannedDevices[deviceId] = peripheral
        
        // Emit as DeviceFound so it appears in the scan list
        let deviceInfo: [String: Any] = [
          "id": deviceId,
          "name": deviceName,
          "rssi": -50, // Placeholder - connected devices don't have real-time RSSI
          "isConnected": true, // Mark as already connected
          "isRetrieved": true, // Indicate this was retrieved, not scanned
          "advertisementData": [:],
          "manufacturerData": [:]
        ]
        
        DispatchQueue.main.async {
          self.sendEvent(withName: "DeviceFound", body: deviceInfo)
        }
      }
    } else {
      NSLog("      - No system-connected peripherals found via retrieveConnectedPeripherals")
    }
    
    // Also check bonded device IDs stored in app preferences
    let bondedIds = bondedDeviceIDs.compactMap { UUID(uuidString: $0) }
    if !bondedIds.isEmpty {
      NSLog("   📱 Checking \(bondedIds.count) bonded device ID(s)...")
      let bondedPeripherals = manager.retrievePeripherals(withIdentifiers: bondedIds)
      NSLog("      - Retrieved \(bondedPeripherals.count) bonded peripheral(s) from iOS")
      
      for peripheral in bondedPeripherals {
        let deviceId = peripheral.identifier.uuidString
        let deviceName = peripheral.name ?? "Unknown"
        let isAlreadyConnected = peripheral.state == CBPeripheralState.connected
        
        // Only emit if not already emitted above
        if !seenIdentifiers.contains(peripheral.identifier) {
          seenIdentifiers.insert(peripheral.identifier)
          NSLog("      • \(deviceName) (\(deviceId)) - Bonded (connected: \(isAlreadyConnected))")
          
          scannedDevices[deviceId] = peripheral
          
          let deviceInfo: [String: Any] = [
            "id": deviceId,
            "name": deviceName,
            "rssi": -55, // Placeholder
            "isConnected": isAlreadyConnected,
            "isRetrieved": true,
            "isBonded": true,
            "advertisementData": [:],
            "manufacturerData": [:]
          ]
          
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceFound", body: deviceInfo)
          }
        }
      }
    }
    
    // Also check cached device IDs from previous scans (scannedDevices)
    let cachedIds = Array(scannedDevices.keys).compactMap { UUID(uuidString: $0) }
    if !cachedIds.isEmpty {
      let retrievedPeripherals = manager.retrievePeripherals(withIdentifiers: cachedIds)
      NSLog("   📱 Retrieved \(retrievedPeripherals.count) cached peripheral(s) from previous scans")
      
      for peripheral in retrievedPeripherals {
        let deviceId = peripheral.identifier.uuidString
        let deviceName = peripheral.name ?? "Unknown"
        let isAlreadyConnected = peripheral.state == CBPeripheralState.connected
        
        // Only emit if not already emitted above
        if !seenIdentifiers.contains(peripheral.identifier) {
          seenIdentifiers.insert(peripheral.identifier)
          NSLog("      • \(deviceName) (\(deviceId)) - Cached (connected: \(isAlreadyConnected))")
          
          scannedDevices[deviceId] = peripheral
          
          let deviceInfo: [String: Any] = [
            "id": deviceId,
            "name": deviceName,
            "rssi": -60, // Placeholder
            "isConnected": isAlreadyConnected,
            "isRetrieved": true,
            "advertisementData": [:],
            "manufacturerData": [:]
          ]
          
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceFound", body: deviceInfo)
          }
        }
      }
    }
    manager.scanForPeripherals(
      withServices: servicesToScan,
      options: scanOptions
    )
    isScanning = true
    let scanStartTime = Date()
    let initialDeviceCount = scannedDevices.count
    if useTargetedScan {
      DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
        guard let self = self else { return }
        let foundNewDevices = self.scannedDevices.count > initialDeviceCount
        if self.isScanning && !foundNewDevices {
          NSLog("   🔄 Switching to BROAD scan (no service filter)...")
          manager.stopScan()
          manager.scanForPeripherals(
            withServices: nil,  
            options: scanOptions
          )
        } else if foundNewDevices {
        }
      }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(maxScanDurationMs) / 1000.0) { [weak self] in
      guard let self = self else { return }
      if self.isScanning {
        manager.stopScan()
        self.isScanning = false
        self.lastScanStopTime = Date()
        let scanDuration = Date().timeIntervalSince(scanStartTime)
        let devicesFound = self.scannedDevices.count - initialDeviceCount
        NSLog("⏹️ [iOS] Scan completed after \(String(format: "%.1f", scanDuration))s")
        NSLog("   - Total devices in list: \(self.scannedDevices.count)")
        if devicesFound == 0 {
          NSLog("      • Device is powered on and advertising")
          NSLog("      • Device is within range (< 10m)")
          NSLog("      • Bluetooth is enabled on iPhone")
          NSLog("      • Location services are enabled (required for BLE on iOS)")
          NSLog("      • Device name contains 'DyreID' or 'Health Tag'")
          NSLog("      • Device advertises Service UUID: 0f0e0d0c-0b0a-0908-0706-050403020100")
        } else {
          NSLog("   ✅ Scan successful!")
        }
      }
    }
    var isInBackground = false
    DispatchQueue.main.sync {
      isInBackground = UIApplication.shared.applicationState == .background
    }
    resolve([
      "status": "scanning_started", 
      "duration": maxScanDurationMs, 
      "mode": scanMode,
      "powerProfile": currentPowerProfile,
      "isBackground": isInBackground
    ])
  }
  /// Start BLE scanning with default options (convenience wrapper)
  /// - Parameters:
  ///   - resolve: Promise resolver returning scan status
  ///   - reject: Promise rejecter for errors
  @objc(startScanning:rejecter:)
  func startScanning(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    startScanningWithOptions(options: [:], resolver: resolve, rejecter: reject)
  }
  
  /// Stop BLE scanning
  /// - Parameters:
  ///   - resolve: Promise resolver returning stop status
  ///   - reject: Promise rejecter if manager not initialized
  @objc(stopScanning:rejecter:)
  func stopScanning(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    manager.stopScan()
    isScanning = false
    lastScanStopTime = Date()
    
    resolve(["status": "scanning_stopped"])
  }
  // MARK: - Device Connection (React Native API)
  
  /// Connect to a discovered BLE device with configurable options
  /// - Handles manual and auto-connect scenarios
  /// - Implements connection timeout with automatic retry (1 retry attempt)
  /// - Supports forgotten device override for manual connections
  /// - Parameters:
  ///   - deviceId: UUID string of the device to connect to
  ///   - options: Connection options (isManualConnection, connectionIntervalMs, supervisionTimeoutMs, connectionLatency)
  ///   - resolve: Promise resolver returning connection status
  ///   - reject: Promise rejecter for connection failures
  @objc(connectToDeviceWithOptions:options:resolver:rejecter:)
  func connectToDeviceWithOptions(deviceId: String, options: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // PRE_CHECK: Industry standard - verify Bluetooth is powered on before connecting
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready - state: \(manager.state.rawValue)", nil)
      return
    }
    let isManualConnection = options["isManualConnection"] as? Bool ?? false
    if forgottenDeviceIDs.contains(deviceId) {
      if !isManualConnection {
        reject("DEVICE_FORGOTTEN", "Device has been forgotten and cannot be auto-connected", nil)
        return
      }
      forgottenDeviceIDs.remove(deviceId)
      saveForgottenDevices()
    }
    if isManualConnection {
      manualDisconnectInProgress.remove(deviceId)
    }
    let connectionIntervalMs = options["connectionIntervalMs"] as? Int ?? 50
    // Industry standard: 8-10s connection timeout
    let supervisionTimeoutMs = options["supervisionTimeoutMs"] as? Int ?? 9000
    let connectionLatency = options["connectionLatency"] as? Int ?? 0
    guard let peripheral = scannedDevices[deviceId] else {
      reject("DEVICE_NOT_FOUND", "Device not found in scanned devices", nil)
      return
    }
    if connectedPeripherals.contains(peripheral) {
      resolve(["status": "already_connected", "deviceId": deviceId])
      return
    }
    if connectingPeripherals[deviceId] != nil {
      resolve(["status": "already_connecting", "deviceId": deviceId])
      return
    }
    let promiseKey = "connect_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    connectingPeripherals[deviceId] = peripheral
    peripheral.delegate = self
    var connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
    ]
    if #available(iOS 13.0, *) {
      if connectionIntervalMs > 100 {
        connectionOptions[CBConnectPeripheralOptionStartDelayKey] = 0.1
      }
    }
    manager.connect(peripheral, options: connectionOptions)
    let timeoutSeconds = Double(supervisionTimeoutMs) / 1000.0
    let timeoutWorkItem = DispatchWorkItem { [weak self] in
      guard let self = self else { return }
      if let connectingPeripheral = self.connectingPeripherals[deviceId] {
        NSLog("⏱️ [CONNECTION TIMEOUT] Connection timeout after \(timeoutSeconds)s for device: \(deviceId)")
        manager.cancelPeripheralConnection(connectingPeripheral)
        self.connectingPeripherals.removeValue(forKey: deviceId)
        let retryCount = self.connectionRetryAttempts[deviceId] ?? 0
        if retryCount < self.MAX_CONNECTION_RETRY_ATTEMPTS {
          self.connectionRetryAttempts[deviceId] = retryCount + 1
          // Industry standard backoff: 1-2s, 5s, 10-15s
          let backoffDelay: TimeInterval
          switch retryCount {
          case 0: backoffDelay = self.CONNECTION_RETRY_DELAY_MS  // 1-2s
          case 1: backoffDelay = self.CONNECTION_RETRY_DELAY_2      // 5s
          default: backoffDelay = self.CONNECTION_RETRY_DELAY_3   // 10-15s
          }
          NSLog("🔄 [RETRY] Attempting automatic retry \(retryCount + 1)/\(self.MAX_CONNECTION_RETRY_ATTEMPTS) after \(backoffDelay)s (industry standard backoff)")
          self.connectionTimeoutTimers.removeValue(forKey: deviceId)
          DispatchQueue.main.asyncAfter(deadline: .now() + backoffDelay) { [weak self] in
            guard let self = self else { return }
            if let rejecter = self.pendingRejecters[promiseKey] {
              if let retryPeripheral = self.scannedDevices[deviceId] {
                NSLog("🔄 Retrying connection to: \(deviceId)")
                self.connectingPeripherals[deviceId] = retryPeripheral
                retryPeripheral.delegate = self
                manager.connect(retryPeripheral, options: connectionOptions)
                let retryTimeoutWorkItem = DispatchWorkItem { [weak self] in
                  guard let self = self else { return }
                  if let connectingPeripheral = self.connectingPeripherals[deviceId] {
                    manager.cancelPeripheralConnection(connectingPeripheral)
                    self.connectingPeripherals.removeValue(forKey: deviceId)
                    self.connectionRetryAttempts.removeValue(forKey: deviceId)
                    self.connectionTimeoutTimers.removeValue(forKey: deviceId)
                    if let rejecter = self.pendingRejecters[promiseKey] {
                      rejecter("CONNECTION_TIMEOUT", "Connection timed out after retry. Please ensure device is in range and try again.", nil)
                      self.pendingPromises.removeValue(forKey: promiseKey)
                      self.pendingRejecters.removeValue(forKey: promiseKey)
                    }
                  }
                }
                self.connectionTimeoutTimers[deviceId] = retryTimeoutWorkItem
                DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: retryTimeoutWorkItem)
              } else {
                self.connectionRetryAttempts.removeValue(forKey: deviceId)
                rejecter("DEVICE_NOT_FOUND", "Device not found during retry. Please scan again.", nil)
                self.pendingPromises.removeValue(forKey: promiseKey)
                self.pendingRejecters.removeValue(forKey: promiseKey)
              }
            }
          }
        } else {
          NSLog("❌ Max retry attempts reached - connection failed")
          self.connectionRetryAttempts.removeValue(forKey: deviceId)
          self.connectionTimeoutTimers.removeValue(forKey: deviceId)
          if let rejecter = self.pendingRejecters[promiseKey] {
            let errorMessage = "Connection timed out after \(timeoutSeconds)s and \(retryCount + 1) attempt(s). Please ensure:\n" +
                              "• Device is powered on and in range\n" +
                              "• Device is not connected to another phone\n" +
                              "• Bluetooth is enabled\n" +
                              "• Try scanning again before connecting"
            rejecter("CONNECTION_TIMEOUT", errorMessage, nil)
            self.pendingPromises.removeValue(forKey: promiseKey)
            self.pendingRejecters.removeValue(forKey: promiseKey)
          }
        }
      }
    }
    connectionTimeoutTimers[deviceId] = timeoutWorkItem
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: timeoutWorkItem)
  }
  /// Connect to a device with default options (convenience wrapper)
  /// - Parameters:
  ///   - deviceId: UUID string of the device to connect to
  ///   - resolve: Promise resolver returning connection status
  ///   - reject: Promise rejecter for connection failures
  @objc(connectToDevice:resolver:rejecter:)
  func connectToDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    connectToDeviceWithOptions(deviceId: deviceId, options: [:], resolver: resolve, rejecter: reject)
  }
  
  /// Disconnect from a connected BLE device
  /// - Marks as manual disconnect (prevents auto-reconnect for 30 minutes)
  /// - Cancels all timers and cleans up resources
  /// - Parameters:
  ///   - deviceId: UUID string of the device to disconnect
  ///   - resolve: Promise resolver returning disconnection status
  ///   - reject: Promise rejecter if device not connected
  @objc(disconnectFromDevice:resolver:rejecter:)
  func disconnectFromDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    let peripheral = connectedPeripherals.first { $0.identifier.uuidString == deviceId }
    if let peripheral = peripheral {
      manualDisconnectInProgress.insert(deviceId)
      DispatchQueue.main.asyncAfter(deadline: .now() + 1800.0) { 
        if self.manualDisconnectInProgress.contains(deviceId) {
          self.manualDisconnectInProgress.remove(deviceId)
        }
      }
      manager.cancelPeripheralConnection(peripheral)
      connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
      connectingPeripherals.removeValue(forKey: deviceId)
      connectionTimeoutTimers[deviceId]?.cancel()
      connectionTimeoutTimers.removeValue(forKey: deviceId)
      connectionRetryAttempts.removeValue(forKey: deviceId)
      if let timer = serviceDiscoveryTimers[deviceId] {
        timer.invalidate()
        serviceDiscoveryTimers.removeValue(forKey: deviceId)
      }
      if let timer = reconnectTimers[deviceId] {
        timer.invalidate()
        reconnectTimers.removeValue(forKey: deviceId)
        reconnectBackoff.removeValue(forKey: deviceId)
        reconnectAttempts.removeValue(forKey: deviceId) 
      }
      resolve(["status": "disconnection_initiated", "deviceId": deviceId])
    } else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
    }
  }
  // MARK: - Characteristic Operations (React Native API)
  
  /// Read a BLE characteristic value
  /// - Validates device connection and characteristic properties before reading
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - characteristicUuid: UUID string of the characteristic to read
  ///   - resolve: Promise resolver returning characteristic data (hex string)
  ///   - reject: Promise rejecter for validation or read failures
  @objc(readCharacteristic:characteristicUuid:resolver:rejecter:)
  func readCharacteristic(deviceId: String, characteristicUuid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard validateOperation(deviceId: deviceId, characteristicUuid: characteristicUuid, operation: "read") else {
      rejectWithContext(reject: reject, errorCode: "VALIDATION_FAILED", message: "Operation validation failed", deviceId: deviceId, characteristicUuid: characteristicUuid)
      return
    }
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      rejectWithContext(reject: reject, errorCode: "DEVICE_NOT_CONNECTED", message: "Device not connected", deviceId: deviceId, characteristicUuid: characteristicUuid)
      return
    }
    guard let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) else {
      rejectWithContext(reject: reject, errorCode: "CHARACTERISTIC_NOT_FOUND", message: "Characteristic not found", deviceId: deviceId, characteristicUuid: characteristicUuid)
      return
    }
    let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    peripheral.readValue(for: characteristic)
  }
  @objc(writeCharacteristic:characteristicUuid:data:resolver:rejecter:)
  func writeCharacteristic(deviceId: String, characteristicUuid: String, data: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    guard let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) else {
      reject("CHARACTERISTIC_NOT_FOUND", "Characteristic not found", nil)
      return
    }
    guard characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) else {
      reject("CHARACTERISTIC_NOT_WRITABLE", "Characteristic not writable", nil)
      return
    }
    guard let dataBytes = dataFromHexString(data) else {
      reject("INVALID_DATA", "Invalid hex data", nil)
      return
    }
    let promiseKey = "write_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    if characteristic.properties.contains(.write) {
      peripheral.writeValue(dataBytes, for: characteristic, type: .withResponse)
    } else {
      peripheral.writeValue(dataBytes, for: characteristic, type: .withoutResponse)
    }
  }
  @objc(enableNotifications:characteristicUuid:resolver:rejecter:)
  func enableNotifications(deviceId: String, characteristicUuid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    guard let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) else {
      reject("CHARACTERISTIC_NOT_FOUND", "Characteristic not found", nil)
      return
    }
    guard characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
      reject("CHARACTERISTIC_NOT_NOTIFIABLE", "Characteristic not notifiable", nil)
      return
    }
    let promiseKey = "notify_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    peripheral.setNotifyValue(true, for: characteristic)
  }
  @objc(discoverServices:resolver:rejecter:)
  func discoverServices(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    let promiseKey = "discover_services_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    let timeoutTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      self.serviceDiscoveryTimers.removeValue(forKey: deviceId)
      if let rejecter = self.pendingRejecters[promiseKey] {
        rejecter("SERVICE_DISCOVERY_TIMEOUT", "Service discovery timeout after 10 seconds", nil)
        self.pendingPromises.removeValue(forKey: promiseKey)
        self.pendingRejecters.removeValue(forKey: promiseKey)
      }
    }
    serviceDiscoveryTimers[deviceId] = timeoutTimer
    peripheral.discoverServices(nil)
  }
  @objc(readRSSI:resolver:rejecter:)
  func readRSSI(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    let promiseKey = "rssi_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    peripheral.readRSSI()
  }
  @objc(getManufacturerInfo:rejecter:)
  func getManufacturerInfo(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    resolve([
      "manufacturerId": SMART_TAG_MANUFACTURER_ID,
      "manufacturerIdHex": String(format: "0x%04X", SMART_TAG_MANUFACTURER_ID),
      "manufacturerIdLittleEndian": String(format: "0x%02X%02X", SMART_TAG_MANUFACTURER_ID & 0xFF, (SMART_TAG_MANUFACTURER_ID >> 8) & 0xFF)
    ])
  }
  // MARK: - Data Sync Command Sequence (React Native API)
  
  /// Start the command sequence to initialize device for data sync
  /// - Sequence: Check RTC validity → Set time if needed → Enable notifications → Start data acquisition
  /// - Prevents duplicate sequence starts (checks if already running)
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - resolve: Promise resolver returning sequence status
  ///   - reject: Promise rejecter (currently unused, always resolves)
  @objc(startCommandSequence:resolver:rejecter:)
  func startCommandSequence(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let isAlreadyRunning = systemCommandsSent[deviceId] == true
    let currentState = dataSyncState[deviceId] ?? "idle"
    // "ready" is a connection state, not a sync state. Only check actual sync states.
    let isSyncing = currentState == "syncing" || currentState == "time_syncing"
    if isAlreadyRunning || isSyncing {
      NSLog("   - Current state: \(currentState)")
      NSLog("   - Is syncing: \(isSyncing)")
      resolve([
        "status": "already_running",
        "message": "Command sequence already running for this device",
        "currentState": currentState,
        "systemCommandsSent": isAlreadyRunning
      ])
      return
    }
    systemCommandsSent[deviceId] = true
    dataSyncState[deviceId] = "idle"
    if dataSyncRequested[deviceId] != true {
      dataSyncRequested[deviceId] = false
    } else {
    }
    let rtcValid = deviceRTCValidity[deviceId]
    if rtcValid == nil || rtcValid == false {
      sendSetSystemTimeCommand(deviceId: deviceId)
    } else {
      // Only send sync start if initial sync hasn't been completed yet
      sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
    }
    resolve([
      "status": "success",
      "message": "Command sequence initiated",
      "deviceId": deviceId
    ])
  }
  /// Start manual data sync to retrieve historical records from device
  /// - Ensures device RTC is valid before starting sync (sets time if needed)
  /// - Implements SDD v1.4 multi-file sync (500 records per file/chunk)
  /// - Prevents duplicate sync starts
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - resolve: Promise resolver returning sync start status
  ///   - reject: Promise rejecter for sync start failures
  @objc(startDataSync:resolver:rejecter:)
  func startDataSync(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    NSLog("📤 Manual Data Sync Start requested for \(deviceId)")
    let currentState = dataSyncState[deviceId] ?? "idle"
    if currentState == "syncing" || currentState == "time_syncing" {
      let result: [String: Any] = [
        "status": "already_syncing",
        "message": "Data sync already in progress for this device",
        "deviceId": deviceId,
        "currentState": currentState
      ]
      resolve(result)
      return
    }
    dataSyncState[deviceId] = "idle"
    dataSyncRequested[deviceId] = true
    // Manual sync request - allow even if initial sync was completed
    hasCompletedInitialSync[deviceId] = false
    let rtcValid = deviceRTCValidity[deviceId]
    if rtcValid == nil || rtcValid == false {
      NSLog("   This prevents '0 records' error due to invalid device timestamp")
      sendSetSystemTimeCommand(deviceId: deviceId)
      DispatchQueue.main.asyncAfter(deadline: .now() + 6.0) { [weak self] in
        guard let self = self else { 
          reject("SYNC_ERROR", "Service deallocated during time sync", nil)
          return
        }
        if self.dataSyncRequested[deviceId] != true {
          self.dataSyncRequested[deviceId] = true
        }
        let success = self.sendDataSyncStartCommand(deviceId: deviceId, retryAttempt: 0)
        if success {
          resolve([
            "status": "success",
            "message": "Data sync started (time synced first)",
            "deviceId": deviceId,
            "state": self.dataSyncState[deviceId] ?? "unknown",
            "timeSyncRequired": true
          ])
        } else {
          reject("SYNC_START_ERROR", "Failed to send data sync start command after time sync", nil)
        }
      }
    } else {
      let success = sendDataSyncStartCommand(deviceId: deviceId, retryAttempt: 0)
      if success {
        resolve([
          "status": "success",
          "message": "Data sync started immediately (RTC already valid)",
          "deviceId": deviceId,
          "state": dataSyncState[deviceId] ?? "unknown",
          "timeSyncRequired": false
        ])
      } else {
        reject("SYNC_START_ERROR", "Failed to send data sync start command", nil)
      }
    }
  }
  @objc(readDeviceStatus:resolver:rejecter:)
  func readDeviceStatus(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    guard let smartTagService = peripheral.services?.first(where: { $0.uuid == SMART_TAG_SERVICE_UUID }),
          let deviceStatusChar = smartTagService.characteristics?.first(where: { $0.uuid == DEVICE_STATUS_CHAR_UUID }) else {
      reject("CHARACTERISTIC_NOT_FOUND", "Device Status characteristic not found", nil)
      return
    }
    peripheral.readValue(for: deviceStatusChar)
    resolve([
      "status": "success",
      "message": "Reading device status",
      "deviceId": deviceId
    ])
  }
  private func startPostSyncKeepAlive(deviceId: String) {
    keepAliveTimers[deviceId]?.invalidate()
    NSLog("🔋 [KEEP-ALIVE] Starting connection maintenance for \(deviceId) after sync completion")
    NSLog("   Duration: \(POST_SYNC_KEEP_ALIVE_DURATION) seconds")
    NSLog("   Interval: \(KEEP_ALIVE_INTERVAL) seconds")
    let startTime = Date()
    var readCount = 0
    let timer = Timer.scheduledTimer(withTimeInterval: KEEP_ALIVE_INTERVAL, repeats: true) { [weak self] timer in
      guard let self = self else {
        timer.invalidate()
        return
      }
      guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
        NSLog("🔋 [KEEP-ALIVE] Device \(deviceId) no longer connected, stopping keep-alive")
        timer.invalidate()
        self.keepAliveTimers.removeValue(forKey: deviceId)
        return
      }
      let elapsed = Date().timeIntervalSince(startTime)
      if elapsed >= self.POST_SYNC_KEEP_ALIVE_DURATION {
        NSLog("🔋 [KEEP-ALIVE] Completed \(POST_SYNC_KEEP_ALIVE_DURATION)s maintenance period for \(deviceId)")
        NSLog("   Total keep-alive reads: \(readCount)")
        timer.invalidate()
        self.keepAliveTimers.removeValue(forKey: deviceId)
        return
      }
      if let smartTagService = peripheral.services?.first(where: { $0.uuid == self.SMART_TAG_SERVICE_UUID }),
         let deviceStatusChar = smartTagService.characteristics?.first(where: { $0.uuid == self.DEVICE_STATUS_CHAR_UUID }) {
        // ✅ FIX: Verify notifications are still enabled during keep-alive (first read only)
        if readCount == 0 {
          self.ensureNotificationsEnabledAfterSync(deviceId: deviceId, peripheral: peripheral)
        }
        readCount += 1
        peripheral.readValue(for: deviceStatusChar)
        NSLog("🔋 [KEEP-ALIVE] Read #\(readCount) - Maintaining connection for \(deviceId)")
      } else {
        NSLog("⚠️ [KEEP-ALIVE] Cannot find Device Status characteristic for \(deviceId)")
      }
    }
    keepAliveTimers[deviceId] = timer
    RunLoop.main.add(timer, forMode: .common)
  }
  /// ✅ FIX: Ensure Data Transfer notifications remain enabled after sync for push-generated records
  private func ensureNotificationsEnabledAfterSync(deviceId: String, peripheral: CBPeripheral) {
    guard let allCharacteristics = deviceCharacteristics[deviceId] else {
      NSLog("⚠️ [NOTIFICATIONS] Cannot verify notifications - characteristics not found for \(deviceId)")
      return
    }
    var notificationsReEnabled = false
    for characteristic in allCharacteristics {
      let charUuid = characteristic.uuid.uuidString
      // Critical: Data Transfer must remain enabled for push-generated records (type 0x03)
      if charUuid == DATA_TRANSFER_CHAR_UUID.uuidString {
        if !characteristic.isNotifying {
          NSLog("⚠️ [NOTIFICATIONS] Data Transfer notifications DISABLED after sync - re-enabling for \(deviceId)")
          peripheral.setNotifyValue(true, for: characteristic)
          notificationsReEnabled = true
        } else {
          NSLog("✅ [NOTIFICATIONS] Data Transfer notifications still enabled for \(deviceId)")
        }
      }
      // Also verify Device Status notifications (for keep-alive)
      if charUuid == DEVICE_STATUS_CHAR_UUID.uuidString {
        if !characteristic.isNotifying {
          NSLog("⚠️ [NOTIFICATIONS] Device Status notifications DISABLED after sync - re-enabling for \(deviceId)")
          peripheral.setNotifyValue(true, for: characteristic)
          notificationsReEnabled = true
        }
      }
    }
    if notificationsReEnabled {
      NSLog("✅ [NOTIFICATIONS] Re-enabled critical notifications after sync for \(deviceId)")
      NSLog("   This ensures push-generated records (type 0x03) will be received")
    }
  }
  @objc(getDataSyncState:resolver:rejecter:)
  func getDataSyncState(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let state = dataSyncState[deviceId] ?? "idle"
    let retryCount = dataSyncRetryCount[deviceId] ?? 0
    let recordCount = deviceRecordCounts[deviceId] ?? 0
    resolve([
      "deviceId": deviceId,
      "state": state,
      "retryCount": retryCount,
      "expectedRecords": recordCount
    ])
  }
  private func rejectWithContext(reject: @escaping RCTPromiseRejectBlock, errorCode: String, message: String, deviceId: String, characteristicUuid: String) {
    let errorMap: [String: Any] = [
      "code": errorCode,
      "message": message,
      "deviceId": deviceId,
      "characteristicUuid": characteristicUuid,
      "timestamp": Date().timeIntervalSince1970
    ]
    let errorKey = "\(deviceId)_\(characteristicUuid)_\(Date().timeIntervalSince1970)"
    errorContexts[errorKey] = errorMap
    reject(errorCode, message, NSError(domain: "BLEError", code: 1, userInfo: errorMap))
  }
  private func handleOperationError(deviceId: String, characteristicUuid: String, operation: String, error: Error) {
    let errorKey = "\(deviceId)_\(characteristicUuid)_\(operation)"
    let attempts = retryAttempts[errorKey] ?? 0
    if attempts < maxRetryAttempts {
      retryAttempts[errorKey] = attempts + 1
      let delay = Double(attempts + 1) * 2.0 
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.retryOperation(deviceId: deviceId, characteristicUuid: characteristicUuid, operation: operation)
      }
    } else {
      retryAttempts.removeValue(forKey: errorKey)
    }
  }
  private func retryOperation(deviceId: String, characteristicUuid: String, operation: String) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      return
    }
    switch operation {
    case "read":
      if let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) {
        peripheral.readValue(for: characteristic)
      }
    case "write":
      break
    case "notify":
      if let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) {
        peripheral.setNotifyValue(true, for: characteristic)
      }
    default:
      break
    }
  }
  private func validateOperation(deviceId: String, characteristicUuid: String, operation: String) -> Bool {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      return false
    }
    guard let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) else {
      return false
    }
    switch operation {
    case "read":
      guard characteristic.properties.contains(.read) else {
        return false
      }
    case "write":
      guard characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) else {
        return false
      }
    case "notify":
      guard characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
        return false
      }
    default:
      return false
    }
    return true
  }
  private func handleCharacteristicData(deviceId: String, characteristic: CBCharacteristic, data: Data) {
    let charUuid = characteristic.uuid.uuidString
    if charUuid == DEVICE_STATUS_CHAR_UUID.uuidString {
      parseDeviceStatusData(deviceId: deviceId, data: data)
    } else if charUuid == SYSTEM_COMMAND_CHAR_UUID.uuidString {
      parseSystemCommandResponse(deviceId: deviceId, data: data)
    } else if charUuid == DATA_TRANSFER_CHAR_UUID.uuidString {
      parseDataTransferData(deviceId: deviceId, data: data)
    } else if charUuid == BATTERY_LEVEL_CHAR_UUID.uuidString {
      if data.count > 0 {
        let batteryLevel = data[0]
        sendDeviceDataUpdateEvent(deviceId: deviceId, batteryLevel: Int(batteryLevel))
      }
    } else if charUuid == MANUFACTURER_NAME_CHAR_UUID.uuidString {
      if data.count > 0 {
        let manufacturerName = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.main.async {
          self.sendEvent(withName: "CharacteristicData", body: [
            "deviceId": deviceId,
            "characteristicUuid": charUuid,
            "data": manufacturerName,
            "hex": self.dataToHexString(data)
          ])
        }
      }
    } else if charUuid == MODEL_NUMBER_CHAR_UUID.uuidString {
      if data.count > 0 {
        let modelNumber = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.main.async {
          self.sendEvent(withName: "CharacteristicData", body: [
            "deviceId": deviceId,
            "characteristicUuid": charUuid,
            "data": modelNumber,
            "hex": self.dataToHexString(data)
          ])
        }
      }
    } else if charUuid == FIRMWARE_REVISION_CHAR_UUID.uuidString {
      if data.count > 0 {
        let firmwareRevision = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.main.async {
          self.sendEvent(withName: "CharacteristicData", body: [
            "deviceId": deviceId,
            "characteristicUuid": charUuid,
            "data": firmwareRevision,
            "hex": self.dataToHexString(data)
          ])
        }
      }
    }
  }
  private func parseDeviceStatusData(deviceId: String, data: Data) {
    guard data.count >= BLEProtocolConstants.minDeviceStatusSize else {
      return
    }
    let timestamp = data.withUnsafeBytes { $0.load(as: UInt32.self) }
    let recordCount = data.subdata(in: 4..<6).withUnsafeBytes { $0.load(as: UInt16.self) }
      let batteryVoltage = data.subdata(in: 6..<8).withUnsafeBytes { $0.load(as: UInt16.self) }
      let BATTERY_MIN_MV: UInt16 = 0     
      let BATTERY_MAX_MV: UInt16 = 3000  
      var batteryPercentage = 0
      if batteryVoltage >= BATTERY_MIN_MV && batteryVoltage <= BATTERY_MAX_MV {
        batteryPercentage = Int(round((Double(batteryVoltage) / Double(BATTERY_MAX_MV)) * 100.0))
      } else if batteryVoltage > BATTERY_MAX_MV {
        batteryPercentage = 100
      } else if batteryVoltage < BATTERY_MIN_MV {
        batteryPercentage = 0
      }
    let timestampDate = Date(timeIntervalSince1970: TimeInterval(timestamp))
    let currentDate = Date()
    let timeDiff = currentDate.timeIntervalSince1970 - TimeInterval(timestamp)
    let timeDiffAbsolute = abs(timeDiff)
    
    // RTC validation: Check both that timestamp is after Jan 1, 2020 AND within reasonable range of system time
    // FIX: Previously only checked if timestamp > 1577836800 (Jan 2020), which allowed devices with
    // significantly drifted clocks to be considered "valid" (e.g., 5+ days behind)
    // Now we also check if device time is within ±1 hour (3600 seconds) of phone time
    let maxAllowedTimeDriftSeconds: Double = 3600 // 1 hour
    let isTimestampAfterJan2020 = timestamp > 1577836800
    let isWithinReasonableRange = timeDiffAbsolute <= maxAllowedTimeDriftSeconds
    let isRTCValid = isTimestampAfterJan2020 && isWithinReasonableRange
    
    // Log detailed RTC validation info
    if !isRTCValid {
      if !isTimestampAfterJan2020 {
        NSLog("⚠️ [RTC VALIDATION] Device RTC is INVALID - timestamp before Jan 2020: \(timestamp)")
      } else if !isWithinReasonableRange {
        NSLog("⚠️ [RTC VALIDATION] Device RTC has SIGNIFICANT DRIFT - \(String(format: "%.2f", timeDiffAbsolute / 3600.0)) hours from system time")
        NSLog("   Device time: \(timestampDate)")
        NSLog("   System time: \(currentDate)")
        NSLog("   Time difference: \(Int(timeDiff)) seconds (\(String(format: "%.2f", timeDiff / 3600.0)) hours)")
        NSLog("   Max allowed drift: \(Int(maxAllowedTimeDriftSeconds)) seconds (1 hour)")
        NSLog("   → Will send SET_SYSTEM_TIME command to synchronize device clock")
      }
    } else {
      NSLog("✅ [RTC VALIDATION] Device RTC is VALID and synchronized (drift: \(Int(timeDiffAbsolute))s)")
    }
    
    deviceRTCValidity[deviceId] = isRTCValid
      let isPending = rtcCheckPendingBeforeNotifications[deviceId] == true
      if isPending {
        let currentSystemTime = UInt32(Date().timeIntervalSince1970)
        let timeDifference = Int64(currentSystemTime) - Int64(timestamp)
        let formatter = ISO8601DateFormatter()
        let timeDifferenceHours = Double(timeDifference) / 3600.0
        
        // Build RTCRead event with detailed validation info
        var rtcEventBody: [String: Any] = [
          "deviceId": deviceId,
          "type": "rtc_read",
          "deviceRTC": timestamp,
          "deviceRTCISO": formatter.string(from: timestampDate),
          "systemTime": currentSystemTime,
          "systemTimeISO": formatter.string(from: currentDate),
          "timeDifference": timeDifference,
          "timeDifferenceAbsolute": Int64(timeDiffAbsolute),
          "rtcValid": isRTCValid,
          "timeDifferenceFormatted": String(format: "%.2f hours", timeDifferenceHours),
          "maxAllowedDriftSeconds": Int(maxAllowedTimeDriftSeconds)
        ]
        
        // Add reason for invalid RTC if applicable
        if !isRTCValid {
          if !isTimestampAfterJan2020 {
            rtcEventBody["invalidReason"] = "timestamp_before_jan_2020"
          } else if !isWithinReasonableRange {
            rtcEventBody["invalidReason"] = "significant_time_drift"
          }
        }
        
        self.sendEvent(withName: "RTCRead", body: rtcEventBody)
      }
      if isPending {
        rtcCheckPendingBeforeNotifications.removeValue(forKey: deviceId)
        guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
          return
        }
        
        // CORRECT FLOW (SDD v1.5): Notifications are ALREADY enabled at this point
        // Now we just need to handle RTC and proceed with data sync
        if !isRTCValid {
          // RTC invalid - send Set System Time command
          // Response (0xBB) will be received via System Command notification (already enabled)
          NSLog("📤 [RTC CHECK] RTC invalid - sending Set System Time command...")
          sendSetSystemTimeCommand(deviceId: deviceId)
        } else {
          // RTC is valid - proceed directly to data sync
          NSLog("✅ [RTC CHECK] RTC valid - proceeding with data sync...")
          confirmConnection(peripheral: peripheral, deviceId: deviceId)
          
          // Only send sync start if initial sync hasn't been completed yet
          let hasCompletedInitial = hasCompletedInitialSync[deviceId] == true
          if !hasCompletedInitial {
            sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
          } else {
            NSLog("📡 [RTC CHECK] Initial sync already completed - device will send push-generated records")
          }
        }
      }
      let syncState = dataSyncState[deviceId] ?? "unknown"
    let currentCount = deviceStatusNotificationCount[deviceId] ?? 0
    let notificationNum = currentCount + 1
    deviceStatusNotificationCount[deviceId] = notificationNum
    NSLog("═══════════════════════════════════════════════════════")
    NSLog("═══════════════════════════════════════════════════════")
    NSLog("   Device: \(deviceId)")
    NSLog("   Raw data: \(data.map { String(format: "%02X", $0) }.joined(separator: " "))")
    NSLog("   Timestamp: \(timestamp) → \(timestampDate)")
    NSLog("   Time diff from now: \(Int(timeDiff))s (\(timeDiff/3600.0) hours)")
    NSLog("   RTC Valid: \(isRTCValid ? "✅ YES" : "❌ NO")")
    NSLog("   ✅ Records Available: \(recordCount)")
    NSLog("   ✅ Battery: \(batteryVoltage)mV (\(batteryPercentage)%)")
    NSLog("   Sync State: \(syncState)")
    NSLog("   Note: Steps/Temperature are in Data Transfer records only")
    if notificationNum > 1 {
    }
    NSLog("═══════════════════════════════════════════════════════")
    // During grace period after sync complete, don't overwrite with higher tag count (tag may report stale value)
    // While sync is in progress, don't overwrite — tag may report mid-transfer value (e.g. 201 = progress)
    let shouldUpdateRecordCount: Bool
    if let lastSyncTime = lastSyncCompleteTime[deviceId] {
      let timeSinceSync = Date().timeIntervalSince(lastSyncTime)
      if timeSinceSync < SYNC_COMPLETE_GRACE_PERIOD_SECONDS {
        let current = deviceRecordCounts[deviceId] ?? 0
        if Int(recordCount) > current {
          NSLog("   [GRACE] Ignoring tag record count \(recordCount) (keeping \(current)) until grace period ends")
        }
        shouldUpdateRecordCount = false
      } else {
        lastSyncCompleteTime.removeValue(forKey: deviceId)
        shouldUpdateRecordCount = (syncState != "syncing")
      }
    } else {
      shouldUpdateRecordCount = (syncState != "syncing")
    }
    if shouldUpdateRecordCount {
      deviceRecordCounts[deviceId] = Int(recordCount)
    } else if syncState == "syncing" {
      let current = deviceRecordCounts[deviceId] ?? 0
      NSLog("   [SYNC IN PROGRESS] Ignoring tag record count \(recordCount) (keeping \(current)) until sync finishes")
    }
    let timestampMs = UInt64(timestamp) * 1000
    let deviceData: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": connectedPeripherals.first { $0.identifier.uuidString == deviceId }?.name ?? "Unknown",
      "timestamp": timestampMs,
      "batteryVoltage": batteryVoltage,      
      "recordCount": recordCount,            
      "lastUpdate": Date().timeIntervalSince1970 * 1000,
      "rawBuffer": dataToHexString(data),
      "sddCompliant": data.count == 8,
      "sddVersion": "1.3",                   
      "rtcValid": isRTCValid,
      "dataSource": isRTCValid ? "live" : "cached"
    ]
    NSLog("📤 Sending device status update (SDD v1.3) for: \(deviceId) - Battery Voltage: \(batteryVoltage)mV (percentage from 2A19), Records: \(recordCount), RTC Valid: \(isRTCValid)")
    sendDeviceDataUpdateEvent(deviceId: deviceId, deviceData: deviceData)
  }
  private func buildSystemCommandPacket(commandId: UInt8, payload: [UInt8] = []) -> Data {
    guard payload.count <= BLEProtocolConstants.maxPayloadSize else {
      let truncatedPayload = Array(payload.prefix(BLEProtocolConstants.maxPayloadSize))
      return buildSystemCommandPacket(commandId: commandId, payload: truncatedPayload)
    }
    var packet = Data(count: BLEProtocolConstants.packetSize)
    packet[0] = BLEProtocolConstants.requestId
    packet[1] = commandId
    packet[2] = UInt8(payload.count)
    for (index, byte) in payload.enumerated() {
      packet[3 + index] = byte
    }
    return packet
  }
  private func sendSystemCommand(deviceId: String, commandId: UInt8, payload: [UInt8] = []) -> Bool {
    if commandId == 0x04 && payload.count >= 4 {
      let intervalMs = UInt32(payload[0]) | (UInt32(payload[1]) << 8) | (UInt32(payload[2]) << 16) | (UInt32(payload[3]) << 24)
      let intervalSeconds = Int(intervalMs / 1000) 
      requestedDataAcquisitionIntervals[deviceId] = intervalSeconds
    }
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      return false
    }
    guard peripheral.state == .connected else {
      return false
    }
    guard let smartTagService = peripheral.services?.first(where: { $0.uuid == SMART_TAG_SERVICE_UUID }),
          let systemCommandChar = smartTagService.characteristics?.first(where: { $0.uuid == SYSTEM_COMMAND_CHAR_UUID }) else {
      return false
    }
    guard systemCommandChar.properties.contains(.write) || systemCommandChar.properties.contains(.writeWithoutResponse) else {
      return false
    }
    let packet = buildSystemCommandPacket(commandId: commandId, payload: payload)
    peripheral.writeValue(packet, for: systemCommandChar, type: .withResponse)
    var payloadHex = ""
    if payload.count > 0 {
      let previewCount = min(payload.count, 20)
      payloadHex = payload.prefix(previewCount).map { String(format: "0x%02X", $0) }.joined(separator: " ")
      if payload.count > 20 {
        payloadHex += "..."
      }
    } else {
      payloadHex = "No payload"
    }
    let commandName: String
    switch commandId {
    case 0x01: commandName = "Set System Time"
    case 0x02: commandName = "Set Advertising Interval"
    case 0x03: commandName = "Set Connection Interval"
    case 0x04: commandName = "Set Data Interval"
    case 0x05: commandName = "Get Firmware Version"
    case 0x06: commandName = "Get Hardware Version"
    case 0x07: commandName = "Get Diagnostics"
    case 0x08: commandName = "Data Sync Start"
    case 0x09: commandName = "Data Sync Stop"
    case 0x0A: commandName = "Enter DFU Mode"
    case 0x10: commandName = "System Restart"
    case 0x11: commandName = "Toggle Buzzer"
    case 0x12: commandName = "Unpair Device"
    case 0x13: commandName = "Factory Reset"
    case 0x14: commandName = "Passkey Update"
    default: commandName = String(format: "Unknown Command (0x%02X)", commandId)
    }
    var eventBody: [String: Any] = [
      "deviceId": deviceId,
      "commandId": commandId,
      "commandName": commandName,
      "payload": payloadHex,
      "payloadLength": payload.count
    ]
    if commandId == 0x01, let timestampInfo = setTimeTimestampInfo[deviceId] { 
      eventBody.merge(timestampInfo) { (_, new) in new }
    }
    self.sendEvent(withName: "NativeCommandSent", body: eventBody)
    return true
  }
  /// CORRECT FLOW (SDD v1.5): Enable notifications FIRST before any other operations
  /// This must be called immediately after characteristic discovery completes.
  /// Flow: Enable notifications → Read Device Status → Check RTC → Send Set Time if needed → Data Sync
  private func enableNotificationsFirst(peripheral: CBPeripheral, deviceId: String) {
    NSLog("🔔 [NOTIFICATIONS] enableNotificationsFirst called for \(deviceId) (SDD v1.5 correct flow)")
    
    // Guard against duplicate calls (race condition between auto-connect and RTC check paths)
    if notificationEnableInProgress[deviceId] == true {
      NSLog("⏭️ [NOTIFICATIONS] Notification enable already in progress for \(deviceId) - skipping duplicate call")
      return
    }
    notificationEnableInProgress[deviceId] = true
    
    guard let allCharacteristics = deviceCharacteristics[deviceId] else {
      NSLog("❌ [NOTIFICATIONS] Cannot enable notifications - characteristics not found for \(deviceId)")
      NSLog("   deviceCharacteristics keys: \(deviceCharacteristics.keys.joined(separator: ", "))")
      notificationEnableInProgress[deviceId] = false
      return
    }
    NSLog("✅ [NOTIFICATIONS] Found \(allCharacteristics.count) characteristics for \(deviceId)")
    
    // Initialize notification state tracking for this device
    if deviceNotificationStates[deviceId] == nil {
      deviceNotificationStates[deviceId] = Set<String>()
    }
    
    // The three critical characteristics that MUST be enabled before commands (matching nRF Connect pattern)
    let criticalCharacteristics = [
      SYSTEM_COMMAND_CHAR_UUID.uuidString,
      DEVICE_STATUS_CHAR_UUID.uuidString,
      DATA_TRANSFER_CHAR_UUID.uuidString
    ]
    
    var criticalEnabledCount = 0
    var foundCriticalChars: [String] = []
    for characteristic in allCharacteristics {
      let charUuid = characteristic.uuid.uuidString
      if charUuid == SYSTEM_COMMAND_CHAR_UUID.uuidString ||
         charUuid == DEVICE_STATUS_CHAR_UUID.uuidString ||
         charUuid == DATA_TRANSFER_CHAR_UUID.uuidString ||
         charUuid == BATTERY_LEVEL_CHAR_UUID.uuidString {
        
        foundCriticalChars.append(charUuid)
        let hasNotify = characteristic.properties.contains(.notify)
        let hasIndicate = characteristic.properties.contains(.indicate)
        NSLog("🔍 [NOTIFICATIONS] Found characteristic \(charUuid) - notify: \(hasNotify), indicate: \(hasIndicate), isNotifying: \(characteristic.isNotifying)")
        
        // Check if already enabled
        if characteristic.isNotifying {
          deviceNotificationStates[deviceId]?.insert(charUuid)
          if criticalCharacteristics.contains(charUuid) {
            criticalEnabledCount += 1
          }
          NSLog("✅ [NOTIFICATIONS] \(charUuid) already enabled for \(deviceId)")
        } else {
          // Enable notification
          if hasNotify || hasIndicate {
            peripheral.setNotifyValue(true, for: characteristic)
            NSLog("📤 [NOTIFICATIONS] Enabling notifications for \(charUuid) on \(deviceId)")
          } else {
            NSLog("⚠️ [NOTIFICATIONS] Characteristic \(charUuid) does not support notify/indicate")
          }
        }
        
        if charUuid == BATTERY_LEVEL_CHAR_UUID.uuidString && characteristic.properties.contains(.read) {
          peripheral.readValue(for: characteristic)
        }
      }
    }
    
    if foundCriticalChars.isEmpty {
      NSLog("❌ [NOTIFICATIONS] No critical characteristics found! Expected: \(criticalCharacteristics.joined(separator: ", "))")
      NSLog("   Available characteristics: \(allCharacteristics.map { $0.uuid.uuidString }.joined(separator: ", "))")
    } else {
      NSLog("✅ [NOTIFICATIONS] Found \(foundCriticalChars.count) critical characteristics: \(foundCriticalChars.joined(separator: ", "))")
      
      // Send ConnectionLog event for "Enabling Notifications"
      let characteristicsList: [[String: Any]] = foundCriticalChars.map { uuid in
        return ["uuid": uuid, "name": getCharacteristicName(uuid)]
      }
      let characteristicNames = foundCriticalChars.map { getCharacteristicName($0) }.joined(separator: ", ")
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Enabling Notifications",
          "count": foundCriticalChars.count,
          "characteristics": characteristicsList,
          "characteristicNames": characteristicNames,
          "platform": "iOS"
        ])
      }
    }
    
    // If all critical notifications are already enabled, proceed to RTC check immediately
    if criticalEnabledCount == 3 {
      NSLog("✅ [NOTIFICATIONS] All critical notifications already enabled for \(deviceId) - proceeding to RTC check")
      notificationEnableInProgress[deviceId] = false
      onAllNotificationsEnabled(peripheral: peripheral, deviceId: deviceId)
    } else {
      NSLog("⏳ [NOTIFICATIONS] Waiting for \(3 - criticalEnabledCount) critical notifications to enable for \(deviceId)")
      // Will proceed when didUpdateNotificationStateFor confirms all are enabled
      // Then checkAndExecutePendingCommands will call onAllNotificationsEnabled
    }
  }
  
  /// Called when all critical notifications are confirmed enabled
  /// This is the CORRECT place to check RTC (after notifications are ready)
  private func onAllNotificationsEnabled(peripheral: CBPeripheral, deviceId: String) {
    // Guard against duplicate calls - only run once per connection (race-safe)
    if rtcCheckPendingBeforeNotifications[deviceId] == true {
      NSLog("⏭️ [FLOW] RTC check already in progress for \(deviceId) - skipping duplicate call")
      return
    }
    if hasStartedInitialSync[deviceId] == true {
      NSLog("⏭️ [FLOW] Initial sync already started for \(deviceId) - skipping duplicate call")
      return
    }
    if hasCompletedInitialSync[deviceId] == true {
      NSLog("⏭️ [FLOW] Initial sync already completed for \(deviceId) - skipping duplicate call")
      return
    }
    // Claim RTC check immediately to prevent race when enableNotificationsFirst and didUpdateNotificationStateFor
    // both call onAllNotificationsEnabled in quick succession (SDD v1.5 single-path flow).
    rtcCheckPendingBeforeNotifications[deviceId] = true
    
    NSLog("✅ [FLOW] All notifications enabled for \(deviceId) - now reading Device Status to check RTC")
    
    // Update state
    deviceConnectionStates[deviceId] = .READY
    emitDeviceConnectedEvent(deviceId: deviceId, peripheral: peripheral)
    
    // Now read Device Status to check RTC
    guard let allCharacteristics = deviceCharacteristics[deviceId] else {
      NSLog("❌ [RTC CHECK] Cannot read Device Status - characteristics not found")
      confirmConnection(peripheral: peripheral, deviceId: deviceId)
      sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
      return
    }
    
    if let deviceStatusChar = allCharacteristics.first(where: { $0.uuid == DEVICE_STATUS_CHAR_UUID }) {
      NSLog("📖 [RTC CHECK] Reading Device Status characteristic to check RTC...")
      peripheral.readValue(for: deviceStatusChar)
    } else {
      NSLog("⚠️ [RTC CHECK] Device Status characteristic not found - skipping RTC check")
      confirmConnection(peripheral: peripheral, deviceId: deviceId)
      sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
    }
  }
  
  /// Check if all critical notifications are enabled and proceed with RTC check
  /// CORRECT FLOW: After notifications enabled → Read Device Status → Check RTC
  private func checkAndExecutePendingCommands(deviceId: String) {
    guard let notificationStates = deviceNotificationStates[deviceId] else {
      return
    }
    
    let criticalCharacteristics = [
      SYSTEM_COMMAND_CHAR_UUID.uuidString,
      DEVICE_STATUS_CHAR_UUID.uuidString,
      DATA_TRANSFER_CHAR_UUID.uuidString
    ]
    
    let allCriticalEnabled = criticalCharacteristics.allSatisfy { notificationStates.contains($0) }
    
    if allCriticalEnabled {
      NSLog("✅ [NOTIFICATIONS] All critical notifications confirmed enabled for \(deviceId)")
      
      // NOTE: Do NOT reset notificationEnableInProgress here!
      // It should remain set until device disconnects (cleared in cleanup)
      // This prevents duplicate notification enables from multiple code paths
      
      // Send ConnectionLog event for all notifications enabled
      let totalEnabled = notificationStates.count
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Notifications Enabled",
          "totalEnabled": totalEnabled,
          "status": "success",
          "platform": "iOS",
          "note": "All BLE notifications active - ready for data exchange"
        ])
      }
      
      // CORRECT FLOW: Now proceed to RTC check (notifications are ready)
      if let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) {
        onAllNotificationsEnabled(peripheral: peripheral, deviceId: deviceId)
      }
    }
  }
  
  private func sendSetSystemTimeCommand(deviceId: String, retryAttempt: Int = 0) {
    if retryAttempt == 0 {
      let currentState = dataSyncState[deviceId] ?? "idle"
      let isTimeSyncInProgress = currentState == "time_syncing"
      let hasPendingTimeSync = setTimeResponseReceived[deviceId] == false && setTimeTimeoutTimers[deviceId] != nil
      if isTimeSyncInProgress || hasPendingTimeSync {
        NSLog("   Current state: \(currentState), Has pending timer: \(hasPendingTimeSync)")
        return
      }
    }
    dataSyncState[deviceId] = "time_syncing"
    setTimeResponseReceived[deviceId] = false
    let currentTimestamp = UInt32(Date().timeIntervalSince1970)
    var payload: [UInt8] = []
    payload.append(UInt8(currentTimestamp & 0xFF))
    payload.append(UInt8((currentTimestamp >> 8) & 0xFF))
    payload.append(UInt8((currentTimestamp >> 16) & 0xFF))
    payload.append(UInt8((currentTimestamp >> 24) & 0xFF))
    let timestampHex = String(format: "%02X%02X%02X%02X", payload[0], payload[1], payload[2], payload[3])
    if retryAttempt > 0 {
    } else {
      NSLog("📤 Sending Set System Time command to \(deviceId)")
    }
    NSLog("   Command: AA 01 04 \(timestampHex)")
    NSLog("   Timestamp: \(currentTimestamp) (\(Date()))")
    if retryAttempt == 0 {
      let formatter = ISO8601DateFormatter()
      setTimeTimestampInfo[deviceId] = [
        "systemTimestamp": currentTimestamp,
        "systemTimestampISO": formatter.string(from: Date()),
        "timestampHex": timestampHex,
        "deviceRTCValid": deviceRTCValidity[deviceId] ?? false
      ]
    }
    let success = sendSystemCommand(deviceId: deviceId, commandId: 0x01, payload: payload)
    if retryAttempt == 0 {
      setTimeTimestampInfo.removeValue(forKey: deviceId)
    }
    if success {
      NSLog("✅ Set System Time command sent successfully")
      let timeoutTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] timer in
        guard let self = self else { return }
        if self.setTimeResponseReceived[deviceId] != true {
          let currentRetry = self.setTimeRetryAttempts[deviceId] ?? 0
          if currentRetry < 1 {
            NSLog("   Retrying SET TIME command (attempt \(currentRetry + 1)/2)...")
            self.setTimeRetryAttempts[deviceId] = currentRetry + 1
            self.setTimeTimeoutTimers.removeValue(forKey: deviceId)
            DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
              self?.sendSetSystemTimeCommand(deviceId: deviceId, retryAttempt: currentRetry + 1)
            }
          } else {
            NSLog("⚠️ [SET TIME] Timeout after retries - proceeding with data sync anyway")
            NSLog("   Device may not have valid time, but live updates will still work")
            self.setTimeTimeoutTimers.removeValue(forKey: deviceId)
            self.dataSyncState[deviceId] = "time_sync_failed"
            
            // CORRECT FLOW: Notifications are already enabled, just proceed with data sync
            guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
              return
            }
            self.confirmConnection(peripheral: peripheral, deviceId: deviceId)
            self.sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
          }
        } else {
          self.setTimeTimeoutTimers.removeValue(forKey: deviceId)
        }
      }
      setTimeTimeoutTimers[deviceId] = timeoutTimer
      RunLoop.current.add(timeoutTimer, forMode: .common)
    } else {
      NSLog("❌ Failed to send Set System Time command")
      dataSyncState[deviceId] = "idle"
      setTimeTimeoutTimers.removeValue(forKey: deviceId)
      if retryAttempt > 0 {
        // CORRECT FLOW: Notifications are already enabled, just proceed with data sync
        guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
          return
        }
        NSLog("⚠️ [SET TIME] Failed after retries - proceeding with data sync anyway")
        confirmConnection(peripheral: peripheral, deviceId: deviceId)
        sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
      }
    }
  }
  /// Enable data acquisition and live notifications
  /// - After initial sync: Only ensures notifications are enabled (device sends push-generated records automatically)
  /// - Before initial sync: Sends sync start command to retrieve historical records
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - forceSync: If true, forces sync start even if initial sync was completed (for manual sync requests)
  private func sendDataAcquisitionAndLiveNotifications(deviceId: String, forceSync: Bool = false) {
    let hasCompletedInitial = hasCompletedInitialSync[deviceId] == true
    let hasStartedInitial = hasStartedInitialSync[deviceId] == true
    
    // Guard: If sync already STARTED (but not completed), don't start again
    // This prevents multiple sync starts when receiving multiple Device Status notifications
    if hasStartedInitial && !hasCompletedInitial && !forceSync {
      NSLog("⏭️ [DATA SYNC] Initial sync already in progress for \(deviceId) - skipping duplicate sync start")
      return
    }
    
    // If initial sync already completed and not forcing, just ensure notifications are enabled for live data
    if hasCompletedInitial && !forceSync {
      NSLog("📡 [LIVE DATA] Initial sync already completed - ensuring notifications enabled for push-generated records")
      NSLog("   Device will automatically send records at data acquisition intervals (SDD v1.5)")
      // Ensure Data Transfer notifications are enabled (they should already be, but verify)
      if let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }),
         let allCharacteristics = deviceCharacteristics[deviceId] {
        for characteristic in allCharacteristics {
          if characteristic.uuid == DATA_TRANSFER_CHAR_UUID && !characteristic.isNotifying {
            NSLog("⚠️ [LIVE DATA] Data Transfer notifications disabled - re-enabling for \(deviceId)")
            peripheral.setNotifyValue(true, for: characteristic)
          }
        }
      }
      return
    }
    
    // RECOMMENDED FLOW (SDD v1.5): Do NOT auto-start sync here. JS decides after Device Status
    // (deviceRecordCount + lastAppRecordTimestamp). Sync is started by JS via startDataSync(deviceId)
    // when maybeTriggerAutoSyncFromDeviceStatus runs. Native only prepares "ready" state.
    dataSyncState[deviceId] = "ready"
    dataSyncRetryCount[deviceId] = 0
    NSLog("📦 [RECOMMENDED FLOW] GATT ready for \(deviceId) - sync will start from JS after Device Status + decide")
  }
  
  /// Industry fix (match Android): After SET_SYSTEM_TIME success, explicitly read Device Status
  /// so JS gets an updated DeviceDataUpdated event with valid RTC.
  /// Without this, JS maybeTriggerAutoSyncFromDeviceStatus exits early on first device status
  /// (RTC invalid) and never runs decide again because no new device status event arrives.
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - peripheral: The connected CBPeripheral
  private func triggerDeviceStatusReadAfterSetTime(deviceId: String, peripheral: CBPeripheral) {
    NSLog("📖 [POST SET TIME] Reading Device Status after RTC sync for \(deviceId)")
    
    guard let smartTagService = peripheral.services?.first(where: { $0.uuid == SMART_TAG_SERVICE_UUID }),
          let deviceStatusChar = smartTagService.characteristics?.first(where: { $0.uuid == DEVICE_STATUS_CHAR_UUID }) else {
      NSLog("⚠️ [POST SET TIME] Device Status characteristic not found - falling back to sendDataAcquisitionAndLiveNotifications")
      sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
      return
    }
    
    // Read Device Status - the result will flow through peripheral(_:didUpdateValueFor:error:)
    // which parses the data and emits DeviceDataUpdated event to JS.
    // JS maybeTriggerAutoSyncFromDeviceStatus will then run with valid RTC and trigger sync.
    peripheral.readValue(for: deviceStatusChar)
    NSLog("✅ [POST SET TIME] Device Status read initiated - JS will receive updated status with valid RTC")
    
    // Also mark GATT as ready so sendDataAcquisitionAndLiveNotifications logic is satisfied
    dataSyncState[deviceId] = "ready"
    dataSyncRetryCount[deviceId] = 0
  }
  
  /// Send Data Sync Stop command (AA09) to finalize data sync
  /// - Matches nRF Connect pattern: AA 09 02 [payload]
  /// - Parameters:
  ///   - deviceId: UUID string of the device
  ///   - recordsAcknowledged: Number of records to acknowledge (default: 500 to match AA08 request)
  /// - Returns: true if command was sent successfully
  private func sendDataSyncStopCommand(deviceId: String, recordsAcknowledged: UInt16 = 500) -> Bool {
    let currentState = dataSyncState[deviceId] ?? "idle"
    // Allow sending AA09 in "complete" state as well - it's an acknowledgment after sync completion
    // This matches nRF Connect pattern where AA09 is sent to acknowledge/cleanup after receiving sync complete
    guard currentState == "syncing" || currentState == "idle" || currentState == "complete" else {
      NSLog("⚠️ [AA09] Cannot send Data Sync Stop - invalid state: \(currentState)")
      return false
    }
    
    NSLog("📤 [AA09] Sending Data Sync Stop command to \(deviceId)")
    // Match nRF Connect pattern: AA 09 02 [2-byte payload]
    // Using same record count as AA08 request (500 = 0x01F4) for consistency
    let stopPayload: [UInt8] = [
      UInt8(recordsAcknowledged & 0xFF),           // LSB
      UInt8((recordsAcknowledged >> 8) & 0xFF)     // MSB
    ]
    let payloadHex = stopPayload.map { String(format: "%02X", $0) }.joined(separator: " ")
    NSLog("   Command: AA 09 02 \(payloadHex) (acknowledging \(recordsAcknowledged) records)")
    
    let success = sendSystemCommand(deviceId: deviceId, commandId: 0x09, payload: stopPayload)
    if success {
      NSLog("✅ [AA09] Data Sync Stop command sent successfully")
      // Don't reset state here - let the response handler do it
    } else {
      NSLog("❌ [AA09] Failed to send Data Sync Stop command")
    }
    return success
  }
  
  private func sendDataSyncStartCommand(deviceId: String, retryAttempt: Int = 0) -> Bool {
    let currentState = dataSyncState[deviceId] ?? "idle"
    // Continuation chunk (file #2+): allow sending DATA_SYNC_START even when dataSyncState == "syncing" (we stay "syncing" during multi-chunk).
    // First chunk only: block if already syncing or time_syncing so we don't overlap with other setup.
    let currentFileNumForBusyCheck = syncCurrentFileNumber[deviceId] ?? 1
    let isContinuationChunk = (currentFileNumForBusyCheck > 1)
    if retryAttempt == 0 && !isContinuationChunk {
      if currentState == "syncing" || currentState == "time_syncing" {
        return false
      }
    }
    let recordCount = deviceRecordCounts[deviceId] ?? 0
    if retryAttempt == 0 && !isContinuationChunk {
      syncTotalRecords[deviceId] = recordCount
      syncRecordsReceived[deviceId] = 0
      syncCurrentFileNumber[deviceId] = 1
      syncGrandTotalReceived[deviceId] = 0
      _ = (recordCount + RECORDS_PER_FILE - 1) / RECORDS_PER_FILE
    }
    let currentFileNum = syncCurrentFileNumber[deviceId] ?? 1
    if recordCount == 0 {
    } else {
    }
    dataSyncState[deviceId] = "syncing"
    if dataSyncRequested[deviceId] != true {
      dataSyncRequested[deviceId] = true
    } else {
    }
    NSLog("📤 Sending Data Sync Start command to \(deviceId) (attempt \(retryAttempt + 1)/3)")
    // Firmware v1.5: Send 2-byte record count. When continuing, request min(500, remaining) per SDD.
    let totalRecords = syncTotalRecords[deviceId] ?? recordCount
    let grandTotal = syncGrandTotalReceived[deviceId] ?? 0
    let remaining = max(0, totalRecords - grandTotal)
    let recordsToSync: UInt16
    if remaining > 0 && remaining < RECORDS_PER_FILE {
      recordsToSync = UInt16(remaining)
      NSLog("   [LAST CHUNK] Requesting remaining \(remaining) records (total \(totalRecords), have \(grandTotal))")
    } else {
      recordsToSync = UInt16(RECORDS_PER_FILE)
      NSLog("   Command: AA 08 02 (v1.5: requesting \(recordsToSync) records)")
    }
    NSLog("   Expected records: \(recordCount)")
    let syncPayload: [UInt8] = [
      UInt8(recordsToSync & 0xFF),           // LSB
      UInt8((recordsToSync >> 8) & 0xFF)     // MSB
    ]
    let success = sendSystemCommand(deviceId: deviceId, commandId: 0x08, payload: syncPayload)
    if success {
      NSLog("✅ Data Sync Start command sent successfully")
      DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
        guard let self = self else { return }
        let stillRequested = self.dataSyncRequested[deviceId] ?? false
        let currentState = self.dataSyncState[deviceId] ?? "unknown"
        NSLog("      - dataSyncRequested still true: \(stillRequested)")
        NSLog("      - Current state: \(currentState)")
        if stillRequested && currentState == "syncing" {
        }
      }
    } else {
      NSLog("❌ Failed to send Data Sync Start command")
      dataSyncState[deviceId] = "idle"
      dataSyncRequested[deviceId] = false 
    }
    return success
  }
  private func sendPasskeyUpdateCommand(deviceId: String, passkey: String) -> Bool {
    guard passkey.count == 6 else {
      return false
    }
    guard passkey.allSatisfy({ $0.isNumber }) else {
      return false
    }
    guard let passkeyInt = UInt32(passkey) else {
      return false
    }
    guard passkeyInt <= 999999 else {
      return false
    }
    var payload: [UInt8] = []
    payload.append(UInt8(passkeyInt & 0xFF))           
    payload.append(UInt8((passkeyInt >> 8) & 0xFF))   
    payload.append(UInt8((passkeyInt >> 16) & 0xFF))  
    guard payload.count == 3 else {
      return false
    }
    let payloadHex = payload.map { String(format: "%02X", $0) }.joined(separator: " ")
    NSLog("   Command: AA 14 03 \(payloadHex)")  
    NSLog("   Passkey: \(passkey) (encoded as 3-byte integer)")
    let success = sendSystemCommand(deviceId: deviceId, commandId: 0x14, payload: payload)
    if success {
    } else {
    }
    return success
  }
  private func retryDataSyncStart(deviceId: String) {
    let currentRetry = dataSyncRetryCount[deviceId] ?? 0
    if currentRetry >= 3 {
      NSLog("❌ Max retry attempts reached for device \(deviceId). Giving up on data sync.")
      NSLog("   Device may not have data OR RTC failed to sync properly.")
      dataSyncState[deviceId] = "failed"
      dataSyncRetryCount.removeValue(forKey: deviceId)
      return
    }
    let baseDelay: TimeInterval = 5.0
    let delay: TimeInterval = baseDelay * pow(2.0, Double(currentRetry))
    NSLog("🔄 Scheduling data sync retry for device \(deviceId) in \(Int(delay))s")
    NSLog("   Retry reason: Device RTC may need more time to stabilize")
    dataSyncTimers[deviceId]?.invalidate()
    dataSyncTimers[deviceId] = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      NSLog("⏰ Retrying data sync for device \(deviceId) (attempt \(currentRetry + 2)/4)")
      NSLog("   Total wait time since time sync: \(Int(10.0 + delay))s")
      self.dataSyncRetryCount[deviceId] = currentRetry + 1
      _ = self.sendDataSyncStartCommand(deviceId: deviceId, retryAttempt: currentRetry + 1)
    }
  }
  private func parseDataTransferData(deviceId: String, data: Data) {
    // ✅ DEDUPLICATION: Prevent processing the same notification multiple times
    // iOS BLE can sometimes deliver the same notification 2-3 times in quick succession
    let currentHex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
    let now = Date()
    
    if let lastHex = lastDataTransferHex[deviceId],
       let lastTime = lastDataTransferTime[deviceId],
       lastHex == currentHex,
       now.timeIntervalSince(lastTime) < DATA_TRANSFER_DEDUPE_WINDOW {
      // Skip duplicate notification
      NSLog("⏭️ [DEDUPE] Skipping duplicate data transfer notification for \(deviceId)")
      NSLog("   Same data received \(String(format: "%.0f", now.timeIntervalSince(lastTime) * 1000))ms ago")
      return
    }
    
    // Update deduplication tracking
    lastDataTransferHex[deviceId] = currentHex
    lastDataTransferTime[deviceId] = now
    
    let wasRequested = dataSyncRequested[deviceId] ?? false
    let syncState = dataSyncState[deviceId] ?? "unknown"
    // "ready" is a connection state, not a sync state. Only check actual sync states.
    let isSyncActive = syncState == "syncing" || syncState == "time_syncing"
    
    // Check data type early to determine if it's a push-generated record
    guard data.count >= BLEProtocolConstants.minDataTransferSize else {
      NSLog("═══════════════════════════════════════════════════════")
      return
    }
    let dataType = data[0]
    
    // Firmware v1.5: Accept push-generated records (type 0x03) even when not in sync
    // These are automatic notifications sent at each data acquisition interval
    let isPushGeneratedRecord = (dataType == 0x03) && !wasRequested && !isSyncActive
    // ✅ FIX: Always accept Data Sync Complete (type 0x02) - it's the completion signal
    // This ensures we receive completion even if sync state was cleared prematurely
    let isSyncComplete = (dataType == 0x02)
    let shouldAcceptData = wasRequested || isSyncActive || isPushGeneratedRecord || isSyncComplete
    
    NSLog("═══════════════════════════════════════════════════════")
    NSLog("🔍 RAW DATA TRANSFER ANALYSIS")
    NSLog("═══════════════════════════════════════════════════════")
    NSLog("Device: \(deviceId)")
    NSLog("Data Sync Requested: \(wasRequested ? "YES ✅" : "NO ❌")")
    NSLog("Data Sync State: \(syncState)")
    NSLog("Data Type: 0x\(String(format: "%02X", dataType))")
    NSLog("Is Push-Generated: \(isPushGeneratedRecord ? "YES ✅ (v1.5 live record)" : "No (sync record)")")
    NSLog("Is Sync Complete: \(isSyncComplete ? "YES ✅ (type 0x02)" : "NO ❌")")
    NSLog("Should Accept Data: \(shouldAcceptData ? "YES ✅" : "NO ❌ (UNSOLICITED)")")
    NSLog("Total data length: \(data.count) bytes")
    let allBytes = data.enumerated().map { (index, byte) in
      String(format: "[\(index)]:%02X", byte)
    }.joined(separator: " ")
    NSLog("All bytes: \(allBytes)")
    if !shouldAcceptData {
      NSLog("⚠️ IGNORING UNSOLICITED DATA TRANSFER!")
      NSLog("   This is auto-transmitted cached/test data from device")
      NSLog("   Waiting for explicit data sync request or active sync state")
      NSLog("═══════════════════════════════════════════════════════")
      return
    }
    let length = data[1]
    let payloadEnd = min(2 + Int(length), data.count)
    let payload = data.subdata(in: 2..<payloadEnd)
    NSLog("Payload length: \(payload.count) bytes")
    let rawHex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
    NSLog("Full packet hex: \(rawHex)")
    let payloadHex = payload.map { String(format: "%02X", $0) }.joined(separator: " ")
    NSLog("Payload hex: \(payloadHex)")
    NSLog("═══════════════════════════════════════════════════════")
    switch dataType {
    case 0x01: 
      NSLog("   Payload hex: \(dataToHexString(payload))")
      NSLog("   Payload length: \(payload.count) bytes")
      dataSyncState[deviceId] = "syncing"
      if payload.count >= 4 {
        let totalRecords = payload.withUnsafeBytes { $0.load(as: UInt32.self) }
        NSLog("   Raw bytes: \(payload.prefix(4).map { String(format: "0x%02X", $0) }.joined(separator: " "))")
        NSLog("   Parsed as LE uint32: \(totalRecords)")
        let isTestData = (totalRecords > 100000) || 
                        (payload.count == 8 && payload[0] == 0x10 && payload[1] == 0x20)
        if isTestData {
          NSLog("⚠️ DETECTED TEST/GARBAGE DATA FROM DEVICE!")
          NSLog("   This appears to be: 10 20 30 40 50 60 70 80 (sequential test pattern)")
          NSLog("   Device may not have real data or firmware needs update")
          NSLog("   Setting record count to 0")
          DispatchQueue.main.async {
            self.sendEvent(withName: "DataTransfer", body: [
              "deviceId": deviceId,
              "type": "sync_start",
              "totalRecords": 0,
              "payloadLength": payload.count,
              "rawPayload": self.dataToHexString(payload),
              "isTestData": true,
              "error": "Device sent test/garbage data instead of real record count"
            ])
          }
          dataSyncState[deviceId] = "complete"
          return
        }
        if totalRecords > 1000 {
          NSLog("⚠️ Warning: Unusually high record count: \(totalRecords)")
          NSLog("   This may indicate data corruption or device issue")
        }
        DispatchQueue.main.async {
          self.sendEvent(withName: "DataTransfer", body: [
            "deviceId": deviceId,
            "type": "sync_start",
            "totalRecords": totalRecords,
            "payloadLength": payload.count,
            "rawPayload": self.dataToHexString(payload)
          ])
        }
        let previousTotal = self.syncTotalRecords[deviceId] ?? 0
        let deviceStatusTotal = self.deviceRecordCounts[deviceId] ?? 0
        let grandTotalReceived = self.syncGrandTotalReceived[deviceId] ?? 0
        // SDD v1.5: Use device status total as floor only when sync_start reported a full chunk (500).
        // When device reports a small batch (e.g. 10 from manual Start Sync(10)), use as-is so we don't
        // expand to device status (e.g. 201) and pull extra chunks — user wanted only 10.
        var newTotal = Int(totalRecords)
        if deviceStatusTotal > 0 && newTotal < deviceStatusTotal && newTotal >= RECORDS_PER_FILE {
          newTotal = deviceStatusTotal
          NSLog("📦 [MULTI-FILE] Device sync_start reported \(totalRecords); using device status total \(deviceStatusTotal) (SDD: sync up to 500 per start)")
        }
        if previousTotal > 0 && newTotal < previousTotal {
          newTotal = previousTotal
          NSLog("📦 [MULTI-FILE] Device reported \(totalRecords) for this file; keeping app total \(previousTotal)")
        }
        if grandTotalReceived > 0 && newTotal <= grandTotalReceived {
          let minTotal = grandTotalReceived + 1
          NSLog("📦 [MULTI-FILE] Device reported \(totalRecords) but we have \(grandTotalReceived) already; keeping total >= \(minTotal)")
          newTotal = max(newTotal, minTotal)
        }
        self.syncTotalRecords[deviceId] = newTotal
        if self.syncRecordsReceived[deviceId] == nil {
          self.syncRecordsReceived[deviceId] = 0
          self.syncCurrentFileNumber[deviceId] = 1
          self.syncGrandTotalReceived[deviceId] = 0
        }
      } else {
        NSLog("❌ Data Sync Start payload too short: \(payload.count) bytes")
      }
    case 0x02: 
      NSLog("═══════════════════════════════════════════════════════")
      dataSyncState[deviceId] = "complete"
      systemCommandsSent[deviceId] = false
      dataSyncRequested[deviceId] = false
      dataSyncRetryCount.removeValue(forKey: deviceId)
      dataSyncTimers[deviceId]?.invalidate()
      dataSyncTimers.removeValue(forKey: deviceId)
      if payload.count >= 2 {
        let count = payload.withUnsafeBytes { $0.load(as: UInt16.self) }
        // Firmware v1.5: Removed 0xFFFF force termination. Valid range is 0x0001 to 0x01F4
        // Any value in this range indicates successful sync completion
        let actualCount = Int(count)
        let isValidCount = actualCount >= 0x0001 && actualCount <= 0x01F4
        if isValidCount {
          NSLog("✅ Data Sync Complete - \(count) records transmitted successfully (v1.5)")
          let recordsInThisChunk = min(actualCount, RECORDS_PER_FILE) 
          if actualCount > RECORDS_PER_FILE {
            NSLog("⚠️ [SDD v1.5] Device reported \(actualCount) records (exceeds \(RECORDS_PER_FILE) limit)")
            NSLog("   This indicates device sent multiple files in one sync session")
            NSLog("   Treating as \(RECORDS_PER_FILE) records for this chunk, \(actualCount - RECORDS_PER_FILE) for next")
          }
          let totalRecords = self.syncTotalRecords[deviceId] ?? 0
          let grandTotal = (self.syncGrandTotalReceived[deviceId] ?? 0) + recordsInThisChunk
          self.syncGrandTotalReceived[deviceId] = grandTotal
          let currentFileNum = self.syncCurrentFileNumber[deviceId] ?? 1
          NSLog("📊 File #\(currentFileNum) complete: \(recordsInThisChunk) records (device reported \(actualCount))")
          var hasMoreChunks = (grandTotal < totalRecords) || (actualCount > RECORDS_PER_FILE)
          // SDD v1.5: When tag sends DATA_SYNC_COMPLETE (0x02), that means "data sync complete" — no more data.
          // So if we have 500/500 and tag sent 0x02, sync is done — do NOT start chunk 2.
          if actualCount > RECORDS_PER_FILE {
            let excessRecords = actualCount - RECORDS_PER_FILE
            NSLog("   Excess records from device: \(excessRecords) (will be synced in next chunk)")
            if totalRecords < grandTotal + excessRecords {
              self.syncTotalRecords[deviceId] = grandTotal + excessRecords
            }
          }
          if hasMoreChunks {
            // Send chunk_complete event for intermediate chunks
            DispatchQueue.main.async {
              self.sendEvent(withName: "DataTransfer", body: [
                "deviceId": deviceId,
                "type": "chunk_complete",
                "success": true,
                "recordsTransmitted": actualCount,
                "chunkNumber": currentFileNum,
                "grandTotal": grandTotal,
                "totalExpected": totalRecords,
                "hasMoreChunks": true
              ])
            }
          } else {
            // Send sync_complete event for final chunk — use grandTotal (total synced) so connection log and UI show total across all chunks.
            // Cap at totalRecords to avoid double-count when 0x02 and record path both run (same as Android).
            let totalSynced = min(grandTotal, totalRecords)
            DispatchQueue.main.async {
              self.sendEvent(withName: "DataTransfer", body: [
                "deviceId": deviceId,
                "type": "sync_complete",
                "success": true,
                "recordsTransmitted": totalSynced,
                "chunkNumber": currentFileNum,
                "grandTotal": totalSynced,
                "totalExpected": totalRecords,
                "hasMoreChunks": false
              ])
            }
          }
          NSLog("═══════════════════════════════════════════════════════")
          let remainingRecords = max(0, totalRecords - grandTotal)
          self.deviceRecordCounts[deviceId] = remainingRecords
          NSLog("✅ Updated record count to \(remainingRecords) after file #\(currentFileNum)")
          
          // SDD v1.5: STOP must use tag's actual count (from 0x02) so tag only clears records it sent.
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
            guard let self = self else { return }
            
            let recordsToConfirm = UInt16(actualCount)
            let cleanupSuccess = self.sendDataSyncStopCommand(deviceId: deviceId, recordsAcknowledged: recordsToConfirm)
            if cleanupSuccess {
              if actualCount < RECORDS_PER_FILE {
                NSLog("✅ [LAST CHUNK] DATA_SYNC_STOP(\(recordsToConfirm)) sent after DATA_SYNC_COMPLETE (tag count) - chunk #\(currentFileNum)")
              } else {
                NSLog("✅ [DATA_SYNC_COMPLETE] DATA_SYNC_STOP(\(recordsToConfirm)) sent (tag count) - chunk #\(currentFileNum)")
              }
            } else {
              NSLog("❌ Failed to send DATA_SYNC_STOP command")
            }
            self.recordPathChunkAdvanced.removeValue(forKey: deviceId)
            
            if hasMoreChunks {
              let nextFileNum = currentFileNum + 1
              self.pendingStartNextChunkAfterStopResponse[deviceId] = { [weak self] in
                guard let self = self else { return }
                self.recordPathChunkAdvanced.removeValue(forKey: deviceId)
                self.syncCurrentFileNumber[deviceId] = nextFileNum
                self.syncRecordsReceived[deviceId] = 0
                NSLog("📦 [CHUNKED SYNC] Chunk #\(currentFileNum) complete (\(actualCount) records). Progress: \(grandTotal)/\(totalRecords). Starting chunk #\(nextFileNum)...")
                let startSuccess = self.sendDataSyncStartCommand(deviceId: deviceId, retryAttempt: 0)
                if startSuccess {
                  NSLog("✅ [CHUNKED SYNC] Started chunk #\(nextFileNum) for \(deviceId)")
                } else {
                  NSLog("❌ [CHUNKED SYNC] Failed to start chunk #\(nextFileNum)")
                }
              }
            }
            if !hasMoreChunks {
              // No more chunks — cleanup (no need to wait for STOP ACK; we're done)
              let totalSyncedLog = min(grandTotal, totalRecords)
              NSLog("✅ [CHUNKED SYNC] All chunks complete. Total synced: \(totalSyncedLog) records.")
              self.hasCompletedInitialSync[deviceId] = true
              self.systemCommandsSent[deviceId] = false
              self.dataSyncRequested[deviceId] = false
              self.syncTotalRecords.removeValue(forKey: deviceId)
              self.syncRecordsReceived.removeValue(forKey: deviceId)
              self.syncCurrentFileNumber.removeValue(forKey: deviceId)
              self.syncGrandTotalReceived.removeValue(forKey: deviceId)
              self.recordPathChunkAdvanced.removeValue(forKey: deviceId)
              self.pendingStartNextChunkAfterStopResponse.removeValue(forKey: deviceId)
              self.lastSyncCompleteTime[deviceId] = Date()
              NSLog("   📝 Tracked sync completion time to monitor for premature disconnects")
              NSLog("   ✅ Initial sync completed - device will now send push-generated records automatically")
              NSLog("   📡 App will receive live data via Data Transfer notifications (type 0x03)")
              if let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) {
                self.ensureNotificationsEnabledAfterSync(deviceId: deviceId, peripheral: peripheral)
              }
              self.startPostSyncKeepAlive(deviceId: deviceId)
            }
          }
        } else {
          // Firmware v1.5: Invalid record count (outside 0x0001-0x01F4 range)
          NSLog("❌ Data Sync Complete - Invalid record count: 0x\(String(format: "%04X", count))")
          NSLog("   Firmware v1.5: Valid range is 0x0001 to 0x01F4")
          NSLog("═══════════════════════════════════════════════════════")
          dataSyncState[deviceId] = "failed"
          dataSyncRequested[deviceId] = false
          DispatchQueue.main.async {
            self.sendEvent(withName: "DataTransfer", body: [
              "deviceId": deviceId,
              "type": "sync_complete",
              "success": false,
              "recordsTransmitted": 0,
              "reason": "invalid_record_count"
            ])
          }
        }
      } else {
        NSLog("❌ Data Sync Complete payload too short: \(payload.count) bytes")
        NSLog("═══════════════════════════════════════════════════════")
      }
    case 0x03: 
      NSLog("📋 Record Data")
      if payload.count >= 6 {
        var records: [[String: Any]] = []
        var offset = 0
        
        // FIX: Handle full 8-byte records first
        while offset + 8 <= payload.count {
          let timestamp = payload.subdata(in: offset..<(offset + 4)).withUnsafeBytes { $0.load(as: UInt32.self) }
          let steps = payload.subdata(in: (offset + 4)..<(offset + 6)).withUnsafeBytes { $0.load(as: UInt16.self) }
          let temperature = payload[offset + 6]
          let flags = payload[offset + 7]
          let date = Date(timeIntervalSince1970: TimeInterval(timestamp))
          let formatter = DateFormatter()
          formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
          let dateString = formatter.string(from: date)
          let record: [String: Any] = [
            "timestamp": timestamp,
            "timestampDate": dateString,
            "steps": steps,
            "temperature": temperature,
            "flags": flags,
            "rawData": dataToHexString(payload.subdata(in: offset..<(offset + 8))),
            "isPartialRecord": false
          ]
          records.append(record)
          NSLog("   Record \(records.count): \(dateString) - Temp: \(temperature)°C, Steps: \(steps)")
          offset += 8
        }
        
        // FIX: Handle partial records (7 bytes - missing flags, or 6 bytes - missing temp+flags)
        // SDD v1.5 allows length 6-18, and partial data may occur with certain firmware
        let remainingBytes = payload.count - offset
        if remainingBytes >= 6 && remainingBytes < 8 {
          NSLog("📝 Attempting to parse partial record with \(remainingBytes) bytes")
          
          let timestamp = payload.subdata(in: offset..<(offset + 4)).withUnsafeBytes { $0.load(as: UInt32.self) }
          let steps = payload.subdata(in: (offset + 4)..<(offset + 6)).withUnsafeBytes { $0.load(as: UInt16.self) }
          
          var temperature: UInt8 = 0
          var flags: UInt8 = 0
          var bytesUsed = 6
          
          // Try to read temperature if available (7+ bytes)
          if remainingBytes >= 7 {
            temperature = payload[offset + 6]
            bytesUsed = 7
          }
          
          let date = Date(timeIntervalSince1970: TimeInterval(timestamp))
          let formatter = DateFormatter()
          formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
          let dateString = formatter.string(from: date)
          
          // FIX: 7-byte records are VALID and COMPLETE per SDD v1.5 (timestamp + steps + temp, no flags byte)
          // Only records with < 7 bytes should be marked as partial
          let isPartial = (remainingBytes < 7)
          
          let record: [String: Any] = [
            "timestamp": timestamp,
            "timestampDate": dateString,
            "steps": steps,
            "temperature": temperature,
            "flags": flags,
            "rawData": dataToHexString(payload.subdata(in: offset..<(offset + bytesUsed))),
            "isPartialRecord": isPartial  // ✅ FIX: 7-byte records are NOT partial
          ]
          records.append(record)
          
          if isPartial {
            NSLog("⚠️ Parsed partial record: \(dateString) - Temp: \(temperature)°C, Steps: \(steps) (PARTIAL - \(remainingBytes) bytes)")
          } else {
            NSLog("✅ Parsed 7-byte record (no flags byte): \(dateString) - Temp: \(temperature)°C, Steps: \(steps)")
          }
          offset += bytesUsed
        }
        
        // Firmware v1.5: Distinguish between push-generated records (live data) and sync records
        if isPushGeneratedRecord {
          // Push-generated record: Process as live data, don't count in sync progress
          NSLog("📤 Push-Generated Record (v1.5 live data) - \(records.count) record(s)")
          NSLog("   Processing as live data (not counting in sync progress)")
          DispatchQueue.main.async {
            self.sendEvent(withName: "DataTransfer", body: [
              "deviceId": deviceId,
              "type": "record",
              "records": records,
              "recordCount": records.count,
              "isPushGenerated": true,  // Flag to indicate this is push-generated (live data)
              "isLiveData": true
            ])
          }
          return
        }
        
        // Sync record: Process as part of sync operation
        let currentReceived = syncRecordsReceived[deviceId] ?? 0
        let newTotal = currentReceived + records.count
        // When sync was force-completed or cleaned up, syncTotalRecords may be 0; use device count so we never emit "X/0"
        var totalExpected = syncTotalRecords[deviceId] ?? 0
        if totalExpected <= 0 {
          totalExpected = deviceRecordCounts[deviceId] ?? 0
        }
        let currentGrandTotal = syncGrandTotalReceived[deviceId] ?? 0
        
        NSLog("📊 Records in current chunk: \(newTotal) / \(RECORDS_PER_FILE)")
        
        if newTotal >= RECORDS_PER_FILE {
          // SDD v1.5: Do NOT send STOP here. Wait for tag's DATA_SYNC_COMPLETE (0x02) and send STOP(actualCount) so tag only clears records it sent.
          NSLog("⚠️ [500 BOUNDARY HIT] Chunk has \(newTotal) records (current=\(currentReceived), new=\(records.count))")
          NSLog("   Waiting for tag 0x02, then STOP(actualCount); next START after STOP ACK.")
          
          let excessRecords = newTotal - RECORDS_PER_FILE
          let cumulativeForBoundary = currentGrandTotal + min(newTotal, RECORDS_PER_FILE)
          if excessRecords > 0 {
            NSLog("   Excess \(excessRecords) records will roll over to next chunk")
            let recordsForThisChunk = Array(records.prefix(RECORDS_PER_FILE - currentReceived))
            DispatchQueue.main.async {
              self.sendEvent(withName: "DataTransfer", body: [
                "deviceId": deviceId,
                "type": "record",
                "records": recordsForThisChunk,
                "recordCount": recordsForThisChunk.count,
                "totalReceived": cumulativeForBoundary,
                "totalExpected": totalExpected,
                "isPushGenerated": false,
                "isLiveData": false
              ])
            }
          } else {
            DispatchQueue.main.async {
              self.sendEvent(withName: "DataTransfer", body: [
                "deviceId": deviceId,
                "type": "record",
                "records": records,
                "recordCount": records.count,
                "totalReceived": cumulativeForBoundary,
                "totalExpected": totalExpected,
                "isPushGenerated": false,
                "isLiveData": false
              ])
            }
          }
          
          syncRecordsReceived[deviceId] = excessRecords
          
          DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            var totalRecords = self.syncTotalRecords[deviceId] ?? 0
            if totalRecords <= 0 { totalRecords = self.deviceRecordCounts[deviceId] ?? 0 }
            let grandTotal = (self.syncGrandTotalReceived[deviceId] ?? 0) + RECORDS_PER_FILE
            self.syncGrandTotalReceived[deviceId] = grandTotal
            let hasMoreChunks = (grandTotal < totalRecords)
            
            if hasMoreChunks {
              self.recordPathChunkAdvanced[deviceId] = true
              let currentFileNum = self.syncCurrentFileNumber[deviceId] ?? 1
              let nextFileNum = currentFileNum + 1
              self.syncCurrentFileNumber[deviceId] = nextFileNum
              NSLog("📦 [500 BOUNDARY] Chunk #\(currentFileNum) hit 500 records. Waiting for tag 0x02, then STOP(actualCount); next START after STOP ACK.")
              self.pendingStartNextChunkAfterStopResponse[deviceId] = { [weak self] in
                guard let self = self else { return }
                _ = self.sendDataSyncStartCommand(deviceId: deviceId, retryAttempt: 0)
                NSLog("✅ [CHUNKED SYNC] Started chunk #\(nextFileNum) sync for \(deviceId)")
              }
            }
            // If !hasMoreChunks: sync_complete and cleanup happen when tag sends 0x02 and we send STOP(actualCount) in DATA_SYNC_COMPLETE handler.
          }
        } else {
          // Not at 500 boundary yet, continue receiving
          syncRecordsReceived[deviceId] = newTotal
          let cumulativeReceived = currentGrandTotal + newTotal
          NSLog("📊 Chunk progress: \(newTotal)/500 records (+\(records.count)). Grand total will be: \(cumulativeReceived)/\(totalExpected)")
          
          DispatchQueue.main.async {
            self.sendEvent(withName: "DataTransfer", body: [
              "deviceId": deviceId,
              "type": "record",
              "records": records,
              "recordCount": records.count,
              "totalReceived": cumulativeReceived,
              "totalExpected": totalExpected,
              "isPushGenerated": false,
              "isLiveData": false
            ])
          }
        }
      } else {
        NSLog("❌ Record Data payload too short: \(payload.count) bytes")
      }
    case 0x04: 
      NSLog("❌ Data Read Error")
      DispatchQueue.main.async {
        self.sendEvent(withName: "DataTransfer", body: [
          "deviceId": deviceId,
          "type": "read_error",
          "errorCode": payload.count > 0 ? payload[0] : 0
        ])
      }
    default:
      break
    }
  }
  private func parseSystemCommandResponse(deviceId: String, data: Data) {
    guard data.count >= 4 else {
      return
    }
    let responseId = data[0]
    let commandId = data[1]
    let responseLength = data[2]
    let responseStatus = data[3]
    let responseHex = data.map { String(format: "%02X", $0) }.joined(separator: " ")
    NSLog("   Raw: \(responseHex)")
    guard responseId == BLEProtocolConstants.responseId else {
      return
    }
    let commandName = getCommandName(commandId: commandId)
    NSLog("   Response ID: 0xBB")
    NSLog("   Command: 0x%02X (%@)", commandId, commandName)
    NSLog("   Length: %d", responseLength)
    NSLog("   Status: 0x%02X (%@)", responseStatus, responseStatus == 0x00 ? "Success ✅" : "Failure ❌")
    guard responseStatus == BLEProtocolConstants.successStatus else {
      NSLog("❌ Command failed with status: 0x%02X", responseStatus)
      if commandId == 0x01 { 
        setTimeResponseReceived[deviceId] = true 
        setTimeTimeoutTimers[deviceId]?.invalidate()
        setTimeTimeoutTimers.removeValue(forKey: deviceId)
        let currentRetry = setTimeRetryAttempts[deviceId] ?? 0
        if currentRetry < 1 {
          NSLog("   Retrying SET TIME command (attempt \(currentRetry + 1)/2)...")
          setTimeRetryAttempts[deviceId] = currentRetry + 1
          DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
            self?.sendSetSystemTimeCommand(deviceId: deviceId, retryAttempt: currentRetry + 1)
          }
    } else {
      NSLog("   Proceeding with other commands, but RTC may remain invalid")
      NSLog("   Device may not have valid time, but live updates will still work")
      dataSyncState[deviceId] = "time_sync_failed"
      // Only send sync start if initial sync hasn't been completed yet
      sendDataAcquisitionAndLiveNotifications(deviceId: deviceId, forceSync: false)
    }
      }
      DispatchQueue.main.async {
        self.sendEvent(withName: "SystemCommandResponse", body: [
          "deviceId": deviceId,
          "commandId": commandId,
          "commandName": commandName,
          "status": "failure",
          "responseStatus": responseStatus,
          "rawResponse": responseHex
        ])
      }
      if commandId != 0x01 {
        return
      } else {
        return
      }
    }
    var responseData: [String: Any] = [
      "deviceId": deviceId,
      "commandId": commandId,
      "commandName": commandName,
      "status": "success",
      "responseStatus": responseStatus,
      "rawResponse": responseHex
    ]
    switch commandId {
    case 0x01: 
      NSLog("✅ Set System Time command successful - RTC synchronized")
      responseData["message"] = "System time synchronized successfully"
      setTimeResponseReceived[deviceId] = true
      setTimeTimeoutTimers[deviceId]?.invalidate()
      setTimeTimeoutTimers.removeValue(forKey: deviceId)
      dataSyncState[deviceId] = "time_synced"
      setTimeRetryAttempts.removeValue(forKey: deviceId)
      
      // CORRECT FLOW (SDD v1.5): Notifications are already enabled
      // After successful time sync, proceed directly to data sync
      guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
        return
      }
      confirmConnection(peripheral: peripheral, deviceId: deviceId)
      
      // Industry fix (match Android): After SET_TIME success, explicitly read Device Status
      // so JS gets updated device status with valid RTC and can trigger auto-sync decide.
      // Without this, JS maybeTriggerAutoSyncFromDeviceStatus returned early on first
      // device status (RTC invalid) and never got a second chance.
      triggerDeviceStatusReadAfterSetTime(deviceId: deviceId, peripheral: peripheral)
    case 0x02: 
      NSLog("✅ Set Advertising Interval command successful")
      responseData["message"] = "Advertising interval updated"
    case 0x03: 
      NSLog("✅ Set Connection Interval command successful")
      responseData["message"] = "Connection interval updated"
    case 0x04: 
      NSLog("✅ Set Data Acquisition Interval command successful")
      responseData["message"] = "Data acquisition interval updated"
      if let requestedInterval = requestedDataAcquisitionIntervals[deviceId] {
        let intervalSeconds = TimeInterval(requestedInterval)
        let actualInterval = max(30.0, intervalSeconds)
        requestedDataAcquisitionIntervals.removeValue(forKey: deviceId)
      } else {
      }
    case 0x05: 
      if responseLength > 0 && data.count >= 4 + Int(responseLength) {
        let versionData = data.subdata(in: 4..<4+Int(responseLength))
        let version = String(data: versionData, encoding: .utf8) ?? "Unknown"
        NSLog("✅ Firmware Version: %@", version)
        responseData["firmwareVersion"] = version
      }
    case 0x06: 
      if responseLength > 0 && data.count >= 4 + Int(responseLength) {
        let versionData = data.subdata(in: 4..<4+Int(responseLength))
        let version = String(data: versionData, encoding: .utf8) ?? "Unknown"
        NSLog("✅ Hardware Version: %@", version)
        responseData["hardwareVersion"] = version
      }
    case 0x07: 
      if responseLength > 0 && data.count >= 4 + Int(responseLength) {
        let diagnosticsData = data.subdata(in: 4..<4+Int(responseLength))
        if diagnosticsData.count >= 1 {
          let batteryLevel = diagnosticsData[0]
          NSLog("✅ Battery Level: %d%%", batteryLevel)
          responseData["batteryLevel"] = batteryLevel
          if batteryLevel > 0 && batteryLevel <= 100 {
            sendDeviceDataUpdateEvent(deviceId: deviceId, batteryLevel: Int(batteryLevel))
          }
        }
      }
    case 0x08: 
      if responseStatus == 0x00 {
        responseData["message"] = "Data sync initiated"
        dataSyncState[deviceId] = "syncing"
        dataSyncRetryCount.removeValue(forKey: deviceId) 
      } else {
        NSLog("❌ Data Sync Start failed (Status: 0x%02X)", responseStatus)
        NSLog("   Possible reasons:")
        NSLog("   1. Device RTC not synchronized yet (needs more time)")
        NSLog("   2. Device flash not ready for read operations")
        NSLog("   3. Device has no data to sync (expected if new device)")
        let retryCount = dataSyncRetryCount[deviceId] ?? 0
        if retryCount < 3 {
          NSLog("🔄 Will retry data sync (attempt \(retryCount + 1)/3) after longer delay...")
          responseData["message"] = "Data sync failed - retrying with longer delay..."
          retryDataSyncStart(deviceId: deviceId)
        } else {
          NSLog("❌ Max retries reached. Device may not have data or RTC issue persists.")
          responseData["message"] = "Data sync failed - max retries reached"
          dataSyncState[deviceId] = "failed"
          dataSyncRetryCount.removeValue(forKey: deviceId)
        }
      }
    case 0x09: 
      if responseStatus == 0x00 {
        NSLog("✅ Data Sync Stopped - Flash cleared successfully")
        responseData["message"] = "Data sync stopped and flash cleared"
        // Industry-correct (match Android): Start next chunk ONLY after STOP ACK — prevents GATT queue collision
        if let pending = pendingStartNextChunkAfterStopResponse.removeValue(forKey: deviceId) {
          NSLog("✅ [GATT QUEUE] STOP response (BB 09) received — scheduling next START in 200ms")
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { pending() }
        }
      } else {
        NSLog("⚠️ Data Sync Stop returned status: 0x\(String(format: "%02X", responseStatus))")
        NSLog("   This is expected if device auto-clears flash or doesn't support this command")
        NSLog("   Device may handle flash management automatically")
        responseData["message"] = "Data sync stop acknowledged (device manages flash)"
        pendingStartNextChunkAfterStopResponse.removeValue(forKey: deviceId)
      }
    case 0x10: 
      NSLog("✅ System Restart command acknowledged")
      responseData["message"] = "Device restarting"
    case 0x11: 
      NSLog("✅ Buzzer toggled")
      responseData["message"] = "Buzzer state changed"
    case 0x12: 
      NSLog("✅ Unpair Device command successful")
      responseData["message"] = "Device unpaired successfully"
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self = self else { return }
        guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
          return
        }
        if let services = peripheral.services {
          for service in services {
            if let characteristics = service.characteristics {
              for characteristic in characteristics {
                if characteristic.isNotifying {
                  peripheral.setNotifyValue(false, for: characteristic)
                }
              }
            }
          }
        }
        self.dataSyncState.removeValue(forKey: deviceId)
        self.dataSyncRetryCount.removeValue(forKey: deviceId)
        self.dataSyncTimers[deviceId]?.invalidate()
        self.dataSyncTimers.removeValue(forKey: deviceId)
        self.bondedDeviceIDs.remove(deviceId)
        self.forgottenDeviceIDs.insert(deviceId)
        self.saveBondedDevices()
        self.saveForgottenDevices()
        let isAlreadyDisconnected = (peripheral.state != .connected)
        if isAlreadyDisconnected {
          self.connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
          self.connectingPeripherals.removeValue(forKey: deviceId)
          self.reconnectTimers[deviceId]?.invalidate()
          self.reconnectTimers.removeValue(forKey: deviceId)
          self.reconnectBackoff.removeValue(forKey: deviceId)
          self.reconnectAttempts.removeValue(forKey: deviceId)
          let deviceName = peripheral.name ?? "Unknown"
          let disconnectInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "reason": "unpaired",
            "unpaired": true
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceDisconnected", body: disconnectInfo)
          }
          return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
          guard let self = self else { return }
          self.centralManager?.cancelPeripheralConnection(peripheral)
          self.connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
          self.connectingPeripherals.removeValue(forKey: deviceId)
          self.reconnectTimers[deviceId]?.invalidate()
          self.reconnectTimers.removeValue(forKey: deviceId)
          self.reconnectBackoff.removeValue(forKey: deviceId)
          self.reconnectAttempts.removeValue(forKey: deviceId) 
          let deviceName = peripheral.name ?? "Unknown"
          let disconnectInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "reason": "unpaired",
            "unpaired": true
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceDisconnected", body: disconnectInfo)
          }
          NSLog("   💡 Device will need to be manually re-paired if reconnection is desired")
        }
      }
    case 0x13: 
      NSLog("✅ Factory Reset command successful")
      responseData["message"] = "Device reset to factory settings"
      self.bondedDeviceIDs.remove(deviceId)
      self.forgottenDeviceIDs.insert(deviceId)
      self.saveBondedDevices()
      self.saveForgottenDevices()
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self = self else { return }
        guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
          return
        }
        if let services = peripheral.services {
          for service in services {
            if let characteristics = service.characteristics {
              for characteristic in characteristics {
                if characteristic.isNotifying {
                  peripheral.setNotifyValue(false, for: characteristic)
                }
              }
            }
          }
        }
        self.dataSyncState.removeValue(forKey: deviceId)
        self.dataSyncRetryCount.removeValue(forKey: deviceId)
        self.dataSyncTimers[deviceId]?.invalidate()
        self.dataSyncTimers.removeValue(forKey: deviceId)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
          guard let self = self else { return }
          self.centralManager?.cancelPeripheralConnection(peripheral)
          self.connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
          self.connectingPeripherals.removeValue(forKey: deviceId)
          self.reconnectTimers[deviceId]?.invalidate()
          self.reconnectTimers.removeValue(forKey: deviceId)
          self.reconnectBackoff.removeValue(forKey: deviceId)
          self.reconnectAttempts.removeValue(forKey: deviceId) 
          let deviceName = peripheral.name ?? "Unknown"
          let disconnectInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "reason": "factory_reset",
            "factory_reset": true
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceDisconnected", body: disconnectInfo)
          }
          NSLog("   💡 Device will need to be manually re-paired if reconnection is desired")
        }
      }
    case 0x14: 
      NSLog("✅ Passkey Update command successful")
      responseData["message"] = "Pairing passkey updated successfully - device will disconnect for re-pairing"
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        guard let self = self else { return }
        let wasInBondedList = self.bondedDeviceIDs.contains(deviceId)
        self.bondedDeviceIDs.remove(deviceId)
        self.saveBondedDevices()
        if wasInBondedList {
        }
        guard let peripheral = self.connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
          NSLog("   ✅ Bonding cleared - ready for re-pairing with new passkey")
          NSLog("")
          NSLog("⚠️ IMPORTANT: iOS System-Level Pairing")
          NSLog("   If reconnection fails, user must FORGET device from iOS Settings:")
          NSLog("   Settings → Bluetooth → DyreID → Forget This Device")
          NSLog("")
          return
        }
        if let services = peripheral.services {
          for service in services {
            if let characteristics = service.characteristics {
              for characteristic in characteristics {
                if characteristic.isNotifying {
                  peripheral.setNotifyValue(false, for: characteristic)
                }
              }
            }
          }
        }
        self.dataSyncState.removeValue(forKey: deviceId)
        self.dataSyncRetryCount.removeValue(forKey: deviceId)
        self.dataSyncTimers[deviceId]?.invalidate()
        self.dataSyncTimers.removeValue(forKey: deviceId)
        self.bondedDeviceIDs.remove(deviceId)
        self.saveBondedDevices()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
          guard let self = self else { return }
          self.centralManager?.cancelPeripheralConnection(peripheral)
          self.connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
          self.connectingPeripherals.removeValue(forKey: deviceId)
          self.reconnectTimers[deviceId]?.invalidate()
          self.reconnectTimers.removeValue(forKey: deviceId)
          self.reconnectBackoff.removeValue(forKey: deviceId)
          self.cleanupDeviceResources(deviceId: deviceId)
          let deviceName = peripheral.name ?? "Unknown"
          let disconnectInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": deviceName,
            "reason": "passkey_changed",
            "passkeyChanged": true,
            "requiresRepairing": true
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceDisconnected", body: disconnectInfo)
          }
          NSLog("   💡 User must manually reconnect and enter NEW passkey to pair")
        }
      }
    default:
      break
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "SystemCommandResponse", body: responseData)
    }
  }
  private func getCommandName(commandId: UInt8) -> String {
    switch commandId {
    case 0x01: return "SET_SYSTEM_TIME"
    case 0x02: return "SET_ADVERTISING_INTERVAL"
    case 0x03: return "SET_CONNECTION_INTERVAL"
    case 0x04: return "SET_DATA_ACQUISITION_INTERVAL"
    case 0x05: return "GET_FIRMWARE_VERSION"
    case 0x06: return "GET_HARDWARE_VERSION"
    case 0x07: return "GET_DIAGNOSTICS"
    case 0x08: return "DATA_SYNC_START"
    case 0x09: return "DATA_SYNC_STOP"
    case 0x10: return "SYSTEM_RESTART"
    case 0x11: return "TOGGLE_BUZZER"
    case 0x12: return "UNPAIR_DEVICE"      
    case 0x13: return "FACTORY_RESET"      
    case 0x14: return "PASSKEY_UPDATE"     
    default: return "UNKNOWN"
    }
  }
  private func sendDeviceDataUpdateEvent(deviceId: String, deviceData: [String: Any]? = nil, batteryLevel: Int? = nil) {
    var eventData: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": connectedPeripherals.first { $0.identifier.uuidString == deviceId }?.name ?? "Unknown",
      "timestamp": Date().timeIntervalSince1970 * 1000
    ]
    if let deviceData = deviceData {
      eventData.merge(deviceData) { (_, new) in new }
    }
    if let batteryLevel = batteryLevel {
      eventData["batteryLevel"] = batteryLevel
    }
    if true {
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceDataUpdated", body: eventData)
    }
    sendHealthDataApiEvent(deviceId: deviceId, deviceData: eventData)
  }
  private func sendHealthDataApiEvent(deviceId: String, deviceData: [String: Any]) {
    DispatchQueue.main.async {
      self.sendEvent(withName: "HealthDataApiRequest", body: [
        "deviceId": deviceId,
        "deviceData": deviceData,
        "timestamp": Date().timeIntervalSince1970 * 1000
      ])
    }
  }
  private func shouldAllowConnection(deviceId: String, isManualConnection: Bool) -> Bool {
    if forgottenDeviceIDs.contains(deviceId) && !isManualConnection {
      return false
    }
    if manualDisconnectInProgress.contains(deviceId) && !isManualConnection {
      return false
    }
    return true
  }
  private func findCharacteristic(peripheral: CBPeripheral, uuid: String) -> CBCharacteristic? {
    guard let services = peripheral.services else { return nil }
    let normalizedUuid = uuid.uppercased() 
    for service in services {
      guard let characteristics = service.characteristics else { continue }
      for characteristic in characteristics {
        if characteristic.uuid.uuidString.uppercased() == normalizedUuid {
          return characteristic
        }
      }
    }
    return nil
  }
  private func dataFromHexString(_ hexString: String) -> Data? {
    let cleanHex = hexString.replacingOccurrences(of: " ", with: "")
    guard cleanHex.count % 2 == 0 else { return nil }
    var data = Data()
    var index = cleanHex.startIndex
    while index < cleanHex.endIndex {
      let nextIndex = cleanHex.index(index, offsetBy: 2)
      let byteString = String(cleanHex[index..<nextIndex])
      guard let byte = UInt8(byteString, radix: 16) else { return nil }
      data.append(byte)
      index = nextIndex
    }
    return data
  }
  private func dataToHexString(_ data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }
  private func isSmartHealthTag(advertisementData: [String: Any]) -> Bool {
    guard let manufacturerData = advertisementData["kCBAdvDataManufacturerData"] as? Data else {
      return false
    }
    guard manufacturerData.count >= 13 else {
      return false
    }
    let companyId = manufacturerData.withUnsafeBytes { $0.load(as: UInt16.self) }
    if companyId != SMART_TAG_MANUFACTURER_ID {
      return false
    }
    let bytes = [UInt8](manufacturerData)
    if bytes.count >= 11 {
      let macBytes = Array(bytes[5...10])
      let allZero = macBytes.allSatisfy { $0 == 0x00 }
      let allFF = macBytes.allSatisfy { $0 == 0xFF }
      if allZero || allFF {
        return false
      }
    }
    if bytes.count > 2 {
      let version = bytes[2]
      if version > 100 {
        return false
      }
    }
    return true
  }
  private func parseManufacturerData(_ data: Data) -> [String: Any]? {
    let minLengthV14 = 13  // v1.4: Company ID (2) + Version (1) + Fault (1) + Status (1) + MAC (6) + Records (2)
    let minLengthV15 = 15  // v1.5: Company ID (2) + Version (1) + Fault (1) + Status (1) + Restart Reason (2) + MAC (6) + Records (2)
    guard data.count >= minLengthV14 else {
      NSLog("   Device may be using older firmware or truncated advertisement")
      return nil
    }
    guard !data.isEmpty else {
      return nil
    }
    let bytes = [UInt8](data)
    guard bytes.count >= minLengthV14 else {
      return nil
    }
    let rawHex = bytes.map { String(format: "%02X", $0) }.joined(separator: " ")
    
    // Detect firmware version based on data length
    let isV15 = bytes.count >= minLengthV15
    let sddVersion = isV15 ? "1.5" : "1.4"
    NSLog("🔍 RAW MANUFACTURER DATA (SDD v\(sddVersion)): \(rawHex)")
    
    guard bytes.count > 1 else { return nil }
    let companyId = UInt16(bytes[0]) | (UInt16(bytes[1]) << 8)
    if companyId != 0x1234 {
    }
    guard bytes.count > 2 else { return nil }
    let version = bytes[2]
    guard bytes.count > 3 else { return nil }
    let devicePeripheralStatus = bytes[3]
    guard bytes.count > 4 else { return nil }
    let deviceStatusRaw = bytes[4]
    let connectIndication = (deviceStatusRaw & 0x01) != 0    
    let timeSet = (deviceStatusRaw & 0x02) != 0              
    let factoryDefaults = (deviceStatusRaw & 0x04) != 0      
    let reservedBits = (deviceStatusRaw & 0xF8) >> 3
    
    // Firmware v1.5: Parse restart reason (2 bytes, little-endian) at bytes 5-6
    var restartReason: UInt16 = 0
    var restartReasonFlags: [String] = []
    var macStartIdx = 5  // v1.4: MAC starts at byte 5
    var recordStartIdx = 11  // v1.4: Record count starts at byte 11
    
    if isV15 && bytes.count > 6 {
      // v1.5: Restart reason at bytes 5-6, MAC shifted to 7-12, Records shifted to 13-14
      restartReason = UInt16(bytes[5]) | (UInt16(bytes[6]) << 8)
      macStartIdx = 7
      recordStartIdx = 13
      
      // Parse restart reason flags
      if restartReason != 0 {
        if (restartReason & 0x0001) != 0 { restartReasonFlags.append("ExternalPinReset") }
        if (restartReason & 0x0002) != 0 { restartReasonFlags.append("SoftwareReset") }
        if (restartReason & 0x0004) != 0 { restartReasonFlags.append("BrownoutReset") }
        if (restartReason & 0x0008) != 0 { restartReasonFlags.append("PowerOnReset") }
        if (restartReason & 0x0010) != 0 { restartReasonFlags.append("WatchdogReset") }
        if (restartReason & 0x0020) != 0 { restartReasonFlags.append("DebugEventReset") }
        if (restartReason & 0x0040) != 0 { restartReasonFlags.append("SecurityViolationReset") }
        if (restartReason & 0x0080) != 0 { restartReasonFlags.append("LowPowerWakeup") }
        if (restartReason & 0x0100) != 0 { restartReasonFlags.append("CPULockupReset") }
        if (restartReason & 0x0200) != 0 { restartReasonFlags.append("ParityErrorReset") }
        if (restartReason & 0x0400) != 0 { restartReasonFlags.append("PLLFaultReset") }
        if (restartReason & 0x0800) != 0 { restartReasonFlags.append("ClockFailureReset") }
        if (restartReason & 0x1000) != 0 { restartReasonFlags.append("HardwareReset") }
        if (restartReason & 0x2000) != 0 { restartReasonFlags.append("UserReset") }
        if (restartReason & 0x4000) != 0 { restartReasonFlags.append("TemperatureThresholdReset") }
      }
    }
    
    // Parse MAC ID (6 bytes starting at macStartIdx)
    var macId = "00:00:00:00:00:00" 
    var macIdValid = false
    let macEndIdx = macStartIdx + 5
    if bytes.count > macEndIdx {
      macId = String(format: "%02X:%02X:%02X:%02X:%02X:%02X",
                    bytes[macEndIdx], bytes[macEndIdx - 1], bytes[macEndIdx - 2],
                    bytes[macEndIdx - 3], bytes[macEndIdx - 4], bytes[macEndIdx - 5])
      let macBytes = Array(bytes[macStartIdx...macEndIdx])
      let allZero = macBytes.allSatisfy { $0 == 0x00 }
      let allFF = macBytes.allSatisfy { $0 == 0xFF }
      macIdValid = !allZero && !allFF
      if !macIdValid {
      }
    } else if bytes.count > macStartIdx {
      var macBytes: [String] = []
      let actualEndIdx = min(macEndIdx, bytes.count - 1)
      for i in stride(from: actualEndIdx, through: macStartIdx, by: -1) {
        macBytes.append(String(format: "%02X", bytes[i]))
      }
      while macBytes.count < 6 {
        macBytes.insert("00", at: 0)
      }
      macId = macBytes.joined(separator: ":")
      let hasValidBytes = bytes[macStartIdx...actualEndIdx].contains { $0 != 0x00 && $0 != 0xFF }
      macIdValid = hasValidBytes
    } else {
      macIdValid = false
    }
    
    // Parse record count (2 bytes, little-endian starting at recordStartIdx)
    var recordCount: UInt16 = 0
    if bytes.count > recordStartIdx + 1 {
      recordCount = UInt16(bytes[recordStartIdx]) | (UInt16(bytes[recordStartIdx + 1]) << 8)
    } else if bytes.count > recordStartIdx {
      recordCount = UInt16(bytes[recordStartIdx])
    }
    var isCorrupted = false
    var corruptionReason = ""
    if bytes.count < minLengthV14 {
      NSLog("   📍 MAC ID valid: \(macIdValid), MAC: \(macId)")
    } else if bytes.count != minLengthV14 && bytes.count != minLengthV15 {
    }
    if companyId != SMART_TAG_MANUFACTURER_ID {
    }
    // SDD v1.5: "The record count can be configured up to a maximum of 25,000"
    if recordCount > MAX_TOTAL_RECORDS {
      isCorrupted = true
      corruptionReason = "Record count too high: \(recordCount) (SDD max \(MAX_TOTAL_RECORDS))"
    }
    if version > 100 {
    }
    if isCorrupted {
      NSLog("⚠️ MANUFACTURER DATA VALIDATION FAILED!")
      NSLog("   Reason: \(corruptionReason)")
      NSLog("   Using safe defaults")
    }
    let safeRecordCount = isCorrupted ? 0 : recordCount
    let deviceStatus = devicePeripheralStatus == 0 ? "Good" : "Problem"
    if isCorrupted {
      NSLog("   ⚠️ Using safe defaults due to validation failure")
    }
    NSLog("   ✅ Parsed Values (SDD v\(sddVersion)):")
    NSLog("      Company ID: 0x\(String(format: "%04X", companyId))")
    NSLog("      Version: \(version)")
    NSLog("      Device Peripheral Status: \(deviceStatus)")
    NSLog("      Device Status Bits: Connect=\(connectIndication), TimeSet=\(timeSet), FactoryDefaults=\(factoryDefaults)")
    if isV15 && restartReason != 0 {
      NSLog("      Restart Reason: 0x\(String(format: "%04X", restartReason)) - \(restartReasonFlags.joined(separator: ", "))")
    }
    NSLog("      📍 MAC Address: \(macId)")
    NSLog("      Record Count: \(safeRecordCount)")
    
    var result: [String: Any] = [
      "companyId": Int(companyId),
      "version": Int(version),
      "devicePeripheralStatus": Int(devicePeripheralStatus),
      "deviceStatus": deviceStatus,
      "deviceStatusRaw": Int(deviceStatusRaw),
      "connectIndication": connectIndication,
      "timeSet": timeSet,
      "factoryDefaults": factoryDefaults,
      "macId": macId,
      "macIdValid": macIdValid, 
      "recordCount": Int(safeRecordCount),
      "rawRecordCount": Int(recordCount),
      "batteryMillivolts": 0, 
      "rawBatteryMillivolts": 0,
      "batteryLevel": 0, 
      "isCorrupted": isCorrupted,
      "corruptionReason": isCorrupted ? corruptionReason : "",
      "sddVersion": sddVersion
    ]
    
    // Add restart reason for v1.5
    if isV15 {
      result["restartReason"] = Int(restartReason)
      result["restartReasonFlags"] = restartReasonFlags
    }
    
    return result
  }
  // MARK: - Auto-Connect Management (React Native API)
  
  /// Enable automatic connection to bonded devices
  /// - Starts scanning and connects to any discovered bonded device
  /// - Implements iOS state restoration for background reconnection
  /// - Syncs system-bonded devices with app's bond list
  /// - Parameters:
  ///   - resolve: Promise resolver returning auto-connect status
  ///   - reject: Promise rejecter (currently unused)
  @objc(startAutoConnect:rejecter:)
  func startAutoConnect(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Request notification permissions for background alerts
    requestNotificationPermissionsIfNeeded()
    
    // Initialize central manager if needed
    if centralManager == nil {
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
    } else {
    }
    if let manager = centralManager, manager.state == .poweredOn {
      syncSystemBondedDevices()
    }
    if bondedDeviceIDs.isEmpty {
      NSLog("⏸️ Skipping auto-connect: no bonded devices (after syncing system bonds)")
      resolve(["status": "skipped", "reason": "no_bonded_devices"])
      return
    }
    autoConnectEnabled = true
    startHealthChecks()
    if centralManager?.state == .poweredOn {
      startScanning()
    }
    resolve(["status": "Auto-connect started"])
  }
  /// Disable automatic connection
  /// - Stops scanning, disconnects all devices, cancels reconnection timers
  /// - Parameters:
  ///   - resolve: Promise resolver returning stop status
  ///   - reject: Promise rejecter (currently unused)
  @objc(stopAutoConnect:rejecter:)
  func stopAutoConnect(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    autoConnectEnabled = false
    centralManager?.stopScan()
    healthCheckTimer?.invalidate()
    healthCheckTimer = nil
    
    // Disconnect all devices
    for peripheral in connectedPeripherals {
      centralManager?.cancelPeripheralConnection(peripheral)
    }
    connectedPeripherals.removeAll()
    
    // Cancel all reconnection timers
    for (_, timer) in reconnectTimers { timer.invalidate() }
    reconnectTimers.removeAll()
    healthCheckFailures.removeAll()
    
    resolve(["status": "Auto-connect stopped"])
  }
  
  // MARK: - Device Bonding Management (React Native API)
  
  /// Add a device to the bonded devices list (enables auto-connect)
  /// - Persists to UserDefaults for persistence across app restarts
  /// - Parameters:
  ///   - deviceId: UUID string of the device to bond
  ///   - resolve: Promise resolver returning add status
  ///   - reject: Promise rejecter (currently unused)
  @objc(addBondedDevice:resolver:rejecter:)
  func addBondedDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    bondedDeviceIDs.insert(deviceId)
    saveBondedDevices()
    resolve(["deviceId": deviceId, "status": "added"])
  }
  
  /// Remove a device from bonded list and add to forgotten list
  /// - Forgotten devices will not auto-connect even if discovered
  /// - Parameters:
  ///   - deviceId: UUID string of the device to unbond
  ///   - resolve: Promise resolver returning remove status
  ///   - reject: Promise rejecter (currently unused)
  @objc(removeBondedDevice:resolver:rejecter:)
  func removeBondedDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    bondedDeviceIDs.remove(deviceId)
    forgottenDeviceIDs.insert(deviceId)
    saveBondedDevices()
    saveForgottenDevices()
    resolve(["deviceId": deviceId, "status": "removed"])
  }
  private func getBondedDevicesArray() -> [String] {
    if let devices = UserDefaults.standard.array(forKey: "BondedSmartTagDevices") as? [String] {
      return devices
    }
    return []
  }
  @objc(getForgottenDevices:rejecter:)
  func getForgottenDevices(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let devices = Array(forgottenDeviceIDs)
    resolve(["forgottenDevices": devices])
  }
  @objc(getBondedDevices:rejecter:)
  func getBondedDevices(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let devices = Array(bondedDeviceIDs)
    resolve(["bondedDevices": devices])
  }
  @objc(forceScanForBondedDevices:rejecter:)
  func forceScanForBondedDevices(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready (state: \(manager.state.rawValue))", nil)
      return
    }
    manager.stopScan()
    manager.scanForPeripherals(
      withServices: nil, 
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) {
      manager.stopScan()
    }
    resolve(["status": "Force scan started"])
  }
  @objc(debugConnectionStatus:rejecter:)
  func debugConnectionStatus(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let healthTagConnected = connectedPeripherals.first { $0.name == "Health Tag" }
    let healthTagInfo = healthTagConnected != nil ? [
      "name": healthTagConnected?.name ?? "Unknown",
      "uuid": healthTagConnected?.identifier.uuidString ?? "Unknown",
      "state": healthTagConnected?.state.rawValue ?? -1
    ] : nil
    let status: [String: Any] = [
      "centralManagerState": centralManager?.state.rawValue ?? -1,
      "isScanning": centralManager?.isScanning ?? false,
      "connectingDevicesCount": connectingPeripherals.count,
      "connectedDevicesCount": connectedPeripherals.count,
      "bondedDevicesCount": bondedDeviceIDs.count,
      "autoConnectEnabled": autoConnectEnabled,
      "connectingDevices": Array(connectingPeripherals.keys),
      "connectedDevices": connectedPeripherals.map { ["name": $0.name ?? "Unknown", "uuid": $0.identifier.uuidString, "state": $0.state.rawValue] },
      "bondedDevices": Array(bondedDeviceIDs),
      "healthTagConnected": healthTagConnected != nil,
      "healthTagInfo": healthTagInfo as Any
    ]
    resolve(status)
  }
  @objc(connectToKnownPeripherals:rejecter:)
  func connectToKnownPeripherals(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready", nil)
      return
    }
    let bondedDevices = getBondedDevicesArray()
    if bondedDevices.isEmpty {
      resolve(["status": "No bonded devices to connect", "attempted": 0])
      return
    }
    let uuids = bondedDevices.compactMap { UUID(uuidString: $0) }
    let knownPeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
    var attempted = 0
    for peripheral in knownPeripherals {
      if peripheral.state != .connected {
        peripheral.delegate = self
        let connectionOptions: [String: Any] = [
          CBConnectPeripheralOptionNotifyOnConnectionKey: true,
          CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
          CBConnectPeripheralOptionNotifyOnNotificationKey: true
        ]
        manager.connect(peripheral, options: connectionOptions)
        attempted += 1
      } else {
      }
    }
    resolve([
      "status": "Connection attempts started", 
      "attempted": attempted,
      "knownPeripherals": knownPeripherals.count
    ])
  }
  @objc(getAutoConnectStatus:rejecter:)
  func getAutoConnectStatus(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseResolveBlock) {
    let isScanning = centralManager?.isScanning ?? false
    cleanupStaleConnections()
    let status = [
      "enabled": autoConnectEnabled,
      "bondedDevicesCount": bondedDeviceIDs.count,
      "connectedDevicesCount": connectedPeripherals.count,
      "centralManagerState": centralManager?.state.rawValue ?? -1,
      "isScanning": isScanning,
      "bondedDevices": Array(bondedDeviceIDs)
    ] as [String : Any]
    resolve(status)
  }
  @objc(sendSystemCommand:commandId:payload:resolver:rejecter:)
  func sendSystemCommand(deviceId: String, commandId: NSNumber, payload: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let command = commandId.uint8Value
    let payloadBytes = payload.compactMap { ($0 as? NSNumber)?.uint8Value }
    let success = sendSystemCommand(deviceId: deviceId, commandId: command, payload: payloadBytes)
    if success {
      resolve(["success": true])
    } else {
      reject("SYSTEM_COMMAND_ERROR", "Failed to send system command", nil)
    }
  }
  @objc(updatePasskey:passkey:resolver:rejecter:)
  func updatePasskey(deviceId: String, passkey: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard passkey.count == 6 else {
      reject("INVALID_PASSKEY", "Passkey must be exactly 6 digits (0-9), got \(passkey.count) characters", nil)
      return
    }
    guard passkey.allSatisfy({ $0.isNumber }) else {
      reject("INVALID_PASSKEY", "Passkey must contain only numeric digits (0-9)", nil)
      return
    }
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected: \(deviceId)", nil)
      return
    }
    guard peripheral.state == .connected else {
      reject("DEVICE_NOT_CONNECTED", "Device not in connected state: \(deviceId)", nil)
      return
    }
    let success = sendPasskeyUpdateCommand(deviceId: deviceId, passkey: passkey)
    if success {
      resolve([
        "success": true,
        "deviceId": deviceId,
        "message": "Passkey update command sent successfully",
        "passkey": passkey
      ])
    } else {
      reject("PASSKEY_UPDATE_ERROR", "Failed to send passkey update command", nil)
    }
  }
  private func cleanupStaleConnections() {
    var devicesToRemove: [CBPeripheral] = []
    for peripheral in connectedPeripherals {
      if peripheral.state != .connected {
        devicesToRemove.append(peripheral)
      }
    }
    for peripheral in devicesToRemove {
      connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
    }
  }
  private func cleanupStaleDevices() {
    let devicesToRemove = scannedDevices.filter { deviceId, peripheral in
      let isConnected = connectedPeripherals.contains(where: { $0.identifier.uuidString == deviceId })
      let isBonded = bondedDeviceIDs.contains(deviceId)
      return !isConnected && !isBonded
    }
    let sortedDevices = Array(devicesToRemove.keys).prefix(10)
    for deviceId in sortedDevices {
      scannedDevices.removeValue(forKey: deviceId)
      deviceRSSI.removeValue(forKey: deviceId)
      deviceServices.removeValue(forKey: deviceId)
      deviceCharacteristics.removeValue(forKey: deviceId)
    }
    if !sortedDevices.isEmpty {
    }
  }
  @objc(disconnectFromNative:resolver:rejecter:)
  func disconnectFromNative(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) {
      centralManager?.cancelPeripheralConnection(peripheral)
      connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
      connectingPeripherals.removeValue(forKey: deviceId)
      if let timer = reconnectTimers[deviceId] {
        timer.invalidate()
        reconnectTimers.removeValue(forKey: deviceId)
        reconnectBackoff.removeValue(forKey: deviceId)
        reconnectAttempts.removeValue(forKey: deviceId) 
      }
      if let timer = serviceDiscoveryTimers[deviceId] {
        timer.invalidate()
        serviceDiscoveryTimers.removeValue(forKey: deviceId)
      }
      resolve([
        "success": true,
        "message": "Device disconnected from native iOS",
        "deviceId": deviceId
      ])
    } else {
      resolve([
        "success": true,
        "message": "Device not in native connected list",
        "deviceId": deviceId
      ])
    }
  }
  @objc(getResourceStatus:rejecter:)
  func getResourceStatus(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let status: [String: Any] = [
      "connectedDevices": connectedPeripherals.count,
      "connectingDevices": connectingPeripherals.count,
      "bondedDevices": bondedDeviceIDs.count,
      "forgottenDevices": forgottenDeviceIDs.count,
      "activeTimers": [
        "serviceDiscovery": serviceDiscoveryTimers.count,
        "reconnect": reconnectTimers.count,
        "dataSync": dataSyncTimers.count
      ],
      "activeState": [
        "dataSyncStates": dataSyncState.count,
        "deviceServices": deviceServices.count,
        "deviceCharacteristics": deviceCharacteristics.count
      ],
      "memoryPressure": [
        "pendingPromises": pendingPromises.count,
        "pendingRejecters": pendingRejecters.count,
        "errorContexts": errorContexts.count
      ]
    ]
    resolve(status)
  }
  
  // MARK: - McuMgr DFU (React Native API - matches Android SampleBridgeAndroid)
  
  /// Start MCUboot DFU over SMP (McuMgr). Same flow as Android: release app connection, wait 5s, then McuMgr connects and runs validate → upload → confirm → reset.
  @objc(startMcuMgrDfu:firmwarePath:resolver:rejecter:)
  func startMcuMgrDfu(deviceId: String, firmwarePath: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    if currentMcuMgrDfuDeviceId != nil {
      reject("DFU_IN_PROGRESS", "A DFU is already in progress for \(currentMcuMgrDfuDeviceId!)", nil)
      return
    }
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    let peripheral = connectedPeripherals.first { $0.identifier.uuidString == deviceId }
      ?? scannedDevices[deviceId]
      ?? manager.retrievePeripherals(withIdentifiers: [UUID(uuidString: deviceId)].compactMap { $0 }).first
    guard let peripheral = peripheral else {
      reject("DEVICE_NOT_FOUND", "Device not found. Connect or scan first.", nil)
      return
    }
    // Android-style: resolve to readable firmware (file:// or content-style). Parse URI, then either use path if it exists or read bytes and copy to Caches (like Android readFirmwareFileBytes + content://).
    let fileURL: URL
    if firmwarePath.hasPrefix("file://") {
      guard let parsed = URL(string: firmwarePath), parsed.scheme == "file" else {
        reject("INVALID_FIRMWARE", "Invalid file URI: \(firmwarePath)", nil)
        return
      }
      fileURL = parsed
    } else {
      fileURL = URL(fileURLWithPath: firmwarePath)
    }
    let resolvedURL: URL
    if FileManager.default.fileExists(atPath: fileURL.path) {
      resolvedURL = fileURL
    } else {
      // Path not found (e.g. Inbox cleared, or App Group path) – try to read bytes then write to Caches (mirrors Android openInputStream/read).
      let needsSecurityScope = fileURL.startAccessingSecurityScopedResource()
      defer { if needsSecurityScope { fileURL.stopAccessingSecurityScopedResource() } }
      guard let data = try? Data(contentsOf: fileURL), !data.isEmpty else {
        reject("INVALID_FIRMWARE", "Could not read firmware file: \(firmwarePath)", nil)
        return
      }
      let cachesDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
      let dfuDir = cachesDir.appendingPathComponent("DFU", isDirectory: true)
      try? FileManager.default.createDirectory(at: dfuDir, withIntermediateDirectories: true)
      let tempFile = dfuDir.appendingPathComponent("firmware_\(UUID().uuidString).bin", isDirectory: false)
      do {
        try data.write(to: tempFile)
      } catch {
        reject("INVALID_FIRMWARE", "Could not write firmware copy: \(error.localizedDescription)", nil)
        return
      }
      resolvedURL = tempFile
    }
    currentMcuMgrDfuDeviceId = deviceId
    // Notify JS that we released the connection for DFU (same as Android)
    sendEvent(withName: "DeviceDisconnected", body: [
      "deviceId": deviceId,
      "connectionState": "disconnected",
      "reason": "released_for_dfu"
    ])
    // Disconnect and clean up app-side state so McuMgr can have the only link
    manualDisconnectInProgress.insert(deviceId)
    connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
    connectingPeripherals.removeValue(forKey: deviceId)
    connectionTimeoutTimers[deviceId]?.cancel()
    connectionTimeoutTimers.removeValue(forKey: deviceId)
    connectionRetryAttempts.removeValue(forKey: deviceId)
    serviceDiscoveryTimers[deviceId]?.invalidate()
    serviceDiscoveryTimers.removeValue(forKey: deviceId)
    reconnectTimers[deviceId]?.invalidate()
    reconnectTimers.removeValue(forKey: deviceId)
    reconnectBackoff.removeValue(forKey: deviceId)
    reconnectAttempts.removeValue(forKey: deviceId)
    manager.cancelPeripheralConnection(peripheral)
    let urlToUse = resolvedURL
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      Thread.sleep(forTimeInterval: 5.0)
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.performMcuMgrDfuStart(peripheral: peripheral, deviceId: deviceId, fileURL: urlToUse, resolver: resolve, rejecter: reject)
      }
    }
  }
  
  private func performMcuMgrDfuStart(peripheral: CBPeripheral, deviceId: String, fileURL: URL, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    do {
      let package = try McuMgrPackage(from: fileURL)
      let transport = McuMgrBleTransport(peripheral)
      // When negotiated MTU is small (e.g. 73), the library would fail with "Insufficient MTU" when sending
      // packets larger than MTU. Enable chunking so payloads are split to MTU-sized pieces (same as when
      // reassembly is used on the device).
      transport.chunkSendDataToMtuSize = true
      let delegate = DFUEventForwarder(module: self, deviceId: deviceId)
      mcuMgrDfuDelegate = delegate
      let upgradeManager = FirmwareUpgradeManager(transport: transport, delegate: delegate)
      var config = FirmwareUpgradeConfiguration(estimatedSwapTime: 7.0, eraseAppSettings: false, pipelineDepth: 1)
      config.upgradeMode = .confirmOnly
      mcuMgrDfuManager = upgradeManager
      upgradeManager.start(package: package, using: config)
      let imageSize = (try? Data(contentsOf: fileURL))?.count ?? 0
      resolve([
        "status": "started",
        "deviceId": deviceId,
        "firmwarePath": fileURL.path,
        "imageSize": imageSize
      ] as [String: Any])
    } catch {
      currentMcuMgrDfuDeviceId = nil
      mcuMgrDfuManager = nil
      mcuMgrDfuDelegate = nil
      manualDisconnectInProgress.remove(deviceId)
      reject("DFU_START_ERROR", error.localizedDescription, error)
    }
  }
  
  @objc(cancelMcuMgrDfu:rejecter:)
  func cancelMcuMgrDfu(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = mcuMgrDfuManager else {
      reject("NO_DFU_IN_PROGRESS", "No DFU in progress", nil)
      return
    }
    manager.cancel()
    let deviceId = currentMcuMgrDfuDeviceId ?? "unknown"
    currentMcuMgrDfuDeviceId = nil
    mcuMgrDfuManager = nil
    mcuMgrDfuDelegate = nil
    manualDisconnectInProgress.remove(deviceId)
    resolve(["status": "cancelled", "deviceId": deviceId])
  }
  
  private func findDeviceData(deviceId: String) -> CBPeripheral? {
    if let p = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) { return p }
    if let p = scannedDevices[deviceId] { return p }
    guard let manager = centralManager, let uuid = UUID(uuidString: deviceId) else { return nil }
    return manager.retrievePeripherals(withIdentifiers: [uuid]).first
  }
  private func cleanupPeripheralConnection(deviceId: String) {
    if let index = connectedPeripherals.firstIndex(where: { $0.identifier.uuidString == deviceId }) {
      let peripheral = connectedPeripherals[index]
      centralManager?.cancelPeripheralConnection(peripheral)
      connectedPeripherals.remove(at: index)
    }
    connectingPeripherals.removeValue(forKey: deviceId)
    reconnectTimers[deviceId]?.invalidate()
    reconnectTimers.removeValue(forKey: deviceId)
    reconnectBackoff.removeValue(forKey: deviceId)
    reconnectAttempts.removeValue(forKey: deviceId)
    // Clear initial sync flag on disconnect (will need to sync again on reconnect)
    hasCompletedInitialSync.removeValue(forKey: deviceId)
    cleanupDeviceResources(deviceId: deviceId)
  }
  private func classifyError(_ error: Error?) -> BLEErrorType {
    guard let error = error else {
      return .PERMANENT
    }
    let nsError = error as NSError
    let errorCode = nsError.code
    let errorDescription = error.localizedDescription.lowercased()
    if errorCode == 6 ||   
       errorCode == 10 ||  
       errorDescription.contains("timeout") ||
       errorDescription.contains("temporary") ||
       errorDescription.contains("connection lost") {
      return .TRANSIENT
    }
    if errorCode == 4 ||   
       errorCode == 7 ||   
       errorDescription.contains("permission") ||
       errorDescription.contains("authorization") ||
       errorDescription.contains("pairing") ||
       errorDescription.contains("authentication") {
      return .USER_ACTION
    }
    return .PERMANENT
  }
  private func canRetryError(_ error: Error?) -> Bool {
    return classifyError(error) == .TRANSIENT
  }
  private func requiresUserAction(_ error: Error?) -> Bool {
    return classifyError(error) == .USER_ACTION
  }
  private func cleanupDeviceResources(deviceId: String) {
    serviceDiscoveryTimers[deviceId]?.invalidate()
    serviceDiscoveryTimers.removeValue(forKey: deviceId)
    
    // Clear service discovery retry tracking
    serviceDiscoveryRetryAttempts.removeValue(forKey: deviceId)
    serviceDiscoveryStartTimes.removeValue(forKey: deviceId)
    
    connectionTimeoutTimers[deviceId]?.cancel()
    connectionTimeoutTimers.removeValue(forKey: deviceId)
    connectionRetryAttempts.removeValue(forKey: deviceId)
    keepAliveTimers[deviceId]?.invalidate()
    keepAliveTimers.removeValue(forKey: deviceId)
    reconnectTimers[deviceId]?.invalidate()
    reconnectTimers.removeValue(forKey: deviceId)
    reconnectBackoff.removeValue(forKey: deviceId)
    reconnectAttempts.removeValue(forKey: deviceId) 
    dataSyncTimers[deviceId]?.invalidate()
    dataSyncTimers.removeValue(forKey: deviceId)
    setTimeTimeoutTimers[deviceId]?.invalidate()
    setTimeTimeoutTimers.removeValue(forKey: deviceId)
    systemCommandsSent.removeValue(forKey: deviceId)
    dataSyncState.removeValue(forKey: deviceId)
    dataSyncRetryCount.removeValue(forKey: deviceId)
    setTimeRetryAttempts.removeValue(forKey: deviceId)
    setTimeResponseReceived.removeValue(forKey: deviceId)
    deviceRecordCounts.removeValue(forKey: deviceId)
    syncTotalRecords.removeValue(forKey: deviceId)
    syncRecordsReceived.removeValue(forKey: deviceId)
    syncCurrentFileNumber.removeValue(forKey: deviceId)
    syncGrandTotalReceived.removeValue(forKey: deviceId)
    recordPathChunkAdvanced.removeValue(forKey: deviceId)
    pendingStartNextChunkAfterStopResponse.removeValue(forKey: deviceId)
    dataSyncRequested.removeValue(forKey: deviceId)
    deviceStatusNotificationCount.removeValue(forKey: deviceId)
    healthCheckFailures.removeValue(forKey: deviceId)
    deviceServices.removeValue(forKey: deviceId)
    deviceCharacteristics.removeValue(forKey: deviceId)
    notificationEnableInProgress.removeValue(forKey: deviceId)  // FIX: Reset on disconnect
    deviceNotificationStates.removeValue(forKey: deviceId)  // FIX: Clear notification states
    hasCompletedInitialSync.removeValue(forKey: deviceId)  // FIX: Clear initial sync flag on disconnect (will sync on reconnect)
    hasStartedInitialSync.removeValue(forKey: deviceId)  // FIX: Clear started flag on disconnect
    hasEmittedDeviceConnected.removeValue(forKey: deviceId)  // FIX: Clear emitted flag on disconnect
    hasEmittedConnectedLog.removeValue(forKey: deviceId)  // FIX: Clear ConnectionLog "Connected" deduplication
    rtcCheckPendingBeforeNotifications.removeValue(forKey: deviceId)  // FIX: Clear RTC check pending flag
    lastDataTransferHex.removeValue(forKey: deviceId)  // FIX: Clear data transfer deduplication on disconnect
    lastDataTransferTime.removeValue(forKey: deviceId)  // FIX: Clear data transfer timestamp on disconnect
    discoveryQueue.async { [weak self] in
      self?.servicesWithPendingCharDiscovery.removeValue(forKey: deviceId)
      self?.discoveryCompleteEventSent.removeValue(forKey: deviceId)
    }
    connectingPeripherals.removeValue(forKey: deviceId)
  }
  private func saveBondedDevices() {
    let devices = Array(bondedDeviceIDs)
    UserDefaults.standard.set(devices, forKey: "BondedSmartTagDevices")
  }
  private func loadBondedDevices() {
    if let devices = UserDefaults.standard.array(forKey: "BondedSmartTagDevices") as? [String] {
      bondedDeviceIDs = Set(devices)
    }
  }
  private func getDeviceName(deviceId: String) -> String? {
    return UserDefaults.standard.string(forKey: "device_name_\(deviceId)")
  }
  private func saveDeviceName(deviceId: String, deviceName: String) {
    UserDefaults.standard.set(deviceName, forKey: "device_name_\(deviceId)")
  }
  private func saveForgottenDevices() {
    let devices = Array(forgottenDeviceIDs)
    UserDefaults.standard.set(devices, forKey: "ForgottenSmartTagDevices")
  }
  private func loadForgottenDevices() {
    if let devices = UserDefaults.standard.array(forKey: "ForgottenSmartTagDevices") as? [String] {
      forgottenDeviceIDs = Set(devices)
    }
  }
  // MARK: - CBCentralManagerDelegate Methods
  
  /// Called when Bluetooth state changes (powered on/off, unauthorized, etc.)
  /// - Resolves or rejects any pending permission requests
  /// - Starts auto-connect if enabled and devices are bonded
  /// - Parameter central: The central manager whose state changed
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    let resolvers = pendingPermissionResolvers
    pendingPermissionResolvers.removeAll()
    
    switch central.state {
    case .poweredOn:
      for (resolve, _) in resolvers {
        resolve(["status": "granted", "state": "poweredOn"])
      }
      querySystemConnectedPeripherals()
      if bondedDeviceIDs.count > 0 && !autoConnectEnabled {
        autoConnectEnabled = true
      }
      if autoConnectEnabled {
        startScanning()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          self.connectToKnownPeripheralsNative()
        }
      }
    case .poweredOff:
      connectedPeripherals.removeAll()
      for (_, reject) in resolvers {
        reject("BLUETOOTH_OFF", "Bluetooth is powered off", nil)
      }
    case .resetting:
      connectedPeripherals.removeAll()
      for (_, reject) in resolvers {
        reject("RESETTING", "Bluetooth is resetting", nil)
      }
    case .unauthorized:
      for (_, reject) in resolvers {
        reject("UNAUTHORIZED", "Bluetooth access unauthorized", nil)
      }
    case .unsupported:
      for (_, reject) in resolvers {
        reject("UNSUPPORTED", "Bluetooth not supported", nil)
      }
    case .unknown:
      for (_, reject) in resolvers {
        reject("UNKNOWN", "Bluetooth state unknown", nil)
      }
    @unknown default:
      for (_, reject) in resolvers {
        reject("UNKNOWN", "Unknown Bluetooth state", nil)
      }
    }
  }
  /// Called when iOS restores app state (app terminated in background)
  /// - iOS maintains BLE connections in background and restores them when app relaunches
  /// - Reattaches delegates and emits events for restored connections
  /// - Parameter dict: Dictionary containing restored peripherals and scan services
  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String : Any]) {
    // Restore connected peripherals
    if let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] {
      connectedPeripherals = peripherals
      for peripheral in peripherals {
        peripheral.delegate = self
        let deviceId = peripheral.identifier.uuidString
        if peripheral.state != .connected {
          connectingPeripherals.removeValue(forKey: deviceId)
          continue
        }
        if bondedDeviceIDs.contains(deviceId) {
          // ✅ FIX: Use guard to prevent duplicate DeviceConnected events
          if hasEmittedDeviceConnected[deviceId] == true {
            NSLog("   ⏭️ DeviceConnected already emitted for restored device \(deviceId) - skipping duplicate")
            continue
          }
          hasEmittedDeviceConnected[deviceId] = true
          let deviceInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": peripheral.name ?? "Unknown",
            "connectionType": "restored"
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
          }
        }
      }
    }
    if let scanServices = dict[CBCentralManagerRestoredStateScanServicesKey] as? [CBUUID] {
      if autoConnectEnabled {
        startScanning()
      }
    }
    if autoConnectEnabled && dict[CBCentralManagerRestoredStateScanServicesKey] == nil {
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        self.startScanning()
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          self.connectToKnownPeripheralsNative()
        }
      }
    }
  }
  /// Called when a BLE device is discovered during scanning
  /// - Implements multi-criteria device filtering (service UUID, manufacturer ID, device name)
  /// - Parses manufacturer data for device status (battery, record count, MAC address)
  /// - Auto-connects to bonded devices if auto-connect is enabled
  /// - Parameters:
  ///   - central: The central manager providing the update
  ///   - peripheral: The discovered peripheral
  ///   - advertisementData: Advertisement data including services and manufacturer data
  ///   - RSSI: Signal strength in dBm (-90 to 0, higher is better)
  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
    let deviceName = peripheral.name ?? "Unknown"
    let deviceId = peripheral.identifier.uuidString
    
    // Apply device filters
    let isDyreIDDevice = deviceName == "DyreID" || deviceName.contains("DyreID") || deviceName.contains("Health Tag")
    let serviceUUIDs = advertisementData["kCBAdvDataServiceUUIDs"] as? [CBUUID] ?? []
    let hasCorrectService = serviceUUIDs.contains(smartTagServiceUUID)
    let hasManufacturerID = isSmartHealthTag(advertisementData: advertisementData)
    NSLog("🔍 [iOS] Discovered: \(deviceName) | ID: \(deviceId) | RSSI: \(RSSI)")
    NSLog("   - Is DyreID device: \(isDyreIDDevice)")
    NSLog("   - Has correct service UUID: \(hasCorrectService)")
    NSLog("   - Service UUIDs: \(serviceUUIDs.map { $0.uuidString })")
    NSLog("   - Has valid manufacturer ID: \(hasManufacturerID)")
    if let manufacturerData = advertisementData["kCBAdvDataManufacturerData"] as? Data {
      NSLog("   - Manufacturer data: \(manufacturerData.map { String(format: "%02X", $0) }.joined(separator: " "))")
    } else {
      NSLog("   - Manufacturer data: NONE")
    }
    var shouldAcceptDevice = false
    var acceptReason = ""
    if hasManufacturerID {
      shouldAcceptDevice = true
      acceptReason = "Valid manufacturer ID (0x1234) with proper data structure"
    } else if hasCorrectService {
      shouldAcceptDevice = true
      acceptReason = "Correct service UUID (0f0e0d0c-0b0a-0908-0706-050403020100)"
    } else if isDyreIDDevice {
      shouldAcceptDevice = true
      acceptReason = "DyreID/Health Tag device name"
    }
    if !shouldAcceptDevice {
      NSLog("   ❌ Device rejected - does not match any filter criteria")
      return
    }
    NSLog("   ✅ Device ACCEPTED - Reason: \(acceptReason)")
    scannedDevices[deviceId] = peripheral
    if scannedDevices.count > Self.MAX_DEVICE_MAP_SIZE {
      cleanupStaleDevices()
    }
    deviceRSSI[deviceId] = RSSI.intValue
    var manufacturerInfo: [String: Any] = [:]
    if let manufacturerData = advertisementData["kCBAdvDataManufacturerData"] as? Data {
      if let parsedData = parseManufacturerData(manufacturerData) {
        manufacturerInfo = parsedData
        if let macId = parsedData["macId"] as? String {
          let macValid = parsedData["macIdValid"] as? Bool ?? false
          if macValid {
          } else {
          }
        } else {
        }
        if let recordCount = parsedData["recordCount"] as? Int {
          deviceRecordCounts[deviceId] = recordCount
          NSLog("📊 Device \(deviceName) has \(recordCount) records available")
        } else {
        }
      } else {
        NSLog("   📊 Raw manufacturer data: \(manufacturerData.map { String(format: "%02X", $0) }.joined(separator: " "))")
        NSLog("   📊 Data length: \(manufacturerData.count) bytes")
        manufacturerInfo = [
          "macId": "00:00:00:00:00:00",
          "macIdValid": false,
          "recordCount": 0,
          "rawRecordCount": 0,
          "parsingError": true,
          "dataLength": manufacturerData.count
        ]
      }
    } else {
      manufacturerInfo = [
        "macId": "00:00:00:00:00:00",
        "macIdValid": false,
        "recordCount": 0,
        "rawRecordCount": 0,
        "noManufacturerData": true
      ]
    }
    var deviceInfo: [String: Any] = [
      "id": deviceId,
      "name": deviceName,
      "rssi": RSSI.intValue,
      "advertisementData": advertisementData,
      "manufacturerData": manufacturerInfo
    ]
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceFound", body: deviceInfo)
    }
    if let recordCount = manufacturerInfo["recordCount"] as? Int,
       let companyId = manufacturerInfo["companyId"] as? Int,
       let manufacturerData = advertisementData["kCBAdvDataManufacturerData"] as? Data {
      let manufacturerHex = manufacturerData.map { String(format: "%02X", $0) }.joined()
      DispatchQueue.main.async {
        self.sendEvent(withName: "DataTransfer", body: [
          "deviceId": deviceId,
          "type": "manufacturer_data",
          "companyId": companyId,
          "recordCount": recordCount,
          "batteryLevel": manufacturerInfo["batteryLevel"] ?? 0,
          "batteryMillivolts": manufacturerInfo["batteryMillivolts"] ?? 0,
          "deviceStatus": manufacturerInfo["deviceStatus"] ?? 0,
          "indication": manufacturerInfo["indication"] ?? 0,
          "rawData": manufacturerHex
        ])
      }
      if recordCount > 0 {
        NSLog("📊 Device \(deviceId) has \(recordCount) records available")
      }
    }
    if !shouldAllowConnection(deviceId: deviceId, isManualConnection: false) {
      return
    }
    let isTargetDevice = bondedDeviceIDs.contains(deviceId)
    if autoConnectEnabled {
      if !isTargetDevice {
        return
      }
      if forgottenDeviceIDs.contains(deviceId) {
        return
      }
      // Verify device is actually system-bonded before auto-connecting
      // This prevents trying to connect to devices that were forgotten from system Bluetooth
      if let manager = centralManager {
        let uuids = [peripheral.identifier]
        let retrievablePeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
        if retrievablePeripherals.isEmpty {
          NSLog("⚠️ [AUTO-CONNECT] Device \(deviceId) is in app's bonded list but not system-bonded - removing from app's list")
          bondedDeviceIDs.remove(deviceId)
          saveBondedDevices()
          return
        }
      }
      if isScanning {
        centralManager?.stopScan()
        isScanning = false
      }
    }
    if !isTargetDevice {
    }
    guard !connectedPeripherals.contains(peripheral) else {
      return
    }
    guard RSSI.intValue > -90 else {
      return
    }
    if connectingPeripherals[deviceId] != nil {
      return
    }
    if connectedPeripherals.contains(where: { $0.identifier == peripheral.identifier }) {
      return
    }
    connectingPeripherals[deviceId] = peripheral
    peripheral.delegate = self
    let connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
    ]
    central.connect(peripheral, options: connectionOptions)
    DispatchQueue.main.asyncAfter(deadline: .now() + 15.0) {
      if let connectingPeripheral = self.connectingPeripherals[deviceId] {
        central.cancelPeripheralConnection(connectingPeripheral)
        self.connectingPeripherals.removeValue(forKey: deviceId)
        self.startScanning()
      }
    }
  }
  // MARK: - Connection State Management
  
  /// Current connection state for each device (CONNECTED → SERVICES_READY → SECURE_READY → READY)
  /// iOS handles pairing automatically - no need to verify manually
  private var deviceConnectionStates: [String: ConnectionState] = [:]
  
  /// Called when device successfully connects (physical BLE connection established)
  /// - iOS has already handled pairing/bonding if needed (industry standard: trust iOS)
  /// - This is CONNECTED_LOW_LEVEL state - link established but not ready yet
  /// - Starts service discovery immediately
  /// - Parameters:
  ///   - central: The central manager providing the update
  ///   - peripheral: The connected peripheral
  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let deviceId = peripheral.identifier.uuidString
    NSLog("✅ [didConnect] Device connected: \(deviceId)")
    NSLog("   iOS has handled pairing/bonding automatically if needed")
    
    // ✅ FIX: Prevent duplicate ConnectionLog "Connected" events
    // didConnect can be called multiple times (e.g., system restoration + manual connection)
    let lastConnectedLogTime = hasEmittedConnectedLog[deviceId]
    let currentTime = Date()
    let shouldEmitConnectedLog = lastConnectedLogTime == nil || 
      currentTime.timeIntervalSince(lastConnectedLogTime!) > CONNECTED_LOG_DEDUPE_WINDOW_SECONDS
    
    if shouldEmitConnectedLog {
      hasEmittedConnectedLog[deviceId] = currentTime
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Connected",
          "status": 0,
          "platform": "iOS",
          "note": "BLE connection established - starting service discovery"
        ])
      }
    } else {
      let timeSinceLastLog = currentTime.timeIntervalSince(lastConnectedLogTime!)
      NSLog("⏭️ [CONNECTION] Skipping duplicate ConnectionLog 'Connected' event for \(deviceId) (last emitted \(Int(timeSinceLastLog * 1000))ms ago)")
    }
    
    if forgottenDeviceIDs.contains(deviceId) {
      let wasAutoConnect = connectingPeripherals[deviceId] != nil
      if wasAutoConnect {
        central.cancelPeripheralConnection(peripheral)
        return
      }
    }
    
    // Clean up connection state
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.append(peripheral)
    deviceConnectionStates[deviceId] = .CONNECTED
    connectionTimeoutTimers[deviceId]?.cancel()
    connectionTimeoutTimers.removeValue(forKey: deviceId)
    connectionRetryAttempts.removeValue(forKey: deviceId)
    
    // Clear service discovery retry tracking (fresh connection)
    serviceDiscoveryRetryAttempts.removeValue(forKey: deviceId)
    serviceDiscoveryStartTimes.removeValue(forKey: deviceId)
    
    // Stop scanning
    central.stopScan()
    isScanning = false
    
    // Clean up reconnect timers
    if let timer = reconnectTimers[deviceId] {
      timer.invalidate()
      reconnectTimers.removeValue(forKey: deviceId)
      reconnectBackoff.removeValue(forKey: deviceId)
      reconnectAttempts.removeValue(forKey: deviceId)
    }
    reconnectAttempts.removeValue(forKey: deviceId)
    
    // Start service discovery with retry mechanism
    NSLog("   Starting service discovery...")
    peripheral.delegate = self
    startServiceDiscoveryWithRetry(peripheral: peripheral, deviceId: deviceId, retryAttempt: 0)
  }
  
  /// Start service discovery with retry mechanism and timeout handling
  /// - Parameters:
  ///   - peripheral: The peripheral to discover services for
  ///   - deviceId: Device identifier
  ///   - retryAttempt: Current retry attempt (0 for first attempt)
  private func startServiceDiscoveryWithRetry(peripheral: CBPeripheral, deviceId: String, retryAttempt: Int) {
    // Check if peripheral is still connected
    guard peripheral.state == .connected else {
      NSLog("❌ [SERVICE DISCOVERY] Cannot start - peripheral not connected for \(deviceId)")
      return
    }
    
    // Check if services already discovered (some devices pre-cache)
    if let services = peripheral.services, !services.isEmpty {
      NSLog("✅ [SERVICE DISCOVERY] Services already available for \(deviceId) (\(services.count) services) - processing immediately")
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Service Discovery",
          "status": "success",
          "serviceCount": services.count,
          "platform": "iOS",
          "note": "Services pre-cached - processing immediately"
        ])
      }
      
      // Process services immediately
      peripheral.delegate = self
      for service in services {
        peripheral.discoverCharacteristics(nil, for: service)
      }
      return
    }
    
    // Record start time for duration tracking
    serviceDiscoveryStartTimes[deviceId] = Date()
    
    // Initialize retry tracking if this is the first attempt
    if retryAttempt == 0 {
      serviceDiscoveryRetryAttempts[deviceId] = 0
    } else {
      // Ensure retry count matches the attempt number
      serviceDiscoveryRetryAttempts[deviceId] = retryAttempt
    }
    
    // Log service discovery initiation
    if retryAttempt == 0 {
      NSLog("🔍 [SERVICE DISCOVERY] Starting for \(deviceId)")
    } else {
      NSLog("🔄 [SERVICE DISCOVERY] Retry attempt \(retryAttempt) for \(deviceId)")
    }
    
    DispatchQueue.main.async {
      self.sendEvent(withName: "ConnectionLog", body: [
        "deviceId": deviceId,
        "action": "Service Discovery Start",
        "retryAttempt": retryAttempt,
        "platform": "iOS",
        "note": retryAttempt == 0 ? "Initiating service discovery" : "Retrying service discovery (attempt \(retryAttempt))"
      ])
    }
    
    // Cancel existing timeout timer
    if let existingTimer = serviceDiscoveryTimers[deviceId] {
      existingTimer.invalidate()
      serviceDiscoveryTimers.removeValue(forKey: deviceId)
    }
    
    // Set up timeout timer
    let timeoutTimer = Timer.scheduledTimer(withTimeInterval: SERVICE_DISCOVERY_TIMEOUT_SECONDS, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      guard peripheral.state == .connected else {
        NSLog("⚠️ [SERVICE DISCOVERY] Timeout but peripheral disconnected: \(deviceId)")
        return
      }
      
      NSLog("⏰ [SERVICE DISCOVERY] Timeout after \(self.SERVICE_DISCOVERY_TIMEOUT_SECONDS) seconds for \(deviceId)")
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Service Discovery Timeout",
          "status": "timeout",
          "timeoutSeconds": Int(self.SERVICE_DISCOVERY_TIMEOUT_SECONDS),
          "platform": "iOS",
          "note": "Service discovery timed out - checking for cached services"
        ])
      }
      
      // Check if services are available despite timeout
      if let services = peripheral.services, !services.isEmpty {
        NSLog("⚠️ [SERVICE DISCOVERY] Timeout but services found (\(services.count)) - processing anyway")
        for service in services {
          peripheral.discoverCharacteristics(nil, for: service)
        }
      } else {
        // Retry if attempts remaining
        let retryCount = self.serviceDiscoveryRetryAttempts[deviceId] ?? 0
        if retryCount < self.MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS {
          let newRetryCount = retryCount + 1
          self.serviceDiscoveryRetryAttempts[deviceId] = newRetryCount
          NSLog("🔄 [SERVICE DISCOVERY] Timeout - retrying (\(newRetryCount)/\(self.MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS)) for \(deviceId)")
          
          DispatchQueue.main.asyncAfter(deadline: .now() + Double(newRetryCount)) {
            if peripheral.state == .connected {
              self.startServiceDiscoveryWithRetry(peripheral: peripheral, deviceId: deviceId, retryAttempt: newRetryCount)
            }
          }
        } else {
          NSLog("❌ [SERVICE DISCOVERY] Max retries reached after timeout for \(deviceId)")
          self.serviceDiscoveryRetryAttempts.removeValue(forKey: deviceId)
          self.serviceDiscoveryStartTimes.removeValue(forKey: deviceId)
        }
      }
      
      self.serviceDiscoveryTimers.removeValue(forKey: deviceId)
    }
    
    serviceDiscoveryTimers[deviceId] = timeoutTimer
    
    // Initiate service discovery
    peripheral.delegate = self
    peripheral.discoverServices(nil)
    
    // Fallback: Check for services after delay (in case callback doesn't fire)
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      guard let self = self else { return }
      if peripheral.state == .connected {
        if let services = peripheral.services, !services.isEmpty {
          // Only process if notifications haven't been enabled yet
          if self.deviceNotificationStates[deviceId] == nil || self.deviceNotificationStates[deviceId]?.isEmpty == true {
            NSLog("✅ [SERVICE DISCOVERY] Fallback: Found \(services.count) services for \(deviceId) - processing")
            for service in services {
              peripheral.discoverCharacteristics(nil, for: service)
            }
          }
        }
      }
    }
  }
  
  /// Emit DeviceConnected event (industry standard: only at SECURE_READY state)
  /// - Called after characteristics are discovered and device is ready
  private func emitDeviceConnectedEvent(deviceId: String, peripheral: CBPeripheral) {
    // Guard: Only emit once per connection
    if hasEmittedDeviceConnected[deviceId] == true {
      NSLog("   ⏭️ DeviceConnected already emitted for \(deviceId) - skipping duplicate")
      return
    }
    guard deviceConnectionStates[deviceId] == .SECURE_READY || deviceConnectionStates[deviceId] == .READY else {
      NSLog("   ⚠️ Cannot emit DeviceConnected - state is not SECURE_READY/READY: \(deviceConnectionStates[deviceId]?.rawValue ?? "nil")")
      return
    }
    hasEmittedDeviceConnected[deviceId] = true
    let deviceName = peripheral.name ?? getDeviceName(deviceId: deviceId) ?? "Unknown Device"
    let wasAlreadyBonded = bondedDeviceIDs.contains(deviceId)
    NSLog("   ✅ Emitting DeviceConnected at SECURE_READY state")
    let deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": deviceName,
      "connectionType": autoConnectEnabled ? "auto" : "manual",
      "isBonded": wasAlreadyBonded,
      "wasAlreadyBonded": wasAlreadyBonded,
      "connectionState": deviceConnectionStates[deviceId]?.rawValue ?? "SECURE_READY"
    ]
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
    }
  }
  private func confirmConnection(peripheral: CBPeripheral, deviceId: String) {
    var deviceName = peripheral.name
    if deviceName == nil || deviceName!.isEmpty {
      deviceName = getDeviceName(deviceId: deviceId) 
      if deviceName == nil || deviceName!.isEmpty {
        deviceName = "Unknown Device"
      }
    } else {
      saveDeviceName(deviceId: deviceId, deviceName: deviceName!)
    }
    // iOS handles bonding automatically - just track in our list for auto-connect
    let wasAlreadyBonded = bondedDeviceIDs.contains(deviceId)
    if !wasAlreadyBonded {
      bondedDeviceIDs.insert(deviceId)
      saveBondedDevices()
      NSLog("   ✅ Device added to bonded list for auto-connect")
    }
    if !autoConnectEnabled && !bondedDeviceIDs.isEmpty {
      NSLog("   📡 Auto-connect not enabled but device is bonded - enabling auto-connect for future reconnections")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        self.autoConnectEnabled = true
        NSLog("   ✅ Auto-connect enabled (will reconnect if device goes out of range)")
        self.startHealthChecks()
        if self.centralManager?.state == .poweredOn {
          self.startScanning()
        }
      }
    }
    let promiseKey = "connect_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      NSLog("   📱 UI should now show 'Connected' state")
      NSLog("   ⏰ Timestamp: \(Date())")
      resolver([
        "status": "connected",
        "deviceId": deviceId,
        "deviceName": deviceName,
        "wasBonded": wasAlreadyBonded, 
        "isBonded": true 
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    } else {
    }
    // ServiceDiscoveryComplete is emitted once from didDiscoverCharacteristicsFor when all characteristics
    // are discovered (SDD v1.5 flow). confirmConnection runs after RTC check; no duplicate emit here.
  }
  override func constantsToExport() -> [AnyHashable : Any]! {
    return [
      "initialCount": 0,
      "MANUFACTURER_ID": SMART_TAG_MANUFACTURER_ID,
      "MANUFACTURER_ID_HEX": String(format: "0x%04X", SMART_TAG_MANUFACTURER_ID)
    ]
  }
  /// Called when device connection attempt fails
  /// - Implements automatic retry logic for transient errors (1 retry attempt)
  /// - Classifies errors as transient, permanent, or user action required
  /// - Parameters:
  ///   - central: The central manager providing the update
  ///   - peripheral: The peripheral that failed to connect
  ///   - error: Error describing connection failure reason
  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    let promiseKey = "connect_\(deviceId)"
    NSLog("❌ [DID_FAIL_TO_CONNECT] Device: \(deviceId), Error: \(error?.localizedDescription ?? "Unknown error")")
    connectionTimeoutTimers[deviceId]?.cancel()
    connectionTimeoutTimers.removeValue(forKey: deviceId)
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
    if let rejecter = pendingRejecters[promiseKey] {
      let nsError = error as NSError?
      let errorCode = nsError?.code ?? 0
      let errorDescription = error?.localizedDescription ?? "Connection failed"
      let errorType = classifyError(error)
      if errorType == .TRANSIENT {
        let retryCount = connectionRetryAttempts[deviceId] ?? 0
        if retryCount < MAX_CONNECTION_RETRY_ATTEMPTS {
          connectionRetryAttempts[deviceId] = retryCount + 1
          // Industry standard backoff: 1-2s, 5s, 10-15s
          let backoffDelay: TimeInterval
          switch retryCount {
          case 0: backoffDelay = CONNECTION_RETRY_DELAY_MS  // 1-2s
          case 1: backoffDelay = CONNECTION_RETRY_DELAY_2      // 5s
          default: backoffDelay = CONNECTION_RETRY_DELAY_3   // 10-15s
          }
          NSLog("🔄 [RETRY] Attempting automatic retry \(retryCount + 1)/\(MAX_CONNECTION_RETRY_ATTEMPTS) after \(backoffDelay)s (industry standard backoff)")
          DispatchQueue.main.asyncAfter(deadline: .now() + backoffDelay) { [weak self] in
            guard let self = self else { return }
            if let rejecter = self.pendingRejecters[promiseKey],
               let retryPeripheral = self.scannedDevices[deviceId],
               let manager = self.centralManager {
              NSLog("🔄 Retrying connection to: \(deviceId)")
              self.connectingPeripherals[deviceId] = retryPeripheral
              retryPeripheral.delegate = self
              let connectionOptions: [String: Any] = [
                CBConnectPeripheralOptionNotifyOnConnectionKey: true,
                CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
                CBConnectPeripheralOptionNotifyOnNotificationKey: true
              ]
              manager.connect(retryPeripheral, options: connectionOptions)
              let timeoutSeconds = 8.0
              let retryTimeoutWorkItem = DispatchWorkItem { [weak self] in
                guard let self = self else { return }
                if let connectingPeripheral = self.connectingPeripherals[deviceId] {
                  manager.cancelPeripheralConnection(connectingPeripheral)
                  self.connectingPeripherals.removeValue(forKey: deviceId)
                  self.connectionRetryAttempts.removeValue(forKey: deviceId)
                  self.connectionTimeoutTimers.removeValue(forKey: deviceId)
                  if let rejecter = self.pendingRejecters[promiseKey] {
                    rejecter("CONNECTION_TIMEOUT", "Connection timed out after retry. Please ensure device is in range and try again.", nil)
                    self.pendingPromises.removeValue(forKey: promiseKey)
                    self.pendingRejecters.removeValue(forKey: promiseKey)
                  }
                }
              }
              self.connectionTimeoutTimers[deviceId] = retryTimeoutWorkItem
              DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds, execute: retryTimeoutWorkItem)
              return 
            } else {
              self.connectionRetryAttempts.removeValue(forKey: deviceId)
              if let rejecter = self.pendingRejecters[promiseKey] {
                rejecter("CONNECTION_FAILED", "Device not found during retry. Please scan again.", nil)
                self.pendingPromises.removeValue(forKey: promiseKey)
                self.pendingRejecters.removeValue(forKey: promiseKey)
              }
            }
          }
          return 
        }
      }
      connectionRetryAttempts.removeValue(forKey: deviceId)
      var errorCodeString = "CONNECTION_FAILED"
      var errorMessage = errorDescription
      if errorCode == 6 { 
        errorCodeString = "CONNECTION_TIMEOUT"
        errorMessage = "Connection timed out. Please ensure:\n" +
                      "• Device is powered on and in range\n" +
                      "• Device is not connected to another phone\n" +
                      "• Bluetooth is enabled\n" +
                      "• Try scanning again before connecting"
      } else if errorCode == 10 { 
        errorCodeString = "CONNECTION_FAILED"
        errorMessage = "Connection failed. Please ensure device is in range and try again."
      } else if errorCode == 4 { 
        errorCodeString = "PERMISSION_DENIED"
        errorMessage = "Bluetooth permission denied. Please enable Bluetooth permissions in Settings."
      }
      rejecter(errorCodeString, errorMessage, error)
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
  }
  /// Called when device disconnects (intentional or unexpected)
  /// - Distinguishes between manual disconnect and automatic disconnect
  /// - Implements automatic reconnection for unexpected disconnects (if auto-connect enabled)
  /// - Logs detailed disconnect information including time since last sync
  /// - Parameters:
  ///   - central: The central manager providing the update
  ///   - peripheral: The disconnected peripheral
  ///   - error: Error if disconnect was unexpected (nil for manual disconnect)
  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    NSLog("═══════════════════════════════════════════════════════")
    NSLog("🔌 DEVICE DISCONNECTED: \(deviceId)")
    NSLog("   Device Name: \(peripheral.name ?? "Unknown")")
    
    // Check if service discovery was in progress
    let wasDiscovering = serviceDiscoveryTimers[deviceId] != nil || serviceDiscoveryStartTimes[deviceId] != nil
    let notificationsEnabled = deviceNotificationStates[deviceId] != nil && !deviceNotificationStates[deviceId]!.isEmpty
    let notificationCount = deviceNotificationStates[deviceId]?.count ?? 0
    
    if let error = error {
      NSLog("   Error: \(error.localizedDescription)")
      NSLog("   Error Domain: \(error._domain)")
      NSLog("   Error Code: \(error._code)")
      if let nsError = error as NSError? {
        NSLog("   User Info: \(nsError.userInfo)")
      }
    } else {
      NSLog("   Error: nil (clean disconnect)")
    }
    
    if wasDiscovering {
      NSLog("   ⚠️ WARNING: Service discovery was in progress when device disconnected")
    }
    if !notificationsEnabled {
      NSLog("   ⚠️ WARNING: Notifications were not enabled before disconnection")
    }
    
    if let lastSyncTime = lastSyncCompleteTime[deviceId] {
      let timeSinceSync = Date().timeIntervalSince(lastSyncTime)
      NSLog("   Time since last sync: \(String(format: "%.2f", timeSinceSync)) seconds")
      if timeSinceSync < 60 {
        NSLog("   ⚠️ WARNING: Disconnect occurred within 60 seconds of sync completion!")
        NSLog("   This may indicate supervision timeout or device-initiated disconnect")
      }
    }
    NSLog("   Peripheral State: \(peripheral.state.rawValue)")
    NSLog("   Central Manager State: \(central.state.rawValue)")
    NSLog("═══════════════════════════════════════════════════════")
    
    // Send ConnectionLog event for disconnection
    DispatchQueue.main.async {
      var disconnectNote = "Normal disconnection"
      if wasDiscovering {
        disconnectNote = "Disconnected during service discovery"
      } else if !notificationsEnabled {
        disconnectNote = "Disconnected before notifications enabled (\(notificationCount) enabled)"
      }
      
      self.sendEvent(withName: "ConnectionLog", body: [
        "deviceId": deviceId,
        "action": "Disconnected",
        "status": (error as NSError?)?.code ?? 0,
        "wasDiscovering": wasDiscovering,
        "notificationsEnabled": notificationsEnabled,
        "notificationCount": notificationCount,
        "platform": "iOS",
        "note": disconnectNote
      ])
    }
    
    keepAliveTimers[deviceId]?.invalidate()
    keepAliveTimers.removeValue(forKey: deviceId)
    // iOS handles pairing errors automatically - just clean up and disconnect
    connectionTimeoutTimers[deviceId]?.cancel()
    connectionTimeoutTimers.removeValue(forKey: deviceId)
    connectionRetryAttempts.removeValue(forKey: deviceId)
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
    cleanupDeviceResources(deviceId: deviceId)
    var deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": peripheral.name ?? "Unknown",
      "error": error?.localizedDescription ?? "",
      "errorDomain": error?._domain ?? "",
      "errorCode": error?._code ?? 0,
      "timeSinceLastSync": lastSyncCompleteTime[deviceId] != nil ? Date().timeIntervalSince(lastSyncCompleteTime[deviceId]!) : -1
    ]
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceDisconnected", body: deviceInfo)
    }
    NSLog("   - autoConnectEnabled: \(autoConnectEnabled)")
    NSLog("   - Device in bonded list: \(bondedDeviceIDs.contains(deviceId))")
    NSLog("   - Bonded devices count: \(bondedDeviceIDs.count)")
    if autoConnectEnabled && bondedDeviceIDs.contains(deviceId) {
      let isManualDisconnect = manualDisconnectInProgress.contains(deviceId)
      NSLog("   - Is manual disconnect: \(isManualDisconnect)")
      if isManualDisconnect {
        NSLog("🚫 Manual disconnect detected - skipping auto-reconnect for: \(deviceId)")
      } else {
        NSLog("🔄 Automatic disconnect detected - scheduling auto-reconnection for: \(deviceId)")
        reconnectAttempts[deviceId] = 0
        NSLog("   📡 Starting scan to find device...")
        startScanning()
        NSLog("   ⏰ Scheduling reconnection attempts with exponential backoff...")
        scheduleReconnection(deviceId: deviceId)
      }
    } else {
      if !autoConnectEnabled {
        NSLog("⚠️ Auto-reconnect SKIPPED - Auto-connect is DISABLED")
        NSLog("   💡 Enable auto-connect by calling startAutoConnect() or connecting to a device")
      } else if !bondedDeviceIDs.contains(deviceId) {
        NSLog("⚠️ Auto-reconnect SKIPPED - Device \(deviceId) not in bonded list")
      }
    }
  }
  private func startScanning() {
    guard autoConnectEnabled else { 
      return 
    }
    guard let manager = centralManager else {
      return
    }
    guard manager.state == .poweredOn else {
      return
    }
    if hasActiveOrConnectingPeripheral() {
      return
    }
    if bondedDeviceIDs.isEmpty {
      return
    }
    if let lastStopTime = lastScanStopTime {
      let timeSinceLastScan = Date().timeIntervalSince(lastStopTime)
      if timeSinceLastScan < Self.MIN_SCAN_INTERVAL_MS {
        let delayMs = Self.MIN_SCAN_INTERVAL_MS - timeSinceLastScan
        DispatchQueue.main.asyncAfter(deadline: .now() + delayMs) { [weak self] in
          guard let self = self, !self.isScanning else { return }
          self.startScanningInternal()
        }
        return
      }
    }
    startScanningInternal()
  }
  private func startScanningInternal() {
    guard let manager = centralManager else {
      return
    }
    guard manager.state == .poweredOn else {
      return
    }
    if manager.isScanning {
      manager.stopScan()
    }
    manager.scanForPeripherals(
      withServices: nil, 
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
    )
  }
  private func hasActiveOrConnectingPeripheral() -> Bool {
    if !connectedPeripherals.isEmpty {
      return true
    }
    if !connectingPeripherals.isEmpty {
      return true
    }
    return false
  }
  private func querySystemConnectedPeripherals() {
    guard let manager = centralManager else { return }
    guard manager.state == .poweredOn else { return }
    
    // Use all known service UUIDs - iOS only returns peripherals that have had
    // that specific service discovered during a previous connection
    let serviceUUIDs: [CBUUID] = [
      SMART_TAG_SERVICE_UUID,
      BATTERY_SERVICE_UUID,  
      DEVICE_INFO_SERVICE_UUID,
      GENERIC_ACCESS_SERVICE_UUID  // Standard service, almost always discovered
    ]
    
    NSLog("🔍 [QUERY] Querying iOS for system-connected peripherals...")
    let connectedPeripherals = manager.retrieveConnectedPeripherals(withServices: serviceUUIDs)
    NSLog("   - Found \(connectedPeripherals.count) system-connected peripheral(s)")
    if connectedPeripherals.isEmpty {
      return
    }
    for peripheral in connectedPeripherals {
      let deviceId = peripheral.identifier.uuidString
      let deviceName = peripheral.name ?? "Unknown"
      if !bondedDeviceIDs.contains(deviceId) && !forgottenDeviceIDs.contains(deviceId) {
        NSLog("   ✅ Syncing system-connected device to bondedDeviceIDs: \(deviceId)")
        bondedDeviceIDs.insert(deviceId)
        saveBondedDevices()
      }
      if bondedDeviceIDs.contains(deviceId) {
        let isAlreadyTracked = self.connectedPeripherals.contains { $0.identifier == peripheral.identifier }
        if isAlreadyTracked {
          continue
        }
        attachToSystemConnectedPeripheral(peripheral)
      }
    }
  }
  private func syncSystemBondedDevices() {
    guard let manager = centralManager else {
      NSLog("🔄 [SYNC] Cannot sync - centralManager is nil")
      return
    }
    guard manager.state == .poweredOn else {
      NSLog("🔄 [SYNC] Cannot sync - Bluetooth state: \(manager.state.rawValue)")
      return
    }
    
    NSLog("🔄 [SYNC] Syncing system-bonded devices...")
    NSLog("   - Current app bondedDeviceIDs: \(bondedDeviceIDs.count) device(s)")
    NSLog("   - Current app forgottenDeviceIDs: \(forgottenDeviceIDs.count) device(s)")
    
    var syncedCount = 0
    var removedCount = 0
    let serviceUUIDs: [CBUUID] = [
      SMART_TAG_SERVICE_UUID,
      BATTERY_SERVICE_UUID,
      DEVICE_INFO_SERVICE_UUID,
      GENERIC_ACCESS_SERVICE_UUID
    ]
    
    // Get system-connected devices (these are definitely bonded)
    // NOTE: This ONLY returns devices that are CURRENTLY CONNECTED at system level
    NSLog("   - Querying iOS for connected peripherals with \(serviceUUIDs.count) service UUIDs...")
    let systemConnected = manager.retrieveConnectedPeripherals(withServices: serviceUUIDs)
    NSLog("   - iOS reports \(systemConnected.count) system-connected peripheral(s)")
    
    for peripheral in systemConnected {
      let name = peripheral.name ?? "Unknown"
      let state = peripheral.state.rawValue
      NSLog("      • \(name) (\(peripheral.identifier.uuidString)) - state: \(state)")
    }
    
    let systemConnectedIds = Set(systemConnected.map { $0.identifier.uuidString })
    
    // Add system-connected devices to app's list
    for peripheral in systemConnected {
      let deviceId = peripheral.identifier.uuidString
      if !bondedDeviceIDs.contains(deviceId) && !forgottenDeviceIDs.contains(deviceId) {
        NSLog("   ✅ Syncing system-connected device to bondedDeviceIDs: \(deviceId)")
        bondedDeviceIDs.insert(deviceId)
        syncedCount += 1
      }
    }
    
    // Remove devices from app's list that are no longer system-bonded
    // Check if devices in app's list are still retrievable by iOS (meaning they're still bonded)
    let currentBondedList = Array(bondedDeviceIDs)
    if !currentBondedList.isEmpty {
      let uuids = currentBondedList.compactMap { UUID(uuidString: $0) }
      let retrievablePeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
      let retrievableIds = Set(retrievablePeripherals.map { $0.identifier.uuidString })
      
      // Find devices in app's list that are no longer retrievable (forgotten from system)
      let devicesToRemove = bondedDeviceIDs.filter { deviceId in
        !retrievableIds.contains(deviceId) && !forgottenDeviceIDs.contains(deviceId)
      }
      
      for deviceId in devicesToRemove {
        NSLog("   ⚠️ Device \(deviceId) no longer bonded in system - removing from app's bonded list")
        bondedDeviceIDs.remove(deviceId)
        removedCount += 1
      }
      
      NSLog("   📋 Verified \(retrievablePeripherals.count) of \(currentBondedList.count) bonded devices are still known to iOS")
    }
    
    if syncedCount > 0 || removedCount > 0 {
      saveBondedDevices()
      if syncedCount > 0 {
        NSLog("   ✅ Synced \(syncedCount) system-bonded device(s) to app's bondedDeviceIDs list")
      }
      if removedCount > 0 {
        NSLog("   🗑️ Removed \(removedCount) device(s) that are no longer system-bonded")
      }
    } else {
    }
  }
  private func attachToSystemConnectedPeripheral(_ peripheral: CBPeripheral) {
    let deviceId = peripheral.identifier.uuidString
    peripheral.delegate = self
    connectedPeripherals.append(peripheral)
    deviceConnectionStates[deviceId] = .CONNECTED
    // For restored devices, notifications will be enabled after service discovery completes
    NSLog("🔄 [AUTO-CONNECT] System restored device \(deviceId) - will enable notifications after service discovery")
    startServiceDiscoveryWithRetry(peripheral: peripheral, deviceId: deviceId, retryAttempt: 0)
    // ✅ FIX: Use guard to prevent duplicate DeviceConnected events
    if hasEmittedDeviceConnected[deviceId] == true {
      NSLog("   ⏭️ DeviceConnected already emitted for system-restored device \(deviceId) - skipping duplicate")
      return
    }
    hasEmittedDeviceConnected[deviceId] = true
    let deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": peripheral.name ?? "Unknown",
      "connectionType": "system_restored"
    ]
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
    }
  }
  private func connectToKnownPeripheralsNative() {
    guard autoConnectEnabled else { return }
    guard let manager = centralManager else { return }
    guard manager.state == .poweredOn else { return }
    let bonded = getBondedDevicesArray()
    if bonded.isEmpty {
      return
    }
    let uuids = bonded.compactMap { UUID(uuidString: $0) }
    // Only retrieve peripherals that are actually known to iOS (system-bonded)
    // This prevents trying to connect to devices that were forgotten from system Bluetooth
    let knownPeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
    
    // Remove devices from app's list that are no longer retrievable (forgotten from system)
    let retrievableIds = Set(knownPeripherals.map { $0.identifier.uuidString })
    let devicesToRemove = bonded.filter { deviceId in
      !retrievableIds.contains(deviceId) && !forgottenDeviceIDs.contains(deviceId)
    }
    if !devicesToRemove.isEmpty {
      for deviceId in devicesToRemove {
        NSLog("⚠️ [AUTO-CONNECT] Device \(deviceId) no longer system-bonded - removing from app's bonded list")
        bondedDeviceIDs.remove(deviceId)
      }
      saveBondedDevices()
    }
    var attempted = 0
    var restored = 0
    for peripheral in knownPeripherals {
      let deviceId = peripheral.identifier.uuidString
      if forgottenDeviceIDs.contains(deviceId) {
        continue
      }
      if peripheral.state == .connected {
        let isAlreadyTracked = connectedPeripherals.contains { $0.identifier == peripheral.identifier }
        if isAlreadyTracked {
          continue
        }
        peripheral.delegate = self
        connectedPeripherals.append(peripheral)
        deviceConnectionStates[deviceId] = .CONNECTED
        // For restored devices, set a flag so notifications are enabled after service discovery
        // (pairing verification is not needed for restored devices)
        NSLog("🔄 [AUTO-CONNECT] Restored device \(deviceId) - will enable notifications after service discovery")
        startServiceDiscoveryWithRetry(peripheral: peripheral, deviceId: deviceId, retryAttempt: 0)
        // ✅ FIX: Use guard to prevent duplicate DeviceConnected events
        if hasEmittedDeviceConnected[deviceId] != true {
          hasEmittedDeviceConnected[deviceId] = true
          let deviceInfo: [String: Any] = [
            "deviceId": deviceId,
            "deviceName": peripheral.name ?? "Unknown",
            "connectionType": "system_restored"
          ]
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
          }
        } else {
          NSLog("   ⏭️ DeviceConnected already emitted for restored device \(deviceId) - skipping duplicate")
        }
        restored += 1
        continue
      }
      if connectingPeripherals[deviceId] == nil {
        let name = peripheral.name ?? deviceId
        connectingPeripherals[deviceId] = peripheral
        peripheral.delegate = self
        let connectionOptions: [String: Any] = [
          CBConnectPeripheralOptionNotifyOnConnectionKey: true,
          CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
          CBConnectPeripheralOptionNotifyOnNotificationKey: true
        ]
        manager.connect(peripheral, options: connectionOptions)
        attempted += 1
      }
    }
    if restored > 0 {
    }
    if attempted > 0 {
      sendLocalNotificationIfBackground(title: "Connecting", body: "Attempting to connect to \(attempted) known device(s)")
    }
  }
  // MARK: - CBPeripheralDelegate Methods (Service & Characteristic Discovery)
  
  /// Called when services are discovered on a peripheral
  /// - Triggers characteristic discovery for each service
  /// - Handles pairing errors that may occur during encrypted service access
  /// - Parameters:
  ///   - peripheral: The peripheral providing the update
  ///   - error: Error if service discovery failed (may indicate pairing failure)
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    
    // Log service discovery result
    let discoveryStartTime = serviceDiscoveryStartTimes.removeValue(forKey: deviceId)
    let discoveryDuration = discoveryStartTime != nil ? Date().timeIntervalSince(discoveryStartTime!) * 1000 : -1.0
    
    // Cancel discovery timeout timer
    if let timer = serviceDiscoveryTimers[deviceId] {
      timer.invalidate()
      serviceDiscoveryTimers.removeValue(forKey: deviceId)
    }
    
    if let error = error {
      // Service discovery failed
      let errorCode = (error as NSError).code
      let errorDescription = error.localizedDescription.lowercased()
      let isPairingError = errorCode == 10 || 
                           errorCode == 6 ||   
                           errorDescription.contains("authentication") ||
                           errorDescription.contains("pairing") ||
                           errorDescription.contains("encryption") ||
                           errorDescription.contains("insufficient authentication")
      
      NSLog("❌ [SERVICE DISCOVERY] Failed for device \(deviceId): \(error.localizedDescription)" +
            (discoveryDuration > 0 ? " (took \(Int(discoveryDuration))ms)" : ""))
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Service Discovery",
          "status": "failed",
          "error": error.localizedDescription,
          "errorCode": errorCode,
          "durationMs": Int(discoveryDuration),
          "platform": "iOS",
          "note": "Service discovery failed - will retry if attempts remaining"
        ])
      }
      
      // Check if we should retry
      let retryCount = serviceDiscoveryRetryAttempts[deviceId] ?? 0
      if retryCount < MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS && peripheral.state == .connected {
        // Retry service discovery
        let newRetryCount = retryCount + 1
        serviceDiscoveryRetryAttempts[deviceId] = newRetryCount
        NSLog("🔄 [SERVICE DISCOVERY] Retrying (\(newRetryCount)/\(MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS)) for \(deviceId)")
        
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(newRetryCount)) {
          if peripheral.state == .connected {
            self.startServiceDiscoveryWithRetry(peripheral: peripheral, deviceId: deviceId, retryAttempt: newRetryCount)
          }
        }
      } else {
        // Max retries reached or device disconnected
        if retryCount >= MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS {
          NSLog("❌ [SERVICE DISCOVERY] Max retries reached for \(deviceId)")
          
          DispatchQueue.main.async {
            self.sendEvent(withName: "ConnectionLog", body: [
              "deviceId": deviceId,
              "action": "Service Discovery Failed",
              "status": "max_retries_reached",
              "retryCount": retryCount,
              "platform": "iOS",
              "note": "Service discovery failed after \(self.MAX_SERVICE_DISCOVERY_RETRY_ATTEMPTS) attempts"
            ])
          }
        }
        
        serviceDiscoveryRetryAttempts.removeValue(forKey: deviceId)
        
        // iOS handles pairing errors automatically - just report the error
        let promiseKey = "discover_services_\(deviceId)"
        if let rejecter = pendingRejecters[promiseKey] {
          rejecter("SERVICE_DISCOVERY_ERROR", error.localizedDescription, error)
          pendingPromises.removeValue(forKey: promiseKey)
          pendingRejecters.removeValue(forKey: promiseKey)
        }
      }
      return
    }
    
    guard let services = peripheral.services else {
      // No services found
      NSLog("⚠️ [SERVICE DISCOVERY] No services found for \(deviceId)")
      
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Service Discovery",
          "status": "no_services",
          "platform": "iOS",
          "note": "No services discovered - device may not be advertising services"
        ])
      }
      
      let promiseKey = "discover_services_\(deviceId)"
      if let resolver = pendingPromises[promiseKey] {
        resolver(["services": []])
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    // Service discovery successful
    // Clear retry counter on success
    serviceDiscoveryRetryAttempts.removeValue(forKey: deviceId)
    
    let serviceCount = services.count
    NSLog("✅ [SERVICE DISCOVERY] Success for \(deviceId) - \(serviceCount) services discovered" +
          (discoveryDuration > 0 ? " (took \(Int(discoveryDuration))ms)" : ""))
    
    DispatchQueue.main.async {
      self.sendEvent(withName: "ConnectionLog", body: [
        "deviceId": deviceId,
        "action": "Service Discovery",
        "status": "success",
        "serviceCount": serviceCount,
        "durationMs": Int(discoveryDuration),
        "platform": "iOS",
        "note": "Service discovery completed - proceeding with characteristic discovery"
      ])
    }
    
    deviceServices[deviceId] = services
    var pendingServices = Set<CBUUID>()
    for service in services {
      pendingServices.insert(service.uuid)
    }
    discoveryQueue.sync {
      servicesWithPendingCharDiscovery[deviceId] = pendingServices
      discoveryCompleteEventSent[deviceId] = false 
    }
    for service in services {
      peripheral.discoverCharacteristics(nil, for: service)
    }
    let serviceInfo = services.map { service in
      return [
        "uuid": service.uuid.uuidString,
        "isPrimary": service.isPrimary
      ]
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "ServicesDiscovered", body: [
        "deviceId": deviceId,
        "services": serviceInfo
      ])
    }
    let promiseKey = "discover_services_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      resolver(["services": serviceInfo])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
  }
  /// Called when characteristics are discovered for a service
  /// - Builds comprehensive characteristic list with properties (read, write, notify, etc.)
  /// - Emits discovery complete event when all services have been processed
  /// - Initiates pairing verification by reading encrypted characteristic
  /// - Parameters:
  ///   - peripheral: The peripheral providing the update
  ///   - service: The service whose characteristics were discovered
  ///   - error: Error if characteristic discovery failed
  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    
    if let error = error {
      return
    }
    guard let characteristics = service.characteristics else {
      return
    }
    if deviceCharacteristics[deviceId] == nil {
      deviceCharacteristics[deviceId] = []
    }
    deviceCharacteristics[deviceId]?.append(contentsOf: characteristics)
    let characteristicInfo = characteristics.map { characteristic in
      return [
        "uuid": characteristic.uuid.uuidString,
        "serviceUUID": service.uuid.uuidString,
        "properties": [
          "read": characteristic.properties.contains(.read),
          "write": characteristic.properties.contains(.write),
          "writeWithResponse": !characteristic.properties.contains(.writeWithoutResponse) && characteristic.properties.contains(.write),
          "writeWithoutResponse": characteristic.properties.contains(.writeWithoutResponse),
          "notify": characteristic.properties.contains(.notify),
          "indicate": characteristic.properties.contains(.indicate),
          "authenticatedSignedWrites": characteristic.properties.contains(.authenticatedSignedWrites),
          "extendedProperties": characteristic.properties.contains(.extendedProperties),
          "broadcast": characteristic.properties.contains(.broadcast)
        ],
        "isNotifying": characteristic.isNotifying
      ]
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "CharacteristicsDiscovered", body: [
        "deviceId": deviceId,
        "serviceUuid": service.uuid.uuidString,
        "characteristics": characteristicInfo
      ])
    }
    discoveryQueue.async { [weak self] in
      guard let self = self else { return }
      guard var pendingServices = self.servicesWithPendingCharDiscovery[deviceId] else {
        return
      }
      pendingServices.remove(service.uuid)
      self.servicesWithPendingCharDiscovery[deviceId] = pendingServices
      if pendingServices.isEmpty && self.discoveryCompleteEventSent[deviceId] != true {
        let allCharacteristics = self.deviceCharacteristics[deviceId] ?? []
        let hasSystemCommand = allCharacteristics.contains { $0.uuid == self.SYSTEM_COMMAND_CHAR_UUID }
        let hasDeviceStatus = allCharacteristics.contains { $0.uuid == self.DEVICE_STATUS_CHAR_UUID }
        let hasDataTransfer = allCharacteristics.contains { $0.uuid == self.DATA_TRANSFER_CHAR_UUID }
        NSLog("   - System Command: \(hasSystemCommand ? "✅" : "❌")")
        NSLog("   - Device Status: \(hasDeviceStatus ? "✅" : "❌")")
        NSLog("   - Data Transfer: \(hasDataTransfer ? "✅" : "❌")")
        // Industry standard: All characteristics discovered = SECURE_READY state
        // iOS has already handled pairing automatically if needed
        
        // Emit discovery complete event
        self.discoveryCompleteEventSent[deviceId] = true
        DispatchQueue.main.async {
          self.sendEvent(withName: "ServiceDiscoveryComplete", body: [
            "deviceId": deviceId,
            "totalServices": self.deviceServices[deviceId]?.count ?? 0,
            "totalCharacteristics": allCharacteristics.count,
            "hasSystemCommand": hasSystemCommand,
            "hasDeviceStatus": hasDeviceStatus,
            "hasDataTransfer": hasDataTransfer
          ])
        }
        
        // Move to SECURE_READY state and emit DeviceConnected
        self.deviceConnectionStates[deviceId] = .SECURE_READY
        self.emitDeviceConnectedEvent(deviceId: deviceId, peripheral: peripheral)
        
        // Track device as bonded for auto-connect (iOS handles actual bonding)
        if !self.bondedDeviceIDs.contains(deviceId) {
          self.bondedDeviceIDs.insert(deviceId)
          self.saveBondedDevices()
        }
        
        // CORRECT FLOW (SDD v1.5): Enable notifications FIRST, then check RTC
        // Reason: To send/receive commands (like Set System Time), notifications must be enabled
        // 1. Enable notifications for all critical characteristics
        // 2. When notifications are ready, read Device Status to check RTC
        // 3. If RTC invalid, send Set System Time (response comes via System Command notification)
        // 4. Proceed with Data Sync
        self.enableNotificationsFirst(peripheral: peripheral, deviceId: deviceId)
        self.servicesWithPendingCharDiscovery.removeValue(forKey: deviceId)
      }
    }
  }
  /// Called when characteristic value is read or updated via notification
  /// - Parses protocol-specific data (device status, system responses, data transfer)
  /// - iOS handles pairing/encryption automatically - no manual verification needed
  /// - Parameters:
  ///   - peripheral: The peripheral providing the update
  ///   - characteristic: The characteristic whose value changed
  ///   - error: Error if read/notification failed (iOS handles pairing errors automatically)
  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    let characteristicUuid = characteristic.uuid.uuidString
    
    // Log data transfer packets for debugging
    if characteristicUuid == DATA_TRANSFER_CHAR_UUID.uuidString {
      let dataHex = characteristic.value?.map { String(format: "%02X", $0) }.joined(separator: " ") ?? "nil"
      NSLog("   Hex: \(dataHex)")
    }
    if let error = error {
      // iOS handles pairing errors automatically - just report the error
      let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("CHARACTERISTIC_READ_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    guard let data = characteristic.value else {
      let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
      if let resolver = pendingPromises[promiseKey] {
        resolver(["data": "", "hex": ""])
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    let hexString = dataToHexString(data)
    handleCharacteristicData(deviceId: deviceId, characteristic: characteristic, data: data)
    let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "data": hexString,
        "hex": hexString,
        "characteristicUuid": characteristicUuid
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "CharacteristicData", body: [
        "deviceId": deviceId,
        "characteristicUuid": characteristicUuid,
        "data": hexString,
        "hex": hexString
      ])
    }
  }
  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    let characteristicUuid = characteristic.uuid.uuidString
    if let error = error {
      let errorCode = (error as NSError).code
      let errorDescription = error.localizedDescription.lowercased()
      let isPairingError = errorCode == 10 || 
                           errorCode == 6 ||   
                           errorDescription.contains("authentication") ||
                           errorDescription.contains("pairing") ||
                           errorDescription.contains("encryption") ||
                           errorDescription.contains("insufficient authentication")
      // iOS handles pairing errors automatically - just report the error
      let promiseKey = "write_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("CHARACTERISTIC_WRITE_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    let promiseKey = "write_\(deviceId)_\(characteristicUuid)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "status": "success",
        "characteristicUuid": characteristicUuid
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
  }
  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    let characteristicUuid = characteristic.uuid.uuidString
    if let error = error {
      NSLog("❌ Failed to enable notifications for \(characteristicUuid): \(error.localizedDescription)")
      
      // Send ConnectionLog event for notification enable failure
      let charName = getCharacteristicName(characteristicUuid)
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Notification Enable Failed",
          "characteristic": charName,
          "uuid": characteristicUuid,
          "error": error.localizedDescription,
          "status": "failed",
          "platform": "iOS"
        ])
      }
      
      let promiseKey = "notify_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("NOTIFICATION_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    // Track notification state
    if deviceNotificationStates[deviceId] == nil {
      deviceNotificationStates[deviceId] = Set<String>()
    }
    
    if characteristic.isNotifying {
      deviceNotificationStates[deviceId]?.insert(characteristicUuid)
      NSLog("✅ [NOTIFICATIONS] Confirmed enabled: \(characteristicUuid) for \(deviceId)")
      
      // Send ConnectionLog event for individual characteristic notification enabled
      let charName = getCharacteristicName(characteristicUuid)
      DispatchQueue.main.async {
        self.sendEvent(withName: "ConnectionLog", body: [
          "deviceId": deviceId,
          "action": "Notification Enabled",
          "characteristic": charName,
          "uuid": characteristicUuid,
          "status": "success",
          "platform": "iOS"
        ])
      }
      
      // Check if all critical notifications are now enabled
      checkAndExecutePendingCommands(deviceId: deviceId)
    } else {
      deviceNotificationStates[deviceId]?.remove(characteristicUuid)
      NSLog("⚠️ [NOTIFICATIONS] Disabled: \(characteristicUuid) for \(deviceId)")
    }
    
    if characteristicUuid.uppercased() == SYSTEM_COMMAND_CHAR_UUID.uuidString.uppercased() {
    }
    let promiseKey = "notify_\(deviceId)_\(characteristicUuid)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "status": "success",
        "isNotifying": characteristic.isNotifying,
        "characteristicUuid": characteristicUuid
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
  }
  func peripheral(_ peripheral: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    if error == nil {
      deviceRSSI[deviceId] = RSSI.intValue
    }
    if let error = error {
      let promiseKey = "rssi_\(deviceId)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("RSSI_READ_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    let promiseKey = "rssi_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "rssi": RSSI.intValue,
        "deviceId": deviceId
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
    DispatchQueue.main.async {
      self.sendEvent(withName: "RSSIUpdate", body: [
        "deviceId": deviceId,
        "rssi": RSSI.intValue
      ])
    }
  }
  @objc override static func requiresMainQueueSetup() -> Bool {
    return true
  }
  private func requestNotificationPermissionsIfNeeded() {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard settings.authorizationStatus == .notDetermined else { return }
      center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        if let error = error {
        } else {
        }
      }
    }
  }
  private func sendLocalNotification(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default
    let request = UNNotificationRequest(
      identifier: "ble.autoconnect.notification.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )
    UNUserNotificationCenter.current().add(request) { error in
      if let error = error {
      } else {
      }
    }
  }
  private func sendLocalNotificationIfBackground(title: String, body: String) {
    DispatchQueue.main.async {
      if UIApplication.shared.applicationState == .background {
        self.sendLocalNotification(title: title, body: body)
      } else {
      }
    }
  }
}
