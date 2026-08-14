/**
 * The analysis, over everything on record.
 *
 * `domain/categorise.js` has always been able to answer "who did money go to",
 * "who owes whom", "what repeats" and "what is worth saying out loud". Until
 * now the only caller was `tools/statement.mjs`, so those answers existed on a
 * command line and nowhere a household would look. This is the adapter that
 * puts them on a screen.
 *
 * ## Why it re-reads rather than stores
 *
 * The categoriser works on statement rows; the database holds transaction
 * records. The narration the bank wrote is kept on every imported record, so
 * the categoriser can be run over it again at read time rather than its
 * conclusions being frozen at import.
 *
 * That is the point, not a compromise. Naming a business, or correcting one
 * counterparty, changes what every past transaction *means* — a payment
 * reclassified from "sent to a stranger" to "capital into your firm" moves
 * money between two totals. Re-reading applies a correction to the whole
 * history at once. Storing the conclusions would apply it to whatever is
 * imported next and quietly leave three years disagreeing with it.
 *
 * The cost is a pass over the narrations whenever a ledger screen opens. It is
 * regular expressions over a few tens of thousands of short strings — a few
 * milliseconds — and it buys corrections that are retroactive.
 *
 * ## What cannot be re-derived
 *
 * Which way the money went. A statement's columns say it and nothing in the
 * narration does, so `direction` is stored. Records written before it was
 * stored fall back to `kind`, which is right for income and spending and can
 * only guess at a transfer — those are marked so nothing downstream mistakes a
 * guess for a reading.
 */

import { categorise, resolveAliases, categoryKind } from './categorise.js';

/**
 * The transaction form's category dropdown, in the categoriser's vocabulary.
 *
 * ## Why this exists
 *
 * Re-reading the narration is right for an imported row, and is the whole
 * design described above. It is **wrong for a row somebody typed**, because a
 * typed row has no narration — so the only thing left to read is the free-text
 * payee, the weakest signal in the record, while the strongest one sits unread
 * in a dropdown the household picked from.
 *
 * Measured before this was written, on five hand-entered transactions:
 *
 *     they chose   the ledger decided
 *     groceries    p2p-out      "Big Bazaar"
 *     rent         p2p-out      "Landlord"
 *     health       p2p-out      "Dr Anita Rao"
 *     dining       p2p-out      "Truffles"
 *     education    e-commerce   "Vidya Niketan"
 *
 * None survived. `looksLikePerson` reads any two capitalised words as a name,
 * so four of the five became person-to-person transfers: ₹62,500 of ₹71,700
 * left the spending total, and the insights told the household that three
 * *people* had taken money that had not come back — a supermarket, a landlord
 * and a doctor.
 *
 * ## Where a category maps to something coarser
 *
 * `rent` and `maintenance` become `bills`, which is not a loss introduced here
 * — the importer's own `utility` rule already folds both in. `gifts` and
 * `donation` have no home and become uncategorised *spending*, which keeps
 * them in the right total even though the label is lost.
 */
export const ENTERED_CATEGORIES = Object.freeze({
  groceries: 'groceries',
  dining: 'restaurant',
  restaurant: 'restaurant',
  'food delivery': 'food-delivery',
  'quick commerce': 'quick-commerce',
  'e-commerce': 'e-commerce',
  shopping: 'retail',
  retail: 'retail',
  hotel: 'hotel',
  travel: 'travel',
  transport: 'travel',
  fuel: 'fuel',
  entertainment: 'entertainment',
  subscription: 'subscription',
  utilities: 'bills',
  bills: 'bills',
  rent: 'bills',
  maintenance: 'bills',
  health: 'healthcare',
  insurance: 'insurance',
  education: 'education',
  EMI: 'emi',
  'loan repayment': 'loan-repayment',
  'credit card': 'credit-card',
  tax: 'tax',
  'bank charges': 'charges',
  cash: 'cash',
  'payment app': 'payments',
  gifts: 'other-spend',
  donation: 'other-spend',

  salary: 'salary',
  'business income': 'business-income',
  interest: 'interest',
  dividend: 'other-income',
  'rental income': 'other-income',
  refund: 'refund',
  'loan received': 'loan-disbursal',

  'sent to person': 'p2p-out',
  'received from person': 'p2p-in',
  'own account': 'self-transfer',
  sweep: 'sweep',
  'into business': 'business-outlay',
  invested: 'investment-out',
  'investment proceeds': 'investment-in',
});

/**
 * The category the household chose, or null when they did not choose one.
 *
 * Two things are deliberately *not* read as a choice:
 *
 *   - **An imported row.** It has a narration, and re-reading that is the
 *     design above — a correction there is retroactive across the history.
 *   - **`other`.** The dropdown's default, so it means nobody picked anything.
 *     Honouring it would switch the categoriser off for every record where a
 *     person left the field alone, which is most of them.
 */
