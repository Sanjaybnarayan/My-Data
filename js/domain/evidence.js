/**
 * How many things say this happened, and whether they agree.
 *
 * ## What each half already did, and what neither could answer
 *
 * A receipt read out of an email points at the bank row it matched
 * (`domain/receiptmatch.js`). A stored message points at the bank row it
 * matched (`docs/SMS_STORAGE.md`). Both links are correct and neither knows
 * about the other, so with all three sitting in the database the application
 * could not say:
 *
 *   - how many sources describe this one payment;
 *   - whether they agree about the amount;
 *   - whether a receipt and an alert with no statement row between them are
 *     one spend that never reached the ledger.
 *
 * That last one is the useful one. A household that has an email receipt for
 * ₹2,499 and a bank alert for ₹2,499 on the same day, and no imported row for
 * it, is a household with a real payment missing from its ledger — and until
 * now the two halves of the proof sat in different tables with nothing looking
 * across.
 *
 * ## Corroboration is not verification
 *
 * Three sources agreeing is three machines agreeing. `data/provenance.js` keeps
 * confidence and verification apart for exactly this reason and nothing here
 * collapses them: `sources.length` is a count, never a score, and no sentence
 * produced here says a figure is confirmed.
 *
 * ## What it refuses
 *
 * **It never creates a transaction.** An orphan pair is reported as a probable
 * spend and left for a person. Inventing a row from two notifications is how a
 * ledger fills with events nobody can trace to a statement — which is rule 51
 * read the other way round.
 *
 * **It never picks the right amount.** Where sources disagree, every figure is
 * named beside its source and none is preferred. The bank statement outranks
 * both under `SOURCE_PRIORITY`, and outranking is a reason to *believe* it,
 * not a licence to overwrite the others with it.
 */

import { SOURCE_PRIORITY } from './sms.js';

export const KIND = Object.freeze({
  STATEMENT: 'bank-statement',
  EMAIL: 'email-receipt',
  SMS: 'sms',
});

/**
 * How near two dates have to be to describe the same payment.
 *
 * Exported because `domain/conflict.js` needs the same number to decide when
 * two sources are naming *different* days rather than the same one posted
 * late. A second copy of it there would drift, and the two modules would
 * disagree about what "the same day" means.
 */
export const MATCH_DAYS = 1;

const plain = (value) => String(value ?? '').trim();
const live = (rows) => (rows ?? []).filter((row) => row && !row.deletedAt);

function daysApart(a, b) {
  const left = Date.parse(`${plain(a)}T00:00:00Z`);
  const right = Date.parse(`${plain(b)}T00:00:00Z`);
  if (Number.isNaN(left) || Number.isNaN(right)) return null;
  return Math.abs(left - right) / 86_400_000;
}

/**
 * One thing that says a payment happened.
 *
 * Declared rather than inferred: the array below starts with a statement
 * literal, so without this the checker narrows `kind` to `'bank-statement'`
 * and refuses the receipt pushed in two lines later.
 *
 * @typedef {object} Source
 * @property {string} kind
 * @property {string} id
 * @property {number|null} amount
 * @property {string|null} date
 * @property {number|null} priority `SOURCE_PRIORITY`, or null where the
 *   prompt's table has no entry for that kind — named rather than scored.
 */

/**
 * Everything that says one bank row happened.
 *
 * The row itself is always the first source: it is the thing the others were
 * matched *to*, and leaving it out would report a payment with two sources when
 * it has three.
 */
export function evidenceFor(transaction, { receipts = [], messages = [] } = {}) {
  if (!transaction) return null;

  /** @type {Source[]} */
  const sources = [{
    kind: KIND.STATEMENT,
    id: transaction.id,
    amount: transaction.amount ?? null,
    date: transaction.date ?? null,
    priority: SOURCE_PRIORITY['bank-statement'],
  }];

  for (const receipt of live(receipts)) {
    if (receipt.transaction !== transaction.id) continue;
    sources.push({
      kind: KIND.EMAIL,
      id: receipt.id,
      amount: receipt.amount ?? null,
      date: receipt.date ?? null,
      // A merchant's own email about the payment. Below a statement and above
      // a bank's SMS is not a ranking this file invents — `SOURCE_PRIORITY`
      // has no email entry, so it is named rather than scored.
      priority: null,
    });
  }

  for (const message of live(messages)) {
    if (message.transaction !== transaction.id) continue;
    sources.push({
      kind: KIND.SMS,
      id: message.id,
      amount: message.amount ?? null,
      date: message.transactionDate ?? message.receivedAt ?? null,
      priority: SOURCE_PRIORITY.sms,
    });
  }

  const withAmount = sources.filter((source) => typeof source.amount === 'number');
  const amounts = [...new Set(withAmount.map((source) => source.amount))];

  return {
    transaction: transaction.id,
    sources,
    // A count, never a score. Three sources agreeing is three machines
    // agreeing, and `data/provenance.js` says why that is not verification.
    corroboration: sources.length,
    // `null` where fewer than two sources carry an amount. One figure cannot
    // agree with itself, and calling that agreement would flatter it — the
    // first version of this line returned `false` for a lone statement row,
    // which reads as "the sources disagree" about a payment with one source.
    agree: withAmount.length < 2 ? null : amounts.length === 1,
    amounts,
  };
}

