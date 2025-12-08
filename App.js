/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */
import React, { useEffect } from 'react';
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'
import { store, persistor } from './src/feature/Store'
import MainNavigation from './src/navigation/MainNavigation';
import SplashScreen from 'react-native-splash-screen';
import ConnectionInfo from './src/utils/ConnectionInfo';
import NotificationPermissions from './src/utils/NotificationPermissions';
import { Platform } from 'react-native';


function App() {
  useEffect(() => {
    // Hide splash screen
    SplashScreen.hide();
    
    // Request notification permissions on Android app start
    if (Platform.OS === 'android') {
      console.log('🤖 Android detected - requesting notification permissions on app start');
      
      // Delay the permission request slightly to ensure app is fully loaded
      setTimeout(async () => {
        try {
          await NotificationPermissions();
          console.log('✅ Notification permission check completed on app start');
        } catch (error) {
          console.error('❌ Error checking notification permissions on app start:', error);
        }
      }, 1000); // 1 second delay
    } else {
      console.log('📱 iOS detected - notification permissions handled by native code');
    }
  }, []);


  return (
    <>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          {/* <ConnectionInfo /> */}
          <MainNavigation />
        </PersistGate>
      </Provider >
    </>
  );
}

export default App;
