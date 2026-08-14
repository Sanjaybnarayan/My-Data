/**
 * Pairing up the two ends of one movement.
 *
 * The prompt's financial tests 1–3 are the specification here, and the third
 * is the one that decides the shape of the whole thing: **₹50,000 out and
 * ₹49,950 in must not match automatically.** Every rule below is written so
 * that an uncertain pairing stays a question.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  proposeTransfers, movementTotal, linkFor, isLooseLeg, CONFIDENCE,
} from '../js/domain/events.js';

setSuite('events');

let n = 0;
const leg = (over) => ({
  id: `txn_${++n}`,
  kind: 'transfer',
  date: '2026-08-01',
  amount: 5_000_000,
  toAccount: '',
  deletedAt: null,
  ...over,
});

const out = (over) => leg({ direction: 'out', account: 'acc_hdfc', ...over });
const inn = (over) => leg({ direction: 'in', account: 'acc_icici', ...over });

describe('what counts as a loose leg', () => {
  test('a transfer with nowhere recorded to is one', () => {
    assert.ok(isLooseLeg(out()));
  });

  test('one that already says where it went is not', () => {
    // Proposing it again would offer to redo a decision somebody made.
    assert.not(isLooseLeg(out({ toAccount: 'acc_icici' })));
  });

  test('an expense is not, however it is categorised', () => {
    assert.not(isLooseLeg(out({ kind: 'expense' })));
  });

  test('a deleted row is not', () => {
    assert.not(isLooseLeg(out({ deletedAt: '2026-08-02T00:00:00.000Z' })));
  });
});

describe('test 1 — a debit and a credit are one movement', () => {
  test('₹50,000 out of HDFC and into ICICI is one proposal, not two rows', () => {
    const { proposals } = proposeTransfers([out(), inn()]);

    assert.length(proposals, 1);
    assert.equal(proposals[0].confidence, CONFIDENCE.PROBABLE);
    assert.equal(proposals[0].amount, 5_000_000);
    assert.includes(proposals[0].why, 'same day');
  });

  test('and the total counts it once, where the per-account figures count it twice', () => {
    // `internalOut` and `internalIn` each carry the full amount — correct per
    // account, and twice per movement. This is the number they cannot give.
    const { proposals } = proposeTransfers([out(), inn()]);
    const total = movementTotal(proposals);

    assert.equal(total.movements, 1);
    assert.equal(total.moved, 5_000_000);
  });

  test('the same account paying itself is a statement quirk, not a movement', () => {
    const { proposals } = proposeTransfers([
      out({ account: 'acc_hdfc' }),
      inn({ account: 'acc_hdfc' }),
    ]);
    assert.length(proposals, 0);
  });
});

describe('test 2 — a day apart is still a movement', () => {
  test('same amount, one day later', () => {
    const { proposals } = proposeTransfers([out(), inn({ date: '2026-08-02' })]);

    assert.length(proposals, 1);
    assert.equal(proposals[0].confidence, CONFIDENCE.PROBABLE);
    assert.equal(proposals[0].days, 1);
    assert.includes(proposals[0].why, '1 day apart');
  });

  test('a fortnight apart is not', () => {
    const { proposals, unmatched } = proposeTransfers([out(), inn({ date: '2026-08-15' })]);
    assert.length(proposals, 0);
    assert.length(unmatched, 2, 'and both are reported as still loose');
  });
});

describe('test 3 — nearly the same amount is not the same amount', () => {
  test('₹50,000 against ₹49,950 is never automatic', () => {
    // The test the whole design turns on. A fee would explain the difference,
    // and so would these being two unrelated payments.
    const { proposals } = proposeTransfers([out(), inn({ amount: 4_995_000 })]);

    assert.length(proposals, 1, 'it is worth mentioning');
    assert.equal(proposals[0].confidence, CONFIDENCE.POSSIBLE);
    assert.equal(proposals[0].difference, 5_000);
    assert.includes(proposals[0].why, 'fee');
  });

  test('and it never reaches the total', () => {
    const { proposals } = proposeTransfers([out(), inn({ amount: 4_995_000 })]);
    const total = movementTotal(proposals);

    assert.equal(total.moved, 0, 'a total built from questions reads as an answer');
    assert.equal(total.awaiting, 1);
  });

  test('and it cannot be applied', () => {
    const { proposals } = proposeTransfers([out(), inn({ amount: 4_995_000 })]);
    assert.equal(linkFor(proposals[0]), null);
  });

  test('a difference too large to be a fee is not mentioned at all', () => {
    // ₹50,000 and ₹49,000 are two amounts. Offering them as a near-match
    // would train somebody to click through the proposals without reading.
    const { proposals } = proposeTransfers([out(), inn({ amount: 4_900_000 })]);
    assert.length(proposals, 0);
  });
});

describe('an ambiguous match is not a match', () => {
  test('two credits that fit one debit equally well leave both uncertain', () => {
    // The rule that stops a ledger being quietly rearranged. A pairing that
    // looks perfect on its own is not probable if a rival fits just as well.
    const { proposals } = proposeTransfers([
      out(),
      inn({ account: 'acc_icici' }),
      inn({ account: 'acc_sbi' }),
    ]);

    assert.length(proposals, 2);
    for (const p of proposals) {
      assert.equal(p.confidence, CONFIDENCE.POSSIBLE, 'neither may be automatic');
      assert.ok(p.ambiguous);
      assert.includes(p.why, 'guess');
    }
  });

  test('and nothing ambiguous reaches the total', () => {
    const { proposals } = proposeTransfers([
      out(), inn({ account: 'acc_icici' }), inn({ account: 'acc_sbi' }),
    ]);
    assert.equal(movementTotal(proposals).moved, 0);
    assert.equal(movementTotal(proposals).awaiting, 2);
  });

  test('two unrelated movements on the same day stay separate and confident', () => {
    // The case ambiguity must not swallow: two genuine pairs, distinguished by
    // amount. Refusing these would make the engine useless in a real month.
    const { proposals } = proposeTransfers([
      out({ amount: 5_000_000, account: 'acc_hdfc' }),
      inn({ amount: 5_000_000, account: 'acc_icici' }),
      out({ amount: 1_200_000, account: 'acc_sbi' }),
      inn({ amount: 1_200_000, account: 'acc_kotak' }),
    ]);

    assert.length(proposals, 2);
    assert.deep(proposals.map((p) => p.confidence),
      [CONFIDENCE.PROBABLE, CONFIDENCE.PROBABLE]);
    assert.equal(movementTotal(proposals).moved, 6_200_000);
  });

  test('an exact rival beats a near one without making either automatic', () => {
    // A debit with one exact partner and one near partner. The exact pairing
    // is unrivalled *among exact pairings*, so it stays probable; the near one
    // is offered separately and stays a question.
    const { proposals } = proposeTransfers([
      out({ amount: 5_000_000 }),
      inn({ amount: 5_000_000, account: 'acc_icici' }),
      inn({ amount: 4_995_000, account: 'acc_sbi' }),
    ]);

    const probable = proposals.filter((p) => p.confidence === CONFIDENCE.PROBABLE);
    assert.length(probable, 1);
    assert.equal(probable[0].in.account, 'acc_icici');
    assert.equal(movementTotal(proposals).moved, 5_000_000);
  });
});

describe('confirming one', () => {
  test('fills in the field that was missing', () => {
    const { proposals } = proposeTransfers([out(), inn()]);
    const link = linkFor(proposals[0]);

    assert.equal(link.transactionId, proposals[0].out.id);
    assert.deep(link.patch, { toAccount: 'acc_icici' });
  });

  test('and keeps both rows, because each is a bank’s own record', () => {
    // Deleting the incoming leg, or zeroing it, would tidy a total by
    // destroying the narration, reference and running balance that a household
    // needs if they later question the figure.
    const { proposals } = proposeTransfers([out(), inn()]);
    const link = linkFor(proposals[0]);

    assert.equal(link.keeps, proposals[0].in.id);
    assert.not('delete' in link);
  });
});

describe('what is left over', () => {
  test('a leg with no partner is reported rather than dropped', () => {
    // "One side of this movement never arrived" is a useful thing to be told —
    // it usually means a statement has not been imported yet.
    const { proposals, unmatched } = proposeTransfers([out()]);
    assert.length(proposals, 0);
    assert.length(unmatched, 1);
  });

  test('nothing at all is not an error', () => {
    assert.deep(proposeTransfers([]).proposals, []);
    assert.deep(proposeTransfers(undefined).proposals, []);
    assert.equal(movementTotal(undefined).moved, 0);
  });

  test('an unreadable date matches nothing rather than everything', () => {
    // `Date.parse` of nonsense is NaN, and every comparison against NaN is
    // false — which is the right answer reached by accident, so it is pinned.
    const { proposals } = proposeTransfers([out({ date: 'whenever' }), inn()]);
    assert.length(proposals, 0);
  });
});
