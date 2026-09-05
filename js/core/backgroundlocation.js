/**
 * The location trail: recording where a phone is while nobody is looking.
 *
 * ## This reverses what this application used to promise
 *
 * Until this module existed, `js/core/position.js`, `docs/LOCATION.md` and the
 * Safety screen all said the same thing: a position is read only while
 * somebody has the app open and asks for one, and nothing is recorded while a
 * phone is in a pocket. That was true and it was enforced — a test failed if
 * `ACCESS_BACKGROUND_LOCATION` ever appeared in the manifest.
 *
 * The household asked for the opposite, so the permission is declared, the
 * service is written, and **every sentence that promised otherwise was
 * rewritten in the same change**. A capability added while the copy still
 * denies it is worse than either state on its own.
 *
 * ## What is still true
 *
 * **Off unless somebody turns it on.** Nothing starts at boot, nothing starts
 * on launch, and `start()` refuses without the grants rather than recording
 * foreground-only and calling it a trail.
 *
 * **Visible while it runs.** Android requires a foreground-service
 * notification and this does not try to hide it. A recorder nobody can see is
 * the thing the original refusal was protecting against, and the notification
 * is what is left of that protection.
 *
 * **Never verified on a device.** This has never run on a phone. It compiles;
 * that is a different claim, and `docs/PHASE_STATUS.md` says which is which.
 */

import { plugin as nativePlugin } from './native.js';

/**
 * Why the trail cannot run, in the order a person would fix them.
 *
 * Keys, not sentences. These were `t(...)` calls, which run **once when this
 * module is imported** and keep whatever language was active then — the trap
 * `js/modules/finance.js` and `js/modules/calendar.js` both document, and both
 * had to be repaired for. `Object.freeze` made it worse by advertising the
 * result as settled.
 *
 * `js/core/position.js` and `js/core/smsinbox.js`, in this same directory, had
 * it right all along: a plain identifier here, and `t()` where it is drawn.
 */
export const BLOCKED = Object.freeze({
  UNSUPPORTED: 'trail.blocked.unsupported',
  FOREGROUND: 'trail.blocked.foreground',
  BACKGROUND: 'trail.blocked.background',
  NOTIFICATIONS: 'trail.blocked.notifications',
});

const bridge = (plugin = nativePlugin) => plugin?.('BackgroundLocation');

/** Whether this build can record a trail at all. */
export function available(plugin = nativePlugin) {
  return Boolean(bridge(plugin));
}

/**
 * What the phone will allow and what is running.
 *
 * @returns {Promise<{supported: boolean, foreground: boolean, background: boolean,
 *   notifications: boolean, running: boolean, pending: number, canRun: boolean,
 *   blocked: string|null}>}
 */
export async function status(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) {
    return {
      supported: false,
      foreground: false,
      background: false,
      notifications: false,
      running: false,
      pending: 0,
      canRun: false,
      blocked: BLOCKED.UNSUPPORTED,
    };
  }

  const said = await native.status().catch(() => null);
  if (!said) {
    return {
      supported: true,
      foreground: false,
      background: false,
      notifications: false,
      running: false,
      pending: 0,
      canRun: false,
      blocked: BLOCKED.UNSUPPORTED,
    };
  }

  return {
    supported: true,
    foreground: Boolean(said.foreground),
    background: Boolean(said.background),
    notifications: Boolean(said.notifications),
    running: Boolean(said.running),
    pending: Number(said.pending ?? 0),
    canRun: Boolean(said.canRun),
    blocked: reasonFor(said),
  };
}

/**
 * The first thing standing in the way, or null.
 *
 * Ordered rather than collected: a person told three things are wrong fixes
 * none of them. The foreground grant is asked for first because the
 * background one cannot be granted without it.
 */
export function reasonFor(said) {
  if (!said?.foreground) return BLOCKED.FOREGROUND;
  if (!said?.background) return BLOCKED.BACKGROUND;
  if (!said?.notifications) return BLOCKED.NOTIFICATIONS;
  return null;
}

/** Ask for the grants a prompt can actually obtain. */
export async function requestForeground(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return { ok: false, why: BLOCKED.UNSUPPORTED };
  await native.requestForeground().catch(() => null);
  return { ok: true, why: null };
}

/**
 * Open the settings page where "Allow all the time" lives.
 *
 * Not a permission request, and the difference matters: Android 11+ will not
 * grant background location from a prompt at all, and a call that asked for
 * it would come back denied without the person seeing anything.
 */
export async function openSettings(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return false;
  await native.openSettings().catch(() => null);
  return true;
}

/** Start recording. Refuses unless everything it needs is granted. */
export async function start(plugin = nativePlugin) {
  const state = await status(plugin);
  if (!state.canRun) return { ok: false, why: state.blocked ?? BLOCKED.UNSUPPORTED };
  await bridge(plugin).start();
  return { ok: true, why: null };
}

export async function stop(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return { ok: false, why: BLOCKED.UNSUPPORTED };
  await native.stop().catch(() => null);
  return { ok: true, why: null };
}

/**
 * Take what the service recorded, in the shape `domain/geo.js` already reads.
 *
 * The service holds fixes in memory and hands them over here; this is where
 * they cross into the encrypted store. Anything the service still held when
 * the process died is gone, which is the price of not writing a second,
 * unencrypted copy of a household's movements to disk.
 */
export async function drain(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return [];
  const said = await native.drain().catch(() => null);
  return (said?.fixes ?? [])
    .filter((fix) => Number.isFinite(fix?.latitude) && Number.isFinite(fix?.longitude))
    .map((fix) => ({
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: Number.isFinite(fix.accuracy) ? fix.accuracy : null,
      at: new Date(fix.at ?? Date.now()).toISOString(),
      source: 'trail',
    }));
}
