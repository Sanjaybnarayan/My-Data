import { test, describe, assert, setSuite } from './harness.mjs';
import {
  buildBody, describeBody, seal, open, planRestore, verify,
  ARCHIVE_VERSION, MAGIC, STORES, WHY,
} from '../js/domain/archive.js';
import { ArchiveService, REFUSED } from '../js/services/archive.js';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';

setSuite('archive');

const PHRASE = 'copper-lantern-marsh-vellum-quiet';

/** Rows in the shape the store actually holds them: envelopes, not plaintext. */
function stores() {
  return {
    person: [
      { id: 'per_1', name: 'A', pan: 'enc:v1:abc', updatedAt: '2026-01-01T00:00:00Z' },
      { id: 'per_2', name: 'B', deletedAt: '2026-02-01T00:00:00Z' },
    ],
    transaction: [
      { id: 'txn_1', amount: 125000, payee: 'Landlord', at: '2026-01-05' },
    ],
    meta: [{ key: 'keyring', value: [{ method: 'pin', salt: 's', key: 'k' }] }],
    audit: [{ id: 'aud_1', action: 'create', at: '2026-01-01T00:00:00Z' }],
    blobs: [{ id: 'blb_1', iv: 'i', data: 'zzz' }],
    // Everything below must not survive into the archive.
    search: [{ id: 'person:per_1', term: ['a'] }],
    outbox: [{ id: 'out_1', seq: 1 }],
    shadow: [{ id: 'shd_1', store: 'person' }],
    conflicts: [{ id: 'cft_1', store: 'person' }],
  };
}

const entities = ['person', 'transaction'];
const emptyDevice = { records: 0, entities };

describe('what goes in', () => {
  test('carries the rows exactly as the database holds them', () => {
    // Nothing is decrypted to be archived. An encrypted field arrives at the
    // other side in the same envelope it left in, which is why the same PIN
    // still opens it and why a restore cannot quietly change what a record
    // says.
    const body = buildBody({ stores: stores(), entities });
    assert.equal(body.stores.person[0].pan, 'enc:v1:abc');
  });

  test('keeps deleted records, because a deletion is a fact', () => {
    // A restore that resurrects what somebody threw away is not a restore.
    const body = buildBody({ stores: stores(), entities });
    const deleted = body.stores.person.filter((r) => r.deletedAt);
    assert.length(deleted, 1);
  });

  test('carries the keyring, the documents and the history', () => {
    const body = buildBody({ stores: stores(), entities });
    for (const name of STORES.included) {
      assert.ok(body.stores[name]?.length, `${name} was not archived`);
    }
  });

  test('leaves out what belongs to one device rather than to the records', () => {
    // Sync state is a conversation this device was having. Inheriting half of
    // somebody else's is how a push overwrites the wrong thing.
    const body = buildBody({ stores: stores(), entities });
    for (const name of Object.keys(STORES.excluded)) {
      assert.not(name in body.stores, `${name} should not be archived`);
    }
  });

  test('counts records without counting the machinery', () => {
    const described = describeBody(buildBody({ stores: stores(), entities }));
    assert.equal(described.records, 3, 'two people and one transaction');
    assert.equal(described.documents, 1);
    assert.equal(described.events, 1);
  });
});

describe('sealing and opening', () => {
  test('a sealed archive says what it is without being opened', async () => {
    // A file has to be recognisable, and its version readable, before somebody
    // is asked for a phrase they would then be told was wrong for a file that
    // was never an archive.
    const file = await seal(buildBody({ stores: stores(), entities }), PHRASE);
    assert.equal(file.magic, MAGIC);
    assert.equal(file.version, ARCHIVE_VERSION);
    assert.ok(file.kdf.salt);
  });

  test('and nothing else in the clear', async () => {
    // The rows carry plaintext payees, amounts and dates. If any of that were
    // readable in the file, the encryption would be decoration.
    const file = await seal(buildBody({ stores: stores(), entities }), PHRASE);
    const text = JSON.stringify(file);
    for (const secret of ['Landlord', '125000', 'per_1', 'enc:v1:abc']) {
      assert.not(text.includes(secret), `${secret} is readable in a sealed archive`);
    }
  });

  test('round-trips every row it was given', async () => {
    // The check docs/PORTABILITY.md said had to exist: restore what was
    // exported and compare. An export nobody has read back is how the previous
    // situation arose.
    const before = buildBody({ stores: stores(), entities });
    const opened = await open(await seal(before, PHRASE), PHRASE);

    assert.ok(opened.ok, opened.why);
    assert.deep(opened.body, before);
  });

  test('refuses the wrong phrase, and says that is what happened', async () => {
    const file = await seal(buildBody({ stores: stores(), entities }), PHRASE);
    const opened = await open(file, 'copper-lantern-marsh-vellum-quiet-x');
    assert.not(opened.ok);
    assert.equal(opened.why, WHY.WRONG_PHRASE);
  });

  test('refuses a file that was never an archive', async () => {
    const opened = await open({ some: 'json' }, PHRASE);
    assert.not(opened.ok);
    assert.equal(opened.why, WHY.NOT_AN_ARCHIVE);
  });

  test('refuses one written by a newer FamilyOS rather than guessing', async () => {
    const file = await seal(buildBody({ stores: stores(), entities }), PHRASE);
    const opened = await open({ ...file, version: ARCHIVE_VERSION + 1 }, PHRASE);
    assert.not(opened.ok);
    assert.equal(opened.why, WHY.FUTURE_VERSION);
  });

  test('refuses a damaged file separately from a wrong phrase', async () => {
    const file = await seal(buildBody({ stores: stores(), entities }), PHRASE);
    const opened = await open({ ...file, body: undefined }, PHRASE);
    assert.not(opened.ok);
    assert.equal(opened.why, WHY.DAMAGED);
  });
});

