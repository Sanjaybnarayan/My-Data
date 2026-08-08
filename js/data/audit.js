/**
 * Audit trail.
 *
 * Every mutation writes one entry, in the same transaction as the change, so
 * the log cannot disagree with the data. Entries replicate to an append-only
 * `_Audit` tab, where nothing in the client ever issues an update or a delete.
 *
 * What is recorded is *which fields changed*, not what they changed to. A log
 * of before-and-after values would be a second, unencrypted copy of every
 * sensitive field in the system — the record's own history in Sheets already
 * serves recovery, and this serves accountability.
 */

import { newId } from '../core/ids.js';
import { entity } from './schema.js';

export const ACTIONS = Object.freeze({
  create: 'create',
  update: 'update',
  delete: 'delete',
  restore: 'restore',
  read: 'read',        // only for entities marked sensitive
  unlock: 'unlock',
  lock: 'lock',
  login: 'login',
  logout: 'logout',
  sync: 'sync',
  export: 'export',
  permission: 'permission-denied',
  settings: 'settings',
});

/** Entities where even a read is worth recording. */
const READ_LOGGED = new Set(['vaultItem', 'identityDocument']);

export function shouldLogRead(entityName) {
  return READ_LOGGED.has(entityName);
}

/** Which keys differ, ignoring the envelope. */
export function changedFields(before, after) {
  if (!before) return Object.keys(after ?? {}).filter(isDataField);
  const keys = new Set([...Object.keys(before), ...Object.keys(after ?? {})].filter(isDataField));
  const changed = [];
  for (const key of keys) {
    const a = before[key];
    const b = after?.[key];
    if (Array.isArray(a) || Array.isArray(b)) {
      if (JSON.stringify(a ?? []) !== JSON.stringify(b ?? [])) changed.push(key);
    } else if (a !== b) {
      changed.push(key);
    }
  }
  return changed;
}

const ENVELOPE = new Set([
  'id', 'rev', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'deletedAt', 'origin', 'schemaVersion', 'syncState', '_undecryptable',
]);

function isDataField(key) {
  return !ENVELOPE.has(key) && !key.startsWith('_');
}

/**
 * @param {{action: string, entity?: string, recordId?: string, actor?: object,
 *          fields?: string[], detail?: object, deviceId?: string,
 *          at?: string}} input
 */
export function auditEntry(input) {
  return {
    id: newId('aud'),
    at: input.at ?? new Date().toISOString(),
    action: input.action,
    entity: input.entity ?? '',
    recordId: input.recordId ?? '',
    actorId: input.actor?.personId ?? '',
    actorRole: input.actor?.role ?? '',
    fields: input.fields ?? [],
    detail: input.detail ?? {},
    deviceId: input.deviceId ?? '',
    synced: false,
  };
}

/** A sentence a person can read, for the activity feed. */
export function describe(entry, nameOf = (id) => id) {
  const who = entry.actorId ? nameOf(entry.actorId) : 'Someone';
  const label = entry.entity ? entity(entry.entity).labels.one.toLowerCase() : 'record';
  // "a account" reads as a bug to everyone who sees it, and every entity
  // label passes through here.
  const a = /^[aeiou]/.test(label) ? 'an' : 'a';

  switch (entry.action) {
    case ACTIONS.create: return `${who} added ${a} ${label}`;
    case ACTIONS.update:
      return entry.fields.length
        ? `${who} changed ${entry.fields.length === 1 ? entry.fields[0] : `${entry.fields.length} fields`} on ${a} ${label}`
        : `${who} updated ${a} ${label}`;
    case ACTIONS.delete: return `${who} deleted ${a} ${label}`;
    case ACTIONS.restore: return `${who} restored ${a} ${label}`;
    case ACTIONS.read: return `${who} opened ${a} ${label}`;
    case ACTIONS.unlock: return `${who} unlocked FamilyOS`;
    case ACTIONS.lock: return 'FamilyOS locked';
    case ACTIONS.login: return `${who} signed in`;
    case ACTIONS.logout: return `${who} signed out`;
    case ACTIONS.sync: return `Synced ${entry.detail.pushed ?? 0} up, ${entry.detail.pulled ?? 0} down`;
    case ACTIONS.export: return `${who} exported ${entry.detail.report ?? 'a report'}`;
    case ACTIONS.permission: return `${who} was refused ${entry.detail.action} on ${label}`;
    case ACTIONS.settings: return `${who} changed a setting`;
    default: return `${who} did something to ${a} ${label}`;
  }
}

/**
 * Recent entries, newest first. Reads straight off the `byAt` index so the
 * activity widget does not scan the whole log.
 */
export async function recentActivity(adapter, { limit = 20, entityName, since } = {}) {
  return adapter.query('audit', {
    index: 'byAt',
    direction: 'prev',
    limit,
    range: since ? { lower: since } : undefined,
    filter: entityName ? (e) => e.entity === entityName : undefined,
  });
}

/** Entries not yet replicated, for the sync push. */
export async function unsyncedAudit(adapter, limit = 500) {
  return adapter.query('audit', { limit, filter: (e) => !e.synced });
}
