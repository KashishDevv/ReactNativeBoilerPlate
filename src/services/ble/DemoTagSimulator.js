// DemoTag: Demo Tag Simulator - Simulates a working BLE tag for development/testing
// TODO: Remove all DemoTag code before production release

import { Buffer } from 'buffer';
import {
  BLE_SERVICES,
  BLE_CHARACTERISTICS,
  CONNECTION_STATES,
  SYSTEM_COMMAND_CONSTANTS,
  DATA_TRANSFER_TYPES,
  DEVICE_STATUS_LAYOUT,
  DATA_RECORD_LAYOUT
} from '../../constants/BLEConstants';

/**
 * DemoTag: Demo Tag Simulator Class
 * Simulates a complete BLE tag with all characteristics and behaviors
 * Works exactly like a real tag - all features are supported
 */
class DemoTagSimulator {
  constructor() {
    // DemoTag: Demo device storage
    this.demoDevices = new Map();
    this.isEnabled = false;
    
    // DemoTag: Data generators for each demo device
    this.dataGenerators = new Map();
    
    // DemoTag: Notification timers
    this.notificationTimers = new Map();
    
    // DemoTag: Connection state tracking
    this.connectionStates = new Map();
    
    // DemoTag: Historical records storage
    this.historicalRecords = new Map();
    
    // DemoTag: System command handlers
    this.commandHandlers = new Map();
    
    // DemoTag: Polling interval storage (deviceId -> intervalMs)
    this.pollingIntervals = new Map();
    
    // DemoTag: Record generation timers (deviceId -> timer)
    this.recordGenerationTimers = new Map();
    
    // DemoTag: Callback for polling interval changes (to notify BLEService)
    this.onPollingIntervalChanged = null;
    
    // DemoTag: Device settings storage (deviceId -> settings)
    this.deviceSettings = new Map();
    
    // DemoTag: Track number of records synced in last sync (deviceId -> count)
    // Used to determine which records to clear on flash clear
    this.syncedRecordCounts = new Map();
    
    // DemoTag: Default demo device configuration
    this.defaultConfig = {
      name: 'Demo Smart Tag',
      macId: 'DEMO12345678',
      firmwareVersion: '1.0.0',
      hardwareVersion: '1.0.0',
      manufacturerName: 'Demo Manufacturer',
      modelNumber: 'DEMO-TAG-001',
      serialNumber: 'DEMO-SN-001',
      initialBattery: 85, // 85% battery
      initialSteps: 0, // Start with 0 steps (will increment by 1 each time)
      initialTemperature: null, // Start with null temperature (will cycle 10-25°C)
      recordCount: 10, // 10 historical records
      rssi: -65, // Good signal strength
      dataInterval: 30000, // 30 seconds between data updates (default polling interval)
      batteryDrainRate: 0.01, // 1% per hour (very slow)
      stepIncrementRate: 0.5, // 0.5 steps per second (not used - steps increment by 1)
      temperatureVariation: 2, // ±2°C variation (not used - temperature cycles 10-25°C)
    };
  }

  /**
   * DemoTag: Enable/disable demo mode
   */
  setEnabled(enabled) {
    this.isEnabled = enabled;
    console.log(`🏷️ DemoTag: Demo mode ${enabled ? 'ENABLED' : 'DISABLED'}`);
    
    if (!enabled) {
      // DemoTag: Clean up all demo devices when disabled
      this.cleanup();
    }
  }

  /**
   * DemoTag: Check if demo mode is enabled
   */
  isDemoModeEnabled() {
    return this.isEnabled;
  }

  /**
   * DemoTag: Check if a device ID is a demo device
   */
  isDemoDevice(deviceId) {
    return this.demoDevices.has(deviceId);
  }

  /**
   * DemoTag: Create a demo device with realistic data
   */
  createDemoDevice(id, name = null, config = {}) {
    const deviceConfig = { ...this.defaultConfig, ...config };
    const deviceName = name || `${deviceConfig.name} #${this.demoDevices.size + 1}`;
    
    const now = Math.floor(Date.now() / 1000);
    
    // DemoTag: Create device object matching real BLE device structure
    const device = {
      id: id,
      name: deviceName,
      rssi: deviceConfig.rssi,
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isDemoTag: true, // DemoTag: Flag to identify demo devices
      
      // DemoTag: Device information
      manufacturerData: this.generateManufacturerData(id, deviceConfig),
      firmwareVersion: deviceConfig.firmwareVersion,
      hardwareVersion: deviceConfig.hardwareVersion,
      manufacturerName: deviceConfig.manufacturerName,
      modelNumber: deviceConfig.modelNumber,
      serialNumber: deviceConfig.serialNumber,
      
      // DemoTag: Initial device data
      deviceData: {
        batteryLevel: deviceConfig.initialBattery,
        batteryVoltage: Math.round(deviceConfig.initialBattery * 30), // Convert % to mV
        steps: deviceConfig.initialSteps,
        temperature: deviceConfig.initialTemperature,
        recordCount: deviceConfig.recordCount,
        timestamp: new Date(now * 1000),
        deviceRTC: now,
        dataSource: 'demo',
        isSmartTag: true,
      },
      
      // DemoTag: Internal state
      _demoState: {
        batteryLevel: deviceConfig.initialBattery,
        steps: deviceConfig.initialSteps,
        temperature: deviceConfig.initialTemperature,
        recordCount: deviceConfig.recordCount,
        lastUpdate: Date.now(),
        lastRecordTime: Date.now() - 30000, // Start 30s ago to allow first record soon
        batteryDrainRate: deviceConfig.batteryDrainRate,
        stepIncrementRate: deviceConfig.stepIncrementRate,
        temperatureBase: deviceConfig.initialTemperature,
        temperatureVariation: deviceConfig.temperatureVariation,
        dataInterval: deviceConfig.dataInterval,
        lastNotificationTime: 0,
        // DemoTag: Pattern tracking for clear demo data
        stepCounter: deviceConfig.initialSteps || 0, // Steps increment by 1 each time
        temperatureCycleStart: Date.now(), // Start time for temperature cycle
      }
    };
    
    // DemoTag: Generate historical records
    this.generateHistoricalRecords(id, deviceConfig.recordCount);
    
    // DemoTag: Store device
    this.demoDevices.set(id, device);
    this.connectionStates.set(id, CONNECTION_STATES.DISCONNECTED);
    
    console.log(`🏷️ DemoTag: Created demo device ${deviceName} (${id})`);
    return device;
  }

