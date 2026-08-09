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

import { categorise, resolveAliases } from './categorise.js';

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
    }));

  return resolveAliases(categorise(rows, options));
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
