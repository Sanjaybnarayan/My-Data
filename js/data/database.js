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
import { entities, entity } from './schema.js';
import { searchIndex, indexEntry } from './search.js';
import { auditEntry, ACTIONS } from './audit.js';
import { Keyring } from '../security/keyring.js';
import { deviceId as resolveDeviceId } from '../core/ids.js';
import { memoryStorage } from '../security/session.js';
import { AppError } from '../core/errors.js';
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
      const refFields = def.fields.filter((f) => f.type === 'ref' || f.type === 'multiref');
      if (!refFields.length) continue;
      const rows = await this.adapter.query(def.name, { filter: (r) => !r.deletedAt });
      for (const row of rows) {
        for (const f of refFields) {
          const value = row[f.key];
          const hit = f.type === 'multiref'
            ? Array.isArray(value) && value.includes(id)
            : value === id;
          if (hit) found.push({ entity: def.name, id: row.id, field: f.key, title: def.title(row) });
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
      const refFields = def.fields.filter((f) => f.type === 'ref' || f.type === 'multiref');
      if (!refFields.length) continue;
      const rows = await this.adapter.query(def.name, { filter: (r) => !r.deletedAt });
      for (const row of rows) {
        for (const f of refFields) {
          const targets = f.type === 'multiref' ? (row[f.key] ?? []) : [row[f.key]].filter(Boolean);
          for (const target of targets) {
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
    await this.adapter.write('audit', auditEntry({
      action, actor: this.#actor, deviceId: this.#deviceId, detail,
      entity: detail.entity, recordId: detail.recordId,
    }));
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
