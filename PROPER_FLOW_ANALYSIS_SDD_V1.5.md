# Proper Flow Analysis - SDD v1.5 (12/01/2026)

## Overview
This document outlines the **complete proper flow** according to the Software Design Document (ET-DSSID-SSD-V1.5_12012026.md) for the Smart Health Tag system.

---

## 1. TAG REGISTRATION PROCESS (NFC)

### Flow:
1. **User taps phone on NFC tag**
   - NFC tag contains DyreID activation URL (written during production)
   - URL format: Contains `tag_id=xxyyzz`

2. **Phone opens DyreID app**
   - App is launched via encoded URL from NFC
   - App reads `tag_id` from NFC data

3. **App displays registration form**
   - Shows registration form with tag ID pre-filled
   - User fills in pet details and submits

4. **App confirms successful registration**
   - Registration data is saved
   - Tag is now registered in the system

**Note:** NFC data can later be modified via DyreID Mobile App.

---

## 2. SECURE CONNECTION (BLE PAIRING)

### Advertising Behavior:

#### Factory Default Mode (Unpaired Device):
- **Power:** -8dBm
- **Interval:** 4 seconds
- **Status:** Active device, waiting for first pairing

#### Activated Device (Has Pairing History):
- **Power:** +4dBm
- **Interval:** 2 seconds
- **Status:** Activated device, ready for reconnection

### Connection Parameters:
- **Connection Interval:** 320ms
- **Connection Latency:** 2
- **Connection Timeout:** 500 seconds

### Pairing Flow:

1. **Tag Advertises BLE Packets**
   - Broadcasts unique MAC ID (6 bytes / 12 characters)
   - Includes Service UUID (custom UUID: `0x0F0E0D0C0B0A0009080706050403020100`)
   - Includes Manufacturer Specific Data with device status

2. **DyreID App Scans for Devices**
   - Filters devices based on MAC ID
   - Can filter by Service UUID
   - Displays available tags

3. **User Selects Tag to Pair**
   - App initiates BLE connection

4. **Secure Pairing Process**
   - **Default Passkey:** `123456` (6 digits numeric)
   - **Pairing Method:** Passkey Entry
   - **Security:** LE Secure Connections with 128-bit AES encryption
   - **Bonding:** Stores keys for future reconnections

5. **Pairing Configuration:**
   - System can store up to **5 paired BLE devices**
   - Only **1 device can be connected concurrently**
   - Passkey can be modified using System Command (0x14)
   - **Important:** Passkey change by any paired device removes current paired device bonding but keeps other device bonding info

6. **After Successful Pairing:**
   - Tag switches to **Normal/IDLE Power Mode**
   - All peripherals become active
   - BLE uses high advertising and connection intervals

---

## 3. DATA SYNCHRONIZATION FLOW

### Initial Setup (After Connection):

1. **GATT Service Discovery**
   - App discovers all services and characteristics
   - Verifies encryption by reading encrypted characteristics

2. **Time Synchronization (CRITICAL FIRST STEP)**
   - App sends **Set System Time** command (0x01)
   - Format: `0xAA 0x01 0x04 [4-byte Unix Timestamp in Little Endian]`
   - Example: `0xAA 0x01 0x04 0x6874851D` (GMT: Thursday, 25 September 2025 11:37:29 AM)
   - **Response:** `0xBB 0x01 0x00 0x00` (Success) or `0xBB 0x01 0x00 0x01` (Failure)

3. **Read Device Status**
   - App reads **Device Status Characteristic** (UUID: `0x5F5E5D5C5B5A59585756555453525150`)
   - Gets: Timestamp, Available Records Count, Battery Value

### Data Sync Process (Historical Records):

#### SDD v1.5 Update - File-Based Sync:
- **Each file contains 500 records** (4 KB sector)
- **Total capacity:** 25,000 records (50 files × 500 records)
- **Sync must be done per file** (500 records at a time)

#### Sync Flow for Multiple Files:

**Example: 1,500 records (3 files)**

