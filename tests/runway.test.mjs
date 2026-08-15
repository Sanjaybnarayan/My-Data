/**
 * How long the money lasts.
 *
 * Every input existed — cash, dated bills, the history — and nothing combined
 * them, so the one question a household asks between pay days had no answer.
 *
 * This is the only file in `domain/` that describes what has **not happened**,
 * and its failure mode is not a wrong number but a comfortable one. Most of
 * these pin what it refuses to claim.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  cashRunway, typicalDailySpend, nextExpectedIncome, describeRunway, MIN_MONTHS,
} from '../js/domain/runway.js';
import { upcomingBills } from '../js/domain/finance.js';

setSuite('runway');

const clock = () => Date.parse('2026-08-15T00:00:00Z');
const accounts = [{ id: 'a1', name: 'HDFC', kind: 'savings', openingBalance: 0, deletedAt: null }];

let seq = 0;
const row = (date, amount, kind, category = 'groceries') => ({
  id: `t${++seq}`, date, amount, kind, category, account: 'a1',
  direction: kind === 'income' ? 'in' : 'out', deletedAt: null,
});

/** Three complete months of salary, rent and ordinary spending. */
const history = () => ['05', '06', '07'].flatMap((m) => [
  row(`2026-${m}-01`, 120_000_00, 'income', 'salary'),
  row(`2026-${m}-05`, 35_000_00, 'expense', 'rent'),
  row(`2026-${m}-20`, 30_000_00, 'expense', 'groceries'),
]);

const bill = (dueOn, amount, name = 'Rent') => ({
  id: `b-${dueOn}`, name, dueOn, amount, days: 0,
});

describe('what a usual day costs', () => {
  test('bills are excluded, because they are counted separately', () => {
    // Counting rent both as a dated bill and inside the daily rate is the
    // arithmetic error that would make the whole forecast useless.
    const { perDay } = typicalDailySpend(history(), { clock });
    assert.equal(perDay, Math.round(30_000_00 / 30));
  });

  test('the month in progress is not divided by a whole month of days', () => {
    // August is partial on the 15th. Including it drags the median down and
    // makes every day of the forecast look cheaper than it is.
    //
    // The two complete months are deliberately *unequal*: with three equal
    // ones a fourth cannot move the median, and the first version of this test
    // could not tell the guard from its absence.
    const twoMonths = [
      row('2026-06-20', 30_000_00, 'expense'),
      row('2026-07-20', 40_000_00, 'expense'),
    ];
    const withPartial = [...twoMonths, row('2026-08-02', 2_000_00, 'expense')];

    assert.equal(typicalDailySpend(twoMonths, { clock }).perDay, Math.round(35_000_00 / 30));
    assert.equal(typicalDailySpend(withPartial, { clock }).perDay,
      typicalDailySpend(twoMonths, { clock }).perDay);
  });

  test('too little history refuses rather than estimating from one month', () => {
    const { perDay, why } = typicalDailySpend([row('2026-07-20', 30_000_00, 'expense')], { clock });
    assert.equal(perDay, 0);
    assert.includes(why, 'not enough history');
  });

  test('income is not spending', () => {
    const onlyIncome = ['05', '06', '07'].map((m) => row(`2026-${m}-01`, 120_000_00, 'income', 'salary'));
    assert.equal(typicalDailySpend(onlyIncome, { clock }).perDay, 0);
  });

  test('money moved between your own accounts is not spending either', () => {
    // A transfer leaves the account with `direction: 'out'`, so the direction
    // guard admits it and only the kind tells them apart. Counting it would
    // have a household who sweeps to savings told their daily spending is
    // twice what it is.
    // Deliberately *not* categorised `self-transfer`: that is already on the
    // skip list, so a fixture using it tests the category guard and leaves the
    // kind guard untouched. An imported transfer often carries an ordinary
    // category and only its `kind` says what it is.
    const transfers = ['06', '07'].map((m) => ({
      ...row(`2026-${m}-11`, 50_000_00, 'transfer', 'other'), direction: 'out',
    }));
    const spend = ['06', '07'].map((m) => row(`2026-${m}-20`, 30_000_00, 'expense'));

    assert.equal(typicalDailySpend([...spend, ...transfers], { clock }).perDay,
      typicalDailySpend(spend, { clock }).perDay);
  });
});

