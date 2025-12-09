import { combineReducers } from 'redux';
import counterReducer from '../counterSlice/counterSlice'
import fetchReducer from '../fetchSlice/fetchSlice';
import historicalRecordsReducer from '../historicalRecordsSlice/historicalRecordsSlice';

const rootReducer = combineReducers({
    counterReducer,
    fetchReducer,
    historicalRecords: historicalRecordsReducer,
});

export default rootReducer;