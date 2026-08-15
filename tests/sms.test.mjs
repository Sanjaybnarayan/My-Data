/**
 * SMS intelligence — Phase 6.
 *
 * The phase that was skipped without record, and the four financial tests the
 * prompt asks for that this repository could never run.
 *
 * Fixtures are message layouts retyped, as everywhere else here. Real messages
 * are somebody's bank alerts and do not belong in a repository.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  read, classify, isAuthenticationSecret, dedupe, fingerprint,
  reconcileWithStatement, nativeStatus, AGREEMENT, CONNECTOR_STATUS,
  SOURCE_PRIORITY, CATEGORY,
} from '../js/domain/sms.js';

setSuite('sms');

const msg = (text, over = {}) => ({
  text, sender: 'HDFCBK', receivedAt: '2026-08-15T10:31:00Z', ...over,
});

const DEBIT = 'Rs 50,000.00 debited from a/c XX8963 on 15-08-26 to VPA '
  + 'landlord@okicici UPI Ref 412345678901. Avl Bal Rs 1,40,500.00';
const CREDIT = 'INR 50,000 credited to your a/c XX5391 on 15-08-26. '
  + 'UTR AXISN12345678. Avl Bal INR 3,45,000';

describe('a credential is not a transaction', () => {
  /*
   * Rule 53, and the reason the security check runs before anything reads a
   * field: a bank's OTP message looks exactly like its debit message, often
   * with the same amount in it.
   */
  test('an OTP is recognised even though it names an amount', () => {
    const text = '123456 is your OTP for a transaction of Rs 50,000. Do not share it.';
    assert.ok(isAuthenticationSecret(text));
    assert.equal(read(msg(text)).category, 'OTP');
  });

  test('and the reading keeps nothing at all', () => {
    // Not the amount, not the reference, not the text. The cheapest way never
    // to store a one-time code is never to parse the message holding one.
    const reading = read(msg('123456 is your OTP for Rs 50,000 to a/c XX8963. UTR AXISN999'));

    assert.equal(reading.classification, 'AUTHENTICATION_SECRET');
    assert.equal(reading.text, null);
    assert.equal(reading.amount, null);
    assert.equal(reading.utr, undefined, 'no reference field is even populated');
    assert.ok(reading.secret);
  });

  test('the vocabulary is wide, because the two errors are not comparable', () => {
    // A false positive drops a notification nobody needed. A false negative
    // copies somebody's code into a database and possibly into a model.
    for (const text of [
      'Your verification code is 4821',
      'UPI PIN change requested',
      'Do not share this with anyone',
      'Your one-time password: 9931',
      'CVV for your card ending 1234',
    ]) assert.ok(isAuthenticationSecret(text), text);
  });

  test('an ordinary debit is not mistaken for a credential', () => {
    assert.not(isAuthenticationSecret(DEBIT));
    assert.not(read(msg(DEBIT)).secret);
  });

  test('a secret never survives into a deduped set', () => {
    assert.length(dedupe([read(msg('123456 is your OTP')), read(msg(DEBIT))]), 1);
  });
});

describe('reading a message', () => {
  test('every field the message actually carries', () => {
    const reading = read(msg(DEBIT));

    assert.equal(reading.amount, 50_000_00);
    assert.equal(reading.direction, 'out');
    assert.equal(reading.accountTail, '8963');
    assert.equal(reading.upiReference, '412345678901');
    assert.equal(reading.balance, 1_40_500_00);
    assert.equal(reading.transactionDate, '2026-08-15');
  });

  test('and nothing it does not — no field is invented', () => {
    const reading = read(msg('Your account has been updated.'));

    assert.equal(reading.amount, null);
    assert.equal(reading.direction, null);
    assert.equal(reading.accountTail, null);
    assert.equal(reading.utr, null);
    assert.equal(reading.balance, null);
    assert.equal(reading.transactionDate, null);
  });

  test('a message naming neither direction leaves it undecided', () => {
    // Rather than inferring one from the category, which would be a guess
    // wearing a field name.
    assert.equal(read(msg('Rs 500 transaction on card ending 1234')).direction, null);
  });

  test('an SMS is never authoritative', () => {
    // Rule 51, on every reading rather than in a comment somewhere.
    assert.not(read(msg(DEBIT)).authoritative);
    assert.ok(SOURCE_PRIORITY.sms > SOURCE_PRIORITY['bank-statement']);
    assert.ok(SOURCE_PRIORITY.sms < SOURCE_PRIORITY['ai-inference']);
  });

  test('the categories are the prompt\'s, and classification picks among them', () => {
    assert.equal(CATEGORY.length, 25);
    assert.equal(classify('Your EMI of Rs 18,500 is due'), 'EMI');
    assert.equal(classify('Rs 200 refunded to your account'), 'REFUND');
    assert.equal(classify('Transaction declined for card ending 1234'), 'FAILED_TRANSACTION');
    assert.equal(classify('Something entirely unrelated'), 'OTHER');
  });

  test('a failure is not a payment', () => {
    // Ordered rules: "declined" wins over "debited" in a message containing
    // both, which is what a failed-transaction alert looks like.
    assert.equal(classify('Rs 5,000 debited attempt declined for a/c XX8963'),
      'FAILED_TRANSACTION');
  });
});

