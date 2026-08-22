import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { SyncEngine } from '../js/sync/engine.js';
import { FakeTransport } from '../js/sync/transport.js';
import {
  redact, event, record, recent, summarise, KIND, LIMIT, STORE,
} from '../js/data/diagnostics.js';

setSuite('diagnostics');

/* ---------------------------------------------------------------- redaction */

describe('taking the values out of a message', () => {
  test('a figure never survives', () => {
    const out = redact('could not write transaction of Rs 50,000.00 to a/c XX8963');
    assert.not(/50,000/.test(out), out);
    assert.not(/8963/.test(out), out);
  });

  test('nor an address, a UPI handle or an email', () => {
    assert.not(/asha/.test(redact('failed to notify asha@example.com')));
    assert.not(/landlord/.test(redact('paid to landlord@okicici')));
  });

  test('nor anything somebody put in quotes', () => {
    // The quoted part of a message is, by construction, the bit that came
    // from the data.
    const out = redact('unknown category "School fees — Meera"');
    assert.not(/Meera/.test(out), out);
    assert.not(/School/.test(out), out);
  });

  test('a record id keeps its type and loses which record', () => {
    // `per_` is a fact about the shape of the problem. The rest is a pointer
    // at a person.
    const out = redact('no such record per_01M0M7T0Q85FDE3QYFKAB2WF6E');
    assert.includes(out, 'per_');
    assert.not(/01M0M7T0/.test(out), out);
  });

  test('and a token or a hash becomes opaque', () => {
    assert.not(/a1b2c3d4e5f6a7b8/.test(redact('bad signature a1b2c3d4e5f6a7b8')));
  });

  test('but a small count survives, because it says what happened and is not data', () => {
    // "2 of 5 failed" has to stay readable or the record answers nothing.
    assert.includes(redact('2 of 5 entries failed'), '2 of 5');
  });

  test('what is left still says what went wrong', () => {
    const out = redact('validation failed for transaction "Rent — Meera" of Rs 45,000');
    assert.includes(out, 'validation failed');
    assert.includes(out, 'transaction');
  });

  test('a huge message is cut rather than stored whole', () => {
    assert.ok(redact('x'.repeat(5000)).length <= 301);
  });

  test('and nothing throws on the shapes that are not strings', () => {
    for (const value of [null, undefined, 0, {}, []]) {
      assert.equal(typeof redact(value), 'string');
    }
  });
});

/* ------------------------------------------------------------------ events */

describe('what an event holds', () => {
  test('where and code are kept as written, because this codebase wrote them', () => {
    const e = event({
      kind: KIND.error, where: 'repository.write', code: 'validation', entity: 'transaction',
      message: 'amount 50000 is invalid',
    });
    assert.equal(e.where, 'repository.write');
    assert.equal(e.code, 'validation');
    assert.equal(e.entity, 'transaction');
    assert.not(/50000/.test(e.message), e.message);
  });

  test('two events in the same millisecond still have an order', () => {
    const at = '2026-08-22T10:00:00.000Z';
    const a = event({ kind: KIND.error, at });
    const b = event({ kind: KIND.error, at });
    assert.not(a.id === b.id, 'two events collided');
  });
});

/* ------------------------------------------------------------- the store */

describe('recording', () => {
  test('an event is kept and read back newest first', async () => {
    const db = await makeDb();
    await record(db.adapter, { kind: KIND.sync, where: 'sync.run', at: '2026-08-01T00:00:00.000Z' });
    await record(db.adapter, { kind: KIND.error, where: 'repository.write', at: '2026-08-02T00:00:00.000Z' });

    const rows = await recent(db.adapter);
    assert.length(rows, 2);
    assert.equal(rows[0].where, 'repository.write');
  });

  test('the store is bounded, and the oldest go', async () => {
    const db = await makeDb();
    for (let i = 0; i < 8; i += 1) {
      await record(db.adapter,
        { kind: KIND.error, where: `w${i}`, at: `2026-08-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` },
        { limit: 5 });
    }

    const rows = await recent(db.adapter, { limit: 100 });
    assert.length(rows, 5);
    assert.not(rows.some((r) => r.where === 'w0'), 'the oldest event was kept');
    assert.ok(rows.some((r) => r.where === 'w7'), 'the newest event was dropped');
  });

  test('recording never throws, whatever the adapter does', async () => {
    // A diagnostics write that broke the operation it describes would turn one
    // failure into two, and the second would be this module's fault.
    const broken = {
      write: async () => { throw new Error('the disk went away'); },
      query: async () => { throw new Error('the disk went away'); },
      remove: async () => { throw new Error('the disk went away'); },
    };
    assert.equal(await record(broken, { kind: KIND.error }), null);
  });
});

