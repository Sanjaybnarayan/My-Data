/**
 * A rent receipt, and what one is allowed to say.
 *
 * ## The direction this works in, and why only one
 *
 * A household is a landlord in `property` — `rented`, `monthlyRent`,
 * `tenantName` — and a tenant in `recurringPayment` with `kind: 'rent'`. Both
 * are recorded, and **only one of them may be issued from here.**
 *
 * A receipt is a statement by *the person who received the money*. Generating
 * one for rent the household **paid** would mean writing, in their landlord's
 * voice, that the landlord received it — a document asserting somebody else's
 * acknowledgement, produced by a party with an interest in the claim. Tenants
 * need those for HRA and often cannot get them, which is exactly the pressure
 * that makes writing one dangerous rather than helpful. This does not.
 *
 * So: receipts are issued for rent the household **received**, where the
 * household is the one making the statement and signing it.
 *
 * ## What it will not fill in
 *
 * **A payment it has no record of.** `property.monthlyRent` is what the rent
 * *is*, not evidence any was paid. A receipt built from it would assert a
 * payment on the strength of a standing figure, which is the difference between
 * a record and a claim. Where a matching credit exists the receipt states the
 * amount and date from **that transaction**; where none does, the month is
 * reported as unreceipted and no document is produced for it.
 *
 * **A landlord's PAN.** Above ₹1,00,000 of annual rent an Indian tenant needs
 * the landlord's PAN, and this reports whether the year crosses that line
 * rather than printing a number. The PAN belongs to the person signing, and
 * putting one on a document automatically is how the wrong one ends up on it.
 *
 * **A signature.** The document leaves room for one. That is the whole point of
 * the household being the issuer: they sign it because it is true.
 */

import { format } from '../core/money.js';
import { formatDay, nextMonth } from '../core/dates.js';

/** Above this, an Indian tenant needs the landlord's PAN to claim HRA. */
export const PAN_THRESHOLD = 1_00_000_00;

const plain = (value) => String(value ?? '').trim();

/**
 * Rent actually received against a property, month by month.
 *
 * ## Two rules, and which applies depends on what the household recorded
 *
 * **With `property.rentAccount` set**, a credit into that account inside the
 * month is the rent, and the receipt states **what arrived**. That is what
 * makes a part payment and a rent rise visible: a tenant who paid ₹20,000 of
 * ₹35,000 paid something, and reporting nothing was the older behaviour.
 *
 * **Without it**, the older rule stands — only an exact match for the recorded
 * rent counts — because any credit in any account would otherwise become rent.
 * The change is opt-in, and a household that records nothing new sees what it
 * saw before.
 *
 * ## A credit two lettings could claim belongs to neither
 *
 * Measured before this existed, on two flats let at the same rent:
 *
 *     one credit of ₹35,000 · two flats both let at ₹35,000
 *       Flat A says received: true · txn t1
 *       Flat B says received: true · txn t1
 *
 * One payment, **two signed receipts**. So `others` is every other letting,
 * and a credit more than one of them would claim is attributed to none of
 * them — with the month saying why, because unlike "nobody paid" that one is
 * fixable by recording which account each property's rent arrives in.
 *
 * @param {object} property
 * @param {object[]} transactions
 * @param {{from: string, to: string, others?: object[]}} window inclusive, in
 *   calendar days; `others` is the household's other lettings
 */
