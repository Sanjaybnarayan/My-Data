import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite, fakeStorage, fakeClock } from './harness.mjs';
import { formats } from '../js/data/formats.js';
import { makeDb, makePerson } from './fixture.mjs';
import {
  encryptText, decryptText, isEncrypted, generateDataKey, deriveKeyEncryptionKey,
  wrapDataKey, unwrapDataKey, newSalt, generatePassword, generatePassphrase,
  passwordEntropy, passwordStrength, timingSafeEqual, toBase64, fromBase64,
} from '../js/security/crypto.js';
import { Keyring } from '../js/security/keyring.js';
import {
  can, assertCan, rowFilter, readScope, visibleEntities, visibleModules, atLeast, SUBJECT_FIELD,
} from '../js/security/rbac.js';
import { validate } from '../js/data/validate.js';
import { Session, AttemptLimiter, memoryStorage } from '../js/security/session.js';
import {
  escapeForSheet, unescapeFromSheet, escapeCsv, stripTags, safeUrl, safeFileName,
  sanitizeHtml, escapeHtml,
} from '../js/security/sanitize.js';
import { modules, entities, entitiesOfModule, entityNames, ROLES } from '../js/data/schema.js';
import { pinFloor } from '../js/auth/lock.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

setSuite('security');

/** A meta store backed by a Map, so the keyring can be tested on its own. */
function metaStore() {
  const map = new Map();
  return { get: async (k) => map.get(k) ?? null, set: async (k, v) => void map.set(k, v) };
}

describe('crypto', () => {
  test('a round trip returns exactly what went in', async () => {
    const key = await generateDataKey();
    const secret = 'ABCDE1234F — with unicode ₹ and a newline\n';
    const sealed = await encryptText(key, secret, 'ctx');
    assert.ok(isEncrypted(sealed));
    assert.equal(await decryptText(key, sealed, 'ctx'), secret);
  });

  test('the same plaintext seals differently every time', async () => {
    const key = await generateDataKey();
    const a = await encryptText(key, 'same', 'ctx');
    const b = await encryptText(key, 'same', 'ctx');
    assert.notEqual(a, b, 'a repeated nonce would leak that two fields are equal');
  });

  /*
   * A prefix is not an envelope, and `isEncrypted` is asked on both sides.
   *
   * `fieldcrypto.js` skips a value that "is encrypted" on the way in so as not
   * to double-wrap, and tries to decrypt one on the way out. When seven
   * characters decided both, a household typing `enc:v1:AAAA:BBBB` into a free
   * text encrypted field — a diagnosis, a nominee, a vault secret — had it
   * stored **verbatim in the clear** and read back as **the empty string**.
   *
   * Both halves wrong, and they compound: the field the schema marks encrypted
   * syncs to the spreadsheet unencrypted, and the blank the read produced is
   * merged over the row by the next update, so the text is gone for good.
   */
  describe('a value that only looks like an envelope', () => {
    const SHAPED = 'enc:v1:AAAA:BBBB';

    test('is not mistaken for one', () => {
      assert.not(isEncrypted(SHAPED), 'a four-character IV passed as a twelve-byte one');
      assert.not(isEncrypted('enc:v1:'), 'the bare prefix passed');
      assert.not(isEncrypted('enc:v1:AAAAAAAAAAAAAAAA'), 'an envelope with no body passed');
      assert.not(isEncrypted('enc:v1:AAAAAAAAAAAAAAAA:AA:AA'), 'three parts passed as two');
      assert.not(isEncrypted('enc:v1:................:AAAA'), 'a non-base64 IV passed');
    });

    test('and what this application really produces still is', async () => {
      // The half that matters more. A check tightened until it rejects
      // everything would satisfy the test above and take the feature with it.
      const key = await generateDataKey();
      for (const text of ['', 'x', 'a longer secret with ₹ and a newline\n', SHAPED]) {
        assert.ok(isEncrypted(await encryptText(key, text, 'ctx')),
          `a real envelope for ${JSON.stringify(text)} was not recognised`);
      }
    });

    test('so it is sealed on the way in and returned intact on the way out', async () => {
      const db = await makeDb();
      const person = await makePerson(db);
      const record = await db.repo('healthRecord').create({
        person: person.id, kind: 'diagnosis', title: 'Shaped', diagnosis: SHAPED,
      });

      const raw = await db.adapter.read('healthRecord', record.id);
      assert.notEqual(raw.diagnosis, SHAPED,
        'a field the schema marks encrypted was stored in the clear');
      assert.ok(isEncrypted(raw.diagnosis), 'it was not sealed at all');

      const back = await db.repo('healthRecord').get(record.id);
      assert.equal(back.diagnosis, SHAPED, 'what the household typed did not come back');
      assert.not(back._undecryptable, 'it was reported as damaged');
    });
  });

  test('the wrong context will not decrypt', async () => {
    const key = await generateDataKey();
    const sealed = await encryptText(key, 'secret', 'person:1:pan');
    await assert.throws(() => decryptText(key, sealed, 'person:2:pan'));
  });

  test('a tampered ciphertext is rejected, not silently mangled', async () => {
    const key = await generateDataKey();
    const sealed = await encryptText(key, 'secret', 'ctx');
    const [prefix, iv, ct] = [sealed.slice(0, 7), ...sealed.slice(7).split(':')];
    const bytes = fromBase64(ct);
    bytes[0] ^= 0xff;
    await assert.throws(() => decryptText(key, `${prefix}${iv}:${toBase64(bytes)}`, 'ctx'));
  });

  test('clear text passes through decrypt untouched', async () => {
    const key = await generateDataKey();
    assert.equal(await decryptText(key, 'not sealed'), 'not sealed');
  });

  test('a data key wraps and unwraps under a derived key', async () => {
    const dataKey = await generateDataKey();
    const salt = newSalt();
    const kek = await deriveKeyEncryptionKey('1234', salt, 1000);
    const wrapped = await wrapDataKey(dataKey, kek);

    const same = await deriveKeyEncryptionKey('1234', salt, 1000);
    const recovered = await unwrapDataKey(wrapped, same);
    const sealed = await encryptText(dataKey, 'x', 'c');
    assert.equal(await decryptText(recovered, sealed, 'c'), 'x');
  });

  test('the wrong PIN fails to unwrap', async () => {
    const dataKey = await generateDataKey();
    const salt = newSalt();
    const wrapped = await wrapDataKey(dataKey, await deriveKeyEncryptionKey('1234', salt, 1000));
    const wrong = await deriveKeyEncryptionKey('1235', salt, 1000);
    await assert.throws(() => unwrapDataKey(wrapped, wrong));
  });

  test('base64 survives arbitrary bytes', () => {
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) % 256);
    assert.deep([...fromBase64(toBase64(bytes))], [...bytes]);
  });

  test('generated passwords honour the requested set', () => {
    const p = generatePassword({ length: 32, symbols: false });
    assert.equal(p.length, 32);
    assert.not(/[^a-zA-Z0-9]/.test(p));
    assert.not(/[Il1O0]/.test(p), 'ambiguous characters are excluded by default');
  });

  test('generated passwords do not repeat', () => {
    const seen = new Set(Array.from({ length: 500 }, () => generatePassword({ length: 16 })));
    assert.equal(seen.size, 500);
  });

  test('a passphrase has the requested number of words', () => {
    assert.length(generatePassphrase(5).split('-'), 5);
  });

  test('entropy discounts a repeated character', () => {
    assert.ok(passwordEntropy('aaaaaaaaaaaa') < passwordEntropy('correcthorse'));
    assert.equal(passwordStrength('').score, 0);
    assert.ok(passwordStrength(generatePassword({ length: 20 })).score >= 3);
  });

  test('constant-time compare still compares correctly', () => {
    assert.ok(timingSafeEqual('abc', 'abc'));
    assert.not(timingSafeEqual('abc', 'abd'));
    assert.not(timingSafeEqual('abc', 'abcd'));
    assert.not(timingSafeEqual('abc', null));
  });

  test('a trailing NUL is a difference, which is what the length term is for', () => {
    /*
     * `let diff = a.length ^ b.length` was doing work nothing measured.
     * Removing it passed all 3,532 checks, because the length case above is
     * `'abc'` against `'abcd'` — where the extra character is `d`, so the
     * content comparison catches it whether or not the lengths were mixed in.
     *
     * The extra character has to be **NUL** to need the length term. The loop
     * reads past the end as `charCodeAt(i) || 0`, so a missing character and a
     * `\0` are the same number, and without the length term
     * `timingSafeEqual('abc', 'abc\0')` came back **true**.
     *
     * Its one caller compares base64, where lengths match and NUL cannot
     * appear, so nothing is broken today. It is an exported primitive named
     * for a security property, and the next caller will not be base64.
     */
    assert.not(timingSafeEqual('abc', 'abc\u0000'));
    assert.not(timingSafeEqual('abc\u0000', 'abc'));
    assert.not(timingSafeEqual('abc', 'abc\u0000\u0000'));
    assert.not(timingSafeEqual('', '\u0000'));
    // And the empty pair is still equal, so the guard is a guard and not a
    // refusal of anything short.
    assert.ok(timingSafeEqual('', ''));
  });
});

