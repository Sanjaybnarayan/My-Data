import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { RecordsService } from '../js/services/records.js';
import { transact } from '../js/data/unit.js';
import {
  referenceFieldsOf, referencesIn, unresolved, dependents, blocking, danglingIn, settled,
} from '../js/data/integrity.js';

setSuite('integrity');

/* ------------------------------------------------------- the rules alone */

describe('what the schema says points where', () => {
  test('ref and multiref are both references, and nothing else is', () => {
    const fields = referenceFieldsOf('transaction');
    assert.ok(fields.some((f) => f.key === 'account' && f.entity === 'account'));
    assert.not(fields.some((f) => f.key === 'amount'));
  });

  test('a multiref contributes one reference per id', () => {
    const found = referencesIn('conversation', { participants: ['per_1', 'per_2'] });
    assert.length(found, 2);
    assert.ok(found.every((f) => f.entity === 'person' && f.many));
  });

  test('an empty reference is not a reference', () => {
    // The common shape. An optional ref left blank must not be reported as
    // pointing at nothing — it is not pointing at all.
    assert.length(referencesIn('transaction', { account: '', person: null }), 0);
    assert.length(referencesIn('conversation', { participants: [] }), 0);
  });

  test('unresolved asks about each one and reports only the misses', async () => {
    const exists = async (_entity, id) => id === 'per_1';
    const bad = await unresolved('conversation',
      { participants: ['per_1', 'per_missing'] }, exists);

    assert.length(bad, 1);
    assert.equal(bad[0].id, 'per_missing');
  });
});

/* --------------------------------------------------- through the database */

describe('a reference that names nothing', () => {
  test('is refused on create', async () => {
    // Measured before this was built: this call succeeded.
    const db = await makeDb();
    let error;
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 10_000, direction: 'out',
        description: 'test', account: 'acc_does_not_exist',
      });
    } catch (e) { error = e; }

    assert.ok(error, 'a dangling reference was accepted');
    assert.ok(/not here/.test(error.userMessage), error.userMessage);
  });

  test('and on update', async () => {
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'Savings' });
    const txn = await db.repo('transaction').create({
      date: '2026-08-22', amount: 10_000, direction: 'out',
      description: 'test', account: account.id,
    });

    let threw = false;
    try { await db.repo('transaction').update(txn.id, { account: 'acc_gone' }); } catch { threw = true; }
    assert.ok(threw, 'an update pointed a record at nothing');
  });

  test('a reference to a deleted record is a dangling reference', async () => {
    // The commoner way to arrive at one, and the reason `exists` checks
    // `deletedAt` rather than merely whether a row is present.
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'Old' });
    await db.repo('account').remove(account.id);

    let threw = false;
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 1, direction: 'out',
        description: 'test', account: account.id,
      });
    } catch { threw = true; }
    assert.ok(threw, 'a record pointed at something that had been deleted');
  });

  test('a reference that resolves is accepted, so the rule is not "refuse everything"', async () => {
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'Savings' });
    const txn = await db.repo('transaction').create({
      date: '2026-08-22', amount: 10_000, direction: 'out',
      description: 'test', account: account.id,
    });
    assert.equal(txn.account, account.id);
  });
});

