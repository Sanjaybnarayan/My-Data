/**
 * Server-side authorization.
 *
 * `security/rbac.js` refuses the same writes on the device, and anybody who
 * opens devtools can make it stop. These checks run on Google's servers under
 * the household's own authorisation, so the question they answer is the one
 * that matters: can a caller who has edited their role, or written their own
 * client, put a row in a sheet their account may not write?
 *
 * The sheet stubs here record whether they were *touched*, not only what they
 * returned. A refused row that still caused a read is a refusal that happened
 * too late to be worth much.
 */

import { readFileSync } from 'node:fs';
import { test, describe, assert, setSuite } from './harness.mjs';
import { loadAppsScript, propertyStore, cacheStore, backend } from './appsscript.mjs';
import { generate, POLICY_FILE } from '../tools/policy.mjs';
import { entities } from '../js/data/schema.js';
import { OWN_RECORD_ENTITIES, SUBJECT_FIELD } from '../js/security/rbac.js';

setSuite('policy');

/**
 * Policy.gs and Sheets.gs, with just enough of Apps Script to run them.
 *
 * The `sheetMap` is not decoration. `entityForSheet` and `sheetNameFor` both
 * read it out of PropertiesService, and without it every sheet is unrecognised
 * — so the pull loop `continue`s on the entity lookup *before* it reaches the
 * policy check. The first version of this file left it empty, and
 * mutation-testing duly reported that deleting the entire pull enforcement
 * broke nothing. It was not the enforcement that was missing; it was the map.
 */
/** @param {Record<string, string>} [sheetMap] */
function sheets(sheetMap = { vaultItem: 'Vault', note: 'Notes', task: 'Tasks', account: 'Accounts' }) {
  const props = propertyStore({ sheetMap: JSON.stringify(sheetMap) });
  return loadAppsScript(
    ['Policy.gs', 'Sheets.gs'],
    {
      PropertiesService: { getUserProperties: () => props, getScriptProperties: () => props },
      CacheService: { getUserCache: () => cacheStore() },
      Utilities: { formatDate: (d) => String(d) },
      SpreadsheetApp: {},
      Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
      console: { log() {}, warn() {}, error() {} },
    },
    ['policyAllows', 'readableEntities', 'roleRank', 'sheetPush', 'sheetPull',
      'ownRecordAllows', 'ownRecordEntities', 'sheetCounts'],
  );
}

describe('the rules themselves', () => {
  test('the generated file still matches the schema', () => {
    // Two tables describing one set of rules will disagree, and the
    // disagreement would be discovered by somebody reading a screen that is
    // wrong rather than by a test. This is the test.
    assert.equal(readFileSync(POLICY_FILE, 'utf8'), generate(),
      'run `node tools/policy.mjs` — the backend copy is out of date');
  });

  test('every entity in the schema is in it', () => {
    const api = sheets();
    for (const name of Object.keys(entities)) {
      assert.ok(api.policyAllows('owner', 'read', name), `${name} is missing from the policy`);
    }
  });

  test('an entity nobody has heard of is refused, not allowed', () => {
    // A store the schema has never seen is either a typo or somebody probing.
    // Both are better answered with no.
    const api = sheets();
    assert.not(api.policyAllows('owner', 'read', 'sneakyStore'));
    assert.not(api.policyAllows('owner', 'write', 'sneakyStore'));
  });

  test('a role nobody has heard of is refused too', () => {
    const api = sheets();
    assert.not(api.policyAllows('archduke', 'read', 'note'));
    assert.not(api.policyAllows('', 'read', 'note'));
    assert.not(api.policyAllows(undefined, 'read', 'note'));
  });

  test('a child may not read the vault, and an owner may', () => {
    const api = sheets();
    assert.ok(api.policyAllows('owner', 'read', 'vaultItem'));
    assert.not(api.policyAllows('child', 'read', 'vaultItem'));
    assert.not(api.policyAllows('adult', 'read', 'vaultItem'));
  });

  test('reading is not writing', () => {
    const api = sheets();
    assert.ok(api.policyAllows('adult', 'read', 'account'));
    assert.not(api.policyAllows('adult', 'write', 'account'), 'an adult may see accounts, not edit them');
  });

  test('a guest may read nothing at all through this backend', () => {
    assert.deep(sheets().readableEntities('guest'), []);
  });
});

/**
 * A workbook with one real row per sheet, that remembers who looked at it.
 *
 * A row rather than an empty tab, because `lastRow < 2` short-circuits the pull
 * loop — an empty sheet would let a test pass with the policy check deleted.
 */
