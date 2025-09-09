package com.reactnativeboilerplate;

import android.util.Log;

/**
 * Log Level Management Utilities
 * Provides consistent logging levels across the BLE implementation
 * Based on React Native BLE PLX LogLevel patterns
 */
public class BLELogLevel {
    private static final String TAG = "BLELogLevel";
    
    // Log level constants
    public static final int VERBOSE = Log.VERBOSE;
    public static final int DEBUG = Log.DEBUG;
    public static final int INFO = Log.INFO;
    public static final int WARNING = Log.WARN;
    public static final int ERROR = Log.ERROR;
    public static final int NONE = Integer.MAX_VALUE; // Higher than ERROR
    
    // String constants for log levels
    public static final String VERBOSE_STRING = "VERBOSE";
    public static final String DEBUG_STRING = "DEBUG";
    public static final String INFO_STRING = "INFO";
    public static final String WARNING_STRING = "WARNING";
    public static final String ERROR_STRING = "ERROR";
    public static final String NONE_STRING = "NONE";
    
    // Current log level (default to INFO)
    private static int currentLogLevel = INFO;
    
    /**
     * Convert string log level to integer
     * @param logLevel String log level
     * @return Integer log level
     */
    public static int toLogLevel(String logLevel) {
        if (logLevel == null) {
            return INFO;
        }
        
        switch (logLevel.toUpperCase()) {
            case VERBOSE_STRING:
                return VERBOSE;
            case DEBUG_STRING:
                return DEBUG;
            case INFO_STRING:
                return INFO;
            case WARNING_STRING:
                return WARNING;
            case ERROR_STRING:
                return ERROR;
            case NONE_STRING:
                return NONE;
            default:
                Log.w(TAG, "Unknown log level: " + logLevel + ", defaulting to INFO");
                return INFO;
        }
    }
    
    /**
     * Convert integer log level to string
     * @param logLevel Integer log level
     * @return String log level
     */
    public static String fromLogLevel(int logLevel) {
        switch (logLevel) {
            case VERBOSE:
                return VERBOSE_STRING;
            case DEBUG:
                return DEBUG_STRING;
            case INFO:
                return INFO_STRING;
            case WARNING:
                return WARNING_STRING;
            case ERROR:
                return ERROR_STRING;
            case NONE:
                return NONE_STRING;
            default:
                return INFO_STRING;
        }
    }
    
    /**
     * Set the current log level
     * @param logLevel Log level (string or integer)
     */
    public static void setLogLevel(String logLevel) {
        currentLogLevel = toLogLevel(logLevel);
        Log.i(TAG, "Log level set to: " + fromLogLevel(currentLogLevel));
    }
    
    /**
     * Set the current log level
     * @param logLevel Integer log level
     */
    public static void setLogLevel(int logLevel) {
        currentLogLevel = logLevel;
        Log.i(TAG, "Log level set to: " + fromLogLevel(currentLogLevel));
    }
    
    /**
     * Get the current log level
     * @return Current log level
     */
    public static int getCurrentLogLevel() {
        return currentLogLevel;
    }
    
    /**
     * Get the current log level as string
     * @return Current log level as string
     */
    public static String getCurrentLogLevelString() {
        return fromLogLevel(currentLogLevel);
    }
    
    /**
     * Check if a log level should be logged
     * @param level Log level to check
     * @return true if should be logged, false otherwise
     */
    public static boolean shouldLog(int level) {
        return level >= currentLogLevel;
    }
    
    /**
     * Log verbose message if verbose logging is enabled
     * @param tag Log tag
     * @param message Log message
     */
    public static void v(String tag, String message) {
        if (shouldLog(VERBOSE)) {
            Log.v(tag, message);
        }
    }
    
    /**
     * Log verbose message with throwable if verbose logging is enabled
     * @param tag Log tag
     * @param message Log message
     * @param throwable Throwable to log
     */
    public static void v(String tag, String message, Throwable throwable) {
        if (shouldLog(VERBOSE)) {
            Log.v(tag, message, throwable);
        }
    }
    
    /**
     * Log debug message if debug logging is enabled
     * @param tag Log tag
     * @param message Log message
     */
    public static void d(String tag, String message) {
        if (shouldLog(DEBUG)) {
            Log.d(tag, message);
        }
    }
    
    /**
     * Log debug message with throwable if debug logging is enabled
     * @param tag Log tag
     * @param message Log message
     * @param throwable Throwable to log
     */
    public static void d(String tag, String message, Throwable throwable) {
        if (shouldLog(DEBUG)) {
            Log.d(tag, message, throwable);
        }
    }
    
    /**
     * Log info message if info logging is enabled
     * @param tag Log tag
     * @param message Log message
     */
    public static void i(String tag, String message) {
        if (shouldLog(INFO)) {
            Log.i(tag, message);
        }
    }
    
    /**
     * Log info message with throwable if info logging is enabled
     * @param tag Log tag
     * @param message Log message
     * @param throwable Throwable to log
     */
    public static void i(String tag, String message, Throwable throwable) {
        if (shouldLog(INFO)) {
            Log.i(tag, message, throwable);
        }
    }
    
    /**
     * Log warning message if warning logging is enabled
     * @param tag Log tag
     * @param message Log message
     */
    public static void w(String tag, String message) {
        if (shouldLog(WARNING)) {
            Log.w(tag, message);
        }
    }
    
