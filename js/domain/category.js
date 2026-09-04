/**
 * One category, looked at closely.
 *
 * The overview says "groceries, 49%" and that is where the trail used to end.
 * A household reading that has a next question — *on what, to whom, is it
 * always this much, is a bill inside it* — and answering it meant opening the
 * ledger, setting a filter, and reading a list of dates.
 *
 * So this assembles what a category is: the total and what it is made of, the
 * shape of it over a year, the payees behind it, the commitments filed under
 * it, and the budget it is measured against. Pure, like the rest of
 * `js/domain/` — no storage, no DOM, no clock but the one passed in — so the
 * numbers on the screen can be checked without a browser.
 *
 * Everything is in minor units.
 */

import { addable, changePercent } from '../core/money.js';
import { settled } from '../data/integrity.js';
import {
  today, withinRange, startOfMonth, endOfMonth, addMonths, formatDay,
} from '../core/dates.js';
import { budgetStatus } from './finance.js';
import { categoryLabel } from './categorise.js';

const sumOf = (rows) => rows.reduce((total, row) => total + addable(row.amount), 0);

/**
 * What to call a category at the top of its own screen.
 *
 * `categoryLabel` knows eighteen of the forty-six categories the schema
 * offers; for the rest it returns the stored key, which is fine inside a chart
 * legend and wrong as a heading — the screen read `utilities` in the place a
 * page title goes.
 *
 * Only the first letter, not title case. `EMI` must not become `Emi` and
 * `rental income` must not become `Rental Income`; sentence case is what the
 * rest of this application writes and it leaves both alone.
 */
export const categoryTitle = (key) => {
  const label = categoryLabel(key);
  return label === key ? String(key).charAt(0).toUpperCase() + String(key).slice(1) : label;
};

/**
 * The payees inside a category, largest first.
 *
 * Grouped on the payee as typed, because that is the only name the household
 * has given these rows — the statement importer's counterparty resolution
 * runs on imported narrations and never touches a hand-entered row. Rows with
 * no payee are one bucket rather than many empty ones, and it is named as
 * unnamed rather than left blank, because a blank line in a ranked list reads
 * as a rendering fault.
 */
function payeesOf(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = String(row.payee ?? '').trim();
    const bucket = buckets.get(key) ?? { name: key, total: 0, count: 0, last: row.date };
    bucket.total += addable(row.amount);
    bucket.count += 1;
    if (row.date > bucket.last) bucket.last = row.date;
    buckets.set(key, bucket);
  }

  // The share each takes of the category, which is the thing a ranked list is
  // for: `Big Bazaar ₹3,200` is a row the ledger already has, and *69% of your
  // groceries* is not anywhere else in the application.
  const total = [...buckets.values()].reduce((all, one) => all + one.total, 0);
  return [...buckets.values()]
    .map((one) => ({ ...one, share: total ? Math.round((one.total / total) * 100) : 0 }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Month by month for this category, oldest first.
 *
 * `partial` on the month in progress, for the same reason `monthlySeries`
 * carries it: three days in, a bar a tenth the height of its neighbours is not
 * a fall in spending, and a chart that does not say so invites reading it as
 * one.
 */
function seriesOf(rows, monthsBack, now) {
  const start = startOfMonth(addMonths(now, -(monthsBack - 1)));
  const out = [];
  for (let i = 0; i < monthsBack; i++) {
    const from = addMonths(start, i);
    const bounds = { from, to: endOfMonth(from) };
    out.push({
      month: from.slice(0, 7),
      label: formatDay(from, { withYear: false }).replace(/^\d+ /, ''),
      partial: from.slice(0, 7) === now.slice(0, 7) && now < endOfMonth(now),
      value: sumOf(rows.filter((row) => withinRange(row.date, bounds))),
    });
  }
  return out;
}

/**
 * Everything one category is.
 *
 * @param {string} category the stored key, not a label — the same string the
 *   breakdown buckets on, so a screen linking here cannot name a category the
 *   data does not use.
 */
export function categoryDetail(category, {
  transactions = [], recurring = [], budgets = [], months = 12, clock = Date.now,
} = {}) {
  const now = today(clock);
  const mine = (transactions ?? [])
    .filter((row) => settled(row) && (row.category || 'other') === category);

  const spending = mine.filter((row) => row.kind === 'expense');
  const income = mine.filter((row) => row.kind === 'income');
  // Which direction this category runs in, taken from the rows rather than
  // from a list of category names kept somewhere else: `salary` is income and
  // `groceries` is spending, but a household is free to file anything anywhere
  // and the screen has to describe what is actually there.
  const rows = spending.length >= income.length ? spending : income;
  const kind = rows === income ? 'income' : 'expense';

  const inMonth = (month) => {
    const bounds = { from: startOfMonth(month), to: endOfMonth(month) };
    return sumOf(rows.filter((row) => withinRange(row.date, bounds)));
  };

  const thisMonth = inMonth(now);
  const lastMonth = inMonth(addMonths(now, -1));
  // From the rows that are counted, not from every row filed under the word.
  // Read off `mine`, a category holding only transfers — `own account`,
  // `sweep`, `sent to person` are all real ones — has no spending and no
  // income, so `count` is zero while `since` is a date, and the screen wrote
  // "0 recorded since 4 Jan 2026". Two numbers about two different sets, in
  // one sentence.
  const dates = rows.map((row) => row.date).filter(Boolean).sort();

  return {
    category,
    kind,
    rows: [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date))),
    count: rows.length,
    total: sumOf(rows),
    largest: rows.reduce((most, row) => Math.max(most, addable(row.amount)), 0),
    // Rounded down to the minor unit, because an average of an integer number
    // of paise is not a fraction of one.
    average: rows.length ? Math.round(sumOf(rows) / rows.length) : 0,
    since: dates[0] ?? null,
    thisMonth,
    lastMonth,
    // A month in progress is not compared with a whole month. The caller is
    // told the month is partial and can say so; it is not corrected here into
    // a projection nobody asked for.
    partial: now < endOfMonth(now),
    // `(base, now)`, in that order. Inverted, a category that had nothing
    // last month and something this month reports as a 100% *fall* — which is
    // both the wrong sign and a claim about a base that does not exist.
    // `changePercent` returns null for a zero base, and `metric` draws no
    // delta at all for null, which is the honest rendering of it.
    change: changePercent(lastMonth, thisMonth),
    series: seriesOf(rows, months, now),
    payees: payeesOf(rows),
    // Filed under this category and still running. An ended commitment is
    // history, and a due date in a list of what is coming has to be coming.
    commitments: (recurring ?? [])
      .filter((row) => settled(row) && row.active !== false
        && (row.category || 'other') === category
        && (!row.endsOn || row.endsOn >= now))
      .sort((a, b) => String(a.nextDueOn ?? '').localeCompare(String(b.nextDueOn ?? ''))),
    budget: budgetStatus(budgets ?? [], transactions ?? [], { month: now })
      .find((row) => row.category === category) ?? null,
  };
}
