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
import { formatDay } from '../core/dates.js';

/** Above this, an Indian tenant needs the landlord's PAN to claim HRA. */
export const PAN_THRESHOLD = 1_00_000_00;

/**
 * Rent actually received against a property, month by month.
 *
 * A credit into one of the household's accounts, inside the month, for the
 * amount the lease says. Deliberately strict about the amount: a part payment
 * or a different figure is somebody's decision to describe, not this one's to
 * guess at, so it is reported as unreceipted rather than receipted for a number
 * nobody agreed.
 *
 * @param {object} property
 * @param {object[]} transactions
 * @param {{from: string, to: string}} window inclusive, in calendar days
 */
export function rentReceived(property, transactions, { from, to }) {
  if (!property?.rented || !property?.monthlyRent) {
    return { months: [], why: 'this property is not recorded as rented out' };
  }

  const months = [];
  const credits = (transactions ?? []).filter((t) => t
    && !t.deletedAt
    && t.direction === 'in'
    && t.amount === property.monthlyRent
    && t.date >= from && t.date <= to);

  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = nextMonth(month)) {
    const paid = credits.find((t) => t.date.startsWith(month));
    months.push({
      month,
      // The date the money arrived, not the first of the month. A receipt
      // stating a date nothing happened on is a small lie that a tax officer
      // is entitled to notice.
      date: paid?.date ?? null,
      amount: paid?.amount ?? null,
      transaction: paid?.id ?? null,
      received: Boolean(paid),
    });
  }

  return { months, why: null };
}

function nextMonth(month) {
  const [year, m] = month.split('-').map(Number);
  return m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
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

  return {
    total,
    receipted: received.length,
    missing: (months ?? []).length - received.length,
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
