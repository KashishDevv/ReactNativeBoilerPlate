package com.reactnativeboilerplate

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * BridgingCodeModulePackage - Package for registering BridgingCodeModule
 * File name matches naming convention for consistency
 */
class BridgingCodeModulePackage : ReactPackage {
    
    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }

    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(BridgingCodeModule(reactContext))
    }
}