1. **First File Sync (Records 1-500):**
   ```
   App → Device: Data Sync Start (0x08) with payload [0xF4 0x01] (500 in Little Endian)
   Device → App: Data Sync Start notification (0x01) with total record info
   Device → App: Record Data (0x03) notifications (500 records)
   Device → App: Data Sync Complete (0x02) with count 0x01F4
   App → Device: Data Sync Stop (0x09) with payload [0xF4 0x01]
   ```

2. **Second File Sync (Records 501-1000):**
   ```
   App → Device: Data Sync Start (0x08) with payload [0xF4 0x01]
   Device → App: Record Data notifications (500 records)
   Device → App: Data Sync Complete (0x02)
   App → Device: Data Sync Stop (0x09)
   ```

3. **Third File Sync (Records 1001-1500):**
   ```
   App → Device: Data Sync Start (0x08) with payload [0xF4 0x01]
   Device → App: Record Data notifications (500 records)
   Device → App: Data Sync Complete (0x02)
   App → Device: Data Sync Stop (0x09)
   ```

#### Sync Flow for Single File (< 500 records):

1. **App sends Data Sync Start:**
   - Command: `0xAA 0x08 0x02 [Record Count LSB] [Record Count MSB]`
   - Example for 250 records: `0xAA 0x08 0x02 0xFA 0x00`

2. **Device responds:**
   - Notification: `0x01 [Length] [Total Record Info]` (Data Sync Start)

3. **Device sends records:**
   - Notification: `0x03 [Length] [Record Data]` (multiple notifications)
   - Each record: 8 bytes (Timestamp: 4, Steps: 2, Temperature: 1, Status: 1)

4. **Device completes:**
   - Notification: `0x02 [Length] [Records Transmitted]` (Data Sync Complete)
   - Count: 0x0001 to 0x01F4 (1 to 500)

5. **App sends Data Sync Stop:**
   - Command: `0xAA 0x09 0x02 [Record Count LSB] [Record Count MSB]`
   - Device deletes the file after successful sync

### Live Data (Push-Generated Records):

**SDD v1.5 Feature:**
- Device automatically sends records at each **data acquisition interval**
- Sent via **Data Transfer Characteristic** notifications
- **Data Type:** 0x03 (Record Data)
- These are **real-time** health data (steps, temperature)

**Record Format (20 bytes):**
```
Byte 0-3:   Timestamp (Little Endian)
Byte 4-5:   Steps counter data (Little Endian)
Byte 6:     Temperature
Byte 7:     Device status flag
Byte 8-19:  Reserved (0x00)
```

---

## 4. SYSTEM COMMANDS FLOW

### Command Format (Write):
- **Size:** 20 bytes
- **Format:** `[Request ID: 0xAA] [Command ID] [Length] [Data (up to 17 bytes)]`
- **Endianness:** Little Endian

### Response Format (Notification):
- **Size:** 20 bytes
- **Format:** `[Response ID: 0xBB] [Command ID] [Response Length] [Status] [Data (up to 16 bytes)]`
- **Status:** 0x00 = Success, 0x01 = Failure
- **Endianness:** Little Endian

### Available Commands:

| Command | ID | Length | Data | Purpose |
|---------|-----|--------|------|---------|
| Set System Time | 0x01 | 4 | Unix Timestamp | Sync device RTC |
| Set Advertising Interval | 0x02 | 4 | Interval (ms) | Configure BLE advertising |
| Set Connection Interval | 0x03 | 4 | Interval (ms) | Configure BLE connection |
| Set Data Acquisition Interval | 0x04 | 4 | Interval (ms) | Configure sensor polling |
| Get Firmware Version | 0x05 | 1 | 0x00 | Read firmware version |
| Get Hardware Version | 0x06 | 1 | 0x00 | Read hardware version |
| Get Diagnostics Info | 0x07 | 1 | 0x00 | Read diagnostic data |
| Data Sync Start | 0x08 | 2 | Record count | Start historical sync |
| Data Sync Stop | 0x09 | 2 | Record count | Stop and delete file |
| System Restart | 0x10 | 1 | 0x00 | Reboot device |
| Toggle Buzzer | 0x11 | 2 | Mode, Count | Control buzzer |
| Unpair BLE Device | 0x12 | 1 | 0x00 | Remove bonding |
| Factory Reset | 0x13 | 1 | 0x00 | Reset to defaults |
| Passkey Update | 0x14 | 3 | 6-digit passkey | Change pairing passkey |

