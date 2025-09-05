import { Platform, Alert, Linking, PermissionsAndroid } from 'react-native';

class BLEPermissions {
  constructor() {
    this.requiredPermissions = this.getRequiredPermissions();
  }

  /**
   * Get required permissions based on platform and Android API level
   * @returns {Array} Array of required permissions
   */
  getRequiredPermissions() {
    if (Platform.OS === 'ios') {
      return [
        'LOCATION_WHEN_IN_USE',
      ];
    } else {
      // Android permissions vary by API level
      const permissions = [
        'ACCESS_FINE_LOCATION',
      ];

      // Android 12+ (API 31+) requires new Bluetooth permissions
      if (Platform.Version >= 31) {
        permissions.push(
          'BLUETOOTH_SCAN',
          'BLUETOOTH_CONNECT',
          'BLUETOOTH_ADVERTISE'
        );
      } else {
        // Android 10+ (API 29+) requires location for BLE scanning
        permissions.push(
          'ACCESS_COARSE_LOCATION'
        );
      }

      return permissions;
    }
  }

  /**
   * Check if all required permissions are granted
   * @returns {Promise<boolean>} True if all permissions are granted
   */
  async arePermissionsGranted() {
    try {
      if (Platform.OS === 'ios') {
        return true; // iOS handles Bluetooth permissions automatically
      }

      // Check Android permissions
      const apiLevel = parseInt(Platform.Version.toString(), 10);
      
      if (apiLevel < 31) {
        const granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        return granted;
      } else {
        // Check all required permissions for API 31+
        // With neverForLocation flag, we only need Bluetooth permissions
        const scanGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
        const connectGranted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
        
        return scanGranted && connectGranted;
      }
    } catch (error) {
      console.error('Error checking permissions:', error);
      return false;
    }
  }

  /**
   * Request Bluetooth permissions with proper API level handling
   * @returns {Promise<boolean>} True if permissions granted
   */
  async requestBluetoothPermission() {
    if (Platform.OS === 'ios') {
      return true; // iOS handles Bluetooth permissions automatically
    }

    if (Platform.OS === 'android') {
      const apiLevel = parseInt(Platform.Version.toString(), 10);

      if (apiLevel < 31) {
        // For Android < 31, only need location permission
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      // For Android 31+, request Bluetooth permissions
      // Note: With neverForLocation flag, we don't need location permission for BLE
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN && PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        ]);

        return (
          result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }

    this.showErrorToast('Permissions have not been granted');
    return false;
  }

  /**
   * Request Bluetooth permissions with neverForLocation flag (no location permission needed)
   * @returns {Promise<boolean>} True if permissions granted
   */
  async requestBluetoothPermissionWithoutLocation() {
    if (Platform.OS === 'ios') {
      return true;
    }

    if (Platform.OS === 'android') {
      const apiLevel = parseInt(Platform.Version.toString(), 10);

      if (apiLevel < 31) {
        // For Android < 31, location is still required for BLE scanning
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      // For Android 31+, only need Bluetooth permissions
      if (PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN && PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
        const result = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
        ]);

        return (
          result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED &&
          result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED
        );
      }
    }