function chosenCategory(record) {
  if (record.narration) return null;

  const chosen = String(record.category ?? '');
  if (!chosen || chosen === 'other') return null;
  if (ENTERED_CATEGORIES[chosen]) return ENTERED_CATEGORIES[chosen];

  // A category with no mapping — `business`, which is ambiguous between
  // earning from one and putting capital into one. Falling back by direction
  // keeps it in the right half of the report, which is the part that matters;
  // guessing which kind of business movement it was does not.
  return record.kind === 'income' ? 'other-income' : 'other-spend';
}

/**
 * Put the chosen category back, over whatever the payee heuristic decided.
 *
 * `isP2P` has to move with it. That flag is what `peopleLedger` filters on, so
 * leaving it set would keep a supermarket listed among the people the household
 * exchanges money with long after its category reads `groceries`.
 *
 * `counterpartyKind` only ever moves *down* from `person`. `self` and
 * `business` come from the household's own configuration rather than from a
 * heuristic, and a category should not overrule those.
 *
 * No *screen* reads `counterpartyKind === 'person'` today — mutation-testing
 * showed removing that clause breaks nothing on any ledger, because
 * `peopleLedger` filters on `isP2P`. It stays because `tools/statement.mjs`
 * dumps the field to CSV, where a household would read the word "person"
 * beside a supermarket, and a test below locks it directly rather than
 * through a ledger that happens not to look.
 */
function applyChosen(rows) {
  return rows.map((row) => {
    if (!row.chosen) return row;

    const p2p = row.chosen === 'p2p-out' || row.chosen === 'p2p-in';
    return {
      ...row,
      category: row.chosen,
      categoryKind: categoryKind(row.chosen),
      isP2P: p2p,
      counterpartyKind: p2p ? 'person'
        : row.counterpartyKind === 'person' ? 'merchant' : row.counterpartyKind,
      rule: 'entered',
    };
  });
}

/**
 * Stored transaction records, as the categoriser sees them.
 *
 * @param {object[]} records rows from the transaction repository
 * @param {{holder?: string, businesses?: string[], overrides?: object}} [options]
 */
export function fromRecords(records, options = {}) {
  const rows = (records ?? [])
    .filter((record) => record.date && record.amount)
    .map((record) => ({
      // Kept so a ledger line can lead back to the record it came from.
      id: record.id,
      account: record.account,
      person: record.person,
      date: record.date,
      amount: record.amount,
      ...directionOf(record),
      description: record.narration || record.payee || '',
      raw: record.narration || record.payee || '',
      reference: record.reference || '',
      balance: record.balance ?? null,
      // Carried through the categoriser rather than applied before it, so the
      // counterparty name and channel are still read from the payee. Only the
      // classification is the household's to make.
      chosen: chosenCategory(record),
    }));

  return applyChosen(resolveAliases(categorise(rows, options)));
}

/**
 * Which way the money went, and whether that was read or guessed.
 *
 * A record written by a current import carries `direction`. An older one
 * carries only `kind`: `income` came in, `expense` went out, and a `transfer`
 * could be either — that one is a guess, and says so.
 */
function directionOf(record) {
  if (record.direction === 'in' || record.direction === 'out') {
    return { direction: record.direction };
  }
  if (record.kind === 'income') return { direction: 'in', inferred: true };
  if (record.kind === 'expense') return { direction: 'out', inferred: true };
  // A transfer with no stored direction. Out is the commoner half and the
  // safer guess — counting an unknown as money arriving would inflate income.
  return { direction: 'out', inferred: true, uncertain: true };
}

/**
 * How much of a ledger rests on a guess.
 *
 * Worth showing rather than hiding: a household whose records all predate the
 * stored direction should know that the transfer figures are inference before
 * it acts on them.
 */
export function confidence(rows) {
  const list = rows ?? [];
  const uncertain = list.filter((row) => row.uncertain);

  return {
    total: list.length,
    read: list.filter((row) => !row.inferred).length,
    inferred: list.filter((row) => row.inferred && !row.uncertain).length,
    uncertain: uncertain.length,
    // The one number that decides whether to warn: a guessed transfer is the
    // only case where the direction could be plain wrong.
    trustworthy: !uncertain.length,
  };
}

/**
 * The overrides map, from a list somebody can edit.
 *
 * Stored as a list of `{key, name, category}` rather than a bare object so the
 * screen can show what each entry was called when it was corrected — a
 * counterparty key is a squashed string and nobody recognises their own
 * corrections in a column of them.
 */
export function overridesFrom(list) {
  return Object.fromEntries((list ?? [])
    .filter((entry) => entry?.key && entry?.category)
    .map((entry) => [entry.key, entry.category]));
}
