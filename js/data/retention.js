/**
 * How long a deleted record is kept, and what erasing it can actually reach.
 *
 * ## The gap this fills
 *
 * Deleting anything in FamilyOS stamps `deletedAt` and stops showing it. The
 * row keeps every value it held. Nothing anywhere hard-deletes — there is no
 * `purge`, no `adapter.delete` of a record, nothing. So a household that
 * deleted a vault entry two years ago still has that password sitting in
 * IndexedDB, and in the backup spreadsheet.
 *
 * That is a defensible *default* — a soft delete is recoverable, and a
 * household deleting the wrong thing is far more likely than one needing
 * erasure. It is not a defensible *only option*.
 *
 * ## What erasure can and cannot reach
 *
 * This is the part that must not be glossed. A purge on this device reaches:
 *
 *   - the row in IndexedDB, and its search entry
 *   - the encrypted blob, for a document
 *
 * It does not reach, and this module says so rather than implying otherwise:
 *
 *   - **another device.** Each holds its own IndexedDB. A purge is not a sync
 *     operation, and making it one would let any device order every other to
 *     destroy data — a far worse failure than keeping a row too long.
 *   - **the backup spreadsheet's revision history.** Google keeps revisions of
 *     a Sheet. Removing a row removes it from the current revision only.
 *   - **anything already exported.** A CSV on somebody's desktop is theirs.
 *   - **Drive's bin**, for thirty days, and any Google backup after that.
 *
 * So "erased" here means *erased from this device*. Claiming more would be the
 * kind of promise that is only discovered to be false when it matters.
 */

import { entities } from './schema.js';
import { classify } from './classification.js';
import { indexKey } from './search.js';

const DAY = 24 * 60 * 60 * 1000;

/**
 * How long after deletion a record may be purged, in days.
 *
 * Longer for the things a household is most likely to want back, and for the
 * things a tax authority may ask about. `null` means never purge
 * automatically — it can still be erased deliberately.
 */
export const POLICIES = Object.freeze({
  /** The default. Long enough to notice a mistake, short enough to mean it. */
  standard: { days: 90, why: 'long enough to undo a mistake' },
  /** Money. Seven years is the usual Indian record-keeping expectation. */
  financial: { days: 2555, why: 'financial records may be asked about for years' },
  /** Identity and health. Kept until asked for, never aged out. */
  keep: { days: null, why: 'identity and health records are not aged out' },
  /** Secrets. A deleted password should stop existing sooner, not later. */
  secret: { days: 7, why: 'a deleted credential should stop existing quickly' },
  /**
   * Where people have been. Deleted quickly, for the same reason as a secret:
   * a location history is a record of a family's movements, and a deleted one
   * that lingers ninety days is ninety days of it still on the device.
   *
   * This is only half of the answer. Retention governs *deletions*; it never
   * ages out a live row. What keeps the history short is
   * `domain/safety.js` → `expired()`, which the service calls on every write.
   */
  location: { days: 7, why: 'a family\'s movements should not linger once deleted' },
});

/** Entities whose records are financial, by the module they belong to. */
const FINANCIAL_MODULES = new Set(['finance', 'investments', 'insurance']);
const KEEP_MODULES = new Set(['identity', 'health']);
/** Where people have been, which nothing should hold on to. */
const LOCATION_MODULES = new Set(['safety']);

/**
 * Which policy applies to an entity.
 *
 * Derived from the module and the classification already in the schema, for
 * the same reason those are derived — 34 hand-assigned policies would drift.
 */
export function policyFor(entityName) {
  const owner = entities[entityName];
  if (!owner) return { name: 'standard', ...POLICIES.standard };

  // A secret outlives its usefulness the moment it is deleted, and every extra
  // day it sits in IndexedDB is a day it can be read off a stolen laptop.
  const hasSecret = owner.fields.some((f) => classify(f, owner) === 'CRITICAL_SECRET');
  if (hasSecret) return { name: 'secret', ...POLICIES.secret };

  if (LOCATION_MODULES.has(owner.module)) return { name: 'location', ...POLICIES.location };
  if (KEEP_MODULES.has(owner.module)) return { name: 'keep', ...POLICIES.keep };
  if (FINANCIAL_MODULES.has(owner.module)) return { name: 'financial', ...POLICIES.financial };
  return { name: 'standard', ...POLICIES.standard };
}

