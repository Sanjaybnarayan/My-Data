/**
 * How long the money lasts.
 *
 * ## The question nothing answered
 *
 * Every input existed. `liquidCash` says what is in the account, `upcomingBills`
 * says what is dated and due, and `unusualSpending` reads the history. Nothing
 * put them together, so the one question a household actually asks between pay
 * days — *will this last?* — had no answer anywhere in the application.
 *
 * ## Why this is the most dangerous file here
 *
 * Everything else in `domain/` describes what happened. This describes what has
 * **not happened yet**, which is a claim of a different kind, and the failure
 * mode is not a wrong number but a comfortable one. So:
 *
 * **It never predicts income.** Salary is not a record — it is a pattern in the
 * transactions — and a forecast that assumes the next one arrives is a forecast
 * that says *you are fine* on the strength of something nobody promised. The
 * next expected credit is reported **beside** the figure, as an observation from
 * history, and is never added to it.
 *
 * **It counts ordinary spending, not just bills.** This is the trap that makes
 * an honest-looking forecast dishonest. A household with ₹1,40,500 and ₹53,500
 * of dated bills has not got ₹87,000 to spend — their own history says the
 * groceries, fuel and everything else come to far more than nothing. Leaving
 * that out produces a reassuring number that is wrong in the direction that
 * costs money. It is included as a **stated estimate**, separately from the
 * dated bills, so the two can be told apart.
 *
 * **It never says the household is fine.** A shortfall is a fact: on a given
 * day, known outgoings exceed known cash. Sufficiency is not a fact, because
 * unrecorded spending happens every day. So the absence of a shortfall is
 * reported as *"nothing here says it runs out"* — a statement about this
 * calculation, not about the household's month.
 *
 * **It refuses without history.** Fewer than `MIN_MONTHS` of transactions and
 * the typical-spend estimate has no basis. It says so and forecasts on the
 * dated bills alone, labelled as such, rather than quietly using a smaller
 * sample.
 */

import { addDays, daysBetween, today } from '../core/dates.js';
import { accountBalances, liquidCash } from './finance.js';

/** Fewer months than this and "typical" is one month with a name. */
export const MIN_MONTHS = 2;

const monthOf = (date) => String(date ?? '').slice(0, 7);

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/**
 * What a household spends in a day when nothing in particular is happening.
 *
 * Bills are excluded on purpose: they are dated and counted separately, and
 * counting them twice is the arithmetic error that would make this useless.
 * What is left is the daily drip — groceries, fuel, a meal — which is the part
 * a household under-estimates and the part a bills-only forecast ignores.
 *
 * @returns {{perDay: number, months: number, why: string|null}}
 */
export function typicalDailySpend(transactions, { billCategories = null, clock = Date.now } = {}) {
  const skip = billCategories ?? new Set(['rent', 'emi', 'EMI', 'loan-repayment',
    'insurance', 'credit-card', 'bills', 'subscription', 'self-transfer',
    'investment-out', 'business-outlay', 'sweep', 'p2p-out']);

  const perMonth = new Map();
  const now = today(clock);

  for (const row of transactions ?? []) {
    if (!row || row.deletedAt) continue;
    if (row.kind !== 'expense' && row.direction !== 'out') continue;
    if (row.kind === 'transfer' || row.kind === 'income') continue;
    if (skip.has(row.category)) continue;
    const month = monthOf(row.date);
    if (!month || row.date > now) continue;
    perMonth.set(month, (perMonth.get(month) ?? 0) + (row.amount ?? 0));
  }

  // The month in progress is dropped: it is a partial total, and dividing a
  // partial month by a whole month's days understates every day of it.
  const complete = [...perMonth].filter(([month]) => month < monthOf(now));

  if (complete.length < MIN_MONTHS) {
    return {
      perDay: 0,
      months: complete.length,
      why: 'there is not enough history here to say what a usual day costs, so '
        + 'only the dated bills are counted below',
    };
  }

  return {
    perDay: Math.round(median(complete.map(([, amount]) => amount)) / 30),
    months: complete.length,
    why: null,
  };
}

/**
 * The next credit the history leads you to expect — reported, never counted.
 *
 * A regular incoming amount on a regular day is what a salary looks like from
 * the outside. Saying so is useful; *relying* on it is the thing this file
 * refuses to do, because nobody has promised it.
 */
