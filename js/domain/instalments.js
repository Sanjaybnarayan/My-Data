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

/* ------------------------------------------------ the schedule, and its gaps */

/**
 * Whether a recurring deposit's schedule has a gap in it.
 *
 * ## Why this could not be answered before
 *
 * The header above records the refusal this replaces: a `holding` carried
 * `interestRate`, `maturesOn` and `maturityValue` and **not** the instalment
 * amount, the frequency or the start date, so there was no schedule for a
 * month to be missing *from*. It also records the rule that had to be kept
 * while closing it — *inferring the schedule from the rows that exist would
 * be inventing the very thing that would then judge them*.
 *
 * So the schedule is **recorded, never derived**. Three fields on `holding`
 * hold it, they are asked for only when the kind is a recurring deposit, and
 * when they are absent this returns a reason rather than an empty list.
 *
 * ## An empty list is a claim, and this does not make it
 *
 * `missed: []` reads as *nothing was missed*. For a deposit whose schedule
 * nobody recorded that is not true, it is unknown, and the difference is the
 * whole point of the entity change. `UNRECORDED` is an answer; a silent zero
 * would be the same absence-read-as-a-zero fault this module's own `money()`
 * helper exists to prevent.
 *
 * ## Matched by period, not by day
 *
 * A schedule saying the 1st and a payment on the 3rd are the same instalment.
 * Banks move debits off weekends, households pay late, and a day-exact
 * comparison would report a gap for every deposit that ever settled on a
 * Monday. The period is the unit: one instalment per month, or per quarter.
 */

/** What a schedule can say about itself. */
export const SCHEDULE = Object.freeze({
  /** No schedule recorded, so no judgement is available. */
  UNRECORDED: 'UNRECORDED',
  /** Every period the schedule expects has an instalment against it. */
  ON_TRACK: 'ON_TRACK',
  /** One or more periods the schedule expects have none. */
  MISSED: 'MISSED',
});

const STEP = Object.freeze({ month: 1, quarter: 3 });

/** Why a schedule cannot be judged. Codes, for a screen to put words to. */
export const WHY = Object.freeze({
  NO_START: 'no-start-date',
  NO_AMOUNT: 'no-instalment-amount',
});

/** `YYYY-MM` for a date string, or null. */
const monthKey = (date) => (typeof date === 'string' && date.length >= 7
  ? date.slice(0, 7) : null);

/**
 * `date` shifted by whole months, keeping its day where that day exists.
 *
 * **Always measured from the original date, never from the last one it
 * produced.** Stepping iteratively looks equivalent and is not: a schedule
 * starting on the 31st clamps to the 28th in February, and the next step then
 * measures from *the 28th*, so every later month is wrong and the schedule
 * silently walks backwards — 31st, 28th, 28th, 28th. The first version of this
 * did that, under a comment claiming it did not, and the test for the 31st is
 * what said so.
 */
function addMonths(date, months) {
  const [y, m, d] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, (m - 1) + months, 1));
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth() + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, last);
  // Padded first: `${String(m).padStart(2, '0')}` inside the template reads to
  // `tools/strings.mjs` as a sentence, and a date format is not English.
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Every date the deposit's own schedule says an instalment was due, up to
 * today — or to maturity, whichever comes first.
 *
 * Due *today* counts as due. A deposit whose instalment falls on the day this
 * is asked has not missed it, and reporting it as a gap would make the answer
 * depend on the hour.
 */
export function instalmentSchedule(holding, { clock = Date.now } = {}) {
  const from = holding?.instalmentFrom ?? null;
  const amount = holding?.instalmentAmount ?? null;
  // A code, not a sentence. The domain knows *which* part of the schedule is
  // absent; only a screen knows how to say it, and in which language — a
  // sentence here would be English no catalogue could reach.
  if (!from) return { known: false, why: WHY.NO_START, due: [] };
  if (amount === null || amount === undefined || amount === '') {
    return { known: false, why: WHY.NO_AMOUNT, due: [] };
  }

  const every = STEP[holding?.instalmentEvery] ?? STEP.month;
  const now = new Date(typeof clock === 'function' ? clock() : clock)
    .toISOString().slice(0, 10);
  const end = holding?.maturesOn && holding.maturesOn < now ? holding.maturesOn : now;

  const due = [];
  // `n * every` from the start, not a step from the last date produced — see
  // `addMonths`. The bound stops a malformed date becoming an endless loop.
  for (let n = 0; n < 1000; n += 1) {
    const at = addMonths(from, n * every);
    if (at > end) break;
    due.push(at);
  }
  return { known: true, why: null, due };
}

/**
 * The periods a schedule expects and the record cannot show a payment for.
 *
 * Quarterly deposits are matched against the whole window they open, not the
 * month they start in: an instalment due in January and paid in February is
 * that quarter's payment, and calling January missing while February holds the
 * money would be a gap that is not there.
 *
 * One instalment answers one period. Two payments in a month do not cover the
 * next one — a household that paid twice in March has not paid April, and
 * saying otherwise would hide a real gap behind an early payment.
 */
export function missedInstalments(holding, investmentTransactions, { clock = Date.now } = {}) {
  const schedule = instalmentSchedule(holding, { clock });
  if (!schedule.known) {
    return { status: SCHEDULE.UNRECORDED, why: schedule.why, missed: [], due: 0, paid: 0 };
  }

  const every = STEP[holding?.instalmentEvery] ?? STEP.month;
  const paid = instalmentsOf(investmentTransactions, holding?.id)
    .map((row) => monthKey(row.date))
    .filter(Boolean);

  // Spent as they are consumed, so one payment cannot answer two periods.
  const unclaimed = [...paid];
  const missed = [];

  for (const dueOn of schedule.due) {
    const window = [];
    for (let i = 0; i < every; i += 1) window.push(monthKey(addMonths(dueOn, i)));
    const at = unclaimed.findIndex((month) => window.includes(month));
    if (at === -1) missed.push(dueOn);
    else unclaimed.splice(at, 1);
  }

  return {
    status: missed.length ? SCHEDULE.MISSED : SCHEDULE.ON_TRACK,
    why: null,
    missed,
    due: schedule.due.length,
    paid: paid.length,
  };
}

/**
 * The same question across every recurring deposit, for a screen that wants
 * one line rather than a report per holding.
 */
export function missedInstalmentSummary(holdings, investmentTransactions, options = {}) {
  const rows = recurringDeposits(holdings)
    .map((holding) => ({ holding, ...missedInstalments(holding, investmentTransactions, options) }));
  return {
    rows,
    unrecorded: rows.filter((r) => r.status === SCHEDULE.UNRECORDED).length,
    behind: rows.filter((r) => r.status === SCHEDULE.MISSED).length,
    missed: rows.reduce((n, r) => n + r.missed.length, 0),
  };
}
