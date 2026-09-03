/**
 * What a vehicle actually does to a litre — Phase 10's fuel intelligence.
 *
 * A household already records the litres and whether the tank was filled.
 * Nothing read either: `fuelLog.litres` and `fuelLog.fullTank` were both on
 * the field-coverage inventory as stored and never used. Only `amount` was
 * summed, into a cost report. So the two fields that make mileage computable
 * were being collected and thrown away.
 *
 * ## Why a single fill-up says nothing
 *
 * The obvious calculation is `distance ÷ litres` on one row, and it is
 * meaningless: the litres that went in at a fill-up are what the tank took
 * *afterwards*, not what was burned getting there. The odometer at one fill
 * with no earlier reading has no distance attached to it at all.
 *
 * ## A stretch runs from one full tank to the next
 *
 * With a full tank at both ends, the fuel burned over the distance between
 * them is exactly the fuel put in *after* the first one — because the tank
 * started full and ended full. That is the whole trick, and it is why
 * `fullTank` matters more than any other field here.
 *
 * Partial fills inside the stretch are counted, since their fuel was burned
 * too. Partial fills at the *ends* are not usable, because a tank that was not
 * filled has an unknown amount left in it.
 *
 * ## What it refuses
 *
 * **Fewer than two full tanks.** There is no stretch, so there is no figure.
 *
 * **A fill in the stretch with no litres recorded.** The total would be short
 * by an unknown amount and the mileage would come out flatteringly high.
 *
 * **An odometer that is missing, or that does not move forward.** A reading
 * that goes backwards is a replaced instrument or a typing error, and neither
 * is a distance.
 *
 * ## A missed entry inflates a stretch, and cannot be detected
 *
 * If a household forgets to record a fill-up, the stretch spans two tanks of
 * fuel while counting one, and the mileage comes out roughly twice what it
 * should be. Nothing here can tell that from a genuinely economical stretch.
 *
 * So every stretch is reported individually rather than only as a total: an
 * outlier is visible to somebody who knows their own car, which is better than
 * a single averaged number that hides it. This is stated on the screen rather
 * than only here.
 */

const plain = (value) => String(value ?? '').trim();
const number = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null);

export const WHY = Object.freeze({
  NO_FULL_TANKS: 'mileage needs two full tanks to measure between, and there '
    + 'are fewer than two recorded',
  MISSING_LITRES: 'a fill-up in this stretch has no litres recorded, so the '
    + 'fuel used cannot be totalled',
  NO_ODOMETER: 'a full tank in this stretch has no odometer reading, so there '
    + 'is no distance',
  BACKWARDS: 'the odometer goes backwards across this stretch, which is a '
    + 'replaced instrument or a typing error rather than a distance',
  NO_DISTANCE: 'the odometer did not move between these two fills',
});

/**
 * Fills for one vehicle, oldest first, ignoring deleted rows.
 *
 * @param {string} vehicleId
 * @param {readonly any[]} [logs]
 */
export function fillsFor(vehicleId, logs = []) {
  return logs
    .filter((row) => row && !row.deletedAt && plain(row.vehicle) === plain(vehicleId))
    .slice()
    .sort((a, b) => (plain(a.date) < plain(b.date) ? -1
      : plain(a.date) > plain(b.date) ? 1
        : (number(a.odometer) ?? 0) - (number(b.odometer) ?? 0)));
}

/**
 * Every measurable stretch between consecutive full tanks, and every one that
 * could not be measured with the reason.
 */
