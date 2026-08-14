/**
 * The repository.
 *
 * One instance per entity, all the same code. A write does six things and they
 * either all happen or none of them do:
 *
 *   permission → validate → encrypt → { record, search index, audit, outbox }
 *
 * The last four are one IndexedDB transaction. That is the single most
 * important property in the data layer: there is no window in which a record
 * exists but its outbox entry does not, so a crash between them cannot produce
 * a change that never syncs — the failure mode that makes offline-first
 * applications quietly lose data for months.
 *
 * Reads are always local and never touch the network.
 */

import { entity } from './schema.js';
import { validateOrThrow } from './validate.js';
import { upgradeRecord } from './migrations.js';
import { indexEntry, indexKey } from './search.js';
import { auditEntry, changedFields, ACTIONS, shouldLogRead } from './audit.js';
import { assertCan, rowFilter } from '../security/rbac.js';
import { encryptRecord, decryptRecord, decryptMany } from '../security/fieldcrypto.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { bus, TOPIC } from '../core/bus.js';

/** Fields the application owns and a caller may never set directly. */
const ENVELOPE_KEYS = ['id', 'rev', 'createdAt', 'updatedAt', 'createdBy',
  'updatedBy', 'deletedAt', 'origin', 'schemaVersion', 'syncState'];

export class Repository {
  #ctx;
  #name;
  #def;

  /**
   * @param {string} entityName
   * @param {{adapter, keyring, actor: () => object, deviceId: string,
   *          nextSeq: () => number, clock?: () => number, currency?: string}} ctx
   */
  constructor(entityName, ctx) {
    this.#name = entityName;
    this.#def = entity(entityName);
    this.#ctx = ctx;
  }

