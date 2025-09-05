//
//  BridgingCodeModule.m
 
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface
RCT_EXTERN_MODULE(BridgingCodeModule, NSObject)
RCT_EXTERN_METHOD(passString:(NSString*)str resolver: (RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(bothClassifyAndCallback: (NSString*)img resolver12: (RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(makeApiCall:(NSString*)url resolver: (RCTPromiseResolveBlock)resolve rejecter: (RCTPromiseRejectBlock)reject)

// Auto-Connect methods
RCT_EXTERN_METHOD(startAutoConnect:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(stopAutoConnect:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(addBondedDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(removeBondedDevice:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getBondedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(getAutoConnectStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(forceScanForBondedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(ensureCallbacksRegistered:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(debugConnectionStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(connectToKnownPeripherals:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(disconnectFromNative:(NSString*)deviceId resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject)
@end