/* ------------------------------------------------------------ the summary */

describe('what it adds up to', () => {
  const at = (day) => `2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`;
  const now = '2026-08-22T00:00:00.000Z';

  test('a run of the same failure is what gets reported', async () => {
    // The question this exists to answer: not "what happened" but "has this
    // been happening".
    const events = [
      event({ kind: KIND.sync, code: 'http-503', at: at(20) }),
      event({ kind: KIND.sync, code: 'http-503', at: at(21) }),
      event({ kind: KIND.sync, code: 'http-503', at: at(22) }),
      event({ kind: KIND.error, code: 'validation', at: at(22) }),
    ];

    const out = summarise(events, { now, days: 7 });
    assert.equal(out.total, 4);
    assert.equal(out.byKind[KIND.sync], 3);
    assert.equal(out.repeated[0].key, 'sync:http-503');
    assert.equal(out.repeated[0].count, 3);
  });

  test('and a one-off is not', async () => {
    const out = summarise([event({ kind: KIND.error, code: 'validation', at: at(22) })],
      { now, days: 7 });
    assert.length(out.repeated, 0);
  });

  test('events outside the window are left out', async () => {
    const out = summarise([
      event({ kind: KIND.error, at: at(1) }),
      event({ kind: KIND.error, at: at(22) }),
    ], { now, days: 7 });
    assert.equal(out.total, 1);
    assert.equal(out.held, 2, 'and what is held is still reported');
  });

  test('a full store is reported as full, so "nothing recently" is readable', async () => {
    // An empty record and a trimmed one are different situations, and a
    // household reading "nothing in the last week" is entitled to know which.
    const many = Array.from({ length: LIMIT }, (_, i) => event({ kind: KIND.error, at: at(22) }));
    assert.ok(summarise(many, { now }).full);
    assert.not(summarise([], { now }).full);
  });
});

/* ------------------------------------------- through the real failure paths */

