import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // BLE Core methods
  requestPermissions(): Promise<any>;
  isBLEReady(): Promise<any>;
  startScanning(): Promise<any>;
  startScanningWithOptions(options: {
    serviceUUIDs?: string[];
    allowDuplicates?: boolean;
    scanMode?: string;
  }): Promise<any>;
  stopScanning(): Promise<any>;

  // Power Profile methods
  setPowerProfile(profileName: string): Promise<any>;
  getCurrentPowerProfile(): Promise<any>;
  connectToDevice(deviceId: string): Promise<any>;
  connectToDeviceWithOptions(
    deviceId: string,
    options: {
      timeout?: number;
      autoConnect?: boolean;
    }
  ): Promise<any>;
  disconnectFromDevice(deviceId: string): Promise<any>;
  readCharacteristic(
    deviceId: string,
    characteristicUuid: string
  ): Promise<any>;
  writeCharacteristic(
    deviceId: string,
    characteristicUuid: string,
    data: string
  ): Promise<any>;
  enableNotifications(
    deviceId: string,
    characteristicUuid: string
  ): Promise<any>;
  discoverServices(deviceId: string): Promise<any>;
  readRSSI(deviceId: string): Promise<any>;

  // System Command methods
  sendSystemCommand(
    deviceId: string,
    commandId: number,
    payload: number[]
  ): Promise<any>;
  startCommandSequence(deviceId: string): Promise<any>;
  startDataSync(deviceId: string): Promise<any>;
  readDeviceStatus(deviceId: string): Promise<any>;
  getDataSyncState(deviceId: string): Promise<any>;
  isNativePollingActive(deviceId: string): Promise<any>;
  getManufacturerInfo(): Promise<any>;
  updatePasskey(deviceId: string, passkey: string): Promise<any>;

  // Auto-Connect methods
  startAutoConnect(): Promise<any>;
  stopAutoConnect(): Promise<any>;
  addBondedDevice(deviceId: string): Promise<any>;
  removeBondedDevice(deviceId: string): Promise<any>;
  getBondedDevices(): Promise<any>;
  getForgottenDevices(): Promise<any>;
  getAutoConnectStatus(): Promise<any>;
  forceScanForBondedDevices(): Promise<any>;
  debugConnectionStatus(): Promise<any>;
  connectToKnownPeripherals(): Promise<any>;
  disconnectFromNative(deviceId: string): Promise<any>;

  // DFU (Device Firmware Update) methods
  enterDFUMode(deviceId: string): Promise<any>;
  startDFU(deviceId: string, firmwarePath: string): Promise<any>;
  cancelDFU(): Promise<any>;
  isDeviceInDFUMode(deviceId: string): Promise<any>;
  getDFUServiceUUID(): Promise<any>;

  // Resource Management methods
  getResourceStatus(): Promise<any>;

  // Add event emitter methods
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('BridgingCodeModule');

