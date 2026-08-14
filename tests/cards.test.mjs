/**
 * When a credit card bill is due, and how much of it.
 *
 * `account.statementDay` and `account.dueDay` are on the account form and were
 * read by nothing, so a household with ₹38,000 on a card and both days
 * recorded got no warning at all. A missed card payment is the most expensive
 * thing this application could fail to mention.
 *
 * The arithmetic that matters is *which* balance is due: the statement one,
 * not the current one.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  cardBills, cycleFor, statementBalance, describeCardBill, isBillableCard,
} from '../js/domain/cards.js';
import { upcomingBills, billsTotal } from '../js/domain/finance.js';

setSuite('card bills');

/** Statement on the 18th, payment due on the 5th of the following month. */
const CARD = {
  id: 'card', name: 'HDFC Regalia', kind: 'credit card',
  statementDay: 18, dueDay: 5, creditLimit: 3_00_000_00,
  deletedAt: null, archived: false,
};

const spend = (id, amount, date, over = {}) => ({
  id, date, amount, kind: 'expense', direction: 'out',
  account: 'card', category: 'groceries', deletedAt: null, ...over,
});

describe('which cycle a payment belongs to', () => {
  test('a statement on the 18th is due on the 5th of the next month', () => {
    // The due day is a day *of the month* and does not say which month. The
    // first occurrence strictly after the statement is the answer, rather than
    // an assumption that it is always the month after.
    assert.deep(cycleFor(CARD, '2026-08-14'), { statement: '2026-07-18', due: '2026-08-05' });
  });

  test('and a due day after the statement day stays in the same month', () => {
    const other = { ...CARD, statementDay: 2, dueDay: 20 };
    assert.deep(cycleFor(other, '2026-08-14'), { statement: '2026-08-02', due: '2026-08-20' });
  });

  test('a day-of-month past the end of the month lands on the last day', () => {
    // The 31st of February is the 28th. A card billing on the 31st should not
    // skip the short months.
    const late = { ...CARD, statementDay: 31, dueDay: 31 };
    assert.equal(cycleFor(late, '2026-02-20').statement, '2026-01-31');
    assert.equal(cycleFor(late, '2026-03-05').statement, '2026-02-28');
  });

  test('a statement day later this month belongs to last month’s cycle', () => {
    // On the 14th, a card cutting on the 18th has not cut yet this month.
    assert.equal(cycleFor(CARD, '2026-08-14').statement, '2026-07-18');
    assert.equal(cycleFor(CARD, '2026-08-19').statement, '2026-08-18');
  });

  test('and the year rolls over', () => {
    assert.deep(cycleFor(CARD, '2026-01-10'), { statement: '2025-12-18', due: '2026-01-05' });
  });
});

describe('how much is due', () => {
  test('the statement balance, not what is on the card today', () => {
    // The whole point. Purchases after the statement cut belong to the next
    // cycle, and billing them now would have the household hand the bank an
    // interest-free loan on the difference.
    const txns = [
      spend('t1', 20_000_00, '2026-07-10'),
      spend('t2', 18_000_00, '2026-07-28'),
    ];

    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 20_000_00);
    assert.equal(cardBills([CARD], txns, { from: '2026-08-01' })[0].amount, 20_000_00);
  });

  test('a payment made against the card reduces it', () => {
    const txns = [
      spend('t1', 20_000_00, '2026-07-10'),
      // Money moved from the bank *to* the card.
      { id: 'p1', date: '2026-07-15', amount: 8_000_00, kind: 'transfer', direction: 'out',
        account: 'hdfc', toAccount: 'card', deletedAt: null },
    ];
    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 12_000_00);
  });

  test('a refund onto the card reduces it too', () => {
    const txns = [
      spend('t1', 20_000_00, '2026-07-10'),
      spend('r1', 5_000_00, '2026-07-12', { direction: 'in', kind: 'income' }),
    ];
    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 15_000_00);
  });

  test('a card in credit owes nothing rather than a negative amount', () => {
    const txns = [spend('r1', 5_000_00, '2026-07-12', { direction: 'in', kind: 'income' })];
    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 0);
  });

  test('a deleted transaction is not owed', () => {
    const txns = [
      spend('t1', 20_000_00, '2026-07-10'),
      spend('t2', 9_000_00, '2026-07-11', { deletedAt: '2026-07-20T00:00:00.000Z' }),
    ];
    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 20_000_00);
  });

  test('another account’s spending is not on this card', () => {
    const txns = [
      spend('t1', 20_000_00, '2026-07-10'),
      spend('t2', 9_000_00, '2026-07-11', { account: 'hdfc' }),
    ];
    assert.equal(statementBalance(CARD, txns, '2026-07-18'), 20_000_00);
  });
});

