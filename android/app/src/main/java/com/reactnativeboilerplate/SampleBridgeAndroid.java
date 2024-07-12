package com.reactnativeboilerplate;

import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.Callback;
import android.widget.Toast;
import android.util.Log;
import okhttp3.Call;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

import java.io.IOException;

public class SampleBridgeAndroid extends ReactContextBaseJavaModule {
    private OkHttpClient client = new OkHttpClient();

    //constructor
    public SampleBridgeAndroid(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    @Override
    public String getName() {
        return "SampleBridgeAndroid";
    }

    //Custom function that we are going to export to JS
    @ReactMethod
    public void showToast(String message) {
        Toast.makeText(getReactApplicationContext(), message, Toast.LENGTH_SHORT).show();
    }

    @ReactMethod
    public void examplePayment(String strStart, String donationId, Callback callBack) {
        //your logic in here
        Log.d("CalendarModule", "Create event called with name: " + strStart
                + " and location: " + donationId);
        callBack.invoke(strStart, donationId);
    }

    @ReactMethod
    public void callExampleApi(String url, final com.facebook.react.bridge.Callback callBack) {
        Request request = new Request.Builder()
                .url(url)
                .build();

        client.newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onFailure(Call call, IOException e) {
                callBack.invoke("Error", e.getMessage());
            }

            @Override
            public void onResponse(Call call, Response response) throws IOException {
                if (!response.isSuccessful()) {
                    callBack.invoke("Error", response.message());
                } else {
                    callBack.invoke("Success", response.body().string());
                }
            }
        });
    }
}
