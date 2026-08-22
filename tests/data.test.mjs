import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, outbox, auditLog, makePerson, makeAccount } from './fixture.mjs';
import { entities, entity, sheetManifest, modules } from '../js/data/schema.js';
import { validate } from '../js/data/validate.js';
import { formats, verhoeff } from '../js/data/formats.js';
import { MemoryAdapter, compareKeys, inRange } from '../js/data/storage.js';
import { describeStores, upgradeRecord, recordMigrations, needsUpgrade } from '../js/data/migrations.js';
import { tokenize, prefixes } from '../js/data/search.js';
import { changedFields } from '../js/data/audit.js';
import { isEncrypted } from '../js/security/crypto.js';
import { sortBy } from '../js/data/repository.js';
import { withoutComments } from '../tools/field-coverage.mjs';

setSuite('data');

describe('schema', () => {
  test('every entity has a unique sheet name', () => {
    const sheets = Object.values(entities).map((e) => e.sheet);
    assert.equal(new Set(sheets).size, sheets.length, 'two entities share a sheet tab');
  });

  test('every ref points at an entity that exists', () => {
    for (const def of Object.values(entities)) {
      for (const f of def.fields) {
        if (f.type !== 'ref' && f.type !== 'multiref') continue;
        assert.ok(entities[f.ref], `${def.name}.${f.key} points at unknown "${f.ref}"`);
      }
    }
  });

  test('every enum field declares its options', () => {
    for (const def of Object.values(entities)) {
      for (const f of def.fields) {
        if (f.type !== 'enum' && f.type !== 'multienum') continue;
        assert.ok(f.options?.length, `${def.name}.${f.key} has no options`);
      }
    }
  });

  test('a default value is one of the allowed options', () => {
    for (const def of Object.values(entities)) {
      for (const f of def.fields) {
        if (f.type !== 'enum' || f.default === undefined) continue;
        assert.includes(f.options, f.default, `${def.name}.${f.key} defaults outside its options`);
      }
    }
  });

  test('no entity has a field colliding with the record envelope', () => {
    const envelope = ['id', 'rev', 'createdAt', 'updatedAt', 'createdBy',
      'updatedBy', 'deletedAt', 'origin', 'schemaVersion', 'syncState'];
    for (const def of Object.values(entities)) {
      for (const f of def.fields) {
        assert.not(envelope.includes(f.key), `${def.name}.${f.key} shadows an envelope field`);
      }
    }
  });

  test('every module names entities that exist', () => {
    for (const mod of modules) {
      for (const name of mod.entities) {
        assert.ok(entities[name], `module ${mod.id} lists unknown entity "${name}"`);
      }
    }
  });

  test('every entity belongs to a declared module', () => {
    const ids = new Set(modules.map((m) => m.id));
    for (const def of Object.values(entities)) {
      assert.ok(ids.has(def.module), `${def.name} is in unknown module "${def.module}"`);
    }
  });

  test('encrypted fields are never used as list columns', () => {
    // A list column has to be sortable and readable without a decrypt pass.
    for (const def of Object.values(entities)) {
      for (const f of def.fields) {
        if (!f.encrypted) continue;
        assert.not(f.search, `${def.name}.${f.key} cannot be both encrypted and searchable`);
      }
    }
  });

  test('the sheet manifest covers every entity', () => {
    assert.length(sheetManifest(), Object.keys(entities).length);
  });
});

describe('formats', () => {
  test('Verhoeff catches a transposed digit', () => {
    assert.ok(verhoeff('234567890124'), 'a valid Aadhaar checksum');
    assert.not(verhoeff('234567890142'), 'the last two digits swapped must fail');
  });

  test('Aadhaar rejects a reserved leading digit', () => {
    assert.not(formats.Aadhaar.test('134567890124'));
    assert.not(formats.Aadhaar.test('034567890124'));
  });

  test('PAN has to be five letters, four digits, a letter', () => {
    assert.ok(formats.PAN.test('ABCDE1234F'));
    assert.ok(formats.PAN.test('abcde1234f'), 'case is normalised');
    assert.not(formats.PAN.test('ABCD1234F'));
    assert.not(formats.PAN.test('ABCDE12345'));
  });

  test('IFSC needs its zero in the fifth position', () => {
    assert.ok(formats.IFSC.test('HDFC0001234'));
    assert.not(formats.IFSC.test('HDFC1001234'));
  });

  test('a link with a script scheme is refused', () => {
    assert.not(formats.url.test('javascript:alert(1)'));
    assert.not(formats.url.test('data:text/html,<script>'));
    assert.ok(formats.url.test('example.com/a'));
    assert.equal(formats.url.normalise('example.com'), 'https://example.com');
  });
});

