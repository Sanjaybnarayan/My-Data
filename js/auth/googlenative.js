/**
 * Google sign-in inside the Android and iOS shells.
 *
 * `auth/google.js` stays exactly as it is and keeps serving every browser. This
 * is the same three operations — sign in, get a token, sign out — over the only
 * flow Google will accept from an application that is not a web page.
 *
 * ## The shape, and why each piece is forced
 *
 *   1. The authorization page opens in a **Custom Tab / SFSafariViewController**,
 *      not in this WebView. Google refuses an embedded WebView outright with
 *      `disallowed_useragent`; this is policy, not a technical limit, and it is
 *      why "find a redirect URI that works" was never the fix.
 *   2. The answer comes back as a **deep link** on the reversed-client-id
 *      scheme, which the operating system routes to this application.
 *   3. The code is redeemed with the **verifier**, over `fetch`, with no client
 *      secret — an installed-app client is not issued one.
 *
 * ## The refresh token, and where it lives
 *
 * The web flow renews in a hidden iframe with `prompt=none`, which a WebView
 * cannot do. So this asks for offline access and gets a refresh token, which is
 * a longer-lived secret than anything the web flow ever held.
 *
 * It is stored **encrypted with the household's data key**, through the same
 * field encryption every account number and password goes through, and it is
 * therefore readable only while the app is unlocked. That is a deliberate
 * trade: without it a household re-authorises through a browser tab every hour,
 * and an application people abandon is not more secure than one they use.
 *
 * ## What this cannot do for you
 *
 * Register the client. An installed-app OAuth client is tied to the package name
 * and, on Android, to the SHA-1 fingerprint of the signing certificate — which
 * differs between the debug build and a release. Nothing in a repository can
 * create that; `docs/NATIVE_SIGN_IN.md` says exactly which screens to visit.
 */

import { config } from '../core/config.js';
import { AppError } from '../core/errors.js';
import { t } from '../core/locale.js';
import { randomBytes, encryptText, decryptText, isEncrypted } from '../security/crypto.js';
import { bus, TOPIC } from '../core/bus.js';
import { plugin, isNative } from '../core/native.js';
import {
  createVerifier, challengeFor, authUrl, parseRedirect, base64url,
  tokenRequest, refreshRequest, redirectUriFor, schemeFor,
} from './pkce.js';

const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
const RENEW_MARGIN_MS = 5 * 60_000;

/** Where the refresh token lives. */
export const REFRESH_KEY = 'auth.googleRefreshToken';

/**
 * Binds the ciphertext to this one key. A sealed value lifted out of `meta`
 * and pasted under a different key fails its authentication tag rather than
 * decrypting — the same argument `fieldcrypto.js` makes per cell.
 */
const REFRESH_AAD = `familyos:meta:${REFRESH_KEY}`;

/**
 * Whether a native sign-in is possible at all, and if not, why.
 *
 * The parameter is typed because `config()` freezes its defaults, so an
 * unannotated `clientId = config().googleNativeClientId` infers the literal
 * type `""` and refuses every real client id.
 *
 * @param {{clientId?: string}} [options]
 * @returns {{ready: boolean, why?: string, redirectUri?: string, scheme?: string}}
 */
export function nativeSignInReady({ clientId = config().googleNativeClientId } = {}) {
  if (!isNative()) return { ready: false, why: 'not running in a native shell' };
  if (!clientId) {
    return {
      ready: false,
      why: 'no Android or iOS OAuth client id is configured — the Web client id '
        + 'this app uses in a browser will not work here, and Google will refuse it',
    };
  }
  if (!plugin('Browser')) {
    return { ready: false, why: 'this build has no Browser plugin, so the sign-in page cannot be opened' };
  }
  if (!plugin('App')) {
    return { ready: false, why: 'this build has no App plugin, so the answer could not come back' };
  }
  return { ready: true, redirectUri: redirectUriFor(clientId), scheme: schemeFor(clientId) };
}

export class NativeGoogleAuth {
  #token = null;
  #expiresAt = 0;
  #profile = null;
  #granted = [];
  #renewTimer = null;

