/**
 * Lineage — the chain a record arrived by.
 *
 * Against a real in-memory database, because the thing under test is a walk
 * over stored references and a stub of that would be a stub of the answer.
 */

import { test, describe as group, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { lineageOf, describe, depth, chainable } from '../js/data/lineage.js';

setSuite('lineage');

/** The chain the prompt's example describes: email → receipt → row → file. */
async function aChain(db) {
  const account = await db.repo('account').create({ name: 'Kotak', kind: 'savings' });
  const statement = await db.repo('bankStatement').create({
    account: account.id, periodFrom: '2026-08-01', periodTo: '2026-08-31',
    fileName: 'august.pdf', reconciled: true, importedCount: 3,
  });
  const transaction = await db.repo('transaction').create({
    date: '2026-08-09', kind: 'expense', amount: 45000, account: account.id,
    category: 'food delivery', payee: 'ZOMATO', statement: statement.id,
    importKey: 'k1', reconciled: true, tags: [],
  });
  const receipt = await db.repo('receipt').create({
    date: '2026-08-09', merchant: 'Zomato', amount: 45000, category: 'food-delivery',
    transaction: transaction.id, messageId: 'msg_1', mailbox: 'primary',
    subject: 'Your order',
  });
  return { account, statement, transaction, receipt };
}

group('walking the chain', () => {
  test('a receipt reaches back to the file the statement came from', async () => {
    const db = await makeDb();
    const { receipt } = await aChain(db);

    const l = await lineageOf(db, 'receipt', receipt.id);
    assert.deep(l.chain.map((s) => s.entity),
      ['receipt', 'transaction', 'bankStatement']);
    assert.equal(depth(l), 3);
    assert.not(l.truncated);
  });

  test('the origin names the file without pretending to open it', async () => {
    // The application does not keep that PDF. Pointing at it is a trail;
    // implying it can be re-read to prove the figure would be a decoration.
    const db = await makeDb();
    const { receipt } = await aChain(db);

    const l = await lineageOf(db, 'receipt', receipt.id);
    assert.includes(l.origin.label, 'august.pdf');
    assert.ok(l.origin.external);
  });

  test('a hand-typed row has a chain of one, and that is not a failure', async () => {
    const db = await makeDb();
    const account = await db.repo('account').create({ name: 'Kotak', kind: 'savings' });
    const typed = await db.repo('transaction').create({
      date: '2026-08-10', kind: 'expense', amount: 200, account: account.id,
      category: 'other', payee: 'Corner shop', tags: [],
    });

    const l = await lineageOf(db, 'transaction', typed.id);
    assert.length(l.chain, 1);
    assert.equal(l.origin.kind, 'manual');
    assert.not(l.origin.external, 'a person is not an external source to point at');
  });

  test('an entity with no origin edge stops at itself', async () => {
    const db = await makeDb();
    const { account } = await aChain(db);
    const l = await lineageOf(db, 'account', account.id);
    assert.length(l.chain, 1);
  });

  test('only declared origin edges are followed', () => {
    // The schema has 47 reference edges and most are not lineage:
    // `transaction.person` says who a payment was about, not where the record
    // came from. Following every ref would answer a different question
    // convincingly, which is worse than answering none.
    assert.deep(chainable(), ['investmentTransaction', 'receipt', 'transaction']);
  });
});

group('when the trail is broken', () => {
  test('a deleted parent is reported rather than silently ending the chain', async () => {
    // "The statement this came from was deleted" is a different and more
    // useful answer than "this is where it started".
    const db = await makeDb();
    const { statement, transaction } = await aChain(db);
    await db.repo('bankStatement').remove(statement.id);

    const l = await lineageOf(db, 'transaction', transaction.id);
    assert.ok(l.origin.broken);
    assert.ok(l.chain.at(-1).missing);
    assert.includes(describe(l), 'has since been deleted');
  });
});

group('describing it', () => {
  test('each relation joins the two records it actually relates', async () => {
    // The first draft printed "matched to a receipt, parsed from a
    // transaction" — every relation attached to the wrong entity, describing
    // a chain that does not exist. A relation belongs to a *pair*.
    const db = await makeDb();
    const { receipt } = await aChain(db);

    const said = describe(await lineageOf(db, 'receipt', receipt.id));
    assert.includes(said, 'A transaction was parsed from it');
    assert.includes(said, 'This receipt was matched to that transaction');
    assert.not(/matched to a receipt/.test(said), said);
  });

  test('it reads origin first, the way the question is asked', async () => {
    const db = await makeDb();
    const { receipt } = await aChain(db);
    assert.ok(describe(await lineageOf(db, 'receipt', receipt.id)).startsWith('Started as'));
  });

  test('a chain of one says the one true thing instead of narrating a hop', async () => {
    const db = await makeDb();
    const { account } = await aChain(db);
    const said = describe(await lineageOf(db, 'account', account.id));
    assert.includes(said, 'This account came from');
    assert.not(/Started as/.test(said), said);
  });

  test('an empty walk says so rather than throwing', async () => {
    const db = await makeDb();
    const l = await lineageOf(db, 'transaction', 'txn_does_not_exist');
    assert.length(l.chain, 0);
    assert.includes(describe(l), 'Nothing is recorded');
  });
});
