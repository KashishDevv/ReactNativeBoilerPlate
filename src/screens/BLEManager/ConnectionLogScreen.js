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
import { useSelector, useDispatch } from 'react-redux';
import BLEService from '../../services/ble/BLEService';
import { CONNECTION_STATES } from '../../constants/BLEConstants';
import { selectLogsByDevice, clearDeviceLogs } from '../../feature/connectionLogsSlice/connectionLogsSlice';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';

const ConnectionLogScreen = ({ route, navigation }) => {
  const { deviceId, deviceName } = route.params;
  const dispatch = useDispatch();
  const reduxLogs = useSelector(state => selectLogsByDevice(state, deviceId));
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
  }, [deviceId, reduxLogs]); // ✅ Re-run when Redux logs change

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
      
      // ✅ Load persisted logs from Redux
      const persistedLogs = reduxLogs || [];
      
      // ✅ Load live logs from BLEService (if device is connected)
      const liveLogs = BLEService.getConnectionLogs(deviceId) || [];
      
      // ✅ Merge logs and remove duplicates
      // Normalize timestamp to milliseconds for consistent comparison
      // Handles Date objects, Unix timestamps (seconds or milliseconds), and ISO strings
      const normalizeTimestamp = (timestamp) => {
        if (!timestamp) return null;
        
        // If it's a Date object
        if (timestamp instanceof Date) {
          return timestamp.getTime();
        }
        
        // If it's a number
        if (typeof timestamp === 'number') {
          // If it's > year 2100 in seconds, it's likely milliseconds
          // Year 2100 in seconds: 4102444800
          if (timestamp > 4102444800) {
            return timestamp; // Already milliseconds
          }
          // Otherwise assume it's seconds and convert to milliseconds
          return timestamp * 1000;
        }
        
        // If it's a string (ISO format from Redux persistence)
        if (typeof timestamp === 'string') {
          const date = new Date(timestamp);
          if (!isNaN(date.getTime())) {
            return date.getTime();
          }
        }
        
        return null;
      };
      
      // Combine all logs
      const allLogs = [...persistedLogs, ...liveLogs];
      
      // Remove duplicates based on timestamp and action
      const uniqueLogsMap = new Map();
      allLogs.forEach(log => {
        const timestamp = normalizeTimestamp(log.timestamp);
        const key = `${timestamp}_${log.action}`;
        
        if (!uniqueLogsMap.has(key)) {
          uniqueLogsMap.set(key, log);
        } else {
          // If duplicate found, prefer the one with more info or newer receivedAt
          const existing = uniqueLogsMap.get(key);
          const existingReceivedAt = existing.receivedAt ? new Date(existing.receivedAt).getTime() : 0;
          const logReceivedAt = log.receivedAt ? new Date(log.receivedAt).getTime() : 0;
          
          // Keep the one with more recent receivedAt or more info
          if (logReceivedAt > existingReceivedAt || Object.keys(log).length > Object.keys(existing).length) {
            uniqueLogsMap.set(key, log);
          }
        }
      });
      
      const mergedLogs = Array.from(uniqueLogsMap.values());
      
      if (mergedLogs.length === 0) {
        setLogs([]);
        setLoading(false);
        return;
      }

      // Sort logs by timestamp (newest first - latest on top)
      const sortedLogs = mergedLogs.sort((a, b) => {
        const getTimestampMs = (log) => {
          const ts = normalizeTimestamp(log.timestamp);
          return ts || 0;
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

  const safeStr = (v) => (v != null && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');

  const formatLogEntryForCopy = (log) => {
    const lines = [];
    const timestamp = getTimestampDate(log);
    const timeDate = formatTimeDate(timestamp);
    lines.push(`${log.action} ${timeDate}`);
    if (log.commandHex) lines.push(`  Command: ${safeStr(log.commandHex)}`);
    if (log.responseHex) lines.push(`  Response: ${safeStr(log.responseHex)}`);
    if (log.characteristic) lines.push(`  Characteristic: ${safeStr(log.characteristic)}`);
    if (log.uuid) lines.push(`  UUID: ${safeStr(log.uuid)}`);
    if (log.characteristicNames) lines.push(`  Characteristics: ${safeStr(log.characteristicNames)}`);
    if (log.count !== undefined && !log.characteristic) lines.push(`  Count: ${log.count}`);
    if (log.recordsTransmitted !== undefined) lines.push(`  Records Transmitted: ${safeStr(log.recordsTransmitted)}`);
    if (log.grandTotal !== undefined) lines.push(`  Grand Total: ${safeStr(log.grandTotal)}`);
    if (log.totalExpected !== undefined) lines.push(`  Total Expected: ${safeStr(log.totalExpected)}`);
    if (log.recordCount !== undefined && !log.characteristic) lines.push(`  Record Count: ${safeStr(log.recordCount)}`);
    if (log.totalEnabled !== undefined) lines.push(`  Total Enabled: ${log.totalEnabled}`);
    if (log.note) lines.push(`  Note: ${safeStr(log.note)}`);
    if (log.status && log.action?.includes('Notification')) {
      lines.push(`  Status: ${log.status === 'success' ? '✅ Success' : '❌ Failed'}`);
    }
    if (log.gattStatus !== undefined) lines.push(`  GATT Status: ${safeStr(log.gattStatus)}`);
    if (log.systemTimestamp !== undefined) {
      lines.push(`  System Time: ${log.systemTimestamp} (${log.systemTimestampISO || new Date(log.systemTimestamp * 1000).toISOString()})`);
      if (log.timestampHex) lines.push(`  Timestamp Hex: ${safeStr(log.timestampHex)}`);
      if (log.deviceRTCValid !== undefined) lines.push(`  Device RTC Valid: ${log.deviceRTCValid ? 'Yes' : 'No'}`);
    }
    if (log.deviceRTC !== undefined) {
      lines.push(`  Device RTC: ${log.deviceRTC} (${log.deviceRTCISO || 'N/A'})`);
      lines.push(`  System Time: ${log.systemTime} (${log.systemTimeISO || 'N/A'})`);
      if (log.timeDifference !== undefined) {
        lines.push(`  Time Difference: ${log.timeDifferenceFormatted || `${log.timeDifference}s`}`);
      }
      if (log.rtcValid !== undefined) lines.push(`  RTC Valid: ${log.rtcValid ? '✅ Yes' : '❌ No'}`);
    }
    if (log.expectedRecords !== undefined) lines.push(`  Expected Records: ${safeStr(log.expectedRecords)}`);
    if (log.receivedRecords !== undefined) lines.push(`  Received Records: ${safeStr(log.receivedRecords)}`);
    if (log.success !== undefined) lines.push(`  Success: ${log.success}`);
    if (log.recordsBeforeSync !== undefined) lines.push(`  Records Before Sync: ${log.recordsBeforeSync}`);
    if (log.recordsAfterSync !== undefined) lines.push(`  Records After Sync: ${log.recordsAfterSync}`);
    if (log.actualNewRecords !== undefined) lines.push(`  Actual New Records: ${log.actualNewRecords}`);
    if (log.effectiveReceived !== undefined) lines.push(`  Effective Received: ${log.effectiveReceived}`);
    if (log.isIncomplete !== undefined) lines.push(`  Incomplete: ${log.isIncomplete}`);
    if (log.timeoutMs !== undefined) lines.push(`  Timeout (ms): ${log.timeoutMs}`);
    if (log.totalInTag !== undefined) lines.push(`  Total In Tag: ${log.totalInTag}`);
    if (log.firstChunkRequest !== undefined) lines.push(`  First Chunk Request: ${log.firstChunkRequest}`);
    if (log.totalSynced !== undefined) lines.push(`  Total Synced: ${log.totalSynced}`);
    if (log.lastRecordTimestamp !== undefined) lines.push(`  Last Record Timestamp: ${log.lastRecordTimestamp}`);
    if (log.platform) lines.push(`  Platform: ${log.platform}`);
    if (log.retryAttempt !== undefined) lines.push(`  Retry Attempt: ${log.retryAttempt}`);
    if (log.maxRetries !== undefined) lines.push(`  Max Retries: ${log.maxRetries}`);
    if (log.delayMs !== undefined) lines.push(`  Delay (ms): ${log.delayMs}`);
    if (log.waitedMs !== undefined) lines.push(`  Waited (ms): ${log.waitedMs}`);
    if (log.reason) lines.push(`  Reason: ${safeStr(log.reason)}`);
    if (log.errorCode) lines.push(`  Error Code: ${safeStr(log.errorCode)}`);
    if (log.error) lines.push(`  Error: ${safeStr(log.error)}`);
    const knownKeys = new Set([
      'action', 'timestamp', 'receivedAt', 'commandHex', 'responseHex', 'characteristic', 'uuid',
      'characteristicNames', 'count', 'recordsTransmitted', 'grandTotal', 'totalExpected', 'recordCount',
      'totalEnabled', 'note', 'status', 'gattStatus', 'systemTimestamp', 'systemTimestampISO', 'timestampHex',
      'deviceRTCValid', 'deviceRTC', 'deviceRTCISO', 'systemTime', 'systemTimeISO', 'timeDifference',
      'timeDifferenceFormatted', 'rtcValid', 'expectedRecords', 'receivedRecords', 'success', 'recordsBeforeSync',
      'recordsAfterSync', 'actualNewRecords', 'effectiveReceived', 'isIncomplete', 'timeoutMs', 'totalInTag',
      'firstChunkRequest', 'totalSynced', 'lastRecordTimestamp', 'platform', 'retryAttempt', 'maxRetries',
      'delayMs', 'waitedMs', 'reason', 'errorCode', 'error', 'gapReason', 'lastAppRecordTimestamp', 'source'
    ]);
    Object.keys(log).forEach((key) => {
      if (knownKeys.has(key)) return;
      const val = log[key];
      if (val === undefined || val === null) return;
      lines.push(`  ${key}: ${safeStr(val)}`);
    });
    return lines.join('\n');
  };

  const handleCopyData = () => {
    if (logs.length === 0) {
      Alert.alert('No Data', 'There is no data to copy.');
      return;
    }

    let dataText = 'Action | TIME/DATE RECORDED\n';
    dataText += '---------------------------------------------------\n';

    logs.forEach((log) => {
      dataText += formatLogEntryForCopy(log) + '\n';
    });

    Clipboard.setString(dataText.trimEnd());

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
              // ✅ Clear from BLEService (live logs)
              if (BLEService.clearConnectionLogs) {
                await BLEService.clearConnectionLogs(deviceId);
              }
              
              // ✅ Clear from Redux (persisted logs)
              dispatch(clearDeviceLogs({ deviceId }));
              
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
      // ✅ FIX: Check if timestamp is in seconds or milliseconds
      // Unix timestamps in seconds are typically < 4102444800 (year 2100)
      // If timestamp is small (< year 2100 in seconds), it's likely seconds - convert to ms
      // If timestamp is large (> year 2100 in seconds), it's likely already milliseconds
      const isSeconds = log.timestamp < 4102444800;
      return new Date(isSeconds ? log.timestamp * 1000 : log.timestamp);
    }
    return new Date();
  };

  const formatTimeDate = (date) => {
    // Format: "15:20:30.123 10 Dec 2025" (HH:MM:SS.mmm DD MMM YYYY) - Added millisecond precision
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${hours}:${minutes}:${seconds}.${milliseconds} ${day} ${month} ${year}`;
  };

  const renderLog = ({ item, index }) => {
    const timestamp = getTimestampDate(item);
    const timeDate = formatTimeDate(timestamp);
    // Ensure displayed values are never objects (React can't render objects as Text children)
    const safeStr = (v) => (v != null && typeof v === 'object') ? JSON.stringify(v) : String(v ?? '');

    return (
      <View style={styles.logContainer}>
        <Text style={styles.logText}>{safeStr(item.action)} {timeDate}</Text>
        {item.commandHex ? (
          <Text style={styles.hexText}>Command: {safeStr(item.commandHex)}</Text>
        ) : null}
        {item.responseHex ? (
          <Text style={styles.hexText}>Response: {safeStr(item.responseHex)}</Text>
        ) : null}
        {/* ✅ Display notification information */}
        {item.characteristic ? (
          <Text style={styles.hexText}>Characteristic: {safeStr(item.characteristic)}</Text>
        ) : null}
        {item.uuid ? (
          <Text style={styles.hexText}>UUID: {safeStr(item.uuid)}</Text>
        ) : null}
        {item.characteristicNames ? (
          <Text style={styles.hexText}>Characteristics: {safeStr(item.characteristicNames)}</Text>
        ) : null}
        {item.count !== undefined && !item.characteristic ? (
          <Text style={styles.hexText}>Count: {item.count}</Text>
        ) : null}
        {/* ✅ Show sync metrics when present */}
        {item.recordsTransmitted !== undefined ? (
          <Text style={styles.hexText}>Records Transmitted: {safeStr(item.recordsTransmitted)}</Text>
        ) : null}
        {item.grandTotal !== undefined ? (
          <Text style={styles.hexText}>Grand Total: {safeStr(item.grandTotal)}</Text>
        ) : null}
        {item.totalExpected !== undefined ? (
          <Text style={styles.hexText}>Total Expected: {safeStr(item.totalExpected)}</Text>
        ) : null}
        {item.recordCount !== undefined && !item.characteristic ? (
          <Text style={styles.hexText}>Record Count: {safeStr(item.recordCount)}</Text>
        ) : null}
        {item.totalEnabled !== undefined ? (
          <Text style={styles.hexText}>Total Enabled: {item.totalEnabled}</Text>
        ) : null}
        {item.note ? (
          <Text style={styles.hexText}>Note: {safeStr(item.note)}</Text>
        ) : null}
        {(item.status && item.action?.includes('Notification')) ? (
          <Text style={[styles.hexText, { color: item.status === 'success' ? '#4CAF50' : '#F44336' }]}>
            Status: {item.status === 'success' ? '✅ Success' : '❌ Failed'}
          </Text>
        ) : null}
        {item.gattStatus !== undefined ? (
          <Text style={styles.hexText}>GATT Status: {safeStr(item.gattStatus)}</Text>
        ) : null}
        {/* ✅ Display time information for SET_TIME commands */}
        {item.systemTimestamp !== undefined ? (
          <>
            <Text style={styles.hexText}>System Time: {item.systemTimestamp} ({item.systemTimestampISO || new Date(item.systemTimestamp * 1000).toISOString()})</Text>
            {item.timestampHex ? (
              <Text style={styles.hexText}>Timestamp Hex: {safeStr(item.timestampHex)}</Text>
            ) : null}
            {item.deviceRTCValid !== undefined ? (
              <Text style={styles.hexText}>Device RTC Valid: {item.deviceRTCValid ? 'Yes' : 'No'}</Text>
            ) : null}
          </>
        ) : null}
        {/* ✅ Display RTC read information */}
        {item.deviceRTC !== undefined ? (
          <>
            <Text style={styles.hexText}>Device RTC: {item.deviceRTC} ({item.deviceRTCISO || 'N/A'})</Text>
            <Text style={styles.hexText}>System Time: {item.systemTime} ({item.systemTimeISO || 'N/A'})</Text>
            {item.timeDifference !== undefined ? (
              <Text style={styles.hexText}>Time Difference: {item.timeDifferenceFormatted || `${item.timeDifference}s`}</Text>
            ) : null}
            {item.rtcValid !== undefined ? (
              <Text style={styles.hexText}>RTC Valid: {item.rtcValid ? '✅ Yes' : '❌ No'}</Text>
            ) : null}
          </>
        ) : null}
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
  hexText: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.mono || Fonts.type.regular,
    color: Colors.primary,
    marginTop: 4,
    fontWeight: '500',
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

