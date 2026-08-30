import { test, describe, assert, setSuite } from './harness.mjs';
import { position, describeLine, lastCompleteMonth } from '../js/domain/cfo.js';
import { typicalMonthlyOutgoings, typicalDailySpend } from '../js/domain/runway.js';
import { committed } from '../js/domain/finance.js';

setSuite('cfo');

const CLOCK = () => Date.parse('2026-08-21');

/** Two complete months and three weeks of a third. */
const TRANSACTIONS = Object.freeze([
  { id: 't1', date: '2026-06-01', kind: 'income', amount: 15000000, category: 'salary', account: 'a1' },
  { id: 't2', date: '2026-06-05', kind: 'expense', amount: 4500000, category: 'rent', account: 'a1' },
  { id: 't3', date: '2026-06-09', kind: 'expense', amount: 1800000, category: 'groceries', account: 'a1' },
  { id: 't4', date: '2026-07-01', kind: 'income', amount: 15000000, category: 'salary', account: 'a1' },
  { id: 't5', date: '2026-07-05', kind: 'expense', amount: 4500000, category: 'rent', account: 'a1' },
  { id: 't6', date: '2026-07-11', kind: 'expense', amount: 2100000, category: 'groceries', account: 'a1' },
  { id: 't7', date: '2026-08-01', kind: 'income', amount: 15000000, category: 'salary', account: 'a1' },
  { id: 't8', date: '2026-08-05', kind: 'expense', amount: 4500000, category: 'rent', account: 'a1' },
]);

const ACCOUNTS = Object.freeze([
  { id: 'a1', kind: 'savings', name: 'HDFC', openingBalance: 25000000 },
]);

const DATA = Object.freeze({ accounts: ACCOUNTS, transactions: TRANSACTIONS });
const at = (id, out) => out.lines.find((row) => row.id === id);

describe('the month in progress is not a month', () => {
  test('period figures come from the last month that finished', () => {
    assert.equal(lastCompleteMonth(CLOCK), '2026-07');
    const out = position(DATA, { clock: CLOCK });
    assert.equal(out.month, '2026-07');
    assert.equal(at('income', out).value, 15000000);
    assert.equal(at('expenses', out).value, 6600000);
    assert.equal(at('savings', out).value, 8400000);
  });

  test('and August, which flatters itself, is kept out of them', () => {
    // Measured before any of this was written. On the 21st, August shows
    // ₹1,05,000 saved against July's ₹84,000 — better by ₹21,000, entirely
    // because the salary has landed and three weeks of spending has not.
    const out = position(DATA, { clock: CLOCK });
    const august = out.monthInProgress;

    assert.equal(august.month, '2026-08');
    assert.ok(august.partial);
    assert.equal(august.net, 10500000);
    assert.ok(august.net > at('savings', out).value,
      'the fixture no longer shows the partial month flattering itself');
    assert.includes(august.note, 'not comparable');
  });

  test('a month with nothing in it is not reported as zero', () => {
    // "Nothing recorded" and "earned nothing" are different states, and only
    // one of them is a fact about the household's money.
    const out = position({ accounts: ACCOUNTS, transactions: [] }, { clock: CLOCK });
    assert.equal(at('income', out).value, null);
    assert.includes(at('income', out).why, 'nothing is recorded for');
    assert.includes(describeLine(at('income', out)), 'Not available');
  });
});

describe('months of cover', () => {
  test('a month costs what the household paid, bills included', () => {
    // June ₹63,000 and July ₹66,000 → median ₹64,500.
    const out = typicalMonthlyOutgoings(TRANSACTIONS, { clock: CLOCK });
    assert.equal(out.perMonth, 6450000);
    assert.equal(out.months, 2);
    assert.equal(out.why, null);
  });

  test('which is not the daily figure times thirty', () => {
    // `typicalDailySpend` excludes rent, EMIs and bills on purpose, because
    // the runway counts those separately as dated obligations. Using it here
    // reported 27 months of cover where the truth was 8.2.
    const daily = typicalDailySpend(TRANSACTIONS, { clock: CLOCK });
    const monthly = typicalMonthlyOutgoings(TRANSACTIONS, { clock: CLOCK });
    assert.ok(daily.perDay * 30 < monthly.perMonth / 3,
      `daily×30 ${daily.perDay * 30} should be far below ${monthly.perMonth}`);
  });

  test('the emergency fund is cover against everything, not against groceries', () => {
    const out = position(DATA, { clock: CLOCK });
    const fund = at('emergencyFund', out);
    assert.equal(fund.months, 8.2);
    assert.includes(fund.source, 'bills included');
    // And a household reading the screen can see which denominator it is,
    // because months-of-cover means nothing without saying against what.
    assert.includes(describeLine(fund, (n) => String(n)), 'bills included');
  });

  test('and says why rather than guessing when the history is too short', () => {
    const short = TRANSACTIONS.filter((t) => t.date >= '2026-07-01');
    const out = position({ accounts: ACCOUNTS, transactions: short }, { clock: CLOCK });
    const fund = at('emergencyFund', out);
    assert.equal(fund.value, null);
    assert.includes(fund.why, 'not enough to say what a month costs');
  });
});

