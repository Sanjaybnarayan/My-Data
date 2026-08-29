/**
 * Signing in with Google, as one thing two screens can use.
 *
 * The lock screen needs it to let somebody in. Settings needs it to turn the
 * option on afterwards — which, until this file existed, was impossible: the
 * enrolment path ran only on first run, so a household that started with a PIN
 * could never add Google at all, and pressing the button on a later device
 * told them their account had no key on it. Which was true, and unhelpful,
 * because nothing anywhere offered to put one there.
 *
 * ## The bug this exists to end
 *
 * A device with no keyring takes the *enrolment* path — that is what having no
 * data key means. Enrolment minted a key and stored it in one call, and
 * storing replaces the file. So setting up a second phone wrote straight over
 * the key the first one depended on, and the first phone's `google` wrapping
 * was left pointing at bytes that no longer existed anywhere. A household that
 * had chosen Google *instead of* a PIN lost everything on the first device by
 * setting up the second, silently, with no error at any point.
 *
 * Reading before minting is the whole of the fix, and it is why `mintRawKey`
 * no longer stores what it mints.
 *
 * ## The three cases
 *
 * A device is either enrolled or not; the account either holds a key or does
 * not. Four combinations, three behaviours:
 *
 *   fresh device, no key       **found**     mint both, publish. First device.
 *   fresh device, key exists   **adopted**   take the household's data key
 *                                            from the file. The second phone —
 *                                            the case the feature is *for*.
 *   enrolled device, no key    **published** wrap the key it already has.
 *   enrolled device, key exists              same data key → link it.
 *                                            different one → refuse, loudly.
 */

import { googleAuth } from './googleauth.js';
import { DriveEscrow, mintRawKey } from '../security/escrow.js';
import { UNLOCK_SCOPES, APPDATA_SCOPE } from '../core/scopes.js';
import {
  importKeyEncryptionKey, unwrapDataKey, exportKeyBytes, toBase64, timingSafeEqual,
} from '../security/crypto.js';
import { config } from '../core/config.js';
import { AppError } from '../core/errors.js';

/** The keyring entry this writes. Named so Settings can look for exactly it. */
export const GOOGLE_METHOD = 'google';

/**
 * Whether this copy can offer the option at all.
 *
 * Local-only means the unlock key does not go to Google either — offering it
 * would put the one thing that opens the data into the one place a household
 * has said to keep out of. No client id means there is nothing to sign in to.
 */
export function googleUnlockAvailable() {
  return !config().localOnly && Boolean(config().googleClientId);
}

/**
 * Sign in, and hand back the escrow pointed at whatever Google granted.
 *
 * Drive is asked for here and nowhere else: an ordinary sign-in wants to know
 * who you are, and only this needs somewhere to keep a key.
 *
 * @param {{prompt?: string}} [options]
 * @returns {Promise<{auth: object, escrow: DriveEscrow, email: string}>}
 */
export async function connectGoogleUnlock({ prompt = 'select_account consent' } = {}) {
  const auth = googleAuth({ scopes: UNLOCK_SCOPES });
  await auth.signIn({ prompt });
  const profile = await auth.fetchProfile().catch(() => null);

  return {
    auth,
    email: profile?.email ?? '',
    // Where the key goes follows what Google actually granted rather than what
    // was asked for. `drive.appdata` needs adding to a consent screen before
    // Google will grant it, and it grants the rest either way.
    escrow: new DriveEscrow({
      getToken: () => auth.getToken(),
      hidden: auth.granted.includes(APPDATA_SCOPE),
    }),
  };
}

/**
 * Unlock a device that has no data key of its own — first run, or a new phone.
 *
 * `method` names the keyring entry to write. It exists because sign-in by code
 * reaches this device in exactly the same state — nothing enrolled, an escrow
 * holding the key and the wrapping — and the part that matters here is the
 * rollback below, which is worth having in one place rather than copied into a
 * second file that will drift from it. Where the escrow lives is the escrow's
 * business; this function has never known.
 *
 * @returns {Promise<{outcome: 'adopted'|'found'}>} `adopted` means this
 *   household already existed and this device has joined it.
 */
