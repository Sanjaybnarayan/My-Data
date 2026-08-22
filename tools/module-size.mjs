/**
 * How big has any one file been allowed to get?
 *
 * ## Why this exists
 *
 * The Phase 0 audit named `js/modules/settings.js` a **god component** at
 * 1,597 lines and filed it as a P2. Nothing measured it afterwards, so by the
 * time anybody looked again it was **1,893** — the named problem had grown by
 * 296 lines while sitting on a risk register describing it.
 *
 * That is the shape this repository keeps finding: a claim in a document with
 * nothing checking it. `docs/ARCHITECTURE_DRIFT.md` is about the same failure
 * for architecture rows, `tools/self-description.mjs` for numbers written into
 * prose. This is the same instrument pointed at file size.
 *
 * ## What is measured, and what is not
 *
 * Every file over `CROWDED` lines gets its recorded size written down, and
 * **none of them may grow**. New files may not join the list either. Both
 * halves are read off the tree rather than maintained by hand: a file drops
 * out of the budget by getting smaller, and there is nowhere to add one.
 *
 * **Why per-file rather than one total.** The single biggest file that ships
 * is `js/data/schema.js` at 2,099 lines, and it is not a god component — it
 * is fifty-three entity declarations, which is what a schema looks like. A
 * one-number budget would have been pinned to it, and moving three hundred
 * lines out of `settings.js` would not have changed the number at all. The
 * alternative was a list of files to exclude, which is the hand-maintained
 * list beside a derivable one that this repository has now found ten times.
 * Per-file caps need neither: `schema.js` is simply frozen at its size, which
 * is the honest thing to say about a declarative file nobody wants growing.
 *
 * **Line count is a proxy and is stated as one.** What actually makes a god
 * component bad is unrelated concerns sharing mutable state and reloading
 * together, and no counter sees that. What a counter does see is the thing the
 * audit itself measured, in the units the audit used — and a proxy that
 * ratchets beats a judgement nobody re-makes.
 *
 * Tests and tools are excluded. A long test file is a long list of checks,
 * which is the opposite of a problem, and `tests/browser.mjs` would otherwise
 * sit at the top of this list forever.
 *
 *   node tools/module-size.mjs           check against the budget
 *   node tools/module-size.mjs --list    print the biggest files
 *   node tools/module-size.mjs --update  write the current numbers as budget
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'tools', 'module-size.json');

/** Above this many lines, a file is counted as crowded. */
export const CROWDED = 800;

/** Everything that ships to a browser. */
function sourceFiles(dir = join(ROOT, 'js'), out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Every file that ships, with its line count, biggest first. */
export function sizes() {
  return sourceFiles()
    .map((full) => ({
      file: relative(ROOT, full).replace(/\\/g, '/'),
      lines: readFileSync(full, 'utf8').split('\n').length,
    }))
    .sort((a, b) => b.lines - a.lines);
}

/** Every crowded file and its size, derived from the tree. */
export function measure(all = sizes()) {
  return Object.fromEntries(all
    .filter((one) => one.lines > CROWDED)
    .map((one) => [one.file, one.lines]));
}

/**
 * Where the recorded sizes and the tree disagree.
 *
 * Two kinds, and both are failures: a file that grew past what was written
 * down, and a file that has newly crossed `CROWDED` with nothing recorded for
 * it. A file that *shrank* is not a failure — it is the point — and is
 * reported separately so somebody remembers to lock it in.
 */
export function against(recorded, now = measure()) {
  const grew = [];
  const joined = [];
  const shrank = [];
  for (const [file, lines] of Object.entries(now)) {
    const was = recorded[file];
    if (was === undefined) joined.push({ file, lines });
    else if (lines > was) grew.push({ file, lines, was });
    else if (lines < was) shrank.push({ file, lines, was });
  }
  for (const [file, was] of Object.entries(recorded)) {
    if (now[file] === undefined) shrank.push({ file, lines: 0, was, left: true });
  }
  return { grew, joined, shrank };
}

export function budget() {
  return JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));
}

const all = sizes();
const now = measure(all);

if (process.argv.includes('--list')) {
  for (const one of all.slice(0, 15)) {
    console.log(`${String(one.lines).padStart(5)}  ${one.file}`);
  }
} else if (process.argv.includes('--update')) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify({
    note: `Every file over ${CROWDED} lines. None may grow and none may join. `
      + 'tools/module-size.mjs says why.',
    crowdedAt: CROWDED,
    files: now,
  }, null, 2)}\n`);
  console.log(`recorded ${Object.keys(now).length} files over ${CROWDED} lines`);
} else {
  const recorded = budget().files ?? {};
  const { grew, joined, shrank } = against(recorded, now);

  for (const one of grew) {
    console.error(`  ${one.file} is ${one.lines} lines, up from ${one.was}`);
  }
  for (const one of joined) {
    console.error(`  ${one.file} is ${one.lines} lines and has never been over ${CROWDED} before`);
  }
  if (grew.length || joined.length) {
    console.error('\nNo crowded file may grow and none may join. Move code out '
      + 'rather than raising the number.');
    process.exit(1);
  }

  console.log(`${Object.keys(now).length} files over ${CROWDED} lines, none grown`
    + (shrank.length ? ` — ${shrank.length} smaller, run --update to lock it in` : ''));
}
