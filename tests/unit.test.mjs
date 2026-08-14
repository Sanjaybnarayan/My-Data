/**
 * The unit of work.
 *
 * The guard checked hardest is that a refused second operation leaves the first
 * one unwritten. That is the whole reason this exists: two `repo.create` calls
 * are two transactions, and a household left with a payment recorded and the
 * event it belongs to missing has a database that disagrees with itself, with
 * nothing anywhere knowing the pair was meant to be a pair.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount, outbox, auditLog } from './fixture.mjs';
import { Unit, transact } from '../js/data/unit.js';
import { bus, TOPIC } from '../js/core/bus.js';

setSuite('unit');

const anExpense = (account, over = {}) => ({
  date: '2026-08-01', kind: 'expense', amount: 500, account: account.id,
  category: 'other', payee: 'Shop', tags: [], ...over,
});

/**
 * Make the transaction handle throw once it has applied `puts` writes.
 *
 * Stands in for a full disk or a browser killing the tab mid-write: the only
 * failures that can actually happen *inside* a commit, and the ones a
 * staging-time refusal cannot stand in for.
 */
function failAfterPuts(db, puts) {
  const real = db.adapter.tx.bind(db.adapter);
  let seen = 0;
  db.adapter.tx = (stores, mode, fn) => real(stores, mode, (t) => fn({
    get: (...args) => t.get(...args),
    delete: (...args) => t.delete(...args),
    put: async (...args) => {
      seen += 1;
      if (seen > puts) throw new Error('the disk filled up');
      return t.put(...args);
    },
  }));
}

describe('all or nothing', () => {
  test('a refused second write leaves the first unwritten', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);

    let threw = false;
    try {
      await transact(db, async (unit) => {
        await unit.create('transaction', anExpense(account));
        // No account, which the schema requires. The refusal happens while
        // staging — before the transaction opens — which is the point.
        await unit.create('transaction', anExpense(account, { account: '' }));
      });
    } catch { threw = true; }

    assert.ok(threw);
    assert.length(await db.repo('transaction').list({}), 0,
      'the first write must not survive the second being refused');
  });

  test('and leaves no audit row or outbox entry behind either', async () => {
    // A record that was never written but was announced to the sync engine
    // would be pushed to the household's spreadsheet and exist there and
    // nowhere else.
    const db = await makeDb();
    const account = await makeAccount(db);
    const audits = (await auditLog(db)).length;
    const queued = (await outbox(db)).length;

    try {
      await transact(db, async (unit) => {
        await unit.create('transaction', anExpense(account));
        await unit.create('transaction', anExpense(account, { account: '' }));
      });
    } catch { /* expected */ }

    assert.length(await auditLog(db), audits);
    assert.length(await outbox(db), queued);
  });

  test('a failure *during* the commit leaves nothing behind', async () => {
    // The test the two above do not do, and the reason this one exists.
    //
    // Staging is where validation and permissions are checked, so a bad
    // operation throws before `commit` is ever called — which means those
    // tests pass whether or not the commit shares one transaction. They cover
    // the early refusal; this covers the thing the class is actually for.
    //
    // Failing here means failing after the first record's `put` has already
    // been issued, which is precisely the window two separate `repo.create`
    // calls leave open.
    const db = await makeDb();
    const account = await makeAccount(db);
    // Counted before the unit runs: setting the account up queued one of its
    // own, and asserting an empty outbox would have measured that instead.
    const queued = (await outbox(db)).length;
    failAfterPuts(db, 6);

    let threw = false;
    try {
      await transact(db, async (unit) => {
        await unit.create('transaction', anExpense(account, { payee: 'First' }));
        await unit.create('transaction', anExpense(account, { payee: 'Second' }));
      });
    } catch { threw = true; }

    assert.ok(threw);
    assert.length(await db.repo('transaction').list({}), 0,
      'the first record was already put before the failure, and must be gone');
    assert.length(await outbox(db), queued, 'and nothing was queued for sync');
  });

  test('both survive when both are good', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);

    const records = await transact(db, async (unit) => {
      await unit.create('transaction', anExpense(account, { payee: 'One' }));
      await unit.create('transaction', anExpense(account, { payee: 'Two' }));
    });

    assert.length(records, 2);
    assert.length(await db.repo('transaction').list({}), 2);
  });

  test('a permission refusal stops the whole unit, not just its own write', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const note = await db.repo('note').create({ title: 'before', body: '' });
    db.setActor({ personId: 'per_guest', role: 'guest' });

    try {
      await transact(db, async (unit) => {
        await unit.update('note', note.id, { title: 'after' });
        await unit.create('transaction', anExpense(account));
      });
    } catch { /* expected */ }

    db.setActor({ personId: 'per_owner', role: 'owner' });
    assert.equal((await db.repo('note').get(note.id)).title, 'before');
  });
});

