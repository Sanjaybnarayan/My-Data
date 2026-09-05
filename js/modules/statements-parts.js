/**
 * The parts of the import screen that depend on nothing.
 *
 * Split out for the reason `tools/module-size.mjs` gives when it refuses a
 * crowded file room to grow: move code out rather than raise the number. At
 * 827 lines `statements.js` is one `render()` with the whole import pipeline
 * inside it, and these are the pieces that could leave without being
 * rewritten — pure functions of their arguments, closing over none of its
 * state.
 *
 * What remains still wants breaking up. This is the room to make one fix.
 */

import { h } from '../ui/dom.js';
import { card, cardHeader, restOfList } from '../ui/components/basics.js';
import { referencesIn } from '../domain/paymentapp.js';

export function instructions() {
  return card({}, [
    cardHeader('How this works', null, { iconName: 'info' }),
    h('ol', { class: 'muted' }, [
      h('li', {}, 'Choose every statement you have this month — PDF or CSV, bank accounts and credit cards, all people, at once.'),
      h('li', {}, 'Each file is matched to an account by the number printed on it. Unknown accounts can be created here.'),
      h('li', {}, 'Rows already imported are skipped, so re-uploading the same month is harmless.'),
      h('li', {}, 'Nothing is written until you have seen what each file contains.'),
    ]),
  ]);
}

/* ---------------------------------------------------------------- helpers */

/**
 * Every fingerprint already on record.
 *
 * Read once per batch rather than queried per row: a household with a few
 * years of history has tens of thousands of transactions, and one pass over
 * them costs less than one index lookup per imported line.
 */
export async function importedKeys(db) {
  const rows = await db.repo('transaction').list({ decrypt: false, limit: Infinity });
  return {
    keys: new Set(rows.map((row) => row.importKey).filter(Boolean)),
    // Every bank reference already on record. A payment app's row and a bank's
    // row are the same movement written down twice, and the fingerprint cannot
    // see it: the narrations differ completely, so both would import and the
    // household's spending would double. The UTR is the one thing both records
    // carry — the bank writes it into its narration — and is the only exact
    // link between them. See `domain/paymentapp.js`.
    references: referencesIn(rows),
  };
}

/**
 * Whether a file is a table rather than a page.
 *
 * By extension and type rather than by sniffing the bytes: a bank's CSV export
 * is served as everything from `text/csv` to `application/octet-stream`
 * depending on the browser, and the name is the one thing that stays put.
 */
export function isTable(file) {
  return /\.(csv|tsv|txt)$/i.test(file.name)
    || /^text\/(csv|tab-separated-values|plain)$/.test(file.type ?? '');
}

/** Where the household's own firms are kept. */
export const BUSINESSES = 'finance.businesses';

export const sameName = (a, b) => String(a ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  === String(b ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');

/*
 * How many unreadable rows the import preview names.
 *
 * The badge above the list reads "12 unreadable" and the list stopped at
 * five. What is hidden here is the reason a statement did not import
 * cleanly, so the count is the difference between "a few odd rows" and
 * "this file did not parse".
 */
export const UNREADABLE = 5;

/** What the unreadable-rows list is not showing. */
export function restOfUnreadable(total) {
  return restOfList(total, UNREADABLE);
}
