package com.familyos.app;

import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.os.Process;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.List;

/**
 * How long applications were used on this device.
 *
 * ## This is a record about a person, and the permission is not the gate
 *
 * `PACKAGE_USAGE_STATS` is *special access*: it cannot be requested at
 * runtime, the system shows no prompt, and a person has to switch it on in
 * Settings. `openSettings()` takes them there.
 *
 * Having it is necessary and **not sufficient**. Reading which applications
 * somebody used is a record about that person in exactly the sense
 * `js/data/consent.js` means, so `js/services/screentime.js` refuses unless a
 * consent decision exists for them. This plugin deliberately knows nothing
 * about that — it reports what the device will tell it, and the layer that
 * knows who the phone belongs to decides whether to ask.
 *
 * ## What it does not return
 *
 * No per-launch history and no timestamps of individual openings. Totals per
 * package over a window, which is what a household asking "how long has this
 * phone been on TikTok this week" needs, and materially less than a log of
 * every time somebody picked their phone up.
 */
@CapacitorPlugin(name = "ScreenTime")
public class ScreenTimePlugin extends Plugin {

    private boolean permitted() {
        AppOpsManager ops = (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        if (ops == null) return false;
        int mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,
            Process.myUid(), getContext().getPackageName());
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject out = new JSObject();
        out.put("permitted", permitted());
        call.resolve(out);
    }

    /** The special-access page. There is no runtime prompt for this one. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    /**
     * Totals per application between two instants.
     *
     * @param call `from` and `to`, epoch milliseconds.
     */
    @PluginMethod
    public void usage(PluginCall call) {
        if (!permitted()) {
            call.reject("not-permitted");
            return;
        }

        long from = call.getLong("from", 0L);
        long to = call.getLong("to", System.currentTimeMillis());

        UsageStatsManager manager =
            (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        List<UsageStats> stats =
            manager.queryUsageStats(UsageStatsManager.INTERVAL_BEST, from, to);

        JSArray apps = new JSArray();
        if (stats != null) {
            for (UsageStats one : stats) {
                if (one.getTotalTimeInForeground() <= 0) continue;
                try {
                    JSONObject row = new JSONObject();
                    row.put("package", one.getPackageName());
                    row.put("foregroundMs", one.getTotalTimeInForeground());
                    row.put("lastUsed", one.getLastTimeUsed());
                    apps.put(row);
                } catch (Exception ignored) {
                    // One unreadable row is skipped rather than failing the
                    // whole window — a partial answer that says so beats none.
                }
            }
        }

        JSObject out = new JSObject();
        out.put("apps", apps);
        out.put("from", from);
        out.put("to", to);
        call.resolve(out);
    }
}
