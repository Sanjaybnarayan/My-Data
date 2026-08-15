/**
 * Filing a receipt against the payment it records.
 *
 * `readReceipt` comes back with an amount and a date. The importer records the
 * payment that left the account. Both facts sat in the database and **nothing
 * connected them** — a household with a ₹48,500 school-fee receipt and a
 * ₹48,500 debit had two unrelated rows and a filing job to do by hand.
 *
 * The place to put the answer already existed: `transaction.documents`. Nothing
 * ever proposed what belonged in it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { matchReceipt, attachmentFor, describeMatch, MATCH } from '../js/domain/receiptmatch.js';

setSuite('receiptmatch');

const RECEIPT = { amount: 48_500_00, receiptDate: '2026-07-12' };

const paid = (date, amount = 48_500_00, over = {}) => ({
  id: `t-${date}-${amount}`,
  date,
  amount,
  direction: 'out',
  kind: 'expense',
  deletedAt: null,
  documents: [],
  ...over,
});

describe('the payment a receipt is for', () => {
  test('the same amount, days before the receipt, is a probable match', () => {
    const { proposals } = matchReceipt(RECEIPT, [paid('2026-07-10')]);
    assert.length(proposals, 1);
    assert.equal(proposals[0].confidence, MATCH.PROBABLE);
    assert.equal(proposals[0].transaction.date, '2026-07-10');
  });

  test('a different amount is not the same payment', () => {
    // "Close" would attach a receipt to the wrong payment, and a wrongly filed
    // receipt is evidence pointing at the wrong transaction.
    assert.length(matchReceipt(RECEIPT, [paid('2026-07-10', 48_000_00)]).proposals, 0);
  });

  test('money coming in is the wrong side of the books', () => {
    // A receipt acknowledges a payment made.
    assert.length(
      matchReceipt(RECEIPT, [paid('2026-07-10', 48_500_00, { direction: 'in' })]).proposals, 0);
  });

  test('a deleted payment is not proposed', () => {
    assert.length(
      matchReceipt(RECEIPT, [paid('2026-07-10', 48_500_00, { deletedAt: '2026-07-11' })]).proposals,
      0);
  });
});

describe('the window, which is deliberately lopsided', () => {
  test('a payment days before the receipt is inside it', () => {
    // Cheques clear, transfers settle overnight, a clerk stamps the receipt
    // when they get to it.
    assert.length(matchReceipt(RECEIPT, [paid('2026-07-08')]).proposals, 1);
  });

  test('a payment long before it is not', () => {
    assert.length(matchReceipt(RECEIPT, [paid('2026-06-20')]).proposals, 0);
  });

  test('a payment made after the receipt was written is not that receipt’s', () => {
    // The asymmetry is the point: a receipt is dated when the money was
    // received, which is on or after it left.
    assert.length(matchReceipt(RECEIPT, [paid('2026-07-20')]).proposals, 0);
  });
});

describe('what it refuses to decide', () => {
  test('two payments of the same amount is a question, not an answer', () => {
    // Rent is the ordinary case: twelve identical debits a year, and July's
    // receipt must not land on June.
    const { proposals } = matchReceipt(RECEIPT, [paid('2026-07-10'), paid('2026-07-11')]);
    assert.length(proposals, 2);
    assert.ok(proposals.every((p) => p.confidence === MATCH.POSSIBLE));
    assert.ok(proposals.every((p) => p.ambiguous));
  });

  test('and the nearer one is not quietly promoted', () => {
    const { proposals } = matchReceipt(RECEIPT, [paid('2026-07-12'), paid('2026-07-09')]);
    assert.not(proposals.some((p) => p.confidence === MATCH.PROBABLE),
      JSON.stringify(proposals.map((p) => p.confidence)));
  });

  test('a receipt with no amount is not matched on its date alone', () => {
    // Every household has several payments in any five-day window, and the one
    // that matched would be a coincidence presented as evidence.
    const out = matchReceipt({ receiptDate: '2026-07-12' }, [paid('2026-07-10')]);
    assert.length(out.proposals, 0);
    assert.ok(/what was paid and when/.test(out.why), out.why);
  });

  test('a receipt with no date is not matched on its amount alone', () => {
    const out = matchReceipt({ amount: 48_500_00 }, [paid('2026-07-10')]);
    assert.length(out.proposals, 0);
  });

  test('nothing found says the statement may not be imported yet', () => {
    // A more useful thing to be told than silence.
    const out = matchReceipt(RECEIPT, []);
    assert.length(out.proposals, 0);
    assert.ok(/may not have been imported/.test(out.why), out.why);
  });

  test('a payment already carrying this document is not offered again', () => {
    // It would be offering to redo a decision somebody made.
    const already = paid('2026-07-10', 48_500_00, { documents: ['doc_1'] });
    assert.length(matchReceipt(RECEIPT, [already], { documentId: 'doc_1' }).proposals, 0);
    // But a *different* receipt for the same payment is still a fair question.
    assert.length(matchReceipt(RECEIPT, [already], { documentId: 'doc_2' }).proposals, 1);
  });
});

describe('attaching it', () => {
  const probable = () => matchReceipt(RECEIPT, [paid('2026-07-10')]).proposals[0];

  test('adds the document to the payment', () => {
    const link = attachmentFor(probable(), 'doc_1');
    assert.equal(link.transactionId, 't-2026-07-10-4850000');
    assert.deep(link.patch.documents, ['doc_1']);
  });

  test('and keeps the documents already there', () => {
    // A transaction may have a receipt and an invoice and a warranty; replacing
    // the list would file one by losing the others.
    const withInvoice = paid('2026-07-10', 48_500_00, { documents: ['doc_invoice'] });
    const [proposal] = matchReceipt(RECEIPT, [withInvoice], { documentId: 'doc_1' }).proposals;
    assert.deep(attachmentFor(proposal, 'doc_1').patch.documents, ['doc_invoice', 'doc_1']);
  });

  test('an uncertain match cannot be attached by pressing a button', () => {
    const [ambiguous] = matchReceipt(RECEIPT, [paid('2026-07-10'), paid('2026-07-11')]).proposals;
    assert.equal(attachmentFor(ambiguous, 'doc_1'), null);
  });

  test('and neither can nothing', () => {
    assert.equal(attachmentFor(probable(), ''), null);
    assert.equal(attachmentFor(null, 'doc_1'), null);
  });
});

describe('what it says', () => {
  const money = (minor) => `₹${(minor / 100).toFixed(2)}`;

  test('a probable match names the day the money left', () => {
    const result = matchReceipt(RECEIPT, [paid('2026-07-10')]);
    const said = describeMatch(RECEIPT, result, money);
    assert.ok(said.includes('₹48,500.00') || said.includes('48500.00'), said);
    assert.ok(said.includes('2026-07-10'), said);
  });

  test('an ambiguous one says how many, rather than choosing', () => {
    const result = matchReceipt(RECEIPT, [paid('2026-07-10'), paid('2026-07-11')]);
    assert.ok(/2 payments/.test(describeMatch(RECEIPT, result, money)), describeMatch(RECEIPT, result, money));
  });

  test('and a receipt that cannot be matched says why', () => {
    assert.ok(/may not have been imported/.test(
      describeMatch(RECEIPT, matchReceipt(RECEIPT, []), money)));
  });
});

/**
 * Through the document store, against a real database.
 *
 * The rules above are checked with plain objects. What only exists once records
 * are stored is the reason this is worked out **on demand** rather than at
 * upload: the statement carrying the payment is very often imported weeks after
 * the receipt, and a match made at upload time would freeze an answer taken
 * before the evidence arrived.
 */
describe('a receipt whose payment arrives later', () => {
  test('is unmatched at first, and matched once the statement lands', async () => {
    const { makeDb } = await import('./fixture.mjs');
    const db = await makeDb();

    // Nothing imported yet.
    const before = matchReceipt(RECEIPT, []);
    assert.length(before.proposals, 0);
    assert.ok(/may not have been imported/.test(before.why), before.why);

    // The statement lands.
    const after = matchReceipt(RECEIPT, [paid('2026-07-10')]);
    assert.length(after.proposals, 1);
    assert.equal(after.proposals[0].confidence, MATCH.PROBABLE);

    // And nothing was written by asking either time — the answer lives on the
    // transaction, and only a person puts it there.
    assert.length(await db.repo('transaction').list({ decrypt: false }), 0);
  });
});
