import { NativeModules, Platform, NativeEventEmitter } from 'react-native';

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
    this.setupEventListeners();
    
    console.log('🚀 AutoConnectService initialized');
  }

  setupEventListeners() {
    if (Platform.OS === 'ios') {
      // iOS uses BridgingCodeModule - auto-connect events
      const bridgeEventEmitter = new NativeEventEmitter(BridgingCodeModule);
      this.connectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceConnected', (deviceInfo) => {
        console.log('📱 iOS: Received auto-connect device connected event:', deviceInfo);
        this._handleDeviceConnected(deviceInfo);
      });
      this.disconnectedListener = bridgeEventEmitter.addListener('AutoConnectDeviceDisconnected', (deviceInfo) => {
        console.log('📱 iOS: Received auto-connect device disconnected event:', deviceInfo);
        this._handleDeviceDisconnected(deviceInfo);
      });
      console.log('📡 iOS Auto-connect event listeners set up with NativeEventEmitter');
    }
    // Android: auto-connect via SampleBridgeAndroid (start/stop/status). UI uses DeviceConnected/DeviceDisconnected.
  }

  /**
   * Start auto-connect (iOS: BridgingCodeModule; Android: BLEService calls SampleBridgeAndroid directly).
   */
  async startAutoConnect() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
    }
    try {
      console.log('🚀 Starting auto-connect...');
      const bondedResult = await this.getBondedDevices();
      const bondedCount = bondedResult.success ? bondedResult.devices.length : 0;
      if (bondedCount === 0) {
        console.log('⏸️ Skipping auto-connect start: no bonded devices available');
        return { success: true, skipped: true, reason: 'no_bonded_devices' };
      }
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
   * Stop auto-connect (iOS only here; Android handled by BLEService → SampleBridgeAndroid).
   */
  async stopAutoConnect() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
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
   * Add a device to the bonded devices list (iOS only).
   * Android: no-op; use BLEService which calls native directly.
   */
  async addBondedDevice(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
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
   * Remove a device from the bonded devices list (iOS only).
   * Android: no-op.
   */
  async removeBondedDevice(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
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
   * Get list of bonded devices (iOS only).
   * Android: returns empty list; BLEService uses native directly.
   */
  async getBondedDevices() {
    if (Platform.OS !== 'ios') {
      return { success: true, devices: [] };
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
   * Get list of forgotten devices (iOS only).
   * Android: returns empty list; BLEService uses native directly.
   */
  async getForgottenDevices() {
    if (Platform.OS !== 'ios') {
      return { success: true, devices: [] };
    }
    try {
      const result = await BridgingCodeModule.getForgottenDevices();
      const devices = result.forgottenDevices || [];
      console.log('📱 Forgotten devices:', devices);
      return { success: true, devices };
    } catch (error) {
      console.error('❌ Failed to get forgotten devices:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get auto-connect status (iOS only here; Android via BLEService → SampleBridgeAndroid.getAutoConnectStatus).
   */
  async getAutoConnectStatus() {
    if (Platform.OS !== 'ios') {
      return { success: true, status: { enabled: false } };
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
   * Force scan for bonded devices (iOS only).
   * Android: no-op.
   */
  async forceScanForBondedDevices() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
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
   * Disconnect device from native Bluetooth (iOS only).
   * Android: no-op; BLEService uses native disconnect directly.
   */
  async disconnectFromNative(deviceId) {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
    }
    try {
      console.log('🔌 Disconnecting device from native Bluetooth:', deviceId);
      const result = await BridgingCodeModule.disconnectFromNative(deviceId);
      console.log('✅ Native disconnect result:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to disconnect from native:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Debug method to get detailed connection status (iOS only).
   * Android: no-op.
   */
  async debugConnectionStatus() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
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
   * Connect to known bonded peripherals (iOS only).
   * Android: manual connection only; no-op.
   */
  async connectToKnownPeripherals() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: { attempted: 0, knownPeripherals: [] } };
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
   * Get resource status for debugging (iOS only).
   * Android: no-op.
   */
  async getResourceStatus() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
    }
    try {
      console.log('📊 Getting resource status...');
      const result = await BridgingCodeModule.getResourceStatus();
      console.log('📊 Resource Status:', result);
      return { success: true, result };
    } catch (error) {
      console.error('❌ Failed to get resource status:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get manufacturer information (iOS only).
   * Android: no-op.
   */
  async getManufacturerInfo() {
    if (Platform.OS !== 'ios') {
      return { success: true, result: null };
    }
    try {
      console.log('🏭 Getting manufacturer info...');
      const result = await BridgingCodeModule.getManufacturerInfo();
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
   * Check if auto-connect is enabled (iOS: this.isEnabled; Android: BLEService.androidAutoConnectEnabled).
   */
  isAutoConnectEnabled() {
    if (Platform.OS !== 'ios') return false;
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