describe('keyring', () => {
  test('enrolling twice would orphan the first key, so it is refused', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    await assert.throws(() => ring.enrolPin('999111'), 'already has a data key');
  });

  test('a weak PIN is refused', async () => {
    const ring = new Keyring(metaStore(), 1000);
    // Six is the floor now, so four digits is refused on length before any
    // of the shape rules are reached. The repeated-digit and consecutive-run
    // cases are therefore written at six, or they would be testing the length
    // check twice and the rules they name not at all.
    await assert.throws(() => ring.enrolPin('11111'), '6 to 12 digits');
    await assert.throws(() => ring.enrolPin('1234'), '6 to 12 digits');
    await assert.throws(() => ring.enrolPin('111111'), 'repeated digit');
    await assert.throws(() => ring.enrolPin('123456'), 'consecutive');
    await assert.throws(() => ring.enrolPin('abc'), '6 to 12 digits');
  });

  test('locking really removes the ability to decrypt', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    assert.ok(ring.isUnlocked);
    ring.lock();
    assert.not(ring.isUnlocked);
    assert.throws(() => ring.key, 'locked');
  });

  test('changing the PIN does not re-encrypt anything', async () => {
    const meta = metaStore();
    const ring = new Keyring(meta, 1000);
    await ring.enrolPin('482913');
    const sealed = await encryptText(ring.key, 'passport number', 'ctx');

    await ring.changePin('482913', '739205');
    ring.lock();
    await ring.unlockWithPin('739205');
    assert.equal(await decryptText(ring.key, sealed, 'ctx'), 'passport number',
      'the data key must survive a PIN change');
  });

  test('the old PIN stops working after a change', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    await ring.changePin('482913', '739205');
    ring.lock();
    await assert.throws(() => ring.unlockWithPin('482913'), 'not right');
  });

  test('a recovery phrase unlocks the same data key', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    const sealed = await encryptText(ring.key, 'secret', 'ctx');
    await ring.createRecoveryKey('amber-anchor-basil-cedar-coral');

    ring.lock();
    await ring.unlockWithRecoveryPhrase('amber-anchor-basil-cedar-coral');
    assert.equal(await decryptText(ring.key, sealed, 'ctx'), 'secret');
  });

  test('a second unlock method wraps the same key', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    const sealed = await encryptText(ring.key, 'secret', 'ctx');

    const rawKey = new Uint8Array(32).fill(7);
    await ring.addMethod('webauthn', { rawKey, label: 'Fingerprint' });
    ring.lock();
    await ring.unlockWithRawKey(rawKey);
    assert.equal(await decryptText(ring.key, sealed, 'ctx'), 'secret');
    assert.length(await ring.methods(), 2);
  });

  test('the last unlock method cannot be removed', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    await assert.throws(() => ring.removeMethod('pin'), 'last unlock method');
  });
});

