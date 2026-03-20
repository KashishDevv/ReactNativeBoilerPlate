//
//  BLEClientConfig.swift
//  ReactNativeBoilerPlate
//
//  BLE white-label: client/brand-specific configuration protocol and holder.
//

import Foundation
import CoreBluetooth

/// Client/brand-specific BLE configuration for white-label support.
/// Core BLE logic uses this protocol instead of hardcoded UUIDs, manufacturer ID, or device name patterns.
protocol BLEClientConfig: AnyObject {
    /// GATT service UUID used to identify "smart tag" / supported devices.
    var smartTagServiceUUID: CBUUID { get }
    /// Manufacturer company ID used in BLE advertisement data (e.g. 0x1234).
    var manufacturerId: UInt16 { get }
    /// Device name substrings that identify accepted devices (e.g. "DyreID", "Health Tag").
    var acceptedDeviceNamePatterns: [String] { get }
    /// Optional default 6-digit passkey for pairing. Nil = use device/flow default.
    var defaultPasskey: String? { get }
    /// Human-readable brand name for logs and notifications (e.g. "DyreID").
    var brandName: String { get }
}

/// Holder so BridgingCodeModule (and tests) can resolve config without passing it everywhere.
enum BLEClientConfigHolder {
    private static var _config: BLEClientConfig?
    static func set(_ config: BLEClientConfig) { _config = config }
    static func get() -> BLEClientConfig? { _config }
}
