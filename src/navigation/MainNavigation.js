import * as React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import HomeStack from './StackNavigation/HomeStack';
import AuthStack from './StackNavigation/AuthStack';

export default function MainNavigation() {
    const isLogin = false
    return (
        <NavigationContainer>
            {handleNavigation(isLogin)}
        </NavigationContainer>
    );
}
function handleNavigation(isLogin) {
    return isLogin ? <AuthStack /> : <HomeStack />
}