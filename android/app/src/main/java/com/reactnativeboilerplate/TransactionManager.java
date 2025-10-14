package com.reactnativeboilerplate;

import android.util.Log;
import com.facebook.react.bridge.Promise;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Transaction Manager for BLE operations
 * Provides timeout handling, operation tracking, and cancellation support
 * Based on React Native BLE PLX transaction management patterns
 */
public class TransactionManager {
    private static final String TAG = "TransactionManager";
    
    // Transaction storage
    private final ConcurrentHashMap<String, TransactionInfo> pendingTransactions = new ConcurrentHashMap<>();
    
    // Executor for timeout handling
    private final ScheduledExecutorService timeoutExecutor = Executors.newScheduledThreadPool(2);
    
    // Transaction counter for unique IDs
    private final AtomicBoolean isShutdown = new AtomicBoolean(false);
    
    /**
     * Transaction information container
     */
    private static class TransactionInfo {
        public final Promise promise;
        public final String operationType;
        public final String deviceId;
        public final long startTime;
        public final long timeoutMs;
        
        public TransactionInfo(Promise promise, String operationType, String deviceId, long timeoutMs) {
            this.promise = promise;
            this.operationType = operationType;
            this.deviceId = deviceId;
            this.startTime = System.currentTimeMillis();
            this.timeoutMs = timeoutMs;
        }
        
        public boolean isTimedOut() {
            return System.currentTimeMillis() - startTime > timeoutMs;
        }
    }
    
    /**
     * Add a new transaction with timeout
     * @param transactionId Unique transaction identifier
     * @param promise Promise to resolve/reject
     * @param operationType Type of operation (for logging)
     * @param deviceId Device ID (for context)
     * @param timeoutMs Timeout in milliseconds
     */
    public void addTransaction(String transactionId, Promise promise, String operationType, String deviceId, long timeoutMs) {
        if (isShutdown.get()) {
            Log.w(TAG, "TransactionManager is shutdown, rejecting transaction: " + transactionId);
            promise.reject("SHUTDOWN", "TransactionManager is shutdown");
            return;
        }
        
        TransactionInfo transactionInfo = new TransactionInfo(promise, operationType, deviceId, timeoutMs);
        pendingTransactions.put(transactionId, transactionInfo);
        
        Log.d(TAG, "Added transaction: " + transactionId + " (" + operationType + ") for device: " + deviceId + " with timeout: " + timeoutMs + "ms");
        
        // Schedule timeout
        timeoutExecutor.schedule(() -> {
            TransactionInfo timeoutTransaction = pendingTransactions.remove(transactionId);
            if (timeoutTransaction != null) {
                Log.w(TAG, "Transaction timeout: " + transactionId + " (" + operationType + ") for device: " + deviceId);
                timeoutTransaction.promise.reject("TIMEOUT", 
                    createTimeoutError(operationType, deviceId, timeoutMs));
            }
        }, timeoutMs, TimeUnit.MILLISECONDS);
    }
    
    /**
     * Resolve a transaction with success result
     * @param transactionId Transaction identifier
     * @param result Result to pass to promise
     * @return true if transaction was found and resolved, false otherwise
     */
    public boolean resolveTransaction(String transactionId, Object result) {
        TransactionInfo transactionInfo = pendingTransactions.remove(transactionId);
        if (transactionInfo != null) {
            Log.d(TAG, "Resolved transaction: " + transactionId + " (" + transactionInfo.operationType + ") for device: " + transactionInfo.deviceId);
            transactionInfo.promise.resolve(result);
            return true;
        }
        
        Log.w(TAG, "Transaction not found for resolution: " + transactionId);
        return false;
    }
    
    /**
     * Reject a transaction with error
     * @param transactionId Transaction identifier
     * @param errorCode Error code
     * @param errorMessage Error message
     * @return true if transaction was found and rejected, false otherwise
     */
    public boolean rejectTransaction(String transactionId, String errorCode, String errorMessage) {
        TransactionInfo transactionInfo = pendingTransactions.remove(transactionId);
        if (transactionInfo != null) {
            Log.d(TAG, "Rejected transaction: " + transactionId + " (" + transactionInfo.operationType + ") for device: " + transactionInfo.deviceId + " - " + errorMessage);
            transactionInfo.promise.reject(errorCode, errorMessage);
            return true;
        }
        
        Log.w(TAG, "Transaction not found for rejection: " + transactionId);
        return false;
    }
    
