import { test, describe, assert, setSuite } from './harness.mjs';
import {
  buildBody, describeBody, seal, open, planRestore,
  ARCHIVE_VERSION, MAGIC, STORES, WHY,
} from '../js/domain/archive.js';

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
