/**
 * Does what a staff member was paid match what was agreed?
 *
 * `monthlyPay` is an agreement and the transactions are what happened, and
 * neither may stand in for the other. Showing them side by side was one
 * tranche; saying **when they disagree** is this one, and it is the point of
 * recording either.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  reconcile, disagreements, whyNotComparable, describeMonth, STATUS,
} from '../js/domain/staffpay.js';

setSuite('staff pay');

const TODAY = '2026-08-16';
const COOK = {
  monthlyPay: 12_000_00, paidEvery: 'month', startedOn: '2026-04-10', endedOn: null,
};
const pay = (date, amount) => ({ date, amount });

describe('what it refuses to compare', () => {
  test('paid per task has no month that can be short', () => {
    // A gardener paid per visit who came twice is not underpaid.
    const why = whyNotComparable({ monthlyPay: 500_00, paidEvery: 'task' });
    assert.includes(why, 'per task');
    assert.equal(reconcile({ monthlyPay: 500_00, paidEvery: 'task' }, [], TODAY).comparable, false);
  });

  test('a weekly agreement is not checked against a monthly figure', () => {
    // 4.33 weeks in a month is a convention, not something this household
    // agreed to. A shortfall computed from it is arithmetic presented as fact.
    const why = whyNotComparable({ monthlyPay: 3_000_00, paidEvery: 'week' });
    assert.includes(why, 'every week');
  });

  test('no agreed figure means nothing to compare against', () => {
    assert.includes(whyNotComparable({ paidEvery: 'month' }), 'no monthly pay');
  });

  test('a monthly agreement is comparable', () => {
    assert.equal(whyNotComparable(COOK), null);
  });
});

describe('the months it will not judge', () => {
  test('the month in progress is not over, so it is not listed', () => {
    const out = reconcile(COOK, [pay('2026-07-05', 12_000_00)], TODAY);
    assert.equal(out.months.some((row) => row.month === '2026-08'), false,
      'a wage not paid yet was reported as missing');
  });

  test('the joining month is listed but not judged', () => {
    // Somebody who started on the 10th is not owed a full month, and nothing
    // on the record says what they are owed instead.
    const out = reconcile(COOK, [pay('2026-04-20', 6_000_00)], TODAY);
    const april = out.months.find((row) => row.month === '2026-04');
    assert.equal(april.status, STATUS.NOT_JUDGED);
    assert.equal(april.difference, 0, 'a part month was scored as a shortfall');
  });

  test('the leaving month is not judged either', () => {
    const out = reconcile({ ...COOK, endedOn: '2026-06-14' }, [pay('2026-06-10', 4_000_00)], TODAY);
    assert.equal(out.months.find((row) => row.month === '2026-06').status, STATUS.NOT_JUDGED);
  });

  test('nothing after they left is owed', () => {
    const out = reconcile({ ...COOK, endedOn: '2026-05-31' }, [], TODAY);
    assert.equal(out.months.some((row) => row.month === '2026-06'), false);
  });
});

describe('what it does say', () => {
  test('a month paid exactly agrees', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 12_000_00)], TODAY);
    assert.equal(out.months.find((row) => row.month === '2026-05').status, STATUS.AGREES);
  });

  test('a month with nothing recorded says so', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 12_000_00)], TODAY);
    assert.equal(out.months.find((row) => row.month === '2026-06').status, STATUS.NOTHING);
  });

  test('two payments in a month are added, not counted as two shortfalls', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 6_000_00), pay('2026-05-20', 6_000_00)], TODAY);
    const may = out.months.find((row) => row.month === '2026-05');
    assert.equal(may.paid, 12_000_00);
    assert.equal(may.status, STATUS.AGREES);
  });

  test('short and over are distinguished', () => {
    const short = reconcile(COOK, [pay('2026-05-05', 9_000_00)], TODAY);
    assert.equal(short.months.find((r) => r.month === '2026-05').status, STATUS.SHORT);

    const over = reconcile(COOK, [pay('2026-05-05', 15_000_00)], TODAY);
    assert.equal(over.months.find((r) => r.month === '2026-05').status, STATUS.OVER);
  });

  test('a payment recorded as negative still counts as paid', () => {
    // A wage leaving the household may be stored either way depending on the
    // screen that wrote it; the size is what is being compared.
    const out = reconcile(COOK, [pay('2026-05-05', -12_000_00)], TODAY);
    assert.equal(out.months.find((row) => row.month === '2026-05').status, STATUS.AGREES);
  });

  test('only the months that disagree are worth a screen', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 12_000_00), pay('2026-06-05', 9_000_00)], TODAY);
    const bad = disagreements(out);

    assert.equal(bad.every((row) => row.status !== STATUS.AGREES), true);
    assert.equal(bad.every((row) => row.status !== STATUS.NOT_JUDGED), true,
      'a part month was reported as a disagreement');
    assert.equal(bad[0].month, '2026-07', 'newest first');
  });

  test('a month reads as a sentence', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 9_000_00)], TODAY);
    assert.includes(describeMonth(out.months.find((r) => r.month === '2026-05')), 'short by');
  });
});

/**
 * A month with unpaid leave in it.
 *
 * Deducting for unpaid leave needs a daily rate, and dividing a monthly figure
 * by a number of working days is arithmetic this household never agreed to —
 * the same objection this file already makes to a weekly agreement. So such a
 * month is not judged, and says why.
 */
describe('unpaid leave', () => {
  const away = (from, to, paid) => ({ from, to, paid });

  test('a month containing unpaid leave is not judged, and says why', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 9_000_00)], TODAY,
      [away('2026-05-12', '2026-05-14', false)]);
    const may = out.months.find((row) => row.month === '2026-05');

    assert.equal(may.status, STATUS.NOT_JUDGED);
    assert.includes(may.why, 'unpaid leave');
    assert.equal(may.difference, 0, 'a month with unpaid leave was scored as short');
  });

  test('paid leave changes nothing, which is what paid means', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 9_000_00)], TODAY,
      [away('2026-05-12', '2026-05-14', true)]);
    assert.equal(out.months.find((row) => row.month === '2026-05').status, STATUS.SHORT);
  });

  test('an absence with no end date is a single day', () => {
    const out = reconcile(COOK, [pay('2026-05-05', 12_000_00)], TODAY,
      [away('2026-05-12', null, false)]);
    assert.equal(out.months.find((row) => row.month === '2026-05').status, STATUS.NOT_JUDGED);
    assert.equal(out.months.find((row) => row.month === '2026-06').status, STATUS.NOTHING,
      'a one-day absence in May reached into June');
  });

  test('leave across a month boundary makes both months unjudgeable', () => {
    // The deduction lands in whichever month the household decided, and the
    // record does not say which.
    const out = reconcile(COOK, [], TODAY, [away('2026-05-28', '2026-06-03', false)]);
    assert.equal(out.months.find((row) => row.month === '2026-05').status, STATUS.NOT_JUDGED);
    assert.equal(out.months.find((row) => row.month === '2026-06').status, STATUS.NOT_JUDGED);
  });

  test('a month it will not judge is never a disagreement', () => {
    const out = reconcile(COOK, [], TODAY, [away('2026-05-12', '2026-05-14', false)]);
    assert.equal(disagreements(out).some((row) => row.month === '2026-05'), false);
  });

  test('the reason reads as a sentence', () => {
    const out = reconcile(COOK, [], TODAY, [away('2026-05-12', null, false)]);
    assert.includes(describeMonth(out.months.find((r) => r.month === '2026-05')), 'unpaid leave');
  });
});
