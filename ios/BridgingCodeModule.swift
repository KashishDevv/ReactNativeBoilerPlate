import Foundation
import AVFoundation
import CoreBluetooth
import React
import UserNotifications
import UIKit

// MARK: - Power Profile Constants (matching Android implementation)
struct PowerProfileConstants {
  static let profiles: [String: [String: Any]] = [
    "default": [
      "healthCheckMs": 30000,
      "healthRssiEveryNTicks": 3,
      "rssiCycleIntervalMs": 30000,
      "rssiCycleDurationMs": 3000,
      "pruneIntervalMs": 300000,
      "pruneAgeMs": 600000,
      "scanMode": "LowLatency",
      "maxScanDurationMs": 15000,
      "connectionIntervalMs": 50,
      "connectionLatency": 0,
      "supervisionTimeoutMs": 4000,
      "mtuSize": 512
    ],
    "lowPower": [
      "healthCheckMs": 60000,
      "healthRssiEveryNTicks": 6,
      "rssiCycleIntervalMs": 30000,
      "rssiCycleDurationMs": 2000,
      "pruneIntervalMs": 600000,
      "pruneAgeMs": 1200000,
      "scanMode": "LowPower",
      "maxScanDurationMs": 10000,
      "connectionIntervalMs": 100,
      "connectionLatency": 2,
      "supervisionTimeoutMs": 8000,
      "mtuSize": 256
    ],
    "highPerformance": [
      "healthCheckMs": 15000,
      "healthRssiEveryNTicks": 1,
      "rssiCycleIntervalMs": 15000,
      "rssiCycleDurationMs": 5000,
      "pruneIntervalMs": 120000,
      "pruneAgeMs": 300000,
      "scanMode": "LowLatency",
      "maxScanDurationMs": 20000,
      "connectionIntervalMs": 30,
      "connectionLatency": 0,
      "supervisionTimeoutMs": 2000,
      "mtuSize": 512
    ]
  ]
}

