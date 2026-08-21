#!/usr/bin/env node
/**
 * Assemble the web root — the files a host actually serves.
 *
 *   node tools/webroot.mjs [out]      default: dist/web
 *
 * ## Why this exists
 *
 * `npm run build` does not produce this. It runs `tools/bundle.mjs`, which
 * folds the app into one HTML file for previewing and *deliberately leaves the
 * service worker out*. Shipping that as the product would ship a preview.
 *
 * The deployed application is the repository root served as files —
 * `netlify.toml` says `publish = "."` — minus the tests, the tooling, the
 * documents and the backend source, none of which a browser has any use for.
 * Capacitor needs that same set in a directory of its own, because a native
 * app bundles a folder, not a repository.
 *
 * ## Why the list is checked rather than trusted
 *
 * This project has now found the same fault four times: a hand-maintained list
 * kept beside a derivable one, drifting in silence. `sw.js` already names every
 * file the application needs offline, and it is the list that *has* to be
 * right — a worker that precaches a file nobody published fails to install,
 * and the app stops working offline without saying so.
 *
 * So this copies directories, and then checks the result against the worker's
 * precache list. If they disagree the build stops. That makes the worker the
 * single source of truth and this tool a consumer of it, rather than a fifth
 * copy of the same knowledge.
 */

import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What ships. Files and directories, relative to the repository root.
 *
 * `.nojekyll` is a GitHub Pages marker and does nothing inside a native app;
 * it is copied anyway so that one tool produces one output and the deploy
 * workflow and Capacitor cannot drift apart by using different lists.
 */
export const SHIPPED = [
  'index.html',
  'oauth-callback.html',
  'manifest.webmanifest',
  'sw.js',
  '.nojekyll',
  'js',
  'css',
  'assets',
];

/** Every path `sw.js` precaches, as it writes them: `'./js/app.js'`. */
export function precachedPaths(source = readFileSync(join(ROOT, 'sw.js'), 'utf8')) {
  const shell = /const SHELL = \[([\s\S]*?)\n\];/.exec(source);
  if (!shell) throw new Error('sw.js has no SHELL array — this tool cannot check anything');
  return [...shell[1].matchAll(/'\.\/([^']*)'/g)].map((m) => m[1]);
}

function filesUnder(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesUnder(path, base, out);
    else out.push(relative(base, path).replace(/\\/g, '/'));
  }
  return out;
}

/**
 * What the worker asks for that the output does not have.
 *
 * `'./'` is the directory itself and is served by `index.html`, so it is
 * checked as that rather than as a file named nothing.
 */
export function missingFrom(outDir, precached = precachedPaths()) {
  return precached
    .map((path) => (path === '' ? 'index.html' : path))
    .filter((path) => !existsSync(join(outDir, path)));
}

export function assemble(outDir) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const copied = [];
  for (const name of SHIPPED) {
    const from = join(ROOT, name);
    if (!existsSync(from)) throw new Error(`${name} is in the ship list and does not exist`);
    cpSync(from, join(outDir, name), { recursive: true });
    copied.push(name);
  }
  return copied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(ROOT, process.argv[2] ?? 'dist/web');

  assemble(out);
  const missing = missingFrom(out);

  if (missing.length) {
    console.error('The service worker precaches files this web root does not contain:\n');
    for (const path of missing) console.error(`  ${path}`);
    console.error('\nNothing was published. Either sw.js names a file that no longer exists,');
    console.error('or SHIPPED in this tool is missing a directory that does.');
    process.exit(1);
  }

  const files = filesUnder(out);
  const bytes = files.reduce((sum, f) => sum + statSync(join(out, f)).size, 0);
  console.log(relative(process.cwd(), out));
  console.log(`  ${files.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`
    + ` — ${precachedPaths().length} of them precached by the worker`);
}