describe('roles', () => {
  const owner = { personId: 'p1', role: 'owner' };
  const adult = { personId: 'p2', role: 'adult' };
  const child = { personId: 'p3', role: 'child' };
  const guest = { personId: 'p4', role: 'guest' };

  /*
   * `isRole` is the first line of `can` and the first line of `readScope`, and
   * removing it from either passed all 3,518 checks in this repository. The
   * code was right; nothing was holding it right.
   *
   * What it holds: without the guard an unrecognised role stops being refused
   * outright and falls through to the own-record rule at the bottom, so an
   * actor carrying `role: 'superadmin'` — or no role at all — gets **read and
   * write on its own records**, where before it got nothing. And an
   * unrecognised role is not hypothetical: `actor.role` comes off a `member`
   * row, and nothing validates a synced row against its schema
   * (`docs/THREAT_MODEL.md` T4.7).
   */
  const strangers = [
    { personId: 'p9', role: 'superadmin' },
    { personId: 'p9', role: 'admin' },
    { personId: 'p9', role: 'OWNER' },
    { personId: 'p9', role: '' },
    { personId: 'p9', role: null },
    { personId: 'p9' },
    { personId: 'p9', role: 1 },
    { personId: 'p9', role: ['owner'] },
  ];

  test('a role this application does not have is refused, not fallen through', () => {
    /*
     * The record has to be genuinely about the actor or this check is
     * vacuous, which the first draft was: it used `{ personId: 'p9' }`, and
     * `SUBJECT_FIELD.task` is `assignee`, so `isAbout` was false whatever the
     * guard did and the mutation sailed through the check written for it.
     * Every own-record entity, by its own subject field, so no single
     * mismatch can hide the same way again.
     */
    for (const stranger of strangers) {
      const label = JSON.stringify(stranger.role);
      for (const [entityName, field] of Object.entries(SUBJECT_FIELD)) {
        const own = { [field]: 'p9' };
        assert.not(can(stranger, 'read', entityName, own),
          `${label} read its own ${entityName}`);
        assert.not(can(stranger, 'write', entityName, own),
          `${label} wrote its own ${entityName}`);
      }
      assert.not(can(stranger, 'read', 'transaction'), `${label} read a transaction`);
    }
  });

  test('an owner really can read their own task, so the check above means something', () => {
    // The other half of the same fixture. Without this, a `can` that refused
    // everything would satisfy every assertion above.
    assert.ok(can(owner, 'read', 'task', { assignee: 'p1' }));
    assert.ok(can(child, 'read', 'task', { assignee: 'p3' }), 'a child owns their own task');
    assert.not(can(child, 'read', 'task', { assignee: 'p1' }), "and not a sibling's");
  });

  test('a role reached through the prototype is not a role', () => {
    // `RANK` is an object, so `RANK['constructor']` is a function rather than
    // undefined. `Object.hasOwn` is what keeps that from being a role, and
    // `RANK[role] !== undefined` in its place passes every other check here.
    for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty',
      '__proto__', 'isPrototypeOf']) {
      const stranger = { personId: 'p9', role: inherited };
      assert.not(can(stranger, 'read', 'task', { assignee: 'p9' }), inherited);
      assert.equal(readScope(stranger, 'task'), 'none', inherited);
    }
  });

  test('and reads nothing, through readScope and everything built on it', () => {
    // The same guard, duplicated in `readScope`, and it was equally unheld.
    // `rowFilter` and `visibleEntities` are both built on it, so this is the
    // list query and the navigation as well as the predicate.
    for (const stranger of strangers) {
      assert.equal(readScope(stranger, 'task'), 'none',
        `${JSON.stringify(stranger.role)} had a read scope on task`);
      assert.not(rowFilter(stranger, 'task')({ personId: 'p9' }),
        `${JSON.stringify(stranger.role)} passed the list filter`);
      assert.length(visibleEntities(stranger), 0,
        `${JSON.stringify(stranger.role)} could see entities`);
    }
  });

  test('and nothing at all is not an actor either', () => {
    for (const nobody of [null, undefined]) {
      assert.not(can(nobody, 'read', 'task'));
      assert.equal(readScope(nobody, 'task'), 'none');
    }
  });

  test('rank order runs owner to guest', () => {
    assert.ok(atLeast('owner', 'adult'));
    assert.not(atLeast('child', 'adult'));
    assert.ok(atLeast('adult', 'adult'));
  });

  test('only owners touch the vault', () => {
    assert.ok(can(owner, 'write', 'vaultItem'));
    assert.not(can(adult, 'read', 'vaultItem'));
    assert.not(can(child, 'read', 'vaultItem'));
  });

  test('an adult may record spending but not rewrite identity documents', () => {
    assert.ok(can(adult, 'read', 'transaction'));
    assert.not(can(adult, 'write', 'transaction'), 'money is owner-and-spouse only');
    assert.not(can(adult, 'read', 'identityDocument'));
  });

  test('a child sees their own health record and nobody else', () => {
    const mine = { person: 'p3', title: 'Check-up' };
    const theirs = { person: 'p9', title: 'Check-up' };
    assert.ok(can(child, 'read', 'healthRecord', mine));
    assert.not(can(child, 'read', 'healthRecord', theirs));
  });

  test('a child cannot write their own person row, matching the server', () => {
    // The server's OWN_RECORD table deliberately omits `person`: if somebody
    // could write their own person row through the own-record rule, they could
    // change the field the server uses to identify them (the member-to-person
    // binding), making that binding no longer owner-controlled.
    //
    // The browser now agrees: a child writing their own person row is refused
    // here, so the push never parks with no explanation in the sync diagnostics.
    //
    // Reading is still allowed — a child can open their own record — because
    // seeing it carries no identity risk.
    const ownPerson = { id: 'p3' };
    assert.ok(can(child, 'read', 'person', ownPerson),
      'a child cannot read their own person record');
    assert.not(can(child, 'write', 'person', ownPerson),
      'a child wrote their own person row; the server refuses it and the push would park');
  });

  test('a guest sees emergency contacts and nothing else', () => {
    assert.ok(can(guest, 'read', 'emergencyContact'));
    assert.not(can(guest, 'read', 'person'));
    assert.not(can(guest, 'write', 'emergencyContact'));
  });

  test('the row filter excludes rows rather than fetching and hiding them', () => {
    const keep = rowFilter(child, 'task');
    assert.ok(keep({ assignee: 'p3' }));
    assert.not(keep({ assignee: 'p1' }));
    assert.not(rowFilter(guest, 'transaction')({}));
  });

  test('an account not yet matched to a person is about nothing', () => {
    // Records built through the real validator, because the fault was two
    // empty strings meeting: `validate.js` normalises an optional `ref` left
    // blank to `''`, and an account the owner has not matched to a person
    // carries `personId: ''`. Inventing the record here would have tested a
    // shape nobody stores.
    const unbound = { personId: '', role: 'child' };
    const task = validate('task', { title: 'Buy milk', status: 'todo' }).record;
    assert.equal(task.assignee, '', 'the validator no longer blanks an unset ref');

    assert.not(can(unbound, 'read', 'task', task));
    assert.not(can(unbound, 'write', 'task', task),
      'an unassigned task was writable by an account with no identity');

    const health = validate('healthRecord', { title: 'Scan', kind: 'report' }).record;
    assert.equal(health.person, '');
    assert.not(can(unbound, 'write', 'healthRecord', health),
      'a health record naming nobody was writable by an account naming nobody');
  });

  test('and no own-record entity lets an unbound account in', () => {
    // Derived from the one table rather than a list of entities to keep in
    // step with it. Every entry is a (role, entity) pair the backend's
    // `ownRecordAllows` has always refused for an empty personId.
    const unbound = { personId: '', role: 'child' };
    for (const [name, field] of Object.entries(SUBJECT_FIELD)) {
      const blank = { [field]: '' };
      assert.not(can(unbound, 'read', name, blank), `${name} was readable`);
      assert.not(can(unbound, 'write', name, blank), `${name} was writable`);
      assert.not(rowFilter(unbound, name)(blank), `${name} survived the list filter`);
    }
  });

  test('matching the account to a person is what grants their own rows', () => {
    // The other direction: the guard must not have shut the door on the
    // access it exists to allow. Before the fix this pair ran backwards —
    // the unbound account saw more than the bound one.
    const bound = { personId: 'p3', role: 'child' };
    const mine = validate('task', { title: 'Homework', status: 'todo', assignee: 'p3' }).record;
    const theirs = validate('task', { title: 'Homework', status: 'todo', assignee: 'p9' }).record;
    assert.ok(can(bound, 'read', 'task', mine));
    assert.not(can(bound, 'read', 'task', theirs));
    assert.ok(rowFilter(bound, 'task')(mine));
    assert.not(rowFilter(bound, 'task')(theirs));
  });

  test('and the repository is where that is enforced, not the predicate', async () => {
    /*
     * `can()` returning false proves the function works and says nothing
     * about the application. Measured through the real door, before the
     * guard existed:
     *
     *     unbound child list()   → 1 row
     *     unbound child update() → ALLOWED
     *
     * A task the household made, listed and rewritten by an account the
     * owner had never matched to anybody.
     */
    const db = await makeDb({ role: 'owner', personId: 'per_owner' });
    const made = await db.repo('task').create({ title: 'Buy milk', status: 'todo' });
    assert.equal(made.assignee, '', 'the fixture no longer stores a blank ref');

    db.setActor({ personId: '', role: 'child' });
    assert.length(await db.repo('task').list(), 0, 'an unbound account listed the row');
    await assert.throws(
      () => db.repo('task').update(made.id, { title: 'Buy biscuits' }),
      'permission',
    );
  });

  test('an unknown role is refused everything', () => {
    assert.not(can({ personId: 'x', role: 'admin' }, 'read', 'person'));
    assert.not(can(null, 'read', 'person'));
  });

  test('the navigation a guest sees is almost empty', () => {
    const seen = visibleModules(guest, modules).map((m) => m.id);
    assert.includes(seen, 'emergency');
    assert.not(seen.includes('finance'));
    assert.ok(visibleEntities(owner).length > visibleEntities(guest).length);
  });

  /*
   * `readScope` is now the one statement of how much of an entity a role may
   * read, and `rowFilter` and `visibleEntities` are built from it. These
   * assert the derivation holds rather than restating the rule: a scope of
   * `all` must pass every row, `none` must pass none, and `own` must pass some
   * and not others. If the three ever disagree again, the referential audit
   * starts calling withheld rows broken, which is what this replaced.
   */
  test('every read scope agrees with the filter built from it', () => {
    const wrong = [];
    for (const actor of [owner, guest, child, adult]) {
      for (const name of Object.keys(entities)) {
        const scope = readScope(actor, name);
        const keep = rowFilter(actor, name);
        const field = SUBJECT_FIELD[name];
        const mine = field ? { [field]: actor.personId } : {};
        const theirs = field ? { [field]: 'per_somebody_else' } : {};

        if (scope === 'all' && !(keep(mine) && keep(theirs))) wrong.push(`${actor.role}/${name} all`);
        if (scope === 'none' && (keep(mine) || keep(theirs))) wrong.push(`${actor.role}/${name} none`);
        if (scope === 'own' && (!keep(mine) || keep(theirs))) wrong.push(`${actor.role}/${name} own`);
        if ((scope !== 'none') !== visibleEntities(actor).includes(name)) {
          wrong.push(`${actor.role}/${name} visible`);
        }
      }
    }
    assert.deep(wrong.slice(0, 8), []);
  });

  /*
   * The schema fact the audit fix turns on, asserted so it is a measurement
   * rather than a sentence in a commit message. A child may read 24 reference
   * fields whose target they may not, and every one of them is a row the
   * server withholds and the audit must not call broken.
   */
  test('a restricted role really does hold references it cannot resolve', () => {
    const unresolvable = [];
    for (const name of Object.keys(entities)) {
      if (readScope(child, name) === 'none') continue;
      for (const f of entities[name].fields ?? []) {
        if (!f.ref || !entities[f.ref]) continue;
        if (readScope(child, f.ref) !== 'all') unresolvable.push(`${name}.${f.key}`);
      }
    }
    assert.ok(unresolvable.length > 10,
      `only ${unresolvable.length} — if this fell to zero the audit fix guards nothing`);
  });

  test('a module lists exactly the entities that name it', () => {
    // These were written twice — once as `module:` on the entity, once as an
    // array here — and the copies drifted. `economicEvent`, `staff` and
    // `staffLeave` named a module that did not list them back.
    const listed = modules.flatMap((m) => m.entities);
    assert.equal(listed.length, new Set(listed).size);
    assert.equal([...listed].sort().join(','), entityNames().slice().sort().join(','));
    for (const m of modules) {
      assert.equal(m.entities.join(','), entitiesOfModule(m.id).map((e) => e.name).join(','));
    }
  });

  test('a role that can read any of a module\'s entities sees the module', () => {
    // This passes with the drifted lists too, because every role that could
    // read `staff` could also read `relationship`. It is here for the case
    // where that stops being true, which is when the drift would have cost
    // somebody a screen rather than merely being wrong.
    for (const m of modules) {
      const members = entitiesOfModule(m.id).map((e) => e.name);
      for (const role of ROLES) {
        const actor = { personId: 'p1', role };
        const readable = members.filter((name) => can(actor, 'read', name));
        if (!readable.length) continue;
        assert.includes(
          visibleModules(actor, modules).map((x) => x.id),
          m.id,
          `${role} can read ${readable.join(', ')} but is not shown ${m.id}`,
        );
      }
    }
  });

  test('a refused write throws rather than returning false', () => {
    assert.throws(() => assertCan(child, 'write', 'transaction'), 'permission');
  });

  test('the repository refuses a write the role may not make', async () => {
    const db = await makeDb({ role: 'child', personId: 'p3' });
    await assert.throws(
      () => db.repo('transaction').create({
        date: '2025-06-01', kind: 'expense', amount: '100', account: 'acc_1',
      }),
      'permission',
    );
  });

  test('a child cannot read another person record through the repository', async () => {
    const db = await makeDb({ role: 'owner', personId: 'p1' });
    const other = await makePerson(db, { name: 'Someone Else' });
    db.setActor({ personId: 'p3', role: 'child' });
    await assert.throws(() => db.repo('person').get(other.id), 'permission');
  });
});

