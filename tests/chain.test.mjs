import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import {
  canonical, hashEntry, link, verify, verifyDevice, GENESIS, headKey,
} from '../js/data/chain.js';

setSuite('chain');

const entry = (over = {}) => ({
  id: 'aud_1', at: '2026-08-22T10:00:00.000Z', action: 'update',
  entity: 'person', recordId: 'per_1', actorId: 'per_owner', actorRole: 'owner',
  fields: ['name'], detail: {}, deviceId: 'dev_a', synced: false, ...over,
});

/* --------------------------------------------------------- the hash itself */

describe('what an entry is hashed over', () => {
  test('two entries with the same content hash the same', async () => {
    assert.equal(await hashEntry(entry()), await hashEntry(entry()));
  });

  test('changing any signed field changes the hash', async () => {
    const base = await hashEntry(entry());
    /** @type {[string, any][]} */
    const changes = [
      ['actorId', 'someone-else'], ['action', 'delete'], ['recordId', 'per_2'],
      ['fields', ['name', 'phone']], ['at', '2026-08-23T10:00:00.000Z'],
      ['entity', 'account'], ['actorRole', 'child'], ['deviceId', 'dev_b'],
      ['detail', { note: 'x' }], ['id', 'aud_2'],
    ];
    for (const [key, value] of changes) {
      assert.not(await hashEntry(entry({ [key]: value })) === base,
        `changing ${key} did not change the hash`);
    }
  });

  test('but `synced` does not, because it flips after the entry is written', async () => {
    // Hashing it would break every chain the moment it synced, which is a
    // verifier that cries wolf and therefore one nobody reads.
    assert.equal(await hashEntry(entry({ synced: true })), await hashEntry(entry()));
  });

  test('and the same detail built in two key orders hashes the same', async () => {
    // Otherwise an honest entry reads as tampered depending on the order
    // somebody happened to build an object in.
    const a = entry({ detail: { pushed: 1, pulled: 2 } });
    const b = entry({ detail: { pulled: 2, pushed: 1 } });
    assert.equal(await hashEntry(a), await hashEntry(b));
  });

  test('the previous hash is part of it, so position is signed too', async () => {
    assert.not(await hashEntry(entry(), 'aaa') === await hashEntry(entry(), 'bbb'));
  });

  test('canonical output does not depend on key insertion order', () => {
    const forwards = entry();
    const backwards = Object.fromEntries(Object.entries(forwards).reverse());
    assert.equal(canonical(forwards), canonical(backwards));
  });
});

/* ------------------------------------------------------------- the walking */

describe('walking a chain', () => {
  /** n entries, honestly linked. */
  async function chainOf(n) {
    const out = [];
    let prev = GENESIS;
    for (let i = 0; i < n; i += 1) {
      const linked = await link(entry({ id: `aud_${i}` }), prev);
      prev = linked.hash;
      out.push(linked);
    }
    return out;
  }

  test('an honest chain verifies, in any order it is handed over', async () => {
    const rows = await chainOf(4);
    const shuffled = [rows[2], rows[0], rows[3], rows[1]];
    const result = await verifyDevice(shuffled);
    assert.ok(result.ok, result.why);
    assert.equal(result.checked, 4);
  });

  test('an empty log is intact rather than broken', async () => {
    // A new database has no entries, and calling that tampering would make
    // the check meaningless on the day somebody first looks at it.
    const result = await verifyDevice([]);
    assert.ok(result.ok);
    assert.equal(result.checked, 0);
  });

  test('an altered entry is found, and named', async () => {
    const rows = await chainOf(4);
    rows[2] = { ...rows[2], actorId: 'somebody-else' };
    const result = await verifyDevice(rows);
    assert.not(result.ok);
    assert.equal(result.kind, 'altered');
    assert.equal(result.at, 'aud_2');
  });

  test('a deleted entry leaves the rest orphaned', async () => {
    const rows = await chainOf(4);
    const result = await verifyDevice(rows.filter((r) => r.id !== 'aud_1'));
    assert.not(result.ok);
    assert.equal(result.kind, 'orphaned');
  });

  test('deleting the first entry leaves the log with no beginning', async () => {
    const rows = await chainOf(3);
    const result = await verifyDevice(rows.slice(1));
    assert.not(result.ok);
    assert.equal(result.kind, 'noStart');
  });

  test('an inserted entry forks the chain', async () => {
    const rows = await chainOf(3);
    const forged = await link(entry({ id: 'aud_forged' }), rows[0].hash);
    const result = await verifyDevice([...rows, forged]);
    assert.not(result.ok);
    assert.equal(result.kind, 'forked');
  });

  test('re-hashing an altered entry defeats it, and the doc says so', async () => {
    // Stated as a test rather than only as prose. Somebody who can write to
    // this database can also recompute the chain, and the whole honesty of
    // this feature depends on never claiming otherwise.
    const rows = await chainOf(3);
    const tampered = { ...rows[1], actorId: 'somebody-else' };
    const relinked = await link(tampered, rows[0].hash);
    const rest = await link(entry({ id: 'aud_2' }), relinked.hash);

    const result = await verifyDevice([rows[0], relinked, rest]);
    assert.ok(result.ok,
      'the chain caught a full recomputation — if this ever passes, the claim '
      + 'in js/data/chain.js and docs/AUDIT_CHAIN.md is understated, not wrong');
  });
});

/* ------------------------------------------------- more than one device */

