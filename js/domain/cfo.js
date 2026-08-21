/**
 * One page saying where the household's money stands.
 *
 * Build prompt v6.0, Phase 9: income, expenses, savings, investments, debt,
 * net worth, emergency fund, upcoming obligations, financial risks, goals —
 * and, in its own words, *"every figure must be explainable."*
 *
 * ## This invents no arithmetic
 *
 * Every line here is already computed somewhere: `domain/finance.js`,
 * `domain/networth.js`, `domain/runway.js`, `domain/commitments.js`,
 * `domain/unusual.js`, `domain/goals.js`. Saying so plainly matters, because a
 * screen called "Family CFO" is exactly the kind of thing that grows a
 * proprietary score nobody can check. What this adds is assembly and the
 * naming of sources — which is the *whole* of what the prompt asked for.
 *
 * ## The month in progress is not a month
 *
 * Measured on a real household before any of this was written:
 *
 *     July, complete       income ₹1,50,000 · expense ₹66,000 · saved ₹84,000
 *     August, 21 days in   income ₹1,50,000 · expense ₹45,000 · saved ₹1,05,000
 *
 * August looks like the better month by ₹21,000, entirely because it has not
 * finished. The salary landed on the 1st and three weeks of groceries have not
 * been recorded yet. A screen reporting "saved this month: ₹1,05,000" on the
 * 21st tells a household it is doing better than last month on evidence that
 * says nothing of the kind.
 *
 * `typicalDailySpend` already refuses to use the month in progress, for
 * exactly this reason. So the period figures here are the **last complete
 * month**, named in the output so nobody reads them as today's. The month in
 * progress is reported separately and marked partial, and the two are never
 * put side by side as though they were comparable.
 *
 * ## A line with no answer says so
 *
 * Where a figure cannot be had — no spending history, nothing recorded — the
 * line carries `why` and no value. A zero would be a claim, and the wrong one:
 * "no debt recorded" and "no debt" are different states, and only one of them
 * is a fact about the household's money.
 */

import * as fin from './finance.js';
import { netWorth } from './networth.js';
import { typicalDailySpend, typicalMonthlyOutgoings } from './runway.js';
import { commitmentSummary } from './commitments.js';
import { unusualSpending } from './unusual.js';
import { reviewGoals, STATUS as GOAL_STATUS } from './goals.js';
import { today, startOfMonth, endOfMonth, addMonths, formatDay } from '../core/dates.js';

/** The last month that has actually ended. */
export function lastCompleteMonth(clock = Date.now) {
  return addMonths(startOfMonth(today(clock)), -1).slice(0, 7);
}

const monthRange = (month) => ({
  from: startOfMonth(`${month}-01`),
  to: endOfMonth(`${month}-01`),
});

/** A line with a figure. */
const line = (id, label, value, source, extra = {}) =>
  ({ id, label, value, why: null, source, ...extra });

/** A line without one, and the reason. */
const missing = (id, label, why, source) =>
  ({ id, label, value: null, why, source, ...{} });

/**
 * Everything the page shows, from records alone.
 *
 * Pure: records in, view model out. No database, no clock unless passed one.
 */
export function position(data, { clock = Date.now } = {}) {
  const {
    accounts = [], transactions = [], holdings = [], properties = [],
    vehicles = [], loans = [], recurring = [], subscriptions = [],
    digitalAssets = [], goals = [],
  } = data ?? {};

  const month = lastCompleteMonth(clock);
  const inMonth = transactions.filter((t) => !t.deletedAt
    && t.date >= monthRange(month).from && t.date <= monthRange(month).to);
  const monthTotals = fin.totals(inMonth);
  const monthLabel = formatDay(`${month}-01`, { withYear: true }).replace(/^\d+\s/, '');

  const nw = netWorth({ accounts, transactions, holdings, properties, vehicles, loans });
  const spend = typicalDailySpend(transactions, { clock });
  const outgoings = typicalMonthlyOutgoings(transactions, { clock });
  const cash = fin.liquidCash(fin.accountBalances(accounts, transactions));
  // `upcomingBills` takes a date, not a clock. Passing `{ clock }` type-checked
  // as an unknown property and was silently dropped, so this counted bills
  // against the real today rather than the one the caller asked for.
  const bills = fin.upcomingBills(recurring, loans, { from: today(clock) });
  const commitments = commitmentSummary({ recurring, loans, subscriptions, digitalAssets });
  const goalRows = reviewGoals(goals, {
    balanceOf: (id) => balanceMap(accounts, transactions).get(id) ?? 0,
    holdingValueOf: (id) => holdings.find((h) => h.id === id)?.currentValue ?? 0,
    monthlySpend: spend.perDay * 30,
    clock: () => today(clock),
  });

  const anyMonth = inMonth.length > 0;
  const period = (id, label, value) => (anyMonth
    ? line(id, label, value, `transactions dated in ${monthLabel}`, { month, monthLabel })
    : missing(id, label, `nothing is recorded for ${monthLabel}`, 'transactions'));

  const lines = [
    period('income', 'Income', monthTotals.income),
    period('expenses', 'Expenses', monthTotals.expense),
    period('savings', 'Savings', monthTotals.net),

    line('investments', 'Investments',
      nw.breakdown.find((r) => r.label === 'Investments')?.value ?? 0,
      'holdings, at their recorded value'),

    line('debt', 'Debt', nw.liabilities, 'loans outstanding and cards in debt'),
    line('netWorth', 'Net worth', nw.total, 'assets less liabilities',
      { caveats: nw.staleValuations.map((s) => `${s.name}: ${s.reason}`) }),

    emergencyFund(cash, outgoings, goalRows),
    line('obligations', 'Upcoming obligations', commitments.total,
      'recurring payments, EMIs and subscriptions',
      { billsAhead: bills.length }),

    risks({ nw, goalRows, commitments, transactions, month }),
    goalsLine(goalRows),
  ];

  return {
    month,
    monthLabel,
    asOf: today(clock),
    lines,
    /** Reported apart from the figures above, and never beside them. */
    monthInProgress: partialMonth(transactions, clock),
  };
}

