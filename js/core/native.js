/**
 * The native shell, when there is one.
 *
 * FamilyOS runs in three places: a browser tab, an installed PWA, and — since
 * Capacitor — an Android or iOS application. The first two are the same
 * environment. The third is a WebView, which is *nearly* the same and differs
 * in a handful of places that matter.
 *
 * This module is the only part of the application that knows Capacitor exists.
 * Everything else asks it a question and gets `null` in a browser.
 *
 * ## Why nothing is imported
 *
 * The application ships as native ES modules with no bundler, so it cannot
 * `import { Filesystem } from '@capacitor/filesystem'` — a bare specifier is
 * not a URL and a browser will not resolve one. Adding a bundler to reach a
 * plugin would mean adding a build step to a codebase whose whole shape is not
 * having one.
 *
 * It does not need to. Reading `@capacitor/core`'s bridge shows that
 * `Capacitor.registerPlugin(name)` returns a proxy whose methods dispatch
 * straight to the native implementation, discovered through `PluginHeaders`
 * that the native runtime injects. The npm packages are still installed —
 * `npx cap sync` reads `package.json` to decide which native sources to add to
 * the Android and iOS projects — but not one byte of them reaches the browser.
 *
 * The consequence worth stating: in a browser this module's every export is
 * false or null, and the code that calls it takes exactly the path it took
 * before Capacitor was ever installed.
 */

/** Running inside the Android or iOS shell, rather than a browser. */
export function isNative() {
  try {
    return Boolean(globalThis.Capacitor?.isNativePlatform?.());
  } catch {
    return false;
  }
}

/** `'android'`, `'ios'`, or `'web'` — including for a browser with no bridge. */
export function platform() {
  try {
    return globalThis.Capacitor?.getPlatform?.() ?? 'web';
  } catch {
    return 'web';
  }
}

const proxies = new Map();

/**
 * A native plugin, or `null`.
 *
 * `null` means "take the web path", and it is returned for every reason there
 * could be: a browser, a bridge that does not exist, or a plugin that was not
 * built into this app. A caller that has to distinguish those has a design
 * problem — there is one correct fallback and it is the code that already
 * worked everywhere.
 *
 * `isPluginAvailable` is checked rather than trusted to `registerPlugin`,
 * which happily returns a proxy for a plugin with no native implementation and
 * throws `UNIMPLEMENTED` at the first call — an error at the point of use
 * rather than at the point of decision.
 */
export function plugin(name) {
  if (!isNative()) return null;
  if (proxies.has(name)) return proxies.get(name);

  const bridge = globalThis.Capacitor;
  if (typeof bridge?.registerPlugin !== 'function') return null;
  if (typeof bridge.isPluginAvailable === 'function' && !bridge.isPluginAvailable(name)) {
    proxies.set(name, null);
    return null;
  }

  try {
    const proxy = bridge.registerPlugin(name);
    proxies.set(name, proxy);
    return proxy;
  } catch {
    proxies.set(name, null);
    return null;
  }
}

/** Test seam. Nothing in the application calls this. */
export function forgetPlugins() {
  proxies.clear();
}
