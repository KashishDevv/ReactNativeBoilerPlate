# BLE Commands Hex Reference for nRF Connect Testing

## Quick Reference Table

| Command | Hex String | Description |
|---------|------------|-------------|
| **Get FW Version** | `AA050100` | Read firmware version |
| **Get HW Version** | `AA060100` | Read hardware version |
| **Get Diagnostics** | `AA070100` | Read diagnostic data |
| **Set System Time** | `AA01046B0E6F69` | Sync RTC (update timestamp) |
| **Set Adv Interval** | `AA0204E8030000` | Set 1000ms interval |
| **Set Conn Interval** | `AA030432000000` | Set 50ms interval |
| **Set Data Interval** | `AA040460EA0000` | Set 60000ms (1 min) |
| **Data Sync Start** | `AA0802F401` | Start sync (500 records) |
| **Data Sync Stop** | `AA0902F401` | Stop sync (500 records) |
| **Enter DFU Mode** | `AA0A00` | Enter bootloader ⚠️ |
| **System Restart** | `AA100100` | Reboot device ⚠️ |
| **Buzzer Activate** | `AA110200FF` | Activate buzzer (max) |
| **Buzzer Deactivate** | `AA11020100` | Deactivate buzzer |
| **Unpair Device** | `AA120100` | Remove bonding ⚠️ |
| **Factory Reset** | `AA130100` | Reset device ⚠️ |
| **Passkey Update** | `AA140340E201` | Change passkey (123456) |

---

## Command Packet Format

All commands follow this format (actual length, no padding):
```
[0xAA][CommandID][Length][Data...]
```

- **Byte 0:** Request ID = `0xAA`
- **Byte 1:** Command ID (see table below)
- **Byte 2:** Command Length (number of data bytes)
- **Bytes 3+:** Command Data (little-endian)

**Note:** nRF Connect accepts the actual command bytes without padding. The device reads only the bytes specified by the length field.

---

## All Commands in Hex Format

### 1. Set System Time (0x01)
**Purpose:** Sync device RTC with current time  
**Length:** 4 bytes  
**Data:** Unix timestamp (32-bit, little-endian)

**Example (Current time ~2026-01-20 20:24:27 UTC):**
```
AA01046B0E6F69
```
- `AA` = Request ID
- `01` = Command ID
- `04` = Length (4 bytes)
- `6B0E6F69` = Timestamp (little-endian: 0x696F0E6B = 1768885867)

**To generate current timestamp:**
```python
import struct
import time
timestamp = int(time.time())
hex_str = f"AA0104{struct.pack('<I', timestamp).hex().upper()}"
```

---

### 2. Set Advertising Interval (0x02)
**Purpose:** Configure BLE advertising interval  
**Length:** 4 bytes  
**Data:** Interval in milliseconds (32-bit, little-endian)

**Example (1000ms = 1 second):**
```
AA0204E8030000
```
- `AA` = Request ID
- `02` = Command ID
- `04` = Length (4 bytes)
- `E8030000` = 1000ms (little-endian: 0x000003E8)

**Common values:**
- 100ms: `AA020464000000`
- 500ms: `AA0204F4010000`
- 1000ms: `AA0204E8030000`
- 2000ms: `AA0204D0070000`

---

### 3. Set Connection Interval (0x03)
**Purpose:** Configure BLE connection interval  
**Length:** 4 bytes  
**Data:** Interval in milliseconds (32-bit, little-endian)

**Example (50ms):**
```
AA030432000000
```
- `AA` = Request ID
- `03` = Command ID
- `04` = Length (4 bytes)
- `32000000` = 50ms (little-endian: 0x00000032)

**Common values:**
- 7.5ms: `AA03040F000000`
- 15ms: `AA03040F000000`
- 50ms: `AA030432000000`
- 100ms: `AA030464000000`

---

### 4. Set Data Acquisition Interval (0x04)
**Purpose:** Configure sensor polling interval  
**Length:** 4 bytes  
**Data:** Interval in milliseconds (32-bit, little-endian)

**Example (60000ms = 1 minute):**
```
AA040460EA0000
```
- `AA` = Request ID
- `04` = Command ID
- `04` = Length (4 bytes)
- `60EA0000` = 60000ms (little-endian: 0x0000EA60)

**Common values:**
- 1 second (1000ms): `AA0404E8030000`
- 1 minute (60000ms): `AA040460EA0000`
- 5 minutes (300000ms): `AA0404B0B30100`

---

### 5. Get Firmware Version (0x05)
**Purpose:** Read firmware version  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA050100
```
- `AA` = Request ID
- `05` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**Expected Response:** `BB0501[version_data]`

---

### 6. Get Hardware Version (0x06)
**Purpose:** Read hardware version  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA060100
```
- `AA` = Request ID
- `06` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**Expected Response:** `BB0601[version_data]`

---