function balanceMap(accounts, transactions) {
  return new Map(fin.accountBalances(accounts, transactions).map((a) => [a.id, a.balance]));
}

/**
 * How long the cash would last at this household's own rate of spending.
 *
 * Not the same question as the emergency-fund *goal*, which is a target. This
 * is the state: months of cover, now. Both are shown when both exist.
 */
function emergencyFund(cash, outgoings, goalRows) {
  const goal = goalRows.find((row) => row.goal?.kind === 'emergency fund');
  if (!outgoings.perMonth) {
    return missing('emergencyFund', 'Emergency fund',
      `months of cover needs a usual month's outgoings, and ${outgoings.why}`,
      'liquid accounts against everything a month costs');
  }
  return line('emergencyFund', 'Emergency fund', cash,
    'liquid accounts against everything a month costs, bills included', {
      months: Math.round((cash / outgoings.perMonth) * 10) / 10,
      goal: goal ? goal.goal.name : null,
      goalStatus: goal ? goal.status : null,
    });
}

/**
 * What is worth a household's attention, each finding naming its own source.
 *
 * Deliberately a list and not a score. A number between 0 and 100 summarising
 * "risk" would be this file inventing a weighting nobody agreed to, and it
 * would be the one figure on the page that could not be explained.
 */
function risks({ nw, goalRows, commitments, transactions, month }) {
  const found = [];

  // `unusualSpending` is told which month to judge, so it needs no clock —
  // passing one implied it did.
  const unusual = unusualSpending(transactions, { month, complete: true });
  for (const one of unusual) {
    found.push({ kind: 'unusual spending', detail: one.category, source: 'domain/unusual.js' });
  }
  for (const stale of nw.staleValuations) {
    found.push({ kind: 'stale valuation', detail: `${stale.name} — ${stale.reason}`, source: 'domain/networth.js' });
  }
  for (const row of goalRows.filter((r) => r.status === GOAL_STATUS.UNKNOWN)) {
    found.push({ kind: 'goal that cannot be measured', detail: row.goal.name, source: 'domain/goals.js' });
  }
  for (const dup of commitments.duplicates ?? []) {
    found.push({ kind: 'possible duplicate commitment', detail: dup.name ?? dup.label ?? '', source: 'domain/commitments.js' });
  }

  return {
    id: 'risks',
    label: 'Financial risks',
    value: found.length,
    why: null,
    source: 'findings from the modules that already look for them',
    findings: found,
  };
}

function goalsLine(goalRows) {
  if (!goalRows.length) {
    return missing('goals', 'Goals', 'none are recorded', 'domain/goals.js');
  }
  const reached = goalRows.filter((r) => r.status === GOAL_STATUS.REACHED).length;
  const unmeasurable = goalRows.filter((r) => r.status === GOAL_STATUS.UNKNOWN).length;
  return line('goals', 'Goals', goalRows.length, 'domain/goals.js', {
    reached,
    unmeasurable,
    overdue: goalRows.filter((r) => r.status === GOAL_STATUS.OVERDUE).length,
  });
}

/**
 * The month that has not finished, reported as such.
 *
 * Shown so a household is not left wondering where this month went, and
 * carried in its own field so nothing can accidentally line it up beside a
 * complete one.
 */
function partialMonth(transactions, clock) {
  const now = today(clock);
  const month = now.slice(0, 7);
  const rows = transactions.filter((t) => !t.deletedAt
    && t.date >= startOfMonth(now) && t.date <= now);
  const totals = fin.totals(rows);
  return {
    month,
    partial: true,
    upTo: now,
    ...totals,
    note: 'This month is not over. These are the records so far, and they are '
      + 'not comparable with a complete month.',
  };
}

/** The sentence under a line. */
export function describeLine(row, money = (n) => String(n)) {
  if (row.why) return `Not available — ${row.why}.`;
  if (row.id === 'risks') {
    return row.value === 0 ? 'Nothing flagged.'
      : `${row.value} ${row.value === 1 ? 'finding' : 'findings'}, each from the module that found it.`;
  }
  if (row.id === 'goals') {
    const parts = [`${row.value} recorded`];
    if (row.reached) parts.push(`${row.reached} reached`);
    if (row.overdue) parts.push(`${row.overdue} overdue`);
    if (row.unmeasurable) parts.push(`${row.unmeasurable} cannot be measured`);
    return parts.join(' · ');
  }
  if (row.id === 'emergencyFund') {
    // The source is spelled out here rather than left in the data, because
    // "months of cover" is meaningless without saying against what — and
    // against the wrong denominator this line read 27 months where the truth
    // was 8.2.
    const cover = `${row.months} months of cover — ${row.source}`;
    return row.goal
      ? `${money(row.value)} · ${cover} · goal "${row.goal}"`
      : `${money(row.value)} · ${cover}`;
  }
  const base = `${money(row.value)} — ${row.source}`;
  return row.caveats?.length ? `${base} · ${row.caveats.join('; ')}` : base;
}
