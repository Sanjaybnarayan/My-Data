/**
 * The database facade.
 *
 * Owns the adapter, the keyring, the current actor and the outbox sequence,
 * and hands out one repository per entity. Everything above the data layer
 * holds a `Database`, never an adapter, so no module can reach past the
 * permission and encryption checks by accident.
 */

import { openDatabase } from './migrations.js';
import { Repository } from './repository.js';
import { entities, entity, referenceFields, referencedIds,
} from './schema.js';
import { searchIndex, indexEntry } from './search.js';
import { Chain, verify as verifyChain } from './chain.js';
import { auditEntry, ACTIONS, historyOf, recentActivity } from './audit.js';
import { Keyring } from '../security/keyring.js';
import { deviceId as resolveDeviceId } from '../core/ids.js';
import { memoryStorage } from '../security/session.js';
import { AppError, PermissionError } from '../core/errors.js';
import { config } from '../core/config.js';

export class Database {
  #adapter = null;
  #repos = new Map();
  #actor = { personId: '', role: 'guest' };
  #seq = 0;
  #deviceId = '';
  keyring = null;

  /**
   * @param {{adapter?, name?, storage?, clock?: () => number,
   *          iterations?: number, currency?: string}} [options]
   */
  constructor(options = {}) {
    this.options = options;
  }

