import React, { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { moderateScale, moderateVerticalScale } from 'react-native-size-matters';
import colors from '../theme/Colors';
import { Metrics } from '../theme/Metrics';
import Icon from 'react-native-vector-icons/FontAwesome5';

// Modal component for showing no internet connection alert
function ConnectionInfoAlert({ isVisible, onClose }) {
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={isVisible}
      onRequestClose={onClose}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <Text style={styles.modalText}>No Internet Connection</Text>
          <TouchableOpacity
          // onPress={onClose}
          >
            <Icon name="wifi" size={50} color="#777777" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// Component to monitor internet connection status
function ConnectionInfo() {
  const [isConnected, setIsConnected] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      setIsConnected(state.isConnected);
      setShowModal(!state.isConnected); // Show modal when not connected
    });

    return () => unsubscribe();
  }, []);

  const closeModal = () => {
    setShowModal(false);
  };

  if (!isConnected) {
    return (
      <View style={styles.mainView}>
        <ConnectionInfoAlert isVisible={showModal} onClose={closeModal} />
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  // mainView: {
  //   backgroundColor: colors.COLOR_BLACK,
  //   height: moderateScale(60),
  //   width: Metrics.screenWidth,
  // },
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 50,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  modalText: {
    marginBottom: 35,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
    color: 'black'
  },
  closeText: {
    color: '#2196F3',
    marginTop: 10,
    fontSize: 16,
  },
});

export default ConnectionInfo;