describe('deleting something other records need', () => {
  test('is refused when the reference is required', async () => {
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    await db.repo('healthRecord').create({
      person: asha.id, date: '2026-08-01', kind: 'consultation', title: 'Check-up',
    });

    let error;
    try { await db.repo('person').remove(asha.id); } catch (e) { error = e; }
    assert.ok(error, 'a person was deleted while a health record required them');
    assert.ok(/cannot be deleted/.test(error.userMessage), error.userMessage);
  });

  test('and allowed when it is optional, because the schema already says it may be empty', async () => {
    // RESTRICT, not CASCADE, and not "refuse everything". `transaction.person`
    // is optional, so losing the person leaves a record that still validates.
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    const account = await makeAccount(db, { name: 'Savings' });
    await db.repo('transaction').create({
      date: '2026-08-22', amount: 10_000, direction: 'out',
      description: 'test', account: account.id, person: asha.id,
    });

    assert.ok(await db.repo('person').remove(asha.id));
  });

  test('a delete is never a cascade', async () => {
    // Deleting a person must not take their records with them. Cascading
    // through a household's financial history because somebody tidied a
    // contact is data loss with a plausible explanation.
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    const account = await makeAccount(db, { name: 'Savings' });
    const txn = await db.repo('transaction').create({
      date: '2026-08-22', amount: 10_000, direction: 'out',
      description: 'test', account: account.id, person: asha.id,
    });

    await db.repo('person').remove(asha.id);
    const still = await db.repo('transaction').get(txn.id);
    assert.ok(still, 'the transaction was deleted along with the person');
    assert.equal(still.amount, 10_000);
  });

  test('a record already deleted does not block anything', async () => {
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    const record = await db.repo('healthRecord').create({
      person: asha.id, date: '2026-08-01', kind: 'consultation', title: 'Check-up',
    });
    await db.repo('healthRecord').remove(record.id);

    assert.ok(await db.repo('person').remove(asha.id),
      'a deleted health record still blocked deleting the person');
  });

  test('dependents finds them and blocking narrows to the ones that matter', async () => {
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    const account = await makeAccount(db, { name: 'Savings' });
    await db.repo('transaction').create({
      date: '2026-08-22', amount: 1, direction: 'out',
      description: 'test', account: account.id, person: asha.id,
    });
    await db.repo('healthRecord').create({
      person: asha.id, date: '2026-08-01', kind: 'consultation', title: 'Check-up',
    });

    const rowsOf = (name) => db.adapter.query(name, {});
    const found = await dependents('person', asha.id, rowsOf);
    assert.ok(found.length >= 2, `${found.length} dependents`);
    // Only the health record's `person` is required.
    assert.ok(blocking(found).every((d) => d.entity === 'healthRecord'));
  });
});

describe('the dialog and the rule', () => {
  // Both ends have been covered before and the wiring between them has not.
  // `impactOfDeleting` decides what the screen says; the repository decides
  // what happens. If they disagree, somebody is told a delete is fine and then
  // refused, or told it is impossible and it would have worked.

  test('says a delete is blocked exactly when the repository refuses it', async () => {
    const db = await makeDb();
    const service = new RecordsService(db);

    // Required: a health record must name a person.
    const asha = await makePerson(db, { name: 'Asha' });
    await db.repo('healthRecord').create({
      person: asha.id, date: '2026-08-01', kind: 'consultation', title: 'Check-up',
    });

    // Optional: a transaction's person may be empty.
    const ravi = await makePerson(db, { name: 'Ravi' });
    const account = await makeAccount(db, { name: 'Savings' });
    await db.repo('transaction').create({
      date: '2026-08-22', amount: 100, direction: 'out',
      description: 'test', account: account.id, person: ravi.id,
    });

    for (const [person, shouldBlock] of [[asha, true], [ravi, false]]) {
      const impact = await service.impactOfDeleting('person', person.id);
      const said = /cannot be deleted/.test(service.describeImpact(impact));

      let refused = false;
      try { await db.repo('person').remove(person.id); } catch { refused = true; }

      assert.equal(Boolean(impact.breaking), shouldBlock, `${person.name}: impact.breaking`);
      assert.equal(said, shouldBlock, `${person.name}: what the dialog says`);
      assert.equal(refused, shouldBlock, `${person.name}: what the repository does`);
    }
  });
});

describe('a unit of work', () => {
  test('lets a record reference one staged a line earlier', async () => {
    // The case that a relational database calls a deferred constraint.
    // Recording a payment and the receipt for it is one act, and the receipt
    // has to name a transaction that is not written yet.
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'Savings' });

    const written = await transact(db, async (unit) => {
      const txn = await unit.create('transaction', {
        date: '2026-08-22', amount: 2_499_00, direction: 'out',
        description: 'Bookshop', account: account.id,
      });
      await unit.create('receipt', {
        merchant: 'Bookshop', date: '2026-08-22', total: 2_499_00, transaction: txn.id,
      });
    });

    assert.length(written, 2);
    // And it points at the transaction that really landed, rather than at an
    // id the unit invented and then wrote something else under.
    const [txn, receipt] = written;
    const stored = await db.repo('receipt').get(receipt.id);
    assert.equal(stored.transaction, txn.id);
    assert.ok(await db.repo('transaction').get(txn.id), 'the transaction was not written');
  });

  test('but still refuses one that names nothing at all', async () => {
    // The unit must not become a way around the rule.
    const db = await makeDb();
    let threw = false;
    try {
      await transact(db, async (unit) => unit.create('receipt', {
        merchant: 'Bookshop', date: '2026-08-22', total: 100, transaction: 'trn_nowhere',
      }));
    } catch { threw = true; }
    assert.ok(threw, 'a unit of work accepted a dangling reference');
  });
});