describe('two devices', () => {
  test('each chains its own, so a second phone is not a broken log', async () => {
    // The failure that would make this useless: one global chain has no
    // global write order, and two devices appending offline would break it
    // every time.
    let a = GENESIS;
    let b = GENESIS;
    const rows = [];
    for (let i = 0; i < 3; i += 1) {
      const one = await link(entry({ id: `a${i}`, deviceId: 'dev_a' }), a);
      const two = await link(entry({ id: `b${i}`, deviceId: 'dev_b' }), b);
      a = one.hash; b = two.hash;
      rows.push(one, two);
    }

    const result = await verify(rows);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.devices.length, 2);
    assert.equal(result.checked, 6);
  });

  test('and one broken device does not clear the other', async () => {
    let a = GENESIS;
    const good = [];
    for (let i = 0; i < 2; i += 1) {
      const one = await link(entry({ id: `a${i}`, deviceId: 'dev_a' }), a);
      a = one.hash; good.push(one);
    }
    const bad = await link(entry({ id: 'b0', deviceId: 'dev_b' }), GENESIS);

    const result = await verify([...good, { ...bad, actorId: 'changed' }]);
    assert.not(result.ok);
    assert.ok(result.devices.find((d) => d.deviceId === 'dev_a').ok);
    assert.not(result.devices.find((d) => d.deviceId === 'dev_b').ok);
  });

  test('entries written before the chain existed are counted, not condemned', async () => {
    // A verifier that calls every older database tampered tells nobody
    // anything. They are unverifiable, which is a different fact and is the
    // one reported.
    const result = await verify([entry({ id: 'old_1' }), entry({ id: 'old_2' })]);
    assert.ok(result.ok);
    assert.equal(result.unchained, 2);
    assert.equal(result.checked, 0);
  });
});

/* ------------------------------------------------------ through the database */

describe('the real write path', () => {
  test('every entry a write produces is chained', async () => {
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    await db.repo('person').update(asha.id, { name: 'Asha Rao' });
    await db.repo('person').remove(asha.id);

    const rows = await db.adapter.query('audit', {});
    assert.ok(rows.length >= 3, `${rows.length} entries`);
    assert.ok(rows.every((r) => r.hash && r.prev), 'an entry was written unchained');

    const result = await db.verifyAudit();
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.unchained, 0);
  });

  test('and the head is stored, so a reload continues the same chain', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    const head = await db.adapter.read('meta', headKey(db.deviceId));
    const rows = await db.adapter.query('audit', {});
    const last = rows.find((r) => !rows.some((o) => o.prev === r.hash));
    assert.equal(head.value, last.hash);
  });

  test('rewriting an entry in place is caught through the database', async () => {
    // The measurement this was built from: before the chain, this succeeded
    // and nothing anywhere could tell.
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    await db.repo('person').update(asha.id, { name: 'Asha Rao' });

    const rows = await db.adapter.query('audit', {});
    await db.adapter.write('audit', { ...rows[1], actorId: 'somebody-else' });

    const result = await db.verifyAudit();
    assert.not(result.ok, 'a rewritten audit entry passed verification');
    assert.equal(result.devices[0].kind, 'altered');
  });

  test('deleting the line that says what somebody did is caught', async () => {
    const db = await makeDb();
    const asha = await makePerson(db, { name: 'Asha' });
    await db.repo('person').update(asha.id, { name: 'Asha Rao' });
    await db.repo('person').update(asha.id, { name: 'Asha R' });

    const rows = await db.adapter.query('audit', {});
    await db.adapter.remove('audit', rows[1].id);

    const result = await db.verifyAudit();
    assert.not(result.ok, 'a deleted audit entry passed verification');
  });

  test('a unit of work chains its entries in order rather than forking', async () => {
    // Several entries planned before any is applied. Hashing them all against
    // the same head would fork the chain and read as an insertion.
    const { transact } = await import('../js/data/unit.js');
    const db = await makeDb();

    await transact(db, async (unit) => {
      await unit.create('person', { name: 'One' });
      await unit.create('person', { name: 'Two' });
      await unit.create('person', { name: 'Three' });
    });

    const result = await db.verifyAudit();
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.checked, 3);
  });

  test('a write refused before it is planned never touches the chain', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    let refused = false;
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 1, direction: 'out',
        description: 'test', account: 'acc_does_not_exist',
      });
    } catch { refused = true; }
    assert.ok(refused, 'the write was meant to be refused');

    await makePerson(db, { name: 'Ravi' });

    const result = await db.verifyAudit();
    assert.ok(result.ok, `a refused write broke the chain: ${JSON.stringify(result)}`);
  });

  test('and a transaction that fails after planning puts the head back', async () => {
    // The case the test above does NOT reach, and a mutation said so: an
    // integrity refusal throws before `plan` runs, so the head never moves.
    // The rollback only matters when the entry was planned — the head
    // advanced — and the transaction then failed. Without putting it back,
    // the next honest entry chains to something nobody has and an untampered
    // log reads as broken.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    const real = db.adapter.tx.bind(db.adapter);
    let fail = true;
    db.adapter.tx = async (...args) => {
      if (fail) { fail = false; throw new Error('the disk went away'); }
      return real(...args);
    };

    let threw = false;
    try { await makePerson(db, { name: 'Ravi' }); } catch { threw = true; }
    assert.ok(threw, 'the transaction was meant to fail');

    db.adapter.tx = real;
    await makePerson(db, { name: 'Meera' });

    const result = await db.verifyAudit();
    assert.ok(result.ok, `a failed transaction broke the chain: ${JSON.stringify(result)}`);
  });
});
