import CryptoJS from 'crypto-js';
import { Buffer } from 'buffer';

/**
 * AES Encryption Utility for Smart Health Tag
 * Uses Device ID as the encryption key (per project requirements)
 * 
 * SDD Compliance:
 * - Section 6.5: BLE Advertising Packet encryption
 * - Section 6.6: NFC Tag configuration and security
 * - Uses AES-128 ECB mode as specified in SDD
 */
class AESEncryption {
  
  /**
   * Generate AES key from Device ID
   * Device ID is typically a MAC address or UUID
   * We'll convert it to a 128-bit (16 byte) key
   * 
   * @param {string} deviceId - Device identifier (MAC address, UUID, etc.)
   * @returns {CryptoJS.lib.WordArray} - 128-bit AES key
   */
  static generateKeyFromDeviceId(deviceId) {
    if (!deviceId || typeof deviceId !== 'string') {
      throw new Error('Invalid device ID for key generation');
    }
    
    // Remove common separators (colons, hyphens, spaces)
    const cleanDeviceId = deviceId.replace(/[:\-\s]/g, '').toUpperCase();
    
    // Use SHA-256 hash of device ID and take first 128 bits (16 bytes)
    const hash = CryptoJS.SHA256(cleanDeviceId);
    
    // Take first 128 bits (4 words * 32 bits = 128 bits)
    const key = CryptoJS.lib.WordArray.create(hash.words.slice(0, 4));
    
    console.log(`🔐 Generated AES key from device ID: ${deviceId.substring(0, 8)}...`);
    
    return key;
  }
  
