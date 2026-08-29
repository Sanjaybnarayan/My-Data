/**
 * How much of FamilyOS could be translated, and how much still could not?
 *
 * ## Why this exists
 *
 * "Internationalised" is the easiest claim in this repository to make falsely.
 * A `t()` function, a language menu and a few hundred translated lines look
 * exactly like a translated application until somebody switches language and
 * finds two thirds of their money in English. The difference between the two
 * is a number, and a number nobody derives is a number that drifts.
 *
 * So this counts. A **routed** string is one the application asks for through
 * `t()`, which a catalogue can therefore replace. An **unrouted** string is an
 * English sentence written directly into the source, which no catalogue can
 * reach and no translator will ever see.
 *
 * The unrouted count is a ratchet and it may only fall. That is the whole
 * mechanism: it does not demand that anybody translate anything, it demands
 * that the application stop growing new English it cannot offer a translator.
 *
 * ## What it cannot tell you
 *
 * Whether a translation is any good, or even in the right language. It
 * compares placeholders and counts keys. A catalogue full of nonsense that
 * keeps its `{amount}` intact scores the same as a careful one, and that limit
 * is stated here rather than left for somebody to discover by trusting the
 * percentage on the settings screen.
 *
 * It also cannot see a sentence assembled at runtime from two routed halves.
 * Concatenation is the fault this phase exists to fix and the one thing a
 * string counter is blind to, which is why the catalogue keeps whole sentences
 * and the review is a human one.
 *
 *   node tools/strings.mjs           check against the inventory
 *   node tools/strings.mjs --update  record the current count
 *   node tools/strings.mjs --list    print what is still unrouted
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withoutComments } from './field-coverage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY = join(ROOT, 'tools', 'strings.json');

/**
 * The catalogues themselves, which are nothing but user-facing English by
 * definition, and the locale machinery that quotes keys.
 *
 * Not excluded, and worth knowing: `js/data/schema.js` is counted, and roughly
 * two hundred of its strings are entity and field labels that a catalogue
 * *can* reach through `labelKeys()`. So the number below over-counts by about
 * that much, and a new entity raises it even though its labels are
 * translatable. Narrowing that means telling a label apart from an enum option
 * and a help string inside the schema, which is a separate piece of work; until
 * then the count is an upper bound and this comment is the reason it moves
 * when a phase lands.
 */
const NOT_COUNTED = new Set([
  'js/locale/en.js',
  'js/core/locale.js',
]);

