import { createSlice } from '@reduxjs/toolkit';

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
      
      // Check for duplicates before adding
      const isDuplicate = state.recordsByDevice[deviceId].some(r => {
        const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
        const recordTimestamp = record.timestamp || (record.timestampDate ? Math.floor(new Date(record.timestampDate).getTime() / 1000) : null);
        return existingTimestamp === recordTimestamp && 
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
        // Check for duplicates
        const isDuplicate = state.recordsByDevice[deviceId].some(r => {
          const existingTimestamp = r.timestamp || (r.timestampDate ? Math.floor(new Date(r.timestampDate).getTime() / 1000) : null);
          const recordTimestamp = record.timestamp || (record.timestampDate ? Math.floor(new Date(record.timestampDate).getTime() / 1000) : null);
          return existingTimestamp === recordTimestamp && 
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

