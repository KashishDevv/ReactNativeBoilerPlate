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


function App() {
  useEffect(() => {
    SplashScreen.hide()
  })


  return (
    <>
      <Provider store={store}>
        <PersistGate loading={null} persistor={persistor}>
          <ConnectionInfo />
          <MainNavigation />
        </PersistGate>
      </Provider >
    </>
  );
}

export default App;
