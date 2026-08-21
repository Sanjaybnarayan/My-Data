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
    assert.equal(all - widest, 22,
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

describe('what can read one back', () => {
  test('nothing in the application does', async () => {
    // A tripwire, not an assertion that this is right — it is the opposite of
    // right. docs/PORTABILITY.md, the comment on `fromCsv`, and the native
    // setup guide all state that FamilyOS cannot restore an export. The day
    // somebody wires up a reader, all three become wrong together, and this is
    // what says so.
    const callers = [];
    for (const path of await jsFiles()) {
      const source = await readFile(path, 'utf8');
      const used = source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ')
        // The declaration mentions its own name, and a function is not its own
        // caller. Removing it is what makes a real call the only thing left.
        .replace(/export function fromCsv\b/g, ' ');
      if (/\bfromCsv\b/.test(used)) callers.push(relative(ROOT, path));
    }

    assert.length(callers, 0,
      `fromCsv now has a caller (${callers.join(', ')}). If a restore has been `
      + 'built, update docs/PORTABILITY.md, the comment on fromCsv in '
      + 'js/reports/csv.js, and the backup section of docs/CAPACITOR_SETUP.md.');
  });

  test('and the documents say so rather than implying a backup', async () => {
    const portability = await readFile(join(ROOT, 'docs/PORTABILITY.md'), 'utf8');
    assert.ok(/cannot restore them/i.test(portability),
      'PORTABILITY.md no longer states that exports cannot be restored');
  });
});
