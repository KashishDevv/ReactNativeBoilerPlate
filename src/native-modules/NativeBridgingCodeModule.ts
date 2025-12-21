/**
 * Turbo Module Spec for BridgingCodeModule
 * This provides type-safe access to the native module
 * 
 * Usage:
 * import BridgingCodeModule from './native-modules/NativeBridgingCodeModule';
 * const result = await BridgingCodeModule.passString("Hello");
 */

import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export interface Spec extends TurboModule {
  // String methods - iOS
  passString(str: string): Promise<string>;
  bothClassifyAndCallback(img: string): Promise<string>;
  
  // API call method - iOS
  makeApiCall(url: string): Promise<string>;
  
  // Android-specific methods
  showToast(message: string): void;
  examplePayment(strStart: string, donationId: string): Promise<[string, string]>;
  callExampleApi(url: string): Promise<[string, string]>;
}

// Get the Turbo Module instance
// Works with both legacy and new architecture
const BridgingCodeModule = TurboModuleRegistry.getEnforcing<Spec>('BridgingCodeModule');

export default BridgingCodeModule;
