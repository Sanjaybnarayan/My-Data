/**
 * The type check, with a ratchet.
 *
 * ## Why a budget rather than zero
 *
 * The first run reported 500 findings across 25,000 lines that had never been
 * checked. Roughly four hundred were one cause — components whose JSDoc did not
 * describe the options they accept — and fixing that fixed the documentation
 * too. What is left is mostly test fixtures handing partial objects to functions
 * that want whole ones.
 *
 * There were two honest ways to finish and one dishonest one. The dishonest one
 * is to loosen the config until it reports nothing and call the codebase
 * typechecked. The honest ones are to fix all 204 now, or to write the number
 * down and refuse to let it rise.
 *
 * This is the second. The budget is a fact about the repository, sitting in
 * version control where a rise is a diff somebody has to justify, and every
 * commit that lowers it lowers it permanently.
 *
 * ## What it will not catch
 *
 * A new file could be added with errors of its own as long as somebody else
 * removed as many elsewhere. A per-file budget would close that, and would also
 * be a hundred numbers to maintain. If the count starts drifting sideways
 * rather than down, that is the trade to revisit.
 *
 *   node tools/typecheck.mjs           check against the budget
 *   node tools/typecheck.mjs --update  write the current count as the budget
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_FILE = join(ROOT, 'tools', 'typecheck-budget.json');

const result = spawnSync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const lines = output.split('\n').filter((line) => / error TS\d+: /.test(line));
const count = lines.length;

// A configuration error is not a finding to be budgeted — it means the check
// did not run properly, and letting it pass because the number happened to be
// under budget would be the worst possible outcome for a tool like this.
const configErrors = lines.filter((line) => /tsconfig\.json|error TS5\d{3}/.test(line));
if (configErrors.length) {
  console.error('The type checker could not be configured:\n');
  for (const line of configErrors) console.error(`  ${line}`);
  process.exit(2);
}

/*
 * Neither is a file that would not parse, and this one had teeth.
 *
 * `tsc` stops semantic analysis on a source file it cannot parse. One broken
 * import — a line inserted into the middle of a multi-line `import { … }` in
 * `js/modules/calendar.js` — took the whole run from 156 findings to **five**,
 * all of them TS1003/TS1005/TS1109 parse errors on that one file, and this
 * script printed `5 type findings (budget 155)` and exited 0.
 *
 * A budget compares a number against a ceiling, so the one failure it cannot
 * see is the one that makes the number *smaller*. The application was broken —
 * Calendar would not have loaded at all — and the check that exists to catch
 * exactly that reported a pass with 150 to spare.
 *
 * TS1xxx is the syntax range. There is no budget for it: a file that does not
 * parse is not a finding, it is the check not having run.
 *
 * TS1064 is the exception and is excluded by name. It is the JSDoc complaint
 * that an `async` function's `@returns` should be written `Promise<T>` — a
 * semantic quibble filed in the syntax range, which stops no parse and which
 * this repository carries two of, in `js/security/crypto.js` and
 * `js/sync/drive.js`. Without the exclusion this guard fails on a clean tree,
 * which is how it was first written and how it was caught. Any other TS1xxx
 * that turns out to be survivable belongs on this list beside it, with the
 * same kind of note; the default stays "a TS1xxx means the parser gave up".
 */
const SURVIVABLE = new Set(['TS1064']);
const syntaxErrors = lines.filter((line) => {
  const code = / error (TS1\d{3}): /.exec(line)?.[1];
  return code !== undefined && !SURVIVABLE.has(code);
});
if (syntaxErrors.length) {
  console.error('A source file could not be parsed, so nothing else was checked:\n');
  for (const line of syntaxErrors.slice(0, 10)) console.error(`  ${line}`);
  process.exit(2);
}

const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

if (process.argv.includes('--update')) {
  writeFileSync(BUDGET_FILE, `${JSON.stringify({ ...budget, max: count }, null, 2)}\n`);
  console.log(`budget updated: ${budget.max} → ${count}`);
  process.exit(0);
}

const byFile = new Map();
for (const line of lines) {
  const file = line.split('(')[0];
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}

console.log(`${count} type findings (budget ${budget.max})`);

if (count > budget.max) {
  console.error(`\nThat is ${count - budget.max} more than the budget. The worst files:\n`);
  for (const [file, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.error(`  ${String(n).padStart(4)}  ${file}`);
  }
  console.error('\nFix them, or run `node tools/typecheck.mjs --update` and say why in the commit.');
  process.exit(1);
}

if (count < budget.max) {
  console.log(`${budget.max - count} fewer than the budget — run with --update to lock it in.`);
}
