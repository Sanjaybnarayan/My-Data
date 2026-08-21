#!/usr/bin/env node
/**
 * The documents describe the program. Nothing checked that the description was
 * still true, and it had stopped being true: the docs said 34 entities and 426
 * fields when the schema declared 39 and 478, and said 28 fields were
 * encrypted when 34 were.
 *
 * Numbers that describe the program *as it is now* are marked in the prose:
 *
 *     - **39 entities**<!--live:entities-->, **478 fields**<!--live:fields-->
 *
 * This reads the schema, finds every marker, and fails when a marked number
 * disagrees with what it measured.
 *
 * What it does not do, said plainly so nobody trusts it further than it goes:
 * it cannot find a *new* stale claim that nobody marked. It guards the sites
 * that are marked, and marking is a decision made when the sentence is
 * written. Counts recorded as history — "measured across all 35 entities" in a
 * dated report — are meant to stay as written and are correctly left alone.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entityNames, entity, modules, systemStores } from '../js/data/schema.js';
import coverage from './field-coverage.json' with { type: 'json' };

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

/** Everything the prose is allowed to state as a live number. */
export function measure() {
  const names = entityNames();
  let fields = 0;
  let encrypted = 0;
  for (const name of names) {
    for (const f of entity(name).fields) {
      fields += 1;
      if (f.encrypted) encrypted += 1;
    }
  }
  return {
    entities: names.length,
    fields,
    encryptedFields: encrypted,
    encryptedPercent: Number(((encrypted / fields) * 100).toFixed(1)),
    modules: modules.length,
    stores: names.length + Object.keys(systemStores).length,
    unreadFields: coverage.fields.length,
  };
}

const UNITS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** "thirty-nine" → 39, "sixteen" → 16, "478" → 478, "7.1" → 7.1. */
export function readNumber(token) {
  const word = token.toLowerCase();
  if (/^[0-9][0-9,]*(\.[0-9]+)?$/.test(word)) return Number(word.replace(/,/g, ''));
  const [tens, unit] = word.split('-');
  if (tens in TENS) return TENS[tens] + (unit ? UNITS.indexOf(unit) : 0);
  const index = UNITS.indexOf(word);
  return index === -1 ? null : index;
}

/**
 * The number a marker is attached to.
 *
 * It must be *adjacent* — only markup (`**`, a backtick, `%`, a bracket) and
 * at most a space may sit between them. A looser rule was tried first, taking
 * the last number-like token within sixty characters, and it had the defect
 * this whole file exists to prevent: deleting the number outright left the
 * marker matching a figure from the previous table cell, and the check passed.
 */
export function numberBefore(text, at) {
  const token = '(?:[0-9][0-9,]*(?:\\.[0-9]+)?|[A-Za-z]+(?:-[A-Za-z]+)?)';
  const trailing = '(?:[*%_`)\\]]*[^\\S\\n]?)';
  const found = text.slice(0, at).match(new RegExp(`(${token})${trailing}$`));
  return found ? readNumber(found[1]) : null;
}

/** Every `<!--live:key-->` in a document, with the number it claims. */
export function claimsIn(text) {
  return [...text.matchAll(/<!--\s*live:([a-zA-Z]+)\s*-->/g)].map((m) => ({
    key: m[1],
    stated: numberBefore(text, m.index),
    line: text.slice(0, m.index).split('\n').length,
  }));
}

async function markdownFiles(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) found.push(...await markdownFiles(path));
    else if (item.name.endsWith('.md')) found.push(path);
  }
  return found.sort();
}

export async function check() {
  const truth = measure();
  const problems = [];
  const seen = new Set();
  let sites = 0;

  for (const path of await markdownFiles(DOCS)) {
    const text = await readFile(path, 'utf8');
    for (const claim of claimsIn(text)) {
      const where = `${relative(ROOT, path)}:${claim.line}`;
      if (!(claim.key in truth)) {
        problems.push(`${where} — no such measurement: live:${claim.key}`);
        continue;
      }
      seen.add(claim.key);
      sites += 1;
      if (claim.stated === null) {
        problems.push(`${where} — live:${claim.key} has no number in front of it`);
      } else if (claim.stated !== truth[claim.key]) {
        problems.push(`${where} — says ${claim.stated} ${claim.key}, schema has ${truth[claim.key]}`);
      }
    }
  }

  // A measurement nothing claims is a check that cannot fail.
  for (const key of Object.keys(truth)) {
    if (!seen.has(key)) problems.push(`nothing states live:${key} — the check for it can never fail`);
  }

  return { truth, sites, problems };
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('self-description.mjs');
if (invokedDirectly) {
  const { truth, sites, problems } = await check();
  if (problems.length) {
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\n${problems.length} description(s) no longer match the schema`);
    process.exit(1);
  }
  const shape = Object.entries(truth).map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`${sites} live numbers in the docs all match the schema — ${shape}`);
}
