import { createSlice } from '@reduxjs/toolkit';

/**
 * ✅ FIX: Normalize timestamp to Unix seconds (number) for consistent comparison
 * Handles Date objects, Unix timestamps (seconds or milliseconds), and ISO strings
 * @param {Date|number|string|null|undefined} timestamp - Timestamp in any format
 * @returns {number|null} Unix timestamp in seconds, or null if invalid
 */
const normalizeTimestamp = (timestamp) => {
  if (!timestamp) return null;
  
  // If it's already a number, check if it's seconds or milliseconds
  if (typeof timestamp === 'number') {
    // If it's > year 2100 in seconds, it's likely milliseconds
    if (timestamp > 4102444800) {
      return Math.floor(timestamp / 1000);
    }
    return timestamp;
  }
  
  // If it's a Date object
  if (timestamp instanceof Date) {
    return Math.floor(timestamp.getTime() / 1000);
  }
  
  // If it's a string (ISO format or other)
  if (typeof timestamp === 'string') {
    const date = new Date(timestamp);
    if (!isNaN(date.getTime())) {
      return Math.floor(date.getTime() / 1000);
    }
  }
  
  return null;
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
      
      // ✅ FIX: Check for duplicates before adding - normalize timestamps for consistent comparison
      const recordTimestamp = normalizeTimestamp(record.timestamp || record.timestampDate);
      const isDuplicate = state.recordsByDevice[deviceId].some(r => {
        const existingTimestamp = normalizeTimestamp(r.timestamp || r.timestampDate);
        return existingTimestamp !== null && 
               recordTimestamp !== null &&
               existingTimestamp === recordTimestamp && 
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
        // ✅ FIX: Check for duplicates - normalize timestamps for consistent comparison
        const recordTimestamp = normalizeTimestamp(record.timestamp || record.timestampDate);
        const isDuplicate = state.recordsByDevice[deviceId].some(r => {
          const existingTimestamp = normalizeTimestamp(r.timestamp || r.timestampDate);
          return existingTimestamp !== null && 
                 recordTimestamp !== null &&
                 existingTimestamp === recordTimestamp && 
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

