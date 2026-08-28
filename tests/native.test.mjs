import { test, describe, assert, setSuite } from './harness.mjs';
import { isNative, platform, plugin, forgetPlugins } from '../js/core/native.js';
import { precachedPaths, missingFrom, SHIPPED } from '../tools/webroot.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

setSuite('native shell');

/**
 * A fake bridge shaped like the one `@capacitor/core` installs on `globalThis`.
 * Read off the real thing rather than imagined: `registerPlugin` returns a
 * proxy, `isPluginAvailable` consults the natively injected headers, and
 * `isNativePlatform` is false in a browser.
 */
function bridge({ native = true, available = ['Filesystem', 'Share', 'App'] } = {}) {
  const made = [];
  return {
    made,
    Capacitor: {
      isNativePlatform: () => native,
      getPlatform: () => (native ? 'android' : 'web'),
      isPluginAvailable: (name) => available.includes(name),
      registerPlugin: (name) => {
        made.push(name);
        return { name };
      },
    },
  };
}

function withBridge(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'Capacitor');
  const before = globalThis.Capacitor;
  globalThis.Capacitor = value;
  forgetPlugins();
  try {
    return fn();
  } finally {
    if (had) globalThis.Capacitor = before;
    else delete globalThis.Capacitor;
    forgetPlugins();
  }
}

describe('in a browser', () => {
  test('there is no native platform and no plugin', () => {
    withBridge(undefined, () => {
      assert.not(isNative());
      assert.equal(platform(), 'web');
      assert.equal(plugin('Filesystem'), null);
    });
  });

  test('a bridge that says it is the web is still the web', () => {
    // Capacitor's own JS is present in a browser build too. Its presence is
    // not the question; `isNativePlatform()` is.
    const { Capacitor, made } = bridge({ native: false });
    withBridge(Capacitor, () => {
      assert.not(isNative());
      assert.equal(plugin('Filesystem'), null);
      assert.length(made, 0, 'registered a plugin in a browser');
    });
  });

  test('a bridge missing registerPlugin does not throw', () => {
    withBridge({ isNativePlatform: () => true, getPlatform: () => 'android' }, () => {
      assert.ok(isNative());
      assert.equal(plugin('Filesystem'), null);
    });
  });
});

describe('on a native platform', () => {
  test('a plugin the shell was built with is returned', () => {
    const { Capacitor } = bridge();
    withBridge(Capacitor, () => {
      assert.equal(plugin('Filesystem').name, 'Filesystem');
      assert.equal(platform(), 'android');
    });
  });

  test('a plugin the shell was not built with is null, not a throwing proxy', () => {
    // `registerPlugin` hands back a proxy for anything, and every call on it
    // rejects with UNIMPLEMENTED. That turns a decision — "is there a native
    // way to do this?" — into an error at the point of use, by which time the
    // web fallback has been skipped.
    const { Capacitor, made } = bridge({ available: ['App'] });
    withBridge(Capacitor, () => {
      assert.equal(plugin('Filesystem'), null);
      assert.equal(plugin('App').name, 'App');
      assert.deep(made, ['App']);
    });
  });

  test('each plugin is registered once, however often it is asked for', () => {
    // Capacitor warns to the console and returns the first proxy on a second
    // registration. A screen that exports in a loop should not print a warning
    // per file.
    const { Capacitor, made } = bridge();
    withBridge(Capacitor, () => {
      for (let i = 0; i < 5; i++) plugin('Share');
      assert.deep(made, ['Share']);
    });
  });
});

setSuite('the web root');

