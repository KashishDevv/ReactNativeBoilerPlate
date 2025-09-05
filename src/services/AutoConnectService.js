import { NativeModules, Platform, DeviceEventEmitter, NativeEventEmitter } from 'react-native';

const { BridgingCodeModule } = NativeModules;

class AutoConnectService {
  constructor() {
    this.isEnabled = false;
    this.bondedDevices = new Set();
    this.onDeviceConnectedCallbacks = new Set();
    this.onDeviceDisconnectedCallbacks = new Set();
    this.connectedListener = null;
    this.disconnectedListener = null;
    
    // Set up event listeners for auto-connect events
    if (Platform.OS === 'ios') {
      this.setupEventListeners();
    }
    
    console.log('🚀 AutoConnectService initialized');
  }

  setupEventListeners() {
    // Create native event emitter for BridgingCodeModule
    const bridgeEventEmitter = new NativeEventEmitter(BridgingCodeModule);
    
    // Listen for auto-connect device connected events
    this.connectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
      console.log('📱 Received auto-connect device connected event:', deviceInfo);
      this._handleDeviceConnected(deviceInfo);
    });

    // Listen for auto-connect device disconnected events
    this.disconnectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
      console.log('📱 Received auto-connect device disconnected event:', deviceInfo);
      this._handleDeviceDisconnected(deviceInfo);
    });

    console.log('📡 Auto-connect event listeners set up with NativeEventEmitter');
  }

  /**
   * Start auto-connect functionality (iOS only)
   * This enables background scanning and automatic reconnection to bonded devices
   */
  async startAutoConnect() {
    if (Platform.OS !== 'ios') {
      console.log('⚠️ Auto-connect is only supported on iOS');
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🚀 Starting auto-connect...');
      const result = await BridgingCodeModule.startAutoConnect();
      this.isEnabled = true;
      console.log('✅ Auto-connect started:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to start auto-connect:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Stop auto-connect functionality
   */
  async stopAutoConnect() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🛑 Stopping auto-connect...');
      const result = await BridgingCodeModule.stopAutoConnect();
      this.isEnabled = false;
      console.log('✅ Auto-connect stopped:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to stop auto-connect:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add a device to the bonded devices list
   * This device will be automatically connected to when discovered
   */
  async addBondedDevice(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log(`✅ Adding bonded device: ${deviceId}`);
      const result = await BridgingCodeModule.addBondedDevice(deviceId);
      this.bondedDevices.add(deviceId);
      console.log('✅ Device bonded:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to bond device:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a device from the bonded devices list
   */
  async removeBondedDevice(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log(`❌ Removing bonded device: ${deviceId}`);
      const result = await BridgingCodeModule.removeBondedDevice(deviceId);
      this.bondedDevices.delete(deviceId);
      console.log('✅ Device unbonded:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to unbond device:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get list of bonded devices
   */
  async getBondedDevices() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      const result = await BridgingCodeModule.getBondedDevices();
      const devices = result.bondedDevices || [];
      this.bondedDevices = new Set(devices);
      console.log('📱 Bonded devices:', devices);
      return { success: true, devices };
    } catch (error) {
      console.error('❌ Failed to get bonded devices:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get auto-connect status
   */
  async getAutoConnectStatus() {
    if (Platform.OS !== 'ios') {
      return { 
        success: true, 
        status: { 
          enabled: false, 
          platform: 'not supported',
          bondedDevicesCount: 0,
          connectedDevicesCount: 0
        } 
      };
    }

    try {
      const status = await BridgingCodeModule.getAutoConnectStatus();
      console.log('📊 Auto-connect status:', status);
      return { success: true, status };
    } catch (error) {
      console.error('❌ Failed to get auto-connect status:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Force scan for bonded devices (debug method)
   */
  async forceScanForBondedDevices() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🔍 Force scanning for bonded devices...');
      const result = await BridgingCodeModule.forceScanForBondedDevices();
      console.log('✅ Force scan result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Force scan failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect device from native iOS CoreBluetooth
   */
  async disconnectFromNative(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🔌 Disconnecting device from native iOS CoreBluetooth:', deviceId);
      const result = await BridgingCodeModule.disconnectFromNative(deviceId);
      console.log('✅ Native disconnect result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to disconnect from native iOS:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Debug method to get detailed connection status
   */
  async debugConnectionStatus() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🐛 Getting debug connection status...');
      const result = await BridgingCodeModule.debugConnectionStatus();
      console.log('🐛 Debug Connection Status:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Debug status failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Ensure callbacks are properly registered with native module
   */
  async ensureCallbacksRegistered() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🔗 Ensuring callbacks are registered...');
      const result = await BridgingCodeModule.ensureCallbacksRegistered();
      console.log('🔗 Callback registration status:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Callback registration failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to known bonded peripherals directly (bypasses scanning)
   */
  async connectToKnownPeripherals() {
    if (Platform.OS !== 'ios') {
      return { success: false, error: 'Not supported on this platform' };
    }

    try {
      console.log('🔗 Connecting to known bonded peripherals...');
      const result = await BridgingCodeModule.connectToKnownPeripherals();
      console.log('✅ Connect to known peripherals result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to connect to known peripherals:', error);
      return { success: false, error: error.message };
    }
  }



  /**
   * Add callback for device connection events
   */
  addDeviceConnectedCallback(callback) {
    this.onDeviceConnectedCallbacks.add(callback);
    console.log('📞 Added device connected callback');
  }

  /**
   * Remove device connection callback
   */
  removeDeviceConnectedCallback(callback) {
    this.onDeviceConnectedCallbacks.delete(callback);
    console.log('📞 Removed device connected callback');
  }

  /**
   * Add callback for device disconnection events
   */
  addDeviceDisconnectedCallback(callback) {
    this.onDeviceDisconnectedCallbacks.add(callback);
    console.log('📞 Added device disconnected callback');
  }

  /**
   * Remove device disconnection callback
   */
  removeDeviceDisconnectedCallback(callback) {
    this.onDeviceDisconnectedCallbacks.delete(callback);
    console.log('📞 Removed device disconnected callback');
  }

  /**
   * Handle device connection from native side
   */
  _handleDeviceConnected(deviceInfo) {
    console.log('🔗 Native device connected:', deviceInfo);
    this.onDeviceConnectedCallbacks.forEach(callback => {
      try {
        callback(deviceInfo);
      } catch (error) {
        console.error('❌ Device connected callback error:', error);
      }
    });
  }

  /**
   * Handle device disconnection from native side
   */
  _handleDeviceDisconnected(deviceInfo) {
    console.log('🔌 Native device disconnected:', deviceInfo);
    this.onDeviceDisconnectedCallbacks.forEach(callback => {
      try {
        callback(deviceInfo);
      } catch (error) {
        console.error('❌ Device disconnected callback error:', error);
      }
    });
  }

  /**
   * Check if device is bonded
   */
  isDeviceBonded(deviceId) {
    return this.bondedDevices.has(deviceId);
  }

  /**
   * Get bonded devices count
   */
  getBondedDevicesCount() {
    return this.bondedDevices.size;
  }

  /**
   * Check if auto-connect is enabled
   */
  isAutoConnectEnabled() {
    return this.isEnabled && Platform.OS === 'ios';
  }

  /**
   * Clean up event listeners
   */
  cleanup() {
    if (this.connectedListener) {
      this.connectedListener.remove();
      this.connectedListener = null;
    }
    if (this.disconnectedListener) {
      this.disconnectedListener.remove();
      this.disconnectedListener = null;
    }
    console.log('🧹 Auto-connect event listeners cleaned up');
  }
}

// Export singleton instance
export default new AutoConnectService();
