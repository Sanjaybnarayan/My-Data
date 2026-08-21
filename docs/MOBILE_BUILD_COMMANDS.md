# Mobile build commands

Every command, in the order you would run them. Run them from the repository
root unless a line says otherwise.

`npm run build` is **not** in this list on purpose: it produces
`dist/familyos.html`, a single-file preview with no service worker. The
production web root is `npm run build:web`.

## Once, on a new machine

```
npm install
```

## Web development

```
npm start                     # http://localhost:8080
npm test                      # the suite
npm run test:browser          # the browser checks
npm run typecheck             # types, against a budget that may only fall
```

## Build the production web root

```
npm run build:web             # → dist/web
```

Prints the file count, the size, and how many of those files the service
worker precaches. It fails rather than publishing if `sw.js` names a file the
web root does not contain.

## Sync Capacitor

```
npm run cap:sync              # build:web, then cap sync
```

Copies `dist/web` into both native projects and updates their plugin lists.
Plain `npx cap sync` skips the build and fails if `dist/web` does not exist —
Capacitor checks `webDir` before running any hook, so nothing can create it for
you.

## Open the native projects

```
npm run cap:open:android      # Android Studio
npm run cap:open:ios          # Xcode, macOS only
```

## Run on a device or emulator

```
npm run cap:android           # cap:sync, then cap run android
npm run cap:ios               # cap:sync, then cap run ios
```

## Build Android

```
npm run cap:sync
cd android
./gradlew assembleDebug       # → app/build/outputs/apk/debug/
./gradlew assembleRelease     # unsigned until a keystore is configured
./gradlew bundleRelease       # → .aab, what Play wants
```

Needs a JDK 21 and the Android SDK with platform 36. Gradle fetches the
Android Gradle Plugin from `dl.google.com`, so a network that blocks Google
fails at configuration time with `Could not resolve
com.android.tools.build:gradle` — a network problem, not a project one.

## Build iOS

```
npm run cap:sync
npx cap open ios
```

Then archive from Xcode, or from the command line:

```
cd ios/App
xcodebuild -scheme App -configuration Release -destination generic/platform=iOS archive
```

macOS with Xcode only. Capacitor 8 uses Swift Package Manager — there is no
`pod install`.

## Regenerate the icons and launch screens

```
node tools/native-icons.mjs   # android/ and ios/, from the same geometry as the web icons
node tools/make-icons.mjs     # assets/icon-*.png, for the web
```

## Check the setup

```
npx cap doctor
```

## Clean and rebuild

```
rm -rf dist/web && npm run cap:sync

cd android && ./gradlew clean && cd ..

# and, if a native project is beyond explaining:
rm -rf android ios
npm run build:web
npx cap add android && npx cap add ios
node tools/native-icons.mjs
# then reapply allowBackup and usesCleartextTraffic in AndroidManifest.xml —
# see docs/CAPACITOR_SETUP.md, "Permissions"
```
