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


import { mul, roundMoney, addable } from '../core/money.js';
import { settled } from '../data/integrity.js';
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
  const interest = mul(balance, monthlyRate(annualPercent));
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
    balance: Math.max(0, roundMoney(balance)),
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
    .filter((t) => settled(t) && t.direction !== 'in')
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

/* ----------------------------------------------------- what an EMI really is */

/**
 * How much of a period's EMI outflow was a cost, and how much repaid debt.
 *
 * ## The distinction, and why the existing number is not wrong
 *
 * Unlike the credit-card double count, nothing here is being counted twice.
 * The whole EMI genuinely left the account, so as a cash-flow figure
 * `totals().expense` is correct and stays correct.
 *
 * What it cannot say is that the two halves of an EMI are different kinds of
 * thing:
 *
 *   - the **interest** is a cost — money the household will never see again
 *   - the **principal** is still theirs, moved from cash into a smaller debt
 *
 * A household deciding whether they can afford something wants the first
 * number. A household reconciling their bank account wants the second. Both
 * are true, which is why this reports alongside rather than replacing.
 *
 * ## Which payment is which
 *
 * The split depends on where in the schedule a payment falls — an early EMI is
 * nearly all interest, a late one nearly all principal. So the whole payment
 * history is walked, and only the rows landing inside the period are counted.
 * Taking a flat share of the outstanding would be wrong at both ends of a loan.
 *
 * @param {object[]} loans
 * @param {object[]} transactions every payment ever recorded, not just the period
 * @param {(txn: object) => boolean} inPeriod
 * @returns {{total, interest, principal, byLoan, unprojected}}
 */
export function emiBreakdown(loans, transactions, inPeriod) {
  let total = 0;
  let interest = 0;
  let principal = 0;
  const byLoan = [];
  const unprojected = [];

  for (const loan of (loans ?? []).filter(settled)) {
    const payments = paymentsFor(loan, transactions);
    if (!payments.length) continue;

    // A loan whose terms are missing still has payments, and those payments
    // still left the account. Counted in the total and named as unsplittable,
    // rather than dropped — a figure that quietly excluded them would be
    // smaller than the truth and impossible to reconcile.
    if (!canProject(loan)) {
      const spent = payments.filter(inPeriod).reduce((n, t) => n + addable(t.amount), 0);
      if (spent) {
        total += spent;
        unprojected.push({ loan: loan.name, amount: spent });
      }
      continue;
    }

    const run = amortise(loan, payments.length);
    if (run.negative) {
      const spent = payments.filter(inPeriod).reduce((n, t) => n + addable(t.amount), 0);
      if (spent) {
        total += spent;
        unprojected.push({ loan: loan.name, amount: spent });
      }
      continue;
    }

    let loanInterest = 0;
    let loanPrincipal = 0;
    let loanTotal = 0;

    payments.forEach((payment, index) => {
      if (!inPeriod(payment)) return;
      const row = run.rows[index];
      // More payments recorded than the schedule has rows means the loan ran
      // past its own term — a top-up, or a mis-matched payee. The money still
      // went out, so it is counted and not split.
      if (!row) {
        loanTotal += addable(payment.amount);
        return;
      }
      loanTotal += addable(payment.amount);
      loanInterest += row.interest;
      loanPrincipal += row.principal;
    });

    if (!loanTotal) continue;

    total += loanTotal;
    interest += loanInterest;
    principal += loanPrincipal;
    byLoan.push({
      loan: loan.name,
      total: loanTotal,
      interest: loanInterest,
      principal: loanPrincipal,
    });
  }

  return { total, interest, principal, byLoan, unprojected };
}

/**
 * The breakdown as a sentence, or null when there is nothing worth saying.
 *
 * Deliberately does not say the spending figure is wrong, because it is not.
 * It says what part of it was a cost.
 *
 * @param {(n: number) => string} [money]
 */
export function describeEmi(breakdown, money = (n) => String(n)) {
  if (!breakdown?.total) return null;
  if (!breakdown.principal) {
    return breakdown.unprojected.length
      ? `${money(breakdown.total)} of loan payments cannot be split into interest and `
        + 'principal — the terms recorded against '
        + `${breakdown.unprojected.map((u) => u.loan).join(' and ')} are incomplete.`
      : null;
  }

  const rest = breakdown.unprojected.length
    ? ` A further ${money(breakdown.unprojected.reduce((n, u) => n + addable(u.amount), 0))} could `
      + 'not be split, because those loans have incomplete terms.'
    : '';

  return `${money(breakdown.total)} of that went on loan payments, and `
    + `${money(breakdown.principal)} of it repaid the debt rather than being spent — `
    + `that money is still yours, as a smaller liability. The cost was the interest, `
    + `${money(breakdown.interest)}.${rest}`;
}
