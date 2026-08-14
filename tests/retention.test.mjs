/**
 * Retention — how long a deletion is held open, and what erasing reaches.
 *
 * The guard checked hardest here is that retention only ever governs records
 * somebody already deleted. A retention policy that could reach a live record
 * would be a scheduled data-loss bug with a respectable name.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import {
  POLICIES, policyFor, schedule, eligible, purgeable, purge,
} from '../js/data/retention.js';

setSuite('retention');

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY).toISOString();

describe('which policy applies', () => {
  test('a secret is erased soonest, not latest', () => {
    // Every extra day a deleted password sits in IndexedDB is a day it can be
    // read off a stolen laptop.
    assert.equal(policyFor('vaultItem').name, 'secret');
    assert.equal(policyFor('vaultItem').days, 7);
  });

  test('money is kept for years', () => {
    assert.equal(policyFor('transaction').name, 'financial');
    assert.ok(policyFor('transaction').days > 2000);
  });

  test('identity and health are never aged out', () => {
    assert.equal(policyFor('healthRecord').days, null);
    assert.equal(policyFor('identityDocument').days, null);
  });

  test('everything else gets long enough to undo a mistake', () => {
    assert.equal(policyFor('note').name, 'standard');
    assert.equal(policyFor('task').days, 90);
  });

  test('every entity has a policy, and every policy explains itself', () => {
    const rows = schedule();
    assert.ok(rows.length >= 30);
    for (const row of rows) {
      assert.ok(POLICIES[row.name], `${row.entity} has an unknown policy ${row.name}`);
      assert.ok(row.why, `${row.entity} has a policy with no reason`);
    }
  });
});

describe('eligibility', () => {
  test('a live record is never eligible, however old', () => {
    // The guard that matters. Retention governs how long a *deletion* is held
    // open for second thoughts. It is not a licence to remove things somebody
    // still has.
    assert.not(eligible('note', { id: 'n', createdAt: daysAgo(4000) }));
    assert.not(eligible('note', { id: 'n', deletedAt: null }));
  });

  test('a deletion inside its window is not eligible', () => {
    assert.not(eligible('note', { deletedAt: daysAgo(30) }));
  });

  test('past the window it is', () => {
    assert.ok(eligible('note', { deletedAt: daysAgo(120) }));
  });

  test('a never-aged entity is never eligible', () => {
    assert.not(eligible('healthRecord', { deletedAt: daysAgo(40_000) }));
  });

  test('an unparseable date is not eligible rather than treated as ancient', () => {
    // `Date.parse` of nonsense is NaN, and NaN comparisons are false — but
    // relying on that by accident is how a record gets erased because a field
    // was malformed.
    assert.not(eligible('note', { deletedAt: 'not a date' }));
  });
});

describe('planning a purge', () => {
  test('nothing recent is offered', async () => {
    const db = await makeDb();
    const note = await db.repo('note').create({ title: 'x', body: 'y' });
    await db.repo('note').remove(note.id);

    assert.equal((await purgeable(db)).total, 0);
  });

  test('what is past its window is offered, and counted', async () => {
    const db = await makeDb();
    const note = await db.repo('note').create({ title: 'x', body: 'y' });
    await db.repo('note').remove(note.id);

    const plan = await purgeable(db, Date.now() + 200 * DAY);
    assert.equal(plan.total, 1);
    assert.equal(plan.entities[0].entity, 'note');
  });

  test('every plan says what erasing cannot reach', async () => {
    // Not buried in a document. Somebody about to erase something is entitled
    // to know that another device still has it.
    const plan = await purgeable(await makeDb());
    assert.ok(plan.cannotReach.length >= 3);
    assert.ok(plan.cannotReach.some((s) => /other device/i.test(s)));
  });

  test('planning erases nothing', async () => {
    const db = await makeDb();
    const note = await db.repo('note').create({ title: 'x', body: 'y' });
    await db.repo('note').remove(note.id);

    await purgeable(db, Date.now() + 200 * DAY);
    assert.length(await db.repo('note').list({ includeDeleted: true }), 1);
  });
});

describe('purging', () => {
  test('the row and its search entry go together', async () => {
    const db = await makeDb();
    const note = await db.repo('note').create({ title: 'findable', body: 'y' });
    await db.repo('note').remove(note.id);

    // The index entry goes at *soft delete*, not at purge — which is worth
    // locking down here, because it is the reason a deleted record stops being
    // findable long before it stops existing.
    //
    // An earlier version of this test asserted only that the entry was absent
    // after purging. That passed whether or not `purge` touched the index at
    // all, because it was already gone — mutation-testing caught it agreeing
    // with itself. The assertion below is the one that has content.
    await db.repo('note').restore(note.id);
    assert.ok(await db.adapter.read('search', `note:${note.id}`),
      'a live note should be findable');

    await db.repo('note').remove(note.id);
    assert.not(await db.adapter.read('search', `note:${note.id}`),
      'a soft delete should already have removed it from the index');

    const result = await purge(db, await purgeable(db, Date.now() + 200 * DAY));

    assert.equal(result.purged, 1);
    assert.length(await db.repo('note').list({ includeDeleted: true }), 0);
    assert.not(await db.adapter.read('search', `note:${note.id}`));
  });

  test('a live record beside an eligible one survives', async () => {
    const db = await makeDb();
    const gone = await db.repo('note').create({ title: 'gone', body: '' });
    await db.repo('note').create({ title: 'kept', body: '' });
    await db.repo('note').remove(gone.id);

    await purge(db, await purgeable(db, Date.now() + 200 * DAY));

    const left = await db.repo('note').list({});
    assert.length(left, 1);
    assert.equal(left[0].title, 'kept');
  });

  test('an entity outside its window is untouched', async () => {
    const db = await makeDb();
    const account = await db.repo('account').create({ name: 'A', kind: 'savings' });
    const txn = await db.repo('transaction').create({
      date: '2020-01-01', kind: 'expense', amount: 100, account: account.id,
      category: 'other', payee: 'old', tags: [],
    });
    await db.repo('transaction').remove(txn.id);

    // A year later a financial record is nowhere near its seven years.
    await purge(db, await purgeable(db, Date.now() + 400 * DAY));
    assert.length(await db.repo('transaction').list({ includeDeleted: true }), 1);
  });

  test('progress is reported', async () => {
    const db = await makeDb();
    for (const title of ['a', 'b']) {
      const n = await db.repo('note').create({ title, body: '' });
      await db.repo('note').remove(n.id);
    }
    const steps = [];
    await purge(db, await purgeable(db, Date.now() + 200 * DAY),
      (done, total) => steps.push(`${done}/${total}`));
    assert.deep(steps, ['1/2', '2/2']);
  });

  test('an empty plan is a no-op, not a crash', async () => {
    const db = await makeDb();
    assert.equal((await purge(db, await purgeable(db))).purged, 0);
    assert.equal((await purge(db, null)).purged, 0);
  });
});
