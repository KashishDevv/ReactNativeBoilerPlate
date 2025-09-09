package com.reactnativeboilerplate;

import android.util.Log;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.WritableMap;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Advertisement Data Parser
 * Parses BLE advertisement data from scan records
 * Based on React Native BLE PLX AdvertisementData patterns
 */
public class AdvertisementDataParser {
    private static final String TAG = "AdvertisementDataParser";
    
    // Bluetooth Base UUID constants
    private static final long BLUETOOTH_BASE_UUID_LSB = 0x800000805F9B34FBL;
    private static final int BLUETOOTH_BASE_UUID_MSB = 0x00001000;
    
    // Advertisement Data Types
    private static final int AD_TYPE_FLAGS = 0x01;
    private static final int AD_TYPE_SERVICE_UUID_16 = 0x02;
    private static final int AD_TYPE_SERVICE_UUID_32 = 0x04;
    private static final int AD_TYPE_SERVICE_UUID_128 = 0x06;
    private static final int AD_TYPE_LOCAL_NAME_SHORT = 0x08;
    private static final int AD_TYPE_LOCAL_NAME_COMPLETE = 0x09;
    private static final int AD_TYPE_TX_POWER_LEVEL = 0x0A;
    private static final int AD_TYPE_SERVICE_DATA = 0x16;
    private static final int AD_TYPE_MANUFACTURER_DATA = 0xFF;
    
