export const BLE_SERVICES = {
  // Standard BLE Services (from SDD)
  GENERIC_ACCESS: '00001800-0000-1000-8000-00805f9b34fb',
  BATTERY: '0000180f-0000-1000-8000-00805f9b34fb',
  DEVICE_INFO: '0000180a-0000-1000-8000-00805f9b34fb',
  // Nordic DFU Service (Bootloader mode) - from SDD Section 7
  DFU: '00001530-1212-efde-1523-785feabcd123',
  // Buttonless DFU Service (Application mode)
  DFU_BUTTONLESS: '8ec90003-f315-4f60-9fb8-838830daea50',
  // Smart Health Tag Data Service (from SDD - corrected UUID format)
  SMART_TAG: '0F0E0D0C-0B0A-0908-0706-050403020100',
  // Alternative service UUIDs that might be used by the device
  SMART_TAG_ALT: '0f0e0d0c-0b0a-0908-0706-050403020100',
  CUSTOM_SERVICE: '8D53DC1D-1DB7-4CD3-868B-8A527460AA84',
};

export const BLE_CHARACTERISTICS = {
  // Smart Health Tag Data Service characteristics (from SDD)
  SYSTEM_COMMAND: '4f4e4d4c-4b4a-4948-4746-454443424140',
  DEVICE_STATUS: '5f5e5d5c-5b5a-5958-5756-555453525150',
  DATA_TRANSFER: '6f6e6d6c-6b6a-6968-6766-656463626160',
  // LOCATION_DATA: '7f7e7d7c-7b7a-7978-7776-757473727170', // REMOVED: Not defined in SDD Table 8

  // Standard Battery Service characteristic
  BATTERY_LEVEL: '00002a19-0000-1000-8000-00805f9b34fb',

  // Device Information Service characteristics (standard)
  MANUFACTURER_NAME: '00002a29-0000-1000-8000-00805f9b34fb',
  MODEL_NUMBER: '00002a24-0000-1000-8000-00805f9b34fb',
  SERIAL_NUMBER: '00002a25-0000-1000-8000-00805f9b34fb',
  HARDWARE_REVISION: '00002a27-0000-1000-8000-00805f9b34fb',
  FIRMWARE_REVISION: '00002a26-0000-1000-8000-00805f9b34fb',
  SOFTWARE_REVISION: '00002a28-0000-1000-8000-00805f9b34fb',
  SYSTEM_ID: '00002a23-0000-1000-8000-00805f9b34fb',

  // Nordic DFU characteristic (Buttonless DFU without bonds) - Same as DFU service UUID
  DFU_CONTROL_POINT: '8ec90003-f315-4f60-9fb8-838830daea50',
};

// Advertisement parsing
// ⚠️ ACTION REQUIRED: Replace this with actual Bluetooth SIG assigned Company ID before production
// Current value 0x1234 is a PLACEHOLDER and must be updated
export const MANUFACTURER_COMPANY_ID = 0x1234; 
// TODO: Obtain official Company ID from Bluetooth SIG: https://www.bluetooth.com/specifications/assigned-numbers/

// ✅ AES-128 Encryption Configuration (per SDD Section 6.5 & 6.6)
// ✅ IMPLEMENTED: Uses Device ID as encryption key (dynamic per device)
// The AESEncryption utility (src/utils/AESEncryption.js) generates keys from device IDs
// No static keys needed - each device uses its own ID as the encryption key
export const ADV_AES_CONFIG = {
  mode: 'ECB',          // AES-128 ECB mode per SDD
  padding: 'PKCS7',     // PKCS7 padding standard
  keySource: 'device_id', // ✅ NEW: Key derived from device ID (SHA-256 hash, first 128 bits)
  // Legacy fields (not used with device ID encryption):
  // keyHex: Generated dynamically from device ID
  // ivHex: Not used in ECB mode
};

