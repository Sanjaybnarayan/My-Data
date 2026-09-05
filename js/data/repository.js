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
import { record as recordDiagnostic, KIND } from './diagnostics.js';
import {
  unresolved, refuseUnresolved, dependents, blocking, refuseBlocked,
} from './integrity.js';
import { assertCan, rowFilter } from '../security/rbac.js';
import { encryptRecord, decryptRecord, decryptMany } from '../security/fieldcrypto.js';
import { newId } from '../core/ids.js';
import { AppError } from '../core/errors.js';
import { bus, TOPIC } from '../core/bus.js';

/**
 * Which diagnostic kind a thrown error belongs to.
 *
 * Separate and named so the three-way decision can be tested without a
 * database — it used to be a ternary inside a catch block, where the only way
 * to exercise it was to make a real write fail in a real way.
 *
 * @param {{name?: string, code?: string}} error
 */
export function diagnosticKind(error) {
  if (error?.code === 'storage') return KIND.storage;
  // `'permission'`, not `'forbidden'`. `PermissionError` in `core/errors.js`
  // has always carried `code: 'permission'` and nothing in this application
  // has ever produced `'forbidden'` — so this branch could not fire, and every
  // permission refusal was filed as a fault instead.
  //
  // Measured: a staff member opening a colleague's record and then trying to
  // enter a transaction wrote two diagnostics, both `kind=error`. `KIND.refusal`
  // says of itself "a rule refused something. Not a fault" — which is exactly
  // what those two were, on a shared family device where a child or an
  // employee meets the access rules as a matter of routine.
  //
  // `assistant.js` and `reports/build.js` both test `code === 'permission'`
  // and always have. Three places ask the same question; two had the answer.
  if (error?.name === 'ValidationError' || error?.code === 'permission') return KIND.refusal;
  return KIND.error;
}

/** Fields the application owns and a caller may never set directly. */
const ENVELOPE_KEYS = ['id', 'rev', 'createdAt', 'updatedAt', 'createdBy',
  'updatedBy', 'deletedAt', 'origin', 'schemaVersion', 'syncState', 'heldAt'];

export class Repository {
  #ctx;
  #name;
  #def;

