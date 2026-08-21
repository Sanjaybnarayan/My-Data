import { test, describe, assert, setSuite } from './harness.mjs';
import { position, describeLine, lastCompleteMonth } from '../js/domain/cfo.js';
import { typicalMonthlyOutgoings, typicalDailySpend } from '../js/domain/runway.js';

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
    const out = position(DATA, { clock: CLOCK });
    const risks = at('risks', out);
    assert.ok(Array.isArray(risks.findings));
    for (const finding of risks.findings) {
      assert.ok(finding.source, 'a finding with no source is a score in disguise');
    }
    assert.equal(risks.value, risks.findings.length);
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
