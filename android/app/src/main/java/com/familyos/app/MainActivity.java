package com.familyos.app;

import android.os.Bundle;
import android.view.WindowManager;

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
        registerPlugin(BiometricPlugin.class);
        super.onCreate(savedInstanceState);

        // Android photographs the screen every time the app goes to the
        // background, and keeps the picture for the recents switcher. Nobody
        // asks for that capture and nothing on screen is redacted for it, so
        // whatever a household had open — a balance, a health record, an
        // identifier they had tapped to reveal — sits in the switcher until
        // the task is dismissed.
        //
        // FLAG_SECURE is the only thing that blanks it. It is set here, for
        // the window's whole life, rather than toggled around onPause: the
        // toggle depends on the flag landing before the system takes its
        // snapshot, which varies by OEM and version, and a protection whose
        // correctness rests on a race nobody can test is not one worth
        // claiming.
        //
        // The cost is deliberate and paid app-wide: no screenshots of
        // FamilyOS, no screen recording, and no casting. A screenshot is a
        // choice somebody makes; the recents capture is not, and that
        // asymmetry is the whole argument.
        //
        // `docs/UI_INFORMATION_ARCHITECTURE.md` covers the other half — the
        // window *title*, which never carries a record name.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE);
    }
}