### 7. Get Diagnostics Info (0x07)
**Purpose:** Read diagnostic data  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA070100
```
- `AA` = Request ID
- `07` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**Expected Response:** `BB0701[diagnostics_data]`

---

### 8. Data Sync Start (0x08)
**Purpose:** Start historical data synchronization  
**Length:** 2 bytes  
**Data:** Number of records to sync (16-bit, little-endian)

**Example (500 records):**
```
AA0802F401
```
- `AA` = Request ID
- `08` = Command ID
- `02` = Length (2 bytes)
- `F401` = 500 records (little-endian: 0x01F4)

**Common values:**
- 100 records: `AA08026400`
- 500 records: `AA0802F401`
- 1000 records: `AA0802E803`

---

### 9. Data Sync Stop (0x09)
**Purpose:** Stop data sync and acknowledge records  
**Length:** 2 bytes  
**Data:** Number of records transmitted (16-bit, little-endian)

**Example (500 records acknowledged):**
```
AA0902F401
```
- `AA` = Request ID
- `09` = Command ID
- `02` = Length (2 bytes)
- `F401` = 500 records (little-endian: 0x01F4)

**Note:** Typically sent after receiving all sync data chunks.

---

### 10. Enter DFU Mode (0x0A)
**Purpose:** Enter Device Firmware Update bootloader  
**Length:** 0 bytes  
**Data:** None

**Hex:**
```
AA0A00
```
- `AA` = Request ID
- `0A` = Command ID
- `00` = Length (0 bytes)

**⚠️ Warning:** This will disconnect the device and enter bootloader mode.

---

### 11. System Restart (0x10)
**Purpose:** Reboot the device  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA100100
```
- `AA` = Request ID
- `10` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**⚠️ Warning:** Device will disconnect and restart.

---

### 12. Toggle Buzzer (0x11)
**Purpose:** Control device buzzer  
**Length:** 2 bytes  
**Data:** [Mode, Count]

**Activate Buzzer (beep count = 0xFF = max 4 minutes):**
```
AA110200FF
```
- `AA` = Request ID
- `11` = Command ID
- `02` = Length (2 bytes)
- `00` = Mode (0x00 = Activate)
- `FF` = Count (0xFF = maximum)

**Activate Buzzer (specific beep count, e.g., 5 beeps):**
```
AA11020005
```

**Deactivate Buzzer:**
```
AA11020100
```
- `01` = Mode (0x01 = Deactivate)
- `00` = Count (ignored)

---

### 13. Unpair BLE Device (0x12)
**Purpose:** Remove bonding/pairing  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA120100
```
- `AA` = Request ID
- `12` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**⚠️ Warning:** This will remove the bonding. Device will disconnect.

---

### 14. Factory Reset (0x13)
**Purpose:** Reset device to factory defaults  
**Length:** 1 byte  
**Data:** 0x00 (no data)

**Hex:**
```
AA130100
```
- `AA` = Request ID
- `13` = Command ID
- `01` = Length (1 byte)
- `00` = No data

**⚠️ Warning:** This will erase all device data and settings. Device will disconnect.

---

### 15. Passkey Update (0x14)
**Purpose:** Change pairing passkey  
**Length:** 3 bytes  
**Data:** 6-digit passkey in numeric format (0-9)

**Example (Passkey: 123456):**
```
AA140340E201
```
- `AA` = Request ID
- `14` = Command ID
- `03` = Length (3 bytes)
- `40E201` = Passkey as 24-bit integer in little-endian (123456 = 0x01E240 → 0x40 0xE2 0x01)

**Example (Passkey: 000000):**
```
AA1403000000
```
- `000000` = 0 as 24-bit integer

**Example (Passkey: 999999):**
```
AA14033F420F
```
- `3F420F` = 999999 as 24-bit integer in little-endian (999999 = 0x0F423F → 0x3F 0x42 0x0F)

**Note:** Passkey is stored as a 24-bit integer (0-999999) in little-endian format, not as individual digit bytes.

---

## Response Format

All responses follow this format:
```
[0xBB][CommandID][Length][Status][Data...]
```

- **Byte 0:** Response ID = `0xBB`
- **Byte 1:** Command ID (echo of request)
- **Byte 2:** Response Length
- **Byte 3:** Status (0x00 = Success, 0x01 = Failure)
- **Bytes 4+:** Response Data

**Example Success Response:**
```
BB010000
```
- `BB` = Response ID
- `01` = Command ID (Set System Time)
- `00` = Length (0 bytes of data)
- `00` = Status (Success)

**Example Failure Response:**
```
BB010001
```
- `01` = Status (Failure)

---

## Quick Test Checklist

Use these commands in nRF Connect to verify functionality:

1. ✅ **Get Firmware Version:** `AA050100`
2. ✅ **Get Hardware Version:** `AA060100`
3. ✅ **Get Diagnostics:** `AA070100`
4. ✅ **Set System Time:** `AA01046B0E6F69` (update timestamp)
5. ✅ **Toggle Buzzer (Activate):** `AA110200FF`
6. ✅ **Toggle Buzzer (Deactivate):** `AA11020100`
7. ✅ **Data Sync Start (500 records):** `AA0802F401`
8. ✅ **Data Sync Stop (500 records):** `AA0902F401`

---

## Notes for nRF Connect

1. **Characteristic:** Write to the **System Command Characteristic** (UUID: `00001500-0000-1000-8000-00805F9B34FB`)

2. **Write Type:** Use **"Write"** (not "Write Without Response")

3. **Format:** Enter hex string without spaces (e.g., `AA050100`)

4. **Notifications:** Enable notifications on the System Command Characteristic to receive responses

5. **Response:** Check notifications for response starting with `BB`

6. **Little-Endian:** All multi-byte values are in little-endian format (least significant byte first)

---

## Python Helper Script

```python
import struct
import time

def build_command(command_id, length, data_bytes):
    """Build command packet (actual length, no padding)"""
    packet = bytearray(3 + length)
    packet[0] = 0xAA  # Request ID
    packet[1] = command_id
    packet[2] = length
    packet[3:3+len(data_bytes)] = data_bytes
    return packet.hex().upper()

# Examples:
# Set System Time
timestamp = int(time.time())
print("Set System Time:", build_command(0x01, 4, struct.pack('<I', timestamp)))

# Data Sync Start (500 records)
print("Data Sync Start:", build_command(0x08, 2, struct.pack('<H', 500)))

# Get Firmware Version
print("Get FW Version:", build_command(0x05, 1, bytes([0x00])))
```
