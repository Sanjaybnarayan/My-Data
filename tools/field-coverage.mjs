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
 *
 * ## One of them is only half generic
 *
 * `js/data/validate.js` is two files in one. The coercers and the type switch
 * are generic — and they are the reason it is listed, because `case 'number':`
 * names a *type* that several entities also use as a **field** name, so a bare
 * search there would clear `identityDocument.number` on the strength of a
 * switch label.
 *
 * `entityRules` in the same file is the opposite: fourteen entities' worth of
 * hand-written cross-field rules naming twenty-nine fields outright —
 * `r.endTime`, `r.completedOn`, `r.monthlyLimit`, `r.creditLimit`, `r.upiId`,
 * `r.deceasedOn`. Those are as by-name as any read in the application.
 *
 * Excluding the file wholesale therefore hid them, and `event.endTime` sat on
 * the unread inventory — described there as collected and read by nothing —
 * while a rule refused any event whose end time preceded its start. The
 * inventory said the field was dead; the application rejected records because
 * of it.
 *
 * So the block is put back in by position, the same way `isClassValue` and
 * `isLabelValue` in `tools/strings.mjs` decide by position rather than by
 * shape: a rule can be written in any style, and no style test would have
 * told these two halves apart.
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

/**
 * Source with its comments removed.
 *
 * The search below is a text search, and a text search over comments is a
 * ratchet prose can silence. It was: a doc comment in `domain/timeline.js`
 * quoted an activity feed reading *"changed upiId on an account"*, and
 * `account.upiId` came off the unread list without a line of code touching it.
 *
 * A field name in a comment is a field name in a sentence. Only code counts.
 *
 * One left-to-right scan that tracks strings and comments together, rather than
 * two regexes. The first version matched block comments with a regex, and a
 * file-picker `accept` string containing an image wildcard opens a block
 * comment as far as that regex is concerned — it paired with a close two
 * hundred lines later and swallowed the code between, including the only line
 * that reads `document.confidential`. A scanner that knows it is inside a
 * string cannot make that mistake.
 *
 * Regex literals are tracked here only well enough not to mis-strip: a comment
 * opener inside one used to swallow the code after it. This paragraph then said
 * the remaining risk was "a field reported unread when code names it — loud,
 * and unlike the failure this replaces, which was silent."
 *
 * **That was the wrong way round, and it was the silent one.** A regex body is
 * a pattern, and the patterns here are made of English words:
 * `/fuel|petrol|…|filling station|petro/i` sorts a bank narration and
 * `/report|prescription|scan|x-?ray|…/` sorts an uploaded file. Three fields
 * were reported **read** on the strength of those words and nothing else.
 * `withoutRegexBodies` below blanks them, and the note is kept rather than
 * deleted because a stated failure mode that does not happen is worse than an
 * unstated one — a reader who checks it finds nothing and concludes the gap is
 * closed.
 *
 * This comment cannot spell out the sequence it is about, for the same reason.
 */
/**
 * A file that is a catalogue rather than code.
 *
 * Owned here rather than in `tools/strings.mjs` because this module is already
 * where "what counts as code" is decided — `withoutComments` lives here and
 * that tool imports it. `notCounted()` there is this plus `js/core/locale.js`,
 * which is machinery holding catalogue-shaped English and is real code to this
 * search. One notion, one owner, and each tool's extra visible at its own site.
 */
export function isCatalogue(rel) {
  return rel.split('\\').join('/').startsWith('js/locale/');
}

/** Whether a `/` here can only be a regex, rather than division. */
function startsValue(out) {
  const before = out.replace(/\s+$/, '');
  if (!before) return true;
  const last = before[before.length - 1];
  if ('([{,;=:!&|?+-~*%<>^'.includes(last)) return true;
  // `return /x/` and friends: a keyword, then a value.
  return /\b(return|typeof|instanceof|in|of|new|delete|void|case|do|else|yield|await)$/
    .test(before);
}

