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
  FIRMWARE_V15_ADVERTISING
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
import AsyncStorage from '@react-native-async-storage/async-storage';
const { SampleBridgeAndroid, BridgingCodeModule } = NativeModules;
class BLEService {
  constructor() {
    this.events = {};
    this.operationQueue = Promise.resolve();
    this.connectedDevices = new Map();
    this.scannedDevices = new Map();
    this.deviceDataStore = new Map();
    this.scanState = SCAN_STATES.IDLE;
    this.bleState = BLE_STATES.UNKNOWN;
    this.scanSubscription = null;
    this.monitoringSubscriptions = new Map();
    this.onDeviceDataUpdated = null;
    this.onDeviceListUpdated = null;
    this.pendingAutoConnectDevice = null;
    this.manualDisconnectCooldown = new Map();
    this.connectionHealthTimer = null;
    this.disconnectSubscriptions = new Map();
    this.isRefreshingSystemDevices = false;
    this.lastSystemRefreshTime = 0;
    this.healthCheckFailures = new Map();
    this.profile = POWER_PROFILE?.default || { healthCheckMs: 10000, healthRssiEveryNTicks: 3, scanMode: 'LowLatency', rssiCycleIntervalMs: 30000, rssiCycleDurationMs: 3000, pruneIntervalMs: 300000, pruneAgeMs: 600000 };
    this.healthTick = 0;
    this.pruneTimer = null;
    this.debouncedListUpdate = null;
    this.knownDeviceIds = new Set();
    this.recentAutoConnects = new Map();
    this.androidAutoConnectEnabled = false;
    this.pendingConnectedLogTimers = new Map();
    this.pendingManualConnects = new Map();
    this.connectionStateDebounce = new Map();
    this.CONNECTION_DEBOUNCE_WINDOW_MS = 5000;
    this.MAX_DISCONNECTS_PER_WINDOW = 10;
    this.CONNECTION_BLOCK_DURATION_MS = 30000;
    this.syncExpectedRecords = new Map();
    this.syncTimeouts = new Map();
    this.SYNC_TIMEOUT_MS = 120000;
    this.syncRetryDelays = new Map();
    this.MAX_SYNC_RETRIES = 3;
    this.pendingCommands = new Map();
    this.commandDedupeWindow = 2000;
    this.commandQueue = new Map();
    this.commandInProgress = new Map();
    this.pendingCommandResponses = new Map();
    this.COMMAND_RESPONSE_TIMEOUT_MS = 10000;
    this.errorContexts = new Map();
    this.maxErrorHistory = 50;
    this.rssiCycleTimer = null;
    this.rssiCycleActive = false;
    this.rssiValues = new Map();
    this.rssiHistory = new Map();
    this.lastRssiUpdate = new Map();
    this.phoneBatteryLevel = null;
    this.requestDataMutex = new Map();
    this.requestDataTimers = new Map();
    this.systemCommandResponses = new Map();
    this.lastTimeSyncAttempt = new Map();
    this.deviceRestartTimes = new Map();
    this.pendingFlashClearCommands = new Map();
    this.autoSyncTimers = new Map();
    this.autoSyncMeta = new Map();
    // Industry flow: Phase 0 connect → Phase 1 decide (once) → Phase 2 history_sync → Phase 3 live. Never mix live + history.
    this.connectionPhase = new Map(); // deviceId -> 'decide' | 'history_sync' | 'live'
    this.manualReadTimestamps = new Map();
    this.lastNotificationData = new Map();
    this.lastTimerReset = new Map();
    this.timerResetDebounceWindow = 500;
    this.notificationDedupeWindow = 100;
    // ✅ OPTIMIZATION: Track last Device Status to filter redundant notifications
    this.lastDeviceStatus = new Map(); // deviceId -> { recordCount, batteryLevel, timestamp }
    // ✅ OPTIMIZATION: Notification aggregation buffer
    this.deviceStatusNotificationBuffer = new Map(); // deviceId -> { notifications: [], timer }
    // Shorter window on iOS so sync starts sooner (Android may send more duplicate device status, keep 500ms)
    this.notificationAggregationWindow = Platform.OS === 'ios' ? 250 : 500; // ms before decide/sync start
    this.lastServiceDiscoveryLog = new Map();
    this.lastCharacteristicsDiscoveryLog = new Map();
    this.discoveryLogDedupeWindow = 2000;
    this.pendingCharacteristicsLogs = new Map();
    this.characteristicsLogBatchWindow = 200;
    this.characteristicsLogBatchTimers = new Map();
    this.lastConnectedLogs = new Map();
    this.lastRecordSyncedLogs = new Map();
    this.latestNativeSyncCompletionEvent = new Map(); // deviceId -> parsedTransfer (recordsTransmitted, etc.) for sendHistoricalRecords/logs
    this.lastRTCReadLogs = new Map();
    this.lastCommandResponseLogs = new Map();
    // ✅ FIX: Deduplicate RSSI update logs (prevent duplicate logs from native event + JS polling)
    this.lastRssiLogTime = new Map(); // deviceId -> timestamp
    this.rssiLogDedupeWindow = 5000; // 5 seconds - only log RSSI once per 5s per device
    // ✅ Deduplicate live data logs (prevent duplicate logs from multiple handlers)
    this.lastLiveDataLogTime = new Map(); // deviceId -> { timestamp, recordTimestamp }
    this.liveDataLogDedupeWindow = 2000; // 2 seconds - only log same live data once per 2s
    // ✅ FIX: Deduplicate sync progress events (prevent duplicate sync_records events)
    this.lastSyncProgressEvents = new Map(); // deviceId -> { timestamp, totalReceived, totalExpected, recordsReceived }
    // ✅ FIX: After force-complete/retry, native may send totalExpected=0; preserve last known so we never show "X/0"
    this.lastKnownSyncTotalExpected = new Map(); // deviceId -> number
    this.syncProgressDedupeWindow = 100; // 100ms - legacy dedupe
    this.syncProgressThrottleMs = 200;  // Only emit sync_records to UI every 200ms
    this.syncProgressThrottleRecords = 25; // Or every 25 records — prevents UI hang during 8000-record sync
    this.syncRetryAttempts = new Map();
    this.syncRetryTimers = new Map();
    this.maxSyncRetries = 3;
    this.baseRetryDelay = 1000;
    this.syncQueue = new Map();
    this.processingSync = new Map();
    this.syncMetrics = new Map();
    this.recordAccumulationRates = new Map();
    this.adaptiveThrottleConfig = {
      fast: 29000,
      normal: 29000,
      slow: 59000
    };
    this.lastNotificationTime = new Map();
    this.autoSyncConfig = {
      debounceDelay: 0,
      throttleMode: 'adaptive',
      customThrottle: 29000,
      maxRetries: 3,
      enableMetrics: true,
      enableUserFeedback: true
    };
    this.stateTransitionHistory = new Map();
    this.maxStateHistory = 20;
    this.liveDataBuffers = new Map();
    this.lastBatchUpload = new Map();
    this.batchUploadTimers = new Map();
    this.liveDataConfig = {
      bufferSize: 10,
      uploadInterval: 300000,
      immediateThreshold: {
        tempChange: 2,
        stepChange: 50,
        batteryLow: 15
      }
    };
    this.adaptiveApiTimers = new Map();
    this.screenActiveStates = new Map();
    this.appState = 'active';
    this.isUpdatingAppState = false;
    this.adaptiveApiCooldowns = new Map();
    this.adaptiveApiConfig = {
      ACTIVE_SCREEN_INTERVAL: 15000,
      BACKGROUND_INTERVAL: 60000,
      INACTIVE_SCREEN_INTERVAL: 60000,
      MIN_INTERVAL: 10000,
      MAX_INTERVAL: 300000
    };
    this.getApiTimers = new Map();
    this.getApiConfig = {
      ACTIVE_SCREEN_INTERVAL: 15000,
      BACKGROUND_INTERVAL: 0,
      INACTIVE_SCREEN_INTERVAL: 0
    };
    if (Platform.OS === 'ios') {
      this.manager = null;
      this.setupIOSEventListeners();
    } else {
      this.manager = null;
      this.setupAndroidEventListeners();
    }
    this.init();
    this.setupAutoConnectCallbacks();
    this.checkAndStartAutoScan();
  }
  setupIOSEventListeners() {
    this.iosEventEmitter = new NativeEventEmitter(BridgingCodeModule);

    // =========================================================================
    // iOS EVENT LISTENERS - Only events that native actually sends
    // Verified against BridgingCodeModule.swift sendEvent() calls
    // =========================================================================

    // Device discovery
    this.iosEventEmitter.addListener('DeviceFound', (deviceInfo) => {
      this.handleIOSDeviceFound(deviceInfo);
    });

    // Connection events
    this.iosEventEmitter.addListener('DeviceConnected', (deviceInfo) => {
      this.handleIOSDeviceConnected(deviceInfo);
    });
    this.iosEventEmitter.addListener('DeviceDisconnected', (deviceInfo) => {
      this.handleIOSDeviceDisconnected(deviceInfo);
    });

    // Service discovery
    this.iosEventEmitter.addListener('ServicesDiscovered', (eventData) => {
      this.handleIOSServicesDiscovered(eventData);
    });
    this.iosEventEmitter.addListener('CharacteristicsDiscovered', (eventData) => {
      this.handleIOSCharacteristicsDiscovered(eventData);
    });
    this.iosEventEmitter.addListener('ServiceDiscoveryComplete', (eventData) => {
      this.handleServiceDiscoveryComplete(eventData);
    });

    // Characteristic data
    this.iosEventEmitter.addListener('CharacteristicData', (eventData) => {
      this.handleIOSCharacteristicData(eventData);
    });

    // Data transfer (sync records, live data)
    this.iosEventEmitter.addListener('DataTransfer', (eventData) => {
      this.handleNativeDataTransferEvent(eventData);
    });

    // System command responses
    this.iosEventEmitter.addListener('SystemCommandResponse', (eventData) => {
      this.handleNativeSystemCommandResponse(eventData);
    });
    this.iosEventEmitter.addListener('NativeCommandSent', (eventData) => {
      this.handleNativeCommandSent(eventData);
    });

    // Device data updates
    this.iosEventEmitter.addListener('DeviceDataUpdated', (event) => {
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error('Error in handleDeviceDataUpdated:', error);
      }
    });

    // RTC and RSSI
    this.iosEventEmitter.addListener('RTCRead', (eventData) => {
      this.handleRTCRead(eventData);
    });
    this.iosEventEmitter.addListener('RSSIUpdate', (eventData) => {
      this.handleIOSRSSIUpdate(eventData);
    });

    // Connection log events from native (notifications enabled, etc.)
    this.iosEventEmitter.addListener('ConnectionLog', (eventData) => {
      this.handleNativeConnectionLog(eventData);
    });

    // Health data API
    this.iosEventEmitter.addListener('HealthDataApiRequest', (eventData) => {
      this.handleNativeHealthDataApiRequest(eventData);
    });

    // McuMgr DFU (MCUboot over SMP) - iOS
    this.iosEventEmitter.addListener('DFUStateChanged', (eventData) => {
      this.emit('DFUStateChanged', eventData);
    });
    this.iosEventEmitter.addListener('DFUProgress', (eventData) => {
      this.emit('DFUProgress', eventData);
    });
    this.iosEventEmitter.addListener('DFUError', (eventData) => {
      this.emit('DFUError', eventData);
    });

