/**
 * Spending unlike its own history.
 *
 * Measured before it was built: a household spent ₹85,000 on healthcare having
 * never spent anything on healthcare, and ₹61,000 at a supermarket averaging
 * ₹9,240. The Insights screen's entire output was that rent was the largest
 * category and two payments repeat on a schedule.
 *
 * An outlier detector is where a household gets told nonsense confidently, so
 * most of these pin what it refuses to say.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  unusualSpending, categoryHistory, describeUnusual, UNUSUAL, FLOOR,
} from '../js/domain/unusual.js';
import { insights, summarise } from '../js/domain/categorise.js';

setSuite('unusual');

let seq = 0;
const spend = (date, category, amount) => ({
  id: `t${++seq}`, date, category, amount, direction: 'out', deletedAt: null,
});

/** Five ordinary months of one category, then whatever July did. */
const withHistory = (category, monthly, july) => [
  ...['02', '03', '04', '05', '06'].map((m, i) => spend(`2026-${m}-14`, category, monthly[i])),
  ...(july === null ? [] : [spend('2026-07-14', category, july)]),
];

describe('what a category usually costs', () => {
  test('the usual figure is the median, not the mean', () => {
    // One expensive month drags a mean upward and then hides the next
    // expensive month behind it.
    const rows = withHistory('retail', [7_400_00, 11_200_00, 8_100_00, 12_600_00, 90_000_00], 20_000_00);
    const [retail] = categoryHistory(rows, { month: '2026-07' });

    assert.equal(retail.usual, 11_200_00);
    assert.equal(retail.monthsSeen, 5);
    assert.equal(retail.current, 20_000_00);
  });

  test('history is the months it was spent in, not the months since the first', () => {
    // A category bought in February and June has two months of history.
    // Treating the gap as four months of zero would call June normal.
    const rows = [spend('2026-02-01', 'travel', 30_000_00), spend('2026-06-01', 'travel', 30_000_00)];
    const [travel] = categoryHistory(rows, { month: '2026-06' });
    assert.equal(travel.monthsSeen, 1);
  });

  test('a later month is not counted as history for an earlier one', () => {
    const rows = withHistory('retail', [8_000_00, 8_000_00, 8_000_00, 8_000_00, 8_000_00], 60_000_00);
    const [retail] = categoryHistory(rows, { month: '2026-04' });
    assert.equal(retail.current, 8_000_00);
    assert.equal(retail.monthsSeen, 2, 'February and March, and nothing after April');
  });
});

describe('what it says', () => {
  test('a category well above its own median is reported with both figures', () => {
    const rows = withHistory('retail', [7_400_00, 11_200_00, 8_100_00, 12_600_00, 6_900_00], 61_000_00);
    const [finding] = unusualSpending(rows, { month: '2026-07' });

    assert.equal(finding.kind, UNUSUAL.ABOVE);
    assert.equal(finding.usual, 8_100_00);
    assert.equal(finding.amount, 61_000_00);
    assert.includes(describeUnusual(finding), '7.5 times');
    assert.includes(describeUnusual(finding), '5 earlier months');
  });

  test('the biggest rupee difference comes first, not the biggest multiple', () => {
    const rows = [
      ...withHistory('retail', [8_000_00, 8_000_00, 8_000_00, 8_000_00, 8_000_00], 60_000_00),
      ...withHistory('fuel', [2_100_00, 2_100_00, 2_100_00, 2_100_00, 2_100_00], 21_000_00),
    ];
    const findings = unusualSpending(rows, { month: '2026-07' });

    // Fuel is the larger multiple (10x against 7.5x); retail is the larger
    // hole in the household's month.
    assert.equal(findings[0].category, 'retail');
  });
});

