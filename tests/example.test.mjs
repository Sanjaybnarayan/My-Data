/**
 * The example household, and the three promises it makes.
 *
 * It is invented data in an application whose brief forbids fabricating
 * things, so the licence for it is narrow and these hold the edges of it: it
 * goes in through the real write path, it never touches a household that has
 * records, and it comes out again completely.
 */

import { test, describe, assert, setSuite, fakeClock } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import { ExampleService, loadedExample } from '../js/services/example.js';
import { plan, META_KEY } from '../js/domain/example.js';
import { formats } from '../js/data/formats.js';
import { expiryReminders } from '../js/domain/reminders.js';
import { exampleStrings } from '../js/locale/en-example.js';
import { strings as english } from '../js/locale/en.js';

setSuite('example');

describe('the example household', () => {
  test('writes every record in the plan, through the repository', async () => {
    const db = await makeDb();
    const out = await new ExampleService(db).install();

    const expected = plan().reduce((n, step) => n + step.rows.length, 0);
    assert.ok(out.loaded, 'it should have loaded');
    assert.equal(out.count, expected);

    for (const step of plan()) {
      const rows = await db.repo(step.entity).list({ limit: 200 });
      assert.equal(rows.length, step.rows.length, `${step.entity} count`);
    }
  });

  test('resolves the references between them to real ids', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    const people = await db.repo('person').list({ limit: 50 });
    const ids = new Set(people.map((p) => p.id));

    for (const account of await db.repo('account').list({ limit: 50 })) {
      assert.ok(ids.has(account.holder), `account ${account.name} points at a real person`);
    }
    for (const doc of await db.repo('identityDocument').list({ limit: 50 })) {
      assert.ok(ids.has(doc.person), 'every identity document points at a real person');
    }

    const vehicles = await db.repo('vehicle').list({ limit: 10 });
    const vehicleIds = new Set(vehicles.map((v) => v.id));
    for (const policy of await db.repo('policy').list({ limit: 20 })) {
      assert.ok(ids.has(policy.holder), 'every policy has a real holder');
      for (const person of policy.insured ?? []) {
        assert.ok(ids.has(person), 'every insured person is a real person');
      }
      if (policy.kind === 'vehicle') {
        assert.ok(vehicleIds.has(policy.vehicle), 'a motor policy names a real vehicle');
      }
    }
  });

  test('is refused by a household that already has people, and writes nothing', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Somebody real' });

    const out = await new ExampleService(db).install();
    assert.not(out.loaded, 'it must not load onto an occupied household');
    assert.equal(out.people, 1, 'and it says how many people stopped it');

    assert.length(await db.repo('person').list({ limit: 50 }), 1);
    assert.length(await db.repo('account').list({ limit: 50 }), 0);
    assert.length(await db.repo('identityDocument').list({ limit: 50 }), 0);
    assert.equal(await loadedExample(db), null, 'and nothing is recorded as loaded');
  });

  test('comes out again, leaving nothing behind', async () => {
    const db = await makeDb();
    const service = new ExampleService(db);
    await service.install();

    const out = await service.remove();
    assert.equal(out.removed, plan().reduce((n, s) => n + s.rows.length, 0));

    for (const step of plan()) {
      assert.length(await db.repo(step.entity).list({ limit: 200 }), 0, step.entity);
    }
    assert.equal(await db.meta(META_KEY), null, 'the marker goes too');
  });

  test('removal is derived from what was written, not from what looks invented', async () => {
    const db = await makeDb();
    const service = new ExampleService(db);
    await service.install();

    const meta = await loadedExample(db);
    const ids = await db.repo('person').list({ limit: 50 });
    assert.equal(meta.ids.length, 52);
    for (const person of ids) {
      assert.ok(meta.ids.some((row) => row.id === person.id),
        'every person written is in the record of what to remove');
    }
  });

  test('every record says on itself that it is an example', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    for (const step of plan()) {
      for (const row of await db.repo(step.entity).list({ limit: 200 })) {
        assert.equal(row.notes, exampleStrings['example.note'],
          `${step.entity} carries the sentence`);
      }
    }
  });
});

