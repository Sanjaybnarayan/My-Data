/**
 * What a deposit is worth now.
 *
 * The loan bug in a mirror. `loan.outstanding` was typed once and never fell;
 * `holding.currentValue` is typed once and never grows. Both push net worth the
 * same way — down — once by holding a liability up and once by holding an asset
 * down.
 *
 * The arithmetic is anchored to a figure worked out independently rather than
 * to the implementation: ₹5,00,000 at 7.1% compounded quarterly for two years
 * is 500000 × (1 + 0.071/4)^8 ≈ **₹5,75,571**.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  COMPOUNDING, REFUSED, yearsBetween, canAccrue, accruedValue,
  accrualReport, describeAccrual,
} from '../js/domain/accrual.js';

setSuite('accrual');

/** ₹5,00,000 at 7.1%, valued on the day it was opened. */
const FD = {
  id: 'h1',
  name: 'SBI deposit',
  kind: 'fixed deposit',
  invested: 50_000_000,
  currentValue: 50_000_000,
  interestRate: 7.1,
  valuedOn: '2024-08-01',
  maturesOn: '2027-08-01',
  active: true,
  deletedAt: null,
};

const TWO_YEARS_ON = '2026-08-01';

describe('the arithmetic', () => {
  test('two years of quarterly compounding matches the worked figure', () => {
    // Within ₹100 of it, and the residue is a day count rather than an error:
    // the worked figure takes exactly eight quarters, while the code measures
    // elapsed time in years of 365.25 days, which makes two calendar years
    // 1.9986 of them. ₹100 is far tighter than the gap to any of the ways this
    // could be got wrong — compounding annually lands ₹2,208 away and simple
    // interest ₹4,620 away.
    const run = accruedValue(FD, TWO_YEARS_ON);
    assert.close(Math.round(run.value / 100), 575_571, 100);
    assert.close(Math.round(run.interest / 100), 75_571, 100);
  });

  test('and the application was reporting a gain of zero', () => {
    // The whole point. `currentValue` is the typed figure and nothing moves it.
    assert.equal(FD.currentValue, FD.invested);
    assert.ok(accruedValue(FD, TWO_YEARS_ON).interest > 7_000_000);
  });

  test('a PPF compounds yearly, not quarterly', () => {
    // Quarterly on an annual instrument overstates it, and the difference
    // grows with every year held.
    const ppf = { ...FD, kind: 'PPF', maturesOn: '' };
    assert.equal(COMPOUNDING.PPF, 1);
    assert.ok(accruedValue(ppf, TWO_YEARS_ON).value < accruedValue(FD, TWO_YEARS_ON).value);
  });

  test('interest stops at maturity', () => {
    // What happened after — a withdrawal, or a renewal at a rate nobody
    // recorded — is not knowable from here.
    const short = { ...FD, maturesOn: '2025-08-01' };
    const atMaturity = accruedValue(short, '2025-08-01');
    const longAfter = accruedValue(short, '2030-08-01');

    assert.equal(longAfter.value, atMaturity.value);
    assert.ok(longAfter.matured);
    assert.includes(describeAccrual(longAfter), 'It matured');
  });

  test('accrues from the last value recorded, not from what was put in', () => {
    // The two differ the moment anybody updates the figure from a statement,
    // and `valuedOn` dates the *recorded value*. Accruing from `invested`
    // instead would count every year already reflected in that figure twice.
    const updated = { ...FD, currentValue: 54_000_000, valuedOn: '2025-08-01' };
    const run = accruedValue(updated, TWO_YEARS_ON);

    assert.equal(run.base, 54_000_000);
    assert.close(Math.round(run.interest / 100), 39_345, 100);
  });

  test('and from what was put in when no value has been recorded since', () => {
    assert.equal(accruedValue({ ...FD, currentValue: 0 }, TWO_YEARS_ON).base, FD.invested);
  });

  test('a value dated today has not accrued anything yet', () => {
    assert.equal(accruedValue({ ...FD, valuedOn: TWO_YEARS_ON }, TWO_YEARS_ON), null);
  });

  test('an unreadable date accrues nothing rather than everything', () => {
    assert.equal(yearsBetween('whenever', TWO_YEARS_ON), null);
    assert.equal(accruedValue({ ...FD, valuedOn: 'whenever' }, TWO_YEARS_ON), null);
  });
});