describe('validation', () => {
  test('a required field cannot be blank', () => {
    const { issues } = validate('person', { name: '' });
    assert.ok(issues.some((i) => i.field === 'name'));
  });

  test('currency input is coerced to minor units', () => {
    const { record } = validate('transaction', {
      date: '2025-06-01', kind: 'expense', amount: '1,250.50', account: 'acc_1',
    });
    assert.equal(record.amount, 125050);
  });

  test('a transfer to the same account is refused', () => {
    const { issues } = validate('transaction', {
      date: '2025-06-01', kind: 'transfer', amount: '100',
      account: 'acc_1', toAccount: 'acc_1',
    });
    assert.ok(issues.some((i) => i.field === 'toAccount'));
  });

  test('a transfer with no destination is refused', () => {
    const { issues } = validate('transaction', {
      date: '2025-06-01', kind: 'transfer', amount: '100', account: 'acc_1',
    });
    assert.ok(issues.some((i) => i.field === 'toAccount'));
  });

  test('a negative amount is refused with an instruction, not a shrug', () => {
    const { issues } = validate('transaction', {
      date: '2025-06-01', kind: 'expense', amount: '-100', account: 'acc_1',
    });
    const issue = issues.find((i) => i.field === 'amount');
    assert.ok(issue);
    assert.includes(issue.message, 'income or expense');
  });

  test('a PAN in the wrong shape fails on the number field', () => {
    const { issues } = validate('identityDocument', {
      person: 'per_1', kind: 'PAN', number: 'NOTAPAN',
    });
    assert.ok(issues.some((i) => i.field === 'number'));
  });

  test('a well-formed Aadhaar passes and a mistyped one does not', () => {
    const good = validate('identityDocument', {
      person: 'per_1', kind: 'Aadhaar', number: '2345 6789 0124',
    });
    assert.length(good.issues, 0);
    const bad = validate('identityDocument', {
      person: 'per_1', kind: 'Aadhaar', number: '2345 6789 0142',
    });
    assert.length(bad.issues, 1);
  });

  test('an expiry before its issue date is refused', () => {
    const { issues } = validate('identityDocument', {
      person: 'per_1', kind: 'Other', number: 'X1',
      issuedOn: '2025-06-01', expiresOn: '2024-06-01',
    });
    assert.ok(issues.some((i) => i.field === 'expiresOn'));
  });

  test('a birthday in the future is refused', () => {
    const { issues } = validate('person', { name: 'A', role: 'adult', birthday: '2099-01-01' });
    assert.ok(issues.some((i) => i.field === 'birthday'));
  });

  test('a person cannot be related to themselves', () => {
    const { issues } = validate('relationship', {
      fromPerson: 'per_1', type: 'parent of', toPerson: 'per_1',
    });
    assert.ok(issues.some((i) => i.field === 'toPerson'));
  });

  test('a partial patch skips required checks', () => {
    const { issues } = validate('person', { nickname: 'Ash' }, { partial: true });
    assert.length(issues, 0);
  });

  test('defaults are applied when a field is absent', () => {
    const { record } = validate('task', { title: 'Renew passport' });
    assert.equal(record.status, 'todo');
    assert.equal(record.priority, 'normal');
  });

  test('an unknown enum value is refused', () => {
    const { issues } = validate('task', { title: 'x', status: 'maybe' });
    assert.ok(issues.some((i) => i.field === 'status'));
  });
});

