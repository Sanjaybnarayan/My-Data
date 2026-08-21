import { test, describe, assert, setSuite } from './harness.mjs';
import {
  base64url, createVerifier, challengeFor, schemeFor, redirectUriFor,
  authUrl, parseRedirect, tokenRequest, refreshRequest, WHY,
} from '../js/auth/pkce.js';
import { NativeGoogleAuth, nativeSignInReady, REFRESH_KEY } from '../js/auth/googlenative.js';
import { googleAuth } from '../js/auth/googleauth.js';
import { forgetPlugins } from '../js/core/native.js';

setSuite('google sign-in on a device');

const CLIENT = '123456789-abcdefg.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.file', 'openid'];

describe('the redirect Google will accept', () => {
  test('is the reversed client id, derived rather than configured', () => {
    // The two have to agree exactly. A household pasting a client id into
    // Settings cannot be asked to reverse it by hand, and a mismatch is
    // redirect_uri_mismatch with nothing saying which half is wrong.
    assert.equal(schemeFor(CLIENT), 'com.googleusercontent.apps.123456789-abcdefg');
    assert.equal(redirectUriFor(CLIENT),
      'com.googleusercontent.apps.123456789-abcdefg:/oauth2redirect');
  });

  test('and is empty when there is no client id, rather than a scheme of nothing', () => {
    // `com.googleusercontent.apps.:/oauth2redirect` is a URI the OS would
    // happily register and Google would always refuse.
    assert.equal(schemeFor(''), '');
    assert.equal(redirectUriFor(''), '');
  });

  test('is not the WebView origin, which is what does not work', () => {
    // The whole reason this file exists. Neither of these is registerable.
    const uri = redirectUriFor(CLIENT);
    assert.not(uri.includes('localhost'), uri);
    assert.not(uri.startsWith('https://'), uri);
    assert.not(uri.startsWith('capacitor://'), uri);
  });
});

describe('PKCE', () => {
  test('encodes for a URL, not for an email', () => {
    // `+`, `/` and `=` are all meaningful in a URL. A verifier that survives one
    // encoding and not another produces invalid_grant with nothing to say why.
    const encoded = base64url(new Uint8Array([251, 255, 254, 0, 1, 2]));
    assert.not(/[+/=]/.test(encoded), encoded);
  });

  test('a verifier is long and different every time', () => {
    const a = createVerifier();
    const b = createVerifier();
    assert.not(a === b, 'two verifiers were identical');
    // RFC 7636 requires 43–128 characters.
    assert.ok(a.length >= 43 && a.length <= 128, `${a.length} characters`);
  });

  test('the challenge is the hash, never the verifier itself', async () => {
    // `plain` makes PKCE decorative: anybody who could intercept the redirect
    // could also have read the request that carried the verifier.
    const verifier = createVerifier();
    const challenge = await challengeFor(verifier);

    assert.not(challenge === verifier, 'the challenge was the verifier');
    assert.equal(challenge, await challengeFor(verifier), 'the hash is not stable');
    assert.not(/[+/=]/.test(challenge), challenge);
  });

  test('and the authorization request says S256 and sends only the hash', async () => {
    const verifier = createVerifier();
    const challenge = await challengeFor(verifier);
    const url = authUrl({ clientId: CLIENT, scopes: SCOPES, state: 'st', challenge });
    const params = new URL(url).searchParams;

    assert.equal(params.get('code_challenge_method'), 'S256');
    assert.equal(params.get('code_challenge'), challenge);
    assert.not(url.includes(verifier), 'the verifier was sent in the authorization request');
  });
});

describe('the authorization request', () => {
  test('asks for a code, because a native client cannot use the implicit flow', async () => {
    const url = authUrl({
      clientId: CLIENT, scopes: SCOPES, state: 'st', challenge: await challengeFor('v'),
    });
    assert.equal(new URL(url).searchParams.get('response_type'), 'code');
  });

  test('asks for offline access, or it could never renew', async () => {
    // Without access_type=offline Google returns an access token and no refresh
    // token. The flow would then work for one hour and send the household back
    // through a browser tab — and the web flow's answer, a hidden iframe with
    // prompt=none, is exactly what a WebView cannot do.
    const url = authUrl({
      clientId: CLIENT, scopes: SCOPES, state: 'st', challenge: await challengeFor('v'),
    });
    assert.equal(new URL(url).searchParams.get('access_type'), 'offline');
  });

  test('carries the scopes and the redirect it will be answered at', async () => {
    const url = authUrl({
      clientId: CLIENT, scopes: SCOPES, state: 'st', challenge: await challengeFor('v'),
    });
    const params = new URL(url).searchParams;

    assert.equal(params.get('scope'), SCOPES.join(' '));
    assert.equal(params.get('redirect_uri'), redirectUriFor(CLIENT));
    assert.equal(params.get('client_id'), CLIENT);
  });
});