describe('restoring', () => {
  test('plans a write for every archived row', () => {
    const body = buildBody({ stores: stores(), entities });
    const plan = planRestore(body, emptyDevice);

    assert.ok(plan.ok, plan.why);
    assert.equal(plan.writes.length, 6, 'three records, a keyring, an audit row and a blob');
  });

  test('refuses a device that already holds records', () => {
    // Two records with the same id and different contents, an edit on each
    // side, a deletion on one — that is the sync engine's problem, and it has
    // a shadow copy and a three-way merge to do it with. An archive restore
    // has no common ancestor and no way to know which side is later.
    const body = buildBody({ stores: stores(), entities });
    const plan = planRestore(body, { records: 12, entities });

    assert.not(plan.ok);
    assert.equal(plan.why, WHY.NOT_EMPTY);
    assert.equal(plan.holding, 12);
  });

  test('refuses an archive with no keyring, which would be unreadable anyway', () => {
    const body = buildBody({ stores: { ...stores(), meta: [] }, entities });
    const plan = planRestore(body, emptyDevice);

    assert.not(plan.ok);
    assert.equal(plan.why, WHY.NO_KEYRING);
  });

  test('refuses a store this version has never heard of', () => {
    // An archive outlives the version that wrote it. Writing rows into a store
    // whose shape nobody here knows is how a restore corrupts a database it
    // was meant to rescue.
    const body = buildBody({ stores: { ...stores(), spaceship: [{ id: 's1' }] }, entities });
    const plan = planRestore(body, emptyDevice);

    assert.not(plan.ok);
    assert.equal(plan.why, WHY.UNKNOWN_STORE);
    assert.deep(plan.unknown, ['spaceship']);
  });
});

/* ------------------------------------------------------------ the real thing */

setSuite('archive · against a real database');

describe('taking one', () => {
  test('refuses a role that cannot read the whole household', async () => {
    // Measured against this schema: an adult reads 37 of 43 entities. A
    // "backup" they took would be missing six entities' worth of records with
    // nothing saying so, and they would find out on the day they restored it.
    // Silent loss wearing the word backup is worse than no backup, because the
    // household has stopped worrying.
    const db = await makeDb({ role: 'adult' });
    const archive = new ArchiveService(db);

    const taken = await archive.gather();
    assert.not(taken.ok);
    assert.equal(taken.why, REFUSED.NOT_OWNER);
    assert.ok(taken.missing.length > 0, 'refused without naming what was missing');
  });

  test('an owner gets every entity, the keyring, the history and the documents', async () => {
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    await makeAccount(db, { name: 'Savings' });

    const taken = await (new ArchiveService(db)).gather();
    assert.ok(taken.ok, taken.why);

    assert.ok(taken.summary.records >= 2, `only ${taken.summary.records} records`);
    assert.ok(taken.body.stores.meta.length > 0, 'no keyring in the archive');
    for (const name of Object.keys(STORES.excluded)) {
      assert.not(name in taken.body.stores, `${name} was archived`);
    }
  });

  test('and the encrypted fields stay encrypted on the way out', async () => {
    // The whole reason for `decrypt: false`. If an archive held plaintext where
    // the database holds an envelope, the file would be a re-recording of the
    // records rather than a copy of them — and the restored rows would no
    // longer match the keyring that travelled with them.
    const db = await makeDb();
    await db.repo('identityDocument').create({
      person: 'per_owner', kind: 'Passport', number: 'Z1234567',
    });

    const taken = await (new ArchiveService(db)).gather();
    const row = taken.body.stores.identityDocument[0];

    assert.ok(String(row.number).startsWith('enc:v1:'),
      `archived in the clear: ${row.number}`);
  });
});