  /**
   * @param {string} entityName
   * @param {{adapter, keyring, actor: () => object, deviceId: string,
   *          chain: import('./chain.js').Chain,
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

  /**
   * @param {string} id
   * @param {{includeDeleted?: boolean, logRead?: boolean}} [options]
   * @returns {Promise<object|null>} decrypted, or null when absent or deleted
   *
   * `logRead: false` says **this is not a person opening the record**, and it
   * is the only thing it says. Permission is still checked, decryption still
   * happens, the caller still gets the whole record — what is withheld is the
   * `read` entry in the audit log, because the log's claim is that somebody
   * looked at a vault item, and a lookup made to put that item's *name* on a
   * log line is not somebody looking at it.
   *
   * Left on by default and passed by exactly one caller, which a test pins.
   * The guarantee "opening a secret is recorded" is only worth what the list
   * of exceptions is worth, so the list is checked rather than trusted.
   */
  async get(id, { includeDeleted = false, logRead = true } = {}) {
    const raw = await this.#ctx.adapter.read(this.#name, id);
    if (!raw) return null;
    if (raw.deletedAt && !includeDeleted) return null;

    assertCan(this.#actor(), 'read', this.#name, raw);
    const record = upgradeRecord(this.#name, raw);
    const out = await decryptRecord(this.#name, record, this.#ctx.keyring.key);

    if (logRead && shouldLogRead(this.#name)) {
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
    return this.#attempt('create', async () => {
      const planned = await this.stageCreate(input);
      await this.#run(planned);
      return planned.record;
    });
  }

  /**
   * Create a record unless one already matches an index query — in one step.
   *
   * "Look it up, and write it if it is not there" is two transactions when it
   * is written as `list()` then `create()`, and everything between them is a
   * window. Two tabs capturing the same bank alert both looked, both found
   * nothing, and both wrote:
   *
   *     A why: stored
   *     B why: stored
   *     smsMessage rows: 2          (one message should give 1)
   *
   * `services/sms.js` says in its own words why that matters — "two rows for
   * one alert would make the evidence look like two events" — so the dedupe
   * was written for exactly the case it could not handle.
   *
   * The lookup happens inside the writing transaction here, so no other tab
   * can be between the two. IndexedDB serialises overlapping readwrite
   * transactions on the same store, which is the property this depends on and
   * which `MemoryAdapter.tx` now honours too.
   *
   * The record comes back through `get()` rather than raw from the cursor when
   * one already existed: the caller is owed a decrypted, permission-filtered
   * record, and the row inside the transaction is neither.
   *
   * `accept` decides which existing rows count. It defaults to all of them,
   * and exists because "already here" is not always "any row with this key":
   * a revoked device re-enrolling needs a new row, and matching its old one
   * would refuse it silently.
   *
   * @param {object} input
   * @param {{index: string, only: unknown, accept?: (row: object) => boolean}} match
   *   the index, the key, and which existing rows count as already present
   * @returns {Promise<{record: object|null, created: boolean}>}
   */
  async createUnlessPresent(input, { index, only, accept = () => true }) {
    return this.#attempt('create', async () => {
      const planned = await this.stageCreate(input);
      const stores = planned.stores.includes(this.#name)
        ? planned.stores
        : [this.#name, ...planned.stores];

      let outcome;
      try {
        outcome = await this.#ctx.adapter.tx(stores, 'readwrite', async (t) => {
          // No `limit`: `accept` has to see them all, and an index key that
          // matches many rows is not a shape this is for.
          const found = (await t.getAll(this.#name, { index, range: { only } })) ?? [];
          const match = found.find(accept);
          if (match) return { id: match.id, created: false };
          await planned.apply(t);
          return { id: planned.record.id, created: true };
        });
      } catch (error) {
        // Same as `#run`: planning advanced the chain head and nothing was
        // written, so forget it and re-read the committed one next time.
        this.#ctx.chain.reset();
        throw error;
      }

      if (!outcome.created) {
        // And the same on the path that writes nothing *deliberately*. The
        // head advanced when the entry was planned either way, and an audit
        // chain that counts an entry nobody wrote is a chain that will not
        // verify.
        this.#ctx.chain.reset();
        return { record: await this.get(outcome.id), created: false };
      }

      planned.emit();
      return { record: planned.record, created: true };
    });
  }

  /**
   * Run a write, and record it if it fails.
   *
   * Wrapping the whole public method rather than only the transaction,
   * because most failures never reach the transaction: a permission refusal, a
   * validation error and a dangling reference all throw while the write is
   * still being prepared. An earlier version recorded only in `#run` and a
   * test caught that it saw none of them — the same blind spot a mutation
   * found in the audit chain an hour earlier, in the same file.
   *
   * The error is always rethrown. This makes a failure visible afterwards; it
   * never makes one disappear.
   */
  async #attempt(what, fn) {
    try {
      return await fn();
    } catch (error) {
      await recordDiagnostic(this.#ctx.adapter, {
        // A rule saying no is not a fault. Telling the two apart matters:
        // a run of refusals means somebody is fighting the application, and a
        // run of errors means the application is broken.
        //
        // And a full disk is neither. `KIND.storage` existed, was documented as
        // "the device is running out of room", and **nothing could ever
        // produce one** — every `StorageError` from `idb.js` arrived here and
        // was filed as a generic error. The summary groups by kind, so the
        // category was always empty and a household out of room read as an
        // application that was broken. The two are fixed by different people
        // doing different things.
        kind: diagnosticKind(error),
        where: `repository.${what}`,
        entity: this.#name,
        code: error?.code ?? error?.name ?? '',
        message: error?.message ?? '',
      });
      throw error;
    }
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
  /**
   * Does this row exist and is it still here?
   *
   * A soft-deleted row does not count. Pointing at a record somebody threw
   * away is the same dangling reference as pointing at one that never was,
   * and it is the more common way to arrive at one.
   */
  #exists = async (entityName, id, pending = null) => {
    // A row staged earlier in the same unit of work counts. Recording a
    // payment and the economic event it belongs to is one act, and the event
    // has to point at a transaction that is not written yet — which is what a
    // relational database calls a deferred constraint and what this is.
    if (pending?.has?.(`${entityName}:${id}`)) return true;
    const row = await this.#ctx.adapter.read(entityName, id);
    return Boolean(row) && !row.deletedAt;
  };

  #rowsOf = async (entityName) => this.#ctx.adapter.query(entityName, {});

  /** Refuse a write whose references name nothing. */
  async #assertReferencesResolve(record, pending) {
    const bad = await unresolved(this.#name, record,
      (entityName, id) => this.#exists(entityName, id, pending));
    if (bad.length) throw refuseUnresolved(this.#name, bad);
  }

  async stageCreate(input, { pending = null } = {}) {
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
    await this.#assertReferencesResolve(record, pending);

    return this.plan({ record, before: null, action: ACTIONS.create });
  }

  /**
   * Patch semantics: only the keys present are touched. A form sends the whole
   * record and gets the same result, but a widget toggling one checkbox does
   * not have to round-trip the rest and risk clobbering another device's edit.
   */
  async update(id, patch) {
    return this.#attempt('update', async () => {
      const planned = await this.stageUpdate(id, patch);
      await this.#run(planned);
      return planned.record;
    });
  }