  /**
   * DemoTag: Generate manufacturer data (advertisement data)
   */
  generateManufacturerData(deviceId, config) {
    // DemoTag: Create a buffer matching real advertisement format
    // Format: [Length(1), Type(1), CompanyID(2), Version(1), FaultStatus(1), DeviceStatus(1), MAC(6), RecordCount(2)]
    const buffer = Buffer.alloc(15);
    
    buffer.writeUInt8(0x0F, 0); // Length
    buffer.writeUInt8(0xFF, 1); // Manufacturer Specific Data type
    buffer.writeUInt16BE(0x1234, 2); // Company ID
    buffer.writeUInt8(0x01, 4); // Version
    buffer.writeUInt8(0x00, 5); // Fault status (0x00 = Good)
    buffer.writeUInt8(0x03, 6); // Device status (time set + connect indication)
    
    // DemoTag: MAC ID (use device ID hash)
    const macBytes = Buffer.from(deviceId.substring(0, 12).padEnd(12, '0'), 'hex');
    for (let i = 0; i < 6; i++) {
      buffer.writeUInt8(macBytes[i] || 0, 7 + i);
    }
    
    // DemoTag: Record count
    buffer.writeUInt16LE(config.recordCount || 10, 13);
    
    return buffer.toString('base64');
  }

  /**
   * DemoTag: Generate historical records for data sync
   */
  generateHistoricalRecords(deviceId, count) {
    const records = [];
    const now = Math.floor(Date.now() / 1000);
    const device = this.demoDevices.get(deviceId);
    
    if (!device) return records;
    
    const state = device._demoState;
    
    // DemoTag: Generate records going back in time (30 seconds apart)
    // Use same fixed patterns: steps increment by 1, temperature cycles 10 → 25°C
    // This ensures historical records also show the obvious demo data pattern
    const cyclePeriod = 60; // 60 seconds for full temperature cycle
    for (let i = 0; i < count; i++) {
      const timestamp = now - (count - i - 1) * 30; // 30 seconds apart
      // Steps: count backwards from current step (decrement by 1 for each record going back)
      // Pattern: 1, 2, 3, 4, 5... (clearly fake, not from accelerometer)
      const steps = Math.max(0, (state.stepCounter || 0) - (count - i - 1));
      // Temperature: cycle from 10 → 25°C based on timestamp
      // Pattern: cycles in predictable sine wave (clearly fake, not from temperature sensor)
      const cycleTime = (timestamp * 1000 - (state.temperatureCycleStart || Date.now())) / 1000;
      const cycleProgress = ((cycleTime % cyclePeriod) + cyclePeriod) % cyclePeriod / cyclePeriod; // 0 to 1
      const temperatureCelsius = 17.5 + 7.5 * Math.sin(2 * Math.PI * cycleProgress - Math.PI / 2);
      // ✅ FIX: Temperature should be stored as raw byte value (0-255), not Celsius
      // The raw byte value IS the Celsius value (no conversion needed)
      const temperatureRaw = Math.max(0, Math.min(255, Math.round(temperatureCelsius)));
      
      records.push({
        timestamp: new Date(timestamp * 1000),
        deviceRTC: timestamp,
        steps: Math.round(steps),
        temperature: temperatureRaw, // ✅ FIX: Store as raw byte (0-255), not Celsius
        flags: 0x00,
        receivedAt: new Date(),
      });
    }
    
    this.historicalRecords.set(deviceId, records);
    return records;
  }

  /**
   * DemoTag: Get demo device
   */
  getDemoDevice(deviceId) {
    return this.demoDevices.get(deviceId);
  }

  /**
   * DemoTag: Get all demo devices
   */
  getAllDemoDevices() {
    return Array.from(this.demoDevices.values());
  }

