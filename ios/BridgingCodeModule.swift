import Foundation
import AVFoundation
import React

@objc(BridgingCodeModule)
class BridgingCodeModule: NSObject {
  
  // Updated to use Promises instead of callbacks for Turbo Module support
  @objc(passString:resolve:reject:)
  func passString(str: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    print("The entered string Value is", str)
    resolve(str)
  }
  
  @objc(bothClassifyAndCallback:resolve:reject:)
  func bothClassifyAndCallback(_ img: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    print("The entered string Value is", img)
    resolve(img)
  }
  
  @objc(makeApiCall:resolve:reject:)
  func makeApiCall(url: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
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
      
      resolve(responseString)
    }
    
    task.resume()
  }
  
  // Android-compatible methods (for unified API)
  @objc(showToast:)
  func showToast(_ message: String) {
    print("Toast (iOS): \(message)")
  }
  
  @objc(examplePayment:donationId:resolve:reject:)
  func examplePayment(_ strStart: String, donationId: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    print("BridgingCodeModule: examplePayment called with: \(strStart), \(donationId)")
    resolve([strStart, donationId])
  }
  
  @objc(callExampleApi:resolve:reject:)
  func callExampleApi(_ url: String, resolve: @escaping RCTPromiseResolveBlock, reject: @escaping RCTPromiseRejectBlock) {
    guard let requestUrl = URL(string: url) else {
      resolve(["Error", "Invalid URL"])
      return
    }
    
    let task = URLSession.shared.dataTask(with: requestUrl) { (data, response, error) in
      if let error = error {
        resolve(["Error", error.localizedDescription])
        return
      }
      
      guard let data = data, let responseString = String(data: data, encoding: .utf8) else {
        resolve(["Error", "Unable to fetch data"])
        return
      }
      
      resolve(["Success", responseString])
    }
    
    task.resume()
  }
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return true
  }
}
