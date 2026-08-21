/**
 * Does what a staff member was paid match what was agreed?
 *
 * `staff.monthlyPay` is an agreement and the transactions are what happened,
 * and `docs/HOUSEHOLD_STAFF.md` is emphatic that one must never stand in for
 * the other. Showing them side by side was the previous tranche. Saying **when
 * they disagree** is this one, and it is the point of recording either.
 *
 * ## What it refuses to compare
 *
 * A comparison needs an expectation, and most staff records do not carry one
 * this function can use:
 *
 *  - **`paidEvery: 'task'`** — there is no period, so there is no month that
 *    is short. A gardener paid per visit who came twice is not underpaid.
 *  - **`paidEvery: 'week'` or `'day'`** — an agreed *monthly* figure cannot be
 *    checked against weekly pay without deciding how many weeks are in a
 *    month. 4.33 is a convention, not something this household agreed to, and
 *    a shortfall computed from it would be arithmetic presented as a fact.
 *  - **No agreed figure at all** — nothing to compare against.
 *
 * In each case the answer is that this cannot be checked, and *why*, rather
 * than a comparison that looks authoritative.
 *
 * ## What it will not judge
 *
 * **The month in progress.** It is not over, and a wage that has not been paid
 * yet is not a wage that was missed.
 *
 * **The joining month and the leaving month.** Somebody who started on the
 * 20th is not owed a full month, and nothing on the record says what they are
 * owed instead. Pro-rating it would be this function inventing the agreement
 * rather than checking it. Those months are listed as not judged, so a person
 * can see they were skipped rather than wondering why the total looks short.
 *
 * **A month containing unpaid leave.** Deducting for it needs a daily rate,
 * and dividing a monthly figure by a number of working days is arithmetic this
 * household never agreed to — the same objection as the weekly agreement
 * above. Paid leave changes nothing and is ignored here, which is what *paid*
 * means.
 */

import { nextMonth, today as todayOf } from '../core/dates.js';

/** What a month's payments came to, against what was agreed. */
export const STATUS = Object.freeze({
  AGREES: 'agrees',
  SHORT: 'short',
  OVER: 'over',
  NOTHING: 'nothing recorded',
  NOT_JUDGED: 'not judged',
});

const monthOf = (date) => String(date ?? '').slice(0, 7);

/**
 * Why a staff record cannot be checked against its payments, or null.
 *
 * Returned rather than thrown: a screen wants to say what is missing, and
 * "this cannot be checked" is a useful answer where a silent empty list is
 * not.
 */
export function whyNotComparable(staff) {
  if (!staff) return 'there is no staff record';
  if (!staff.monthlyPay) return 'no monthly pay has been agreed on this record';
  if (staff.paidEvery === 'task') {
    return 'this is paid per task, so there is no month that can be short';
  }
  if (staff.paidEvery && staff.paidEvery !== 'month') {
    return `this is paid every ${staff.paidEvery}, and an agreed monthly figure `
      + 'cannot be checked against that without deciding how many of them are in a month';
  }
  return null;
}

/**
 * Month by month, what was paid against what was agreed.
 *
 * @param {object} staff the record, for `monthlyPay`, `paidEvery`, `startedOn`, `endedOn`
 * @param {Array<{date?: string, amount?: number}>} payments
 * @param {string} [today] injectable, because "the month in progress" is a
 *   boundary and a boundary needs testing on both sides
 * @param {Array<{from?: string, to?: string, paid?: boolean}>} [leave] absences;
 *   only the unpaid ones change anything
 */
export function reconcile(staff, payments = [], today = todayOf(), leave = []) {
  const why = whyNotComparable(staff);
  if (why) return { comparable: false, why, months: [] };

  const agreed = staff.monthlyPay;
  const dated = payments.filter((row) => row?.date);

  const earliest = dated.map((row) => monthOf(row.date)).sort()[0] ?? null;
  const from = staff.startedOn ? monthOf(staff.startedOn) : earliest;
  if (!from) return { comparable: true, why: null, months: [] };

  // The month in progress is not over, so it is not judged and not listed.
  const lastWhole = monthOf(addMonth(today, -1));
  const to = staff.endedOn && monthOf(staff.endedOn) < lastWhole
    ? monthOf(staff.endedOn)
    : lastWhole;

  const partMonths = new Set([
    staff.startedOn ? monthOf(staff.startedOn) : null,
    staff.endedOn ? monthOf(staff.endedOn) : null,
  ].filter(Boolean));

  const unpaidMonths = monthsTouchedByUnpaidLeave(leave);

  const months = [];
  for (let month = from; month <= to; month = nextMonth(month)) {
    const inMonth = dated.filter((row) => monthOf(row.date) === month);
    const paid = inMonth.reduce((sum, row) => sum + Math.abs(row.amount ?? 0), 0);

    // Skipped rather than pro-rated — see the header. The reason travels with
    // the row, because "not judged" without a why is a screen going quiet.
    const why = partMonths.has(month) ? 'a part month'
      : unpaidMonths.has(month) ? 'unpaid leave in this month'
        : null;

    if (why) {
      months.push({ month, paid, agreed, difference: 0, status: STATUS.NOT_JUDGED, why });
      continue;
    }

    months.push({
      month,
      paid,
      agreed,
      difference: paid - agreed,
      why: null,
      status: !inMonth.length ? STATUS.NOTHING
        : paid === agreed ? STATUS.AGREES
          : paid < agreed ? STATUS.SHORT : STATUS.OVER,
    });
  }

  return { comparable: true, why: null, months };
}


/**
 * Every month an unpaid absence touches, including the ones it spans.
 *
 * A single absence with no `to` is one day. One that runs across a month
 * boundary makes **both** months unjudgeable, because the deduction lands in
 * whichever month the household decided, and the record does not say.
 */
function monthsTouchedByUnpaidLeave(leave) {
  const out = new Set();
  for (const row of leave ?? []) {
    if (!row?.from || row.paid !== false) continue;
    const last = monthOf(row.to && row.to > row.from ? row.to : row.from);
    for (let month = monthOf(row.from); month <= last; month = nextMonth(month)) out.add(month);
  }
  return out;
}

/** The months that disagree, newest first — the only ones worth a screen. */
export function disagreements(result) {
  return (result?.months ?? [])
    .filter((row) => row.status !== STATUS.AGREES && row.status !== STATUS.NOT_JUDGED)
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** One month, as a sentence. */
export function describeMonth(row) {
  if (!row) return null;
  switch (row.status) {
    case STATUS.NOTHING: return `${row.month}: nothing recorded`;
    case STATUS.SHORT: return `${row.month}: short by ${minor(row.agreed - row.paid)}`;
    case STATUS.OVER: return `${row.month}: ${minor(row.paid - row.agreed)} more than agreed`;
    case STATUS.NOT_JUDGED: return `${row.month}: not judged — ${row.why ?? 'a part month'}`;
    default: return `${row.month}: agrees`;
  }
}

// Rendered by the caller, which knows the household's currency. This keeps the
// domain free of formatting and the number honest — minor units throughout.
const minor = (value) => String(value);

/** `2026-07` plus n months, as a day, so `nextMonth` has something to walk. */
function addMonth(day, n) {
  const d = new Date(`${monthOf(day)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}
