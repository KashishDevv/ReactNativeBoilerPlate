import { Text, SafeAreaView } from 'react-native'
import React from 'react'
import styles from './style';
import Header from '../../components/Header';
import { useNavigation } from '@react-navigation/native';


function Welcome() {

    const navigation = useNavigation();

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
        </SafeAreaView>
    )
}

export default Welcome;
