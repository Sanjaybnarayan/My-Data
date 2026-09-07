/**
 * Is each security control still held by something?
 *
 * ## Why this exists
 *
 * Every other instrument here asks whether the code is right. This one asks a
 * different question, and it is the one that went unasked longest: **is
 * anything keeping it right?**
 *
 * The answer, when somebody finally looked, was mostly no. Seventy-two
 * controls were reverted by hand across the security surface and the suite was
 * run against each broken version. **Sixteen of them passed** — the code was
 * correct and nothing was holding it correct, so the next refactor near any of
 * them would have taken a real defence out with no test to say so. All six
 * guards on the browser OAuth flow were in that set, including the one whose
 * removal hands a household's Google access token to any page that opens the
 * callback.
 *
 * That whole exercise lived in a scratch directory and was thrown away. This
 * file is what makes it repeatable, which is the only form the finding is
 * worth anything in — a one-off audit of test coverage decays exactly as fast
 * as the coverage it audited.
 *
 * ## What it does
 *
 * `tools/mutation.json` names, for each control, the exact text to break and
 * the suite that must notice. For each entry this file writes the broken
 * version, runs **only that suite** — 100 to 700ms rather than the twenty-five
 * seconds of a full run — restores the file, and records what happened.
 *
 * Three outcomes, and only one of them is a pass:
 *
 *   - **caught**   the named suite failed. The control is held.
 *   - **survived** the suite passed against broken code. Nothing holds it.
 *   - **stale**    the text to break is no longer in the file.
 *
 * **Stale fails the run**, and that is deliberate rather than lenient. A
 * catalogue entry that silently stops applying is a control that silently
 * stops being checked, which is the exact failure this file exists to catch,
 * one level up. When a refactor moves the code, the entry is updated on
 * purpose or removed on purpose.
 *
 * ## What it is not
 *
 * Not a coverage metric, and not a substitute for one. It says nothing about
 * the controls nobody thought to list — the catalogue is hand-written, and a
 * control missing from it is invisible here exactly as it was before. It is a
 * ratchet on a chosen set, not a survey.
 *
 * Nor is it mutation testing in the academic sense: no operators, no automatic
 * generation, no mutation score. Every entry is a specific defeat of a
 * specific defence, written out in the words of what it would let somebody do.
 * That is what makes a survivor readable as a finding rather than as a number.
 *
 * ## The baseline, which is not a formality
 *
 * Before breaking anything, every suite the catalogue names is run once against
 * the untouched tree and required to come back green with a tally.
 *
 * Both halves of that matter, and both were found the hard way. A suite name
 * with a **typo in it** matches no test files, so the runner exits without a
 * tally — and "no tally" is read here as "the runner died", which is a caught
 * mutation. `securiy` for `security` reported the control held while nothing
 * whatever had run. And a suite that is **already failing** makes every
 * mutation pointed at it report caught, for a reason that has nothing to do
 * with the control.
 *
 * Either way the answer is a false pass in a tool whose whole purpose is
 * finding false passes, so neither is allowed to start.
 *
 * ## Safety
 *
 * It edits files in the working tree, so it restores every one in a `finally`
 * and again on an interrupt, then verifies at the end that every file is
 * byte-for-byte what it was. If that last check fails it says so loudly, and
 * the recovery is `git checkout` on the named files. Do not run it against a
 * tree with uncommitted changes to the files it touches.
 *
 *   node tools/mutation.mjs           run the whole catalogue
 *   node tools/mutation.mjs --list    print it without running anything
 *   node tools/mutation.mjs rbac      run only entries whose label or file matches
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOGUE = join(ROOT, 'tools', 'mutation.json');

/** What was on disk before anything was touched, by path. */
const originals = new Map();

function read(relative) {
  const path = join(ROOT, relative);
  const text = readFileSync(path, 'utf8');
  if (!originals.has(relative)) originals.set(relative, text);
  return text;
}

const write = (relative, text) => writeFileSync(join(ROOT, relative), text, 'utf8');

/** Put every file back. Safe to call twice. */
function restoreAll() {
  for (const [relative, text] of originals) {
    try {
      if (readFileSync(join(ROOT, relative), 'utf8') !== text) write(relative, text);
    } catch { /* the file is gone; nothing useful to do from here */ }
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { restoreAll(); process.exit(130); });
}

/**
 * Run one suite, and answer only "did anything fail".
 *
 * A run that dies without printing a tally counts as **caught**, not as
 * survived. That distinction is not pedantry: the first version of this
 * measurement read "no failure lines" as "nothing noticed", and a mutation
 * that crashed the runner outright was reported as a surviving control when it
 * had been caught in the loudest way available.
 */
