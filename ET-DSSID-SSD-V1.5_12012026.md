**Software Design Document**

**DyreID**

**Smart Health Tag**

**Release History:**

| **Version No.** | **Release Date** | **Prepared By** | **Approved By** | **Remarks**                  | **Reviewed By** | **Customer Approval** |
|-----------------|------------------|-----------------|-----------------|------------------------------|-----------------|-----------------------|
| 1.0             | 15/07/2025       | SA              |                 |                              | Gopal           |                       |
| 1.1             | 25/09/2025       | SA              |                 |                              |                 |                       |
| 1.2             | 23/10/2025       | SA              |                 |                              |                 |                       |
| 1.3             | 03/11/2025       | SA              |                 | Advertisement packets update |                 |                       |
| 1.4             | 10/11/2025       | SA              |                 | Data synchronize update      |                 |                       |
| 1.5             | 12/01/2026       | SA              |                 | System commands update       |                 |                       |

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

[6.1.1 Low Power Mode [9](#low-power-mode)](#low-power-mode)

[6.1.2 Normal / IDLE Mode [10](#normal-idle-mode)](#normal-idle-mode)

[6.1.3 Deep Sleep / Shutdown Mode
[11](#deep-sleep-shutdown-mode)](#deep-sleep-shutdown-mode)

[6.2 Application Module [12](#application-module)](#application-module)

[6.2.1 BLE Manager [12](#ble-manager)](#ble-manager)

[6.2.2 Sensor module [13](#sensor-module)](#sensor-module)

[6.2.3 Step Counter [14](#step-counter)](#step-counter)

[6.2.4 Battery Module [14](#battery-module)](#battery-module)

[6.3 BLE Services & Characteristics
[14](#ble-services-characteristics)](#ble-services-characteristics)

[6.3.1 GATT services in Smart Health Tag
[15](#gatt-services-in-smart-health-tag)](#gatt-services-in-smart-health-tag)

[6.3.2 Buttonless Secure DFU services
[15](#buttonless-secure-dfu-services)](#buttonless-secure-dfu-services)

[6.3.3 Smart Health Tag Data services
[16](#smart-health-tag-data-services)](#smart-health-tag-data-services)

[6.4 BLE Security [20](#ble-security)](#ble-security)

[6.5 BLE Advertising Packet Structure
[21](#ble-advertising-packet-structure)](#ble-advertising-packet-structure)

[6.6 NFC Tag configuration and security
[22](#nfc-tag-configuration-and-security)](#nfc-tag-configuration-and-security)

[6.7 RTC Manager [22](#rtc-manager)](#rtc-manager)

[6.8 Buzzer [22](#buzzer)](#buzzer)

[6.9 Flash Storage [23](#flash-storage)](#flash-storage)

[6.10 DFU Process [23](#dfu-process)](#dfu-process)

[6.11 Application Sequence Diagram
[24](#application-sequence-diagram)](#application-sequence-diagram)

[6.12 Application Lifecycle Functions
[25](#application-lifecycle-functions)](#application-lifecycle-functions)

[6.12.1 Tag Registration Process
[25](#tag-registration-process)](#tag-registration-process)

[6.12.2 Secure Connection [25](#secure-connection)](#secure-connection)

[6.12.3 Data Synchronization
[26](#data-synchronization)](#data-synchronization)

[6.12.4 Battery Alert & Deep Sleep
[26](#battery-alert-deep-sleep)](#battery-alert-deep-sleep)

[6.13 Health Tag Power profiling
[27](#health-tag-power-profiling)](#health-tag-power-profiling)

[6.13.1 Theoretical power consumption
[27](#theoretical-power-consumption)](#theoretical-power-consumption)

[6.13.2 Practical power consumption
[28](#practical-power-consumption)](#practical-power-consumption)

#  **TABLE OF TABLE** {#table-of-table .TOC-Heading2}

[Table 1 Terms and Abbreviations [4](#_Toc97612280)](#_Toc97612280)

[Table 2 BLE Manager APIs [13](#_Toc213923544)](#_Toc213923544)

[Table 3 Sensor Monitor APIs [13](#_Toc213923545)](#_Toc213923545)

[Table 4 Step Counter APIs [14](#_Toc213923546)](#_Toc213923546)

[Table 5 Battery Monitor APIs [14](#_Toc213923547)](#_Toc213923547)

[Table 6 BLE Device Info Characteristics UUID
[15](#_Toc213923548)](#_Toc213923548)

[Table 7 DFU Service Characteristics UUID
[15](#_Toc213923549)](#_Toc213923549)

[Table 8 Health Tag Data Services Characteristics UUID
[16](#_Toc213923550)](#_Toc213923550)

[Table 9 System Command List [17](#_Toc213923551)](#_Toc213923551)

[Table 10 System Command Request format
[17](#_Toc213923552)](#_Toc213923552)

[Table 11 System Command Read format
[17](#_Toc213923553)](#_Toc213923553)

[Table 12 System Command Response Format
[17](#_Toc213923554)](#_Toc213923554)

[Table 13 Device status characteristic data format
[18](#_Toc213923555)](#_Toc213923555)

[Table 14 Data Transfer characteristic data format
[18](#_Toc213923556)](#_Toc213923556)

[Table 15 Data Transfer process commands
[19](#_Toc213923557)](#_Toc213923557)

[Table 16 Record data format [19](#_Toc213923558)](#_Toc213923558)

[Table 17 BLE Advertising Packet structure
[21](#_Toc213923559)](#_Toc213923559)

[Table 18 BLE Advertising -- Manufacturers Data structure
[22](#_Toc213923560)](#_Toc213923560)

[Table 19 Internal Flash portions [23](#_Toc213923561)](#_Toc213923561)

[Table 20 Theoretical Power Calculations
[27](#_Toc213923562)](#_Toc213923562)

[Table 21 Measured Power Calculations
[28](#_Toc213923563)](#_Toc213923563)

**TABLE OF FIGURES**

[Figure 1 System Overview [5](#_Toc219222260)](#_Toc219222260)

[Figure 2 Software Modules [6](#_Toc219222261)](#_Toc219222261)

[Figure 3 Sleep Power Mod [9](#_Toc219222262)](#_Toc219222262)

[Figure 4 Idle Power Mode [10](#_Toc219222263)](#_Toc219222263)

[Figure 5 Low Power Mode [11](#_Toc219222264)](#_Toc219222264)

[Figure 6 Deep Sleep Power Mode [12](#_Toc219222265)](#_Toc219222265)

[Figure 7 BLE Data Synchronization [20](#_Toc219222266)](#_Toc219222266)

[Figure 8 Application Sequence Diagram
[25](#_Toc219222267)](#_Toc219222267)

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

[]{#_Toc213923544 .anchor}Table 2 BLE Manager APIs

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

[]{#_Toc219222260 .anchor}Figure 1 System Overview

# SOFTWARE DESIGN

This section details the overall software architecture of the Smart
Health Tag, including its layered design, module decomposition, and
interaction with hardware and external systems. It defines functional
blocks such as sensor management, data processing, BLE communication,
power management, and firmware update mechanisms.

## OS

- RTOS Used: Zephyr OS.

- Features: Work queues, low power states, and real-time scheduling.

- Device Modes Management: Power states (Idle, Low Power, Deep Sleep)
  managed through Zephyr power management APIs.

- A bare-metal approach is chosen for power management if necessary,
  meaning the system operates without an operating system.

## Base Software Modules

The section describes the design of the system specifically for software
modules.

> []{#_Toc219222261 .anchor}Figure 2 Software Modules

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

- Set desired output data rate (ODR): usually 12.5Hz.

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

- Secure pairing (**Passkey**).

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
  tapped by a phone (Not included in the design).

- Device Identification: Shares static info like device name, serial, or
  URL (NDEF records).

- Wake-Up Trigger: NFC field detection can be used to wake the device
  from deep sleep (Not included in the design).

Security & Access Control:

- NFC writes can be restricted by software:

> Read-only mode (Not included in the design).
>
> Write only if encrypted/authenticated (Not included in the design).

## GPIO

It is a configurable digital pin used to either read input signals (like
buttons or sensors) or control output devices (like LEDs or relays)

# APPLICATION DESIGN

This section provides a detailed explanation of the technical
architecture that will be used to build the application, outlining how
various software components, services, and communication interfaces are
organized and interact with each other to fulfil the defined functional
requirements.

## Application Power Modes

### Low Power Mode

- Most peripherals and CPU are suspended.

- BLE remains active to maintain or allow new connections, with high
  advertising intervals to save power.

- Used when waiting for commands or reconnection but no immediate
  activity.

- Device Firmware Upgrade (DFU) can also takes place in this mode.

> []{#_Toc219222262 .anchor}Figure 3 Sleep Power Mod

### Normal / IDLE Mode {#normal-idle-mode}

- All system peripherals (BLE, sensors, ADC, PWM, etc.) are active.

- BLE runs with high advertising and connection intervals, enabling
  quick interaction.

- Data exchange like step count and temperature between device and
  mobile app takes place.

- Device Firmware Upgrade (DFU) can also takes place in this mode.

> []{#_Toc219222263 .anchor}Figure 4 Idle Power Mode

- Sensor readings are performed periodically.

- BLE uses a moderate advertising interval to balance power and
  responsiveness.

> []{#_Toc219222264 .anchor}Figure 5 Low Power Mode

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

> []{#_Toc219222265 .anchor}Figure 6 Deep Sleep Power Mode

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

[]{#_Toc213923545 .anchor}Table 3 Sensor Monitor APIs

### Sensor module

Read the accelerometer reading from the BMA400 along with the
temperature.

<table>
<caption><p><span id="_Toc213923546" class="anchor"></span>Table 4 Step
Counter APIs</p></caption>
<colgroup>
<col style="width: 48%" />
<col style="width: 51%" />
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

[]{#_Toc213923546 .anchor}Table 4 Step Counter APIs

### Step Counter

Perform the algorithm to find step count based on the read accelerometer
axes values.

<table>
<caption><p><span id="_Toc213923547" class="anchor"></span>Table 5
Battery Monitor APIs</p></caption>
<colgroup>
<col style="width: 46%" />
<col style="width: 53%" />
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

[]{#_Toc213923547 .anchor}Table 5 Battery Monitor APIs

### Battery Module

Read the battery voltage using the ADC.

<table>
<caption><p><span id="_Toc213923548" class="anchor"></span>Table 6 BLE
Device Info Characteristics UUID</p></caption>
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

[]{#_Toc213923548 .anchor}Table 6 BLE Device Info Characteristics UUID

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

[]{#_Toc213923549 .anchor}Table 7 DFU Service Characteristics UUID

### Buttonless Secure DFU services

> Smart health tag has [Buttonless Secure DFU Service.]{.underline} It
> is a proprietary BLE service that enables entering DFU mode from a BLE
> application during a Secure Device Firmware Update.
>
> The Buttonless Secure DFU Service uses the Nordic-proprietary 16-bit
> UUID for Secure DFU (0xFE59)

<table>
<caption><p><span id="_Toc213923550" class="anchor"></span>Table 8
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

[]{#_Toc213923550 .anchor}Table 8 Health Tag Data Services
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
<caption><p><span id="_Toc213923551" class="anchor"></span>Table 9
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

[]{#_Toc213923551 .anchor}Table 9 System Command List

#### System Command Characteristic

[**UUID:** 0x4F4E4D4C4B4A49484746444443424140]{.mark}

> **Permissions (CCC)**: WRITE, READ, NOTIFICATION
>
> **Command List**

<table>
<caption><p><span id="_Toc213923552" class="anchor"></span>Table 10
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
<td>Data interval (in milliseconds)</td>
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
<td>2</td>
<td>Number of records</td>
</tr>
<tr class="odd">
<td>Data Sync Stop Request</td>
<td>0x09</td>
<td>2</td>
<td>Number of records</td>
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
<td>2</td>
<td><p>0x00, 0xFF – Activate buzzer, Beep count (max 4 minutes when
count is not provided)</p>
<p>0x01, 0x00 – Deactivate buzzer</p></td>
</tr>
<tr class="even">
<td>Unpair BLE device</td>
<td>0x12</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="odd">
<td>Factory Reset</td>
<td>0x13</td>
<td>1</td>
<td>No Data (0x00)</td>
</tr>
<tr class="even">
<td>Passkey Update</td>
<td>0x14</td>
<td>3</td>
<td>6 digits Passkey in numeric (0 to 9)</td>
</tr>
</tbody>
</table>

[]{#_Toc213923552 .anchor}Table 10 System Command Request format

**Write Command Format:** Trigger write command

**Size:** 20 bytes

**Format:** 1 byte Request Id, 1 byte command id, 1 byte command length
and up-to 17 bytes for data. All data will be in 'Little Endian Format'

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2)** | **Byte Offset (3 -- 19)** |
|---------------------|---------------------|---------------------|---------------------------|
| Request ID - 0xAA   | Command ID          | Command length      | Command Data              |

[]{#_Toc213923553 .anchor}Table 11 System Command Read format

**Read Command Format:** Read the last initiated write command

**Size:** 20 bytes

**Format:** 1 byte Request Id, 1 byte command id, 1 byte command length
and up-to 17 bytes for data. All data will be in 'Little Endian Format'

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2)** | **Byte Offset (3 -- 19)** |
|---------------------|---------------------|---------------------|---------------------------|
| Request ID - 0xAA   | Command ID          | Command length      | Command Data              |

[]{#_Toc213923554 .anchor}Table 12 System Command Response Format

**Notification Command Format**

**Size** **:** 20 bytes

**Format:** 1 byte Request Id, 1 byte command id, 1 byte response
length, 1 byte response status and up-to 16 bytes for data. All data
will be in 'Little Endian Format'

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2)** | **Byte Offset (3)** | **Byte Offset (4 -- 19)** |
|---------------------|---------------------|---------------------|---------------------|---------------------------|
| Response ID 0xBB    | Command ID          | Response length     | Response status     | Response Data             |

[]{#_Toc213923555 .anchor}Table 13 Device status characteristic data
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

[**UUID:** 0x5F5E5D5C5B5A59585756555453525150]{.mark}

**Permissions (CCC)**: READ, NOTIFICATION

**Response Command Format**

**Size:** 8 bytes

**Format:** 8 byte for data. All data will be in 'Little Endian format'.

| **Byte Offset (0 - 3)** | **Byte Offset (4- 5)**  | **Byte Offset (6-7)**      |
|-------------------------|-------------------------|----------------------------|
| Timestamp               | Available Records count | Battery Value in milliVolt |

[]{#_Toc213923556 .anchor}Table 14 Data Transfer characteristic data
format

#### Data Transfer Characteristic

[**UUID:** 0x6F6E6D6C6B6A69686766656463626160]{.mark}

**Permissions (CCC)**: READ, NOTIFICATION

| **Byte Offset (0)** | **Byte Offset (1)** | **Byte Offset (2- 19)** |
|---------------------|---------------------|-------------------------|
| Data Type           | Length              | Record data             |

[]{#_Toc213923557 .anchor}Table 15 Data Transfer process commands

**Data Type Table:**

| **Name**           | **ID** | **Length** | **Data**                                                                                       |
|--------------------|--------|------------|------------------------------------------------------------------------------------------------|
| Data Sync Start    | 0x01   | 4          | Total Record info                                                                              |
| Data Sync Complete | 0x02   | 2          | Number of records transmitted (0X0001 to 0x01F4)                                               |
| Record Data        | 0x03   | 6 - 18     | Record data. 1 set of records contains 8 bytes including Timestamp, Temperature and Step data. |
| Data Read Error    | 0x04   | 1          | No Data (0x00) - Application terminates the sync process.                                      |

[]{#_Toc213923558 .anchor}Table 16 Record data format

**Record Data:** **Size:** 20 bytes

**Format:** 20 bytes for data all data will be in 'Little Endian format'

| **Byte Offset (0 - 3)** | **Byte Offset (4- 5)** | **Byte Offset (6)** | **Byte Offset (7)** | **Byte Offset (8 -- 19)** |
|-------------------------|------------------------|---------------------|---------------------|---------------------------|
| Timestamp               | Steps counter data     | Temperature         | Device status flag  | Reserved - 0x00           |

[]{#_Toc213923559 .anchor}Table 17 BLE Advertising Packet structure

The generated record will be notified to the central device via the data
transfer characteristic at each data acquisition interval and will also
be stored locally.

The record count can be configured up to a maximum of 25,000.  
Each file contains 500 records; therefore, the Data Sync Start and Stop
commands must be triggered for every 500th record.

For instance, if the total record count is 1,500, the Start and Stop
commands should be executed three times to ensure each file is fully
processed (read and deleted) correctly.

If the record count is less than 500, a single pair of Start and Stop
commands is sufficient to complete the operation.

> []{#_Toc219222266
> .anchor}![](media/image8.png){width="6.697916666666667in"
> height="6.354166666666667in"}Figure 7 BLE Data Synchronization

## BLE Security

Pairing: Establishes a secure link between two BLE devices using methods
like Passkey Entry.

Bonding: Stores keys for future trusted reconnections without
re-pairing.

Ensures only trusted (bonded) devices can access sensitive services
(e.g., DFU or configuration).

## BLE Advertising Packet Structure

Device-specific UUID to be embed in advertisement packet or GATT
characteristic.

BLE Advertising Configuration

- Shortened name or manufacturer-specific data to be included.

- UUID, Battery level and data indication to be included in manufacturer
  data.

<table>
<caption><p><span id="_Toc213923560" class="anchor"></span>Table 18 BLE
Advertising – Manufacturers Data structure</p></caption>
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
<td>44 79 72 65 49 44</td>
<td>8</td>
<td>Local Name = “DyreID”</td>
</tr>
<tr class="odd">
<td>0F FF 34 12 01 00 01 98 4F 48 3A 1A ED F4 01</td>
<td>15</td>
<td><table>
<caption><p><span id="_Toc213923561" class="anchor"></span>Table 19
Internal Flash portions</p></caption>
<colgroup>
<col style="width: 2%" />
<col style="width: 97%" />
</colgroup>
<thead>
<tr class="header">
<th></th>
<th>Manufacturer Specific Data</th>
</tr>
</thead>
<tbody>
</tbody>
</table></td>
</tr>
</tbody>
</table>

[]{#_Toc213923560 .anchor}Table 18 BLE Advertising -- Manufacturers Data
structure

**Manufacturer Specific Data**

<table>
<caption><p><span id="_Toc213923562" class="anchor"></span>Table 20
Theoretical Power Calculations</p></caption>
<colgroup>
<col style="width: 26%" />
<col style="width: 19%" />
<col style="width: 53%" />
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
<td>0F</td>
<td>1</td>
<td>Length of this field</td>
</tr>
<tr class="even">
<td>FF</td>
<td>1</td>
<td>Type: Manufacturer Specific Data</td>
</tr>
<tr class="odd">
<td>34 12</td>
<td>2</td>
<td>Company ID</td>
</tr>
<tr class="even">
<td>01</td>
<td>1</td>
<td>Version</td>
</tr>
<tr class="odd">
<td>00</td>
<td>1</td>
<td><p>Device fault status (0 – Good, other than 0-encountered with
problem)</p>
<p>0x01 - Watchdog timer failure</p>
<p>0x02 - RTC failure</p>
<p>0x04 - ADC failure</p>
<p>0x08 - PWM failure</p>
<p>0x10 - Flash failure</p>
<p>0x20 - BLE failure</p>
<p>0x40 - Accelerometer failure</p></td>
</tr>
<tr class="even">
<td>01</td>
<td>1</td>
<td><p>Device status</p>
<p>bit 0 Connect Indication(1 = connect, 0 = no need to connect)</p>
<p>bit 1 Time set(1 = time configured, 0 = not set)</p>
<p>bit 2 Factory defaults(1 = using defaults, 0 = customized)</p>
<p>bit 3–7 (unused) can be reserved for future use</p></td>
</tr>
<tr class="odd">
<td>20 00</td>
<td>2</td>
<td><p>Device restart reason</p>
<p>0x1 - External pin reset</p>
<p>0x2 - Software-initiated reset</p>
<p>0x4 - Brownout reset (voltage drop condition)</p>
<p>0x8 - Power-on reset (POR)</p>
<p>0x10 - Watchdog timer expiration reset</p>
<p>0x20 - Debug event–triggered reset</p>
<p>0x40 - Security violation–triggered reset</p>
<p>0x80 - Low-power wakeup mode</p>
<p>0x100 - CPU lock-up detection reset</p>
<p>0x200 - Parity error–triggered reset</p>
<p>0x400 - PLL fault reset</p>
<p>0x800 - Clock failure reset</p>
<p>0x1000 - Hardware-initiated reset</p>
<p>0x2000 - User-initiated reset</p>
<p>0x4000 - Temperature threshold violation reset</p></td>
</tr>
<tr class="even">
<td>98 4F 48 3A 1A ED</td>
<td>6</td>
<td>MAC ID</td>
</tr>
<tr class="odd">
<td>F4 01</td>
<td>2</td>
<td>Number of records available</td>
</tr>
</tbody>
</table>

[]{#_Toc213923562 .anchor}Table 20 Theoretical Power Calculations

## NFC Tag configuration and security

- Data Transmission via Characteristics

  - The DyreID activation URL is written to the NFC tag during the
    production stage.

- NFC Data Handling

<!-- -->

- The NFC data can later be modified via DyreID Mobile App.

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

## Buzzer

- PWM Initialization

  - Enable and configure the dual pmw channel.

- BLE synchronization

  - Synchronize buzzer sound through BLE connection.

- Time period

  - Default pwm frequency is set to 5 kHz.

  - The buzzer toggles ON for 500 ms and OFF for the next 500 ms,
    repeating this cycle until the configured beep count (set via BLE)
    is reached.

  - If the beep count is not configured, the buzzer operates for a
    default of 240 cycles (approximately 4 minutes).

## Flash Storage

Internal flash storage of 1.5 MB is portioned into the following;

<table>
<colgroup>
<col style="width: 28%" />
<col style="width: 12%" />
<col style="width: 59%" />
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
<td>54+1168 KB</td>
<td><p>Contains bootloader, application.</p>
<p>Must fit within 1222 KB for reliable OTA/DFU updates.</p></td>
</tr>
<tr class="even">
<td>Device Info / Config</td>
<td>4 KB</td>
<td>Stores persistent data:<br />
  • Unique ID / Serial Number<br />
  • Pairing/Bonding info<br />
  • Configuration settings</td>
</tr>
<tr class="odd">
<td>Data Logging Area</td>
<td>200 KB</td>
<td>Used for logging:<br />
  • Step count<br />
  • Temperature data<br />
  • Timestamps</td>
</tr>
</tbody>
</table>

The system allocates 200 KB of flash memory for data storage. Data is
organized in 4 KB sectors, with each sector functioning as a separate
file---resulting in a total of 50 files.

Each record occupies 8 bytes, consisting of the following fields:

- Timestamp: 4 bytes

- Step Count: 2 bytes

- Temperature: 1 byte

- Status (reserved for future use): 1 byte

<!-- -->

- Each 4 KB file can therefore hold 500 records.

- Data is temporarily buffered in RAM until a full 4 KB block is
  accumulated, at which point it is written to flash. Flash writes occur
  per file, not per individual record, to minimize write cycles and
  improve endurance.

- If the device undergoes a reboot, DFU (Device Firmware Update), or
  power loss (e.g., battery removal), any unsaved data in RAM will be
  lost. However, all previously written files stored in flash will
  remain intact.

- With a step count polling interval of 2 minutes, the system performs
  one flash write operation per day. Consequently, approximately three
  files are created over a two-day period.

## DFU Process

- App-Initiated DFU Trigger

  - After a secure connection is established, the mobile app sends a
    secure write (often to a characteristic like DFU Control Point)
    indicating a DFU start request.

The firmware validates that: The request comes from a bonded/authorized
device.

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

> []{#_Toc219222267 .anchor}Figure 8 Application Sequence Diagram

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

- 

###  Secure Connection {#secure-connection}

- The tag continuous to advertise BLE packets at -8dBm for 4 seconds
  interval, when tag is in factory default mode (In active device).

- The tag continuous to advertise BLE packets at +4dBm for 2 seconds
  interval, when the tag has a paired history (Activated device).

- During BLE connection, connection interval is set to 320ms, connection
  latency to 2 and connection timeout to 500 seconds.

- The tag advertises itself over Bluetooth LE

> Broadcasts a unique MACID.

Includes Service UUID (custom UUID for pet data).

- The DyreID mobile app scans for nearby BLE devices.

- It filters devices based on:

MAC ID (6 bytes or 12 characters).

- User selects their tag to pair.

- DyreID app initiates BLE Secure Connection using: 6 digits default
  numeric Passkey **(12345)** pairing method.

- Passkey can be modified using BLE commands.

- The system can store up to five paired BLE devices, but only one can
  be connected concurrently.

- A passkey change by any paired device will remove current paired
  device bonding information and keeps other device bonding information
  without deleting it.

- After successful pairing with DyreID mobile app, Tag switches to
  normal/idle power mode.

###  Data Synchronization {#data-synchronization}

- Once connected and paired securely, the DyreID app performs GATT
  Service Discovery.

- DyreID app reads or subscribes to the Step Count Characteristic
  (custom).

- Tag sends current step count data: Can be polled (READ) or streamed
  (NOTIFY).

###  Battery Alert & Deep Sleep {#battery-alert-deep-sleep}

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

### Theoretical power consumption

This section provides a theoretical power consumption profile for the
device under typical operating conditions. The purpose is to estimate
average current consumption, power usage, and expected battery life
based on assumed operational parameters.

| **Component/Mode**                          | **Current (µA)** | **Active Time (s)** | **Period (s)** | **Duty Cycle (%)** | **Avg Current (µA)**       | **Avg Current (mA)**       |                           |
|---------------------------------------------|------------------|---------------------|----------------|--------------------|----------------------------|----------------------------|---------------------------|
| BLE Advertising - MCU IDLE mode             | 13.54            | 1                   | 1              | 1                  | 13.54                      | 0.01354                    |                           |
| BLE Connected Idle - MCU IDLE mode          | 20.74            | 180                 | 3600           | 0.05               | 10.37                      | 0.01037                    |                           |
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

### Practical power consumption

This section provides a practical power consumption profile for the
device (nRf54L15_DK board).

| **Component/Mode**                          | **Current (µA)** | **Active Time (s)** | **Period (s)** | **Duty Cycle (%)** | **Avg Current (µA)** | **Avg Current (mA)** |
|---------------------------------------------|------------------|---------------------|----------------|--------------------|----------------------|----------------------|
| BLE Advertising - MCU IDLE mode             | 20               | 1                   | 2              | 0.5                | 10                   | 0.01                 |
| BLE Connected Idle - MCU IDLE mode          | 20               | 1200                | 3600           | 0.333333333        | 6.666666667          | 0.006666667          |
| BMA400 Sensor (Normal mode) - MCU IDLE mode | 14               | 1                   | 1              | 1                  | 14                   | 0.014                |
| Step Counter Processing - MCU normal mode   | 5                | 0.1                 | 120            | 0.000833333        | 0.004166667          | 4.16667E-06          |
| Battery ADC Read                            | 1                | 0.01                | 43200          | 2.31481E-07        | 2.31481E-07          | 2.31481E-10          |
| Internal Flash Write                        | 100              | 0.004               | 50400          | 7.93651E-08        | 7.93651E-06          | 7.93651E-09          |
| Internal Flash sector erase                 | 30               | 0.1                 | 86400          | 1.15741E-06        | 3.47222E-05          | 3.47222E-08          |
| Internal Flash read                         | 30               | 4                   | 3600           | 0.001111111        | 0.033333333          | 3.33333E-05          |
| MCU IDLE mode                               | 6                | 1                   | 1              | 1                  | 6                    | 0.006                |
| BLE Connected - 1 File read process         | 1000             | 2                   | 43200          | 4.62963E-05        | 0.046296296          | 4.62963E-05          |
| Buzzer                                      | 600              | 120                 | 86400          | 0.001388889        | 0.833333333          | 0.000833333          |
| DFU                                         | 4000             | 30                  | 2592000        | 1.15741E-05        | 0.046296296          | 4.62963E-05          |
| BLE Advertising - MCU IDLE mode             | 20               | 1                   | 2              | 0.5                | 10                   | 0.01                 |

| **Total Avg Current (µA)** | **Total Avg Current (mA)** |                           |
|----------------------------|----------------------------|---------------------------|
| 37.63013548                | 0.037630135                |                           |
|                            |                            |                           |
| **Battery life (Hours)**   | **Battery life (Days)**    | **Battery life (Months)** |
| 5580.633641                | 232.5264017                | 7.750880057               |

[]{#_Toc213923563 .anchor}Table 21 Measured Power Calculations