describe('what gets reported', () => {
  const txns = [spend('t1', 20_000_00, '2026-07-10')];

  test('a bill inside the window is reported with its date and amount', () => {
    const [bill] = cardBills([CARD], txns, { from: '2026-08-01', days: 30 });

    assert.equal(bill.dueOn, '2026-08-05');
    assert.equal(bill.amount, 20_000_00);
    assert.equal(bill.days, 4);
    assert.not(bill.overdue);
  });

  test('and one already past is marked overdue rather than hidden', () => {
    // The bill a household most needs to see is the one they have missed.
    const [bill] = cardBills([CARD], txns, { from: '2026-08-10', days: 30 });
    assert.ok(bill.overdue);
    assert.equal(bill.days, -5);
  });

  test('a bill beyond the window is not reported', () => {
    assert.length(cardBills([CARD], txns, { from: '2026-08-01', days: 2 }), 0);
  });

  test('a card cleared every month produces no reminder', () => {
    // Otherwise it fires every month whatever the household does, and a
    // reminder that is always there is one nobody reads.
    const paid = [
      spend('t1', 20_000_00, '2026-07-10'),
      { id: 'p1', date: '2026-07-16', amount: 20_000_00, kind: 'transfer', direction: 'out',
        account: 'hdfc', toAccount: 'card', deletedAt: null },
    ];
    assert.length(cardBills([CARD], paid, { from: '2026-08-01' }), 0);
  });
});

describe('where it refuses, and why', () => {
  test('no due day at all, because guessing a deadline is worse than none', () => {
    // The one bill where being wrong is expensive. A date invented from the
    // statement day would be a deadline this application made up.
    const vague = { ...CARD, dueDay: null };
    assert.length(cardBills([vague], [spend('t1', 20_000_00, '2026-07-10')],
      { from: '2026-08-01' }), 0);
  });

  test('no statement day gives the date without an amount, and says so', () => {
    // Knowing *when* is most of the value. Inventing the figure would be worse
    // than admitting the gap.
    const noCycle = { ...CARD, statementDay: null };
    const [bill] = cardBills([noCycle], [spend('t1', 20_000_00, '2026-07-10')],
      { from: '2026-08-01' });

    assert.equal(bill.dueOn, '2026-08-05');
    assert.equal(bill.amount, null);
    assert.includes(bill.why, 'only when');
    assert.includes(describeCardBill(bill), 'cannot be worked out');
  });

  test('an archived or deleted card bills nothing', () => {
    const txns = [spend('t1', 20_000_00, '2026-07-10')];
    assert.length(cardBills([{ ...CARD, archived: true }], txns, { from: '2026-08-01' }), 0);
    assert.length(cardBills([{ ...CARD, deletedAt: '2026-01-01T00:00:00.000Z' }], txns,
      { from: '2026-08-01' }), 0);
  });

  test('and a savings account is not a card', () => {
    assert.not(isBillableCard({ id: 'hdfc', kind: 'savings', deletedAt: null }));
    assert.length(cardBills([{ ...CARD, kind: 'savings' }],
      [spend('t1', 20_000_00, '2026-07-10')], { from: '2026-08-01' }), 0);
  });

  test('nothing at all is not an error', () => {
    assert.length(cardBills([], []), 0);
    assert.length(cardBills(undefined, undefined), 0);
    assert.equal(describeCardBill(null), null);
  });
});

