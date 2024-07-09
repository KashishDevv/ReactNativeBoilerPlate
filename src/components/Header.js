import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import React from 'react'
import colors from '../theme/Colors';
import { Metrics } from '../theme/Metrics';
import { moderateScale } from 'react-native-size-matters';

const Header = ({
    leftButton = false,
    rightButton = false,
    leftButtonTitle = "",
    rightButtonTitle = "",
    headerTitle = "",
    onLeftButtonPress = () => { },
    onRighttButtonPress = () => { },
}) => {
    const renderLeftButton = () => {
        if (leftButton) {
            return (
                <TouchableOpacity style={styles.button} onPress={onLeftButtonPress}>
                    <Text style={styles.buttonText}>{leftButtonTitle}</Text>
                </TouchableOpacity>
            );
        }
        return <View style={styles.buttonPlaceholder} />;
    };
    const renderRightButton = () => {
        if (rightButton) {
            return (
                <TouchableOpacity style={styles.button} onPress={onRighttButtonPress}>
                    <Text style={styles.buttonText}>{rightButtonTitle}</Text>
                </TouchableOpacity>
            );
        }
        return <View style={styles.buttonPlaceholder} />;
    };
    return (
        <View style={styles.container}>
            {renderLeftButton()}
            <View style={styles.centerContainer}>
                {headerTitle && <Text style={styles.headerText}>{headerTitle}</Text>}
            </View>
            {renderRightButton()}
        </View>
    );
};
const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: Metrics.flexBox.CENTER,
        justifyContent: Metrics.flexBox.SPACE_BETWEEN,
        padding: moderateScale(20),
    },
    button: {
        width: '20%',
        paddingVertical: moderateScale(10),
        borderRadius: moderateScale(5),
        paddingHorizontal: moderateScale(5)
    },
    buttonPlaceholder: {
        width: '20%',
    },
    buttonText: {
        fontSize: moderateScale(16),
        textAlign: 'left',
        color: colors.COLOR_BLACK,
    },
    centerContainer: {
        flex: 1,
        justifyContent: Metrics.flexBox.CENTER,
        alignItems: Metrics.flexBox.CENTER,
        width: '60%',
    },
    headerText: {
        fontSize: moderateScale(18),
        fontWeight: 'bold',
        textAlign: Metrics.textAlign.CENTER,
        color: colors.COLOR_BLACK
    },
});

export default Header