describe('storage adapter', () => {
  test('key ordering matches IndexedDB for mixed types', () => {
    assert.ok(compareKeys(1, 'a') < 0, 'numbers sort before strings');
    assert.ok(compareKeys('a', 'b') < 0);
    assert.equal(compareKeys([1, 'a'], [1, 'a']), 0);
    assert.ok(compareKeys([1], [1, 'a']) < 0, 'a shorter array sorts first');
  });

  test('range bounds honour openness', () => {
    assert.ok(inRange(5, { lower: 5, upper: 10 }));
    assert.not(inRange(5, { lower: 5, lowerOpen: true }));
    assert.ok(inRange('b', { only: 'b' }));
    assert.not(inRange('c', { only: 'b' }));
  });

  test('a throwing transaction leaves nothing behind', async () => {
    const a = new MemoryAdapter();
    await a.open({ version: 1, stores: [{ name: 's', keyPath: 'id', indexes: [] }] });
    await a.write('s', { id: '1', v: 'first' });

    await assert.throws(() => a.tx(['s'], 'readwrite', async (t) => {
      await t.put('s', { id: '2', v: 'second' });
      await t.put('s', { id: '1', v: 'changed' });
      throw new Error('boom');
    }), 'boom');

    assert.equal((await a.read('s', '1')).v, 'first', 'the update must be rolled back');
    assert.equal(await a.read('s', '2'), undefined, 'the insert must be rolled back');
  });

  test('a read inside a transaction sees its own uncommitted write', async () => {
    const a = new MemoryAdapter();
    await a.open({ version: 1, stores: [{ name: 's', keyPath: 'id', indexes: [] }] });
    const seen = await a.tx(['s'], 'readwrite', async (t) => {
      await t.put('s', { id: '1', v: 'x' });
      return t.get('s', '1');
    });
    assert.equal(seen.v, 'x');
  });

  test('a store outside the transaction is refused', async () => {
    const a = new MemoryAdapter();
    await a.open({ version: 1, stores: [
      { name: 's', keyPath: 'id', indexes: [] },
      { name: 'other', keyPath: 'id', indexes: [] },
    ] });
    await assert.throws(
      () => a.tx(['s'], 'readwrite', (t) => t.put('other', { id: '1' })),
      'not in this transaction',
    );
  });

  test('a read-only transaction refuses a write', async () => {
    const a = new MemoryAdapter();
    await a.open({ version: 1, stores: [{ name: 's', keyPath: 'id', indexes: [] }] });
    await assert.throws(
      () => a.tx(['s'], 'readonly', (t) => t.put('s', { id: '1' })),
      'read-only',
    );
  });

  test('stored values are copies, not references', async () => {
    const a = new MemoryAdapter();
    await a.open({ version: 1, stores: [{ name: 's', keyPath: 'id', indexes: [] }] });
    const record = { id: '1', tags: ['a'] };
    await a.write('s', record);
    record.tags.push('b');
    assert.length((await a.read('s', '1')).tags, 1, 'mutating the input must not reach the store');
  });
});

describe('migrations', () => {
  test('every entity gets a store with the three standard indexes', () => {
    const stores = describeStores();
    for (const name of Object.keys(entities)) {
      const store = stores.find((s) => s.name === name);
      assert.ok(store, `no store for ${name}`);
      const indexes = store.indexes.map(([n]) => n);
      for (const needed of ['byUpdatedAt', 'byDeleted', 'bySyncState']) {
        assert.includes(indexes, needed, `${name} is missing ${needed}`);
      }
    }
  });

  test('an upgrade is detected when the schema gains a store', async () => {
    const stores = describeStores();
    const adapter = new MemoryAdapter();
    await adapter.open({ version: 1, stores: stores.slice(0, 3) });
    assert.ok(needsUpgrade(adapter, stores), 'missing stores must force an upgrade');
    await adapter.open({ version: 2, stores });
    assert.not(needsUpgrade(adapter, stores));
  });

  test('a record from an older version is walked forward', () => {
    recordMigrations.person = { 2: (r) => ({ ...r, nickname: r.nickname || 'unknown' }) };
    const def = entity('person');
    const original = def.version;
    try {
      // Pretend the schema moved to v2 without editing the frozen definition.
      const record = { id: 'p1', schemaVersion: 1, name: 'A' };
      const stepped = recordMigrations.person[2](record);
      assert.equal(stepped.nickname, 'unknown');
      assert.equal(upgradeRecord('person', { ...record, schemaVersion: original }).schemaVersion, original);
    } finally {
      delete recordMigrations.person;
    }
  });

  test('a record from a newer client is left untouched', () => {
    const future = { id: 'p1', schemaVersion: 99, name: 'A', unknownField: 'keep me' };
    const out = upgradeRecord('person', future);
    assert.equal(out.unknownField, 'keep me', 'dropping unknown fields would delete another device data');
    assert.equal(out.schemaVersion, 99);
  });
});

describe('search index', () => {
  test('tokenizing keeps digits attached to letters', () => {
    assert.deep(tokenize('KA01AB1234 renewal'), ['ka01ab1234', 'renewal']);
  });

  test('prefixes start at three characters', () => {
    const p = prefixes(['passport']);
    assert.includes(p, 'pas');
    assert.includes(p, 'passport');
    assert.not(p.includes('pa'), 'two characters would match almost everything');
  });

  test('a short word is still indexed whole', () => {
    assert.includes(prefixes(['rc']), 'rc');
  });
});

