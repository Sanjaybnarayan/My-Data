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
import { loadAppsScript, propertyStore, cacheStore } from './appsscript.mjs';
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
      'ownRecordAllows', 'ownRecordEntities'],
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