describe('putting one back', () => {
  test('a sealed archive restores onto an empty device, record for record', async () => {
    // The round trip the whole phase exists for, through the real repository
    // on both sides: take it, seal it, open it on a device that has never seen
    // these records, and compare.
    const source = await makeDb();
    await makePerson(source, { name: 'Asha' });
    await makePerson(source, { name: 'Ravi' });
    await makeAccount(source, { name: 'Savings' });

    const taken = await (new ArchiveService(source)).gather();
    const file = await seal(taken.body, PHRASE);

    const target = await makeDb({ personId: 'per_other' });
    // A fresh device of its own — everything in it has to go, or the restore
    // would be refusing for the right reason and proving nothing.
    for (const name of ['person', 'account']) {
      for (const row of await target.repo(name).list({ includeDeleted: true })) {
        await target.adapter.delete(name, row.id);
      }
    }

    const opened = await open(file, PHRASE);
    assert.ok(opened.ok, opened.why);

    const restored = await (new ArchiveService(target)).restore(opened.body);
    assert.ok(restored.ok, restored.why);
    assert.ok(restored.relock, 'a restore that replaced the keyring must relock');

    // Nothing is readable until somebody unlocks again, and that is right: the
    // keys this device was holding belong to records it no longer has.
    await target.keyring.unlockWithPin('482913');

    const people = await target.repo('person').list({ includeDeleted: true });
    assert.deep(people.map((p) => p.name).sort(), ['Asha', 'Ravi']);

    const accounts = await target.repo('account').list({});
    assert.length(accounts, 1);
    assert.equal(accounts[0].name, 'Savings');
  });

  test('and the encrypted fields open again, with the archive’s own key', async () => {
    // The check that matters, and the one this suite did not have. Restoring
    // the rows without the keyring passed every other test here: the names all
    // matched, the counts all matched, and every encrypted field on the device
    // was ciphertext nobody would ever open again. A household would have found
    // out on the day they needed a passport number.
    //
    // So this restores, relocks, unlocks with the PIN the archive was taken
    // under, and reads the field back. Nothing short of that distinguishes a
    // restore from a very tidy way of losing data.
    const PIN = '482913';
    const source = await makeDb({ pin: PIN });
    await source.repo('identityDocument').create({
      person: 'per_owner', kind: 'Passport', number: 'Z1234567',
    });

    const taken = await (new ArchiveService(source)).gather();
    const opened = await open(await seal(taken.body, PHRASE), PHRASE);
    assert.ok(opened.ok, opened.why);

    // A device with its own keyring and its own, different data key.
    const target = await makeDb({ pin: PIN, personId: 'per_other' });
    for (const name of ['person', 'identityDocument']) {
      for (const row of await target.repo(name).list({ includeDeleted: true })) {
        await target.adapter.delete(name, row.id);
      }
    }

    const outcome = await (new ArchiveService(target)).restore(opened.body);
    assert.ok(outcome.ok, outcome.why);

    // The session is still holding the target's original key, which is wrong
    // about every envelope that just arrived. This is what `relock` means.
    target.keyring.lock();
    await target.keyring.unlockWithPin(PIN);

    const docs = await target.repo('identityDocument').list({});
    assert.length(docs, 1);
    assert.equal(docs[0].number, 'Z1234567',
      'the archive restored rows whose encryption no key on this device opens');
  });

  test('refuses a device that already holds records, and says how many', async () => {
    const source = await makeDb();
    await makePerson(source, { name: 'Asha' });
    const taken = await (new ArchiveService(source)).gather();

    const target = await makeDb();
    await makePerson(target, { name: 'Somebody else' });

    const outcome = await (new ArchiveService(target)).restore(taken.body);
    assert.not(outcome.ok);
    assert.equal(outcome.why, WHY.NOT_EMPTY);
    assert.ok(outcome.holding > 0);
  });
});