describe('what sync is allowed to bring in', () => {
  test('applyRemote does not go through the check, and that is deliberate', async () => {
    // A pull arrives in whatever order the backend hands rows over, so a
    // transaction can land before the account it names. Refusing it would drop
    // a row the household really has to satisfy an ordering nobody promised.
    const db = await makeDb();
    const remote = {
      id: 'trn_remote', rev: 1, date: '2026-08-22', amount: 100, direction: 'out',
      description: 'from another device', account: 'acc_not_here_yet',
      createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: null, schemaVersion: 1,
    };

    await db.repo('transaction').applyRemote(remote);
    assert.ok(await db.repo('transaction').get('trn_remote'),
      'a synced row was refused for arriving before what it names');
  });

  test('and danglingIn reports what that let in', async () => {
    // The other half of the exemption: what cannot be refused should still be
    // findable, rather than met later on a screen that says "unknown".
    const db = await makeDb();
    await db.repo('transaction').applyRemote({
      id: 'trn_remote', rev: 1, date: '2026-08-22', amount: 100, direction: 'out',
      description: 'orphan', account: 'acc_not_here',
      createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: null, schemaVersion: 1,
    });

    const rowsOf = (name) => db.adapter.query(name, {});
    const exists = async (name, id) => {
      const row = await db.adapter.read(name, id);
      return Boolean(row) && !row.deletedAt;
    };

    const found = await danglingIn(rowsOf, exists);
    const one = found.find((d) => d.id === 'trn_remote');
    assert.ok(one, JSON.stringify(found).slice(0, 200));
    // The broken row is the transaction, and what it cannot find is the
    // account. Reporting it the other way round would send somebody looking
    // for a record that by definition is not there to open.
    assert.equal(one.entity, 'transaction');
    assert.equal(one.key, 'account');
    assert.equal(one.points.entity, 'account');
    assert.equal(one.points.id, 'acc_not_here');
  });

  test('and does not report one on a record that has been deleted', async () => {
    // A deleted row's broken reference is not work for anybody. Listing it
    // would put rows on a repair screen whose only correct fix is the one
    // already applied.
    const db = await makeDb();
    await db.repo('transaction').applyRemote({
      id: 'trn_gone', rev: 1, date: '2026-08-22', amount: 100, direction: 'out',
      description: 'orphan', account: 'acc_not_here',
      createdAt: '2026-08-22T00:00:00.000Z', updatedAt: '2026-08-22T00:00:00.000Z',
      deletedAt: '2026-08-22T01:00:00.000Z', schemaVersion: 1,
    });

    const rowsOf = (name) => db.adapter.query(name, {});
    const exists = async () => false;

    const found = await danglingIn(rowsOf, exists);
    assert.not(found.some((d) => d.id === 'trn_gone'),
      'a deleted record was listed as needing repair');
  });
});

describe('one predicate for a row that may be counted', () => {
  /*
   * `settled()` replaced about twenty hand-written `!row.deletedAt` checks
   * across the money modules. The point was not tidiness: `heldAt` is a second
   * reason a row may not join a total, and adding it to twenty conditions by
   * hand is how nineteen of them keep the old meaning.
   *
   * So the invariant is that a module which has adopted the predicate does not
   * also spell the test out beside it. Derived rather than listed — a fourth
   * module that adopts `settled` tomorrow is covered without anybody
   * remembering to name it here.
   */
  test('a module that uses settled() does not also hand-write the deleted check', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'domain');

    const files = (await readdir(dir)).filter((f) => f.endsWith('.js'));
    const adopted = [];
    const mixed = [];
    for (const file of files) {
      const src = await readFile(join(dir, file), 'utf8');
      // The import, not the word. `settled` is also ordinary finance English —
      // a settled trade, a settled instalment — and matching on the bare word
      // named `estate.js`, `instalments.js` and `tradebook.js`, none of which
      // had adopted anything. A check that reports three false faults is one
      // somebody switches off.
      if (!/import \{[^}]*\bsettled\b[^}]*\} from '[^']*integrity\.js'/.test(src)) continue;
      adopted.push(file);
      if (/deletedAt/.test(src)) mixed.push(file);
    }

    assert.ok(adopted.length >= 3,
      `only ${adopted.length} modules use it, so this proves almost nothing`);
    assert.deep(mixed, []);
  });

  test('and it refuses both a deleted row and a held one', () => {
    assert.ok(settled({ id: 'a' }));
    assert.not(settled({ id: 'a', deletedAt: '2025-01-01T00:00:00.000Z' }));
    assert.not(settled({ id: 'a', heldAt: '2025-01-01T00:00:00.000Z' }));
    assert.not(settled(null));
  });
});
