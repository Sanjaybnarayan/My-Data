import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import { makeDb, outbox, makePerson, makeAccount } from './fixture.mjs';
import { merge, arbitrate, conflictRecord } from '../js/sync/conflict.js';
import { Outbox, backoffMs, MAX_ATTEMPTS } from '../js/sync/outbox.js';
import { SyncEngine, SYNC_STATE } from '../js/sync/engine.js';
import { FakeTransport } from '../js/sync/transport.js';
import { TransportError } from '../js/core/errors.js';

setSuite('sync');

const base = (over = {}) => ({
  id: 'r1', rev: 1, origin: 'dev_a', createdAt: '2025-01-01T00:00:00.000Z',
  createdBy: 'p1', updatedAt: '2025-01-01T00:00:00.000Z', updatedBy: 'p1',
  deletedAt: null, schemaVersion: 1, name: 'Original', amount: 100, tags: ['a'],
  ...over,
});

describe('arbitration', () => {
  test('the later write wins', () => {
    assert.equal(arbitrate(
      base({ updatedAt: '2025-02-01T00:00:00.000Z' }),
      base({ updatedAt: '2025-01-01T00:00:00.000Z' }),
    ), 'local');
  });

  test('an equal timestamp falls to the higher revision', () => {
    assert.equal(arbitrate(base({ rev: 5 }), base({ rev: 9 })), 'remote');
  });

  test('an equal revision falls to the device id, which is total', () => {
    assert.equal(arbitrate(base({ origin: 'dev_z' }), base({ origin: 'dev_a' })), 'local');
    assert.equal(arbitrate(base({ origin: 'dev_a' }), base({ origin: 'dev_z' })), 'remote');
  });

  test('two devices reach the same answer without talking', () => {
    // The same pair, seen from each side. If these disagreed the record would
    // ping-pong between the devices forever.
    const x = base({ origin: 'dev_a', rev: 3, updatedAt: '2025-03-01T00:00:00.000Z' });
    const y = base({ origin: 'dev_b', rev: 3, updatedAt: '2025-03-01T00:00:00.000Z' });
    const fromA = arbitrate(x, y) === 'local' ? x : y;
    const fromB = arbitrate(y, x) === 'local' ? y : x;
    assert.equal(fromA.origin, fromB.origin);
  });
});

