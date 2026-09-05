import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { outbound, inbound, connectionsOf, describeConnections } from '../js/domain/connections.js';
import { referenceFields, referencedIds, entityNames, entity } from '../js/data/schema.js';
import { RecordsService } from '../js/services/records.js';

setSuite('connections');

describe('what counts as a reference', () => {
  test('a field is a reference because it carries a ref, not because of its type', () => {
    // The bug this replaced: `type === 'ref' || type === 'multiref'` excluded
    // every `files` field, which is every document attachment in the schema.
    const kinds = new Set();
    let total = 0;
    for (const name of entityNames()) {
      for (const f of referenceFields(name)) {
        kinds.add(f.type);
        total += 1;
      }
    }
    assert.includes([...kinds], 'files');
    assert.includes([...kinds], 'ref');
    assert.includes([...kinds], 'multiref');
    assert.ok(total > 70, `only ${total} reference fields found`);
  });

  test('every attachment field is one', () => {
    const attachments = entityNames()
      .flatMap((name) => referenceFields(name).filter((f) => f.type === 'files'));
    assert.ok(attachments.length > 15, `only ${attachments.length} attachment fields`);
    for (const f of attachments) {
      assert.equal(f.ref, 'document');
      assert.ok(f.many, `${f.key} should read as a list`);
    }
  });

  test('a list field with nothing in it points at nothing', () => {
    const field = { key: 'documents', many: true };
    assert.deep(referencedIds({}, field), []);
    assert.deep(referencedIds({ documents: null }, field), []);
    assert.deep(referencedIds({ documents: ['a', '', 'b'] }, field), ['a', 'b']);
  });

  test('a single field reads as one id or none', () => {
    const field = { key: 'account', many: false };
    assert.deep(referencedIds({ account: 'acc_1' }, field), ['acc_1']);
    assert.deep(referencedIds({ account: '' }, field), []);
  });
});

describe('an attachment is a reference, and used not to be', () => {
  async function household() {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Meera Narayan' });
    const account = await makeAccount(db, { holder: person.id });
    const doc = await db.repo('document').create({
      title: 'Lease deed', category: 'property', person: person.id,
    });
    const txn = await db.repo('transaction').create({
      date: '2026-06-01', kind: 'expense', amount: '5000', category: 'rent',
      account: account.id, documents: [doc.id],
    });
    return { db, person, account, doc, txn };
  }

  test('a document attached to a transaction is referenced by it', async () => {
    // Measured before the fix: this returned nothing at all.
    const { db, doc } = await household();
    const refs = await db.referencedBy(doc.id);
    assert.length(refs, 1);
    assert.equal(refs[0].entity, 'transaction');
    assert.equal(refs[0].field, 'documents');
  });

  test('so deleting it warns instead of saying nothing', async () => {
    // The user-visible half. Before this, deleting a document attached to a
    // transaction was offered as though nothing depended on it.
    const { db, doc } = await household();
    const service = new RecordsService(db);
    const impact = await service.impactOfDeleting('document', doc.id);
    assert.ok(impact.total > 0, JSON.stringify(impact));
    assert.includes(service.describeImpact(impact), 'refers to this one');
  });

  test('a document nothing is attached to still deletes quietly', async () => {
    const { db, person } = await household();
    const loose = await db.repo('document').create({
      title: 'Nothing points here', category: 'other', person: person.id,
    });
    const impact = await new RecordsService(db).impactOfDeleting('document', loose.id);
    assert.equal(impact.total, 0);
  });
});