export function nextExpectedIncome(transactions, { from = null, clock = Date.now } = {}) {
  const start = from ?? today(clock);
  const credits = (transactions ?? [])
    .filter((row) => row && !row.deletedAt && (row.kind === 'income' || row.direction === 'in'))
    .filter((row) => row.date <= start);

  if (credits.length < MIN_MONTHS) return null;

  // The day of the month it usually lands on, and the usual size.
  const days = credits.map((row) => Number(String(row.date).slice(8, 10)));
  const day = median(days);
  const amount = median(credits.map((row) => row.amount ?? 0));
  if (!day || !amount) return null;

  const [year, month] = start.split('-').map(Number);
  const thisMonth = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const next = thisMonth > start
    ? thisMonth
    : `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { date: next, amount, from: credits.length };
}

/**
 * Cash, against what is known to be leaving it.
 *
 * @param {object[]} accounts
 * @param {object[]} transactions
 * @param {object[]} bills as `upcomingBills` returns — dated and known
 * @param {{days?: number, from?: string, clock?: () => number}} [options]
 * @returns {{cash, perDay, lowest: {date, amount}, shortfall: {date, amount}|null,
 *            income: object|null, assumptions: string[], why: string|null}}
 */
export function cashRunway(accounts, transactions, bills, {
  days = 45, from = null, clock = Date.now,
} = {}) {
  const start = from ?? today(clock);
  const cash = liquidCash(accountBalances(accounts ?? [], transactions ?? []));
  const daily = typicalDailySpend(transactions, { clock });
  const income = nextExpectedIncome(transactions, { from: start, clock });

  const dated = new Map();
  for (const bill of bills ?? []) {
    // A bill already overdue is money that has not left yet, so it counts from
    // today rather than from a date in the past — dropping it would make the
    // forecast cheerier than the household's own bank.
    const on = bill.dueOn < start ? start : bill.dueOn;
    if (daysBetween(start, on) > days) continue;
    // An amount nobody knows cannot be subtracted. It is named in the
    // assumptions instead, so the figure is short by a stated unknown rather
    // than by a silent zero.
    if (bill.amount === null || bill.amount === undefined) continue;
    dated.set(on, (dated.get(on) ?? 0) + bill.amount);
  }

  let balance = cash;
  let lowest = { date: start, amount: cash };
  let shortfall = null;

  for (let step = 0; step <= days; step++) {
    const date = addDays(start, step);
    balance -= dated.get(date) ?? 0;
    if (step > 0) balance -= daily.perDay;
    if (balance < lowest.amount) lowest = { date, amount: balance };
    if (balance < 0 && !shortfall) shortfall = { date, amount: balance };
  }

  const assumptions = [];
  if (daily.perDay) {
    // No figure in the sentence: this module has no currency formatter and
    // printing minor units raw is how a ₹50 fee once read as "differ by 5000".
    // `perDay` is returned beside it for whoever does have one.
    assumptions.push(`a usual day's spending is taken as the median of ${daily.months} `
      + 'complete months, and excludes the bills counted above');
  } else if (daily.why) {
    assumptions.push(daily.why);
  }
  if (income) {
    assumptions.push('money expected to arrive is not counted — the next credit your '
      + 'history suggests is reported beside this figure, not inside it');
  }
  const unknownBills = (bills ?? []).filter((bill) => bill.amount === null || bill.amount === undefined);
  if (unknownBills.length) {
    assumptions.push(`${unknownBills.length} bill${unknownBills.length === 1 ? '' : 's'} `
      + 'here have no amount recorded and are not subtracted, so the real figure is lower');
  }

  return {
    cash,
    perDay: daily.perDay,
    lowest,
    shortfall,
    income,
    assumptions,
    why: daily.why,
  };
}

/** A sentence that does not promise anything it cannot know. */
export function describeRunway(runway, money = (n) => String(n)) {
  if (!runway) return null;

  if (runway.shortfall) {
    return `On ${runway.shortfall.date} what is known to be leaving exceeds what is `
      + `in the account, by ${money(Math.abs(runway.shortfall.amount))}.`
      + (runway.income
        ? ` The next credit your history suggests is ${money(runway.income.amount)} around `
          + `${runway.income.date}, which is not counted above.`
        : '');
  }

  // Deliberately not "you are fine". Unrecorded spending happens every day, and
  // this arithmetic cannot see it.
  return 'Nothing recorded here runs the account out in the next few weeks — the '
    + `lowest it reaches is ${money(runway.lowest.amount)} on ${runway.lowest.date}, `
    + `counting only what is known, and about ${money(runway.perDay)} a day of usual spending.`;
}
