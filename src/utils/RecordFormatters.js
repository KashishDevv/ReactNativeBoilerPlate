/**
 * Shared utility functions for formatting records across all UI screens.
 * This ensures consistency and eliminates duplicate code.
 */

/**
 * Extract a Date object from a record's timestamp.
 * Handles multiple timestamp formats:
 * - Date object (timestamp or timestampDate)
 * - String (ISO format)
 * - Number (Unix timestamp in seconds)
 * 
 * @param {Object} record - Record containing timestamp data
 * @returns {Date} Date object representing the timestamp
 */
export const getTimestampDate = (record) => {
  if (!record) return new Date();
  
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

/**
 * Format time as HH:MM:SS
 * Example: "13:50:20"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted time string
 */
export const formatTime = (date) => {
  if (!date || !(date instanceof Date)) return '--:--:--';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
};

/**
 * Format time with milliseconds as HH:MM:SS.mmm
 * Example: "13:50:20.123"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted time string with milliseconds
 */
export const formatTimeWithMs = (date) => {
  if (!date || !(date instanceof Date)) return '--:--:--.---';
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  const milliseconds = date.getMilliseconds().toString().padStart(3, '0');
  return `${hours}:${minutes}:${seconds}.${milliseconds}`;
};

/**
 * Get ordinal suffix for a number (st, nd, rd, th)
 * 
 * @param {number} n - Number to get suffix for
 * @returns {string} Ordinal suffix
 */
const getOrdinalSuffix = (n) => {
  if (n > 3 && n < 21) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
};

/**
 * Format date with ordinal suffix
 * Example: "10th Dec 2025"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date string
 */
export const formatDate = (date) => {
  if (!date || !(date instanceof Date)) return '-- --- ----';
  const day = date.getDate();
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[date.getMonth()];
  const year = date.getFullYear();
  return `${day}${getOrdinalSuffix(day)} ${month} ${year}`;
};

/**
 * Format date and time for "Time Recorded" display
 * Example: "10th Dec 2025 Time 09:30:57"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date time string
 */
export const formatDateTimeRecorded = (date) => {
  const dateStr = formatDate(date);
  const timeStr = formatTime(date);
  return `${dateStr} Time ${timeStr}`;
};

/**
 * Format date and time for "Time Received" display
 * Example: "10th Dec 2025 Time 09:30:57"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted date time string
 */
export const formatDateTimeReceived = (date) => {
  const dateStr = formatDate(date);
  const timeStr = formatTime(date);
  return `${dateStr} Time ${timeStr}`;
};

/**
 * Format time and date for connection logs
 * Example: "15:20:30.123 10 Dec 2025"
 * 
 * @param {Date} date - Date object to format
 * @returns {string} Formatted time date string
 */
export const formatTimeDate = (date) => {
  if (!date || !(date instanceof Date)) return '--:--:--.--- -- --- ----';
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

/**
 * Get timestamp from a log entry (for connection logs)
 * 
 * @param {Object} log - Log entry object
 * @returns {Date} Date object
 */
export const getLogTimestamp = (log) => {
  if (!log) return new Date();
  if (log.timestamp instanceof Date) {
    return log.timestamp;
  }
  if (typeof log.timestamp === 'number') {
    return new Date(log.timestamp);
  }
  return new Date();
};

/**
 * Sort records by timestamp (newest first)
 * 
 * @param {Array} records - Array of record objects
 * @returns {Array} Sorted array (newest first)
 */
export const sortRecordsNewestFirst = (records) => {
  if (!records || !Array.isArray(records)) return [];
  
  return [...records].sort((a, b) => {
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
    
    return getTimestampMs(b) - getTimestampMs(a);
  });
};

/**
 * Format temperature for display
 * 
 * @param {number|null|undefined} temperature - Temperature value
 * @returns {string} Formatted temperature string
 */
export const formatTemperature = (temperature) => {
  if (temperature === null || temperature === undefined) {
    return 'N/A';
  }
  return `${temperature}°C`;
};

/**
 * Format steps for display
 * 
 * @param {number|null|undefined} steps - Steps value
 * @returns {string|number} Formatted steps
 */
export const formatSteps = (steps) => {
  if (steps === null || steps === undefined) {
    return 0;
  }
  return steps;
};

/**
 * Generate CSV-like text from records for copying
 * 
 * @param {Array} records - Array of record objects
 * @returns {string} CSV formatted string
 */
export const generateRecordsCsvText = (records) => {
  if (!records || records.length === 0) {
    return '';
  }

  let dataText = 'STEPS,TIME RECORDED,TEMPERATURE,TIME RECEIVED\n';

  records.forEach((record) => {
    const timestamp = getTimestampDate(record);
    const timeRecorded = formatDateTimeRecorded(timestamp);
    const timeReceived = record.receivedAt 
      ? formatDateTimeReceived(new Date(record.receivedAt))
      : timeRecorded;
    const temperature = formatTemperature(record.temperature);
    const steps = formatSteps(record.steps);

    dataText += `${steps}, ${timeRecorded}, ${temperature}, ${timeReceived}\n`;
  });

  return dataText;
};

export default {
  getTimestampDate,
  formatTime,
  formatTimeWithMs,
  formatDate,
  formatDateTimeRecorded,
  formatDateTimeReceived,
  formatTimeDate,
  getLogTimestamp,
  sortRecordsNewestFirst,
  formatTemperature,
  formatSteps,
  generateRecordsCsvText,
};
