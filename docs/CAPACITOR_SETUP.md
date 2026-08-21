# FamilyOS as an Android and iOS app

Capacitor puts the application — the same files a browser gets — inside a
native shell. Nothing was rewritten to make that work, and the web application
is unchanged except in three places where a WebView genuinely differs from a
browser tab.

`docs/CAPACITOR_INTEGRATION_PLAN.md` is the inspection this came out of, and
explains the decisions. This is how to work with it.

## Architecture

```
  index.html + js/ + css/ + assets/ + sw.js         the application
              │
              ├── served as files ────────────────► browser, PWA
              │
              └── tools/webroot.mjs ──► dist/web ──► npx cap sync ──► android/
                                                                 └──► ios/
```

One set of files, three destinations. `tools/webroot.mjs` assembles the web
root and refuses to finish if anything `sw.js` precaches is missing from it;
the Pages workflow publishes the output of that same tool.

**`npm run build` is not this.** It runs `tools/bundle.mjs`, which folds the
app into a single `dist/familyos.html` for previewing and deliberately has no
service worker. `npm run build:web` is the production web root.

## Installation

Already done, and recorded in `package.json`. From a fresh clone:

```
npm install
```

That brings in Capacitor 8.5.0 — core, CLI, the two platforms, and three
plugins. None of it reaches the browser: the application still ships as native
ES modules with no bundler and no build step.

## Development

Nothing about web development changed.

```
npm start              # serve the app at http://localhost:8080
npm test               # the suite, no browser
npm run test:browser   # the browser checks, in Chromium
```

Native work adds one step — the web root has to be assembled before Capacitor
can copy it:

```
npm run cap:sync       # build:web, then cap sync
npm run cap:open:android
npm run cap:open:ios
```

`npx cap sync` on its own copies whatever is in `dist/web` already, which may
be stale, and fails outright if the directory does not exist — Capacitor
checks `webDir` *before* it runs any npm hook, so no hook can create it. Use
`npm run cap:sync`, which builds first. A `capacitor:copy:before` hook is
registered as a second line of defence: it rebuilds the web root whenever
`cap copy` runs against a directory that already exists.

## The three native plugins, and why only three

| Plugin | Why |
|---|---|
| `@capacitor/filesystem` | Every export would otherwise silently produce nothing. |
| `@capacitor/share` | Hands the written file to the OS so a person can see it. |
| `@capacitor/app` | Claims the Android back button, which otherwise closes the app. |

Not installed, and each for a reason: **camera** — `<input type="file">`
already opens the camera on both platforms; **geolocation** — nothing in the
codebase reads a position; **push notifications** — there is no server to push
from; **preferences** — IndexedDB and `localStorage` both work; **local
notifications** — nothing schedules one while the app is closed, so it would
mean asking for a permission to support a feature that does not exist.

Nothing is imported from those packages. The application ships without a
bundler, so a bare specifier cannot be resolved; `js/core/native.js` reaches
the native implementations through `Capacitor.registerPlugin`, which the
bridge exposes globally. The npm packages exist so `npx cap sync` knows which
native sources to add to the platform projects.

## Permissions

Android asks for `INTERNET` and nothing else. iOS has no `Info.plist` usage
descriptions at all, because the app uses no camera, microphone, location,
contacts or photo library.

Two Android settings are deliberate rather than inherited:

- `android:allowBackup="false"`. Android's auto-backup copies the app's data
  directory — the household's records and the wrapped key material — to the
  account holder's Drive. An application whose premise is "encrypted, on this
  device" should not put a copy of that device elsewhere without being asked.
  The cost is that a new phone does not restore the old one's local store;
  the recovery phrase and Drive sync are FamilyOS's own answer to that.
- `android:usesCleartextTraffic="false"`. Already the platform default above
  API 27, written down so a later `targetSdk` change cannot flip it silently.

## What does not work natively

**Google sign-in, and everything behind it.** Measured, not assumed:
`redirectUriFor()` returns `https://localhost/oauth-callback.html` on Android
and `capacitor://localhost/oauth-callback.html` on iOS, and Google's
authorization server accepts neither for a Web OAuth client. The flow is also
a popup that `postMessage`s its opener, which a WebView does not provide.

So in the native app there is no sync, no Gmail, no Drive, no Calendar and no
key escrow. Everything local is untouched: enrolment, the PIN, the encryption,
the records, the importer, the reports.

Making it work needs a second OAuth path — an installed-app client, PKCE, the
system browser, and a custom-scheme deep link back — with its own security
review. That is a piece of work in its own right, not a configuration setting,
and it has not been done.

**Biometric unlock.** WebAuthn is unavailable in both platforms' app WebViews.
`webAuthnAvailable()` already gates every call, so the lock screen simply does
not offer it and the PIN still works.

## Debugging

`webContentsDebuggingEnabled` is `false` in `capacitor.config.ts` so a shipped
build cannot be attached to. Turn it on locally when you need Chrome DevTools
against the device, and do not commit it on — the WebView it exposes is one
holding a decrypted data key.

For the browser, everything is as it was: the application is files, and
DevTools sees the real modules.

## Release builds

### Android

```
npm run cap:sync
cd android && ./gradlew assembleRelease
```

Signing is not configured, and deliberately not: a keystore is a secret and
this repository holds none. Create one, put its credentials in
`~/.gradle/gradle.properties` — never in the repository — and reference them
from `android/app/build.gradle`. Losing that keystore means never being able to
update the app on Play again.

### iOS

```
npm run cap:sync
npx cap open ios
```

Then sign in Xcode with a team, set the bundle identifier to
`com.familyos.app`, and archive. Capacitor 8 uses Swift Package Manager, so
there is no CocoaPods step.

### Store preparation

Both stores will ask what the app collects and where it goes. The honest
answer for a native build today: everything stays on the device, because the
sync that would send it anywhere is the part that does not work natively. If
that changes, the data-safety declarations change with it.

The icon meets the App Store's rule that it carry no alpha channel —
`tools/native-icons.mjs` writes it as RGB rather than flattening RGBA, which
is not the same thing and is the difference between acceptance and rejection.

## Common errors

**`Could not find the web assets directory: ./dist/web`** — `cap sync` was run
without building the web root. Use `npm run cap:sync`.

**`Could not resolve com.android.tools.build:gradle`** — the machine cannot
reach `dl.google.com`. Nothing about the project is wrong; the network is
blocking the Android Gradle Plugin.

**`Xcode is not installed`** from `npx cap doctor` — expected anywhere that is
not macOS. The `ios/` project is still generated, synced and committed; it just
cannot be compiled without Xcode.

**An export appears to do nothing** — check the Filesystem plugin is in the
build. `js/core/native.js` returns `null` for a plugin the shell was not built
with, and `download()` then falls back to a web path that a WebView ignores.

## Troubleshooting

Regenerate the native projects from scratch if one gets into a state nothing
explains:

```
rm -rf android ios
npm run build:web
npx cap add android && npx cap add ios
node tools/native-icons.mjs
```

That is safe because every native customisation this repository makes is
either in `capacitor.config.ts`, in `tools/native-icons.mjs`, or the two lines
in `AndroidManifest.xml` described above — and the manifest is the only one you
would have to reapply by hand.
