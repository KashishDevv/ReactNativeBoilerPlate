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
  ERROR_TYPES,
  DEMO_TAG_CONFIG
} from '../../constants/BLEConstants';
import BLEDataParser from '../../utils/BLEDataParser';
import BLEPermissions from '../../utils/BLEPermissions';
import AutoConnectService from '../AutoConnectService';
import { postPetHealthBLEData, getPetHealthBLEDetails } from '../../utils/apiConfig';
import { Alert, Platform, PermissionsAndroid, AppState } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { store } from '../../feature/Store';
import { addRecord, addRecords } from '../../feature/historicalRecordsSlice/historicalRecordsSlice';
import { addLog, clearDeviceLogs } from '../../feature/connectionLogsSlice/connectionLogsSlice';
// DemoTag: Import DemoTagSimulator
import DemoTagSimulator from './DemoTagSimulator';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Import native modules
const { SampleBridgeAndroid, BridgingCodeModule } = NativeModules;

class BLEService {
  constructor() {
    // Custom event emitter implementation for React Native
    this.events = {};
    
    // Minimal GATT operation queue to serialize BLE ops
    this.operationQueue = Promise.resolve();
    this.connectedDevices = new Map();
    this.scannedDevices = new Map();
    this.deviceDataStore = new Map(); // DemoTag: Store device data for demo and real devices
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
    this.isRefreshingSystemDevices = false; // Guard flag to prevent concurrent system device refresh calls
    this.lastSystemRefreshTime = 0; // Track last refresh time to prevent rapid successive calls
    this.healthCheckFailures = new Map(); // Track consecutive health check failures per device (deviceId -> failureCount)
    this.profile = POWER_PROFILE?.default || { healthCheckMs: 10000, healthRssiEveryNTicks: 3, scanMode: 'LowLatency', rssiCycleIntervalMs: 30000, rssiCycleDurationMs: 3000, pruneIntervalMs: 300000, pruneAgeMs: 600000 };
    this.healthTick = 0;
    this.pruneTimer = null;
    this.debouncedListUpdate = null;
    this.knownDeviceIds = new Set();
    this.recentAutoConnects = new Map(); // Track auto-connect timestamps for deduping
    this.pendingConnectedLogTimers = new Map(); // deviceId -> timeout for delayed Connected log
    this.pendingManualConnects = new Map(); // deviceId -> timestamp of manual connect attempts
    
    // ✅ FIX ISSUE #1: Connection state management to prevent connection loops
    this.connectionStateDebounce = new Map(); // deviceId -> { lastDisconnectTime, disconnectCount, isDebouncing }
    this.CONNECTION_DEBOUNCE_WINDOW_MS = 5000; // 5 seconds debounce window
    this.MAX_DISCONNECTS_PER_WINDOW = 10; // Max 10 disconnects in 5 seconds before blocking
    this.CONNECTION_BLOCK_DURATION_MS = 30000; // Block reconnection for 30 seconds if too many disconnects
    
    // ✅ FIX ISSUE #3: Incomplete Data Synchronization - Sync retry and validation
    this.syncExpectedRecords = new Map(); // deviceId -> expected record count from device status
    this.syncTimeouts = new Map(); // deviceId -> timeout timer
    this.SYNC_TIMEOUT_MS = 120000; // 2 minutes timeout for sync operations
    this.syncRetryDelays = new Map(); // deviceId -> current retry delay (exponential backoff)
    this.MAX_SYNC_RETRIES = 3; // Maximum retry attempts for incomplete syncs
    
    // ✅ FIX ISSUE #4: Duplicate Command Execution - Command deduplication
    this.pendingCommands = new Map(); // deviceId -> Map<commandId, { timestamp, promise }>
    this.commandDedupeWindow = 2000; // 2 seconds window to prevent duplicate commands
    this.commandQueue = new Map(); // deviceId -> Array of queued commands
    this.commandInProgress = new Map(); // deviceId -> commandId currently executing
    
    // ✅ FIX ISSUE #5: Missing Response Validation - Response waiting
    this.pendingCommandResponses = new Map(); // deviceId -> Map<commandId, { promise, timeout, timestamp }>
    this.COMMAND_RESPONSE_TIMEOUT_MS = 10000; // 10 seconds timeout for command responses
    
    // ✅ FIX ISSUE #10: Missing Error Handling - Error tracking
    this.errorContexts = new Map(); // deviceId -> Array of error contexts
    this.maxErrorHistory = 50; // Keep last 50 errors per device

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
    this.pendingFlashClearCommands = new Map(); // Track DATA_SYNC_STOP commands with clearFlashData=true (deviceId -> clearFlashData)
    this.autoSyncTimers = new Map(); // Debounce timers for auto-sync triggers (deviceId -> timer)
    this.autoSyncMeta = new Map(); // Track auto-sync metadata (lastRecordCount, lastSyncAt, lastSyncCompletedAt)
    this.manualReadTimestamps = new Map(); // Track when we do manual reads (deviceId -> timestamp) to distinguish from live notifications
    
    // ✅ FIX: Notification and timer deduplication
    this.lastNotificationData = new Map(); // Track last notification to prevent duplicates (deviceId -> { recordCount, timestamp })
    this.lastTimerReset = new Map(); // Track last timer reset time (deviceId -> timestamp)
    this.timerResetDebounceWindow = 500; // Minimum 500ms between timer resets
    this.notificationDedupeWindow = 100; // Ignore duplicate notifications within 100ms
    
    // ✅ FIX: Service/Characteristic discovery log deduplication and batching
    this.lastServiceDiscoveryLog = new Map(); // Track last service discovery log (deviceId -> { timestamp, serviceCount })
    this.lastCharacteristicsDiscoveryLog = new Map(); // Track last characteristics discovery log (deviceId -> Map<serviceUuid, { timestamp, characteristicCount }>)
    this.discoveryLogDedupeWindow = 2000; // Prevent duplicate logs within 2 seconds
    this.pendingCharacteristicsLogs = new Map(); // Batch characteristics discoveries (deviceId -> Array of pending logs)
    this.characteristicsLogBatchWindow = 200; // Batch characteristics discoveries within 200ms
    this.characteristicsLogBatchTimers = new Map(); // Timers for batching characteristics logs
    
    // ✅ FIX: Android-specific deduplication (matching iOS behavior)
    this.lastConnectedLogs = new Map(); // Track last "Connected" log (deviceId -> { timestamp })
    this.lastRecordSyncedLogs = new Map(); // Track last "Records Synced" log (deviceId -> { timestamp, recordCount })
    this.lastRTCReadLogs = new Map(); // Track last "RTC Check: Reading Device Status Characteristic" log (deviceId -> { timestamp })
    this.lastCommandResponseLogs = new Map(); // Track last command/response logs (deviceId -> Map<commandId, { timestamp, commandHex }>)
    
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
      fast: 29000,    // 15s when records accumulating quickly (>2 records/30s)
      normal: 29000,  // 29s normal mode (1-2 records/30s) - slightly less than 30s to allow earlier sync
      slow: 59000     // 60s when records accumulating slowly (<1 record/30s)
    };
    
    // 5. Fallback Polling
    this.lastNotificationTime = new Map(); // deviceId -> timestamp of last notification
    this.fallbackPollingTimers = new Map(); // deviceId -> polling timer
    this.fallbackPollingInterval = 120000; // 2 minutes
    
    // 6. Configuration
    this.autoSyncConfig = {
      debounceDelay: 0,          // No delay - we have deduplication and throttling already
      throttleMode: 'adaptive',   // 'adaptive', 'fast', 'normal', 'slow', 'custom'
      customThrottle: 29000,      // Custom throttle time (ms)
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

    // Initialize platform-specific BLE managers after maps are ready
    if (Platform.OS === 'ios') {
      this.manager = null; // Native bridge handles BLE
      this.setupIOSEventListeners();
    } else {
      this.manager = null; // Native bridge handles BLE
      this.setupAndroidEventListeners();
    }

    // DemoTag: Initialize demo tag mode from storage
    this.initDemoTagMode();

    this.init();

    // Setup auto-connect callbacks after initialization
    this.setupAutoConnectCallbacks();

    // Auto-scan for bonded devices on startup (iOS only)
    this.checkAndStartAutoScan();
  }

  /**
   * DemoTag: Initialize demo tag mode from AsyncStorage
   */
  async initDemoTagMode() {
    try {
      const enabled = await AsyncStorage.getItem(DEMO_TAG_CONFIG.ENABLED_STORAGE_KEY);
      if (enabled === 'true') {
        DemoTagSimulator.setEnabled(true);
        
        // ✅ Set up callback for polling interval changes
        DemoTagSimulator.setPollingIntervalCallback((deviceId, intervalSeconds) => {
          console.log(`🏷️ DemoTag: Polling interval changed to ${intervalSeconds}s for ${deviceId}, restarting polling...`);
          // Restart polling with new interval
          const device = this.scannedDevices.get(deviceId);
          if (device && device.isDemoTag && device.connectionState === CONNECTION_STATES.CONNECTED) {
            console.log(`🏷️ DemoTag: Restarting polling for ${deviceId} with new interval ${intervalSeconds}s`);
            // ✅ CRITICAL FIX: Stop polling first to clear the active flag, then start with new interval
            // This prevents "Polling already active, skipping duplicate start" error
            this.stopDemoDevicePolling(deviceId);
            // ✅ CRITICAL: Use the passed interval directly instead of calling getPollingInterval
            // This ensures we use the exact interval that was just set
            this.startDemoDevicePolling(deviceId, intervalSeconds * 1000);
            
            // ✅ FIX: Also restart notifications with new interval to keep them in sync
            const notificationInterval = intervalSeconds * 1000;
            DemoTagSimulator.stopNotifications(deviceId);
            DemoTagSimulator.startNotifications(deviceId, (notification) => {
              this.handleDemoCharacteristicNotification(deviceId, notification);
            }, notificationInterval);
            console.log(`🏷️ DemoTag: Restarted notifications for ${deviceId} with new interval ${intervalSeconds}s`);
          } else {
            console.warn(`🏷️ DemoTag: Cannot restart polling - device not found or not connected:`, {
              deviceId,
              deviceExists: !!device,
              isDemoTag: device?.isDemoTag,
              connectionState: device?.connectionState
            });
          }
        });
        
        // DemoTag: Create default demo device if enabled
        this.createDefaultDemoDevice();
      }
    } catch (error) {
      console.warn('🏷️ DemoTag: Could not load demo mode state:', error);
    }
  }

  /**
   * DemoTag: Create default demo device
   */
  createDefaultDemoDevice() {
    if (!DemoTagSimulator.isDemoModeEnabled()) return;
    
    const demoDevice = DemoTagSimulator.createDemoDevice(
      DEMO_TAG_CONFIG.DEFAULT_DEVICE_ID,
      DEMO_TAG_CONFIG.DEFAULT_DEVICE_NAME
    );
    
    // DemoTag: Add to scanned devices so it appears in the list
    this.scannedDevices.set(demoDevice.id, {
      ...demoDevice,
      lastSeen: Date.now(),
      serviceUUIDs: [BLE_SERVICES.SMART_TAG],
      isDemoTag: true,
    });
    
    console.log('🏷️ DemoTag: Default demo device created');
  }

  /**
   * DemoTag: Enable/disable demo mode
   */
  async setDemoModeEnabled(enabled) {
    try {
      await AsyncStorage.setItem(DEMO_TAG_CONFIG.ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
      DemoTagSimulator.setEnabled(enabled);
      
      if (enabled) {
        // DemoTag: Create default demo device
        this.createDefaultDemoDevice();
        // DemoTag: Trigger device list update
        this.scheduleListUpdate();
      } else {
        // DemoTag: Remove demo devices from scanned devices
        const demoDeviceIds = Array.from(this.scannedDevices.entries())
          .filter(([id, device]) => device.isDemoTag)
          .map(([id]) => id);
        
        demoDeviceIds.forEach(id => {
          this.scannedDevices.delete(id);
          this.connectedDevices.delete(id);
        });
        
        // DemoTag: Cleanup simulator
        DemoTagSimulator.cleanup();
        // DemoTag: Trigger device list update
        this.scheduleListUpdate();
      }
      
      return true;
    } catch (error) {
      console.error('🏷️ DemoTag: Error setting demo mode:', error);
      return false;
    }
  }

  /**
   * DemoTag: Check if demo mode is enabled
   */
  isDemoModeEnabled() {
    return DemoTagSimulator.isDemoModeEnabled();
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
    
    // ✅ Listen for native command sent events (for connection log tracking)
    this.iosEventEmitter.addListener('NativeCommandSent', (eventData) => {
      this.handleNativeCommandSent(eventData);
    });
    
    // ✅ Listen for RTC read events (for connection log tracking)
    this.iosEventEmitter.addListener('RTCRead', (eventData) => {
      this.handleRTCRead(eventData);
    });
    
    // ✅ Listen for polling started events (for connection log tracking)
    this.iosEventEmitter.addListener('PollingStarted', (eventData) => {
      this.handlePollingStarted(eventData);
    });
    
    // RSSI update event
    this.iosEventEmitter.addListener('RSSIUpdate', (eventData) => {
      this.handleIOSRSSIUpdate(eventData);
    });
    
    // Auto-connect events (use auto handlers so we log auto-connect once and set dedupe guard)
    this.iosEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
      this.handleAutoConnectedDevice(deviceInfo);
    });
    
