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
  proposeTransfers, movementTotal, linkFor, isLooseLeg, CONFIDENCE, proposeMultiLeg, multiLegTotal,
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

/**
 * A movement with more than two legs.
 *
 * The prompt's `EconomicEvent` was deferred four times as "still wanted for
 * movements with more than two legs", and nobody had printed what those
 * movements did. Measured: ₹50,000 leaves HDFC, ₹30,000 and ₹20,000 arrive,
 * and the application reports **0 proposals, 3 unmatched, ₹0 moved**. Not
 * mis-stated — which is something — but not seen either.
 */
const looseLeg = (id, account, date, amount) => ({
  id, account, date, amount, kind: 'transfer', deletedAt: null, narration: id,
  direction: id.startsWith('out') ? 'out' : 'in', toAccount: null,
});

const SPLIT = [
  looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
  looseLeg('in-30k', 'icici', '2026-08-10', 30_000_00),
  looseLeg('in-20k', 'sbi', '2026-08-10', 20_000_00),
];

describe('a movement that lands in more than one piece', () => {
  test('one debit arriving as two credits is one movement', () => {
    const { proposals } = proposeMultiLeg(SPLIT);
    assert.length(proposals, 1);
    assert.equal(proposals[0].confidence, 'probable');
    assert.equal(proposals[0].shape, 'split');
    assert.equal(proposals[0].amount, 50_000_00);
    assert.deep(proposals[0].legs.map((l) => l.id).sort(), ['in-20k', 'in-30k']);
  });

  test('and two debits funding one credit is the same thing the other way up', () => {
    const { proposals } = proposeMultiLeg([
      looseLeg('out-30k', 'hdfc', '2026-08-10', 30_000_00),
      looseLeg('out-20k', 'sbi', '2026-08-10', 20_000_00),
      looseLeg('in-50k', 'icici', '2026-08-10', 50_000_00),
    ]);
    assert.length(proposals, 1);
    assert.equal(proposals[0].shape, 'sweep');
    assert.equal(proposals[0].amount, 50_000_00);
  });

  test('the amount is counted once, not once per leg', () => {
    // The whole point of the distinction this file holds: three statement
    // lines, one economic event, ₹50,000 — not ₹100,000.
    assert.deep(multiLegTotal(proposeMultiLeg(SPLIT).proposals),
      { movements: 1, moved: 50_000_00, awaiting: 0 });
  });

  test('a plain two-leg transfer is not offered a second time', () => {
    // It already has a pairwise proposal. Offering a set as well would ask a
    // household to confirm the same movement twice.
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('in-50k', 'icici', '2026-08-10', 50_000_00),
    ]);
    assert.length(proposals, 0);
  });

  test('legs that do not add up to anything are left alone', () => {
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('in-10k', 'icici', '2026-08-10', 10_000_00),
      looseLeg('in-20k', 'sbi', '2026-08-10', 20_000_00),
    ]);
    assert.length(proposals, 0);
  });
});

describe('what a set is not allowed to guess', () => {
  test('two groups closing the same amount is not a match', () => {
    // The same rule as one debit matching two credits equally well.
    const { proposals } = proposeMultiLeg([
      ...SPLIT,
      looseLeg('in-25a', 'axis', '2026-08-10', 25_000_00),
      looseLeg('in-25b', 'kotak', '2026-08-10', 25_000_00),
    ]);
    assert.equal(proposals[0].confidence, 'possible');
    assert.ok(proposals[0].ambiguous, JSON.stringify(proposals[0].why));
    // And an ambiguous set is a question, so it is not in the total.
    assert.equal(multiLegTotal(proposals).moved, 0);
    assert.equal(multiLegTotal(proposals).awaiting, 1);
  });

  test('a leg is spent once, so two movements cannot claim the same row', () => {
    // ₹20,000 closes the first set (30 + 20 = 50). Left available it would
    // also close the second (20 + 15 = 35), and the same money would be
    // reported as moved twice. The first version of this check used amounts
    // where no second set existed at all, so it passed without the rule.
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('out-35k', 'axis', '2026-08-10', 35_000_00),
      looseLeg('in-30k', 'icici', '2026-08-10', 30_000_00),
      looseLeg('in-20k', 'sbi', '2026-08-10', 20_000_00),
      looseLeg('in-15k', 'kotak', '2026-08-10', 15_000_00),
    ]);

    assert.length(proposals, 1);
    const claimed = proposals.flatMap((p) => [p.anchor.id, ...p.legs.map((l) => l.id)]);
    assert.equal(new Set(claimed).size, claimed.length, claimed.join(','));
  });

  test('a leg already accounted for pairwise is not pulled into a set', () => {
    // ₹50,000 out and ₹50,000 in are one movement, and the pairwise pass says
    // so. Searching every loose leg instead of the unmatched ones would find
    // 30 + 20 = 50 as well and contradict it — proposing that the same debit
    // went somewhere else entirely.
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('in-50k', 'icici', '2026-08-10', 50_000_00),
      looseLeg('in-30k', 'sbi', '2026-08-10', 30_000_00),
      looseLeg('in-20k', 'axis', '2026-08-10', 20_000_00),
    ]);
    assert.length(proposals, 0);
  });

  test('a leg outside the window is not part of the movement', () => {
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('in-30k', 'icici', '2026-08-10', 30_000_00),
      looseLeg('in-20k', 'sbi', '2026-08-20', 20_000_00),
    ]);
    assert.length(proposals, 0);
  });

  test('the same account paying itself is a statement quirk, not a movement', () => {
    const { proposals } = proposeMultiLeg([
      looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00),
      looseLeg('in-30k', 'hdfc', '2026-08-10', 30_000_00),
      looseLeg('in-20k', 'hdfc', '2026-08-10', 20_000_00),
    ]);
    assert.length(proposals, 0);
  });

  test('too many candidates is reported, not silently abandoned', () => {
    // Subset-sum is exponential. A search that quietly stopped early would
    // report "no movement" for a movement that is there.
    const many = [looseLeg('out-50k', 'hdfc', '2026-08-10', 50_000_00)];
    for (let i = 0; i < 14; i += 1) {
      many.push(looseLeg(`in-${i}`, `acct${i}`, '2026-08-10', 1000 * (i + 1)));
    }
    const { proposals, undecided } = proposeMultiLeg(many);
    assert.length(proposals, 0);
    assert.length(undecided, 1);
    assert.equal(undecided[0].candidates, 14);
    assert.ok(/could be part of this movement/.test(undecided[0].why), undecided[0].why);
  });

  test('a set longer than maxLegs is not found by splitting it further', () => {
    const four = [
      looseLeg('out-40k', 'hdfc', '2026-08-10', 40_000_00),
      looseLeg('in-a', 'icici', '2026-08-10', 10_000_00),
      looseLeg('in-b', 'sbi', '2026-08-10', 10_000_00),
      looseLeg('in-c', 'axis', '2026-08-10', 10_000_00),
      looseLeg('in-d', 'kotak', '2026-08-10', 10_000_00),
    ];
    assert.length(proposeMultiLeg(four, { maxLegs: 3 }).proposals, 0);
    assert.length(proposeMultiLeg(four, { maxLegs: 4 }).proposals, 1);
  });
});
