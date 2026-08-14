/**
 * Money, derived.
 *
 * Pure functions over arrays of records. No storage, no DOM, no clock except
 * the one passed in — so the dashboard, the reports and the assistant all read
 * the same numbers from the same code, and the numbers can be checked without
 * a browser.
 *
 * Everything is in minor units throughout. A function here that returned
 * rupees would put a float back into a chain of exact integers.
 */

import { sum, changePercent } from '../core/money.js';
import { cardBills } from './cards.js';
import { subscriptionBills, commitmentSummary } from './commitments.js';
import {
  today, range, withinRange, startOfMonth, addMonths, endOfMonth, addDays,
  daysUntil, formatDay,
} from '../core/dates.js';

/** Transactions inside an inclusive day range, deleted ones excluded. */
export function inPeriod(transactions, period, clock = Date.now) {
  const bounds = typeof period === 'string' ? range(period, clock) : period;
  if (!bounds) return [];
  return transactions.filter((t) => !t.deletedAt && withinRange(t.date, bounds));
}

/**
 * A transfer is not income and not expense — it is the same money in a
 * different pocket. Counting it as either is the single most common way a
 * household budget ends up double the truth.
 */
export const isSpending = (t) => t.kind === 'expense';
export const isIncome = (t) => t.kind === 'income';

export function totals(transactions) {
  const expense = sum(transactions.filter(isSpending).map((t) => t.amount));
  const income = sum(transactions.filter(isIncome).map((t) => t.amount));
  return { income, expense, net: income - expense };
}