// ✅ Device Status Characteristic Layout (from SDD Table 13 v1.4 - 8 bytes total)
// ⚠️ CRITICAL: SDD v1.4 maintains same 8-byte format as v1.2/v1.3
// Device Status shows: Timestamp + Available Records + Battery Level
// Steps and Temperature are ONLY in Data Transfer (sync) records
export const DEVICE_STATUS_LAYOUT = {
  TIMESTAMP_OFFSET: 0,         // Bytes 0-3: Unix Timestamp (Little Endian)
  RECORD_COUNT_OFFSET: 4,      // Bytes 4-5: Available Records count (Little Endian)
  BATTERY_VOLTAGE_OFFSET: 6,   // Bytes 6-7: Battery Value in milliVolt (Little Endian)
  TOTAL_SIZE: 8,               // Total size is 8 bytes
};

// ✅ Data Transfer Record Layout (from SDD Table 16 v1.4 - 8 bytes per record)
// This is where Steps and Temperature are located (in sync data, not device status)
export const DATA_RECORD_LAYOUT = {
  TIMESTAMP_OFFSET: 0,      // Bytes 0-3: Unix Timestamp (Little Endian)
  STEPS_OFFSET: 4,          // Bytes 4-5: Steps counter data (Little Endian)
  TEMP_OFFSET: 6,           // Byte 6: Temperature (1 byte)
  FLAGS_OFFSET: 7,          // Byte 7: Device status flag (1 byte)
  RECORD_SIZE: 8,           // Each record is 8 bytes
};

// Advertising payload layout helpers
export const ADV_LAYOUT = {
  // Assuming: [CompanyId LE(2)] [Indication(1)] [UDID(6)] [optional payload...]
  COMPANY_ID_LEN: 2,
  INDICATION_LEN: 1,
  UDID_LEN: 6,
};

// System Command Protocol (from SDD - exact specification)
export const SYSTEM_COMMAND_CONSTANTS = {
  PACKET_SIZE: 20,
  REQUEST_ID: 0xAA,         // Request ID (from SDD)
  RESPONSE_ID: 0xBB,        // Response ID (from SDD)

  // Request Packet Format: [RequestID][CommandID][CommandLength][CommandData]
  REQUEST_FORMAT: {
    REQUEST_ID_OFFSET: 0,     // Byte 0: Request ID (0xAA)
    COMMAND_ID_OFFSET: 1,     // Byte 1: Command ID
    COMMAND_LENGTH_OFFSET: 2, // Byte 2: Command Length
    COMMAND_DATA_OFFSET: 3,   // Bytes 3-19: Command Data (up to 17 bytes)
  },

  // Response Packet Format: [ResponseID][CommandID][ResponseLength][ResponseStatus][ResponseData]
  RESPONSE_FORMAT: {
    RESPONSE_ID_OFFSET: 0,    // Byte 0: Response ID (0xBB)
    COMMAND_ID_OFFSET: 1,     // Byte 1: Command ID
    RESPONSE_LENGTH_OFFSET: 2,// Byte 2: Response Length
    RESPONSE_STATUS_OFFSET: 3,// Byte 3: Response Status (0x00=Success, 0x01=Failure)
    RESPONSE_DATA_OFFSET: 4,  // Bytes 4-19: Response Data (up to 16 bytes)
  },

  // Command IDs (from SDD Table 9 - v1.4)
  CMD: {
    SET_SYSTEM_TIME: 0x01,      // Length: 4, Data: Unix Timestamp (seconds)
    SET_ADV_INTERVAL: 0x02,     // Length: 4, Data: Advertising interval (ms)
    SET_CONN_INTERVAL: 0x03,    // Length: 4, Data: Connection interval (ms)
    SET_DATA_INTERVAL: 0x04,    // Length: 4, Data: Data interval (milliseconds) ⚠️ CHANGED in v1.4: was seconds in v1.3
    GET_FW_VERSION: 0x05,       // Length: 1, Data: No Data (0x00)
    GET_HW_VERSION: 0x06,       // Length: 1, Data: No Data (0x00)
    GET_DIAGNOSTICS: 0x07,      // Length: 1, Data: No Data (0x00)
    DATA_SYNC_START: 0x08,      // Length: 1, Data: No Data (0x00)
    DATA_SYNC_STOP: 0x09,       // Length: 1, Data: 0x01=Clear Flash, 0x00=Failed
    ENTER_DFU_MODE: 0x0A,       // Length: 0, Data: No Data (enters DFU bootloader)
    SYSTEM_RESTART: 0x10,       // Length: 1, Data: No Data (0x00)
    TOGGLE_BUZZER: 0x11,        // Length: 2, Data: [0x00, beepCount]=Activate (0xFF=max 4min), [0x01, 0x00]=Deactivate
    UNPAIR_DEVICE: 0x12,        // Length: 1, Data: No Data (0x00)
    FACTORY_RESET: 0x13,        // Length: 1, Data: No Data (0x00)
    PASSKEY_UPDATE: 0x14,       // Length: 3, Data: 6 digits Passkey in numeric (0 to 9)
  },

  // Response Status Codes
  STATUS: {
    SUCCESS: 0x00,
    FAILURE: 0x01,
  },
};

