/**
 * One list of every place the household's own records disagree about money.
 *
 * ## Why this exists
 *
 * The application already found disagreements. It found them in four
 * different shapes, kept them in three different structures, and showed them
 * on two different screens — and a household with a wrong figure had to know
 * which screen to look at before it could find out. `evidence.js` compared
 * amounts across sources and reported them above the Messages tab of Finance.
 * `staffpay.js` compared wages paid against wages agreed and reported them on
 * one staff member's record. `sms.js` wrote `agreement: 'conflict'` onto the
 * message row and nothing listed those anywhere.
 *
 * Rule 57 says every financial event must be explainable. A disagreement a
 * person cannot find is not explainable, however carefully the module that
 * found it worded the sentence.
 *
 * ## What it does not do
 *
 * **It never picks a winner.** Every figure is named beside the source that
 * states it, and no record here carries a field meaning *this is the right
 * one*. `sms.js` already establishes the rule — the statement outranks a
 * message on `SOURCE_PRIORITY`, and that ranking is *reported*, never
 * applied — and a list that quietly resolved what its inputs refused to
 * resolve would undo it in one place for all of them.
 *
 * **It is derived, never stored.** A conflict written into the database
 * outlives the thing that caused it: correct the statement row and the stored
 * conflict still says the sources disagree. Every call reads the records as
 * they are now, so a conflict disappears exactly when the reason for it does.
 * That also means there is nothing to mark as resolved, and nothing here
 * pretends otherwise — resolving one of these means changing a record, not
 * ticking a box beside it.
 *
 * **A payment with one source is not a conflict**, and neither is a transfer
 * leg with no counterpart. Most statement rows have only the statement, and
 * most transfers are imported from one side. `evidence.js` makes that
 * argument for corroboration and it holds here: a list that called every
 * one-sided record a conflict would be a list nobody reads.
 *
 * ## One table, not five
 *
 * The kinds are the keys of `FINDERS`, and `CONFLICT_KINDS` is derived from
 * them. A hand-written list of kinds beside the finders that produce them is
 * the fault this repository has now found nine times, and it is not being
 * written a tenth.
 */

import { evidenceFor, orphanEvents, MATCH_DAYS, KIND } from './evidence.js';
import { reconcile, disagreements as wageDisagreements } from './staffpay.js';
import { t } from '../core/locale.js';

const plain = (value) => String(value ?? '').trim();
const live = (rows) => (rows ?? []).filter((row) => row && !row.deletedAt);

