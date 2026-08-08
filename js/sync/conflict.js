/**
 * Conflict resolution.
 *
 * Pure functions, no storage and no clock, because this is the part of an
 * offline-first system that is impossible to debug in the field: by the time
 * anyone notices, the losing edit is gone. So it is written to be exhaustively
 * testable and it is exhaustively tested.
 *
 * ## The rules, in order
 *
 * 1. **Already converged.** Same `rev` and same `origin` — nothing to do.
 * 2. **A delete beats an edit.** Deleting is a deliberate act, and an edit
 *    arriving from a device that had not yet heard about the delete is almost
 *    always stale. The delete is recorded as a conflict so it can be undone.
 * 3. **Three-way merge, field by field**, against the last synced base:
 *    - changed on neither side → base
 *    - changed on one side → that side
 *    - changed on both to the same value → that value
 *    - changed on both, differently → **arbitrate**
 * 4. **Arbitration** is later `updatedAt`, then higher `rev`, then lexically
 *    greater `origin`. The last step is what makes this deterministic: two
 *    devices resolving the same pair without talking to each other reach the
 *    same record, so the next sync converges instead of ping-ponging.
 *
 * Without a base (the shadow was pruned, or the record is new on both sides)
 * the merge degrades to whole-record arbitration and every differing field is
 * reported, because guessing would be worse than saying so.
 */

const ENVELOPE = new Set([
  'id', 'rev', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy',
  'deletedAt', 'origin', 'schemaVersion', 'syncState', '_undecryptable',
]);

function dataKeys(...records) {
  const keys = new Set();
  for (const record of records) {
    if (!record) continue;
    for (const key of Object.keys(record)) {
      if (!ENVELOPE.has(key) && !key.startsWith('_')) keys.add(key);
    }
  }
  return [...keys];
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  }
  // A blank string and an absent field mean the same thing to a form.
  const norm = (v) => (v === undefined || v === null ? '' : v);
  return norm(a) === norm(b);
}

/**
 * Which side wins a straight fight. Returns 'local' or 'remote'.
 * Never returns a coin flip: every branch is a total order.
 */
export function arbitrate(local, remote) {
  const lt = Date.parse(local.updatedAt ?? 0) || 0;
  const rt = Date.parse(remote.updatedAt ?? 0) || 0;
  if (lt !== rt) return lt > rt ? 'local' : 'remote';

  const lr = local.rev ?? 0;
  const rr = remote.rev ?? 0;
  if (lr !== rr) return lr > rr ? 'local' : 'remote';

  const lo = String(local.origin ?? '');
  const ro = String(remote.origin ?? '');
  if (lo !== ro) return lo > ro ? 'local' : 'remote';

  return 'remote'; // identical on every axis; taking the server's copy is stable
}

/**
 * @param {{base?: object|null, local: object, remote: object}} input
 * @returns {{record: object, outcome: string, conflicted: string[],
 *            winner: 'local'|'remote'|'merge'}}
 */
export function merge({ base = null, local, remote }) {
  if (!local) return { record: remote, outcome: 'remote-only', conflicted: [], winner: 'remote' };
  if (!remote) return { record: local, outcome: 'local-only', conflicted: [], winner: 'local' };

  if (local.rev === remote.rev && local.origin === remote.origin) {
    return { record: remote, outcome: 'converged', conflicted: [], winner: 'remote' };
  }

  if (local.deletedAt || remote.deletedAt) {
    const deleted = local.deletedAt && remote.deletedAt
      ? (arbitrate(local, remote) === 'local' ? local : remote)
      : (local.deletedAt ? local : remote);
    const other = deleted === local ? remote : local;
    const bothDeleted = Boolean(local.deletedAt && remote.deletedAt);
    return {
      record: {
        ...deleted,
        rev: Math.max(local.rev ?? 0, remote.rev ?? 0) + 1,
      },
      outcome: bothDeleted ? 'both-deleted' : 'delete-wins',
      // A live edit lost to a delete: worth telling the user about, because
      // undoing it means restoring the record.
      conflicted: bothDeleted ? [] : changedAgainst(base, other),
      winner: deleted === local ? 'local' : 'remote',
    };
  }

  const winner = arbitrate(local, remote);

  if (!base) {
    const chosen = winner === 'local' ? local : remote;
    const differing = dataKeys(local, remote).filter((k) => !same(local[k], remote[k]));
    return {
      record: { ...chosen, rev: Math.max(local.rev ?? 0, remote.rev ?? 0) + 1 },
      outcome: 'no-base',
      conflicted: differing,
      winner,
    };
  }

  const record = { ...(winner === 'local' ? local : remote) };
  const conflicted = [];

  for (const key of dataKeys(base, local, remote)) {
    const localChanged = !same(base[key], local[key]);
    const remoteChanged = !same(base[key], remote[key]);

    if (!localChanged && !remoteChanged) {
      record[key] = base[key];
    } else if (localChanged && !remoteChanged) {
      record[key] = local[key];
    } else if (!localChanged && remoteChanged) {
      record[key] = remote[key];
    } else if (same(local[key], remote[key])) {
      record[key] = local[key]; // both made the same edit
    } else {
      record[key] = winner === 'local' ? local[key] : remote[key];
      conflicted.push(key);
    }
  }

  // A merged record is newer than either input, so the next push carries a
  // revision the server has not seen and cannot mistake for a replay.
  record.rev = Math.max(local.rev ?? 0, remote.rev ?? 0) + 1;
  record.updatedAt = maxIso(local.updatedAt, remote.updatedAt);
  record.updatedBy = (winner === 'local' ? local : remote).updatedBy;
  record.origin = (winner === 'local' ? local : remote).origin;
  record.createdAt = minIso(local.createdAt, remote.createdAt) ?? base.createdAt;
  record.createdBy = base.createdBy ?? local.createdBy ?? remote.createdBy;
  record.deletedAt = null;

  return {
    record,
    outcome: conflicted.length ? 'merged-with-conflicts' : 'merged',
    conflicted,
    winner: conflicted.length ? winner : 'merge',
  };
}

function changedAgainst(base, record) {
  if (!base || !record) return [];
  return dataKeys(base, record).filter((k) => !same(base[k], record[k]));
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

/**
 * The record kept for the user to review. It holds both sides, so "undo the
 * machine's choice" is a copy rather than a guess.
 */
export function conflictRecord({ store, local, remote, merged, conflicted, outcome, at }) {
  return {
    id: `${store}:${merged.id}:${merged.rev}`,
    store,
    recordId: merged.id,
    at: at ?? new Date().toISOString(),
    outcome,
    fields: conflicted,
    localValues: Object.fromEntries(conflicted.map((k) => [k, local?.[k] ?? null])),
    remoteValues: Object.fromEntries(conflicted.map((k) => [k, remote?.[k] ?? null])),
    resolvedValues: Object.fromEntries(conflicted.map((k) => [k, merged[k] ?? null])),
    reviewed: false,
  };
}
