package com.familyos.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock that actually unlocks something.
 *
 * ## Why this exists at all
 *
 * `js/auth/biometric.js` unlocks through WebAuthn, whose PRF extension hands
 * back 32 deterministic bytes after the gesture — bytes that wrap the data
 * key. WebAuthn is not implemented in an Android WebView, so in the app that
 * path is simply absent, which `docs/CAPACITOR_INTEGRATION_PLAN.md` recorded
 * before the app shipped.
 *
 * What it did not say is that the obvious substitute is worthless here. A
 * plugin that only answers "yes, that was them" cannot unlock FamilyOS,
 * because `Keyring.lock()` drops the data key and every lock path goes
 * through it: idle timeout, Lock now, Settings. There is no state in which
 * the key is still in memory and a gesture is all that is missing. A
 * fingerprint has to *produce* key material or it is a speed bump before the
 * PIN.
 *
 * ## What this stores, and what protects it
 *
 * Enrolment generates 32 random bytes — the same shape WebAuthn PRF returns —
 * and hands them to the web layer once, which wraps the data key under them
 * through the keyring's ordinary `addMethod`. Nothing here knows what a data
 * key is.
 *
 * Those 32 bytes are then encrypted with an AES key generated *inside* the
 * Android Keystore, and only the ciphertext is written to disk. The Keystore
 * key is:
 *
 *   - non-exportable — it cannot be read out of the secure hardware at all;
 *   - `setUserAuthenticationRequired(true)` — unusable until a biometric
 *     authentication has just succeeded, enforced by the OS rather than by
 *     this code;
 *   - `setInvalidatedByBiometricEnrollment(true)` — destroyed the moment a
 *     new fingerprint is added to the device.
 *
 * That last one matters and is the reason a `KeyPermanentlyInvalidatedException`
 * is reported as its own code rather than a generic failure: somebody adding
 * a fingerprint must not thereby gain access to a household's records, so the
 * key dies and the PIN takes over until they enrol again.
 *
 * The ciphertext left behind is inert. Without the Keystore key it is 32
 * unknown bytes, and the Keystore key does not exist outside this device's
 * secure hardware.
 *
 * ## What it is not
 *
 * It is not a second copy of the data key, and it is not a way around the
 * PIN. `Keyring.removeMethod` refuses to remove the last method, so the PIN
 * always remains; this adds a second door to the same room, openable only by
 * the person whose finger the device already knows.
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {

    private static final String KEY_ALIAS = "familyos.biometric.kek.v1";
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String PREFS = "familyos.biometric";
    private static final String PREF_PAYLOAD = "wrapped";
    private static final String PREF_IV = "iv";
    private static final int SECRET_BYTES = 32;
    private static final int GCM_TAG_BITS = 128;

    /** Strong biometrics only: a class-3 sensor is what may gate a Keystore key. */
    private static final int STRENGTH = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /**
     * Can this device offer it at all?
     *
     * Every branch is named rather than collapsed into a boolean, because
     * "no hardware" and "hardware present, nothing enrolled" are different
     * sentences to show a person and only one of them is worth acting on.
     */
    @PluginMethod
    public void available(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int status = manager.canAuthenticate(STRENGTH);
        JSObject out = new JSObject();
        out.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        out.put("enrolled", prefs().contains(PREF_PAYLOAD));
        switch (status) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                out.put("reason", "");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                out.put("reason", "no-fingerprint-enrolled");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                out.put("reason", "no-hardware");
                break;
            default:
                out.put("reason", "unavailable");
                break;
        }
        call.resolve(out);
    }

    /** Generate the Keystore key. Replaces any previous one. */
    private SecretKey createKey() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setUserAuthenticationRequired(true)
                .setInvalidatedByBiometricEnrollment(true);
        // API 30 renamed the validity call and split out the allowed types.
        // Zero seconds with a `CryptoObject` means "this one use, right now",
        // which is the only guarantee worth having here.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        generator.init(spec.build());
        return generator.generateKey();
    }

    private SecretKey loadKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return (SecretKey) store.getKey(KEY_ALIAS, null);
    }

    private void deleteKey() {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            store.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
            // Nothing to undo. The caller is already on an error path.
        }
        prefs().edit().remove(PREF_PAYLOAD).remove(PREF_IV).apply();
    }

    private BiometricPrompt.PromptInfo promptInfo(String title) {
        return new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle("FamilyOS")
                // No "use PIN instead" here: the app's own PIN screen is the
                // fallback, and offering the *device* PIN would authenticate
                // against a secret that has nothing to do with this data.
                .setNegativeButtonText("Cancel")
                .setAllowedAuthenticators(STRENGTH)
                .setConfirmationRequired(false)
                .build();
    }

    /** Run a prompt bound to `cipher`, then hand the cipher back. */
    private void authenticate(PluginCall call, String title, Cipher cipher, CipherReady then) {
        FragmentActivity activity = getActivity();
        if (activity == null) {
            call.reject("no activity", "unavailable");
            return;
        }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                    activity,
                    ContextCompat.getMainExecutor(getContext()),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                            Cipher authorised = crypto == null ? null : crypto.getCipher();
                            if (authorised == null) {
                                call.reject("the gesture returned no cipher", "unavailable");
                                return;
                            }
                            try {
                                then.run(authorised);
                            } catch (Exception e) {
                                call.reject(String.valueOf(e.getMessage()), "failed");
                            }
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence message) {
                            // Cancellation is not a fault and the web layer
                            // treats this code as silence.
                            boolean cancelled = code == BiometricPrompt.ERROR_USER_CANCELED
                                    || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                                    || code == BiometricPrompt.ERROR_CANCELED;
                            call.reject(String.valueOf(message), cancelled ? "cancelled" : "failed");
                        }
                    });
            prompt.authenticate(promptInfo(title), new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private interface CipherReady {
        void run(Cipher cipher) throws Exception;
    }

    /**
     * Enrol: make new key material, gate it behind the fingerprint, and hand
     * the bytes to the web layer once so it can wrap the data key under them.
     */
    @PluginMethod
    public void enrol(PluginCall call) {
        try {
            deleteKey();
            SecretKey key = createKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);

            byte[] secret = new byte[SECRET_BYTES];
            new SecureRandom().nextBytes(secret);

            authenticate(call, "Set up fingerprint unlock", cipher, (authorised) -> {
                byte[] sealed = authorised.doFinal(secret);
                prefs().edit()
                        .putString(PREF_PAYLOAD, Base64.encodeToString(sealed, Base64.NO_WRAP))
                        .putString(PREF_IV, Base64.encodeToString(authorised.getIV(), Base64.NO_WRAP))
                        .apply();
                JSObject out = new JSObject();
                out.put("rawKey", Base64.encodeToString(secret, Base64.NO_WRAP));
                call.resolve(out);
            });
        } catch (Exception e) {
            deleteKey();
            call.reject(String.valueOf(e.getMessage()), "failed");
        }
    }

    /** Unlock: the same 32 bytes back, and only after the gesture. */
    @PluginMethod
    public void unlock(PluginCall call) {
        String sealed = prefs().getString(PREF_PAYLOAD, null);
        String iv = prefs().getString(PREF_IV, null);
        if (sealed == null || iv == null) {
            call.reject("nothing enrolled on this device", "not-enrolled");
            return;
        }
        try {
            SecretKey key = loadKey();
            if (key == null) {
                deleteKey();
                call.reject("the enrolled key is gone", "invalidated");
                return;
            }
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key,
                    new GCMParameterSpec(GCM_TAG_BITS, Base64.decode(iv, Base64.NO_WRAP)));

            authenticate(call, "Unlock FamilyOS", cipher, (authorised) -> {
                byte[] secret = authorised.doFinal(Base64.decode(sealed, Base64.NO_WRAP));
                JSObject out = new JSObject();
                out.put("rawKey", Base64.encodeToString(secret, Base64.NO_WRAP));
                call.resolve(out);
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            // A fingerprint was added or removed since enrolment. The key is
            // gone by design; say which failure this is so the web layer can
            // offer to enrol again rather than reporting a fault.
            deleteKey();
            call.reject("a new fingerprint was added to this device", "invalidated");
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()), "failed");
        }
    }

    /** Forget it. Used when the household turns the feature off. */
    @PluginMethod
    public void clear(PluginCall call) {
        deleteKey();
        call.resolve();
    }
}
