package com.familyos.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Records positions while the application is not in front.
 *
 * A foreground service, which on Android is the only honest way to do this:
 * the notification cannot be dismissed while it runs, so a phone recording
 * where somebody is says so on its own screen. That is a requirement of the
 * platform and it is also the right behaviour — a background recorder nobody
 * can see is the thing this application spent its whole design avoiding.
 *
 * ## What it keeps, and what it does not
 *
 * Positions are held in memory in a bounded ring and handed to the WebView
 * when it next asks. **Nothing is written to disk here.** The database is
 * inside the WebView, encrypted with a key the service does not have and must
 * not have — a service that could write records would be a second, unencrypted
 * copy of the most sensitive thing this application holds.
 *
 * The consequence is stated rather than hidden: if the process is killed
 * before the WebView drains the ring, those positions are gone. That is the
 * correct trade. A trail that survives a kill would have to be a plaintext
 * file.
 *
 * ## It does not start itself
 *
 * There is no BOOT_COMPLETED receiver and nothing starts this on launch. It
 * runs when a person turns it on and stops when they turn it off or the
 * notification's Stop action is used.
 */
public class LocationTrailService extends Service {

    public static final String ACTION_START = "com.familyos.app.TRAIL_START";
    public static final String ACTION_STOP = "com.familyos.app.TRAIL_STOP";
    private static final String CHANNEL_ID = "familyos_location_trail";
    private static final int NOTIFICATION_ID = 4517;

    /** How many fixes are held before the oldest is dropped. */
    private static final int RING = 500;

    /** Minimum time and distance between fixes. Battery, not precision. */
    private static final long MIN_MS = 5 * 60 * 1000L;
    private static final float MIN_METRES = 50f;

    private static final Deque<JSONObject> trail = new ArrayDeque<>();
    private static boolean running = false;

    private LocationManager locations;
    private LocationListener listener;

    public static boolean isRunning() {
        return running;
    }

    /** Everything recorded since the last drain, oldest first. Empties the ring. */
    public static JSONArray drain() {
        JSONArray out = new JSONArray();
        synchronized (trail) {
            while (!trail.isEmpty()) out.put(trail.pollFirst());
        }
        return out;
    }

    public static int pending() {
        synchronized (trail) {
            return trail.size();
        }
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopRecording();
            return START_NOT_STICKY;
        }
        startRecording();
        // NOT sticky. If Android kills this, it stays stopped until a person
        // turns it back on — restarting a location recorder without anybody
        // asking is exactly the behaviour the notification exists to prevent.
        return START_NOT_STICKY;
    }

    private void startRecording() {
        if (running) return;
        createChannel();

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FamilyOS is recording where this phone is")
            .setContentText("Turn it off in FamilyOS under Safety.")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Stop", stopIntent())
            .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIFICATION_ID, notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        locations = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                record(location);
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) { }

            @Override
            public void onProviderEnabled(String provider) { }

            @Override
            public void onProviderDisabled(String provider) { }
        };

        try {
            locations.requestLocationUpdates(
                LocationManager.GPS_PROVIDER, MIN_MS, MIN_METRES, listener);
            locations.requestLocationUpdates(
                LocationManager.NETWORK_PROVIDER, MIN_MS, MIN_METRES, listener);
            running = true;
        } catch (SecurityException denied) {
            // The grant was withdrawn between the check and here. Stop rather
            // than sit in the foreground with a notification and no readings,
            // which would tell a person they are being recorded when they are
            // not — a lie in the more alarming direction.
            stopRecording();
        } catch (IllegalArgumentException noProvider) {
            // A device with no GPS at all. The manifest already declares the
            // feature optional; this is the runtime half of that.
            running = true;
        }
    }

    private void record(Location location) {
        if (location == null) return;
        try {
            JSONObject fix = new JSONObject();
            fix.put("latitude", location.getLatitude());
            fix.put("longitude", location.getLongitude());
            fix.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : JSONObject.NULL);
            fix.put("at", location.getTime());
            synchronized (trail) {
                if (trail.size() >= RING) trail.pollFirst();
                trail.addLast(fix);
            }
        } catch (Exception ignored) {
            // A fix that cannot be written down is dropped rather than
            // crashing a service the person cannot easily restart.
        }
    }

    private void stopRecording() {
        if (locations != null && listener != null) {
            try {
                locations.removeUpdates(listener);
            } catch (SecurityException ignored) { }
        }
        running = false;
        stopForeground(true);
        stopSelf();
    }

    private PendingIntent stopIntent() {
        Intent intent = new Intent(this, LocationTrailService.class).setAction(ACTION_STOP);
        return PendingIntent.getService(this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID,
            "Location recording", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown whenever FamilyOS is recording where this phone is.");
        manager.createNotificationChannel(channel);
    }

    @Override
    public void onDestroy() {
        stopRecording();
        super.onDestroy();
    }
}
