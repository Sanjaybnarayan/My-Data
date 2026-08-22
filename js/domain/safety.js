/**
 * Where people were, what that is worth knowing, and when to forget it.
 *
 * `domain/geo.js` decides whether one fix is inside one circle. This decides
 * what a household should be told from a series of them — which is a different
 * question, and the place where a location feature usually starts lying.
 *
 * ## Three refusals, and they are the file
 *
 * **A position has an age, and an old one is not an answer.** "Asha is at
 * school" from a reading taken nine hours ago is a false statement dressed as
 * a current one. Nothing here returns a position without returning how old it
 * is, and `lastKnown` reports staleness rather than leaving a screen to work
 * it out and forget to.
 *
 * **A gap is not a movement.** There is no background capture — a reading
 * happens when somebody opens the application — so consecutive readings can be
 * hours apart. Two readings either side of a gap say nothing about the route
 * between them, and `transitions` marks a crossing it cannot vouch for rather
 * than reporting "left school" as though somebody watched them go.
 *
 * **An uncertain fix decides nothing.** `WHERE.UNCERTAIN` propagates. A
 * transition is only reported between two readings that were each decidable,
 * because "arrived" computed from a 2 km fix is an invented event about a
 * child.
 */

import { WHERE, placeAgainst, zoneFor } from './geo.js';
import { t } from '../core/locale.js';

/** How long a reading stays worth quoting, in minutes. */
export const FRESH_MINUTES = 15;
/** Past this, a reading is history rather than an answer. */
export const STALE_MINUTES = 120;

/** How long a location history is kept. */
export const RETAIN_DAYS = 30;

export const FRESHNESS = Object.freeze({
  FRESH: 'fresh',
  AGEING: 'ageing',
  STALE: 'stale',
});

export const CROSSING = Object.freeze({
  ARRIVED: 'arrived',
  LEFT: 'left',
});

const MINUTE = 60_000;
const DAY = 86_400_000;

const at = (row) => Date.parse(row?.recordedAt ?? '');

/** Readings for one person, oldest first, unusable rows dropped. */
export function readingsFor(pings, personId) {
  return (pings ?? [])
    .filter((p) => p && !p.deletedAt && p.person === personId && Number.isFinite(at(p)))
    .sort((a, b) => at(a) - at(b));
}

/**
 * How old a reading is, and whether it is worth quoting.
 *
 * Returned rather than compared inline, so that every screen showing a
 * position shows the same judgement about it.
 */
export function freshness(ping, now = Date.now()) {
  const taken = at(ping);
  if (!Number.isFinite(taken)) return { minutes: null, state: FRESHNESS.STALE };
  const minutes = Math.max(0, Math.round((now - taken) / MINUTE));
  if (minutes <= FRESH_MINUTES) return { minutes, state: FRESHNESS.FRESH };
  if (minutes <= STALE_MINUTES) return { minutes, state: FRESHNESS.AGEING };
  return { minutes, state: FRESHNESS.STALE };
}

/**
 * The most recent reading for a person, with its age attached.
 *
 * Null when there is none — which is the common case and not an error. A
 * household member who has never opened the application has no position, and
 * that is different from being nowhere.
 */
export function lastKnown(pings, personId, { now = Date.now(), zones = [] } = {}) {
  const rows = readingsFor(pings, personId);
  const latest = rows.at(-1);
  if (!latest) return null;

  return {
    ping: latest,
    ...freshness(latest, now),
    // Recomputed rather than trusted: the stored `zone` was resolved when the
    // row was written, and a zone can be moved or its radius changed since.
    zone: zoneFor(latest, zones),
  };
}

/**
 * Zone crossings, from one person's readings.
 *
 * Only between consecutive readings that were both decidable, and each is
 * marked with whether the gap before it was long enough that nobody can say
 * when the crossing actually happened.
 */
/**
 * @param {object[]} pings
 * @param {object[]} zones
 * @param {{personId?: string|null, gapMinutes?: number}} [options]
 */
