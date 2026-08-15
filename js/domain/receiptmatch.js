/**
 * Which payment a receipt is the receipt for.
 *
 * ## The gap this closes
 *
 * `domain/extract.js` reads a receipt and comes back with an amount and a date.
 * The importer records the payment that left the account. Both facts were
 * sitting in the database and **nothing connected them**, so a household with a
 * ₹48,500 school-fee receipt and a ₹48,500 debit had two unrelated rows and a
 * filing job to do by hand.
 *
 * The place to put the answer already existed: `transaction.documents`. Nothing
 * ever proposed what should go in it.
 *
 * ## The rules are `domain/events.js`'s rules
 *
 * This is the same shape of problem — two records that may be one fact — so it
 * takes the same answers, deliberately, rather than inventing softer ones:
 *
 *   - **Exact amount only.** A receipt for ₹48,500 matches a payment of
 *     ₹48,500. "Close" would attach a receipt to the wrong payment, and a
 *     wrongly filed receipt is worse than an unfiled one — it is evidence
 *     pointing at the wrong transaction.
 *   - **An ambiguous match is not a match.** Two payments of the same amount
 *     inside the window is a question, and picking the nearer one is a guess
 *     dressed as an answer. Rent is the ordinary case: twelve identical debits
 *     a year, and the receipt for July must not land on June.
 *   - **Nothing is written.** Every function here returns a proposal. Attaching
 *     is a person's act.
 *   - **A payment that already has this document is left alone.** Proposing it
 *     again would offer to redo a decision somebody made.
 *
 * ## Why the window is asymmetric
 *
 * A receipt is dated when the money was *received*, and that is on or after the
 * day it left the payer's account — cheques clear, transfers settle overnight,
 * a school stamps the receipt when the clerk gets to it. So the search runs
 * from a few days *before* the receipt date to only a day after: a payment made
 * a week after its receipt was written is not that receipt's payment.
 */

const DAY = 24 * 60 * 60 * 1000;

function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / DAY);
}

export const MATCH = Object.freeze({
  /** Exact amount, inside the window, and the only candidate. */
  PROBABLE: 'probable',
  /** Worth a person looking at. Never applied without one. */
  POSSIBLE: 'possible',
});

/**
 * Payments a receipt could be the receipt for.
 *
 * @param {{amount?: number|null, receiptDate?: string|null}} receipt as
 *   `readReceipt` returns — both fields optional, because a receipt missing
 *   either is exactly the case this refuses to match on.
 * @param {object[]} transactions
 * @param {{documentId?: string, before?: number, after?: number}} [options]
 * @returns {{proposals: object[], why: string|null}}
 */
export function matchReceipt(receipt, transactions, {
  documentId = null, before = 5, after = 1,
} = {}) {
  // Both halves or nothing. A receipt with no amount cannot be matched on its
  // date alone — every household has several payments in any five-day window,
  // and the one that matched would be a coincidence presented as evidence.
  if (!receipt?.amount || !receipt?.receiptDate) {
    return {
      proposals: [],
      why: 'this receipt does not say both what was paid and when, so there is '
        + 'nothing to match it on',
    };
  }

  const candidates = (transactions ?? []).filter((txn) => {
    if (!txn || txn.deletedAt) return false;
    // Money leaving. A receipt acknowledges a payment, so a credit is the wrong
    // side of the household's own books.
    if (txn.direction === 'in') return false;
    if (txn.amount !== receipt.amount) return false;
    // Already filed against this very document — a decision that has been made.
    if (documentId && (txn.documents ?? []).includes(documentId)) return false;

    const away = daysBetween(txn.date, receipt.receiptDate);
    return away !== null && away >= -after && away <= before;
  });

  if (!candidates.length) {
    return {
      proposals: [],
      why: 'no payment of this amount is recorded near this date — the statement '
        + 'it is on may not have been imported yet',
    };
  }

  const ambiguous = candidates.length > 1;

  return {
    proposals: candidates
      .map((txn) => ({
        transaction: txn,
        days: daysBetween(txn.date, receipt.receiptDate),
        confidence: ambiguous ? MATCH.POSSIBLE : MATCH.PROBABLE,
        ambiguous,
        why: ambiguous
          ? `${candidates.length} payments of this amount sit near this date. `
            + 'Picking one would be a guess, and a receipt filed against the '
            + 'wrong payment is worse than one not filed at all.'
          : 'The same amount, within days, leaving one of your accounts.',
      }))
      .sort((a, b) => Math.abs(a.days) - Math.abs(b.days)),
    why: null,
  };
}

/**
 * What attaching a receipt would change — without changing it.
 *
 * The same refusal `linkFor` makes: an uncertain match applied by a button is
 * still uncertain, and the button would be doing the deciding.
 */
export function attachmentFor(proposal, documentId) {
  if (!proposal || proposal.confidence !== MATCH.PROBABLE) return null;
  if (!documentId || !proposal.transaction?.id) return null;

  const existing = proposal.transaction.documents ?? [];
  if (existing.includes(documentId)) return null;

  return {
    transactionId: proposal.transaction.id,
    // Appended. A transaction may have a receipt and an invoice and a warranty,
    // and replacing the list would file one by losing the others.
    patch: { documents: [...existing, documentId] },
  };
}

/** A sentence for the screen, or the assistant. */
export function describeMatch(receipt, result, money = (n) => String(n)) {
  if (result.why) return result.why;
  const [first] = result.proposals;
  if (!first) return null;

  return first.confidence === MATCH.PROBABLE
    ? `This looks like the receipt for ${money(receipt.amount)} paid on ${first.transaction.date}.`
    : `${result.proposals.length} payments of ${money(receipt.amount)} could be this one.`;
}