  /**
   * @param {{clientId?: string, scopes?: readonly string[], loginHint?: string,
   *          store?: object,
   *          fetchImpl?: (url: string, init?: object) => Promise<any>}} options
   *   The fetch contract is written out rather than borrowed from `typeof fetch`
   *   because this only ever needs `ok`, `status` and `json()` — and a test
   *   double that satisfies the real signature has to invent a whole Response.
   *   `store` is anything with
   *   `meta(key)` and `setMeta(key, value)` — the database, in the application,
   *   and a plain object in a test.
   */
  constructor({
    clientId = config().googleNativeClientId,
    scopes = config().scopes,
    loginHint = '',
    store = null,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.clientId = clientId;
    this.scopes = [...scopes];
    this.loginHint = loginHint;
    this.store = store;
    this.fetch = fetchImpl;
  }

  get isSignedIn() {
    return Boolean(this.#token) && Date.now() < this.#expiresAt;
  }

  get profile() { return this.#profile; }

  get granted() { return [...this.#granted]; }

  /**
   * A token for the sync transport, renewed from the refresh token when the one
   * in memory has expired. Returns `null` rather than throwing: no token means
   * sync waits, and it never means the application stops working.
   */
  async getToken() {
    if (this.isSignedIn) return this.#token;
    try {
      return await this.renewSilently();
    } catch {
      return null;
    }
  }

  /**
   * Sign in, through the system browser.
   *
   * The listener is attached *before* the tab opens. A fast answer — an account
   * already chosen, consent already given — can come back before an await
   * scheduled afterwards would have run, and a sign-in that works slowly and
   * hangs quickly is worse than one that never works.
   */
  async signIn({ prompt = 'consent' } = {}) {
    const ready = nativeSignInReady({ clientId: this.clientId });
    if (!ready.ready) throw new AppError(ready.why ?? 'sign-in is unavailable', { code: 'not-configured' });

    const Browser = plugin('Browser');
    const App = plugin('App');

    // base64url rather than base64. The state travels back through a
    // custom-scheme URL parsed by the operating system and then by `new URL`,
    // and `+`, `/` and `=` all mean something to one of those. A state that
    // survives the trip differently from the one that left compares unequal and
    // the sign-in silently never completes.
    const state = base64url(randomBytes(16));
    const verifier = createVerifier();
    const challenge = await challengeFor(verifier);

    const redirect = new Promise((resolve, reject) => {
      let handle = null;
      const done = (fn, value) => {
        handle?.remove?.();
        Browser.close().catch(() => {});
        fn(value);
      };

      App.addListener('appUrlOpen', ({ url }) => {
        const seen = parseRedirect(url, state);
        // A deep link this app did not ask for is not this sign-in. Ignored
        // rather than failed, because another link arriving mid-flow — a shared
        // document, a notification — must not cancel it.
        if (!seen.ok && seen.why?.includes('not for this sign-in')) return;
        if (!seen.ok) done(reject, new AppError(seen.why, { code: 'denied' }));
        else done(resolve, seen.code);
      }).then((h) => { handle = h; }).catch(() => {});
    });

    await Browser.open({
      url: authUrl({
        clientId: this.clientId,
        scopes: this.scopes,
        state,
        challenge,
        loginHint: this.#profile?.email || this.loginHint,
        prompt,
      }),
      presentationStyle: 'popover',
    });

    const code = await redirect;
    await this.#redeem(code, verifier);
    return this.#profile;
  }

  async #redeem(code, verifier) {
    const request = tokenRequest({ clientId: this.clientId, code, verifier });
    const response = await this.fetch(request.url, {
      method: request.method, headers: request.headers, body: request.body,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // Google's own words, because "sign-in failed" sends somebody to look at
      // their network when the answer is redirect_uri_mismatch.
      throw new AppError(
        `Google refused the sign-in: ${body.error_description ?? body.error ?? response.status}`,
        { code: 'denied' },
      );
    }
    await this.#accept(body);
  }

  /**
   * Store the refresh token sealed under the household data key.
   *
   * ## Why this exists
   *
   * The line naming `REFRESH_KEY` used to read *"Encrypted; see
   * `data/schema.js` meta rules"*. There are no such rules: `meta` is
   * `{ keyPath: 'key', indexes: [] }` and `setMeta` writes straight to the
   * adapter. So a Google **refresh token** — long-lived authority over the
   * household's Drive, Sheets and Gmail — sat in plaintext in IndexedDB
   * behind a comment saying it did not. A security claim with nothing
   * checking it is the fault this repository has found most often, and this
   * was the most expensive instance of it.
   *
   * ## Refusing rather than falling back
   *
   * With no keyring, or a locked one, this **does not store the token**. The
   * tempting fallback — write it in the clear and carry on — would make the
   * seal optional, and an optional seal is the plaintext it replaced with an
   * extra branch. A device that cannot seal it simply has to sign in again,
   * which is an inconvenience rather than a leak.
   */
  async #keepRefresh(value) {
    const key = this.store?.keyring?.key;
    if (!key) return false;
    await this.store.setMeta(REFRESH_KEY, await encryptText(key, String(value), REFRESH_AAD));
    return true;
  }

  /**
   * Read it back, and upgrade a token written before it was sealed.
   *
   * A plaintext value here is a real refresh token from an older version. It
   * is used and immediately re-sealed rather than discarded — throwing it away
   * would sign the household out of Google on upgrade, which is a worse thing
   * to do to somebody than the exposure it is fixing.
   */
  async #readRefresh() {
    const stored = await this.store?.meta(REFRESH_KEY);
    if (!stored) return '';

    if (!isEncrypted(stored)) {
      // Written before this was sealed. Take it, then put it back properly.
      await this.#keepRefresh(stored);
      return String(stored);
    }

    const key = this.store?.keyring?.key;
    if (!key) throw new AppError(t('auth.google.locked'), { code: 'locked' });

    try {
      return await decryptText(key, stored, REFRESH_AAD);
    } catch {
      // A different data key, or a tampered value. Either way it is not this
      // household's token and pretending otherwise fails further in.
      throw new AppError(t('auth.google.unreadable'), { code: 'renew-failed' });
    }
  }

  /** Renew from the stored refresh token. Throws when there is nothing to use. */
  async renewSilently() {
    const refreshToken = await this.#readRefresh();
    if (!refreshToken) throw new AppError('nothing to renew with', { code: 'not-configured' });

    const request = refreshRequest({ clientId: this.clientId, refreshToken });
    const response = await this.fetch(request.url, {
      method: request.method, headers: request.headers, body: request.body,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // A refresh token can be revoked from the Google account page, and then
      // it is not coming back. Clearing it means the next sign-in asks properly
      // rather than failing the same way for ever.
      await this.store?.setMeta(REFRESH_KEY, '');
      throw new AppError('the saved Google authorisation is no longer valid',
        { code: 'renew-failed' });
    }
    await this.#accept(body);
    return this.#token;
  }

  async #accept({ access_token: accessToken, expires_in: expiresIn, scope, refresh_token: refresh }) {
    this.#token = accessToken;
    this.#expiresAt = Date.now() + (Number(expiresIn) || 3600) * 1000;
    this.#granted = String(scope ?? '').split(/\s+/).filter(Boolean);

    // Google returns a refresh token on the first consent and not on renewals,
    // so an absent one means "keep the one you have" rather than "you have none".
    if (refresh) await this.#keepRefresh(refresh);

    clearTimeout(this.#renewTimer);
    const delay = Math.max(30_000, this.#expiresAt - Date.now() - RENEW_MARGIN_MS);
    this.#renewTimer = setTimeout(() => {
      this.renewSilently().catch(() => bus.emit(TOPIC.authState, { signedIn: false, reason: 'expired' }));
    }, delay);
    this.#renewTimer.unref?.();

    this.fetchProfile().catch(() => {});
    bus.emit(TOPIC.authState, { signedIn: true });
  }

  async fetchProfile() {
    if (!this.#token) return null;
    const response = await this.fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!response.ok) return null;
    this.#profile = await response.json();
    return this.#profile;
  }

  /**
   * Sign out, and mean it.
   *
   * Dropping the token in memory would leave a refresh token on the device that
   * still works — a sign-out that signs nothing out. The grant is revoked at
   * Google and the stored token is cleared whether or not that call succeeds,
   * because an unreachable network is not a reason to keep a credential the
   * household has asked to be rid of.
   */
  async signOut() {
    // Signing out must work on a locked device — it is the one thing somebody
    // handing a phone over needs to succeed. An unreadable token falls back to
    // the access token, which is what `||` did before this was sealed.
    const refreshToken = await this.#readRefresh().catch(() => '');
    const token = refreshToken || this.#token;

    this.#token = null;
    this.#expiresAt = 0;
    this.#profile = null;
    this.#granted = [];
    clearTimeout(this.#renewTimer);
    await this.store?.setMeta(REFRESH_KEY, '');

    if (token) {
      await this.fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' })
        .catch(() => {});
    }
    bus.emit(TOPIC.authState, { signedIn: false });
  }
}