export async function unlockFreshDevice(keyring, escrow, label = '', method = GOOGLE_METHOD) {
  const record = await escrow.read();

  if (record?.wrapped) {
    await keyring.adoptWrapped(method, record.wrapped, label);
    try {
      await keyring.unlockWithRawKey(record.rawKey, method);
    } catch (err) {
      // Adopted, and it does not open. Left in place the device would be
      // permanently unopenable *and* claim to be enrolled, so the adoption is
      // rolled back and the device is fresh again — able to try a different
      // account, or a recovery phrase.
      await keyring.reset();
      throw err;
    }
    return { outcome: 'adopted' };
  }

  if (record) {
    // A key with no wrapping beside it: a file written before the wrapping was
    // stored alongside it. The bytes are real and some other device's keyring
    // is wrapped under them, but nothing here can open that, and minting over
    // the top is exactly the destruction this module exists to stop.
    throw new AppError(
      'That Google account holds an unlock key from an older version, which does not '
      + 'carry enough to open your records on a new device. Unlock a device that is '
      + 'already set up, turn Continue with Google off and on again in Settings → '
      + 'Security, and this device will work.',
      { code: 'escrow-legacy' },
    );
  }

  // Nothing there: the household's first device. Publish only after the local
  // enrolment succeeded — a file naming a data key that was never stored is
  // worse than no file.
  const rawKey = mintRawKey();
  await keyring.enrolRawKey(rawKey, method, label);
  await escrow.put(rawKey, await keyring.wrappedFor(method));
  return { outcome: 'found' };
}

/**
 * Turn Google on for a device that is already unlocked — the Settings path.
 *
 * @returns {Promise<{outcome: 'published'|'linked'}>}
 */
export async function linkExistingDevice(keyring, escrow, label = '') {
  const record = await escrow.read();

  if (record?.wrapped) {
    // The account already holds a key. Either this household's — a device
    // being brought in the long way round — or somebody else's, and the two
    // are worth telling apart before anything is overwritten.
    if (!await opensTheSameData(keyring, record)) {
      throw new AppError(
        'That Google account already holds an unlock key for a different set of '
        + 'FamilyOS records. Overwriting it would lock those records away, so nothing '
        + 'has been changed. Use a different Google account, or turn Continue with '
        + 'Google off on the other household first.',
        { code: 'escrow-conflict' },
      );
    }
    await keyring.addMethod(GOOGLE_METHOD, { rawKey: record.rawKey, label });
    return { outcome: 'linked' };
  }

  // Either nothing there, or a legacy file with no wrapping. Both are safe to
  // publish over from *here*: this device is unlocked, so what it writes is
  // known to open its own records — which is precisely what the legacy file
  // was missing.
  const rawKey = mintRawKey();
  await keyring.addMethod(GOOGLE_METHOD, { rawKey, label });
  await escrow.put(rawKey, await keyring.wrappedFor(GOOGLE_METHOD));
  return { outcome: 'published' };
}

/**
 * Does the escrowed wrapping open onto the same data key this device holds?
 *
 * Asked by exporting both and comparing bytes, because two `CryptoKey` objects
 * for the same key are not equal to each other and there is no other way to
 * ask. A wrapping that will not open at all answers "no", which is right, and
 * stops a corrupt file being mistaken for a match.
 */
async function opensTheSameData(keyring, record) {
  try {
    const kek = await importKeyEncryptionKey(record.rawKey);
    const theirs = await unwrapDataKey(record.wrapped, kek);
    // Base64 rather than the raw arrays: `timingSafeEqual` compares strings,
    // and the encoding is a bijection so it decides the same question.
    return timingSafeEqual(
      toBase64(await exportKeyBytes(theirs)),
      toBase64(await exportKeyBytes(keyring.key)),
    );
  } catch {
    return false;
  }
}

/**
 * Stop using Google on this device, and optionally take the key out of Drive.
 *
 * The two are separate on purpose. Removing the method locally is this
 * device's business; deleting the file is every device's, and a household with
 * a phone that unlocks *only* with Google would be cutting that phone off.
 */
export async function unlinkGoogleUnlock(keyring, escrow, { deleteFromDrive = false } = {}) {
  await keyring.removeMethod(GOOGLE_METHOD);
  if (deleteFromDrive && escrow) await escrow.drop();
}
