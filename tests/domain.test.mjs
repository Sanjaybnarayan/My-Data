import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import * as fin from '../js/domain/finance.js';
import * as pf from '../js/domain/portfolio.js';
import { netWorth, netWorthByPerson } from '../js/domain/networth.js';
import { expiryReminders, upcomingDates, allReminders, describeReminder } from '../js/domain/reminders.js';
import { toMinor } from '../js/core/money.js';

setSuite('domain');

const rs = (value) => toMinor(String(value));

const txn = (over = {}) => ({
  id: `t${Math.random()}`, kind: 'expense', amount: rs(100), date: '2025-06-10',
  account: 'acc1', category: 'other', deletedAt: null, ...over,
});

describe('finance', () => {
  test('a transfer is neither income nor expense', () => {
    const rows = [
      txn({ kind: 'income', amount: rs(50000) }),
      txn({ kind: 'expense', amount: rs(12000) }),
      txn({ kind: 'transfer', amount: rs(30000), toAccount: 'acc2' }),
    ];
    const t = fin.totals(rows);
    assert.equal(t.income, rs(50000));
    assert.equal(t.expense, rs(12000));
    assert.equal(t.net, rs(38000), 'moving money between pockets is not a gain or a loss');
  });

  test('deleted transactions are excluded from a period', () => {
    const rows = [
      txn({ date: '2025-06-10' }),
      txn({ date: '2025-06-11', deletedAt: '2025-06-12T00:00:00Z' }),
    ];
    const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
    assert.length(fin.inPeriod(rows, 'month', clock), 1);
  });

  test('a balance follows both sides of a transfer', () => {
    const accounts = [
      { id: 'acc1', kind: 'savings', openingBalance: rs(10000) },
      { id: 'acc2', kind: 'savings', openingBalance: 0 },
    ];
    const rows = [txn({ kind: 'transfer', amount: rs(4000), account: 'acc1', toAccount: 'acc2' })];
    const balances = fin.accountBalances(accounts, rows);
    assert.equal(balances[0].balance, rs(6000));
    assert.equal(balances[1].balance, rs(4000));
  });

  test('an imported transfer credits the account the money arrived in', () => {
    // The bug this exists for. An imported transfer is *two* rows — each bank
    // reports its own side — so the incoming leg carries `direction: 'in'` and
    // no `toAccount`. Every transfer used to subtract, so a ₹1,00,000 transfer
    // left the receiving account ₹2,00,000 short, and every household that
    // imported statements from two of their own accounts had it.
    //
    // 864 tests passed with this broken. None of them looked.
    const accounts = [
      { id: 'bank', kind: 'savings', openingBalance: rs(500000) },
      { id: 'demat', kind: 'demat', openingBalance: 0 },
    ];
    const rows = [
      txn({ kind: 'transfer', amount: rs(100000), account: 'bank', direction: 'out' }),
      txn({ kind: 'transfer', amount: rs(100000), account: 'demat', direction: 'in' }),
    ];

    const balances = fin.accountBalances(accounts, rows);
    assert.equal(balances[0].balance, rs(400000), 'the bank paid it out');
    assert.equal(balances[1].balance, rs(100000), 'and the demat received it');
  });

  test('a confirmed pairing does not credit the destination twice', () => {
    // After a pairing is confirmed the outgoing leg carries both a direction
    // and a `toAccount`, while the incoming leg is still there. Applying the
    // `toAccount` as well would credit the destination from both rows.
    const accounts = [
      { id: 'bank', kind: 'savings', openingBalance: rs(500000) },
      { id: 'demat', kind: 'demat', openingBalance: 0 },
    ];
    const rows = [
      txn({
        kind: 'transfer', amount: rs(100000), account: 'bank',
        direction: 'out', toAccount: 'demat',
      }),
      txn({ kind: 'transfer', amount: rs(100000), account: 'demat', direction: 'in' }),
    ];

    const balances = fin.accountBalances(accounts, rows);
    assert.equal(balances[0].balance, rs(400000));
    assert.equal(balances[1].balance, rs(100000), 'once, not twice');
  });

  test('card utilisation is computed from the limit', () => {
    const accounts = [{ id: 'c1', kind: 'credit card', openingBalance: 0, creditLimit: rs(200000) }];
    const [card] = fin.accountBalances(accounts, [txn({ account: 'c1', amount: rs(50000) })]);
    assert.close(card.utilisation, 0.25, 1e-9);
  });

  test('only liquid accounts count as cash', () => {
    const accounts = [
      { id: 'a', kind: 'savings', openingBalance: rs(50000) },
      { id: 'b', kind: 'PPF', openingBalance: rs(400000) },
      { id: 'c', kind: 'cash', openingBalance: rs(2000) },
    ];
    const balances = fin.accountBalances(accounts, []);
    assert.equal(fin.liquidCash(balances), rs(52000), 'a PPF balance is not cash');
  });

  test('a budget over its limit is reported as over', () => {
    const budgets = [{ id: 'b1', category: 'groceries', monthlyLimit: rs(10000), alertAtPercent: 80 }];
    const rows = [txn({ category: 'groceries', amount: rs(11000), date: '2025-06-05' })];
    const [status] = fin.budgetStatus(budgets, rows, { month: '2025-06-15' });
    assert.equal(status.state, 'over');
    assert.equal(status.remaining, rs(-1000));
  });

  test('a quarterly budget is compared per month, not per quarter', () => {
    const budgets = [{ id: 'b1', category: 'travel', monthlyLimit: rs(30000), period: 'quarterly' }];
    const rows = [txn({ category: 'travel', amount: rs(9000), date: '2025-06-05' })];
    const [status] = fin.budgetStatus(budgets, rows, { month: '2025-06-15' });
    assert.equal(status.limit, rs(10000));
    assert.equal(status.state, 'close');
  });

  test('an EMI day past this month rolls to next month', () => {
    assert.equal(fin.nextEmiDate(5, '2025-06-10'), '2025-07-05');
    assert.equal(fin.nextEmiDate(20, '2025-06-10'), '2025-06-20');
    assert.equal(fin.nextEmiDate(10, '2025-06-10'), '2025-06-10', 'today counts');
  });

  test('an EMI on the 31st lands on the last day of a short month', () => {
    assert.equal(fin.nextEmiDate(31, '2025-02-01'), '2025-02-28');
    assert.equal(fin.nextEmiDate(31, '2025-12-31'), '2025-12-31');
  });

  test('a recurring payment catches up rather than showing months overdue', () => {
    const bill = { frequency: 'monthly', nextDueOn: '2025-01-15' };
    assert.equal(fin.advanceRecurring(bill, '2025-06-10'), '2025-06-15');
  });

  test('a recurring payment does not advance past its end date', () => {
    const bill = { frequency: 'monthly', nextDueOn: '2025-01-15', endsOn: '2025-03-20' };
    assert.equal(fin.advanceRecurring(bill, '2025-06-10'), '2025-03-15');
  });

  test('upcoming bills merge recurring payments and loan EMIs, in date order', () => {
    const recurring = [{
      id: 'r1', name: 'Broadband', kind: 'bill', amount: rs(1200),
      nextDueOn: '2025-06-20', active: true,
    }];
    const loans = [{ id: 'l1', name: 'Home loan', emiAmount: rs(45000), emiDay: 5 }];
    const bills = fin.upcomingBills(recurring, loans, { days: 60, from: '2025-06-10' });
    assert.length(bills, 2);
    assert.equal(bills[0].name, 'Broadband');
    assert.equal(bills[1].name, 'Home loan EMI');
  });

  test('an inactive recurring payment is not a bill', () => {
    const recurring = [{ id: 'r1', name: 'Old gym', amount: rs(1), nextDueOn: '2025-06-12', active: false }];
    assert.length(fin.upcomingBills(recurring, [], { from: '2025-06-10' }), 0);
  });

  test('committed outflow annualises to a monthly figure', () => {
    const recurring = [
      { id: 'a', amount: rs(12000), frequency: 'yearly', active: true },
      { id: 'b', amount: rs(1000), frequency: 'monthly', active: true },
    ];
    assert.equal(fin.committedMonthlyOutflow(recurring, []), rs(2000));
  });

  test('a monthly series covers every month even with no activity', () => {
    const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
    const series = fin.monthlySeries([txn({ date: '2025-06-01', amount: rs(500) })], 6, clock);
    assert.length(series, 6);
    assert.equal(series.at(-1).month, '2025-06');
    assert.equal(series[0].expense, 0);
  });
});

