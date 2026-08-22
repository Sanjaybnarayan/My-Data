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

  test('and does not ask for background location', async () => {
    // The one that matters. Adding this line is a small edit and a different
    // application: it needs a foreground service, a persistent notification
    // and a Play policy declaration, and it turns something a family opens
    // into something that watches them. docs/LOCATION.md, the Safety screen
    // and js/core/position.js all state it is absent. This is what makes that
    // true rather than merely written down.
    const xml = await manifest();
    assert.not(asks(xml, 'ACCESS_BACKGROUND_LOCATION'),
      'background location was added — three documents and a screen say this '
      + 'application does not do that. Change them first, or remove the line.');
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