  /**
   * DemoTag: Update device data (simulate time passing)
   */
  updateDeviceData(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return null;
    
    const state = device._demoState;
    const now = Date.now();
    const timeDelta = (now - state.lastUpdate) / 1000; // seconds
    
    // DemoTag: Update battery (slow drain)
    const batteryDrain = (timeDelta / 3600) * state.batteryDrainRate * 100; // per hour
    state.batteryLevel = Math.max(0, Math.min(100, state.batteryLevel - batteryDrain));
    
    // ✅ FIX: Steps should ONLY increment when generating a new record, not on every updateDeviceData call
    // Steps increment logic is now in generateRecordAtInterval() to ensure it only increments once per record
    // Initialize stepCounter if not set, but don't increment here
    if (state.stepCounter === undefined) {
      state.stepCounter = 0;
    }
    // Keep current step value (don't increment here - only increment in generateRecordAtInterval)
    state.steps = state.stepCounter;
    
    // DemoTag: Temperature cycles from 10 → 25°C (fixed repeating pattern - clearly demo data)
    // This simulates a fake temperature sensor that cycles in a predictable pattern
    // NOT reading actual temperature - just a repeating cycle to make it obvious this is generated data
    // Cycle period: 60 seconds (one full cycle from 10 to 25 and back to 10)
    if (state.temperatureCycleStart === undefined) {
      state.temperatureCycleStart = now;
    }
    const cycleTime = (now - state.temperatureCycleStart) / 1000; // seconds since cycle start
    const cyclePeriod = 60; // 60 seconds for full cycle
    // Handle negative cycleTime (shouldn't happen, but be safe)
    const cycleProgress = ((cycleTime % cyclePeriod) + cyclePeriod) % cyclePeriod / cyclePeriod; // 0 to 1
    // Sine wave: cycles smoothly from 10°C → 25°C → 10°C (repeating pattern)
    // Formula: 17.5 + 7.5 * sin(2π * cycleProgress - π/2)
    // This gives: 10°C at start (cycleProgress=0), 25°C at middle (cycleProgress=0.5), 10°C at end (cycleProgress=1)
    const temperatureCelsius = 17.5 + 7.5 * Math.sin(2 * Math.PI * cycleProgress - Math.PI / 2);
    // Clamp to valid byte range (0-255) - raw byte value IS the Celsius value
    state.temperature = Math.max(0, Math.min(255, Math.round(temperatureCelsius)));
    
    // ✅ NOTE: Record generation is now handled by independent timer (startRecordGenerationTimer)
    // Records are generated at the data acquisition interval, independent of when updateDeviceData is called
    // This ensures records are created at exactly the correct interval (e.g., every 40 seconds)
    
    // DemoTag: Update device data
    device.deviceData = {
      ...device.deviceData,
      batteryLevel: Math.round(state.batteryLevel),
      batteryVoltage: Math.round(state.batteryLevel * 30),
      steps: state.steps !== null && state.steps !== undefined ? Math.round(state.steps) : 0,
      // ✅ FIX: Temperature is stored as raw byte (0-255), where byte value = Celsius value
      // No conversion needed - the raw byte value IS the Celsius value
      temperature: state.temperature !== null && state.temperature !== undefined 
        ? state.temperature 
        : null,
      recordCount: state.recordCount || 0,
      timestamp: new Date(now),
      deviceRTC: Math.floor(now / 1000),
      dataSource: 'demo',
    };
    
    state.lastUpdate = now;
    
    return device.deviceData;
  }

  /**
   * DemoTag: Simulate connection
   */
  async connectDevice(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) {
      throw new Error(`DemoTag: Device ${deviceId} not found`);
    }
    
    // DemoTag: Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    this.connectionStates.set(deviceId, CONNECTION_STATES.CONNECTED);
    device.connectionState = CONNECTION_STATES.CONNECTED;
    
    // ✅ Start record generation timer at the data acquisition interval
    const dataInterval = device.deviceData?.dataInterval || device._demoState?.dataInterval || this.pollingIntervals.get(deviceId) || 30000;
    this.startRecordGenerationTimer(deviceId, dataInterval);
    
