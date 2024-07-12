import * as React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Counter from '../../screens/Counter/Counter';
import Welcome from '../../screens/Welcome/Welcome';
import Recorder from '../../screens/Recorder/Recorder';


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
                name="Recorder"
                component={Recorder}
            />
            <Stack.Screen
                name="Counter"
                component={Counter}
            />
        </Stack.Navigator>
    );
}



export default HomeStack;