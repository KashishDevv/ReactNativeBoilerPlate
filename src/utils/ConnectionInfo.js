import React, { useEffect, useState } from 'react'
import NetInfo from "@react-native-community/netinfo";
import { StyleSheet, Text, View } from 'react-native';
import { Metrics } from '../theme/Metrics';
import colors from '../theme/Colors';
import { moderateScale, moderateVerticalScale } from 'react-native-size-matters';
import { ButtonConstants } from '../constants/Constants';



// View for the Internet Connection Alert (In Case of No Internet)
function ConnectionInfoAlert() {
  return (
    <View style={styles.ConnectionAlertContainer}>
      <Text style={styles.ConnectionAlertText}>{ButtonConstants.No_Internet}</Text>
    </View>
  )
}

function ConnectionInfo() {
  const [isConnected, setisConnected] = useState(true)

  useEffect(() => {
    NetInfo.addEventListener(state => {
      setisConnected(state.isConnected)
    }, [isConnected])
  })

  if (!isConnected) {
    return (
      <View style={styles.mainView}>
        <ConnectionInfoAlert />
      </View>
    )
  }
  return null;
}

const styles = StyleSheet.create({
  ConnectionAlertContainer: {
    backgroundColor: colors.COLOR_RED,
    height: moderateScale(30),
    justifyContent: Metrics.flexBox.CENTER,
    alignItems: Metrics.flexBox.CENTER,
    flexDirection: 'row',
    width: Metrics.screenWidth,
    position: 'absolute',
    top: moderateVerticalScale(30)
  },
  ConnectionAlertText: {
    color: 'white',
    fontWeight: '700',
    fontSize: moderateScale(16)
  },
  mainView: {
    backgroundColor: colors.COLOR_BLACK,
    height: moderateScale(60),
    width: Metrics.screenWidth,
  }
})

export default ConnectionInfo;
