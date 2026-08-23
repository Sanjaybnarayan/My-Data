/**
 * What wants somebody's attention, and the list that is not typed out.
 *
 * `domain/reminders.js` walks the schema for fields marked `expiry`, so a new
 * dated field produces reminders the day it is added. That only works if the
 * caller actually hands it the records — and the dashboard did not.
 *
 * Its array of entity names had drifted from the schema by four:
 * `identityDocument`, `warranty`, `vehicleService` and `tenant`. The first
 * holds passports, driving licences and Aadhaar, so the screen a household
 * looks at first had never once said a passport was about to expire, while the
 * function built to find exactly that was being given nothing to look at.
 *
 * The list is derived now. This is the check that says so, and it is written
 * against the dashboard's source rather than against a copy of the list,
 * because a test holding its own copy would drift the same way.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entities } from '../js/data/schema.js';
import { datedEntities, BY_NAME } from '../js/services/attention.js';

setSuite('attention');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('the dated entities are derived from the schema', () => {
  test('every entity with an expiry field is found', () => {
    const expected = Object.entries(entities)
      .filter(([, def]) => def.fields.some((field) => field.expiry))
      .map(([name]) => name)
      .sort();
    assert.deep([...datedEntities()].sort(), expected);
  });

  test('and there are enough of them for that to mean something', () => {
    // A derivation that returns nothing would satisfy every assertion above.
    assert.equal(datedEntities().length > 10, true,
      `only ${datedEntities().length} dated entities found`);
  });

  test('identityDocument is among them', () => {
    // Named because it is the one that was missing, and the one that matters
    // most: passports, driving licences, Aadhaar.
    assert.equal(datedEntities().includes('identityDocument'), true);
  });
});

describe('the dashboard loads every dated entity', () => {
  const source = readFileSync(join(ROOT, 'js', 'modules', 'dashboard.js'), 'utf8');

  test('it does not name them itself any more', () => {
    // The failure this whole file exists for: a hand-written list beside a
    // derivable one. If somebody types the names back in, this says so.
    assert.equal(source.includes('datedEntities()'), true,
      'dashboard.js no longer derives its dated entities');
  });

  test('and the names it still writes by hand carry no expiry field', () => {
    const written = source.match(/const WIDGETS_NEED = \[([^\]]*)\]/s);
    assert.equal(Boolean(written), true, 'WIDGETS_NEED not found in dashboard.js');

    const names = [...written[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    assert.equal(names.length > 0, true, 'WIDGETS_NEED is empty');

    // Anything dated belongs to the derivation, not to this list. A name
    // appearing in both is how the two would start disagreeing again.
    const dated = new Set(datedEntities());
    assert.deep(names.filter((name) => dated.has(name)), []);
  });

  test('every name it uses is a real entity', () => {
    const written = source.match(/const WIDGETS_NEED = \[([^\]]*)\]/s);
    const names = [...written[1].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
    assert.deep(names.filter((name) => !(name in entities)), []);
  });
});

describe('the entities named by hand in the service', () => {
  test('are real, and are inputs rather than sources of expiry dates', () => {
    assert.deep(BY_NAME.filter((name) => !(name in entities)), []);
    const dated = new Set(datedEntities());
    // `recurringPayment` and `loan` legitimately appear in both: they carry
    // expiry fields *and* feed the money reminders. The union in the service
    // is what makes that harmless.
    assert.deep(BY_NAME.filter((name) => dated.has(name)), ['recurringPayment']);
  });
});