describe('in the list of what is due', () => {
  const txns = [spend('t1', 20_000_00, '2026-07-10')];
  // Due on the 20th, after the card's 5th, so date order and the order the
  // sources happen to be appended in are not the same list. Built the other
  // way round the sort is never exercised and dropping it passes.
  const recurring = [{
    id: 'rent', name: 'Rent', kind: 'rent', amount: 35_000_00,
    nextDueOn: '2026-08-20', active: true, deletedAt: null, autoDebit: false,
  }];

  test('a card bill joins the recurring payments and the EMIs, in date order', () => {
    const bills = upcomingBills(recurring, [], {
      from: '2026-08-01', days: 30, accounts: [CARD], transactions: txns,
    });

    assert.length(bills, 2);
    assert.equal(bills[0].source, 'card');
    assert.equal(bills[0].amount, 20_000_00);
    assert.equal(bills[0].dueOn, '2026-08-05');
    // The account, so tapping the row opens the record it came from — the
    // derived bill id opens nothing.
    assert.equal(bills[0].account, 'card');
    assert.equal(bills[1].id, 'rent');
  });

  test('a card is never claimed to pay itself', () => {
    // Whether a standing instruction pays this card is set up at the bank and
    // is not recorded here. An "auto" badge on a bill nobody is paying is the
    // one wrong answer that would stop somebody looking at it.
    const [card] = upcomingBills(recurring, [], {
      from: '2026-08-01', accounts: [CARD], transactions: txns,
    });
    assert.equal(card.source, 'card');
    assert.not(card.autoDebit);
  });

  test('and callers that pass no accounts are unaffected', () => {
    // Most callers have only the recurring payments to hand, and adding cards
    // must not have changed what they get back.
    const bills = upcomingBills(recurring, [], { from: '2026-08-01' });
    assert.length(bills, 1);
    assert.equal(bills[0].id, 'rent');
  });
});

describe('the total, when one bill will not say', () => {
  test('an unknown amount is counted as unknown, not as zero', () => {
    // `null` added to a running total is zero, so the figure comes out smaller
    // than the truth with nothing on screen to say a bill was left out.
    const { total, unknown } = billsTotal([
      { amount: 35_000_00 }, { amount: null }, { amount: 20_000_00 },
    ]);

    assert.equal(total, 55_000_00);
    assert.equal(unknown, 1);
  });

  test('an ordinary list reports nothing missing', () => {
    assert.deep(billsTotal([{ amount: 100 }, { amount: 200 }]), { total: 300, unknown: 0 });
    assert.deep(billsTotal([]), { total: 0, unknown: 0 });
  });

  test('a card with no statement day is what puts one there', () => {
    const noCycle = { ...CARD, statementDay: null };
    const bills = upcomingBills([], [], {
      from: '2026-08-01', accounts: [noCycle],
      transactions: [spend('t1', 20_000_00, '2026-07-10')],
    });

    assert.deep(billsTotal(bills), { total: 0, unknown: 1 });
  });
});

describe('the sentence', () => {
  test('names the cycle it came from and whose figure counts', () => {
    // Interest already accrued, a fee on the statement date, a refund that
    // landed after the cut — none are knowable unless the card's own statement
    // was imported.
    const [bill] = cardBills([CARD], [spend('t1', 20_000_00, '2026-07-10')],
      { from: '2026-08-01' });
    const said = describeCardBill(bill);

    assert.includes(said, '2026-07-18');
    assert.includes(said, 'Anything spent since is on the next one');
    assert.includes(said, 'card’s own statement is the figure that counts');
  });

  test('and reads differently once it is late', () => {
    const [bill] = cardBills([CARD], [spend('t1', 20_000_00, '2026-07-10')],
      { from: '2026-08-10' });
    assert.includes(describeCardBill(bill), 'was due 5 days ago');
  });
});