function fakeBook(names, { headers, rows } = /** @type {{headers?: string[], rows?: any[][]}} */ ({})) {
  const touched = [];
  const HEADERS = headers ?? ['_id', '_rev', '_updatedAt', '_deletedAt'];
  const ROWS = rows ?? [['r1', 1, '2026-08-01T00:00:00.000Z', '']];

  const sheet = (name) => ({
    getName: () => name,
    getLastRow: () => { touched.push(name); return ROWS.length + 1; },
    getLastColumn: () => HEADERS.length,
    getRange: (row) => {
      touched.push(name);
      return {
        getValues: () => (row === 1 ? [HEADERS] : ROWS),
        // Writable, because an allowed push now reaches the sheet. The first
        // version of these fixtures had no `setValues` and the own-record test
        // failed on it — which was the fix working, not breaking.
        setValues: () => {},
        setValue: () => {},
      };
    },
    appendRow: () => {},
  });

  return {
    touched,
    getSheets: () => names.map(sheet),
    getSheetByName: (name) => (names.includes(name) ? sheet(name) : null),
  };
}

/* --------------------------------------------------- a row about the caller */

/**
 * The gap `docs/SERVER_AUTHORIZATION.md` recorded as unfinished: the browser
 * let a child open and edit their own health record, and the server had no
 * own-record rule at all. Fourteen (role, action, entity) combinations
 * disagreed, every one of them an action the device offers and the backend
 * refuses — so the record parked in the outbox and appeared under Settings as
 * stuck. Not silent, but a guaranteed dead end.
 */
describe('a row that is about the caller', () => {
  const HEALTH = ['_id', '_rev', '_updatedAt', '_deletedAt', 'person'];
  const mine = ['h1', 1, '2026-08-01T00:00:00.000Z', '', 'p-me'];
  const theirs = ['h2', 1, '2026-08-02T00:00:00.000Z', '', 'p-sibling'];

  const withHealth = (rows) => fakeBook(['Health'], { headers: HEALTH, rows });
  const map = { healthRecord: 'Health', vaultItem: 'Vault' };

  test('a child may push their own health record, which their role alone may not', () => {
    const api = sheets(map);
    const result = api.sheetPush(
      [{ store: 'healthRecord', op: 'put', recordId: 'h1', rev: 1, payload: { person: 'p-me' } }],
      withHealth([mine]),
      { role: 'child', personId: 'p-me' },
    );

    assert.length(result.rejected, 0, result.rejected[0]?.reason ?? '');
    assert.length(result.applied, 1);
  });

  test('and a sibling’s is still refused', () => {
    // Paired with the one above on purpose. Asserting only the allow would
    // pass against a rule that permitted everything.
    const api = sheets(map);
    const result = api.sheetPush(
      [{ store: 'healthRecord', op: 'put', recordId: 'h2', rev: 1, payload: { person: 'p-sibling' } }],
      withHealth([theirs]),
      { role: 'child', personId: 'p-me' },
    );

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
  });

  test('an account bound to no person gets nothing extra', () => {
    // Every member entry written before this existed has no `personId`, and
    // absent has to mean "no own-record access" rather than "all of it".
    const api = sheets(map);
    const result = api.sheetPush(
      [{ store: 'healthRecord', op: 'put', recordId: 'h1', rev: 1, payload: { person: 'p-me' } }],
      withHealth([mine]),
      { role: 'child', personId: '' },
    );

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
  });

  test('a child is pulled their own rows and not a sibling’s', () => {
    const api = sheets(map);
    const result = api.sheetPull({}, 100, withHealth([mine, theirs]),
      { role: 'child', personId: 'p-me' });

    assert.length(result.records.healthRecord ?? [], 1);
    assert.equal(result.records.healthRecord[0].id, 'h1');
  });

  test('and with no person bound, the entity is skipped as before', () => {
    const api = sheets(map);
    const result = api.sheetPull({}, 100, withHealth([mine, theirs]),
      { role: 'child', personId: '' });

    assert.not(result.records.healthRecord);
  });

  test('a sheet with no subject column sends nothing rather than everything', () => {
    // A workbook older than the rule. Guessing which column names the person
    // is the one mistake worth avoiding here.
    const api = sheets(map);
    const older = fakeBook(['Health'], {
      headers: ['_id', '_rev', '_updatedAt', '_deletedAt'],
      rows: [['h1', 1, '2026-08-01T00:00:00.000Z', '']],
    });

    assert.not(api.sheetPull({}, 100, older, { role: 'child', personId: 'p-me' })
      .records.healthRecord);
  });

  test('it only ever widens — an owner still reads everything', () => {
    const api = sheets(map);
    const result = api.sheetPull({}, 100, withHealth([mine, theirs]),
      { role: 'owner', personId: 'p-owner' });

    assert.length(result.records.healthRecord ?? [], 2,
      'the blanket rule is not narrowed by the own-record one');
  });

  test('the person record is deliberately not reachable this way', () => {
    // The security property. The server maps an email to a person id through
    // the members list, which only the owner may change. If somebody could
    // edit their own `person` row through this rule they could edit the thing
    // that identifies them, and the mapping would stop being owner-controlled.
    const api = sheets(map);

    assert.not(api.ownRecordEntities().includes('person'));
    assert.not(api.ownRecordAllows('p-me', 'person', { id: 'p-me' }));
  });

  test('and the vault is not reachable this way either', () => {
    assert.not(sheets(map).ownRecordEntities().includes('vaultItem'));
  });

  test('the server’s table matches the browser’s, minus person', () => {
    // Generated from `js/security/rbac.js` by `tools/policy.mjs`, with the
    // drift check in this file's neighbour failing if the copy goes stale.
    const api = sheets(map);
    const expected = [...OWN_RECORD_ENTITIES]
      .filter((name) => name !== 'person' && SUBJECT_FIELD[name])
      .sort();

    assert.deep(api.ownRecordEntities().sort(), expected);
  });
});

