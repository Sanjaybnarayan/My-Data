/**
 * One list of every place the household's records disagree about money.
 *
 * The audit's Case 3 gap: four findings, three shapes, two screens, and no
 * single record type joining them. What is checked hardest here is the thing
 * that would make the list worse than the four scattered findings it
 * replaces — a list that quietly picks a winner.
 */

import { readFileSync } from 'node:fs';
import { test, describe, assert, setSuite } from './harness.mjs';
import {
  conflicts, countByKind, describeConflict, CONFLICT_KINDS,
} from '../js/domain/conflict.js';
import { MATCH_DAYS } from '../js/domain/evidence.js';
import { strings as english } from '../js/locale/en.js';

setSuite('conflict');

const txn = (over = {}) => ({
  id: 't1', date: '2026-08-20', amount: 550_000, deletedAt: null, ...over,
});
const message = (over = {}) => ({
  id: 's1', transaction: 't1', amount: 500_000, transactionDate: '2026-08-20',
  deletedAt: null, ...over,
});
const receipt = (over = {}) => ({
  id: 'r1', transaction: 't1', amount: 550_000, date: '2026-08-20',
  merchant: 'Metro Cash', deletedAt: null, ...over,
});
const staffOf = (over = {}) => ({
  id: 'stf1', person: 'per1', monthlyPay: 1_200_000, paidEvery: 'month',
  startedOn: '2026-05-01', deletedAt: null, ...over,
});
const paid = (month, amount) => ({
  id: `p${month}`, person: 'per1', date: `${month}-03`, amount, deletedAt: null,
});

describe('the specification case that had no record type', () => {
  test('a message and a statement ₹500 apart produce one conflict', () => {
    const found = conflicts({ transactions: [txn()], messages: [message()] });
    assert.length(found, 1);
    assert.equal(found[0].kind, 'amount');
    assert.equal(found[0].entity, 'transaction');
    assert.equal(found[0].id, 't1');
  });

  test('both figures are in it, and neither is marked as the right one', () => {
    const [conflict] = conflicts({ transactions: [txn()], messages: [message()] });
    const amounts = conflict.figures.map((f) => f.amount);
    assert.includes(String(amounts), '550000');
    assert.includes(String(amounts), '500000');
    // The guard the whole module exists to keep. Any of these keys would mean
    // this list resolved what every one of its inputs deliberately refused to.
    for (const key of ['correct', 'preferred', 'winner', 'resolved', 'use', 'truth']) {
      assert.equal(key in conflict, false, `a conflict must not carry \`${key}\``);
      for (const figure of conflict.figures) {
        assert.equal(key in figure, false, `a figure must not carry \`${key}\``);
      }
    }
  });

  test('sources that agree produce nothing', () => {
    const found = conflicts({
      transactions: [txn()], messages: [message({ amount: 550_000 })],
    });
    assert.length(found, 0);
  });

  test('a payment with only the statement is not a conflict', () => {
    // Most rows have one source. A list calling every one of them a conflict
    // is a list nobody opens.
    assert.length(conflicts({ transactions: [txn()] }), 0);
  });
});