describe('where it refuses, and why', () => {
  test('a recurring deposit, because instalments are not a lump sum', () => {
    // Applying the lump-sum formula would overstate it substantially — most
    // instalments have not been in for the full term.
    const rd = { ...FD, kind: 'recurring deposit' };
    const check = canAccrue(rd);
    assert.not(check.ok);
    assert.includes(check.why, 'instalments');
    assert.equal(accruedValue(rd, TWO_YEARS_ON), null);
  });

  test('anything market-linked, because a price is not a rate', () => {
    for (const kind of ['stock', 'mutual fund', 'gold', 'NPS', 'crypto']) {
      assert.not(canAccrue({ ...FD, kind }).ok, `${kind} should be refused`);
      assert.ok(REFUSED[kind], `${kind} should say why`);
    }
  });

  test('a bond, because a coupon is not compound accrual', () => {
    assert.includes(canAccrue({ ...FD, kind: 'bond' }).why, 'coupons');
  });

  test('a kind nobody has thought about', () => {
    // Absent from the table means do not accrue. A kind nobody has considered
    // is a kind nobody has checked.
    assert.not(canAccrue({ ...FD, kind: 'business' }).ok);
  });

  test('no date for when the value was true', () => {
    // Without it there is nothing to accrue *from*, and picking the start date
    // would silently assume the figure was never updated.
    const check = canAccrue({ ...FD, valuedOn: '' });
    assert.not(check.ok);
    assert.includes(check.why, 'nothing to accrue from');
  });

  test('no rate, and no amount', () => {
    assert.not(canAccrue({ ...FD, interestRate: 0 }).ok);
    assert.not(canAccrue({ ...FD, currentValue: 0, invested: 0 }).ok);
  });
});

describe('the report', () => {
  test('names what has drifted and by how much in total', () => {
    const report = accrualReport([FD], TWO_YEARS_ON);
    assert.length(report.drifted, 1);
    assert.close(Math.round(report.understated / 100), 75_571, 100);
  });

  test('a deposit that cannot be checked is listed with its reason', () => {
    const rd = { ...FD, id: 'h2', kind: 'recurring deposit' };
    const report = accrualReport([rd], TWO_YEARS_ON);

    assert.length(report.drifted, 0);
    assert.length(report.unchecked, 1);
    assert.includes(report.unchecked[0].why, 'instalments');
  });

  test('a share is not listed as a deposit that could not be valued', () => {
    // It never could be. Listing it would be noise, and noise trains people to
    // stop reading the list.
    const report = accrualReport([{ ...FD, kind: 'stock' }], TWO_YEARS_ON);
    assert.length(report.unchecked, 0);
  });

  test('a drift too small to act on is not mentioned', () => {
    // ₹10,000 at 7.1% earns under ₹4 in two days. Rounding, a value date and a
    // credit landing a day late all move a figure by more than that, and a
    // household cannot act on any of them.
    const small = {
      ...FD, invested: 10_000_00, currentValue: 10_000_00, valuedOn: '2026-07-30',
    };
    assert.length(accrualReport([small], TWO_YEARS_ON).drifted, 0);
  });

  test('a closed or deleted holding is left out', () => {
    assert.length(accrualReport([{ ...FD, active: false }], TWO_YEARS_ON).drifted, 0);
    assert.length(accrualReport(
      [{ ...FD, deletedAt: '2026-01-01T00:00:00.000Z' }], TWO_YEARS_ON,
    ).drifted, 0);
  });

  test('nothing at all is not an error', () => {
    assert.equal(accrualReport(undefined, TWO_YEARS_ON).understated, 0);
    assert.equal(describeAccrual(null), null);
  });
});

describe('the sentence', () => {
  test('gives both figures and names the bank as the authority', () => {
    // An estimate presenting itself as the answer would have a household
    // arguing with their bank using a number this application made up.
    const said = describeAccrual(accrualReport([FD], TWO_YEARS_ON).drifted[0]);

    assert.includes(said, '2024-08-01');
    assert.includes(said, 'quarterly');
    assert.includes(said, "bank's figure is the one that counts");
  });

  test('and says how often it assumed the interest compounds', () => {
    // The assumption is the part most likely to be wrong, so it is stated
    // rather than buried.
    const ppf = { ...FD, kind: 'PPF', maturesOn: '' };
    assert.includes(describeAccrual(accrualReport([ppf], TWO_YEARS_ON).drifted[0]), 'yearly');
  });
});
