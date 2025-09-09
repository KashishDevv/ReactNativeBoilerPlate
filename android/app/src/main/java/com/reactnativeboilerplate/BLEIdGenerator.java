package com.reactnativeboilerplate;

import android.util.Log;
import java.util.HashMap;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * ID Generator for BLE resources
 * Provides unique IDs for services, characteristics, and descriptors
 * Based on React Native BLE PLX IdGenerator patterns
 */
public class BLEIdGenerator {
    private static final String TAG = "BLEIdGenerator";
    
    // ID counters for different resource types
    private static final AtomicInteger nextServiceId = new AtomicInteger(0);
    private static final AtomicInteger nextCharacteristicId = new AtomicInteger(0);
    private static final AtomicInteger nextDescriptorId = new AtomicInteger(0);
    private static final AtomicInteger nextTransactionId = new AtomicInteger(0);
    
    // Maps to store device-specific IDs
    private static final HashMap<String, Integer> deviceServiceIds = new HashMap<>();
    private static final HashMap<String, Integer> deviceCharacteristicIds = new HashMap<>();
    private static final HashMap<String, Integer> deviceDescriptorIds = new HashMap<>();
    
    /**
     * Generate unique service ID
     * @param deviceId Device identifier
     * @param serviceUuid Service UUID
     * @return Unique service ID
     */
    public static int generateServiceId(String deviceId, String serviceUuid) {
        String key = deviceId + "_" + serviceUuid;
        Integer existingId = deviceServiceIds.get(key);
        if (existingId != null) {
            return existingId;
        }
        
        int newId = nextServiceId.incrementAndGet();
        deviceServiceIds.put(key, newId);
        
        Log.d(TAG, "Generated service ID " + newId + " for device " + deviceId + ", service " + serviceUuid);
        return newId;
    }
    
    /**
     * Generate unique characteristic ID
     * @param deviceId Device identifier
     * @param serviceId Service ID
     * @param characteristicUuid Characteristic UUID
     * @return Unique characteristic ID
     */
    public static int generateCharacteristicId(String deviceId, int serviceId, String characteristicUuid) {
        String key = deviceId + "_" + serviceId + "_" + characteristicUuid;
        Integer existingId = deviceCharacteristicIds.get(key);
        if (existingId != null) {
            return existingId;
        }
        
        int newId = nextCharacteristicId.incrementAndGet();
        deviceCharacteristicIds.put(key, newId);
        
        Log.d(TAG, "Generated characteristic ID " + newId + " for device " + deviceId + 
              ", service " + serviceId + ", characteristic " + characteristicUuid);
        return newId;
    }
    
    /**
     * Generate unique descriptor ID
     * @param deviceId Device identifier
     * @param characteristicId Characteristic ID
     * @param descriptorUuid Descriptor UUID
     * @return Unique descriptor ID
     */
    public static int generateDescriptorId(String deviceId, int characteristicId, String descriptorUuid) {
        String key = deviceId + "_" + characteristicId + "_" + descriptorUuid;
        Integer existingId = deviceDescriptorIds.get(key);
        if (existingId != null) {
            return existingId;
        }
        
        int newId = nextDescriptorId.incrementAndGet();
        deviceDescriptorIds.put(key, newId);
        
        Log.d(TAG, "Generated descriptor ID " + newId + " for device " + deviceId + 
              ", characteristic " + characteristicId + ", descriptor " + descriptorUuid);
        return newId;
    }
    
    /**
     * Generate unique transaction ID
     * @param operationType Type of operation
     * @param deviceId Device identifier
     * @return Unique transaction ID
     */
    public static String generateTransactionId(String operationType, String deviceId) {
        int id = nextTransactionId.incrementAndGet();
        String transactionId = operationType + "_" + deviceId + "_" + id + "_" + System.currentTimeMillis();
        
        Log.d(TAG, "Generated transaction ID " + transactionId);
        return transactionId;
    }
    
