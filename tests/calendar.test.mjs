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
import { billsInRange, upcomingBills } from '../js/domain/finance.js';

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

/**
 * Money recurs, because money recurs.
 *
 * `datesInRange` fixed the renewals half of this grid and never touched the
 * money half, which had the same defect for a different reason. `upcomingBills`
 * returns the *next* occurrence of each bill — right for a dashboard, wrong for
 * a calendar — so measured on a household paying ₹80,239 every month, the year
 * drew all of it in September and eleven months read as nothing due.
 */
const RECURRING = [
  { id: 'r1', name: 'Rent', kind: 'rent', amount: 35_000_00, frequency: 'monthly', nextDueOn: '2026-09-01', active: true, deletedAt: null },
];
const LOANS = [
  { id: 'l1', name: 'Home loan', kind: 'home', emiAmount: 43_391_00, emiDay: 5, deletedAt: null },
];

const YEAR = { from: '2026-08-14', to: '2027-08-13' };
const monthsIn = (bills, recordId) =>
  bills.filter((b) => b.recordId === recordId).map((b) => b.dueOn.slice(0, 7));

describe('every occurrence in the window, not merely the next one', () => {
  test('a monthly rent falls in all twelve months', () => {
    const { bills } = billsInRange(RECURRING, [], YEAR);
    assert.length(bills, 12);
    assert.equal(bills[0].dueOn, '2026-09-01');
    assert.equal(bills[11].dueOn, '2027-08-01');
  });

  test('and a monthly EMI does too', () => {
    const { bills } = billsInRange([], LOANS, YEAR);
    assert.length(bills, 12);
    assert.deep(monthsIn(bills, 'l1').slice(0, 3), ['2026-09', '2026-10', '2026-11']);
  });

  test('the dashboard question still gets the dashboard answer', () => {
    // Both are right for their own question, and this pins the difference so
    // neither drifts into the other. A household does not want the next twelve
    // rents on the dashboard.
    const soon = upcomingBills(RECURRING, LOANS, { from: YEAR.from, days: 365 });
    assert.length(soon, 2);
  });

  test('each occurrence is its own entry, so a screen cannot fold them into one', () => {
    const { bills } = billsInRange(RECURRING, LOANS, YEAR);
    assert.equal(new Set(bills.map((b) => b.id)).size, bills.length);
  });

  test('nothing falls outside the window at either end', () => {
    const { bills } = billsInRange(RECURRING, LOANS, { from: '2026-10-02', to: '2026-11-04' });
    // Rent on 1 Nov, EMI on 5 Oct and 5 Nov — but 5 Nov is past the 4th, and
    // 1 Oct is before the 2nd.
    assert.deep(bills.map((b) => b.dueOn), ['2026-10-05', '2026-11-01']);
  });
});

