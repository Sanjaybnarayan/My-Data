# Signing in with Google on a phone

The native app could not sign in at all until now, and the reason was not a bug
to be found. Google refuses three separate things the browser flow depends on,
and each refusal is deliberate on their side.

## Why the browser flow cannot be made to work

| What the browser does | What Google does about it on a phone |
|---|---|
| Redirects to `https://…/oauth-callback.html` | A WebView's origin is `https://localhost` (Android) or `capacitor://localhost` (iOS). Neither is registerable for a Web client, and the loopback exception is `http://127.0.0.1:PORT` for desktop clients only. |
| Opens a popup and reads `postMessage` | `window.open` in a WebView gives no window that can message its opener. |
| Runs the whole thing inside the app | Google **refuses** authorization from an embedded WebView and answers `disallowed_useragent`. This is policy, not a technical limit. |

That last row is why "find a redirect URI that works" was never the answer. The
sign-in page has to open in the **system browser**, and the answer has to come
back to the app by another route entirely.

## What replaces it

1. An **installed-app OAuth client** — Android or iOS type — which Google issues
   **without a client secret**, because a binary on somebody's phone cannot keep
   one.
2. **PKCE** in place of that secret. The app invents a random `code_verifier`,
   sends only its SHA-256 hash, and presents the original when redeeming the
   code. Somebody who intercepts the redirect gets a code they cannot spend.
3. The sign-in page opens in a **Custom Tab / SFSafariViewController**.
4. Google answers on a **custom URL scheme** — the reversed client id — which
   the operating system routes back to the app.
5. The code is redeemed for an access token **and a refresh token**, because the
   browser's renewal trick (a hidden iframe with `prompt=none`) is another thing
   a WebView cannot do.

## What you have to do, because nothing in this repository can

An installed-app client is tied to your package name and, on Android, to the
**SHA-1 fingerprint of the signing certificate**. No repository can create that.

### 1. Get the fingerprint of the key you will sign with

For a debug build — which is what the APK from CI is — that is the debug
keystore, and it is the same on any machine that has one:

```
keytool -list -v -keystore ~/.android/debug.keystore \
        -alias androiddebugkey -storepass android -keypass android | grep SHA1
```

A release build has a different fingerprint, and needs **its own client**. An
app signed with a key Google has not seen gets `redirect_uri_mismatch`, which
says nothing about certificates and sends people to look at the redirect.

### 2. Create the client

<https://console.cloud.google.com/apis/credentials> → **Create credentials** →
**OAuth client ID**

- **Android** — package name `com.familyos.app`, SHA-1 from above.
- **iOS** — bundle id `com.familyos.app`.

Keep the Web client you already have. It is what browsers and installed PWAs
use, and this does not replace it.

### 3. Tell the app, and tell the operating system

Settings → Google, or `familyos.config.json`:

```json
{ "googleNativeClientId": "123456789-abcdefg.apps.googleusercontent.com" }
```

Then register the scheme in the native projects — it is derived from the client
id, so it is different for every deployment and cannot be committed:

```
node tools/native-scheme.mjs 123456789-abcdefg.apps.googleusercontent.com
npm run cap:sync
```

Without that step the failure is the most confusing one available: the tab
opens, Google accepts the sign-in, and the redirect goes nowhere — nothing is
registered for the scheme, so the app is never told, and you are left looking
at a browser tab that says everything worked.

`node tools/native-scheme.mjs --check` fails when the projects and the config
disagree. With no client id configured it does nothing, because a fresh clone
that cannot sign in yet is the ordinary state of a fresh clone.

### 4. Scopes

The consent screen must list the same scopes the Web client uses — `core/scopes.js`
declares them once and says what each is for. A scope granted to one client is
not granted to another.

## Where the refresh token lives, and why that is a decision

In `meta`, under `auth.googleRefreshToken`, encrypted with the household's data
key like every other secret this application holds — so it is readable only
while the app is unlocked.

It is a longer-lived credential than anything the browser flow ever kept, and
that is the trade being made openly: without it a household re-authorises
through a browser tab every hour, and an application people abandon is not more
secure than one they use. Signing out revokes the grant at Google **and** clears
the stored token, whether or not the revoke call succeeds — an unreachable
network is not a reason to keep a credential somebody asked to be rid of.

## What still does not work on a phone

**Biometric unlock.** WebAuthn is unavailable in both platforms' app WebViews,
and `webAuthnAvailable()` already gates every call, so the lock screen does not
offer it and the PIN still works.

## If it fails

| Google says | It means |
|---|---|
| `disallowed_useragent` | The sign-in opened in the WebView rather than a Custom Tab — the Browser plugin is missing from the build. |
| `redirect_uri_mismatch` | The client id, the package name or the signing certificate does not match the client you registered. A debug build against a release client fails exactly here. |
| `invalid_client` | A Web client id was configured where an installed-app one belongs. |
| Nothing happens after consent | The scheme is not registered. Run `tools/native-scheme.mjs`, then `npm run cap:sync`. |

The app reports Google's own words rather than "sign-in failed", because the
first sends you to the right screen and the second sends you to your network.