describe('pushing', () => {
  const change = (store) => ({ store, op: 'put', recordId: `${store}_1`, rev: 1, payload: {} });

  test('a role that may not write an entity is refused before the sheet is read', () => {
    // Refused early enough that the workbook is never opened for it. A check
    // that happens after the read has already told the caller the sheet exists
    // and how big it is.
    const api = sheets();
    const book = fakeBook(['Vault']);

    const result = api.sheetPush([change('vaultItem')], book, { role: 'child' });

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
    assert.includes(result.rejected[0].reason, 'child');
    assert.deep(book.touched, [], 'the sheet was never opened');
  });

  test('one refused row does not throw away the rest of the batch', () => {
    // An adult syncing three changes should not lose the two that are theirs
    // to make because the third was not.
    //
    // A child was the obvious subject here and turned out to be the wrong one:
    // under this schema **a child may write nothing at all**, so every row
    // would have been refused and the test would have proved the opposite of
    // what it claims. That fact is asserted on its own below.
    const api = sheets();
    const book = fakeBook([]);

    const result = api.sheetPush(
      [change('vaultItem'), change('note'), change('task')],
      book,
      { role: 'adult' },
    );

    const byPolicy = result.rejected.filter((r) => /may not write/.test(r.reason));
    assert.length(byPolicy, 1, 'only the vault item was refused by the policy');
    assert.equal(byPolicy[0].recordId, 'vaultItem_1');
    assert.ok(result.rejected.length > 1,
      'the other two reached the sheet lookup and failed there instead');
    assert.not(book.touched.includes('Vault'));
  });

  test('a child writes only what their own device produces', () => {
    // This used to read "a child may write nothing at all", and that was true
    // of the schema until Phase 15. A location reading is made by the device
    // in the child's pocket, so if a child may not write one, a child never
    // has a position — which is most of the point of safe zones. Phase 14 adds
    // three more for the same reason: a child who cannot enrol a device or
    // write a message is a child who cannot be in the family chat.
    //
    // So the exception is deliberate and it is narrow. It is asserted as a
    // list rather than a count, because the failure worth catching is a
    // *different* entity quietly joining it.
    const api = sheets();
    const writable = Object.keys(entities)
      .filter((n) => api.policyAllows('child', 'write', n))
      .sort();

    assert.deep(writable,
      ['conversation', 'deviceKey', 'locationPing', 'message', 'sosAlert']);
    assert.ok(api.readableEntities('child').length > 0, 'though they can read plenty');
  });

  test('and a child may not read where anybody else has been', () => {
    // The other half of the household's decision: a parent sees a child, and
    // a child does not see a sibling. Without this the entity above would be
    // readable by everyone it is about, which is not what was asked for.
    const api = sheets();
    assert.not(api.policyAllows('child', 'read', 'locationPing'));
    assert.ok(api.policyAllows('spouse', 'read', 'locationPing'));
    assert.ok(api.policyAllows('adult', 'read', 'locationPing'));
  });

  test('a missing role is treated as a guest, not as an owner', () => {
    // The failure that would matter most: a context that lost its role on the
    // way through must not be read as unrestricted.
    const api = sheets();
    const book = fakeBook(['Vault']);

    assert.length(api.sheetPush([change('vaultItem')], book, {}).rejected, 1);
    assert.length(api.sheetPush([change('vaultItem')], book, null).rejected, 1);
    assert.deep(book.touched, []);
  });

  test('the role is never taken from the change itself', () => {
    // A caller writing its own client would put whatever it liked in the
    // payload. The role comes from the verified identity or from nowhere.
    const api = sheets();
    const book = fakeBook(['Vault']);
    const forged = { ...change('vaultItem'), role: 'owner', payload: { role: 'owner' } };

    assert.length(api.sheetPush([forged], book, { role: 'child' }).rejected, 1);
  });
});