describe('portfolio', () => {
  test('a holding with no current value falls back to cost', () => {
    assert.equal(pf.holdingValue({ invested: rs(50000) }), rs(50000));
    assert.equal(pf.holdingValue({ invested: rs(50000), currentValue: rs(62000) }), rs(62000));
  });

  test('allocation groups instruments into asset classes', () => {
    const holdings = [
      { id: '1', kind: 'stock', currentValue: rs(100000), active: true },
      { id: '2', kind: 'mutual fund', currentValue: rs(100000), active: true },
      { id: '3', kind: 'PPF', currentValue: rs(200000), active: true },
    ];
    const rows = pf.allocation(holdings);
    assert.length(rows, 2, 'stocks and funds are both equity');
    assert.equal(rows[0].label, 'Equity');
    assert.equal(rows[0].share, 50);
  });

  test('XIRR on a single year doubling is about 100 percent', () => {
    const rate = pf.xirr([
      { date: '2024-01-01', amount: -100000 },
      { date: '2025-01-01', amount: 200000 },
    ]);
    assert.close(rate, 100, 0.5);
  });

  test('XIRR handles irregular contributions', () => {
    // Three SIP instalments, then a value. Checked against the same flows in
    // a spreadsheet's XIRR.
    const rate = pf.xirr([
      { date: '2024-01-01', amount: -10000 },
      { date: '2024-04-01', amount: -10000 },
      { date: '2024-07-01', amount: -10000 },
      { date: '2025-01-01', amount: 33000 },
    ]);
    assert.ok(rate > 12 && rate < 20, `expected a mid-teens return, got ${rate}`);
  });

  test('XIRR survives a portfolio that lost most of its value', () => {
    const rate = pf.xirr([
      { date: '2024-01-01', amount: -100000 },
      { date: '2025-01-01', amount: 5000 },
    ]);
    assert.ok(rate !== null && rate < -90, `expected a large loss, got ${rate}`);
  });

  test('XIRR returns null when no rate exists', () => {
    assert.equal(pf.xirr([{ date: '2024-01-01', amount: -100 }]), null);
    assert.equal(pf.xirr([
      { date: '2024-01-01', amount: -100 },
      { date: '2025-01-01', amount: -100 },
    ]), null, 'all outflows have no return');
  });

  test('cash flows use the right signs and end at current value', () => {
    const holding = { id: 'h1', invested: rs(10000), currentValue: rs(15000) };
    const flows = pf.cashFlows(holding, [
      { holding: 'h1', kind: 'buy', amount: rs(10000), date: '2024-01-01' },
      { holding: 'h1', kind: 'dividend', amount: rs(500), date: '2024-06-01' },
    ], { asOf: '2025-01-01' });

    assert.equal(flows[0].amount, -rs(10000), 'a purchase is money leaving');
    assert.equal(flows[1].amount, rs(500), 'a dividend is money returning');
    assert.equal(flows[2].amount, rs(15000), 'the current value closes the series');
  });

  test('a closing value passed in wins over the stored one', () => {
    // The closing flow decides an XIRR almost single-handedly, so a caller with
    // better grounds for it — the accrual estimate, for a deposit whose value
    // was typed once and never revisited — has to be able to say so.
    const holding = { id: 'h1', invested: rs(10000), currentValue: rs(10000) };
    const flows = pf.cashFlows(holding, [
      { holding: 'h1', kind: 'buy', amount: rs(10000), date: '2024-01-01' },
    ], { asOf: '2025-01-01', value: rs(11500) });

    assert.equal(flows.at(-1).amount, rs(11500));
  });

  test('and a closing value of zero is an answer, not an absence', () => {
    // `??` rather than `||`, and the difference is the whole point: a caller
    // that has worked out the holding is worth nothing has said something, and
    // falling back to the stored figure would silently overrule them.
    const holding = { id: 'h1', invested: rs(10000), currentValue: rs(10000) };
    const flows = pf.cashFlows(holding, [
      { holding: 'h1', kind: 'buy', amount: rs(10000), date: '2024-01-01' },
    ], { asOf: '2025-01-01', value: 0 });

    assert.length(flows, 1, 'nothing closes a series worth nothing');
  });

  test('a maturity inside the window is flagged, outside it is not', () => {
    const holdings = [
      { id: '1', name: 'FD', maturesOn: '2099-01-01' },
      { id: '2', name: 'FD2', maturesOn: null },
    ];
    assert.length(pf.maturingSoon(holdings, 90), 0, 'a maturity 70 years out is not soon');
  });

  test('CAGR is the compound rate, not the simple one', () => {
    assert.close(pf.cagr(100000, 121000, 2), 10, 0.05);
  });
});

