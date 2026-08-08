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

const RP_NAME = 'FamilyOS';
const PRF_SALT = new TextEncoder().encode('familyos:data-key:v1');

export function webAuthnAvailable() {
  return Boolean(globalThis.PublicKeyCredential && globalThis.navigator?.credentials);
}

/** Is there a fingerprint reader or face unlock on this device? */
export async function platformAuthenticatorAvailable() {
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
export async function enrolBiometric({ userId, userName, displayName }) {
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
 * What to tell the user before they enrol. The honest version, not the
 * marketing one.
 */
export function biometricExplanation(prfSupported) {
  return prfSupported
    ? 'Your fingerprint will unlock FamilyOS on its own. The key is derived by '
      + 'the security chip and never leaves this device.'
    : 'This device cannot derive an encryption key from your fingerprint, so the '
      + 'fingerprint will unlock the screen but your PIN still protects the data. '
      + 'You will be asked for the PIN after the app has been fully closed.';
}
