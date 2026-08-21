# Running FamilyOS as a native app

Capacitor wraps the application in a native shell so the same code runs on
Android and iOS. This document is the inspection that came before any of it,
written before a single dependency was installed.

It is in `docs/` rather than the repository root because that is where this
project keeps its documents, and because `tools/self-description.mjs` only
checks numbers inside `docs/` — a claim written anywhere else goes stale
without anything noticing.

## What this application is

Measured, not assumed:

| | |
|---|---|
| Framework | None. Native ES modules, no library, no framework. |
| Language | JavaScript. TypeScript is a checker only — `noEmit`, JSDoc types. |
| Package manager | npm (`package-lock.json`, no other lockfile). |
| Build tool | None for the deployed app. `tools/bundle.mjs` exists for a preview. |
| Entry point | `index.html` → `<script type="module" src="./js/app.js">` |
| Routing | Hash-based (`#/finance/transaction/txn_1`), `js/ui/router.js`. |
| Storage | IndexedDB (`js/data/idb.js`), encrypted per field. |
| Crypto | WebCrypto, AES-GCM, PBKDF2 at 600,000 rounds. |
| Auth | A PIN, and optionally WebAuthn and Google. |
| Backend | Google Apps Script, over `fetch`. Optional — `localOnly` disables it. |
| Env vars | None. `familyos.config.json`, gitignored, holds two public ids. |
| Mobile layout | Already checked at 390 × 844 by the browser suite. |

145 JavaScript modules, about 43,500 lines, at the time of writing. Neither
number is checked by anything, so read them as scale rather than as fact.

### The production build directory is not what `npm run build` produces

This is the trap the instruction warned about, and this repository is
genuinely laid out to fall into it.

`npm run build` runs `tools/bundle.mjs`, which folds the whole application
into **one HTML file** at `dist/familyos.html`. That file is a *preview*. Its
own header says so, and it deliberately **omits the service worker**, because
a worker must be its own file at its own URL. Pointing Capacitor's `webDir` at
`dist/` would ship the preview build as the product.

The real deployed application is the **repository root, served as files**.
`netlify.toml` says `publish = "."`. The Pages workflow copies an explicit
list into `_site/`:

```
index.html oauth-callback.html manifest.webmanifest sw.js .nojekyll js css assets
```

That list — not `dist/` — is the web root Capacitor needs.

### One list, in three places

The deploy workflow's `cp` list and `sw.js`'s precache list are two
copies of the same fact, and the workflow already fails when they disagree.
Adding a third copy for Capacitor would be the same fault this project has
now found four separate times: a hand-maintained list beside a derivable one.

So the plan is a single tool, `tools/webroot.mjs`, that assembles the web root
into `dist/web/` and is used by Capacitor, by the deploy workflow, and by
nothing else. It fails if anything `sw.js` precaches is missing from what it
copied.

## Capacitor compatibility

Capacitor 8.5.0 is current. It wants JDK 21 (this machine has 21.0.10) and
Node 20+ (22.22.2). The application asks nothing of a bundler, so there is
nothing for Capacitor to be incompatible *with*: it serves static files into
a WebView, which is exactly how the app is already served.

The awkward parts are not the build. They are the four places where a WebView
is not a browser tab.

### 1. Google sign-in cannot work as it stands — measured

`redirectUriFor()` builds the OAuth redirect from `location`. Run against each
origin:

```
GitHub Pages         https://sanjaybnarayan.github.io/My-Data/oauth-callback.html
Netlify              https://familyos.netlify.app/oauth-callback.html
Capacitor Android    https://localhost/oauth-callback.html
Capacitor iOS        capacitor://localhost/oauth-callback.html
```

Google's authorization server accepts neither of the last two for a Web OAuth
client. `capacitor://` is a custom scheme, refused outright; `https://localhost`
is not a registerable redirect URI. The loopback exception Google does grant is
`http://localhost:PORT`, and only for installed-app clients.