describe('audit', () => {
  test('envelope changes are not reported as edits', () => {
    const before = { id: '1', rev: 1, updatedAt: 'a', name: 'x' };
    const after = { id: '1', rev: 2, updatedAt: 'b', name: 'x' };
    assert.length(changedFields(before, after), 0);
  });

  test('an array change is detected', () => {
    assert.deep(changedFields({ tags: ['a'] }, { tags: ['a', 'b'] }), ['tags']);
    assert.length(changedFields({ tags: ['a'] }, { tags: ['a'] }), 0);
  });
});

describe('sorting', () => {
  test('blanks sort last in both directions', () => {
    const rows = [{ d: '2025-01-01' }, { d: '' }, { d: '2025-03-01' }];
    assert.deep(sortBy(rows, 'd').map((r) => r.d), ['2025-01-01', '2025-03-01', '']);
    assert.deep(sortBy(rows, '-d').map((r) => r.d), ['2025-03-01', '2025-01-01', '']);
  });
});

describe('repository', () => {
  test('a create writes the record, the index, the audit and the outbox as one', async () => {
    const db = await makeDb();
    const person = await makePerson(db);

    assert.ok(person.id.startsWith('prs_'), 'ids carry a readable prefix');
    assert.equal(person.rev, 1);
    assert.equal(person.syncState, 'pending');

    const queued = await outbox(db);
    assert.length(queued, 1);
    assert.equal(queued[0].op, 'put');
    assert.equal(queued[0].recordId, person.id);

    const log = await auditLog(db);
    assert.equal(log.at(-1).action, 'create');

    const hits = await db.search('Asha');
    assert.length(hits, 1);
  });

  test('a failed validation queues nothing', async () => {
    const db = await makeDb();
    await assert.throws(() => db.repo('person').create({ name: '' }), 'required');
    assert.length(await outbox(db), 0, 'a rejected write must not reach the queue');
    assert.length(await auditLog(db), 0);
  });

  test('encrypted fields are ciphertext at rest and clear on read', async () => {
    const db = await makeDb();
    const acc = await makeAccount(db);

    const raw = await db.adapter.read('account', acc.id);
    assert.ok(isEncrypted(raw.accountNumber), 'the account number must be sealed in storage');
    assert.equal(raw.name, 'HDFC Savings', 'the name is deliberately clear, for search and sort');

    const read = await db.repo('account').get(acc.id);
    assert.equal(read.accountNumber, '50100123456789');
  });

  test('a ciphertext moved to another record will not decrypt', async () => {
    const db = await makeDb();
    const a = await makeAccount(db, { name: 'One', accountNumber: '111111111111' });
    const b = await makeAccount(db, { name: 'Two', accountNumber: '222222222222' });

    const rawA = await db.adapter.read('account', a.id);
    const rawB = await db.adapter.read('account', b.id);
    await db.adapter.write('account', { ...rawB, accountNumber: rawA.accountNumber });

    const read = await db.repo('account').get(b.id);
    assert.equal(read.accountNumber, '', 'a transplanted ciphertext must fail its tag');
    assert.includes(read._undecryptable, 'accountNumber');
  });

  test('an update bumps the revision and records only what changed', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    const updated = await db.repo('person').update(person.id, { nickname: 'Ash' });

    assert.equal(updated.rev, 2);
    assert.equal(updated.createdAt, person.createdAt, 'creation time is immutable');
    const log = await auditLog(db);
    assert.deep(log.at(-1).fields, ['nickname']);
  });

  test('a patch leaves untouched fields alone', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    const updated = await db.repo('person').update(person.id, { nickname: 'Ash' });
    assert.equal(updated.name, 'Asha Narayan');
    assert.equal(updated.bloodGroup, 'O+');
  });

  test('a delete is soft, replicates, and hides the record', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    await db.repo('person').remove(person.id);

    assert.equal(await db.repo('person').get(person.id), null);
    assert.ok(await db.repo('person').get(person.id, { includeDeleted: true }));

    const raw = await db.adapter.read('person', person.id);
    assert.ok(raw, 'the row itself must survive so the delete can replicate');
    assert.ok(raw.deletedAt);

    const queued = await outbox(db);
    assert.equal(queued.at(-1).op, 'delete');
    assert.length(await db.search('Asha'), 0, 'a deleted record leaves the index');
  });

  test('a restore brings it back and re-indexes it', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    await db.repo('person').remove(person.id);
    await db.repo('person').restore(person.id);

    assert.ok(await db.repo('person').get(person.id));
    assert.length(await db.search('Asha'), 1);
  });

  test('outbox sequence numbers never repeat or go backwards', async () => {
    const db = await makeDb();
    for (let i = 0; i < 20; i++) await makePerson(db, { name: `Person ${i}` });
    const seqs = (await outbox(db)).map((o) => o.seq);
    assert.deep(seqs, [...seqs].sort((a, b) => a - b));
    assert.equal(new Set(seqs).size, seqs.length);
  });

  test('a record applied from the server does not re-enter the queue', async () => {
    const db = await makeDb();
    const before = (await outbox(db)).length;
    await db.repo('person').applyRemote({
      id: 'prs_remote', rev: 4, name: 'Remote Person', role: 'adult',
      createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
      deletedAt: null, origin: 'dev_other', schemaVersion: 1,
    });
    assert.length(await outbox(db), before, 'a pulled record must not be pushed straight back');
    assert.ok(await db.repo('person').get('prs_remote'));
  });

  test('references are found before a delete', async () => {
    const db = await makeDb();
    const acc = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2025-06-01', kind: 'expense', amount: '500', account: acc.id, category: 'fuel',
    });
    const refs = await db.referencedBy(acc.id);
    assert.length(refs, 1);
    assert.equal(refs[0].entity, 'transaction');
  });

  test('a dangling reference is reported', async () => {
    const db = await makeDb();
    const acc = await makeAccount(db);
    const txn = await db.repo('transaction').create({
      date: '2025-06-01', kind: 'expense', amount: '500', account: acc.id,
    });
    // Remove the account behind the transaction's back, as a bad sync would.
    await db.adapter.remove('account', acc.id);
    const broken = await db.danglingReferences();
    assert.ok(broken.some((b) => b.id === txn.id && b.field === 'account'));
  });

  test('search finds a record by a prefix of any indexed field', async () => {
    const db = await makeDb();
    await makeAccount(db, { name: 'ICICI Credit Card', kind: 'credit card', creditLimit: '200000' });
    assert.length(await db.search('icic'), 1);
    assert.length(await db.search('credit'), 1);
    assert.length(await db.search('zzz'), 0);
  });

  test('search requires every word to match', async () => {
    const db = await makeDb();
    await makeAccount(db, { name: 'HDFC Savings', institution: 'HDFC Bank' });
    await makeAccount(db, { name: 'ICICI Savings', institution: 'ICICI Bank' });
    assert.length(await db.search('savings'), 2);
    assert.length(await db.search('hdfc savings'), 1);
  });

  test('reindexing reproduces the same index', async () => {
    const db = await makeDb();
    await makeAccount(db);
    const before = (await db.search('hdfc')).length;
    await db.reindex();
    assert.equal((await db.search('hdfc')).length, before);
  });

  test('statistics count live, deleted and queued rows', async () => {
    const db = await makeDb();
    const p = await makePerson(db);
    await makePerson(db, { name: 'Second' });
    await db.repo('person').remove(p.id);

    const stats = await db.statistics();
    assert.equal(stats.person.total, 2);
    assert.equal(stats.person.live, 1);
    assert.equal(stats._outbox.pending, 3);
  });
});

