/**
 * Distance on a sphere, and whether a fix is inside a circle.
 *
 * ## The thing this file exists to refuse
 *
 * A position has an accuracy, and a zone has a radius, and comparing the two
 * is the whole job. A fix reported as "within 2,000 metres" cannot say whether
 * somebody is inside a 100-metre circle around a school. The centre of that
 * fix may land inside the circle, and a naive `distance < radius` would then
 * report **"arrived at school"** — a specific claim about a child's
 * whereabouts, derived from a measurement that does not support it.
 *
 * So there are three answers here, not two: `INSIDE`, `OUTSIDE`, and
 * `UNCERTAIN`. The third is not a failure. It is the honest reading of a fix
 * too coarse to decide, and every caller has to handle it — which is why it is
 * a state rather than a null.
 *
 * ## Why haversine
 *
 * Zones are hundreds of metres across, not hundreds of kilometres. Haversine
 * on a spherical earth is accurate to about 0.5% at these distances, which is
 * metres over a kilometre — far inside the accuracy of any consumer GPS fix,
 * and therefore not the limiting factor. The ellipsoidal formulae would be
 * more precise about a number whose error is already dominated by the phone.
 */

import { t } from '../core/locale.js';

/** Metres. IUGG mean radius. */
const EARTH_RADIUS = 6_371_008.8;

export const WHERE = Object.freeze({
  INSIDE: 'inside',
  OUTSIDE: 'outside',
  /** The fix is too coarse to place against this zone, either way. */
  UNCERTAIN: 'uncertain',
});

const rad = (deg) => (deg * Math.PI) / 180;

/** Is this a usable pair of coordinates at all? */
export function isPoint(p) {
  return Boolean(p)
    && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)
    && Math.abs(p.latitude) <= 90 && Math.abs(p.longitude) <= 180;
}

/**
 * Great-circle distance in metres, or null when either point is unusable.
 *
 * Null rather than NaN or Infinity: those propagate silently through a
 * comparison and come out the other side as a decision.
 */
export function distanceMetres(a, b) {
  if (!isPoint(a) || !isPoint(b)) return null;

  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);

  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Where a fix sits relative to a zone.
 *
 * `accuracyMetres` is the radius of the circle the device says the true
 * position is somewhere within. The fix decides the zone only when that circle
 * lies wholly inside or wholly outside it:
 *
 *     inside    distance + accuracy <= radius
 *     outside   distance - accuracy >  radius
 *     otherwise the two circles overlap, and nothing can be said
 *
 * A missing accuracy is treated as unusable rather than as zero. A device that
 * did not say how sure it is has not said it is certain.
 */
export function placeAgainst(fix, zone) {
  if (!isPoint(fix) || !isPoint(zone)) return WHERE.UNCERTAIN;

  const radius = Number(zone.radiusMetres);
  // A zone with no radius is not a circle, and treating a missing radius as
  // zero would put everybody permanently outside it.
  if (!Number.isFinite(radius) || radius <= 0) return WHERE.UNCERTAIN;

  // `Number(null)` is 0 and `Number(undefined)` is NaN, so a null accuracy
  // read through `Number` alone becomes *perfect certainty* — the precise
  // opposite of what a missing value says, and the one direction this must
  // never fail. Caught by the test that asserts it, having been written wrong
  // first.
  if (fix.accuracyMetres === null || fix.accuracyMetres === undefined) return WHERE.UNCERTAIN;
  const accuracy = Number(fix.accuracyMetres);
  if (!Number.isFinite(accuracy) || accuracy < 0) return WHERE.UNCERTAIN;

  const distance = distanceMetres(fix, zone);
  if (distance === null) return WHERE.UNCERTAIN;

  if (distance + accuracy <= radius) return WHERE.INSIDE;
  if (distance - accuracy > radius) return WHERE.OUTSIDE;
  return WHERE.UNCERTAIN;
}

/**
 * The zone a fix is inside, if exactly one is decidable.
 *
 * Zones may overlap — a school inside a neighbourhood — so the smallest
 * matching one wins: it is the more specific statement, and "at school" is
 * more useful than "in Indiranagar" when both are true.
 *
 * Returns null when nothing is decidably inside, which reads the same as
 * "outside everything" and is deliberately not distinguished here. What was
 * uncertain is reported by `placements`, for a caller that needs to say why.
 */
export function zoneFor(fix, zones) {
  let best = null;
  for (const zone of zones ?? []) {
    if (placeAgainst(fix, zone) !== WHERE.INSIDE) continue;
    if (!best || Number(zone.radiusMetres) < Number(best.radiusMetres)) best = zone;
  }
  return best;
}

/** Every zone with where the fix sits against it, for a screen that explains. */
export function placements(fix, zones) {
  return (zones ?? []).map((zone) => ({
    zone,
    where: placeAgainst(fix, zone),
    metres: distanceMetres(fix, zone),
  }));
}

/**
 * What a coarse fix should say for itself.
 *
 * Used where a screen would otherwise print a position as though it were a
 * point. `null` when the fix is precise enough that the caveat would be noise.
 */
export function describeAccuracy(fix, { coarseAbove = 100 } = {}) {
  if (fix?.accuracyMetres === null || fix?.accuracyMetres === undefined) return t('accuracy.unstated');
  const accuracy = Number(fix.accuracyMetres);
  if (!Number.isFinite(accuracy) || accuracy < 0) return t('accuracy.unstated');
  if (accuracy <= coarseAbove) return null;
  return accuracy >= 1000
    ? t('accuracy.kilometres', { n: (accuracy / 1000).toFixed(1) })
    : t('accuracy.metres', { n: Math.round(accuracy) });
}
