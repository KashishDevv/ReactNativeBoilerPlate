package com.reactnativeboilerplate.config;

import androidx.annotation.NonNull;

/**
 * Holder for the active BLE client config. Set once from Application (e.g. MainApplication.onCreate)
 * so BLE core (SampleBridgeAndroid, BLEConnectionManager) can obtain config without constructor injection.
 * Enables white-label per flavor while keeping React Native bridge instantiation unchanged.
 */
public final class BLEClientConfigHolder {

    private static BLEClientConfig sConfig;

    private BLEClientConfigHolder() {}

    /**
     * Set the config. Call from Application.onCreate() (e.g. MainApplication).
     * If not set, {@link #get()} returns a new {@link DefaultBLEClientConfig}.
     */
    public static void set(@NonNull BLEClientConfig config) {
        sConfig = config;
    }

    /**
     * Get the current config. Never null: defaults to DefaultBLEClientConfig if not set.
     */
    @NonNull
    public static BLEClientConfig get() {
        if (sConfig == null) {
            sConfig = new DefaultBLEClientConfig();
        }
        return sConfig;
    }
}