  /**
   * Encrypt data using AES-128 ECB mode
   * Used for NFC write operations (SDD Section 6.6)
   * 
   * @param {string|Buffer|Uint8Array} data - Data to encrypt
   * @param {string} deviceId - Device ID used as encryption key
   * @returns {string} - Base64 encoded encrypted data
   */
  static encrypt(data, deviceId) {
    try {
      const key = this.generateKeyFromDeviceId(deviceId);
      
      // Convert data to WordArray
      let dataWordArray;
      if (typeof data === 'string') {
        dataWordArray = CryptoJS.enc.Utf8.parse(data);
      } else if (Buffer.isBuffer(data)) {
        dataWordArray = CryptoJS.lib.WordArray.create(data);
      } else if (data instanceof Uint8Array) {
        dataWordArray = CryptoJS.lib.WordArray.create(Array.from(data));
      } else {
        throw new Error('Unsupported data type for encryption');
      }
      
      // Encrypt using AES-128 ECB mode (as per SDD)
      const encrypted = CryptoJS.AES.encrypt(dataWordArray, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
      });
      
      // Return base64 encoded ciphertext
      const encryptedBase64 = encrypted.ciphertext.toString(CryptoJS.enc.Base64);
      
      console.log(`🔒 Encrypted ${dataWordArray.sigBytes} bytes -> ${encryptedBase64.length} base64 chars`);
      
      return encryptedBase64;
    } catch (error) {
      console.error('❌ Encryption failed:', error);
      throw new Error(`AES encryption failed: ${error.message}`);
    }
  }
  
  /**
   * Decrypt data using AES-128 ECB mode
   * Used for manufacturer data decryption (SDD Section 6.5)
   * 
   * @param {string|Buffer|Uint8Array} encryptedData - Encrypted data (base64 or raw bytes)
   * @param {string} deviceId - Device ID used as decryption key
   * @returns {Buffer} - Decrypted data as Buffer
   */
  static decrypt(encryptedData, deviceId) {
    try {
      const key = this.generateKeyFromDeviceId(deviceId);
      
      // Convert encrypted data to base64 string if needed
      let encryptedBase64;
      if (typeof encryptedData === 'string') {
        encryptedBase64 = encryptedData;
      } else if (Buffer.isBuffer(encryptedData)) {
        encryptedBase64 = encryptedData.toString('base64');
      } else if (encryptedData instanceof Uint8Array) {
        encryptedBase64 = Buffer.from(encryptedData).toString('base64');
      } else {
        throw new Error('Unsupported encrypted data type');
      }
      
      // Decrypt using AES-128 ECB mode
      const decrypted = CryptoJS.AES.decrypt(encryptedBase64, key, {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7
      });
      
      // Convert WordArray to Buffer
      const decryptedBytes = [];
      for (let i = 0; i < decrypted.sigBytes; i++) {
        const byte = (decrypted.words[Math.floor(i / 4)] >>> (24 - (i % 4) * 8)) & 0xff;
        decryptedBytes.push(byte);
      }
      
      const decryptedBuffer = Buffer.from(decryptedBytes);
      
      console.log(`🔓 Decrypted ${encryptedBase64.length} base64 chars -> ${decryptedBuffer.length} bytes`);
      
      return decryptedBuffer;
    } catch (error) {
      console.error('❌ Decryption failed:', error);
      throw new Error(`AES decryption failed: ${error.message}`);
    }
  }
  
  /**
   * Decrypt manufacturer data from BLE advertising packet
   * SDD Section 6.5: BLE Advertising Packet Structure (updated for v1.3)
   *
   * Format (after Company ID):
   * - Byte 0-1: Company ID (0x1234) - already parsed
   * - Remaining bytes: Encrypted payload
   *
   * Decrypted payload format (SDD v1.4):
   * Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 18 BLE Advertising -- Manufacturers Data structure
   * - Byte 0: Length of manufacturer specific data (0x0F)
   * - Byte 1: Type (0xFF - Manufacturer Specific Data)
   * - Byte 2-3: Company ID (0x1234)
   * - Byte 4: Version
   * - Byte 5: Device peripheral status
   * - Byte 6: Device status (bit fields)
   * - Byte 7-12: MAC ID (6 bytes)
   * - Byte 13-14: Number of records available (Little Endian)
   *
   * @param {Buffer} manufacturerData - Raw manufacturer data from advertising
   * @param {string} deviceId - Device ID for decryption
   * @returns {Object} - Parsed decrypted data
   */
  static decryptManufacturerData(manufacturerData, deviceId) {
    try {
      if (!manufacturerData || manufacturerData.length < 2) {
        throw new Error('Manufacturer data too short');
      }
      
      // Extract company ID (first 2 bytes, Little Endian)
      const companyId = manufacturerData.readUInt16LE(0);
      
      // Extract encrypted payload (skip company ID)
      const encryptedPayload = manufacturerData.slice(2);
      
      console.log(`📡 Manufacturer Data: CompanyID=0x${companyId.toString(16).toUpperCase()}, EncryptedLen=${encryptedPayload.length}`);
      
      if (encryptedPayload.length === 0) {
        throw new Error('No encrypted payload found');
      }
      
      // Decrypt the payload using device ID as key
      const decryptedPayload = this.decrypt(encryptedPayload, deviceId);

      // Parse decrypted data according to SDD v1.4 Table 18
      // Manufacturer Specific Data format (15 bytes total)
      const mfgLength = decryptedPayload.length > 0 ? decryptedPayload.readUInt8(0) : 0;
      const dataType = decryptedPayload.length > 1 ? decryptedPayload.readUInt8(1) : 0;
      const parsedCompanyId = decryptedPayload.length >= 4 ? decryptedPayload.readUInt16BE(2) : 0;
      const version = decryptedPayload.length > 4 ? decryptedPayload.readUInt8(4) : 0;
      const devicePeripheralStatus = decryptedPayload.length > 5 ? decryptedPayload.readUInt8(5) : 0;
      const deviceStatusRaw = decryptedPayload.length > 6 ? decryptedPayload.readUInt8(6) : 0;

      // Parse device status bit fields (SDD v1.4)
      const deviceStatusBits = {
        connectIndication: (deviceStatusRaw & 0x01) !== 0,    // bit 0: Connect indication
        timeSet: (deviceStatusRaw & 0x02) !== 0,              // bit 1: Time set
        factoryDefaults: (deviceStatusRaw & 0x04) !== 0,      // bit 2: Factory defaults
        reserved: (deviceStatusRaw & 0xF8) >> 3               // bits 3-7: Reserved
      };

      // MAC ID (6 bytes, stored in reverse order - little-endian)
      // ✅ FIXED: MAC address bytes are in reverse order, so we reverse them for display
      let macId = '000000000000';
      if (decryptedPayload.length >= 13) {
        const macBytes = decryptedPayload.slice(7, 13);
        // Reverse the bytes (they come in little-endian order)
        const reversedMac = Buffer.from([macBytes[5], macBytes[4], macBytes[3], macBytes[2], macBytes[1], macBytes[0]]);
        macId = reversedMac.toString('hex').toUpperCase();
      }

      const recordCount = decryptedPayload.length >= 15 ? decryptedPayload.readUInt16LE(13) : 0;

      // Calculate battery percentage (note: battery voltage not in advertisement per v1.4)
      const batteryPercent = this.calculateBatteryPercent(0); // Placeholder, battery not in adv

      const parsed = {
        companyId: parsedCompanyId,
        version,
        devicePeripheralStatus,
        deviceStatus: devicePeripheralStatus === 0 ? 'good' : 'problem',
        deviceStatusRaw,
        deviceStatusBits,
        macId,
        recordCount,
        batteryMv: 0, // Not included in v1.4 advertisement
        batteryPercent,
        rawDecrypted: decryptedPayload.toString('hex'),
        // Helper booleans
        connectIndication: deviceStatusBits.connectIndication,
        timeSet: deviceStatusBits.timeSet,
        factoryDefaults: deviceStatusBits.factoryDefaults
      };

      console.log(`🔓 Decrypted Manufacturer Data (SDD v1.4):`, parsed);

      return parsed;
    } catch (error) {
      console.error('❌ Failed to decrypt manufacturer data:', error);
      
      // Return fallback unencrypted parsing for backward compatibility
      return this.parseUnencryptedManufacturerData(manufacturerData);
    }
  }
  
  /**
   * Fallback: Parse unencrypted manufacturer data
   * Used during development/testing when device doesn't encrypt yet
   * Updated for SDD v1.4 format with enhanced fault reporting
   */
  static parseUnencryptedManufacturerData(manufacturerData) {
    try {
      // SDD v1.4 Manufacturer Specific Data format (unencrypted)
      const mfgLength = manufacturerData.readUInt8(0);
      const dataType = manufacturerData.readUInt8(1);
      const companyId = manufacturerData.readUInt16BE(2);
      const version = manufacturerData.readUInt8(4);
      const deviceFaultStatus = manufacturerData.readUInt8(5); // ✅ ENHANCED in v1.4: Detailed fault codes
      const deviceStatusRaw = manufacturerData.readUInt8(6);

      // ✅ ENHANCED in v1.4: Parse device fault status bit flags (SDD v1.4 Table 18)
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

      // Parse device status bit fields
      const deviceStatusBits = {
        connectIndication: (deviceStatusRaw & 0x01) !== 0,
        timeSet: (deviceStatusRaw & 0x02) !== 0,
        factoryDefaults: (deviceStatusRaw & 0x04) !== 0,
        reserved: (deviceStatusRaw & 0xF8) >> 3
      };

      const macId = manufacturerData.slice(7, 13).toString('hex').toUpperCase();
      const recordCount = manufacturerData.readUInt16LE(13);

      // ✅ ENHANCED in v1.4: Create human-readable fault description
      const deviceStatus = deviceFaultStatus === 0 ? 'good' : 'fault';
      const faultDetails = [];
      if (faultStatusBits.watchdogFailure) faultDetails.push('Watchdog');
      if (faultStatusBits.rtcFailure) faultDetails.push('RTC');
      if (faultStatusBits.adcFailure) faultDetails.push('ADC');
      if (faultStatusBits.pwmFailure) faultDetails.push('PWM');
      if (faultStatusBits.flashFailure) faultDetails.push('Flash');
      if (faultStatusBits.bleFailure) faultDetails.push('BLE');
      if (faultStatusBits.accelerometerFailure) faultDetails.push('Accelerometer');
      const faultDescription = faultDetails.length > 0 ? faultDetails.join(', ') : 'None';

      console.log(`⚠️ Parsed as UNENCRYPTED manufacturer data (SDD v1.4 fallback mode)`);

      return {
        companyId,
        version,
        deviceFaultStatus,                         // ✅ NEW in v1.4: Detailed fault status
        devicePeripheralStatus: deviceFaultStatus, // Legacy field name for backward compatibility
        deviceStatus,
        faultDescription,                          // ✅ NEW in v1.4: Human-readable fault details
        faultStatusBits,                           // ✅ NEW in v1.4: Parsed fault status bits
        deviceStatusRaw,
        deviceStatusBits,
        macId,
        recordCount,
        batteryMv: 0, // Not in advertisement
        batteryPercent: 0,
        encrypted: false,
        // Helper booleans
        connectIndication: deviceStatusBits.connectIndication,
        timeSet: deviceStatusBits.timeSet,
        factoryDefaults: deviceStatusBits.factoryDefaults
      };
    } catch (error) {
      console.error('❌ Failed to parse manufacturer data:', error);
      return null;
    }
  }
  
  /**
   * Calculate battery percentage from millivolts
   * Typical Li-ion battery: 3000mV (0%) to 4200mV (100%)
   */
  static calculateBatteryPercent(batteryMv) {
    const MIN_VOLTAGE = 3000; // 0%
    const MAX_VOLTAGE = 4200; // 100%
    
    if (batteryMv < MIN_VOLTAGE) return 0;
    if (batteryMv > MAX_VOLTAGE) return 100;
    
    const percent = Math.round(((batteryMv - MIN_VOLTAGE) / (MAX_VOLTAGE - MIN_VOLTAGE)) * 100);
    return Math.max(0, Math.min(100, percent));
  }
  
  /**
   * Validate decrypted data integrity
   * Used after NFC write decryption (SDD Section 6.6)
   * 
   * @param {Buffer} decryptedData - Decrypted data to validate
   * @returns {boolean} - True if data is valid
   */
  static validateDecryptedData(decryptedData) {
    if (!decryptedData || !Buffer.isBuffer(decryptedData)) {
      console.error('❌ Invalid decrypted data: not a buffer');
      return false;
    }
    
    if (decryptedData.length === 0) {
      console.error('❌ Invalid decrypted data: empty buffer');
      return false;
    }
    
    // Check for valid UTF-8 if data should be text
    try {
      const text = decryptedData.toString('utf8');
      
      // Check for invalid characters that suggest corruption
      const hasInvalidChars = /[\x00-\x08\x0B-\x0C\x0E-\x1F]/.test(text);
      
      if (hasInvalidChars && text.length > 10) {
        console.warn('⚠️ Decrypted data contains suspicious characters');
        return false;
      }
      
      console.log('✅ Decrypted data validation passed');
      return true;
    } catch (error) {
      console.error('❌ Decrypted data validation failed:', error);
      return false;
    }
  }
  
  /**
   * Encrypt data for NFC write operation
   * SDD Section 6.6: NFC Tag configuration and security
   * 
   * @param {string} nfcData - Data to write to NFC tag (e.g., URL, device info)
   * @param {string} deviceId - Device ID for encryption
   * @returns {string} - Encrypted data ready for NFC write
   */
  static encryptNFCData(nfcData, deviceId) {
    console.log(`🔐 Encrypting NFC data for device: ${deviceId}`);
    
    // Validate input
    if (!nfcData || typeof nfcData !== 'string') {
      throw new Error('Invalid NFC data');
    }
    
    // Encrypt using device ID as key
    const encrypted = this.encrypt(nfcData, deviceId);
    
    console.log(`✅ NFC data encrypted: ${nfcData.length} chars -> ${encrypted.length} encrypted`);
    
    return encrypted;
  }
  
  /**
   * Decrypt data from NFC read operation
   * 
   * @param {string} encryptedNFCData - Encrypted data read from NFC tag
   * @param {string} deviceId - Device ID for decryption
   * @returns {string} - Decrypted NFC data
   */
  static decryptNFCData(encryptedNFCData, deviceId) {
    console.log(`🔓 Decrypting NFC data for device: ${deviceId}`);
    
    // Decrypt using device ID as key
    const decrypted = this.decrypt(encryptedNFCData, deviceId);
    
    // Validate decrypted data
    if (!this.validateDecryptedData(decrypted)) {
      throw new Error('Decrypted NFC data validation failed');
    }
    
    // Convert to string
    const nfcData = decrypted.toString('utf8');
    
    console.log(`✅ NFC data decrypted successfully`);
    
    return nfcData;
  }
  
  /**
   * Test encryption/decryption with device ID
   * Useful for debugging
   */
  static test(deviceId, testData = 'Hello Smart Health Tag!') {
    console.log(`\n🧪 Testing AES encryption with device ID: ${deviceId}`);
    console.log(`📝 Test data: "${testData}"`);
    
    try {
      // Test string encryption
      const encrypted = this.encrypt(testData, deviceId);
      console.log(`✅ Encrypted: ${encrypted}`);
      
      const decrypted = this.decrypt(encrypted, deviceId);
      const decryptedString = decrypted.toString('utf8');
      console.log(`✅ Decrypted: "${decryptedString}"`);
      
      const success = decryptedString === testData;
      console.log(`${success ? '✅' : '❌'} Encryption test ${success ? 'PASSED' : 'FAILED'}`);
      
      // Test manufacturer data
      const mockManufacturerData = Buffer.from([
        0x34, 0x12,  // Company ID (0x1234)
        0x01,        // Indication
        0x00,        // Device status
        0xF4, 0x01,  // Record count (500)
        0xB8, 0x0B   // Battery (3000mV)
      ]);
      
      const encryptedMfgData = Buffer.concat([
        mockManufacturerData.slice(0, 2), // Keep company ID unencrypted
        Buffer.from(this.encrypt(mockManufacturerData.slice(2), deviceId), 'base64')
      ]);
      
      console.log(`\n🧪 Testing manufacturer data decryption...`);
      const parsed = this.decryptManufacturerData(encryptedMfgData, deviceId);
      console.log(`✅ Parsed manufacturer data:`, parsed);
      
      return success;
    } catch (error) {
      console.error(`❌ Encryption test FAILED:`, error);
      return false;
    }
  }
}

export default AESEncryption;

