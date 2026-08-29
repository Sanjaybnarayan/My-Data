/**
 * Provenance — where a figure came from.
 *
 * The distinction under test throughout is between *confidence* (how sure the
 * machine is) and *verification* (whether a person confirmed it). Collapsing
 * those two into one number is the failure this module exists to prevent, so
 * most of these check that they stay apart.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  SOURCES, VERIFICATION, provenanceOf, traceable, isUnderstood, understood,
  explain, coverage,
} from '../js/data/provenance.js';

setSuite('provenance');

describe('reading a source off a record', () => {
  test('a transaction knows which statement it came from', () => {
    const p = provenanceOf('transaction', {
      statement: 'st_1', importKey: 'acc|2026-08-01|450|out', reconciled: true,
    });
    assert.equal(p.source, SOURCES.STATEMENT);
    assert.equal(p.sourceId, 'st_1');
    assert.equal(p.evidence, 'acc|2026-08-01|450|out');
  });

  test('a transaction with no statement was typed by somebody', () => {
    // Hand-entered is a real provenance, not a missing one. Conflating the two
    // would report a household's own careful typing as untraceable data.
    const p = provenanceOf('transaction', { payee: 'Corner shop' });
    assert.equal(p.source, SOURCES.MANUAL);
    assert.ok(traceable('transaction', { payee: 'Corner shop' }));
  });

  test('a receipt knows which message and which mailbox', () => {
    const p = provenanceOf('receipt', { messageId: 'm1', mailbox: 'work' });
    assert.equal(p.source, SOURCES.EMAIL);
    assert.equal(p.sourceId, 'm1');
    // The mailbox matters: a Gmail message id is unique within a mailbox and
    // not across several.
    assert.equal(p.container, 'work');
  });

  test('an entity nobody taught it about says so', () => {
    // Guessing MANUAL would assert that a person typed something nobody typed,
    // and would hide the gap instead of counting it.
    const p = provenanceOf('vehicle', { name: 'car' });
    assert.equal(p.source, SOURCES.UNKNOWN);
    assert.not(traceable('vehicle', { name: 'car' }));
    assert.not(isUnderstood('vehicle'));
  });

  test('the entities it does understand are listed', () => {
    assert.deep(understood(),
      ['bankStatement', 'document', 'economicEvent', 'receipt', 'transaction']);
  });
});

describe('confidence is not verification', () => {
  test('a reconciled statement is high confidence and still unverified', () => {
    // The whole point. Arithmetic agreeing with arithmetic is strong evidence
    // and is not a person having looked.
    // Both balances, because a bank statement has both and the reading now
    // asks the record whether there was anything to check against.
    const p = provenanceOf('bankStatement',
      { fileName: 'april.pdf', reconciled: true, openingBalance: 10000, closingBalance: 25000 });
    assert.equal(p.confidence, 'high');
    assert.equal(p.verification, VERIFICATION.UNVERIFIED);
  });

  test('nothing claims verification, because nothing records one yet', () => {
    for (const [name, record] of [
      ['transaction', { statement: 's', reconciled: true }],
      ['transaction', { payee: 'typed' }],
      ['receipt', { messageId: 'm' }],
      ['document', { driveFileId: 'd' }],
      ['bankStatement', { reconciled: true, openingBalance: 1, closingBalance: 2 }],
    ]) {
      assert.equal(provenanceOf(name, record).verification, VERIFICATION.UNVERIFIED,
        `${name} claimed a verification nobody performed`);
    }
  });

  test('a card statement is not told its arithmetic closed', () => {
    /*
     * `reconcile` returns `balanced: true` for a file with no balances to
     * compare against — the sum of the rows equals the sum of the same rows,
     * however wrong they are. `tests/tabular.test.mjs` has always asserted
     * exactly that. Stored as `reconciled` and read here, it produced:
     *
     *     "the arithmetic closed against the printed closing balance"
     *
     * on a record whose own `closingBalance` is null.
     */
    const card = {
      fileName: 'card-may.csv', reconciled: true,
      openingBalance: null, closingBalance: null,
    };
    const p = provenanceOf('bankStatement', card);
    assert.equal(p.confidence, 'medium', 'a vacuous reconcile read as high confidence');
    assert.includes(p.note, 'could not be checked');
    assert.not(/closed against/.test(p.note), p.note);
    assert.not(/did not close/.test(p.note), 'nothing failed — there was nothing to do');
  });

  test('and neither is one whose balances were never recorded', () => {
    // The same derivation, reached the other way: an older import that stored
    // no balances cannot have checked anything either, and is now described
    // correctly without a migration touching it.
    const p = provenanceOf('bankStatement', { fileName: 'old.pdf', reconciled: true });
    assert.equal(p.confidence, 'medium');
  });

  test('a statement that did not close is low confidence', () => {
    const p = provenanceOf('bankStatement',
      { fileName: 'x.pdf', reconciled: false, openingBalance: 10000, closingBalance: 25000 });
    assert.equal(p.confidence, 'low');
    assert.includes(p.note, 'did not close');
  });
});

