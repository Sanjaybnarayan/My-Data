/**
 * One category, looked at closely.
 *
 * The overview said "groceries 49%" and that was the end of the trail. What a
 * household asks next — on what, to whom, is it always this much, is a bill
 * inside it — needed a shape, and this is the arithmetic behind it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { categoryDetail, categoryTitle } from '../js/domain/category.js';

setSuite('category');

// A fixed clock, so "this month" is a fact about the fixture rather than a
// fact about the day the suite runs.
const CLOCK = () => new Date('2026-09-15T10:00:00Z').getTime();

const spend = (id, date, amount, over = {}) => ({
  id, date, amount, kind: 'expense', category: 'groceries',
  payee: 'Big Bazaar', deletedAt: null, heldAt: null, ...over,
});

const rows = [
  spend('t1', '2026-09-02', 320_00),
  spend('t2', '2026-09-08', 145_00, { payee: 'Corner shop' }),
  spend('t3', '2026-08-04', 410_00),
  spend('t4', '2026-08-19', 260_00, { payee: 'Corner shop' }),
  spend('t5', '2026-07-11', 190_00, { payee: '' }),
  spend('f1', '2026-09-03', 180_00, { category: 'fuel', payee: 'HP' }),
];

describe('what a category is made of', () => {
  test('only its own rows are counted', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.count, 5);
    assert.equal(it.total, 1325_00);
    assert.ok(!it.rows.some((row) => row.id === 'f1'));
  });

  test('a row with no category of its own falls under `other`, as the breakdown buckets it', () => {
    // `byCategory` writes `t.category || 'other'`. If this read the field
    // straight, the breakdown's `other` slice would link to an empty screen.
    const it = categoryDetail('other', {
      transactions: [spend('x', '2026-09-01', 100_00, { category: '' })], clock: CLOCK,
    });
    assert.equal(it.count, 1);
  });

  test('a deleted or held row is not spending', () => {
    const it = categoryDetail('groceries', {
      transactions: [...rows,
        spend('d', '2026-09-05', 999_00, { deletedAt: '2026-09-06' }),
        spend('h', '2026-09-05', 888_00, { heldAt: '2026-09-06' })],
      clock: CLOCK,
    });
    assert.equal(it.total, 1325_00);
  });

  test('the rows come back newest first', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.deep(it.rows.map((row) => row.id), ['t2', 't1', 't4', 't3', 't5']);
  });

  test('largest, average and since describe the whole history, not the month', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.largest, 410_00);
    assert.equal(it.average, Math.round(1325_00 / 5));
    assert.equal(it.since, '2026-07-11');
  });

  test('a category holding only transfers has nothing to say about spending', () => {
    // `own account`, `sweep`, `sent to person` are all real categories that
    // hold transfers, which are neither spending nor income. Reading `since`
    // off every row filed under the word rather than off the rows counted
    // made the screen write "0 recorded since 4 Jan 2026" — two numbers about
    // two different sets, in one sentence.
    const it = categoryDetail('own account', {
      transactions: [spend('m', '2026-01-04', 500_00, {
        category: 'own account', kind: 'transfer',
      })],
      clock: CLOCK,
    });
    assert.equal(it.count, 0);
    assert.equal(it.total, 0);
    assert.equal(it.since, null);
  });

  test('and a mixed category dates itself from the rows it counts', () => {
    const it = categoryDetail('groceries', {
      transactions: [...rows, spend('refund', '2026-01-01', 50_00, { kind: 'income' })],
      clock: CLOCK,
    });
    assert.equal(it.count, 5);
    assert.equal(it.since, '2026-07-11');
  });

  test('an empty category describes itself as empty rather than dividing by nothing', () => {
    const it = categoryDetail('travel', { transactions: rows, clock: CLOCK });
    assert.equal(it.count, 0);
    assert.equal(it.total, 0);
    assert.equal(it.average, 0);
    assert.equal(it.largest, 0);
    assert.equal(it.since, null);
    assert.ok(Number.isFinite(it.average));
  });
});

describe('this month against last', () => {
  test('each month sums only its own rows', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.thisMonth, 465_00);
    assert.equal(it.lastMonth, 670_00);
  });

  test('and the month in progress says it is in progress', () => {
    // Half a month against a whole one is the comparison this repository has
    // already been caught making. The caller is told, rather than handed a
    // projection nobody asked for.
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.partial, true);
  });

  test('the change is measured from last month to this one, not the other way', () => {
    // 670 last month, 465 so far this month: a fall of about a third. With the
    // arguments the other way round this returned +44%, and the screen showed
    // a category that has gone quiet as one that is running away.
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.change, -30.6);
  });

  test('a category that had nothing last month reports no change rather than a fall', () => {
    // Nothing is not a base to measure against. `changePercent` says so with
    // null, and a screen draws no delta for null — where inverting the
    // arguments produced a confident -100%, for a category that has appeared
    // rather than vanished.
    const it = categoryDetail('fuel', { transactions: rows, clock: CLOCK });
    assert.equal(it.thisMonth, 180_00);
    assert.equal(it.lastMonth, 0);
    assert.equal(it.change, null);
  });

  test('and one that has stopped is a fall of the whole of it', () => {
    const it = categoryDetail('groceries', {
      transactions: rows.filter((row) => row.date < '2026-09-01'), clock: CLOCK,
    });
    assert.equal(it.change, -100);
  });

  test('on the last day of a month it is no longer partial', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, clock: () => new Date('2026-09-30T10:00:00Z').getTime(),
    });
    assert.equal(it.partial, false);
  });
});

describe('the shape of it over a year', () => {
  test('the series runs oldest first and ends on this month', () => {
    const it = categoryDetail('groceries', { transactions: rows, months: 3, clock: CLOCK });
    assert.deep(it.series.map((m) => m.month), ['2026-07', '2026-08', '2026-09']);
    assert.deep(it.series.map((m) => m.value), [190_00, 670_00, 465_00]);
  });

  test('and only the month in progress is marked partial', () => {
    const it = categoryDetail('groceries', { transactions: rows, months: 3, clock: CLOCK });
    assert.deep(it.series.map((m) => m.partial), [false, false, true]);
  });

  test('a month with nothing in it is a zero, not a gap', () => {
    // A chart built from a series with months missing draws a different shape
    // from the one the household lived.
    const it = categoryDetail('fuel', { transactions: rows, months: 3, clock: CLOCK });
    assert.deep(it.series.map((m) => m.value), [0, 0, 180_00]);
  });
});

describe('who the money went to', () => {
  test('payees are ranked by what they took', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.deep(it.payees.map((p) => p.name), ['Big Bazaar', 'Corner shop', '']);
    assert.deep(it.payees.map((p) => p.total), [730_00, 405_00, 190_00]);
  });

  test('each carries the share it takes of the category', () => {
    // The thing a ranked list is for. `Big Bazaar ₹730` is a row the ledger
    // already has; that it is 55% of the household's groceries is not
    // anywhere else in the application.
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.deep(it.payees.map((p) => p.share), [55, 31, 14]);
  });

  test('and the shares are of the category, not of everything', () => {
    // Computed over the category's own rows. Against the whole ledger these
    // would each be smaller and would not add up to a hundred, which is the
    // sentence the screen puts them in.
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    const sum = it.payees.reduce((all, one) => all + one.share, 0);
    assert.ok(Math.abs(sum - 100) <= 1, String(sum));
  });

  test('each carries its count and the last time it was paid', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    const [first] = it.payees;
    assert.equal(first.count, 2);
    assert.equal(first.last, '2026-09-02');
  });

  test('rows with no payee are one bucket rather than many', () => {
    const it = categoryDetail('groceries', {
      transactions: [...rows, spend('n', '2026-09-09', 50_00, { payee: null })], clock: CLOCK,
    });
    assert.equal(it.payees.filter((p) => p.name === '').length, 1);
  });
});

describe('what is filed under it', () => {
  const bill = (id, over = {}) => ({
    id, name: 'Milk delivery', category: 'groceries', amount: 200_00,
    nextDueOn: '2026-09-20', active: true, deletedAt: null, heldAt: null, ...over,
  });

  test('an active recurring payment in this category is listed', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, recurring: [bill('r1')], clock: CLOCK,
    });
    assert.deep(it.commitments.map((c) => c.id), ['r1']);
  });

  test('one that has been switched off is not', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, recurring: [bill('r1', { active: false })], clock: CLOCK,
    });
    assert.equal(it.commitments.length, 0);
  });

  test('nor one that has already ended', () => {
    // A due date in a list of what is coming has to be coming.
    const it = categoryDetail('groceries', {
      transactions: rows, recurring: [bill('r1', { endsOn: '2026-08-31' })], clock: CLOCK,
    });
    assert.equal(it.commitments.length, 0);
  });

  test('and one belonging to another category is not borrowed', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, recurring: [bill('r1', { category: 'fuel' })], clock: CLOCK,
    });
    assert.equal(it.commitments.length, 0);
  });

  test('the soonest due comes first', () => {
    const it = categoryDetail('groceries', {
      transactions: rows,
      recurring: [bill('late', { nextDueOn: '2026-09-28' }), bill('soon', { nextDueOn: '2026-09-17' })],
      clock: CLOCK,
    });
    assert.deep(it.commitments.map((c) => c.id), ['soon', 'late']);
  });
});

describe('the budget it is measured against', () => {
  const budget = (over = {}) => ({
    id: 'b1', category: 'groceries', monthlyLimit: 500_00, period: 'monthly',
    alertAtPercent: 80, deletedAt: null, heldAt: null, ...over,
  });

  test('the category budget is found and carries what has been used', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, budgets: [budget()], clock: CLOCK,
    });
    assert.equal(it.budget.limit, 500_00);
    assert.equal(it.budget.spent, 465_00);
    assert.equal(it.budget.state, 'close');
  });

  test('a budget for another category is not shown against this one', () => {
    const it = categoryDetail('groceries', {
      transactions: rows, budgets: [budget({ category: 'fuel' })], clock: CLOCK,
    });
    assert.equal(it.budget, null);
  });

  test('no budget is null rather than a made-up one', () => {
    const it = categoryDetail('groceries', { transactions: rows, clock: CLOCK });
    assert.equal(it.budget, null);
  });
});

describe('a category the household files income under', () => {
  const pay = [
    { id: 'p1', date: '2026-09-01', amount: 90_000_00, kind: 'income',
      category: 'salary', payee: 'Employer', deletedAt: null, heldAt: null },
    { id: 'p2', date: '2026-08-01', amount: 90_000_00, kind: 'income',
      category: 'salary', payee: 'Employer', deletedAt: null, heldAt: null },
  ];

  test('it is described as income, from its own rows', () => {
    // Not from a list of category names kept somewhere else: a household is
    // free to file anything anywhere, and the screen has to describe what is
    // actually there.
    const it = categoryDetail('salary', { transactions: pay, clock: CLOCK });
    assert.equal(it.kind, 'income');
    assert.equal(it.total, 180_000_00);
  });

  test('and a spending category is still spending', () => {
    assert.equal(categoryDetail('groceries', { transactions: rows, clock: CLOCK }).kind, 'expense');
  });
});

describe('nothing to look at', () => {
  test('no arguments at all is an empty category, not a crash', () => {
    const it = categoryDetail('groceries');
    assert.equal(it.count, 0);
    assert.equal(it.payees.length, 0);
    assert.equal(it.commitments.length, 0);
    assert.equal(it.budget, null);
  });
});

describe('what to call a category at the top of its own screen', () => {
  test('a category with a written label keeps it', () => {
    assert.equal(categoryTitle('groceries'), 'Groceries and provisions');
  });

  test('and one without gets its key with a capital, not the raw key', () => {
    // `categoryLabel` knows eighteen of the forty-six categories the schema
    // offers. For the rest it returns the key, which is right inside a chart
    // legend and wrong in the place a page title goes: the screen read
    // `utilities` as its heading.
    assert.equal(categoryTitle('utilities'), 'Utilities');
    assert.equal(categoryTitle('other'), 'Other');
  });

  test('sentence case, so an acronym and a two-word key both survive it', () => {
    // Title case would make `EMI` into `Emi` and `rental income` into
    // `Rental Income`, neither of which this application writes.
    assert.equal(categoryTitle('EMI'), 'EMI');
    assert.equal(categoryTitle('rental income'), 'Rental income');
    assert.equal(categoryTitle('food delivery'), 'Food delivery');
  });

  test('a key that is not a category at all is still shown as itself', () => {
    // Reached by a hand-edited address. Better a heading naming what was
    // asked for over an empty state than a blank one.
    assert.equal(categoryTitle('not-a-real-category'), 'Not-a-real-category');
    assert.equal(categoryTitle(''), '');
  });
});
