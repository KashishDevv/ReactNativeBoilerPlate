import React, { useState, useEffect, useCallback } from 'react';
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
import { CONNECTION_STATES, SCAN_STATES, BLE_STATES } from '../../constants/BLEConstants';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';
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

const BLEManager = ({ navigation }) => {
  const [devices, setDevices] = useState([]);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [bleState, setBleState] = useState(BLE_STATES.UNKNOWN);
  const [refreshing, setRefreshing] = useState(false);
  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const pulseAnim = React.useRef(new Animated.Value(1)).current;

  useEffect(() => {
    checkBLEState();
    loadConnectedDevices(); // Load connected devices on mount
    
    // Request permissions early
    const requestPermissionsEarly = async () => {
      try {
        await BLEService.requestPermissions();
      } catch (error) {
        console.log('Permission request failed:', error);
      }
    };
    requestPermissionsEarly();
    
    // Set up device list update callback for auto-connect events
    BLEService.setDeviceListUpdateCallback(() => {
      console.log('🔄 Device list update triggered - reloading connected devices');
      loadConnectedDevices();
    });
    
    console.log('📞 Device list update callback has been registered');
    
    // Fade in animation
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();

    return () => {
      BLEService.stopScanning();
      // Clean up callback
      BLEService.setDeviceListUpdateCallback(null);
      console.log('🧹 Device list update callback cleaned up');
    };
  }, [fadeAnim]); // Removed loadConnectedDevices from dependencies to avoid re-registering

  // Load connected devices on component mount and refresh
  const loadConnectedDevices = useCallback(async () => {
    try {
      const connected = await BLEService.getConnectedDevices();
      setConnectedDevices(connected);
      console.log('🔗 Loaded connected devices:', connected.length);
      console.log('🔗 Connected devices details:', connected.map(d => `${d.name} (${d.id.slice(-6)}) - ${d.connectionState}`));
    } catch (error) {
      console.error('Error loading connected devices:', error);
    }
  }, []);

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

  const checkBLEState = async () => {
    try {
      const isReady = await BLEService.isBLEReady();
      setBleState(isReady ? BLE_STATES.POWERED_ON : BLE_STATES.POWERED_OFF);
    } catch (error) {
      console.error('Error checking BLE state:', error);
      setBleState(BLE_STATES.UNKNOWN);
    }
  };

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

      setIsScanning(true);
      setDevices([]);

      await BLEService.startScanning(
        (device) => {
          setDevices(prevDevices => {
            const existingIndex = prevDevices.findIndex(d => d.id === device.id);
            if (existingIndex >= 0) {
              const updatedDevices = [...prevDevices];
              updatedDevices[existingIndex] = device;
              return updatedDevices;
            } else {
              return [...prevDevices, device];
            }
          });
        },
        (error) => {
          console.error('Scan error:', error);
          Alert.alert('Scan Error', error.message || 'Failed to scan for devices');
          setIsScanning(false);
        }
      );
    } catch (error) {
      console.error('Error starting scan:', error);
      Alert.alert('Error', error.message || 'Failed to start scanning');
      setIsScanning(false);
    }
  }, []);

  const stopScan = useCallback(() => {
    BLEService.stopScanning();
    setIsScanning(false);
  }, []);

  const connectToDevice = useCallback(async (device) => {
    try {
      await BLEService.connectToDevice(
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

      Alert.alert(
        'Connected',
        `Successfully connected to ${device.name}`,
        [
          {
            text: 'View Details',
            onPress: () => navigation.navigate('DeviceDetails', { deviceId: device.id })
          },
          { text: 'OK' }
        ]
      );
    } catch (error) {
      console.error('Connection error:', error);
      Alert.alert('Connection Error', error.message || 'Failed to connect to device');
    }
    // Refresh connected devices list
    await loadConnectedDevices();
  }, [navigation, loadConnectedDevices]);

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
      // Refresh connected devices list
      await loadConnectedDevices();
    }, [loadConnectedDevices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await checkBLEState();
    await loadConnectedDevices();
    if (bleState === BLE_STATES.POWERED_ON) {
      stopScan();
      setTimeout(() => {
        startScan();
      }, 500);
    }
    setRefreshing(false);
  }, [bleState, startScan, stopScan, loadConnectedDevices]);

  // Combine connected devices with scanned devices for display
  const allDevices = React.useMemo(() => {
    const deviceMap = new Map();
    
    console.log('🔄 Combining devices - Connected:', connectedDevices.length, 'Scanned:', devices.length);
    
    // Add connected devices first (they take priority)
    connectedDevices.forEach(device => {
      console.log('➕ Adding connected device:', device.name, device.connectionState);
      deviceMap.set(device.id, { 
        ...device, 
        isConnected: true,
        connectionState: CONNECTION_STATES.CONNECTED 
      });
    });
    
    // Add scanned devices (don't overwrite connected ones)
    devices.forEach(device => {
      if (!deviceMap.has(device.id)) {
        deviceMap.set(device.id, { ...device, isConnected: false });
      } else {
        // Update RSSI for connected devices if available
        const existingDevice = deviceMap.get(device.id);
        deviceMap.set(device.id, { 
          ...existingDevice, 
          rssi: device.rssi || existingDevice.rssi 
        });
      }
    });
    
    let result = Array.from(deviceMap.values());
    // Hide stale disconnected devices
    const now = Date.now();
    const STALE_MS = 10 * 1000; // 10 seconds
    result = result.filter(d => (
      d.connectionState === CONNECTION_STATES.CONNECTED ||
      (typeof d.lastSeen === 'number' && (now - d.lastSeen) <= STALE_MS)
    ));
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
          return 0; // DISCONNECTED or unknown
      }
    };
    result.sort((a, b) => {
      const sr = stateRank(a.connectionState) - stateRank(b.connectionState);
      if (sr !== 0) return -sr; // higher rank first
      const arssi = typeof a.rssi === 'number' ? a.rssi : -Infinity;
      const brssi = typeof b.rssi === 'number' ? b.rssi : -Infinity;
      if (arssi !== brssi) return brssi - arssi; // stronger (less negative) first
      const an = (a.name || '').toLowerCase();
      const bn = (b.name || '').toLowerCase();
      if (an < bn) return -1;
      if (an > bn) return 1;
      return 0;
    });
    console.log('📱 Final device list for UI:', result.map(d => `${d.name} (${d.connectionState})`));
    return result;
  }, [connectedDevices, devices]);

  const checkAutoConnectStatus = useCallback(async () => {
    try {
      const statusResult = await BLEService.getAutoConnectStatus();
      const bondedResult = await BLEService.getBondedDevices();

      if (statusResult.success) {
        const { status } = statusResult;
        const bondedDevices = bondedResult.success ? bondedResult.devices : [];

        Alert.alert(
          'Auto-Connect Status',
          `Enabled: ${status.enabled}\n` +
          `Scanning: ${status.isScanning}\n` +
          `Bonded Devices: ${status.bondedDevicesCount || 0}\n` +
          `Connected: ${status.connectedDevicesCount || 0}\n` +
          `BT State: ${status.centralManagerState}\n\n` +
          `Bonded Device IDs:\n${bondedDevices.slice(0, 3).join('\n')}${bondedDevices.length > 3 ? '\n...' : ''}\n\n` +
          `Check console for detailed logs.`
        );
      } else {
        Alert.alert('Error', `Failed to get status: ${statusResult.error}`);
      }
    } catch (error) {
      console.error('Auto-connect status check error:', error);
      Alert.alert('Error', 'Failed to check auto-connect status');
    }
  }, []);

  const forceScanForDevices = useCallback(async () => {
    try {
      console.log('🔍 Starting force scan from BLE Manager...');
      const result = await BLEService.forceScanForBondedDevices();

      Alert.alert(
        'Debug Scan',
        result.success ?
          'Debug scan started! Watch console for 10 seconds.\n\nThis scans for ALL BLE devices to help debug auto-connect.' :
          `Failed to start scan: ${result.error}`
      );
    } catch (error) {
      console.error('Force scan error:', error);
      Alert.alert('Error', 'Failed to start debug scan');
    }
  }, []);

  const debugConnectionState = useCallback(async () => {
    try {
      console.log('🐛 Getting debug connection status...');
      const result = await BLEService.debugConnectionStatus();

      if (result.success) {
        const statusText = JSON.stringify(result.data, null, 2);
        Alert.alert('Debug Connection Status', statusText);
      } else {
        Alert.alert('Error', `Failed to get debug status: ${result.error}`);
      }
    } catch (error) {
      console.error('❌ Debug status error:', error);
      Alert.alert('Error', `Debug status failed: ${error.message}`);
    }
  }, []);

  const refreshConnectedDevices = useCallback(async () => {
    try {
      console.log('🔄 Manual refresh of connected devices...');
      await loadConnectedDevices();
      
      // Also check if there are any pending auto-connect devices
      const autoConnectStatus = await BLEService.getAutoConnectStatus();
      const statusText = autoConnectStatus.success ? 
        `Connected: ${connectedDevices.length}\nAuto-connect: ${autoConnectStatus.status.enabled}\nBonded: ${autoConnectStatus.status.bondedDevicesCount}\nNative connected: ${autoConnectStatus.status.connectedDevicesCount}` :
        `Connected: ${connectedDevices.length}`;
      
      Alert.alert('Device Status', statusText);
    } catch (error) {
      console.error('❌ Refresh error:', error);
      Alert.alert('Error', `Refresh failed: ${error.message}`);
    }
  }, [loadConnectedDevices, connectedDevices.length]);

  const toggleAutoConnect = useCallback(async () => {
    try {
      const statusResult = await BLEService.getAutoConnectStatus();
      const isEnabled = statusResult.success && statusResult.status.enabled;

      if (isEnabled) {
        const result = await BLEService.stopAutoConnect();
        Alert.alert(
          'Auto-Connect',
          result.success ? 'Auto-connect stopped' : `Failed to stop: ${result.error}`
        );
      } else {
        const result = await BLEService.startAutoConnect();
        Alert.alert(
          'Auto-Connect',
          result.success ? 'Auto-connect started!' : `Failed to start: ${result.error}`
        );
      }
    } catch (error) {
      console.error('Auto-connect toggle error:', error);
      Alert.alert('Error', 'Failed to toggle auto-connect');
    }
  }, []);

  const checkPermissions = useCallback(async () => {
    try {
      console.log('🔐 Checking permissions...');
      const debugInfo = await BLEPermissions.debugPermissions();
      console.log('🔍 Permission debug info:', debugInfo);
      
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

  const renderDevice = ({ item }) => (
    <View style={[
      styles.deviceCard,
      item.connectionState === CONNECTION_STATES.CONNECTED && styles.connectedDeviceCard
    ]}>
      <View style={styles.deviceHeader}>
        <View style={styles.deviceInfo}>
          <View style={styles.deviceNameRow}>
            <Text style={styles.deviceName}>{item.name || 'Unknown Device'}</Text>
            {item.connectionState === CONNECTION_STATES.CONNECTED && (
              <View style={styles.connectedIndicator}>
                <Text style={styles.connectedText}>CONNECTED</Text>
              </View>
            )}
          </View>
          <Text style={styles.deviceId}>{item.id}</Text>
          {item.deviceData?.isSmartTag && (
            <View style={styles.smartTagBadge}>
              <Text style={styles.smartTagText}>Smart Tag</Text>
            </View>
          )}
        </View>
        <View style={styles.deviceMeta}>
          <Text style={styles.rssiText}>RSSI: {item.rssi || 'N/A'}</Text>
          {item.deviceData?.batteryLevel !== null && (
            <Text style={styles.batteryText}>
              Battery: {item.deviceData.batteryLevel}%
            </Text>
          )}
        </View>
      </View>

      {item.deviceData?.temperature !== null && (
        <Text style={styles.temperatureText}>
          Temperature: {item.deviceData.temperature?.toFixed(1)}°C
        </Text>
      )}

      {item.deviceData?.steps !== null && (
        <Text style={styles.stepsText}>
          Steps: {item.deviceData.steps}
        </Text>
      )}

      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={getConnectionButtonStyle(item)}
          onPress={() => handleConnectionPress(item)}
          disabled={isConnectionInProgress(item)}
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
          >
            <Text style={styles.detailsButtonText}>Details</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {isScanning ? 'Scanning for devices...' : 'No devices found'}
      </Text>
      <Text style={styles.emptySubtext}>
        Pull down to refresh or start scanning
      </Text>
    </View>
  );

  if (bleState !== BLE_STATES.POWERED_ON) {
    return (
      <View style={styles.container}>
        <View style={styles.statusContainer}>
          <Text style={styles.statusText}>
            {bleState === BLE_STATES.POWERED_OFF
              ? 'Bluetooth is turned off'
              : 'Bluetooth not available'}
          </Text>
          <Text style={styles.statusSubtext}>
            Please enable Bluetooth to scan for devices
          </Text>
          <TouchableOpacity style={styles.refreshButton} onPress={checkBLEState}>
            <Text style={styles.refreshButtonText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>BLE Device Scanner</Text>
        <View style={styles.headerControls}>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={async () => {
              try {
                console.log('🔄 Manual refresh requested');
                await BLEService.forceRefreshDeviceList();
                // Also refresh connected devices
                await loadConnectedDevices();
              } catch (error) {
                console.warn('⚠️ Manual refresh failed:', error?.message);
              }
            }}
          >
            <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
          </TouchableOpacity>
          
          <View style={styles.scanControls}>
            {isScanning ? (
              <TouchableOpacity style={styles.stopButton} onPress={stopScan}>
                <Text style={styles.stopButtonText}>Stop Scan</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.scanButton} onPress={startScan}>
                <Text style={styles.scanButtonText}>Start Scan</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Auto-Connect Controls */}
      <View style={styles.autoConnectControls}>
        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.secondary }]}
          onPress={checkAutoConnectStatus}
        >
          <Text style={styles.autoConnectButtonText}>Auto-Connect Status</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.accent }]}
          onPress={toggleAutoConnect}
        >
          <Text style={styles.autoConnectButtonText}>Toggle Auto-Connect</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.warning }]}
          onPress={forceScanForDevices}
        >
          <Text style={styles.autoConnectButtonText}>Debug Scan</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.accent }]}
          onPress={debugConnectionState}
        >
          <Text style={styles.autoConnectButtonText}>Debug Status</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.warning }]}
          onPress={refreshConnectedDevices}
        >
          <Text style={styles.autoConnectButtonText}>Refresh Connected</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.autoConnectButton, { backgroundColor: Colors.error }]}
          onPress={checkPermissions}
        >
          <Text style={styles.autoConnectButtonText}>Check Permissions</Text>
        </TouchableOpacity>
      </View>

      {isScanning && (
        <View style={styles.scanningIndicator}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.scanningText}>Scanning for devices...</Text>
        </View>
      )}

      <FlatList
        data={allDevices}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        ListEmptyComponent={renderEmptyList}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        contentContainerStyle={allDevices.length === 0 ? styles.emptyListContainer : styles.listContainer}
      />
    </View>
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
    padding: Metrics.baseMargin,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  title: {
    fontSize: Fonts.size.h3,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  scanControls: {
    flexDirection: 'row',
  },
  headerControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Metrics.smallMargin,
  },
  scanButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
  },
  scanButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  stopButton: {
    backgroundColor: Colors.error,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
  },
  stopButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  scanningIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: Metrics.baseMargin,
    backgroundColor: Colors.lightGray,
  },
  scanningText: {
    marginLeft: Metrics.smallMargin,
    fontSize: Fonts.size.medium,
    color: Colors.text,
  },
  listContainer: {
    padding: Metrics.baseMargin,
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
  emptyText: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    textAlign: 'center',
    marginTop: Metrics.smallMargin,
  },
  deviceCard: {
    backgroundColor: Colors.white,
    padding: Metrics.baseMargin,
    marginBottom: Metrics.baseMargin,
    borderRadius: Metrics.borderRadius,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 2,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  deviceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Metrics.smallMargin,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  deviceId: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
    marginTop: 2,
  },
  smartTagBadge: {
    backgroundColor: Colors.success,
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: 2,
    borderRadius: Metrics.borderRadius / 2,
    alignSelf: 'flex-start',
    marginTop: Metrics.smallMargin,
  },
  smartTagText: {
    color: Colors.white,
    fontSize: Fonts.size.tiny,
    fontFamily: Fonts.type.medium,
  },
  deviceMeta: {
    alignItems: 'flex-end',
  },
  rssiText: {
    fontSize: Fonts.size.small,
    color: Colors.lightText,
  },
  batteryText: {
    fontSize: Fonts.size.small,
    color: Colors.success,
    marginTop: 2,
  },
  temperatureText: {
    fontSize: Fonts.size.small,
    color: Colors.primary,
    marginBottom: 4,
  },
  stepsText: {
    fontSize: Fonts.size.small,
    color: Colors.secondary,
    marginBottom: 4,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Metrics.baseMargin,
  },
  connectionButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
    minWidth: 100,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: Colors.error,
  },
  loadingButton: {
    backgroundColor: Colors.lightGray,
  },
  connectionButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  detailsButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
  },
  detailsButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  statusContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Metrics.doubleBaseMargin,
  },
  statusText: {
    fontSize: Fonts.size.large,
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
  },
  refreshButton: {
    backgroundColor: Colors.secondary,
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.smallMargin,
    borderRadius: Metrics.borderRadius,
  },
  refreshButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
  },
  autoConnectControls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: Metrics.smallMargin,
    backgroundColor: Colors.backgroundSecondary,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  autoConnectButton: {
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: Metrics.smallMargin / 2,
    borderRadius: Metrics.borderRadius,
    flex: 1,
    marginHorizontal: 2,
  },
  autoConnectButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.tiny,
    fontFamily: Fonts.type.medium,
    textAlign: 'center',
  },
  connectedDeviceCard: {
    borderColor: Colors.success,
    borderWidth: 2,
    backgroundColor: Colors.successLight || Colors.background,
  },
  deviceNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Metrics.smallMargin,
  },
  connectedIndicator: {
    backgroundColor: Colors.success,
    paddingHorizontal: Metrics.smallMargin,
    paddingVertical: 2,
    borderRadius: Metrics.borderRadius / 2,
  },
  connectedText: {
    color: Colors.white,
    fontSize: Fonts.size.tiny,
    fontFamily: Fonts.type.bold,
  },
});

export default BLEManager;