export function rentReceived(property, transactions, { from, to, others = [] }) {
  if (!property?.rented || !property?.monthlyRent) {
    return { months: [], why: 'this property is not recorded as rented out' };
  }

  const inWindow = (transactions ?? []).filter((t) => t
    && !t.deletedAt
    && t.direction === 'in'
    && t.date >= from && t.date <= to);

  const bound = plain(property.rentAccount);

  /**
   * Credits this property could be the reason for.
   *
   * With `rentAccount` set, any credit into that account is a candidate and
   * the amount is whatever arrived — which is what makes a part payment and a
   * rent rise visible rather than invisible. Without it, the old rule stands:
   * only an exact match for the recorded rent.
   */
  const candidates = bound
    ? inWindow.filter((t) => plain(t.account) === bound)
    : inWindow.filter((t) => t.amount === property.monthlyRent);

  /**
   * Other lettings that would claim the same credit.
   *
   * A household with two flats at the same rent used to get a receipt for
   * **both** from one payment — the same rupee acknowledged twice, on two
   * documents the landlord signs. Contested credits are attributed to
   * neither, and the month says why.
   */
  const rivals = (others ?? []).filter((other) => other
    && other.id !== property.id
    && !other.deletedAt
    && other.rented
    && other.monthlyRent);

  const contested = (t) => rivals.some((other) => {
    const otherBound = plain(other.rentAccount);
    if (bound && otherBound) return otherBound === bound;
    if (bound || otherBound) return false;
    return other.monthlyRent === t.amount;
  });

  const months = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
    const forMonth = candidates.filter((t) => t.date.startsWith(month));
    const paid = forMonth.find((t) => !contested(t)) ?? null;
    const blocked = !paid && forMonth.length > 0;

    months.push({
      month,
      // The date the money arrived, not the first of the month. A receipt
      // stating a date nothing happened on is a small lie that a tax officer
      // is entitled to notice.
      date: paid?.date ?? null,
      // What arrived, not what was expected. A tenant who paid ₹24,000 of
      // ₹25,000 paid something, and a receipt for it must say ₹24,000.
      amount: paid?.amount ?? null,
      transaction: paid?.id ?? null,
      received: Boolean(paid),
      /** Set only where a credit exists and could not be attributed. */
      why: blocked
        ? 'a credit this month could belong to more than one letting — record '
          + 'which account each property\'s rent arrives in to tell them apart'
        : null,
      /** Reported, never corrected: the receipt states what arrived. */
      shortfall: paid && paid.amount < property.monthlyRent
        ? property.monthlyRent - paid.amount
        : null,
      excess: paid && paid.amount > property.monthlyRent
        ? paid.amount - property.monthlyRent
        : null,
    });
  }

  return { months, why: null };
}

/**
 * What the year adds up to, and whether it crosses the PAN line.
 *
 * Counted from what was **received**, not from twelve times the rent. A
 * household whose tenant missed two months does not owe a receipt for them, and
 * a total that included them would overstate their rental income on a document
 * they sign.
 */
export function rentYear(months) {
  const received = (months ?? []).filter((m) => m.received);
  const total = received.reduce((sum, m) => sum + (m.amount ?? 0), 0);

  const contested = (months ?? []).filter((m) => !m.received && m.why);

  return {
    total,
    receipted: received.length,
    missing: (months ?? []).length - received.length,
    /**
     * Months where money arrived and could not be attributed.
     *
     * Counted apart from `missing`, because "nobody paid" and "somebody paid
     * and this application will not say who to" are different situations and
     * only the second is fixable by recording something.
     */
    contested: contested.length,
    shortfalls: received.filter((m) => m.shortfall).length,
    // Reported, never acted on. Whether a PAN goes on the document is the
    // signer's decision, and it is theirs to write.
    needsPan: total > PAN_THRESHOLD,
  };
}

/**
 * One receipt, as blocks `reports/docx.js` can write.
 *
 * Returns null where there is nothing to receipt: a month with no matching
 * credit produces **no document**, rather than a document with a blank where
 * the payment should be.
 */
export function rentReceiptBlocks(property, month, { owner = '', at = null } = {}) {
  if (!month?.received) return null;

  const blocks = [
    { type: 'heading', text: 'RENT RECEIPT' },
    { type: 'space' },
    {
      type: 'table',
      rows: [
        ['Received from', property.tenantName || '—'],
        ['Amount', format(month.amount)],
        ['Towards rent for', monthName(month.month)],
        ['Date received', formatDay(month.date)],
        ['Property', [property.name, property.address].filter(Boolean).join(', ') || '—'],
      ],
    },
    { type: 'space' },
    {
      type: 'paragraph',
      text: `Received the sum of ${format(month.amount)} towards rent for `
        + `${monthName(month.month)} in respect of the property above.`,
    },
    { type: 'space' },
    { type: 'space' },
    // Named rather than left as a bare line: a receipt somebody else signs is
    // not this household's to issue, and the document should say whose it is.
    { type: 'paragraph', text: owner ? `${owner} (landlord)` : 'Landlord' },
    { type: 'paragraph', text: 'Signature: ______________________' },
  ];

  if (at) {
    blocks.push({ type: 'paragraph', text: `Issued ${formatDay(at)}` });
  }

  return blocks;
}

function monthName(month) {
  const [year, m] = String(month ?? '').split('-').map(Number);
  if (!year || !m) return String(month ?? '');
  return `${['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'][m - 1]} ${year}`;
}

/** A filename per month, so twelve receipts do not overwrite each other. */
export function rentReceiptFilename(property, month) {
  const name = String(property?.name ?? 'property').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  return `rent-receipt-${name}-${month.month}.docx`;
}
