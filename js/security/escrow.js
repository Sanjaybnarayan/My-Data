/**
 * "Sign in with Google" as a way in — and what it costs.
 *
 * ## What this does
 *
 * The data key is wrapped separately by a PIN, a fingerprint and a recovery
 * phrase. This adds a fourth wrapping whose key lives in the household's own
 * Google Drive, in `appDataFolder` — a per-application hidden folder that only
 * this application can see, that does not appear in Drive's file list, and
 * that is removed when the household disconnects the app.
 *
 * With it in place, opening FamilyOS on any device is: press Continue with
 * Google, pick the account, and you are in with sync already configured.
 * Nothing to remember, nothing to type, nothing to carry between devices.
 *
 * ## What it costs, which is not small
 *
 * **Whoever can sign in as that Google account can read everything.**
 *
 * That is not a bug in this file, it is what the feature *is*. The PIN was the
 * one thing standing between "somebody has your Google password" and "somebody
 * has your family's medical records and identity documents". Escrowing the key
 * removes it. Anyone who phishes the account, borrows an unlocked laptop with
 * the session live, or is handed the password to fix something, gets the lot.
 *
 * So this is offered as a choice made in the open, next to the alternative,
 * and never turned on quietly. A household that wants the convenience should
 * have it; a household that wants the PIN should not lose it by accident. Both
 * can be true — the two wrappings coexist, and turning this off deletes the
 * escrowed key and leaves every other way in untouched.
 *
 * ## Why the browser and not the backend
 *
 * Apps Script has no access to `appDataFolder`. More usefully: this key is the
 * one piece of material that must never travel through anything other than the
 * device that uses it, and the browser talking straight to Drive is the
 * shortest path there is. The Apps Script backend never sees it.
 *
 * ## The scope
 *
 * `drive.appdata` — the application's own hidden folder and nothing else. It
 * cannot see, list or touch any other file in the household's Drive. It is the
 * narrowest scope Google publishes for this, and it is not the scope the rest
 * of the application uses.
 */

import { randomBytes, toBase64, fromBase64 } from './crypto.js';
import { AppError } from '../core/errors.js';

/** The application's own hidden folder in the user's Drive. */
export const APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/** One file, one household. The name is fixed so any device finds it. */
const NAME = 'familyos.keywrap.json';

/**
 * A key-encryption key kept in the household's own Drive.
 *
 * The 32 bytes here are not the data key. They are a key that *unwraps* the
 * data key, exactly like the one a PIN derives — so the data itself is never
 * anywhere near Drive, and revoking this leaves the ciphertext as unreadable
 * as it was before.
 */
export class DriveEscrow {
  #getToken;
  #fetch;

  /** @param {{getToken: () => Promise<string>, fetchImpl?: typeof fetch}} options */
  constructor({ getToken, fetchImpl } = {}) {
    this.#getToken = getToken;
    this.#fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  }

  get configured() {
    return Boolean(this.#fetch && this.#getToken);
  }

  /**
   * Mint 32 random bytes, store them, and hand them back to be wrapped with.
   *
   * Generated here rather than derived from anything about the account: an
   * account identifier is not a secret, and a key derived from one would be
   * reproducible by anybody who knew the email address.
   */
  async create() {
    const bytes = randomBytes(32);
    await this.put(bytes);
    return bytes;
  }

  /** The stored key, or null when this household has not escrowed one. */
  async read() {
    const id = await this.#find();
    if (!id) return null;

    const response = await this.#call(`${FILES}/${id}?alt=media`);
    const body = await response.json();

    if (!body?.key) {
      throw new AppError('the key stored in Drive is not readable', { code: 'escrow-corrupt' });
    }
    return fromBase64(body.key);
  }

  /** Store or replace the key. */
  async put(bytes) {
    const payload = JSON.stringify({
      key: toBase64(bytes),
      // Written for a person opening the file out of curiosity, since it is
      // their Drive and they are entitled to.
      note: 'FamilyOS unlock key. Deleting this file removes the option to sign in '
        + 'with Google; your PIN and recovery phrase are unaffected.',
      updatedAt: new Date().toISOString(),
    });

    const existing = await this.#find();
    const id = existing ?? await this.#createFile();

    await this.#call(`${UPLOAD}/${id}?uploadType=media`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

    return id;
  }

  /**
   * Remove it.
   *
   * Turning the option off has to actually take the key out of Drive. Leaving
   * it there and merely forgetting about it locally would mean a household
   * that decided against this still had their key sitting in their Google
   * account, which is precisely the thing they decided against.
   */
  async drop() {
    const id = await this.#find();
    if (!id) return false;
    await this.#call(`${FILES}/${id}`, { method: 'DELETE' });
    return true;
  }

  async #find() {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${NAME}' and trashed = false`,
      fields: 'files(id)',
      pageSize: '1',
    });

    const response = await this.#call(`${FILES}?${params}`);
    const body = await response.json();
    return body.files?.[0]?.id ?? null;
  }

  async #createFile() {
    const response = await this.#call(FILES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: NAME, parents: ['appDataFolder'] }),
    });
    const body = await response.json();
    if (!body.id) throw new AppError('Drive did not accept the key file', { code: 'escrow-failed' });
    return body.id;
  }

  async #call(url, options = {}) {
    if (!this.#fetch) throw new AppError('this runtime has no fetch', { code: 'no-fetch' });

    const token = await this.#getToken();
    if (!token) {
      throw new AppError('not signed in to Google', { code: 'signed-out' });
    }

    const response = await this.#fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${token}` },
    });

    if (response.status === 403 || response.status === 401) {
      throw new AppError(
        'Google refused access to the app folder — the permission may have been revoked',
        { code: 'escrow-denied' },
      );
    }
    if (!response.ok) {
      throw new AppError(`Drive refused the request (${response.status})`, { code: 'escrow-failed' });
    }

    return response;
  }
}