export const DATA_TRANSFER_TYPES = {
  SYNC_START: 0x01, // length 4: total records info
  SYNC_COMPLETE: 0x02, // length 2: 0xFFFF=Force termination, 0x0001-0x01F4=Number of records transmitted (SDD v1.4)
  RECORD: 0x03, // length 6-18: record payload (timestamp/temp/steps compressed)
  READ_ERROR: 0x04, // length 1: 0x00
};

// ✅ NEW in v1.4: Data Sync File Management
export const DATA_SYNC_CONFIG = {
  RECORDS_PER_FILE: 500,        // Each file holds 500 records (SDD v1.4 Section 6.12.3)
  MAX_TOTAL_RECORDS: 25000,     // Maximum total records across all files (SDD v1.4 Section 6.12.3)
  MAX_FILES: 50,                // 50 files total (200KB / 4KB per file)
  FILE_SIZE_KB: 4,              // Each file is 4KB
  RECORD_SIZE_BYTES: 8,         // Each record is 8 bytes
  // Example: 1,500 records = 3 file chunks, requiring 3 Start/Stop command pairs
};

// ✅ NEW in v1.4: Device Fault Status Codes (SDD v1.4 Table 18 - Enhanced from v1.3)
// These are bit flags that can be combined (e.g., 0x03 = Watchdog + RTC failures)
export const DEVICE_FAULT_STATUS = {
  GOOD: 0x00,                    // All peripherals working correctly
  WATCHDOG_FAILURE: 0x01,        // Watchdog timer failure
  RTC_FAILURE: 0x02,             // Real-Time Clock failure
  ADC_FAILURE: 0x04,             // Analog-to-Digital Converter failure
  PWM_FAILURE: 0x08,             // Pulse Width Modulation failure
  FLASH_FAILURE: 0x10,           // Flash memory failure
  BLE_FAILURE: 0x20,             // Bluetooth Low Energy failure
  ACCELEROMETER_FAILURE: 0x40,   // Accelerometer (BMA400) failure
};

// Connection & scanning configuration
export const SCAN_CONFIG = {
  allowDuplicates: false,
  // throttle for probing unknown devices (ms)
  probeBackoffMs: 60000,
  // minimum interval between uploading sightings per tag (ms)
  sightingDedupWindowMs: 60000,
  // Foreground scan max duration per session (ms)
  maxDurationMs: 15000,
  // Scan mode hint (LowLatency | Balanced | LowPower) where supported
  mode: 'LowLatency',
};

