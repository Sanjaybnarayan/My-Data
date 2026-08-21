/**
 * What is still covered, and what never was.
 *
 * The reminder engine already nags sixty days before a warranty expires,
 * because `warranty.expiresOn` carries `expiry` in the schema and
 * `domain/reminders.js` walks the schema rather than a list. That answers
 * *"which promises are about to run out"*.
 *
 * This answers the two questions the reminder cannot.
 *
 * **What is covered right now**, which is the question somebody asks with a
 * broken machine in front of them, at which point sixty days' notice is no use
 * at all.
 *
 * **What has no warranty recorded**, which is the more useful of the two and
 * cannot be a reminder by definition — nothing expires, so nothing fires. A
 * household that has recorded eleven purchases and three warranties is not a
 * household with eight uncovered things; it is far more likely a household
 * that stopped typing. Saying so is the point.
 *
 * ## What it refuses to call uncovered
 *
 * Something sold or disposed of. A warranty on a fridge that left the house is
 * not a gap, and listing it would teach somebody to skim the list — which is
 * how the real gaps get missed.
 */

export const STATE = Object.freeze({
  COVERED: 'covered',
  EXPIRED: 'expired',
  NOT_STARTED: 'not started yet',
  UNDATED: 'no expiry recorded',
});

const asDay = (value) => (value ? String(value).slice(0, 10) : '');

/** The state of one warranty on a given day. */
export function stateOf(warranty, on = new Date().toISOString().slice(0, 10)) {
  const expires = asDay(warranty?.expiresOn);
  const starts = asDay(warranty?.startsOn);

  if (!expires) return STATE.UNDATED;
  if (starts && starts > on) return STATE.NOT_STARTED;
  return expires >= on ? STATE.COVERED : STATE.EXPIRED;
}

/**
 * Every warranty, with what it covers and whether it still does.
 *
 * A warranty whose purchase has been deleted keeps its own row: the promise
 * was made, and losing the record of the object does not unmake it.
 */
export function cover(warranties = [], purchases = [], on = new Date().toISOString().slice(0, 10)) {
  const byId = new Map(purchases.filter((p) => p && !p.deletedAt).map((p) => [p.id, p]));

  return warranties
    .filter((w) => w && !w.deletedAt)
    .map((w) => ({
      warranty: w,
      purchase: byId.get(w.purchase) ?? null,
      state: stateOf(w, on),
    }))
    .sort((a, b) => String(a.warranty.expiresOn).localeCompare(String(b.warranty.expiresOn)));
}

/**
 * Things the household still owns with no warranty recorded against them.
 *
 * Disposed-of things are excluded and counted separately, so the number is
 * about the house as it stands.
 */
export function unwarranted(purchases = [], warranties = []) {
  const covered = new Set(warranties.filter((w) => w && !w.deletedAt).map((w) => w.purchase).filter(Boolean));

  const owned = purchases.filter((p) => p && !p.deletedAt && !p.disposedOn);
  const gone = purchases.filter((p) => p && !p.deletedAt && p.disposedOn).length;

  return {
    items: owned.filter((p) => !covered.has(p.id)),
    owned: owned.length,
    disposed: gone,
  };
}

/**
 * A sentence about the state of cover, or the honest refusal to draw one.
 *
 * With no purchases recorded there is nothing to say, and "nothing is covered"
 * would be a claim about a house rather than about a database.
 */
export function describeCover(rows, gaps) {
  if (!gaps.owned) return 'Nothing has been recorded yet, so there is nothing to say about cover.';

  const live = rows.filter((r) => r.state === STATE.COVERED).length;
  const missing = gaps.items.length;

  const first = live === 1 ? '1 thing is still under warranty' : `${live} things are still under warranty`;
  if (!missing) return `${first}, and everything recorded has one.`;

  return `${first}. ${missing} of ${gaps.owned} recorded belongings have no warranty against them — `
    + 'which may mean they have none, or may mean nobody typed it in.';
}