describe('what a native app bundles', () => {
  test('is not the single-file preview build', async () => {
    // `npm run build` produces dist/familyos.html, which deliberately has no
    // service worker. Shipping it would ship a preview as the product, and the
    // only thing standing between the two is which directory webDir names.
    const config = await readFile(join(ROOT, 'capacitor.config.ts'), 'utf8');
    const webDir = /webDir:\s*'([^']+)'/.exec(config)?.[1];

    assert.equal(webDir, 'dist/web');
    assert.not(/webDir:\s*'dist'/.test(config), 'webDir points at the preview build');
  });

  test('carries every file the service worker precaches', async () => {
    // The worker's list is the one that has to be right — a worker that
    // precaches a file nobody shipped fails to install, and the app stops
    // working offline without saying so. So the ship list is checked against
    // it rather than maintained beside it.
    const precached = precachedPaths();
    assert.ok(precached.length > 100, `only ${precached.length} precached paths`);

    const roots = new Set(precached
      .filter(Boolean)
      .map((path) => (path.includes('/') ? path.split('/')[0] : path)));

    const unshipped = [...roots].filter((name) => !SHIPPED.includes(name));
    assert.length(unshipped, 0, `precached but not in the ship list: ${unshipped.join(', ')}`);
  });

  test('the check notices a directory left out of the ship list', () => {
    // A check that cannot fail is worse than no check. This is the failure it
    // exists for, produced on purpose: a web root assembled without css.
    const missing = missingFrom(join(ROOT, 'tests'), ['css/base.css', 'js/app.js']);
    assert.deep(missing, ['css/base.css', 'js/app.js']);
  });

  test('the ship list carries nothing that is not the application', () => {
    // node_modules, tests, tools, docs and the Apps Script backend are all in
    // this repository and none of them belong in an APK.
    for (const name of ['node_modules', 'tests', 'tools', 'docs', 'apps-script', 'dist']) {
      assert.not(SHIPPED.includes(name), `${name} would ship to a device`);
    }
  });
});

setSuite('what the native build says about itself');

describe('the allowBackup decision', () => {
  test('quotes the PIN floor that the lock screen actually enforces', async () => {
    // `AndroidManifest.xml` and docs/CAPACITOR_SETUP.md both turn off Android's
    // auto-backup, and both justify it with the number of candidates between an
    // exfiltrated store and the records in it. That number is a property of
    // `auth/lock.js`, quoted in two documents, and quoted numbers go stale.
    //
    // This is a tripwire rather than an assertion about the right value.
    // Raising the minimum PIN length would be a good change; it would also make
    // two security documents wrong, and this is what says so.
    const lock = await readFile(join(ROOT, 'js/auth/lock.js'), 'utf8');
    const floor = Number(/const PIN_LENGTH_MIN = (\d+);/.exec(lock)?.[1]);

    assert.equal(floor, 4,
      'the minimum PIN length changed — AndroidManifest.xml and '
      + 'docs/CAPACITOR_SETUP.md both quote it as four digits, and ten thousand '
      + 'candidates. Update both, then update this test.');
  });

  test('does not claim a backup that a native build has', async () => {
    // The first version of that justification said the recovery phrase and
    // Drive sync covered the loss. Neither reaches a native build: the phrase
    // restores a key and not data, and sync is the feature that does not work
    // there. The documents have to keep saying so.
    const setup = await readFile(join(ROOT, 'docs/CAPACITOR_SETUP.md'), 'utf8');

    assert.ok(/no backup at all/.test(setup),
      'CAPACITOR_SETUP.md no longer states that a native build has no backup');
    assert.ok(/key, not data|key and not data/.test(setup),
      'CAPACITOR_SETUP.md no longer says the recovery phrase restores a key rather than data');
  });
});

