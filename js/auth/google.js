/**
 * Google sign-in.
 *
 * No SDK. The Google Identity Services library is one more script fetched from
 * a third-party origin at boot, and an offline-first application that cannot
 * start without a network request is not offline-first. This is the OAuth 2.0
 * client-side flow implemented directly against the endpoints — about a
 * hundred lines, no runtime dependency, and it fails gracefully when there is
 * no network because sign-in is only needed for *sync*, never for use.
 *
 * ## Why the token flow, and what it costs
 *
 * A browser cannot keep a client secret, so the authorization-code exchange is
 * not available without one. The token flow returns an access token directly
 * in the redirect fragment. Its costs, stated plainly:
 *
 *   - No refresh token. The token lasts an hour and is renewed silently in a
 *     hidden iframe with `prompt=none`; if that fails the user signs in again.
 *   - The token is in the URL fragment on return. It is read and the fragment
 *     is cleared in the same turn, before anything can navigate.
 *
 * The token lives in memory. Not `localStorage` — a token in local storage is
 * readable by any script that ever gets injected, and it survives the tab.
 *
 * ## Scopes
 *
 * `drive.file` only: FamilyOS can see the files it created and nothing else in
 * the user's Drive. Requesting `drive` would be easier and would also mean
 * asking a family to hand over every document they own.
 */

import { config } from '../core/config.js';
import { AppError } from '../core/errors.js';
import { toBase64, randomBytes } from '../security/crypto.js';
import { bus, TOPIC } from '../core/bus.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** Renew this long before expiry rather than after a request has failed. */
const RENEW_MARGIN_MS = 5 * 60_000;

export class GoogleAuth {
  #token = null;
  #expiresAt = 0;
  #profile = null;
  #renewTimer = null;
  #inflight = null;

  constructor({ clientId = config().googleClientId, scopes = config().scopes,
    redirectUri = redirectUriFor() } = {}) {
    this.clientId = clientId;
    this.scopes = scopes;
    this.redirectUri = redirectUri;
  }

