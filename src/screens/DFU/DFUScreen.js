import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  ScrollView,
  Platform,
} from 'react-native';
import BLEService from '../../services/ble/BLEService';
import Colors from '../../theme/Colors';
import Fonts from '../../theme/Fonts';
import { Metrics } from '../../theme/Metrics';

const DFUScreen = ({ route, navigation }) => {
  const { deviceId, deviceName, currentFirmwareVersion } = route.params;

  const [checking, setChecking] = useState(true);
  const [updateInfo, setUpdateInfo] = useState(null);
  
  const [dfuInProgress, setDfuInProgress] = useState(false);
  const [dfuProgress, setDfuProgress] = useState(0);
  const [dfuState, setDfuState] = useState('');
  const [downloadingFirmware, setDownloadingFirmware] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);

  useEffect(() => {
    navigation.setOptions({
      title: `Firmware Update - ${deviceName || deviceId}`,
    });
    
    checkForUpdates();
    
    return () => {
      // Cleanup event listeners
      BLEService.removeAllListeners('DFUProgress');
      BLEService.removeAllListeners('DFUStateChanged');
      BLEService.removeAllListeners('DFUError');
      BLEService.removeAllListeners('DFUCompleted');
      BLEService.removeAllListeners('DFUAborted');
    };
  }, []);

  const checkForUpdates = async () => {
    try {
      setChecking(true);
      
      // Get device info
      const device = BLEService.getDevice(deviceId);
      const currentVersion = currentFirmwareVersion || device?.firmwareVersion || '1.0.0';
      
      console.log('🔍 [DFU] Checking for updates for device:', deviceId);
      console.log('   Current version:', currentVersion);
      
      const result = await BLEService.checkForFirmwareUpdate(deviceId, currentVersion);
      
      setUpdateInfo({
        currentVersion,
        ...result
      });
      
    } catch (error) {
      console.error('❌ [DFU] Error checking for updates:', error);
      Alert.alert('Error', 'Failed to check for updates. Please try again.');
    } finally {
      setChecking(false);
    }
  };

  const startUpdate = async () => {
    if (!updateInfo?.updateAvailable) {
      return;
    }

    Alert.alert(
      'Firmware Update',
      `Update from ${updateInfo.currentVersion} to ${updateInfo.latestVersion}?\n\n` +
      `⚠️ Important:\n` +
      `• Ensure device has >30% battery\n` +
      `• Keep device within range\n` +
      `• Do not disconnect during update\n` +
      `• Update takes ~2-3 minutes`,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Update Now', 
          style: 'default',
          onPress: async () => {
            await performUpdate();
          }
        }
      ]
    );
  };

  const performUpdate = async () => {
    try {
      setDownloadingFirmware(true);
      setDownloadProgress(0);
      
      // Step 1: Download firmware
      console.log('📥 [DFU] Downloading firmware version:', updateInfo.latestVersion);
      
      const firmwarePath = await BLEService.downloadFirmware(
        updateInfo.latestVersion,
        updateInfo.downloadUrl || 'https://your-server.com/firmware'
      );
      
      setDownloadingFirmware(false);
      setDfuInProgress(true);
      setDfuProgress(0);
      setDfuState('preparing');

      // Step 2: Enter DFU mode (send 0x0A command)
      console.log('🔧 [DFU] Entering DFU mode...');
      setDfuState('entering_dfu');
      
      await BLEService.enterDFUMode(deviceId);
      
      // Step 3: Wait for device to reboot into DFU mode
      console.log('⏳ [DFU] Waiting for device to reboot...');
      setDfuState('waiting_for_reboot');
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds

      // Step 4: Start DFU transfer
      console.log('📤 [DFU] Starting firmware transfer...');
      setDfuState('transferring');
      
      await BLEService.startDFU(deviceId, firmwarePath, {
        onProgress: (data) => {
          console.log(`📊 [DFU] Progress: ${data.progress}%`);
          setDfuProgress(data.progress);
          
          // Map DFU state to user-friendly messages
          if (data.progress < 10) {
            setDfuState('initializing');
          } else if (data.progress < 95) {
            setDfuState('uploading');
          } else {
            setDfuState('finalizing');
          }
        },
        onStateChange: (data) => {
          console.log('🔧 [DFU] State changed:', data.state);
          setDfuState(data.state);
        },
        onError: (error) => {
          console.error('❌ [DFU] Error:', error);
          setDfuInProgress(false);
          setDfuState('');
          
          Alert.alert(
            'Update Failed',
            error.message || 'An error occurred during the firmware update.',
            [
              { text: 'OK', onPress: () => navigation.goBack() }
            ]
          );
        },
        onComplete: () => {
          console.log('🎉 [DFU] Update completed successfully!');
          setDfuInProgress(false);
          setDfuProgress(100);
          
          Alert.alert(
            'Success!',
            `Firmware updated successfully!\n\nNew version: ${updateInfo.latestVersion}\n\nDevice will restart now.`,
            [
              { text: 'OK', onPress: () => navigation.goBack() }
            ]
          );
        },
        onAborted: () => {
          console.log('🛑 [DFU] Update aborted');
          setDfuInProgress(false);
          
          Alert.alert(
            'Update Cancelled',
            'Firmware update was cancelled.',
            [
              { text: 'OK' }
            ]
          );
        }
      });

    } catch (error) {
      console.error('❌ [DFU] Update flow error:', error);
      setDfuInProgress(false);
      setDownloadingFirmware(false);
      
      Alert.alert(
        'Error',
        error.message || 'Failed to start firmware update. Please try again.'
      );
    }
  };

  const cancelUpdate = async () => {
    Alert.alert(
      'Cancel Update?',
      'Are you sure you want to cancel the firmware update?\n\nThis may leave your device in an unstable state.',
      [
        { text: 'No', style: 'cancel' },
        { 
          text: 'Yes, Cancel', 
          style: 'destructive',
          onPress: async () => {
            try {
              await BLEService.cancelDFU();
              setDfuInProgress(false);
              
              Alert.alert(
                'Cancelled',
                'Firmware update has been cancelled. Please reconnect to your device.',
                [
                  { text: 'OK', onPress: () => navigation.goBack() }
                ]
              );
            } catch (error) {
              Alert.alert('Error', 'Failed to cancel update');
            }
          }
        }
      ]
    );
  };

  const getStateDisplayText = (state) => {
    const stateMap = {
      'preparing': 'Preparing update...',
      'entering_dfu': 'Entering update mode...',
      'waiting_for_reboot': 'Device rebooting...',
      'connecting': 'Connecting to bootloader...',
      'connected': 'Connected to bootloader',
      'starting': 'Starting update...',
      'enabling_dfu': 'Enabling update mode...',
      'uploading': 'Uploading firmware...',
      'transferring': 'Transferring firmware...',
      'initializing': 'Initializing transfer...',
      'finalizing': 'Finalizing update...',
      'validating': 'Validating firmware...',
      'disconnecting': 'Completing update...',
      'disconnected': 'Update complete',
      'completed': 'Update successful!',
      'aborted': 'Update cancelled'
    };
    
    return stateMap[state] || state;
  };

  // Loading state
  if (checking) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.statusText}>Checking for updates...</Text>
      </View>
    );
  }

  // DFU in progress state
  if (dfuInProgress || downloadingFirmware) {
    return (
      <View style={styles.centerContainer}>
        <View style={styles.updateContainer}>
          <Text style={styles.title}>
            {downloadingFirmware ? '📥 Downloading Firmware' : '🔄 Updating Firmware'}
          </Text>
          
          <View style={styles.progressContainer}>
            <View style={styles.progressBar}>
              <View 
                style={[
                  styles.progressFill, 
                  { width: `${downloadingFirmware ? downloadProgress : dfuProgress}%` }
                ]} 
              />
            </View>
            <Text style={styles.progressText}>
              {downloadingFirmware ? downloadProgress : dfuProgress}%
            </Text>
          </View>

          <Text style={styles.stateText}>
            {downloadingFirmware ? 'Downloading update package...' : getStateDisplayText(dfuState)}
          </Text>

          <View style={styles.warningBox}>
            <Text style={styles.warningTitle}>⚠️ Important</Text>
            <Text style={styles.warningText}>
              • Keep device close and within range{'\n'}
              • Do not disconnect or close app{'\n'}
              • Device will restart after update{'\n'}
              • This may take 2-3 minutes
            </Text>
          </View>

          {dfuInProgress && !downloadingFirmware && (
            <TouchableOpacity style={styles.cancelButton} onPress={cancelUpdate}>
              <Text style={styles.cancelButtonText}>Cancel Update</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  // Main content
  return (
    <ScrollView 
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
    >
      <View style={styles.header}>
        <Text style={styles.deviceName}>{deviceName || deviceId}</Text>
        <Text style={styles.deviceIdText}>{deviceId}</Text>
      </View>

      <View style={styles.versionCard}>
        <Text style={styles.label}>Current Firmware Version</Text>
        <Text style={styles.version}>{updateInfo?.currentVersion || '1.0.0'}</Text>
      </View>

      {updateInfo?.updateAvailable ? (
        <View>
          <View style={styles.updateCard}>
            <View style={styles.updateHeader}>
              <Text style={styles.updateIcon}>🎉</Text>
              <Text style={styles.updateTitle}>Update Available</Text>
            </View>
            
            <View style={styles.versionCard}>
              <Text style={styles.label}>New Version</Text>
              <Text style={[styles.version, styles.newVersion]}>
                {updateInfo.latestVersion}
              </Text>
            </View>

            {updateInfo.releaseNotes && (
              <View style={styles.releaseNotesCard}>
                <Text style={styles.releaseNotesTitle}>What's New</Text>
                <Text style={styles.releaseNotes}>{updateInfo.releaseNotes}</Text>
              </View>
            )}

            {updateInfo.critical && (
              <View style={styles.criticalBanner}>
                <Text style={styles.criticalText}>
                  🔴 Critical Update - Security Fix
                </Text>
              </View>
            )}

            <TouchableOpacity style={styles.updateButton} onPress={startUpdate}>
              <Text style={styles.updateButtonText}>
                {updateInfo.critical ? 'Install Critical Update' : 'Update Now'}
              </Text>
            </TouchableOpacity>

            <View style={styles.infoBox}>
              <Text style={styles.infoText}>
                📱 Update duration: ~2-3 minutes{'\n'}
                🔋 Requires 30%+ battery{'\n'}
                📡 Stay within BLE range
              </Text>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.upToDateCard}>
          <Text style={styles.upToDateIcon}>✅</Text>
          <Text style={styles.upToDateText}>You're Up to Date!</Text>
          <Text style={styles.upToDateSubtext}>
            Your device is running the latest firmware
          </Text>
        </View>
      )}

      <TouchableOpacity style={styles.checkButton} onPress={checkForUpdates}>
        <Text style={styles.checkButtonText}>Check for Updates</Text>
      </TouchableOpacity>

      <View style={styles.infoSection}>
        <Text style={styles.infoSectionTitle}>About Firmware Updates</Text>
        <Text style={styles.infoSectionText}>
          • Updates fix bugs and add features{'\n'}
          • Updates improve device performance{'\n'}
          • Critical updates address security issues{'\n'}
          • Your device will restart after update
        </Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  contentContainer: {
    padding: Metrics.baseMargin,
  },
  header: {
    marginBottom: Metrics.baseMargin * 2,
    alignItems: 'center',
  },
  deviceName: {
    fontSize: Fonts.size.h5,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Metrics.smallMargin,
  },
  deviceIdText: {
    fontSize: Fonts.size.small,
    color: Colors.textSecondary,
  },
  versionCard: {
    backgroundColor: Colors.white,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    marginBottom: Metrics.baseMargin,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  label: {
    fontSize: Fonts.size.small,
    color: Colors.textSecondary,
    marginBottom: 4,
  },
  version: {
    fontSize: Fonts.size.h6,
    fontWeight: '600',
    color: Colors.text,
  },
  newVersion: {
    color: Colors.primary,
  },
  updateCard: {
    backgroundColor: Colors.white,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    marginBottom: Metrics.baseMargin,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  updateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  updateIcon: {
    fontSize: 32,
    marginRight: Metrics.baseMargin,
  },
  updateTitle: {
    fontSize: Fonts.size.h6,
    fontWeight: '600',
    color: Colors.text,
  },
  releaseNotesCard: {
    backgroundColor: Colors.lightGray,
    padding: Metrics.baseMargin,
    borderRadius: 8,
    marginBottom: Metrics.baseMargin,
  },
  releaseNotesTitle: {
    fontSize: Fonts.size.medium,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Metrics.smallMargin,
  },
  releaseNotes: {
    fontSize: Fonts.size.small,
    color: Colors.text,
    lineHeight: 20,
  },
  criticalBanner: {
    backgroundColor: '#FFE5E5',
    padding: Metrics.baseMargin,
    borderRadius: 8,
    marginBottom: Metrics.baseMargin,
    borderLeftWidth: 4,
    borderLeftColor: '#FF3B30',
  },
  criticalText: {
    fontSize: Fonts.size.medium,
    fontWeight: '600',
    color: '#FF3B30',
  },
  updateButton: {
    backgroundColor: Colors.primary,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  updateButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontWeight: '600',
  },
  checkButton: {
    backgroundColor: Colors.lightGray,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  checkButtonText: {
    color: Colors.text,
    fontSize: Fonts.size.medium,
    fontWeight: '500',
  },
  upToDateCard: {
    backgroundColor: '#E8F5E9',
    padding: Metrics.baseMargin * 2,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: Metrics.baseMargin,
  },
  upToDateIcon: {
    fontSize: 48,
    marginBottom: Metrics.baseMargin,
  },
  upToDateText: {
    fontSize: Fonts.size.h6,
    fontWeight: '600',
    color: '#4CAF50',
    marginBottom: Metrics.smallMargin,
  },
  upToDateSubtext: {
    fontSize: Fonts.size.small,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  infoBox: {
    backgroundColor: Colors.lightGray,
    padding: Metrics.baseMargin,
    borderRadius: 8,
  },
  infoText: {
    fontSize: Fonts.size.small,
    color: Colors.text,
    lineHeight: 20,
  },
  infoSection: {
    backgroundColor: Colors.white,
    padding: Metrics.baseMargin,
    borderRadius: 12,
    marginTop: Metrics.baseMargin,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
      },
      android: {
        elevation: 3,
      },
    }),
  },
  infoSectionTitle: {
    fontSize: Fonts.size.medium,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Metrics.smallMargin,
  },
  infoSectionText: {
    fontSize: Fonts.size.small,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  updateContainer: {
    width: '100%',
    maxWidth: 400,
    padding: Metrics.baseMargin * 2,
  },
  title: {
    fontSize: Fonts.size.h5,
    fontWeight: 'bold',
    marginBottom: Metrics.baseMargin * 2,
    textAlign: 'center',
    color: Colors.text,
  },
  progressContainer: {
    width: '100%',
    marginVertical: Metrics.baseMargin * 2,
  },
  progressBar: {
    height: 8,
    backgroundColor: Colors.lightGray,
    borderRadius: 4,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  progressText: {
    textAlign: 'center',
    fontSize: Fonts.size.h4,
    fontWeight: 'bold',
    marginTop: Metrics.baseMargin,
    color: Colors.text,
  },
  stateText: {
    textAlign: 'center',
    fontSize: Fonts.size.medium,
    color: Colors.textSecondary,
    marginBottom: Metrics.baseMargin * 2,
  },
  warningBox: {
    backgroundColor: '#FFF3E0',
    padding: Metrics.baseMargin,
    borderRadius: 8,
    marginBottom: Metrics.baseMargin * 2,
    width: '100%',
  },
  warningTitle: {
    fontSize: Fonts.size.medium,
    fontWeight: '600',
    color: '#FF9500',
    marginBottom: Metrics.smallMargin,
  },
  warningText: {
    fontSize: Fonts.size.small,
    color: '#8B6B00',
    lineHeight: 20,
  },
  cancelButton: {
    backgroundColor: '#FF3B30',
    padding: Metrics.baseMargin,
    borderRadius: 12,
    alignItems: 'center',
    width: '100%',
  },
  cancelButtonText: {
    color: Colors.white,
    fontSize: Fonts.size.medium,
    fontWeight: '600',
  },
  statusText: {
    marginTop: Metrics.baseMargin,
    fontSize: Fonts.size.medium,
    color: Colors.textSecondary,
  },
});

export default DFUScreen;