    // =========================================================================
    // REMOVED ORPHAN LISTENERS (iOS declares but never sends these events):
    // - AutoConnectDeviceConnected: Declared in supportedEvents but never sent
    // - AutoConnectDeviceDisconnected: Declared in supportedEvents but never sent
    // - deviceDataUpdate: Only Android sends this (iOS uses DeviceDataUpdated)
    // =========================================================================
  }
  setupAndroidEventListeners() {
    if (Platform.OS !== 'android') return;

    // =========================================================================
    // ANDROID EVENT LISTENERS - Only events that native actually sends
    // Verified against SampleBridgeAndroid.java sendEvent() calls
    // =========================================================================

    // Device discovery
    DeviceEventEmitter.addListener('DeviceFound', (deviceInfo) => {
      this.handleAndroidDeviceFound(deviceInfo);
    });

    // Connection events
    DeviceEventEmitter.addListener('DeviceConnected', (event) => {
      this.handleAndroidDeviceConnected(event);
    });
    DeviceEventEmitter.addListener('DeviceDisconnected', (event) => {
      this.handleAndroidDeviceDisconnected(event);
    });

    // Android: manual connection only; no AutoConnect events (native does not send them).

    // Service discovery
    DeviceEventEmitter.addListener('ServicesDiscovered', (event) => {
      this.handleAndroidServicesDiscovered(event);
    });
    DeviceEventEmitter.addListener('ServiceDiscoveryComplete', (eventData) => {
      this.handleServiceDiscoveryComplete(eventData);
    });

    // Characteristic data
    DeviceEventEmitter.addListener('CharacteristicData', (event) => {
      this.handleAndroidCharacteristicData(event);
    });

    // Device data updates
    DeviceEventEmitter.addListener('DeviceDataUpdated', (event) => {
      try {
        this.handleDeviceDataUpdated(event);
      } catch (error) {
        console.error('Error in handleDeviceDataUpdated:', error);
      }
    });
    DeviceEventEmitter.addListener('deviceDataUpdate', (event) => {
      this.handleAndroidDeviceDataUpdateEvent(event);
    });

    // Data transfer (sync records, live data)
    DeviceEventEmitter.addListener('DataTransfer', (eventData) => {
      this.handleNativeDataTransferEvent(eventData);
    });

    // System command responses
    DeviceEventEmitter.addListener('SystemCommandResponse', (eventData) => {
      this.handleNativeSystemCommandResponse(eventData);
    });
    DeviceEventEmitter.addListener('NativeCommandSent', (eventData) => {
      this.handleNativeCommandSent(eventData);
    });

    // RTC and RSSI
    DeviceEventEmitter.addListener('RTCRead', (eventData) => {
      this.handleRTCRead(eventData);
    });
    DeviceEventEmitter.addListener('RSSIUpdate', (event) => {
      this.handleAndroidRSSIUpdate(event);
    });

    // ✅ NEW: Device Status manual read event (drives history sync decision)
    DeviceEventEmitter.addListener('DeviceStatusRead', (eventData) => {
      this.handleDeviceStatusManualRead(eventData);
    });

    // Health data API
    DeviceEventEmitter.addListener('HealthDataApiRequest', (eventData) => {
      this.handleNativeHealthDataApiRequest(eventData);
    });

    // Connection log events from native (notifications enabled, etc.)
    DeviceEventEmitter.addListener('ConnectionLog', (eventData) => {
      this.handleNativeConnectionLog(eventData);
    });

    // MCUboot DFU over SMP (McuMgr) - Android
    DeviceEventEmitter.addListener('DFUStateChanged', (eventData) => {
      this.emit('DFUStateChanged', eventData);
    });
    DeviceEventEmitter.addListener('DFUProgress', (eventData) => {
      this.emit('DFUProgress', eventData);
    });
    DeviceEventEmitter.addListener('DFUError', (eventData) => {
      this.emit('DFUError', eventData);
    });

    // =========================================================================
    // REMOVED ORPHAN LISTENERS (native never sends these events):
    // - ConnectionStateChanged: Not sent by Android native
    // - ScanStateChanged: Not sent by Android native
    // - DeviceReconnected: Not sent by Android native
    // =========================================================================
  }
  init() {
    this.requestPermissions().then(() => {
      this.isBLEReady().then(ready => {
        this.bleState = ready ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
      });
    });
    this.appState = AppState.currentState;
    this.appStateSub = AppState.addEventListener('change', (state) => {
      this.updateAppState(state);
      if (state !== 'active') {
        this.stopConnectionHealthCheck();
      } else if (this.connectedDevices.size > 0) {
        this.startConnectionHealthCheck();
      }
    });
    if (Platform.OS === 'android') {
      this.isBLEReady().then(ready => {
        if (ready) {
          setTimeout(() => {
            this.refreshAndroidSystemConnectedDevices();
          }, 1000);
        } else {
          console.log('⏭️ [INIT] BLE not ready, skipping system device refresh');
        }
      }).catch(error => {
        console.warn('⚠️ [INIT] Could not check BLE ready state:', error?.message || error);
      });
    }
    this.startPhoneBatteryMonitoring();
    this.startPruning();
    this.syncExistingRecordsToRedux();
  }
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
  addToLiveBuffer(deviceId, data) {
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
  shouldUploadBatch(deviceId) {
    const buffer = this.liveDataBuffers.get(deviceId) || [];
    const lastUpload = this.lastBatchUpload.get(deviceId) || 0;
    const timeSinceLastUpload = Date.now() - lastUpload;
    return buffer.length >= this.liveDataConfig.bufferSize ||
      timeSinceLastUpload >= this.liveDataConfig.uploadInterval ||
      (buffer.length > 0 && this.appState !== 'active');
  }
  async uploadLiveBatch(deviceId) {
    const buffer = this.liveDataBuffers.get(deviceId);
    if (!buffer || buffer.length === 0) return;
    const oldestRecord = buffer[0];
    const newestRecord = buffer[buffer.length - 1];
    const stepsDelta = newestRecord.steps - oldestRecord.steps;
    const currentSteps = newestRecord.steps;
    const latestTemperature = newestRecord.temperature;
    const averageTemperature = buffer.reduce((sum, r) => sum + r.temperature, 0) / buffer.length;
    const minTemperature = Math.min(...buffer.map(r => r.temperature));
    const maxTemperature = Math.max(...buffer.map(r => r.temperature));
    const device = this.scannedDevices.get(deviceId);
    try {
      const payload = {
        PetId: 1059773,
        Steps: currentSteps,
        Temperature: latestTemperature ? latestTemperature.toString() : null,
        BatteryLevel: newestRecord.batteryLevel ? newestRecord.batteryLevel.toString() : null,
        TimeStamp: newestRecord.timestampDate.toISOString(),
        Status: device?.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device?.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [],
        SyncType: "live_batch",
        BatchedAt: new Date().toISOString(),
        AllRecords: buffer.map(r => ({
          Timestamp: r.timestampDate.toISOString(),
          Steps: r.steps,
          Temperature: r.temperature,
          BatteryLevel: r.batteryLevel,
          Flags: r.flags,
          RecordType: "live"
        })),
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
      // TEMPORARILY DISABLED: API calls commented out
      // const result = await postPetHealthBLEData(payload);
      this.liveDataBuffers.set(deviceId, []);
      this.lastBatchUpload.set(deviceId, Date.now());
    } catch (error) {
      console.error(`❌ [LIVE BATCH] Upload failed:`, error);
    }
  }
  async checkImmediateAlert(deviceId, currentData) {
    const buffer = this.liveDataBuffers.get(deviceId);
    if (!buffer || buffer.length === 0) return;
    const previousData = buffer[buffer.length - 1];
    const config = this.liveDataConfig.immediateThreshold;
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
    if (currentData.batteryLevel !== null && currentData.batteryLevel < config.batteryLow) {
      await this.sendImmediateAlert(deviceId, currentData, 'low_battery', {
        batteryLevel: currentData.batteryLevel
      });
      return true;
    }
    return false;
  }
  async sendImmediateAlert(deviceId, data, alertType, alertData) {
    const device = this.scannedDevices.get(deviceId);
    try {
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
        SyncType: "immediate_alert",
        AlertType: alertType,
        AlertData: alertData,
        AlertedAt: new Date().toISOString()
      };
      // TEMPORARILY DISABLED: API calls commented out
      // const result = await postPetHealthBLEData(payload);
    } catch (error) {
      console.error(`❌ [IMMEDIATE ALERT] Failed to send:`, error);
    }
  }
  async sendHistoricalRecords(deviceId, records) {
    if (!records || records.length === 0) {
      return;
    }
    console.log(`📤 [HISTORICAL SYNC] Sending ${records.length} records + aggregates for ${deviceId}`);
    const totalSteps = records[records.length - 1].steps;
    const latestTemperature = records[records.length - 1].temperature;
    const averageTemperature = records.reduce((sum, r) => sum + r.temperature, 0) / records.length;
    const minTemperature = Math.min(...records.map(r => r.temperature));
    const maxTemperature = Math.max(...records.map(r => r.temperature));
    const stepsDelta = records.length > 1 ?
      records[records.length - 1].steps - records[0].steps :
      records[0].steps;
    const device = this.scannedDevices.get(deviceId);
    try {
      const latestRecord = records[records.length - 1];
      let timestampISO;
      if (latestRecord.timestampDate && latestRecord.timestampDate instanceof Date) {
        timestampISO = latestRecord.timestampDate.toISOString();
      } else if (typeof latestRecord.timestamp === 'number') {
        timestampISO = new Date(latestRecord.timestamp * 1000).toISOString();
      } else {
        timestampISO = new Date().toISOString();
      }
      const payload = {
        PetId: 1059773,
        Steps: totalSteps,
        Temperature: latestTemperature ? latestTemperature.toString() : null,
        BatteryLevel: device?.deviceData?.batteryLevel ? device.deviceData.batteryLevel.toString() : null,
        TimeStamp: timestampISO,
        Status: device?.connectionState === CONNECTION_STATES.CONNECTED ? 'Connected' : 'Disconnected',
        Characteristic: device?.services ? device.services.map(service => ({
          Characteristic: service.uuid,
          ServiceType: this.getServiceType(service.uuid),
          CharacteristicsCount: service.characteristics ? service.characteristics.length : 0
        })) : [],
        SyncType: "historical_sync",
        SyncedAt: new Date().toISOString(),
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
      // TEMPORARILY DISABLED: API calls commented out
      // const result = await postPetHealthBLEData(payload);
      // if (result && result.success === false) {
      //   console.error(`❌ [HISTORICAL SYNC] Upload failed:`, result.error);
      //   if (result.isNetworkError) {
      //     console.error(`   Network error - will retry on next sync`);
      //   }
      //   return;
      // }
      this.startBatchUploadTimer(deviceId);
    } catch (error) {
      console.error(`❌ [HISTORICAL SYNC] Upload failed:`, error);
    }
  }
  startBatchUploadTimer(deviceId) {
    this.stopBatchUploadTimer(deviceId);
    const timer = setInterval(() => {
      if (this.shouldUploadBatch(deviceId)) {
        this.uploadLiveBatch(deviceId);
      }
    }, 60000);
    this.batchUploadTimers.set(deviceId, timer);
  }
  stopBatchUploadTimer(deviceId) {
    const timer = this.batchUploadTimers.get(deviceId);
    if (timer) {
      clearInterval(timer);
      this.batchUploadTimers.delete(deviceId);
    }
  }
  getBufferStatus() {
    const status = [];
    for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
      const lastUpload = this.lastBatchUpload.get(deviceId) || 0;
      const timeSinceUpload = lastUpload ? (Date.now() - lastUpload) / 1000 : 0;
      status.push({
        deviceId,
        bufferSize: buffer.length,
        maxBufferSize: this.liveDataConfig.bufferSize,
        timeSinceLastUpload: Math.round(timeSinceUpload),
        uploadIntervalSeconds: this.liveDataConfig.uploadInterval / 1000,
        shouldUpload: this.shouldUploadBatch(deviceId),
        oldestRecord: buffer.length > 0 ? buffer[0].timestampDate : null,
        newestRecord: buffer.length > 0 ? buffer[buffer.length - 1].timestampDate : null
      });
    }
    return status;
  }
  async forceUploadAllBuffers() {
    for (const [deviceId, buffer] of this.liveDataBuffers.entries()) {
      if (buffer.length > 0) {
        await this.uploadLiveBatch(deviceId);
      }
    }
  }
  handleIOSDeviceFound(deviceInfo) {
    const manufacturerInfo = deviceInfo.manufacturerData || {};
    // SDD v1.5: advertisement "Number of records available" can be up to 25,000; no cap here, native validates
    const formattedManufacturerData = {
      raw: manufacturerInfo,
      batteryLevel: manufacturerInfo.batteryLevel || null,
      batteryMillivolts: manufacturerInfo.batteryMillivolts || null,
      recordCount: manufacturerInfo.recordCount || 0,
      companyId: manufacturerInfo.companyId || null,
      deviceStatus: manufacturerInfo.deviceStatus || 0,
      indication: manufacturerInfo.indication || 0,
      macId: manufacturerInfo.macId || null,
      version: manufacturerInfo.version || null,
      connectIndication: manufacturerInfo.connectIndication,
      timeSet: manufacturerInfo.timeSet,
      factoryDefaults: manufacturerInfo.factoryDefaults,
      statusText: manufacturerInfo.deviceStatus === 0 ? 'Good' : 'Problem',
      hasRecords: (manufacturerInfo.recordCount || 0) > 0,
      batteryStatus: this.getBatteryStatus(manufacturerInfo.batteryLevel)
    };
    // Firmware v1.5: Determine device state and store optimized scan params
    const deviceState = this.getDeviceState(formattedManufacturerData);
    const optimizedScanParams = this.getOptimizedScanParams(formattedManufacturerData);

    const device = {
      id: deviceInfo.id,
      name: deviceInfo.name || 'Unknown',
      rssi: deviceInfo.rssi,
      manufacturerData: formattedManufacturerData,
      serviceUUIDs: deviceInfo.advertisementData?.serviceUUIDs || [],
      advertisementData: deviceInfo.advertisementData || {},
      isConnectable: true,
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isSmartTag: this.isSmartTag(deviceInfo),
      // Firmware v1.5: Store device state and optimized scan parameters
      deviceState: deviceState,
      optimizedScanParams: optimizedScanParams
    };
    this.scannedDevices.set(device.id, device);
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
    this.emit('deviceFound', device);
  }
  getBatteryStatus(batteryPercent) {
    if (!batteryPercent) return 'Unknown';
    if (batteryPercent >= 80) return 'Excellent';
    if (batteryPercent >= 50) return 'Good';
    if (batteryPercent >= 20) return 'Low';
    return 'Critical';
  }
  handleIOSDeviceConnected(deviceInfo) {
    const deviceId = deviceInfo.deviceId;
    let device = this.scannedDevices.get(deviceId);
    if (!device) {
      device = {
        id: deviceId,
        name: deviceInfo.deviceName || 'Unknown',
        connectionState: CONNECTION_STATES.CONNECTED,
        manufacturerData: {
          macId: null,
          batteryLevel: null,
          recordCount: 0,
          statusText: 'Unknown'
        },
        deviceData: {
          batteryLevel: null,
          temperature: null,
          steps: null,
          lastUpdate: new Date()
        }
      };
    }
    device.connectionState = CONNECTION_STATES.CONNECTED;
    device.connectedAt = new Date();
    device.lastSeen = Date.now();
    const debounceState = this.connectionStateDebounce.get(deviceId);
    if (debounceState) {
      debounceState.disconnectCount = 0;
      debounceState.isDebouncing = false;
      debounceState.blockedUntil = 0;
      this.connectionStateDebounce.set(deviceId, debounceState);
    }
    if (!device.manufacturerData) {
      device.manufacturerData = {
        macId: null,
        batteryLevel: null,
        recordCount: 0,
        statusText: 'Unknown'
      };
    }
    const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
      connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
    );
    if (currentlyConnectedDevices.length > 0) {
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
    const isManual = manualTs && (now - manualTs) < 15000;
    if (isManual) {
      this.pendingManualConnects.delete(deviceId);
      if (this.onDeviceListUpdated) this.onDeviceListUpdated();
      this.emit('deviceConnected', device);
      this.addConnectionLog(deviceId, 'Connected');
      return;
    }
    if (Platform.OS === 'ios') {
      this.recentAutoConnects.set(deviceId, now);
    }
    const existingTimer = this.pendingConnectedLogTimers.get(deviceId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.pendingConnectedLogTimers.delete(deviceId);
    }
    if (this.onDeviceListUpdated) this.onDeviceListUpdated();
    this.emit('deviceConnected', device);
    this.addConnectionLog(deviceId, Platform.OS === 'ios' ? 'Auto-connected' : 'Connected', {
      connectionType: Platform.OS === 'ios' ? 'auto' : 'manual',
      platform: Platform.OS
    });
  }
  handleIOSDeviceDisconnected(deviceInfo) {
    const deviceId = deviceInfo.deviceId;
    this.clearSyncStateOnDisconnect(deviceId);
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
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
      this.addConnectionLog(deviceId, 'Disconnected', {
        reason: deviceInfo.reason || 'unknown',
        errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
        error: deviceInfo.error || null
      });
      if (deviceInfo.reason || deviceInfo.error) {
        this.logError(deviceId, 'DISCONNECTION', {
          reason: deviceInfo.reason || 'unknown',
          errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
          error: deviceInfo.error || null
        });
      }
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
      const newServices = eventData.services || [];
      if (!device.services) {
        device.services = [];
      }
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
      const now = Date.now();
      const lastLog = this.lastServiceDiscoveryLog.get(deviceId);
      const shouldLog = !lastLog ||
        (now - lastLog.timestamp) > this.discoveryLogDedupeWindow ||
        lastLog.serviceCount !== newServices.length ||
        lastLog.addedCount !== addedServiceCount ||
        lastLog.isComplete !== (eventData.complete || false);
      if (shouldLog) {
        const serviceNames = newServices.map(s => {
          const serviceType = this.getServiceType(s.uuid);
          return serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
            .replace(/\b\w/g, l => l.toUpperCase());
        });
        const serviceUuids = newServices.map(s => s.uuid);
        const serviceList = serviceNames.join(', ');
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
        this.lastServiceDiscoveryLog.set(deviceId, {
          timestamp: now,
          serviceCount: newServices.length,
          addedCount: addedServiceCount,
          isComplete: eventData.complete || false
        });
      }
      if (eventData.complete && eventData.services) {
        if (!device.characteristics) {
          device.characteristics = [];
        }
        eventData.services.forEach(service => {
          if (service.characteristics) {
            const serviceCharacteristics = service.characteristics.map(char => ({
              uuid: char.uuid,
              serviceUUID: service.uuid,
              properties: char.properties,
              isNotifying: char.isNotifying
            }));
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
      if (eventData.complete) {
        setTimeout(() => {
          this.startMonitoring(deviceId);
        }, 500);
      }
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
      const newCharacteristics = eventData.characteristics.map(char => {
        const properties = char.properties || {};
        return {
          uuid: char.uuid,
          serviceUUID: eventData.serviceUuid,
          properties: properties,
          isNotifying: char.isNotifying,
          isReadable: properties.read || false,
          isWritable: properties.write || false,
          isWritableWithResponse: properties.writeWithResponse || false,
          isWritableWithoutResponse: properties.writeWithoutResponse || false,
          isNotifiable: properties.notify || false,
          isIndicatable: properties.indicate || false
        };
      });
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
        const serviceType = this.getServiceType(eventData.serviceUuid);
        const serviceName = serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, l => l.toUpperCase());
        if (!this.pendingCharacteristicsLogs.has(deviceId)) {
          this.pendingCharacteristicsLogs.set(deviceId, []);
        }
        const pendingLogs = this.pendingCharacteristicsLogs.get(deviceId);
        pendingLogs.push({
          serviceUuid: eventData.serviceUuid,
          serviceName: serviceName,
          characteristicCount: newCharacteristics.length,
          addedCount: addedCount,
          duplicateCount: duplicateCount,
          timestamp: now
        });
        const existingTimer = this.characteristicsLogBatchTimers.get(deviceId);
        if (existingTimer) {
          clearTimeout(existingTimer);
        }
        const batchTimer = setTimeout(() => {
          const pending = this.pendingCharacteristicsLogs.get(deviceId) || [];
          if (pending.length > 0) {
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
            pending.forEach(log => {
              deviceCharLogs.set(log.serviceUuid, {
                timestamp: log.timestamp,
                characteristicCount: log.characteristicCount,
                addedCount: log.addedCount
              });
            });
            this.pendingCharacteristicsLogs.delete(deviceId);
          }
          this.characteristicsLogBatchTimers.delete(deviceId);
        }, this.characteristicsLogBatchWindow);
        this.characteristicsLogBatchTimers.set(deviceId, batchTimer);
      }
      this.scannedDevices.set(deviceId, device);
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
    let processedData = data;
    if (typeof data === 'string' && /^[0-9a-fA-F]+$/.test(data)) {
      const buffer = Buffer.from(data, 'hex');
      processedData = buffer.toString('base64');
    }
    const normalizedCharUuid = characteristicUuid.toLowerCase().replace(/-/g, '');
    const normalizedDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.toLowerCase().replace(/-/g, '');
    const normalizedBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.toLowerCase().replace(/-/g, '');
    const normalizedDataTransfer = BLE_CHARACTERISTICS.DATA_TRANSFER.toLowerCase().replace(/-/g, '');
    const normalizedSystemCommand = BLE_CHARACTERISTICS.SYSTEM_COMMAND.toLowerCase().replace(/-/g, '');
    const shortCharUuid = characteristicUuid.replace(/-/g, '').toLowerCase();
    const shortDeviceStatus = BLE_CHARACTERISTICS.DEVICE_STATUS.replace(/-/g, '').toLowerCase();
    const shortBatteryLevel = BLE_CHARACTERISTICS.BATTERY_LEVEL.replace(/-/g, '').toLowerCase();
    const shortDataTransfer = BLE_CHARACTERISTICS.DATA_TRANSFER.replace(/-/g, '').toLowerCase();
    const shortSystemCommand = BLE_CHARACTERISTICS.SYSTEM_COMMAND.replace(/-/g, '').toLowerCase();
    const shortFormCharUuid = normalizedCharUuid.length <= 4 ? normalizedCharUuid : normalizedCharUuid.slice(-4);
    if (normalizedCharUuid === normalizedDeviceStatus || shortCharUuid === shortDeviceStatus) {
      this.handleDeviceStatusUpdate(deviceId, processedData);
    } else if (normalizedCharUuid === normalizedBatteryLevel || shortCharUuid === shortBatteryLevel || shortFormCharUuid === '2a19') {
      this.handleBatteryUpdate(deviceId, processedData);
    } else if (normalizedCharUuid === normalizedDataTransfer || shortCharUuid === shortDataTransfer) {
      console.log(`📡 [DATA TRANSFER] Skipping CharacteristicData handler - using DataTransferEvent instead`);
    } else if (normalizedCharUuid === normalizedSystemCommand || shortCharUuid === shortSystemCommand) {
    } else {
    }
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

      // ✅ FIX: Deduplicate RSSI logs - only log once per rssiLogDedupeWindow (5s)
      const now = Date.now();
      const lastLogTime = this.lastRssiLogTime.get(deviceId) || 0;
      if (now - lastLogTime >= this.rssiLogDedupeWindow) {
        this.addConnectionLog(deviceId, 'RSSI Update', {
          rssi: eventData.rssi,
          previousRssi: previousRssi || null,
          platform: 'iOS'
        });
        this.lastRssiLogTime.set(deviceId, now);
      }

      this.emit('rssiUpdate', { deviceId, rssi: eventData.rssi });
    }
  }
  /**
   * Handle service discovery complete event
   * 
   * SIMPLIFIED (SDD v1.5): Native code now handles the entire flow automatically:
   * - Enable notifications → Read Device Status → Check RTC → Send SET_TIME if needed → Data Sync
   * 
   * JS only needs to:
   * - Log the discovery completion
   * - Emit events for UI updates (native handles notifications, RTC, data sync)
   * 
   * NO LONGER NEEDED (removed duplicates):
   * - startCommandSequence call (native does this automatically)
   * - RTC check logging (native sends RTCRead event)
   * - Time sync tracking (native handles this)
   */
  handleServiceDiscoveryComplete = async (eventData) => {
    const { deviceId, hasSystemCommand, hasDeviceStatus, hasDataTransfer, totalServices, totalCharacteristics } = eventData;

    // Log discovery completion
    this.addConnectionLog(deviceId, 'Service Discovery Complete', {
      totalServices: totalServices || 0,
      totalCharacteristics: totalCharacteristics || 0,
      hasSystemCommand: hasSystemCommand,
      hasDeviceStatus: hasDeviceStatus,
      hasDataTransfer: hasDataTransfer,
      platform: Platform.OS,
      note: 'Native handles: notifications → RTC check → SET_TIME → Data Sync'
    });
    // Native handles everything - will emit: RTCRead, NativeCommandSent, DataTransfer, SystemCommandResponse events
  }
  handleAndroidDeviceFound(deviceInfo) {
    const manufacturerInfo = deviceInfo.manufacturerData || {};
    // SDD v1.5: advertisement "Number of records available" can be up to 25,000; no cap here, native validates
    const formattedManufacturerData = {
      raw: manufacturerInfo,
      batteryLevel: manufacturerInfo.batteryLevel !== undefined ? manufacturerInfo.batteryLevel : null,
      batteryMillivolts: manufacturerInfo.batteryMillivolts !== undefined ? manufacturerInfo.batteryMillivolts : null,
      recordCount: manufacturerInfo.recordCount !== undefined ? manufacturerInfo.recordCount : 0,
      companyId: manufacturerInfo.companyId !== undefined ? manufacturerInfo.companyId : null,
      deviceStatus: manufacturerInfo.deviceStatus !== undefined ? manufacturerInfo.deviceStatus : 0,
      indication: manufacturerInfo.indication !== undefined ? manufacturerInfo.indication : 0,
      macId: manufacturerInfo.macId || null,
      version: manufacturerInfo.version !== undefined ? manufacturerInfo.version : null,
      connectIndication: manufacturerInfo.connectIndication,
      timeSet: manufacturerInfo.timeSet,
      factoryDefaults: manufacturerInfo.factoryDefaults,
      statusText: manufacturerInfo.deviceStatus === 0 ? 'Good' : 'Problem',
      hasRecords: (manufacturerInfo.recordCount || 0) > 0,
      batteryStatus: this.getBatteryStatus(manufacturerInfo.batteryLevel)
    };
    const device = {
      id: deviceInfo.deviceId,
      name: deviceInfo.deviceName || 'Unknown Device',
      rssi: deviceInfo.rssi || -100,
      isConnectable: deviceInfo.isConnectable !== false,
      manufacturerData: formattedManufacturerData,
      deviceData: {
        batteryLevel: null,
        temperature: null,
        steps: null,
        lastUpdate: new Date()
      },
      connectionState: CONNECTION_STATES.DISCONNECTED,
      isSmartTag: this.isSmartTag(deviceInfo),
      // Firmware v1.5: Store device state and optimized scan params
      deviceState: this.getDeviceState(formattedManufacturerData),
      optimizedScanParams: this.getOptimizedScanParams(formattedManufacturerData)
    };
    this.scannedDevices.set(device.id, device);
    this.emit('deviceFound', device);
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    } else {
    }
  }
  async refreshAndroidSystemConnectedDevices() {
    if (Platform.OS !== 'android' || !SampleBridgeAndroid?.refreshSystemConnectedDevices) {
      return;
    }
    if (this.isRefreshingSystemDevices) {
      console.log('⏭️ [SYSTEM_REFRESH] Already refreshing system devices, skipping duplicate call');
      return;
    }
    const now = Date.now();
    const timeSinceLastRefresh = now - this.lastSystemRefreshTime;
    if (timeSinceLastRefresh < 2000) {
      console.log(`⏭️ [SYSTEM_REFRESH] Throttling refresh (${timeSinceLastRefresh}ms since last call)`);
      return;
    }
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
        if (this.onDeviceListUpdated) {
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
      this.isRefreshingSystemDevices = false;
    }
  }
  handleAndroidConnectionStateChange(event) {
    const { deviceId, connectionState } = event;
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = connectionState;
      if (connectionState === CONNECTION_STATES.CONNECTED) {
        const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
          connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
        );
        if (currentlyConnectedDevices.length > 0) {
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
        this.healthCheckFailures.delete(deviceId);
      } else {
        this.connectedDevices.delete(deviceId);
      }
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
    }
  }
  handleAndroidCharacteristicData(event) {
    const { deviceId, characteristicUuid, data } = event;
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
      this.healthCheckFailures.delete(deviceId);

      // Notify UI so Signal no longer shows N/A (ModernBLEManager listens to rssiUpdated)
      this.emit('rssiUpdated', { deviceId, rssi });
      if (this.onDeviceListUpdated) this.onDeviceListUpdated();

      // ✅ FIX: Deduplicate RSSI logs - only log once per rssiLogDedupeWindow (5s)
      // This prevents duplicate logs from both native health checks and JS RSSI polling
      const now = Date.now();
      const lastLogTime = this.lastRssiLogTime.get(deviceId) || 0;
      if (now - lastLogTime >= this.rssiLogDedupeWindow) {
        this.addConnectionLog(deviceId, 'RSSI Update', {
          rssi: rssi,
          previousRssi: previousRssi || null,
          platform: 'Android'
        });
        this.lastRssiLogTime.set(deviceId, now);
      }
    }
  }
  handleAndroidScanStateChange(event) {
    const { isScanning } = event;
    this.scanState = isScanning ? SCAN_STATES.SCANNING : SCAN_STATES.IDLE;
  }
  handleAndroidDeviceDisconnected(event) {
    const { deviceId, deviceName, error, reason } = event;
    this.clearSyncStateOnDisconnect(deviceId);
    // On Android, handleAutoDisconnectedDevice returns early; update state here so UI shows disconnected (e.g. after DFU release)
    const device = this.scannedDevices.get(deviceId);
    const reasonText = reason || error || 'disconnected';
    if (device) {
      device.connectionState = CONNECTION_STATES.DISCONNECTED;
      device.disconnectedAt = new Date();
      device.lastSeen = Date.now();
      device.disconnectReason = reasonText;
      this.scannedDevices.set(deviceId, device);
    } else {
      this.scannedDevices.set(deviceId, {
        id: deviceId,
        name: deviceName || 'Unknown Device',
        connectionState: CONNECTION_STATES.DISCONNECTED,
        lastSeen: Date.now(),
        disconnectedAt: new Date(),
        disconnectReason: reasonText,
        deviceData: {}
      });
    }
    this.connectedDevices.delete(deviceId);
    this.stopMonitoring(deviceId);
    if (this.connectedDevices.size === 0) {
      this.stopConnectionHealthCheck();
    }
    const payload = this.scannedDevices.get(deviceId);
    this.emit('deviceDisconnected', {
      ...payload,
      id: deviceId,
      deviceId,
      reason: reasonText,
      error: error || reason
    });
    this.scheduleListUpdate();
    if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
      try {
        this.onDeviceListUpdated();
      } catch (e) {
        console.warn('onDeviceListUpdated error:', e?.message);
      }
    }
    this.handleAutoDisconnectedDevice({
      deviceId,
      deviceName: deviceName || 'Unknown Device',
      error: error || 'disconnected'
    });
  }
  handleAndroidDeviceReconnected(event) {
    const { deviceId, deviceName } = event;
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      device.connectionState = CONNECTION_STATES.CONNECTED;
      device.connectedAt = new Date();
      device.lastSeen = Date.now();
      this.scannedDevices.set(deviceId, device);
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      if (currentlyConnectedDevices.length > 0) {
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
      this.healthCheckFailures.delete(deviceId);
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
    }
  }
  handleAndroidDeviceConnected(event) {
    const { deviceId, deviceName, connectionType } = event;
    let device = this.scannedDevices.get(deviceId);
    if (!device) {
      // Restore / app reopen: device never scanned this session. Create minimal device so UI shows connected.
      device = {
        id: deviceId,
        name: deviceName || 'Unknown',
        connectionState: CONNECTION_STATES.CONNECTED,
        connectedAt: new Date(),
        lastSeen: Date.now(),
        connectionType: connectionType || 'restored',
        manufacturerData: { macId: null, batteryLevel: null, recordCount: 0, statusText: 'Unknown' }
      };
      this.scannedDevices.set(deviceId, device);
    }
    device.connectionState = CONNECTION_STATES.CONNECTED;
    device.connectedAt = new Date();
    device.lastSeen = Date.now();
    device.connectionType = device.connectionType || connectionType || 'manual';
    const debounceState = this.connectionStateDebounce.get(deviceId);
    if (debounceState) {
      debounceState.disconnectCount = 0;
      debounceState.isDebouncing = false;
      debounceState.blockedUntil = 0;
      this.connectionStateDebounce.set(deviceId, debounceState);
    }
    if (!device.manufacturerData) {
      device.manufacturerData = { macId: null, batteryLevel: null, recordCount: 0, statusText: 'Unknown' };
    }
    this.scannedDevices.set(deviceId, device);
    const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
      connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
    );
    if (currentlyConnectedDevices.length > 0) {
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
    const connectedNow = Date.now();
    const lastConnectedLog = this.lastConnectedLogs.get(deviceId);
    const shouldLogConnected = !lastConnectedLog || (connectedNow - lastConnectedLog.timestamp) > 1000;
    if (shouldLogConnected) {
      this.addConnectionLog(deviceId, 'Connected');
      this.lastConnectedLogs.set(deviceId, { timestamp: connectedNow });
    }
    setTimeout(async () => {
      try {
        await this.loadDeviceServices(deviceId);
        setTimeout(() => {
          this.startAdaptiveApiCalling(deviceId);
        }, 3000);
      } catch (error) {
      }
    }, 500);
    this.emit('deviceConnected', device);
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
  }
  async handleDeviceDataUpdated(event) {
    const deviceId = event?.deviceId;
    const {
      batteryLevel,
      steps,
      temperature,
      timestamp,
      recordCount,
      rtcValid,
      deviceRTC,
      batteryVoltage,
      dataSource,
      deviceData: eventDeviceData
    } = event || {};
    if (!deviceId) {
      console.warn(`⚠️ [EVENT] DeviceDataUpdated event missing deviceId`);
      return;
    }
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      console.warn(`⚠️ [EVENT] DeviceDataUpdated event for unknown device: ${deviceId}`);
      return;
    }
    const incomingDate = timestamp ? new Date(timestamp * 1000) : null;
    const isStaleData = incomingDate && incomingDate < new Date('2020-01-01');
    const hasSyncedData = device.deviceData?.dataSource === 'synced';
    if (isStaleData && hasSyncedData) {
      if (batteryLevel !== undefined) {
        device.deviceData.batteryLevel = batteryLevel;
        this.scannedDevices.set(deviceId, device);
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      }
      return;
    }
    const previousData = { ...device.deviceData };
    if (!device.deviceData) {
      device.deviceData = {
        batteryLevel: null,
        temperature: null,
        steps: null,
        lastUpdate: new Date()
      };
    }
    const timestampMs = timestamp ? (typeof timestamp === 'number' ? timestamp : timestamp * 1000) : null;
    const isLiveDataForDataSource = timestampMs && new Date(timestampMs).getTime() > 1577836800000;
    const batteryLevelToUse = batteryLevel !== undefined
      ? batteryLevel
      : (device.deviceData?.batteryLevel || null);
    const currentRecordCount = recordCount !== undefined ? recordCount : (eventDeviceData?.recordCount);
    let stepsToUse = steps !== undefined ? steps : device.deviceData.steps;
    let temperatureToUse = temperature !== undefined ? temperature : device.deviceData.temperature;
    if ((currentRecordCount === 0 || currentRecordCount === undefined) &&
      device.syncRecords && device.syncRecords.length > 0) {
      const latestRecord = this.getLatestSyncedRecord(deviceId);
      if (latestRecord) {
        const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r =>
          r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
        ) || latestRecord;
        const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r =>
          r.steps != null && r.steps !== undefined && r.steps > 0
        ) || latestRecord;
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
      dataSource: isLiveDataForDataSource ? 'live' : (device.deviceData?.dataSource || 'cached'),
      lastUpdate: device.deviceData.lastUpdate || new Date()
    };
    this.scannedDevices.set(deviceId, device);
    const dataChanged = previousData.steps !== device.deviceData.steps ||
      previousData.temperature !== device.deviceData.temperature ||
      previousData.batteryLevel !== device.deviceData.batteryLevel;
    if (dataChanged) {
    }
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
      if (!this.pendingUIUpdates) {
        this.pendingUIUpdates = new Map();
      }
      this.pendingUIUpdates.set(deviceId, device.deviceData);
    }
    const timestampValue = timestamp ? (typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime()) / 1000 : 0;
    const isLiveDataForBuffer = timestampValue > 1577836800;
    if (dataChanged && isLiveDataForBuffer) {
      this.addToLiveBuffer(deviceId, {
        timestamp: timestampValue,
        timestampDate: timestamp ? new Date(timestamp) : new Date(),
        steps: device.deviceData.steps,
        temperature: device.deviceData.temperature,
        batteryLevel: device.deviceData.batteryLevel
      });
      const alertSent = await this.checkImmediateAlert(deviceId, {
        temperature: device.deviceData.temperature,
        steps: device.deviceData.steps,
        batteryLevel: device.deviceData.batteryLevel,
        timestampDate: timestamp ? new Date(timestamp) : new Date()
      });
      if (this.shouldUploadBatch(deviceId)) {
        await this.uploadLiveBatch(deviceId);
      }
    } else if (!isLiveDataForBuffer) {
    }
    const eventRecordCount = recordCount !== undefined ? recordCount : (event?.deviceData?.recordCount);
    const eventRtcValid = rtcValid !== undefined ? rtcValid : (event?.deviceData?.rtcValid);
    if (eventRecordCount !== undefined || eventRtcValid !== undefined) {
      const parsedData = {
        recordCount: eventRecordCount !== undefined ? eventRecordCount : device.deviceData?.recordCount,
        rtcValid: eventRtcValid !== undefined ? eventRtcValid : (device.deviceData?.rtcValid ?? true),
        deviceRTC: deviceRTC || (timestamp ? Math.floor(timestamp / 1000) : undefined),
        dataSource: dataSource || device.deviceData?.dataSource
      };

      // ✅ OPTIMIZATION #4 (iOS): Filter redundant notifications - only process if data actually changed
      const lastDeviceStatus = this.lastDeviceStatus.get(deviceId);
      if (lastDeviceStatus && !options?.isManualRead) {
        const recordCountChanged = parsedData.recordCount !== lastDeviceStatus.recordCount;
        const batteryChanged = parsedData.batteryLevel !== undefined &&
          lastDeviceStatus.batteryLevel !== undefined &&
          Math.abs(parsedData.batteryLevel - lastDeviceStatus.batteryLevel) > 1; // 1% threshold
        const timestampChanged = parsedData.deviceRTC !== lastDeviceStatus.timestamp;

        // If no meaningful changes, skip processing (but always process first notification)
        if (!recordCountChanged && !batteryChanged && !timestampChanged) {
          console.log(`🔍 [DEVICE DATA UPDATED - iOS] Skipping redundant notification for ${deviceId} - no meaningful changes`);
          return; // Skip processing redundant notification
        }
      }

      // Update last Device Status for next comparison
      this.lastDeviceStatus.set(deviceId, {
        recordCount: parsedData.recordCount,
        batteryLevel: batteryLevel,
        timestamp: parsedData.deviceRTC
      });

      // ✅ OPTIMIZATION #3 (iOS): Aggregate notifications before processing
      // Check if record count increased or is single record (meaningful changes)
      const recordCountIncreased = (device.deviceData?.recordCount === undefined || device.deviceData?.recordCount === null)
        ? (parsedData.recordCount !== undefined && parsedData.recordCount > 0)
        : (parsedData.recordCount !== undefined && parsedData.recordCount > device.deviceData.recordCount);
      const isSingleRecord = parsedData.recordCount === 1;
      const shouldCheckSync = recordCountIncreased || isSingleRecord;

      if (shouldCheckSync) {
        // Use aggregation for iOS path as well
        this.aggregateDeviceStatusNotification(deviceId, device, parsedData, options);
      }
    }
  }
  async handleAndroidDeviceDataUpdateEvent(event) {
    const { deviceId, type, deviceData: eventDeviceData, batteryLevel, batteryVoltage, recordCount, timestamp, rtcValid, historySyncInProgress } = event;
    const device = this.scannedDevices.get(deviceId);
    if (!device) {
      return;
    }
    // Industry flow: during Phase 2 (history sync), ignore live data – do not mix with history sync
    if (type === 'live_data' && this.connectionPhase?.get(deviceId) === 'history_sync') {
      return;
    }
    if (!device.deviceData) {
      device.deviceData = {
        batteryLevel: null,
        temperature: null,
        steps: null,
        recordCount: null,
        lastUpdate: new Date()
      };
    }
    const isInitialDeviceStatus = type === 'device_status' &&
      rtcValid !== undefined &&
      device.deviceData.rtcValid === undefined;
    if (isInitialDeviceStatus) {
      const deviceTime = timestamp ? Math.floor(timestamp / 1000) : null;
      const systemTime = Math.floor(Date.now() / 1000);
      const timeDiff = deviceTime ? Math.abs(deviceTime - systemTime) : null;
      const isStaleRTC = deviceTime && deviceTime <= 1577836800;
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
      if (!rtcValid || isStaleRTC) {
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
    if (type === 'device_status') {
      const timestampMs = timestamp || (eventDeviceData?.lastUpdate);
      const isLiveData = rtcValid && timestampMs && new Date(timestampMs).getTime() > 1577836800000;
      let batteryLevelToUse = device.deviceData?.batteryLevel !== null && device.deviceData?.batteryLevel !== undefined
        ? device.deviceData.batteryLevel
        : null;
      if (batteryLevelToUse === null && batteryVoltage !== undefined && batteryVoltage !== null) {
        const BATTERY_MIN_MV = 0;
        const BATTERY_MAX_MV = 3000;
        if (batteryVoltage >= BATTERY_MIN_MV && batteryVoltage <= BATTERY_MAX_MV) {
          batteryLevelToUse = Math.round((batteryVoltage / BATTERY_MAX_MV) * 100);
        } else if (batteryVoltage > BATTERY_MAX_MV) {
          batteryLevelToUse = 100;
        } else if (batteryVoltage < BATTERY_MIN_MV) {
          batteryLevelToUse = 0;
        }
      }
      const freshRecordCount = recordCount !== undefined ? recordCount : (eventDeviceData?.recordCount);
      const finalRecordCount = freshRecordCount !== undefined ? freshRecordCount : device.deviceData?.recordCount;
      let preservedTemperature = device.deviceData.temperature;
      let preservedSteps = device.deviceData.steps;
      let preservedTotalSteps = device.deviceData.totalSteps;
      if ((freshRecordCount === 0 || freshRecordCount === undefined) &&
        device.syncRecords && device.syncRecords.length > 0) {
        const latestRecord = this.getLatestSyncedRecord(deviceId);
        if (latestRecord) {
          const latestRecordWithTemp = (device.syncRecords || []).slice().reverse().find(r =>
            r.temperature != null && r.temperature !== undefined && (r.temperature > 0 || (r.steps > 0 && r.temperature === 0))
          ) || latestRecord;
          const latestRecordWithSteps = (device.syncRecords || []).slice().reverse().find(r =>
            r.steps != null && r.steps !== undefined && r.steps > 0
          ) || latestRecord;
          if (latestRecordWithTemp.temperature != null && latestRecordWithTemp.temperature !== undefined) {
            preservedTemperature = latestRecordWithTemp.temperature;
            console.log(`💾 [DEVICE STATUS] Restored temperature from synced records: ${preservedTemperature}°C (was ${device.deviceData.temperature}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
          if (latestRecordWithSteps.steps != null && latestRecordWithSteps.steps !== undefined) {
            preservedSteps = latestRecordWithSteps.steps;
            console.log(`💾 [DEVICE STATUS] Restored steps from synced records: ${preservedSteps} (was ${device.deviceData.steps}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
          const calculatedTotalSteps = (device.syncRecords || []).reduce((sum, record) => {
            return sum + (record.steps || 0);
          }, 0);
          if (calculatedTotalSteps > 0) {
            preservedTotalSteps = calculatedTotalSteps;
            console.log(`💾 [DEVICE STATUS] Restored totalSteps from synced records: ${preservedTotalSteps} (was ${device.deviceData.totalSteps}) for ${deviceId} (recordCount: ${freshRecordCount})`);
          }
        }
      }
      device.deviceData = {
        ...device.deviceData,
        batteryLevel: batteryLevelToUse,
        batteryVoltage: batteryVoltage !== undefined ? batteryVoltage : (eventDeviceData?.batteryVoltage ?? device.deviceData.batteryVoltage),
        recordCount: finalRecordCount,
        temperature: preservedTemperature,
        steps: preservedSteps,
        totalSteps: preservedTotalSteps,
        dataSource: isLiveData ? 'live' : (device.deviceData?.dataSource || 'cached'),
        lastUpdate: timestampMs ? new Date(timestampMs) : (eventDeviceData?.lastUpdate ? new Date(eventDeviceData.lastUpdate) : device.deviceData.lastUpdate || new Date()),
        rtcValid: rtcValid !== undefined ? rtcValid : (eventDeviceData?.rtcValid ?? device.deviceData.rtcValid)
      };
      if (device.deviceData.recordCount !== undefined && device.manufacturerData) {
        device.manufacturerData.recordCount = device.deviceData.recordCount;
        device.manufacturerData.hasRecords = device.deviceData.recordCount > 0;
      }

      // ✅ OPTIMIZATION #2 (Android): Only check sync on meaningful changes
      const previousRecordCount = previousData?.recordCount;
      const recordCountIncreased = (previousRecordCount === undefined || previousRecordCount === null)
        ? (device.deviceData.recordCount !== undefined && device.deviceData.recordCount > 0)
        : (device.deviceData.recordCount !== undefined && device.deviceData.recordCount > previousRecordCount);
      const isSingleRecord = device.deviceData.recordCount === 1;
      const shouldCheckSync = recordCountIncreased || isSingleRecord;

      if (shouldCheckSync) {
        // ✅ OPTIMIZATION #3 (Android): Use aggregation for Android path as well; pass historySyncInProgress so Phase 2 never re-triggers sync
        this.aggregateDeviceStatusNotification(deviceId, device, {
          recordCount: device.deviceData.recordCount,
          rtcValid: device.deviceData.rtcValid ?? rtcValid,
          deviceRTC: timestampMs ? Math.floor(timestampMs / 1000) : undefined
        }, { historySyncInProgress: historySyncInProgress === true });
      }
    } else if (type === 'live_data') {
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

      // ✅ Connection log: Live data received (Android native `live_data` event)
      // Use existing dedupe window so logs don't spam.
      try {
        const now = Date.now();
        const lastLog = this.lastLiveDataLogTime?.get(deviceId);
        const recordTs = timestampMs ? Math.floor(new Date(timestampMs).getTime() / 1000) : 0;
        const shouldLog = !lastLog ||
          (now - lastLog.time) >= this.liveDataLogDedupeWindow ||
          lastLog.recordTimestamp !== recordTs;
        if (shouldLog) {
          if (!this.lastLiveDataLogTime) this.lastLiveDataLogTime = new Map();
          this.lastLiveDataLogTime.set(deviceId, { time: now, recordTimestamp: recordTs });
          this.addConnectionLog(deviceId, 'Live Data Received', {
            temperature: device.deviceData.temperature,
            steps: device.deviceData.steps,
            recordTimestamp: recordTs || undefined,
            recordTimestampDate: recordTs ? new Date(recordTs * 1000).toISOString() : undefined,
            source: 'notification',
            platform: 'Android'
          });
        }
      } catch (e) { }
    } else if (type === 'sync_records') {
      const recordsReceived = event.recordsReceived || 0;
      const totalReceived = event.totalReceived || 0;
      // When native sends totalExpected=0 (e.g. after force-complete/retry), use last known so we never show "X/0"
      const rawExpected = event.totalExpected ?? device.deviceData?.syncProgress?.totalExpected ?? 0;
      const totalExpectedToUse = rawExpected > 0
        ? rawExpected
        : (this.lastKnownSyncTotalExpected.get(deviceId) || 0);
      if (rawExpected > 0) {
        this.lastKnownSyncTotalExpected.set(deviceId, rawExpected);
      }
      const remainingRecords = Math.max(0, totalExpectedToUse - totalReceived);
      device.deviceData = {
        ...device.deviceData,
        recordCount: remainingRecords,
        syncProgress: {
          totalReceived,
          totalExpected: totalExpectedToUse,
          recordsReceived
        }
      };
      if (device.manufacturerData) {
        device.manufacturerData.recordCount = remainingRecords;
        device.manufacturerData.hasRecords = remainingRecords > 0;
      }
    } else if (type === 'sync_complete') {
      const syncSuccess = event.success !== false;
      // Use total synced from native (recordCount/recordsTransmitted/totalRecords), not 0 for "remaining on device"
      const finalRecordCount = syncSuccess
        ? (event.recordCount ?? event.recordsTransmitted ?? event.totalRecords ?? event.deviceData?.recordCount ?? 0)
        : (event.recordCount !== undefined ? event.recordCount : 0);
      if (!this.autoSyncMeta) {
        this.autoSyncMeta = new Map();
      }
      const meta = this.autoSyncMeta.get(deviceId) || {};
      meta.lastSyncCompletedAt = Date.now();
      meta.syncCompletedRecordCount = finalRecordCount;
      this.autoSyncMeta.set(deviceId, meta);
      const preservedTemperature = device.deviceData.temperature;
      const preservedSteps = device.deviceData.steps;
      const preservedTotalSteps = device.deviceData.totalSteps;
      const preservedBatteryLevel = device.deviceData.batteryLevel;
      device.deviceData = {
        ...device.deviceData,
        recordCount: finalRecordCount,
        syncedAt: new Date(),
        temperature: preservedTemperature,
        steps: preservedSteps,
        totalSteps: preservedTotalSteps,
        batteryLevel: eventDeviceData?.batteryLevel ?? preservedBatteryLevel,
      };
      if (device.manufacturerData) {
        device.manufacturerData.recordCount = finalRecordCount;
        device.manufacturerData.hasRecords = finalRecordCount > 0;
      }
      if (device.deviceData.syncProgress) {
        delete device.deviceData.syncProgress;
      }

      // ✅ Connection log parity with iOS: log sync complete + "X Records Synced"
      // Android native sometimes emits `deviceDataUpdate(sync_complete)` without a matching `DataTransfer(sync_complete)`,
      // so we log here too (deduped by lastSyncCompleteTime window).
      try {
        if (!this.lastSyncCompleteTime) this.lastSyncCompleteTime = new Map();
        const lastCompleteTime = this.lastSyncCompleteTime.get(deviceId) || 0;
        const timeSinceLastComplete = Date.now() - lastCompleteTime;
        if (timeSinceLastComplete >= 1000) {
          this.lastSyncCompleteTime.set(deviceId, Date.now());

          this.addConnectionLog(deviceId, 'Data Sync: Sync Complete', {
            success: syncSuccess,
            recordsTransmitted: event.recordsTransmitted ?? event.totalRecords ?? undefined,
            recordCount: finalRecordCount,
            source: 'android_deviceDataUpdate'
          });

          const recordsBeforeSync = device?.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
          const recordsAfterSync = device?.syncRecords?.length || 0;
          const actualNewRecords = Math.max(0, recordsAfterSync - recordsBeforeSync);
          const receivedFromDevice = event.recordsTransmitted ?? event.totalRecords ?? finalRecordCount ?? 0;
          if (actualNewRecords > 0) {
            const now = Date.now();
            const lastLog = this.lastRecordSyncedLogs?.get(deviceId);
            const shouldLog = !lastLog ||
              (now - lastLog.timestamp) > 500 ||
              lastLog.recordCount !== actualNewRecords;
            if (shouldLog) {
              const deduplicated = Math.max(0, (receivedFromDevice || actualNewRecords) - actualNewRecords);
              if (deduplicated > 0 && receivedFromDevice > 0) {
                this.addConnectionLog(deviceId, `${receivedFromDevice} received, ${actualNewRecords} new unique (${deduplicated} duplicates skipped)`);
              } else {
                this.addConnectionLog(deviceId, `${actualNewRecords} Record${actualNewRecords === 1 ? '' : 's'} Synced`);
              }
              if (!this.lastRecordSyncedLogs) this.lastRecordSyncedLogs = new Map();
              this.lastRecordSyncedLogs.set(deviceId, { timestamp: now, recordCount: actualNewRecords });
            }
            // Advance baseline so subsequent syncs compute delta correctly
            device.syncRecordsBeforeSync = recordsAfterSync;
          }

          // If we were in history sync phase, flip to live like iOS flow does (idempotent: only log once)
          if (!this.connectionPhase) this.connectionPhase = new Map();
          if (this.connectionPhase.get(deviceId) === 'history_sync') {
            this.connectionPhase.set(deviceId, 'live');
            const meta2 = this.autoSyncMeta.get(deviceId) || {};
            meta2.liveMode = true;
            this.autoSyncMeta.set(deviceId, meta2);
            this.addConnectionLog(deviceId, 'Phase 3: LIVE MODE – history sync complete', {
              totalSynced: device?.syncRecords?.length,
              lastRecordTimestamp: meta2.lastRecordTimestamp,
              lastRecordCount: meta2.lastRecordCount,
              platform: 'Android'
            });
          }
        }
      } catch (e) { }
    }
    this.scannedDevices.set(deviceId, device);
    const dataChanged = previousData.batteryLevel !== device.deviceData.batteryLevel ||
      previousData.recordCount !== device.deviceData.recordCount ||
      previousData.steps !== device.deviceData.steps ||
      previousData.temperature !== device.deviceData.temperature;
    if (dataChanged) {
    }
    if (this.onDeviceListUpdated && dataChanged) {
      this.onDeviceListUpdated();
    }
    // Throttle sync_records UI updates: emit at most every 200ms or every 25 records to prevent hang during large sync
    let allowSyncProgressEmit = true;
    if (type === 'sync_records') {
      const totalReceived = device.deviceData?.syncProgress?.totalReceived ?? (event.totalReceived || 0);
      const last = this.lastSyncProgressEvents?.get(deviceId) || { totalReceived: -1, timestamp: 0 };
      const recordsDelta = totalReceived - (last.totalReceived ?? 0);
      const timeDelta = Date.now() - (last.timestamp || 0);
      allowSyncProgressEmit = recordsDelta >= (this.syncProgressThrottleRecords ?? 25) ||
        timeDelta >= (this.syncProgressThrottleMs ?? 200) ||
        last.totalReceived === undefined;
      if (allowSyncProgressEmit) {
        if (!this.lastSyncProgressEvents) this.lastSyncProgressEvents = new Map();
        this.lastSyncProgressEvents.set(deviceId, { totalReceived, timestamp: Date.now() });
      }
    }
    if (type === 'sync_complete') {
      this.lastSyncProgressEvents?.delete(deviceId);
    }
    const shouldTriggerCallback = ((type === 'sync_records' && allowSyncProgressEmit) || type === 'sync_complete') || dataChanged;
    if (shouldTriggerCallback) {
      if (this.onDeviceDataUpdated && this.appState === 'active') {
        this.onDeviceDataUpdated(deviceId, device.deviceData);
      } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
        if (!this.pendingUIUpdates) {
          this.pendingUIUpdates = new Map();
        }
        this.pendingUIUpdates.set(deviceId, device.deviceData);
      }
    }
    const shouldEmit = ((type === 'sync_records' && allowSyncProgressEmit) || type === 'sync_complete') || (dataChanged && (type === 'live_data' || type === 'device_status'));
    if (shouldEmit) {
      const emitData = {
        deviceId,
        type: type,
        deviceData: device.deviceData,
        ...(type === 'live_data' && {
          steps: device.deviceData.steps,
          temperature: device.deviceData.temperature,
        }),
        ...(type === 'device_status' && {
          recordCount: device.deviceData.recordCount,
          batteryLevel: device.deviceData.batteryLevel,
          syncJustCompleted: (() => {
            if (!this.autoSyncMeta) return false;
            const meta = this.autoSyncMeta.get(deviceId);
            if (!meta || !meta.lastSyncCompletedAt) return false;
            const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
            return timeSinceSync < 15000;
          })(),
          syncCompletedRecordCount: (() => {
            if (!this.autoSyncMeta) return undefined;
            const meta = this.autoSyncMeta.get(deviceId);
            return meta?.syncCompletedRecordCount;
          })()
        }),
        ...(type === 'sync_records' && {
          recordsReceived: event.recordsReceived || 0,
          totalReceived: device.deviceData?.syncProgress?.totalReceived ?? (event.totalReceived || 0),
          totalExpected: device.deviceData?.syncProgress?.totalExpected ?? (event.totalExpected || 0),
        }),
        ...(type === 'sync_complete' && {
          recordCount: device.deviceData.recordCount,
          recordsTransmitted: event.recordsTransmitted || 0,
          totalRecords: event.totalRecords || 0,
          totalSteps: device.deviceData.totalSteps,
          steps: device.deviceData.steps,
          temperature: device.deviceData.temperature,
          syncJustCompleted: (() => {
            if (!this.autoSyncMeta) return false;
            const meta = this.autoSyncMeta.get(deviceId);
            if (!meta || !meta.lastSyncCompletedAt) return false;
            const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
            return timeSinceSync < 15000;
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
    const { deviceId, services, characteristics, deviceName } = event;
    let device = this.scannedDevices.get(deviceId);
    if (!device) {
      // Restore / app reopen: no scan this session. Create minimal device so UI shows connected when ServicesDiscovered arrives first.
      device = {
        id: deviceId,
        name: deviceName || 'Unknown',
        connectionState: CONNECTION_STATES.CONNECTED,
        connectedAt: new Date(),
        lastSeen: Date.now(),
        connectionType: 'restored',
        manufacturerData: { macId: null, batteryLevel: null, recordCount: 0, statusText: 'Unknown' }
      };
      this.scannedDevices.set(deviceId, device);
    }
    // Services discovered is only sent after GATT connection; ensure JS state matches so UI shows device (handles event order: services-discovered can arrive before DeviceConnected on app reopen)
    device.connectionState = CONNECTION_STATES.CONNECTED;
    const wasNotInConnectedDevices = !this.connectedDevices.has(deviceId);
    if (wasNotInConnectedDevices) {
      this.connectedDevices.set(deviceId, device);
    }
    device.services = services || [];
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
    const now = Date.now();
    const lastLog = this.lastServiceDiscoveryLog.get(deviceId);
    const serviceCount = services ? services.length : 0;
    const shouldLog = !lastLog ||
      (now - lastLog.timestamp) > this.discoveryLogDedupeWindow ||
      lastLog.serviceCount !== serviceCount ||
      lastLog.characteristicCount !== allCharacteristics.length;
    if (shouldLog) {
      const serviceNames = services ? services.map(s => {
        const serviceType = this.getServiceType(s.uuid);
        return serviceType.replace('_SERVICE', '').replace(/_/g, ' ').toLowerCase()
          .replace(/\b\w/g, l => l.toUpperCase());
      }) : [];
      const serviceUuids = services ? services.map(s => s.uuid) : [];
      const characteristicUuids = allCharacteristics.map(c => c.uuid);
      const serviceList = serviceNames.join(', ');
      const logMessage = serviceNames.length > 0
        ? `Services Discovered (${serviceList})`
        : 'Services Discovered';
      this.addConnectionLog(deviceId, logMessage, {
        serviceCount: serviceCount,
        addedCount: serviceCount,
        serviceNames: serviceNames,
        serviceUuids: serviceUuids,
        characteristicCount: allCharacteristics.length,
        characteristicUuids: characteristicUuids,
        platform: 'Android'
      });
      this.lastServiceDiscoveryLog.set(deviceId, {
        timestamp: now,
        serviceCount: serviceCount,
        characteristicCount: allCharacteristics.length
      });
    }
    this.scannedDevices.set(deviceId, device);
    this.startMonitoring(deviceId);
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
    // Decide (history_sync vs live) is driven by native device status → handleDeviceStatusUpdate → maybeTriggerAutoSyncFromDeviceStatus. No JS-side decide trigger here.
  }
  setLowPowerMode(enabled) {
    this.profile = (enabled ? POWER_PROFILE?.lowPower : POWER_PROFILE?.default) || this.profile;
    if (this.connectedDevices.size > 0) {
      this.stopConnectionHealthCheck();
      this.startConnectionHealthCheck();
    }
  }
  setPowerProfile(profileName) {
    const profile = POWER_PROFILE[profileName];
    if (!profile) {
      return;
    }
    const oldProfile = this.getCurrentProfileName();
    this.profile = profile;
    this.updateApiTimingForPowerProfile();
    if (this.connectedDevices.size > 0) {
      this.stopConnectionHealthCheck();
      this.startConnectionHealthCheck();
    }
    // RSSI monitoring handled by native health checks - power profile change handled natively
    this.emit('powerProfileChanged', {
      oldProfile,
      newProfile: profileName,
      timestamp: Date.now()
    });
  }
  // ============================================================================
  // RSSI MONITORING - NATIVE SIDE ONLY
  // ============================================================================
  // RSSI monitoring is now handled entirely by native code (Android/iOS health checks)
  // JS receives RSSI updates via native events (RSSIUpdate/RSSIUpdated)
  // This eliminates duplicate RSSI reads and reduces JS-to-native bridge calls
  // ============================================================================

  startRssiCycle() {
    // DISABLED: RSSI monitoring is now handled by native health checks only
    // Native Android: performHealthChecks() calls gatt.readRemoteRssi()
    // Native iOS: performHealthChecks() calls peripheral.readRSSI()
    // JS receives updates via RSSIUpdate event handlers
    console.log('📶 [RSSI] Native-side RSSI monitoring is active (JS polling disabled)');
  }

  stopRssiCycle() {
    // DISABLED: No JS-side RSSI cycle to stop
    // Native handles RSSI monitoring via health checks
  }

  restartRssiCycle() {
    // DISABLED: No JS-side RSSI cycle to restart
    // Native handles RSSI monitoring via health checks
  }

  async performRssiCycle() {
    // DISABLED: RSSI monitoring moved to native side only
    // This prevents duplicate RSSI reads that were causing log spam
  }
  async measureDeviceRssi(deviceId) {
    try {
      const device = this.connectedDevices.get(deviceId);
      if (!device) {
        return;
      }
      let rssi;
      if (Platform.OS === 'android') {
        try {
          const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          rssi = result;
        } catch (error) {
          return { success: false, error: 'SMART_TAG service not available' };
        }
      } else {
        try {
          const result = await BridgingCodeModule.readRSSI(deviceId);
          rssi = typeof result === 'object' && result.rssi !== undefined ? result.rssi : result;
        } catch (error) {
          return { success: false, error: 'SMART_TAG service not available' };
        }
      }
      if (rssi !== null && rssi !== undefined) {
        this.rssiValues.set(deviceId, rssi);
        const scannedDevice = this.scannedDevices.get(deviceId);
        if (scannedDevice) {
          scannedDevice.rssi = rssi;
        }
        if (!this.rssiHistory.has(deviceId)) {
          this.rssiHistory.set(deviceId, []);
        }
        const history = this.rssiHistory.get(deviceId);
        history.push({
          value: rssi,
          timestamp: Date.now()
        });
        if (history.length > 20) {
          history.shift();
        }
        this.lastRssiUpdate.set(deviceId, Date.now());
        this.healthCheckFailures.delete(deviceId);
        this.emit('rssiUpdated', {
          deviceId,
          rssi,
          timestamp: Date.now()
        });
        this.checkRssiConnectionQuality(deviceId, rssi);
      } else {
      }
    } catch (error) {
    }
  }
  checkRssiConnectionQuality(deviceId, rssi) {
    const thresholds = {
      excellent: -50,
      good: -70,
      fair: -80,
      poor: -90,
      veryPoor: -100
    };
    let quality = 'unknown';
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
    const connectedDevice = this.connectedDevices.get(deviceId);
    if (connectedDevice) {
      connectedDevice.connectionQuality = quality;
      connectedDevice.lastRssi = rssi;
      connectedDevice.lastRssiUpdate = Date.now();
    }
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice) {
      scannedDevice.connectionQuality = quality;
      scannedDevice.lastRssi = rssi;
      scannedDevice.lastRssiUpdate = Date.now();
    }
    switch (quality) {
      case 'excellent':
      case 'good':
        break;
      case 'fair':
        break;
      case 'poor':
        this.emit('rssiPoorConnection', { deviceId, rssi, quality });
        break;
      case 'veryPoor':
      case 'critical':
        this.emit('rssiCriticalConnection', { deviceId, rssi, quality });
        if (quality === 'critical' && rssi < -120) {
          this.disconnectFromDevice(deviceId);
        } else if (quality === 'critical') {
        }
        break;
    }
    this.emit('connectionQualityChanged', {
      deviceId,
      rssi,
      quality,
      timestamp: Date.now()
    });
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }
  }
  getDeviceRssi(deviceId) {
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice?.rssi !== null && scannedDevice?.rssi !== undefined) {
      return scannedDevice.rssi;
    }
    return this.rssiValues.get(deviceId);
  }
  getDeviceRssiHistory(deviceId) {
    return this.rssiHistory.get(deviceId) || [];
  }
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
  getDeviceConnectionQuality(deviceId) {
    const scannedDevice = this.scannedDevices.get(deviceId);
    if (scannedDevice?.connectionQuality) {
      return scannedDevice.connectionQuality;
    }
    const connectedDevice = this.connectedDevices.get(deviceId);
    return connectedDevice?.connectionQuality || 'unknown';
  }
  isRssiCycleActive() {
    // RSSI monitoring is now always active via native health checks
    return true;
  }
  canForgetDevice(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device) return false;
    if (device.connectionState === CONNECTION_STATES.CONNECTING) {
      return false;
    }
    return true;
  }
  getRssiCycleStatus() {
    // RSSI monitoring now handled by native side
    return {
      active: true, // Always active via native health checks
      source: 'native', // Indicates native-side monitoring
      interval: this.profile.healthCheckMs || 30000, // Health check interval
      deviceCount: this.connectedDevices.size,
      lastUpdate: this.lastRssiUpdate
    };
  }
  async triggerManualRssiMeasurement() {
    if (this.connectedDevices.size === 0) {
      return { success: false, message: 'No connected devices' };
    }
    // Manual measurement still works by calling native directly
    try {
      const deviceIds = Array.from(this.connectedDevices.keys());
      const results = await Promise.allSettled(
        deviceIds.map(deviceId => this.measureDeviceRssi(deviceId))
      );
      return { success: true, message: 'Manual RSSI measurement completed', deviceCount: deviceIds.length };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  handleRestoredState(restoredState) {
    try {
      if (!restoredState) {
        return;
      }
      const restoredDevices = restoredState.connectedPeripherals || restoredState.peripherals || [];
      restoredDevices.forEach((device) => {
        try {
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
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      if (currentlyConnectedDevices.length > 0) {
        currentlyConnectedDevices.forEach(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
            console.log(`   ✅ Disconnected other device: ${otherDeviceId}`);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          }
        });
      }
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
      try {
        const initialRssi = await deviceHandle.readRSSI();
        if (initialRssi !== null && initialRssi !== undefined) {
          this.checkRssiConnectionQuality(deviceId, initialRssi);
        }
      } catch (rssiError) {
      }
      this.stopMonitoring(deviceId);
      try {
        await deviceHandle.discoverAllServicesAndCharacteristics();
      } catch (e) {
      }
      try {
        await this.loadDeviceServices(deviceId);
      } catch { }
      this.startRSSIPolling(deviceId);
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
  async requestPermissions() {
    try {
      if (Platform.OS === 'android') {
        const result = await SampleBridgeAndroid.requestPermissions();
        return result.granted || false;
      } else {
        const result = await BridgingCodeModule.requestPermissions();
        return result.status === 'granted';
      }
    } catch (error) {
      return false;
    }
  }
  getBLEState() {
    return this.bleState;
  }
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
      const result = await BridgingCodeModule.isBLEReady();
      this.bleState = result.isReady ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF;
      return this.bleState;
    }
  }
  async isBLEReady() {
    if (Platform.OS === 'android') {
      const result = await SampleBridgeAndroid.isBLEReady();
      return result.ready || false;
    } else {
      const result = await BridgingCodeModule.isBLEReady();
      return result.isReady || false;
    }
  }
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
      const preservedDevices = new Map();
      const now = Date.now();
      const fiveMinutesAgo = now - (5 * 60 * 1000);
      for (const [existingDeviceId, existingDevice] of this.scannedDevices.entries()) {
        const shouldPreserve =
          existingDevice.connectionState === CONNECTION_STATES.CONNECTED ||
          (existingDevice.connectionState === CONNECTION_STATES.DISCONNECTED &&
            existingDevice.lastSeen && existingDevice.lastSeen > fiveMinutesAgo);
        if (shouldPreserve) {
          preservedDevices.set(existingDeviceId, existingDevice);
        }
      }
      const originalDevices = new Map(this.scannedDevices);
      preservedDevices.forEach((device, id) => {
        const lastSeenTime = device.lastSeen ? new Date(device.lastSeen).toLocaleTimeString() : 'Never';
      });
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
      this.scannedDevices = preservedDevices;
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
      const scanOptions = {
        maxScanDurationMs: maxDuration || this.profile.maxScanDurationMs || 15000,
        scanMode: this.profile.scanMode || 'LowLatency',
        allowDuplicates: true,
        useTargetedScan: false // Scan all devices like Android, filter in didDiscover callback
      };
      if (Platform.OS === 'android') {
        if (SampleBridgeAndroid.startScanningWithOptions) {
          await SampleBridgeAndroid.startScanningWithOptions(scanOptions);
        } else {
          await SampleBridgeAndroid.startScanning();
        }
        this.scanSubscription = { remove: () => { } };
      } else {
        if (BridgingCodeModule.startScanningWithOptions) {
          await BridgingCodeModule.startScanningWithOptions(scanOptions);
        } else {
          await BridgingCodeModule.startScanning();
        }
        this.scanSubscription = { remove: () => { } };
      }
    } catch (error) {
      this.scanState = SCAN_STATES.STOPPED;
      if (onError) onError(error);
    }
  }
  stopScanning() {
    if (Platform.OS === 'android') {
      SampleBridgeAndroid.stopScanning().catch(error => {
      });
    } else {
      BridgingCodeModule.stopScanning().catch(error => {
      });
    }
    this.scanState = SCAN_STATES.STOPPED;
  }
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
  startPruning() {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      try {
        const cutoff = Date.now() - (this.profile.pruneAgeMs || 600000);
        let deleted = false;
        for (const [id, dev] of this.scannedDevices.entries()) {
          const isConnected = dev.connectionState === CONNECTION_STATES.CONNECTED;
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
  isSmartTag(device) {
    if (device.serviceUUIDs && device.serviceUUIDs.includes(BLE_SERVICES.SMART_TAG)) {
      return true;
    }
    const name = device.name?.toLowerCase() || '';
    return name.includes('smart') || name.includes('tag') || name.includes('pet');
  }
  async readNearbyTagLocation(deviceId) {
    try {
      if (Platform.OS === 'ios') {
        return null;
      } else {
        return null;
      }
    } catch (error) {
      return null;
    }
  }
  parseLocationData(base64Data) {
    try {
      if (!base64Data) return null;
      const buffer = Buffer.from(base64Data, 'base64');
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
  async sendLocationToServer(deviceId, locationData) {
    try {
      return { success: true, message: 'Location data sent to server' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async handleNearbyTag(deviceId, deviceName) {
    try {
      const locationData = await this.readNearbyTagLocation(deviceId);
      if (locationData) {
        const nearbyTag = {
          id: deviceId,
          name: deviceName,
          type: 'nearby_tag',
          location: locationData,
          lastSeen: Date.now(),
          isVerified: false
        };
        if (!this.nearbyTags) this.nearbyTags = new Map();
        this.nearbyTags.set(deviceId, nearbyTag);
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      } else {
      }
    } catch (error) {
    }
  }
  getNearbyTags() {
    if (!this.nearbyTags) return [];
    return Array.from(this.nearbyTags.values());
  }
  setCurrentUserId(userId) {
    this.currentUserId = userId;
  }
  getCurrentUserId() {
    return this.currentUserId;
  }
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
  getConnectedDevices() {
    const connectedDevicesList = [];
    for (const [deviceId, connectedDevice] of this.connectedDevices) {
      let deviceInfo = this.scannedDevices.get(deviceId);
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
        deviceInfo = {
          ...deviceInfo,
          connectionState: CONNECTION_STATES.CONNECTED,
          deviceData: this.deviceDataStore.get(deviceId) || deviceInfo.deviceData || {}
        };
      }
      connectedDevicesList.push(deviceInfo);
    }
    for (const [deviceId, deviceInfo] of this.scannedDevices) {
      if (deviceInfo.connectionState === CONNECTION_STATES.CONNECTED &&
        !connectedDevicesList.find(d => d.id === deviceId)) {
        const enhancedDeviceInfo = {
          ...deviceInfo,
          deviceData: this.deviceDataStore.get(deviceId) || deviceInfo.deviceData || {}
        };
        connectedDevicesList.push(enhancedDeviceInfo);
      }
    }
    return connectedDevicesList;
  }
  async connectToDevice(deviceId, onConnectionStateChange) {
    try {
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        throw new Error('Device not found in scanned devices');
      }
      this.addConnectionLog(deviceId, 'Trying to connect', {
        deviceName: device.name || 'Unknown',
        connectionType: 'manual',
        platform: Platform.OS
      });
      this.pendingManualConnects.set(deviceId, Date.now());
      const cooldownTime = this.manualDisconnectCooldown.get(deviceId);
      if (cooldownTime) {
        const timeSinceCooldown = Date.now() - cooldownTime;
        const cooldownDuration = 10000;
        if (timeSinceCooldown < cooldownDuration) {
          const remainingTime = Math.ceil((cooldownDuration - timeSinceCooldown) / 1000);
          const errorMessage = `Device is in cooldown after disconnect. Please wait ${remainingTime} seconds before reconnecting.`;
          console.warn(`⏳ [CONNECTION] ${errorMessage}`);
          throw new Error(errorMessage);
        } else {
          this.manualDisconnectCooldown.delete(deviceId);
        }
      }
      try {
        const forgottenResult = Platform.OS === 'ios'
          ? await AutoConnectService.getForgottenDevices()
          : await SampleBridgeAndroid.getForgottenDevices();
        const devices = forgottenResult?.devices ?? forgottenResult?.forgottenDevices ?? [];
        if (Array.isArray(devices) && devices.includes(deviceId)) {
        }
      } catch (error) {
        console.warn('⚠️ [CONNECTION] Could not check forgotten devices list:', error);
      }
      const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
        connectedId => connectedId !== deviceId && this.isDeviceConnected(connectedId)
      );
      if (currentlyConnectedDevices.length > 0) {
        const disconnectPromises = currentlyConnectedDevices.map(async (otherDeviceId) => {
          try {
            await this.disconnectFromDevice(otherDeviceId);
          } catch (error) {
            console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
          }
        });
        try {
          await Promise.race([
            Promise.all(disconnectPromises),
            new Promise((resolve) => setTimeout(resolve, 5000))
          ]);
        } catch (error) {
          console.warn(`⚠️ [CONNECTION] Error during disconnect of other devices:`, error.message);
        }
      }
      device.connectionState = CONNECTION_STATES.CONNECTING;
      this.scannedDevices.set(deviceId, device);
      this.addConnectionLog(deviceId, 'Connecting', {
        deviceName: device.name || 'Unknown',
        connectionType: 'manual',
        platform: Platform.OS
      });
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTING);
      }
      this.markDeviceKnown(deviceId);
      this.stopScanning();
      const connectionAcquired = await this.acquireConnection(deviceId, 'high');
      if (!connectionAcquired) {
        await new Promise(resolve => {
          const checkPool = setInterval(() => {
            if (this.acquireConnection(deviceId, 'high')) {
              clearInterval(checkPool);
              resolve();
            }
          }, 1000);
        });
      }
      let connectedDevice;
      if (Platform.OS === 'android') {
        const result = await SampleBridgeAndroid.connectToDevice(deviceId);
        if (result?.status === 'already_connecting') {
          device.connectionState = CONNECTION_STATES.CONNECTING;
          this.scannedDevices.set(deviceId, device);
          if (onConnectionStateChange) {
            onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTING);
          }
          if (this.onDeviceListUpdated) this.onDeviceListUpdated();
          return { id: deviceId, status: 'already_connecting' };
        }
        connectedDevice = { id: deviceId };
        // Update UI immediately so connect button stops loading and shows connected
        device.connectionState = CONNECTION_STATES.CONNECTED;
        this.connectedDevices.set(deviceId, connectedDevice);
        this.scannedDevices.set(deviceId, device);
        if (onConnectionStateChange) {
          onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTED);
        }
        if (this.onDeviceListUpdated) {
          this.onDeviceListUpdated();
        }
      } else {
        try {
          // Firmware v1.5: Use optimized connection parameters (320ms interval, latency 2, timeout 500s)
          const optimizedParams = this.getOptimizedConnectionParams();
          const connectionOptions = {
            connectionIntervalMs: optimizedParams.connectionIntervalMs,
            supervisionTimeoutMs: optimizedParams.supervisionTimeoutMs,
            connectionLatency: optimizedParams.connectionLatency,
            isManualConnection: true
          };
          const result = await BridgingCodeModule.connectToDeviceWithOptions(deviceId, connectionOptions);
        } catch (error) {
          const fallbackOptions = { isManualConnection: true };
          const result = await BridgingCodeModule.connectToDeviceWithOptions(deviceId, fallbackOptions);
        }
        connectedDevice = { id: deviceId };
      }
      const mtuSize = this.profile.mtuSize || 512;
      await this.negotiateMTU(deviceId, mtuSize);
      device.connectionState = CONNECTION_STATES.CONNECTED;
      this.connectedDevices.set(deviceId, connectedDevice);
      this.scannedDevices.set(deviceId, device);
      try {
        let initialRssi;
        if (Platform.OS === 'android') {
          const result = await SampleBridgeAndroid.readDeviceRSSI(deviceId);
          initialRssi = result.rssi;
        } else {
          const result = await BridgingCodeModule.readRSSI(deviceId);
          initialRssi = result.rssi;
        }
        if (initialRssi !== null && initialRssi !== undefined) {
          const rssiValue = typeof initialRssi === 'object' ? initialRssi.rssi : initialRssi;
          if (rssiValue !== null && rssiValue !== undefined) {
            this.checkRssiConnectionQuality(deviceId, rssiValue);
          } else {
          }
        }
      } catch (rssiError) {
      }
      if (this.manualDisconnectCooldown.has(deviceId)) {
        this.manualDisconnectCooldown.delete(deviceId);
      }
      if (this.reconnectionAttempts && this.reconnectionAttempts.has(deviceId)) {
        this.reconnectionAttempts.delete(deviceId);
      }
      if (this.reconnectionTimers && this.reconnectionTimers.has(deviceId)) {
        const timer = this.reconnectionTimers.get(deviceId);
        if (timer) clearTimeout(timer);
        this.reconnectionTimers.delete(deviceId);
      }
      if (Platform.OS === 'android') {
        try {
          if (!this.connectedDevices.has(deviceId)) {
            this.connectedDevices.set(deviceId, connectedDevice);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
          await this.loadDeviceServices(deviceId);
        } catch (error) {
        }
      } else {
        if (!this.connectedDevices.has(deviceId)) {
          this.connectedDevices.set(deviceId, connectedDevice);
        }
      }
      this.startHeartbeatMonitoring(deviceId);
      setTimeout(() => {
        this.startGetApiCalling(deviceId);
      }, 6000);
      this.startConnectionHealthCheck();
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.CONNECTED);
      }
      return connectedDevice;
    } catch (error) {
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device?.name || 'Unknown';
      this.addConnectionLog(deviceId, 'Connection failed', {
        deviceName: deviceName,
        error: error.message || 'Unknown error',
        errorCode: error.code || error.errorCode || 'NO_ERROR_CODE',
        connectionType: 'manual',
        platform: Platform.OS
      });
      this.logError(deviceId, 'CONNECTION_FAILED', {
        error: error.message || 'Unknown error',
        errorCode: error.code || error.errorCode || 'NO_ERROR_CODE',
        deviceName: deviceName
      });
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
  async disconnectFromDevice(deviceId, onConnectionStateChange) {
    try {
      const buffer = this.liveDataBuffers.get(deviceId);
      if (buffer && buffer.length > 0) {
        await this.uploadLiveBatch(deviceId);
      }
      this.stopBatchUploadTimer(deviceId);
      this.liveDataBuffers.delete(deviceId);
      this.lastBatchUpload.delete(deviceId);
      if (this.autoSyncTimers?.has(deviceId)) {
        clearTimeout(this.autoSyncTimers.get(deviceId));
        this.autoSyncTimers.delete(deviceId);
      }
      this.connectionPhase?.delete(deviceId);
      let device = this.scannedDevices.get(deviceId);
      if (!device) {
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
      this.flushPendingCharacteristicsLogs(deviceId);
      this.addConnectionLog(deviceId, 'Disconnecting', {
        deviceName: device.name || 'Unknown',
        connectionType: device.connectionType || 'manual',
        platform: Platform.OS
      });
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTING);
      }
      this.stopMonitoring(deviceId);
      this.stopHeartbeatMonitoring(deviceId);
      this.stopRSSIPolling(deviceId);
      this.stopDeviceStatusPollingFallback(deviceId);
      this.stopAdaptiveApiCalling(deviceId);
      const commandKey = `commands_sent_${deviceId}`;
      if (this[commandKey]) {
        delete this[commandKey];
      }
      if (this.connectedDevices.size <= 1) {
        this.stopConnectionHealthCheck();
      }
      let connectedDevice = this.connectedDevices.get(deviceId);
      if (Platform.OS === 'android') {
        try {
          await SampleBridgeAndroid.cancelConnection(deviceId);
        } catch (e) {
        }
        this.connectedDevices.delete(deviceId);
      } else {
        try {
          await BridgingCodeModule.disconnectFromDevice(deviceId);
        } catch (e) {
        }
        this.connectedDevices.delete(deviceId);
      }
      this.releaseConnection(deviceId);
      if (Platform.OS === 'ios') {
        try {
          await AutoConnectService.disconnectFromNative(deviceId);
        } catch (error) {
        }
      }
      if (device) {
        device.connectionState = CONNECTION_STATES.DISCONNECTED;
        device.lastSeen = Date.now();
        device.disconnectedAt = new Date();
        this.scannedDevices.set(deviceId, device);
        this.markDeviceKnown(deviceId);
      } else {
      }
      if (onConnectionStateChange) {
        onConnectionStateChange(deviceId, CONNECTION_STATES.DISCONNECTED);
      }
      // Android may not emit DeviceDisconnected for manual disconnect (callback removed before native fires). Emit so UI stays in sync.
      if (Platform.OS === 'android' && device) {
        this.emit('deviceDisconnected', {
          ...device,
          id: device.id || deviceId,
          deviceId,
          reason: 'manual',
          error: null,
          connectionState: CONNECTION_STATES.DISCONNECTED
        });
      }
      if (this.onDeviceListUpdated) {
        setTimeout(() => {
          this.onDeviceListUpdated();
        }, 100);
      }
      this.manualDisconnectCooldown.set(deviceId, Date.now());
      if (Platform.OS === 'ios') {
        try {
          await AutoConnectService.stopAutoConnect();
          setTimeout(async () => {
            try {
              await AutoConnectService.startAutoConnect();
            } catch (error) {
            }
          }, 30000);
        } catch (error) {
        }
      }
      setTimeout(() => {
        this.manualDisconnectCooldown.delete(deviceId);
      }, 30000);
      if (Platform.OS === 'ios') {
        try {
          await AutoConnectService.getAutoConnectStatus();
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
        }
        const isBonded = await this.isDeviceBonded(deviceId);
        const autoConnectStatus = await this.getAutoConnectStatus();
        if (isBonded && autoConnectStatus.enabled) {
        } else {
          if (!isBonded) {
          }
          if (!autoConnectStatus.enabled) {
          }
        }
      }
    } catch (error) {
      return;
    }
  }
  async disconnectAllDevices() {
    const promises = [];
    for (const deviceId of this.connectedDevices.keys()) {
      promises.push(this.disconnectFromDevice(deviceId));
    }
    await Promise.all(promises);
  }
  async loadDeviceServices(deviceId) {
    try {
      if (this.serviceDiscoveryInProgress && this.serviceDiscoveryInProgress.has(deviceId)) {
        return;
      }
      if (!this.serviceDiscoveryInProgress) {
        this.serviceDiscoveryInProgress = new Set();
      }
      this.serviceDiscoveryInProgress.add(deviceId);
      const connectedDevice = this.connectedDevices.get(deviceId);
      if (!connectedDevice) {
        throw new Error('Device not in connected devices map');
      }
      let isConnected = false;
      if (Platform.OS === 'android') {
        const device = this.scannedDevices.get(deviceId);
        isConnected = device && device.connectionState === CONNECTION_STATES.CONNECTED;
      } else {
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
      let services = [];
      if (Platform.OS === 'android') {
        try {
          const serviceData = await SampleBridgeAndroid.getDeviceServices(deviceId);
          if (serviceData && serviceData.services && Array.isArray(serviceData.services)) {
            services = serviceData.services.map(service => ({
              uuid: service.uuid,
              isPrimary: service.isPrimary || true,
              characteristics: service.characteristics || []
            }));
          } else {
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
        const discoveryPromise = BridgingCodeModule.discoverServices(deviceId);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Service discovery timeout')), 3000)
        );
        await Promise.race([discoveryPromise, timeoutPromise]);
        await new Promise(resolve => setTimeout(resolve, 500));
        if (device.services && device.services.length > 0) {
          device.services = device.services.map(service => {
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
          services = device.services;
        } else {
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
      if (Platform.OS === 'android') {
        device.services = [];
        device.characteristics = [];
        for (const service of services) {
          const serviceInfo = {
            uuid: service.uuid,
            isPrimary: service.isPrimary,
            characteristics: []
          };
          let characteristics = [];
          if (Platform.OS === 'android') {
            characteristics = service.characteristics || [];
          } else {
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
      if (this.serviceDiscoveryInProgress) {
        this.serviceDiscoveryInProgress.delete(deviceId);
      }
    }
  }
  startMonitoring(deviceId) {
    const device = this.connectedDevices.get(deviceId);
    if (!device) {
      return;
    }
    try {
      let isConnected = false;
      if (Platform.OS === 'android') {
        const deviceState = this.scannedDevices.get(deviceId);
        isConnected = deviceState && deviceState.connectionState === CONNECTION_STATES.CONNECTED;
      } else {
        isConnected = device.isConnected();
      }
      if (!isConnected) {
        return;
      }
    } catch (error) {
      return;
    }
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
    try {
      this.monitorCharacteristic(
        deviceId,
        BLE_SERVICES.BATTERY,
        BLE_CHARACTERISTICS.BATTERY_LEVEL,
        (data) => this.handleBatteryUpdate(deviceId, data)
      );
    } catch (error) {
    }
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
  async monitorCharacteristic(deviceId, serviceUUID, characteristicUUID, onData) {
    try {
      if (Platform.OS === 'android') {
        const result = await SampleBridgeAndroid.monitorCharacteristicForService(
          deviceId,
          serviceUUID,
          characteristicUUID
        );
        const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;
        this.monitoringSubscriptions.set(monitorKey, { remove: () => { } });
        return;
      }
      const result = await BridgingCodeModule.enableNotifications(deviceId, characteristicUUID);
      const monitorKey = `${deviceId}-${serviceUUID}-${characteristicUUID}`;
      this.monitoringSubscriptions.set(monitorKey, { remove: () => { } });
    } catch (error) {
    }
  }
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
  notificationCounts = new Map();
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
  getAllNotificationStats() {
    for (const [deviceId, stats] of this.notificationCounts.entries()) {
      const device = this.scannedDevices.get(deviceId);
      const deviceName = device ? device.name : 'Unknown';
    }
  }
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
    device.services.forEach(service => {
      service.characteristics?.forEach(char => {
      });
    });
  }
  checkDeviceRTCStatus(deviceId) {
    const device = this.scannedDevices.get(deviceId);
    if (!device || !device.deviceData) {
      return;
    }
    const deviceRTC = device.deviceData.deviceRTC;
    const lastUpdate = device.deviceData.lastUpdate;
    const currentTime = Math.floor(Date.now() / 1000);
  }
  async testTimeSyncFormats(deviceId) {
    const currentTime = Math.floor(Date.now() / 1000);
    const deviceRTC = 287454020;
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
        const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes, { waitForResponse: true });
        if (result.success) {
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
  areNotificationsActive(deviceId) {
    const stats = this.getNotificationStats(deviceId);
    const now = new Date();
    const thirtySecondsAgo = new Date(now.getTime() - 30000);
    const isActive = stats.lastUpdate && stats.lastUpdate > thirtySecondsAgo;
    return isActive;
  }
  async retrySyncWithBackoff(deviceId, attempt = 0) {
    if (attempt >= this.autoSyncConfig.maxRetries) {
      console.error(`❌ [AUTO SYNC] Max retries (${this.autoSyncConfig.maxRetries}) reached for ${deviceId}`);
      this.recordSyncFailure(deviceId, 'max_retries_exceeded');
      this.emitUserFeedback(deviceId, 'sync_failed', { reason: 'max_retries_exceeded' });
      return false;
    }
    const delay = this.baseRetryDelay * Math.pow(2, attempt);
    return new Promise((resolve) => {
      const retryTimer = setTimeout(async () => {
        try {
          const result = await this.startDataSync(deviceId);
          if (result && result.status === 'success') {
            this.syncRetryAttempts.delete(deviceId);
            resolve(true);
          } else if (result && result.status === 'already_syncing') {
            this.syncRetryAttempts.delete(deviceId);
            resolve(true);
          } else {
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
    if (history.length > this.maxStateHistory) {
      history.shift();
    }
    if (this.autoSyncConfig.enableMetrics) {
      this.emit('stateTransition', { deviceId, ...transition });
    }
  }
  calculateAdaptiveThrottle(deviceId) {
    if (this.autoSyncConfig.throttleMode !== 'adaptive') {
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
    const rateHistory = this.recordAccumulationRates.get(deviceId) || [];
    if (rateHistory.length < 2) {
      return this.adaptiveThrottleConfig.normal;
    }
    const recentHistory = rateHistory.slice(-5);
    let totalRecords = 0;
    let timeSpan = 0;
    if (recentHistory.length >= 2) {
      const first = recentHistory[0];
      const last = recentHistory[recentHistory.length - 1];
      totalRecords = last.count - first.count;
      timeSpan = (last.timestamp - first.timestamp) / 1000;
    }
    const recordsPer30s = Math.max(0, timeSpan > 0 ? (totalRecords / timeSpan) * 30 : 0);
    if (timeSpan <= 0 || !isFinite(recordsPer30s)) {
      console.warn(`⚠️ [ADAPTIVE THROTTLE] ${deviceId}: Invalid rate calculation, using normal mode`);
      return this.adaptiveThrottleConfig.normal;
    }
    let throttle;
    if (recordsPer30s > 2) {
      throttle = this.adaptiveThrottleConfig.fast;
    } else if (recordsPer30s < 0.5) {
      throttle = this.adaptiveThrottleConfig.slow;
    } else {
      throttle = this.adaptiveThrottleConfig.normal;
    }
    const lastReadTime = this.autoSyncMeta?.get(deviceId)?.lastDeviceStatusReadTime || 0;
    const timeSinceLastRead = lastReadTime > 0 ? (Date.now() - lastReadTime) : 0;
    if (timeSinceLastRead > 25000 && timeSinceLastRead < 35000 && recordsPer30s >= 0) {
      throttle = this.adaptiveThrottleConfig.normal;
    }
    return throttle;
  }
  async processSyncQueue(deviceId) {
    let isSyncActive = false;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state) {
          const activeStates = ['syncing', 'time_syncing'];
          isSyncActive = activeStates.includes(nativeState.state);
        }
      } catch (error) {
      }
    } else {
      const syncState = this.dataSyncStates?.get(deviceId);
      isSyncActive = syncState?.isActive === true;
    }
    if (this.processingSync.get(deviceId) || isSyncActive) {
      return;
    }
    const queue = this.syncQueue.get(deviceId) || [];
    if (queue.length === 0) {
      return;
    }
    this.processingSync.set(deviceId, true);
    const syncRequest = queue.shift();
    try {
      const result = await this.startDataSync(deviceId);
      if (result && result.status === 'success') {
      } else if (result && result.status === 'already_syncing') {
        queue.unshift(syncRequest);
      }
    } catch (error) {
      console.error(`❌ [SYNC QUEUE] Sync failed for ${deviceId}:`, error);
      await this.retrySyncWithBackoff(deviceId);
    } finally {
      this.processingSync.set(deviceId, false);
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
    if (!this.processingSync.get(deviceId)) {
      this.processSyncQueue(deviceId);
    }
  }
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
  async maybeTriggerAutoSyncFromDeviceStatus(deviceId, device, parsedData, options = {}) {
    const nowMs = Date.now();

    // Industry flow: Phase 1 Decide runs once per connection. Never trigger sync during Phase 2 or from Phase 3.
    const phase = this.connectionPhase?.get(deviceId);
    if (options?.historySyncInProgress || phase === 'history_sync') {
      return; // Phase 2: history sync in progress – ignore device status for sync decision
    }
    if (phase === 'live') {
      return; // Phase 3: live only – never re-trigger history sync from device status
    }
    if (phase === undefined) {
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'decide'); // First device status this connection → Phase 1 Decide
    }

    // ✅ OPTIMIZATION #1: EARLY EXIT #1 - Manual reads (check FIRST, before any async operations)
    const isFromManualRead = options?.isManualRead ||
      (options?.skipPollingCheck
        ? false
        : (this.manualReadTimestamps?.get(deviceId) && (nowMs - this.manualReadTimestamps.get(deviceId)) < 2000));
    if (isFromManualRead) {
      console.log(`ℹ️ [AUTO SYNC] ${deviceId}: Manual read detected - skipping auto-sync (user explicitly requested data)`);
      return;
    }

    // ✅ OPTIMIZATION #1: EARLY EXIT #2 - No records available (check before async operations)
    // IMPORTANT (Android first-connect): recordCount can be temporarily 0/undefined while bonding/notifications settle.
    // Never "lock" into Phase 3 live if recordCount is unknown or still stabilizing, otherwise history sync won't run until next app launch.
    if (!this.autoSyncMeta) this.autoSyncMeta = new Map();
    const metaForDecide = this.autoSyncMeta.get(deviceId) || {};
    if (!metaForDecide.decideStartedAt) metaForDecide.decideStartedAt = nowMs;
    this.autoSyncMeta.set(deviceId, metaForDecide);

    const recordCountFromStatus = parsedData?.recordCount;
    const recordCountFromManufacturer =
      device?.manufacturerData?.recordCount ??
      device?.deviceData?.manufacturerRecordCount ??
      device?.deviceData?.manufacturerData?.recordCount;
    const resolvedRecordCount = Math.max(
      typeof recordCountFromStatus === 'number' ? recordCountFromStatus : -1,
      typeof recordCountFromManufacturer === 'number' ? recordCountFromManufacturer : -1
    );

    // Unknown record count → wait for a subsequent device status update (do NOT set phase=live).
    if (resolvedRecordCount < 0) {
      return;
    }

    const hasRecordsAvailable = resolvedRecordCount > 0;
    if (!hasRecordsAvailable) {
      const decideAgeMs = nowMs - (metaForDecide.decideStartedAt || nowMs);
      // Give a short grace period for first connection so we don't prematurely skip history sync.
      if (decideAgeMs < 4000) {
        const lastWaitLog = metaForDecide.lastNoRecordWaitLogAt || 0;
        if (nowMs - lastWaitLog > 2000) {
          metaForDecide.lastNoRecordWaitLogAt = nowMs;
          this.autoSyncMeta.set(deviceId, metaForDecide);
          this.addConnectionLog(deviceId, 'Decide: Waiting for record count', {
            recordCount: resolvedRecordCount,
            waitedMs: decideAgeMs
          });
        }
        return;
      }

      this.addConnectionLog(deviceId, 'Decide: Skip – no records', { recordCount: resolvedRecordCount });
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'live'); // No records → go to live mode
      return;
    }

    // ✅ OPTIMIZATION #1: EARLY EXIT #3 - Not connected (check before async operations)
    const isConnected = device?.connectionState === CONNECTION_STATES.CONNECTED;
    if (!isConnected) {
      return;
    }

    // ✅ OPTIMIZATION #1: EARLY EXIT #4 - RTC not valid (check before async operations)
    const isLiveData = parsedData?.rtcValid || (parsedData?.deviceRTC && parsedData.deviceRTC > 1577836800);
    if (!isLiveData) {
      return;
    }

    // Now check sync state (async operation, but necessary)
    let isSyncActive = false;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state) {
          const activeStates = ['syncing', 'time_syncing'];
          isSyncActive = activeStates.includes(nativeState.state);
          if (this.dataSyncStates) {
            this.dataSyncStates.delete(deviceId);
          }
        }
      } catch (error) {
        const syncState = this.dataSyncStates?.get(deviceId);
        isSyncActive = syncState?.isActive === true;
      }
    } else {
      const syncState = this.dataSyncStates?.get(deviceId);
      isSyncActive = syncState?.isActive === true;
    }

    // ✅ OPTIMIZATION #1: EARLY EXIT #5 - Sync already active (after async check)
    if (isSyncActive) {
      return; // Exit immediately if sync already active
    }

    const meta = this.autoSyncMeta.get(deviceId) || {};

    // ✅ RECOMMENDED FLOW: Skip sync if we already have all (lastAppRecordTimestamp / lastRecordCount)
    const lastAppRecordTimestamp = meta.lastRecordTimestamp;
    const deviceRecordCount = resolvedRecordCount ?? (parsedData?.recordCount ?? 0);
    const alreadyHaveAll = deviceRecordCount > 0 &&
      meta.lastRecordCount === deviceRecordCount &&
      lastAppRecordTimestamp != null;
    if (alreadyHaveAll) {
      this.addConnectionLog(deviceId, 'Decide: Skip – already have all records', {
        deviceRecordCount,
        lastRecordTimestamp: lastAppRecordTimestamp
      });
      console.log(`⏭️ [AUTO SYNC] ${deviceId}: Already have all records (device: ${deviceRecordCount}, lastRecordTimestamp: ${lastAppRecordTimestamp}) - skipping`);
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'live'); // Phase 3: no history sync needed
      return;
    }

    // ✅ RECOMMENDATION #2: Optimize sync cooldown - allow sync if record count increased significantly
    // Calculate record count increase before checking cooldown
    const recordCountIncreased = meta.lastRecordCount === undefined || parsedData?.recordCount > meta.lastRecordCount;
    const recordCountIncreaseAmount = meta.lastRecordCount !== undefined
      ? (parsedData?.recordCount || 0) - meta.lastRecordCount
      : (parsedData?.recordCount || 0);
    const significantRecordIncrease = recordCountIncreaseAmount > 100; // Allow sync if >100 new records

    // ✅ OPTIMIZATION #1: EARLY EXIT #6 - Sync just completed (check before more processing)
    // BUT: Allow sync if record count increased significantly (>100 records)
    let syncJustCompleted = false;
    if (Platform.OS === 'android' && SampleBridgeAndroid) {
      try {
        const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
        if (nativeState && nativeState.state === 'complete') {
          const lastSyncCompletedAt = meta.lastSyncCompletedAt || meta.lastSyncAt || 0;
          const timeSinceSync = nowMs - lastSyncCompletedAt;
          syncJustCompleted = timeSinceSync < 15000;
        }
      } catch (error) {
      }
    } else {
      if (meta.lastSyncCompletedAt) {
        const timeSinceSync = nowMs - meta.lastSyncCompletedAt;
        syncJustCompleted = timeSinceSync < 15000;
      }
    }

    // ✅ RECOMMENDATION #2: Override cooldown if significant record increase
    if (syncJustCompleted && !significantRecordIncrease) {
      console.log(`⏸️ [AUTO SYNC] ${deviceId}: Sync cooldown active (${Math.floor((nowMs - (meta.lastSyncCompletedAt || meta.lastSyncAt || 0)) / 1000)}s ago) - record increase: ${recordCountIncreaseAmount}`);
      return; // Exit if sync just completed AND no significant record increase
    } else if (syncJustCompleted && significantRecordIncrease) {
      console.log(`✅ [AUTO SYNC] ${deviceId}: Overriding sync cooldown - significant record increase detected (${recordCountIncreaseAmount} new records)`);
      // Continue processing - allow sync despite cooldown
    }

    meta.lastDeviceStatusReadTime = nowMs;
    this.autoSyncMeta.set(deviceId, meta);
    // Record count increase already calculated above for cooldown optimization
    // Re-use the recordCountIncreased and recordCountIncreaseAmount from above
    const throttleTime = this.calculateAdaptiveThrottle(deviceId);
    const throttleExpired = !meta.lastSyncAt || (nowMs - meta.lastSyncAt) >= throttleTime;
    const isSingleRecord = parsedData?.recordCount === 1;
    const timeSinceLastSync = nowMs - (meta.lastSyncAt || 0);

    // Sync if: record count increased OR is single record (regardless of throttle), or has records + throttle expired
    const shouldSync = recordCountIncreased ||
      isSingleRecord ||
      (hasRecordsAvailable && throttleExpired);
    if (hasRecordsAvailable) {
      console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId}:`, {
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
    if (parsedData?.recordCount !== undefined) {
      meta.lastRecordCount = parsedData.recordCount;
      this.autoSyncMeta.set(deviceId, meta);
    }
    if (!this.recordAccumulationRates.has(deviceId)) {
      this.recordAccumulationRates.set(deviceId, []);
    }
    const rateHistory = this.recordAccumulationRates.get(deviceId);
    rateHistory.push({
      timestamp: nowMs,
      count: parsedData?.recordCount || 0
    });
    if (rateHistory.length > 10) {
      rateHistory.shift();
    }
    this.lastNotificationTime.set(deviceId, nowMs);
    const lastNotification = this.lastNotificationData?.get(deviceId);
    if (lastNotification &&
      lastNotification.recordCount === parsedData?.recordCount &&
      (nowMs - lastNotification.timestamp) < this.notificationDedupeWindow) {
      return;
    }
    if (!this.lastNotificationData) {
      this.lastNotificationData = new Map();
    }
    this.lastNotificationData.set(deviceId, {
      recordCount: parsedData?.recordCount || 0,
      timestamp: nowMs
    });

    // ✅ RECOMMENDATION #2: Allow sync if significant record increase, even during cooldown
    const shouldBypassCooldown = significantRecordIncrease && recordCountIncreased;

    const conditions = {
      hasRecordsAvailable,
      isSyncActive,
      syncJustCompleted,
      shouldBypassCooldown,  // ✅ RECOMMENDATION #2: Track cooldown bypass
      isConnected,
      isLiveData,
      isFromManualRead,
      shouldSync,
      recordCount: parsedData?.recordCount,
      lastRecordCount: meta.lastRecordCount,
      recordCountIncreased,
      recordCountIncreaseAmount,  // ✅ RECOMMENDATION #2: Track increase amount
      significantRecordIncrease,  // ✅ RECOMMENDATION #2: Track if significant
      throttleExpired,
      isSingleRecord,
      timeSinceLastSync: meta.lastSyncAt ? (nowMs - meta.lastSyncAt) : 'never',
      throttleTime
    };
    const allConditionsMet = hasRecordsAvailable && !isSyncActive && (!syncJustCompleted || shouldBypassCooldown) && isConnected && isLiveData && !isFromManualRead && shouldSync;
    if (!allConditionsMet && hasRecordsAvailable) {
      console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Auto-sync conditions:`, JSON.stringify(conditions, null, 2));
      const failedConditions = [];
      if (!hasRecordsAvailable) failedConditions.push('hasRecordsAvailable');
      if (isSyncActive) failedConditions.push('isSyncActive');
      if (syncJustCompleted && !shouldBypassCooldown) failedConditions.push('syncJustCompleted');
      if (!isConnected) failedConditions.push('isConnected');
      if (!isLiveData) failedConditions.push('isLiveData');
      if (isFromManualRead) failedConditions.push('isFromManualRead');
      if (!shouldSync) failedConditions.push('shouldSync');
      console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Failed conditions: ${failedConditions.join(', ') || 'none (timer debounce?)'}`);
    }
    if (allConditionsMet) {
      console.log(`✅ [AUTO SYNC DEBUG] ${deviceId} - All conditions met, setting up auto-sync timer (${parsedData?.recordCount} records, debounce: ${this.autoSyncConfig.debounceDelay}ms)`);
      const lastTimerResetTime = this.lastTimerReset?.get(deviceId) || 0;
      const timeSinceLastReset = nowMs - lastTimerResetTime;
      if (timeSinceLastReset < this.timerResetDebounceWindow) {
        console.log(`🔍 [AUTO SYNC DEBUG] ${deviceId} - Timer debounce active (${timeSinceLastReset}ms < ${this.timerResetDebounceWindow}ms)`);
        return;
      }
      if (!this.autoSyncTimers) {
        this.autoSyncTimers = new Map();
      }
      if (this.autoSyncTimers.has(deviceId)) {
        const existingTimer = this.autoSyncTimers.get(deviceId);
        clearTimeout(existingTimer);
        this.autoSyncTimers.delete(deviceId);
      }
      if (!this.lastTimerReset) {
        this.lastTimerReset = new Map();
      }
      this.lastTimerReset.set(deviceId, nowMs);
      const recordCountAtNotification = parsedData.recordCount;
      const notificationTimestamp = Date.now();
      const hasRecordsAtNotification = hasRecordsAvailable;
      const syncTimer = setTimeout(async () => {
        this.autoSyncTimers?.delete(deviceId);
        const phase = this.connectionPhase?.get(deviceId);
        if (phase === 'live' || phase === 'history_sync') {
          return;
        }
        const currentDevice = this.scannedDevices.get(deviceId);
        const stillConnected = currentDevice?.connectionState === CONNECTION_STATES.CONNECTED;
        const currentRecordCount = currentDevice?.deviceData?.recordCount || recordCountAtNotification;
        const stillHasRecords = currentRecordCount > 0;
        let stillActive = false;
        let currentState = 'unknown';
        if (Platform.OS === 'android' && SampleBridgeAndroid) {
          try {
            const nativeState = await SampleBridgeAndroid.getDataSyncState(deviceId);
            if (nativeState && nativeState.state) {
              currentState = nativeState.state;
              const activeStates = ['syncing', 'time_syncing'];
              stillActive = activeStates.includes(nativeState.state);
            }
          } catch (error) {
            const currentSyncState = this.dataSyncStates?.get(deviceId);
            stillActive = currentSyncState?.isActive === true;
            currentState = currentSyncState?.state || 'unknown';
          }
        } else {
          const currentSyncState = this.dataSyncStates?.get(deviceId);
          stillActive = currentSyncState?.isActive === true;
          currentState = currentSyncState?.state || 'unknown';
        }
        if (!stillActive && stillConnected && stillHasRecords) {
          this.logStateTransition(deviceId, currentState, 'syncing', 'auto-sync triggered');
          this.emitUserFeedback(deviceId, 'sync_starting', {
            recordCount: currentRecordCount,
            reason: 'auto_sync'
          });
          this.recordSyncStart(deviceId);
          try {
            if (this.processingSync.get(deviceId)) {
              this.addToSyncQueue(deviceId, {
                recordCount: currentRecordCount,
                reason: 'auto_sync'
              });
              return;
            }
            const syncStartTime = Date.now();
            const result = await this.startDataSync(deviceId);
            if (result && result.status === 'already_syncing') {
              console.warn(`⚠️ [AUTO SYNC] Sync rejected - already in progress (state: ${result.currentState})`);
              this.addToSyncQueue(deviceId, {
                recordCount: currentRecordCount,
                reason: 'auto_sync_retry'
              });
              return;
            }
            if (result && result.status === 'error') {
              console.error(`❌ [AUTO SYNC] Sync failed: ${result.error}`);
              this.recordSyncFailure(deviceId, result.error || 'unknown_error');
              this.emitUserFeedback(deviceId, 'sync_failed', { error: result.error });
              await this.retrySyncWithBackoff(deviceId);
              return;
            }
            const syncLatency = Date.now() - syncStartTime;
            this.recordSyncSuccess(deviceId, syncLatency);
            this.autoSyncMeta.set(deviceId, {
              lastRecordCount: recordCountAtNotification,
              lastSyncAt: Date.now(),
            });
            this.emitUserFeedback(deviceId, 'sync_started', {
              recordCount: currentRecordCount
            });
          } catch (error) {
            console.error(`❌ [AUTO SYNC] Failed to start sync:`, error);
            this.recordSyncFailure(deviceId, error.message || 'exception');
            this.emitUserFeedback(deviceId, 'sync_failed', { error: error.message });
            await this.retrySyncWithBackoff(deviceId);
          }
        } else {
          if (stillActive) {
            this.addToSyncQueue(deviceId, {
              recordCount: currentRecordCount,
              reason: 'sync_already_active'
            });
          }
        }
      }, this.autoSyncConfig.debounceDelay);
      this.autoSyncTimers.set(deviceId, syncTimer);
    }
  }

  // ✅ OPTIMIZATION #3: Aggregate Device Status notifications before processing
  aggregateDeviceStatusNotification(deviceId, device, parsedData, options = {}) {
    if (!this.deviceStatusNotificationBuffer) {
      this.deviceStatusNotificationBuffer = new Map();
    }

    // Initialize buffer for this device if needed
    if (!this.deviceStatusNotificationBuffer.has(deviceId)) {
      this.deviceStatusNotificationBuffer.set(deviceId, {
        notifications: [],
        timer: null
      });
    }

    const buffer = this.deviceStatusNotificationBuffer.get(deviceId);

    // Add notification to buffer
    buffer.notifications.push({
      device,
      parsedData,
      options,
      timestamp: Date.now()
    });

    // Clear existing timer
    if (buffer.timer) {
      clearTimeout(buffer.timer);
    }

    // Process after aggregation window (use latest notification)
    buffer.timer = setTimeout(() => {
      const latest = buffer.notifications[buffer.notifications.length - 1];
      if (latest) {
        // Process the latest notification
        this.maybeTriggerAutoSyncFromDeviceStatus(
          deviceId,
          latest.device,
          latest.parsedData,
          latest.options
        ).catch((error) => {
          console.error(`❌ [NOTIFICATION AGGREGATION] Error processing aggregated notification:`, error);
        });
      }

      // Clear buffer
      this.deviceStatusNotificationBuffer.delete(deviceId);
    }, this.notificationAggregationWindow);
  }

  async handleDeviceStatusUpdate(deviceId, data, options = {}) {
    try {
      const currentStats = this.notificationCounts.get(deviceId) || {
        deviceStatus: 0, batteryLevel: 0, dataTransfer: 0, systemCommand: 0, total: 0, lastUpdate: null
      };
      currentStats.deviceStatus++;
      currentStats.total++;
      currentStats.lastUpdate = new Date();
      this.notificationCounts.set(deviceId, currentStats);
      if (currentStats.deviceStatus % 10 === 0) {
      }
      if (currentStats.deviceStatus <= 3) {
      }
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        return;
      }
      const parsedData = BLEDataParser.parseDeviceStatus(data);
      if (parsedData) {
        // ✅ OPTIMIZATION #4: Filter redundant notifications - only process if data actually changed
        const lastDeviceStatus = this.lastDeviceStatus.get(deviceId);
        if (lastDeviceStatus && !options?.isManualRead) {
          const recordCountChanged = parsedData.recordCount !== lastDeviceStatus.recordCount;
          const batteryChanged = parsedData.batteryLevel !== undefined &&
            lastDeviceStatus.batteryLevel !== undefined &&
            Math.abs(parsedData.batteryLevel - lastDeviceStatus.batteryLevel) > 1; // 1% threshold
          const timestampChanged = parsedData.timestamp !== lastDeviceStatus.timestamp;

          // If no meaningful changes, skip processing (but always process first notification)
          if (currentStats.deviceStatus > 1 && !recordCountChanged && !batteryChanged && !timestampChanged) {
            console.log(`🔍 [DEVICE STATUS] Skipping redundant notification for ${deviceId} - no meaningful changes`);
            return; // Skip processing redundant notification
          }
        }

        // Update last Device Status for next comparison
        this.lastDeviceStatus.set(deviceId, {
          recordCount: parsedData.recordCount,
          batteryLevel: parsedData.batteryLevel,
          timestamp: parsedData.timestamp
        });

        if (currentStats.deviceStatus <= 2) {
        }
        const incomingDate = parsedData.lastUpdate;
        const isStaleRTC = incomingDate && incomingDate < new Date('2020-01-01');
        const rtcValid = parsedData.rtcValid;
        const isInitialRTCCheck = currentStats.deviceStatus === 1;
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
        if (isInitialRTCCheck) {
          if (!rtcValid || isStaleRTC) {
            this.addConnectionLog(deviceId, 'RTC Check: RTC Invalid - SET_TIME Command Will Be Sent', {
              deviceTime: parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null,
              systemTime: Math.floor(Date.now() / 1000),
              rtcValid: false,
              isStaleRTC: isStaleRTC || false,
              action: 'Will send SET_TIME command',
              connectionType: 'manual_or_auto'
            });
          } else {
            this.addConnectionLog(deviceId, 'RTC Check: RTC Valid - Time Sync Skipped', {
              deviceTime: parsedData.timestamp ? Math.floor(parsedData.timestamp.getTime() / 1000) : null,
              systemTime: Math.floor(Date.now() / 1000),
              rtcValid: true,
              action: 'Skipping time sync, proceeding with data operations',
              connectionType: 'manual_or_auto'
            });
          }
        }
        // SIMPLIFIED (SDD v1.5): Native handles RTC check and SET_TIME automatically
        // Native flow: Enable notifications → Read Device Status → Check RTC → Send SET_TIME if needed → Data Sync
        // JS should NOT duplicate this - native sends RTCRead event for logging purposes only
        // 
        // Auto time sync from JS has been REMOVED to avoid:
        // 1. Duplicate SET_TIME commands (race condition with native)
        // 2. Unnecessary complexity
        // 3. Unpredictable behavior
        //
        // If user needs manual time sync, they can call manualTimeSync() explicitly
        if (BLEDataParser.validateData(parsedData)) {
          const hasSyncedData = device.deviceData?.dataSource === 'synced';
          if (isStaleRTC && hasSyncedData) {
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
          const { recordCount: parsedRecordCount, ...parsedDataWithoutRecordCount } = parsedData;
          const preservedRecordCount = device.deviceData?.recordCount;
          device.deviceData = {
            ...device.deviceData,
            ...parsedDataWithoutRecordCount,
            recordCount: preservedRecordCount,
            batteryLevel: batteryLevelToUse,
            dataSource: (parsedData.timestamp && parsedData.timestamp > 1577836800) ? 'live' : (device.deviceData?.dataSource || 'cached'),
            lastUpdate: parsedData.lastUpdate || new Date()
          };
          if (parsedRecordCount !== preservedRecordCount) {
            console.log(`🔒 [handleDeviceStatusUpdate] Preserving recordCount: ${preservedRecordCount} (device reported ${parsedRecordCount}, but this path doesn't have isFromPolling info)`);
          }
          this.scannedDevices.set(deviceId, device);
          const dataChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature ||
            previousData.batteryLevel !== device.deviceData.batteryLevel;

          // ✅ OPTIMIZATION #2: Only check sync on meaningful changes
          // - Record count increased (new records available)
          // - Is single record (special case - needs immediate sync)
          const recordCountChanged = previousData.recordCount !== device.deviceData.recordCount;
          const recordCountIncreased = (previousData.recordCount === undefined || previousData.recordCount === null)
            ? (parsedData.recordCount !== undefined && parsedData.recordCount > 0)
            : (parsedData.recordCount !== undefined && parsedData.recordCount > previousData.recordCount);
          const isSingleRecord = parsedData.recordCount === 1;

          // Only check sync if record count increased or is single record
          const shouldCheckSync = recordCountIncreased ||
            isSingleRecord;

          if (shouldCheckSync) {
            // ✅ OPTIMIZATION #3: Aggregate notifications before processing
            // Add to buffer instead of processing immediately
            this.aggregateDeviceStatusNotification(deviceId, device, parsedData, options);
          }
          if (recordCountChanged && this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }
          const stepsOrTempChanged = previousData.steps !== device.deviceData.steps ||
            previousData.temperature !== device.deviceData.temperature;
          if (stepsOrTempChanged && parsedData.timestamp && parsedData.timestamp > 1577836800) {
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            // Match by RECORDED TIME only (device time), so we update the correct record
            const existingRecordIndex = device.syncRecords.findIndex(r => {
              const existingRecordedTime = this.getRecordedTimeSeconds(r);
              return existingRecordedTime !== null && existingRecordedTime === parsedData.timestamp;
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
              }
              // ✅ RECOMMENDED FLOW: Update lastRecordTimestamp from live record (no re-sync from live path)
              if (parsedData.timestamp && parsedData.timestamp > 1577836800) {
                if (!this.autoSyncMeta) this.autoSyncMeta = new Map();
                const meta = this.autoSyncMeta.get(deviceId) || {};
                meta.lastRecordTimestamp = Math.max(meta.lastRecordTimestamp || 0, parsedData.timestamp);
                this.autoSyncMeta.set(deviceId, meta);
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
          const isValidLiveData = parsedData.deviceRTC && parsedData.deviceRTC > 1577836800;
          if (isValidLiveData) {
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
  handleDataTransfer(deviceId, data) {
    try {
      const parsedTransfer = BLEDataParser.parseDataTransfer(data);
      if (!parsedTransfer) {
        return;
      }
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
    const deviceStatusTotal = device?.deviceData?.recordCount || 0;
    const reportedTotal = parsedTransfer.totalRecords || 0;
    // SDD v1.5: Use device status total as floor only when sync_start reported a full chunk (>= 500).
    // When device reports a small batch (e.g. 10 from manual Start Sync(10)), keep that so we don't
    // overwrite expectedRecords with 251 and mark sync as "incomplete" when 10/10 is correct.
    const RECORDS_PER_FILE = 500;
    const effectiveTotal =
      deviceStatusTotal > 0 && reportedTotal < deviceStatusTotal && reportedTotal >= RECORDS_PER_FILE
        ? deviceStatusTotal
        : (reportedTotal || deviceStatusTotal);
    this.addConnectionLog(deviceId, 'Data Sync: Sync Start', {
      totalRecords: effectiveTotal,
      reportedByDevice: reportedTotal,
      deviceStatusTotal
    });
    this.syncExpectedRecords.set(deviceId, effectiveTotal);
    const syncState = this.dataSyncStates?.get(deviceId);
    if (syncState) {
      syncState.totalRecords = effectiveTotal;
      syncState.expectedRecords = effectiveTotal;
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
        totalRecords: effectiveTotal,
        lastActivity: Date.now(),
        expectedRecords: effectiveTotal
      });
    }
    this.emit('dataSyncStart', {
      deviceId,
      totalRecords: effectiveTotal
    });
  }
  async handleSyncComplete(deviceId, parsedTransfer) {
    this.latestNativeSyncCompletionEvent.set(deviceId, parsedTransfer);
    const syncState = this.dataSyncStates?.get(deviceId);
    const previousState = syncState?.state || 'unknown';
    const timeout = this.syncTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.syncTimeouts.delete(deviceId);
    }
    const expectedRecords = this.syncExpectedRecords.get(deviceId) || syncState?.expectedRecords || 0;
    const receivedRecords = syncState?.recordsReceived || 0;
    const recordsTransmitted = parsedTransfer.recordsTransmitted || 0;
    // Android multi-chunk: native sends grandTotal/totalExpected on sync_complete. Use it for "total synced" so
    // connection log and UI show total across all chunks (e.g. 1500), not last chunk only (500).
    const totalSyncedFromNative = parsedTransfer.grandTotal ?? parsedTransfer.totalExpected ?? recordsTransmitted;
    const effectiveReceived = parsedTransfer.grandTotal ?? parsedTransfer.totalExpected ?? receivedRecords;
    const isIncomplete = expectedRecords > 0 && effectiveReceived < expectedRecords && totalSyncedFromNative < expectedRecords;
    if (!this.lastSyncCompleteTime) {
      this.lastSyncCompleteTime = new Map();
    }
    const lastCompleteTime = this.lastSyncCompleteTime.get(deviceId) || 0;
    const timeSinceLastComplete = Date.now() - lastCompleteTime;
    if (timeSinceLastComplete < 1000 && recordsTransmitted > 0) {
      return;
    }
    this.lastSyncCompleteTime.set(deviceId, Date.now());
    this.addConnectionLog(deviceId, 'Data Sync: Sync Complete', {
      success: parsedTransfer.success,
      recordsTransmitted,
      expectedRecords: expectedRecords,
      receivedRecords: receivedRecords,
      effectiveReceived,
      isIncomplete: isIncomplete
    });
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
      this.retryIncompleteSync(deviceId);
      return;
    }
    this.syncRetryAttempts.delete(deviceId);
    this.syncRetryDelays.delete(deviceId);
    this.syncExpectedRecords.delete(deviceId);
    if (parsedTransfer.success) {
      this.logStateTransition(deviceId, previousState, 'complete', 'sync successful');
      const updated = this.updateDeviceDataFromSyncedRecords(deviceId);
      if (updated) {
        const latestRecord = this.getLatestSyncedRecord(deviceId);
        const device = this.scannedDevices.get(deviceId);
        const recordsBeforeSync = device?.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0;
        const recordsAfterSync = device?.syncRecords?.length || 0;
        const actualNewRecords = Math.max(0, recordsAfterSync - recordsBeforeSync);
        const totalSyncedThisRun = totalSyncedFromNative;
        if (totalSyncedThisRun > 0) {
          const now = Date.now();
          const lastLog = this.lastRecordSyncedLogs.get(deviceId);
          const shouldLog = !lastLog ||
            (now - lastLog.timestamp) > 500 ||
            lastLog.recordCount !== totalSyncedThisRun;
          if (shouldLog) {
            const deduplicated = Math.max(0, totalSyncedThisRun - actualNewRecords);
            if (deduplicated > 0) {
              this.addConnectionLog(deviceId, `${totalSyncedThisRun} received, ${actualNewRecords} new unique (${deduplicated} duplicates skipped)`);
            } else {
              this.addConnectionLog(deviceId, `${totalSyncedThisRun} Record${totalSyncedThisRun === 1 ? '' : 's'} Synced`);
            }
            this.lastRecordSyncedLogs.set(deviceId, { timestamp: now, recordCount: totalSyncedThisRun });
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
      meta.syncCompletedRecordCount = 0;
      // ✅ RECOMMENDED FLOW: Update lastRecordTimestamp from synced records; enable live mode after history sync
      const device = this.scannedDevices.get(deviceId);
      const syncedRecords = device?.syncRecords || [];
      if (syncedRecords.length > 0) {
        const maxTs = syncedRecords.reduce((max, r) => {
          const ts = this.getRecordedTimeSeconds(r);
          return Math.max(max, ts || 0);
        }, 0);
        if (maxTs > 0) {
          meta.lastRecordTimestamp = maxTs;
        }
      }
      // Record device count at sync completion so "already have all" can skip next time (expectedRecords from sync flow)
      const completedCount = expectedRecords || parsedTransfer.recordsTransmitted || device?.syncRecords?.length;
      if (completedCount != null) meta.lastRecordCount = completedCount;
      meta.liveMode = true; // Phase 3: live only – history sync complete
      this.autoSyncMeta.set(deviceId, meta);
      if (!this.connectionPhase) this.connectionPhase = new Map();
      const alreadyLive = this.connectionPhase.get(deviceId) === 'live';
      this.connectionPhase.set(deviceId, 'live');
      if (!alreadyLive) {
        this.addConnectionLog(deviceId, 'Phase 3: LIVE MODE – history sync complete', {
          totalSynced: device?.syncRecords?.length,
          lastRecordTimestamp: meta.lastRecordTimestamp,
          lastRecordCount: meta.lastRecordCount
        });
      }
      this.recordSyncSuccess(deviceId, syncLatency);
      this.emitUserFeedback(deviceId, 'sync_completed', {
        recordsTransmitted: parsedTransfer.recordsTransmitted || 0,
        latency: syncLatency
      });
    } else {
      this.logStateTransition(deviceId, previousState, 'failed', 'sync failed');
      this.recordSyncFailure(deviceId, parsedTransfer.reason || 'sync_failed');
      this.emitUserFeedback(deviceId, 'sync_failed', {
        reason: parsedTransfer.reason || 'sync_failed'
      });
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'live'); // Allow live data even after sync failure
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
    // Firmware v1.5: Detect push-generated records (live data notifications)
    const isPushGenerated = parsedTransfer.isPushGenerated === true || parsedTransfer.isLiveData === true;

    if (isPushGenerated) {
      // Live data only after history sync completes (Phase 3)
      if (this.connectionPhase?.get(deviceId) !== 'live') {
        return; // Don't process live data until Phase 3
      }
      // Push-generated record: Process as live data, don't count in sync progress
      console.log(`📤 [PUSH-GENERATED RECORD] ${deviceId}: Processing ${parsedTransfer.recordCount || 0} live record(s) from firmware v1.5`);
      this.handlePushGeneratedRecord(deviceId, parsedTransfer);
      return;
    }

    // Sync record: Process as part of sync operation
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
        // Store all records during sync; filter by last record only when displaying (live/history screens)
        let validCount = 0;
        let invalidCount = 0;
        parsedTransfer.records.forEach((record, index) => {
          let recordTimestamp = null;
          if (typeof record.timestamp === 'number') {
            recordTimestamp = record.timestamp;
          } else if (record.timestamp instanceof Date) {
            recordTimestamp = Math.floor(record.timestamp.getTime() / 1000);
          } else if (record.timestampDate) {
            recordTimestamp = Math.floor(new Date(record.timestampDate).getTime() / 1000);
          }
          const currentTimeSeconds = Math.floor(Date.now() / 1000);
          const MIN_VALID_TIMESTAMP = 1577836800;
          const MAX_VALID_TIMESTAMP = currentTimeSeconds + 86400;
          const MIN_VALID_TEMPERATURE = -20;
          const MAX_VALID_TEMPERATURE = 50;
          const MAX_VALID_STEPS = 50000;
          const CORRUPTED_TEMPERATURE = 255;
          const CORRUPTED_STEPS = 65535;
          const hasCorruptedTemperature = record.temperature === CORRUPTED_TEMPERATURE ||
            record.temperature === undefined ||
            record.temperature === null;
          const hasCorruptedSteps = record.steps === CORRUPTED_STEPS ||
            (record.steps !== undefined && record.steps < 0);
          const hasInvalidTemperature = record.temperature !== undefined &&
            record.temperature !== null &&
            (record.temperature < MIN_VALID_TEMPERATURE ||
              record.temperature > MAX_VALID_TEMPERATURE);
          const hasInvalidSteps = record.steps !== undefined &&
            record.steps !== null &&
            record.steps > MAX_VALID_STEPS;
          const hasInvalidTimestamp = recordTimestamp !== null &&
            (recordTimestamp < MIN_VALID_TIMESTAMP ||
              recordTimestamp > MAX_VALID_TIMESTAMP);
          const hasNoData = (record.steps === undefined || record.steps === null || record.steps === 0) &&
            (record.temperature === undefined || record.temperature === null || record.temperature === 0) &&
            (!recordTimestamp || recordTimestamp < MIN_VALID_TIMESTAMP);
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
          const isValidRecord = (
            record.steps > 0 ||
            record.temperature > 0 ||
            (recordTimestamp && recordTimestamp > MIN_VALID_TIMESTAMP)
          );
          if (!isValidRecord) {
            invalidCount++;
            return;
          }
          const receivedAt = new Date();
          const receivedAtSeconds = Math.floor(receivedAt.getTime() / 1000);
          // Log when device RTC is ahead of phone; we still store and show exact time from tag
          if (recordTimestamp && recordTimestamp > receivedAtSeconds) {
            const timeDiff = recordTimestamp - receivedAtSeconds;
            console.warn(`⚠️ [TIMESTAMP VALIDATION] ${deviceId}: Record timestamp is ${timeDiff} seconds in the future (showing exact tag time)`, {
              recordTimestamp,
              receivedAtSeconds,
              timestampDate: record.timestampDate,
              receivedAt: receivedAt.toISOString(),
              timeDiffSeconds: timeDiff
            });
          }
          // Dedupe by RECORDED TIME only (device time), never received or synced time.
          const recordedTimeSeconds = recordTimestamp;
          const existingRecordIndex = device.syncRecords.findIndex(r => {
            const existingRecordedTime = this.getRecordedTimeSeconds(r);
            return existingRecordedTime === recordedTimeSeconds &&
              r.steps === record.steps &&
              r.temperature === record.temperature;
          });
          if (existingRecordIndex >= 0) {
            invalidCount++;
            const dupMsg = `Deduped record: time=${recordedTimeSeconds}, steps=${record.steps}, temp=${record.temperature}${record.timestampDate ? ` (${record.timestampDate})` : ''}`;
            console.log(`⏭️ [DUPLICATE DETECTION] ${deviceId}: Skipping duplicate record — ${dupMsg}`);
            this.addConnectionLog(deviceId, `Duplicate removed: ${dupMsg}`);
            return;
          }
          validCount++;
          // Always use exact time from tag for display (no adjustment)
          const finalTimestamp = recordTimestamp;
          let finalTimestampDate = record.timestampDate;
          if (!finalTimestampDate && finalTimestamp) {
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
            timestampDate: finalTimestampDate || record.timestampDate,
            receivedAt: receivedAt,
            deviceId
          };
          device.syncRecords.push(newRecord);
          try {
            store.dispatch(addRecord({ deviceId, record: newRecord }));
          } catch (error) {
          }
        });
        if (validCount > 0) {
          if (!device.deviceData) {
            device.deviceData = {};
          }
          device.deviceData.recordCount = device.syncRecords.length;
          device.syncRecords.sort((a, b) => {
            const tsA = this.getRecordedTimeSeconds(a) ?? 0;
            const tsB = this.getRecordedTimeSeconds(b) ?? 0;
            return tsA - tsB;
          });

          // Update deviceData from latest sync record (fixes UI not updating)
          if (device.syncRecords.length > 0) {
            // Get latest record (after sorting, last record is most recent)
            const latestRecord = device.syncRecords[device.syncRecords.length - 1];

            // Update steps from latest record if available
            if (latestRecord.steps !== undefined && latestRecord.steps !== null && latestRecord.steps > 0) {
              device.deviceData.steps = latestRecord.steps;
            }

            // Update temperature from latest record if available
            if (latestRecord.temperature !== undefined && latestRecord.temperature !== null) {
              device.deviceData.temperature = latestRecord.temperature;
            }

            // Update lastUpdate timestamp
            if (latestRecord.timestampDate) {
              device.deviceData.lastUpdate = new Date(latestRecord.timestampDate);
            } else if (latestRecord.timestamp) {
              device.deviceData.lastUpdate = new Date(latestRecord.timestamp * 1000);
            }

            // Calculate total steps from all records
            const totalSteps = device.syncRecords.reduce((sum, record) => {
              return sum + (record.steps || 0);
            }, 0);
            device.deviceData.totalSteps = totalSteps;

            // Mark data source as synced
            device.deviceData.dataSource = 'synced';

            console.log(`💾 [SYNC RECORDS] ${deviceId}: Updated deviceData from latest record - Steps: ${device.deviceData.steps}, Temp: ${device.deviceData.temperature}°C, Total: ${totalSteps}`);
          }

          if (device.syncRecords.length > 1) {
            for (let i = 1; i < device.syncRecords.length; i++) {
              const prev = device.syncRecords[i - 1];
              const curr = device.syncRecords[i];
              const prevTs = this.getRecordedTimeSeconds(prev) ?? 0;
              const currTs = this.getRecordedTimeSeconds(curr) ?? 0;
              if (currTs < prevTs) {
                console.warn(`⚠️ [TIMESTAMP ORDER] ${deviceId}: Record ${i} has timestamp before record ${i - 1}`, {
                  prevTs,
                  currTs,
                  diff: prevTs - currTs
                });
              }
              const gap = currTs - prevTs;
              if (gap > 3600) {
                console.log(`ℹ️ [DATA GAP] ${deviceId}: Gap of ${Math.floor(gap / 3600)} hours between records`);
              }
            }
          }

          // Trigger UI updates with updated deviceData
          if (this.onDeviceDataUpdated && this.appState === 'active') {
            this.onDeviceDataUpdated(deviceId, device.deviceData);
          }
          if (this.onDeviceListUpdated) {
            this.onDeviceListUpdated();
          }
        }
        const syncState = this.dataSyncStates?.get(deviceId);
        // ✅ FIX: Use actual syncRecords length for totalReceived (more accurate than syncState)
        const totalReceived = device.syncRecords?.length || syncState?.recordsReceived || 0;
        // ✅ FIX: Prioritize syncState.expectedRecords (set at sync start) over totalRecords
        // This ensures consistent expected count throughout the sync
        const totalExpected = syncState?.expectedRecords ||
          syncState?.totalRecords ||
          this.syncExpectedRecords.get(deviceId) ||
          0;
        const recordsReceived = parsedTransfer.recordCount || 0;

        // ✅ FIX: Update syncState with actual received count
        if (syncState) {
          syncState.recordsReceived = totalReceived;
          syncState.lastActivity = Date.now();
        }

        // ✅ FIX: Deduplicate sync progress events to prevent duplicate emissions
        // Multiple native events can arrive for the same sync progress
        if (!this.lastSyncProgressEvents) {
          this.lastSyncProgressEvents = new Map();
        }

        const lastProgress = this.lastSyncProgressEvents.get(deviceId);
        const currentTime = Date.now();
        const shouldEmit = !lastProgress ||
          (currentTime - lastProgress.timestamp) > this.syncProgressDedupeWindow || // Throttle to max 10 events per second
          lastProgress.totalReceived !== totalReceived || // Different progress
          lastProgress.totalExpected !== totalExpected; // Different expected count

        if (shouldEmit) {
          this.lastSyncProgressEvents.set(deviceId, {
            timestamp: currentTime,
            totalReceived,
            totalExpected,
            recordsReceived
          });

          this.emit('deviceDataUpdate', {
            deviceId,
            type: 'sync_records',
            records: parsedTransfer.records,
            totalRecords: device.syncRecords.length,
            totalReceived,
            totalExpected,
            recordsReceived
          });
        } else {
          // Skip duplicate event (same progress within 100ms)
          console.log(`⏭️ [SYNC] Skipping duplicate sync progress event for ${deviceId} (${totalReceived}/${totalExpected})`);
        }
      }
    }
  }
  handlePushGeneratedRecord(deviceId, parsedTransfer) {
    // Live data only after history sync completes (Phase 3)
    if (this.connectionPhase?.get(deviceId) !== 'live') {
      return;
    }
    // Firmware v1.5: Process push-generated records as live data
    // These are automatic notifications sent at each data acquisition interval
    if (!parsedTransfer.records || parsedTransfer.records.length === 0) {
      return;
    }

    const device = this.getDevice(deviceId);
    if (!device) {
      console.warn(`⚠️ [PUSH-GENERATED RECORD] ${deviceId}: Device not found`);
      return;
    }

    parsedTransfer.records.forEach((record) => {
      // Validate record
      let recordTimestamp = null;
      if (typeof record.timestamp === 'number') {
        recordTimestamp = record.timestamp;
      } else if (record.timestampDate) {
        recordTimestamp = Math.floor(new Date(record.timestampDate).getTime() / 1000);
      }

      const MIN_VALID_TIMESTAMP = 1577836800;
      if (!recordTimestamp || recordTimestamp < MIN_VALID_TIMESTAMP) {
        console.warn(`⚠️ [PUSH-GENERATED RECORD] ${deviceId}: Invalid timestamp, skipping`);
        return;
      }

      // ✅ RECOMMENDED FLOW: Update lastRecordTimestamp from push-generated live record (no re-sync from this path)
      if (!this.autoSyncMeta) this.autoSyncMeta = new Map();
      const meta = this.autoSyncMeta.get(deviceId) || {};
      meta.lastRecordTimestamp = Math.max(meta.lastRecordTimestamp || 0, recordTimestamp);
      this.autoSyncMeta.set(deviceId, meta);

      // Add to live buffer
      this.addToLiveBuffer(deviceId, {
        timestamp: recordTimestamp,
        timestampDate: record.timestampDate ? new Date(record.timestampDate) : new Date(recordTimestamp * 1000),
        steps: record.steps || 0,
        temperature: record.temperature !== undefined && record.temperature !== null ? record.temperature : null,
        batteryLevel: device.deviceData?.batteryLevel || null
      });

      // Update device data with latest live record
      if (!device.deviceData) {
        device.deviceData = {};
      }

      // Update steps and temperature from live record
      if (record.steps !== undefined && record.steps !== null) {
        device.deviceData.steps = record.steps;
      }
      if (record.temperature !== undefined && record.temperature !== null) {
        device.deviceData.temperature = record.temperature;
      }
      device.deviceData.lastUpdate = new Date();
      device.deviceData.dataSource = 'live';

      // ✅ Log live data notification in connection logs (with deduplication)
      const now = Date.now();
      const lastLog = this.lastLiveDataLogTime.get(deviceId);
      const shouldLog = !lastLog ||
        (now - lastLog.time) >= this.liveDataLogDedupeWindow ||
        lastLog.recordTimestamp !== recordTimestamp;

      if (shouldLog) {
        this.lastLiveDataLogTime.set(deviceId, { time: now, recordTimestamp: recordTimestamp });
        this.addConnectionLog(deviceId, 'Live Data Received', {
          temperature: record.temperature,
          steps: record.steps,
          recordTimestamp: recordTimestamp,
          recordTimestampDate: record.timestampDate || new Date(recordTimestamp * 1000).toISOString(),
          source: 'push_notification',
          platform: Platform.OS
        });
      }

      // Emit live record event
      this.emit('deviceDataUpdate', {
        deviceId,
        type: 'live_record',
        deviceData: device.deviceData,
        record: {
          timestamp: recordTimestamp,
          timestampDate: record.timestampDate || new Date(recordTimestamp * 1000).toISOString(),
          steps: record.steps,
          temperature: record.temperature,
          flags: record.flags,
          source: 'push_generated'
        }
      });
    });

    // Update device in scanned devices
    this.scannedDevices.set(deviceId, device);

    // Trigger callbacks
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    }
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    }

    // Check if we should upload batch
    if (this.shouldUploadBatch(deviceId)) {
      this.uploadLiveBatch(deviceId).catch(error => {
        console.error(`❌ [PUSH-GENERATED RECORD] ${deviceId}: Failed to upload live batch:`, error);
      });
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
        expectedRecords: expectedRecords,
        lastActivity: Date.now()
      };
      this.dataSyncStates.set(deviceId, syncState);
    }
    if (parsedTransfer.recordCount) {
      syncState.recordsReceived = (syncState.recordsReceived || 0) + parsedTransfer.recordCount;
    }
    syncState.lastActivity = Date.now();
  }
  handleSystemCommandResponse(deviceId, data) {
    try {
      const response = BLEDataParser.parseSystemCommandResponse(data);
      const commandName = this.getCommandName(response?.command);
      if (this.pendingCommandResponses.has(deviceId)) {
        const deviceResponses = this.pendingCommandResponses.get(deviceId);
        const pendingResponse = deviceResponses.get(response?.command);
        if (pendingResponse) {
          clearTimeout(pendingResponse.timeout);
          if (pendingResponse.resolve) {
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
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START:
              break;
            case SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP:
              // Clear sync timeout and mark sync not active when STOP is acknowledged (BB 09 00 00).
              // Prevents SYNC_TIMEOUT firing 2 min later on both Android and iOS (e.g. empty sync or early stop).
              const syncTimeoutOnStop = this.syncTimeouts.get(deviceId);
              if (syncTimeoutOnStop) {
                clearTimeout(syncTimeoutOnStop);
                this.syncTimeouts.delete(deviceId);
              }
              const syncStateOnStop = this.dataSyncStates?.get(deviceId);
              if (syncStateOnStop) {
                syncStateOnStop.isActive = false;
              }
              const hasActiveSync = this.dataSyncStates?.get(deviceId)?.isActive === true;
              if (this.pendingFlashClearCommands && this.pendingFlashClearCommands.get(deviceId) && !hasActiveSync) {
                try {
                  const { clearDeviceRecords } = require('../../feature/historicalRecordsSlice/historicalRecordsSlice');
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
              // Track restart time for logging purposes
              if (!this.deviceRestartTimes) {
                this.deviceRestartTimes = new Map();
              }
              this.deviceRestartTimes.set(deviceId, Date.now());
              // SIMPLIFIED: Native handles RTC check after device reconnects
              // When device restarts and reconnects, native will:
              // 1. Enable notifications
              // 2. Read Device Status  
              // 3. Check RTC and send SET_TIME if needed
              // JS no longer needs to trigger time sync manually
              console.log(`🔄 [SYSTEM RESTART] ${deviceId}: Device restarting - native will handle RTC sync on reconnect`);
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
  async writeCharacteristic(deviceId, characteristicUUID, data, withResponse = true, serviceUUID = null) {
    try {
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
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_SYSTEM_TIME, timestampBytes, { waitForResponse: true });
      if (result.success) {
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
              this.addConnectionLog(deviceId, 'Time Sync: RTC Validation', {
                deviceTime: deviceTime,
                systemTime: systemTime,
                timeDifference: timeDiff,
                timeDifferenceSeconds: timeDiff,
                deviceTimeISO: parsedData.timestamp.toISOString(),
                systemTimeISO: new Date(systemTime * 1000).toISOString(),
                rtcValid: parsedData.rtcValid || false,
                syncSuccessful: timeDiff < 5
              });
            }
          }
        } catch (error) {
          this.addConnectionLog(deviceId, 'Time Sync: RTC Validation Failed', {
            error: error.message || 'Failed to read device status after time sync',
            systemTime: currentTime
          });
        }
      } else {
        this.addConnectionLog(deviceId, 'Time Sync: SET_TIME Command Failed', {
          systemTime: currentTime,
          success: false,
          error: result.error || 'Unknown error'
        });
      }
      return result;
    } catch (error) {
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
  async checkBondingStatus(deviceId) {
    try {
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        const isBonded = await SampleBridgeAndroid.isDeviceBonded(deviceId);
        return isBonded;
      } else if (Platform.OS === 'ios') {
        return false;
      }
      return false;
    } catch (error) {
      return false;
    }
  }
  async initiateSecurePairing(deviceId) {
    try {
      if (Platform.OS === 'android' && SampleBridgeAndroid) {
        const pairingResult = await SampleBridgeAndroid.initiateSecurePairing(deviceId);
        return { success: pairingResult, error: null };
      } else if (Platform.OS === 'ios') {
        return { success: false, error: 'iOS secure pairing not implemented' };
      }
      return { success: false, error: 'Platform not supported' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  /**
   * Returns all synced records for the device (full history from sync).
   */
  getSyncRecords(deviceId) {
    const device = this.getDevice(deviceId);
    if (device && device.syncRecords) {
      return device.syncRecords;
    }
    return [];
  }

  /**
   * Returns last-app record timestamp for display filtering (live/history).
   * Records with timestamp <= this are considered "already seen".
   */
  getLastAppRecordTimestamp(deviceId) {
    return (this.autoSyncMeta?.get(deviceId) || {}).lastRecordTimestamp || 0;
  }

  /**
   * Normalize record timestamp to Unix seconds for deduplication/comparison.
   * Handles number (seconds or ms), Date, and timestampDate string. Returns null if missing/invalid.
   */
  getRecordTimestampSeconds(record) {
    if (!record) return null;
    if (typeof record.timestamp === 'number') {
      return record.timestamp > 4102444800 ? Math.floor(record.timestamp / 1000) : record.timestamp;
    }
    if (record.timestamp instanceof Date) return Math.floor(record.timestamp.getTime() / 1000);
    if (record.timestampDate) {
      const ms = typeof record.timestampDate === 'string' ? new Date(record.timestampDate).getTime() : record.timestampDate.getTime();
      return isNaN(ms) ? null : Math.floor(ms / 1000);
    }
    return null;
  }

  /**
   * Recorded time only (device time when record was created). Never received/synced/adjusted time.
   * For dedupe we must use this so same recorded moment = duplicate; received/synced time is ignored.
   */
  getRecordedTimeSeconds(record) {
    if (!record) return null;
    if (record.originalTimestamp != null) return record.originalTimestamp;
    return this.getRecordTimestampSeconds(record);
  }

  /**
   * Deduplicate records by (recorded time, steps, temperature). Uses device recorded time only, not received/synced time.
   */
  deduplicateRecordsByTimeStepsTemp(records) {
    if (!records || records.length === 0) return [];
    const seen = new Set();
    return records.filter((r) => {
      const ts = this.getRecordedTimeSeconds(r);
      const steps = r.steps != null ? r.steps : 0;
      const temp = r.temperature != null ? r.temperature : 0;
      const key = `${ts ?? 'n'}_${steps}_${temp}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Returns all synced records for display, deduplicated by (timestamp, steps, temperature).
   */
  getSyncRecordsForDisplay(deviceId) {
    const all = this.getSyncRecords(deviceId);
    if (!all || all.length === 0) return [];
    return this.deduplicateRecordsByTimeStepsTemp(all);
  }
  getLatestSyncedRecord(deviceId) {
    const records = this.getSyncRecords(deviceId);
    if (!records || records.length === 0) {
      return null;
    }
    const latestRecord = records.reduce((latest, current) => {
      if (!latest) return current;
      const latestTime = this.getRecordedTimeSeconds(latest) ?? 0;
      const currentTime = this.getRecordedTimeSeconds(current) ?? 0;
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
    const syncJustCompleted = (() => {
      if (!this.autoSyncMeta) return false;
      const meta = this.autoSyncMeta.get(deviceId);
      if (!meta || !meta.lastSyncCompletedAt) return false;
      const timeSinceSync = Date.now() - meta.lastSyncCompletedAt;
      return timeSinceSync < 15000;
    })();
    const syncCompletedRecordCount = (() => {
      if (!this.autoSyncMeta) return undefined;
      const meta = this.autoSyncMeta.get(deviceId);
      return meta?.syncCompletedRecordCount;
    })();
    const totalSyncedCount = (device.syncRecords && device.syncRecords.length) || 0;
    this.emit('deviceDataUpdate', {
      deviceId,
      type: 'sync_complete',
      deviceData: device.deviceData,
      recordCount: device.deviceData.recordCount,
      totalRecords: totalSyncedCount,
      recordsTransmitted: totalSyncedCount,
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

  /**
   * Handle native ConnectionLog events (notifications enabled, etc.)
   * This processes connection-related logs sent from native Android code
   */
  handleNativeConnectionLog(eventData) {
    try {
      const { deviceId, action, ...additionalInfo } = eventData;

      if (!deviceId || !action) {
        console.warn('⚠️ [ConnectionLog] Missing deviceId or action:', eventData);
        return;
      }

      console.log(`📋 [ConnectionLog] ${action} for ${deviceId}`, additionalInfo);

      // Format characteristics array if present for better display
      if (additionalInfo.characteristics && Array.isArray(additionalInfo.characteristics)) {
        const charNames = additionalInfo.characteristics.map(c => c.name || c.uuid).join(', ');
        additionalInfo.characteristicNames = charNames;
      }

      // Add to connection logs using existing method
      this.addConnectionLog(deviceId, action, additionalInfo);

    } catch (error) {
      console.error('❌ [ConnectionLog] Error handling native event:', error, eventData);
    }
  }
  flushPendingCharacteristicsLogs(deviceId) {
    const pending = this.pendingCharacteristicsLogs.get(deviceId);
    if (pending && pending.length > 0) {
      const batchTimer = this.characteristicsLogBatchTimers.get(deviceId);
      if (batchTimer) {
        clearTimeout(batchTimer);
        this.characteristicsLogBatchTimers.delete(deviceId);
      }
      if (!this.lastCharacteristicsDiscoveryLog.has(deviceId)) {
        this.lastCharacteristicsDiscoveryLog.set(deviceId, new Map());
      }
      const deviceCharLogs = this.lastCharacteristicsDiscoveryLog.get(deviceId);
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
      pending.forEach(log => {
        deviceCharLogs.set(log.serviceUuid, {
          timestamp: log.timestamp,
          characteristicCount: log.characteristicCount,
          addedCount: log.addedCount
        });
      });
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
  async sendSystemCommandWithValidation(deviceId, command, payload = [], options = {}) {
    const commandName = this.getCommandName(command);
    const now = Date.now();
    if (!this.pendingCommands.has(deviceId)) {
      this.pendingCommands.set(deviceId, new Map());
    }
    const devicePendingCommands = this.pendingCommands.get(deviceId);
    const lastCommand = devicePendingCommands.get(command);
    if (lastCommand && (now - lastCommand.timestamp) < this.commandDedupeWindow) {
      console.log(`⏭️ [COMMAND DEDUP] ${deviceId}: Skipping duplicate ${commandName} command (sent ${now - lastCommand.timestamp}ms ago)`);
      this.addConnectionLog(deviceId, `Command Deduplicated: ${commandName}`, {
        reason: 'duplicate_within_window',
        timeSinceLastCommand: now - lastCommand.timestamp
      });
      return lastCommand.promise;
    }
    const inProgressCommand = this.commandInProgress.get(deviceId);
    if (inProgressCommand && inProgressCommand !== command) {
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
      return new Promise((resolve, reject) => {
        const checkQueue = () => {
          const currentInProgress = this.commandInProgress.get(deviceId);
          if (!currentInProgress || currentInProgress === command) {
            this.sendSystemCommandWithValidation(deviceId, command, payload, options)
              .then(resolve)
              .catch(reject);
          } else {
            setTimeout(checkQueue, 100);
          }
        };
        checkQueue();
      });
    }
    this.commandInProgress.set(deviceId, command);
    const commandPromise = this.sendSystemCommand(deviceId, command, payload, options)
      .then(async (result) => {
        if (options.waitForResponse !== false) {
          const responseKey = `${deviceId}_${command}`;
          const responsePromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Response timeout for ${commandName} after ${this.COMMAND_RESPONSE_TIMEOUT_MS}ms`));
            }, this.COMMAND_RESPONSE_TIMEOUT_MS);
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
          } catch (error) {
            console.warn(`⚠️ [RESPONSE VALIDATION] ${deviceId}: ${commandName} - ${error.message}`);
            this.addConnectionLog(deviceId, `Response Timeout: ${commandName}`, {
              error: error.message,
              commandId: command
            });
          }
        }
        return result;
      })
      .finally(() => {
        this.commandInProgress.delete(deviceId);
        setTimeout(() => {
          devicePendingCommands.delete(command);
        }, this.commandDedupeWindow);
        this.processCommandQueue(deviceId);
      });
    devicePendingCommands.set(command, {
      timestamp: now,
      promise: commandPromise
    });
    return commandPromise;
  }
  processCommandQueue(deviceId) {
    const queue = this.commandQueue.get(deviceId);
    if (!queue || queue.length === 0) {
      return;
    }
    const inProgress = this.commandInProgress.get(deviceId);
    if (inProgress) {
      return;
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
              // ✅ IMPROVEMENT 2: Mark as manual read - should not trigger auto-sync
              this.handleDeviceStatusUpdate(deviceId, value, { isManualRead: true });
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
  async getFirmwareVersion(deviceId) {
    try {
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_FW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
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
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION}`;
      this.systemCommandResponses?.delete(responseKey);
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_HW_VERSION, [0x00], { waitForResponse: true });
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
  async getDiagnostics(deviceId) {
    try {
      const responseKey = `${deviceId}_${SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS}`;
      this.systemCommandResponses?.delete(responseKey);
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.GET_DIAGNOSTICS, [0x00], { waitForResponse: true });
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
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_CONN_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Firmware v1.5: Determine device state from manufacturer data
   * Factory Default: factoryDefaults = true OR timeSet = false
   * Activated: factoryDefaults = false AND timeSet = true (has paired history)
   * 
   * @param {Object} manufacturerData - Parsed manufacturer data from advertisement
   * @returns {string} 'factory_default' | 'activated' | 'unknown'
   */
  getDeviceState(manufacturerData) {
    if (!manufacturerData) {
      return 'unknown';
    }

    const factoryDefaults = manufacturerData.factoryDefaults === true;
    const timeSet = manufacturerData.timeSet === true;

    // Firmware v1.5: Factory default if factoryDefaults flag is set OR time is not set
    if (factoryDefaults || !timeSet) {
      return 'factory_default';
    }

    // Activated device: has been configured (not factory defaults) and time is set
    if (!factoryDefaults && timeSet) {
      return 'activated';
    }

    return 'unknown';
  }

  /**
   * Firmware v1.5: Get optimized scan interval based on device state
   * Factory Default: 4s advertising → scan every 4.5s
   * Activated: 2s advertising → scan every 2.5s
   * 
   * @param {Object} manufacturerData - Parsed manufacturer data from advertisement
   * @returns {Object} { scanIntervalMs, scanWindowMs, advertisingIntervalMs, txPower }
   */
  getOptimizedScanParams(manufacturerData) {
    const deviceState = this.getDeviceState(manufacturerData);

    if (deviceState === 'factory_default') {
      return {
        ...FIRMWARE_V15_ADVERTISING.FACTORY_DEFAULT,
        deviceState: 'factory_default'
      };
    } else if (deviceState === 'activated') {
      return {
        ...FIRMWARE_V15_ADVERTISING.ACTIVATED,
        deviceState: 'activated'
      };
    }

    // Fallback to default if unknown
    return {
      scanIntervalMs: 3000,
      scanWindowMs: 1500,
      advertisingIntervalMs: 2000,
      txPower: 0,
      deviceState: 'unknown'
    };
  }

  /**
   * Firmware v1.5: Get optimized connection parameters
   * Connection interval: 320ms, Latency: 2, Timeout: 500s
   * 
   * @returns {Object} { connectionIntervalMs, connectionLatency, supervisionTimeoutMs }
   */
  getOptimizedConnectionParams() {
    return {
      connectionIntervalMs: FIRMWARE_V15_ADVERTISING.CONNECTION.intervalMs,
      connectionLatency: FIRMWARE_V15_ADVERTISING.CONNECTION.latency,
      supervisionTimeoutMs: FIRMWARE_V15_ADVERTISING.CONNECTION.supervisionTimeoutMs
    };
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
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SET_DATA_INTERVAL, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Start history sync – writes DATA_SYNC_START to Command/Control characteristic.
   *
   * GOLDEN RULE (industry practice – Fitbit, Garmin, Nordic):
   *   ONLY THIS PATH STARTS HISTORY SYNC. Nothing else.
   *
   * Does NOT start sync:
   *   - Enable notifications
   *   - Read device status (Status char is metadata only)
   *   - Live data on Data Transfer char (data-only, never initiates sync)
   *   - Sync ACKs / sync_complete / sync_start notifications
   *   - Reconnect (reconnect leads to Phase 1 Decide → at most one Start per connection)
   *
   * Characteristic usage by phase:
   *   Connect      → Command ❌  Data ❌  Status ❌
   *   Setup        → Command ❌  Data ❌  Status ✅ Read (record count, RTC, battery)
   *   History Sync → Command ✅ Start/Stop  Data ✅ History records  Status ❌
   *   Live Mode    → Command ❌  Data ✅ Live records  Status ❌
   *   Monitoring   → Command ❌  Data ❌  Status ✅ Read (battery, debug)
   */
  async startDataSync(deviceId) {
    try {
      // Industry flow: Phase 2 – history sync in progress; live data must be ignored until sync complete
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'history_sync');

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
      // Read device status before sync to get latest record count
      try {
        const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        if (deviceStatusData) {
          this.handleDeviceStatusUpdate(deviceId, deviceStatusData);
        }
      } catch (e) {
        this.addConnectionLog(deviceId, 'Sync: Device status read failed (using last known count)', { error: e?.message });
      }
      // Total records in tag = from device status (just read) or last known. If JS has 0, use native value on iOS.
      let expectedRecords = scannedDevice?.deviceData?.recordCount ?? 0;
      if (Platform.OS === 'ios' && BridgingCodeModule && (expectedRecords === 0 || expectedRecords === undefined)) {
        try {
          const nativeState = await BridgingCodeModule.getDataSyncState(deviceId);
          if (nativeState && typeof nativeState.expectedRecords === 'number') {
            expectedRecords = nativeState.expectedRecords;
          }
        } catch (_) { }
      }
      const RECORDS_PER_CHUNK = 500; // SDD: first chunk request = 500 (payload F4 01)
      this.addConnectionLog(deviceId, 'Decide: Start history sync', {
        totalInTag: expectedRecords,
        firstChunkRequest: RECORDS_PER_CHUNK,
        note: 'Total from device status; command payload = min(500, remaining) per SDD'
      });
      this.syncExpectedRecords.set(deviceId, expectedRecords);
      const existingTimeout = this.syncTimeouts.get(deviceId);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }
      const syncTimeout = setTimeout(() => {
        this.handleSyncTimeout(deviceId);
      }, this.SYNC_TIMEOUT_MS);
      this.syncTimeouts.set(deviceId, syncTimeout);
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
            totalRecords: expectedRecords,
            lastActivity: Date.now(),
            expectedRecords: expectedRecords
          });
          return result;
        } catch (error) {
          this.handleSyncError(deviceId, error);
          return { success: false, error: error.message || 'Failed to start data sync' };
        }
      }
      // iOS: Use native method (SDD v1.5 compliant - sends 2-byte record count)
      if (Platform.OS === 'ios' && BridgingCodeModule) {
        try {
          const result = await BridgingCodeModule.startDataSync(deviceId);
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
            totalRecords: expectedRecords,
            lastActivity: Date.now(),
            expectedRecords: expectedRecords
          });
          return result;
        } catch (error) {
          this.handleSyncError(deviceId, error);
          return { success: false, error: error.message || 'Failed to start data sync' };
        }
      }
      // Fallback: Use JavaScript path with SDD v1.5 compliant 2-byte payload
      // Firmware v1.5: Send 2-byte record count (500 = 0x01F4) instead of 1-byte 0x00
      const recordsToSync = 500;  // RECORDS_PER_FILE
      const syncPayload = [
        recordsToSync & 0xFF,           // LSB
        (recordsToSync >> 8) & 0xFF      // MSB
      ];
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START, syncPayload);
      if (!this.dataSyncStates) {
        this.dataSyncStates = new Map();
      }
      this.dataSyncStates.set(deviceId, {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: expectedRecords,
        lastActivity: Date.now(),
        expectedRecords: expectedRecords
      });
      return result;
    } catch (error) {
      this.handleSyncError(deviceId, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Manual Start Sync with a specific record count (for Device Commands / testing).
   * Sends DATA_SYNC_START with payload = [count LSB, count MSB]. Use 1–500 (0x01F4) per SDD.
   * @param {string} deviceId
   * @param {number} recordCount - number of records to request (1–500)
   * @returns {Promise<{ success: boolean, error?: string }>}
   */
  async startDataSyncWithRecordCount(deviceId, recordCount) {
    try {
      const count = Math.min(0x01F4, Math.max(1, Math.floor(Number(recordCount))));
      const syncState = this.dataSyncStates?.get(deviceId);
      if (syncState?.isActive) {
        return { success: false, error: 'Sync already in progress', status: 'already_syncing' };
      }
      if (!this.connectionPhase) this.connectionPhase = new Map();
      this.connectionPhase.set(deviceId, 'history_sync');
      this.syncExpectedRecords.set(deviceId, count);
      const existingTimeout = this.syncTimeouts.get(deviceId);
      if (existingTimeout) clearTimeout(existingTimeout);
      const syncTimeout = setTimeout(() => this.handleSyncTimeout(deviceId), this.SYNC_TIMEOUT_MS);
      this.syncTimeouts.set(deviceId, syncTimeout);
      if (!this.dataSyncStates) this.dataSyncStates = new Map();
      this.dataSyncStates.set(deviceId, {
        isActive: true,
        startTime: Date.now(),
        recordsReceived: 0,
        totalRecords: count,
        lastActivity: Date.now(),
        expectedRecords: count
      });
      const payload = [count & 0xFF, (count >> 8) & 0xFF];
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_START, payload);
      if (!result?.success && this.dataSyncStates) {
        this.dataSyncStates.set(deviceId, { ...this.dataSyncStates.get(deviceId), isActive: false });
      }
      return result;
    } catch (error) {
      this.handleSyncError(deviceId, error);
      return { success: false, error: error.message };
    }
  }

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
    this.logError(deviceId, 'SYNC_TIMEOUT', {
      expectedRecords,
      receivedRecords,
      timeoutMs: this.SYNC_TIMEOUT_MS
    });

    // 🔄 FORCE PHASE TRANSITION: Timeout -> transition to live mode to prevent stuck state
    if (!this.connectionPhase) this.connectionPhase = new Map();
    const currentPhase = this.connectionPhase.get(deviceId);
    if (currentPhase === 'history_sync') {
      this.connectionPhase.set(deviceId, 'live');
      console.log(`🔄 [PHASE TRANSITION] ${deviceId}: history_sync -> live (timeout fallback)`);
      console.log('   Sync incomplete but transitioning to live mode to prevent stuck state');
    }

    if (isIncomplete) {
      this.retryIncompleteSync(deviceId);
    } else {
      this.stopDataSync(deviceId, false).catch(() => { });
    }
  }
  async retryIncompleteSync(deviceId) {
    const retryCount = this.syncRetryAttempts.get(deviceId) || 0;

    // Look at the last sync state to understand how big this sync was supposed to be
    const syncState = this.dataSyncStates?.get(deviceId) || {};
    const expectedRecords = syncState.expectedRecords || 0;

    // 🔒 Industry guardrail:
    // For small histories (<= one chunk / file = 500 records) we NEVER restart sync
    // with a second DATA_SYNC_START. One START/STOP pair per small history session.
    if (expectedRecords > 0 && expectedRecords <= 500) {
      console.log(`⏹️ [SYNC RETRY] ${deviceId}: ExpectedRecords=${expectedRecords} (<=500). Skipping retry to avoid multiple DATA_SYNC_START for a small history.`);
      this.addConnectionLog(deviceId, 'Data Sync: No Retry For Small History', {
        expectedRecords,
        reason: 'single_START_per_small_history'
      });
      // Best-effort STOP to clean up device side, but no new START
      try {
        await this.stopDataSync(deviceId, false);
      } catch (e) {
        // Ignore STOP errors here; sync is already considered complete/abandoned
      }
      this.syncRetryAttempts.delete(deviceId);
      this.syncRetryDelays?.delete(deviceId);
      return;
    }

    if (retryCount >= this.MAX_SYNC_RETRIES) {
      console.error(`❌ [SYNC RETRY] ${deviceId}: Max retries (${this.MAX_SYNC_RETRIES}) reached`);
      this.addConnectionLog(deviceId, 'Data Sync: Max Retries Reached', {
        retryCount
      });
      this.syncRetryAttempts.delete(deviceId);
      this.syncRetryDelays.delete(deviceId);
      return;
    }
    const baseDelay = 1000;
    const delay = baseDelay * Math.pow(2, retryCount);
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
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.startDataSync(deviceId);
      } catch (error) {
        console.error(`❌ [SYNC RETRY] ${deviceId}: Retry failed:`, error);
        this.logError(deviceId, 'SYNC_RETRY_FAILED', { error: error.message });
      }
    }, delay);
  }
  handleSyncError(deviceId, error) {
    console.error(`❌ [SYNC ERROR] ${deviceId}:`, error);
    this.logError(deviceId, 'SYNC_ERROR', {
      error: error.message || 'Unknown error',
      errorType: error.name || 'Error'
    });
    const timeout = this.syncTimeouts.get(deviceId);
    if (timeout) {
      clearTimeout(timeout);
      this.syncTimeouts.delete(deviceId);
    }
    if (this.dataSyncStates) {
      const syncState = this.dataSyncStates.get(deviceId);
      if (syncState) {
        syncState.isActive = false;
        syncState.state = 'failed';
      }
    }
  }
  /**
   * Clear sync state and cancel timeouts when device disconnects.
   * Prevents SYNC_TIMEOUT and "Response Timeout: DATA_SYNC_STOP" from firing minutes later.
   */
  clearSyncStateOnDisconnect(deviceId) {
    if (!deviceId) return;
    const syncTimeout = this.syncTimeouts.get(deviceId);
    if (syncTimeout) {
      clearTimeout(syncTimeout);
      this.syncTimeouts.delete(deviceId);
    }
    this.dataSyncStates?.delete(deviceId);
    this.syncRetryAttempts?.delete(deviceId);
    this.syncRetryDelays?.delete(deviceId);
    const retryTimer = this.syncRetryTimers?.get(deviceId);
    if (retryTimer) {
      clearTimeout(retryTimer);
      this.syncRetryTimers.delete(deviceId);
    }
    const deviceResponses = this.pendingCommandResponses.get(deviceId);
    if (deviceResponses) {
      deviceResponses.forEach((handler) => {
        if (handler.timeout) clearTimeout(handler.timeout);
        if (typeof handler.reject === 'function') {
          try {
            handler.reject(new Error('Device disconnected'));
          } catch (_) { }
        }
      });
      this.pendingCommandResponses.delete(deviceId);
    }
  }
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
    if (errors.length > this.maxErrorHistory) {
      errors.shift();
    }
    this.addConnectionLog(deviceId, `Error: ${errorCode}`, {
      errorCode,
      ...context
    });
  }
  /**
   * Send DATA_SYNC_STOP. During chunked sync, native sends STOP(actualCount) per chunk from tag's 0x02.
   * This is for: user cancel (0), timeout (0), or post-sync when caller knows the count.
   * @param {string} deviceId
   * @param {boolean} clearFlashData - true = acknowledge records so tag can clear flash
   * @param {number} [recordsToAcknowledge] - optional: actual count from tag (0..500). When provided, used instead of 500/0 so tag only clears that many.
   */
  async stopDataSync(deviceId, clearFlashData = false, recordsToAcknowledge = undefined) {
    try {
      // Firmware v1.5: STOP payload = count of records tag sent in that chunk. Use actual count when known.
      let count = 0;
      if (recordsToAcknowledge !== undefined && recordsToAcknowledge !== null) {
        count = Math.min(0x01F4, Math.max(0, Math.floor(Number(recordsToAcknowledge))));
      } else {
        count = clearFlashData ? 500 : 0;  // fallback: 500 if cleared, 0 if cancel/failed
      }
      const payload = [
        count & 0xFF,           // LSB
        (count >> 8) & 0xFF    // MSB
      ];
      if (clearFlashData) {
        if (!this.pendingFlashClearCommands) {
          this.pendingFlashClearCommands = new Map();
        }
        this.pendingFlashClearCommands.set(deviceId, true);
      }
      const timeout = this.syncTimeouts.get(deviceId);
      if (timeout) {
        clearTimeout(timeout);
        this.syncTimeouts.delete(deviceId);
      }
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.DATA_SYNC_STOP, payload);
    } catch (error) {
      this.handleSyncError(deviceId, error);
      return { success: false, error: error.message };
    }
  }
  async systemRestart(deviceId) {
    try {
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.SYSTEM_RESTART, [0x00]);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async toggleBuzzer(deviceId, activate = true, beepCount = 0xFF) {
    try {
      let payload;
      if (activate) {
        const validBeepCount = beepCount === null || beepCount === undefined ? 0xFF : Math.min(Math.max(beepCount, 0), 0xFF);
        payload = [0x00, validBeepCount];
      } else {
        payload = [0x01, 0x00];
      }
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.TOGGLE_BUZZER, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async unpairDevice(deviceId) {
    try {
      this.manualDisconnectCooldown.set(deviceId, Date.now());
      const result = await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.UNPAIR_DEVICE, [0x00]);
      if (result.success) {
        if (Platform.OS === 'ios') {
          try {
            await AutoConnectService.stopAutoConnect();
          } catch (error) {
          }
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
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.FACTORY_RESET, [0x00]);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async updatePasskey(deviceId, passkey) {
    try {
      if (!passkey || typeof passkey !== 'string' || passkey.length !== 6) {
        return { success: false, error: 'Passkey must be exactly 6 digits (0-9)' };
      }
      if (!/^\d{6}$/.test(passkey)) {
        return { success: false, error: 'Passkey must contain only numeric digits (0-9)' };
      }
      const passkeyInt = parseInt(passkey, 10);
      if (passkeyInt > 999999) {
        return { success: false, error: 'Passkey out of range (max 999999)' };
      }
      const payload = [
        (passkeyInt >> 0) & 0xFF,
        (passkeyInt >> 8) & 0xFF,
        (passkeyInt >> 16) & 0xFF
      ];
      return await this.sendSystemCommandWithValidation(deviceId, SYSTEM_COMMAND_CONSTANTS.CMD.PASSKEY_UPDATE, payload);
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async forceReadDeviceData(deviceId) {
    try {
      const deviceStatusData = await this.readCharacteristic(deviceId, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
      if (deviceStatusData) {
        this.handleDeviceStatusUpdate(deviceId, deviceStatusData);
      }
      const batteryData = await this.readCharacteristic(deviceId, BLE_SERVICES.BATTERY, BLE_CHARACTERISTICS.BATTERY_LEVEL);
      if (batteryData) {
        this.handleBatteryUpdate(deviceId, batteryData);
      }
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
  getScannedDevices() {
    return Array.from(this.scannedDevices.values());
  }
  getAllDevices() {
    const verifiedDevices = Array.from(this.scannedDevices.values());
    const nearbyDevices = this.getNearbyTags();
    return {
      verified: verifiedDevices.filter(d => d.isVerified === true),
      nearby: nearbyDevices,
      all: [...verifiedDevices, ...nearbyDevices]
    };
  }
  getConnectedDevices() {
    return Array.from(this.scannedDevices.values()).filter(
      device => device.connectionState === CONNECTION_STATES.CONNECTED
    );
  }
  getDevice(deviceId) {
    const fromScanned = this.scannedDevices.get(deviceId);
    if (fromScanned) return fromScanned;
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
  isDeviceConnected(deviceId) {
    return this.connectedDevices.has(deviceId);
  }
  setDeviceDataUpdateCallback = (callback) => {
    this.onDeviceDataUpdated = callback;
  }
  setDeviceListUpdateCallback = (callback) => {
    if (callback === null || callback === undefined || typeof callback === 'function') {
      this.onDeviceListUpdated = callback;
    } else {
      console.warn('setDeviceListUpdateCallback: callback must be a function, null, or undefined');
      this.onDeviceListUpdated = null;
    }
    if (callback && typeof callback === 'function') {
      if (Platform.OS === 'ios' && this.pendingAutoConnectDevice) {
        setTimeout(() => {
          try {
            if (this.onDeviceListUpdated && typeof this.onDeviceListUpdated === 'function') {
              this.onDeviceListUpdated();
            }
          } catch (error) {
            console.warn('Error calling onDeviceListUpdated callback:', error);
          }
        }, 500);
        this.pendingAutoConnectDevice = null;
      }
      if (Platform.OS === 'android') {
        setTimeout(() => this.refreshAndroidSystemConnectedDevices(), 300);
      }
    }
  }
  triggerDeviceDataRefresh = (deviceId) => {
    const device = this.scannedDevices.get(deviceId);
    if (device && this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceId, device.deviceData);
    } else if (device && this.onDeviceDataUpdated && this.appState !== 'active') {
    }
  }
  startRSSIPolling(deviceId) {
    // ✅ DISABLED: RSSI polling moved to native side only
    // Native iOS: performHealthChecks() calls peripheral.readRSSI() every 30s
    // Native Android: performHealthChecks() calls gatt.readRemoteRssi() every 30s
    // JS receives updates via RSSIUpdate event handlers
    // This prevents duplicate RSSI reads that were causing multiple log entries
    console.log(`📶 [RSSI] ${deviceId}: Native-side RSSI monitoring is active (JS polling disabled)`);
  }
  startDeviceStatusPollingFallback(deviceId, intervalSeconds) {
    console.log(`ℹ️ [NEW FLOW] ${deviceId}: Using notification-based updates (no polling)`);
    console.log(`   Tags automatically send notifications when data is available`);
    console.log(`   Auto-sync triggers on notification receipt`);
    return;
  }
  stopDeviceStatusPollingFallback(deviceId) {
    console.log(`ℹ️ [NEW FLOW] ${deviceId}: Notification-based updates (no polling cleanup needed)`);
  }
  stopRSSIPolling(deviceId) {
    // ✅ No-op: JS RSSI polling is disabled, native handles RSSI monitoring
    // Kept for API compatibility
  }
  getDeviceDataFresh = (deviceId) => {
    const device = this.scannedDevices.get(deviceId);
    if (device) {
      return {
        ...device,
        deviceData: { ...device.deviceData },
        manufacturerData: device.manufacturerData ? { ...device.manufacturerData } : device.manufacturerData
      };
    }
    return null;
  }
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
  isAutoConnectEnabled() {
    if (Platform.OS === 'android') return Boolean(this.androidAutoConnectEnabled);
    return AutoConnectService && AutoConnectService.isEnabled;
  }
  setupAutoConnectCallbacks() {
    // =========================================================================
    // REMOVED: Duplicate callback registration
    // =========================================================================
    // Previously registered AutoConnectService callbacks here for iOS, but
    // BLEService already has direct listeners for AutoConnectDeviceConnected
    // and AutoConnectDeviceDisconnected events (lines 291-296, 391-396).
    // This was causing handleAutoConnectedDevice/Disconnected to be called TWICE.
    // Now relying only on BLEService's direct event listeners.
    // =========================================================================
  }
  handleAutoConnectedDevice = async (deviceInfo) => {
    if (Platform.OS === 'android') return; // Android: manual connection only
    // State sync from app resume (e.g. refreshAndroidSystemConnectedDevices): device already in connectedDevices.
    // Skip "Auto-connected" log and deviceConnected emit so UI doesn't show duplicate "auto connected" / "get new data".
    const alreadyConnected = this.connectedDevices.has(deviceInfo.deviceId);
    if (alreadyConnected) {
      const existing = this.connectedDevices.get(deviceInfo.deviceId);
      if (existing) {
        if (deviceInfo.deviceName != null) existing.name = deviceInfo.deviceName;
        if (deviceInfo.rssi != null) existing.rssi = deviceInfo.rssi;
      }
      if (this.onDeviceListUpdated) this.onDeviceListUpdated();
      return;
    }
    const currentlyConnectedDevices = Array.from(this.connectedDevices.keys()).filter(
      connectedId => connectedId !== deviceInfo.deviceId && this.isDeviceConnected(connectedId)
    );
    if (currentlyConnectedDevices.length > 0) {
      console.log(`🔌 [AUTO-CONNECT] Enforcing single-connection limit: Disconnecting ${currentlyConnectedDevices.length} other device(s) before auto-connecting ${deviceInfo.deviceId}`);
      console.log(`   📋 Devices to disconnect: ${currentlyConnectedDevices.join(', ')}`);
      const disconnectPromises = currentlyConnectedDevices.map(async (otherDeviceId) => {
        try {
          console.log(`   🔌 Disconnecting device: ${otherDeviceId}`);
          await this.disconnectFromDevice(otherDeviceId);
          console.log(`   ✅ Successfully disconnected: ${otherDeviceId}`);
        } catch (error) {
          console.warn(`   ⚠️ Failed to disconnect ${otherDeviceId}:`, error.message);
        }
      });
      try {
        await Promise.race([
          Promise.all(disconnectPromises),
          new Promise((resolve) => setTimeout(resolve, 5000))
        ]);
        console.log(`✅ [AUTO-CONNECT] All other devices disconnected, proceeding with auto-connection to ${deviceInfo.deviceId}`);
      } catch (error) {
        console.warn(`⚠️ [AUTO-CONNECT] Error during disconnect of other devices:`, error.message);
      }
    }
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
      isVerified: true,
      rssi: deviceInfo.rssi || null
    };
    this.scannedDevices.set(deviceInfo.deviceId, device);
    this.connectedDevices.set(deviceInfo.deviceId, device);
    this.healthCheckFailures.delete(deviceInfo.deviceId);
    // Auto-connect follows same "decide → history_sync → live" flow; phase stays undefined until device status read runs
    try {
      await this.loadDeviceServices(deviceInfo.deviceId);
      this.startHeartbeatMonitoring(deviceInfo.deviceId);
      setTimeout(() => {
        if (this.isDeviceConnected(deviceInfo.deviceId)) {
          this.startMonitoring(deviceInfo.deviceId);
        }
      }, 2000);
    } catch (error) {
    }
    // Decide (history_sync vs live) is driven by native: native reads device status and sends to JS → handleDeviceStatusUpdate → maybeTriggerAutoSyncFromDeviceStatus → startDataSync. No JS-side trigger needed.
    setTimeout(() => {
      this.startGetApiCalling(deviceInfo.deviceId);
    }, 8000);
    this.startRSSIPolling(deviceInfo.deviceId);
    this.startConnectionHealthCheck();
    if (this.onDeviceListUpdated) {
      this.onDeviceListUpdated();
    } else {
      this.pendingAutoConnectDevice = deviceInfo;
    }
    setTimeout(() => {
      if (this.onDeviceListUpdated) {
        this.onDeviceListUpdated();
      }
    }, 3000);
    if (this.onDeviceDataUpdated && this.appState === 'active') {
      this.onDeviceDataUpdated(deviceInfo.deviceId, device);
    } else if (this.onDeviceDataUpdated && this.appState !== 'active') {
    }
    this.emit('deviceConnected', {
      deviceId: deviceInfo.deviceId,
      deviceName: deviceInfo.deviceName,
      connectionType: 'auto',
      platform: Platform.OS
    });
    this.addConnectionLog(deviceInfo.deviceId, 'Auto-connected', {
      connectionType: 'auto',
      platform: Platform.OS
    });
    this.recentAutoConnects.set(deviceInfo.deviceId, Date.now());
    const pending = this.pendingConnectedLogTimers.get(deviceInfo.deviceId);
    if (pending) {
      clearTimeout(pending);
      this.pendingConnectedLogTimers.delete(deviceInfo.deviceId);
    }
    // Cold start / app reopen: native may not re-send device status (connection was already up).
    // Fallback: after a short delay, if phase is still unknown, read device status so decide flow runs.
    const deviceIdForFallback = deviceInfo.deviceId;
    const AUTO_CONNECT_STABILIZE_MS = 2500;
    setTimeout(async () => {
      if (!this.isDeviceConnected(deviceIdForFallback)) return;
      const phase = this.connectionPhase?.get(deviceIdForFallback);
      if (phase && phase !== 'unknown') return;
      try {
        const data = await this.readCharacteristic(deviceIdForFallback, BLE_SERVICES.SMART_TAG, BLE_CHARACTERISTICS.DEVICE_STATUS);
        if (data) {
          this.handleDeviceStatusUpdate(deviceIdForFallback, data, { isFromColdStartRefresh: true });
        }
      } catch (e) {
        // Phase stays unknown; sync may start later from native or user action
      }
    }, AUTO_CONNECT_STABILIZE_MS);
  }
  handleAutoDisconnectedDevice = (deviceInfo) => {
    if (Platform.OS === 'android') return; // Android: manual connection only
    const deviceId = deviceInfo.deviceId;
    const now = Date.now();
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
    if (now < debounceState.blockedUntil) {
      const remainingBlockTime = Math.ceil((debounceState.blockedUntil - now) / 1000);
      console.warn(`🚫 [CONNECTION DEBOUNCE] ${deviceId}: Blocked from reconnecting for ${remainingBlockTime}s (too many disconnects)`);
      this.addConnectionLog(deviceId, 'Disconnected (Reconnection Blocked)', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
        blockedUntil: new Date(debounceState.blockedUntil).toISOString(),
        disconnectCount: debounceState.disconnectCount
      });
      return;
    }
    const timeSinceLastDisconnect = now - debounceState.lastDisconnectTime;
    if (timeSinceLastDisconnect < this.CONNECTION_DEBOUNCE_WINDOW_MS) {
      debounceState.disconnectCount++;
    } else {
      debounceState.disconnectCount = 1;
    }
    debounceState.lastDisconnectTime = now;
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
      device.lastSeen = Date.now();
      device.disconnectReason = deviceInfo.error || deviceInfo.reason || 'Physical disconnect';
      this.scannedDevices.set(deviceInfo.deviceId, device);
      this.connectedDevices.delete(deviceInfo.deviceId);
      this.stopMonitoring(deviceInfo.deviceId);
      if (this.connectedDevices.size === 0) {
        this.stopConnectionHealthCheck();
      }
      this.emit('deviceDisconnected', {
        ...device,
        id: device.id || deviceInfo.deviceId,
        deviceId: deviceInfo.deviceId,
        reason: deviceInfo.error || deviceInfo.reason || 'disconnected',
        error: deviceInfo.error
      });
      this.addConnectionLog(deviceInfo.deviceId, 'Disconnected', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
        errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
        error: deviceInfo.error || null
      });
      if (deviceInfo.error || deviceInfo.reason) {
        this.logError(deviceInfo.deviceId, 'DISCONNECTION', {
          reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect',
          errorCode: deviceInfo.errorCode || 'NO_ERROR_CODE',
          error: deviceInfo.error || null
        });
      }
    } else {
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
      this.connectedDevices.delete(deviceInfo.deviceId);
      this.emit('deviceDisconnected', {
        ...newDevice,
        deviceId: deviceInfo.deviceId,
        reason: deviceInfo.error || deviceInfo.reason || 'disconnected',
        error: deviceInfo.error
      });
      this.addConnectionLog(deviceInfo.deviceId, 'Disconnected', {
        reason: deviceInfo.error || deviceInfo.reason || 'Physical disconnect'
      });
    }
    this.scheduleListUpdate();
    if (!debounceState.isDebouncing && now >= debounceState.blockedUntil) {
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
  startConnectionHealthCheck() {
    if (this.connectionHealthTimer) return;
    const currentProfile = this.getCurrentProfileName();
    const interval = this.profile.healthCheckMs || 10000;
    this.connectionHealthTimer = setInterval(async () => {
      try {
        await this.checkConnectionHealth();
      } catch (error) {
      }
    }, interval);
    // RSSI monitoring is handled by native health checks only - no JS RSSI cycle needed
    console.log('📶 [HEALTH CHECK] Started JS health check timer (RSSI handled by native)');
  }
  stopConnectionHealthCheck() {
    if (this.connectionHealthTimer) {
      clearInterval(this.connectionHealthTimer);
      this.connectionHealthTimer = null;
      const currentProfile = this.getCurrentProfileName();
    }
    // No JS RSSI cycle to stop - native handles RSSI monitoring
  }
  async checkConnectionHealth() {
    // Native side handles health checks with RSSI monitoring and failure detection for all devices
    const connectedDeviceIds = Array.from(this.connectedDevices.keys());
    if (connectedDeviceIds.length === 0) return;
    for (const deviceId of connectedDeviceIds) {
      // No JS-side health check; native handles RSSI and disconnection
    }
  }
  async startAutoConnect() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.startAutoConnect();
        return result.success ? { success: true, message: 'Auto-connect started' } : { success: false, error: result.error };
      }
      await SampleBridgeAndroid.startAutoConnect();
      this.androidAutoConnectEnabled = true;
      return { success: true, message: 'Auto-connect started' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async stopAutoConnect() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.stopAutoConnect();
        return result.success ? { success: true, message: 'Auto-connect stopped' } : { success: false, error: result.error };
      }
      await SampleBridgeAndroid.stopAutoConnect();
      this.androidAutoConnectEnabled = false;
      return { success: true, message: 'Auto-connect stopped' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async addDeviceToBondedList(deviceId) {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.addBondedDevice(deviceId);
        return result.success ? { success: true, message: 'Device bonded for auto-connect' } : { success: false, error: result.error };
      }
      await SampleBridgeAndroid.addBondedDevice(deviceId);
      return { success: true, message: 'Device bonded' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async removeDeviceFromBondedList(deviceId) {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.removeBondedDevice(deviceId);
        return result.success ? { success: true, message: 'Device unbonded from auto-connect' } : { success: false, error: result.error };
      }
      await SampleBridgeAndroid.removeBondedDevice(deviceId);
      return { success: true, message: 'Device unbonded' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async getBondedDevices() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.getBondedDevices();
        return result.success ? { success: true, devices: result.devices } : { success: false, error: result.error };
      }
      const result = await SampleBridgeAndroid.getBondedDevices();
      const devices = result?.bondedDevices ?? result?.devices ?? [];
      return { success: true, devices };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async getAutoConnectStatus() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.getAutoConnectStatus();
        return result.success ? { success: true, status: result.status } : { success: false, error: result.error };
      }
      const status = await SampleBridgeAndroid.getAutoConnectStatus();
      this.androidAutoConnectEnabled = Boolean(status?.enabled);
      return { success: true, status: status || { enabled: false } };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async isDeviceBonded(deviceId) {
    if (Platform.OS === 'ios') {
      return AutoConnectService.isDeviceBonded(deviceId);
    }
    try {
      const result = await SampleBridgeAndroid.getBondedDevices();
      const list = result?.bondedDevices ?? result?.devices ?? [];
      return Array.isArray(list) && list.includes(deviceId);
    } catch {
      return false;
    }
  }
  markDeviceKnown(deviceId) {
    try { this.knownDeviceIds.add(deviceId); } catch { }
  }
  async forceScanForBondedDevices() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.forceScanForBondedDevices();
        return result.success ? { success: true, message: 'Force scan started - check logs for 10 seconds' } : { success: false, error: result.error };
      }
      await SampleBridgeAndroid.startScanning();
      return { success: true, message: 'Force scan started - check logs for 10 seconds' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async forceRefreshDeviceList() {
    try {
      await this.startScanning();
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
  classifyError(error) {
    if (!error) return ERROR_TYPES.TRANSIENT;
    const errorCode = error.code || '';
    const errorMessage = (error.message || '').toLowerCase();
    if (errorCode.includes('TIMEOUT') ||
      errorCode.includes('CONNECTION_ERROR') ||
      errorMessage.includes('timeout') ||
      errorMessage.includes('temporary') ||
      errorMessage.includes('connection failed') ||
      errorCode === 'OPERATION_TIMEOUT' ||
      errorCode === 'DEVICE_CONNECTION_FAILED') {
      return ERROR_TYPES.TRANSIENT;
    }
    if (errorCode.includes('NOT_FOUND') ||
      errorCode.includes('INVALID') ||
      errorMessage.includes('not found') ||
      errorMessage.includes('invalid') ||
      errorCode === 'DEVICE_NOT_FOUND' ||
      errorCode === 'INVALID_IDENTIFIERS') {
      return ERROR_TYPES.PERMANENT;
    }
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
    const queueItem = { priority, timestamp: Date.now() };
    pool.queue.push(queueItem);
    pool.queue.sort((a, b) => {
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (a.priority === 'low' && b.priority !== 'low') return 1;
      return a.timestamp - b.timestamp;
    });
    this.connectionPool.set(deviceId, pool);
    return false;
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
    // ✅ DISABLED: Heartbeat monitoring moved to native side only
    // Native health checks already monitor connection health via RSSI reads every 30s
    // Native handles disconnection detection after 3 consecutive failures
    // This prevents duplicate RSSI reads that were causing multiple log entries
    // 
    // Native iOS: performHealthChecks() + handleHealthCheckFailure()
    // Native Android: performHealthChecks() + handleHealthCheckFailure()
    console.log(`💓 [HEARTBEAT] ${deviceId}: Native-side health monitoring is active (JS heartbeat disabled)`);
  }
  stopHeartbeatMonitoring(deviceId) {
    // ✅ No-op: JS heartbeat monitoring is disabled, native handles health checks
    // Kept for API compatibility
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
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.debugConnectionStatus();
        return result.success ? { success: true, data: result.result } : { success: false, error: result.error };
      }
      const result = await SampleBridgeAndroid.getResourceStatus();
      return { success: true, data: result };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  async connectToKnownPeripherals() {
    try {
      if (Platform.OS === 'ios') {
        const result = await AutoConnectService.connectToKnownPeripherals();
        return result.success
          ? { success: true, message: `Started ${result.result?.attempted ?? 0} connection attempts to known peripherals`, attempted: result.result?.attempted ?? 0, knownPeripherals: result.result?.knownPeripherals }
          : { success: false, error: result.error };
      }
      return { success: true, message: 'Manual connection only', attempted: 0, knownPeripherals: [] };
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
    // Firmware v1.5: Use adaptive scan interval based on device states
    // Check if we have activated devices (2s advertising) vs factory default (4s advertising)
    let scanInterval = 30000; // Default 30s fallback
    const hasActivatedDevices = Array.from(this.scannedDevices.values()).some(
      device => device.deviceState === 'activated'
    );
    const hasFactoryDevices = Array.from(this.scannedDevices.values()).some(
      device => device.deviceState === 'factory_default'
    );

    // Optimize scan interval: if we have activated devices, scan more frequently
    if (hasActivatedDevices && !hasFactoryDevices) {
      scanInterval = 2500; // Scan every 2.5s for activated devices (2s advertising)
    } else if (hasFactoryDevices && !hasActivatedDevices) {
      scanInterval = 4500; // Scan every 4.5s for factory default devices (4s advertising)
    } else if (hasActivatedDevices && hasFactoryDevices) {
      scanInterval = 2500; // Prefer faster scanning if mixed (prioritize activated devices)
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
    }, scanInterval);
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
    if (normalizedUUID === BLE_SERVICES.BATTERY.toLowerCase()) {
      return 'BATTERY_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.DEVICE_INFO.toLowerCase()) {
      return 'DEVICE_INFO_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.GENERIC_ACCESS.toLowerCase()) {
      return 'GENERIC_ACCESS_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.SMART_TAG.toLowerCase()) {
      return 'SMART_TAG_SERVICE';
    } else if (normalizedUUID === BLE_SERVICES.SMP_SERVICE.toLowerCase()) {
      return 'SMP_SERVICE';
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
      let commandHex = '';
      const requestId = SYSTEM_COMMAND_CONSTANTS.REQUEST_ID;
      const actualPayloadLength = payloadLength || 0;
      commandHex = `${requestId.toString(16).padStart(2, '0').toUpperCase()} `;
      commandHex += `${commandId.toString(16).padStart(2, '0').toUpperCase()} `;
      commandHex += `${actualPayloadLength.toString(16).padStart(2, '0').toUpperCase()}`;
      if (payload && payload !== 'No payload' && actualPayloadLength > 0) {
        const payloadBytes = payload.split(/\s+/).filter(byte => byte.trim()).map(byte => {
          const hexValue = byte.replace(/0x/gi, '').trim();
          return hexValue.padStart(2, '0');
        }).filter(hex => /^[0-9a-fA-F]{1,2}$/i.test(hex));
        if (payloadBytes.length > 0) {
          commandHex += ' ' + payloadBytes.join(' ').toUpperCase();
        }
      }
      const now = Date.now();
      if (!this.lastCommandResponseLogs.has(deviceId)) {
        this.lastCommandResponseLogs.set(deviceId, new Map());
      }
      const deviceCmdLogs = this.lastCommandResponseLogs.get(deviceId);
      const lastCmdLog = deviceCmdLogs.get(`cmd_${commandId}_${commandHex}`);
      const shouldLogCmd = !lastCmdLog || (now - lastCmdLog.timestamp) > 100;
      if (shouldLogCmd) {
        const logData = {
          commandId: `0x${commandId.toString(16).padStart(2, '0')}`,
          commandName: commandName,
          payload: payload || 'No payload',
          payloadLength: actualPayloadLength,
          commandHex: commandHex,
          source: 'native'
        };
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
   * Handle RTC Read event from native
   * 
   * SIMPLIFIED (SDD v1.5): Native handles all RTC-related operations:
   * - Read Device Status → Check RTC → Send SET_TIME if needed
   * 
   * JS only logs the RTC read event for connection logs UI.
   * NO action taken - native handles everything.
   */
  handleRTCRead(eventData) {
    try {
      const { deviceId, deviceRTC, deviceRTCISO, systemTime, systemTimeISO, timeDifference, rtcValid, timeDifferenceFormatted } = eventData;
      if (!deviceId) {
        return;
      }
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
        source: 'native',
        note: rtcValid ? 'RTC valid - no action needed' : 'RTC invalid - native will send SET_TIME'
      });
    } catch (error) {
      console.error('Error handling RTC read event:', error);
    }
  }

  /**
   * ✅ NEW FLOW: Handle Device Status manual read event from native
   * 
   * This is the ONLY event that drives history sync decision.
   * Device Status notifications are ONLY for metadata updates (battery, record count changes).
   * 
   * Flow:
   * 1. Native reads Device Status manually after SET_TIME
   * 2. Native checks recordCount
   * 3. If recordCount > 0: Start history sync immediately
   * 4. If recordCount == 0: Skip history sync, enter live mode
   * 
   * This eliminates the 52-second delay in auto-connect flow.
   */
  handleDeviceStatusManualRead = async (eventData) => {
    try {
      const { deviceId, type, recordCount, shouldStartHistorySync, trigger } = eventData;
      if (!deviceId) {
        console.warn('⚠️ [DEVICE STATUS READ] No deviceId in event data');
        return;
      }
      console.log(`📖 [DEVICE STATUS MANUAL READ] ${deviceId}:`, {
        type,
        recordCount,
        shouldStartHistorySync,
        trigger
      });
      const device = this.scannedDevices.get(deviceId);
      if (!device) {
        console.warn(`⚠️ [DEVICE STATUS READ] Device not found: ${deviceId}`);
        return;
      }
      // Use same decide method as auto-connect (single code path)
      await this.runDecideFlowFromDeviceStatus(deviceId, { recordCount: recordCount ?? 0 }, { trigger: trigger || 'manual_read' });
    } catch (error) {
      console.error('❌ [DEVICE STATUS MANUAL READ] Error:', error);
    }
  };

  /**
   * Single method for "decide" step: history_sync (recordCount > 0) or live (recordCount === 0).
   * Used by manual connect (handleDeviceStatusManualRead). Auto-connect uses native device status → handleDeviceStatusUpdate → maybeTriggerAutoSyncFromDeviceStatus → startDataSync.
   */
  runDecideFlowFromDeviceStatus = async (deviceId, parsedData, options = {}) => {
    if (!deviceId || !parsedData) return;
    const recordCount = typeof parsedData.recordCount === 'number' ? parsedData.recordCount : -1;
    const trigger = options.trigger || 'auto_connect';
    const isManual = trigger === 'manual_read' || trigger === 'manual';
    const triggerLabel = isManual ? 'manual read' : 'auto-connect';
    const note = isManual ? 'Manual Device Status read after SET_TIME' : 'Device status read after auto-connect';
    if (!this.connectionPhase) this.connectionPhase = new Map();
    if (recordCount > 0) {
      this.connectionPhase.set(deviceId, 'history_sync');
      this.addConnectionLog(deviceId, `Decide: Start history sync (${triggerLabel})`, {
        recordCount,
        note,
        trigger
      });
      try {
        await this.startDataSync(deviceId);
        console.log(`✅ [HISTORY SYNC] Started for ${deviceId}`);
      } catch (error) {
        console.error(`❌ [HISTORY SYNC] Failed to start for ${deviceId}:`, error);
        this.connectionPhase.set(deviceId, 'live');
        this.addConnectionLog(deviceId, 'History sync failed - entering live mode', { error: error.message });
      }
    } else {
      this.connectionPhase.set(deviceId, 'live');
      this.addConnectionLog(deviceId, `Decide: Skip history sync - no records (${triggerLabel})`, {
        recordCount: 0,
        note: isManual ? 'Manual Device Status read after SET_TIME - no records' : `${note} - no records`,
        trigger
      });
      this.emit('syncSkipped', { deviceId, reason: 'no_records', recordCount: 0 });
    }
  };

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
        const responseCommandId = response?.command || commandId;
        const responseCommandName = commandName || this.getCommandName(responseCommandId);
        const successStatus = (response?.success !== undefined) ? response.success : (status === 'success' || responseStatus === 0x00);
        const now = Date.now();
        if (!this.lastCommandResponseLogs.has(deviceId)) {
          this.lastCommandResponseLogs.set(deviceId, new Map());
        }
        const deviceRespLogs = this.lastCommandResponseLogs.get(deviceId);
        const lastRespLog = deviceRespLogs.get(`resp_${responseCommandId}_${formattedResponseHex}`);
        const shouldLogResp = !lastRespLog || (now - lastRespLog.timestamp) > 100;
        if (shouldLogResp) {
          this.addConnectionLog(deviceId, `Response: ${responseCommandName}`, {
            commandId: `0x${responseCommandId.toString(16).padStart(2, '0')}`,
            commandName: responseCommandName,
            responseHex: formattedResponseHex,
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
        const device = this.scannedDevices.get(deviceId);
        if (device) {
          device.deviceData = device.deviceData || {};
          device.deviceData.manufacturerRecordCount = recordCount || 0;
          device.deviceData.manufacturerCompanyId = companyId;
          device.deviceData.manufacturerRawData = rawData;
          device.deviceData.lastManufacturerUpdate = Date.now();
          if (eventData.batteryLevel !== undefined && eventData.batteryLevel !== null) {
            device.deviceData.batteryLevel = eventData.batteryLevel;
            device.deviceData.batteryMillivolts = eventData.batteryMillivolts || null;
          }
          this.emit('deviceDataUpdated', {
            deviceId,
            deviceData: device.deviceData
          });
        }
        break;
      case 'sync_start': {
        const parsedSyncStart = {
          totalRecords: totalRecords || 0,
          corrupted: false
        };
        this.handleSyncStart(deviceId, parsedSyncStart);
        this.emit('dataTransfer', {
          deviceId,
          type: 'sync_start',
          totalRecords,
          payloadLength: eventData.payloadLength,
          rawPayload: eventData.rawPayload,
          success: true
        });
        break;
      }
      case 'chunk_complete':
        // Multi-chunk sync: native sent one chunk done (e.g. 500/1500). Update sync state so final sync_complete has correct received count.
        if (eventData.grandTotal != null && this.dataSyncStates) {
          const state = this.dataSyncStates.get(deviceId);
          if (state) {
            state.recordsReceived = eventData.grandTotal;
            state.lastActivity = Date.now();
          }
        }
        // Reset sync timeout so next chunk gets a full SYNC_TIMEOUT_MS (avoids 2nd/3rd chunk timing out)
        const chunkTimeout = this.syncTimeouts.get(deviceId);
        if (chunkTimeout) {
          clearTimeout(chunkTimeout);
          this.syncTimeouts.delete(deviceId);
        }
        const chunkTimer = setTimeout(() => {
          this.handleSyncTimeout(deviceId);
        }, this.SYNC_TIMEOUT_MS);
        this.syncTimeouts.set(deviceId, chunkTimer);
        break;
      case 'sync_complete': {
        const grandTotal = eventData.grandTotal;
        const totalExpected = eventData.totalExpected;
        const hasMoreChunks = eventData.hasMoreChunks;
        const parsedTransfer = {
          type: 'sync_complete',
          typeString: 'sync_complete',
          success: success,
          recordsTransmitted: recordsTransmitted || 0,
          grandTotal: grandTotal,
          totalExpected: totalExpected,
          hasMoreChunks: hasMoreChunks,
          timestamp: new Date()
        };
        console.log('✅ [SYNC COMPLETE] Data sync completed for', deviceId, {
          success,
          recordsTransmitted: recordsTransmitted || 0,
          grandTotal,
          totalExpected,
          hasMoreChunks,
          timestamp: new Date().toISOString()
        });

        // 🔒 PHASE TRANSITION VALIDATION: Ensure we transition to live mode
        const currentPhase = this.connectionPhase?.get(deviceId);

        if (success && !hasMoreChunks) {
          // ✅ FORCE PHASE TRANSITION: History complete -> live mode
          if (!this.connectionPhase) this.connectionPhase = new Map();
          this.connectionPhase.set(deviceId, 'live');
          console.log(`🔄 [PHASE TRANSITION] ${deviceId}: history_sync -> live (sync complete)`);

          // Validate completion
          if (grandTotal < totalExpected) {
            const missing = totalExpected - grandTotal;
            console.warn(`⚠️ [SYNC INCOMPLETE] Expected ${totalExpected} records, received ${grandTotal} (missing ${missing})`);
            console.warn('   Transitioning to live mode anyway to prevent stuck state');
          } else {
            console.log(`✅ [SYNC VALIDATED] Received all ${grandTotal} expected records`);
          }
        } else if (hasMoreChunks) {
          console.log(`📦 [SYNC CHUNK] Completed chunk ${grandTotal}/${totalExpected}, more chunks pending`);
        }

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
          const device = this.scannedDevices.get(deviceId);
          const recordCountForEmit = device?.syncRecords?.length ?? 0;
          if (updated) {
            const latestRecord = this.getLatestSyncedRecord(deviceId);
            this.emit('syncDataUpdated', {
              deviceId,
              latestRecord,
              totalRecords: recordsTransmitted,
              success: true
            });
          } else if (!hasMoreChunks) {
            // iOS: always emit syncDataUpdated on final sync_complete so Live/Historical screens refresh (data may have arrived via record events)
            this.emit('syncDataUpdated', {
              deviceId,
              latestRecord: this.getLatestSyncedRecord(deviceId) || null,
              totalRecords: recordsTransmitted || grandTotal || recordCountForEmit,
              success: true
            });
          }
          if (device && device.syncRecords) {
            // Send all records received this sync run (recordsTransmitted/grandTotal), not just the
            // slice after recordsBeforeSync — dedup can make that slice smaller than what we synced.
            const countThisRun = recordsTransmitted || grandTotal || 0;
            const recordsToSend = countThisRun > 0
              ? device.syncRecords.slice(-countThisRun)
              : device.syncRecords.slice(device.syncRecordsBeforeSync !== undefined ? device.syncRecordsBeforeSync : 0);
            console.log(`📤 [HISTORICAL SYNC] recordsToSend.length=${recordsToSend?.length ?? 0}, countThisRun=${countThisRun}, device.syncRecords.length=${device.syncRecords?.length ?? 0}`);
            if (recordsToSend && recordsToSend.length > 0) {
              await this.sendHistoricalRecords(deviceId, recordsToSend);
              device.syncRecordsBeforeSync = device.syncRecords.length;
              this.scannedDevices.set(deviceId, device);
            }
          }
        }
        this.emit('dataTransfer', {
          deviceId,
          type: 'sync_complete',
          success,
          recordsTransmitted
        });
        if (this.dataSyncStates) {
          this.dataSyncStates.delete(deviceId);
        }
        // iOS only sends DataTransfer (no deviceDataUpdate). Emit deviceDataUpdate so ModernBLEManager gets total synced (same as Android).
        const totalSyncedForUI = grandTotal ?? totalExpected ?? recordsTransmitted ?? 0;
        const device = this.scannedDevices.get(deviceId);
        if (device && success && !hasMoreChunks) {
          const prevDeviceData = device.deviceData || {};
          device.deviceData = { ...prevDeviceData, recordCount: totalSyncedForUI };
          this.scannedDevices.set(deviceId, device);
          this.emit('deviceDataUpdate', {
            deviceId,
            type: 'sync_complete',
            totalRecords: totalSyncedForUI,
            recordsTransmitted: totalSyncedForUI,
            grandTotal: grandTotal ?? totalSyncedForUI,
            deviceData: device.deviceData
          });
        }
        break;
      }
      case 'record': {
        // 🔒 PHASE ENFORCEMENT: Live data only after history sync completes (Phase 3)
        const isLiveRecord = eventData.isPushGenerated === true || eventData.isLiveData === true;
        const currentPhase = this.connectionPhase?.get(deviceId);

        if (isLiveRecord && currentPhase !== 'live') {
          // When phase is undefined/unknown, a push-generated record can arrive before the "decide" step runs
          // (e.g. iOS device status is aggregated with a short delay). Do NOT set phase to 'live' here so that
          // when maybeTriggerAutoSyncFromDeviceStatus runs it will start history sync. Still process the record below.
          const allowEarlyLiveData = currentPhase === undefined || currentPhase === 'unknown' || currentPhase === 'decide';
          if (allowEarlyLiveData) {
            // Leave phase unchanged so decide can run and start history sync; still process this record below
          } else {
            // history_sync or other: ignore live data until sync completes
            console.log(`⏭️ [PHASE GUARD] Ignoring live data for ${deviceId} - still in phase: ${currentPhase}`);
            console.log('   Live data will be processed after history sync completes');
            break;
          }
        }

        if (records && Array.isArray(records)) {
          // 🔴 FILTER PARTIAL RECORDS: Drop incomplete data before processing
          const validRecords = records.filter(record => {
            if (record.isPartialRecord === true) {
              console.warn(`⚠️ [PARTIAL RECORD] Dropping incomplete record for ${deviceId}:`, {
                timestamp: record.timestamp,
                timestampDate: record.timestampDate,
                reason: 'Connection interrupted mid-packet'
              });
              return false; // Drop partial record
            }
            return true; // Keep complete record
          });

          if (validRecords.length === 0) {
            console.warn(`⚠️ [PARTIAL RECORDS] All ${records.length} records were partial - none processed`);
            break;
          }

          if (validRecords.length < records.length) {
            console.warn(`⚠️ [PARTIAL RECORDS] Dropped ${records.length - validRecords.length} partial records, processing ${validRecords.length} complete records`);
          }

          const device = this.scannedDevices.get(deviceId);
          if (device) {
            if (!device.syncRecords) {
              device.syncRecords = [];
            }
            // Store all records during sync; filter by last record only when displaying (live/history screens)
            let validRecordsCount = 0;
            let invalidRecordsCount = 0;
            validRecords.forEach((record) => {
              const isValidRecord = (
                record.steps > 0 ||
                record.temperature > 0 ||
                (record.timestamp && record.timestamp > 1577836800)
              );
              if (!isValidRecord) {
                invalidRecordsCount++;
                return;
              }
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
              // Log when device RTC is ahead of phone; we still store and show exact time from tag
              if (recordTimestamp && recordTimestamp > receivedAtSeconds) {
                const timeDiff = recordTimestamp - receivedAtSeconds;
                console.warn(`⚠️ [TIMESTAMP VALIDATION] ${deviceId}: Record timestamp is ${timeDiff} seconds in the future (showing exact tag time)`, {
                  recordTimestamp,
                  receivedAtSeconds,
                  timestampDate: record.timestampDate,
                  receivedAt: receivedAt.toISOString(),
                  timeDiffSeconds: timeDiff
                });
              }
              // Dedupe by RECORDED TIME only (device time), never received or synced time.
              const recordedTimeSeconds = recordTimestamp;
              const existingRecordIndex = device.syncRecords.findIndex(r => {
                const existingRecordedTime = this.getRecordedTimeSeconds(r);
                return existingRecordedTime === recordedTimeSeconds &&
                  r.steps === record.steps &&
                  r.temperature === record.temperature;
              });
              if (existingRecordIndex >= 0) {
                invalidRecordsCount++;
                const dupMsg = `time=${recordTimestamp}, steps=${record.steps}, temp=${record.temperature}${record.timestampDate ? ` (${record.timestampDate})` : ''}`;
                console.log(`⏭️ [DUPLICATE DETECTION] ${deviceId}: Skipping duplicate record (historical batch) — ${dupMsg}`);
                this.addConnectionLog(deviceId, `Duplicate removed: ${dupMsg}`);
                return;
              }
              validRecordsCount++;
              // Always use exact time from tag for display (no adjustment)
              const finalTimestamp = recordTimestamp;
              let finalTimestampDate = record.timestampDate;
              if (!finalTimestampDate && finalTimestamp) {
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
                timestampDate: finalTimestampDate || record.timestampDate,
                temperature: record.temperature,
                steps: record.steps,
                receivedAt: receivedAt,
                deviceId,
                source: 'native'
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

              // FIX: Update deviceData with latest record's temperature and steps
              // This ensures ModernBLEManager shows the latest values
              const latestRecord = device.syncRecords[device.syncRecords.length - 1];
              if (latestRecord) {
                // Update temperature if present
                if (latestRecord.temperature !== null && latestRecord.temperature !== undefined) {
                  device.deviceData.temperature = latestRecord.temperature;
                }
                // Update steps if present
                if (latestRecord.steps !== null && latestRecord.steps !== undefined) {
                  device.deviceData.steps = latestRecord.steps;
                }
                // Calculate total steps from all records
                const totalSteps = device.syncRecords.reduce((sum, r) => sum + (r.steps || 0), 0);
                device.deviceData.totalSteps = totalSteps;
                // Update lastUpdate timestamp
                if (latestRecord.timestamp) {
                  device.deviceData.lastUpdate = new Date(latestRecord.timestamp * 1000);
                } else if (latestRecord.receivedAt) {
                  device.deviceData.lastUpdate = latestRecord.receivedAt;
                }
              }

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

        // FIX: Check if this is a push-generated (live) record and emit appropriate event
        const isPushGenerated = eventData.isPushGenerated === true;
        const isLiveData = eventData.isLiveData === true;

        if (isPushGenerated || isLiveData) {
          // Emit deviceDataUpdate event with type 'live_record' for LiveDataScreen
          const device = this.scannedDevices.get(deviceId);
          const latestRecord = device?.syncRecords?.[device.syncRecords.length - 1];

          // ✅ Log live data notification in connection logs (with deduplication)
          const now = Date.now();
          const lastLog = this.lastLiveDataLogTime.get(deviceId);
          const recordTs = latestRecord?.timestamp || 0;
          const shouldLog = !lastLog ||
            (now - lastLog.time) >= this.liveDataLogDedupeWindow ||
            lastLog.recordTimestamp !== recordTs;

          if (shouldLog) {
            this.lastLiveDataLogTime.set(deviceId, { time: now, recordTimestamp: recordTs });
            this.addConnectionLog(deviceId, 'Live Data Received', {
              recordCount: records?.length || 1,
              temperature: latestRecord?.temperature,
              steps: latestRecord?.steps,
              recordTimestamp: latestRecord?.timestamp,
              recordTimestampDate: latestRecord?.timestampDate || (latestRecord?.timestamp ? new Date(latestRecord.timestamp * 1000).toISOString() : null),
              source: 'push_notification',
              platform: Platform.OS
            });
          }

          this.emit('deviceDataUpdate', {
            deviceId,
            type: 'live_record',
            records,
            recordCount,
            deviceData: device?.deviceData,
            latestRecord,
            isPushGenerated: true,
            isLiveData: true
          });

          console.log(`📊 [BLEService] Emitted live_record event for ${deviceId}:`, {
            recordCount: records?.length,
            temperature: latestRecord?.temperature,
            steps: latestRecord?.steps
          });
        } else {
          // Sync progress: on Android, native already sends deviceDataUpdate(sync_records) per batch.
          // On iOS, native includes totalReceived/totalExpected in record events for accurate progress.
          if (Platform.OS !== 'android') {
            const device = this.scannedDevices.get(deviceId);
            const syncState = this.dataSyncStates?.get(deviceId);
            const totalReceived = (typeof eventData.totalReceived === 'number' && eventData.totalReceived >= 0)
              ? eventData.totalReceived
              : (device?.syncRecords?.length ?? 0);
            const totalExpected = (typeof eventData.totalExpected === 'number' && eventData.totalExpected > 0)
              ? eventData.totalExpected
              : (syncState?.expectedRecords ?? syncState?.totalRecords ?? this.syncExpectedRecords.get(deviceId) ?? totalReceived);
            const recordsReceived = records?.length || 0;
            if (syncState) {
              syncState.recordsReceived = totalReceived;
              syncState.lastActivity = Date.now();
            }
            if (!this.lastSyncProgressEvents) {
              this.lastSyncProgressEvents = new Map();
            }
            const lastProgress = this.lastSyncProgressEvents.get(deviceId);
            const currentTime = Date.now();
            const shouldEmit = !lastProgress ||
              (currentTime - lastProgress.timestamp) > this.syncProgressDedupeWindow ||
              lastProgress.totalReceived !== totalReceived ||
              lastProgress.totalExpected !== totalExpected;
            if (shouldEmit) {
              this.lastSyncProgressEvents.set(deviceId, {
                timestamp: currentTime,
                totalReceived,
                totalExpected,
                recordsReceived
              });
              this.emit('deviceDataUpdate', {
                deviceId,
                type: 'sync_records',
                records,
                recordCount,
                recordsReceived,
                totalReceived,
                totalExpected,
                deviceData: device?.deviceData
              });
            } else {
              console.log(`⏭️ [SYNC] Skipping duplicate sync progress event for ${deviceId} (${totalReceived}/${totalExpected})`);
            }
          }
        }

        this.emit('dataTransfer', {
          deviceId,
          type: 'record',
          records,
          recordCount,
          isPushGenerated,
          isLiveData
        });
        break;
      }
      case 'read_error':
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
      // TEMPORARILY DISABLED: API calls commented out
      // const result = await postPetHealthBLEData(petHealthData);
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
  getCurrentApiInterval(deviceId) {
    const screenActive = this.screenActiveStates.get(deviceId);
    if (this.appState === 'background') {
      return this.adaptiveApiConfig.BACKGROUND_INTERVAL;
    } else if (screenActive === true) {
      return this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL;
    } else if (screenActive === false) {
      return this.adaptiveApiConfig.INACTIVE_SCREEN_INTERVAL;
    } else {
      return this.adaptiveApiConfig.ACTIVE_SCREEN_INTERVAL;
    }
  }
  startAdaptiveApiCalling(deviceId) {
    return;
  }
  startJSTimer(deviceId, interval) {
    return;
  }
  stopAdaptiveApiCalling(deviceId) {
    const timerInfo = this.adaptiveApiTimers.get(deviceId);
    if (timerInfo) {
      if (timerInfo.isNative && Platform.OS === 'android' && SampleBridgeAndroid) {
        SampleBridgeAndroid.stopHealthDataApiMonitoring(deviceId)
          .then(() => {
          })
          .catch((error) => {
          });
      } else if (timerInfo.timer) {
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
        // RSSI monitoring handled by native health checks - no JS restart needed
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
        // RSSI monitoring handled by native health checks - no JS restart needed
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
    // ============================================================================
    // TEMPORARILY DISABLED: API calls commented out to avoid network errors
    // Uncomment when backend API is ready
    // ============================================================================
    return; // Skip API call for now

    /*
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
    */
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
      try {
        await this.removeDeviceFromBondedList(deviceId);
      } catch (error) {
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
    this.flushPendingCharacteristicsLogs(deviceId);
    const batchTimer = this.characteristicsLogBatchTimers.get(deviceId);
    if (batchTimer) {
      clearTimeout(batchTimer);
      this.characteristicsLogBatchTimers.delete(deviceId);
    }
    this.lastServiceDiscoveryLog.delete(deviceId);
    this.lastCharacteristicsDiscoveryLog.delete(deviceId);
    this.pendingCharacteristicsLogs.delete(deviceId);
    this.lastConnectedLogs.delete(deviceId);
    this.lastRecordSyncedLogs.delete(deviceId);
    this.lastRTCReadLogs.delete(deviceId);
    this.lastCommandResponseLogs.delete(deviceId);
    this.lastLiveDataLogTime.delete(deviceId);  // ✅ Clear live data log deduplication
    if (this.lastSyncProgressEvents) {
      this.lastSyncProgressEvents.delete(deviceId);  // ✅ Clear sync progress deduplication
    }
    this.rssiValues.delete(deviceId);
    this.rssiHistory.delete(deviceId);
    this.lastRssiUpdate.delete(deviceId);
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
    this.screenActiveStates.delete(deviceId);
    this.adaptiveApiCooldowns.delete(deviceId);
    this.manualDisconnectCooldown.delete(deviceId);
    if (this.monitoringSubscriptions.has(deviceId)) {
      const subscription = this.monitoringSubscriptions.get(deviceId);
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
      this.monitoringSubscriptions.delete(deviceId);
    }
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
      // =========================================================================
      // iOS CLEANUP - Match registered listeners exactly
      // =========================================================================
      if (Platform.OS === 'ios' && this.iosEventEmitter) {
        this.iosEventEmitter.removeAllListeners('DeviceFound');
        this.iosEventEmitter.removeAllListeners('DeviceConnected');
        this.iosEventEmitter.removeAllListeners('DeviceDisconnected');
        this.iosEventEmitter.removeAllListeners('ServicesDiscovered');
        this.iosEventEmitter.removeAllListeners('CharacteristicsDiscovered');
        this.iosEventEmitter.removeAllListeners('ServiceDiscoveryComplete');
        this.iosEventEmitter.removeAllListeners('CharacteristicData');
        this.iosEventEmitter.removeAllListeners('DataTransfer');
        this.iosEventEmitter.removeAllListeners('SystemCommandResponse');
        this.iosEventEmitter.removeAllListeners('NativeCommandSent');
        this.iosEventEmitter.removeAllListeners('DeviceDataUpdated');
        this.iosEventEmitter.removeAllListeners('RTCRead');
        this.iosEventEmitter.removeAllListeners('RSSIUpdate');
        this.iosEventEmitter.removeAllListeners('HealthDataApiRequest');
        this.iosEventEmitter.removeAllListeners('DFUStateChanged');
        this.iosEventEmitter.removeAllListeners('DFUProgress');
        this.iosEventEmitter.removeAllListeners('DFUError');
      }
      // =========================================================================
      // ANDROID CLEANUP - Match registered listeners exactly
      // =========================================================================
      if (Platform.OS === 'android') {
        DeviceEventEmitter.removeAllListeners('DeviceFound');
        DeviceEventEmitter.removeAllListeners('DeviceConnected');
        DeviceEventEmitter.removeAllListeners('DeviceDisconnected');
        DeviceEventEmitter.removeAllListeners('ServicesDiscovered');
        DeviceEventEmitter.removeAllListeners('ServiceDiscoveryComplete');
        DeviceEventEmitter.removeAllListeners('CharacteristicData');
        DeviceEventEmitter.removeAllListeners('DeviceDataUpdated');
        DeviceEventEmitter.removeAllListeners('deviceDataUpdate');
        DeviceEventEmitter.removeAllListeners('DataTransfer');
        DeviceEventEmitter.removeAllListeners('SystemCommandResponse');
        DeviceEventEmitter.removeAllListeners('NativeCommandSent');
        DeviceEventEmitter.removeAllListeners('RTCRead');
        DeviceEventEmitter.removeAllListeners('RSSIUpdate');
        DeviceEventEmitter.removeAllListeners('DeviceStatusRead');
        DeviceEventEmitter.removeAllListeners('HealthDataApiRequest');
        DeviceEventEmitter.removeAllListeners('DFUStateChanged');
        DeviceEventEmitter.removeAllListeners('DFUProgress');
        DeviceEventEmitter.removeAllListeners('DFUError');
      }
    } catch (error) {
    }
  }
  /**
   * Start MCUboot DFU over SMP (McuMgr). Android and iOS.
   * Device must expose SMP service 8D53DC1D-... and characteristic DA2E7828-...
   * Flow: disconnect app connection -> wait 5s -> McuMgr connects -> validate -> upload .bin if needed -> confirm -> reset.
   * @param {string} deviceId - BLE MAC address (Android) or peripheral UUID string (iOS)
   * @param {string} firmwarePath - file:// path or content URI to .bin image
   * @returns {Promise<{status, deviceId, firmwarePath, imageSize}>}
   */
  async startMcuMgrDfu(deviceId, firmwarePath) {
    if (Platform.OS === 'android') {
      if (!SampleBridgeAndroid?.startMcuMgrDfu) throw new Error('MCUboot DFU not available on Android');
      return SampleBridgeAndroid.startMcuMgrDfu(deviceId, firmwarePath);
    }
    if (Platform.OS === 'ios') {
      if (!BridgingCodeModule?.startMcuMgrDfu) throw new Error('MCUboot DFU not available on iOS');
      return BridgingCodeModule.startMcuMgrDfu(deviceId, firmwarePath);
    }
    throw new Error('MCUboot DFU is only supported on Android and iOS');
  }
  /**
   * Cancel ongoing MCUboot DFU. Android and iOS.
   */
  async cancelMcuMgrDfu() {
    if (Platform.OS === 'android') {
      if (!SampleBridgeAndroid?.cancelMcuMgrDfu) throw new Error('MCUboot DFU not available on Android');
      return SampleBridgeAndroid.cancelMcuMgrDfu();
    }
    if (Platform.OS === 'ios') {
      if (!BridgingCodeModule?.cancelMcuMgrDfu) throw new Error('MCUboot DFU not available on iOS');
      return BridgingCodeModule.cancelMcuMgrDfu();
    }
    throw new Error('MCUboot DFU is only supported on Android and iOS');
  }
}
export default new BLEService();
