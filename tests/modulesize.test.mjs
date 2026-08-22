/**
 * The ratchet that stops a named problem growing while it is being named.
 *
 * The Phase 0 audit called `js/modules/settings.js` a god component at 1,597
 * lines. Nothing measured it afterwards and it reached 1,894 — the problem
 * grew by 297 lines while listed on a register describing it.
 *
 * These tests mutate the *budget* rather than the tree, because that is the
 * only way to drive the failure paths without making the repository worse to
 * prove a point.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { sizes, measure, against, budget, CROWDED } from '../tools/module-size.mjs';

setSuite('modulesize');

const now = measure();

describe('what is measured', () => {
  test('only what ships to a browser', () => {
    // Not a list of exclusions — a rule. `tests/browser.mjs` is thousands of
    // lines of checks, which is the opposite of a problem, and would sit at
    // the top of this list forever.
    for (const one of sizes()) {
      assert.equal(one.file.startsWith('js/'), true, one.file);
    }
  });

  test('every crowded file is over the line, and every other one is under it', () => {
    const crowded = new Set(Object.keys(now));
    for (const one of sizes()) {
      assert.equal(crowded.has(one.file), one.lines > CROWDED, one.file);
    }
  });

  test('the recorded budget matches the tree', () => {
    assert.deep(budget().files, now);
  });

  test('and the file the audit named is no longer among the biggest', () => {
    // The whole point of the change this guards.
    const settings = sizes().find((one) => one.file === 'js/modules/settings.js');
    assert.equal(settings.lines < CROWDED, true,
      `settings.js is ${settings.lines} lines`);
  });
});

describe('the ratchet can fail', () => {
  test('a file recorded smaller than it is counts as grown', () => {
    const [file, lines] = Object.entries(now)[0];
    const { grew, joined } = against({ ...now, [file]: lines - 1 });
    assert.length(grew, 1);
    assert.equal(grew[0].file, file);
    assert.length(joined, 0);
  });

  test('a crowded file missing from the budget counts as having joined', () => {
    const [file] = Object.entries(now)[0];
    const pared = { ...now };
    delete pared[file];
    const { joined, grew } = against(pared);
    assert.length(joined, 1);
    assert.equal(joined[0].file, file);
    assert.length(grew, 0);
  });

  test('a file recorded larger than it is is not a failure', () => {
    // Shrinking is the point. A check that complained about it would be a
    // check that punished the thing it exists to encourage.
    const [file, lines] = Object.entries(now)[0];
    const { grew, joined, shrank } = against({ ...now, [file]: lines + 50 });
    assert.length(grew, 0);
    assert.length(joined, 0);
    assert.length(shrank, 1);
    assert.equal(shrank[0].was, lines + 50);
  });

  test('a file that dropped out of the budget entirely is reported as shrunk', () => {
    const { grew, joined, shrank } = against({ ...now, 'js/gone.js': 1200 });
    assert.length(grew, 0);
    assert.length(joined, 0);
    assert.equal(shrank.some((one) => one.file === 'js/gone.js' && one.left), true);
  });

  test('and the tree as it stands passes', () => {
    const { grew, joined } = against(budget().files);
    assert.deep(grew, []);
    assert.deep(joined, []);
  });
});
