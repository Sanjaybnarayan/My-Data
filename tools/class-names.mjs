/**
 * How many CSS class names does more than one file write?
 *
 * ## Why this exists
 *
 * Twice in three changes, a class name invented for a new component was
 * already the name of an existing one, and the new stylesheet rules silently
 * restyled something nobody had touched:
 *
 *   - `.nav-group`, invented for Finance's group tabs, was already the
 *     shell sidebar's module list (`js/ui/shell.js`, `css/base.css`). Because
 *     `components.css` loads after `base.css`, every module link in the
 *     desktop rail quietly took a 44px floor, a `white-space: nowrap` and a
 *     2px border it never asked for.
 *   - `.filter-bar`, invented for the schema-generated record filters, was
 *     already the Transactions ledger's own panel — three rows of it — and
 *     `js/modules/notifications.js` besides. Two new rules added a margin to
 *     all of them.
 *
 * **Neither was caught by a stylesheet or by a test that was looking for it.**
 * The first was found in a screenshot; the second by an unrelated check
 * getting confused about which component it was standing in front of. Both
 * would have been caught by one `grep` before the name was chosen, which is
 * exactly the kind of thing nobody does twice in a row.
 *
 * ## What is measured
 *
 * Every class name written into a `class:` attribute anywhere under `js/`,
 * and how many files write it. The number here is **how many names more than
 * one file writes**, and it may only fall.
 *
 * That is a narrower instrument than it looks, and the narrowness is the
 * point. Adding a fourth `.card` or a tenth `.btn--primary` does not move it:
 * those names are already shared, so the count is unchanged. The number rises
 * for exactly one event — **a name that one file wrote now written by two** —
 * which is the collision above and almost nothing else.
 *
 * ## What it does not measure
 *
 * It cannot tell a collision from deliberate sharing. `.sentence-row` is
 * written by Health and by Ledgers on purpose, and it counts here the same as
 * `.filter-bar` did. So the number is not a defect count; it is a budget,
 * and the honest reading of a failure is *"you have introduced a shared class
 * name — is that what you meant?"*
 *
 * Sharing a name deliberately is fine and this repository does it. What is
 * not fine is doing it by accident, discovering it from a screenshot, and
 * having nothing to stop the third one.
 *
 *   node tools/class-names.mjs           check against the budget
 *   node tools/class-names.mjs --list    print the shared names and their files
 *   node tools/class-names.mjs --update  write the current number as budget
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'tools', 'class-names.json');

function sourceFiles(dir = join(ROOT, 'js'), out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Every class name written in `js/`, and the files that write it.
 *
 * Only the literal forms: `class: 'a b'` and the array shape
 * `class: ['a', cond && 'b']`. A name assembled from a variable is invisible
 * here, which is the usual trade — the check covers what it can see, and
 * says so rather than pretending otherwise.
 */
export function writers() {
  const found = new Map();

  for (const full of sourceFiles()) {
    const file = relative(ROOT, full).replace(/\\/g, '/');
    const src = readFileSync(full, 'utf8');

    const add = (text) => {
      for (const cls of text.split(/\s+/).filter(Boolean)) {
        if (!found.has(cls)) found.set(cls, new Set());
        found.get(cls).add(file);
      }
    };

    for (const m of src.matchAll(/class:\s*'([^']*)'/g)) add(m[1]);
    for (const m of src.matchAll(/class:\s*\[([^\]]*)\]/gs)) {
      for (const lit of m[1].matchAll(/'([^']*)'/g)) add(lit[1]);
    }
  }

  return found;
}

/** The names more than one file writes, most-written first. */
export function shared(found = writers()) {
  return [...found]
    .filter(([, files]) => files.size > 1)
    .map(([name, files]) => ({ name, files: [...files].sort() }))
    .sort((a, b) => b.files.length - a.files.length || a.name.localeCompare(b.name));
}

export function budget() {
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

const now = shared();

if (process.argv.includes('--list')) {
  for (const one of now) {
    console.log(`${String(one.files.length).padStart(2)}  ${one.name.padEnd(26)}`
      + `${one.files.map((f) => f.replace(/^js\//, '')).join('  ')}`);
  }
  console.log(`\n${now.length} class names written by more than one file`);
} else if (process.argv.includes('--update')) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify({
    note: 'Class names written by more than one file. This may only fall. '
      + 'tools/class-names.mjs says why.',
    count: now.length,
    // Alphabetical, not by how many files write each. Frequency order shifts
    // whenever an already-shared name gains another user, which is ordinary
    // reuse and not what this measures — the budget would then churn on
    // changes it is meant to ignore.
    names: now.map((one) => one.name).sort(),
  }, null, 2)}\n`);
  console.log(`recorded ${now.length} shared class names`);
} else {
  const recorded = budget();
  const was = new Set(recorded.names ?? []);
  const joined = now.filter((one) => !was.has(one.name));

  if (now.length > recorded.count) {
    for (const one of joined) {
      console.error(`  .${one.name} is now written by ${one.files.length} files: `
        + one.files.join(', '));
    }
    console.error(`\n${now.length} shared class names, up from ${recorded.count}. `
      + 'A name one file wrote is now written by two — check it is not already '
      + 'somebody else\'s component before styling it.');
    process.exit(1);
  }

  const left = (recorded.names ?? []).filter((name) => !now.some((one) => one.name === name));
  console.log(`${now.length} class names written by more than one file`
    + (left.length ? `, ${left.length} fewer — run --update to lock it in` : ''));
}
