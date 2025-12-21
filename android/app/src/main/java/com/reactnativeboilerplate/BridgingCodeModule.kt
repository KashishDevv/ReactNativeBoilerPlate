package com.reactnativeboilerplate

import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableArray
import android.widget.Toast
import android.util.Log
import okhttp3.Call
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.io.IOException

/**
 * BridgingCodeModule - Turbo Module implementation for Android
 * Updated to use Promises instead of Callbacks
 * Module name: "BridgingCodeModule" - matches iOS for unified API
 * File name matches iOS: BridgingCodeModule.swift
 */
class BridgingCodeModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    
    private val client = OkHttpClient()

    override fun getName(): String {
        return "BridgingCodeModule"
    }

    // iOS-compatible methods (for unified API)
    @ReactMethod
    fun passString(str: String, promise: Promise) {
        Log.d("BridgingCodeModule", "passString called with: $str")
        promise.resolve(str)
    }

    @ReactMethod
    fun bothClassifyAndCallback(img: String, promise: Promise) {
        Log.d("BridgingCodeModule", "bothClassifyAndCallback called with: $img")
        promise.resolve(img)
    }

    @ReactMethod
    fun makeApiCall(url: String, promise: Promise) {
        val request = Request.Builder()
            .url(url)
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: Call, e: IOException) {
                promise.reject("Network Error", e.message, e)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    if (!response.isSuccessful) {
                        promise.reject("HTTP Error", response.message, null)
                    } else {
                        val responseBody = response.body?.string()
                        promise.resolve(responseBody)
                    }
                } catch (e: Exception) {
                    promise.reject("Data Error", "Unable to parse response", e)
                }
            }
        })
    }

    // Android-specific methods
    @ReactMethod
    fun showToast(message: String) {
        Toast.makeText(reactApplicationContext, message, Toast.LENGTH_SHORT).show()
    }

    @ReactMethod
    fun examplePayment(strStart: String, donationId: String, promise: Promise) {
        Log.d("BridgingCodeModule", "examplePayment called with: $strStart, $donationId")
        val result: WritableArray = Arguments.createArray()
        result.pushString(strStart)
        result.pushString(donationId)
        promise.resolve(result)
    }

    @ReactMethod
    fun callExampleApi(url: String, promise: Promise) {
        val request = Request.Builder()
            .url(url)
            .build()

        client.newCall(request).enqueue(object : okhttp3.Callback {
            override fun onFailure(call: Call, e: IOException) {
                val result: WritableArray = Arguments.createArray()
                result.pushString("Error")
                result.pushString(e.message ?: "Unknown error")
                promise.resolve(result)
            }

            override fun onResponse(call: Call, response: Response) {
                try {
                    val result: WritableArray = Arguments.createArray()
                    if (!response.isSuccessful) {
                        result.pushString("Error")
                        result.pushString(response.message)
                    } else {
                        val responseBody = response.body?.string()
                        result.pushString("Success")
                        result.pushString(responseBody ?: "")
                    }
                    promise.resolve(result)
                } catch (e: Exception) {
                    val result: WritableArray = Arguments.createArray()
                    result.pushString("Error")
                    result.pushString(e.message ?: "Unable to parse response")
                    promise.resolve(result)
                }
            }
        })
    }
}

