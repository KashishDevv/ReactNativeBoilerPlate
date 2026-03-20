//
//  DefaultBLEClientConfig.swift
//  ReactNativeBoilerPlate
//
//  Default BLE config with current DyreID values. Behavior unchanged when no scheme-specific config is used.
//

import Foundation
import CoreBluetooth

/// Default BLE config with current DyreID values.
final class DefaultBLEClientConfig: BLEClientConfig {
    var smartTagServiceUUID: CBUUID {
        CBUUID(string: "0f0e0d0c-0b0a-0908-0706-050403020100")
    }
    var manufacturerId: UInt16 { 0x1234 }
    var acceptedDeviceNamePatterns: [String] { ["DyreID", "Health Tag"] }
    var defaultPasskey: String? { nil }
    var brandName: String { "DyreID" }
}
