/**
 * Which schema fields does anything actually read?
 *
 * ## Why this exists
 *
 * Four times now a field has been collected on a form and read by nothing:
 * `transaction.category`, `person.relationship`, `transaction.person` and
 * `importantDate.remindDaysBefore`. Each looked like a missing feature and was
 * a wiring gap — the data present, dated, structured and ignored. Each was
 * found by tripping over it.
 *
 * A field is *collected* the moment it is on the schema: the generic form
 * renders it, the generic table can column it, the detail screen shows it.
 * That is not the same as being **read**. `transaction.person` appeared on
 * three screens and no code ever looked at its value.
 *
 * So the test is whether the field's key appears by name anywhere outside the
 * schema itself and the generic machinery that works on any field at all.
 *
 * ## What a finding does and does not mean
 *
 * Most of these are fine. A policy's nominee, a vehicle's chassis number and a
 * medication's dosage are reference data: you record them, you read them on
 * screen, and nothing should compute with them. **This is not a list of bugs.**
 *
 * It is a list of everything that *could* be one, held still so that adding to
 * it is a deliberate act. The inventory is names only, with no per-field
 * justification, because a hundred invented justifications would be worth less
 * than the one question this actually asks: is this new field wired to
 * anything, and did you mean it not to be?
 *
 *   node tools/field-coverage.mjs           check against the inventory
 *   node tools/field-coverage.mjs --update  write the current set as the inventory
 *   node tools/field-coverage.mjs --list    print them grouped by entity
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entities, entityNames } from '../js/data/schema.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = join(ROOT, 'tools', 'field-coverage.json');

/**
 * Files that reference fields generically rather than by name. A hit in one of
 * these proves nothing: they iterate `entity.fields` and would "use" a field
 * no domain logic has ever heard of.
 */
const GENERIC = new Set([
  'js/data/schema.js',
  'js/data/validate.js',
  'js/data/formats.js',
  'js/data/migrations.js',
  'js/data/classification.js',
  'js/data/search.js',
  'js/modules/crud.js',
  'js/ui/components/form.js',
  'js/ui/components/table.js',
  'js/reports/build.js',
  'js/reports/csv.js',
  'js/reports/xlsx.js',
  'js/reports/pdf.js',
]);

/** Keys every entity carries, handled by the framework rather than a form. */
const HOUSEKEEPING = new Set([
  'id', 'createdAt', 'updatedAt', 'deletedAt', 'version', 'documents', 'notes', 'tags',
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** Every field key that nothing names, as `entity.key`, sorted. */
export function unreadFields() {
  const sources = walk(join(ROOT, 'js'))
    .map((path) => [path.slice(ROOT.length + 1), readFileSync(path, 'utf8')])
    .filter(([rel]) => !GENERIC.has(rel.split('\\').join('/')))
    .map(([, src]) => src);

  // The backend and the tooling read fields by name too.
  for (const extra of ['apps-script/Code.gs', 'apps-script/Sheets.gs', 'tools/statement.mjs']) {
    try { sources.push(readFileSync(join(ROOT, extra), 'utf8')); } catch { /* absent is fine */ }
  }

  const haystack = sources.join('\n');
  const found = [];

  for (const name of entityNames()) {
    for (const field of entities[name].fields) {
      if (HOUSEKEEPING.has(field.key)) continue;
      // Wired through a schema flag rather than by name: `expiryReminders` and
      // `upcomingDates` iterate the fields looking for these, so the value does
      // reach a derivation even though no code names the key.
      if (field.expiry || field.anniversary) continue;

      const escaped = field.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (!new RegExp(`\\b${escaped}\\b`).test(haystack)) found.push(`${name}.${field.key}`);
    }
  }

  return found.sort();
}

if (process.argv[1] && process.argv[1].endsWith('field-coverage.mjs')) {
  const current = unreadFields();

  if (process.argv.includes('--list')) {
    const byEntity = new Map();
    for (const entry of current) {
      const [entityName, key] = entry.split('.');
      if (!byEntity.has(entityName)) byEntity.set(entityName, []);
      byEntity.get(entityName).push(key);
    }
    for (const [entityName, keys] of byEntity) {
      console.log(`  ${entityName}`);
      for (const key of keys) console.log(`    ${key}`);
    }
    process.exit(0);
  }

  if (process.argv.includes('--update')) {
    writeFileSync(INVENTORY, `${JSON.stringify({
      '//': 'Schema fields that nothing reads by name. Stored so that a NEW one has to be'
        + ' a deliberate act rather than an oversight — see tools/field-coverage.mjs.'
        + ' Most entries are reference data and perfectly fine; this is not a list of bugs.',
      fields: current,
    }, null, 2)}\n`);
    console.log(`inventory updated — ${current.length} fields`);
    process.exit(0);
  }

  const { fields: known } = JSON.parse(readFileSync(INVENTORY, 'utf8'));
  const added = current.filter((f) => !known.includes(f));
  const wired = known.filter((f) => !current.includes(f));

  if (added.length) {
    console.error(`${added.length} field(s) are collected by a form and read by nothing:\n`);
    for (const field of added) console.error(`  ${field}`);
    console.error('\nWire it to something, or run `node tools/field-coverage.mjs --update`');
    console.error('and say in the commit why storing it is all it is for.');
    process.exit(1);
  }

  if (wired.length) {
    console.error(`${wired.length} field(s) in the inventory are now read:\n`);
    for (const field of wired) console.error(`  ${field}`);
    console.error('\nRun `node tools/field-coverage.mjs --update` to take them off the list.');
    process.exit(1);
  }

  console.log(`${current.length} fields stored and never read by name, all accounted for`);
}
