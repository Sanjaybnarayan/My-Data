package com.familyos.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered before super, which is where Capacitor builds the bridge
        // and reads the plugin list. Registering afterwards produces a plugin
        // the WebView cannot see, and `js/core/native.js` would correctly
        // report it unavailable and fall back — a silent no-op rather than an
        // error, which is the hardest kind of wiring mistake to notice.
        registerPlugin(SmsInboxPlugin.class);
        registerPlugin(BackgroundLocationPlugin.class);
        registerPlugin(ScreenTimePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
