/**
 * Receipts, out of a mailbox.
 *
 * A bank statement says you paid Zomato ₹645 on a Tuesday. It cannot say what
 * you ordered, which subscription renewed, or when the next one falls due —
 * that is in the receipt, and the receipt is in the inbox.
 *
 * ## What is kept, and what is not
 *
 * The email itself is never stored. What comes out of here is a handful of
 * fields — merchant, date, amount, order number, whether it looks like a
 * subscription — and the message id, so a receipt can be opened in Gmail
 * rather than copied into this application. A household's mailbox stays in
 * their mailbox.
 *
 * That is also the answer to the obvious question about scope. Reading mail
 * requires a scope that can read all of it; the meaningful limit is not the
 * scope but the query, which names a fixed list of shops and nothing else,
 * and the fact that nothing but these fields is written down.
 *
 * ## Amounts are not guessed
 *
 * A receipt is full of numbers — item prices, taxes, delivery fees, discounts,
 * loyalty points, a previous balance. Taking the largest, or the first, gets a
 * plausible wrong answer, which is the worst kind in a spending total. Only a
 * number sitting next to a word that means "this is what you paid" is taken,
 * and a receipt with no such word yields no amount rather than a guess.
 */

import { toMinor } from '../core/money.js';
import { recognise } from './merchants.js';
import { readDate } from './extract.js';

/** Words that mean "this is the number you were charged". Order matters. */
const TOTAL_LABELS = [
  'grand total',
  'order total',
  'total paid',
  'amount paid',
  'you paid',
  'total amount',
  'net payable',
  'amount payable',
  'bill total',
  'total',
];

/** Words that mean this was a renewal rather than a one-off. */
const RECURRING = /subscription|renew(ed|al)?|billing period|next (billing|payment|charge)|monthly plan|annual plan|auto-?pay/i;

/** Words that mean this is a refund, which must not count as spending. */
const REFUND = /refund(ed)?|cancelled|reversal|money returned|credited back/i;

/**
 * One receipt, from one message.
 *
 * @param {{id?: string, from?: string, subject?: string, date?: string, body?: string}} message
 * @param {object[]} [extra] shops the household added themselves
 * @returns {object|null} null when the message is not from a known merchant
 */
export function readReceipt(message = {}, extra = []) {
  const entry = recognise(message, extra);
  if (!entry) return null;

  const body = String(message.body ?? '');
  const subject = String(message.subject ?? '');
  const text = `${subject}\n${body}`;

  const refund = REFUND.test(text);

  return prune({
    messageId: message.id ?? '',
    merchant: entry.name,
    merchantKey: entry.key,
    category: entry.category,
    date: readDate(String(message.date ?? '')) ?? null,
    amount: readTotal(text),
    orderId: readOrderId(text),
    // `recurring` on the merchant says the shop mostly sells subscriptions;
    // the words in this particular message say whether this one was.
    subscription: Boolean(entry.recurring || RECURRING.test(text)),
    refund,
    direction: refund ? 'in' : 'out',
    subject,
  });
}

