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
export const MANUFACTURER_COMPANY_ID = 0x1234; // TODO: Replace with actual Bluetooth SIG assigned Company ID before release

// AES-128 key/iv placeholders for decrypting manufacturer data payloads.
// Replace with values provided by firmware/security team.
export const ADV_AES_CONFIG = {
  keyHex: '00000000000000000000000000000000', // 16 bytes hex
  ivHex: '00000000000000000000000000000000', // 16 bytes hex if CBC is used; confirm mode
  mode: 'ECB', // Or 'CBC' per firmware spec; ECB shown as placeholder
  padding: 'PKCS7',
};

// Device Status Characteristic Layout (from SDD Table 12 - 20 bytes total)
export const DEVICE_STATUS_LAYOUT = {
  TIMESTAMP_OFFSET: 0,      // Bytes 0-3: Unix Timestamp (Little Endian)
  STEPS_OFFSET: 4,          // Bytes 4-5: Steps counter data (Little Endian) - CORRECTED
  TEMP_OFFSET: 6,           // Bytes 6: Temperature (1 byte) - CORRECTED
  FLAGS_OFFSET: 7,          // Bytes 7: Device status flag (1 byte) - CORRECTED
  RESERVED_OFFSET: 8,       // Bytes 8-19: Reserved (0x00) - CORRECTED
  TOTAL_SIZE: 20,           // Total size is 20 bytes
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

  // Command IDs (from SDD Table 9)
  CMD: {
    SET_SYSTEM_TIME: 0x01,      // Length: 4, Data: Unix Timestamp (seconds)
    SET_ADV_INTERVAL: 0x02,     // Length: 4, Data: Advertising interval (ms)
    SET_CONN_INTERVAL: 0x03,    // Length: 4, Data: Connection interval (ms)
    SET_DATA_INTERVAL: 0x04,    // Length: 4, Data: Data interval (seconds)
    GET_FW_VERSION: 0x05,       // Length: 1, Data: No Data (0x00)
    GET_HW_VERSION: 0x06,       // Length: 1, Data: No Data (0x00)
    GET_DIAGNOSTICS: 0x07,      // Length: 1, Data: No Data (0x00)
    DATA_SYNC_START: 0x08,      // Length: 1, Data: No Data (0x00)
    DATA_SYNC_STOP: 0x09,       // Length: 1, Data: 0x01=Clear Flash, 0x00=Failed
    ENTER_DFU_MODE: 0x0A,       // Length: 0, Data: No Data (enters DFU bootloader)
    SYSTEM_RESTART: 0x10,       // Length: 1, Data: No Data (0x00)
    TOGGLE_BUZZER: 0x11,        // Length: 1, Data: 0x00=Activate, 0x01=Deactivate - ADDED
  },

  // Response Status Codes
  STATUS: {
    SUCCESS: 0x00,
    FAILURE: 0x01,
  },
};

export const DATA_TRANSFER_TYPES = {
  SYNC_START: 0x01, // length 4: total records info
  SYNC_COMPLETE: 0x02, // length 2: 0xFFFF=Force termination, 0x0001-0x01F4=Number of records - CORRECTED
  RECORD: 0x03, // length 6-18: record payload (timestamp/temp/steps compressed)
  READ_ERROR: 0x04, // length 1: 0x00
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
    mtuSize: 512
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
    mtuSize: 256
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
    mtuSize: 128
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
