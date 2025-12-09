import * as React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Counter from '../../screens/Counter/Counter';
import Welcome from '../../screens/Welcome/Welcome';
import ModernBLEManager from '../../screens/BLEManager/ModernBLEManager';
import DeviceDetails from '../../screens/DeviceDetails/DeviceDetails';
import SyncRecordsScreen from '../../screens/DeviceDetails/SyncRecordsScreen';
import LiveDataScreen from '../../screens/BLEManager/LiveDataScreen';
import HistoricalDataScreen from '../../screens/BLEManager/HistoricalDataScreen';
import DFUScreen from '../../screens/DFU/DFUScreen';


const Stack = createNativeStackNavigator();

function HomeStack() {
    return (
        <Stack.Navigator initialRouteName="ModernBLEManager">
            <Stack.Screen
                options={{ 
                    headerShown: true,
                    title: 'BLE Device Scanner'
                }}
                name="ModernBLEManager"
                component={ModernBLEManager}
            />
            <Stack.Screen
                options={{ headerShown: false }}
                name="Welcome"
                component={Welcome}
            />
            <Stack.Screen
                options={{ headerShown: false }}
                name="Counter"
                component={Counter}
            />
            <Stack.Screen
                options={{ 
                    headerShown: true,
                    title: 'Device Details'
                }}
                name="DeviceDetails"
                component={DeviceDetails}
            />
            <Stack.Screen
                options={{ 
                    headerShown: true,
                    title: 'Sync Records'
                }}
                name="SyncRecords"
                component={SyncRecordsScreen}
            />
            <Stack.Screen
                options={{ 
                    headerShown: false,
                    title: 'Live Data'
                }}
                name="LiveData"
                component={LiveDataScreen}
            />
            <Stack.Screen
                options={{ 
                    headerShown: false,
                    title: 'Historical Data'
                }}
                name="HistoricalData"
                component={HistoricalDataScreen}
            />
            <Stack.Screen
                options={{ 
                    headerShown: true,
                    title: 'Firmware Update'
                }}
                name="DFU"
                component={DFUScreen}
            />
        </Stack.Navigator>
    );
}



export default HomeStack;