/** The amount, or null. See the note at the top about not guessing. */
export function readTotal(text) {
  const source = String(text ?? '');

  for (const label of TOTAL_LABELS) {
    const pattern = new RegExp(
      `${label}\\s*[:\\-]?\\s*(?:₹|Rs\\.?|INR)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
      'i',
    );
    const match = pattern.exec(source);
    if (match) return toMinor(match[1].replace(/,/g, ''));
  }
  return null;
}

/** An order or transaction reference, which is what makes a receipt findable. */
export function readOrderId(text) {
  const match = /(?:order|invoice|transaction|booking|reference)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,24})/i
    .exec(String(text ?? ''));
  return match ? match[1] : null;
}

/* ------------------------------------------------------------- the ledger */

/**
 * Receipts summarised the way a person asks about them: per shop, how much,
 * how often, and when it last happened.
 */
export function byMerchant(receipts) {
  const buckets = new Map();

  for (const receipt of receipts ?? []) {
    if (!receipt.amount) continue;
    const bucket = buckets.get(receipt.merchantKey) ?? {
      key: receipt.merchantKey,
      merchant: receipt.merchant,
      category: receipt.category,
      orders: 0,
      spent: 0,
      refunded: 0,
      first: receipt.date,
      last: receipt.date,
    };

    if (receipt.refund) bucket.refunded += receipt.amount;
    else {
      bucket.orders += 1;
      bucket.spent += receipt.amount;
    }
    if (receipt.date && (!bucket.first || receipt.date < bucket.first)) bucket.first = receipt.date;
    if (receipt.date && (!bucket.last || receipt.date > bucket.last)) bucket.last = receipt.date;

    buckets.set(receipt.merchantKey, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      net: bucket.spent - bucket.refunded,
      average: bucket.orders ? Math.round(bucket.spent / bucket.orders) : 0,
    }))
    .sort((a, b) => b.net - a.net);
}

/**
 * Subscriptions, and what they cost a year.
 *
 * A subscription is worth surfacing precisely because nobody looks at it. The
 * annual figure is the one that changes minds: ₹299 a month is invisible and
 * ₹3,588 a year is not.
 */
export function subscriptions(receipts) {
  const found = byMerchant((receipts ?? []).filter((r) => r.subscription && !r.refund));

  return found.map((entry) => {
    const months = monthsBetween(entry.first, entry.last) || 1;
    const cadence = entry.orders > 1 ? months / (entry.orders - 1) : 1;

    return {
      ...entry,
      // Rounded to the nearest sensible period rather than reported as a
      // fraction: "every 1.03 months" tells nobody anything.
      period: cadence >= 10 ? 'yearly' : cadence >= 2 ? 'quarterly' : 'monthly',
      yearly: cadence > 0 ? Math.round((entry.average * 12) / cadence) : entry.average * 12,
    };
  });
}

function monthsBetween(from, to) {
  if (!from || !to) return 0;
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/* ------------------------------------------------------- against the bank */

/**
 * Match receipts to bank transactions.
 *
 * This is what the two halves are for. The statement knows a payment left the
 * account; the receipt knows what it bought. Matched, a line that said
 * "UPI/ZOMATO 645.00" becomes an order you can identify.
 *
 * A match needs the same amount and a date within a few days — a card payment
 * settles later than the receipt, and a UPI payment can land the next morning.
 * Amount alone would pair two ₹299 charges from different shops, so the
 * merchant has to agree as well.
 *
 * @param {object[]} receipts
 * @param {object[]} transactions categorised bank rows
 * @param {{days?: number}} [options]
 */
export function reconcile(receipts, transactions, { days = 3 } = {}) {
  const spent = (transactions ?? []).filter((t) => t.direction === 'out' && t.amount);
  const taken = new Set();
  const matched = [];
  const unmatched = [];

  for (const receipt of receipts ?? []) {
    if (!receipt.amount || !receipt.date || receipt.refund) {
      unmatched.push(receipt);
      continue;
    }

    const hit = spent.find((t, index) => !taken.has(index)
      && t.amount === receipt.amount
      && Math.abs(daysBetween(receipt.date, t.date)) <= days
      && sameParty(t, receipt));

    if (hit) {
      taken.add(spent.indexOf(hit));
      matched.push({ receipt, transaction: hit });
    } else {
      unmatched.push(receipt);
    }
  }

  return {
    matched,
    unmatched,
    // A receipt with no bank row is not an error: it may have been paid by a
    // card this application does not import, or from somebody else's account.
    coverage: receipts?.length ? matched.length / receipts.length : 0,
  };
}

function sameParty(transaction, receipt) {
  const haystack = `${transaction.counterparty ?? ''} ${transaction.raw ?? ''}`.toLowerCase();
  return haystack.includes(receipt.merchantKey.toLowerCase())
    || haystack.includes(receipt.merchant.toLowerCase());
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function prune(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined));
}
