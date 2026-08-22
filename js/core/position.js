/**
 * Reading where this device is.
 *
 * ## What this can and cannot do, decided before anything was built
 *
 * `navigator.geolocation.getCurrentPosition` asks the operating system once,
 * while the application is open and in front of somebody. That is the whole of
 * the capability here, and everything in Phase 15 is built on top of it.
 *
 * **There is no background location.** Not "not yet" — a web page and a
 * Capacitor WebView with no foreground service are both suspended when the
 * screen goes off, and a suspended page does not report anything. A safe-zone
 * alert that fires while the phone is in a pocket needs a native service,
 * which needs `@capacitor/geolocation`, a foreground-service notification, and
 * on Android 10+ a separate `ACCESS_BACKGROUND_LOCATION` grant with a Play
 * policy declaration attached to it. None of that is in this repository, and
 * `docs/LOCATION.md` says so rather than leaving somebody to discover it.
 *
 * **There is no OS geofencing.** A real geofence is registered with the
 * platform and wakes the app on a crossing. What this does instead is compare
 * a position it was given against circles it knows about — the same arithmetic
 * with none of the wake-ups. `domain/geo.js` does the comparing; nothing here
 * or there is registered with anything.
 *
 * So a position exists only when somebody opens the application and it is
 * asked for. Every screen that shows one shows when it was taken, because a
 * location with no timestamp reads as *now* and this one frequently is not.
 *
 * ## The permission
 *
 * Asking is the same call as reading, and the browser decides whether to
 * prompt. A refusal is a normal answer rather than an error: `read()` returns
 * a reason, and the reasons are separated because "you said no" and "the
 * device could not get a fix" need different sentences on a screen.
 */

import { t } from './locale.js';
import { plugin as nativePlugin } from './native.js';

export const DENIED = 'denied';
export const UNAVAILABLE = 'unavailable';
export const TIMED_OUT = 'timedOut';
export const UNSUPPORTED = 'unsupported';

/** How long to wait for a fix before giving up. */
const TIMEOUT_MS = 15_000;

/**
 * The device's position, or why not.
 *
 * `geolocation` is injected so this is testable without a browser and without
 * a real position — every test in `tests/location.test.mjs` supplies its own.
 *
 * `plugin` is injected for the same reason `geolocation` is: the native path
 * has to be exercised without a phone, and a test supplies its own.
 *
 * @param {{geolocation?: object, timeoutMs?: number, clock?: () => number,
 *          plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<{ok: boolean, fix?: object, why?: string}>}
 */
export async function read({
  geolocation = globalThis.navigator?.geolocation,
  timeoutMs = TIMEOUT_MS,
  clock = Date.now,
  plugin = nativePlugin,
} = {}) {
  // Inside the app, the plugin. `navigator.geolocation` exists in a Capacitor
  // WebView and looks like it should work, which is the trap: the WebView asks
  // the *activity* for permission through `onGeolocationPermissionsShowPrompt`,
  // and with no Android runtime permission behind it the prompt is answered no
  // before a person sees it. The plugin owns the runtime grant, so it is what
  // gets asked.
  const native = plugin?.('Geolocation');
  if (native) return readNative(native, { timeoutMs, clock });

  if (!geolocation?.getCurrentPosition) return { ok: false, why: UNSUPPORTED };

  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    geolocation.getCurrentPosition(
      (position) => done({ ok: true, fix: fromPosition(position, clock) }),
      (error) => done({ ok: false, why: reasonFor(error) }),
      // `maximumAge: 0` on purpose. A cached fix from an hour ago answered
      // instantly is the worst possible result: it looks live and is not, and
      // the screen would date it from the moment it was handed over.
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * The same question, asked of the native plugin.
 *
 * Permission is checked before the position is asked for, so a refusal is
 * `DENIED` on the strength of the permission state rather than of a parsed
 * error message. The plugin's failures below that are strings, and strings are
 * matched loosely and fall back to `UNAVAILABLE` — a wrong *reason* puts a
 * slightly wrong sentence on a screen, where a wrong `ok` would put a position
 * there that does not exist.
 */
async function readNative(geolocation, { timeoutMs, clock }) {
  try {
    let state = await geolocation.checkPermissions();
    if (state?.location !== 'granted') {
      state = await geolocation.requestPermissions({ permissions: ['location'] });
    }
    if (state?.location !== 'granted') return { ok: false, why: DENIED };

    const position = await geolocation.getCurrentPosition({
      enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0,
    });
    return { ok: true, fix: fromPosition(position, clock) };
  } catch (error) {
    const message = String(error?.message ?? '').toLowerCase();
    if (/denied|permission/.test(message)) return { ok: false, why: DENIED };
    if (/time|timeout/.test(message)) return { ok: false, why: TIMED_OUT };
    return { ok: false, why: UNAVAILABLE };
  }
}

/**
 * A `GeolocationPosition` in this application's shape.
 *
 * One function for both sources: the Capacitor plugin returns the web shape
 * deliberately, so a second reader would be a second thing to keep in step
 * with no second shape to justify it.
 */
export function fromPosition(position, clock = Date.now) {
  const c = position?.coords ?? {};
  return {
    latitude: Number(c.latitude),
    longitude: Number(c.longitude),
    // Kept, and kept named. The browser's `accuracy` is a radius in metres at
    // 95% confidence, and every decision downstream depends on it being here.
    accuracyMetres: Number.isFinite(Number(c.accuracy)) ? Number(c.accuracy) : null,
    recordedAt: new Date(position?.timestamp ?? clock()).toISOString(),
  };
}

function reasonFor(error) {
  // The numbers are the spec's, and are stable across browsers. Named rather
  // than compared inline so a reader can see which is which.
  const PERMISSION_DENIED = 1;
  const POSITION_UNAVAILABLE = 2;
  const TIMEOUT = 3;
  switch (error?.code) {
    case PERMISSION_DENIED: return DENIED;
    case POSITION_UNAVAILABLE: return UNAVAILABLE;
    case TIMEOUT: return TIMED_OUT;
    default: return UNAVAILABLE;
  }
}

/** What to put on a screen when a reading did not happen. */
export function describeRefusal(why) {
  switch (why) {
    case DENIED: return t('position.denied');
    case UNAVAILABLE: return t('position.unavailable');
    case TIMED_OUT: return t('position.timedOut');
    case UNSUPPORTED: return t('position.unsupported');
    default: return t('position.unknown');
  }
}