describe('dates, which nothing compared before', () => {
  test('two sources naming days further apart than the match window', () => {
    const found = conflicts({
      transactions: [txn({ id: 't2', amount: 250_000 })],
      messages: [message({
        id: 's2', transaction: 't2', amount: 250_000, transactionDate: '2026-08-24',
      })],
    });
    assert.length(found, 1);
    assert.equal(found[0].kind, 'date');
    assert.includes(found[0].why, '4 apart');
  });

  test('a posting delay inside the window says nothing', () => {
    // `MATCH_DAYS` is the number `evidence.js` uses to decide two records
    // describe the same payment. Reporting inside it would call the ordinary
    // gap between an alert and a posting a conflict.
    const found = conflicts({
      transactions: [txn({ id: 't2', amount: 250_000, date: '2026-08-20' })],
      messages: [message({
        id: 's2', transaction: 't2', amount: 250_000, transactionDate: '2026-08-21',
      })],
    });
    assert.equal(MATCH_DAYS, 1);
    assert.length(found, 0);
  });

  test('the widest gap decides, not the first one measured', () => {
    // Three sources: a receipt a day from the statement, and a message six
    // days from it. Measuring only the first pair reads 1 day, which is
    // inside the window, and the module says nothing about a payment its own
    // sources place a week apart.
    const found = conflicts({
      transactions: [txn({ id: 't3', amount: 250_000, date: '2026-08-20' })],
      receipts: [receipt({ id: 'r3', transaction: 't3', amount: 250_000, date: '2026-08-21' })],
      messages: [message({
        id: 's3', transaction: 't3', amount: 250_000, transactionDate: '2026-08-26',
      })],
    });
    const dates = found.filter((c) => c.kind === 'date');
    assert.length(dates, 1);
    assert.includes(dates[0].why, '6 apart');
  });

  test('a source with no date at all is not a date conflict', () => {
    const found = conflicts({
      transactions: [txn({ id: 't2', amount: 250_000 })],
      messages: [message({
        id: 's2', transaction: 't2', amount: 250_000, transactionDate: undefined,
        receivedAt: undefined,
      })],
    });
    assert.equal(found.filter((c) => c.kind === 'date').length, 0);
  });

  test('the amounts agreeing does not stop the dates being reported', () => {
    // The hole this found: `evidenceFor` compares amounts and nothing else,
    // so a reference-matched pair four days apart reported `agree: true`.
    const found = conflicts({
      transactions: [txn({ id: 't2', amount: 250_000 })],
      messages: [message({
        id: 's2', transaction: 't2', amount: 250_000, transactionDate: '2026-09-02',
      })],
    });
    assert.equal(found.length, 1);
    assert.equal(found[0].kind, 'date');
  });
});

describe('a payment the ledger never saw', () => {
  const orphanInput = {
    receipts: [receipt({ id: 'r9', transaction: undefined, amount: 875_000, date: '2026-08-19' })],
    messages: [message({ id: 's9', transaction: undefined, amount: 875_000, transactionDate: '2026-08-19' })],
  };

  test('is in the same list as the disagreements', () => {
    const found = conflicts(orphanInput);
    assert.length(found, 1);
    assert.equal(found[0].kind, 'missing-row');
  });

  test('and points at the receipt, because there is no transaction', () => {
    const [conflict] = conflicts(orphanInput);
    assert.equal(conflict.entity, 'receipt');
    assert.equal(conflict.id, 'r9');
    assert.includes(conflict.why, 'Nothing has been added to the ledger.');
  });

  test('the sentence says it once, not twice', () => {
    const [conflict] = conflicts(orphanInput);
    const said = conflict.why.split('Nothing has been added').length - 1;
    assert.equal(said, 1);
  });
});

describe('wages, which lived on a different screen', () => {
  const wages = [{
    staff: staffOf(),
    payments: [paid('2026-06', 1_200_000), paid('2026-07', 900_000)],
    today: '2026-08-22',
  }];

  test('a month paid short is a conflict in the same list', () => {
    const found = conflicts({ wages });
    assert.length(found, 1);
    assert.equal(found[0].kind, 'wages');
    assert.equal(found[0].entity, 'staff');
    assert.equal(found[0].id, 'stf1');
  });

  test('agreed and paid are both named, and neither is the answer', () => {
    const [conflict] = conflicts({ wages });
    const sources = conflict.figures.map((f) => f.source).sort();
    assert.equal(sources.join(','), 'agreed,paid');
    assert.includes(conflict.why, 'nothing here decides which is right');
  });

  test('an agreement no monthly figure can judge produces nothing', () => {
    const found = conflicts({
      wages: [{ ...wages[0], staff: staffOf({ paidEvery: 'day' }) }],
    });
    assert.length(found, 0);
  });

  test('a month left unjudged is not turned into a conflict', () => {
    // `staffpay.js` refuses a month touched by unpaid leave, because deducting
    // for it needs a daily rate nobody agreed to. That refusal must survive
    // the trip through this list.
    const found = conflicts({
      wages: [{
        ...wages[0],
        leave: [{ staff: 'stf1', from: '2026-07-04', to: '2026-07-06', paid: false }],
      }],
    });
    assert.equal(found.filter((c) => c.why.includes('2026-07')).length, 0);
  });

  test('a bundle with no staff record is skipped rather than throwing', () => {
    assert.length(conflicts({ wages: [{ staff: null, payments: [] }] }), 0);
  });
});

