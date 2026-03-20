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
import { SYNC_UI_CONFIG } from '../../constants/BLEConstants';
import { selectRecordsByDevice, clearDeviceRecords } from '../../feature/historicalRecordsSlice/historicalRecordsSlice';
import HealthDataRepository from '../../services/database/HealthDataRepository';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';

const HistoricalDataScreen = ({ route, navigation }) => {
  const { deviceId, deviceName } = route.params;
  const dispatch = useDispatch();
  const reduxRecords = useSelector(state => selectRecordsByDevice(state, deviceId));
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const historicalDataListenerRef = useRef(null);
  const lastLoadTimeRef = useRef(0);
  const syncListThrottleMs = SYNC_UI_CONFIG?.LIST_REFRESH_THROTTLE_MS ?? 500;

  useEffect(() => {
    loadInitialData();
    setupHistoricalDataListener();

    return () => {
      if (historicalDataListenerRef.current) {
        BLEService.off('deviceDataUpdate', historicalDataListenerRef.current);
        BLEService.off('syncDataUpdated', historicalDataListenerRef.current);
      }
    };
  }, [deviceId]);

  useEffect(() => {
    const syncStatus = BLEService.getSyncStatus?.(deviceId);
    const now = Date.now();
    if (syncStatus?.isActive && (now - lastLoadTimeRef.current < syncListThrottleMs)) {
      return;
    }
    lastLoadTimeRef.current = now;
    loadInitialData();
  }, [deviceId, reduxRecords, syncListThrottleMs]);

  const setupHistoricalDataListener = () => {
    const handleDataUpdate = (eventData) => {
      if (eventData.deviceId !== deviceId) return;
      if (eventData.type === 'sync_records') {
        return;
      }
      if (eventData.type === 'live_record' || eventData.type === 'sync_complete') {
        console.log(`📊 [HistoricalData] ${eventData.type} updated, refreshing...`);
        lastLoadTimeRef.current = 0;
        loadInitialData();
      }
    };

    const handleSyncUpdate = (eventData) => {
      if (eventData.deviceId === deviceId && eventData.type !== 'sync_records') {
        console.log('📊 [HistoricalData] Sync data updated, refreshing...');
        lastLoadTimeRef.current = 0;
        loadInitialData();
      }
    };

    BLEService.on('deviceDataUpdate', handleDataUpdate);
    BLEService.on('syncDataUpdated', handleSyncUpdate);
    historicalDataListenerRef.current = handleDataUpdate;
  };

  const loadInitialData = () => {
    try {
      setLoading(true);

      // Prefer local DB (6-min aggregated buckets); fallback to Redux
      let historicalRecords = [];
      try {
        historicalRecords = HealthDataRepository.getAggregatedRecordsForUI(deviceId, { limit: 2000 });
      } catch (e) {
        if (__DEV__) console.warn('[HistoricalData] DB read failed, using Redux:', e);
      }
      if (historicalRecords.length === 0) {
        const allRecords = reduxRecords || [];
        historicalRecords = BLEService.deduplicateRecordsByTimeStepsTemp(allRecords);
      }

      if (historicalRecords.length === 0) {
        setRecords([]);
        setLoading(false);
        return;
      }

      // Sort records by timestamp (newest first - latest on top)
      const sortedRecords = [...historicalRecords].sort((a, b) => {
        const getTimestampMs = (record) => {
          if (record.timestamp instanceof Date) {
            return record.timestamp.getTime();
          }
          if (record.timestampDate instanceof Date) {
            return record.timestampDate.getTime();
          }
          if (typeof record.timestampDate === 'string') {
            const dateFromString = new Date(record.timestampDate);
            if (!isNaN(dateFromString.getTime())) {
              return dateFromString.getTime();
            }
          }
          if (typeof record.timestamp === 'number') {
            return record.timestamp * 1000;
          }
          return 0;
        };
        
        return getTimestampMs(b) - getTimestampMs(a); // Reverse order: newest first
      });

      setRecords(sortedRecords);
      setLoading(false);
    } catch (error) {
      console.error('📋 [HistoricalData] Error loading records:', error);
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadInitialData();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleCopyData = () => {
    if (records.length === 0) {
      Alert.alert('No Data', 'There is no data to copy.');
      return;
    }

    // Format data as CSV-like text: STEPS,TIME RECORDED,TEMPERATURE,TIME RECEIVED
    let dataText = 'STEPS,TIME RECORDED,TEMPERATURE,TIME RECEIVED\n';

    records.forEach((record) => {
      const timestamp = getTimestampDate(record);
      const timeRecorded = formatDateTimeRecorded(timestamp);
      const timeReceived = record.receivedAt 
        ? formatDateTimeReceived(new Date(record.receivedAt))
        : timeRecorded;
      const temperature = record.temperature !== null && record.temperature !== undefined
        ? `${Number(record.temperature).toFixed(1)}°C`
        : 'N/A';
      const steps = record.steps || 0;

      dataText += `${steps}, ${timeRecorded}, ${temperature}, ${timeReceived}\n`;
    });

    // Copy to clipboard
    Clipboard.setString(dataText);
    
    Alert.alert(
      'Data Copied',
      `Copied ${records.length} record${records.length !== 1 ? 's' : ''} to clipboard.`,
      [{ text: 'OK' }]
    );
  };

  const handleClearData = () => {
    if (records.length === 0) {
      Alert.alert('No Data', 'There is no data to clear.');
      return;
    }

    Alert.alert(
      'Clear Data',
      `Are you sure you want to clear all ${records.length} record${records.length !== 1 ? 's' : ''}?\n\nThis will clear all historical records for this device.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            try {
              HealthDataRepository.clearDeviceData(deviceId);
              dispatch(clearDeviceRecords({ deviceId }));
              setRecords([]);
              Alert.alert('Data Cleared', 'All historical records have been cleared. Live data remains intact.');
            } catch (error) {
              console.error('Error clearing records:', error);
              Alert.alert('Error', 'Failed to clear records: ' + error.message);
            }
          }
        }
      ]
    );
  };

  const getTimestampDate = (record) => {
    if (record.timestamp instanceof Date) {
      return record.timestamp;
    }
    if (record.timestampDate instanceof Date) {
      return record.timestampDate;
    }
    if (typeof record.timestampDate === 'string') {
      const dateFromString = new Date(record.timestampDate);
      if (!isNaN(dateFromString.getTime())) {
        return dateFromString;
      }
    }
    if (typeof record.timestamp === 'number') {
      return new Date(record.timestamp * 1000);
    }
    return new Date();
  };

  const formatTime = (date) => {
    // Format: "13:50:20" (HH:MM:SS)
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  };

  const formatDate = (date) => {
    // Format: "10th Dec 2025"
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    
    // Add ordinal suffix (st, nd, rd, th)
    const getOrdinalSuffix = (n) => {
      if (n > 3 && n < 21) return 'th';
      switch (n % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    
    return `${day}${getOrdinalSuffix(day)} ${month} ${year}`;
  };

  const formatDateTimeRecorded = (date) => {
    // Format: "10th Dec 2025 Time 09:30:57" (for copy function)
    const dateStr = formatDate(date);
    const timeStr = formatTime(date);
    return `${dateStr} Time ${timeStr}`;
  };

  const formatDateTimeReceived = (date) => {
    // Format: "10th Dec 2025 Time 09:30:57" (for copy function)
    const dateStr = formatDate(date);
    const timeStr = formatTime(date);
    return `${dateStr} Time ${timeStr}`;
  };

  const renderRecord = ({ item }) => {
    const timestamp = getTimestampDate(item);
    const dateStr = formatDate(timestamp);
    const timeRecorded = formatTime(timestamp);
    const timeReceived = item.receivedAt 
      ? formatTime(new Date(item.receivedAt))
      : timeRecorded;
    const steps = item.steps || 0;
    const temperature = item.temperature !== null && item.temperature !== undefined
      ? `${Number(item.temperature).toFixed(1)}°C`
      : 'N/A';

    return (
      <View style={styles.recordWrapper}>
        <View style={styles.recordDateBar}>
          <Text style={styles.recordDateText}>{dateStr}</Text>
        </View>

        <View style={styles.recordCard}>
          <View style={styles.tableRow}>
            <View style={styles.tableColumn}>
              <Text style={styles.tableLabel}>Steps</Text>
              <Text style={styles.tableValue}>{steps}</Text>
            </View>
            <View style={styles.tableDivider} />
            <View style={styles.tableColumn}>
              <Text style={styles.tableLabel}>Recorded</Text>
              <Text style={styles.tableValue}>{timeRecorded}</Text>
            </View>
            <View style={styles.tableDivider} />
            <View style={styles.tableColumn}>
              <Text style={styles.tableLabel}>Temp.</Text>
              <Text style={styles.tableValue}>{temperature}</Text>
            </View>
            <View style={styles.tableDivider} />
            <View style={styles.tableColumn}>
              <Text style={styles.tableLabel}>Received</Text>
              <Text style={styles.tableValue}>{timeReceived}</Text>
            </View>
          </View>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading historical data...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header with Close Button */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>Historical data</Text>
        </View>
        <View style={styles.headerRight}>
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
      {records.length > 0 && (
        <View style={styles.dataHeader}>
          <Text style={styles.dataHeaderText}>STEPS | TIME RECORDED | TEMP. | TIME RECEIVED</Text>
        </View>
      )}

      {/* Records List */}
      {records.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Historical Data</Text>
          <Text style={styles.emptyMessage}>
            No sync records are available for this device.{'\n'}
            Please sync data first.
          </Text>
        </View>
      ) : (
        <FlatList
          data={records}
          renderItem={renderRecord}
          keyExtractor={(item, index) => `historical-record-${index}-${item.timestamp || item.timestampDate || index}`}
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
    backgroundColor: '#F5F5F5', // revert to prior neutral background
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
    backgroundColor: '#F5F5F5',
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
    backgroundColor: '#F5F5F5',
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
    paddingHorizontal: Metrics.baseMargin * 0.45,
    paddingTop: Metrics.baseMargin * 0.45,
    paddingBottom: 120, // Space for bottom buttons
  },
  recordWrapper: {
    marginHorizontal: Metrics.baseMargin * 0.45,
    marginBottom: Metrics.baseMargin * 0.45,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  recordDateBar: {
    backgroundColor: '#E0E0E0',
    paddingVertical: Metrics.smallMargin,
    paddingHorizontal: Metrics.baseMargin,
  },
  recordDateText: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
  },
  recordCard: {
    backgroundColor: Colors.white,
    paddingVertical: Metrics.baseMargin * 0.45,
    paddingHorizontal: Metrics.baseMargin * 0.45,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
  },
  tableColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableDivider: {
    width: 1,
    height: '70%',
    backgroundColor: Colors.border,
    marginHorizontal: Metrics.smallMargin / 2,
  },
  tableLabel: {
    fontSize: Fonts.size.small,
    fontFamily: Fonts.type.medium,
    color: Colors.text,
    marginBottom: 4,
    textAlign: 'center',
  },
  tableValue: {
    fontSize: Fonts.size.medium,
    fontFamily: Fonts.type.bold,
    color: Colors.text,
    textAlign: 'center',
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
    backgroundColor: '#F5F5F5',
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

export default HistoricalDataScreen;


