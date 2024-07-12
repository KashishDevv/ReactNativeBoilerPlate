import Foundation
import AVFoundation

@objc(BridgingCodeModule)
class BridgingCodeModule: NSObject {
  
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
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