describe('every figure names where it came from', () => {
  test('each line carries a source or a reason, never neither', () => {
    const out = position(DATA, { clock: CLOCK });
    assert.length(out.lines, 10);
    for (const row of out.lines) {
      assert.ok(row.source, `${row.id} has no source`);
      assert.ok(row.value !== null || row.why, `${row.id} has neither a value nor a reason`);
    }
  });

  test('the ten lines are the ten the prompt names, in its order', () => {
    const out = position(DATA, { clock: CLOCK });
    assert.deep(out.lines.map((row) => row.id), [
      'income', 'expenses', 'savings', 'investments', 'debt', 'netWorth',
      'emergencyFund', 'obligations', 'risks', 'goals',
    ]);
  });

  test('risks is a list of findings, never a score', () => {
    /*
     * `DATA` produces **no** findings, and this used to run against it — so
     * the loop below never executed, `a finding with no source` was never
     * asserted about anything, and `risks.value` was compared to
     * `risks.findings.length` as 0 against 0. A check that cannot fail, on
     * the one property of this page the build brief states outright: every
     * figure must be explainable.
     *
     * `risks` gathers from four places, each hard-coding its own `source`, so
     * the way this test earns its keep is a fifth `found.push` written without
     * one. That is only catchable if at least one finding exists, which is
     * what the goal below is for: a goal with no target and no funding source
     * cannot be measured, so `domain/goals.js` reports it and the page passes
     * it through.
     */
    const goals = [{ id: 'g1', name: 'A trip somewhere', kind: 'other' }];
    const out = position({ ...DATA, goals }, { clock: CLOCK });
    const risks = at('risks', out);

    assert.ok(Array.isArray(risks.findings));
    assert.ok(risks.findings.length > 0,
      'no findings, so the assertion below runs against nothing');
    for (const finding of risks.findings) {
      assert.ok(finding.source, 'a finding with no source is a score in disguise');
    }
    assert.equal(risks.value, risks.findings.length);
  });

  test('and says nothing when there is nothing to say', () => {
    // The other half, and why the fixture above had to be changed rather than
    // this case deleted: no findings is a real and common state, and the line
    // still has to name its source and report zero rather than go missing.
    const risks = at('risks', position(DATA, { clock: CLOCK }));
    assert.length(risks.findings, 0);
    assert.equal(risks.value, 0);
    assert.ok(risks.source, 'the line stopped naming its source when empty');
  });

  test('a stale valuation reaches the net worth line rather than being hidden', () => {
    const out = position({
      ...DATA,
      holdings: [{ id: 'h1', name: 'Old fund', kind: 'mutual fund', invested: 100000 }],
    }, { clock: CLOCK });
    assert.includes(at('netWorth', out).caveats.join(' '), 'valued at cost');
    assert.ok(at('risks', out).findings.some((f) => f.kind === 'stale valuation'));
  });
});

describe('upcoming obligations counts the three things it names', () => {
  const RECURRING = [
    { id: 'r1', name: 'Rent', amount: 3500000, frequency: 'monthly', active: true, kind: 'rent' },
    { id: 'r2', name: 'Electricity', amount: 280000, frequency: 'monthly', active: true, kind: 'utility' },
  ];
  const LOANS = [{ id: 'l1', name: 'Car loan', emiAmount: 1850000, endsOn: '2030-01-01' }];
  const SUBSCRIPTIONS = [
    { id: 's1', name: 'Streaming', amount: 49900, cycle: 'monthly', autoRenew: true, renewsOn: '2026-09-10' },
  ];

  test('rent, EMI and subscription are all in the figure', () => {
    const out = position({
      ...DATA, recurring: RECURRING, loans: LOANS, subscriptions: SUBSCRIPTIONS,
    }, { clock: CLOCK });
    const row = at('obligations', out);
    // ₹35,000 rent + ₹2,800 electricity + ₹18,500 EMI + ₹499 subscription.
    assert.equal(row.value, 5679900);
  });

  test('it agrees with the module the label points at', () => {
    // The same three inputs through `finance.committed`, which is where the
    // household's monthly floor is defined. A figure on the CFO page that
    // disagrees with it is one of them being wrong, and this page invents no
    // arithmetic of its own.
    const args = { recurring: RECURRING, loans: LOANS, subscriptions: SUBSCRIPTIONS };
    const out = position({ ...DATA, ...args }, { clock: CLOCK });
    assert.equal(at('obligations', out).value, committed(args).total);
  });

  test('and subscriptions alone would not be it', () => {
    // Guards the shape of the fault rather than the number: the bug was a call
    // that omitted `base`, leaving the largest outgoings loaded, passed in and
    // silently dropped under a label naming them.
    const out = position({
      ...DATA, recurring: RECURRING, loans: LOANS, subscriptions: SUBSCRIPTIONS,
    }, { clock: CLOCK });
    const subsOnly = position({ ...DATA, subscriptions: SUBSCRIPTIONS }, { clock: CLOCK });
    assert.equal(subsOnly.lines.find((r) => r.id === 'obligations').value, 49900);
    assert.ok(at('obligations', out).value > subsOnly.lines.find((r) => r.id === 'obligations').value);
  });
});