    console.log(`🏷️ DemoTag: Connected to ${device.name}`);
    return device;
  }

  /**
   * DemoTag: Simulate disconnection
   */
  async disconnectDevice(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return;
    
    // DemoTag: Stop notifications
    this.stopNotifications(deviceId);
    
    // ✅ Stop record generation timer
    this.stopRecordGenerationTimer(deviceId);
    
    this.connectionStates.set(deviceId, CONNECTION_STATES.DISCONNECTED);
    device.connectionState = CONNECTION_STATES.DISCONNECTED;
    
    console.log(`🏷️ DemoTag: Disconnected from ${device.name}`);
  }
  
  /**
   * DemoTag: Start record generation timer (generates records at data acquisition interval)
   * Simple logic: Just use setInterval with the data acquisition interval
   */
  startRecordGenerationTimer(deviceId, intervalMs) {
    // Stop existing timer if any
    this.stopRecordGenerationTimer(deviceId);
    
    const device = this.demoDevices.get(deviceId);
    if (!device) return;
    
    const intervalSeconds = intervalMs / 1000;
    console.log(`🏷️ DemoTag: Starting record generation timer for ${deviceId} at ${intervalSeconds}s interval`);
    
    const state = device._demoState;
    
    // ✅ If lastRecordTime is null (after flash clear), generate first record immediately
    // BUT: Check if a record was just generated (within last 2 seconds) to prevent double generation
    // This prevents steps from jumping when timer fires right before flash clear
    const now = Date.now();
    const timeSinceLastRecord = state.lastRecordTime ? (now - state.lastRecordTime) : Infinity;
    const recentlyGenerated = timeSinceLastRecord < 2000; // Within 2 seconds
    
    if (!state.lastRecordTime && !recentlyGenerated) {
      // Generate record immediately (after flash clear, device should have a record)
      // generateRecordAtInterval() will call updateDeviceData() internally
      this.generateRecordAtInterval(deviceId);
    }
    
    // ✅ Simple: Just use setInterval at the data acquisition interval
    // Records will be generated every intervalMs milliseconds
    const timer = setInterval(() => {
      this.generateRecordAtInterval(deviceId);
    }, intervalMs);
    
    this.recordGenerationTimers.set(deviceId, timer);
  }
  
  /**
   * DemoTag: Stop record generation timer
   */
  stopRecordGenerationTimer(deviceId) {
    // Clear interval timer if exists
    if (this.recordGenerationTimers && this.recordGenerationTimers.has(deviceId)) {
      clearInterval(this.recordGenerationTimers.get(deviceId));
      this.recordGenerationTimers.delete(deviceId);
      console.log(`🏷️ DemoTag: Stopped record generation timer for ${deviceId}`);
    }
  }
  
  /**
   * DemoTag: Generate a record at the data acquisition interval
   * Uses fixed patterns: steps increment by 1, temperature cycles 10 → 25°C
   */
  generateRecordAtInterval(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return;
    
    const state = device._demoState;
    const now = Date.now();
    
    // ✅ CRITICAL: Increment steps by 1 ONLY when generating a new record
    // This ensures steps increment by exactly 1 per record (1, 2, 3, 4, 5...)
    // NOT using accelerometer - just a simple counter to make it obvious this is generated data
    if (state.stepCounter === undefined) {
      state.stepCounter = 0;
    }
    state.stepCounter = (state.stepCounter + 1) % 1000; // Increment and cycle 0-999
    state.steps = state.stepCounter;
    
    // Update device data to get latest battery and temperature (temperature cycles continuously)
    this.updateDeviceData(deviceId);
    
    // Generate new record with current timestamp
    // ✅ FIX: Temperature should be stored as raw byte value (0-255), not Celsius
    // The raw byte value IS the Celsius value (no conversion needed)
    // Clamp temperature to valid range (0-255) for raw byte storage
    const temperatureRaw = Math.max(0, Math.min(255, Math.round(state.temperature || 0)));
    
    const newRecord = {
      timestamp: new Date(now),
      deviceRTC: Math.floor(now / 1000),
      steps: Math.round(state.steps),
      temperature: temperatureRaw, // ✅ FIX: Store as raw byte (0-255), not Celsius
      flags: 0x00,
      receivedAt: new Date(now),
    };
    
    // Add to historical records
    const records = this.historicalRecords.get(deviceId) || [];
    records.push(newRecord);
    this.historicalRecords.set(deviceId, records);
    
    // Update record count
    state.recordCount = records.length;
    state.lastRecordTime = now;
    device.deviceData.recordCount = records.length;
    
    const dataInterval = device.deviceData?.dataInterval || device._demoState?.dataInterval || this.pollingIntervals.get(deviceId) || 30000;
    const dataIntervalSeconds = dataInterval / 1000;
    
    console.log(`🏷️ DemoTag: Generated record at ${dataIntervalSeconds}s interval for ${deviceId} (recordCount: ${records.length}, timestamp: ${newRecord.deviceRTC})`);
  }

  /**
   * DemoTag: Read device status characteristic (8 bytes)
   */
  readDeviceStatus(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return null;
    
    // ✅ FIX: Only update battery level (slow drain), don't generate random steps/temperature
    // Device status read should only return recordCount, battery, and timestamp
    // Steps/temperature should ONLY come from synced records, not random generation
    // Records are generated by the independent timer, not during status reads
    const state = device._demoState;
    const now = Date.now();
    const timeDelta = (now - state.lastUpdate) / 1000; // seconds
    
    // Update battery (slow drain) - this is the only thing that should change during status read
    const batteryDrain = (timeDelta / 3600) * state.batteryDrainRate * 100; // per hour
    state.batteryLevel = Math.max(0, Math.min(100, state.batteryLevel - batteryDrain));
    device.deviceData.batteryLevel = Math.round(state.batteryLevel);
    device.deviceData.batteryVoltage = Math.round(state.batteryLevel * 30);
    device.deviceData.deviceRTC = Math.floor(now / 1000);
    device.deviceData.timestamp = new Date(now);
    state.lastUpdate = now;
    
    // DemoTag: Get current record count from historical records
    const records = this.historicalRecords.get(deviceId) || [];
    const currentRecordCount = records.length;
    
    const data = device.deviceData;
    const buffer = Buffer.alloc(8);
    
    // DemoTag: Format matches SDD v1.4 - 8 bytes
    // Bytes 0-3: Timestamp (Little Endian)
    buffer.writeUInt32LE(data.deviceRTC, DEVICE_STATUS_LAYOUT.TIMESTAMP_OFFSET);
    
    // Bytes 4-5: Record Count (Little Endian) - use actual record count
    buffer.writeUInt16LE(currentRecordCount, DEVICE_STATUS_LAYOUT.RECORD_COUNT_OFFSET);
    
    // Bytes 6-7: Battery Voltage in mV (Little Endian)
    buffer.writeUInt16LE(data.batteryVoltage, DEVICE_STATUS_LAYOUT.BATTERY_VOLTAGE_OFFSET);
    
    // DemoTag: Update device data record count
    device.deviceData.recordCount = currentRecordCount;
    if (device._demoState) {
      device._demoState.recordCount = currentRecordCount;
    }
    
    return buffer.toString('base64');
  }

  /**
   * DemoTag: Read device information characteristic
   */
  readDeviceInfo(deviceId, characteristicUuid) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return null;
    
    // DemoTag: Return appropriate device info based on characteristic
    switch (characteristicUuid) {
      case BLE_CHARACTERISTICS.MANUFACTURER_NAME:
        return Buffer.from(device.manufacturerName).toString('base64');
      case BLE_CHARACTERISTICS.MODEL_NUMBER:
        return Buffer.from(device.modelNumber).toString('base64');
      case BLE_CHARACTERISTICS.SERIAL_NUMBER:
        return Buffer.from(device.serialNumber).toString('base64');
      case BLE_CHARACTERISTICS.FIRMWARE_REVISION:
        return Buffer.from(device.firmwareVersion).toString('base64');
      case BLE_CHARACTERISTICS.HARDWARE_REVISION:
        return Buffer.from(device.hardwareVersion).toString('base64');
      default:
        return null;
    }
  }

  /**
   * DemoTag: Handle system command
   */
  async handleSystemCommand(deviceId, commandId, commandData) {
    const device = this.demoDevices.get(deviceId);
    if (!device) {
      throw new Error(`DemoTag: Device ${deviceId} not found`);
    }
    
    // DemoTag: Simulate command processing delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const responseBuffer = Buffer.alloc(20);
    
    // DemoTag: Response format: [ResponseID(1), CommandID(1), Length(1), Status(1), Data(16)]
    responseBuffer.writeUInt8(SYSTEM_COMMAND_CONSTANTS.RESPONSE_ID, 0);
    responseBuffer.writeUInt8(commandId, 1);
    
    let responseLength = 0;
    let status = SYSTEM_COMMAND_CONSTANTS.STATUS.SUCCESS;
    let responseData = Buffer.alloc(16);
    
    // DemoTag: Handle different commands
    switch (commandId) {
      case SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME:
        if (commandData && commandData.length >= 4) {
          const timestamp = commandData.readUInt32LE(0);
          device._demoState.deviceRTC = timestamp;
          device.deviceData.deviceRTC = timestamp;
          responseLength = 0;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL:
        // DemoTag: Set advertising interval (simulated)
        if (commandData && commandData.length >= 4) {
          const intervalMs = commandData.readUInt32LE(0);
          if (!this.deviceSettings.has(deviceId)) {
            this.deviceSettings.set(deviceId, {});
          }
          const settings = this.deviceSettings.get(deviceId);
          settings.advertisingInterval = intervalMs;
          console.log(`🏷️ DemoTag: Advertising interval set to ${intervalMs}ms for ${deviceId}`);
          responseLength = 0;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL:
        // DemoTag: Set connection interval (simulated)
        if (commandData && commandData.length >= 4) {
          const intervalMs = commandData.readUInt32LE(0);
          if (!this.deviceSettings.has(deviceId)) {
            this.deviceSettings.set(deviceId, {});
          }
          const settings = this.deviceSettings.get(deviceId);
          settings.connectionInterval = intervalMs;
          console.log(`🏷️ DemoTag: Connection interval set to ${intervalMs}ms for ${deviceId}`);
          responseLength = 0;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL:
        // DemoTag: Set data acquisition interval (changes polling interval)
        if (commandData && commandData.length >= 4) {
          const intervalMs = commandData.readUInt32LE(0);
          // ✅ Cap at minimum 30 seconds (prevent excessive polling)
          const minIntervalMs = 30000; // 30 seconds minimum
          const actualIntervalMs = Math.max(minIntervalMs, intervalMs);
          const intervalSeconds = actualIntervalMs / 1000;
          
          // Store the polling interval
          this.pollingIntervals.set(deviceId, actualIntervalMs);
          
          // Update device data interval
          device.deviceData.dataInterval = actualIntervalMs;
          if (device._demoState) {
            device._demoState.dataInterval = actualIntervalMs;
          }
          
          // Store in settings
          if (!this.deviceSettings.has(deviceId)) {
            this.deviceSettings.set(deviceId, {});
          }
          const settings = this.deviceSettings.get(deviceId);
          settings.dataInterval = actualIntervalMs;
          
          console.log(`🏷️ DemoTag: Data acquisition interval set to ${intervalSeconds}s (${actualIntervalMs}ms) for ${deviceId}`);
          
          // ✅ Start/restart record generation timer at the data acquisition interval
          this.startRecordGenerationTimer(deviceId, actualIntervalMs);
          
          // ✅ Notify BLEService to restart polling with new interval
          if (this.onPollingIntervalChanged) {
            console.log(`🏷️ DemoTag: Calling polling interval callback for ${deviceId} with ${intervalSeconds}s`);
            this.onPollingIntervalChanged(deviceId, intervalSeconds);
          } else {
            console.warn(`🏷️ DemoTag: Polling interval callback not set! Polling will not restart automatically.`);
          }
          
          responseLength = 0;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
        const fwVersion = Buffer.from(device.firmwareVersion);
        fwVersion.copy(responseData, 0);
        responseLength = fwVersion.length;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
        const hwVersion = Buffer.from(device.hardwareVersion);
        hwVersion.copy(responseData, 0);
        responseLength = hwVersion.length;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
        // DemoTag: Return diagnostics data (simulated)
        // Format: [Battery(1), FaultStatus(1), DeviceStatus(1), RTCValid(1), ...]
        const diagnostics = Buffer.alloc(16);
        diagnostics.writeUInt8(device.deviceData.batteryLevel || 85, 0); // Battery level
        diagnostics.writeUInt8(0x00, 1); // Fault status (0x00 = Good)
        diagnostics.writeUInt8(0x03, 2); // Device status (time set + connect indication)
        diagnostics.writeUInt8(0x01, 3); // RTC valid (0x01 = Valid)
        // Additional diagnostic data can be added here
        diagnostics.copy(responseData, 0);
        responseLength = 4; // Return 4 bytes of diagnostics
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
        // DemoTag: Prepare for data sync
        responseLength = 0;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP:
        if (commandData && commandData.length >= 1) {
          const clearFlag = commandData.readUInt8(0);
          if (clearFlag === 0x01) {
            // DemoTag: Clear flash data (simulate clearing records on device)
            // ✅ FIX: Only clear records that have been synced (preserve unsynced records)
            // This prevents records from being lost if they were generated during/after sync
            const records = this.historicalRecords.get(deviceId) || [];
            const syncedCount = this.syncedRecordCounts.get(deviceId) || 0;
            
            // Only clear records that were synced in the last sync
            // Preserve any records that were generated after sync started or during sync
            // This ensures steps increment correctly: 1, 2, 3, 4, 5... (no skipping)
            const unsyncedRecords = records.slice(syncedCount);
            this.historicalRecords.set(deviceId, unsyncedRecords);
            device.deviceData.recordCount = unsyncedRecords.length;
            
            // Clear the synced count after flash clear
            this.syncedRecordCounts.delete(deviceId);
            if (device._demoState) {
              device._demoState.recordCount = unsyncedRecords.length;
              // ✅ FIX: Preserve lastRecordTime if a record was just generated (within 2 seconds)
              // This prevents double record generation when timer fires right before flash clear
              // If no recent record, set to null so one will be generated immediately
              const now = Date.now();
              const timeSinceLastRecord = device._demoState.lastRecordTime 
                ? (now - device._demoState.lastRecordTime) 
                : Infinity;
              const recentlyGenerated = timeSinceLastRecord < 2000; // Within 2 seconds
              
              if (!recentlyGenerated) {
                // No recent record, so reset lastRecordTime to generate one immediately
                device._demoState.lastRecordTime = null;
              }
              // If recentlyGenerated is true, keep lastRecordTime so timer continues normally
              
              // ✅ IMPORTANT: Preserve steps and temperature - don't reset them
              // The device should continue showing the latest values even after flash clear
              // Steps will increment when generateRecordAtInterval() is called (not in updateDeviceData)
            }
            // ✅ Update device data immediately to ensure latest battery/temperature are preserved
            // This ensures the UI continues showing the latest values after sync
            // Note: Steps are preserved but won't increment until next record generation
            this.updateDeviceData(deviceId);
            
            // ✅ Restart record generation timer to continue generating records at the interval
            const dataInterval = device.deviceData?.dataInterval || device._demoState?.dataInterval || this.pollingIntervals.get(deviceId) || 30000;
            this.startRecordGenerationTimer(deviceId, dataInterval);
            
            console.log(`🏷️ DemoTag: Flash cleared for ${deviceId}, records reset. Steps: ${device.deviceData.steps}, Temp: ${device.deviceData.temperature}°C preserved. Record generation timer restarted.`);
          }
          responseData.writeUInt8(clearFlag, 0);
          responseLength = 1;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART:
        // DemoTag: Simulate restart
        responseLength = 0;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER:
        if (commandData && commandData.length >= 2) {
          const state = commandData.readUInt8(0);
          const beepCount = commandData.readUInt8(1);
          responseData.writeUInt8(state, 0);
          responseData.writeUInt8(beepCount, 1);
          responseLength = 2;
        }
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE:
        // DemoTag: Simulate unpair (just return success)
        responseLength = 0;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET:
        // DemoTag: Simulate factory reset (clear all data)
        this.historicalRecords.set(deviceId, []);
        device.deviceData.recordCount = 0;
        if (device._demoState) {
          device._demoState.recordCount = 0;
          device._demoState.steps = 0;
          device._demoState.stepCounter = 0; // Reset step counter
          device._demoState.temperatureBase = null;
          device._demoState.temperature = null;
          device._demoState.temperatureCycleStart = Date.now(); // Reset cycle start
        }
        // Reset to default polling interval
        this.pollingIntervals.delete(deviceId);
        responseLength = 0;
        break;
        
      case SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE:
        // DemoTag: Simulate passkey update
        if (commandData && commandData.length >= 3) {
          // Passkey is 6 digits stored in 3 bytes (2 digits per byte, BCD format)
          const passkeyBytes = commandData.slice(0, 3);
          responseData.writeUInt8(passkeyBytes[0], 0);
          responseData.writeUInt8(passkeyBytes[1], 1);
          responseData.writeUInt8(passkeyBytes[2], 2);
          responseLength = 3;
        }
        break;
        
      default:
        status = SYSTEM_COMMAND_CONSTANTS.STATUS.FAILURE;
        responseLength = 0;
    }
    
    // DemoTag: Write response
    responseBuffer.writeUInt8(responseLength, 2);
    responseBuffer.writeUInt8(status, 3);
    responseData.copy(responseBuffer, 4, 0, responseLength);
    
    return responseBuffer.toString('base64');
  }

  /**
   * DemoTag: Start data sync (returns sync start packet)
   */
  startDataSync(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return null;
    
    const records = this.historicalRecords.get(deviceId) || [];
    const recordCount = records.length;
    
    // DemoTag: Sync start packet: [Type(1), Length(1), TotalRecords(4)]
    const buffer = Buffer.alloc(6);
    buffer.writeUInt8(DATA_TRANSFER_TYPES.SYNC_START, 0);
    buffer.writeUInt8(4, 1); // Length
    buffer.writeUInt32LE(recordCount, 2);
    
    return buffer.toString('base64');
  }

  /**
   * DemoTag: Get next data record(s) for sync (doesn't remove from array - tracks sync position)
   */
  getNextDataRecords(deviceId, maxRecords = 2, syncPosition = 0) {
    const records = this.historicalRecords.get(deviceId) || [];
    if (records.length === 0 || syncPosition >= records.length) return null;
    
    // DemoTag: Return up to maxRecords starting from syncPosition
    const recordsToSend = records.slice(syncPosition, syncPosition + maxRecords);
    
    // DemoTag: Format records as data transfer packet
    // Format: [Type(1), Length(1), Record1(8), Record2(8), ...]
    const recordSize = recordsToSend.length * 8;
    const buffer = Buffer.alloc(2 + recordSize);
    
    buffer.writeUInt8(DATA_TRANSFER_TYPES.RECORD, 0);
    buffer.writeUInt8(recordSize, 1);
    
    let offset = 2;
    recordsToSend.forEach(record => {
      // DemoTag: Record format: [Timestamp(4), Steps(2), Temperature(1), Flags(1)]
      // ✅ FIX: Temperature is already stored as raw byte (0-255), no conversion needed
      buffer.writeUInt32LE(Math.floor(record.deviceRTC), offset);
      buffer.writeUInt16LE(record.steps, offset + 4);
      buffer.writeUInt8(record.temperature || 0, offset + 6); // ✅ FIX: Use raw byte value directly
      buffer.writeUInt8(record.flags || 0x00, offset + 7);
      offset += 8;
    });
    
    return buffer.toString('base64');
  }

  /**
   * DemoTag: Get sync position for device (tracks where we are in sync)
   */
  getSyncPosition(deviceId) {
    if (!this.syncPositions) {
      this.syncPositions = new Map();
    }
    return this.syncPositions.get(deviceId) || 0;
  }

  /**
   * DemoTag: Set sync position for device
   */
  setSyncPosition(deviceId, position) {
    if (!this.syncPositions) {
      this.syncPositions = new Map();
    }
    this.syncPositions.set(deviceId, position);
  }

  /**
   * DemoTag: Clear sync position (after sync complete)
   */
  clearSyncPosition(deviceId) {
    if (this.syncPositions) {
      this.syncPositions.delete(deviceId);
    }
  }

  /**
   * DemoTag: Complete data sync
   */
  completeDataSync(deviceId, recordsTransmitted) {
    // ✅ Track number of records that were synced
    // This is used to determine which records to clear on flash clear
    this.syncedRecordCounts.set(deviceId, recordsTransmitted);
    
    // DemoTag: Sync complete packet: [Type(1), Length(1), Count(2)]
    const buffer = Buffer.alloc(4);
    buffer.writeUInt8(DATA_TRANSFER_TYPES.SYNC_COMPLETE, 0);
    buffer.writeUInt8(2, 1); // Length
    buffer.writeUInt16LE(recordsTransmitted, 2);
    
    return buffer.toString('base64');
  }

  /**
   * DemoTag: Start notifications (simulate periodic device status updates)
   */
  startNotifications(deviceId, callback, interval = 30000) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return;
    
    // DemoTag: Stop existing notifications
    this.stopNotifications(deviceId);
    
    // DemoTag: Send initial notification
    this.sendNotification(deviceId, callback);
    
    // DemoTag: Set up periodic notifications
    const timer = setInterval(() => {
      this.sendNotification(deviceId, callback);
    }, interval);
    
    this.notificationTimers.set(deviceId, timer);
    console.log(`🏷️ DemoTag: Started notifications for ${device.name} (every ${interval}ms)`);
  }

  /**
   * DemoTag: Send notification
   * ✅ Match original tag: Notifications just read device status, don't update device data
   * Device data updates happen independently via record generation timer
   */
  sendNotification(deviceId, callback) {
    const device = this.demoDevices.get(deviceId);
    if (!device || !callback) return;
    
    // ✅ Match original tag: Notifications only read device status, don't update device data
    // Device data (steps/temperature) is updated by record generation timer, not notifications
    // DemoTag: Read device status (this only updates battery level, not steps/temperature)
    const statusData = this.readDeviceStatus(deviceId);
    
    if (statusData) {
      // DemoTag: Simulate notification event
      callback({
        deviceId: deviceId,
        characteristicUuid: BLE_CHARACTERISTICS.DEVICE_STATUS,
        data: statusData,
        timestamp: new Date(),
      });
    }
  }

  /**
   * DemoTag: Stop notifications
   */
  stopNotifications(deviceId) {
    const timer = this.notificationTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.notificationTimers.delete(deviceId);
      
      const device = this.demoDevices.get(deviceId);
      if (device) {
        console.log(`🏷️ DemoTag: Stopped notifications for ${device.name}`);
      }
    }
  }

  /**
   * DemoTag: Get connection state
   */
  getConnectionState(deviceId) {
    return this.connectionStates.get(deviceId) || CONNECTION_STATES.DISCONNECTED;
  }

  /**
   * DemoTag: Update RSSI (simulate signal strength variation)
   */
  updateRSSI(deviceId) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return device?._demoState?.rssi || -65;
    
    // DemoTag: Add small random variation to RSSI
    const baseRSSI = device._demoState?.rssi || -65;
    const variation = (Math.random() - 0.5) * 10; // ±5 dBm variation
    const newRSSI = Math.round(baseRSSI + variation);
    
    device.rssi = newRSSI;
    return newRSSI;
  }

  /**
   * DemoTag: Manually set device data (for testing)
   */
  setDeviceData(deviceId, data) {
    const device = this.demoDevices.get(deviceId);
    if (!device) return false;
    
    const state = device._demoState;
    
    if (data.batteryLevel !== undefined) {
      state.batteryLevel = Math.max(0, Math.min(100, data.batteryLevel));
      device.deviceData.batteryLevel = state.batteryLevel;
      device.deviceData.batteryVoltage = Math.round(state.batteryLevel * 30);
    }
    
    if (data.steps !== undefined) {
      state.steps = Math.max(0, data.steps);
      state.stepCounter = state.steps; // Update step counter to match
      device.deviceData.steps = Math.round(state.steps);
    }
    
    if (data.temperature !== undefined) {
      // ✅ FIX: Temperature is stored as raw byte (0-255), where byte value = Celsius value
      // Clamp to valid byte range
      const temperatureRaw = Math.max(0, Math.min(255, Math.round(data.temperature || 0)));
      state.temperature = temperatureRaw;
      state.temperatureBase = temperatureRaw; // Base is also raw byte value
      device.deviceData.temperature = temperatureRaw;
    }
    
    if (data.recordCount !== undefined) {
      state.recordCount = Math.max(0, data.recordCount);
      device.deviceData.recordCount = state.recordCount;
      this.generateHistoricalRecords(deviceId, state.recordCount);
    }
    
    return true;
  }

  /**
   * DemoTag: Get polling interval for device (returns data acquisition interval or default)
   * ✅ CRITICAL: Polling interval should match data acquisition interval to match real device behavior
   */
  getPollingInterval(deviceId) {
    const device = this.demoDevices.get(deviceId);
    
    // ✅ Priority order: device dataInterval > demo state dataInterval > stored polling interval > default
    // This ensures polling matches the data acquisition interval set by SET_DATA_INTERVAL command
    if (device) {
      const dataInterval = device.deviceData?.dataInterval || device._demoState?.dataInterval;
      if (dataInterval) {
        return dataInterval;
      }
    }
    
    // Fallback to stored polling interval (set by SET_DATA_INTERVAL)
    const storedInterval = this.pollingIntervals.get(deviceId);
    if (storedInterval) {
      return storedInterval;
    }
    
    // Return default 30 seconds
    return 30000;
  }
  
  /**
   * DemoTag: Set callback for polling interval changes
   */
  setPollingIntervalCallback(callback) {
    this.onPollingIntervalChanged = callback;
    console.log(`🏷️ DemoTag: Polling interval callback set`);
  }
  
  /**
   * DemoTag: Check if polling interval callback is set
   */
  hasPollingIntervalCallback() {
    return typeof this.onPollingIntervalChanged === 'function';
  }
  
  /**
   * DemoTag: Get device settings
   */
  getDeviceSettings(deviceId) {
    return this.deviceSettings.get(deviceId) || {};
  }
  
  /**
   * DemoTag: Cleanup all demo devices and timers
   */
  cleanup() {
    // DemoTag: Stop all notifications
    this.notificationTimers.forEach((timer, deviceId) => {
      clearInterval(timer);
    });
    this.notificationTimers.clear();
    
    // DemoTag: Stop all record generation timers
    if (this.recordGenerationTimers) {
      this.recordGenerationTimers.forEach((timer, deviceId) => {
        clearInterval(timer);
      });
      this.recordGenerationTimers.clear();
    }
    
    // DemoTag: Clear all data
    this.demoDevices.clear();
    this.connectionStates.clear();
    this.historicalRecords.clear();
    this.dataGenerators.clear();
    this.pollingIntervals.clear();
    this.deviceSettings.clear();
    
    console.log('🏷️ DemoTag: Cleaned up all demo devices');
  }
}

// DemoTag: Export singleton instance
export default new DemoTagSimulator();

