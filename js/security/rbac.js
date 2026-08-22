/**
 * Role-based access control.
 *
 * Enforced in the repository, not in the view. Hiding a button is a courtesy;
 * refusing the write is the control. Every read and write goes through
 * `assertCan`, so a module that forgets to hide a control still cannot save.
 *
 * Roles, most privileged first: owner, spouse, adult, child, guest.
 *
 * Two rules sit on top of the per-entity lists in the schema:
 *
 *   - **A child sees their own record.** A twelve-year-old can look at their
 *     own vaccinations and their own school fees, and nobody else's.
 *   - **A guest sees only what is explicitly shared.** Emergency contacts and
 *     medical ID, because that is what a guest account is for.
 */

import { entities, entity, ROLES } from '../data/schema.js';
import { PermissionError } from '../core/errors.js';

const RANK = Object.fromEntries(ROLES.map((r, i) => [r, i]));

/** Entities a guest may read, whatever the schema says. */
const GUEST_READABLE = new Set(['emergencyContact']);

/**
 * Entities where somebody may read and edit rows that are about them.
 *
 * Exported because `tools/policy.mjs` generates the backend's copy from these
 * two tables. Until it did, the server had no own-record rule at all and the
 * two layers disagreed on fourteen (role, action, entity) combinations — every
 * one of them an action this file permits and the backend refuses. See
 * `docs/OWN_RECORDS.md`.
 */
/**
 * Which field on an entity names the person a record is about.
 *
 * This is the only table. `OWN_RECORD_ENTITIES` is derived from it below,
 * because they were two lists that had to agree and a mutation proved they
 * did not have to: adding an entity to the set without a field here changed
 * nothing at all, so somebody could believe they had granted access and be
 * wrong with no test disagreeing.
 *
 * `staffLeave` is deliberately absent. Row-level filtering needs the subject
 * named on the row, and a leave row names the *employment record*, not the
 * person. Adding a `person` column to make it work would be a second copy of
 * who a leave belongs to, free to disagree with the first — the fault this
 * pair had. So a staff member sees their employment record and not their
 * leave, and `docs/OWN_RECORDS.md` says so rather than leaving somebody to
 * discover it.
 */
export const SUBJECT_FIELD = {
  person: 'id',
  healthRecord: 'person',
  medication: 'person',
  vaccination: 'person',
  appointment: 'person',
  education: 'person',
  certificate: 'person',
  task: 'assignee',
  note: 'createdBy',
  event: 'createdBy',
  // The employment record a household holds *about* somebody who works for
  // them, so the person can be shown it — which was previously impossible
  // without handing over the household's records.
  staff: 'person',
};

/**
 * Entities where somebody may read and edit rows that are about them.
 *
 * Derived, not typed twice. Exported because `tools/policy.mjs` generates the
 * backend's copy from these — until it did, the server had no own-record rule
 * at all and the two layers disagreed on fourteen (role, action, entity)
 * combinations, every one an action this file permits and the backend
 * refuses. See `docs/OWN_RECORDS.md`.
 */
export const OWN_RECORD_ENTITIES = new Set(Object.keys(SUBJECT_FIELD));

export function isRole(role) {
  return Object.hasOwn(RANK, role);
}

export function atLeast(role, minimum) {
  return isRole(role) && isRole(minimum) && RANK[role] <= RANK[minimum];
}

/**
 * @param {object} actor `{ personId, role }`
 * @param {'read'|'write'|'delete'} action
 * @param {string} entityName
 * @param {object} [record] present for row-level checks
 */
export function can(actor, action, entityName, record = null) {
  if (!actor || !isRole(actor.role)) return false;

  const def = entity(entityName);
  const allowed = action === 'read' ? def.acl.read : def.acl.write;

  if (actor.role === 'guest') {
    return action === 'read' && GUEST_READABLE.has(entityName);
  }

  if (allowed.includes(actor.role)) {
    // A child with blanket access still only sees their own rows, so a shared
    // family device does not expose one sibling's records to another.
    if (actor.role === 'child' && record && OWN_RECORD_ENTITIES.has(entityName)) {
      return isAbout(actor, entityName, record);
    }
    return true;
  }

  // Not on the list, but it might be their own record.
  if (record && OWN_RECORD_ENTITIES.has(entityName) && isAbout(actor, entityName, record)) {
    return true;
  }

  return false;
}

function isAbout(actor, entityName, record) {
  const field = SUBJECT_FIELD[entityName];
  if (!field) return false;
  return record[field] === actor.personId;
}

export function assertCan(actor, action, entityName, record = null) {
  if (!can(actor, action, entityName, record)) {
    throw new PermissionError(action, entityName, actor?.role ?? 'anonymous');
  }
}

/**
 * A filter for list queries, so a restricted role's rows are excluded by the
 * query rather than fetched and then hidden.
 */
export function rowFilter(actor, entityName) {
  if (!actor) return () => false;
  if (actor.role === 'guest') {
    return GUEST_READABLE.has(entityName) ? () => true : () => false;
  }
  if (actor.role === 'child' && OWN_RECORD_ENTITIES.has(entityName)) {
    return (record) => isAbout(actor, entityName, record);
  }
  const def = entity(entityName);
  if (def.acl.read.includes(actor.role)) return () => true;
  if (OWN_RECORD_ENTITIES.has(entityName)) {
    return (record) => isAbout(actor, entityName, record);
  }
  return () => false;
}

/** Entities this actor may see at all — drives which nav items are rendered. */
export function visibleEntities(actor) {
  if (!actor || !isRole(actor.role)) return [];
  return Object.keys(entities).filter((name) => {
    if (actor.role === 'guest') return GUEST_READABLE.has(name);
    return entities[name].acl.read.includes(actor.role) || OWN_RECORD_ENTITIES.has(name);
  });
}

/** Modules with at least one visible entity, in schema order. */
export function visibleModules(actor, allModules) {
  const visible = new Set(visibleEntities(actor));
  return allModules.filter((m) => {
    if (m.entities.length === 0) {
      // Dashboard, reports and settings have no entities of their own; a
      // guest gets none of them.
      return actor?.role !== 'guest' || m.id === 'emergency';
    }
    return m.entities.some((e) => visible.has(e));
  });
}