/**
 * Where the sources for one payment state different figures.
 *
 * Reported per transaction with every figure named beside its source. Nothing
 * is preferred and nothing is written.
 */
export function disagreements(transactions, { receipts = [], messages = [] } = {}) {
  const out = [];

  for (const transaction of live(transactions)) {
    const evidence = evidenceFor(transaction, { receipts, messages });
    if (!evidence || evidence.agree !== false) continue;
    out.push(evidence);
  }

  return out;
}

/**
 * A receipt and a message that describe the same payment, with no bank row.
 *
 * The finding this file exists for. Two notifications agreeing about an amount
 * and a day, and nothing in the ledger — which is a spend the household made
 * and this application has never seen a statement for.
 *
 * Never turned into a transaction. It is offered.
 */
export function orphanEvents({ receipts = [], messages = [] } = {}) {
  const loose = live(messages).filter((message) => !plain(message.transaction)
    && typeof message.amount === 'number');
  const spare = live(receipts).filter((receipt) => !plain(receipt.transaction)
    && typeof receipt.amount === 'number');

  const out = [];
  const taken = new Set();

  for (const receipt of spare) {
    const match = loose.find((message) => {
      if (taken.has(message.id)) return false;
      if (message.amount !== receipt.amount) return false;
      const apart = daysApart(receipt.date, message.transactionDate ?? message.receivedAt);
      return apart !== null && apart <= MATCH_DAYS;
    });
    if (!match) continue;

    taken.add(match.id);
    out.push({
      amount: receipt.amount,
      date: receipt.date,
      merchant: plain(receipt.merchant),
      receipt: receipt.id,
      message: match.id,
      why: 'an email receipt and a bank alert agree about this payment, and no '
        + 'imported statement row matches it',
    });
  }

  return out;
}

/**
 * The household's evidence, at a glance.
 *
 * `bySources` counts payments by how many things say they happened. A row with
 * one source is not a problem — most statement rows have only the statement —
 * so it is counted rather than reported as a fault.
 */
export function evidenceSummary(transactions, { receipts = [], messages = [] } = {}) {
  const bySources = {};
  let corroborated = 0;

  for (const transaction of live(transactions)) {
    const evidence = evidenceFor(transaction, { receipts, messages });
    const count = evidence.corroboration;
    bySources[count] = (bySources[count] ?? 0) + 1;
    if (count > 1) corroborated += 1;
  }

  return {
    total: live(transactions).length,
    corroborated,
    bySources,
    disagreeing: disagreements(transactions, { receipts, messages }).length,
    orphans: orphanEvents({ receipts, messages }),
  };
}

const NAME = {
  [KIND.STATEMENT]: 'the bank statement',
  [KIND.EMAIL]: 'an email receipt',
  [KIND.SMS]: 'a bank message',
};

/** A sentence for the screen. Never a claim that anybody checked it. */
export function describeEvidence(evidence, money = (n) => String(n)) {
  if (!evidence) return null;

  const names = evidence.sources.map((source) => NAME[source.kind]);

  if (evidence.agree === false) {
    const figures = evidence.sources
      .filter((source) => typeof source.amount === 'number')
      .map((source) => `${NAME[source.kind]} says ${money(source.amount)}`)
      .join(', ');
    return `${figures}. Nothing here decides which is right, and nothing is changed.`;
  }

  if (evidence.sources.length === 1) {
    return `Only ${names[0]} says this happened.`;
  }

  return `${evidence.sources.length} sources say this happened — `
    + `${names.join(', ')} — and they agree on the amount. None of them is a person `
    + 'having checked it.';
}

/** The orphan pair, said plainly. */
export function describeOrphan(orphan, money = (n) => String(n)) {
  if (!orphan) return null;
  const who = orphan.merchant ? ` to ${orphan.merchant}` : '';
  return `${money(orphan.amount)}${who} on ${orphan.date}: ${orphan.why}. `
    + 'Nothing has been added to the ledger.';
}
