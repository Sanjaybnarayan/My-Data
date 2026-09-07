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
 *     is cleared in the same turn, before anything can navigate — a sentence
 *     nothing checked until `tests/escrow.test.mjs` did. Removing the rewrite,
 *     posting the token to `'*'`, dropping the origin check and dropping the
 *     state check each passed every check in this repository; the four are
 *     held now.
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
  #granted = [];
  #renewTimer = null;
  #inflight = null;

  /**
   * `loginHint` matters once there is more than one of these. A browser signed
   * into several Google accounts has a *default* one, and `prompt=none` picks
   * it — so a second instance would silently renew as the wrong account and
   * have its token refused by the backend it was built for. The hint pins it
   * before any profile has been fetched.
   */
  constructor({ clientId = config().googleClientId, scopes = config().scopes,
    redirectUri = redirectUriFor(), loginHint = '' } = {}) {
    this.clientId = clientId;
    this.scopes = scopes;
    this.redirectUri = redirectUri;
    this.loginHint = loginHint;
  }

  get isSignedIn() {
    return Boolean(this.#token) && Date.now() < this.#expiresAt;
  }

  get profile() {
    return this.#profile;
  }

  /** The scopes Google actually granted, which is not always what was asked. */
  get granted() {
    return [...this.#granted];
  }

  /**
   * What was asked for and not given.
   *
   * Google returns a perfectly good token after somebody unticks a permission
   * on the consent screen, and after a Cloud project that never listed a scope
   * drops it. Both then surface as a refusal from whichever API call needed
   * it — which names the wrong problem, and sends people looking at their
   * Drive rather than at their consent screen.
   *
   * `include_granted_scopes` means the grant can legitimately be *wider* than
   * the request, so only the missing direction is interesting.
   */
  missingScopes() {
    return missingScopes(this.scopes, this.#granted);
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

  /**
   * No `nonce`. It was sent on every request and read back by nothing, which
   * is worse than not sending it: a reviewer seeing it in an authorization
   * URL reads replay protection that is not there.
   *
   * It could not have been checked. A nonce is bound to an **id token**, and
   * `response_type=token` asks for none — so Google ignores it, and there
   * would be nothing here to compare it against if it did not. `state` is the
   * control that actually runs, it is checked in `isOAuthAnswer`, and there
   * are now checks holding it there.
   */
  #authUrl({ prompt, state }) {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'token',
      scope: this.scopes.join(' '),
      include_granted_scopes: 'true',
      state,
    });
    if (prompt) params.set('prompt', prompt);
    const hint = this.#profile?.email || this.loginHint;
    if (hint) params.set('login_hint', hint);
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
    const url = this.#authUrl({ prompt, state });

    this.#inflight = new Promise((resolve, reject) => {
      const popup = globalThis.open(url, 'familyos-auth',
        'width=520,height=640,menubar=no,toolbar=no');
      if (!popup) {
        reject(new AppError('The sign-in window was blocked. Allow pop-ups for this site.',
          { code: 'popup-blocked' }));
        return;
      }

      const onMessage = (event) => {
        // Origin, type and state, all three, and `isOAuthAnswer` says why it
        // is a function rather than three lines here.
        if (!isOAuthAnswer(event, { origin: globalThis.location.origin, state })) return;

        cleanup();

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
          // A closed popup and a refused redirect are indistinguishable from
          // here — Google shows its own error page inside the popup and the
          // person closes it. Reporting only "cancelled" for both sends
          // somebody looking for a mistake they did not make, when the usual
          // cause is a redirect URI the OAuth client does not list. So the
          // message names the one thing they can check, and prints the exact
          // string it has to match.
          reject(new AppError(
            'Sign-in did not complete. If you did not close the window yourself, '
            + 'Google refused the redirect — the OAuth client must list exactly '
            + `this as an authorised redirect URI: ${this.redirectUri}`,
            { code: 'cancelled', redirectUri: this.redirectUri },
          ));
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

    return new Promise((resolve, reject) => {
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.src = this.#authUrl({ prompt: 'none', state });

      const timer = setTimeout(() => {
        cleanup();
        reject(new AppError('Silent renewal timed out.', { code: 'renew-timeout' }));
      }, 15_000);

      const onMessage = (event) => {
        if (!isOAuthAnswer(event, { origin: globalThis.location.origin, state })) return;
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

  #accept({ accessToken, expiresIn, scope }) {
    this.#token = accessToken;
    this.#expiresAt = Date.now() + (Number(expiresIn) || 3600) * 1000;
    this.#granted = String(scope ?? '').split(/\s+/).filter(Boolean);

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

/**
 * What was asked for and not given.
 *
 * A free function because it is the whole of the logic and none of the state,
 * and because a rule this easy to get backwards deserves to be tested without
 * standing up an OAuth flow to do it.
 *
 * @param {string[]} asked
 * @param {string[]} granted as Google returned them
 */
export function missingScopes(asked, granted) {
  // A response that says nothing about scopes claims nothing. Reporting every
  // scope as missing would be worse than reporting none.
  if (!granted?.length) return [];
  // `include_granted_scopes` means the grant is often *wider* than the
  // request — earlier consents come back too — so only one direction matters.
  return (asked ?? []).filter((scope) => !granted.includes(scope));
}

/**
 * Is this `message` event the answer to the flow that is waiting for it?
 *
 * A free function for the reason `missingScopes` is one: it is the whole of
 * the logic and none of the state, and a rule this easy to get backwards
 * deserves to be checked without standing up an OAuth flow to do it.
 *
 * It is one now because it was measured. Reverting any of the three
 * conditions — accepting a message from **any origin**, accepting **any
 * state**, accepting any message type — passed every one of this
 * repository's checks, so the only thing holding the browser sign-in
 * together was that nobody had touched it.
 *
 * Each condition ignores rather than fails, and that is deliberate. A state
 * we did not issue is not our response: a forgery, a stale window, or — once
 * a household has a second mailbox — another instance's silent renewal
 * finishing while this popup is open. Failing this sign-in because some other
 * flow finished would be wrong; if the real answer never comes, the
 * closed-popup poll ends it.
 *
 * @param {{origin?: string, data?: any}} event as `window` delivers it
 * @param {{origin: string, state: string}} expected
 */
export function isOAuthAnswer(event, { origin, state }) {
  return Boolean(event)
    && event.origin === origin
    && event.data?.type === 'familyos-oauth'
    && event.data.state === state;
}

/**
 * Where Google is told to send the answer.
 *
 * Exported because Settings shows it: it has to be registered on the OAuth
 * client character for character, and a person cannot check a string they
 * cannot see. Derived from wherever this copy happens to be served, so a
 * localhost install and a GitHub Pages one give different answers and both
 * are right.
 */
export function redirectUriFor() {
  const { origin, pathname } = globalThis.location ?? { origin: '', pathname: '/' };
  return `${origin}${pathname.replace(/[^/]*$/, '')}oauth-callback.html`;
}

/**
 * Run inside `oauth-callback.html`. Reads the fragment, hands it to the opener
 * and closes. Kept here rather than inline in the HTML so it is covered by the
 * same review as the rest of the auth code.
 *
 * Typed by what it uses rather than as `typeof globalThis`, which a test
 * standing in a window it can inspect could never satisfy — and a control this
 * is the only guard for should not be untestable for a typing reason.
 *
 * @param {{
 *   location: {hash: string, pathname: string, origin: string},
 *   history: {replaceState: (data: any, unused: string, url?: string) => void},
 *   opener?: {postMessage: (message: any, targetOrigin: string) => void} | null,
 *   parent?: {postMessage: (message: any, targetOrigin: string) => void},
 *   close?: () => void,
 * }} [target]
 */
export function completeOAuthRedirect(target = globalThis) {
  const fragment = new URLSearchParams(target.location.hash.slice(1));
  const message = {
    type: 'familyos-oauth',
    state: fragment.get('state'),
    accessToken: fragment.get('access_token'),
    expiresIn: fragment.get('expires_in'),
    // What was actually granted, which is not always what was asked for:
    // Google returns a token happily after somebody unticks a permission on
    // the consent screen, and after a project that never listed a scope
    // quietly drops it. Without this the first sign of either is a refusal
    // from an API call, which names the wrong problem.
    scope: fragment.get('scope'),
    error: fragment.get('error'),
  };

  // Clear the token out of the address bar before anything else can read it
  // from the history entry.
  target.history.replaceState(null, '', target.location.pathname);

  const receiver = target.opener ?? target.parent;
  receiver?.postMessage(message, target.location.origin);
  if (target.opener) target.close();
}
