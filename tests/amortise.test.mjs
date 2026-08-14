/**
 * What a loan actually owes.
 *
 * `loan.outstanding` is typed once and never updated, and net worth reads it as
 * the liability — so every EMI takes the full amount off net worth while the
 * debt it repaid stays exactly where it was. After five years of paying, the
 * application still shows the debt as it was on the day it was entered.
 *
 * The arithmetic is anchored to a textbook case rather than to itself: ₹50,00,000
 * at 8.5% over 20 years, EMI ₹43,391. Month one is ₹35,417 interest and ₹7,974
 * principal, and any amortisation table will say the same.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  monthlyRate, splitPayment, amortise, canProject, paymentsFor,
  staleness, describeStaleness, emiBreakdown, describeEmi,
} from '../js/domain/amortise.js';

setSuite('amortise');

/** ₹50,00,000 at 8.5% for 20 years, in paise. */
const HOME = {
  id: 'loan_1',
  name: 'Home loan',
  principal: 500_000_000,
  outstanding: 500_000_000,
  interestRate: 8.5,
  emiAmount: 4_339_100,
  startedOn: '2024-01-05',
};

let n = 0;
const emi = (over = {}) => ({
  id: `txn_${++n}`, date: '2024-02-05', kind: 'expense', amount: HOME.emiAmount,
  account: 'acc_hdfc', category: 'EMI', payee: 'Home loan', direction: 'out',
  deletedAt: null, ...over,
});

describe('the arithmetic', () => {
  test('a monthly rate is a twelfth of the annual one', () => {
    assert.close(monthlyRate(12), 0.01, 1e-12);
    assert.equal(monthlyRate(undefined), 0);
  });

  test('month one matches the table', () => {
    const first = splitPayment(HOME.principal, HOME.interestRate, HOME.emiAmount);
    assert.equal(Math.round(first.interest / 100), 35_417);
    assert.equal(Math.round(first.principal / 100), 7_974);
  });

  test('interest is charged on what is owed before the payment', () => {
    // The whole reason an early EMI is nearly all interest and a late one
    // nearly all principal. Charging it after would understate every year.
    const early = splitPayment(HOME.principal, HOME.interestRate, HOME.emiAmount);
    const late = splitPayment(50_000_000, HOME.interestRate, HOME.emiAmount);
    assert.ok(late.interest < early.interest / 5);
    assert.ok(late.principal > early.principal * 4);
  });

  test('a year of payments leaves the balance the table expects', () => {
    // Everything here is in paise, so a lakh is 10,000,000 of them. Getting
    // that divisor wrong is how this test first claimed ₹49 lakh was 4,900.
    const year = amortise(HOME, 12);
    assert.equal(Math.round(year.balance / 10_000_000), 49, 'about ₹49 lakh');
    assert.ok(year.interestPaid > year.principalPaid * 4,
      'the first year of a home loan is almost all interest');
  });

  test('the full term leaves only what the rounded EMI could not clear', () => {
    // ₹102 on a ₹50,00,000 loan, because the EMI is the rounded figure a bank
    // quotes rather than the exact one the formula wants. `cleared` stays
    // strict about it — a rupee outstanding is a rupee outstanding — and the
    // tolerance in `describeStaleness` is what stops that being noise.
    const done = amortise(HOME, 240);
    assert.ok(done.balance < HOME.principal / 10_000,
      `residue ${done.balance} should be under a hundredth of a percent`);
    assert.not(done.cleared, 'and it does not claim to be settled while it is not');
  });

  test('paying more than is owed does not overshoot into credit', () => {
    const last = splitPayment(100_000, HOME.interestRate, HOME.emiAmount);
    assert.ok(last.principal <= 100_000, 'the final payment settles, it does not overpay');
  });
});