describe('the credit the history suggests', () => {
  test('is reported with its date and size', () => {
    const income = nextExpectedIncome(history(), { from: '2026-08-15', clock });
    assert.equal(income.amount, 120_000_00);
    assert.equal(income.date, '2026-09-01');
  });

  test('and is never added to the forecast', () => {
    // The whole refusal, in one assertion: a household with ₹5,000 and a
    // ₹50,000 bill is short, whatever their salary usually does.
    const rows = [...history(), row('2026-08-14', 175_000_00, 'expense', 'other')];
    const forecast = cashRunway(accounts, rows, [bill('2026-08-20', 50_000_00)],
      { from: '2026-08-15', clock });

    assert.ok(forecast.income, 'the credit is still reported');
    assert.ok(forecast.shortfall, 'and the shortfall stands regardless');
  });

  test('one credit is not a pattern', () => {
    assert.equal(nextExpectedIncome([row('2026-07-01', 120_000_00, 'income', 'salary')],
      { from: '2026-08-15', clock }), null);
  });
});

describe('what it refuses to claim', () => {
  test('it never says the household is fine', () => {
    const forecast = cashRunway(accounts, history(), [], { from: '2026-08-15', clock });
    const said = describeRunway(forecast, (n) => String(n));

    assert.not(/fine|comfortable|safe|plenty/i.test(said));
    assert.includes(said, 'counting only what is known');
  });

  test('ordinary spending is in the forecast, not just the bills', () => {
    // The trap: cash minus dated bills is a reassuring number that ignores the
    // household's own history of everything else.
    const rows = history();
    const withDaily = cashRunway(accounts, rows, [bill('2026-09-05', 35_000_00)],
      { from: '2026-08-15', clock });
    const billsOnly = withDaily.cash - 35_000_00;

    assert.ok(withDaily.lowest.amount < billsOnly,
      'the forecast must be lower than cash-minus-bills, or it is ignoring the daily drip');
  });

  test('a bill with no amount is named rather than counted as nothing', () => {
    const forecast = cashRunway(accounts, history(),
      [bill('2026-08-20', null, 'HDFC card')], { from: '2026-08-15', clock });

    assert.ok(forecast.assumptions.some((line) => /no amount recorded/.test(line)));
    assert.ok(Number.isFinite(forecast.lowest.amount));
  });

  test('and an absent amount does not poison the arithmetic', () => {
    // `null` quietly adds as zero; `undefined` does not — it makes the running
    // balance NaN, and every figure after it. The guard has to hold for both,
    // and a test using only `null` could not tell.
    const forecast = cashRunway(accounts, history(),
      [{ id: 'b', name: 'HDFC card', dueOn: '2026-08-20' }], { from: '2026-08-15', clock });

    assert.ok(Number.isFinite(forecast.lowest.amount), 'the balance is still a number');
    // The sharper assertion: with NaN in the running balance every comparison
    // is false, so `lowest` silently stays at the opening cash and the whole
    // forecast reads as "nothing happens". Daily spending must still show.
    // The sharpest form: with NaN, every comparison after the bill is false,
    // so `lowest` freezes on the day before it and the forecast quietly stops
    // half way. Spending is constant here, so the lowest point must be the
    // last day of the window.
    assert.equal(forecast.lowest.date, '2026-09-29');
    assert.equal(forecast.shortfall, null);
  });

  test('an overdue bill counts from today rather than being dropped', () => {
    // Money that has not left yet. Dropping it would make this cheerier than
    // the household's own bank.
    const overdue = cashRunway(accounts, history(), [bill('2026-08-01', 40_000_00)],
      { from: '2026-08-15', clock });
    const none = cashRunway(accounts, history(), [], { from: '2026-08-15', clock });

    assert.equal(none.lowest.amount - overdue.lowest.amount, 40_000_00);
  });

  test('the assumptions carry no raw minor units', () => {
    // A ₹50 fee once read as "differ by 5000" elsewhere in this repository.
    // This module has no currency formatter, so it states no figures at all.
    const forecast = cashRunway(accounts, history(), [], { from: '2026-08-15', clock });
    for (const line of forecast.assumptions) {
      assert.not(/\d{4,}/.test(line), `an assumption printed a raw figure: ${line}`);
    }
  });

  test('and it says out loud that income is not counted', () => {
    const forecast = cashRunway(accounts, history(), [], { from: '2026-08-15', clock });
    assert.ok(forecast.assumptions.some((line) => /not counted/.test(line)));
  });
});

describe('the shortfall', () => {
  test('is the first day known outgoings exceed known cash', () => {
    const rows = [...history(), row('2026-08-14', 170_000_00, 'expense', 'other')];
    const forecast = cashRunway(accounts, rows, [bill('2026-08-18', 20_000_00)],
      { from: '2026-08-15', clock });

    assert.ok(forecast.shortfall);
    assert.ok(forecast.shortfall.date >= '2026-08-15');
    assert.includes(describeRunway(forecast, (n) => String(n)), forecast.shortfall.date);
  });

  test('MIN_MONTHS is the same bar for both estimates', () => {
    assert.equal(MIN_MONTHS, 2);
  });
});

