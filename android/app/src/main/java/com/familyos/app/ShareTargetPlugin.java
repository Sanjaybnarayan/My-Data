package com.familyos.app;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Files handed to FamilyOS by another app's share sheet.
 *
 * <p>Until this existed the only way a document got in was the picker on the
 * Documents screen. The application could already read a PDF, a Word file and
 * a spreadsheet, and had no way to be handed one from Gmail or WhatsApp.
 *
 * <p><b>This class does not decide anything.</b> It resolves a content URI to
 * a name, a declared type and bytes, and hands all three to the WebView.
 * Whether a file can be read, what it is, and what to fill in from it are
 * decided in JavaScript — where {@code domain/filing.js} and
 * {@code domain/extract.js} live, with tests over them. Duplicating any of
 * that judgement here would put a second, untested copy in front of the first,
 * which is the argument {@code SmsInboxPlugin} makes about message filtering
 * and it applies unchanged.
 *
 * <p><b>Pending, not pushed.</b> The shared intent is kept until JavaScript
 * asks for it. An event fired at the bridge races the WebView's own startup:
 * on a cold share — the app was not running, Android starts it *because* of
 * the share — the intent is delivered before any listener exists, and the file
 * would be silently dropped. So the intent is held and {@code take()} drains
 * it, which works the same whether the app was already open or not.
 *
 * <p>{@code MainActivity} is {@code launchMode="singleTask"}, so a share into
 * a running app arrives at {@code onNewIntent} and never at {@code onCreate}.
 * Both feed {@link #offer(Intent)}; handling only one of them is a share that
 * works exactly once per launch.
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    /**
     * The share waiting to be collected, or null.
     *
     * <p>Static because the intent arrives at the Activity before the plugin
     * instance is reachable, and a share that lands during startup is the
     * common case rather than the edge one.
     */
    private static Intent pending = null;

    /** Called by {@code MainActivity} from both {@code onCreate} and {@code onNewIntent}. */
    public static void offer(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            pending = intent;
        }
    }

    /** The single-file cap, matching MAX_UPLOAD_BYTES in js/sync/drive.js. */
    private static final int MAX_BYTES = 8 * 1024 * 1024;

    /**
     * The shared files, and then nothing.
     *
     * <p>Draining rather than peeking: a share collected twice is a document
     * filed twice, and the JavaScript side asks again on every resume.
     */
    @PluginMethod
    public void take(PluginCall call) {
        Intent intent = pending;
        pending = null;

        JSObject result = new JSObject();
        JSArray files = new JSArray();

        if (intent == null) {
            result.put("files", files);
            call.resolve(result);
            return;
        }

        for (Uri uri : urisOf(intent)) {
            JSObject one = read(uri);
            if (one != null) files.put(one);
        }

        result.put("files", files);
        call.resolve(result);
    }

    /*
     * There is deliberately no `pendingCount()`.
     *
     * One was written — "whether anything is waiting, without taking it" — and
     * nothing called it. `take()` drains, and a caller that wanted to know
     * whether a share was waiting would ask by taking it. A sweep in
     * `tests/ocr.test.mjs` now fails on any plugin method the JavaScript never
     * invokes; it found this one and an `available()` in `OcrPlugin`, both
     * written in the same sitting as the check that catches them.
     */

    private static List<Uri> urisOf(Intent intent) {
        List<Uri> out = new ArrayList<>();
        if (intent == null) return out;

        if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) {
                for (Uri uri : many) if (uri != null) out.add(uri);
            }
            return out;
        }

        Uri one = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (one != null) {
            out.add(one);
            return out;
        }

        // Some apps put the file on the clip data instead of EXTRA_STREAM.
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) out.add(uri);
            }
        }
        return out;
    }

    /**
     * One shared file as name, declared type and base64 bytes.
     *
     * <p>Returns null rather than a half-filled object for anything that could
     * not be read: a file with no bytes filed under its name would be a
     * document the household cannot open, which is worse than being told the
     * share did not work.
     */
    private JSObject read(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();

        String name = null;
        long size = -1;
        try (Cursor cursor = resolver.query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameAt = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeAt = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameAt >= 0) name = cursor.getString(nameAt);
                if (sizeAt >= 0 && !cursor.isNull(sizeAt)) size = cursor.getLong(sizeAt);
            }
        } catch (Exception ignored) {
            // A provider that refuses to be queried can still be opened.
        }

        if (name == null) name = uri.getLastPathSegment();
        if (name == null) name = "shared";

        // Checked before reading, not after: an 80 MB video should not be
        // pulled into memory to find out it is too large.
        if (size > MAX_BYTES) {
            JSObject tooBig = new JSObject();
            tooBig.put("name", name);
            tooBig.put("type", resolver.getType(uri));
            tooBig.put("size", size);
            tooBig.put("tooLarge", true);
            return tooBig;
        }

        byte[] bytes;
        try (InputStream in = resolver.openInputStream(uri)) {
            if (in == null) return null;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int read;
            int total = 0;
            while ((read = in.read(chunk)) != -1) {
                total += read;
                // A provider that lied about SIZE, or reported none at all.
                if (total > MAX_BYTES) {
                    JSObject tooBig = new JSObject();
                    tooBig.put("name", name);
                    tooBig.put("type", resolver.getType(uri));
                    tooBig.put("size", total);
                    tooBig.put("tooLarge", true);
                    return tooBig;
                }
                out.write(chunk, 0, read);
            }
            bytes = out.toByteArray();
        } catch (Exception failed) {
            return null;
        }

        JSObject one = new JSObject();
        one.put("name", name);
        // The declared type, whatever it is. `readerFor` in JavaScript falls
        // back to the file name, which is the case this so often is.
        one.put("type", resolver.getType(uri));
        one.put("size", bytes.length);
        one.put("tooLarge", false);
        one.put("bytes", Base64.encodeToString(bytes, Base64.NO_WRAP));
        return one;
    }
}
