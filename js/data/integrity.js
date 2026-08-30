/**
 * Referential integrity, without a relational database to do it for us.
 *
 * ## What was measured before this was written
 *
 *     db.repo('transaction').create({ account: 'acc_does_not_exist', … })
 *     → accepted
 *     db.repo('person').remove(id)  with a transaction pointing at them
 *     → allowed
 *
 * A `ref` field was a string. Nothing checked that the string named anything,
 * and nothing stopped the thing it named being deleted underneath it. The UI
 * warned before a delete — `RecordsService.impactOfDeleting` has always
 * described what would break — but a warning is advice and this is a rule.
 *
 * Against the specification's Phase 1 that gap is the foreign key. IndexedDB
 * has no constraints, so the constraint lives here: one door, the repository,
 * which every user write already passes through for authorization, validation
 * and audit.
 *
 * ## Why sync does not come through here
 *
 * `applyRemote` is deliberately exempt. A pull arrives in whatever order the
 * backend hands rows over, so a transaction can legitimately land before the
 * account it names — and refusing it would drop a row the household really
 * has, permanently, to satisfy a rule about an ordering nobody promised.
 *
 * That is a real weakening and it is stated rather than hidden: **integrity is
 * enforced where records are made, not where they arrive.** A dangling
 * reference can still enter this database through a sync from a device running
 * an older version.
 *
 * What the weakening costs is the *refusing*, though, and nothing here has to
 * stay quiet. `danglingIn()` exists so a household can be shown them rather
 * than discovering one on a screen that says "unknown" — and for a long time
 * the only way to be shown was Settings → Data → *Check for broken links*,
 * which is to say the audit ran when somebody already suspected.
 *
 * `SyncEngine#noteDangling` now runs the same audit at the end of a pull, over
 * the rows that pull applied. That is the one moment the ordering argument
 * above has expired: whatever was coming has come, so a reference still
 * pointing at nothing is not early, it is broken. It records a diagnostic and
 * refuses nothing, so the row a household really has is still theirs.
 *
 * ## Delete is RESTRICT, never CASCADE
 *
 * Deleting a person does not delete their transactions. Cascading a delete
 * through a household's financial records because somebody tidied up a
 * contact is not a tidy-up, it is data loss with a plausible explanation. So a
 * delete that would leave a **required** reference dangling is refused and
 * names what points at it; an optional one is allowed, because an optional
 * reference is one the schema already says may be empty.
 */

import { entities, entity, entityNames } from './schema.js';
import { ValidationError } from '../core/errors.js';

/** Every `ref` and `multiref` field on an entity, with what it points at. */
export function referenceFieldsOf(entityName) {
  const def = entities[entityName];
  if (!def) return [];
  return (def.fields ?? [])
    .filter((f) => (f.type === 'ref' || f.type === 'multiref') && f.ref)
    .map((f) => ({
      key: f.key,
      entity: f.ref,
      many: f.type === 'multiref',
      required: Boolean(f.required),
      label: f.label ?? f.key,
    }));
}

/** The ids a record points at, field by field. */
export function referencesIn(entityName, record) {
  const out = [];
  for (const field of referenceFieldsOf(entityName)) {
    const raw = record?.[field.key];
    const ids = field.many && Array.isArray(raw) ? raw : [raw];
    // One guard, here. An optional reference left blank is not a reference
    // pointing at nothing — it is not pointing. An earlier version filtered
    // blanks twice, when building `ids` and again here, which meant neither
    // filter could be shown to be doing the work: removing either one changed
    // nothing a test could see.
    for (const id of ids) if (id) out.push({ ...field, id: String(id) });
  }
  return out;
}

/**
 * Which of a record's references do not resolve.
 *
 * `exists` is injected — `(entityName, id) => Promise<boolean>` — so this is
 * testable without a database and so the repository decides what "exists"
 * means. A soft-deleted row does not: pointing at a record somebody threw away
 * is the same dangling reference as pointing at one that never was, and it is
 * the more common way to arrive at one.
 */