describe('reading the answer back', () => {
  test('accepts the code Google sent', () => {
    const out = parseRedirect(`${redirectUriFor(CLIENT)}?code=4/abc&state=st`, 'st');
    assert.ok(out.ok, out.why);
    assert.equal(out.code, '4/abc');
  });

  test('refuses a state it never issued', () => {
    // Another application can register the same scheme — the operating system
    // does not stop it. A redirect carrying a state this app did not invent is
    // somebody else's answer or somebody else's attempt.
    const out = parseRedirect(`${redirectUriFor(CLIENT)}?code=4/abc&state=somebody-else`, 'st');
    assert.not(out.ok);
    assert.equal(out.why, WHY.STATE_MISMATCH);
  });

  test('reports a refusal as a refusal rather than a missing code', () => {
    const out = parseRedirect(`${redirectUriFor(CLIENT)}?error=access_denied&state=st`, 'st');
    assert.not(out.ok);
    assert.ok(out.why.startsWith(WHY.DENIED), out.why);
  });

  test('and a redirect with neither', () => {
    const out = parseRedirect(`${redirectUriFor(CLIENT)}?state=st`, 'st');
    assert.not(out.ok);
    assert.equal(out.why, WHY.NO_CODE);
  });

  test('and something that is not a URL at all', () => {
    const out = parseRedirect('not a url', 'st');
    assert.not(out.ok);
  });
});

describe('redeeming the code', () => {
  test('sends the verifier and no client secret', () => {
    // An installed-app client is not issued one, because a binary on somebody's
    // phone cannot keep a secret. Sending an empty or invented one is how this
    // fails with invalid_client and no explanation.
    const request = tokenRequest({ clientId: CLIENT, code: '4/abc', verifier: 'v-e-r' });
    const body = new URLSearchParams(request.body);

    assert.equal(request.method, 'POST');
    assert.equal(body.get('code_verifier'), 'v-e-r');
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_secret'), null, 'a client secret was sent');
    assert.equal(body.get('redirect_uri'), redirectUriFor(CLIENT));
  });

  test('renewal uses the refresh token, not a hidden iframe', () => {
    // The web flow renews with prompt=none in an invisible iframe. A WebView has
    // no such thing, and Google would refuse it there anyway.
    const request = refreshRequest({ clientId: CLIENT, refreshToken: 'r-t' });
    const body = new URLSearchParams(request.body);

    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), 'r-t');
    assert.equal(body.get('client_secret'), null);
  });
});

/* ------------------------------------------------- the flow around the core */

setSuite('google sign-in on a device · the flow');


/**
 * Every wait in this file is bounded.
 *
 * A sign-in that never settles is a real failure mode — the deep link never
 * arrives, the listener was attached too late, the promise is orphaned — and
 * an unbounded `await` turns it into a suite that hangs rather than one that
 * fails. Mutation testing found this the hard way: removing the refresh-token
 * write made the whole run stop with "unsettled top-level await" and no
 * indication of which check had noticed, which is indistinguishable from
 * proving nothing.
 */
/**
 * Wait for something to happen, with a deadline.
 *
 * The timers here are deliberately **not** unref'd. Unref'ing the polling timer
 * is what made this file hang: with nothing else keeping the event loop alive
 * the timer never fired, the await never resumed, and node reported "unsettled
 * top-level await" with no indication of which check was stuck. A test that
 * hangs proves less than a test that fails.
 */