    /**
     * Reject a transaction with BLEError
     * @param transactionId Transaction identifier
     * @param bleError BLEError object
     * @return true if transaction was found and rejected, false otherwise
     */
    public boolean rejectTransaction(String transactionId, BLEError bleError) {
        TransactionInfo transactionInfo = pendingTransactions.remove(transactionId);
        if (transactionInfo != null) {
            Log.d(TAG, "Rejected transaction: " + transactionId + " (" + transactionInfo.operationType + ") for device: " + transactionInfo.deviceId + " - " + bleError.reason);
            transactionInfo.promise.reject(bleError.errorCode.name(), bleError.toJSString());
            return true;
        }
        
        Log.w(TAG, "Transaction not found for rejection: " + transactionId);
        return false;
    }
    
    /**
     * Cancel a specific transaction
     * @param transactionId Transaction identifier
     * @return true if transaction was found and cancelled, false otherwise
     */
    public boolean cancelTransaction(String transactionId) {
        TransactionInfo transactionInfo = pendingTransactions.remove(transactionId);
        if (transactionInfo != null) {
            Log.d(TAG, "Cancelled transaction: " + transactionId + " (" + transactionInfo.operationType + ") for device: " + transactionInfo.deviceId);
            transactionInfo.promise.reject("CANCELLED", 
                createCancelledError(transactionInfo.operationType, transactionInfo.deviceId));
            return true;
        }
        
        Log.w(TAG, "Transaction not found for cancellation: " + transactionId);
        return false;
    }
    
    /**
     * Cancel all transactions for a specific device
     * @param deviceId Device identifier
     * @return Number of transactions cancelled
     */
    public int cancelAllTransactionsForDevice(String deviceId) {
        int cancelledCount = 0;
        
        for (String transactionId : pendingTransactions.keySet()) {
            TransactionInfo transactionInfo = pendingTransactions.get(transactionId);
            if (transactionInfo != null && deviceId.equals(transactionInfo.deviceId)) {
                if (cancelTransaction(transactionId)) {
                    cancelledCount++;
                }
            }
        }
        
        Log.d(TAG, "Cancelled " + cancelledCount + " transactions for device: " + deviceId);
        return cancelledCount;
    }
    
    /**
     * Cancel all pending transactions
     * @return Number of transactions cancelled
     */
    public int cancelAllTransactions() {
        int cancelledCount = pendingTransactions.size();
        
        for (String transactionId : pendingTransactions.keySet()) {
            cancelTransaction(transactionId);
        }
        
        Log.d(TAG, "Cancelled all " + cancelledCount + " pending transactions");
        return cancelledCount;
    }
    
    /**
     * Check if a transaction exists
     * @param transactionId Transaction identifier
     * @return true if transaction exists, false otherwise
     */
    public boolean hasTransaction(String transactionId) {
        return pendingTransactions.containsKey(transactionId);
    }
    
    /**
     * Get transaction count
     * @return Number of pending transactions
     */
    public int getTransactionCount() {
        return pendingTransactions.size();
    }
    
    /**
     * Get transaction count for a specific device
     * @param deviceId Device identifier
     * @return Number of pending transactions for the device
     */
    public int getTransactionCountForDevice(String deviceId) {
        int count = 0;
        for (TransactionInfo transactionInfo : pendingTransactions.values()) {
            if (deviceId.equals(transactionInfo.deviceId)) {
                count++;
            }
        }
        return count;
    }
    