describe('pulling', () => {
  test('an owner is sent the vault, and a child is not', () => {
    // Paired on purpose. Asserting only that a child gets nothing would pass
    // against a stub that returns nothing to anybody, which is what the first
    // version of this file did.
    const api = sheets();

    const forOwner = api.sheetPull({}, 100, fakeBook(['Vault']), { role: 'owner' });
    assert.ok(forOwner.records.vaultItem, 'the owner is sent it');

    const book = fakeBook(['Vault']);
    const forChild = api.sheetPull({}, 100, book, { role: 'child' });
    assert.not(forChild.records.vaultItem, 'the child is not');
    // Not sent and then hidden by the client: a row that reached the device
    // would be in IndexedDB, in the search index and in an export, whatever a
    // screen chose to draw.
    assert.deep(book.touched, [], 'and the sheet was never opened');
  });

  test('what the role may read still comes through', () => {
    const api = sheets();
    const book = fakeBook(['Vault', 'Notes']);

    const result = api.sheetPull({}, 100, book, { role: 'child' });
    assert.ok(result.records.note, 'a child may read notes');
    assert.not(result.records.vaultItem);
  });

  test('the cursor for a skipped sheet is left alone', () => {
    // Advancing it would mean that promoting somebody later showed them only
    // what changed after the promotion, with the history silently missing.
    const api = sheets();
    const result = api.sheetPull({ vaultItem: '2026-01-01' }, 100,
      fakeBook(['Vault']), { role: 'child' });

    assert.not(result.cursors.vaultItem && result.cursors.vaultItem !== '2026-01-01',
      'the cursor moved for a sheet that was never read');
  });

  test('a missing role pulls nothing rather than everything', () => {
    const api = sheets();
    const book = fakeBook(['Vault', 'Notes']);

    assert.deep(api.sheetPull({}, 100, book, {}).records, {});
    assert.deep(api.sheetPull({}, 100, book, null).records, {});
    assert.deep(book.touched, [], 'no sheet was opened for a caller with no role');
  });
});

/* ------------------------------- what the backend does NOT know about chat */

/**
 * Conversation membership is not a server-side boundary, and this says so.
 *
 * A characterisation test, not an aspiration. `Policy.gs` grants `message`
 * read and write to owner, spouse, adult and child as a blanket rule, and
 * `message` is absent from `OWN_RECORD` — which only ever *widens* what a
 * blanket rule allows and can never refuse. Nothing in `sheetPush` or
 * `sheetPull` knows who is in a conversation.
 *
 * So a household member outside a conversation is pulled its rows and may
 * write into it. What stops them reading anything is `js/security/e2ee.js`,
 * which seals per recipient device and says in its own opening that the
 * contents are not readable by "a household member outside the conversation".
 * The confidentiality is carried by the encryption; the backend is not
 * carrying it and does not claim to.
 *
 * Written down for two reasons. The audit called this "not applicable — no
 * backend", which was wrong twice over: there *is* a backend, and it *does*
 * authorise, it simply does not model conversations. And if somebody later
 * teaches it to, these assertions fail — which is the correct outcome, and the
 * signal to come and delete them.
 *
 * `docs/THREAT_MODEL.md` T4.6 carries the residual risk.
 */
describe('the backend does not know who is in a conversation', () => {
  const MSG = ['_id', '_rev', '_updatedAt', '_deletedAt', 'conversation', 'sender'];
  const map = { message: 'ChatMessages' };

  // Positional, matching MSG — `fakeBook` hands `getValues` back exactly what
  // it is given, and a sheet row is an array of cells, not an object.
  const rows = [
    ['m1', 1, '2026-08-01T00:00:00.000Z', '', 'parents-only', 'p-mum'],
    ['m2', 1, '2026-08-02T00:00:00.000Z', '', 'parents-only', 'p-dad'],
  ];
  const book = () => fakeBook(['ChatMessages'], { headers: MSG, rows });

  test('a child is pulled a conversation they are not part of', () => {
    // Metadata, not contents: who is talking to whom, when, and how much.
    const out = sheets(map).sheetPull({}, 100, book(),
      { role: 'child', personId: 'p-kid' });

    assert.length(out.records.message, 2,
      'membership is enforced on pull now — delete this test and T4.6');
    assert.equal(out.records.message[0].conversation, 'parents-only');
  });

  test('and may write into it, so long as they do not forge the sender', () => {
    const result = sheets(map).sheetPush(
      [{
        store: 'message',
        op: 'put',
        recordId: 'm3',
        rev: 1,
        payload: { conversation: 'parents-only', sender: 'p-kid' },
      }],
      book(),
      { role: 'child', personId: 'p-kid' },
    );

    assert.length(result.rejected, 0,
      'membership is enforced on push now — delete this test and T4.6');
    assert.length(result.applied, 1);
  });

  test('the one thing that IS narrowed is who the message is from', () => {
    // The boundary that does exist, asserted beside the one that does not, so
    // the pair cannot be misread as "chat is unauthorised".
    const result = sheets(map).sheetPush(
      [{
        store: 'message',
        op: 'put',
        recordId: 'm4',
        rev: 1,
        payload: { conversation: 'parents-only', sender: 'p-mum' },
      }],
      book(),
      { role: 'child', personId: 'p-kid' },
    );

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
  });
});

