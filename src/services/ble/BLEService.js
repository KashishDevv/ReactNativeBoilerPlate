import { BleManager } from 'react-native-ble-plx';
import { NativeModules, DeviceEventEmitter, NativeEventEmitter } from 'react-native';
import {
  BLE_SERVICES,
  BLE_CHARACTERISTICS,
  BLE_STATES,
  CONNECTION_STATES,
  SCAN_STATES,
  SCAN_CONFIG,
  SYSTEM_COMMAND_CONSTANTS,
  DATA_TRANSFER_TYPES,
  DEVICE_STATUS_LAYOUT,
  POWER_PROFILE
} from '../../constants/BLEConstants';
import BLEDataParser from '../../utils/BLEDataParser';
import BLEPermissions from '../../utils/BLEPermissions';
import AutoConnectService from '../AutoConnectService';
import { postPetHealthBLEData, getPetHealthBLEDetails } from '../../utils/apiConfig';
import { Alert, Platform, PermissionsAndroid, AppState } from 'react-native';
import DeviceInfo from 'react-native-device-info';

// Import native modules
const { SampleBridgeAndroid, BridgingCodeModule } = NativeModules;

class BLEService {
  constructor() {
    // Custom event emitter implementation for React Native
    this.events = {};
    
    // Initialize platform-specific BLE managers
    if (Platform.OS === 'ios') {
      // Initialize BleManager with iOS state restoration so the app can be
      // relaunched/restored in background and we can reattach monitors.
      const bleManagerOptions = {
        restoreStateIdentifier: 'com.reactnativeboilerplate.bleplx.manager.v1',
        restoreStateFunction: (restoredState) => {
          try {
            this.handleRestoredState(restoredState);
          } catch (e) {
            console.warn('⚠️ restoreStateFunction error:', e?.message || e);
          }
        }
      };
      this.manager = new BleManager(bleManagerOptions);
    } else {
      // Android uses native bridge - no BLE PLX manager needed
      this.manager = null;
      this.setupAndroidEventListeners();
    }
    // Minimal GATT operation queue to serialize BLE ops
    this.operationQueue = Promise.resolve();
    this.connectedDevices = new Map();
    this.scannedDevices = new Map();
    this.scanState = SCAN_STATES.IDLE;
    this.bleState = BLE_STATES.UNKNOWN;
    this.scanSubscription = null;
    this.monitoringSubscriptions = new Map();
    this.onDeviceDataUpdated = null; // Callback for device data updates
    this.onDeviceListUpdated = null; // Callback for device list updates (for UI refresh)
    this.pendingAutoConnectDevice = null; // Store auto-connect events when UI isn't ready
    this.manualDisconnectCooldown = new Map(); // Track manual disconnections to prevent immediate auto-reconnect
    this.connectionHealthTimer = null; // Timer for periodic connection health checks
    this.disconnectSubscriptions = new Map(); // Subscriptions for BLE-PLX disconnection events
    this.profile = POWER_PROFILE?.default || { healthCheckMs: 10000, healthRssiEveryNTicks: 3, scanMode: 'LowLatency', rssiCycleIntervalMs: 30000, rssiCycleDurationMs: 3000, pruneIntervalMs: 300000, pruneAgeMs: 600000 };
    this.healthTick = 0;
    this.pruneTimer = null;
    this.debouncedListUpdate = null;
    this.knownDeviceIds = new Set();

    // RSSI Cycle Management
    this.rssiCycleTimer = null;
    this.rssiCycleActive = false;
    this.rssiValues = new Map(); // Store RSSI values for each device
    this.rssiHistory = new Map(); // Store RSSI history for trend analysis
    this.lastRssiUpdate = new Map(); // Track last RSSI update for each device


    
    // Phone Battery Management
    this.phoneBatteryLevel = null;

          // Adaptive API calling properties
      this.adaptiveApiTimers = new Map(); // Timers for adaptive API calls
      this.screenActiveStates = new Map(); // Track which screens are active for which devices
      this.appState = 'active'; // Current app state (active, background, inactive)
      this.isUpdatingAppState = false; // Flag to prevent recursive app state updates
      this.adaptiveApiCooldowns = new Map(); // Cooldown timers to prevent rapid restarts
    
    // Adaptive API calling configuration (will be updated based on power profile)
    this.adaptiveApiConfig = {
      ACTIVE_SCREEN_INTERVAL: 15000,    // 15 seconds when user is actively viewing
      BACKGROUND_INTERVAL: 60000,       // 1 minute when app is in background
      INACTIVE_SCREEN_INTERVAL: 60000,  // 1 minute when screen is not active
      MIN_INTERVAL: 10000,              // Minimum interval (10 seconds)
      MAX_INTERVAL: 300000              // Maximum interval (5 minutes)
    };

      // GET API calling properties
      this.getApiTimers = new Map();
      this.getApiConfig = {
        ACTIVE_SCREEN_INTERVAL: 15000,    // 15 seconds for active screen (graph updates)
        BACKGROUND_INTERVAL: 0,           // No calls when in background
        INACTIVE_SCREEN_INTERVAL: 0       // No calls when screen not active
      };

    this.init();

    // Setup auto-connect callbacks after initialization
    this.setupAutoConnectCallbacks();

    // Auto-scan for bonded devices on startup (iOS only)
    this.checkAndStartAutoScan();
  }

  /**
   * Setup Android event listeners for native bridge events
   */
  setupAndroidEventListeners() {
    if (Platform.OS !== 'android') return;

    console.log('🤖 Setting up Android BLE event listeners');

    // Listen for device discovery events
    DeviceEventEmitter.addListener('DeviceFound', (deviceInfo) => {
      console.log('📱 Android: Device found event received:', deviceInfo);
      this.handleAndroidDeviceFound(deviceInfo);
    });

    // Listen for connection state changes
    DeviceEventEmitter.addListener('ConnectionStateChanged', (event) => {
      console.log('📱 Android: Connection state changed:', event);
      this.handleAndroidConnectionStateChange(event);
    });

    // Listen for characteristic data updates
    DeviceEventEmitter.addListener('CharacteristicDataReceived', (event) => {
      console.log('📱 Android: Characteristic data received:', event);
      this.handleAndroidCharacteristicData(event);
    });

    // Listen for device data updates (steps, temperature, etc.)
    DeviceEventEmitter.addListener('DeviceDataUpdated', (event) => {
      console.log('📱 Android: Device data updated:', event);
      this.handleAndroidDeviceDataUpdated(event);
    });

    // Listen for health data API requests from native side
    DeviceEventEmitter.addListener('HealthDataApiRequest', (eventData) => {
      console.log('📱 Android: Received health data API request from native side:', eventData);
      this.handleNativeHealthDataApiRequest(eventData);
    });

    // Listen for services discovered
    DeviceEventEmitter.addListener('ServicesDiscovered', (event) => {
      console.log('📱 Android: Services discovered:', event);
      this.handleAndroidServicesDiscovered(event);
    });

    // Listen for RSSI updates
    DeviceEventEmitter.addListener('RSSIUpdated', (event) => {
      console.log('📱 Android: RSSI updated:', event);
      this.handleAndroidRSSIUpdate(event);
    });

    // Listen for scan state changes
    DeviceEventEmitter.addListener('ScanStateChanged', (event) => {
      console.log('📱 Android: Scan state changed:', event);
      this.handleAndroidScanStateChange(event);
    });

    // Listen for device disconnection events
    DeviceEventEmitter.addListener('DeviceDisconnected', (event) => {
      console.log('📱 Android: Device disconnected event received:', event);
      this.handleAndroidDeviceDisconnected(event);
    });

    // Listen for device reconnection events
    DeviceEventEmitter.addListener('DeviceReconnected', (event) => {
      console.log('📱 Android: Device reconnected event received:', event);
      this.handleAndroidDeviceReconnected(event);
    });

    // Listen for device connection events
    DeviceEventEmitter.addListener('DeviceConnected', (event) => {
      console.log('📱 Android: Device connected event received:', event);
      this.handleAndroidDeviceConnected(event);
    });
  }

  init() {
    if (Platform.OS === 'ios') {
      // Listen to BLE state changes (iOS only)
      this.manager.onStateChange((state) => {
        this.bleState = state;
        console.log('BLE State changed to:', state);

        if (state === BLE_STATES.POWERED_ON) {
          this.requestPermissions();
        } else if (state === BLE_STATES.POWERED_OFF) {
          this.stopScanning();
          this.disconnectAllDevices();
        }
      }, true);
    } else {
      // Android: Initialize BLE state and request permissions
      this.requestPermissions().then(() => {
        // Check actual BLE state after permissions
        this.isBLEReady().then(ready => {
          this.bleState = ready ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
          console.log('🤖 Android BLE state initialized:', this.bleState);
        });
      });
    }

    // App state handling: pause JS polling in background and adjust adaptive API calling
    this.appState = AppState.currentState;
    this.appStateSub = AppState.addEventListener('change', (state) => {
      this.updateAppState(state);
      if (state !== 'active') {
        this.stopConnectionHealthCheck();
      } else if (this.connectedDevices.size > 0) {
        this.startConnectionHealthCheck();
      }
    });

    // Start phone battery monitoring
    this.startPhoneBatteryMonitoring();

    // Start pruning
    this.startPruning();
  }

