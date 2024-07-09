import { Dimensions } from "react-native";

const { width, height } = Dimensions.get("window")

const guidelineBaseWidth = 375;
const guidelineBaseHeight = 720;

const scale = (size) => (width / guidelineBaseWidth) * size;
const horizontalScale = (size) => (width / guidelineBaseWidth) * size;
const verticalScale = (size) => (height / guidelineBaseHeight) * size;
const moderateScale = (size, factor = 0.5) => size + (scale(size) * factor);

// const VALUE = {
//     VALUE_10: width / 37.5
// }


const Metrics = {
    screenWidth: width < height ? width : height,
    screenHeight: width < height ? height : width,
    textAlign: {
        TOP: 'top',
        CENTER: 'center',
        BOTTOM: 'bottom'
    },
    flexBox: {
        LEFT: 'left',
        CENTER: 'center',
        STRETCH: 'stretch',
        FLEX_START: 'flex-start',
        FLEX_END: 'flex-end',
        SPACE_AROUND: 'space-around',
        SPACE_BETWEEN: 'space-between'
    }
}
export { scale, horizontalScale, verticalScale, moderateScale, Metrics };