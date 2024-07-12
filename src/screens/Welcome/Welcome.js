import { Text, SafeAreaView, NativeModules, View, Button, Platform } from 'react-native'
import React, { useState } from 'react'
import styles from './style';
import Header from '../../components/Header';
import { useNavigation } from '@react-navigation/native';


function Welcome() {

    const [id, setId] = useState('Press the button to get The ID');
    const navigation = useNavigation();

    let NativeModule;

    if (Platform.OS === 'android') {
        NativeModule = NativeModules.SampleBridgeAndroid;
    } else {
        NativeModule = NativeModules.BridgingCodeModule;
    }


    // For Android
    const nativeSimpleMethodReturnsforAndroid = () => {
        NativeModule.examplePayment("Api Called", "i3789293782", result => {
            alert(result)
        })

        NativeModule.callExampleApi('https://jsonplaceholder.typicode.com/todos/1', (status, response) => {
            if (status === 'Success') {
                console.log('API Response:', response);
            } else {
                console.error('API Error:', response);
            }
        });

    }

    // For IOS
    const nativeSimpleMethodforIos = () => {
        NativeModule.bothClassifyAndCallback("https://fileinfo.com/img/ss/xl/jpg_44-2.jpg", result => {
            alert(result)
        })

        NativeModule.makeApiCall('https://jsonplaceholder.typicode.com/todos/1')
            .then(response => {
                console.log('API Response:', response);
            })
            .catch(error => {
                console.error('API Error:', error);
            });
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
        </SafeAreaView>
    )
}

export default Welcome;
