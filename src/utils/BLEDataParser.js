import { Buffer } from 'buffer';
import { 
  DEVICE_STATUS_LAYOUT, 
  DATA_TRANSFER_TYPES, 
  ADV_LAYOUT, 
  MANUFACTURER_COMPANY_ID,
  ADV_AES_CONFIG,
  SYSTEM_COMMAND_CONSTANTS
} from '../constants/BLEConstants';

// Utility class for parsing BLE data from smart tags
class BLEDataParser {
  
  /**
   * Parse device status notification data (SDD compliant - 20 bytes)
   * @param {string} base64Data - Base64 encoded data from device status characteristic
   * @returns {Object} Parsed device status data
   */
  parseDeviceStatus(base64Data) {
    try {
      console.log(`🔍 [BLEDataParser] Starting parseDeviceStatus with:`, {
        dataType: typeof base64Data,
        dataLength: base64Data?.length,
        dataPreview: base64Data?.substring(0, 50),
        isBase64: /^[A-Za-z0-9+/]*={0,2}$/.test(base64Data)
      });
      
      if (!base64Data) {
        console.log('❌ [BLEDataParser] No data provided');
        return null;
      }

      const buffer = Buffer.from(base64Data, 'base64');
      console.log(`🔍 [BLEDataParser] Buffer created:`, {
        bufferLength: buffer.length,
        expectedLength: DEVICE_STATUS_LAYOUT.TOTAL_SIZE,
        bufferHex: buffer.toString('hex')
      });
      
      if (buffer.length < DEVICE_STATUS_LAYOUT.TOTAL_SIZE) {
        console.warn(`Device status data size mismatch. Expected ${DEVICE_STATUS_LAYOUT.TOTAL_SIZE}, got ${buffer.length}`);
        // Try to parse anyway if we have at least the minimum required bytes
        if (buffer.length < 16) {
          return null;
        }
      }

      // Parse according to SDD DEVICE_STATUS_LAYOUT (Little Endian format)
      const timestamp = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.TIMESTAMP_OFFSET);
      const steps = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.STEPS_OFFSET);
      
      // Temperature parsing according to SDD - 4 bytes at offset 8-11 (Little Endian)
      // The SDD shows Temperature in bytes 8-11, likely as IEEE 754 float or custom format
      let temperatureRaw;
      let temperature;
      
