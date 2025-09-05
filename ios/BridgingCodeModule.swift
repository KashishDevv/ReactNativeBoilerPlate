import Foundation
import AVFoundation
import CoreBluetooth
import React
import UserNotifications
import UIKit

@objc(BridgingCodeModule)
class BridgingCodeModule: RCTEventEmitter, CBCentralManagerDelegate, CBPeripheralDelegate {
  
  // Auto-connect properties
  private var centralManager: CBCentralManager?
  private var connectedPeripherals: [CBPeripheral] = []
  private var connectingPeripherals: [String: CBPeripheral] = [:] // Keep strong references during connection
  private var bondedDeviceIDs: Set<String> = []
  private var autoConnectEnabled: Bool = false
  private let smartTagServiceUUID = CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
  private var reconnectTimers: [String: Timer] = [:]
  private var reconnectBackoff: [String: TimeInterval] = [:]
  private var manualDisconnectCooldown: Set<String> = []
  
  // Callbacks for React Native events
  private var onDeviceConnectedCallback: RCTResponseSenderBlock?
  private var onDeviceDisconnectedCallback: RCTResponseSenderBlock?
  private var onAutoConnectStatusCallback: RCTResponseSenderBlock?
  
  override init() {
    super.init()
    loadBondedDevices()
    print("🏁 BridgingCodeModule initialized with \(bondedDeviceIDs.count) bonded devices")
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
  
  @objc(passString:resolver:)
  func passString(str: String, resolver callback: RCTResponseSenderBlock) {
    print("The entered string Value is", str)
    return callback([str])
  }
  
  @objc(bothClassifyAndCallback:resolver12:)
  func bothClassifyAndCallback(_ img: String, resolver12 callback: RCTResponseSenderBlock) {
    print("The entered string Value is", img)
    return callback([img])
  }
  
  @objc(makeApiCall:resolver:rejecter:)
  func makeApiCall(url: String, resolver callback: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let requestUrl = URL(string: url) else {
      reject("Invalid URL", "The provided URL is invalid", nil)
      return
    }
    
    let task = URLSession.shared.dataTask(with: requestUrl) { (data, response, error) in
      if let error = error {
        reject("Network Error", error.localizedDescription, error)
        return
      }
      
      guard let data = data, let responseString = String(data: data, encoding: .utf8) else {
        reject("Data Error", "Unable to fetch data", nil)
        return
      }
      
      callback(responseString)
    }
    
    task.resume()
  }
  
  // MARK: - Auto-Connect Methods
  
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
    
    // Disconnect all peripherals
    for peripheral in connectedPeripherals {
      centralManager?.cancelPeripheralConnection(peripheral)
    }
    connectedPeripherals.removeAll()

    // Invalidate any reconnect timers
    for (_, timer) in reconnectTimers { timer.invalidate() }
    reconnectTimers.removeAll()
    
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
    
    bondedDeviceIDs.remove(deviceId)
    saveBondedDevices()
    
    resolve(["deviceId": deviceId, "status": "removed"])
  }
  