describe("the prompt's SMS tests, which could not run before", () => {
  test('the same SMS twice is one event', () => {
    const twice = [read(msg(DEBIT)), read(msg(DEBIT, { receivedAt: '2026-08-15T10:33:00Z' }))];
    assert.length(dedupe(twice), 1);
  });

  test('and the fingerprint deliberately ignores when it arrived', () => {
    // A resend has a second timestamp. Including it would defeat the whole
    // purpose of the fingerprint.
    assert.equal(
      fingerprint(read(msg(DEBIT))),
      fingerprint(read(msg(DEBIT, { receivedAt: '2026-09-01T00:00:00Z' }))),
    );
  });

  test('two different transactions are not collapsed', () => {
    assert.length(dedupe([read(msg(DEBIT)), read(msg(CREDIT))]), 2);
  });

  test('an SMS and the statement row are linked, not duplicated', () => {
    // Rule 52. One economic event, two pieces of evidence.
    const statement = [{
      id: 't1', date: '2026-08-15', amount: 50_000_00, accountNumber: 'XXXXXX8963',
      reference: 'UPI/412345678901', deletedAt: null,
    }];
    const result = reconcileWithStatement(read(msg(DEBIT)), statement);

    assert.equal(result.agreement, AGREEMENT.LINKED);
    assert.equal(result.transaction.id, 't1');
    assert.equal(result.evidence.join(), 'sms,bank-statement');
  });

  test('SMS ₹5,000 against a statement ₹5,500 is a conflict, with both figures', () => {
    const text = 'Rs 5,000 debited from a/c XX8963 on 15-08-26. UPI Ref 999888777666';
    const statement = [{
      id: 't2', date: '2026-08-15', amount: 5_500_00, accountNumber: 'XXXXXX8963',
      reference: 'UPI/999888777666', deletedAt: null,
    }];
    const result = reconcileWithStatement(read(msg(text)), statement);

    assert.equal(result.agreement, AGREEMENT.CONFLICT);
    assert.equal(result.sms, 5_000_00);
    assert.equal(result.statement, 5_500_00);
    assert.equal(result.difference, 500_00);
    assert.includes(result.why, 'nothing here changes a figure on its own');
  });

  test('the amount is compared after the link, never used to make it', () => {
    // If differing amounts stopped two records matching, a conflict could never
    // be detected at all — the disagreement would look like two events.
    const text = 'Rs 5,000 debited from a/c XX8963 on 15-08-26. UPI Ref 111222333444';
    const statement = [{
      id: 't3', date: '2026-08-15', amount: 99_999_00, accountNumber: 'XXXXXX8963',
      reference: 'UPI/111222333444', deletedAt: null,
    }];
    assert.equal(reconcileWithStatement(read(msg(text)), statement).agreement,
      AGREEMENT.CONFLICT);
  });

  test('a reference match beats a same-day account match', () => {
    const statement = [
      { id: 'near', date: '2026-08-15', amount: 999_00, accountNumber: 'XXXXXX8963', deletedAt: null },
      { id: 'exact', date: '2026-08-15', amount: 50_000_00, accountNumber: 'XXXXXX8963',
        reference: 'UPI/412345678901', deletedAt: null },
    ];
    assert.equal(reconcileWithStatement(read(msg(DEBIT)), statement).transaction.id, 'exact');
  });

  test('nothing to match against is not a conflict', () => {
    assert.equal(reconcileWithStatement(read(msg(DEBIT)), []).agreement, AGREEMENT.NONE);
  });

  test('a credential is never reconciled with anything', () => {
    const statement = [{ id: 't', date: '2026-08-15', amount: 50_000_00,
      accountNumber: 'XXXXXX8963', deletedAt: null }];
    assert.equal(reconcileWithStatement(read(msg('123456 is your OTP')), statement).agreement,
      AGREEMENT.NONE);
  });
});

describe('what a browser can honestly claim', () => {
  test('the native capability reports NOT_SUPPORTED rather than pretending', () => {
    // The same refusal `docs/KYC.md` makes about CKYCRR, for the same reason.
    const status = nativeStatus();
    assert.equal(status.status, CONNECTOR_STATUS.NOT_SUPPORTED);
    assert.includes(status.why, 'cannot read an SMS inbox');
    assert.ok(status.alternatives.length > 0, 'and it says what does work instead');
  });

  test('the status vocabulary is the prompt\'s, so a future connector has words', () => {
    // The previous version of this test asserted that `nativeStatus()` is not
    // `CONNECTED`. It returns a literal, so that comparison could never fail —
    // a vacuous test, caught by the type checker rather than by me.
    for (const status of ['NOT_CONNECTED', 'AUTH_REQUIRED', 'CONNECTED', 'SYNCING',
      'SYNCED', 'EXPIRED', 'ERROR', 'NOT_SUPPORTED', 'LEGAL_REVIEW_REQUIRED']) {
      assert.equal(CONNECTOR_STATUS[status], status);
    }
  });
});
