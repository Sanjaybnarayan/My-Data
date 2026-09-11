#!/usr/bin/env node
/**
 * Nothing committed here is a credential.
 *
 *   node tools/secrets.mjs          scan every tracked file
 *   node tools/secrets.mjs --list   print the patterns and what each is
 *
 * ## Why this exists
 *
 * The audit records, as a PASS against section 48: *"Repository-wide scan: no
 * API keys, no secrets, no service-account files."* That was measured once, by
 * hand, and nothing has held it since — which is the shape this repository has
 * found more often than any other, and the reason `tools/mutation.mjs` exists.
 *
 * The brief is unambiguous about the property: *do not invent credentials, do
 * not expose secrets, SMS provider credentials must remain server-side.* A
 * claim that valuable, checked once, is a claim waiting to stop being true —
 * and the way it stops is somebody pasting a key into a config file at
 * midnight, not a considered decision anybody would review.
 *
 * ## What it looks for
 *
 * Credential **formats**, not words. `token`, `secret` and `apiKey` appear
 * hundreds of times in this repository's prose, its schema and its tests, and
 * a scanner that flagged them would be turned off within a week. Every pattern
 * below matches a shape that is only ever produced by a real credential
 * issuer, so a hit is a finding rather than a conversation.
 *
 * That is deliberately the narrow half of the trade. A secret with no
 * recognisable format — a bare password in a constant, a base64 blob — goes
 * through this untouched, and it is stated here rather than left for somebody
 * to discover by trusting a green tick.
 *
 * ## Scope
 *
 * Tracked files only, from `git ls-files`. An untracked scratch file is not
 * committed and is not this tool's business; `familyos.config.json` is
 * deliberately untracked for exactly that reason.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each pattern, and a sample that must match it.
 *
 * The sample is the point. A regex that stops matching — an escape mangled by
 * a refactor, a quantifier fat-fingered — leaves a scanner that reports a
 * clean repository for ever, and the run is green either way. So the patterns
 * are tested against their own samples before any file is read, and a pattern
 * that cannot match its own sample stops the run.
 *
 * Samples are assembled from pieces so that this file does not itself contain
 * a string any scanner would have to flag.
 */
export const PATTERNS = [
  {
    what: 'a Google API key',
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    sample: `AIza${'k'.repeat(35)}`,
  },
  {
    what: 'a Google OAuth client secret',
    pattern: /GOCSPX-[0-9A-Za-z_-]{20,}/,
    sample: `GOCSPX-${'s'.repeat(24)}`,
  },
  {
    what: 'a private key of any kind',
    pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/,
    sample: '-----BEGIN RSA PRIVATE KEY-----',
  },
  {
    what: 'a Google service-account file',
    pattern: /"type"\s*:\s*"service_account"/,
    sample: '"type": "service_account"',
  },
  {
    what: 'an AWS access key id',
    pattern: /AKIA[0-9A-Z]{16}/,
    sample: `AKIA${'Q'.repeat(16)}`,
  },
  {
    what: 'a Slack token',
    pattern: /xox[baprs]-[0-9A-Za-z-]{10,}/,
    sample: `xoxb-${'1'.repeat(14)}`,
  },
  {
    what: 'a GitHub personal access token',
    pattern: /gh[pousr]_[0-9A-Za-z]{36}/,
    sample: `ghp_${'A'.repeat(36)}`,
  },
];

/** Every pattern must match its own sample, or this tool proves nothing. */
export function selfTest(patterns = PATTERNS) {
  return patterns
    .filter((p) => !p.pattern.test(p.sample))
    .map((p) => `the pattern for ${p.what} no longer matches its own sample`);
}

export function trackedFiles(root = ROOT) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean);
}

/**
 * @param {string[]} files paths relative to the repository root
 * @param {(path: string) => string} read
 */
export function scan(files = trackedFiles(), read = (p) => readFileSync(join(ROOT, p), 'utf8'),
  patterns = PATTERNS) {
  const found = [];
  for (const file of files) {
    let text;
    try { text = read(file); } catch { continue; }
    if (text.includes('\0')) continue;
    text.split('\n').forEach((line, i) => {
      for (const p of patterns) {
        if (p.pattern.test(line)) found.push(`${file}:${i + 1} looks like ${p.what}`);
      }
    });
  }
  return found;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('secrets.mjs');
if (invokedDirectly) {
  if (process.argv.includes('--list')) {
    for (const p of PATTERNS) console.log(`  ${p.what.padEnd(36)} ${p.pattern}`);
    process.exit(0);
  }

  const broken = selfTest();
  if (broken.length) {
    for (const one of broken) console.error(`  ${one}`);
    console.error('\nRefusing to scan: a pattern that cannot match its own sample would');
    console.error('report a clean repository whatever was in it.');
    process.exit(2);
  }

  const files = trackedFiles();
  const found = scan(files);
  if (found.length) {
    console.error('Something that looks like a credential is committed:\n');
    for (const one of found) console.error(`  ${one}`);
    console.error('\nRotate it first — it is in the history, not only the working tree.');
    process.exit(1);
  }
  console.log(`${files.length} tracked files, ${PATTERNS.length} credential formats, nothing found.`);
}
