import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BLEService from '../../services/ble/BLEService';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';

const SyncRecordsScreen = ({ route, navigation }) => {
  const { deviceId, deviceName } = route.params;
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadRecords();
    
    // Listen for live record updates
    const handleDataUpdate = (eventData) => {
      if (eventData.deviceId === deviceId && 
          (eventData.type === 'live_record' || eventData.type === 'sync_records')) {
        console.log(`📊 [SyncRecords] ${eventData.type} updated, refreshing...`);
        loadRecords();
      }
    };
    
    // Listen for sync record updates
    const handleSyncUpdate = (eventData) => {
      if (eventData.deviceId === deviceId) {
        console.log('📊 [SyncRecords] Sync data updated, refreshing...');
        loadRecords();
      }
    };
    
    BLEService.on('deviceDataUpdate', handleDataUpdate);
    BLEService.on('syncDataUpdated', handleSyncUpdate);
    
    return () => {
      BLEService.off('deviceDataUpdate', handleDataUpdate);
      BLEService.off('syncDataUpdated', handleSyncUpdate);
    };
  }, [deviceId]);

  const loadRecords = () => {
    try {
      // Filter by last record for history display (only show records newer than last)
      const syncRecords = BLEService.getSyncRecordsForDisplay(deviceId);
      
      if (!syncRecords || syncRecords.length === 0) {
        setRecords([]);
        setLoading(false);
        return;
      }

      // Sort records by timestamp (oldest first)
      const sortedRecords = [...syncRecords].sort((a, b) => {
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
        
        return getTimestampMs(a) - getTimestampMs(b);
      });

      setRecords(sortedRecords);
      setLoading(false);
    } catch (error) {
      console.error('📋 [SyncRecords] Error loading records:', error);
      setLoading(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    loadRecords();
    setTimeout(() => setRefreshing(false), 500);
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

  const renderRecord = ({ item, index }) => {
    const timestamp = getTimestampDate(item);
    const timestampStr = timestamp.toLocaleString();
    const steps = item.steps || 0;
    const temperature = item.temperature !== null && item.temperature !== undefined 
                      ? `${item.temperature}°C` 
                      : 'N/A';

    return (
      <View style={styles.recordCard}>
        <View style={styles.recordHeader}>
          <Text style={styles.recordNumber}>#{index + 1}</Text>
          <Text style={styles.recordTimestamp}>{timestampStr}</Text>
        </View>
        
        <View style={styles.recordData}>
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>👟 Steps</Text>
            <Text style={styles.dataValue}>{steps.toLocaleString()}</Text>
          </View>
          
          <View style={styles.dataItem}>
            <Text style={styles.dataLabel}>🌡️ Temperature</Text>
            <Text style={styles.dataValue}>{temperature}</Text>
          </View>
        </View>

        {item.receivedAt && (
          <View style={styles.recordFooter}>
            <Text style={styles.receivedLabel}>
              📥 Received: {new Date(item.receivedAt).toLocaleString()}
            </Text>
          </View>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading records...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (records.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyTitle}>No Records Found</Text>
          <Text style={styles.emptyMessage}>
            No sync records are available for this device.{'\n'}
            Please sync data first.
          </Text>
          <TouchableOpacity
            style={styles.refreshButton}
            onPress={onRefresh}
          >
            <Text style={styles.refreshButtonText}>🔄 Refresh</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Sync Records</Text>
        <Text style={styles.headerSubtitle}>
          {deviceName || 'Device'} • {records.length} record{records.length !== 1 ? 's' : ''}
        </Text>
      </View>

      <FlatList
        data={records}
        renderItem={renderRecord}
        keyExtractor={(item, index) => `record-${index}-${item.timestamp || item.timestampDate || index}`}
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
    </SafeAreaView>
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
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: Colors.text,
    fontFamily: Fonts.regular,
  },
  header: {
    padding: 20,
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.text,
    fontFamily: Fonts.bold,
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.lightText,
    fontFamily: Fonts.regular,
  },
  listContent: {
    padding: 16,
  },
  recordCard: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 3.84,
    elevation: 5,
  },
  recordHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recordNumber: {
    fontSize: 18,
    fontWeight: 'bold',
    color: Colors.primary,
    fontFamily: Fonts.bold,
  },
  recordTimestamp: {
    fontSize: 14,
    color: Colors.text,
    fontFamily: Fonts.regular,
  },
  recordData: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 8,
  },
  dataItem: {
    alignItems: 'center',
    flex: 1,
  },
  dataLabel: {
    fontSize: 12,
    color: Colors.lightText,
    fontFamily: Fonts.regular,
    marginBottom: 4,
  },
  dataValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.text,
    fontFamily: Fonts.bold,
  },
  recordFooter: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  receivedLabel: {
    fontSize: 11,
    color: Colors.lightText,
    fontFamily: Fonts.regular,
    fontStyle: 'italic',
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
    fontWeight: 'bold',
    color: Colors.text,
    fontFamily: Fonts.bold,
    marginBottom: 8,
  },
  emptyMessage: {
    fontSize: 14,
    color: Colors.lightText,
    fontFamily: Fonts.regular,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  refreshButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  refreshButtonText: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: 'bold',
    fontFamily: Fonts.bold,
  },
});

export default SyncRecordsScreen;



