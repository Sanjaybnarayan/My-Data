/**
 * The written summary on the dashboard.
 *
 * Deterministic sentence generation over the same data the widgets show. No
 * model is called — this is a template picking the two or three things that
 * are actually notable today, in priority order, and saying them plainly.
 *
 * It says less rather than padding. "Nothing needs attention" is a useful
 * sentence; four sentences restating the widgets below it is not.
 */

import { formatCompact } from '../core/money.js';
import { formatDay } from '../core/dates.js';
import * as fin from '../domain/finance.js';
import { t } from '../core/locale.js';

export function summarise(data) {
  const parts = [];

  const overdue = data.reminders.filter((r) => r.group === 'expiry' && r.days < 0);
  const urgent = data.reminders.filter((r) => r.group === 'expiry' && r.days >= 0 && r.days <= 14);

  if (overdue.length) {
    parts.push(overdue.length === 1
      ? `${overdue[0].title} — ${overdue[0].label.toLowerCase()} lapsed ${-overdue[0].days} days ago.`
      : `${overdue.length} things have lapsed, the oldest being ${overdue.at(-1).title}.`);
  }

  if (urgent.length) {
    parts.push(urgent.length === 1
      ? `${urgent[0].title}'s ${urgent[0].label.toLowerCase()} falls due ${urgent[0].days === 0 ? 'today' : `in ${urgent[0].days} days`}.`
      : `${urgent.length} renewals fall due within a fortnight.`);
  }

  const dueSoon = data.bills.filter((b) => b.overdue || b.dueOn <= addDaysSafe(7));
  if (dueSoon.length) {
    // A card with no statement day is due on a known date for an unknown
    // amount. Counting it as zero would make the sentence read as though the
    // week were cheaper than it is, so the bill is named instead of added.
    const { total, unknown } = fin.billsTotal(dueSoon);
    const gap = unknown
      ? ` ${unknown === 1 ? 'One more card bill falls' : `${unknown} more card bills fall`} `
        + 'due with no statement day recorded, so the amount is not known here.'
      : '';
    if (total > 0) parts.push(`${formatCompact(total)} of bills is due in the next week.${gap}`);
    else if (gap) parts.push(gap.trim());
  }

  /*
   * The base is `previousToDate`, not `previous`, and the sentence says which.
   *
   * This branch used to read "Spending is 94% below last month" on the 2nd for
   * a household that had spent exactly its usual amount on both days — while
   * the branch directly below it, in the same function, already knew to say
   * "so far this month". The guard was on `previous.expense`, the whole of
   * last month, so a partial month always cleared it and the sentence was
   * always about a fall.
   *
   * `comparePeriods` now measures the change against the same days of the
   * previous month, and the wording follows it: an assistant that states a
   * trend has to state what it compared, because nobody can check a sentence
   * against a caption it does not carry.
   */
  const { current, expenseChange, partial } = data.compare;

  // No guard on the base span's total beside this one. `changePercent` returns
  // null when the base is zero, `?? 0` fails the threshold, and a second guard
  // that can never independently fail is a check this repository has learned
  // to remove rather than keep for reassurance. Mutating it away changed no
  // output, which is how it was found.
  if (Math.abs(expenseChange ?? 0) >= 15) {
    const dir = expenseChange > 0 ? 'above' : 'below';
    parts.push(t(`summary.spend.${dir}${partial ? '.soFar' : ''}`, {
      pct: Math.abs(Math.round(expenseChange)),
      amount: formatCompact(current.expense),
    }));
  } else if (current.expense > 0) {
    parts.push(t('summary.spend.soFar', { amount: formatCompact(current.expense) }));
  }

  const over = fin.budgetStatus(data.budget ?? [], data.transaction ?? [])
    .filter((b) => b.state === 'over');
  if (over.length) {
    parts.push(over.length === 1
      ? `The ${over[0].category} budget is ${formatCompact(-over[0].remaining)} over.`
      : `${over.length} budgets are over for the month.`);
  }

  const birthdays = data.reminders.filter((r) => r.group === 'date' && r.days <= 7);
  if (birthdays.length) {
    parts.push(birthdays.length === 1
      ? `${birthdays[0].title} on ${formatDay(birthdays[0].date)}.`
      : `${birthdays.length} family dates this week.`);
  }

  if (!parts.length) {
    return 'Nothing needs attention today. Everything is in date, no bills are due '
      + 'this week, and no budget is over.';
  }

  // Three sentences is the most anyone reads on a dashboard.
  return parts.slice(0, 3).join(' ');
}

function addDaysSafe(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
