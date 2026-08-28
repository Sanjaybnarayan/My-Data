import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { tenancyFor, tenancyQuestions, TENANCY, CONSEQUENCE } from '../js/domain/tenancy.js';
import { taskContradictions, reachability, TASK, REACH } from '../js/domain/upkeep.js';
import { entities, modules } from '../js/data/schema.js';
import { strings } from '../js/locale/en.js';

setSuite('secondary');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('a tenancy recorded in two places', () => {
  const flat = {
    id: 'p1', name: 'Flat 3B', rented: true, tenantName: 'Ravi',
    monthlyRent: 3_500_000, leaseEndsOn: '2027-01-01',
  };

  test('the schema really does hold it twice', () => {
    /*
     * The premise. If either set of fields went away, every check below would
     * still pass on the empty case while measuring nothing.
     */
    const onProperty = entities.property.fields.map((f) => f.key);
    for (const key of ['rented', 'tenantName', 'tenantPhone', 'monthlyRent', 'leaseEndsOn']) {
      assert.includes(onProperty, key, `property.${key}`);
    }
    const onTenant = entities.tenant.fields.map((f) => f.key);
    for (const key of ['name', 'phone', 'monthlyRent', 'agreementEndsOn']) {
      assert.includes(onTenant, key, `tenant.${key}`);
    }
  });

  test('matching records raise nothing', () => {
    const tenant = {
      id: 't1', property: 'p1', name: 'Ravi', monthlyRent: 3_500_000,
      agreementEndsOn: '2027-01-01',
    };
    assert.equal(tenancyFor(flat, [tenant]).state, TENANCY.AGREE);
    assert.length(tenancyQuestions([flat], [tenant]), 0);
  });

  test('a different name is a question, not a merge', () => {
    // "Ravi" and "Ravi Kumar" may well be the same person. Deciding that is
    // not this application's to make — never force an uncertain match.
    const tenant = { id: 't1', property: 'p1', name: 'Ravi Kumar' };
    const out = tenancyFor(flat, [tenant]);
    assert.equal(out.state, TENANCY.DISAGREE);
    assert.equal(out.differences[0].field, 'name');
    assert.equal(out.differences[0].onProperty, 'Ravi');
    assert.equal(out.differences[0].onTenant, 'Ravi Kumar');
  });

  test('case and spacing are not a disagreement', () => {
    const tenant = { id: 't1', property: 'p1', name: '  ravi  ' };
    assert.equal(tenancyFor(flat, [tenant]).state, TENANCY.AGREE);
  });

  test('a blank on the tenant record is a gap, not a conflict', () => {
    // A screen that called every half-filled record a conflict would cry
    // wolf on all of them.
    const tenant = { id: 't1', property: 'p1', name: 'Ravi' };
    assert.equal(tenancyFor(flat, [tenant]).state, TENANCY.AGREE);
  });

  test('and so is a blank on the property', () => {
    const bare = { id: 'p1', rented: true };
    const tenant = { id: 't1', property: 'p1', name: 'Ravi', monthlyRent: 900 };
    assert.equal(tenancyFor(bare, [tenant]).state, TENANCY.AGREE);
  });

  test('agreeing with any one of several tenant records is enough', () => {
    // Last year's tenant still on file and this year's in a second record
    // agrees with one of them, and that is not a contradiction to raise.
    const old = { id: 't0', property: 'p1', name: 'Someone Else' };
    const now = { id: 't1', property: 'p1', name: 'Ravi' };
    assert.equal(tenancyFor(flat, [old, now]).state, TENANCY.AGREE);
  });

  test('only on the property means no reminder when the agreement ends', () => {
    const out = tenancyFor(flat, []);
    assert.equal(out.state, TENANCY.ONLY_PROPERTY);
    assert.includes(strings[CONSEQUENCE[out.state]].toLowerCase(), 'nothing warns');
  });

  test('only in a tenant record means no receipt and no total', () => {
    const bare = { id: 'p9', name: 'House' };
    const tenant = { id: 't9', property: 'p9', name: 'Anil', monthlyRent: 1_200_000 };
    const out = tenancyFor(bare, [tenant]);
    assert.equal(out.state, TENANCY.ONLY_TENANT);
    assert.includes(strings[CONSEQUENCE[out.state]].toLowerCase(), 'receipt');
  });

  test('a property that is not let is not a finding', () => {
    assert.equal(tenancyFor({ id: 'p3', name: 'Plot', rented: false }, []).state, TENANCY.NONE);
    assert.length(tenancyQuestions([{ id: 'p3', rented: false }], []), 0);
  });

  test('a deleted tenant record does not count as one', () => {
    const gone = { id: 't1', property: 'p1', name: 'Ravi', deletedAt: '2026-01-01' };
    assert.equal(tenancyFor(flat, [gone]).state, TENANCY.ONLY_PROPERTY);
  });

  test('a tenant record for another property is not this one', () => {
    assert.equal(tenancyFor(flat, [{ id: 't2', property: 'p2', name: 'X' }]).state,
      TENANCY.ONLY_PROPERTY);
  });

  test('disagreements come first, and every case has a consequence', () => {
    const rows = tenancyQuestions(
      [{ id: 'a', name: 'A', rented: true }, flat],
      [{ id: 't1', property: 'p1', name: 'Someone Else' }],
    );
    assert.equal(rows[0].state, TENANCY.DISAGREE);
    for (const row of rows) {
      assert.ok(strings[CONSEQUENCE[row.state]], `${row.state} has no sentence`);
      assert.ok(strings[`tenancy.state.${row.state}`], `${row.state} has no badge`);
    }
  });

  test('nothing at all is nothing, not a throw', () => {
    assert.length(tenancyQuestions(), 0);
    assert.equal(tenancyFor(null, []).state, TENANCY.NONE);
  });
});

