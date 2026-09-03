/**
 * Rows whose amount this device cannot read.
 *
 * ## Why they exist at all
 *
 * The household's records live in *their* Google Sheet — that is the whole
 * shape of the backend — so the rows can be edited by hand, and a person who
 * types "twenty thousand" into an amount column has done nothing wrong. On the
 * way back, `Repository.applyRemote` writes the row without validating it, and
 * deliberately: a sync that rejected a row would lose it, and losing a
 * household's record is worse than holding a strange one.
 *
 * So a row with an unreadable amount is expected, and the question is only
 * what the arithmetic does with it.
 *
 * ## What it used to do
 *
 * `total` was `sum + t.amount`, which for a string concatenates. A month with
 * one hand-edited row reported spending of `"250000twenty thousand"` — not an
 * error, not a wrong number, but a corrupted one, formatted and shown.
 *
 * `total` now adds only finite numbers. That alone would trade a visible
 * corruption for a silent omission: the total would be right about the rows it
 * could read and say nothing about the one it could not, which is the same
 * fault this application has already been bitten by twice — a number that is
 * quietly about less than it claims.
 *
 * This is the other half. Nothing here fixes a row or guesses at it; it counts
 * what could not be read so a screen can say so.
 */

import { t } from '../core/locale.js';

/** Whether an amount is a number this application can do arithmetic on. */
export function isReadableAmount(value) {
  return Number.isFinite(value);
}

/**
 * The rows in a set whose amount cannot be summed.
 *
 * `undefined` is not counted. A great many entities have no amount at all and
 * never did — counting those would report thousands of "unreadable" rows and
 * teach somebody to ignore the number. Only a row that *has* an amount and
 * whose amount is not a finite number is a row somebody needs to look at.
 *
 * @param {readonly {id?: string, amount?: unknown}[]} rows
 * @returns {{count: number, ids: string[]}}
 */
export function unreadableAmounts(rows) {
  const bad = (rows ?? []).filter((row) => row?.amount !== undefined
    && row?.amount !== null
    && !isReadableAmount(row.amount));
  return { count: bad.length, ids: bad.map((row) => row?.id).filter(Boolean) };
}

/**
 * What to tell somebody, or null when there is nothing to tell.
 *
 * Says the total is about fewer rows than they might assume, and does not
 * guess at what the amount was meant to be — the row is in their sheet and
 * they are the only one who knows.
 */
export function describeUnreadable(report) {
  if (!report?.count) return null;
  return report.count === 1
    ? t('amounts.unreadable.one')
    : t('amounts.unreadable.many', { n: report.count });
}

/**
 * The rows a sync is holding out of the arithmetic.
 *
 * The same shape as the pair above and here for the same reason. A held row
 * names a record this device does not have, so `settled()` keeps it out of
 * every total — which on its own trades one fault for the other this module
 * was written about: the figure would be right about the rows it counted and
 * say nothing about the ones it did not.
 *
 * The difference from an unreadable amount is that this one usually fixes
 * itself: the next pull brings what the row names and the mark clears. So the
 * sentence says the total will change rather than sending somebody to their
 * spreadsheet.
 *
 * @param {readonly {id?: string, heldAt?: unknown}[]} rows
 * @returns {{count: number, ids: string[]}}
 */
export function heldRows(rows) {
  const held = (rows ?? []).filter((row) => Boolean(row?.heldAt));
  return { count: held.length, ids: held.map((row) => row?.id).filter(Boolean) };
}

/** What to tell somebody about them, or null when there is nothing to tell. */
export function describeHeld(report) {
  if (!report?.count) return null;
  return report.count === 1
    ? t('amounts.held.one')
    : t('amounts.held.many', { n: report.count });
}
