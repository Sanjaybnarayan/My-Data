/**
 * The ratchet for a class name that already belonged to somebody else.
 *
 * Twice in three changes a name invented for a new component was already the
 * name of an existing one, and the new stylesheet rules silently restyled
 * something nobody had touched — `.nav-group` reaching the shell's sidebar,
 * `.filter-bar` reaching the Transactions ledger's own panel. Neither was
 * caught by a stylesheet or by a check looking for it. `tools/class-names.mjs`
 * says the rest.
 *
 * These tests drive the tool's own logic rather than mutating the tree, and
 * one of them stands on the two collisions themselves — because a budget
 * nobody can fail is the failure mode this repository keeps finding.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { writers, shared, budget } from '../tools/class-names.mjs';

setSuite('classnames');

const found = writers();
const now = shared(found);

describe('what is measured', () => {
  test('every class written in a class: attribute is seen', () => {
    // Three shapes the codebase actually uses: a bare name, several in one
    // string, and the array form with a conditional in it.
    assert.equal(found.has('card'), true);
    assert.equal(found.has('chip-row--scroll'), true);
    assert.equal(found.has('ledger-row--band'), true, 'the array form is read');
  });

  test('and only files that ship to a browser are read', () => {
    for (const files of found.values()) {
      for (const file of files) assert.equal(file.startsWith('js/'), true, file);
    }
  });

  test('a name only one file writes is not counted as shared', () => {
    const single = [...found].find(([, files]) => files.size === 1)?.[0];
    assert.equal(typeof single, 'string');
    assert.equal(now.some((one) => one.name === single), false, single);
  });

  test('the recorded budget matches the tree', () => {
    // As a set, not in frequency order. `shared()` sorts by how many files
    // write each name, which reshuffles when an already-shared name gains
    // another user — ordinary reuse, and not something this budget measures.
    // Comparing the ordered lists failed on Calendar picking up
    // `.chip-row--scroll`, which is exactly the change the ratchet is supposed
    // to wave through.
    assert.equal(budget().count, now.length);
    assert.deep(budget().names, now.map((one) => one.name).sort());
  });
});

describe('the two collisions it was built for', () => {
  /*
   * Both of these are now fixed, and these tests are what keeps them fixed.
   * Either one reappearing is a name written by two files again, which is
   * exactly what the count catches — but naming them here says which two
   * mistakes this instrument exists because of.
   */
  test('the sidebar keeps .nav-group to itself', () => {
    const files = found.get('nav-group');
    assert.deep([...(files ?? [])], ['js/ui/shell.js']);
  });

  test('and Finance’s tabs are named for Finance', () => {
    assert.deep([...(found.get('finance-nav-group') ?? [])],
      ['js/modules/finance/sections.js']);
    assert.deep([...(found.get('finance-nav-section') ?? [])],
      ['js/modules/finance/sections.js']);
  });

  test('the schema-generated filters do not answer to .filter-bar', () => {
    // `.filter-bar` belongs to the ledger's panel and to Notifications. The
    // record filters are `.record-filters`, and the whole point is that the
    // two sets do not overlap.
    const bar = [...(found.get('filter-bar') ?? [])];
    assert.equal(bar.includes('js/ui/components/table.js'), false, bar.join(' '));
    assert.deep([...(found.get('record-filters') ?? [])],
      ['js/ui/components/table.js']);
  });
});

describe('the ratchet can fail', () => {
  test('a name gaining a second writer raises the count', () => {
    // The collision, simulated on the measurement rather than on the tree.
    const single = [...found].find(([, files]) => files.size === 1)?.[0];
    const mutated = new Map(found);
    mutated.set(single, new Set([...found.get(single), 'js/modules/somewhere.js']));

    assert.equal(shared(mutated).length, now.length + 1);
    assert.equal(shared(mutated).some((one) => one.name === single), true);
  });

  test('a name gaining a third writer does not', () => {
    // The narrowness is the point: adding a fourth `.card` is not a collision
    // and must not spend the budget, or the ratchet becomes a tax on reuse.
    const many = now.find((one) => one.files.length > 2).name;
    const mutated = new Map(found);
    mutated.set(many, new Set([...found.get(many), 'js/modules/somewhere.js']));

    assert.equal(shared(mutated).length, now.length);
  });

  test('and a name losing its second writer lowers it', () => {
    const two = now.find((one) => one.files.length === 2);
    const mutated = new Map(found);
    mutated.set(two.name, new Set([two.files[0]]));

    assert.equal(shared(mutated).length, now.length - 1);
  });
});
