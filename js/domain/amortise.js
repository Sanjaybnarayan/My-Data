/**
 * What a loan actually owes, given the payments that have been made.
 *
 * ## The bug this exists to find
 *
 * `loan.outstanding` is a stored number that somebody typed once. Nothing
 * updates it. Net worth reads it as the liability, so a household paying an EMI
 * every month sees this:
 *
 *   - the bank balance falls by the whole EMI      → net worth down
 *   - the loan's outstanding does not move at all  → net worth unchanged
 *
 * So **net worth falls by the full EMI every month**, when most of that money
 * did not leave the household at all — it converted cash into a smaller debt.
 * And after five years of paying, the application still shows the debt as it
 * was on the day it was entered.
 *
 * ## What this is, and what it is not
 *
 * It is a **model**. Given a starting balance, a rate and an EMI, ordinary
 * amortisation says how much of each payment was interest and how much repaid
 * the debt. That arithmetic is exact.
 *
 * It is **not the lender's ledger**, and the difference matters:
 *
 *   - Floating rates move. A home loan repriced twice in three years has an
 *     amortisation curve this cannot know about.
 *   - Prepayments, part-payments and moratoria all change the balance without
 *     changing the EMI.
 *   - Lenders round, charge fees, and apply payments on their own value dates.
 *
 * So nothing here overwrites the stored figure. It reports what the payments
 * imply, next to what was typed, and says which is which. **The lender's own
 * statement is the truth**; this is a check that the household's copy has not
 * gone stale, and a way to see how much of an EMI is actually a cost.
 */

/** A year of an annual rate, as a monthly fraction. */
export const monthlyRate = (annualPercent) => (annualPercent ?? 0) / 100 / 12;

/**
 * Split one payment into interest and principal.
 *
 * The interest is charged on what is owed *before* the payment, which is the
 * whole reason an early EMI is nearly all interest and a late one nearly all
 * principal.
 */
export function splitPayment(balance, annualPercent, emi) {
  const interest = Math.round(balance * monthlyRate(annualPercent));
  // A payment smaller than the interest does not repay anything — the balance
  // grows. Real, and it happens when a floating rate rises without the EMI
  // being revised. Reported rather than modelled away.
  const principal = Math.min(emi - interest, balance);
  return { interest, principal, negative: principal <= 0 };
}

/**
 * Walk the payments forward from a starting balance.
 *
 * @param {{principal: number, interestRate: number, emiAmount: number}} loan
 * @param {number} payments how many EMIs have been made
 * @returns {{rows: object[], balance: number, interestPaid: number,
 *            principalPaid: number, negative: boolean, cleared: boolean}}
 */
export function amortise(loan, payments) {
  const rows = [];
  let balance = loan?.principal ?? 0;
  let interestPaid = 0;
  let principalPaid = 0;
  let negative = false;

  for (let i = 0; i < payments; i++) {
    if (balance <= 0) break;
    const step = splitPayment(balance, loan.interestRate, loan.emiAmount ?? 0);
    if (step.negative) { negative = true; break; }

    balance -= step.principal;
    interestPaid += step.interest;
    principalPaid += step.principal;
    rows.push({ n: i + 1, ...step, balance });
  }

  return {
    rows,
    balance: Math.max(0, Math.round(balance)),
    interestPaid,
    principalPaid,
    negative,
    cleared: balance <= 0,
  };
}

/** Do the loan's terms support any of this arithmetic at all? */
export function canProject(loan) {
  return Boolean(loan)
    && (loan.principal ?? 0) > 0
    && (loan.emiAmount ?? 0) > 0
    && (loan.interestRate ?? 0) > 0
    && Boolean(loan.startedOn);
}

/** EMI payments recorded against this loan, oldest first. */
export function paymentsFor(loan, transactions) {
  const named = String(loan?.name ?? '').toLowerCase();
  return (transactions ?? [])
    .filter((t) => !t.deletedAt && t.direction !== 'in')
    .filter((t) => t.category === 'EMI' || t.category === 'emi'
      || t.recurring === loan?.id
      || (named && String(t.payee ?? '').toLowerCase().includes(named)))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

/**
 * Has the stored balance gone stale, and by how much?
 *
 * @returns {null|{stored, estimated, difference, payments, interestPaid,
 *                 principalPaid, why}}
 *   `null` when the question cannot be asked — missing terms, or no payments
 *   recorded. Saying nothing is right there: a household that has not imported
 *   a statement should not be told their loan figure is wrong.
 */
export function staleness(loan, transactions) {
  if (!canProject(loan)) return null;

  const payments = paymentsFor(loan, transactions);
  if (!payments.length) return null;

  const run = amortise(loan, payments.length);

  if (run.negative) {
    return {
      stored: loan.outstanding ?? 0,
      estimated: null,
      difference: 0,
      payments: payments.length,
      interestPaid: run.interestPaid,
      principalPaid: run.principalPaid,
      why: 'The EMI does not cover the interest at this rate, so the balance would '
        + 'grow rather than fall. That happens when a floating rate rises without '
        + 'the EMI being revised — check the rate and the EMI against the lender.',
    };
  }

  const stored = loan.outstanding ?? 0;
  return {
    stored,
    estimated: run.balance,
    difference: stored - run.balance,
    payments: payments.length,
    interestPaid: run.interestPaid,
    principalPaid: run.principalPaid,
    why: null,
  };
}

/**
 * The finding as a sentence, or null when there is nothing worth saying.
 *
 * A tolerance, because an estimate that quibbles about a hundred rupees would
 * be noise: rounding, value dates and a part-payment all move a balance by
 * small amounts, and a household cannot act on any of them.
 *
 * @param {(n: number) => string} [money]
 */
export function describeStaleness(report, money = (n) => String(n), tolerance = 100_00) {
  if (!report) return null;
  if (report.why) return report.why;
  if (Math.abs(report.difference) <= tolerance) return null;

  const emis = `${report.payments} ${report.payments === 1 ? 'EMI' : 'EMIs'}`;

  if (report.difference > 0) {
    return `This loan still says ${money(report.stored)} is outstanding, which is what `
      + `it was when it was entered. After ${emis}, ordinary amortisation puts it nearer `
      + `${money(report.estimated)} — of which ${money(report.principalPaid)} repaid the `
      + `debt and ${money(report.interestPaid)} was interest. The lender's statement is `
      + 'the figure that counts; this is only a check that yours has not gone stale.';
  }

  return `This loan says ${money(report.stored)} is outstanding, but after ${emis} `
    + `ordinary amortisation puts it nearer ${money(report.estimated)} — lower than `
    + 'recorded. A prepayment or a rate change would explain it. The lender’s '
    + 'statement is the figure that counts.';
}
