//
//  BridgingCodeModule.m
 
#import <Foundation/Foundation.h>
#import "React/RCTBridgeModule.h"

@interface
RCT_EXTERN_MODULE(BridgingCodeModule, NSObject)
RCT_EXTERN_METHOD(passString:(NSString*)str resolver: (RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(bothClassifyAndCallback: (NSString*)img resolver12: (RCTResponseSenderBlock)callback)
RCT_EXTERN_METHOD(makeApiCall:(NSString*)url resolver: (RCTPromiseResolveBlock)resolve rejecter: (RCTPromiseRejectBlock)reject)
@end

 
