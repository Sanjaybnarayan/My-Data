/**
 * Anything about a period worth saying out loud.
 *
 * ## Why this is its own file
 *
 * It lived in `categorise.js`, which classifies transactions. These two things
 * are not the same job: classification decides what a row *is*, and this
 * decides what is worth telling a household about a month of them. The first
 * has no opinions and the second is nothing but opinions, carefully bounded.
 *
 * They shared a file because the notes were written where the data already
 * was. That file reached 974 lines and the size budget refused to let it grow
 * by one more import, which is the budget doing its job: the question it
 * forced was not "which line can go" but "what is doing two jobs here".
 */

import { addable } from '../core/money.js';
import { unusualSpending, describeUnusual } from './unusual.js';
import { summarise, peopleLedger, recurring, categoryLabel } from './categorise.js';

/**
 * Every insight is a fact with its arithmetic attached, not an opinion. The
 * threshold for saying something is that it would change a decision.
 */
export function insights(transactions, summary = summarise(transactions), {
  month = null, complete = true,
} = {}) {
  const notes = [];
  const list = transactions ?? [];
  const months = Math.max(1, summary.byMonth.length);

  // Spending unlike its own history, first, because it is the only note here
  // about something that *happened* — the rest describe the period's shape.
  // Measured on a household that spent ₹85,000 on healthcare having never spent
  // anything on it: the screen's whole output was that rent was the largest
  // category and two payments repeat. See `domain/unusual.js`.
  // The *largest* key, not the last one. `summary.byMonth` is grouped rather
  // than sorted, so `.at(-1)` returns whichever month happened to be grouped
  // last — it gave June for a period ending in July, and the note simply never
  // appeared. An ordering nothing promises is not an ordering.
  const latest = month
    ?? summary.byMonth.map((bucket) => bucket.key).sort().at(-1)
    ?? null;
  if (latest) {
    for (const finding of unusualSpending(list, { month: latest, complete })) {
      notes.push({
        kind: 'unusual',
        text: describeUnusual(finding, format, categoryLabel),
        amount: finding.amount,
      });
    }
  }

  if (summary.net < 0) {
    notes.push({
      kind: 'balance',
      text: `Over ${months} month${months === 1 ? '' : 's'} more left the account than came in.`,
      amount: summary.net,
    });
  }

  const uncategorised = list.filter((t) => t.rule === 'unmatched' && t.direction === 'out');
  if (uncategorised.length) {
    notes.push({
      kind: 'coverage',
      text: `${uncategorised.length} payments could not be categorised from the narration alone.`,
      amount: total(uncategorised),
    });
  }

  const top = summary.byCategory.filter((c) => c.kind === 'spending' && c.out > 0)[0];
  if (top) {
    notes.push({
      kind: 'largest-category',
      text: `${top.label} is the largest spending category, ${share(top.out, summary.spending)} of all spending.`,
      amount: top.out,
    });
  }

  const subs = recurring(list).filter((r) => r.category === 'subscription' || r.period === 'monthly');
  if (subs.length) {
    notes.push({
      kind: 'recurring',
      text: `${subs.length} payments repeat on a schedule, ${format(subs.reduce((sum, s) => sum + addable(s.amount), 0))} a cycle.`,
      amount: subs.reduce((sum, s) => sum + s.spent, 0),
    });
  }

  const cash = summary.byCategory.find((c) => c.key === 'cash');
  if (cash && cash.out > summary.spending * 0.05) {
    notes.push({
      kind: 'cash',
      text: `${share(cash.out, summary.spending)} of spending left as cash, where it stops being traceable.`,
      amount: cash.out,
    });
  }

  const charges = summary.byCategory.find((c) => c.key === 'charges');
  if (charges?.out) {
    notes.push({
      kind: 'charges',
      text: `${charges.count} bank charges over the period — most are avoidable.`,
      amount: charges.out,
    });
  }

  // Five thousand rupees, in paise. Below that a one-sided balance is a meal
  // somebody paid for, not something anybody is keeping track of.
  const worthChasing = 500_000;
  const owed = peopleLedger(list).filter((person) => person.balance < -worthChasing);
  if (owed.length) {
    notes.push({
      kind: 'p2p',
      text: `${owed.length} people have taken more from this account than has come back.`,
      amount: -owed.reduce((sum, person) => sum + addable(person.balance), 0),
    });
  }

  const payments = summary.byCategory.find((c) => c.key === 'payments');
  if (payments?.out) {
    notes.push({
      kind: 'payments',
      text: `${payments.count} payments went through an app that did not name the merchant.`,
      amount: payments.out,
    });
  }

  return notes;
}

// `categorise.js` keeps its own copy: this is four tokens, and exporting it
// would make a module-private helper part of that file's surface for one
// caller. Both spell it with `addable` so neither can drift into the string
// concatenation this file's own `?? 0` sites used to produce.
const total = (list) => list.reduce((sum, t) => sum + addable(t.amount), 0);

const share = (part, whole) => (whole ? `${Math.round((part / whole) * 100)}%` : '0%');
const format = (minor) => `₹${(minor / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