function daysApart(a, b) {
  const left = Date.parse(`${plain(a)}T00:00:00Z`);
  const right = Date.parse(`${plain(b)}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

/**
 * One figure, and the thing that states it.
 *
 * @typedef {object} Figure
 * @property {string} source what says this — a source kind, or `agreed`/`paid`
 * @property {string|null} id the record it came from, where there is one
 * @property {number|null} amount minor units
 * @property {string|null} date
 */

/**
 * One disagreement, whichever module found it.
 *
 * @typedef {object} MoneyConflict
 * @property {string} kind one of `CONFLICT_KINDS`
 * @property {string} entity the store the conflict is about
 * @property {string} id the row it is about, or the earlier of the two records
 *   for a payment that has no row at all
 * @property {Figure[]} figures every figure, named beside its source. Never
 *   ordered by preference — the order is the order the sources were read in.
 * @property {string} why a sentence a person can act on
 */

/* ------------------------------------------------------------- the finders */

/** Sources for one payment that name different amounts. */
function findAmount({ transactions = [], receipts = [], messages = [] }) {
  const out = [];
  for (const transaction of live(transactions)) {
    const evidence = evidenceFor(transaction, { receipts, messages });
    if (!evidence || evidence.agree !== false) continue;
    out.push({
      kind: 'amount',
      entity: 'transaction',
      id: transaction.id,
      figures: evidence.sources.map(figureOf),
      why: t('conflict.said.amount'),
    });
  }
  return out;
}

/**
 * Sources for one payment that name days further apart than a posting delay.
 *
 * Nothing detected this before. Two sources matched by a shared reference —
 * the strongest link either of them carries — were reported as agreeing when
 * they named the same amount, whatever days they gave it. `reconcileWithStatement`
 * is right to match them: a UTR is copied from the same underlying rail by
 * both. Being silent about the dates afterwards is the fault.
 *
 * The window is `MATCH_DAYS`, the same number `evidence.js` uses to decide two
 * records describe the same payment. Within it, this says nothing: a statement
 * posting a day after the alert is ordinary and calling it a conflict would
 * fill the list with things that are not wrong.
 */
function findDate({ transactions = [], receipts = [], messages = [] }) {
  const out = [];
  for (const transaction of live(transactions)) {
    const evidence = evidenceFor(transaction, { receipts, messages });
    if (!evidence || evidence.sources.length < 2) continue;

    const dated = evidence.sources.filter((source) => plain(source.date));
    if (dated.length < 2) continue;

    let widest = 0;
    for (let i = 0; i < dated.length; i += 1) {
      for (let j = i + 1; j < dated.length; j += 1) {
        const apart = daysApart(dated[i].date, dated[j].date);
        if (apart !== null && apart > widest) widest = apart;
      }
    }
    if (widest <= MATCH_DAYS) continue;

    out.push({
      kind: 'date',
      entity: 'transaction',
      id: transaction.id,
      figures: dated.map(figureOf),
      why: t('conflict.said.date', { n: widest }),
    });
  }
  return out;
}

/**
 * A payment two sources corroborate that the ledger has never seen.
 *
 * `evidence.js` finds these and refuses to create the transaction, which is
 * right — see rule 51 read the other way round. This lists it beside the
 * disagreements because from a household's side it is the same question:
 * these records do not add up, what do I do about it.
 */
function findMissingRow({ receipts = [], messages = [] }) {
  return orphanEvents({ receipts, messages }).map((orphan) => ({
    kind: 'missing-row',
    // The receipt, not a transaction. There is no transaction — that is the
    // whole finding, and pointing this at `transaction` would name a row that
    // does not exist.
    entity: 'receipt',
    id: orphan.receipt,
    figures: [
      { source: KIND.EMAIL, id: orphan.receipt ?? null, amount: orphan.amount ?? null, date: orphan.date ?? null },
      { source: KIND.SMS, id: orphan.message ?? null, amount: orphan.amount ?? null, date: orphan.date ?? null },
    ],
    why: t('conflict.said.missing-row', { finding: orphan.why }),
  }));
}

/**
 * A whole month where wages paid are not the wages agreed.
 *
 * `staffpay.js` does the judging, including the months it refuses to judge —
 * a part month, a month touched by unpaid leave, an agreement no monthly
 * figure can be checked against. Those refusals are not conflicts and do not
 * appear here.
 */
function findWages({ wages = [] }) {
  const out = [];
  for (const bundle of wages) {
    if (!bundle?.staff?.id) continue;
    const check = reconcile(bundle.staff, bundle.payments ?? [], bundle.today, bundle.leave ?? []);

    // No `check.comparable === false` guard. `reconcile` returns `months: []`
    // when it cannot compare, so `wageDisagreements` is already empty and the
    // guard could not change an outcome — removing it changed no test, which
    // is the definition of a check that cannot fail. The third of these found
    // in this repository; `docs/SEALED_VALUES.md` records the other two.
    for (const month of wageDisagreements(check)) {
      out.push({
        kind: 'wages',
        entity: 'staff',
        id: bundle.staff.id,
        figures: [
          { source: 'agreed', id: bundle.staff.id, amount: month.agreed ?? null, date: month.month },
          { source: 'paid', id: null, amount: month.paid ?? null, date: month.month },
        ],
        why: t(month.paid ? 'conflict.said.wages' : 'conflict.said.wagesNone',
          { month: month.month }),
      });
    }
  }
  return out;
}

/**
 * Every kind, and the one thing that finds it.
 *
 * The single table. `CONFLICT_KINDS` is read off it rather than written
 * beside it, so a kind cannot exist without a finder and a finder cannot be
 * added without its kind appearing.
 */
const FINDERS = Object.freeze({
  amount: findAmount,
  date: findDate,
  'missing-row': findMissingRow,
  wages: findWages,
});

/** The kinds a conflict may have, derived from the finders. */
export const CONFLICT_KINDS = Object.freeze(Object.keys(FINDERS));

/** @param {{kind: string, id: string, amount: number|null, date: string|null}} source */
function figureOf(source) {
  return {
    source: source.kind,
    id: source.id ?? null,
    amount: typeof source.amount === 'number' ? source.amount : null,
    date: plain(source.date) || null,
  };
}

/**
 * Every disagreement, in one list.
 *
 * @param {{transactions?: object[], receipts?: object[], messages?: object[],
 *          wages?: {staff: object, payments?: object[], leave?: object[],
 *                   today?: string}[]}} [input]
 * @returns {MoneyConflict[]}
 */
export function conflicts(input = {}) {
  const found = [];
  for (const find of Object.values(FINDERS)) found.push(...find(input));
  return found;
}

/** How many of each kind, for a caller that wants a count before a list. */
export function countByKind(found) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const kind of CONFLICT_KINDS) out[kind] = 0;
  for (const conflict of found ?? []) {
    if (conflict?.kind in out) out[conflict.kind] += 1;
  }
  return out;
}

/**
 * One conflict, as a sentence with every figure in it.
 *
 * The figures are printed in the order they were read, which is deliberately
 * not an order of preference. A reader who wants to know which source ranks
 * higher can look at `SOURCE_PRIORITY`; this sentence will not tell them,
 * because telling them here would read as an answer.
 */
export function describeConflict(conflict, money = (n) => String(n)) {
  if (!conflict) return null;
  const figures = (conflict.figures ?? [])
    .map((figure) => (conflict.kind === 'date'
      ? t('conflict.figure.date', { source: figure.source, date: figure.date })
      : t('conflict.figure.amount', {
        source: figure.source,
        amount: figure.amount === null ? t('conflict.figure.noAmount') : money(figure.amount),
      })))
    .join(', ');
  return figures ? t('conflict.sentence', { figures, why: conflict.why }) : conflict.why;
}
