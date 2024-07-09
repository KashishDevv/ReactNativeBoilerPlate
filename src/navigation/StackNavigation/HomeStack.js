import * as React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Counter from '../../screens/Counter/Counter';
import Welcome from '../../screens/Welcome/Welcome';


const Stack = createNativeStackNavigator();

function HomeStack() {
    return (
        <Stack.Navigator >
            <Stack.Screen
                // options={{ headerShown: false }}
                name="Counter"
                component={Counter}
            />
            <Stack.Screen
                options={{ headerShown: false }}
                name="Welcome"
                component={Welcome}
            />
        </Stack.Navigator>
    );
}



export default HomeStack;