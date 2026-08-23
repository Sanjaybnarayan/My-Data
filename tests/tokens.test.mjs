/**
 * The design system is a set of tokens, and this is what says so.
 *
 * `docs/DESIGN_SYSTEM.md` claims a vocabulary: colour roles, radii, spacing,
 * elevation, type. A claim in a document with nothing checking it is the fault
 * this repository keeps finding in itself, so the vocabulary is asserted here
 * against the file rather than described.
 *
 * Two invariants matter more than the list itself.
 *
 * **Every token is defined in `:root`.** A token that only exists inside a
 * dark-mode block is undefined for everybody in light mode.
 *
 * **Every token the dark blocks redefine, they both redefine.** There are two
 * of them — an attribute selector and a `prefers-color-scheme` media query —
 * because a media query cannot be re-entered from an attribute. A token
 * changed in one and not the other is a bug that appears for half the users
 * and is invisible to whoever made it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

setSuite('tokens');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CSS = readFileSync(join(ROOT, 'css', 'tokens.css'), 'utf8');

/** The declarations inside one block, by brace matching rather than by regex. */
function blockAt(index) {
  const open = CSS.indexOf('{', index);
  let depth = 0;
  for (let i = open; i < CSS.length; i++) {
    if (CSS[i] === '{') depth += 1;
    else if (CSS[i] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(open + 1, i);
    }
  }
  throw new Error('unbalanced braces in tokens.css');
}

function declared(text) {
  return new Set([...text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)].map((m) => m[1]));
}

const root = declared(blockAt(CSS.indexOf(':root {')));
const byAttribute = declared(blockAt(CSS.indexOf("[data-theme='dark'] {")));
const byPreference = declared(blockAt(CSS.indexOf('@media (prefers-color-scheme: dark)')));

/**
 * The vocabulary the design system promises.
 *
 * Where the brief that asked for these used a different name for something
 * this repository already had, the existing name is kept and the mapping is in
 * `docs/DESIGN_SYSTEM.md` — one name per value, because two names for one
 * value is how a token system drifts.
 */
const PROMISED = Object.freeze({
  colour: [
    '--accent', '--secondary', '--info', '--positive', '--warning', '--danger',
    '--surface', '--surface-raised', '--surface-elevated', '--surface-sunken',
    '--text', '--text-muted', '--text-faint', '--text-inverse',
    '--border', '--border-strong', '--overlay',
  ],
  'text on a subtle ground': [
    '--accent-text', '--secondary-text', '--info-text',
    '--positive-text', '--warning-text', '--danger-text',
  ],
  'the subtle grounds themselves': [
    '--accent-subtle', '--secondary-subtle', '--info-subtle',
    '--positive-subtle', '--warning-subtle', '--danger-subtle',
  ],
  radius: ['--radius-sm', '--radius', '--radius-lg', '--radius-xl', '--radius-pill', '--radius-card'],
  spacing: ['--space-1', '--space-2', '--space-3', '--space-4', '--space-5',
    '--space-6', '--space-7', '--space-8', '--space-10', '--space-12'],
  elevation: ['--shadow-1', '--shadow-2', '--shadow-3'],
  type: ['--font', '--font-mono', '--font-display', '--font-headline',
    '--font-title', '--font-body', '--font-label', '--font-caption'],
  motion: ['--ease', '--ease-out', '--duration-fast', '--duration', '--duration-slow'],
  layout: ['--nav-width', '--nav-width-compact', '--header-height',
    '--bottom-nav-height', '--content-max'],
});

describe('the vocabulary exists', () => {
  for (const [group, names] of Object.entries(PROMISED)) {
    test(`every ${group} token is defined in :root`, () => {
      const missing = names.filter((name) => !root.has(name));
      assert.deep(missing, []);
    });
  }

  test('and the promise is not empty', () => {
    // A loop over an empty table asserts nothing. This is what stops the
    // table above being quietly emptied.
    const total = Object.values(PROMISED).reduce((sum, list) => sum + list.length, 0);
    assert.equal(total > 50, true, `only ${total} tokens promised`);
  });
});

describe('the two dark blocks agree', () => {
  test('they redefine exactly the same tokens', () => {
    const onlyAttribute = [...byAttribute].filter((name) => !byPreference.has(name));
    const onlyPreference = [...byPreference].filter((name) => !byAttribute.has(name));
    assert.deep({ onlyAttribute, onlyPreference }, { onlyAttribute: [], onlyPreference: [] });
  });

  test('and neither invents a token that :root has never heard of', () => {
    const orphans = [...byAttribute].filter((name) => !root.has(name));
    assert.deep(orphans, []);
  });

  test('the dark blocks are not empty', () => {
    assert.equal(byAttribute.size > 20, true, `${byAttribute.size} tokens`);
  });
});

describe('the check can fail', () => {
  test('a token missing from :root is reported', () => {
    const pretend = new Set(root);
    pretend.delete('--radius-xl');
    assert.equal(['--radius-xl'].filter((n) => !pretend.has(n)).length, 1);
  });

  test('a token in one dark block only is reported', () => {
    const pretend = new Set(byPreference);
    pretend.delete('--accent');
    assert.equal([...byAttribute].filter((n) => !pretend.has(n)).length, 1);
  });
});
