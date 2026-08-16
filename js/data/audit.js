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
import { newestFirst } from '../domain/timeline.js';

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
 *
 * @param {object} adapter
 * @param {{limit?: number, entityName?: string, since?: string}} [query]
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

/**
 * Everything that has happened to **one** record, newest first.
 *
 * `recentActivity` can be asked what happened lately and what happened to
 * *accounts*; it could not be asked what happened to **this** account, because
 * its filter is on the entity name. That is the question somebody looking at a
 * record has, and the log has held the answer since Phase 0.5 — `recordId` is
 * on every entry — with nothing able to reach it.
 *
 * Read off `byRecord` rather than scanned: a household's log grows for as long
 * as they use the application, and a record screen must not get slower as it
 * does.
 */
/**
 * @param {object} adapter
 * @param {string} recordId
 * @param {{limit?: number}} [query]
 */
export async function historyOf(adapter, recordId, { limit = 50 } = {}) {
  if (!recordId) return [];
  const entries = await adapter.query('audit', {
    index: 'byRecord',
    range: { only: recordId },
    limit,
  });
  // Ties are broken by id rather than left to the index — see `newestFirst`.
  // A record created and corrected in one breath was showing the correction
  // above the creation about half the time.
  return [...entries].sort(newestFirst);
}

/**
 * What a record's history adds up to.
 *
 * Deliberately not a count of log lines. "Changed 4 times" is a fact about the
 * record; "4 audit entries" is a fact about this file, and one of them is
 * often a `read` nobody made a change with.
 */
export function summariseHistory(entries) {
  const rows = entries ?? [];
  const changes = rows.filter((entry) => entry.action === ACTIONS.update);
  const created = rows.find((entry) => entry.action === ACTIONS.create) ?? null;

  return {
    created: created?.at ?? null,
    createdBy: created?.actorId ?? null,
    changes: changes.length,
    lastChanged: changes[0]?.at ?? null,
    // Who has touched it, in the order they last did. A household asking why a
    // figure moved usually wants a person before they want a timestamp.
    actors: [...new Set(rows.map((entry) => entry.actorId).filter(Boolean))],
    // Counted apart: an entry saying somebody *opened* a vault item is the
    // whole reason reads are logged for it, and folding it into "changes"
    // would both overstate the edits and hide the reads.
    reads: rows.filter((entry) => entry.action === ACTIONS.read).length,
  };
}

/** Entries not yet replicated, for the sync push. */
export async function unsyncedAudit(adapter, limit = 500) {
  return adapter.query('audit', { limit, filter: (e) => !e.synced });
}
