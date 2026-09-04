/**
 * Biometric unlock, through WebAuthn.
 *
 * A fingerprint does not encrypt anything by itself. What makes this real
 * rather than decorative is the **PRF extension**: the authenticator derives
 * 32 deterministic bytes from a salt, and only after the biometric gesture has
 * succeeded. Those bytes become a key-encryption key wrapping the same data
 * key the PIN wraps.
 *
 * Where the PRF extension is unavailable — older platforms, some browsers —
 * biometrics are offered as a *convenience* lock instead, and the difference
 * is stated to the user rather than hidden: the fingerprint gates the screen,
 * but the data key still comes from the PIN, which the user must have entered
 * this session. Pretending otherwise would be security theatre with a real
 * person's Aadhaar behind it.
 */

import { AppError } from '../core/errors.js';
import { randomBytes, toBase64, fromBase64 } from '../security/crypto.js';
import { plugin } from '../core/native.js';
import { t } from '../core/locale.js';

const RP_NAME = 'FamilyOS';
const PRF_SALT = new TextEncoder().encode('familyos:data-key:v1');

/**
 * The native fingerprint, where there is one.
 *
 * `null` in a browser, and in a build without the plugin — the same contract
 * every other native capability has, so the WebAuthn path below is reached
 * unchanged by everything that is not the Android app.
 *
 * It returns the *same shape* WebAuthn PRF does: 32 bytes, after the gesture,
 * that wrap the data key through the keyring's ordinary `addMethod`. That is
 * deliberate — the two paths differ in where the bytes come from and in
 * nothing else, so `lock.js` and the keyring need to know about neither.
 */
function nativeBiometric() {
  return plugin('Biometric');
}

const decode = (base64) => Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

export function webAuthnAvailable() {
  return Boolean(globalThis.PublicKeyCredential && globalThis.navigator?.credentials);
}

/** Is there a fingerprint reader or face unlock on this device? */
export async function platformAuthenticatorAvailable() {
  const native = nativeBiometric();
  if (native) {
    try {
      return Boolean((await native.available()).available);
    } catch {
      return false;
    }
  }
  if (!webAuthnAvailable()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Enrol a credential. Requires the app to be unlocked already, because the
 * derived key has to wrap a data key that is currently in memory.
 *
 * @returns {Promise<{credentialId: string, rawKey: Uint8Array|null, prf: boolean}>}
 */
/**
 * Enrol this device's biometric.
 *
 * `displayName` is optional and defaults to `userName` below — declared here
 * because a bare destructure reads as three required fields to the checker,
 * and every call site that sensibly omitted it was reported as an error.
 *
 * @param {{userId: string, userName: string, displayName?: string}} who
 */
export async function enrolBiometric({ userId, userName, displayName }) {
  const native = nativeBiometric();
  if (native) {
    // `prf: true` because this path derives a key too. The flag has never
    // meant "WebAuthn said so" — it means the fingerprint produces bytes that
    // unwrap the data key, which is the only thing any caller does with it.
    const { rawKey } = await native.enrol().catch((err) => {
      throw new AppError(err?.message ?? 'Enrolment failed.',
        { code: err?.code === 'cancelled' ? 'cancelled' : 'biometric-failed' });
    });
    return { credentialId: 'native', rawKey: decode(rawKey), prf: true };
  }

  if (!webAuthnAvailable()) {
    throw new AppError('This browser has no biometric support.', { code: 'no-webauthn' });
  }

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: RP_NAME, id: globalThis.location.hostname },
      user: {
        id: new TextEncoder().encode(userId),
        name: userName,
        displayName: displayName ?? userName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256, for authenticators without EC
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60_000,
      // No attestation: FamilyOS does not care which authenticator model this
      // is, and asking for it would send an identifier nobody needs.
      attestation: 'none',
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });

  if (!credential) throw new AppError('Enrolment was cancelled.', { code: 'cancelled' });

  const results = credential.getClientExtensionResults?.().prf;
  const prfSupported = Boolean(results?.enabled ?? results?.results?.first);

  return {
    credentialId: toBase64(new Uint8Array(credential.rawId)),
    rawKey: results?.results?.first ? new Uint8Array(results.results.first) : null,
    prf: prfSupported,
  };
}

/**
 * Ask for the gesture and derive the key again.
 *
 * @returns {Promise<{rawKey: Uint8Array|null, verified: boolean}>}
 *   `rawKey` is null where PRF is unsupported; `verified` says the gesture
 *   itself succeeded, which is all the convenience path needs.
 */
export async function unlockWithBiometric(credentialId) {
  const native = nativeBiometric();
  if (native) {
    const { rawKey } = await native.unlock().catch((err) => {
      // `invalidated` is not a fault: a fingerprint was added to the device,
      // so Android destroyed the key on purpose. The PIN still works, and the
      // household can enrol again.
      const code = err?.code === 'cancelled' ? 'cancelled'
        : err?.code === 'invalidated' ? 'biometric-invalidated'
          : 'biometric-failed';
      throw new AppError(err?.message ?? 'Unlock failed.', { code });
    });
    return { rawKey: decode(rawKey), verified: true };
  }

  if (!webAuthnAvailable()) {
    throw new AppError('This browser has no biometric support.', { code: 'no-webauthn' });
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: globalThis.location.hostname,
      allowCredentials: credentialId
        ? [{ type: 'public-key', id: fromBase64(credentialId) }]
        : [],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: PRF_SALT } } },
    },
  });

  if (!assertion) throw new AppError('Unlock was cancelled.', { code: 'cancelled' });

  const results = assertion.getClientExtensionResults?.().prf;
  return {
    rawKey: results?.results?.first ? new Uint8Array(results.results.first) : null,
    verified: true,
  };
}

/**
 * Why it is not on offer, when it is not.
 *
 * Three different absences were reported with one sentence, and the sentence
 * was wrong for the one a household actually met. Tapping *Set up
 * fingerprint* in the Android app said "This device has no fingerprint or
 * face unlock available to the browser" — on a phone with a reader on the
 * back of it. The reader was there; WebAuthn was not, and blaming the
 * hardware sent somebody to look in their phone's settings for a switch that
 * was never the problem.
 *
 * @returns {Promise<string|null>} null when biometrics can be offered.
 */
export async function biometricUnavailableReason() {
  const native = nativeBiometric();
  if (native) {
    try {
      const { available, reason } = await native.available();
      if (available) return null;
      if (reason === 'no-fingerprint-enrolled') return t('biometric.noneEnrolled');
      return t('biometric.noSensor');
    } catch {
      return t('biometric.serviceSilent');
    }
  }

  if (!webAuthnAvailable()) {
    return t('biometric.noBrowserSupport');
  }
  if (!(await platformAuthenticatorAvailable())) {
    return t('biometric.noReaderForBrowser');
  }
  return null;
}

/**
 * What to tell the user before they enrol. The honest version, not the
 * marketing one.
 */
export function biometricExplanation(prfSupported) {
  return prfSupported ? t('biometric.derivesKey') : t('biometric.gestureOnly');
}
