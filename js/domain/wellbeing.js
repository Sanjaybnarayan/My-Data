/**
 * Reading a week of screen time, and refusing to say more than it knows.
 *
 * ## What the device actually hands over
 *
 * A package name and a number of foreground milliseconds, per application,
 * over a window. That is all. Everything on a wellbeing screen has to be built
 * from those two facts or not shown.
 *
 * So there is no category breakdown here — "productivity", "social", "video"
 * are somebody's taxonomy applied to package names, and applying one would
 * mean shipping a list of a few hundred guesses that is wrong for every app it
 * has never heard of. There is no screen time while driving or walking, no
 * loud-listening figure, and no hearing exposure: none of those come from
 * `PACKAGE_USAGE_STATS`, and inventing them from it would be fabrication.
 *
 * ## Why the busiest day is a fact and a daily average is not
 *
 * The window is seven days, but a phone that was off for three of them still
 * reports seven. Dividing by seven produces a number that looks like a habit
 * and is an artefact. The busiest day is a real reading; a mean over days
 * nobody can vouch for is not, so this reports totals and a busiest app and
 * leaves the arithmetic somebody would misread out of it.
 */

/** How a duration is said, given only minutes. */
export function saidAs(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  return { hours: Math.floor(total / 60), minutes: total % 60, total };
}

/**
 * A week of usage, ordered and totalled.
 *
 * @param {{app: string, minutes: number}[]} apps
 * @param {{top?: number}} [options]
 */
export function summarise(apps, { top = 6 } = {}) {
  const rows = (apps ?? [])
    .filter((one) => one?.app && Number(one.minutes) > 0)
    .map((one) => ({ app: String(one.app), minutes: Math.round(Number(one.minutes)) }))
    .sort((a, b) => b.minutes - a.minutes);

  const total = rows.reduce((sum, one) => sum + one.minutes, 0);

  return {
    total,
    /*
     * A share, only where there is something to take a share of.
     *
     * Zero total and a percentage is a division nobody wants to see the
     * result of, and `0/0` on a screen is worse than no bar at all.
     */
    apps: rows.slice(0, top).map((one) => ({
      ...one,
      share: total > 0 ? one.minutes / total : 0,
    })),
    hidden: Math.max(0, rows.length - top),
    busiest: rows[0] ?? null,
  };
}

/**
 * The last segment of a package name, which is the closest thing to a name.
 *
 * `com.whatsapp` becomes `whatsapp`. It is not the label a launcher shows and
 * this does not pretend otherwise — the plugin reports packages, and a screen
 * that displayed an invented friendly name would be guessing at which
 * application a household was looking at.
 */
export function packageTail(name) {
  const parts = String(name ?? '').split('.').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(name ?? '');
}

/**
 * What this screen cannot tell you, named so the screen shows it.
 *
 * Every one of these appears on a phone's own wellbeing page, and a household
 * comparing the two is entitled to know which absences are deliberate.
 */
export const CANNOT_SHOW = Object.freeze([
  'wellbeing.absent.categories',
  'wellbeing.absent.motion',
  'wellbeing.absent.hearing',
  'wellbeing.absent.limits',
]);

/**
 * Why there is no reading, as one of six named cases rather than "unavailable".
 *
 * `ScreenTimeService` already separates what the device allows from what
 * consent allows, and the reason it gives is in `js/services/screentime.js`:
 * collapsing them tells a household "not available" when the truth is "you
 * have not asked them yet", which is a thing they can fix. A screen that
 * printed one sentence for all six would throw that distinction away at the
 * last step.
 *
 * `settings` and `consent` say which control is honest to offer, and they are
 * not the same question. Usage access has no prompt — `openSettings` is the
 * only control that can do anything about it — so an "Allow" button would
 * describe a request Android never makes. And a person who said no is not
 * shown a way to be asked again; their answer stands until they change it
 * where it was recorded.
 */
export const BLOCKED = Object.freeze({
  noPerson: Object.freeze({ key: 'wellbeing.blocked.noPerson', settings: false, consent: false }),
  unasked: Object.freeze({ key: 'wellbeing.blocked.unasked', settings: false, consent: true }),
  refused: Object.freeze({ key: 'wellbeing.blocked.refused', settings: false, consent: false }),
  noPlugin: Object.freeze({ key: 'wellbeing.blocked.noPlugin', settings: false, consent: false }),
  noAccess: Object.freeze({ key: 'wellbeing.blocked.noAccess', settings: true, consent: false }),
  deviceRefused: Object.freeze({
    key: 'wellbeing.blocked.deviceRefused', settings: true, consent: false,
  }),
  unknown: Object.freeze({ key: 'wellbeing.blocked.unknown', settings: false, consent: false }),
});

/**
 * The case, for a state id the service reported.
 *
 * An id this does not recognise falls to `unknown`, which offers no control
 * and claims no cause. Guessing at the most likely one would put a settings
 * button in front of somebody whose phone has nothing to change.
 */
/** @param {string} state the id `ScreenTimeService` reported */
export function whyBlocked(state) {
  return Object.prototype.hasOwnProperty.call(BLOCKED, String(state))
    ? BLOCKED[String(state)]
    : BLOCKED.unknown;
}
