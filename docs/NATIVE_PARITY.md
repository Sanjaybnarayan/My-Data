# The Two Native Projects Did Not Agree

`tests/native.test.mjs`, `ios/App/App/Info.plist`.

> **Superseded in part, 29 August 2026.** iOS is descoped and
> `.github/workflows/ios.yml` is deleted, so the iOS half of everything below
> is history rather than a live guard. The checks that compared the two
> platforms were removed with it — one of them would have failed the next
> Android plugin on iOS's behalf. What replaced them is a single test
> recording that iOS is kept and unbuilt, and a **new** check in the direction
> this document did not cover: that the name in Java's
> `@CapacitorPlugin(name = ...)` is the name the JavaScript asks for. That was
> the gap left after this was written — registration was asserted by *class*,
> and Capacitor resolves by the *annotation*.

## What was found

Asked whether everything was wired into Capacitor, the answer was measured
rather than recalled — and it was no.

```
plugins the JavaScript calls : App Browser Filesystem Geolocation Share SmsInbox
linked on Android            : App Browser Filesystem Geolocation Share  (+SmsInbox by hand)
linked on iOS                : App           Filesystem              Share
```

**iOS sat two plugins behind Android.** `Browser` is what OAuth sign-in
opens. `Geolocation` is what every safe zone depends on, and had been called
since Phase 15.

The failure mode is silent by construction. `plugin('Geolocation')` returns
`undefined` on a platform that never linked it, `js/core/position.js` falls
back to the WebView, and the feature reads as *unpermitted* rather than as
*unbuilt*.

Three lists have to say the same thing — the calls in the source, Android's
`capacitor.settings.gradle`, and iOS's generated `Package.swift`. They are
written by different tools at different times and nothing compared them. That
is the same shape this repository has now found a dozen times.

## And a second defect underneath it

With `Geolocation` linked, `Info.plist` had **no
`NSLocationWhenInUseUsageDescription`**. iOS does not warn or deny in that
case: it **terminates the process**. Both paths need the key — the plugin and
the WebView fallback — so this was a latent crash whether or not the plugin
was linked, and `PHASE_STATUS.md` said "no usage descriptions needed".

The key added is `WhenInUse` only. There is deliberately no
`NSLocationAlwaysAndWhenInUseUsageDescription`, for exactly the reason
`ACCESS_BACKGROUND_LOCATION` is absent from the Android manifest with a test
enforcing it: FamilyOS reads a position only while somebody has the app open
and asks it to, and requesting more than that would be asking for a capability
the application does not have. A test now enforces the iOS half.

## `SmsInbox` is not the same kind of absence

It is a first-party plugin — `SmsInboxPlugin.java`, registered by hand in
`MainActivity` — so it is not in `capacitor.settings.gradle`, which lists npm
packages. And it has **no iOS counterpart because iOS has no SMS inbox to
read**. That is a platform fact, not drift, and the tests say so out loud
rather than skipping it: a reader who finds `SmsInbox` missing from the iOS
project should not have to guess which kind of missing it is.

## What the iOS workflow does and does not prove

`.github/workflows/ios.yml` runs on `macos-latest` and is the first time this
project has been put in front of Xcode. It checks the web assets copied in,
checks all five plugins are in `Package.swift`, and builds for the
**simulator** with signing disabled.

**It produces nothing installable.** A build for a device has to be signed
with an Apple developer identity, and this repository holds no certificate and
no provisioning profile — it should not. So the workflow can answer *does it
compile, do the plugins link, does the app bundle*, and cannot answer *does it
run on a phone*.

`PHASE_STATUS.md` row 24 still says **never compiled**, because at the time of
writing it has not been: the workflow exists and its first run is what will
say. Writing "compiles" before the job has ever gone green would be the same
fault as every stale row this scorecard has already carried.

## Compiling is still not running

The Android app builds in CI on every push and the APK is downloadable. As far
as this repository can show, **it has never been installed on a phone**. The
SMS plugin's JavaScript is tested against a fake plugin object; the Java has
never met a real inbox. Row 23 now says so.

That is the honest boundary: the wiring is tested, the build is proven, and
the device is not.
