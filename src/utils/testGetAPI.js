import BLEService from '../services/ble/BLEService';

// Test utility for GET API functionality
export const testGetAPIFunctionality = () => {
  console.log('🧪 [TEST] Testing GET API Functionality...');
  
  // 1. Check current GET API status
  console.log('\n📊 [TEST] Current GET API Status:');
  BLEService.debugGetApiStatus();
  
  // 2. Get all connected devices
  const connectedDevices = Array.from(BLEService.scannedDevices.entries())
    .filter(([deviceId, device]) => device.connectionState === 'CONNECTED');
  
  console.log(`\n🔗 [TEST] Connected Devices: ${connectedDevices.length}`);
  connectedDevices.forEach(([deviceId, device]) => {
    console.log(`  - ${device.name} (${deviceId})`);
  });
  
  if (connectedDevices.length === 0) {
    console.log('⚠️ [TEST] No connected devices found. Connect a device first.');
    return;
  }
  
  // 3. Test with first connected device
  const [testDeviceId, testDevice] = connectedDevices[0];
  console.log(`\n🧪 [TEST] Testing with device: ${testDevice.name} (${testDeviceId})`);
  
  // 4. Check current screen state
  const currentScreenState = BLEService.screenActiveStates.get(testDeviceId);
  console.log(`📱 [TEST] Current screen state: ${currentScreenState || 'UNSET'}`);
  
  // 5. Test manual GET API call
  console.log('\n📥 [TEST] Testing manual GET API call...');
  BLEService.manualGetApiCall(testDeviceId);
  
  // 6. Test starting GET API calling
  console.log('\n🔄 [TEST] Testing start GET API calling...');
  const success = BLEService.startGetApiCalling(testDeviceId);
  console.log(`🧪 [TEST] Start result: ${success ? 'SUCCESS' : 'FAILED'}`);
  
  // 7. Check status again
  setTimeout(() => {
    console.log('\n📊 [TEST] Status after starting GET API:');
    BLEService.debugGetApiStatus();
  }, 1000);
  
  // 8. Stop after 5 seconds for testing
  setTimeout(() => {
    console.log('\n🛑 [TEST] Stopping GET API for testing...');
    BLEService.stopGetApiCalling(testDeviceId);
    
    console.log('\n📊 [TEST] Final status:');
    BLEService.debugGetApiStatus();
  }, 5000);
};

// Test screen active state management
export const testScreenActiveState = (deviceId) => {
  if (!deviceId) {
    console.log('⚠️ Please provide a device ID to test screen active state');
    return;
  }
  
  console.log(`🧪 Testing screen active state for device: ${deviceId}`);
  
  // Check current state
  const currentState = BLEService.screenActiveStates.get(deviceId);
  console.log(`📱 Current screen state: ${currentState || 'UNSET'}`);
  
  // Set to active
  console.log('📱 Setting screen to ACTIVE...');
  BLEService.setScreenActiveState(deviceId, true);
  
  // Check status after 2 seconds
  setTimeout(() => {
    console.log('\n📊 Status after setting to ACTIVE:');
    BLEService.debugGetApiStatus();
  }, 2000);
  
  // Set to inactive after 5 seconds
  setTimeout(() => {
    console.log('\n📱 Setting screen to INACTIVE...');
    BLEService.setScreenActiveState(deviceId, false);
    
    setTimeout(() => {
      console.log('\n📊 Final status:');
      BLEService.debugGetApiStatus();
    }, 1000);
  }, 5000);
};

// Force start GET API for all devices
export const forceStartAllGetAPIs = () => {
  console.log('🧪 Force starting GET API for all connected devices...');
  BLEService.forceStartGetApiForAllDevices();
  
  setTimeout(() => {
    console.log('\n📊 Status after force start:');
    BLEService.debugGetApiStatus();
  }, 1000);
};

// Force stop all GET APIs
export const forceStopAllGetAPIs = () => {
  console.log('🧪 Force stopping all GET APIs...');
  BLEService.forceStopGetApiForAllDevices();
  
  setTimeout(() => {
    console.log('\n📊 Status after force stop:');
    BLEService.debugGetApiStatus();
  }, 1000);
};

// Get device info for testing
export const getDeviceInfo = (deviceId) => {
  if (!deviceId) {
    console.log('⚠️ Please provide a device ID');
    return;
  }
  
  const device = BLEService.scannedDevices.get(deviceId);
  if (!device) {
    console.log(`⚠️ Device ${deviceId} not found`);
    return;
  }
  
  console.log(`📱 Device Info for ${deviceId}:`);
  console.log(`  Name: ${device.name}`);
  console.log(`  Connection State: ${device.connectionState}`);
  console.log(`  Screen Active: ${BLEService.screenActiveStates.get(deviceId) || 'UNSET'}`);
  console.log(`  Has GET Timer: ${BLEService.getApiTimers.has(deviceId)}`);
  
  const getApiStatus = BLEService.getGetApiStatus(deviceId);
  console.log(`  GET API Status:`, getApiStatus);
};

export default {
  testGetAPIFunctionality,
  testScreenActiveState,
  forceStartAllGetAPIs,
  forceStopAllGetAPIs,
  getDeviceInfo
};