/*
 * Accounts are not one pot.
 *
 * Measured on a household who sweep their salary to savings: ₹3,000 in the
 * account the rent leaves from, ₹3,45,000 in savings, and the pooled forecast
 * reported **no shortfall** while the rent bounced on the 20th. The
 * comfortable-wrong answer this file exists to avoid, in this file.
 */
describe('the account a bill actually leaves', () => {
  const twoAccounts = [
    { id: 'sal', name: 'Salary a/c', kind: 'savings', openingBalance: 0, deletedAt: null },
    { id: 'sav', name: 'Savings', kind: 'savings', openingBalance: 0, deletedAt: null },
  ];

  /** Salary in, most of it swept to savings, a little spending left behind. */
  const swept = () => ['05', '06', '07'].flatMap((m) => [
    { ...row(`2026-${m}-01`, 120_000_00, 'income', 'salary'), account: 'sal' },
    { ...row(`2026-${m}-02`, 115_000_00, 'expense', 'self-transfer'), account: 'sal' },
    { ...row(`2026-${m}-02`, 115_000_00, 'income', 'self-transfer'), account: 'sav' },
    { ...row(`2026-${m}-20`, 4_000_00, 'expense'), account: 'sal' },
  ]);

  const rent = { id: 'b', name: 'Rent', dueOn: '2026-08-20', amount: 35_000_00, account: 'sal' };

  test('a bill larger than its own account is reported, however much is elsewhere', () => {
    const forecast = cashRunway(twoAccounts, swept(), [rent], { from: '2026-08-15', clock });

    assert.length(forecast.accountShortfalls, 1);
    assert.equal(forecast.accountShortfalls[0].name, 'Salary a/c');
    assert.equal(forecast.accountShortfalls[0].bill, 'Rent');
    assert.ok(forecast.cash > 300_000_00, 'the household is not poor — that is the point');
  });

  test('and it is what the sentence says first', () => {
    const said = describeRunway(
      cashRunway(twoAccounts, swept(), [rent], { from: '2026-08-15', clock }),
      (n) => String(n),
    );
    assert.includes(said, 'Salary a/c');
    assert.includes(said, 'will not move itself');
  });

  test('a bill its account covers is not reported', () => {
    const small = { ...rent, amount: 1_000_00 };
    assert.length(cashRunway(twoAccounts, swept(), [small], { from: '2026-08-15', clock })
      .accountShortfalls, 0);
  });

  test('a bill naming no account is left to the pooled figure', () => {
    // Most bills do not record one, and inventing an account for them would be
    // a guess that produces a confident wrong warning.
    const noAccount = { id: 'b', name: 'Rent', dueOn: '2026-08-20', amount: 35_000_00 };
    assert.length(cashRunway(twoAccounts, swept(), [noAccount], { from: '2026-08-15', clock })
      .accountShortfalls, 0);
  });

  test('an account named by a bill but not recorded is not invented', () => {
    const elsewhere = { ...rent, account: 'no-such-account' };
    assert.length(cashRunway(twoAccounts, swept(), [elsewhere], { from: '2026-08-15', clock })
      .accountShortfalls, 0);
  });

  test('the account travels from the record onto the bill', () => {
    // My tests built bill objects by hand, so nothing exercised the seam where
    // `upcomingBills` reads `recurringPayment.account` — and the whole check
    // rests on it arriving.
    const [made] = upcomingBills(
      [{ id: 'r', name: 'Rent', kind: 'rent', amount: 35_000_00, frequency: 'monthly',
        nextDueOn: '2026-08-20', account: 'sal', deletedAt: null }],
      [], { days: 30, from: '2026-08-15' },
    );
    assert.equal(made.account, 'sal');

    assert.length(cashRunway(twoAccounts, swept(), [made], { from: '2026-08-15', clock })
      .accountShortfalls, 1);
  });

  test('a hole in the bill list is not a crash', () => {
    // The guard reads `bill?.account`, and the `?.` is doing more work than the
    // name suggests: without it a null in the list throws before any figure is
    // computed.
    const forecast = cashRunway(twoAccounts, swept(), [null, rent], { from: '2026-08-15', clock });
    assert.length(forecast.accountShortfalls, 1);
  });

  test('bills on one account are taken in date order, not list order', () => {
    // The first one that empties the account is the one that fails, and a list
    // in the wrong order names the wrong bill.
    const later = { id: 'b2', name: 'Insurance', dueOn: '2026-08-25', amount: 2_000_00, account: 'sal' };
    const early = { id: 'b3', name: 'Broadband', dueOn: '2026-08-16', amount: 2_500_00, account: 'sal' };
    const [first] = cashRunway(twoAccounts, swept(), [later, early], { from: '2026-08-15', clock })
      .accountShortfalls;

    assert.ok(first);
    assert.equal(first.bill, 'Insurance', 'broadband fits; the insurance is what breaks it');
  });
});
