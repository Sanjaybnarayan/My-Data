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
  canAccrueRecurring, recurringValue, instalmentsFor,
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

/* ------------------------------------------------------ recurring deposits */

/**
 * ₹5,000 a month for two years at 6.8%, every instalment recorded against the
 * holding — which is what a recurring deposit actually is.
 *
 * The first version of this file refused every RD on the grounds that its
 * schedule "is not recorded here". That was wrong: these are ordinary
 * investment transactions, and `domain/portfolio.js` was already reading them
 * to build cash flows.
 */
const RD = {
  id: 'rd1',
  name: 'HDFC recurring deposit',
  kind: 'recurring deposit',
  invested: 12_000_000,
  currentValue: 12_000_000,
  interestRate: 6.8,
  // Deliberately *not* the first instalment's date. `valuedOn` on an RD is
  // whatever somebody last typed, and an estimate that dated its instalments
  // from it would be describing a schedule that does not exist. The two were
  // equal in the first version of this fixture, and a mutation swapping them
  // survived because of it.
  valuedOn: '2025-06-01',
  maturesOn: '2026-08-05',
  active: true,
  deletedAt: null,
};

/** Twenty-four monthly instalments of ₹5,000, oldest first. */
const INSTALMENTS = Array.from({ length: 24 }, (_, i) => ({
  id: `it${i}`,
  holding: 'rd1',
  date: new Date(Date.UTC(2024, 7 + i, 5)).toISOString().slice(0, 10),
  kind: 'contribution',
  amount: 500_000,
}));

describe('a recurring deposit', () => {
  test('one instalment is the lump-sum case, and must agree with it', () => {
    // The anchor for all of this. A single instalment reduces to ordinary
    // compound interest, which is hand-computable: ₹10,000 at 6.8% compounded
    // quarterly for two years is 10000 × 1.017^8 ≈ **₹11,444**. If the
    // per-instalment arithmetic were wrong, it would be wrong here too.
    const one = [{ id: 'x', holding: 'rd1', date: '2024-08-01', kind: 'contribution', amount: 1_000_000 }];
    const run = recurringValue({ ...RD, maturesOn: '' }, one, TWO_YEARS_ON);

    assert.close(Math.round(run.value / 100), 11_444, 10);
    assert.equal(run.instalments, 1);
    assert.equal(run.base, 1_000_000);
  });

  test('and twenty-four instalments earn nothing like the same total as a lump sum', () => {
    // The whole difference. The first instalment has been in for two years and
    // the last for a month, so treating ₹1,20,000 as though it went in on day
    // one **roughly doubles** the interest. That is the error the old refusal
    // was avoiding — and the reason to do this properly rather than not at all.
    const run = recurringValue(RD, INSTALMENTS, '2026-08-01');

    const asLump = accruedValue({
      ...RD, kind: 'fixed deposit', valuedOn: INSTALMENTS[0].date, maturesOn: '',
    }, '2026-08-01');

    assert.equal(run.base, 12_000_000);
    assert.close(Math.round(run.interest / 100), 8_724, 100);
    assert.ok(asLump.interest > run.interest * 1.9,
      `lump sum ${asLump.interest} vs instalments ${run.interest}`);
  });

  test('an earlier instalment has earned more than a later one', () => {
    // A property of the answer rather than of the arithmetic, and the thing a
    // flat rate on the total would get wrong at both ends.
    const first = recurringValue(RD, [INSTALMENTS[0]], '2026-08-01');
    const last = recurringValue(RD, [INSTALMENTS[23]], '2026-08-01');

    assert.ok(first.interest > last.interest * 10,
      `first ${first.interest}, last ${last.interest}`);
  });

  test('interest stops at maturity here too', () => {
    const atMaturity = recurringValue(RD, INSTALMENTS, '2026-08-05');
    const longAfter = recurringValue(RD, INSTALMENTS, '2030-08-05');

    assert.equal(longAfter.value, atMaturity.value);
    assert.ok(longAfter.matured);
  });

  test('an instalment dated after the run counts as paid but has earned nothing', () => {
    // Post-dated or mis-typed, the money is recorded as having gone in. Quietly
    // dropping it would make the total disagree with the household's own list.
    const future = [{ ...INSTALMENTS[0], id: 'later', date: '2027-01-01' }];
    const run = recurringValue({ ...RD, maturesOn: '' }, future, TWO_YEARS_ON);

    assert.equal(run.base, 500_000);
    assert.equal(run.value, 500_000);
    assert.equal(run.interest, 0);
  });

  test('only money going in counts as an instalment', () => {
    const mixed = [
      ...INSTALMENTS.slice(0, 3),
      { id: 'n1', holding: 'rd1', date: '2025-01-05', kind: 'contribution', amount: 0 },
      { id: 'n2', holding: 'other', date: '2025-01-05', kind: 'contribution', amount: 500_000 },
      { id: 'n3', holding: 'rd1', date: '2025-01-05', kind: 'contribution', amount: 500_000, deletedAt: '2025-02-01T00:00:00.000Z' },
    ];
    assert.length(instalmentsFor(RD, mixed), 3);
  });
});

