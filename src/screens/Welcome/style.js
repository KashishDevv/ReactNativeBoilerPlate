import { StyleSheet } from 'react-native'
import { moderateScale } from 'react-native-size-matters';
import colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';

const styles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: colors.COLOR_WHITE,
    },
    container: {
        padding: moderateScale(20),
    },
    highlihtedText: {
        marginVertical: moderateScale(10),
        fontSize: moderateScale(20),
        fontWeight: 'bold',
        color: colors.COLOR_BLACK,
        fontFamily: Fonts.type.NunitoSans_Regular,
        textAlign: 'center'
    },
    wrapper: {
        display: 'flex',
        flex: 1,
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    id: {
        textAlign: 'center',
        marginBottom: 20,
    },
})
export default styles;