/** Every entity with the policy that governs it. */
export function schedule() {
  return Object.keys(entities).sort().map((name) => ({
    entity: name,
    module: entities[name].module,
    ...policyFor(name),
  }));
}

/**
 * Is this deleted record old enough to purge?
 *
 * A record that is not deleted is never eligible, whatever its age. Retention
 * governs how long a *deletion* is held open for second thoughts; it is not a
 * licence to remove things somebody still has.
 */
export function eligible(entityName, record, now = Date.now()) {
  if (!record?.deletedAt) return false;
  const policy = policyFor(entityName);
  if (policy.days === null) return false;

  const deletedAt = Date.parse(record.deletedAt);
  if (!Number.isFinite(deletedAt)) return false;
  return now - deletedAt >= policy.days * DAY;
}

/**
 * What could be purged right now, per entity, without purging any of it.
 *
 * Read-then-write, like every other destructive path in this codebase: a
 * household is shown the size of it before anything happens.
 */
export async function purgeable(db, now = Date.now()) {
  const rows = [];

  for (const name of Object.keys(entities)) {
    const policy = policyFor(name);
    if (policy.days === null) continue;

    const deleted = await db.repo(name)
      .list({ limit: 100_000, includeDeleted: true, decrypt: false })
      .catch(() => []);

    const ready = deleted.filter((r) => eligible(name, r, now));
    if (!ready.length) continue;

    rows.push({
      entity: name,
      policy: policy.name,
      days: policy.days,
      count: ready.length,
      ids: ready.map((r) => r.id),
      oldest: ready.map((r) => r.deletedAt).sort()[0] ?? null,
    });
  }

  return {
    entities: rows.sort((a, b) => b.count - a.count),
    total: rows.reduce((sum, r) => sum + r.count, 0),
    // Said with every plan, not buried in a document. A person about to erase
    // something is entitled to know what erasing does not reach.
    cannotReach: [
      'other devices — each keeps its own copy, and no device may order another to destroy data',
      'the backup spreadsheet’s revision history, which Google keeps',
      'anything already exported to a file',
      'Drive’s bin, for thirty days after a document was deleted',
    ],
  };
}

/**
 * Actually erase. Irreversible on this device.
 *
 * Ordering matters and is the same as everywhere else here: the search entry
 * goes with the row in one transaction, so an interrupted purge cannot leave a
 * search index pointing at a record that no longer exists.
 *
 * @param {(done: number, total: number) => void} [onProgress]
 * @returns {Promise<{purged: number, byEntity: Record<string, number>}>}
 */
export async function purge(db, plan, onProgress) {
  const byEntity = {};
  let purged = 0;
  const total = plan?.total ?? 0;

  for (const row of plan?.entities ?? []) {
    for (const id of row.ids) {
      await db.adapter.tx([row.entity, 'search'], 'readwrite', async (t) => {
        await t.delete(row.entity, id);
        // Defensive, and unreachable today: the soft delete that made this row
        // eligible already dropped its search entry, so by the time a purge
        // runs there is nothing here to remove. Mutation-testing confirmed it —
        // deleting this line breaks no test, because nothing observes it.
        //
        // It stays because the invariant it protects is "no search entry
        // outlives its row", and the only thing standing between that and a
        // dangling index today is one line in `repository.remove`. A future
        // path that hard-deletes without going through a soft delete first
        // would leave the index pointing at nothing.
        //
        // The exported helper, not a template string that happens to match it
        // today — a change to the key format must break in one place.
        await t.delete('search', indexKey(row.entity, id));
      });
      byEntity[row.entity] = (byEntity[row.entity] ?? 0) + 1;
      purged += 1;
      onProgress?.(purged, total);
    }
  }

  return { purged, byEntity };
}