/* ------------------------------------------- who a message may be sent as */

describe('a message may only be sent as the person the account belongs to', () => {
  const MSG = ['_id', '_rev', '_updatedAt', '_deletedAt', 'conversation', 'sender'];
  const withMessages = () => fakeBook(['ChatMessages'], { headers: MSG, rows: [] });
  const map = { message: 'ChatMessages' };

  const push = (payload, context) => sheets(map).sheetPush(
    [{ store: 'message', op: 'put', recordId: 'm1', rev: 1, payload }],
    withMessages(),
    context,
  );

  test('my own message is stored', () => {
    const result = push({ conversation: 'c1', sender: 'p-me' }, { role: 'child', personId: 'p-me' });
    assert.length(result.rejected, 0, result.rejected[0]?.reason ?? '');
    assert.length(result.applied, 1);
  });

  test('and one claiming to be somebody else is refused', () => {
    /*
     * The whole point. Every role may write messages, so the blanket policy
     * allowed this; `ownRecordAllows` cannot refuse anything. This is the
     * first rule in `sheetPush` that narrows rather than widens.
     */
    const result = push({ conversation: 'c1', sender: 'p-sibling' },
      { role: 'child', personId: 'p-me' });

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
    assert.ok(/only be sent as/.test(result.rejected[0].reason), result.rejected[0].reason);
  });

  test('an account matched to nobody is refused, not waved through', () => {
    /*
     * The tempting shape is "check it only when we can" — which stops applying
     * to exactly the accounts nobody has bound yet, the owner included. So an
     * unbound caller is refused, with a reason naming where the fix is made.
     */
    const result = push({ conversation: 'c1', sender: 'p-me' },
      { role: 'owner', personId: '' });

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
    assert.ok(/not been matched to a person/.test(result.rejected[0].reason),
      result.rejected[0].reason);
  });

  test('the owner is not exempt', () => {
    // The account that can do the most is the one a rule must not skip.
    const result = push({ conversation: 'c1', sender: 'p-someone-else' },
      { role: 'owner', personId: 'p-owner' });

    assert.length(result.applied, 0);
    assert.length(result.rejected, 1);
  });

  test('a row carrying no sender is left to the ordinary rules', () => {
    // A withdrawal marks a row and names nobody. Refusing it would break
    // withdrawing a message, which is a different operation entirely.
    const result = push({ conversation: 'c1', deletedForEveryone: true },
      { role: 'child', personId: 'p-me' });

    assert.length(result.rejected, 0, result.rejected[0]?.reason ?? '');
    assert.length(result.applied, 1);
  });

  test('and other entities are untouched by this rule', () => {
    // A narrowing rule that reached beyond `message` would refuse writes the
    // household has always been able to make.
    const api = sheets({ note: 'Notes' });
    const result = api.sheetPush(
      [{ store: 'note', op: 'put', recordId: 'n1', rev: 1, payload: { sender: 'p-anybody' } }],
      fakeBook(['Notes'], { headers: ['_id', '_rev', '_updatedAt', '_deletedAt', 'sender'], rows: [] }),
      // `adult`, because a child may not write notes at all — that refusal
      // would come from the blanket policy and prove nothing about this rule.
      { role: 'adult', personId: 'p-me' },
    );

    assert.length(result.rejected, 0, result.rejected[0]?.reason ?? '');
    assert.length(result.applied, 1);
  });
});

