import { test, describe, assert, setSuite } from './harness.mjs';
import { mileage, stretches, fillsFor, describeMileage, WHY } from '../js/domain/fuel.js';

setSuite('fuel');

const fill = (date, odometer, litres, fullTank, over = {}) => ({
  id: `f-${date}`, vehicle: 'v1', date, odometer, litres, fullTank,
  amount: (litres ?? 0) * 10000, deletedAt: null, ...over,
});

/** Three full tanks, so two measurable stretches. */
const ORDINARY = Object.freeze([
  fill('2026-05-01', 10000, 35, true),
  fill('2026-05-20', 10420, 30, true),
  fill('2026-06-10', 10850, 32, true),
]);

describe('a stretch runs from one full tank to the next', () => {
  test('the fuel counted is what went in after the first full tank', () => {
    // The tank started full and ended full, so that is exactly what burned.
    // 420 km on the 30 litres of the *second* fill, not the 35 of the first.
    const { measured } = stretches(ORDINARY);
    assert.length(measured, 2);
    assert.equal(measured[0].distance, 420);
    assert.equal(measured[0].litres, 30);
    assert.equal(measured[0].kmPerLitre, 14);
  });

  test('a partial fill inside a stretch is counted, because it burned too', () => {
    const withPartial = [
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-10', 10200, 15, false),
      fill('2026-05-20', 10420, 16, true),
    ];
    const [only] = stretches(withPartial).measured;
    assert.equal(only.litres, 31);
    assert.equal(only.distance, 420);
    assert.equal(only.fills, 2);
  });

  test('a single fill-up says nothing at all', () => {
    // The litres that went in are what the tank took afterwards, not what was
    // burned getting there.
    const out = mileage('v1', [fill('2026-05-01', 10000, 35, true)]);
    assert.equal(out.kmPerLitre, null);
    assert.equal(out.why, WHY.NO_FULL_TANKS);
  });

  test('two fills that were never full are not a stretch', () => {
    const out = mileage('v1', [
      fill('2026-05-01', 10000, 35, false),
      fill('2026-05-20', 10420, 30, false),
    ]);
    assert.equal(out.kmPerLitre, null);
  });
});

describe('what it refuses, and says', () => {
  const refusal = (rows) => mileage('v1', rows).skipped[0];

  test('a fill with no litres would flatter the figure', () => {
    const found = refusal([
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-10', 10200, null, false),
      fill('2026-05-20', 10420, 16, true),
    ]);
    assert.equal(found.why, WHY.MISSING_LITRES);
  });

  test('a full tank with no odometer has no distance', () => {
    const found = refusal([
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-20', null, 30, true),
    ]);
    assert.equal(found.why, WHY.NO_ODOMETER);
  });

  test('an odometer that goes backwards is not a distance', () => {
    // A replaced instrument or a typing error, and neither is kilometres.
    const found = refusal([
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-20', 9000, 30, true),
    ]);
    assert.equal(found.why, WHY.BACKWARDS);
  });

  test('an odometer that did not move is refused too', () => {
    const found = refusal([
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-20', 10000, 30, true),
    ]);
    assert.equal(found.why, WHY.NO_DISTANCE);
  });

  test('all stretches skipped names the skip reason, not "no full tanks"', () => {
    // Two full tanks exist, but the odometer goes backwards between them.
    // Before the fix, `stretches()` returned `WHY.NO_FULL_TANKS` because
    // `measured.length === 0` — which was literally false (there ARE two full
    // tanks) and told the household the wrong thing to fix. The correct reason
    // is the backwards odometer; the fix uses the first refusal reason when no
    // stretch was measured.
    const out = mileage('v1', [
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-20', 9000, 30, true),   // backwards odometer
    ]);
    assert.equal(out.kmPerLitre, null);
    assert.equal(out.skipped.length, 1);
    assert.equal(out.why, WHY.BACKWARDS);   // was WHY.NO_FULL_TANKS before fix
  });

  test('describeMileage names the real reason when all stretches are skipped', () => {
    const out = mileage('v1', [
      fill('2026-05-01', 10000, 35, true),
      fill('2026-05-20', 9000, 30, true),
    ]);
    const said = describeMileage(out);
    assert.includes(said, 'No mileage yet');
    assert.includes(said, 'backwards');   // odometer-backwards message, not "two full tanks"
  });

  test('a refused stretch does not stop the measurable ones', () => {
    const mixed = [
      ...ORDINARY,
      fill('2026-07-01', null, 31, true),
      fill('2026-07-20', 11700, 33, true),
    ];
    const out = mileage('v1', mixed);
    assert.ok(out.kmPerLitre > 0);
    assert.ok(out.skipped.length >= 1);
    assert.length(out.stretches, 2);
  });
});

describe('the overall figure', () => {
  test('is total distance over total fuel, not the mean of the ratios', () => {
    // Where stretches are uneven the two disagree sharply: a 40 km stretch on
    // 4 litres and a 1000 km stretch on 50 would average to 15.00 km/l, which
    // lets the short one count as much as the long one.
    const uneven = [
      fill('2026-01-01', 10000, 40, true),
      fill('2026-01-05', 10040, 4, true),
      fill('2026-03-01', 11040, 50, true),
    ];
    const out = mileage('v1', uneven);
    const ratios = out.stretches.map((one) => one.kmPerLitre);
    const meanOfRatios = ratios.reduce((a, b) => a + b, 0) / ratios.length;

    assert.equal(meanOfRatios, 15);
    assert.equal(out.kmPerLitre, 19.26);
    assert.equal(out.distance, 1040);
    assert.equal(out.litres, 54);
  });

  test('every stretch is reported, so a missed entry is visible', () => {
    // A forgotten fill-up makes one stretch span two tanks while counting
    // one, and nothing here can tell that from an economical stretch. The
    // per-stretch list is what lets somebody who knows their car notice.
    const out = mileage('v1', ORDINARY);
    assert.length(out.stretches, 2);
    assert.deep(out.stretches.map((one) => one.kmPerLitre), [14, 13.44]);
  });

  test('the sentence names the distance, the fuel and the stretches', () => {
    const said = describeMileage(mileage('v1', ORDINARY), (n) => `Rs${n}`);
    assert.includes(said, 'km/l');
    assert.includes(said, '850 km');
    assert.includes(said, '2 stretches');
  });

  test('and says why when there is no figure', () => {
    const said = describeMileage(mileage('v1', []));
    assert.includes(said, 'No mileage yet');
    assert.includes(said, 'two full tanks');
  });
});

describe('one vehicle at a time', () => {
  test('another car\'s fills are not mixed in', () => {
    const two = [...ORDINARY, fill('2026-05-05', 500, 20, true, { vehicle: 'v2' })];
    assert.length(fillsFor('v1', two), 3);
    assert.length(fillsFor('v2', two), 1);
  });

  test('a deleted fill is not counted', () => {
    const withDeleted = [...ORDINARY, fill('2026-05-25', 10600, 25, true, { deletedAt: '2026-06-01' })];
    assert.length(fillsFor('v1', withDeleted), 3);
  });

  test('fills are read oldest first however they arrive', () => {
    const shuffled = [ORDINARY[2], ORDINARY[0], ORDINARY[1]];
    assert.deep(fillsFor('v1', shuffled).map((one) => one.date),
      ['2026-05-01', '2026-05-20', '2026-06-10']);
  });
});
