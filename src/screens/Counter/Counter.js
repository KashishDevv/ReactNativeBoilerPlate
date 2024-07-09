import { Text, SafeAreaView, View, ScrollView } from 'react-native'
import React, { useEffect } from 'react'
import styles from './style';
import CustomButon from '../../components/CustomButon';
import { useSelector, useDispatch } from 'react-redux';
import { decrement, increment } from '../../feature/counterSlice/counterSlice';
import { rawDataGetAPIAxios, rawDataPostAPIAxios } from '../../utils/apiConfig';
import { fetchData } from '../../feature/fetchSlice/fetchSlice';
import { useNavigation } from '@react-navigation/native';


function Counter() {
  const counter = useSelector(state => state?.counterReducer);
  const dispatch = useDispatch();
  const navigation = useNavigation();



  useEffect(() => {
    dispatch(fetchData())     // API Call/ Fetch Data Using API Call in Slices to Save the Data in Reducers (Redux Toolkit)
  }, [])


  // This is the normal API Call for Get Request
  const handleApiCall = async () => {
    await rawDataGetAPIAxios().then((result) => {
      const rawDataGetAPI = result;
      console.log(rawDataGetAPI, "rawDataGetAPI----->")
    })
  }

  // This is the normal API Call for Post Request
  const handlePostApiCall = async () => {
    await rawDataPostAPIAxios().then((result) => {
      const rawDataPostAPIAxios = result;
      console.log(rawDataPostAPIAxios, "rawDataPostAPIAxios----->")
    })
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.container}>
        <Text style={styles.highlihtedText}>
          Counter: {counter?.value}
        </Text>

        <CustomButon
          testID='continue'
          title={"Increment"}
          onPress={() => (
            handlePostApiCall(),      // Post API Call
            dispatch(increment())
          )}
        />
        <CustomButon
          testID='about'
          title={"Decrement"}
          onPress={() => dispatch(decrement())}
        />

        <CustomButon
          testID='about'
          title={"Navigate to Welcome Screen"}
          onPress={() => navigation.navigate('Welcome')}
        />
      </View>
    </SafeAreaView>
  )
}

export default Counter;
