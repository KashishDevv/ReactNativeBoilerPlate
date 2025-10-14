import Foundation
import React

/// Transaction Manager for iOS BLE Operations
/// Provides centralized timeout handling, operation tracking, and cancellation support
/// Based on Android's TransactionManager implementation
class TransactionManager {
    
    private struct TransactionInfo {
        let promise: (resolve: RCTPromiseResolveBlock, reject: RCTPromiseRejectBlock)
        let operationType: String
        let deviceId: String
        let startTime: Date
        let timeoutSeconds: TimeInterval
        var timeoutWorkItem: DispatchWorkItem?
    }
    
    private var pendingTransactions: [String: TransactionInfo] = [:]
    private let queue = DispatchQueue(label: "com.ble.transactionmanager", qos: .userInitiated)
    private var isShutdown = false
    
    /// Add a new transaction with automatic timeout
    func addTransaction(
        id: String,
        resolve: @escaping RCTPromiseResolveBlock,
        reject: @escaping RCTPromiseRejectBlock,
        operationType: String,
        deviceId: String,
        timeout: TimeInterval = 10.0
    ) {
        queue.async { [weak self] in
            guard let self = self else { return }
            
            if self.isShutdown {
                reject("SHUTDOWN", "TransactionManager is shutdown", nil)
                return
            }
            
            // Create timeout work item
            let timeoutItem = DispatchWorkItem { [weak self] in
                self?.queue.async {
                    if let transaction = self?.pendingTransactions.removeValue(forKey: id) {
                        let errorMessage = "\(operationType) operation timed out after \(timeout)s for device \(deviceId)"
                        transaction.promise.reject("TIMEOUT", errorMessage, nil)
                        NSLog("⏱️ [TransactionManager] Transaction timeout: \(id)")
                    }
                }
            }
            
            var info = TransactionInfo(
                promise: (resolve: resolve, reject: reject),
                operationType: operationType,
                deviceId: deviceId,
                startTime: Date(),
                timeoutSeconds: timeout,
                timeoutWorkItem: timeoutItem
            )
            
            self.pendingTransactions[id] = info
            
            // Schedule timeout
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout, execute: timeoutItem)
            
            NSLog("✅ [TransactionManager] Added transaction: \(id) (\(operationType)) timeout: \(timeout)s")
        }
    }
    
    /// Resolve a transaction with success result
    @discardableResult
    func resolveTransaction(id: String, result: Any) -> Bool {
        var resolved = false
        queue.sync {
            if let transaction = pendingTransactions.removeValue(forKey: id) {
                transaction.timeoutWorkItem?.cancel()
                transaction.promise.resolve(result)
                resolved = true
                NSLog("✅ [TransactionManager] Resolved transaction: \(id)")
            } else {
                NSLog("⚠️ [TransactionManager] Transaction not found for resolution: \(id)")
            }
        }
        return resolved
    }
    
    /// Reject a transaction with error
    @discardableResult
    func rejectTransaction(id: String, code: String, message: String) -> Bool {
        var rejected = false
        queue.sync {
            if let transaction = pendingTransactions.removeValue(forKey: id) {
                transaction.timeoutWorkItem?.cancel()
                transaction.promise.reject(code, message, nil)
                rejected = true
                NSLog("❌ [TransactionManager] Rejected transaction: \(id) - \(message)")
            } else {
                NSLog("⚠️ [TransactionManager] Transaction not found for rejection: \(id)")
            }
        }
        return rejected
    }
    
    /// Reject transaction with BLEError
    @discardableResult
    func rejectTransaction(id: String, error: BLEError) -> Bool {
        return rejectTransaction(id: id, code: error.errorCode.rawValue, message: error.reason)
    }
    
    /// Cancel a specific transaction
    @discardableResult
    func cancelTransaction(id: String) -> Bool {
        var cancelled = false
        queue.sync {
            if let transaction = pendingTransactions.removeValue(forKey: id) {
                transaction.timeoutWorkItem?.cancel()
                let message = "\(transaction.operationType) operation was cancelled for device \(transaction.deviceId)"
                transaction.promise.reject("CANCELLED", message, nil)
                cancelled = true
                NSLog("🚫 [TransactionManager] Cancelled transaction: \(id)")
            }
        }
        return cancelled
    }
    
    /// Cancel all transactions for a specific device
    func cancelAllForDevice(deviceId: String) -> Int {
        var cancelledCount = 0
        queue.sync {
            let deviceTransactions = pendingTransactions.filter { $0.value.deviceId == deviceId }
            for (id, transaction) in deviceTransactions {
                transaction.timeoutWorkItem?.cancel()
                let message = "\(transaction.operationType) operation cancelled - device disconnected"
                transaction.promise.reject("DEVICE_DISCONNECTED", message, nil)
                pendingTransactions.removeValue(forKey: id)
                cancelledCount += 1
            }
            
            if cancelledCount > 0 {
                NSLog("🚫 [TransactionManager] Cancelled \(cancelledCount) transactions for device: \(deviceId)")
            }
        }
        return cancelledCount
    }
    
    /// Cancel all pending transactions
    func cancelAllTransactions() -> Int {
        var cancelledCount = 0
        queue.sync {
            cancelledCount = pendingTransactions.count
            for (id, transaction) in pendingTransactions {
                transaction.timeoutWorkItem?.cancel()
                transaction.promise.reject("CANCELLED", "Transaction cancelled - manager shutdown", nil)
            }
            pendingTransactions.removeAll()
            
            if cancelledCount > 0 {
                NSLog("🚫 [TransactionManager] Cancelled all \(cancelledCount) transactions")
            }
        }
        return cancelledCount
    }
    
    /// Check if a transaction exists
    func hasTransaction(id: String) -> Bool {
        var exists = false
        queue.sync {
            exists = pendingTransactions.keys.contains(id)
        }
        return exists
    }
    
    /// Get transaction count
    func getTransactionCount() -> Int {
        var count = 0
        queue.sync {
            count = pendingTransactions.count
        }
        return count
    }
    
    /// Get transaction count for specific device
    func getTransactionCountForDevice(deviceId: String) -> Int {
        var count = 0
        queue.sync {
            count = pendingTransactions.filter { $0.value.deviceId == deviceId }.count
        }
        return count
    }
    
    /// Get transaction statistics
    func getStatistics() -> [String: Any] {
        var stats: [String: Any] = [:]
        queue.sync {
            var byDevice: [String: Int] = [:]
            var byOperation: [String: Int] = [:]
            
            for transaction in pendingTransactions.values {
                byDevice[transaction.deviceId, default: 0] += 1
                byOperation[transaction.operationType, default: 0] += 1
            }
            
            stats = [
                "totalPending": pendingTransactions.count,
                "byDevice": byDevice,
                "byOperation": byOperation
            ]
        }
        return stats
    }
    
    /// Shutdown the transaction manager
    func shutdown() {
        queue.sync {
            if !isShutdown {
                isShutdown = true
                cancelAllTransactions()
                NSLog("🛑 [TransactionManager] Shutdown complete")
            }
        }
    }
    
    // MARK: - Transaction ID Generators
    
    static func generateTransactionId(operationType: String, deviceId: String) -> String {
        let timestamp = Date().timeIntervalSince1970
        return "\(operationType)_\(deviceId)_\(timestamp)"
    }
    
    static func generateReadTransactionId(deviceId: String, characteristicUuid: String) -> String {
        let timestamp = Date().timeIntervalSince1970
        return "READ_\(deviceId)_\(characteristicUuid)_\(timestamp)"
    }
    
    static func generateWriteTransactionId(deviceId: String, characteristicUuid: String) -> String {
        let timestamp = Date().timeIntervalSince1970
        return "WRITE_\(deviceId)_\(characteristicUuid)_\(timestamp)"
    }
    
    static func generateServiceDiscoveryTransactionId(deviceId: String) -> String {
        let timestamp = Date().timeIntervalSince1970
        return "SERVICE_DISCOVERY_\(deviceId)_\(timestamp)"
    }
    
    static func generateConnectionTransactionId(deviceId: String) -> String {
        let timestamp = Date().timeIntervalSince1970
        return "CONNECTION_\(deviceId)_\(timestamp)"
    }
}

