package com.familyos.app;

import android.Manifest;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Reading the SMS inbox, for Phase 6.
 *
 * <h2>What this deliberately does not do</h2>
 *
 * It does not classify, redact, or decide anything about a message. It hands
 * the rows over exactly as the provider gives them and every judgement — is
 * this a one-time code, is it a debit, is it worth keeping — happens in
 * {@code js/domain/sms.js}.
 *
 * That is not laziness. Those patterns already exist in JavaScript, are tested
 * there, and are the thing rule 53 depends on. A second copy here would be a
 * hand-maintained list beside a derivable one, and the two would drift — with
 * the Java copy being the one that decides whether somebody's one-time code
 * gets read. The safe place for that rule is the place that is tested, and
 * there is exactly one of those.
 *
 * The consequence is stated plainly: <b>a one-time code does cross this
 * bridge.</b> It is read into memory, handed to JavaScript, classified as
 * {@code AUTHENTICATION_SECRET}, and dropped without ever being written. It is
 * never stored, never sent anywhere, and never reaches a model. Filtering here
 * instead would mean trusting a duplicate of the patterns; filtering there
 * means trusting the ones with tests against them.
 *
 * <h2>Read-only, and only the inbox</h2>
 *
 * {@code content://sms/inbox} and nothing else. Sent messages, drafts and the
 * conversation list are not read, no message is written, marked, or deleted,
 * and this app is not and does not become an SMS handler.
 */
@CapacitorPlugin(
    name = "SmsInbox",
    permissions = {
        @Permission(alias = SmsInboxPlugin.SMS, strings = { Manifest.permission.READ_SMS })
    }
)
public class SmsInboxPlugin extends Plugin {

    static final String SMS = "sms";

    private static final Uri INBOX = Uri.parse("content://sms/inbox");

    /**
     * A page of inbox messages, newest first.
     *
     * <p>{@code since} is a millisecond epoch and is exclusive, so a caller
     * that stores the newest timestamp it has seen can ask for "anything after
     * that" without re-reading an inbox that may hold years of messages.
     */
    @PluginMethod
    public void read(PluginCall call) {
        if (!granted()) {
            // A distinct code rather than an empty list. "No permission" and
            // "no messages" are different facts, and a screen that cannot tell
            // them apart tells somebody their bank sends no alerts.
            call.reject("SMS permission has not been granted", "DENIED");
            return;
        }

        long since = call.getLong("since", 0L);
        int limit = call.getInt("limit", 200);
        if (limit < 1) limit = 1;
        if (limit > 1000) limit = 1000;

        JSArray messages = new JSArray();
        Cursor cursor = null;

        try {
            cursor = getContext().getContentResolver().query(
                INBOX,
                new String[] { "_id", "address", "body", "date" },
                "date > ?",
                new String[] { String.valueOf(since) },
                "date DESC LIMIT " + limit
            );

            if (cursor != null) {
                while (cursor.moveToNext()) {
                    JSObject message = new JSObject();
                    message.put("id", cursor.getString(0));
                    message.put("sender", cursor.getString(1));
                    message.put("text", cursor.getString(2));
                    message.put("receivedAt", cursor.getLong(3));
                    messages.put(message);
                }
            }
        } catch (Exception error) {
            // Surfaced, never swallowed. A provider that refuses is a fact the
            // household should be shown rather than a quietly empty screen.
            call.reject("could not read the inbox: " + error.getMessage(), "READ_FAILED");
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = new JSObject();
        result.put("messages", messages);
        call.resolve(result);
    }

    // checkPermissions() and requestPermissions() are deliberately NOT
    // overridden. Capacitor's Plugin base class already implements both from
    // the @CapacitorPlugin annotation above, keyed by the "sms" alias, and
    // returns exactly the { sms: granted | denied | prompt } shape that
    // js/core/smsinbox.js reads. A hand-written pair here would be a second
    // implementation of the framework's own permission handling — more code,
    // no tests, and the one deciding whether an inbox gets read.

    private boolean granted() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_SMS)
            == PackageManager.PERMISSION_GRANTED;
    }
}