@objc(BridgingCodeModule)
class BridgingCodeModule: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  
  // BLE Constants (matching Android implementation)
  private let SMART_TAG_SERVICE_UUID = CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
  private let BATTERY_SERVICE_UUID = CBUUID(string: "0000180f-0000-1000-8000-00805f9b34fb")
  private let DEVICE_INFO_SERVICE_UUID = CBUUID(string: "0000180a-0000-1000-8000-00805f9b34fb")
  private let GENERIC_ACCESS_SERVICE_UUID = CBUUID(string: "00001800-0000-1000-8000-00805f9b34fb")
  private let DFU_SERVICE_UUID = CBUUID(string: "0000fe59-0000-1000-8000-00805f9b34fb")
  
  // Smart Tag Characteristics
  private let SYSTEM_COMMAND_CHAR_UUID = CBUUID(string: "4f4e4d4c-4b4a-4948-4746-454443424140")
  private let DEVICE_STATUS_CHAR_UUID = CBUUID(string: "5f5e5d5c-5b5a-5958-5756-555453525150")
  private let DATA_TRANSFER_CHAR_UUID = CBUUID(string: "6f6e6d6c-6b6a-6968-6766-656463626160")
  private let LOCATION_DATA_CHAR_UUID = CBUUID(string: "7f7e7d7c-7b7a-7978-7776-757473727170")
  
  // Standard Characteristics
  private let BATTERY_LEVEL_CHAR_UUID = CBUUID(string: "00002a19-0000-1000-8000-00805f9b34fb")
  private let MANUFACTURER_NAME_CHAR_UUID = CBUUID(string: "00002a29-0000-1000-8000-00805f9b34fb")
  private let MODEL_NUMBER_CHAR_UUID = CBUUID(string: "00002a24-0000-1000-8000-00805f9b34fb")
  private let FIRMWARE_REVISION_CHAR_UUID = CBUUID(string: "00002a26-0000-1000-8000-00805f9b34fb")
  
  // Auto-connect properties
  private var centralManager: CBCentralManager?
  private var connectedPeripherals: [CBPeripheral] = []
  private var connectingPeripherals: [String: CBPeripheral] = [:] // Keep strong references during connection
  private var bondedDeviceIDs: Set<String> = []
  private var forgottenDeviceIDs: Set<String> = [] // Track devices that have been forgotten
  private var autoConnectEnabled: Bool = false
  private var pendingPermissionResolvers: [(RCTPromiseResolveBlock, RCTPromiseRejectBlock)] = []
  private let smartTagServiceUUID = CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
  private var reconnectTimers: [String: Timer] = [:]
  private var reconnectBackoff: [String: TimeInterval] = [:]
  private var manualDisconnectInProgress: Set<String> = [] // Track devices being manually disconnected
  
  // Enhanced Power Profile Management (matching Android implementation)
  private var currentPowerProfile: String = "default"
  private var powerProfiles: [String: [String: Any]] = [:]
  private var healthCheckTimer: Timer?
  private var healthCheckFailures: [String: Int] = [:]
  
  // Enhanced Error Handling
  private var errorContexts: [String: [String: Any]] = [:]
  private var retryAttempts: [String: Int] = [:]
  private var maxRetryAttempts: Int = 3
  
  // Device Management
  private var scannedDevices: [String: CBPeripheral] = [:]
  private var deviceServices: [String: [CBService]] = [:]
  private var deviceCharacteristics: [String: [CBCharacteristic]] = [:]
  private var pendingPromises: [String: RCTPromiseResolveBlock] = [:]
  private var pendingRejecters: [String: RCTPromiseRejectBlock] = [:]
  private var serviceDiscoveryTimers: [String: Timer] = [:] // Track service discovery timeouts
  private var isScanning: Bool = false
  
  override init() {
    super.init()
    loadBondedDevices()
    loadForgottenDevices()
    initializePowerProfiles()
    print("🏁 BridgingCodeModule initialized with \(bondedDeviceIDs.count) bonded devices and \(forgottenDeviceIDs.count) forgotten devices")
    print("⚡ Power profiles initialized: \(Array(powerProfiles.keys))")
    // Proactively request local notification permissions (non-blocking)
    requestNotificationPermissionsIfNeeded()
    
    // Auto-initialize CBCentralManager if we have bonded devices
    if bondedDeviceIDs.count > 0 {
      print("🚀 Auto-initializing CBCentralManager due to bonded devices")
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      print("🔧 Using restore identifier: \(restoreIdentifier)")
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
      autoConnectEnabled = true
    }
  }
  
  // MARK: - Power Profile Management (matching Android implementation)
  
  private func initializePowerProfiles() {
    powerProfiles = PowerProfileConstants.profiles
    print("⚡ Initialized power profiles: \(Array(powerProfiles.keys))")
  }
  
  @objc(setPowerProfile:resolver:rejecter:)
  func setPowerProfile(profileName: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("⚡ Setting power profile to: \(profileName)")
    
    guard let profile = powerProfiles[profileName] else {
      reject("INVALID_PROFILE", "Power profile '\(profileName)' not found", nil)
      return
    }
    
    currentPowerProfile = profileName
    updatePowerProfileSettings()
    updateConnectionParametersForAllDevices()
    restartHealthChecks()
    
    print("✅ Power profile updated to: \(profileName)")
    resolve([
      "profileName": profileName,
      "settings": profile,
      "status": "success"
    ])
  }
  
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
    
    print("⚡ Updating power profile settings for: \(currentPowerProfile)")
    print("⚡ Settings: \(settings)")
    
    // Update scan settings based on profile
    if let scanMode = settings["scanMode"] as? String {
      print("⚡ Scan mode: \(scanMode)")
    }
    
    if let maxScanDuration = settings["maxScanDurationMs"] as? Int {
      print("⚡ Max scan duration: \(maxScanDuration)ms")
    }
  }
  
  private func updateConnectionParametersForAllDevices() {
    guard let settings = powerProfiles[currentPowerProfile] else { return }
    
    print("⚡ Updating connection parameters for all devices")
    
    for peripheral in connectedPeripherals {
      let deviceId = peripheral.identifier.uuidString
      requestConnectionParameters(peripheral: peripheral, deviceId: deviceId)
    }
  }
  
  private func requestConnectionParameters(peripheral: CBPeripheral, deviceId: String) {
    guard let settings = powerProfiles[currentPowerProfile] else { return }
    
    // iOS doesn't directly expose connection parameter control like Android
    // But we can optimize based on profile settings
    if let connectionInterval = settings["connectionIntervalMs"] as? Int {
      print("⚡ Requesting connection interval: \(connectionInterval)ms for \(deviceId)")
      // Note: iOS Core Bluetooth doesn't allow direct connection parameter control
      // This is more of a hint for the system
    }
    
    if let supervisionTimeout = settings["supervisionTimeoutMs"] as? Int {
      print("⚡ Supervision timeout: \(supervisionTimeout)ms for \(deviceId)")
    }
  }
  
  private func restartHealthChecks() {
    // Stop existing health check timer
    healthCheckTimer?.invalidate()
    healthCheckTimer = nil
    
    // Start new health check timer based on current profile
    startHealthChecks()
  }
  
  private func startHealthChecks() {
    guard let settings = powerProfiles[currentPowerProfile],
          let healthCheckInterval = settings["healthCheckMs"] as? Int else {
      print("⚠️ No health check interval configured")
      return
    }
    
    let interval = Double(healthCheckInterval) / 1000.0
    print("🏥 Starting health checks every \(interval)s")
    
    healthCheckTimer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
      self?.performHealthChecks()
    }
  }
  
  private func performHealthChecks() {
    print("🏥 Performing health checks for \(connectedPeripherals.count) devices")
    
    for peripheral in connectedPeripherals {
      let deviceId = peripheral.identifier.uuidString
      
      // Check connection state
      if peripheral.state != .connected {
        print("⚠️ Health check failed: \(deviceId) not connected")
        handleHealthCheckFailure(deviceId: deviceId)
        continue
      }
      
      // Perform RSSI read as health check
      peripheral.readRSSI()
      
      // Reset failure count on successful check
      healthCheckFailures[deviceId] = 0
    }
  }
  
  private func handleHealthCheckFailure(deviceId: String) {
    let failures = healthCheckFailures[deviceId] ?? 0
    let newFailures = failures + 1
    healthCheckFailures[deviceId] = newFailures
    
    print("⚠️ Health check failure #\(newFailures) for \(deviceId)")
    
    if newFailures >= 3 {
      print("🚨 Max health check failures reached for \(deviceId) - triggering reconnection")
      scheduleReconnection(deviceId: deviceId)
      healthCheckFailures[deviceId] = 0 // Reset counter
    }
  }
  
  private func scheduleReconnection(deviceId: String) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      print("⚠️ Cannot schedule reconnection - peripheral not found: \(deviceId)")
      return
    }
    
    print("🔄 Scheduling reconnection for \(deviceId)")
    
    // Disconnect first
    centralManager?.cancelPeripheralConnection(peripheral)
    
    // Schedule reconnection after delay
    DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
      self?.attemptReconnection(deviceId: deviceId, peripheral: peripheral)
    }
  }
  
  private func attemptReconnection(deviceId: String, peripheral: CBPeripheral) {
    print("🔄 Attempting reconnection for \(deviceId)")
    
    // Check if device has been forgotten
    if forgottenDeviceIDs.contains(deviceId) {
      print("🚫 Device \(deviceId) has been forgotten - skipping reconnection")
      return
    }
    
    // Attempt reconnection
    connectingPeripherals[deviceId] = peripheral
    peripheral.delegate = self
    
    let connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
    ]
    
    centralManager?.connect(peripheral, options: connectionOptions)
    print("🚀 Reconnection attempt initiated for \(deviceId)")
  }
  
  // MARK: - Core BLE Methods (replacing ble-plx)
  
  @objc(requestPermissions:rejecter:)
  func requestPermissions(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("📱 Requesting BLE permissions")
    
    // Initialize central manager if not already done
    if centralManager == nil {
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
    }
    
    // Check current state
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    switch manager.state {
    case .poweredOn:
      resolve(["status": "granted", "state": "poweredOn"])
    case .poweredOff:
      reject("BLUETOOTH_OFF", "Bluetooth is powered off", nil)
    case .unauthorized:
      reject("UNAUTHORIZED", "Bluetooth access unauthorized", nil)
    case .unsupported:
      reject("UNSUPPORTED", "Bluetooth not supported", nil)
    case .resetting:
      reject("RESETTING", "Bluetooth is resetting", nil)
    case .unknown:
      // Store the promise resolvers to be called when state is determined
      print("📱 Bluetooth state is unknown, waiting for state determination...")
      pendingPermissionResolvers.append((resolve, reject))
      // The state will be determined in centralManagerDidUpdateState delegate method
    @unknown default:
      reject("UNKNOWN", "Unknown Bluetooth state", nil)
    }
  }
  
  @objc(isBLEReady:rejecter:)
  func isBLEReady(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    let isReady = manager.state == .poweredOn
    resolve(["isReady": isReady, "state": manager.state.rawValue])
  }
  
  @objc(startScanningWithOptions:resolver:rejecter:)
  func startScanningWithOptions(options: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔍 Starting BLE scan with enhanced power profile options")
    
    guard let manager = centralManager else {
      rejectWithContext(reject: reject, errorCode: "NO_MANAGER", message: "Central manager not initialized", deviceId: "", characteristicUuid: "")
      return
    }
    
    guard manager.state == .poweredOn else {
      rejectWithContext(reject: reject, errorCode: "BT_NOT_READY", message: "Bluetooth not ready", deviceId: "", characteristicUuid: "")
      return
    }
    
    if isScanning {
      print("⚠️ Already scanning")
      resolve(["status": "already_scanning"])
      return
    }
    
    // Get power profile settings
    let settings = powerProfiles[currentPowerProfile] ?? PowerProfileConstants.profiles["default"]!
    
    // Extract power profile options with fallback to current profile
    let maxScanDurationMs = options["maxScanDurationMs"] as? Int ?? settings["maxScanDurationMs"] as? Int ?? 15000
    let scanMode = options["scanMode"] as? String ?? settings["scanMode"] as? String ?? "LowLatency"
    let allowDuplicates = options["allowDuplicates"] as? Bool ?? true
    
    print("⚡ Enhanced power profile scan settings: duration=\(maxScanDurationMs)ms, mode=\(scanMode), duplicates=\(allowDuplicates)")
    print("⚡ Current power profile: \(currentPowerProfile)")
    
    // Stop any existing scan
    manager.stopScan()
    
    // Configure scan options based on power profile
    var scanOptions: [String: Any] = [
      CBCentralManagerScanOptionAllowDuplicatesKey: allowDuplicates
    ]
    
    // Enhanced scan mode optimization for iOS 13+
    if #available(iOS 13.0, *) {
      switch scanMode {
      case "LowPower":
        scanOptions[CBCentralManagerScanOptionSolicitedServiceUUIDsKey] = []
        print("⚡ Low power scan mode activated")
      case "Balanced":
        // Default balanced mode
        print("⚡ Balanced scan mode activated")
        break
      case "LowLatency":
        // High performance mode - no additional options needed
        print("⚡ Low latency scan mode activated")
        break
      default:
        print("⚡ Default scan mode activated")
        break
      }
    }
    
    // Background vs foreground optimization
    let isBackground = UIApplication.shared.applicationState == .background
    let servicesToScan: [CBUUID]?
    
    if isBackground {
      // In background, scan only for specific services for better reliability
      servicesToScan = [smartTagServiceUUID]
      print("🔍 Background scan with service filter: \(smartTagServiceUUID)")
    } else {
      // In foreground, scan broadly
      servicesToScan = nil
      print("🔍 Foreground broad scan")
    }
    
    // Start scanning with enhanced options
    manager.scanForPeripherals(
      withServices: servicesToScan,
      options: scanOptions
    )
    
    isScanning = true
    print("✅ Enhanced BLE scan started with power profile optimization")
    
    // Auto-stop scan after power profile duration
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(maxScanDurationMs) / 1000.0) {
      if self.isScanning {
        manager.stopScan()
        self.isScanning = false
        print("⏱️ Auto-stopped scan after \(maxScanDurationMs)ms (enhanced power profile)")
      }
    }
    
    resolve([
      "status": "scanning_started", 
      "duration": maxScanDurationMs, 
      "mode": scanMode,
      "powerProfile": currentPowerProfile,
      "isBackground": isBackground
    ])
  }
  
  // Backward compatibility method
  @objc(startScanning:rejecter:)
  func startScanning(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    startScanningWithOptions(options: [:], resolver: resolve, rejecter: reject)
  }
  
  @objc(stopScanning:rejecter:)
  func stopScanning(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🛑 Stopping BLE scan")
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    manager.stopScan()
    isScanning = false
    print("✅ BLE scan stopped")
    resolve(["status": "scanning_stopped"])
  }
  
  @objc(connectToDeviceWithOptions:options:resolver:rejecter:)
  func connectToDeviceWithOptions(deviceId: String, options: [String: Any], resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔗 Connecting to device: \(deviceId) with power profile options")
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready", nil)
      return
    }
    
    // Check if device has been forgotten - only prevent if not manual connection
    let isManualConnection = options["isManualConnection"] as? Bool ?? false
    if forgottenDeviceIDs.contains(deviceId) && !isManualConnection {
      reject("DEVICE_FORGOTTEN", "Device has been forgotten and cannot be auto-connected", nil)
      return
    }
    
    // If this is a manual connection to a forgotten device, remove it from forgotten list
    if forgottenDeviceIDs.contains(deviceId) && isManualConnection {
      print("🔄 Manual connection to forgotten device - removing from forgotten list: \(deviceId)")
      forgottenDeviceIDs.remove(deviceId)
      saveForgottenDevices()
    }
    
    // If this is a manual connection to a device that was manually disconnected, clear the tracking
    if manualDisconnectInProgress.contains(deviceId) && isManualConnection {
      print("🔄 Manual connection to previously manually disconnected device - clearing tracking: \(deviceId)")
      manualDisconnectInProgress.remove(deviceId)
    }
    
    // Extract power profile options
    let connectionIntervalMs = options["connectionIntervalMs"] as? Int ?? 50
    let supervisionTimeoutMs = options["supervisionTimeoutMs"] as? Int ?? 4000
    let connectionLatency = options["connectionLatency"] as? Int ?? 0
    
    print("⚡ Power profile connection settings: interval=\(connectionIntervalMs)ms, timeout=\(supervisionTimeoutMs)ms, latency=\(connectionLatency)")
    
    // Find peripheral in scanned devices
    guard let peripheral = scannedDevices[deviceId] else {
      reject("DEVICE_NOT_FOUND", "Device not found in scanned devices", nil)
      return
    }
    
    // Check if already connected
    if connectedPeripherals.contains(peripheral) {
      resolve(["status": "already_connected", "deviceId": deviceId])
      return
    }
    
    // Check if already connecting
    if connectingPeripherals[deviceId] != nil {
      resolve(["status": "already_connecting", "deviceId": deviceId])
      return
    }
    
    // Store promise for connection result
    let promiseKey = "connect_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    // Start connection
    connectingPeripherals[deviceId] = peripheral
    peripheral.delegate = self
    
    // Configure connection options based on power profile
    var connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
    ]
    
    // Add power profile optimizations for iOS 13+
    if #available(iOS 13.0, *) {
      // Note: iOS Core Bluetooth doesn't directly expose connection interval control
      // These are hints that the system may use for optimization
      if connectionIntervalMs > 100 {
        // Low power mode - request longer intervals
        connectionOptions[CBConnectPeripheralOptionStartDelayKey] = 0.1
      }
    }
    
    manager.connect(peripheral, options: connectionOptions)
    print("🚀 Connection attempt initiated for: \(deviceId) with power profile optimization")
    
    // Set connection timeout based on power profile
    let timeoutSeconds = Double(supervisionTimeoutMs) / 1000.0
    DispatchQueue.main.asyncAfter(deadline: .now() + timeoutSeconds) {
      if let connectingPeripheral = self.connectingPeripherals[deviceId] {
        print("⏰ Connection timeout for \(deviceId) after \(timeoutSeconds)s (power profile) - cancelling")
        manager.cancelPeripheralConnection(connectingPeripheral)
        self.connectingPeripherals.removeValue(forKey: deviceId)
        
        // Clean up promises
        if let rejecter = self.pendingRejecters[promiseKey] {
          rejecter("CONNECTION_TIMEOUT", "Connection timeout after \(timeoutSeconds)s", nil)
          self.pendingPromises.removeValue(forKey: promiseKey)
          self.pendingRejecters.removeValue(forKey: promiseKey)
        }
      }
    }
  }
  
  // Backward compatibility method
  @objc(connectToDevice:resolver:rejecter:)
  func connectToDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    connectToDeviceWithOptions(deviceId: deviceId, options: [:], resolver: resolve, rejecter: reject)
  }
  
  @objc(disconnectFromDevice:resolver:rejecter:)
  func disconnectFromDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔌 Manual disconnect from device: \(deviceId) (system-style)")
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    // Find peripheral
    let peripheral = connectedPeripherals.first { $0.identifier.uuidString == deviceId }
    
    if let peripheral = peripheral {
      // Mark this as a manual disconnect
      manualDisconnectInProgress.insert(deviceId)
      
      // Set a timeout to clear manual disconnect tracking after 30 minutes
      // This prevents the tracking from persisting indefinitely
      DispatchQueue.main.asyncAfter(deadline: .now() + 1800.0) { // 30 minutes
        if self.manualDisconnectInProgress.contains(deviceId) {
          print("⏰ Clearing manual disconnect tracking after 30 minutes for: \(deviceId)")
          self.manualDisconnectInProgress.remove(deviceId)
        }
      }
      
      // Simply cancel the GATT connection - this preserves the bond/pairing
      manager.cancelPeripheralConnection(peripheral)
      
      // Remove from connected list only
      connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
      connectingPeripherals.removeValue(forKey: deviceId)
      
      // Clean up any pending service discovery timeout
      if let timer = serviceDiscoveryTimers[deviceId] {
        timer.invalidate()
        serviceDiscoveryTimers.removeValue(forKey: deviceId)
        print("🧹 Cleaned up service discovery timeout for disconnected device: \(deviceId)")
      }
      
      // Cancel any reconnect timer for this device
      if let timer = reconnectTimers[deviceId] {
        timer.invalidate()
        reconnectTimers.removeValue(forKey: deviceId)
        reconnectBackoff.removeValue(forKey: deviceId)
        print("⏰ Cancelled reconnect timer for: \(deviceId)")
      }
      
      print("✅ GATT disconnection initiated for: \(deviceId) (bond preserved)")
      resolve(["status": "disconnection_initiated", "deviceId": deviceId])
    } else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
    }
  }
  
  @objc(readCharacteristic:characteristicUuid:resolver:rejecter:)
  func readCharacteristic(deviceId: String, characteristicUuid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("📖 Reading characteristic: \(characteristicUuid) from device: \(deviceId)")
    
    // Enhanced validation
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
    
    // Store promise for read result
    let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    // Execute read operation
    peripheral.readValue(for: characteristic)
    print("📖 Enhanced read request sent for characteristic: \(characteristicUuid)")
  }
  
  @objc(writeCharacteristic:characteristicUuid:data:resolver:rejecter:)
  func writeCharacteristic(deviceId: String, characteristicUuid: String, data: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("📝 Writing to characteristic: \(characteristicUuid) on device: \(deviceId)")
    
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
    
    // Convert hex string to data
    guard let dataBytes = dataFromHexString(data) else {
      reject("INVALID_DATA", "Invalid hex data", nil)
      return
    }
    
    // Store promise for write result
    let promiseKey = "write_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    if characteristic.properties.contains(.write) {
      peripheral.writeValue(dataBytes, for: characteristic, type: .withResponse)
    } else {
      peripheral.writeValue(dataBytes, for: characteristic, type: .withoutResponse)
    }
    
    print("📝 Write request sent for characteristic: \(characteristicUuid)")
  }
  
  @objc(enableNotifications:characteristicUuid:resolver:rejecter:)
  func enableNotifications(deviceId: String, characteristicUuid: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔔 Enabling notifications for characteristic: \(characteristicUuid) on device: \(deviceId)")
    
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
    
    // Store promise for notification enable result
    let promiseKey = "notify_\(deviceId)_\(characteristicUuid)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    peripheral.setNotifyValue(true, for: characteristic)
    print("🔔 Notification enable request sent for characteristic: \(characteristicUuid)")
  }
  
  @objc(discoverServices:resolver:rejecter:)
  func discoverServices(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔍 Discovering services for device: \(deviceId)")
    
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    
    // Store promise for service discovery result
    let promiseKey = "discover_services_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    // Set up timeout timer (10 seconds)
    let timeoutTimer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: false) { [weak self] _ in
      guard let self = self else { return }
      
      print("⏰ Service discovery timeout for device: \(deviceId)")
      
      // Clean up timeout timer
      self.serviceDiscoveryTimers.removeValue(forKey: deviceId)
      
      // Reject the promise if it's still pending
      if let rejecter = self.pendingRejecters[promiseKey] {
        rejecter("SERVICE_DISCOVERY_TIMEOUT", "Service discovery timeout after 10 seconds", nil)
        self.pendingPromises.removeValue(forKey: promiseKey)
        self.pendingRejecters.removeValue(forKey: promiseKey)
      }
    }
    
    serviceDiscoveryTimers[deviceId] = timeoutTimer
    
    peripheral.discoverServices(nil)
    print("🔍 Service discovery request sent for device: \(deviceId) with 10s timeout")
  }
  
  @objc(readRSSI:resolver:rejecter:)
  func readRSSI(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("📶 Reading RSSI for device: \(deviceId)")
    
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      reject("DEVICE_NOT_CONNECTED", "Device not connected", nil)
      return
    }
    
    // Store promise for RSSI read result
    let promiseKey = "rssi_\(deviceId)"
    pendingPromises[promiseKey] = resolve
    pendingRejecters[promiseKey] = reject
    
    peripheral.readRSSI()
    print("📶 RSSI read request sent for device: \(deviceId)")
  }
  
  
  
  
  // MARK: - Enhanced Error Handling (matching Android implementation)
  
  private func rejectWithContext(reject: @escaping RCTPromiseRejectBlock, errorCode: String, message: String, deviceId: String, characteristicUuid: String) {
    let errorMap: [String: Any] = [
      "code": errorCode,
      "message": message,
      "deviceId": deviceId,
      "characteristicUuid": characteristicUuid,
      "timestamp": Date().timeIntervalSince1970
    ]
    
    // Store error context for debugging
    let errorKey = "\(deviceId)_\(characteristicUuid)_\(Date().timeIntervalSince1970)"
    errorContexts[errorKey] = errorMap
    
    print("❌ Enhanced error: \(errorCode) - \(message) for device: \(deviceId), characteristic: \(characteristicUuid)")
    
    reject(errorCode, message, NSError(domain: "BLEError", code: 1, userInfo: errorMap))
  }
  
  private func handleOperationError(deviceId: String, characteristicUuid: String, operation: String, error: Error) {
    let errorKey = "\(deviceId)_\(characteristicUuid)_\(operation)"
    let attempts = retryAttempts[errorKey] ?? 0
    
    print("❌ Operation error: \(operation) failed for \(deviceId) - attempt \(attempts + 1)")
    
    if attempts < maxRetryAttempts {
      retryAttempts[errorKey] = attempts + 1
      print("🔄 Retrying operation: \(operation) for \(deviceId)")
      
      // Schedule retry with exponential backoff
      let delay = Double(attempts + 1) * 2.0 // 2s, 4s, 6s
      DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
        self?.retryOperation(deviceId: deviceId, characteristicUuid: characteristicUuid, operation: operation)
      }
    } else {
      print("🚨 Max retry attempts reached for \(operation) on \(deviceId)")
      retryAttempts.removeValue(forKey: errorKey)
    }
  }
  
  private func retryOperation(deviceId: String, characteristicUuid: String, operation: String) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      print("⚠️ Cannot retry operation - peripheral not found: \(deviceId)")
      return
    }
    
    print("🔄 Retrying \(operation) for \(deviceId)")
    
    switch operation {
    case "read":
      if let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) {
        peripheral.readValue(for: characteristic)
      }
    case "write":
      // Write operations need to be retried with stored data
      print("⚠️ Write retry not implemented - requires stored data")
    case "notify":
      if let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) {
        peripheral.setNotifyValue(true, for: characteristic)
      }
    default:
      print("⚠️ Unknown operation for retry: \(operation)")
    }
  }
  
  private func validateOperation(deviceId: String, characteristicUuid: String, operation: String) -> Bool {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      print("❌ Validation failed: Device not connected - \(deviceId)")
      return false
    }
    
    guard let characteristic = findCharacteristic(peripheral: peripheral, uuid: characteristicUuid) else {
      print("❌ Validation failed: Characteristic not found - \(characteristicUuid)")
      return false
    }
    
    switch operation {
    case "read":
      guard characteristic.properties.contains(.read) else {
        print("❌ Validation failed: Characteristic not readable - \(characteristicUuid)")
        return false
      }
    case "write":
      guard characteristic.properties.contains(.write) || characteristic.properties.contains(.writeWithoutResponse) else {
        print("❌ Validation failed: Characteristic not writable - \(characteristicUuid)")
        return false
      }
    case "notify":
      guard characteristic.properties.contains(.notify) || characteristic.properties.contains(.indicate) else {
        print("❌ Validation failed: Characteristic not notifiable - \(characteristicUuid)")
        return false
      }
    default:
      print("❌ Validation failed: Unknown operation - \(operation)")
      return false
    }
    
    return true
  }

  // MARK: - Device Data Management (Android-style approach)
  
  private func requestDeviceData(deviceId: String) {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      print("⚠️ Cannot request device data - peripheral not found: \(deviceId)")
        return
      }
      
    guard let characteristics = deviceCharacteristics[deviceId] else {
      print("⚠️ No characteristics found for device: \(deviceId)")
        return
      }
      
    print("📊 Requesting device data for: \(deviceId)")
    print("📊 Device has \(characteristics.count) characteristics")
    
    // Log all available characteristics for debugging
    for characteristic in characteristics {
      print("📋 Available characteristic: \(characteristic.uuid.uuidString)")
    }
    
    // Read battery level if available
    if let batteryChar = characteristics.first(where: { $0.uuid == BATTERY_LEVEL_CHAR_UUID }) {
      print("🔋 Reading battery level for: \(deviceId)")
      peripheral.readValue(for: batteryChar)
    }
    
    // Read device info characteristics
    if let manufacturerChar = characteristics.first(where: { $0.uuid == MANUFACTURER_NAME_CHAR_UUID }) {
      print("🏭 Reading manufacturer name for: \(deviceId)")
      peripheral.readValue(for: manufacturerChar)
    }
    
    if let modelChar = characteristics.first(where: { $0.uuid == MODEL_NUMBER_CHAR_UUID }) {
      print("📱 Reading model number for: \(deviceId)")
      peripheral.readValue(for: modelChar)
    }
    
    if let firmwareChar = characteristics.first(where: { $0.uuid == FIRMWARE_REVISION_CHAR_UUID }) {
      print("🔧 Reading firmware revision for: \(deviceId)")
      peripheral.readValue(for: firmwareChar)
    }
    
    // Check if this is a Smart Tag and read Smart Tag specific characteristics
    let isSmartTag = characteristics.contains { $0.service?.uuid == SMART_TAG_SERVICE_UUID }
    print("🏷️ Device \(deviceId) isSmartTag: \(isSmartTag)")
    
    if isSmartTag {
      if let deviceStatusChar = characteristics.first(where: { $0.uuid == DEVICE_STATUS_CHAR_UUID }) {
        print("📊 Reading device status for Smart Tag: \(deviceId) - UUID: \(DEVICE_STATUS_CHAR_UUID.uuidString)")
        peripheral.readValue(for: deviceStatusChar)
      } else {
        print("⚠️ Device status characteristic not found for Smart Tag: \(deviceId)")
      }
      
      if let dataTransferChar = characteristics.first(where: { $0.uuid == DATA_TRANSFER_CHAR_UUID }) {
        print("📡 Reading data transfer for Smart Tag: \(deviceId)")
        peripheral.readValue(for: dataTransferChar)
      }
      
      if let locationChar = characteristics.first(where: { $0.uuid == LOCATION_DATA_CHAR_UUID }) {
        print("📍 Reading location data for Smart Tag: \(deviceId)")
        peripheral.readValue(for: locationChar)
      }
    } else {
      print("📋 Device is not a Smart Tag, skipping Smart Tag specific characteristics")
    }
  }
  
  private func handleCharacteristicData(deviceId: String, characteristic: CBCharacteristic, data: Data) {
    let charUuid = characteristic.uuid.uuidString
    print("📊 Handling characteristic data for \(deviceId) - UUID: \(charUuid), Data length: \(data.count)")
    
    if charUuid == DEVICE_STATUS_CHAR_UUID.uuidString {
      print("📊 Parsing device status data for: \(deviceId)")
      parseDeviceStatusData(deviceId: deviceId, data: data)
    } else if charUuid == SYSTEM_COMMAND_CHAR_UUID.uuidString {
      print("🔧 Parsing system command response for: \(deviceId)")
      parseSystemCommandResponse(deviceId: deviceId, data: data)
    } else if charUuid == BATTERY_LEVEL_CHAR_UUID.uuidString {
      if data.count > 0 {
        let batteryLevel = data[0]
        print("🔋 Battery level updated for \(deviceId): \(batteryLevel)%")
        sendDeviceDataUpdateEvent(deviceId: deviceId, batteryLevel: Int(batteryLevel))
      }
    } else if charUuid == MANUFACTURER_NAME_CHAR_UUID.uuidString {
      if data.count > 0 {
        let manufacturerName = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        print("🏭 Manufacturer name for \(deviceId): \(manufacturerName)")
      }
    } else if charUuid == MODEL_NUMBER_CHAR_UUID.uuidString {
      if data.count > 0 {
        let modelNumber = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        print("📱 Model number for \(deviceId): \(modelNumber)")
      }
    } else if charUuid == FIRMWARE_REVISION_CHAR_UUID.uuidString {
      if data.count > 0 {
        let firmwareRevision = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        print("🔧 Firmware revision for \(deviceId): \(firmwareRevision)")
      }
    }
  }
  
  private func parseDeviceStatusData(deviceId: String, data: Data) {
    if data.count < 20 {
      print("⚠️ Invalid device status data length: \(data.count), expected: 20")
      return
    }
    
    print("📊 Parsing device status data - Raw data length: \(data.count)")
    print("📊 Raw data hex: \(dataToHexString(data))")
    
    // Parse according to SDD DEVICE_STATUS_LAYOUT (Little Endian format)
    let timestamp = data.withUnsafeBytes { $0.load(as: UInt32.self) }
    let steps = data.subdata(in: 4..<8).withUnsafeBytes { $0.load(as: UInt32.self) }
    let temperature = data.subdata(in: 8..<12).withUnsafeBytes { $0.load(as: Float.self) }
    let flags = data.subdata(in: 12..<16).withUnsafeBytes { $0.load(as: UInt32.self) }
    
    // Convert timestamp to milliseconds for JavaScript (matching Android behavior)
    let timestampMs = UInt64(timestamp) * 1000
    
    print("📊 Parsed device data - Steps: \(steps), Temp: \(temperature)°C, Timestamp: \(timestamp)s (\(timestampMs)ms), Flags: \(flags)")
    
    // Parse device status flags
    let parsedFlags: [String: Any] = [
      "isActive": (flags & 0x01) != 0,
      "isCharging": (flags & 0x02) != 0,
      "lowBattery": (flags & 0x04) != 0,
      "tempAlert": (flags & 0x08) != 0,
      "motionDetected": (flags & 0x10) != 0
    ]
    
    let deviceData: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": connectedPeripherals.first { $0.identifier.uuidString == deviceId }?.name ?? "Unknown",
      "timestamp": timestampMs,
      "steps": steps,
      "temperature": temperature,
      "flags": parsedFlags,
      "rawFlags": flags,
      "lastUpdate": Date().timeIntervalSince1970 * 1000,
      "rawBuffer": dataToHexString(data),
      "sddCompliant": true
    ]
    
    // Send device data update event
    print("📤 Sending device data update event for: \(deviceId)")
    sendDeviceDataUpdateEvent(deviceId: deviceId, deviceData: deviceData)
  }
  
  // Build system command packet (SDD compliant format)
  private func buildSystemCommandPacket(commandId: UInt8, payload: [UInt8] = []) -> Data {
    var packet = Data(count: 20)
    packet[0] = 0xAA // REQUEST_ID
    packet[1] = commandId
    packet[2] = UInt8(payload.count)
    
    // Add payload data
    for (index, byte) in payload.enumerated() {
      if index < 17 { // Max 17 bytes payload
        packet[3 + index] = byte
      }
    }
    
    print("🔧 Built system command packet - CommandID: 0x\(String(format: "%02x", commandId)), Payload length: \(payload.count)")
    print("🔧 Packet hex: \(dataToHexString(packet))")
    
    return packet
  }
  
  // Send system command to device
  private func sendSystemCommand(deviceId: String, commandId: UInt8, payload: [UInt8] = []) -> Bool {
    guard let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) else {
      print("❌ Device not connected for system command: \(deviceId)")
      return false
    }
    
    // Find SYSTEM_COMMAND characteristic
    guard let smartTagService = peripheral.services?.first(where: { $0.uuid == SMART_TAG_SERVICE_UUID }),
          let systemCommandChar = smartTagService.characteristics?.first(where: { $0.uuid == SYSTEM_COMMAND_CHAR_UUID }) else {
      print("❌ SYSTEM_COMMAND characteristic not found for device: \(deviceId)")
      return false
    }
    
    // Build command packet
    let packet = buildSystemCommandPacket(commandId: commandId, payload: payload)
    
    // Write to characteristic
    peripheral.writeValue(packet, for: systemCommandChar, type: .withResponse)
    
    print("✅ System command sent to device: \(deviceId)")
    return true
  }
  
  private func parseSystemCommandResponse(deviceId: String, data: Data) {
    if data.count < 4 {
      print("⚠️ Invalid system command response length: \(data.count), expected at least 4 bytes")
      return
    }
    
    print("🔧 Parsing system command response - Raw data hex: \(dataToHexString(data))")
    
    let responseId = data[0]
    let commandId = data[1]
    let responseLength = data[2]
    let responseStatus = data[3]
    
    print("🔧 System command response - ResponseID: 0x\(String(format: "%02x", responseId)), CommandID: 0x\(String(format: "%02x", commandId)), Length: \(responseLength), Status: 0x\(String(format: "%02x", responseStatus))")
    
    // Validate response ID (should be 0xBB according to SDD)
    if responseId != 0xBB {
      print("⚠️ Invalid response ID: 0x\(String(format: "%02x", responseId)), expected 0xBB")
      return
    }
    
    // Check if command was successful
    if responseStatus != 0x00 {
      print("⚠️ System command failed with status: 0x\(String(format: "%02x", responseStatus))")
      return
    }
    
    // Parse command-specific data
    if commandId == 0x07 && responseLength > 0 { // GET_DIAGNOSTICS
      let responseData = data.subdata(in: 4..<4+Int(responseLength))
      print("🔧 Diagnostics response data: \(dataToHexString(responseData))")
      
      // Parse diagnostics data - this might contain battery level
      if responseData.count >= 1 {
        let batteryLevel = responseData[0]
        if batteryLevel > 0 && batteryLevel <= 100 {
          print("🔋 Battery level from diagnostics: \(batteryLevel)%")
          sendDeviceDataUpdateEvent(deviceId: deviceId, batteryLevel: Int(batteryLevel))
        }
      }
    }
    
    // Send updated device data
    print("📤 Sending updated device data after system command response")
    sendDeviceDataUpdateEvent(deviceId: deviceId, deviceData: nil)
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
    
    print("📤 DeviceInfoMap contents: \(eventData)")
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceDataUpdated", body: eventData)
    }
    
    // Also trigger health data API call from native side
    print("📤 Triggering health data API call from native side for device: \(deviceId)")
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
  
  // MARK: - Helper Methods
  
  private func findCharacteristic(peripheral: CBPeripheral, uuid: String) -> CBCharacteristic? {
    guard let services = peripheral.services else { return nil }
    
    for service in services {
      guard let characteristics = service.characteristics else { continue }
      for characteristic in characteristics {
        if characteristic.uuid.uuidString.lowercased() == uuid.lowercased() {
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
  

  // MARK: - Enhanced Auto-Connect Methods
  
  @objc(startAutoConnect:rejecter:)
  func startAutoConnect(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🚀 Starting iOS auto-connect functionality")
    
    // Ensure we have notification permission so we can surface background connects
    requestNotificationPermissionsIfNeeded()
    
    // Only initialize if not already initialized
    if centralManager == nil {
      print("📡 Initializing CBCentralManager with restore identifier")
      let restoreIdentifier = "com.reactnativeboilerplate.central.smarttag.v1"
      let options: [String: Any] = [
        CBCentralManagerOptionRestoreIdentifierKey: restoreIdentifier
      ]
      print("🔧 Using restore identifier: \(restoreIdentifier)")
      centralManager = CBCentralManager(delegate: self, queue: nil, options: options)
    } else {
      print("📡 CBCentralManager already initialized")
    }
    
    autoConnectEnabled = true
    
    // Start health monitoring
    startHealthChecks()
    
    // If Bluetooth is already ready, start scanning immediately
    if centralManager?.state == .poweredOn {
      print("📡 Bluetooth ready - starting immediate scan for bonded devices")
      startScanning()
    }
    
    resolve(["status": "Auto-connect started"])
  }
  
  @objc(stopAutoConnect:rejecter:)
  func stopAutoConnect(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🛑 Stopping iOS auto-connect functionality")
    
    autoConnectEnabled = false
    centralManager?.stopScan()
    
    // Stop health checks
    healthCheckTimer?.invalidate()
    healthCheckTimer = nil
    
    // Disconnect all peripherals
    for peripheral in connectedPeripherals {
      centralManager?.cancelPeripheralConnection(peripheral)
    }
    connectedPeripherals.removeAll()

    // Invalidate any reconnect timers
    for (_, timer) in reconnectTimers { timer.invalidate() }
    reconnectTimers.removeAll()
    
    // Clear health check failures
    healthCheckFailures.removeAll()
    
    resolve(["status": "Auto-connect stopped"])
  }
  
  @objc(addBondedDevice:resolver:rejecter:)
  func addBondedDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("✅ Adding bonded device: \(deviceId)")
    
    bondedDeviceIDs.insert(deviceId)
    saveBondedDevices()
    
    resolve(["deviceId": deviceId, "status": "added"])
  }
  
  @objc(removeBondedDevice:resolver:rejecter:)
  func removeBondedDevice(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("❌ Removing bonded device: \(deviceId)")
    print("🔍 Before removal - bonded: \(bondedDeviceIDs.contains(deviceId)), forgotten: \(forgottenDeviceIDs.contains(deviceId))")
    
    bondedDeviceIDs.remove(deviceId)
    forgottenDeviceIDs.insert(deviceId) // Add to forgotten list to prevent re-bonding
    saveBondedDevices()
    saveForgottenDevices()
    
    print("🔍 After removal - bonded: \(bondedDeviceIDs.contains(deviceId)), forgotten: \(forgottenDeviceIDs.contains(deviceId))")
    print("📱 Current forgotten devices: \(Array(forgottenDeviceIDs))")
    
    resolve(["deviceId": deviceId, "status": "removed"])
  }
  
  
  // Private helper method to get bonded devices array
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
    print("🔍 Force starting scan for bonded devices...")
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready (state: \(manager.state.rawValue))", nil)
      return
    }
    
    // Stop any existing scan
    manager.stopScan()
    
    // Start fresh scan
    manager.scanForPeripherals(
      withServices: nil, // Scan for ALL devices to debug
      options: [CBCentralManagerScanOptionAllowDuplicatesKey: true]
    )
    
    print("✅ Force scan started (scanning for ALL devices)")
    
    // Auto-stop after 10 seconds
    DispatchQueue.main.asyncAfter(deadline: .now() + 10.0) {
      manager.stopScan()
      print("🛑 Force scan stopped after 10 seconds")
    }
    
    resolve(["status": "Force scan started"])
  }
  

  @objc(debugConnectionStatus:rejecter:)
  func debugConnectionStatus(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // Check for connected Health Tag
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
    
    print("🐛 Debug Connection Status: \(status)")
    resolve(status)
  }
  
  @objc(connectToKnownPeripherals:rejecter:)
  func connectToKnownPeripherals(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔗 Attempting to connect to known bonded peripherals...")
    
    guard let manager = centralManager else {
      reject("NO_MANAGER", "Central manager not initialized", nil)
      return
    }
    
    guard manager.state == .poweredOn else {
      reject("BT_NOT_READY", "Bluetooth not ready", nil)
      return
    }
    
    let bondedDevices = getBondedDevicesArray()
    print("📋 Looking for \(bondedDevices.count) bonded devices: \(bondedDevices)")
    
    if bondedDevices.isEmpty {
      resolve(["status": "No bonded devices to connect", "attempted": 0])
      return
    }
    
    // Convert UUIDs to NSUUID and retrieve known peripherals
    let uuids = bondedDevices.compactMap { UUID(uuidString: $0) }
    let knownPeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
    
    print("🔍 Found \(knownPeripherals.count) known peripherals from Core Bluetooth")
    
    var attempted = 0
    for peripheral in knownPeripherals {
      // Only connect if not already connected
      if peripheral.state != .connected {
        print("🔗 Connecting to known peripheral: \(peripheral.name ?? peripheral.identifier.uuidString)")
        peripheral.delegate = self
        
        let connectionOptions: [String: Any] = [
          CBConnectPeripheralOptionNotifyOnConnectionKey: true,
          CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
          CBConnectPeripheralOptionNotifyOnNotificationKey: true
        ]
        manager.connect(peripheral, options: connectionOptions)
        attempted += 1
      } else {
        print("ℹ️ Peripheral \(peripheral.name ?? peripheral.identifier.uuidString) already connected")
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
    
    // Clean up any stale connections that are no longer actually connected
    cleanupStaleConnections()
    
    let status = [
      "enabled": autoConnectEnabled,
      "bondedDevicesCount": bondedDeviceIDs.count,
      "connectedDevicesCount": connectedPeripherals.count,
      "centralManagerState": centralManager?.state.rawValue ?? -1,
      "isScanning": isScanning,
      "bondedDevices": Array(bondedDeviceIDs)
    ] as [String : Any]
    
    print("📊 Auto-connect status requested:")
    print("  - Enabled: \(autoConnectEnabled)")
    print("  - Scanning: \(isScanning)")
    print("  - Bonded devices: \(Array(bondedDeviceIDs))")
    print("  - Connected peripherals: \(connectedPeripherals.count)")
    print("  - Central Manager state: \(centralManager?.state.rawValue ?? -1)")
    
    resolve(status)
  }
  
  @objc(sendSystemCommand:commandId:payload:resolver:rejecter:)
  func sendSystemCommand(deviceId: String, commandId: NSNumber, payload: NSArray, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    let command = commandId.uint8Value
    let payloadBytes = payload.compactMap { ($0 as? NSNumber)?.uint8Value }
    
    print("🔧 iOS: Sending system command \(command) to device \(deviceId)")
    
    let success = sendSystemCommand(deviceId: deviceId, commandId: command, payload: payloadBytes)
    
    if success {
      resolve(["success": true])
    } else {
      reject("SYSTEM_COMMAND_ERROR", "Failed to send system command", nil)
    }
  }

  // Clean up stale connections that are no longer actually connected
  private func cleanupStaleConnections() {
    var devicesToRemove: [CBPeripheral] = []
    
    for peripheral in connectedPeripherals {
      // Check if the peripheral is actually still connected
      if peripheral.state != .connected {
        print("🧹 Cleaning up stale connection: \(peripheral.name ?? peripheral.identifier.uuidString)")
        devicesToRemove.append(peripheral)
      }
    }
    
    // Remove stale connections
    for peripheral in devicesToRemove {
      connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
      print("✅ Removed stale connection: \(peripheral.name ?? peripheral.identifier.uuidString)")
    }
  }

  // Disconnect device from native iOS CoreBluetooth
  @objc(disconnectFromNative:resolver:rejecter:)
  func disconnectFromNative(deviceId: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    print("🔌 Disconnecting device from native iOS CoreBluetooth: \(deviceId)")
    
    // Find the peripheral in connected peripherals
    if let peripheral = connectedPeripherals.first(where: { $0.identifier.uuidString == deviceId }) {
      print("🔌 Found peripheral to disconnect: \(peripheral.name ?? deviceId)")
      
      // Cancel the connection
      centralManager?.cancelPeripheralConnection(peripheral)
      
      // Remove from connected peripherals
      connectedPeripherals.removeAll { $0.identifier.uuidString == deviceId }
      
      // Also remove from connecting peripherals if it's there
      connectingPeripherals.removeValue(forKey: deviceId)
      
      // Cancel any reconnect timer for this device
      if let timer = reconnectTimers[deviceId] {
        timer.invalidate()
        reconnectTimers.removeValue(forKey: deviceId)
        print("⏰ Cancelled reconnect timer for: \(deviceId)")
      }
      
      // Clean up any pending service discovery timeout
      if let timer = serviceDiscoveryTimers[deviceId] {
        timer.invalidate()
        serviceDiscoveryTimers.removeValue(forKey: deviceId)
        print("🧹 Cleaned up service discovery timeout for native disconnected device: \(deviceId)")
      }
      
      print("✅ Successfully disconnected device from native iOS: \(deviceId)")
      resolve([
        "success": true,
        "message": "Device disconnected from native iOS",
        "deviceId": deviceId
      ])
    } else {
      print("⚠️ Device not found in native connected list: \(deviceId)")
      resolve([
        "success": true,
        "message": "Device not in native connected list",
        "deviceId": deviceId
      ])
    }
  }


  
  // MARK: - Storage Methods
  
  private func saveBondedDevices() {
    let devices = Array(bondedDeviceIDs)
    UserDefaults.standard.set(devices, forKey: "BondedSmartTagDevices")
    print("💾 Saved bonded devices: \(devices)")
  }
  
  private func loadBondedDevices() {
    if let devices = UserDefaults.standard.array(forKey: "BondedSmartTagDevices") as? [String] {
      bondedDeviceIDs = Set(devices)
      print("📱 Loaded bonded devices: \(devices)")
    }
  }
  
  private func saveForgottenDevices() {
    let devices = Array(forgottenDeviceIDs)
    UserDefaults.standard.set(devices, forKey: "ForgottenSmartTagDevices")
    print("💾 Saved forgotten devices: \(devices)")
  }
  
  private func loadForgottenDevices() {
    if let devices = UserDefaults.standard.array(forKey: "ForgottenSmartTagDevices") as? [String] {
      forgottenDeviceIDs = Set(devices)
      print("📱 Loaded forgotten devices: \(devices)")
    }
  }
  
  // MARK: - CBCentralManagerDelegate
  
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    print("📡 Central Manager state: \(central.state.rawValue)")
    
    // Handle pending permission resolvers
    let resolvers = pendingPermissionResolvers
    pendingPermissionResolvers.removeAll()
    
    switch central.state {
    case .poweredOn:
      print("🔵 Bluetooth is powered on")
      print("📋 Bonded devices on power on: \(Array(bondedDeviceIDs))")
      
      // Resolve pending permission requests
      for (resolve, _) in resolvers {
        resolve(["status": "granted", "state": "poweredOn"])
      }
      
      // If we have bonded devices, automatically enable auto-connect and start scanning
      if bondedDeviceIDs.count > 0 && !autoConnectEnabled {
        print("🚀 Auto-enabling auto-connect due to bonded devices")
        autoConnectEnabled = true
      }
      
      if autoConnectEnabled {
        print("🔍 Starting auto-connect scan on Bluetooth power on")
        startScanning()
        // Also try to connect to known peripherals immediately without scanning
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          print("🔗 Attempting direct connection to known peripherals on power on (native)")
          self.connectToKnownPeripheralsNative()
        }
      }
    case .poweredOff:
      print("🔴 Bluetooth is powered off")
      connectedPeripherals.removeAll()
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("BLUETOOTH_OFF", "Bluetooth is powered off", nil)
      }
    case .resetting:
      print("🟡 Bluetooth is resetting")
      connectedPeripherals.removeAll()
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("RESETTING", "Bluetooth is resetting", nil)
      }
    case .unauthorized:
      print("🟠 Bluetooth is unauthorized")
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("UNAUTHORIZED", "Bluetooth access unauthorized", nil)
      }
    case .unsupported:
      print("⚫ Bluetooth is unsupported")
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("UNSUPPORTED", "Bluetooth not supported", nil)
      }
    case .unknown:
      print("❓ Bluetooth state is unknown")
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("UNKNOWN", "Bluetooth state unknown", nil)
      }
    @unknown default:
      print("❓ Unknown Bluetooth state")
      // Reject pending permission requests
      for (_, reject) in resolvers {
        reject("UNKNOWN", "Unknown Bluetooth state", nil)
      }
    }
  }
  
  func centralManager(_ central: CBCentralManager, willRestoreState dict: [String : Any]) {
    print("🔄 Restoring Central Manager state")
    print("🔄 Restore identifier working - state restoration active!")
    print("🔄 Central Manager instance: \(central)")
    print("🔄 Restoration data keys: \(dict.keys)")
    
    // Restore connected peripherals
    if let peripherals = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] {
      connectedPeripherals = peripherals
      print("📱 Restored \(peripherals.count) connected peripherals")

      // TODO: IMPLEMENT TAG VERIFICATION FOR BACKGROUND STATE RESTORATION
      // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
      /*
      // Verify each restored peripheral is user's purchased tag
      for peripheral in peripherals {
        let deviceId = peripheral.identifier.uuidString
        let deviceName = peripheral.name ?? "Unknown"
        
        // This would require a native API call to verify tag ownership
        let isVerified = await verifyTagOwnership(deviceId: deviceId, deviceName: deviceName)
        if !isVerified {
          print("⚠️ Background restoration blocked: Unverified tag detected: \(deviceName)")
          
          // Read location data from nearby tag without full connection
          await readNearbyTagLocation(deviceId: deviceId, deviceName: deviceName)
          
          // Disconnect immediately - don't allow background restoration for unverified tags
          central.cancelPeripheralConnection(peripheral)
          print("✅ Disconnected from unverified restored tag")
          continue // Skip this peripheral
        }
        
        print("✅ Background restoration allowed: Verified tag detected: \(deviceName)")
      }
      */

      // Notify user that restoration occurred (useful when app is backgrounded)
      if !peripherals.isEmpty {
        let names = peripherals.compactMap { $0.name ?? $0.identifier.uuidString }.joined(separator: ", ")
        sendLocalNotificationIfBackground(title: "BLE Restored", body: "Restored \(peripherals.count) device(s): \(names)")
      }
      
      for peripheral in peripherals {
        peripheral.delegate = self
        print("✅ Restored connection to: \(peripheral.name ?? peripheral.identifier.uuidString)")
        
        // Notify JavaScript side about restored connection
        if bondedDeviceIDs.contains(peripheral.identifier.uuidString) {
          let deviceInfo: [String: Any] = [
            "deviceId": peripheral.identifier.uuidString,
            "deviceName": peripheral.name ?? "Unknown",
            "connectionType": "restored"
          ]
          
          // Send device connected event
          DispatchQueue.main.async {
            self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
          }
        }
      }
    }
    
    // Restore scanning state
    if let scanServices = dict[CBCentralManagerRestoredStateScanServicesKey] as? [CBUUID] {
      print("🔍 Was scanning for services: \(scanServices)")
      // If we were scanning before, resume scanning for bonded devices
      if autoConnectEnabled {
        print("🔄 Resuming scan for bonded devices after state restoration")
        startScanning()
      }
    }
    
    // If auto-connect is enabled but we weren't scanning, start scanning
    if autoConnectEnabled && dict[CBCentralManagerRestoredStateScanServicesKey] == nil {
      print("🔍 Auto-connect enabled - starting scan after state restoration")
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
        self.startScanning()
        // Also attempt direct connection to known peripherals shortly after restore
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) {
          self.connectToKnownPeripheralsNative()
        }
      }
    }
  }
  
  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
    let deviceName = peripheral.name ?? "Unknown"
    let deviceId = peripheral.identifier.uuidString
    
    print("🔍 Discovered device: \(deviceName) (\(deviceId)) RSSI: \(RSSI)")
    
    // Store in scanned devices for general scanning
    scannedDevices[deviceId] = peripheral
    
    // Send device found event for general scanning
    let deviceInfo: [String: Any] = [
      "id": deviceId,
      "name": deviceName,
      "rssi": RSSI.intValue,
      "advertisementData": advertisementData
    ]
    
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceFound", body: deviceInfo)
    }
    
    // Special logging for Health Tag or previously bonded devices
    if deviceName == "Health Tag" || bondedDeviceIDs.contains(peripheral.identifier.uuidString) {
      print("🎯 TARGET DEVICE FOUND: \(deviceName) (\(peripheral.identifier.uuidString))")
    }
    
    print("📋 Bonded devices: \(Array(bondedDeviceIDs))")
    print("🔄 Auto-connect enabled: \(autoConnectEnabled)")
    
    // Only print full advertisement data for target devices to reduce log spam
    if deviceName == "Health Tag" || bondedDeviceIDs.contains(peripheral.identifier.uuidString) {
      print("📡 TARGET Advertisement data: \(advertisementData)")
    }
    
    // Check if this is our target device by name AND/or UUID
    
    // Check if device has been forgotten - prevent auto-connection
    if forgottenDeviceIDs.contains(deviceId) {
      print("🚫 Device \(deviceName) (\(deviceId)) has been forgotten - skipping auto-connection")
      print("📱 Current forgotten devices: \(Array(forgottenDeviceIDs))")
      return
    }
    
    // Check if device was manually disconnected - prevent auto-connection during scanning
    if manualDisconnectInProgress.contains(deviceId) {
      print("🔌 Device \(deviceName) (\(deviceId)) was manually disconnected - skipping auto-connection during scan")
      return
    }
    
    // TODO: IMPLEMENT TAG VERIFICATION FOR SCANNING
    // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
    /*
    // Verify if this discovered device is user's purchased tag
    let isVerified = await verifyTagOwnership(deviceId: deviceId, deviceName: deviceName)
    if !isVerified {
      print("⚠️ Scanning blocked: Unverified tag detected: \(deviceName)")
      
      // Read location data from nearby tag without full connection
      await readNearbyTagLocation(deviceId: deviceId, deviceName: deviceName)
      
      // Don't connect to unverified tags
      return
    }
    
    print("✅ Scanning allowed: Verified tag detected: \(deviceName)")
    */
    
    // Only check by UUID (stored bonded devices) - no automatic bonding by name
    let isTargetDevice = bondedDeviceIDs.contains(deviceId)
    
    // Log if we found a Health Tag that's not bonded
    if deviceName == "Health Tag" && !isTargetDevice {
      print("🔍 Found Health Tag by name but not bonded - manual bonding required: \(deviceId)")
    }
    
    guard isTargetDevice else {
      print("⚠️ Device \(deviceName) (\(deviceId)) is not our target")
      print("⚠️ Expected: Health Tag or one of: \(Array(bondedDeviceIDs))")
      return
    }
    
    print("✅ Device is in bonded list!")
    
    // Don't connect if already connected
    guard !connectedPeripherals.contains(peripheral) else {
      print("ℹ️ Device \(peripheral.name ?? "Unknown") already connected")
      return
    }
    
    print("✅ Device is not already connected!")
    
    // Check signal strength (relaxed threshold for debugging)
    guard RSSI.intValue > -90 else {
      print("📶 Signal too weak for \(peripheral.name ?? "Unknown"): \(RSSI) (threshold: -90)")
      return
    }
    
    print("✅ Signal strength acceptable: \(RSSI)")
    
    // Check if we're already trying to connect to this device or already connected
    if connectingPeripherals[deviceId] != nil {
      print("⏳ Already attempting to connect to \(deviceName) - skipping duplicate")
      return
    }
    
    if connectedPeripherals.contains(where: { $0.identifier == peripheral.identifier }) {
      print("✅ Already connected to \(deviceName) - skipping")
      return
    }
    
    print("🔗 Auto-connecting to bonded device: \(deviceName) (RSSI: \(RSSI))")
    
    // Keep a strong reference to the peripheral during connection
    connectingPeripherals[deviceId] = peripheral
    peripheral.delegate = self
    
    // Use connection options recommended by Apple for background operation
    let connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
      // Removed CBConnectPeripheralOptionStartDelayKey as it might cause connection issues
    ]
    central.connect(peripheral, options: connectionOptions)
    
    print("🚀 Connection attempt initiated for \(deviceName) (\(deviceId))")
    print("📊 Connection status: central=\(central.state.rawValue), peripheral=\(peripheral.state.rawValue)")
    print("📊 Currently connecting to \(connectingPeripherals.count) devices")
    print("📊 Currently connected to \(connectedPeripherals.count) devices")
    
    // Set a timeout for connection attempt
    DispatchQueue.main.asyncAfter(deadline: .now() + 15.0) {
      if let connectingPeripheral = self.connectingPeripherals[deviceId] {
        print("⏰ Connection timeout for \(deviceName) after 15 seconds - cancelling")
        central.cancelPeripheralConnection(connectingPeripheral)
        self.connectingPeripherals.removeValue(forKey: deviceId)
        
        // Try to restart scanning for this device
        print("🔄 Restarting scan after timeout...")
        self.startScanning()
      }
    }
  }
  
  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    let deviceId = peripheral.identifier.uuidString
    let deviceName = peripheral.name ?? "Unknown"
    
    print("🔗 Device connected: \(deviceName) (\(deviceId))")
    print("🔍 Connection context: autoConnectEnabled=\(autoConnectEnabled), bonded=\(bondedDeviceIDs.contains(deviceId)), forgotten=\(forgottenDeviceIDs.contains(deviceId))")
    print("🔍 Connecting peripherals: \(connectingPeripherals.keys)")
    print("🔍 Connected peripherals before: \(connectedPeripherals.map { $0.identifier.uuidString })")

    // Check if device has been forgotten - only disconnect if this was an auto-connect
    // Manual connections are allowed and will remove the device from forgotten list
    if forgottenDeviceIDs.contains(deviceId) {
      // Check if this was an auto-connect by looking at connectingPeripherals
      // If the device was in connectingPeripherals, it means we initiated the connection
      let wasAutoConnect = connectingPeripherals[deviceId] != nil
      
      print("🚫 Device \(deviceName) is in forgotten list!")
      print("🔍 Was auto-connect: \(wasAutoConnect) (connectingPeripherals contains: \(connectingPeripherals[deviceId] != nil))")
      
      if wasAutoConnect {
        print("🚫 Device \(deviceName) has been forgotten - disconnecting auto-connect")
        central.cancelPeripheralConnection(peripheral)
        return
      } else {
        print("🔄 Manual connection to forgotten device - removing from forgotten list: \(deviceId)")
        forgottenDeviceIDs.remove(deviceId)
        saveForgottenDevices()
      }
    }

    // TODO: IMPLEMENT TAG VERIFICATION FOR NATIVE AUTO-CONNECT
    // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
    /*
    // Verify if this is user's purchased tag before allowing auto-connect
    // This would require a native API call to verify tag ownership
    let deviceName = peripheral.name ?? deviceId
    let isVerified = await verifyTagOwnership(deviceId: deviceId, deviceName: deviceName)
    if !isVerified {
      print("⚠️ Auto-connect blocked: Unverified tag detected: \(deviceName)")
      
      // Read location data from nearby tag without full connection
      await readNearbyTagLocation(deviceId: deviceId, deviceName: deviceName)
      
      // Disconnect immediately - don't allow auto-connect to unverified tags
      central.cancelPeripheralConnection(peripheral)
      print("✅ Disconnected from unverified auto-connect tag")
      return // Exit early - don't proceed with connection
    }
    
    print("✅ Auto-connect allowed: Verified tag detected: \(deviceName)")
    */

    // Surface a local notification on connect (only when app is in background)
    let notificationDeviceName = peripheral.name ?? deviceId
    sendLocalNotificationIfBackground(title: "Device Connected", body: "Connected to \(notificationDeviceName)")
    
    // Move from connecting to connected
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.append(peripheral)
    
    // Stop scanning since we successfully connected
    central.stopScan()
    isScanning = false
    print("🛑 Stopped scanning after successful connection")
    
    // Cancel any reconnect timer for this device
    if let timer = reconnectTimers[deviceId] {
      timer.invalidate()
      reconnectTimers.removeValue(forKey: deviceId)
    }
    
    // Discover services
    peripheral.discoverServices(nil)
    
    // Resolve connection promise if this was a manual connection
    let promiseKey = "connect_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "status": "connected",
        "deviceId": deviceId,
        "deviceName": peripheral.name ?? "Unknown"
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
    
    // Send connection event
    let deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": peripheral.name ?? "Unknown",
      "connectionType": autoConnectEnabled ? "auto" : "manual"
    ]
    
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceConnected", body: deviceInfo)
    }
    
    // Surface notification for auto-connect
    if autoConnectEnabled {
      let deviceName = peripheral.name ?? deviceId
      sendLocalNotificationIfBackground(title: "Device Connected", body: "Connected to \(deviceName)")
    }
    
    print("✅ Connection event sent successfully")
  }
  
  // MARK: - RCTEventEmitter
  
  override func supportedEvents() -> [String]! {
    return [
      "AutoConnectDeviceConnected", 
      "AutoConnectDeviceDisconnected",
      "DeviceConnected",
      "DeviceDisconnected",
      "DeviceFound",
      "ServicesDiscovered", 
      "CharacteristicsDiscovered",
      "CharacteristicData",
      "DeviceDataUpdated",
      "HealthDataApiRequest",
      "RSSIUpdate"
    ]
  }
  
  override func constantsToExport() -> [AnyHashable : Any]! {
    return ["initialCount": 0]
  }
  
  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    print("❌ Failed to auto-connect to \(peripheral.name ?? "Unknown"): \(error?.localizedDescription ?? "Unknown error")")
    
    // Remove from connecting list
    connectingPeripherals.removeValue(forKey: deviceId)
    
    // Remove from connected list if it was there
    connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
  }
  
  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    print("🔌 Disconnected from: \(peripheral.name ?? peripheral.identifier.uuidString)")
    
    // Remove from both lists
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.removeAll { $0.identifier == peripheral.identifier }
    
    // Clean up any pending service discovery timeout
    if let timer = serviceDiscoveryTimers[deviceId] {
      timer.invalidate()
      serviceDiscoveryTimers.removeValue(forKey: deviceId)
      print("🧹 Cleaned up service discovery timeout for disconnected device: \(deviceId)")
    }
    
    // Cancel any reconnect timer for this device
    if let timer = reconnectTimers[deviceId] {
      timer.invalidate()
      reconnectTimers.removeValue(forKey: deviceId)
      reconnectBackoff.removeValue(forKey: deviceId)
      print("⏰ Cancelled reconnect timer for: \(deviceId)")
    }
    
    // Send disconnection event
    let deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": peripheral.name ?? "Unknown",
      "error": error?.localizedDescription ?? ""
    ]
    
    DispatchQueue.main.async {
      self.sendEvent(withName: "DeviceDisconnected", body: deviceInfo)
    }
    
    // Background-only notification for disconnect
    let nameForNotif = peripheral.name ?? deviceId
    sendLocalNotificationIfBackground(title: "Device Disconnected", body: "Disconnected from \(nameForNotif)")
    
    // Handle auto-reconnection for automatic disconnects (background/out-of-range)
    // Only attempt auto-reconnect if this is NOT a manual disconnect
    if autoConnectEnabled && bondedDeviceIDs.contains(deviceId) {
      // Check if this was a manual disconnect
      let isManualDisconnect = manualDisconnectInProgress.contains(deviceId)
      
      if isManualDisconnect {
        // This was a manual disconnect - keep tracking and don't auto-reconnect
        // Don't remove from manualDisconnectInProgress here - only remove when manual connection is made
        print("🔌 Manual disconnect completed - no auto-reconnection for: \(deviceId)")
      } else {
        // This was an automatic disconnect (background/out-of-range) - attempt auto-reconnect
        print("🔄 Automatic disconnect detected - scheduling auto-reconnection for: \(deviceId)")
        
        // Start scanning for the device
        startScanning()
        
        // Schedule reconnect attempts with backoff
        if reconnectTimers[deviceId] == nil {
          self.reconnectBackoff[deviceId] = 8.0
          let timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
            guard let self = self, self.autoConnectEnabled else { t.invalidate(); return }
            
            // Check if device is forgotten
            if self.forgottenDeviceIDs.contains(deviceId) {
              print("🚫 Device \(deviceId) has been forgotten - stopping reconnect timer")
              t.invalidate()
              self.reconnectTimers.removeValue(forKey: deviceId)
              self.reconnectBackoff.removeValue(forKey: deviceId)
              return
            }
            
            // Check if already connected
            if self.connectedPeripherals.contains(where: { $0.identifier.uuidString == deviceId }) {
              t.invalidate()
              self.reconnectTimers.removeValue(forKey: deviceId)
              self.reconnectBackoff.removeValue(forKey: deviceId)
              return
            }
            
            var next = self.reconnectBackoff[deviceId] ?? 8.0
            if next <= 0 {
              print("🔁 Auto-reconnect attempt for \(deviceId): retrieve + scan, next backoff")
              self.connectToKnownPeripheralsNative()
              self.startScanning()
              // Exponential backoff with cap 60s
              let updated = min((self.reconnectBackoff[deviceId] ?? 8.0) * 2.0, 60.0)
              self.reconnectBackoff[deviceId] = updated
              next = updated
            }
            self.reconnectBackoff[deviceId] = max(0, next - 1.0)
          }
          reconnectTimers[deviceId] = timer
        }
        
        // Also try immediate reconnection attempt
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
          let connectionOptions: [String: Any] = [
            CBConnectPeripheralOptionNotifyOnConnectionKey: true,
            CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
            CBConnectPeripheralOptionNotifyOnNotificationKey: true
          ]
          central.connect(peripheral, options: connectionOptions)
        }
      }
    }
    
    print("✅ Disconnection cleanup completed for: \(deviceId)")
  }
  
  private func startScanning() {
    guard autoConnectEnabled else { 
      print("⚠️ Auto-connect not enabled, skipping scan")
      return 
    }
    
    guard let manager = centralManager else {
      print("⚠️ Central manager not initialized")
      return
    }
    
    guard manager.state == .poweredOn else {
      print("⚠️ Bluetooth not powered on (state: \(manager.state.rawValue))")
      return
    }
    
    print("🔍 Starting native scan for bonded Smart Tag devices")
    print("📋 Will look for devices with service: \(smartTagServiceUUID)")
    print("📋 Bonded device IDs: \(Array(bondedDeviceIDs))")
    
    // Stop any existing scan first
    if manager.isScanning {
      print("🛑 Stopping existing scan before starting new one")
      manager.stopScan()
    }
    
    // In background, iOS only wakes apps reliably for specific service UUIDs; in foreground, allow broad scan
    let isBackground = UIApplication.shared.applicationState == .background
    if isBackground {
      print("🔍 Background scan with service filter: \(smartTagServiceUUID)")
      manager.scanForPeripherals(
        withServices: [smartTagServiceUUID],
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
    } else {
      print("🔍 Foreground broad scan for Health Tag devices")
      manager.scanForPeripherals(
        withServices: nil,
        options: [CBCentralManagerScanOptionAllowDuplicatesKey: false]
      )
    }
    
    print("✅ Native scan started successfully")
  }

  // Attempt direct connections to previously bonded peripherals without scanning (works in background)
  private func connectToKnownPeripheralsNative() {
    guard autoConnectEnabled else { return }
    guard let manager = centralManager else { return }
    guard manager.state == .poweredOn else { return }

    let bonded = getBondedDevicesArray()
    if bonded.isEmpty {
      print("ℹ️ No bonded peripherals to connect (native)")
      return
    }

    let uuids = bonded.compactMap { UUID(uuidString: $0) }
    let knownPeripherals = manager.retrievePeripherals(withIdentifiers: uuids)
    print("🔍 Native retrieved \(knownPeripherals.count) known peripherals from CoreBluetooth")

    var attempted = 0
    for peripheral in knownPeripherals {
      let deviceId = peripheral.identifier.uuidString
      if peripheral.state != .connected && connectingPeripherals[deviceId] == nil {
        let name = peripheral.name ?? deviceId
        print("🔗 (Native) Connecting to known peripheral: \(name)")
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

    if attempted > 0 {
      sendLocalNotificationIfBackground(title: "Connecting", body: "Attempting to connect to \(attempted) known device(s)")
    }
  }
  
  // MARK: - CBPeripheralDelegate
  
  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    print("🔍 Discovered services for device: \(deviceId)")
    
    // Cancel timeout timer since service discovery completed
    if let timer = serviceDiscoveryTimers[deviceId] {
      timer.invalidate()
      serviceDiscoveryTimers.removeValue(forKey: deviceId)
      print("✅ Service discovery timeout cancelled for device: \(deviceId)")
    }
    
    if let error = error {
      print("❌ Service discovery error: \(error.localizedDescription)")
      let promiseKey = "discover_services_\(deviceId)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("SERVICE_DISCOVERY_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    guard let services = peripheral.services else {
      print("⚠️ No services found")
      let promiseKey = "discover_services_\(deviceId)"
      if let resolver = pendingPromises[promiseKey] {
        resolver(["services": []])
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    print("✅ Found \(services.count) services")
    
    // Store services
    deviceServices[deviceId] = services
    
    // Discover characteristics for each service
    for service in services {
      print("🔍 Discovering characteristics for service: \(service.uuid)")
      peripheral.discoverCharacteristics(nil, for: service)
    }
    
    // Send services discovered event
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
    
    // Resolve the service discovery promise
    let promiseKey = "discover_services_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      resolver(["services": serviceInfo])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
  }
  
  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    print("🔍 Discovered characteristics for service: \(service.uuid)")
    
    if let error = error {
      print("❌ Characteristic discovery error: \(error.localizedDescription)")
      return
    }
    
    guard let characteristics = service.characteristics else {
      print("⚠️ No characteristics found for service: \(service.uuid)")
      return
    }
    
    print("✅ Found \(characteristics.count) characteristics for service: \(service.uuid)")
    
    // Store characteristics
    if deviceCharacteristics[deviceId] == nil {
      deviceCharacteristics[deviceId] = []
    }
    deviceCharacteristics[deviceId]?.append(contentsOf: characteristics)
    
    // Enable notifications for important characteristics (Android-style approach)
    for characteristic in characteristics {
      let charUuid = characteristic.uuid.uuidString
      print("📋 Characteristic: \(charUuid)")
      
      // Enable notifications for important characteristics
      if charUuid == DEVICE_STATUS_CHAR_UUID.uuidString ||
         charUuid == BATTERY_LEVEL_CHAR_UUID.uuidString {
        print("🔔 Enabling notifications for characteristic: \(charUuid)")
        peripheral.setNotifyValue(true, for: characteristic)
      }
    }
    
    // Send characteristic discovered event
    let characteristicInfo = characteristics.map { characteristic in
      return [
        "uuid": characteristic.uuid.uuidString,
        "serviceUUID": service.uuid.uuidString,
        "properties": characteristic.properties.rawValue,
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
    
    // Request initial data immediately (Android-style approach)
    print("📊 Characteristic discovery complete, requesting device data for: \(deviceId)")
    requestDeviceData(deviceId: deviceId)
  }
  
  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    let deviceId = peripheral.identifier.uuidString
    let characteristicUuid = characteristic.uuid.uuidString
    
    if let error = error {
      print("❌ Characteristic read error: \(error.localizedDescription)")
      let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("CHARACTERISTIC_READ_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    guard let data = characteristic.value else {
      print("⚠️ No data received for characteristic: \(characteristicUuid)")
      let promiseKey = "read_\(deviceId)_\(characteristicUuid)"
      if let resolver = pendingPromises[promiseKey] {
        resolver(["data": "", "hex": ""])
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    let hexString = dataToHexString(data)
    print("📖 Read characteristic \(characteristicUuid): \(hexString)")
    
    // Handle characteristic data using Android-style approach
    handleCharacteristicData(deviceId: deviceId, characteristic: characteristic, data: data)
    
    // Resolve promise if this was a read request
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
    
    // Send characteristic data event for notifications (keep for backward compatibility)
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
      print("❌ Characteristic write error: \(error.localizedDescription)")
      let promiseKey = "write_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("CHARACTERISTIC_WRITE_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    print("✅ Write successful for characteristic: \(characteristicUuid)")
    
    // Resolve promise
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
      print("❌ Notification state update error: \(error.localizedDescription)")
      let promiseKey = "notify_\(deviceId)_\(characteristicUuid)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("NOTIFICATION_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    print("🔔 Notification state updated for characteristic: \(characteristicUuid) - isNotifying: \(characteristic.isNotifying)")
    
    // Resolve promise
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
    
    if let error = error {
      print("❌ RSSI read error: \(error.localizedDescription)")
      let promiseKey = "rssi_\(deviceId)"
      if let rejecter = pendingRejecters[promiseKey] {
        rejecter("RSSI_READ_ERROR", error.localizedDescription, error)
        pendingPromises.removeValue(forKey: promiseKey)
        pendingRejecters.removeValue(forKey: promiseKey)
      }
      return
    }
    
    print("📶 RSSI for device \(deviceId): \(RSSI)")
    
    // Resolve promise
    let promiseKey = "rssi_\(deviceId)"
    if let resolver = pendingPromises[promiseKey] {
      resolver([
        "rssi": RSSI.intValue,
        "deviceId": deviceId
      ])
      pendingPromises.removeValue(forKey: promiseKey)
      pendingRejecters.removeValue(forKey: promiseKey)
    }
    
    // Send RSSI update event
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

  // MARK: - Local Notification Helpers

  private func requestNotificationPermissionsIfNeeded() {
    let center = UNUserNotificationCenter.current()
    center.getNotificationSettings { settings in
      guard settings.authorizationStatus == .notDetermined else { return }
      center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
        if let error = error {
          print("⚠️ Notification permission error: \(error.localizedDescription)")
        } else {
          print("🔔 Notification permission granted: \(granted)")
        }
      }
    }
  }

  private func sendLocalNotification(title: String, body: String) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.sound = .default

    // Fire immediately
    let request = UNNotificationRequest(
      identifier: "ble.autoconnect.notification.\(UUID().uuidString)",
      content: content,
      trigger: nil
    )

    UNUserNotificationCenter.current().add(request) { error in
      if let error = error {
        print("⚠️ Failed to schedule local notification: \(error.localizedDescription)")
      } else {
        print("🔔 Local notification scheduled: \(title) - \(body)")
      }
    }
  }

  private func sendLocalNotificationIfBackground(title: String, body: String) {
    DispatchQueue.main.async {
      if UIApplication.shared.applicationState == .background {
        self.sendLocalNotification(title: title, body: body)
      } else {
        print("🔔 Skipping notification (app not in background): \(title) - \(body)")
      }
    }
  }
}
