/**
 * What the calendar shows.
 *
 * Its subtitle promised "every renewal date" and it drew three of nine. The
 * grid asked `expiryReminders` for a 400-day horizon, which quietly did
 * nothing: `horizonDays` is only a fallback for fields with no `expiryLead` of
 * their own, so a recurring payment (lead 7) left the grid eight days out and
 * paging one month forward showed almost nothing.
 *
 * Separately, money due is mostly *derived* — a card bill off the statement
 * day, an EMI off the loan's payment day — so neither had ever reached a
 * calendar square, including the largest amount most households pay.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { datesInRange, expiryReminders } from '../js/domain/reminders.js';

setSuite('calendar');

const DATA = {
  recurringPayment: [
    { id: 'r1', name: 'Rent', kind: 'rent', amount: 35_000_00, frequency: 'monthly', nextDueOn: '2026-08-18', active: true, deletedAt: null },
    { id: 'r2', name: 'Broadband', kind: 'bill', amount: 1_199_00, frequency: 'monthly', nextDueOn: '2026-09-03', active: true, deletedAt: null },
  ],
  policy: [
    { id: 'p1', name: 'Star Health family floater', insurer: 'Star Health', kind: 'health', renewsOn: '2026-10-03', premium: 18_644_00, active: true, deletedAt: null },
  ],
  subscription: [
    { id: 's1', name: 'Netflix', amount: 649_00, frequency: 'monthly', renewsOn: '2026-08-17', active: true, autoRenew: true, deletedAt: null },
  ],
};

describe('a window is a window, not a reminder lead', () => {
  test('a whole month comes back, whatever each field’s lead is', () => {
    // September holds one thing: a recurring payment whose reminder lead is
    // seven days. Twenty days out, `expiryReminders` drops it — which is right
    // for a reminder and wrong for a calendar.
    const found = datesInRange(DATA, { from: '2026-09-01', to: '2026-09-30' });

    assert.length(found, 1);
    assert.equal(found[0].title, 'Broadband');
    assert.equal(found[0].date, '2026-09-03');
  });

  test('and the reminder engine still refuses it, which is correct there', () => {
    // Both behaviours are right for their own question. This pins the
    // difference so neither drifts into the other.
    const nagged = expiryReminders(DATA, {
      horizonDays: 400, clock: () => Date.UTC(2026, 7, 14),
    });
    assert.not(nagged.some((r) => r.recordId === 'r2'), JSON.stringify(nagged));
  });

  test('a horizon far out still comes back, where a lead would have cut it', () => {
    // A policy's lead is 45 days. Fifty days out it belongs on October's grid.
    const october = datesInRange(DATA, { from: '2026-10-01', to: '2026-10-31' });
    assert.length(october, 1);
    assert.equal(october[0].title, 'Star Health family floater');
  });

  test('every dated thing in a wide window, not a third of them', () => {
    const all = datesInRange(DATA, { from: '2026-08-01', to: '2026-12-31' });
    assert.length(all, 4);
    // Sorted by date, which is the order a calendar is read in.
    assert.deep(all.map((d) => d.date),
      ['2026-08-17', '2026-08-18', '2026-09-03', '2026-10-03']);
  });

  test('and nothing outside it', () => {
    assert.length(datesInRange(DATA, { from: '2027-01-01', to: '2027-12-31' }), 0);
  });
});

describe('what does not belong on a square', () => {
  test('a deleted record is not on the calendar', () => {
    const data = { policy: [{ ...DATA.policy[0], deletedAt: '2026-01-01T00:00:00.000Z' }] };
    assert.length(datesInRange(data, { from: '2026-01-01', to: '2027-01-01' }), 0);
  });

  test('a cancelled one is not either', () => {
    const data = { subscription: [{ ...DATA.subscription[0], active: false }] };
    assert.length(datesInRange(data, { from: '2026-01-01', to: '2027-01-01' }), 0);
  });

  test('an entity with no expiry field contributes nothing', () => {
    assert.length(datesInRange({ transaction: [{ id: 't1', date: '2026-08-14' }] },
      { from: '2026-01-01', to: '2027-01-01' }), 0);
  });

  test('nothing at all is not an error', () => {
    assert.length(datesInRange({}, { from: '2026-01-01', to: '2027-01-01' }), 0);
    assert.length(datesInRange({ policy: [] }, { from: '2026-01-01', to: '2027-01-01' }), 0);
  });
});

describe('what each entry carries', () => {
  test('the record behind it, so a square opens something', () => {
    const [entry] = datesInRange(DATA, { from: '2026-09-01', to: '2026-09-30' });

    assert.equal(entry.entity, 'recurringPayment');
    assert.equal(entry.recordId, 'r2');
    assert.equal(entry.module, 'finance');
    assert.equal(entry.field, 'nextDueOn');
  });

  test('and one record with two dates is two entries, not one', () => {
    // A vehicle's insurance and its PUC expire on different days and are two
    // different things to do.
    const data = {
      vehicle: [{
        id: 'v1', registrationNumber: 'KA01AB1234', make: 'Maruti',
        insuranceExpiresOn: '2026-09-10', pucExpiresOn: '2026-09-25', deletedAt: null,
      }],
    };

    const found = datesInRange(data, { from: '2026-09-01', to: '2026-09-30' });
    assert.length(found, 2);
    assert.deep(found.map((d) => d.field).sort(), ['insuranceExpiresOn', 'pucExpiresOn']);
    // Ids differ by field, so two entries on one record never collide.
    assert.notEqual(found[0].id, found[1].id);
  });

  test('and the reminder engine keeps them distinct too', () => {
    // Found by a mutation that landed on the wrong function: nothing had ever
    // pinned this for `expiryReminders`, where two dates on one vehicle would
    // have produced two reminders sharing an id.
    const data = {
      vehicle: [{
        id: 'v1', registrationNumber: 'KA01AB1234', make: 'Maruti',
        insuranceExpiresOn: '2026-08-20', pucExpiresOn: '2026-08-25', deletedAt: null,
      }],
    };

    const nagged = expiryReminders(data, { clock: () => Date.UTC(2026, 7, 14) });
    assert.length(nagged, 2);
    assert.notEqual(nagged[0].id, nagged[1].id);
  });
});
