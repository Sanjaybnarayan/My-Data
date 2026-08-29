/**
 * Connecting an RD instalment to the bank row that paid it.
 *
 * Phase 7's gap, in its own words: *"an RD's instalments are
 * `investmentTransaction` rows; the bank rows for the same payments are in the
 * ledger, and nothing offers to connect the two."*
 *
 * The tests that matter here are the ones about **not** connecting. An
 * instalment is the same amount every month, which makes two candidate rows a
 * day apart genuinely indistinguishable — and the prompt says never force an
 * uncertain match.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  LINK, recurringDeposits, instalmentsOf, candidatesFor, instalmentLinks, instalmentSummary,
} from '../js/domain/instalments.js';
import { MATCH_DAYS } from '../js/domain/evidence.js';

setSuite('instalments');

const RD = { id: 'hold_rd', kind: 'recurring deposit', name: 'HDFC RD', account: 'acc_1' };
const FD = { id: 'hold_fd', kind: 'fixed deposit', name: 'HDFC FD', account: 'acc_1' };

const instalment = (over = {}) => ({
  id: 'itx_1', holding: 'hold_rd', kind: 'contribution',
  date: '2026-05-10', amount: 5000_00, account: 'acc_1', ...over,
});

const bankRow = (over = {}) => ({
  id: 'txn_1', date: '2026-05-10', amount: 5000_00,
  account: 'acc_1', direction: 'out', narration: 'RD INSTAL 12345', ...over,
});

describe('which holdings this is about', () => {
  test('only recurring deposits', () => {
    // A fixed deposit is one payment, not a schedule. Sweeping it in would
    // report an unmatched "instalment" for every FD a household holds.
    assert.deep(recurringDeposits([RD, FD]).map((h) => h.id), ['hold_rd']);
  });

  test('a deleted one is not one', () => {
    assert.length(recurringDeposits([{ ...RD, deletedAt: '2026-06-01T00:00:00Z' }]), 0);
  });

  test('and both ways a household records an instalment count', () => {
    // `contribution` and `buy` both appear in practice. Accepting only one
    // silently drops half of somebody's instalments — and they would show as
    // an RD with fewer payments than it has.
    const rows = instalmentsOf([
      instalment({ id: 'a', kind: 'contribution' }),
      instalment({ id: 'b', kind: 'buy' }),
      instalment({ id: 'c', kind: 'interest' }),
    ], 'hold_rd');
    assert.deep(rows.map((r) => r.id), ['a', 'b']);
  });
});

describe('finding the bank row', () => {
  test('same amount, same day, same account', () => {
    assert.deep(candidatesFor(instalment(), [bankRow()]).map((t) => t.id), ['txn_1']);
  });

  test('a day either side, because a bank posts late', () => {
    // The window is imported from `evidence.js` rather than restated, so this
    // asserts the shared definition rather than a second one.
    assert.equal(MATCH_DAYS, 1);
    assert.length(candidatesFor(instalment(), [bankRow({ date: '2026-05-11' })]), 1);
    assert.length(candidatesFor(instalment(), [bankRow({ date: '2026-05-12' })]), 0);
  });

  test('money leaving, never money arriving', () => {
    // A credit of the same amount on the same day is the interest or a
    // refund. Pairing the payment with its opposite is worse than not pairing.
    assert.length(candidatesFor(instalment(), [bankRow({ direction: 'in' })]), 0);
  });

  test('and not a debit from a different account', () => {
    assert.length(candidatesFor(instalment(), [bankRow({ account: 'acc_2' })]), 0);
  });

  test('a different amount is a different payment', () => {
    assert.length(candidatesFor(instalment(), [bankRow({ amount: 5001_00 })]), 0);
  });

  test('an amount nothing recorded matches nothing, not everything', () => {
    // The guard earns itself only against a ledger row that *also* has no
    // amount: two nulls compare equal, so without it an instalment with no
    // figure would pair with every amountless row in the ledger. Against a
    // normal row the amount comparison already refuses, and the first version
    // of this test used one — so removing the guard broke nothing and the
    // mutation escaped.
    assert.length(candidatesFor(instalment({ amount: null }), [bankRow()]), 0);
    assert.length(candidatesFor(instalment({ amount: null }), [bankRow({ amount: null })]), 0);
  });
});

describe('never forcing a match', () => {
  test('two rows that could both be it are both reported, and neither chosen', () => {
    // The case this is really about. Instalments are the same amount every
    // month, so two debits a day apart are indistinguishable — and picking one
    // would be inventing a certainty nothing supports.
    const [row] = instalmentLinks({
      holdings: [RD],
      investmentTransactions: [instalment()],
      transactions: [bankRow({ id: 'txn_1' }), bankRow({ id: 'txn_2', date: '2026-05-11' })],
    });

    assert.equal(row.link, LINK.AMBIGUOUS);
    assert.deep(row.candidates.map((t) => t.id), ['txn_1', 'txn_2']);
  });

  test('one row is a match, and nothing is unmatched', () => {
    // Without this, reporting AMBIGUOUS for everything would satisfy the test
    // above and make the feature useless.
    const [row] = instalmentLinks({
      holdings: [RD], investmentTransactions: [instalment()], transactions: [bankRow()],
    });
    assert.equal(row.link, LINK.MATCHED);
  });

  test('and nothing in the ledger is UNMATCHED, not an error', () => {
    const [row] = instalmentLinks({
      holdings: [RD], investmentTransactions: [instalment()], transactions: [],
    });
    assert.equal(row.link, LINK.UNMATCHED);
    assert.length(row.candidates, 0);
  });
});

describe('the counts', () => {
  test('the three states account for every instalment examined', () => {
    // The identity `docs/COUNTING_THE_ONES_YOU_CANNOT_NAME.md` argues for,
    // applied from the start rather than after a report was found not to add
    // up to itself.
    const links = instalmentLinks({
      holdings: [RD],
      investmentTransactions: [
        instalment({ id: 'a' }),
        instalment({ id: 'b', date: '2026-06-10' }),
        instalment({ id: 'c', date: '2026-07-10' }),
      ],
      transactions: [
        bankRow({ id: 't1' }),
        bankRow({ id: 't2', date: '2026-06-10' }),
        bankRow({ id: 't3', date: '2026-06-11' }),
      ],
    });

    const counts = instalmentSummary(links);
    assert.equal(counts.total, 3);
    assert.equal(counts.matched + counts.ambiguous + counts.unmatched, counts.total);
    assert.equal(counts.matched, 1);
    assert.equal(counts.ambiguous, 1);
    assert.equal(counts.unmatched, 1);
  });

  test('a household with no recurring deposits gets zero, not a crash', () => {
    assert.deep(instalmentSummary(instalmentLinks({ holdings: [FD] })),
      { total: 0, matched: 0, ambiguous: 0, unmatched: 0 });
  });
});