describe('when the EMI does not cover the interest', () => {
  // Real, and it happens when a floating rate rises without the EMI being
  // revised. The balance grows. Modelling it away would produce a confident
  // number that is the wrong side of the truth.
  const underwater = { ...HOME, emiAmount: 1_000_000 };

  test('the balance would grow, and that is reported rather than projected', () => {
    const run = amortise(underwater, 12);
    assert.ok(run.negative);
    assert.length(run.rows, 0, 'nothing is projected from a payment that repays nothing');
  });

  test('and the household is told what to check', () => {
    const said = describeStaleness(staleness(underwater, [emi(), emi()]));
    assert.includes(said, 'does not cover the interest');
    assert.includes(said, 'check the rate and the EMI');
  });
});

describe('finding the payments', () => {
  test('an EMI category counts', () => {
    assert.length(paymentsFor(HOME, [emi()]), 1);
  });

  test('a payment named after the loan counts', () => {
    assert.length(paymentsFor(HOME, [emi({ category: 'other', payee: 'HOME LOAN 4412' })]), 1);
  });

  test('money arriving does not', () => {
    // A disbursal is not a repayment, and counting it would run the schedule
    // the wrong way.
    assert.length(paymentsFor(HOME, [emi({ direction: 'in' })]), 0);
  });

  test('a deleted row does not', () => {
    assert.length(paymentsFor(HOME, [emi({ deletedAt: '2026-08-09T00:00:00.000Z' })]), 0);
  });

  test('an unrelated expense does not', () => {
    assert.length(paymentsFor(HOME, [emi({ category: 'groceries', payee: 'Shop' })]), 0);
  });
});

describe('has the stored figure gone stale', () => {
  test('after a year of EMIs it has, by about a lakh', () => {
    const report = staleness(HOME, Array.from({ length: 12 }, () => emi()));

    assert.equal(report.stored, 500_000_000);
    assert.ok(report.difference > 9_000_000, 'roughly a lakh of principal repaid');
    assert.equal(report.payments, 12);
  });

  test('and the sentence names both figures and whose is authoritative', () => {
    // An estimate that presented itself as the answer would have a household
    // arguing with their bank using a number this application made up.
    const said = describeStaleness(staleness(HOME, Array.from({ length: 12 }, () => emi())));

    assert.includes(said, 'still says');
    assert.includes(said, 'nearer');
    assert.includes(said, "lender's statement is the figure that counts");
  });

  test('a difference too small to act on says nothing', () => {
    // Rounding, value dates and a part-payment all move a balance by small
    // amounts, and a household cannot act on any of them.
    const nearly = { ...HOME, outstanding: 499_200_000 };
    const report = staleness(nearly, [emi()]);
    assert.ok(Math.abs(report.difference) < 100_00);
    assert.equal(describeStaleness(report), null);
  });

  test('a stored figure lower than the model is reported the other way round', () => {
    // A prepayment. Real, common, and not something to report as an error.
    const prepaid = { ...HOME, outstanding: 400_000_000 };
    const said = describeStaleness(staleness(prepaid, Array.from({ length: 12 }, () => emi())));

    assert.includes(said, 'lower than');
    assert.includes(said, 'prepayment');
  });
});

describe('when the question cannot be asked', () => {
  test('no payments recorded means nothing is said', () => {
    // A household that has not imported a statement should not be told their
    // loan figure is wrong.
    assert.equal(staleness(HOME, []), null);
  });

  test('missing terms mean nothing is said', () => {
    assert.not(canProject({ ...HOME, interestRate: 0 }));
    assert.not(canProject({ ...HOME, emiAmount: 0 }));
    assert.not(canProject({ ...HOME, startedOn: '' }));
    assert.equal(staleness({ ...HOME, interestRate: 0 }, [emi()]), null);
  });

  test('nothing at all is not an error', () => {
    assert.equal(staleness(null, null), null);
    assert.equal(describeStaleness(null), null);
  });
});

