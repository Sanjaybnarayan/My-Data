/**
 * When a credit card bill is due, and how much of it.
 *
 * ## The gap
 *
 * `account.statementDay` and `account.dueDay` are on the account form, in a
 * group called *Card*, and were read by nothing. `upcomingBills` knows about
 * recurring payments and loans and has never heard of cards.
 *
 * Measured on a household with a card, both days recorded, and ₹38,000 sitting
 * on it unpaid:
 *
 *     statement day        : 18 of the month
 *     payment due day      : 5 of the month
 *     outstanding on it    : ₹38,000
 *     upcoming bills found : 0
 *
 * A missed card payment is the most expensive thing this application could
 * fail to mention: interest at around forty per cent a year, backdated to the
 * purchase date so the interest-free period is lost too, plus a late fee, plus
 * a mark on a credit record. Every other reminder in here matters less.
 *
 * ## What is actually due
 *
 * **The statement balance, not the current one.** A card bills in cycles: what
 * you owe on the due day is what was outstanding when the statement cut, and
 * anything bought since belongs to the next cycle. Reporting the current
 * balance would overstate the bill by however much has been spent this month,
 * and a household paying that figure would be handing the bank an interest-free
 * loan on the difference.
 *
 * ## What this is not
 *
 * **The bank's own statement.** Interest already accrued on a revolving
 * balance, a fee charged on the statement date, a refund that landed after the
 * cut — none of those are knowable from the rows here unless the card's own
 * statement was imported. So this says what the recorded transactions imply,
 * and every sentence it produces says the card's statement is the figure that
 * counts.
 */

import { addable } from '../core/money.js';
import { today } from '../core/dates.js';
import { settled } from '../data/integrity.js';

/** A card that could produce a bill at all. */
export function isBillableCard(account) {
  return settled(account)
    && account.kind === 'credit card'
    && account.archived !== true;
}

/**
 * The date a day-of-month falls on, clamped to the length of that month.
 *
 * The 31st of February is the 28th, and a card with a due day of 31 bills on
 * the last day of every short month rather than skipping them.
 */
function onDay(year, month, day) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

const shift = (day, months) => {
  const [y, m] = day.split('-').map(Number);
  const total = (y * 12) + (m - 1) + months;
  return [Math.floor(total / 12), (total % 12) + 1];
};

/**
 * The most recent statement date on or before `from`, and the payment due for
 * it.
 *
 * The due day is a day *of the month*, and on most cards it falls after the
 * statement — but not always in the same month. A statement cutting on the
 * 18th with a due day of the 5th is due on the 5th of the *following* month;
 * one cutting on the 2nd with a due day of the 20th is due the same month. So
 * the due date is the first occurrence of the due day strictly after the
 * statement date, rather than an assumption about which month it lands in.
 */
export function cycleFor(account, from) {
  const [year, month] = from.split('-').map(Number);

  let statement = onDay(year, month, account.statementDay);
  if (statement > from) {
    const [py, pm] = shift(from, -1);
    statement = onDay(py, pm, account.statementDay);
  }

  const [sy, sm] = statement.split('-').map(Number);
  let due = onDay(sy, sm, account.dueDay);
  if (due <= statement) {
    const [ny, nm] = shift(statement, 1);
    due = onDay(ny, nm, account.dueDay);
  }

  return { statement, due };
}

/**
 * What was owed on the card when the statement cut.
 *
 * Everything on the card up to and including the statement date: purchases
 * increase it, payments and refunds reduce it. Returned as a positive amount
 * owed, or zero when the card was clear or in credit.
 */
export function statementBalance(account, transactions, statement) {
  let owed = 0;

  for (const txn of transactions ?? []) {
    if (!settled(txn)) continue;
    if (String(txn.date) > statement) continue;

    const amount = addable(txn.amount);
    // Spending on the card adds to what is owed.
    if (txn.account === account.id) {
      owed += txn.direction === 'in' || txn.kind === 'income' ? -amount : amount;
    }
    // Money moved *to* the card from somewhere else is a payment against it.
    if (txn.toAccount === account.id) owed -= amount;
  }

  return Math.max(0, Math.round(owed));
}

/**
 * Card payments falling due within `days`.
 *
 * @returns {Array<{id, account, name, statement, dueOn, amount, days,
 *                  overdue, why}>}
 *   `amount` is null when the statement balance cannot be worked out, and
 *   `why` says so. A due date with no amount is still worth showing: knowing
 *   *when* is most of the value, and inventing a figure would be worse than
 *   admitting the gap.
 */
export function cardBills(accounts, transactions, { from = today(), days = 30 } = {}) {
  const out = [];

  for (const account of (accounts ?? []).filter(isBillableCard)) {
    // No due day, nothing to say. Guessing one from the statement day would be
    // an invented deadline on the one bill where being wrong is expensive.
    if (!(account.dueDay >= 1 && account.dueDay <= 31)) continue;

    const hasStatementDay = account.statementDay >= 1 && account.statementDay <= 31;
    const cycle = hasStatementDay
      ? cycleFor(account, from)
      // With no statement day there is no cycle to bound, so the amount is
      // unknowable — but the date is not, and it is the half that matters.
      : { statement: null, due: nextOccurrence(account.dueDay, from) };

    const away = daysBetween(from, cycle.due);
    if (away > days) continue;

    const amount = cycle.statement
      ? statementBalance(account, transactions, cycle.statement)
      : null;

    // Nothing owed is not a bill. A card cleared every month should not
    // produce a reminder every month, or the reminders stop being read.
    if (amount === 0) continue;

    out.push({
      id: `card:${account.id}:${cycle.due}`,
      account: account.id,
      name: account.name,
      statement: cycle.statement,
      dueOn: cycle.due,
      amount,
      days: away,
      overdue: away < 0,
      why: cycle.statement ? null
        : 'no statement day is recorded for this card, so how much is due '
          + 'cannot be worked out from here — only when',
    });
  }

  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** The next occurrence of a day-of-month, on or after `from`. */
function nextOccurrence(day, from) {
  const [year, month] = from.split('-').map(Number);
  const thisMonth = onDay(year, month, day);
  if (thisMonth >= from) return thisMonth;
  const [ny, nm] = shift(from, 1);
  return onDay(ny, nm, day);
}

const DAY_MS = 24 * 60 * 60 * 1000;
function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

/**
 * One card bill, as a sentence.
 *
 * @param {(n: number) => string} [money]
 */
export function describeCardBill(bill, money = (n) => String(n)) {
  if (!bill) return null;
  if (bill.amount === null) return `${bill.name}: ${bill.why}.`;

  const when = bill.overdue
    ? `was due ${-bill.days} ${-bill.days === 1 ? 'day' : 'days'} ago`
    : bill.days === 0 ? 'is due today'
      : `is due in ${bill.days} ${bill.days === 1 ? 'day' : 'days'}`;

  return `${money(bill.amount)} on ${bill.name} ${when}, from the statement `
    + `that closed on ${bill.statement}. Anything spent since is on the next `
    + 'one. The card’s own statement is the figure that counts.';
}