describe('a task that says two things', () => {
  test('done with no date, and a date that is not done', () => {
    const rows = taskContradictions([
      { id: '1', title: 'A', status: 'done' },
      { id: '2', title: 'B', status: 'todo', completedOn: '2026-06-01' },
      { id: '3', title: 'C', status: 'done', completedOn: '2026-06-01' },
      { id: '4', title: 'D', status: 'todo' },
    ]);
    assert.length(rows, 2);
    assert.equal(rows.find((r) => r.task.id === '1').kind, TASK.DONE_NO_DATE);
    assert.equal(rows.find((r) => r.task.id === '2').kind, TASK.DATE_NOT_DONE);
  });

  test('it says nothing about a due date', () => {
    // `dueOn` is already a reminder on the Notifications tab. Saying it here
    // as well would be two counts of one thing.
    const rows = taskContradictions([{ id: '5', title: 'E', status: 'todo', dueOn: '2020-01-01' }]);
    assert.length(rows, 0);
  });

  test('a deleted task is not a finding', () => {
    assert.length(taskContradictions([{ id: '6', status: 'done', deletedAt: 'x' }]), 0);
  });

  test('and both kinds have English', () => {
    for (const kind of Object.values(TASK)) {
      assert.ok(strings[`upkeep.task.${kind}`], kind);
    }
  });
});

describe('whether the emergency list could be used in a hurry', () => {
  test('no contacts at all is the first thing to say', () => {
    assert.equal(reachability([]).state, REACH.NOBODY);
    assert.equal(reachability().state, REACH.NOBODY);
  });

  test('nobody with a priority means nothing says who to ring first', () => {
    const out = reachability([{ id: '1', name: 'A', phone: '1' }]);
    assert.equal(out.state, REACH.NO_FIRST);
  });

  test('two contacts claiming first place is a tie worth naming', () => {
    const out = reachability([
      { id: '1', name: 'A', phone: '1', priority: 1 },
      { id: '2', name: 'B', phone: '2', priority: 1 },
      { id: '3', name: 'C', phone: '3', priority: 2 },
    ]);
    assert.equal(out.state, REACH.TIED);
    assert.length(out.findings[0].contacts, 2);
  });

  test('a second place is not a tie', () => {
    const out = reachability([
      { id: '1', name: 'A', phone: '1', priority: 1 },
      { id: '2', name: 'B', phone: '2', priority: 2 },
    ]);
    assert.equal(out.state, REACH.READY);
    assert.length(out.findings, 0);
  });

  test('a contact with no number is named, because a number is what is used', () => {
    const out = reachability([
      { id: '1', name: 'A', phone: '1', priority: 1 },
      { id: '2', name: 'B', priority: 2, email: 'b@example.com', address: 'somewhere' },
    ]);
    assert.equal(out.findings.some((f) => f.kind === REACH.NO_PHONE), true);
    assert.equal(out.findings.find((f) => f.kind === REACH.NO_PHONE).contacts[0].name, 'B');
  });

  test('an alternate number counts', () => {
    const out = reachability([{ id: '1', name: 'A', altPhone: '99', priority: 1 }]);
    assert.length(out.findings, 0);
  });

  test('every finding it can report has English', () => {
    for (const kind of Object.values(REACH)) {
      if (kind === REACH.READY) continue;
      assert.ok(strings[`upkeep.reach.${kind}`], kind);
    }
  });

  test('it reports all of them, not just the first', () => {
    // Fixing one would otherwise reveal the next a week later.
    const out = reachability([
      { id: '1', name: 'A', priority: 1 },
      { id: '2', name: 'B', priority: 1 },
    ]);
    assert.equal(out.findings.length, 2);
  });
});

describe('the seven modules that had no screen', () => {
  const seven = ['insurance', 'property', 'education', 'tasks', 'notes', 'digital', 'emergency'];

  test('every one of them is a real module', () => {
    const known = new Set(modules.map((one) => one.id));
    assert.deep(seven.filter((id) => !known.has(id)), []);
  });

  test('and every one is routed to the shared screen', () => {
    const app = readFileSync(join(ROOT, 'js/app.js'), 'utf8');
    const missing = seven.filter((id) =>
      !new RegExp(`${id}: \\(\\) => import\\('\\./modules/secondary\\.js'\\)`).test(app));
    assert.deep(missing, []);
  });

  test('the four with an answer elsewhere point at it rather than recomputing', () => {
    /*
     * `policy.nominee` and `digitalAsset.legacyInstruction` are read by
     * `domain/estate.js`; the education dates are expiry fields and already
     * on the Notifications tab. A second implementation of one question is
     * the fault this repository keeps removing.
     */
    for (const id of ['insurance', 'digital', 'education', 'notes']) {
      assert.ok(strings[`secondary.${id}`], `secondary.${id} has no sentence`);
    }
    const estate = readFileSync(join(ROOT, 'js/domain/estate.js'), 'utf8');
    assert.includes(estate, 'legacyInstruction');

    // Code only. The header comment names both fields while explaining why
    // the screen does not touch them, so searching the whole file finds the
    // explanation and calls it the offence — the same trap as the dashboard's
    // widget list, which named the entity it had just removed.
    const screen = readFileSync(join(ROOT, 'js/modules/secondary.js'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.not(/nominee/.test(screen), 'the screen recomputes nominees');
    assert.not(/legacyInstruction/.test(screen), 'the screen recomputes legacy instructions');
  });

  test('notes admits it derives nothing', () => {
    assert.includes(strings['secondary.notes'].toLowerCase(), 'nothing here is worked out');
  });
});