    /**
     * Clean up timed out transactions
     * This method can be called periodically to clean up stale transactions
     */
    public void cleanupTimedOutTransactions() {
        long currentTime = System.currentTimeMillis();
        int cleanedCount = 0;
        
        for (String transactionId : pendingTransactions.keySet()) {
            TransactionInfo transactionInfo = pendingTransactions.get(transactionId);
            if (transactionInfo != null && transactionInfo.isTimedOut()) {
                Log.w(TAG, "Cleaning up timed out transaction: " + transactionId + " (" + transactionInfo.operationType + ")");
                rejectTransaction(transactionId, "TIMEOUT", 
                    createTimeoutError(transactionInfo.operationType, transactionInfo.deviceId, transactionInfo.timeoutMs));
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            Log.d(TAG, "Cleaned up " + cleanedCount + " timed out transactions");
        }
    }
    
    /**
     * Shutdown the transaction manager
     * Cancels all pending transactions and stops the timeout executor
     */
    public void shutdown() {
        if (isShutdown.compareAndSet(false, true)) {
            Log.d(TAG, "Shutting down TransactionManager");
            
            // Cancel all pending transactions
            cancelAllTransactions();
            
            // Shutdown executor
            timeoutExecutor.shutdown();
            try {
                if (!timeoutExecutor.awaitTermination(5, TimeUnit.SECONDS)) {
                    timeoutExecutor.shutdownNow();
                }
            } catch (InterruptedException e) {
                timeoutExecutor.shutdownNow();
                Thread.currentThread().interrupt();
            }
            
            Log.d(TAG, "TransactionManager shutdown complete");
        }
    }
    
    /**
     * Create timeout error message
     */
    private String createTimeoutError(String operationType, String deviceId, long timeoutMs) {
        return operationType + " operation timed out after " + timeoutMs + "ms for device " + deviceId;
    }
    
    /**
     * Create cancelled error message
     */
    private String createCancelledError(String operationType, String deviceId) {
        return operationType + " operation was cancelled for device " + deviceId;
    }
    
    /**
     * Generate unique transaction ID
     * @param operationType Type of operation
     * @param deviceId Device ID
     * @return Unique transaction ID
     */
    public static String generateTransactionId(String operationType, String deviceId) {
        // Add null checks to prevent NullPointerException
        if (operationType == null) {
            Log.w(TAG, "generateTransactionId: operationType is null, using 'unknown'");
            operationType = "unknown";
        }
        if (deviceId == null) {
            Log.w(TAG, "generateTransactionId: deviceId is null, using 'unknown'");
            deviceId = "unknown";
        }
        return operationType + "_" + deviceId + "_" + System.currentTimeMillis() + "_" + Thread.currentThread().getId();
    }
    
    /**
     * Generate transaction ID for read operations
     */
    public static String generateReadTransactionId(String deviceId, String characteristicUuid) {
        // Add null checks to prevent NullPointerException
        if (deviceId == null) {
            Log.w(TAG, "generateReadTransactionId: deviceId is null, using 'unknown'");
            deviceId = "unknown";
        }
        if (characteristicUuid == null) {
            Log.w(TAG, "generateReadTransactionId: characteristicUuid is null, using 'unknown'");
            characteristicUuid = "unknown";
        }
        return "READ_" + deviceId + "_" + characteristicUuid + "_" + System.currentTimeMillis();
    }
    
    /**
     * Generate transaction ID for write operations
     */
    public static String generateWriteTransactionId(String deviceId, String characteristicUuid) {
        // Add null checks to prevent NullPointerException
        if (deviceId == null) {
            Log.w(TAG, "generateWriteTransactionId: deviceId is null, using 'unknown'");
            deviceId = "unknown";
        }
        if (characteristicUuid == null) {
            Log.w(TAG, "generateWriteTransactionId: characteristicUuid is null, using 'unknown'");
            characteristicUuid = "unknown";
        }
        return "WRITE_" + deviceId + "_" + characteristicUuid + "_" + System.currentTimeMillis();
    }
    
    /**
     * Generate transaction ID for service discovery
     */
    public static String generateServiceDiscoveryTransactionId(String deviceId) {
        // Add null checks to prevent NullPointerException
        if (deviceId == null) {
            Log.w(TAG, "generateServiceDiscoveryTransactionId: deviceId is null, using 'unknown'");
            deviceId = "unknown";
        }
        return "SERVICE_DISCOVERY_" + deviceId + "_" + System.currentTimeMillis();
    }
    
    /**
     * Generate transaction ID for connection operations
     */
    public static String generateConnectionTransactionId(String deviceId) {
        // Add null checks to prevent NullPointerException
        if (deviceId == null) {
            Log.w(TAG, "generateConnectionTransactionId: deviceId is null, using 'unknown'");
            deviceId = "unknown";
        }
        return "CONNECTION_" + deviceId + "_" + System.currentTimeMillis();
    }
}
