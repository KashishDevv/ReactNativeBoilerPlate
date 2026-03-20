//
//  BridgingCodeModule.mm
//  Obj-C++ TurboModule registration for BridgingCodeModule (Swift implementation).
//  Uses RCT_EXTERN_MODULE to bridge Swift methods and satisfies the codegen-generated
//  TurboModule spec when RCT_NEW_ARCH_ENABLED=1.
//

#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

// Import codegen-generated spec when available (after `pod install` with RCT_NEW_ARCH_ENABLED=1)
#if __has_include("BridgingCodeModule/BridgingCodeModule.h")
#import "BridgingCodeModule/BridgingCodeModule.h"
#endif

@interface
RCT_EXTERN_MODULE(BridgingCodeModule, RCTEventEmitter)

// MARK: - White-label Config
RCT_EXTERN_METHOD(getBLEClientConfig:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - BLE Core
RCT_EXTERN_METHOD(requestPermissions:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isBLEReady:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startScanning:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startScanningWithOptions:(NSDictionary*)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopScanning:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Power Profile
RCT_EXTERN_METHOD(setPowerProfile:(NSString*)profileName resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getCurrentPowerProfile:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Connection
RCT_EXTERN_METHOD(connectToDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(connectToDeviceWithOptions:(NSString*)deviceId options:(NSDictionary*)options resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnectFromDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readCharacteristic:(NSString*)deviceId characteristicUuid:(NSString*)characteristicUuid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(writeCharacteristic:(NSString*)deviceId characteristicUuid:(NSString*)characteristicUuid data:(NSString*)data resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(enableNotifications:(NSString*)deviceId characteristicUuid:(NSString*)characteristicUuid resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(discoverServices:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readRSSI:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - System Commands
RCT_EXTERN_METHOD(sendSystemCommand:(NSString*)deviceId commandId:(NSNumber*)commandId payload:(NSArray*)payload resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startCommandSequence:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startDataSync:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(startDataSyncWithRecordCount:(NSString*)deviceId recordCount:(NSInteger)recordCount resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readDeviceStatus:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getDataSyncState:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getManufacturerInfo:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(updatePasskey:(NSString*)deviceId passkey:(NSString*)passkey resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Auto-Connect
RCT_EXTERN_METHOD(startAutoConnect:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopAutoConnect:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(addBondedDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeBondedDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getBondedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getForgottenDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getAutoConnectStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(forceScanForBondedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(debugConnectionStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(connectToKnownPeripherals:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnectFromNative:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getResourceStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - DFU
RCT_EXTERN_METHOD(startMcuMgrDfu:(NSString*)deviceId firmwarePath:(NSString*)firmwarePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelMcuMgrDfu:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

// MARK: - Android-specific stubs (iOS returns platform error; calls are guarded by Platform.OS === 'android' in JS)
RCT_EXTERN_METHOD(refreshSystemConnectedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readDeviceRSSI:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(cancelConnection:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getDeviceServices:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(monitorCharacteristicForService:(NSString*)deviceId serviceUUID:(NSString*)serviceUUID characteristicUUID:(NSString*)characteristicUUID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(readCharacteristicForService:(NSString*)deviceId serviceUUID:(NSString*)serviceUUID characteristicUUID:(NSString*)characteristicUUID resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(isDeviceBonded:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(initiateSecurePairing:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(openBluetoothSettings:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(triggerHealthDataApiCall:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopHealthDataApiMonitoring:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(onAppStateChanged:(NSString*)state resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

@end
