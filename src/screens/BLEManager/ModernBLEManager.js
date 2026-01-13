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

// Helper functions for modern UI
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
  // Track last sync completion time per device to ignore device_status events immediately after sync
  const lastSyncCompleteTime = useRef(new Map());
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [currentPowerProfile, setCurrentProfile] = useState('default');
  const [phoneBatteryLevel, setPhoneBatteryLevel] = useState(null);
  const [bleState, setBleState] = useState(BLE_STATES.UNKNOWN);
  const [refreshing, setRefreshing] = useState(false);
  // DemoTag: Demo mode state
  const [demoModeEnabled, setDemoModeEnabled] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;
  const rssiScanTimerRef = React.useRef(null);
  const rssiScanCycleRef = React.useRef(null);
  const scanTimeoutRef = React.useRef(null); // ✅ Auto-stop scan timeout

  useEffect(() => {
    checkBLEState();
    
    // Get current power profile
    const getCurrentProfile = async () => {
      try {
        const profile = await BLEService.getCurrentProfileName();
        setCurrentProfile(profile);
      } catch (error) {
        console.log('Could not get current power profile:', error);
      }
    };
    getCurrentProfile();
    
    // Get phone battery level
    const getPhoneBattery = async () => {
      try {
        // Try to get detailed battery info first
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
    
    // Request permissions early
    const requestPermissionsEarly = async () => {
      try {
        await BLEService.requestPermissions();
      } catch (error) {
        console.log('Permission request failed:', error);
      }
    };
    requestPermissionsEarly();

    // DemoTag: Load demo mode state
    const loadDemoModeState = async () => {
      try {
        const enabled = BLEService.isDemoModeEnabled();
        setDemoModeEnabled(enabled);
      } catch (error) {
        console.log('Could not load demo mode state:', error);
      }
    };
    loadDemoModeState();
    
    // Load connected devices on mount
    (async () => {
      try {
        const connected = await BLEService.getConnectedDevices();
        setConnectedDevices(connected);
        console.log('🔗 [Modern] Loaded connected devices:', connected.length);
      } catch (e) {
        console.warn('⚠️ [Modern] Failed loading connected devices', e?.message);
      }
    })();
    
    // Register device list update callback (auto-connect events)
    BLEService.setDeviceListUpdateCallback(async () => {
      // console.log('🔄 [Modern] Device list update triggered - reloading connected devices');
      try {
        const connected = await BLEService.getConnectedDevices();
        setConnectedDevices(connected);
        console.log('🔗 [Modern] Refreshed connected devices:', connected.length);
        
            // ✅ CRITICAL FIX: Force UI refresh by updating refresh trigger
        // This ensures allDevices useMemo recalculates with fresh data from BLEService
        setRefreshTrigger(prev => prev + 1);
        
        // Also update devices state for immediate UI feedback
        const allKnownDevices = BLEService.getScannedDevices();
        setDevices(prevDevices => {
          const deviceMap = new Map();
          
          // First add all existing devices to preserve them
          prevDevices.forEach(device => {
            deviceMap.set(device.id, device);
          });
          
          // Then update with fresh data from BLE service
          allKnownDevices.forEach(device => {
            const existing = deviceMap.get(device.id);
            if (existing) {
              // Update existing device with fresh data (connection state, RSSI, etc.)
              deviceMap.set(device.id, { ...existing, ...device });
            } else {
              // Add new device
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

    // Register power profile change listener
    BLEService.on('powerProfileChanged', (data) => {
      console.log('⚡ Power profile changed:', data);
      setCurrentProfile(data.newProfile);
    });
    console.log('📞 [Modern] Power profile change listener registered');
    
    // ✅ Register device disconnection listener to clear stale data
    BLEService.on('deviceDisconnected', (device) => {
      // ✅ CRITICAL FIX: Handle both id and deviceId for compatibility
      const deviceId = device.id || device.deviceId;
      console.log('🧹 [Modern] Device disconnected, clearing stale data:', deviceId, {
        hasId: !!device.id,
        hasDeviceId: !!device.deviceId,
        connectionState: device.connectionState
      });
      
      // ✅ Show iOS Settings alert if passkey was changed (iOS only - Android handles it differently)
      if ((device.passkeyChanged || device.needsSystemForget) && Platform.OS === 'ios') {
        Alert.alert(
          '🔐 Passkey Updated Successfully',
          `The device passkey has been changed.\n\n⚠️ IMPORTANT: You must forget this device from iOS Settings to reconnect:\n\n1. Open iOS Settings → Bluetooth\n2. Find "${device.name || 'DyreID'}"\n3. Tap (i) icon → "Forget This Device"\n4. Return to app and reconnect with NEW passkey\n\nThis is required because iOS caches the old passkey at system level.`,
          [
            {
              text: 'Open Settings',
              onPress: () => {
                // iOS doesn't allow direct deep link to specific device
                // But we can open Bluetooth settings
                Linking.openURL('App-Prefs:root=Bluetooth').catch(() => {
                  // Fallback if Bluetooth deep link doesn't work
                  Linking.openSettings();
                });
              }
            },
            { text: 'I Understand', style: 'cancel' }
          ]
        );
      }
      
      // ✅ CRITICAL FIX: Get fresh device data from BLEService to ensure accurate state
      const allKnownDevices = BLEService.getScannedDevices();
      const freshDevice = allKnownDevices.find(d => d.id === deviceId);
      
      // ✅ CRITICAL FIX: Remove device from connectedDevices state immediately
      // This prevents allDevices useMemo from overriding disconnected state with stale connectedDevices
      setConnectedDevices(prevConnected => 
        prevConnected.filter(d => d.id !== deviceId && d.id !== device.deviceId)
      );
      
      setDevices(prevDevices => 
        prevDevices.map(d => {
          // ✅ CRITICAL FIX: Match by both id and deviceId
          if (d.id === deviceId || d.id === device.deviceId || deviceId === d.id) {
            // Use fresh device data from BLEService if available, otherwise use event data
            const deviceToUse = freshDevice || device;
            
            console.log('🔄 [Modern] Updating device state to disconnected:', deviceId, {
              freshDeviceState: freshDevice?.connectionState,
              eventDeviceState: device.connectionState
            });
            
            // Clear stale characteristic data on disconnect
            return {
              ...d,
              ...deviceToUse, // Spread fresh device data to ensure all fields are updated
              id: deviceId, // Ensure id is set correctly
              connectionState: CONNECTION_STATES.DISCONNECTED, // Force disconnected state
              batteryLevel: null,
              temperature: null,
              steps: null,
              timestamp: null,
              services: [],
              characteristics: [],
              deviceData: d.deviceData ? {
                ...d.deviceData,
                // Preserve recordCount if available (might be useful for reconnection)
                recordCount: d.deviceData.recordCount
              } : null,
              disconnectedAt: new Date(),
              disconnectReason: device.reason || device.error || 'disconnected'
            };
          }
          return d;
        })
      );
      
      // ✅ CRITICAL FIX: Also trigger refresh to ensure allDevices useMemo recalculates
      setRefreshTrigger(prev => prev + 1);
      
      // ✅ CRITICAL FIX: Also refresh connectedDevices from BLEService to ensure consistency
      // This ensures the connectedDevices state is in sync with BLEService
      setTimeout(async () => {
        try {
          const connected = await BLEService.getConnectedDevices();
          setConnectedDevices(connected);
          console.log('🔄 [Modern] Refreshed connectedDevices after disconnection:', connected.length);
        } catch (error) {
          console.warn('⚠️ [Modern] Failed to refresh connectedDevices after disconnection:', error);
        }
      }, 100);
    });
    console.log('📞 [Modern] Device disconnection listener registered');
    
    // ✅ CRITICAL FIX: Listen for deviceFound events to update UI automatically
    // This ensures UI updates when Android discovers devices during scanning
    BLEService.on('deviceFound', (device) => {
      console.log('🔍 [Modern] Device found event received:', device.name, device.id);
      setDevices(prevDevices => {
        const existingIndex = prevDevices.findIndex(d => d.id === device.id);
        if (existingIndex >= 0) {
          // Update existing device with fresh scan data
          const updatedDevices = [...prevDevices];
          updatedDevices[existingIndex] = {
            ...updatedDevices[existingIndex],
            ...device,
            lastSeen: Date.now(),
            isFreshDiscovery: true
          };
          return updatedDevices;
        } else {
          // Add newly discovered device
          return [...prevDevices, {
            ...device,
            lastSeen: Date.now(),
            isFreshDiscovery: true
          }];
        }
      });
      // Also trigger refresh to ensure allDevices useMemo recalculates
      setRefreshTrigger(prev => prev + 1);
    });
    console.log('📞 [Modern] Device found event listener registered');
    
    // ✅ CRITICAL FIX: Listen for deviceConnected events to update UI automatically
    // Android sends DeviceConnected events that need to update the UI
    BLEService.on('deviceConnected', (device) => {
      console.log('🔗 [Modern] Device connected event received:', device.deviceId || device.id, device.deviceName || device.name);
      
      // ✅ CRITICAL FIX: Refresh from BLEService.getScannedDevices() to get complete device info
      // Auto-connected devices are stored in BLEService.scannedDevices, so we need to fetch from there
      const allKnownDevices = BLEService.getScannedDevices();
      const deviceId = device.deviceId || device.id;
      const knownDevice = allKnownDevices.find(d => d.id === deviceId);
      
      setDevices(prevDevices => {
        const existingIndex = prevDevices.findIndex(d => d.id === deviceId);
        
        // Use device info from BLEService if available (more complete), otherwise use event data
        const deviceData = knownDevice || device;
        
        // ✅ CRITICAL FIX: Ensure RSSI is properly set - read it if not available
        // For auto-connected devices, RSSI might not be available immediately
        // We'll try to get it from knownDevice first, then from device, then trigger a read
        let rssiValue = deviceData.rssi || device.rssi || null;
        
        // If RSSI is not available, schedule an RSSI read after a short delay
        if (!rssiValue && deviceId) {
          setTimeout(async () => {
            try {
              // Try to read RSSI from the device
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
          }, 2000); // Wait 2 seconds for connection to stabilize
        }
        
        if (existingIndex >= 0) {
          // Update existing device
          const updatedDevices = [...prevDevices];
          const existingDevice = updatedDevices[existingIndex];
          const existingDeviceData = existingDevice.deviceData || {};
          const newDeviceData = deviceData.deviceData || {};
          
          // ✅ SMART MERGE: Prioritize meaningful values, don't let 0 overwrite good data
          // Priority: new non-zero > existing non-zero > fallback to whatever is available
          const mergedDeviceData = {
            ...existingDeviceData,
            // Steps: Prefer new non-zero, then existing non-zero, then whatever is available
            steps: (newDeviceData.steps !== undefined && newDeviceData.steps !== 0) 
              ? newDeviceData.steps  // New has meaningful value, use it (fresher data)
              : (existingDeviceData.steps !== undefined && existingDeviceData.steps !== 0)
                ? existingDeviceData.steps  // Existing has meaningful value, keep it (don't overwrite with 0)
                : (newDeviceData.steps !== undefined ? newDeviceData.steps : existingDeviceData.steps),  // Use whatever is available
            // Temperature: Prefer new non-zero, then existing non-zero, then whatever is available
            temperature: (newDeviceData.temperature !== undefined && newDeviceData.temperature !== 0)
              ? newDeviceData.temperature  // New has meaningful value, use it (fresher data)
              : (existingDeviceData.temperature !== undefined && existingDeviceData.temperature !== 0)
                ? existingDeviceData.temperature  // Existing has meaningful value, keep it (don't overwrite with 0)
                : (newDeviceData.temperature !== undefined ? newDeviceData.temperature : existingDeviceData.temperature),  // Use whatever is available
            // Update other fields normally
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
            // ✅ CRITICAL FIX: Preserve existing RSSI if new one is not available
            rssi: rssiValue !== null ? rssiValue : existingDevice.rssi,
            // ✅ CRITICAL FIX: Use merged deviceData instead of spreading deviceData.deviceData
            deviceData: mergedDeviceData
          };
          return updatedDevices;
        } else {
          // ✅ CRITICAL FIX: Add new device if it doesn't exist (for auto-connected devices)
          // Auto-connected devices may not be in the scan list yet
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
            // ✅ CRITICAL FIX: Initialize deviceData to prevent showing 0, 0
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
      // Trigger refresh to ensure allDevices useMemo recalculates
      setRefreshTrigger(prev => prev + 1);
    });
    console.log('📞 [Modern] Device connected event listener registered');
    
    // ✅ CRITICAL FIX: Listen for deviceDataUpdate events to update recordCount and live data
    // This ensures UI updates immediately when recordCount changes or live data arrives
    BLEService.on('deviceDataUpdate', (eventData) => {
      console.log('📥 [Modern] deviceDataUpdate event received:', eventData.type, 'for device:', eventData.deviceId);
      if (!eventData.deviceId) {
        console.warn('⚠️ [Modern] deviceDataUpdate event missing deviceId:', eventData);
        return;
      }
      
      // Handle sync_complete events - set recordCount to 0 after sync
      if (eventData.type === 'sync_complete') {
        console.log('📊 [Modern] Sync complete - setting recordCount to 0:', eventData.deviceId);
        
        // Track sync completion time to ignore device_status events for 10 seconds
        lastSyncCompleteTime.current.set(eventData.deviceId, Date.now());
        
        setDevices(prevDevices => {
          return prevDevices.map(d => {
            if (d.id === eventData.deviceId) {
              // ✅ CRITICAL: Preserve totalSteps, steps, and temperature
              // Use values from eventData first (if provided), otherwise preserve from existing deviceData
              const preservedTotalSteps = eventData.totalSteps !== undefined ? eventData.totalSteps : d.deviceData?.totalSteps;
              const preservedSteps = eventData.steps !== undefined ? eventData.steps : d.deviceData?.steps;
              const preservedTemperature = eventData.temperature !== undefined ? eventData.temperature : d.deviceData?.temperature;
              
              return {
                ...d,
                deviceData: {
                  ...d.deviceData,
                  ...eventData.deviceData,
                  recordCount: 0, // Always 0 after sync complete
                  // ✅ Preserve totalSteps, steps, and temperature (from event or existing)
                  totalSteps: preservedTotalSteps,
                  steps: preservedSteps,
                  temperature: preservedTemperature,
                },
                manufacturerData: d.manufacturerData ? {
                  ...d.manufacturerData,
                  recordCount: 0,
                  hasRecords: false
                } : d.manufacturerData
              };
            }
            return d;
          });
        });
        setRefreshTrigger(prev => prev + 1);
      }
      
      // ✅ Handle live_data events (live steps/temperature updates)
      if (eventData.type === 'live_data' && eventData.deviceData) {
        console.log('📊 [Modern] Live data received:', eventData.deviceId, {
          steps: eventData.deviceData.steps,
          temperature: eventData.deviceData.temperature,
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
                  // Preserve existing recordCount if not in event
                  recordCount: eventData.deviceData.recordCount !== undefined 
                    ? eventData.deviceData.recordCount 
                    : d.deviceData?.recordCount
                }
              };
            }
            return d;
          });
        });
        // Trigger refresh to ensure allDevices useMemo recalculates
        setRefreshTrigger(prev => prev + 1);
      }
      
      // Handle device_status events - only update recordCount from polling reads
      if (eventData.type === 'device_status' && eventData.deviceData?.recordCount !== undefined) {
        const deviceId = eventData.deviceId;
        const isFromPolling = eventData.deviceData?.isFromPolling === true;
        
        // SIMPLE: Only update if from polling, otherwise ignore
        if (!isFromPolling) {
          return; // Ignore keep-alive reads
        }
        
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
      
      // ✅ Handle sync_records events (live sync progress updates)
      if (eventData.type === 'sync_records') {
        const totalReceived = eventData.totalReceived || 0;
        const totalExpected = eventData.totalExpected || 0;
        const recordsReceived = eventData.recordsReceived || 0;
        const remainingRecords = Math.max(0, totalExpected - totalReceived);
        
        console.log('📊 [Modern] Sync progress received:', eventData.deviceId, `${totalReceived}/${totalExpected} records (${remainingRecords} remaining)`);
        
        setDevices(prevDevices => {
          return prevDevices.map(d => {
            if (d.id === eventData.deviceId) {
              return {
                ...d,
                deviceData: {
                  ...d.deviceData,
                  recordCount: remainingRecords, // Update with remaining records
                  syncProgress: {
                    totalReceived,
                    totalExpected,
                    recordsReceived
                  }
                },
                // Also update manufacturerData for consistency
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
        // Trigger refresh to ensure allDevices useMemo recalculates
        setRefreshTrigger(prev => prev + 1);
      }
    });
    console.log('📞 [Modern] Device data update event listener registered');
    
    // ✅ CRITICAL FIX: Set up device data update callback for live notifications
    BLEService.setDeviceDataUpdateCallback((deviceId, deviceData) => {
      // Update the specific device in the devices list
      setDevices(prevDevices => {
        return prevDevices.map(d => {
          if (d.id === deviceId) {
            // Get fresh device data from BLEService
            const allKnownDevices = BLEService.getScannedDevices();
            const freshDevice = allKnownDevices.find(dev => dev.id === deviceId);
            
            // SIMPLE: Only update recordCount if isFromPolling is true, otherwise keep existing value
            const isFromPolling = deviceData.isFromPolling === true;
            const recordCount = isFromPolling ? deviceData.recordCount : d.deviceData?.recordCount;
            
            return {
              ...d,
              deviceData: {
                ...(freshDevice?.deviceData || d.deviceData),
                ...deviceData,
                recordCount: recordCount !== undefined ? recordCount : d.deviceData?.recordCount,
              },
              manufacturerData: d.manufacturerData ? {
                ...d.manufacturerData,
                recordCount: recordCount !== undefined ? recordCount : d.manufacturerData.recordCount,
                hasRecords: (recordCount !== undefined ? recordCount : d.manufacturerData.recordCount) > 0,
              } : d.manufacturerData,
              ...(freshDevice && {
                rssi: freshDevice.rssi,
                connectionState: freshDevice.connectionState,
              }),
            };
          }
          return d;
        });
      });
      setRefreshTrigger(prev => prev + 1);
    });
    console.log('📞 [Modern] Device data update callback registered for live notifications');
    
    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    // Set up periodic refresh of power profile and battery level
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
    }, 10000); // Refresh every 10 seconds

    // Cleanup interval on unmount
    return () => {
      clearInterval(refreshInterval);
      // ✅ Clean up scan timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
      BLEService.stopScanning();
      BLEService.setDeviceListUpdateCallback(null);
      BLEService.setDeviceDataUpdateCallback(null); // ✅ Clean up device data update callback
      BLEService.off('powerProfileChanged');
      BLEService.off('deviceDisconnected');
      BLEService.off('deviceFound'); // ✅ Clean up deviceFound listener
      BLEService.off('deviceConnected'); // ✅ Clean up deviceConnected listener
      BLEService.off('deviceDataUpdate'); // ✅ Clean up deviceDataUpdate listener
      console.log('🧹 [Modern] Cleaned up listeners, callbacks, intervals, and scan timeout');
    };
  }, [fadeAnim]);

  // Ensure refresh when screen comes into focus (navigation)
  useFocusEffect(
    useCallback(() => {
      (async () => {
        try {
          const connected = await BLEService.getConnectedDevices();
          setConnectedDevices(connected);
          console.log('🔗 [Modern] Focus refresh connected devices:', connected.length);
        } catch (e) {
          console.warn('⚠️ [Modern] Focus refresh failed:', e?.message);
        }
      })();
      
      // Also re-register callback on focus
      BLEService.setDeviceListUpdateCallback(async () => {
        // console.log('🔄 [Modern] (focus) Device list update triggered');
        try {
          const connected = await BLEService.getConnectedDevices();
          setConnectedDevices(connected);
          
          // ✅ CRITICAL FIX: Force UI refresh by updating refresh trigger
          setRefreshTrigger(prev => prev + 1);
          
          // Also update devices state for immediate UI feedback
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
        } catch {}
      });
      
      return () => {
        BLEService.setDeviceListUpdateCallback(null);
      };
    }, [])
  );

  // Pulse animation for scanning indicator
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

  // Light background scan cycles to keep RSSI updated for connected devices
  // Note: This is now handled by BLEService RSSI cycle management
  // The hardcoded RSSI cycle has been replaced with profile-based management
  useEffect(() => {
    // Cleanup any existing timers
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
      // Check and request permissions first
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

      // Clear any existing scan timeout
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }

      setIsScanning(true);
      
      // Don't clear devices - preserve existing ones and add new discoveries
      // This follows industry standards where device lists persist across scan cycles
      console.log('🔍 Starting scan while preserving existing devices...');
      
      // ✅ INDUSTRY STANDARD: Auto-stop scan after 15 seconds (15000ms)
      // This matches native layer timeout and prevents battery drain
      const SCAN_DURATION_MS = 15000; // 15 seconds - industry standard for BLE scanning
      scanTimeoutRef.current = setTimeout(() => {
        console.log('⏰ Auto-stopping scan after 15 seconds (industry standard)');
        // Stop scanning (idempotent - safe to call even if already stopped)
        BLEService.stopScanning();
        setIsScanning(false);
        // Clear timeout reference
        scanTimeoutRef.current = null;
        // Clear fresh discovery flags after scan stops
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
          // Filter out devices with "Unknown Device" name
          if (device.name === "Unknown Device" || device.name === "Unknown") {
            console.log(`🚫 Skipping unknown device: ${device.name} (${device.id})`);
            return;
          }
          
          console.log(`🔍 Discovered device: ${device.name || 'Unknown'} (${device.id})`);
          setDevices(prevDevices => {
            const existingIndex = prevDevices.findIndex(d => d.id === device.id);
            if (existingIndex >= 0) {
              // Update existing device with fresh scan data
              const updatedDevices = [...prevDevices];
              updatedDevices[existingIndex] = {
                ...updatedDevices[existingIndex],
                ...device,
                lastSeen: Date.now(), // Update last seen timestamp
                isFreshDiscovery: true // Mark as fresh discovery
              };
              return updatedDevices;
            } else {
              // Add newly discovered device
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
          // Clear timeout on error
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
      // Clear timeout on error
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
        scanTimeoutRef.current = null;
      }
    }
  }, []);

  const stopScan = useCallback(() => {
    BLEService.stopScanning();
    setIsScanning(false);
    
    // ✅ Clear scan timeout if it exists
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = null;
    }
    
    // Clear fresh discovery flags after scan stops (industry standard behavior)
    // This prevents "New" badges from staying forever
    setTimeout(() => {
      setDevices(prevDevices => 
        prevDevices.map(device => ({
          ...device,
          isFreshDiscovery: false
        }))
      );
    }, 3000); // Clear after 3 seconds (industry standard)
    
    console.log('🔍 Scan stopped, fresh discovery flags will clear in 3 seconds');
  }, []);

  // ✅ Force refresh trigger - increments when we need to refresh allDevices from BLEService
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Combine connected devices with ALL known devices from BLE service
  const allDevices = React.useMemo(() => {
    const deviceMap = new Map();

    // First add all known devices from BLE service's scannedDevices
    const allKnownDevices = BLEService.getScannedDevices();
    allKnownDevices.forEach(device => {
      deviceMap.set(device.id, {
        ...device,
        isConnected: device.connectionState === CONNECTION_STATES.CONNECTED,
      });
    });

    // Override with fresh connected device info (may have updated data)
    connectedDevices.forEach(device => {
      const existing = deviceMap.get(device.id) || {};
      deviceMap.set(device.id, {
        ...existing,
        ...device,
        isConnected: true,
        connectionState: CONNECTION_STATES.CONNECTED,
      });
    });

    // Enhance with any additional scan data (RSSI updates, etc.)
    devices.forEach(device => {
      const existing = deviceMap.get(device.id);
      if (existing) {
        // Update RSSI and other scan data for existing devices
        deviceMap.set(device.id, { 
          ...existing, 
          rssi: device.rssi || existing.rssi,
          lastSeen: device.lastSeen || existing.lastSeen 
        });
      } else {
        // Add newly discovered devices
        deviceMap.set(device.id, { ...device, isConnected: false });
      }
    });

    let result = Array.from(deviceMap.values());
    
    // ✅ CRITICAL FIX: Ensure deviceData.recordCount is populated from manufacturerData if not set
    // This ensures the sync button appears when recordCount is available in manufacturer data
    result = result.map(d => {
      // If deviceData.recordCount is not set but manufacturerData.recordCount is available, copy it
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
    
    // Smart device lifecycle management - follow industry standards
    const now = Date.now();
    const STALE_MS = 5 * 60 * 1000; // 5 minutes for disconnected devices (industry standard)
    const VERY_STALE_MS = 30 * 60 * 1000; // 30 minutes for very old devices
    
    result = result.filter(d => {
      // Always keep connected devices
      if (d.connectionState === CONNECTION_STATES.CONNECTED) {
        return true;
      }
      
      // Keep recently seen devices (within 5 minutes)
      if (typeof d.lastSeen === 'number' && (now - d.lastSeen) <= STALE_MS) {
        return true;
      }
      
      // Keep devices that were discovered in current scan session
      if (d.isFreshDiscovery) {
        return true;
      }
      
      // Keep devices that are connecting/disconnecting
      if (d.connectionState === CONNECTION_STATES.CONNECTING || 
          d.connectionState === CONNECTION_STATES.DISCONNECTING) {
        return true;
      }
      
      // Remove very old devices (older than 30 minutes) unless they're special
      if (typeof d.lastSeen === 'number' && (now - d.lastSeen) > VERY_STALE_MS) {
        console.log(`🧹 Removing very stale device: ${d.name || 'Unknown'} (last seen: ${Math.round((now - d.lastSeen) / 1000 / 60)} minutes ago)`);
        return false;
      }
      
      return true;
    });
    
    // Filter out devices with "Unknown Device" name
    result = result.filter(d => {
      if (d.name === "Unknown Device" || d.name === "Unknown") {
        // console.log(`🚫 Filtering out unknown device: ${d.name} (${d.id})`);
        return false;
      }
      return true;
    });
    // Sort: connected first, then by RSSI (strongest first), then by name
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
    // console.log('📱 [Modern] Final device list:', result.map(d => `${d.name} (${d.connectionState})`));
    return result;
  }, [connectedDevices, devices, refreshTrigger]); // ✅ Added refreshTrigger to force recalculation on Android events

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
      
      // Update device state to disconnected on error
      setDevices(prevDevices => 
        prevDevices.map(d => 
          d.id === device.id 
            ? { ...d, connectionState: 'disconnected' }
            : d
        )
      );
      
      // ✅ Check for pairing/passkey errors first
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
      
      // ✅ SYNC WITH ANDROID: Use error classification for better error handling
      const errorType = BLEService.classifyError ? BLEService.classifyError(error) : null;
      const canRetry = BLEService.canRetryError ? BLEService.canRetryError(error) : false;
      const requiresUserAction = BLEService.requiresUserAction ? BLEService.requiresUserAction(error) : false;
      
      // Show user-friendly error message based on error classification
      let errorMessage = 'Failed to connect to device';
      let errorTitle = '❌ Connection Error';
      let showRetryButton = false;
      
      if (error.message.includes('cooldown')) {
        errorMessage = error.message; // Use the cooldown message as-is (shows remaining seconds)
      } else if (error.message.includes('Device not connected')) {
        errorMessage = 'Connection failed - device may be out of range or turned off';
      } else if (error.message.includes('timeout') || (errorType === 'TRANSIENT' && canRetry)) {
        errorMessage = 'Connection timed out - please try again';
        showRetryButton = true; // Show retry for transient errors
      } else if (error.message.includes('permission') || requiresUserAction) {
        errorMessage = 'Bluetooth permission required - please enable in settings';
      } else if (errorType === 'PERMANENT') {
        errorMessage = 'Device not found or invalid - please scan again';
      } else {
        errorMessage = error.message || 'Failed to connect to device';
        showRetryButton = canRetry; // Show retry if error can be retried
      }
      
      // Show alert with retry option for transient errors
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
      
      // Preserve current devices during refresh
      const currentDevices = [...devices];
      console.log(`🔄 Preserving ${currentDevices.length} current devices during refresh`);
      
      // Refresh connected devices
      await loadConnectedDevices();
      
      // Get updated device list from BLE service
      const allKnownDevices = BLEService.getScannedDevices();
      console.log(`🔄 BLE service has ${allKnownDevices.length} known devices`);
      
      // Merge existing devices with updated data instead of replacing
      const deviceMap = new Map();
      
      // First add all current devices to preserve them
      currentDevices.forEach(device => {
        deviceMap.set(device.id, device);
      });
      
      // Then update with fresh data from BLE service
      allKnownDevices.forEach(device => {
        const existing = deviceMap.get(device.id);
        if (existing) {
          // Update existing device with fresh data
          deviceMap.set(device.id, { ...existing, ...device });
        } else {
          // Add new device
          deviceMap.set(device.id, device);
        }
      });
      
      const mergedDevices = Array.from(deviceMap.values());
      console.log(`🔄 Merged devices: ${mergedDevices.length} total`);
      
      setDevices(mergedDevices);
      
    } catch (error) {
      console.error('Refresh error:', error);
      // On error, keep existing devices
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


  const renderDevice = ({ item, index }) => (
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
      {/* Connection Status Indicator */}
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
                    {/* <Text style={styles.freshDiscoveryText}>🆕 New</Text> */}
                  </View>
                )}
              </View>
            </View>
            <Text style={styles.deviceId}>{item.id}</Text>
            
            {/* ✅ Manufacturer Data Display (SDD v1.4) */}
            {item.manufacturerData && (
              <View style={styles.manufacturerDataContainer}>
                {/* Record count from advertisement packet - show for all devices */}
                {item.manufacturerData.recordCount !== undefined && item.manufacturerData.recordCount > 0 && (
                  <Text style={styles.manufacturerDataText}>
                    📊 {String(item.manufacturerData.recordCount)} records
                  </Text>
                )}

                {/* Device status (available in both versions) */}
                {item.manufacturerData.deviceStatus && (
                  <Text style={[
                    styles.manufacturerDataText,
                    { color: item.manufacturerData.deviceStatus === 'Good' ? '#4CAF50' : '#FF9800' }
                  ]}>
                    ⚙️ {item.manufacturerData.deviceStatus}
                  </Text>
                )}

                {/* New SDD v1.4 fields */}
                {item.manufacturerData.version !== undefined && (
                  <Text style={styles.manufacturerDataText}>
                    📋 v{String(item.manufacturerData.version)}
                  </Text>
                )}

                {item.manufacturerData.macId && (
                  <Text style={[styles.manufacturerDataText, { fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', fontSize: 11 }]}>
                    📍 {item.manufacturerData.macId}
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

                {/* Battery display - Prioritize 2A19 characteristic battery level over manufacturer data */}
                {/* Show manufacturer data battery only if we don't have characteristic battery level */}
                {!item.deviceData?.batteryLevel && item.manufacturerData.batteryLevel > 0 && (
                  <Text style={styles.manufacturerDataText}>
                    {`🔋 ${item.manufacturerData.batteryLevel}% (${item.manufacturerData.batteryMillivolts || 'N/A'}mV)`}
                  </Text>
                )}
                {/* Show characteristic battery level when available (more accurate) */}
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
            <View style={[styles.rssiBar, { backgroundColor: getRSSIColor(item.rssi) }]}>
              <Text style={styles.rssiText}>{item.rssi || 'N/A'}</Text>
            </View>
          </View>
          

        </View>
      </View>

      {/* DemoTag: Demo device badge */}
      {item.isDemoTag && (
        <View style={styles.demoBadge}>
          <Text style={styles.demoBadgeText}>🏷️ DEMO</Text>
        </View>
      )}

      {/* Data Row - Live/Synced Data */}
      {(item.deviceData?.batteryLevel !== null && item.deviceData?.batteryLevel !== undefined || 
        item.deviceData?.temperature !== null && item.deviceData?.temperature !== undefined || 
        item.deviceData?.steps !== null && item.deviceData?.steps !== undefined ||
        item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined) && (
        <View>
          {/* First Row: Data Source, Battery, Temperature, Latest Steps */}
          <View style={styles.dataRow}>
            {/* Data Source Indicator */}
            {item.deviceData?.dataSource && (
              <View style={styles.dataSourceBadge}>
                <Text style={styles.dataSourceText}>
                  {item.deviceData.dataSource === 'live' ? '🟢 LIVE' : 
                   item.deviceData.dataSource === 'synced' ? '💾 SYNCED' : '📦 CACHED'}
                </Text>
              </View>
            )}
            
            {/* Battery - Only show after connection with valid data */}
            {item.deviceData?.batteryLevel > 0 && (
              <View style={styles.dataItem}>
                <Text style={styles.dataLabel}>🔋 Battery</Text>
                <Text style={[styles.dataValue, { color: getBatteryColor(item.deviceData.batteryLevel) }]}>
                  {item.deviceData.batteryLevel}%
                </Text>
              </View>
            )}
            
            {item.deviceData?.temperature !== null && item.deviceData?.temperature !== undefined && (
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

          {/* Second Row: Total Steps, Records */}
          {(item.deviceData?.totalSteps !== null && item.deviceData?.totalSteps !== undefined ||
            (item.connectionState === CONNECTION_STATES.CONNECTED && 
             item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined)) && (
            <View style={styles.dataRow}>
              {item.deviceData?.totalSteps !== null && item.deviceData?.totalSteps !== undefined && (
                <View style={styles.dataItem}>
                  <Text style={styles.dataLabel}>🏃 Total</Text>
                  <Text style={[styles.dataValue, styles.totalStepsValue]}>
                    {item.deviceData.totalSteps.toLocaleString()}
                  </Text>
                </View>
              )}

              {/* Only show record count for connected devices */}
              {item.connectionState === CONNECTION_STATES.CONNECTED && 
               item.deviceData?.recordCount !== null && item.deviceData?.recordCount !== undefined && (
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

        {/* Forget Device Button - Only for connected devices */}
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

      {/* Live Data, Connection Log & Historical Data Buttons */}
      {/* Only show data buttons when device is connected */}
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
      
      {/* Modern Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.title}>Smart Tags</Text>
          <Text style={styles.subtitle}>
            {`${allDevices.length} device${allDevices.length !== 1 ? 's' : ''} found`}
          </Text>
        </View>
        
        <View style={styles.headerButtons}>
          
          {/* DemoTag: Demo mode toggle button */}
          <TouchableOpacity
            style={[styles.demoButton, demoModeEnabled && styles.demoButtonActive]}
            onPress={async () => {
              try {
                const newState = !demoModeEnabled;
                await BLEService.setDemoModeEnabled(newState);
                setDemoModeEnabled(newState);
                // Refresh device list
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
          
          {/* <TouchableOpacity
            style={[styles.refreshButton, { backgroundColor: Colors.error }]}
            onPress={checkPermissions}
            activeOpacity={0.8}
          >
            <Text style={styles.refreshButtonText}>🔐</Text>
          </TouchableOpacity> */}
          
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

      {/* Phone Battery & Power Profile */}
      {/* <View style={styles.powerProfileContainer}>
        <View style={styles.batteryAndPowerHeader}>
          <View style={styles.phoneBatteryContainer}>
            <Text style={styles.phoneBatteryLabel}>📱 Phone Battery:</Text>
            <Text style={[
              styles.phoneBatteryLevel,
              phoneBatteryLevel <= 20 ? styles.phoneBatteryLow : 
              phoneBatteryLevel <= 50 ? styles.phoneBatteryMedium : 
              styles.phoneBatteryGood
            ]}>
              {phoneBatteryLevel !== null ? `${phoneBatteryLevel}%` : 'N/A'}
            </Text>

          </View>
          <Text style={styles.powerProfileLabel}>Power Mode:</Text>
        </View>
        
        <Text style={styles.powerModeDisplay}>
          {'Current Power Mode: '}
          <Text style={styles.powerModeValue}>
            {currentPowerProfile === 'default' ? '⚡ Normal' : 
             currentPowerProfile === 'lowPower' ? '🔋 Low Power' : 
             '💡 Ultra Low Power'}
          </Text>
        </Text>
        
        <Text style={styles.powerProfileInfo}>
          💡 Power mode automatically adjusts based on phone battery level
        </Text>
        <Text style={styles.powerProfileSummary}>
          {`📊 Current Mode: ${currentPowerProfile === 'default' ? 'Normal (30s health, 30s RSSI)' : 
                           currentPowerProfile === 'lowPower' ? 'Low Power (60s health, 30s RSSI)' : 
                           'Ultra-Low Power (60s health, 60s RSSI)'}`}
        </Text>
        <Text style={[styles.powerProfileInfo, {fontSize: 11, marginTop: 4}]}>
          📡 Data is batched and uploaded every 5 minutes (live updates sent immediately on alerts)
        </Text>

      </View> */}

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

      {/* Refresh Overlay - Shows when refreshing but devices are still visible */}
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
  // DemoTag: Demo button styles
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
  // DemoTag: Demo badge styles
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
    backgroundColor: '#FFE5D9', // Peach color matching Connection Log screen
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
  // Power Profile Styles
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
