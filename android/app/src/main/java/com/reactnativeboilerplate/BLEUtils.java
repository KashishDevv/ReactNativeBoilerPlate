package com.reactnativeboilerplate;

import android.util.Base64;
import android.util.Log;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.UUID;

/**
 * Utility class for BLE data conversion and manipulation
 * Provides consistent methods for data handling across the BLE implementation
 * Based on React Native BLE PLX utility patterns
 */
public class BLEUtils {
    private static final String TAG = "BLEUtils";
    
    // Base UUID for Bluetooth services (used for 16-bit UUIDs)
    private static final String BLUETOOTH_BASE_UUID = "00000000-0000-1000-8000-00805F9B34FB";
    
    /**
     * Convert byte array to hexadecimal string
     * @param bytes Byte array to convert
     * @return Hexadecimal string representation
     */
    public static String bytesToHex(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) {
            result.append(String.format("%02x", b));
        }
        return result.toString();
    }
    
    /**
     * Convert hexadecimal string to byte array
     * @param hexString Hexadecimal string to convert
     * @return Byte array representation
     * @throws IllegalArgumentException if hex string is invalid
     */
    public static byte[] hexToBytes(String hexString) throws IllegalArgumentException {
        if (hexString == null || hexString.isEmpty()) {
            return new byte[0];
        }
        
        // Remove spaces and convert to lowercase
        hexString = hexString.replaceAll("\\s+", "").toLowerCase();
        
        // Validate hex string
        if (hexString.length() % 2 != 0) {
            throw new IllegalArgumentException("Hex string length must be even");
        }
        
        if (!hexString.matches("[0-9a-f]+")) {
            throw new IllegalArgumentException("Hex string contains invalid characters");
        }
        
        byte[] data = new byte[hexString.length() / 2];
        for (int i = 0; i < hexString.length(); i += 2) {
            data[i / 2] = (byte) ((Character.digit(hexString.charAt(i), 16) << 4)
                                 + Character.digit(hexString.charAt(i + 1), 16));
        }
        return data;
    }
    
    /**
     * Convert byte array to Base64 string
     * @param bytes Byte array to convert
     * @return Base64 string representation
     */
    public static String bytesToBase64(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
    }
    
    /**
     * Convert Base64 string to byte array
     * @param base64 Base64 string to convert
     * @return Byte array representation
     * @throws IllegalArgumentException if Base64 string is invalid
     */
    public static byte[] base64ToBytes(String base64) throws IllegalArgumentException {
        if (base64 == null || base64.isEmpty()) {
            return new byte[0];
        }
        
        try {
            return Base64.decode(base64, Base64.NO_WRAP);
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid Base64 string: " + base64, e);
        }
    }
    
    /**
     * Convert UUID string to proper format
     * Handles 16-bit, 32-bit, and 128-bit UUIDs
     * @param uuidString UUID string to convert
     * @return Properly formatted UUID string
     */
    public static String normalizeUUID(String uuidString) {
        if (uuidString == null || uuidString.isEmpty()) {
            return null;
        }
        
        // Remove any spaces and convert to lowercase
        uuidString = uuidString.replaceAll("\\s+", "").toLowerCase();
        
        // Handle different UUID formats
        if (uuidString.length() == 4) {
            // 16-bit UUID - pad with zeros and add base UUID
            return "0000" + uuidString + "-0000-1000-8000-00805f9b34fb";
        } else if (uuidString.length() == 8) {
            // 32-bit UUID - add base UUID
            return uuidString + "-0000-1000-8000-00805f9b34fb";
        } else if (uuidString.length() == 36) {
            // 128-bit UUID - already properly formatted
            return uuidString;
        } else {
            Log.w(TAG, "Invalid UUID format: " + uuidString);
            return uuidString;
        }
    }
    
    /**
     * Convert 16-bit UUID to full 128-bit UUID
     * @param shortUuid 16-bit UUID string
     * @return Full 128-bit UUID string
     */
    public static String expandShortUUID(String shortUuid) {
        if (shortUuid == null || shortUuid.isEmpty()) {
            return null;
        }
        
        shortUuid = shortUuid.replaceAll("\\s+", "").toLowerCase();
        
        if (shortUuid.length() == 4) {
            return "0000" + shortUuid + "-0000-1000-8000-00805f9b34fb";
        } else if (shortUuid.length() == 8) {
            return shortUuid + "-0000-1000-8000-00805f9b34fb";
        }
        
        return shortUuid;
    }
    
    /**
     * Extract 16-bit UUID from full 128-bit UUID
     * @param fullUuid Full 128-bit UUID string
     * @return 16-bit UUID string, or null if not a standard Bluetooth UUID
     */
    public static String extractShortUUID(String fullUuid) {
        if (fullUuid == null || fullUuid.isEmpty()) {
            return null;
        }
        
        fullUuid = fullUuid.replaceAll("\\s+", "").toLowerCase();
        
        // Check if it's a standard Bluetooth UUID
        if (fullUuid.endsWith("-0000-1000-8000-00805f9b34fb")) {
            if (fullUuid.startsWith("0000")) {
                // 16-bit UUID
                return fullUuid.substring(4, 8);
            } else if (fullUuid.length() == 36) {
                // 32-bit UUID
                return fullUuid.substring(0, 8);
            }
        }
        
        return null;
    }
    
    /**
     * Parse integer from byte array (little-endian)
     * @param bytes Byte array
     * @param offset Starting offset
     * @return Parsed integer
     */
    public static int parseIntLE(byte[] bytes, int offset) {
        if (bytes == null || offset + 4 > bytes.length) {
            return 0;
        }
        
        ByteBuffer buffer = ByteBuffer.wrap(bytes, offset, 4);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        return buffer.getInt();
    }
    
    /**
     * Parse float from byte array (little-endian)
     * @param bytes Byte array
     * @param offset Starting offset
     * @return Parsed float
     */
    public static float parseFloatLE(byte[] bytes, int offset) {
        if (bytes == null || offset + 4 > bytes.length) {
            return 0.0f;
        }
        
        ByteBuffer buffer = ByteBuffer.wrap(bytes, offset, 4);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        return buffer.getFloat();
    }
    
    /**
     * Parse long from byte array (little-endian)
     * @param bytes Byte array
     * @param offset Starting offset
     * @return Parsed long
     */
    public static long parseLongLE(byte[] bytes, int offset) {
        if (bytes == null || offset + 8 > bytes.length) {
            return 0L;
        }
        
        ByteBuffer buffer = ByteBuffer.wrap(bytes, offset, 8);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        return buffer.getLong();
    }
    
    /**
     * Convert integer to byte array (little-endian)
     * @param value Integer value
     * @return Byte array representation
     */
    public static byte[] intToBytesLE(int value) {
        ByteBuffer buffer = ByteBuffer.allocate(4);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        buffer.putInt(value);
        return buffer.array();
    }
    
    /**
     * Convert float to byte array (little-endian)
     * @param value Float value
     * @return Byte array representation
     */
    public static byte[] floatToBytesLE(float value) {
        ByteBuffer buffer = ByteBuffer.allocate(4);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        buffer.putFloat(value);
        return buffer.array();
    }
    
    /**
     * Convert long to byte array (little-endian)
     * @param value Long value
     * @return Byte array representation
     */
    public static byte[] longToBytesLE(long value) {
        ByteBuffer buffer = ByteBuffer.allocate(8);
        buffer.order(ByteOrder.LITTLE_ENDIAN);
        buffer.putLong(value);
        return buffer.array();
    }
    
    /**
     * Calculate MD5 hash of byte array
     * @param bytes Byte array to hash
     * @return MD5 hash as hexadecimal string
     */
    public static String calculateMD5(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] hashBytes = md.digest(bytes);
            return bytesToHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            Log.e(TAG, "MD5 algorithm not available", e);
            return "";
        }
    }
    
    /**
     * Calculate SHA-256 hash of byte array
     * @param bytes Byte array to hash
     * @return SHA-256 hash as hexadecimal string
     */
    public static String calculateSHA256(byte[] bytes) {
        if (bytes == null) {
            return "";
        }
        
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = md.digest(bytes);
            return bytesToHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            Log.e(TAG, "SHA-256 algorithm not available", e);
            return "";
        }
    }
    
    /**
     * Validate UUID string format
     * @param uuidString UUID string to validate
     * @return true if valid UUID format, false otherwise
     */
    public static boolean isValidUUID(String uuidString) {
        if (uuidString == null || uuidString.isEmpty()) {
            return false;
        }
        
        try {
            UUID.fromString(normalizeUUID(uuidString));
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
    
    /**
     * Check if UUID is a standard Bluetooth UUID
     * @param uuidString UUID string to check
     * @return true if standard Bluetooth UUID, false otherwise
     */
    public static boolean isStandardBluetoothUUID(String uuidString) {
        if (uuidString == null || uuidString.isEmpty()) {
            return false;
        }
        
        String normalized = normalizeUUID(uuidString);
        return normalized != null && normalized.endsWith("-0000-1000-8000-00805f9b34fb");
    }
    
    /**
     * Format byte array for logging (hex with spaces)
     * @param bytes Byte array to format
     * @return Formatted string for logging
     */
    public static String formatBytesForLogging(byte[] bytes) {
        if (bytes == null) {
            return "(null)";
        }
        
        if (bytes.length == 0) {
            return "(empty)";
        }
        
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < bytes.length; i++) {
            if (i > 0) {
                sb.append(" ");
            }
            sb.append(String.format("%02x", bytes[i]));
        }
        return sb.toString();
    }
    
    /**
     * Create a copy of byte array
     * @param original Original byte array
     * @return Copy of the byte array
     */
    public static byte[] copyBytes(byte[] original) {
        if (original == null) {
            return null;
        }
        
        byte[] copy = new byte[original.length];
        System.arraycopy(original, 0, copy, 0, original.length);
        return copy;
    }
    
    /**
     * Concatenate multiple byte arrays
     * @param arrays Byte arrays to concatenate
     * @return Concatenated byte array
     */
    public static byte[] concatenateBytes(byte[]... arrays) {
        if (arrays == null || arrays.length == 0) {
            return new byte[0];
        }
        
        int totalLength = 0;
        for (byte[] array : arrays) {
            if (array != null) {
                totalLength += array.length;
            }
        }
        
        byte[] result = new byte[totalLength];
        int offset = 0;
        
        for (byte[] array : arrays) {
            if (array != null) {
                System.arraycopy(array, 0, result, offset, array.length);
                offset += array.length;
            }
        }
        
        return result;
    }
    
    /**
     * Extract subarray from byte array
     * @param array Source byte array
     * @param offset Starting offset
     * @param length Length to extract
     * @return Extracted subarray
     */
    public static byte[] extractBytes(byte[] array, int offset, int length) {
        if (array == null || offset < 0 || length < 0 || offset + length > array.length) {
            return new byte[0];
        }
        
        byte[] result = new byte[length];
        System.arraycopy(array, offset, result, 0, length);
        return result;
    }
    
    /**
     * Check if two byte arrays are equal
     * @param array1 First byte array
     * @param array2 Second byte array
     * @return true if arrays are equal, false otherwise
     */
    public static boolean bytesEqual(byte[] array1, byte[] array2) {
        if (array1 == null && array2 == null) {
            return true;
        }
        
        if (array1 == null || array2 == null) {
            return false;
        }
        
        if (array1.length != array2.length) {
            return false;
        }
        
        for (int i = 0; i < array1.length; i++) {
            if (array1[i] != array2[i]) {
                return false;
            }
        }
        
        return true;
    }
}
