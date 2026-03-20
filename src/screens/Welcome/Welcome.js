import { Text, SafeAreaView, View, Button, Platform } from 'react-native'
import React, { useState } from 'react'
import NativeBLE from '../../NativeBridgingCodeModule';
import styles from './style';
import Header from '../../components/Header';
import { useNavigation } from '@react-navigation/native';


function Welcome() {

    const [id, setId] = useState('Press the button to get The ID');
    const navigation = useNavigation();

    const NativeModule = NativeBLE;
    console.log(NativeModule, "NativeModule=====>")


    // For Android
    // Note: examplePayment and callExampleApi are legacy bridge methods not present in the
    // TurboModule spec. Guard with typeof to avoid a TypeError crash on TurboModule proxy.
    const nativeSimpleMethodReturnsforAndroid = () => {
        if (typeof NativeModule.examplePayment === 'function') {
            NativeModule.examplePayment("Api Called", "i3789293782", result => {
                alert(result)
            });
        } else {
            alert('examplePayment is not available in TurboModule mode');
        }

        if (typeof NativeModule.callExampleApi === 'function') {
            NativeModule.callExampleApi('https://jsonplaceholder.typicode.com/todos/1', (status, response) => {
                if (status === 'Success') {
                    console.log('API Response:', response);
                } else {
                    console.error('API Error:', response);
                }
            });
        }
    }

    // For IOS
    const nativeSimpleMethodforIos = () => {
        // These methods were removed as they were unused
        console.log('iOS native methods removed - no longer available');
        alert('iOS native methods removed - no longer available');
    }


    return (
        <SafeAreaView style={styles.page}>

            {/* Custom Header */}
            <Header
                leftButton
                rightButton
                leftButtonTitle="Back"
                rightButtonTitle="Next"
                headerTitle="Welcome"
                onLeftButtonPress={() => navigation.goBack()}
                onRighttButtonPress={() => ''}
            />
            <Text style={styles.highlihtedText}>
                Welcome Screen
            </Text>
            <Button
                onPress={() => Platform.OS === 'android' ?
                    nativeSimpleMethodReturnsforAndroid()
                    : nativeSimpleMethodforIos()}
                title="Simple Method"
            />
            
            <View style={{ marginTop: 20 }}>
                <Button
                    onPress={() => navigation.navigate('ModernBLEManager')}
                    title="Open BLE Manager"
                />
            </View>
            
            <View style={{ marginTop: 10 }}>
                <Button
                    onPress={() => navigation.navigate('Counter')}
                    title="Counter Example"
                />
            </View>
        </SafeAreaView>
    )
}

export default Welcome;
