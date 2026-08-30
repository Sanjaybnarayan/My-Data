#!/usr/bin/env node
/**
 * The applicability matrix, checked against the repository.
 *
 * The build prompt says twice, in different words: *never claim regulatory
 * compliance without implementation, testing, evidence and applicability
 * review*, and *never claim compliance automatically.* A matrix is the easiest
 * place in a codebase to break that rule, because a row is one word and nobody
 * reads a table twice.
 *
 * So four things are checked:
 *
 *  1. **Every citation resolves, and a cited suite is one that runs.** A row
 *     saying IMPLEMENTED must name a file that exists; TESTED must name a suite
 *     the runner actually executes. A path renamed a year ago is a claim with
 *     nothing behind it, and a suite renamed out of `*.test.mjs` still exists
 *     while having quietly stopped being evidence.
 *  2. **Nothing is VERIFIED.** Verification means somebody qualified checked
 *     the control against the obligation. Nobody has, and the day one appears
 *     it must be a deliberate act rather than an edit that slipped through.
 *  3. **Every regime has its document, and every document a regime.**
 *  4. **No document claims compliance.** The phrases below are what that claim
 *     looks like in prose, and finding one fails the build.
 *  5. **The readiness document's numbers are the register's numbers.** Added
 *     after `docs/COMPLIANCE_READINESS.md` was found seven rows stale — every
 *     one of them understating what had been built, including seven controls
 *     it called NOT_STARTED that were finished. A hand-typed count beside a
 *     derivable one is the fault this repository has found more often than
 *     any other, and the four checks above did not cover the document that
 *     summarises them. The block between the markers is generated:
 *
 *       node tools/compliance.mjs            check everything, including it
 *       node tools/compliance.mjs --update   rewrite the block from the register
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  REGIMES, STATUS, claimingVerified, unevidenced, citingUnrunTests,
  citingUncalledCode, summary,
} from '../js/domain/compliance.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs', 'COMPLIANCE');
const READINESS = join(ROOT, 'docs', 'COMPLIANCE_READINESS.md');
const BEGIN = '<!--counts:begin-->';
const END = '<!--counts:end-->';

/**
 * The order statuses are reported in: most settled first.
 *
 * Fixed rather than sorted by count, so that a document regenerated after one
 * control moves is a one-line diff about that control rather than a reshuffle
 * nobody can read.
 */
const ORDER = [
  STATUS.VERIFIED, STATUS.TESTED, STATUS.IMPLEMENTED, STATUS.DESIGNED,
  STATUS.NOT_STARTED, STATUS.NOT_APPLICABLE, STATUS.LEGAL_REVIEW_REQUIRED,
];

const inOrder = (counts) => ORDER.filter((s) => counts[s]).map((s) => `${s} ${counts[s]}`);

/** Status counts for one regime's controls. */
function tally(controls) {
  const counts = {};
  for (const row of controls) counts[row.status] = (counts[row.status] ?? 0) + 1;
  return counts;
}

/**
 * The generated block: the headline counts, then a row per regime.
 *
 * A zero is printed for VERIFIED and NOT_STARTED even when it is zero, because
 * those two zeroes are the claims worth making. Every other status is omitted
 * when empty rather than padding the line with noughts.
 *
 * Typed to what it reads rather than to a whole regime: a name and its
 * controls' statuses. That is the honest contract, and it lets a test hand it
 * two rows without inventing a requirement, an evidence object and a gap for
 * each of them.
 *
 * @param {ReadonlyArray<{name: string, controls: ReadonlyArray<{status: string}>}>} [regimes]
 */
export function readinessBlock(regimes = REGIMES) {
  const whole = tally(regimes.flatMap((r) => r.controls));
  const total = regimes.reduce((n, r) => n + r.controls.length, 0);

  const lines = [
    BEGIN,
    '',
    '```',
    `${regimes.length} regimes · ${total} controls`,
    inOrder(whole).join(' · '),
    `${whole[STATUS.NOT_STARTED] ?? 0} NOT_STARTED · ${whole[STATUS.VERIFIED] ?? 0} VERIFIED`,
    '```',
    '',
    '## Per regime',
    '',
    '| Regime | Controls | Status breakdown |',
    '| --- | --- | --- |',
    ...regimes.map((r) =>
      `| ${r.name} | ${r.controls.length} | ${inOrder(tally(r.controls)).join(' · ')} |`),
    '',
    END,
  ];
  return lines.join('\n');
}

/**
 * What is wrong with the readiness document, given the block it should carry.
 *
 * Pure, and exported, because the version of this that lived inline inside
 * `check()` could not be shown to fail: `check()` reads the real file, the
 * real file was in sync, and a mutation that disabled the comparison entirely
 * broke no test. A check that cannot be demonstrated to fail is the thing this
 * whole file exists to prevent, so it was pulled out here where a drifted
 * document can be handed to it.
 *
 * @param {string|null} text the document, or null when it is missing
 * @param {string} block what the generated section should contain
 */
export function readinessProblems(text, block) {
  if (text === null) return ['docs/COMPLIANCE_READINESS.md is missing'];
  const wanted = withBlock(text, block);
  if (wanted === null) {
    return [`docs/COMPLIANCE_READINESS.md has no ${BEGIN} … ${END} block, `
      + 'so its counts are hand-typed and cannot be checked'];
  }
  return wanted === text ? []
    : ['docs/COMPLIANCE_READINESS.md disagrees with the register — '
      + 'run `node tools/compliance.mjs --update`'];
}

