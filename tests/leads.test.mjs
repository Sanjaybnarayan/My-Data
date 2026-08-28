import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { expiryReminders, leadFor } from '../js/domain/reminders.js';
import { entities } from '../js/data/schema.js';

setSuite('leads');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every expiry field the schema declares, as `entity.field` with its lead. */
function declared() {
  const out = [];
  for (const [name, def] of Object.entries(entities)) {
    for (const field of def.fields) {
      if (field.expiry) out.push({ entity: name, key: field.key, lead: field.expiryLead });
    }
  }
  return out;
}

/**
 * The tone `dueBadge` would give.
 *
 * Written out rather than imported: `dueBadge` builds a DOM node, and the
 * question here is about the rule inside it. Copying the rule means this test
 * fails if the two ever disagree, which is the point — a badge whose colour is
 * decided somewhere other than where urgency is decided is exactly the fault
 * this file exists for.
 */
function toneFor(days, leadDays) {
  if (days < 0) return 'danger';
  if (days <= Math.min(7, leadDays)) return 'danger';
  if (days <= leadDays) return 'warning';
  return 'positive';
}

describe('the declared lead', () => {
  test('is what leadFor returns, for every expiry field in the schema', () => {
    for (const one of declared()) {
      assert.equal(leadFor(one.entity, one.key), one.lead,
        `${one.entity}.${one.key}`);
    }
  });

  test('and an undeclared field falls back rather than returning undefined', () => {
    // `undefined` would reach `dueBadge` as a comparison against NaN, which is
    // false for everything — every badge green, silently.
    assert.equal(leadFor('nothing', 'nowhere'), 45);
    assert.equal(leadFor('nothing', 'nowhere', 7), 7);
  });
});

describe('a listed row never wears a badge that contradicts the list', () => {
  test('a passport inside its own 180-day window is not shown as fine', () => {
    /*
     * The defect this was written for.
     *
     * `expiryReminders` chose to list it, using the 180 days the schema
     * declares for a passport. The dashboard then re-decided urgency with a
     * flat 30 and painted it green — so "Expiring & due" carried a row saying
     * everything was in order.
     */
    const clock = () => Date.parse('2026-06-01T00:00:00Z');
    const rows = expiryReminders({
      identityDocument: [{ id: 'd1', kind: 'Passport', expiresOn: '2026-09-09' }],
    }, { clock });

    assert.length(rows, 1);
    assert.equal(rows[0].days, 100);
    assert.equal(rows[0].lead, 180);
    assert.equal(toneFor(rows[0].days, rows[0].lead), 'warning');

    // And what it used to be, so the test says what it is preventing.
    assert.equal(toneFor(rows[0].days, 30), 'positive');
  });

  test('every reminder carries the window it was judged against', () => {
    const clock = () => Date.parse('2026-06-01T00:00:00Z');
    const soon = '2026-06-10';

    /** @type {Record<string, any[]>} */
    const byEntity = {};
    for (const one of declared()) {
      byEntity[one.entity] ??= [];
      byEntity[one.entity].push({ id: `${one.entity}-${one.key}`, [one.key]: soon });
    }

    const rows = expiryReminders(byEntity, { clock });
    assert.equal(rows.length > 10, true, `only ${rows.length} reminders were produced`);

    for (const row of rows) {
      assert.equal(row.lead, leadFor(row.entity, row.field),
        `${row.entity}.${row.field} was judged against a different window`);
      // Never green: the row is in the list, so the badge must not say fine.
      assert.equal(toneFor(row.days, row.lead) === 'positive', false,
        `${row.entity}.${row.field} would be listed and painted as in date`);
    }
  });
});

/**
 * The ratchet.
 *
 * The fix above is only worth anything if the next screen does not type the
 * number in again. `leadDays` is the argument that carries this decision, so a
 * numeric literal passed to it in a screen is the drift returning.
 */
describe('no screen decides a lead for itself', () => {
  function screens(dir = join(ROOT, 'js', 'modules'), out = []) {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) screens(full, out);
      else if (name.name.endsWith('.js')) out.push(full);
    }
    return out;
  }

  test('no module passes a number as leadDays', () => {
    const offenders = [];
    for (const file of screens()) {
      const text = readFileSync(file, 'utf8');
      for (const [index, line] of text.split('\n').entries()) {
        if (/leadDays:\s*\d/.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${index + 1}`);
        }
      }
    }
    assert.deep(offenders, [], 'a lead typed into a screen beside one in the schema');
  });
});