/** A literal that is plainly machinery rather than something a person reads. */
function machinery(text) {
  return (
    /^[./#]/.test(text)                       // paths and selectors
    || /^[a-z-]+\/[a-z0-9.+-]+$/i.test(text)  // mime types
    || /^https?:/.test(text)                  // urls
    || /^[a-z]+:[a-z]+$/i.test(text)          // bus topics, `data:changed`
    || /^[\w-]+(\s+[\w-]+)*$/.test(text) === false && /^[^a-z]*$/.test(text)
  );
}

/**
 * Does this literal read like a sentence somebody would see?
 *
 * Deliberately conservative in one direction only: it would rather miss an
 * English string than invent one, because a count inflated by class names is a
 * count nobody will act on. Everything it misses is still English in the
 * source, so the honest reading of the number is "at least this many".
 */
export function userFacing(text) {
  const s = String(text);
  if (s.length < 6 || !s.includes(' ')) return false;
  if (machinery(s)) return false;

  // Two or more words of real letters, at least one of them lower case, so
  // `aria-label` values and `data-x y` attribute pairs do not qualify.
  const words = s.match(/[A-Za-z][A-Za-z']{1,}/g) ?? [];
  if (words.length < 2) return false;
  if (!/[a-z]/.test(s)) return false;

  // A dotted key with a space in it is not a sentence.
  if (/^[a-z][\w.]*\.[a-z][\w.]*$/i.test(s.trim())) return false;

  // CSS declarations and inline style strings.
  if (/^[a-z-]+\s*:\s*\S/.test(s) && /[;:]/.test(s) && !/[.?!]/.test(s)) return false;

  // A class list — `list-item muted`. All lower case, at least one hyphenated
  // token, no sentence punctuation. A real sentence in that shape would have
  // to be three lower-case words one of which is hyphenated and no full stop,
  // which is a price worth paying to keep stylesheet noise out of the count.
  if (/^[a-z][a-z-]*(\s+[a-z][a-z-]*)+$/.test(s) && s.includes('-')) return false;

  // An identifier built by template — `household_${id}`. Snake case with no
  // spaces outside the interpolation is machinery, not prose.
  if (/^[a-z][\w]*_/.test(s) && !/[.?!,]/.test(s)) return false;

  return true;
}

const LITERAL = /(['"`])((?:[^\\\n]|\\.)*?)\1/g;

/**
 * How far back to look for the property a literal is the value of.
 *
 * `class:` plus whitespace is eight characters at most in practice; twelve is
 * slack for an odd line break without reaching the previous property.
 */
const CONTEXT = 12;

/**
 * Whether a literal is the value of a `class:` property.
 *
 * A stylesheet class list is never prose, whoever writes it. `userFacing`
 * already tries to exclude them and its rule requires a **hyphen** — the
 * comment there explains why, and the reasoning is sound: dropping the hyphen
 * would exclude real two-word sentences like *"assumed this month"*.
 *
 * The consequence is that unhyphenated lists were counted. Measured, before
 * this: **195 occurrences of 11 distinct class lists** — `small muted`,
 * `mono small`, `textarea mono` — 5.6% of a figure that
 * `docs/PHASE_STATUS.md` scores Phase 25 on and that reads as
 * *"strings still written into the source"*. Nobody will ever translate
 * `small muted`.
 *
 * Position decides it rather than shape, so no sentence can be caught by this
 * however it is spelt, and no class list escapes it for want of a hyphen.
 */
function isClassValue(code, index) {
  return /\bclass:\s*$/.test(code.slice(Math.max(0, index - CONTEXT), index));
}

/** Every user-facing literal in one file, with the line it sits on. */
export function findIn(source) {
  const code = withoutComments(source);
  const found = [];
  let m;
  LITERAL.lastIndex = 0;
  while ((m = LITERAL.exec(code))) {
    const text = m[2];
    if (!userFacing(text)) continue;
    if (isClassValue(code, m.index)) continue;
    const line = code.slice(0, m.index).split('\n').length;
    found.push({ text, line });
  }
  return found;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** The whole application's unrouted English, grouped by file. */
export function survey({ root = ROOT } = {}) {
  const files = walk(join(root, 'js')).sort();
  const byFile = {};
  let total = 0;

  for (const full of files) {
    const rel = relative(root, full).split('\\').join('/');
    if (NOT_COUNTED.has(rel)) continue;
    const found = findIn(readFileSync(full, 'utf8'));
    if (!found.length) continue;
    byFile[rel] = found;
    total += found.length;
  }
  return { total, byFile };
}

export function readInventory() {
  try {
    return JSON.parse(readFileSync(INVENTORY, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The ratchet. Below the recorded number is progress and rewrites the record;
 * above it is a failure naming the files that grew.
 */
export function check(current, recorded) {
  if (!recorded) return { ok: false, why: 'no inventory recorded' };
  if (current.total > recorded.unrouted) {
    return {
      ok: false,
      why: `${current.total} unrouted English strings, up from ${recorded.unrouted}`,
      grew: Object.entries(current.byFile)
        .filter(([f, list]) => list.length > (recorded.byFile?.[f] ?? 0))
        .map(([f, list]) => `${f}: ${recorded.byFile?.[f] ?? 0} → ${list.length}`),
    };
  }
  return { ok: true, total: current.total, recorded: recorded.unrouted };
}

function main() {
  const args = process.argv.slice(2);
  const current = survey();

  if (args.includes('--list')) {
    for (const [file, list] of Object.entries(current.byFile)) {
      console.log(`\n${file}  (${list.length})`);
      for (const { line, text } of list.slice(0, 8)) {
        console.log(`  ${String(line).padStart(5)}  ${text.slice(0, 88)}`);
      }
      if (list.length > 8) console.log(`  ${' '.repeat(5)}  … ${list.length - 8} more`);
    }
    return;
  }

  const counts = Object.fromEntries(
    Object.entries(current.byFile).map(([f, list]) => [f, list.length]));

  if (args.includes('--update')) {
    writeFileSync(INVENTORY, `${JSON.stringify({
      note: 'Unrouted English strings — see tools/strings.mjs. This number may only fall.',
      unrouted: current.total,
      files: Object.keys(counts).length,
      byFile: counts,
    }, null, 2)}\n`);
    console.log(`recorded ${current.total} unrouted strings across ${Object.keys(counts).length} files`);
    return;
  }

  const result = check(current, readInventory());
  if (!result.ok) {
    console.error(`strings: ${result.why}`);
    for (const line of result.grew ?? []) console.error(`  ${line}`);
    process.exitCode = 1;
    return;
  }
  const slack = result.recorded - result.total;
  console.log(`${result.total} unrouted English strings (recorded ${result.recorded}`
    + `${slack > 0 ? `, ${slack} fewer — run --update` : ''})`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) main();