The flow is also a **popup plus `postMessage`** (`js/auth/google.js`), and a
`window.open` inside a WebView does not produce a window that can message its
opener the way a browser tab can.

So in the native app: **sign-in fails, and with it sync, Gmail, Drive,
Calendar and key escrow.** Everything local — the records, the encryption, the
reports, the importer — is untouched, because none of it needs a token.

Making it work means a second OAuth path: an installed-app client, PKCE, the
system browser rather than a WebView, and a custom-scheme deep link back. That
is a real piece of work with its own security review, and it is **not** in the
scope of getting the app to run natively. It is written down here, and the
setup document states it as a limitation rather than leaving somebody to
discover it at a sign-in button that does nothing.

### 2. Downloads silently do nothing

`download()` in `js/modules/reports.js` tries `showSaveFilePicker` and falls
back to clicking a hidden `<a download href="blob:…">`. Neither exists in a
WebView: the picker is unimplemented, and a blob anchor click is dropped on
the floor by both platforms. Every CSV, XLSX, DOCX, PDF and iCal export — and
the "download it to open it" path in Documents — would appear to work and
produce nothing.

This is the one place a plugin earns its keep: `@capacitor/filesystem` to
write the bytes, `@capacitor/share` to hand the file to the OS.

### 3. The Android back button exits the app

There is no history to pop by default — Android sends the hardware back button
straight to the activity, which finishes. A person one screen deep into a
record taps back and the app closes. `@capacitor/app`'s `backButton` listener,
mapped to the router, is the fix.

### 4. Biometric unlock disappears, and already knows it

`webAuthnAvailable()` gates every WebAuthn call, and WebAuthn is unavailable in
both platforms' app WebViews. The lock screen will simply not offer
biometrics, and the PIN still works. Nothing breaks; a feature is absent. Worth
verifying rather than assuming, so a test asserts the degradation.

### What is fine

IndexedDB, WebCrypto, `localStorage`, `matchMedia`, `visibilitychange`,
`navigator.onLine`, hash routing, the clipboard, and `<input type="file">` all
work in both WebViews. There are no Web Workers, no WebSockets, no
`getUserMedia`, no geolocation and no cookies anywhere in the codebase — the
audit counted zero of each.

Web notifications (`js/domain/automation.js`) are already feature-detected and
return `'unsupported'`. Local notifications would be a genuine improvement
natively, but nothing in the app schedules one while it is closed today, so a
plugin would add a permission for a capability that does not exist yet. Not
installed.

## Required dependencies

```
@capacitor/core  @capacitor/cli  @capacitor/android  @capacitor/ios   8.5.0
@capacitor/app  @capacitor/filesystem  @capacitor/share
```

Nothing else. No camera (file inputs already cover it), no geolocation (unused),
no push (no server to push from), no preferences (IndexedDB and `localStorage`
already work), no splash-screen plugin unless the default proves insufficient.

## Configuration

`capacitor.config.ts`. The Capacitor CLI reads TypeScript itself, so this adds
no build step to a project whose whole shape is not having one, and a
configuration file with its reasons written in it is worth more than one
without. `tsconfig.json` does not include it; nothing compiles it.

```
appId    com.familyos.app
appName  Family OS
webDir   dist/web
```

No `server.url`. The app loads its own bundled files; a remote URL would make
an offline-first application depend on a network to start.

## Potential conflicts

- **The CSP meta tag** names `'self'`, which under Capacitor means
  `https://localhost` or `capacitor://localhost`. Same-origin assets still
  load. `connect-src` lists Google origins that the native app cannot reach a
  token for anyway.
- **The service worker** is unnecessary natively — the files are already local
  — and registering one would build a second copy of the shell in Cache Storage
  to serve requests that were never going to reach a network. Skipped, beside
  the guard that already exists for the single-file build.
