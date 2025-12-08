import { NativeModules, Platform, DeviceEventEmitter, NativeEventEmitter } from 'react-native';

const { BridgingCodeModule, SampleBridgeAndroid } = NativeModules;

class AutoConnectService {
  constructor() {
    this.isEnabled = false;
    this.bondedDevices = new Set();
    this.onDeviceConnectedCallbacks = new Set();
    this.onDeviceDisconnectedCallbacks = new Set();
    this.connectedListener = null;
    this.disconnectedListener = null;
    
    // Set up event listeners for auto-connect events
    this.setupEventListeners();
    
    console.log('🚀 AutoConnectService initialized');
  }

  setupEventListeners() {
    if (Platform.OS === 'ios') {
      // iOS uses BridgingCodeModule
      const bridgeEventEmitter = new NativeEventEmitter(BridgingCodeModule);
      
      // Listen for auto-connect device connected events
      this.connectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
        console.log('📱 iOS: Received auto-connect device connected event:', deviceInfo);
        this._handleDeviceConnected(deviceInfo);
      });

      // Listen for auto-connect device disconnected events
      this.disconnectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
        console.log('📱 iOS: Received auto-connect device disconnected event:', deviceInfo);
        this._handleDeviceDisconnected(deviceInfo);
      });

      console.log('📡 iOS Auto-connect event listeners set up with NativeEventEmitter');
    } else {
      // Android uses DeviceEventEmitter
      this.connectedListener = DeviceEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
        console.log('🤖 Android: Received auto-connect device connected event:', deviceInfo);
        this._handleDeviceConnected(deviceInfo);
      });

      this.disconnectedListener = DeviceEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
        console.log('🤖 Android: Received auto-connect device disconnected event:', deviceInfo);
        this._handleDeviceDisconnected(deviceInfo);
      });

      console.log('📡 Android Auto-connect event listeners set up with DeviceEventEmitter');
    }
  }

  /**
   * Start auto-connect functionality
   * This enables background scanning and automatic reconnection to bonded devices
   */
  async startAutoConnect() {
    try {
      console.log('🚀 Starting auto-connect...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.startAutoConnect();
      } else {
        result = await SampleBridgeAndroid.startAutoConnect();
      }
      
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
    try {
      console.log('🛑 Stopping auto-connect...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.stopAutoConnect();
      } else {
        result = await SampleBridgeAndroid.stopAutoConnect();
      }
      
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
    try {
      console.log(`✅ Adding bonded device: ${deviceId}`);
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.addBondedDevice(deviceId);
      } else {
        result = await SampleBridgeAndroid.addBondedDevice(deviceId);
      }
      
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
    try {
      console.log(`❌ Removing bonded device: ${deviceId}`);
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.removeBondedDevice(deviceId);
      } else {
        result = await SampleBridgeAndroid.removeBondedDevice(deviceId);
      }
      
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
    try {
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.getBondedDevices();
      } else {
        result = await SampleBridgeAndroid.getBondedDevices();
      }
      
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
   * Get list of forgotten devices
   */
  async getForgottenDevices() {
    try {
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.getForgottenDevices();
      } else {
        result = await SampleBridgeAndroid.getForgottenDevices();
      }
      
      const devices = result.forgottenDevices || [];
      console.log('📱 Forgotten devices:', devices);
      return { success: true, devices };
    } catch (error) {
      console.error('❌ Failed to get forgotten devices:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get auto-connect status
   */
  async getAutoConnectStatus() {
    try {
      let status;
      
      if (Platform.OS === 'ios') {
        status = await BridgingCodeModule.getAutoConnectStatus();
      } else {
        status = await SampleBridgeAndroid.getAutoConnectStatus();
      }
      
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
    try {
      console.log('🔍 Force scanning for bonded devices...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.forceScanForBondedDevices();
      } else {
        // Android doesn't have this specific method, but we can start scanning
        result = await SampleBridgeAndroid.startScanning();
      }
      
      console.log('✅ Force scan result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Force scan failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Disconnect device from native Bluetooth
   */
  async disconnectFromNative(deviceId) {
    try {
      console.log('🔌 Disconnecting device from native Bluetooth:', deviceId);
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.disconnectFromNative(deviceId);
      } else {
        // ✅ UPDATED: Use new disconnectFromNative method (matching iOS)
        result = await SampleBridgeAndroid.disconnectFromNative(deviceId);
      }
      
      console.log('✅ Native disconnect result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to disconnect from native:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Debug method to get detailed connection status
   */
  async debugConnectionStatus() {
    try {
      console.log('🐛 Getting debug connection status...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.debugConnectionStatus();
      } else {
        // ✅ UPDATED: Use new debugConnectionStatus method (matching iOS)
        result = await SampleBridgeAndroid.debugConnectionStatus();
      }
      
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
    try {
      console.log('🔗 Ensuring callbacks are registered...');
      
      // Callbacks are automatically registered through event listeners
      // No need to call native method anymore
      console.log('✅ Callbacks are automatically registered via event listeners');
      return { success: true, message: 'Callbacks registered via event listeners' };
    } catch (error) {
      console.error('❌ Callback registration failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Connect to known bonded peripherals directly (bypasses scanning)
   */
  async connectToKnownPeripherals() {
    try {
      console.log('🔗 Connecting to known bonded peripherals...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.connectToKnownPeripherals();
      } else {
        // ✅ UPDATED: Use new connectToKnownPeripherals method (matching iOS)
        result = await SampleBridgeAndroid.connectToKnownPeripherals();
      }
      
      console.log('✅ Connect to known peripherals result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to connect to known peripherals:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get resource status for debugging (memory, timers, etc.)
   */
  async getResourceStatus() {
    try {
      console.log('📊 Getting resource status...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.getResourceStatus();
      } else {
        result = await SampleBridgeAndroid.getResourceStatus();
      }
      
      console.log('📊 Resource Status:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to get resource status:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get manufacturer information (manufacturer ID, etc.)
   */
  async getManufacturerInfo() {
    try {
      console.log('🏭 Getting manufacturer info...');
      let result;
      
      if (Platform.OS === 'ios') {
        result = await BridgingCodeModule.getManufacturerInfo();
      } else {
        result = await SampleBridgeAndroid.getManufacturerInfo();
      }
      
      console.log('🏭 Manufacturer Info:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to get manufacturer info:', error);
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
    return this.isEnabled;
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