describe('a real failure, through the real code', () => {
  /** Every value in the diagnostics store, flattened. */
  async function dump(db) {
    const rows = await db.adapter.query(STORE, {}).catch(() => []);
    return rows.map((r) => JSON.stringify(r)).join(' ');
  }

  test('a refused write is recorded, where before it left no trace', async () => {
    // Measured before this was built: the write failed and nothing anywhere
    // knew afterwards.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    let threw = false;
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 50_000_00, direction: 'out',
        description: 'Rent to landlord@okicici', account: 'acc_does_not_exist',
      });
    } catch { threw = true; }
    assert.ok(threw);

    const rows = await recent(db.adapter);
    assert.ok(rows.length >= 1, 'a failed write left no trace');
    assert.equal(rows[0].where, 'repository.create');
    assert.equal(rows[0].entity, 'transaction');
  });

  test('and none of the record that caused it reaches the store', async () => {
    // The whole safety argument, driven rather than asserted against a
    // fixture: a real error message from a real refusal, then a walk of what
    // was actually kept.
    const db = await makeDb();
    const account = await makeAccount(db, { name: 'HDFC Savings' });
    const asha = await makePerson(db, { name: 'Asha' });

    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 50_000_00, direction: 'out',
        description: 'Rent to landlord@okicici for Meera',
        account: 'acc_gone', person: asha.id,
      });
    } catch { /* expected */ }

    const kept = await dump(db);
    for (const secret of ['landlord@okicici', 'Meera', '50000', 'acc_gone', account.id, asha.id]) {
      assert.not(kept.includes(secret), `${secret} reached the diagnostics store`);
    }
  });

  test('a rule saying no is a refusal, not an error', async () => {
    // The two need telling apart. A run of refusals means somebody is fighting
    // the application — a form that will not accept what they are trying to
    // record. A run of errors means the application is broken. Filing both as
    // "error" would make the first invisible and the second look worse than
    // it is.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 1, direction: 'out',
        description: 'x', account: 'acc_missing',
      });
    } catch { /* expected */ }

    const [row] = await recent(db.adapter);
    assert.equal(row.kind, KIND.refusal, `filed as ${row.kind}`);
  });

  test('but a broken write is an error', async () => {
    const db = await makeDb();
    const real = db.adapter.tx.bind(db.adapter);

    // Only the person write fails. Breaking `tx` outright also breaks the
    // diagnostics write — the memory adapter goes through `tx` too — and
    // `record` then correctly swallows it and stores nothing, which would
    // make this test measure the sabotage rather than the code.
    db.adapter.tx = async (stores, mode, fn) => {
      if (stores.includes('person')) throw new Error('the disk went away');
      return real(stores, mode, fn);
    };

    let threw = false;
    try { await makePerson(db, { name: 'Asha' }); } catch { threw = true; }
    db.adapter.tx = real;
    assert.ok(threw, 'the write was meant to fail');

    const [row] = await recent(db.adapter);
    assert.ok(row, 'a broken write left no trace');
    assert.equal(row.kind, KIND.error, `filed as ${row.kind}`);
  });

  test('the failure still fails — recording is not swallowing', async () => {
    const db = await makeDb();
    let threw = false;
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 1, direction: 'out',
        description: 'x', account: 'acc_missing',
      });
    } catch { threw = true; }
    assert.ok(threw, 'the write was refused and then reported as fine');
  });

  test('a successful write records nothing', async () => {
    // A log that fills up when everything is working is a log nobody reads.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    assert.length(await recent(db.adapter), 0);
  });

  test('a sync that fails is recorded, so a bad week is tellable from a bad minute', async () => {
    // `lastError` holds the most recent one and is overwritten by the next.
    // Until this existed, a sync failing every day for a week and a sync
    // failing once looked identical the moment somebody reloaded.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    // No handlers at all, so every action rejects — the shape a backend that
    // is down actually has from here.
    const engine = new SyncEngine({ db, transport: new FakeTransport() });
    const result = await engine.run();

    assert.ok(result.error, 'the sync was meant to fail');

    const rows = await recent(db.adapter);
    const sync = rows.find((r) => r.kind === KIND.sync);
    assert.ok(sync, 'a failed sync left no trace');
    assert.equal(sync.where, 'sync.run');
    assert.includes(sync.code, '501');
  });

  test('and a run of them is what the summary reports', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    const engine = new SyncEngine({ db, transport: new FakeTransport() });

    await engine.run();
    await engine.run();
    await engine.run();

    const out = summarise(await recent(db.adapter, { limit: 100 }));
    assert.ok(out.repeated.some((r) => r.key.startsWith('sync:') && r.count === 3),
      JSON.stringify(out.repeated));
  });

  test('the store does not sync and is not an entity', async () => {
    // It holds what is left after redaction, which should be nothing worth
    // sending — and sending it anyway would make this the telemetry the
    // module says it is not.
    const { entities } = await import('../js/data/schema.js');
    assert.not(Object.keys(entities).includes(STORE));

    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    try {
      await db.repo('transaction').create({
        date: '2026-08-22', amount: 1, direction: 'out', description: 'x', account: 'no',
      });
    } catch { /* expected */ }

    const outbox = await db.adapter.query('outbox', {});
    assert.not(outbox.some((o) => o.store === STORE), 'a diagnostic was queued for sync');
  });
});
