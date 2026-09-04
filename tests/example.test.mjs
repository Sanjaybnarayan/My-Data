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
import { entity } from '../js/data/schema.js';
import { formats } from '../js/data/formats.js';
import { exampleStrings } from '../js/locale/en-example.js';
import { expiryReminders } from '../js/domain/reminders.js';
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

  test('loads onto a household that has only the row the app made itself', async () => {
    /*
     * The regression this feature could not survive.
     *
     * `resolveActor` in `js/app.js` creates a person named *You* on the first
     * unlock, so by the time anybody reaches Settings there is exactly one
     * person — and the old check refused any household with people at all.
     * Measured on the real screens: install answered `{loaded: false,
     * people: 1}` immediately after enrolment and every section stayed empty.
     * 272 records that nobody could ever load.
     */
    const db = await makeDb({ personId: 'per_owner' });
    const owner = await db.repo('person').create({
      name: 'You', role: 'owner', relationship: 'self',
    });
    db.setActor({ personId: owner.id, role: 'owner' });

    const out = await new ExampleService(db).install();
    assert.ok(out.loaded, 'the owner row the app wrote is not a household with data in it');
    assert.ok(out.count > 250, `only ${out.count} records were written`);
    assert.ok((await db.repo('staff').list({ limit: 50 })).length > 0);
  });

  test('and still refuses when that row is somebody else, or has anything beside it', async () => {
    // Two halves, because the id check and the sweep fail on different things.
    const stranger = await makeDb({ personId: 'per_owner' });
    await makePerson(stranger, { name: 'Somebody real' });
    assert.not((await new ExampleService(stranger).install()).loaded,
      'a person who is not this device owner is a household with data in it');

    const withRecord = await makeDb({ personId: 'per_owner' });
    const owner = await withRecord.repo('person').create({
      name: 'You', role: 'owner', relationship: 'self',
    });
    withRecord.setActor({ personId: owner.id, role: 'owner' });
    // One vehicle and nothing else — the shape a check that counted only
    // people would have written an invented family in beside.
    await withRecord.repo('vehicle').create({
      name: 'Hatchback', kind: 'car', registration: 'KA01AB1234',
    });
    const out = await new ExampleService(withRecord).install();
    assert.not(out.loaded, 'one typed-in record is enough to refuse');
    assert.equal(await loadedExample(withRecord), null);
  });

  test('the sentence offering it counts what the plan actually writes', () => {
    /*
     * The copy on the Settings card names four figures, and three of them had
     * been right for as long as nobody changed the plan. Adding a cook and a
     * driver made it say *"Six people"* about a household of eight — a number
     * on a screen, describing invented records, that was itself wrong.
     *
     * `tools/self-description.mjs` already refuses a *document* whose numbers
     * have gone stale. This is the same rule for the one piece of UI copy that
     * makes counting claims, derived from the plan rather than typed here, so
     * the next person to add a person is told rather than trusted.
     */
    const words = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
      nine: 9, ten: 10, eleven: 11, twelve: 12,
    };
    const said = (word) => {
      const n = words[word];
      assert.ok(n !== undefined, `the copy says "${word}", which this test cannot count`);
      return n;
    };

    const rows = (name) => plan().filter((step) => step.entity === name)
      .reduce((n, step) => n + step.rows.length, 0);

    const body = exampleStrings['example.load.body'];
    const claimed = body.match(/^(\w+) people, (\w+) savings accounts, (\w+) cars, (\w+) /);
    assert.ok(claimed, `the copy no longer has the shape this test reads: ${body.slice(0, 60)}`);

    assert.equal(said(claimed[1].toLowerCase()), rows('person'), 'people');
    assert.equal(said(claimed[2].toLowerCase()), rows('account'), 'savings accounts');
    assert.equal(said(claimed[3].toLowerCase()), rows('vehicle'), 'cars');
    assert.equal(said(claimed[4].toLowerCase()), rows('policy'), 'insurance policies');
  });

  test('a refusal counts records, because it is no longer counting only people', async () => {
    /*
     * The message used to read *"already has {count} people in it"*, and the
     * check behind it only ever counted people. Now that occupancy is a sweep
     * of every entity, one person and one vehicle refuse with a count of two —
     * and there is one person. Saying "records" is what makes the number true.
     */
    const db = await makeDb({ personId: 'per_owner' });
    const owner = await db.repo('person').create({
      name: 'You', role: 'owner', relationship: 'self',
    });
    db.setActor({ personId: owner.id, role: 'owner' });
    await db.repo('vehicle').create({
      name: 'Hatchback', kind: 'car', registration: 'KA01AB1234',
    });

    const out = await new ExampleService(db).install();
    assert.not(out.loaded);
    assert.equal(out.people, 2, 'one person and one vehicle are two records');
    assert.length(await db.repo('person').list({ limit: 50 }), 1, 'and only one is a person');
    assert.not(/people/.test(exampleStrings['example.refused']),
      'the sentence must not call that number a count of people');
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
    // Derived from the plan, not typed: this said 52 for as long as the
    // example held 52 records, which is exactly as long as such a number is
    // ever right.
    assert.equal(meta.ids.length, plan().reduce((n, s) => n + s.rows.length, 0));
    for (const person of ids) {
      assert.ok(meta.ids.some((row) => row.id === person.id),
        'every person written is in the record of what to remove');
    }
  });

  test('every record says on itself that it is an example', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    // Only where there is somewhere to say it: `project` has no `notes`
    // field, and asserting against a field the schema does not declare would
    // be a test about this test rather than about the records.
    for (const step of plan()) {
      if (!entity(step.entity).fields.some((f) => f.key === 'notes')) continue;
      for (const row of await db.repo(step.entity).list({ limit: 500 })) {
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
    test(`has something for the reminders screen, ${when}`, () => {
      /*
       * Read from `plan(clock)` rather than by installing it. A transaction
       * dated more than a year ahead is refused by `validate.js` against the
       * *real* today — rightly, since a far-future transaction is a typo — so
       * installing at a clock a decade on cannot work and should not. What is
       * under test is the dates the plan produces, and those are right here.
       */
      const rowsOf = (name) => plan(clock).find((s) => s.entity === name)?.rows ?? [];
      const due = expiryReminders({
        vehicle: rowsOf('vehicle'),
        policy: rowsOf('policy'),
        identityDocument: rowsOf('identityDocument'),
      }, { clock });

      assert.ok(due.length >= 5, `only ${due.length} reminders — the screen would look broken`);
      assert.ok(due.some((r) => r.days < 0), 'one thing has lapsed, so the overdue state is shown');
      assert.ok(due.some((r) => r.days >= 0), 'and something is merely coming up');
    });

    test(`keeps the same six ages, ${when}`, () => {
      const year = Number(new Date(clock()).toISOString().slice(0, 4));
      const people = /** @type {Array<{name: string, birthday: string}>} */ (
        /** @type {unknown} */ (plan(clock).find((s) => s.entity === 'person').rows));
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

describe('every reference the example writes points at something', () => {
  /*
   * The plan is a topological sort kept by hand — a row naming a person has to
   * be written after that person exists — and the transactions name their
   * account by *position* in the twelve, which is a reference nothing checks.
   * This checks it: a dangling ref here would be the exact thing the write
   * path refuses and `SyncEngine#noteDangling` reports on a pull.
   */
  test('across every entity the plan writes', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    /** @type {Map<string, Set<string>>} */
    const known = new Map();
    for (const step of plan()) {
      const rows = await db.repo(step.entity).list({ limit: 500 });
      known.set(step.entity, new Set(rows.map((r) => r.id)));
    }

    const dangling = [];
    for (const step of plan()) {
      const def = entity(step.entity);
      for (const row of await db.repo(step.entity).list({ limit: 500 })) {
        for (const field of def.fields) {
          const value = row[field.key];
          if (!value) continue;
          const target = field.ref;
          if (!target) continue;
          const pool = known.get(target);
          if (!pool) continue;
          for (const one of Array.isArray(value) ? value : [value]) {
            if (!pool.has(one)) dangling.push(`${step.entity}.${field.key} -> ${one}`);
          }
        }
      }
    }
    assert.deep(dangling, [], `dangling: ${dangling.slice(0, 5).join(', ')}`);
  });

  test('and every transaction is on an account of the person paying', async () => {
    const db = await makeDb();
    await new ExampleService(db).install();

    const accounts = new Set((await db.repo('account').list({ limit: 50 })).map((a) => a.id));
    const rows = await db.repo('transaction').list({ limit: 500 });
    assert.ok(rows.length > 50, `only ${rows.length} transactions — Finance would look bare`);
    for (const t of rows) {
      assert.ok(accounts.has(t.account), 'a transaction names an account that exists');
      if (t.kind === 'transfer') assert.ok(accounts.has(t.toAccount), 'and a transfer names both ends');
    }
  });
});
