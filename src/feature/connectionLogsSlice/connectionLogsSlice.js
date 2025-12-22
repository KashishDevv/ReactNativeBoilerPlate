import { createSlice } from '@reduxjs/toolkit';

/**
 * ✅ Normalize timestamp to Unix seconds (number) for consistent comparison
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
  // Structure: { [deviceId]: [log1, log2, ...] }
  // Example:
  // {
  //   "device-123": [{ action: "Connected", timestamp: ..., ... }, ...],
  //   "device-456": [{ action: "Disconnected", timestamp: ..., ... }, ...],
  //   ...
  // }
  // Each device has its own separate array of logs, so multiple devices can store logs independently.
  logsByDevice: {},
};

export const connectionLogsSlice = createSlice({
  name: 'connectionLogs',
  initialState,
  reducers: {
    // Add a single log entry for a device
    addLog: (state, action) => {
      const { deviceId, log } = action.payload;
      if (!state.logsByDevice[deviceId]) {
        state.logsByDevice[deviceId] = [];
      }
      
      // ✅ Check for duplicates before adding - normalize timestamps for consistent comparison
      // Also check additional info to avoid false duplicates (e.g., same action at same time but different payloads)
      const logTimestamp = normalizeTimestamp(log.timestamp);
      const isDuplicate = state.logsByDevice[deviceId].some(existingLog => {
        const existingTimestamp = normalizeTimestamp(existingLog.timestamp);
        // Check if timestamp and action match
        const timestampMatch = existingTimestamp !== null && 
                               logTimestamp !== null &&
                               existingTimestamp === logTimestamp;
        const actionMatch = existingLog.action === log.action;
        
        // If timestamp and action match, check if it's truly a duplicate
        // by comparing additional info (payload, commandId, etc.)
        if (timestampMatch && actionMatch) {
          // For command logs, also check commandId and payload
          if (log.commandId && existingLog.commandId) {
            return log.commandId === existingLog.commandId && 
                   log.payload === existingLog.payload;
          }
          // For other logs, check if reason or other unique fields match
          if (log.reason && existingLog.reason) {
            return log.reason === existingLog.reason;
          }
          // If no unique identifiers, consider it a duplicate if within 1 second
          const timeDiff = Math.abs((existingTimestamp || 0) - (logTimestamp || 0));
          return timeDiff < 1; // Within 1 second
        }
        
        return false;
      });
      
      if (!isDuplicate) {
        state.logsByDevice[deviceId].push({
          ...log,
          deviceId,
        });
      }
    },
    
    // Add multiple log entries for a device
    addLogs: (state, action) => {
      const { deviceId, logs } = action.payload;
      if (!state.logsByDevice[deviceId]) {
        state.logsByDevice[deviceId] = [];
      }
      
      logs.forEach(log => {
        // ✅ Check for duplicates - normalize timestamps for consistent comparison
        // Also check additional info to avoid false duplicates
        const logTimestamp = normalizeTimestamp(log.timestamp);
        const isDuplicate = state.logsByDevice[deviceId].some(existingLog => {
          const existingTimestamp = normalizeTimestamp(existingLog.timestamp);
          // Check if timestamp and action match
          const timestampMatch = existingTimestamp !== null && 
                                 logTimestamp !== null &&
                                 existingTimestamp === logTimestamp;
          const actionMatch = existingLog.action === log.action;
          
          // If timestamp and action match, check if it's truly a duplicate
          if (timestampMatch && actionMatch) {
            // For command logs, also check commandId and payload
            if (log.commandId && existingLog.commandId) {
              return log.commandId === existingLog.commandId && 
                     log.payload === existingLog.payload;
            }
            // For other logs, check if reason or other unique fields match
            if (log.reason && existingLog.reason) {
              return log.reason === existingLog.reason;
            }
            // If no unique identifiers, consider it a duplicate if within 1 second
            const timeDiff = Math.abs((existingTimestamp || 0) - (logTimestamp || 0));
            return timeDiff < 1; // Within 1 second
          }
          
          return false;
        });
        
        if (!isDuplicate) {
          state.logsByDevice[deviceId].push({
            ...log,
            deviceId,
          });
        }
      });
    },
    
    // Clear all logs for a device
    clearDeviceLogs: (state, action) => {
      const { deviceId } = action.payload;
      state.logsByDevice[deviceId] = [];
    },
    
    // Clear all logs for all devices
    clearAllLogs: (state) => {
      state.logsByDevice = {};
    },
  },
});

export const { addLog, addLogs, clearDeviceLogs, clearAllLogs } = connectionLogsSlice.actions;

// Selectors
export const selectLogsByDevice = (state, deviceId) => {
  return state.connectionLogs?.logsByDevice?.[deviceId] || [];
};

export const selectAllLogs = (state) => {
  return state.connectionLogs?.logsByDevice || {};
};

export default connectionLogsSlice.reducer;
