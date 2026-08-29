/**
 * An RD instalment, and the bank row that paid it.
 *
 * ## The gap this closes, stated narrowly
 *
 * A recurring deposit's instalments are `investmentTransaction` rows. The bank
 * rows for the same payments are `transaction` rows in the ledger. They are
 * two records of one event and **nothing offered to connect them** — that is
 * Phase 7's gap, in its own words, and this offers the connection.
 *
 * ## What is deliberately not claimed
 *
 * **No figure moves.** `categorise.js#DEPOSIT` already matches `RD INSTAL`,
 * `RD DEBIT` and `recurring deposit`, and puts them in the `sweep` category,
 * whose kind is `internal` — so an instalment has never been counted as
 * spending. Anyone reading a connection feature as a correction to the
 * household's expenses would be reading it wrong.
 *
 * **No missed instalment is detected.** A `holding` records `interestRate`,
 * `maturesOn` and `maturityValue` and **not** the instalment amount, the
 * frequency, or the start date. Without a schedule there is nothing to say a
 * month is missing *from*; inferring the schedule from the rows that exist
 * would be inventing the very thing that would then judge them.
 *
 * ## Never forcing a match
 *
 * The prompt says *never force an uncertain match*, and a deposit is where
 * that bites: instalments are the same amount every month, so two bank rows a
 * day apart for ₹5,000 are genuinely indistinguishable. Where more than one
 * row could be the payment, **every candidate is reported and none is
 * chosen** — `AMBIGUOUS` is an answer, not a failure to produce one.
 *
 * Nothing here writes. There is no link field on either record and this does
 * not add one: a stored link is a second copy of a judgement that the rows can
 * make again tomorrow, and the rows are what the household can correct.
 */

import { MATCH_DAYS, daysApart } from './evidence.js';
import { RECURRING } from './accrual.js';

/** How an instalment relates to the ledger. */
export const LINK = Object.freeze({
  /** Exactly one bank row could be this payment. */
  MATCHED: 'MATCHED',
  /** More than one could be, and picking would be inventing certainty. */
  AMBIGUOUS: 'AMBIGUOUS',
  /** Nothing in the ledger looks like it. */
  UNMATCHED: 'UNMATCHED',
});

const live = (rows) => (rows ?? []).filter((row) => row && !row.deletedAt);
/**
 * An amount, or null when there is not one.
 *
 * The explicit null/undefined/empty check is the whole of it, and it was
 * missing: `Number(null)` is **0**, and `Number('')` is 0, so a row with no
 * amount recorded read as a row for zero rupees — and two of them compared
 * equal and matched each other. An absence read as a zero, in the module
 * written while cataloguing that exact fault elsewhere in this repository.
 */
const money = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : null;
};

/** The household's recurring deposits. */
export function recurringDeposits(holdings) {
  return live(holdings).filter((h) => h.kind === RECURRING);
}

/**
 * The instalments paid into one recurring deposit.
 *
 * `contribution` and `buy` both appear in practice — a household typing an RD
 * payment reaches for either, and refusing one of them would silently drop
 * half of somebody's instalments.
 */
export function instalmentsOf(investmentTransactions, holdingId) {
  return live(investmentTransactions)
    .filter((row) => row.holding === holdingId)
    .filter((row) => row.kind === 'contribution' || row.kind === 'buy')
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Bank rows that could be this instalment.
 *
 * Three conditions, and each is here because dropping it produces a wrong
 * answer rather than a wider one:
 *
 *   - **the same account**, when the instalment names one. An RD paid from the
 *     salary account is not evidenced by a debit from a different bank.
 *   - **money leaving.** A credit of the same amount on the same day is the
 *     interest, or a refund, and calling it the instalment would pair the
 *     payment with its opposite.
 *   - **the same amount, within `MATCH_DAYS`.** The window is imported rather
 *     than restated: `evidence.js` owns what "the same day" means here, and a
 *     second copy of that number is a second thing to keep in step.
 */
export function candidatesFor(instalment, transactions, { window = MATCH_DAYS } = {}) {
  const amount = money(instalment?.amount);
  if (amount === null) return [];

  return live(transactions).filter((txn) => {
    if (instalment.account && txn.account && txn.account !== instalment.account) return false;
    if (txn.direction && txn.direction !== 'out') return false;
    if (money(txn.amount) !== amount) return false;
    const apart = daysApart(instalment.date, txn.date);
    return apart !== null && apart <= window;
  });
}

/**
 * Every instalment of every recurring deposit, against the ledger.
 *
 * @param {{holdings?: object[], investmentTransactions?: object[],
 *          transactions?: object[], window?: number}} [options]
 */
export function instalmentLinks({
  holdings = [], investmentTransactions = [], transactions = [], window = MATCH_DAYS,
} = {}) {
  const rows = [];

  for (const deposit of recurringDeposits(holdings)) {
    for (const instalment of instalmentsOf(investmentTransactions, deposit.id)) {
      const candidates = candidatesFor(instalment, transactions, { window });
      rows.push({
        deposit,
        instalment,
        candidates,
        link: candidates.length === 1 ? LINK.MATCHED
          : candidates.length > 1 ? LINK.AMBIGUOUS : LINK.UNMATCHED,
      });
    }
  }

  return rows;
}

/**
 * The counts, for a screen.
 *
 * `total` is the number of instalments examined and the three states account
 * for all of them — the identity `docs/COUNTING_THE_ONES_YOU_CANNOT_NAME.md`
 * argues for, applied here from the start rather than after a report was found
 * not to add up.
 */
export function instalmentSummary(links) {
  const counts = { total: links.length, matched: 0, ambiguous: 0, unmatched: 0 };
  for (const row of links) {
    if (row.link === LINK.MATCHED) counts.matched += 1;
    else if (row.link === LINK.AMBIGUOUS) counts.ambiguous += 1;
    else counts.unmatched += 1;
  }
  return counts;
}
