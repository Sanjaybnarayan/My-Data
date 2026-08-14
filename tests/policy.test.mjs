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
    ['policyAllows', 'readableEntities', 'roleRank', 'sheetPush', 'sheetPull'],
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
function fakeBook(names) {
  const touched = [];
  const HEADERS = ['_id', '_rev', '_updatedAt', '_deletedAt'];
  const ROW = ['r1', 1, '2026-08-01T00:00:00.000Z', ''];

  const sheet = (name) => ({
    getName: () => name,
    getLastRow: () => { touched.push(name); return 2; },
    getLastColumn: () => HEADERS.length,
    getRange: (row) => {
      touched.push(name);
      return { getValues: () => (row === 1 ? [HEADERS] : [ROW]) };
    },
  });

  return {
    touched,
    getSheets: () => names.map(sheet),
    getSheetByName: (name) => (names.includes(name) ? sheet(name) : null),
  };
}

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

  test('a child may write nothing at all, which is a fact about the schema', () => {
    // Worth stating rather than discovering. Every `write` list in the schema
    // is owner/spouse or owner/spouse/adult, so the child role is read-only
    // everywhere — including the entities a child can see.
    const api = sheets();
    const writable = Object.keys(entities).filter((n) => api.policyAllows('child', 'write', n));
    assert.deep(writable, []);
    assert.ok(api.readableEntities('child').length > 0, 'though they can read plenty');
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