describe('the Android resource directories', () => {
  test('name their qualifiers in the order Android demands', async () => {
    // Android fixes this order and rejects anything else outright: orientation,
    // then UI mode (of which `night` is one), then density. A wrong name is not
    // ignored and does not merely fail to match — it fails the whole build at
    // mergeResources with "Invalid resource directory name".
    //
    // These were first generated as `drawable-night-port-hdpi`. Every check in
    // this repository passed them: the dimensions were right, the pixels were
    // right, and the composited icon looked right. None of them knew what
    // Android calls a directory, so the first build on a machine that could
    // actually compile is what found it. This is that knowledge, written down.
    const ORDER = ['port', 'land', 'night', 'notnight',
      'ldpi', 'mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi', 'nodpi', 'anydpi', 'v24', 'v26'];

    const res = join(ROOT, 'android/app/src/main/res');
    const dirs = (await readdir(res, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    assert.ok(dirs.length > 15, `only ${dirs.length} resource directories found`);

    const wrong = [];
    for (const name of dirs) {
      const [, ...qualifiers] = name.split('-');
      const ranks = qualifiers.map((q) => ORDER.indexOf(q));

      // A qualifier this test has never heard of is not judged — it would be a
      // new kind of directory, not necessarily a wrong one.
      if (ranks.includes(-1)) continue;
      for (let i = 1; i < ranks.length; i++) {
        if (ranks[i] < ranks[i - 1]) {
          wrong.push(`${name} (${qualifiers[i]} must come before ${qualifiers[i - 1]})`);
          break;
        }
      }
    }

    assert.length(wrong, 0, wrong.join(' | '));
  });

  test('carry a dark launch screen for every light one', async () => {
    // The point of generating them at all: the app reads the stored theme in an
    // inline script before the first paint so a dark-mode user never sees white,
    // and a light-only launch screen puts that flash back one layer down.
    const res = join(ROOT, 'android/app/src/main/res');
    const dirs = (await readdir(res, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && /^drawable-(port|land)-/.test(d.name))
      .map((d) => d.name);

    const light = dirs.filter((d) => !d.includes('-night-'));
    const dark = dirs.filter((d) => d.includes('-night-'));

    assert.ok(light.length > 0, 'no orientation-specific launch screens at all');
    assert.equal(dark.length, light.length,
      `${light.length} light launch screens and ${dark.length} dark ones`);
  });
});

setSuite('what the native build asks a phone for');

/**
 * The permissions are the claim.
 *
 * Everything the application *says* about location is prose — in
 * docs/LOCATION.md, on the Safety screen, in the manifest's own comment — and
 * prose does not stop anybody adding a line to an XML file. The manifest is
 * where "we do not watch your family in the background" is either true or not,
 * so it is asserted here rather than described.
 */
describe('the location permissions', () => {
  const manifest = () => readFile(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  const asks = (xml, name) =>
    new RegExp(`<uses-permission[^>]*android:name="android\\.permission\\.${name}"`).test(xml);

  test('it asks for the two the plugin needs, at runtime', async () => {
    const xml = await manifest();
    assert.ok(asks(xml, 'ACCESS_FINE_LOCATION'), 'fine location is not declared');
    assert.ok(asks(xml, 'ACCESS_COARSE_LOCATION'),
      'coarse is not declared — a person who grants only the approximate '
      + 'permission would get nothing at all');
  });

  /**
   * Background location is now declared, on a deliberate decision.
   *
   * The check that stood here refused it, and said: "three documents and a
   * screen say this application does not do that. Change them first, or
   * remove the line." They were changed first. What replaces the refusal is
   * not nothing — it is the set of properties that made the refusal
   * arguable in the first place, each asserted separately.
   */
  test('background location is declared, with everything it drags in', async () => {
    const xml = await manifest();
    assert.ok(asks(xml, 'ACCESS_BACKGROUND_LOCATION'));
    assert.ok(asks(xml, 'FOREGROUND_SERVICE'),
      'a background recorder without a foreground service is one Android kills');
    assert.ok(asks(xml, 'FOREGROUND_SERVICE_LOCATION'),
      'Android 14+ refuses a location foreground service without its type');
    assert.ok(asks(xml, 'POST_NOTIFICATIONS'),
      'without this the service runs and its notification never appears — a '
      + 'phone recording a position and not saying so');
  });

  test('the service is declared, not exported, and typed as location', async () => {
    const xml = await manifest();
    assert.ok(/<service[^>]*android:name="\.LocationTrailService"/s.test(xml));
    assert.ok(/android:name="\.LocationTrailService"[\s\S]{0,200}?android:exported="false"/.test(xml),
      'nothing outside this application should be able to start it');
    assert.ok(/android:name="\.LocationTrailService"[\s\S]{0,200}?android:foregroundServiceType="location"/.test(xml));
  });

  test('and nothing starts it by itself', async () => {
    // The property that keeps this a thing a household switched on rather
    // than a thing that happens to them. No boot receiver, and the service
    // does not ask Android to restart it.
    const xml = await manifest();
    assert.not(/BOOT_COMPLETED/.test(xml),
      'a boot receiver would start recording before anybody opened the app');
    const service = await readFile(
      join(ROOT, 'android/app/src/main/java/com/familyos/app/LocationTrailService.java'),
      'utf8');
    assert.ok(/START_NOT_STICKY/.test(service),
      'START_STICKY would have Android restart the recorder unasked');
    assert.not(/START_STICKY[^_]/.test(service));
  });

  test('the service never writes records itself', async () => {
    // The reason it hands fixes to the WebView instead: the database is
    // encrypted with a key the service does not have. A service that wrote
    // would be a second, plaintext copy of a household's movements.
    const service = await readFile(
      join(ROOT, 'android/app/src/main/java/com/familyos/app/LocationTrailService.java'),
      'utf8');
    for (const forbidden of ['FileOutputStream', 'openFileOutput', 'SharedPreferences',
      'SQLiteDatabase', 'getExternalFilesDir']) {
      assert.not(new RegExp(forbidden).test(service),
        `${forbidden} in the service means a second copy of the trail on disk`);
    }
  });

  test('screen time is declared as the special access it is', async () => {
    const xml = await manifest();
    assert.ok(asks(xml, 'PACKAGE_USAGE_STATS'));
    // It cannot be requested at runtime, so a plugin that tried would look
    // to a caller like the person refused.
    const plugin = await readFile(
      join(ROOT, 'android/app/src/main/java/com/familyos/app/ScreenTimePlugin.java'),
      'utf8');
    assert.ok(/ACTION_USAGE_ACCESS_SETTINGS/.test(plugin),
      'the only way to get this grant is to open the settings page');
    assert.not(/requestPermissionForAliases|requestPermissions\(/.test(plugin),
      'Android shows no prompt for PACKAGE_USAGE_STATS');
  });

  /**
   * `READ_SMS` moved out of `src/main` and into the `sms` flavour.
   *
   * Not a retreat from Phase 6. Google Play Protect **blocks the install** of
   * a sideloaded app that asks for a restricted permission — the SMS and Call
   * Log family — and the dialog offers no way past it. One permission was
   * therefore making every other feature in this build unreachable on a real
   * phone, which is how it was found: somebody tried to install it.
   */
  const smsManifest = () =>
    readFile(join(ROOT, 'android/app/src/sms/AndroidManifest.xml'), 'utf8');

  test('the installable flavour asks for no restricted permission', async () => {
    // The whole point of the split. Any one of these and Android refuses.
    const xml = await manifest();
    for (const name of ['READ_SMS', 'RECEIVE_SMS', 'SEND_SMS', 'WRITE_SMS',
      'READ_CALL_LOG', 'WRITE_CALL_LOG', 'RECEIVE_MMS', 'RECEIVE_WAP_PUSH',
      'PROCESS_OUTGOING_CALLS']) {
      assert.not(asks(xml, name),
        `${name} is a Play restricted permission — with it in src/main, Play `
        + 'Protect blocks the install and nothing else in the app can be used');
    }
  });

  test('and the sms flavour still asks for it, because Phase 6 needs it', async () => {
    const xml = await smsManifest();
    assert.ok(asks(xml, 'READ_SMS'),
      'the native SMS path cannot work without it, and js/core/smsinbox.js '
      + 'would report DENIED forever');
  });

  test('the flavour exists in the build file, or the manifest is dead weight', async () => {
    // A source set with no flavour declared is a directory Gradle never reads,
    // so READ_SMS would be in neither build and Phase 6 silently unbuildable.
    const gradle = await readFile(join(ROOT, 'android/app/build.gradle'), 'utf8');
    assert.ok(/productFlavors\s*\{[\s\S]*\bsms\s*\{/.test(gradle),
      'src/sms exists and no `sms` flavour reads it');
    assert.ok(/productFlavors\s*\{[\s\S]*\bstandard\s*\{/.test(gradle));
  });

  test('and both flavours keep the same application id', async () => {
    // A suffix would change the OAuth redirect scheme that
    // tools/native-scheme.mjs checks against the configuration, breaking
    // Google sign-in to gain side-by-side installs nobody asked for.
    const gradle = await readFile(join(ROOT, 'android/app/build.gradle'), 'utf8');
    assert.not(/applicationIdSuffix/.test(gradle));
  });

  test('and does not ask to receive SMS as messages arrive', async () => {
    // The Phase 6 counterpart to background location, and the same argument.
    // RECEIVE_SMS wakes the app on every arriving message, which is passive
    // interception rather than something a person asked for. Nothing here
    // needs it: the inbox is read when somebody opens the screen and taps.
    //
    // js/core/smsinbox.js, the Messages screen and docs/SMS_INTELLIGENCE.md
    // all say nothing runs in the background. This is what makes that true
    // rather than merely written down.
    const xml = await manifest();
    assert.not(asks(xml, 'RECEIVE_SMS'),
      'RECEIVE_SMS was added — the module, the screen and the documentation '
      + 'all say this application does not watch for messages. Change them '
      + 'first, or remove the line.');
    assert.not(asks(xml, 'SEND_SMS'), 'this application never sends a message');
  });

  test('the SMS permission carries the distribution warning with it', async () => {
    // READ_SMS is a Play restricted permission and decides where this build
    // can go. Somebody adding a target or preparing a listing has to meet
    // that fact at the line itself, not three documents away.
    const xml = await smsManifest();
    const before = xml.slice(0, xml.indexOf('android.permission.READ_SMS'));
    const comment = before.slice(before.lastIndexOf('<!--'));
    assert.includes(comment, 'restricted permission');
    assert.includes(comment, 'sideload');
  });

  test('and the flavour file says why it is a separate build at all', async () => {
    // The reason is not obvious from the diff: one permission made every
    // other feature unreachable. Somebody merging the flavours back together
    // should meet that here rather than by shipping and being told.
    const xml = await smsManifest();
    const head = xml.slice(0, xml.indexOf('<manifest'));
    assert.includes(head, 'Play Protect');
    assert.includes(head.toLowerCase(), 'blocks the install');
  });

  test('a device without telephony is not excluded either', async () => {
    // Declared beside READ_SMS in the sms flavour, because that is the only
    // build where telephony means anything.
    const xml = await smsManifest();
    assert.ok(/android\.hardware\.telephony"\s+android:required="false"/.test(xml),
      'a tablet or work profile with no SIM still runs everything else');
  });

  test('a device without GPS is not excluded from the store listing', async () => {
    const xml = await manifest();
    assert.ok(/android\.hardware\.location\.gps"\s+android:required="false"/.test(xml),
      'the GPS feature should be declared optional — the app degrades to '
      + '"no reading on this device" rather than needing the hardware');
  });

  test('the plugin that owns the runtime grant is actually installed', async () => {
    // Without it `navigator.geolocation` inside the WebView is answered no
    // before a person sees a prompt, and the feature looks broken rather than
    // unpermitted.
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.dependencies['@capacitor/geolocation'],
      '@capacitor/geolocation is what asks Android for the permission');
  });
});

setSuite('the two native projects agree');

/**
 * Three lists of Capacitor plugins that have to say the same thing.
 *
 * The JavaScript asks for a plugin by name. Android wires its list in
 * `capacitor.settings.gradle`. iOS wires its own in the generated
 * `Package.swift`. All three are written by different tools at different
 * times, and nothing compared them — so iOS sat **two plugins behind**
 * Android: `Browser`, which OAuth sign-in opens, and `Geolocation`, which
 * every safe zone depends on.
 *
 * The failure is silent by construction. `plugin('Geolocation')` returns
 * undefined on a platform that never linked it, `position.js` falls back to
 * the WebView, and the feature looks unpermitted rather than unbuilt.
 */
/**
 * Plugins this repository writes itself, which are not npm packages.
 *
 * All three are `android/app/.../*Plugin.java`, registered by hand in
 * `MainActivity`, so none appears in `capacitor.settings.gradle` — that file
 * lists npm plugins. None has an iOS counterpart, and in each case that is a
 * platform fact rather than an omission: iOS has no SMS inbox to read, no
 * usage-stats API of this kind, and its background-location model is
 * different enough that a shared plugin would be a pretence. Naming them here
 * is what lets the parity checks below stay strict about everything else.
 */
const FIRST_PARTY = new Set(['SmsInbox', 'BackgroundLocation', 'ScreenTime']);

/** Every plugin name the application asks for, read off the source. */
async function pluginsCalled() {
  const names = new Set();
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(full); continue; }
      if (!entry.name.endsWith('.js')) continue;
      const text = await readFile(full, 'utf8');
      for (const [, name] of text.matchAll(/\bplugin\??\.?\(\s*'([A-Z][A-Za-z]*)'\s*\)/g)) {
        names.add(name);
      }
    }
  };
  await walk(join(ROOT, 'js'));
  return names;
}

describe('every plugin the app calls is wired into both platforms', () => {
  const fromNpm = async () => [...await pluginsCalled()].filter((n) => !FIRST_PARTY.has(n));

  test('the JavaScript asks for a known set', async () => {
    const called = await pluginsCalled();
    // Named so a new plugin arriving is a deliberate change to this line
    // rather than something the checks below silently absorb.
    assert.deep([...called].sort(),
      ['App', 'BackgroundLocation', 'Browser', 'Filesystem', 'Geolocation',
        'ScreenTime', 'Share', 'SmsInbox']);
  });

  test('and Android links every npm one of them', async () => {
    const gradle = await readFile(join(ROOT, 'android', 'capacitor.settings.gradle'), 'utf8');
    for (const name of await fromNpm()) {
      assert.ok(gradle.includes(`@capacitor/${name.toLowerCase()}/android`),
        `${name} is called by the app and not linked into Android`);
    }
  });

  test('and iOS links every npm one of them', async () => {
    // The check that was missing. iOS had App, Filesystem and Share; the app
    // also calls Browser and Geolocation, and had done since Phase 15.
    const swift = await readFile(join(ROOT, 'ios', 'App', 'CapApp-SPM', 'Package.swift'), 'utf8');
    for (const name of await fromNpm()) {
      assert.ok(swift.includes(`Capacitor${name}`),
        `${name} is called by the app and not linked into iOS`);
    }
  });

  test('the first-party plugin is registered by hand, since no package lists it', async () => {
    const main = await readFile(
      join(ROOT, 'android/app/src/main/java/com/familyos/app/MainActivity.java'), 'utf8');
    for (const name of FIRST_PARTY) {
      assert.ok(main.includes(`registerPlugin(${name}Plugin.class)`),
        `${name} is called by the app and registered nowhere`);
    }
  });

  test('and iOS is expected to have none of them', async () => {
    // Stated rather than skipped. A reader who finds SmsInbox missing from
    // the iOS project should find out here that it is a platform limit, not
    // the same drift that left Browser and Geolocation behind.
    const swift = await readFile(join(ROOT, 'ios', 'App', 'CapApp-SPM', 'Package.swift'), 'utf8');
    for (const name of FIRST_PARTY) {
      assert.equal(new RegExp(name, 'i').test(swift), false, `${name} on iOS`);
    }
  });

  test('and the two platforms link the same set as each other', async () => {
    // Read off both files rather than compared to a third list here, so this
    // cannot pass because somebody updated the test.
    const gradle = await readFile(join(ROOT, 'android', 'capacitor.settings.gradle'), 'utf8');
    const swift = await readFile(join(ROOT, 'ios', 'App', 'CapApp-SPM', 'Package.swift'), 'utf8');
    const onAndroid = [...gradle.matchAll(/@capacitor\/([a-z]+)\/android/g)].map((m) => m[1]).sort();
    const onIos = [...swift.matchAll(/\.package\(name: "Capacitor([A-Za-z]+)"/g)]
      .map((m) => m[1].toLowerCase()).sort();
    assert.deep(onIos, onAndroid);
  });

  test('both native projects are actually present', async () => {
    // The first version of this asserted the keys of a constant declared four
    // lines above it, which is a check that cannot fail. This reads the disk.
    for (const [path, what] of [
      ['android/app/build.gradle', 'the Android module'],
      ['ios/App/App.xcodeproj/project.pbxproj', 'the Xcode project'],
      ['ios/App/CapApp-SPM/Package.swift', "iOS's plugin package"],
    ]) {
      const text = await readFile(join(ROOT, path), 'utf8').catch(() => null);
      assert.ok(text, `${what} is missing (${path})`);
    }
  });
});

describe('what iOS has to declare before it may ask for a location', () => {
  const plist = () => readFile(join(ROOT, 'ios', 'App', 'App', 'Info.plist'), 'utf8');

  test('a usage description exists, or iOS terminates the app', async () => {
    // Not a warning and not a denied prompt: iOS kills the process on a
    // location request with no `NSLocationWhenInUseUsageDescription`. Both
    // paths need it — the Geolocation plugin and the WebView fallback in
    // `js/core/position.js`.
    const xml = await plist();
    assert.ok(/<key>NSLocationWhenInUseUsageDescription<\/key>/.test(xml),
      'iOS will terminate the app the first time it asks for a position');
  });

  test('and it says the position is never read in the background', async () => {
    const xml = await plist();
    const value = /<key>NSLocationWhenInUseUsageDescription<\/key>\s*<string>([^<]*)<\/string>/
      .exec(xml)?.[1] ?? '';
    assert.ok(/background/i.test(value),
      'the string a person reads should say what the app will not do');
    assert.ok(value.length > 60, 'a usage description is read by a person, not a linter');
  });

  test('and the always-on variant is absent, like ACCESS_BACKGROUND_LOCATION', async () => {
    // The iOS half of a rule the Android manifest already keeps, enforced
    // there by its own test: FamilyOS reads a position only while somebody
    // has the app open and asks it to. Declaring the always key would be
    // asking for a capability the application does not have.
    const xml = await plist();
    assert.equal(/<key>NSLocationAlwaysAndWhenInUseUsageDescription<\/key>/.test(xml), false,
      'background location is deliberately not built, so it must not be requested');
    assert.equal(/<key>NSLocationAlwaysUsageDescription<\/key>/.test(xml), false);
  });
});

describe('what the recents switcher is allowed to keep', () => {
  const activity = () => readFile(
    join(ROOT, 'android/app/src/main/java/com/familyos/app/MainActivity.java'), 'utf8');

  /**
   * The file with its comments taken out.
   *
   * The lifecycle check below reads for the *absence* of `onPause`, and the
   * comment beside the flag argues about onPause by name — so against the
   * raw text it failed on correct code, which is the same defect as passing
   * on wrong code.
   */
  const code = async () => (await activity())
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');

  test('the window is FLAG_SECURE, so the switcher thumbnail is blank', async () => {
    const java = await activity();
    assert.ok(/setFlags\(\s*WindowManager\.LayoutParams\.FLAG_SECURE\s*,\s*WindowManager\.LayoutParams\.FLAG_SECURE\s*\)/
      .test(java),
    'without it Android keeps a photograph of whatever was on screen when the app was backgrounded');
    assert.ok(/^import android\.view\.WindowManager;$/m.test(java),
      'the constant has to be imported or the APK build is the first to know');
  });

  test('and it is set for the window, not toggled around the lifecycle', async () => {
    // The toggle — set in onPause, clear in onResume — leaves deliberate
    // screenshots working, and depends on the flag landing before Android
    // takes its snapshot. That timing varies by OEM and version and cannot
    // be tested from a build machine, so the app does not rely on it. If
    // somebody adds the toggle later, this is where the argument is.
    const java = await code();
    assert.not(/onPause|onResume|clearFlags/.test(java),
      'a lifecycle toggle is a protection resting on a race nobody here can test');
  });

  test('and the flag is set inside onCreate, where the window exists', async () => {
    // `getWindow()` is null before the activity is attached. Setting the
    // flag from a field initialiser or the constructor throws on launch —
    // which the APK job would catch, but only after a build.
    const java = await code();
    const onCreate = /void onCreate\([^)]*\)\s*\{([\s\S]*?)\n    \}/.exec(java)?.[1] ?? '';
    assert.ok(onCreate.length > 0, 'onCreate not found — this test is reading the wrong shape');
    assert.ok(/FLAG_SECURE/.test(onCreate), 'the flag is set outside onCreate');
    assert.ok(onCreate.indexOf('super.onCreate') < onCreate.indexOf('FLAG_SECURE'),
      'set it after super.onCreate, which is where Capacitor builds the window');
  });
});
