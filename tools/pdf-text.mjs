#!/usr/bin/env node
/**
 * The PDF reader, on the command line.
 *
 *   node tools/pdf-text.mjs statement.pdf            plain text, one line per row
 *   node tools/pdf-text.mjs statement.pdf --json     positioned items, for parsing
 *
 * The reading itself is `js/data/pdf-read.js` — the same module the app runs
 * in the browser. Only the decompressor differs: Node has zlib, a browser has
 * `DecompressionStream`, and that one function is injected rather than
 * branched on, so there is no second implementation to keep in step.
 */

import { readFileSync } from 'node:fs';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { extract, toLines } from '../js/data/pdf-read.js';

/** zlib's inflate, in the shape the reader asks for. */
export async function inflate(raw) {
  for (const method of [inflateSync, inflateRawSync]) {
    for (const offset of [0, 1]) {
      try {
        return new Uint8Array(method(raw.subarray(offset)));
      } catch { /* try the next wrapping */ }
    }
  }
  return null;
}

/** Read a PDF from disk with Node's decompressor. */
export function read(file) {
  return extract(new Uint8Array(readFileSync(file)), { decompress: inflate });
}

if (process.argv[1]?.endsWith('pdf-text.mjs')) {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node tools/pdf-text.mjs <file.pdf> [--json]');
    process.exit(1);
  }

  const result = await read(file);
  if (result.encrypted) {
    console.error(result.reason);
    process.exit(2);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result.pages.map((page) => page.items), null, 1));
  } else {
    for (const page of result.pages) console.log(toLines(page.items).join('\n'));
  }
}