describe('session', () => {
  test('expires only after the idle period, measured from real activity', () => {
    const clock = fakeClock();
    let expired = false;
    const s = new Session({ timeoutMinutes: 15, clock, onExpire: () => { expired = true; } });
    s.start();

    clock.advance(14 * 60_000);
    s.tick();
    assert.not(expired);

    clock.advance(2 * 60_000);
    s.tick();
    assert.ok(expired, 'sixteen idle minutes must lock a fifteen-minute session');
    s.stop();
  });

  test('interaction pushes the deadline out', () => {
    const clock = fakeClock();
    const s = new Session({ timeoutMinutes: 15, clock });
    s.start();
    clock.advance(14 * 60_000);
    s.touch();
    clock.advance(14 * 60_000);
    assert.ok(s.remainingMs > 0, 'a touch at minute fourteen must reset the clock');
    s.stop();
  });
});

describe('attempt limiting', () => {
  test('locks out after the fifth wrong PIN', () => {
    const clock = fakeClock();
    const limiter = new AttemptLimiter({ max: 5, lockoutSeconds: 60, storage: memoryStorage(), clock });
    for (let i = 0; i < 4; i++) limiter.recordFailure();
    limiter.assertAllowed();
    limiter.recordFailure();
    assert.throws(() => limiter.assertAllowed(), 'too many attempts');
  });

  test('the lockout doubles each round', () => {
    const clock = fakeClock();
    const limiter = new AttemptLimiter({ max: 2, lockoutSeconds: 60, storage: memoryStorage(), clock });
    limiter.recordFailure(); limiter.recordFailure();
    assert.equal(limiter.lockedForMs(), 60_000);

    clock.advance(60_000);
    limiter.recordFailure(); limiter.recordFailure();
    assert.equal(limiter.lockedForMs(), 120_000, 'a second lockout lasts twice as long');
  });

  test('the lockout survives a reload', () => {
    const clock = fakeClock();
    const storage = fakeStorage();
    const first = new AttemptLimiter({ max: 1, lockoutSeconds: 60, storage, clock });
    first.recordFailure();

    const second = new AttemptLimiter({ max: 1, lockoutSeconds: 60, storage, clock });
    assert.ok(second.lockedForMs() > 0, 'closing the tab must not clear the lockout');
  });

  test('a success clears the count', () => {
    const limiter = new AttemptLimiter({ max: 5, storage: memoryStorage() });
    limiter.recordFailure();
    limiter.recordSuccess();
    assert.equal(limiter.attemptsLeft, 5);
  });
});