    /**
     * Log warning message with throwable if warning logging is enabled
     * @param tag Log tag
     * @param message Log message
     * @param throwable Throwable to log
     */
    public static void w(String tag, String message, Throwable throwable) {
        if (shouldLog(WARNING)) {
            Log.w(tag, message, throwable);
        }
    }
    
    /**
     * Log error message if error logging is enabled
     * @param tag Log tag
     * @param message Log message
     */
    public static void e(String tag, String message) {
        if (shouldLog(ERROR)) {
            Log.e(tag, message);
        }
    }
    
    /**
     * Log error message with throwable if error logging is enabled
     * @param tag Log tag
     * @param message Log message
     * @param throwable Throwable to log
     */
    public static void e(String tag, String message, Throwable throwable) {
        if (shouldLog(ERROR)) {
            Log.e(tag, message, throwable);
        }
    }
    
    /**
     * Log formatted message with specified level
     * @param level Log level
     * @param tag Log tag
     * @param format Format string
     * @param args Format arguments
     */
    public static void log(int level, String tag, String format, Object... args) {
        if (shouldLog(level)) {
            String message = String.format(format, args);
            switch (level) {
                case VERBOSE:
                    Log.v(tag, message);
                    break;
                case DEBUG:
                    Log.d(tag, message);
                    break;
                case INFO:
                    Log.i(tag, message);
                    break;
                case WARNING:
                    Log.w(tag, message);
                    break;
                case ERROR:
                    Log.e(tag, message);
                    break;
            }
        }
    }
    
    /**
     * Log BLE operation with context
     * @param level Log level
     * @param tag Log tag
     * @param operation Operation name
     * @param deviceId Device ID
     * @param characteristicUuid Characteristic UUID (optional)
     * @param message Additional message
     */
    public static void logBLEOperation(int level, String tag, String operation, String deviceId, String characteristicUuid, String message) {
        if (shouldLog(level)) {
            StringBuilder logMessage = new StringBuilder();
            logMessage.append(operation);
            logMessage.append(" - Device: ").append(deviceId);
            if (characteristicUuid != null) {
                logMessage.append(", Characteristic: ").append(characteristicUuid);
            }
            if (message != null) {
                logMessage.append(" - ").append(message);
            }
            
            log(level, tag, logMessage.toString());
        }
    }
    
    /**
     * Log BLE operation with context (without characteristic)
     * @param level Log level
     * @param tag Log tag
     * @param operation Operation name
     * @param deviceId Device ID
     * @param message Additional message
     */
    public static void logBLEOperation(int level, String tag, String operation, String deviceId, String message) {
        logBLEOperation(level, tag, operation, deviceId, null, message);
    }
    
    /**
     * Log BLE error with context
     * @param tag Log tag
     * @param operation Operation name
     * @param deviceId Device ID
     * @param characteristicUuid Characteristic UUID (optional)
     * @param error Error message
     * @param throwable Throwable (optional)
     */
    public static void logBLEError(String tag, String operation, String deviceId, String characteristicUuid, String error, Throwable throwable) {
        StringBuilder logMessage = new StringBuilder();
        logMessage.append("BLE Error in ").append(operation);
        logMessage.append(" - Device: ").append(deviceId);
        if (characteristicUuid != null) {
            logMessage.append(", Characteristic: ").append(characteristicUuid);
        }
        logMessage.append(" - Error: ").append(error);
        
        if (throwable != null) {
            Log.e(tag, logMessage.toString(), throwable);
        } else {
            Log.e(tag, logMessage.toString());
        }
    }
    
    /**
     * Log BLE error with context (without characteristic)
     * @param tag Log tag
     * @param operation Operation name
     * @param deviceId Device ID
     * @param error Error message
     * @param throwable Throwable (optional)
     */
    public static void logBLEError(String tag, String operation, String deviceId, String error, Throwable throwable) {
        logBLEError(tag, operation, deviceId, null, error, throwable);
    }
    
    /**
     * Get all available log levels
     * @return Array of log level strings
     */
    public static String[] getAvailableLogLevels() {
        return new String[]{
            VERBOSE_STRING,
            DEBUG_STRING,
            INFO_STRING,
            WARNING_STRING,
            ERROR_STRING,
            NONE_STRING
        };
    }
    
    /**
     * Check if verbose logging is enabled
     * @return true if verbose logging is enabled
     */
    public static boolean isVerboseEnabled() {
        return shouldLog(VERBOSE);
    }
    
    /**
     * Check if debug logging is enabled
     * @return true if debug logging is enabled
     */
    public static boolean isDebugEnabled() {
        return shouldLog(DEBUG);
    }
    
    /**
     * Check if info logging is enabled
     * @return true if info logging is enabled
     */
    public static boolean isInfoEnabled() {
        return shouldLog(INFO);
    }
    
    /**
     * Check if warning logging is enabled
     * @return true if warning logging is enabled
     */
    public static boolean isWarningEnabled() {
        return shouldLog(WARNING);
    }
    
    /**
     * Check if error logging is enabled
     * @return true if error logging is enabled
     */
    public static boolean isErrorEnabled() {
        return shouldLog(ERROR);
    }
}