    /**
     * Parse advertisement data from scan record
     * @param scanRecord Raw scan record bytes
     * @return Parsed advertisement data
     */
    public static AdvertisementData parseScanRecord(byte[] scanRecord) {
        if (scanRecord == null || scanRecord.length == 0) {
            return new AdvertisementData();
        }
        
        AdvertisementData advData = new AdvertisementData();
        advData.rawScanRecord = scanRecord;
        
        try {
            ByteBuffer rawData = ByteBuffer.wrap(scanRecord).order(ByteOrder.LITTLE_ENDIAN);
            
            while (rawData.remaining() >= 2) {
                int adLength = rawData.get() & 0xFF;
                if (adLength == 0) break;
                
                adLength -= 1; // Subtract 1 for the AD Type byte
                int adType = rawData.get() & 0xFF;
                
                if (rawData.remaining() < adLength) break;
                
                parseAdvertisementData(advData, adType, adLength, rawData.slice().order(ByteOrder.LITTLE_ENDIAN));
                rawData.position(rawData.position() + adLength);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing advertisement data: " + e.getMessage(), e);
        }
        
        return advData;
    }
    
    /**
     * Parse specific advertisement data type
     */
    private static void parseAdvertisementData(AdvertisementData advData, int adType, int adLength, ByteBuffer data) {
        switch (adType) {
            case AD_TYPE_MANUFACTURER_DATA:
                parseManufacturerData(advData, adLength, data);
                break;
                
            case AD_TYPE_SERVICE_UUID_16:
                parseServiceUUIDs(advData, adLength, data, 2);
                break;
                
            case AD_TYPE_SERVICE_UUID_32:
                parseServiceUUIDs(advData, adLength, data, 4);
                break;
                
            case AD_TYPE_SERVICE_UUID_128:
                parseServiceUUIDs(advData, adLength, data, 16);
                break;
                
            case AD_TYPE_LOCAL_NAME_SHORT:
            case AD_TYPE_LOCAL_NAME_COMPLETE:
                parseLocalName(advData, adLength, data);
                break;
                
            case AD_TYPE_TX_POWER_LEVEL:
                parseTxPowerLevel(advData, adLength, data);
                break;
                
            case AD_TYPE_SERVICE_DATA:
                parseServiceData(advData, adLength, data);
                break;
                
            default:
                // Unknown AD type, skip
                break;
        }
    }
    
    /**
     * Parse manufacturer data
     */
    private static void parseManufacturerData(AdvertisementData advData, int adLength, ByteBuffer data) {
        if (adLength >= 2) {
            byte[] manufacturerData = new byte[adLength];
            data.get(manufacturerData);
            advData.manufacturerData = manufacturerData;
        }
    }
    
    /**
     * Parse service UUIDs
     */
    private static void parseServiceUUIDs(AdvertisementData advData, int adLength, ByteBuffer data, int uuidLength) {
        if (advData.serviceUUIDs == null) {
            advData.serviceUUIDs = new ArrayList<>();
        }
        
        int numUUIDs = adLength / uuidLength;
        for (int i = 0; i < numUUIDs; i++) {
            UUID uuid = parseUUID(data, uuidLength);
            if (uuid != null) {
                advData.serviceUUIDs.add(uuid);
            }
        }
    }
    
    /**
     * Parse local name
     */
    private static void parseLocalName(AdvertisementData advData, int adLength, ByteBuffer data) {
        if (adLength > 0) {
            byte[] nameBytes = new byte[adLength];
            data.get(nameBytes);
            advData.localName = new String(nameBytes, Charset.forName("UTF-8"));
        }
    }
    
    /**
     * Parse TX power level
     */
    private static void parseTxPowerLevel(AdvertisementData advData, int adLength, ByteBuffer data) {
        if (adLength >= 1) {
            advData.txPowerLevel = (int) data.get();
        }
    }
    
    /**
     * Parse service data
     */
    private static void parseServiceData(AdvertisementData advData, int adLength, ByteBuffer data) {
        if (adLength >= 2) {
            if (advData.serviceData == null) {
                advData.serviceData = new HashMap<>();
            }
            
            // First 2 bytes are the service UUID (16-bit)
            UUID serviceUUID = parseUUID(data, 2);
            if (serviceUUID != null) {
                byte[] serviceDataBytes = new byte[adLength - 2];
                data.get(serviceDataBytes);
                advData.serviceData.put(serviceUUID, serviceDataBytes);
            }
        }
    }
    
    /**
     * Parse UUID from buffer
     */
    private static UUID parseUUID(ByteBuffer data, int uuidLength) {
        try {
            if (uuidLength == 2) {
                // 16-bit UUID
                int uuid16 = data.getShort() & 0xFFFF;
                return new UUID(BLUETOOTH_BASE_UUID_MSB, (uuid16 << 32) | BLUETOOTH_BASE_UUID_LSB);
            } else if (uuidLength == 4) {
                // 32-bit UUID
                long uuid32 = data.getInt() & 0xFFFFFFFFL;
                return new UUID(BLUETOOTH_BASE_UUID_MSB, (uuid32 << 32) | BLUETOOTH_BASE_UUID_LSB);
            } else if (uuidLength == 16) {
                // 128-bit UUID
                long msb = data.getLong();
                long lsb = data.getLong();
                return new UUID(msb, lsb);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error parsing UUID: " + e.getMessage());
        }
        return null;
    }
    
    /**
     * Advertisement Data container class
     */
    public static class AdvertisementData {
        public byte[] manufacturerData;
        public Map<UUID, byte[]> serviceData;
        public List<UUID> serviceUUIDs;
        public String localName;
        public Integer txPowerLevel;
        public List<UUID> solicitedServiceUUIDs;
        public byte[] rawScanRecord;
        
        public AdvertisementData() {
            this.serviceData = new HashMap<>();
            this.serviceUUIDs = new ArrayList<>();
            this.solicitedServiceUUIDs = new ArrayList<>();
        }
        
        /**
         * Convert to JavaScript object
         */
        public WritableMap toJSObject() {
            WritableMap map = Arguments.createMap();
            
            // Manufacturer data
            if (manufacturerData != null && manufacturerData.length > 0) {
                map.putString("manufacturerData", BLEUtils.bytesToBase64(manufacturerData));
            } else {
                map.putNull("manufacturerData");
            }
            
            // Service data
            if (serviceData != null && !serviceData.isEmpty()) {
                WritableMap serviceDataMap = Arguments.createMap();
                for (Map.Entry<UUID, byte[]> entry : serviceData.entrySet()) {
                    serviceDataMap.putString(entry.getKey().toString(), BLEUtils.bytesToBase64(entry.getValue()));
                }
                map.putMap("serviceData", serviceDataMap);
            } else {
                map.putNull("serviceData");
            }
            
            // Service UUIDs
            if (serviceUUIDs != null && !serviceUUIDs.isEmpty()) {
                WritableMap serviceUUIDsMap = Arguments.createMap();
                for (int i = 0; i < serviceUUIDs.size(); i++) {
                    serviceUUIDsMap.putString(String.valueOf(i), serviceUUIDs.get(i).toString());
                }
                map.putMap("serviceUUIDs", serviceUUIDsMap);
            } else {
                map.putNull("serviceUUIDs");
            }
            
            // Local name
            map.putString("localName", localName);
            
            // TX power level
            if (txPowerLevel != null) {
                map.putInt("txPowerLevel", txPowerLevel);
            } else {
                map.putNull("txPowerLevel");
            }
            
            // Solicited service UUIDs
            if (solicitedServiceUUIDs != null && !solicitedServiceUUIDs.isEmpty()) {
                WritableMap solicitedUUIDsMap = Arguments.createMap();
                for (int i = 0; i < solicitedServiceUUIDs.size(); i++) {
                    solicitedUUIDsMap.putString(String.valueOf(i), solicitedServiceUUIDs.get(i).toString());
                }
                map.putMap("solicitedServiceUUIDs", solicitedUUIDsMap);
            } else {
                map.putNull("solicitedServiceUUIDs");
            }
            
            // Raw scan record
            if (rawScanRecord != null && rawScanRecord.length > 0) {
                map.putString("rawScanRecord", BLEUtils.bytesToBase64(rawScanRecord));
            } else {
                map.putNull("rawScanRecord");
            }
            
            return map;
        }
        
        /**
         * Get manufacturer ID from manufacturer data
         */
        public Integer getManufacturerId() {
            if (manufacturerData != null && manufacturerData.length >= 2) {
                return ((manufacturerData[1] & 0xFF) << 8) | (manufacturerData[0] & 0xFF);
            }
            return null;
        }
        
        /**
         * Get manufacturer data without the ID
         */
        public byte[] getManufacturerDataWithoutId() {
            if (manufacturerData != null && manufacturerData.length > 2) {
                byte[] data = new byte[manufacturerData.length - 2];
                System.arraycopy(manufacturerData, 2, data, 0, data.length);
                return data;
            }
            return null;
        }
        
        /**
         * Check if device has specific service UUID
         */
        public boolean hasServiceUUID(String serviceUUID) {
            if (serviceUUIDs == null) return false;
            
            try {
                UUID targetUUID = UUID.fromString(BLEUtils.normalizeUUID(serviceUUID));
                return serviceUUIDs.contains(targetUUID);
            } catch (Exception e) {
                return false;
            }
        }
        
        /**
         * Get service data for specific service UUID
         */
        public byte[] getServiceData(String serviceUUID) {
            if (serviceData == null) return null;
            
            try {
                UUID targetUUID = UUID.fromString(BLEUtils.normalizeUUID(serviceUUID));
                return serviceData.get(targetUUID);
            } catch (Exception e) {
                return null;
            }
        }
        
        @Override
        public String toString() {
            return "AdvertisementData{" +
                    "localName='" + localName + '\'' +
                    ", txPowerLevel=" + txPowerLevel +
                    ", serviceUUIDs=" + serviceUUIDs +
                    ", manufacturerData=" + (manufacturerData != null ? BLEUtils.formatBytesForLogging(manufacturerData) : "null") +
                    ", serviceData=" + serviceData +
                    '}';
        }
    }
}
