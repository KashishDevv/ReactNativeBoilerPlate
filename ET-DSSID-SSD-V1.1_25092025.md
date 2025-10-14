**Software Design Document**

**DyreID**

**Smart Health Tag**

**Release History:**

| **Version No.** | **Release Date** | **Prepared By** | **Approved By** | **Remarks** | **Reviewed By** | **Customer Approval** |
|-----------------|------------------|-----------------|-----------------|-------------|-----------------|-----------------------|
| 1.0             | 15/07/2025       | SA              |                 |             | Gopal           |                       |
| 1.1             | 25/09/2025       | SA              |                 |             |                 |                       |
|                 |                  |                 |                 |             |                 |                       |

[]{#_Toc97612280 .anchor}Table 1 Terms and Abbreviations

# **TABLE OF CONTENT** {#table-of-content .TOC-Heading2}

[1 INTRODUCTION [4](#introduction)](#introduction)

[1.1 Purpose [4](#purpose)](#purpose)

[1.2 Scope [4](#scope)](#scope)

[2 GLOSSARY [4](#glossary)](#glossary)

[3 REFERENCE [4](#reference)](#reference)

[4 SYSTEM OVERVIEW [5](#system-overview)](#system-overview)

[5 SOFTWARE DESIGN [6](#software-design)](#software-design)

[5.1 OS [6](#os)](#os)

[5.2 Base Software Modules
[6](#base-software-modules)](#base-software-modules)

[5.3 Accelerometer [7](#accelerometer)](#accelerometer)

[5.4 BLE [7](#ble)](#ble)

[5.5 NFC [8](#nfc)](#nfc)

[5.6 GPIO [8](#gpio)](#gpio)

[6 APPLICATION DESIGN [8](#application-design)](#application-design)

[6.1 Application Power Modes
[9](#application-power-modes)](#application-power-modes)

[6.1.1 Sleep Mode [9](#sleep-mode)](#sleep-mode)

[6.1.2 Normal / IDLE Mode [10](#normal-idle-mode)](#normal-idle-mode)

[6.1.3 Low Power Mode [11](#low-power-mode)](#low-power-mode)

[6.1.4 Deep Sleep / Shutdown Mode
[12](#deep-sleep-shutdown-mode)](#deep-sleep-shutdown-mode)

[6.2 Application Module [13](#application-module)](#application-module)

[6.2.1 BLE Manager [13](#ble-manager)](#ble-manager)

[6.2.2 Sensor module [13](#sensor-module)](#sensor-module)

[6.2.3 Step Counter [14](#step-counter)](#step-counter)

[6.2.4 Battery Module [14](#battery-module)](#battery-module)

[6.3 BLE Services & Characteristics
[15](#ble-services-characteristics)](#ble-services-characteristics)

[6.3.1 GATT services in Smart Health Tag
[15](#gatt-services-in-smart-health-tag)](#gatt-services-in-smart-health-tag)

[6.3.2 Buttonless Secure DFU services
[15](#buttonless-secure-dfu-services)](#buttonless-secure-dfu-services)

[6.3.3 Smart Health Tag Data services
[16](#smart-health-tag-data-services)](#smart-health-tag-data-services)

[6.4 BLE Security [19](#ble-security)](#ble-security)

[6.5 BLE Advertising Packet Structure
[20](#ble-advertising-packet-structure)](#ble-advertising-packet-structure)

[6.6 NFC Tag configuration and security
[20](#nfc-tag-configuration-and-security)](#nfc-tag-configuration-and-security)

[6.7 RTC Manager [21](#rtc-manager)](#rtc-manager)

[6.8 Flash Storage [21](#flash-storage)](#flash-storage)

[6.9 DFU Process [22](#dfu-process)](#dfu-process)

[6.10 Application Sequence Diagram
[23](#application-sequence-diagram)](#application-sequence-diagram)

[6.11 Application Lifecycle Functions
[23](#application-lifecycle-functions)](#application-lifecycle-functions)

[6.11.1 Tag Registration Process
[23](#tag-registration-process)](#tag-registration-process)

[6.11.2 Secure Connection [24](#secure-connection)](#secure-connection)

[6.11.3 Data Synchronization
[24](#data-synchronization)](#data-synchronization)

[6.11.4 Battery Alert & Deep Sleep
[24](#battery-alert-deep-sleep)](#battery-alert-deep-sleep)

[6.12 Health Tag Power profiling
[25](#health-tag-power-profiling)](#health-tag-power-profiling)

#  **TABLE OF TABLE** {#table-of-table .TOC-Heading2}

[Table 1 Terms and Abbreviations [4](#_Toc97612280)](#_Toc97612280)

[Table 2 BLE Manager APIs [13](#_Toc203483718)](#_Toc203483718)

[Table 3 Sensor Monitor APIs [14](#_Toc203483719)](#_Toc203483719)

[Table 4 Step Counter APIs [14](#_Toc203483720)](#_Toc203483720)

[Table 5 Battery Monitor APIs [15](#_Toc203483721)](#_Toc203483721)

[Table 6 BLE Device Info Characteristics UUID
[15](#_Toc203483722)](#_Toc203483722)

[Table 7 DFU Service Characteristics UUID
[15](#_Toc203483723)](#_Toc203483723)

[Table 8 Health Tag Data Services Characteristics UUID
[16](#_Toc203483724)](#_Toc203483724)

[Table 9 System Command List [17](#_Toc203483725)](#_Toc203483725)

[Table 10 System Command Request format
[17](#_Toc203483726)](#_Toc203483726)

[Table 11 System Command Response Format
[17](#_Toc203483727)](#_Toc203483727)

[Table 12 Device status characteristic data format
[18](#_Toc203483728)](#_Toc203483728)

[Table 13 BLE Advertising Packet structure
[20](#_Toc203483729)](#_Toc203483729)

[Table 14 Internal Flash portions [21](#_Toc203483730)](#_Toc203483730)

**TABLE OF FIGURES**

[Figure 1 System Overview [5](#_Toc203483731)](#_Toc203483731)

[Figure 2 Software Modules [6](#_Toc203483732)](#_Toc203483732)

[Figure 3 Sleep Power Mod [9](#_Toc203483733)](#_Toc203483733)

[Figure 4 Idle Power Mode [10](#_Toc203483734)](#_Toc203483734)

[Figure 5 Low Power Mode [11](#_Toc203483735)](#_Toc203483735)

[Figure 6 Deep Sleep Power Mode [12](#_Toc203483736)](#_Toc203483736)

[Figure 7 BLE Data Synchronization [19](#_Toc203483737)](#_Toc203483737)

[Figure 8 Application Sequence Diagram
[23](#_Toc203483738)](#_Toc203483738)

# INTRODUCTION

## Purpose

This document serves to define the software design framework for the
development of the Smart Health Tag intended for pets. It is structured
in accordance with the functional and non-functional requirements
specified by DyreID.

## Scope

This document outlines the software design for the Smart Health Tag,
focusing on embedded firmware development and its interaction with
hardware components, communication protocols, and external interfaces.

# GLOSSARY  {#glossary}

This section will specify the acronyms and abbreviations that will be
used in the document.

| **Abbreviation** | **Description**                    |
|------------------|------------------------------------|
| SHT              | Smart Health Tag                   |
| BLE              | Bluetooth Low Energy               |
| NFC              | Near Field Communication           |
| LED              | Light Emitting Diode               |
| UUID             | Universally Unique Identifier      |
| FUP              | Firmware Upgrade Process           |
| ADC              | Analog to Digital Converter        |
| GATT             | Generic Attribute Profile          |
| RSSI             | Received Signal Strength Indicator |
| GPIO             | General Purpose Input Output       |
| PWM              | Pulse Width Modulation             |
| OTA              | Over the Air                       |
| RTC              | Real Time Clock                    |
| AES              | Advanced Encryption Standard       |
| OS               | Operating System                   |
| DMA              | DyreID Mobile App                  |

[]{#_Toc203483718 .anchor}Table 2 BLE Manager APIs

# REFERENCE

- Smart tag project kick-off presentation.pptx

<!-- -->

- Smart Tag Development Agreement.docx

- ET-DSSID_SYRS_V1.0_240625.docx

# SYSTEM OVERVIEW

This section provides an overview of the software and hardware building
blocks that will be developed for Smart Health Tag.

The Smart Health Tag is a small, pet-friendly device that seamlessly
integrates health monitoring and location tracking.

This overview diagram illustrates the interactions between software
modules, hardware components, and external interfaces within the Smart
Health Tag system.

![](media/image2.jpeg){width="5.597916666666666in"
height="6.114583333333333in"}![](media/image3.png){width="5.597916666666666in"
height="6.114583333333333in"}

[]{#_Toc203483731 .anchor}Figure 1 System Overview

# SOFTWARE DESIGN

This section details the overall software architecture of the Smart
Health Tag, including its layered design, module decomposition, and
interaction with hardware and external systems. It defines functional
blocks such as sensor management, data processing, BLE communication,
power management, and firmware update mechanisms.

## OS

- RTOS Used: Zephyr OS.

- Features: Work queues, low power states, and real-time scheduling.

- Device Modes Management: Power states (Idle, Low Power, Sleep, Deep
  Sleep) managed through Zephyr power management APIs.

- A bare-metal approach is chosen for power management if necessary,
  meaning the system operates without an operating system.

## Base Software Modules

The section describes the design of the system specifically for software
modules.

> []{#_Toc203483732 .anchor}Figure 2 Software Modules

## Accelerometer

BMA400 provides a low-power, efficient step detection mechanism which
configures,

- Low-power mode

- ODR = 50-100Hz

- Step counter feature enable bit

- Optionally, an interrupt pin so the BMA400 can notify when a step is
  detected.

The BMA400 continuously monitors movement and accumulates steps
internally, while the nRF54L15 remains in sleep mode. This offloads
processing and saves battery, ideal for wearable's and battery-powered
tags.

I2C or SPI will be used to communicate between nRF54L15 and BMA400.

Step count can be determined through either of two methods.

1)  [Using Built-In Step Counter]{.underline}

- Enable step counter interrupt.

- Power mode: BMA400_POWER_MODE_LOW_POWER.

- Set desired output data rate (ODR): usually 100Hz or lower.

- Enable Interrupt (Optional): Configure INT1 or INT2 pin for step
  counter interrupt.

- Read STEP_CNT_LSB (0x1E) and STEP_CNT_MSB (0x1F) periodically or when
  interrupt triggers.

2)  [Custom Step Count Algorithm]{.underline}

- Set ODR to 50--100 Hz.

- Read X, Y, Z axis values from 0x04 to 0x09 registers.

- Apply an algorithm to detect steps.

## BLE

Supports latest BLE Version: BLE 6.0.

Up to 2 Mbps data rate for fast data transfer.

Optimized for low-latency and low-power.

Advanced advertising features including extended, periodic, and directed
advertising for improved range, efficiency, and fast reconnection.

Features:

Secure connections

- Bonding and Whitelisting supported

- Secure pairing (Just Works, Passkey, OOB).

- LE Secure Connections with 128-bit AES encryption.

- Hardware root of trust and support for secure DFU.

DFU support

- BLE facilitates OTA updates, enabling seamless software upgrades
  without physical access

- Secure firmware updates via BLE require bonding and encryption and can
  include image signing to verify data integrity.

- A dedicated BLE GATT service handles DFU by managing commands,
  transferring firmware chunks, and reporting update status.

## NFC

Tag Emulation (NFC-A): Acts as a Passive NFC Mode, allowing the device
to emulate an NFC tag readable by smartphones and readers.

Use Case:

- Tap-to-Pair for BLE: Automatically initiates secure BLE pairing when
  tapped by a phone.

- Device Identification: Shares static info like device name, serial, or
  URL (NDEF records).

- Wake-Up Trigger: NFC field detection can be used to wake the device
  from deep sleep.

Security & Access Control:

- NFC writes can be restricted by software:

> Read-only mode
>
> Write only if encrypted/authenticated

## GPIO

It is a configurable digital pin used to either read input signals (like
buttons or sensors) or control output devices (like LEDs or relays)

# APPLICATION DESIGN

This section provides a detailed explanation of the technical
architecture that will be used to build the application, outlining how
various software components, services, and communication interfaces are
organized and interact with each other to fulfil the defined functional
requirements.

Tag Operating Modes

## Application Power Modes

### Sleep Mode

- Most peripherals and CPU are suspended.

- BLE remains active to maintain or allow new connections, with high
  advertising intervals to save power.

- Used when waiting for commands or reconnection but no immediate
  activity.

> []{#_Toc203483733 .anchor}Figure 3 Sleep Power Mod

### Normal / IDLE Mode {#normal-idle-mode}

- All system peripherals (BLE, sensors, ADC, NFC, etc.) are active.

- BLE runs with high advertising and connection intervals, enabling
  quick interaction.

- Data exchange like step count and temperature between device and
  mobile app takes place.

> []{#_Toc203483734 .anchor}Figure 4 Idle Power Mode

### Low Power Mode

- Only essential modules like the BMA400 accelerometer and BLE are
  active.

- Sensor readings are performed periodically.

- BLE uses a moderate advertising interval to balance power and
  responsiveness.

> []{#_Toc203483735 .anchor}Figure 5 Low Power Mode

### Deep Sleep / Shutdown Mode {#deep-sleep-shutdown-mode}

- System is in ultra-low power state.

- BLE advertising is disabled.

- Sensors other peripherals are stopped.

- Used for extended inactivity or battery conservation.

- The minimum battery threshold value to be configured, based on deep
  sleep mode is triggered.

- The tag will be powered off after the battery level is exhausted
  completely.

![](media/image7.png){width="5.740277777777778in"
height="4.246527777777778in"}

> []{#_Toc203483736 .anchor}Figure 6 Deep Sleep Power Mode

## Application Module

The Application Module of a Smart Health Tag plays a central role in
processing data, managing sensor inputs, performing health analytics,
and communicating with external devices (like mobile apps or cloud
services). Here\'s a detailed explanation of the component.

### BLE Manager

Manage the creating characteristics, write, read and notification
handling.

| **APIs**                                                                           | **Description**                                                                 |
|------------------------------------------------------------------------------------|---------------------------------------------------------------------------------|
| void ble_manager_init(void)                                                        | Initializes BLE stack, services, and advertising.                               |
| void ble_manager_start_advertising(void)                                           | Starts BLE advertising.                                                         |
| void ble_manager_stop_advertising(void)                                            | Stops advertising.                                                              |
| void ble_manager_on_connect(struct bt_conn \*conn, uint8_t err)                    | Called when a BLE connection is established.                                    |
| void ble_manager_on_disconnect(struct bt_conn \*conn, uint8_t reason)              | Called when BLE connection is lost or closed.                                   |
| bool ble_manager_is_connected(void)                                                | Returns true if BLE is currently connected.                                     |
| int ble_manager_register_servicess(void)                                           | Registers custom GATT services (Data Exchange, Config, Battery, DFU).           |
| int ble_manager_notify_data(uint8_t \*data, uint16_t len)                          | Sends notification to a connected central via the Data Exchange characteristic. |
| int ble_manager_set_config_param(uint16_t param_id, uint8_t \*value, uint16_t len) | Updates a configuration parameter from BLE write.                               |
| void ble_manager_auth_cb_register(void)                                            | Registers pairing callbacks (for passkey, bonding, etc.).                       |
| bool ble_manager_is_bonded(struct bt_conn \*conn)                                  | Checks if the connected device is a bonded peer.                                |
| void ble_manager_enter_dfu_mode(void)                                              | Sets DFU start flag and restarts device into bootloader.                        |

[]{#_Toc203483719 .anchor}Table 3 Sensor Monitor APIs

### Sensor module

Read the accelerometer reading from the BMA400 along with the
temperature.

<table>
<caption><p><span id="_Toc203483720" class="anchor"></span>Table 4 Step
Counter APIs</p></caption>
<colgroup>
<col style="width: 47%" />
<col style="width: 52%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>APIs</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>int sensor_monitor_init(void)</td>
<td>Initializes the I2C/SPI interface and configures the BMA400
sensor.</td>
</tr>
<tr class="even">
<td>int sensor_monitor_read_accel(int16_t *x, int16_t *y, int16_t
*z)</td>
<td>Reads raw acceleration values from the BMA400’s X, Y, Z axes</td>
</tr>
<tr class="odd">
<td>float sensor_monitor_read_magnitude(void)</td>
<td>Calculates the total acceleration vector magnitude from X, Y,
Z.</td>
</tr>
<tr class="even">
<td>bool sensor_monitor_detect_step(void)</td>
<td>Returns true if a valid step was detected based on accelerometer
pattern.</td>
</tr>
<tr class="odd">
<td><p>void sensor_monitor_set_threshold</p>
<p>(uint16_t threshold)</p></td>
<td>Sets motion detection threshold.</td>
</tr>
<tr class="even">
<td><p>void sensor_monitor_start_polling</p>
<p>(uint32_t interval_ms)</p></td>
<td>Starts periodic sensor reading in the background using a timer or
work queue.</td>
</tr>
<tr class="odd">
<td>void sensor_monitor_stop_polling(void)</td>
<td>Stops scheduled sensor reads (used in sleep or low-power mode).</td>
</tr>
<tr class="even">
<td><p>void sensor_monitor_set_mode_low_power</p>
<p>(void)</p></td>
<td>Adjusts BMA400 power/sampling mode to optimize battery usage.</td>
</tr>
<tr class="odd">
<td>void sensor_monitor_set_mode_normal(void)</td>
<td>Adjusts BMA400 power/sampling mode to optimize battery usage.</td>
</tr>
</tbody>
</table>

[]{#_Toc203483720 .anchor}Table 4 Step Counter APIs

### Step Counter

Perform the algorithm to find step count based on the read accelerometer
axes values.

<table>
<caption><p><span id="_Toc203483721" class="anchor"></span>Table 5
Battery Monitor APIs</p></caption>
<colgroup>
<col style="width: 45%" />
<col style="width: 54%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>APIs</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>void step_counter_process_sample(int16_t x, int16_t y, int16_t
z)</td>
<td><p>Accepts raw accelerometer data (typically from
sensor_monitor)</p>
<p>Internally filters, normalizes, and detects step patterns</p></td>
</tr>
<tr class="even">
<td>uint32_t step_counter_get_count(void)</td>
<td>Returns the total number of valid steps detected since last
reset</td>
</tr>
<tr class="odd">
<td>void step_counter_reset(void)</td>
<td>Clears the current step count and resets algorithm state</td>
</tr>
</tbody>
</table>

[]{#_Toc203483721 .anchor}Table 5 Battery Monitor APIs

### Battery Module

Read the battery voltage using the ADC.

<table>
<caption><p><span id="_Toc203483722" class="anchor"></span>Table 6 BLE
Device Info Characteristics UUID</p></caption>
<colgroup>
<col style="width: 44%" />
<col style="width: 55%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>APIs</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>void battery_monitor_init(void)</td>
<td>Initializes the ADC peripheral</td>
</tr>
<tr class="even">
<td>uint16_t battery_monitor_read_mv(void)</td>
<td><p>Reads the raw ADC value, converts it to millivolts (mV)</p>
<p>Returns the measured battery voltage</p></td>
</tr>
<tr class="odd">
<td><p>uint8_t battery_monitor_get_percentage</p>
<p>(void)</p></td>
<td>Converts battery voltage to battery level percentage.</td>
</tr>
<tr class="even">
<td><p>void battery_monitor_set_low_battery_</p>
<p>threshold(uint16_t mv)</p></td>
<td>Sets a custom threshold for low battery warning.</td>
</tr>
<tr class="odd">
<td><p>bool battery_monitor_is_battery_low</p>
<p>(void)</p></td>
<td>Returns true if current voltage is below the threshold.</td>
</tr>
<tr class="even">
<td><p>void battery_monitor_start_periodic_check</p>
<p>(uint32_t interval_ms)</p></td>
<td>Starts a timer to check battery level at defined intervals.</td>
</tr>
<tr class="odd">
<td><p>void battery_monitor_stop_periodic_chec</p>
<p>k(void)</p></td>
<td>Stops a timer to check battery level.</td>
</tr>
</tbody>
</table>

[]{#_Toc203483722 .anchor}Table 6 BLE Device Info Characteristics UUID

## BLE Services & Characteristics {#ble-services-characteristics}

GATT (Generic Attribute Profile) defines how two Bluetooth Low Energy
(BLE) devices communicate after a connection is established, using a
client-server architecture. The server (e.g., a BLE device like a smart
health tag) holds the data, while the client (e.g., a smartphone)
accesses it by reading, writing, or subscribing to updates.

GATT organizes data into Services, which group related
Characteristics---the actual data elements.

Each Characteristic includes a Value (e.g., step count = 12743) and
Properties that specify how it can be used: Read (client reads the
value), Write (client updates the value), Notify (server sends updates
without acknowledgment), and Indicate (server sends updates with
acknowledgment).

### GATT services in Smart Health Tag

| **Name**                         | **Uniform Type Identifier**              | **Assigned UUID** |
|----------------------------------|------------------------------------------|-------------------|
| [Generic Access]{.underline}     | org.bluetooth.service.generic_access     | 1800              |
| [Battery Service]{.underline}    | org.bluetooth.service.battery_service    | 180F              |
| [Device Information]{.underline} | org.bluetooth.service.device_information | 180A              |

[]{#_Toc203483723 .anchor}Table 7 DFU Service Characteristics UUID

### Buttonless Secure DFU services

> Smart health tag has [Buttonless Secure DFU Service.]{.underline} It
> is a proprietary BLE service that enables entering DFU mode from a BLE
> application during a Secure Device Firmware Update.
>
> The Buttonless Secure DFU Service uses the Nordic-proprietary 16-bit
> UUID for Secure DFU (0xFE59)

<table>
<caption><p><span id="_Toc203483724" class="anchor"></span>Table 8
Health Tag Data Services Characteristics UUID</p></caption>
<colgroup>
<col style="width: 32%" />
<col style="width: 41%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Characteristic</strong></th>
<th><strong>UUID</strong></th>
<th><strong>Access Permissions</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td><blockquote>
<p>Buttonless DFU without bonds</p>
</blockquote></td>
<td><blockquote>
<p>0x8EC90003-</p>
<p>F315-4F60-9FB8-838830DAEA50</p>
</blockquote></td>
<td><blockquote>
<p>Write, Indicate</p>
</blockquote></td>
</tr>
</tbody>
</table>

[]{#_Toc203483724 .anchor}Table 8 Health Tag Data Services
Characteristics UUID

#### Data Transfer Characteristic

Handles secure over-the-air firmware updates.

- Key Characteristics:

> DFU Control Point: Starts and controls update flow.
>
> DFU Packet: Receives firmware data chunks.
>
> DFU Version: Reports current firmware version.

- Workflow:

> App connects and triggers DFU mode.
>
> Device reboots into bootloader and advertises DFU service.
>
> App reconnects and sends new firmware.
>
> Device validates and flashes update.

- Security:

> Requires bonded connection.
>
> Can include signature and checksum verification.

Payload: 12 2B 00 01

Command - 0x12

Handle - 0x002B

Value - 01 (uint8 → 1- Start DFU)

Payload: 52 2C 00 DE AD BE EF 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E
0F 10

Command - 0x52

Handle - 0x002C

Value - DE AD BE EF 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F 10
(20-byte packet)

**NOTE: Please Refer the NRF DFU process.**

### Smart Health Tag Data services

> UUID: 0x0F0E0D0C0B0A0009080706050403020100

<table>
<caption><p><span id="_Toc203483725" class="anchor"></span>Table 9
System Command List</p></caption>
<colgroup>
<col style="width: 32%" />
<col style="width: 41%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Characteristic</strong></th>
<th><strong>UUID</strong></th>
<th><strong>Access Permissions</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>System Command</td>
<td><blockquote>
<p>0x4F4E4D4C4B4A49484746454443424140</p>
</blockquote></td>
<td>Write, Read, Notify</td>
</tr>
<tr class="even">
<td>Device Status</td>
<td><blockquote>
<p>0x5F5E5D5C5B5A59585756555453525150</p>
</blockquote></td>
<td>Read, Notify</td>
</tr>
<tr class="odd">
<td>Data transfer</td>
<td><blockquote>
<p>0x6F6E6D6C6B6A69686766656463626160</p>
</blockquote></td>
<td>Read, Notify</td>
</tr>
</tbody>
</table>

[]{#_Toc203483725 .anchor}Table 9 System Command List

#### System Command Characteristic

[**UUID:** 0x4F4E4D4C4B4A49484746444443424140]{.mark}

> **Permissions (CCC)**: WRITE, READ, NOTIFICATION
>
> **Command List**

<table>
<caption><p><span id="_Toc203483726" class="anchor"></span>Table 10
System Command Request format</p></caption>
<colgroup>
<col style="width: 31%" />
<col style="width: 11%" />
<col style="width: 11%" />
<col style="width: 44%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Name</strong></th>
<th><strong>ID</strong></th>
<th><strong>Length</strong></th>
<th><strong>Data</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Set System Time</td>
<td>0x01</td>
<td>4</td>
<td>Unix Timestamp (in seconds)</td>
</tr>
<tr class="even">
<td>Set Advertising interval</td>
<td>0x02</td>
<td>4</td>
<td>Advertising interval (in milliseconds)</td>
</tr>
<tr class="odd">
<td>Set Connection interval</td>
<td>0x03</td>
<td>4</td>
<td>Connection interval (in milliseconds)</td>
</tr>
<tr class="even">
<td>Set data Acquisition interval</td>
<td>0x04</td>
<td>4</td>
<td>Data interval (in seconds)</td>
</tr>
<tr class="odd">
<td>Get Firmware Version</td>
<td>0x05</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="even">
<td>Get Hardware Version</td>
<td>0x06</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="odd">
<td>Get Diagnostics Info</td>
<td>0x07</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="even">
<td>Data Sync Start Request</td>
<td>0x08</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="odd">
<td>Data Sync Stop Request</td>
<td>0x09</td>
<td>1</td>
<td><p>0x01 - Clear Flash Data.</p>
<p>0x00 - Sync process failed. Reinitiate the sync process.</p></td>
</tr>
<tr class="even">
<td>System Restart</td>
<td>0x10</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="odd">
<td>Toggle Buzzer</td>
<td>0x11</td>
<td>1</td>
<td><p>0x00 – Activate buzzer</p>
<p>0x01 – Deactivate buzzer</p></td>
</tr>
</tbody>
</table>

[]{#_Toc203483726 .anchor}Table 10 System Command Request format

> **Request Command Format**
>
> **Size:** 20 bytes
>
> **Format:** 1 byte Request Id, 1 byte command id, 1 byte command
> length and up-to 17 bytes for data All data will be in 'Little Endian
> Format'

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2)** | **Byte Offset (3 -- 19)** |
|---------------------|---------------------|---------------------|---------------------------|
| Request ID - 0xAA   | Command ID          | Command length      | Command Data              |

[]{#_Toc203483727 .anchor}Table 11 System Command Response Format

**Response Command Format**

**Size** **:** 20 bytes

**Format:** 1 byte Response Id, 1 byte command id, 1 byte response
length and up-to 17 bytes for data and status All data will be in
'Little Endian Format'

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2)** | **Byte Offset (3)** | **Byte Offset (4 -- 19)** |
|---------------------|---------------------|---------------------|---------------------|---------------------------|
| Response ID 0xBB    | Command ID          | Response length     | Response status     | Response Data             |

[]{#_Toc203483728 .anchor}Table 12 Device status characteristic data
format

**Example:**

**Set System time Command:** 0xAA01047929D568

0xAA -- Request ID

0x01 -- Command ID

0x04 -- Command length

0x6874851D -- Time - **GMT**: Thursday, 25 September 2025 11:37:29 AM

**Set System time Response:** 0xBB010000

0xBB -- Response ID

0x01 -- Command ID

0x00 -- Response length

0x00 -- Status -\> 0x00 -- Success, 0x01 - Failure

#### Device Status Characteristic

> [**UUID:** 0x5F5E5D5C5B5A59585756555453525150]{.mark}
>
> **Permissions (CCC)**: READ, NOTIFICATION
>
> **Size:** 20 bytes
>
> **Format:** 20 bytes for data all data will be in 'Little Endian
> format'

| **Byte Offset (0 - 3)** | **Byte Offset (4- 5)** | **Byte Offset (6)** | **Byte Offset (7)** | **Byte Offset (8 -- 19)** |
|-------------------------|------------------------|---------------------|---------------------|---------------------------|
| Timestamp               | Steps counter data     | Temperature         | Device status flag  | Reserved - 0x00           |

[]{#_Toc203483729 .anchor}Table 13 BLE Advertising Packet structure

#### Data Transfer Characteristic

[**UUID:** 0x6F6E6D6C6B6A69686766656463626160]{.mark}

**Permissions (CCC)**: READ, NOTIFICATION

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2- 19)** |
|---------------------|---------------------|-------------------------|
| Data Type           | Length              | Record data             |

[]{#_Toc203483730 .anchor}Table 14 Internal Flash portions

**Data Type Table:**

<table>
<colgroup>
<col style="width: 31%" />
<col style="width: 11%" />
<col style="width: 11%" />
<col style="width: 44%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Name</strong></th>
<th><strong>ID</strong></th>
<th><strong>Length</strong></th>
<th><strong>Data</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Data Sync Start</td>
<td>0x01</td>
<td>4</td>
<td>Total Record info</td>
</tr>
<tr class="even">
<td>Data Sync Complete</td>
<td>0x02</td>
<td>2</td>
<td><p>(0xFFFF) – Force termination</p>
<p>(0X0001 to 0x01F4) – Number of records transmitted</p></td>
</tr>
<tr class="odd">
<td>Record Data</td>
<td>0x03</td>
<td>6 - 18</td>
<td>Record data. 1 set of records contains 8 bytes including Timestamp,
Temperature and Step data.</td>
</tr>
<tr class="even">
<td>Data Read Error</td>
<td>0x04</td>
<td>1</td>
<td>No Data (0x00) - Application terminates the sync process.</td>
</tr>
</tbody>
</table>

> []{#_Toc203483737
> .anchor}![](media/image8.png){width="6.697916666666667in"
> height="6.354166666666667in"}Figure 7 BLE Data Synchronization

## BLE Security

Pairing: Establishes a secure link between two BLE devices using methods
like Just Works, Passkey Entry, or Numeric Comparison.

Bonding: Stores encryption keys for future trusted reconnections without
re-pairing.

Uses 128-bit AES encryption to secure data during communication.

Ensures only trusted (bonded) devices can access sensitive services
(e.g., DFU or configuration).

## BLE Advertising Packet Structure

Device-specific UUID to be embed in advertisement packet or GATT
characteristic.

BLE Advertising Configuration

- Shortened name or manufacturer-specific data to be included.

- UUID, Battery level and data indication to be included in manufacturer
  data.

- 

<table>
<colgroup>
<col style="width: 38%" />
<col style="width: 8%" />
<col style="width: 52%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Field</strong></th>
<th><strong>Bytes</strong></th>
<th><strong>Description</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>02 01 06</td>
<td>3</td>
<td>Flags: LE General Discoverable, BR/EDR Not Supported</td>
</tr>
<tr class="even">
<td>11 09 53 6D 61 72 74 20 48 65 61 6C 74 68 20 54 61 67</td>
<td>18</td>
<td>Local Name = "Smart Health Tag" (or) UUID</td>
</tr>
<tr class="odd">
<td>0C FF 34 12 01 00 AA BB CC DD</td>
<td>10</td>
<td><table>
<colgroup>
<col style="width: 1%" />
<col style="width: 98%" />
</colgroup>
<thead>
<tr class="header">
<th></th>
<th>Manufacturer Specific Data: indication, + 5 bytes extra (battery
info and required data)</th>
</tr>
</thead>
<tbody>
</tbody>
</table></td>
</tr>
</tbody>
</table>

\*Pre-share a 128-bit AES key with DyreID mobile app.  
\*Encrypt the manufacturer data using AES-128 (ECB or CTR mode).

**Manufacturer Specific Data**

| **Byte** | **Value** | **Description**                                                  |
|----------|-----------|------------------------------------------------------------------|
| 0C       | 10        | Length of this field (1 byte type + 9 bytes data)                |
| FF       | 0xFF      | Type: Manufacturer Specific Data                                 |
| 34 12    | 0x12 0x34 | Company ID                                                       |
| 1        | 1         | Indication to connect                                            |
| 0        | 0         | Device functional status (0 -- Good, 1-encountered with problem) |
| 01 F4    | 500       | Number of records available                                      |
| 0B B8    | 3000      | Battery value in milliVolt                                       |

## NFC Tag configuration and security

- Data Transmission via Characteristics

  - The DyreID activation URL is written to the NFC tag during the
    production stage.

- NFC Data Handling

<!-- -->

- The NFC data can later be modified via DyreID Mobile App.

- All data written to NFC must be encrypted (e.g., 128-bit AES).

- Application must decrypt and validate before writing any data to NFC
  memory.

<!-- -->

- Data Validation Logic

<!-- -->

- After decryption, the input data must be validated for integrity,
  format, and authenticity.

- Only valid and verified data should be accepted for NFC write
  operations.

<!-- -->

- Write Protection for Invalid Data

<!-- -->

- If the decrypted input is found invalid, it will be discarded, and the
  NFC write operation will be blocked.

## RTC Manager

- RTC Initialization

  - Enable and configure the internal RTC peripheral.

- RTC Time synchronization

  - Synchronize RTC through BLE connection.

- Data Logging and Time stamping

  - Log sensor data like step count and temperature along with
    timestamp.

  - Set alarms for scheduled tasks (e.g., data logging every configured
    interval).

## Flash Storage

Internal flash storage of 1.5 MB is portioned into the following;

<table>
<colgroup>
<col style="width: 29%" />
<col style="width: 10%" />
<col style="width: 60%" />
</colgroup>
<thead>
<tr class="header">
<th><strong>Section</strong></th>
<th><strong>Size</strong></th>
<th><strong>Purpose</strong></th>
</tr>
</thead>
<tbody>
<tr class="odd">
<td>Bootloader + Application</td>
<td>500 kB</td>
<td><p>Contains bootloader, application.</p>
<p>Must fit within 500 KB for reliable OTA/DFU updates.</p></td>
</tr>
<tr class="even">
<td>Device Info / Config</td>
<td>100 kB</td>
<td>Stores persistent data:<br />
  • Unique ID / Serial Number<br />
  • Pairing/Bonding info<br />
  • Configuration settings</td>
</tr>
<tr class="odd">
<td>Data Logging Area</td>
<td>900 kB</td>
<td>Used for logging:<br />
  • Step count<br />
  • Temperature data<br />
  • Timestamps</td>
</tr>
</tbody>
</table>

## DFU Process

- App-Initiated DFU Trigger

  - After a secure connection is established, the mobile app sends a
    secure write (often to a characteristic like DFU Control Point)
    indicating a DFU start request.

The firmware validates that: The request comes from a bonded/authorized
device.

1.  

- Switch to Bootloader / DFU Mode

  - Sets a DFU start flag in flash.

  - Disconnects BLE and resets into bootloader/DFU mode.

  - In DFU mode, it advertises a separate DFU service UUID.

- Reconnect and Transfer Firmware

  - The mobile app reconnects to the DFU mode advertisement.

  - Sends: Init packet (firmware metadata, checksum, optional signature)

  - Firmware image in chunks (20--244 bytes depending on MTU)

  - Device stores this image in a reserved flash partition.

- Validation and Flashing

  - After full image transfer: Device performs CRC check, version check,
    and digital signature verification.

  - If valid: New firmware is flashed over the old application

  - Settings (e.g., firmware version) are updated.

- Reboot and Resume Normal Mode

  - Device resets back to application firmware.

  - Resumes advertising as usual.

  - May notify the app of success on next connection.

- Key Security Aspects:

  - Only paired/bonded mobile app can initiate DFU.

  - Firmware images are signed or encrypted.

  - DFU triggers are hidden or inaccessible to unauthorized BLE clients.

  - Bootloader is protected against unauthorized overwrites.

- Error Handling

  - Revert to the previous firmware version in case of an upgrade
    failure or detection of invalid firmware.

  - Retry mechanism.

## Application Sequence Diagram

This section presents the Application Sequence Diagram, which
illustrates the step-by-step interaction between different components of
the system---such as the mobile app, BLE tag and user actions. The
sequence diagram helps visualize the flow of messages and operations in
a time-ordered manner, showing how the application handles specific use
cases (e.g., tag registration, data sync, firmware update).

![](media/image9.png){width="6.916666666666667in"
height="5.291666666666667in"}

> []{#_Toc203483738 .anchor}Figure 8 Application Sequence Diagram

##  Application Lifecycle Functions {#application-lifecycle-functions}

Application lifecycle functions define the structured stages that
firmware follows---from initial power-up to shut down or transition into
low-power sleep modes. These stages are essential for ensuring efficient
operation in embedded systems that are low-power, real-time, and
constrained by limited memory and processing resources.

###  Tag Registration Process {#tag-registration-process}

- User taps phone on NFC tag.

- Phone opens DyreID app via encoded URL.

- App reads tag_id=xxyyzz and shows registration form.

- User fills in details and submits.

- App confirms successful registration.

###  Secure Connection {#secure-connection}

- The tag continuous to advertise BLE packets for a minimum advertising
  interval period, where tag will be in low power mode.

- The tag advertises itself over Bluetooth LE

> Broadcasts a unique Device Name/ID.

Includes Service UUID (custom UUID for pet data).

- Advertising packet may include minimal data (e.g., battery level, tag
  status).

- The DyreID mobile app scans for nearby BLE devices.

- It filters devices based on:

Known name prefix (e.g., DYRE-PET-XXXX).

Specific Service UUID.

- User selects their tag to pair.

- DyreID app initiates BLE Secure Connection using: Just Works or
  Passkey Entry or Numeric Comparison pairing method depending on
  capability.

- After successful pairing with DyreID mobile app, Tag switches to
  normal/idle power mode.

###  Data Synchronization {#data-synchronization}

- Once connected and paired securely, the DyreID app performs GATT
  Service Discovery.

- Retrieves list of available characteristics, e.g.:

Step Count characteristic (read/notify)

Battery Level

Firmware Version

- DyreID app reads or subscribes to the Step Count Characteristic
  (custom).

- Tag sends current step count data: Can be polled (READ) or streamed
  (NOTIFY).

###  Battery Alert & Deep Sleep {#battery-alert-deep-sleep}

- Tag has a battery monitoring circuit.

- Monitors battery voltage at regular intervals.

- Tag checks battery level → if low: Updates Battery Level
  Characteristic.

- Tag transmits battery status to the DyreID app.

- Triggering Deep Sleep mode:

> After critical battery threshold or prolonged inactivity, Tag
> disconnects from BLE (if connected).
>
> Shut down sensors, radio, peripherals.
>
> Enter Deep Sleep mode.
>
> Data logging will be stopped. But retains the data which is already

- Wake-Up Sources:

> Device wakes based on trigger.
>
> Re-checks battery level.
>
> If still critical → go back to deep sleep mode.

## Health Tag Power profiling

This section provides a theoretical power consumption profile for the
device under typical operating conditions. The purpose is to estimate
average current consumption, power usage, and expected battery life
based on assumed operational parameters.

| **Component/Mode**                          | **Current (µA)** | **Active Time (s)** | **Period (s)** | **Duty Cycle (%)** | **Avg Current (µA)**       | **Avg Current (mA)**       |                           |
|---------------------------------------------|------------------|---------------------|----------------|--------------------|----------------------------|----------------------------|---------------------------|
| BLE Advertising - MCU IDLE mode             | 13.54            | 1                   | 1              | 1                  | 13.54                      | 0.01354                    |                           |
| BLE Connected Idle - MCU IDLE mode          | 207.4            | 180                 | 3600           | 0.05               | 10.37                      | 0.01037                    |                           |
| BMA400 Sensor (Normal mode) - MCU IDLE mode | 14.3             | 1                   | 1              | 1                  | 14.3                       | 0.0143                     |                           |
| Step Counter Processing - MCU normal mode   | 5000             | 0.1                 | 120            | 0.000833333        | 4.166666667                | 0.004166667                |                           |
| Battery ADC Read                            | 300              | 0.01                | 60             | 0.000166667        | 0.05                       | 0.00005                    |                           |
| Internal Flash Write                        | 6000             | 0.004               | 120            | 3.33333E-05        | 0.2                        | 0.0002                     |                           |
| Internal Flash sector erase                 | 10000            | 0.1                 | 86400          | 1.15741E-06        | 0.011574074                | 1.15741E-05                |                           |
| Internal Flash read - while sync process    | 2000             | 4                   | 3600           | 0.001111111        | 2.222222222                | 0.002222222                |                           |
| MCU IDLE mode                               | 3                | 1                   | 1              | 1                  | 3                          | 0.003                      |                           |
| NFC Passive Tag                             | 0                | 0                   | 60             | 0                  | 0                          | 0                          |                           |
|                                             |                  |                     |                |                    |                            |                            |                           |
|                                             |                  |                     |                |                    | **Total Avg Current (µA)** | **Total Avg Current (mA)** |                           |
|                                             |                  |                     |                |                    | 47.86046296                | 0.047860463                |                           |
|                                             |                  |                     |                |                    |                            |                            |                           |
|                                             |                  |                     |                |                    | **Battery life (Hours)**   | **Battery life (Days)**    | **Battery life (Months)** |
|                                             |                  |                     |                |                    | 4387.755299                | 182.8231375                | 6.094104583               |

**Note:**

Battery power management behaviour could change if step counting relies
on an algorithm with currently undefined precision.

This power profiling is based on theoretical estimates derived from
documentation provided for the Nordic Semiconductor nRF
System-in-Package (SiP). Actual power consumption may vary due to
environmental conditions, hardware tolerances, firmware behaviour, and
battery quality.