  get adapter() {
    if (!this.#adapter) throw new AppError('the database is not open', { code: 'not-open' });
    return this.#adapter;
  }

  get deviceId() { return this.#deviceId; }
  get actor() { return this.#actor; }

  async open() {
    const { adapter, name, storage = globalThis.localStorage ?? memoryStorage() } = this.options;
    this.#adapter = await openDatabase({ adapter, name });
    this.#deviceId = resolveDeviceId(storage);

    // One chain per device, so two phones appending offline do not read as a
    // broken log. `js/data/chain.js` says why at length.
    this.chain = new Chain(this.#adapter, this.#deviceId);

    this.keyring = new Keyring(
      { get: (k) => this.meta(k), set: (k, v) => this.setMeta(k, v) },
      this.options.iterations ?? config().pbkdf2Iterations,
    );

    // The outbox sequence continues from whatever is already queued, so a
    // reload cannot re-use a number and reorder two pending writes.
    const queued = await this.#adapter.query('outbox', { index: 'bySeq', direction: 'prev', limit: 1 });
    this.#seq = queued[0]?.seq ?? 0;

    return this;
  }

  close() {
    this.#adapter?.close();
    this.#adapter = null;
    this.#repos.clear();
  }

  /** Who the writes are attributed to, and whose permissions apply. */
  setActor(actor) {
    this.#actor = actor ?? { personId: '', role: 'guest' };
    return this.#actor;
  }

  nextSeq() {
    return ++this.#seq;
  }

  /** @returns {Repository} */
  repo(entityName) {
    if (!entities[entityName]) throw new AppError(`unknown entity "${entityName}"`, { code: 'unknown-entity' });
    let repo = this.#repos.get(entityName);
    if (!repo) {
      repo = new Repository(entityName, {
        adapter: this.adapter,
        keyring: this.keyring,
        actor: () => this.#actor,
        deviceId: this.#deviceId,
        chain: this.chain,
        nextSeq: () => this.nextSeq(),
        clock: this.options.clock,
        currency: this.options.currency ?? config().currency,
      });
      this.#repos.set(entityName, repo);
    }
    return repo;
  }

  /* ------------------------------------------------------------------ meta */

  async meta(key, fallback = null) {
    const row = await this.adapter.read('meta', key);
    return row ? row.value : fallback;
  }

  async setMeta(key, value) {
    await this.adapter.write('meta', { key, value, updatedAt: new Date().toISOString() });
    return value;
  }

  /* ----------------------------------------------------------------- audit */

  /**
   * What has happened to one record.
   *
   * Here rather than in a service because a service may not touch
   * `db.adapter` — the rule that keeps every row read through the permission
   * check — and the audit log has no repository to read it through: it is not
   * an entity and carries no per-row ACL. So the one place system stores are
   * reached stays this class, and the rule stays absolute.
   *
   * A caller has already been permitted to read the record itself; these are
   * entries about that record and nothing else.
   */
  async history(recordId, options) {
    return historyOf(this.adapter, recordId, options);
  }

  /** Recent entries across every record, for the activity feed. */
  async activity(options) {
    return recentActivity(this.adapter, options);
  }

  /* --------------------------------------------------------------- archive */

  /**
   * The system stores an archive carries, and puts back.
   *
   * Here for the same reason `history` and `activity` are here: a service may
   * not touch `db.adapter`, and `meta`, `audit` and `blobs` have no repository
   * to be read through — they are not entities and carry no per-row ACL. So
   * the one place system stores are reached stays this class.
   *
   * Owner only, and that is not belt-and-braces. These three stores are the
   * whole household with no row filter in front of them: `meta` holds the
   * keyring, `audit` holds every action anybody has taken, `blobs` holds the
   * documents. A `child` reading them through here would get their siblings'
   * papers, which is exactly the hole the service-layer rule exists to close.
   *
   * `search` is not offered: it is derived, and rebuilt as rows are written.
   */
  static ARCHIVE_STORES = Object.freeze(['meta', 'audit', 'blobs']);

  #assertOwner(action) {
    if (this.#actor?.role !== 'owner') {
      throw new PermissionError(action, 'archive', this.#actor?.role ?? 'anonymous');
    }
  }

  async systemStoreRows(store) {
    this.#assertOwner('read');
    if (!Database.ARCHIVE_STORES.includes(store)) {
      throw new AppError(`${store} is not an archived store`, { code: 'wrong-store' });
    }
    return this.adapter.query(store, {});
  }

  /**
   * Write system rows back, verbatim.
   *
   * Verbatim matters most for `meta`: it carries the keyring, and a restore
   * that re-derived anything there would produce a device whose wrapped key no
   * longer matches the envelopes in the records beside it. The archive's rows
   * become this device's rows or the restore is not one.
   */
  async writeSystemStoreRows(store, rows) {
    this.#assertOwner('write');
    if (!Database.ARCHIVE_STORES.includes(store)) {
      throw new AppError(`${store} is not an archived store`, { code: 'wrong-store' });
    }
    for (const row of rows) await this.adapter.write(store, row);
    return rows.length;
  }

  /* ---------------------------------------------------------------- search */

  async search(query, options) {
    return searchIndex(this.adapter, query, options);
  }

  /**
   * Rebuild the whole index. Needed after a bulk pull, and offered in Settings
   * for the case where an interrupted upgrade left it partial.
   */
  async reindex(onProgress) {
    let done = 0;
    const names = Object.keys(entities);
    await this.adapter.clear('search');
    for (const name of names) {
      const rows = await this.adapter.query(name, { filter: (r) => !r.deletedAt });
      for (const row of rows) await this.adapter.write('search', indexEntry(name, row));
      onProgress?.(++done, names.length, name);
    }
    return done;
  }

  /* ----------------------------------------------------- referential checks */

  /**
   * Every record pointing at `id`, across every entity. Used before a delete,
   * because a spreadsheet has no foreign keys and a dangling reference here is
   * a transaction attached to an account that no longer exists.
   */
  async referencedBy(id) {
    const found = [];
    for (const def of Object.values(entities)) {
      const refFields = referenceFields(def.name);
      if (!refFields.length) continue;
      const rows = await this.adapter.query(def.name, { filter: (r) => !r.deletedAt });
      for (const row of rows) {
        for (const f of refFields) {
          if (referencedIds(row, f).includes(id)) {
            found.push({ entity: def.name, id: row.id, field: f.key, title: def.title(row) });
          }
        }
      }
    }
    return found;
  }

  /**
   * References that point at nothing. Surfaced in Settings → Data health
   * rather than fixed silently, because the right repair is a judgement call.
   */
  async danglingReferences() {
    const broken = [];
    for (const def of Object.values(entities)) {
      const refFields = referenceFields(def.name);
      if (!refFields.length) continue;
      const rows = await this.adapter.query(def.name, { filter: (r) => !r.deletedAt });
      for (const row of rows) {
        for (const f of refFields) {
          for (const target of referencedIds(row, f)) {
            const exists = await this.adapter.read(f.ref, target);
            if (!exists) {
              broken.push({ entity: def.name, id: row.id, field: f.key, missing: target });
            }
          }
        }
      }
    }
    return broken;
  }

  /* ----------------------------------------------------------------- audit */

  async logAudit(action, detail = {}) {
    const linked = await this.chain.next(auditEntry({
      action, actor: this.#actor, deviceId: this.#deviceId, detail,
      entity: detail.entity, recordId: detail.recordId,
    }));
    try {
      await this.adapter.tx(['audit', 'meta'], 'readwrite', async (t) => {
        await t.put('audit', linked);
        await t.put('meta', this.chain.headRow());
      });
    } catch (error) {
      this.chain.reset();
      throw error;
    }
  }

  /**
   * Whether the audit trail still adds up.
   *
   * Reads every entry, so this is something a person asks for rather than
   * something a screen does on the way past.
   */
  async verifyAudit() {
    return verifyChain(await this.adapter.query('audit', {}));
  }

  /* --------------------------------------------------------------- counts */

  /** Row counts per entity, for the settings screen and the backup check. */
  async statistics() {
    const stats = {};
    for (const name of Object.keys(entities)) {
      const rows = await this.adapter.query(name, {});
      stats[name] = {
        label: entity(name).labels.many,
        total: rows.length,
        live: rows.filter((r) => !r.deletedAt).length,
        pending: rows.filter((r) => r.syncState === 'pending').length,
      };
    }
    const outbox = await this.adapter.query('outbox', {});
    stats._outbox = {
      label: 'Queued changes',
      total: outbox.length,
      pending: outbox.filter((o) => o.state === 'pending').length,
      failed: outbox.filter((o) => o.state === 'failed').length,
    };
    return stats;
  }
}

export { ACTIONS };
