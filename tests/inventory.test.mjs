/**
 * The data inventory says what exists. This checks nothing exists that it missed.
 *
 * `docs/DATA_INVENTORY.md` answers section 51 — data, purpose, source, storage,
 * retention, access, sharing, encryption, deletion — and the failure mode of a
 * document like that is not being wrong. It is being *incomplete*: a store
 * added next year, a `localStorage` key added next week, and an inventory that
 * still lists what was there when somebody sat down to write it.
 *
 * So the checks run the other way round from the usual. Rather than asserting
 * the document's claims are true, they enumerate what the code actually has
 * and demand the document account for each one. A new store fails this until
 * somebody writes its row.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { systemStores } from '../js/data/schema.js';
import { LIMIT } from '../js/data/diagnostics.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const doc = readFileSync(join(ROOT, 'docs/DATA_INVENTORY.md'), 'utf8');

setSuite('data inventory');

/**
 * Every `.js` under `js/`, which is what "what ships" means below.
 *
 * `android/app/src/main/assets/public/` is a *copy* of this tree made by
 * `cap sync`, and walking it would double every count and report each finding
 * twice under a path nobody edits.
 */
function shipped(dir = join(ROOT, 'js'), out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) shipped(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const sources = shipped().map((file) => readFileSync(file, 'utf8'));

describe('every store the code has is in the document', () => {
  /*
   * `systemStores` is the authority. The record entities are covered as a
   * class rather than one row each — 53 rows would be a copy of the schema,
   * and `docs/DATA_CLASSIFICATION.md` already grades them field by field.
   */
  for (const store of Object.keys(systemStores)) {
    test(`\`${store}\` is accounted for`, () => {
      assert.includes(doc, `\`${store}\``,
        `docs/DATA_INVENTORY.md has no row for the ${store} store`);
    });
  }
});

describe('every browser-storage key the code writes is in the document', () => {
  /*
   * Found by their literal, because that is how they are written: a handful of
   * `const KEY = 'familyos.…'` declarations scattered across the modules that
   * own them. A key added anywhere in `js/` is a key this finds.
   *
   * `familyos.keywrap.json` is excluded and the exclusion is the interesting
   * part: it matches the same pattern and is *not* a storage key at all — it
   * is the name of a file in Drive's appDataFolder. The first draft of the
   * inventory listed it as browser storage on exactly that confusion.
   */
  const DRIVE_FILE = 'familyos.keywrap.json';

  const keys = [...new Set(
    sources.flatMap((src) => [...src.matchAll(/'(familyos\.[a-zA-Z][\w.]*)'/g)]
      .map((m) => m[1])),
  )].filter((key) => key !== DRIVE_FILE).sort();

  test('there are some, so an empty scan cannot pass silently', () => {
    assert.ok(keys.length >= 5, `only found ${keys.length} keys — the scan is broken`);
  });

  for (const key of keys) {
    test(`\`${key}\` is accounted for`, () => {
      assert.includes(doc, key, `docs/DATA_INVENTORY.md does not mention ${key}`);
    });
  }

  test('and the Drive file is described as a Drive file, not a storage key', () => {
    assert.includes(doc, DRIVE_FILE);
    assert.includes(doc, 'appDataFolder',
      'the escrow key file is listed without saying where it actually lives');
  });
});

describe('the claims that can be swept for', () => {
  test('nothing that ships is an analytics or telemetry SDK', () => {
    /*
     * The inventory's strongest single claim — "Anybody else: Nothing" — and
     * the one most easily falsified by a later convenience. Matched against
     * identifiers rather than prose, so a comment explaining that diagnostics
     * are *not* telemetry does not trip it.
     */
    const banned = /\b(gtag|dataLayer|mixpanel|amplitude|Sentry|posthog|FirebaseAnalytics|logEvent)\b/;
    for (const [index, src] of sources.entries()) {
      assert.not(banned.test(src),
        `an analytics identifier appears in ${shipped()[index]}`);
    }
  });

  test('the diagnostics bound the document quotes is the real one', () => {
    assert.equal(LIMIT, 200);
    assert.includes(doc, `Bounded at ${LIMIT} entries`);
  });

  test('the nine columns section 51 asks for are all present', () => {
    for (const column of ['Data', 'Purpose', 'Source', 'Storage', 'Retention',
      'Access', 'Sharing', 'Encryption', 'Deletion']) {
      assert.includes(doc, `| ${column} |`, `the ${column} column is gone`);
    }
  });
});