// Power profiles for tuning intervals without changing behavior everywhere
export const POWER_PROFILE = {
  default: {
    healthCheckMs: 30000,        // 30s health checks (as per your requirements)
    healthRssiEveryNTicks: 3,
    rssiCycleIntervalMs: 30000,  // 30s RSSI updates (as per your requirements)
    rssiCycleDurationMs: 3000,
    pruneIntervalMs: 5 * 60000,
    pruneAgeMs: 10 * 60000,
    scanMode: 'LowLatency',
    maxScanDurationMs: 15000,
    connectionIntervalMs: 50,
    connectionLatency: 0,
    supervisionTimeoutMs: 4000,
    mtuSize: 512,
    periodicReconnectIntervalMs: 4 * 60 * 60 * 1000  // 4 hours - periodic full reconnect to prevent stack instability
  },
  lowPower: {
    healthCheckMs: 60000,        // 60s health checks (2x slower as per your requirements)
    healthRssiEveryNTicks: 6,
    rssiCycleIntervalMs: 30000,  // 30s RSSI updates (same as default as per your requirements)
    rssiCycleDurationMs: 2000,
    pruneIntervalMs: 10 * 60000,
    pruneAgeMs: 15 * 60000,
    scanMode: 'Balanced',
    maxScanDurationMs: 8000,
    connectionIntervalMs: 100,
    connectionLatency: 2,
    supervisionTimeoutMs: 6000,
    mtuSize: 256,
    periodicReconnectIntervalMs: 6 * 60 * 60 * 1000  // 6 hours - longer interval for low power mode
  },
  ultraLowPower: {
    healthCheckMs: 60000,        // 60s health checks (same as low power as per your requirements)
    healthRssiEveryNTicks: 10,
    rssiCycleIntervalMs: 60000,  // 60s RSSI updates (2x slower as per your requirements)
    rssiCycleDurationMs: 1500,
    pruneIntervalMs: 15 * 60000,
    pruneAgeMs: 20 * 60000,
    scanMode: 'LowPower',
    maxScanDurationMs: 5000,
    connectionIntervalMs: 200,
    connectionLatency: 4,
    supervisionTimeoutMs: 8000,
    mtuSize: 128,
    periodicReconnectIntervalMs: 12 * 60 * 60 * 1000  // 12 hours - longest interval for ultra low power mode
  }
};

// BLE States
export const BLE_STATES = {
  UNKNOWN: 'Unknown',
  RESETTING: 'Resetting',
  UNSUPPORTED: 'Unsupported',
  UNAUTHORIZED: 'Unauthorized',
  POWERED_OFF: 'PoweredOff',
  POWERED_ON: 'PoweredOn',
};

// Connection States
export const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
};

// Scan States
export const SCAN_STATES = {
  IDLE: 'idle',
  SCANNING: 'scanning',
  STOPPED: 'stopped',
};

// ✅ SYNC WITH ANDROID: Reconnection Constants (matching Android implementation)
export const RECONNECTION_CONSTANTS = {
  MAX_ATTEMPTS: 5,                    // Max 5 attempts (matching Android MAX_RECONNECT_ATTEMPTS)
  INITIAL_BACKOFF_MS: 1000,           // 1 second initial backoff (matching Android)
  MAX_BACKOFF_MS: 60000,              // 60 seconds max backoff (matching Android)
  JITTER_MS: 1000,                    // 0-1 second random jitter (matching Android)
  MIN_RSSI_FOR_RECONNECTION: -90      // Minimum RSSI (dBm) to attempt reconnection (matching Android)
};

// ✅ SYNC WITH ANDROID: Error Classification (matching Android BLEError.ErrorType)
export const ERROR_TYPES = {
  TRANSIENT: 'TRANSIENT',      // Can retry (timeout, temporary disconnection)
  PERMANENT: 'PERMANENT',      // Cannot retry (device not found, pairing failed)
  USER_ACTION: 'USER_ACTION'   // Requires user action (permissions, pairing)
};

// DemoTag: Demo Tag Configuration Constants
// TODO: Remove all DemoTag constants before production release
export const DEMO_TAG_CONFIG = {
  DEFAULT_DEVICE_ID: 'DEMO-TAG-00000000-0000-0000-0000-000000000001',
  DEFAULT_DEVICE_NAME: 'Demo Smart Tag',
  ENABLED_STORAGE_KEY: '@demo_tag_enabled',
  DEVICE_PREFIX: 'DEMO-TAG-',
};