/** @param {readonly any[]} [fills] */
export function stretches(fills = []) {
  const anchors = [];
  fills.forEach((fill, index) => {
    if (fill.fullTank) anchors.push(index);
  });

  if (anchors.length < 2) {
    return { measured: [], skipped: [], why: WHY.NO_FULL_TANKS };
  }

  /** @type {any[]} */ const measured = [];
  /** @type {any[]} */ const skipped = [];

  for (let i = 0; i < anchors.length - 1; i += 1) {
    const from = fills[anchors[i]];
    const to = fills[anchors[i + 1]];
    // Everything put in after the first full tank, up to and including the
    // second. The tank started full and ended full, so this is what burned.
    const inside = fills.slice(anchors[i] + 1, anchors[i + 1] + 1);

    const startOdo = number(from.odometer);
    const endOdo = number(to.odometer);
    const at = { from: plain(from.date), to: plain(to.date), fills: inside.length };

    if (startOdo === null || endOdo === null) {
      skipped.push({ ...at, why: WHY.NO_ODOMETER });
      continue;
    }
    if (endOdo < startOdo) {
      skipped.push({ ...at, why: WHY.BACKWARDS });
      continue;
    }
    if (endOdo === startOdo) {
      skipped.push({ ...at, why: WHY.NO_DISTANCE });
      continue;
    }
    if (inside.some((fill) => number(fill.litres) === null || number(fill.litres) <= 0)) {
      skipped.push({ ...at, why: WHY.MISSING_LITRES });
      continue;
    }

    const litres = inside.reduce((total, fill) => total + number(fill.litres), 0);
    const distance = endOdo - startOdo;
    measured.push({
      ...at,
      distance,
      litres: Math.round(litres * 100) / 100,
      kmPerLitre: Math.round((distance / litres) * 100) / 100,
      cost: inside.reduce((total, fill) => total + (number(fill.amount) ?? 0), 0),
    });
  }

  // When nothing was measured, report *why*. Two cases:
  //
  //   - Fewer than two full tanks ever → `NO_FULL_TANKS` (caught by the early
  //     return above, so `skipped` is empty here).
  //   - Full tanks exist but every stretch was refused → the refusal tells the
  //     household what to fix (e.g. "the odometer goes backwards"). Using
  //     `NO_FULL_TANKS` in this case would be literally false — they did record
  //     full tanks — and the fix it implies (record more fills) would change
  //     nothing.
  const firstRefusal = skipped.length ? skipped[0].why : null;
  return { measured, skipped, why: measured.length ? null : (firstRefusal ?? WHY.NO_FULL_TANKS) };
}

/**
 * One vehicle's mileage.
 *
 * The overall figure is **total distance over total fuel**, not the mean of
 * the per-stretch figures. Here that is the right rule and in
 * `domain/profile.js` the opposite one is: these stretches are measurements of
 * a single physical quantity, so pooling the litres and the kilometres answers
 * the question directly, while averaging ratios would let a short stretch
 * count as much as a long one. A household's completion figure averages
 * because each person is a separate subject; a car is not several cars.
 *
 * @param {string} vehicleId
 * @param {readonly any[]} [logs]
 */
export function mileage(vehicleId, logs = []) {
  const fills = fillsFor(vehicleId, logs);
  const { measured, skipped, why } = stretches(fills);

  if (!measured.length) {
    return {
      vehicle: vehicleId,
      fills: fills.length,
      kmPerLitre: null,
      distance: 0,
      litres: 0,
      stretches: [],
      skipped,
      why: why ?? WHY.NO_FULL_TANKS,
    };
  }

  const distance = measured.reduce((total, one) => total + one.distance, 0);
  const litres = measured.reduce((total, one) => total + one.litres, 0);

  return {
    vehicle: vehicleId,
    fills: fills.length,
    kmPerLitre: Math.round((distance / litres) * 100) / 100,
    distance,
    litres: Math.round(litres * 100) / 100,
    cost: measured.reduce((total, one) => total + one.cost, 0),
    stretches: measured,
    skipped,
    why: null,
  };
}

/** The sentence under the figure. */
export function describeMileage(result, money = (n) => String(n)) {
  if (result.kmPerLitre === null) return `No mileage yet — ${result.why}.`;

  const parts = [
    `${result.kmPerLitre} km/l`,
    `over ${result.distance} km on ${result.litres} litres`,
    `${result.stretches.length} ${result.stretches.length === 1 ? 'stretch' : 'stretches'}`,
  ];
  if (result.cost) parts.push(money(result.cost));
  if (result.skipped.length) {
    parts.push(`${result.skipped.length} not measurable`);
  }
  return parts.join(' · ');
}
