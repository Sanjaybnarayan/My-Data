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
  SCHEDULE, WHY, instalmentSchedule, missedInstalments, missedInstalmentSummary,
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

/*
 * The schedule, and the gap in it.
 *
 * Phase 7's stated remainder: a missed instalment could not be detected
 * because a holding recorded no schedule to be missing from. These cover the
 * three things that could make the new answer worthless — a refusal that
 * reads as "nothing missed", a day-exact comparison that reports a gap for
 * every payment that settled late, and one payment answering two periods.
 */
describe('a recurring deposit schedule', () => {
  const clock = () => Date.parse('2026-06-15T10:00:00Z');
  const rd = (over = {}) => ({
    id: 'hold_rd', kind: 'recurring deposit', name: 'RD',
    instalmentAmount: 500000, instalmentEvery: 'month', instalmentFrom: '2026-03-01',
    ...over,
  });
  const paid = (dates) => dates.map((date, i) => ({
    id: 'iv' + i, holding: 'hold_rd', kind: 'contribution', date, amount: 500000,
  }));

  test('with no schedule recorded it refuses rather than reporting nothing missed', () => {
    const answer = missedInstalments(rd({ instalmentFrom: null }), [], { clock });
    assert.equal(answer.status, SCHEDULE.UNRECORDED);
    assert.length(answer.missed, 0);
    assert.equal(answer.why, WHY.NO_START);
  });

  test('and an amount is as necessary as a date', () => {
    const answer = missedInstalments(rd({ instalmentAmount: null }), [], { clock });
    assert.equal(answer.status, SCHEDULE.UNRECORDED);
    assert.equal(answer.why, WHY.NO_AMOUNT);
  });

  /*
   * The distinction the whole entity change exists for. Both answers carry an
   * empty `missed`; only the status tells them apart, and a caller that reads
   * the list alone would report a household with no schedule as up to date.
   */
  test('unrecorded and on-track are not the same empty list', () => {
    const none = missedInstalments(rd({ instalmentFrom: null }), [], { clock });
    const good = missedInstalments(rd(), paid(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01']), { clock });
    assert.deep([none.missed, good.missed], [[], []]);
    assert.not(none.status === good.status, 'the two empties must not report the same status');
    assert.equal(good.status, SCHEDULE.ON_TRACK);
  });

  test('a month with no instalment is named', () => {
    const answer = missedInstalments(rd(), paid(['2026-03-01', '2026-05-01', '2026-06-01']), { clock });
    assert.equal(answer.status, SCHEDULE.MISSED);
    assert.deep(answer.missed, ['2026-04-01']);
  });

  test('a payment that settled late still answers its month', () => {
    // Due the 1st, paid the 4th. A day-exact comparison would call this a gap.
    const answer = missedInstalments(rd(), paid(['2026-03-04', '2026-04-03', '2026-05-06', '2026-06-02']), { clock });
    assert.equal(answer.status, SCHEDULE.ON_TRACK, JSON.stringify(answer.missed));
  });

  test('two payments in one month do not cover the next one', () => {
    const answer = missedInstalments(rd(), paid(['2026-03-01', '2026-03-20', '2026-05-01', '2026-06-01']), { clock });
    assert.deep(answer.missed, ['2026-04-01']);
  });

  test('nothing is due after maturity', () => {
    const answer = missedInstalments(
      rd({ maturesOn: '2026-04-30' }), paid(['2026-03-01', '2026-04-01']), { clock });
    assert.equal(answer.status, SCHEDULE.ON_TRACK);
    assert.equal(answer.due, 2);
  });

  test('an instalment due today is not yet missed', () => {
    const answer = missedInstalments(
      rd({ instalmentFrom: '2026-06-15' }), [], { clock });
    assert.deep(answer.missed, ['2026-06-15']);
    assert.equal(answer.due, 1);
  });

  test('a schedule starting on the 31st does not walk forward a day a month', () => {
    const { due } = instalmentSchedule(rd({ instalmentFrom: '2026-01-31' }), { clock });
    assert.deep(due.slice(0, 4), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });

  test('a quarterly deposit is judged on its quarter, not its first month', () => {
    const q = rd({ instalmentEvery: 'quarter', instalmentFrom: '2026-01-01' });
    // Due Jan and Apr; paid in February and June — both inside their windows.
    const answer = missedInstalments(q, paid(['2026-02-10', '2026-06-05']), { clock });
    assert.equal(answer.status, SCHEDULE.ON_TRACK, JSON.stringify(answer.missed));
  });

  test('the summary counts deposits that cannot be judged apart from those behind', () => {
    const holdings = [rd(), { ...rd({ instalmentFrom: null }), id: 'hold_b' }];
    const s = missedInstalmentSummary(holdings, paid(['2026-03-01']), { clock });
    assert.equal(s.unrecorded, 1);
    assert.equal(s.behind, 1);
    assert.ok(s.missed >= 3, `expected several missed, got ${s.missed}`);
  });
});
