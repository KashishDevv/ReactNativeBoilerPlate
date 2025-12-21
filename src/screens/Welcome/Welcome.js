import { Text, View, Button, Platform } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import React, { useState } from 'react'
import styles from './style';
import Header from '../../components/Header';
import { useNavigation } from '@react-navigation/native';
import BridgingCodeModule from '../../native-modules/NativeBridgingCodeModule';


function Welcome() {

    const [id, setId] = useState('Press the button to get The ID');
    const navigation = useNavigation();

    // Updated to use Turbo Module - unified API for both platforms
    // For Android
    const nativeSimpleMethodReturnsforAndroid = async () => {
        try {
            // Now using Promises instead of callbacks
            const paymentResult = await BridgingCodeModule.examplePayment("Api Called", "i3789293782");
            alert(`Payment Result: ${paymentResult[0]}, ${paymentResult[1]}`);

            const apiResult = await BridgingCodeModule.callExampleApi('https://jsonplaceholder.typicode.com/todos/1');
            if (apiResult[0] === 'Success') {
                console.log('API Response:', apiResult[1]);
            } else {
                console.error('API Error:', apiResult[1]);
            }
        } catch (error) {
            console.error('Error in native method:', error);
            alert(`Error: ${error.message}`);
        }
    }

    // For IOS
    const nativeSimpleMethodforIos = async () => {
        try {
            // Now using Promises instead of callbacks
            const classifyResult = await BridgingCodeModule.bothClassifyAndCallback("https://fileinfo.com/img/ss/xl/jpg_44-2.jpg");
            alert(`Classify Result: ${classifyResult}`);

            const apiResponse = await BridgingCodeModule.makeApiCall('https://jsonplaceholder.typicode.com/todos/1');
            console.log('API Response:', apiResponse);
        } catch (error) {
            console.error('Error in native method:', error);
            alert(`Error: ${error.message}`);
        }
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
