import { configureStore } from '@reduxjs/toolkit'
import { persistReducer, persistStore } from 'redux-persist'
import AsyncStorage from '@react-native-async-storage/async-storage'
import rootReducer from './reducers/rootReducer'

const persistConfig = {
    key: 'root',
    storage: AsyncStorage,
}

const persistedReducer = persistReducer(persistConfig, rootReducer)

// ✅ FIX: Configure redux-logger to exclude large state objects (historical records)
// This prevents "TOO BIG formatValueCalls" warnings and performance issues
// redux-logger v3: use named createLogger (avoids "BREAKING CHANGE" console spam)
let loggerMiddleware = null;
if (__DEV__) {
    try {
        const rl = require('redux-logger');
        const createLogger = rl.createLogger ?? rl.default ?? rl;
        if (createLogger && typeof createLogger === 'function') {
            loggerMiddleware = createLogger({
                predicate: (getState, action) => {
                    // Log all actions in development
                    return true;
                },
                stateTransformer: (state) => {
                    // Exclude large arrays/objects from logging to prevent performance issues
                    if (!state) return state;
                    return {
                        ...state,
                        historicalRecords: state.historicalRecords ? {
                            ...state.historicalRecords,
                            recordsByDevice: state.historicalRecords.recordsByDevice ? 
                                Object.keys(state.historicalRecords.recordsByDevice).reduce((acc, deviceId) => {
                                    const records = state.historicalRecords.recordsByDevice[deviceId];
                                    // Only log record count, not full records array
                                    acc[deviceId] = Array.isArray(records) ? 
                                        `[${records.length} records]` : records;
                                    return acc;
                                }, {}) : state.historicalRecords.recordsByDevice
                        } : state.historicalRecords,
                        connectionLogs: state.connectionLogs ? {
                            ...state.connectionLogs,
                            logsByDevice: state.connectionLogs.logsByDevice ? 
                                Object.keys(state.connectionLogs.logsByDevice).reduce((acc, deviceId) => {
                                    const logs = state.connectionLogs.logsByDevice[deviceId];
                                    // Only log log count, not full logs array
                                    acc[deviceId] = Array.isArray(logs) ? 
                                        `[${logs.length} logs]` : logs;
                                    return acc;
                                }, {}) : state.connectionLogs.logsByDevice
                        } : state.connectionLogs
                    };
                },
                collapsed: true, // Collapse logs by default for better readability
                duration: true, // Show action duration
                timestamp: true, // Show timestamps
            });
        }
    } catch (error) {
        console.warn('⚠️ redux-logger not available, skipping logger middleware:', error);
    }
}

const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) => {
        const middleware = getDefaultMiddleware({
            serializableCheck: false,
        });
        // Only add logger middleware if it's available
        if (loggerMiddleware) {
            return middleware.concat(loggerMiddleware);
        }
        return middleware;
    },
});

let persistor = persistStore(store)

export { store, persistor };