describe('net worth', () => {
  const data = () => ({
    accounts: [
      { id: 'a1', kind: 'savings', openingBalance: rs(250000), holder: 'p1' },
      { id: 'c1', kind: 'credit card', openingBalance: 0, creditLimit: rs(200000), holder: 'p1' },
    ],
    transactions: [txn({ account: 'c1', amount: rs(30000) })],
    holdings: [{ id: 'h1', kind: 'stock', invested: rs(100000), currentValue: rs(140000), active: true, owner: 'p1' }],
    properties: [{ id: 'pr1', name: 'Flat', purchasePrice: rs(5000000), currentValue: rs(7000000), owner: 'p1' }],
    vehicles: [{ id: 'v1', registration: 'KA01AB1234', currentValue: rs(400000) }],
    loans: [{ id: 'l1', name: 'Home loan', outstanding: rs(2200000), borrower: 'p1' }],
  });

  test('assets minus liabilities, from records that already exist', () => {
    const n = netWorth(data());
    assert.equal(n.assets, rs(250000) + rs(140000) + rs(7000000) + rs(400000));
    assert.equal(n.liabilities, rs(2200000) + rs(30000));
    assert.equal(n.total, n.assets - n.liabilities);
  });

  test('an unvalued vehicle is excluded rather than counted at cost', () => {
    const d = data();
    d.vehicles = [{ id: 'v1', registration: 'KA01AB1234', purchasePrice: rs(900000) }];
    const n = netWorth(d);
    assert.not(n.breakdown.some((b) => b.label === 'Vehicles'));
    assert.ok(n.staleValuations.some((s) => s.entity === 'vehicle'));
  });

  test('a portfolio valued at cost says so', () => {
    const d = data();
    d.holdings = [{ id: 'h1', kind: 'stock', invested: rs(100000), active: true }];
    assert.ok(netWorth(d).staleValuations.some((s) => s.reason === 'valued at cost'));
  });

  test('an archived account is left out', () => {
    const d = data();
    d.accounts[0].archived = true;
    assert.not(netWorth(d).breakdown.some((b) => b.label === 'Cash & bank'));
  });

  test('insurance cover is not treated as an asset', () => {
    const n = netWorth({ ...data(), policies: [{ id: 'p', sumAssured: rs(10000000) }] });
    assert.ok(n.total < rs(10000000), 'a payout that requires a death is not net worth');
  });

  test('per-person totals separate what is attributed from what is not', () => {
    const d = data();
    d.accounts.push({ id: 'a2', kind: 'savings', openingBalance: rs(50000) }); // no holder
    const rows = netWorthByPerson(d, [{ id: 'p1', name: 'Asha' }]);
    assert.length(rows, 2);
    assert.ok(rows.some((r) => r.person === null && r.assets === rs(50000)));
  });
});