describe('output safety', () => {
  // `escapeForSheet`, `unescapeFromSheet` and `sanitizeHtml` have no caller in
  // the application. These tests prove the functions work and say nothing
  // about what reaches a household's workbook — `tests/backend.test.mjs`
  // covers that, through `defuse()` in the deployed `Sheets.gs`, which is the
  // defence that actually runs. Kept because the functions are kept.
  test('a formula in a payee name is defused for the sheet', () => {
    assert.equal(escapeForSheet('=IMPORTXML("http://evil.test","//x")'),
      '\'=IMPORTXML("http://evil.test","//x")');
    assert.equal(escapeForSheet('+91 98765'), "'+91 98765");
    assert.equal(escapeForSheet('Reliance Fresh'), 'Reliance Fresh');
  });

  test('the sheet escape round-trips', () => {
    for (const value of ['=SUM(A1)', '-5', '@handle', 'plain', '']) {
      assert.equal(unescapeFromSheet(escapeForSheet(value)), value);
    }
  });

  test('a CSV field with a comma or quote is quoted', () => {
    assert.equal(escapeCsv('a,b'), '"a,b"');
    assert.equal(escapeCsv('say "hi"'), '"say ""hi"""');
    assert.equal(escapeCsv('plain'), 'plain');
    assert.equal(escapeCsv('=cmd'), "'=cmd", 'the formula guard applies to CSV too');
  });

  test('stripTags is an extractor, and its output is not safe as markup', () => {
    /*
     * It strips tags and *then* decodes entities, so encoded markup comes back
     * out live. That is correct for what it is for — readable text in a PDF or
     * a spreadsheet cell — and it is why it must never be reached for as a
     * defence. Pinned so the property is a decision rather than a surprise.
     */
    assert.equal(stripTags('&lt;script&gt;alert(1)&lt;/script&gt;'), '<script>alert(1)</script>');
  });

  test('and sanitizeHtml with no DOM does not hand that back', () => {
    // It used to: the no-DOM branch fell through to `stripTags`, so a
    // sanitiser returned live markup in the one context where nothing had
    // parsed it. Every return of that function has to be safe to treat as
    // HTML or the name is a lie.
    const out = sanitizeHtml('&lt;script&gt;alert(1)&lt;/script&gt;', null);
    assert.not(/<script>/.test(out), `a sanitiser returned live markup: ${out}`);
    assert.not(/<[a-z]/i.test(out), out);
  });

  test('escapeHtml covers the five characters that make markup', () => {
    assert.equal(escapeHtml('<a href="x">&\'</a>'),
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
    assert.equal(escapeHtml(''), '');
    assert.equal(escapeHtml(null), '');
  });

  test('a script tag does not survive stripping', () => {
    assert.equal(stripTags('<script>alert(1)</script>hello'), 'hello');
    assert.equal(stripTags('<b>bold</b> text'), 'bold text');
  });

  test('a script URL is refused', () => {
    assert.equal(safeUrl('javascript:alert(1)'), '');
    assert.equal(safeUrl('  JavaScript:alert(1)'), '');
    assert.equal(safeUrl('https://example.com'), 'https://example.com');
    assert.equal(safeUrl('mailto:a@b.com'), 'mailto:a@b.com');
  });

  test('a URL the parser will not take is dropped, not passed through', () => {
    /*
     * `safeUrl` ends in `catch { return '' }`, and returning `text` there
     * instead passed all 3,518 checks. The branch is not dead — seven of
     * sixteen probed inputs reach it — and it is the one that matters when
     * two parsers disagree: this one refuses the string, and the attribute
     * parser that receives it may not.
     */
    for (const broken of ['http://', 'https://', '//', 'http://[', 'https://%',
      'http://:80', 'http://a b']) {
      assert.equal(safeUrl(broken), '', `${broken} was passed through`);
    }
  });

  test('and a relative URL, which parses against the page, is kept', () => {
    // The guard has to be a guard rather than a refusal of anything unusual.
    assert.equal(safeUrl('/records/1'), '/records/1');
    assert.equal(safeUrl('report.html?id=2'), 'report.html?id=2');
  });

  test('and something actually calls it', () => {
    /*
     * The half that was missing.
     *
     * `safeUrl` was written, exported and tested — and imported by nothing.
     * `js/modules/crud.js` rendered a stored `url` field straight into an
     * anchor's href. The form path *is* defended: `data/formats.js` refuses
     * `javascript:` and `data:` when a URL is typed in. But that is not the
     * only way a value gets into the store — `Repository.applyRemote` writes
     * a row arriving from the household's own spreadsheet with no validation
     * at all, on purpose, because a sync that rejected a row would lose it.
     *
     * A test of a function nothing calls proves the function works and says
     * nothing about the application.
     */
    const crud = readFileSync(join(ROOT, 'js/modules/crud.js'), 'utf8');
    assert.includes(crud, 'safeUrl');
    const anchor = crud.slice(crud.indexOf("field.type === 'url'"));
    const line = anchor.slice(0, anchor.indexOf('}\n  }') + 1);
    assert.not(/href: value\b/.test(line), 'crud.js still puts a stored value straight in an href');
  });

  test('the write path refuses what the render path refuses', () => {
    // Two defences, one rule. If `formats.js` started allowing a scheme that
    // `safeUrl` strips, a link would validate on entry and then render inert,
    // which looks like the application losing the value.
    for (const bad of ['javascript:alert(1)', 'data:text/html,x']) {
      assert.equal(safeUrl(bad), '', bad);
      assert.not(formats.url.test(bad), `formats.url accepted ${bad}`);
    }
    for (const good of ['https://example.com', 'http://example.com']) {
      assert.equal(safeUrl(good), good);
      assert.ok(formats.url.test(good), `formats.url rejected ${good}`);
    }
  });

  test('a filename cannot escape its folder', () => {
    assert.not(safeFileName('../../etc/passwd').includes('/'));
    assert.equal(safeFileName(''), 'file');
    assert.ok(safeFileName('Passport — Asha.pdf').length > 0);
  });
});

/* ------------------------------------------------- somebody who works here */

describe('a member of household staff', () => {
  /** A household with an owner, a cook, and records belonging to each. */
  const withStaff = async () => {
    const db = await makeDb();
    const owner = await makePerson(db, { name: 'Owner', role: 'owner' });
    const cook = await makePerson(db, { name: 'Cook', role: 'staff' });

    const employment = await db.repo('staff').create({
      person: cook.id, role: 'Cook', startedOn: '2026-01-01', monthlyPay: 25_000_00,
    });
    const other = await makePerson(db, { name: 'Gardener', role: 'staff' });
    const otherEmployment = await db.repo('staff').create({
      person: other.id, role: 'Gardener', startedOn: '2026-02-01',
    });
    await db.repo('healthRecord').create({
      person: owner.id, date: '2026-08-01', kind: 'consultation', title: 'Private',
    });

    return { db, owner, cook, employment, other, otherEmployment };
  };

  test('is a role the schema knows about', () => {
    assert.ok(ROLES.includes('staff'));
    // Last, so `atLeast` ranks them below a guest rather than above one.
    assert.not(atLeast('staff', 'guest'));
    assert.ok(atLeast('owner', 'staff'));
  });

  test('can read the employment record that is about them', async () => {
    const { db, cook, employment } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    const mine = await db.repo('staff').get(employment.id);
    assert.ok(mine, 'somebody could not see their own employment record');
    assert.equal(mine.role, 'Cook');
  });

  test('and cannot read anybody else’s', async () => {
    const { db, cook, otherEmployment } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    const theirs = await db.repo('staff').get(otherEmployment.id).catch(() => null);
    assert.not(theirs, 'one member of staff could read another’s record');
  });

  test('a list returns only their own row, filtered by the query', async () => {
    // Filtered rather than fetched-and-hidden: the rows must not be read off
    // disk at all.
    const { db, cook } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    const rows = await db.repo('staff').list({ limit: 50 });
    assert.length(rows, 1);
    assert.equal(rows[0].person, cook.id);
  });

  test('and the household’s own records are not visible at all', async () => {
    // The thing that made showing somebody their record impossible before:
    // there was no way to do it without handing over everything.
    const { db, cook } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    assert.length(await db.repo('healthRecord').list({ limit: 50 }), 0);
    assert.length(await db.repo('transaction').list({ limit: 50 }), 0);
    assert.length(await db.repo('account').list({ limit: 50 }), 0);
  });

  test('they can see themselves, and not the rest of the household', async () => {
    const { db, cook } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    const people = await db.repo('person').list({ limit: 50 });
    assert.length(people, 1);
    assert.equal(people[0].id, cook.id);
  });

  test('writing anything of the household’s is refused', async () => {
    const { db, cook } = await withStaff();
    db.setActor({ personId: cook.id, role: 'staff' });

    let threw = false;
    try {
      await db.repo('account').create({ name: 'Theirs', kind: 'savings' });
    } catch { threw = true; }
    assert.ok(threw, 'a staff role created a household account');
  });

  test('their leave is not visible, and that is a stated limit', async () => {
    // Row-level filtering needs the subject named on the row, and a leave row
    // names the employment record. Denormalising a `person` column onto it to
    // make this work would be a second copy of who a leave belongs to.
    const { db, cook, employment } = await withStaff();
    await db.repo('staffLeave').create({
      staff: employment.id, from: '2026-03-01', to: '2026-03-05', kind: 'leave', paid: true,
    });

    db.setActor({ personId: cook.id, role: 'staff' });
    assert.length(await db.repo('staffLeave').list({ limit: 50 }), 0,
      'if this starts passing, docs/OWN_RECORDS.md and rbac.js both need changing');
  });

  test('the backend policy agrees, because it is generated from this one', async () => {
    // Two tables describing one set of permissions will disagree. The client
    // list is the source and `tools/policy.mjs` writes the server's copy.
    const { readFileSync } = await import('node:fs');
    const generated = readFileSync(
      new URL('../apps-script/Policy.gs', import.meta.url), 'utf8',
    );
    assert.ok(/['"]staff['"]/.test(generated),
      'the backend policy does not know about the staff role');
  });
});

describe('showing somebody what is held about them', () => {
  test('lists exactly what the role permits, and nothing else', async () => {
    // Filtered through the real `rowFilter`, so this cannot drift from what
    // the role actually allows. A second hand-written idea of "what staff may
    // see" would be a second answer to one question.
    const { RecordsService } = await import('../js/services/records.js');
    const db = await makeDb();

    const owner = await makePerson(db, { name: 'Owner', role: 'owner' });
    const cook = await makePerson(db, { name: 'Cook', role: 'staff' });
    const employment = await db.repo('staff').create({
      person: cook.id, role: 'Cook', startedOn: '2026-01-01',
    });
    await db.repo('healthRecord').create({
      person: owner.id, date: '2026-08-01', kind: 'consultation', title: 'Private',
    });
    await db.repo('staffLeave').create({
      staff: employment.id, from: '2026-03-01', to: '2026-03-05', kind: 'leave', paid: true,
    });

    const held = await new RecordsService(db).whatIsHeldAbout(cook.id);
    const shown = JSON.stringify(held.held);

    assert.includes(shown, 'Cook');
    assert.not(shown.includes('Private'), 'the household’s own records were shown');
    assert.not(shown.includes('Owner'), 'another person was shown');
  });

  test('and names what is held but not shown, rather than omitting it', async () => {
    // A list of what somebody may see is only half an answer to "what do you
    // hold about me". The household holds their leave and the role cannot
    // reach it, so the answer says so.
    const { RecordsService } = await import('../js/services/records.js');
    const db = await makeDb();
    const cook = await makePerson(db, { name: 'Cook', role: 'staff' });
    await db.repo('staff').create({ person: cook.id, role: 'Cook', startedOn: '2026-01-01' });

    const held = await new RecordsService(db).whatIsHeldAbout(cook.id);
    assert.ok(held.notShown.length, 'nothing was admitted to be held but unseen');
    // The schema calls them Absences. Asserted by the label the schema gives
    // rather than the word I expected, so a rename shows up here as a change
    // to make rather than a test quietly matching nothing.
    const { entity } = await import('../js/data/schema.js');
    assert.includes(held.notShown, entity('staffLeave').labels.many);
  });

  test('somebody with nothing held about them gets an empty answer, not an error', async () => {
    const { RecordsService } = await import('../js/services/records.js');
    const db = await makeDb();
    const held = await new RecordsService(db).whatIsHeldAbout('per_nobody');
    assert.length(held.held, 0);
  });
});

/**
 * The audit log records that somebody opened a secret. `Repository#get` takes
 * an option that suppresses that entry, and an option like this is worth
 * exactly what the list of callers is worth — one careless `logRead: false`
 * on a screen that really does show a vault item and the guarantee is gone
 * with nothing failing.
 *
 * So the list is checked rather than trusted, and the check is a sweep of the
 * source rather than a list written down beside it.
 */
describe('who may open a secret without saying so', () => {
  /** Every `.js` under `js/`, as `path -> text`. */
  async function sources() {
    const { readdir, readFile } = await import('node:fs/promises');
    const out = new Map();
    const walk = async (dir) => {
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, item.name);
        if (item.isDirectory()) await walk(full);
        else if (item.name.endsWith('.js')) out.set(full.slice(ROOT.length + 1), await readFile(full, 'utf8'));
      }
    };
    await walk(join(ROOT, 'js'));
    return out;
  }

  test('only the timeline names the option, and only to title a record', async () => {
    const files = await sources();
    // The sweep is worth what it read. An empty walk names nothing and would
    // pass with the option scattered everywhere.
    assert.ok(files.size >= 100, `only ${files.size} modules were swept`);
    assert.ok(files.has('js/data/repository.js'), 'the file defining the option was not read');

    const named = [...files]
      .filter(([, text]) => /logRead/.test(text))
      .map(([path]) => path)
      .sort();

    assert.deep(named, ['js/data/repository.js', 'js/services/timeline.js']);
  });

  test('and it is the title lookup that passes it, not a screen', async () => {
    const files = await sources();
    const timeline = files.get('js/services/timeline.js') ?? '';

    assert.length(timeline.match(/logRead:\s*false/g) ?? [], 1,
      'the timeline service silences exactly one lookup');
    // In `#titles`, which resolves a record to what a person calls it — not in
    // `recent` or `history`, which is where a screen would reach for one.
    const inTitles = timeline.slice(timeline.indexOf('async #titles('));
    assert.includes(inTitles, 'logRead: false',
      'the suppressed read must be the one made to name a record');
  });
});