  get name() { return this.#name; }
  get definition() { return this.#def; }

  #now() {
    return new Date(this.#ctx.clock?.() ?? Date.now()).toISOString();
  }

  #actor() {
    return this.#ctx.actor();
  }

  /* ------------------------------------------------------------------ read */

  /** @returns {Promise<object|null>} decrypted, or null when absent or deleted */
  async get(id, { includeDeleted = false } = {}) {
    const raw = await this.#ctx.adapter.read(this.#name, id);
    if (!raw) return null;
    if (raw.deletedAt && !includeDeleted) return null;

    assertCan(this.#actor(), 'read', this.#name, raw);
    const record = upgradeRecord(this.#name, raw);
    const out = await decryptRecord(this.#name, record, this.#ctx.keyring.key);

    if (shouldLogRead(this.#name)) {
      await this.#writeAudit(auditEntry({
        action: ACTIONS.read, entity: this.#name, recordId: id,
        actor: this.#actor(), deviceId: this.#ctx.deviceId, at: this.#now(),
      }));
    }
    return out;
  }

  /**
   * @param {{index?, range?, direction?, limit?, offset?, filter?,
   *          includeDeleted?, sort?, decrypt?}} [query]
   *
   * `decrypt: false` skips the per-record crypto — used by list views that
   * only show clear fields, where decrypting five hundred rows to render
   * twenty of them is pure cost.
   */
  async list(query = {}) {
    const {
      includeDeleted = false, sort = this.#def.sort, decrypt = true, ...rest
    } = query;

    const actor = this.#actor();
    const permitted = rowFilter(actor, this.#name);
    const userFilter = rest.filter;

    const rows = await this.#ctx.adapter.query(this.#name, {
      ...rest,
      filter: (record) => {
        if (!includeDeleted && record.deletedAt) return false;
        if (!permitted(record)) return false;
        return userFilter ? userFilter(record) : true;
      },
    });

    const upgraded = rows.map((r) => upgradeRecord(this.#name, r));
    const sorted = sort ? sortBy(upgraded, sort) : upgraded;
    return decrypt ? decryptMany(this.#name, sorted, this.#ctx.keyring.key) : sorted;
  }

  async count(query = {}) {
    const rows = await this.list({ ...query, decrypt: false, limit: Infinity });
    return rows.length;
  }

  /** Records referencing `id` through any `ref` field, across all entities. */
  async referencedBy(_id) {
    throw new AppError('use Database.referencedBy — it spans entities', { code: 'wrong-layer' });
  }

  /* ----------------------------------------------------------------- write */

  async create(input) {
    const planned = await this.stageCreate(input);
    await this.#run(planned);
    return planned.record;
  }

  /**
   * A create, prepared and not written.
   *
   * Every check a `create` makes has already happened by the time this returns
   * — permission, validation, the row-level check on the finished record — so
   * staging cannot defer a refusal to commit time. That matters for a unit of
   * work: the whole point is that the second operation failing must not leave
   * the first one written, and a refusal discovered late is a refusal
   * discovered after the first write went in.
   */
  async stageCreate(input) {
    const actor = this.#actor();
    assertCan(actor, 'write', this.#name);

    const clean = validateOrThrow(this.#name, strip(input), { currency: this.#ctx.currency });
    const now = this.#now();
    const record = {
      ...clean,
      id: input.id ?? newId(prefixFor(this.#name)),
      rev: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor.personId ?? '',
      updatedBy: actor.personId ?? '',
      deletedAt: null,
      origin: this.#ctx.deviceId,
      schemaVersion: this.#def.version,
      syncState: 'pending',
    };

    // The row-level check needs the finished record: a child creating a task
    // for themselves is allowed, for a sibling is not.
    assertCan(actor, 'write', this.#name, record);

    return this.plan({ record, before: null, action: ACTIONS.create });
  }

  /**
   * Patch semantics: only the keys present are touched. A form sends the whole
   * record and gets the same result, but a widget toggling one checkbox does
   * not have to round-trip the rest and risk clobbering another device's edit.
   */
  async update(id, patch) {
    const planned = await this.stageUpdate(id, patch);
    await this.#run(planned);
    return planned.record;
  }

  /** An update, prepared and not written. See `stageCreate`. */
  async stageUpdate(id, patch) {
    const actor = this.#actor();
    const existing = await this.#ctx.adapter.read(this.#name, id);
    if (!existing) throw new AppError(`no ${this.#name} with id ${id}`, { code: 'not-found' });
    assertCan(actor, 'write', this.#name, existing);

    const current = await decryptRecord(
      this.#name, upgradeRecord(this.#name, existing), this.#ctx.keyring.key,
    );
    const merged = { ...current, ...strip(patch) };
    const clean = validateOrThrow(this.#name, merged, { currency: this.#ctx.currency });

    const record = {
      ...clean,
      id,
      rev: (existing.rev ?? 1) + 1,
      createdAt: existing.createdAt,
      createdBy: existing.createdBy,
      updatedAt: this.#now(),
      updatedBy: actor.personId ?? '',
      deletedAt: existing.deletedAt ?? null,
      origin: this.#ctx.deviceId,
      schemaVersion: this.#def.version,
      syncState: 'pending',
    };
    assertCan(actor, 'write', this.#name, record);

    return this.plan({
      record, before: current, action: ACTIONS.update, existingRaw: existing,
    });
  }

  /**
   * Soft delete. The row stays, `deletedAt` is stamped, and the deletion
   * replicates like any other change — a device that has been offline for a
   * month learns about it instead of resurrecting the record on its next push.
   */
  async remove(id) {
    const planned = await this.stageRemove(id);
    if (!planned) return false;
    await this.#run(planned);
    return true;
  }

  /** A soft delete, prepared and not written. `null` when there is no such row. */
  async stageRemove(id) {
    const actor = this.#actor();
    const existing = await this.#ctx.adapter.read(this.#name, id);
    if (!existing) return null;
    assertCan(actor, 'write', this.#name, existing);

    const record = {
      ...existing,
      rev: (existing.rev ?? 1) + 1,
      deletedAt: this.#now(),
      updatedAt: this.#now(),
      updatedBy: actor.personId ?? '',
      origin: this.#ctx.deviceId,
      syncState: 'pending',
    };
    return this.plan({
      record, before: existing, action: ACTIONS.delete, existingRaw: existing,
    });
  }

  async restore(id) {
    const actor = this.#actor();
    const existing = await this.#ctx.adapter.read(this.#name, id);
    if (!existing) return false;
    assertCan(actor, 'write', this.#name, existing);

    const record = {
      ...existing,
      rev: (existing.rev ?? 1) + 1,
      deletedAt: null,
      updatedAt: this.#now(),
      updatedBy: actor.personId ?? '',
      origin: this.#ctx.deviceId,
      syncState: 'pending',
    };
    await this.#run(await this.plan({
      record, before: existing, action: ACTIONS.restore, existingRaw: existing,
    }));
    return true;
  }

  /**
   * Apply a record that came from the server. Skips validation, permissions
   * and the outbox — it is already authoritative, and re-queueing it would
   * bounce the same row between two devices forever.
   */
  async applyRemote(record) {
    const stored = { ...record, syncState: 'synced' };
    await this.#ctx.adapter.tx([this.#name, 'search'], 'readwrite', async (t) => {
      await t.put(this.#name, stored);
      if (stored.deletedAt) {
        await t.delete('search', indexKey(this.#name, stored.id));
      } else {
        await t.put('search', indexEntry(this.#name, stored));
      }
    });
    bus.emit(`${TOPIC.dataChanged}:${this.#def.module}`, {
      entity: this.#name, id: stored.id, action: 'remote',
    });
    return stored;
  }

  /* ---------------------------------------------------------------- commit */

  /**
   * Everything a write needs, prepared but not written.
   *
   * Split out of the commit path so that several writes across several entities can
   * share one transaction — see `data/unit.js`. Nothing here touches the
   * database: it encrypts, works out what changed, and builds the audit and
   * outbox rows, leaving a plan somebody else decides when to run.
   *
   * The split is exact. A single write is now this followed by `#run`, so it
   * goes through the same code it always did.
   *
   * @returns {Promise<{stores: string[], apply: (t: object) => Promise<void>,
   *                    emit: () => void, record: object}>}
   */
  async plan({ record, before, action, existingRaw = null }) {
    const sealed = await encryptRecord(this.#name, record, this.#ctx.keyring.key);
    const fields = changedFields(before, record);

    const audit = auditEntry({
      action, entity: this.#name, recordId: record.id, actor: this.#actor(),
      fields, deviceId: this.#ctx.deviceId, at: record.updatedAt,
    });

    const outbox = {
      id: newId('obx'),
      seq: this.#ctx.nextSeq(),
      op: action === ACTIONS.delete ? 'delete' : 'put',
      store: this.#name,
      recordId: record.id,
      rev: record.rev,
      payload: sealed,
      attempts: 0,
      nextAttemptAt: 0,
      state: 'pending',
      queuedAt: record.updatedAt,
      lastError: '',
    };

    const apply = async (t) => {
      // The first local edit to a synced record snapshots what the server
      // last agreed to. That snapshot is the base of the three-way merge if
      // another device edits the same row before this one is pushed.
      if (existingRaw && existingRaw.syncState === 'synced') {
        const shadowId = `${this.#name}:${record.id}`;
        if (!(await t.get('shadow', shadowId))) {
          await t.put('shadow', {
            id: shadowId, store: this.#name, recordId: record.id, record: existingRaw,
          });
        }
      }

      await t.put(this.#name, sealed);
      if (record.deletedAt) {
        await t.delete('search', indexKey(this.#name, record.id));
      } else {
        // The index is built from the *clear* record: `indexEntry` already
        // excludes encrypted fields, and indexing ciphertext would be
        // meaningless anyway.
        await t.put('search', indexEntry(this.#name, record));
      }
      await t.put('audit', audit);
      await t.put('outbox', outbox);
    };

    const emit = () => bus.emit(`${TOPIC.dataChanged}:${this.#def.module}`, {
      entity: this.#name, id: record.id, action, fields,
    });

    return {
      stores: [this.#name, 'search', 'audit', 'outbox', 'shadow'],
      apply,
      emit,
      record,
    };
  }

  /** Run one prepared write, on its own, in its own transaction. */
  async #run(planned) {
    await this.#ctx.adapter.tx(planned.stores, 'readwrite', planned.apply);
    planned.emit();
  }

  async #writeAudit(entry) {
    await this.#ctx.adapter.write('audit', entry);
  }
}

/* ----------------------------------------------------------------- helpers */

function strip(input) {
  const out = { ...input };
  for (const key of ENVELOPE_KEYS) delete out[key];
  return out;
}

/** `txn`, `veh`, `pol` — a readable prefix, derived not enumerated. */
function prefixFor(entityName) {
  const consonants = entityName.replace(/[aeiou]/gi, '');
  return (consonants.length >= 3 ? consonants : entityName).slice(0, 3).toLowerCase();
}

/** `'-date'` sorts descending; `'date'` ascending. Blank values sort last. */
export function sortBy(rows, spec) {
  const desc = spec.startsWith('-');
  const key = desc ? spec.slice(1) : spec;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    const xEmpty = x === undefined || x === null || x === '';
    const yEmpty = y === undefined || y === null || y === '';
    if (xEmpty && yEmpty) return 0;
    if (xEmpty) return 1;
    if (yEmpty) return -1;
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y));
    return desc ? -c : c;
  });
}

export { prefixFor as _prefixFor };