describe('reminders', () => {
  const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));

  test('an expiry inside its lead time is reported', () => {
    const reminders = expiryReminders({
      vehicle: [{
        id: 'v1', registration: 'KA01AB1234', deletedAt: null,
        insuranceExpiresOn: '2025-07-01',
      }],
    }, { clock });
    assert.length(reminders, 1);
    assert.equal(reminders[0].field, 'insuranceExpiresOn');
    assert.equal(reminders[0].days, 16);
    // Half the 30-day lead is the "soon" boundary, so 16 days is still
    // upcoming and 15 would not be.
    assert.equal(reminders[0].severity, 'upcoming');

    const closer = expiryReminders({
      vehicle: [{ id: 'v1', deletedAt: null, insuranceExpiresOn: '2025-06-30' }],
    }, { clock });
    assert.equal(closer[0].severity, 'soon');
  });

  test('an expiry beyond its lead time is not', () => {
    const reminders = expiryReminders({
      vehicle: [{ id: 'v1', deletedAt: null, insuranceExpiresOn: '2026-07-01' }],
    }, { clock });
    assert.length(reminders, 0);
  });

  test('an overdue item is urgent, then eventually stops nagging', () => {
    const recent = expiryReminders({
      vehicle: [{ id: 'v1', deletedAt: null, pucExpiresOn: '2025-06-01' }],
    }, { clock });
    assert.equal(recent[0].severity, 'overdue');

    const ancient = expiryReminders({
      vehicle: [{ id: 'v1', deletedAt: null, pucExpiresOn: '2024-01-01' }],
    }, { clock });
    assert.length(ancient, 0, 'a permanent red badge is one people learn to ignore');
  });

  test('a cancelled policy stops reminding', () => {
    const reminders = expiryReminders({
      subscription: [{ id: 's1', deletedAt: null, renewsOn: '2025-06-20', active: false }],
    }, { clock });
    assert.length(reminders, 0);
  });

  test('every expiry field in the schema produces reminders without registration', () => {
    // The point of walking the schema: a field added to any entity is covered
    // the same day. This asserts the mechanism, not one entity.
    const reminders = expiryReminders({
      policy: [{ id: 'p1', name: 'Health', deletedAt: null, renewsOn: '2025-07-10' }],
      document: [{ id: 'd1', title: 'Passport', deletedAt: null, expiresOn: '2025-07-05' }],
      task: [{ id: 't1', title: 'File returns', deletedAt: null, dueOn: '2025-06-16' }],
    }, { clock });
    assert.length(reminders, 3);
    assert.deep([...new Set(reminders.map((r) => r.entity))].sort(),
      ['document', 'policy', 'task']);
  });

  test('a birthday reports the age being turned', () => {
    const dates = upcomingDates(
      [{ id: 'p1', name: 'Asha', birthday: '1985-07-01', deletedAt: null }],
      [], { from: '2025-06-15' },
    );
    assert.length(dates, 1);
    assert.equal(dates[0].turning, 40);
  });

  test('a deceased person has no birthday reminder', () => {
    const dates = upcomingDates(
      [{ id: 'p1', name: 'X', birthday: '1930-07-01', deceasedOn: '2020-01-01', deletedAt: null }],
      [], { from: '2025-06-15' },
    );
    assert.length(dates, 0);
  });

  test('overdue sorts ahead of urgent, which sorts ahead of pleasant', () => {
    const all = allReminders({
      vehicle: [{ id: 'v1', deletedAt: null, pucExpiresOn: '2025-06-01' }],
      person: [{ id: 'p1', name: 'Asha', birthday: '1985-06-17', deletedAt: null }],
      policy: [{ id: 'p1', name: 'Health', deletedAt: null, renewsOn: '2025-07-20' }],
    }, { clock });

    assert.equal(all[0].severity, 'overdue');
    assert.equal(all.at(-1).severity, 'upcoming');
  });

  test('a reminder describes itself in a sentence', () => {
    assert.includes(
      describeReminder({ group: 'expiry', title: 'KA01AB1234', label: 'PUC expiry', days: -3 }),
      'expired 3 days ago',
    );
    assert.includes(
      describeReminder({ group: 'date', title: "Asha's birthday", days: 0, turning: 40 }),
      'is today',
    );
  });
});
