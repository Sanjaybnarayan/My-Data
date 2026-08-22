/**
 * Loading the Apps Script backend into Node so it can be tested.
 *
 * `apps-script/*.gs` is the one part of this repository that had no tests, and
 * it is the part where a bug is a *security* bug: it decides which Google
 * account may reach a household's workbook. "It runs in a different runtime"
 * was the reason, and it is not a good enough one — the files are plain
 * functions over a handful of Google globals, and a handful of globals is a
 * thing you can supply.
 *
 * So: read the source, evaluate it with stubs bound in place of the Apps
 * Script services, and hand back the functions. Nothing is rewritten and
 * nothing is mocked out of the file under test — the code that runs here is
 * character-for-character the code that gets deployed.
 *
 * The stubs are deliberately literal. `PropertiesService` really is a string
 * map; `CacheService` really does expire; `UrlFetchApp` really does return an
 * object with `getResponseCode` and `getContentText`. A stub that is more
 * convenient than the real thing tests something that was never deployed.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script');

/** A `PropertiesService` store: a string map, which is all it ever was. */
export function propertyStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getProperty: (key) => (map.has(key) ? map.get(key) : null),
    setProperty: (key, value) => map.set(key, String(value)),
    deleteProperty: (key) => map.delete(key),
    getProperties: () => Object.fromEntries(map),
    /** For assertions: what the script actually wrote. */
    _map: map,
  };
}

/** A cache that expires, because a token cache that never did would hide bugs. */
export function cacheStore({ now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    get(key) {
      const entry = map.get(key);
      if (!entry) return null;
      if (entry.until <= now()) { map.delete(key); return null; }
      return entry.value;
    },
    put(key, value, seconds) {
      map.set(key, { value: String(value), until: now() + seconds * 1000 });
    },
    remove: (key) => map.delete(key),
    _map: map,
  };
}

/**
 * Load one or more `.gs` files with the Google globals supplied.
 *
 * @param {string[]} files names inside `apps-script/`
 * @param {object} globals stubs, by the name the script knows them under
 * @param {string[]} exports function names to hand back
 */
export function loadAppsScript(files, globals, exports) {
  const source = files.map((file) => readFileSync(join(ROOT, file), 'utf8')).join('\n\n');
  const names = Object.keys(globals);

  // Not strict mode, on purpose: a `.gs` file is not a module, and functions
  // it references but does not define (`sheetPush` and friends, when only
  // Code.gs is loaded) must fail when *called* rather than when parsed —
  // exactly as they would in Apps Script.
  // eslint-disable-next-line no-new-func
  const factory = new Function(...names, `${source}\n;return { ${exports.join(', ')} };`);
  return factory(...Object.values(globals));
}

/**
 * The whole backend, wired to stubs, ready to answer `doPost`.
 *
 * `driveFiles` maps a file id to `{ name }`. A file absent from it is absent
 * from Drive, which is the case worth testing: a delete of something already
 * gone is a success, not an error.
 *
 * `workbook` is the spreadsheet `SpreadsheetApp.openById` hands back. Without
 * one the open throws, as it does in Apps Script for an id that resolves to
 * nothing — so a test that forgets the fixture fails on the missing workbook
 * rather than quietly exercising a different path.
 *
 * @param {{owner?: string, tokens?: Record<string, object>, properties?: object,
 *          driveFiles?: Record<string, object>, files?: string[],
 *          workbook?: object|null}} setup
 */
export function backend({
  owner = 'owner@example.com', tokens = {}, properties = {},
  driveFiles = {}, files = ['Policy.gs', 'Code.gs', 'Drive.gs'],
  workbook = null,
} = {}) {
  const props = propertyStore(properties);
  const cache = cacheStore();
  const fetched = [];
  const logged = [];

  const globals = {
    PropertiesService: { getUserProperties: () => props, getScriptProperties: () => props },
    CacheService: { getUserCache: () => cache, getScriptCache: () => cache },
    Session: { getEffectiveUser: () => ({ getEmail: () => owner }) },

    UrlFetchApp: {
      fetch(url) {
        fetched.push(url);
        const token = decodeURIComponent((/access_token=([^&]*)/.exec(url) ?? [])[1] ?? '');
        const info = tokens[token];
        return {
          getResponseCode: () => (info ? 200 : 400),
          getContentText: () => JSON.stringify(info ?? { error: 'invalid_token' }),
        };
      },
    },

    Utilities: {
      base64EncodeWebSafe: (bytes) => Buffer.from(bytes).toString('base64url'),
      computeDigest: (_algorithm, value) => Buffer.from(String(value)),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      formatDate: (date) => date.toISOString().slice(0, 10),
    },

    ContentService: {
      createTextOutput: (text) => ({ text, setMimeType() { return this; }, getContent: () => text }),
      MimeType: { JSON: 'application/json' },
    },

    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
      // `withLock` takes a *user* lock, and this stub only had a script one.
      // Nothing noticed, because no test had ever driven a write through
      // `doPost` — which is the same blind spot that let the dispatch context
      // ship without a role.
      getUserLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }),
    },

    SpreadsheetApp: {
      openById: (id) => {
        if (!workbook) throw new Error(`No item with the given ID could be found: ${id}`);
        return workbook;
      },
    },
    DriveApp: {
      getFileById(id) {
        const file = driveFiles[id];
        // Apps Script throws for an id it cannot resolve; a stub that returned
        // null instead would test a path that never runs.
        if (!file) throw new Error(`No item with the given ID could be found: ${id}`);
        return {
          getName: () => file.name ?? id,
          setTrashed(trashed) { file.trashed = trashed; return this; },
        };
      },
    },
    GmailApp: {},
    console: { log: (...args) => logged.push(args.join(' ')), warn() {}, error() {} },
  };

  // Conditional, because the factory returns an object literal naming every
  // export: asking for `sheetPush` when Sheets.gs was not loaded is a
  // ReferenceError at return time rather than a missing key.
  const api = loadAppsScript(files, globals, [
    'doPost', 'doGet', 'verifyToken', 'admit', 'members', 'memberFor',
    'manageMembers', 'dispatch', 'fail',
    'policyAllows', 'readableEntities', 'roleRank',
    'manageDevices', 'noteDevice', 'readDevices',
    ...(files.includes('Sheets.gs') ? ['sheetPush', 'sheetPull'] : []),
  ]);

  /**
   * Call the backend the way the browser does: one POST, one JSON reply.
   *
   * `deviceId` is part of that shape and always was — the browser has sent one
   * since the first version. It is passed through here because the backend
   * finally reads it.
   */
  api.post = (action, token, payload = {},
    { deviceId = '', deviceLabel = '', clientVersion = '' } = {}) => JSON.parse(
    api.doPost({
      postData: {
        contents: JSON.stringify({ action, token, payload, deviceId, deviceLabel, clientVersion }),
      },
    }).getContent(),
  );

  return Object.assign(api, { props, cache, fetched, logged, owner, driveFiles });
}
