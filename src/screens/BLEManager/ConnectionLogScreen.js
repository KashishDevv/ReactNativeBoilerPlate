import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
  Alert,
  Clipboard,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BLEService from '../../services/ble/BLEService';
import { CONNECTION_STATES } from '../../constants/BLEConstants';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';

const ConnectionLogScreen = ({ route, navigation }) => {
  const { deviceId, deviceName } = route.params;
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const logListenerRef = useRef(null);

  useEffect(() => {
    loadInitialData();
    setupLogListener();
    checkConnectionStatus();

    // Check connection status periodically
    const connectionCheckInterval = setInterval(() => {
      checkConnectionStatus();
    }, 2000);

    return () => {
      clearInterval(connectionCheckInterval);
      if (logListenerRef.current) {
        BLEService.off('connectionLogUpdated', logListenerRef.current);
        BLEService.off('deviceConnected', logListenerRef.current);
        BLEService.off('deviceDisconnected', logListenerRef.current);
        BLEService.off('syncDataUpdated', logListenerRef.current);
      }
    };
  }, [deviceId]);

  const checkConnectionStatus = () => {
    try {
      const device = BLEService.getDevice(deviceId);
      const connected = device?.connectionState === CONNECTION_STATES.CONNECTED;
      setIsConnected(connected);
    } catch (error) {
      console.log('Error checking connection status:', error);
      setIsConnected(false);
    }
  };

  const setupLogListener = () => {
    // Listen for connection log updates
    const handleLogUpdate = (eventData) => {
      if (eventData.deviceId === deviceId) {
        console.log(`📋 [ConnectionLog] Log updated, refreshing...`);
        loadInitialData();
      }
    };

    // Listen for device connection
    const handleConnect = (device) => {
      if (device.id === deviceId) {
        console.log('📋 [ConnectionLog] Device connected');
        setIsConnected(true);
        loadInitialData();
      }
    };

    // Listen for device disconnection
    const handleDisconnect = (device) => {
      if (device.id === deviceId) {
        console.log('📋 [ConnectionLog] Device disconnected');
        setIsConnected(false);
        loadInitialData();
      }
    };

    // Listen for sync data updates
    const handleSyncUpdate = (eventData) => {
      if (eventData.deviceId === deviceId) {
        console.log('📋 [ConnectionLog] Sync data updated, refreshing...');
        loadInitialData();
      }
    };

    BLEService.on('connectionLogUpdated', handleLogUpdate);
    BLEService.on('deviceConnected', handleConnect);
    BLEService.on('deviceDisconnected', handleDisconnect);
    BLEService.on('syncDataUpdated', handleSyncUpdate);
    
    logListenerRef.current = handleLogUpdate;
  };

  const loadInitialData = () => {
    try {
      setLoading(true);
      // Load connection logs from BLEService
      const connectionLogs = BLEService.getConnectionLogs(deviceId);
      
      if (!connectionLogs || connectionLogs.length === 0) {
        setLogs([]);
        setLoading(false);
        return;
      }

      // Sort logs by timestamp (newest first - latest on top)
      const sortedLogs = [...connectionLogs].sort((a, b) => {
        const getTimestampMs = (log) => {
          if (log.timestamp instanceof Date) {
            return log.timestamp.getTime();
          }
          if (typeof log.timestamp === 'number') {
            return log.timestamp;
          }
          return 0;
        };
        
        return getTimestampMs(b) - getTimestampMs(a); // Reverse order: newest first
      });

      setLogs(sortedLogs);
      setLoading(false);
    } catch (error) {
      console.error('📋 [ConnectionLog] Error loading logs:', error);
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    checkConnectionStatus();
    loadInitialData();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleCopyData = () => {
    if (logs.length === 0) {
      Alert.alert('No Data', 'There is no data to copy.');
      return;
    }

    // Format data as text
    let dataText = 'Action | TIME/DATE RECORDED\n';
    dataText += '---------------------------------------------------\n';

    logs.forEach((log) => {
      const timestamp = getTimestampDate(log);
      const timeDate = formatTimeDate(timestamp);
      dataText += `${log.action} ${timeDate}\n`;
    });

    // Copy to clipboard
    Clipboard.setString(dataText);
    
    Alert.alert(
      'Data Copied',
      `Copied ${logs.length} log entr${logs.length !== 1 ? 'ies' : 'y'} to clipboard.`,
      [{ text: 'OK' }]
    );
  };

  const handleClearData = () => {
    if (logs.length === 0) {
      Alert.alert('No Data', 'There is no data to clear.');
      return;
    }

    Alert.alert(
      'Clear Data',
      `Are you sure you want to clear all ${logs.length} log entr${logs.length !== 1 ? 'ies' : 'y'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              if (BLEService.clearConnectionLogs) {
                await BLEService.clearConnectionLogs(deviceId);
              }
              setLogs([]);
              Alert.alert('Data Cleared', 'Connection logs have been cleared.');
            } catch (error) {
              console.error('Error clearing logs:', error);
              Alert.alert('Error', 'Failed to clear logs: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const getTimestampDate = (log) => {
    if (log.timestamp instanceof Date) {
      return log.timestamp;
    }
    if (typeof log.timestamp === 'number') {
      return new Date(log.timestamp);
    }
    return new Date();
  };

  const formatTimeDate = (date) => {
    // Format: "15:20:30 10 Dec 2025" (HH:MM:SS DD MMM YYYY)
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${hours}:${minutes}:${seconds} ${day} ${month} ${year}`;
  };

  const renderLog = ({ item, index }) => {
    const timestamp = getTimestampDate(item);
    const timeDate = formatTimeDate(timestamp);

    return (
      <View style={styles.logContainer}>
        <Text style={styles.logText}>{item.action} {timeDate}</Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading connection logs...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Traffic Light and Close Button */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Connection log</Text>
        </View>
        <View style={styles.headerRight}>
          {/* Traffic Light Indicator */}
          <View style={[
            styles.trafficLight,
            isConnected ? styles.trafficLightGreen : styles.trafficLightRed
          ]} />
          {/* Close Button */}
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Data Header */}
      {logs.length > 0 && (
        <View style={styles.dataHeader}>
          <Text style={styles.dataHeaderText}>
            Action | TIME/DATE RECORDED
          </Text>
        </View>
      )}

      {/* Logs List */}
      {logs.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Connection Logs</Text>
          <Text style={styles.emptyMessage}>
            Connection events will appear here when the device connects, disconnects, or syncs data.
          </Text>
        </View>
      ) : (
        <FlatList
          data={logs}
          renderItem={renderLog}
          keyExtractor={(item, index) => `log-${index}-${item.timestamp || index}`}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[Colors.primary]}
              tintColor={Colors.primary}
            />
          }
          showsVerticalScrollIndicator={true}
        />
      )}

      {/* Bottom Buttons */}
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.actionButton, styles.clearButton]}
          onPress={handleClearData}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>Clear data</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
          style={[styles.actionButton, styles.copyButton]}
          onPress={handleCopyData}
          activeOpacity={0.8}
        >
          <Text style={styles.actionButtonText}>Copy data</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFE5D9', // Light peach background as per image
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.text,
    fontFamily: Fonts.type.regular,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Metrics.baseMargin,
    paddingTop: Metrics.baseMargin,
    paddingBottom: Metrics.smallMargin,
    backgroundColor: '#FFE5D9',
  },
  headerLeft: {
    flex: 1,
  },
  headerTitle: {
    fontSize: Fonts.size.h1,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Metrics.smallMargin,
  },
  trafficLight: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.text,
  },
  trafficLightGreen: {
    backgroundColor: Colors.success,
  },
  trafficLightRed: {
    backgroundColor: Colors.error,
  },
  closeButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 24,
    fontFamily: Fonts.type.regular,
    color: Colors.text,
    fontWeight: '300',
  },
  dataHeader: {
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.baseMargin,
    backgroundColor: '#FFE5D9',
    borderBottomWidth: 2,
    borderBottomColor: Colors.border,
  },
  dataHeaderText: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
  },
  listContent: {
    padding: Metrics.baseMargin,
    paddingBottom: 120, // Space for bottom buttons
  },
  logContainer: {
    backgroundColor: Colors.white,
    paddingVertical: 12,
    paddingHorizontal: Metrics.baseMargin,
    marginBottom: Metrics.smallMargin,
    borderRadius: 8,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  logText: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.regular,
    color: Colors.text,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 20,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: Colors.lightText,
    fontFamily: Fonts.type.regular,
    textAlign: 'center',
    lineHeight: 20,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: Metrics.baseMargin,
    paddingVertical: Metrics.baseMargin,
    paddingBottom: Metrics.baseMargin + (Platform.OS === 'ios' ? 20 : 10),
    backgroundColor: '#FFE5D9',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Metrics.smallMargin,
  },
  actionButton: {
    flex: 1,
    paddingVertical: Metrics.baseMargin,
    paddingHorizontal: Metrics.baseMargin,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButton: {
    backgroundColor: 'transparent',
  },
  copyButton: {
    backgroundColor: 'transparent',
  },
  actionButtonText: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
  },
});

export default ConnectionLogScreen;