describe('how much of an EMI was actually a cost', () => {
  const dated = (date) => emi({ date });
  const inAugust = (t) => String(t.date).startsWith('2026-08');

  test('the whole payment left the account, and part of it is still yours', () => {
    // Unlike the card double count, nothing here is counted twice: the whole
    // EMI genuinely left. What the spending figure cannot say is that half of
    // it is a cost and half is cash turned into a smaller debt.
    const months = ['2026-06-05', '2026-07-05', '2026-08-05'].map(dated);
    const b = emiBreakdown([HOME], months, inAugust);

    assert.equal(b.total, HOME.emiAmount, 'the whole payment');
    assert.ok(b.interest > 0 && b.principal > 0);
    assert.equal(b.interest + b.principal, b.total);
  });

  test('the split follows the payment’s place in the schedule', () => {
    // An early EMI is nearly all interest and a late one nearly all principal.
    // A flat share of the outstanding would be wrong at both ends of a loan.
    const first = emiBreakdown([HOME], [dated('2026-08-05')], inAugust);

    // 119 monthly payments ending the month before, then the one under test.
    // The first version generated dates running past August 2026, so sorting
    // moved the payment being measured out of last place and it was scored
    // against the wrong row of the schedule.
    const long = Array.from({ length: 119 }, (_, i) => {
      const month = new Date(Date.UTC(2016, 8 + i, 5));
      return dated(month.toISOString().slice(0, 10));
    }).concat(dated('2026-08-05'));
    const later = emiBreakdown([HOME], long, inAugust);

    assert.ok(later.principal > first.principal * 2,
      'the hundred-and-twentieth payment repays far more debt than the first');
    assert.ok(later.interest < first.interest);
  });

  test('only the period is counted, but the whole history drives the schedule', () => {
    const months = ['2026-06-05', '2026-07-05', '2026-08-05'].map(dated);
    const one = emiBreakdown([HOME], months, inAugust);
    const alone = emiBreakdown([HOME], [dated('2026-08-05')], inAugust);

    assert.equal(one.total, alone.total, 'one payment either way');
    assert.ok(one.principal > alone.principal,
      'but the third payment repays more than the first');
  });

  test('the sentence does not claim the spending figure is wrong', () => {
    // Because it is not. It is a correct cash-flow number that conflates a
    // cost with a transfer into equity.
    const said = describeEmi(emiBreakdown([HOME], [dated('2026-08-05')], inAugust));
    assert.includes(said, 'still yours');
    assert.includes(said, 'The cost was the interest');
    assert.not(/wrong|incorrect|double/i.test(said), said);
  });
});

describe('loans that cannot be split', () => {
  const dated = (date) => emi({ date });
  const inAugust = (t) => String(t.date).startsWith('2026-08');

  test('missing terms still count in the total, and are named', () => {
    // A figure that quietly excluded them would be smaller than the truth and
    // impossible to reconcile against a bank statement.
    const vague = { ...HOME, interestRate: 0, name: 'Car loan' };
    const b = emiBreakdown([vague], [dated('2026-08-05')], inAugust);

    assert.equal(b.total, HOME.emiAmount);
    assert.equal(b.principal, 0);
    assert.length(b.unprojected, 1);
    assert.includes(describeEmi(b), 'Car loan');
  });

  test('an EMI that does not cover the interest is counted, not split', () => {
    const underwater = { ...HOME, emiAmount: 1_000_000, name: 'Personal loan' };
    const b = emiBreakdown([underwater], [emi({ date: '2026-08-05', amount: 1_000_000 })], inAugust);

    assert.equal(b.total, 1_000_000);
    assert.equal(b.principal, 0);
    assert.length(b.unprojected, 1);
  });

  test('more payments than the schedule has rows are counted, not split', () => {
    // A top-up, or a payee that matches two loans. The money went out either
    // way, so it belongs in the total.
    const many = Array.from({ length: 260 }, () => dated('2026-08-05'));
    const b = emiBreakdown([HOME], many, inAugust);

    assert.equal(b.total, HOME.emiAmount * 260);
    assert.ok(b.principal > 0, 'the rows that do exist are still split');
    assert.ok(b.interest + b.principal < b.total, 'and the rest is left unsplit');
  });

  test('a loan with no payments at all is not mentioned', () => {
    assert.equal(describeEmi(emiBreakdown([HOME], [], inAugust)), null);
    assert.equal(describeEmi(emiBreakdown(null, null, inAugust)), null);
  });
});