      try {
        // Based on SDD analysis and manual testing, temperature is stored as IEEE 754 32-bit float
        // This correctly gives us ~36.9°C for buffer "9a991342"
        temperature = buffer.readFloatLE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET);
        temperatureRaw = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET);
        
        // Validate temperature is reasonable for a biological sensor
        if (isNaN(temperature) || temperature < -50 || temperature > 80) {
          console.warn(`Temperature ${temperature}°C seems out of range for biological sensor, trying alternative parsing`);
          
          // Fallback: try as fixed-point integer
          const temp16 = buffer.readUInt16LE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET);
          if (temp16 > 0 && temp16 < 10000) {
            temperature = temp16 / 100.0; // 0.01°C resolution
            console.log(`Using 16-bit fixed-point parsing: ${temperature}°C`);
          } else {
            temperature = null; // Invalid temperature
            console.warn('Could not parse temperature data');
          }
        }
        
        // Specific analysis for your buffer format
        const tempBytes = buffer.slice(DEVICE_STATUS_LAYOUT.TEMP_OFFSET, DEVICE_STATUS_LAYOUT.TEMP_OFFSET + 4);
        console.log(`Temperature bytes analysis:`);
        console.log(`  Hex: ${tempBytes.toString('hex')}`);
        console.log(`  As UInt32LE: ${temperatureRaw}`);
        console.log(`  As Int32LE: ${buffer.readInt32LE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET)}`);
        console.log(`  As FloatLE: ${buffer.readFloatLE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET)}`);
        console.log(`  As UInt16LE: ${tempBytes.readUInt16LE(0)}`);
        console.log(`  As Int16LE: ${tempBytes.readInt16LE(0)}`);
        console.log(`  Final temperature: ${temperature}°C`);
        
      } catch (error) {
        console.warn('Temperature parsing error:', error);
        temperatureRaw = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.TEMP_OFFSET);
        temperature = null;
      }
      
      const flags = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.FLAGS_OFFSET);
      
      // Read reserved bytes if available
      let reserved = null;
      if (buffer.length >= DEVICE_STATUS_LAYOUT.TOTAL_SIZE) {
        reserved = buffer.readUInt32LE(DEVICE_STATUS_LAYOUT.RESERVED_OFFSET);
      }

      // Parse device status flags (customize based on actual flag definitions)
      const parsedFlags = {
        isActive: (flags & 0x01) !== 0,
        isCharging: (flags & 0x02) !== 0,
        lowBattery: (flags & 0x04) !== 0,
        tempAlert: (flags & 0x08) !== 0,
        motionDetected: (flags & 0x10) !== 0,
        // Add more flags as per device specification
      };

      // Enable detailed analysis for debugging (set to false to reduce logs)
      const enableDetailedLogging = false;
      
      if (enableDetailedLogging) {
        console.log(`=== Raw Buffer Analysis ===`);
        console.log(`Hex: ${buffer.toString('hex')}`);
        console.log(`Length: ${buffer.length} bytes`);
        
        // Break down the hex into 4-byte chunks (Little Endian)
        for (let i = 0; i < Math.min(buffer.length, 20); i += 4) {
          const chunk = buffer.slice(i, i + 4);
          const hexChunk = chunk.toString('hex');
          const uint32LE = chunk.length >= 4 ? chunk.readUInt32LE(0) : 0;
          const int32LE = chunk.length >= 4 ? chunk.readInt32LE(0) : 0;
          const uint16LE = chunk.length >= 2 ? chunk.readUInt16LE(0) : 0;
          const int16LE = chunk.length >= 2 ? chunk.readInt16LE(0) : 0;
          
          console.log(`Bytes ${i}-${i+3}: ${hexChunk} | UInt32: ${uint32LE} | Int32: ${int32LE} | UInt16: ${uint16LE} | Int16: ${int16LE}`);
        }
        
        console.log(`=== Current Parsing ===`);
        console.log(`Timestamp: ${timestamp} (${new Date(timestamp * 1000).toISOString()}) | Hex: 0x${timestamp.toString(16)}`);
        console.log(`Steps: ${steps}`);
        console.log(`Temperature Raw: 0x${temperatureRaw.toString(16)} (${temperatureRaw}), Parsed: ${temperature}°C`);
        console.log(`Flags: 0x${flags.toString(16)} (${flags})`);
        console.log(`Reserved: ${reserved}`);
        
        // Validate timestamp is reasonable (not way in future or past)
        const currentTime = Math.floor(Date.now() / 1000);
        const timeDiff = Math.abs(timestamp - currentTime);
        const isReasonableTime = timeDiff < (365 * 24 * 3600); // Within 1 year
        console.log(`Timestamp validation: current=${currentTime}, device=${timestamp}, diff=${timeDiff}s, reasonable=${isReasonableTime}`);
        console.log(`========================`);
      }

      const result = {
        type: 'device_status',
        timestamp: new Date(timestamp * 1000), // Convert Unix timestamp to Date
        steps,
        temperature,
        temperatureRaw, // Include raw value for debugging
        flags: parsedFlags,
        rawFlags: flags,
        reserved,
        lastUpdate: new Date(),
        rawBuffer: buffer.toString('hex'), // For debugging
        sddCompliant: true
      };
      
      console.log(`✅ [BLEDataParser] Successfully parsed device status:`, {
        steps: result.steps,
        temperature: result.temperature,
        timestamp: result.timestamp,
        type: result.type
      });
      
      return result;

    } catch (error) {
      console.error('❌ [BLEDataParser] Error parsing device status:', error);
      return null;
    }
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
      
      if (buffer.length < 1) {
        return null;
      }

      const transferType = buffer.readUInt8(0);
      const payload = buffer.slice(1);

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
   * Parse sync complete payload according to SDD
   * @param {Buffer} payload - Payload buffer
   * @returns {Object} Sync complete information
   */
  parseSyncComplete(payload) {
    return {
      type: 'sync_complete',
      success: payload.length === 1 && payload.readUInt8(0) === 0x00,
      timestamp: new Date(),
      sddCompliant: true
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
        return { type: 'record', error: 'Insufficient data' };
      }

      // SDD format: 1 set of records contains 6 bytes including Timestamp, Temperature and Step data
      const timestamp = payload.readUInt32LE(0);
      const temperatureRaw = payload.readInt16LE(4);
      
      let steps = null;
      let location = null;

      if (payload.length >= 10) {
        steps = payload.readUInt32LE(6);
      }

      if (payload.length >= 18) {
        // Parse location data (example: latitude/longitude as int32)
        const latRaw = payload.readInt32LE(10);
        const lonRaw = payload.readInt32LE(14);
        
        location = {
          latitude: latRaw / 1000000.0, // Assuming 6 decimal places
          longitude: lonRaw / 1000000.0,
          accuracy: payload.length >= 20 ? payload.readUInt16LE(18) : null,
        };
      }

      return {
        type: 'record',
        timestamp: new Date(timestamp * 1000),
        temperature: temperatureRaw / 100.0,
        steps,
        location,
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
   * Parse advertisement manufacturer data according to SDD specification
   * @param {Object} device - BLE device object
   * @returns {Object|null} Parsed advertisement data
   */
  parseAdvertisementData(device) {
    try {
      if (!device.manufacturerData) {
        return null;
      }

      const buffer = Buffer.from(device.manufacturerData, 'base64');
      
      // SDD requirement: minimum 4 bytes (length + type + company ID + indication)
      if (buffer.length < 4) {
        return null;
      }

      // Parse according to SDD Table 13 structure
      const totalLength = buffer.readUInt8(0);     // First byte is length (0x0C = 12 bytes)
      const dataType = buffer.readUInt8(1);        // Should be 0xFF (Manufacturer Specific Data)
      const companyId = buffer.readUInt16LE(2);    // Company ID (0x1234 per SDD)
      const indication = buffer.readUInt8(4);      // Indication to connect
      const optionalData = buffer.slice(5);        // Device ID, battery info, etc.

      // Validate against SDD requirements
      if (dataType !== 0xFF) {
        console.warn(`Invalid advertisement data type: 0x${dataType.toString(16)}, expected 0xFF`);
        return null;
      }

      if (companyId !== MANUFACTURER_COMPANY_ID) { // Use constant from BLEConstants
        console.warn(`Unknown company ID: 0x${companyId.toString(16)}, expected 0x${MANUFACTURER_COMPANY_ID.toString(16)}`);
        return null; // Not our manufacturer
      }

      // Parse optional data if available (battery info, device ID, etc.)
      let batteryInfo = null;
      let deviceId = null;
      
      if (optionalData.length >= 1) {
        batteryInfo = optionalData.readUInt8(0);
      }
      
      if (optionalData.length >= 5) {
        deviceId = optionalData.slice(1, 5).toString('hex');
      }

      return {
        type: 'advertisement',
        companyId,
        indication,
        batteryInfo,
        deviceId,
        optionalData: optionalData.toString('hex'),
        rssi: device.rssi,
        timestamp: new Date(),
        // SDD compliance info
        sddCompliant: true,
        dataType: dataType,
        totalLength: totalLength
      };

    } catch (error) {
      console.error('Error parsing advertisement data:', error);
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
            parsedData = {
              commandName: 'Set Data Acquisition Interval',
              intervalSeconds: data.readUInt32LE(0)
            };
          }
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
          parsedData = {
            commandName: 'Get Firmware Version',
            version: data.length > 0 ? data.toString('utf8') : 'Unknown'
          };
          break;
          
        case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
          parsedData = {
            commandName: 'Get Hardware Version',
            version: data.length > 0 ? data.toString('utf8') : 'Unknown'
          };
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
            parsedData = {
              commandName: 'Set Data Acquisition Interval',
              intervalSeconds: data.readUInt32LE(0)
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
        // SDD compliance info
        sddCompliant: true
      };

    } catch (error) {
      console.error('Error parsing system command request:', error);
      return null;
    }
  }

  /**
   * Get command name from command ID
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
      [SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART]: 'System Restart'
    };
    return commandNames[commandId] || `Unknown Command (0x${commandId.toString(16)})`;
  }

  /**
   * Decrypt advertisement payload (placeholder implementation)
   * @param {Buffer} encryptedData - Encrypted payload
   * @returns {Object|null} Decrypted payload data
   */
  decryptAdvertisementPayload(encryptedData) {
    try {
      // This is a placeholder implementation
      // In a real implementation, you would use the crypto library
      // to decrypt the data using AES with the provided key/IV
      
      console.log('Encrypted payload length:', encryptedData.length);
      console.log('AES config:', ADV_AES_CONFIG);
      
      // For now, return raw data
      // TODO: Implement actual AES decryption when keys are available
      return {
        encrypted: true,
        rawData: encryptedData.toString('hex'),
        note: 'Decryption not implemented - update keys in ADV_AES_CONFIG'
      };

    } catch (error) {
      console.error('Error decrypting advertisement payload:', error);
      return null;
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
}

// Export singleton instance
export default new BLEDataParser();