    this.iosEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
      this.handleAutoDisconnectedDevice(deviceInfo);
    });
    
    this.iosEventEmitter.addListener('DFUProgress', (eventData) => {
      this.emit('DFUProgress', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUStateChanged', (eventData) => {
      this.emit('DFUStateChanged', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUCompleted', (eventData) => {
      this.emit('DFUCompleted', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUAborted', (eventData) => {
      this.emit('DFUAborted', eventData);
    });
    
    this.iosEventEmitter.addListener('DFUError', (eventData) => {
      console.error('DFU Error:', eventData);
      this.emit('DFUError', eventData);
    });

    this.iosEventEmitter.addListener('DeviceDataUpdated', (event) => {
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error('Error in handleDeviceDataUpdated:', error);
      }
    });
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

    DeviceEventEmitter.addListener('DeviceDataUpdated', (event) => {
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error('Error in handleDeviceDataUpdated:', error);
      }
    });

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
    
    // ✅ Listen for native command sent events (for connection log tracking)
    DeviceEventEmitter.addListener('NativeCommandSent', (eventData) => {
      this.handleNativeCommandSent(eventData);
    });
    
    // ✅ Listen for RTC read events (for connection log tracking)
    DeviceEventEmitter.addListener('RTCRead', (eventData) => {
      this.handleRTCRead(eventData);
    });
    
    // ✅ Listen for polling started events (for connection log tracking)
    DeviceEventEmitter.addListener('PollingStarted', (eventData) => {
      this.handlePollingStarted(eventData);
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
    
    DeviceEventEmitter.addListener('DFUProgress', (eventData) => {
      this.emit('DFUProgress', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUStateChanged', (eventData) => {
      this.emit('DFUStateChanged', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUCompleted', (eventData) => {
      this.emit('DFUCompleted', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUAborted', (eventData) => {
      this.emit('DFUAborted', eventData);
    });
    
    DeviceEventEmitter.addListener('DFUError', (eventData) => {
      console.error('DFU Error:', eventData);
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
    
    // Android: rehydrate any system-level connections the app missed while backgrounded/cold
    // Delay until BLE is ready to avoid race conditions with native auto-connect initialization
    if (Platform.OS === 'android') {
      this.isBLEReady().then(ready => {
        if (ready) {
          // Small delay to let native auto-connect initialize first (it also calls querySystemConnectedDevices)
          // This ensures our refresh only picks up devices that auto-connect missed
          setTimeout(() => {
            this.refreshAndroidSystemConnectedDevices();
          }, 1000); // 1 second delay to let native initialization complete
        } else {
          console.log('⏭️ [INIT] BLE not ready, skipping system device refresh');
        }
      }).catch(error => {
        console.warn('⚠️ [INIT] Could not check BLE ready state:', error?.message || error);
      });
    }

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
      
      this.scannedDevices.forEach((device, deviceId) => {
        if (device.syncRecords && device.syncRecords.length > 0) {
          store.dispatch(addRecords({ deviceId, records: device.syncRecords }));
        }
      });
    } catch (error) {
      console.error('Failed to sync existing records to Redux:', error);
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
      
    } catch (error) {
      console.error(`❌ [IMMEDIATE ALERT] Failed to send:`, error);
    }
  }

  /**
   * Send historical records after data sync complete
   */
  async sendHistoricalRecords(deviceId, records) {
    if (!records || records.length === 0) {
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
    
    
    const timer = setInterval(() => {
      if (this.shouldUploadBatch(deviceId)) {
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
    
    // ✅ FIX ISSUE #1: Reset connection debounce state on successful connection
    const debounceState = this.connectionStateDebounce.get(deviceId);
    if (debounceState) {
      debounceState.disconnectCount = 0;
      debounceState.isDebouncing = false;
      debounceState.blockedUntil = 0;
      this.connectionStateDebounce.set(deviceId, debounceState);
    }
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
    
    const now = Date.now();
    const manualTs = this.pendingManualConnects.get(deviceId);
    const isManual = manualTs && (now - manualTs) < 15000; // 15s window to treat as manual

    if (isManual) {
      this.pendingManualConnects.delete(deviceId);
      if (this.onDeviceListUpdated) this.onDeviceListUpdated();
      this.emit('deviceConnected', device);
      this.addConnectionLog(deviceId, 'Connected');
      return;
    }

    // Treat as auto-connect: log Auto-connected and suppress Connected
    this.recentAutoConnects.set(deviceId, now);
    const existingTimer = this.pendingConnectedLogTimers.get(deviceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.pendingConnectedLogTimers.delete(deviceId);
    }
    if (this.onDeviceListUpdated) this.onDeviceListUpdated();
    this.emit('deviceConnected', device);
    this.addConnectionLog(deviceId, 'Auto-connected', {
      connectionType: 'auto',
      platform: Platform.OS
    });
  }

  handleIOSDeviceDisconnected(deviceInfo) {
    
    const deviceId = deviceInfo.deviceId;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.disconnectedAt = new Date();
      device.lastSeen = Date.now();
      
      if (deviceInfo.reason === 'passkey_changed' || deviceInfo.passkeyChanged) {
        device.requiresRepairing = true;
        device.passkeyChanged = true;
        device.needsSystemForget = true;
      }
      
      if (deviceInfo.reason === 'unpaired' || deviceInfo.unpaired) {
        device.unpaired = true;
      }
      
      this.scannedDevices.set(deviceId, device);
      this.connectedDevices.delete(deviceId);
      
      // Trigger device list update callback
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      
      // ✅ FIX ISSUE #10: Add disconnection log with error code
      this.addConnectionLog(deviceId, 'Disconnected', {
        reason: deviceInfo.reason || 'unknown',
        errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
        error: deviceInfo.error || null
      });
      
      // ✅ FIX ISSUE #10: Log error context
      if (deviceInfo.reason || deviceInfo.error) {
        this.logError(deviceId, 'DISCONNECTION', {
          reason: deviceInfo.reason || 'unknown',
          errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
          error: deviceInfo.error || null
        });
      }
      
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
      
      // ✅ Log service discovery to connection logs (with deduplication and service names)
      const now = Date.now();
      const lastLog = this.lastServiceDiscoveryLog.get(deviceId);
      const shouldLog = !lastLog || 
                       (now - lastLog.timestamp) > this.discoveryLogDedupeWindow ||
                       lastLog.serviceCount !== newServices.length ||
                       lastLog.addedCount !== addedServiceCount ||
                       lastLog.isComplete !== (eventData.complete || false);
      
      if (shouldLog) {
        // Get service names for better readability
        const serviceNames = newServices.map(s => {
          const serviceType = this.getServiceType(s.uuid);
          return serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
            .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize first letter of each word
        });
        
      const serviceUuids = newServices.map(s => s.uuid);
        const serviceList = serviceNames.join(', ');
        
        // Create log message with service names
        const logMessage = serviceNames.length > 0 
          ? `Services Discovered (${serviceList})`
          : 'Services Discovered';
        
        this.addConnectionLog(deviceId, logMessage, {
        serviceCount: newServices.length,
        addedCount: addedServiceCount,
        duplicateCount: duplicateServiceCount,
          serviceNames: serviceNames,
        serviceUuids: serviceUuids,
        isComplete: eventData.complete || false,
        platform: 'iOS'
      });
        
        // Update last log timestamp
        this.lastServiceDiscoveryLog.set(deviceId, {
          timestamp: now,
          serviceCount: newServices.length,
          addedCount: addedServiceCount,
          isComplete: eventData.complete || false
        });
      }
      
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
      
      // ✅ Log characteristics discovery to connection logs (with deduplication, batching, and service names)
      const now = Date.now();
      if (!this.lastCharacteristicsDiscoveryLog.has(deviceId)) {
        this.lastCharacteristicsDiscoveryLog.set(deviceId, new Map());
      }
      const deviceCharLogs = this.lastCharacteristicsDiscoveryLog.get(deviceId);
      const lastLog = deviceCharLogs.get(eventData.serviceUuid);
      const shouldLog = !lastLog || 
                       (now - lastLog.timestamp) > this.discoveryLogDedupeWindow ||
                       lastLog.characteristicCount !== newCharacteristics.length ||
                       lastLog.addedCount !== addedCount;
      
      if (shouldLog) {
        // Get service name for better readability
        const serviceType = this.getServiceType(eventData.serviceUuid);
        const serviceName = serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize first letter of each word
        
        // Initialize pending logs array if it doesn't exist
        if (!this.pendingCharacteristicsLogs.has(deviceId)) {
          this.pendingCharacteristicsLogs.set(deviceId, []);
        }
        
        // Add to pending logs
        const pendingLogs = this.pendingCharacteristicsLogs.get(deviceId);
        pendingLogs.push({
        serviceUuid: eventData.serviceUuid,
          serviceName: serviceName,
        characteristicCount: newCharacteristics.length,
        addedCount: addedCount,
        duplicateCount: duplicateCount,
          timestamp: now
        });
        
        // Clear existing timer if any
        const existingTimer = this.characteristicsLogBatchTimers.get(deviceId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        
        // Set a timer to batch log after a short delay
        const batchTimer = setTimeout(() => {
          const pending = this.pendingCharacteristicsLogs.get(deviceId) || [];
          if (pending.length > 0) {
            // If multiple services discovered within batch window, log them together
            if (pending.length > 1) {
              const serviceNames = pending.map(p => p.serviceName).join(', ');
              const totalCharacteristics = pending.reduce((sum, p) => sum + p.characteristicCount, 0);
              const totalAdded = pending.reduce((sum, p) => sum + p.addedCount, 0);
              
              this.addConnectionLog(deviceId, `Characteristics Discovered (${pending.length} services: ${serviceNames})`, {
                serviceCount: pending.length,
                totalCharacteristicCount: totalCharacteristics,
                totalAddedCount: totalAdded,
                services: pending.map(p => ({
                  serviceName: p.serviceName,
                  serviceUuid: p.serviceUuid,
                  characteristicCount: p.characteristicCount,
                  addedCount: p.addedCount
                })),
        platform: 'iOS'
      });
            } else {
              // Single service - log individually with service name
              const log = pending[0];
              this.addConnectionLog(deviceId, `Characteristics Discovered (${log.serviceName})`, {
                serviceUuid: log.serviceUuid,
                serviceName: log.serviceName,
                characteristicCount: log.characteristicCount,
                addedCount: log.addedCount,
                duplicateCount: log.duplicateCount,
                platform: 'iOS'
              });
            }
            
            // Update last log timestamps for all services in batch
            pending.forEach(log => {
              deviceCharLogs.set(log.serviceUuid, {
                timestamp: log.timestamp,
                characteristicCount: log.characteristicCount,
                addedCount: log.addedCount
              });
            });
            
            // Clear pending logs
            this.pendingCharacteristicsLogs.delete(deviceId);
          }
          
          // Clear timer
          this.characteristicsLogBatchTimers.delete(deviceId);
        }, this.characteristicsLogBatchWindow);
        
        this.characteristicsLogBatchTimers.set(deviceId, batchTimer);
      }
      
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
      const previousRssi = device.rssi;
      device.rssi = eventData.rssi;
      this.scannedDevices.set(deviceId, device);
      
      // ✅ Log RSSI update to connection logs
      this.addConnectionLog(deviceId, 'RSSI Update', {
        rssi: eventData.rssi,
        previousRssi: previousRssi || null,
        platform: 'iOS'
      });
      
      // Emit RSSI update event
      this.emit('rssiUpdate', { deviceId, rssi: eventData.rssi });
    }
  }

  // ✅ NEW: Handle service discovery complete - triggers native command sequence
  handleServiceDiscoveryComplete = async (eventData) => {
    const { deviceId, hasSystemCommand, hasDeviceStatus, hasDataTransfer } = eventData;
    
    
    // 🔒 MUTEX: Check if already running
    if (this.requestDataMutex.get(deviceId)) {
      return;
    }
    
    // ✅ CRITICAL FIX: Check if sync is already in progress or recently completed before starting a new one
    // This prevents duplicate sync operations when ServiceDiscoveryComplete is received multiple times
    const syncState = this.dataSyncStates?.get(deviceId);
    const currentSyncState = syncState?.state;
    
    // Check if sync is actively in progress
    if (currentSyncState === 'syncing' || currentSyncState === 'time_syncing' || currentSyncState === 'ready') {
      return;
    }
    
    // ✅ CRITICAL FIX: Also check if sync was recently completed (within last 5 seconds)
    // This prevents starting a new sync immediately after the previous one completes
    if (this.autoSyncMeta) {
      const meta = this.autoSyncMeta.get(deviceId);
      if (meta?.lastSyncCompletedAt) {
        const timeSinceLastSync = Date.now() - meta.lastSyncCompletedAt;
        if (timeSinceLastSync < 5000) { // Within 5 seconds
          return;
        }
      }
    }
    
    // Set mutex
    this.requestDataMutex.set(deviceId, true);
    
    try {
      // Only start command sequence if device has system command characteristic
      if (hasSystemCommand) {
        // ✅ DEMO TAG FIX: Check if device is a demo tag before calling native bridge
        const device = this.connectedDevices.get(deviceId);
        const isDemoTag = device?.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
        
        if (isDemoTag) {
          // DemoTag: Handle command sequence in JavaScript
          // For demo tags, we don't need to call native bridge
          // The demo tag simulator handles everything in JavaScript
          console.log(`🏷️ DemoTag: Skipping native command sequence for ${deviceId} (handled in JS)`);
          
          // DemoTag: Read device status to get RTC validity (simulated)
          // The demo tag already has valid RTC, so we can proceed with data sync if needed
          setTimeout(() => {
            // DemoTag: Auto-sync will be triggered by polling if conditions are met
            // No need to manually trigger sync here for demo tags
          }, 1000);
        } else {
          // ✅ Log that Device Status will be read for RTC check (with deduplication)
          const now = Date.now();
          const lastRTCLog = this.lastRTCReadLogs.get(deviceId);
          const shouldLogRTC = !lastRTCLog || (now - lastRTCLog.timestamp) > 1000; // Prevent duplicates within 1 second
          
          if (shouldLogRTC) {
            this.addConnectionLog(deviceId, 'RTC Check: Reading Device Status Characteristic', {
              purpose: 'RTC validation',
              connectionType: 'manual_or_auto',
              platform: Platform.OS
            });
            this.lastRTCReadLogs.set(deviceId, { timestamp: now });
          }
          
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
            // Note: RTC validity check happens in native code after Device Status is read
            // The result will be logged when Device Status notification arrives
          }
        }
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

  /**
   * Android-only: ask native layer to rehydrate any system-connected GATT devices.
   * Useful after cold start or returning to foreground so UI sees already-connected tags.
   * 
   * Thread-safe: Uses guard flags to prevent concurrent calls and rapid successive calls.
   * The native layer also has guards (connectedGatts check) to prevent duplicate restorations.
   */
  async refreshAndroidSystemConnectedDevices() {
    if (Platform.OS !== 'android' || !SampleBridgeAndroid?.refreshSystemConnectedDevices) {
      return;
    }

    // Guard 1: Prevent concurrent calls
    if (this.isRefreshingSystemDevices) {
      console.log('⏭️ [SYSTEM_REFRESH] Already refreshing system devices, skipping duplicate call');
      return;
    }

    // Guard 2: Throttle rapid successive calls (min 2 seconds between calls)
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastSystemRefreshTime;
    if (timeSinceLastRefresh < 2000) {
      console.log(`⏭️ [SYSTEM_REFRESH] Throttling refresh (${timeSinceLastRefresh}ms since last call)`);
      return;
    }

    // Guard 3: Ensure BLE is ready before attempting refresh
    try {
      const bleReady = await this.isBLEReady();
      if (!bleReady) {
        console.log('⏭️ [SYSTEM_REFRESH] BLE not ready, skipping refresh');
        return;
      }
    } catch (error) {
      console.warn('⚠️ [SYSTEM_REFRESH] Could not check BLE ready state:', error?.message || error);
      return;
    }

    this.isRefreshingSystemDevices = true;
    this.lastSystemRefreshTime = now;

    try {
      console.log('🔄 [SYSTEM_REFRESH] Querying system for connected devices...');
      const result = await SampleBridgeAndroid.refreshSystemConnectedDevices();
      
      if (result?.restoredCount > 0) {
        console.log(`✅ [SYSTEM_REFRESH] Restored ${result.restoredCount} system-connected device(s)`);
        // Trigger UI update if callback is set
        if (this.onDeviceListUpdated) {
          // Small delay to let native events propagate
          setTimeout(() => {
            this.onDeviceListUpdated();
          }, 100);
        }
      } else {
        console.log('ℹ️ [SYSTEM_REFRESH] No new devices to restore');
      }
    } catch (error) {
      console.warn('⚠️ [SYSTEM_REFRESH] Failed to refresh system connected devices:', error?.message || error);
    } finally {
      // Always clear the flag, even on error
      this.isRefreshingSystemDevices = false;
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
        // ✅ FIX: Reset health check failure counter on successful connection
        this.healthCheckFailures.delete(deviceId);
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
    } else if (normalizedCharUuid === normalizedSystemCommand) {
    } else {
    }
  }

  handleAndroidRSSIUpdate(event) {
    const { deviceId, rssi } = event;
    const device = this.scannedDevices.get(deviceId);
    
    if (device) {
      const previousRssi = device.rssi;
      device.rssi = rssi;
      this.rssiValues.set(deviceId, rssi);
      this.lastRssiUpdate.set(deviceId, Date.now());
      // ✅ FIX: Reset health check failure counter on successful RSSI update
      // This ensures temporary RSSI read failures don't accumulate if we get RSSI from other sources
      this.healthCheckFailures.delete(deviceId);
      
      // ✅ Log RSSI update to connection logs
      this.addConnectionLog(deviceId, 'RSSI Update', {
        rssi: rssi,
        previousRssi: previousRssi || null,
        platform: 'Android'
      });
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
        // ✅ FIX: Reset health check failure counter on successful connection
        this.healthCheckFailures.delete(deviceId);
      
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
      
      // ✅ FIX ISSUE #1: Reset connection debounce state on successful connection
      const debounceState = this.connectionStateDebounce.get(deviceId);
      if (debounceState) {
        debounceState.disconnectCount = 0;
        debounceState.isDebouncing = false;
        debounceState.blockedUntil = 0;
        this.connectionStateDebounce.set(deviceId, debounceState);
      }
      
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
      
      // ✅ FIX: Deduplicate "Connected" logs (prevent duplicates within 1 second)
      const connectedNow = Date.now();
      const lastConnectedLog = this.lastConnectedLogs.get(deviceId);
      const shouldLogConnected = !lastConnectedLog || (connectedNow - lastConnectedLog.timestamp) > 1000;
      
      if (shouldLogConnected) {
        this.addConnectionLog(deviceId, 'Connected');
        this.lastConnectedLogs.set(deviceId, { timestamp: connectedNow });
      }
      
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
      
      // Note: "Connected" log is already handled above with deduplication
      
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
    const deviceId = event?.deviceId;
    
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
    
    // ✅ CRITICAL FIX: When recordCount is 0, always check synced records to restore values
    // This ensures we show the last known values even after all records have been synced and cleared from device
    const currentRecordCount = recordCount !== undefined ? recordCount : (eventDeviceData?.recordCount);
    let stepsToUse = steps !== undefined ? steps : device.deviceData.steps;
    let temperatureToUse = temperature !== undefined ? temperature : device.deviceData.temperature;
    
    // ✅ CRITICAL: When recordCount is 0, always check synced records to restore values
    // Even if current values exist, if recordCount is 0 (meaning all records synced), we should use synced values
    // This handles the case where device status updates might reset values to 0
    if ((currentRecordCount === 0 || currentRecordCount === undefined) && 
        device.syncRecords && device.syncRecords.length > 0) {
      
      // Get the latest synced record
      const latestRecord = this.getLatestSyncedRecord(deviceId);
      
      if (latestRecord) {
        // Find latest record with valid temperature
        const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r => 
          r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
        ) || latestRecord;
        
        // Find latest record with valid steps
        const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r => 
          r.steps != null && r.steps !== undefined && r.steps > 0
        ) || latestRecord;
        
        // ✅ CRITICAL: When recordCount is 0, device status update doesn't contain temperature/steps
        // So we MUST use synced record values if available, regardless of current values
        // This ensures persistence of synced data even when device has no records available
        if (latestRecordWithTemp.temperature != null && latestRecordWithTemp.temperature !== undefined) {
          temperatureToUse = latestRecordWithTemp.temperature;
          console.log(`💾 [DEVICE DATA UPDATED] Restored temperature from synced records: ${temperatureToUse}°C (was ${device.deviceData.temperature}) for ${deviceId} (recordCount: ${currentRecordCount})`);
        }
        
        if (latestRecordWithSteps.steps != null && latestRecordWithSteps.steps !== undefined) {
          stepsToUse = latestRecordWithSteps.steps;
          console.log(`💾 [DEVICE DATA UPDATED] Restored steps from synced records: ${stepsToUse} (was ${device.deviceData.steps}) for ${deviceId} (recordCount: ${currentRecordCount})`);
        }
      }
    }
    
    device.deviceData = {
      ...device.deviceData,
      batteryLevel: batteryLevelToUse,
      steps: stepsToUse,
      temperature: temperatureToUse,
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
        await this.uploadLiveBatch(deviceId);
      }
    } else if (!isLiveDataForBuffer) {
    }
    
    // ✅ CRITICAL FIX: Trigger auto-sync for iOS (matching Android behavior)
    // iOS sends DeviceDataUpdated event with isFromPolling, recordCount, rtcValid, etc.
    // ✅ CRITICAL FIX: Check for recordCount at top level OR in deviceData
    const eventRecordCount = recordCount !== undefined ? recordCount : (event?.deviceData?.recordCount);
    const eventRtcValid = rtcValid !== undefined ? rtcValid : (event?.deviceData?.rtcValid);
    
    if (eventRecordCount !== undefined || eventRtcValid !== undefined) {
      // ✅ CRITICAL FIX: For demo tags, if isFromPolling is not set, check deviceData.isFromPolling
      // Demo tags set isFromPolling in deviceData during handleDemoDeviceStatusUpdate
      const finalIsFromPolling = isFromPolling !== undefined 
        ? isFromPolling 
        : (device.deviceData?.isFromPolling !== undefined ? device.deviceData.isFromPolling : false);
      
      const parsedData = {
        recordCount: eventRecordCount !== undefined ? eventRecordCount : device.deviceData?.recordCount,
        rtcValid: eventRtcValid !== undefined ? eventRtcValid : (device.deviceData?.rtcValid ?? true),
        deviceRTC: deviceRTC || (timestamp ? Math.floor(timestamp / 1000) : undefined),
        isFromPolling: finalIsFromPolling,
        dataSource: dataSource || device.deviceData?.dataSource
      };
      
      try {
        await this.maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData);
      } catch (error) {
        console.error('Error in maybeTriggerAutoSyncFromDeviceStatus:', error);
      }
    }
  }

  // ✅ CRITICAL FIX: Handle deviceDataUpdate events from Android (matching iOS format)
  // This handles the new event format that includes type, deviceData, etc.
  async handleAndroidDeviceDataUpdateEvent(event) {
    const { deviceId, type, deviceData: eventDeviceData, batteryLevel, batteryVoltage, recordCount, timestamp, rtcValid } = event;
    const isFromPolling = eventDeviceData?.isFromPolling === true;
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
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
    
    // ✅ Track if this is the initial RTC check (first device_status event from Android)
    // Check if we haven't seen an RTC validity check yet (rtcValid is undefined in deviceData)
    const isInitialDeviceStatus = type === 'device_status' && 
                                  rtcValid !== undefined && 
                                  device.deviceData.rtcValid === undefined;
    
    // ✅ Log initial RTC check for Android (when Device Status is first received with RTC validity)
    if (isInitialDeviceStatus) {
      const deviceTime = timestamp ? Math.floor(timestamp / 1000) : null;
      const systemTime = Math.floor(Date.now() / 1000);
      const timeDiff = deviceTime ? Math.abs(deviceTime - systemTime) : null;
      const isStaleRTC = deviceTime && deviceTime <= 1577836800; // Before 2020-01-01
      
      // Log Device Status read complete
      this.addConnectionLog(deviceId, 'RTC Check: Device Status Read Complete', {
        deviceTime: deviceTime,
        systemTime: systemTime,
        timeDifference: timeDiff,
        timeDifferenceSeconds: timeDiff,
        deviceTimeISO: deviceTime ? new Date(deviceTime * 1000).toISOString() : null,
        systemTimeISO: new Date(systemTime * 1000).toISOString(),
        rtcValid: rtcValid || false,
        isStaleRTC: isStaleRTC || false,
        notificationNumber: 1,
        isInitialCheck: true,
        platform: 'Android'
      });
      
      // Log RTC validity decision
      if (!rtcValid || isStaleRTC) {
        // RTC is invalid - SET_TIME command will be sent by native code
        this.addConnectionLog(deviceId, 'RTC Check: RTC Invalid - SET_TIME Command Will Be Sent', {
          deviceTime: deviceTime,
          systemTime: systemTime,
          rtcValid: false,
          isStaleRTC: isStaleRTC || false,
          action: 'Will send SET_TIME command',
          connectionType: 'manual_or_auto',
          platform: 'Android'
        });
      } else {
        // RTC is valid - time sync will be skipped
        this.addConnectionLog(deviceId, 'RTC Check: RTC Valid - Time Sync Skipped', {
          deviceTime: deviceTime,
          systemTime: systemTime,
          rtcValid: true,
          action: 'Skipping time sync, proceeding with data operations',
          connectionType: 'manual_or_auto',
          platform: 'Android'
        });
      }
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
      
      // ✅ CRITICAL FIX: Explicitly preserve temperature, steps, and totalSteps when device_status event comes
      // Device Status characteristic (SDD v1.4) does NOT contain temperature, steps, or totalSteps
      // These values come from Data Transfer records during sync, so we MUST preserve them
      
      // ✅ CRITICAL FIX: When recordCount is 0, check for previously synced records to persist temperature/steps/totalSteps
      // This ensures we show the last known values even after all records have been synced and cleared from device
      const freshRecordCount = recordCount !== undefined ? recordCount : (eventDeviceData?.recordCount);
      
      let preservedTemperature = device.deviceData.temperature;
      let preservedSteps = device.deviceData.steps;
      let preservedTotalSteps = device.deviceData.totalSteps;
      
      // ✅ CRITICAL FIX: When recordCount is 0, always check synced records to restore values
      // Even if current values exist, if recordCount is 0 (meaning all records synced), we should use synced values
      // This handles the case where device status updates might reset values to 0
      if ((freshRecordCount === 0 || freshRecordCount === undefined) && 
          device.syncRecords && device.syncRecords.length > 0) {
        
        // Get the latest synced record
        const latestRecord = this.getLatestSyncedRecord(deviceId);
        
        if (latestRecord) {
          // Find latest record with valid temperature
          const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r => 
            r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
          ) || latestRecord;
          
          // Find latest record with valid steps
          const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r => 
            r.steps != null && r.steps !== undefined && r.steps > 0
          ) || latestRecord;
          
          // ✅ CRITICAL: When recordCount is 0, device status update doesn't contain temperature/steps/totalSteps
          // So we MUST use synced record values if available, regardless of current values
          // This ensures persistence of synced data even when device has no records available
          if (latestRecordWithTemp.temperature != null && latestRecordWithTemp.temperature !== undefined) {
            preservedTemperature = latestRecordWithTemp.temperature;
            console.log(`💾 [DEVICE STATUS] Restored temperature from synced records: ${preservedTemperature}°C (was ${device.deviceData.temperature}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
          
          if (latestRecordWithSteps.steps != null && latestRecordWithSteps.steps !== undefined) {
            preservedSteps = latestRecordWithSteps.steps;
            console.log(`💾 [DEVICE STATUS] Restored steps from synced records: ${preservedSteps} (was ${device.deviceData.steps}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
          
          // ✅ CRITICAL FIX: Calculate totalSteps from all synced records
          // This ensures totalSteps persists even when new records are generated on device
          const calculatedTotalSteps = (device.syncRecords || []).reduce((sum, record) => {
            return sum + (record.steps || 0);
          }, 0);
          if (calculatedTotalSteps > 0) {
            preservedTotalSteps = calculatedTotalSteps;
            console.log(`💾 [DEVICE STATUS] Restored totalSteps from synced records: ${preservedTotalSteps} (was ${device.deviceData.totalSteps}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
        }
      }
      
      // ✅ CRITICAL FIX: ONLY update recordCount from polling reads, nothing else
      // Keep-alive reads, device status notifications, etc. should NOT update recordCount
      // Only periodic polling (every 30s/60s/120s) should update recordCount
      const existingRecordCount = device.deviceData?.recordCount;
      let finalRecordCount;
      
      if (isFromPolling === true && freshRecordCount !== undefined) {
        // ✅ Polling read: Update with device's reported value
        finalRecordCount = freshRecordCount;
        console.log(`✅ [DEVICE STATUS] Updating recordCount from polling: ${finalRecordCount} (was ${existingRecordCount})`);
      } else {
        // ✅ NOT from polling: Preserve existing value (don't update from device)
        // If existing is undefined, keep it undefined (don't use device's value)
        finalRecordCount = existingRecordCount;
        if (freshRecordCount !== existingRecordCount) {
          console.log(`🔒 [DEVICE STATUS] Preserving recordCount: ${finalRecordCount} (device reported ${freshRecordCount}, but isFromPolling: ${isFromPolling})`);
        }
      }
      
      device.deviceData = {
        ...device.deviceData,
        batteryLevel: batteryLevelToUse, // Use 2A19 battery level (priority) or Device Status as fallback
        batteryVoltage: batteryVoltage !== undefined ? batteryVoltage : (eventDeviceData?.batteryVoltage ?? device.deviceData.batteryVoltage),
        recordCount: finalRecordCount, // Only update if from polling
        // ✅ CRITICAL FIX: Explicitly preserve temperature, steps, and totalSteps (device_status doesn't have these)
        // If recordCount is 0, these values come from previously synced records (persisted above)
        temperature: preservedTemperature,
        steps: preservedSteps,
        totalSteps: preservedTotalSteps, // ✅ CRITICAL FIX: Preserve totalSteps from synced records
        // Mark as live data if RTC is valid and timestamp is recent
        dataSource: isLiveData ? 'live' : (device.deviceData?.dataSource || 'cached'),
        lastUpdate: timestampMs ? new Date(timestampMs) : (eventDeviceData?.lastUpdate ? new Date(eventDeviceData.lastUpdate) : device.deviceData.lastUpdate || new Date()),
        rtcValid: rtcValid !== undefined ? rtcValid : (eventDeviceData?.rtcValid ?? device.deviceData.rtcValid),
        // ✅ CRITICAL FIX: Store isFromPolling flag in deviceData so it's included in emitted events
        isFromPolling: isFromPolling !== undefined ? isFromPolling : device.deviceData.isFromPolling
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
      
    } else if (type === 'sync_records') {
      // ✅ SYNC RECORDS: Live sync progress update (matching iOS behavior)
      // Note: event parameter contains the sync_records data from Android
      const recordsReceived = event.recordsReceived || 0;
      const totalReceived = event.totalReceived || 0;
      const totalExpected = event.totalExpected || 0;
      
      
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
          isFromPolling: device.deviceData.isFromPolling, // ✅ Include polling flag to distinguish from keep-alive reads
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
          // ✅ CRITICAL FIX: Include totalSteps in sync_complete event so UI can preserve it
          totalSteps: device.deviceData.totalSteps,
          steps: device.deviceData.steps,
          temperature: device.deviceData.temperature,
          // ✅ CRITICAL FIX: Include sync completion info to prevent device_status from overwriting recordCount
          syncJustCompleted: (() => {
            if (!this.autoSyncMeta) return false;
            const meta = this.autoSyncMeta.get(deviceId);
            if (!meta || !meta.lastSyncCompletedAt) return false;
            const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
            return timeSinceSync < 15000; // 15 second grace period
          })(),
          syncCompletedRecordCount: (() => {
            if (!this.autoSyncMeta) return undefined;
            const meta = this.autoSyncMeta.get(deviceId);
            return meta?.syncCompletedRecordCount;
          })()
        })
      };
      
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
    
    // ✅ Log service discovery to connection logs (with deduplication and service names - matching iOS)
    const now = Date.now();
    const lastLog = this.lastServiceDiscoveryLog.get(deviceId);
    const serviceCount = services ? services.length : 0;
    const shouldLog = !lastLog || 
                     (now - lastLog.timestamp) > this.discoveryLogDedupeWindow ||
                     lastLog.serviceCount !== serviceCount ||
                     lastLog.characteristicCount !== allCharacteristics.length;
    
    if (shouldLog) {
      // Get service names for better readability (matching iOS)
      const serviceNames = services ? services.map(s => {
        const serviceType = this.getServiceType(s.uuid);
        return serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize first letter of each word
      }) : [];
      
      const serviceUuids = services ? services.map(s => s.uuid) : [];
      const characteristicUuids = allCharacteristics.map(c => c.uuid);
      const serviceList = serviceNames.join(', ');
      
      const logMessage = serviceNames.length > 0 
        ? `Services Discovered (${serviceList})`
        : 'Services Discovered';
      
      this.addConnectionLog(deviceId, logMessage, {
        serviceCount: serviceCount,
        addedCount: serviceCount, // Android sends all services at once
        serviceNames: serviceNames,
        serviceUuids: serviceUuids,
        characteristicCount: allCharacteristics.length,
        characteristicUuids: characteristicUuids,
        platform: 'Android'
      });
      
      // Update last log timestamp
      this.lastServiceDiscoveryLog.set(deviceId, {
        timestamp: now,
        serviceCount: serviceCount,
        characteristicCount: allCharacteristics.length
      });
    }
    
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

      // ✅ DEMO TAG FIX: Check if device is a demo tag before calling native bridge
      const isDemoTag = device.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
      
      let rssi;
      if (isDemoTag) {
        // DemoTag: Use simulated RSSI from DemoTagSimulator
        rssi = DemoTagSimulator.updateRSSI(deviceId);
      } else if (Platform.OS === 'android') {
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
        
        // ✅ FIX: Reset health check failure counter on successful RSSI update
        // This ensures temporary RSSI read failures don't accumulate if we get RSSI from other sources
        this.healthCheckFailures.delete(deviceId);
        
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

    // Track recent auto-connects to avoid duplicate "Connected" + "Auto-connected" logs
    this.recentAutoConnects = new Map(); // deviceId -> timestamp ms
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

      // DemoTag: Inject demo devices if demo mode is enabled
      if (DemoTagSimulator.isDemoModeEnabled()) {
        const demoDevices = DemoTagSimulator.getAllDemoDevices();
        demoDevices.forEach(demoDevice => {
          // DemoTag: Update RSSI to simulate signal variation
          DemoTagSimulator.updateRSSI(demoDevice.id);
          const updatedDevice = DemoTagSimulator.getDemoDevice(demoDevice.id);
          
          // DemoTag: Add/update demo device in scanned devices
          this.scannedDevices.set(demoDevice.id, {
            ...updatedDevice,
            lastSeen: Date.now(),
            serviceUUIDs: [BLE_SERVICES.SMART_TAG],
            isDemoTag: true,
          });
          
          // DemoTag: Trigger onDeviceFound callback if provided
          if (onDeviceFound) {
            onDeviceFound({
              id: demoDevice.id,
              name: demoDevice.name,
              rssi: updatedDevice.rssi,
              manufacturerData: updatedDevice.manufacturerData,
              serviceUUIDs: [BLE_SERVICES.SMART_TAG],
              isDemoTag: true,
            });
          }
        });
      }

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
        allowDuplicates: true,
        // ⚡ iOS PERFORMANCE: Use targeted scan (service UUID filter) for MUCH faster discovery
        // Falls back to broad scan automatically after 5s if no devices found
        useTargetedScan: Platform.OS === 'ios' ? true : undefined
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
      // DemoTag: Check if this is a demo device
      if (DemoTagSimulator.isDemoDevice(deviceId)) {
        return await this.connectToDemoDevice(deviceId, onConnectionStateChange);
      }

      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('Device not found in scanned devices');
      }

      // ✅ LOG: Trying to connect
      this.addConnectionLog(deviceId, 'Trying to connect', {
        deviceName: device.name || 'Unknown',
        connectionType: 'manual',
        platform: Platform.OS
      });

      // Mark this connection as manual to differentiate logs from auto-connect
      this.pendingManualConnects.set(deviceId, Date.now());

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
        // Disconnect all other devices
        const disconnectPromises = currentlyConnectedDevices.map(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
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
      
      // ✅ LOG: Connecting
      this.addConnectionLog(deviceId, 'Connecting', {
        deviceName: device.name || 'Unknown',
        connectionType: 'manual',
        platform: Platform.OS
      });
      
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
        // ✅ DEMO TAG FIX: Check if device is a demo tag before calling native bridge
        const isDemoTag = connectedDevice.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
        
        let initialRssi;
        if (isDemoTag) {
          // DemoTag: Use simulated RSSI from DemoTagSimulator
          initialRssi = DemoTagSimulator.updateRSSI(deviceId);
        } else if (Platform.OS === 'android') {
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
      // ✅ LOG: Connection failed
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device?.name || 'Unknown';
      
      this.addConnectionLog(deviceId, 'Connection failed', {
        deviceName: deviceName,
        error: error.message || 'Unknown error',
        errorCode: error.code || error.errorCode || 'NO_ERROR_CODE',
        connectionType: 'manual',
        platform: Platform.OS
      });
      
      // Log error context
      this.logError(deviceId, 'CONNECTION_FAILED', {
        error: error.message || 'Unknown error',
        errorCode: error.code || error.errorCode || 'NO_ERROR_CODE',
        deviceName: deviceName
      });

      // Update device state
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
  /**
   * DemoTag: Connect to demo device
   */
  async connectToDemoDevice(deviceId, onConnectionStateChange) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('DemoTag: Demo device not found');
      }

      // DemoTag: Update connection state
      device.connectionState = CONNECTION_STATES.CONNECTING;
      this.scannedDevices.set(deviceId, device);
      
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTING);
      }

      // DemoTag: Simulate connection
      await DemoTagSimulator.connectDevice(deviceId);
      
      // DemoTag: Update device state
      device.connectionState = CONNECTION_STATES.CONNECTED;
      this.scannedDevices.set(deviceId, device);
      this.connectedDevices.set(deviceId, {
        id: deviceId,
        name: device.name,
        isDemoTag: true,
      });

      // DemoTag: Store device data
      const demoDevice = DemoTagSimulator.getDemoDevice(deviceId);
      if (demoDevice && demoDevice.deviceData) {
        this.deviceDataStore.set(deviceId, demoDevice.deviceData);
      }

      // ✅ DemoTag: Log connection (matching original tag behavior)
      this.addConnectionLog(deviceId, 'Connected');

      // DemoTag: Load services (simulate service discovery)
      await this.loadDemoDeviceServices(deviceId);

      // ✅ Match original tag: Enable notifications FIRST, then start polling
      // Original tag flow: Service Discovery → Enable Notifications → Start Polling
      // DemoTag: Start notifications (simulate periodic device status updates)
      // ✅ FIX: Use polling interval for notifications to keep them in sync (notifications don't trigger auto-sync)
      const notificationInterval = DemoTagSimulator.getPollingInterval(deviceId);
      DemoTagSimulator.startNotifications(deviceId, (notification) => {
        this.handleDemoCharacteristicNotification(deviceId, notification);
      }, notificationInterval);

      // ✅ Match original tag: Start polling AFTER notifications are enabled
      // DemoTag: Start live polling (simulate native polling every 30 seconds)
      this.startDemoDevicePolling(deviceId);

      // DemoTag: Start heartbeat monitoring (like real devices)
      this.startHeartbeatMonitoring(deviceId);

      // DemoTag: Start connection health check
      this.startConnectionHealthCheck();

      // DemoTag: Start GET API calling (like real devices)
      setTimeout(() => {
        this.startGetApiCalling(deviceId);
      }, 6000);

      // DemoTag: Start RSSI polling
      this.startRSSIPolling(deviceId);

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTED);
      }

      // DemoTag: Trigger device list update
      this.scheduleListUpdate();

      console.log(`🏷️ DemoTag: Connected to ${device.name}`);
      return device;
    } catch (error) {
      console.error('🏷️ DemoTag: Connection error:', error);
      throw error;
    }
  }

  /**
   * DemoTag: Load demo device services (simulate service discovery)
   */
  async loadDemoDeviceServices(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device || !device.isDemoTag) return;

    // DemoTag: Simulate service discovery
    const services = [BLE_SERVICES.SMART_TAG, BLE_SERVICES.BATTERY, BLE_SERVICES.DEVICE_INFO];
    device.services = services;
    device.characteristics = {
      [BLE_SERVICES.SMART_TAG]: [
        BLE_CHARACTERISTICS.SYSTEM_COMMAND,
        BLE_CHARACTERISTICS.DEVICE_STATUS,
        BLE_CHARACTERISTICS.DATA_TRANSFER,
      ],
      [BLE_SERVICES.BATTERY]: [BLE_CHARACTERISTICS.BATTERY_LEVEL],
      [BLE_SERVICES.DEVICE_INFO]: [
        BLE_CHARACTERISTICS.MANUFACTURER_NAME,
        BLE_CHARACTERISTICS.MODEL_NUMBER,
        BLE_CHARACTERISTICS.SERIAL_NUMBER,
        BLE_CHARACTERISTICS.FIRMWARE_REVISION,
        BLE_CHARACTERISTICS.HARDWARE_REVISION,
      ],
    };
    
    this.scannedDevices.set(deviceId, device);
    
    // ✅ DemoTag: Log service discovery (matching original tag behavior)
    const totalCharacteristics = Object.values(device.characteristics).flat().length;
    this.addConnectionLog(deviceId, `Characteristics Discovered (${services.length} services: Smart Tag, Battery, Device Information)`, {
      serviceCount: services.length,
      totalCharacteristicCount: totalCharacteristics,
      services: services.map(serviceUuid => ({
        serviceUuid: serviceUuid,
        serviceName: serviceUuid === BLE_SERVICES.SMART_TAG ? 'Smart Tag' : 
                     serviceUuid === BLE_SERVICES.BATTERY ? 'Battery' : 'Device Information',
        characteristicCount: device.characteristics[serviceUuid]?.length || 0
      })),
      platform: 'demo_tag'
    });
  }

  /**
   * DemoTag: Start live polling for demo device (simulates native polling)
   * @param {string} deviceId - Device ID
   * @param {number} [pollIntervalMs] - Optional polling interval in milliseconds. If not provided, uses getPollingInterval()
   */
  startDemoDevicePolling(deviceId, pollIntervalMs = null) {
    // ✅ Match original tag: Initialize polling active map if needed
    if (!this.demoPollingActive) {
      this.demoPollingActive = new Map();
    }
    
    // ✅ Match original tag: Check if polling is already active to prevent duplicates
    if (this.demoPollingActive.get(deviceId) === true) {
      console.log(`🏷️ DemoTag: Polling already active for ${deviceId}, skipping duplicate start`);
      return;
    }
    
    // DemoTag: Stop existing polling if any (this also clears the active flag)
    this.stopDemoDevicePolling(deviceId);

    // ✅ Ensure callback is set (in case initDemoTagMode wasn't called or was called before connection)
    if (!DemoTagSimulator.hasPollingIntervalCallback()) {
      console.log(`🏷️ DemoTag: Setting up polling interval callback for ${deviceId}`);
      DemoTagSimulator.setPollingIntervalCallback((deviceId, intervalSeconds) => {
        console.log(`🏷️ DemoTag: Polling interval changed to ${intervalSeconds}s for ${deviceId}, restarting polling...`);
        // Restart polling with new interval
        const device = this.scannedDevices.get(deviceId);
        if (device && device.isDemoTag && device.connectionState === CONNECTION_STATES.CONNECTED) {
          console.log(`🏷️ DemoTag: Restarting polling for ${deviceId} with new interval ${intervalSeconds}s`);
          // ✅ CRITICAL FIX: Stop polling first to clear the active flag, then start with new interval
          // This prevents "Polling already active, skipping duplicate start" error
          this.stopDemoDevicePolling(deviceId);
          // ✅ CRITICAL: Use the passed interval directly instead of calling getPollingInterval
          // This ensures we use the exact interval that was just set
          this.startDemoDevicePolling(deviceId, intervalSeconds * 1000);
          
          // ✅ FIX: Also restart notifications with new interval to keep them in sync
          const notificationInterval = intervalSeconds * 1000;
          DemoTagSimulator.stopNotifications(deviceId);
          DemoTagSimulator.startNotifications(deviceId, (notification) => {
            this.handleDemoCharacteristicNotification(deviceId, notification);
          }, notificationInterval);
          console.log(`🏷️ DemoTag: Restarted notifications for ${deviceId} with new interval ${intervalSeconds}s`);
        } else {
          console.warn(`🏷️ DemoTag: Cannot restart polling - device not found or not connected:`, {
            deviceId,
            deviceExists: !!device,
            isDemoTag: device?.isDemoTag,
            connectionState: device?.connectionState
          });
        }
      });
    }

    // ✅ Get polling interval: use provided interval, or get from DemoTagSimulator (defaults to 30 seconds)
    const pollInterval = pollIntervalMs !== null ? pollIntervalMs : DemoTagSimulator.getPollingInterval(deviceId);
    const pollIntervalSeconds = pollInterval / 1000;

    // ✅ Log polling start for demo tag
    // ✅ FIX: Remove isFromPolling field from Polling Started log (it's the initial start, not a polling read)
    this.addConnectionLog(deviceId, 'Polling Started', {
      source: 'demo_tag',
      pollInterval: pollInterval,
      pollIntervalSeconds: pollIntervalSeconds
    });

    // ✅ Match original tag: Mark as active before starting timer
    this.demoPollingActive.set(deviceId, true);
    
    console.log(`🏷️ DemoTag: Starting polling for ${deviceId} with interval ${pollIntervalSeconds}s (${pollInterval}ms)`);
    const pollingTimer = setInterval(async () => {
      try {
        const device = this.scannedDevices.get(deviceId);
        if (!device || !device.isDemoTag || device.connectionState !== CONNECTION_STATES.CONNECTED) {
          this.stopDemoDevicePolling(deviceId);
          return;
        }

        // ✅ DemoTag: Update RSSI during polling (simulates real device behavior)
        const previousRssi = device.rssi;
        const newRssi = DemoTagSimulator.updateRSSI(deviceId);
        if (newRssi !== null && newRssi !== undefined) {
          device.rssi = newRssi;
          this.rssiValues.set(deviceId, newRssi);
          this.lastRssiUpdate.set(deviceId, Date.now());
          
          // ✅ FIX: Reset health check failure counter on successful RSSI update
          this.healthCheckFailures.delete(deviceId);
          
          // ✅ Log RSSI update to connection logs (matching real device behavior)
          this.addConnectionLog(deviceId, 'RSSI Update', {
            rssi: newRssi,
            previousRssi: previousRssi || null,
            platform: 'demo_tag',
            source: 'polling'
          });
          
          // Emit RSSI updated event (matching real device behavior)
          this.emit('rssiUpdated', {
            deviceId,
            rssi: newRssi,
            timestamp: Date.now()
          });
          
          // Check connection quality based on RSSI
          this.checkRssiConnectionQuality(deviceId, newRssi);
        }

        // DemoTag: Read device status (simulate native polling)
        // Note: updateDeviceData in readDeviceStatus automatically generates new records every 30 seconds
        const statusData = DemoTagSimulator.readDeviceStatus(deviceId);
        if (statusData) {
          // ✅ DemoTag: Log device status read (matching original tag behavior)
          this.addConnectionLog(deviceId, 'Device Status Read', {
            characteristicUUID: BLE_CHARACTERISTICS.DEVICE_STATUS,
            source: 'polling',
            isFromPolling: true
          });
          
          // DemoTag: Trigger device data update (same as real devices)
          await this.handleDemoDeviceStatusUpdate(deviceId, statusData, true); // isFromPolling=true
        }
      } catch (error) {
        console.error('🏷️ DemoTag: Polling error:', error);
      }
    }, pollInterval);

    // DemoTag: Store polling timer
    if (!this.demoPollingTimers) {
      this.demoPollingTimers = new Map();
    }
    this.demoPollingTimers.set(deviceId, pollingTimer);

    // DemoTag: Do initial poll immediately
    setTimeout(async () => {
      try {
        const device = this.scannedDevices.get(deviceId);
        if (device && device.isDemoTag) {
          // ✅ DemoTag: Update RSSI on initial poll
          const previousRssi = device.rssi;
          const newRssi = DemoTagSimulator.updateRSSI(deviceId);
          if (newRssi !== null && newRssi !== undefined) {
            device.rssi = newRssi;
            this.rssiValues.set(deviceId, newRssi);
            this.lastRssiUpdate.set(deviceId, Date.now());
            
            // Emit RSSI updated event
            this.emit('rssiUpdated', {
              deviceId,
              rssi: newRssi,
              timestamp: Date.now()
            });
            
            // Check connection quality
            this.checkRssiConnectionQuality(deviceId, newRssi);
          }
        }
        
        const statusData = DemoTagSimulator.readDeviceStatus(deviceId);
        if (statusData) {
          await this.handleDemoDeviceStatusUpdate(deviceId, statusData, true);
        }
      } catch (error) {
        console.error('🏷️ DemoTag: Initial poll error:', error);
      }
    }, 1000);
  }

  /**
   * DemoTag: Stop live polling for demo device
   */
  stopDemoDevicePolling(deviceId) {
    // ✅ Match original tag: Clear active flag first
    if (this.demoPollingActive) {
      this.demoPollingActive.set(deviceId, false);
    }
    
    // Stop timer
    if (this.demoPollingTimers && this.demoPollingTimers.has(deviceId)) {
      const timer = this.demoPollingTimers.get(deviceId);
      clearInterval(timer);
      this.demoPollingTimers.delete(deviceId);
      console.log(`🏷️ DemoTag: Stopped polling timer for ${deviceId}`);
    } else {
      // ✅ Match original tag: Ensure flag is cleared even if timer doesn't exist
      if (this.demoPollingActive) {
        this.demoPollingActive.set(deviceId, false);
      }
    }
  }

  /**
   * DemoTag: Handle device status update (triggers auto-sync like real devices)
   */
  async handleDemoDeviceStatusUpdate(deviceId, statusData, isFromPolling = false, isFromNotification = false) {
    try {
      // DemoTag: Parse device status
      const parsedData = BLEDataParser.parseDeviceStatus(statusData);
      if (!parsedData) return;

      const device = this.scannedDevices.get(deviceId);
      if (!device || !device.isDemoTag) return;

      // DemoTag: Update device data (same flow as real devices)
      const currentData = this.deviceDataStore.get(deviceId) || {};
      const demoDevice = DemoTagSimulator.getDemoDevice(deviceId);
      
      // ✅ CRITICAL: Device status doesn't include steps/temperature, so preserve them from current data
      // Device status only contains: recordCount, batteryVoltage, deviceRTC
      // ✅ FIX: For demo tags, steps/temperature should ONLY come from synced records
      // If there are no synced records, we should NOT show random values (matches real device behavior)
      const latestSyncedRecord = device?.syncRecords && device.syncRecords.length > 0
        ? device.syncRecords[device.syncRecords.length - 1]
        : null;
      
      // ✅ CRITICAL FIX: Only use steps/temperature from synced records
      // If no synced records exist, use null/undefined (don't show random values)
      // This matches real device behavior where steps/temp only appear after first sync
      // ✅ FIX: Remove fallback to currentData - only use synced records, otherwise null
      const stepsValue = latestSyncedRecord?.steps !== undefined 
        ? latestSyncedRecord.steps 
        : null;
      
      const temperatureValue = latestSyncedRecord?.temperature !== undefined 
        ? latestSyncedRecord.temperature 
        : null;
      
      // ✅ CRITICAL FIX: Calculate totalSteps from all synced records
      // This ensures totalSteps persists even when new records are generated on device
      const calculatedTotalSteps = (device?.syncRecords || []).reduce((sum, record) => {
        return sum + (record.steps || 0);
      }, 0);
      const totalStepsValue = calculatedTotalSteps > 0 
        ? calculatedTotalSteps 
        : (currentData.totalSteps !== undefined ? currentData.totalSteps : undefined);
      
      const updatedData = {
        ...currentData,
        ...parsedData,
        // ✅ FIX: Use steps from latest synced record (matches real device behavior)
        steps: stepsValue,
        temperature: temperatureValue,
        // ✅ CRITICAL FIX: Preserve totalSteps from synced records
        totalSteps: totalStepsValue,
        dataSource: 'demo',
        isFromPolling: isFromPolling,
      };
      this.deviceDataStore.set(deviceId, updatedData);

      // DemoTag: Update device in scanned devices
      device.deviceData = updatedData;
      this.scannedDevices.set(deviceId, device);

      // DemoTag: Trigger device data update event (same as real devices)
      if (this.onDeviceDataUpdated) {
        this.onDeviceDataUpdated(deviceId, updatedData);
      }

      // ✅ CRITICAL FIX: Only trigger auto-sync if this is from polling, NOT from notifications
      // Notifications are just for UI updates, auto-sync should only happen on polling (matching original tag)
      if (!isFromNotification) {
        // DemoTag: Call handleDeviceDataUpdated to trigger auto-sync (same as real devices)
        // ✅ CRITICAL FIX: Ensure isFromPolling is passed at top level AND in deviceData
        // This ensures it's correctly extracted in handleDeviceDataUpdated
        await this.handleDeviceDataUpdated({
          deviceId: deviceId,
          deviceData: {
            ...updatedData,
            isFromPolling: isFromPolling, // Also include in deviceData for fallback
          },
          recordCount: parsedData.recordCount,
          rtcValid: parsedData.rtcValid,
          deviceRTC: parsedData.deviceRTC,
          isFromPolling: isFromPolling, // Top level for iOS-style extraction
          dataSource: 'demo',
          batteryLevel: updatedData.batteryLevel,
          steps: updatedData.steps,
          temperature: updatedData.temperature,
          timestamp: updatedData.timestamp,
          batteryVoltage: updatedData.batteryVoltage,
        });
      } else {
        // From notification - just update UI, don't trigger auto-sync
        console.log(`🏷️ DemoTag: Device status update from notification for ${deviceId} - skipping auto-sync (only polling triggers sync)`);
      }

      // DemoTag: Trigger list update
      this.scheduleListUpdate();
    } catch (error) {
      console.error('🏷️ DemoTag: Error handling device status update:', error);
    }
  }

  /**
   * DemoTag: Handle demo characteristic notification
   */
  handleDemoCharacteristicNotification(deviceId, notification) {
    // ✅ FIX: DemoTag notifications should NOT trigger auto-sync
    // Only polling should trigger auto-sync (matching original tag behavior)
    // Notifications are just for UI updates, not for triggering sync
    // Pass a special flag to indicate this is from notification, not polling
    this.handleDemoDeviceStatusUpdate(deviceId, notification.data, false, true); // isFromNotification=true
  }

  /**
   * DemoTag: Disconnect from demo device
   */
  async disconnectFromDemoDevice(deviceId, onConnectionStateChange) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) return;

      // DemoTag: Stop polling
      this.stopDemoDevicePolling(deviceId);

      // DemoTag: Stop notifications
      DemoTagSimulator.stopNotifications(deviceId);

      // DemoTag: Stop monitoring and health checks
      this.stopMonitoring(deviceId);
      this.stopHeartbeatMonitoring(deviceId);
      this.stopRSSIPolling(deviceId);
      this.stopDeviceStatusPollingFallback(deviceId);
      this.stopAdaptiveApiCalling(deviceId);
      this.stopGetApiCalling(deviceId);

      // DemoTag: Disconnect from simulator
      await DemoTagSimulator.disconnectDevice(deviceId);

      // DemoTag: Update connection state
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.lastSeen = Date.now();
      this.scannedDevices.set(deviceId, device);
      this.connectedDevices.delete(deviceId);

      // ✅ DemoTag: Log disconnection (matching original tag behavior)
      this.addConnectionLog(deviceId, 'Disconnected');

      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTED);
      }

      // DemoTag: Trigger device list update
      this.scheduleListUpdate();

      console.log(`🏷️ DemoTag: Disconnected from ${device.name}`);
    } catch (error) {
      console.error('🏷️ DemoTag: Disconnect error:', error);
      throw error;
    }
  }

  async disconnectFromDevice(deviceId, onConnectionStateChange) {
    try {
      // DemoTag: Check if this is a demo device
      if (DemoTagSimulator.isDemoDevice(deviceId)) {
        return await this.disconnectFromDemoDevice(deviceId, onConnectionStateChange);
      }

      // ✅ INDUSTRY STANDARD: Upload any pending buffered data before disconnect
      const buffer = this.liveDataBuffers.get(deviceId);
      if (buffer && buffer.length > 0) {
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

      // ✅ Cleanup: Flush any pending characteristics logs before disconnecting
      this.flushPendingCharacteristicsLogs(deviceId);
      
      // ✅ LOG: Disconnecting
      this.addConnectionLog(deviceId, 'Disconnecting', {
        deviceName: device.name || 'Unknown',
        connectionType: device.connectionType || 'manual',
        platform: Platform.OS
      });

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
        
        // ✅ FIX ISSUE #4 & #5: Use validated command sending
        const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes, { waitForResponse: true });
        
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
    // ✅ FIX 1: Device generates records every 30 seconds consistently
    // If records are detected every ~30 seconds (polling interval), use NORMAL mode
    // Don't use SLOW mode (60s) when device generates records every 30s
    // Only use SLOW mode if records are truly accumulating slowly (< 0.5 records/30s)
    if (recordsPer30s > 2) {
      throttle = this.adaptiveThrottleConfig.fast; // Fast accumulation (>2 records/30s)
    } else if (recordsPer30s < 0.5) {
      // ✅ FIX: Only use SLOW mode for very slow accumulation (< 0.5 records/30s)
      // If records are detected every 30s (polling), recordsPer30s might be 0-1, but device is generating regularly
      // Use NORMAL mode instead of SLOW to match 30-second record generation
      throttle = this.adaptiveThrottleConfig.slow; // Very slow accumulation (< 0.5 records/30s)
    } else {
      // ✅ FIX: Use NORMAL mode (30s) for 0.5-2 records/30s
      // This covers the case where device generates 1 record every 30s (normal pattern)
      throttle = this.adaptiveThrottleConfig.normal; // Normal accumulation (0.5-2 records/30s)
    }
    
    // ✅ FIX 1: Additional check - if device is being polled every 30s and records are available,
    // use NORMAL mode regardless of calculated rate (device generates records every 30s)
    const lastReadTime = this.autoSyncMeta?.get(deviceId)?.lastDeviceStatusReadTime || 0;
    const timeSinceLastRead = lastReadTime > 0 ? (Date.now() - lastReadTime) : 0;
    // If polling happens every ~30 seconds and records are available, use NORMAL throttle
    if (timeSinceLastRead > 25000 && timeSinceLastRead < 35000 && recordsPer30s >= 0) {
      // Device is being polled every 30s and has records - use NORMAL mode to match polling interval
      throttle = this.adaptiveThrottleConfig.normal;
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
      return; // Already processing or sync is active
    }
    
    const queue = this.syncQueue.get(deviceId) || [];
    if (queue.length === 0) {
      return; // No pending syncs
    }
    
    this.processingSync.set(deviceId, true);
    const syncRequest = queue.shift();
    
    try {
      const result = await this.startDataSync(deviceId);
      
      if (result && result.status === 'success') {
      } else if (result && result.status === 'already_syncing') {
        // Re-queue if already syncing
        queue.unshift(syncRequest);
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
    
    // ✅ FIX: Check if sync just completed - skip auto-sync if sync completed within last 15 seconds
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
        }
      } catch (error) {
        // Ignore error, continue with normal flow
      }
    } else {
      // ✅ FIX: For iOS, check lastSyncCompletedAt from meta (same logic as Android)
      // iOS doesn't have native state management, so we rely on JS meta tracking
      if (meta.lastSyncCompletedAt) {
        const timeSinceSync = nowMs - meta.lastSyncCompletedAt;
        syncJustCompleted = timeSinceSync < 15000; // 15 seconds grace period
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
    
    // ✅ CRITICAL FIX: For demo tags, ALWAYS override isFromPolling if it's not a manual read
    // Demo tags use periodic polling, so if not a manual read, it's from polling
    // This must run BEFORE the fallback logic to ensure demo tags always work
    const isDemoTag = device?.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
    // Check both parsedData.dataSource and device.deviceData.dataSource for reliability
    const isDemoDataSource = parsedData?.dataSource === 'demo' || device?.deviceData?.dataSource === 'demo';
    if (isDemoTag && isDemoDataSource && !isFromManualRead) {
      // ✅ CRITICAL FIX: Only override isFromPolling if it's actually from polling
      // For demo tags, if isFromPolling is explicitly false, it means it's from notification (not polling)
      // We should NOT override false to true, as notifications should NOT trigger auto-sync
      // Only override if isFromPolling is undefined/null (meaning it wasn't set)
      if (isFromPolling === undefined || isFromPolling === null) {
        // Demo tags use periodic polling, so if not a manual read and isFromPolling not set, assume it's from polling
        isFromPolling = true;
        console.log(`🏷️ [AUTO SYNC] Demo tag detected: Setting isFromPolling to true for ${deviceId} (was: ${parsedData?.isFromPolling})`);
      } else if (isFromPolling === false) {
        // Explicitly false means it's from notification - don't override, don't trigger auto-sync
        console.log(`🏷️ [AUTO SYNC] Demo tag detected: isFromPolling is false (from notification) for ${deviceId} - will not trigger auto-sync`);
      }
    } else if (isFromPolling === undefined || isFromPolling === null) {
      // ✅ FALLBACK: If isFromPolling not provided by native code, calculate from timestamps
      // This is a fallback for older code paths or if native code doesn't send the flag
      // Check if this is from periodic polling (workaround for missing notifications)
      // ✅ FIX: Make periodic polling detection dynamic based on actual polling interval
      const lastReadTime = meta.lastDeviceStatusReadTime || 0;
      const timeSinceLastRead = lastReadTime > 0 ? (nowMs - lastReadTime) : 0;
      
      // Get actual polling interval for demo tags (defaults to 30s if not set)
      let pollingInterval = 30000; // Default 30 seconds
      if (isDemoTag) {
        pollingInterval = DemoTagSimulator.getPollingInterval(deviceId);
      }
      
      // Check if time since last read matches polling interval (±20% tolerance)
      const pollingIntervalSeconds = pollingInterval / 1000;
      const tolerance = pollingIntervalSeconds * 0.2; // 20% tolerance
      const isFromPeriodicPolling = timeSinceLastRead > (pollingIntervalSeconds - tolerance) * 1000 && 
                                    timeSinceLastRead < (pollingIntervalSeconds + tolerance) * 1000;
      
      // For real devices: Only skip if it's a manual read, not periodic polling
      // ✅ FIX: Logic was inverted - should be: if NOT manual read AND periodic polling, then it's from polling
      isFromPolling = !isFromManualRead && isFromPeriodicPolling;
    } else {
      // ✅ FIX: Ensure isFromPolling is a boolean (convert truthy/falsy to boolean)
      isFromPolling = isFromPolling === true;
    }
    
    // ✅ FIX: Ensure isFromPolling is always a boolean (never undefined/null)
    // This prevents issues in comparisons and logging
    if (isFromPolling === undefined || isFromPolling === null) {
      isFromPolling = false;
    }
    
    // ✅ FIX 2: Calculate timeSinceLastRead BEFORE updating lastDeviceStatusReadTime
    // This ensures we use the PREVIOUS read time, not the current one
    const previousReadTime = meta.lastDeviceStatusReadTime || 0;
    const timeSinceLastRead = previousReadTime > 0 ? (nowMs - previousReadTime) : 0;
    
    // Update last read time for next comparison (AFTER calculating timeSinceLastRead)
    meta.lastDeviceStatusReadTime = nowMs;
    this.autoSyncMeta.set(deviceId, meta);

    const recordCountIncreased = meta.lastRecordCount === undefined || parsedData?.recordCount > meta.lastRecordCount;
    
    // ✅ IMPROVEMENT 3: Use adaptive throttle
    let throttleTime = this.calculateAdaptiveThrottle(deviceId);
    
    // ✅ CRITICAL FIX: If polling is detected, always override SLOW mode (59s) to NORMAL mode (29s)
    // This ensures sync can trigger every 30s when polling happens, even if timeSinceLastRead is 0
    // If native code says it's polling (isFromPollingValue: true), trust it and use NORMAL throttle
    const isFromPollingValue = isFromPolling === true;
    if (isFromPollingValue && throttleTime >= this.adaptiveThrottleConfig.slow) {
      // Polling detected - always override SLOW to NORMAL to match 30s polling interval
      // This works even when timeSinceLastRead is 0 (first read after sync/reset)
      console.log(`🔄 [THROTTLE OVERRIDE] ${deviceId}: Polling detected, overriding SLOW throttle (${throttleTime}ms) to NORMAL (${this.adaptiveThrottleConfig.normal}ms)`);
      throttleTime = this.adaptiveThrottleConfig.normal;
    }
    
    // ✅ FIX: Use >= instead of > to trigger at exactly throttle time (prevents missing syncs at exact throttle intervals)
    const throttleExpired = !meta.lastSyncAt || (nowMs - meta.lastSyncAt) >= throttleTime;
    
    // ✅ SIMPLE RULE: If polling detected and records available, sync (respect throttle)
    // Also sync if record count increased, throttle expired, or it's a single record
    const isSingleRecord = parsedData?.recordCount === 1;
    const timeSinceLastSync = nowMs - (meta.lastSyncAt || 0);
    
    // Simple logic: sync if polling + records available + throttle expired
    // OR if record count increased, throttle expired, or single record
    const shouldSync = (isFromPollingValue && hasRecordsAvailable && throttleExpired) || 
                       recordCountIncreased || 
                       throttleExpired || 
                       isSingleRecord;
    
    // ✅ DEBUG: Log polling trigger details
    if (hasRecordsAvailable) {
      console.log(`🔍 [POLLING DEBUG] ${deviceId}:`, {
        isFromPollingValue,
        isFromPolling: parsedData?.isFromPolling,
        timeSinceLastRead,
        previousReadTime: previousReadTime,
        timeSinceLastSync,
        throttleTime,
        throttleExpired,
        recordCount: parsedData?.recordCount,
        hasRecordsAvailable,
        recordCountIncreased,
        isSingleRecord,
        shouldSync
      });
    }
    
    // ✅ FIX: Update lastRecordCount even when not syncing, so we can properly detect increases next time
    // This prevents the issue where same record count prevents sync on subsequent checks
    if (parsedData?.recordCount !== undefined) {
      meta.lastRecordCount = parsedData.recordCount;
      this.autoSyncMeta.set(deviceId, meta);
    }
    
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
    // Note: isFromPollingValue is already defined above (line ~4692)
    
    // ✅ CRITICAL FIX: Trigger auto-sync ONLY for polling reads (isFromPollingValue=true)
    // Manual reads (isFromPollingValue=false) should NOT trigger auto-sync
    
    // ✅ DEBUG: Log all conditions to diagnose why auto-sync might not trigger
    let debugNativeState = null;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        debugNativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
      } catch (e) {
        // Ignore
      }
    }
    
    const conditions = {
      hasRecordsAvailable,
      isSyncActive,
      syncJustCompleted,
      isConnected,
      isLiveData,
      isFromPollingValue,
      shouldSync,
      recordCount: parsedData?.recordCount,
      lastRecordCount: meta.lastRecordCount,
      recordCountIncreased,
      throttleExpired,
      isSingleRecord,
      timeSinceLastSync: meta.lastSyncAt ? (nowMs - meta.lastSyncAt) : 'never',
      throttleTime,
      nativeState: debugNativeState
    };
    
    const allConditionsMet = hasRecordsAvailable && !isSyncActive && !syncJustCompleted && isConnected && isLiveData && isFromPollingValue && shouldSync;
    
    if (!allConditionsMet && hasRecordsAvailable) {
      // Only log when records are available but sync isn't triggering (to avoid spam)
      console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Auto-sync conditions:`, JSON.stringify(conditions, null, 2));
      const failedConditions = [];
      if (!hasRecordsAvailable) failedConditions.push('hasRecordsAvailable');
      if (isSyncActive) failedConditions.push('isSyncActive');
      if (syncJustCompleted) failedConditions.push('syncJustCompleted');
      if (!isConnected) failedConditions.push('isConnected');
      if (!isLiveData) failedConditions.push('isLiveData');
      if (!isFromPollingValue) failedConditions.push('isFromPollingValue');
      if (!shouldSync) failedConditions.push('shouldSync');
      console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Failed conditions: ${failedConditions.join(', ') || 'none (timer debounce?)'}`);
    }
    
    if (hasRecordsAvailable && !isSyncActive && !syncJustCompleted && isConnected && isLiveData && isFromPollingValue && shouldSync) {
      console.log(`✅ [AUTO SYNC DEBUG] ${deviceId} - All conditions met, setting up auto-sync timer (${parsedData?.recordCount} records, debounce: ${this.autoSyncConfig.debounceDelay}ms)`);
      
      // ✅ FIX: Timer reset debounce - only reset if last reset was > 500ms ago
      const lastTimerResetTime = this.lastTimerReset?.get(deviceId) || 0;
      const timeSinceLastReset = nowMs - lastTimerResetTime;
      
      if (timeSinceLastReset < this.timerResetDebounceWindow) {
        console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Timer debounce active (${timeSinceLastReset}ms < ${this.timerResetDebounceWindow}ms)`);
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
              }
          } catch (error) {
            // Fallback to JS state if native query fails
            const currentSyncState = this.dataSyncStates?.get(deviceId);
            stillActive = currentSyncState?.isActive === true;
            currentState = currentSyncState?.state || 'unknown';
          }
        } else {
          // iOS: Use JS state (iOS native manages state internally)
          const currentSyncState = this.dataSyncStates?.get(deviceId);
          stillActive = currentSyncState?.isActive === true;
          currentState = currentSyncState?.state || 'unknown';
        }

        if (!stillActive && stillConnected && stillHasRecords) {
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
          if (stillActive) {
            // ✅ IMPROVEMENT 5: Add to queue instead
            this.addToSyncQueue(deviceId, {
              recordCount: currentRecordCount,
              reason: 'sync_already_active'
            });
          }
        }

        // Always clean up timer after it fires
        if (this.autoSyncTimers) {
          this.autoSyncTimers.delete(deviceId);
        }
      }, this.autoSyncConfig.debounceDelay); // Use configurable debounce delay
      
      // Set the new timer
      this.autoSyncTimers.set(deviceId, syncTimer);
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
        
        // ✅ Track if this is the initial RTC check (first notification after connection)
        const isInitialRTCCheck = currentStats.deviceStatus === 1;
        
        // ✅ Log RTC check (only for first few notifications to avoid spam)
        if (currentStats.deviceStatus <= 3) {
          const deviceTime = parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null;
          const systemTime = Math.floor(Date.now() / 1000);
          const timeDiff = deviceTime ? Math.abs(deviceTime - systemTime) : null;
          
          this.addConnectionLog(deviceId, 'RTC Check: Device Status Read Complete', {
            deviceTime: deviceTime,
            systemTime: systemTime,
            timeDifference: timeDiff,
            timeDifferenceSeconds: timeDiff,
            deviceTimeISO: parsedData.timestamp ? parsedData.timestamp.toISOString() : null,
            systemTimeISO: new Date(systemTime * 1000).toISOString(),
            rtcValid: rtcValid || false,
            isStaleRTC: isStaleRTC || false,
            notificationNumber: currentStats.deviceStatus,
            isInitialCheck: isInitialRTCCheck
          });
        }
        
        // ✅ Log RTC validity determination for initial check (first notification)
        if (isInitialRTCCheck) {
          if (!rtcValid || isStaleRTC) {
            // RTC is invalid - SET_TIME command will be sent by native code
            this.addConnectionLog(deviceId, 'RTC Check: RTC Invalid - SET_TIME Command Will Be Sent', {
              deviceTime: parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null,
              systemTime: Math.floor(Date.now() / 1000),
              rtcValid: false,
              isStaleRTC: isStaleRTC || false,
              action: 'Will send SET_TIME command',
              connectionType: 'manual_or_auto'
            });
          } else {
            // RTC is valid - time sync will be skipped
            this.addConnectionLog(deviceId, 'RTC Check: RTC Valid - Time Sync Skipped', {
              deviceTime: parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null,
              systemTime: Math.floor(Date.now() / 1000),
              rtcValid: true,
              action: 'Skipping time sync, proceeding with data operations',
              connectionType: 'manual_or_auto'
            });
          }
        }
        
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
          }
        }

        if (BLEDataParser.validateData(parsedData)) {
          // ✅ CRITICAL: Don't overwrite synced data with stale characteristic reads!
          // Check if incoming data is stale (before 2020) and we already have synced data
          const hasSyncedData = device.deviceData?.dataSource === 'synced';
          
          if (isStaleRTC && hasSyncedData) {
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

                    const oldDeviceRTC = device.deviceData?.deviceRTC;
          const newDeviceRTC = parsedData.deviceRTC;

          const batteryLevelToUse = device.deviceData?.batteryLevel !== null && device.deviceData?.batteryLevel !== undefined
            ? device.deviceData.batteryLevel
            : (parsedData.batteryLevel !== undefined ? parsedData.batteryLevel : null);
          
          // ✅ CRITICAL FIX: Extract recordCount from parsedData and preserve existing value
          // This code path doesn't have isFromPolling info, so we preserve existing recordCount
          // Only the main device_status handler (line 2163) updates recordCount from polling reads
          const { recordCount: parsedRecordCount, ...parsedDataWithoutRecordCount } = parsedData;
          const preservedRecordCount = device.deviceData?.recordCount; // Preserve existing, don't update from device
          
          device.deviceData = {
            ...device.deviceData,
            ...parsedDataWithoutRecordCount, // Spread without recordCount
            recordCount: preservedRecordCount, // Explicitly preserve existing recordCount
            batteryLevel: batteryLevelToUse,
            dataSource: (parsedData.timestamp && parsedData.timestamp > 1577836800) ? 'live' : (device.deviceData?.dataSource || 'cached'),
            lastUpdate: parsedData.lastUpdate || new Date()
          };
          
          // ✅ DEBUG: Log that we're preserving recordCount
          if (parsedRecordCount !== preservedRecordCount) {
            console.log(`🔒 [handleDeviceStatusUpdate] Preserving recordCount: ${preservedRecordCount} (device reported ${parsedRecordCount}, but this path doesn't have isFromPolling info)`);
          }

          this.scannedDevices.set(deviceId, device);

          const dataChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature ||
            previousData.batteryLevel !== device.deviceData.batteryLevel;

          this.maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData).catch(() => {});
          
          const recordCountChanged = previousData.recordCount !== device.deviceData.recordCount;
          if (recordCountChanged && this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }

          const stepsOrTempChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature;
          
          if (stepsOrTempChanged && parsedData.timestamp && parsedData.timestamp > 1577836800) {
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            
            const existingRecordIndex = device.syncRecords.findIndex(r => {
              const recordTimestamp = r.timestamp || (r.timestampDate ? Math.floor(r.timestampDate.getTime() / 1000) : null);
              return recordTimestamp === parsedData.timestamp;
            });
            
            if (existingRecordIndex >= 0) {
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
              
              try {
                store.dispatch(addRecord({ deviceId, record: newRecord }));
              } catch (error) {
                // Failed to save record to Redux
              }
            }
            
            if (!device.deviceData) {
              device.deviceData = {};
            }
            device.deviceData.recordCount = device.syncRecords.length;
            
            this.emit('deviceDataUpdate', {
              deviceId,
              type: 'live_record',
              records: device.syncRecords,
              totalRecords: device.syncRecords.length
            });
            
            this.scannedDevices.set(deviceId, device);
            
            if (this.onDeviceListUpdated) {
              this.onDeviceListUpdated();
            }
          }

          if (this.onDeviceDataUpdated && this.appState === 'active') {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          }

          const isHistoricalSyncComplete = this.historicalSyncComplete.get(deviceId);
          const isValidLiveData = parsedData.deviceRTC && parsedData.deviceRTC > 1577836800;
          
          if (isHistoricalSyncComplete && isValidLiveData) {
            this.addToLiveBuffer(deviceId, {
              timestamp: parsedData.deviceRTC || (parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null),
              timestampDate: parsedData.lastUpdate || (parsedData.timestamp || new Date()),
              steps: parsedData.steps,
              temperature: parsedData.temperature,
              batteryLevel: parsedData.batteryLevel
            });
            
            await this.checkImmediateAlert(deviceId, {
              temperature: parsedData.temperature,
              steps: parsedData.steps,
              batteryLevel: parsedData.batteryLevel,
              timestampDate: parsedData.lastUpdate
            });
            
            if (this.shouldUploadBatch(deviceId)) {
              await this.uploadLiveBatch(deviceId);
            }
          }
        } else {
        }
      } else {
      }

    } catch (error) {
    }
  }

  handleBatteryUpdate(deviceId, data) {
    try {
      const currentStats = this.notificationCounts.get(deviceId) || {
        deviceStatus: 0, batteryLevel: 0, dataTransfer: 0, systemCommand: 0, total: 0, lastUpdate: null
      };
      currentStats.batteryLevel++;
      currentStats.total++;
      currentStats.lastUpdate = new Date();
      this.notificationCounts.set(deviceId, currentStats);
      
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }
      
      const batteryLevel = BLEDataParser.parseBatteryLevel(data);

      if (batteryLevel !== null) {
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
          lastUpdate: device.deviceData.lastUpdate || new Date()
        };

        this.scannedDevices.set(deviceId, device);

        if (this.onDeviceDataUpdated && this.appState === 'active') {
          this.onDeviceDataUpdated(deviceId, device.deviceData);
        }

        this.adjustTagOptimizationsForBattery(deviceId, batteryLevel);
      }

    } catch (error) {
    }
  }

  adjustTagOptimizationsForBattery(deviceId, batteryLevel) {
    if (batteryLevel <= 15) {
    } else if (batteryLevel <= 30) {
    } else if (batteryLevel >= 80) {
    }
  }

  getCurrentProfileName() {
    if (this.profile === POWER_PROFILE.ultraLowPower) return 'ultraLowPower';
    if (this.profile === POWER_PROFILE.lowPower) return 'lowPower';
    return 'default';
  }

  startPhoneBatteryMonitoring() {
    try {
      this.detectPhoneBatteryLevel();
      
      setInterval(() => {
        this.detectPhoneBatteryLevel();
      }, 30000);
      
    } catch (error) {
      this.phoneBatteryLevel = 100;
      this.setPowerProfile('default');
    }
  }

  async detectPhoneBatteryLevel() {
    try {
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
      
      if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        const newLevel = Math.round(battery.level * 100);
        
        if (newLevel !== this.phoneBatteryLevel) {
          this.phoneBatteryLevel = newLevel;
          this.adjustPhonePowerProfileForBattery(this.phoneBatteryLevel);
        }
        
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
      
      if (this.phoneBatteryLevel === null || this.phoneBatteryLevel === 100) {
        if (this.profile === POWER_PROFILE.ultraLowPower) {
          this.phoneBatteryLevel = 20;
        } else if (this.profile === POWER_PROFILE.lowPower) {
          this.phoneBatteryLevel = 50;
        } else {
          this.phoneBatteryLevel = 80;
        }
      }
      
    } catch (error) {
    }
  }

  adjustPhonePowerProfileForBattery(phoneBatteryLevel) {
    let newProfile = 'default';
    
    if (phoneBatteryLevel <= 15) {
      newProfile = 'ultraLowPower';
    } else if (phoneBatteryLevel <= 30) {
      newProfile = 'lowPower';
    } else if (phoneBatteryLevel >= 80) {
      newProfile = 'default';
    }

    if (phoneBatteryLevel <= 15) {
      this.liveDataConfig.uploadInterval = 600000;
      this.liveDataConfig.bufferSize = 20;
    } else if (phoneBatteryLevel <= 30) {
      this.liveDataConfig.uploadInterval = 420000;
      this.liveDataConfig.bufferSize = 14;
    } else {
      this.liveDataConfig.uploadInterval = 300000;
      this.liveDataConfig.bufferSize = 10;
    }

    const currentProfileName = this.getCurrentProfileName();
    
    if (newProfile !== currentProfileName) {
      this.setPowerProfile(newProfile);
    }
  }

  updateApiTimingForPowerProfile() {
    const profile = this.profile;
    
    if (profile === POWER_PROFILE.ultraLowPower) {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 60000;
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 240000;
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 240000;
      
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 60000;
      this.getApiConfig.BACKGROUND_INTERVAL = 0;
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;
      
    } else if (profile === POWER_PROFILE.lowPower) {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 120000;
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 120000;
      
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 30000;
      this.getApiConfig.BACKGROUND_INTERVAL = 0;
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;
      
    } else {
      this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;
      this.adaptiveApiConfig.BACKGROUND_INTERVAL = 60000;
      this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL = 60000;
      
      this.getApiConfig.ACTIVE_SCREEN_INTERVAL = 15000;
      this.getApiConfig.BACKGROUND_INTERVAL = 0;
      this.getApiConfig.INACTIVE_SCREEN_INTERVAL = 0;
    }
  }

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

  handleSyncStart(deviceId, parsedTransfer) {
    if (parsedTransfer.corrupted) {
      return;
    }
    
    const device = this.scannedDevices.get(deviceId);
    const expectedRecordCount = device?.deviceData?.recordCount || 0;
    const actualRecordCount = parsedTransfer.totalRecords || 0;
    
    // ✅ Log sync start to connection logs (matching original tag behavior)
    this.addConnectionLog(deviceId, 'Data Sync: Sync Start', {
      totalRecords: parsedTransfer.totalRecords || actualRecordCount,
      expectedRecords: actualRecordCount || expectedRecordCount
    });
    
    // ✅ FIX ISSUE #3: Track expected records from sync start
    this.syncExpectedRecords.set(deviceId, actualRecordCount || expectedRecordCount);
    
    const syncState = this.dataSyncStates?.get(deviceId);
    if (syncState) {
      syncState.totalRecords = parsedTransfer.totalRecords || actualRecordCount;
      syncState.expectedRecords = actualRecordCount || expectedRecordCount; // ✅ FIX ISSUE #3: Track expected
      syncState.recordsReceived = 0;
      syncState.lastActivity = Date.now();
    } else {
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
    
    this.emit('dataSyncStart', {
      deviceId,
      totalRecords: parsedTransfer.totalRecords
    });
  }

  async handleSyncComplete(deviceId, parsedTransfer) {
    const syncState = this.dataSyncStates?.get(deviceId);
    const previousState = syncState?.state || 'unknown';
    
    // ✅ FIX ISSUE #3: Clear sync timeout
    const timeout = this.syncTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.syncTimeouts.delete(deviceId);
    }
    
    // ✅ FIX ISSUE #3: Validate sync completion
    const expectedRecords = this.syncExpectedRecords.get(deviceId) || syncState?.expectedRecords || 0;
    const receivedRecords = syncState?.recordsReceived || 0;
    const recordsTransmitted = parsedTransfer.recordsTransmitted || 0;
    
    // Check if sync was incomplete
    const isIncomplete = expectedRecords > 0 && receivedRecords < expectedRecords && recordsTransmitted < expectedRecords;
    
    if (!this.lastSyncCompleteTime) {
      this.lastSyncCompleteTime = new Map();
    }
    
    const lastCompleteTime = this.lastSyncCompleteTime.get(deviceId) || 0;
    const timeSinceLastComplete = Date.now() - lastCompleteTime;
    
    if (timeSinceLastComplete < 1000 && recordsTransmitted > 0) {
      return;
    }
    
    this.lastSyncCompleteTime.set(deviceId, Date.now());
    
    // ✅ Log sync complete to connection logs (matching original tag behavior)
    this.addConnectionLog(deviceId, 'Data Sync: Sync Complete', {
      success: parsedTransfer.success,
      recordsTransmitted: recordsTransmitted,
      expectedRecords: expectedRecords,
      receivedRecords: receivedRecords,
      isIncomplete: isIncomplete
    });
    
    // ✅ FIX ISSUE #3: Log sync completion with validation
    if (isIncomplete) {
      console.warn(`⚠️ [SYNC INCOMPLETE] ${deviceId}: Expected ${expectedRecords}, received ${receivedRecords}, transmitted ${recordsTransmitted}`);
      this.addConnectionLog(deviceId, 'Data Sync: Incomplete', {
        expectedRecords,
        receivedRecords,
        recordsTransmitted,
        isIncomplete: true
      });
      this.logError(deviceId, 'SYNC_INCOMPLETE', {
        expectedRecords,
        receivedRecords,
        recordsTransmitted
      });
      
      // Retry incomplete sync
      this.retryIncompleteSync(deviceId);
      return; // Don't mark as complete if incomplete
    }
    
    // ✅ FIX ISSUE #3: Reset retry counters on successful completion
    this.syncRetryAttempts.delete(deviceId);
    this.syncRetryDelays.delete(deviceId);
    this.syncExpectedRecords.delete(deviceId);
    
    if (parsedTransfer.success) {
      this.logStateTransition(deviceId, previousState, 'complete', 'sync successful');
      
      const updated = this.updateDeviceDataFromSyncedRecords(deviceId);
      
      if (updated) {
        const latestRecord = this.getLatestSyncedRecord(deviceId);
        const device = this.scannedDevices.get(deviceId);
        
        // ✅ FIX: Use actual new records count (after deduplication) instead of recordsTransmitted from device
        // The device sends total records (6), but only some are new (2) after deduplication
        // Calculate actual new records: records after sync - records before sync
        const recordsBeforeSync = device?.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
        const recordsAfterSync = device?.syncRecords?.length || 0;
        const actualNewRecords = Math.max(0, recordsAfterSync - recordsBeforeSync);
        
        // ✅ FIX: Use actual new records count for connection log (with deduplication)
        if (actualNewRecords > 0) {
          const now = Date.now();
          const lastLog = this.lastRecordSyncedLogs.get(deviceId);
          const shouldLog = !lastLog || 
                           (now - lastLog.timestamp) > 500 || // Prevent duplicates within 500ms
                           lastLog.recordCount !== actualNewRecords;
          
          if (shouldLog) {
            this.addConnectionLog(deviceId, `${actualNewRecords} Record${actualNewRecords === 1 ? '' : 's'} Synced`);
            this.lastRecordSyncedLogs.set(deviceId, { timestamp: now, recordCount: actualNewRecords });
          }
        }
        
        const recordCount = device?.syncRecords?.length || 0;
        this.emit('syncDataUpdated', {
          deviceId,
          latestRecord,
          totalRecords: recordCount,
          deviceData: device?.deviceData
        });
      }
      
      if (!this.autoSyncMeta) {
        this.autoSyncMeta = new Map();
      }
      const meta = this.autoSyncMeta.get(deviceId) || {};
      const syncStartTime = meta.lastSyncStartTime || Date.now();
      const syncLatency = Date.now() - syncStartTime;
      meta.lastSyncCompletedAt = Date.now();
      // ✅ CRITICAL FIX: Set syncCompletedRecordCount to 0 after successful sync (iOS path)
      // This matches Android behavior and prevents device_status from overwriting the 0 value
      meta.syncCompletedRecordCount = 0;
      this.autoSyncMeta.set(deviceId, meta);
      
      this.recordSyncSuccess(deviceId, syncLatency);
      
      this.emitUserFeedback(deviceId, 'sync_completed', {
        recordsTransmitted: parsedTransfer.recordsTransmitted || 0,
        latency: syncLatency
      });
      
      // ✅ DemoTag: Automatically send DATA_SYNC_STOP after sync complete (matching native behavior)
      // This ensures Demo Tag works exactly like original tag
      const connectedDevice = this.connectedDevices.get(deviceId);
      if (connectedDevice && connectedDevice.isDemoTag) {
        setTimeout(async () => {
          try {
            // Send DATA_SYNC_STOP with clearFlashData=true (like native code does after successful sync)
            const clearFlashData = true;
            await this.stopDataSync(deviceId, clearFlashData);
            console.log('🏷️ DemoTag: DATA_SYNC_STOP sent after sync complete');
          } catch (error) {
            console.error('🏷️ DemoTag: Failed to send DATA_SYNC_STOP after sync complete:', error);
          }
        }, 1000); // Wait 1 second like native code
      }
      
    } else {
      this.logStateTransition(deviceId, previousState, 'failed', 'sync failed');
      
      this.recordSyncFailure(deviceId, parsedTransfer.reason || 'sync_failed');
      
      this.emitUserFeedback(deviceId, 'sync_failed', {
        reason: parsedTransfer.reason || 'sync_failed'
      });
      
      // ✅ DemoTag: Send DATA_SYNC_STOP without clearing flash on failure (matching native behavior)
      const connectedDevice = this.connectedDevices.get(deviceId);
      if (connectedDevice && connectedDevice.isDemoTag) {
        setTimeout(async () => {
          try {
            // Send DATA_SYNC_STOP with clearFlashData=false (don't clear flash - can retry)
            const clearFlashData = false;
            await this.stopDataSync(deviceId, clearFlashData);
            console.log('🏷️ DemoTag: DATA_SYNC_STOP sent after sync failure (flash NOT cleared)');
          } catch (error) {
            console.error('🏷️ DemoTag: Failed to send DATA_SYNC_STOP after sync failure:', error);
          }
        }, 1000); // Wait 1 second like native code
      }
    }
    
    if (this.dataSyncStates && parsedTransfer.success) {
      const syncState = this.dataSyncStates.get(deviceId);
      if (syncState) {
        syncState.state = 'complete';
        syncState.isActive = false;
      }
      
      setTimeout(() => {
        if (this.dataSyncStates) {
          const currentState = this.dataSyncStates.get(deviceId);
          if (currentState && currentState.state === 'complete') {
            this.dataSyncStates.delete(deviceId);
          }
        }
      }, 3000);
    }
    
    if (this.autoSyncTimers?.has(deviceId)) {
      clearTimeout(this.autoSyncTimers.get(deviceId));
      this.autoSyncTimers.delete(deviceId);
    }
    
    this.processingSync.set(deviceId, false);
    setTimeout(() => this.processSyncQueue(deviceId), 1000);
  }

  handleDataRecord(deviceId, parsedTransfer) {
    const syncState = this.dataSyncStates?.get(deviceId);
    if (syncState) {
      const recordsInPacket = parsedTransfer.recordCount || 0;
      syncState.recordsReceived += recordsInPacket;
      syncState.lastActivity = Date.now();
    }

    if (parsedTransfer.records && parsedTransfer.records.length > 0) {
      const device = this.getDevice(deviceId);
      if (device) {
        if (!device.syncRecords) {
          device.syncRecords = [];
        }
        
        let validCount = 0;
        let invalidCount = 0;
        
        parsedTransfer.records.forEach((record, index) => {
          // ✅ FIX ISSUE #2: Comprehensive data validation to filter corrupted records
          // Filter out records with invalid data (255°C, 65535 steps, invalid dates)
          
          // DemoTag: Parse timestamp - handle number, Date object, or timestampDate
          let recordTimestamp = null;
          if (typeof record.timestamp === 'number') {
            recordTimestamp = record.timestamp;
          } else if (record.timestamp instanceof Date) {
            recordTimestamp = Math.floor(record.timestamp.getTime() / 1000);
          } else if (record.timestampDate) {
            recordTimestamp = Math.floor(new Date(record.timestampDate).getTime() / 1000);
          }
          const currentTimeSeconds = Math.floor(Date.now() / 1000);
          const MIN_VALID_TIMESTAMP = 1577836800; // 2020-01-01 (after Unix epoch)
          const MAX_VALID_TIMESTAMP = currentTimeSeconds + 86400; // Allow 1 day in future for clock drift
          const MIN_VALID_TEMPERATURE = -20; // Minimum reasonable temperature (°C)
          const MAX_VALID_TEMPERATURE = 50; // Maximum reasonable temperature (°C)
          const MAX_VALID_STEPS = 50000; // Maximum reasonable steps per record
          const CORRUPTED_TEMPERATURE = 255; // Max uint8 value indicates corruption
          const CORRUPTED_STEPS = 65535; // Max uint16 value indicates corruption
          
          // Check for corrupted values (max uint8/uint16 values)
          const hasCorruptedTemperature = record.temperature === CORRUPTED_TEMPERATURE || 
                                         record.temperature === undefined || 
                                         record.temperature === null;
          const hasCorruptedSteps = record.steps === CORRUPTED_STEPS || 
                                   (record.steps !== undefined && record.steps < 0);
          
          // Check for invalid temperature range
          const hasInvalidTemperature = record.temperature !== undefined && 
                                       record.temperature !== null &&
                                       (record.temperature < MIN_VALID_TEMPERATURE || 
                                        record.temperature > MAX_VALID_TEMPERATURE);
          
          // Check for invalid steps range
          const hasInvalidSteps = record.steps !== undefined && 
                                 record.steps !== null &&
                                 record.steps > MAX_VALID_STEPS;
          
          // Check for invalid timestamp (too old or too far in future)
          const hasInvalidTimestamp = recordTimestamp !== null && 
                                     (recordTimestamp < MIN_VALID_TIMESTAMP || 
                                      recordTimestamp > MAX_VALID_TIMESTAMP);
          
          // Check if record has any meaningful data
          const hasNoData = (record.steps === undefined || record.steps === null || record.steps === 0) &&
                           (record.temperature === undefined || record.temperature === null || record.temperature === 0) &&
                           (!recordTimestamp || recordTimestamp < MIN_VALID_TIMESTAMP);
          
          // Reject corrupted or invalid records
          if (hasCorruptedTemperature || hasCorruptedSteps || 
              hasInvalidTemperature || hasInvalidSteps || 
              hasInvalidTimestamp || hasNoData) {
            invalidCount++;
            console.warn(`⚠️ [DATA VALIDATION] ${deviceId}: Rejecting invalid record:`, {
              steps: record.steps,
              temperature: record.temperature,
              timestamp: recordTimestamp,
              timestampDate: record.timestampDate,
              reasons: {
                corruptedTemp: hasCorruptedTemperature,
                corruptedSteps: hasCorruptedSteps,
                invalidTemp: hasInvalidTemperature,
                invalidSteps: hasInvalidSteps,
                invalidTimestamp: hasInvalidTimestamp,
                noData: hasNoData
              }
            });
            return;
          }
          
          // Basic validation check (keep existing logic for backward compatibility)
          const isValidRecord = (
            record.steps > 0 ||
            record.temperature > 0 ||
            (recordTimestamp && recordTimestamp > MIN_VALID_TIMESTAMP)
          );
          
          if (!isValidRecord) {
            invalidCount++;
            return;
          }
          
          // recordTimestamp already defined above in validation section
          const receivedAt = new Date();
          const receivedAtSeconds = Math.floor(receivedAt.getTime() / 1000);
          
          // ✅ FIX: Validate timestamp is not in the future (device RTC sync issue)
          // Allow small tolerance (2 seconds) for network delays and processing time
          // Reduced from 5 to 2 seconds to catch smaller RTC drift issues
          const TIMESTAMP_TOLERANCE_SECONDS = 2;
          let adjustedTimestamp = recordTimestamp;
          let timestampAdjusted = false;
          let timestampWarning = null;
          
          if (recordTimestamp && recordTimestamp > receivedAtSeconds + TIMESTAMP_TOLERANCE_SECONDS) {
            const timeDiff = recordTimestamp - receivedAtSeconds;
            timestampWarning = `Device RTC is ${timeDiff} seconds ahead`;
            
            console.warn(`⚠️ [TIMESTAMP VALIDATION] ${deviceId}: Record timestamp is ${timeDiff} seconds in the future`, {
              recordTimestamp,
              receivedAtSeconds,
              timestampDate: record.timestampDate,
              receivedAt: receivedAt.toISOString(),
              timeDiffSeconds: timeDiff
            });
            
            // ✅ FIX: Clamp timestamp to current time to prevent future timestamps
            adjustedTimestamp = receivedAtSeconds;
            timestampAdjusted = true;
            
            // ✅ FIX: Automatically trigger time resync if not done recently (throttle: 30 seconds)
            const timeSyncKey = `${deviceId}_timestamp_fix`;
            const lastTimeSync = this.lastTimeSyncAttempt?.get(timeSyncKey) || 0;
            const timeSinceLastSync = Date.now() - lastTimeSync;
            const TIME_SYNC_THROTTLE_MS = 30000; // 30 seconds
            
            if (timeSinceLastSync > TIME_SYNC_THROTTLE_MS) {
              console.log(`🔄 [AUTO TIME SYNC] ${deviceId}: Triggering time resync due to future timestamp (${timeDiff}s ahead)`);
              
              // Track the sync attempt
              if (!this.lastTimeSyncAttempt) {
                this.lastTimeSyncAttempt = new Map();
              }
              this.lastTimeSyncAttempt.set(timeSyncKey, Date.now());
              
              // Trigger time sync asynchronously (don't block record processing)
              this.syncDeviceTime(deviceId).catch(error => {
                console.error(`❌ [AUTO TIME SYNC] ${deviceId}: Failed to sync device time:`, error);
              });
            } else {
              console.log(`⏸️ [AUTO TIME SYNC] ${deviceId}: Time sync throttled (last sync ${Math.floor(timeSinceLastSync / 1000)}s ago)`);
            }
          }
          
          // ✅ FIX ISSUE #7: Improved duplicate detection with timestamp normalization
          const timestampForDedup = adjustedTimestamp || recordTimestamp;
          if (timestampForDedup) {
            // Normalize timestamps to nearest 30 seconds for comparison (device records every 30s)
            const normalizeTimestamp = (ts) => {
              if (!ts) return null;
              return Math.floor(ts / 30) * 30; // Round to nearest 30 seconds
            };
            
            const normalizedTimestamp = normalizeTimestamp(timestampForDedup);
            
            const existingRecordIndex = device.syncRecords.findIndex(r => {
              const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
              const normalizedExisting = normalizeTimestamp(existingTimestamp);
              
              // Check if timestamps are within 30 seconds and data matches
              return normalizedExisting !== null && 
                     normalizedTimestamp !== null &&
                     normalizedExisting === normalizedTimestamp && 
                     r.steps === record.steps && 
                     r.temperature === record.temperature;
            });
            
            if (existingRecordIndex >= 0) {
              invalidCount++;
              console.log(`⏭️ [DUPLICATE DETECTION] ${deviceId}: Skipping duplicate record (timestamp: ${timestampForDedup}, steps: ${record.steps}, temp: ${record.temperature})`);
              return;
            }
          }
          
          validCount++;
          
          // ✅ FIX: Update record with adjusted timestamp if it was clamped
          // ✅ FIX: Ensure timestampDate is always set (create from timestamp if missing)
          const finalTimestamp = adjustedTimestamp || recordTimestamp;
          let finalTimestampDate = record.timestampDate;
          if (!finalTimestampDate && finalTimestamp) {
            // Create timestampDate string in format "yyyy-MM-dd HH:mm:ss" matching iOS
            const date = new Date(finalTimestamp * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            finalTimestampDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          } else if (timestampAdjusted && finalTimestamp) {
            // Update timestampDate if timestamp was adjusted
            const date = new Date(finalTimestamp * 1000);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            const seconds = String(date.getSeconds()).padStart(2, '0');
            finalTimestampDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
          }
          
          const newRecord = {
            ...record,
            timestamp: finalTimestamp || record.timestamp,
            timestampDate: finalTimestampDate || record.timestampDate, // ✅ FIX: Always ensure timestampDate is set
            receivedAt: receivedAt,
            deviceId,
            ...(timestampWarning ? {
              timestampWarning,
              timestampAdjusted,
              originalTimestamp: recordTimestamp,
              originalTimestampDate: record.timestampDate
            } : {})
          };
          device.syncRecords.push(newRecord);
          
          try {
            store.dispatch(addRecord({ deviceId, record: newRecord }));
          } catch (error) {
            // Failed to save record to Redux
          }
        });
        
        if (validCount > 0) {
          if (!device.deviceData) {
            device.deviceData = {};
          }
          device.deviceData.recordCount = device.syncRecords.length;
          
          // ✅ FIX ISSUE #6: Sort records by timestamp after adding new ones
          device.syncRecords.sort((a, b) => {
            const tsA = a.timestamp || (a.timestampDate ? Math.floor(new Date(a.timestampDate).getTime() / 1000) : 0);
            const tsB = b.timestamp || (b.timestampDate ? Math.floor(new Date(b.timestampDate).getTime() / 1000) : 0);
            return tsA - tsB; // Sort ascending (oldest first)
          });
          
          // ✅ FIX ISSUE #6: Validate timestamp ordering and log gaps
          if (device.syncRecords.length > 1) {
            for (let i = 1; i < device.syncRecords.length; i++) {
              const prev = device.syncRecords[i - 1];
              const curr = device.syncRecords[i];
              const prevTs = prev.timestamp || (prev.timestampDate ? Math.floor(new Date(prev.timestampDate).getTime() / 1000) : 0);
              const currTs = curr.timestamp || (curr.timestampDate ? Math.floor(new Date(curr.timestampDate).getTime() / 1000) : 0);
              
              if (currTs < prevTs) {
                console.warn(`⚠️ [TIMESTAMP ORDER] ${deviceId}: Record ${i} has timestamp before record ${i-1}`, {
                  prevTs,
                  currTs,
                  diff: prevTs - currTs
                });
              }
              
              // Log large gaps (> 1 hour)
              const gap = currTs - prevTs;
              if (gap > 3600) {
                console.log(`ℹ️ [DATA GAP] ${deviceId}: Gap of ${Math.floor(gap / 3600)} hours between records`);
              }
            }
          }
          
          if (this.onDeviceDataUpdated && this.appState === 'active') {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          }
          
          if (this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }
        }
        
        // ✅ FIX: Include sync progress fields (totalReceived, totalExpected) for UI
        const syncState = this.dataSyncStates?.get(deviceId);
        const totalReceived = syncState?.recordsReceived || 0;
        const totalExpected = syncState?.expectedRecords || syncState?.totalRecords || 0;
        const recordsReceived = parsedTransfer.recordCount || 0;
        
        this.emit('deviceDataUpdate', {
          deviceId,
          type: 'sync_records',
          records: parsedTransfer.records,
          totalRecords: device.syncRecords.length,
          // ✅ FIX: Add sync progress fields for UI
          totalReceived: totalReceived,
          totalExpected: totalExpected,
          recordsReceived: recordsReceived
        });
      }
    }
  }

  handleReadError(deviceId, parsedTransfer) {
    setTimeout(async () => {
      try {
        await this.stopDataSync(deviceId, false);
      } catch (error) {
      }
    }, 1000);
  }

  updateDataSyncState(deviceId, parsedTransfer) {
    if (!this.dataSyncStates) {
      this.dataSyncStates = new Map();
    }
    
    let syncState = this.dataSyncStates.get(deviceId);
    if (!syncState) {
      const expectedRecords = this.syncExpectedRecords.get(deviceId) || 0;
      syncState = {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: null,
        expectedRecords: expectedRecords, // ✅ FIX ISSUE #3: Track expected records
        lastActivity: Date.now()
      };
      this.dataSyncStates.set(deviceId, syncState);
    }
    
    // ✅ FIX ISSUE #3: Update records received count
    if (parsedTransfer.recordCount) {
      syncState.recordsReceived = (syncState.recordsReceived || 0) + parsedTransfer.recordCount;
    }
    
    syncState.lastActivity = Date.now();
  }

  handleSystemCommandResponse(deviceId, data) {
    try {
      const response = BLEDataParser.parseSystemCommandResponse(data);
      const commandName = this.getCommandName(response?.command);
      
      // ✅ FIX ISSUE #5: Resolve pending response promise
      if (this.pendingCommandResponses.has(deviceId)) {
        const deviceResponses = this.pendingCommandResponses.get(deviceId);
        const pendingResponse = deviceResponses.get(response?.command);
        if (pendingResponse) {
          clearTimeout(pendingResponse.timeout);
          if (pendingResponse.resolve) {
            // Validate response status
            const isValid = response.status === 0x00 || response.success === true;
            if (isValid) {
              pendingResponse.resolve(response);
            } else {
              pendingResponse.reject(new Error(`Command ${commandName} failed with status ${response.status || 'unknown'}`));
            }
          }
          deviceResponses.delete(response?.command);
        }
      }

      if (response && response.sddCompliant) {
        const normalizedResponse = {
          ...response,
          parsedData: response.data || response.parsedData
        };
        
        const responseKey = `${deviceId}_${normalizedResponse.command}`;
        if (!this.systemCommandResponses) {
          this.systemCommandResponses = new Map();
        }
        
        const existingResponse = this.systemCommandResponses.get(responseKey);
        if (existingResponse) {
          const existingParsedData = existingResponse.parsedData || existingResponse.data;
          const hasValidData = existingParsedData && (
            (existingParsedData.version && existingParsedData.version !== 'Unknown') ||
            existingParsedData.diagnostics ||
            existingParsedData.timestamp ||
            existingParsedData.intervalMs !== undefined
          );
          
          if (hasValidData) {
            return;
          }
        }
        
        this.systemCommandResponses.set(responseKey, normalizedResponse);

        this.emit('systemCommandResponse', {
          deviceId,
          command: response.command,
          response: response
        });

        if (response.success) {
          switch (response.command) {
            case SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME:
              if (!this.timeSyncSentTimes) {
                this.timeSyncSentTimes = new Map();
              }
              this.timeSyncSentTimes.set(deviceId, Date.now());
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL:
              // ✅ DemoTag: Polling restart is already handled by the callback in DemoTagSimulator
              // The callback (onPollingIntervalChanged) is called when SET_DATA_INTERVAL is processed,
              // which triggers stopDemoDevicePolling + startDemoDevicePolling with the new interval.
              // No need to duplicate the restart here - it would cause race conditions.
              const connectedDeviceForInterval = this.connectedDevices.get(deviceId);
              const isDemoTagForInterval = connectedDeviceForInterval?.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
              if (isDemoTagForInterval) {
                const newInterval = DemoTagSimulator.getPollingInterval(deviceId);
                const newIntervalSeconds = newInterval / 1000;
                console.log(`🏷️ DemoTag: SET_DATA_INTERVAL successful for ${deviceId}, polling should be restarted with new interval ${newIntervalSeconds}s (${newInterval}ms) via callback`);
              }
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP:
              // ✅ FIX: Clear Redux historical records when flash is cleared on device
              // Only clear if:
              // 1. We tracked that clearFlashData was true when sending the command
              // 2. There's no active sync (to avoid clearing during chunked sync)
              // 3. Device is NOT a demo tag (demo tags should preserve Redux records even when "flash" is cleared)
              // During chunked sync, records are cleared when sync_complete is received
              const hasActiveSync = this.dataSyncStates?.get(deviceId)?.isActive === true;
              const connectedDevice = this.connectedDevices.get(deviceId);
              const isDemoTag = connectedDevice?.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
              
              if (this.pendingFlashClearCommands && this.pendingFlashClearCommands.get(deviceId) && !hasActiveSync && !isDemoTag) {
                // Flash was cleared on device and sync is not active, so clear historical records in Redux
                // ✅ DEMO TAG FIX: Skip clearing Redux records for demo tags - they should preserve historical data
                try {
                  const { clearDeviceRecords } = require('../../feature/historicalRecordsSlice/historicalRecordsSlice');
                  // ✅ FIX: Use named export instead of .default (store is exported as { store }, not default)
                  const storeModule = require('../../feature/Store');
                  const storeToUse = storeModule.store || storeModule.default?.store || store;
                  if (storeToUse && storeToUse.dispatch) {
                    storeToUse.dispatch(clearDeviceRecords({ deviceId }));
                    console.log(`✅ Cleared Redux historical records for ${deviceId} after flash clear (no active sync)`);
                  } else {
                    console.warn(`⚠️ Redux store not available for clearing records`);
                  }
                } catch (error) {
                  console.warn(`⚠️ Failed to clear Redux historical records:`, error);
                }
                // Remove the tracking flag
                this.pendingFlashClearCommands.delete(deviceId);
              } else if (isDemoTag && this.pendingFlashClearCommands && this.pendingFlashClearCommands.get(deviceId)) {
                // ✅ DEMO TAG FIX: For demo tags, just remove the tracking flag without clearing Redux
                // Demo tag's internal "flash" is cleared, but Redux records should persist
                console.log(`🏷️ DemoTag: Flash cleared on device, but preserving Redux historical records for ${deviceId}`);
                this.pendingFlashClearCommands.delete(deviceId);
              }
              break;
          case SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET:
            (async () => {
              try {
                await this.removeDeviceFromBondedList(deviceId);
              } catch (error) {
              }
            })();
            break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART:
              if (!this.deviceRestartTimes) {
                this.deviceRestartTimes = new Map();
              }
              this.deviceRestartTimes.set(deviceId, Date.now());
              
              setTimeout(async () => {
                try {
                  const device = this.scannedDevices.get(deviceId);
                  const deviceData = device?.deviceData;
                  const rtcStillInvalid = !deviceData?.rtcValid || 
                    (deviceData?.lastUpdate && deviceData.lastUpdate < new Date('2020-01-01'));
                  
                  if (rtcStillInvalid) {
                    await this.syncDeviceTime(deviceId);
                  }
                } catch (error) {
                }
              }, 5000);
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER:
              break;
            default:
          }
        }
      }

    } catch (error) {
    }
  }

  async readCharacteristic(deviceId, serviceUUID, characteristicUUID) {
    try {
      // DemoTag: Check if this is a demo device
      if (DemoTagSimulator.isDemoDevice(deviceId)) {
        return await this.readDemoCharacteristic(deviceId, serviceUUID, characteristicUUID);
      }

      return await (this.operationQueue = this.operationQueue.then(async () => {
        if (Platform.OS === 'android') {
          const result = await SampleBridgeAndroid.readCharacteristicForService(
            deviceId, 
            serviceUUID, 
            characteristicUUID
          );
          return result;
        } else {
          const readPromise = BridgingCodeModule.readCharacteristic(deviceId, characteristicUUID);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Characteristic read timeout after 5 seconds')), 5000)
          );
          
          const result = await Promise.race([readPromise, timeoutPromise]);
          return result.data;
        }
      }));
    } catch (error) {
      if (error.message && (
        error.message.includes('not found') ||
        error.message.includes('timeout') ||
        error.message.includes('Failed to initiate read') ||
        error.message.includes('READ_FAILED') ||
        error.message.includes('READ_NOT_SUPPORTED') ||
        error.code === 'READ_FAILED' ||
        error.code === 'READ_NOT_SUPPORTED'
      )) {
        return null;
      }
      throw error;
    }
  }

  /**
   * DemoTag: Read demo characteristic
   */
  async readDemoCharacteristic(deviceId, serviceUUID, characteristicUUID) {
    try {
      // ✅ DemoTag: Log characteristic read (matching original tag behavior)
      // Only log non-data-transfer reads to avoid excessive logging during sync
      if (characteristicUUID !== BLE_CHARACTERISTICS.DATA_TRANSFER) {
        const characteristicName = characteristicUUID === BLE_CHARACTERISTICS.DEVICE_STATUS ? 'Device Status' :
                                   characteristicUUID === BLE_CHARACTERISTICS.BATTERY_LEVEL ? 'Battery Level' :
                                   characteristicUUID === BLE_CHARACTERISTICS.MANUFACTURER_NAME ? 'Manufacturer Name' :
                                   characteristicUUID === BLE_CHARACTERISTICS.MODEL_NUMBER ? 'Model Number' :
                                   characteristicUUID === BLE_CHARACTERISTICS.SERIAL_NUMBER ? 'Serial Number' :
                                   characteristicUUID === BLE_CHARACTERISTICS.FIRMWARE_REVISION ? 'Firmware Revision' :
                                   characteristicUUID === BLE_CHARACTERISTICS.HARDWARE_REVISION ? 'Hardware Revision' :
                                   characteristicUUID;
        
        this.addConnectionLog(deviceId, `Read Characteristic: ${characteristicName}`, {
          characteristicUUID: characteristicUUID,
          serviceUUID: serviceUUID,
          source: 'demo_tag'
        });
      }
      
      // DemoTag: Handle different characteristics
      if (characteristicUUID === BLE_CHARACTERISTICS.DEVICE_STATUS) {
        return DemoTagSimulator.readDeviceStatus(deviceId);
      } else if (characteristicUUID === BLE_CHARACTERISTICS.BATTERY_LEVEL) {
        const device = DemoTagSimulator.getDemoDevice(deviceId);
        if (device && device.deviceData) {
          const batteryLevel = Buffer.from([device.deviceData.batteryLevel]);
          return batteryLevel.toString('base64');
        }
      } else if (characteristicUUID === BLE_CHARACTERISTICS.DATA_TRANSFER) {
        // DemoTag: Handle data transfer reads (for data sync)
        return this.readDemoDataTransfer(deviceId);
      } else if ([
        BLE_CHARACTERISTICS.MANUFACTURER_NAME,
        BLE_CHARACTERISTICS.MODEL_NUMBER,
        BLE_CHARACTERISTICS.SERIAL_NUMBER,
        BLE_CHARACTERISTICS.FIRMWARE_REVISION,
        BLE_CHARACTERISTICS.HARDWARE_REVISION,
      ].includes(characteristicUUID)) {
        return DemoTagSimulator.readDeviceInfo(deviceId, characteristicUUID);
      }
      
      return null;
    } catch (error) {
      console.error('🏷️ DemoTag: Error reading characteristic:', error);
      return null;
    }
  }

  /**
   * DemoTag: Start data sync flow (simulates native data sync)
   */
  async startDemoDataSyncFlow(deviceId) {
    try {
      // DemoTag: Get records
      const records = DemoTagSimulator.historicalRecords.get(deviceId) || [];
      const recordCount = records.length;
      
      if (recordCount === 0) {
        // DemoTag: No records, send sync_complete with 0 records
        const syncComplete = DemoTagSimulator.completeDataSync(deviceId, 0);
        this.handleDataTransfer(deviceId, syncComplete);
        return;
      }

      // DemoTag: Send sync_start
      const syncStart = DemoTagSimulator.startDataSync(deviceId);
      this.handleDataTransfer(deviceId, syncStart);

      // DemoTag: Send records in batches (2 records per packet, like real device)
      const sendNextBatch = () => {
        const syncPosition = DemoTagSimulator.getSyncPosition(deviceId);
        const remainingRecords = records.slice(syncPosition);
        
        if (remainingRecords.length === 0) {
          // DemoTag: All records sent, send sync_complete
          DemoTagSimulator.clearSyncPosition(deviceId);
          const syncComplete = DemoTagSimulator.completeDataSync(deviceId, recordCount);
          setTimeout(() => {
            this.handleDataTransfer(deviceId, syncComplete);
          }, 100);
          return;
        }

        // DemoTag: Send next batch (2 records)
        const recordData = DemoTagSimulator.getNextDataRecords(deviceId, 2, syncPosition);
        
        if (recordData) {
          setTimeout(() => {
            this.handleDataTransfer(deviceId, recordData);
            // DemoTag: Update sync position
            DemoTagSimulator.setSyncPosition(deviceId, syncPosition + 2);
            // DemoTag: Send next batch after short delay (simulate native read timing)
            setTimeout(sendNextBatch, 150);
          }, 50);
        } else {
          // DemoTag: No more records, send sync_complete
          DemoTagSimulator.clearSyncPosition(deviceId);
          const syncComplete = DemoTagSimulator.completeDataSync(deviceId, recordCount);
          setTimeout(() => {
            this.handleDataTransfer(deviceId, syncComplete);
          }, 100);
        }
      };

      // DemoTag: Start sending records after sync_start
      setTimeout(sendNextBatch, 200);
    } catch (error) {
      console.error('🏷️ DemoTag: Error starting data sync:', error);
    }
  }

  /**
   * DemoTag: Read data transfer characteristic (returns next sync data)
   */
  readDemoDataTransfer(deviceId) {
    // DemoTag: Check if sync is active
    const syncState = this.dataSyncStates?.get(deviceId);
    if (!syncState || !syncState.isActive) {
      return null;
    }

    const syncPosition = DemoTagSimulator.getSyncPosition(deviceId);
    const records = DemoTagSimulator.historicalRecords.get(deviceId) || [];
    
    // DemoTag: If at start, return sync_start
    if (syncPosition === 0 && syncState.recordsReceived === 0) {
      const syncStart = DemoTagSimulator.startDataSync(deviceId);
      return syncStart;
    }

    // DemoTag: If all records sent, return sync_complete
    if (syncPosition >= records.length) {
      DemoTagSimulator.clearSyncPosition(deviceId);
      const syncComplete = DemoTagSimulator.completeDataSync(deviceId, records.length);
      return syncComplete;
    }

    // DemoTag: Return next batch of records
    const recordData = DemoTagSimulator.getNextDataRecords(deviceId, 2, syncPosition);
    if (recordData) {
      // DemoTag: Update sync position for next read
      DemoTagSimulator.setSyncPosition(deviceId, syncPosition + 2);
    }
    
    return recordData;
  }

  /**
   * DemoTag: Write demo characteristic
   */
  async writeDemoCharacteristic(deviceId, characteristicUUID, data, withResponse = true) {
    try {
      // DemoTag: Convert data to buffer
      let dataBuffer;
      if (data instanceof Uint8Array) {
        dataBuffer = Buffer.from(data);
      } else if (Array.isArray(data)) {
        dataBuffer = Buffer.from(data);
      } else if (typeof data === 'string') {
        // Assume hex string
        dataBuffer = Buffer.from(data, 'hex');
      } else {
        dataBuffer = Buffer.from(data);
      }

      // DemoTag: Handle system command
      if (characteristicUUID === BLE_CHARACTERISTICS.SYSTEM_COMMAND) {
        // DemoTag: Parse command
        const requestId = dataBuffer.readUInt8(0);
        const commandId = dataBuffer.readUInt8(1);
        const commandLength = dataBuffer.readUInt8(2);
        const commandData = dataBuffer.slice(3, 3 + commandLength);

        // ✅ DemoTag: Log command sent to connection logs (matching original tag behavior)
        const commandName = this.getCommandName(commandId);
        const commandHex = Array.from(dataBuffer).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
        this.addConnectionLog(deviceId, `Command: ${commandName}`, {
          commandId: `0x${commandId.toString(16).padStart(2, '0')}`,
          commandName: commandName,
          commandHex: commandHex,
          payloadLength: commandLength,
          source: 'demo_tag'
        });

        // DemoTag: Handle command
        const response = await DemoTagSimulator.handleSystemCommand(deviceId, commandId, commandData);
        
        // DemoTag: If DATA_SYNC_START, start data sync flow
        if (commandId === SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START) {
          // DemoTag: Initialize sync state
          if (!this.dataSyncStates) {
            this.dataSyncStates = new Map();
          }
          const records = DemoTagSimulator.historicalRecords.get(deviceId) || [];
          this.dataSyncStates.set(deviceId, {
            isActive: true,
            startTime: Date.now(),
            recordsReceived: 0,
            totalRecords: records.length,
            expectedRecords: records.length,
            lastActivity: Date.now(),
          });
          DemoTagSimulator.setSyncPosition(deviceId, 0);
          
          // DemoTag: Start sending sync data (simulate native reading DATA_TRANSFER)
          setTimeout(() => {
            this.startDemoDataSyncFlow(deviceId);
          }, 200);
        }
        
        // DemoTag: Simulate response notification
        if (response) {
          // DemoTag: Response is base64 string, convert to Buffer first
          const responseBuffer = Buffer.from(response, 'base64');
          const responseHex = responseBuffer.toString('hex');
          const commandIdFromResponse = responseBuffer.readUInt8(1);
          const responseStatus = responseBuffer.readUInt8(3);
          
          setTimeout(() => {
            this.handleNativeSystemCommandResponse({
              deviceId: deviceId,
              commandId: commandIdFromResponse,
              rawResponse: responseHex,
              rawData: responseHex,
              dataLength: responseBuffer.length,
              responseStatus: responseStatus,
              status: responseStatus === SYSTEM_COMMAND_CONSTANTS.STATUS.SUCCESS ? 'success' : 'error',
              commandName: this.getCommandName(commandIdFromResponse),
              characteristicUUID: BLE_CHARACTERISTICS.SYSTEM_COMMAND,
            });
          }, 100);
        } else {
          // ✅ DemoTag: Log response even if no response data (for commands that don't return data)
          const responseCommandName = this.getCommandName(commandId);
          this.addConnectionLog(deviceId, `Response: ${responseCommandName}`, {
            commandId: `0x${commandId.toString(16).padStart(2, '0')}`,
            commandName: responseCommandName,
            success: true,
            source: 'demo_tag'
          });
        }

        return true;
      }

      // DemoTag: Handle data transfer (for data sync)
      if (characteristicUUID === BLE_CHARACTERISTICS.DATA_TRANSFER) {
        // DemoTag: Data sync is handled separately
        return true;
      }

      return true;
    } catch (error) {
      console.error('🏷️ DemoTag: Error writing characteristic:', error);
      throw error;
    }
  }

  async writeCharacteristic(deviceId, characteristicUUID, data, withResponse = true, serviceUUID = null) {
    try {
      // DemoTag: Check if this is a demo device
      if (DemoTagSimulator.isDemoDevice(deviceId)) {
        return await this.writeDemoCharacteristic(deviceId, characteristicUUID, data, withResponse);
      }

      return await (this.operationQueue = this.operationQueue.then(async () => {
        let dataToSend;
        if (data instanceof Uint8Array) {
          dataToSend = data;
        } else if (Array.isArray(data)) {
          dataToSend = new Uint8Array(data);
        } else {
          dataToSend = new Uint8Array(data);
        }
        
        const hexData = Array.from(dataToSend)
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join('');
        
        const isSystemCommand = characteristicUUID.toLowerCase().replace(/-/g, '') === 
          BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '');
        
        if (!isSystemCommand) {
          const dataPreview = dataToSend.length > 20 
            ? Array.from(dataToSend.slice(0, 20)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ') + '...'
            : Array.from(dataToSend).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ');
          
          this.addConnectionLog(deviceId, `Write Characteristic: ${characteristicUUID}`, {
            characteristicUUID: characteristicUUID,
            dataLength: dataToSend.length,
            dataPreview: dataPreview,
            withResponse: withResponse
          });
        }
        
        if (Platform.OS === 'android') {
          await SampleBridgeAndroid.writeCharacteristic(
            deviceId, 
            characteristicUUID, 
            hexData
          );
          return true;
        } else {
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

  async syncDeviceTime(deviceId) {
    try {
      const currentTime = Math.floor(Date.now() / 1000);
      
      // ✅ Log time sync attempt
      this.addConnectionLog(deviceId, 'Time Sync: Sending SET_TIME Command', {
        systemTime: currentTime,
        systemTimeISO: new Date(currentTime * 1000).toISOString(),
        trigger: 'manual_or_auto'
      });
      
      const timestampBytes = [
        currentTime & 0xFF,
        (currentTime >> 8) & 0xFF,
        (currentTime >> 16) & 0xFF,
        (currentTime >> 24) & 0xFF
      ];
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes, { waitForResponse: true });
      
      if (result.success) {
        // ✅ Log successful time sync command sent
        this.addConnectionLog(deviceId, 'Time Sync: SET_TIME Command Sent', {
          systemTime: currentTime,
          success: true
        });
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        try {
          const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
          
          if (deviceStatusData) {
            const parsedData = BLEDataParser.parseDeviceStatus(deviceStatusData);
            
            if (parsedData && parsedData.timestamp) {
              const deviceTime = Math.floor(parsedData.timestamp.getTime() / 1000);
              const systemTime = Math.floor(Date.now() / 1000);
              const timeDiff = Math.abs(deviceTime - systemTime);
              
              // ✅ Log RTC validation after time sync
              this.addConnectionLog(deviceId, 'Time Sync: RTC Validation', {
                deviceTime: deviceTime,
                systemTime: systemTime,
                timeDifference: timeDiff,
                timeDifferenceSeconds: timeDiff,
                deviceTimeISO: parsedData.timestamp.toISOString(),
                systemTimeISO: new Date(systemTime * 1000).toISOString(),
                rtcValid: parsedData.rtcValid || false,
                syncSuccessful: timeDiff < 5 // Consider sync successful if within 5 seconds
              });
            }
          }
        } catch (error) {
          // ✅ Log RTC validation failure
          this.addConnectionLog(deviceId, 'Time Sync: RTC Validation Failed', {
            error: error.message || 'Failed to read device status after time sync',
            systemTime: currentTime
          });
        }
      } else {
        // ✅ Log time sync command failure
        this.addConnectionLog(deviceId, 'Time Sync: SET_TIME Command Failed', {
          systemTime: currentTime,
          success: false,
          error: result.error || 'Unknown error'
        });
      }
      
      return result;
    } catch (error) {
      // ✅ Log time sync exception
      this.addConnectionLog(deviceId, 'Time Sync: Exception', {
        error: error.message || 'Unknown error',
        systemTime: Math.floor(Date.now() / 1000)
      });
      return { success: false, error: error.message };
    }
  }

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

  getSyncRecords(deviceId) {
    const device = this.getDevice(deviceId);
    if (device && device.syncRecords) {
      return device.syncRecords;
    }
    return [];
  }

  getLatestSyncedRecord(deviceId) {
    const records = this.getSyncRecords(deviceId);
    if (!records || records.length === 0) {
      return null;
    }
    
    const latestRecord = records.reduce((latest, current) => {
      if (!latest) return current;
      
      const latestTime = latest.timestamp instanceof Date ? latest.timestamp.getTime() : latest.timestamp * 1000;
      const currentTime = current.timestamp instanceof Date ? current.timestamp.getTime() : current.timestamp * 1000;
      
      return currentTime > latestTime ? current : latest;
    }, null);
    
    return latestRecord;
  }

  updateDeviceDataFromSyncedRecords(deviceId) {
    const latestRecord = this.getLatestSyncedRecord(deviceId);
    if (!latestRecord) {
      return false;
    }
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      return false;
    }
    
    const totalSteps = (device.syncRecords || []).reduce((sum, record) => {
      return sum + (record.steps || 0);
    }, 0);
    
    const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r => 
      r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
    ) || latestRecord;
    
    const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r => 
      r.steps != null && r.steps !== undefined && r.steps > 0
    ) || latestRecord;
    
    if (!device.deviceData) {
      device.deviceData = {};
    }
    
    let syncedDate;
    if (latestRecord.timestampDate && latestRecord.timestampDate instanceof Date) {
      syncedDate = latestRecord.timestampDate;
    } else if (typeof latestRecord.timestamp === 'number') {
      syncedDate = new Date(latestRecord.timestamp * 1000);
    } else {
      syncedDate = new Date();
    }
    
    const finalTemperature = latestRecordWithTemp.temperature != null && latestRecordWithTemp.temperature !== undefined
      ? latestRecordWithTemp.temperature 
      : (device.deviceData.temperature != null ? device.deviceData.temperature : null);
    
    const finalSteps = latestRecordWithSteps.steps != null && latestRecordWithSteps.steps !== undefined
      ? latestRecordWithSteps.steps 
      : (device.deviceData.steps != null ? device.deviceData.steps : null);
    
    const finalRecordCount = 0;
    
    device.deviceData = {
      ...device.deviceData,
      temperature: finalTemperature,
      steps: finalSteps,
      totalSteps: totalSteps,
      recordCount: finalRecordCount,
      lastUpdate: syncedDate,
      dataSource: 'synced',
      syncedAt: new Date()
    };
    
    if (device.manufacturerData) {
      device.manufacturerData.recordCount = finalRecordCount;
      device.manufacturerData.hasRecords = finalRecordCount > 0;
    }
    
    this.scannedDevices.set(deviceId, device);
    
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    }
    
    if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
      setTimeout(() => {
        try {
        this.onDeviceListUpdated();
        } catch (error) {
        }
      }, 100);
    }
    
    // ✅ CRITICAL FIX: Include syncJustCompleted and syncCompletedRecordCount flags
    // This prevents device_status events from overwriting recordCount=0 after sync
    const syncJustCompleted = (() => {
      if (!this.autoSyncMeta) return false;
      const meta = this.autoSyncMeta.get(deviceId);
      if (!meta || !meta.lastSyncCompletedAt) return false;
      const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
      return timeSinceSync < 15000; // 15 second grace period
    })();
    
    const syncCompletedRecordCount = (() => {
      if (!this.autoSyncMeta) return undefined;
      const meta = this.autoSyncMeta.get(deviceId);
      return meta?.syncCompletedRecordCount;
    })();
    
    this.emit('deviceDataUpdate', {
      deviceId,
      type: 'sync_complete',
      deviceData: device.deviceData,
      recordCount: device.deviceData.recordCount,
      syncJustCompleted: syncJustCompleted,
      syncCompletedRecordCount: syncCompletedRecordCount
    });
    
    return true;
  }

  clearSyncRecords(deviceId, clearHistorical = false) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.syncRecords = [];
    }
    
    if (clearHistorical) {
      try {
        const { clearDeviceRecords } = require('../../feature/historicalRecordsSlice/historicalRecordsSlice');
        store.dispatch(clearDeviceRecords({ deviceId }));
      } catch (error) {
      }
    }
  }

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

  addConnectionLog(deviceId, action, additionalInfo = {}) {
    const device = this.getDevice(deviceId);
    
    const logEntry = {
      action,
      timestamp: new Date(),
      ...additionalInfo
    };

    if (device) {
      if (!device.connectionLogs) {
        device.connectionLogs = [];
      }
      device.connectionLogs.push(logEntry);
    }

    try {
      store.dispatch(addLog({
        deviceId,
        log: logEntry
      }));
    } catch (error) {
    }

    const totalLogs = device?.connectionLogs?.length || 0;
    this.emit('connectionLogUpdated', {
      deviceId,
      log: logEntry,
      totalLogs: totalLogs
    });
  }

  // ✅ Helper: Flush pending characteristics logs immediately (used on disconnect/cleanup)
  flushPendingCharacteristicsLogs(deviceId) {
    const pending = this.pendingCharacteristicsLogs.get(deviceId);
    if (pending && pending.length > 0) {
      // Clear the timer
      const batchTimer = this.characteristicsLogBatchTimers.get(deviceId);
      if (batchTimer) {
        clearTimeout(batchTimer);
        this.characteristicsLogBatchTimers.delete(deviceId);
      }
      
      // Log all pending discoveries
      if (!this.lastCharacteristicsDiscoveryLog.has(deviceId)) {
        this.lastCharacteristicsDiscoveryLog.set(deviceId, new Map());
      }
      const deviceCharLogs = this.lastCharacteristicsDiscoveryLog.get(deviceId);
      
      if (pending.length > 1) {
        // Batch log multiple services
        const serviceNames = pending.map(p => p.serviceName).join(', ');
        const totalCharacteristics = pending.reduce((sum, p) => sum + p.characteristicCount, 0);
        const totalAdded = pending.reduce((sum, p) => sum + p.addedCount, 0);
        
        this.addConnectionLog(deviceId, `Characteristics Discovered (${pending.length} services: ${serviceNames})`, {
          serviceCount: pending.length,
          totalCharacteristicCount: totalCharacteristics,
          totalAddedCount: totalAdded,
          services: pending.map(p => ({
            serviceName: p.serviceName,
            serviceUuid: p.serviceUuid,
            characteristicCount: p.characteristicCount,
            addedCount: p.addedCount
          })),
          platform: 'iOS'
        });
      } else {
        // Single service
        const log = pending[0];
        this.addConnectionLog(deviceId, `Characteristics Discovered (${log.serviceName})`, {
          serviceUuid: log.serviceUuid,
          serviceName: log.serviceName,
          characteristicCount: log.characteristicCount,
          addedCount: log.addedCount,
          duplicateCount: log.duplicateCount,
          platform: 'iOS'
        });
      }
      
      // Update last log timestamps
      pending.forEach(log => {
        deviceCharLogs.set(log.serviceUuid, {
          timestamp: log.timestamp,
          characteristicCount: log.characteristicCount,
          addedCount: log.addedCount
        });
      });
      
      // Clear pending logs
      this.pendingCharacteristicsLogs.delete(deviceId);
    }
  }

  getConnectionLogs(deviceId) {
    const device = this.getDevice(deviceId);
    if (device && device.connectionLogs) {
      return device.connectionLogs;
    }
    return [];
  }

  clearConnectionLogs(deviceId) {
    const device = this.getDevice(deviceId);
    if (device) {
      device.connectionLogs = [];
      
      try {
        store.dispatch(clearDeviceLogs({ deviceId }));
      } catch (error) {
      }
      
      this.emit('connectionLogUpdated', {
        deviceId,
        log: null,
        totalLogs: 0
      });
    }
  }

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

      const syncState = this.dataSyncStates?.get(deviceId);
      if (syncState) {
        verificationResults.dataSyncStatus = {
          isActive: syncState.isActive,
          recordsReceived: syncState.recordsReceived,
          totalRecords: syncState.totalRecords,
          duration: Date.now() - syncState.startTime
        };
      }

      try {
        const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        
        if (deviceStatusData) {
          const parsedData = BLEDataParser.parseDeviceStatus(deviceStatusData);
          if (parsedData && parsedData.timestamp) {
            verificationResults.lastDataTimestamp = parsedData.timestamp;
            const timeDiff = Date.now() - (parsedData.timestamp.unix * 1000);
            
            verificationResults.freshDataDetected = timeDiff < 120000;
            verificationResults.dataCleared = timeDiff < 300000;
          }
        }
      } catch (error) {
      }

      try {
        const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
        
        if (batteryData) {
          verificationResults.notificationsActive = true;
        }
      } catch (error) {
      }

      const monitoringSub = this.monitoringSubscriptions.get(deviceId);
      if (monitoringSub) {
        verificationResults.notificationsActive = verificationResults.notificationsActive || (monitoringSub.characteristics?.length > 0);
      }

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

  // ✅ FIX ISSUE #8: Standardized command naming (consistent format)
  getCommandName(command) {
    const commandNames = {
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME]: 'SET_SYSTEM_TIME',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL]: 'SET_ADV_INTERVAL', 
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL]: 'SET_CONN_INTERVAL',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL]: 'SET_DATA_ACQUISITION_INTERVAL',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION]: 'GET_FIRMWARE_VERSION',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION]: 'GET_HARDWARE_VERSION',
      [SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS]: 'GET_DIAGNOSTICS',
      [SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START]: 'DATA_SYNC_START',
      [SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP]: 'DATA_SYNC_STOP',
      [SYSTEM_COMMAND_CONSTANTS.CMD.ENTER_DFU_MODE]: 'ENTER_DFU_MODE',
      [SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART]: 'SYSTEM_RESTART',
      [SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER]: 'TOGGLE_BUZZER',
      [SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE]: 'UNPAIR_DEVICE',
      [SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET]: 'FACTORY_RESET',
      [SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE]: 'PASSKEY_UPDATE'
    };
    return commandNames[command] || `Unknown Command (0x${command.toString(16).padStart(2, '0')})`;
  }

  // ✅ FIX ISSUE #4 & #5: Wrapper with command deduplication and response validation
  async sendSystemCommandWithValidation(deviceId, command, payload = [], options = {}) {
    const commandName = this.getCommandName(command);
    const now = Date.now();
    
    // ✅ FIX ISSUE #4: Check for duplicate commands
    if (!this.pendingCommands.has(deviceId)) {
      this.pendingCommands.set(deviceId, new Map());
    }
    const devicePendingCommands = this.pendingCommands.get(deviceId);
    
    // Check if same command was sent recently
    const lastCommand = devicePendingCommands.get(command);
    if (lastCommand && (now - lastCommand.timestamp) < this.commandDedupeWindow) {
      console.log(`⏭️ [COMMAND DEDUP] ${deviceId}: Skipping duplicate ${commandName} command (sent ${now - lastCommand.timestamp}ms ago)`);
      this.addConnectionLog(deviceId, `Command Deduplicated: ${commandName}`, {
        reason: 'duplicate_within_window',
        timeSinceLastCommand: now - lastCommand.timestamp
      });
      return lastCommand.promise; // Return existing promise
    }
    
    // ✅ FIX ISSUE #5: Check if another command is in progress
    const inProgressCommand = this.commandInProgress.get(deviceId);
    if (inProgressCommand && inProgressCommand !== command) {
      // Queue this command
      if (!this.commandQueue.has(deviceId)) {
        this.commandQueue.set(deviceId, []);
      }
      const queue = this.commandQueue.get(deviceId);
      queue.push({ command, payload, options, timestamp: now });
      console.log(`📋 [COMMAND QUEUE] ${deviceId}: Queued ${commandName} (${inProgressCommand} in progress)`);
      this.addConnectionLog(deviceId, `Command Queued: ${commandName}`, {
        reason: 'another_command_in_progress',
        inProgressCommand: this.getCommandName(inProgressCommand)
      });
      
      // Return a promise that resolves when command is executed
      return new Promise((resolve, reject) => {
        const checkQueue = () => {
          const currentInProgress = this.commandInProgress.get(deviceId);
          if (!currentInProgress || currentInProgress === command) {
            // Our turn - execute command
            this.sendSystemCommandWithValidation(deviceId, command, payload, options)
              .then(resolve)
              .catch(reject);
          } else {
            setTimeout(checkQueue, 100); // Check again in 100ms
          }
        };
        checkQueue();
      });
    }
    
    // Mark command as in progress
    this.commandInProgress.set(deviceId, command);
    
    // Create promise for this command
    const commandPromise = this.sendSystemCommand(deviceId, command, payload, options)
      .then(async (result) => {
        // ✅ FIX ISSUE #5: Wait for response validation
        if (options.waitForResponse !== false) {
          const responseKey = `${deviceId}_${command}`;
          const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Response timeout for ${commandName} after ${this.COMMAND_RESPONSE_TIMEOUT_MS}ms`));
            }, this.COMMAND_RESPONSE_TIMEOUT_MS);
            
            // Store response handler
            if (!this.pendingCommandResponses.has(deviceId)) {
              this.pendingCommandResponses.set(deviceId, new Map());
            }
            const responseHandlers = this.pendingCommandResponses.get(deviceId);
            responseHandlers.set(command, {
              resolve,
              reject,
              timeout,
              timestamp: now
            });
          });
          
          try {
            await responsePromise;
            // Response received - validation passed
          } catch (error) {
            console.warn(`⚠️ [RESPONSE VALIDATION] ${deviceId}: ${commandName} - ${error.message}`);
            this.addConnectionLog(deviceId, `Response Timeout: ${commandName}`, {
              error: error.message,
              commandId: command
            });
            // Don't fail the command, just log the warning
          }
        }
        
        return result;
      })
      .finally(() => {
        // Clear in-progress flag
        this.commandInProgress.delete(deviceId);
        
        // Remove from pending commands after dedupe window
        setTimeout(() => {
          devicePendingCommands.delete(command);
        }, this.commandDedupeWindow);
        
        // Process next command in queue
        this.processCommandQueue(deviceId);
      });
    
    // Store command in pending map
    devicePendingCommands.set(command, {
      timestamp: now,
      promise: commandPromise
    });
    
    return commandPromise;
  }
  
  // ✅ FIX ISSUE #4: Process command queue
  processCommandQueue(deviceId) {
    const queue = this.commandQueue.get(deviceId);
    if (!queue || queue.length === 0) {
      return;
    }
    
    const inProgress = this.commandInProgress.get(deviceId);
    if (inProgress) {
      return; // Still processing
    }
    
    const nextCommand = queue.shift();
    if (nextCommand) {
      console.log(`▶️ [COMMAND QUEUE] ${deviceId}: Processing queued ${this.getCommandName(nextCommand.command)}`);
      this.sendSystemCommandWithValidation(deviceId, nextCommand.command, nextCommand.payload, nextCommand.options)
        .catch(error => {
          console.error(`❌ [COMMAND QUEUE] ${deviceId}: Failed to execute queued command:`, error);
        });
    }
  }

  async sendSystemCommand(deviceId, command, payload = [], options = {}) {
    let payloadToSend = [];
    let smartTagService = null;
    let sysCmdChar = null;
    
    const commandName = this.getCommandName(command);
    const startTime = Date.now();
    
    try {
      const device = this.connectedDevices.get(deviceId);
      
      if (!device) {
        return { success: false, error: 'Device not connected' };
      }

      // DemoTag: Route system commands to demo handler
      if (device.isDemoTag) {
        const packet = new Array(SYSTEM_COMMAND_CONSTANTS.PACKET_SIZE).fill(0);
        payloadToSend = (Array.isArray(payload) ? payload : []).slice(0);
        
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.REQUEST_ID_OFFSET] = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_ID_OFFSET] = command;
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_LENGTH_OFFSET] = payloadToSend.length;
        
        for (let i = 0; i < payloadToSend.length && i < 17; i++) {
          packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET + i] = payloadToSend[i];
        }
        
        // DemoTag: Write to demo characteristic (this will handle the command and emit response)
        await this.writeDemoCharacteristic(deviceId, BLE_CHARACTERISTICS.SYSTEM_COMMAND, packet, true);
        
        const duration = Date.now() - startTime;
        return { success: true, duration, commandName };
      }

      if (Platform.OS === 'android') {
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (!scannedDevice || !scannedDevice.services || !scannedDevice.characteristics) {
          return { success: false, error: 'Device services/characteristics not available' };
        }

        smartTagService = scannedDevice.services.find(s => {
          const serviceUuid = s.uuid.toLowerCase().replace(/-/g, '');
          return serviceUuid === BLE_SERVICES.SMART_TAG.toLowerCase().replace(/-/g, '') ||
                 serviceUuid === BLE_SERVICES.SMART_TAG_ALT.toLowerCase().replace(/-/g, '');
        });
        
        if (!smartTagService) {
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
            smartTagService = scannedDevice.services.find(s => 
              s.uuid.toLowerCase().replace(/-/g, '') === sysCmdChar.serviceUUID.toLowerCase().replace(/-/g, '')
            );
          }
        } else {
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '') &&
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
        }
        
        if (!smartTagService || !sysCmdChar) {
          return { success: false, error: 'SYSTEM_COMMAND characteristic not available' };
        }
      } else {
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (!scannedDevice || !scannedDevice.services) {
          return { success: false, error: 'Device services not available' };
        }

        smartTagService = scannedDevice.services.find(s => {
          const serviceUuid = s.uuid.toLowerCase().replace(/-/g, '');
          return serviceUuid === BLE_SERVICES.SMART_TAG.toLowerCase().replace(/-/g, '') ||
                 serviceUuid === BLE_SERVICES.SMART_TAG_ALT.toLowerCase().replace(/-/g, '');
        });
        
        if (!smartTagService) {
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '')
          );
          
          if (sysCmdChar) {
            smartTagService = scannedDevice.services.find(s => 
              s.uuid.toLowerCase().replace(/-/g, '') === sysCmdChar.serviceUUID.toLowerCase().replace(/-/g, '')
            );
          }
        } else {
          sysCmdChar = scannedDevice.characteristics.find(c => 
            c.uuid.toLowerCase().replace(/-/g, '') === BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '') &&
            c.serviceUUID.toLowerCase().replace(/-/g, '') === smartTagService.uuid.toLowerCase().replace(/-/g, '')
          );
        }
        
        if (!smartTagService || !sysCmdChar) {
          return { success: false, error: 'SYSTEM_COMMAND characteristic not available' };
        }
      }

      if (!sysCmdChar.isWritable && !sysCmdChar.isWritableWithResponse && !sysCmdChar.isWritableWithoutResponse) {
        return { success: false, error: 'System Command characteristic not writable' };
      }

      const packet = new Array(SYSTEM_COMMAND_CONSTANTS.PACKET_SIZE).fill(0);

      payloadToSend = (Array.isArray(payload) ? payload : [])
        .slice(0);

      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.REQUEST_ID_OFFSET] = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_ID_OFFSET] = command;
      packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_LENGTH_OFFSET] = payloadToSend.length;

      for (let i = 0; i < payloadToSend.length && i < 17; i++) {
        packet[SYSTEM_COMMAND_CONSTANTS.REQUEST_FORMAT.COMMAND_DATA_OFFSET + i] = payloadToSend[i];
      }

      if (Platform.OS === 'android') {
        const result = await SampleBridgeAndroid.sendSystemCommand(
          deviceId,
          command,
          payloadToSend
        );
        if (!result) {
          throw new Error('Failed to send system command');
        }
      } else {
        await BridgingCodeModule.sendSystemCommand(
          deviceId,
          command,
          payloadToSend
        );
      }

      const duration = Date.now() - startTime;
      return { success: true, duration, commandName };

    } catch (error) {
      const duration = Date.now() - startTime;
      return { success: false, error: error.message, duration, commandName };
    }
  }



  async readAllCharacteristics(deviceId) {
    try {
    const characteristicsToRead = [
      { service: BLE_SERVICES.BATTERY, characteristic: BLE_CHARACTERISTICS.BATTERY_LEVEL, name: 'Battery Level', optional: true },
      { service: BLE_SERVICES.SMART_TAG, characteristic: BLE_CHARACTERISTICS.DEVICE_STATUS, name: 'Device Status', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MANUFACTURER_NAME, name: 'Manufacturer', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.MODEL_NUMBER, name: 'Model Number', optional: true },
      { service: BLE_SERVICES.DEVICE_INFO, characteristic: BLE_CHARACTERISTICS.FIRMWARE_REVISION, name: 'Firmware', optional: true },
    ];

    for (const { service, characteristic, name, optional } of characteristicsToRead) {
      try {
        if (optional) {
          if (Platform.OS === 'android') {
            const device = this.scannedDevices.get(deviceId);
            if (device && device.characteristics) {
              const exists = device.characteristics.some(c => c.uuid.toLowerCase() === characteristic.toLowerCase());
              if (!exists) {
                continue;
              }
            }
          } else {
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
          const normalizedChar = characteristic.toLowerCase().replace(/-/g, '');
          const normalizedBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.toLowerCase().replace(/-/g, '');
          const normalizedDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '');
          
          if (normalizedChar === normalizedBatteryLevel) {
            this.handleBatteryUpdate(deviceId, value);
          } else if (normalizedChar === normalizedDeviceStatus) {
            this.handleDeviceStatusUpdate(deviceId, value);
          }
        }
      } catch (error) {
        if (optional) {
          return;
        }
        throw error;
      }
    }
    } catch (error) {
    }
  }

  async requestDeviceData(deviceId, options = {}) {
    try {
      if (this.requestDataMutex.get(deviceId)) {
        return;
      }

      this.requestDataMutex.set(deviceId, true);

      const device = this.scannedDevices.get(deviceId);
      if (!device || !this.isDeviceConnected(deviceId)) {
        throw new Error(`Device ${deviceId} not connected`);
      }
      
      let waitTime = 0;
      while (waitTime < 5000) {
        if (device.services && device.services.length > 0) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
        waitTime += 100;
      }

      await this.readAllCharacteristics(deviceId);

    } catch (error) {
    } finally {
      this.requestDataMutex.delete(deviceId);
    }
  }

  async testSystemCommands(deviceId) {
    try {
      const commandKey = `commands_sent_${deviceId}`;
      this[commandKey] = false;
      await this.requestDeviceData(deviceId, { enableSystemCommands: true });
    } catch (error) {
    }
  }

  async testSystemCommandLookup(deviceId) {
    try {
      const scannedDevice = this.scannedDevices.get(deviceId);
      if (!scannedDevice) {
        return;
      }
    } catch (error) {
    }
  }

  async testSingleSystemCommand(deviceId, commandId = 0x1) {
    try {
      // ✅ FIX ISSUE #4 & #5: Use validated command sending (even for tests)
      const result = await this.sendSystemCommandWithValidation(deviceId, commandId, []);
      return result;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  testDeviceDataAvailability(deviceId) {
    const connectedDevice = this.connectedDevices.get(deviceId);
    const scannedDevice = this.scannedDevices.get(deviceId);
    
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
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION, [0x00], { waitForResponse: true });
      
      if (!result.success) {
        return result;
      }
      
      for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        
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

  async getHardwareVersion(deviceId) {
    try {
      // Clear any previous response
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
      
      // ✅ SDD Table 10: GET_HW_VERSION - Length=1, Data=0x00
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION, [0x00], { waitForResponse: true });
      
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
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS, [0x00], { waitForResponse: true });
      
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
      // ✅ Log time sync via setSystemTime
      this.addConnectionLog(deviceId, 'Time Sync: Sending SET_TIME Command', {
        systemTime: timestamp,
        systemTimeISO: new Date(timestamp * 1000).toISOString(),
        trigger: 'setSystemTime'
      });
      
      const payload = [
        (timestamp >> 0) & 0xFF,
        (timestamp >> 8) & 0xFF,
        (timestamp >> 16) & 0xFF,
        (timestamp >> 24) & 0xFF
      ];
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, payload, { waitForResponse: true });
      
      if (result.success) {
        this.addConnectionLog(deviceId, 'Time Sync: SET_TIME Command Sent', {
          systemTime: timestamp,
          success: true
        });
      } else {
        this.addConnectionLog(deviceId, 'Time Sync: SET_TIME Command Failed', {
          systemTime: timestamp,
          success: false,
          error: result.error || 'Unknown error'
        });
        // ✅ FIX ISSUE #10: Log error
        this.logError(deviceId, 'SET_TIME_FAILED', {
          error: result.error || 'Unknown error',
          systemTime: timestamp
        });
      }
      
      return result;
    } catch (error) {
      this.addConnectionLog(deviceId, 'Time Sync: Exception', {
        error: error.message || 'Unknown error',
        systemTime: timestamp
      });
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
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_ADV_INTERVAL, payload);
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
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async setDataAcquisitionInterval(deviceId, intervalSeconds) {
    try {
      const intervalMs = intervalSeconds * 1000;
      
      const payload = [
        (intervalMs >> 0) & 0xFF,
        (intervalMs >> 8) & 0xFF,
        (intervalMs >> 16) & 0xFF,
        (intervalMs >> 24) & 0xFF
      ];
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async startDataSync(deviceId) {
    try {
      // ✅ FIX: Prevent concurrent data sync operations
      // Check if sync is already in progress before starting a new one
      const syncState = this.dataSyncStates?.get(deviceId);
      if (syncState?.isActive) {
        const timeSinceStart = Date.now() - (syncState.startTime || 0);
        console.log(`⏭️ [SYNC GUARD] Data sync already in progress for ${deviceId} (started ${timeSinceStart}ms ago) - skipping duplicate sync request`);
        return { 
          success: false, 
          status: 'already_syncing',
          message: 'Data sync already in progress for this device',
          deviceId 
        };
      }
      
      const scannedDevice = this.scannedDevices.get(deviceId);
      if (scannedDevice) {
        scannedDevice.syncRecordsBeforeSync = scannedDevice.syncRecords ? scannedDevice.syncRecords.length : 0;
      }
      
      // ✅ FIX ISSUE #3: Track expected record count from device status
      const expectedRecords = scannedDevice?.deviceData?.recordCount || 0;
      this.syncExpectedRecords.set(deviceId, expectedRecords);
      
      // ✅ FIX ISSUE #3: Set sync timeout
      const existingTimeout = this.syncTimeouts.get(deviceId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const syncTimeout = setTimeout(() => {
        this.handleSyncTimeout(deviceId);
      }, this.SYNC_TIMEOUT_MS);
      this.syncTimeouts.set(deviceId, syncTimeout);
      
      // ✅ DEMO TAG FIX: Check if device is a demo tag before calling native bridge
      const connectedDevice = this.connectedDevices.get(deviceId);
      const isDemoTag = connectedDevice?.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
      
      if (isDemoTag) {
        // DemoTag: Handle data sync in JavaScript using sendSystemCommand
        // This will route to writeDemoCharacteristic which handles demo tags
        console.log(`🏷️ DemoTag: Starting data sync for ${deviceId} (handled in JS)`);
        
        // ✅ FIX ISSUE #4 & #5: Use validated command sending
        const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START, [0x00]);
        
        if (!this.dataSyncStates) {
          this.dataSyncStates = new Map();
        }
        
        this.dataSyncStates.set(deviceId, {
          isActive: true,
          startTime: Date.now(),
          recordsReceived: 0,
          totalRecords: expectedRecords, // ✅ FIX ISSUE #3: Track expected records
          lastActivity: Date.now(),
          expectedRecords: expectedRecords
        });
        
        return result;
      }
      
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        try {
          const result = await SampleBridgeAndroid.startDataSync(deviceId);
          
          if (result && result.status === 'already_syncing') {
            return result;
          }
          
          if (!this.dataSyncStates) {
            this.dataSyncStates = new Map();
          }
          
          this.dataSyncStates.set(deviceId, {
            isActive: true,
            startTime: Date.now(),
            recordsReceived: 0,
            totalRecords: expectedRecords, // ✅ FIX ISSUE #3: Track expected records
            lastActivity: Date.now(),
            expectedRecords: expectedRecords
          });
          
          return result;
        } catch (error) {
          this.handleSyncError(deviceId, error);
          return { success: false, error: error.message || 'Failed to start data sync' };
        }
      }
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START, [0x00]);
      
      if (!this.dataSyncStates) {
        this.dataSyncStates = new Map();
      }
      
      this.dataSyncStates.set(deviceId, {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: expectedRecords, // ✅ FIX ISSUE #3: Track expected records
        lastActivity: Date.now(),
        expectedRecords: expectedRecords
      });
      
      return result;
    } catch (error) {
      this.handleSyncError(deviceId, error);
      return { success: false, error: error.message };
    }
  }
  
  // ✅ FIX ISSUE #3: Handle sync timeout
  handleSyncTimeout(deviceId) {
    const syncState = this.dataSyncStates?.get(deviceId);
    if (!syncState || !syncState.isActive) {
      return;
    }
    
    const expectedRecords = syncState.expectedRecords || 0;
    const receivedRecords = syncState.recordsReceived || 0;
    const isIncomplete = expectedRecords > 0 && receivedRecords < expectedRecords;
    
    console.error(`⏱️ [SYNC TIMEOUT] ${deviceId}: Sync timed out after ${this.SYNC_TIMEOUT_MS}ms`, {
      expectedRecords,
      receivedRecords,
      isIncomplete
    });
    
    this.addConnectionLog(deviceId, 'Data Sync Timeout', {
      expectedRecords,
      receivedRecords,
      isIncomplete,
      timeoutMs: this.SYNC_TIMEOUT_MS
    });
    
    // ✅ FIX ISSUE #10: Add error context
    this.logError(deviceId, 'SYNC_TIMEOUT', {
      expectedRecords,
      receivedRecords,
      timeoutMs: this.SYNC_TIMEOUT_MS
    });
    
    // Stop sync and retry if incomplete
    if (isIncomplete) {
      this.retryIncompleteSync(deviceId);
    } else {
      // Complete but took too long - just stop
      this.stopDataSync(deviceId, false).catch(() => {});
    }
  }
  
  // ✅ FIX ISSUE #3: Retry incomplete sync with exponential backoff
  async retryIncompleteSync(deviceId) {
    const retryCount = this.syncRetryAttempts.get(deviceId) || 0;
    if (retryCount >= this.MAX_SYNC_RETRIES) {
      console.error(`❌ [SYNC RETRY] ${deviceId}: Max retries (${this.MAX_SYNC_RETRIES}) reached`);
      this.addConnectionLog(deviceId, 'Data Sync: Max Retries Reached', {
        retryCount
      });
      this.syncRetryAttempts.delete(deviceId);
      this.syncRetryDelays.delete(deviceId);
      return;
    }
    
    const baseDelay = 1000; // 1 second
    const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
    this.syncRetryDelays.set(deviceId, delay);
    this.syncRetryAttempts.set(deviceId, retryCount + 1);
    
    console.log(`🔄 [SYNC RETRY] ${deviceId}: Retrying incomplete sync (attempt ${retryCount + 1}/${this.MAX_SYNC_RETRIES}) in ${delay}ms`);
    this.addConnectionLog(deviceId, 'Data Sync: Retrying Incomplete Sync', {
      retryAttempt: retryCount + 1,
      maxRetries: this.MAX_SYNC_RETRIES,
      delayMs: delay
    });
    
    setTimeout(async () => {
      try {
        await this.stopDataSync(deviceId, false);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
        await this.startDataSync(deviceId);
      } catch (error) {
        console.error(`❌ [SYNC RETRY] ${deviceId}: Retry failed:`, error);
        this.logError(deviceId, 'SYNC_RETRY_FAILED', { error: error.message });
      }
    }, delay);
  }
  
  // ✅ FIX ISSUE #3: Handle sync errors
  handleSyncError(deviceId, error) {
    console.error(`❌ [SYNC ERROR] ${deviceId}:`, error);
    this.logError(deviceId, 'SYNC_ERROR', {
      error: error.message || 'Unknown error',
      errorType: error.name || 'Error'
    });
    
    // Clear timeout
    const timeout = this.syncTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.syncTimeouts.delete(deviceId);
    }
    
    // Reset sync state
    if (this.dataSyncStates) {
      const syncState = this.dataSyncStates.get(deviceId);
      if (syncState) {
        syncState.isActive = false;
        syncState.state = 'failed';
      }
    }
  }
  
  // ✅ FIX ISSUE #10: Log errors with context
  logError(deviceId, errorCode, context = {}) {
    if (!this.errorContexts.has(deviceId)) {
      this.errorContexts.set(deviceId, []);
    }
    const errors = this.errorContexts.get(deviceId);
    errors.push({
      errorCode,
      timestamp: Date.now(),
      context
    });
    
    // Keep only last N errors
    if (errors.length > this.maxErrorHistory) {
      errors.shift();
    }
    
    this.addConnectionLog(deviceId, `Error: ${errorCode}`, {
      errorCode,
      ...context
    });
  }

  async stopDataSync(deviceId, clearFlashData = false) {
    try {
      // ✅ SDD Table 10: DATA_SYNC_STOP - Length=1, Data varies
      const payload = [clearFlashData ? 0x01 : 0x00];
      
      // ✅ FIX: Track clearFlashData flag so we can clear Redux records when response is received
      if (clearFlashData) {
        if (!this.pendingFlashClearCommands) {
          this.pendingFlashClearCommands = new Map();
        }
        this.pendingFlashClearCommands.set(deviceId, true);
      }
      
      // ✅ FIX ISSUE #3: Clear sync timeout
      const timeout = this.syncTimeouts.get(deviceId);
      if (timeout) {
        clearTimeout(timeout);
        this.syncTimeouts.delete(deviceId);
      }
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP, payload);
    } catch (error) {
      this.handleSyncError(deviceId, error);
      return { success: false, error: error.message };
    }
  }

  async systemRestart(deviceId) {
    try {
      // ✅ SDD Table 10: SYSTEM_RESTART - Length=1, Data=0x00
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART, [0x00]);
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
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async unpairDevice(deviceId) {
    try {
      this.manualDisconnectCooldown.set(deviceId, Date.now());
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE, [0x00]);
      
      if (result.success) {
        try {
          await AutoConnectService.stopAutoConnect();
        } catch (error) {
        }
        
        setTimeout(async () => {
          const device = this.scannedDevices.get(deviceId);
          if (device) {
            device.connectionState = CONNECTION_STATES.DISCONNECTED;
            this.scannedDevices.set(deviceId, device);
          }
          
          this.connectedDevices.delete(deviceId);
          
          this.stopAdaptiveApiCalling(deviceId);
          
          this.deviceRequestQueues.delete(deviceId);
          this.notificationStats.delete(deviceId);
        }, 1000);
        
        setTimeout(() => {
          this.manualDisconnectCooldown.delete(deviceId);
        }, 10000);
      } else {
        this.manualDisconnectCooldown.delete(deviceId);
      }
      
      return result;
    } catch (error) {
      this.manualDisconnectCooldown.delete(deviceId);
      
      return { success: false, error: error.message };
    }
  }

  async factoryReset(deviceId) {
    try {
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET, [0x00]);
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
      
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE, payload);
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
      // ✅ FIX ISSUE #4 & #5: Use validated command sending
      await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS, [0x00]);
      
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
    // ✅ FIX: Reset health check failure counter on successful auto-connection
    this.healthCheckFailures.delete(deviceInfo.deviceId);

    
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

    // Track timestamp to suppress immediate duplicate "Connected" log
    this.recentAutoConnects.set(deviceInfo.deviceId, Date.now());

    // Cancel any pending delayed "Connected" log (auto-connect is the source of truth)
    const pending = this.pendingConnectedLogTimers.get(deviceInfo.deviceId);
    if (pending) {
      clearTimeout(pending);
      this.pendingConnectedLogTimers.delete(deviceInfo.deviceId);
    }
  }

  // Handle device disconnected via auto-connect
  handleAutoDisconnectedDevice = (deviceInfo) => {
    // ✅ FIX ISSUE #1: Add connection state debouncing to prevent connection loops
    const deviceId = deviceInfo.deviceId;
    const now = Date.now();
    
    // Get or create debounce state
    let debounceState = this.connectionStateDebounce.get(deviceId);
    if (!debounceState) {
      debounceState = {
        lastDisconnectTime: 0,
        disconnectCount: 0,
        isDebouncing: false,
        blockedUntil: 0
      };
      this.connectionStateDebounce.set(deviceId, debounceState);
    }
    
    // Check if device is blocked from reconnecting
    if (now < debounceState.blockedUntil) {
      const remainingBlockTime = Math.ceil((debounceState.blockedUntil - now) / 1000);
      console.warn(`🚫 [CONNECTION DEBOUNCE] ${deviceId}: Blocked from reconnecting for ${remainingBlockTime}s (too many disconnects)`);
      this.addConnectionLog(deviceId, 'Disconnected (Reconnection Blocked)', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
        blockedUntil: new Date(debounceState.blockedUntil).toISOString(),
        disconnectCount: debounceState.disconnectCount
      });
      return; // Don't process disconnection if blocked
    }
    
    // Update debounce state
    const timeSinceLastDisconnect = now - debounceState.lastDisconnectTime;
    if (timeSinceLastDisconnect < this.CONNECTION_DEBOUNCE_WINDOW_MS) {
      // Within debounce window - increment counter
      debounceState.disconnectCount++;
    } else {
      // Outside debounce window - reset counter
      debounceState.disconnectCount = 1;
    }
    
    debounceState.lastDisconnectTime = now;
    
    // If too many disconnects in short time, block reconnection
    if (debounceState.disconnectCount >= this.MAX_DISCONNECTS_PER_WINDOW) {
      debounceState.blockedUntil = now + this.CONNECTION_BLOCK_DURATION_MS;
      debounceState.isDebouncing = true;
      console.error(`🚫 [CONNECTION LOOP DETECTED] ${deviceId}: ${debounceState.disconnectCount} disconnects in ${this.CONNECTION_DEBOUNCE_WINDOW_MS}ms - Blocking reconnection for ${this.CONNECTION_BLOCK_DURATION_MS}ms`);
      this.addConnectionLog(deviceId, 'Connection Loop Detected - Reconnection Blocked', {
        disconnectCount: debounceState.disconnectCount,
        blockedUntil: new Date(debounceState.blockedUntil).toISOString()
      });
    } else {
      debounceState.isDebouncing = false;
    }
    
    this.connectionStateDebounce.set(deviceId, debounceState);

    const device = this.scannedDevices.get(deviceId);
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

      // ✅ FIX ISSUE #10: Add disconnection log with error code
      this.addConnectionLog(deviceInfo.deviceId, 'Disconnected', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
        errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
        error: deviceInfo.error || null
      });
      
      // ✅ FIX ISSUE #10: Log error context
      if (deviceInfo.error || deviceInfo.reason) {
        this.logError(deviceInfo.deviceId, 'DISCONNECTION', {
          reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
          errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
          error: deviceInfo.error || null
        });
      }

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

    // ✅ FIX ISSUE #1: Only trigger auto-reconnect if not debouncing/blocked
    if (!debounceState.isDebouncing && now >= debounceState.blockedUntil) {
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
    } else {
      console.log(`⏸️ [AUTO-RECONNECT] ${deviceId}: Skipping auto-reconnect (debouncing or blocked)`);
    }

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

        // ✅ DEMO TAG FIX: Check if device is a demo tag before calling native bridge
        const isDemoTag = device.isDemoTag || DemoTagSimulator.isDemoDevice(deviceId);
        
        // Try to read RSSI as a connection health check and measure quality
        let rssi;
        if (isDemoTag) {
          // DemoTag: Use simulated RSSI from DemoTagSimulator
          rssi = DemoTagSimulator.updateRSSI(deviceId);
        } else if (Platform.OS === 'android') {
          // Use native Android RSSI reading for health check
          try {
            const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
            rssi = result;
          } catch (error) {
            throw error; // Re-throw to trigger failure counting
          }
        } else {
          // iOS uses native bridge RSSI reading for health check
          try {
            const result = await BridgingCodeModule.readRSSI(deviceId);
            rssi = result;
          } catch (error) {
            throw error; // Re-throw to trigger failure counting
          }
        }
        
        // Update connection quality based on RSSI
        if (rssi !== null && rssi !== undefined) {
          this.checkRssiConnectionQuality(deviceId, rssi);
          // ✅ FIX: Reset failure counter on successful health check
          this.healthCheckFailures.delete(deviceId);
        }
      } catch (error) {
        // ✅ FIX: Don't immediately disconnect on RSSI failure - BLE stacks (both Android and iOS) can have temporary failures
        // Instead, increment a failure counter and only disconnect after multiple failures
        // This matches the native implementation behavior on both platforms (3 consecutive failures)
        const currentFailures = this.healthCheckFailures.get(deviceId) || 0;
        const newFailureCount = currentFailures + 1;
        this.healthCheckFailures.set(deviceId, newFailureCount);
        
        console.warn(`⚠️ [HEALTH_CHECK] RSSI read failed for ${deviceId} - failure count: ${newFailureCount}/3`);
        
        // Only disconnect after 3 consecutive failures (matching native behavior on both Android and iOS)
        if (newFailureCount >= 3) {
          console.error(`💀 [HEALTH_CHECK] Device ${deviceId} failed 3 consecutive health checks - marking as disconnected`);
          this.healthCheckFailures.delete(deviceId);
          
          // Simulate auto-disconnect callback for stale connections
          const deviceInfo = this.scannedDevices.get(deviceId);
          if (deviceInfo) {
            this.handleAutoDisconnectedDevice({
              deviceId: deviceId,
              deviceName: deviceInfo.name || 'Unknown Device',
              error: 'Health check failed (3 consecutive failures)'
            });
          }
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

  canRetryError(error) {
    return this.classifyError(error) === ERROR_TYPES.TRANSIENT;
  }

  requiresUserAction(error) {
    return this.classifyError(error) === ERROR_TYPES.USER_ACTION;
  }

  startExponentialBackoffReconnection(deviceId) {
    if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
      return;
    }

    if (!this.reconnectionTimers) this.reconnectionTimers = new Map();
    if (!this.reconnectionAttempts) this.reconnectionAttempts = new Map();

    const attempt = this.reconnectionAttempts.get(deviceId) || 0;
    const maxAttempts = RECONNECTION_CONSTANTS.MAX_ATTEMPTS;
    const baseDelay = RECONNECTION_CONSTANTS.INITIAL_BACKOFF_MS;
    const maxDelay = RECONNECTION_CONSTANTS.MAX_BACKOFF_MS;
    const jitter = Math.random() * RECONNECTION_CONSTANTS.JITTER_MS;

    if (attempt >= maxAttempts) {
      this.reconnectionAttempts.delete(deviceId);
      return;
    }

    const device = this.scannedDevices.get(deviceId);
    if (device && device.rssi !== null && device.rssi !== undefined) {
      const minRssi = RECONNECTION_CONSTANTS.MIN_RSSI_FOR_RECONNECTION;
      if (device.rssi < minRssi) {
        this.reconnectionAttempts.delete(deviceId);
        return;
      }
    }

    const delay = Math.min(baseDelay * Math.pow(2, attempt) + jitter, maxDelay);

    const timer = setTimeout(async () => {
      try {
        if (this.manualDisconnectCooldown.has(deviceId)) {
          const connectResult = await this.connectToKnownPeripherals();
          if (connectResult.attempted > 0) {
            this.reconnectionAttempts.delete(deviceId);
            return { success: false, error: 'SMART_TAG service not available' };
          }

          await this.forceScanForBondedDevices();

          this.reconnectionAttempts.set(deviceId, attempt + 1);
          this.startExponentialBackoffReconnection(deviceId);
        } else {
          this.reconnectionAttempts.delete(deviceId);
        }
      } catch (error) {
        this.reconnectionAttempts.set(deviceId, attempt + 1);
        this.startExponentialBackoffReconnection(deviceId);
      }
    }, delay);

    this.reconnectionTimers.set(deviceId, timer);
  }

  connectionPool = new Map();

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

      if (pool.queue.length > 0) {
        const nextRequest = pool.queue.shift();
        pool.currentConnections++;
      }

      this.connectionPool.set(deviceId, pool);
    }
  }

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

    this.startScanning(
      null,
      null,
      config.duration,
      config.power
    );
  }

  startHeartbeatMonitoring(deviceId) {
    if (this.heartbeatTimers && this.heartbeatTimers.has(deviceId)) return;

    if (!this.heartbeatTimers) this.heartbeatTimers = new Map();
    if (!this.heartbeatCounters) this.heartbeatCounters = new Map();

    const heartbeatInterval = 60000;
    const maxMissedHeartbeats = 5;

    const timer = setInterval(async () => {
      try {
        const device = this.connectedDevices.get(deviceId);
        if (!device) {
          this.stopHeartbeatMonitoring(deviceId);
          return { success: false, error: 'SMART_TAG service not available' };
        }

        if (Platform.OS === 'android') {
          try {
            await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          } catch (rssiError) {
            await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
          }
        } else {
          try {
            await BridgingCodeModule.readRSSI(deviceId);
          } catch (rssiError) {
            await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
          }
        }

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

  connectionQualityMetrics = new Map();

  updateConnectionQuality(deviceId, rssi, packetLoss = 0) {
    const metrics = this.connectionQualityMetrics.get(deviceId) || {
      rssiHistory: [],
      packetLossHistory: [],
      connectionStability: 100,
      lastUpdate: Date.now()
    };

    metrics.rssiHistory.push({ rssi, timestamp: Date.now() });
    if (metrics.rssiHistory.length > 10) {
      metrics.rssiHistory.shift();
    }

    metrics.packetLossHistory.push({ packetLoss, timestamp: Date.now() });
    if (metrics.packetLossHistory.length > 10) {
      metrics.packetLossHistory.shift();
    }

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
    if (Platform.OS !== 'ios') {
      return;
    }

    try {
      setTimeout(async () => {
        let autoConnectStatus = await this.getAutoConnectStatus();

        if (!autoConnectStatus.enabled) {
          await this.startAutoConnect();

          autoConnectStatus = await this.getAutoConnectStatus();
          if (!autoConnectStatus.enabled) {
            return { success: false, error: 'SMART_TAG service not available' };
          }
        }

        const bondedDevices = await this.getBondedDevices();
        if (bondedDevices.length === 0) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        const connectedCount = this.connectedDevices.size;
        if (connectedCount > 0) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        await this.startAutoConnect();

        setTimeout(async () => {
          try {
            const connectResult = await this.connectToKnownPeripherals();
          } catch (error) {
          }
        }, 2000);

        this.startPeriodicAutoScan();
      }, 3000);
    } catch (error) {
    }
  }

  startPeriodicAutoScan() {
    if (Platform.OS !== 'ios') {
      return;
    }

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
    }, 30000);
  }

  stopPeriodicAutoScan() {
    if (this.periodicScanInterval) {
      clearInterval(this.periodicScanInterval);
      this.periodicScanInterval = null;
    }
  }

  setDeviceScreenActive = (deviceId, isActive) => {
    this.setScreenActiveState(deviceId, isActive);
  }

  getDeviceApiInterval = (deviceId) => {
    return this.getCurrentApiInterval(deviceId);
  }

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

  forceRestartAllAdaptiveApi = () => {
    this.stopAllAdaptiveApi();
    
    setTimeout(() => {
      for (const [deviceId, device] of this.scannedDevices.entries()) {
        if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
          this.startAdaptiveApiCalling(deviceId);
        }
      }
    }, 100);
  }

  debugAdaptiveApiState = () => {
  }

  setAllDevicesActive = () => {
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, true);
      }
    }
  }

  setAllDevicesInactive = () => {
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, false);
      }
    }
  }

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

  async handleNativeHealthDataApiRequest(eventData) {
    try {
      const { deviceId, deviceData, timestamp } = eventData;
      
      if (deviceData) {
        const device = this.scannedDevices.get(deviceId);
        if (device) {
          if (!device.deviceData) {
            device.deviceData = {
              batteryLevel: null,
              temperature: null,
              steps: null,
              lastUpdate: new Date()
            };
          }

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
    } catch (error) {
    }
  }

  handleNativeCommandSent(eventData) {
    try {
      const { deviceId, commandId, commandName, payload, payloadLength, systemTimestamp, systemTimestampISO, timestampHex, deviceRTCValid } = eventData;
      
      if (!deviceId || commandId === undefined) {
        return;
      }
      
      // Build full hex command packet: [0xAA][commandId][payloadLength][payload...]
      let commandHex = '';
      const requestId = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;
      const actualPayloadLength = payloadLength || 0;
      
      // Build hex string for the full packet
      commandHex = `${requestId.toString(16).padStart(2, '0').toUpperCase()} `;
      commandHex += `${commandId.toString(16).padStart(2, '0').toUpperCase()} `;
      commandHex += `${actualPayloadLength.toString(16).padStart(2, '0').toUpperCase()}`;
      
      // Parse payload hex string and add to command hex
      if (payload && payload !== 'No payload' && actualPayloadLength > 0) {
        // Payload comes as "0x01 0x02 0x03" format, extract hex values
        const payloadBytes = payload.split(/\s+/).filter(byte => byte.trim()).map(byte => {
          // Remove 0x prefix if present and extract hex value
          const hexValue = byte.replace(/0x/gi, '').trim();
          // Pad to 2 characters if single digit
          return hexValue.padStart(2, '0');
        }).filter(hex => /^[0-9a-fA-F]{1,2}$/i.test(hex));
        
        if (payloadBytes.length > 0) {
          commandHex += ' ' + payloadBytes.join(' ').toUpperCase();
        }
      }
      
      // ✅ FIX: Deduplicate command logs (prevent duplicate commands within 100ms)
      const now = Date.now();
      if (!this.lastCommandResponseLogs.has(deviceId)) {
        this.lastCommandResponseLogs.set(deviceId, new Map());
      }
      const deviceCmdLogs = this.lastCommandResponseLogs.get(deviceId);
      const lastCmdLog = deviceCmdLogs.get(`cmd_${commandId}_${commandHex}`);
      const shouldLogCmd = !lastCmdLog || (now - lastCmdLog.timestamp) > 100; // Prevent duplicates within 100ms
      
      if (shouldLogCmd) {
        // ✅ Enhanced logging for SET_TIME command with time details
        const logData = {
          commandId: `0x${commandId.toString(16).padStart(2, '0')}`,
          commandName: commandName,
          payload: payload || 'No payload',
          payloadLength: actualPayloadLength,
          commandHex: commandHex, // Full hex command packet
          source: 'native'
        };
        
        // Add time information for SET_TIME command (commandId 0x01)
        if (commandId === SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME && systemTimestamp !== undefined) {
          logData.systemTimestamp = systemTimestamp;
          logData.systemTimestampISO = systemTimestampISO || new Date(systemTimestamp * 1000).toISOString();
          logData.timestampHex = timestampHex;
          if (deviceRTCValid !== undefined) {
            logData.deviceRTCValid = deviceRTCValid;
          }
        }
        
        this.addConnectionLog(deviceId, `Command Sent: ${commandName}`, logData);
        deviceCmdLogs.set(`cmd_${commandId}_${commandHex}`, { timestamp: now, commandHex: commandHex });
      }
    } catch (error) {
    }
  }
  
  /**
   * ✅ Handle RTC read events from native code
   * Logs device RTC values when read from device status
   */
  handleRTCRead(eventData) {
    try {
      const { deviceId, deviceRTC, deviceRTCISO, systemTime, systemTimeISO, timeDifference, rtcValid, timeDifferenceFormatted } = eventData;
      
      if (!deviceId) {
        return;
      }
      
      // Format the log message with time details
      const rtcStatus = rtcValid ? '✅ Valid' : '❌ Invalid';
      const logMessage = `RTC Read: Device RTC ${rtcStatus}`;
      
      this.addConnectionLog(deviceId, logMessage, {
        deviceRTC: deviceRTC,
        deviceRTCISO: deviceRTCISO,
        systemTime: systemTime,
        systemTimeISO: systemTimeISO,
        timeDifference: timeDifference,
        timeDifferenceFormatted: timeDifferenceFormatted,
        rtcValid: rtcValid,
        source: 'native'
      });
    } catch (error) {
      console.error('Error handling RTC read event:', error);
    }
  }

  /**
   * ✅ Handle polling started events from native code
   * Logs when polling starts for original tags
   */
  handlePollingStarted(eventData) {
    try {
      const { deviceId, intervalSeconds, pollInterval } = eventData;
      
      if (!deviceId) {
        return;
      }
      
      const interval = intervalSeconds || pollInterval || 'Unknown';
      
      this.addConnectionLog(deviceId, 'Polling Started', {
        intervalSeconds: interval,
        pollInterval: typeof interval === 'number' ? interval * 1000 : interval,
        source: 'native',
        isFromPolling: false
      });
    } catch (error) {
      console.error('Error handling polling started event:', error);
    }
  }

  handleNativeSystemCommandResponse(eventData) {
    const { type, deviceId, commandId, rawData, rawResponse, dataLength, responseStatus, status, commandName, firmwareVersion, hardwareVersion } = eventData;
    
    const isAndroidFormat = type === 'system_command_response';
    const isiOSFormat = status !== undefined && commandName !== undefined;
    
    const responseHex = rawResponse || rawData;
    
    if ((isAndroidFormat && rawData) || (isiOSFormat && rawResponse)) {
      try {
        let dataToParse = responseHex;
        let formattedResponseHex = '';
        
        if (typeof responseHex === 'string') {
          const cleanHex = responseHex.replace(/\s+/g, '');
          
          if (/^[0-9a-fA-F]+$/i.test(cleanHex)) {
            // Format hex string with spaces between bytes for readability
            formattedResponseHex = cleanHex.match(/.{1,2}/g)?.join(' ').toUpperCase() || cleanHex.toUpperCase();
            
            const buffer = Buffer.from(cleanHex, 'hex');
            dataToParse = buffer.toString('base64');
          } else {
            return;
          }
        } else {
          return;
        }
        
        const response = BLEDataParser.parseSystemCommandResponse(dataToParse);
        
        // Log response to connection logs
        const responseCommandId = response?.command || commandId;
        const responseCommandName = commandName || this.getCommandName(responseCommandId);
        const successStatus = (response?.success !== undefined) ? response.success : (status === 'success' || responseStatus === 0x00);
        
        // ✅ FIX: Deduplicate response logs (prevent duplicate responses within 100ms)
        const now = Date.now();
        if (!this.lastCommandResponseLogs.has(deviceId)) {
          this.lastCommandResponseLogs.set(deviceId, new Map());
        }
        const deviceRespLogs = this.lastCommandResponseLogs.get(deviceId);
        const lastRespLog = deviceRespLogs.get(`resp_${responseCommandId}_${formattedResponseHex}`);
        const shouldLogResp = !lastRespLog || (now - lastRespLog.timestamp) > 100; // Prevent duplicates within 100ms
        
        if (shouldLogResp) {
          this.addConnectionLog(deviceId, `Response: ${responseCommandName}`, {
            commandId: `0x${responseCommandId.toString(16).padStart(2, '0')}`,
            commandName: responseCommandName,
            responseHex: formattedResponseHex, // Full hex response packet
            success: successStatus,
            responseStatus: responseStatus !== undefined ? `0x${responseStatus.toString(16).padStart(2, '0')}` : (status || 'unknown'),
            source: 'native'
          });
          deviceRespLogs.set(`resp_${responseCommandId}_${formattedResponseHex}`, { timestamp: now, responseHex: formattedResponseHex });
        }
        
        if (response && response.sddCompliant) {
          const responseKey = `${deviceId}_${response.command}`;
          if (!this.systemCommandResponses) {
            this.systemCommandResponses = new Map();
          }
          
          const normalizedResponse = {
            ...response,
            parsedData: response.data || response.parsedData
          };
          this.systemCommandResponses.set(responseKey, normalizedResponse);
          
          this.handleSystemCommandResponse(deviceId, dataToParse);
        } else {
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
          }
        }
        
      } catch (error) {
      }
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
        const parsedTransfer = {
          type: 'sync_complete',
          typeString: 'sync_complete',
          success: success,
          recordsTransmitted: recordsTransmitted || 0,
          timestamp: new Date()
        };
        
        console.log('✅ [SYNC COMPLETE] Data sync completed for', deviceId, {
          success,
          recordsTransmitted: recordsTransmitted || 0,
          timestamp: new Date().toISOString()
        });
        
        // ✅ FIX: Note that iOS native code will start keep-alive mechanism
        // to prevent automatic disconnection after sync
        if (success) {
          console.log('🔋 [CONNECTION] Keep-alive mechanism active to maintain connection');
        }
        
        this.handleSyncComplete(deviceId, parsedTransfer);
        
        if (success) {
          if (!this.autoSyncMeta) {
            this.autoSyncMeta = new Map();
          }
          const meta = this.autoSyncMeta.get(deviceId) || {};
          meta.lastSyncCompletedAt = Date.now();
          this.autoSyncMeta.set(deviceId, meta);
        }
        
        if (success) {
          const updated = this.updateDeviceDataFromSyncedRecords(deviceId);
          
          if (updated) {
            const latestRecord = this.getLatestSyncedRecord(deviceId);
            
            this.emit('syncDataUpdated', {
              deviceId,
              latestRecord,
              totalRecords: recordsTransmitted,
              success: true
            });
          }
          
          const device = this.scannedDevices.get(deviceId);
          if (device && device.syncRecords) {
            const recordsBeforeSync = device.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
            
            const newRecords = device.syncRecords.slice(recordsBeforeSync);
            
            if (newRecords && newRecords.length > 0) {
              await this.sendHistoricalRecords(deviceId, newRecords);
              
              device.syncRecordsBeforeSync = device.syncRecords.length;
              this.scannedDevices.set(deviceId, device);
            }
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
        if (records && Array.isArray(records)) {
          const device = this.scannedDevices.get(deviceId);
          if (device) {
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            
            let validRecordsCount = 0;
            let invalidRecordsCount = 0;
            
            records.forEach((record) => {
              const isValidRecord = (
                record.steps > 0 ||
                record.temperature > 0 ||
                (record.timestamp && record.timestamp > 1577836800)
              );
              
              if (!isValidRecord) {
                invalidRecordsCount++;
                return;
              }
              
              // ✅ FIX: Parse timestamp - handle both number and Date object formats
              let recordTimestamp = null;
              if (typeof record.timestamp === 'number') {
                recordTimestamp = record.timestamp;
              } else if (record.timestamp instanceof Date) {
                recordTimestamp = Math.floor(record.timestamp.getTime() / 1000);
              } else if (record.timestampDate) {
                recordTimestamp = Math.floor(new Date(record.timestampDate).getTime() / 1000);
              }
              
              const receivedAt = new Date();
              const receivedAtSeconds = Math.floor(receivedAt.getTime() / 1000);
              
              // ✅ FIX: Validate timestamp is not in the future (device RTC sync issue)
              // Allow small tolerance (2 seconds) for network delays and processing time
              // Reduced from 5 to 2 seconds to catch smaller RTC drift issues
              const TIMESTAMP_TOLERANCE_SECONDS = 2;
              let adjustedTimestamp = recordTimestamp;
              let timestampAdjusted = false;
              let timestampWarning = null;
              
              if (recordTimestamp && recordTimestamp > receivedAtSeconds + TIMESTAMP_TOLERANCE_SECONDS) {
                const timeDiff = recordTimestamp - receivedAtSeconds;
                timestampWarning = `Device RTC is ${timeDiff} seconds ahead`;
                
                console.warn(`⚠️ [TIMESTAMP VALIDATION] ${deviceId}: Record timestamp is ${timeDiff} seconds in the future`, {
                  recordTimestamp,
                  receivedAtSeconds,
                  timestampDate: record.timestampDate,
                  receivedAt: receivedAt.toISOString(),
                  timeDiffSeconds: timeDiff
                });
                
                // ✅ FIX: Clamp timestamp to current time to prevent future timestamps
                adjustedTimestamp = receivedAtSeconds;
                timestampAdjusted = true;
                
                // ✅ FIX: Automatically trigger time resync if not done recently (throttle: 30 seconds)
                const timeSyncKey = `${deviceId}_timestamp_fix`;
                const lastTimeSync = this.lastTimeSyncAttempt?.get(timeSyncKey) || 0;
                const timeSinceLastSync = Date.now() - lastTimeSync;
                const TIME_SYNC_THROTTLE_MS = 30000; // 30 seconds
                
                if (timeSinceLastSync > TIME_SYNC_THROTTLE_MS) {
                  console.log(`🔄 [AUTO TIME SYNC] ${deviceId}: Triggering time resync due to future timestamp (${timeDiff}s ahead)`);
                  
                  // Track the sync attempt
                  if (!this.lastTimeSyncAttempt) {
                    this.lastTimeSyncAttempt = new Map();
                  }
                  this.lastTimeSyncAttempt.set(timeSyncKey, Date.now());
                  
                  // Trigger time sync asynchronously (don't block record processing)
                  this.syncDeviceTime(deviceId).catch(error => {
                    console.error(`❌ [AUTO TIME SYNC] ${deviceId}: Failed to sync device time:`, error);
                  });
                } else {
                  console.log(`⏸️ [AUTO TIME SYNC] ${deviceId}: Time sync throttled (last sync ${Math.floor(timeSinceLastSync / 1000)}s ago)`);
                }
              }
              
              // Use adjusted timestamp for duplicate checking
              const timestampForDedup = adjustedTimestamp || recordTimestamp;
              const existingRecordIndex = device.syncRecords.findIndex(r => {
                const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
                return existingTimestamp === timestampForDedup && 
                       r.steps === record.steps && 
                       r.temperature === record.temperature;
              });
              
              if (existingRecordIndex >= 0) {
                invalidRecordsCount++;
                return;
              }
              
              validRecordsCount++;
              
              // ✅ FIX: Update record with adjusted timestamp if it was clamped
              // ✅ FIX: Ensure timestampDate is always set (create from timestamp if missing)
              const finalTimestamp = adjustedTimestamp || recordTimestamp;
              let finalTimestampDate = record.timestampDate;
              if (!finalTimestampDate && finalTimestamp) {
                // Create timestampDate string in format "yyyy-MM-dd HH:mm:ss" matching iOS
                const date = new Date(finalTimestamp * 1000);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                finalTimestampDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
              } else if (timestampAdjusted && finalTimestamp) {
                // Update timestampDate if timestamp was adjusted
                const date = new Date(finalTimestamp * 1000);
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                const seconds = String(date.getSeconds()).padStart(2, '0');
                finalTimestampDate = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
              }
              
              const newRecord = {
                ...record,
                timestamp: finalTimestamp || record.timestamp,
                timestampDate: finalTimestampDate || record.timestampDate, // ✅ FIX: Always ensure timestampDate is set
                temperature: record.temperature,
                steps: record.steps,
                receivedAt: receivedAt,
                deviceId,
                source: 'native',
                ...(timestampWarning ? {
                  timestampWarning,
                  timestampAdjusted,
                  originalTimestamp: recordTimestamp,
                  originalTimestampDate: record.timestampDate
                } : {})
              };
              device.syncRecords.push(newRecord);
            });
            
            if (validRecordsCount > 0) {
              try {
                const newRecords = device.syncRecords.slice(-validRecordsCount);
                store.dispatch(addRecords({ deviceId, records: newRecords }));
              } catch (error) {
              }
            }
            
            if (validRecordsCount > 0) {
              if (!device.deviceData) {
                device.deviceData = {};
              }
              device.deviceData.recordCount = device.syncRecords.length;
              
              if (this.onDeviceDataUpdated && this.appState === 'active') {
                this.onDeviceDataUpdated(deviceId, device.deviceData);
              }
              
              if (this.onDeviceListUpdated) {
                this.onDeviceListUpdated();
              }
            }
            
            this.scannedDevices.set(deviceId, device);
          }
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

  async collectAllDeviceDataAfterCommands(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }

      try {
        const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
        if (batteryData) {
          const batteryBuffer = Buffer.from(batteryData, 'base64');
          const batteryLevel = batteryBuffer.readUInt8(0);
        }
      } catch (error) {
      }

      try {
        const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        if (deviceStatusData) {
          const parsedStatus = BLEDataParser.parseDeviceStatus(deviceStatusData);
        }
      } catch (error) {
      }

      try {
        const systemCommandData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.SYSTEM_COMMAND);
        if (systemCommandData) {
          const systemBuffer = Buffer.from(systemCommandData, 'base64');
        }
      } catch (error) {
      }

      try {
        const dataTransferData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DATA_TRANSFER);
        if (dataTransferData) {
          const transferBuffer = Buffer.from(dataTransferData, 'base64');
        }
      } catch (error) {
      }

      try {
        const manufacturerData = await this.readCharacteristic(deviceId, BLE_SERVICES.DEVICE_INFO, BLE_CHARACTERISTICS.MANUFACTURER);
        if (manufacturerData) {
          const manufacturerBuffer = Buffer.from(manufacturerData, 'base64');
          const manufacturer = manufacturerBuffer.toString('utf8');
        }
      } catch (error) {
      }

      try {
        const modelData = await this.readCharacteristic(deviceId, BLE_SERVICES.DEVICE_INFO, BLE_CHARACTERISTICS.MODEL_NUMBER);
        if (modelData) {
          const modelBuffer = Buffer.from(modelData, 'base64');
          const model = modelBuffer.toString('utf8');
        }
      } catch (error) {
      }

      if (this.dataSyncStates && this.dataSyncStates.has(deviceId)) {
        const syncState = this.dataSyncStates.get(deviceId);
      }

    } catch (error) {
    }
  }

  async sendPetHealthDataToServer(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device || !device.deviceData) {
        return;
      }

      const { batteryLevel, temperature, steps, lastUpdate } = device.deviceData;

      if (batteryLevel === null && temperature === null && steps === null) {
        return;
      }

      let timestampISO = null;
      if (lastUpdate && lastUpdate instanceof Date && !isNaN(lastUpdate.getTime())) {
        timestampISO = lastUpdate.toISOString();
      }

      const petHealthData = {
        PetId: 1059773,
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

      const result = await postPetHealthBLEData(petHealthData);

    } catch (error) {
    }
  }

  async sendPetHealthDataToServerWithRetry(deviceId, context = 'unknown', maxRetries = 3, retryDelay = 2000) {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const device = this.scannedDevices.get(deviceId);
        if (!device) {
          return { success: false, error: 'SMART_TAG service not available' };
        }

        if (!device.deviceData) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          } else {
            return { success: false, error: 'SMART_TAG service not available' };
          }
        }

        const { batteryLevel, temperature, steps, lastUpdate } = device.deviceData;
        
        if (batteryLevel === null && temperature === null && steps === null) {
          if (attempt < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
            continue;
          } else {
            return { success: false, error: 'SMART_TAG service not available' };
          }
        }

        await this.sendPetHealthDataToServer(deviceId);
        return;
        
      } catch (error) {
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
      }
    }
  }

  setScreenActiveState(deviceId, isActive) {
    const currentState = this.screenActiveStates.get(deviceId);
    
    if (currentState !== isActive) {
      this.screenActiveStates.set(deviceId, isActive);
      
      this.restartAdaptiveApiCalling(deviceId);
      
      if (isActive) {
        const success = this.startGetApiCalling(deviceId);
      } else {
        this.stopGetApiCalling(deviceId);
      }
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

  startAdaptiveApiCalling(deviceId) {
    return;
  }
  
  startJSTimer(deviceId, interval) {
    return;
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

  restartAdaptiveApiCalling(deviceId) {
    if (this.adaptiveApiCooldowns.has(deviceId)) {
      return;
    }

    const device = this.scannedDevices.get(deviceId);
    if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
      if (this.adaptiveApiTimers.has(deviceId)) {
        const currentInterval = this.getCurrentApiInterval(deviceId);
        const existingTimer = this.adaptiveApiTimers.get(deviceId);
        
        const shouldUseNative = this.appState === 'background' && Platform.OS === 'android' && SampleBridgeAndroid;
        const currentlyNative = existingTimer && existingTimer.isNative;
        
        if (existingTimer && (existingTimer.interval !== currentInterval || currentlyNative !== shouldUseNative)) {
          this.adaptiveApiCooldowns.set(deviceId, true);
          setTimeout(() => {
            this.adaptiveApiCooldowns.delete(deviceId);
          }, 2000);
          
          this.startAdaptiveApiCalling(deviceId);
        }
      }
    }
  }

  stopAllAdaptiveApi() {
    for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
      if (timerInfo && timerInfo.timer) {
        clearInterval(timerInfo.timer);
      }
    }
    this.adaptiveApiTimers.clear();
  }

  async updateAppState(newState) {
    const oldState = this.appState;
    
    if (oldState === newState) {
      return;
    }
    
    if (this.isUpdatingAppState) {
      return;
    }
    
    this.isUpdatingAppState = true;
    
    try {
      this.appState = newState;
      
      // ✅ CRITICAL FIX: Notify native module about app state change
      // This triggers service rebinding and connection restoration when app reopens
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        try {
          await SampleBridgeAndroid.onAppStateChanged(newState);
          console.log(`✅ Native module notified of app state change: ${newState}`);
        } catch (error) {
          console.error(`❌ Failed to notify native module of app state change: ${error.message}`);
        }
      }
      
      if (newState === 'background') {
        for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
          if (buffer.length > 0) {
            await this.uploadLiveBatch(deviceId);
          }
        }
        
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        if (this.rssiCycleActive) {
          this.restartRssiCycle();
        }
      } else if (newState === 'active') {
        for (const [deviceId, timerInfo] of this.adaptiveApiTimers.entries()) {
          const currentScreenState = this.screenActiveStates.get(deviceId);
          if (currentScreenState === undefined) {
            this.screenActiveStates.set(deviceId, true);
          }
          this.restartAdaptiveApiCalling(deviceId);
        }
        
        this.fetchLatestDataOnAppReopen();
        
        this.triggerPendingUIUpdates();
        
        if (Platform.OS === 'android') {
          await this.refreshAndroidSystemConnectedDevices();
        }
        
        if (this.connectedDevices.size > 0) {
          this.restartRssiCycle();
        }
      }
    } finally {
      this.isUpdatingAppState = false;
    }
  }
  
  triggerPendingUIUpdates() {
    if (!this.pendingUIUpdates || this.pendingUIUpdates.size === 0) {
      return;
    }
    
    for (const [deviceId, deviceData] of this.pendingUIUpdates) {
      if (this.onDeviceDataUpdated) {
        this.onDeviceDataUpdated(deviceId, deviceData);
      }
    }
    
    this.pendingUIUpdates.clear();
  }

  startGetApiCalling(deviceId) {
    this.stopGetApiCalling(deviceId);
    
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      return false;
    }
    
    if (device.connectionState !== CONNECTION_STATES.CONNECTED) {
      return false;
    }
    
    const interval = this.getApiConfig.ACTIVE_SCREEN_INTERVAL;
    const powerProfileName = this.profile === POWER_PROFILE.lowPower ? 'lowPower' : 
                           this.profile === POWER_PROFILE.ultraLowPower ? 'ultraLowPower' : 'default';
    
    const timer = setInterval(async () => {
      try {
        if (this.appState !== 'active') {
          return { success: false, error: 'SMART_TAG service not available' };
        }
        
        const currentDevice = this.scannedDevices.get(deviceId);
        if (!currentDevice || currentDevice.connectionState !== CONNECTION_STATES.CONNECTED) {
          this.stopGetApiCalling(deviceId);
          return { success: false, error: 'SMART_TAG service not available' };
        }
        
        await this.fetchPetHealthDetails(deviceId);
        
      } catch (error) {
      }
    }, interval);
    
    this.getApiTimers.set(deviceId, { timer, interval });
    
    return true;
  }

  stopGetApiCalling(deviceId) {
    const timerInfo = this.getApiTimers.get(deviceId);
    if (timerInfo && timerInfo.timer) {
      clearInterval(timerInfo.timer);
      this.getApiTimers.delete(deviceId);
    }
  }

  stopAllGetApi() {
    for (const [deviceId, timerInfo] of this.getApiTimers.entries()) {
      this.stopGetApiCalling(deviceId);
    }
    this.getApiTimers.clear();
  }

  async fetchPetHealthDetails(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }

      const petId = device.petId || 1059773;
      
      const result = await getPetHealthBLEDetails(petId);
      
      if (result.success !== false) {
        if (device.deviceData) {
          device.deviceData.serverData = result;
          device.deviceData.lastServerFetch = new Date();
        }
        
        this.emit('petHealthDataUpdated', { deviceId, data: result });
      }
      
    } catch (error) {
    }
  }

  async fetchLatestDataOnAppReopen() {
    try {
      const connectedDevices = Array.from(this.scannedDevices.entries())
        .filter(([deviceId, device]) => device.connectionState === CONNECTION_STATES.CONNECTED);
      
      if (connectedDevices.length === 0) {
        return;
      }
      
      for (const [deviceId, device] of connectedDevices) {
        await this.fetchPetHealthDetails(deviceId);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
    } catch (error) {
    }
  }

  manualGetApiCall = async (deviceId) => {
    await this.fetchPetHealthDetails(deviceId);
  }

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

  startGetApiCallingManual = (deviceId) => {
    this.setScreenActiveState(deviceId, true);
  }

  stopGetApiCallingManual = (deviceId) => {
    this.setScreenActiveState(deviceId, false);
  }

  debugGetApiStatus = () => {
  }

  forceStartGetApiForAllDevices = () => {
    let startedCount = 0;
    
    for (const [deviceId, device] of this.scannedDevices.entries()) {
      if (device && device.connectionState === CONNECTION_STATES.CONNECTED) {
        this.setScreenActiveState(deviceId, true);
        const success = this.startGetApiCalling(deviceId);
        if (success) startedCount++;
      }
    }
  }

  forceStopGetApiForAllDevices = () => {
    this.stopAllGetApi();
  }

  on(eventName, callback) {
    if (!this.events[eventName]) {
      this.events[eventName] = [];
    }
    this.events[eventName].push(callback);
  }

  off(eventName, callback) {
    if (!this.events[eventName]) return;
    
    if (callback) {
      this.events[eventName] = this.events[eventName].filter(cb => cb !== callback);
    } else {
      delete this.events[eventName];
    }
  }

  emit(eventName, data) {
    if (!this.events[eventName]) return;
    
    this.events[eventName].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
      }
    });
  }

  removeAllListeners(eventName) {
    if (eventName) {
      delete this.events[eventName];
    } else {
      this.events = {};
    }
  }

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

  async forgetDevice(deviceId) {
    try {
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device?.name || 'Unknown Device';
      
      if (this.connectedDevices.has(deviceId)) {
        await this.disconnectFromDevice(deviceId);
      }
      
      this.connectedDevices.delete(deviceId);
      
      this.scannedDevices.delete(deviceId);
      
      if (Platform.OS === 'ios') {
        try {
          await this.removeDeviceFromBondedList(deviceId);
        } catch (error) {
        }
      } else {
        try {
          await AutoConnectService.removeBondedDevice(deviceId);
        } catch (error) {
        }
      }
      
      this.clearDeviceData(deviceId);
      
      this.stopDeviceOperations(deviceId);
      
      this.addConnectionLog(deviceId, 'Disconnected', { reason: 'forgotten' });
      
      this.emit('deviceDisconnected', {
        deviceId,
        deviceName,
        reason: 'forgotten',
        forgotten: true
      });
      
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

  clearDeviceData(deviceId) {
    // ✅ Flush pending characteristics logs before clearing data
    this.flushPendingCharacteristicsLogs(deviceId);
    
    // Clear batch timer if exists
    const batchTimer = this.characteristicsLogBatchTimers.get(deviceId);
    if (batchTimer) {
      clearTimeout(batchTimer);
      this.characteristicsLogBatchTimers.delete(deviceId);
    }
    
    // Clear discovery log tracking
    this.lastServiceDiscoveryLog.delete(deviceId);
    this.lastCharacteristicsDiscoveryLog.delete(deviceId);
    this.pendingCharacteristicsLogs.delete(deviceId);
    
    // Clear Android-specific deduplication tracking
    this.lastConnectedLogs.delete(deviceId);
    this.lastRecordSyncedLogs.delete(deviceId);
    this.lastRTCReadLogs.delete(deviceId);
    this.lastCommandResponseLogs.delete(deviceId);
    
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

  stopDeviceOperations(deviceId) {
    if (this.heartbeatTimers && this.heartbeatTimers.has(deviceId)) {
      const timer = this.heartbeatTimers.get(deviceId);
      if (timer) {
        clearInterval(timer);
        this.heartbeatTimers.delete(deviceId);
      }
    }
    
    if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
      const timer = this.reconnectionTimers.get(deviceId);
      if (timer) {
        clearTimeout(timer);
        this.reconnectionTimers.delete(deviceId);
      }
    }
    
    if (this.reconnectionAttempts && this.reconnectionAttempts.has(deviceId)) {
      this.reconnectionAttempts.delete(deviceId);
    }
  }

  getAutoSyncConfiguration() {
    return this.getAutoSyncConfig();
  }
  
  updateAutoSyncConfiguration(newConfig) {
    this.updateAutoSyncConfig(newConfig);
  }
  
  getSyncMetricsForDevice(deviceId) {
    return this.getSyncMetrics(deviceId);
  }
  
  getStateTransitionHistory(deviceId) {
    return this.stateTransitionHistory?.get(deviceId) || [];
  }
  
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
  
  clearSyncQueue(deviceId) {
    if (this.syncQueue?.has(deviceId)) {
      this.syncQueue.set(deviceId, []);
    }
  }
  
  resetSyncMetrics(deviceId) {
    if (this.syncMetrics?.has(deviceId)) {
      this.syncMetrics.delete(deviceId);
    }
  }
  
  onAutoSyncFeedback(callback) {
    this.on('autoSyncFeedback', callback);
  }
  
  onStateTransition(callback) {
    this.on('stateTransition', callback);
  }
  
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
      
      this.stopRssiCycle();
      
      for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
        if (buffer.length > 0) {
          this.uploadLiveBatch(deviceId).catch(err => {
          });
        }
      }
      
      for (const timer of this.batchUploadTimers.values()) {
        clearInterval(timer);
      }
      this.batchUploadTimers.clear();
      
      this.liveDataBuffers.clear();
      this.lastBatchUpload.clear();
      this.historicalSyncComplete.clear();
      
      this.adaptiveApiCooldowns.clear();
      
      this.removeAllListeners();

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

      for (const subscription of this.monitoringSubscriptions.values()) {
        subscription.remove();
      }
      this.monitoringSubscriptions.clear();
      
      this.connectedDevices.clear();
      this.scannedDevices.clear();
      this.manualDisconnectCooldown.clear();
      this.rssiValues.clear();
      this.rssiHistory.clear();
      this.lastRssiUpdate.clear();
      this.screenActiveStates.clear();
      this.knownDeviceIds.clear();
      
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
      
      if (Platform.OS === 'android') {
        DeviceEventEmitter.removeAllListeners('DeviceFound');
        DeviceEventEmitter.removeAllListeners('ConnectionStateChanged');
        DeviceEventEmitter.removeAllListeners('CharacteristicDataReceived');
        DeviceEventEmitter.removeAllListeners('CharacteristicChanged');
        DeviceEventEmitter.removeAllListeners('CharacteristicData');
        DeviceEventEmitter.removeAllListeners('DeviceDataUpdated');
        DeviceEventEmitter.removeAllListeners('HealthDataApiRequest');
        DeviceEventEmitter.removeAllListeners('SystemCommandEvent');
        DeviceEventEmitter.removeAllListeners('SystemCommandResponse');
        DeviceEventEmitter.removeAllListeners('DataTransferEvent');
        DeviceEventEmitter.removeAllListeners('DataTransfer');
        DeviceEventEmitter.removeAllListeners('ServiceDiscoveryComplete');
        DeviceEventEmitter.removeAllListeners('ServicesDiscovered');
        DeviceEventEmitter.removeAllListeners('RSSIUpdated');
        DeviceEventEmitter.removeAllListeners('RSSIUpdate');
        DeviceEventEmitter.removeAllListeners('ScanStateChanged');
        DeviceEventEmitter.removeAllListeners('DeviceDisconnected');
        DeviceEventEmitter.removeAllListeners('DeviceReconnected');
        DeviceEventEmitter.removeAllListeners('DeviceConnected');
      }
      
    } catch (error) {
    }
  }
  
  async enterDFUMode(deviceId) {
    try {
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.enterDFUMode(deviceId);
      } else {
        result = await BridgingCodeModule.enterDFUMode(deviceId);
      }
      
      return result;
      
    } catch (error) {
      throw error;
    }
  }
  
  async startDFU(deviceId, firmwarePath, callbacks = {}) {
    try {
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
      
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.startDFU(deviceId, firmwarePath);
      } else {
        result = await BridgingCodeModule.startDFU(deviceId, firmwarePath);
      }
      
      return result;
      
    } catch (error) {
      throw error;
    }
  }
  
  async cancelDFU() {
    try {
      let result;
      if (Platform.OS === 'android') {
        result = await SampleBridgeAndroid.cancelDFU();
      } else {
        result = await BridgingCodeModule.cancelDFU();
      }
      
      this.removeAllListeners('DFUProgress');
      this.removeAllListeners('DFUStateChanged');
      this.removeAllListeners('DFUError');
      this.removeAllListeners('DFUCompleted');
      this.removeAllListeners('DFUAborted');
      
      return result;
      
    } catch (error) {
      throw error;
    }
  }
  
  async isDeviceInDFUMode(deviceId) {
    try {
      let isInDFU;
      if (Platform.OS === 'android') {
        isInDFU = await SampleBridgeAndroid.isDeviceInDFUMode(deviceId);
      } else {
        isInDFU = await BridgingCodeModule.isDeviceInDFUMode(deviceId);
      }
      
      return isInDFU;
    } catch (error) {
      return false;
    }
  }
  
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
      return '00001530-1212-efde-1523-785feabcd123';
    }
  }
  
  async downloadFirmware(firmwareVersion, serverUrl = 'https://your-server.com/firmware') {
    try {
      const RNFS = require('react-native-fs');
      
      const firmwareUrl = `${serverUrl}/${firmwareVersion}/firmware.zip`;
      const localPath = `${RNFS.DocumentDirectoryPath}/firmware_${firmwareVersion}.zip`;
      
      const exists = await RNFS.exists(localPath);
      if (exists) {
        return localPath;
      }
      
      const downloadResult = await RNFS.downloadFile({
        fromUrl: firmwareUrl,
        toFile: localPath,
        background: true,
        progressDivider: 10,
        begin: (res) => {
        },
        progress: (res) => {
        }
      }).promise;
      
      if (downloadResult.statusCode === 200) {
        return Platform.OS === 'ios' ? `file://${localPath}` : `file://${localPath}`;
      } else {
        throw new Error(`Download failed with status: ${downloadResult.statusCode}`);
      }
      
    } catch (error) {
      throw error;
    }
  }
  
  async checkForFirmwareUpdate(deviceId, currentVersion) {
    try {
      const MOCK_MODE = true;
      
      if (MOCK_MODE) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        return {
          updateAvailable: true,
          latestVersion: '2.0.0',
          releaseNotes: '• Fixed battery drain issue\n• Improved step counting accuracy\n• Enhanced BLE stability',
          critical: false,
          downloadUrl: 'https://your-server.com/firmware/2.0.0/firmware.zip'
        };
      }
      
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
      
      return {
        updateAvailable: data.updateAvailable || false,
        latestVersion: data.latestVersion || currentVersion,
        releaseNotes: data.releaseNotes || '',
        critical: data.critical || false,
        downloadUrl: data.downloadUrl || null
      };
      
    } catch (error) {
      return {
        updateAvailable: false,
        latestVersion: currentVersion,
        releaseNotes: '',
        critical: false,
        downloadUrl: null
      };
    }
  }
  
  async performFirmwareUpdate(deviceId, firmwareVersion, callbacks = {}) {
    try {
      if (callbacks.onDownloadStart) {
        callbacks.onDownloadStart();
      }
      
      const firmwarePath = await this.downloadFirmware(firmwareVersion);
      
      if (callbacks.onDownloadComplete) {
        callbacks.onDownloadComplete(firmwarePath);
      }
      
      if (callbacks.onEnteringDFU) {
        callbacks.onEnteringDFU();
      }
      
      await this.enterDFUMode(deviceId);
      
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const result = await this.startDFU(deviceId, firmwarePath, callbacks);
      
      return result;
      
    } catch (error) {
      throw error;
    }
  }
}

// Export singleton instance
export default new BLEService();

