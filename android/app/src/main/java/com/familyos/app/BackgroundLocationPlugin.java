package com.familyos.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Turning the location trail on and off, and saying honestly whether it can be.
 *
 * ## Why the background grant is not requested here
 *
 * On Android 10+ `ACCESS_BACKGROUND_LOCATION` cannot be obtained from the same
 * prompt as the foreground ones, and on 11+ it cannot be obtained from a
 * prompt at all — the system requires the person to choose *Allow all the
 * time* on the application's own settings page. A `requestPermissions` call
 * for it returns denied without showing anything, which would look to a
 * caller like the person said no.
 *
 * So `openSettings()` takes them there, and `status()` reports what is
 * actually granted rather than what was asked for. A screen that said
 * "requested" would be describing its own behaviour, not the phone's.
 */
@CapacitorPlugin(name = "BackgroundLocation")
public class BackgroundLocationPlugin extends Plugin {

    private boolean granted(String permission) {
        return getContext().checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED;
    }

    /** What the phone will actually allow, and what is running. */
    @PluginMethod
    public void status(PluginCall call) {
        boolean foreground = granted(Manifest.permission.ACCESS_FINE_LOCATION)
            || granted(Manifest.permission.ACCESS_COARSE_LOCATION);

        // Below Android 10 there is no separate background grant: foreground
        // is the whole permission. Reporting `false` there would say the
        // feature is unavailable on a device where it works.
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            ? foreground
            : granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);

        boolean notifications = Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || granted(Manifest.permission.POST_NOTIFICATIONS);

        JSObject out = new JSObject();
        out.put("foreground", foreground);
        out.put("background", background);
        out.put("notifications", notifications);
        out.put("running", LocationTrailService.isRunning());
        out.put("pending", LocationTrailService.pending());
        // The two together, because a caller that checked only `background`
        // would start a service that cannot post its own notification.
        out.put("canRun", foreground && background && notifications);
        call.resolve(out);
    }

    /**
     * The application's settings page, where "Allow all the time" lives.
     *
     * Not a permission request. The distinction is the whole reason this
     * method exists — see the note on the class.
     */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
            Uri.fromParts("package", getContext().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /** Ask for the foreground grants, which a prompt *can* obtain. */
    @PluginMethod
    public void requestForeground(PluginCall call) {
        requestPermissionForAliases(new String[] { "location" }, call, "afterRequest");
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void afterRequest(PluginCall call) {
        status(call);
    }

    /**
     * Start recording.
     *
     * Refuses rather than half-starting: a service that runs without the
     * background grant records only while the app is in front, which is what
     * the application already did and would make the switch a lie.
     */
    @PluginMethod
    public void start(PluginCall call) {
        boolean foreground = granted(Manifest.permission.ACCESS_FINE_LOCATION)
            || granted(Manifest.permission.ACCESS_COARSE_LOCATION);
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
            ? foreground
            : granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);

        if (!foreground || !background) {
            call.reject("not-permitted");
            return;
        }

        Context context = getContext();
        Intent intent = new Intent(context, LocationTrailService.class)
            .setAction(LocationTrailService.ACTION_START);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context context = getContext();
        context.startService(new Intent(context, LocationTrailService.class)
            .setAction(LocationTrailService.ACTION_STOP));
        call.resolve();
    }

    /**
     * Hand over what was recorded and empty the buffer.
     *
     * The WebView writes these into the encrypted store. Draining here rather
     * than letting the service write is what keeps one copy of a household's
     * movements rather than two, only one of which is encrypted.
     */
    @PluginMethod
    public void drain(PluginCall call) {
        JSObject out = new JSObject();
        out.put("fixes", LocationTrailService.drain());
        call.resolve(out);
    }
}
