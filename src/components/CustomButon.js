import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import React from 'react'
import { moderateScale } from 'react-native-size-matters';
import colors from '../theme/Colors';
import { Metrics } from '../theme/Metrics';

const CustomButon = ({
    title = "",
    onPress = () => { },
    customStyle = {},
    customTextStyle = {},
    testID = ""
}) => {
    return (
        <View>
            <TouchableOpacity testID={testID} onPress={onPress} style={[styles.buttonStyle, customStyle]}>
                <Text style={[styles.buttonText, customTextStyle]}>{title}</Text>
            </TouchableOpacity>
        </View>
    )
}

export default CustomButon;

const styles = StyleSheet.create({
    buttonStyle: {
        backgroundColor: colors.COLOR_BLACK,
        padding: moderateScale(15),
        justifyContent: Metrics.flexBox.CENTER,
        alignItems: Metrics.flexBox.CENTER,
        marginVertical: moderateScale(15),
        borderRadius: moderateScale(9)
    },
    buttonText: {
        fontSize: moderateScale(17),
        fontWeight: '600',
        textAlign: Metrics.textAlign.CENTER,
        color: colors.COLOR_WHITE,
    }
})