  // Private helper method to get bonded devices array
  private func getBondedDevicesArray() -> [String] {
    if let devices = UserDefaults.standard.array(forKey: "BondedSmartTagDevices") as? [String] {
      return devices
    }
    return []
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
  
  @objc(ensureCallbacksRegistered:rejecter:)
  func ensureCallbacksRegistered(resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    // This method ensures callbacks are properly linked
    print("🔗 Ensuring callbacks are registered with native module")
    
    // The callbacks are already set in the stored properties
    if onDeviceConnectedCallback != nil {
      print("✅ Device connected callback is registered")
    } else {
      print("⚠️ Device connected callback is nil - setting up DeviceEventEmitter")
    }
    
    resolve(["callbackRegistered": onDeviceConnectedCallback != nil])
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
      
      // Add device to manual disconnect cooldown list to prevent immediate reconnection
      manualDisconnectCooldown.insert(deviceId)
      print("⏰ Added \(deviceId) to manual disconnect cooldown list")
      
      // Remove from cooldown after 30 seconds
      DispatchQueue.main.asyncAfter(deadline: .now() + 30.0) {
        self.manualDisconnectCooldown.remove(deviceId)
        print("✅ Removed \(deviceId) from manual disconnect cooldown list")
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
  
  // MARK: - CBCentralManagerDelegate
  
  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    print("📡 Central Manager state: \(central.state.rawValue)")
    
    switch central.state {
    case .poweredOn:
      print("🔵 Bluetooth is powered on")
      print("📋 Bonded devices on power on: \(Array(bondedDeviceIDs))")
      
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
    case .resetting:
      print("🟡 Bluetooth is resetting")
      connectedPeripherals.removeAll()
    case .unauthorized:
      print("🟠 Bluetooth is unauthorized")
    case .unsupported:
      print("⚫ Bluetooth is unsupported")
    case .unknown:
      print("❓ Bluetooth state is unknown")
    @unknown default:
      print("❓ Unknown Bluetooth state")
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
          
          if let onConnected = self.onDeviceConnectedCallback {
            onConnected([deviceInfo])
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
    print("🔍 Native discovered device: \(deviceName) (\(peripheral.identifier.uuidString)) RSSI: \(RSSI)")
    
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
    let deviceId = peripheral.identifier.uuidString
    
    // Check if device is in manual disconnect cooldown - prevent immediate reconnection
    if manualDisconnectCooldown.contains(deviceId) {
      print("⏰ Device \(deviceName) (\(deviceId)) is in manual disconnect cooldown - skipping reconnection")
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
    
    // First check by UUID (stored bonded devices)
    var isTargetDevice = bondedDeviceIDs.contains(deviceId)
    
    // If not found by UUID, also check by device name (more reliable for Health Tag)
    if !isTargetDevice && deviceName == "Health Tag" {
      print("🔍 Found Health Tag by name, adding to bonded list: \(deviceId)")
      bondedDeviceIDs.insert(deviceId)
      saveBondedDevices()
      isTargetDevice = true
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
    print("✅ Auto-connected to: \(peripheral.name ?? peripheral.identifier.uuidString)")

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
    let deviceName = peripheral.name ?? deviceId
    sendLocalNotificationIfBackground(title: "Device Connected", body: "Connected to \(deviceName)")
    
    // Move from connecting to connected
    connectingPeripherals.removeValue(forKey: deviceId)
    connectedPeripherals.append(peripheral)
    
    // Stop scanning since we successfully connected
    central.stopScan()
    print("🛑 Stopped scanning after successful connection")

    // Cancel any reconnect timer for this device
    if let timer = reconnectTimers[deviceId] {
      timer.invalidate()
      reconnectTimers.removeValue(forKey: deviceId)
    }
    
    // Discover services
    peripheral.discoverServices([smartTagServiceUUID])
    
    // Notify React Native using DeviceEventEmitter (more reliable than callbacks)
    let deviceInfo: [String: Any] = [
      "deviceId": deviceId,
      "deviceName": peripheral.name ?? "Unknown",
      "connectionType": "auto"
    ]
    
    print("📤 Sending auto-connect event via RCTEventEmitter: \(deviceInfo)")
    
    // Send event to JavaScript using RCTEventEmitter
    DispatchQueue.main.async {
      self.sendEvent(withName: "AutoConnectDeviceConnected", body: deviceInfo)
    }
    
    print("✅ Auto-connect event sent successfully")
  }
  
  // MARK: - RCTEventEmitter
  
  override func supportedEvents() -> [String]! {
    return ["AutoConnectDeviceConnected", "AutoConnectDeviceDisconnected"]
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
    
    // Notify React Native via RCTEventEmitter (consistent with connect event)
    let deviceInfo: [String: Any] = [
      "deviceId": peripheral.identifier.uuidString,
      "deviceName": peripheral.name ?? "Unknown",
      "error": error?.localizedDescription ?? ""
    ]
    DispatchQueue.main.async {
      self.sendEvent(withName: "AutoConnectDeviceDisconnected", body: deviceInfo)
    }
    // Background-only notification for disconnect
    let nameForNotif = peripheral.name ?? deviceId
    sendLocalNotificationIfBackground(title: "Device Disconnected", body: "Disconnected from \(nameForNotif)")

    // Proactively resume scanning and schedule periodic reconnect attempts
    if autoConnectEnabled {
      print("🔄 Scheduling reconnect attempts and resuming scan after disconnect")
      startScanning()
      if reconnectTimers[deviceId] == nil {
        self.reconnectBackoff[deviceId] = 8.0
        let timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] t in
          guard let self = self, self.autoConnectEnabled else { t.invalidate(); return }
          if self.connectedPeripherals.contains(where: { $0.identifier.uuidString == deviceId }) {
            t.invalidate()
            self.reconnectTimers.removeValue(forKey: deviceId)
            self.reconnectBackoff.removeValue(forKey: deviceId)
            return
          }
          var next = self.reconnectBackoff[deviceId] ?? 8.0
          if next <= 0 {
            print("🔁 Reconnect attempt for \(deviceId): retrieve + scan, next backoff")
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
    }
    
    // Try to reconnect if auto-connect is enabled and this was an unexpected disconnect
    if autoConnectEnabled && bondedDeviceIDs.contains(peripheral.identifier.uuidString) {
      print("🔄 Attempting to reconnect to bonded device...")
      DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) {
        // Use connection options for background connection
    let connectionOptions: [String: Any] = [
      CBConnectPeripheralOptionNotifyOnConnectionKey: true,
      CBConnectPeripheralOptionNotifyOnDisconnectionKey: true,
      CBConnectPeripheralOptionNotifyOnNotificationKey: true
    ]
    central.connect(peripheral, options: connectionOptions)
      }
    }
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
      
      // Check if device is in manual disconnect cooldown - prevent immediate reconnection
      if manualDisconnectCooldown.contains(deviceId) {
        print("⏰ Device \(peripheral.name ?? deviceId) (\(deviceId)) is in manual disconnect cooldown - skipping reconnection")
        continue
      }
      
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
    guard let services = peripheral.services else { return }
    
    for service in services {
      print("🔍 Discovered service: \(service.uuid)")
      // You can add characteristic discovery here if needed
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