describe('sorting by more than one key', () => {
  test('pinned first, then newest', () => {
    // One key was enough until a `pinned` flag had to survive a date sort. A
    // screen sorting by pin alone puts a note pinned in March above one edited
    // this morning.
    const rows = [
      { id: 'a', pinned: false, updatedAt: '2026-08-16' },
      { id: 'b', pinned: true, updatedAt: '2026-03-01' },
      { id: 'c', pinned: true, updatedAt: '2026-08-15' },
      { id: 'd', pinned: false, updatedAt: '2026-08-10' },
    ];
    assert.deep(sortBy(rows, '-pinned,-updatedAt').map((r) => r.id), ['c', 'b', 'a', 'd']);
  });

  test('a blank sorts last whichever way the key runs', () => {
    // "No date" is not "the earliest date", and flipping it would put every
    // blank at the top of a descending list.
    const rows = [{ id: 'a', at: '' }, { id: 'b', at: '2026-01-01' }];
    assert.deep(sortBy(rows, 'at').map((r) => r.id), ['b', 'a']);
    assert.deep(sortBy(rows, '-at').map((r) => r.id), ['b', 'a']);
  });

  test('a single key still behaves as it always did', () => {
    const rows = [{ id: 'a', n: 2 }, { id: 'b', n: 1 }];
    assert.deep(sortBy(rows, 'n').map((r) => r.id), ['b', 'a']);
    assert.deep(sortBy(rows, '-n').map((r) => r.id), ['a', 'b']);
  });
});