describe('where a recurring deposit is still refused', () => {
  test('no instalments recorded, because an RD is its instalments', () => {
    // The honest remainder of the old refusal. Not "this cannot be done" but
    // "there is nothing here to do it with", and it says what would fix that.
    const check = canAccrueRecurring(RD, []);

    assert.not(check.ok);
    assert.includes(check.why, 'no instalments are recorded');
    assert.includes(check.why, 'add them');
    assert.equal(recurringValue(RD, [], TWO_YEARS_ON), null);
  });

  test('interest already recorded, because estimating it again would double it', () => {
    // The credit-card double count wearing a different hat. A household that
    // records the interest credit is already counting it.
    const withInterest = [
      ...INSTALMENTS,
      { id: 'int', holding: 'rd1', date: '2025-08-05', kind: 'interest', amount: 400_000 },
    ];
    const check = canAccrueRecurring(RD, withInterest);

    assert.not(check.ok);
    assert.includes(check.why, 'twice');
  });

  test('a withdrawal or a charge, because the terms are no longer the ones it started with', () => {
    for (const kind of ['withdrawal', 'charge']) {
      const broken = [...INSTALMENTS, { id: 'b', holding: 'rd1', date: '2025-08-05', kind, amount: 100_000 }];
      const check = canAccrueRecurring(RD, broken);
      assert.not(check.ok, `${kind} should be refused`);
      assert.includes(check.why, 'not the ones it started with');
    }
  });

  test('no rate, and nothing that is not a recurring deposit', () => {
    assert.not(canAccrueRecurring({ ...RD, interestRate: 0 }, INSTALMENTS).ok);
    assert.not(canAccrueRecurring({ ...RD, kind: 'fixed deposit' }, INSTALMENTS).ok);
    assert.not(canAccrueRecurring(null, INSTALMENTS).ok);
  });

  test('and the lump-sum route still refuses it, for the right reason', () => {
    // `canAccrue` must never accept an RD. Its formula would treat every
    // instalment as though it went in on day one.
    const check = canAccrue(RD);

    assert.not(check.ok);
    assert.includes(check.why, 'each one has to be accrued from its own date');
    assert.equal(accruedValue(RD, TWO_YEARS_ON), null);
  });
});

describe('the report, with instalments', () => {
  test('names a recurring deposit that has drifted', () => {
    const report = accrualReport([RD], '2026-08-01', { transactions: INSTALMENTS });

    assert.length(report.drifted, 1);
    assert.length(report.unchecked, 0);
    assert.close(Math.round(report.understated / 100), 8_724, 100);
  });

  test('and lists it as unchecked when no transactions are passed at all', () => {
    // A caller that does not load investment transactions gets the reason
    // rather than a silently missing deposit.
    const report = accrualReport([RD], '2026-08-01');

    assert.length(report.drifted, 0);
    assert.length(report.unchecked, 1);
    assert.includes(report.unchecked[0].why, 'no instalments are recorded');
  });

  test('a fixed deposit and a recurring one are both counted, once each', () => {
    const report = accrualReport([FD, RD], '2026-08-01', { transactions: INSTALMENTS });

    assert.length(report.drifted, 2);
    assert.close(Math.round(report.understated / 100), 75_571 + 8_724, 200);
  });
});

describe('the sentence, for a recurring deposit', () => {
  test('names instalments rather than a date the value was true', () => {
    // There is no single date an RD's value was true, so "valued at X on Y"
    // would be a sentence about a figure nobody ever typed.
    const entry = accrualReport([RD], '2026-08-01', { transactions: INSTALMENTS }).drifted[0];
    const said = describeAccrual(entry);

    assert.equal(entry.since, INSTALMENTS[0].date);
    assert.includes(said, '24 instalments');
    assert.includes(said, INSTALMENTS[0].date);
    assert.not(said.includes(RD.valuedOn), said);
    assert.includes(said, 'each earning from the day it went in');
    assert.not(said.includes('and not since'), said);
    assert.includes(said, "bank's figure is the one that counts");
  });
});
