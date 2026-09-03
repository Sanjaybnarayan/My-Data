/**
 * Rows whose amount cannot be summed.
 *
 * The household's records live in their own Google Sheet, so a row can be
 * edited by hand and `Repository.applyRemote` writes it back without
 * validating — deliberately, because a sync that rejected a row would lose it.
 *
 * `total` was `sum + t.amount`. For a string that concatenates: a month with
 * one hand-edited row reported spending of `"250000twenty thousand"`, which is
 * not an error and not a wrong number but a corrupted one, formatted and
 * shown. Both halves are tested here — that the arithmetic is arithmetic, and
 * that the rows it skipped are reported rather than quietly dropped.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  isReadableAmount, unreadableAmounts, describeUnreadable, heldRows, describeHeld,
} from '../js/domain/amounts.js';
import { summarise } from '../js/domain/categorise.js';

setSuite('amounts');

const row = (id, amount) => ({
  id, amount, direction: 'out', categoryKind: 'spending', category: 'other-spend', date: '2026-08-01',
});

describe('an amount this device cannot read', () => {
  test('a string is not readable, however numeric it looks', () => {
    assert.equal(isReadableAmount('20000'), false);
    assert.equal(isReadableAmount('twenty thousand'), false);
  });

  test('nor is NaN or Infinity, which arithmetic produces on its own', () => {
    assert.equal(isReadableAmount(NaN), false);
    assert.equal(isReadableAmount(Infinity), false);
  });

  test('a number is, including zero and a negative', () => {
    for (const value of [0, -250, 250000]) assert.equal(isReadableAmount(value), true);
  });
});

describe('reporting them', () => {
  test('a row with no amount at all is not a fault', () => {
    // Most entities have no amount and never did. Counting those would report
    // thousands of "unreadable" rows and teach somebody to ignore the number.
    const report = unreadableAmounts([{ id: 'a' }, { id: 'b', amount: null }]);
    assert.equal(report.count, 0);
  });

  test('a row that has one and cannot be read is', () => {
    const report = unreadableAmounts([row('a', 100), row('b', 'twenty thousand')]);
    assert.equal(report.count, 1);
    assert.deep(report.ids, ['b']);
  });

  test('and there is nothing to say when every row is readable', () => {
    assert.equal(describeUnreadable(unreadableAmounts([row('a', 100)])), null);
  });

  test('the sentence says the totals exclude them, and does not guess', () => {
    const said = describeUnreadable(unreadableAmounts([row('a', 'x'), row('b', 'y')]));
    assert.ok(/not in these totals/i.test(said), said);
    assert.ok(/spreadsheet/i.test(said), said);
  });
});

describe('the totals themselves', () => {
  test('a hand-edited amount no longer concatenates', () => {
    const summary = summarise([row('a', 250000), row('b', 'twenty thousand')]);
    assert.equal(typeof summary.moneyOut, 'number', String(summary.moneyOut));
    assert.equal(summary.moneyOut, 250000);
  });

  /*
   * The other direction. Skipping a row silently would trade a visible
   * corruption for an invisible omission — a total quietly about less than it
   * claims, which is the fault this application has already been bitten by
   * twice. The skip is only safe because the report above exists.
   */
  test('and the row it skipped is still reported', () => {
    const rows = [row('a', 250000), row('b', 'twenty thousand')];
    assert.equal(summarise(rows).moneyOut, 250000);
    assert.equal(unreadableAmounts(rows).count, 1);
  });

  test('a clean month is unaffected', () => {
    assert.equal(summarise([row('a', 250000), row('b', 100000)]).moneyOut, 350000);
  });
});

describe('rows a sync is holding out of the totals', () => {
  const at = '2025-01-05T00:00:00.000Z';

  test('counts the held rows and nothing else', () => {
    const report = heldRows([{ id: 'a' }, { id: 'b', heldAt: at }, { id: 'c', heldAt: null }]);
    assert.equal(report.count, 1);
    assert.deep(report.ids, ['b']);
  });

  test('and says nothing when nothing is held', () => {
    assert.equal(describeHeld(heldRows([{ id: 'a' }])), null);
  });

  test('and says the total will change rather than sending anybody to a spreadsheet', () => {
    /*
     * The difference from an unreadable amount, which is the reason these are
     * two functions and not one. An unreadable amount is a row somebody has to
     * go and fix in their sheet. A held row fixes itself on the next sync that
     * brings what it names, and telling a household to go and look would be a
     * false alarm every time.
     */
    const said = describeHeld(heldRows([{ id: 'a', heldAt: at }]));
    assert.ok(said);
    assert.not(/spreadsheet/i.test(said), 'sends somebody to fix a row that fixes itself');
  });

  test('and the overview counts them, which asking inPeriod could not', async () => {
    /*
     * The mistake this catches was made writing it. The first version read the
     * held rows out of `inMonth`, which comes from `inPeriod` — and `inPeriod`
     * asks `settled()`, so the held rows are gone by then and the count was
     * zero however many were being held. A counter that cannot count, on
     * exactly the rows it exists for.
     */
    const { assembleOverview } = await import('../js/services/finance.js');
    const clock = () => Date.parse('2025-01-15T10:00:00');
    const rows = [
      { id: 't1', date: '2025-01-02', amount: 1000, kind: 'expense', account: 'a1' },
      { id: 't2', date: '2025-01-03', amount: 500, kind: 'expense', account: 'gone', heldAt: at },
    ];

    const out = assembleOverview({ accounts: [{ id: 'a1', name: 'A', kind: 'savings' }], transactions: rows }, { clock });
    assert.ok(out.held, 'a held row inside the month was not reported');
    assert.equal(out.compare.current.expense, 1000, 'the held row joined the total after all');

    const none = assembleOverview(
      { accounts: [{ id: 'a1', name: 'A', kind: 'savings' }], transactions: [rows[0]] }, { clock },
    );
    assert.equal(none.held, null, 'it reports held rows when there are none');
  });
});