describe('one table, not two lists', () => {
  test('every kind a finder produces is in CONFLICT_KINDS', () => {
    const input = {
      transactions: [txn(), txn({ id: 't2', amount: 250_000 })],
      messages: [
        message(),
        message({ id: 's2', transaction: 't2', amount: 250_000, transactionDate: '2026-08-25' }),
        message({ id: 's9', transaction: undefined, amount: 875_000, transactionDate: '2026-08-19' }),
      ],
      receipts: [receipt({ id: 'r9', transaction: undefined, amount: 875_000, date: '2026-08-19' })],
      wages: [{
        staff: staffOf(),
        payments: [paid('2026-06', 1_200_000), paid('2026-07', 900_000)],
        today: '2026-08-22',
      }],
    };
    const found = conflicts(input);
    for (const conflict of found) {
      assert.includes(CONFLICT_KINDS, conflict.kind);
    }
    // All four fire on one input, so no kind is unreachable in practice.
    assert.equal(new Set(found.map((c) => c.kind)).size, CONFLICT_KINDS.length);
  });

  test('CONFLICT_KINDS is read off the finders, never written beside them', () => {
    // The fault this repository has found nine times. If the kinds were a
    // separate literal, this source would contain one.
    const source = readFileSync(new URL('../js/domain/conflict.js', import.meta.url), 'utf8');
    assert.includes(source, 'Object.keys(FINDERS)');
    for (const kind of CONFLICT_KINDS) {
      // Anchored to the start of a line. The first version of this matched
      // anywhere, so the four-space `amount:` inside `figureOf` counted as a
      // second declaration and the check failed on correct code — a guard
      // that cries wolf gets loosened, and then it guards nothing.
      const declarations = source.split('\n')
        .filter((line) => new RegExp(`^ {2}'?${kind}'?:`).test(line)).length;
      assert.equal(declarations, 1, `\`${kind}\` is declared ${declarations} times`);
    }
  });

  test('countByKind names every kind, including the ones with none', () => {
    const counts = countByKind(conflicts({ transactions: [txn()], messages: [message()] }));
    assert.equal(Object.keys(counts).sort().join(','), [...CONFLICT_KINDS].sort().join(','));
    assert.equal(counts.amount, 1);
    assert.equal(counts.wages, 0);
  });

  test('countByKind ignores a kind it has never heard of', () => {
    const counts = countByKind([{ kind: 'invented' }]);
    assert.equal(counts.amount, 0);
    // The keys, not just one of them. Checking `counts.amount` alone let a
    // mutant add `invented: 1` to the table and pass — a count of a kind
    // nothing can produce, on a screen that would then render it untitled.
    assert.equal(Object.keys(counts).sort().join(','), [...CONFLICT_KINDS].sort().join(','));
  });

  test('the catalogue has a heading and a reason for every kind', () => {
    // The other half of the same fault. The screen builds its keys from the
    // kind, so a kind added to the domain with no copy written for it would
    // render a card titled `conflict.heading.whatever`. This is the check
    // that says so before anybody opens the screen.
    for (const kind of CONFLICT_KINDS) {
      assert.equal(typeof english[`conflict.heading.${kind}`], 'string',
        `no heading for \`${kind}\``);
      assert.equal(typeof english[`conflict.why.${kind}`], 'string',
        `no explanation for \`${kind}\``);
      assert.equal(english[`conflict.why.${kind}`].length > 60, true);
    }
  });

  test('and no copy for a kind the domain cannot produce', () => {
    // The same list read the other way. Copy left behind by a kind that has
    // been removed is a translator's time spent on a card nothing renders.
    const kinds = new Set(CONFLICT_KINDS);
    for (const key of Object.keys(english)) {
      const match = /^conflict\.(heading|why)\.(.+)$/.exec(key);
      if (match) assert.equal(kinds.has(match[2]), true, `\`${key}\` has no finder`);
    }
  });

  test('and none of the screen copy decides which figure is right either', () => {
    for (const kind of CONFLICT_KINDS) {
      const said = `${english[`conflict.heading.${kind}`]} `
        + `${english[`conflict.why.${kind}`]}`.toLowerCase();
      for (const phrase of ['verified', 'confirmed', 'is the right', 'should be',
        'trust the', 'we recommend']) {
        assert.equal(said.includes(phrase), false, `[${kind}] says "${phrase}"`);
      }
    }
  });
});

