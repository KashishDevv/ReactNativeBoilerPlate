package com.reactnativeboilerplate.config;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Default BLE client config (current DyreID behavior).
 * Used when no flavor-specific config is provided. Keeps existing behavior unchanged.
 */
public class DefaultBLEClientConfig implements BLEClientConfig {

    private static final String SMART_TAG_SERVICE_UUID = "0f0e0d0c-0b0a-0908-0706-050403020100";
    private static final int MANUFACTURER_ID = 0x1234;
    private static final List<String> ACCEPTED_DEVICE_NAME_PATTERNS =
            Collections.unmodifiableList(Arrays.asList("DyreID", "Health Tag"));
    private static final String DEFAULT_PASSKEY = "123456";
    private static final String BRAND_NAME = "DyreID";

    @Override
    public String getSmartTagServiceUuid() {
        return SMART_TAG_SERVICE_UUID;
    }

    @Override
    public int getManufacturerId() {
        return MANUFACTURER_ID;
    }

    @Override
    public List<String> getAcceptedDeviceNamePatterns() {
        return ACCEPTED_DEVICE_NAME_PATTERNS;
    }

    @Override
    public String getDefaultPasskey() {
        return DEFAULT_PASSKEY;
    }

    @Override
    public String getBrandName() {
        return BRAND_NAME;
    }
}