describe('a field name in a comment is not a field being read', () => {
  test('prose cannot silence the coverage ratchet', () => {
    // It could, and did: a doc comment quoting an activity feed — "changed
    // upiId on an account" — took `account.upiId` off the unread list without
    // a line of code touching it.
    assert.equal(withoutComments('// upiId here').trim(), '');
    assert.equal(withoutComments('const x = 1; // upiId').trim(), 'const x = 1;');
    assert.not(withoutComments('/** upiId */').includes('upiId'));
  });

  test('and a wildcard inside a string does not open a comment', () => {
    // The first version matched block comments with a regex, so a file-picker
    // `accept` string paired with a close two hundred lines later and swallowed
    // the only line that read `document.confidential`.
    const source = "const accept = 'image/*,application/pdf';\nconst keep = document.confidential;";
    const out = withoutComments(source);
    assert.includes(out, 'confidential');
    assert.includes(out, 'image/');
  });

  test('a comment marker inside a string survives', () => {
    assert.includes(withoutComments('const u = "https://example.test/x";'), 'example.test');
  });

  test('a regex holding an odd number of quotes does not swallow the rest', () => {
    // The one that got past. `/'[^']*'/` contains three apostrophes; the
    // scanner read the third as opening a string and stopped stripping
    // comments for the remainder of the file. Prose then counted as code and
    // a field nothing reads was reported as read — the ratchet failing open.
    const source = [
      "const rule = /'[^']*'/g;",
      '// diagnosis is only mentioned in prose here',
      'const keep = record.confidential;',
    ].join('\n');

    const out = withoutComments(source);
    assert.not(out.includes('diagnosis'), out);
    assert.includes(out, 'confidential');
  });

  test('and the same for a backtick or a double quote in a literal', () => {
    for (const literal of ['/`[^`]*`/g', '/"[^"]*"/g', '/["\'`]/g']) {
      const out = withoutComments(`const r = ${literal};\n// upiId in prose\nconst k = 1;`);
      assert.not(out.includes('upiId'), `${literal}: ${out}`);
    }
  });

  test('but division is still division, not a regex swallowing the line', () => {
    // The other direction. If every `/` opened a regex, `a / b` would eat the
    // rest of the line and take real code with it.
    const out = withoutComments('const rate = total / count;\nconst k = record.upiId;');
    assert.includes(out, 'upiId');
    assert.includes(out, 'total / count');
  });

  test('and an apostrophe in prose still cannot open a string', () => {
    const out = withoutComments("// the household's records\nconst k = record.upiId;");
    assert.includes(out, 'upiId');
  });
});

/**
 * A staff member is a role, not a second person.
 *
 * Phase 13's first constraint, and the one that would be expensive to
 * discover later: giving staff their own name, phone and identity fields
 * would create a second identity record for a human being, which is the
 * failure the CKYC rules exist to prevent. A person is a person, and what
 * they do for this household is a fact *about* them.
 */
describe('household staff', () => {
  test('it points at a person rather than describing one', () => {
    const fields = Object.fromEntries(
      Object.values(entities.staff.fields).map((f) => [f.key, f]),
    );

    assert.equal(fields.person.type, 'ref');
    assert.equal(fields.person.ref, 'person');
    assert.ok(fields.person.required, 'a staff record with no person is a role nobody holds');
  });

  test('it declares no identity of its own', () => {
    // The whole point. If any of these ever appears here, the household has
    // two records for one human being and nothing keeps them in step.
    const keys = Object.values(entities.staff.fields).map((f) => f.key);
    for (const forbidden of ['name', 'phone', 'email', 'aadhaar', 'pan', 'address', 'dob']) {
      assert.not(keys.includes(forbidden), `staff must not carry its own ${forbidden}`);
    }
  });

  test('a leaving date exists, so history is not a deletion', () => {
    const keys = Object.values(entities.staff.fields).map((f) => f.key);
    assert.ok(keys.includes('endedOn'));
  });
});