describe('what the sentences may not say', () => {
  const everything = conflicts({
    transactions: [txn(), txn({ id: 't2', amount: 250_000 })],
    messages: [
      message(),
      message({ id: 's2', transaction: 't2', amount: 250_000, transactionDate: '2026-08-25' }),
      message({ id: 's9', transaction: undefined, amount: 875_000, transactionDate: '2026-08-19' }),
    ],
    receipts: [receipt({ id: 'r9', transaction: undefined, amount: 875_000, date: '2026-08-19' })],
    wages: [{
      staff: staffOf(),
      payments: [paid('2026-06', 1_200_000), paid('2026-07', 900_000)],
      today: '2026-08-22',
    }],
  });

  test('no conflict claims a figure has been verified', () => {
    for (const conflict of everything) {
      const said = `${conflict.why} ${describeConflict(conflict)}`.toLowerCase();
      for (const word of ['verified', 'confirmed', 'proven', 'certain', 'the correct']) {
        assert.equal(said.includes(word), false,
          `[${conflict.kind}] says "${word}"`);
      }
    }
  });

  test('no conflict tells the household which source to believe', () => {
    for (const conflict of everything) {
      const said = `${conflict.why} ${describeConflict(conflict)}`.toLowerCase();
      // `is right` is deliberately not on this list: every one of these
      // sentences ends `nothing here decides which is right`, and a check
      // that a disclaimer trips is a check that gets deleted.
      for (const phrase of ['should be', 'is the right', 'use the', 'trust the',
        'ignore the', 'we recommend', 'the statement is']) {
        assert.equal(said.includes(phrase), false,
          `[${conflict.kind}] says "${phrase}"`);
      }
    }
  });

  test('and every one of them says outright that nothing was changed', () => {
    // The other half. Forbidding the assertion is not the same as making the
    // refusal, and a conflict that simply stated two figures and stopped
    // would pass every check above it.
    for (const conflict of everything) {
      const refuses = /nothing here decides|neither date is changed|nothing has been added/i;
      assert.equal(refuses.test(conflict.why), true,
        `[${conflict.kind}] never says what it left alone: ${conflict.why}`);
    }
  });

  test('every conflict has a sentence with its figures in it', () => {
    for (const conflict of everything) {
      const said = describeConflict(conflict, (n) => `Rs ${n}`);
      assert.equal(typeof said, 'string');
      assert.equal(said.length > 40, true);
      // Asserted before the loop below, which otherwise proves nothing about
      // a conflict that carries no figures at all: emptying `figures` left
      // every check here passing, because a loop over nothing always agrees.
      assert.equal(conflict.figures.length >= 2, true,
        `[${conflict.kind}] names ${conflict.figures.length} figures`);
      for (const figure of conflict.figures) {
        assert.includes(said, figure.source);
      }
    }
  });

  test('a disagreement needs at least two things disagreeing', () => {
    // A conflict with one figure is not a conflict, and one with none is a
    // sentence about nothing.
    for (const conflict of everything) {
      const named = new Set(conflict.figures.map((f) => f.source));
      assert.equal(named.size >= 2, true,
        `[${conflict.kind}] names one source twice rather than two sources`);
    }
  });

  test('describeConflict survives nothing at all', () => {
    assert.equal(describeConflict(null), null);
    assert.equal(describeConflict({ kind: 'amount', why: 'because', figures: [] }), 'because');
  });

  test('a figure with no amount says so rather than printing nothing', () => {
    const said = describeConflict({
      kind: 'amount', why: 'because',
      figures: [{ source: 'sms', amount: null, date: null }],
    }, (n) => `Rs ${n}`);
    assert.includes(said, 'no figure');
  });
});

describe('deleted records', () => {
  test('a deleted transaction has no conflict', () => {
    assert.length(conflicts({
      transactions: [txn({ deletedAt: '2026-08-21' })], messages: [message()],
    }), 0);
  });

  test('a deleted message stops being a source', () => {
    assert.length(conflicts({
      transactions: [txn()], messages: [message({ deletedAt: '2026-08-21' })],
    }), 0);
  });

  test('nothing at all is not an error', () => {
    assert.length(conflicts(), 0);
    assert.length(conflicts({}), 0);
  });
});