export function transitions(pings, zones, { personId = null, gapMinutes = STALE_MINUTES } = {}) {
  const rows = personId ? readingsFor(pings, personId) : (pings ?? []);
  const out = [];

  for (const zone of zones ?? []) {
    // A zone may name who it is about. A school watching the children should
    // not report a parent arriving to collect them — that is noise, and a
    // feed of noise is a feed nobody reads. An empty list means everybody,
    // because a zone with nobody named is a zone about the household.
    const watching = new Set(zone.watch ?? []);

    let previous = null;
    for (const ping of rows) {
      if (watching.size && !watching.has(ping.person)) continue;
      const where = placeAgainst(ping, zone);
      // An uncertain reading is not a state to compare against — it neither
      // confirms nor breaks the run, so it is skipped entirely.
      if (where === WHERE.UNCERTAIN) continue;

      if (previous && previous.where !== where) {
        const gap = Math.round((at(ping) - at(previous.ping)) / MINUTE);
        out.push({
          zone,
          person: ping.person,
          kind: where === WHERE.INSIDE ? CROSSING.ARRIVED : CROSSING.LEFT,
          at: ping.recordedAt,
          // The crossing happened somewhere between the two readings. When
          // that is hours, saying "arrived at 4pm" would be a guess presented
          // as an observation.
          gapMinutes: gap,
          certain: gap <= gapMinutes,
          after: previous.ping.recordedAt,
        });
      }
      previous = { ping, where };
    }
  }

  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

/**
 * Readings old enough to forget.
 *
 * The household chose to keep a history, and a history with no end is a
 * permanent record of where a family goes. `data/retention.js` cannot do this
 * — it governs how long a *deletion* is held open and never ages out a live
 * row — so the service deletes these on every write, and retention then
 * purges them on the short `location` policy.
 *
 * Returns ids rather than deleting, so the decision is testable without a
 * database and the deleting stays in one place.
 */
export function expired(pings, { now = Date.now(), retainDays = RETAIN_DAYS } = {}) {
  const cutoff = now - (retainDays * DAY);
  return (pings ?? [])
    .filter((p) => p && !p.deletedAt && Number.isFinite(at(p)) && at(p) < cutoff)
    .map((p) => p.id);
}

/** Plain words for a person's whereabouts, or why there are none. */
export function describeLastKnown(known, personName = t('safety.somebody')) {
  if (!known) return t('safety.none', { name: personName });

  const { state, minutes, zone } = known;
  const place = zone ? t('safety.atZone', { zone: zone.name }) : t('safety.awayFromZones');
  const when = minutes === 0 ? t('safety.justNow')
    : minutes < 60 ? t('safety.minutesAgo', { n: minutes })
      : t('safety.hoursAgo', { n: Math.round(minutes / 60) });

  // A stale reading is reported as history, because the alternative is a
  // screen telling somebody where their child is on the strength of a reading
  // from this morning. Whole sentences either way — a language that orders
  // "was at school two hours ago" differently cannot do it from fragments.
  return state === FRESHNESS.STALE
    ? t('safety.seenStale', { name: personName, place, when })
    : t('safety.seen', { name: personName, place, when });
}

/**
 * The message an SOS hands to a phone's own share sheet or dialler.
 *
 * Composed here and sent by a person. Nothing in this application can deliver
 * it — there is no server, no gateway and no push — and an SOS that silently
 * failed to send would be the worst thing this repository could produce.
 */
export function sosMessage(alert, { personName = t('safety.somebody'), zone = null } = {}) {
  const located = Number.isFinite(Number(alert?.latitude))
    && Number.isFinite(Number(alert?.longitude));

  return [
    t('sos.needsHelp', { name: personName }),
    alert?.reason || null,
    alert?.whereabouts || null,
    zone ? t('sos.near', { zone: zone.name }) : null,
    located
      ? t('sos.map', { url: `https://www.google.com/maps?q=${alert.latitude},${alert.longitude}` })
      : t('sos.noPosition'),
    located && Number.isFinite(Number(alert?.accuracyMetres))
      ? t('sos.accuracy', { n: Math.round(Number(alert.accuracyMetres)) })
      : null,
  ].filter(Boolean).join('\n');
}
