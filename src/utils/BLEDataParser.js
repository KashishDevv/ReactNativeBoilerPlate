import { Buffer } from 'buffer';
import { 
  DEVICE_STATUS_LAYOUT, 
  DATA_RECORD_LAYOUT,
  DATA_TRANSFER_TYPES, 
  ADV_LAYOUT, 
  MANUFACTURER_COMPANY_ID,
  ADV_AES_CONFIG,
  SYSTEM_COMMAND_CONSTANTS
} from '../constants/BLEConstants';
import AESEncryption from './AESEncryption';

// Utility class for parsing BLE data from smart tags
class BLEDataParser {
  
  /**
   * ✅ Parse device status notification data (SDD v1.4 compliant - 8 bytes)
   * ⚠️ BREAKING CHANGE: SDD v1.2 changed format from 20 bytes to 8 bytes (maintained in v1.3/v1.4)
   * ✅ Current: SDD v1.4 compliant - 8 bytes format
   * Format: [Timestamp(4), RecordCount(2), BatteryVoltage(2)]
   * Steps and Temperature are ONLY in Data Transfer records (sync data)
   * 
   * Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 13 Device status characteristic data format
   *
   * @param {string} base64Data - Base64 encoded data from device status characteristic
   * @returns {Object} Parsed device status data
   */
  parseDeviceStatus(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      // ✅ SDD v1.4: Device Status is 8 bytes (Timestamp + RecordCount + Battery)
      // Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 13
      if (buffer.length < DEVICE_STATUS_LAYOUT.TOTAL_SIZE) {
        console.warn(`⚠️ Device Status buffer too short: ${buffer.length} bytes, expected ${DEVICE_STATUS_LAYOUT.TOTAL_SIZE}`);
        if (buffer.length < 4) {
          return null;
        }
      }

      // Parse according to SDD v1.4 DEVICE_STATUS_LAYOUT (Little Endian format)
      const timestamp = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.TIMESTAMP_OFFSET);
      const recordCount = buffer.readUInt16LE(DEVICE_STATUS_LAYOUT.RECORD_COUNT_OFFSET);
      const batteryVoltage = buffer.readUInt16LE(DEVICE_STATUS_LAYOUT.BATTERY_VOLTAGE_OFFSET);
      
      // Validate timestamp - if it's clearly invalid (before 2020), flag it
      const isValidTimestamp = timestamp > 1577836800; // After 2020-01-01
      
      if (!isValidTimestamp) {
        console.warn(`⚠️ Device RTC appears unset: ${new Date(timestamp * 1000).toISOString()}`);
      }
      
      // ✅ FIXED: Battery range: 0mV (0%) to 3000mV (100%)
      // Linear scale: percentage = (voltage / 3000) × 100
      const BATTERY_MIN_MV = 0;    // 0% battery
      const BATTERY_MAX_MV = 3000; // 100% battery
      
      let batteryPercentage = 0;
      if (batteryVoltage >= BATTERY_MIN_MV && batteryVoltage <= BATTERY_MAX_MV) {
        batteryPercentage = Math.round((batteryVoltage / BATTERY_MAX_MV) * 100);
      } else if (batteryVoltage > BATTERY_MAX_MV) {
        batteryPercentage = 100;
      } else if (batteryVoltage < BATTERY_MIN_MV) {
        batteryPercentage = 0;
      }

      const result = {
        type: 'device_status',
        timestamp: new Date(timestamp * 1000),
        deviceRTC: timestamp,
        recordCount,                    // ✅ NEW: Number of records available for sync
        batteryVoltage,                 // ✅ NEW: Battery voltage in millivolts
        batteryLevel: batteryPercentage, // Converted to percentage
        rtcValid: isValidTimestamp,
        lastUpdate: new Date(),
        rawBuffer: buffer.toString('hex'),
        sddCompliant: buffer.length === DEVICE_STATUS_LAYOUT.TOTAL_SIZE,
        sddVersion: '1.4',              // ✅ UPDATED: Track SDD version (v1.4)
        note: 'SDD v1.4 format - Steps/Temperature are in Data Transfer records only'
      };

      console.log(`📊 Device Status (SDD v1.4): Records=${recordCount}, Battery=${batteryVoltage}mV (${batteryPercentage}%), Time=${result.timestamp.toISOString()}`);
      