/* ------------------------------------------------------------- PIN floors */

describe('what erasing a device says about the key that survives it', () => {
  /*
   * "Erase FamilyOS from this device?" is honest about the Drive copy: it says
   * in as many words that anything already synced stays in Google Sheets and
   * Drive. A household reads that and concludes the remaining exposure is their
   * own Google account.
   *
   * If sign-in by code is on, it is not. Their Apps Script deployment holds the
   * wrapped data key *and*, in the same property store, the secret that unwraps
   * it — `security/codeescrow.js` says so in its opening paragraphs. So the
   * Drive copy that survives the wipe stays readable by that deployment, and
   * the sentence naming Sheets and Drive is true and incomplete in the one
   * place a household is deciding what remains.
   *
   * Erasing cannot remove it. `CodeEscrow#drop` is a network call, and this
   * runs on a device that may be offline and is about to destroy its own keys;
   * a best-effort drop that quietly failed would be worse than saying nothing,
   * because the screen would then imply the key is gone. So the screen names
   * the escrow and points at the switch instead.
   *
   * Source-level, because the sentence is assembled inside a modal flow. What
   * it protects is that the warning cannot be deleted without a test going red
   * — which is exactly what happened when it was written: removing it left all
   * 3356 checks green.
   */
  const eraseSource = () =>
    readFileSync(join(ROOT, 'js/modules/settings/data.js'), 'utf8');

  test('names the code escrow when the household has one', () => {
    const source = eraseSource();

    assert.ok(/eraseEscrow/.test(source),
      'the erase confirmation no longer mentions the code escrow — a household '
      + 'wiping this device would not be told that a key which opens what stays '
      + 'in Drive is still held by their Apps Script deployment');

    assert.ok(/CODE_METHOD/.test(source),
      'the erase flow no longer checks whether a code escrow exists');
  });

  test('and says it only when one exists', () => {
    // Warning every household about an escrow most of them never turned on
    // would be its own kind of dishonesty, and the noise costs the warning its
    // force where it is true.
    const source = eraseSource();
    assert.ok(/escrowed\s*\?/.test(source),
      'the escrow warning is no longer conditional on there being an escrow');
  });
});

