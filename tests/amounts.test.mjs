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
import { totals, byCategory, accountBalances } from '../js/domain/finance.js';

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

  /*
   * The three above test `summarise`, and `summarise` was the only thing that
   * had ever been fixed.
   *
   * `domain/amounts.js` says a total "adds only finite numbers", which was
   * true of one private helper in `domain/categorise.js` and of nothing the
   * finance screen shows. Measured on the real path: a month containing one
   * hand-edited row reported spending of `'2500000twenty thousand'` through
   * `totals()` and `byCategory()`, and a balance of `null` — the exact string
   * `amounts.js` quotes in its own docstring as the thing it fixed.
   *
   * The sentence beside those figures said the row was **not** in these
   * totals. That is the part worth naming: not a number that was wrong, but a
   * disclosure that was false, next to a figure that had swallowed the row it
   * promised to exclude. So each of these asserts the arithmetic *and* the
   * count, because the claim under test is the sentence.
   */
  const money = (id, amount, extra = {}) => ({
    id, amount, date: '2026-07-05', kind: 'expense', direction: 'out',
    category: 'food', account: 'a1', ...extra,
  });

  test('the finance total does not concatenate, and says what it left out', () => {
    const rows = [money('a', 250000), money('b', 'twenty thousand')];
    const out = totals(rows);
    assert.equal(typeof out.expense, 'number', String(out.expense));
    assert.equal(out.expense, 250000);
    assert.equal(unreadableAmounts(rows).count, 1, 'the sentence has to be true too');
  });

  test('nor does the category breakdown, which keeps its own running total', () => {
    // Its own `Map`, not `sum`, so fixing `sum` alone left this one corrupt
    // while the headline beside it had been corrected.
    const rows = [money('a', 250000), money('b', 'twenty thousand')];
    const [food] = byCategory(rows);
    assert.equal(typeof food.value, 'number', String(food.value));
    assert.equal(food.value, 250000);
  });

  /*
   * Nineteen call sites were fixed and three of them are asserted above. This
   * is what covers the other sixteen.
   *
   * It reads source, and says so: it cannot tell you a figure is right, only
   * that nobody has spelled the guard the old way again. `?? 0` is the exact
   * shape of the bug — it treats a missing amount as zero, which is correct,
   * and a string amount as a string, which concatenates. The three behavioural
   * tests above are what prove the arithmetic; this is what stops it coming
   * back somewhere none of them look.
   */
  test('nothing adds an amount without asking whether it is one', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'js');

    const walk = async (dir) => {
      const found = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...await walk(full));
        else if (entry.name.endsWith('.js')) found.push(full);
      }
      return found;
    };

    const files = await walk(root);
    assert.ok(files.length > 100, `only ${files.length} files walked, so this proves little`);

    const offenders = [];
    for (const file of files) {
      const src = await readFile(file, 'utf8');
      // Addition and absolute value only. `(x.amount ?? 0) > 0` is a
      // comparison, not a total, and flagging it would make this noise.
      const bad = src.match(/\+ \([A-Za-z_]+\.amount \?\? 0\)|Math\.abs\([A-Za-z_]+\.amount \?\? 0\)/g);
      if (bad) offenders.push(`${file.slice(root.length + 1)} (${bad.length})`);
    }
    assert.deep(offenders, []);
  });

  test('and a balance is a number rather than nothing at all', () => {
    // `null` reads on the screen as "this account has no balance", which is a
    // different and worse claim than "one row could not be read".
    const accounts = [{ id: 'a1', name: 'HDFC', kind: 'savings', openingBalance: 500000 }];
    const rows = [money('a', 250000), money('b', 'twenty thousand')];
    assert.equal(accountBalances(accounts, rows)[0].balance, 250000);
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