export function withoutComments(source) {
  const text = String(source ?? '');
  let out = '';
  let quote = null;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }

    // A regex literal, which is neither a comment nor a string and used to be
    // treated as both. `/'[^']*'/` holds three apostrophes; the scanner took
    // the third as the start of a string and stopped stripping comments for
    // the rest of the file. Prose then counted as code, and a field nothing
    // reads was reported as read — this ratchet failing *open*, which is the
    // worst way for one to fail. It was found because a new file happened to
    // contain such a literal and the word `diagnosis` in a comment.
    //
    // Whether a `/` opens a regex or is division cannot be decided without
    // parsing, so this uses the usual heuristic: a regex may only start where
    // a value may start, which is after an operator, an opening bracket, a
    // comma or a keyword — never after a name, a number or a closing bracket.
    if (ch === '/' && next !== '/' && next !== '*' && startsValue(out)) {
      out += ch;
      i += 1;
      let inClass = false;
      while (i < text.length) {
        const c = text[i];
        if (c === '\\') { out += c + (text[i + 1] ?? ''); i += 2; continue; }
        if (c === '\n') break;              // an unterminated literal: it was division
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === '/' && !inClass) { out += c; i += 1; break; }
        out += c;
        i += 1;
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        // Newlines are kept so a stripped file still has the shape of the one
        // it came from, which matters the day somebody prints a line number.
        if (text[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * Source with the body of every regex literal blanked, the delimiters kept.
 *
 * `withoutComments` deliberately keeps regex literals whole — it only needs to
 * know where one starts so a `/` inside it does not open a comment. But a
 * regex body is a *pattern*, and the patterns in this application are made of
 * English words: `/fuel|petrol|…|filling station|petro/i` matches a bank
 * narration, and `/report|prescription|scan|x-?ray|…/` sorts an uploaded file
 * into a folder. Neither reads a field.
 *
 * Three fields were cleared by exactly that and nothing else:
 * `fuelLog.station` by "filling station", `healthRecord.prescription` by
 * "prescription", and `healthRecord.hospital` by "hospital" — which is
 * genuinely read, but by the search index, for a reason this tool did not
 * know either.
 *
 * The header of this file said regex literals were untracked and that the
 * resulting failure would be "a field reported unread when code names it —
 * loud". It was the other way round, and silent: fields reported **read**
 * because a matching pattern contains the word. Stated wrongly is worse than
 * not stated, because a reader who checks the stated failure mode finds
 * nothing and concludes the gap is closed.
 *
 * The same start-of-value heuristic as `withoutComments`, for the same reason
 * and with the same limit: whether a `/` opens a regex cannot be decided
 * without parsing.
 */
export function withoutRegexBodies(source) {
  const text = String(source ?? '');
  let out = '';
  let quote = null;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
      if (ch === quote) quote = null;
      out += ch;
      i += 1;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; out += ch; i += 1; continue; }

    if (ch === '/' && next !== '/' && next !== '*' && startsValue(out)) {
      out += '/';
      i += 1;
      // A `/` inside a character class does not close the literal, and a
      // newline means this was division after all.
      let inClass = false;
      while (i < text.length) {
        if (text[i] === '\\') { i += 2; continue; }
        if (text[i] === '\n') break;
        if (text[i] === '[') inClass = true;
        else if (text[i] === ']') inClass = false;
        else if (text[i] === '/' && !inClass) break;
        i += 1;
      }
      out += '/';
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

/**
 * The hand-written half of `js/data/validate.js`.
 *
 * From `export const entityRules` to the close of the object literal, which is
 * the whole of it and nothing else in the file. Read as text rather than
 * imported, because importing would give the functions and this needs the
 * source they were written in — the field names live in the bodies.
 *
 * Absent or unrecognisable, it contributes nothing and the check carries on
 * over-reporting exactly as it did before, which is the safe direction for a
 * miss here.
 */
export function handWrittenRules(source) {
  const text = String(source ?? '');
  const start = text.indexOf('export const entityRules');
  if (start < 0) return '';

  const end = text.indexOf('\n};', start);
  return end < 0 ? text.slice(start) : text.slice(start, end);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith('.js')) out.push(path);
  }
  return out;
}

/** The keys an entity's list is ordered by, without their direction. */
function sortKeys(def) {
  return String(def?.sort ?? '').split(',')
    .map((one) => one.trim().replace(/^-/, ''))
    .filter(Boolean);
}

/** Every field key that nothing names, as `entity.key`, sorted. */
export function unreadFields() {
  const sources = walk(join(ROOT, 'js'))
    .map((path) => [path.slice(ROOT.length + 1), readFileSync(path, 'utf8')])
    .filter(([rel]) => !GENERIC.has(rel.split('\\').join('/')))
    // A catalogue file is nothing but sentences, and this search already
    // strips comments because "a field name in a comment is a field name in a
    // sentence". The same argument, and it had cost three fields:
    // `will.registered` and `legalDocument.registered` were cleared by a line
    // about geofencing saying zones "are not registered with the phone", and
    // `healthRecord.diagnosis` by one saying the app offers "no advice, no
    // diagnosis and no score".
    .filter(([rel]) => !isCatalogue(rel))
    .map(([, src]) => src);

  // The backend and the tooling read fields by name too.
  for (const extra of ['apps-script/Code.gs', 'apps-script/Sheets.gs', 'tools/statement.mjs']) {
    try { sources.push(readFileSync(join(ROOT, extra), 'utf8')); } catch { /* absent is fine */ }
  }

  // And so does the half of `validate.js` that is not generic — see above.
  try {
    sources.push(handWrittenRules(readFileSync(join(ROOT, 'js', 'data', 'validate.js'), 'utf8')));
  } catch { /* absent is fine */ }

  const haystack = sources.map((one) => withoutRegexBodies(withoutComments(one))).join('\n');
  const found = [];

  for (const name of entityNames()) {
    for (const field of entities[name].fields) {
      if (HOUSEKEEPING.has(field.key)) continue;
      // Wired through a schema flag rather than by name: `expiryReminders` and
      // `upcomingDates` iterate the fields looking for these, so the value does
      // reach a derivation even though no code names the key.
      if (field.expiry || field.anniversary) continue;

      // The same shape, one flag along: an entity's `sort` names its keys in a
      // string, and `sortBy` reads them generically. A field a list is ordered
      // by is read on every screen that draws the list.
      if (sortKeys(entities[name]).includes(field.key)) continue;

      // And the fourth of those flags, which this tool did not know about:
      // `searchableValues()` in `js/security/fieldcrypto.js` filters on
      // `f.search && !f.encrypted` and reads `record[f.key]` — on every write,
      // for 140 fields. Eleven of them sat on the unread inventory, described
      // there as collected and read by nothing, while the local search index
      // read them on every keystroke. `account.upiId` was one, and it is the
      // field this file's own header cites as the reason comments are
      // stripped: the fix put it back on a list it never belonged on.
      if (field.search && !field.encrypted) continue;

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