describe('where the PIN floor is actually enforced', () => {
  const keyringSource = () =>
    readFileSync(join(ROOT, 'js/security/keyring.js'), 'utf8');

  /*
   * The hole this closes.
   *
   * Raising the floor in `js/auth/lock.js` raised it on the lock screen and
   * nowhere else. Settings' "Change PIN" calls `keyring.changePin`, which
   * validates through `assertPin` — and that still read four. So a household
   * could set a four-digit PIN through Settings on the same build whose
   * enrolment screen refused one, and the claim "a PIN being chosen must clear
   * six" was false for the path most likely to be used by somebody acting on
   * the advice to lengthen their PIN.
   *
   * It went unnoticed because the audit recorded "there is no PIN-change
   * screen", which was simply wrong: `js/modules/settings/security.js` has had
   * one. That sentence reached two security documents and a merged commit
   * message before anybody opened the file.
   */
  test('the keyring refuses a five-digit PIN when one is chosen', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await assert.throws(() => ring.enrolPin('12358'), '6 to 12 digits');
  });

  test('and refuses one on the change-PIN path too, not only at enrolment', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    await assert.throws(() => ring.changePin('482913', '12358'), '6 to 12 digits');
  });

  /*
   * Two floors that must not drift.
   *
   * `lock.js` shapes the keypad and gives a message before submission;
   * `keyring.js` decides. A UI floor with a lower floor behind it is not a
   * floor, and a UI floor with a *higher* one behind it is a screen that
   * accepts a PIN and then throws. Either way they have to agree.
   */
  test('the lock screen asks for exactly what the keyring will accept', () => {
    const declared = /const PIN_DIGITS_MIN = (\d+);/.exec(keyringSource())?.[1];
    assert.equal(Number(declared), pinFloor('enrol'),
      'js/auth/lock.js and js/security/keyring.js disagree about the minimum '
      + 'length of a new PIN');
  });

  /*
   * And the reason raising it was safe at all.
   *
   * `unlockWithPin` does not validate shape — it derives a key and lets the
   * unwrap fail. That is what lets an existing four-digit PIN keep working
   * while a new one must be six. Adding a length check to the unlock path
   * would lock every such household out of their own records, with no
   * PIN-change screen reachable because they cannot get in to reach it.
   */
  test('but unlocking never validates the shape of a PIN', () => {
    const source = keyringSource();
    const unlock = source.slice(source.indexOf('async unlockWithPin('));
    const body = unlock.slice(0, unlock.indexOf('\n  }'));

    assert.not(/assertPin/.test(body),
      'unlockWithPin validates the PIN shape — every household whose PIN '
      + 'predates the raised floor would be locked out of their own records');
  });
});