    /**
     * Generate transaction ID for read operations
     * @param deviceId Device identifier
     * @param characteristicUuid Characteristic UUID
     * @return Unique read transaction ID
     */
    public static String generateReadTransactionId(String deviceId, String characteristicUuid) {
        return generateTransactionId("READ", deviceId + "_" + characteristicUuid);
    }
    
    /**
     * Generate transaction ID for write operations
     * @param deviceId Device identifier
     * @param characteristicUuid Characteristic UUID
     * @return Unique write transaction ID
     */
    public static String generateWriteTransactionId(String deviceId, String characteristicUuid) {
        return generateTransactionId("WRITE", deviceId + "_" + characteristicUuid);
    }
    
    /**
     * Generate transaction ID for service discovery
     * @param deviceId Device identifier
     * @return Unique service discovery transaction ID
     */
    public static String generateServiceDiscoveryTransactionId(String deviceId) {
        return generateTransactionId("SERVICE_DISCOVERY", deviceId);
    }
    
    /**
     * Generate transaction ID for connection operations
     * @param deviceId Device identifier
     * @return Unique connection transaction ID
     */
    public static String generateConnectionTransactionId(String deviceId) {
        return generateTransactionId("CONNECTION", deviceId);
    }
    
    /**
     * Generate transaction ID for notification operations
     * @param deviceId Device identifier
     * @param characteristicUuid Characteristic UUID
     * @return Unique notification transaction ID
     */
    public static String generateNotificationTransactionId(String deviceId, String characteristicUuid) {
        return generateTransactionId("NOTIFICATION", deviceId + "_" + characteristicUuid);
    }
    
    /**
     * Get existing service ID if it exists
     * @param deviceId Device identifier
     * @param serviceUuid Service UUID
     * @return Existing service ID or -1 if not found
     */
    public static int getServiceId(String deviceId, String serviceUuid) {
        String key = deviceId + "_" + serviceUuid;
        Integer id = deviceServiceIds.get(key);
        return id != null ? id : -1;
    }
    
    /**
     * Get existing characteristic ID if it exists
     * @param deviceId Device identifier
     * @param serviceId Service ID
     * @param characteristicUuid Characteristic UUID
     * @return Existing characteristic ID or -1 if not found
     */
    public static int getCharacteristicId(String deviceId, int serviceId, String characteristicUuid) {
        String key = deviceId + "_" + serviceId + "_" + characteristicUuid;
        Integer id = deviceCharacteristicIds.get(key);
        return id != null ? id : -1;
    }
    
    /**
     * Get existing descriptor ID if it exists
     * @param deviceId Device identifier
     * @param characteristicId Characteristic ID
     * @param descriptorUuid Descriptor UUID
     * @return Existing descriptor ID or -1 if not found
     */
    public static int getDescriptorId(String deviceId, int characteristicId, String descriptorUuid) {
        String key = deviceId + "_" + characteristicId + "_" + descriptorUuid;
        Integer id = deviceDescriptorIds.get(key);
        return id != null ? id : -1;
    }
    
    /**
     * Remove all IDs for a specific device
     * @param deviceId Device identifier
     * @return Number of IDs removed
     */
    public static int removeDeviceIds(String deviceId) {
        int removedCount = 0;
        
        // Remove service IDs
        deviceServiceIds.entrySet().removeIf(entry -> {
            if (entry.getKey().startsWith(deviceId + "_")) {
                Log.d(TAG, "Removed service ID " + entry.getValue() + " for device " + deviceId);
                return true;
            }
            return false;
        });
        
        // Remove characteristic IDs
        deviceCharacteristicIds.entrySet().removeIf(entry -> {
            if (entry.getKey().startsWith(deviceId + "_")) {
                Log.d(TAG, "Removed characteristic ID " + entry.getValue() + " for device " + deviceId);
                return true;
            }
            return false;
        });
        
        // Remove descriptor IDs
        deviceDescriptorIds.entrySet().removeIf(entry -> {
            if (entry.getKey().startsWith(deviceId + "_")) {
                Log.d(TAG, "Removed descriptor ID " + entry.getValue() + " for device " + deviceId);
                return true;
            }
            return false;
        });
        
        Log.d(TAG, "Removed " + removedCount + " IDs for device " + deviceId);
        return removedCount;
    }
    