### Example Command Flow:

**Set System Time:**
```
App Write:  0xAA 0x01 0x04 0x6874851D
Device Notify: 0xBB 0x01 0x00 0x00 (Success)
```

**Toggle Buzzer (Activate):**
```
App Write:  0xAA 0x11 0x02 0x00 0xFF
Device Notify: 0xBB 0x11 0x00 0x00 (Success)
```
- Buzzer beeps for configured count (max 4 minutes if count not provided)
- Each cycle: 500ms ON, 500ms OFF

**Toggle Buzzer (Deactivate):**
```
App Write:  0xAA 0x11 0x02 0x01 0x00
Device Notify: 0xBB 0x11 0x00 0x00 (Success)
```

---

## 5. DEVICE STATUS MONITORING

### Device Status Characteristic:
- **UUID:** `0x5F5E5D5C5B5A59585756555453525150`
- **Permissions:** Read, Notify
- **Size:** 8 bytes

**Format:**
```
Byte 0-3: Timestamp (Little Endian)
Byte 4-5: Available Records Count (Little Endian)
Byte 6-7: Battery Value in milliVolt (Little Endian)
```

### Reading Device Status:
- App can **read** this characteristic anytime
- App can **subscribe** to notifications for automatic updates
- Updates sent when:
  - Battery level changes
  - Record count changes
  - Timestamp updates

---

## 6. BATTERY ALERT & DEEP SLEEP

### Battery Monitoring:
- Battery voltage read via ADC
- Monitored at regular intervals
- Battery level available in:
  - **Battery Service** (Standard BLE Service 0x180F)
  - **Device Status Characteristic** (milliVolt value)

### Low Battery Flow:

1. **Battery Threshold Reached:**
   - Device updates Battery Level Characteristic
   - Device transmits battery status to app
   - App can display low battery warning

2. **Deep Sleep Trigger:**
   - After critical battery threshold OR prolonged inactivity
   - Device disconnects from BLE (if connected)
   - Shuts down sensors, radio, peripherals
   - Enters **Deep Sleep / Shutdown Mode**
   - **Data logging stops** (but retains already stored data)

3. **Deep Sleep Mode:**
   - BLE advertising **disabled**
   - Sensors and peripherals **stopped**
   - Ultra-low power state
   - Used for extended inactivity or battery conservation

4. **Wake-Up:**
   - Device wakes based on trigger (e.g., NFC tap - not in design)
   - Re-checks battery level
   - If still critical → returns to deep sleep
   - If battery recovered → resumes normal operation

5. **Power-Off:**
   - Tag powers off after battery level exhausted completely

---

## 7. DFU (DEVICE FIRMWARE UPDATE) PROCESS

### Prerequisites:
- **Bonded connection required**
- Only paired/bonded mobile app can initiate DFU
- Secure connection established

### DFU Flow:

1. **App-Initiated DFU Trigger:**
   - App sends secure write to **Buttonless DFU Service**
   - UUID: `0x8EC90003-F315-4F60-9FB8-838830DAEA50`
   - Payload: `0x01` (Start DFU)

2. **Device Validation:**
   - Firmware validates request comes from bonded device
   - If unauthorized → rejects request

3. **Switch to Bootloader / DFU Mode:**
   - Device sets DFU start flag in flash
   - Disconnects BLE
   - Resets into bootloader/DFU mode
   - Advertises **separate DFU service UUID** (0xFE59)

4. **App Reconnects:**
   - App scans for DFU service UUID
   - Reconnects to device in DFU mode
   - Establishes new connection (may require re-pairing)

5. **Firmware Transfer:**
   - App sends **Init packet** (metadata, checksum, signature)
   - App sends **firmware image in chunks** (20-244 bytes depending on MTU)
   - Device stores in reserved flash partition

6. **Validation and Flashing:**
   - After full transfer:
     - Device performs **CRC check**
     - **Version check**
     - **Digital signature verification**
   - If valid: New firmware flashed over old application
   - If invalid: Revert to previous firmware

7. **Reboot and Resume:**
   - Device resets back to application firmware
   - Resumes normal advertising
   - May notify app of success on next connection

