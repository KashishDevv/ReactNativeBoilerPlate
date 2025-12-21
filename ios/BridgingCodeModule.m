//
//  BridgingCodeModule.m
//  Updated for Turbo Module support - all methods now use Promises
//
#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

@interface
RCT_EXTERN_MODULE(BridgingCodeModule, NSObject)
// Updated to use Promises instead of callbacks
RCT_EXTERN_METHOD(passString:(NSString*)str resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(bothClassifyAndCallback:(NSString*)img resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(makeApiCall:(NSString*)url resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
// Android-compatible methods
RCT_EXTERN_METHOD(showToast:(NSString*)message)
RCT_EXTERN_METHOD(examplePayment:(NSString*)strStart donationId:(NSString*)donationId resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
RCT_EXTERN_METHOD(callExampleApi:(NSString*)url resolve:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject)
@end
