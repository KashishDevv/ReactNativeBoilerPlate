package com.reactnativeboilerplate.config;

import java.util.List;

/**
 * Client/brand-specific BLE configuration for white-label support.
 * Core BLE logic uses this interface instead of hardcoded UUIDs, manufacturer ID, or device name patterns.
 * Implement per flavor (e.g. DyreID, ClientB) or use {@link DefaultBLEClientConfig} for default behavior.
 */
public interface BLEClientConfig {

    /**
     * GATT service UUID used to identify "smart tag" / supported devices (e.g. in scan filter and service discovery).
     */
    String getSmartTagServiceUuid();

    /**
     * Manufacturer company ID used in BLE advertisement data (e.g. 0x1234). Used for manufacturer-data filtering and parsing.
     */
    int getManufacturerId();

    /**
     * Device name substrings that identify accepted devices during scan (e.g. "DyreID", "Health Tag").
     * A device is considered accepted if its name contains any of these strings (case-sensitive as advertised).
     */
    List<String> getAcceptedDeviceNamePatterns();

    /**
     * Optional default 6-digit passkey for pairing. Return null to use device/flow default.
     */
    String getDefaultPasskey();

    /**
     * Human-readable brand name for logs and notifications (e.g. "DyreID").
     */
    String getBrandName();
}
