import { combineReducers } from 'redux';
import counterReducer from '../counterSlice/counterSlice'
import fetchReducer from '../fetchSlice/fetchSlice';
import historicalRecordsReducer from '../historicalRecordsSlice/historicalRecordsSlice';
import connectionLogsReducer from '../connectionLogsSlice/connectionLogsSlice';

const rootReducer = combineReducers({
    counterReducer,
    fetchReducer,
    historicalRecords: historicalRecordsReducer,
    connectionLogs: connectionLogsReducer,
});

export default rootReducer;