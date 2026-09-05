/**
 * How long applications were used on this phone.
 *
 * The device half only. Whether anybody may *ask* is decided in
 * `js/services/screentime.js`, which will not call this without a recorded
 * consent decision for the person the phone belongs to — see
 * `PURPOSES.screenTime`, the one purpose in that list where "no" stops
 * something rather than merely being noted.
 *
 * Keeping the two apart is deliberate. This module reports what the device
 * will say; it does not know whose phone it is and must not decide.
 *
 * ## Special access, not a runtime permission
 *
 * `PACKAGE_USAGE_STATS` has no prompt. `requestPermissions` for it returns
 * denied without showing anything, so `openSettings()` sends a person to the
 * usage-access page instead. A screen that reported "asked and refused" would
 * be describing a request Android never made.
 */

import { plugin as nativePlugin } from './native.js';

/*
 * Keys, not sentences — see the note on `BLOCKED` in `backgroundlocation.js`.
 * `t()` at module load keeps whatever language was active at import; these are
 * translated where they are drawn.
 */
export const UNSUPPORTED = 'screentime.unsupported';
export const NOT_PERMITTED = 'screentime.notPermitted';

const bridge = (plugin = nativePlugin) => plugin?.('ScreenTime');

export function available(plugin = nativePlugin) {
  return Boolean(bridge(plugin));
}

/** @returns {Promise<{supported: boolean, permitted: boolean, why: string|null}>} */
export async function status(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return { supported: false, permitted: false, why: UNSUPPORTED };
  const said = await native.status().catch(() => null);
  const permitted = Boolean(said?.permitted);
  return { supported: true, permitted, why: permitted ? null : NOT_PERMITTED };
}

export async function openSettings(plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return false;
  await native.openSettings().catch(() => null);
  return true;
}

/**
 * Totals per application over a window.
 *
 * Returns `{ok: false, why}` rather than throwing or returning an empty list:
 * "nobody used anything" and "this phone will not tell you" are different
 * answers, and a screen showing zero for the second would be inventing a
 * finding.
 *
 * @param {{from: number, to?: number}} window epoch milliseconds
 */
export async function usage({ from, to = Date.now() }, plugin = nativePlugin) {
  const native = bridge(plugin);
  if (!native) return { ok: false, why: UNSUPPORTED, apps: [] };

  const said = await native.usage({ from, to }).catch(() => null);
  if (!said) return { ok: false, why: NOT_PERMITTED, apps: [] };

  const apps = (said.apps ?? [])
    .filter((row) => row?.package && Number(row.foregroundMs) > 0)
    .map((row) => ({
      app: String(row.package),
      minutes: Math.round(Number(row.foregroundMs) / 60_000),
      lastUsed: row.lastUsed ? new Date(row.lastUsed).toISOString() : null,
    }))
    .sort((a, b) => b.minutes - a.minutes);

  return { ok: true, why: null, apps, from, to: said.to ?? to };
}
