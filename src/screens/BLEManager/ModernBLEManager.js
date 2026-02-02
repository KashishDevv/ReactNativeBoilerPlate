import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  StatusBar,
  Animated,
  Dimensions,
  Platform,
  Linking,
} from 'react-native';
import BLEService from '../../services/ble/BLEService';
import { CONNECTION_STATES, SCAN_STATES, BLE_STATES, POWER_PROFILE } from '../../constants/BLEConstants';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';
import { useFocusEffect } from '@react-navigation/native';
import BLEPermissions from '../../utils/BLEPermissions';
const { width } = Dimensions.get('window');
const getConnectionIndicatorColor = (state) => {
  switch (state) {
    case CONNECTION_STATES.CONNECTED:
      return Colors.success;
    case CONNECTION_STATES.CONNECTING:
    case CONNECTION_STATES.DISCONNECTING:
      return Colors.warning;
    default:
      return Colors.border;
  }
};
const getRSSIColor = (rssi) => {
  if (!rssi) return Colors.lightGray;
  if (rssi > -50) return Colors.success;
  if (rssi > -70) return Colors.warning;
  return Colors.error;
};
const getBatteryColor = (level) => {
  if (level > 50) return Colors.success;
  if (level > 20) return Colors.warning;
  return Colors.error;
};
const ModernBLEManager = ({ navigation }) => {
  const [devices, setDevices] = useState([]);
  const lastSyncCompleteTime = useRef(new Map());
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [currentPowerProfile, setCurrentProfile] = useState('default');
  const [phoneBatteryLevel, setPhoneBatteryLevel] = useState(null);
  const [bleState, setBleState] = useState(BLE_STATES.UNKNOWN);
  const [refreshing, setRefreshing] = useState(false);
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const rssiScanTimerRef = React.useRef(null);
  const rssiScanCycleRef = React.useRef(null);
  const scanTimeoutRef = React.useRef(null);
  // Store event handler references for proper cleanup (prevents removing other listeners)
  const eventHandlersRef = useRef({
    powerProfileChanged: null,
    deviceDisconnected: null,
    deviceFound: null,
    deviceConnected: null,
    deviceDataUpdate: null,
    rssiUpdate: null,
  });
  useEffect(() => {
    checkBLEState();
    const getCurrentProfile = async () => {
      try {
        const profile = await BLEService.getCurrentProfileName();
        setCurrentProfile(profile);
      } catch (error) {
        console.log('Could not get current power profile:', error);
      }
    };
    getCurrentProfile();
    const getPhoneBattery = async () => {
      try {
        const battery = await BLEService.getPhoneBatteryLevel();
        setPhoneBatteryLevel(battery);
        console.log('📱 Battery level loaded:', battery);
      } catch (error) {
        console.log('Could not get detailed battery info, trying basic method:', error);
        try {
          const battery = await BLEService.getPhoneBatteryLevel();
          setPhoneBatteryLevel(battery);
        } catch (e) {
          console.log('Could not get phone battery level:', e);
        }
      }
    };
    getPhoneBattery();
    const requestPermissionsEarly = async () => {
      try {
        await BLEService.requestPermissions();
      } catch (error) {
        console.log('Permission request failed:', error);
      }
    };
    requestPermissionsEarly();
    const loadDemoModeState = async () => {
      try {
        const enabled = BLEService.isDemoModeEnabled();
        setDemoModeEnabled(enabled);
      } catch (error) {
        console.log('Could not load demo mode state:', error);
      }
    };
    loadDemoModeState();
    (async () => {
      try {
        const connected = await BLEService.getConnectedDevices();
        setConnectedDevices(connected);
        console.log('🔗 [Modern] Loaded connected devices:', connected.length);
      } catch (e) {
        console.warn('⚠️ [Modern] Failed loading connected devices', e?.message);
      }
    })();
    BLEService.setDeviceListUpdateCallback(async () => {
      try {
        const connected = await BLEService.getConnectedDevices();
        setConnectedDevices(connected);
        console.log('🔗 [Modern] Refreshed connected devices:', connected.length);
        setRefreshTrigger(prev => prev + 1);
        const allKnownDevices = BLEService.getScannedDevices();
        setDevices(prevDevices => {
          const deviceMap = new Map();
          prevDevices.forEach(device => {
            deviceMap.set(device.id, device);
          });
          allKnownDevices.forEach(device => {
            const existing = deviceMap.get(device.id);
            if (existing) {
              deviceMap.set(device.id, { ...existing, ...device });
            } else {
              deviceMap.set(device.id, device);
            }
          });
          return Array.from(deviceMap.values());
        });
      } catch (e) {
        console.warn('⚠️ [Modern] Refresh connected failed:', e?.message);
      }
    });
    console.log('📞 [Modern] Device list update callback registered');
    // Store handler references for proper cleanup
    eventHandlersRef.current.powerProfileChanged = (data) => {
      console.log('⚡ Power profile changed:', data);
      setCurrentProfile(data.newProfile);
    };
    BLEService.on('powerProfileChanged', eventHandlersRef.current.powerProfileChanged);
    console.log('📞 [Modern] Power profile change listener registered');
    eventHandlersRef.current.deviceDisconnected = (device) => {
      const deviceId = device.id || device.deviceId;
      console.log('🧹 [Modern] Device disconnected, clearing stale data:', deviceId, {
        hasId: !!device.id,
        hasDeviceId: !!device.deviceId,
        connectionState: device.connectionState
      });
      if ((device.passkeyChanged || device.needsSystemForget) && Platform.OS === 'ios') {
        Alert.alert(
          '🔐 Passkey Updated Successfully',
          `The device passkey has been changed.\n\n⚠️ IMPORTANT: You must forget this device from iOS Settings to reconnect:\n\n1. Open iOS Settings → Bluetooth\n2. Find "${device.name || 'DyreID'}"\n3. Tap (i) icon → "Forget This Device"\n4. Return to app and reconnect with NEW passkey\n\nThis is required because iOS caches the old passkey at system level.`,
          [
            {
              text: 'Open Settings',
              onPress: () => {
                Linking.openURL('App-Prefs:root=Bluetooth').catch(() => {
                  Linking.openSettings();
                });
              }
            },
            { text: 'I Understand', style: 'cancel' }
          ]
        );
      }
      const allKnownDevices = BLEService.getScannedDevices();
      const freshDevice = allKnownDevices.find(d => d.id === deviceId);
      setConnectedDevices(prevConnected =>
        prevConnected.filter(d => d.id !== deviceId && d.id !== device.deviceId)
      );
      setDevices(prevDevices =>
        prevDevices.map(d => {
          if (d.id === deviceId || d.id === device.deviceId || deviceId === d.id) {
            const deviceToUse = freshDevice || device;
            console.log('🔄 [Modern] Updating device state to disconnected:', deviceId, {
              freshDeviceState: freshDevice?.connectionState,
              eventDeviceState: device.connectionState
            });
            return {
              ...d,
              ...deviceToUse,
              id: deviceId,
              connectionState: CONNECTION_STATES.DISCONNECTED,
              batteryLevel: null,
              temperature: null,
              steps: null,
              timestamp: null,
              services: [],
              characteristics: [],
              deviceData: d.deviceData ? {
                ...d.deviceData,
                recordCount: d.deviceData.recordCount
              } : null,
              disconnectedAt: new Date(),
              disconnectReason: device.reason || device.error || 'disconnected'
            };
          }
          return d;
        })
      );
      setRefreshTrigger(prev => prev + 1);
      setTimeout(async () => {
        try {
          const connected = await BLEService.getConnectedDevices();
          setConnectedDevices(connected);
          console.log('🔄 [Modern] Refreshed connectedDevices after disconnection:', connected.length);
        } catch (error) {
          console.warn('⚠️ [Modern] Failed to refresh connectedDevices after disconnection:', error);
        }
      }, 100);
    };
    BLEService.on('deviceDisconnected', eventHandlersRef.current.deviceDisconnected);
    console.log('📞 [Modern] Device disconnection listener registered');
    eventHandlersRef.current.deviceFound = (device) => {
      console.log('🔍 [Modern] Device found event received:', device.name, device.id);
      if (device.manufacturerData) {
        console.log('📦 [Modern] Manufacturer data:', JSON.stringify(device.manufacturerData, null, 2));
      }
      setDevices(prevDevices => {
        const existingIndex = prevDevices.findIndex(d => d.id === device.id);
        if (existingIndex >= 0) {
          const updatedDevices = [...prevDevices];
          updatedDevices[existingIndex] = {
            ...updatedDevices[existingIndex],
            ...device,
            lastSeen: Date.now(),
            isFreshDiscovery: true
          };
          return updatedDevices;
        } else {
          return [...prevDevices, {
            ...device,
            lastSeen: Date.now(),
            isFreshDiscovery: true
          }];
        }
      });
      setRefreshTrigger(prev => prev + 1);
    };
    BLEService.on('deviceFound', eventHandlersRef.current.deviceFound);
    console.log('📞 [Modern] Device found event listener registered');
    eventHandlersRef.current.deviceConnected = (device) => {
      console.log('🔗 [Modern] Device connected event received:', device.deviceId || device.id, device.deviceName || device.name);
      const allKnownDevices = BLEService.getScannedDevices();
      const deviceId = device.deviceId || device.id;
      const knownDevice = allKnownDevices.find(d => d.id === deviceId);
      setDevices(prevDevices => {
        const existingIndex = prevDevices.findIndex(d => d.id === deviceId);
        const deviceData = knownDevice || device;
        let rssiValue = deviceData.rssi || device.rssi || null;
        if (!rssiValue && deviceId) {
          setTimeout(async () => {
            try {
              const freshDevices = BLEService.getScannedDevices();
              const freshDevice = freshDevices.find(d => d.id === deviceId);
              if (freshDevice?.rssi) {
                setDevices(prevDevices => {
                  return prevDevices.map(d => {
                    if (d.id === deviceId && !d.rssi) {
                      return { ...d, rssi: freshDevice.rssi };
                    }
                    return d;
                  });
                });
                setRefreshTrigger(prev => prev + 1);
              }
            } catch (error) {
              console.log('⚠️ [Modern] Could not read RSSI for auto-connected device:', error);
            }
          }, 2000);
        }
        if (existingIndex >= 0) {
          const updatedDevices = [...prevDevices];
          const existingDevice = updatedDevices[existingIndex];
          const existingDeviceData = existingDevice.deviceData || {};
          const newDeviceData = deviceData.deviceData || {};

          // Debug log for temperature tracking
          if (newDeviceData.temperature !== undefined || existingDeviceData.temperature !== undefined) {
            console.log('🌡️ [Modern] Temperature merge:', deviceId, {
              newTemp: newDeviceData.temperature,
              existingTemp: existingDeviceData.temperature,
              newIsZero: newDeviceData.temperature === 0,
              existingIsZero: existingDeviceData.temperature === 0
            });
          }

          const mergedDeviceData = {
            ...existingDeviceData,
            steps: (newDeviceData.steps !== undefined && newDeviceData.steps !== 0)
              ? newDeviceData.steps
              : (existingDeviceData.steps !== undefined && existingDeviceData.steps !== 0)
                ? existingDeviceData.steps
                : (newDeviceData.steps !== undefined ? newDeviceData.steps : existingDeviceData.steps),
            temperature: (newDeviceData.temperature !== undefined && newDeviceData.temperature !== 0)
              ? newDeviceData.temperature
              : (existingDeviceData.temperature !== undefined && existingDeviceData.temperature !== 0)
                ? existingDeviceData.temperature
                : (newDeviceData.temperature !== undefined ? newDeviceData.temperature : existingDeviceData.temperature),
            totalSteps: newDeviceData.totalSteps !== undefined ? newDeviceData.totalSteps : existingDeviceData.totalSteps,
            batteryLevel: newDeviceData.batteryLevel !== undefined ? newDeviceData.batteryLevel : existingDeviceData.batteryLevel,
            recordCount: newDeviceData.recordCount !== undefined ? newDeviceData.recordCount : existingDeviceData.recordCount,
            dataSource: newDeviceData.dataSource || existingDeviceData.dataSource,
            lastUpdate: newDeviceData.lastUpdate || existingDeviceData.lastUpdate
          };
          updatedDevices[existingIndex] = {
            ...existingDevice,
            ...deviceData,
            id: deviceId,
            name: deviceData.name || device.deviceName || device.name || existingDevice.name,
            connectionState: CONNECTION_STATES.CONNECTED,
            connectedAt: new Date(),
            lastSeen: Date.now(),
            rssi: rssiValue !== null ? rssiValue : existingDevice.rssi,
            deviceData: mergedDeviceData
          };
          return updatedDevices;
        } else {
          const newDevice = {
            ...deviceData,
            id: deviceId,
            name: deviceData.name || device.deviceName || device.name || 'Unknown Device',
            connectionState: CONNECTION_STATES.CONNECTED,
            connectionType: device.connectionType || deviceData.connectionType || 'auto',
            connectedAt: new Date(),
            lastSeen: Date.now(),
            rssi: rssiValue,
            isSmartTag: deviceData.isSmartTag || device.isSmartTag || false,
            deviceData: deviceData.deviceData || {
              batteryLevel: null,
              temperature: null,
              steps: null,
              totalSteps: null,
              recordCount: null
            }
          };
          console.log('➕ [Modern] Adding new auto-connected device to list:', newDevice.name, newDevice.id, 'RSSI:', newDevice.rssi);
          return [...prevDevices, newDevice];
        }
      });
      setRefreshTrigger(prev => prev + 1);
    };
    BLEService.on('deviceConnected', eventHandlersRef.current.deviceConnected);
    console.log('📞 [Modern] Device connected event listener registered');
    eventHandlersRef.current.deviceDataUpdate = (eventData) => {
      try {
        console.log('📥 [Modern] deviceDataUpdate event received:', eventData.type, 'for device:', eventData.deviceId);
        if (!eventData.deviceId) {
          console.warn('⚠️ [Modern] deviceDataUpdate event missing deviceId:', eventData);
          return;
        }
        if (eventData.type === 'sync_complete') {
          // After sync success: show total records synced (all chunks), not last chunk only or "0 left on device"
          const totalSynced = eventData.totalRecords ?? eventData.grandTotal ?? eventData.recordsTransmitted ?? eventData.deviceData?.recordCount ?? 0;
          console.log('📊 [Modern] Sync complete – total synced:', totalSynced, eventData.deviceId);
          lastSyncCompleteTime.current.set(eventData.deviceId, Date.now());
          setDevices(prevDevices => {
            return prevDevices.map(d => {
              if (d.id === eventData.deviceId) {
                const preservedTotalSteps = eventData.totalSteps !== undefined ? eventData.totalSteps : d.deviceData?.totalSteps;
                const preservedSteps = eventData.steps !== undefined ? eventData.steps : d.deviceData?.steps;
                const preservedTemperature = eventData.temperature !== undefined ? eventData.temperature : d.deviceData?.temperature;
                return {
                  ...d,
                  deviceData: {
                    ...d.deviceData,
                    ...eventData.deviceData,
                    recordCount: totalSynced,
                    totalSteps: preservedTotalSteps,
                    steps: preservedSteps,
                    temperature: preservedTemperature,
                  },
                  manufacturerData: d.manufacturerData ? {
                    ...d.manufacturerData,
                    recordCount: totalSynced,
                    hasRecords: totalSynced > 0
                  } : d.manufacturerData
                };
              }
              return d;
            });
          });
          setRefreshTrigger(prev => prev + 1);
        }
        if (eventData.type === 'live_data' && eventData.deviceData) {
          console.log('📊 [Modern] Live data received:', eventData.deviceId, {
            steps: eventData.deviceData.steps,
            temperature: eventData.deviceData.temperature,
            tempIsZero: eventData.deviceData.temperature === 0,
            batteryLevel: eventData.deviceData.batteryLevel
          });
          setDevices(prevDevices => {
            return prevDevices.map(d => {
              if (d.id === eventData.deviceId) {
                return {
                  ...d,
                  deviceData: {
                    ...d.deviceData,
                    ...eventData.deviceData,
                    recordCount: eventData.deviceData.recordCount !== undefined
                      ? eventData.deviceData.recordCount
                      : d.deviceData?.recordCount
                  }
                };
              }
              return d;
            });
          });
          setRefreshTrigger(prev => prev + 1);
        }
        // FIX: Handle live_record events from push-generated (v1.5 live) records
        if (eventData.type === 'live_record' && (eventData.deviceData || eventData.latestRecord)) {
          const latestRecord = eventData.latestRecord || {};
          const deviceData = eventData.deviceData || {};
          console.log('📊 [Modern] Live record received:', eventData.deviceId, {
            steps: latestRecord.steps || deviceData.steps,
            temperature: latestRecord.temperature || deviceData.temperature,
            totalSteps: deviceData.totalSteps,
            recordCount: eventData.recordCount
          });
          setDevices(prevDevices => {
            return prevDevices.map(d => {
              if (d.id === eventData.deviceId) {
                return {
                  ...d,
                  deviceData: {
                    ...d.deviceData,
                    ...deviceData,
                    // Use latest record values for immediate display
                    temperature: latestRecord.temperature ?? deviceData.temperature ?? d.deviceData?.temperature,
                    steps: latestRecord.steps ?? deviceData.steps ?? d.deviceData?.steps,
                    totalSteps: deviceData.totalSteps ?? d.deviceData?.totalSteps,
                    dataSource: 'live',
                    lastUpdate: new Date()
                  }
                };
              }
              return d;
            });
          });
          setRefreshTrigger(prev => prev + 1);
        }
        // Update record count from Device Status characteristic (first read after connect + any later update).
        // Don't require isFromPolling — otherwise we'd keep showing advertising value (e.g. 500) until sync_complete.
        if (eventData.type === 'device_status' && eventData.deviceData?.recordCount !== undefined) {
          const deviceId = eventData.deviceId;
          const recordCount = eventData.deviceData.recordCount;
          setDevices(prevDevices => {
            return prevDevices.map(d => {
              if (d.id === deviceId) {
                return {
                  ...d,
                  deviceData: {
                    ...d.deviceData,
                    ...eventData.deviceData,
                    recordCount: recordCount,
                  },
                  manufacturerData: d.manufacturerData ? {
                    ...d.manufacturerData,
                    recordCount: recordCount,
                    hasRecords: recordCount > 0
                  } : d.manufacturerData
                };
              }
              return d;
            });
          });
          setRefreshTrigger(prev => prev + 1);
        }
        if (eventData.type === 'sync_records') {
          const totalReceived = eventData.totalReceived || 0;
          const totalExpected = eventData.totalExpected || 0;
          const recordsReceived = eventData.recordsReceived || 0;
          const remainingRecords = Math.max(0, totalExpected - totalReceived);
          const deviceData = eventData.deviceData || {};
          console.log('📊 [Modern] Sync progress received:', eventData.deviceId, `${totalReceived}/${totalExpected} records (${remainingRecords} remaining)`);
          setDevices(prevDevices => {
            return prevDevices.map(d => {
              if (d.id === eventData.deviceId) {
                return {
                  ...d,
                  deviceData: {
                    ...d.deviceData,
                    recordCount: remainingRecords,
                    // FIX: Also update temperature, steps, totalSteps from deviceData
                    temperature: deviceData.temperature ?? d.deviceData?.temperature,
                    steps: deviceData.steps ?? d.deviceData?.steps,
                    totalSteps: deviceData.totalSteps ?? d.deviceData?.totalSteps,
                    dataSource: 'synced',
                    syncProgress: {
                      totalReceived,
                      totalExpected,
                      recordsReceived
                    }
                  },
                  manufacturerData: d.manufacturerData ? {
                    ...d.manufacturerData,
                    recordCount: remainingRecords,
                    hasRecords: remainingRecords > 0
                  } : d.manufacturerData
                };
              }
              return d;
            });
          });
          setRefreshTrigger(prev => prev + 1);
        }
      } catch (error) {
        console.error('⚠️ [Modern] Error in deviceDataUpdate handler:', error);
      }
    };
    BLEService.on('deviceDataUpdate', eventHandlersRef.current.deviceDataUpdate);
    console.log('📞 [Modern] Device data update event listener registered (single source per flow)');
    eventHandlersRef.current.rssiUpdate = ({ deviceId, rssi }) => {
      if (deviceId == null || rssi == null) return;
      setDevices(prevDevices => {
        const idx = prevDevices.findIndex(d => d.id === deviceId);
        if (idx < 0) return prevDevices;
        const next = [...prevDevices];
        next[idx] = { ...next[idx], rssi };
        return next;
      });
      setRefreshTrigger(prev => prev + 1);
    };
    BLEService.on('rssiUpdate', eventHandlersRef.current.rssiUpdate);
    BLEService.on('rssiUpdated', eventHandlersRef.current.rssiUpdate);
    console.log('📞 [Modern] RSSI update listeners registered (fixes Signal N/A for auto-connect)');
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
    const refreshInterval = setInterval(async () => {
      try {
        const profile = await BLEService.getCurrentProfileName();
        setCurrentProfile(profile);
        const battery = await BLEService.getPhoneBatteryLevel();
        setPhoneBatteryLevel(battery);
        const batteryDisplay = battery !== null ? `${battery}%` : 'Unknown';
        console.log(`🔄 Periodic refresh - Profile: ${profile}, Battery: ${batteryDisplay}`);
      } catch (error) {
        console.log('Periodic refresh failed:', error);
      }
    }, 10000);
    return () => {
      clearInterval(refreshInterval);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      BLEService.stopScanning();
      BLEService.setDeviceListUpdateCallback(null);
      // Use specific handler references to avoid removing other screens' listeners
      if (eventHandlersRef.current.powerProfileChanged) {
        BLEService.off('powerProfileChanged', eventHandlersRef.current.powerProfileChanged);
      }
      if (eventHandlersRef.current.deviceDisconnected) {
        BLEService.off('deviceDisconnected', eventHandlersRef.current.deviceDisconnected);
      }
      if (eventHandlersRef.current.deviceFound) {
        BLEService.off('deviceFound', eventHandlersRef.current.deviceFound);
      }
      if (eventHandlersRef.current.deviceConnected) {
        BLEService.off('deviceConnected', eventHandlersRef.current.deviceConnected);
      }
      if (eventHandlersRef.current.deviceDataUpdate) {
        BLEService.off('deviceDataUpdate', eventHandlersRef.current.deviceDataUpdate);
      }
      if (eventHandlersRef.current.rssiUpdate) {
        BLEService.off('rssiUpdate', eventHandlersRef.current.rssiUpdate);
        BLEService.off('rssiUpdated', eventHandlersRef.current.rssiUpdate);
      }
      console.log('🧹 [Modern] Cleaned up listeners, callbacks, intervals, and scan timeout');
    };
  }, [fadeAnim]);
  // Focus effect - only refresh connected devices on screen focus (no callback re-registration)
  useFocusEffect(
    useCallback(() => {
      // Only refresh data when screen gains focus - callbacks are managed in main useEffect
      (async () => {
        try {
          const connected = await BLEService.getConnectedDevices();
          setConnectedDevices(connected);
          // Also refresh device list from BLEService
          const allKnownDevices = BLEService.getScannedDevices();
          setDevices(prevDevices => {
            const deviceMap = new Map();
            prevDevices.forEach(device => deviceMap.set(device.id, device));
            allKnownDevices.forEach(device => {
              const existing = deviceMap.get(device.id);
              deviceMap.set(device.id, existing ? { ...existing, ...device } : device);
            });
            return Array.from(deviceMap.values());
          });
          setRefreshTrigger(prev => prev + 1);
          console.log('🔗 [Modern] Focus refresh completed:', connected.length, 'connected devices');
        } catch (e) {
          console.warn('⚠️ [Modern] Focus refresh failed:', e?.message);
        }
      })();
      // No cleanup needed - main useEffect manages callbacks
    }, [])
  );
  useEffect(() => {
    if (isScanning) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [isScanning, pulseAnim]);
  useEffect(() => {
    if (rssiScanTimerRef.current) {
      clearTimeout(rssiScanTimerRef.current);
      rssiScanTimerRef.current = null;
    }
    if (rssiScanCycleRef.current) {
      clearInterval(rssiScanCycleRef.current);
      rssiScanCycleRef.current = null;
    }
    console.log('📡 RSSI cycle management now handled by BLEService power profiles');
  }, []);
  const startScan = useCallback(async () => {
    try {
      const hasPermissions = await BLEService.requestPermissions();
      if (!hasPermissions) {
        Alert.alert(
          'Permissions Required',
          'Bluetooth and Location permissions are required to scan for devices. Please grant the required permissions and try again.',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Settings',
              onPress: () => {
                if (Platform.OS === 'android') {
                  Linking.openSettings();
                } else {
                  Linking.openURL('app-settings:');
                }
              }
            }
          ]
        );
        setIsScanning(false);
        return;
      }
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      setIsScanning(true);
      console.log('🔍 Starting scan while preserving existing devices...');
      const SCAN_DURATION_MS = 15000;
      scanTimeoutRef.current = setTimeout(() => {
        console.log('⏰ Auto-stopping scan after 15 seconds (industry standard)');
        BLEService.stopScanning();
        setIsScanning(false);
        scanTimeoutRef.current = null;
        setTimeout(() => {
          setDevices(prevDevices =>
            prevDevices.map(device => ({
              ...device,
              isFreshDiscovery: false
            }))
          );
        }, 3000);
      }, SCAN_DURATION_MS);
      await BLEService.startScanning(
        (device) => {
          if (device.name === "Unknown Device" || device.name === "Unknown") {
            console.log(`🚫 Skipping unknown device: ${device.name} (${device.id})`);
            return;
          }
          console.log(`🔍 Discovered device: ${device.name || 'Unknown'} (${device.id})`);
          setDevices(prevDevices => {
            const existingIndex = prevDevices.findIndex(d => d.id === device.id);
            if (existingIndex >= 0) {
              const updatedDevices = [...prevDevices];
              updatedDevices[existingIndex] = {
                ...updatedDevices[existingIndex],
                ...device,
                lastSeen: Date.now(),
                isFreshDiscovery: true
              };
              return updatedDevices;
            } else {
              return [...prevDevices, {
                ...device,
                lastSeen: Date.now(),
                isFreshDiscovery: true
              }];
            }
          });
        },
        (error) => {
          console.error('Scan error:', error);
          Alert.alert('Scan Error', error.message || 'Failed to scan for devices');
          setIsScanning(false);
          if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
            scanTimeoutRef.current = null;
          }
        }
      );
    } catch (error) {
      console.error('Error starting scan:', error);
      Alert.alert('Error', error.message || 'Failed to start scanning');
      setIsScanning(false);
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
    }
  }, []);
  const stopScan = useCallback(() => {
    BLEService.stopScanning();
    setIsScanning(false);
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    setTimeout(() => {
      setDevices(prevDevices =>
        prevDevices.map(device => ({
          ...device,
          isFreshDiscovery: false
        }))
      );
    }, 3000);
    console.log('🔍 Scan stopped, fresh discovery flags will clear in 3 seconds');
  }, []);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const allDevices = React.useMemo(() => {
    const deviceMap = new Map();
    const allKnownDevices = BLEService.getScannedDevices();
    allKnownDevices.forEach(device => {
      deviceMap.set(device.id, {
        ...device,
        isConnected: device.connectionState === CONNECTION_STATES.CONNECTED,
      });
    });
    connectedDevices.forEach(device => {
      const existing = deviceMap.get(device.id) || {};
      deviceMap.set(device.id, {
        ...existing,
        ...device,
        isConnected: true,
        connectionState: CONNECTION_STATES.CONNECTED,
      });
    });
    devices.forEach(device => {
      const existing = deviceMap.get(device.id);
      if (existing) {
        deviceMap.set(device.id, {
          ...existing,
          rssi: device.rssi || existing.rssi,
          lastSeen: device.lastSeen || existing.lastSeen
        });
      } else {
        deviceMap.set(device.id, { ...device, isConnected: false });
      }
    });
    let result = Array.from(deviceMap.values());
    result = result.map(d => {
      if ((d.deviceData?.recordCount === null || d.deviceData?.recordCount === undefined) &&
        d.manufacturerData?.recordCount !== null &&
        d.manufacturerData?.recordCount !== undefined) {
        return {
          ...d,
          deviceData: {
            ...d.deviceData,
            recordCount: d.manufacturerData.recordCount
          }
        };
      }
      return d;
    });
    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000;
    const VERY_STALE_MS = 30 * 60 * 1000;
    result = result.filter(d => {
      if (d.connectionState === CONNECTION_STATES.CONNECTED) {
        return true;
      }
      if (typeof d.lastSeen === 'number' && (now - d.lastSeen) <= STALE_MS) {
        return true;
      }
      if (d.isFreshDiscovery) {
        return true;
      }
      if (d.connectionState === CONNECTION_STATES.CONNECTING ||
        d.connectionState === CONNECTION_STATES.DISCONNECTING) {
        return true;
      }
      if (typeof d.lastSeen === 'number' && (now - d.lastSeen) > VERY_STALE_MS) {
        console.log(`🧹 Removing very stale device: ${d.name || 'Unknown'} (last seen: ${Math.round((now - d.lastSeen) / 1000 / 60)} minutes ago)`);
        return false;
      }
      return true;
    });
    result = result.filter(d => {
      if (d.name === "Unknown Device" || d.name === "Unknown") {
        return false;
      }
      return true;
    });
    const stateRank = (state) => {
      switch (state) {
        case CONNECTION_STATES.CONNECTED:
          return 3;
        case CONNECTION_STATES.CONNECTING:
          return 2;
        case CONNECTION_STATES.DISCONNECTING:
          return 1;
        default:
          return 0;
      }
    };
    result.sort((a, b) => {
      const sr = stateRank(a.connectionState) - stateRank(b.connectionState);
      if (sr !== 0) return -sr;
      const arssi = typeof a.rssi === 'number' ? a.rssi : -Infinity;
      const brssi = typeof b.rssi === 'number' ? b.rssi : -Infinity;
      if (arssi !== brssi) return brssi - arssi;
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    return result;
  }, [connectedDevices, devices, refreshTrigger]);
  const connectToDevice = useCallback(async (device) => {
    try {
      console.log(`🔗 Attempting to connect to ${device.name} (${device.id})`);
      await BLEService.connectToDevice(
        device.id,
        (deviceId, connectionState) => {
          console.log(`📱 Connection state update: ${deviceId} -> ${connectionState}`);
          setDevices(prevDevices =>
            prevDevices.map(d =>
              d.id === deviceId
                ? { ...d, connectionState }
                : d
            )
          );
        }
      );
      console.log(`✅ Successfully connected to ${device.name}`);
      Alert.alert(
        '✅ Connected',
        `Successfully connected to ${device.name}`,
        [
          {
            text: 'View Details',
            style: 'default',
            onPress: () => navigation.navigate('DeviceDetails', { deviceId: device.id })
          },
          { text: 'OK', style: 'cancel' }
        ]
      );
    } catch (error) {
      console.error('❌ Connection error:', error);
      setDevices(prevDevices =>
        prevDevices.map(d =>
          d.id === device.id
            ? { ...d, connectionState: 'disconnected' }
            : d
        )
      );
      if (error.code === 'PAIRING_FAILED' || error.message.includes('Pairing failed') || error.message.includes('incorrect passkey')) {
        Alert.alert(
          '🔐 Wrong Passkey',
          `Pairing failed - incorrect passkey entered.\n\nPlease try again and enter the correct 6-digit passkey when prompted.\n\n💡 Tip: The passkey is shown on the device during pairing.`,
          [
            { text: 'Try Again', onPress: () => connectToDevice(device) },
            { text: 'Cancel', style: 'cancel' }
          ]
        );
        return;
      }
      const errorType = BLEService.classifyError ? BLEService.classifyError(error) : null;
      const canRetry = BLEService.canRetryError ? BLEService.canRetryError(error) : false;
      const requiresUserAction = BLEService.requiresUserAction ? BLEService.requiresUserAction(error) : false;
      let errorMessage = 'Failed to connect to device';
      let errorTitle = '❌ Connection Error';
      let showRetryButton = false;
      if (error.message.includes('cooldown')) {
        errorMessage = error.message;
      } else if (error.message.includes('Device not connected')) {
        errorMessage = 'Connection failed - device may be out of range or turned off';
      } else if (error.message.includes('timeout') || (errorType === 'TRANSIENT' && canRetry)) {
        errorMessage = 'Connection timed out - please try again';
        showRetryButton = true;
      } else if (error.message.includes('permission') || requiresUserAction) {
        errorMessage = 'Bluetooth permission required - please enable in settings';
      } else if (errorType === 'PERMANENT') {
        errorMessage = 'Device not found or invalid - please scan again';
      } else {
        errorMessage = error.message || 'Failed to connect to device';
        showRetryButton = canRetry;
      }
      const alertButtons = showRetryButton ? [
        { text: 'Retry', onPress: () => connectToDevice(device) },
        { text: 'Cancel', style: 'cancel' }
      ] : [{ text: 'OK', style: 'cancel' }];
      Alert.alert(errorTitle, errorMessage, alertButtons);
    }
  }, [navigation]);
  const disconnectFromDevice = useCallback(async (device) => {
    try {
      await BLEService.disconnectFromDevice(
        device.id,
        (deviceId, connectionState) => {
          setDevices(prevDevices =>
            prevDevices.map(d =>
              d.id === deviceId
                ? { ...d, connectionState }
                : d
            )
          );
        }
      );
    } catch (error) {
      console.error('Disconnection error:', error);
      Alert.alert('Disconnection Error', error.message || 'Failed to disconnect from device');
    }
  }, []);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      console.log('🔄 Starting refresh...');
      const currentDevices = [...devices];
      console.log(`🔄 Preserving ${currentDevices.length} current devices during refresh`);
      await loadConnectedDevices();
      const allKnownDevices = BLEService.getScannedDevices();
      console.log(`🔄 BLE service has ${allKnownDevices.length} known devices`);
      const deviceMap = new Map();
      currentDevices.forEach(device => {
        deviceMap.set(device.id, device);
      });
      allKnownDevices.forEach(device => {
        const existing = deviceMap.get(device.id);
        if (existing) {
          deviceMap.set(device.id, { ...existing, ...device });
        } else {
          deviceMap.set(device.id, device);
        }
      });
      const mergedDevices = Array.from(deviceMap.values());
      console.log(`🔄 Merged devices: ${mergedDevices.length} total`);
      setDevices(mergedDevices);
    } catch (error) {
      console.error('Refresh error:', error);
      console.log('🔄 Refresh failed, keeping existing devices');
    } finally {
      setRefreshing(false);
      console.log('🔄 Refresh completed');
    }
  }, [loadConnectedDevices, devices]);
  const checkPermissions = useCallback(async () => {
    try {
      console.log('🔐 [Modern] Checking permissions...');
      const debugInfo = await BLEPermissions.debugPermissions();
      console.log('🔍 [Modern] Permission debug info:', debugInfo);
      Alert.alert(
        'Permission Status',
        `Platform: ${debugInfo.platform}\nAPI Level: ${debugInfo.apiLevel}\n\nBluetooth Scan: ${debugInfo.availablePermissions?.bluetoothScan || 'N/A'}\nBluetooth Connect: ${debugInfo.availablePermissions?.bluetoothConnect || 'N/A'}\nLocation: ${debugInfo.availablePermissions?.location || 'N/A'}`,
        [
          { text: 'OK' },
          {
            text: 'Force Request',
            onPress: async () => {
              const result = await BLEPermissions.forceRequestPermissions();
              Alert.alert('Force Request Result', result ? 'Permissions granted!' : 'Permissions denied');
            }
          }
        ]
      );
    } catch (error) {
      console.error('Error checking permissions:', error);
      Alert.alert('Error', 'Failed to check permissions');
    }
  }, []);
  const loadConnectedDevices = useCallback(async () => {
    try {
      const connected = await BLEService.getConnectedDevices();
      setConnectedDevices(connected);
      console.log('🔗 [Modern] Loaded connected devices:', connected.length);
    } catch (error) {
      console.error('Error loading connected devices:', error);
    }
  }, []);
  const checkBLEState = useCallback(async () => {
    try {
      const isReady = await BLEService.isBLEReady();
      setBleState(isReady ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF);
    } catch (error) {
      console.error('Error checking BLE state:', error);
      setBleState(BLE_STATES.UNKNOWN);
    }
  }, []);
  const getConnectionButtonText = (device) => {
    switch (device.connectionState) {
      case CONNECTION_STATES.CONNECTING:
        return 'Connecting...';
      case CONNECTION_STATES.CONNECTED:
        return 'Disconnect';
      case CONNECTION_STATES.DISCONNECTING:
        return 'Disconnecting...';
      default:
        return 'Connect';
    }
  };
  const getConnectionButtonStyle = (device) => {
    switch (device.connectionState) {
      case CONNECTION_STATES.CONNECTED:
        return [styles.connectionButton, styles.disconnectButton];
      case CONNECTION_STATES.CONNECTING:
      case CONNECTION_STATES.DISCONNECTING:
        return [styles.connectionButton, styles.loadingButton];
      default:
        return styles.connectionButton;
    }
  };
  const isConnectionInProgress = (device) => {
    return device.connectionState === CONNECTION_STATES.CONNECTING ||
      device.connectionState === CONNECTION_STATES.DISCONNECTING;
  };
  const handleConnectionPress = (device) => {
    if (device.connectionState === CONNECTION_STATES.CONNECTED) {
      disconnectFromDevice(device);
    } else if (device.connectionState === CONNECTION_STATES.DISCONNECTED) {
      connectToDevice(device);
    }
  };
  const renderDevice = ({ item, index }) => {
    const displayRssi = item.rssi ?? (item.id ? BLEService.getDeviceRssi(item.id) : null);
    return (
      <Animated.View
        style={[
          styles.deviceCard,
          {
            opacity: fadeAnim,
            transform: [{
              translateY: fadeAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [50, 0],
              })
            }]
          }
        ]}
      >
        { }
        <View style={[
          styles.connectionIndicator,
          { backgroundColor: getConnectionIndicatorColor(item.connectionState) }
        ]} />
        <View style={styles.deviceHeader}>
          <View style={styles.deviceInfo}>
            <View style={styles.deviceNameContainer}>
              <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
              <View style={styles.deviceBadgesContainer}>
                {item.isFreshDiscovery && (
                  <View style={styles.freshDiscoveryBadge}>
                    { }
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.deviceId}>{item.id}</Text>
            { }
            {item.manufacturerData && (
              <View style={styles.manufacturerDataContainer}>
                {item.manufacturerData.recordCount !== undefined && item.manufacturerData.recordCount > 0 && (
                  <Text style={styles.manufacturerDataText}>
                    📊 {String(item.manufacturerData.recordCount)} records
                  </Text>
                )}
                {item.manufacturerData.deviceStatus && (
                  <Text style={[
                    styles.manufacturerDataText,
                    { color: item.manufacturerData.deviceStatus === 'Good' ? '#4CAF50' : '#FF9800' }
                  ]}>
                    ⚙️ {item.manufacturerData.deviceStatus}
                  </Text>
                )}
                {item.manufacturerData.version !== undefined && (
                  <Text style={styles.manufacturerDataText}>
                    📋 v{String(item.manufacturerData.version)}
                  </Text>
                )}
                {item.manufacturerData.macId && (
                  <Text style={[styles.manufacturerDataText, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11 }]}>
                    📍 MAC ID: {item.manufacturerData.macId}
                  </Text>
                )}
                {item.manufacturerData.connectIndication !== undefined && (
                  <Text style={[
                    styles.manufacturerDataText,
                    { color: item.manufacturerData.connectIndication ? '#2196F3' : '#757575' }
                  ]}>
                    🔗 {item.manufacturerData.connectIndication ? 'Connect' : 'Standby'}
                  </Text>
                )}
                {!item.deviceData?.batteryLevel && item.manufacturerData.batteryLevel > 0 && (
                  <Text style={styles.manufacturerDataText}>
                    {`🔋 ${item.manufacturerData.batteryLevel}% (${item.manufacturerData.batteryMillivolts || 'N/A'}mV)`}
                  </Text>
                )}
                {item.deviceData?.batteryLevel > 0 && (
                  <Text style={styles.manufacturerDataText}>
                    {`🔋 ${item.deviceData.batteryLevel}%`}
                  </Text>
                )}
              </View>
            )}
          </View>
          <View style={styles.deviceMeta}>
            <View style={styles.rssiContainer}>
              <Text style={styles.rssiLabel}>Signal</Text>
              <View style={[styles.rssiBar, { backgroundColor: getRSSIColor(displayRssi) }]}>
                <Text style={styles.rssiText}>{displayRssi != null ? displayRssi : 'N/A'}</Text>
              </View>
            </View>
          </View>
        </View>
        { }
        {item.isDemoTag && (
          <View style={styles.demoBadge}>
            <Text style={styles.demoBadgeText}>🏷️ DEMO</Text>
          </View>
        )}
        { }
        {(item.deviceData?.batteryLevel !== null && item.deviceData?.batteryLevel !== undefined ||
          item.deviceData?.temperature !== null && item.deviceData?.temperature !== undefined ||
          item.deviceData?.steps !== null && item.deviceData?.steps !== undefined ||
          item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined) && (
            <View>
              { }
              <View style={styles.dataRow}>
                { }
                {item.deviceData?.dataSource && (
                  <View style={styles.dataSourceBadge}>
                    <Text style={styles.dataSourceText}>
                      {item.deviceData.dataSource === 'live' ? '🟢 LIVE' :
                        item.deviceData.dataSource === 'synced' ? '💾 SYNCED' : '📦 CACHED'}
                    </Text>
                  </View>
                )}
                { }
                {item.deviceData?.batteryLevel > 0 && (
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>🔋 Battery</Text>
                    <Text style={[styles.dataValue, { color: getBatteryColor(item.deviceData.batteryLevel) }]}>
                      {item.deviceData.batteryLevel}%
                    </Text>
                  </View>
                )}
                {item.deviceData?.temperature !== null && item.deviceData?.temperature !== undefined && item.deviceData?.temperature !== 0 && (
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>🌡️ Temp</Text>
                    <Text style={styles.dataValue}>
                      {String(item.deviceData.temperature?.toFixed(1))}°C
                    </Text>
                  </View>
                )}
                {item.deviceData?.steps !== null && item.deviceData?.steps !== undefined && (
                  <View style={styles.dataItem}>
                    <Text style={styles.dataLabel}>👟 Latest</Text>
                    <Text style={styles.dataValue}>
                      {String(item.deviceData.steps?.toLocaleString())}
                    </Text>
                  </View>
                )}
              </View>
              { }
              {(item.deviceData?.totalSteps !== null && item.deviceData?.totalSteps !== undefined ||
                (item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined)) && (
                  <View style={styles.dataRow}>
                    {item.deviceData?.totalSteps !== null && item.deviceData?.totalSteps !== undefined && (
                      <View style={styles.dataItem}>
                        <Text style={styles.dataLabel}>🏃 Total</Text>
                        <Text style={[styles.dataValue, styles.totalStepsValue]}>
                          {item.deviceData.totalSteps.toLocaleString()}
                        </Text>
                      </View>
                    )}
                    { }
                    {item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined && (
                      <View style={styles.dataItem}>
                        <Text style={styles.dataLabel}>📊 Records</Text>
                        <Text style={[styles.dataValue, { color: item.deviceData.recordCount > 0 ? Colors.primary : Colors.lightText }]}>
                          {item.deviceData.recordCount}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
            </View>
          )}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={getConnectionButtonStyle(item)}
            onPress={() => handleConnectionPress(item)}
            disabled={isConnectionInProgress(item)}
            activeOpacity={0.8}
          >
            {isConnectionInProgress(item) ? (
              <ActivityIndicator size="small" color={Colors.white} />
            ) : (
              <Text style={styles.connectionButtonText}>
                {getConnectionButtonText(item)}
              </Text>
            )}
          </TouchableOpacity>
          {item.connectionState === CONNECTION_STATES.CONNECTED && (
            <TouchableOpacity
              style={styles.detailsButton}
              onPress={() => navigation.navigate('DeviceDetails', { deviceId: item.id })}
              activeOpacity={0.8}
            >
              <Text style={styles.detailsButtonText}>View Details</Text>
            </TouchableOpacity>
          )}
          { }
          {item.connectionState === CONNECTION_STATES.CONNECTED && (
            <TouchableOpacity
              style={[
                styles.forgetButton,
                !BLEService.canForgetDevice(item.id) && styles.forgetButtonDisabled
              ]}
              onPress={() => {
                if (!BLEService.canForgetDevice(item.id)) {
                  Alert.alert('Cannot Forget Device', 'This device is currently connecting. Please wait for the connection to complete or fail before forgetting.');
                  return;
                }
                Alert.alert(
                  'Forget Device',
                  `Are you sure you want to forget "${item.name || 'Unknown Device'}"?\n\nThis will:\n• Disconnect the device\n• Remove pairing data\n• Clear all device history\n• Require manual re-pairing`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Forget Device',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          const result = await BLEService.forgetDevice(item.id);
                          if (result.success) {
                            Alert.alert(
                              'Device Forgotten',
                              `"${result.deviceName}" has been forgotten successfully.\n\nYou'll need to scan and reconnect manually if you want to use it again.`
                            );
                          } else {
                            Alert.alert('Error', `Failed to forget device: ${result.error}`);
                          }
                        } catch (error) {
                          Alert.alert('Error', 'Failed to forget device. Please try again.');
                        }
                      }
                    }
                  ]
                );
              }}
              disabled={!BLEService.canForgetDevice(item.id)}
              activeOpacity={0.8}
            >
              <Text style={[
                styles.forgetButtonText,
                !BLEService.canForgetDevice(item.id) && styles.forgetButtonTextDisabled
              ]}>
                🗑️ Forget
              </Text>
            </TouchableOpacity>
          )}
        </View>
        { }
        { }
        {item.connectionState === CONNECTION_STATES.CONNECTED && (
          <View style={styles.dataButtonsContainer}>
            <TouchableOpacity
              style={styles.liveDataButton}
              onPress={() => {
                console.log('📊 [Modern] Navigating to Live Data screen for device:', item.id);
                navigation.navigate('LiveData', {
                  deviceId: item.id,
                  deviceName: item.name || 'Device'
                });
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dataButtonText}>Live Data</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.connectionLogButton}
              onPress={() => {
                console.log('📋 [Modern] Navigating to Connection Log screen for device:', item.id);
                navigation.navigate('ConnectionLog', {
                  deviceId: item.id,
                  deviceName: item.name || 'Device'
                });
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.connectionLogButtonText}>Connec. logs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.historicalDataButton}
              onPress={() => {
                console.log('📋 [Modern] Navigating to Historical Data screen for device:', item.id);
                navigation.navigate('HistoricalData', {
                  deviceId: item.id,
                  deviceName: item.name || 'Device'
                });
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.dataButtonText}>Historical Data</Text>
            </TouchableOpacity>
          </View>
        )}
      </Animated.View>
    );
  };
  const renderEmptyList = () => (
    <Animated.View style={[styles.emptyContainer, { opacity: fadeAnim }]}>
      <Text style={styles.emptyIcon}>🔍</Text>
      <Text style={styles.emptyText}>
        {isScanning ? 'Scanning for devices...' : 'No devices found'}
      </Text>
      <Text style={styles.emptySubtext}>
        {isScanning
          ? 'Make sure your smart tag is nearby and powered on'
          : 'Pull down to refresh or tap scan to search for devices'
        }
      </Text>
    </Animated.View>
  );
  const renderRefreshingList = () => (
    <Animated.View style={[styles.emptyContainer, { opacity: fadeAnim }]}>
      <Text style={styles.emptyIcon}>🔄</Text>
      <Text style={styles.emptyText}>Refreshing devices...</Text>
      <Text style={styles.emptySubtext}>
        Please wait while we update your device list
      </Text>
    </Animated.View>
  );
  if (bleState !== BLE_STATES.POWERED_ON) {
    return (
      <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
        <StatusBar barStyle="dark-content" backgroundColor={Colors.white} />
        <View style={styles.statusContainer}>
          <Text style={styles.statusIcon}>📶</Text>
          <Text style={styles.statusText}>
            {bleState === BLE_STATES.POWERED_OFF
              ? 'Bluetooth is turned off'
              : 'Bluetooth not available'}
          </Text>
          <Text style={styles.statusSubtext}>
            Please enable Bluetooth to scan for devices
          </Text>
          <TouchableOpacity style={styles.refreshButton} onPress={checkBLEState}>
            <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  }
  return (
    <Animated.View style={[styles.container, { opacity: fadeAnim }]}>
      <StatusBar barStyle="dark-content" backgroundColor={Colors.white} />
      { }
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>Smart Tags</Text>
          <Text style={styles.subtitle}>
            {`${allDevices.length} device${allDevices.length !== 1 ? 's' : ''} found`}
          </Text>
        </View>
        <View style={styles.headerButtons}>
          { }
          <TouchableOpacity
            style={[styles.demoButton, demoModeEnabled && styles.demoButtonActive]}
            onPress={async () => {
              try {
                const newState = !demoModeEnabled;
                await BLEService.setDemoModeEnabled(newState);
                setDemoModeEnabled(newState);
                const allKnownDevices = BLEService.getScannedDevices();
                setDevices(Array.from(allKnownDevices.values()));
              } catch (error) {
                console.error('Error toggling demo mode:', error);
                Alert.alert('Error', 'Failed to toggle demo mode');
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.demoButtonText}>
              {demoModeEnabled ? '🏷️ Demo ON' : '🏷️ Demo'}
            </Text>
          </TouchableOpacity>
          { }
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanButtonActive]}
            onPress={isScanning ? stopScan : startScan}
            activeOpacity={0.8}
          >
            {isScanning ? (
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <ActivityIndicator size="small" color={Colors.white} />
              </Animated.View>
            ) : (
              <Text style={styles.scanButtonText}>
                🔍 Scan
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
      { }
      { }
      {isScanning && (
        <Animated.View style={[styles.scanningIndicator, { opacity: fadeAnim }]}>
          <View style={styles.scanningContent}>
            <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
              <Text style={styles.scanningIcon}>📡</Text>
            </Animated.View>
            <Text style={styles.scanningText}>Scanning for smart tags...</Text>
          </View>
        </Animated.View>
      )}
      <FlatList
        data={allDevices}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        ListEmptyComponent={refreshing ? renderRefreshingList : renderEmptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
            progressBackgroundColor={Colors.white}
          />
        }
        contentContainerStyle={allDevices.length === 0 ? styles.emptyListContainer : styles.listContainer}
        showsVerticalScrollIndicator={false}
      />
      { }
      {refreshing && allDevices.length > 0 && (
        <View style={styles.refreshOverlay}>
          <View style={styles.refreshOverlayContent}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.refreshOverlayText}>Refreshing...</Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
};
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Metrics.baseMargin,
    paddingTop: Metrics.baseMargin,
    paddingBottom: Metrics.baseMargin,
    backgroundColor: Colors.white,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
  },
  headerContent: {
    flex: 1,
  },
  title: {
    fontSize: Fonts.size.h1,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: Fonts.size.medium,
    color: Colors.lightText,
    fontFamily: Fonts.type.regular,
  },
  scanButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  scanButtonActive: {
    backgroundColor: Colors.accent,
  },
  scanButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
  },
  demoButton: {
    backgroundColor: Colors.lightGray,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 80,
    marginRight: Metrics.smallMargin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  demoButtonActive: {
    backgroundColor: Colors.warning,
  },
  demoButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.bold,
    fontFamily: Fonts.type.bold,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Metrics.smallMargin,
  },
  refreshButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 25,
    minWidth: 50,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  refreshButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  scanningIndicator: {
    margin: Metrics.baseMargin,
    marginTop: 0,
    backgroundColor: Colors.primaryLight,
    borderRadius: 16,
    padding: Metrics.baseMargin,
  },
  scanningContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanningIcon: {
    fontSize: 24,
    marginRight: Metrics.smallMargin,
  },
  scanningText: {
    fontSize: Fonts.size.medium,
    color: Colors.primary,
    fontFamily: Fonts.type.medium,
  },
  listContainer: {
    padding: Metrics.baseMargin,
    paddingBottom: Metrics.doubleBaseMargin,
  },
  emptyListContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    padding: Metrics.doubleBaseMargin,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: Metrics.baseMargin,
  },
  emptyText: {
    fontSize: Fonts.size.large,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Metrics.smallMargin,
  },
  emptySubtext: {
    fontSize: Fonts.size.medium,
    color: Colors.lightText,
    textAlign: 'center',
    lineHeight: 20,
  },
  deviceCard: {
    backgroundColor: Colors.white,
    padding: Metrics.baseMargin,
    marginBottom: Metrics.baseMargin,
    borderRadius: 20,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  connectionIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 4,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Metrics.baseMargin,
    marginTop: 4,
  },
  deviceInfo: {
    flex: 1,
    marginRight: Metrics.baseMargin,
  },
  deviceNameContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  deviceBadgesContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Metrics.smallMargin,
  },
  deviceName: {
    fontSize: Fonts.size.large,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    marginRight: Metrics.smallMargin,
  },
  deviceId: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    fontFamily: Fonts.type.regular,
  },
  manufacturerDataContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
  },
  manufacturerDataText: {
    fontSize: Fonts.size.tiny,
    color: Colors.lightText,
    fontFamily: Fonts.type.regular,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    marginRight: 8,
    marginBottom: 4,
    overflow: 'hidden',
  },
  freshDiscoveryBadge: {
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: 2,
    borderRadius: 12,
    alignSelf: 'flex-start',
  },
  freshDiscoveryText: {
    color: Colors.primary,
    fontSize: Fonts.size.tiny,
    fontFamily: Fonts.type.bold,
  },
  demoBadge: {
    backgroundColor: Colors.warning,
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: 'flex-start',
    marginBottom: Metrics.smallMargin,
  },
  demoBadgeText: {
    color: Colors.white,
    fontSize: Fonts.size.tiny,
    fontFamily: Fonts.type.bold,
  },
  deviceMeta: {
    alignItems: 'flex-end',
  },
  rssiContainer: {
    alignItems: 'center',
  },
  rssiLabel: {
    fontSize: Fonts.size.tiny,
    color: Colors.lightText,
    marginBottom: 2,
  },
  rssiBar: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    minWidth: 50,
    alignItems: 'center',
  },
  rssiText: {
    fontSize: Fonts.size.small,
    color: Colors.white,
    fontFamily: Fonts.type.bold,
  },
  dataRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 12,
    padding: Metrics.smallMargin,
    marginBottom: Metrics.baseMargin,
  },
  dataSourceBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 8,
    alignSelf: 'center',
  },
  dataSourceText: {
    fontSize: 9,
    color: '#4CAF50',
    fontFamily: Fonts.type.bold,
  },
  dataItem: {
    alignItems: 'center',
    flex: 1,
  },
  dataLabel: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    marginBottom: 2,
  },
  dataValue: {
    fontSize: Fonts.size.medium,
    color: Colors.text,
    fontFamily: Fonts.type.bold,
  },
  totalStepsValue: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Metrics.smallMargin,
    flexWrap: 'wrap',
  },
  connectionButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  disconnectButton: {
    backgroundColor: Colors.error,
    shadowColor: Colors.error,
  },
  loadingButton: {
    backgroundColor: Colors.lightGray,
    shadowColor: Colors.lightGray,
  },
  connectionButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  detailsButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  detailsButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  forgetButton: {
    backgroundColor: Colors.error,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: Colors.error,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  forgetButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  forgetButtonDisabled: {
    backgroundColor: Colors.lightGray,
    shadowColor: Colors.lightGray,
  },
  forgetButtonTextDisabled: {
    color: Colors.lightText,
  },
  dataButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Metrics.smallMargin,
    marginTop: Metrics.smallMargin,
    flexWrap: 'wrap',
  },
  liveDataButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    minWidth: '31%',
  },
  connectionLogButton: {
    backgroundColor: '#FFE5D9',
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: '#FFE5D9',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    minWidth: '31%',
  },
  historicalDataButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: 12,
    borderRadius: 12,
    flex: 1,
    alignItems: 'center',
    shadowColor: Colors.secondary,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    minWidth: '31%',
  },
  dataButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  connectionLogButtonText: {
    color: Colors.text,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  refreshOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  refreshOverlayContent: {
    backgroundColor: Colors.white,
    padding: Metrics.doubleBaseMargin,
    borderRadius: Metrics.borderRadius,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
    alignItems: 'center',
  },
  refreshOverlayText: {
    marginTop: Metrics.smallMargin,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Metrics.doubleBaseMargin,
  },
  statusIcon: {
    fontSize: 64,
    marginBottom: Metrics.baseMargin,
  },
  statusText: {
    fontSize: Fonts.size.h2,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Metrics.smallMargin,
  },
  statusSubtext: {
    fontSize: Fonts.size.medium,
    color: Colors.lightText,
    textAlign: 'center',
    marginBottom: Metrics.doubleBaseMargin,
    lineHeight: 20,
  },
  refreshButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.doubleBaseMargin,
    paddingVertical: Metrics.baseMargin,
    borderRadius: 25,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  refreshButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
  },
  powerProfileContainer: {
    backgroundColor: Colors.lightGray,
    marginHorizontal: Metrics.baseMargin,
    marginVertical: Metrics.smallMargin,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  batteryAndPowerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Metrics.smallMargin,
  },
  phoneBatteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Metrics.smallMargin,
  },
  phoneBatteryLabel: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
  },
  phoneBatteryLevel: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  phoneBatteryGood: {
    color: Colors.success,
  },
  phoneBatteryMedium: {
    color: Colors.warning,
  },
  phoneBatteryLow: {
    color: Colors.error,
  },
  powerProfileLabel: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
  },
  powerModeDisplay: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
    textAlign: 'center',
    marginTop: Metrics.smallMargin,
    padding: Metrics.smallMargin,
    backgroundColor: Colors.white,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  powerModeValue: {
    fontFamily: Fonts.type.bold,
    color: Colors.primary,
  },
  powerProfileInfo: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    color: Colors.lightText,
    textAlign: 'center',
    marginTop: Metrics.smallMargin,
    fontStyle: 'italic',
  },
  powerProfileSummary: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.bold,
    color: Colors.primary,
    textAlign: 'center',
    marginTop: Metrics.smallMargin,
    backgroundColor: Colors.lightGray,
    padding: 6,
    borderRadius: 6,
  },
  deviceManagementStatus: {
    marginTop: Metrics.smallMargin,
    padding: Metrics.smallMargin,
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  deviceManagementLabel: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: Metrics.smallMargin,
  },
  deviceManagementInfo: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: Metrics.smallMargin,
  },
  deviceManagementSubtext: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
export default ModernBLEManager;