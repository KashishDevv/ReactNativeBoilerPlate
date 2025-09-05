import * as React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Counter from '../../screens/Counter/Counter';
import Welcome from '../../screens/Welcome/Welcome';
import BLEManager from '../../screens/BLEManager/ModernBLEManager';
import DeviceDetails from '../../screens/DeviceDetails/DeviceDetails';


const Stack = createNativeStackNavigator();

function HomeStack() {
    return (
        <Stack.Navigator>
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
                    title: 'BLE Device Scanner'
                }}
                name="BLEManager"
                component={BLEManager}
            />
            <Stack.Screen
                options={{ 
                    headerShown: true,
                    title: 'Device Details'
                }}
                name="DeviceDetails"
                component={DeviceDetails}
            />
        </Stack.Navigator>
    );
}



export default HomeStack;