### Security Aspects:
- Only bonded devices can initiate DFU
- Firmware images are signed/encrypted
- DFU triggers hidden from unauthorized clients
- Bootloader protected against unauthorized overwrites

### Error Handling:
- Revert to previous firmware on upgrade failure
- Retry mechanism available

---

## 8. POWER MODES

### Normal / IDLE Mode:
- **When:** After successful pairing
- **Peripherals:** All active (BLE, sensors, ADC, PWM)
- **BLE:** High advertising and connection intervals
- **Sensors:** Periodic readings active
- **Use Case:** Active data exchange, quick interaction

### Low Power Mode:
- **When:** Waiting for commands or reconnection, no immediate activity
- **Peripherals:** Most suspended
- **BLE:** Active with high advertising intervals (saves power)
- **Sensors:** Reduced activity
- **Use Case:** Maintain connections, allow DFU

### Deep Sleep / Shutdown Mode:
- **When:** Critical battery threshold or prolonged inactivity
- **Peripherals:** All stopped
- **BLE:** Advertising disabled
- **Sensors:** Stopped
- **Use Case:** Battery conservation, extended inactivity

---

## 9. BLE ADVERTISING PACKET STRUCTURE

### Packet Components:

1. **Flags:** `02 01 06`
   - LE General Discoverable
   - BR/EDR Not Supported

2. **Local Name:** `44 79 72 65 49 44` ("DyreID")

3. **Manufacturer Specific Data:** `0F FF 34 12 [Data]`
   - **Length:** 0x0F (15 bytes)
   - **Type:** 0xFF (Manufacturer Specific)
   - **Company ID:** 0x1234
   - **Version:** 0x01
   - **Device Fault Status:** 0x00 (Good) or bit flags
   - **Device Status:** Bit flags (Connect Indication, Time Set, Factory Defaults)
   - **Restart Reason:** 2 bytes (bit flags)
   - **MAC ID:** 6 bytes
   - **Available Records:** 2 bytes (Little Endian)

### Device Status Bits:
- **Bit 0:** Connect Indication (1 = connect needed, 0 = no need)
- **Bit 1:** Time Set (1 = configured, 0 = not set)
- **Bit 2:** Factory Defaults (1 = using defaults, 0 = customized)
- **Bit 3-7:** Reserved

---

## 10. DATA STORAGE & FLASH MANAGEMENT

### Flash Layout (1.5 MB total):

1. **Bootloader + Application:** 54 + 1168 KB
   - Must fit within 1222 KB for reliable OTA/DFU

2. **Device Info / Config:** 4 KB
   - Unique ID / Serial Number
   - Pairing/Bonding info
   - Configuration settings

3. **Data Logging Area:** 200 KB
   - Organized in 4 KB sectors (50 files)
   - Each file = 500 records
   - Each record = 8 bytes

### Record Structure:
```
Byte 0-3: Timestamp (4 bytes)
Byte 4-5: Step Count (2 bytes)
Byte 6:   Temperature (1 byte)
Byte 7:   Status (1 byte, reserved)
```

### Data Writing Strategy:
- Data buffered in RAM until 4 KB block accumulated
- Flash writes occur **per file**, not per record
- Minimizes write cycles, improves endurance
- **Data loss:** Unsaved RAM data lost on reboot/DFU/power loss
- **Data retention:** All previously written files remain intact

### Data Acquisition:
- Step count polling interval: **2 minutes** (configurable)
- Flash write: **1 per day** (approximately)
- File creation: **~3 files over 2 days**

---

## 11. COMPLETE APPLICATION FLOW SUMMARY

### First-Time Setup:
1. User taps NFC → App opens → Registration
2. App scans for BLE device (MAC ID filter)
3. App connects → Secure pairing (passkey: 123456)
4. App sets system time (CRITICAL)
5. App reads device status
6. App configures intervals (advertising, connection, data acquisition)
7. Tag switches to Normal/IDLE mode

### Regular Operation:
1. Tag advertises BLE packets (interval based on pairing status)
2. App connects (if needed) or receives push-generated records
3. App reads device status periodically
4. App syncs historical data (file-by-file, 500 records per file)
5. Tag logs sensor data (steps, temperature) at configured interval
6. Tag stores data in flash (4 KB files, 500 records each)

