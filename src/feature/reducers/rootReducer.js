import { combineReducers } from 'redux';
import counterReducer from '../counterSlice/counterSlice'
import fetchReducer from '../fetchSlice/fetchSlice';

const rootReducer = combineReducers({
    counterReducer,
    fetchReducer
});

export default rootReducer;