import { NativeModules, DeviceEventEmitter, NativeEventEmitter } from 'react-native';
import { Buffer } from 'buffer';
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
  POWER_PROFILE,
  RECONNECTION_CONSTANTS,
  ERROR_TYPES
} from '../../constants/BLEConstants';
import BLEDataParser from '../../utils/BLEDataParser';
import BLEPermissions from '../../utils/BLEPermissions';
import AutoConnectService from '../AutoConnectService';
import { postPetHealthBLEData, getPetHealthBLEDetails } from '../../utils/apiConfig';
import { Alert, Platform, PermissionsAndroid, AppState } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { store } from '../../feature/Store';
import { addRecord, addRecords } from '../../feature/historicalRecordsSlice/historicalRecordsSlice';

// Import native modules
const { SampleBridgeAndroid, BridgingCodeModule } = NativeModules;

class BLEService {
  constructor() {
    // Custom event emitter implementation for React Native
    this.events = {};
    
    // Initialize platform-specific BLE managers
    if (Platform.OS === 'ios') {
      // iOS uses native bridge - no BLE PLX manager needed
      this.manager = null;
      this.setupIOSEventListeners();
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

    // Request device data mutex and debouncing
    this.requestDataMutex = new Map(); // Prevent concurrent requestDeviceData calls per device
    this.requestDataTimers = new Map(); // Debounce timers for requestDeviceData
    this.systemCommandResponses = new Map(); // Store system command responses for async access
    this.lastTimeSyncAttempt = new Map(); // Track last time sync attempts to prevent spam
    this.deviceRestartTimes = new Map(); // Track when devices were restarted (deviceId -> timestamp)
    this.autoSyncTimers = new Map(); // Debounce timers for auto-sync triggers (deviceId -> timer)
    this.autoSyncMeta = new Map(); // Track auto-sync metadata (lastRecordCount, lastSyncAt, lastSyncCompletedAt)
    this.manualReadTimestamps = new Map(); // Track when we do manual reads (deviceId -> timestamp) to distinguish from live notifications
    
    // ✅ FIX: Notification and timer deduplication
    this.lastNotificationData = new Map(); // Track last notification to prevent duplicates (deviceId -> { recordCount, timestamp })
    this.lastTimerReset = new Map(); // Track last timer reset time (deviceId -> timestamp)
    this.timerResetDebounceWindow = 500; // Minimum 500ms between timer resets
    this.notificationDedupeWindow = 100; // Ignore duplicate notifications within 100ms
    
    // ✅ IMPROVEMENTS: Enhanced auto-sync features
    // 1. Error Handling with Exponential Backoff
    this.syncRetryAttempts = new Map(); // deviceId -> retry count
    this.syncRetryTimers = new Map(); // deviceId -> retry timer
    this.maxSyncRetries = 3; // Maximum retry attempts
    this.baseRetryDelay = 1000; // Base delay: 1 second
    
    // 2. Sync Queue for multiple pending syncs
    this.syncQueue = new Map(); // deviceId -> array of pending sync requests
    this.processingSync = new Map(); // deviceId -> boolean (is currently processing sync)
    
    // 3. Metrics Tracking
    this.syncMetrics = new Map(); // deviceId -> { successCount, failureCount, totalLatency, lastSyncTime, ... }
    
    // 4. Adaptive Throttle
    this.recordAccumulationRates = new Map(); // deviceId -> array of record count timestamps
    this.adaptiveThrottleConfig = {
      fast: 15000,    // 15s when records accumulating quickly (>2 records/30s)
      normal: 30000,  // 30s normal mode (1-2 records/30s)
      slow: 60000     // 60s when records accumulating slowly (<1 record/30s)
    };
    
    // 5. Fallback Polling
    this.lastNotificationTime = new Map(); // deviceId -> timestamp of last notification
    this.fallbackPollingTimers = new Map(); // deviceId -> polling timer
    this.fallbackPollingInterval = 120000; // 2 minutes
    
    // 6. Configuration
    this.autoSyncConfig = {
      debounceDelay: 0,          // No delay - we have deduplication and throttling already
      throttleMode: 'adaptive',   // 'adaptive', 'fast', 'normal', 'slow', 'custom'
      customThrottle: 30000,      // Custom throttle time (ms)
      enableFallbackPolling: true, // Enable fallback polling
      maxRetries: 3,               // Max retry attempts
      enableMetrics: true,         // Enable metrics tracking
      enableUserFeedback: true    // Enable user feedback events
    };
    
    // 7. State Transition Logging
    this.stateTransitionHistory = new Map(); // deviceId -> array of state transitions
    this.maxStateHistory = 20; // Keep last 20 state transitions

    // ✅ INDUSTRY STANDARD: Live Data Buffering System (5-minute batching)
    this.liveDataBuffers = new Map();  // deviceId -> array of live records (max 10)
    this.lastBatchUpload = new Map();  // deviceId -> timestamp of last upload
    this.batchUploadTimers = new Map();  // deviceId -> interval timer
    this.historicalSyncComplete = new Map();  // deviceId -> boolean (track if historical sync done)
    this.liveDataConfig = {
      bufferSize: 10,           // Buffer 10 readings (5 minutes at 30s intervals)
      uploadInterval: 300000,   // Upload every 5 minutes (300000ms)
      immediateThreshold: {     // Send immediately if:
        tempChange: 2,          // Temperature changes > 2°C
        stepChange: 50,         // Steps change > 50
        batteryLow: 15          // Battery < 15%
      }
    };

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
  setupIOSEventListeners() {
    
    // Create event emitter for iOS native module
    this.iosEventEmitter = new NativeEventEmitter(BridgingCodeModule);
    
    // Device found event
    this.iosEventEmitter.addListener('DeviceFound', (deviceInfo) => {
      this.handleIOSDeviceFound(deviceInfo);
    });
    
    // Device connected event
    this.iosEventEmitter.addListener('DeviceConnected', (deviceInfo) => {
      this.handleIOSDeviceConnected(deviceInfo);
    });
    
    // Device disconnected event
    this.iosEventEmitter.addListener('DeviceDisconnected', (deviceInfo) => {
      this.handleIOSDeviceDisconnected(deviceInfo);
    });
    
    // Services discovered event
    this.iosEventEmitter.addListener('ServicesDiscovered', (eventData) => {
      this.handleIOSServicesDiscovered(eventData);
    });
    
    // Characteristics discovered event
    this.iosEventEmitter.addListener('CharacteristicsDiscovered', (eventData) => {
      this.handleIOSCharacteristicsDiscovered(eventData);
    });
    
    // Characteristic data event
    this.iosEventEmitter.addListener('CharacteristicData', (eventData) => {
      this.handleIOSCharacteristicData(eventData);
    });
    
    // ✅ CRITICAL FIX: Data transfer events (sync_start, sync_complete, records)
    // This was missing for iOS! Native sends it but we weren't listening
    this.iosEventEmitter.addListener('DataTransfer', (eventData) => {
      this.handleNativeDataTransferEvent(eventData);
    });
    
    // ✅ NEW: Service discovery complete event - triggers command sequence
    this.iosEventEmitter.addListener('ServiceDiscoveryComplete', (eventData) => {
      this.handleServiceDiscoveryComplete(eventData);
    });
    
    // ✅ System command response event (for consistency with Android)
    this.iosEventEmitter.addListener('SystemCommandResponse', (eventData) => {
      this.handleNativeSystemCommandResponse(eventData);
    });
    
    // RSSI update event
    this.iosEventEmitter.addListener('RSSIUpdate', (eventData) => {
      this.handleIOSRSSIUpdate(eventData);
    });
    
    // Auto-connect events
    this.iosEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
      this.handleIOSDeviceConnected(deviceInfo);
    });
    
    this.iosEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
      this.handleIOSDeviceDisconnected(deviceInfo);
    });
    
    // DFU (Device Firmware Update) events
    this.iosEventEmitter.addListener('DFUProgress', (eventData) => {
      console.log(`📊 [DFU] Progress: ${eventData.progress}%`);
      this.emit('DFUProgress', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUStateChanged', (eventData) => {
      console.log(`🔧 [DFU] State: ${eventData.state}`);
      this.emit('DFUStateChanged', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUCompleted', (eventData) => {
      console.log('🎉 [DFU] Completed successfully!');
      this.emit('DFUCompleted', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUAborted', (eventData) => {
      console.log('🛑 [DFU] Aborted');
      this.emit('DFUAborted', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUError', (eventData) => {
      console.error('❌ [DFU] Error:', eventData);
      this.emit('DFUError', eventData);
    });

    // ✅ CRITICAL FIX: Register DeviceDataUpdated listener for iOS
    // iOS sends DeviceDataUpdated with isFromPolling, recordCount, rtcValid, etc.
    this.iosEventEmitter.addListener('DeviceDataUpdated', (event) => {
      console.log(`🔔 [LISTENER] DeviceDataUpdated event received! deviceId: ${event?.deviceId}`, {
        fullEvent: event,
        keys: event ? Object.keys(event) : []
      });
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error(`❌ [HANDLER ERROR] Error in handleDeviceDataUpdated:`, error);
      }
    });
    console.log(`✅ [SETUP] DeviceDataUpdated event listener registered for iOS`);
  }

  setupAndroidEventListeners() {
    if (Platform.OS !== 'android') return;


    // Listen for device discovery events
    DeviceEventEmitter.addListener('DeviceFound', (deviceInfo) => {
      this.handleAndroidDeviceFound(deviceInfo);
    });

    // Listen for connection state changes
    DeviceEventEmitter.addListener('ConnectionStateChanged', (event) => {
      this.handleAndroidConnectionStateChange(event);
    });

    // ✅ Listen for characteristic data updates (handles both event names)
    // CharacteristicDataReceived: Legacy event name
    // CharacteristicChanged: Legacy event name
    // CharacteristicData: Current event name (matching iOS)
    DeviceEventEmitter.addListener('CharacteristicDataReceived', (event) => {
      this.handleAndroidCharacteristicData(event);
    });
    DeviceEventEmitter.addListener('CharacteristicChanged', (event) => {
      this.handleAndroidCharacteristicData(event);
    });
    DeviceEventEmitter.addListener('CharacteristicData', (event) => {
      this.handleAndroidCharacteristicData(event);
    });

    // Listen for device data updates (steps, temperature, etc.)
    // ✅ FIX: DeviceDataUpdated event is used by BOTH iOS and Android
    // iOS sends DeviceDataUpdated with isFromPolling, recordCount, rtcValid, etc.
    // Android also sends DeviceDataUpdated (legacy format)
    DeviceEventEmitter.addListener('DeviceDataUpdated', (event) => {
      console.log(`🔔 [LISTENER] DeviceDataUpdated event received! deviceId: ${event?.deviceId}`, {
        fullEvent: event,
        keys: event ? Object.keys(event) : []
      });
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error(`❌ [HANDLER ERROR] Error in handleDeviceDataUpdated:`, error);
      }
    });
    console.log(`✅ [SETUP] DeviceDataUpdated event listener registered`);

    // ✅ CRITICAL FIX: Listen for deviceDataUpdate events from Android (matching iOS format)
    // Android sends both DeviceDataUpdated (legacy) and deviceDataUpdate (new format)
    DeviceEventEmitter.addListener('deviceDataUpdate', (event) => {
      this.handleAndroidDeviceDataUpdateEvent(event);
    });

    // Listen for health data API requests from native side
    DeviceEventEmitter.addListener('HealthDataApiRequest', (eventData) => {
      this.handleNativeHealthDataApiRequest(eventData);
    });

    // Listen for system command responses from native side (matching iOS event name)
    DeviceEventEmitter.addListener('SystemCommandEvent', (eventData) => {
      this.handleNativeSystemCommandResponse(eventData);
    });
    DeviceEventEmitter.addListener('SystemCommandResponse', (eventData) => {
      this.handleNativeSystemCommandResponse(eventData);
    });

    // Listen for data transfer events from native side (matching iOS event name)
    DeviceEventEmitter.addListener('DataTransferEvent', (eventData) => {
      this.handleNativeDataTransferEvent(eventData);
    });
    DeviceEventEmitter.addListener('DataTransfer', (eventData) => {
      this.handleNativeDataTransferEvent(eventData);
    });

    // ✅ CRITICAL: Service discovery complete event - triggers command sequence (matching iOS)
    DeviceEventEmitter.addListener('ServiceDiscoveryComplete', (eventData) => {
      this.handleServiceDiscoveryComplete(eventData);
    });

    // Listen for services discovered
    DeviceEventEmitter.addListener('ServicesDiscovered', (event) => {
      this.handleAndroidServicesDiscovered(event);
    });

    // Listen for RSSI updates (matching iOS event name)
    DeviceEventEmitter.addListener('RSSIUpdated', (event) => {
      this.handleAndroidRSSIUpdate(event);
    });
    DeviceEventEmitter.addListener('RSSIUpdate', (event) => {
      this.handleAndroidRSSIUpdate(event);
    });

    // Listen for scan state changes
    DeviceEventEmitter.addListener('ScanStateChanged', (event) => {
      this.handleAndroidScanStateChange(event);
    });

    // Listen for device disconnection events
    DeviceEventEmitter.addListener('DeviceDisconnected', (event) => {
      this.handleAndroidDeviceDisconnected(event);
    });

    // Listen for device reconnection events
    DeviceEventEmitter.addListener('DeviceReconnected', (event) => {
      this.handleAndroidDeviceReconnected(event);
    });

    // Listen for device connection events
    DeviceEventEmitter.addListener('DeviceConnected', (event) => {
      this.handleAndroidDeviceConnected(event);
    });

    // Listen for auto-connect device connected events (CRITICAL FIX)
    DeviceEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
      this.handleAutoConnectedDevice(deviceInfo);
    });

    // Listen for auto-connect device disconnected events
    DeviceEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
      this.handleAutoDisconnectedDevice(deviceInfo);
    });
    
    // DFU (Device Firmware Update) events
    DeviceEventEmitter.addListener('DFUProgress', (eventData) => {
      console.log(`📊 [DFU] Progress: ${eventData.progress}%`);
      this.emit('DFUProgress', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUStateChanged', (eventData) => {
      console.log(`🔧 [DFU] State: ${eventData.state}`);
      this.emit('DFUStateChanged', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUCompleted', (eventData) => {
      console.log('🎉 [DFU] Completed successfully!');
      this.emit('DFUCompleted', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUAborted', (eventData) => {
      console.log('🛑 [DFU] Aborted');
      this.emit('DFUAborted', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUError', (eventData) => {
      console.error('❌ [DFU] Error:', eventData);
      this.emit('DFUError', eventData);
    });
  }

  init() {
    // Initialize BLE state and request permissions for both platforms
    this.requestPermissions().then(() => {
      // Check actual BLE state after permissions
      this.isBLEReady().then(ready => {
        this.bleState = ready ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
      });
    });

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
    
    // ✅ Sync existing records from BLEService to Redux on app start
    // This ensures any records that existed before Redux integration are also saved
    this.syncExistingRecordsToRedux();
  }
  
  // ✅ Sync existing records from BLEService to Redux (called on app init)
  syncExistingRecordsToRedux() {
    try {
      const { addRecords } = require('../../feature/historicalRecordsSlice/historicalRecordsSlice');
      
      // Get all devices with sync records
      this.scannedDevices.forEach((device, deviceId) => {
        if (device.syncRecords && device.syncRecords.length > 0) {
          console.log(`📊 [Redux Sync] Syncing ${device.syncRecords.length} existing records for device ${deviceId} to Redux`);
          store.dispatch(addRecords({ deviceId, records: device.syncRecords }));
        }
      });
    } catch (error) {
      console.warn('Failed to sync existing records to Redux:', error);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ✅ INDUSTRY STANDARD: Live Data Buffering Methods
  // ═══════════════════════════════════════════════════════════════

  /**
   * Add live data to buffer (called on every 30s Device Status notification)
   */
  addToLiveBuffer(deviceId, data) {
    // Initialize buffer if needed
    if (!this.liveDataBuffers.has(deviceId)) {
      this.liveDataBuffers.set(deviceId, []);
    }
    
    const buffer = this.liveDataBuffers.get(deviceId);
    buffer.push({
      timestamp: data.timestamp,
      timestampDate: data.timestampDate || new Date(data.timestamp * 1000),
      steps: data.steps,
      temperature: data.temperature,
      batteryLevel: data.batteryLevel || null,
      flags: data.flags || 0,
      capturedAt: new Date().toISOString(),
      source: 'live'
    });
    
    console.log(`📊 [LIVE BUFFER] Added record to buffer for ${deviceId}: ${buffer.length}/${this.liveDataConfig.bufferSize}`);
  }

  /**
   * Check if should upload batch (buffer full or time elapsed)
   */
  shouldUploadBatch(deviceId) {
    const buffer = this.liveDataBuffers.get(deviceId) || [];
    const lastUpload = this.lastBatchUpload.get(deviceId) || 0;
    const timeSinceLastUpload = Date.now() - lastUpload;
    
    // Upload if:
    // 1. Buffer is full (10 records = 5 minutes of data)
    // 2. OR 5 minutes elapsed since last upload
    // 3. OR buffer has data and app going to background
    return buffer.length >= this.liveDataConfig.bufferSize || 
           timeSinceLastUpload >= this.liveDataConfig.uploadInterval ||
           (buffer.length > 0 && this.appState !== 'active');
  }

  /**
   * Upload batched live data to server
   */
  async uploadLiveBatch(deviceId) {
    const buffer = this.liveDataBuffers.get(deviceId);
    if (!buffer || buffer.length === 0) return;
    
    console.log(`📤 [LIVE BATCH] Uploading ${buffer.length} buffered live records for ${deviceId}`);
    
    // Calculate aggregates
    const oldestRecord = buffer[0];
    const newestRecord = buffer[buffer.length - 1];
    
    // ✅ STEPS: Cumulative (use latest, calculate delta)
    const stepsDelta = newestRecord.steps - oldestRecord.steps;
    const currentSteps = newestRecord.steps;
    
    // ✅ TEMPERATURE: Latest for current, average for trends
    const latestTemperature = newestRecord.temperature;
    const averageTemperature = buffer.reduce((sum, r) => sum + r.temperature, 0) / buffer.length;
    const minTemperature = Math.min(...buffer.map(r => r.temperature));
    const maxTemperature = Math.max(...buffer.map(r => r.temperature));
    
    const device = this.scannedDevices.get(deviceId);
    
    try {
      // ✅ BACKWARD COMPATIBLE: Use latest record for main fields + add new fields
      const payload = {
        PetId: 1059773,
        Steps: currentSteps,  // Latest cumulative value
        Temperature: latestTemperature ? latestTemperature.toString() : null,
        BatteryLevel: newestRecord.batteryLevel ? newestRecord.batteryLevel.toString() : null,
        TimeStamp: newestRecord.timestampDate.toISOString(),
        Status: device?.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device?.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [],
        
        // ✅ NEW: Additional fields for industry-standard approach
        SyncType: "live_batch",
        BatchedAt: new Date().toISOString(),
        
        // ✅ ALL buffered records (for server to store complete history)
        AllRecords: buffer.map(r => ({
          Timestamp: r.timestampDate.toISOString(),
          Steps: r.steps,
          Temperature: r.temperature,
          BatteryLevel: r.batteryLevel,
          Flags: r.flags,
          RecordType: "live"
        })),
        
        // ✅ Aggregates (for quick dashboard)
        Summary: {
          StepsDelta: stepsDelta,
          CurrentSteps: currentSteps,
          LatestTemperature: latestTemperature,
          AverageTemperature: Math.round(averageTemperature * 10) / 10,
          MinTemperature: minTemperature,
          MaxTemperature: maxTemperature,
          LatestBattery: newestRecord.batteryLevel,
          RecordCount: buffer.length
        }
      };
      
      const result = await postPetHealthBLEData(payload);
      
      console.log(`✅ [LIVE BATCH] Uploaded successfully: ${buffer.length} records, ${stepsDelta} steps gained`);
      
      // Clear buffer and update timestamp
      this.liveDataBuffers.set(deviceId, []);
      this.lastBatchUpload.set(deviceId, Date.now());
      
    } catch (error) {
      console.error(`❌ [LIVE BATCH] Upload failed:`, error);
      // Keep buffer for retry on next cycle
    }
  }

  /**
   * Check for immediate alerts (critical thresholds)
   */
  async checkImmediateAlert(deviceId, currentData) {
    const buffer = this.liveDataBuffers.get(deviceId);
    if (!buffer || buffer.length === 0) return;
    
    const previousData = buffer[buffer.length - 1];
    const config = this.liveDataConfig.immediateThreshold;
    
    // Check temperature spike
    if (previousData) {
      const tempDiff = Math.abs(currentData.temperature - previousData.temperature);
      if (tempDiff > config.tempChange) {
        console.log(`🚨 [IMMEDIATE ALERT] Temperature spike: ${tempDiff}°C (${previousData.temperature}°C → ${currentData.temperature}°C)`);
        await this.sendImmediateAlert(deviceId, currentData, 'temperature_spike', {
          previousTemp: previousData.temperature,
          currentTemp: currentData.temperature,
          change: tempDiff
        });
        return true;
      }
    }
    
    // Check low battery
    if (currentData.batteryLevel !== null && currentData.batteryLevel < config.batteryLow) {
      console.log(`🚨 [IMMEDIATE ALERT] Low battery: ${currentData.batteryLevel}%`);
      await this.sendImmediateAlert(deviceId, currentData, 'low_battery', {
        batteryLevel: currentData.batteryLevel
      });
      return true;
    }
    
    return false;
  }

  /**
   * Send immediate alert for critical events
   */
  async sendImmediateAlert(deviceId, data, alertType, alertData) {
    const device = this.scannedDevices.get(deviceId);
    
    try {
      // ✅ BACKWARD COMPATIBLE: Use standard API format + add alert fields
      const timestampISO = data.timestampDate && data.timestampDate instanceof Date ? 
        data.timestampDate.toISOString() : 
        new Date().toISOString();
      
      const payload = {
        PetId: 1059773,
        Steps: data.steps,
        Temperature: data.temperature ? data.temperature.toString() : null,
        BatteryLevel: data.batteryLevel ? data.batteryLevel.toString() : null,
        TimeStamp: timestampISO,
        Status: device?.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device?.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [],
        
        // ✅ NEW: Alert metadata
        SyncType: "immediate_alert",
        AlertType: alertType,
        AlertData: alertData,
        AlertedAt: new Date().toISOString()
      };
      
      const result = await postPetHealthBLEData(payload);
      
      console.log(`✅ [IMMEDIATE ALERT] Sent: ${alertType}`);
    } catch (error) {
      console.error(`❌ [IMMEDIATE ALERT] Failed to send:`, error);
    }
  }

  /**
   * Send historical records after data sync complete
   */
  async sendHistoricalRecords(deviceId, records) {
    if (!records || records.length === 0) {
      console.log(`⚠️ [HISTORICAL SYNC] No records to send for ${deviceId}`);
      return;
    }
    
    console.log(`📤 [HISTORICAL SYNC] Sending ${records.length} records + aggregates for ${deviceId}`);
    
    // Calculate aggregates
    const totalSteps = records[records.length - 1].steps;  // Latest (cumulative)
    const latestTemperature = records[records.length - 1].temperature;
    const averageTemperature = records.reduce((sum, r) => sum + r.temperature, 0) / records.length;
    const minTemperature = Math.min(...records.map(r => r.temperature));
    const maxTemperature = Math.max(...records.map(r => r.temperature));
    
    // Step delta (first to last record)
    const stepsDelta = records.length > 1 ? 
      records[records.length - 1].steps - records[0].steps : 
      records[0].steps;
    
    const device = this.scannedDevices.get(deviceId);
    
    try {
      // ✅ Use latest record for API (server expects single record format)
      const latestRecord = records[records.length - 1];
      
      // Convert timestamp safely
      let timestampISO;
      if (latestRecord.timestampDate && latestRecord.timestampDate instanceof Date) {
        timestampISO = latestRecord.timestampDate.toISOString();
      } else if (typeof latestRecord.timestamp === 'number') {
        timestampISO = new Date(latestRecord.timestamp * 1000).toISOString();
      } else {
        timestampISO = new Date().toISOString();
      }
      
      // ✅ BACKWARD COMPATIBLE: Keep original API format + add new fields
      const payload = {
        PetId: 1059773,
        Steps: totalSteps,  // Latest cumulative value
        Temperature: latestTemperature ? latestTemperature.toString() : null,
        BatteryLevel: device?.deviceData?.batteryLevel ? device.deviceData.batteryLevel.toString() : null,
        TimeStamp: timestampISO,
        Status: device?.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device?.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [],
        
        // ✅ NEW: Additional fields for industry-standard approach
        SyncType: "historical_sync",
        SyncedAt: new Date().toISOString(),
        
        // ✅ ALL raw records (for server to store complete history)
        AllRecords: records.map(r => {
          const ts = r.timestampDate ? r.timestampDate : new Date(r.timestamp * 1000);
          return {
            Timestamp: ts instanceof Date ? ts.toISOString() : new Date(ts).toISOString(),
            Steps: r.steps,
            Temperature: r.temperature,
            Flags: r.flags || 0,
            RecordType: "historical"
          };
        }),
        
        // ✅ Aggregates (for quick dashboard)
        Summary: {
          TotalSteps: totalSteps,
          StepsDelta: stepsDelta,
          LatestTemperature: latestTemperature,
          AverageTemperature: Math.round(averageTemperature * 10) / 10,
          MinTemperature: minTemperature,
          MaxTemperature: maxTemperature,
          RecordCount: records.length
        }
      };
      
      const result = await postPetHealthBLEData(payload);
      
      // ✅ FIX: Check result for success/failure
      if (result && result.success === false) {
        console.error(`❌ [HISTORICAL SYNC] Upload failed:`, result.error);
        if (result.isNetworkError) {
          console.error(`   Network error - will retry on next sync`);
        }
        // Don't mark as complete if upload failed
        return;
      }
      
      console.log(`✅ [HISTORICAL SYNC] Sent ${records.length} records successfully`);
      console.log(`   Total Steps: ${totalSteps}, Temp: ${latestTemperature}°C (avg: ${Math.round(averageTemperature * 10) / 10}°C)`);
      
      // Mark historical sync as complete
      this.historicalSyncComplete.set(deviceId, true);
      
      // Start periodic batch upload timer for live updates
      this.startBatchUploadTimer(deviceId);
      
    } catch (error) {
      // ✅ FIX: Better error handling with context
      console.error(`❌ [HISTORICAL SYNC] Upload failed:`, error);
      console.error(`   Device: ${deviceId}`);
      console.error(`   Records attempted: ${records.length}`);
      console.error(`   Error type: ${error.name || 'Unknown'}`);
      console.error(`   Error message: ${error.message || 'No message'}`);
      
      // Check if it's a network error
      if (error.message && error.message.includes('Network Error')) {
        console.error(`   ⚠️ Network error - data will be retried on next sync`);
      }
    }
  }

  /**
   * Start periodic batch upload timer
   */
  startBatchUploadTimer(deviceId) {
    // Clear existing timer
    this.stopBatchUploadTimer(deviceId);
    
    console.log(`⏰ [BATCH TIMER] Starting 5-minute batch upload timer for ${deviceId}`);
    
    const timer = setInterval(() => {
      if (this.shouldUploadBatch(deviceId)) {
        console.log(`⏰ [BATCH TIMER] Triggering batch upload for ${deviceId}`);
        this.uploadLiveBatch(deviceId);
      }
    }, 60000);  // Check every minute if upload needed
    
    this.batchUploadTimers.set(deviceId, timer);
  }

  /**
   * Stop batch upload timer
   */
  stopBatchUploadTimer(deviceId) {
    const timer = this.batchUploadTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.batchUploadTimers.delete(deviceId);
      console.log(`🛑 [BATCH TIMER] Stopped for ${deviceId}`);
    }
  }

  /**
   * Debug: Get buffer status for all devices
   */
  getBufferStatus() {
    const status = [];
    for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
      const lastUpload = this.lastBatchUpload.get(deviceId) || 0;
      const timeSinceUpload = lastUpload ? (Date.now() - lastUpload) / 1000 : 0;
      const historicalComplete = this.historicalSyncComplete.get(deviceId) || false;
      
      status.push({
        deviceId,
        bufferSize: buffer.length,
        maxBufferSize: this.liveDataConfig.bufferSize,
        timeSinceLastUpload: Math.round(timeSinceUpload),
        uploadIntervalSeconds: this.liveDataConfig.uploadInterval / 1000,
        historicalSyncComplete: historicalComplete,
        shouldUpload: this.shouldUploadBatch(deviceId),
        oldestRecord: buffer.length > 0 ? buffer[0].timestampDate : null,
        newestRecord: buffer.length > 0 ? buffer[buffer.length - 1].timestampDate : null
      });
    }
    return status;
  }

  /**
   * Debug: Force upload all buffers (for testing)
   */
  async forceUploadAllBuffers() {
    console.log(`🧪 [DEBUG] Force uploading all live data buffers...`);
    for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
      if (buffer.length > 0) {
        await this.uploadLiveBatch(deviceId);
      }
    }
  }

  /**
   * iOS event handlers
   */
  handleIOSDeviceFound(deviceInfo) {
    
    // ✅ Extract and format manufacturer data for easy UI display
    const manufacturerInfo = deviceInfo.manufacturerData || {};
    const formattedManufacturerData = {
      raw: manufacturerInfo,
      // Parsed values for UI display
      batteryLevel: manufacturerInfo.batteryLevel || null,
      batteryMillivolts: manufacturerInfo.batteryMillivolts || null,
      recordCount: manufacturerInfo.recordCount || 0,
      companyId: manufacturerInfo.companyId || null,
      deviceStatus: manufacturerInfo.deviceStatus || 0,
      indication: manufacturerInfo.indication || 0,
      macId: manufacturerInfo.macId || null,  // ✅ MAC Address
      version: manufacturerInfo.version || null,  // ✅ Firmware version from adv data
      connectIndication: manufacturerInfo.connectIndication,
      timeSet: manufacturerInfo.timeSet,
      factoryDefaults: manufacturerInfo.factoryDefaults,
      // User-friendly status
      statusText: manufacturerInfo.deviceStatus === 0 ? 'Good' : 'Problem',
      hasRecords: (manufacturerInfo.recordCount || 0) > 0,
      batteryStatus: this.getBatteryStatus(manufacturerInfo.batteryLevel)
    };
    
    // Create device object similar to ble-plx format
    const device = {
      id: deviceInfo.id,
      name: deviceInfo.name || 'Unknown',
      rssi: deviceInfo.rssi,
      manufacturerData: formattedManufacturerData,  // ✅ Enhanced manufacturer data
      serviceUUIDs: deviceInfo.advertisementData?.serviceUUIDs || [],
      advertisementData: deviceInfo.advertisementData || {},
      isConnectable: true,
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isSmartTag: this.isSmartTag(deviceInfo)
    };
    
    // Store in scanned devices
    this.scannedDevices.set(device.id, device);
    
    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
    
    // Emit device found event
    this.emit('deviceFound', device);
  }

  // Helper to get battery status text
  getBatteryStatus(batteryPercent) {
    if (!batteryPercent) return 'Unknown';
    if (batteryPercent >= 80) return 'Excellent';
    if (batteryPercent >= 50) return 'Good';
    if (batteryPercent >= 20) return 'Low';
    return 'Critical';
  }

  handleIOSDeviceConnected(deviceInfo) {
    
    const deviceId = deviceInfo.deviceId;
    
    // ✅ IMPROVED: Preserve manufacturer data (including MAC address) from previous scans
    let device = this.scannedDevices.get(deviceId);
    
    if (!device) {
      // Device not in scanned devices - create new object
      // This can happen when auto-connect connects to a known device without scanning first
      device = {
        id: deviceId,
        name: deviceInfo.deviceName || 'Unknown',
        connectionState: CONNECTION_STATES.CONNECTED,
        // ✅ Initialize empty manufacturer data structure so UI doesn't break
        manufacturerData: {
          macId: null,
          batteryLevel: null,
          recordCount: 0,
          statusText: 'Unknown'
        },
        // ✅ Initialize deviceData - battery level will come from 2A19 characteristic
        deviceData: {
          batteryLevel: null, // Will be populated from 2A19 characteristic
          temperature: null,
          steps: null,
          lastUpdate: new Date()
        }
      };
    }
    
    // Update connection state while preserving manufacturer data
    device.connectionState = CONNECTION_STATES.CONNECTED;
    device.connectedAt = new Date();
    device.lastSeen = Date.now();
    // ✅ CRITICAL: Preserve manufacturer data (including macId) from previous scan if it exists
    // MAC address only comes from advertisement packets during scanning, not from connection events
    // If device was never scanned, macId will be null - user must scan first to get MAC address
    if (!device.manufacturerData) {
      device.manufacturerData = {
        macId: null,
        batteryLevel: null,
        recordCount: 0,
        statusText: 'Unknown'
      };
    }
    
    // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
    // Disconnect all other devices before adding this one
    const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
      connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
    );
    
    if (currentlyConnectedDevices.length > 0) {
      console.log(`🔌 [iOS CONNECTED] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before connecting ${deviceId}`);
      // Disconnect other devices asynchronously (don't block the event handler)
      currentlyConnectedDevices.forEach(async (otherDeviceId) => {
        try {
          await this.disconnectFromDevice(otherDeviceId);
          console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
        }
      });
    }
    
    this.scannedDevices.set(deviceId, device);
    this.connectedDevices.set(deviceId, device);
    
    // Check if this is an auto-connect event and handle accordingly
    // For now, assume all iOS connections are auto-connect since we have auto-connect enabled
    if (deviceInfo.isAutoConnect || deviceInfo.connectionType === 'auto' || this.isAutoConnectEnabled()) {
      this.handleAutoConnectedDevice(deviceInfo);
    } else {
    }
    
    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
    
    // Emit connection event
    this.emit('deviceConnected', device);
    
    // Add connection log
    this.addConnectionLog(deviceId, 'Connected');
  }

  handleIOSDeviceDisconnected(deviceInfo) {
    
    const deviceId = deviceInfo.deviceId;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.disconnectedAt = new Date();
      device.lastSeen = Date.now();
      
      // ✅ Handle passkey change - device needs re-pairing
      if (deviceInfo.reason === 'passkey_changed' || deviceInfo.passkeyChanged) {
        console.log('🔓 [PASSKEY CHANGED] Device passkey was updated - bonding cleared');
        console.log('   💡 User must manually reconnect and enter NEW passkey');
        console.log('');
        console.log('⚠️ IMPORTANT: If reconnection fails, you must FORGET device from iOS Settings:');
        console.log('   1. Open iOS Settings → Bluetooth');
        console.log('   2. Find device: ' + deviceInfo.deviceName);
        console.log('   3. Tap (i) icon → Forget This Device');
        console.log('   4. Then reconnect from app with NEW passkey');
        console.log('');
        device.requiresRepairing = true;
        device.passkeyChanged = true;
        device.needsSystemForget = true; // Flag to show iOS Settings instruction
      }
      
      // ✅ Handle unpair - device was manually unpaired
      if (deviceInfo.reason === 'unpaired' || deviceInfo.unpaired) {
        console.log('🔓 [UNPAIRED] Device was unpaired by user');
        device.unpaired = true;
      }
      
      this.scannedDevices.set(deviceId, device);
      this.connectedDevices.delete(deviceId);
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      // Add disconnection log
      this.addConnectionLog(deviceId, 'Disconnected', {
        reason: deviceInfo.reason
      });
      
      // Emit disconnection event with additional info
      this.emit('deviceDisconnected', {
        ...device,
        reason: deviceInfo.reason,
        passkeyChanged: deviceInfo.passkeyChanged,
        requiresRepairing: deviceInfo.requiresRepairing,
        needsSystemForget: device.needsSystemForget,
        unpaired: deviceInfo.unpaired
      });
    }
  }

  handleIOSServicesDiscovered(eventData) {
    
    const deviceId = eventData.deviceId;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      // Add services with duplicate prevention
      const newServices = eventData.services || [];
      if (!device.services) {
        device.services = [];
      }
      
      // Add only new services to avoid duplicates
      let addedServiceCount = 0;
      let duplicateServiceCount = 0;
      newServices.forEach(newService => {
        const exists = device.services.some(existing => 
          existing.uuid === newService.uuid
        );
        if (!exists) {
          device.services.push(newService);
          addedServiceCount++;
        } else {
          duplicateServiceCount++;
        }
      });
      
      
      // If this is a complete service discovery (with characteristics), update characteristics too
      if (eventData.complete && eventData.services) {
        
        // Initialize characteristics array if it doesn't exist
        if (!device.characteristics) {
          device.characteristics = [];
        }
        
        // Add characteristics from each service (avoid duplicates)
        eventData.services.forEach(service => {
          if (service.characteristics) {
            const serviceCharacteristics = service.characteristics.map(char => ({
              uuid: char.uuid,
              serviceUUID: service.uuid,
              properties: char.properties,
              isNotifying: char.isNotifying
            }));
            
            // Add only new characteristics to avoid duplicates
            serviceCharacteristics.forEach(newChar => {
              const exists = device.characteristics.some(existing => 
                existing.uuid === newChar.uuid && existing.serviceUUID === newChar.serviceUUID
              );
              if (!exists) {
                device.characteristics.push(newChar);
              }
            });
            
          }
        });
        
      }
      
      this.scannedDevices.set(deviceId, device);
      
      // ✅ FIX: Start monitoring when service discovery is complete (same as Android)
      // This ensures notifications are enabled after auto-connect
      if (eventData.complete) {
        // Start monitoring with a small delay to ensure services are fully registered
        setTimeout(() => {
          this.startMonitoring(deviceId);
        }, 500);
      }
      
      // Emit services discovered event
      this.emit('servicesDiscovered', { deviceId, services: eventData.services, complete: eventData.complete });
    }
  }

  handleIOSCharacteristicsDiscovered(eventData) {
    
    const deviceId = eventData.deviceId;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      if (!device.characteristics) {
        device.characteristics = [];
      }
      
      // Add characteristics to device with proper property mapping
      const newCharacteristics = eventData.characteristics.map(char => {
        // Extract individual property flags from the properties object
        const properties = char.properties || {};
        
        // Debug logging to see what properties we're receiving from iOS
        
        return {
          uuid: char.uuid,
          serviceUUID: eventData.serviceUuid, // Use the service UUID from the event data
          properties: properties,
          isNotifying: char.isNotifying,
          // Map individual property flags for compatibility
          isReadable: properties.read || false,
          isWritable: properties.write || false,
          isWritableWithResponse: properties.writeWithResponse || false,
          isWritableWithoutResponse: properties.writeWithoutResponse || false,
          isNotifiable: properties.notify || false,
          isIndicatable: properties.indicate || false
        };
      });
      
      // Add only new characteristics to avoid duplicates
      let addedCount = 0;
      let duplicateCount = 0;
      newCharacteristics.forEach(newChar => {
        const exists = device.characteristics.some(existing => 
          existing.uuid === newChar.uuid && existing.serviceUUID === newChar.serviceUUID
        );
        if (!exists) {
          device.characteristics.push(newChar);
          addedCount++;
        } else {
          duplicateCount++;
        }
      });
      
      
      this.scannedDevices.set(deviceId, device);
      
      // Emit characteristics discovered event
      this.emit('characteristicsDiscovered', { 
        deviceId, 
        serviceUuid: eventData.serviceUuid,
        characteristics: newCharacteristics 
      });
    }
  }

  handleIOSCharacteristicData(eventData) {
    
    const deviceId = eventData.deviceId;
    const characteristicUuid = eventData.characteristicUuid;
    const data = eventData.data;
    
    // Convert hex data to base64 for consistency with Android
    let processedData = data;
    if (typeof data === 'string' && /^[0-9a-fA-F]+$/.test(data)) {
      // Data is hex string, convert to base64
      const buffer = Buffer.from(data, 'hex');
      processedData = buffer.toString('base64');
    }
    
    // Handle different characteristic types (same as Android)
    // Normalize UUIDs for comparison (handle both upper and lower case)
    const normalizedCharUuid = characteristicUuid.toLowerCase().replace(/-/g, '');
    const normalizedDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '');
    const normalizedBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.toLowerCase().replace(/-/g, '');
    const normalizedDataTransfer = BLE_CHARACTERISTICS.DATA_TRANSFER.toLowerCase().replace(/-/g, '');
    const normalizedSystemCommand = BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '');
    
    // Also check for short form UUIDs (without dashes)
    const shortCharUuid = characteristicUuid.replace(/-/g, '').toLowerCase();
    const shortDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.replace(/-/g, '').toLowerCase();
    const shortBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.replace(/-/g, '').toLowerCase();
    const shortDataTransfer = BLE_CHARACTERISTICS.DATA_TRANSFER.replace(/-/g, '').toLowerCase();
    const shortSystemCommand = BLE_CHARACTERISTICS.SYSTEM_COMMAND.replace(/-/g, '').toLowerCase();
    
    // Check for 4-character short form UUIDs (e.g., 2A19 for battery level)
    const shortFormCharUuid = normalizedCharUuid.length <= 4 ? normalizedCharUuid : normalizedCharUuid.slice(-4);

    // Check both normalized and short form UUIDs
    if (normalizedCharUuid === normalizedDeviceStatus || shortCharUuid === shortDeviceStatus) {
      this.handleDeviceStatusUpdate(deviceId, processedData);
    } else if (normalizedCharUuid === normalizedBatteryLevel || shortCharUuid === shortBatteryLevel || shortFormCharUuid === '2a19') {
      this.handleBatteryUpdate(deviceId, processedData);
    } else if (normalizedCharUuid === normalizedDataTransfer || shortCharUuid === shortDataTransfer) {
      // ✅ FIX: Don't process here - handled by dedicated DataTransfer/DataTransferEvent
      // this.handleDataTransfer(deviceId, processedData);
      // Native now sends DataTransferEvent which is handled by handleNativeDataTransferEvent()
      // Processing here would create duplicates!
      console.log(`📡 [DATA TRANSFER] Skipping CharacteristicData handler - using DataTransferEvent instead`);
    } else if (normalizedCharUuid === normalizedSystemCommand || shortCharUuid === shortSystemCommand) {
      // ✅ FIX: Don't process here - handled by dedicated SystemCommandEvent
      // this.handleSystemCommandResponse(deviceId, processedData);
      console.log(`🔧 [SYSTEM COMMAND] Skipping CharacteristicData handler - using SystemCommandEvent instead`);
    } else {
    }
    
    // Emit characteristic data event
    this.emit('characteristicData', {
      deviceId,
      characteristicUuid,
      data: processedData,
      hex: data
    });
  }

  handleIOSRSSIUpdate(eventData) {
    
    const deviceId = eventData.deviceId;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.rssi = eventData.rssi;
      this.scannedDevices.set(deviceId, device);
      
      // Emit RSSI update event
      this.emit('rssiUpdate', { deviceId, rssi: eventData.rssi });
    }
  }

  // ✅ NEW: Handle service discovery complete - triggers native command sequence
  handleServiceDiscoveryComplete = async (eventData) => {
    const { deviceId, hasSystemCommand, hasDeviceStatus, hasDataTransfer } = eventData;
    
    
    // 🔒 MUTEX: Check if already running
    if (this.requestDataMutex.get(deviceId)) {
      console.log(`⏭️ [SERVICE DISCOVERY] Skipping - command sequence already in progress for ${deviceId}`);
      return;
    }
    
    // ✅ CRITICAL FIX: Check if sync is already in progress or recently completed before starting a new one
    // This prevents duplicate sync operations when ServiceDiscoveryComplete is received multiple times
    const syncState = this.dataSyncStates?.get(deviceId);
    const currentSyncState = syncState?.state;
    
    // Check if sync is actively in progress
    if (currentSyncState === 'syncing' || currentSyncState === 'time_syncing' || currentSyncState === 'ready') {
      console.log(`⏭️ [SERVICE DISCOVERY] Skipping - sync already in progress for ${deviceId} (state: ${currentSyncState})`);
      return;
    }
    
    // ✅ CRITICAL FIX: Also check if sync was recently completed (within last 5 seconds)
    // This prevents starting a new sync immediately after the previous one completes
    if (this.autoSyncMeta) {
      const meta = this.autoSyncMeta.get(deviceId);
      if (meta?.lastSyncCompletedAt) {
        const timeSinceLastSync = Date.now() - meta.lastSyncCompletedAt;
        if (timeSinceLastSync < 5000) { // Within 5 seconds
          console.log(`⏭️ [SERVICE DISCOVERY] Skipping - sync completed ${Math.round(timeSinceLastSync / 1000)}s ago for ${deviceId} (too soon)`);
          return;
        }
      }
    }
    
    // Set mutex
    this.requestDataMutex.set(deviceId, true);
    
    try {
      // Only start command sequence if device has system command characteristic
      if (hasSystemCommand) {
        
        // ✅ PLATFORM-SPECIFIC: Call appropriate native method
        let result;
        if (Platform.OS === 'android') {
          // Android uses SampleBridgeAndroid
          result = await SampleBridgeAndroid.startCommandSequence(deviceId);
        } else {
          // iOS uses BridgingCodeModule
          result = await BridgingCodeModule.startCommandSequence(deviceId);
        }
        
        if (result.status === 'success') {
          console.log(`✅ [SERVICE DISCOVERY] Command sequence started successfully for ${deviceId}`);
        } else if (result.status === 'already_running') {
          console.log(`⏭️ [SERVICE DISCOVERY] Command sequence already running for ${deviceId}`);
        } else {
          console.log(`⚠️ [SERVICE DISCOVERY] Command sequence start returned: ${result.status} for ${deviceId}`);
        }
      } else {
        console.log(`⏭️ [SERVICE DISCOVERY] Device ${deviceId} does not have System Command characteristic - skipping command sequence`);
      }
      
      // ✅ FIX: Start monitoring to enable notifications (critical for auto-connect)
      // This ensures live notifications work after device reconnects
      setTimeout(() => {
        this.startMonitoring(deviceId);
      }, 500);
      
      // ✅ FIX: Track time sync sent time for RTC validation
      // This helps verify RTC is updated after time sync in auto-connect flow
      if (!this.timeSyncSentTimes) {
        this.timeSyncSentTimes = new Map();
      }
      this.timeSyncSentTimes.set(deviceId, Date.now());
      console.log(`⏰ [TIME SYNC] Tracked time sync sent for ${deviceId}, will verify RTC validity`);
      
      // ✅ FIX: Don't check RTC immediately - wait for next device status notification
      // The device needs to send a NEW device status notification with updated RTC
      // The current device.deviceData.lastUpdate is from BEFORE time sync
      // RTC validation will happen in handleDeviceStatusUpdate when next notification arrives
      console.log(`⏰ [AUTO TIME SYNC] Time sync sent - will verify RTC when next device status notification arrives`);
      
      // ✅ REMOVED: JavaScript fallback polling - native polling handles this now
      // Native polling starts automatically after SET_DATA_ACQUISITION_INTERVAL command (0x04)
      // Android: ScheduledExecutorService in SampleBridgeAndroid.java
      // iOS: Timer.scheduledTimer in BridgingCodeModule.swift
      console.log(`✅ [POLLING] Native polling will start after SET_DATA_ACQUISITION_INTERVAL command`);
      
      // Read initial characteristics via JS (battery, device status, etc.)
      setTimeout(() => {
        this.readAllCharacteristics(deviceId);
      }, 1000);
      
    } catch (error) {
    } finally {
      // Release mutex after a delay (native sequence takes time)
      setTimeout(() => {
        this.requestDataMutex.delete(deviceId);
      }, 2000);
    }
  }

  /**
   * Android event handlers
   */
  handleAndroidDeviceFound(deviceInfo) {
    
    // ✅ Extract and format manufacturer data for easy UI display (same as iOS)
    const manufacturerInfo = deviceInfo.manufacturerData || {};
    const formattedManufacturerData = {
      raw: manufacturerInfo,
      // Parsed values for UI display
      batteryLevel: manufacturerInfo.batteryLevel !== undefined ? manufacturerInfo.batteryLevel : null,
      batteryMillivolts: manufacturerInfo.batteryMillivolts !== undefined ? manufacturerInfo.batteryMillivolts : null,
      recordCount: manufacturerInfo.recordCount !== undefined ? manufacturerInfo.recordCount : 0,
      companyId: manufacturerInfo.companyId !== undefined ? manufacturerInfo.companyId : null,
      deviceStatus: manufacturerInfo.deviceStatus !== undefined ? manufacturerInfo.deviceStatus : 0,
      indication: manufacturerInfo.indication !== undefined ? manufacturerInfo.indication : 0,
      macId: manufacturerInfo.macId || null,  // ✅ MAC Address
      version: manufacturerInfo.version !== undefined ? manufacturerInfo.version : null,  // ✅ Firmware version from adv data (allow 0)
      connectIndication: manufacturerInfo.connectIndication,
      timeSet: manufacturerInfo.timeSet,
      factoryDefaults: manufacturerInfo.factoryDefaults,
      // User-friendly status
      statusText: manufacturerInfo.deviceStatus === 0 ? 'Good' : 'Problem',
      hasRecords: (manufacturerInfo.recordCount || 0) > 0,
      batteryStatus: this.getBatteryStatus(manufacturerInfo.batteryLevel)
    };
    
    const device = {
      id: deviceInfo.deviceId,
      name: deviceInfo.deviceName || 'Unknown Device',
      rssi: deviceInfo.rssi || -100,
      isConnectable: deviceInfo.isConnectable !== false,
      manufacturerData: formattedManufacturerData,  // ✅ Enhanced manufacturer data
      deviceData: {
        batteryLevel: null,  // ✅ Will be populated from 2A19 characteristic when connected (more accurate than manufacturer data)
        temperature: null,
        steps: null,
        lastUpdate: new Date()
      },
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isSmartTag: this.isSmartTag(deviceInfo)
    };

    this.scannedDevices.set(device.id, device);
    
    // ✅ CRITICAL FIX: Emit deviceFound event (matching iOS behavior)
    // This allows UI components to listen for device discoveries
    this.emit('deviceFound', device);
    
    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    } else {
    }
  }

  handleAndroidConnectionStateChange(event) {
    const { deviceId, connectionState } = event;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.connectionState = connectionState;
      
      if (connectionState === CONNECTION_STATES.CONNECTED) {
        // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
        // Disconnect all other devices before adding this one
        const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
          connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
        );
        
        if (currentlyConnectedDevices.length > 0) {
          console.log(`🔌 [ANDROID CONNECTION STATE] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before connecting ${deviceId}`);
          // Disconnect other devices asynchronously (don't block the event handler)
          currentlyConnectedDevices.forEach(async (otherDeviceId) => {
            try {
              await this.disconnectFromDevice(otherDeviceId);
              console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
            } catch (error) {
              console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
            }
          });
        }
        
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
    // Normalize UUIDs for comparison (handle both upper and lower case)
    const normalizedCharUuid = characteristicUuid.toLowerCase().replace(/-/g, '');
    const normalizedDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '');
    const normalizedBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.toLowerCase().replace(/-/g, '');
    const normalizedDataTransfer = BLE_CHARACTERISTICS.DATA_TRANSFER.toLowerCase().replace(/-/g, '');
    const normalizedSystemCommand = BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '');

    if (normalizedCharUuid === normalizedDeviceStatus) {
      this.handleDeviceStatusUpdate(deviceId, data);
    } else if (normalizedCharUuid === normalizedBatteryLevel) {
      this.handleBatteryUpdate(deviceId, data);
    } else if (normalizedCharUuid === normalizedDataTransfer) {
      // ✅ FIX: Don't process here - handled by dedicated DataTransferEvent
      // this.handleDataTransfer(deviceId, data);
      // Native now sends DataTransferEvent which is handled by handleNativeDataTransferEvent()
      // Processing here would create duplicates!
      console.log(`📡 [DATA TRANSFER] Skipping CharacteristicData handler - using DataTransferEvent instead`);
    } else if (normalizedCharUuid === normalizedSystemCommand) {
      // ✅ FIX: Don't process here - handled by dedicated SystemCommandEvent
      // this.handleSystemCommandResponse(deviceId, data);
      console.log(`🔧 [SYSTEM COMMAND] Skipping CharacteristicData handler - using SystemCommandEvent instead`);
    } else {
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
    
    const { deviceId, deviceName, error } = event;
    
    // Use the same handler as auto-connect disconnection for consistency
    this.handleAutoDisconnectedDevice({
      deviceId,
      deviceName: deviceName || 'Unknown Device',
      error: error || 'disconnected'
    });
  }

  handleAndroidDeviceReconnected(event) {
    
    const { deviceId, deviceName } = event;
    
    // Update device state to connected
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.CONNECTED;
      device.connectedAt = new Date();
      device.lastSeen = Date.now();
      this.scannedDevices.set(deviceId, device);
      
      // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
      // Disconnect all other devices before adding this one
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      
      if (currentlyConnectedDevices.length > 0) {
        console.log(`🔌 [ANDROID RECONNECT] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before reconnecting ${deviceId}`);
        // Disconnect other devices asynchronously (don't block the event handler)
        currentlyConnectedDevices.forEach(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
            console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          }
        });
      }
      
      // Add to connected devices
      this.connectedDevices.set(deviceId, device);
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
    }
  }

  handleAndroidDeviceConnected(event) {
    
    const { deviceId, deviceName } = event;
    
    // Update device state to connected
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.CONNECTED;
      device.connectedAt = new Date();
      device.lastSeen = Date.now();
      device.connectionType = 'manual';
      // ✅ CRITICAL: Preserve manufacturerData (including MAC address) when updating connection state
      // Don't overwrite it - MAC address only comes from advertisement packets during scanning
      if (!device.manufacturerData) {
        device.manufacturerData = {
          macId: null,
          batteryLevel: null,
          recordCount: 0,
          statusText: 'Unknown'
        };
      }
      this.scannedDevices.set(deviceId, device);
      
      // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
      // Disconnect all other devices before adding this one
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      
      if (currentlyConnectedDevices.length > 0) {
        console.log(`🔌 [ANDROID CONNECTED] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before connecting ${deviceId}`);
        // Disconnect other devices asynchronously (don't block the event handler)
        currentlyConnectedDevices.forEach(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
            console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          }
        });
      }
      
      // Add to connected devices
      this.connectedDevices.set(deviceId, device);
      
      // ✅ CLEAN ARCHITECTURE: Just load services, native handles command sequence
      setTimeout(async () => {
        try {
          await this.loadDeviceServices(deviceId);
          
          // ServiceDiscoveryComplete event will trigger native command sequence
          
          // Start adaptive API calling
          setTimeout(() => {
            this.startAdaptiveApiCalling(deviceId);
          }, 3000);
          
        } catch (error) {
        }
      }, 500);
      
      // ✅ CRITICAL FIX: Emit deviceConnected event (matching iOS behavior)
      // This allows UI components to listen for connection events
      this.emit('deviceConnected', device);
      
      // Add connection log
      this.addConnectionLog(deviceId, 'Connected');
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
    }
  }

  // ✅ FIX: Renamed from handleAndroidDeviceDataUpdated to handleDeviceDataUpdated
  // This method handles DeviceDataUpdated events from BOTH iOS and Android
  // iOS sends: deviceId, batteryLevel, steps, temperature, timestamp, isFromPolling, recordCount, rtcValid, etc.
  // Android sends: deviceId, batteryLevel, steps, temperature, timestamp (legacy format)
  async handleDeviceDataUpdated(event) {
    // ✅ CRITICAL: Log IMMEDIATELY to verify handler is called
    console.log(`🔔 [HANDLER] handleDeviceDataUpdated CALLED with event:`, {
      deviceId: event?.deviceId,
      hasEvent: !!event,
      eventKeys: event ? Object.keys(event) : []
    });
    
    // ✅ CRITICAL FIX: Extract deviceId FIRST to enable debug logging even if device not found
    const deviceId = event?.deviceId;
    
    // ✅ DEBUG: Log full event structure BEFORE any early returns to diagnose isFromPolling issue
    // This will help us see what's actually in the event even if device lookup fails
    console.log(`📊 [EVENT DEBUG] DeviceDataUpdated event for ${deviceId || 'UNKNOWN'}:`, {
      hasIsFromPolling: 'isFromPolling' in event,
      isFromPollingValue: event?.isFromPolling,
      isFromPollingType: typeof event?.isFromPolling,
      allEventKeys: Object.keys(event || {}),
      pollingRelatedKeys: Object.keys(event || {}).filter(k => k.toLowerCase().includes('polling') || k === 'isFromPolling'),
      fullEvent: JSON.stringify(event, null, 2).substring(0, 500) // First 500 chars for debugging
    });
    
    // ✅ FIX: Extract all fields from event, including isFromPolling from iOS
    // ✅ CRITICAL: iOS sends recordCount and rtcValid at top level (merged from deviceData)
    // ✅ ANDROID FIX: Android sends isFromPolling inside deviceData object, not at top level
    const { 
      batteryLevel, 
      steps, 
      temperature, 
      timestamp,
      // ✅ iOS fields (sent at top level after merge in sendDeviceDataUpdateEvent)
      isFromPolling: isFromPollingTop,
      recordCount,
      rtcValid,
      deviceRTC,
      batteryVoltage,
      dataSource,
      deviceData: eventDeviceData
    } = event || {};
    
    // ✅ CRITICAL FIX: Check BOTH locations for isFromPolling (iOS vs Android)
    // iOS sends at top level, Android sends inside deviceData
    const isFromPolling = isFromPollingTop !== undefined 
      ? isFromPollingTop 
      : eventDeviceData?.isFromPolling;
    
    // ✅ DEBUG: Log extracted values to diagnose auto-sync issue
    console.log(`🔍 [EXTRACT DEBUG] Extracted from event for ${deviceId}:`, {
      recordCount,
      rtcValid,
      isFromPolling,
      hasRecordCount: recordCount !== undefined,
      hasRtcValid: rtcValid !== undefined,
      recordCountValue: recordCount,
      rtcValidValue: rtcValid
    });
    
    // ✅ FIX: Log isFromPolling value for debugging (before device lookup)
    if (isFromPolling !== undefined) {
      console.log(`📊 [EVENT] Received DeviceDataUpdated with isFromPolling=${isFromPolling} (type: ${typeof isFromPolling}) for ${deviceId}`);
    } else {
      console.log(`⚠️ [EVENT] DeviceDataUpdated event missing isFromPolling field for ${deviceId}`);
    }
    
    if (!deviceId) {
      console.warn(`⚠️ [EVENT] DeviceDataUpdated event missing deviceId`);
      return;
    }
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ [EVENT] DeviceDataUpdated event for unknown device: ${deviceId}`);
      return;
    }

    // ✅ CRITICAL: Don't overwrite synced data with stale characteristic reads!
    // Check if incoming data is stale (before 2020) and we already have synced data
    const incomingDate = timestamp ? new Date(timestamp * 1000) : null;
    const isStaleData = incomingDate && incomingDate < new Date('2020-01-01');
    const hasSyncedData = device.deviceData?.dataSource === 'synced';
    
    if (isStaleData && hasSyncedData) {
      console.log(`⏭️ [ANDROID] Skipping stale read (${incomingDate.toISOString()}) - already have synced data`);
      
      // Only update battery level (it doesn't come from sync)
      if (batteryLevel !== undefined) {
        device.deviceData.batteryLevel = batteryLevel;
        this.scannedDevices.set(deviceId, device);
        
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      }
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
    
    // ✅ CRITICAL FIX: Determine dataSource based on timestamp validity
    const timestampMs = timestamp ? (typeof timestamp === 'number' ? timestamp : timestamp * 1000) : null;
    const isLiveDataForDataSource = timestampMs && new Date(timestampMs).getTime() > 1577836800000; // After 2020-01-01
    
    // ✅ PRIORITY: Battery level from 2A19 characteristic always takes priority over manufacturer data
    // Only use manufacturer data battery level if we don't have a value from the characteristic
    const batteryLevelToUse = batteryLevel !== undefined 
      ? batteryLevel  // Use battery level from 2A19 characteristic (most accurate)
      : (device.deviceData?.batteryLevel || null); // Fallback to existing value, don't overwrite with manufacturer data
    
    device.deviceData = {
      ...device.deviceData,
      batteryLevel: batteryLevelToUse,
      steps: steps !== undefined ? steps : device.deviceData.steps,
      temperature: temperature !== undefined ? temperature : device.deviceData.temperature,
      timestamp: timestamp ? new Date(timestamp * 1000) : device.deviceData.timestamp,
      // Mark as live data if timestamp is valid, otherwise preserve existing dataSource
      dataSource: isLiveDataForDataSource ? 'live' : (device.deviceData?.dataSource || 'cached'),
      // Preserve existing lastUpdate (device RTC) if available, otherwise use current time
      lastUpdate: device.deviceData.lastUpdate || new Date()
    };

    this.scannedDevices.set(deviceId, device);

    // Log data changes
    const dataChanged = previousData.steps !== device.deviceData.steps ||
      previousData.temperature !== device.deviceData.temperature ||
      previousData.batteryLevel !== device.deviceData.batteryLevel;

    if (dataChanged) {
      console.log(`📊 [ANDROID] Device data updated - Steps: ${device.deviceData.steps}, Temp: ${device.deviceData.temperature}°C, Battery: ${device.deviceData.batteryLevel}%`);
    }

    // ✅ CRITICAL FIX: Trigger device list update callback to refresh UI (matching iOS behavior)
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }

    // Trigger UI update callback if available and app is active
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
      
      // Store the latest data for when app comes back to foreground
      if (!this.pendingUIUpdates) {
        this.pendingUIUpdates = new Map();
      }
      this.pendingUIUpdates.set(deviceId, device.deviceData);
    }
    
    // ✅ INDUSTRY STANDARD: Buffer live data for periodic batch upload
    // Only buffer if historical sync is complete and timestamp is valid
    const isHistoricalSyncComplete = this.historicalSyncComplete.get(deviceId);
    const timestampValue = timestamp ? (typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()) / 1000 : 0;
    const isLiveDataForBuffer = timestampValue > 1577836800; // After 2020-01-01
    
    if (dataChanged && isHistoricalSyncComplete && isLiveDataForBuffer) {
      console.log(`📊 [LIVE DATA] Buffering Device Status update for ${deviceId}`);
      
      // Add to live buffer
      this.addToLiveBuffer(deviceId, {
        timestamp: timestampValue,
        timestampDate: timestamp ? new Date(timestamp) : new Date(),
        steps: device.deviceData.steps,
        temperature: device.deviceData.temperature,
        batteryLevel: device.deviceData.batteryLevel
      });
      
      // Check for immediate alerts
      const alertSent = await this.checkImmediateAlert(deviceId, {
        temperature: device.deviceData.temperature,
        steps: device.deviceData.steps,
        batteryLevel: device.deviceData.batteryLevel,
        timestampDate: timestamp ? new Date(timestamp) : new Date()
      });
      
      // Upload batch if needed
      if (this.shouldUploadBatch(deviceId)) {
        console.log(`📤 [AUTO UPLOAD] Batch upload triggered for ${deviceId}`);
        await this.uploadLiveBatch(deviceId);
      }
    } else if (!isLiveDataForBuffer) {
      console.log(`📦 [CACHED DATA] Skipping buffer - timestamp: ${timestampValue}`);
    }
    
    // ✅ CRITICAL FIX: Trigger auto-sync for iOS (matching Android behavior)
    // iOS sends DeviceDataUpdated event with isFromPolling, recordCount, rtcValid, etc.
    // ✅ CRITICAL FIX: Check for recordCount at top level OR in deviceData
    const eventRecordCount = recordCount !== undefined ? recordCount : (event?.deviceData?.recordCount);
    const eventRtcValid = rtcValid !== undefined ? rtcValid : (event?.deviceData?.rtcValid);
    
    // ✅ CRITICAL DEBUG: Always log pre-check to diagnose auto-sync issues
    console.log(`🔍 [AUTO SYNC PRE-CHECK] Platform: ${Platform.OS}, deviceId: ${deviceId}, eventRecordCount: ${eventRecordCount}, eventRtcValid: ${eventRtcValid}, hasRecordCount: ${eventRecordCount !== undefined}, hasRtcValid: ${eventRtcValid !== undefined}`);
    
    // ✅ CRITICAL FIX: Trigger auto-sync for BOTH iOS and Android when recordCount or rtcValid is present
    // This should trigger even if ServiceDiscoveryComplete wasn't sent (fallback mechanism)
    if (eventRecordCount !== undefined || eventRtcValid !== undefined) {
      const parsedData = {
        recordCount: eventRecordCount !== undefined ? eventRecordCount : device.deviceData?.recordCount,
        rtcValid: eventRtcValid !== undefined ? eventRtcValid : (device.deviceData?.rtcValid ?? true),
        deviceRTC: deviceRTC || (timestamp ? Math.floor(timestamp / 1000) : undefined),
        isFromPolling: isFromPolling !== undefined ? isFromPolling : false, // ✅ Use value from event, default to false
        dataSource: dataSource || device.deviceData?.dataSource
      };
      
      console.log(`🔍 [AUTO SYNC DEBUG] Triggering auto-sync check for ${deviceId} (${Platform.OS}):`, {
        recordCount: parsedData.recordCount,
        rtcValid: parsedData.rtcValid,
        isFromPolling: parsedData.isFromPolling,
        hasRecords: parsedData.recordCount > 0
      });
      
      // ✅ CRITICAL FIX: Use await to ensure async execution completes
      // Pass isFromPolling from event to auto-sync logic
      try {
        await this.maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData);
      } catch (error) {
        // Ignore errors - auto-sync is best effort
        console.error(`❌ [AUTO SYNC] Error in maybeTriggerAutoSyncFromDeviceStatus:`, error);
      }
    } else {
      console.log(`⏭️ [AUTO SYNC] Skipping auto-sync check for ${deviceId}:`, {
        platform: Platform.OS,
        hasRecordCount: eventRecordCount !== undefined,
        hasRtcValid: eventRtcValid !== undefined,
        recordCount: eventRecordCount,
        rtcValid: eventRtcValid,
        reason: (eventRecordCount === undefined && eventRtcValid === undefined) ? 'no recordCount or rtcValid' : 'unknown'
      });
    }
  }

  // ✅ CRITICAL FIX: Handle deviceDataUpdate events from Android (matching iOS format)
  // This handles the new event format that includes type, deviceData, etc.
  async handleAndroidDeviceDataUpdateEvent(event) {
    const { deviceId, type, deviceData: eventDeviceData, batteryLevel, batteryVoltage, recordCount, timestamp, rtcValid } = event;
    // ✅ FIX: Extract isFromPolling from eventDeviceData (where native layer puts it)
    // ✅ DEBUG: Log event structure to verify isFromPolling is present
    if (type === 'device_status' && eventDeviceData) {
      console.log(`🔍 [DEBUG] Event structure for ${deviceId}:`, {
        hasDeviceData: !!eventDeviceData,
        isFromPolling: eventDeviceData.isFromPolling,
        isFromPollingType: typeof eventDeviceData.isFromPolling,
        deviceDataKeys: Object.keys(eventDeviceData || {})
      });
    }
    const isFromPolling = eventDeviceData?.isFromPolling === true;
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.log(`⚠️ [ANDROID] Device not found for deviceDataUpdate event: ${deviceId}`);
      return;
    }

    // Initialize deviceData if needed
    if (!device.deviceData) {
      device.deviceData = {
        batteryLevel: null,
        temperature: null,
        steps: null,
        recordCount: null,
        lastUpdate: new Date()
      };
    }

    const previousData = { ...device.deviceData };

    // Update device data from event
    if (type === 'device_status') {
      // Device Status update (SDD v1.4 format)
      const timestampMs = timestamp || (eventDeviceData?.lastUpdate);
      const isLiveData = rtcValid && timestampMs && new Date(timestampMs).getTime() > 1577836800000; // After 2020-01-01
      
      // ✅ PRIORITY: Don't overwrite battery level from 2A19 with Device Status battery level
      // Battery Service (2A19) is the standard and more accurate source for battery percentage
      // Device Status battery voltage can be kept for reference, but percentage comes from 2A19
      // ✅ FALLBACK: If 2A19 is not available, calculate from voltage (2000mV = 0%, 3000mV = 100%)
      let batteryLevelToUse = device.deviceData?.batteryLevel !== null && device.deviceData?.batteryLevel !== undefined
        ? device.deviceData.batteryLevel  // Keep existing battery level from 2A19 (if available)
        : null;
      
      // If no 2A19 value, calculate from voltage if available
      // Linear scale: 0mV = 0%, 3000mV = 100%
      if (batteryLevelToUse === null && batteryVoltage !== undefined && batteryVoltage !== null) {
        const BATTERY_MIN_MV = 0;    // 0% battery
        const BATTERY_MAX_MV = 3000; // 100% battery
        if (batteryVoltage >= BATTERY_MIN_MV && batteryVoltage <= BATTERY_MAX_MV) {
          batteryLevelToUse = Math.round((batteryVoltage / BATTERY_MAX_MV) * 100);
        } else if (batteryVoltage > BATTERY_MAX_MV) {
          batteryLevelToUse = 100;
        } else if (batteryVoltage < BATTERY_MIN_MV) {
          batteryLevelToUse = 0;
        }
      }
      
      // ✅ CRITICAL FIX: Explicitly preserve temperature and steps when device_status event comes
      // Device Status characteristic (SDD v1.4) does NOT contain temperature or steps
      // These values come from Data Transfer records during sync, so we MUST preserve them
      const preservedTemperature = device.deviceData.temperature;
      const preservedSteps = device.deviceData.steps;
      
      // ✅ CRITICAL FIX: Always use recordCount from event data (Device Status read), never fall back to old value
      // After sync completes, device may immediately have NEW records, we must show the fresh count
      const freshRecordCount = recordCount !== undefined ? recordCount : (eventDeviceData?.recordCount);
      
      device.deviceData = {
        ...device.deviceData,
        batteryLevel: batteryLevelToUse, // Use 2A19 battery level (priority) or Device Status as fallback
        batteryVoltage: batteryVoltage !== undefined ? batteryVoltage : (eventDeviceData?.batteryVoltage ?? device.deviceData.batteryVoltage),
        recordCount: freshRecordCount !== undefined ? freshRecordCount : device.deviceData.recordCount, // Use fresh value if available
        // ✅ CRITICAL FIX: Explicitly preserve temperature and steps (device_status doesn't have these)
        temperature: preservedTemperature,
        steps: preservedSteps,
        // Mark as live data if RTC is valid and timestamp is recent
        dataSource: isLiveData ? 'live' : (device.deviceData?.dataSource || 'cached'),
        lastUpdate: timestampMs ? new Date(timestampMs) : (eventDeviceData?.lastUpdate ? new Date(eventDeviceData.lastUpdate) : device.deviceData.lastUpdate || new Date()),
        rtcValid: rtcValid !== undefined ? rtcValid : (eventDeviceData?.rtcValid ?? device.deviceData.rtcValid)
      };

      // Update manufacturerData.recordCount for UI consistency
      if (device.deviceData.recordCount !== undefined && device.manufacturerData) {
        device.manufacturerData.recordCount = device.deviceData.recordCount;
        device.manufacturerData.hasRecords = device.deviceData.recordCount > 0;
      }

      // ✅ AUTO-SYNC: Align Android with iOS by using the shared helper
      // ✅ FIX: Pass isFromPolling flag from event data
      this.maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, {
        recordCount: device.deviceData.recordCount,
        rtcValid: device.deviceData.rtcValid ?? rtcValid,
        deviceRTC: timestampMs ? Math.floor(timestampMs / 1000) : undefined,
        isFromPolling: isFromPolling, // ✅ Pass polling flag extracted from event
      }).catch((error) => {
        // Ignore errors - auto-sync is best effort
      });
    } else if (type === 'live_data') {
      // ✅ LIVE DATA: Live steps/temperature update (compact device data format)
      const timestampMs = timestamp || (eventDeviceData?.lastUpdate);
      const isLiveData = rtcValid && timestampMs && new Date(timestampMs).getTime() > 1577836800000;
      
      device.deviceData = {
        ...device.deviceData,
        batteryLevel: batteryLevel !== undefined ? batteryLevel : (eventDeviceData?.batteryLevel ?? device.deviceData.batteryLevel),
        steps: event.steps !== undefined ? event.steps : (eventDeviceData?.steps ?? device.deviceData.steps),
        temperature: event.temperature !== undefined ? event.temperature : (eventDeviceData?.temperature ?? device.deviceData.temperature),
        dataSource: isLiveData ? 'live' : (device.deviceData?.dataSource || 'cached'),
        lastUpdate: timestampMs ? new Date(timestampMs) : (eventDeviceData?.lastUpdate ? new Date(eventDeviceData.lastUpdate) : device.deviceData.lastUpdate || new Date()),
        rtcValid: rtcValid !== undefined ? rtcValid : (eventDeviceData?.rtcValid ?? device.deviceData.rtcValid)
      };
      
      console.log(`📊 [ANDROID] Live data updated via deviceDataUpdate - Steps: ${device.deviceData.steps}, Temp: ${device.deviceData.temperature}°C, Battery: ${device.deviceData.batteryLevel}%`);
    } else if (type === 'sync_records') {
      // ✅ SYNC RECORDS: Live sync progress update (matching iOS behavior)
      // Note: event parameter contains the sync_records data from Android
      const recordsReceived = event.recordsReceived || 0;
      const totalReceived = event.totalReceived || 0;
      const totalExpected = event.totalExpected || 0;
      
      console.log(`📊 [ANDROID] Sync progress via deviceDataUpdate - ${totalReceived}/${totalExpected} records received`);
      
      // Calculate remaining records
      const remainingRecords = Math.max(0, totalExpected - totalReceived);
      
      // Update device data with sync progress and remaining record count
      device.deviceData = {
        ...device.deviceData,
        recordCount: remainingRecords, // Update with remaining records
        syncProgress: {
          totalReceived,
          totalExpected,
          recordsReceived
        }
      };
      
      // Update manufacturerData.recordCount if available
      if (device.manufacturerData) {
        device.manufacturerData.recordCount = remainingRecords;
        device.manufacturerData.hasRecords = remainingRecords > 0;
      }
    } else if (type === 'sync_complete') {
      // ✅ SYNC COMPLETE: Sync finished, update record count (matching iOS behavior)
      // Note: event parameter contains the sync_complete data from Android
      // ✅ CRITICAL FIX: After successful sync, recordCount should ALWAYS be 0 (all records cleared from device)
      // Even if Android sends a different value, after successful sync the device has 0 records
      const syncSuccess = event.success !== false; // Default to true if not specified
      const finalRecordCount = syncSuccess ? 0 : (event.recordCount !== undefined ? event.recordCount : 0);
      
      console.log(`📊 [ANDROID] Sync complete via deviceDataUpdate - Success: ${syncSuccess}, Final record count: ${finalRecordCount}`);
      
      // ✅ CRITICAL FIX: Mark sync completion time to prevent device_status from overwriting recordCount
      if (!this.autoSyncMeta) {
        this.autoSyncMeta = new Map();
      }
      const meta = this.autoSyncMeta.get(deviceId) || {};
      meta.lastSyncCompletedAt = Date.now();
      meta.syncCompletedRecordCount = finalRecordCount; // Store the recordCount at sync completion (should be 0)
      this.autoSyncMeta.set(deviceId, meta);
      
      // ✅ CRITICAL FIX: Preserve temperature, steps, and totalSteps from synced data
      // The sync_complete event doesn't contain these values, so we MUST preserve them from the sync
      const preservedTemperature = device.deviceData.temperature;
      const preservedSteps = device.deviceData.steps;
      const preservedTotalSteps = device.deviceData.totalSteps;
      const preservedBatteryLevel = device.deviceData.batteryLevel;
      
      // Update device data with final record count
      device.deviceData = {
        ...device.deviceData,
        recordCount: finalRecordCount, // Always 0 after successful sync
        syncedAt: new Date(), // ✅ CRITICAL: Mark when sync completed for grace period check
        // ✅ CRITICAL: Explicitly preserve synced data (temperature, steps, totalSteps)
        // sync_complete event only contains recordCount and batteryLevel, not temperature/steps
        temperature: preservedTemperature,
        steps: preservedSteps,
        totalSteps: preservedTotalSteps,
        // Only update battery if provided in event, otherwise preserve
        batteryLevel: eventDeviceData?.batteryLevel ?? preservedBatteryLevel,
      };
      
      // Update manufacturerData.recordCount for UI consistency
      if (device.manufacturerData) {
        device.manufacturerData.recordCount = finalRecordCount; // Always 0 after successful sync
        device.manufacturerData.hasRecords = finalRecordCount > 0;
      }
      
      // Clear sync progress
      if (device.deviceData.syncProgress) {
        delete device.deviceData.syncProgress;
      }
    }

    this.scannedDevices.set(deviceId, device);

    // Log data changes (check all fields for live data updates)
    const dataChanged = previousData.batteryLevel !== device.deviceData.batteryLevel ||
      previousData.recordCount !== device.deviceData.recordCount ||
      previousData.steps !== device.deviceData.steps ||
      previousData.temperature !== device.deviceData.temperature;

    if (dataChanged) {
      console.log(`📊 [ANDROID] Device data updated via deviceDataUpdate event - Steps: ${device.deviceData.steps}, Temp: ${device.deviceData.temperature}°C, Battery: ${device.deviceData.batteryLevel}%, Records: ${device.deviceData.recordCount}, DataSource: ${device.deviceData.dataSource}`);
    }

    // ✅ CRITICAL FIX: Trigger device list update callback to refresh UI
    if (this.onDeviceListUpdated && dataChanged) {
      this.onDeviceListUpdated();
    }

    // ✅ CRITICAL FIX: Trigger UI update callback - for sync events always trigger, others only if data changed
    const shouldTriggerCallback = (type === 'sync_records' || type === 'sync_complete') || dataChanged;
    
    if (shouldTriggerCallback) {
      if (this.onDeviceDataUpdated && this.appState === 'active') {
        this.onDeviceDataUpdated(deviceId, device.deviceData);
      } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
        // Store the latest data for when app comes back to foreground
        if (!this.pendingUIUpdates) {
          this.pendingUIUpdates = new Map();
        }
        this.pendingUIUpdates.set(deviceId, device.deviceData);
      }
    }
    
    // ✅ CRITICAL: Emit deviceDataUpdate event for ModernBLEManager listeners
    // Emit for all types (live_data, device_status, sync_records, sync_complete)
    // Sync events always emit to show progress, others only if data changed
    const shouldEmit = (type === 'sync_records' || type === 'sync_complete') || (dataChanged && (type === 'live_data' || type === 'device_status'));
    
    if (shouldEmit) {
      const emitData = {
        deviceId,
        type: type, // Pass through the type
        deviceData: device.deviceData,
        // Include relevant fields based on type
        ...(type === 'live_data' && {
          steps: device.deviceData.steps,
          temperature: device.deviceData.temperature,
        }),
        ...(type === 'device_status' && {
          recordCount: device.deviceData.recordCount,
          batteryLevel: device.deviceData.batteryLevel,
          // ✅ CRITICAL FIX: Include sync completion info to prevent overwriting recordCount
          syncJustCompleted: (() => {
            if (!this.autoSyncMeta) return false;
            const meta = this.autoSyncMeta.get(deviceId);
            if (!meta || !meta.lastSyncCompletedAt) return false;
            const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
            return timeSinceSync < 15000; // 15 second grace period (device needs time to clear flash and generate new records)
          })(),
          syncCompletedRecordCount: (() => {
            if (!this.autoSyncMeta) return undefined;
            const meta = this.autoSyncMeta.get(deviceId);
            return meta?.syncCompletedRecordCount;
          })()
        }),
        ...(type === 'sync_records' && {
          recordsReceived: event.recordsReceived || 0,
          totalReceived: event.totalReceived || 0,
          totalExpected: event.totalExpected || 0,
        }),
        ...(type === 'sync_complete' && {
          recordCount: device.deviceData.recordCount,
          recordsTransmitted: event.recordsTransmitted || 0,
          totalRecords: event.totalRecords || 0,
        })
      };
      
      console.log(`📤 [BLEService] Emitting deviceDataUpdate event:`, emitData.type, `for device:`, deviceId);
      this.emit('deviceDataUpdate', emitData);
    }
  }

  handleAndroidServicesDiscovered(event) {
    const { deviceId, services, characteristics } = event;
    
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
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


    // Start monitoring now that services are discovered
    this.startMonitoring(deviceId);

    // Trigger device list update callback
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
  }

  setLowPowerMode(enabled) {
    this.profile = (enabled ? POWER_PROFILE?.lowPower : POWER_PROFILE?.default) || this.profile;
    if (this.connectedDevices.size > 0) {
      this.stopConnectionHealthCheck();
      this.startConnectionHealthCheck();
    }
  }

  // Enhanced power mode with ultra-low power option
  setPowerProfile(profileName) {
    
    const profile = POWER_PROFILE[profileName];
    if (!profile) {
      return;
    }
    
    const oldProfile = this.getCurrentProfileName();
    this.profile = profile;
    
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
      return;
    }

    if (this.connectedDevices.size === 0) {
      return;
    }

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.rssiCycleIntervalMs || 30000;

    this.rssiCycleActive = true;
    this.rssiCycleTimer = setInterval(() => {
      this.performRssiCycle();
    }, interval);

    // Perform initial RSSI measurement
    this.performRssiCycle();
  }

  /**
   * Stop RSSI cycle monitoring
   */
  stopRssiCycle() {
    if (!this.rssiCycleActive) {
      return;
    }

    const currentProfile = this.getCurrentProfileName();
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
    
    this.stopRssiCycle();
    
    // Small delay to ensure clean restart
    setTimeout(() => {
      if (this.connectedDevices.size > 0) {
        this.startRssiCycle();
      }
    }, 100);
  }

  /**
   * Perform RSSI cycle measurement for all connected devices
   */
  async performRssiCycle() {
    if (!this.rssiCycleActive || this.connectedDevices.size === 0) {
      return;
    }

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.rssiCycleIntervalMs || 30000;
    
    const cycleDuration = this.profile.rssiCycleDurationMs || 3000;
    const startTime = Date.now();
    
    // Measure RSSI for each connected device
    const deviceIds = Array.from(this.connectedDevices.keys());
    
    const rssiPromises = deviceIds.map(deviceId => 
      this.measureDeviceRssi(deviceId)
    );

    try {
      await Promise.allSettled(rssiPromises);
      
      const cycleTime = Date.now() - startTime;
      
      // Emit RSSI cycle completed event
      this.emit('rssiCycleCompleted', {
        deviceCount: this.connectedDevices.size,
        cycleTime,
        timestamp: Date.now()
      });
      
    } catch (error) {
    }
  }

  /**
   * Measure RSSI for a specific device
   */
  async measureDeviceRssi(deviceId) {
    try {
      const device = this.connectedDevices.get(deviceId);
      if (!device) {
        return;
      }

      
      let rssi;
      if (Platform.OS === 'android') {
        // Use native Android RSSI reading
        try {
          const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          rssi = result;
        } catch (error) {
          return { success: false, error: 'SMART_TAG service not available' };
        }
      } else {
        // iOS uses native bridge RSSI reading
        try {
          const result = await BridgingCodeModule.readRSSI(deviceId);
          // Handle both object and direct value responses
          rssi = typeof result === 'object' && result.rssi !== undefined ? result.rssi : result;
        } catch (error) {
          return { success: false, error: 'SMART_TAG service not available' };
        }
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
        
        
        // Emit RSSI updated event
        this.emit('rssiUpdated', {
          deviceId,
          rssi,
          timestamp: Date.now()
        });
        
        // Check if RSSI indicates poor connection
        this.checkRssiConnectionQuality(deviceId, rssi);
        
      } else {
      }
      
    } catch (error) {
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
    
    
    // Debug: Show exact calculation for this RSSI value

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
        break;
        
      case 'poor':
        this.emit('rssiPoorConnection', { deviceId, rssi, quality });
        break;
        
      case 'veryPoor':
      case 'critical':
        this.emit('rssiCriticalConnection', { deviceId, rssi, quality });
        
        // Only disconnect if connection is truly unusable (very rare)
        if (quality === 'critical' && rssi < -120) {
          this.disconnectFromDevice(deviceId);
        } else if (quality === 'critical') {
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
    if (this.connectedDevices.size === 0) {
      return { success: false, message: 'No connected devices' };
    }

    try {
      await this.performRssiCycle();
      return { success: true, message: 'Manual RSSI measurement completed' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }





  // =================== iOS STATE RESTORATION ===================
  handleRestoredState(restoredState) {
    try {
      if (!restoredState) {
        return;
      }

      const restoredDevices = restoredState.connectedPeripherals || restoredState.peripherals || [];

      restoredDevices.forEach((device) => {
        try {
          // Some SDKs provide plain IDs; normalize to a Device-like object
          const deviceId = device?.id || device?.identifier || device;
          if (!deviceId) {
            return { success: false, error: 'SMART_TAG service not available' };
          }

          this.reattachMonitorsForRestoredDevice(device, deviceId);
        } catch (e) {
        }
      });
    } catch (e) {
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
        
        // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
        // Read location data from nearby tag without full connection
        // await this.handleNearbyTag(deviceId, deviceName);
        
        // Disconnect immediately - don't allow background restoration for unverified tags
        try {
          const device = await this.manager.connectToDevice(deviceId, { timeout: 3000 });
          await device.cancelConnection();
        } catch (error) {
        }
        return; // Exit early - don't proceed with restoration
      }
      
      */

      // For native iOS implementation, we don't need to acquire BLE-PLX handles
      // The native iOS implementation handles state restoration automatically
      
      // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
      // Disconnect all other devices before restoring this one
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      
      if (currentlyConnectedDevices.length > 0) {
        console.log(`🔌 [iOS STATE RESTORATION] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before restoring ${deviceId}`);
        // Disconnect other devices asynchronously (don't block the restoration)
        currentlyConnectedDevices.forEach(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
            console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          }
        });
      }
      
      // Track in maps for downstream APIs
      this.connectedDevices.set(deviceId, { id: deviceId });
      const existing = this.scannedDevices.get(deviceId) || {
        id: deviceId,
        name: deviceOrId?.name || 'Restored Device',
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
          this.checkRssiConnectionQuality(deviceId, initialRssi);
        }
      } catch (rssiError) {
      }

      // Prevent duplicate monitors by clearing any stale subscriptions
      this.stopMonitoring(deviceId);

      // Discover services/characteristics and reattach monitors
      try {
        await deviceHandle.discoverAllServicesAndCharacteristics();
      } catch (e) {
      }

      try {
        await this.loadDeviceServices(deviceId);
      } catch { }

      this.startRSSIPolling(deviceId);
      // ✅ REMOVED: requestDeviceData call - native handles command sequence via ServiceDiscoveryComplete

      // Ensure we detect out-of-range after restoration as well
      try {
        const disconnectSub = deviceHandle.onDisconnected((error, dev) => {
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

    } catch (e) {
    }
  }
  // ================= END iOS STATE RESTORATION =================

  // Permission handling
  async requestPermissions() {
    try {

      if (Platform.OS === 'android') {
        // Use native Android permission request
        const result = await SampleBridgeAndroid.requestPermissions();
        return result.granted || false;
      } else {
        // iOS uses native bridge
        const result = await BridgingCodeModule.requestPermissions();
        return result.status === 'granted';
      }
    } catch (error) {
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
        return this.bleState;
      } catch (error) {
        this.bleState = BLE_STATES.UNKNOWN;
        return this.bleState;
      }
    } else {
      // iOS uses native bridge state check
      const result = await BridgingCodeModule.isBLEReady();
      this.bleState = result.isReady ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
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
      // iOS uses native bridge
      const result = await BridgingCodeModule.isBLEReady();
      return result.isReady || false;
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


      preservedDevices.forEach((device, id) => {
        const lastSeenTime = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString() : 'Never';
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
        }
      });

      // Now assign the preserved devices
      this.scannedDevices = preservedDevices;


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

      // ✅ ALIGNED: Both platforms use startScanningWithOptions with native auto-stop
      // Native layer handles auto-stop (iOS line 486-493, Android line 4302-4314)
      // No need for JS layer timeout - removed duplicate logic
      
      const scanOptions = {
        maxScanDurationMs: maxDuration || this.profile.maxScanDurationMs || 15000,
        scanMode: this.profile.scanMode || 'LowLatency',
        allowDuplicates: true
      };
      
      if (Platform.OS === 'android') {
        // Use native Android scanning with options (matching iOS behavior)
        if (SampleBridgeAndroid.startScanningWithOptions) {
          await SampleBridgeAndroid.startScanningWithOptions(scanOptions);
        } else {
          // Fallback to regular scanning for backward compatibility
          await SampleBridgeAndroid.startScanning();
        }
        
        // Android scanning is handled by native events, no subscription needed
        this.scanSubscription = { remove: () => {} }; // Dummy subscription for compatibility
      } else {
        // iOS uses native bridge scanning with options
        if (BridgingCodeModule.startScanningWithOptions) {
          await BridgingCodeModule.startScanningWithOptions(scanOptions);
        } else {
          // Fallback to regular scanning for backward compatibility
          await BridgingCodeModule.startScanning();
        }
        
        // iOS scanning is handled by native events, no subscription needed
        this.scanSubscription = { remove: () => {} }; // Dummy subscription for compatibility
      }

    } catch (error) {
      this.scanState = SCAN_STATES.STOPPED;
      if (onError) onError(error);
    }
  }

  // Stop scanning
  stopScanning() {
    if (Platform.OS === 'android') {
      // Use native Android stop scanning
      SampleBridgeAndroid.stopScanning().catch(error => {
      });
    } else {
      // iOS uses native bridge stop scanning
      BridgingCodeModule.stopScanning().catch(error => {
      });
    }
    this.scanState = SCAN_STATES.STOPPED;
  }

  // Debounced list update to avoid UI thrash
  scheduleListUpdate() {
    if (!this.onDeviceListUpdated || typeof this.onDeviceListUpdated !== 'function') return;
    if (!this.debouncedListUpdate) {
      this.debouncedListUpdate = setTimeout(() => {
        try { 
          if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
            this.onDeviceListUpdated(); 
          }
        } catch (error) {
          console.warn('Error calling onDeviceListUpdated callback:', error);
        }
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

  //     // Mock verification - replace with real API call
  //     return {
  //       isVerified: false, // Default to false for security
  //       tagId: null,
  //       userId: null,
  //       purchaseDate: null
  //     };
  //   } catch (error) {
  //     return { isVerified: false, error: error.message };
  //   }
  // }

  // Read location data from nearby tag without connecting
  async readNearbyTagLocation(deviceId) {
    try {

      if (Platform.OS === 'ios') {
        // For iOS native implementation, we can't easily read without connecting
        // This functionality would need to be implemented in the native layer
        return null;
      } else {
        // Android implementation would go here
        return null;
      }
    } catch (error) {
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


      // For now, just log - replace with actual API call
      return { success: true, message: 'Location data sent to server' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Handle nearby tag (not user's purchased tag)
  async handleNearbyTag(deviceId, deviceName) {
    try {

      // Read location data without connecting
      const locationData = await this.readNearbyTagLocation(deviceId);

      if (locationData) {

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
      }
    } catch (error) {
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
  }

  // Get current user ID
  getCurrentUserId() {
    return this.currentUserId;
  }

  // Force refresh auto-connect status (useful for debugging)
  async forceRefreshAutoConnectStatus() {
    if (Platform.OS === 'ios') {
      try {
        const status = await AutoConnectService.getAutoConnectStatus();
        return status;
      } catch (error) {
        return null;
      }
    }
    return null;
  }

  // Get all connected devices
  getConnectedDevices() {
    const connectedDevicesList = [];

    // First, check devices in the connectedDevices map 
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
      }
    }

    // Debug: Show all devices in scannedDevices


    return connectedDevicesList;
  }

  // Connect to a device
  async connectToDevice(deviceId, onConnectionStateChange) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('Device not found in scanned devices');
      }

      // ✅ CRITICAL: Check if device is in manual disconnect cooldown (e.g., after unpair)
      const cooldownTime = this.manualDisconnectCooldown.get(deviceId);
      if (cooldownTime) {
        const timeSinceCooldown = Date.now() - cooldownTime;
        const cooldownDuration = 10000; // 10 seconds
        
        if (timeSinceCooldown < cooldownDuration) {
          const remainingTime = Math.ceil((cooldownDuration - timeSinceCooldown) / 1000);
          const errorMessage = `Device is in cooldown after disconnect. Please wait ${remainingTime} seconds before reconnecting.`;
          console.warn(`⏳ [CONNECTION] ${errorMessage}`);
          throw new Error(errorMessage);
        } else {
          // Cooldown expired, clear it
          this.manualDisconnectCooldown.delete(deviceId);
        }
      }

      // ✅ Check if device has been forgotten (unpaired)
      // For MANUAL connections: Allow connection and remove from forgotten list (re-pair)
      // For AUTO connections: This is handled by native code
      try {
        const forgottenDevices = await AutoConnectService.getForgottenDevices();
        if (forgottenDevices.success && forgottenDevices.devices.includes(deviceId)) {
          console.log(`🔓 [CONNECTION] Device was unpaired - manual connection will re-pair it`);
          // Manual connection to forgotten device - this is like pairing again
          // The native iOS code will automatically remove it from forgotten list
          // No need to block the connection - allow it to proceed
        }
      } catch (error) {
        console.warn('⚠️ [CONNECTION] Could not check forgotten devices list:', error);
        // Continue with connection attempt anyway
      }

      // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
      // Disconnect all other devices before connecting this one
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      
      if (currentlyConnectedDevices.length > 0) {
        console.log(`🔌 [CONNECTION] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before connecting ${deviceId}`);
        console.log(`   📋 Devices to disconnect: ${currentlyConnectedDevices.join(', ')}`);
        
        // Disconnect all other devices
        const disconnectPromises = currentlyConnectedDevices.map(async (otherDeviceId) => {
          try {
            console.log(`   🔌 Disconnecting device: ${otherDeviceId}`);
            await this.disconnectFromDevice(otherDeviceId);
            console.log(`   ✅ Successfully disconnected: ${otherDeviceId}`);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
            // Continue even if one disconnect fails
          }
        });
        
        // Wait for all disconnections to complete (with timeout)
        try {
          await Promise.race([
            Promise.all(disconnectPromises),
            new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
          ]);
          console.log(`✅ [CONNECTION] All other devices disconnected, proceeding with connection to ${deviceId}`);
        } catch (error) {
          console.warn(`⚠️ [CONNECTION] Error during disconnect of other devices:`, error.message);
          // Continue with connection anyway - don't block user
        }
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

      this.markDeviceKnown(deviceId);

      // Stop scanning to free resources
      this.stopScanning();

      // Acquire connection from pool
      const connectionAcquired = await this.acquireConnection(deviceId, 'high');
      if (!connectionAcquired) {
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
        const result = await SampleBridgeAndroid.connectToDevice(deviceId);
        
        // Android connection is handled by native events
        connectedDevice = { id: deviceId }; // Dummy device object for compatibility
      } else {
        // iOS uses native bridge connection with power profile optimization
        
        try {
          const connectionOptions = {
            connectionIntervalMs: this.profile.connectionIntervalMs || 50,
            supervisionTimeoutMs: this.profile.supervisionTimeoutMs || 4000,
            connectionLatency: this.profile.connectionLatency || 0,
            isManualConnection: true // Flag this as a manual connection
          };
          
          const result = await BridgingCodeModule.connectToDeviceWithOptions(deviceId, connectionOptions);
        } catch (error) {
          // Fallback to regular connection with manual flag
          const fallbackOptions = { isManualConnection: true };
          const result = await BridgingCodeModule.connectToDeviceWithOptions(deviceId, fallbackOptions);
        }
        
        // iOS connection is handled by native events
        connectedDevice = { id: deviceId }; // Dummy device object for compatibility
      }

      // Negotiate MTU for optimal data transfer based on power profile
      const mtuSize = this.profile.mtuSize || 512;
      await this.negotiateMTU(deviceId, mtuSize);

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
          // iOS uses native bridge RSSI reading
          const result = await BridgingCodeModule.readRSSI(deviceId);
          initialRssi = result.rssi;
        }
        
        if (initialRssi !== null && initialRssi !== undefined) {
          // Handle RSSI object vs number
          const rssiValue = typeof initialRssi === 'object' ? initialRssi.rssi : initialRssi;
          if (rssiValue !== null && rssiValue !== undefined) {
            this.checkRssiConnectionQuality(deviceId, rssiValue);
          } else {
          }
        }
      } catch (rssiError) {
      }

      // Clear any manual disconnect cooldown since user manually connected
      if (this.manualDisconnectCooldown.has(deviceId)) {
        this.manualDisconnectCooldown.delete(deviceId);
      }

      // Clear any reconnection attempts since device is now connected
      if (this.reconnectionAttempts && this.reconnectionAttempts.has(deviceId)) {
        this.reconnectionAttempts.delete(deviceId);
      }
      if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
        const timer = this.reconnectionTimers.get(deviceId);
        if (timer) clearTimeout(timer);
        this.reconnectionTimers.delete(deviceId);
      }


      // Add device to bonded list for auto-connect (iOS only)
      // ❌ DISABLED: Native code already handles bonding during pairing verification
      // Calling this again causes duplicate service discovery
      // if (Platform.OS === 'ios') {
      //   try {
      //     await this.addDeviceToBondedList(deviceId);
      //   } catch (error) {
      //   }
      // }

      // Load services and characteristics
      // ✅ iOS: Native code automatically discovers services during connection
      // ✅ Android: Need to explicitly load services here
      if (Platform.OS === 'android') {
        try {
          // Ensure device is properly added to connectedDevices before loading services
          if (!this.connectedDevices.has(deviceId)) {
            this.connectedDevices.set(deviceId, connectedDevice);
          }
          
          // Small delay to ensure connection is fully established
          await new Promise(resolve => setTimeout(resolve, 500));
          
          await this.loadDeviceServices(deviceId);
        } catch (error) {
          // Don't fail the entire connection if services can't be loaded
          // The device is still connected, just without service discovery
        }
      } else {
        // iOS: Services are already discovered by native code
        // Just ensure device is in connectedDevices map
        if (!this.connectedDevices.has(deviceId)) {
          this.connectedDevices.set(deviceId, connectedDevice);
        }
      }

      // Start heartbeat monitoring for connection health
      this.startHeartbeatMonitoring(deviceId);

      // ✅ CLEAN ARCHITECTURE: Native handles command sequence via ServiceDiscoveryComplete
      // JS only handles API calls and UI updates
      
      // ❌ DISABLED: Old immediate API call (replaced by buffering system)
      // setTimeout(() => {
      //   this.sendPetHealthDataToServer(deviceId);
      // }, 8000);

      // ❌ DISABLED: Old adaptive API calling (replaced by buffering system)
      // Native buffering system handles all API calls more efficiently
      // setTimeout(() => {
      //   this.startAdaptiveApiCalling(deviceId);
      // }, 5000);

      // Start GET API calling for this device
      setTimeout(() => {
        this.startGetApiCalling(deviceId);
      }, 6000);

      // Start connection health monitoring
      this.startConnectionHealthCheck();

      // Subscribe to disconnection to update UI promptly on out-of-range
      // Note: For native iOS implementation, disconnection is handled by native events
      // No need to set BLE-PLX onDisconnected listener since we're not using BLE-PLX

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTED);
      }

      return connectedDevice;

    } catch (error) {

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
      // ✅ INDUSTRY STANDARD: Upload any pending buffered data before disconnect
      const buffer = this.liveDataBuffers.get(deviceId);
      if (buffer && buffer.length > 0) {
        console.log(`📤 [DISCONNECT] Uploading ${buffer.length} pending live records before disconnect`);
        await this.uploadLiveBatch(deviceId);
      }
      
      // Stop batch upload timer
      this.stopBatchUploadTimer(deviceId);
      
      // Clear buffer state
      this.liveDataBuffers.delete(deviceId);
      this.lastBatchUpload.delete(deviceId);
      this.historicalSyncComplete.delete(deviceId);
      
      // Clean up auto-sync timer if exists
      if (this.autoSyncTimers?.has(deviceId)) {
        clearTimeout(this.autoSyncTimers.get(deviceId));
        this.autoSyncTimers.delete(deviceId);
      }

      let device = this.scannedDevices.get(deviceId);
      if (!device) {
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
        }
      } else {
        device.connectionState = CONNECTION_STATES.DISCONNECTING;
        this.scannedDevices.set(deviceId, device);
      }

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTING);
      }

      // Stop monitoring, heartbeat, RSSI polling, device status polling, and adaptive API calling
      this.stopMonitoring(deviceId);
      this.stopHeartbeatMonitoring(deviceId);
      this.stopRSSIPolling(deviceId);
      this.stopDeviceStatusPollingFallback(deviceId);
      this.stopAdaptiveApiCalling(deviceId);
      
      // Clear command sent flag to allow re-sending commands on reconnect
      const commandKey = `commands_sent_${deviceId}`;
      if (this[commandKey]) {
        delete this[commandKey];
      }

      // Stop connection health check if no more devices
      if (this.connectedDevices.size <= 1) { // Will be 0 after we delete this device
        this.stopConnectionHealthCheck();
      }

      // Disconnect using platform-specific implementation
      let connectedDevice = this.connectedDevices.get(deviceId);
      
      if (Platform.OS === 'android') {
        // Use native Android disconnection
        try {
          await SampleBridgeAndroid.cancelConnection(deviceId);
        } catch (e) {
        }
        this.connectedDevices.delete(deviceId);
      } else {
        // iOS uses native bridge disconnection
        try {
          await BridgingCodeModule.disconnectFromDevice(deviceId);
        } catch (e) {
        }
        this.connectedDevices.delete(deviceId);
      }

      // Release connection from pool
      this.releaseConnection(deviceId);

      // Also disconnect from native iOS CoreBluetooth to ensure system Bluetooth shows disconnected
      if (Platform.OS === 'ios') {
        try {
          await AutoConnectService.disconnectFromNative(deviceId);
        } catch (error) {
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
      } else {
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
      this.manualDisconnectCooldown.set(deviceId, Date.now());

      // Temporarily disable auto-connect to prevent immediate reconnection
      if (Platform.OS === 'ios') {
        try {
          await AutoConnectService.stopAutoConnect();

          // Re-enable auto-connect after cooldown period
          setTimeout(async () => {
            try {
              await AutoConnectService.startAutoConnect();
            } catch (error) {
            }
          }, 30000); // 30 second cooldown
        } catch (error) {
        }
      }

      // Clear cooldown after 30 seconds
      setTimeout(() => {
        this.manualDisconnectCooldown.delete(deviceId);
      }, 30000);

      // Check if this device is bonded and auto-connect is enabled
      if (Platform.OS === 'ios') {

        // Sync connection state with native iOS to fix the count mismatch
        try {
          // Use getAutoConnectStatus to trigger cleanup of stale connections
          await AutoConnectService.getAutoConnectStatus();

          // Wait a moment for the cleanup to complete
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
        }

        const isBonded = await this.isDeviceBonded(deviceId);
        const autoConnectStatus = await this.getAutoConnectStatus();


        // IMPORTANT: Don't start auto-reconnection immediately after manual disconnect
        // This prevents the device from reconnecting in milliseconds
        if (isBonded && autoConnectStatus.enabled) {

          // Don't start exponential backoff reconnection immediately
          // The cooldown will prevent this from happening
        } else {
          if (!isBonded) {
          }
          if (!autoConnectStatus.enabled) {
          }
        }
      }

    } catch (error) {
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
      // Prevent multiple simultaneous service discovery calls
      if (this.serviceDiscoveryInProgress && this.serviceDiscoveryInProgress.has(deviceId)) {
        return;
      }
      
      // Mark service discovery as in progress
      if (!this.serviceDiscoveryInProgress) {
        this.serviceDiscoveryInProgress = new Set();
      }
      this.serviceDiscoveryInProgress.add(deviceId);
      
      const connectedDevice = this.connectedDevices.get(deviceId);
      if (!connectedDevice) {
        throw new Error('Device not in connected devices map');
      }

      // Check if device is actually connected (platform-specific)
      let isConnected = false;
      
      if (Platform.OS === 'android') {
        // For Android, check connection state from our internal state
        // since we use native bridge, not BLE-PLX device objects
        const device = this.scannedDevices.get(deviceId);
        isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
      } else {
        // For iOS, check connection state from our internal state
        // since we use native bridge, not BLE-PLX device objects
        const device = this.scannedDevices.get(deviceId);
        isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
      }

      if (!isConnected) {
        throw new Error('Device connection lost');
      }

      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('Device not found in scanned list');
      }

      // Get services with retry (platform-specific)
      let services = [];
      
      if (Platform.OS === 'android') {
        // For Android, use real native service discovery instead of mocks
        
        try {
          // Get real services and characteristics from Android native layer
          const serviceData = await SampleBridgeAndroid.getDeviceServices(deviceId);
          
          if (serviceData && serviceData.services && Array.isArray(serviceData.services)) {
            services = serviceData.services.map(service => ({
              uuid: service.uuid,
              isPrimary: service.isPrimary || true,
              characteristics: service.characteristics || []
            }));
          } else {
            // Fallback to essential services if native discovery fails
            services = [
              {
                uuid: BLE_SERVICES.BATTERY,
                isPrimary: true,
                characteristics: [
                  { uuid: BLE_CHARACTERISTICS.BATTERY_LEVEL, properties: ['read', 'notify'] }
                ]
              },
              {
                uuid: BLE_SERVICES.SMART_TAG,
                isPrimary: true,
                characteristics: [
                  { uuid: BLE_CHARACTERISTICS.SYSTEM_COMMAND, properties: ['write', 'notify'] },
                  { uuid: BLE_CHARACTERISTICS.DEVICE_STATUS, properties: ['read', 'notify'] },
                  { uuid: BLE_CHARACTERISTICS.DATA_TRANSFER, properties: ['read', 'write', 'notify'] }
                ]
              }
            ];
          }
        } catch (error) {
          // Fallback to essential services if native discovery fails
          services = [
            {
              uuid: BLE_SERVICES.BATTERY,
              isPrimary: true,
              characteristics: [
                { uuid: BLE_CHARACTERISTICS.BATTERY_LEVEL, properties: ['read', 'notify'] }
              ]
            },
            {
              uuid: BLE_SERVICES.SMART_TAG,
              isPrimary: true,
              characteristics: [
                { uuid: BLE_CHARACTERISTICS.SYSTEM_COMMAND, properties: ['write', 'notify'] },
                { uuid: BLE_CHARACTERISTICS.DEVICE_STATUS, properties: ['read', 'notify'] },
                { uuid: BLE_CHARACTERISTICS.DATA_TRANSFER, properties: ['read', 'write', 'notify'] }
              ]
            }
          ];
        }
      } else {
        // For iOS, use native bridge to discover services
        
        // First trigger service discovery with timeout
        const discoveryPromise = BridgingCodeModule.discoverServices(deviceId);
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Service discovery timeout')), 3000)
        );
        
        await Promise.race([discoveryPromise, timeoutPromise]);
        
        // Wait a bit for services to be discovered (reduced timeout)
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Services and characteristics are already discovered and stored in device object
        // No need to call native methods anymore
        
        // Use the services and characteristics from the device object
        if (device.services && device.services.length > 0) {
          
          // Map services with their characteristics and UPDATE the device.services array
          device.services = device.services.map(service => {
            // Find characteristics that belong to this service
            const serviceCharacteristics = device.characteristics ? 
              device.characteristics.filter(char => char.serviceUUID === service.uuid) : [];
            
            
            return {
              uuid: service.uuid,
              isPrimary: service.isPrimary,
              characteristics: serviceCharacteristics.map(char => ({
                uuid: char.uuid,
                properties: char.properties,
                isNotifying: char.isNotifying
              }))
            };
          });
          
          // Also set the services variable for consistency
          services = device.services;
        } else {
          // Fallback to basic structure if no services discovered
          services = [
            {
              uuid: BLE_SERVICES.BATTERY,
              isPrimary: true,
              characteristics: [
                { uuid: BLE_CHARACTERISTICS.BATTERY_LEVEL, properties: ['read', 'notify'] }
              ]
            },
            {
              uuid: BLE_SERVICES.SMART_TAG,
              isPrimary: true,
              characteristics: [
                { uuid: BLE_CHARACTERISTICS.SYSTEM_COMMAND, properties: ['write', 'notify'] },
                { uuid: BLE_CHARACTERISTICS.DEVICE_STATUS, properties: ['read', 'notify'] },
                { uuid: BLE_CHARACTERISTICS.DATA_TRANSFER, properties: ['read', 'write', 'notify'] }
              ]
            }
          ];
        }
      }

      // For iOS, we already have the services properly structured above
      // Skip the Android rebuilding logic
      if (Platform.OS === 'android') {
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
          characteristics = service.characteristics || [];
        } else {
          // For iOS, use native bridge - characteristics are populated via events
          // Get characteristics from the device's characteristics array for this service
          const device = this.scannedDevices.get(deviceId);
          if (device && device.characteristics) {
            characteristics = device.characteristics.filter(c => {
              const cServiceUuid = c.serviceUUID.toLowerCase().replace(/-/g, '');
              const serviceUuid = service.uuid.toLowerCase().replace(/-/g, '');
              const matches = cServiceUuid === serviceUuid;
              if (matches) {
              }
              return matches;
            });
          } else {
            characteristics = [];
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
      }

      this.scannedDevices.set(deviceId, device);

    } catch (error) {
      throw error;
    } finally {
      // Clear service discovery in progress flag
      if (this.serviceDiscoveryInProgress) {
        this.serviceDiscoveryInProgress.delete(deviceId);
      }
    }
  }

  // Start monitoring important characteristics
  startMonitoring(deviceId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
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
        return;
      }
    } catch (error) {
      return;
    }

    // Monitor device status characteristic (try multiple service UUIDs)
    const smartTagServices = [BLE_SERVICES.SMART_TAG, BLE_SERVICES.SMART_TAG_ALT, BLE_SERVICES.CUSTOM_SERVICE];
    let deviceStatusMonitored = false;
    
    for (const serviceUuid of smartTagServices) {
      try {
        this.monitorCharacteristic(
          deviceId,
          serviceUuid,
          BLE_CHARACTERISTICS.DEVICE_STATUS,
          (data) => this.handleDeviceStatusUpdate(deviceId, data)
        );
        deviceStatusMonitored = true;
        break;
      } catch (error) {
      }
    }
    
    if (!deviceStatusMonitored) {
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
    }

    // Monitor data transfer characteristic (try multiple service UUIDs)
    let dataTransferMonitored = false;
    
    for (const serviceUuid of smartTagServices) {
      try {
        this.monitorCharacteristic(
          deviceId,
          serviceUuid,
          BLE_CHARACTERISTICS.DATA_TRANSFER,
          (data) => this.handleDataTransfer(deviceId, data)
        );
        dataTransferMonitored = true;
        break;
      } catch (error) {
      }
    }
    
    if (!dataTransferMonitored) {
    }

    // Monitor system command responses (try multiple service UUIDs)
    let systemCommandMonitored = false;
    
    for (const serviceUuid of smartTagServices) {
      try {
        this.monitorCharacteristic(
          deviceId,
          serviceUuid,
          BLE_CHARACTERISTICS.SYSTEM_COMMAND,
          (data) => this.handleSystemCommandResponse(deviceId, data)
        );
        systemCommandMonitored = true;
        break;
      } catch (error) {
      }
    }
    
    if (!systemCommandMonitored) {
    }
  }

  // Monitor a specific characteristic
  async monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, onData) {
    try {
      if (Platform.OS === 'android') {
        // Use native Android characteristic monitoring
        const result = await SampleBridgeAndroid.monitorCharacteristicForService(
          deviceId, 
          serviceUUID, 
          characteristicUUID
        );
        
        // Android monitoring is handled by native events
        const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;
        this.monitoringSubscriptions.set(monitorKey, { remove: () => {} }); // Dummy subscription for compatibility
        return;
      }

      // iOS uses native bridge monitoring
      const result = await BridgingCodeModule.enableNotifications(deviceId, characteristicUUID);
      
      // iOS monitoring is handled by native events
      const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;
      this.monitoringSubscriptions.set(monitorKey, { remove: () => {} }); // Dummy subscription for compatibility

    } catch (error) {
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

  }

  // Track notification counts for verification
  notificationCounts = new Map();
  
  // Method to get notification statistics
  getNotificationStats(deviceId) {
    const deviceStats = this.notificationCounts.get(deviceId) || {
      deviceStatus: 0,
      batteryLevel: 0,
      dataTransfer: 0,
      systemCommand: 0,
      total: 0,
      lastUpdate: null
    };
    
    
    return deviceStats;
  }
  
  // Method to check all notification stats for debugging
  getAllNotificationStats() {
    for (const [deviceId, stats] of this.notificationCounts.entries()) {
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device ? device.name : 'Unknown';
    }
  }
  
  // Method to fix service characteristics mapping
  fixServiceCharacteristics(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      return;
    }
    
    
    if (!device.services || device.services.length === 0) {
      return;
    }
    
    if (!device.characteristics || device.characteristics.length === 0) {
      return;
    }
    
    // Fix each service by attaching its characteristics
    device.services = device.services.map(service => {
      const serviceCharacteristics = device.characteristics.filter(char => 
        char.serviceUUID === service.uuid
      );
      
      
      return {
        ...service,
        characteristics: serviceCharacteristics.map(char => ({
          uuid: char.uuid,
          properties: char.properties,
          isNotifying: char.isNotifying,
          serviceUUID: char.serviceUUID
        }))
      };
    });
    
    this.scannedDevices.set(deviceId, device);
    
    // Log the fixed structure
    device.services.forEach(service => {
      service.characteristics?.forEach(char => {
      });
    });
  }

  // Method to check current device RTC status
  checkDeviceRTCStatus(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device || !device.deviceData) {
      return;
    }
    
    const deviceRTC = device.deviceData.deviceRTC;
    const lastUpdate = device.deviceData.lastUpdate;
    const currentTime = Math.floor(Date.now() / 1000);
    
    
    // Analyze the 1979 timestamp to understand device epoch
  }
  
  // Method to test different timestamp formats
  async testTimeSyncFormats(deviceId) {
    
    const currentTime = Math.floor(Date.now() / 1000);
    const deviceRTC = 287454020; // Current device RTC
    
    // Test different epoch calculations
    const testTimestamps = [
      { name: 'Unix Epoch (current)', value: currentTime },
      { name: 'Unix Epoch + 1000', value: currentTime + 1000 },
      { name: 'Unix Epoch - 1000', value: currentTime - 1000 },
      { name: 'Device Epoch (1979)', value: Math.floor((Date.now() - new Date('1979-01-01').getTime()) / 1000) },
      { name: 'Milliseconds as seconds', value: Math.floor(Date.now() / 1000) },
    ];
    
    for (const test of testTimestamps) {
      
      try {
        const timestampBytes = [
          test.value & 0xFF,
          (test.value >> 8) & 0xFF,
          (test.value >> 16) & 0xFF,
          (test.value >> 24) & 0xFF
        ];
        
        const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes);
        
        if (result.success) {
          // Wait and check if RTC changed
          await new Promise(resolve => setTimeout(resolve, 3000));
          const device = this.scannedDevices.get(deviceId);
          const newRTC = device?.deviceData?.deviceRTC;
          const changed = newRTC !== deviceRTC;
          
          if (changed) {
            return { success: true, format: test.name, timestamp: test.value };
          }
        }
      } catch (error) {
      }
    }
    
    return { success: false };
  }

  // Method to check if notifications are active (received in last 30 seconds)
  areNotificationsActive(deviceId) {
    const stats = this.getNotificationStats(deviceId);
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30000);
    
    const isActive = stats.lastUpdate && stats.lastUpdate > thirtySecondsAgo;
    
    
    return isActive;
  }

  // ✅ IMPROVEMENT 1: Error Handling with Exponential Backoff
  async retrySyncWithBackoff(deviceId, attempt = 0) {
    if (attempt >= this.autoSyncConfig.maxRetries) {
      console.error(`❌ [AUTO SYNC] Max retries (${this.autoSyncConfig.maxRetries}) reached for ${deviceId}`);
      this.recordSyncFailure(deviceId, 'max_retries_exceeded');
      this.emitUserFeedback(deviceId, 'sync_failed', { reason: 'max_retries_exceeded' });
      return false;
    }
    
    const delay = this.baseRetryDelay * Math.pow(2, attempt); // Exponential backoff
    console.log(`🔄 [AUTO SYNC] Retry attempt ${attempt + 1}/${this.autoSyncConfig.maxRetries} for ${deviceId} after ${delay}ms`);
    
    return new Promise((resolve) => {
      const retryTimer = setTimeout(async () => {
        try {
          const result = await this.startDataSync(deviceId);
          if (result && result.status === 'success') {
            this.syncRetryAttempts.delete(deviceId);
            resolve(true);
          } else if (result && result.status === 'already_syncing') {
            // Sync already in progress, not a failure
            this.syncRetryAttempts.delete(deviceId);
            resolve(true);
          } else {
            // Retry again
            const success = await this.retrySyncWithBackoff(deviceId, attempt + 1);
            resolve(success);
          }
        } catch (error) {
          console.error(`❌ [AUTO SYNC] Retry attempt ${attempt + 1} failed:`, error);
          const success = await this.retrySyncWithBackoff(deviceId, attempt + 1);
          resolve(success);
        }
      }, delay);
      
      this.syncRetryTimers.set(deviceId, retryTimer);
    });
  }
  
  // ✅ IMPROVEMENT 2: State Transition Logging
  logStateTransition(deviceId, fromState, toState, reason = '') {
    if (!this.stateTransitionHistory) {
      this.stateTransitionHistory = new Map();
    }
    
    if (!this.stateTransitionHistory.has(deviceId)) {
      this.stateTransitionHistory.set(deviceId, []);
    }
    
    const history = this.stateTransitionHistory.get(deviceId);
    const transition = {
      timestamp: Date.now(),
      from: fromState,
      to: toState,
      reason: reason
    };
    
    history.push(transition);
    
    // Keep only last N transitions
    if (history.length > this.maxStateHistory) {
      history.shift();
    }
    
    console.log(`🔄 [STATE TRANSITION] ${deviceId}: ${fromState} → ${toState}${reason ? ` (${reason})` : ''}`);
    
    // Emit event for debugging
    if (this.autoSyncConfig.enableMetrics) {
      this.emit('stateTransition', { deviceId, ...transition });
    }
  }
  
    // ✅ IMPROVEMENT 3: Adaptive Throttle Calculation
  calculateAdaptiveThrottle(deviceId) {
    if (this.autoSyncConfig.throttleMode !== 'adaptive') {
      // Use fixed throttle based on mode
      switch (this.autoSyncConfig.throttleMode) {
        case 'fast':
          return this.adaptiveThrottleConfig.fast;
        case 'slow':
          return this.adaptiveThrottleConfig.slow;
        case 'custom':
          return this.autoSyncConfig.customThrottle;
        default:
          return this.adaptiveThrottleConfig.normal;
      }
    }
    
    // Calculate record accumulation rate
    const rateHistory = this.recordAccumulationRates.get(deviceId) || [];
    if (rateHistory.length < 2) {
      return this.adaptiveThrottleConfig.normal; // Default to normal if not enough data
    }
    
    // Calculate average records per 30 seconds over last 5 notifications
    const recentHistory = rateHistory.slice(-5);
    let totalRecords = 0;
    let timeSpan = 0;
    
    if (recentHistory.length >= 2) {
      const first = recentHistory[0];
      const last = recentHistory[recentHistory.length - 1];
      totalRecords = last.count - first.count;
      timeSpan = (last.timestamp - first.timestamp) / 1000; // Convert to seconds
    }
    
    // ✅ FIX: Clamp to minimum 0 to handle negative rates (shouldn't happen, but protect against it)
    const recordsPer30s = Math.max(0, timeSpan > 0 ? (totalRecords / timeSpan) * 30 : 0);
    
    // ✅ FIX: Validate timeSpan to prevent division issues
    if (timeSpan <= 0 || !isFinite(recordsPer30s)) {
      console.warn(`⚠️ [ADAPTIVE THROTTLE] ${deviceId}: Invalid rate calculation, using normal mode`);
      return this.adaptiveThrottleConfig.normal;
    }
    
    // Determine throttle based on accumulation rate
    let throttle;
    if (recordsPer30s > 2) {
      throttle = this.adaptiveThrottleConfig.fast; // Fast accumulation
      console.log(`⚡ [ADAPTIVE THROTTLE] ${deviceId}: Fast mode (${recordsPer30s.toFixed(1)} records/30s) → ${throttle}ms`);
    } else if (recordsPer30s < 1) {
      throttle = this.adaptiveThrottleConfig.slow; // Slow accumulation
      console.log(`🐌 [ADAPTIVE THROTTLE] ${deviceId}: Slow mode (${recordsPer30s.toFixed(1)} records/30s) → ${throttle}ms`);
    } else {
      throttle = this.adaptiveThrottleConfig.normal; // Normal accumulation
      console.log(`⚖️ [ADAPTIVE THROTTLE] ${deviceId}: Normal mode (${recordsPer30s.toFixed(1)} records/30s) → ${throttle}ms`);
    }
    
    return throttle;
  }
  
  // ✅ IMPROVEMENT 4: Fallback Polling Setup
  setupFallbackPolling(deviceId) {
    // ✅ COMPLETELY DISABLED: All JavaScript fallback polling removed
    // Native polling handles Device Status reads every 30 seconds:
    //   - Android: ScheduledExecutorService in SampleBridgeAndroid.java
    //   - iOS: Timer.scheduledTimer in BridgingCodeModule.swift
    // Both start automatically after SET_DATA_ACQUISITION_INTERVAL command (0x04)
    
    console.log(`ℹ️ [POLLING] setupFallbackPolling disabled - native polling active for ${deviceId}`);
    return;
  }
  
  // ✅ IMPROVEMENT 5: Sync Queue Management
  async processSyncQueue(deviceId) {
    // ✅ FIX: Check if sync is active BEFORE processing queue
    let isSyncActive = false;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state) {
          const activeStates = ['syncing', 'time_syncing'];
          isSyncActive = activeStates.includes(nativeState.state);
        }
      } catch (error) {
        // Ignore error
      }
    } else {
      const syncState = this.dataSyncStates?.get(deviceId);
      isSyncActive = syncState?.isActive === true;
    }
    
    if (this.processingSync.get(deviceId) || isSyncActive) {
      console.log(`⏸️ [SYNC QUEUE] Sync active or processing, waiting... (state: ${isSyncActive ? 'active' : 'processing'})`);
      return; // Already processing or sync is active
    }
    
    const queue = this.syncQueue.get(deviceId) || [];
    if (queue.length === 0) {
      return; // No pending syncs
    }
    
    this.processingSync.set(deviceId, true);
    const syncRequest = queue.shift();
    
    console.log(`📋 [SYNC QUEUE] Processing sync for ${deviceId} (${queue.length} remaining in queue)`);
    
    try {
      const result = await this.startDataSync(deviceId);
      
      if (result && result.status === 'success') {
        console.log(`✅ [SYNC QUEUE] Sync completed for ${deviceId}`);
      } else if (result && result.status === 'already_syncing') {
        // Re-queue if already syncing
        queue.unshift(syncRequest);
        console.log(`⏸️ [SYNC QUEUE] Re-queued sync for ${deviceId} (sync already in progress)`);
      }
    } catch (error) {
      console.error(`❌ [SYNC QUEUE] Sync failed for ${deviceId}:`, error);
      // Retry with exponential backoff
      await this.retrySyncWithBackoff(deviceId);
    } finally {
      this.processingSync.set(deviceId, false);
      
      // Process next item in queue
      if (queue.length > 0) {
        setTimeout(() => this.processSyncQueue(deviceId), 1000);
      }
    }
  }
  
  addToSyncQueue(deviceId, syncRequest = {}) {
    if (!this.syncQueue.has(deviceId)) {
      this.syncQueue.set(deviceId, []);
    }
    
    const queue = this.syncQueue.get(deviceId);
    queue.push({
      ...syncRequest,
      timestamp: Date.now()
    });
    
    console.log(`📋 [SYNC QUEUE] Added sync to queue for ${deviceId} (queue size: ${queue.length})`);
    
    // Process queue if not already processing
    if (!this.processingSync.get(deviceId)) {
      this.processSyncQueue(deviceId);
    }
  }
  
  // ✅ IMPROVEMENT 6: User Feedback Events
  emitUserFeedback(deviceId, eventType, data = {}) {
    if (!this.autoSyncConfig.enableUserFeedback) {
      return;
    }
    
    const feedback = {
      deviceId,
      type: eventType,
      timestamp: Date.now(),
      ...data
    };
    
    this.emit('autoSyncFeedback', feedback);
    console.log(`📢 [USER FEEDBACK] ${deviceId}: ${eventType}`, data);
  }
  
  // ✅ IMPROVEMENT 7: Metrics Tracking
  recordSyncStart(deviceId) {
    if (!this.autoSyncConfig.enableMetrics) {
      return;
    }
    
    if (!this.syncMetrics.has(deviceId)) {
      this.syncMetrics.set(deviceId, {
        successCount: 0,
        failureCount: 0,
        totalLatency: 0,
        lastSyncTime: null,
        averageLatency: 0,
        successRate: 0
      });
    }
    
    const metrics = this.syncMetrics.get(deviceId);
    metrics.lastSyncStartTime = Date.now();
  }
  
  recordSyncSuccess(deviceId, latency) {
    if (!this.autoSyncConfig.enableMetrics) {
      return;
    }
    
    const metrics = this.syncMetrics.get(deviceId) || {};
    metrics.successCount = (metrics.successCount || 0) + 1;
    metrics.totalLatency = (metrics.totalLatency || 0) + latency;
    metrics.lastSyncTime = Date.now();
    metrics.averageLatency = metrics.totalLatency / metrics.successCount;
    metrics.successRate = metrics.successCount / (metrics.successCount + (metrics.failureCount || 0));
    
    this.syncMetrics.set(deviceId, metrics);
    
    console.log(`📊 [METRICS] ${deviceId}: Success (latency: ${latency}ms, avg: ${metrics.averageLatency.toFixed(0)}ms, success rate: ${(metrics.successRate * 100).toFixed(1)}%)`);
  }
  
  recordSyncFailure(deviceId, reason) {
    if (!this.autoSyncConfig.enableMetrics) {
      return;
    }
    
    const metrics = this.syncMetrics.get(deviceId) || {};
    metrics.failureCount = (metrics.failureCount || 0) + 1;
    metrics.lastFailureTime = Date.now();
    metrics.lastFailureReason = reason;
    metrics.successRate = (metrics.successCount || 0) / ((metrics.successCount || 0) + metrics.failureCount);
    
    this.syncMetrics.set(deviceId, metrics);
    
    console.log(`📊 [METRICS] ${deviceId}: Failure (reason: ${reason}, success rate: ${(metrics.successRate * 100).toFixed(1)}%)`);
  }
  
  getSyncMetrics(deviceId) {
    return this.syncMetrics.get(deviceId) || null;
  }
  
  // ✅ IMPROVEMENT 8: Configuration Management
  updateAutoSyncConfig(newConfig) {
    this.autoSyncConfig = {
      ...this.autoSyncConfig,
      ...newConfig
    };
    console.log(`⚙️ [CONFIG] Auto-sync configuration updated:`, this.autoSyncConfig);
    this.emit('autoSyncConfigUpdated', this.autoSyncConfig);
  }
  
  getAutoSyncConfig() {
    return { ...this.autoSyncConfig };
  }

  // Shared auto-sync decision for device status notifications (parity with iOS)
  async maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData, options = {}) {
    // ✅ CRITICAL FIX: Allow sync even with 1 record (no minimum threshold)
    // The device generates records continuously, so we should sync whenever records are available
    const hasRecordsAvailable = parsedData?.recordCount !== undefined && parsedData?.recordCount > 0;
    
    // ✅ SYNC WITH iOS: Use native state directly (iOS uses native state, not JS state)
    // For Android, query native state directly like iOS does
    let isSyncActive = false;
    
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        // ✅ SYNC WITH iOS: Query native state directly (matching iOS behavior)
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state) {
          // ✅ SYNC WITH iOS: Native states that indicate active sync: "syncing", "time_syncing"
          // "ready" is a transitional state meaning "ready to start sync" - NOT an active sync state
          // States that are NOT active: "idle", "complete", "ready", "failed", "time_sync_failed", "time_synced"
          // Note: "ready" should only be set briefly before sync starts, and should transition to "syncing" or "idle"
          const activeStates = ['syncing', 'time_syncing'];
          isSyncActive = activeStates.includes(nativeState.state);
          
          // Clear JS state if it exists (native state is source of truth)
          if (this.dataSyncStates) {
            this.dataSyncStates.delete(deviceId);
          }
        }
      } catch (error) {
        // Fallback to JS state if native query fails
        const syncState = this.dataSyncStates?.get(deviceId);
        isSyncActive = syncState?.isActive === true;
      }
    } else {
      // iOS: Native state is managed in native layer, JS doesn't maintain separate state
      // For iOS, we rely on native layer's state management
      const syncState = this.dataSyncStates?.get(deviceId);
      isSyncActive = syncState?.isActive === true;
    }
    
    const isConnected = device?.connectionState === CONNECTION_STATES.CONNECTED;
    const isLiveData = parsedData?.rtcValid || (parsedData?.deviceRTC && parsedData.deviceRTC > 1577836800);

    // Respect polling guard unless explicitly bypassed
    const nowMs = Date.now();
    
    if (!this.autoSyncMeta) {
      this.autoSyncMeta = new Map();
    }
    const meta = this.autoSyncMeta.get(deviceId) || {};
    
    // ✅ FIX: Check if sync just completed - skip auto-sync if sync completed within last 5 seconds
    // This prevents the read after sync completion from triggering another sync
    let syncJustCompleted = false;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state === 'complete') {
          // Use lastSyncCompletedAt if available (more accurate), otherwise fall back to lastSyncAt
          const lastSyncCompletedAt = meta.lastSyncCompletedAt || meta.lastSyncAt || 0;
          const timeSinceSync = nowMs - lastSyncCompletedAt;
          syncJustCompleted = timeSinceSync < 15000; // 15 seconds grace period (prevent duplicate syncs of newly generated records)
          if (syncJustCompleted) {
            console.log(`⏭️ [AUTO SYNC] Skipping - sync just completed ${timeSinceSync}ms ago (state: complete)`);
          }
        }
      } catch (error) {
        // Ignore error, continue with normal flow
      }
    }
    
    // ✅ FIX: Only skip auto-sync for MANUAL reads (user-initiated), not periodic polling reads
    // Since firmware doesn't send automatic notifications, periodic polling (every 30s) is the workaround
    // and should be treated as "live updates" for auto-sync purposes
    const isFromManualRead = options?.skipPollingCheck
      ? false
      : (this.manualReadTimestamps?.get(deviceId) && (nowMs - this.manualReadTimestamps.get(deviceId)) < 2000);
    
    // ✅ FIX: Use isFromPolling from parsedData (sent by native iOS/Android) if available
    // This is more accurate than calculating from timestamps
    // Native code tracks polling reads correctly and sends the flag in the event
    let isFromPolling = parsedData?.isFromPolling;
    
    // ✅ FALLBACK: If isFromPolling not provided by native code, calculate from timestamps
    // This is a fallback for older code paths or if native code doesn't send the flag
    if (isFromPolling === undefined || isFromPolling === null) {
      // Check if this is from periodic polling (workaround for missing notifications)
      // Periodic polling happens every ~30 seconds, so if time since last read is ~30s, it's periodic polling
      const lastReadTime = meta.lastDeviceStatusReadTime || 0;
      const timeSinceLastRead = lastReadTime > 0 ? (nowMs - lastReadTime) : 0;
      const isFromPeriodicPolling = timeSinceLastRead > 25000 && timeSinceLastRead < 35000; // ~30 seconds ± 5s
      
      // Only skip if it's a manual read, not periodic polling
      isFromPolling = isFromManualRead && !isFromPeriodicPolling;
      
      // ✅ DEBUG: Log when using fallback calculation
      if (isFromPolling) {
        console.log(`⚠️ [AUTO SYNC] Using fallback isFromPolling calculation (native flag not provided)`);
      }
    } else {
      // ✅ FIX: Ensure isFromPolling is a boolean (convert truthy/falsy to boolean)
      isFromPolling = isFromPolling === true;
      // ✅ DEBUG: Log when using native flag
      console.log(`✅ [AUTO SYNC] Using isFromPolling=${isFromPolling} from native event`);
    }
    
    // ✅ FIX: Ensure isFromPolling is always a boolean (never undefined/null)
    // This prevents issues in comparisons and logging
    if (isFromPolling === undefined || isFromPolling === null) {
      isFromPolling = false;
    }
    
    // Update last read time for next comparison
    meta.lastDeviceStatusReadTime = nowMs;
    this.autoSyncMeta.set(deviceId, meta);

    const recordCountIncreased = meta.lastRecordCount === undefined || parsedData?.recordCount > meta.lastRecordCount;
    
    // ✅ IMPROVEMENT 3: Use adaptive throttle
    const throttleTime = this.calculateAdaptiveThrottle(deviceId);
    const throttleExpired = !meta.lastSyncAt || (nowMs - meta.lastSyncAt) > throttleTime;
    
    // ✅ FIX: Allow immediate sync for single records (don't wait for throttle)
    // Single records are likely new data that should be synced quickly
    // Multiple records can wait for throttle to expire (they're accumulating anyway)
    const isSingleRecord = parsedData?.recordCount === 1;
    const shouldSync = isSingleRecord || recordCountIncreased || throttleExpired;
    
    // Track record accumulation for adaptive throttle
    if (!this.recordAccumulationRates.has(deviceId)) {
      this.recordAccumulationRates.set(deviceId, []);
    }
    const rateHistory = this.recordAccumulationRates.get(deviceId);
    rateHistory.push({
      timestamp: nowMs,
      count: parsedData?.recordCount || 0
    });
    // Keep only last 10 entries
    if (rateHistory.length > 10) {
      rateHistory.shift();
    }
    
    // ✅ REMOVED: JavaScript fallback polling (native polling handles everything)
    // Update last notification time for metrics only
    this.lastNotificationTime.set(deviceId, nowMs);

    // ✅ FIX: Notification deduplication - ignore duplicates within 100ms
    // This prevents Android's dual event handlers (DeviceDataUpdated + deviceDataUpdate) from triggering twice
    const lastNotification = this.lastNotificationData?.get(deviceId);
    if (lastNotification && 
        lastNotification.recordCount === parsedData?.recordCount &&
        (nowMs - lastNotification.timestamp) < this.notificationDedupeWindow) {
      console.log(`⏭️ [AUTO SYNC] Skipping - duplicate notification (${nowMs - lastNotification.timestamp}ms ago, same record count: ${parsedData?.recordCount})`);
      return;
    }
    
    // Update last notification data
    if (!this.lastNotificationData) {
      this.lastNotificationData = new Map();
    }
    this.lastNotificationData.set(deviceId, {
      recordCount: parsedData?.recordCount || 0,
      timestamp: nowMs
    });
    
    // ✅ CRITICAL FIX (iOS & Android): Polling IS the workaround for live notifications
    // Firmware doesn't send automatic notifications when records are generated
    // Instead, native code polls Device Status every 30-120 seconds and sets isFromPolling=true
    // These polling reads SHOULD trigger auto-sync when records are available
    // 
    // Previous bug: Condition was `!isFromPollingValue` which blocked polling reads
    // Android was working by accident because isFromPolling was extracted wrong (false instead of true)
    // iOS was blocked completely because isFromPolling was extracted correctly (true)
    const isFromPollingValue = isFromPolling === true;
    
    // ✅ DEBUG: Log auto-sync decision criteria for both platforms
    console.log(`📊 [AUTO SYNC] Auto-sync conditions (${Platform.OS}):`, {
      hasRecordsAvailable,
      isSyncActive,
      syncJustCompleted,
      isConnected,
      isLiveData,
      isFromPolling: isFromPollingValue,
      shouldSync,
      recordCount: parsedData?.recordCount,
      isSingleRecord,
      recordCountIncreased,
      throttleExpired,
      throttleTime
    });
    
    // ✅ CRITICAL FIX: Trigger auto-sync ONLY for polling reads (isFromPollingValue=true)
    // Manual reads (isFromPollingValue=false) should NOT trigger auto-sync
    if (hasRecordsAvailable && !isSyncActive && !syncJustCompleted && isConnected && isLiveData && isFromPollingValue && shouldSync) {
      console.log(`✅ [AUTO SYNC] All conditions met for ${Platform.OS}, proceeding with auto-sync for ${deviceId}`);
      
      // ✅ FIX: Timer reset debounce - only reset if last reset was > 500ms ago
      const lastTimerResetTime = this.lastTimerReset?.get(deviceId) || 0;
      const timeSinceLastReset = nowMs - lastTimerResetTime;
      
      if (timeSinceLastReset < this.timerResetDebounceWindow) {
        console.log(`⏭️ [AUTO SYNC] Skipping timer reset - too recent (${timeSinceLastReset}ms ago, min: ${this.timerResetDebounceWindow}ms)`);
        return;
      }
      
      // ✅ CRITICAL FIX: Clear any existing timer BEFORE creating new one
      // This prevents multiple timers from being created when multiple notifications arrive quickly
      if (!this.autoSyncTimers) {
        this.autoSyncTimers = new Map();
      }
      
      if (this.autoSyncTimers.has(deviceId)) {
        const existingTimer = this.autoSyncTimers.get(deviceId);
        clearTimeout(existingTimer);
        this.autoSyncTimers.delete(deviceId); // Remove from map immediately
        console.log(`🔄 [AUTO SYNC] Cleared existing timer for ${deviceId} - new notification received`);
      }
      
      // Update last timer reset time
      if (!this.lastTimerReset) {
        this.lastTimerReset = new Map();
      }
      this.lastTimerReset.set(deviceId, nowMs);

      // ✅ TRACK RECORD COUNT: Store the record count at notification time for comparison
      const recordCountAtNotification = parsedData.recordCount;
      const notificationTimestamp = Date.now();
      
      // ✅ FIX: Store hasRecordsAvailable in closure since it's checked inside timer
      const hasRecordsAtNotification = hasRecordsAvailable;
      
      const syncTimer = setTimeout(async () => {
        if (this.autoSyncConfig.debounceDelay > 0) {
          console.log(`⏰ [AUTO SYNC] Timer fired for ${deviceId} after ${this.autoSyncConfig.debounceDelay}ms delay`);
        } else {
          console.log(`⏰ [AUTO SYNC] Starting sync immediately for ${deviceId} (no debounce delay)`);
        }
        
        const currentDevice = this.scannedDevices.get(deviceId);
        const stillConnected = currentDevice?.connectionState === CONNECTION_STATES.CONNECTED;
        const currentRecordCount = currentDevice?.deviceData?.recordCount || recordCountAtNotification;
        const stillHasRecords = currentRecordCount > 0;
        
        // ✅ SYNC WITH iOS: Check native state directly (matching iOS behavior)
        let stillActive = false;
        let currentState = 'unknown';
        if (Platform.OS === 'android' && SampleBridgeAndroid) {
            try {
              const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
              if (nativeState && nativeState.state) {
                currentState = nativeState.state;
                // ✅ FIX: "ready" is NOT an active sync state - it's a transitional state
                // Only "syncing" and "time_syncing" indicate an active sync
                const activeStates = ['syncing', 'time_syncing'];
                stillActive = activeStates.includes(nativeState.state);
                console.log(`🔍 [AUTO SYNC] Native sync state: ${currentState}, stillActive: ${stillActive}`);
              }
          } catch (error) {
            // Fallback to JS state if native query fails
            const currentSyncState = this.dataSyncStates?.get(deviceId);
            stillActive = currentSyncState?.isActive === true;
            currentState = currentSyncState?.state || 'unknown';
            console.log(`⚠️ [AUTO SYNC] Native state query failed, using JS state: ${stillActive}`);
          }
        } else {
          // iOS: Use JS state (iOS native manages state internally)
          const currentSyncState = this.dataSyncStates?.get(deviceId);
          stillActive = currentSyncState?.isActive === true;
          currentState = currentSyncState?.state || 'unknown';
        }

        if (!stillActive && stillConnected && stillHasRecords) {
          const delayMs = Date.now() - notificationTimestamp;
          const recordCountDelta = currentRecordCount - recordCountAtNotification;
          
          console.log(`🔄 [AUTO SYNC] Triggering sync start from live notification`);
          console.log(`📊 [AUTO SYNC] Record count at notification: ${recordCountAtNotification}, current: ${currentRecordCount}, delta: ${recordCountDelta}`);
          console.log(`⏱️ [AUTO SYNC] Delay between notification and sync start: ${delayMs}ms`);
          console.log(`ℹ️ [AUTO SYNC] Note: Device continues generating records during delay - sync will include all available records`);
          
          // ✅ IMPROVEMENT 2: Log state transition
          this.logStateTransition(deviceId, currentState, 'syncing', 'auto-sync triggered');
          
          // ✅ IMPROVEMENT 6: Emit user feedback
          this.emitUserFeedback(deviceId, 'sync_starting', {
            recordCount: currentRecordCount,
            reason: 'auto_sync'
          });
          
          // ✅ IMPROVEMENT 7: Record sync start for metrics
          this.recordSyncStart(deviceId);
          
          try {
            // ✅ IMPROVEMENT 5: Use sync queue if sync is already in progress
            if (this.processingSync.get(deviceId)) {
              console.log(`📋 [SYNC QUEUE] Sync already processing, adding to queue`);
              this.addToSyncQueue(deviceId, {
                recordCount: currentRecordCount,
                reason: 'auto_sync'
              });
              return;
            }
            
            const syncStartTime = Date.now();
            const result = await this.startDataSync(deviceId);
            
            // ✅ CHECK FOR DUPLICATE SYNC: If native rejected due to already syncing, log it
            if (result && result.status === 'already_syncing') {
              console.warn(`⚠️ [AUTO SYNC] Sync rejected - already in progress (state: ${result.currentState})`);
              // Add to queue instead
              this.addToSyncQueue(deviceId, {
                recordCount: currentRecordCount,
                reason: 'auto_sync_retry'
              });
              return;
            }
            
            // ✅ IMPROVEMENT 1: Handle errors with exponential backoff
            if (result && result.status === 'error') {
              console.error(`❌ [AUTO SYNC] Sync failed: ${result.error}`);
              this.recordSyncFailure(deviceId, result.error || 'unknown_error');
              this.emitUserFeedback(deviceId, 'sync_failed', { error: result.error });
              
              // Retry with exponential backoff
              await this.retrySyncWithBackoff(deviceId);
              return;
            }
            
            // ✅ IMPROVEMENT 7: Record success metrics
            const syncLatency = Date.now() - syncStartTime;
            this.recordSyncSuccess(deviceId, syncLatency);
            
            // Update meta on successful kick-off
            this.autoSyncMeta.set(deviceId, {
              lastRecordCount: recordCountAtNotification,
              lastSyncAt: Date.now(),
            });
            
            // ✅ IMPROVEMENT 6: Emit success feedback
            this.emitUserFeedback(deviceId, 'sync_started', {
              recordCount: currentRecordCount
            });
          } catch (error) {
            console.error(`❌ [AUTO SYNC] Failed to start sync:`, error);
            this.recordSyncFailure(deviceId, error.message || 'exception');
            this.emitUserFeedback(deviceId, 'sync_failed', { error: error.message });
            
            // ✅ IMPROVEMENT 1: Retry with exponential backoff
            await this.retrySyncWithBackoff(deviceId);
          }
        } else {
          console.log(`⏭️ [AUTO SYNC] Conditions changed during delay - sync: ${stillActive}, connected: ${stillConnected}, hasRecords: ${stillHasRecords}`);
          if (stillActive) {
            console.log(`   → Sync is active, skipping auto-sync`);
            // ✅ IMPROVEMENT 5: Add to queue instead
            this.addToSyncQueue(deviceId, {
              recordCount: currentRecordCount,
              reason: 'sync_already_active'
            });
          }
          if (!stillConnected) {
            console.log(`   → Device disconnected, skipping auto-sync`);
          }
          if (!stillHasRecords) {
            console.log(`   → No records available, skipping auto-sync`);
          }
        }

        // Always clean up timer after it fires
        if (this.autoSyncTimers) {
          this.autoSyncTimers.delete(deviceId);
        }
      }, this.autoSyncConfig.debounceDelay); // Use configurable debounce delay
      
      // Set the new timer
      this.autoSyncTimers.set(deviceId, syncTimer);
      if (this.autoSyncConfig.debounceDelay > 0) {
        console.log(`⏰ [AUTO SYNC] Scheduled sync start in ${this.autoSyncConfig.debounceDelay}ms for ${deviceId} (${parsedData.recordCount} records at notification time)`);
        console.log(`ℹ️ [AUTO SYNC] Note: Record count may increase during ${this.autoSyncConfig.debounceDelay}ms delay as tag continues generating records`);
      } else {
        console.log(`⏰ [AUTO SYNC] Starting sync immediately for ${deviceId} (${parsedData.recordCount} records available)`);
      }
      console.log(`📊 [AUTO SYNC] Auto-sync conditions: isSingleRecord=${isSingleRecord}, recordCountIncreased=${recordCountIncreased}, throttleExpired=${throttleExpired} (throttle: ${throttleTime}ms), lastSyncAt=${meta.lastSyncAt || 'never'}`);
    } else {
      // ✅ ENHANCED LOGGING: Log why auto-sync is being skipped with detailed conditions
      const skipReasons = [];
      if (!hasRecordsAvailable) {
        skipReasons.push(`no records available (${parsedData?.recordCount || 0})`);
      }
      if (isSyncActive) {
        skipReasons.push(`sync already in progress`);
      }
      if (!isConnected) {
        skipReasons.push(`device not connected`);
      }
      if (!isLiveData) {
        skipReasons.push(`invalid RTC (rtcValid: ${parsedData?.rtcValid}, deviceRTC: ${parsedData?.deviceRTC})`);
      }
      // ✅ CRITICAL FIX: isFromPolling=true means FROM periodic polling (SHOULD trigger auto-sync)
      // isFromPolling=false means manual read (SHOULD NOT trigger auto-sync)
      if (!isFromPollingValue) {
        skipReasons.push(`not from periodic polling (isFromPolling=${isFromPollingValue}) - only polling reads trigger auto-sync`);
      }
      if (syncJustCompleted) {
        skipReasons.push(`sync just completed (within 5s grace period)`);
      }
      if (!isSingleRecord && !recordCountIncreased && !throttleExpired) {
        const timeSinceLastSync = meta.lastSyncAt ? (nowMs - meta.lastSyncAt) : 'never';
        skipReasons.push(`throttled (lastSyncAt: ${timeSinceLastSync}ms ago, isSingleRecord: ${isSingleRecord}, recordCountIncreased: ${recordCountIncreased}, throttleExpired: ${throttleExpired})`);
      }
      
      if (skipReasons.length > 0) {
        console.log(`⏭️ [AUTO SYNC] Skipping - ${skipReasons.join(', ')}`);
        // ✅ FIX: Ensure isFromPolling is always a boolean for logging
        const isFromPollingForLog = isFromPolling === true;
        console.log(`📊 [AUTO SYNC] Conditions check: hasRecords=${hasRecordsAvailable}, isSyncActive=${isSyncActive}, isConnected=${isConnected}, isLiveData=${isLiveData}, isFromPolling=${isFromPollingForLog} (raw: ${isFromPolling}, type: ${typeof isFromPolling}), syncJustCompleted=${syncJustCompleted}, isSingleRecord=${isSingleRecord}, recordCountIncreased=${recordCountIncreased}, throttleExpired=${throttleExpired}`);
      }
    }
  }

  // Handle device status updates
  async handleDeviceStatusUpdate(deviceId, data) {
    try {
      // Track notification count
      const currentStats = this.notificationCounts.get(deviceId) || {
        deviceStatus: 0, batteryLevel: 0, dataTransfer: 0, systemCommand: 0, total: 0, lastUpdate: null
      };
      currentStats.deviceStatus++;
      currentStats.total++;
      currentStats.lastUpdate = new Date();
      this.notificationCounts.set(deviceId, currentStats);
      
      // Log every 10th notification to avoid spam
      if (currentStats.deviceStatus % 10 === 0) {
      }
      
      // Log first few notifications with detailed info
      if (currentStats.deviceStatus <= 3) {
      }
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }


      
      const parsedData = BLEDataParser.parseDeviceStatus(data);
      

      if (parsedData) {
        // Only log parsed data for first few notifications
        if (currentStats.deviceStatus <= 2) {
        }

        // ✅ AUTO TIME SYNC: Check if RTC is invalid (stale/unset) and sync automatically
        const incomingDate = parsedData.lastUpdate;
        const isStaleRTC = incomingDate && incomingDate < new Date('2020-01-01');
        const rtcValid = parsedData.rtcValid;
        
        // ✅ FIX: Check if time sync was recently sent - if so, this notification might be from BEFORE time sync
        // Only validate RTC using notifications that arrived AFTER time sync
        const timeSyncSentTime = this.timeSyncSentTimes?.get(deviceId) || 0;
        const timeSinceTimeSync = Date.now() - timeSyncSentTime;
        const isRecentTimeSync = timeSyncSentTime > 0 && timeSinceTimeSync < 30000; // 30 seconds
        const notificationArrivedAfterTimeSync = timeSyncSentTime === 0 || (timeSyncSentTime > 0 && Date.now() > timeSyncSentTime);
        
        // ✅ FIX: If time sync was sent recently, ignore device status notifications that arrived too soon after
        // Device needs time to process time sync and send a new notification with updated RTC
        // Wait at least 5 seconds after time sync before checking RTC validity
        const shouldIgnoreThisNotification = isRecentTimeSync && timeSinceTimeSync < 5000;
        
        if (shouldIgnoreThisNotification) {
          console.log(`⏰ [AUTO TIME SYNC] Ignoring device status notification - too soon after time sync (${Math.round(timeSinceTimeSync / 1000)}s ago, need 5s)`);
          // Still update device data but don't trigger sync yet
        }
        
        // Check if device was recently restarted (within last 60 seconds)
        const restartTime = this.deviceRestartTimes?.get(deviceId) || 0;
        const timeSinceRestart = Date.now() - restartTime;
        const isRecentRestart = restartTime > 0 && timeSinceRestart < 60000; // 60 seconds
        
        // Auto sync time if RTC is invalid
        // Trigger if: (first 5 notifications) OR (recent restart detected) OR (recent time sync but RTC still invalid after waiting)
        // ✅ FIX: Only check RTC if notification arrived AFTER time sync (or no time sync was sent)
        // ✅ FIX: Increased from 3 to 5 notifications to catch auto-connect case
        const shouldTriggerSync = !shouldIgnoreThisNotification && (isStaleRTC || !rtcValid) && 
          (currentStats.deviceStatus <= 5 || isRecentRestart || (isRecentTimeSync && timeSinceTimeSync > 5000 && notificationArrivedAfterTimeSync));
        
        if (shouldTriggerSync) {
          const timeSyncKey = `timeSync_${deviceId}`;
          const lastTimeSync = this.lastTimeSyncAttempt?.get(timeSyncKey) || 0;
          const timeSinceLastSync = Date.now() - lastTimeSync;
          
          // ✅ FIX: If time sync was just sent, wait longer before retrying (device needs time to process)
          const minRetryInterval = isRecentTimeSync ? 15000 : 30000; // 15s if recent sync, 30s otherwise
          
          // Only attempt sync if we haven't tried in the minimum interval
          if (timeSinceLastSync > minRetryInterval) {
            const reason = isRecentRestart ? 'after system restart' : 
                          isRecentTimeSync ? 'RTC still invalid after time sync' : 'RTC invalid';
            console.log(`⏰ [AUTO TIME SYNC] Device RTC invalid (${reason}), syncing time automatically...`);
            if (!this.lastTimeSyncAttempt) {
              this.lastTimeSyncAttempt = new Map();
            }
            this.lastTimeSyncAttempt.set(timeSyncKey, Date.now());
            
            // Delay sync slightly to ensure connection is stable
            // Longer delay after restart or recent time sync to allow device to fully initialize
            const delay = isRecentRestart ? 3000 : (isRecentTimeSync ? 5000 : 2000);
            setTimeout(async () => {
              try {
                await this.syncDeviceTime(deviceId);
                // Update time sync sent time after successful sync
                if (!this.timeSyncSentTimes) {
                  this.timeSyncSentTimes = new Map();
                }
                this.timeSyncSentTimes.set(deviceId, Date.now());
              } catch (error) {
                console.error(`❌ [AUTO TIME SYNC] Failed:`, error);
              }
            }, delay);
          } else {
            console.log(`⏰ [AUTO TIME SYNC] Skipping - last sync attempt was ${Math.round(timeSinceLastSync / 1000)}s ago (min interval: ${minRetryInterval / 1000}s)`);
          }
        }

        if (BLEDataParser.validateData(parsedData)) {
          // ✅ CRITICAL: Don't overwrite synced data with stale characteristic reads!
          // Check if incoming data is stale (before 2020) and we already have synced data
          const hasSyncedData = device.deviceData?.dataSource === 'synced';
          
          if (isStaleRTC && hasSyncedData) {
            console.log(`⏭️ [iOS] Skipping stale read (${incomingDate.toISOString()}) - already have synced data`);
            
            // Only update battery level (it doesn't come from sync)
            if (parsedData.batteryLevel !== undefined) {
              device.deviceData.batteryLevel = parsedData.batteryLevel;
              this.scannedDevices.set(deviceId, device);
              
              if (this.onDeviceListUpdated) {
                this.onDeviceListUpdated();
              }
            }
            return;
          }
          
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

          // Debug: Check if device RTC timestamp is changing
          const oldDeviceRTC = device.deviceData?.deviceRTC;
          const newDeviceRTC = parsedData.deviceRTC;
          
          if (oldDeviceRTC && newDeviceRTC && oldDeviceRTC !== newDeviceRTC) {
          } else if (newDeviceRTC) {
          }

          // ✅ PRIORITY: Don't overwrite battery level from 2A19 with Device Status battery level
          // Battery Service (2A19) is the standard and more accurate source for battery percentage
          // Device Status battery voltage can be kept for reference, but percentage comes from 2A19
          const batteryLevelToUse = device.deviceData?.batteryLevel !== null && device.deviceData?.batteryLevel !== undefined
            ? device.deviceData.batteryLevel  // Keep existing battery level from 2A19 (if available)
            : (parsedData.batteryLevel !== undefined ? parsedData.batteryLevel : null); // Only use Device Status if no 2A19 value
          
          device.deviceData = {
            ...device.deviceData,
            ...parsedData,
            batteryLevel: batteryLevelToUse, // Override with prioritized battery level (2A19 takes priority)
            // Mark as live data source if it's valid live data
            dataSource: (parsedData.timestamp && parsedData.timestamp > 1577836800) ? 'live' : (device.deviceData?.dataSource || 'cached'),
            // Use device RTC timestamp for lastUpdate if available, otherwise use current time
            lastUpdate: parsedData.lastUpdate || new Date()
          };
          
          // ✅ Update recordCount from device status if available
          if (parsedData.recordCount !== undefined && parsedData.recordCount !== null) {
            device.deviceData.recordCount = parsedData.recordCount;
            
            // ✅ CRITICAL FIX: Also update manufacturerData.recordCount for UI consistency
            // The UI shows manufacturerData.recordCount in some places, so keep it in sync
            if (device.manufacturerData) {
              device.manufacturerData.recordCount = parsedData.recordCount;
              device.manufacturerData.hasRecords = parsedData.recordCount > 0;
            }
          }

          this.scannedDevices.set(deviceId, device);

          // Only log changes, not repeated same values
          const dataChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature ||
            previousData.batteryLevel !== device.deviceData.batteryLevel;

          if (dataChanged) {
          }

          // ✅ AUTO-SYNC: Mirror iOS logic via shared helper to avoid divergence
          this.maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData).catch((error) => {
            // Ignore errors - auto-sync is best effort
          });
          
          // ✅ Trigger device list update when recordCount changes
          const recordCountChanged = previousData.recordCount !== device.deviceData.recordCount;
          if (recordCountChanged && this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }

          // ✅ Add live data to syncRecords if steps or temperature changed (not just battery)
          const stepsOrTempChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature;
          
          if (stepsOrTempChanged && parsedData.timestamp && parsedData.timestamp > 1577836800) {
            // Initialize syncRecords array if it doesn't exist
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            
            // Check if we already have a record with this timestamp (avoid duplicates)
            const existingRecordIndex = device.syncRecords.findIndex(r => {
              const recordTimestamp = r.timestamp || (r.timestampDate ? Math.floor(r.timestampDate.getTime() / 1000) : null);
              return recordTimestamp === parsedData.timestamp;
            });
            
            if (existingRecordIndex >= 0) {
              // Update existing record with latest data
              device.syncRecords[existingRecordIndex] = {
                ...device.syncRecords[existingRecordIndex],
                steps: parsedData.steps || device.syncRecords[existingRecordIndex].steps,
                temperature: parsedData.temperature !== undefined && parsedData.temperature !== null 
                  ? parsedData.temperature 
                  : device.syncRecords[existingRecordIndex].temperature,
                receivedAt: new Date(),
                deviceId,
                source: 'live'
              };
            } else {
              // Add new record from live notification
              const newRecord = {
                timestamp: parsedData.timestamp,
                timestampDate: parsedData.lastUpdate || new Date(parsedData.timestamp * 1000),
                steps: parsedData.steps || 0,
                temperature: parsedData.temperature !== undefined && parsedData.temperature !== null 
                  ? parsedData.temperature 
                  : 0,
                receivedAt: new Date(),
                deviceId,
                source: 'live'
              };
              device.syncRecords.push(newRecord);
              
              // ✅ Save to Redux for historical records
              try {
                store.dispatch(addRecord({ deviceId, record: newRecord }));
              } catch (error) {
                console.warn('Failed to save record to Redux:', error);
              }
            }
            
            // Update recordCount incrementally
            if (!device.deviceData) {
              device.deviceData = {};
            }
            device.deviceData.recordCount = device.syncRecords.length;
            
            // Trigger UI update for syncRecords screen
            this.emit('deviceDataUpdate', {
              deviceId,
              type: 'live_record',
              records: device.syncRecords,
              totalRecords: device.syncRecords.length
            });
            
            console.log(`📊 [LIVE RECORD] Added live record to syncRecords. Total: ${device.syncRecords.length}`);
            
            this.scannedDevices.set(deviceId, device);
            
            // Trigger device list update for UI refresh
            if (this.onDeviceListUpdated) {
              this.onDeviceListUpdated();
            }
          }

          // Trigger UI update callback if available and app is active
          if (this.onDeviceDataUpdated && this.appState === 'active') {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
          }

          // ✅ INDUSTRY STANDARD: Buffer live data instead of immediate API call
          // Only buffer if historical sync is complete (avoid buffering stale 1979 data)
          const isHistoricalSyncComplete = this.historicalSyncComplete.get(deviceId);
          const isValidLiveData = parsedData.deviceRTC && parsedData.deviceRTC > 1577836800; // After 2020-01-01 (valid RTC)
          
          if (isHistoricalSyncComplete && isValidLiveData) {
            // Add to live buffer
            // ✅ FIX: Use deviceRTC (Unix timestamp in seconds) instead of timestamp Date object
            this.addToLiveBuffer(deviceId, {
              timestamp: parsedData.deviceRTC || (parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null),
              timestampDate: parsedData.lastUpdate || (parsedData.timestamp || new Date()),
              steps: parsedData.steps,
              temperature: parsedData.temperature,
              batteryLevel: parsedData.batteryLevel
            });
            
            // Check for immediate alerts (temp spike, low battery)
            const alertSent = await this.checkImmediateAlert(deviceId, {
              temperature: parsedData.temperature,
              steps: parsedData.steps,
              batteryLevel: parsedData.batteryLevel,
              timestampDate: parsedData.lastUpdate
            });
            
            if (alertSent) {
              console.log(`🚨 Immediate alert sent for ${deviceId}`);
            }
            
            // Upload batch if buffer full or time elapsed
            if (this.shouldUploadBatch(deviceId)) {
              console.log(`📤 [AUTO UPLOAD] Buffer conditions met, uploading batch...`);
              await this.uploadLiveBatch(deviceId);
            }
          } else if (!isLiveData) {
            console.log(`📦 [CACHED DATA] Skipping buffer - waiting for live data with 2025 timestamp`);
          } else {
            console.log(`⏳ [WAITING] Historical sync not complete yet, skipping buffer`);
          }
        } else {
        }
      } else {
      }

    } catch (error) {
    }
  }

  // Handle battery level updates
  handleBatteryUpdate(deviceId, data) {
    try {
      // Track notification count
      const currentStats = this.notificationCounts.get(deviceId) || {
        deviceStatus: 0, batteryLevel: 0, dataTransfer: 0, systemCommand: 0, total: 0, lastUpdate: null
      };
      currentStats.batteryLevel++;
      currentStats.total++;
      currentStats.lastUpdate = new Date();
      this.notificationCounts.set(deviceId, currentStats);
      
      
      // Log first few battery notifications with detailed info
      if (currentStats.batteryLevel <= 3) {
      }
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }
      
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

        // ✅ PRIORITY: Battery level from 2A19 characteristic always takes priority over manufacturer data
        // This ensures we use the accurate battery percentage from the Battery Service
        device.deviceData = {
          ...device.deviceData,
          batteryLevel, // Always use battery level from 2A19 characteristic (most accurate)
          // Preserve existing lastUpdate (device RTC) if available, otherwise use current time
          lastUpdate: device.deviceData.lastUpdate || new Date()
        };

        this.scannedDevices.set(deviceId, device);

        // Trigger UI update callback if available and app is active
        if (this.onDeviceDataUpdated && this.appState === 'active') {
          this.onDeviceDataUpdated(deviceId, device.deviceData);
        } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
        }

        // Adjust tag-specific optimizations based on tag battery level
        this.adjustTagOptimizationsForBattery(deviceId, batteryLevel);

        // TODO: API call commented out to prevent calling on every notification
        // Send pet health data to server after battery update
        // if (device.connectionState === CONNECTION_STATES.CONNECTED) {
        //   const connectionType = device.connectionType || 'manual';
        //   setTimeout(() => {
        //     this.sendPetHealthDataToServer(deviceId);
        //   }, 1000); // Wait 1 second to ensure data is stable
        // }
      } else {
      }

    } catch (error) {
    }
  }

  // Adjust tag-specific optimizations based on tag battery level
  adjustTagOptimizationsForBattery(deviceId, batteryLevel) {
    
    // Tag battery only affects tag-specific optimizations, not phone power profile
    if (batteryLevel <= 15) {
      // Could implement tag-specific power saving here
    } else if (batteryLevel <= 30) {
      // Could implement tag-specific power saving here
    } else if (batteryLevel >= 80) {
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
        const newLevel = Math.round(batteryLevel * 100);
        
        if (newLevel !== this.phoneBatteryLevel) {
          this.phoneBatteryLevel = newLevel;
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
        }
        
        
        return;
      } catch (e) {
      }
      
      // Method 2: Battery API (web fallback)
      if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        const newLevel = Math.round(battery.level * 100);
        
        if (newLevel !== this.phoneBatteryLevel) {
          this.phoneBatteryLevel = newLevel;
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
        }
        
        // Set up event listeners for battery changes
        battery.addEventListener('levelchange', () => {
          this.phoneBatteryLevel = Math.round(battery.level * 100);
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
        });
        
        battery.addEventListener('chargingchange', () => {
          this.phoneBatteryLevel = Math.round(battery.level * 100);
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
        });
        
        return;
      }
      
      // Method 3: Manual input fallback
      if (this.phoneBatteryLevel === null || this.phoneBatteryLevel === 100) {
        
        // Set a reasonable default based on current power profile
        if (this.profile === POWER_PROFILE.ultraLowPower) {
          this.phoneBatteryLevel = 20; // Assume low battery
        } else if (this.profile === POWER_PROFILE.lowPower) {
          this.phoneBatteryLevel = 50; // Assume medium battery
        } else {
          this.phoneBatteryLevel = 80; // Assume good battery
        }
        
      }
      
    } catch (error) {
    }
  }

  // Adjust phone power profile based on phone battery level
  adjustPhonePowerProfileForBattery(phoneBatteryLevel) {
    
    let newProfile = 'default';
    
    if (phoneBatteryLevel <= 15) {
      newProfile = 'ultraLowPower';
    } else if (phoneBatteryLevel <= 30) {
      newProfile = 'lowPower';
    } else if (phoneBatteryLevel >= 80) {
      newProfile = 'default';
    }

    // ✅ INDUSTRY STANDARD: Adjust batch upload frequency based on phone battery
    if (phoneBatteryLevel <= 15) {
      // Critical battery: Upload every 10 minutes instead of 5
      this.liveDataConfig.uploadInterval = 600000;  // 10 minutes
      this.liveDataConfig.bufferSize = 20;  // 20 records (10 minutes at 30s intervals)
      console.log(`🔋 [LOW BATTERY] Reduced upload frequency: 10 minutes`);
    } else if (phoneBatteryLevel <= 30) {
      // Low battery: Upload every 7 minutes
      this.liveDataConfig.uploadInterval = 420000;  // 7 minutes
      this.liveDataConfig.bufferSize = 14;  // 14 records
      console.log(`🔋 [LOW BATTERY] Reduced upload frequency: 7 minutes`);
    } else {
      // Normal battery: Upload every 5 minutes (default)
      this.liveDataConfig.uploadInterval = 300000;  // 5 minutes
      this.liveDataConfig.bufferSize = 10;  // 10 records
    }

    // Only change if different from current profile
    const currentProfileName = this.getCurrentProfileName();
    
    if (newProfile !== currentProfileName) {
      this.setPowerProfile(newProfile);
    } else {
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
      
    } else if (profile === POWER_PROFILE.lowPower) {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;    // 30s intervals (2x slower)
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 120000;     // 120s intervals (2x slower)
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 120000; // 120s intervals (2x slower)
      
      // Update GET API intervals for low power mode
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;        // 30s intervals (2x slower)
      this.getApiConfig.BACKGROUND_INTERVAL = 0;               // No calls when in background
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;           // No calls when screen not active
      
    } else {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;    // 15s intervals (default)
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 60000;      // 60s intervals (default)
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 60000;  // 60s intervals (default)
      
      // Update GET API intervals for default mode
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;        // 15s intervals (default)
      this.getApiConfig.BACKGROUND_INTERVAL = 0;               // No calls when in background
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;           // No calls when screen not active
      
    }
  }

  // Get current phone battery level
  getPhoneBatteryLevel() {
    return this.phoneBatteryLevel;
  }







  // Handle data transfer (SDD Table 13 - Data Transfer Characteristic)
  handleDataTransfer(deviceId, data) {
    try {
      
      const parsedTransfer = BLEDataParser.parseDataTransfer(data);

      if (!parsedTransfer) {
        return;
      }

      // Handle different transfer types according to SDD
      switch (parsedTransfer.typeString) {
        case 'sync_start':
          this.handleSyncStart(deviceId, parsedTransfer);
          break;
          
        case 'sync_complete':
          this.handleSyncComplete(deviceId, parsedTransfer);
          break;
          
        case 'record':
          this.handleDataRecord(deviceId, parsedTransfer);
          break;
          
        case 'read_error':
          this.handleReadError(deviceId, parsedTransfer);
          break;
          
        default:
      }

    } catch (error) {
    }
  }

  // Handle sync start (SDD: 0x01 - Data Sync Start)
  handleSyncStart(deviceId, parsedTransfer) {
    
    // Check if data is corrupted
    if (parsedTransfer.corrupted) {
      return; // Don't proceed with sync if data is corrupted
    }
    
    // ✅ Compare expected vs actual record count
    const device = this.scannedDevices.get(deviceId);
    const expectedRecordCount = device?.deviceData?.recordCount || 0;
    const actualRecordCount = parsedTransfer.totalRecords || 0;
    
    // Debug: Log what we're comparing
    console.log(`🔍 [SYNC START DEBUG] Device: ${deviceId}, Expected: ${expectedRecordCount}, Actual: ${actualRecordCount}`);
    
    if (actualRecordCount > expectedRecordCount) {
      const diff = actualRecordCount - expectedRecordCount;
      console.log(`ℹ️ [SYNC START] Record count increased: Status showed ${expectedRecordCount}, device sending ${actualRecordCount} (+${diff})`);
      console.log(`   ✅ This is NORMAL - device generates records continuously between status check and sync start`);
      console.log(`   ✅ We want ALL records, so this is the correct behavior`);
    } else if (actualRecordCount === expectedRecordCount) {
      console.log(`✅ [SYNC START] Record count matches: ${actualRecordCount} records (as expected)`);
    } else {
      console.log(`⚠️ [SYNC START] Record count decreased: Status showed ${expectedRecordCount}, device sending ${actualRecordCount} (-${expectedRecordCount - actualRecordCount})`);
      console.log(`   This may indicate records were cleared or device state changed`);
    }
    
    const syncState = this.dataSyncStates?.get(deviceId);
    if (syncState) {
      syncState.totalRecords = parsedTransfer.totalRecords;
      syncState.recordsReceived = 0;
      syncState.lastActivity = Date.now();
    } else {
      // Create sync state if it doesn't exist
      if (!this.dataSyncStates) {
        this.dataSyncStates = new Map();
      }
      this.dataSyncStates.set(deviceId, {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: parsedTransfer.totalRecords,
        lastActivity: Date.now()
      });
    }
    
    // Emit sync start event for UI
    this.emit('dataSyncStart', {
      deviceId,
      totalRecords: parsedTransfer.totalRecords
    });
  }

  // Handle sync complete (SDD: 0x02 - Data Sync Complete)
  async handleSyncComplete(deviceId, parsedTransfer) {
    const syncState = this.dataSyncStates?.get(deviceId);
    const previousState = syncState?.state || 'unknown';
    
    // ✅ CRITICAL FIX: Prevent duplicate sync completion handling
    // Track if we've already processed this sync completion to prevent duplicate log entries
    if (!this.lastSyncCompleteTime) {
      this.lastSyncCompleteTime = new Map();
    }
    
    const lastCompleteTime = this.lastSyncCompleteTime.get(deviceId) || 0;
    const timeSinceLastComplete = Date.now() - lastCompleteTime;
    const recordsTransmitted = parsedTransfer.recordsTransmitted || 0;
    
    // ✅ If sync completion was processed very recently (within 1 second) with same record count, skip duplicate processing
    // This prevents duplicate log entries when the same sync_complete event is processed multiple times
    if (timeSinceLastComplete < 1000 && recordsTransmitted > 0) {
      console.log(`⏭️ [SYNC COMPLETE] Skipping duplicate sync completion - already processed ${timeSinceLastComplete}ms ago (${recordsTransmitted} records)`);
      return;
    }
    
    // Mark this sync completion as processed
    this.lastSyncCompleteTime.set(deviceId, Date.now());
    
    if (parsedTransfer.success) {
      
      // ✅ IMPROVEMENT 2: Log state transition
      this.logStateTransition(deviceId, previousState, 'complete', 'sync successful');
      
      // ✅ UPDATE UI WITH LATEST SYNCED DATA
      // This ensures UI shows the most recent data from flash, not stale Device Status notifications
      const updated = this.updateDeviceDataFromSyncedRecords(deviceId);
      
      if (updated) {
        const latestRecord = this.getLatestSyncedRecord(deviceId);
        const device = this.scannedDevices.get(deviceId);
        
        // Add sync log entry - use recordsTransmitted (delta) instead of total count
        let finalRecordsTransmitted = recordsTransmitted;
        
        // Fallback: calculate delta from baseline if recordsTransmitted is not available
        if (finalRecordsTransmitted === 0 && device) {
          const recordsBeforeSync = device.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
          const recordsAfterSync = device?.syncRecords?.length || 0;
          finalRecordsTransmitted = Math.max(0, recordsAfterSync - recordsBeforeSync);
        }
        
        // ✅ CRITICAL FIX: Only log if recordsTransmitted > 0 to avoid logging "0 Records Synced"
        if (finalRecordsTransmitted > 0) {
          this.addConnectionLog(deviceId, `${finalRecordsTransmitted} Record${finalRecordsTransmitted === 1 ? '' : 's'} Synced`);
        }
        
        // Emit event for UI refresh with synced data
        const recordCount = device?.syncRecords?.length || 0;
        this.emit('syncDataUpdated', {
          deviceId,
          latestRecord,
          totalRecords: recordCount,
          deviceData: device?.deviceData
        });
      }
      
      // ✅ FIX: Track sync completion time to prevent post-sync reads from triggering auto-sync
      if (!this.autoSyncMeta) {
        this.autoSyncMeta = new Map();
      }
      const meta = this.autoSyncMeta.get(deviceId) || {};
      const syncStartTime = meta.lastSyncStartTime || Date.now();
      const syncLatency = Date.now() - syncStartTime;
      meta.lastSyncCompletedAt = Date.now();
      this.autoSyncMeta.set(deviceId, meta);
      console.log(`✅ [SYNC COMPLETE] Tracked sync completion time for ${deviceId} - will prevent auto-sync for 5 seconds`);
      
      // ✅ IMPROVEMENT 7: Record success metrics
      this.recordSyncSuccess(deviceId, syncLatency);
      
      // ✅ IMPROVEMENT 6: Emit success feedback
      this.emitUserFeedback(deviceId, 'sync_completed', {
        recordsTransmitted: parsedTransfer.recordsTransmitted || 0,
        latency: syncLatency
      });
      
      // NOTE: Native iOS now automatically sends DATA_SYNC_STOP (0x09) with Clear Flash flag
      // No need to send it from JS - this prevents duplicate commands
      // The native implementation waits 1 second after sync complete, then sends cleanup command
      
    } else {
      // ✅ IMPROVEMENT 2: Log state transition to failed
      this.logStateTransition(deviceId, previousState, 'failed', 'sync failed');
      
      // ✅ IMPROVEMENT 7: Record failure metrics
      this.recordSyncFailure(deviceId, parsedTransfer.reason || 'sync_failed');
      
      // ✅ IMPROVEMENT 6: Emit failure feedback
      this.emitUserFeedback(deviceId, 'sync_failed', {
        reason: parsedTransfer.reason || 'sync_failed'
      });
      
      // Native will send DATA_SYNC_STOP without clearing flash
      // No action needed from JS side
    }
    
    // ✅ CRITICAL FIX: Only clean up sync state if sync actually completed
    // Don't delete state immediately - wait a bit to prevent duplicate sync starts
    // State will be cleaned up when new sync starts or after a delay
    if (this.dataSyncStates && parsedTransfer.success) {
      // Mark sync as complete but don't delete immediately
      // This prevents rapid re-syncs from ServiceDiscoveryComplete events
      const syncState = this.dataSyncStates.get(deviceId);
      if (syncState) {
        syncState.state = 'complete';
        syncState.isActive = false;
      }
      
      // Clean up after a delay to prevent immediate duplicate syncs
      setTimeout(() => {
        if (this.dataSyncStates) {
          const currentState = this.dataSyncStates.get(deviceId);
          // Only delete if state is still 'complete' (not changed by new sync)
          if (currentState && currentState.state === 'complete') {
            this.dataSyncStates.delete(deviceId);
          }
        }
      }, 3000); // Wait 3 seconds before allowing new sync
    }
    
    // Clean up auto-sync timer if exists
    if (this.autoSyncTimers?.has(deviceId)) {
      clearTimeout(this.autoSyncTimers.get(deviceId));
      this.autoSyncTimers.delete(deviceId);
    }
    
    // ✅ IMPROVEMENT 5: Process next item in sync queue
    this.processingSync.set(deviceId, false);
    setTimeout(() => this.processSyncQueue(deviceId), 1000);
  }

  // Handle data record (SDD: 0x03 - Record Data)
  handleDataRecord(deviceId, parsedTransfer) {
    const syncState = this.dataSyncStates?.get(deviceId);
    if (syncState) {
      // Update with actual number of records received in this packet
      const recordsInPacket = parsedTransfer.recordCount || 0;
      syncState.recordsReceived += recordsInPacket;
      syncState.lastActivity = Date.now();
    }

    // Store or process the received records
    if (parsedTransfer.records && parsedTransfer.records.length > 0) {
      
      // Store records to device data and emit event for UI updates
      const device = this.getDevice(deviceId);
      if (device) {
        if (!device.syncRecords) {
          device.syncRecords = [];
        }
        
        // Add new records to device data
        let validCount = 0;
        let invalidCount = 0;
        
        parsedTransfer.records.forEach((record, index) => {
          // ✅ FIX: Filter out invalid zero/padding records (same as line 6222)
          const isValidRecord = (
            record.steps > 0 ||  // Has meaningful steps
            record.temperature > 0 ||  // Has meaningful temperature
            (record.timestamp && record.timestamp > 1577836800)  // Has valid timestamp (after 2020)
          );
          
          if (!isValidRecord) {
            invalidCount++;
            return;  // Skip padding records
          }
          
          // ✅ FIX: Check for duplicate records by timestamp (and steps/temperature for robustness)
          // This prevents the same record from being added multiple times
          const recordTimestamp = record.timestamp || (record.timestampDate ? Math.floor(new Date(record.timestampDate).getTime() / 1000) : null);
          if (recordTimestamp) {
            const existingRecordIndex = device.syncRecords.findIndex(r => {
              const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
              // Match by timestamp, and optionally by steps/temperature to catch exact duplicates
              return existingTimestamp === recordTimestamp && 
                     r.steps === record.steps && 
                     r.temperature === record.temperature;
            });
            
            if (existingRecordIndex >= 0) {
              console.log(`🔄 [RECORD] Duplicate detected in handleDataRecord - skipping: Steps=${record.steps}, Temp=${record.temperature}°C, Time=${recordTimestamp}`);
              invalidCount++;
              return;  // Skip duplicate record
            }
          }
          
          validCount++;
          // Add to device records
          const newRecord = {
            ...record,
            receivedAt: new Date(),
            deviceId
          };
          device.syncRecords.push(newRecord);
          
          // ✅ Save to Redux for historical records
          try {
            store.dispatch(addRecord({ deviceId, record: newRecord }));
          } catch (error) {
            console.warn('Failed to save record to Redux:', error);
          }
        });
        
        if (invalidCount > 0) {
          console.log(`🗑️ [FILTER] Removed ${invalidCount} padding records, kept ${validCount} valid records`);
        }
        
        // ✅ Update recordCount incrementally as records are added (like steps)
        if (validCount > 0) {
          if (!device.deviceData) {
            device.deviceData = {};
          }
          device.deviceData.recordCount = device.syncRecords.length;
          
          // ✅ FIX: Don't log sync progress incrementally - only log when sync completes
          // This prevents duplicate log entries (e.g., "2 Records Synced" then "3 Records Synced")
          // The sync complete handler will log the final count once
          
          // Trigger UI update
          if (this.onDeviceDataUpdated && this.appState === 'active') {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          }
          
          // Trigger device list update for UI refresh
          if (this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }
        }
        
        // Emit data update event for UI
        this.emit('deviceDataUpdate', {
          deviceId,
          type: 'sync_records',
          records: parsedTransfer.records,
          totalRecords: device.syncRecords.length
        });
      }
    }
  }

  // Handle read error (SDD: 0x04 - Data Read Error)
  handleReadError(deviceId, parsedTransfer) {
    
    // Stop sync on read error
    setTimeout(async () => {
      try {
        await this.stopDataSync(deviceId, false); // clearFlash = false
      } catch (error) {
      }
    }, 1000);
  }

  // Update data sync state
  updateDataSyncState(deviceId, parsedTransfer) {
    if (!this.dataSyncStates) {
      this.dataSyncStates = new Map();
    }
    
    let syncState = this.dataSyncStates.get(deviceId);
    if (!syncState) {
      syncState = {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: null,
        lastActivity: Date.now()
      };
      this.dataSyncStates.set(deviceId, syncState);
    }
    
    syncState.lastActivity = Date.now();
  }

  // Handle system command responses
  handleSystemCommandResponse(deviceId, data) {
    try {
      
      const response = BLEDataParser.parseSystemCommandResponse(data);
      const commandName = this.getCommandName(response?.command);

      if (response && response.sddCompliant) {
        // ✅ Normalize response structure: parser returns "data" but code expects "parsedData"
        const normalizedResponse = {
          ...response,
          parsedData: response.data || response.parsedData
        };
        
        // Store response for commands that need to return data
        const responseKey = `${deviceId}_${normalizedResponse.command}`;
        if (!this.systemCommandResponses) {
          this.systemCommandResponses = new Map();
        }
        
        // ✅ Don't overwrite if response already exists (from handleNativeSystemCommandResponse)
        // This prevents losing the correctly parsed version data
        const existingResponse = this.systemCommandResponses.get(responseKey);
        if (existingResponse) {
          // Keep existing response if it has valid data (version, diagnostics, etc.)
          const existingParsedData = existingResponse.parsedData || existingResponse.data;
          const hasValidData = existingParsedData && (
            (existingParsedData.version && existingParsedData.version !== 'Unknown') ||
            existingParsedData.diagnostics ||
            existingParsedData.timestamp ||
            existingParsedData.intervalMs !== undefined
          );
          
          if (hasValidData) {
            console.log(`💾 [SYSTEM COMMAND RESPONSE] Keeping existing response with valid data:`, existingParsedData);
            return; // Keep the existing response
          }
        }
        
        this.systemCommandResponses.set(responseKey, normalizedResponse);
        
        const version = normalizedResponse.parsedData?.version || normalizedResponse.data?.version || 'N/A';
        console.log(`💾 [SYSTEM COMMAND RESPONSE] Stored response for key: ${responseKey}, command: ${normalizedResponse.command}, version: ${version}`);
        console.log(`💾 [SYSTEM COMMAND RESPONSE] All stored keys:`, Array.from(this.systemCommandResponses.keys()));

        // Emit event for response listeners
        this.emit('systemCommandResponse', {
          deviceId,
          command: response.command,
          response: response
        });

        if (response.success) {

          // Handle specific command responses
          switch (response.command) {
            case SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME:
              // ✅ FIX: Track time sync response and schedule RTC validation
              console.log(`✅ [TIME SYNC] Time sync command successful for ${deviceId}`);
              if (!this.timeSyncSentTimes) {
                this.timeSyncSentTimes = new Map();
              }
              this.timeSyncSentTimes.set(deviceId, Date.now());
              
              // ✅ FIX: Don't check RTC immediately - wait for next device status notification
              // The device needs to send a NEW device status notification with updated RTC
              // The current device.deviceData.lastUpdate is from BEFORE time sync
              console.log(`⏰ [AUTO TIME SYNC] Time sync successful - waiting for next device status notification to verify RTC`);
              console.log(`   Will check RTC validity when next device status notification arrives (after 5s delay)`);
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL:
              // ✅ CORRECT: Native code handles polling interval update automatically
              // When this response is received, native code will:
              //   1. Parse the interval from the response
              //   2. Stop existing polling timer
              //   3. Restart polling with new interval (min 30s cap)
              // JavaScript should NOT interfere with native polling
              console.log(`✅ [DATA INTERVAL] Data acquisition interval set successfully for ${deviceId}`);
              console.log(`🔄 [POLLING] Native code will update polling interval automatically`);
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP:
              break;
          case SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET:
            // ✅ After factory reset, ensure device is removed from native bonded list to prevent auto-reconnect
            (async () => {
              try {
                console.log(`🧹 [FACTORY RESET] Removing ${deviceId} from bonded list to prevent auto-connect`);
                await this.removeDeviceFromBondedList(deviceId);
                console.log(`✅ [FACTORY RESET] Device ${deviceId} removed from bonded list`);
              } catch (error) {
                console.error(`❌ [FACTORY RESET] Failed to remove ${deviceId} from bonded list:`, error);
              }
            })();
            break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART:
              // ✅ AUTO TIME SYNC: After system restart, device RTC may be reset
              // Track restart time so handleDeviceStatusUpdate can trigger sync
              if (!this.deviceRestartTimes) {
                this.deviceRestartTimes = new Map();
              }
              this.deviceRestartTimes.set(deviceId, Date.now());
              console.log(`🔄 [SYSTEM RESTART] Device restarted, tracking restart time for auto time sync`);
              
              // Also schedule a direct time sync after delay (backup in case status notifications don't come)
              setTimeout(async () => {
                try {
                  // Check if RTC is still invalid before syncing
                  const device = this.scannedDevices.get(deviceId);
                  const deviceData = device?.deviceData;
                  const rtcStillInvalid = !deviceData?.rtcValid || 
                    (deviceData?.lastUpdate && deviceData.lastUpdate < new Date('2020-01-01'));
                  
                  if (rtcStillInvalid) {
                    console.log(`⏰ [AUTO TIME SYNC] Device restarted, RTC still invalid, syncing time...`);
                    await this.syncDeviceTime(deviceId);
                  } else {
                    console.log(`✅ [AUTO TIME SYNC] Device restarted, RTC already valid, skipping sync`);
                  }
                } catch (error) {
                  console.error(`❌ [AUTO TIME SYNC] Failed after restart:`, error);
                }
              }, 5000);
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER:
              break;
            default:
          }
        } else {
        }
      } else {
      }

    } catch (error) {
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
          // iOS uses native bridge characteristic reading with timeout
          const readPromise = BridgingCodeModule.readCharacteristic(deviceId, characteristicUUID);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Characteristic read timeout after 5 seconds')), 5000)
          );
          
          const result = await Promise.race([readPromise, timeoutPromise]);
          return result.data;
        }
      }));
    } catch (error) {
      // ✅ FIX: Handle read failures gracefully - don't throw errors for optional characteristics
      // This prevents MODEL_NUMBER and other optional characteristic read failures from breaking sync operations
      if (error.message && (
        error.message.includes('not found') ||
        error.message.includes('timeout') ||
        error.message.includes('Failed to initiate read') ||
        error.message.includes('READ_FAILED') ||
        error.message.includes('READ_NOT_SUPPORTED') ||
        error.code === 'READ_FAILED' ||
        error.code === 'READ_NOT_SUPPORTED'
      )) {
        // Return null for read failures - these are non-fatal for optional characteristics
        return null;
      }
      // Only throw for unexpected errors
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
          
          
          await SampleBridgeAndroid.writeCharacteristic(
            deviceId, 
            characteristicUUID, 
            hexData
          );
          return true;
        } else {
          // iOS uses native bridge characteristic writing
          // Ensure data is properly formatted as Uint8Array
          let dataToSend;
          if (data instanceof Uint8Array) {
            dataToSend = data;
          } else if (Array.isArray(data)) {
            dataToSend = new Uint8Array(data);
          } else {
            dataToSend = new Uint8Array(data);
          }

          // Convert to hex string for iOS native bridge
          const hexData = Array.from(dataToSend)
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');
          

          // iOS uses native bridge characteristic writing with timeout
          const writePromise = BridgingCodeModule.writeCharacteristic(deviceId, characteristicUUID, hexData);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Characteristic write timeout after 5 seconds')), 5000)
          );
          
          await Promise.race([writePromise, timeoutPromise]);
          return true;
        }
      }));
    } catch (error) {
      if (error.message && error.message.includes('timeout')) {
        throw new Error(`Write timeout for characteristic ${characteristicUUID}`);
      }
      throw error;
    }
  }

  /**
   * Sync device time with current system time
   * @param {string} deviceId - Device ID
   * @returns {Promise<Object>} Sync result
   */
  async syncDeviceTime(deviceId) {
    try {
      
      // Get current Unix timestamp (seconds)
      const currentTime = Math.floor(Date.now() / 1000);
      
      // Send SET_SYSTEM_TIME command (0x01) with 4-byte timestamp
      const timestampBytes = [
        currentTime & 0xFF,           // LSB
        (currentTime >> 8) & 0xFF,
        (currentTime >> 16) & 0xFF,
        (currentTime >> 24) & 0xFF    // MSB
      ];
      
      
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes);
      
      if (result.success) {
        
        // Wait a moment for the device to process the time sync
        await new Promise(resolve => setTimeout(resolve, 5000)); // Increased wait time
        
        // Try to trigger a device status update to verify the time was set
        try {
          const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
          
          if (deviceStatusData) {
            const parsedData = BLEDataParser.parseDeviceStatus(deviceStatusData);
            
            if (parsedData && parsedData.timestamp) {
              const deviceTime = Math.floor(parsedData.timestamp.getTime() / 1000);
              const systemTime = Math.floor(Date.now() / 1000);
              const timeDiff = Math.abs(deviceTime - systemTime);
              
              
              if (timeDiff < 60) { // Within 1 minute
              } else {
              }
            }
          }
        } catch (error) {
        }
      } else {
      }
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Manual time sync - can be called from UI
   * @param {string} deviceId - Device ID
   * @param {number} delayMs - Delay before sending command (default: 0)
   * @returns {Promise<Object>} Sync result
   */
  async manualTimeSync(deviceId, delayMs = 0) {
    
    if (delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    
    return await this.syncDeviceTime(deviceId);
  }

  // Check if device is bonded/paired securely
  async checkBondingStatus(deviceId) {
    try {
      
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        // Use Android native bridge to check bonding status
        const isBonded = await SampleBridgeAndroid.isDeviceBonded(deviceId);
        return isBonded;
      } else if (Platform.OS === 'ios') {
        // iOS bonding check would go here
        return false;
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  // Initiate secure pairing with device
  async initiateSecurePairing(deviceId) {
    try {
      
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        // Use Android native bridge to initiate secure pairing
        const pairingResult = await SampleBridgeAndroid.initiateSecurePairing(deviceId);
        return { success: pairingResult, error: null };
      } else if (Platform.OS === 'ios') {
        // iOS secure pairing would go here
        return { success: false, error: 'iOS secure pairing not implemented' };
      }
      
      return { success: false, error: 'Platform not supported' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ✅ REMOVED: Duplicate complex startDataSync() and stopDataSync()
  // Native code now handles data sync automatically via startCommandSequence
  // Simple wrapper methods available below at line ~4458

  // ✅ REMOVED: setupDataTransferMonitoring() and cleanupDataTransferMonitoring()
  // Native code handles notification setup automatically during service discovery

  // Get sync records from device
  getSyncRecords(deviceId) {
    const device = this.getDevice(deviceId);
    if (device && device.syncRecords) {
      return device.syncRecords;
    }
    return [];
  }

  // ✅ NEW: Get LATEST synced record (most recent timestamp)
  getLatestSyncedRecord(deviceId) {
    const records = this.getSyncRecords(deviceId);
    if (!records || records.length === 0) {
      return null;
    }
    
    // Find record with most recent timestamp
    const latestRecord = records.reduce((latest, current) => {
      if (!latest) return current;
      
      // Compare timestamps (both should be Date objects or Unix seconds)
      const latestTime = latest.timestamp instanceof Date ? latest.timestamp.getTime() : latest.timestamp * 1000;
      const currentTime = current.timestamp instanceof Date ? current.timestamp.getTime() : current.timestamp * 1000;
      
      return currentTime > latestTime ? current : latest;
    }, null);
    
    return latestRecord;
  }

  // ✅ NEW: Update device's live data with latest synced record
  updateDeviceDataFromSyncedRecords(deviceId) {
    console.log(`💾 [SYNC COMPLETE] Updating UI for ${deviceId} with latest synced data`);
    
    const latestRecord = this.getLatestSyncedRecord(deviceId);
    if (!latestRecord) {
      console.log(`⚠️ [SYNC COMPLETE] No latest record found for ${deviceId}`);
      return false;
    }
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.log(`⚠️ [SYNC COMPLETE] Device not found: ${deviceId}`);
      return false;
    }
    
    // ✅ NEW: Calculate total steps from all synced records
    const totalSteps = (device.syncRecords || []).reduce((sum, record) => {
      return sum + (record.steps || 0);
    }, 0);
    
    const recordCount = device.syncRecords?.length || 0;
    
    // ✅ FIX: Find the latest record with valid temperature (not null/undefined)
    // Sometimes the latest record by timestamp has temperature: 0 (padding), so find most recent with valid temp
    // Note: temperature 0°C is valid (freezing), but we check if it's from a valid record with steps > 0
    const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r => 
      r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
    ) || latestRecord;
    
    // ✅ FIX: Find the latest record with valid steps (not null/undefined)
    const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r => 
      r.steps != null && r.steps !== undefined && r.steps > 0
    ) || latestRecord;
    
    console.log(`📊 [SYNC COMPLETE] Latest record:`, {
      timestamp: latestRecord.timestamp,
      timestampDate: latestRecord.timestampDate,
      steps: latestRecord.steps,
      temperature: latestRecord.temperature
    });
    
    console.log(`📊 [SYNC COMPLETE] Total from ${recordCount} records: ${totalSteps} steps`);
    
    // Update device data with latest synced values
    if (!device.deviceData) {
      device.deviceData = {};
    }
    
    // ✅ CRITICAL FIX: Ensure timestamp is ALWAYS a proper Date object
    // latestRecord.timestamp is Unix SECONDS
    // latestRecord.timestampDate is already a Date object (if available)
    let syncedDate;
    if (latestRecord.timestampDate && latestRecord.timestampDate instanceof Date) {
      syncedDate = latestRecord.timestampDate;
    } else if (typeof latestRecord.timestamp === 'number') {
      // Convert Unix seconds to milliseconds
      syncedDate = new Date(latestRecord.timestamp * 1000);
    } else {
      syncedDate = new Date(); // Fallback to now
    }
    
    console.log(`📅 [SYNC COMPLETE] Synced date: ${syncedDate.toISOString()}`);
    
    // ✅ FIX: Use !== null check instead of || to handle temperature: 0 correctly
    // Use latest record with valid temperature/steps if available
    // If latest record has temp: 0 but it's from a valid record (has steps), use it
    const finalTemperature = latestRecordWithTemp.temperature != null && latestRecordWithTemp.temperature !== undefined
      ? latestRecordWithTemp.temperature 
      : (device.deviceData.temperature != null ? device.deviceData.temperature : null);
    
    const finalSteps = latestRecordWithSteps.steps != null && latestRecordWithSteps.steps !== undefined
      ? latestRecordWithSteps.steps 
      : (device.deviceData.steps != null ? device.deviceData.steps : null);
    
    // ✅ CRITICAL FIX: After sync, recordCount should reflect remaining records on device
    // After a successful sync, all records are cleared from the device, so recordCount should be 0.
    // The Device Status notification will arrive shortly after sync completes and confirm this value.
    // We explicitly set it to 0 here (instead of relying on device.deviceData?.recordCount which might be stale)
    // to ensure the UI updates immediately without waiting for the next Device Status notification.
    const finalRecordCount = 0; // After successful sync, all records are cleared from device
    
    // Use synced data to update current device state
    device.deviceData = {
      ...device.deviceData,
      temperature: finalTemperature,
      steps: finalSteps,
      totalSteps: totalSteps, // ✅ NEW: Total steps from all historical records
      recordCount: finalRecordCount, // ✅ FIX: Set to 0 after successful sync (all records cleared)
      // ✅ ONLY store Date object, remove raw timestamp to avoid confusion
      lastUpdate: syncedDate,
      // Mark that this data came from sync, not live notifications
      dataSource: 'synced',
      syncedAt: new Date()
    };
    
    // ✅ CRITICAL FIX: Also update manufacturerData.recordCount for UI consistency
    if (device.manufacturerData) {
      device.manufacturerData.recordCount = finalRecordCount;
      device.manufacturerData.hasRecords = finalRecordCount > 0;
    }
    
    console.log(`💾 [SYNC COMPLETE] Updated device data:`, {
      temperature: device.deviceData.temperature,
      steps: device.deviceData.steps,
      totalSteps: device.deviceData.totalSteps,
      recordCount: device.deviceData.recordCount,
      lastUpdate: device.deviceData.lastUpdate
    });
    
    this.scannedDevices.set(deviceId, device);
    
    // Trigger UI update
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    }
    
    // ✅ CRITICAL: Also trigger device list update for UI refresh
    // Force immediate UI update with fresh data after sync completes
    if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
      // Use setTimeout to ensure state updates are processed first
      setTimeout(() => {
        try {
        this.onDeviceListUpdated();
        } catch (error) {
          console.warn('Error calling onDeviceListUpdated callback:', error);
        }
      }, 100);
    }
    
    // ✅ CRITICAL: Emit deviceDataUpdate event for immediate UI refresh
    this.emit('deviceDataUpdate', {
      deviceId,
      type: 'sync_complete',
      deviceData: device.deviceData,
      recordCount: device.deviceData.recordCount
    });
    
    return true;
  }

  // Clear sync records from device (used by Live Data screen)
  // ⚠️ NOTE: This clears BLEService sync records only, NOT Redux historical records
  // - Live Data screen: calls this with clearHistorical=false (default) to clear current session only
  // - Historical Data screen: clears Redux directly, does NOT call this method
  clearSyncRecords(deviceId, clearHistorical = false) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.syncRecords = [];
    }
    
    // ✅ Only clear from Redux if explicitly requested (legacy support, not used by Historical Data screen)
    if (clearHistorical) {
      try {
        const { clearDeviceRecords } = require('../../feature/historicalRecordsSlice/historicalRecordsSlice');
        store.dispatch(clearDeviceRecords({ deviceId }));
      } catch (error) {
        console.warn('Failed to clear records from Redux:', error);
      }
    }
  }

  // Get sync status for device
  getSyncStatus(deviceId) {
    const syncState = this.dataSyncStates?.get(deviceId);
    const device = this.getDevice(deviceId);
    const latestRecord = this.getLatestSyncedRecord(deviceId);
    
    return {
      isActive: syncState?.isActive || false,
      recordsReceived: syncState?.recordsReceived || 0,
      totalRecords: syncState?.totalRecords || null,
      startTime: syncState?.startTime || null,
      lastActivity: syncState?.lastActivity || null,
      notificationsEnabled: syncState?.notificationsEnabled || false,
      storedRecords: device?.syncRecords?.length || 0,
      latestRecordTimestamp: latestRecord?.timestamp || null,
      latestRecordDate: latestRecord?.timestampDate || null
    };
  }

  // ✅ Connection Log Management Methods
  // Add a connection log entry for a device
  addConnectionLog(deviceId, action, additionalInfo = {}) {
    const device = this.getDevice(deviceId);
    if (!device) {
      console.warn(`[ConnectionLog] Device not found: ${deviceId}`);
      return;
    }

    // Initialize connectionLogs array if it doesn't exist
    if (!device.connectionLogs) {
      device.connectionLogs = [];
    }

    const logEntry = {
      action,
      timestamp: new Date(),
      ...additionalInfo
    };

    device.connectionLogs.push(logEntry);

    // Emit event for UI updates
    this.emit('connectionLogUpdated', {
      deviceId,
      log: logEntry,
      totalLogs: device.connectionLogs.length
    });

    console.log(`📋 [ConnectionLog] Added log for ${deviceId}: ${action}`);
  }

  // Get connection logs for a device
  getConnectionLogs(deviceId) {
    const device = this.getDevice(deviceId);
    if (device && device.connectionLogs) {
      return device.connectionLogs;
    }
    return [];
  }

  // Clear connection logs for a device
  clearConnectionLogs(deviceId) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.connectionLogs = [];
      // Emit event for UI updates
      this.emit('connectionLogUpdated', {
        deviceId,
        log: null,
        totalLogs: 0
      });
      console.log(`📋 [ConnectionLog] Cleared logs for ${deviceId}`);
    }
  }

  // ✅ REMOVED: Legacy manual sync methods - native code handles everything automatically
  // Removed: triggerManualDataSync(), forceProperDataSync(), 
  //          setupDataTransferMonitoring(), cleanupDataTransferMonitoring()
  // Reason: Native code (iOS/Android) handles all data sync and notifications automatically
  
  // Verify data clearing and fresh data collection
  async verifyDataClearingAndFreshData(deviceId) {
    try {
      
      const verificationResults = {
        dataCleared: false,
        freshDataDetected: false,
        notificationsActive: false,
        dataSyncStatus: null,
        lastDataTimestamp: null,
        verificationTime: Date.now()
      };

      // 1. Check if data sync is active and get sync status
      const syncState = this.dataSyncStates?.get(deviceId);
      if (syncState) {
        verificationResults.dataSyncStatus = {
          isActive: syncState.isActive,
          recordsReceived: syncState.recordsReceived,
          totalRecords: syncState.totalRecords,
          duration: Date.now() - syncState.startTime
        };
      }

      // 2. Read current device status to check for fresh data
      try {
        const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        
        if (deviceStatusData) {
          // Parse the device status to get timestamp
          const parsedData = BLEDataParser.parseDeviceStatus(deviceStatusData);
          if (parsedData && parsedData.timestamp) {
            verificationResults.lastDataTimestamp = parsedData.timestamp;
            const timeDiff = Date.now() - (parsedData.timestamp.unix * 1000);
            
            // Consider data "fresh" if it's within the last 2 minutes (after clearing)
            verificationResults.freshDataDetected = timeDiff < 120000; // 2 minutes
            verificationResults.dataCleared = timeDiff < 300000; // 5 minutes
          }
        }
      } catch (error) {
      }

      // 3. Check if notifications are active by reading battery level (which should trigger notifications)
      try {
        const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
        
        if (batteryData) {
          // If we can read battery data, notifications are likely working
          verificationResults.notificationsActive = true;
        }
      } catch (error) {
      }

      // 4. Check monitoring subscriptions
      const monitoringSub = this.monitoringSubscriptions.get(deviceId);
      if (monitoringSub) {
        verificationResults.notificationsActive = verificationResults.notificationsActive || (monitoringSub.characteristics?.length > 0);
      }

      // 5. Log verification results

      return verificationResults;
    } catch (error) {
      return {
        dataCleared: false,
        freshDataDetected: false,
        notificationsActive: false,
        error: error.message,
        verificationTime: Date.now()
      };
    }
  }

  // Helper function to get command name for logging
  getCommandName(command) {
    const commandNames = {
      0x01: 'Set System Time',
      0x02: 'Set Advertising Interval', 
      0x03: 'Set Connection Interval',
      0x04: 'Set Data Interval',
      0x05: 'Get Firmware Version',
      0x06: 'Get Hardware Version',
      0x07: 'Get Diagnostics',
      0x08: 'Data Sync Start',
      0x09: 'Data Sync Stop',
      0x10: 'System Restart',
      0x11: 'Toggle Buzzer'
    };
    return commandNames[command] || `Unknown Command (0x${command.toString(16)})`;
  }

  // Send system command (SDD compliant format)  
  async sendSystemCommand(deviceId, command, payload = [], options = {}) {
    // Declare variables outside try block to avoid scope issues
    let payloadToSend = [];
    let smartTagService = null;
    let sysCmdChar = null;
    
    const commandName = this.getCommandName(command);
    const startTime = Date.now();
    
    try {

      // Ensure device is connected
      const device = this.connectedDevices.get(deviceId);
      
      if (!device) {
        return { success: false, error: 'Device not connected' };
      }


      if (Platform.OS === 'android') {
        // For Android, check the device's services and characteristics arrays
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (!scannedDevice || !scannedDevice.services || !scannedDevice.characteristics) {
          return { success: false, error: 'Device services/characteristics not available' };
        }

        
        // Find SMART_TAG service - prioritize the correct service UUID first
        smartTagService = scannedDevice.services.find(s => {
          const serviceUuid = s.uuid.toLowerCase().replace(/-/g, '');
          return serviceUuid === BLE_SERVICES.SMART_TAG.toLowerCase().replace(/-/g, '') ||
                 serviceUuid === BLE_SERVICES.SMART_TAG_ALT.toLowerCase().replace(/-/g, '');
          // Removed CUSTOM_SERVICE from priority list as it's causing incorrect service selection
        });
        
        
        // If SMART_TAG service not found, try to find any service that contains the SYSTEM_COMMAND characteristic
        if (!smartTagService) {
          
          // Look for SYSTEM_COMMAND characteristic in any service
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
            // Find the service that contains this characteristic
            smartTagService = scannedDevice.services.find(s => 
              s.uuid.toLowerCase().replace(/-/g, '') === sysCmdChar.serviceUUID.toLowerCase().replace(/-/g, '')
            );
          }
        } else {
          
          // Find all characteristics in the SMART_TAG service using normalized UUID comparison
          let smartTagCharacteristics = scannedDevice.characteristics.filter(c => 
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
          
          // Find SYSTEM_COMMAND characteristic - use case-insensitive UUID matching
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '') &&
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
          } else {
            // Debug: Check if the characteristic exists anywhere
            let allSystemCommandChars = scannedDevice.characteristics.filter(c => 
              c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
            );
          }
        }
        
        if (!smartTagService || !sysCmdChar) {
          return { success: false, error: 'SYSTEM_COMMAND characteristic not available' };
        }
      } else {
        // iOS uses native bridge methods
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (!scannedDevice || !scannedDevice.services) {
          return { success: false, error: 'Device services not available' };
        }

        
        // Find SMART_TAG service - prioritize the correct service UUID first
        smartTagService = scannedDevice.services.find(s => {
          const serviceUuid = s.uuid.toLowerCase().replace(/-/g, '');
          return serviceUuid === BLE_SERVICES.SMART_TAG.toLowerCase().replace(/-/g, '') ||
                 serviceUuid === BLE_SERVICES.SMART_TAG_ALT.toLowerCase().replace(/-/g, '');
          // Removed CUSTOM_SERVICE from priority list as it's causing incorrect service selection
        });
        
        
        // If SMART_TAG service not found, try to find any service that contains the SYSTEM_COMMAND characteristic
        if (!smartTagService) {
          
          // Look for SYSTEM_COMMAND characteristic in any service
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
            // Find the service that contains this characteristic
            smartTagService = scannedDevice.services.find(s => 
              s.uuid.toLowerCase().replace(/-/g, '') === sysCmdChar.serviceUUID.toLowerCase().replace(/-/g, '')
            );
          }
        } else {
          
          // Find all characteristics in the SMART_TAG service using normalized UUID comparison
          let smartTagCharacteristics = scannedDevice.characteristics.filter(c => 
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
          
          // Find SYSTEM_COMMAND characteristic - use case-insensitive UUID matching
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '') &&
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
          } else {
            // Debug: Check if the characteristic exists anywhere
            let allSystemCommandChars = scannedDevice.characteristics.filter(c => 
              c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
            );
          }
        }
        
        if (!smartTagService || !sysCmdChar) {
          return { success: false, error: 'SYSTEM_COMMAND characteristic not available' };
        }
      }

      
      // Debug characteristic properties
      
      // If device doesn't support writes, skip system commands
      if (!sysCmdChar.isWritable && !sysCmdChar.isWritableWithResponse && !sysCmdChar.isWritableWithoutResponse) {
        return { success: false, error: 'System Command characteristic not writable' };
      }
      
      // Log write capability analysis
      
      // According to SDD: Enable notifications BEFORE sending system commands
      // Device needs to know where to send responses (Device Status or Data Transfer)
      try {
        // Safely check characteristics array (use device.characteristics which is properly populated)
        const device = this.scannedDevices.get(deviceId);
        if (device && device.characteristics && Array.isArray(device.characteristics)) {
          // Check if Device Status notifications are enabled
          const deviceStatusChar = device.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '')
          );
          if (deviceStatusChar && (deviceStatusChar.isNotifying || deviceStatusChar.isNotifiable)) {
          } else {
          }
          
          // Check if Data Transfer notifications are enabled  
          const dataTransferChar = device.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.DATA_TRANSFER.toLowerCase().replace(/-/g, '')
          );
          if (dataTransferChar && (dataTransferChar.isNotifying || dataTransferChar.isNotifiable)) {
          } else {
          }
        } else {
        }
        
      } catch (error) {
      }

      const packet = new Array(SYSTEM_COMMAND_CONSTANTS.PACKET_SIZE).fill(0);

      // According to SDD: Most commands have no payload unless specified
      // Only specific commands like SET_SYSTEM_TIME (0x01) need payload
      // For commands with no payload, don't add any bytes - just padding
      
      // Only add payload if explicitly provided
      payloadToSend = (Array.isArray(payload) ? payload : [])
        .slice(0); // shallow copy

      // Format according to SDD specification
      // Byte 0: Request ID (0xAA)
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.REQUEST_ID_OFFSET] = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;

      // Byte 1: Command ID
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_ID_OFFSET] = command;

      // Byte 2: Command Length
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_LENGTH_OFFSET] = payloadToSend.length;

      // Bytes 3-19: Command Data (up to 17 bytes) + padding
      for (let i = 0; i < payloadToSend.length && i < 17; i++) {
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET + i] = payloadToSend[i];
      }
      
      // Ensure packet is exactly 20 bytes with proper padding

      const packetHex = packet.map(b => b.toString(16).padStart(2, '0')).join('');

      // Convert packet array to Uint8Array for proper Buffer conversion
      const packetBytes = new Uint8Array(packet);

      // Use native system command methods for better reliability
      if (Platform.OS === 'android') {
        // ✅ FIX: Use native sendSystemCommand method (matching iOS behavior)
        // This uses the queue system to ensure sequential writes and handles retries
        const result = await SampleBridgeAndroid.sendSystemCommand(
          deviceId,
          command,
          payloadToSend
        );
        if (!result) {
          throw new Error('Failed to send system command');
        }
      } else {
        // Use iOS native system command method
        const result = await BridgingCodeModule.sendSystemCommand(
          deviceId,
          command,
          payloadToSend
        );
      }

      const duration = Date.now() - startTime;
      return { success: true, duration, commandName };

    } catch (error) {
      const duration = Date.now() - startTime;
      // Return error result instead of throwing
      return { success: false, error: error.message, duration, commandName };
    }
  }



  // Manually read all important characteristics
  async readAllCharacteristics(deviceId) {
    try {

    const characteristicsToRead = [
      { service: BLE_SERVICES.BATTERY, characteristic: BLE_CHARACTERISTICS.BATTERY_LEVEL, name: 'Battery Level', optional: true },
      { service: BLE_SERVICES.SMART_TAG, characteristic: BLE_CHARACTERISTICS.DEVICE_STATUS, name: 'Device Status', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MANUFACTURER_NAME, name: 'Manufacturer', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MODEL_NUMBER, name: 'Model Number', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.FIRMWARE_REVISION, name: 'Firmware', optional: true },
    ];

    // Debug: Check device characteristics
    const device = this.scannedDevices.get(deviceId);

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
                continue;
              }
            }
          } else {
            // iOS uses native bridge methods
            const device = this.scannedDevices.get(deviceId);
            if (device && device.characteristics) {
              const exists = device.characteristics.some(c => c.uuid.toLowerCase() === characteristic.toLowerCase());
              if (!exists) {
                continue;
              }
            }
          }
        }
        
        const value = await this.readCharacteristic(deviceId, service, characteristic);
        if (value !== null) {

          // Process the data based on characteristic type (case-insensitive)
          const normalizedChar = characteristic.toLowerCase().replace(/-/g, '');
          const normalizedBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.toLowerCase().replace(/-/g, '');
          const normalizedDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '');
          
          if (normalizedChar === normalizedBatteryLevel) {
            this.handleBatteryUpdate(deviceId, value);
          } else if (normalizedChar === normalizedDeviceStatus) {
            this.handleDeviceStatusUpdate(deviceId, value);
          }
        } else {
          // ✅ FIX: Silently handle read failures for optional characteristics
          // This prevents MODEL_NUMBER and other optional characteristic read failures from being logged as errors
        }
      } catch (error) {
        // ✅ FIX: Catch and ignore errors for optional characteristics to prevent them from breaking sync
        // Optional characteristics like MODEL_NUMBER, MANUFACTURER_NAME, etc. can fail to read
        // without affecting core functionality like data sync
        if (optional) {
          // Silently ignore errors for optional characteristics
          return;
        }
        // Re-throw for required characteristics (though none are currently marked as required)
        throw error;
      }
    }
    } catch (error) {
    }
  }

  // ✅ SIMPLIFIED: Request device to send current data (just reads characteristics)
  // Native side handles all command sequences, JS just reads data
  async requestDeviceData(deviceId, options = {}) {
    try {
      // 🔒 MUTEX: Check if already running
      if (this.requestDataMutex.get(deviceId)) {
        return;
      }

      // Set mutex lock
      this.requestDataMutex.set(deviceId, true);
      

      // Verify device is connected
      const device = this.scannedDevices.get(deviceId);
      if (!device || !this.isDeviceConnected(deviceId)) {
        throw new Error(`Device ${deviceId} not connected`);
      }
      
      // Wait for services to be discovered
      let waitTime = 0;
      while (waitTime < 5000) {
        if (device.services && device.services.length > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        waitTime += 100;
      }

      // ✅ CLEAN ARCHITECTURE: Just read characteristics, no command sequence
      // Native side handles all command sequencing via ServiceDiscoveryComplete event
      await this.readAllCharacteristics(deviceId);

    } catch (error) {
    } finally {
      // Release mutex
      this.requestDataMutex.delete(deviceId);
    }
  }

  // Test method to manually trigger system commands
  async testSystemCommands(deviceId) {
    try {
      // Reset the command sent flag to allow testing
      const commandKey = `commands_sent_${deviceId}`;
      this[commandKey] = false;
      await this.requestDeviceData(deviceId, { enableSystemCommands: true });
    } catch (error) {
    }
  }

  // Test method to manually test system command lookup
  async testSystemCommandLookup(deviceId) {
    try {
      const scannedDevice = this.scannedDevices.get(deviceId);
      if (!scannedDevice) {
        return;
      }

      
      // Look for SYSTEM_COMMAND characteristic in any service
      const sysCmdChar = scannedDevice.characteristics.find(c => 
        c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
      );
      
      if (sysCmdChar) {
        
        // Find the service that contains this characteristic
        const service = scannedDevice.services.find(s => 
          s.uuid.toLowerCase().replace(/-/g, '') === sysCmdChar.serviceUUID.toLowerCase().replace(/-/g, '')
        );
      } else {
      }
    } catch (error) {
    }
  }

  // Test method to manually trigger a single system command
  async testSingleSystemCommand(deviceId, commandId = 0x1) {
    try {
      const result = await this.sendSystemCommand(deviceId, commandId, []);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Test method to check device data availability
  testDeviceDataAvailability(deviceId) {
    
    const connectedDevice = this.connectedDevices.get(deviceId);
    const scannedDevice = this.scannedDevices.get(deviceId);
    
    
    if (scannedDevice) {
    }
    
    return {
      connected: !!connectedDevice,
      scanned: !!scannedDevice,
      servicesCount: scannedDevice?.services?.length || 0,
      characteristicsCount: scannedDevice?.characteristics?.length || 0
    };
  }

  // High-level system command methods for easier usage
  async getFirmwareVersion(deviceId) {
    try {
      // Clear any previous response
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
      
      console.log(`🔍 [GET_FW_VERSION] Looking for response with key: ${responseKey}`);
      console.log(`🔍 [GET_FW_VERSION] Current responses keys:`, Array.from(this.systemCommandResponses?.keys() || []));
      
      // ✅ SDD Table 10: GET_FW_VERSION - Length=1, Data=0x00
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION, [0x00]);
      
      if (!result.success) {
        return result;
      }
      
      // Wait for response (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try exact match first
        let response = this.systemCommandResponses?.get(responseKey);
        
        // If not found, try case-insensitive match (deviceId might have different casing)
        if (!response && this.systemCommandResponses) {
          for (const [key, value] of this.systemCommandResponses.entries()) {
            if (key.toLowerCase() === responseKey.toLowerCase()) {
              response = value;
              console.log(`✅ [GET_FW_VERSION] Found response with case-insensitive match: ${key}`);
              break;
            }
          }
        }
        
        if (response) {
          const version = response.parsedData?.version || 'Unknown';
          console.log(`✅ [GET_FW_VERSION] Found response! Version: ${version}`);
          return { success: true, data: version, parsedData: response.parsedData };
        }
        
        // Log progress every 10 iterations
        if (i > 0 && i % 10 === 0) {
          console.log(`⏳ [GET_FW_VERSION] Still waiting... (${i * 100}ms elapsed), available keys:`, Array.from(this.systemCommandResponses?.keys() || []));
        }
      }
      
      console.log(`❌ [GET_FW_VERSION] Timeout! Available keys:`, Array.from(this.systemCommandResponses?.keys() || []));
      return { success: false, error: 'Response timeout' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getHardwareVersion(deviceId) {
    try {
      // Clear any previous response
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
      
      // ✅ SDD Table 10: GET_HW_VERSION - Length=1, Data=0x00
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION, [0x00]);
      
      if (!result.success) {
        return result;
      }
      
      // Wait for response (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try exact match first, then case-insensitive
        let response = this.systemCommandResponses?.get(responseKey);
        if (!response && this.systemCommandResponses) {
          for (const [key, value] of this.systemCommandResponses.entries()) {
            if (key.toLowerCase() === responseKey.toLowerCase()) {
              response = value;
              break;
            }
          }
        }
        
        if (response) {
          const version = response.parsedData?.version || 'Unknown';
          return { success: true, data: version, parsedData: response.parsedData };
        }
      }
      
      return { success: false, error: 'Response timeout' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async getDiagnostics(deviceId) {
    try {
      // Clear any previous response
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS}`;
      this.systemCommandResponses?.delete(responseKey);
      
      // ✅ SDD Table 10: GET_DIAGNOSTICS - Length=1, Data=0x00
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS, [0x00]);
      
      if (!result.success) {
        return result;
      }
      
      // Wait for response (max 5 seconds)
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Try exact match first, then case-insensitive
        let response = this.systemCommandResponses?.get(responseKey);
        if (!response && this.systemCommandResponses) {
          for (const [key, value] of this.systemCommandResponses.entries()) {
            if (key.toLowerCase() === responseKey.toLowerCase()) {
              response = value;
              break;
            }
          }
        }
        
        if (response) {
          const diagnostics = response.parsedData?.diagnostics || 'N/A';
          return { success: true, data: diagnostics, parsedData: response.parsedData };
        }
      }
      
      return { success: false, error: 'Response timeout' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async setSystemTime(deviceId, timestamp) {
    try {
      const payload = [
        (timestamp >> 0) & 0xFF,
        (timestamp >> 8) & 0xFF,
        (timestamp >> 16) & 0xFF,
        (timestamp >> 24) & 0xFF
      ];
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async setAdvertisingInterval(deviceId, intervalMs) {
    try {
      const payload = [
        (intervalMs >> 0) & 0xFF,
        (intervalMs >> 8) & 0xFF,
        (intervalMs >> 16) & 0xFF,
        (intervalMs >> 24) & 0xFF
      ];
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async setConnectionInterval(deviceId, intervalMs) {
    try {
      const payload = [
        (intervalMs >> 0) & 0xFF,
        (intervalMs >> 8) & 0xFF,
        (intervalMs >> 16) & 0xFF,
        (intervalMs >> 24) & 0xFF
      ];
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Set Data Acquisition Interval (Command ID: 0x04)
   * 
   * ⚠️ CRITICAL: This command MUST ONLY be sent when the user explicitly clicks the 
   * "Set Data Interval" button. It should NEVER be sent automatically on connection,
   * after time sync, or in any other automatic flow.
   * 
   * This is the ONLY place in the codebase where SET_DATA_ACQUISITION_INTERVAL (0x04) 
   * should be sent. Any automatic sending of this command is prohibited.
   */
  async setDataAcquisitionInterval(deviceId, intervalSeconds) {
    try {
      // ✅ SDD v1.4: Data acquisition interval is now in MILLISECONDS (was seconds in v1.3)
      // Convert seconds to milliseconds
      const intervalMs = intervalSeconds * 1000;
      
      console.log(`📊 [DATA INTERVAL] Setting data acquisition interval: ${intervalSeconds}s (${intervalMs}ms)`);
      
      // Send as 32-bit unsigned integer (little-endian) in milliseconds
      const payload = [
        (intervalMs >> 0) & 0xFF,   // Byte 0: LSB
        (intervalMs >> 8) & 0xFF,   // Byte 1
        (intervalMs >> 16) & 0xFF,  // Byte 2
        (intervalMs >> 24) & 0xFF   // Byte 3: MSB
      ];
      
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async startDataSync(deviceId) {
    try {
      // ✅ FIX: Track record count before sync starts (to avoid sending duplicates)
      const device = this.scannedDevices.get(deviceId);
      if (device) {
        // Store the current record count as baseline for this sync
        device.syncRecordsBeforeSync = device.syncRecords ? device.syncRecords.length : 0;
        console.log(`📊 [SYNC START] Tracking baseline: ${device.syncRecordsBeforeSync} records before sync`);
      }
      
      // ✅ CRITICAL FIX: On Android, use native startDataSync method which handles characteristic writability checks
      // The native method properly checks characteristic properties and handles write types
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        try {
          const result = await SampleBridgeAndroid.startDataSync(deviceId);
          
          // ✅ CHECK FOR DUPLICATE SYNC: If native rejected due to already syncing, return early
          if (result && result.status === 'already_syncing') {
            console.warn(`⚠️ [SYNC START] Sync rejected - already in progress (state: ${result.currentState})`);
            return result; // Return the rejection result
          }
          
          // Initialize sync state if not exists
          if (!this.dataSyncStates) {
            this.dataSyncStates = new Map();
          }
          
          // Mark sync as starting (will be properly initialized when sync_start notification arrives)
          this.dataSyncStates.set(deviceId, {
            isActive: true,
            startTime: Date.now(),
            recordsReceived: 0,
            totalRecords: null,
            lastActivity: Date.now()
          });
          
          return result;
        } catch (error) {
          console.error('❌ [SYNC START] Native Android startDataSync failed:', error);
          return { success: false, error: error.message || 'Failed to start data sync' };
        }
      }
      
      // ✅ iOS: Use sendSystemCommand (iOS handles characteristic properties correctly)
      // ✅ SDD Table 10: DATA_SYNC_START - Length=1, Data=0x00
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START, [0x00]);
      
      // Initialize sync state if not exists
      if (!this.dataSyncStates) {
        this.dataSyncStates = new Map();
      }
      
      // Mark sync as starting (will be properly initialized when sync_start notification arrives)
      this.dataSyncStates.set(deviceId, {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: null,
        lastActivity: Date.now()
      });
      
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async stopDataSync(deviceId, clearFlashData = false) {
    try {
      // ✅ SDD Table 10: DATA_SYNC_STOP - Length=1, Data varies
      const payload = [clearFlashData ? 0x01 : 0x00];
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async systemRestart(deviceId) {
    try {
      // ✅ SDD Table 10: SYSTEM_RESTART - Length=1, Data=0x00
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART, [0x00]);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async toggleBuzzer(deviceId, activate = true, beepCount = 0xFF) {
    try {
      // ✅ SDD v1.4 Table 9: Toggle Buzzer - Length: 2 bytes
      // Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 9 System Command List
      // Activate: [0x00, beepCount] where beepCount is 0x00-0xFE (number of beeps) or 0xFF (max 4 minutes/default)
      // Deactivate: [0x01, 0x00]
      let payload;
      if (activate) {
        // Validate beepCount: 0x00-0xFF (0xFF = default/max 4 minutes)
        const validBeepCount = beepCount === null || beepCount === undefined ? 0xFF : Math.min(Math.max(beepCount, 0), 0xFF);
        payload = [0x00, validBeepCount];
      } else {
        payload = [0x01, 0x00];
      }
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async unpairDevice(deviceId) {
    try {
      console.log(`🔓 [UNPAIR] Starting unpair process for device: ${deviceId}`);
      
      // ✅ STEP 1: Set manual disconnect cooldown BEFORE unpair to prevent reconnection
      this.manualDisconnectCooldown.set(deviceId, Date.now());
      console.log('⏳ [UNPAIR] Set 10-second cooldown to prevent reconnection');
      
      // ✅ STEP 2: Send unpair command to device WHILE IT'S STILL CONNECTED
      // IMPORTANT: Don't stop auto-connect or disconnect first - it will disconnect the device!
      // The native iOS code will automatically handle everything after unpair command:
      // - Disconnect the device
      // - Remove from bonded list
      // - Add to forgotten list
      // - Clean up all resources
      console.log('📤 [UNPAIR] Sending unpair command to connected device...');
      const result = await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE, [0x00]);
      
      if (result.success) {
        console.log('✅ [UNPAIR] Unpair command successful - native code handling cleanup');
        
        // ✅ STEP 3: Stop auto-connect AFTER unpair succeeds to prevent immediate reconnection
        try {
          console.log('🛑 [UNPAIR] Stopping auto-connect to prevent reconnection...');
          await AutoConnectService.stopAutoConnect();
        } catch (error) {
          console.warn('⚠️ [UNPAIR] Failed to stop auto-connect:', error);
        }
        
        // ✅ STEP 4: Clean up JS-side state after native code processes the unpair
        // Wait a moment for native disconnection to complete
        setTimeout(async () => {
          console.log('🧹 [UNPAIR] Cleaning up JavaScript state...');
          
          // Update device state
          const device = this.scannedDevices.get(deviceId);
          if (device) {
            device.connectionState = CONNECTION_STATES.DISCONNECTED;
            this.scannedDevices.set(deviceId, device);
          }
          
          // Remove from connected devices
          this.connectedDevices.delete(deviceId);
          
          // Stop any adaptive API calling for this device
          this.stopAdaptiveApiCalling(deviceId);
          
          // Clean up device-specific data
          this.deviceRequestQueues.delete(deviceId);
          this.notificationStats.delete(deviceId);
          
          console.log('✅ [UNPAIR] JavaScript cleanup completed');
        }, 1000); // Wait 1 second for native cleanup
        
        // ✅ STEP 5: Clear manual disconnect cooldown after 10 seconds
        setTimeout(() => {
          this.manualDisconnectCooldown.delete(deviceId);
          console.log('✅ [UNPAIR] Cooldown cleared for device:', deviceId);
        }, 10000);
        
        console.log('✅ [UNPAIR] Device unpaired successfully - auto-connect stays off until user reconnects');
      } else {
        console.error('❌ [UNPAIR] Unpair command failed:', result.error);
        
        // If unpair failed, clear the cooldown
        this.manualDisconnectCooldown.delete(deviceId);
      }
      
      return result;
    } catch (error) {
      console.error('❌ [UNPAIR] Unpair process failed:', error);
      
      // Clean up on error
      this.manualDisconnectCooldown.delete(deviceId);
      
      return { success: false, error: error.message };
    }
  }

  async factoryReset(deviceId) {
    try {
      // ✅ SDD v1.4 Table 9: Factory Reset - Length: 1, Data: No Data (0x00)
      // Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 9 System Command List
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET, [0x00]);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async updatePasskey(deviceId, passkey) {
    try {
      // ✅ SDD v1.4 Table 9: Passkey Update - Length: 3, Data: 6 digits Passkey in numeric (0 to 9)
      // Reference: ET-DSSID-SSD-V1.4_10112025.md - Table 9 System Command List
      // Validate passkey format: must be exactly 6 digits (0-9)
      if (!passkey || typeof passkey !== 'string' || passkey.length !== 6) {
        return { success: false, error: 'Passkey must be exactly 6 digits (0-9)' };
      }
      
      // Validate all characters are numeric
      if (!/^\d{6}$/.test(passkey)) {
        return { success: false, error: 'Passkey must contain only numeric digits (0-9)' };
      }
      
      // Convert passkey string to integer (max 999999)
      const passkeyInt = parseInt(passkey, 10);
      if (passkeyInt > 999999) {
        return { success: false, error: 'Passkey out of range (max 999999)' };
      }
      
      // Encode as 3-byte little-endian integer
      const payload = [
        (passkeyInt >> 0) & 0xFF,   // Byte 0: LSB
        (passkeyInt >> 8) & 0xFF,   // Byte 1: Middle
        (passkeyInt >> 16) & 0xFF   // Byte 2: MSB (only 4 bits needed for max 999999)
      ];
      
      return await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Debug method to manually trigger data reading
  async forceReadDeviceData(deviceId) {
    try {
      
      // Read device status characteristic
      const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
      
      if (deviceStatusData) {
        this.handleDeviceStatusUpdate(deviceId, deviceStatusData);
      }
      
      // Read battery level characteristic
      const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
      
      if (batteryData) {
        this.handleBatteryUpdate(deviceId, batteryData);
      }
      
      // Send system command to trigger notifications
      await this.sendSystemCommand(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS);
      
      return {
        success: true,
        deviceStatusData,
        batteryData
      };
      
    } catch (error) {
      return { success: false, error: error.message };
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

  // Check if a device is connected
  isDeviceConnected(deviceId) {
    return this.connectedDevices.has(deviceId);
  }

  // Set callback for device data updates (for UI refresh)
  setDeviceDataUpdateCallback = (callback) => {
    this.onDeviceDataUpdated = callback;
  }

  // Set device list update callback (for UI refresh when devices connect/disconnect)
  setDeviceListUpdateCallback = (callback) => {
    // Only set if it's a function or null/undefined
    if (callback === null || callback === undefined || typeof callback === 'function') {
    this.onDeviceListUpdated = callback;
    } else {
      console.warn('setDeviceListUpdateCallback: callback must be a function, null, or undefined');
      this.onDeviceListUpdated = null;
    }

    // If there's a pending auto-connect event, trigger it now
    if (callback && typeof callback === 'function' && this.pendingAutoConnectDevice) {
      setTimeout(() => {
        try {
          if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
          this.onDeviceListUpdated();
          }
        } catch (error) {
          console.warn('Error calling onDeviceListUpdated callback:', error);
        }
      }, 500); // Small delay to let UI settle
      this.pendingAutoConnectDevice = null;
    }
  }

  // Force refresh of device data in UI
  triggerDeviceDataRefresh = (deviceId) => {
    const device = this.scannedDevices.get(deviceId);
    if (device && this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    } else if (device && this.onDeviceDataUpdated && this.appState !== 'active') {
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
            return { success: false, error: 'SMART_TAG service not available' };
          }
        } else {
          // iOS uses native bridge RSSI reading
          try {
            updated = await BridgingCodeModule.readRSSI(deviceId);
          } catch (error) {
            return { success: false, error: 'SMART_TAG service not available' };
          }
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
      }
    };
    const timer = setInterval(poll, 15000); // Increased to 15 seconds for battery optimization
    this.rssiTimers.set(deviceId, timer);
    poll();
  }

  // ✅ REMOVED: JavaScript polling fallback for Android (now uses native polling)
  // Android now uses native ScheduledExecutorService polling (like iOS) for reliability
  // iOS continues to use native Timer.scheduledTimer in Swift
  // This JS fallback is no longer needed and has been removed
  startDeviceStatusPollingFallback(deviceId, intervalSeconds) {
    // ✅ Android: Native polling is handled by SampleBridgeAndroid.java
    // Started automatically after SET_DATA_ACQUISITION_INTERVAL command (0x04)
    // Runs using ScheduledExecutorService with fixed rate scheduling
    if (Platform.OS === 'android') {
      console.log(`✅ [POLLING] Android uses native polling (SampleBridgeAndroid.java) - JS polling not needed`);
      console.log(`   Native polling started automatically after SET_DATA_ACQUISITION_INTERVAL command`);
      console.log(`   Polling interval: ${intervalSeconds}s`);
      console.log(`   Implementation: ScheduledExecutorService.scheduleAtFixedRate()`);
      return; // No JS polling needed on Android
    }
    
    // ✅ iOS: Native polling is handled by BridgingCodeModule.swift
    // Started automatically after SET_DATA_ACQUISITION_INTERVAL command (0x04)
    // Runs using Timer.scheduledTimer in Swift
    console.log(`✅ [POLLING] iOS uses native polling (BridgingCodeModule.swift) - JS polling not needed`);
    console.log(`   Native polling started automatically after SET_DATA_ACQUISITION_INTERVAL command`);
    console.log(`   Polling interval: ${intervalSeconds}s`);
    console.log(`   Implementation: Timer.scheduledTimer(withTimeInterval:repeats:)`);
    return; // No JS polling needed on iOS either
  }
  
  stopDeviceStatusPollingFallback(deviceId) {
    // ✅ REMOVED: JavaScript polling fallback is no longer used
    // Native polling is handled by:
    //   - Android: SampleBridgeAndroid.stopDeviceStatusPolling() (called in cleanupDeviceResources)
    //   - iOS: BridgingCodeModule.stopDeviceStatusPolling() (called on disconnect)
    console.log(`ℹ️ [POLLING] Native polling cleanup handled automatically on disconnect for ${deviceId}`);
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
        deviceData: { ...device.deviceData },
        // ✅ Preserve manufacturerData (including MAC address) when returning fresh copy
        manufacturerData: device.manufacturerData ? { ...device.manufacturerData } : device.manufacturerData
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


    return {
      deviceId,
      activeSubscriptions: activeSubscriptions.length,
      subscriptions: activeSubscriptions
    };
  }

  // ==================== AUTO-CONNECT FUNCTIONALITY ====================

  // Check if auto-connect is enabled
  isAutoConnectEnabled() {
    // Check if auto-connect service is enabled
    return AutoConnectService && AutoConnectService.isEnabled;
  }

  // Setup auto-connect callbacks
  setupAutoConnectCallbacks() {
    if (Platform.OS === 'ios') {
      AutoConnectService.addDeviceConnectedCallback(this.handleAutoConnectedDevice);
      AutoConnectService.addDeviceDisconnectedCallback(this.handleAutoDisconnectedDevice);

      // Ensure callbacks are registered with native module
      setTimeout(async () => {
        try {
          await AutoConnectService.ensureCallbacksRegistered();
        } catch (error) {
        }
      }, 1000); // Wait 1 second for React Native to be fully ready
    }
  }



  // Handle device connected via auto-connect
  handleAutoConnectedDevice = async (deviceInfo) => {

    // TODO: IMPLEMENT TAG VERIFICATION FOR AUTO-CONNECT
    // COMMENTED OUT FOR NOW - UNCOMMENT WHEN READY TO USE
    /*
    // Verify if this is user's purchased tag before allowing auto-connect
    const isVerified = await this.isVerifiedTag(deviceInfo.deviceId, deviceInfo.deviceName);
    if (!isVerified) {
      
      // TODO: TAG VERIFICATION COMMENTED OUT - ALLOW ALL TAGS
      // Read location data from nearby tag without full connection
      // await this.handleNearbyTag(deviceInfo.deviceId, deviceInfo.deviceName);
      
      // Disconnect immediately - don't allow auto-connect to unverified tags
      try {
        const device = await this.manager.connectToDevice(deviceInfo.deviceId, { timeout: 3000 });
        await device.cancelConnection();
      } catch (error) {
      }
      return; // Exit early - don't proceed with connection
    }
    
    */

    // ✅ SDD v1.4 ENFORCEMENT: Only one device can be connected concurrently
    // Disconnect all other devices before auto-connecting this one
    const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
      connectedId => connectedId !== deviceInfo.deviceId && this.isDeviceConnected(connectedId)
    );
    
    if (currentlyConnectedDevices.length > 0) {
      console.log(`🔌 [AUTO-CONNECT] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before auto-connecting ${deviceInfo.deviceId}`);
      console.log(`   📋 Devices to disconnect: ${currentlyConnectedDevices.join(', ')}`);
      
      // Disconnect all other devices
      const disconnectPromises = currentlyConnectedDevices.map(async (otherDeviceId) => {
        try {
          console.log(`   🔌 Disconnecting device: ${otherDeviceId}`);
          await this.disconnectFromDevice(otherDeviceId);
          console.log(`   ✅ Successfully disconnected: ${otherDeviceId}`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          // Continue even if one disconnect fails
        }
      });
      
      // Wait for all disconnections to complete (with timeout)
      try {
        await Promise.race([
          Promise.all(disconnectPromises),
          new Promise((resolve) => setTimeout(resolve, 5000)) // 5 second timeout
        ]);
        console.log(`✅ [AUTO-CONNECT] All other devices disconnected, proceeding with auto-connection to ${deviceInfo.deviceId}`);
      } catch (error) {
        console.warn(`⚠️ [AUTO-CONNECT] Error during disconnect of other devices:`, error.message);
        // Continue with auto-connection anyway
      }
    }

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
      rssi: deviceInfo.rssi || null
    };

    this.scannedDevices.set(deviceInfo.deviceId, device);
    this.connectedDevices.set(deviceInfo.deviceId, device);

    
    // Load device services using native implementation
    try {
      await this.loadDeviceServices(deviceInfo.deviceId);
      
      // Start heartbeat monitoring for connection health
      this.startHeartbeatMonitoring(deviceInfo.deviceId);
      
      // ✅ FIX: Ensure monitoring is started after service discovery (safety measure for auto-connect)
      // ServiceDiscoveryComplete event should trigger startMonitoring, but we add this as backup
      setTimeout(() => {
        // Only start monitoring if device is still connected
        if (this.isDeviceConnected(deviceInfo.deviceId)) {
          this.startMonitoring(deviceInfo.deviceId);
        }
      }, 2000); // Wait for service discovery to complete
      
      // ✅ CLEAN ARCHITECTURE: Native handles command sequence via ServiceDiscoveryComplete
      // No need to call requestDeviceData - it happens automatically
      
    } catch (error) {
    }
    
    // Send pet health data to server after auto-connection (with retry mechanism)
    // ❌ DISABLED: Old immediate API call (replaced by buffering system)
    // setTimeout(() => {
    //   this.sendPetHealthDataToServerWithRetry(deviceInfo.deviceId, 'auto-connect');
    // }, 5000);
    
    // ❌ DISABLED: Old adaptive API calling (replaced by buffering system)
    // setTimeout(() => {
    //   this.startAdaptiveApiCalling(deviceInfo.deviceId);
    // }, 7000);
    
    // Start GET API calling for auto-connected device (CRITICAL FOR BACKGROUND)
    setTimeout(() => {
      this.startGetApiCalling(deviceInfo.deviceId);
    }, 8000);
    
    // Start periodic RSSI polling for auto-connected device
    this.startRSSIPolling(deviceInfo.deviceId);
    
    // Start connection health monitoring for auto-connected device
    this.startConnectionHealthCheck();
    
    
    // Trigger device list update callback to refresh UI immediately
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    } else {
      // Store the auto-connect event for later when UI mounts
      this.pendingAutoConnectDevice = deviceInfo;
    }

    // Also trigger after BLE integration attempts complete
    setTimeout(() => {
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
    }, 3000);

    // Also trigger device data update callback if app is active
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceInfo.deviceId, device);
    } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
    }

    // Emit connection event for UI updates (platform-agnostic)
    this.emit('deviceConnected', {
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName,
      connectionType: 'auto',
      platform: Platform.OS
    });

    // Record the auto-connect event so Connection Log screen shows it
    this.addConnectionLog(deviceInfo.deviceId, 'Auto-connected', {
      connectionType: 'auto',
      platform: Platform.OS
    });
  }

  // Handle device disconnected via auto-connect
  handleAutoDisconnectedDevice = (deviceInfo) => {

    const device = this.scannedDevices.get(deviceInfo.deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.disconnectedAt = new Date();
      device.lastSeen = Date.now(); // Set lastSeen so device is preserved in scans
      device.disconnectReason = deviceInfo.error || deviceInfo.reason || 'Physical disconnect'; // Track why it disconnected
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

      // ✅ CRITICAL FIX: Emit deviceDisconnected event to update UI (matching iOS behavior)
      // This ensures ModernBLEManager receives the disconnection event and updates the UI
      this.emit('deviceDisconnected', {
        ...device,
        id: device.id || deviceInfo.deviceId, // Ensure id is set
        deviceId: deviceInfo.deviceId, // Also include deviceId for compatibility
        reason: deviceInfo.error || deviceInfo.reason || 'disconnected',
        error: deviceInfo.error
      });

      // Add disconnection log
      this.addConnectionLog(deviceInfo.deviceId, 'Disconnected', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect'
      });

    } else {
      // Create entry for device that wasn't in scannedDevices
      const newDevice = {
        id: deviceInfo.deviceId,
        name: deviceInfo.deviceName,
        connectionState: CONNECTION_STATES.DISCONNECTED,
        lastSeen: Date.now(),
        disconnectedAt: new Date(),
        disconnectReason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
        isSmartTag: deviceInfo.deviceName?.toLowerCase().includes('tag') || false,
        deviceData: {}
      };
      this.scannedDevices.set(deviceInfo.deviceId, newDevice);

      // ✅ CRITICAL FIX: Emit deviceDisconnected event even if device wasn't in scannedDevices
      this.emit('deviceDisconnected', {
        ...newDevice,
        deviceId: deviceInfo.deviceId,
        reason: deviceInfo.error || deviceInfo.reason || 'disconnected',
        error: deviceInfo.error
      });

      // Also log disconnection for devices that were not tracked previously
      this.addConnectionLog(deviceInfo.deviceId, 'Disconnected', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect'
      });
    }

    // Force UI refresh immediately
    this.scheduleListUpdate();

    // Kick auto-connect machinery from JS side as well (best-effort)
    setTimeout(async () => {
      try {
        const status = await this.getAutoConnectStatus();
        if (status.success && status.status.enabled) {
          try { await this.connectToKnownPeripherals(); } catch { }
          try { await this.forceScanForBondedDevices(); } catch { }
        }
      } catch { }
    }, 1000);

  }

  // Start periodic connection health check
  startConnectionHealthCheck() {
    if (this.connectionHealthTimer) return;

    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.healthCheckMs || 10000;
    
    this.connectionHealthTimer = setInterval(async () => {
      try {
        await this.checkConnectionHealth();
      } catch (error) {
      }
    }, interval); // Use profile-based timing
    
    // Start RSSI cycle when health checks start
    const rssiInterval = this.profile.rssiCycleIntervalMs || 30000;
    this.startRssiCycle();
  }



  // Stop connection health check
  stopConnectionHealthCheck() {
    if (this.connectionHealthTimer) {
      clearInterval(this.connectionHealthTimer);
      this.connectionHealthTimer = null;
      const currentProfile = this.getCurrentProfileName();
    }
    
    // Stop RSSI cycle when health checks stop
    const currentProfile = this.getCurrentProfileName();
    this.stopRssiCycle();
  }

  // Check if connected devices are actually still connected
  async checkConnectionHealth() {
    const connectedDeviceIds = Array.from(this.connectedDevices.keys());
    if (connectedDeviceIds.length === 0) return;


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
          } catch (error) {
            throw error; // Re-throw to trigger disconnect handling
          }
        } else {
          // iOS uses native bridge RSSI reading for health check
          try {
            const result = await BridgingCodeModule.readRSSI(deviceId);
            rssi = result;
          } catch (error) {
            throw error; // Re-throw to trigger disconnect handling
          }
        }
        
        // Update connection quality based on RSSI
        if (rssi !== null && rssi !== undefined) {
          this.checkRssiConnectionQuality(deviceId, rssi);
        }
      } catch (error) {

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
      const result = await AutoConnectService.startAutoConnect();

      if (result.success) {
        return { success: true, message: 'Auto-connect started' };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Stop auto-connect functionality
  async stopAutoConnect() {
    try {
      const result = await AutoConnectService.stopAutoConnect();

      if (result.success) {
        return { success: true, message: 'Auto-connect stopped' };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Add device to bonded list (call after successful manual connection)
  async addDeviceToBondedList(deviceId) {
    try {
      const result = await AutoConnectService.addBondedDevice(deviceId);

      if (result.success) {
        return { success: true, message: 'Device bonded for auto-connect' };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Remove device from bonded list
  async removeDeviceFromBondedList(deviceId) {
    try {
      const result = await AutoConnectService.removeBondedDevice(deviceId);

      if (result.success) {
        return { success: true, message: 'Device unbonded from auto-connect' };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get bonded devices list
  async getBondedDevices() {
    try {
      const result = await AutoConnectService.getBondedDevices();

      if (result.success) {
        return { success: true, devices: result.devices };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Get auto-connect status
  async getAutoConnectStatus() {
    try {
      const result = await AutoConnectService.getAutoConnectStatus();

      if (result.success) {
        return { success: true, status: result.status };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
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
      const result = await AutoConnectService.forceScanForBondedDevices();

      if (result.success) {
        return { success: true, message: 'Force scan started - check logs for 10 seconds' };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // Force refresh of all devices by starting a new scan
  async forceRefreshDeviceList() {
    try {

      // Start a fresh scan to rediscover all devices
      await this.startScanning();

      // Stop scan after 10 seconds to avoid excessive battery usage
      setTimeout(() => {
        if (this.scanState === SCAN_STATES.SCANNING) {
          this.stopScanning();
        }
      }, 10000);

      return { success: true, message: 'Device list refresh initiated' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  // ==================== INDUSTRY STANDARD IMPROVEMENTS ====================

  // ✅ SYNC WITH ANDROID & iOS: Reconnection Constants (matching Android & iOS implementation)
  // Using constants from BLEConstants.js for consistency

  /**
   * ✅ SYNC WITH ANDROID & iOS: Classify error type for automatic retry logic
   * Matches Android BLEError.getErrorType() and iOS BLEErrorType enum implementation
   */
  classifyError(error) {
    if (!error) return ERROR_TYPES.TRANSIENT;

    const errorCode = error.code || '';
    const errorMessage = (error.message || '').toLowerCase();

    // Transient errors - can retry
    if (errorCode.includes('TIMEOUT') || 
        errorCode.includes('CONNECTION_ERROR') ||
        errorMessage.includes('timeout') ||
        errorMessage.includes('temporary') ||
        errorMessage.includes('connection failed') ||
        errorCode === 'OPERATION_TIMEOUT' ||
        errorCode === 'DEVICE_CONNECTION_FAILED') {
      return ERROR_TYPES.TRANSIENT;
    }

    // Permanent errors - cannot retry
    if (errorCode.includes('NOT_FOUND') ||
        errorCode.includes('INVALID') ||
        errorMessage.includes('not found') ||
        errorMessage.includes('invalid') ||
        errorCode === 'DEVICE_NOT_FOUND' ||
        errorCode === 'INVALID_IDENTIFIERS') {
      return ERROR_TYPES.PERMANENT;
    }

    // User action required
    if (errorCode.includes('PERMISSION') ||
        errorCode.includes('AUTHORIZATION') ||
        errorCode.includes('AUTHENTICATION') ||
        errorMessage.includes('permission') ||
        errorMessage.includes('authorization') ||
        errorMessage.includes('pairing') ||
        errorCode === 'PERMISSION_DENIED' ||
        errorCode === 'PAIRING_FAILED') {
      return ERROR_TYPES.USER_ACTION;
    }

    // Default to transient for unknown errors (can retry)
    return ERROR_TYPES.TRANSIENT;
  }

  /**
   * ✅ SYNC WITH ANDROID & iOS: Check if error can be retried automatically
   */
  canRetryError(error) {
    return this.classifyError(error) === ERROR_TYPES.TRANSIENT;
  }

  /**
   * ✅ SYNC WITH ANDROID & iOS: Check if error requires user action
   */
  requiresUserAction(error) {
    return this.classifyError(error) === ERROR_TYPES.USER_ACTION;
  }

  // 1. Exponential Backoff Reconnection (✅ SYNCED WITH ANDROID & iOS)
  // Note: iOS handles reconnection natively, but this method uses the same constants/logic
  startExponentialBackoffReconnection(deviceId) {
    if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
      return; // Already reconnecting
    }

    if (!this.reconnectionTimers) this.reconnectionTimers = new Map();
    if (!this.reconnectionAttempts) this.reconnectionAttempts = new Map();

    const attempt = this.reconnectionAttempts.get(deviceId) || 0;
    // ✅ SYNC WITH ANDROID & iOS: Use 5 attempts (matching Android & iOS MAX_RECONNECT_ATTEMPTS)
    const maxAttempts = RECONNECTION_CONSTANTS.MAX_ATTEMPTS;
    const baseDelay = RECONNECTION_CONSTANTS.INITIAL_BACKOFF_MS;
    const maxDelay = RECONNECTION_CONSTANTS.MAX_BACKOFF_MS;
    const jitter = Math.random() * RECONNECTION_CONSTANTS.JITTER_MS;

    // ✅ SYNC WITH ANDROID & iOS: Check max attempts
    if (attempt >= maxAttempts) {
      console.log(`🛑 [JS RECONNECT] Max reconnection attempts (${maxAttempts}) reached for: ${deviceId}`);
      this.reconnectionAttempts.delete(deviceId);
      return;
    }

    // ✅ SYNC WITH ANDROID & iOS: Check RSSI before reconnecting (skip if too weak)
    const device = this.scannedDevices.get(deviceId);
    if (device && device.rssi !== null && device.rssi !== undefined) {
      const minRssi = RECONNECTION_CONSTANTS.MIN_RSSI_FOR_RECONNECTION;
      if (device.rssi < minRssi) {
        console.log(`📶 [JS RECONNECT] Device RSSI too weak (${device.rssi} dBm < ${minRssi} dBm) - skipping reconnection for: ${deviceId}`);
        this.reconnectionAttempts.delete(deviceId); // Don't count this as an attempt
        return;
      }
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);

    const timer = setTimeout(async () => {
      try {
        if (this.manualDisconnectCooldown.has(deviceId)) {

          // Try direct connection first
          const connectResult = await this.connectToKnownPeripherals();
          if (connectResult.attempted > 0) {
            this.reconnectionAttempts.delete(deviceId);
            return { success: false, error: 'SMART_TAG service not available' };
          }

          // Fallback to scanning
          await this.forceScanForBondedDevices();

          // Schedule next attempt
          this.reconnectionAttempts.set(deviceId, attempt + 1);
          this.startExponentialBackoffReconnection(deviceId);
        } else {
          this.reconnectionAttempts.delete(deviceId);
        }
      } catch (error) {
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
          return { success: false, error: 'SMART_TAG service not available' };
        }

        // Send heartbeat (read a simple characteristic)
        if (Platform.OS === 'android') {
          // For Android, try RSSI reading first (more reliable)
          try {
            await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          } catch (rssiError) {
            // Fallback to characteristic reading
            await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
          }
        } else {
          // iOS uses RSSI reading for heartbeat
          try {
            await BridgingCodeModule.readRSSI(deviceId);
          } catch (rssiError) {
            // Fallback to characteristic reading
            await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
          }
        }

        // Reset missed heartbeat counter
        this.heartbeatCounters.set(deviceId, 0);
      } catch (error) {
        const missedCount = (this.heartbeatCounters.get(deviceId) || 0) + 1;
        this.heartbeatCounters.set(deviceId, missedCount);


        if (missedCount >= maxMissedHeartbeats) {
          this.handleAutoDisconnectedDevice({
            deviceId,
            deviceName: 'Unknown Device',
            error: 'Heartbeat timeout'
          });
        }
      }
    }, heartbeatInterval);

    this.heartbeatTimers.set(deviceId, timer);
  }

  stopHeartbeatMonitoring(deviceId) {
    if (!this.heartbeatTimers) return;

    const timer = this.heartbeatTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(deviceId);
      this.heartbeatCounters.delete(deviceId);
    }
  }

  // 5. Proper MTU Negotiation
  async negotiateMTU(deviceId, preferredMTU = 512) {
    try {
      const device = this.connectedDevices.get(deviceId);
      if (!device) return false;

      const currentMTU = await device.mtu();

      if (currentMTU < preferredMTU) {
        const newMTU = await device.requestMTU(preferredMTU);
        return newMTU >= preferredMTU;
      }

      return true;
    } catch (error) {
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
      const result = await AutoConnectService.debugConnectionStatus();

      if (result.success) {
        return { success: true, data: result.result };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async connectToKnownPeripherals() {
    try {
      const result = await AutoConnectService.connectToKnownPeripherals();

      if (result.success) {
        return {
          success: true,
          message: `Started ${result.result.attempted} connection attempts to known peripherals`,
          attempted: result.result.attempted,
          knownPeripherals: result.result.knownPeripherals
        };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
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

        // Check if auto-connect is enabled (with retry logic)
        let autoConnectStatus = await this.getAutoConnectStatus();

        // If auto-connect shows as disabled, it might be a timing issue - retry after starting it
        if (!autoConnectStatus.enabled) {
          await this.startAutoConnect();

          // Check again after starting
          autoConnectStatus = await this.getAutoConnectStatus();
          if (!autoConnectStatus.enabled) {
            return { success: false, error: 'SMART_TAG service not available' };
          } else {
          }
        }

        // Check if there are any bonded devices
        const bondedDevices = await this.getBondedDevices();
        if (bondedDevices.length === 0) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        // Check if we already have connected devices
        const connectedCount = this.connectedDevices.size;
        if (connectedCount > 0) {
          return { success: false, error: 'SMART_TAG service not available' };
        }


        // Start auto-connect
        await this.startAutoConnect();

        // Also try direct connection to known peripherals
        setTimeout(async () => {
          try {
            const connectResult = await this.connectToKnownPeripherals();
          } catch (error) {
          }
        }, 2000);


        // Also start periodic scanning for bonded devices
        this.startPeriodicAutoScan();
      }, 3000); // Wait 3 seconds for app to fully initialize
    } catch (error) {
    }
  }

  startPeriodicAutoScan() {
    // Only on iOS
    if (Platform.OS !== 'ios') {
      return;
    }


    // Check every 30 seconds for disconnected bonded devices
    this.periodicScanInterval = setInterval(async () => {
      try {
        const autoConnectStatus = await this.getAutoConnectStatus();
        if (!autoConnectStatus.enabled) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        const bondedDevices = await this.getBondedDevices();
        const connectedCount = this.connectedDevices.size;

        if (bondedDevices.length > 0 && connectedCount === 0) {
          await this.forceScanForBondedDevices();
        }
      } catch (error) {
      }
    }, 30000); // Every 30 seconds
  }

  stopPeriodicAutoScan() {
    if (this.periodicScanInterval) {
      clearInterval(this.periodicScanInterval);
      this.periodicScanInterval = null;
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
  }

  // Method to set all connected devices to active (useful for testing or manual control)
  setAllDevicesActive = () => {
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, true);
      }
    }
  }

  // Method to set all connected devices to inactive (useful for testing or manual control)
  setAllDevicesInactive = () => {
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
        const result = await SampleBridgeAndroid.triggerHealthDataApiCall(deviceId);
        return result;
      } else {
        return false;
      }
    } catch (error) {
      return false;
    }
  }

  // Handle health data API request from native side
  async handleNativeHealthDataApiRequest(eventData) {
    try {
      const { deviceId, deviceData, timestamp } = eventData;
      
      
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
          
        }
      }
      
      // ❌ DISABLED: Old immediate API call (replaced by industry-standard buffering system)
      // await this.sendPetHealthDataToServer(deviceId);
      // The buffering system now handles all API calls efficiently:
      // - Historical sync: ALL records sent after sync complete
      // - Live updates: Batched every 5 minutes (10 records)
      // - Alerts: Immediate for critical thresholds
      console.log(`ℹ️ [NATIVE API] Data updated, handled by buffering system`);
      
    } catch (error) {
    }
  }

  handleNativeSystemCommandResponse(eventData) {
    const { type, deviceId, commandId, rawData, rawResponse, dataLength, responseStatus, status, commandName, firmwareVersion, hardwareVersion } = eventData;
    
    console.log(`📥 [NATIVE SYSTEM COMMAND] Received eventData:`, { type, deviceId, commandId, rawData: rawData?.substring(0, 20), rawResponse: rawResponse?.substring(0, 30), status });
    
    // ✅ PLATFORM-INDEPENDENT: Handle both Android and iOS formats
    // Android: { type: 'system_command_response', rawData: hex_string (data only) }
    // iOS: { deviceId, commandId, commandName, status, rawResponse: hex_string (full response with spaces) }
    const isAndroidFormat = type === 'system_command_response';
    const isiOSFormat = status !== undefined && commandName !== undefined;
    
    // iOS sends rawResponse (full response), Android sends rawData (data portion only)
    const responseHex = rawResponse || rawData;
    
    if ((isAndroidFormat && rawData) || (isiOSFormat && rawResponse)) {
      
      // Parse the response data using BLEDataParser for consistency
      try {
        // Convert hex string to base64 for parser
        let dataToParse = responseHex;
        
        // iOS sends space-separated hex: "BB 05 05 00 31 2E 30 2E 32"
        // Android sends continuous hex: "310E302E32"
        if (typeof responseHex === 'string') {
          // Remove spaces if present (iOS format)
          const cleanHex = responseHex.replace(/\s+/g, '');
          
          // Validate it's hex
          if (/^[0-9a-fA-F]+$/i.test(cleanHex)) {
            const buffer = Buffer.from(cleanHex, 'hex');
            dataToParse = buffer.toString('base64');
          } else {
            console.warn(`⚠️ [NATIVE SYSTEM COMMAND] Invalid hex format: ${responseHex.substring(0, 20)}`);
            return;
          }
        } else {
          console.warn(`⚠️ [NATIVE SYSTEM COMMAND] rawResponse/rawData is not a string:`, typeof responseHex);
          return;
        }
        
        console.log(`📥 [NATIVE SYSTEM COMMAND] Parsing response for deviceId: ${deviceId}, hex length: ${responseHex.replace(/\s+/g, '').length}`);
        
        // Use the same parser to ensure consistency
        const response = BLEDataParser.parseSystemCommandResponse(dataToParse);
        
        if (response && response.sddCompliant) {
          // ✅ CRITICAL: Store response IMMEDIATELY for async command methods
          // This must happen before handleSystemCommandResponse to ensure getFirmwareVersion can find it
          const responseKey = `${deviceId}_${response.command}`;
          if (!this.systemCommandResponses) {
            this.systemCommandResponses = new Map();
          }
          
          // ✅ Normalize response structure: parser returns "data" but code expects "parsedData"
          const normalizedResponse = {
            ...response,
            parsedData: response.data || response.parsedData
          };
          this.systemCommandResponses.set(responseKey, normalizedResponse);
          
          const version = normalizedResponse.parsedData?.version || firmwareVersion || hardwareVersion || 'N/A';
          console.log(`💾 [NATIVE SYSTEM COMMAND] Stored response for key: ${responseKey}, command: ${response.command}, version: ${version}`);
          console.log(`💾 [NATIVE SYSTEM COMMAND] All stored keys after storage:`, Array.from(this.systemCommandResponses.keys()));
          
          // Also call handleSystemCommandResponse for consistency (it will handle events/logging)
          // Note: handleSystemCommandResponse will also store it, but that's okay - it ensures consistency
          this.handleSystemCommandResponse(deviceId, dataToParse);
        } else {
          console.warn(`⚠️ [NATIVE SYSTEM COMMAND] Response not SDD compliant or invalid:`, response);
          
          // ✅ FALLBACK: If iOS already parsed the version, store it directly
          if (isiOSFormat && (firmwareVersion || hardwareVersion)) {
            const responseKey = `${deviceId}_${commandId}`;
            if (!this.systemCommandResponses) {
              this.systemCommandResponses = new Map();
            }
            const fallbackResponse = {
              command: commandId,
              success: status === 'success',
              parsedData: {
                version: firmwareVersion || hardwareVersion || 'Unknown',
                commandName: commandName
              },
              sddCompliant: true
            };
            this.systemCommandResponses.set(responseKey, fallbackResponse);
            console.log(`💾 [NATIVE SYSTEM COMMAND] Stored fallback response for key: ${responseKey}, version: ${fallbackResponse.parsedData.version}`);
          }
        }
        
      } catch (error) {
        console.error(`❌ [NATIVE SYSTEM COMMAND] Error parsing response:`, error);
      }
    } else {
      console.warn(`⚠️ [NATIVE SYSTEM COMMAND] Unknown format - isAndroidFormat: ${isAndroidFormat}, isiOSFormat: ${isiOSFormat}, rawResponse: ${rawResponse?.substring(0, 30)}, rawData: ${rawData?.substring(0, 20)}`);
    }
  }

  async handleNativeDataTransferEvent(eventData) {
    const { type, deviceId, totalRecords, success, recordsTransmitted, records, recordCount, errorCode, companyId, rawData } = eventData;
    
    switch (type) {
      case 'manufacturer_data':
        // ✅ Store battery level from manufacturer data
        const device = this.scannedDevices.get(deviceId);
        if (device) {
          device.deviceData = device.deviceData || {};
          
          // Store manufacturer data info
          device.deviceData.manufacturerRecordCount = recordCount || 0;
          device.deviceData.manufacturerCompanyId = companyId;
          device.deviceData.manufacturerRawData = rawData;
          device.deviceData.lastManufacturerUpdate = Date.now();
          
          // ✅ CRITICAL: Store battery level from advertising packet
          if (eventData.batteryLevel !== undefined && eventData.batteryLevel !== null) {
            device.deviceData.batteryLevel = eventData.batteryLevel;
            device.deviceData.batteryMillivolts = eventData.batteryMillivolts || null;
          }
          
          // Emit device data update
          this.emit('deviceDataUpdated', {
            deviceId,
            deviceData: device.deviceData
          });
        }
        break;
        
      case 'sync_start':
        
        // Emit event for UI to show sync progress
        this.emit('dataTransfer', {
          deviceId,
          type: 'sync_start',
          totalRecords,
          payloadLength: eventData.payloadLength,
          rawPayload: eventData.rawPayload,
          success: true
        });
        break;
        
      case 'sync_complete':
        // ✅ NATIVE DATA TRANSFER: Sync complete from native side
        console.log(`📊 [SYNC COMPLETE] Received for ${deviceId}: ${recordsTransmitted} records`);
        
        // ✅ FIX: Route to handleSyncComplete to ensure consistent logging (single log entry)
        // This prevents duplicate log entries and ensures all sync completion logic runs in one place
        const parsedTransfer = {
          type: 'sync_complete',
          typeString: 'sync_complete',
          success: success,
          recordsTransmitted: recordsTransmitted || 0,
          timestamp: new Date()
        };
        
        // Handle sync complete through the main handler (will log once)
        this.handleSyncComplete(deviceId, parsedTransfer);
        
        // ✅ FIX: Track sync completion time to prevent post-sync reads from triggering auto-sync
        if (success) {
          if (!this.autoSyncMeta) {
            this.autoSyncMeta = new Map();
          }
          const meta = this.autoSyncMeta.get(deviceId) || {};
          meta.lastSyncCompletedAt = Date.now();
          this.autoSyncMeta.set(deviceId, meta);
          console.log(`✅ [SYNC COMPLETE] Tracked sync completion time for ${deviceId} - will prevent auto-sync for 5 seconds`);
        }
        
        // Update UI with latest synced data (handleSyncComplete already emits events, but keep for compatibility)
        if (success) {
          const updated = this.updateDeviceDataFromSyncedRecords(deviceId);
          
          if (updated) {
            const latestRecord = this.getLatestSyncedRecord(deviceId);
            
            // Emit comprehensive sync completion event (handleSyncComplete already emits, but keep for backward compatibility)
            this.emit('syncDataUpdated', {
              deviceId,
              latestRecord,
              totalRecords: recordsTransmitted,
              success: true
            });
          }
          
          // ✅ FIX: Only send records from THIS sync, not all accumulated records
          // Track records that were just synced by getting records added since sync started
          const device = this.scannedDevices.get(deviceId);
          if (device && device.syncRecords) {
            // Get the record count before this sync started (default to 0 if not set)
            const recordsBeforeSync = device.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
            
            // Only send records that were added in this sync (new records)
            const newRecords = device.syncRecords.slice(recordsBeforeSync);
            
            if (newRecords && newRecords.length > 0) {
              console.log(`📤 [HISTORICAL SYNC] Preparing to send ${newRecords.length} NEW records from this sync (total stored: ${device.syncRecords.length}, baseline: ${recordsBeforeSync})`);
              await this.sendHistoricalRecords(deviceId, newRecords);
              
              // ✅ Update the baseline for next sync
              device.syncRecordsBeforeSync = device.syncRecords.length;
              this.scannedDevices.set(deviceId, device);
            } else {
              console.log(`⚠️ [HISTORICAL SYNC] No new records to send (all ${device.syncRecords.length} records were already sent, baseline: ${recordsBeforeSync})`);
            }
          } else {
            console.log(`⚠️ [HISTORICAL SYNC] No records available to send`);
          }
        }
        
        // Emit standard data transfer event
        this.emit('dataTransfer', {
          deviceId,
          type: 'sync_complete',
          success,
          recordsTransmitted
        });
        
        // Clean up sync state
        if (this.dataSyncStates) {
          this.dataSyncStates.delete(deviceId);
        }
        break;
        
      case 'record':
        // ✅ NATIVE DATA TRANSFER: Store records from native side
        console.log(`📋 [RECORD] Received ${records?.length || 0} records for ${deviceId}`);
        
        if (records && Array.isArray(records)) {
          const device = this.scannedDevices.get(deviceId);
          if (device) {
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            
            // Add new records from native side
            let validRecordsCount = 0;
            let invalidRecordsCount = 0;
            
            records.forEach((record) => {
              // ✅ FIX: Filter out invalid zero/padding records
              const isValidRecord = (
                record.steps > 0 ||  // Has meaningful steps
                record.temperature > 0 ||  // Has meaningful temperature
                (record.timestamp && record.timestamp > 1577836800)  // Has valid timestamp (after 2020)
              );
              
              if (!isValidRecord) {
                console.log(`🚫 [RECORD] Skipping invalid/padding record: Steps=${record.steps}, Temp=${record.temperature}°C, Time=${record.timestamp || 0}`);
                invalidRecordsCount++;
                return;  // Skip this record
              }
              
              // ✅ FIX: Check for duplicate records by timestamp (and steps/temperature for robustness)
              // This prevents the same record from being added multiple times
              const recordTimestamp = record.timestamp;
              const existingRecordIndex = device.syncRecords.findIndex(r => {
                const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
                // Match by timestamp, and optionally by steps/temperature to catch exact duplicates
                return existingTimestamp === recordTimestamp && 
                       r.steps === record.steps && 
                       r.temperature === record.temperature;
              });
              
              if (existingRecordIndex >= 0) {
                console.log(`🔄 [RECORD] Duplicate detected - skipping: Steps=${record.steps}, Temp=${record.temperature}°C, Time=${record.timestampDate || new Date(record.timestamp * 1000).toISOString()}`);
                invalidRecordsCount++;
                return;  // Skip duplicate record
              }
              
              validRecordsCount++;
              console.log(`📋 [RECORD] Storing: Steps=${record.steps}, Temp=${record.temperature}°C, Time=${record.timestampDate || new Date(record.timestamp * 1000).toISOString()}`);
              
              const newRecord = {
                ...record,
                timestamp: record.timestamp,
                timestampDate: record.timestampDate,
                temperature: record.temperature,
                steps: record.steps,
                receivedAt: new Date(),
                deviceId,
                source: 'native'
              };
              device.syncRecords.push(newRecord);
            });
            
            console.log(`📊 [RECORD] Filtered: ${validRecordsCount} valid, ${invalidRecordsCount} invalid records`);
            
            console.log(`📊 [RECORD] Total records stored for ${deviceId}: ${device.syncRecords.length}`);
            
            // ✅ Save all new records to Redux in bulk (more efficient)
            if (validRecordsCount > 0) {
              try {
                const newRecords = device.syncRecords.slice(-validRecordsCount); // Get the last N records that were just added
                store.dispatch(addRecords({ deviceId, records: newRecords }));
                console.log(`💾 [Redux] Saved ${newRecords.length} records to Redux for device ${deviceId}`);
              } catch (error) {
                console.warn('Failed to save records to Redux:', error);
              }
            }
            
            // ✅ Update recordCount incrementally as records are added (like steps)
            if (validRecordsCount > 0) {
              if (!device.deviceData) {
                device.deviceData = {};
              }
              device.deviceData.recordCount = device.syncRecords.length;
              
              // Trigger UI update
              if (this.onDeviceDataUpdated && this.appState === 'active') {
                this.onDeviceDataUpdated(deviceId, device.deviceData);
              }
              
              // Trigger device list update for UI refresh
              if (this.onDeviceListUpdated) {
                this.onDeviceListUpdated();
              }
            }
            
            this.scannedDevices.set(deviceId, device);
          } else {
            console.log(`⚠️ [RECORD] Device not found: ${deviceId}`);
          }
        } else {
          console.log(`⚠️ [RECORD] Invalid records array`);
        }
        
        // Emit event for UI to show record data
        this.emit('dataTransfer', {
          deviceId,
          type: 'record',
          records,
          recordCount
        });
        break;
        
      case 'read_error':
        // Emit event for UI to show error
        this.emit('dataTransfer', {
          deviceId,
          type: 'read_error',
          errorCode
        });
        break;
        
      default:
        break;
    }
  }

  /**
   * Collect all device data after system commands to see what values we're getting
   * @param {string} deviceId - Device ID
   */
  async collectAllDeviceDataAfterCommands(deviceId) {
    try {
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }


      // 1. Read all characteristics we can access
      
      // Battery Level
      try {
        const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
        if (batteryData) {
          const batteryBuffer = Buffer.from(batteryData, 'base64');
          const batteryLevel = batteryBuffer.readUInt8(0);
        }
      } catch (error) {
      }

      // Device Status
      try {
        const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        if (deviceStatusData) {
          const parsedStatus = BLEDataParser.parseDeviceStatus(deviceStatusData);
        }
      } catch (error) {
      }

      // System Command Characteristic (to check for responses)
      try {
        const systemCommandData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.SYSTEM_COMMAND);
        if (systemCommandData) {
          const systemBuffer = Buffer.from(systemCommandData, 'base64');
        }
      } catch (error) {
      }

      // Data Transfer Characteristic
      try {
        const dataTransferData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DATA_TRANSFER);
        if (dataTransferData) {
          const transferBuffer = Buffer.from(dataTransferData, 'base64');
        }
      } catch (error) {
      }

      // Manufacturer Info
      try {
        const manufacturerData = await this.readCharacteristic(deviceId, BLE_SERVICES.DEVICE_INFO, BLE_CHARACTERISTICS.MANUFACTURER);
        if (manufacturerData) {
          const manufacturerBuffer = Buffer.from(manufacturerData, 'base64');
          const manufacturer = manufacturerBuffer.toString('utf8');
        }
      } catch (error) {
      }

      // Model Number
      try {
        const modelData = await this.readCharacteristic(deviceId, BLE_SERVICES.DEVICE_INFO, BLE_CHARACTERISTICS.MODEL_NUMBER);
        if (modelData) {
          const modelBuffer = Buffer.from(modelData, 'base64');
          const model = modelBuffer.toString('utf8');
        }
      } catch (error) {
      }

      // 2. Check current device data state

      // 3. Check monitoring subscriptions

      // 4. Check data sync states
      if (this.dataSyncStates && this.dataSyncStates.has(deviceId)) {
        const syncState = this.dataSyncStates.get(deviceId);
      }


    } catch (error) {
    }
  }

  // Send pet health BLE data to server after successful connection
  async sendPetHealthDataToServer(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device || !device.deviceData) {
        return;
      }

      // Extract device data
      const { batteryLevel, temperature, steps, lastUpdate } = device.deviceData;

      // Only send if we have meaningful data
      if (batteryLevel === null && temperature === null && steps === null) {
        return;
      }

      // ✅ Convert timestamp to ISO string
      // lastUpdate is ALWAYS a Date object (guaranteed by updateDeviceDataFromSyncedRecords and handleDeviceStatusData)
      let timestampISO = null;
      if (lastUpdate && lastUpdate instanceof Date && !isNaN(lastUpdate.getTime())) {
        timestampISO = lastUpdate.toISOString();
      }

      // Prepare the payload according to the API specification
      const petHealthData = {
        PetId: 1059773, // This should be set based on your app's logic (Brunio did1 staging)
        Steps: steps || null,
        Temperature: temperature ? temperature.toString() : null,
        BatteryLevel: batteryLevel ? batteryLevel.toString() : null,
        TimeStamp: timestampISO,
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

      // Send data to server
      const result = await postPetHealthBLEData(petHealthData);

      if (result.success !== false) {
      } else {
      }

    } catch (error) {
    }
  }

  // Send pet health data to server with retry mechanism for auto-connected devices
  async sendPetHealthDataToServerWithRetry(deviceId, context = 'unknown', maxRetries = 3, retryDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        
        const device = this.scannedDevices.get(deviceId);
        if (!device) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        // Check if device data is available and has meaningful data
        if (!device.deviceData) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          } else {
            return { success: false, error: 'SMART_TAG service not available' };
          }
        }

        const { batteryLevel, temperature, steps, lastUpdate } = device.deviceData;
        
        // Check if we have meaningful data
        if (batteryLevel === null && temperature === null && steps === null) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          } else {
            return { success: false, error: 'SMART_TAG service not available' };
          }
        }

        // If we reach here, we have data - proceed with sending
        
        // Use the existing method to send data
        await this.sendPetHealthDataToServer(deviceId);
        return; // Success, exit retry loop
        
      } catch (error) {
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        } else {
        }
      }
    }
  }

  // ==================== ADAPTIVE API CALLING FUNCTIONALITY ====================

  // Set screen active state for a device (called from UI when screen becomes active)
  setScreenActiveState(deviceId, isActive) {
    
    const currentState = this.screenActiveStates.get(deviceId);
    
    // Only update if the state actually changed
    if (currentState !== isActive) {
      this.screenActiveStates.set(deviceId, isActive);
      
      // Restart adaptive API calling with new interval
      this.restartAdaptiveApiCalling(deviceId);
      
      // Handle GET API calling based on screen state
      if (isActive) {
        // Start GET API calling when screen becomes active
        const success = this.startGetApiCalling(deviceId);
        if (success) {
        } else {
        }
      } else {
        // Stop GET API calling when screen becomes inactive
        this.stopGetApiCalling(deviceId);
      }
    } else {
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
    // ❌ DISABLED: Replaced by industry-standard buffering system
    // This method is kept for compatibility but does nothing
    // All API calls now handled by:
    // - Historical sync: sendHistoricalRecords() after sync complete
    // - Live updates: uploadLiveBatch() every 5 minutes
    // - Alerts: sendImmediateAlert() when threshold crossed
    console.log(`ℹ️ [ADAPTIVE API] Disabled - using buffering system instead for ${deviceId}`);
    return;
    
    // Old code below (disabled):
    /*
    // Clear existing timer if any
    this.stopAdaptiveApiCalling(deviceId);
    
    const interval = this.getCurrentApiInterval(deviceId);
    const appState = this.appState;
    const screenActive = this.screenActiveStates.get(deviceId) || false;
    
    // Use native monitoring when app is in background (like RSSI does)
    if (this.appState === 'background' && Platform.OS === 'android' && SampleBridgeAndroid) {
      SampleBridgeAndroid.startHealthDataApiMonitoring(deviceId, interval)
        .then(() => {
          // Store native monitoring info instead of timer
          this.adaptiveApiTimers.set(deviceId, { isNative: true, interval });
        })
        .catch((error) => {
          // Fallback to JS timer
          this.startJSTimer(deviceId, interval);
        });
    } else {
      // Use regular JS timer when app is active
      this.startJSTimer(deviceId, interval);
    }
    */
  }
  
  // Start JavaScript timer for API calling (DISABLED - see startAdaptiveApiCalling)
  startJSTimer(deviceId, interval) {
    return;  // Disabled
    /*
    const timer = setInterval(async () => {
      try {
        const device = this.scannedDevices.get(deviceId);
        if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
          await this.sendPetHealthDataToServer(deviceId);
        }
      } catch (error) {
      }
    }, interval);
    
    // Store timer with interval information
    this.adaptiveApiTimers.set(deviceId, { timer, interval });
    */
  }

  // Stop adaptive API calling for a device
  stopAdaptiveApiCalling(deviceId) {
    const timerInfo = this.adaptiveApiTimers.get(deviceId);
    if (timerInfo) {
      if (timerInfo.isNative && Platform.OS === 'android' && SampleBridgeAndroid) {
        // Stop native monitoring
        SampleBridgeAndroid.stopHealthDataApiMonitoring(deviceId)
          .then(() => {
          })
          .catch((error) => {
          });
      } else if (timerInfo.timer) {
        // Stop JS timer
        clearInterval(timerInfo.timer);
      }
      this.adaptiveApiTimers.delete(deviceId);
    }
  }

  // Restart adaptive API calling with new interval
  restartAdaptiveApiCalling(deviceId) {
    // Check if device is in cooldown
    if (this.adaptiveApiCooldowns.has(deviceId)) {
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
          
          // Set cooldown to prevent rapid restarts
          this.adaptiveApiCooldowns.set(deviceId, true);
          setTimeout(() => {
            this.adaptiveApiCooldowns.delete(deviceId);
          }, 2000); // 2 second cooldown
          
          // Call startAdaptiveApiCalling immediately instead of using setTimeout
          this.startAdaptiveApiCalling(deviceId);
        } else {
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
  }

  // Update app state and adjust API intervals
  async updateAppState(newState) {
    const oldState = this.appState;
    
    // Prevent infinite loop - only update if state actually changed
    if (oldState === newState) {
      return;
    }
    
    // Prevent recursive calls during state update
    if (this.isUpdatingAppState) {
      return;
    }
    
    this.isUpdatingAppState = true;
    
    try {
      this.appState = newState;
      
      // Adjust API intervals for all connected devices
      if (newState === 'background') {
        // ✅ INDUSTRY STANDARD: Upload all pending buffers before backgrounding
        console.log(`📤 [APP BACKGROUND] Uploading all pending live data buffers...`);
        for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
          if (buffer.length > 0) {
            console.log(`📤 [APP BACKGROUND] Uploading ${buffer.length} pending records for ${deviceId}`);
            await this.uploadLiveBatch(deviceId);
          }
        }
        
        // Switch to native monitoring when app goes to background
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        // Slow down RSSI cycle in background for power saving
        if (this.rssiCycleActive) {
          this.restartRssiCycle(); // Will use profile-based timing
        }
      } else if (newState === 'active') {
        // Switch back to JS timers when app becomes active
        // Also set devices to active if they haven't been explicitly set to inactive
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          const currentScreenState = this.screenActiveStates.get(deviceId);
          if (currentScreenState === undefined) {
            // No screen state set yet - default to active for better UX
            this.screenActiveStates.set(deviceId, true);
          }
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        // Fetch latest data once when app reopens
        this.fetchLatestDataOnAppReopen();
        
        // Trigger pending UI updates for auto-connected devices
        this.triggerPendingUIUpdates();
        
        // Restore normal RSSI cycle when app becomes active
        if (this.connectedDevices.size > 0) {
          this.restartRssiCycle();
        }
      }
    } finally {
      // Always reset the flag
      this.isUpdatingAppState = false;
    }
  }
  
  // Trigger pending UI updates when app comes to foreground
  triggerPendingUIUpdates() {
    if (!this.pendingUIUpdates || this.pendingUIUpdates.size === 0) {
      return;
    }
    
    
    for (const [deviceId, deviceData] of this.pendingUIUpdates) {
      if (this.onDeviceDataUpdated) {
        this.onDeviceDataUpdated(deviceId, deviceData);
      }
    }
    
    // Clear pending updates
    this.pendingUIUpdates.clear();
  }

  // ==================== END ADAPTIVE API CALLING FUNCTIONALITY ====================

  // ==================== GET API FUNCTIONALITY ====================

  // Start GET API calling for active screen (every 15 seconds)
  startGetApiCalling(deviceId) {
    
    // Stop any existing timer first
    this.stopGetApiCalling(deviceId);
    
    // Validate device
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      return false;
    }
    
    if (device.connectionState !== CONNECTION_STATES.CONNECTED) {
      return false;
    }
    
    // Set interval based on power profile
    const interval = this.getApiConfig.ACTIVE_SCREEN_INTERVAL;
    const powerProfileName = this.profile === POWER_PROFILE.lowPower ? 'lowPower' : 
                           this.profile === POWER_PROFILE.ultraLowPower ? 'ultraLowPower' : 'default';
    
    // Create the timer
    const timer = setInterval(async () => {
      
      try {
        // Check if app is in background - don't make API calls in background
        if (this.appState !== 'active') {
          return { success: false, error: 'SMART_TAG service not available' };
        }
        
        // Check if device is still connected
        const currentDevice = this.scannedDevices.get(deviceId);
        if (!currentDevice || currentDevice.connectionState !== CONNECTION_STATES.CONNECTED) {
          this.stopGetApiCalling(deviceId);
          return { success: false, error: 'SMART_TAG service not available' };
        }
        
        // Make the API call
        await this.fetchPetHealthDetails(deviceId);
        
      } catch (error) {
      }
    }, interval);
    
    // Store the timer
    this.getApiTimers.set(deviceId, { timer, interval });
    
    
    return true;
  }

  // Stop GET API calling for a device
  stopGetApiCalling(deviceId) {
    const timerInfo = this.getApiTimers.get(deviceId);
    if (timerInfo && timerInfo.timer) {
      clearInterval(timerInfo.timer);
      this.getApiTimers.delete(deviceId);
    }
  }

  // Stop all GET API timers
  stopAllGetApi() {
    for (const [deviceId, timerInfo] of this.getApiTimers.entries()) {
      this.stopGetApiCalling(deviceId);
    }
    this.getApiTimers.clear();
  }

  // Fetch pet health details from server
  async fetchPetHealthDetails(deviceId) {
    try {
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }

      // Use device's pet ID if available, otherwise use default
      const petId = device.petId || 1059773;
      
      // Make the API call
      const result = await getPetHealthBLEDetails(petId);
      
      if (result.success !== false) {
        
        // Store the fetched data
        if (device.deviceData) {
          device.deviceData.serverData = result;
          device.deviceData.lastServerFetch = new Date();
        }
        
        // Emit event for UI refresh
        this.emit('petHealthDataUpdated', { deviceId, data: result });
        
      } else {
      }
      
    } catch (error) {
    }
  }

  // Fetch latest data when app reopens (called once)
  async fetchLatestDataOnAppReopen() {
    try {
      
      const connectedDevices = Array.from(this.scannedDevices.entries())
        .filter(([deviceId, device]) => device.connectionState === CONNECTION_STATES.CONNECTED);
      
      if (connectedDevices.length === 0) {
        return;
      }
      
      
      for (const [deviceId, device] of connectedDevices) {
        await this.fetchPetHealthDetails(deviceId);
        await new Promise(resolve => setTimeout(resolve, 500)); // Small delay between calls
      }
      
      
    } catch (error) {
    }
  }

  // ==================== PUBLIC METHODS FOR UI ====================

  // Method to manually trigger GET API call for testing
  manualGetApiCall = async (deviceId) => {
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
    this.setScreenActiveState(deviceId, true);
  }

  // Method to manually stop GET API calling for testing
  stopGetApiCallingManual = (deviceId) => {
    this.setScreenActiveState(deviceId, false);
  }

  // Debug method to check GET API status for all devices
  debugGetApiStatus = () => {
    
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      const getApiTimer = this.getApiTimers.get(deviceId);
      const screenActive = this.screenActiveStates.get(deviceId);
      const isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
      
    }
    
    if (this.getApiTimers.size > 0) {
    } else {
    }
  }

  // Force start GET API for all connected devices (for testing)
  forceStartGetApiForAllDevices = () => {
    let startedCount = 0;
    
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        // Set screen active state first, then start GET API
        this.setScreenActiveState(deviceId, true);
        const success = this.startGetApiCalling(deviceId);
        if (success) startedCount++;
      }
    }
    
  }

  // Force stop GET API for all devices (for testing)
  forceStopGetApiForAllDevices = () => {
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
    if (this.phoneBatteryLevel === null) {
      return { success: false, message: 'Phone battery level not available' };
    }

    try {
      
      this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
      
      const newProfile = this.getCurrentProfileName();
      return { 
        success: true, 
        message: `Battery profile adjustment completed. Current profile: ${newProfile}`,
        batteryLevel: this.phoneBatteryLevel,
        currentProfile: newProfile
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Completely forget/remove a device (disconnect + unpair + clear data)
   * 
   * This implements the complete "Forget Device" flow for Smart Tags:
   * 1. Clear App Data - Remove device ID/name from all internal maps
   * 2. Stop Auto-Reconnect - Add to forgotten list to prevent auto-connection
   * 3. Cancel Active Connection - Disconnect if currently connected
   * 4. Remove Bond - Remove from app's bonded list (iOS requires manual OS unpairing)
   * 5. UI Update - Move device from "My Devices" → "Available Devices" list
   * 
   * Manual Reconnect → always possible via fresh scan
   * Auto Connect → only works if device ID is saved + still bonded
   * Bonded Forget → requires OS unpairing (Android possible programmatically, iOS only via Settings)
   */
  async forgetDevice(deviceId) {
    try {
      
      // 1. Get device info before removal
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device?.name || 'Unknown Device';
      
      // 2. Disconnect the device first (if connected)
      if (this.connectedDevices.has(deviceId)) {
        await this.disconnectFromDevice(deviceId);
      }
      
      // 3. Remove from connected devices map
      this.connectedDevices.delete(deviceId);
      
      // 4. Remove from scanned devices map
      this.scannedDevices.delete(deviceId);
      
      // 5. Remove from native side (platform specific)
      if (Platform.OS === 'ios') {
        // iOS: Remove from app's bonded list (OS unpairing must be done manually in Settings)
        try {
          await this.removeDeviceFromBondedList(deviceId);
        } catch (error) {
        }
      } else {
        // Android: Remove from bonded list (native implementation handles unpairing)
        try {
          await AutoConnectService.removeBondedDevice(deviceId);
        } catch (error) {
        }
      }
      
      // 6. Clear all device-related data
      this.clearDeviceData(deviceId);
      
      // 7. Stop any ongoing operations for this device
      this.stopDeviceOperations(deviceId);
      
      // Add disconnection log
      this.addConnectionLog(deviceId, 'Disconnected', { reason: 'forgotten' });
      
      // 8. Emit deviceDisconnected event for UI update (matching iOS behavior)
      // This ensures UI properly updates when device is forgotten
      this.emit('deviceDisconnected', {
        deviceId,
        deviceName,
        reason: 'forgotten',
        forgotten: true
      });
      
      // 9. Trigger UI update
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      return { 
        success: true, 
        message: `Device "${deviceName}" forgotten successfully`,
        deviceId,
        deviceName
      };
      
    } catch (error) {
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
    
  }

  // Cleanup
  // ==================== PUBLIC API FOR AUTO-SYNC IMPROVEMENTS ====================
  
  /**
   * Get auto-sync configuration
   * @returns {Object} Current auto-sync configuration
   */
  getAutoSyncConfiguration() {
    return this.getAutoSyncConfig();
  }
  
  /**
   * Update auto-sync configuration
   * @param {Object} newConfig - Configuration object with any of: debounceDelay, throttleMode, customThrottle, enableFallbackPolling, maxRetries, enableMetrics, enableUserFeedback
   */
  updateAutoSyncConfiguration(newConfig) {
    this.updateAutoSyncConfig(newConfig);
  }
  
  /**
   * Get sync metrics for a device
   * @param {string} deviceId - Device ID
   * @returns {Object|null} Metrics object with successCount, failureCount, averageLatency, successRate, etc.
   */
  getSyncMetricsForDevice(deviceId) {
    return this.getSyncMetrics(deviceId);
  }
  
  /**
   * Get state transition history for a device
   * @param {string} deviceId - Device ID
   * @returns {Array} Array of state transitions with timestamp, from, to, reason
   */
  getStateTransitionHistory(deviceId) {
    return this.stateTransitionHistory?.get(deviceId) || [];
  }
  
  /**
   * Get sync queue status for a device
   * @param {string} deviceId - Device ID
   * @returns {Object} Queue status with queueSize, isProcessing
   */
  getSyncQueueStatus(deviceId) {
    const queue = this.syncQueue?.get(deviceId) || [];
    return {
      queueSize: queue.length,
      isProcessing: this.processingSync?.get(deviceId) || false,
      pendingSyncs: queue.map(s => ({
        timestamp: s.timestamp,
        reason: s.reason
      }))
    };
  }
  
  /**
   * Clear sync queue for a device
   * @param {string} deviceId - Device ID
   */
  clearSyncQueue(deviceId) {
    if (this.syncQueue?.has(deviceId)) {
      this.syncQueue.set(deviceId, []);
      console.log(`🗑️ [SYNC QUEUE] Cleared queue for ${deviceId}`);
    }
  }
  
  /**
   * Reset metrics for a device
   * @param {string} deviceId - Device ID
   */
  resetSyncMetrics(deviceId) {
    if (this.syncMetrics?.has(deviceId)) {
      this.syncMetrics.delete(deviceId);
      console.log(`🔄 [METRICS] Reset metrics for ${deviceId}`);
    }
  }
  
  /**
   * Listen to auto-sync feedback events
   * @param {Function} callback - Callback function that receives { deviceId, type, timestamp, ...data }
   */
  onAutoSyncFeedback(callback) {
    this.on('autoSyncFeedback', callback);
  }
  
  /**
   * Listen to state transition events
   * @param {Function} callback - Callback function that receives { deviceId, timestamp, from, to, reason }
   */
  onStateTransition(callback) {
    this.on('stateTransition', callback);
  }
  
  /**
   * Listen to config update events
   * @param {Function} callback - Callback function that receives updated config
   */
  onAutoSyncConfigUpdated(callback) {
    this.on('autoSyncConfigUpdated', callback);
  }

  destroy() {
    try {
      this.stopScanning();
      this.disconnectAllDevices();
      this.stopPeriodicAutoScan();
      this.stopAllAdaptiveApi();
      
      // Stop all GET API timers
      this.stopAllGetApi();
      
      // Stop RSSI cycle
      this.stopRssiCycle();
      
      // ✅ INDUSTRY STANDARD: Upload all pending buffers before shutdown
      console.log(`🧹 [CLEANUP] Uploading all pending live data buffers before destroy...`);
      for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
        if (buffer.length > 0) {
          console.log(`📤 [CLEANUP] Uploading ${buffer.length} pending records for ${deviceId}`);
          this.uploadLiveBatch(deviceId).catch(err => {
            console.error(`❌ [CLEANUP] Failed to upload buffer for ${deviceId}:`, err);
          });
        }
      }
      
      // Stop all batch upload timers
      for (const timer of this.batchUploadTimers.values()) {
        clearInterval(timer);
      }
      this.batchUploadTimers.clear();
      
      // Clear buffer data
      this.liveDataBuffers.clear();
      this.lastBatchUpload.clear();
      this.historicalSyncComplete.clear();
      
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
      
      // Clear all maps
      this.connectedDevices.clear();
      this.scannedDevices.clear();
      this.manualDisconnectCooldown.clear();
      this.rssiValues.clear();
      this.rssiHistory.clear();
      this.lastRssiUpdate.clear();
      this.screenActiveStates.clear();
      this.knownDeviceIds.clear();
      
      // Remove native event listeners (iOS)
      if (Platform.OS === 'ios' && this.iosEventEmitter) {
        this.iosEventEmitter.removeAllListeners('DeviceFound');
        this.iosEventEmitter.removeAllListeners('DeviceConnected');
        this.iosEventEmitter.removeAllListeners('DeviceDisconnected');
        this.iosEventEmitter.removeAllListeners('ServicesDiscovered');
        this.iosEventEmitter.removeAllListeners('CharacteristicsDiscovered');
        this.iosEventEmitter.removeAllListeners('CharacteristicData');
        this.iosEventEmitter.removeAllListeners('DataTransfer');
        this.iosEventEmitter.removeAllListeners('SystemCommandResponse');
        this.iosEventEmitter.removeAllListeners('RSSIUpdate');
        this.iosEventEmitter.removeAllListeners('ServiceDiscoveryComplete');
      }
      
      // Remove native event listeners (Android)
      if (Platform.OS === 'android') {
        DeviceEventEmitter.removeAllListeners('DeviceFound');
        DeviceEventEmitter.removeAllListeners('ConnectionStateChanged');
        DeviceEventEmitter.removeAllListeners('CharacteristicDataReceived');
        DeviceEventEmitter.removeAllListeners('CharacteristicChanged');
        DeviceEventEmitter.removeAllListeners('CharacteristicData'); // Matching iOS event name
        DeviceEventEmitter.removeAllListeners('DeviceDataUpdated');
        DeviceEventEmitter.removeAllListeners('HealthDataApiRequest');
        DeviceEventEmitter.removeAllListeners('SystemCommandEvent');
        DeviceEventEmitter.removeAllListeners('SystemCommandResponse'); // Matching iOS event name
        DeviceEventEmitter.removeAllListeners('DataTransferEvent');
        DeviceEventEmitter.removeAllListeners('DataTransfer'); // Matching iOS event name
        DeviceEventEmitter.removeAllListeners('ServiceDiscoveryComplete');
        DeviceEventEmitter.removeAllListeners('ServicesDiscovered');
        DeviceEventEmitter.removeAllListeners('RSSIUpdated');
        DeviceEventEmitter.removeAllListeners('RSSIUpdate'); // Matching iOS event name
        DeviceEventEmitter.removeAllListeners('ScanStateChanged');
        DeviceEventEmitter.removeAllListeners('DeviceDisconnected');
        DeviceEventEmitter.removeAllListeners('DeviceReconnected');
        DeviceEventEmitter.removeAllListeners('DeviceConnected');
      }
      
      console.log('✅ [BLE SERVICE] Cleanup complete');
      
    } catch (error) {
      console.error('❌ [BLE SERVICE] Error during cleanup:', error);
    }
  }
  
  // MARK: - DFU (Device Firmware Update) / OTA Methods
  
  /**
   * Enter DFU Mode - sends 0x0A command to device
   * Device will reboot into DFU bootloader
   */
  async enterDFUMode(deviceId) {
    try {
      console.log('🔧 [DFU] Entering DFU mode for device:', deviceId);
      
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.enterDFUMode(deviceId);
      } else {
        result = await BridgingCodeModule.enterDFUMode(deviceId);
      }
      
      console.log('✅ [DFU] Enter DFU mode result:', result);
      return result;
      
    } catch (error) {
      console.error('❌ [DFU] Error entering DFU mode:', error);
      throw error;
    }
  }
  
  /**
   * Start DFU process
   * @param {string} deviceId - Device ID (UUID for iOS, MAC for Android)
   * @param {string} firmwarePath - Path to .zip firmware file
   * @param {object} callbacks - { onProgress, onStateChange, onError, onComplete, onAborted }
   */
  async startDFU(deviceId, firmwarePath, callbacks = {}) {
    try {
      console.log('🚀 [DFU] Starting DFU process');
      console.log('   Device:', deviceId);
      console.log('   Firmware:', firmwarePath);
      
      // Setup event listeners for callbacks
      if (callbacks.onProgress) {
        this.on('DFUProgress', callbacks.onProgress);
      }
      
      if (callbacks.onStateChange) {
        this.on('DFUStateChanged', callbacks.onStateChange);
      }
      
      if (callbacks.onError) {
        this.on('DFUError', callbacks.onError);
      }
      
      if (callbacks.onComplete) {
        this.on('DFUCompleted', callbacks.onComplete);
      }
      
      if (callbacks.onAborted) {
        this.on('DFUAborted', callbacks.onAborted);
      }
      
      // Start DFU
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.startDFU(deviceId, firmwarePath);
      } else {
        result = await BridgingCodeModule.startDFU(deviceId, firmwarePath);
      }
      
      console.log('✅ [DFU] DFU process started:', result);
      return result;
      
    } catch (error) {
      console.error('❌ [DFU] Error starting DFU:', error);
      throw error;
    }
  }
  
  /**
   * Cancel ongoing DFU process
   */
  async cancelDFU() {
    try {
      console.log('🛑 [DFU] Cancelling DFU');
      
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.cancelDFU();
      } else {
        result = await BridgingCodeModule.cancelDFU();
      }
      
      // Remove all DFU event listeners
      this.removeAllListeners('DFUProgress');
      this.removeAllListeners('DFUStateChanged');
      this.removeAllListeners('DFUError');
      this.removeAllListeners('DFUCompleted');
      this.removeAllListeners('DFUAborted');
      
      console.log('✅ [DFU] DFU cancelled:', result);
      return result;
      
    } catch (error) {
      console.error('❌ [DFU] Error cancelling DFU:', error);
      throw error;
    }
  }
  
  /**
   * Check if device is in DFU mode
   * @param {string} deviceId 
   */
  async isDeviceInDFUMode(deviceId) {
    try {
      let isInDFU;
      if (Platform.OS === 'android') {
        isInDFU = await SampleBridgeAndroid.isDeviceInDFUMode(deviceId);
      } else {
        isInDFU = await BridgingCodeModule.isDeviceInDFUMode(deviceId);
      }
      
      console.log(`ℹ️ [DFU] Device ${deviceId} in DFU mode:`, isInDFU);
      return isInDFU;
    } catch (error) {
      console.error('❌ [DFU] Error checking DFU mode:', error);
      return false;
    }
  }
  
  /**
   * Get DFU service UUID
   */
  async getDFUServiceUUID() {
    try {
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.getDFUServiceUUID();
      } else {
        result = await BridgingCodeModule.getDFUServiceUUID();
      }
      
      return result.uuid;
    } catch (error) {
      console.error('❌ [DFU] Error getting DFU UUID:', error);
      // Return default Nordic DFU UUID
      return '00001530-1212-efde-1523-785feabcd123';
    }
  }
  
  /**
   * Download firmware from server
   * @param {string} firmwareVersion - Version to download
   * @param {string} serverUrl - Base URL of firmware server
   * @returns {string} Local file path
   */
  async downloadFirmware(firmwareVersion, serverUrl = 'https://your-server.com/firmware') {
    try {
      const RNFS = require('react-native-fs');
      
      const firmwareUrl = `${serverUrl}/${firmwareVersion}/firmware.zip`;
      const localPath = `${RNFS.DocumentDirectoryPath}/firmware_${firmwareVersion}.zip`;
      
      console.log('📥 [DFU] Downloading firmware from:', firmwareUrl);
      
      // Check if firmware already exists
      const exists = await RNFS.exists(localPath);
      if (exists) {
        console.log('ℹ️ [DFU] Firmware already downloaded:', localPath);
        return localPath;
      }
      
      // Download firmware
      const downloadResult = await RNFS.downloadFile({
        fromUrl: firmwareUrl,
        toFile: localPath,
        background: true,
        progressDivider: 10,
        begin: (res) => {
          console.log('📥 [DFU] Download started, size:', res.contentLength);
        },
        progress: (res) => {
          const progress = (res.bytesWritten / res.contentLength) * 100;
          console.log(`📥 [DFU] Download progress: ${progress.toFixed(2)}%`);
        }
      }).promise;
      
      if (downloadResult.statusCode === 200) {
        console.log('✅ [DFU] Firmware downloaded to:', localPath);
        return Platform.OS === 'ios' ? `file://${localPath}` : `file://${localPath}`;
      } else {
        throw new Error(`Download failed with status: ${downloadResult.statusCode}`);
      }
      
    } catch (error) {
      console.error('❌ [DFU] Error downloading firmware:', error);
      throw error;
    }
  }
  
  /**
   * Check for firmware updates
   * @param {string} deviceId 
   * @param {string} currentVersion 
   * @returns {object} { updateAvailable: boolean, latestVersion: string, ...}
   */
  async checkForFirmwareUpdate(deviceId, currentVersion) {
    try {
      console.log('🔍 [DFU] Checking for updates...');
      console.log('   Device:', deviceId);
      console.log('   Current version:', currentVersion);
      
      // 🧪 MOCK RESPONSE FOR TESTING (Remove when backend is ready)
      const MOCK_MODE = true; // Set to false when real backend is available
      
      if (MOCK_MODE) {
        console.log('🧪 [DFU] Using MOCK response (no backend yet)');
        
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock response - shows update available
        return {
          updateAvailable: true,
          latestVersion: '2.0.0',
          releaseNotes: '• Fixed battery drain issue\n• Improved step counting accuracy\n• Enhanced BLE stability',
          critical: false,
          downloadUrl: 'https://your-server.com/firmware/2.0.0/firmware.zip'
        };
      }
      
      // Call your backend API (when ready)
      const response = await fetch('https://your-api.com/firmware/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceId,
          currentVersion,
          deviceType: 'smart_health_tag',
          platform: Platform.OS
        })
      });
      
      const data = await response.json();
      
      console.log('✅ [DFU] Update check result:', data);
      
      return {
        updateAvailable: data.updateAvailable || false,
        latestVersion: data.latestVersion || currentVersion,
        releaseNotes: data.releaseNotes || '',
        critical: data.critical || false,
        downloadUrl: data.downloadUrl || null
      };
      
    } catch (error) {
      console.error('❌ [DFU] Error checking for updates:', error);
      return {
        updateAvailable: false,
        latestVersion: currentVersion,
        releaseNotes: '',
        critical: false,
        downloadUrl: null
      };
    }
  }
  
  /**
   * Perform complete DFU update flow
   * @param {string} deviceId 
   * @param {string} firmwareVersion 
   * @param {object} callbacks 
   */
  async performFirmwareUpdate(deviceId, firmwareVersion, callbacks = {}) {
    try {
      console.log('🚀 [DFU] Starting complete firmware update flow');
      
      // Step 1: Download firmware
      if (callbacks.onDownloadStart) {
        callbacks.onDownloadStart();
      }
      
      const firmwarePath = await this.downloadFirmware(firmwareVersion);
      
      if (callbacks.onDownloadComplete) {
        callbacks.onDownloadComplete(firmwarePath);
      }
      
      // Step 2: Enter DFU mode
      if (callbacks.onEnteringDFU) {
        callbacks.onEnteringDFU();
      }
      
      await this.enterDFUMode(deviceId);
      
      // Step 3: Wait for device to reboot into DFU mode
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Step 4: Start DFU transfer
      const result = await this.startDFU(deviceId, firmwarePath, callbacks);
      
      return result;
      
    } catch (error) {
      console.error('❌ [DFU] Complete update flow error:', error);
      throw error;
    }
  }
}

// Export singleton instance
export default new BLEService();