describe('what it refuses to say', () => {
  test('a first occurrence is never a multiple of anything', () => {
    const [finding] = unusualSpending([spend('2026-07-11', 'healthcare', 85_000_00)], { month: '2026-07' });

    assert.equal(finding.kind, UNUSUAL.FIRST);
    assert.equal(finding.times, null, 'there is no ratio against nothing');
    assert.equal(finding.usual, null);
    assert.includes(describeUnusual(finding), 'first time');
    assert.not(/Infinity|NaN/.test(describeUnusual(finding)));
  });

  test('too little history is no history', () => {
    // Two prior months, then a jump. "Usual" has no meaning yet, so this is
    // dropped rather than reported with a disclaimer.
    const rows = [
      spend('2026-05-14', 'retail', 8_000_00),
      spend('2026-06-14', 'retail', 8_000_00),
      spend('2026-07-14', 'retail', 60_000_00),
    ];
    assert.length(unusualSpending(rows, { month: '2026-07' }), 0);
  });

  test('small money is not news, however large the multiple', () => {
    const rows = withHistory('charges', [50_00, 50_00, 50_00, 50_00, 50_00], 500_00);
    assert.length(unusualSpending(rows, { month: '2026-07' }), 0, 'ten times ₹50 is still ₹500');
  });

  test('and the floor applies to a first occurrence too', () => {
    assert.length(unusualSpending([spend('2026-07-11', 'charges', FLOOR - 1)], { month: '2026-07' }), 0);
    assert.length(unusualSpending([spend('2026-07-11', 'charges', FLOOR)], { month: '2026-07' }), 1);
  });

  test('a category merely at its usual level is not reported', () => {
    const rows = withHistory('bills', [35_000_00, 35_000_00, 35_000_00, 35_000_00, 35_000_00], 35_000_00);
    assert.length(unusualSpending(rows, { month: '2026-07' }), 0);
  });

  test('money coming in is not unusual spending, however unusual', () => {
    // A bonus month is a spike by every measure this file uses. It is still
    // not spending, and reporting it as such would tell a household it had
    // overspent in the month it was paid extra.
    const salary = { '02': 120_000_00, '03': 120_000_00, '04': 120_000_00,
      '05': 120_000_00, '06': 120_000_00, '07': 900_000_00 };
    const rows = Object.entries(salary).map(([m, amount]) => ({
      ...spend(`2026-${m}-01`, 'salary', amount), direction: 'in',
    }));
    assert.length(unusualSpending(rows, { month: '2026-07' }), 0);
  });

  test('a deleted row is not history and not a finding', () => {
    const rows = withHistory('retail', [8_000_00, 8_000_00, 8_000_00, 8_000_00, 8_000_00], 60_000_00)
      .map((row) => (row.date === '2026-07-14' ? { ...row, deletedAt: '2026-07-15' } : row));
    assert.length(unusualSpending(rows, { month: '2026-07' }), 0);
  });

  test('a month still running says so rather than being compared silently', () => {
    const rows = withHistory('retail', [7_400_00, 11_200_00, 8_100_00, 12_600_00, 6_900_00], 61_000_00);
    const [finding] = unusualSpending(rows, { month: '2026-07', complete: false });

    assert.ok(finding.partial);
    assert.includes(describeUnusual(finding), 'so far this month');
  });

  test('and a first-time finding in a running month says it too', () => {
    const [finding] = unusualSpending(
      [spend('2026-07-11', 'healthcare', 85_000_00)],
      { month: '2026-07', complete: false },
    );
    assert.includes(describeUnusual(finding), 'so far this month');
  });
});

describe('reaching the screen', () => {
  const rows = [
    ...withHistory('retail', [7_400_00, 11_200_00, 8_100_00, 12_600_00, 6_900_00], 61_000_00),
    spend('2026-07-11', 'healthcare', 85_000_00),
  ].map((row) => ({ ...row, categoryKind: 'spending', rule: 'x', counterpartyKey: row.category }));

  test('the insights list carries the findings', () => {
    // The detector being right says nothing about whether a household ever
    // sees it. This is the wiring, and it is the half that has been silently
    // missing twice in this repository.
    const notes = insights(rows, summarise(rows));
    const unusual = notes.filter((note) => note.kind === 'unusual');

    assert.length(unusual, 2);
    assert.includes(unusual[0].text, 'first time');
  });

  test('the month examined is the latest one, not the last one grouped', () => {
    // `summary.byMonth` is grouped rather than sorted, so taking `.at(-1)`
    // returned June for a period ending in July and the note never appeared at
    // all. An ordering nothing promises is not an ordering.
    const summary = summarise(rows);
    const keys = summary.byMonth.map((bucket) => bucket.key);
    assert.not(keys.join() === [...keys].sort().join(),
      'this fixture must actually be out of order, or the test proves nothing');

    assert.length(insights(rows, summary).filter((n) => n.kind === 'unusual'), 2);
  });
});
