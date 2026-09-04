/**
 * What a holding actually cost, from the transactions rather than the form.
 *
 * ## The gap
 *
 * `holding.invested`, `holding.units` and `holding.averageCost` are typed on
 * the holding form. `investmentTransaction` records every buy and sell with
 * units, a price per unit, an amount and the charges — and nothing re-read
 * them. This is the shape the roadmap names as the source of every wrong
 * number found in this repository so far: *a figure with a date attached that
 * nothing ever re-reads.*
 *
 * Measured on a fund bought once and then fed a ₹5,000 monthly SIP for eleven
 * months, with all twelve purchases recorded:
 *
 *     invested, as the app reported it : ₹50,000.00
 *     invested, per the transactions   : ₹1,05,132.00   (charges included)
 *     units, as the holding said       : 100
 *     units, per the transactions      : 200.579
 *
 *     gain, as the app reported it     : ₹81,000.00  (162%)
 *     gain, against what really went in: ₹25,868.00  (24.61%)
 *
 * **162% against 24.61%.** And the same screen showed an XIRR of 34%, worked
 * out from those very transactions — so two numbers about one holding, side by
 * side, disagreed because only one of them was reading the records.
 *
 * ## Average cost, and what that is not
 *
 * A sale removes cost at the **average** paid so far, which is how a unitised
 * holding is normally understood and the only method the recorded fields can
 * support.
 *
 * It is **not a tax computation.** Indian capital gains are worked out FIFO,
 * with grandfathering, indexation and holding-period rules this knows nothing
 * about, and a realised figure here must never be copied onto a return. It
 * answers *"what did this cost me and what came back"*, and says so.
 *
 * ## It offers, it does not overwrite
 *
 * The stored figure stays exactly where it is. Where the two disagree the
 * difference is reported, because a transaction history that starts halfway
 * through a holding's life derives a **lower** figure than the truth — and
 * silently replacing a right number with a wrong one is worse than the gap
 * this exists to close. Same rule as `domain/accrual.js` and
 * `domain/amortise.js`: derive, show, name the disagreement, never substitute.
 */


import { roundMoney, addable } from '../core/money.js';
import { settled } from '../data/integrity.js';
/** Money going in: units acquired and cost incurred. */
const INWARD = new Set(['buy', 'contribution']);

/** Money coming out against the holding itself. */
const OUTWARD = new Set(['sell', 'withdrawal']);

/**
 * Kinds that pay out without consuming any of the holding.
 *
 * A dividend is a return, not a disposal, so it must not reduce the cost
 * basis — doing so would report a stock as having cost less every time it paid
 * out, and eventually as having cost nothing at all.
 */
const INCOME = new Set(['dividend', 'interest']);

/** Kinds that change the unit count with no money attached. */
const UNIT_ONLY = new Set(['bonus', 'split']);

/** What one transaction cost, preferring the amount to a reconstruction. */
function amountOf(txn) {
  if (txn.amount !== null && txn.amount !== undefined) return txn.amount;
  // `pricePerUnit` was recorded on every buy and read by nothing. Where the
  // amount is missing it is the only thing that can say what was paid.
  if (txn.units && txn.pricePerUnit) return roundMoney(txn.units * txn.pricePerUnit);
  return 0;
}

/**
 * What a holding cost, what it holds, and what has already come back.
 *
 * @param {object} holding
 * @param {Array<object>} transactions all investment transactions
 * @returns {{
 *   invested: number, units: number, charges: number, realised: number,
 *   income: number, count: number, from: 'transactions'|'stored',
 *   stored: {invested: number, units: number}, difference: number, why: string|null
 * }}
 */