describe('staging', () => {
  test('a staged create hands back its id before anything is written', async () => {
    // The reason this exists. An economic event has to point at a transaction
    // that does not exist yet, and both have to land together.
    const db = await makeDb();
    const account = await makeAccount(db);
    const unit = new Unit(db);

    const txn = await unit.create('transaction', anExpense(account));
    assert.ok(txn.id, 'the id is known while staging');
    assert.not(await db.repo('transaction').get(txn.id), 'and nothing is stored yet');

    await unit.create('receipt', {
      date: '2026-08-01', merchant: 'Shop', amount: 500, category: 'e-commerce',
      transaction: txn.id, messageId: 'm1', mailbox: 'primary', subject: 'Order',
    });
    await unit.commit();

    const receipts = await db.repo('receipt').list({});
    assert.equal(receipts[0].transaction, txn.id);
    assert.ok(await db.repo('transaction').get(txn.id));
  });

  test('nothing is visible until commit', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const unit = new Unit(db);

    await unit.create('transaction', anExpense(account));
    await unit.create('transaction', anExpense(account, { payee: 'Second' }));
    assert.equal(unit.size, 2);
    assert.length(await db.repo('transaction').list({}), 0);

    await unit.commit();
    assert.length(await db.repo('transaction').list({}), 2);
  });

  test('deleting something already gone stages nothing and stops nothing', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);

    const records = await transact(db, async (unit) => {
      assert.equal(await unit.remove('note', 'not_a_real_id'), null);
      await unit.create('transaction', anExpense(account));
    });

    assert.length(records, 1, 'the real write still happened');
  });

  test('an empty unit is a no-op rather than an error', async () => {
    const db = await makeDb();
    assert.deep(await transact(db, async () => {}), []);
  });

  test('a spent unit refuses to be used again', async () => {
    // Staging onto a committed unit would look like it worked and write
    // nothing, which is the worst of both.
    const db = await makeDb();
    const account = await makeAccount(db);
    const unit = new Unit(db);
    await unit.create('transaction', anExpense(account));
    await unit.commit();

    let staged = false;
    try { await unit.create('transaction', anExpense(account)); } catch { staged = true; }
    let recommitted = false;
    try { await unit.commit(); } catch { recommitted = true; }

    assert.ok(staged);
    assert.ok(recommitted);
  });
});

describe('what a committed unit leaves behind', () => {
  test('one audit row and one outbox entry per operation', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const audits = (await auditLog(db)).length;
    const queued = (await outbox(db)).length;

    await transact(db, async (unit) => {
      await unit.create('transaction', anExpense(account, { payee: 'One' }));
      await unit.create('transaction', anExpense(account, { payee: 'Two' }));
    });

    assert.length(await auditLog(db), audits + 2);
    assert.length(await outbox(db), queued + 2);
  });

  test('every screen watching those modules is told, once each', async () => {
    // Mutation-testing found this missing: deleting the emit loop from
    // `commit` broke no test, and the consequence is a screen that shows stale
    // records until something else happens to repaint it. Silent, and exactly
    // the kind of thing nobody reports as a bug — they just refresh.
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha' });
    const heard = [];
    const offInvestments = bus.on(`${TOPIC.dataChanged}:investments`, (e) => heard.push(e.entity));
    const offIdentity = bus.on(`${TOPIC.dataChanged}:identity`, (e) => heard.push(e.entity));

    try {
      await transact(db, async (unit) => {
        const holding = await unit.create('holding', {
          name: 'Index fund', kind: 'mutual fund', owner: person.id,
          units: 10, invested: 10_000, currentValue: 11_000, active: true,
        });
        await unit.create('investmentTransaction', {
          holding: holding.id, date: '2026-08-01', kind: 'buy', amount: 10_000, units: 10,
        });
        assert.deep(heard, [], 'and not before the transaction has committed');
      });
    } finally {
      offInvestments();
      offIdentity();
    }

    assert.deep(heard.sort(), ['holding', 'investmentTransaction']);
  });

  test('records across different entities land together', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Asha' });

    await transact(db, async (unit) => {
      const holding = await unit.create('holding', {
        name: 'Index fund', kind: 'mutual fund', owner: person.id,
        units: 10, invested: 10_000, currentValue: 11_000, active: true,
      });
      await unit.create('investmentTransaction', {
        holding: holding.id, date: '2026-08-01', kind: 'buy', amount: 10_000, units: 10,
      });
    });

    assert.length(await db.repo('holding').list({}), 1);
    assert.length(await db.repo('investmentTransaction').list({}), 1);
  });

  test('an update and a create in one unit both take effect', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    const note = await db.repo('note').create({ title: 'before', body: '' });

    await transact(db, async (unit) => {
      await unit.update('note', note.id, { title: 'after' });
      await unit.create('transaction', anExpense(account));
    });

    assert.equal((await db.repo('note').get(note.id)).title, 'after');
    assert.length(await db.repo('transaction').list({}), 1);
  });

  test('a delete in a unit clears the search entry, as a lone delete would', async () => {
    const db = await makeDb();
    const note = await db.repo('note').create({ title: 'findable', body: '' });
    assert.ok(await db.adapter.read('search', `note:${note.id}`));

    await transact(db, async (unit) => { await unit.remove('note', note.id); });

    assert.not(await db.adapter.read('search', `note:${note.id}`));
  });
});
