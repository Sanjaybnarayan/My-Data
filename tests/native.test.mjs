import { test, describe, assert, setSuite } from './harness.mjs';
import { isNative, platform, plugin, forgetPlugins } from '../js/core/native.js';
import { precachedPaths, missingFrom, SHIPPED } from '../tools/webroot.mjs';
import { readFile } from 'node:fs/promises';
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
