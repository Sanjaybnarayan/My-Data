/**
 * The authorization-code flow with PKCE, which is the only one Google will
 * accept from an application that is not a web page.
 *
 * ## Why the existing flow cannot be made to work
 *
 * `auth/google.js` uses the implicit flow: `response_type=token`, a popup, and
 * a hidden iframe with `prompt=none` to renew. Every one of those three is
 * unavailable to a native shell, and not by accident.
 *
 *  - **The redirect URI.** A WebView's origin is `https://localhost` on Android
 *    and `capacitor://localhost` on iOS. Google accepts neither for a Web
 *    client, and there is no form of the Web client that it would accept —
 *    `localhost` over https is not registerable, and the loopback exception is
 *    `http://127.0.0.1:PORT` for desktop clients only.
 *  - **The popup.** `window.open` in a WebView does not produce a window that
 *    can `postMessage` its opener.
 *  - **The embedded browser itself.** Google *refuses* authorization requests
 *    made from an embedded WebView and answers `disallowed_useragent`. This is
 *    policy rather than a technical limit, and it is the reason the fix is not
 *    "find a redirect URI that works": the sign-in page has to be opened in the
 *    system browser, and the answer has to come back to the app some other way.
 *
 * ## What replaces it
 *
 * An **installed-app client** (Android or iOS type in the Cloud Console), which
 * has no client secret — a native binary cannot keep one, so Google does not
 * issue one. In place of the secret, **PKCE**: the app invents a random
 * `code_verifier`, sends only its SHA-256 hash up front, and presents the
 * original when redeeming the code. An attacker who intercepts the redirect
 * gets a code they cannot spend.
 *
 * The redirect is a **custom scheme** derived from the client id — the "reversed
 * client id" — which the operating system routes back to the application.
 *
 * ## What is deliberately not here
 *
 * Nothing in this file touches the network, the DOM, or a plugin. It builds
 * strings and reads strings, so the security-critical part of the flow can be
 * tested without a browser and without a Google account. The plumbing lives in
 * `auth/googlenative.js`.
 */

import { randomBytes } from '../security/crypto.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

/** Google's own minimum; longer costs nothing and RFC 7636 allows to 128. */
const VERIFIER_BYTES = 64;

export const WHY = Object.freeze({
  STATE_MISMATCH: 'that response was not for this sign-in',
  NO_CODE: 'Google returned no authorization code',
  DENIED: 'sign-in was refused',
  NOT_A_REDIRECT: 'that is not the redirect this sign-in was waiting for',
});

/**
 * base64url, which is not base64.
 *
 * `+`, `/` and `=` are all meaningful in a URL, and a verifier that survives one
 * encoding and not another produces `invalid_grant` at the token endpoint with
 * nothing to say why. RFC 7636 specifies this alphabet exactly.
 */
export function base64url(bytes) {
  let binary = '';
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The secret half of PKCE. Never leaves the device until the code is redeemed. */
export function createVerifier(bytes = VERIFIER_BYTES) {
  return base64url(randomBytes(bytes));
}

/**
 * The half that goes up front: `S256`, never `plain`.
 *
 * `plain` sends the verifier itself in the authorization request, which makes
 * PKCE decorative — anyone who could intercept the redirect could also have
 * read the request. Google supports both and this offers only one.
 */
export async function challengeFor(verifier, subtle = globalThis.crypto?.subtle) {
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * The scheme the operating system routes back to this application.
 *
 * Google issues installed-app client ids of the form `123-abc.apps.
 * googleusercontent.com`, and the redirect scheme is that reversed:
 * `com.googleusercontent.apps.123-abc`. It is derived rather than configured
 * because the two must agree exactly, and a household copying a client id into
 * Settings cannot be asked to derive a scheme by hand.
 */
export function schemeFor(clientId) {
  const bare = String(clientId).replace(/\.apps\.googleusercontent\.com$/, '');
  return bare ? `com.googleusercontent.apps.${bare}` : '';
}

/** Where Google sends the answer. One path, so the app can recognise it. */
export function redirectUriFor(clientId, path = '/oauth2redirect') {
  const scheme = schemeFor(clientId);
  return scheme ? `${scheme}:${path}` : '';
}

/**
 * The URL to open in the system browser.
 *
 * `response_type=code`, because a native client cannot use the implicit flow —
 * and should not want to: a token in a redirect is a token in the operating
 * system's URL handling, visible to whatever else claimed the scheme.
 */
/** @param {{clientId: string, scopes: readonly string[], state: string,
 *           challenge: string, loginHint?: string, prompt?: string}} options */
export function authUrl({ clientId, scopes, state, challenge, loginHint = '', prompt = 'consent' }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUriFor(clientId),
    response_type: 'code',
    scope: [...scopes].join(' '),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    include_granted_scopes: 'true',
    // Without this Google issues an access token and no refresh token, and the
    // flow would work exactly once per hour and then send somebody back through
    // a browser tab. The web flow renews in a hidden iframe instead; a WebView
    // has no such thing, so this is what replaces it.
    access_type: 'offline',
    state,
  });
  if (prompt) params.set('prompt', prompt);
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_ENDPOINT}?${params}`;
}

/**
 * Read the deep link the operating system handed back.
 *
 * The state is compared before anything else is believed. Another application
 * can register the same scheme — the OS does not stop it — so a redirect
 * arriving with a state this app never issued is somebody else's answer, or
 * somebody else's attempt, and either way it is not a sign-in.
 *
 * @returns {{ok: boolean, why?: string, code?: string}}
 */
export function parseRedirect(url, expectedState) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, why: WHY.NOT_A_REDIRECT };
  }

  // Google puts the answer in the query string for a code flow. A custom-scheme
  // URL has no ordinary origin, so the search string is read off the whole.
  const params = new URLSearchParams(parsed.search || String(url).split('?')[1] || '');

  if (params.get('state') !== expectedState) return { ok: false, why: WHY.STATE_MISMATCH };
  if (params.get('error')) return { ok: false, why: `${WHY.DENIED}: ${params.get('error')}` };

  const code = params.get('code');
  if (!code) return { ok: false, why: WHY.NO_CODE };
  return { ok: true, code };
}

/**
 * The body that redeems the code.
 *
 * No `client_secret`. An installed-app client is not issued one, because a
 * binary on somebody's phone cannot keep a secret, and sending an empty or
 * invented one is how this fails with `invalid_client` and no explanation.
 */
export function tokenRequest({ clientId, code, verifier }) {
  return {
    url: TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      code,
      code_verifier: verifier,
      grant_type: 'authorization_code',
      redirect_uri: redirectUriFor(clientId),
    }).toString(),
  };
}

/** Renewal, which is a refresh token rather than a hidden iframe. */
export function refreshRequest({ clientId, refreshToken }) {
  return {
    url: TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  };
}