- **`familyos.config.json`** is gitignored, so a native build has none and the
  app starts unconfigured — which is the correct behaviour, and Settings can
  supply both ids.

## Android

`minSdk` 24, `targetSdk`/`compileSdk` per Capacitor 8's own defaults, cleartext
traffic **off**, `INTERNET` the only permission. No camera, location or
notification permission, because nothing uses them.

`allowBackup` off — with the consequence written down rather than assumed. See
the postscript below, which is where this plan was wrong about it.

## iOS

Bundle id `com.familyos.app`, deployment target per Capacitor 8's default, no
`Info.plist` usage descriptions at all — every one of them describes a
capability this app does not use. `viewport-fit=cover` is already in the HTML,
so the safe area is handled.

## Risks

| Risk | Handling |
|---|---|
| `webDir` pointed at the preview bundle | A tool assembles the web root; a check compares it to the precache list. |
| Sign-in appears broken with no explanation | Stated in the setup document and in the plan; not papered over. |
| Exports silently produce nothing | Filesystem + Share, with the web path kept intact. |
| The PWA regresses | The full suite, the browser checks and the deploy workflow all keep running against the same files. |
| Native projects can't be built here | No Android SDK and no Xcode on this machine. Reported, not faked. |

## Rollback

Every native artefact is additive: `capacitor.config.json`, `android/`, `ios/`,
`tools/webroot.mjs`, three dependencies and some scripts. Deleting them and
reverting `package.json` returns the repository to exactly what it is now. No
existing file changes shape; the web application does not learn that Capacitor
exists except in the three places where a native platform genuinely differs,
and each of those is feature-detected so the browser keeps its behaviour.

---

## What this plan got wrong

Written after doing it, because a plan that is only ever read forwards teaches
nothing.

**The npm hook cannot bootstrap the web root.** The intended workflow was
`npx cap sync` with a `capacitor:copy:before` hook assembling `dist/web`
first. It does not work: reading the CLI's own source, `checkWebDir` runs
*before* `runHooks` in both `sync` and `copy`, so a missing directory fails the
command before any hook could create one. The hook is still registered — it
keeps an existing web root fresh — but the npm scripts build first, and the
documentation says plainly that bare `npx cap sync` is not enough.

**The adaptive icon was invisible.** The Android adaptive foreground was drawn
in the brand gradient over transparency, with the flat layer beneath it set to
the same brand blue: a blue mark on a blue background. Every byte count and
dimension check passed. It was caught by looking at the composited image, which
is the only check that could have caught it.

**A browser check could not fail.** The check that the native save does not
also fall through to the web download path counted leftover `a[download]`
elements — which `download()` removes in the same turn it clicks, so the count
is zero either way. Replaced by recording the click. Then the repaired check
*still* could not fail, because headless Chromium has `showSaveFilePicker` and
it answered first; the fake shell now deletes it, which is both the faithful
simulation of a WebView and what makes the check work.

**A browser check was racy.** `.app-nav` is in the document before the router
has started, and the back-button listener is claimed after — so reading once
passed on a fast run and failed on a slow one. It waits now.

Three of those four were found by mutation testing, and the fourth by opening
a PNG. None of them by the suite passing.

**And `allowBackup` was justified with something untrue.** The manifest comment
said the recovery phrase and Drive sync were the household's answer to a lost
device. Neither reaches a native build: the recovery phrase restores a key and
not data — `modules/settings.js` says so to the user's face — and sync is the
exact feature that does not work natively. So turning the OS backup off left a
native install with *no* backup at all, justified by a fallback that is not
there.

The setting stayed off, because the exposure it prevents is silent — a
four-digit PIN is the floor in `auth/lock.js`, and ten thousand candidates is
not a barrier once the wrapped key is on somebody else's server — while losing
a phone is not silent. But the reasoning is now the real one, and the cost is
stated where somebody shipping this will read it.

Found by taking a claim this change had made and checking it, rather than by
anything failing.
