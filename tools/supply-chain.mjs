#!/usr/bin/env node
/**
 * What the Android build actually compiles in, and what is checked about it.
 *
 *   node tools/supply-chain.mjs            print both chains
 *   node tools/supply-chain.mjs --check    fail if a version is not pinned
 *
 * ## Why
 *
 * "No dependencies" is true of the PWA and false of the APK, and the audit's
 * acceptance criteria have carried *"Dependencies audited — PWA yes, Android
 * build no"* as a ✗ since it was written. Phase 12 of the security brief names
 * scanning as one of its three gaps.
 *
 * The APK compiles **two separate supply chains**, and a check that covered one
 * while the document said "audited" would be the overclaiming this repository
 * spends its time avoiding:
 *
 *   - **npm** — the `@capacitor/*` packages, resolved through `package-lock.json`
 *   - **Maven** — `androidx.*` and `com.google.mlkit`, resolved by Gradle
 *
 * `npm audit` sees the first and nothing of the second.
 *
 * ## What this checks, offline
 *
 * That every version is **pinned**, in both chains, because a build that can
 * resolve a different artifact than it did last time has no supply chain worth
 * auditing:
 *
 *   - `android/variables.gradle` must declare exact versions — no `+`, no
 *     range, no `latest`. Gradle resolves a dynamic version at build time, so
 *     one would mean the APK's contents are decided by whatever Maven Central
 *     held that morning.
 *   - `package-lock.json` must be committed and must pin every runtime package
 *     to an exact version with an integrity hash. The caret in `package.json`
 *     is a *declaration*; the lock is what `npm ci` installs.
 *
 * ## A correction this tool exists partly to make
 *
 * `docs/THREAT_MODEL.md` T2.4 said the Android build had "no lockfile audit, no
 * pinning beyond the caret". The first half is true. The second is not: the
 * lock is committed, pins exact versions with sha512 integrity, and all three
 * CI jobs install with `npm ci`, which fails outright if the lock and the
 * manifest disagree. The pinning is real and stronger than the document said.
 *
 * ## What it cannot check, said plainly
 *
 * **Whether any of it is vulnerable.** That needs an advisory database. The npm
 * half is covered by `npm audit` as a CI step, which is real and was verified
 * running — 0 findings across 11 runtime packages.
 *
 * The **Maven half is not scanned at all**. Querying an advisory service for
 * `androidx.appcompat:appcompat:1.7.1` needs a host this build environment
 * cannot reach — `api.osv.dev` is refused by the egress proxy — so a CI step
 * doing it could not be verified here before being written, and a check nobody
 * has watched fail is the thing this repository has been finding all week.
 * The coordinates it lists are audited by nobody; that is stated rather than
 * papered over, and the criterion stays short of ✓ because of it.
 *
 * **And they are the app module's direct declarations, not the graph.** Gradle
 * resolves a transitive tree from each one, and only Gradle can enumerate it.
 * What is listed here is what this repository *chose*; what ships is that plus
 * whatever those five chose, which is more.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every Maven coordinate the app module compiles, with its pinned version. */
export function maven(
  gradle = readFileSync(join(ROOT, 'android', 'app', 'build.gradle'), 'utf8'),
  variables = readFileSync(join(ROOT, 'android', 'variables.gradle'), 'utf8'),
) {
  const versions = new Map(
    [...variables.matchAll(/(\w+Version)\s*=\s*'([^']+)'/g)].map((m) => [m[1], m[2]]),
  );
  const out = [];
  for (const m of gradle.matchAll(/^\s*(implementation|api)\s+"([^":]+):([^":]+):\$(\w+)"/gm)) {
    const [, , group, artifact, key] = m;
    out.push({ coordinate: `${group}:${artifact}`, key, version: versions.get(key) ?? null });
  }
  return out;
}

/** A version Gradle would resolve at build time rather than one it was given. */
const DYNAMIC = /[+]$|^latest|^\[|^\(|,/;

/** Runtime npm packages, as declared and as the lock actually pins them. */
export function npm(
  manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')),
  lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8')),
) {
  return Object.keys(manifest.dependencies ?? {}).map((name) => {
    const entry = lock.packages?.[`node_modules/${name}`];
    return {
      name,
      declared: manifest.dependencies[name],
      locked: entry?.version ?? null,
      integrity: Boolean(entry?.integrity),
    };
  });
}

export function problems(mavenDeps = maven(), npmDeps = npm()) {
  const found = [];

  for (const dep of mavenDeps) {
    if (dep.version === null) {
      found.push(`${dep.coordinate} uses $${dep.key}, which variables.gradle does not declare`);
    } else if (DYNAMIC.test(dep.version)) {
      found.push(`${dep.coordinate} is pinned to '${dep.version}', which Gradle resolves at build time`);
    }
  }

  if (!existsSync(join(ROOT, 'package-lock.json'))) {
    found.push('package-lock.json is missing — `npm ci` has nothing to install from');
  }
  for (const dep of npmDeps) {
    if (!dep.locked) found.push(`${dep.name} is a runtime dependency the lock does not pin`);
    else if (!dep.integrity) found.push(`${dep.name} is pinned to ${dep.locked} with no integrity hash`);
  }

  if (!mavenDeps.length) found.push('no Maven coordinates parsed — this check would pass on anything');
  if (!npmDeps.length) found.push('no runtime npm packages parsed — this check would pass on anything');

  return found;
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('supply-chain.mjs');
if (invokedDirectly) {
  const mavenDeps = maven();
  const npmDeps = npm();
  const found = problems(mavenDeps, npmDeps);

  if (!process.argv.includes('--check')) {
    console.log('npm, audited by `npm audit` in CI:');
    for (const d of npmDeps) console.log(`  ${d.name.padEnd(26)} ${d.declared.padEnd(9)} → ${d.locked}`);
    console.log('\nMaven, audited by nobody:');
    for (const d of mavenDeps) console.log(`  ${d.coordinate.padEnd(42)} ${d.version}`);
  }

  if (found.length) {
    for (const one of found) console.error(`  ${one}`);
    console.error(`\n${found.length} dependency/dependencies not pinned`);
    process.exit(1);
  }
  console.log(`\n${npmDeps.length} npm and ${mavenDeps.length} Maven dependencies, all pinned.`);
}