  /**
   * Android event handlers
   */
  handleAndroidDeviceFound(deviceInfo) {
    console.log('📱 Android: Processing device found:', deviceInfo);
    
    const device = {
      id: deviceInfo.deviceId,
      name: deviceInfo.deviceName || 'Unknown Device',
      rssi: deviceInfo.rssi || -100,
      isConnectable: deviceInfo.isConnectable !== false,
      deviceData: {
        batteryLevel: null,
        temperature: null,
        steps: null,
        lastUpdate: new Date()
      },
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isSmartTag: this.isSmartTag(deviceInfo)
    };

    console.log('📱 Android: Created device object:', device);
    this.scannedDevices.set(device.id, device);
    console.log('📱 Android: Added to scannedDevices. Total devices:', this.scannedDevices.size);
    
    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      console.log('📱 Android: Triggering device list update callback');
      this.onDeviceListUpdated();
    } else {
      console.log('📱 Android: No device list update callback registered');
    }
  }

  handleAndroidConnectionStateChange(event) {
    const { deviceId, connectionState } = event;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.connectionState = connectionState;
      
      if (connectionState === CONNECTION_STATES.CONNECTED) {
        this.connectedDevices.set(deviceId, device);
      } else {
        this.connectedDevices.delete(deviceId);
      }
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
    }
  }

  handleAndroidCharacteristicData(event) {
    const { deviceId, characteristicUuid, data } = event;
    
    // Handle different characteristic types
    if (characteristicUuid === BLE_CHARACTERISTICS.DEVICE_STATUS) {
      this.handleDeviceStatusUpdate(deviceId, data);
    } else if (characteristicUuid === BLE_CHARACTERISTICS.BATTERY_LEVEL) {
      this.handleBatteryUpdate(deviceId, data);
    }
  }

  handleAndroidRSSIUpdate(event) {
    const { deviceId, rssi } = event;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.rssi = rssi;
      this.rssiValues.set(deviceId, rssi);
      this.lastRssiUpdate.set(deviceId, Date.now());
    }
  }

  handleAndroidScanStateChange(event) {
    const { isScanning } = event;
    this.scanState = isScanning ? SCAN_STATES.SCANNING : SCAN_STATES.IDLE;
  }

  handleAndroidDeviceDisconnected(event) {
    console.log('🔌 Android: Handling device disconnection:', event);
    
    const { deviceId, deviceName, error } = event;
    
    // Use the same handler as auto-connect disconnection for consistency
    this.handleAutoDisconnectedDevice({
      deviceId,
      deviceName: deviceName || 'Unknown Device',
      error: error || 'disconnected'
    });
  }

  handleAndroidDeviceReconnected(event) {
    console.log('🔗 Android: Handling device reconnection:', event);
    
    const { deviceId, deviceName } = event;
    
    // Update device state to connected
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.CONNECTED;
      device.connectedAt = new Date();
      device.lastSeen = Date.now();
      this.scannedDevices.set(deviceId, device);
      
      // Add to connected devices
      this.connectedDevices.set(deviceId, device);
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      console.log(`✅ Android: Device ${deviceId} reconnected successfully`);
    }
  }

  handleAndroidDeviceConnected(event) {
    console.log('🔗 Android: Handling device connection:', event);
    
    const { deviceId, deviceName } = event;
    
    // Update device state to connected
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.CONNECTED;
      device.connectedAt = new Date();
      device.lastSeen = Date.now();
      this.scannedDevices.set(deviceId, device);
      
      // Add to connected devices
      this.connectedDevices.set(deviceId, device);
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      console.log(`✅ Android: Device ${deviceId} connected successfully`);
    }
  }

  handleAndroidDeviceDataUpdated(event) {
    const { deviceId, batteryLevel, steps, temperature, timestamp } = event;
    
    console.log('📱 Android: Processing device data update:', { deviceId, batteryLevel, steps, temperature });
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.warn(`📱 Android: Device not found for data update: ${deviceId}`);
      return;
    }

    // Update device data
    const previousData = { ...device.deviceData };
    
    // Ensure deviceData is properly initialized
    if (!device.deviceData) {
      device.deviceData = {
        batteryLevel: null,
        temperature: null,
        steps: null,
        lastUpdate: new Date()
      };
    }
    
    device.deviceData = {
      ...device.deviceData,
      batteryLevel: batteryLevel !== undefined ? batteryLevel : device.deviceData.batteryLevel,
      steps: steps !== undefined ? steps : device.deviceData.steps,
      temperature: temperature !== undefined ? temperature : device.deviceData.temperature,
      timestamp: timestamp ? new Date(timestamp) : device.deviceData.timestamp,
      lastUpdate: new Date()
    };

    this.scannedDevices.set(deviceId, device);

    // Log data changes
    const dataChanged = previousData.steps !== device.deviceData.steps ||
      previousData.temperature !== device.deviceData.temperature ||
      previousData.batteryLevel !== device.deviceData.batteryLevel;

    if (dataChanged) {
      console.log(`📊 Android: Data update for ${device.name}: Steps=${device.deviceData.steps}, Temp=${device.deviceData.temperature?.toFixed(1)}°C, Battery=${device.deviceData.batteryLevel}%`);
    }

    // Trigger UI update callback if available
    if (this.onDeviceDataUpdated) {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    }
  }

  handleAndroidServicesDiscovered(event) {
    const { deviceId, services, characteristics } = event;
    
    console.log('📱 Android: Processing services discovered:', { deviceId, servicesCount: services?.length, characteristicsCount: characteristics?.length });
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.warn(`📱 Android: Device not found for services discovery: ${deviceId}`);
      return;
    }

    // Update device with services and characteristics
    device.services = services || [];
    
    // Extract characteristics from services array (Android sends characteristics as part of services)
    const allCharacteristics = [];
    if (services && services.length > 0) {
      services.forEach(service => {
        if (service.characteristics && service.characteristics.length > 0) {
          service.characteristics.forEach(char => {
            allCharacteristics.push({
              uuid: char.uuid,
              serviceUUID: service.uuid,
              isReadable: char.isReadable,
              isWritable: char.isWritable,
              isNotifiable: char.isNotifiable
            });
          });
        }
      });
    }
    
    device.characteristics = allCharacteristics;
    
    this.scannedDevices.set(deviceId, device);

    console.log(`✅ Android: Services discovered for ${device.name}: ${device.services.length} services, ${device.characteristics.length} characteristics`);

    // Start monitoring now that services are discovered
    this.startMonitoring(deviceId);

    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
  }

  setLowPowerMode(enabled) {
    this.profile = (enabled ? POWER_PROFILE?.lowPower : POWER_PROFILE?.default) || this.profile;
    console.log('⚡ Power profile set to', enabled ? 'lowPower' : 'default');
    if (this.connectedDevices.size > 0) {
      this.stopConnectionHealthCheck();
      this.startConnectionHealthCheck();
    }
  }

  // Enhanced power mode with ultra-low power option
  setPowerProfile(profileName) {
    console.log(`⚡ setPowerProfile called with: ${profileName}`);
    
    const profile = POWER_PROFILE[profileName];
    if (!profile) {
      console.warn('⚠️ Invalid power profile:', profileName);
      return;
    }
    
    const oldProfile = this.getCurrentProfileName();
    this.profile = profile;
    console.log(`⚡ Power profile changed: ${oldProfile} → ${profileName}`);
    
    // Update all timing configurations based on new power profile
    this.updateApiTimingForPowerProfile();
    
    if (this.connectedDevices.size > 0) {
      this.stopConnectionHealthCheck();
      this.startConnectionHealthCheck();
    }
    
    // Restart RSSI cycle with new profile settings
    this.restartRssiCycle();
    
    // Emit profile change event for UI updates
    this.emit('powerProfileChanged', {
      oldProfile,
      newProfile: profileName,
      timestamp: Date.now()
    });
  }

  // =================== RSSI CYCLE MANAGEMENT ===================
  
  /**
   * Start RSSI cycle monitoring for connected devices
   */
  startRssiCycle() {
    if (this.rssiCycleActive) {
      console.log('📡 RSSI cycle already active');
      return;
    }

    if (this.connectedDevices.size === 0) {
      console.log('📡 No connected devices, skipping RSSI cycle start');
      return;
    }

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.rssiCycleIntervalMs || 30000;
    console.log(`📡 Starting RSSI cycle - Profile: ${currentProfile}, Interval: ${interval}ms, Devices: ${this.connectedDevices.size}`);

    this.rssiCycleActive = true;
    this.rssiCycleTimer = setInterval(() => {
      this.performRssiCycle();
    }, interval);

    // Perform initial RSSI measurement
    console.log('📡 Performing initial RSSI measurement');
    this.performRssiCycle();
  }

  /**
   * Stop RSSI cycle monitoring
   */
  stopRssiCycle() {
    if (!this.rssiCycleActive) {
      console.log('📡 RSSI cycle already stopped');
      return;
    }

    const currentProfile = this.getCurrentProfileName();
    console.log(`📡 Stopping RSSI cycle - Profile: ${currentProfile}, Devices: ${this.connectedDevices.size}`);
    this.rssiCycleActive = false;

    if (this.rssiCycleTimer) {
      clearInterval(this.rssiCycleTimer);
      this.rssiCycleTimer = null;
    }
  }

  /**
   * Restart RSSI cycle with current profile settings
   */
  restartRssiCycle() {
    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.rssiCycleIntervalMs || 30000;
    console.log(`📡 Restarting RSSI cycle - Profile: ${currentProfile}, New Interval: ${interval}ms`);
    
    this.stopRssiCycle();
    
    // Small delay to ensure clean restart
    setTimeout(() => {
      if (this.connectedDevices.size > 0) {
        console.log(`📡 RSSI cycle restart completed - ${this.connectedDevices.size} devices`);
        this.startRssiCycle();
      }
    }, 100);
  }

  /**
   * Perform RSSI cycle measurement for all connected devices
   */
  async performRssiCycle() {
    if (!this.rssiCycleActive || this.connectedDevices.size === 0) {
      console.log('📡 RSSI cycle not active or no devices connected');
      return;
    }

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.rssiCycleIntervalMs || 30000;
    console.log(`📡 Performing RSSI cycle for ${this.connectedDevices.size} device(s) - Profile: ${currentProfile}, Interval: ${interval}ms`);
    
    const cycleDuration = this.profile.rssiCycleDurationMs || 3000;
    const startTime = Date.now();
    
    // Measure RSSI for each connected device
    const deviceIds = Array.from(this.connectedDevices.keys());
    console.log(`📡 Device IDs for RSSI measurement:`, deviceIds);
    
    const rssiPromises = deviceIds.map(deviceId => 
      this.measureDeviceRssi(deviceId)
    );

    try {
      await Promise.allSettled(rssiPromises);
      
      const cycleTime = Date.now() - startTime;
      console.log(`📡 RSSI cycle completed in ${cycleTime}ms (target: ${cycleDuration}ms)`);
      
      // Emit RSSI cycle completed event
      this.emit('rssiCycleCompleted', {
        deviceCount: this.connectedDevices.size,
        cycleTime,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('📡 RSSI cycle error:', error);
    }
  }

  /**
   * Measure RSSI for a specific device
   */
  async measureDeviceRssi(deviceId) {
    try {
      console.log(`📡 Measuring RSSI for device: ${deviceId}`);
      const device = this.connectedDevices.get(deviceId);
      if (!device || !device.device) {
        console.log(`📡 Device not found in connectedDevices: ${deviceId}`);
        return;
      }

      console.log(`📡 Device found, reading RSSI...`);
      
      let rssi;
      if (Platform.OS === 'android') {
        // Use native Android RSSI reading
        console.log(`📡 Using Android native RSSI reading for ${deviceId}`);
        try {
          const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          rssi = result;
          console.log(`📡 Android RSSI result for ${deviceId}:`, result);
        } catch (error) {
          console.error(`📡 Android RSSI reading failed for ${deviceId}:`, error);
          return;
        }
      } else {
        // iOS uses BLE PLX RSSI reading
        console.log(`📡 Using iOS BLE-PLX RSSI reading for ${deviceId}`);
        rssi = await device.device.readRSSI();
      }
      
      if (rssi !== null && rssi !== undefined) {
        // Store current RSSI value
        this.rssiValues.set(deviceId, rssi);
        
        // Also update RSSI in scannedDevices for UI display
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (scannedDevice) {
          scannedDevice.rssi = rssi;
        }
        
        // Add to history (keep last 20 readings)
        if (!this.rssiHistory.has(deviceId)) {
          this.rssiHistory.set(deviceId, []);
        }
        
        const history = this.rssiHistory.get(deviceId);
        history.push({
          value: rssi,
          timestamp: Date.now()
        });
        
        // Keep only last 20 readings
        if (history.length > 20) {
          history.shift();
        }
        
        // Update last RSSI update time
        this.lastRssiUpdate.set(deviceId, Date.now());
        
        console.log(`📡 Device ${deviceId} RSSI: ${rssi}dBm`);
        
        // Emit RSSI updated event
        this.emit('rssiUpdated', {
          deviceId,
          rssi,
          timestamp: Date.now()
        });
        
        // Check if RSSI indicates poor connection
        this.checkRssiConnectionQuality(deviceId, rssi);
        
      } else {
        console.warn(`📡 Could not read RSSI for device ${deviceId}`);
      }
      
    } catch (error) {
      console.error(`📡 Error measuring RSSI for device ${deviceId}:`, error);
    }
  }

  /**
   * Check RSSI connection quality and take action if needed
   */
  checkRssiConnectionQuality(deviceId, rssi) {
    // RSSI quality thresholds (in dBm)
    // Note: RSSI values are negative, so better signal = higher (less negative) numbers
    const thresholds = {
      excellent: -50,  // -50dBm and above (strongest signal)
      good: -70,       // -70dBm to -50dBm (good signal)
      fair: -80,       // -80dBm to -70dBm (moderate signal)
      poor: -90,       // -90dBm to -80dBm (weak signal)
      veryPoor: -100   // -100dBm to -90dBm (very weak signal)
    };

    let quality = 'unknown';
    
    // RSSI values are negative, so we check if RSSI is greater than or equal to thresholds
    // -47dBm >= -50dBm is true (excellent)
    // -75dBm >= -70dBm is false, but -75dBm >= -80dBm is true (fair)
    if (rssi >= thresholds.excellent) {
      quality = 'excellent';
    } else if (rssi >= thresholds.good) {
      quality = 'good';
    } else if (rssi >= thresholds.fair) {
      quality = 'fair';
    } else if (rssi >= thresholds.poor) {
      quality = 'poor';
    } else if (rssi >= thresholds.veryPoor) {
      quality = 'veryPoor';
    } else {
      quality = 'critical';
    }
    
    console.log(`📡 RSSI Quality Assessment for ${deviceId}: ${rssi}dBm → ${quality}`);
    console.log(`📡 Thresholds: Excellent(≥${thresholds.excellent}), Good(≥${thresholds.good}), Fair(≥${thresholds.fair}), Poor(≥${thresholds.poor}), VeryPoor(≥${thresholds.veryPoor})`);
    
    // Debug: Show exact calculation for this RSSI value
    console.log(`📡 Debug Calculation:`);
    console.log(`📡   RSSI: ${rssi}dBm`);
    console.log(`📡   Is ${rssi} >= ${thresholds.excellent} (-50)? ${rssi >= thresholds.excellent}`);
    console.log(`📡   Is ${rssi} >= ${thresholds.good} (-70)? ${rssi >= thresholds.good}`);
    console.log(`📡   Is ${rssi} >= ${thresholds.fair} (-80)? ${rssi >= thresholds.fair}`);
    console.log(`📡   Is ${rssi} >= ${thresholds.poor} (-90)? ${rssi >= thresholds.poor}`);
    console.log(`📡   Is ${rssi} >= ${thresholds.veryPoor} (-100)? ${rssi >= thresholds.veryPoor}`);
    console.log(`📡   Final Quality: ${quality}`);

    // Store quality in device info (both connectedDevices and scannedDevices)
    const connectedDevice = this.connectedDevices.get(deviceId);
    if (connectedDevice) {
      connectedDevice.connectionQuality = quality;
      connectedDevice.lastRssi = rssi;
      connectedDevice.lastRssiUpdate = Date.now();
    }
    
    // Also update scannedDevices for UI display
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice) {
      scannedDevice.connectionQuality = quality;
      scannedDevice.lastRssi = rssi;
      scannedDevice.lastRssiUpdate = Date.now();
    }

    // Take action based on quality
    switch (quality) {
      case 'excellent':
      case 'good':
        // No action needed
        break;
        
      case 'fair':
        console.log(`⚠️ Device ${deviceId} has fair connection quality (RSSI: ${rssi}dBm)`);
        break;
        
      case 'poor':
        console.log(`⚠️ Device ${deviceId} has poor connection quality (RSSI: ${rssi}dBm)`);
        this.emit('rssiPoorConnection', { deviceId, rssi, quality });
        break;
        
      case 'veryPoor':
      case 'critical':
        console.log(`🚨 Device ${deviceId} has very poor connection quality (RSSI: ${rssi}dBm)`);
        this.emit('rssiCriticalConnection', { deviceId, rssi, quality });
        
        // Only disconnect if connection is truly unusable (very rare)
        if (quality === 'critical' && rssi < -120) {
          console.log(`🔌 Disconnecting device ${deviceId} due to extremely poor connection quality (RSSI: ${rssi}dBm)`);
          this.disconnectFromDevice(deviceId);
        } else if (quality === 'critical') {
          console.log(`⚠️ Device ${deviceId} has critical connection quality but keeping connection (RSSI: ${rssi}dBm)`);
        }
        break;
    }

    // Emit connection quality event
    this.emit('connectionQualityChanged', {
      deviceId,
      rssi,
      quality,
      timestamp: Date.now()
    });
    
    // Trigger UI update if callback is registered
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
  }

  /**
   * Get current RSSI value for a device
   */
  getDeviceRssi(deviceId) {
    // Try to get from scannedDevices first (for UI display)
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice?.rssi !== null && scannedDevice?.rssi !== undefined) {
      return scannedDevice.rssi;
    }
    
    // Fallback to rssiValues map
    return this.rssiValues.get(deviceId);
  }

  /**
   * Get RSSI history for a device
   */
  getDeviceRssiHistory(deviceId) {
    return this.rssiHistory.get(deviceId) || [];
  }

  /**
   * Get RSSI trend for a device (improving, stable, degrading)
   */
  getDeviceRssiTrend(deviceId) {
    const history = this.rssiHistory.get(deviceId);
    if (!history || history.length < 3) {
      return 'insufficient_data';
    }

    const recent = history.slice(-3);
    const first = recent[0].value;
    const last = recent[recent.length - 1].value;
    const change = last - first;

    if (change > 5) return 'improving';
    if (change < -5) return 'degrading';
    return 'stable';
  }

  /**
   * Get connection quality for a device
   */
  getDeviceConnectionQuality(deviceId) {
    // Try to get from scannedDevices first (for UI display)
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice?.connectionQuality) {
      return scannedDevice.connectionQuality;
    }
    
    // Fallback to connectedDevices
    const connectedDevice = this.connectedDevices.get(deviceId);
    return connectedDevice?.connectionQuality || 'unknown';
  }

  /**
   * Check if RSSI cycle is active
   */
  isRssiCycleActive() {
    return this.rssiCycleActive;
  }

  /**
   * Check if a device can be forgotten (not currently connecting)
   */
  canForgetDevice(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device) return false;
    
    // Don't allow forgetting devices that are currently connecting
    if (device.connectionState === CONNECTION_STATES.CONNECTING) {
      return false;
    }
    
    return true;
  }

  /**
   * Get RSSI cycle status
   */
  getRssiCycleStatus() {
    return {
      active: this.rssiCycleActive,
      interval: this.profile.rssiCycleIntervalMs || 30000,
      duration: this.profile.rssiCycleDurationMs || 3000,
      deviceCount: this.connectedDevices.size,
      lastUpdate: this.lastRssiUpdate
    };
  }

  /**
   * Manually trigger RSSI measurement for all connected devices (for testing)
   */
  async triggerManualRssiMeasurement() {
    console.log('📡 Manual RSSI measurement triggered');
    if (this.connectedDevices.size === 0) {
      console.log('📡 No connected devices for manual RSSI measurement');
      return { success: false, message: 'No connected devices' };
    }

    try {
      await this.performRssiCycle();
      return { success: true, message: 'Manual RSSI measurement completed' };
    } catch (error) {
      console.error('📡 Manual RSSI measurement failed:', error);
      return { success: false, error: error.message };
    }
  }





  // =================== iOS STATE RESTORATION ===================
  handleRestoredState(restoredState) {
    try {
      if (!restoredState) {
        console.log('ℹ️ No BLE state to restore');
        return;
      }

      const restoredDevices = restoredState.connectedPeripherals || restoredState.peripherals || [];
      console.log(`🔄 iOS restoration: ${restoredDevices.length} peripheral(s)`);

      restoredDevices.forEach((device) => {
        try {
          // Some SDKs provide plain IDs; normalize to a Device-like object
          const deviceId = device?.id || device?.identifier || device;
          if (!deviceId) {
            return;
          }

          this.reattachMonitorsForRestoredDevice(device, deviceId);
        } catch (e) {
          console.warn('⚠️ Error processing restored peripheral:', e?.message || e);
        }
      });
    } catch (e) {
      console.warn('⚠️ handleRestoredState failed:', e?.message || e);
    }
  }

  // Convenience method matching requested naming to reattach for a list of restored peripherals
  async reattachMonitors(restoredPeripherals) {
    if (!Array.isArray(restoredPeripherals)) return;
    for (const item of restoredPeripherals) {
      const id = item?.id || item?.identifier || item;
      await this.reattachMonitorsForRestoredDevice(item, id);
    }
  }

  async reattachMonitorsForRestoredDevice(deviceOrId, deviceIdParam) {
    try {
      const deviceId = deviceIdParam || deviceOrId?.id || deviceOrId?.identifier || deviceOrId;
      if (!deviceId) return;

      // TODO: IMPLEMENT TAG VERIFICATION FOR BACKGROUND STATE RESTORATION
      // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
      /*
      // Verify if this restored device is user's purchased tag
      const deviceName = deviceOrId?.name || 'Restored Device';
      const isVerified = await this.isVerifiedTag(deviceId, deviceName);
      if (!isVerified) {
        console.log('⚠️ Background restoration blocked: Unverified tag detected:', deviceName);
        
        // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
        // Read location data from nearby tag without full connection
        // await this.handleNearbyTag(deviceId, deviceName);
        
        // Disconnect immediately - don't allow background restoration for unverified tags
        try {
          const device = await this.manager.connectToDevice(deviceId, { timeout: 3000 });
          await device.cancelConnection();
          console.log('✅ Disconnected from unverified restored tag');
        } catch (error) {
          console.warn('⚠️ Could not disconnect from unverified restored tag:', error.message);
        }
        return; // Exit early - don't proceed with restoration
      }
      
      console.log('✅ Background restoration allowed: Verified tag detected:', deviceName);
      */

      // Ensure we have a Device handle from BLE-PLX
      let deviceHandle = deviceOrId && typeof deviceOrId.isConnected === 'function' ? deviceOrId : null;
      if (!deviceHandle) {
        try {
          const connectedList = await this.manager.connectedDevices([]);
          deviceHandle = connectedList.find(d => d.id === deviceId) || null;
        } catch { }
      }

      // If we still don't have a handle, attempt to connect quickly to obtain one
      if (!deviceHandle) {
        try {
          deviceHandle = await this.manager.connectToDevice(deviceId, { timeout: 8000, autoConnect: false });
        } catch (e) {
          console.warn('⚠️ Could not acquire BLE handle for restored device:', deviceId, e?.message || e);
          return;
        }
      }

      // Track in maps for downstream APIs
      this.connectedDevices.set(deviceId, deviceHandle);
      const existing = this.scannedDevices.get(deviceId) || {
        id: deviceId,
        name: deviceHandle?.name || 'Restored Device',
        connectionState: CONNECTION_STATES.CONNECTED,
        deviceData: {},
        services: [],
        characteristics: []
      };
      existing.connectionState = CONNECTION_STATES.CONNECTED;
      this.scannedDevices.set(deviceId, existing);

      // Measure initial RSSI and set connection quality for restored device
      try {
        const initialRssi = await deviceHandle.readRSSI();
        if (initialRssi !== null && initialRssi !== undefined) {
          console.log(`📡 Initial RSSI for restored device ${deviceId}: ${initialRssi}dBm`);
          this.checkRssiConnectionQuality(deviceId, initialRssi);
        }
      } catch (rssiError) {
        console.warn(`⚠️ Could not read initial RSSI for restored device ${deviceId}:`, rssiError?.message || rssiError);
      }

      // Prevent duplicate monitors by clearing any stale subscriptions
      this.stopMonitoring(deviceId);

      // Discover services/characteristics and reattach monitors
      try {
        await deviceHandle.discoverAllServicesAndCharacteristics();
      } catch (e) {
        console.warn('⚠️ discoverAllServicesAndCharacteristics failed (restored):', e?.message || e);
      }

      try {
        await this.loadDeviceServices(deviceId);
      } catch { }

      this.startRSSIPolling(deviceId);
      setTimeout(() => this.requestDeviceData(deviceId), 1000);

      // Ensure we detect out-of-range after restoration as well
      try {
        const disconnectSub = deviceHandle.onDisconnected((error, dev) => {
          console.log('🔌 BLE-PLX onDisconnected (restored) for', deviceId, error?.message || '');
          this.handleAutoDisconnectedDevice({
            deviceId,
            deviceName: dev?.name || 'Unknown Device',
            error: error?.message || 'disconnected'
          });
        });
        this.disconnectSubscriptions.set(deviceId, disconnectSub);
      } catch { }

      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }

      console.log(`✅ Reattached monitors for restored peripheral ${deviceId}`);
    } catch (e) {
      console.warn('⚠️ reattachMonitorsForRestoredDevice failed:', e?.message || e);
    }
  }
  // ================= END iOS STATE RESTORATION =================

  // Permission handling
  async requestPermissions() {
    try {
      console.log('🔐 BLEService: Requesting permissions...');

      if (Platform.OS === 'android') {
        // Use native Android permission request
        const result = await SampleBridgeAndroid.requestPermissions();
        console.log('🤖 Android permissions result:', result);
        return result.granted || false;
      } else {
        // iOS uses BLE PLX permissions
        const result = await BLEPermissions.requestBluetoothPermission();

        if (result) {
          console.log('✅ BLEService: Permissions granted via normal method');
          return true;
        }

        console.log('⚠️ BLEService: Normal permission method failed, trying force method...');

        // If normal method fails, try force method
        const forceResult = await BLEPermissions.forceRequestPermissions();

        if (forceResult) {
          console.log('✅ BLEService: Permissions granted via force method');
          return true;
        }

        console.log('❌ BLEService: All permission methods failed');

        // Debug permissions
        const debugInfo = await BLEPermissions.debugPermissions();
        console.log('🔍 BLEService: Permission debug info:', debugInfo);

        return false;
      }
    } catch (error) {
      console.error('❌ BLEService: Error requesting permissions:', error);
      return false;
    }
  }

  // Get current BLE state
  getBLEState() {
    return this.bleState;
  }

  // Refresh BLE state (useful for Android)
  async refreshBLEState() {
    if (Platform.OS === 'android') {
      try {
        const result = await SampleBridgeAndroid.isBLEReady();
        this.bleState = result.ready ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
        console.log('🤖 Android BLE state refreshed:', this.bleState);
        return this.bleState;
      } catch (error) {
        console.error('❌ Error refreshing BLE state:', error);
        this.bleState = BLE_STATES.UNKNOWN;
        return this.bleState;
      }
    } else {
      // iOS uses BLE PLX state check
      const state = await this.manager.state();
      this.bleState = state;
      return this.bleState;
    }
  }

  // Check if BLE is available and ready
  async isBLEReady() {
    if (Platform.OS === 'android') {
      // Use native Android BLE ready check
      const result = await SampleBridgeAndroid.isBLEReady();
      return result.ready || false;
    } else {
      // iOS uses BLE PLX state check
      const state = await this.manager.state();
      return state === BLE_STATES.POWERED_ON;
    }
  }

  // Start scanning for devices
  async startScanning(onDeviceFound, onError, maxDuration = null, scanMode = null) {
    try {
      const hasPermissions = await this.requestPermissions();
      if (!hasPermissions) {
        throw new Error('Permissions not granted');
      }

      const isReady = await this.isBLEReady();
      if (!isReady) {
        throw new Error('Bluetooth is not ready');
      }

      if (this.scanState === SCAN_STATES.SCANNING) {
        console.log('Already scanning');
        return;
      }

      this.scanState = SCAN_STATES.SCANNING;
      // Preserve connected devices AND recently disconnected devices (within 5 minutes)
      const preservedDevices = new Map();
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000); // 5 minutes in milliseconds

      for (const [existingDeviceId, existingDevice] of this.scannedDevices.entries()) {
        const shouldPreserve =
          existingDevice.connectionState === CONNECTION_STATES.CONNECTED ||
          (existingDevice.connectionState === CONNECTION_STATES.DISCONNECTED &&
            existingDevice.lastSeen && existingDevice.lastSeen > fiveMinutesAgo);

        if (shouldPreserve) {
          preservedDevices.set(existingDeviceId, existingDevice);
        }
      }

      // Store original devices for logging before replacing
      const originalDevices = new Map(this.scannedDevices);

      console.log(`📋 Scan preservation analysis:`);
      console.log(`  - Total devices before scan: ${originalDevices.size}`);
      console.log(`  - Preserved devices: ${preservedDevices.size}`);
      console.log(`  - Cutoff time: ${new Date(fiveMinutesAgo).toLocaleTimeString()}`);

      preservedDevices.forEach((device, id) => {
        const lastSeenTime = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString() : 'Never';
        console.log(`  ✅ Preserved: ${device.name || 'Unknown'} (${device.connectionState}) - Last seen: ${lastSeenTime}`);
      });

      // Log devices that were NOT preserved
      originalDevices.forEach((device, id) => {
        if (!preservedDevices.has(id)) {
          const lastSeenTime = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString() : 'Never';
          const reason = device.connectionState === CONNECTION_STATES.CONNECTED
            ? 'Should have been preserved (CONNECTED)'
            : device.lastSeen && device.lastSeen > fiveMinutesAgo
              ? 'Should have been preserved (Recent)'
              : 'Too old or no lastSeen';
          console.log(`  ❌ NOT Preserved: ${device.name || 'Unknown'} (${device.connectionState}) - Last seen: ${lastSeenTime} - Reason: ${reason}`);
        }
      });

      // Now assign the preserved devices
      this.scannedDevices = preservedDevices;

      console.log('Starting BLE scan...');

      // Refresh bonded/known devices cache (iOS)
      if (Platform.OS === 'ios') {
        try {
          const bonded = await this.getBondedDevices();
          if (bonded && bonded.success) {
            for (const id of bonded.devices || []) {
              this.knownDeviceIds.add(id);
            }
          } else if (Array.isArray(bonded)) {
            for (const id of bonded) {
              this.knownDeviceIds.add(id);
            }
          }
        } catch { }
      }

      if (Platform.OS === 'android') {
        // Use native Android scanning
        console.log('🤖 Starting Android native scan...');
        const result = await SampleBridgeAndroid.startScanning();
        console.log('🤖 Android scan started:', result);
        
        // Android scanning is handled by native events, no subscription needed
        this.scanSubscription = { remove: () => {} }; // Dummy subscription for compatibility
      } else {
        // iOS uses BLE PLX scanning
        const serviceFilter = null; // could be [BLE_SERVICES.SMART_TAG] to restrict
        this.scanSubscription = this.manager.startDeviceScan(
          serviceFilter,
          {
            allowDuplicates: SCAN_CONFIG.allowDuplicates,
            scanMode: scanMode || this.profile.scanMode || 'LowLatency',
            callbackType: 'AllMatches'
          },
          async (error, device) => {
          if (error) {
            console.error('Scan error:', error);
            this.scanState = SCAN_STATES.STOPPED;
            if (onError) onError(error);
            return;
          }

          if (device) {
            const now = Date.now();

            // Log ALL discovered devices without any filtering
            console.log('🔍 SCANNING - Raw device discovered:', {
              id: device.id,
              name: device.name || 'No Name',
              rssi: device.rssi,
              manufacturerData: device.manufacturerData,
              serviceUUIDs: device.serviceUUIDs,
              advertisementData: device.advertisementData
            });

            // Check if device is already discovered
            if (!this.scannedDevices.has(device.id)) {
              // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL DEVICES
              // Add new devices if they have a name, are smart tags, or are known/bonded
              const isKnown = this.knownDeviceIds.has(device.id) || (await this.isDeviceBonded(device.id));
              if (device.name || this.isSmartTag(device) || isKnown) {
                // TODO: TAG VERIFICATION COMMENTED OUT FOR NOW - ALLOW ALL TAGS
                // Check if this is a verified tag (user's purchased tag)
                // const isVerified = await this.isVerifiedTag(device.id, device.name);
                const isVerified = true; // TEMPORARILY ALLOW ALL TAGS

                this.scannedDevices.set(device.id, {
                  ...device,
                  connectionState: CONNECTION_STATES.DISCONNECTED,
                  services: [],
                  characteristics: [],
                  lastSeen: now,
                  isVerified: isVerified, // Track verification status
                  deviceData: {
                    batteryLevel: null,
                    temperature: null,
                    steps: null,
                    timestamp: null,
                    isSmartTag: this.isSmartTag(device)
                  }
                });

                // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
                if (isVerified) {
                  console.log('✅ Found tag (verification disabled):', device.name || 'Unknown Smart Tag', device.id);
                  // This is user's tag - can connect and share full data
                }
                // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
                // } else {
                //   console.log('📍 Found nearby tag:', device.name || 'Unknown Smart Tag', device.id);
                //   // This is someone else's tag - only read location data
                //   this.handleNearbyTag(device.id, device.name);
                // }

                if (onDeviceFound) {
                  onDeviceFound(this.scannedDevices.get(device.id));
                }
              }
            } else {
              // Update RSSI, name (if available), and lastSeen for existing devices
              const existingDevice = this.scannedDevices.get(device.id);
              const wasDisconnected = existingDevice.connectionState === CONNECTION_STATES.DISCONNECTED;

              existingDevice.rssi = device.rssi;
              existingDevice.lastSeen = now;

              // If device is advertising and was marked disconnected recently, keep it in list and prefer DISCONNECTED state to allow reconnection
              if (existingDevice.connectionState !== CONNECTION_STATES.CONNECTED) {
                existingDevice.connectionState = CONNECTION_STATES.DISCONNECTED;
              }

              // Update name if it becomes available
              if (device.name && !existingDevice.name) {
                existingDevice.name = device.name;
              }

              this.scannedDevices.set(device.id, existingDevice);

              // Log when a disconnected device is found advertising again (good for debugging reconnection)
              if (wasDisconnected && device.rssi) {
                console.log('🔄 Rediscovered disconnected device:', existingDevice.name, 'RSSI:', device.rssi, 'ID:', device.id);
              }

              // Trigger callback for updated devices too (for RSSI updates)
              if (onDeviceFound) {
                onDeviceFound(existingDevice);
              }
            }
          }
        }
      );
      }

      // Auto-stop scan after bounded duration to reduce battery
      const scanDuration = maxDuration || this.profile.maxScanDurationMs || 15000;
      if (scanDuration) {
        setTimeout(() => {
          this.stopScanning();
        }, scanDuration);
        console.log(`⏱️ Auto-stop scan scheduled in ${scanDuration}ms`);
      }

    } catch (error) {
      console.error('Error starting scan:', error);
      this.scanState = SCAN_STATES.STOPPED;
      if (onError) onError(error);
    }
  }

  // Stop scanning
  stopScanning() {
    if (Platform.OS === 'android') {
      // Use native Android stop scanning
      SampleBridgeAndroid.stopScanning().catch(error => {
        console.error('🤖 Error stopping Android scan:', error);
      });
    } else {
      // iOS uses BLE PLX stop scanning
      if (this.scanSubscription) {
        this.manager.stopDeviceScan();
        this.scanSubscription = null;
      }
    }
    this.scanState = SCAN_STATES.STOPPED;
    console.log('Stopped BLE scan');
  }

  // Debounced list update to avoid UI thrash
  scheduleListUpdate() {
    if (!this.onDeviceListUpdated) return;
    if (!this.debouncedListUpdate) {
      this.debouncedListUpdate = setTimeout(() => {
        try { this.onDeviceListUpdated && this.onDeviceListUpdated(); } catch { }
        this.debouncedListUpdate = null;
      }, 120);
    }
  }

  // Periodic pruning for memory/battery hygiene
  startPruning() {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      try {
        const cutoff = Date.now() - (this.profile.pruneAgeMs || 600000);
        let deleted = false;
        for (const [id, dev] of this.scannedDevices.entries()) {
          const isConnected = dev.connectionState === CONNECTION_STATES.CONNECTED;
          // Only prune very old disconnected devices (older than 10 minutes) to allow reconnection
          const isVeryOld = dev.lastSeen && dev.lastSeen < cutoff;
          if (!isConnected && isVeryOld) {
            console.log('🧹 Pruning very old disconnected device:', dev.name, 'lastSeen:', new Date(dev.lastSeen).toLocaleTimeString());
            this.scannedDevices.delete(id);
            deleted = true;
          }
        }
        if (deleted) {
          this.scheduleListUpdate();
        }
      } catch { }
    }, this.profile.pruneIntervalMs || 300000);
  }

  stopPruning() {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  // Check if device is a smart tag based on services or name
  isSmartTag(device) {
    // Check if device advertises smart tag service
    if (device.serviceUUIDs && device.serviceUUIDs.includes(BLE_SERVICES.SMART_TAG)) {
      return true;
    }

    // Check device name patterns (customize based on your tag naming)
    const name = device.name?.toLowerCase() || '';
    return name.includes('smart') || name.includes('tag') || name.includes('pet');
  }

  // TODO: TAG VERIFICATION COMMENTED OUT FOR NOW - ALLOW ALL TAGS
  // Check if device is a verified tag (user's purchased tag)
  // async isVerifiedTag(deviceId, deviceName) {
  //   try {
  //     // TODO: Replace with your actual API call to verify tag ownership
  //     const response = await this.verifyTagOwnership(deviceId, deviceName);
  //     return response.isVerified;
  //   } catch (error) {
  //     console.warn(`⚠️ Could not verify tag ownership for ${deviceId}:`, error.message);
  //     return false; // Fail safe - don't connect to unverified tags
  //   }
  // }

  // TODO: TAG VERIFICATION COMMENTED OUT FOR NOW - ALLOW ALL TAGS
  // Verify tag ownership with server
  // async verifyTagOwnership(deviceId, deviceName) {
  //   try {
  //     // TODO: Implement your server API call here
  //     // Example structure:
  //     // const response = await fetch('/api/verify-tag', {
  //     //   method: 'POST',
  //     //   headers: { 'Content-Type': 'application/json' },
  //     //   body: JSON.stringify({ deviceId, deviceName, userId: this.currentUserId })
  //     // });
  //     // return await response.json();

  //     // For now, return mock data - replace with actual API
  //     console.log(`🔍 Verifying tag ownership: ${deviceId} (${deviceName})`);

  //     // Mock verification - replace with real API call
  //     return {
  //       isVerified: false, // Default to false for security
  //       tagId: null,
  //       userId: null,
  //       purchaseDate: null
  //     };
  //   } catch (error) {
  //     console.error('❌ Tag verification API error:', error);
  //     return { isVerified: false, error: error.message };
  //   }
  // }

  // Read location data from nearby tag without connecting
  async readNearbyTagLocation(deviceId) {
    try {
      console.log(`📍 Reading location from nearby tag: ${deviceId}`);

      // Try to read location characteristic without establishing full connection
      const device = await this.manager.connectToDevice(deviceId, {
        timeout: 5000, // Short timeout for quick read
        autoConnect: false
      });

      try {
        // Discover services quickly
        await device.discoverAllServicesAndCharacteristics();

        // Read location characteristic if available
        const locationData = await device.readCharacteristicForService(
          BLE_SERVICES.SMART_TAG,
          BLE_CHARACTERISTICS.LOCATION_DATA
        );

        // Parse location data
        const parsedLocation = this.parseLocationData(locationData?.value);

        // Send location data to server
        await this.sendLocationToServer(deviceId, parsedLocation);

        console.log(`✅ Location data read from nearby tag: ${deviceId}`);
        return parsedLocation;
      } finally {
        // Always disconnect after reading
        await device.cancelConnection();
      }
    } catch (error) {
      console.warn(`⚠️ Could not read location from nearby tag ${deviceId}:`, error.message);
      return null;
    }
  }

  // Parse location data from BLE characteristic
  parseLocationData(base64Data) {
    try {
      if (!base64Data) return null;

      const buffer = Buffer.from(base64Data, 'base64');

      // TODO: Implement your location data format parsing
      // This is a placeholder - adjust based on your tag's data format
      const location = {
        latitude: buffer.readFloatLE(0),
        longitude: buffer.readFloatLE(4),
        timestamp: new Date(),
        accuracy: buffer.readUInt8(8),
        source: 'nearby_tag'
      };

      return location;
    } catch (error) {
      console.error('❌ Error parsing location data:', error);
      return null;
    }
  }

  // Send location data to server
  async sendLocationToServer(deviceId, locationData) {
    try {
      // TODO: Implement your server API call here
      // Example structure:
      // const response = await fetch('/api/nearby-tag-location', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({
      //     deviceId,
      //     location: locationData,
      //     userId: this.currentUserId,
      //     timestamp: new Date().toISOString()
      //   })
      // });

      console.log(`📤 Sending nearby tag location to server: ${deviceId}`, locationData);

      // For now, just log - replace with actual API call
      return { success: true, message: 'Location data sent to server' };
    } catch (error) {
      console.error('❌ Failed to send location to server:', error);
      return { success: false, error: error.message };
    }
  }

  // Handle nearby tag (not user's purchased tag)
  async handleNearbyTag(deviceId, deviceName) {
    try {
      console.log(`📍 Processing nearby tag: ${deviceName} (${deviceId})`);

      // Read location data without connecting
      const locationData = await this.readNearbyTagLocation(deviceId);

      if (locationData) {
        console.log(`✅ Successfully read location from nearby tag: ${deviceName}`);

        // Store nearby tag data for UI display
        const nearbyTag = {
          id: deviceId,
          name: deviceName,
          type: 'nearby_tag',
          location: locationData,
          lastSeen: Date.now(),
          isVerified: false
        };

        // Add to nearby tags collection
        if (!this.nearbyTags) this.nearbyTags = new Map();
        this.nearbyTags.set(deviceId, nearbyTag);

        // Trigger UI update
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      } else {
        console.log(`⚠️ Could not read location from nearby tag: ${deviceName}`);
      }
    } catch (error) {
      console.warn(`⚠️ Error handling nearby tag ${deviceId}:`, error.message);
    }
  }

  // Get nearby tags (not user's purchased tags)
  getNearbyTags() {
    if (!this.nearbyTags) return [];
    return Array.from(this.nearbyTags.values());
  }

  // TODO: TAG VERIFICATION COMMENTED OUT FOR NOW - ALLOW ALL TAGS
  // Check if device can be connected to (verified tag only)
  // canConnectToDevice(deviceId) {
  //   const device = this.scannedDevices.get(deviceId);
  //   return device && device.isVerified === true;
  // }

  // Set current user ID for tag verification
  setCurrentUserId(userId) {
    this.currentUserId = userId;
    console.log(`👤 Current user ID set: ${userId}`);
  }

  // Get current user ID
  getCurrentUserId() {
    return this.currentUserId;
  }

  // Force refresh auto-connect status (useful for debugging)
  async forceRefreshAutoConnectStatus() {
    if (Platform.OS === 'ios') {
      try {
        console.log('🔄 Force refreshing auto-connect status...');
        const status = await AutoConnectService.getAutoConnectStatus();
        console.log('📊 Refreshed auto-connect status:', status);
        return status;
      } catch (error) {
        console.warn('⚠️ Could not refresh auto-connect status:', error.message);
        return null;
      }
    }
    return null;
  }

  // Get all connected devices
  getConnectedDevices() {
    const connectedDevicesList = [];

    // First, check devices in the connectedDevices map (from react-native-ble-plx)
    for (const [deviceId, connectedDevice] of this.connectedDevices) {
      let deviceInfo = this.scannedDevices.get(deviceId);

      // If device not in scannedDevices (e.g., auto-connected), create basic info
      if (!deviceInfo) {
        deviceInfo = {
          id: deviceId,
          name: connectedDevice.name || 'Unknown Device',
          rssi: null,
          connectionState: CONNECTION_STATES.CONNECTED,
          deviceData: this.deviceDataStore.get(deviceId) || {},
          isSmartTag: this.isSmartTag(connectedDevice),
          localName: connectedDevice.localName || connectedDevice.name
        };
      } else {
        // Update connection state for devices that are in scannedDevices
        deviceInfo = {
          ...deviceInfo,
          connectionState: CONNECTION_STATES.CONNECTED,
          deviceData: this.deviceDataStore.get(deviceId) || deviceInfo.deviceData || {}
        };
      }

      connectedDevicesList.push(deviceInfo);
    }

    // Also check scannedDevices for devices marked as CONNECTED (from auto-connect)
    for (const [deviceId, deviceInfo] of this.scannedDevices) {
      if (deviceInfo.connectionState === CONNECTION_STATES.CONNECTED &&
        !connectedDevicesList.find(d => d.id === deviceId)) {
        // This is an auto-connected device that might not be in connectedDevices yet
        const enhancedDeviceInfo = {
          ...deviceInfo,
          deviceData: this.deviceDataStore.get(deviceId) || deviceInfo.deviceData || {}
        };
        connectedDevicesList.push(enhancedDeviceInfo);
        console.log('📱 Found auto-connected device in scannedDevices:', deviceInfo.name);
      }
    }

    // Debug: Show all devices in scannedDevices
    console.log(`🔍 All devices in scannedDevices (${this.scannedDevices.size}):`,
      Array.from(this.scannedDevices.values()).map(d => `${d.name} (${d.connectionState})`));

    console.log(`🔗 getConnectedDevices() returning ${connectedDevicesList.length} devices:`,
      connectedDevicesList.map(d => `${d.name} (${d.connectionState})`));

    return connectedDevicesList;
  }

  // Connect to a device
  async connectToDevice(deviceId, onConnectionStateChange) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('Device not found in scanned devices');
      }

      // TODO: TAG VERIFICATION COMMENTED OUT FOR NOW - ALLOW ALL TAGS
      // Check if device can be connected to (verified tag only)
      // if (!this.canConnectToDevice(deviceId)) {
      //   throw new Error('Cannot connect to unverified tag. Only user\'s purchased tags can be connected to.');
      // }

      // Update connection state
      device.connectionState = CONNECTION_STATES.CONNECTING;
      this.scannedDevices.set(deviceId, device);
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTING);
      }

      console.log('Connecting to verified device:', device.name);
      this.markDeviceKnown(deviceId);

      // Stop scanning to free resources
      this.stopScanning();

      // Acquire connection from pool
      const connectionAcquired = await this.acquireConnection(deviceId, 'high');
      if (!connectionAcquired) {
        console.log(`⏳ Connection pool full for device ${deviceId}, waiting for available slot...`);
        // Wait for connection to become available
        await new Promise(resolve => {
          const checkPool = setInterval(() => {
            if (this.acquireConnection(deviceId, 'high')) {
              clearInterval(checkPool);
              resolve();
            }
          }, 1000);
        });
      }

      // Connect to device using platform-specific implementation
      let connectedDevice;
      if (Platform.OS === 'android') {
        // Use native Android connection
        console.log('🤖 Connecting to device via Android native bridge:', deviceId);
        const result = await SampleBridgeAndroid.connectToDevice(deviceId);
        console.log('🤖 Android connection result:', result);
        
        // Android connection is handled by native events
        connectedDevice = { id: deviceId }; // Dummy device object for compatibility
      } else {
        // iOS uses BLE PLX connection
        connectedDevice = await this.manager.connectToDevice(deviceId, {
          timeout: 12000, // Increased timeout for better reliability
          autoConnect: false,
          requestMTU: 512
        });

        // Discover services and characteristics
        await connectedDevice.discoverAllServicesAndCharacteristics();
      }

      // Negotiate MTU for optimal data transfer
      await this.negotiateMTU(deviceId, 512);

      // Update device state
      device.connectionState = CONNECTION_STATES.CONNECTED;
      this.connectedDevices.set(deviceId, connectedDevice);
      this.scannedDevices.set(deviceId, device);

      // Measure initial RSSI and set connection quality
      try {
        let initialRssi;
        if (Platform.OS === 'android') {
          // Use native Android RSSI reading
          const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          initialRssi = result.rssi;
        } else {
          // iOS uses BLE PLX RSSI reading
          initialRssi = await connectedDevice.readRSSI();
        }
        
        if (initialRssi !== null && initialRssi !== undefined) {
          // Handle RSSI object vs number
          const rssiValue = typeof initialRssi === 'object' ? initialRssi.rssi : initialRssi;
          if (rssiValue !== null && rssiValue !== undefined) {
            console.log(`📡 Initial RSSI for ${deviceId}: ${rssiValue}dBm`);
            this.checkRssiConnectionQuality(deviceId, rssiValue);
          } else {
            console.warn(`⚠️ Invalid RSSI value for ${deviceId}:`, initialRssi);
          }
        }
      } catch (rssiError) {
        console.warn(`⚠️ Could not read initial RSSI for ${deviceId}:`, rssiError?.message || rssiError);
      }

      // Clear any manual disconnect cooldown since user manually connected
      if (this.manualDisconnectCooldown.has(deviceId)) {
        this.manualDisconnectCooldown.delete(deviceId);
        console.log('🔄 Cleared manual disconnect cooldown - user manually reconnected');
      }

      // Clear any reconnection attempts since device is now connected
      if (this.reconnectionAttempts && this.reconnectionAttempts.has(deviceId)) {
        this.reconnectionAttempts.delete(deviceId);
        console.log('🔄 Cleared reconnection attempts - device successfully connected');
      }
      if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
        const timer = this.reconnectionTimers.get(deviceId);
        if (timer) clearTimeout(timer);
        this.reconnectionTimers.delete(deviceId);
        console.log('🔄 Cleared reconnection timer - device successfully connected');
      }

      console.log('Connected to device:', device.name);

      // Add device to bonded list for auto-connect (iOS only)
      if (Platform.OS === 'ios') {
        try {
          await this.addDeviceToBondedList(deviceId);
          console.log(`✅ Device ${device.name} added to auto-connect bonded list`);
        } catch (error) {
          console.warn('⚠️ Failed to add device to bonded list:', error.message);
        }
      }

      // Load services and characteristics
      try {
        // Ensure device is properly added to connectedDevices before loading services
        if (!this.connectedDevices.has(deviceId)) {
          console.warn(`⚠️ Device ${deviceId} not found in connectedDevices, adding it now`);
          this.connectedDevices.set(deviceId, connectedDevice);
        }
        
        // Small delay to ensure connection is fully established
        await new Promise(resolve => setTimeout(resolve, 500));
        
        await this.loadDeviceServices(deviceId);
      } catch (error) {
        console.error(`❌ Failed to load services for ${deviceId}:`, error.message);
        // Don't fail the entire connection if services can't be loaded
        // The device is still connected, just without service discovery
      }

      // Start heartbeat monitoring for connection health
      this.startHeartbeatMonitoring(deviceId);

      // Request initial data from the device
      setTimeout(() => {
        this.requestDeviceData(deviceId);
      }, 1000); // Wait 1 second after connection before requesting data

      // Send initial pet health data to server after successful connection
      setTimeout(() => {
        console.log(`📤 Sending initial pet health data to server after manual connection`);
        this.sendPetHealthDataToServer(deviceId);
      }, 3000); // Wait 3 seconds after connection to ensure data is available

      // Start adaptive API calling for this device
      setTimeout(() => {
        console.log(`🔄 Starting adaptive API calling for device ${deviceId} after manual connection`);
        this.startAdaptiveApiCalling(deviceId);
      }, 5000); // Start adaptive API calling 5 seconds after connection

      // Start connection health monitoring
      this.startConnectionHealthCheck();

      // Subscribe to disconnection to update UI promptly on out-of-range
      if (Platform.OS === 'ios') {
        try {
          const disconnectSub = connectedDevice.onDisconnected((error, device) => {
            console.log('🔌 BLE-PLX onDisconnected fired for', deviceId, error?.message || '');
            this.handleAutoDisconnectedDevice({
              deviceId,
              deviceName: device?.name || 'Unknown Device',
              error: error?.message || 'disconnected'
            });
          });
          this.disconnectSubscriptions.set(deviceId, disconnectSub);
        } catch (e) {
          console.warn('⚠️ Failed to set onDisconnected listener:', e?.message || e);
        }
      }
      // Android disconnection is handled by native events

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTED);
      }

      return connectedDevice;

    } catch (error) {
      console.error('Connection error:', error);

      // Update device state
      const device = this.scannedDevices.get(deviceId);
      if (device) {
        device.connectionState = CONNECTION_STATES.DISCONNECTED;
        this.scannedDevices.set(deviceId, device);
      }

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTED);
      }

      throw error;
    }
  }

  // Disconnect from device
  async disconnectFromDevice(deviceId, onConnectionStateChange) {
    try {
      console.log('🔌 Manual disconnect requested for device:', deviceId);

      let device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.warn('⚠️ Disconnect requested for device not in scanned list; proceeding with fallback');
        // Create a basic device entry so it can be tracked
        const connectedDevice = this.connectedDevices.get(deviceId);
        if (connectedDevice) {
          device = {
            id: deviceId,
            name: connectedDevice.name || 'Unknown Device',
            connectionState: CONNECTION_STATES.DISCONNECTING,
            lastSeen: Date.now(),
            deviceData: this.deviceDataStore?.get?.(deviceId) || {},
            isSmartTag: connectedDevice.name?.toLowerCase().includes('tag') || false
          };
          this.scannedDevices.set(deviceId, device);
          console.log('📝 Created device entry for tracking:', device.name);
        }
      } else {
        device.connectionState = CONNECTION_STATES.DISCONNECTING;
        this.scannedDevices.set(deviceId, device);
        console.log('📝 Updated device state to DISCONNECTING:', device.name);
      }

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTING);
      }

      // Stop monitoring, heartbeat, RSSI polling, and adaptive API calling
      this.stopMonitoring(deviceId);
      this.stopHeartbeatMonitoring(deviceId);
      this.stopRSSIPolling(deviceId);
      this.stopAdaptiveApiCalling(deviceId);

      // Stop connection health check if no more devices
      if (this.connectedDevices.size <= 1) { // Will be 0 after we delete this device
        this.stopConnectionHealthCheck();
      }

      // Disconnect using platform-specific implementation
      let connectedDevice = this.connectedDevices.get(deviceId);
      
      if (Platform.OS === 'android') {
        // Use native Android disconnection
        try {
          console.log('🤖 Disconnecting via Android native bridge:', deviceId);
          await SampleBridgeAndroid.cancelConnection(deviceId);
          console.log('✅ Disconnected from Android native side');
        } catch (e) {
          console.warn('⚠️ Android disconnect failed:', e.message);
        }
        this.connectedDevices.delete(deviceId);
      } else {
        // iOS uses BLE PLX disconnection
        if (!connectedDevice) {
          try {
            const list = await this.manager.connectedDevices([]);
            connectedDevice = list.find(d => d.id === deviceId);
          } catch (e) {
            console.warn('⚠️ Could not query connected devices during disconnect:', e.message);
          }
        }
        if (connectedDevice) {
          try {
            await connectedDevice.cancelConnection();
            console.log('✅ Disconnected from JavaScript side (BLE-PLX)');
          } catch (e) {
            console.warn('⚠️ cancelConnection failed (may already be disconnected):', e.message);
          }
          this.connectedDevices.delete(deviceId);

          // Remove disconnection listener if present
          const sub = this.disconnectSubscriptions.get(deviceId);
          try { sub && sub.remove && sub.remove(); } catch { }
          this.disconnectSubscriptions.delete(deviceId);
        } else {
          console.warn('⚠️ No BLE-PLX handle for disconnect; assuming native will drop connection');
        }
      }

      // Release connection from pool
      this.releaseConnection(deviceId);

      // Also disconnect from native iOS CoreBluetooth to ensure system Bluetooth shows disconnected
      if (Platform.OS === 'ios') {
        try {
          console.log('🔌 Disconnecting from native iOS CoreBluetooth...');
          await AutoConnectService.disconnectFromNative(deviceId);
          console.log('✅ Disconnected from native iOS CoreBluetooth');
        } catch (error) {
          console.warn('⚠️ Could not disconnect from native iOS:', error.message);
        }
      }

      if (device) {
        device.connectionState = CONNECTION_STATES.DISCONNECTED;
        device.lastSeen = Date.now(); // Mark when device was last seen (disconnection time)
        device.disconnectedAt = new Date();
        // PRESERVE RSSI so device remains visible and can be found in scans
        // device.rssi is kept intact - don't clear it
        this.scannedDevices.set(deviceId, device);
        this.markDeviceKnown(deviceId);
        console.log('✅ Manual disconnect completed for device:', device.name);
        console.log('📊 Device state:', {
          id: deviceId,
          name: device.name,
          connectionState: device.connectionState,
          lastSeen: device.lastSeen,
          rssi: device.rssi, // Log RSSI to confirm it's preserved
          isSmartTag: device.isSmartTag || false
        });
        console.log('📱 scannedDevices now contains:', Array.from(this.scannedDevices.keys()).length, 'devices');
      } else {
        console.log('Disconnected from device (fallback path)');
      }

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTED);
      }

      // Trigger device list update for UI refresh
      if (this.onDeviceListUpdated) {
        setTimeout(() => {
          this.onDeviceListUpdated();
        }, 100); // Small delay to ensure state is fully updated
      }

      // Set manual disconnect cooldown to prevent immediate auto-reconnect
      console.log('🕒 Setting manual disconnect cooldown for device:', deviceId);
      this.manualDisconnectCooldown.set(deviceId, Date.now());

      // Temporarily disable auto-connect to prevent immediate reconnection
      if (Platform.OS === 'ios') {
        try {
          console.log('⏸️ Temporarily disabling auto-connect to prevent immediate reconnection...');
          await AutoConnectService.stopAutoConnect();
          console.log('✅ Auto-connect temporarily disabled');

          // Re-enable auto-connect after cooldown period
          setTimeout(async () => {
            try {
              console.log('🔄 Re-enabling auto-connect after cooldown...');
              await AutoConnectService.startAutoConnect();
              console.log('✅ Auto-connect re-enabled');
            } catch (error) {
              console.warn('⚠️ Could not re-enable auto-connect:', error.message);
            }
          }, 30000); // 30 second cooldown
        } catch (error) {
          console.warn('⚠️ Could not temporarily disable auto-connect:', error.message);
        }
      }

      // Clear cooldown after 30 seconds
      setTimeout(() => {
        this.manualDisconnectCooldown.delete(deviceId);
        console.log('✅ Manual disconnect cooldown cleared for device:', deviceId);
      }, 30000);

      // Check if this device is bonded and auto-connect is enabled
      if (Platform.OS === 'ios') {
        console.log('📱 iOS detected - checking auto-connect eligibility...');

        // Sync connection state with native iOS to fix the count mismatch
        try {
          // Use getAutoConnectStatus to trigger cleanup of stale connections
          await AutoConnectService.getAutoConnectStatus();
          console.log('🔄 Connection state cleaned up via status refresh');

          // Wait a moment for the cleanup to complete
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.warn('⚠️ Could not refresh connection status:', error.message);
        }

        const isBonded = await this.isDeviceBonded(deviceId);
        const autoConnectStatus = await this.getAutoConnectStatus();

        console.log('🔍 Device bonded status:', isBonded);
        console.log('🔍 Auto-connect status:', autoConnectStatus);

        // IMPORTANT: Don't start auto-reconnection immediately after manual disconnect
        // This prevents the device from reconnecting in milliseconds
        if (isBonded && autoConnectStatus.enabled) {
          console.log('⏸️ Device was manually disconnected - auto-connect temporarily disabled');
          console.log('🎯 Target device ID:', deviceId);
          console.log('⏰ Auto-connect will resume after 30 second cooldown');

          // Don't start exponential backoff reconnection immediately
          // The cooldown will prevent this from happening
        } else {
          if (!isBonded) {
            console.log('⚠️ Device not bonded - no auto-connect');
          }
          if (!autoConnectStatus.enabled) {
            console.log('⚠️ Auto-connect disabled - no auto-connect');
          }
        }
      }

    } catch (error) {
      console.error('Disconnection error:', error);
      // Do not throw: avoid surfacing Device not found to UI in edge cases
      return;
    }
  }

  // Disconnect all devices
  async disconnectAllDevices() {
    const promises = [];
    for (const deviceId of this.connectedDevices.keys()) {
      promises.push(this.disconnectFromDevice(deviceId));
    }
    await Promise.all(promises);
  }

  // Load services and characteristics for a device
  async loadDeviceServices(deviceId) {
    try {
      const connectedDevice = this.connectedDevices.get(deviceId);
      if (!connectedDevice) {
        console.warn(`⚠️ Cannot load services - device ${deviceId} is not in connectedDevices`);
        throw new Error('Device not in connected devices map');
      }

      // Check if device is actually connected (platform-specific)
      let isConnected = false;
      
      if (Platform.OS === 'android') {
        // For Android, check connection state from our internal state
        // since we use native bridge, not BLE-PLX device objects
        const device = this.scannedDevices.get(deviceId);
        isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
        console.log(`🤖 Android connection check for ${deviceId}: ${isConnected ? 'CONNECTED' : 'DISCONNECTED'}`);
      } else {
        // For iOS, use BLE-PLX device's isConnected method
        for (let i = 0; i < 3; i++) {
          try {
            isConnected = connectedDevice.isConnected();
            break;
          } catch (error) {
            console.warn(`⚠️ isConnected() check failed (attempt ${i + 1}/3):`, error.message);
            if (i === 2) throw new Error('Device connection check failed');
            await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
          }
        }
      }

      if (!isConnected) {
        console.warn(`⚠️ Cannot load services - device ${deviceId} connection lost`);
        throw new Error('Device connection lost');
      }

      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.warn(`⚠️ Device ${deviceId} not found in scanned devices`);
        throw new Error('Device not found in scanned list');
      }

      // Get services with retry (platform-specific)
      let services = [];
      
      if (Platform.OS === 'android') {
        // For Android, services are managed by native bridge
        // We'll create a mock service structure for compatibility
        console.log(`🤖 Android: Creating mock service structure for ${deviceId}`);
        services = [
          {
            uuid: BLE_SERVICES.BATTERY,
            isPrimary: true,
            characteristics: () => Promise.resolve([
              { uuid: BLE_CHARACTERISTICS.BATTERY_LEVEL, properties: ['read', 'notify'] }
            ])
          },
          {
            uuid: BLE_SERVICES.SMART_TAG,
            isPrimary: true,
            characteristics: () => Promise.resolve([
              { uuid: BLE_CHARACTERISTICS.SYSTEM_COMMAND, properties: ['write', 'notify'] },
              { uuid: BLE_CHARACTERISTICS.DEVICE_STATUS, properties: ['read', 'notify'] },
              { uuid: BLE_CHARACTERISTICS.DATA_TRANSFER, properties: ['read', 'write', 'notify'] }
            ])
          }
        ];
      } else {
        // For iOS, use BLE-PLX methods
        for (let i = 0; i < 3; i++) {
          try {
            services = await connectedDevice.services();
            break;
          } catch (error) {
            console.warn(`⚠️ services() call failed (attempt ${i + 1}/3):`, error.message);
            if (i === 2) throw new Error('Failed to get device services');
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
          }
        }
      }

      device.services = [];
      device.characteristics = [];

      for (const service of services) {
        const serviceInfo = {
          uuid: service.uuid,
          isPrimary: service.isPrimary,
          characteristics: []
        };

        // Get characteristics with retry (platform-specific)
        let characteristics = [];
        
        if (Platform.OS === 'android') {
          // For Android, characteristics are already provided by mock structure
          characteristics = await service.characteristics();
        } else {
          // For iOS, use BLE-PLX methods
          for (let i = 0; i < 3; i++) {
            try {
              characteristics = await service.characteristics();
              break;
            } catch (error) {
              console.warn(`⚠️ characteristics() call failed for service ${service.uuid} (attempt ${i + 1}/3):`, error.message);
              if (i === 2) {
                console.error(`❌ Failed to get characteristics for service ${service.uuid}`);
                continue; // Skip this service and continue with others
              }
              await new Promise(resolve => setTimeout(resolve, 500)); // Wait 500ms before retry
            }
          }
        }

        for (const char of characteristics) {
          const charInfo = {
            uuid: char.uuid,
            serviceUUID: service.uuid,
            isReadable: char.isReadable,
            isWritableWithResponse: char.isWritableWithResponse,
            isWritableWithoutResponse: char.isWritableWithoutResponse,
            isNotifiable: char.isNotifiable,
            isIndicatable: char.isIndicatable,
            value: null
          };

          serviceInfo.characteristics.push(charInfo);
          device.characteristics.push(charInfo);
        }

        device.services.push(serviceInfo);
      }

      this.scannedDevices.set(deviceId, device);
      console.log(`✅ Loaded ${device.services.length} services and ${device.characteristics.length} characteristics for ${device.name}`);

    } catch (error) {
      console.error('❌ Error loading services:', error);
      throw error;
    }
  }

  // Start monitoring important characteristics
  startMonitoring(deviceId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ Cannot start monitoring - device ${deviceId} not connected`);
      return;
    }

    // Check if device is actually connected (platform-specific)
    try {
      let isConnected = false;
      
      if (Platform.OS === 'android') {
        // For Android, check connection state from our internal state
        const deviceState = this.scannedDevices.get(deviceId);
        isConnected = deviceState && deviceState.connectionState === CONNECTION_STATES.CONNECTED;
      } else {
        // For iOS, use BLE-PLX device's isConnected method
        isConnected = device.isConnected();
      }
      
      if (!isConnected) {
        console.warn(`⚠️ Cannot start monitoring - device ${deviceId} connection lost`);
        return;
      }
    } catch (error) {
      console.warn(`⚠️ Cannot check connection status for ${deviceId}:`, error.message);
      return;
    }

    // Monitor device status characteristic (only if available)
    try {
      this.monitorCharacteristic(
        deviceId,
        BLE_SERVICES.SMART_TAG,
        BLE_CHARACTERISTICS.DEVICE_STATUS,
        (data) => this.handleDeviceStatusUpdate(deviceId, data)
      );
    } catch (error) {
      console.log(`📭 Device status monitoring not available: ${error.message}`);
    }

    // Monitor battery level (only if available)
    try {
      this.monitorCharacteristic(
        deviceId,
        BLE_SERVICES.BATTERY,
        BLE_CHARACTERISTICS.BATTERY_LEVEL,
        (data) => this.handleBatteryUpdate(deviceId, data)
      );
    } catch (error) {
      console.log(`📭 Battery monitoring not available: ${error.message}`);
    }

    // Monitor data transfer characteristic (only if available)
    try {
      this.monitorCharacteristic(
        deviceId,
        BLE_SERVICES.SMART_TAG,
        BLE_CHARACTERISTICS.DATA_TRANSFER,
        (data) => this.handleDataTransfer(deviceId, data)
      );
    } catch (error) {
      console.log(`📭 Data transfer monitoring not available: ${error.message}`);
    }

    // Monitor system command responses (only if available)
    try {
      this.monitorCharacteristic(
        deviceId,
        BLE_SERVICES.SMART_TAG,
        BLE_CHARACTERISTICS.SYSTEM_COMMAND,
        (data) => this.handleSystemCommandResponse(deviceId, data)
      );
    } catch (error) {
      console.log(`📭 System command monitoring not available: ${error.message}`);
    }
  }

  // Monitor a specific characteristic
  async monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, onData) {
    try {
      if (Platform.OS === 'android') {
        // Use native Android characteristic monitoring
        console.log(`🤖 Starting Android monitoring for ${characteristicUUID}`);
        const result = await SampleBridgeAndroid.monitorCharacteristicForService(
          deviceId, 
          serviceUUID, 
          characteristicUUID
        );
        console.log(`🤖 Android monitoring started:`, result);
        
        // Android monitoring is handled by native events
        const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;
        this.monitoringSubscriptions.set(monitorKey, { remove: () => {} }); // Dummy subscription for compatibility
        return;
      }

      // iOS uses BLE PLX monitoring
      const device = this.connectedDevices.get(deviceId);
      if (!device) {
        console.warn(`⚠️ Cannot monitor ${characteristicUUID} - device ${deviceId} not connected`);
        return;
      }

      // Check if device is actually connected
      try {
        const isConnected = device.isConnected();
        if (!isConnected) {
          console.warn(`⚠️ Cannot monitor ${characteristicUUID} - device ${deviceId} connection lost`);
          return;
        }
      } catch (error) {
        console.warn(`⚠️ Cannot check connection status for ${deviceId}:`, error.message);
        return;
      }

      const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;

      // First, try to read the characteristic to see if it has data
      try {
        const initialRead = await device.readCharacteristicForService(serviceUUID, characteristicUUID);
        console.log(`Initial read of ${characteristicUUID}:`, initialRead?.value);
        if (initialRead?.value) {
          onData(initialRead.value);
        }
      } catch (readError) {
        console.log(`Cannot read ${characteristicUUID} (may not be readable):`, readError.message);
      }

      // On Android, some devices require explicitly writing CCCD; iOS manages this internally
      if (Platform.OS === 'android') {
        try {
          console.log(`Enabling notifications for ${characteristicUUID} (Android CCCD write)...`);
          const CCCD_UUID = '00002902-0000-1000-8000-00805f9b34fb';
          const notificationValue = Buffer.from([0x01, 0x00]).toString('base64');
          await device.writeDescriptorForService(
            serviceUUID,
            characteristicUUID,
            CCCD_UUID,
            notificationValue
          );
          console.log(`✅ Notifications enabled for ${characteristicUUID}`);
        } catch (cccdError) {
          console.log(`⚠️ Could not enable notifications for ${characteristicUUID}:`, cccdError.message);
          console.log(`This might be normal if the characteristic doesn't support notifications`);
        }
      }

      const subscription = device.monitorCharacteristicForService(
        serviceUUID,
        characteristicUUID,
        (error, characteristic) => {
          if (error) {
            // Don't log "Operation was cancelled" errors - these are expected during disconnect
            if (error.message && error.message.includes('cancelled')) {
              console.log(`📴 Monitoring stopped for ${characteristicUUID} (device disconnected)`);
            } else {
              console.error(`Monitor error for ${characteristicUUID}:`, error);
            }
            return;
          }

          if (characteristic?.value) {
            console.log(`📨 Received notification from ${characteristicUUID}:`, characteristic.value);
            onData(characteristic.value);
          } else {
            console.log(`📭 Received notification from ${characteristicUUID} but no data`);
          }
        }
      );

      this.monitoringSubscriptions.set(monitorKey, subscription);
      console.log(`🔔 Started monitoring ${characteristicUUID} for device ${deviceId}`);

    } catch (error) {
      console.error('Error starting monitoring:', error);
    }
  }

  // Stop monitoring for a device
  stopMonitoring(deviceId) {
    const subscriptionsToRemove = [];

    for (const [key, subscription] of this.monitoringSubscriptions.entries()) {
      if (key.startsWith(deviceId)) {
        subscription.remove();
        subscriptionsToRemove.push(key);
      }
    }

    subscriptionsToRemove.forEach(key => {
      this.monitoringSubscriptions.delete(key);
    });

    console.log(`Stopped monitoring for device ${deviceId}`);
  }

  // Handle device status updates
  handleDeviceStatusUpdate(deviceId, data) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.log(`No device found for ID: ${deviceId}`);
        return;
      }

      // Only log first few notifications to avoid spam, then every 10th
      if (!this.notificationCount) this.notificationCount = new Map();
      const count = (this.notificationCount.get(deviceId) || 0) + 1;
      this.notificationCount.set(deviceId, count);

      if (count <= 3 || count % 10 === 0) {
        console.log(`🔔 Device status notification #${count} for ${deviceId}${count > 3 ? ' (showing every 10th)' : ''}`);
      }

      const parsedData = BLEDataParser.parseDeviceStatus(data);

      if (parsedData) {
        // Only log parsed data for first few notifications
        if (count <= 2) {
          console.log(`Parsed device status for ${deviceId}:`, parsedData);
        }

        if (BLEDataParser.validateData(parsedData)) {
          const previousData = { ...device.deviceData };

          // Ensure deviceData is properly initialized
          if (!device.deviceData) {
            device.deviceData = {
              batteryLevel: null,
              temperature: null,
              steps: null,
              lastUpdate: new Date()
            };
          }

          device.deviceData = {
            ...device.deviceData,
            ...parsedData,
            lastUpdate: new Date()
          };

          this.scannedDevices.set(deviceId, device);

          // Only log changes, not repeated same values
          const dataChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature ||
            previousData.batteryLevel !== device.deviceData.batteryLevel;

          if (dataChanged || count <= 2) {
            console.log(`📊 Data update for ${device.name}: Steps=${device.deviceData.steps}, Temp=${device.deviceData.temperature?.toFixed(1)}°C, Battery=${device.deviceData.batteryLevel}%`);
          }

          // Trigger UI update callback if available
          if (this.onDeviceDataUpdated) {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          }

          // TODO: API call commented out to prevent calling on every notification
          // Send pet health data to server after successful data update
          // if (device.connectionState === CONNECTION_STATES.CONNECTED) {
          //   const connectionType = device.connectionType || 'manual';
          //   console.log(`📤 Sending pet health data to server after ${connectionType} connection data update`);
          //   setTimeout(() => {
          //     this.sendPetHealthDataToServer(deviceId);
          //   }, 1000); // Wait 1 second to ensure data is stable
          // }
        } else {
          console.warn(`Invalid device status data for ${deviceId}:`, parsedData);
        }
      } else {
        console.warn(`Failed to parse device status data for ${deviceId}`);
      }

    } catch (error) {
      console.error('Error parsing device status:', error);
    }
  }

  // Handle battery level updates
  handleBatteryUpdate(deviceId, data) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.log(`No device found for battery update: ${deviceId}`);
        return;
      }

      console.log(`🔋 BATTERY NOTIFICATION! Battery data for ${deviceId}:`, data);
      const batteryLevel = BLEDataParser.parseBatteryLevel(data);

      if (batteryLevel !== null) {
        const previousLevel = device.deviceData?.batteryLevel;

        // Ensure deviceData is properly initialized
        if (!device.deviceData) {
          device.deviceData = {
            batteryLevel: null,
            temperature: null,
            steps: null,
            lastUpdate: new Date()
          };
        }

        device.deviceData = {
          ...device.deviceData,
          batteryLevel,
          lastUpdate: new Date()
        };

        this.scannedDevices.set(deviceId, device);
        console.log(`Battery update for ${device.name}: ${previousLevel}% → ${batteryLevel}%`);

        // Trigger UI update callback if available
        if (this.onDeviceDataUpdated) {
          this.onDeviceDataUpdated(deviceId, device.deviceData);
        }

        // Adjust tag-specific optimizations based on tag battery level
        this.adjustTagOptimizationsForBattery(deviceId, batteryLevel);

        // TODO: API call commented out to prevent calling on every notification
        // Send pet health data to server after battery update
        // if (device.connectionState === CONNECTION_STATES.CONNECTED) {
        //   const connectionType = device.connectionType || 'manual';
        //   console.log(`📤 Sending pet health data to server after ${connectionType} connection battery update`);
        //   setTimeout(() => {
        //     this.sendPetHealthDataToServer(deviceId);
        //   }, 1000); // Wait 1 second to ensure data is stable
        // }
      } else {
        console.warn(`Failed to parse battery level from: ${data}`);
      }

    } catch (error) {
      console.error('Error parsing battery data:', error);
    }
  }

  // Adjust tag-specific optimizations based on tag battery level
  adjustTagOptimizationsForBattery(deviceId, batteryLevel) {
    console.log(`🔋 Tag ${deviceId} battery: ${batteryLevel}%`);
    
    // Tag battery only affects tag-specific optimizations, not phone power profile
    if (batteryLevel <= 15) {
      console.log(`🔋 Tag ${deviceId} battery critical - applying ultra-low power optimizations`);
      // Could implement tag-specific power saving here
    } else if (batteryLevel <= 30) {
      console.log(`🔋 Tag ${deviceId} battery low - applying low power optimizations`);
      // Could implement tag-specific power saving here
    } else if (batteryLevel >= 80) {
      console.log(`🔋 Tag ${deviceId} battery good - using normal optimizations`);
      // Could implement tag-specific power saving here
    }
  }

  // Get current profile name
  getCurrentProfileName() {
    if (this.profile === POWER_PROFILE.ultraLowPower) return 'ultraLowPower';
    if (this.profile === POWER_PROFILE.lowPower) return 'lowPower';
    return 'default';
  }



  // Start monitoring phone battery level
  startPhoneBatteryMonitoring() {
    try {
      // Try multiple battery detection methods
      this.detectPhoneBatteryLevel();
      
      // Set up periodic battery level checks as fallback
      setInterval(() => {
        this.detectPhoneBatteryLevel();
      }, 30000); // Check every 30 seconds
      
    } catch (error) {
      console.warn('⚠️ Could not start phone battery monitoring:', error);
      this.phoneBatteryLevel = 100; // Assume full battery
      this.setPowerProfile('default');
    }
  }

  // Detect phone battery level using multiple methods
  async detectPhoneBatteryLevel() {
    try {
      // Method 1: React Native DeviceInfo (most reliable for React Native)
      try {
        const batteryLevel = await DeviceInfo.getBatteryLevel();
        console.log('📱 Battery level:', batteryLevel); 
        const newLevel = Math.round(batteryLevel * 100);
        
        if (newLevel !== this.phoneBatteryLevel) {
          this.phoneBatteryLevel = newLevel;
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
          console.log(`📱 Phone battery updated via DeviceInfo: ${this.phoneBatteryLevel}%`);
        }
        
        console.log('📱 DeviceInfo battery monitoring started');
        
        return;
      } catch (e) {
        console.log('DeviceInfo not available, trying other methods');
      }
      
      // Method 2: Battery API (web fallback)
      if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        const newLevel = Math.round(battery.level * 100);
        
        if (newLevel !== this.phoneBatteryLevel) {
          this.phoneBatteryLevel = newLevel;
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
          console.log(`📱 Phone battery updated via Battery API: ${this.phoneBatteryLevel}%`);
        }
        
        // Set up event listeners for battery changes
        battery.addEventListener('levelchange', () => {
          this.phoneBatteryLevel = Math.round(battery.level * 100);
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
          console.log(`📱 Phone battery changed via Battery API: ${this.phoneBatteryLevel}%`);
        });
        
        battery.addEventListener('chargingchange', () => {
          this.phoneBatteryLevel = Math.round(battery.level * 100);
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
          console.log(`📱 Phone charging state changed: ${this.phoneBatteryLevel}%`);
        });
        
        return;
      }
      
      // Method 3: Manual input fallback
      if (this.phoneBatteryLevel === null || this.phoneBatteryLevel === 100) {
        console.log('⚠️ Could not detect phone battery automatically');
        console.log('💡 Please manually set battery level or check device compatibility');
        
        // Set a reasonable default based on current power profile
        if (this.profile === POWER_PROFILE.ultraLowPower) {
          this.phoneBatteryLevel = 20; // Assume low battery
        } else if (this.profile === POWER_PROFILE.lowPower) {
          this.phoneBatteryLevel = 50; // Assume medium battery
        } else {
          this.phoneBatteryLevel = 80; // Assume good battery
        }
        
        console.log(`📱 Set phone battery to estimated level: ${this.phoneBatteryLevel}%`);
      }
      
    } catch (error) {
      console.warn('⚠️ Error detecting phone battery level:', error);
    }
  }

  // Adjust phone power profile based on phone battery level
  adjustPhonePowerProfileForBattery(phoneBatteryLevel) {
    console.log(`📱 adjustPhonePowerProfileForBattery called with: ${phoneBatteryLevel}%`);
    
    let newProfile = 'default';
    
    if (phoneBatteryLevel <= 15) {
      newProfile = 'ultraLowPower';
      console.log(`📱 Phone battery critical (≤15%) - switching to ultra-low power mode`);
    } else if (phoneBatteryLevel <= 30) {
      newProfile = 'lowPower';
      console.log(`📱 Phone battery low (≤30%) - switching to low power mode`);
    } else if (phoneBatteryLevel >= 80) {
      newProfile = 'default';
      console.log(`📱 Phone battery good (≥80%) - switching to default power mode`);
    }

    console.log(`📱 Calculated new profile: ${newProfile}`);

    // Only change if different from current profile
    const currentProfileName = this.getCurrentProfileName();
    console.log(`📱 Current profile: ${currentProfileName}`);
    
    if (newProfile !== currentProfileName) {
      console.log(`📱 Profile change needed: ${currentProfileName} → ${newProfile}`);
      this.setPowerProfile(newProfile);
    } else {
      console.log(`📱 No profile change needed, already on ${currentProfileName}`);
    }
  }

  // Update API timing based on current power profile
  updateApiTimingForPowerProfile() {
    const profile = this.profile;
    
    // Update POST API intervals based on power profile (matching your requirements)
    if (profile === POWER_PROFILE.ultraLowPower) {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 60000;    // 60s intervals (4x slower)
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 240000;      // 240s intervals (4x slower)
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 240000; // 240s intervals (4x slower)
      
      // Update GET API intervals for ultra-low power mode
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 60000;        // 60s intervals (4x slower)
      this.getApiConfig.BACKGROUND_INTERVAL = 0;               // No calls when in background
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;           // No calls when screen not active
      
      console.log('⚡ POST/GET API timing updated for ultra-low power mode: 60s/240s intervals');
    } else if (profile === POWER_PROFILE.lowPower) {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;    // 30s intervals (2x slower)
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 120000;     // 120s intervals (2x slower)
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 120000; // 120s intervals (2x slower)
      
      // Update GET API intervals for low power mode
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;        // 30s intervals (2x slower)
      this.getApiConfig.BACKGROUND_INTERVAL = 0;               // No calls when in background
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;           // No calls when screen not active
      
      console.log('⚡ POST/GET API timing updated for low power mode: 30s/120s intervals');
    } else {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;    // 15s intervals (default)
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 60000;      // 60s intervals (default)
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 60000;  // 60s intervals (default)
      
      // Update GET API intervals for default mode
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;        // 15s intervals (default)
      this.getApiConfig.BACKGROUND_INTERVAL = 0;               // No calls when in background
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;           // No calls when screen not active
      
      console.log('⚡ POST/GET API timing updated for default power mode: 15s/60s intervals');
    }
  }

  // Get current phone battery level
  getPhoneBatteryLevel() {
    return this.phoneBatteryLevel;
  }







  // Handle data transfer
  handleDataTransfer(deviceId, data) {
    try {
      const parsedTransfer = BLEDataParser.parseDataTransfer(data);

      if (parsedTransfer) {
        console.log(`Data transfer for ${deviceId}:`, parsedTransfer);

        // Handle different transfer types
        switch (parsedTransfer.type) {
          case 'sync_start':
            console.log(`Data sync started for device ${deviceId}, total records: ${parsedTransfer.totalRecords}`);
            break;
          case 'sync_complete':
            console.log(`Data sync completed for device ${deviceId}, success: ${parsedTransfer.success}`);
            break;
          case 'record':
            console.log(`Received data record for device ${deviceId}:`, parsedTransfer);
            // Store record data if needed
            break;
          case 'read_error':
            console.log(`Data read error for device ${deviceId}, error code: ${parsedTransfer.errorCode}`);
            break;
          default:
            console.log(`Unknown data transfer type for device ${deviceId}:`, parsedTransfer);
        }
      }

    } catch (error) {
      console.error('Error handling data transfer:', error);
    }
  }

  // Handle system command responses
  handleSystemCommandResponse(deviceId, data) {
    try {
      const response = BLEDataParser.parseSystemCommandResponse(data);

      if (response && response.sddCompliant) {
        console.log(`System command response for device ${deviceId}:`, response);

        if (response.success) {
          console.log(`Command 0x${response.command.toString(16)} executed successfully`);

          // Handle specific command responses
          switch (response.command) {
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
              console.log('Firmware version response:', response.data?.version || 'Unknown');
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
              console.log('Hardware version response:', response.data?.version || 'Unknown');
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
              console.log('Diagnostics response:', response.data?.diagnostics || 'Unknown');
              break;
            default:
              console.log(`Response for command 0x${response.command.toString(16)}:`, response.data);
          }
        } else {
          console.warn(`Command 0x${response.command.toString(16)} failed with status: ${response.statusText}`);
        }
      } else {
        console.warn(`Invalid or non-SDD compliant system command response for device ${deviceId}`);
      }

    } catch (error) {
      console.error('Error handling system command response:', error);
    }
  }

  // Read characteristic value
  async readCharacteristic(deviceId, serviceUUID, characteristicUUID) {
    try {
      return await (this.operationQueue = this.operationQueue.then(async () => {
        if (Platform.OS === 'android') {
          // Use native Android characteristic reading
          const result = await SampleBridgeAndroid.readCharacteristicForService(
            deviceId, 
            serviceUUID, 
            characteristicUUID
          );
          return result;
        } else {
          // iOS uses BLE PLX characteristic reading
          const device = this.connectedDevices.get(deviceId);
          if (!device) {
            throw new Error('Device not connected');
          }

          const characteristic = await device.readCharacteristicForService(
            serviceUUID,
            characteristicUUID
          );

          return characteristic.value;
        }
      }));
    } catch (error) {
      if (error.message && error.message.includes('not found')) {
        console.log(`📭 Characteristic ${characteristicUUID} not available on device`);
        return null;
      }
      console.error('Error reading characteristic:', error);
      throw error;
    }
  }

  // Write characteristic value
  async writeCharacteristic(deviceId, characteristicUUID, data, withResponse = true, serviceUUID = null) {
    try {
      return await (this.operationQueue = this.operationQueue.then(async () => {
        if (Platform.OS === 'android') {
          // Use native Android characteristic writing
          // Ensure data is properly formatted as Uint8Array
          let dataToSend;
          if (data instanceof Uint8Array) {
            dataToSend = data;
          } else if (Array.isArray(data)) {
            dataToSend = new Uint8Array(data);
          } else {
            dataToSend = new Uint8Array(data);
          }
          
          // Convert to hex string for Android (Android expects hex, not base64)
          const hexData = Array.from(dataToSend)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
          
          console.log(`🤖 Writing to characteristic ${characteristicUUID} via Android`);
          console.log(`📦 Data length: ${dataToSend.length}, Hex: ${hexData}`);
          
          await SampleBridgeAndroid.writeCharacteristic(
            deviceId, 
            characteristicUUID, 
            hexData
          );
          console.log(`🤖 Wrote to characteristic ${characteristicUUID} via Android`);
          return true;
        } else {
          // iOS uses BLE PLX characteristic writing
          const device = this.connectedDevices.get(deviceId);
          if (!device) {
            throw new Error('Device not connected');
          }

          if (!serviceUUID) {
            throw new Error('Service UUID required for iOS');
          }

          // Ensure data is properly formatted as Uint8Array
          let dataToSend;
          if (data instanceof Uint8Array) {
            dataToSend = data;
          } else if (Array.isArray(data)) {
            dataToSend = new Uint8Array(data);
          } else {
            dataToSend = new Uint8Array(data);
          }

          const base64Data = Buffer.from(dataToSend).toString('base64');
          console.log(`🍎 Writing to characteristic ${characteristicUUID} via iOS`);
          console.log(`📦 Data length: ${dataToSend.length}, Base64: ${base64Data}`);

          if (withResponse) {
            await device.writeCharacteristicWithResponseForService(
              serviceUUID,
              characteristicUUID,
              base64Data
            );
          } else {
            await device.writeCharacteristicWithoutResponseForService(
              serviceUUID,
              characteristicUUID,
              base64Data
            );
          }
          console.log(`Wrote to characteristic ${characteristicUUID}`);
          return true;
        }
      }));
    } catch (error) {
      console.error('Error writing characteristic:', error);
      throw error;
    }
  }

  // Send system command (SDD compliant format)
  async sendSystemCommand(deviceId, command, payload = []) {
    try {
      console.log(`🔧 Attempting to send system command 0x${command.toString(16)} to device ${deviceId}`);

      // Ensure device is connected
      const device = this.connectedDevices.get(deviceId);
      if (!device) {
        console.log('❌ Device not connected for system command');
        return;
      }

      console.log('🔍 Checking for SMART_TAG service and SYSTEM_COMMAND characteristic...');

      let smartTagService, sysCmdChar;

      if (Platform.OS === 'android') {
        // For Android, check the device's services and characteristics arrays
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (!scannedDevice || !scannedDevice.services || !scannedDevice.characteristics) {
          console.log('📭 Device services/characteristics not available - skipping system command');
          return;
        }

        console.log('📋 Available services:', scannedDevice.services.map(s => s.uuid));
        
        // Find SMART_TAG service - use exact UUID matching
        smartTagService = scannedDevice.services.find(s => s.uuid === BLE_SERVICES.SMART_TAG);
        if (!smartTagService) {
          console.log('📭 SMART_TAG service not available on device - skipping system command');
          console.log('📋 Available services:', scannedDevice.services.map(s => s.uuid));
          return;
        }

        console.log('📋 SMART_TAG service characteristics:', scannedDevice.characteristics.filter(c => c.serviceUUID === smartTagService.uuid).map(c => c.uuid));
        
        // Find SYSTEM_COMMAND characteristic - use exact UUID matching
        sysCmdChar = scannedDevice.characteristics.find(c => 
          c.uuid === BLE_CHARACTERISTICS.SYSTEM_COMMAND &&
          c.serviceUUID === smartTagService.uuid
        );
        if (!sysCmdChar) {
          console.log('📭 SYSTEM_COMMAND characteristic not available on device - skipping system command');
          console.log('📋 Available characteristics:', scannedDevice.characteristics.map(c => c.uuid));
          return;
        }
      } else {
        // iOS uses BLE PLX methods
        const services = await device.services();
        console.log('📋 Available services:', services.map(s => s.uuid));

        smartTagService = services.find(s => s.uuid === BLE_SERVICES.SMART_TAG);
        if (!smartTagService) {
          console.log('📭 SMART_TAG service not available on device - skipping system command');
          return;
        }

        const chars = await smartTagService.characteristics();
        console.log('📋 SMART_TAG service characteristics:', chars.map(c => c.uuid));

        sysCmdChar = chars.find(c => c.uuid === BLE_CHARACTERISTICS.SYSTEM_COMMAND);
        if (!sysCmdChar) {
          console.log('📭 SYSTEM_COMMAND characteristic not available on device - skipping system command');
          return;
        }
      }

      console.log('✅ SYSTEM_COMMAND characteristic found, proceeding with command');

      const packet = new Array(SYSTEM_COMMAND_CONSTANTS.PACKET_SIZE).fill(0);

      // Some commands in the SDD specify "Length: 1, Data: No Data (0x00)".
      // If caller passed no payload for such commands, auto-fill a single 0x00 byte.
      const commandsRequiringZeroByte = new Set([
        SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION,
        SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION,
        SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS,
        SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START,
        SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART,
      ]);
      const payloadToSend = (Array.isArray(payload) ? payload : [])
        .slice(0); // shallow copy
      if (payloadToSend.length === 0 && commandsRequiringZeroByte.has(command)) {
        payloadToSend.push(0x00);
      }

      // Format according to SDD specification
      // Byte 0: Request ID (0xAA)
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.REQUEST_ID_OFFSET] = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;

      // Byte 1: Command ID
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_ID_OFFSET] = command;

      // Byte 2: Command Length
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_LENGTH_OFFSET] = payloadToSend.length;

      // Bytes 3-19: Command Data (up to 17 bytes)
      for (let i = 0; i < payloadToSend.length && i < 17; i++) {
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET + i] = payloadToSend[i];
      }

      const packetHex = packet.map(b => b.toString(16).padStart(2, '0')).join('');
      console.log(`📤 Sending system command 0x${command.toString(16)} with packet: ${packetHex}`);
      console.log(`📍 Target (discovered): Service=${smartTagService.uuid}, Characteristic=${sysCmdChar.uuid}`);
      console.log(`📦 Raw packet array:`, packet);

      // Convert packet array to Uint8Array for proper Buffer conversion
      const packetBytes = new Uint8Array(packet);
      console.log(`📦 Packet as Uint8Array:`, Array.from(packetBytes));

      // Use discovered UUIDs (exact casing as returned by OS) to avoid any mismatch
      await this.writeCharacteristic(
        deviceId,
        sysCmdChar.uuid, // Use characteristic UUID, not service UUID
        packetBytes,
        true, // Write with response to get acknowledgment
        smartTagService.uuid // Service UUID for iOS
      );

      console.log(`✅ Successfully sent system command 0x${command.toString(16)} to device ${deviceId}`);

    } catch (error) {
      console.error('❌ Error sending system command:', error);
      console.error('📍 Command details:', {
        deviceId,
        command: `0x${command.toString(16)}`,
        payload: payloadToSend,
        targetService: smartTagService?.uuid || BLE_SERVICES.SMART_TAG,
        targetCharacteristic: sysCmdChar?.uuid || BLE_CHARACTERISTICS.SYSTEM_COMMAND
      });
      // Don't throw - just log the error so other operations can continue
    }
  }



  // Manually read all important characteristics
  async readAllCharacteristics(deviceId) {
    console.log(`Reading all characteristics for device ${deviceId}`);

    const characteristicsToRead = [
      { service: BLE_SERVICES.BATTERY, characteristic: BLE_CHARACTERISTICS.BATTERY_LEVEL, name: 'Battery Level', optional: true },
      { service: BLE_SERVICES.SMART_TAG, characteristic: BLE_CHARACTERISTICS.DEVICE_STATUS, name: 'Device Status', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MANUFACTURER_NAME, name: 'Manufacturer', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MODEL_NUMBER, name: 'Model Number', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.FIRMWARE_REVISION, name: 'Firmware', optional: true },
    ];

    for (const { service, characteristic, name, optional } of characteristicsToRead) {
      try {
        // Skip optional characteristics if not discovered on this device
        if (optional) {
          if (Platform.OS === 'android') {
            // For Android, check if the characteristic exists in the device's characteristics array
            const device = this.scannedDevices.get(deviceId);
            if (device && device.characteristics) {
              const exists = device.characteristics.some(c => c.uuid.toLowerCase() === characteristic.toLowerCase());
              if (!exists) {
                console.log(`Skipping optional characteristic not found: ${name} (${characteristic})`);
                continue;
              }
            }
          } else {
            // iOS uses BLE PLX methods
            const device = this.connectedDevices.get(deviceId);
            const services = await device.services();
            const svc = services.find(s => s.uuid.toLowerCase() === service.toLowerCase());
            if (!svc) {
              continue;
            }
            const chars = await svc.characteristics();
            const exists = chars.some(c => c.uuid.toLowerCase() === characteristic.toLowerCase());
            if (!exists) {
              console.log(`Skipping optional characteristic not found: ${name} (${characteristic})`);
              continue;
            }
          }
        }
        const value = await this.readCharacteristic(deviceId, service, characteristic);
        if (value !== null) {
          console.log(`${name} (${characteristic}):`, value);

          // Process the data based on characteristic type
          if (characteristic === BLE_CHARACTERISTICS.BATTERY_LEVEL) {
            this.handleBatteryUpdate(deviceId, value);
          } else if (characteristic === BLE_CHARACTERISTICS.DEVICE_STATUS) {
            this.handleDeviceStatusUpdate(deviceId, value);
          }
        }
      } catch (error) {
        console.log(`Cannot read ${name} (${characteristic}):`, error.message);
      }
    }
  }

  // Request device to send current data
  async requestDeviceData(deviceId) {
    try {
      console.log(`Requesting current data from device ${deviceId}`);

      // Try to read all characteristics first
      await this.readAllCharacteristics(deviceId);

      // Send a command to request current status if the device supports it
      try {
        await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS);
      } catch (error) {
        console.log('Device may not support diagnostics command:', error.message);
      }

    } catch (error) {
      console.error('Error requesting device data:', error);
    }
  }

  // Get scanned devices
  getScannedDevices() {
    return Array.from(this.scannedDevices.values());
  }

  // Get all devices (verified tags + nearby tags)
  getAllDevices() {
    const verifiedDevices = Array.from(this.scannedDevices.values());
    const nearbyDevices = this.getNearbyTags();

    return {
      verified: verifiedDevices.filter(d => d.isVerified === true),
      nearby: nearbyDevices,
      all: [...verifiedDevices, ...nearbyDevices]
    };
  }

  // Get connected devices
  getConnectedDevices() {
    return Array.from(this.scannedDevices.values()).filter(
      device => device.connectionState === CONNECTION_STATES.CONNECTED
    );
  }

  // Get device by ID
  getDevice(deviceId) {
    // Prefer scanned snapshot
    const fromScanned = this.scannedDevices.get(deviceId);
    if (fromScanned) return fromScanned;
    // Fallback: synthesize from connectedDevices if available
    const rnDevice = this.connectedDevices.get(deviceId);
    if (rnDevice) {
      return {
        id: deviceId,
        name: rnDevice.name || 'Unknown Device',
        connectionState: CONNECTION_STATES.CONNECTED,
        deviceData: this.deviceDataStore?.get?.(deviceId) || {},
      };
    }
    return null;
  }

  // Set callback for device data updates (for UI refresh)
  setDeviceDataUpdateCallback = (callback) => {
    this.onDeviceDataUpdated = callback;
    console.log('Device data update callback set:', typeof callback);
  }

  // Set device list update callback (for UI refresh when devices connect/disconnect)
  setDeviceListUpdateCallback = (callback) => {
    this.onDeviceListUpdated = callback;
    console.log('Device list update callback set:', typeof callback);

    // If there's a pending auto-connect event, trigger it now
    if (callback && this.pendingAutoConnectDevice) {
      console.log('🔄 Processing pending auto-connect device for UI refresh');
      setTimeout(() => {
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      }, 500); // Small delay to let UI settle
      this.pendingAutoConnectDevice = null;
    }
  }

  // Force refresh of device data in UI
  triggerDeviceDataRefresh = (deviceId) => {
    const device = this.scannedDevices.get(deviceId);
    if (device && this.onDeviceDataUpdated) {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    }
  }

  // =================== RSSI POLLING ===================
  startRSSIPolling(deviceId) {
    if (!this.rssiTimers) this.rssiTimers = new Map();
    if (this.rssiTimers.has(deviceId)) return;
    const poll = async () => {
      try {
        const device = this.connectedDevices.get(deviceId);
        if (!device) return;
        
        let updated;
        if (Platform.OS === 'android') {
          // Use native Android RSSI reading
          try {
            updated = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          } catch (error) {
            console.log(`📡 Android RSSI polling failed for ${deviceId}:`, error.message);
            return;
          }
        } else {
          // iOS uses BLE PLX RSSI reading
          updated = await device.readRSSI();
        }
        
        // Handle RSSI object vs number
        const rssiValue = typeof updated === 'object' ? updated.rssi : updated;
        
        const entry = this.scannedDevices.get(deviceId) || { id: deviceId, name: updated?.name, connectionState: CONNECTION_STATES.CONNECTED, deviceData: {} };
        entry.rssi = rssiValue ?? entry.rssi;
        this.scannedDevices.set(deviceId, entry);

        // Update connection quality metrics
        this.updateConnectionQuality(deviceId, entry.rssi);

        // Start adaptive scanning if RSSI indicates proximity change
        this.startAdaptiveScanning(deviceId);

        if (this.onDeviceListUpdated) this.onDeviceListUpdated();
      } catch (error) {
        console.warn(`⚠️ RSSI polling failed for ${deviceId}:`, error?.message || error);
      }
    };
    const timer = setInterval(poll, 15000); // Increased to 15 seconds for battery optimization
    this.rssiTimers.set(deviceId, timer);
    poll();
  }

  stopRSSIPolling(deviceId) {
    if (!this.rssiTimers) return;
    const timer = this.rssiTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.rssiTimers.delete(deviceId);
    }
  }

  // Get device data with fresh copy
  getDeviceDataFresh = (deviceId) => {
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      return {
        ...device,
        deviceData: { ...device.deviceData }
      };
    }
    return null;
  }

  // Check notification status for debugging
  getNotificationStatus = (deviceId) => {
    const activeSubscriptions = [];
    for (const [key, subscription] of this.monitoringSubscriptions.entries()) {
      if (key.startsWith(deviceId)) {
        activeSubscriptions.push(key);
      }
    }

    console.log(`📡 Notification Status for ${deviceId}:`);
    console.log(`  Active subscriptions: ${activeSubscriptions.length}`);
    activeSubscriptions.forEach(sub => console.log(`    - ${sub}`));

    return {
      deviceId,
      activeSubscriptions: activeSubscriptions.length,
      subscriptions: activeSubscriptions
    };
  }

  // ==================== AUTO-CONNECT FUNCTIONALITY ====================

  // Setup auto-connect callbacks
  setupAutoConnectCallbacks() {
    if (Platform.OS === 'ios') {
      AutoConnectService.addDeviceConnectedCallback(this.handleAutoConnectedDevice);
      AutoConnectService.addDeviceDisconnectedCallback(this.handleAutoDisconnectedDevice);
      console.log('🔗 Auto-connect callbacks setup complete');

      // Ensure callbacks are registered with native module
      setTimeout(async () => {
        try {
          await AutoConnectService.ensureCallbacksRegistered();
        } catch (error) {
          console.warn('⚠️ Could not ensure callback registration:', error.message);
        }
      }, 1000); // Wait 1 second for React Native to be fully ready
    }
  }



  // Handle device connected via auto-connect
  handleAutoConnectedDevice = (deviceInfo) => {
    console.log('🔗 Auto-connected device detected:', deviceInfo);

    // TODO: IMPLEMENT TAG VERIFICATION FOR AUTO-CONNECT
    // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
    /*
    // Verify if this is user's purchased tag before allowing auto-connect
    const isVerified = await this.isVerifiedTag(deviceInfo.deviceId, deviceInfo.deviceName);
    if (!isVerified) {
      console.log('⚠️ Auto-connect blocked: Unverified tag detected:', deviceInfo.deviceName);
      
      // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
      // Read location data from nearby tag without full connection
      // await this.handleNearbyTag(deviceInfo.deviceId, deviceInfo.deviceName);
      
      // Disconnect immediately - don't allow auto-connect to unverified tags
      try {
        const device = await this.manager.connectToDevice(deviceInfo.deviceId, { timeout: 3000 });
        await device.cancelConnection();
        console.log('✅ Disconnected from unverified auto-connect tag');
      } catch (error) {
        console.warn('⚠️ Could not disconnect from unverified tag:', error.message);
      }
      return; // Exit early - don't proceed with connection
    }
    
    console.log('✅ Auto-connect allowed: Verified tag detected:', deviceInfo.deviceName);
    */

    // Update our internal state to reflect the auto-connection
    const device = {
      id: deviceInfo.deviceId,
      name: deviceInfo.deviceName,
      connectionState: CONNECTION_STATES.CONNECTED,
      connectionType: 'auto',
      connectedAt: new Date(),
      deviceData: {},
      services: [],
      characteristics: [],
      isSmartTag: deviceInfo.deviceName?.includes('Health Tag') || deviceInfo.deviceName?.includes('Smart Tag'),
      // TODO: Set isVerified when verification is implemented
      isVerified: true, // Temporarily set to true for now
      rssi: null
    };

    this.scannedDevices.set(deviceInfo.deviceId, device);

    // Try to acquire a react-native-ble-plx Device handle and add to connected devices
    setTimeout(async () => {
      try {
        // First try to fetch a connected device reference
        const connectedPeripherals = await this.manager.connectedDevices([]);
        let rnDevice = connectedPeripherals.find(p => p.id === deviceInfo.deviceId);

        // If not found, proactively connect via BLE-PLX to obtain a handle
        if (!rnDevice) {
          console.warn('⚠️ Auto-connected device not found in BLE manager connected devices, attempting to connect via BLE-PLX');
          try {
            rnDevice = await this.manager.connectToDevice(deviceInfo.deviceId, { timeout: 8000, autoConnect: false });
            console.log('✅ BLE-PLX connected to auto-connected device');
          } catch (connectErr) {
            console.warn('⚠️ BLE-PLX connect attempt failed (may already be connected by native):', connectErr.message);
          }
        }

        if (rnDevice) {
          this.connectedDevices.set(deviceInfo.deviceId, rnDevice);

          // Discover and subscribe
          try {
            await rnDevice.discoverAllServicesAndCharacteristics();
            await this.loadDeviceServices(deviceInfo.deviceId);
            console.log('✅ Loaded services for auto-connected device');

            // Measure initial RSSI and set connection quality for auto-connected device
            try {
              const initialRssi = await rnDevice.readRSSI();
              if (initialRssi !== null && initialRssi !== undefined) {
                // Handle RSSI object vs number
                const rssiValue = typeof initialRssi === 'object' ? initialRssi.rssi : initialRssi;
                if (rssiValue !== null && rssiValue !== undefined) {
                  console.log(`📡 Initial RSSI for auto-connected device ${deviceInfo.deviceId}: ${rssiValue}dBm`);
                  this.checkRssiConnectionQuality(deviceInfo.deviceId, rssiValue);
                } else {
                  console.warn(`⚠️ Invalid RSSI value for auto-connected device ${deviceInfo.deviceId}:`, initialRssi);
                }
              }
            } catch (rssiError) {
              console.warn(`⚠️ Could not read initial RSSI for auto-connected device ${deviceInfo.deviceId}:`, rssiError?.message || rssiError);
            }

            console.log('✅ Auto-connected device ready for monitoring');

            // Request initial data after a short delay
            setTimeout(() => {
              this.requestDeviceData(deviceInfo.deviceId);
            }, 1000);

            // Send pet health data to server after auto-connection (with longer delay to ensure data is available)
            setTimeout(() => {
              this.sendPetHealthDataToServer(deviceInfo.deviceId);
            }, 5000); // Wait 5 seconds after auto-connection to ensure data is available

            // Start adaptive API calling for auto-connected device
            setTimeout(() => {
              console.log(`🔄 Starting adaptive API calling for device ${deviceInfo.deviceId} after auto-connection`);
              this.startAdaptiveApiCalling(deviceInfo.deviceId);
            }, 7000); // Start adaptive API calling 7 seconds after auto-connection

            // Start periodic RSSI polling for auto-connected device
            this.startRSSIPolling(deviceInfo.deviceId);
          } catch (serviceError) {
            console.warn('⚠️ Could not load services/monitoring for auto-connected device:', serviceError.message);
          }
        }
      } catch (error) {
        console.warn('⚠️ Error integrating auto-connected device with BLE manager:', error.message);
      }
    }, 2000); // Wait 2 seconds for the BLE connection to stabilize

    console.log(`✅ Auto-connected device ${deviceInfo.deviceName} registered in BLE service`);

    // Trigger device list update callback to refresh UI immediately
    if (this.onDeviceListUpdated) {
      console.log('🔄 Triggering device list update for UI refresh (immediate)');
      this.onDeviceListUpdated();
    } else {
      console.warn('⚠️ No device list update callback registered - will retry when UI mounts');
      // Store the auto-connect event for later when UI mounts
      this.pendingAutoConnectDevice = deviceInfo;
    }

    // Also trigger after BLE integration attempts complete
    setTimeout(() => {
      if (this.onDeviceListUpdated) {
        console.log('🔄 Triggering device list update for UI refresh (delayed)');
        this.onDeviceListUpdated();
      }
    }, 3000);

    // Also trigger device data update callback
    if (this.onDeviceDataUpdated) {
      this.onDeviceDataUpdated(deviceInfo.deviceId, device);
    }
  }

  // Handle device disconnected via auto-connect
  handleAutoDisconnectedDevice = (deviceInfo) => {
    console.log('💔 Physical disconnect detected:', deviceInfo);

    const device = this.scannedDevices.get(deviceInfo.deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.disconnectedAt = new Date();
      device.lastSeen = Date.now(); // Set lastSeen so device is preserved in scans
      device.disconnectReason = 'Physical disconnect'; // Track why it disconnected
      // PRESERVE RSSI so device remains visible and can be found in scans
      // device.rssi is kept intact - don't clear it
      this.scannedDevices.set(deviceInfo.deviceId, device);

      // Remove from connected devices
      this.connectedDevices.delete(deviceInfo.deviceId);

      // Stop any monitoring subscriptions
      this.stopMonitoring(deviceInfo.deviceId);

      // Stop connection health check if no more devices
      if (this.connectedDevices.size === 0) {
        this.stopConnectionHealthCheck();
      }

      console.log('✅ Physical disconnect handled for device:', deviceInfo.deviceName);
      console.log('📊 Physical disconnect device state:', {
        id: deviceInfo.deviceId,
        name: device.name,
        connectionState: device.connectionState,
        lastSeen: device.lastSeen,
        rssi: device.rssi, // Log RSSI to confirm it's preserved
        disconnectReason: device.disconnectReason,
        isSmartTag: device.isSmartTag || false
      });
      console.log('📱 scannedDevices now contains:', Array.from(this.scannedDevices.keys()).length, 'devices');
    } else {
      console.warn('⚠️ Physical disconnect for device not in scannedDevices:', deviceInfo.deviceName);
      // Create entry for device that wasn't in scannedDevices
      const newDevice = {
        id: deviceInfo.deviceId,
        name: deviceInfo.deviceName,
        connectionState: CONNECTION_STATES.DISCONNECTED,
        lastSeen: Date.now(),
        disconnectedAt: new Date(),
        disconnectReason: 'Physical disconnect',
        isSmartTag: deviceInfo.deviceName?.toLowerCase().includes('tag') || false,
        deviceData: {}
      };
      this.scannedDevices.set(deviceInfo.deviceId, newDevice);
      console.log('📝 Created new device entry for physical disconnect:', deviceInfo.deviceName);
    }

    // Force UI refresh immediately
    console.log('🔄 Forcing immediate UI refresh for physical disconnect');
    this.scheduleListUpdate();

    // Kick auto-connect machinery from JS side as well (best-effort)
    setTimeout(async () => {
      try {
        const status = await this.getAutoConnectStatus();
        if (status.success && status.status.enabled) {
          console.log('🔁 JS-side reconnect attempt: known peripherals + force scan');
          try { await this.connectToKnownPeripherals(); } catch { }
          try { await this.forceScanForBondedDevices(); } catch { }
        }
      } catch { }
    }, 1000);

    console.log(`💔 Physical disconnect for ${deviceInfo.deviceName} processed`);
  }

  // Start periodic connection health check
  startConnectionHealthCheck() {
    if (this.connectionHealthTimer) return;

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.healthCheckMs || 10000;
    console.log(`💓 Starting connection health check - Profile: ${currentProfile}, Interval: ${interval}ms`);
    
    this.connectionHealthTimer = setInterval(async () => {
      try {
        await this.checkConnectionHealth();
      } catch (error) {
        console.warn('Connection health check error:', error.message);
      }
    }, interval); // Use profile-based timing
    
    // Start RSSI cycle when health checks start
    const rssiInterval = this.profile.rssiCycleIntervalMs || 30000;
    console.log(`💓 Starting RSSI cycle from health check start - Profile: ${currentProfile}, RSSI Interval: ${rssiInterval}ms`);
    this.startRssiCycle();
  }



  // Stop connection health check
  stopConnectionHealthCheck() {
    if (this.connectionHealthTimer) {
      clearInterval(this.connectionHealthTimer);
      this.connectionHealthTimer = null;
      const currentProfile = this.getCurrentProfileName();
      console.log(`💓 Stopped connection health check - Profile: ${currentProfile}`);
    }
    
    // Stop RSSI cycle when health checks stop
    const currentProfile = this.getCurrentProfileName();
    console.log(`💓 Stopping RSSI cycle from health check stop - Profile: ${currentProfile}`);
    this.stopRssiCycle();
  }

  // Check if connected devices are actually still connected
  async checkConnectionHealth() {
    const connectedDeviceIds = Array.from(this.connectedDevices.keys());
    if (connectedDeviceIds.length === 0) return;

    console.log(`💓 Checking health of ${connectedDeviceIds.length} connected devices`);

    for (const deviceId of connectedDeviceIds) {
      try {
        const device = this.connectedDevices.get(deviceId);
        if (!device) continue;

        // Try to read RSSI as a connection health check and measure quality
        let rssi;
        if (Platform.OS === 'android') {
          // Use native Android RSSI reading for health check
          try {
            const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
            rssi = result;
            console.log(`💓 Device ${deviceId} is healthy (Android), RSSI: ${rssi}dBm`);
          } catch (error) {
            console.log(`💔 Android RSSI health check failed for ${deviceId}:`, error.message);
            throw error; // Re-throw to trigger disconnect handling
          }
        } else {
          // iOS uses BLE PLX RSSI reading
          rssi = await device.readRSSI();
          console.log(`💓 Device ${deviceId} is healthy (iOS), RSSI: ${rssi}dBm`);
        }
        
        // Update connection quality based on RSSI
        if (rssi !== null && rssi !== undefined) {
          this.checkRssiConnectionQuality(deviceId, rssi);
        }
      } catch (error) {
        console.log(`💔 Device ${deviceId} appears disconnected during health check:`, error.message);

        // Simulate auto-disconnect callback for stale connections
        const deviceInfo = this.scannedDevices.get(deviceId);
        if (deviceInfo) {
          this.handleAutoDisconnectedDevice({
            deviceId: deviceId,
            deviceName: deviceInfo.name || 'Unknown Device',
            error: 'Health check failed'
          });
        }
      }
    }
  }

  // Start auto-connect functionality
  async startAutoConnect() {
    try {
      console.log('🚀 Starting auto-connect functionality...');
      const result = await AutoConnectService.startAutoConnect();

      if (result.success) {
        console.log('✅ Auto-connect started successfully');
        return { success: true, message: 'Auto-connect started' };
      } else {
        console.error('❌ Failed to start auto-connect:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Auto-connect start error:', error);
      return { success: false, error: error.message };
    }
  }

  // Stop auto-connect functionality
  async stopAutoConnect() {
    try {
      console.log('🛑 Stopping auto-connect functionality...');
      const result = await AutoConnectService.stopAutoConnect();

      if (result.success) {
        console.log('✅ Auto-connect stopped successfully');
        return { success: true, message: 'Auto-connect stopped' };
      } else {
        console.error('❌ Failed to stop auto-connect:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Auto-connect stop error:', error);
      return { success: false, error: error.message };
    }
  }

  // Add device to bonded list (call after successful manual connection)
  async addDeviceToBondedList(deviceId) {
    try {
      console.log(`✅ Adding device ${deviceId} to bonded list...`);
      const result = await AutoConnectService.addBondedDevice(deviceId);

      if (result.success) {
        console.log(`✅ Device ${deviceId} added to bonded list`);
        return { success: true, message: 'Device bonded for auto-connect' };
      } else {
        console.error('❌ Failed to bond device:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Bond device error:', error);
      return { success: false, error: error.message };
    }
  }

  // Remove device from bonded list
  async removeDeviceFromBondedList(deviceId) {
    try {
      console.log(`❌ Removing device ${deviceId} from bonded list...`);
      const result = await AutoConnectService.removeBondedDevice(deviceId);

      if (result.success) {
        console.log(`✅ Device ${deviceId} removed from bonded list`);
        return { success: true, message: 'Device unbonded from auto-connect' };
      } else {
        console.error('❌ Failed to unbond device:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Unbond device error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get bonded devices list
  async getBondedDevices() {
    try {
      const result = await AutoConnectService.getBondedDevices();

      if (result.success) {
        console.log('📱 Bonded devices:', result.devices);
        return { success: true, devices: result.devices };
      } else {
        console.error('❌ Failed to get bonded devices:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Get bonded devices error:', error);
      return { success: false, error: error.message };
    }
  }

  // Get auto-connect status
  async getAutoConnectStatus() {
    try {
      const result = await AutoConnectService.getAutoConnectStatus();

      if (result.success) {
        console.log('📊 Auto-connect status:', result.status);
        return { success: true, status: result.status };
      } else {
        console.error('❌ Failed to get auto-connect status:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Get auto-connect status error:', error);
      return { success: false, error: error.message };
    }
  }

  // Check if device is bonded for auto-connect
  isDeviceBonded(deviceId) {
    return AutoConnectService.isDeviceBonded(deviceId);
  }

  // Mark a device ID as known so discovery accepts it even without a name
  markDeviceKnown(deviceId) {
    try { this.knownDeviceIds.add(deviceId); } catch { }
  }

  // Force scan for debugging auto-connect issues
  async forceScanForBondedDevices() {
    try {
      console.log('🔍 Force scanning for bonded devices...');
      const result = await AutoConnectService.forceScanForBondedDevices();

      if (result.success) {
        console.log('✅ Force scan started successfully');
        return { success: true, message: 'Force scan started - check logs for 10 seconds' };
      } else {
        console.error('❌ Failed to start force scan:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Force scan error:', error);
      return { success: false, error: error.message };
    }
  }

  // Force refresh of all devices by starting a new scan
  async forceRefreshDeviceList() {
    try {
      console.log('🔄 Force refreshing device list...');

      // Start a fresh scan to rediscover all devices
      await this.startScanning();

      // Stop scan after 10 seconds to avoid excessive battery usage
      setTimeout(() => {
        if (this.scanState === SCAN_STATES.SCANNING) {
          this.stopScanning();
          console.log('✅ Force refresh scan completed');
        }
      }, 10000);

      return { success: true, message: 'Device list refresh initiated' };
    } catch (error) {
      console.error('❌ Force refresh device list error:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== INDUSTRY STANDARD IMPROVEMENTS ====================

  // 1. Exponential Backoff Reconnection
  startExponentialBackoffReconnection(deviceId) {
    if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
      return; // Already reconnecting
    }

    if (!this.reconnectionTimers) this.reconnectionTimers = new Map();
    if (!this.reconnectionAttempts) this.reconnectionAttempts = new Map();

    const attempt = this.reconnectionAttempts.get(deviceId) || 0;
    const maxAttempts = 3; // Max 3 attempts
    const baseDelay = 2000; // 2 seconds base
    const maxDelay = 60000; // 1 minute max
    const jitter = Math.random() * 1000; // Add randomness to prevent thundering herd

    if (attempt >= maxAttempts) {
      console.log(`🚫 Max reconnection attempts (${maxAttempts}) reached for device: ${deviceId}`);
      return;
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);
    console.log(`🔄 Scheduling reconnection attempt ${attempt + 1}/${maxAttempts} for device ${deviceId} in ${Math.round(delay / 1000)}s`);

    const timer = setTimeout(async () => {
      try {
        if (this.manualDisconnectCooldown.has(deviceId)) {
          console.log(`🔄 Attempting reconnection ${attempt + 1}/${maxAttempts} for device: ${deviceId}`);

          // Try direct connection first
          const connectResult = await this.connectToKnownPeripherals();
          if (connectResult.attempted > 0) {
            console.log(`✅ Reconnection attempt ${attempt + 1} started for device: ${deviceId}`);
            this.reconnectionAttempts.delete(deviceId);
            return;
          }

          // Fallback to scanning
          await this.forceScanForBondedDevices();

          // Schedule next attempt
          this.reconnectionAttempts.set(deviceId, attempt + 1);
          this.startExponentialBackoffReconnection(deviceId);
        } else {
          console.log(`🚫 Manual disconnect cooldown cleared - stopping reconnection for device: ${deviceId}`);
          this.reconnectionAttempts.delete(deviceId);
        }
      } catch (error) {
        console.warn(`⚠️ Reconnection attempt ${attempt + 1} failed for device ${deviceId}:`, error.message);
        // Schedule next attempt
        this.reconnectionAttempts.set(deviceId, attempt + 1);
        this.startExponentialBackoffReconnection(deviceId);
      }
    }, delay);

    this.reconnectionTimers.set(deviceId, timer);
  }

  // 2. Connection Pooling for Multiple Devices
  connectionPool = new Map(); // deviceId -> connection metadata

  async acquireConnection(deviceId, priority = 'normal') {
    const pool = this.connectionPool.get(deviceId) || {
      maxConnections: 3,
      currentConnections: 0,
      queue: [],
      lastUsed: Date.now()
    };

    if (pool.currentConnections < pool.maxConnections) {
      pool.currentConnections++;
      pool.lastUsed = Date.now();
      this.connectionPool.set(deviceId, pool);
      return true;
    }

    // Add to queue with priority
    const queueItem = { priority, timestamp: Date.now() };
    pool.queue.push(queueItem);
    pool.queue.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority === 'low' && b.priority !== 'low') return 1;
      return a.timestamp - b.timestamp; // FIFO for same priority
    });

    this.connectionPool.set(deviceId, pool);
    return false; // Connection not available
  }

  releaseConnection(deviceId) {
    const pool = this.connectionPool.get(deviceId);
    if (pool && pool.currentConnections > 0) {
      pool.currentConnections--;

      // Process queued requests
      if (pool.queue.length > 0) {
        const nextRequest = pool.queue.shift();
        pool.currentConnections++;
        console.log(`🔄 Processing queued connection request for device: ${deviceId}`);
      }

      this.connectionPool.set(deviceId, pool);
    }
  }

  // 3. Adaptive Scanning Based on Device Proximity
  adaptiveScanConfig = {
    nearDevice: { interval: 5000, duration: 10000, power: 'LowLatency' },
    mediumDevice: { interval: 15000, duration: 15000, power: 'Balanced' },
    farDevice: { interval: 30000, duration: 20000, power: 'LowPower' }
  };

  getProximityLevel(rssi) {
    if (rssi > -50) return 'nearDevice';
    if (rssi > -70) return 'mediumDevice';
    return 'farDevice';
  }

  startAdaptiveScanning(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device || !device.rssi) return;

    const proximity = this.getProximityLevel(device.rssi);
    const config = this.adaptiveScanConfig[proximity];

    console.log(`📡 Starting adaptive scan for device ${deviceId} (${proximity} proximity, RSSI: ${device.rssi})`);

    // Adjust scan parameters based on proximity
    this.startScanning(
      null, // onDeviceFound
      null, // onError
      config.duration,
      config.power
    );
  }

  // 4. Connection Health Monitoring with Heartbeat
  startHeartbeatMonitoring(deviceId) {
    if (this.heartbeatTimers && this.heartbeatTimers.has(deviceId)) return;

    if (!this.heartbeatTimers) this.heartbeatTimers = new Map();
    if (!this.heartbeatCounters) this.heartbeatCounters = new Map();

    const heartbeatInterval = 60000; // 60 seconds (less aggressive)
    const maxMissedHeartbeats = 5; // Allow more missed heartbeats

    const timer = setInterval(async () => {
      try {
        const device = this.connectedDevices.get(deviceId);
        if (!device) {
          this.stopHeartbeatMonitoring(deviceId);
          return;
        }

        // Send heartbeat (read a simple characteristic)
        // On Android, use a more reliable heartbeat method
        if (Platform.OS === 'android') {
          // For Android, try RSSI reading first (more reliable)
          try {
            await device.readRSSI();
          } catch (rssiError) {
            // Fallback to characteristic reading
            await device.readCharacteristicForService(
              BLE_SERVICES.BATTERY,
              BLE_CHARACTERISTICS.BATTERY_LEVEL
            );
          }
        } else {
          // iOS uses characteristic reading
          await device.readCharacteristicForService(
            BLE_SERVICES.BATTERY,
            BLE_CHARACTERISTICS.BATTERY_LEVEL
          );
        }

        // Reset missed heartbeat counter
        this.heartbeatCounters.set(deviceId, 0);
        console.log(`💓 Heartbeat successful for device: ${deviceId}`);
      } catch (error) {
        const missedCount = (this.heartbeatCounters.get(deviceId) || 0) + 1;
        this.heartbeatCounters.set(deviceId, missedCount);

        console.warn(`💔 Heartbeat failed for device ${deviceId} (missed: ${missedCount}/${maxMissedHeartbeats})`);

        if (missedCount >= maxMissedHeartbeats) {
          console.error(`💀 Device ${deviceId} failed heartbeat threshold - marking as disconnected`);
          this.handleAutoDisconnectedDevice({
            deviceId,
            deviceName: 'Unknown Device',
            error: 'Heartbeat timeout'
          });
        }
      }
    }, heartbeatInterval);

    this.heartbeatTimers.set(deviceId, timer);
    console.log(`💓 Started heartbeat monitoring for device: ${deviceId}`);
  }

  stopHeartbeatMonitoring(deviceId) {
    if (!this.heartbeatTimers) return;

    const timer = this.heartbeatTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(deviceId);
      this.heartbeatCounters.delete(deviceId);
      console.log(`💓 Stopped heartbeat monitoring for device: ${deviceId}`);
    }
  }

  // 5. Proper MTU Negotiation
  async negotiateMTU(deviceId, preferredMTU = 512) {
    try {
      const device = this.connectedDevices.get(deviceId);
      if (!device) return false;

      const currentMTU = await device.mtu();
      console.log(`📏 Current MTU for device ${deviceId}: ${currentMTU}`);

      if (currentMTU < preferredMTU) {
        const newMTU = await device.requestMTU(preferredMTU);
        console.log(`📏 MTU negotiated for device ${deviceId}: ${currentMTU} → ${newMTU}`);
        return newMTU >= preferredMTU;
      }

      return true;
    } catch (error) {
      console.warn(`⚠️ MTU negotiation failed for device ${deviceId}:`, error.message);
      return false;
    }
  }

  // 6. Connection Quality Metrics
  connectionQualityMetrics = new Map(); // deviceId -> metrics

  updateConnectionQuality(deviceId, rssi, packetLoss = 0) {
    const metrics = this.connectionQualityMetrics.get(deviceId) || {
      rssiHistory: [],
      packetLossHistory: [],
      connectionStability: 100,
      lastUpdate: Date.now()
    };

    // Update RSSI history (keep last 10 readings)
    metrics.rssiHistory.push({ rssi, timestamp: Date.now() });
    if (metrics.rssiHistory.length > 10) {
      metrics.rssiHistory.shift();
    }

    // Update packet loss history
    metrics.packetLossHistory.push({ packetLoss, timestamp: Date.now() });
    if (metrics.packetLossHistory.length > 10) {
      metrics.packetLossHistory.shift();
    }

    // Calculate connection stability score
    const avgRssi = metrics.rssiHistory.reduce((sum, reading) => sum + reading.rssi, 0) / metrics.rssiHistory.length;
    const avgPacketLoss = metrics.packetLossHistory.reduce((sum, reading) => sum + reading.packetLoss, 0) / metrics.packetLossHistory.length;

    let stabilityScore = 100;
    if (avgRssi < -80) stabilityScore -= 20;
    if (avgRssi < -70) stabilityScore -= 10;
    if (avgPacketLoss > 0.1) stabilityScore -= 30;
    if (avgPacketLoss > 0.05) stabilityScore -= 15;

    metrics.connectionStability = Math.max(0, Math.min(100, stabilityScore));
    metrics.lastUpdate = Date.now();

    this.connectionQualityMetrics.set(deviceId, metrics);

    // Log quality changes
    if (metrics.connectionStability < 50) {
      console.warn(`⚠️ Poor connection quality for device ${deviceId}: Stability ${metrics.connectionStability}%, Avg RSSI ${avgRssi.toFixed(1)}, Packet Loss ${(avgPacketLoss * 100).toFixed(1)}%`);
    }
  }

  getConnectionQuality(deviceId) {
    return this.connectionQualityMetrics.get(deviceId) || {
      connectionStability: 100,
      avgRssi: null,
      avgPacketLoss: 0,
      lastUpdate: null
    };
  }

  async debugConnectionStatus() {
    try {
      console.log('🐛 Getting debug connection status...');
      const result = await AutoConnectService.debugConnectionStatus();

      if (result.success) {
        console.log('✅ Debug status retrieved successfully');
        return { success: true, data: result.result };
      } else {
        console.error('❌ Failed to get debug status:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Debug status error:', error);
      return { success: false, error: error.message };
    }
  }

  async connectToKnownPeripherals() {
    try {
      console.log('🔗 Connecting to known bonded peripherals...');
      const result = await AutoConnectService.connectToKnownPeripherals();

      if (result.success) {
        console.log('✅ Connection attempts started:', result.result);
        return {
          success: true,
          message: `Started ${result.result.attempted} connection attempts to known peripherals`,
          attempted: result.result.attempted,
          knownPeripherals: result.result.knownPeripherals
        };
      } else {
        console.error('❌ Failed to connect to known peripherals:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('❌ Connect to known peripherals error:', error);
      return { success: false, error: error.message };
    }
  }

  async checkAndStartAutoScan() {
    // Only on iOS
    if (Platform.OS !== 'ios') {
      return;
    }

    try {
      // Wait a bit for initialization to complete
      setTimeout(async () => {
        console.log('🔍 Checking if auto-scan should start on app startup...');

        // Check if auto-connect is enabled (with retry logic)
        let autoConnectStatus = await this.getAutoConnectStatus();

        // If auto-connect shows as disabled, it might be a timing issue - retry after starting it
        if (!autoConnectStatus.enabled) {
          console.log('⚠️ Auto-connect appears disabled - attempting to start it first...');
          await this.startAutoConnect();

          // Check again after starting
          autoConnectStatus = await this.getAutoConnectStatus();
          if (!autoConnectStatus.enabled) {
            console.log('⚠️ Auto-connect still disabled after startup attempt - skipping startup scan');
            return;
          } else {
            console.log('✅ Auto-connect enabled after startup');
          }
        }

        // Check if there are any bonded devices
        const bondedDevices = await this.getBondedDevices();
        if (bondedDevices.length === 0) {
          console.log('⚠️ No bonded devices - skipping startup scan');
          return;
        }

        // Check if we already have connected devices
        const connectedCount = this.connectedDevices.size;
        if (connectedCount > 0) {
          console.log(`ℹ️ Already have ${connectedCount} connected devices - skipping startup scan`);
          return;
        }

        console.log('🚀 Starting auto-scan for bonded devices on app startup...');
        console.log(`📋 Will scan for ${bondedDevices.length} bonded devices: ${bondedDevices}`);

        // Start auto-connect
        await this.startAutoConnect();

        // Also try direct connection to known peripherals
        setTimeout(async () => {
          try {
            const connectResult = await this.connectToKnownPeripherals();
            console.log('🔗 Startup direct connection result:', connectResult);
          } catch (error) {
            console.log('⚠️ Startup direct connection failed:', error.message);
          }
        }, 2000);

        console.log('✅ Startup auto-scan initiated');

        // Also start periodic scanning for bonded devices
        this.startPeriodicAutoScan();
      }, 3000); // Wait 3 seconds for app to fully initialize
    } catch (error) {
      console.error('❌ Startup auto-scan failed:', error);
    }
  }

  startPeriodicAutoScan() {
    // Only on iOS
    if (Platform.OS !== 'ios') {
      return;
    }

    console.log('⏰ Starting periodic auto-scan for bonded devices...');

    // Check every 30 seconds for disconnected bonded devices
    this.periodicScanInterval = setInterval(async () => {
      try {
        const autoConnectStatus = await this.getAutoConnectStatus();
        if (!autoConnectStatus.enabled) {
          return;
        }

        const bondedDevices = await this.getBondedDevices();
        const connectedCount = this.connectedDevices.size;

        if (bondedDevices.length > 0 && connectedCount === 0) {
          console.log('🔄 Periodic check: No connected devices, scanning for bonded devices...');
          await this.forceScanForBondedDevices();
        }
      } catch (error) {
        console.log('⚠️ Periodic scan check failed:', error.message);
      }
    }, 30000); // Every 30 seconds
  }

  stopPeriodicAutoScan() {
    if (this.periodicScanInterval) {
      clearInterval(this.periodicScanInterval);
      this.periodicScanInterval = null;
      console.log('🛑 Stopped periodic auto-scan');
    }
  }

  // ==================== END AUTO-CONNECT FUNCTIONALITY ===================="

  // Public method for UI to set screen active state (call this when entering/leaving device screens)
  setDeviceScreenActive = (deviceId, isActive) => {
    this.setScreenActiveState(deviceId, isActive);
  }

  // Get current API interval for a device (useful for UI display)
  getDeviceApiInterval = (deviceId) => {
    return this.getCurrentApiInterval(deviceId);
  }

  // Get current API status for debugging
  getDeviceApiStatus = (deviceId) => {
    const hasTimer = this.adaptiveApiTimers.has(deviceId);
    const screenActive = this.screenActiveStates.get(deviceId) || false;
    const interval = this.getCurrentApiInterval(deviceId);
    const timerInfo = this.adaptiveApiTimers.get(deviceId);
    
    return {
      hasTimer,
      screenActive,
      interval,
      currentTimerInterval: timerInfo ? timerInfo.interval : null,
      appState: this.appState,
      isUpdatingAppState: this.isUpdatingAppState
    };
  }

  // Force cleanup and restart of all adaptive API timers (for debugging/fixing stuck timers)
  forceRestartAllAdaptiveApi = () => {
    console.log('🔧 Force restarting all adaptive API timers...');
    this.stopAllAdaptiveApi();
    
    // Wait a bit then restart for all connected devices
    setTimeout(() => {
      for (const [deviceId, device] of this.scannedDevices.entries()) {
        if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
          this.startAdaptiveApiCalling(deviceId);
        }
      }
    }, 100);
  }

  // Debug method to show current adaptive API calling state
  debugAdaptiveApiState = () => {
    console.log('🔍 Debug: Current Adaptive API State');
    console.log(`App State: ${this.appState}`);
    console.log(`Screen States:`, Object.fromEntries(this.screenActiveStates));
    console.log(`Active Timers:`, Array.from(this.adaptiveApiTimers.entries()).map(([deviceId, timerInfo]) => ({
      deviceId,
      interval: timerInfo.interval,
      hasTimer: !!timerInfo.timer
    })));
  }

  // Method to set all connected devices to active (useful for testing or manual control)
  setAllDevicesActive = () => {
    console.log('📱 Setting all connected devices to ACTIVE state');
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, true);
      }
    }
  }

  // Method to set all connected devices to inactive (useful for testing or manual control)
  setAllDevicesInactive = () => {
    console.log('📱 Setting all connected devices to INACTIVE state');
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, false);
      }
    }
  }

  // Helper method to identify service type from UUID
  getServiceType(uuid) {
    const normalizedUUID = uuid.toLowerCase();

    // Check against known service UUIDs
    if (normalizedUUID === BLE_SERVICES.BATTERY.toLowerCase()) {
      return 'BATTERY_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.DEVICE_INFO.toLowerCase()) {
      return 'DEVICE_INFO_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.GENERIC_ACCESS.toLowerCase()) {
      return 'GENERIC_ACCESS_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.SMART_TAG.toLowerCase()) {
      return 'SMART_TAG_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.DFU.toLowerCase()) {
      return 'DFU_SERVICE';
    } else {
      return 'CUSTOM_SERVICE';
    }
  }

  // Trigger health data API call from native side
  // This method can be used to ensure API calls continue even when JS is suspended
  async triggerNativeHealthDataApiCall(deviceId) {
    try {
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        console.log(`📤 Triggering native health data API call for device: ${deviceId}`);
        const result = await SampleBridgeAndroid.triggerHealthDataApiCall(deviceId);
        console.log(`✅ Native health data API call triggered successfully:`, result);
        return result;
      } else {
        console.log(`⚠️ Native health data API trigger not available on this platform`);
        return false;
      }
    } catch (error) {
      console.error(`❌ Failed to trigger native health data API call:`, error);
      return false;
    }
  }

  // Handle health data API request from native side
  async handleNativeHealthDataApiRequest(eventData) {
    try {
      const { deviceId, deviceData, timestamp } = eventData;
      
      console.log(`📤 Native health data API request received for device: ${deviceId}`);
      console.log(`📤 Device data from native:`, deviceData);
      console.log(`📤 Timestamp: ${timestamp}`);
      
      // Update the device data in our local cache first
      if (deviceData) {
        const device = this.scannedDevices.get(deviceId);
        if (device) {
          // Ensure deviceData is properly initialized
          if (!device.deviceData) {
            device.deviceData = {
              batteryLevel: null,
              temperature: null,
              steps: null,
              lastUpdate: new Date()
            };
          }

          // Update device data from native side
          if (deviceData.batteryLevel !== undefined) {
            device.deviceData.batteryLevel = deviceData.batteryLevel;
          }
          if (deviceData.temperature !== undefined) {
            device.deviceData.temperature = deviceData.temperature;
          }
          if (deviceData.steps !== undefined) {
            device.deviceData.steps = deviceData.steps;
          }
          if (deviceData.lastUpdate) {
            device.deviceData.lastUpdate = new Date(deviceData.lastUpdate);
          }
          
          console.log(`📤 Updated device data from native side for: ${deviceId}`);
        }
      }
      
      // Call the health data API
      await this.sendPetHealthDataToServer(deviceId);
      
    } catch (error) {
      console.error(`❌ Failed to handle native health data API request:`, error);
    }
  }

  // Send pet health BLE data to server after successful connection
  async sendPetHealthDataToServer(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device || !device.deviceData) {
        console.log('⚠️ No device data available to send to server for:', deviceId);
        return;
      }

      // Extract device data
      const { batteryLevel, temperature, steps, lastUpdate } = device.deviceData;

      // Only send if we have meaningful data
      if (batteryLevel === null && temperature === null && steps === null) {
        console.log('⚠️ No meaningful device data to send to server for:', deviceId);
        return;
      }

      // Log discovered services for debugging
      if (device.services && device.services.length > 0) {
        const connectionType = device.connectionType || 'manual';
        console.log(`🔍 Device ${device.name} (${connectionType} connection) has ${device.services.length} discovered services:`);
        device.services.forEach((service, index) => {
          console.log(`  ${index + 1}. Service UUID: ${service.uuid}`);
          if (service.characteristics && service.characteristics.length > 0) {
            console.log(`     Characteristics: ${service.characteristics.length}`);
            service.characteristics.forEach((char, charIndex) => {
              console.log(`       ${charIndex + 1}. ${char.uuid} (Readable: ${char.isReadable}, Notifiable: ${char.isNotifiable})`);
            });
          }
        });
      } else {
        const connectionType = device.connectionType || 'manual';
        console.log(`⚠️ No services discovered for device ${device.name} (${connectionType} connection) yet`);
      }

      // Prepare the payload according to the API specification
      const petHealthData = {
        PetId: 1059773, // This should be set based on your app's logic (Brunio did1 staging)
        Steps: steps || null,
        Temperature: temperature ? temperature.toString() : null,
        BatteryLevel: batteryLevel ? batteryLevel.toString() : null,
        TimeStamp: lastUpdate ? lastUpdate.toISOString() : null,
        Status: device.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [
          {
            Characteristic: 'BLE_DEVICE_DATA',
            ServiceType: 'UNKNOWN',
            CharacteristicsCount: 0
          }
        ]
      };

      const connectionType = device.connectionType || 'manual';
      console.log(`📤 Preparing to send pet health data to server for ${connectionType} connection:`, petHealthData);

      // Send data to server
      const result = await postPetHealthBLEData(petHealthData);

      if (result.success !== false) {
        console.log('✅ Pet health data sent successfully to server for device:', deviceId);
      } else {
        console.warn('⚠️ Failed to send pet health data to server:', result.error);
      }

    } catch (error) {
      console.error('❌ Error sending pet health data to server:', error);
    }
  }

  // ==================== ADAPTIVE API CALLING FUNCTIONALITY ====================

  // Set screen active state for a device (called from UI when screen becomes active)
  setScreenActiveState(deviceId, isActive) {
    console.log(`📱 [SCREEN] Setting screen state for device ${deviceId}: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    
    const currentState = this.screenActiveStates.get(deviceId);
    
    // Only update if the state actually changed
    if (currentState !== isActive) {
      this.screenActiveStates.set(deviceId, isActive);
      console.log(`📱 [SCREEN] State changed: ${currentState || 'UNKNOWN'} → ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
      
      // Restart adaptive API calling with new interval
      this.restartAdaptiveApiCalling(deviceId);
      
      // Handle GET API calling based on screen state
      if (isActive) {
        // Start GET API calling when screen becomes active
        console.log(`📱 [SCREEN] Starting GET API for device ${deviceId} (screen became active)`);
        const success = this.startGetApiCalling(deviceId);
        if (success) {
          console.log(`✅ [SCREEN] GET API started successfully for device ${deviceId}`);
        } else {
          console.log(`❌ [SCREEN] Failed to start GET API for device ${deviceId}`);
        }
      } else {
        // Stop GET API calling when screen becomes inactive
        console.log(`📱 [SCREEN] Stopping GET API for device ${deviceId} (screen became inactive)`);
        this.stopGetApiCalling(deviceId);
      }
    } else {
      console.log(`📱 [SCREEN] State unchanged for device ${deviceId}: ${isActive ? 'ACTIVE' : 'INACTIVE'}`);
    }
  }

  // Get current API interval based on app and screen state
  getCurrentApiInterval(deviceId) {
    const screenActive = this.screenActiveStates.get(deviceId);
    
    if (this.appState === 'background') {
      return this.adaptiveApiConfig.BACKGROUND_INTERVAL;
    } else if (screenActive === true) {
      // Explicitly set to active - use fast interval
      return this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL;
    } else if (screenActive === false) {
      // Explicitly set to inactive - use slow interval
      return this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL;
    } else {
      // No screen state set yet - default to faster interval when app is active
      // This provides better user experience for newly connected devices
      return this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL;
    }
  }

  // Start adaptive API calling for a device
  startAdaptiveApiCalling(deviceId) {
    // Clear existing timer if any
    this.stopAdaptiveApiCalling(deviceId);
    
    const interval = this.getCurrentApiInterval(deviceId);
    const appState = this.appState;
    const screenActive = this.screenActiveStates.get(deviceId) || false;
    console.log(`🔄 Starting adaptive API calling for device ${deviceId} with ${interval/1000}s interval (App: ${appState}, Screen: ${screenActive ? 'ACTIVE' : 'INACTIVE'})`);
    console.log(`🔍 Debug: Platform.OS=${Platform.OS}, SampleBridgeAndroid=${!!SampleBridgeAndroid}`);
    
    // Use native monitoring when app is in background (like RSSI does)
    if (this.appState === 'background' && Platform.OS === 'android' && SampleBridgeAndroid) {
      console.log(`📤 App in background - using native health data API monitoring for device ${deviceId}`);
      console.log(`🔍 Calling SampleBridgeAndroid.startHealthDataApiMonitoring(${deviceId}, ${interval})`);
      SampleBridgeAndroid.startHealthDataApiMonitoring(deviceId, interval)
        .then(() => {
          console.log(`✅ Native health data API monitoring started for device ${deviceId}`);
          // Store native monitoring info instead of timer
          this.adaptiveApiTimers.set(deviceId, { isNative: true, interval });
          console.log(`✅ Native monitoring stored for device ${deviceId}, total timers: ${this.adaptiveApiTimers.size}`);
        })
        .catch((error) => {
          console.error(`❌ Failed to start native health data API monitoring:`, error);
          // Fallback to JS timer
          this.startJSTimer(deviceId, interval);
        });
    } else {
      // Use regular JS timer when app is active
      console.log(`📤 App is active - using JS timer for device ${deviceId}`);
      this.startJSTimer(deviceId, interval);
    }
  }
  
  // Start JavaScript timer for API calling
  startJSTimer(deviceId, interval) {
    const timer = setInterval(async () => {
      try {
        const device = this.scannedDevices.get(deviceId);
        if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
          console.log(`📤 JS Timer: Sending pet health data to server for device ${deviceId}`);
          await this.sendPetHealthDataToServer(deviceId);
        }
      } catch (error) {
        console.error(`❌ JS Timer API calling error for device ${deviceId}:`, error);
      }
    }, interval);
    
    // Store timer with interval information
    this.adaptiveApiTimers.set(deviceId, { timer, interval });
    console.log(`✅ JS Timer stored for device ${deviceId}, total timers: ${this.adaptiveApiTimers.size}`);
  }

  // Stop adaptive API calling for a device
  stopAdaptiveApiCalling(deviceId) {
    const timerInfo = this.adaptiveApiTimers.get(deviceId);
    if (timerInfo) {
      if (timerInfo.isNative && Platform.OS === 'android' && SampleBridgeAndroid) {
        // Stop native monitoring
        console.log(`🛑 Stopping native health data API monitoring for device ${deviceId}`);
        SampleBridgeAndroid.stopHealthDataApiMonitoring(deviceId)
          .then(() => {
            console.log(`✅ Native health data API monitoring stopped for device ${deviceId}`);
          })
          .catch((error) => {
            console.error(`❌ Failed to stop native health data API monitoring:`, error);
          });
      } else if (timerInfo.timer) {
        // Stop JS timer
        clearInterval(timerInfo.timer);
        console.log(`🛑 Stopped JS timer for device ${deviceId}`);
      }
      this.adaptiveApiTimers.delete(deviceId);
    }
  }

  // Restart adaptive API calling with new interval
  restartAdaptiveApiCalling(deviceId) {
    // Check if device is in cooldown
    if (this.adaptiveApiCooldowns.has(deviceId)) {
      console.log(`⏸️ Skipping restart for device ${deviceId} - still in cooldown`);
      return;
    }

    const device = this.scannedDevices.get(deviceId);
    if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
      // Only restart if the device actually has an active API timer
      if (this.adaptiveApiTimers.has(deviceId)) {
        const currentInterval = this.getCurrentApiInterval(deviceId);
        const existingTimer = this.adaptiveApiTimers.get(deviceId);
        
        // Check if we need to switch between native and JS timers
        const shouldUseNative = this.appState === 'background' && Platform.OS === 'android' && SampleBridgeAndroid;
        const currentlyNative = existingTimer && existingTimer.isNative;
        
        // Restart if interval changed OR if we need to switch between native/JS timers
        if (existingTimer && (existingTimer.interval !== currentInterval || currentlyNative !== shouldUseNative)) {
          console.log(`🔄 Restarting adaptive API calling for device ${deviceId} - interval: ${currentInterval/1000}s, switching to ${shouldUseNative ? 'native' : 'JS'} timer`);
          
          // Set cooldown to prevent rapid restarts
          this.adaptiveApiCooldowns.set(deviceId, true);
          setTimeout(() => {
            this.adaptiveApiCooldowns.delete(deviceId);
          }, 2000); // 2 second cooldown
          
          // Call startAdaptiveApiCalling immediately instead of using setTimeout
          console.log(`🔄 About to call startAdaptiveApiCalling for device ${deviceId}`);
          this.startAdaptiveApiCalling(deviceId);
        } else {
          console.log(`⏸️ Skipping restart for device ${deviceId} - interval unchanged (${currentInterval/1000}s) and timer type unchanged`);
        }
      }
    }
  }

  // Stop all adaptive API timers
  stopAllAdaptiveApi() {
    for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
      if (timerInfo && timerInfo.timer) {
        clearInterval(timerInfo.timer);
      }
    }
    this.adaptiveApiTimers.clear();
    console.log('🛑 Stopped all adaptive API timers');
  }

  // Update app state and adjust API intervals
  updateAppState(newState) {
    const oldState = this.appState;
    
    // Prevent infinite loop - only update if state actually changed
    if (oldState === newState) {
      console.log(`📱 App state unchanged: ${newState}, skipping update`);
      return;
    }
    
    // Prevent recursive calls during state update
    if (this.isUpdatingAppState) {
      console.log(`⚠️ App state update already in progress, skipping: ${newState}`);
      return;
    }
    
    this.isUpdatingAppState = true;
    
    try {
      this.appState = newState;
      console.log(`📱 App state changed: ${oldState} → ${newState}`);
      console.log(`🔍 Debug: Current adaptive API timers count: ${this.adaptiveApiTimers.size}`);
      
      // Adjust API intervals for all connected devices
      if (newState === 'background') {
        // Switch to native monitoring when app goes to background
        console.log('📱 App going to background - switching to native health data API monitoring');
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        // Slow down RSSI cycle in background for power saving
        if (this.rssiCycleActive) {
          console.log('📱 App going to background - slowing down RSSI cycle');
          this.restartRssiCycle(); // Will use profile-based timing
        }
      } else if (newState === 'active') {
        // Switch back to JS timers when app becomes active
        console.log('📱 App becoming active - switching back to JS timers');
        // Also set devices to active if they haven't been explicitly set to inactive
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          const currentScreenState = this.screenActiveStates.get(deviceId);
          if (currentScreenState === undefined) {
            // No screen state set yet - default to active for better UX
            console.log(`📱 Auto-setting device ${deviceId} to ACTIVE (app became active)`);
            this.screenActiveStates.set(deviceId, true);
          }
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        // Fetch latest data once when app reopens
        this.fetchLatestDataOnAppReopen();
        
        // Restore normal RSSI cycle when app becomes active
        if (this.connectedDevices.size > 0) {
          console.log('📱 App becoming active - restoring normal RSSI cycle');
          this.restartRssiCycle();
        }
      }
    } finally {
      // Always reset the flag
      this.isUpdatingAppState = false;
    }
  }

  // ==================== END ADAPTIVE API CALLING FUNCTIONALITY ====================

  // ==================== GET API FUNCTIONALITY ====================

  // Start GET API calling for active screen (every 15 seconds)
  startGetApiCalling(deviceId) {
    console.log(`🚀 [GET API] Starting for device: ${deviceId}`);
    
    // Stop any existing timer first
    this.stopGetApiCalling(deviceId);
    
    // Validate device
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.log(`❌ [GET API] Device ${deviceId} not found in scannedDevices`);
      return false;
    }
    
    if (device.connectionState !== CONNECTION_STATES.CONNECTED) {
      console.log(`❌ [GET API] Device ${deviceId} not connected (state: ${device.connectionState})`);
      return false;
    }
    
    // Set interval based on power profile
    const interval = this.getApiConfig.ACTIVE_SCREEN_INTERVAL;
    const powerProfileName = this.profile === POWER_PROFILE.lowPower ? 'lowPower' : 
                           this.profile === POWER_PROFILE.ultraLowPower ? 'ultraLowPower' : 'default';
    console.log(`⏰ [GET API] Setting timer for device ${deviceId} with ${interval/1000}s interval (power profile: ${powerProfileName})`);
    
    // Create the timer
    const timer = setInterval(async () => {
      console.log(`⏰ [GET API] Timer triggered for device ${deviceId} at ${new Date().toLocaleTimeString()}`);
      
      try {
        // Check if device is still connected
        const currentDevice = this.scannedDevices.get(deviceId);
        if (!currentDevice || currentDevice.connectionState !== CONNECTION_STATES.CONNECTED) {
          console.log(`⚠️ [GET API] Device ${deviceId} no longer connected, stopping timer`);
          this.stopGetApiCalling(deviceId);
          return;
        }
        
        // Make the API call
        console.log(`📥 [GET API] Making API call for device ${deviceId}`);
        await this.fetchPetHealthDetails(deviceId);
        
      } catch (error) {
        console.error(`❌ [GET API] Error in timer for device ${deviceId}:`, error);
      }
    }, interval);
    
    // Store the timer
    this.getApiTimers.set(deviceId, { timer, interval });
    
    console.log(`✅ [GET API] Successfully started for device ${deviceId}`);
    console.log(`📊 [GET API] Current timers: ${this.getApiTimers.size}`);
    
    return true;
  }

  // Stop GET API calling for a device
  stopGetApiCalling(deviceId) {
    const timerInfo = this.getApiTimers.get(deviceId);
    if (timerInfo && timerInfo.timer) {
      clearInterval(timerInfo.timer);
      this.getApiTimers.delete(deviceId);
      console.log(`🛑 [GET API] Stopped for device ${deviceId}`);
    }
  }

  // Stop all GET API timers
  stopAllGetApi() {
    console.log(`🛑 [GET API] Stopping all timers (${this.getApiTimers.size} active)`);
    for (const [deviceId, timerInfo] of this.getApiTimers.entries()) {
      this.stopGetApiCalling(deviceId);
    }
    this.getApiTimers.clear();
  }

  // Fetch pet health details from server
  async fetchPetHealthDetails(deviceId) {
    try {
      console.log(`📥 [GET API] Fetching data for device ${deviceId}`);
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.log(`❌ [GET API] Device ${deviceId} not found`);
        return;
      }

      // Use device's pet ID if available, otherwise use default
      const petId = device.petId || 1059773;
      console.log(`📥 [GET API] Using Pet ID: ${petId} for device ${deviceId}`);
      
      // Make the API call
      const result = await getPetHealthBLEDetails(petId);
      
      if (result.success !== false) {
        console.log(`✅ [GET API] Successfully fetched data for device ${deviceId}`);
        
        // Store the fetched data
        if (device.deviceData) {
          device.deviceData.serverData = result;
          device.deviceData.lastServerFetch = new Date();
        }
        
        // Emit event for UI refresh
        this.emit('petHealthDataUpdated', { deviceId, data: result });
        
      } else {
        console.warn(`⚠️ [GET API] Failed to fetch data for device ${deviceId}:`, result.error);
      }
      
    } catch (error) {
      console.error(`❌ [GET API] Error fetching data for device ${deviceId}:`, error);
    }
  }

  // Fetch latest data when app reopens (called once)
  async fetchLatestDataOnAppReopen() {
    try {
      console.log('📥 [GET API] App reopened - fetching latest data for all connected devices');
      
      const connectedDevices = Array.from(this.scannedDevices.entries())
        .filter(([deviceId, device]) => device.connectionState === CONNECTION_STATES.CONNECTED);
      
      if (connectedDevices.length === 0) {
        console.log('📥 [GET API] No connected devices to fetch data for');
        return;
      }
      
      console.log(`📥 [GET API] Fetching data for ${connectedDevices.length} connected devices`);
      
      for (const [deviceId, device] of connectedDevices) {
        await this.fetchPetHealthDetails(deviceId);
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between calls
      }
      
      console.log('✅ [GET API] Latest data fetch completed for all devices');
      
    } catch (error) {
      console.error('❌ [GET API] Error fetching latest data on app reopen:', error);
    }
  }

  // ==================== PUBLIC METHODS FOR UI ====================

  // Method to manually trigger GET API call for testing
  manualGetApiCall = async (deviceId) => {
    console.log(`🧪 [GET API] Manual call triggered for device: ${deviceId}`);
    await this.fetchPetHealthDetails(deviceId);
  }

  // Method to get current GET API status for debugging
  getGetApiStatus = (deviceId) => {
    const timerInfo = this.getApiTimers.get(deviceId);
    const screenActive = this.screenActiveStates.get(deviceId);
    
    return {
      hasGetTimer: !!timerInfo,
      getInterval: timerInfo ? timerInfo.interval : null,
      screenActive: screenActive,
      appState: this.appState
    };
  }

  // Method to manually start GET API calling for testing
  startGetApiCallingManual = (deviceId) => {
    console.log(`🧪 [GET API] Manually starting for device: ${deviceId}`);
    this.setScreenActiveState(deviceId, true);
  }

  // Method to manually stop GET API calling for testing
  stopGetApiCallingManual = (deviceId) => {
    console.log(`🧪 [GET API] Manually stopping for device: ${deviceId}`);
    this.setScreenActiveState(deviceId, false);
  }

  // Debug method to check GET API status for all devices
  debugGetApiStatus = () => {
    console.log('🔍 [GET API] Debug Status for All Devices');
    console.log(`App State: ${this.appState}`);
    console.log(`Total GET API Timers: ${this.getApiTimers.size}`);
    
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      const getApiTimer = this.getApiTimers.get(deviceId);
      const screenActive = this.screenActiveStates.get(deviceId);
      const isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
      
      console.log(`Device ${deviceId}:`, {
        name: device?.name || 'Unknown',
        connected: isConnected,
        connectionState: device?.connectionState || 'Unknown',
        screenActive: screenActive,
        hasGetTimer: !!getApiTimer,
        getTimerInterval: getApiTimer ? getApiTimer.interval / 1000 : 'N/A',
        getTimerActive: !!getApiTimer?.timer
      });
    }
    
    if (this.getApiTimers.size > 0) {
      console.log('Active GET API Timers:', Array.from(this.getApiTimers.entries()).map(([deviceId, timerInfo]) => ({
        deviceId,
        hasTimer: !!timerInfo.timer,
        interval: timerInfo.interval / 1000
      })));
    } else {
      console.log('No active GET API timers');
    }
  }

  // Force start GET API for all connected devices (for testing)
  forceStartGetApiForAllDevices = () => {
    console.log('🧪 [GET API] Force starting for all connected devices');
    let startedCount = 0;
    
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        // Set screen active state first, then start GET API
        this.setScreenActiveState(deviceId, true);
        const success = this.startGetApiCalling(deviceId);
        if (success) startedCount++;
      }
    }
    
    console.log(`🧪 [GET API] Started ${startedCount} GET API timers`);
  }

  // Force stop GET API for all devices (for testing)
  forceStopGetApiForAllDevices = () => {
    console.log('🧪 [GET API] Force stopping all GET API timers');
    this.stopAllGetApi();
  }

  // ==================== END GET API FUNCTIONALITY ====================

  // ==================== CUSTOM EVENT EMITTER IMPLEMENTATION ====================

  // Add event listener
  on(eventName, callback) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(callback);
  }

  // Remove event listener
  off(eventName, callback) {
    if (!this.events[eventName]) return;
    
    if (callback) {
      // Remove specific callback
      this.events[eventName] = this.events[eventName].filter(cb => cb !== callback);
    } else {
      // Remove all listeners for this event
      delete this.events[eventName];
    }
  }

  // Emit event
  emit(eventName, data) {
    if (!this.events[eventName]) return;
    
    this.events[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`❌ Error in event listener for ${eventName}:`, error);
      }
    });
  }

  // Remove all event listeners
  removeAllListeners(eventName) {
    if (eventName) {
      delete this.events[eventName];
    } else {
      this.events = {};
    }
  }

  // ==================== END CUSTOM EVENT EMITTER IMPLEMENTATION ====================

  /**
   * Manually trigger battery profile adjustment (for testing)
   */
  async triggerBatteryProfileAdjustment() {
    console.log('📱 Manual battery profile adjustment triggered');
    if (this.phoneBatteryLevel === null) {
      return { success: false, message: 'Phone battery level not available' };
    }

    try {
      console.log(`📱 Current phone battery: ${this.phoneBatteryLevel}%`);
      console.log(`📱 Current power profile: ${this.getCurrentProfileName()}`);
      
      this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
      
      const newProfile = this.getCurrentProfileName();
      return { 
        success: true, 
        message: `Battery profile adjustment completed. Current profile: ${newProfile}`,
        batteryLevel: this.phoneBatteryLevel,
        currentProfile: newProfile
      };
    } catch (error) {
      console.error('📱 Manual battery profile adjustment failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Completely forget/remove a device (disconnect + unpair + clear data)
   */
  async forgetDevice(deviceId) {
    try {
      console.log(`🗑️ Starting forget process for device: ${deviceId}`);
      
      // 1. Get device info before removal
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device?.name || 'Unknown Device';
      
      // 2. Disconnect the device first (if connected)
      if (this.connectedDevices.has(deviceId)) {
        console.log(`🔌 Disconnecting device ${deviceId} before forgetting`);
        await this.disconnectFromDevice(deviceId);
      }
      
      // 3. Remove from connected devices map
      this.connectedDevices.delete(deviceId);
      console.log(`✅ Removed from connectedDevices: ${deviceId}`);
      
      // 4. Remove from scanned devices map
      this.scannedDevices.delete(deviceId);
      console.log(`✅ Removed from scannedDevices: ${deviceId}`);
      
      // 5. Remove from native side (platform specific)
      if (Platform.OS === 'ios') {
        // iOS: Remove from bonded/paired list
        try {
          await this.removeDeviceFromBondedList(deviceId);
          console.log(`✅ Removed from iOS bonded list: ${deviceId}`);
        } catch (error) {
          console.warn(`⚠️ Could not remove from iOS bonded list: ${error.message}`);
        }
      } else {
        // Android: Unpair device completely
        try {
          await this.manager.unpairDevice(deviceId);
          console.log(`✅ Unpaired from Android: ${deviceId}`);
        } catch (error) {
          console.warn(`⚠️ Could not unpair from Android: ${error.message}`);
        }
      }
      
      // 6. Clear all device-related data
      this.clearDeviceData(deviceId);
      console.log(`✅ Cleared device data: ${deviceId}`);
      
      // 7. Stop any ongoing operations for this device
      this.stopDeviceOperations(deviceId);
      console.log(`✅ Stopped device operations: ${deviceId}`);
      
      // 8. Trigger UI update
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      console.log(`✅ Device ${deviceId} (${deviceName}) forgotten successfully`);
      return { 
        success: true, 
        message: `Device "${deviceName}" forgotten successfully`,
        deviceId,
        deviceName
      };
      
    } catch (error) {
      console.error(`❌ Error forgetting device ${deviceId}:`, error);
      return { 
        success: false, 
        error: error.message,
        deviceId 
      };
    }
  }

  /**
   * Clear all device-related data and timers
   */
  clearDeviceData(deviceId) {
    // Clear RSSI data
    this.rssiValues.delete(deviceId);
    this.rssiHistory.delete(deviceId);
    this.lastRssiUpdate.delete(deviceId);
    
    // Clear API timers
    if (this.adaptiveApiTimers.has(deviceId)) {
      const timerInfo = this.adaptiveApiTimers.get(deviceId);
      if (timerInfo?.timer) {
        clearInterval(timerInfo.timer);
      }
      this.adaptiveApiTimers.delete(deviceId);
    }
    
    if (this.getApiTimers.has(deviceId)) {
      const timerInfo = this.getApiTimers.get(deviceId);
      if (timerInfo?.timer) {
        clearInterval(timerInfo.timer);
      }
      this.getApiTimers.delete(deviceId);
    }
    
    // Clear other device-specific data
    this.screenActiveStates.delete(deviceId);
    this.adaptiveApiCooldowns.delete(deviceId);
    this.manualDisconnectCooldown.delete(deviceId);
    
    // Clear monitoring subscriptions
    if (this.monitoringSubscriptions.has(deviceId)) {
      const subscription = this.monitoringSubscriptions.get(deviceId);
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
      this.monitoringSubscriptions.delete(deviceId);
    }
    
    // Clear disconnect subscriptions
    if (this.disconnectSubscriptions.has(deviceId)) {
      this.disconnectSubscriptions.delete(deviceId);
    }
    
    console.log(`🧹 Cleared all data for device: ${deviceId}`);
  }

  /**
   * Stop all ongoing operations for a specific device
   */
  stopDeviceOperations(deviceId) {
    // Stop heartbeat monitoring
    if (this.heartbeatTimers && this.heartbeatTimers.has(deviceId)) {
      const timer = this.heartbeatTimers.get(deviceId);
      if (timer) {
        clearInterval(timer);
        this.heartbeatTimers.delete(deviceId);
      }
    }
    
    // Stop reconnection attempts
    if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
      const timer = this.reconnectionTimers.get(deviceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectionTimers.delete(deviceId);
      }
    }
    
    // Stop reconnection attempts counter
    if (this.reconnectionAttempts && this.reconnectionAttempts.has(deviceId)) {
      this.reconnectionAttempts.delete(deviceId);
    }
    
    console.log(`⏹️ Stopped all operations for device: ${deviceId}`);
  }

  // Cleanup
  destroy() {
    this.stopScanning();
    this.disconnectAllDevices();
    this.stopPeriodicAutoScan();
    this.stopAllAdaptiveApi();
    
    // Stop all GET API timers
    this.stopAllGetApi();
    
    // Stop RSSI cycle
    this.stopRssiCycle();
    
    // Clear cooldowns
    this.adaptiveApiCooldowns.clear();
    
    // Clear all event listeners
    this.removeAllListeners();

    // Stop all timers
    if (this.reconnectionTimers) {
      for (const timer of this.reconnectionTimers.values()) {
        clearTimeout(timer);
      }
      this.reconnectionTimers.clear();
    }

    if (this.heartbeatTimers) {
      for (const timer of this.heartbeatTimers.values()) {
        clearInterval(timer);
      }
      this.heartbeatTimers.clear();
    }

    // Remove all monitoring subscriptions
    for (const subscription of this.monitoringSubscriptions.values()) {
      subscription.remove();
    }
    this.monitoringSubscriptions.clear();

    this.manager.destroy();
    console.log('BLE Service destroyed');
  }
}

// Export singleton instance
export default new BLEService();