export function costBasis(holding, transactions = []) {
  const stored = {
    invested: holding?.invested ?? 0,
    units: holding?.units ?? 0,
  };

  const rows = (transactions ?? [])
    .filter((t) => t.holding === holding?.id && settled(t))
    /*
     * Order decides the average, so a list that arrived in any other order
     * would give a different answer for the same records.
     *
     * **The date alone did not settle it.** Two trades on one day tie, and a
     * stable sort leaves a tie in the order the caller supplied — which is
     * whatever the repository happened to return. Measured, on one buy and one
     * sell dated the same day: `invested=120000 realised=20000` one way round
     * and `invested=130000 realised=30000` the other. A ₹10,000 difference in
     * a household's realised gain, decided by storage order.
     *
     * That is an ordinary day on a broker statement, and `domain/tradebook.js`
     * imports exactly those files.
     *
     * Within a day, acquisitions settle before disposals: you cannot sell what
     * the day's buy has not yet given you, which is how a contract note reads
     * and how same-day activity is conventionally treated. Everything that is
     * not a disposal ranks first — a buy, a bonus, a dividend, a charge — and
     * their order among themselves cannot change the outcome, because each
     * only adds to `cost` or `units` and neither reads the other.
     */
    .sort((a, b) => String(a.date).localeCompare(String(b.date))
      || (OUTWARD.has(a.kind) ? 1 : 0) - (OUTWARD.has(b.kind) ? 1 : 0));

  if (!rows.length) {
    return {
      ...stored,
      charges: 0,
      realised: 0,
      income: 0,
      count: 0,
      from: 'stored',
      stored,
      difference: 0,
      why: 'no transactions are recorded against this holding, so the figures '
        + 'on the form are all there is',
    };
  }

  let units = 0;
  let cost = 0;
  let charges = 0;
  let realised = 0;
  let income = 0;

  for (const txn of rows) {
    const amount = amountOf(txn);
    const fee = addable(txn.charges);

    if (INWARD.has(txn.kind)) {
      units += txn.units ?? 0;
      // Brokerage, STT and stamp duty are money the household paid to own
      // this. Leaving them out understates the cost and overstates the gain.
      cost += amount + fee;
      charges += fee;
      continue;
    }

    if (OUTWARD.has(txn.kind)) {
      const average = units ? cost / units : 0;
      // A sale with no unit count still sold something. Reconstructing from
      // the average is the only reading available, and it is better than
      // treating the sale as having disposed of nothing at all.
      const sold = txn.units ?? (average ? amount / average : 0);
      const removed = roundMoney(average * Math.min(sold, units));

      units = Math.max(0, units - sold);
      cost = Math.max(0, cost - removed);
      charges += fee;
      realised += (amount - fee) - removed;
      continue;
    }

    if (INCOME.has(txn.kind)) {
      // A dividend is a return, not a disposal. It leaves the cost alone.
      income += amount - fee;
      charges += fee;
      continue;
    }

    if (UNIT_ONLY.has(txn.kind)) {
      // Bonus and split units cost nothing: more units, same money, so the
      // average falls out of the arithmetic on its own.
      units += txn.units ?? 0;
      continue;
    }

    if (txn.kind === 'charge') {
      // An account or fund charge is money out with nothing acquired.
      cost += amount + fee;
      charges += amount + fee;
    }
  }

  const invested = roundMoney(cost);
  const rounded = Math.round(units * 1000) / 1000;

  return {
    invested,
    units: rounded,
    charges,
    realised: roundMoney(realised),
    income: roundMoney(income),
    count: rows.length,
    from: 'transactions',
    stored,
    difference: invested - stored.invested,
    // A transaction history that begins halfway through a holding's life
    // derives a figure lower than the truth. Saying so is the difference
    // between a correction and a new wrong number.
    why: invested < stored.invested
      ? 'the transactions add up to less than the figure on the form, which '
        + 'usually means the earliest purchases were never recorded'
      : null,
  };
}

/**
 * A holding's gain, worked out against what it actually cost.
 *
 * `value` is passed in rather than read here: the Investments screen already
 * decides whether a deposit's worth comes from the stored figure or from
 * `domain/accrual.js`, and this must not make that decision a second time and
 * differently.
 */
export function gainOn(basis, value) {
  const invested = basis?.invested ?? 0;
  // What came back already counts. A fund sold down to nothing that returned
  // more than it took has not "lost everything", and reporting only the
  // remaining units would say exactly that.
  const returned = (value ?? 0) + (basis?.realised ?? 0) + (basis?.income ?? 0);

  return {
    invested,
    value: value ?? 0,
    realised: basis?.realised ?? 0,
    income: basis?.income ?? 0,
    gain: returned - invested,
    gainPercent: invested
      ? Math.round(((returned - invested) / invested) * 10_000) / 100
      : null,
  };
}

/**
 * One holding's cost basis, as a sentence.
 *
 * @param {(n: number) => string} money
 */
export function describeCostBasis(basis, money = (n) => String(n)) {
  if (!basis) return null;
  if (basis.from === 'stored') return `${basis.why}.`;

  const parts = [
    `${money(basis.invested)} across ${basis.count} `
    + `transaction${basis.count === 1 ? '' : 's'}`,
  ];

  if (basis.charges) parts.push(`, including ${money(basis.charges)} of charges`);

  if (basis.difference) {
    parts.push(basis.why
      ? `. The form says ${money(basis.stored.invested)} — ${basis.why}`
      : `. The form says ${money(basis.stored.invested)}, which is `
        + `${money(basis.difference)} less than the transactions add up to`);
  }

  return `${parts.join('')}.`;
}
