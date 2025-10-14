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
  const [appState, setAppState] = useState(AppState.currentState);

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

    // Set up data update callback for real-time updates (with fallback)
    try {
      if (BLEService && typeof BLEService.setDeviceDataUpdateCallback === 'function') {
        BLEService.setDeviceDataUpdateCallback((updatedDeviceId, deviceData) => {
          if (updatedDeviceId === deviceId && AppState.currentState === 'active') {
            console.log('Device data updated via callback:', deviceData);
            updateDeviceData();
          } else if (updatedDeviceId === deviceId && AppState.currentState !== 'active') {
            console.log('📱 [DeviceDetails] Skipping callback update - app is in background');
          }
        });
        console.log('Callback setup successful');
      } else {
        console.log('Using polling method instead of callbacks');
      }
    } catch (error) {
      console.warn('Callback setup failed, using polling:', error.message);
    }

    // Less frequent polling to reduce excessive updates (fallback method)
    // Only poll when app is active to prevent background updates
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
      try {
        if (BLEService && typeof BLEService.setDeviceDataUpdateCallback === 'function') {
          BLEService.setDeviceDataUpdateCallback(null);
        }
      } catch (error) {
        console.log('Cleanup warning:', error.message);
      }
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
      <View style={styles.infoRow}>
        <Text style={styles.infoLabel}>Smart Tag:</Text>
        <Text style={styles.infoValue}>
          {device.deviceData?.isSmartTag ? 'Yes' : 'No'}
        </Text>
      </View>
      
      {/* Firmware Update Button */}
      <TouchableOpacity
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
      </TouchableOpacity>
    </View>
  );

  const renderDeviceData = () => {
    if (!device.deviceData || device.connectionState !== CONNECTION_STATES.CONNECTED) {
      return null;
    }

    const { deviceData } = device;

    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Live Data</Text>
        
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Battery Level:</Text>
          <Text style={[styles.infoValue, deviceData.batteryLevel !== null ? styles.batteryText : styles.batteryUnavailableText]}>
            {(deviceData.batteryLevel !== null && deviceData.batteryLevel !== undefined) ? `${deviceData?.batteryLevel}%` : 'Not Available'}
          </Text>
        </View>

        {deviceData.temperature !== null && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Temperature:</Text>
            <Text style={[styles.infoValue, styles.temperatureText]}>
              {deviceData.temperature?.toFixed(1)}°C
            </Text>
          </View>
        )}

        {deviceData.steps !== null && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Latest Steps:</Text>
            <Text style={[styles.infoValue, styles.stepsText]}>
              {deviceData.steps?.toLocaleString()}
            </Text>
          </View>
        )}

        {deviceData.totalSteps !== null && deviceData.totalSteps !== undefined && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Total Steps ({deviceData.recordCount || 0} records):</Text>
            <Text style={[styles.infoValue, styles.totalStepsText]}>
              {deviceData.totalSteps?.toLocaleString()}
            </Text>
          </View>
        )}

        {deviceData.lastUpdate && (
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>Last Update (Device RTC):</Text>
            <Text style={styles.infoValue}>
              {deviceData.lastUpdate.toLocaleString()}
            </Text>
            {deviceData.deviceRTC && (
              <Text style={[styles.infoValue, {fontSize: 12, opacity: 0.7}]}>
                (Unix: {deviceData.deviceRTC})
              </Text>
            )}
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
          <Text style={styles.sectionTitle}>Services</Text>
          <Text style={styles.emptyText}>
            {device && device.connectionState === CONNECTION_STATES.CONNECTED 
              ? 'No services discovered' 
              : 'Connect to device to view services'}
          </Text>
          <Text style={[styles.emptyText, {fontSize: 12, marginTop: 10}]}>
            Debug: Device={!!device}, Services={device?.services?.length || 0}, Connected={device?.connectionState === CONNECTION_STATES.CONNECTED}
          </Text>
        </View>
      );
    }

    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Services & Characteristics</Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={refreshServices}
          >
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
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
      </View>
    );
  };

  const renderDebugSection = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>🔧 Debug Tools</Text>
      
      <View style={styles.debugButtonContainer}>
        <TouchableOpacity
          style={[styles.debugButton, styles.primaryButton]}
          onPress={() => {
            console.log('🔍 [UI] Testing device data availability...');
            const result = BLEService.testDeviceDataAvailability(deviceId);
            Alert.alert('Debug Result', `Connected: ${result.connected}\nScanned: ${result.scanned}\nServices: ${result.servicesCount}\nCharacteristics: ${result.characteristicsCount}`);
          }}
        >
          <Text style={styles.debugButtonText}>Check Device Data</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.secondaryButton]}
          onPress={() => {
            console.log('🔍 [UI] Testing system command lookup...');
            BLEService.testSystemCommandLookup(deviceId);
            Alert.alert('Debug', 'Check console for system command lookup results');
          }}
        >
          <Text style={styles.debugButtonText}>Test Command Lookup</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.warningButton]}
          onPress={() => {
            console.log('🧪 [UI] Testing single system command...');
            BLEService.testSingleSystemCommand(deviceId, 0x1).then(result => {
              Alert.alert('System Command Test', `Success: ${result.success}\nError: ${result.error || 'None'}`);
            });
          }}
        >
          <Text style={styles.debugButtonText}>Test Set Time Command</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.infoButton]}
          onPress={() => {
            console.log('🧪 [UI] Testing full system command sequence...');
            BLEService.testSystemCommands(deviceId);
            Alert.alert('Debug', 'Check console for full system command sequence results');
          }}
        >
          <Text style={styles.debugButtonText}>Test All Commands</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, {backgroundColor: '#007AFF'}]}
          onPress={() => {
            console.log('🔔 [UI] Checking notification status...');
            const stats = BLEService.getNotificationStats(deviceId);
            const isActive = BLEService.areNotificationsActive(deviceId);
            Alert.alert(
              'Notification Status', 
              `Active: ${isActive ? 'Yes' : 'No'}\n` +
              `Device Status: ${stats.deviceStatus}\n` +
              `Battery: ${stats.batteryLevel}\n` +
              `Data Transfer: ${stats.dataTransfer}\n` +
              `System Command: ${stats.systemCommand}\n` +
              `Total: ${stats.total}\n` +
              `Last Update: ${stats.lastUpdate ? stats.lastUpdate.toLocaleTimeString() : 'Never'}`
            );
          }}
        >
          <Text style={styles.debugButtonText}>Check Notifications</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.warningButton]}
          onPress={() => {
            console.log('🕐 [UI] Checking device RTC status...');
            BLEService.checkDeviceRTCStatus(deviceId);
            Alert.alert('Debug', 'Check console for RTC status');
          }}
        >
          <Text style={styles.debugButtonText}>Check RTC Status</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.successButton]}
          onPress={async () => {
            console.log('🕐 [UI] Syncing device time...');
            try {
              const result = await BLEService.syncDeviceTime(deviceId);
              console.log('🕐 [UI] Time sync result:', result);
              Alert.alert('Time Sync', result?.success ? 'Time synced successfully!' : 'Time sync failed');
            } catch (error) {
              console.error('🕐 [UI] Time sync error:', error);
              Alert.alert('Time Sync', 'Time sync failed: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>Sync Device Time</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.errorButton]}
          onPress={async () => {
            console.log('🧪 [UI] Testing different timestamp formats...');
            try {
              const result = await BLEService.testTimeSyncFormats(deviceId);
              console.log('🧪 [UI] Test result:', result);
              Alert.alert('Time Sync Test', result?.success ? `Success with format: ${result.format}` : 'No format worked');
            } catch (error) {
              console.error('🧪 [UI] Test error:', error);
              Alert.alert('Time Sync Test', 'Test failed: ' + error.message);
            }
          }}
        >
          <Text style={styles.debugButtonText}>Test Time Formats</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.primaryButton]}
          onPress={() => {
            console.log('🔍 [UI] Force refreshing device data and services...');
            updateDeviceData();
            refreshServices();
            Alert.alert('Debug', 'Device data and services refreshed. Check console for details.');
          }}
        >
          <Text style={styles.debugButtonText}>Force Refresh Services</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.successButton]}
          onPress={() => {
            console.log('🔍 [UI] Expanding all services to show characteristics...');
            if (device?.services) {
              const allServiceUuids = device.services.map(s => s.uuid);
              setExpandedServices(new Set(allServiceUuids));
              Alert.alert('Debug', `Expanded ${allServiceUuids.length} services. Characteristics should now be visible.`);
            } else {
              Alert.alert('Debug', 'No services found to expand');
            }
          }}
        >
          <Text style={styles.debugButtonText}>Expand All Services</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.debugButton, styles.warningButton]}
          onPress={() => {
            console.log('🔧 [UI] Fixing service characteristics mapping...');
            if (device?.id) {
              BLEService.fixServiceCharacteristics(device.id);
              // Refresh the device data to show the fix
              updateDeviceData();
              Alert.alert('Debug', 'Service characteristics mapping fixed. Check console for details.');
            } else {
              Alert.alert('Debug', 'No device ID found');
            }
          }}
        >
          <Text style={styles.debugButtonText}>Fix Service Characteristics</Text>
        </TouchableOpacity>
      </View>
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
      {renderServices()}
      {renderDebugSection()}
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
    backgroundColor: Colors.info,
  },
  errorButton: {
    backgroundColor: Colors.error,
  },

  // 🎯 GET API Status Styles

});

export default DeviceDetails;