  get isSignedIn() {
    return Boolean(this.#token) && Date.now() < this.#expiresAt;
  }

  get profile() {
    return this.#profile;
  }

  /** The sync transport calls this before every request. */
  async getToken() {
    if (this.isSignedIn) return this.#token;
    if (!this.clientId) return null;
    try {
      return await this.renewSilently();
    } catch {
      // No token means sync waits. It never means the app stops working.
      return null;
    }
  }

  #authUrl({ prompt, state, nonce }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'token',
      scope: this.scopes.join(' '),
      include_granted_scopes: 'true',
      state,
      nonce,
    });
    if (prompt) params.set('prompt', prompt);
    if (this.#profile?.email) params.set('login_hint', this.#profile.email);
    return `${AUTH_ENDPOINT}?${params}`;
  }

  /**
   * Interactive sign-in, in a popup. A popup rather than a redirect so the
   * application is not torn down and rebuilt — which on a slow phone means a
   * second cold start, and loses any unsaved form.
   */
  async signIn({ prompt = 'consent' } = {}) {
    if (!this.clientId) {
      throw new AppError('No Google client id is configured. See Settings → Google.',
        { code: 'not-configured' });
    }
    if (this.#inflight) return this.#inflight;

    const state = toBase64(randomBytes(16));
    const nonce = toBase64(randomBytes(16));
    const url = this.#authUrl({ prompt, state, nonce });

    this.#inflight = new Promise((resolve, reject) => {
      const popup = globalThis.open(url, 'familyos-auth',
        'width=520,height=640,menubar=no,toolbar=no');
      if (!popup) {
        reject(new AppError('The sign-in window was blocked. Allow pop-ups for this site.',
          { code: 'popup-blocked' }));
        return;
      }

      const onMessage = (event) => {
        if (event.origin !== globalThis.location.origin) return;
        if (event.data?.type !== 'familyos-oauth') return;
        cleanup();

        if (event.data.state !== state) {
          // A mismatched state is a cross-site request forgery attempt, or a
          // stale window from an earlier attempt. Either way, refuse it.
          reject(new AppError('The sign-in response did not match the request.',
            { code: 'state-mismatch' }));
          return;
        }
        if (event.data.error) {
          reject(new AppError(`Google refused sign-in: ${event.data.error}`, { code: 'denied' }));
          return;
        }
        this.#accept(event.data);
        resolve(this.#profile);
      };

      const poll = setInterval(() => {
        if (popup.closed) {
          cleanup();
          reject(new AppError('Sign-in was cancelled.', { code: 'cancelled' }));
        }
      }, 500);

      const cleanup = () => {
        clearInterval(poll);
        globalThis.removeEventListener('message', onMessage);
        try { popup.close(); } catch { /* already gone */ }
      };

      globalThis.addEventListener('message', onMessage);
    }).finally(() => { this.#inflight = null; });

    return this.#inflight;
  }

  /**
   * Renew without showing anything. Works while the Google session cookie is
   * alive; when it is not, `prompt=none` fails fast and the user is asked.
   */
  renewSilently() {
    if (!this.clientId) return Promise.reject(new AppError('not configured', { code: 'not-configured' }));

    const state = toBase64(randomBytes(16));
    const nonce = toBase64(randomBytes(16));

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = this.#authUrl({ prompt: 'none', state, nonce });

      const timer = setTimeout(() => {
        cleanup();
        reject(new AppError('Silent renewal timed out.', { code: 'renew-timeout' }));
      }, 15_000);

      const onMessage = (event) => {
        if (event.origin !== globalThis.location.origin) return;
        if (event.data?.type !== 'familyos-oauth' || event.data.state !== state) return;
        cleanup();
        if (event.data.error) {
          reject(new AppError(`Silent renewal failed: ${event.data.error}`, { code: 'renew-failed' }));
          return;
        }
        this.#accept(event.data);
        resolve(this.#token);
      };

      const cleanup = () => {
        clearTimeout(timer);
        globalThis.removeEventListener('message', onMessage);
        frame.remove();
      };

      globalThis.addEventListener('message', onMessage);
      document.body.append(frame);
    });
  }

  #accept({ accessToken, expiresIn }) {
    this.#token = accessToken;
    this.#expiresAt = Date.now() + (Number(expiresIn) || 3600) * 1000;

    clearTimeout(this.#renewTimer);
    const delay = Math.max(30_000, this.#expiresAt - Date.now() - RENEW_MARGIN_MS);
    this.#renewTimer = setTimeout(() => {
      this.renewSilently().catch(() => bus.emit(TOPIC.authState, { signedIn: false, reason: 'expired' }));
    }, delay);
    this.#renewTimer.unref?.();

    // Fire and forget: the profile is a nicety, and failing to fetch it must
    // not fail a sign-in that already succeeded.
    this.fetchProfile().catch(() => {});
    bus.emit(TOPIC.authState, { signedIn: true });
  }

  async fetchProfile() {
    if (!this.#token) return null;
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${this.#token}` },
    });
    if (!response.ok) return null;
    this.#profile = await response.json();
    bus.emit(TOPIC.authState, { signedIn: true, profile: this.#profile });
    return this.#profile;
  }

  async signOut() {
    const token = this.#token;
    this.#token = null;
    this.#expiresAt = 0;
    this.#profile = null;
    clearTimeout(this.#renewTimer);

    if (token) {
      // Best effort: a revoke that fails still leaves us signed out locally,
      // and the token expires within the hour regardless.
      try {
        await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' });
      } catch { /* offline */ }
    }
    bus.emit(TOPIC.authState, { signedIn: false });
  }
}

function redirectUriFor() {
  const { origin, pathname } = globalThis.location ?? { origin: '', pathname: '/' };
  return `${origin}${pathname.replace(/[^/]*$/, '')}oauth-callback.html`;
}

/**
 * Run inside `oauth-callback.html`. Reads the fragment, hands it to the opener
 * and closes. Kept here rather than inline in the HTML so it is covered by the
 * same review as the rest of the auth code.
 */
export function completeOAuthRedirect(target = globalThis) {
  const fragment = new URLSearchParams(target.location.hash.slice(1));
  const message = {
    type: 'familyos-oauth',
    state: fragment.get('state'),
    accessToken: fragment.get('access_token'),
    expiresIn: fragment.get('expires_in'),
    error: fragment.get('error'),
  };

  // Clear the token out of the address bar before anything else can read it
  // from the history entry.
  target.history.replaceState(null, '', target.location.pathname);

  const receiver = target.opener ?? target.parent;
  receiver?.postMessage(message, target.location.origin);
  if (target.opener) target.close();
}