    this.showErrorToast('Permissions have not been granted');
    return false;
  }

  /**
   * Show error toast when permissions are not granted
   */
  showErrorToast(message) {
    Alert.alert(
      'Permission Required',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        { 
          text: 'Settings', 
          onPress: () => this.openAppSettings()
        }
      ]
    );
  }

  /**
   * Open app settings
   */
  async openAppSettings() {
    try {
      if (Platform.OS === 'android') {
        Linking.openSettings();
      } else {
        Linking.openURL('app-settings:');
      }
    } catch (error) {
      console.error('Error opening app settings:', error);
      // Fallback to system settings
      Linking.openSettings();
    }
  }

  /**
   * Request permissions with user-friendly flow
   * @returns {Promise<boolean>} True if permissions granted
   */
  async requestPermissionsWithFlow() {
    try {
      if (Platform.OS === 'ios') {
        return true; // iOS handles Bluetooth permissions automatically
      }

      // Check current permission status
      const hasPermissions = await this.arePermissionsGranted();
      if (hasPermissions) {
        return true;
      }

      // Show explanation alert first
      return new Promise((resolve) => {
        Alert.alert(
          'Permissions Needed',
          'This app needs Bluetooth and Location permissions to find and communicate with your smart tag.',
          [
            { 
              text: 'Cancel', 
              style: 'cancel',
              onPress: () => resolve(false)
            },
            { 
              text: 'Grant Permissions', 
              onPress: async () => {
                const granted = await this.requestBluetoothPermission();
                resolve(granted);
              }
            }
          ]
        );
      });

    } catch (error) {
      console.error('Error in permission flow:', error);
      return false;
    }
  }

  /**
   * Check if location services are enabled (Android only)
   * @returns {Promise<boolean>} True if location services are enabled
   */
  async isLocationEnabled() {
    if (Platform.OS !== 'android') {
      return true; // iOS handles this automatically
    }

    try {
      // This would require additional native module or library
      // For now, we'll assume it's enabled and let the BLE scan fail if not
      return true;
    } catch (error) {
      console.error('Error checking location services:', error);
      return false;
    }
  }

  /**
   * Get platform-specific guidance for users
   * @returns {Object} Platform-specific guidance
   */
  getPlatformGuidance() {
    if (Platform.OS === 'ios') {
      return {
        title: 'iOS Bluetooth Permissions',
        steps: [
          'Open iOS Settings app',
          'Scroll down and tap on this app',
          'Enable Bluetooth permission',
          'Return to the app and try again'
        ]
      };
    } else {
      return {
        title: 'Android Permissions Setup',
        steps: [
          'Enable Location Services in system settings',
          'Grant Bluetooth permissions when prompted',
          'Grant Location permissions when prompted',
          'Ensure Location is set to High Accuracy mode'
        ]
      };
    }
  }

  /**
   * Get detailed permission status information
   * @returns {Promise<Object>} Detailed permission information
   */
  async getPermissionDetails() {
    try {
      if (Platform.OS === 'ios') {
        return { ios: 'Bluetooth permissions handled automatically' };
      }

      const apiLevel = parseInt(Platform.Version.toString(), 10);
      const details = {
        platform: 'Android',
        apiLevel,
        permissions: {}
      };

      if (apiLevel < 31) {
        const locationStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        details.permissions.location = {
          name: 'Fine Location',
          status: locationStatus ? 'GRANTED' : 'DENIED',
          required: true
        };
      } else {
        const scanStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
        const connectStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);

        details.permissions.bluetoothScan = {
          name: 'Bluetooth Scan',
          status: scanStatus ? 'GRANTED' : 'DENIED',
          required: true
        };
        details.permissions.bluetoothConnect = {
          name: 'Bluetooth Connect',
          status: connectStatus ? 'GRANTED' : 'DENIED',
          required: true
        };
        details.permissions.location = {
          name: 'Fine Location',
          status: 'NOT_REQUIRED',
          required: false,
          note: 'Not required with neverForLocation flag for BLE scanning'
        };
      }

      return details;
    } catch (error) {
      console.error('Error getting permission details:', error);
      return { error: error.message };
    }
  }

  /**
   * Debug method to check what permissions are available
   * @returns {Object} Available permissions and their status
   */
  async debugPermissions() {
    try {
      const apiLevel = parseInt(Platform.Version.toString(), 10);
      const debugInfo = {
        platform: Platform.OS,
        apiLevel,
        availablePermissions: {},
        permissionConstants: {}
      };

      // Check what permission constants are available
      if (Platform.OS === 'android') {
        debugInfo.permissionConstants = {
          BLUETOOTH_SCAN: PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN || 'NOT_AVAILABLE',
          BLUETOOTH_CONNECT: PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT || 'NOT_AVAILABLE',
          BLUETOOTH_ADVERTISE: PermissionsAndroid.PERMISSIONS.BLUETOOTH_ADVERTISE || 'NOT_AVAILABLE',
          ACCESS_FINE_LOCATION: PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION || 'NOT_AVAILABLE',
          ACCESS_COARSE_LOCATION: PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION || 'NOT_AVAILABLE'
        };

        // Check current permission status
        if (apiLevel >= 31) {
          try {
            const scanStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN);
            const connectStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT);
            debugInfo.availablePermissions.bluetoothScan = scanStatus;
            debugInfo.availablePermissions.bluetoothConnect = connectStatus;
          } catch (e) {
            debugInfo.availablePermissions.bluetoothScan = 'ERROR_CHECKING';
            debugInfo.availablePermissions.bluetoothConnect = 'ERROR_CHECKING';
          }
        }

        try {
          const locationStatus = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          debugInfo.availablePermissions.location = locationStatus;
        } catch (e) {
          debugInfo.availablePermissions.location = 'ERROR_CHECKING';
        }
      }

      return debugInfo;
    } catch (error) {
      console.error('Error debugging permissions:', error);
      return { error: error.message };
    }
  }

  /**
   * Force request permissions with detailed logging
   * @returns {Promise<boolean>} True if permissions granted
   */
  async forceRequestPermissions() {
    try {
      console.log('🔐 Force requesting permissions...');
      
      if (Platform.OS === 'ios') {
        console.log('📱 iOS detected - Bluetooth permissions handled automatically');
        return true;
      }

      const apiLevel = parseInt(Platform.Version.toString(), 10);
      console.log(`🤖 Android API level: ${apiLevel}`);

      if (apiLevel < 31) {
        console.log('📱 Android < 31: Requesting location permission only');
        const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
        console.log(`📱 Location permission result: ${granted}`);
        return granted === PermissionsAndroid.RESULTS.GRANTED;
      }

      console.log('📱 Android 31+: Requesting Bluetooth permissions');
      
      // Check if permission constants are available
      if (!PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN || !PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT) {
        console.error('❌ Bluetooth permission constants not available!');
        console.log('Available permissions:', Object.keys(PermissionsAndroid.PERMISSIONS));
        return false;
      }

      const permissions = [
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      ];

      console.log('📱 Requesting permissions:', permissions);
      const result = await PermissionsAndroid.requestMultiple(permissions);
      console.log('📱 Permission results:', result);

      const scanGranted = result['android.permission.BLUETOOTH_SCAN'] === PermissionsAndroid.RESULTS.GRANTED;
      const connectGranted = result['android.permission.BLUETOOTH_CONNECT'] === PermissionsAndroid.RESULTS.GRANTED;

      console.log(`📱 Scan permission: ${scanGranted ? 'GRANTED' : 'DENIED'}`);
      console.log(`📱 Connect permission: ${connectGranted ? 'GRANTED' : 'DENIED'}`);

      return scanGranted && connectGranted;

    } catch (error) {
      console.error('❌ Error in forceRequestPermissions:', error);
      return false;
    }
  }
}

// Export singleton instance
export default new BLEPermissions();