/** The document with its generated block replaced. */
export function withBlock(text, block) {
  const from = text.indexOf(BEGIN);
  const to = text.indexOf(END);
  if (from === -1 || to === -1 || to < from) return null;
  return text.slice(0, from) + block + text.slice(to + END.length);
}

/**
 * What a compliance claim reads like.
 *
 * Deliberately phrases and not single words: "compliant" appears legitimately
 * in "what a compliant implementation would need", and a checker that banned
 * the word would push the documents into worse English rather than truer
 * statements.
 */
const CLAIMS = [
  /\bis (?:fully )?compliant\b/i,
  /\bwe are compliant\b/i,
  /\bthis application complies\b/i,
  /\bfully complies\b/i,
  /\bcertified\b/i,
  /\bmeets all (?:the )?requirements\b/i,
  /\bguarantees compliance\b/i,
  /\bcompliance (?:is )?achieved\b/i,
];

export function check() {
  const problems = [];

  for (const regime of REGIMES) {
    for (const row of regime.controls) {
      for (const [kind, path] of Object.entries(row.evidence ?? {})) {
        if (!existsSync(join(ROOT, path))) {
          problems.push(`${regime.id}/${row.id} cites a ${kind} that does not exist: ${path}`);
        }
      }
    }
  }

  problems.push(...unevidenced().map((one) => `${one}`));

  // Existing is not running. `tests/run.mjs` executes what matches
  // `*.test.mjs`, so a suite renamed out of that pattern stays on disk, keeps
  // resolving, and quietly stops being evidence of anything.
  const runnable = new Set(
    (existsSync(join(ROOT, 'tests')) ? readdirSync(join(ROOT, 'tests')) : [])
      .filter((name) => name.endsWith('.test.mjs'))
      .map((name) => `tests/${name}`),
  );
  problems.push(...citingUnrunTests(REGIMES, (path) => runnable.has(path)));

  /*
   * And the same question one step earlier: does the cited code run?
   *
   * A suite that runs against a module nothing imports proves the module
   * correct and says nothing about the application. `retention-limits` sat at
   * TESTED that way — correct code, passing tests, no caller — while a record
   * a household deleted stayed on the device.
   *
   * Imports are read off the source rather than resolved, which is enough
   * here: every module in `js/` is imported by its filename.
   */
  const jsFiles = [];
  const walkJs = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walkJs(full);
      else if (entry.name.endsWith('.js')) jsFiles.push(full);
    }
  };
  walkJs(join(ROOT, 'js'));
  const sources = new Map(jsFiles.map((f) => [f, readFileSync(f, 'utf8')]));
  const importsOf = (file) => {
    const stem = file.split('/').pop().replace(/\.js$/, '');
    const pattern = new RegExp(`from ['"\`][^'"\`]*\\b${stem}\\.js|import\\(['"\`][^'"\`]*\\b${stem}\\.js`);
    for (const [path, text] of sources) {
      if (path.endsWith(`/${file}`) || path === join(ROOT, file)) continue;
      if (pattern.test(text)) return true;
    }
    return false;
  };
  problems.push(...citingUncalledCode(REGIMES, importsOf));
  problems.push(...claimingVerified().map((one) => `${one} claims VERIFIED — nobody has verified anything`));

  const present = existsSync(DOCS)
    ? readdirSync(DOCS).filter((name) => name.endsWith('.md'))
    : [];
  const wanted = new Set(['MASTER_COMPLIANCE_MATRIX.md', ...REGIMES.map((r) => r.doc)]);

  for (const name of wanted) {
    if (!present.includes(name)) problems.push(`docs/COMPLIANCE/${name} is missing`);
  }
  for (const name of present) {
    if (!wanted.has(name)) problems.push(`docs/COMPLIANCE/${name} belongs to no regime`);
  }

  for (const name of present) {
    const text = readFileSync(join(DOCS, name), 'utf8');
    for (const claim of CLAIMS) {
      const found = text.match(claim);
      if (found) problems.push(`docs/COMPLIANCE/${name} claims compliance: "${found[0]}"`);
    }
  }

  // The readiness document's numbers, against the register they describe.
  problems.push(...readinessProblems(
    existsSync(READINESS) ? readFileSync(READINESS, 'utf8') : null,
    readinessBlock(),
  ));

  return { problems, summary: summary() };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('compliance.mjs');
if (invokedDirectly && process.argv.includes('--update')) {
  const current = readFileSync(READINESS, 'utf8');
  const next = withBlock(current, readinessBlock());
  if (next === null) {
    console.error(`docs/COMPLIANCE_READINESS.md has no ${BEGIN} … ${END} block to write into`);
    process.exit(1);
  }
  writeFileSync(READINESS, next);
  console.log('wrote the counts block in docs/COMPLIANCE_READINESS.md');
} else if (invokedDirectly) {
  const { problems, summary: counts } = check();
  if (problems.length) {
    for (const one of problems) console.error(`  ${one}`);
    console.error(`\n${problems.length} problem(s) in the applicability matrix`);
    process.exit(1);
  }
  const line = Object.entries(counts.byStatus)
    .sort(([, a], [, b]) => b - a)
    .map(([status, n]) => `${n} ${status}`)
    .join(', ');
  console.log(`${counts.regimes} regimes, ${counts.controls} controls — ${line}`);
  console.log(`${counts.gaps.length} not started, and nothing claims ${STATUS.VERIFIED}`);
}
