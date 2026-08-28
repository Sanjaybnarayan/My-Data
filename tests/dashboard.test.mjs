/**
 * The dashboard's widget list, and the arrangement somebody chose.
 *
 * Three lists have to agree: what can be shown, what is shown by default, and
 * what each one is called. They were nearly two — Customise saves
 * `ALL_WIDGETS.filter(chosen)`, so a widget the default dropped could be
 * ticked, saved, and silently dropped again. Silently losing what somebody
 * chose is the one thing this file is here to prevent.
 *
 * Read from the source rather than from a copy, because a test holding its own
 * copy of the lists drifts exactly the way the lists would.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chosenWidgets } from '../js/modules/dashboard.js';

setSuite('dashboard');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = readFileSync(join(ROOT, 'js', 'modules', 'dashboard.js'), 'utf8');
/*
 * The labels moved to their own module when `dashboard.js` reached its size
 * ceiling. Read from where they are rather than from where they were: the
 * pairing this file checks is between two lists, and a regex that stopped
 * matching would have made the check pass on a widget with no label.
 */
const WIDGET_SOURCE = readFileSync(
  join(ROOT, 'js', 'modules', 'dashboard-widgets.js'), 'utf8');

const list = (name) => [...new RegExp(`const ${name} = \\[([^\\]]*)\\]`, 's')
  .exec(SOURCE)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

const ALL = list('ALL_WIDGETS');
const DEFAULT = list('DEFAULT_WIDGETS');
const PREVIOUS = list('PREVIOUS_DEFAULT');
const IMPLEMENTED = [...SOURCE.matchAll(/^ {2}([a-z]+): \(data\)/gm)].map((m) => m[1]);
const LABELLED = [.../const WIDGET_LABELS = \{([^}]*)\}/s.exec(WIDGET_SOURCE)[1]
  .matchAll(/^\s*([a-z]+):/gm)].map((m) => m[1]);

describe('the three lists agree', () => {
  test('every widget shown by default can also be offered', () => {
    assert.deep(DEFAULT.filter((id) => !ALL.includes(id)), []);
  });

  test('every offerable widget is implemented', () => {
    assert.deep(ALL.filter((id) => !IMPLEMENTED.includes(id)), []);
  });

  test('every implemented widget can be offered', () => {
    // The direction that loses somebody's choice: implemented, tickable in an
    // old stored preference, and absent from the list Customise saves from.
    assert.deep(IMPLEMENTED.filter((id) => !ALL.includes(id)), []);
  });

  test('every offerable widget has a name a person would recognise', () => {
    assert.deep(ALL.filter((id) => !LABELLED.includes(id)), []);
  });

  test('and the lists are not empty', () => {
    assert.equal(ALL.length > 10, true, `${ALL.length} widgets`);
    assert.equal(DEFAULT.length > 5, true, `${DEFAULT.length} by default`);
  });
});

describe('what somebody chose is kept', () => {
  test('no preference gets the default', () => {
    assert.deep(chosenWidgets(null), DEFAULT);
    assert.deep(chosenWidgets([]), DEFAULT);
    assert.deep(chosenWidgets(undefined), DEFAULT);
  });

  test('the old default is recognised as untouched, not as a choice', () => {
    // Somebody who never opened Customise has the old default written down.
    // Treating it as a choice would freeze them on the old dashboard forever.
    assert.deep(chosenWidgets(PREVIOUS), DEFAULT);
  });

  test('a real arrangement is kept, in the order it was chosen', () => {
    const mine = ['summary', 'bills'];
    const got = chosenWidgets(mine);
    assert.deep(got.slice(0, 2), mine);
  });

  test('and new sections are appended rather than withheld', () => {
    // A household should not have to know a section exists to be shown it.
    const mine = ['summary', 'bills'];
    const got = chosenWidgets(mine);
    for (const id of DEFAULT) {
      assert.equal(got.includes(id), true, `${id} was not offered to an existing arrangement`);
    }
  });

  test('nothing chosen is ever dropped', () => {
    // Including the two the default no longer carries.
    const mine = ['networth', 'reminders', 'summary'];
    const got = chosenWidgets(mine);
    for (const id of mine) assert.equal(got.includes(id), true, `${id} was dropped`);
  });

  test('and nothing appears twice', () => {
    const got = chosenWidgets(['summary', 'bills', 'attention']);
    assert.deep([...new Set(got)], got);
  });
});

describe('the check can fail', () => {
  test('a stored list one entry short of the old default is a choice, not a default', () => {
    const nearly = PREVIOUS.slice(0, -1);
    const got = chosenWidgets(nearly);
    assert.deep(got.slice(0, nearly.length), nearly);
    assert.equal(got.length > nearly.length, true, 'new sections were not appended');
  });
});
