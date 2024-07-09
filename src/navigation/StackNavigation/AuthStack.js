// In App.js in a new project

import * as React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';


const Stack = createNativeStackNavigator();

function AuthStack(props) {
    return (
        <Stack.Navigator>
        </Stack.Navigator>
    );
}



export default AuthStack;