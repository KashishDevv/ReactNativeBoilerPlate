import { createSlice } from '@reduxjs/toolkit';

/**
 * Normalize timestamp to Unix seconds (number) for consistent comparison.
 * Handles Date objects, Unix timestamps (seconds or milliseconds), and ISO strings.
 */
const normalizeTimestamp = (timestamp) => {
  if (!timestamp) return null;
  if (typeof timestamp === 'number') {
    if (timestamp > 4102444800) return Math.floor(timestamp / 1000);
    return timestamp;
  }
  if (timestamp instanceof Date) return Math.floor(timestamp.getTime() / 1000);
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    return isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
  }
  return null;
};

/** Recorded time only (device time). Use for dedupe; never received/synced time. */
const getRecordedTimeSeconds = (record) => {
  if (!record) return null;
  if (record.originalTimestamp != null) return record.originalTimestamp;
  return normalizeTimestamp(record.timestamp || record.timestampDate);
};

const initialState = {
  // Structure: { [deviceId]: [record1, record2, ...] }
  // Example:
  // {
  //   "device-123": [{ timestamp: ..., steps: 100, temperature: 25.5, ... }, ...],
  //   "device-456": [{ timestamp: ..., steps: 200, temperature: 26.0, ... }, ...],
  //   ...
  // }
  // Each device has its own separate array of records, so multiple devices can store records independently.
  recordsByDevice: {},
};

export const historicalRecordsSlice = createSlice({
  name: 'historicalRecords',
  initialState,
  reducers: {
    // Add a single record for a device
    addRecord: (state, action) => {
      const { deviceId, record } = action.payload;
      if (!state.recordsByDevice[deviceId]) {
        state.recordsByDevice[deviceId] = [];
      }
      
      // Dedupe by RECORDED TIME only (device time), not received/synced time
      const recordedTime = getRecordedTimeSeconds(record);
      const isDuplicate = state.recordsByDevice[deviceId].some(r => {
        const existingRecordedTime = getRecordedTimeSeconds(r);
        return existingRecordedTime !== null &&
               recordedTime !== null &&
               existingRecordedTime === recordedTime &&
               r.steps === record.steps &&
               r.temperature === record.temperature;
      });
      
      if (!isDuplicate) {
        state.recordsByDevice[deviceId].push({
          ...record,
          receivedAt: record.receivedAt || new Date().toISOString(),
          deviceId,
        });
      }
    },
    
    // Add multiple records for a device (used when syncing)
    addRecords: (state, action) => {
      const { deviceId, records } = action.payload;
      if (!state.recordsByDevice[deviceId]) {
        state.recordsByDevice[deviceId] = [];
      }
      
      records.forEach(record => {
        // Dedupe by RECORDED TIME only (device time), not received/synced time
        const recordedTime = getRecordedTimeSeconds(record);
        const isDuplicate = state.recordsByDevice[deviceId].some(r => {
          const existingRecordedTime = getRecordedTimeSeconds(r);
          return existingRecordedTime !== null &&
                 recordedTime !== null &&
                 existingRecordedTime === recordedTime &&
                 r.steps === record.steps &&
                 r.temperature === record.temperature;
        });
        
        if (!isDuplicate) {
          state.recordsByDevice[deviceId].push({
            ...record,
            receivedAt: record.receivedAt || new Date().toISOString(),
            deviceId,
          });
        }
      });
    },
    
    // Clear all records for a device
    clearDeviceRecords: (state, action) => {
      const { deviceId } = action.payload;
      state.recordsByDevice[deviceId] = [];
    },
    
    // Clear all records for all devices
    clearAllRecords: (state) => {
      state.recordsByDevice = {};
    },
  },
});

export const { addRecord, addRecords, clearDeviceRecords, clearAllRecords } = historicalRecordsSlice.actions;

// Selectors
export const selectRecordsByDevice = (state, deviceId) => {
  return state.historicalRecords?.recordsByDevice?.[deviceId] || [];
};

export const selectAllRecords = (state) => {
  return state.historicalRecords?.recordsByDevice || {};
};

export default historicalRecordsSlice.reducer;

