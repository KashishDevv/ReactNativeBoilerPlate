import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
  RefreshControl,
  AppState,
  Platform,
  TextInput,
  Modal,
  Linking,
} from 'react-native';
import BLEService from '../../services/ble/BLEService';
import { 
  CONNECTION_STATES
} from '../../constants/BLEConstants';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';
import { useFocusEffect } from '@react-navigation/native';

const DeviceDetails = ({ route, navigation }) => {
  const { deviceId } = route.params;
  const [device, setDevice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedServices, setExpandedServices] = useState(new Set());
  const [servicesSectionExpanded, setServicesSectionExpanded] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [inputModalVisible, setInputModalVisible] = useState(false);
  const [inputModalConfig, setInputModalConfig] = useState(null);
  const [inputValue, setInputValue] = useState('');
  // Store event handler reference for proper cleanup
  const dataUpdateHandlerRef = React.useRef(null);

  useEffect(() => {
    loadDeviceDetails();
    navigation.setOptions({
      title: device?.name || 'Device Details',
    });

    // Set up AppState listener to handle background/foreground transitions
    const handleAppStateChange = (nextAppState) => {
      console.log(`📱 [DeviceDetails] App state changed: ${appState} → ${nextAppState}`);
      setAppState(nextAppState);
    };

    const appStateSubscription = AppState.addEventListener('change', handleAppStateChange);

    // Set up event listener for real-time updates (uses events instead of callback to avoid conflicts)
    dataUpdateHandlerRef.current = (eventData) => {
      try {
        if (eventData.deviceId === deviceId && AppState.currentState === 'active') {
          console.log('📱 [DeviceDetails] Device data updated via event:', eventData.type);
          updateDeviceData();
        } else if (eventData.deviceId === deviceId && AppState.currentState !== 'active') {
          console.log('📱 [DeviceDetails] Skipping event update - app is in background');
        }
      } catch (error) {
        console.error('📱 [DeviceDetails] Error in data update handler:', error);
      }
    };
    BLEService.on('deviceDataUpdate', dataUpdateHandlerRef.current);
    console.log('📱 [DeviceDetails] Event listener setup successful');

    // Less frequent polling as fallback (only when app is active)
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') {
        updateDeviceData();
      } else {
        console.log('📱 [DeviceDetails] Skipping UI update - app is in background');
      }
    }, 2000); // Update every 2 seconds for better performance

    // Add timeout to prevent infinite loading
    const timeout = setTimeout(() => {
      if (loading) {
        console.log('⚠️ [DeviceDetails] Loading timeout reached, forcing completion');
        setLoading(false);
      }
    }, 5000); // 5 second timeout - more reasonable

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
      appStateSubscription?.remove();
      // Remove only this screen's event listener (not all listeners for the event)
      if (dataUpdateHandlerRef.current) {
        BLEService.off('deviceDataUpdate', dataUpdateHandlerRef.current);
        dataUpdateHandlerRef.current = null;
      }
      console.log('📱 [DeviceDetails] Cleaned up event listener');
    };
  }, [deviceId, device?.name, navigation]);

  // 🎯 GET API INTEGRATION - This starts/stops GET API calling when screen is focused
  useFocusEffect(
    React.useCallback(() => {
      console.log(`📱 [GET API] DeviceDetails screen focused for device: ${deviceId}`);
      
      if (!deviceId) {
        console.log('❌ [GET API] No deviceId available');
        return;
      }

      // Start GET API calling every 15 seconds when screen is focused
      console.log(`📱 [GET API] Starting GET API for device: ${deviceId}`);
      BLEService.setDeviceScreenActive(deviceId, true);

      // Listen for data updates from GET API
      const handleDataUpdate = (data) => {
        // console.log(`📱 [GET API] Received server data update:`, data);
        // You can update your UI here with server data if needed
        // For now, we'll just log it
      };

      BLEService.on('petHealthDataUpdated', handleDataUpdate);

      // Cleanup when screen loses focus
      return () => {
        console.log(`📱 [GET API] DeviceDetails screen losing focus for device: ${deviceId}`);
        
        // Stop listening to events
        BLEService.off('petHealthDataUpdated', handleDataUpdate);
        
        // Stop GET API calling when screen loses focus
        console.log(`📱 [GET API] Stopping GET API for device: ${deviceId}`);
        BLEService.setDeviceScreenActive(deviceId, false);
      };
    }, [deviceId])
  );

  const loadDeviceDetails = async () => {
    try {
      setLoading(true);
      console.log(`📱 [DeviceDetails] Loading details for device: ${deviceId}`);
      
      let deviceData = BLEService.getDevice(deviceId);
      console.log(`📱 [DeviceDetails] Initial device data:`, deviceData ? 'Found' : 'Not found');
      
      // Fallback: attempt to synthesize device if connected but missing from snapshot
      if (!deviceData) {
        console.log('🔎 Device not in scanned snapshot, attempting fallback synthesis...');
        // Check if device is connected using the public method
        if (BLEService.isDeviceConnected(deviceId)) {
          console.log('📱 Device found as connected, loading services...');
          try {
            // Don't wait for service discovery - load it in background
            BLEService.loadDeviceServices(deviceId).catch(error => {
              console.log('⚠️ Background service loading failed:', error.message);
            });
          } catch (error) {
            console.log('⚠️ Could not start service loading:', error.message);
          }
        }
        deviceData = BLEService.getDevice(deviceId);
      }
      
      if (deviceData) {
        console.log(`📱 [DeviceDetails] Device data loaded:`, {
          name: deviceData.name,
          connectionState: deviceData.connectionState,
          hasDeviceData: !!deviceData.deviceData
        });
        
        setDevice(deviceData);
        
        // Only try to request data if device is connected
        if (deviceData.connectionState === CONNECTION_STATES.CONNECTED) {
          console.log('📱 [DeviceDetails] Device is connected, requesting data...');
          try {
            // Enable system commands since we now have proper native implementations
            await BLEService.requestDeviceData(deviceId, { enableSystemCommands: true });
            console.log('📱 [DeviceDetails] Data request completed');
          } catch (error) {
            console.log('⚠️ Could not request device data - device may be disconnected:', error.message);
          }
        } else {
          console.log(`📱 [DeviceDetails] Device not connected (state: ${deviceData.connectionState}), skipping data request`);
        }
        
        // Load services in background without blocking UI
        if (deviceData.connectionState === CONNECTION_STATES.CONNECTED) {
          console.log('📱 [DeviceDetails] Starting background service discovery...');
          BLEService.loadDeviceServices(deviceId).then(() => {
            console.log('📱 [DeviceDetails] Background service discovery completed');
            updateDeviceData(); // Refresh UI with new service data
          }).catch(error => {
            console.log('⚠️ Background service discovery failed:', error.message);
          });
        }
      } else {
        console.log('❌ [DeviceDetails] Device not found in BLE service');
        Alert.alert('Error', 'Device not found', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      }
    } catch (error) {
      console.error('❌ [DeviceDetails] Error loading device details:', error);
      Alert.alert('Error', 'Failed to load device details');
    } finally {
      console.log('📱 [DeviceDetails] Loading completed, setting loading to false');
      setLoading(false);
    }
  };

  const updateDeviceData = () => {
    const deviceData = BLEService.getDeviceDataFresh(deviceId);
    if (deviceData) {
      // Only update if data has actually changed to reduce unnecessary re-renders
      const hasDataChanged = !device || 
        device.deviceData?.batteryLevel !== deviceData.deviceData?.batteryLevel ||
        device.deviceData?.temperature !== deviceData.deviceData?.temperature ||
        device.deviceData?.steps !== deviceData.deviceData?.steps ||
        device.connectionState !== deviceData.connectionState;
      
      if (hasDataChanged) {
        setDevice(deviceData);
        console.log('UI updated with device data:', {
          name: deviceData.name,
          batteryLevel: deviceData.deviceData?.batteryLevel,
          temperature: deviceData.deviceData?.temperature,
          steps: deviceData.deviceData?.steps,
          lastUpdate: deviceData.deviceData?.lastUpdate,
          connectionState: deviceData.connectionState
        });
        
        // Log battery level issue if it's still null
        if (deviceData.deviceData?.batteryLevel === null && deviceData.connectionState === 'connected') {
          console.log('⚠️ Battery level is null - device may not expose battery characteristic');
        }
      }
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      console.log('📱 [DeviceDetails] Refreshing device data...');
      
      // Update device data from BLE service first
      const freshDeviceData = BLEService.getDevice(deviceId);
      if (freshDeviceData) {
        setDevice(freshDeviceData);
        console.log('📱 [DeviceDetails] Fresh device data loaded');
      }
      
      // Only try to load services if device is connected
      if (device?.connectionState === CONNECTION_STATES.CONNECTED) {
        try {
          await BLEService.loadDeviceServices(deviceId);
          updateDeviceData();
        } catch (error) {
          console.log('⚠️ Could not refresh services - device may be disconnected:', error.message);
          // Still update device data even if services can't be loaded
          updateDeviceData();
        }
      } else {
        console.log('📱 Device not connected, skipping service refresh');
        updateDeviceData();
      }
    } catch (error) {
      console.error('Error refreshing device data:', error);
      Alert.alert('Error', 'Failed to refresh device data');
    } finally {
      setRefreshing(false);
    }
  };

  const attemptConnection = async () => {
    try {
      console.log('📱 [DeviceDetails] Attempting manual connection...');
      setLoading(true);
      
      // Try to connect to the device
      await BLEService.connectToDevice(deviceId);
      
      // Wait a moment for connection to complete
      setTimeout(async () => {
        try {
          await loadDeviceDetails();
        } catch (error) {
          console.log('⚠️ Error loading details after connection:', error.message);
          setLoading(false);
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Connection attempt failed:', error);
      Alert.alert('Connection Failed', 'Could not connect to device. Please try again.');
      setLoading(false);
    }
  };

  const refreshServices = async () => {
    try {
      console.log('📱 [DeviceDetails] Manually refreshing services...');
      setLoading(true);
      
      await BLEService.loadDeviceServices(deviceId);
      updateDeviceData();
      
    } catch (error) {
      console.error('❌ Service refresh failed:', error);
      Alert.alert('Refresh Failed', 'Could not refresh services. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const toggleServiceExpansion = (serviceUUID) => {
    const newExpanded = new Set(expandedServices);
    if (newExpanded.has(serviceUUID)) {
      newExpanded.delete(serviceUUID);
    } else {
      newExpanded.add(serviceUUID);
    }
    setExpandedServices(newExpanded);
  };


























  const renderDeviceInfo = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Device Information</Text>
      
      {device.connectionState !== CONNECTION_STATES.CONNECTED && (
        <View style={styles.disconnectedWarning}>
          <Text style={styles.disconnectedWarningText}>
            ⚠️ Device is not connected. Some features may be limited.
          </Text>
          <TouchableOpacity
            style={styles.connectButton}
            onPress={attemptConnection}
          >
            <Text style={styles.connectButtonText}>Try Connect</Text>
          </TouchableOpacity>
        </View>
      )}
      
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Name:</Text>
        <Text style={styles.infoValue}>{device.name || 'Unknown'}</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>ID:</Text>
        <Text style={styles.infoValue}>{device.id}</Text>
      </View>
      {device.manufacturerData?.macId && (
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>MAC Address:</Text>
          <Text style={styles.infoValue}>{device.manufacturerData.macId}</Text>
        </View>
      )}
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>RSSI:</Text>
        <Text style={styles.infoValue}>{device.rssi || 'N/A'} dBm</Text>
      </View>
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Connection State:</Text>
        <Text style={[styles.infoValue, getConnectionStateStyle(device.connectionState)]}>
          {device.connectionState}
        </Text>
      </View>
      {/* Smart Tag Display - Commented Out */}
      {/* <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Smart Tag:</Text>
        <Text style={styles.infoValue}>
          {device.deviceData?.isSmartTag ? 'Yes' : 'No'}
        </Text>
      </View> */}
      
      {/* Firmware Update Button - Commented Out */}
      {/* <TouchableOpacity
        style={styles.firmwareUpdateButton}
        onPress={() => {
          navigation.navigate('DFU', {
            deviceId: device.id,
            deviceName: device.name,
            currentFirmwareVersion: device.firmwareVersion || '1.0.0'
          });
        }}
      >
        <Text style={styles.firmwareUpdateButtonText}>🔧 Check for Firmware Updates</Text>
      </TouchableOpacity> */}
    </View>
  );

  const renderDeviceData = () => {
    // Show Live Data section if deviceData exists, even if not connected (might have synced data)
    if (!device.deviceData) {
      return null;
    }

    const { deviceData } = device;
    
    // Calculate total sync records (matching SyncRecordsScreen)
    const syncRecords = BLEService.getSyncRecords(deviceId);
    const totalSyncRecords = syncRecords ? syncRecords.length : 0;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Details</Text>
        
        {device.connectionState !== CONNECTION_STATES.CONNECTED && (
          <View style={styles.disconnectedWarning}>
            <Text style={styles.disconnectedWarningText}>
              ⚠️ Device is not connected. Showing last synced data.
            </Text>
          </View>
        )}
        
        {/* Battery Information Card */}
        <View style={styles.dataCard}>
          <View style={styles.dataCardHeader}>
            <Text style={styles.dataCardTitle}>🔋 Battery</Text>
          </View>
          <View style={styles.dataCardContent}>
            <View style={styles.dataItem}>
              <Text style={styles.dataItemLabel}>Level</Text>
              <Text style={[styles.dataItemValue, deviceData.batteryLevel !== null ? styles.batteryText : styles.batteryUnavailableText]}>
                {(deviceData.batteryLevel !== null && deviceData.batteryLevel !== undefined) ? `${deviceData?.batteryLevel}%` : 'N/A'}
              </Text>
            </View>
            {deviceData.batteryVoltage !== null && deviceData.batteryVoltage !== undefined && (
              <View style={styles.dataItem}>
                <Text style={styles.dataItemLabel}>Voltage</Text>
                <Text style={styles.dataItemValueSmall}>
                  {deviceData.batteryVoltage}mV
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Activity Data Card */}
        {(deviceData.temperature !== null || deviceData.steps !== null || deviceData.totalSteps !== null || deviceData.recordCount !== null) && (
          <View style={styles.dataCard}>
            <View style={styles.dataCardHeader}>
              <Text style={styles.dataCardTitle}>📊 Activity & Health</Text>
            </View>
            <View style={styles.dataCardContent}>
              {deviceData.temperature !== null && (
                <View style={styles.dataItem}>
                  <Text style={styles.dataItemLabel}>🌡️ Temperature</Text>
                  <View style={styles.dataItemValueContainer}>
                    <Text style={[styles.dataItemValue, styles.temperatureText]}>
                      {deviceData.temperature?.toFixed(1)}°C
                    </Text>
                    <Text style={styles.dataItemHint}>from sync</Text>
                  </View>
                </View>
              )}
              
              {deviceData.steps !== null && (
                <View style={styles.dataItem}>
                  <Text style={styles.dataItemLabel}>👟 Latest Steps</Text>
                  <View style={styles.dataItemValueContainer}>
                    <Text style={[styles.dataItemValue, styles.stepsText]}>
                      {deviceData.steps?.toLocaleString()}
                    </Text>
                    <Text style={styles.dataItemHint}>from sync</Text>
                  </View>
                </View>
              )}

              {deviceData.totalSteps !== null && deviceData.totalSteps !== undefined && (
                <View style={styles.dataItem}>
                  <Text style={styles.dataItemLabel}>🏃 Total Steps</Text>
                  <View style={styles.dataItemValueContainer}>
                    <Text style={[styles.dataItemValue, styles.totalStepsText]}>
                      {deviceData.totalSteps?.toLocaleString()}
                    </Text>
                    {totalSyncRecords > 0 && (
                      <Text style={styles.dataItemHint}>({totalSyncRecords} record{totalSyncRecords !== 1 ? 's' : ''})</Text>
                    )}
                  </View>
                </View>
              )}

              {deviceData.recordCount !== null && deviceData.recordCount !== undefined && (
                <View style={styles.dataItem}>
                  <Text style={styles.dataItemLabel}>📋 Records Available</Text>
                  <View style={styles.dataItemValueContainer}>
                    <Text style={[styles.dataItemValue, deviceData.recordCount > 0 ? styles.stepsText : {}]}>
                      {deviceData.recordCount}
                    </Text>
                    {deviceData.recordCount > 0 && (
                      <Text style={styles.dataItemHint}>Ready to sync</Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Last Update Card */}
        {deviceData.lastUpdate && (
          <View style={styles.dataCard}>
            <View style={styles.dataCardHeader}>
              <Text style={styles.dataCardTitle}>🕐 Last Update</Text>
            </View>
            <View style={styles.dataCardContent}>
              <View style={styles.dataItem}>
                <Text style={styles.dataItemLabel}>Device RTC</Text>
                <View style={styles.dataItemValueContainer}>
                  <Text style={styles.dataItemValue}>
                    {deviceData.lastUpdate.toLocaleString()}
                  </Text>
                  {deviceData.deviceRTC && (
                    <Text style={styles.dataItemHint}>Unix: {deviceData.deviceRTC}</Text>
                  )}
                </View>
              </View>
            </View>
          </View>
        )}
      </View>
    );
  };



  const renderServices = () => {
    // Debug: Log device services info
    console.log('🔍 [renderServices] Device services debug:', {
      device: !!device,
      connectionState: device?.connectionState,
      hasServices: !!device?.services,
      servicesLength: device?.services?.length || 0,
      services: device?.services?.map(s => ({ uuid: s.uuid, characteristics: s.characteristics?.length || 0 })) || []
    });
    
    if (!device || !device.services || device.services.length === 0) {
      return (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.collapsibleHeader}
            onPress={() => setServicesSectionExpanded(!servicesSectionExpanded)}
          >
            <Text style={styles.sectionTitle}>Services & Characteristics</Text>
            <Text style={styles.expandIcon}>
              {servicesSectionExpanded ? '▼' : '▶'}
            </Text>
          </TouchableOpacity>
          {servicesSectionExpanded && (
            <>
              <Text style={styles.emptyText}>
                {device && device.connectionState === CONNECTION_STATES.CONNECTED 
                  ? 'No services discovered' 
                  : 'Connect to device to view services'}
              </Text>
              <Text style={[styles.emptyText, {fontSize: 12, marginTop: 10}]}>
                Debug: Device={!!device}, Services={device?.services?.length || 0}, Connected={device?.connectionState === CONNECTION_STATES.CONNECTED}
              </Text>
            </>
          )}
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <TouchableOpacity
          style={styles.collapsibleHeader}
          onPress={() => setServicesSectionExpanded(!servicesSectionExpanded)}
        >
          <Text style={styles.sectionTitle}>Services & Characteristics</Text>
          <View style={styles.collapsibleHeaderRight}>
            <TouchableOpacity
              style={[styles.refreshButton, { marginRight: Metrics.smallMargin }]}
              onPress={(e) => {
                e.stopPropagation();
                refreshServices();
              }}
            >
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
            <Text style={styles.expandIcon}>
              {servicesSectionExpanded ? '▼' : '▶'}
            </Text>
          </View>
        </TouchableOpacity>
        {servicesSectionExpanded && (
          <>
            {device.services.map((service, index) => (
              <View key={`${service.uuid}-${index}`} style={styles.serviceCard}>
                <TouchableOpacity
                  style={styles.serviceHeader}
                  onPress={() => toggleServiceExpansion(service.uuid)}
                >
                  <View>
                    <Text style={styles.serviceName}>
                      Service ({service.uuid.substring(0, 8)}...)
                    </Text>
                    <Text style={styles.serviceUuid}>{service.uuid}</Text>
                  </View>
                  <Text style={styles.expandIcon}>
                    {expandedServices.has(service.uuid) ? '▼' : '▶'}
                  </Text>
                </TouchableOpacity>

                {expandedServices.has(service.uuid) && (
                  <View style={styles.characteristicsContainer}>
                    {service.characteristics && service.characteristics.length > 0 ? (
                      service.characteristics.map((char, index) => (
                        <View key={`${char.uuid}-${index}-${service.uuid}`} style={styles.characteristicCard}>
                          <View style={styles.characteristicHeader}>
                            <Text style={styles.characteristicName}>
                              Characteristic ({char.uuid.substring(0, 8)}...)
                            </Text>
                            <Text style={styles.characteristicUuid}>{char.uuid}</Text>
                            <Text style={styles.characteristicProperties}>
                              Properties: {JSON.stringify(char.properties || {})}
                            </Text>
                          </View>
                        </View>
                      ))
                    ) : (
                      <View>
                        <Text style={styles.emptyText}>No characteristics found</Text>
                        <Text style={[styles.emptyText, {fontSize: 12, marginTop: 5}]}>
                          Debug: service.characteristics = {service.characteristics ? 'exists' : 'null'}, 
                          length = {service.characteristics?.length || 0}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            ))}
          </>
        )}
      </View>
    );
  };

  // Helper function to show input dialog
  const showInputDialog = (title, message, placeholder, onConfirm, keyboardType = 'numeric') => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        title,
        message,
        [
          {
            text: 'Cancel',
            style: 'cancel',
          },
          {
            text: 'OK',
            onPress: (value) => {
              if (value && value.trim()) {
                onConfirm(value.trim());
              }
            },
          },
        ],
        'plain-text',
        placeholder,
        keyboardType
      );
    } else {
      // Android: Use modal for input
      setInputModalConfig({
        title,
        message,
        placeholder,
        keyboardType,
        onConfirm: (value) => {
          setInputModalVisible(false);
          if (value && value.trim()) {
            onConfirm(value.trim());
          }
        },
        onCancel: () => {
          setInputModalVisible(false);
        },
      });
      setInputValue('');
      setInputModalVisible(true);
    }
  };

  const renderDebugSection = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Device Commands</Text>
      
      <View style={styles.debugButtonContainer}>
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#FF9800'}]}
          onPress={() => {
            showInputDialog(
              'Activate Buzzer',
              'Enter beep count (0-254) or leave empty for max 4 minutes:\n\n• 0-254 = Specific beep count\n• Empty or 255 = Max 4 minutes (default)',
              '255',
              async (value) => {
                try {
                  let beepCount;
                  
                  // Handle empty input or "255" as default (0xFF = max 4 minutes)
                  if (!value || value.trim() === '' || value.trim() === '255') {
                    beepCount = 0xFF; // Max 4 minutes (default)
                    console.log('🔊 [UI] Activating buzzer with default (max 4 minutes)...');
                  } else {
                    const count = parseInt(value.trim(), 10);
                    if (isNaN(count) || count < 0 || count > 254) {
                      Alert.alert('Error', 'Beep count must be between 0-254 (or empty/255 for max 4 minutes)');
                      return;
                    }
                    beepCount = count; // 0x00-0xFE for specific beep count
                    console.log(`🔊 [UI] Activating buzzer with beep count: ${count}...`);
                  }
                  
                  // ✅ SDD v1.4: Toggle Buzzer - beepCount: 0xFF = max 4 minutes (default), or 0x00-0xFE for specific beep count
                  const result = await BLEService.toggleBuzzer(deviceId, true, beepCount);
                  console.log('🔊 [UI] Buzzer activate result:', result);
                  
                  const beepCountText = beepCount === 0xFF 
                    ? 'max 4 minutes (default)' 
                    : `${beepCount} beep${beepCount !== 1 ? 's' : ''}`;
                  
                  Alert.alert(
                    'Toggle Buzzer', 
                    result?.success 
                      ? `Buzzer activated successfully with ${beepCountText}!` 
                      : `Failed: ${result?.error || 'Unknown error'}`
                  );
                } catch (error) {
                  console.error('🔊 [UI] Buzzer activate error:', error);
                  Alert.alert('Toggle Buzzer', 'Failed to activate buzzer: ' + error.message);
                }
              },
              'numeric'
            );
          }}
        >
          <Text style={styles.debugButtonText}>🔊 Activate Buzzer</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#795548'}]}
          onPress={async () => {
            console.log('🔇 [UI] Deactivating buzzer...');
            try {
              const result = await BLEService.toggleBuzzer(deviceId, false);
              console.log('🔇 [UI] Buzzer deactivate result:', result);
              Alert.alert(
                'Toggle Buzzer', 
                result?.success ? 'Buzzer deactivated successfully!' : `Failed: ${result?.error || 'Unknown error'}`
              );
            } catch (error) {
              console.error('🔇 [UI] Buzzer deactivate error:', error);
              Alert.alert('Toggle Buzzer', 'Failed to deactivate buzzer: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>🔇 Deactivate Buzzer</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.errorButton]}
          onPress={async () => {
            console.log('🔓 [UI] Unpairing device...');
            Alert.alert(
              'Unpair Device',
              'This will remove bonding/pairing information from the device. Continue?',
              [
                {
                  text: 'Cancel',
                  style: 'cancel'
                },
                {
                  text: 'Unpair',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      const result = await BLEService.unpairDevice(deviceId);
                      console.log('🔓 [UI] Unpair result:', result);
                      
                      if (result?.success) {
                        // ✅ Navigate back immediately after successful unpair
                        // This prevents the screen from trying to interact with the unpaired device
                        navigation.goBack();
                        
                        // Show success message after navigation
                        setTimeout(() => {
                          Alert.alert('Unpair Device', 'Device unpaired successfully!');
                        }, 500);
                      } else {
                        Alert.alert('Unpair Device', `Failed: ${result?.error || 'Unknown error'}`);
                      }
                    } catch (error) {
                      console.error('🔓 [UI] Unpair error:', error);
                      Alert.alert('Unpair Device', 'Failed to unpair device: ' + error.message);
                    }
                  }
                }
              ]
            );
          }}
        >
          <Text style={styles.debugButtonText}>🔓 Unpair Device</Text>
        </TouchableOpacity>

        {/* All Records Button - Commented Out */}
        {/* <TouchableOpacity
          style={[styles.debugButton, styles.infoButton]}
          onPress={() => {
            console.log('📋 [UI] Navigating to Sync Records screen...');
            try {
              const records = BLEService.getSyncRecords(deviceId);
              
              if (!records || records.length === 0) {
                Alert.alert(
                  'No Records',
                  'No sync records are available for this device. Please sync data first.',
                  [{ text: 'OK' }]
                );
                return;
              }

              // Navigate to Sync Records screen
              navigation.navigate('SyncRecords', {
                deviceId: deviceId,
                deviceName: device?.name || 'Device'
              });
            } catch (error) {
              console.error('📋 [UI] Error navigating to records:', error);
              Alert.alert('Error', 'Failed to load records: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>All Records</Text>
        </TouchableOpacity> */}

        {/* Set Advertising Interval */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#2196F3'}]}
          onPress={() => {
            showInputDialog(
              'Set Advertising Interval',
              'Enter advertising interval in milliseconds (e.g., 2000 for 2 seconds)',
              '2000',
              async (value) => {
                try {
                  const interval = parseInt(value, 10);
                  if (isNaN(interval) || interval < 0) {
                    Alert.alert('Error', 'Please enter a valid positive number');
                    return;
                  }
                  console.log(`📡 [UI] Setting advertising interval to ${interval}ms...`);
                  const result = await BLEService.setAdvertisingInterval(deviceId, interval);
                  console.log('📡 [UI] Set advertising interval result:', result);
                  Alert.alert(
                    'Set Advertising Interval',
                    result?.success ? `Advertising interval set to ${interval}ms successfully!` : `Failed: ${result?.error || 'Unknown error'}`
                  );
                } catch (error) {
                  console.error('📡 [UI] Set advertising interval error:', error);
                  Alert.alert('Set Advertising Interval', 'Failed: ' + error.message);
                }
              }
            );
          }}
        >
          <Text style={styles.debugButtonText}>📡 Set Adv Interval</Text>
        </TouchableOpacity>

        {/* Set Connection Interval */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#2196F3'}]}
          onPress={() => {
            showInputDialog(
              'Set Connection Interval',
              'Enter connection interval in milliseconds (e.g., 100 for 100ms)',
              '100',
              async (value) => {
                try {
                  const interval = parseInt(value, 10);
                  if (isNaN(interval) || interval < 0) {
                    Alert.alert('Error', 'Please enter a valid positive number');
                    return;
                  }
                  console.log(`🔗 [UI] Setting connection interval to ${interval}ms...`);
                  const result = await BLEService.setConnectionInterval(deviceId, interval);
                  console.log('🔗 [UI] Set connection interval result:', result);
                  Alert.alert(
                    'Set Connection Interval',
                    result?.success ? `Connection interval set to ${interval}ms successfully!` : `Failed: ${result?.error || 'Unknown error'}`
                  );
                } catch (error) {
                  console.error('🔗 [UI] Set connection interval error:', error);
                  Alert.alert('Set Connection Interval', 'Failed: ' + error.message);
                }
              }
            );
          }}
        >
          <Text style={styles.debugButtonText}>🔗 Set Conn Interval</Text>
        </TouchableOpacity>

        {/* Set Data Acquisition Interval */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#2196F3'}]}
          onPress={() => {
            showInputDialog(
              'Set Data Acquisition Interval',
              'Enter interval in SECONDS (will be converted to milliseconds):\nExample: 30 seconds = 30000ms',
              '30',
              async (value) => {
                try {
                  const intervalSeconds = parseInt(value, 10);
                  if (isNaN(intervalSeconds) || intervalSeconds < 0) {
                    Alert.alert('Error', 'Please enter a valid positive number');
                    return;
                  }
                  
                  const intervalMs = intervalSeconds * 1000;
                  console.log(`📊 [UI] Setting data acquisition interval to ${intervalSeconds}s (${intervalMs}ms)`);
                  
                  const result = await BLEService.setDataAcquisitionInterval(deviceId, intervalSeconds);
                  console.log('📊 [UI] Set data acquisition interval result:', result);
                  
                  Alert.alert(
                    'Set Data Acquisition Interval',
                    result?.success 
                      ? `✅ Data acquisition interval set to ${intervalSeconds}s (${intervalMs}ms)` 
                      : `❌ Failed: ${result?.error || 'Unknown error'}`
                  );
                } catch (error) {
                  console.error('📊 [UI] Set data acquisition interval error:', error);
                  Alert.alert('Set Data Acquisition Interval', 'Failed: ' + error.message);
                }
              }
            );
          }}
        >
          <Text style={styles.debugButtonText}>📊 Set Data Interval</Text>
        </TouchableOpacity>

        {/* Get Firmware Version */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#4CAF50'}]}
          onPress={async () => {
            console.log('📱 [UI] Getting firmware version...');
            try {
              const result = await BLEService.getFirmwareVersion(deviceId);
              console.log('📱 [UI] Firmware version result:', result);
              Alert.alert(
                'Firmware Version',
                result?.success ? `Firmware Version: ${result?.data || 'N/A'}` : `Failed: ${result?.error || 'Unknown error'}`
              );
            } catch (error) {
              console.error('📱 [UI] Get firmware version error:', error);
              Alert.alert('Get Firmware Version', 'Failed: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>📱 Get FW Version</Text>
        </TouchableOpacity>

        {/* Get Hardware Version */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#4CAF50'}]}
          onPress={async () => {
            console.log('🔧 [UI] Getting hardware version...');
            try {
              const result = await BLEService.getHardwareVersion(deviceId);
              console.log('🔧 [UI] Hardware version result:', result);
              Alert.alert(
                'Hardware Version',
                result?.success ? `Hardware Version: ${result?.data || 'N/A'}` : `Failed: ${result?.error || 'Unknown error'}`
              );
            } catch (error) {
              console.error('🔧 [UI] Get hardware version error:', error);
              Alert.alert('Get Hardware Version', 'Failed: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>🔧 Get HW Version</Text>
        </TouchableOpacity>

        {/* Get Diagnostics */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#4CAF50'}]}
          onPress={async () => {
            console.log('🔍 [UI] Getting diagnostics...');
            try {
              const result = await BLEService.getDiagnostics(deviceId);
              console.log('🔍 [UI] Diagnostics result:', result);
              Alert.alert(
                'Diagnostics',
                result?.success ? `Diagnostics: ${result?.data || 'N/A'}` : `Failed: ${result?.error || 'Unknown error'}`
              );
            } catch (error) {
              console.error('🔍 [UI] Get diagnostics error:', error);
              Alert.alert('Get Diagnostics', 'Failed: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>🔍 Get Diagnostics</Text>
        </TouchableOpacity>

        {/* System Restart */}
        <TouchableOpacity
          style={[styles.debugButton, styles.warningButton]}
          onPress={() => {
            Alert.alert(
              'System Restart',
              'This will restart the device. Continue?',
              [
                {
                  text: 'Cancel',
                  style: 'cancel'
                },
                {
                  text: 'Restart',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      console.log('🔄 [UI] Restarting device...');
                      const result = await BLEService.systemRestart(deviceId);
                      console.log('🔄 [UI] System restart result:', result);
                      Alert.alert(
                        'System Restart',
                        result?.success ? 'Device restart command sent successfully!' : `Failed: ${result?.error || 'Unknown error'}`
                      );
                    } catch (error) {
                      console.error('🔄 [UI] System restart error:', error);
                      Alert.alert('System Restart', 'Failed: ' + error.message);
                    }
                  }
                }
              ]
            );
          }}
        >
          <Text style={styles.debugButtonText}>🔄 System Restart</Text>
        </TouchableOpacity>

        {/* Factory Reset */}
        <TouchableOpacity
          style={[styles.debugButton, styles.errorButton]}
          onPress={() => {
            Alert.alert(
              'Factory Reset',
              '⚠️ WARNING: This will reset the device to factory settings and erase all data. This action cannot be undone. Continue?',
              [
                {
                  text: 'Cancel',
                  style: 'cancel'
                },
                {
                  text: 'Reset',
                  style: 'destructive',
                  onPress: async () => {
                    try {
                      console.log('🏭 [UI] Factory resetting device...');
                      const result = await BLEService.factoryReset(deviceId);
                      console.log('🏭 [UI] Factory reset result:', result);
                      Alert.alert(
                        'Factory Reset',
                        result?.success ? 'Factory reset command sent successfully!' : `Failed: ${result?.error || 'Unknown error'}`
                      );
                    } catch (error) {
                      console.error('🏭 [UI] Factory reset error:', error);
                      Alert.alert('Factory Reset', 'Failed: ' + error.message);
                    }
                  }
                }
              ]
            );
          }}
        >
          <Text style={styles.debugButtonText}>🏭 Factory Reset</Text>
        </TouchableOpacity>

        {/* Passkey Update */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#9C27B0'}]}
          onPress={() => {
            showInputDialog(
              'Update Passkey',
              'Enter new 6-digit passkey (0-9)',
              '123456',
              async (value) => {
                try {
                  if (!/^\d{6}$/.test(value)) {
                    Alert.alert('Error', 'Passkey must be exactly 6 digits (0-9)');
                    return;
                  }
                  console.log(`🔐 [UI] Updating passkey to ${value}...`);
                  const result = await BLEService.updatePasskey(deviceId, value);
                  console.log('🔐 [UI] Passkey update result:', result);
                  
                  if (result?.success) {
                    if (Platform.OS === 'ios') {
                      // iOS-specific alert with detailed instructions
                      Alert.alert(
                        '🔐 Passkey Updated Successfully',
                        `New passkey: ${value}\n\nThe device will disconnect momentarily.\n\n⚠️ IMPORTANT: To reconnect, you MUST:\n\n1. Open iOS Settings → Bluetooth\n2. Find "${device?.name || 'DyreID'}"\n3. Tap (i) icon → "Forget This Device"\n4. Return to app and reconnect\n5. Enter NEW passkey when prompted\n\nThis is required because iOS caches the old passkey.`,
                        [
                          {
                            text: 'Open Settings',
                            onPress: () => {
                              Linking.openURL('App-Prefs:root=Bluetooth').catch(() => {
                                // Fallback if Bluetooth deep link doesn't work
                                Linking.openSettings();
                              });
                            }
                          },
                          { text: 'I Understand', style: 'cancel' }
                        ]
                      );
                    } else {
                      // Android: Show alert with instructions to forget/unpair device
                      Alert.alert(
                        '🔐 Passkey Updated Successfully',
                        `New passkey: ${value}\n\nThe device will disconnect momentarily.\n\n⚠️ IMPORTANT: To reconnect, you MUST:\n\n1. Open Android Settings → Bluetooth\n2. Find "${device?.name || 'DyreID'}"\n3. Tap the settings icon → "Forget" or "Unpair"\n4. Return to app and reconnect\n5. Enter NEW passkey when prompted\n\nThis is required because Android caches the old passkey at system level.`,
                        [
                          {
                            text: 'Open Settings',
                            onPress: () => {
                              Linking.openSettings();
                            }
                          },
                          { text: 'I Understand', style: 'cancel' }
                        ]
                      );
                    }
                  } else {
                    Alert.alert('Update Passkey', `Failed: ${result?.error || 'Unknown error'}`);
                  }
                } catch (error) {
                  console.error('🔐 [UI] Passkey update error:', error);
                  Alert.alert('Update Passkey', 'Failed: ' + error.message);
                }
              },
              'numeric'
            );
          }}
        >
          <Text style={styles.debugButtonText}>🔐 Update Passkey</Text>
        </TouchableOpacity>

        {/* Send Custom Command */}
        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#FF9800'}]}
          onPress={() => {
            showInputDialog(
              'Send Custom Command',
              'Enter command ID (hex, e.g., 0x05 or 05) and optional data (hex, e.g., 01 02 03)\nFormat: commandId [data]',
              '0x05',
              async (value) => {
                try {
                  // Parse input: "0x05" or "05 01 02 03" or "0x05 01 02 03"
                  const parts = value.trim().split(/\s+/);
                  
                  // Parse command ID (remove 0x prefix if present)
                  let cmdIdStr = parts[0].toLowerCase().replace('0x', '');
                  const commandId = parseInt(cmdIdStr, 16);
                  
                  if (isNaN(commandId) || commandId < 0 || commandId > 255) {
                    Alert.alert('Error', 'Invalid command ID. Must be 0x00-0xFF (0-255)');
                    return;
                  }
                  
                  // Parse optional data bytes
                  let dataBytes = null;
                  if (parts.length > 1) {
                    dataBytes = [];
                    for (let i = 1; i < parts.length; i++) {
                      const hexByte = parts[i].toLowerCase().replace('0x', '');
                      const byte = parseInt(hexByte, 16);
                      if (isNaN(byte) || byte < 0 || byte > 255) {
                        Alert.alert('Error', `Invalid data byte at position ${i}: ${parts[i]}`);
                        return;
                      }
                      dataBytes.push(byte);
                    }
                  }
                  
                  console.log(`📤 [UI] Sending custom command: ID=0x${commandId.toString(16).toUpperCase().padStart(2, '0')}, Data=${dataBytes ? dataBytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') : 'none'}`);
                  
                  const result = await BLEService.sendSystemCommand(deviceId, commandId, dataBytes);
                  console.log('📤 [UI] Custom command result:', result);
                  
                  Alert.alert(
                    'Custom Command',
                    result?.success 
                      ? `✅ Command 0x${commandId.toString(16).toUpperCase().padStart(2, '0')} sent successfully!\n\nResponse: ${result.parsedData ? JSON.stringify(result.parsedData, null, 2) : 'No response data'}` 
                      : `❌ Failed: ${result?.error || 'Unknown error'}`
                  );
                } catch (error) {
                  console.error('📤 [UI] Custom command error:', error);
                  Alert.alert('Custom Command', 'Failed: ' + error.message);
                }
              },
              'default'
            );
          }}
        >
          <Text style={styles.debugButtonText}>📤 Send Custom Command</Text>
        </TouchableOpacity>
      </View>

      {/* Input Modal for Android */}
      <Modal
        visible={inputModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setInputModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            {inputModalConfig && (
              <>
                <Text style={styles.modalTitle}>{inputModalConfig.title}</Text>
                <Text style={styles.modalMessage}>{inputModalConfig.message}</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder={inputModalConfig.placeholder}
                  value={inputValue}
                  onChangeText={setInputValue}
                  keyboardType={inputModalConfig.keyboardType || 'numeric'}
                  autoFocus={true}
                />
                <View style={styles.modalButtons}>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonCancel]}
                    onPress={inputModalConfig.onCancel}
                  >
                    <Text style={styles.modalButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalButton, styles.modalButtonConfirm]}
                    onPress={() => inputModalConfig.onConfirm(inputValue)}
                  >
                    <Text style={styles.modalButtonText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
  
  const getConnectionStateStyle = (state) => {
    switch (state) {
      case CONNECTION_STATES.CONNECTED:
        return styles.connectedText;
      case CONNECTION_STATES.CONNECTING:
      case CONNECTION_STATES.DISCONNECTING:
        return styles.connectingText;
      default:
        return styles.disconnectedText;
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Loading device details...</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Device not found</Text>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[Colors.primary]}
          tintColor={Colors.primary}
        />
      }
    >
      {renderDeviceInfo()}
      {renderDeviceData()}
      {renderDebugSection()}
      {renderServices()}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  loadingText: {
    marginTop: Metrics.baseMargin,
    fontSize: Fonts.size.medium,
    color: Colors.text,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    padding: Metrics.doubleBaseMargin,
  },
  errorText: {
    fontSize: Fonts.size.large,
    color: Colors.error,
    textAlign: 'center',
    marginBottom: Metrics.doubleBaseMargin,
  },
  backButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.doubleBaseMargin,
    paddingVertical: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
  },
  backButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  section: {
    backgroundColor: Colors.white,
    margin: Metrics.baseMargin,
    padding: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  sectionTitle: {
    fontSize: Fonts.size.large,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    marginBottom: Metrics.baseMargin,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  collapsibleHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  refreshButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
  },
  refreshButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
  },
  disconnectedWarning: {
    backgroundColor: Colors.warning,
    padding: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
    marginBottom: Metrics.smallMargin,
  },
  disconnectedWarningText: {
    color: Colors.white,
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    textAlign: 'center',
    marginBottom: Metrics.smallMargin,
  },
  connectButton: {
    backgroundColor: Colors.white,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
    alignSelf: 'center',
  },
  connectButtonText: {
    color: Colors.warning,
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Metrics.smallMargin,
  },
  infoLabel: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.lightText,
    flex: 1,
  },
  infoValue: {
    fontSize: Fonts.size.medium,
    color: Colors.text,
    flex: 2,
    textAlign: 'right',
  },
  connectedText: {
    color: Colors.success,
  },
  connectingText: {
    color: Colors.warning,
  },
  disconnectedText: {
    color: Colors.error,
  },
  batteryText: {
    color: Colors.success,
  },
  batteryUnavailableText: {
    color: Colors.lightText,
    fontStyle: 'italic',
  },
  temperatureText: {
    color: Colors.primary,
  },
  stepsText: {
    color: Colors.secondary,
  },
  totalStepsText: {
    color: Colors.primary,
    fontWeight: 'bold',
  },
  
  // Live Data Card Styles
  dataCard: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: Metrics.borderRadius,
    marginBottom: Metrics.baseMargin,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dataCardHeader: {
    backgroundColor: Colors.lightGray,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  dataCardTitle: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  dataCardContent: {
    padding: Metrics.baseMargin,
  },
  dataItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Metrics.smallMargin,
    paddingVertical: Metrics.smallMargin / 2,
  },
  dataItemLabel: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.lightText,
    flex: 1,
  },
  dataItemValueContainer: {
    flex: 1,
    alignItems: 'flex-end',
  },
  dataItemValue: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'right',
  },
  dataItemValueSmall: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.regular,
    color: Colors.lightText,
    textAlign: 'right',
  },
  dataItemHint: {
    fontSize: Fonts.size.tiny,
    color: Colors.lightText,
    fontStyle: 'italic',
    marginTop: 2,
    textAlign: 'right',
  },


  emptyText: {
    fontSize: Fonts.size.medium,
    color: Colors.lightText,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  serviceCard: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Metrics.borderRadius,
    marginBottom: Metrics.baseMargin,
  },
  serviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Metrics.baseMargin,
    backgroundColor: Colors.lightGray,
  },
  serviceName: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  serviceUuid: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    marginTop: 2,
  },
  expandIcon: {
    fontSize: Fonts.size.medium,
    color: Colors.primary,
  },
  characteristicsContainer: {
    padding: Metrics.baseMargin,
  },
  characteristicCard: {
    backgroundColor: Colors.background,
    padding: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    marginBottom: Metrics.smallMargin,
  },
  characteristicHeader: {
    marginBottom: Metrics.smallMargin,
  },
  characteristicName: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
  },
  characteristicUuid: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    marginTop: 2,
  },
  characteristicProperties: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    marginTop: 2,
    fontFamily: Fonts.type.mono,
  },

  // Firmware Update Button
  firmwareUpdateButton: {
    backgroundColor: Colors.primary,
    padding: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    marginTop: Metrics.baseMargin,
    alignItems: 'center',
  },
  firmwareUpdateButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontWeight: '600',
  },
  
  // Button Styles
  debugButtonContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: Metrics.baseMargin,
  },
  debugButton: {
    paddingVertical: Metrics.smallMargin,
    paddingHorizontal: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    marginBottom: Metrics.smallMargin,
    minWidth: '48%',
    alignItems: 'center',
  },
  debugButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: Colors.primary,
  },
  secondaryButton: {
    backgroundColor: Colors.secondary,
  },
  successButton: {
    backgroundColor: Colors.success,
  },
  warningButton: {
    backgroundColor: Colors.warning,
  },
  infoButton: {
    backgroundColor: Colors.secondary,
  },
  errorButton: {
    backgroundColor: Colors.error,
  },

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.white,
    borderRadius: Metrics.borderRadius,
    padding: Metrics.baseMargin * 2,
    width: '80%',
    maxWidth: 400,
  },
  modalTitle: {
    fontSize: Fonts.size.large,
    fontWeight: 'bold',
    color: Colors.text,
    marginBottom: Metrics.smallMargin,
  },
  modalMessage: {
    fontSize: Fonts.size.medium,
    color: Colors.lightText,
    marginBottom: Metrics.baseMargin,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Metrics.borderRadius,
    padding: Metrics.smallMargin,
    fontSize: Fonts.size.medium,
    color: Colors.text,
    marginBottom: Metrics.baseMargin,
    backgroundColor: Colors.white,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  modalButton: {
    paddingVertical: Metrics.smallMargin,
    paddingHorizontal: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    minWidth: 80,
    alignItems: 'center',
    marginLeft: Metrics.smallMargin,
  },
  modalButtonCancel: {
    backgroundColor: Colors.lightText,
  },
  modalButtonConfirm: {
    backgroundColor: Colors.primary,
  },
  modalButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontWeight: '600',
  },

  // 🎯 GET API Status Styles

});

export default DeviceDetails;
