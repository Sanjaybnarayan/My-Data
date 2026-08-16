/**
 * Questions that span entities.
 *
 * `Repository.referencedBy` throws `wrong-layer` on purpose — a repository owns
 * one entity and cannot answer a question about all of them. So this is where
 * the cross-entity operations live, and the first one is the one a household
 * actually meets: **what breaks if I delete this?**
 *
 * ## What was already there, and what was missing
 *
 * `modules/crud.js` already checks `db.referencedBy(id)` before a delete and
 * warns that *N records will be left pointing at nothing*. That is real and it
 * was not nothing. What it could not say is the part that decides whether the
 * warning matters:
 *
 * > A dangling **optional** reference is untidy. A dangling **required** one
 * > makes the referring record fail its own validation.
 *
 * A transaction must have an account (`required: true`); a transaction's
 * `person` is optional. Deleting an account and deleting a person are therefore
 * different acts, and until now they produced the same sentence.
 *
 * This does not block either one. A spreadsheet has no foreign keys, the
 * deletion is soft and restorable, and refusing would strand a household who
 * genuinely wants a record gone. It tells them which kind they are doing.
 */

import { Service } from './service.js';
import { entities, entity } from '../data/schema.js';
import { summariseHistory } from '../data/audit.js';

export class RecordsService extends Service {
  /**
   * What deleting this record would leave pointing at nothing.
   *
   * @returns {Promise<{total: number, breaking: number, byEntity: object[]}>}
   */
  async impactOfDeleting(entityName, id) {
    if (!entities[entityName]) throw new Error(`unknown entity: ${entityName}`);

    const references = await this.db.referencedBy(id);
    const groups = new Map();

    for (const ref of references) {
      const def = entity(ref.entity);
      const field = def.fields.find((f) => f.key === ref.field);
      // A reference through a field the schema no longer has. Counted, because
      // the row genuinely does point here, but not described as required or
      // optional — nothing is known about a field that is gone.
      const required = Boolean(field?.required);

      const key = `${ref.entity}:${ref.field}`;
      if (!groups.has(key)) {
        groups.set(key, {
          entity: ref.entity,
          label: def.labels.many,
          field: ref.field,
          fieldLabel: field?.label ?? ref.field,
          required,
          count: 0,
          examples: [],
        });
      }

      const group = groups.get(key);
      group.count += 1;
      // Three is enough to recognise what is about to break without turning a
      // confirmation dialog into a report.
      if (group.examples.length < 3 && ref.title) group.examples.push(ref.title);
    }

    const byEntity = [...groups.values()]
      // Breaking first: a household skimming a dialog should meet the
      // consequence that invalidates records before the one that does not.
      .sort((a, b) => (b.required - a.required) || (b.count - a.count));

    return {
      total: references.length,
      breaking: byEntity.filter((g) => g.required).reduce((n, g) => n + g.count, 0),
      byEntity,
    };
  }

  /**
   * The impact as a sentence.
   *
   * Kept beside the numbers rather than in the screen, because the wording is
   * the part that has to stay true when the numbers change — "1 records refer"
   * is the classic way this goes wrong.
   */
  /**
   * What has happened to one record, with the names to say it with.
   *
   * The service exists for the second half: `describe` takes a `nameOf`, and a
   * screen that resolved actor ids itself would be a screen reaching for the
   * person table — the edge `tools/architecture.mjs` counts and which may only
   * narrow.
   */
  async history(recordId, { limit = 50 } = {}) {
    const entries = await this.db.history(recordId, { limit });
    const people = await this.repo('person').list({ decrypt: false, limit: 500 })
      .catch(() => []);
    const byId = new Map(people.map((person) => [person.id, person.name]));

    return {
      entries,
      summary: summariseHistory(entries),
      // An id rather than a blank for somebody no longer in the household: a
      // record changed by a person since removed still changed.
      nameOf: (id) => byId.get(id) ?? id,
    };
  }

  describeImpact(impact) {
    if (!impact.total) return 'Nothing else refers to this record.';

    const records = (n) => `${n} ${n === 1 ? 'record' : 'records'}`;
    const parts = [`${records(impact.total)} ${impact.total === 1 ? 'refers' : 'refer'} to this one`];

    if (impact.breaking) {
      const list = impact.byEntity.filter((g) => g.required)
        .map((g) => `${g.count} ${g.label.toLowerCase()}`).join(', ');
      parts.push(
        `${records(impact.breaking)} need it — ${list} — and will not pass validation `
        + 'until they are pointed somewhere else',
      );
    }

    const optional = impact.total - impact.breaking;
    if (optional) parts.push(`${records(optional)} will be left pointing at nothing`);

    return `${parts.join('. ')}.`;
  }
}