  /** An update, prepared and not written. See `stageCreate`. */
  async stageUpdate(id, patch, { pending = null } = {}) {
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
    await this.#assertReferencesResolve(record, pending);

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
    return this.#attempt('remove', async () => {
      const planned = await this.stageRemove(id);
      if (!planned) return false;
      await this.#run(planned);
      return true;
    });
  }

  /** A soft delete, prepared and not written. `null` when there is no such row. */
  async stageRemove(id) {
    const actor = this.#actor();
    const existing = await this.#ctx.adapter.read(this.#name, id);
    if (!existing) return null;
    assertCan(actor, 'write', this.#name, existing);

    // RESTRICT, never CASCADE. Deleting a person does not delete their
    // transactions: cascading through a household's financial records because
    // somebody tidied a contact is data loss with a plausible explanation.
    // An *optional* reference is left to dangle-by-design — the schema
    // already says that field may be empty — and only a required one blocks.
    const blocked = blocking(await dependents(this.#name, id, this.#rowsOf));
    if (blocked.length) throw refuseBlocked(this.#name, blocked);

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

  /**
   * Mark a row as held, or release it. Envelope only.
   *
   * No outbox, no audit, no validation, for the same reason `applyRemote` has
   * none: this is not somebody editing a record. It is the sync engine saying
   * whether what the row names has arrived yet, and pushing that back to the
   * server would send every device a fact about this device's own inbox.
   */
  async setHeld(id, heldAt) {
    const existing = await this.#ctx.adapter.read(this.#name, id);
    if (!existing) return null;
    if ((existing.heldAt ?? null) === (heldAt ?? null)) return existing;

    const stored = { ...existing, heldAt: heldAt ?? null };
    await this.#ctx.adapter.tx([this.#name], 'readwrite', async (t) => {
      await t.put(this.#name, stored);
    });
    bus.emit(`${TOPIC.dataChanged}:${this.#def.module}`, {
      entity: this.#name, id, action: 'remote',
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
   *                    emit: () => void, record: object, entity: string}>}
   */
  async plan({ record, before, action, existingRaw = null }) {
    const sealed = await encryptRecord(this.#name, record, this.#ctx.keyring.key);
    const fields = changedFields(before, record);

    // Linked here rather than at apply time, because `plan` is awaited in
    // order and `apply` is not — two entries hashed against the same head
    // would fork the chain and read as an insertion.
    const audit = await this.#ctx.chain.next(auditEntry({
      action, entity: this.#name, recordId: record.id, actor: this.#actor(),
      fields, deviceId: this.#ctx.deviceId, at: record.updatedAt,
    }));

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
      // In the same transaction as the entry. A head that outlives a
      // rolled-back write would point at an entry nobody has, and the next
      // one would chain to nothing.
      await t.put('meta', this.#ctx.chain.headRow());
      await t.put('outbox', outbox);
    };

    const emit = () => bus.emit(`${TOPIC.dataChanged}:${this.#def.module}`, {
      entity: this.#name, id: record.id, action, fields,
    });

    return {
      stores: [this.#name, 'search', 'audit', 'outbox', 'shadow', 'meta'],
      apply,
      emit,
      record,
      // Named rather than inferred from `stores[0]`. A unit of work needs to
      // know what a staged row *is* to let the next one reference it, and
      // reading that off the first element of a list is the kind of coupling
      // that survives until somebody reorders the list.
      entity: this.#name,
    };
  }

  /** Run one prepared write, on its own, in its own transaction. */
  async #run(planned) {
    try {
      await this.#ctx.adapter.tx(planned.stores, 'readwrite', planned.apply);
    } catch (error) {
      // The head advanced when the entry was planned. Nothing was written, so
      // forget it and re-read the committed one next time.
      this.#ctx.chain.reset();
      // Not recorded here: `#attempt` wraps every public write and would
      // otherwise log the same failure twice, which would make one bad night
      // look like two.
      throw error;
    }
    planned.emit();
  }

  async #writeAudit(entry) {
    const linked = await this.#ctx.chain.next(entry);
    try {
      await this.#ctx.adapter.tx(['audit', 'meta'], 'readwrite', async (t) => {
        await t.put('audit', linked);
        await t.put('meta', this.#ctx.chain.headRow());
      });
    } catch (error) {
      this.#ctx.chain.reset();
      throw error;
    }
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
  // Comma-separated keys, in order of precedence: `-pinned,-updatedAt` is
  // "pinned first, then newest". One key was enough until a `pinned` flag
  // needed to survive a date sort, and a screen that sorted by pin alone would
  // put a note pinned in March above one edited this morning.
  const keys = String(spec ?? '').split(',').map((one) => one.trim()).filter(Boolean);

  return [...rows].sort((a, b) => {
    for (const one of keys) {
      const desc = one.startsWith('-');
      const key = desc ? one.slice(1) : one;
      const x = a[key];
      const y = b[key];
      const xEmpty = x === undefined || x === null || x === '';
      const yEmpty = y === undefined || y === null || y === '';
      if (xEmpty && yEmpty) continue;
      // An empty value sorts last whichever direction the key runs: "no date"
      // is not "the earliest date", and flipping it would put every blank at
      // the top of a descending list.
      if (xEmpty) return 1;
      if (yEmpty) return -1;
      const c = typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y));
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  });
}

export { prefixFor as _prefixFor };