### Data Sync (Historical):
1. App reads device status → Gets available record count
2. App calculates number of files (records / 500)
3. For each file:
   - Send Data Sync Start (0x08) with record count
   - Receive Data Sync Start notification
   - Receive Record Data notifications (0x03)
   - Receive Data Sync Complete (0x02)
   - Send Data Sync Stop (0x09)
   - Device deletes file after successful sync

### Live Data (Real-Time):
1. Tag generates record at data acquisition interval
2. Tag sends via Data Transfer Characteristic (type 0x03)
3. App receives and processes (even if not in sync state)
4. Tag also stores record in RAM buffer
5. When 500 records accumulated → Write to flash file

### Battery Management:
1. Tag monitors battery at regular intervals
2. Low battery → Update characteristic → Notify app
3. Critical battery → Enter Deep Sleep
4. Deep Sleep → Stop all operations, retain stored data
5. Battery exhausted → Power off

---

## 12. CRITICAL IMPLEMENTATION NOTES

### SDD v1.5 Updates:
1. **Data Sync:** Now uses 2-byte record count (500 = 0x01F4) instead of 1-byte
2. **File-Based Sync:** Must sync 500 records per file, multiple syncs for >500 records
3. **Push-Generated Records:** Device sends live records automatically (type 0x03)
4. **System Commands:** New command format with Request ID (0xAA) and Response ID (0xBB)

### Security Requirements:
- **Pairing:** Passkey Entry method (default: 123456)
- **Bonding:** Required for sensitive operations (DFU, config)
- **Encryption:** 128-bit AES (LE Secure Connections)
- **Max Bonded Devices:** 5 (only 1 connected at a time)

### Data Format Requirements:
- **All multi-byte values:** Little Endian format
- **Command format:** 20 bytes (Request ID + Command ID + Length + Data)
- **Response format:** 20 bytes (Response ID + Command ID + Length + Status + Data)
- **Record format:** 8 bytes (Timestamp + Steps + Temperature + Status)

### Error Handling:
- **Pairing failure:** Disconnect, allow retry
- **Sync timeout:** 60 seconds, clear state, allow new sync
- **DFU failure:** Revert to previous firmware
- **Data read error:** Send 0x04 (Data Read Error), terminate sync

---

## 13. TESTING CHECKLIST

### Connection Flow:
- [ ] NFC tap opens app with tag ID
- [ ] App scans and finds device by MAC ID
- [ ] Pairing dialog appears with passkey entry
- [ ] Successful pairing with default passkey (123456)
- [ ] Bonding information stored
- [ ] Reconnection works without re-pairing

### Time Synchronization:
- [ ] Set System Time command succeeds
- [ ] Device Status shows correct timestamp
- [ ] Records have correct timestamps

### Data Sync:
- [ ] Device Status shows available record count
- [ ] Data Sync Start with 2-byte record count (500)
- [ ] Receives Data Sync Start notification
- [ ] Receives all Record Data notifications
- [ ] Receives Data Sync Complete notification
- [ ] Data Sync Stop deletes file
- [ ] Multiple file sync works (for >500 records)

### Live Data:
- [ ] Receives push-generated records (type 0x03)
- [ ] Records accepted even when not in sync state
- [ ] Records have correct format (20 bytes)

### System Commands:
- [ ] All commands use correct format (0xAA + Command ID + Length + Data)
- [ ] All responses use correct format (0xBB + Command ID + Length + Status + Data)
- [ ] Status 0x00 = Success, 0x01 = Failure
- [ ] All multi-byte values in Little Endian

### Power Management:
- [ ] Normal mode after pairing
- [ ] Low power mode when idle
- [ ] Deep sleep on low battery
- [ ] Battery monitoring works

### DFU:
- [ ] Only bonded devices can initiate DFU
- [ ] Device enters DFU mode correctly
- [ ] Firmware transfer works
- [ ] Validation and flashing succeed
- [ ] Device resumes normal operation after DFU

---

**Document Version:** 1.0  
**Based on:** ET-DSSID-SSD-V1.5_12012026.md  
**Date:** 2026-01-12