describe('the floor a PIN has to clear', () => {
  /*
   * A four-digit PIN is ten thousand candidates, about 13.3 bits.
   * `security/crypto.js` refuses to soften what that means — "no iteration
   * count fixes that against an attacker who has the wrapped key" — and the
   * keyring's 600,000 PBKDF2-SHA256 iterations turn ten thousand candidates
   * into roughly 6e9 hashes: minutes to hours on one GPU, against an
   * IndexedDB store lifted off a rooted or imaged device. Six digits is a
   * million candidates and costs a hundred times as much.
   */
  test('a PIN being chosen is six digits', () => {
    assert.equal(pinFloor('enrol'), 6);
  });

  /*
   * And the half that is easy to break by "tightening" it.
   *
   * The same length check runs on unlock. Applying the new floor there too
   * looks like the stricter reading and is a permanent lockout for every
   * household whose PIN predates the change: they could no longer type the
   * PIN they have, they cannot reach Settings' PIN-change screen to fix it
   * without getting in first, and the recovery phrase — filed once, on paper,
   * often somewhere unreachable — is the only way back.
   *
   * This is here because the mistake survived everything else. Written inline
   * as a ternary, changing it to the new floor for both modes passed all 3345
   * node checks and the manifest tripwire alike: that tripwire pins the
   * *value* of each floor and says nothing about which mode gets which.
   */
  test('but a PIN already chosen keeps the floor it was made under', () => {
    assert.equal(pinFloor('unlock'), 4);
    assert.notEqual(pinFloor('unlock'), pinFloor('enrol'),
      'unlock must not inherit the raised floor — every household enrolled '
      + 'before it was raised would be locked out of their own records');
  });
});

/**
 * Section 48 of the brief, held rather than measured once.
 *
 * The audit records it as a PASS: *"Repository-wide scan: no API keys, no
 * secrets, no service-account files."* That was a hand measurement, and
 * nothing has held it since — the shape this repository has found more often
 * than any other. The way such a claim stops being true is somebody pasting a
 * key into a config file at midnight, not a decision anybody would review.
 */
describe('nothing committed is a credential', () => {
  test('no tracked file contains one', async () => {
    const { scan } = await import('../tools/secrets.mjs');
    assert.deep(scan(), [], 'rotate it first — it is in the history, not only the tree');
  });

  test('and every pattern still matches its own sample', async () => {
    /*
     * The guard that keeps the check above from being decorative. A regex that
     * stopped matching — an escape mangled by a refactor, a quantifier
     * fat-fingered — leaves a scanner reporting a clean repository whatever is
     * in it, and the run is green either way.
     *
     * This is not hypothetical: while proving the scanner could fail, the
     * deliberately broken pattern was nearly left in, because the file was
     * untracked and `git checkout` silently restored nothing.
     */
    const { selfTest, PATTERNS } = await import('../tools/secrets.mjs');
    assert.deep(selfTest(), []);
    assert.ok(PATTERNS.length >= 6, `only ${PATTERNS.length} credential formats`);
  });

  test('and a pattern that cannot match its own sample is reported', async () => {
    /*
     * Asserting `selfTest()` comes back empty cannot tell a working guard from
     * one that returns empty unconditionally — the mutation ratchet made
     * exactly that point and refused to call this held. So the broken case is
     * driven rather than hoped for.
     */
    const { selfTest } = await import('../tools/secrets.mjs');
    const broken = [{ what: 'a key of some kind', pattern: /NEVERMATCHES/, sample: 'AIzaxxxx' }];

    const found = selfTest(broken);
    assert.length(found, 1);
    assert.ok(found[0].includes('no longer matches its own sample'), found[0]);
  });

  test('a planted credential is found, with its file and line', async () => {
    // Driven rather than asserted about the repository as it stands: it is
    // clean, so the branch that reports a hit could not otherwise fail.
    const { scan, PATTERNS } = await import('../tools/secrets.mjs');
    const planted = `const key = '${PATTERNS[0].sample}';`;
    const found = scan(['js/fake.js'], () => `// fine\n${planted}\n`);

    assert.length(found, 1, found.join('; '));
    assert.ok(found[0].startsWith('js/fake.js:2'), found[0]);
    assert.ok(found[0].includes(PATTERNS[0].what), found[0]);
  });

  test('and the words people write about secrets are not credentials', async () => {
    /*
     * The half that decides whether anybody leaves this switched on. This
     * repository says `token`, `secret` and `apiKey` hundreds of times in
     * prose, schema and fixtures, and a scanner that flagged those would be
     * turned off inside a week. Formats only.
     */
    const { scan } = await import('../tools/secrets.mjs');
    const prose = [
      'The SMS provider credentials must remain server-side.',
      "const tokens = { 'owner-token': { email } };",
      'apiKey: config.apiKey, // never a literal',
      '* `otpSmsToken` is a property somebody sets, not a value stored here.',
    ].join('\n');

    assert.deep(scan(['js/prose.js'], () => prose), []);
  });
});