describe('merge', () => {
  test('identical revisions converge with nothing to do', () => {
    const r = merge({ base: null, local: base(), remote: base() });
    assert.equal(r.outcome, 'converged');
    assert.length(r.conflicted, 0);
  });

  test('a change on one side only is taken without a conflict', () => {
    const b = base();
    const local = base({ rev: 2, name: 'Renamed', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 1, origin: 'dev_b' });

    const r = merge({ base: b, local, remote });
    assert.equal(r.record.name, 'Renamed');
    assert.length(r.conflicted, 0);
  });

  test('different fields on each side both survive', () => {
    const b = base();
    const local = base({ rev: 2, name: 'Renamed', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', amount: 500, updatedAt: '2025-02-02T00:00:00.000Z' });

    const r = merge({ base: b, local, remote });
    assert.equal(r.record.name, 'Renamed', 'the local edit must survive');
    assert.equal(r.record.amount, 500, 'the remote edit must survive');
    assert.length(r.conflicted, 0, 'edits to different fields are not a conflict');
  });

  test('the same field changed both ways is arbitrated and reported', () => {
    const b = base();
    const local = base({ rev: 2, name: 'Mine', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', name: 'Theirs', updatedAt: '2025-02-02T00:00:00.000Z' });

    const r = merge({ base: b, local, remote });
    assert.equal(r.record.name, 'Theirs', 'the later write wins');
    assert.deep(r.conflicted, ['name']);
    assert.equal(r.outcome, 'merged-with-conflicts');
  });

  test('the same edit made twice is not a conflict', () => {
    const b = base();
    const local = base({ rev: 2, name: 'Same', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', name: 'Same', updatedAt: '2025-02-02T00:00:00.000Z' });
    assert.length(merge({ base: b, local, remote }).conflicted, 0);
  });

  test('a delete beats a concurrent edit', () => {
    const b = base();
    const local = base({ rev: 2, name: 'Edited', updatedAt: '2025-02-05T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', deletedAt: '2025-02-02T00:00:00.000Z' });

    const r = merge({ base: b, local, remote });
    assert.ok(r.record.deletedAt, 'the delete must win even though the edit is later');
    assert.equal(r.outcome, 'delete-wins');
    assert.includes(r.conflicted, 'name', 'the lost edit must be reported');
  });

  test('two deletes are not a conflict', () => {
    const b = base();
    const local = base({ rev: 2, deletedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', deletedAt: '2025-02-02T00:00:00.000Z' });
    const r = merge({ base: b, local, remote });
    assert.equal(r.outcome, 'both-deleted');
    assert.length(r.conflicted, 0);
  });

  test('the merged revision is higher than either side', () => {
    const r = merge({
      base: base(),
      local: base({ rev: 4, name: 'a', updatedAt: '2025-02-01T00:00:00.000Z' }),
      remote: base({ rev: 7, origin: 'dev_b', amount: 1, updatedAt: '2025-02-02T00:00:00.000Z' }),
    });
    assert.equal(r.record.rev, 8, 'a merge the server has not seen needs a new revision');
  });

  test('an array field is compared by value, not identity', () => {
    const b = base();
    const local = base({ rev: 2, tags: ['a'], updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', tags: ['a', 'b'], updatedAt: '2025-02-02T00:00:00.000Z' });
    const r = merge({ base: b, local, remote });
    assert.deep(r.record.tags, ['a', 'b'], 'only the remote changed the tags');
    assert.length(r.conflicted, 0);
  });

  test('a blank and an absent field are the same thing', () => {
    const b = base({ nickname: '' });
    const local = base({ rev: 2, updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', nickname: '', updatedAt: '2025-02-02T00:00:00.000Z' });
    assert.length(merge({ base: b, local, remote }).conflicted, 0);
  });

  test('without a base every difference is reported rather than guessed', () => {
    const local = base({ rev: 2, name: 'Mine', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', name: 'Theirs', amount: 7, updatedAt: '2025-02-02T00:00:00.000Z' });
    const r = merge({ base: null, local, remote });
    assert.equal(r.outcome, 'no-base');
    assert.includes(r.conflicted, 'name');
    assert.includes(r.conflicted, 'amount');
  });

  test('creation metadata comes from the base, not the winner', () => {
    const b = base({ createdBy: 'p1', createdAt: '2025-01-01T00:00:00.000Z' });
    const local = base({ rev: 2, createdBy: 'wrong', name: 'a', updatedAt: '2025-02-01T00:00:00.000Z' });
    const remote = base({ rev: 2, origin: 'dev_b', amount: 3, updatedAt: '2025-02-02T00:00:00.000Z' });
    const r = merge({ base: b, local, remote });
    assert.equal(r.record.createdBy, 'p1');
    assert.equal(r.record.createdAt, '2025-01-01T00:00:00.000Z');
  });

  test('a conflict note keeps both sides so the choice can be undone', () => {
    const local = base({ name: 'Mine' });
    const remote = base({ name: 'Theirs' });
    const note = conflictRecord({
      store: 'person', local, remote, merged: { ...remote, rev: 3 },
      conflicted: ['name'], outcome: 'merged-with-conflicts',
    });
    assert.equal(note.localValues.name, 'Mine');
    assert.equal(note.remoteValues.name, 'Theirs');
    assert.equal(note.resolvedValues.name, 'Theirs');
    assert.not(note.reviewed);
  });
});

describe('backoff', () => {
  test('doubles and then stops doubling', () => {
    const exact = (n) => backoffMs(n, () => 0.5);
    assert.equal(exact(1), 1000);
    assert.equal(exact(2), 2000);
    assert.equal(exact(3), 4000);
    assert.equal(exact(20), 300_000, 'the delay is capped at five minutes');
  });

  test('jitter stays within a fifth either way', () => {
    assert.equal(backoffMs(3, () => 0), 3200);
    assert.equal(backoffMs(3, () => 1), 4800);
  });
});

describe('outbox', () => {
  test('drains in the order the writes were made', async () => {
    const db = await makeDb();
    const p = await makePerson(db);
    await db.repo('person').update(p.id, { nickname: 'one' });
    await db.repo('person').update(p.id, { nickname: 'two' });

    const q = new Outbox(db.adapter);
    const ready = await q.ready();
    assert.deep(ready.map((e) => e.rev), [1, 2, 3]);
  });

  test('a parked entry holds back later writes to the same store', async () => {
    const clock = fakeClock();
    const db = await makeDb();
    await makePerson(db, { name: 'First' });
    await makePerson(db, { name: 'Second' });

    const q = new Outbox(db.adapter, { clock });
    const [first] = await q.ready();
    await q.defer(first, new TransportError('bad request', { status: 400 }));

    const ready = await q.ready();
    assert.length(ready, 0, 'sending the second write past an unapplied first reorders them');
  });

  test('a rejection parks immediately instead of retrying forever', async () => {
    const db = await makeDb();
    await makePerson(db);
    const q = new Outbox(db.adapter);
    const [entry] = await q.ready();

    const after = await q.defer(entry, new TransportError('nope', { status: 400 }));
    assert.equal(after.state, 'failed');
    assert.equal(after.attempts, 1);
  });

  test('a server error retries until the attempt cap', async () => {
    const clock = fakeClock();
    const db = await makeDb();
    await makePerson(db);
    const q = new Outbox(db.adapter, { clock, random: () => 0.5 });

    let entry = (await q.ready())[0];
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      entry = await q.defer(entry, new TransportError('down', { status: 503 }));
      assert.equal(entry.state, 'pending', `attempt ${i} should still be retryable`);
      clock.advance(entry.nextAttemptAt - clock() + 1);
    }
    entry = await q.defer(entry, new TransportError('down', { status: 503 }));
    assert.equal(entry.state, 'failed', 'the cap must eventually stop it');
  });

  test('a deferred entry is not ready until its delay has passed', async () => {
    const clock = fakeClock();
    const db = await makeDb();
    await makePerson(db);
    const q = new Outbox(db.adapter, { clock, random: () => 0.5 });

    const [entry] = await q.ready();
    await q.defer(entry, new TransportError('down', { status: 503 }));
    assert.length(await q.ready(), 0);

    clock.advance(2000);
    assert.length(await q.ready(), 1);
  });

  test('settling marks the record synced and drops the shadow', async () => {
    const db = await makeDb();
    const p = await makePerson(db);
    const q = new Outbox(db.adapter);
    const [entry] = await q.ready();

    await q.settle(entry);
    assert.equal((await db.adapter.read('person', p.id)).syncState, 'synced');
    assert.length(await q.ready(), 0);
  });

  test('settling an older entry leaves a newer local edit pending', async () => {
    const db = await makeDb();
    const p = await makePerson(db);
    const q = new Outbox(db.adapter);
    const [first] = await q.ready();
    await db.repo('person').update(p.id, { nickname: 'newer' });

    await q.settle(first);
    assert.equal((await db.adapter.read('person', p.id)).syncState, 'pending',
      'the newer revision has its own queue entry and is not yet sent');
  });

  test('a parked entry can be revived', async () => {
    const db = await makeDb();
    await makePerson(db);
    const q = new Outbox(db.adapter);
    const [entry] = await q.ready();
    await q.defer(entry, new TransportError('nope', { status: 400 }));

    assert.equal(await q.reviveAll(), 1);
    assert.length(await q.ready(), 1);
  });
});

describe('engine', () => {
  /** A server that stores rows in a Map and behaves like the Apps Script one. */
  function fakeServer() {
    const rows = new Map();
    const key = (store, id) => `${store}/${id}`;
    return {
      rows,
      transport: new FakeTransport({
        schema: () => ({ migrated: true }),
        bootstrap: () => ({ workbookId: 'wb1', rootFolderId: 'fld1' }),
        audit: () => ({ appended: true }),
        verify: () => ({ counts: {} }),
        push: ({ changes }) => {
          const applied = [];
          const conflicts = [];
          for (const change of changes) {
            const existing = rows.get(key(change.store, change.recordId));
            if (existing && existing.rev >= change.rev && existing.origin !== change.payload.origin) {
              conflicts.push({ store: change.store, record: existing });
              continue;
            }
            rows.set(key(change.store, change.recordId), change.payload);
            applied.push(change.recordId);
          }
          return { applied, rejected: [], conflicts };
        },
        pull: ({ cursors }) => {
          const records = {};
          for (const [k, record] of rows) {
            const store = k.slice(0, k.indexOf('/'));
            const since = cursors[store] ?? '';
            if (record.updatedAt <= since) continue;
            (records[store] ??= []).push(record);
          }
          const next = { ...cursors };
          for (const [store, list] of Object.entries(records)) {
            next[store] = list.reduce((a, r) => (r.updatedAt > a ? r.updatedAt : a), next[store] ?? '');
          }
          return { records, cursors: next, more: false };
        },
      }),
    };
  }

  test('a run pushes the queue and empties it', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    await makePerson(db);
    await makeAccount(db);
    const result = await engine.run();

    assert.equal(result.pushed, 2);
    assert.length(await outbox(db), 0);
    assert.equal(engine.state, SYNC_STATE.idle);
  });

  test('a pulled record appears locally without re-entering the queue', async () => {
    const db = await makeDb();
    const server = fakeServer();
    server.rows.set('person/prs_remote', {
      id: 'prs_remote', rev: 1, name: 'Remote Person', role: 'adult',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-05-01T00:00:00.000Z',
      deletedAt: null, origin: 'dev_other', schemaVersion: 1,
    });

    const engine = new SyncEngine({ db, transport: server.transport });
    const result = await engine.run();

    assert.equal(result.pulled, 1);
    assert.ok(await db.repo('person').get('prs_remote'));
    assert.length(await outbox(db), 0, 'a pulled record must not bounce straight back');
  });

  test('the cursor stops the same row being pulled twice', async () => {
    const db = await makeDb();
    const server = fakeServer();
    server.rows.set('person/prs_remote', {
      id: 'prs_remote', rev: 1, name: 'Remote', role: 'adult',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-05-01T00:00:00.000Z',
      deletedAt: null, origin: 'dev_other', schemaVersion: 1,
    });
    const engine = new SyncEngine({ db, transport: server.transport });

    assert.equal((await engine.run()).pulled, 1);
    assert.equal((await engine.run()).pulled, 0, 'nothing changed, so nothing should come down');
  });

  test('a concurrent edit on two devices merges rather than losing one', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    const person = await makePerson(db, { name: 'Asha', nickname: '' });
    await engine.run(); // the server now holds rev 1

    // Another device edits the nickname and gets there first.
    const onServer = server.rows.get(`person/${person.id}`);
    server.rows.set(`person/${person.id}`, {
      ...onServer, rev: 2, nickname: 'from-other-device', origin: 'dev_other',
      updatedAt: '2030-01-01T00:00:00.000Z',
    });

    // This device edits a different field, offline.
    await db.repo('person').update(person.id, { occupation: 'Architect' });
    await engine.run();

    const merged = await db.repo('person').get(person.id);
    assert.equal(merged.nickname, 'from-other-device', 'the other device edit must survive');
    assert.equal(merged.occupation, 'Architect', 'this device edit must survive');
    assert.length(await db.adapter.query('conflicts', {}), 0, 'different fields are not a conflict');
  });

  test('the same field edited on two devices records a reviewable conflict', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    const person = await makePerson(db, { name: 'Asha' });
    await engine.run();

    server.rows.set(`person/${person.id}`, {
      ...server.rows.get(`person/${person.id}`),
      rev: 2, name: 'Asha Devi', origin: 'dev_other', updatedAt: '2030-01-01T00:00:00.000Z',
    });
    await db.repo('person').update(person.id, { name: 'Asha N' });
    await engine.run();

    const conflicts = await db.adapter.query('conflicts', {});
    assert.length(conflicts, 1);
    assert.deep(conflicts[0].fields, ['name']);
    assert.equal(conflicts[0].localValues.name, 'Asha N');
    assert.equal(conflicts[0].remoteValues.name, 'Asha Devi');
  });

  test('a merge is pushed back so both devices converge', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    const person = await makePerson(db);
    await engine.run();
    server.rows.set(`person/${person.id}`, {
      ...server.rows.get(`person/${person.id}`),
      rev: 2, nickname: 'other', origin: 'dev_other', updatedAt: '2030-01-01T00:00:00.000Z',
    });
    await db.repo('person').update(person.id, { occupation: 'Architect' });

    await engine.run(); // merges, queues the merge
    await engine.run(); // pushes it

    const onServer = server.rows.get(`person/${person.id}`);
    assert.equal(onServer.occupation, 'Architect');
    assert.equal(onServer.nickname, 'other');
    assert.length(await outbox(db), 0, 'the queue must eventually empty');
  });

  test('a transport failure leaves the queue intact and does not throw', async () => {
    const db = await makeDb();
    const transport = new FakeTransport({
      schema: () => ({}),
      push: () => { throw new TransportError('offline', { status: 0 }); },
      pull: () => ({ records: {}, cursors: {}, more: false }),
      audit: () => ({}),
    });
    const engine = new SyncEngine({ db, transport });
    await makePerson(db);

    const result = await engine.run();
    assert.equal(result.pushed, 0);
    assert.length(await db.adapter.query('outbox', {}), 1, 'nothing may be lost');
    assert.equal(engine.state, SYNC_STATE.offline);
  });

  test('a rejected record parks and the run reports it', async () => {
    const db = await makeDb();
    const transport = new FakeTransport({
      schema: () => ({}),
      push: ({ changes }) => ({
        applied: [], conflicts: [],
        rejected: changes.map((c) => ({ recordId: c.recordId, reason: 'sheet is full' })),
      }),
      pull: () => ({ records: {}, cursors: {}, more: false }),
      audit: () => ({}),
    });
    const engine = new SyncEngine({ db, transport });
    await makePerson(db);

    const result = await engine.run();
    assert.equal(result.rejected, 1);
    assert.equal(engine.state, SYNC_STATE.blocked);
    const parked = await new Outbox(db.adapter).failed();
    assert.includes(parked[0].lastError, 'sheet is full');
  });

  test('two concurrent runs do not both drain the queue', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });
    await makePerson(db);

    const [a, b] = await Promise.all([engine.run(), engine.run()]);
    assert.equal(a, b, 'the second caller should get the run already in flight');
    assert.equal(server.transport.calls.filter((c) => c.action === 'push').length, 1);
  });

  test('the schema is migrated once, not on every run', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    await engine.run();
    await engine.run();
    assert.length(server.transport.calls.filter((c) => c.action === 'schema'), 1);
  });

  test('backup verification compares row counts and says so', async () => {
    const db = await makeDb();
    await makePerson(db);
    const transport = new FakeTransport({ verify: () => ({ counts: { People: 0 } }) });
    const engine = new SyncEngine({ db, transport });

    const report = await engine.verifyBackup();
    assert.not(report.verified, 'a missing row must fail verification');
    const people = report.rows.find((r) => r.entity === 'person');
    assert.equal(people.local, 1);
    assert.equal(people.remote, 0);
  });

  test('deleting a record replicates the deletion', async () => {
    const db = await makeDb();
    const server = fakeServer();
    const engine = new SyncEngine({ db, transport: server.transport });

    const person = await makePerson(db);
    await engine.run();
    await db.repo('person').remove(person.id);
    await engine.run();

    assert.ok(server.rows.get(`person/${person.id}`).deletedAt, 'the tombstone must reach the server');
  });
});

describe('a reference that arrives pointing at nothing', () => {
  /*
   * `applyRemote` does not enforce referential integrity and should not:
   * rows arrive in whatever order the backend hands them over, so a
   * transaction can land before the account it names, and refusing it would
   * drop a row the household really has. `data/integrity.js` sets that out
   * and calls it a real weakening.
   *
   * The weakening is in the refusing. What was missing was anybody finding
   * out — the audit that exists for this runs when somebody presses "Check
   * for broken links" in Settings, which is to say when they already suspect.
   * These check that the same audit now runs at the one moment the ordering
   * excuse has expired, and that it stays quiet when it has not.
   */
  const pullOf = (records) => new FakeTransport({
    schema: () => ({}),
    push: () => ({ applied: [], rejected: [], conflicts: [] }),
    audit: () => ({}),
    pull: () => ({ records, cursors: {}, more: false }),
  });

  const txn = (over = {}) => ({
    id: 't1', rev: 1, origin: 'dev_b', createdAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'p1', updatedAt: '2025-01-02T00:00:00.000Z', updatedBy: 'p1',
    deletedAt: null, schemaVersion: 1,
    date: '2025-01-01', amount: 1000, direction: 'out', account: 'acc_missing',
    ...over,
  });

  test('is still applied, because refusing it would lose a real record', async () => {
    const db = await makeDb();
    const engine = new SyncEngine({ db, transport: pullOf({ transaction: [txn()] }) });

    const result = await engine.pullOnce();

    assert.equal(result.pulled, 1);
    const stored = await db.adapter.read('transaction', 't1');
    assert.ok(stored, 'the row was refused, which is the behaviour this must not change');
  });

  test('and is reported once the pull has finished', async () => {
    const db = await makeDb();
    const engine = new SyncEngine({ db, transport: pullOf({ transaction: [txn()] }) });

    const result = await engine.pullOnce();
    assert.equal(result.dangling, 1, 'the broken reference was not noticed');

    const noted = await db.adapter.query('diagnostics', {});
    const one = noted.find((e) => e.kind === 'reference');
    assert.ok(one, `no reference diagnostic: ${noted.map((e) => e.kind).join(', ')}`);
    assert.equal(one.entity, 'transaction');
    assert.equal(one.where, 'sync.pull');
    // The field, so a run of them groups by which reference keeps breaking.
    // This was `broken[0].field`, which is not a key of that row shape, so the
    // code was always empty and the grouping was silently useless — the
    // typechecker caught it and this is what would have.
    assert.equal(one.code, 'account');
  });

  test('but an out-of-order arrival in the same pull is not reported', async () => {
    /*
     * The case the exemption exists for, and the one that decides whether
     * this check is worth having. The transaction names an account that
     * arrives in the same pull — listed after it, which is the order that
     * would have made a per-row check complain.
     *
     * Checking after the pull rather than during it is the whole difference:
     * by then the account is here, and there is nothing to report.
     */
    const db = await makeDb();
    const account = {
      id: 'acc_1', rev: 1, origin: 'dev_b', createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: 'p1', updatedAt: '2025-01-02T00:00:00.000Z', updatedBy: 'p1',
      deletedAt: null, schemaVersion: 1,
      name: 'HDFC Savings', kind: 'savings', institution: 'HDFC Bank',
    };
    const engine = new SyncEngine({
      db,
      // The transaction first, its account second.
      transport: pullOf({ transaction: [txn({ account: 'acc_1' })], account: [account] }),
    });

    const result = await engine.pullOnce();

    assert.equal(result.pulled, 2);
    assert.equal(result.dangling, 0, 'a legitimate out-of-order arrival was reported as broken');
    const noted = await db.adapter.query('diagnostics', {});
    assert.equal(noted.filter((e) => e.kind === 'reference').length, 0);
  });

  test('and it reports what the pull brought, not what was already broken', async () => {
    /*
     * Scoping the audit to the rows the pull applied is not only about cost,
     * though a scan that grows with the household's whole history while the
     * thing it looks for grows with the size of one pull is a check somebody
     * eventually turns off.
     *
     * It is also the right answer. Breakage that was already on the device is
     * not news about this sync, and reporting it on every pull would put a
     * permanent mark on the activity card — which is how a card stops being
     * read. Settings → Data → Check for broken links is where the whole
     * database is examined, on request.
     *
     * Added because swapping `danglingAmong` for `danglingReferences` changed
     * no test: both find the same broken reference, and only this tells them
     * apart.
     */
    const db = await makeDb();
    // Already here, and nothing to do with the pull that follows.
    await db.adapter.write('transaction', {
      id: 'old', rev: 1, origin: 'dev_a', createdAt: '2024-01-01T00:00:00.000Z',
      createdBy: 'p1', updatedAt: '2024-01-01T00:00:00.000Z', updatedBy: 'p1',
      deletedAt: null, schemaVersion: 1, syncState: 'synced',
      date: '2024-01-01', amount: 500, direction: 'out', account: 'acc_long_gone',
    });

    const account = {
      id: 'acc_2', rev: 1, origin: 'dev_b', createdAt: '2025-01-01T00:00:00.000Z',
      createdBy: 'p1', updatedAt: '2025-01-02T00:00:00.000Z', updatedBy: 'p1',
      deletedAt: null, schemaVersion: 1, name: 'HDFC Savings', kind: 'savings',
    };
    const engine = new SyncEngine({ db, transport: pullOf({ account: [account] }) });

    const result = await engine.pullOnce();

    assert.equal(result.dangling, 0,
      'the pull reported a broken reference it did not bring');
    assert.length((await db.adapter.query('diagnostics', {}))
      .filter((e) => e.kind === 'reference'), 0);

    // And the on-request audit still finds it, because it really is broken.
    assert.ok((await db.danglingReferences()).length > 0,
      'the pre-existing breakage vanished, so this proves nothing');
  });

  test('and a pull that brings nothing says nothing', async () => {
    // No rows, no scan: the check must not cost anything on the common case
    // of a sync that had nothing to fetch.
    const db = await makeDb();
    const engine = new SyncEngine({ db, transport: pullOf({}) });

    const result = await engine.pullOnce();
    assert.equal(result.dangling, 0);
    assert.length(await db.adapter.query('diagnostics', {}), 0);
  });
});