/** Spend per category, largest first. */
export function byCategory(transactions, { kind = 'expense' } = {}) {
  const buckets = new Map();
  for (const t of transactions) {
    if (t.kind !== kind) continue;
    buckets.set(t.category || 'other', (buckets.get(t.category || 'other') ?? 0) + (t.amount ?? 0));
  }
  return [...buckets]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** Month-by-month income and expense, oldest first. */
export function monthlySeries(transactions, monthsBack = 6, clock = Date.now) {
  const start = startOfMonth(addMonths(today(clock), -(monthsBack - 1)));
  const out = [];

  for (let i = 0; i < monthsBack; i++) {
    const from = addMonths(start, i);
    const bounds = { from, to: endOfMonth(from) };
    const rows = transactions.filter((t) => !t.deletedAt && withinRange(t.date, bounds));
    out.push({
      month: from.slice(0, 7),
      label: formatDay(from, { withYear: false }).replace(/^\d+ /, ''),
      ...totals(rows),
    });
  }
  return out;
}

/** This period against the one before it, for the dashboard's delta. */
export function comparePeriods(transactions, clock = Date.now) {
  const thisMonth = totals(inPeriod(transactions, 'month', clock));
  const lastMonth = totals(inPeriod(transactions, 'last-month', clock));
  return {
    current: thisMonth,
    previous: lastMonth,
    expenseChange: changePercent(lastMonth.expense, thisMonth.expense),
    incomeChange: changePercent(lastMonth.income, thisMonth.income),
  };
}

/**
 * Running balance per account: the opening balance, plus everything in,
 * minus everything out, with transfers moving between the two sides.
 */
export function accountBalances(accounts, transactions) {
  const balances = new Map(accounts.map((a) => [a.id, a.openingBalance ?? 0]));

  for (const t of transactions) {
    if (t.deletedAt) continue;
    const amount = t.amount ?? 0;
    if (t.kind === 'income') {
      balances.set(t.account, (balances.get(t.account) ?? 0) + amount);
    } else if (t.kind === 'expense') {
      balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
    } else if (t.kind === 'transfer') {
      // A transfer reaches this function in two shapes, and they need opposite
      // handling.
      //
      // **Two rows, from two statements.** Each bank reports its own side, so
      // each row carries a `direction` and no `toAccount`. The outgoing leg
      // subtracts from its account and the incoming leg *adds* to its own.
      //
      // **One row, entered by hand.** `direction` is hidden from the form, so
      // there is none; the row names both ends and moves the money itself.
      //
      // Until this, every transfer subtracted. An imported credit was taken
      // *off* the account it arrived in — so a ₹1,00,000 transfer left the
      // receiving account ₹2,00,000 short, and every household that imported
      // statements from two of their own accounts had it.
      //
      // `direction` wins where it exists. After a pairing is confirmed the
      // outgoing leg carries both a direction and a `toAccount`, and applying
      // the `toAccount` as well would credit the destination twice — once from
      // this row and once from the incoming leg that is still there.
      if (t.direction === 'in') {
        balances.set(t.account, (balances.get(t.account) ?? 0) + amount);
      } else if (t.direction === 'out') {
        balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
      } else {
        balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
        if (t.toAccount) balances.set(t.toAccount, (balances.get(t.toAccount) ?? 0) + amount);
      }
    }
  }

  return accounts.map((account) => ({
    ...account,
    balance: balances.get(account.id) ?? 0,
    // A credit card's "balance" is what is owed, and its utilisation is what
    // actually matters to a credit score.
    utilisation: account.kind === 'credit card' && account.creditLimit
      ? Math.abs(Math.min(0, balances.get(account.id) ?? 0)) / account.creditLimit
      : null,
  }));
}

/** Cash on hand: liquid accounts only, so a PPF balance is not "cash". */
const LIQUID = new Set(['savings', 'current', 'cash', 'wallet', 'UPI']);

export function liquidCash(accountsWithBalances) {
  return sum(accountsWithBalances
    .filter((a) => LIQUID.has(a.kind) && !a.archived && a.includeInNetWorth !== false)
    .map((a) => a.balance));
}

/**
 * Budget performance for a month. `alertAtPercent` decides amber; over 100%
 * is red. Reported per budget, not aggregated, because "you are 4% over
 * overall" hides that groceries doubled and travel went to nothing.
 */
export function budgetStatus(budgets, transactions, { month = today() } = {}) {
  const bounds = { from: startOfMonth(month), to: endOfMonth(month) };
  const spent = new Map();

  for (const t of transactions) {
    if (t.deletedAt || !isSpending(t) || !withinRange(t.date, bounds)) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) + (t.amount ?? 0));
  }

  return budgets
    .filter((b) => !b.deletedAt)
    .map((b) => {
      const used = spent.get(b.category) ?? 0;
      const limit = perMonth(b);
      const ratio = limit > 0 ? used / limit : 0;
      return {
        ...b,
        spent: used,
        limit,
        remaining: limit - used,
        ratio,
        state: ratio >= 1 ? 'over' : ratio >= (b.alertAtPercent ?? 80) / 100 ? 'close' : 'ok',
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

function perMonth(budget) {
  const limit = budget.monthlyLimit ?? 0;
  if (budget.period === 'quarterly') return Math.round(limit / 3);
  if (budget.period === 'yearly') return Math.round(limit / 12);
  return limit;
}

/**
 * One shape for every bill, whatever it came from.
 *
 * Four sources feed this list and each knows different things — a card knows
 * its statement date, a subscription knows whether it renews itself, a
 * recurring payment knows neither. Filling the gaps with nulls rather than
 * leaving the keys off means a caller can read `bill.account` on any row
 * without checking which kind it is first, which is how the four branches got
 * read wrongly the first time.
 *
 * @returns {{id, source, entity, recordId, name, kind, amount, dueOn, days,
 *            overdue, autoDebit, account, statement, cancelUrl, why}}
 */
const asBill = (bill) => ({
  entity: null,
  recordId: null,
  account: null,
  statement: null,
  cancelUrl: null,
  why: null,
  days: null,
  ...bill,
});

/**
 * Bills due in the next `days`.
 *
 * Four sources. Recurring payments carry their own next-due date; EMIs come
 * from loans, which do not; card bills come from the account's statement and
 * due days and the rows sitting on the card; subscription renewals come from
 * the Digital screens, where a date was already being shown with no money
 * attached to it.
 *
 * The last two are opt-in on the call rather than always on, because working a
 * card bill out needs the whole transaction history and several callers of
 * this function have only the recurring payments to hand.
 */
export function upcomingBills(recurring, loans, {
  days = 30, from = today(), accounts = null, transactions = null,
  subscriptions = null, digitalAssets = null,
} = {}) {
  const horizon = addDays(from, days);
  const out = [];

  for (const r of recurring) {
    if (r.deletedAt || r.active === false) continue;
    if (!r.nextDueOn || r.nextDueOn > horizon) continue;
    out.push(asBill({
      id: r.id,
      source: 'recurringPayment',
      entity: 'recurringPayment',
      recordId: r.id,
      name: r.name,
      kind: r.kind,
      amount: r.amount ?? 0,
      dueOn: r.nextDueOn,
      overdue: r.nextDueOn < from,
      autoDebit: Boolean(r.autoDebit),
    }));
  }

  for (const loan of loans) {
    if (loan.deletedAt || !loan.emiAmount || !loan.emiDay) continue;
    if (loan.endsOn && loan.endsOn < from) continue;
    const due = nextEmiDate(loan.emiDay, from);
    if (due > horizon) continue;
    out.push(asBill({
      id: loan.id,
      source: 'loan',
      entity: 'loan',
      recordId: loan.id,
      name: `${loan.name} EMI`,
      kind: 'EMI',
      amount: loan.emiAmount,
      dueOn: due,
      overdue: false,
      autoDebit: true,
    }));
  }

  // A card bill is the most expensive thing on this list to miss — interest
  // near forty per cent a year, backdated to the purchase date so the
  // interest-free period goes too. `amount` may be null, which is the card
  // saying *when* without claiming to know *how much*; `why` says so, and
  // callers must not print a figure in its place.
  for (const bill of cardBills(accounts, transactions, { from, days })) {
    out.push(asBill({
      id: bill.id,
      source: 'card',
      entity: 'account',
      recordId: bill.account,
      name: `${bill.name} bill`,
      kind: 'credit card',
      amount: bill.amount,
      dueOn: bill.dueOn,
      days: bill.days,
      overdue: bill.overdue,
      // Nothing pays a card automatically unless the household set that up on
      // the bank's side, which is not recorded here. Claiming otherwise is the
      // one wrong answer that would stop somebody looking.
      autoDebit: false,
      account: bill.account,
      statement: bill.statement,
      why: bill.why,
    }));
  }

  // A renewal is a bill: a known amount leaving on a known date. Subscriptions
  // already produced a date reminder with no money attached, which is the half
  // of the fact that costs nothing to know.
  for (const bill of subscriptionBills(subscriptions, digitalAssets, { from, days })) {
    out.push(asBill(bill));
  }

  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/**
 * What a list of bills adds up to, and how many of them would not say.
 *
 * A card with no statement day reports a due date and a null amount. Adding
 * that to a total gives the right sum of the wrong list: `null` coerces to
 * zero, so the figure comes out smaller than the truth with nothing on screen
 * to say a bill was left out of it. Callers get the count and are expected to
 * print it.
 *
 * @returns {{total: number, unknown: number}}
 */
export function billsTotal(bills) {
  let total = 0;
  let unknown = 0;
  for (const bill of bills) {
    if (bill.amount === null || bill.amount === undefined) unknown += 1;
    else total += bill.amount;
  }
  return { total, unknown };
}

/** The next occurrence of a day-of-month, clamped to short months. */
export function nextEmiDate(day, from = today()) {
  const [year, month] = from.split('-').map(Number);
  const inMonth = (y, m) => {
    const last = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  const thisMonth = inMonth(year, month);
  if (thisMonth >= from) return thisMonth;
  return month === 12 ? inMonth(year + 1, 1) : inMonth(year, month + 1);
}

/**
 * Advance a recurring payment to its next due date, as many times as it takes
 * to catch up. A phone that has been off for two months should not show two
 * months of "overdue" for a standing instruction that paid itself.
 */
export function advanceRecurring(recurring, from = today()) {
  const step = {
    weekly: (d) => addDays(d, 7),
    monthly: (d) => addMonths(d, 1),
    quarterly: (d) => addMonths(d, 3),
    'half-yearly': (d) => addMonths(d, 6),
    yearly: (d) => addMonths(d, 12),
  }[recurring.frequency];

  if (!step || !recurring.nextDueOn) return recurring.nextDueOn;

  let next = recurring.nextDueOn;
  let guard = 0;
  while (next < from && guard++ < 500) {
    const advanced = step(next);
    if (recurring.endsOn && advanced > recurring.endsOn) return next;
    next = advanced;
  }
  return next;
}

/**
 * Bills and EMIs out of the door each month.
 *
 * This is **not** the whole floor — subscriptions and digital assets are not
 * in it, and for a while the screen above it claimed they were. Use
 * `committed()` for the figure a household should be shown; this stays as the
 * bills-and-EMIs half it has always been.
 */
export function committedMonthlyOutflow(recurring, loans) {
  const perMonthAmount = (r) => {
    const amount = r.amount ?? 0;
    switch (r.frequency) {
      case 'weekly': return Math.round((amount * 52) / 12);
      case 'quarterly': return Math.round(amount / 3);
      case 'half-yearly': return Math.round(amount / 6);
      case 'yearly': return Math.round(amount / 12);
      default: return amount;
    }
  };

  const recurringTotal = sum(recurring
    .filter((r) => !r.deletedAt && r.active !== false && r.kind !== 'salary')
    .map(perMonthAmount));

  const emiTotal = sum(loans
    .filter((l) => !l.deletedAt && l.emiAmount && (!l.endsOn || daysUntil(l.endsOn) > 0))
    .map((l) => l.emiAmount));

  return recurringTotal + emiTotal;
}

/**
 * The household's actual monthly floor, and what is uncertain about it.
 *
 * Bills and EMIs, plus subscriptions that renew themselves — with what only
 * lapses, and what may be recorded twice, reported alongside rather than
 * folded in. See `domain/commitments.js`.
 */
export function committed({
  recurring = [], loans = [], subscriptions = [], digitalAssets = [],
} = {}) {
  return commitmentSummary({
    recurring,
    loans,
    subscriptions,
    digitalAssets,
    base: committedMonthlyOutflow(recurring, loans),
  });
}
