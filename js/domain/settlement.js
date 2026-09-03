/**
 * Paying a credit card is not spending. The spending already happened.
 *
 * ## The bug this exists to fix
 *
 * `credit-card` is categorised with kind `spending`, so `summarise` counts a
 * card bill as money leaving the household. It also counts every purchase on
 * that card's own statement. A household that imports both — which is the
 * habit the importer is built for, *"once a month, download every statement
 * for every account"* — sees this:
 *
 *     groceries on the card       ₹3,000   spending
 *     a café on the card          ₹2,000   spending
 *     the card bill from the bank ₹5,000   spending
 *     ─────────────────────────────────────────────
 *     reported spending          ₹10,000
 *     actually spent              ₹5,000
 *
 * **Exactly double.** Not a rounding error, not an edge case: the headline
 * number on the finance screen, twice as large as the truth, for every rupee
 * that went through a card.
 *
 * ## Why this is not a one-line fix
 *
 * The obvious repair is to give `credit-card` kind `internal` and be done. That
 * is right for the household above and wrong for a different one:
 *
 * > A household that imports **only** their bank statement has no record of
 * > what the card was used for. The bill is the *only* evidence that ₹5,000 was
 * > spent. Calling it internal reports their spending as zero.
 *
 * So the answer genuinely depends on what has been imported, which is why it
 * cannot be a property of a category. A category is a fact about a row; this is
 * a fact about the household's whole set of records.
 *
 * ## What it does instead
 *
 * Nothing is rewritten. Nothing is recategorised. This reports both figures and
 * says which is which — a total that silently changed because a second file was
 * imported would be worse than the double count, because nobody would know why.
 */

/** Categories a card bill arrives under, in both spellings the app uses. */
import { addable } from '../core/money.js';
import { settled } from '../data/integrity.js';

const SETTLEMENT_CATEGORIES = new Set(['credit-card', 'credit card']);

const CARD_KINDS = new Set(['credit card', 'card', 'credit']);

/** Is this account one whose balance is a debt rather than a holding? */
export function isCard(account) {
  return Boolean(account) && CARD_KINDS.has(String(account.kind ?? '').toLowerCase());
}

/** Is this row a payment *of* a card bill, rather than a purchase *on* a card? */
export function isSettlement(txn, cardIds = new Set()) {
  if (!settled(txn)) return false;
  if (txn.direction !== 'out' && txn.kind !== 'expense') return false;
  // Either the row says so, or it names a card account as its destination.
  return SETTLEMENT_CATEGORIES.has(txn.category) || cardIds.has(txn.toAccount);
}

/**
 * Which card bills are double-counted, and which are the only record there is.
 *
 * @param {object[]} transactions
 * @param {object[]} accounts
 * @returns {{settlements, doubleCounted, onlyRecord, byCard, total, corrected}}
 */
export function settlementReport(transactions, accounts) {
  const cards = (accounts ?? []).filter(isCard);
  const cardIds = new Set(cards.map((c) => c.id));

  const rows = (transactions ?? []).filter(settled);
  const settlements = rows.filter((t) => isSettlement(t, cardIds));

  // A card whose own statement has been imported has purchases of its own.
  // That, and only that, is what makes its bill a double count.
  const spendingOn = new Map();
  for (const card of cards) spendingOn.set(card.id, 0);
  for (const txn of rows) {
    if (!cardIds.has(txn.account)) continue;
    if (isSettlement(txn, cardIds)) continue;      // a payment *into* the card
    if (txn.direction === 'in') continue;          // a refund, not a purchase
    spendingOn.set(txn.account, (spendingOn.get(txn.account) ?? 0) + addable(txn.amount));
  }

  /** Which card a settlement pays, where that can be told at all. */
  const cardFor = (txn) => (cardIds.has(txn.toAccount) ? txn.toAccount : null);

  const doubleCounted = [];
  const onlyRecord = [];

  for (const txn of settlements) {
    const id = cardFor(txn);
    // Named destination: the question is answerable exactly.
    if (id) {
      (spendingOn.get(id) > 0 ? doubleCounted : onlyRecord).push(txn);
      continue;
    }
    // No destination recorded — an imported bill names a payee, not an account.
    // Falling back to "is any card's statement here at all" is a coarser
    // question, and it is coarse in the safe direction: with no card statement
    // imported anywhere, the bill is certainly the only record.
    const anyCardSpending = [...spendingOn.values()].some((n) => n > 0);
    (anyCardSpending ? doubleCounted : onlyRecord).push(txn);
  }

  const sum = (list) => list.reduce((n, t) => n + addable(t.amount), 0);

  return {
    settlements,
    doubleCounted,
    onlyRecord,
    /** Per card, so a household with two can see which is which. */
    byCard: cards.map((card) => ({
      id: card.id,
      name: card.name,
      spending: spendingOn.get(card.id) ?? 0,
      /** No purchases of its own means its statement has not been imported. */
      statementImported: (spendingOn.get(card.id) ?? 0) > 0,
    })),
    total: sum(settlements),
    /** The amount to take *off* a spending total. Never applied here. */
    corrected: sum(doubleCounted),
  };
}

/**
 * The correction as a sentence, or null when there is nothing to say.
 *
 * Both numbers, always. A screen that showed only the corrected figure would be
 * quietly disagreeing with every other total in the application, and a
 * household comparing them would have no way to find out why.
 *
 * @param {object} report
 * @param {number} spending
 * @param {(n: number) => string} [money] how to render an amount. Defaulted
 *   rather than required because this is domain logic and knows nothing about
 *   a currency symbol — the screen passes `format`, and a test can pass
 *   anything. An earlier version formatted by replacing number substrings in
 *   the finished sentence, which picks the wrong occurrence the moment two of
 *   the figures are equal.
 */
export function describeSettlement(report, spending, money = (n) => String(n)) {
  if (!report?.settlements?.length) return null;

  if (!report.doubleCounted.length) {
    const missing = report.byCard.filter((c) => !c.statementImported).map((c) => c.name);
    return `Card bills of ${money(report.total)} are counted as spending, because `
      + `${missing.length ? `${missing.join(' and ')} has` : 'no card statement has'} `
      + 'no statement imported — the bill is the only record of what was spent. '
      + 'Import the card statement and this will be corrected.';
  }

  return `${money(spending)} includes ${money(report.corrected)} of card bills on top `
    + 'of the purchases those bills paid for, so it counts that money twice. '
    + `Spending without them is ${money(spending - report.corrected)}.`;
}
