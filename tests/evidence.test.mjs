/**
 * Three sources, one payment — rule 52 in its fullest form.
 *
 * A receipt knew which row it matched and a message knew which row it matched,
 * and nothing looked across the two.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  evidenceFor, disagreements, orphanEvents, evidenceSummary,
  describeEvidence, describeOrphan, KIND,
} from '../js/domain/evidence.js';

setSuite('evidence');

const txn = (over = {}) => ({
  id: 't1', date: '2026-08-15', amount: 2_499_00, payee: 'Chai House',
  deletedAt: null, ...over,
});
const receipt = (over = {}) => ({
  id: 'r1', date: '2026-08-15', amount: 2_499_00, merchant: 'Chai House',
  transaction: 't1', deletedAt: null, ...over,
});
const message = (over = {}) => ({
  id: 's1', transactionDate: '2026-08-15', amount: 2_499_00,
  transaction: 't1', deletedAt: null, ...over,
});

describe('how many things say this happened', () => {
  test('the row itself is one of the sources', () => {
    // Leaving it out would report a payment with two sources when it has
    // three: the others were matched *to* it.
    const out = evidenceFor(txn(), {});
    assert.length(out.sources, 1);
    assert.equal(out.sources[0].kind, KIND.STATEMENT);
    assert.includes(describeEvidence(out), 'Only the bank statement');
  });

  test('a receipt and a message on the same row make three', () => {
    const out = evidenceFor(txn(), { receipts: [receipt()], messages: [message()] });
    assert.equal(out.corroboration, 3);
    assert.equal(out.agree, true);
    assert.deep(out.sources.map((s) => s.kind),
      [KIND.STATEMENT, KIND.EMAIL, KIND.SMS]);
  });

  test('evidence for another payment is not counted here', () => {
    const out = evidenceFor(txn(), {
      receipts: [receipt({ transaction: 't9' })],
      messages: [message({ transaction: 't9' })],
    });
    assert.equal(out.corroboration, 1);
  });

  test('a deleted receipt is not evidence of anything', () => {
    const out = evidenceFor(txn(), { receipts: [receipt({ deletedAt: '2026-09-01' })] });
    assert.equal(out.corroboration, 1);
  });
});

describe('corroboration is not verification', () => {
  test('three sources agreeing is still nobody having looked', () => {
    const said = describeEvidence(evidenceFor(txn(), {
      receipts: [receipt()], messages: [message()],
    }));
    assert.includes(said, 'None of them is a person having checked it');
    for (const word of ['verified', 'confirmed', 'proven', 'certain']) {
      assert.not(said.toLowerCase().includes(word), word);
    }
  });

  test('one source alone is not called agreement', () => {
    // A figure cannot agree with itself, and calling that agreement would
    // flatter it. `null` is the honest answer.
    assert.equal(evidenceFor(txn(), {}).agree, null);
  });

  test('and neither is a lone source with nothing to compare against', () => {
    const out = evidenceFor(txn(), { messages: [message({ amount: null })] });
    assert.equal(out.corroboration, 2);
    assert.equal(out.agree, null, 'the second source carries no figure to agree with');
  });
});

describe('when they disagree', () => {
  test('every figure is named beside its source and none is preferred', () => {
    const rows = disagreements([txn()], {
      receipts: [receipt({ amount: 2_499_00 })],
      messages: [message({ amount: 2_550_00 })],
    });

    assert.length(rows, 1);
    assert.equal(rows[0].agree, false);
    const said = describeEvidence(rows[0], (n) => `Rs ${n / 100}`);
    assert.includes(said, 'the bank statement says Rs 2499');
    assert.includes(said, 'a bank message says Rs 2550');
    assert.includes(said, 'Nothing here decides which is right');
  });

  test('agreement is not a disagreement', () => {
    assert.length(disagreements([txn()], {
      receipts: [receipt()], messages: [message()],
    }), 0);
  });

  test('the statement outranking the others is not a licence to overwrite them', () => {
    // `SOURCE_PRIORITY` is a reason to believe the statement, not a reason to
    // rewrite the message. Both figures survive the call.
    const rows = disagreements([txn()], { messages: [message({ amount: 2_550_00 })] });
    assert.equal(rows[0].sources[0].amount, 2_499_00);
    assert.equal(rows[0].sources[1].amount, 2_550_00);
  });
});

describe('a payment the ledger never saw', () => {
  const loose = () => ({
    receipts: [receipt({ id: 'r2', transaction: '', amount: 8_750_00,
      date: '2026-08-20', merchant: 'Metro Cash' })],
    messages: [message({ id: 's2', transaction: '', amount: 8_750_00,
      transactionDate: '2026-08-20' })],
  });

  test('a receipt and an alert agreeing, with no row between them', () => {
    const [orphan] = orphanEvents(loose());
    assert.equal(orphan.amount, 8_750_00);
    assert.equal(orphan.merchant, 'Metro Cash');
    assert.includes(describeOrphan(orphan, (n) => `Rs ${n / 100}`),
      'no imported statement row matches it');
  });

  test('nothing is added to the ledger', () => {
    // The refusal that matters. Two notifications are not a transaction, and
    // inventing one fills a ledger with events nobody can trace to a statement.
    assert.includes(describeOrphan(orphanEvents(loose())[0]),
      'Nothing has been added to the ledger');
  });

  test('a receipt already matched to a row is not an orphan', () => {
    assert.length(orphanEvents({ receipts: [receipt()], messages: [message()] }), 0);
  });

  test('and a matched receipt does not pair with a loose message either', () => {
    // A survivor found this. The test above is satisfied by the *message*
    // filter alone, so the receipt filter could be deleted with nothing
    // failing — while in a household it would report a payment already sitting
    // in the ledger as one the ledger had never seen.
    assert.length(orphanEvents({
      receipts: [receipt()],
      messages: [message({ transaction: '' })],
    }), 0);
  });

  test('different amounts are two things, not one', () => {
    const data = loose();
    data.messages[0].amount = 9_000_00;
    assert.length(orphanEvents(data), 0);
  });

  test('a week apart is two things, not one', () => {
    const data = loose();
    data.messages[0].transactionDate = '2026-08-27';
    assert.length(orphanEvents(data), 0);
  });

  test('a day apart is the same thing — a receipt and an alert rarely share a clock',
    () => {
      const data = loose();
      data.messages[0].transactionDate = '2026-08-21';
      assert.length(orphanEvents(data), 1);
    });

  test('one message is claimed by one receipt only', () => {
    // Two receipts for the same amount and one alert is one pair and one
    // unmatched receipt, never two pairs sharing a message.
    const data = loose();
    data.receipts.push(receipt({ id: 'r3', transaction: '', amount: 8_750_00,
      date: '2026-08-20', merchant: 'Metro Cash' }));
    assert.length(orphanEvents(data), 1);
  });
});

describe('the household summary', () => {
  test('payments are counted by how many things say they happened', () => {
    const out = evidenceSummary([txn(), txn({ id: 't2' })], {
      receipts: [receipt()], messages: [message()],
    });

    assert.equal(out.total, 2);
    assert.equal(out.corroborated, 1);
    assert.equal(out.bySources[3], 1);
    // One source is not a fault. Most statement rows have only the statement.
    assert.equal(out.bySources[1], 1);
  });

  test('an empty household is zeroes rather than a crash', () => {
    const out = evidenceSummary([], {});
    assert.equal(out.total, 0);
    assert.length(out.orphans, 0);
  });
});