describe('a row count is a read', () => {
  /*
   * `dispatch` called `sheetCounts(workbook())` with no caller attached, so it
   * consulted no policy and counted every tab. `will`, `legalDocument`,
   * `identityDocument`, `vaultItem`, `beneficiary` and `kycRecord` are all
   * `read: ["owner","spouse"]` — a child, an adult, a guest or a member of
   * staff may not read one row of any of them, and could learn exactly how
   * many rows each held.
   *
   * Nothing was wrong with the policy table. `tools/policy.mjs` generates it
   * from the schema and the test at the top of this file proves the two agree.
   * What nothing checked was whether every handler asks it.
   */
  const HEALTH = ['_id', '_rev', '_updatedAt', '_deletedAt', 'person'];
  const map = { vaultItem: 'Vault', healthRecord: 'Health' };

  test('an owner is counted everything', () => {
    const api = sheets(map);
    const counts = api.sheetCounts(fakeBook(['Vault']), { role: 'owner', personId: 'p-owner' });
    assert.equal(counts.Vault, 1);
  });

  test('a role that may not read the entity is told nothing about it', () => {
    const api = sheets(map);
    const counts = api.sheetCounts(fakeBook(['Vault']), { role: 'child', personId: 'p-me' });
    // Absent, not zero. Zero says there are none; absent says nothing, and
    // only one of those is true.
    assert.not(Object.prototype.hasOwnProperty.call(counts, 'Vault'),
      `child was told Vault holds ${counts.Vault}`);
  });

  test('and a caller with no context at all is treated as a guest', () => {
    // The shape the defect had: no context reached this at all.
    const api = sheets(map);
    assert.deep(api.sheetCounts(fakeBook(['Vault'])), {});
  });

  test('an own-record entity counts the caller\'s own rows and no others', () => {
    const api = sheets(map);
    const rows = [
      ['h1', 1, '2026-08-01T00:00:00.000Z', '', 'p-me'],
      ['h2', 1, '2026-08-02T00:00:00.000Z', '', 'p-other'],
      ['h3', 1, '2026-08-03T00:00:00.000Z', '', 'p-me'],
    ];
    const counts = api.sheetCounts(fakeBook(['Health'], { headers: HEALTH, rows }),
      { role: 'child', personId: 'p-me' });
    assert.equal(counts.Health, 2);
  });

  test('an own-record entity with no person to match sends no count', () => {
    const api = sheets(map);
    const counts = api.sheetCounts(fakeBook(['Health'], { headers: HEALTH, rows: [] }),
      { role: 'child', personId: '' });
    assert.not(Object.prototype.hasOwnProperty.call(counts, 'Health'));
  });

  test('a tab the manifest does not map to an entity has no ACL, so it is not counted', () => {
    // Guessing that an unmapped tab is safe to disclose is the one mistake
    // worth avoiding here.
    const api = sheets(map);
    const counts = api.sheetCounts(fakeBook(['Mystery']), { role: 'owner', personId: 'p-owner' });
    assert.not(Object.prototype.hasOwnProperty.call(counts, 'Mystery'));
  });
});

/* ------------------------------------------------- the map the ACL reads */

/**
 * Who may say which tab is which entity.
 *
 * Every check above asks whether the policy refuses a role an entity. This one
 * asks the question underneath them: **where does the entity name come from?**
 *
 * It came from the client. `dispatch` handed `schemaEnsure` the manifest and
 * the workbook and not the context — the one handler of sixteen that ran
 * without knowing who was asking — `rememberManifest` wrote the entity→sheet
 * map verbatim, and `sheetPull` decides what a caller may read by asking
 * `entityForSheet(name)` and putting the answer to `policyAllows`.
 *
 * So a caller chose the name their own ACL was applied to, and the properties
 * are shared: `appsscript.json` deploys `executeAs: USER_DEPLOYING`, so one
 * member remapping it remapped it for everybody.
 *
 * These run through `doPost` rather than calling the function, because the
 * hole was in the wiring between the dispatch and the handler and a test that
 * called the handler directly would have passed.
 */
