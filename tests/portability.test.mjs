import { test, describe, assert, setSuite } from './harness.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { entityNames, entity } from '../js/data/schema.js';
import { columnsFor } from '../js/reports/csv.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function jsFiles(dir = join(ROOT, 'js'), out = []) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await jsFiles(path, out);
    else if (item.name.endsWith('.js')) out.push(path);
  }
  return out;
}

setSuite('portability');

describe('what an export carries', () => {
  test('a chat message is in no export at all, at any setting', async () => {
    // Two of the twenty-four are `message.body` and `deviceKey.publicKey`, and
    // the first is the interesting one: a conversation cannot be exported.
    //
    // That is correct rather than a gap. The body is sealed to devices, so a
    // CSV of it would be unreadable ciphertext, and an export path holding no
    // device key could not decrypt it to write anything better. The encrypted
    // archive carries the rows as they are stored and a restored device with
    // its key can still read them; a spreadsheet never could.
    const columns = columnsFor('message', { includeEncrypted: true }).map((c) => c.key ?? c);
    assert.not(columns.includes('body'), 'a sealed message body reached an export');
  });

  test('leaves out fields no setting can include', async () => {
    // `columnsFor` drops hidden fields unconditionally, so "include encrypted"
    // is not the whole story and docs/PORTABILITY.md says which fields stay
    // behind. Measured here rather than quoted.
    let all = 0;
    let widest = 0;
    for (const name of entityNames()) {
      all += entity(name).fields.length;
      widest += columnsFor(name, { includeEncrypted: true }).length;
    }
    assert.ok(all > widest,
      'every field is exportable now — docs/PORTABILITY.md says some are not');
    assert.equal(all - widest, 24,
      'the number of unexportable fields moved; docs/PORTABILITY.md states it '
      + 'as a live number and tools/self-description.mjs checks it, but the '
      + 'prose around it explains that three are refs — check that still holds');
  });

  test('drops reference fields, which is what makes a restore lossy', async () => {
    // The specific fact the document leans on: it is not only cosmetic fields
    // that are hidden. A hidden `ref` is a link between records that no export
    // carries, so even a perfect reader would restore orphans.
    const hiddenRefs = entityNames().flatMap((name) => entity(name).fields
      .filter((f) => f.hidden && f.ref)
      .map((f) => `${name}.${f.key}`));

    assert.ok(hiddenRefs.length > 0,
      'no hidden reference fields — docs/PORTABILITY.md claims there are three');
  });
});

describe('what the documents say about restoring', () => {
  test('agrees with whether a restore actually exists', async () => {
    // A tripwire keyed to the *claim*, because the last one was keyed to an
    // implementation and missed the thing it was written for.
    //
    // It watched `fromCsv` for a caller. The restore that arrived does not use
    // `fromCsv` at all — it is an encrypted archive with its own reader — so
    // the guard stayed green while the document it guarded became false: it
    // still opened "FamilyOS can export your records. It cannot restore them."
    // three commits after Settings grew a Restore button.
    //
    // So this asks the code the question the document answers, and requires
    // the two to agree in both directions.
    const service = await readFile(join(ROOT, 'js/services/archive.js'), 'utf8')
      .catch(() => '');
    // Every settings file, not one path. The first version read
    // `js/modules/settings.js` alone, and splitting that file moved the
    // Restore button into `js/modules/settings/data.js` — at which point the
    // guard reported no restore existed and demanded the document say so.
    // A check that a file move can flip is a check about file layout, and
    // this one is meant to be about whether a restore exists.
    const settingsDir = join(ROOT, 'js/modules/settings');
    const cardFiles = await readdir(settingsDir).catch(() => []);
    const settings = (await Promise.all([
      readFile(join(ROOT, 'js/modules/settings.js'), 'utf8'),
      ...cardFiles.filter((f) => f.endsWith('.js'))
        .map((f) => readFile(join(settingsDir, f), 'utf8')),
    ])).join('\n');
    const portability = await readFile(join(ROOT, 'docs/PORTABILITY.md'), 'utf8');

    const canRestore = /async restore\s*\(/.test(service)
      && /Restore from a file/.test(settings);

    const saysItCannot = /It cannot restore them/i.test(portability);

    if (canRestore) {
      assert.not(saysItCannot,
        'a restore exists — docs/PORTABILITY.md still says FamilyOS cannot restore');
      assert.ok(/Settings → Backup/.test(portability),
        'a restore exists and docs/PORTABILITY.md does not tell anyone where it is');
    } else {
      assert.ok(saysItCannot,
        'no restore exists and docs/PORTABILITY.md no longer says so');
    }
  });

  test('and the CSV exports are still described as what they are', async () => {
    // The archive did not make the exports readable. They remain forty-three
    // files that nothing reads back, and the document has to keep saying so or
    // somebody will treat them as the backup again.
    const callers = [];
    for (const path of await jsFiles()) {
      const source = await readFile(path, 'utf8');
      const used = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        .replace(/export function fromCsv\b/g, ' ');
      if (/\bfromCsv\b/.test(used)) callers.push(relative(ROOT, path));
    }

    const portability = await readFile(join(ROOT, 'docs/PORTABILITY.md'), 'utf8');
    if (callers.length === 0) {
      assert.ok(/nothing reads back|nothing can read them back|which nothing reads back/i
        .test(portability),
        'no CSV reader exists and docs/PORTABILITY.md no longer says the exports cannot be read back');
    } else {
      assert.ok(!/nothing reads back/i.test(portability),
        `fromCsv has a caller (${callers.join(', ')}) — docs/PORTABILITY.md is out of date`);
    }
  });
});
