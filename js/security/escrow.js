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

// Declared in `core/scopes.js` alongside what it is for; re-exported so this
// module stays the one place that knows how the key is stored.
export { APPDATA_SCOPE } from '../core/scopes.js';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * One file, one household. The name is fixed so any device finds it.
 *
 * Two names because there are two places it can live, and a household who
 * finds the visible one in their Drive should be able to tell what it is
 * without opening it.
 */
const HIDDEN_NAME = 'familyos.keywrap.json';
const VISIBLE_NAME = 'FamilyOS unlock key.json';

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
  #hidden;

  /**
   * `hidden` picks where the key lives, and it exists because requiring the
   * hidden folder turned out to be a way of not working.
   *
   * `drive.appdata` has to be added to a household's OAuth consent screen in
   * the Cloud Console before Google will grant it, and Google grants the *rest*
   * of the request regardless — so a household that had not done that got a
   * successful sign-in and then a refusal, for a reason living in a different
   * console from the application.
   *
   * `drive.file` is already granted, for everything else this application does
   * with Drive, and covers a file the application itself created. So the key
   * can go in an ordinary file with no new permission at all. It is visible in
   * the household's Drive rather than hidden in an app folder, which is a
   * difference in tidiness and not in security: `appDataFolder` is not a
   * boundary — anyone who can sign in as that account reads either.
   *
   * Visible is arguably the better default anyway. A household that wants to
   * know where the key to their records is can see it, and delete it.
   *
   * @param {{getToken: () => Promise<string>, fetchImpl?: typeof fetch,
   *          hidden?: boolean}} options
   */
  constructor({ getToken, fetchImpl, hidden = false } = {}) {
    this.#getToken = getToken;
    this.#fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.#hidden = hidden;
  }

  get name() {
    return this.#hidden ? HIDDEN_NAME : VISIBLE_NAME;
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

  /**
   * Look in both places, whichever one this instance writes to.
   *
   * A household that added `drive.appdata` later, or removed it, should not
   * lose the key they already have — so the search covers the hidden folder
   * and the visible file regardless. Under `drive.file` alone the query simply
   * returns nothing for the hidden one, which is the correct answer rather
   * than an error.
   */
  async #find() {
    for (const hidden of [this.#hidden, !this.#hidden]) {
      const params = new URLSearchParams({
        q: `name = '${hidden ? HIDDEN_NAME : VISIBLE_NAME}' and trashed = false`,
        fields: 'files(id)',
        pageSize: '1',
      });
      if (hidden) params.set('spaces', 'appDataFolder');

      try {
        const response = await this.#call(`${FILES}?${params}`);
        const body = await response.json();
        if (body.files?.[0]?.id) return body.files[0].id;
      } catch (err) {
        // Searching the app folder without the scope is a refusal, and it is
        // not an answer about the file this instance actually writes.
        if (hidden !== this.#hidden) continue;
        throw err;
      }
    }
    return null;
  }

  async #createFile() {
    const metadata = { name: this.name };
    // Only `appDataFolder` needs naming. A `drive.file` creation with no
    // parent lands in the household's Drive, where they can see it — which is
    // the point of it not being hidden.
    if (this.#hidden) metadata.parents = ['appDataFolder'];
    else metadata.description = 'Unlocks FamilyOS. Delete this to stop signing in with Google.';

    const response = await this.#call(FILES, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata),
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