describe('the example household invents no identifier that could be real', () => {
  /*
   * The point of the whole exercise. A demonstration is worth nothing if the
   * numbers in it might belong to somebody.
   */
  test('there is no Aadhaar, because no Aadhaar can be safely invented', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    const docs = await db.repo('identityDocument').list({ limit: 50, decrypt: true });
    assert.ok(docs.length > 0, 'there are identity documents to check');
    assert.not(docs.some((d) => d.kind === 'Aadhaar'),
      'the validator enforces the real Aadhaar rule, so any it accepts could be a real one');
  });

  test('and the numbers it does carry are in series nobody is issued', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    const docs = await db.repo('identityDocument').list({ limit: 50, decrypt: true });
    const of = (kind) => docs.filter((d) => d.kind === kind);

    assert.ok(of('PAN').length > 0, 'there are PANs');
    for (const doc of of('PAN')) {
      assert.ok(doc.number.startsWith('ZZZ'), `${doc.kind} uses the unissued series`);
      // Still the right shape, so the screens that show one have something real
      // to draw — an identifier that fails its own format teaches nothing.
      assert.ok(formats.PAN.test(doc.number), 'and is still a well-formed PAN');
    }
    for (const doc of of('Voter ID')) assert.ok(doc.number.startsWith('ZZZ'));
    for (const doc of of('Passport')) assert.ok(doc.number.startsWith('Z0'));
    for (const doc of of('Driving licence')) assert.ok(doc.number.startsWith('KA00'));
  });
});

describe('the example text is a catalogue, and stays out of the UI one', () => {
  /*
   * Spreading these into `en.js` pushed the UI catalogue past the whole schema
   * label set and broke `tests/locale.test.mjs`'s "labels should dominate" —
   * a measurement of how translated the *interface* is, moved by a
   * demonstration family getting names. This holds them apart.
   */
  test('none of the example keys is in the interface catalogue', () => {
    const leaked = Object.keys(exampleStrings).filter((key) => key in english);
    assert.deep(leaked, [], `example keys in the UI catalogue: ${leaked.join(', ')}`);
  });

  test('and every key the records ask for is defined', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();
    // `text()` throws on a missing key, so a load that completed is the proof;
    // this states it so a reader does not have to know that.
    assert.ok(Object.keys(exampleStrings).length > 0);
  });
});

describe('the example household stays coherent whenever it is loaded', () => {
  /*
   * The first version used fixed dates, and they rotted in both directions.
   * Forward: every expiry sat outside its own `expiryLead`, so the reminders
   * screen — one of the things a person most wants to look at — was empty, and
   * the assistant's "what is expiring?" had nothing to answer. Backward: a son
   * born on a fixed date is fifteen now and twenty-five in ten years, still
   * filed as a child.
   *
   * Both are checked at two clocks a decade apart, because a demonstration
   * that only works this year is the same defect in slower motion.
   */
  /** @type {Array<[string, () => number]>} */
  const clocks = [
    ['this year', fakeClock(Date.parse('2026-08-30T09:00:00Z'))],
    ['a decade on', fakeClock(Date.parse('2036-02-11T09:00:00Z'))],
  ];

  for (const [when, clock] of clocks) {
    test(`has something for the reminders screen, ${when}`, async () => {
      const db = await makeDb();
      await new ExampleService(db).install({ clock });

      const due = expiryReminders({
        vehicle: await db.repo('vehicle').list({ limit: 10 }),
        policy: await db.repo('policy').list({ limit: 10 }),
        identityDocument: await db.repo('identityDocument').list({ limit: 30 }),
      }, { clock });

      assert.ok(due.length >= 5, `only ${due.length} reminders — the screen would look broken`);
      assert.ok(due.some((r) => r.days < 0), 'one thing has lapsed, so the overdue state is shown');
      assert.ok(due.some((r) => r.days >= 0), 'and something is merely coming up');
    });

    test(`keeps the same six ages, ${when}`, async () => {
      const db = await makeDb();
      await new ExampleService(db).install({ clock });

      const year = Number(new Date(clock()).toISOString().slice(0, 4));
      const people = await db.repo('person').list({ limit: 10 });
      const age = (name) => year - Number(
        people.find((p) => p.name.startsWith(name)).birthday.slice(0, 4));

      // A child who ages out of `role: child` is a demonstration that has
      // started contradicting itself.
      assert.equal(age('Vikram'), 15);
      assert.equal(age('Ananya'), 12);
      assert.equal(age('Ramesh'), 78);
    });
  }
});