describe('who may read the system stores', () => {
  test('an owner may', async () => {
    const db = await makeDb();
    const rows = await db.systemStoreRows('meta');
    assert.ok(Array.isArray(rows));
  });

  test('a child may not — they are the household with no filter in front', async () => {
    // meta is the keyring, audit is every action anybody has taken, blobs are
    // the documents. This is the hole the service-layer rule exists to close,
    // and the one place system stores are reachable at all.
    const db = await makeDb({ role: 'child' });
    let threw = null;
    try {
      await db.systemStoreRows('audit');
    } catch (err) {
      threw = err;
    }
    assert.ok(threw, 'a child read the audit log');
  });

  test('and no store outside the archive is reachable through it', async () => {
    const db = await makeDb();
    let threw = null;
    try {
      await db.systemStoreRows('outbox');
    } catch (err) {
      threw = err;
    }
    assert.ok(threw, 'the outbox was readable through the archive path');
  });
});


setSuite('archive · reading it back');

describe('verifying what was just written', () => {
  test('a sealed file opens again and holds what went in', async () => {
    const body = buildBody({ stores: stores(), entities });
    const file = await seal(body, PHRASE);

    const checked = await verify(file, PHRASE, describeBody(body));
    assert.ok(checked.ok, checked.why);
  });

  test('a file that cannot be opened is not called a backup', async () => {
    // The failure this exists for. Sealing can go wrong in ways nothing else
    // notices — a truncated write, an encoder that mangled a name — and the
    // household would find out on the day the phone was gone.
    const body = buildBody({ stores: stores(), entities });
    const file = await seal(body, PHRASE);

    const damaged = { ...file, body: file.body.slice(0, Math.floor(file.body.length / 2)) };
    const checked = await verify(damaged, PHRASE, describeBody(body));

    assert.not(checked.ok);
    assert.equal(checked.why, WHY.WRONG_PHRASE);
  });

  test('a file holding fewer records than went in is refused, and counted', async () => {
    const body = buildBody({ stores: stores(), entities });
    const file = await seal(body, PHRASE);

    // Verified against an expectation of more than it contains.
    const checked = await verify(file, PHRASE, { records: 99, documents: 1 });

    assert.not(checked.ok);
    assert.equal(checked.why, WHY.UNVERIFIABLE);
    assert.equal(checked.expected, 99);
    assert.equal(checked.found, 3);
  });

  test('taking one records when it happened, and it travels in the next archive', async () => {
    // A backup nobody remembers to take is close to a backup nobody has. The
    // date lives in meta, so a restored device knows when the file it came
    // from was made rather than looking as though it never had one.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    const archive = new ArchiveService(db);

    assert.equal(await archive.lastTaken(), null, 'a fresh device claims a backup');

    const taken = await archive.take(PHRASE);
    assert.ok(taken.ok, taken.why);

    const when = await archive.lastTaken();
    assert.ok(when, 'taking a backup did not record that it happened');

    const again = await archive.take(PHRASE);
    const carried = again.file && (await open(again.file, PHRASE));
    const metaRows = carried.body.stores.meta;
    assert.ok(metaRows.some((r) => r.key === 'backup.lastTakenAt'),
      'the date did not travel inside the archive');
  });

  test('take reads the file back, and refuses one it cannot', async () => {
    // The check that was missing. Removing the verification from `take` passed
    // all thirty tests here: `verify` was covered on its own, `take` was
    // covered on a path where nothing went wrong, and the wiring between them
    // was covered by neither. This seals through something that truncates the
    // result, so the only way to pass is to have actually read it back.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });

    const truncating = async (body, phrase) => {
      const good = await seal(body, phrase);
      return { ...good, body: good.body.slice(0, 24) };
    };

    const taken = await (new ArchiveService(db)).take(PHRASE, { sealWith: truncating });

    assert.not(taken.ok, 'a file that cannot be opened was offered as a backup');
    assert.equal(taken.file, undefined);
  });

  test('and does not record a backup that failed to verify', async () => {
    // Worse than not taking one: the card would say a backup exists.
    const db = await makeDb();
    await makePerson(db, { name: 'Asha' });
    const archive = new ArchiveService(db);

    const truncating = async (body, phrase) => {
      const good = await seal(body, phrase);
      return { ...good, body: good.body.slice(0, 24) };
    };

    await archive.take(PHRASE, { sealWith: truncating });
    assert.equal(await archive.lastTaken(), null,
      'a backup that could not be read back was recorded as taken');
  });

  test('take refuses a role that cannot read the household, before sealing anything', async () => {
    const db = await makeDb({ role: 'adult' });
    const taken = await (new ArchiveService(db)).take(PHRASE);

    assert.not(taken.ok);
    assert.equal(taken.file, undefined, 'a partial backup was sealed anyway');
  });
});
