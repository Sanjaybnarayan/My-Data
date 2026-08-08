#!/usr/bin/env node
/**
 * The suite.
 *
 *   node tests/run.mjs            everything
 *   node tests/run.mjs money sync only files whose name matches
 *
 * Exits non-zero on the first failing check, so it can gate a commit.
 */

import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { run } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const filters = process.argv.slice(2);

const files = (await readdir(here))
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !filters.length || filters.some((needle) => f.includes(needle)))
  .sort()
  .map((f) => pathToFileURL(join(here, f)).href);

if (!files.length) {
  console.error(filters.length ? `no test files match ${filters.join(', ')}` : 'no test files found');
  process.exit(1);
}

const failures = await run(files);
process.exit(failures ? 1 : 0);