async function until(get, label, ms = 2000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = get();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`${label} never happened`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** The same deadline, around a promise that may never settle. */
function within(promise, label, ms = 2000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} never settled`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** A shell with the two plugins the flow needs, recording what it was asked. */
function shell({ built = ['Browser', 'App'] } = {}) {
  const calls = [];
  let deepLink = null;

  const proxy = (name) => new Proxy({}, {
    get(_t, method) {
      if (typeof method !== 'string' || method === 'then') return undefined;
      return (...args) => {
        calls.push({ plugin: name, method, args });
        if (name === 'App' && method === 'addListener') {
          // The OS answering. Held so a test can decide what comes back.
          deepLink = args[1];
          return Promise.resolve({ remove() {} });
        }
        return Promise.resolve();
      };
    },
  });

  const before = globalThis.Capacitor;
  globalThis.Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
    isPluginAvailable: (n) => built.includes(n),
    registerPlugin: (n) => proxy(n),
  };
  forgetPlugins();

  return {
    calls,
    answer: (url) => deepLink?.({ url }),
    opened: () => calls.find((c) => c.plugin === 'Browser' && c.method === 'open')?.args[0]?.url,
    restore() {
      if (before) globalThis.Capacitor = before;
      else delete globalThis.Capacitor;
      forgetPlugins();
    },
  };
}

/** A Google that hands back whatever the test says, and records the request. */
function google(responses) {
  const seen = [];
  return {
    seen,
    fetch: async (url, init = {}) => {
      seen.push({ url, body: init.body ?? '' });
      const next = responses.shift() ?? { ok: true, body: {} };
      return { ok: next.ok, status: next.status ?? (next.ok ? 200 : 400), json: async () => next.body };
    },
  };
}

const memory = () => {
  const kv = new Map();
  return { meta: async (k) => kv.get(k) ?? null, setMeta: async (k, v) => kv.set(k, v) };
};

describe('before anything opens', () => {
  test('a shell with no native client id says which id is missing', () => {
    const s = shell();
    try {
      const ready = nativeSignInReady({ clientId: '' });
      assert.not(ready.ready);
      assert.ok(/Web client id/.test(ready.why), ready.why);
    } finally { s.restore(); }
  });

  test('and a browser is simply not a native sign-in', () => {
    const ready = nativeSignInReady({ clientId: CLIENT });
    assert.not(ready.ready, 'a browser claimed it could do the native flow');
  });

  test('a shell without the Browser plugin refuses rather than using the WebView', () => {
    // Google answers disallowed_useragent to an embedded WebView. Falling back
    // to it would be a sign-in that always fails, in a way nobody could read.
    const s = shell({ built: ['App'] });
    try {
      const ready = nativeSignInReady({ clientId: CLIENT });
      assert.not(ready.ready);
      assert.ok(/Browser plugin/.test(ready.why), ready.why);
    } finally { s.restore(); }
  });
});

describe('signing in', () => {
  test('opens the system browser, not the WebView, and redeems the code', async () => {
    const s = shell();
    const g = google([{ ok: true, body: { access_token: 'at', expires_in: 3600, refresh_token: 'rt', scope: SCOPES.join(' ') } }]);
    const store = memory();

    try {
      const auth = new NativeGoogleAuth({ clientId: CLIENT, scopes: SCOPES, store, fetchImpl: g.fetch });
      const signingIn = auth.signIn();

      // Waited for, not sampled. `signIn` hashes the verifier before it opens
      // anything, and one macrotask tick does not reliably cover a real
      // SubtleCrypto digest — which is how this first failed.
      const url = await until(() => s.opened(), 'the system browser opening');
      assert.ok(url.startsWith('https://accounts.google.com/'), url);

      const state = new URL(url).searchParams.get('state');
      s.answer(`${redirectUriFor(CLIENT)}?code=4/xyz&state=${encodeURIComponent(state)}`);
      await within(signingIn, 'the sign-in');

      assert.equal(await auth.getToken(), 'at');
      const body = new URLSearchParams(g.seen[0].body);
      assert.equal(body.get('code'), '4/xyz');
      assert.ok(body.get('code_verifier'), 'the verifier was not presented');
    } finally { s.restore(); }
  });

  test('keeps the refresh token so a reload does not ask again', async () => {
    const s = shell();
    const g = google([{ ok: true, body: { access_token: 'at', expires_in: 3600, refresh_token: 'rt' } }]);
    const store = memory();

    try {
      const auth = new NativeGoogleAuth({ clientId: CLIENT, scopes: SCOPES, store, fetchImpl: g.fetch });
      const signingIn = auth.signIn();
      const state = new URL(await until(() => s.opened(), 'the browser opening')).searchParams.get('state');
      s.answer(`${redirectUriFor(CLIENT)}?code=4/xyz&state=${encodeURIComponent(state)}`);
      await within(signingIn, 'the sign-in');

      assert.equal(await store.meta(REFRESH_KEY), 'rt');
    } finally { s.restore(); }
  });

  test('ignores a deep link that is not this sign-in', async () => {
    // Another application can register the same scheme, and an unrelated link
    // arriving mid-flow — a shared document, a notification — must not cancel
    // a sign-in the household is in the middle of.
    const s = shell();
    const g = google([{ ok: true, body: { access_token: 'at', expires_in: 3600 } }]);

    try {
      const auth = new NativeGoogleAuth({ clientId: CLIENT, scopes: SCOPES, store: memory(), fetchImpl: g.fetch });
      const signingIn = auth.signIn();
      const state = new URL(await until(() => s.opened(), 'the browser opening')).searchParams.get('state');

      s.answer('https://example.com/something-else?state=not-ours');
      s.answer(`${redirectUriFor(CLIENT)}?code=4/xyz&state=${encodeURIComponent(state)}`);

      await within(signingIn, 'the sign-in');
      assert.equal(await auth.getToken(), 'at');
    } finally { s.restore(); }
  });

  test('reports Google’s own words when it refuses', async () => {
    // "Sign-in failed" sends somebody to look at their network when the answer
    // is redirect_uri_mismatch, which is a Cloud Console screen away.
    const s = shell();
    const g = google([{ ok: false, body: { error: 'redirect_uri_mismatch', error_description: 'Bad Request' } }]);

    try {
      const auth = new NativeGoogleAuth({ clientId: CLIENT, scopes: SCOPES, store: memory(), fetchImpl: g.fetch });
      const signingIn = auth.signIn().then(() => null, (err) => err);
      const state = new URL(await until(() => s.opened(), 'the browser opening')).searchParams.get('state');
      s.answer(`${redirectUriFor(CLIENT)}?code=4/xyz&state=${encodeURIComponent(state)}`);

      const err = await within(signingIn, 'the refusal');
      assert.ok(err, 'a refusal was reported as a success');
      assert.ok(/Bad Request|redirect_uri_mismatch/.test(err.message), err.message);
    } finally { s.restore(); }
  });
});

describe('signing out', () => {
  test('clears the refresh token, not just the one in memory', async () => {
    // Dropping the access token would leave a refresh token on the device that
    // still works — a sign-out that signs nothing out.
    const s = shell();
    const g = google([
      { ok: true, body: { access_token: 'at', expires_in: 3600, refresh_token: 'rt' } },
      { ok: true, body: {} },
    ]);
    const store = memory();

    try {
      const auth = new NativeGoogleAuth({ clientId: CLIENT, scopes: SCOPES, store, fetchImpl: g.fetch });
      const signingIn = auth.signIn();
      const state = new URL(await until(() => s.opened(), 'the browser opening')).searchParams.get('state');
      s.answer(`${redirectUriFor(CLIENT)}?code=4/xyz&state=${encodeURIComponent(state)}`);
      await within(signingIn, 'the sign-in');

      await auth.signOut();
      assert.not(await store.meta(REFRESH_KEY), 'the refresh token survived a sign-out');
      assert.not(auth.isSignedIn);
      assert.ok(g.seen.some((r) => String(r.url).includes('revoke')), 'the grant was not revoked');
    } finally { s.restore(); }
  });
});

describe('which implementation a caller gets', () => {
  test('a browser gets the web flow, unchanged', () => {
    const auth = googleAuth({ scopes: SCOPES });
    assert.not(auth instanceof NativeGoogleAuth, 'a browser was given the native flow');
  });

  test('a native shell with a client id gets the device flow', () => {
    const s = shell();
    try {
      assert.ok(googleAuth({ scopes: SCOPES, nativeClientId: CLIENT }) instanceof NativeGoogleAuth);
    } finally { s.restore(); }
  });

  test('and a native shell without one falls back, so the error names the reason', () => {
    // Unavailable-with-no-explanation is the worst of the three states. The web
    // implementation fails at sign-in saying no client id is configured, which
    // is the true reason.
    const s = shell();
    try {
      assert.not(googleAuth({ scopes: SCOPES, nativeClientId: '' }) instanceof NativeGoogleAuth);
    } finally { s.restore(); }
  });
});