describe('a day of the month that some months do not have', () => {
  test('the 31st clamps in February and comes back in March', () => {
    // The hazard is stepping one result into the next: `addMonths` clamps, so
    // 31 Jan becomes 28 Feb and every later month reads 28 because the 31 has
    // been thrown away. Indexed from the anchor instead.
    const rent = [{ id: 'r9', name: 'Rent', kind: 'rent', amount: 1000, frequency: 'monthly', nextDueOn: '2026-12-31', active: true, deletedAt: null }];
    const { bills } = billsInRange(rent, [], { from: '2026-12-01', to: '2027-05-31' });

    assert.deep(bills.map((b) => b.dueOn),
      ['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']);
  });

  test('an EMI on the 31st does the same', () => {
    const loan = [{ id: 'l9', name: 'Car loan', emiAmount: 5000, emiDay: 31, deletedAt: null }];
    const { bills } = billsInRange([], loan, { from: '2027-01-01', to: '2027-04-30' });

    assert.deep(bills.map((b) => b.dueOn),
      ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });
});

describe('what stops, stops', () => {
  test('a payment past its end date is not still due', () => {
    const ending = [{ ...RECURRING[0], endsOn: '2026-11-30' }];
    const { bills } = billsInRange(ending, [], YEAR);
    assert.deep(bills.map((b) => b.dueOn), ['2026-09-01', '2026-10-01', '2026-11-01']);
  });

  test('and neither is an EMI on a loan that has run its term', () => {
    const ending = [{ ...LOANS[0], endsOn: '2026-10-31' }];
    const { bills } = billsInRange([], ending, YEAR);
    assert.deep(bills.map((b) => b.dueOn), ['2026-09-05', '2026-10-05']);
  });

  test('a cancelled payment is not due at all', () => {
    assert.length(billsInRange([{ ...RECURRING[0], active: false }], [], YEAR).bills, 0);
  });

  test('a weekly payment steps by seven days', () => {
    const weekly = [{ id: 'r7', name: 'Milk', kind: 'bill', amount: 300_00, frequency: 'weekly', nextDueOn: '2026-09-01', active: true, deletedAt: null }];
    const { bills } = billsInRange(weekly, [], { from: '2026-09-01', to: '2026-09-30' });
    assert.deep(bills.map((b) => b.dueOn),
      ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29']);
  });
});

describe('renewals recur only when they renew themselves', () => {
  const netflix = { id: 's1', name: 'Netflix', amount: 649_00, frequency: 'monthly', renewsOn: '2026-09-17', active: true, autoRenew: true, deletedAt: null };

  test('a subscription that renews itself is due every month', () => {
    const { bills } = billsInRange([], [], { ...YEAR, subscriptions: [netflix] });
    // Eleven, not twelve: renewing on the 17th, the last one inside a window
    // ending on 13 August is July's.
    assert.length(bills, 11);
    assert.equal(bills[0].dueOn, '2026-09-17');
    assert.equal(bills[10].dueOn, '2027-07-17');
  });

  test('one that lapses is due once, on the day it lapses', () => {
    // Twelve renewals for something that stops after the first would invent
    // eleven charges nobody is going to be asked for.
    const { bills } = billsInRange([], [], {
      ...YEAR, subscriptions: [{ ...netflix, autoRenew: false }],
    });
    assert.length(bills, 1);
    assert.equal(bills[0].dueOn, '2026-09-17');
  });

  test('a digital asset has no autoRenew, so it lapses too', () => {
    // The same reading of the same absence that `commitments.js` takes. Putting
    // a yearly domain on twelve squares would be worse than leaving it off.
    const { bills } = billsInRange([], [], {
      ...YEAR,
      digitalAssets: [{ id: 'd1', name: 'example.in', annualCost: 899_00, renewsOn: '2026-10-01', active: true, deletedAt: null }],
    });
    assert.length(bills, 1);
  });

  test('a yearly subscription recurs yearly, not monthly', () => {
    const { bills } = billsInRange([], [], {
      ...YEAR,
      subscriptions: [{ ...netflix, frequency: 'yearly', renewsOn: '2026-09-17' }],
    });
    assert.length(bills, 1);
  });
});

describe('the card bill this refuses to guess', () => {
  const card = {
    id: 'a1', name: 'HDFC Regalia', kind: 'credit card', active: true,
    statementDay: 18, dueDay: 5, deletedAt: null,
  };
  const spend = [{
    // Inside the cycle that has closed — 18 June to 18 July, billed on 5
    // August. Dated after the statement instead, the balance is zero and the
    // bill is skipped, which made an earlier draft of these two checks pass
    // for a reason that had nothing to do with recurrence.
    id: 't1', account: 'a1', date: '2026-07-01', amount: 4_000_00,
    kind: 'expense', deletedAt: null,
  }];

  test('the next bill is stated, and the ones after it are not', () => {
    const { bills } = billsInRange([], [], { ...YEAR, accounts: [card], transactions: spend });
    const cards = bills.filter((b) => b.source === 'card');
    // A statement balance is the rows inside a cycle that has closed. Next
    // year's cycles have not happened, so there is no balance to state.
    assert.length(cards, 1);
  });

  test('and the day it stops being knowable is reported, not left silent', () => {
    const { bills, cardBillsStopAt } = billsInRange([], [], {
      ...YEAR, accounts: [card], transactions: spend,
    });
    const last = bills.filter((b) => b.source === 'card').at(-1);
    assert.equal(cardBillsStopAt, '2026-08-06');
    assert.equal(last.dueOn, '2026-08-05');
  });

  test('with no card there is no boundary to report', () => {
    assert.equal(billsInRange(RECURRING, [], YEAR).cardBillsStopAt, null);
  });
});
