/**
 * What a record is connected to, in both directions — Phase 17's knowledge
 * graph, built from the only edges this application actually has.
 *
 * ## An edge is a reference, never a resemblance
 *
 * The tempting version of a knowledge graph joins records that *look* related:
 * two rows mentioning the same name, a payment near a document's date, an
 * insurer's name appearing in a transaction narration. Every one of those is a
 * guess, and a guess drawn as a line is indistinguishable from a fact.
 *
 * This project already refuses that kind of inference elsewhere — a nominee is
 * never resolved to a person on a near match, an SMS is never merged with a
 * statement row on a near amount. The same rule applies here: **an edge exists
 * because one record stores another's id.** Nothing is inferred, so nothing on
 * this screen can be wrong in a way the records are not already wrong.
 *
 * ## Both directions, and they are not the same question
 *
 * *What does this point at* is answered from the record itself: the fields
 * that carry a `ref`. It is cheap and exact.
 *
 * *What points at this* has to be searched for, and it is the more useful half
 * — the vehicle's services, the person's documents, the will's beneficiaries.
 * It comes from `db.referencedBy`, which reads every entity.
 *
 * They are reported apart because they mean different things. "This transaction
 * has a document attached" and "this document is attached to a transaction" are
 * the same edge seen from two ends, and a household reading a document wants
 * the second sentence.
 */

import { entity, entityNames, referenceFields, referencedIds } from '../data/schema.js';

/**
 * Where this record points.
 *
 * Pure: the record and a way to name a target. Missing targets are kept and
 * marked rather than dropped — a reference to a record that is gone is the
 * most interesting kind, and silently omitting it would hide exactly what
 * `danglingReferences` exists to find.
 */
export function outbound(entityName, record, {
  titleOf = /** @type {(entityName: string, id: string) => string|null} */ (() => null),
} = {}) {
  const out = [];
  for (const field of referenceFields(entityName)) {
    for (const id of referencedIds(record, field)) {
      const title = titleOf(field.ref, id);
      out.push({
        direction: 'to',
        entity: field.ref,
        id,
        field: field.key,
        label: field.label ?? field.key,
        title,
        missing: title === null,
      });
    }
  }
  return out;
}

/**
 * What points at this record, grouped by where it comes from.
 *
 * `references` is what `db.referencedBy` returned; this function does no I/O,
 * so the grouping is testable without a database.
 */
export function inbound(references = []) {
  const groups = new Map();
  for (const ref of references) {
    const key = `${ref.entity}:${ref.field}`;
    if (!groups.has(key)) {
      const def = entityNames().includes(ref.entity) ? entity(ref.entity) : null;
      const field = def?.fields.find((f) => f.key === ref.field);
      groups.set(key, {
        direction: 'from',
        entity: ref.entity,
        label: def?.labels.many ?? ref.entity,
        field: ref.field,
        fieldLabel: field?.label ?? ref.field,
        records: [],
      });
    }
    groups.get(key).records.push({ id: ref.id, title: ref.title });
  }

  // Most-connected first: a person's forty documents matter more to somebody
  // reading the screen than their one employment record, and alphabetical
  // order by entity name would be the alphabet deciding.
  return [...groups.values()].sort((a, b) => b.records.length - a.records.length);
}

/** Both halves, and the counts a screen puts in a heading. */
export function connectionsOf(entityName, record, references, options = {}) {
  const to = outbound(entityName, record, options);
  const from = inbound(references);
  return {
    to,
    from,
    total: to.length + from.reduce((n, group) => n + group.records.length, 0),
    /** References pointing at a record that is not there. */
    broken: to.filter((one) => one.missing),
  };
}

/** The sentence under the heading. */
export function describeConnections({ to, from, broken }) {
  const points = to.length;
  const back = from.reduce((n, group) => n + group.records.length, 0);
  if (!points && !back) return 'Nothing else refers to this record, and it refers to nothing.';

  const parts = [];
  if (points) parts.push(`points at ${points} ${points === 1 ? 'record' : 'records'}`);
  if (back) parts.push(`${back} ${back === 1 ? 'record refers' : 'records refer'} to it`);
  const line = parts.join(' · ');
  return broken.length
    ? `${line} · ${broken.length} pointing at something that is not there`
    : line;
}