describe('who may say which tab is which entity', () => {
  const OWNER = 'owner@example.com';
  const CHILD = 'kid@example.com';
  const CLIENT = '1-familyos.apps.googleusercontent.com';

  const tokens = {
    'owner-token': { email: OWNER, aud: CLIENT, expires_in: '3599' },
    'child-token': { email: CHILD, aud: CLIENT, expires_in: '3599' },
  };

  const VAULT = ['_id', '_rev', '_updatedAt', '_deletedAt', 'name', 'password'];
  const SEALED = ['v1', 1, '2026-08-01T00:00:00.000Z', '', 'HDFC NetBanking',
    'enc:v1:tQnxuE9nwT/BZSb/:HDwWbhM+zaF9uNrp4Rld'];

  function workbook(names = ['Vault']) {
    const tabs = [...names];
    const sheet = (name) => ({
      getName: () => name,
      getLastRow: () => 2,
      getLastColumn: () => VAULT.length,
      getMaxRows: () => 100,
      getRange: (row) => ({
        getValues: () => (row === 1 ? [VAULT] : [SEALED]),
        setValues: () => {}, setValue: () => {},
        setFontWeight: () => {}, setNumberFormat: () => {},
      }),
      setFrozenRows: () => {},
      appendRow: () => {},
    });
    return {
      // `bootstrap` reads both, and a stub without them refuses for a reason
      // that has nothing to do with the rule under test.
      getId: () => 'wb1',
      getUrl: () => 'https://example.invalid/wb1',
      getSheets: () => tabs.map(sheet),
      getSheetByName: (n) => (tabs.includes(n) ? sheet(n) : null),
      insertSheet: (n) => { tabs.push(n); return sheet(n); },
    };
  }

  const household = (sheetMap = { vaultItem: 'Vault' }) => backend({
    owner: OWNER,
    tokens,
    workbook: workbook(),
    properties: {
      members: JSON.stringify([{ email: CHILD, role: 'child', personId: 'p-child' }]),
      sheetMap: JSON.stringify(sheetMap),
      workbookId: 'wb1',
    },
  });

  test('a child may not point an entity they can read at a tab that holds one they cannot', () => {
    // The measurement this was built from. A child may read `task` and may not
    // read `vaultItem`; mapping `task` onto the vault tab handed them the vault
    // — name and sealed password — and the household shares one data key.
    const api = household();
    assert.length(Object.keys(api.post('pull', 'child-token', { cursors: {} }).data.records), 0);

    const answer = api.post('schema', 'child-token', {
      manifest: [{ entity: 'task', sheet: 'Vault', version: 1, columns: ['name', 'password'] }],
    });

    assert.not(answer.ok, 'the remapping was accepted');
    assert.equal(answer.status, 403);
    assert.deep(JSON.parse(api.props.getProperty('sheetMap')), { vaultItem: 'Vault' },
      'the map was changed despite the refusal');
    assert.length(Object.keys(api.post('pull', 'child-token', { cursors: {} }).data.records), 0,
      'the vault reached a child');
  });

  test('nor move an entity that is already mapped somewhere else', () => {
    const api = household();
    const answer = api.post('schema', 'child-token', {
      manifest: [{ entity: 'vaultItem', sheet: 'Notes', version: 1, columns: ['name'] }],
    });
    assert.not(answer.ok);
    assert.equal(answer.status, 403);
  });

  test('but the mapping a device already has is sent on every upgrade and must pass', () => {
    // `#ensureSchema` runs on any device whose stored fingerprint has moved,
    // whatever its role. A rule that refused this would stop a child's device
    // syncing at all, which is a worse outcome than the one being prevented.
    const api = household();
    const answer = api.post('schema', 'child-token', {
      manifest: [{ entity: 'vaultItem', sheet: 'Vault', version: 1, columns: ['name', 'password'] }],
    });
    assert.ok(answer.ok, answer.error);
  });

  test('and an entity new to the schema still maps, from whoever gets there first', () => {
    const api = household();
    const answer = api.post('schema', 'child-token', {
      manifest: [{ entity: 'note', sheet: 'Notes', version: 1, columns: ['body'] }],
    });
    assert.ok(answer.ok, answer.error);
    assert.equal(JSON.parse(api.props.getProperty('sheetMap')).note, 'Notes');
  });

  test('an owner may still reshape the workbook, which is whose it is', () => {
    const api = household();
    const answer = api.post('schema', 'owner-token', {
      manifest: [{ entity: 'task', sheet: 'Vault', version: 1, columns: ['name'] }],
    });
    assert.ok(answer.ok, answer.error);
  });

  test('and the other way into the same function is checked too', () => {
    // `dispatch` is not the only caller: `bootstrap` reaches `schemaEnsure` as
    // well, and passing the manifest without the context made every bootstrap
    // read as a non-owner's. Fail-closed, so no hole — but an owner reshaping
    // their own workbook that way was refused in the name of a rule about
    // everybody else, and a child refused for the right reason by accident is
    // not a child refused.
    const api = household();
    const hostile = [{ entity: 'task', sheet: 'Vault', version: 1, columns: ['name'] }];

    const refused = api.post('bootstrap', 'child-token', { manifest: hostile });
    assert.not(refused.ok, 'bootstrap let a child do what schema would not');
    assert.equal(refused.status, 403, `refused for the wrong reason: ${refused.error}`);
    assert.deep(JSON.parse(api.props.getProperty('sheetMap')), { vaultItem: 'Vault' });

    assert.ok(api.post('bootstrap', 'owner-token', { manifest: hostile }).ok,
      'an owner was refused their own workbook');
  });

  test('an entity the policy has never heard of is refused, from anyone', () => {
    // A tab mapped to it would be read under a rule that does not exist, and
    // `policyAllows` already states this for itself: a store the schema has
    // never seen is either a typo or somebody probing.
    for (const token of ['owner-token', 'child-token']) {
      const answer = household().post('schema', token, {
        manifest: [{ entity: 'nonsense', sheet: 'Nonsense', version: 1, columns: [] }],
      });
      assert.not(answer.ok, `${token} was allowed to map an unknown entity`);
      assert.equal(answer.status, 400);
    }
  });

  test('a manifest naming three entities does not unmap the other fifty', () => {
    // `rememberManifest` assigned a fresh object. An unmapped tab is skipped by
    // every read and write, so one short manifest took the household's whole
    // workbook out of reach until a full one arrived.
    const api = household({ vaultItem: 'Vault', account: 'Accounts', will: 'Wills' });
    api.post('schema', 'owner-token', {
      manifest: [{ entity: 'note', sheet: 'Notes', version: 1, columns: ['body'] }],
    });

    const map = JSON.parse(api.props.getProperty('sheetMap'));
    assert.equal(map.vaultItem, 'Vault');
    assert.equal(map.account, 'Accounts');
    assert.equal(map.will, 'Wills');
    assert.equal(map.note, 'Notes');
  });
});