describe('explaining it to a person', () => {
  test('an unreconciled row is told the real reason', () => {
    // It used to be told "read from wording rather than a labelled column",
    // which is why a *receipt* is uncertain and had nothing to do with this
    // row. The reason now comes from whichever reader produced it, because a
    // wrong explanation attached to a real figure is worse than none.
    const said = explain('transaction', { statement: 's', reconciled: false });
    assert.includes(said, 'was not reconciled');
    assert.not(/wording/.test(said), said);
  });

  test('a receipt is told its own reason', () => {
    assert.includes(explain('receipt', { messageId: 'm' }), 'wording of an email');
  });

  test('anything a machine read says nobody checked it', () => {
    // The sentence people assume the opposite of.
    for (const [name, record] of [
      ['transaction', { statement: 's', reconciled: true }],
      ['receipt', { messageId: 'm' }],
      ['bankStatement', { reconciled: true }],
    ]) {
      assert.includes(explain(name, record), 'not checked by anyone');
    }
  });

  test('but something typed by hand is not', () => {
    // A person typing a figure has checked it by construction; telling them
    // nobody did would be both wrong and insulting.
    const said = explain('transaction', { payee: 'Corner shop' });
    assert.includes(said, 'Entered by hand');
    assert.not(/not checked by anyone/.test(said), said);
  });

  test('a gap in this file is not reported as a gap in the record', () => {
    // These read identically until the economic-event tranche measured it: a
    // record that genuinely says nothing about its source and an entity this
    // file was never taught both produced "Source not recorded", telling a
    // household their data is incomplete when nothing had ever looked. The
    // distinction `isUnderstood` exists for was not being asked.
    const said = explain('vehicle', {});
    assert.includes(said, 'gap in this application');
    assert.not(said.includes('Source not recorded'), said);
  });

  test('a movement says it was calculated, and still nobody checked it', () => {
    const said = explain('economicEvent', { why: 'a debit and a credit one day apart' });
    assert.includes(said, 'Calculated from other records');
    assert.includes(said, 'not checked by anyone');
  });

  test('a movement with no reasoning recorded says that too', () => {
    assert.includes(explain('economicEvent', {}),
      'nothing was recorded about why these rows were treated as one movement');
  });
});

describe('counting what cannot be traced', () => {
  test('hand-entered is counted apart from parsed', () => {
    // Lumping them together would overstate how much of a ledger came off a
    // bank's own paper.
    const rows = [
      { statement: 's1', reconciled: true },
      { statement: 's2', reconciled: true },
      { payee: 'typed' },
    ];
    const c = coverage('transaction', rows);
    assert.equal(c.total, 3);
    assert.equal(c.traceable, 3);
    assert.equal(c.manual, 1);
    assert.equal(c.bySource.statement, 2);
    assert.equal(c.untraceable, 0);
  });

  test('an entity with no reader is all untraceable, and says why', () => {
    const c = coverage('vehicle', [{ name: 'a' }, { name: 'b' }]);
    assert.equal(c.untraceable, 2);
    assert.not(c.understood,
      'a missing reader is a different problem from a missing source');
  });

  test('nothing is counted as verified', () => {
    const c = coverage('transaction', [{ statement: 's', reconciled: true }]);
    assert.equal(c.unverified, c.total);
  });

  test('an empty set is zero, not a crash', () => {
    const c = coverage('transaction', []);
    assert.equal(c.total, 0);
    assert.equal(c.untraceable, 0);
  });
});