export async function unresolved(entityName, record, exists) {
  const bad = [];
  for (const reference of referencesIn(entityName, record)) {
    if (!(await exists(reference.entity, reference.id))) bad.push(reference);
  }
  return bad;
}

/**
 * The sentence a person reads when a write is refused.
 *
 * Names the field by its label and says what it was pointing at, because "a
 * reference is invalid" sends somebody looking through a form for something
 * that looks wrong and everything looks fine.
 */
export function describeUnresolved(entityName, bad) {
  const def = entity(entityName);
  const one = bad[0];
  const target = entities[one.entity]?.labels?.one?.toLowerCase() ?? one.entity;
  const rest = bad.length > 1 ? `, and ${bad.length - 1} more like it` : '';
  return `This ${def.labels.one.toLowerCase()} points at a ${target} that is not `
    + `here — ${one.label} names ${one.id}${rest}. `
    + 'The record it names may have been deleted on another device.';
}

/**
 * Rows that point at this one, and whether they could survive losing it.
 *
 * `rowsOf` is injected — `(entityName) => Promise<object[]>` — so the caller
 * decides how much to read and this stays a pure question about the schema.
 */
export async function dependents(entityName, id, rowsOf) {
  const found = [];
  for (const name of entityNames()) {
    const fields = referenceFieldsOf(name).filter((f) => f.entity === entityName);
    if (!fields.length) continue;

    const rows = await rowsOf(name);
    for (const row of rows ?? []) {
      if (row?.deletedAt) continue;
      for (const field of fields) {
        const raw = row[field.key];
        const hit = field.many
          ? Array.isArray(raw) && raw.includes(id)
          : raw === id;
        if (hit) found.push({ entity: name, id: row.id, field, required: field.required });
      }
    }
  }
  return found;
}

/** Only the ones that could not do without it. */
export const blocking = (found) => found.filter((d) => d.required);

export function describeBlocked(entityName, blocked) {
  const def = entity(entityName);
  const first = blocked[0];
  const owner = entity(first.entity).labels[blocked.length > 1 ? 'many' : 'one'].toLowerCase();
  const count = blocked.length > 1 ? `${blocked.length} ${owner}` : `a ${owner}`;
  return `This ${def.labels.one.toLowerCase()} cannot be deleted while ${count} `
    + `still needs it — ${first.field.label} is required there. `
    + 'Change or delete those first.';
}

// `ValidationError` takes the issue list the form layer already renders, so a
// refused reference lands on the field that caused it rather than as a banner
// the person has to map back to an input themselves.
export function refuseUnresolved(entityName, bad) {
  return new ValidationError(
    [{ field: bad[0].key, message: describeUnresolved(entityName, bad) }],
    entityName,
  );
}

export function refuseBlocked(entityName, blocked) {
  return new ValidationError(
    [{ field: blocked[0].field.key, message: describeBlocked(entityName, blocked) }],
    entityName,
  );
}

/**
 * Every dangling reference already in the database.
 *
 * The audit half. Integrity is enforced on new writes, so a database that has
 * been synced from an older device can still contain rows that would be
 * refused today, and a household is better told than left to meet one on a
 * screen that says "unknown".
 */
export async function danglingIn(rowsOf, exists) {
  const out = [];
  for (const name of entityNames()) {
    if (!referenceFieldsOf(name).length) continue;
    for (const row of (await rowsOf(name)) ?? []) {
      if (row?.deletedAt) continue;
      for (const bad of await unresolved(name, row, exists)) {
        // Two identities are in play and they are kept apart deliberately.
        // `entity`/`id` are the row that is broken — the one a household would
        // open to fix it. `points` is what it names and cannot find. Spreading
        // the reference here instead would overwrite the first pair with the
        // second and report every dangling reference as living on the record
        // that does not exist.
        out.push({
          entity: name,
          id: row.id,
          key: bad.key,
          label: bad.label,
          required: bad.required,
          points: { entity: bad.entity, id: bad.id },
        });
      }
    }
  }
  return out;
}
