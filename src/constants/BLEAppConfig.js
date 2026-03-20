/**
 * BLE client config for white-label support.
 * Reads brand name, device name patterns, service UUID, and manufacturer ID from native
 * (Android: BLEClientConfigHolder, iOS: BLEClientConfigHolder) and caches for JS/UI.
 * Use getBrandName(), getAcceptedDeviceNamePatterns(), etc. so UI stays client-agnostic.
 */

import { Platform } from 'react-native';
import NativeBLE from '../NativeBridgingCodeModule';
import { BLE_SERVICES } from './BLEConstants';

const DYREID_FALLBACK = {
  brandName: 'DyreID',
  acceptedDeviceNamePatterns: ['DyreID', 'Health Tag'],
  smartTagServiceUuid: BLE_SERVICES.SMART_TAG || '0F0E0D0C-0B0A-0908-0706-050403020100',
  manufacturerId: 0x1234,
  defaultPasskey: null,
};

let cachedConfig = null;
let loadPromise = null;

/**
 * Fetch BLE client config from native and cache. Safe to call multiple times.
 * @returns {Promise<Object>} Resolved with { brandName, acceptedDeviceNamePatterns, smartTagServiceUuid, manufacturerId, defaultPasskey? }
 */
export async function loadConfig() {
  if (cachedConfig) return cachedConfig;
  if (loadPromise) return loadPromise;
  const Native = NativeBLE;
  loadPromise = (async () => {
    try {
      if (Native && typeof Native.getBLEClientConfig === 'function') {
        const config = await Native.getBLEClientConfig();
        if (config && (config.brandName || config.acceptedDeviceNamePatterns)) {
          cachedConfig = {
            brandName: config.brandName ?? DYREID_FALLBACK.brandName,
            acceptedDeviceNamePatterns: Array.isArray(config.acceptedDeviceNamePatterns)
              ? config.acceptedDeviceNamePatterns
              : DYREID_FALLBACK.acceptedDeviceNamePatterns,
            smartTagServiceUuid: config.smartTagServiceUuid ?? DYREID_FALLBACK.smartTagServiceUuid,
            manufacturerId: config.manufacturerId ?? DYREID_FALLBACK.manufacturerId,
            defaultPasskey: config.defaultPasskey ?? DYREID_FALLBACK.defaultPasskey,
          };
          return cachedConfig;
        }
      }
    } catch (e) {
      console.warn('[BLEAppConfig] getBLEClientConfig failed, using fallback:', e?.message);
    }
    cachedConfig = { ...DYREID_FALLBACK };
    return cachedConfig;
  })();
  return loadPromise;
}

function getCached() {
  return cachedConfig || DYREID_FALLBACK;
}

/** Human-readable brand name (e.g. "DyreID"). Use for UI fallbacks when device name is missing. */
export function getBrandName() {
  return getCached().brandName;
}

/** Device name substrings that identify accepted devices (e.g. ["DyreID", "Health Tag"]). */
export function getAcceptedDeviceNamePatterns() {
  return getCached().acceptedDeviceNamePatterns;
}

/** Smart tag GATT service UUID string. */
export function getSmartTagServiceUuid() {
  return getCached().smartTagServiceUuid;
}

/** Manufacturer company ID (e.g. 0x1234). */
export function getManufacturerId() {
  return getCached().manufacturerId;
}

/** Optional default passkey; null if not set. */
export function getDefaultPasskey() {
  return getCached().defaultPasskey;
}

/**
 * Returns true if the given device name matches any accepted pattern (for isSmartTag / UI).
 * @param {string} deviceName - Device name or localName
 * @returns {boolean}
 */
export function isAcceptedDeviceName(deviceName) {
  if (!deviceName || typeof deviceName !== 'string') return false;
  const patterns = getAcceptedDeviceNamePatterns();
  return patterns.some(p => deviceName.includes(p));
}

export default {
  loadConfig,
  getBrandName,
  getAcceptedDeviceNamePatterns,
  getSmartTagServiceUuid,
  getManufacturerId,
  getDefaultPasskey,
  isAcceptedDeviceName,
};