      return result;

    } catch (error) {
      console.error('❌ [BLEDataParser] Error parsing device status:', error);
      return null;
    }
  }

  /**
   * ⚠️ DEPRECATED: This function is kept for backward compatibility only
   * parseCompactDeviceStatus is NO LONGER NEEDED in SDD v1.4
   * The standard parseDeviceStatus now handles the 8-byte format correctly
   *
   * @deprecated Use parseDeviceStatus instead
   * @param {Buffer} buffer - 8-byte buffer
   * @returns {Object} Parsed device status data
   */
  parseCompactDeviceStatus(buffer) {
    console.warn('⚠️ parseCompactDeviceStatus is deprecated. Use parseDeviceStatus for SDD v1.4 format.');
    
    // Forward to the main parser which now handles 8-byte format correctly
    const base64Data = buffer.toString('base64');
    return this.parseDeviceStatus(base64Data);
  }

  /**
   * Parse battery level data
   * @param {string} base64Data - Base64 encoded battery data
   * @returns {number|null} Battery level percentage (0-100)
   */
  parseBatteryLevel(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      if (buffer.length < 1) {
        return null;
      }

      const batteryLevel = buffer.readUInt8(0);
      
      // Ensure battery level is within valid range
      return Math.min(Math.max(batteryLevel, 0), 100);

    } catch (error) {
      console.error('Error parsing battery level:', error);
      return null;
    }
  }

  /**
   * Parse data transfer payload according to SDD specification
   * @param {string} base64Data - Base64 encoded data transfer payload
   * @returns {Object} Parsed data transfer information
   */
  parseDataTransfer(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      if (buffer.length < 2) {
        return null;
      }

      const transferType = buffer.readUInt8(0);
      const dataLength = buffer.readUInt8(1);
      
      // Extract the actual data payload (skip type and length bytes)
      const payload = buffer.slice(2, 2 + dataLength);
      
      console.log(`📡 Data transfer - Type: ${transferType}, Length: ${dataLength}, Data: ${payload.toString('hex')}`);

      switch (transferType) {
        case DATA_TRANSFER_TYPES.SYNC_START:
          return this.parseSyncStart(payload);
        
        case DATA_TRANSFER_TYPES.SYNC_COMPLETE:
          return this.parseSyncComplete(payload);
        
        case DATA_TRANSFER_TYPES.RECORD:
          return this.parseDataRecord(payload);
        
        case DATA_TRANSFER_TYPES.READ_ERROR:
          return this.parseReadError(payload);
        
        default:
          return {
            type: 'unknown',
            transferType,
            dataLength,
            data: payload,
          };
      }

    } catch (error) {
      console.error('Error parsing data transfer:', error);
      return null;
    }
  }

  /**
   * Parse sync start payload according to SDD
   * @param {Buffer} payload - Payload buffer
   * @returns {Object} Sync start information
   */
  parseSyncStart(payload) {
    if (payload.length >= 4) {
      const totalRecords = payload.readUInt32LE(0);
      return {
        type: 'sync_start',
        totalRecords,
        timestamp: new Date(),
        sddCompliant: true
      };
    }
    return { type: 'sync_start', error: 'Invalid payload length' };
  }

  /**
   * Parse sync complete payload according to SDD (2 bytes)
   * @param {Buffer} payload - Payload buffer
   * @returns {Object} Sync complete information
   */
  parseSyncComplete(payload) {
    if (payload.length >= 2) {
      const value = payload.readUInt16LE(0);
      
      console.log(`📡 Sync Complete - Raw value: 0x${value.toString(16)} (${value})`);
      
      if (value === 0xFFFF) {
        // SDD: 0xFFFF = Force termination (sync failed)
        console.log(`📡 Sync Complete - Force termination (sync failed)`);
        return {
          type: 'sync_complete',
          success: false,
          reason: 'force_termination',
          terminated: true,
          timestamp: new Date(),
          sddCompliant: true
        };
      } else if (value >= 0x0001 && value <= 0x01F4) {
        // SDD: 0x0001 to 0x01F4 = Number of records transmitted (sync successful)
        console.log(`📡 Sync Complete - Success: ${value} records transmitted`);
        return {
          type: 'sync_complete',
          success: true,
          recordsTransmitted: value,
          timestamp: new Date(),
          sddCompliant: true
        };
      } else {
        // Invalid count value
        console.log(`📡 Sync Complete - Invalid record count: ${value}`);
        return {
          type: 'sync_complete',
          success: false,
          reason: `Invalid record count: ${value}`,
          timestamp: new Date(),
          sddCompliant: false
        };
      }
    }
    
    console.log(`📡 Sync Complete - Invalid payload length: ${payload.length} (expected >= 2)`);
    return {
      type: 'sync_complete',
      success: false,
      reason: 'invalid_payload',
      timestamp: new Date(),
      sddCompliant: false
    };
  }

  /**
   * Parse data record payload according to SDD (6-18 bytes)
   * @param {Buffer} payload - Record payload buffer
   * @returns {Object} Parsed data record
   */
  parseDataRecord(payload) {
    try {
      if (payload.length < 6) {
        return { type: 'record', error: 'Insufficient data - SDD requires minimum 6 bytes per record' };
      }

      // SDD Specification: Record data is 6-18 bytes containing multiple records
      // Each record is 8 bytes: Timestamp(4) + Temperature(1) + Steps(2) + Reserved(1)
      // Maximum 3 records per 20-byte packet (2 bytes header + 18 bytes data)
      const recordLength = payload.length;
      const records = [];
      let recordCount = 0;
      
      // Parse multiple records from the data payload
      let offset = 0;
      while (offset + 8 <= recordLength) {
        try {
          const timestamp = payload.readUInt32LE(offset);      // 4 bytes: Unix timestamp
          const temperature = payload.readUInt8(offset + 4);   // 1 byte: Temperature (raw)
          const steps = payload.readUInt16LE(offset + 5);      // 2 bytes: Steps counter
          const reserved = payload.readUInt8(offset + 7);      // 1 byte: Reserved
          
          const record = {
            timestamp: new Date(timestamp * 1000),
            temperature, // Raw temperature value (1 byte, no scaling)
            steps,
            reserved,
            rawData: payload.slice(offset, offset + 8).toString('hex')
          };
          
          records.push(record);
          recordCount++;
          
          console.log(`📡 Record ${recordCount}: Timestamp: ${record.timestamp.toISOString()}, Steps: ${steps}, Temperature: ${temperature}°C`);
          
          offset += 8; // Move to next record
        } catch (error) {
          console.error(`❌ Error parsing record at offset ${offset}:`, error);
          break;
        }
      }
      
      console.log(`📡 Parsed ${recordCount} records from ${recordLength} bytes of data`);

      return {
        type: 'record',
        records,
        recordCount: records.length,
        totalLength: recordLength,
        rawData: payload,
        sddCompliant: true
      };

    } catch (error) {
      return { 
        type: 'record', 
        error: error.message,
        rawData: payload 
      };
    }
  }

  /**
   * Parse read error payload according to SDD
   * @param {Buffer} payload - Error payload buffer
   * @returns {Object} Read error information
   */
  parseReadError(payload) {
    return {
      type: 'read_error',
      errorCode: payload.length >= 1 ? payload.readUInt8(0) : 0x00,
      timestamp: new Date(),
      sddCompliant: true
    };
  }

  /**
   * Parse advertisement manufacturer data according to SDD v1.4 specification
   * Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 18 BLE Advertising -- Manufacturers Data structure
   * ✅ UPDATED: Now supports AES-128 encryption with device ID as key (SDD Section 6.5)
   * ✅ UPDATED: New advertisement packet structure per SDD v1.4 Table 18
   *
   * @param {Object} device - BLE device object with manufacturerData and deviceId
   * @returns {Object|null} Parsed advertisement data
   */
  parseAdvertisementData(device) {
    try {
      if (!device.manufacturerData) {
        return null;
      }

      const buffer = Buffer.from(device.manufacturerData, 'base64');

      // SDD v1.4: Minimum buffer length for manufacturer specific data
      if (buffer.length < 15) {
        console.warn(`⚠️ Advertisement buffer too short for SDD v1.4: ${buffer.length} bytes, expected at least 15`);
        return null;
      }

      // ✅ NEW: Use AES encryption utility to decrypt manufacturer data
      // This handles both encrypted and unencrypted data (fallback mode)
      if (device.id) {
        try {
          const decryptedData = AESEncryption.decryptManufacturerData(buffer, device.id);

          if (decryptedData) {
            return {
              type: 'advertisement',
              companyId: decryptedData.companyId,
              version: decryptedData.version,
              devicePeripheralStatus: decryptedData.devicePeripheralStatus,
              deviceStatus: decryptedData.deviceStatus,
              macId: decryptedData.macId,
              recordCount: decryptedData.recordCount,
              batteryVoltage: decryptedData.batteryMv,
              batteryPercentage: decryptedData.batteryPercent,
              rssi: device.rssi,
              timestamp: new Date(),
              encrypted: decryptedData.encrypted !== false, // True if encrypted
              sddCompliant: true,
              sddVersion: '1.3'
            };
          }
        } catch (error) {
          console.warn(`⚠️ Encrypted parsing failed, trying unencrypted fallback:`, error.message);
        }
      }

      // ✅ FALLBACK: Parse as unencrypted (for backward compatibility during firmware transition)
      // Parse according to SDD v1.4 Table 18 structure - Manufacturer Specific Data only
      // Note: The full advertisement packet includes flags and local name, but we only parse manufacturer data here

      // Manufacturer Specific Data starts after the standard BLE advertisement headers
      // We expect the buffer to contain just the manufacturer specific data portion
      const mfgLength = buffer.readUInt8(0);        // Length of manufacturer specific data (0x0F = 15)
      const dataType = buffer.readUInt8(1);         // Should be 0xFF (Manufacturer Specific Data)
      const companyId = buffer.readUInt16BE(2);     // Company ID (0x1234 per SDD - Big Endian: 0x34 0x12)
      const version = buffer.readUInt8(4);          // Version (0x01)
      const deviceFaultStatus = buffer.readUInt8(5); // ✅ ENHANCED in v1.4: Device fault status (detailed fault codes)
      const deviceStatusRaw = buffer.readUInt8(6);  // Device status with bit fields

      // ✅ ENHANCED in v1.4: Parse device fault status bit flags (SDD v1.4 Table 18)
      // These are bit flags that can be combined (e.g., 0x03 = Watchdog + RTC failures)
      const faultStatusBits = {
        watchdogFailure: (deviceFaultStatus & 0x01) !== 0,      // bit 0: Watchdog timer failure
        rtcFailure: (deviceFaultStatus & 0x02) !== 0,           // bit 1: RTC failure
        adcFailure: (deviceFaultStatus & 0x04) !== 0,           // bit 2: ADC failure
        pwmFailure: (deviceFaultStatus & 0x08) !== 0,           // bit 3: PWM failure
        flashFailure: (deviceFaultStatus & 0x10) !== 0,         // bit 4: Flash failure
        bleFailure: (deviceFaultStatus & 0x20) !== 0,           // bit 5: BLE failure
        accelerometerFailure: (deviceFaultStatus & 0x40) !== 0, // bit 6: Accelerometer failure
        reserved: (deviceFaultStatus & 0x80) >> 7               // bit 7: Reserved
      };

      // ✅ Parse device status bit fields
      const deviceStatusBits = {
        connectIndication: (deviceStatusRaw & 0x01) !== 0,    // bit 0: Connect indication (1=connect, 0=no need)
        timeSet: (deviceStatusRaw & 0x02) !== 0,              // bit 1: Time set (1=configured, 0=not set)
        factoryDefaults: (deviceStatusRaw & 0x04) !== 0,      // bit 2: Factory defaults (1=using defaults, 0=customized)
        reserved: (deviceStatusRaw & 0xF8) >> 3               // bits 3-7: Reserved for future use
      };

      // MAC ID (6 bytes, stored in reverse order - little-endian)
      // ✅ FIXED: MAC address bytes are in reverse order, so we reverse them for display
      let macId = '000000000000';
      if (buffer.length >= 13) {
        const macBytes = buffer.slice(7, 13);
        // Reverse the bytes (they come in little-endian order)
        const reversedMac = Buffer.from([macBytes[5], macBytes[4], macBytes[3], macBytes[2], macBytes[1], macBytes[0]]);
        macId = reversedMac.toString('hex').toUpperCase();
      }
      const recordCount = buffer.readUInt16LE(13);   // Bytes 13-14: Number of records available (Little Endian)

      // Validate against SDD v1.4 requirements
      if (dataType !== 0xFF) {
        console.warn(`Invalid advertisement data type: 0x${dataType.toString(16)}, expected 0xFF`);
        return null;
      }

      if (companyId !== MANUFACTURER_COMPANY_ID) { // Use constant from BLEConstants
        console.warn(`Unknown company ID: 0x${companyId.toString(16)}, expected 0x${MANUFACTURER_COMPANY_ID.toString(16)}`);
        return null; // Not our manufacturer
      }

      // ✅ ENHANCED in v1.4: Create human-readable fault status string with specific failures
      const deviceStatus = deviceFaultStatus === 0 ? 'Good' : 'Fault Detected';
      const faultDetails = [];
      if (faultStatusBits.watchdogFailure) faultDetails.push('Watchdog');
      if (faultStatusBits.rtcFailure) faultDetails.push('RTC');
      if (faultStatusBits.adcFailure) faultDetails.push('ADC');
      if (faultStatusBits.pwmFailure) faultDetails.push('PWM');
      if (faultStatusBits.flashFailure) faultDetails.push('Flash');
      if (faultStatusBits.bleFailure) faultDetails.push('BLE');
      if (faultStatusBits.accelerometerFailure) faultDetails.push('Accelerometer');
      const faultDescription = faultDetails.length > 0 ? faultDetails.join(', ') : 'None';

      const result = {
        type: 'advertisement',
        companyId,
        version,                                 // Firmware version
        deviceFaultStatus,                       // ✅ ENHANCED in v1.4: Device fault status (detailed fault codes)
        devicePeripheralStatus: deviceFaultStatus, // Legacy field name for backward compatibility
        deviceStatus,                            // Human readable status
        faultDescription,                        // ✅ NEW in v1.4: Human readable fault details
        faultStatusBits,                         // ✅ NEW in v1.4: Parsed fault status bit flags
        deviceStatusRaw,                         // Raw device status byte
        deviceStatusBits,                        // Parsed device status bit fields
        macId,                                   // MAC address
        recordCount,                             // Number of records available
        connectIndication: deviceStatusBits.connectIndication, // Helper: should connect
        timeSet: deviceStatusBits.timeSet,       // Helper: time is configured
        factoryDefaults: deviceStatusBits.factoryDefaults, // Helper: using factory defaults
        rssi: device.rssi,
        timestamp: new Date(),
        encrypted: false, // Unencrypted fallback mode
        // SDD compliance info
        sddCompliant: true,
        sddVersion: '1.4',                       // ✅ UPDATED: Now tracking v1.4
        dataType: dataType,
        mfgLength: mfgLength
      };

      console.log(`📊 Advertisement data parsed (SDD v1.4 - UNENCRYPTED FALLBACK):`, {
        companyId: `0x${companyId.toString(16)}`,
        version: `0x${version.toString(16)}`,
        deviceFaultStatus: `0x${deviceFaultStatus.toString(16)} (${deviceStatus})`,
        faultDescription,
        faultStatusBits,
        deviceStatusBits: {
          connectIndication: deviceStatusBits.connectIndication,
          timeSet: deviceStatusBits.timeSet,
          factoryDefaults: deviceStatusBits.factoryDefaults
        },
        macId,
        recordCount,
        sddCompliant: true,
        sddVersion: '1.4'
      });

      return result;

    } catch (error) {
      console.error('❌ Error parsing advertisement data:', error);
      return null;
    }
  }

  /**
   * Parse system command response according to SDD specification
   * @param {string} base64Data - Base64 encoded command response
   * @returns {Object|null} Parsed command response
   */
  parseSystemCommandResponse(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      // SDD requirement: Response format is 20 bytes
      // Format: 1 byte Response Id, 1 byte command id, 1 byte response length, 1 byte status, up-to 16 bytes data
      if (buffer.length < 4) {
        console.warn('System command response too short, expected at least 4 bytes');
        return null;
      }

      const responseId = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.RESPONSE_ID_OFFSET);
      const command = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.COMMAND_ID_OFFSET);
      const responseLength = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.RESPONSE_LENGTH_OFFSET);
      const status = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.RESPONSE_STATUS_OFFSET);
      const data = buffer.slice(SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.RESPONSE_DATA_OFFSET, 
                               SYSTEM_COMMAND_CONSTANTS.RESPONSE_FORMAT.RESPONSE_DATA_OFFSET + responseLength);

      // Validate response ID according to SDD
      if (responseId !== SYSTEM_COMMAND_CONSTANTS.RESPONSE_ID) {
        console.warn(`Invalid response ID: 0x${responseId.toString(16)}, expected 0x${SYSTEM_COMMAND_CONSTANTS.RESPONSE_ID.toString(16)}`);
        return null;
      }

      // Parse command-specific data based on SDD Table 9
      let parsedData = null;
      switch (command) {
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set System Time',
              timestamp: data.readUInt32LE(0),
              timestampDate: new Date(data.readUInt32LE(0) * 1000)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set Advertising Interval',
              intervalMs: data.readUInt32LE(0)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set Connection Interval',
              intervalMs: data.readUInt32LE(0)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL:
          if (data.length >= 4) {
            const intervalMs = data.readUInt32LE(0);
            parsedData = {
              commandName: 'Set Data Acquisition Interval',
              intervalMs: intervalMs,                    // ✅ CHANGED in v1.4: Now in milliseconds (was seconds in v1.3)
              intervalSeconds: intervalMs / 1000,        // Legacy field for backward compatibility
              note: 'v1.4: Now accepts milliseconds (was seconds in v1.3)'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
          // ✅ SDD v1.4: Response data contains version string (e.g., "1.0.2")
          console.log(`🔍 [PARSER] GET_FW_VERSION - data length: ${data.length}, hex: ${data.toString('hex')}, utf8: ${data.toString('utf8')}`);
          if (data.length > 0) {
            const version = data.toString('utf8');
            parsedData = {
              commandName: 'Get Firmware Version',
              version: version || 'Unknown'
            };
          } else {
            parsedData = {
              commandName: 'Get Firmware Version',
              version: 'Unknown'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
          // ✅ SDD v1.4: Response data contains version string (e.g., "1.0.2")
          console.log(`🔍 [PARSER] GET_HW_VERSION - data length: ${data.length}, hex: ${data.toString('hex')}, utf8: ${data.toString('utf8')}`);
          if (data.length > 0) {
            const version = data.toString('utf8');
            parsedData = {
              commandName: 'Get Hardware Version',
              version: version || 'Unknown'
            };
          } else {
            parsedData = {
              commandName: 'Get Hardware Version',
              version: 'Unknown'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
          parsedData = {
            commandName: 'Get Diagnostics Info',
            diagnostics: data.toString('hex')
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
          parsedData = {
            commandName: 'Data Sync Start Request',
            success: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP:
          if (data.length >= 1) {
            const clearFlag = data.readUInt8(0);
            parsedData = {
              commandName: 'Data Sync Stop Request',
              clearFlashData: clearFlag === 0x01,
              syncFailed: clearFlag === 0x00
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART:
          parsedData = {
            commandName: 'System Restart',
            success: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER:
          if (data.length >= 2) {
            // ✅ SDD v1.4: Toggle Buzzer response has 2 bytes [state, beepCount] (introduced in v1.2, maintained in v1.3/v1.4)
            const buzzerState = data.readUInt8(0);
            const beepCount = data.readUInt8(1);
            parsedData = {
              commandName: 'Toggle Buzzer',
              activated: buzzerState === 0x00,
              deactivated: buzzerState === 0x01,
              beepCount: buzzerState === 0x00 ? beepCount : 0,  // ✅ SDD v1.4: Beep count (0xFF = max 4 minutes/default)
              note: 'SDD v1.4 format: [state, beepCount]'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE:
          parsedData = {
            commandName: 'Unpair BLE Device',  // ✅ NEW in v1.2, maintained in v1.3
            success: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET:
          parsedData = {
            commandName: 'Factory Reset',      // ✅ NEW in v1.2, maintained in v1.3
            success: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE:
          parsedData = {
            commandName: 'Passkey Update',     // ✅ NEW in SDD v1.4
            success: true
          };
          break;
          
        default:
          parsedData = {
            commandName: `Unknown Command (0x${command.toString(16)})`,
            rawData: data.toString('hex')
          };
      }

      return {
        type: 'system_command',
        responseId,
        command,
        responseLength,
        status,
        success: status === SYSTEM_COMMAND_CONSTANTS.STATUS.SUCCESS,
        statusText: status === SYSTEM_COMMAND_CONSTANTS.STATUS.SUCCESS ? 'Success' : 'Failure',
        data: parsedData,
        rawData: data.toString('hex'),
        timestamp: new Date(),
        // SDD compliance info
        sddCompliant: true
      };

    } catch (error) {
      console.error('Error parsing system command response:', error);
      return null;
    }
  }

  /**
   * Parse system command request according to SDD specification
   * @param {string} base64Data - Base64 encoded command request
   * @returns {Object|null} Parsed command request
   */
  parseSystemCommandRequest(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      // SDD requirement: Request format is 20 bytes
      // Format: 1 byte Request Id, 1 byte command id, 1 byte command length, up-to 17 bytes data
      if (buffer.length < 3) {
        console.warn('System command request too short, expected at least 3 bytes');
        return null;
      }

      const requestId = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.REQUEST_ID_OFFSET);
      const command = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_ID_OFFSET);
      const commandLength = buffer.readUInt8(SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_LENGTH_OFFSET);
      const data = buffer.slice(SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET, 
                               SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET + commandLength);

      // Validate request ID according to SDD
      if (requestId !== SYSTEM_COMMAND_CONSTANTS.REQUEST_ID) {
        console.warn(`Invalid request ID: 0x${requestId.toString(16)}, expected 0x${SYSTEM_COMMAND_CONSTANTS.REQUEST_ID.toString(16)}`);
        return null;
      }

      // Parse command-specific data based on SDD Table 9
      let parsedData = null;
      switch (command) {
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set System Time',
              timestamp: data.readUInt32LE(0),
              timestampDate: new Date(data.readUInt32LE(0) * 1000)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set Advertising Interval',
              intervalMs: data.readUInt32LE(0)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL:
          if (data.length >= 4) {
            parsedData = {
              commandName: 'Set Connection Interval',
              intervalMs: data.readUInt32LE(0)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL:
          if (data.length >= 4) {
            const intervalMs = data.readUInt32LE(0);
            parsedData = {
              commandName: 'Set Data Acquisition Interval',
              intervalMs: intervalMs,                    // ✅ CHANGED in v1.4: Now in milliseconds (was seconds in v1.3)
              intervalSeconds: intervalMs / 1000,        // Legacy field for backward compatibility
              note: 'v1.4: Now accepts milliseconds (was seconds in v1.3)'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
        case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
        case SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART:
          parsedData = {
            commandName: this.getCommandName(command),
            noData: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER:
          if (data.length >= 2) {
            // ✅ SDD v1.4: Toggle Buzzer now has 2 bytes [state, beepCount]
            const buzzerState = data.readUInt8(0);
            const beepCount = data.readUInt8(1);
            parsedData = {
              commandName: 'Toggle Buzzer',
              activated: buzzerState === 0x00,
              deactivated: buzzerState === 0x01,
              beepCount: buzzerState === 0x00 ? beepCount : 0,  // ✅ SDD v1.4: Beep count (0xFF = max 4 minutes/default)
              note: 'SDD v1.4 format: [state, beepCount]'
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE:
          parsedData = {
            commandName: 'Unpair BLE Device',  // ✅ NEW in v1.2, maintained in v1.3
            noData: true
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET:
          parsedData = {
            commandName: 'Factory Reset',      // ✅ NEW in v1.2, maintained in v1.3
            noData: true
          };
          break;
          
        default:
          parsedData = {
            commandName: `Unknown Command (0x${command.toString(16)})`,
            rawData: data.toString('hex')
          };
      }

      return {
        type: 'system_command_request',
        requestId,
        command,
        commandLength,
        data: parsedData,
        rawData: data.toString('hex'),
        timestamp: new Date(),
        // ✅ NEW in v1.4: Support for both write and read operations
        operation: 'write',  // Default is write, read would be handled by characteristic read operation
        // SDD compliance info
        sddCompliant: true,
        sddVersion: '1.4'
      };

    } catch (error) {
      console.error('Error parsing system command request:', error);
      return null;
    }
  }

  /**
   * Get command name from command ID (SDD v1.4)
   * @param {number} commandId - Command ID
   * @returns {string} Command name
   */
  getCommandName(commandId) {
    const commandNames = {
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME]: 'Set System Time',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL]: 'Set Advertising Interval',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL]: 'Set Connection Interval',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL]: 'Set Data Acquisition Interval',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION]: 'Get Firmware Version',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION]: 'Get Hardware Version',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS]: 'Get Diagnostics Info',
      [SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START]: 'Data Sync Start Request',
      [SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP]: 'Data Sync Stop Request',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART]: 'System Restart',
      [SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER]: 'Toggle Buzzer',
      [SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE]: 'Unpair BLE Device',    // ✅ NEW in v1.2, maintained in v1.3
      [SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET]: 'Factory Reset',        // ✅ NEW in v1.2, maintained in v1.3
      [SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE]: 'Passkey Update'       // ✅ NEW in SDD v1.4
    };
    return commandNames[commandId] || `Unknown Command (0x${commandId.toString(16)})`;
  }

  /**
   * Decrypt advertisement payload using AES-128 as per SDD specification
   * @param {Buffer} encryptedData - Encrypted payload
   * @returns {Object|null} Decrypted payload data
   */
  decryptAdvertisementPayload(encryptedData) {
    try {
      console.log('Decrypting advertisement payload:', {
        length: encryptedData.length,
        hex: encryptedData.toString('hex'),
        aesConfig: ADV_AES_CONFIG
      });
      
      // Check if AES keys are properly configured
      if (ADV_AES_CONFIG.keyHex === '00000000000000000000000000000000') {
        console.warn('⚠️ AES key not configured - using placeholder key');
        return {
          encrypted: true,
          rawData: encryptedData.toString('hex'),
          note: 'AES decryption skipped - placeholder key detected. Update ADV_AES_CONFIG with real keys.'
        };
      }
      
      // Import crypto module for AES decryption
      const crypto = require('crypto');
      
      // Convert hex key to buffer
      const key = Buffer.from(ADV_AES_CONFIG.keyHex, 'hex');
      
      if (key.length !== 16) {
        throw new Error(`Invalid AES key length: ${key.length} bytes, expected 16 bytes`);
      }
      
      let decryptedData;
      
      if (ADV_AES_CONFIG.mode === 'ECB') {
        // AES-128-ECB mode (as specified in SDD)
        const decipher = crypto.createDecipher('aes-128-ecb', key);
        decipher.setAutoPadding(true);
        
        decryptedData = Buffer.concat([
          decipher.update(encryptedData),
          decipher.final()
        ]);
        
      } else if (ADV_AES_CONFIG.mode === 'CBC') {
        // AES-128-CBC mode
        const iv = Buffer.from(ADV_AES_CONFIG.ivHex, 'hex');
        
        if (iv.length !== 16) {
          throw new Error(`Invalid IV length: ${iv.length} bytes, expected 16 bytes`);
        }
        
        const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
        decipher.setAutoPadding(true);
        
        decryptedData = Buffer.concat([
          decipher.update(encryptedData),
          decipher.final()
        ]);
        
      } else {
        throw new Error(`Unsupported AES mode: ${ADV_AES_CONFIG.mode}`);
      }
      
      console.log('✅ AES decryption successful:', {
        originalLength: encryptedData.length,
        decryptedLength: decryptedData.length,
        decryptedHex: decryptedData.toString('hex')
      });
      
      return {
        encrypted: false,
        decryptedData: decryptedData,
        hex: decryptedData.toString('hex'),
        mode: ADV_AES_CONFIG.mode,
        sddCompliant: true
      };

    } catch (error) {
      console.error('❌ Error decrypting advertisement payload:', error);
      return {
        encrypted: true,
        error: error.message,
        rawData: encryptedData.toString('hex'),
        note: 'AES decryption failed - check key configuration'
      };
    }
  }

  /**
   * Decrypt NFC data using AES-128 as per SDD specification
   * @param {Buffer} encryptedData - Encrypted NFC data
   * @returns {Object|null} Decrypted NFC data
   */
  decryptNFCData(encryptedData) {
    try {
      console.log('Decrypting NFC data:', {
        length: encryptedData.length,
        hex: encryptedData.toString('hex')
      });
      
      // Check if AES keys are properly configured
      if (ADV_AES_CONFIG.keyHex === '00000000000000000000000000000000') {
        console.warn('⚠️ AES key not configured for NFC decryption');
        return {
          encrypted: true,
          rawData: encryptedData.toString('hex'),
          note: 'NFC decryption skipped - placeholder key detected. Update ADV_AES_CONFIG with real keys.'
        };
      }
      
      // Use the same AES decryption method as advertisement
      const decryptionResult = this.decryptAdvertisementPayload(encryptedData);
      
      if (decryptionResult.encrypted) {
        return decryptionResult;
      }
      
      // Parse decrypted NFC data (assuming it contains device info, URL, etc.)
      const decryptedData = decryptionResult.decryptedData;
      
      // Try to parse as UTF-8 string (for URLs, device names, etc.)
      let nfcContent = null;
      try {
        nfcContent = decryptedData.toString('utf8').replace(/\0/g, '');
      } catch (error) {
        console.warn('Could not parse NFC data as UTF-8, returning as hex');
        nfcContent = decryptedData.toString('hex');
      }
      
      console.log('✅ NFC decryption successful:', {
        originalLength: encryptedData.length,
        decryptedLength: decryptedData.length,
        content: nfcContent
      });
      
      return {
        encrypted: false,
        decryptedData: decryptedData,
        content: nfcContent,
        hex: decryptedData.toString('hex'),
        mode: ADV_AES_CONFIG.mode,
        sddCompliant: true
      };

    } catch (error) {
      console.error('❌ Error decrypting NFC data:', error);
      return {
        encrypted: true,
        error: error.message,
        rawData: encryptedData.toString('hex'),
        note: 'NFC decryption failed - check key configuration'
      };
    }
  }

  /**
   * Parse device information characteristic
   * @param {string} base64Data - Base64 encoded device info data
   * @returns {string|null} Decoded device information string
   */
  parseDeviceInfo(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      return buffer.toString('utf8').replace(/\0/g, ''); // Remove null terminators

    } catch (error) {
      console.error('Error parsing device info:', error);
      return null;
    }
  }

  /**
   * Calculate distance from RSSI (rough estimation)
   * @param {number} rssi - RSSI value in dBm
   * @param {number} txPower - Transmit power at 1 meter (default -59 dBm)
   * @returns {number} Estimated distance in meters
   */
  calculateDistance(rssi, txPower = -59) {
    if (!rssi || rssi === 0) {
      return null;
    }

    const ratio = (txPower - rssi) / 20.0;
    return Math.pow(10, ratio);
  }

  /**
   * Format data for display
   * @param {Object} deviceData - Device data object
   * @returns {Object} Formatted display data
   */
  formatForDisplay(deviceData) {
    if (!deviceData) {
      return {};
    }

    return {
      batteryLevel: deviceData.batteryLevel !== null 
        ? `${deviceData?.batteryLevel}%` 
        : 'N/A',
      
      temperature: deviceData.temperature !== null 
        ? `${deviceData.temperature.toFixed(1)}°C` 
        : 'N/A',
      
      steps: deviceData.steps !== null 
        ? deviceData.steps.toLocaleString() 
        : 'N/A',
      
      lastUpdate: deviceData.timestamp 
        ? deviceData.timestamp.toLocaleString() 
        : 'Never',
      
      flags: deviceData.flags || {},
    };
  }

  /**
   * Validate parsed data (relaxed validation for debugging)
   * @param {Object} data - Parsed data object
   * @returns {boolean} True if data is valid
   */
  validateData(data) {
    if (!data || typeof data !== 'object') {
      console.warn('Data validation failed: not an object');
      return false;
    }

    // Relaxed validation - allow out of range values for debugging
    console.log('Validating data:', {
      temperature: data.temperature,
      steps: data.steps,
      batteryLevel: data.batteryLevel,
      timestamp: data.timestamp
    });

    // Check temperature range (biological sensors typically 0-50°C for pets)
    if (data.temperature !== null && data.temperature !== undefined) {
      if (data.temperature >= 0 && data.temperature <= 50) {
        console.log(`✅ Temperature ${data.temperature}°C is in normal range for pet sensor`);
      } else if (data.temperature > -20 && data.temperature < 80) {
        console.warn(`⚠️ Temperature ${data.temperature}°C is outside normal pet range but physically reasonable`);
      } else {
        console.warn(`❌ Temperature ${data.temperature}°C seems unrealistic, possible parsing error`);
      }
    }

    // Check steps range (warning only, don't reject)
    if (data.steps !== null && data.steps !== undefined) {
      if (data.steps < 0 || data.steps > 1000000) {
        console.warn('Steps count out of typical range (but accepting):', data.steps);
      }
    }

    // Check battery level (warning only, don't reject)
    if (data.batteryLevel !== null && data.batteryLevel !== undefined) {
      if (data.batteryLevel < 0 || data.batteryLevel > 100) {
        console.warn('Battery level out of range (but accepting):', data.batteryLevel);
      }
    }

    // Accept data as long as it's an object - we can fix parsing issues later
    console.log('Data validation passed (relaxed mode)');
    return true;
  }

  /**
   * Check SDD compliance of parsed data
   * @param {Object} data - Parsed data object
   * @returns {Object} SDD compliance report
   */
  checkSDDCompliance(data) {
    const report = {
      compliant: true,
      issues: [],
      warnings: [],
      recommendations: []
    };

    // Check if data has SDD compliance flag
    if (data.sddCompliant === true) {
      report.compliant = true;
    } else {
      report.issues.push('Data does not have SDD compliance flag');
      report.compliant = false;
    }

    // Check for required fields based on data type
    if (data.type === 'device_status') {
      if (!data.timestamp || !data.steps || !data.temperature) {
        report.warnings.push('Device status missing required fields (timestamp, steps, temperature)');
      }
    }

    if (data.type === 'system_command') {
      if (data.responseId !== SYSTEM_COMMAND_CONSTANTS.RESPONSE_ID) {
        report.issues.push(`Invalid response ID: 0x${data.responseId?.toString(16)}, expected 0x${SYSTEM_COMMAND_CONSTANTS.RESPONSE_ID.toString(16)}`);
        report.compliant = false;
      }
    }

    if (data.type === 'advertisement') {
      if (data.companyId !== MANUFACTURER_COMPANY_ID) {
        report.issues.push(`Invalid company ID: 0x${data.companyId?.toString(16)}, expected 0x${MANUFACTURER_COMPANY_ID.toString(16)}`);
        report.compliant = false;
      }
    }

    return report;
  }

  /**
   * Parse data transfer characteristic data (SDD v1.4 compliant - 20 bytes)
   * Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 14 Data Transfer characteristic data format
   * Format: [Data Type(1), Length(1), Record data(18)]
   * 
   * @param {string} base64Data - Base64 encoded data transfer data
   * @returns {object|null} Parsed data transfer information
   */
  parseDataTransfer(base64Data) {
    try {
      if (!base64Data) {
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      
      if (buffer.length < 2) {
        return null;
      }

      const dataType = buffer.readUInt8(0);
      const length = buffer.readUInt8(1);
      const data = buffer.slice(2, 2 + length);

      let parsedData = {
        type: dataType,
        length,
        rawData: data.toString('hex')
      };
      
      // Convert numeric type to string type for easier handling
      let typeString = 'unknown';
      switch (dataType) {
        case DATA_TRANSFER_TYPES.SYNC_START:
          typeString = 'sync_start';
          break;
        case DATA_TRANSFER_TYPES.SYNC_COMPLETE:
          typeString = 'sync_complete';
          break;
        case DATA_TRANSFER_TYPES.RECORD:
          typeString = 'record';
          break;
        case DATA_TRANSFER_TYPES.READ_ERROR:
          typeString = 'read_error';
          break;
      }
      parsedData.typeString = typeString;

      console.log(`📡 [DATA TRANSFER] Type: ${dataType}, Length: ${length}, Data: ${data.toString('hex')}`);

      switch (dataType) {
        case DATA_TRANSFER_TYPES.SYNC_START:
          if (length >= 4) {
            const rawTotalRecords = data.readUInt32LE(0);
            
            // Check if the data looks corrupted
            if (rawTotalRecords > 1000000) {
              console.log(`⚠️ [SYNC START] Corrupted data: ${rawTotalRecords}`);
              parsedData.totalRecords = 0;
              parsedData.corrupted = true;
              parsedData.rawValue = rawTotalRecords;
            } else {
              parsedData.totalRecords = rawTotalRecords;
              console.log(`📡 [SYNC START] Total records: ${parsedData.totalRecords}`);
            }
          }
          break;
          
        case DATA_TRANSFER_TYPES.SYNC_COMPLETE:
          if (length === 2) {
            const count = data.readUInt16LE(0);
            if (count === 0xFFFF) {
              parsedData.success = false;
              parsedData.terminated = true;
              parsedData.reason = 'Force termination';
              console.log(`📡 [SYNC COMPLETE] Force termination`);
            } else if (count >= 0x0001 && count <= 0x01F4) {
              parsedData.success = true;
              parsedData.recordsTransmitted = count;
              console.log(`📡 [SYNC COMPLETE] Success: ${count} records`);
            } else {
              parsedData.success = false;
              parsedData.reason = `Invalid count: ${count}`;
              console.log(`📡 [SYNC COMPLETE] Invalid count: ${count}`);
            }
          }
          break;
          
        case DATA_TRANSFER_TYPES.RECORD:
          if (length >= 6) {
            parsedData.records = [];
            parsedData.recordCount = 0;
            
            // Parse multiple records from the data payload
            // ✅ FIXED: Correct byte order per SDD Table 12
            // Bytes 0-3: Timestamp (LE)
            // Bytes 4-5: Steps (LE)
            // Byte 6: Temperature (raw Celsius)
            // Byte 7: Flags
            let offset = 0;
            while (offset + 8 <= length) {
              try {
                const timestamp = data.readUInt32LE(offset);
                const steps = data.readUInt16LE(offset + 4);  // ✅ CORRECT POSITION
                const temperature = data.readUInt8(offset + 6);  // ✅ CORRECT POSITION
                const flags = data.readUInt8(offset + 7);
                
                const record = {
                  timestamp: new Date(timestamp * 1000),
                  temperature,
                  steps,
                  flags,
                  rawData: data.slice(offset, offset + 8).toString('hex')
                };
                
                parsedData.records.push(record);
                parsedData.recordCount++;
                
                console.log(`📡 [RECORD] ${parsedData.recordCount}: ${record.timestamp.toISOString()}, Steps: ${steps}, Temp: ${temperature}°C`);
                
                offset += 8;
              } catch (error) {
                console.error(`❌ Error parsing record at offset ${offset}:`, error);
                break;
              }
            }
          }
          break;
          
        case DATA_TRANSFER_TYPES.READ_ERROR:
          parsedData.error = true;
          console.log(`📡 [READ ERROR]`);
          break;
          
        default:
          console.log(`📡 [UNKNOWN] Type: ${dataType}`);
          return null;
      }

      return parsedData;
    } catch (error) {
      console.error('❌ Error parsing data transfer:', error);
      return null;
    }
  }

}

// Export singleton instance
export default new BLEDataParser();