describe('both directions', () => {
  const DOC = { id: 'doc_1', title: 'Lease deed', person: 'per_1' };
  const titleOf = (entityName, id) => (id === 'per_1' ? 'Meera Narayan' : null);

  test('outbound reads the record, inbound has to be searched for', () => {
    const to = outbound('document', DOC, { titleOf });
    const person = to.find((one) => one.entity === 'person');
    assert.equal(person.title, 'Meera Narayan');
    assert.equal(person.direction, 'to');
    assert.not(person.missing);
  });

  test('a reference to a record that is gone is kept and marked', () => {
    // Dropping it would hide exactly what makes it worth showing.
    const to = outbound('document', { ...DOC, person: 'per_missing' }, { titleOf });
    const person = to.find((one) => one.field === 'person');
    assert.ok(person.missing);
    assert.equal(person.title, null);
  });

  test('inbound groups by where it comes from, most first', () => {
    const groups = inbound([
      { entity: 'transaction', id: 't1', field: 'documents', title: 'Rent' },
      { entity: 'transaction', id: 't2', field: 'documents', title: 'Rent' },
      { entity: 'policy', id: 'p1', field: 'documents', title: 'Motor' },
    ]);
    assert.length(groups, 2);
    assert.equal(groups[0].entity, 'transaction');
    assert.length(groups[0].records, 2);
    assert.equal(groups[1].entity, 'policy');
  });

  test('an entity the schema no longer has is still counted', () => {
    // The row genuinely points here. Saying nothing would be worse than
    // saying it under a name nobody recognises.
    const [group] = inbound([{ entity: 'gone', id: 'x', field: 'whatever', title: 'X' }]);
    assert.equal(group.entity, 'gone');
    assert.equal(group.label, 'gone');
    assert.length(group.records, 1);
  });

  test('the two halves are counted together and reported apart', () => {
    const c = connectionsOf('document', DOC, [
      { entity: 'transaction', id: 't1', field: 'documents', title: 'Rent' },
    ], { titleOf });
    assert.equal(c.total, 2);
    assert.length(c.to, 1);
    assert.length(c.from, 1);
    assert.deep(c.broken, []);
  });

  test('a record connected to nothing says so plainly', () => {
    const c = connectionsOf('note', { id: 'n1' }, [], { titleOf });
    assert.equal(c.total, 0);
    assert.includes(describeConnections(c), 'refers to nothing');
  });

  test('a broken reference is named in the sentence', () => {
    const c = connectionsOf('document', { ...DOC, person: 'per_missing' }, [], { titleOf });
    assert.length(c.broken, 1);
    assert.includes(describeConnections(c), 'not there');
  });
});

/*
 * A title has to tell one record from another.
 *
 * The connected-records card on a holding listed **six rows all reading
 * "buy"** — same title, same subtitle ("Investment transactions · via
 * Holding", which is the group's own description and so identical by
 * construction), nothing to tell them apart. The same titles are what the
 * timeline, search and the delete-impact dialog show.
 *
 * The cause is a shape rather than a typo: a title built from a `pick` — one
 * of nine values — plus an *optional* field degrades to the bare pick as soon
 * as the optional one is missing. `vehicleService` and `locationPing` had the
 * same shape, the latter with a literal fallback that made every reading
 * outside a named zone the same row.
 *
 * Each of the three has a required date, so each now carries it. Measured
 * across the example household, `investmentTransaction` went from one distinct
 * title for six records to six, and the dates make the pattern legible — the
 * six buys are a monthly instalment on the 7th, which six rows reading "buy"
 * could not say.
 *
 * Tested by holding every other field still and moving only the one that is
 * required: if the titles still match, the title is not identifying the
 * record.
 */
describe('a record title identifies the record', () => {
  // Objects rather than a mixed tuple: an array whose entries hold both a
  // string and an object infers as the union of the two, and every spread and
  // computed key in the loop below is then a type error. Five findings on the
  // first run, none of them a fault in the test.
  const cases = [
    {
      name: 'investmentTransaction',
      shared: { kind: 'buy', holding: 'hol_1' },
      field: 'date',
      one: '2026-04-07',
      two: '2026-05-07',
    },
    {
      name: 'vehicleService',
      shared: { kind: 'periodic service', vehicle: 'veh_1' },
      field: 'date',
      one: '2026-01-09',
      two: '2026-07-09',
    },
    {
      name: 'locationPing',
      shared: { person: 'per_1' },
      field: 'recordedAt',
      one: '2026-09-01T18:24:00.000Z',
      two: '2026-09-02T09:10:00.000Z',
    },
  ];

  for (const { name, shared, field, one, two } of cases) {
    test(`${name} distinguishes two records differing only by ${field}`, () => {
      const title = entity(name).title;
      const first = title({ ...shared, [field]: one });
      const second = title({ ...shared, [field]: two });

      // The guard: a title that is empty for both would "differ" never, and
      // one that throws would fail for the wrong reason.
      assert.ok(first && second, `empty titles: ${first} / ${second}`);
      assert.not(first === second, `both records are titled "${first}"`);
      // And the distinguishing part is actually shown, not merely computed.
      assert.includes(first, one.slice(0, 10));
    });
  }
});
