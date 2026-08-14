/**
 * Paying a credit card is not spending.
 *
 * The bug is live and it doubles the headline number: a household that imports
 * both their card statement and their bank statement sees every rupee that went
 * through the card counted twice — once as the purchase, once as the bill.
 *
 * The guard checked hardest is the one that stops the fix being worse than the
 * bug: a household that imported **only** their bank statement has no record of
 * what the card was used for, so the bill is the only evidence there is. For
 * them it must stay counted.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  isCard, isSettlement, settlementReport, describeSettlement,
} from '../js/domain/settlement.js';

setSuite('settlement');

const bank = { id: 'acc_hdfc', name: 'HDFC Savings', kind: 'savings' };
const card = { id: 'acc_card', name: 'HDFC Card', kind: 'credit card' };

let n = 0;
const row = (over) => ({
  id: `txn_${++n}`, date: '2026-08-02', direction: 'out', amount: 100_000,
  account: bank.id, category: 'groceries', kind: 'expense', deletedAt: null, ...over,
});

/** A purchase made on the card, as the card's own statement records it. */
const purchase = (amount, over = {}) => row({ account: card.id, amount, ...over });

/** The bank paying the card bill. */
const bill = (amount, over = {}) => row({ category: 'credit card', amount, ...over });

describe('telling the two apart', () => {
  test('a credit-card account is one', () => {
    assert.ok(isCard(card));
    assert.not(isCard(bank));
    assert.not(isCard(null));
  });

  test('a bill is a settlement, in either spelling of the category', () => {
    assert.ok(isSettlement(bill(500_000)));
    assert.ok(isSettlement(row({ category: 'credit-card' })));
  });

  test('a purchase on the card is not', () => {
    assert.not(isSettlement(purchase(300_000)));
  });

  test('a payment naming a card account is, whatever its category says', () => {
    assert.ok(isSettlement(row({ category: 'other', toAccount: card.id }),
      new Set([card.id])));
  });
});

describe('the double count', () => {
  test('purchases plus the bill that paid for them is counted twice', () => {
    // ₹3,000 + ₹2,000 of purchases, and a ₹5,000 bill. Reported spending is
    // ₹10,000; ₹5,000 left the household.
    const report = settlementReport(
      [purchase(300_000), purchase(200_000), bill(500_000)],
      [bank, card],
    );

    assert.length(report.doubleCounted, 1);
    assert.equal(report.corrected, 500_000);
    assert.length(report.onlyRecord, 0);
  });

  test('and the sentence gives both figures, never only the corrected one', () => {
    // A screen showing only the corrected figure would quietly disagree with
    // every other total in the application, with no way to find out why.
    const report = settlementReport(
      [purchase(300_000), purchase(200_000), bill(500_000)],
      [bank, card],
    );
    const said = describeSettlement(report, 1_000_000);

    assert.includes(said, '1000000');
    assert.includes(said, '500000');
    assert.includes(said, 'twice');
  });

  test('and the figures go through a formatter rather than string surgery', () => {
    // The first version formatted by replacing number substrings in the
    // finished sentence — which picks the wrong occurrence the moment two of
    // the figures are equal, and here they are: ₹5,000 corrected, ₹5,000 left.
    const report = settlementReport(
      [purchase(300_000), purchase(200_000), bill(500_000)],
      [bank, card],
    );
    const said = describeSettlement(report, 1_000_000, (n) => `[${n}]`);

    assert.includes(said, '[1000000]');
    assert.includes(said, '[500000]');
    assert.not(/[^[]1000000/.test(said), said);
  });
});

describe('the household the fix must not break', () => {
  test('with no card statement imported, the bill is the only record', () => {
    // The reason this cannot be a category change. Making `credit-card`
    // internal would report this household's spending as zero.
    const report = settlementReport([bill(500_000)], [bank, card]);

    assert.length(report.doubleCounted, 0);
    assert.length(report.onlyRecord, 1);
    assert.equal(report.corrected, 0, 'nothing may be taken off');
  });

  test('and it says so, and says what would fix it', () => {
    const said = describeSettlement(settlementReport([bill(500_000)], [bank, card]), 500_000);
    assert.includes(said, 'only record');
    assert.includes(said, 'Import the card statement');
    assert.includes(said, 'HDFC Card');
  });

  test('with no card accounts at all there is nothing to report', () => {
    assert.equal(describeSettlement(settlementReport([row({})], [bank]), 100_000), null);
  });
});

describe('two cards, told apart', () => {
  const other = { id: 'acc_amex', name: 'Amex', kind: 'credit card' };

  test('the one with a statement is corrected and the one without is not', () => {
    const report = settlementReport(
      [
        purchase(300_000),                                  // on the HDFC card
        bill(500_000, { toAccount: card.id }),              // its bill
        bill(700_000, { toAccount: other.id }),             // the Amex bill
      ],
      [bank, card, other],
    );

    assert.length(report.doubleCounted, 1);
    assert.equal(report.doubleCounted[0].amount, 500_000);
    assert.length(report.onlyRecord, 1);
    assert.equal(report.onlyRecord[0].amount, 700_000);
    assert.equal(report.corrected, 500_000, 'only the covered bill comes off');
  });

  test('each card reports whether its own statement is here', () => {
    const report = settlementReport(
      [purchase(300_000), bill(500_000, { toAccount: card.id })],
      [bank, card, other],
    );

    const byName = Object.fromEntries(report.byCard.map((c) => [c.name, c]));
    assert.ok(byName['HDFC Card'].statementImported);
    assert.not(byName.Amex.statementImported);
  });
});

describe('what must not be miscounted as card spending', () => {
  test('a refund onto the card is not a purchase', () => {
    // A credit on a card statement reduces the debt. Counting it as spending
    // would make the card look used when it was repaid.
    const report = settlementReport(
      [purchase(300_000, { direction: 'in' }), bill(500_000, { toAccount: card.id })],
      [bank, card],
    );

    assert.length(report.onlyRecord, 1, 'a refund alone does not make a statement');
    assert.equal(report.corrected, 0);
  });

  test('a payment landing on the card is not a purchase on it either', () => {
    // The credit side of the bill appears on the card's own statement. Reading
    // it as spending would make every card look used exactly as much as it was
    // paid off.
    const report = settlementReport(
      [
        row({ account: card.id, category: 'credit card', direction: 'out' }),
        bill(500_000, { toAccount: card.id }),
      ],
      [bank, card],
    );

    assert.equal(report.corrected, 0, 'the card has no purchases of its own');
  });

  test('a deleted row counts for nothing', () => {
    const report = settlementReport(
      [purchase(300_000, { deletedAt: '2026-08-09T00:00:00.000Z' }), bill(500_000)],
      [bank, card],
    );
    assert.equal(report.corrected, 0);
  });

  test('nothing at all is not an error', () => {
    const report = settlementReport(undefined, undefined);
    assert.equal(report.total, 0);
    assert.equal(describeSettlement(report, 0), null);
  });
});