/* ------------------------------------------------ where the records live */

/**
 * Who may say where the household's records are.
 *
 * `bootstrap` makes a workbook when the id it holds will not open — which is
 * what a household sees when theirs is in the bin, or briefly unreachable —
 * and it asked nobody. Everybody signed in calls it: `settings/connection.js`
 * does on "Sign in with Google" and again on "Set up the workbook". What a
 * non-owner needs from it is the *answer*, the workbook and folder ids their
 * uploads go to; creating is a different act reached by the same request.
 *
 * None of this could be tested before, because the fixture had no
 * `SpreadsheetApp.create` and every attempt died on the missing method and
 * read as a refusal. A stub less capable than the real thing hides a path as
 * surely as one more capable tests a path that was never deployed.
 */
describe('who may say where the records live', () => {
  const OWNER = 'owner@example.com';
  const CHILD = 'kid@example.com';
  const CLIENT = '1-familyos.apps.googleusercontent.com';
  const tokens = {
    'owner-token': { email: OWNER, aud: CLIENT, expires_in: '3599' },
    'child-token': { email: CHILD, aud: CLIENT, expires_in: '3599' },
  };
  const members = JSON.stringify([{ email: CHILD, role: 'child', personId: 'p-child' }]);
  const manifest = [{ entity: 'note', sheet: 'Notes', version: 1, columns: ['body'] }];

  /** A household whose workbook id resolves to nothing. */
  const gone = (properties = {}) => backend({
    owner: OWNER, tokens, workbook: null, properties: { members, ...properties },
  });

  /** A household that is set up and working. */
  function working() {
    const tabs = ['Notes'];
    const sheet = (n) => ({
      getName: () => n, getLastRow: () => 1, getLastColumn: () => 0, getMaxRows: () => 100,
      getRange: () => ({
        getValues: () => [[]], setValues: () => {}, setValue: () => {},
        setFontWeight: () => {}, setNumberFormat: () => {},
      }),
      setFrozenRows: () => {}, appendRow: () => {},
    });
    return backend({
      owner: OWNER,
      tokens,
      workbook: {
        getId: () => 'wb1', getUrl: () => 'https://example.invalid/wb1',
        getSheets: () => tabs.map(sheet),
        getSheetByName: (n) => (tabs.includes(n) ? sheet(n) : null),
        insertSheet: (n) => { tabs.push(n); return sheet(n); },
      },
      properties: { members, workbookId: 'wb1', sheetMap: JSON.stringify({ note: 'Notes' }) },
    });
  }

  test('a member cannot point the household at a workbook of their own', () => {
    // Measured before this was closed: the child's request was *refused* and
    // the pointer had moved anyway, because it was written the moment the
    // workbook was made. The records were still in Drive and nothing pointed
    // at them.
    const api = gone({ workbookId: 'the-household-workbook' });
    const answer = api.post('bootstrap', 'child-token', { manifest });

    assert.not(answer.ok);
    assert.equal(answer.status, 403, `refused for the wrong reason: ${answer.error}`);
    assert.equal(api.props.getProperty('workbookId'), 'the-household-workbook');
    assert.length(api.created, 0, 'a workbook was made for a caller who may not make one');
  });

  test('but is told where the records are when the household has them', () => {
    // The half that matters just as much: a non-owner's uploads need the
    // folder ids, and a rule that refused this would stop them syncing at all.
    const api = working();
    const answer = api.post('bootstrap', 'child-token', { manifest });

    assert.ok(answer.ok, answer.error);
    assert.equal(answer.data.workbookId, 'wb1');
    assert.ok(answer.data.documentsFolderId);
    assert.length(api.created, 0, 'an existing household had a second workbook made for it');
  });

  test('an owner sets one up, which is whose act it is', () => {
    const api = gone();
    const answer = api.post('bootstrap', 'owner-token', { manifest });

    assert.ok(answer.ok, answer.error);
    assert.length(api.created, 1);
    assert.equal(api.props.getProperty('workbookId'), answer.data.workbookId);
  });

  test('and a bootstrap that fails leaves the household pointing nowhere new', () => {
    // `doPost` already states this rule about a revoked device: "a revoked
    // device that got its write in and was refused the reply would still have
    // written."
    const api = gone();
    const answer = api.post('bootstrap', 'owner-token', { manifest: [] });

    assert.not(answer.ok);
    assert.length(api.created, 1, 'the workbook was not the thing that failed');
    assert.not(api.props.getProperty('workbookId'),
      'a refused bootstrap recorded the workbook it had just made');
  });
});