    /**
     * Clear all generated IDs
     */
    public static void clearAll() {
        Log.d(TAG, "Clearing all generated IDs");
        
        deviceServiceIds.clear();
        deviceCharacteristicIds.clear();
        deviceDescriptorIds.clear();
        
        nextServiceId.set(0);
        nextCharacteristicId.set(0);
        nextDescriptorId.set(0);
        nextTransactionId.set(0);
        
        Log.d(TAG, "All IDs cleared");
    }
    
    /**
     * Get statistics about generated IDs
     * @return Statistics map
     */
    public static HashMap<String, Integer> getStatistics() {
        HashMap<String, Integer> stats = new HashMap<>();
        stats.put("totalServices", deviceServiceIds.size());
        stats.put("totalCharacteristics", deviceCharacteristicIds.size());
        stats.put("totalDescriptors", deviceDescriptorIds.size());
        stats.put("nextServiceId", nextServiceId.get());
        stats.put("nextCharacteristicId", nextCharacteristicId.get());
        stats.put("nextDescriptorId", nextDescriptorId.get());
        stats.put("nextTransactionId", nextTransactionId.get());
        return stats;
    }
    
    /**
     * Get all service IDs for a device
     * @param deviceId Device identifier
     * @return Map of service UUID to service ID
     */
    public static HashMap<String, Integer> getDeviceServiceIds(String deviceId) {
        HashMap<String, Integer> serviceIds = new HashMap<>();
        String prefix = deviceId + "_";
        
        for (String key : deviceServiceIds.keySet()) {
            if (key.startsWith(prefix)) {
                String serviceUuid = key.substring(prefix.length());
                serviceIds.put(serviceUuid, deviceServiceIds.get(key));
            }
        }
        
        return serviceIds;
    }
    
    /**
     * Get all characteristic IDs for a device and service
     * @param deviceId Device identifier
     * @param serviceId Service ID
     * @return Map of characteristic UUID to characteristic ID
     */
    public static HashMap<String, Integer> getDeviceCharacteristicIds(String deviceId, int serviceId) {
        HashMap<String, Integer> characteristicIds = new HashMap<>();
        String prefix = deviceId + "_" + serviceId + "_";
        
        for (String key : deviceCharacteristicIds.keySet()) {
            if (key.startsWith(prefix)) {
                String characteristicUuid = key.substring(prefix.length());
                characteristicIds.put(characteristicUuid, deviceCharacteristicIds.get(key));
            }
        }
        
        return characteristicIds;
    }
    
    /**
     * Validate ID uniqueness
     * @return true if all IDs are unique, false otherwise
     */
    public static boolean validateIdUniqueness() {
        // Check service ID uniqueness
        if (deviceServiceIds.size() != deviceServiceIds.values().stream().distinct().count()) {
            Log.e(TAG, "Service IDs are not unique!");
            return false;
        }
        
        // Check characteristic ID uniqueness
        if (deviceCharacteristicIds.size() != deviceCharacteristicIds.values().stream().distinct().count()) {
            Log.e(TAG, "Characteristic IDs are not unique!");
            return false;
        }
        
        // Check descriptor ID uniqueness
        if (deviceDescriptorIds.size() != deviceDescriptorIds.values().stream().distinct().count()) {
            Log.e(TAG, "Descriptor IDs are not unique!");
            return false;
        }
        
        Log.d(TAG, "All IDs are unique");
        return true;
    }
}
