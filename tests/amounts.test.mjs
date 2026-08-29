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
import { isReadableAmount, unreadableAmounts, describeUnreadable } from '../js/domain/amounts.js';
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
