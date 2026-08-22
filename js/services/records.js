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

import { Service, TRANSACTION_LIMIT } from './service.js';
import {
  entities, entity, referenceFields, referencedIds,
} from '../data/schema.js';
import { connectionsOf } from '../domain/connections.js';
import { OWN_RECORD_ENTITIES, rowFilter } from '../security/rbac.js';
import { summariseHistory } from '../data/audit.js';

export class RecordsService extends Service {
  /**
   * The household's staff, for a screen that wants to say who works here now.
   *
   * A read behind a service rather than a module reaching the repository: the
   * architecture document holds that edge to a budget that may only narrow,
   * and adding one more would have widened it.
   */
  /**
   * The absences recorded against a staff record.
   *
   * Absence is what is stored, not presence — see the entity in
   * `data/schema.js`. So an empty answer means nothing interrupted the
   * arrangement, which is the truthful default rather than a gap in the data.
   */
  async leaveForStaff(staffId, { limit = 500 } = {}) {
    const all = await this.db.repo('staffLeave').list({ decrypt: false, limit });
    return all
      .filter((row) => row.staff === staffId)
      .sort((a, b) => String(b.from ?? '').localeCompare(String(a.from ?? '')));
  }

  /**
   * What has actually been paid to the person a staff record points at.
   *
   * `transaction.person` is the link and it already exists — a wage is not an
   * `economicEvent`, whose kinds only ever describe money moving between the
   * household's own accounts. See `docs/HOUSEHOLD_STAFF.md`.
   *
   * `agreed` is what the staff record says was agreed; it is returned beside
   * the payments rather than instead of them, so a screen can show that a
   * payment does not match without either figure standing in for the other.
   */
  async paymentsForStaff(staffId, { limit = 200 } = {}) {
    const record = await this.db.repo('staff').get(staffId, { decrypt: false });
    if (!record?.person) return { payments: [], agreed: null, staff: null, leave: [] };

    const all = await this.db.repo('transaction').list({ decrypt: false, limit: TRANSACTION_LIMIT });
    const payments = all
      .filter((row) => row.person === record.person)
      .sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')))
      .slice(0, limit);

    // The record travels with the payments so a caller can compare them
    // against what was agreed — `paidEvery`, `startedOn` and `endedOn` all
    // decide which months can honestly be judged. See `domain/staffpay.js`.
    const leave = await this.leaveForStaff(staffId);
    return { payments, agreed: record.monthlyPay ?? null, staff: record, leave };
  }

  /**
   * The documents belonging to the person a staff record points at.
   *
   * There is no `document.staff` reference and there should not be: a
   * document filed against the person would not appear on the role, and one
   * filed against the role would not appear on the person. The link already
   * exists — `document.person` — and this reads it rather than adding a
   * second path to the same thing.
   */
  async documentsForStaff(staffId) {
    const record = await this.db.repo('staff').get(staffId, { decrypt: false });
    if (!record?.person) return { person: null, documents: [] };

    const all = await this.db.repo('document').list({ decrypt: false, limit: 500 });
    return {
      person: record.person,
      documents: all.filter((row) => row.person === record.person),
    };
  }

  async staff({ limit = 500 } = {}) {
    return this.db.repo('staff').list({ decrypt: false, limit });
  }

  /**
   * What deleting this record would leave pointing at nothing.
   *
   * @returns {Promise<{total: number, breaking: number, byEntity: object[]}>}
   */
  /**
   * What a record is connected to, in both directions.
   *
   * Here rather than in the screen for the reason this file exists: a screen
   * that called `db.referencedBy` and then looked up a title per target would
   * be four database calls in a view, testable only through a browser. It is
   * also the difference between the connections card costing the UI→database
   * budget a call and costing it none.
   */
  async connectionsFor(entityName, record) {
    if (!entities[entityName]) throw new Error(`unknown entity: ${entityName}`);
    const references = await this.db.referencedBy(record.id).catch(() => []);

    // Titles for what this record points at. Fetched per target so one that
    // is gone reads as missing rather than as an id.
    const wanted = new Map();
    for (const field of referenceFields(entityName)) {
      for (const id of referencedIds(record, field)) {
        if (!wanted.has(field.ref)) wanted.set(field.ref, new Set());
        wanted.get(field.ref).add(id);
      }
    }

    const titles = new Map();
    for (const [name, ids] of wanted) {
      for (const id of ids) {
        const found = await this.repo(name).get(id).catch(() => null);
        if (found) titles.set(`${name}:${id}`, String(entity(name).title(found) ?? id));
      }
    }

    return connectionsOf(entityName, record, references, {
      titleOf: (name, id) => titles.get(`${name}:${id}`) ?? null,
    });
  }

  /**
   * Exactly what somebody who works for this household could be shown.
   *
   * ## Why this is a supervised view and not a login
   *
   * `STAFF/staff-access` asks for an access path for the person the records
   * are about. This is half of it, and the half that is missing is stated
   * rather than implied: **there is no per-person credential anywhere in this
   * application.** The role follows a stored choice of who is using the
   * device, so anybody who can unlock it can be anybody.
   *
   * A role switch would therefore be reversible by whoever it was meant to
   * restrict, and worse, it would strand a household who handed their phone
   * over and could not get back. So the household opens this, in their own
   * session, and shows it to the person — supervised, and honest about being
   * supervised.
   *
   * ## What is shown is decided by the RBAC, not by this method
   *
   * The rows are filtered through `rowFilter` with a staff actor, so this
   * cannot drift from what the role actually permits. If somebody widens the
   * role tomorrow, this widens with it; if they narrow it, this narrows. A
   * second hand-written idea of "what staff may see" would be a second answer
   * to one question.
   */
  async whatIsHeldAbout(personId) {
    const actor = { personId, role: 'staff' };
    const held = [];

    for (const name of OWN_RECORD_ENTITIES) {
      const keep = rowFilter(actor, name);
      const rows = (await this.repo(name).list({ limit: 500 }).catch(() => []))
        .filter((row) => keep(row));
      if (rows.length) held.push({ entity: name, label: entity(name).labels.many, rows });
    }

    return {
      held,
      // Named, because a list of what somebody may see is only half an answer
      // to "what do you hold about me". `staffLeave` is the live example: the
      // household holds it and the role cannot reach it.
      // Derived: anything that points at a `staff` record, and so is about
      // this person, but which the role cannot reach. `staffLeave` is the
      // live example — the household holds it and the person cannot see it.
      notShown: Object.values(entities)
        .filter((def) => !OWN_RECORD_ENTITIES.has(def.name)
          && (def.fields ?? []).some((f) => f.ref === 'staff'))
        .map((def) => def.labels.many),
    };
  }

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
          // Both, because a group of one is the commonest case on this screen
          // and "1 health records" is the sort of sentence that makes somebody
          // stop trusting the rest of the dialog.
          labelOne: def.labels.one,
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
      // Present tense, and a refusal rather than a forecast. The repository
      // will not perform this delete, so a sentence saying what *would* break
      // describes something that is not going to happen.
      const list = impact.byEntity.filter((g) => g.required)
        .map((g) => `${g.count} ${(g.count === 1 ? g.labelOne : g.label).toLowerCase()}`)
        .join(', ');
      parts.push(
        `${records(impact.breaking)} ${impact.breaking === 1 ? 'needs' : 'need'} it — ${list} `
        + '— so it cannot be deleted until they are pointed somewhere else',
      );
    }

    const optional = impact.total - impact.breaking;
    if (optional) parts.push(`${records(optional)} will be left pointing at nothing`);

    return `${parts.join('. ')}.`;
  }
}