function suiteNotices(suite) {
  const done = spawnSync('node', ['tests/run.mjs', suite], {
    cwd: ROOT, encoding: 'utf8', timeout: 300_000,
  });
  const out = `${done.stdout ?? ''}${done.stderr ?? ''}`;
  const tally = /(\d+)\/(\d+) passed/.exec(out);
  if (!tally) return { noticed: true, how: 'the runner did not finish' };
  const failures = out.split('\n').filter((line) => line.trim().startsWith('FAIL')).length;
  if (failures) return { noticed: true, how: `${failures} check${failures === 1 ? '' : 's'}` };
  return { noticed: false, how: `${tally[0]}` };
}

const args = process.argv.slice(2);
const filters = args.filter((one) => !one.startsWith('--'));
const { mutations } = JSON.parse(readFileSync(CATALOGUE, 'utf8'));

const chosen = mutations.filter((one) => !filters.length
  || filters.some((f) => one.label.includes(f) || one.file.includes(f) || one.suite === f));

if (args.includes('--list')) {
  for (const one of chosen) console.log(`  ${one.suite.padEnd(10)} ${one.label}`);
  console.log(`\n${chosen.length} of ${mutations.length} in the catalogue.`);
  process.exit(0);
}

/*
 * Every suite named, run once against the untouched tree. A name that matches
 * no files, or a suite that is already red, would make every mutation pointed
 * at it look caught — see the header.
 */
const suites = [...new Set(chosen.map((one) => one.suite))].sort();
const unusable = [];
for (const suite of suites) {
  const { noticed, how } = suiteNotices(suite);
  if (noticed) unusable.push({ suite, how });
}
if (unusable.length) {
  console.error('Cannot start. These suites do not come back green on an untouched tree:\n');
  for (const one of unusable) console.error(`  ${one.suite}: ${one.how}`);
  console.error('\nA suite that names no files, or one already failing, makes every');
  console.error('mutation pointed at it report "caught" while proving nothing.');
  process.exit(2);
}

const survived = [];
const stale = [];
let caught = 0;

console.log(`${suites.length} suites green to begin with.`);
console.log(`Breaking ${chosen.length} controls, one at a time.\n`);

try {
  for (const { label, file, find, replace, suite } of chosen) {
    const source = read(file);
    const hits = source.split(find).length - 1;

    if (hits === 0) {
      stale.push({ label, file, why: 'the text to break is not in the file' });
      console.log(`  STALE     ${label}`);
      continue;
    }
    if (hits > 1) {
      // Replacing the first of several is a mutation nobody can predict from
      // reading the catalogue, so it is refused rather than guessed at.
      stale.push({ label, file, why: `the text to break appears ${hits} times` });
      console.log(`  STALE     ${label}  (${hits} occurrences)`);
      continue;
    }

    write(file, source.replace(find, replace));
    const { noticed, how } = suiteNotices(suite);
    write(file, source);

    if (noticed) {
      caught += 1;
      console.log(`  caught    ${label}  ·  ${suite}: ${how}`);
    } else {
      survived.push({ label, file, suite });
      console.log(`  SURVIVED  ${label}  ·  ${suite}: ${how}`);
    }
  }
} finally {
  restoreAll();
}

// The tree must be exactly as it was found. Anything else is a bug in this
// file, and the household's repository is not the place to discover it later.
const dirty = [...originals].filter(([relative, text]) => {
  try { return readFileSync(join(ROOT, relative), 'utf8') !== text; } catch { return true; }
});
if (dirty.length) {
  console.error(`\nCOULD NOT RESTORE: ${dirty.map(([one]) => one).join(', ')}`);
  console.error('Run `git checkout` on those files before doing anything else.');
  process.exit(2);
}

console.log(`\n${caught} of ${chosen.length} controls are held.`);

if (stale.length) {
  console.error('\nStale catalogue entries — the code moved and nothing said so:');
  for (const one of stale) console.error(`  ${one.label}\n    ${one.file}: ${one.why}`);
  console.error('\nUpdate tools/mutation.json deliberately, or remove the entry deliberately.');
}

if (survived.length) {
  console.error('\nControls nothing is holding:');
  for (const one of survived) {
    console.error(`  ${one.label}\n    ${one.file} — breaking it did not fail \`${one.suite}\``);
  }
  console.error('\nWrite the check that fails when this is broken. Do not remove the entry.');
}

process.exit(stale.length || survived.length ? 1 : 0);
