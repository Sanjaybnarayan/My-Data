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
 *  1. **Every citation resolves.** A row saying IMPLEMENTED must name a file
 *     that exists; TESTED must name a suite that exists. A status pointing at
 *     a path that was renamed a year ago is a claim with nothing behind it.
 *  2. **Nothing is VERIFIED.** Verification means somebody qualified checked
 *     the control against the obligation. Nobody has, and the day one appears
 *     it must be a deliberate act rather than an edit that slipped through.
 *  3. **Every regime has its document, and every document a regime.**
 *  4. **No document claims compliance.** The phrases below are what that claim
 *     looks like in prose, and finding one fails the build.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIMES, STATUS, claimingVerified, unevidenced, summary } from '../js/domain/compliance.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs', 'COMPLIANCE');

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

  return { problems, summary: summary() };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('compliance.mjs');
if (invokedDirectly) {
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
