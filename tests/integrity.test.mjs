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

    // A floor, not a count. Three was the original bar and thirteen modules
    // now import it; dropping back under ten would mean the money paths in
    // the block below had been unpicked rather than refactored. What the
    // figures actually do is asserted there, because this reads imports and
    // an import proves nothing about an answer.
    assert.ok(adopted.length >= 10,
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

describe('a held row reaches no figure', () => {
  /*
   * Adopting `settled()` in a module is not the same as a held row being kept
   * out of what that module reports, and the difference was measured rather
   * than assumed. Before this, a held ₹90,000 transaction — one naming an
   * account the pull did not bring, so nobody can open it — was counted by
   * every function below. The worst of them was not a total at all:
   * `unusualSpending` raised a "16× above usual" alert built entirely on the
   * row nobody can explain, which is the household being alarmed by a figure
   * rule 57 says it must be able to trace.
   *
   * The suite passed 3113/3113 with all of it wrong, because the adoption
   * ratchet above reads imports and the money tests build rows that are never
   * held. So these ask the only question that settles it: does the answer
   * change when the mark is removed?
   */
  const HELD = '2026-09-01T00:00:00.000Z';
  const clock = () => Date.parse('2026-09-15T00:00:00Z');
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  /**
   * Run `figure` over rows carrying `heldAt` and over the same rows without
   * it, and insist the two disagree. Both halves matter: identical answers
   * mean the hold was ignored, and a fixture where the row changes nothing
   * either way would pass this by accident, so the unheld answer is also
   * asserted against a value typed out by hand.
   */
  const excludes = (figure, held, plain, whenCounted) => {
    const withHold = figure(held);
    const without = figure(plain);
    assert.not(same(withHold, without),
      `the held row was counted: both readings are ${JSON.stringify(withHold)}`);
    assert.deep(without, whenCounted,
      'the fixture does not produce the figure this test claims to measure');
  };

  const spend = (id, date, amount, extra = {}) => ({
    id, date, amount, kind: 'expense', direction: 'out',
    account: 'acc1', person: 'p1', category: 'food', ...extra,
  });

  test('a held transaction is not part of what a member spent', async () => {
    const { spendByMember } = await import('../js/domain/household.js');
    const people = [{ id: 'p1', name: 'Asha' }];
    const base = [spend('a', '2026-08-01', 30000_00)];
    const suspect = spend('X', '2026-08-10', 90000_00);
    excludes(
      (rows) => spendByMember(people, rows).tagged,
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      120000_00,
    );
  });

  test('a held transaction does not become what a usual day costs', async () => {
    const runway = await import('../js/domain/runway.js');
    // One in every complete month. A single outlier is absorbed by the median
    // these functions take on purpose, so a fixture with one held row proves
    // nothing about them — the first version of this test did exactly that.
    const base = []; const suspects = [];
    for (const m of ['04', '05', '06', '07', '08']) {
      base.push(spend(`t${m}`, `2026-${m}-02`, 1000_00));
      suspects.push(spend(`x${m}`, `2026-${m}-03`, 9000_00));
    }
    const held = [...base, ...suspects.map((r) => ({ ...r, heldAt: HELD }))];
    const plain = [...base, ...suspects];
    excludes((rows) => runway.typicalDailySpend(rows, { clock }).perDay,
      held, plain, 33333);
    excludes((rows) => runway.typicalMonthlyOutgoings(rows, { clock }).perMonth,
      held, plain, 1000000);
  });

  test('a held transaction is not spending out of the ordinary', async () => {
    const { unusualSpending } = await import('../js/domain/unusual.js');
    const base = [];
    for (const m of ['05', '06', '07', '08']) base.push(spend(`t${m}`, `2026-${m}-02`, 6000_00));
    const suspect = spend('X', '2026-08-10', 90000_00);
    // Not "no alert" — "not this alert". The held row is the entire reason
    // the category looks 16 times its usual size.
    excludes(
      (rows) => unusualSpending(rows, { month: '2026-08' }).map((f) => f.times),
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      [16],
    );
  });

  test('a held purchase is not on the card bill', async () => {
    const { statementBalance } = await import('../js/domain/cards.js');
    const card = { id: 'c1', kind: 'credit card', name: 'Card', statementDay: 5, dueDay: 20 };
    const base = [spend('a', '2026-08-01', 1000_00, { account: 'c1' })];
    const suspect = spend('X', '2026-08-02', 50000_00, { account: 'c1' });
    excludes(
      (rows) => statementBalance(card, rows, '2026-08-05'),
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      51000_00,
    );
  });

  test('a held payment does not settle a card bill', async () => {
    const { settlementReport } = await import('../js/domain/settlement.js');
    const accounts = [{ id: 'c1', kind: 'credit card', name: 'Card' },
      { id: 'b1', kind: 'savings', name: 'Bank' }];
    const base = [spend('s1', '2026-08-01', 3000_00, { account: 'c1' })];
    const suspect = spend('X', '2026-08-20', 3000_00, { account: 'b1', toAccount: 'c1' });
    excludes(
      (rows) => settlementReport(rows, accounts).total,
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      3000_00,
    );
  });

  test('a held transaction is not a loan repayment', async () => {
    const { paymentsFor } = await import('../js/domain/amortise.js');
    const loan = { id: 'l1', name: 'Home', emiAmount: 10000_00, emiDay: 5 };
    const base = [{ id: 'p1', date: '2026-06-05', amount: 10000_00, direction: 'out', category: 'EMI' }];
    const suspect = { id: 'X', date: '2026-07-05', amount: 10000_00, direction: 'out', category: 'EMI' };
    excludes(
      (rows) => paymentsFor(loan, rows).map((r) => r.id),
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      ['p1', 'X'],
    );
  });

  test('a held trade is not part of what a holding cost', async () => {
    const { costBasis } = await import('../js/domain/costbasis.js');
    const holding = { id: 'h1', name: 'Fund', units: 200 };
    const base = [{ id: 'b1', holding: 'h1', date: '2026-05-01', kind: 'buy', units: 100, amount: 50000_00 }];
    const suspect = { id: 'X', holding: 'h1', date: '2026-06-01', kind: 'buy', units: 100, amount: 90000_00 };
    excludes(
      (rows) => costBasis(holding, rows).invested,
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      140000_00,
    );
  });

  test('a held credit is not rent received', async () => {
    const { rentReceived } = await import('../js/domain/rentreceipt.js');
    const property = { id: 'pr1', rented: true, monthlyRent: 20000_00, rentAccount: 'acc1' };
    const base = [{ id: 'r1', date: '2026-07-05', amount: 20000_00, direction: 'in', account: 'acc1' }];
    const suspect = { id: 'X', date: '2026-08-05', amount: 20000_00, direction: 'in', account: 'acc1' };
    excludes(
      (rows) => rentReceived(property, rows, { from: '2026-04-01', to: '2026-09-30' })
        .months.filter((m) => m.received).map((m) => m.month),
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      ['2026-07', '2026-08'],
    );
  });

  test('a held instalment is not one the deposit received', async () => {
    const { instalmentsFor } = await import('../js/domain/accrual.js');
    const rd = { id: 'h2', name: 'RD', kind: 'recurring deposit', ratePercent: 7,
      openedOn: '2026-01-01', instalmentAmount: 5000_00 };
    const base = [{ id: 'r1', holding: 'h2', date: '2026-02-01', amount: 5000_00, kind: 'buy' }];
    const suspect = { id: 'X', holding: 'h2', date: '2026-03-01', amount: 5000_00, kind: 'buy' };
    excludes(
      (rows) => instalmentsFor(rd, rows).length,
      [...base, { ...suspect, heldAt: HELD }],
      [...base, suspect],
      2,
    );
  });
});

