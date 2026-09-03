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
import { danglingIn } from './integrity.js';
import { rowFilter, readScope } from '../security/rbac.js';
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

  /**
   * Take a marker, if nobody else holds it for this value. True if we won.
   *
   * `meta` and `setMeta` are two transactions, so "read it, decide, write it"
   * has a window between the read and the write, and everything the caller
   * does in between widens it. `runAutomations` reads its marker at the top of
   * the run and writes it at the bottom, with the whole run in between — two
   * browser tabs of the same household opening together both read yesterday,
   * both decide the day is theirs, and both do the work. Measured: a repeating
   * task bred a second copy, which is what the test guarding the serial case
   * says must not happen.
   *
   * A single `readwrite` transaction closes it. IndexedDB serialises
   * overlapping readwrite transactions scoped to the same store, so the read
   * and the write are one step as far as any other tab is concerned.
   *
   * **The cost, stated rather than discovered:** the marker is taken *before*
   * the work rather than after, so a run that fails halfway has still spent
   * the day. That is the better of the two failures. A missed day corrects
   * itself on the next launch — the payment is still due, the task still needs
   * repeating — while a duplicate is a record a household has to find and
   * delete.
   */
  /**
   * Read a marker, or write this one and take it — and say which happened.
   *
   * `claimMeta` answers "is the day mine"; this answers "what does everybody
   * now agree is here", which is what a caller needs when the marker is a
   * *value* rather than a flag. The loser is handed the winner's value rather
   * than its own, so two callers end up using one thing.
   *
   * The value is computed by the caller *before* this is called, and that is
   * not a style choice: a real IndexedDB transaction closes when the microtask
   * queue drains with no request pending, so awaiting WebCrypto inside one
   * would end the transaction underneath it. Generate first, claim second.
   *
   * @returns {Promise<{won: boolean, value: unknown}>}
   */
  async claimMetaValue(key, value) {
    return this.adapter.tx(['meta'], 'readwrite', async (t) => {
      const row = await t.get('meta', key);
      if (row) return { won: false, value: row.value };
      await t.put('meta', { key, value, updatedAt: new Date().toISOString() });
      return { won: true, value };
    });
  }

  async claimMeta(key, value) {
    return this.adapter.tx(['meta'], 'readwrite', async (t) => {
      const row = await t.get('meta', key);
      if (row?.value === value) return false;
      await t.put('meta', { key, value, updatedAt: new Date().toISOString() });
      return true;
    });
  }

  /* ----------------------------------------------------- chat attachments */

  /**
   * Sealed attachment bytes.
   *
   * On the database rather than reached through `adapter` by a service,
   * because `tests/services.test.mjs` forbids a service touching the adapter
   * — the repository is where `assertCan` and `rowFilter` live, and a service
   * that went round it would return rows its caller may not see. `attachments`
   * has no repository, so it gets an accessor here for the same reason `meta`
   * has one.
   */
  async attachment(id) {
    return this.adapter.read('attachments', id);
  }

  async putAttachment(row) {
    await this.adapter.write('attachments', row);
    return row;
  }

  /** Every attachment belonging to a message, for withdrawing one. */
  async attachmentsFor(messageId) {
    return this.adapter.query('attachments', {
      index: 'byMessage', range: { only: messageId },
    });
  }

  async removeAttachment(id) {
    await this.adapter.remove('attachments', id);
  }

  /**
   * How much sealed attachment data this device is holding.
   *
   * Counted from the rows rather than from a running total kept somewhere: a
   * stored total and the rows it describes are two facts that drift, and the
   * one a settings screen shows should be the one that is true.
   */
  async attachmentUsage() {
    const rows = await this.adapter.query('attachments', {});
    return {
      count: rows.length,
      bytes: rows.reduce((sum, row) => sum + (Number(row.bytes) || 0), 0),
    };
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

  /**
   * Search, filtered by who is asking.
   *
   * `searchIndex` reads the `search` store through the adapter, which is the
   * one read path in this application that does not go through `Repository` —
   * so it never met `rowFilter`, and the box on the app shell answered
   * questions the record itself refuses. Measured on one device:
   *
   *     child repo('healthRecord').list()  →  0 rows
   *     child db.search('psychiatry')      →  1 hit, with the title
   *
   * The index denormalises `title` and `subtitle` so a result can be drawn
   * without a second read, which means a hit leaks the content of the field,
   * not merely that a record exists. `js/security/rbac.js` names this exact
   * case: "a shared family device does not expose one sibling's records to
   * another."
   *
   * The rule is not restated here. Each hit is checked with the same
   * `rowFilter` the repository uses, against the record itself — two copies of
   * an authorisation rule is two places for it to drift.
   */
  async search(query, options = {}) {
    const { limit = 30, ...rest } = options;
    // Over-fetched, then trimmed. Filtering after a `limit` would let another
    // person's records fill all twelve slots and leave somebody searching for
    // their own with nothing — the index ranks over every record on the
    // device, and on a shared one most of them belong to somebody else.
    const hits = await searchIndex(this.adapter, query, { ...rest, limit: limit * 5 });

    const out = [];
    for (const hit of hits) {
      if (out.length >= limit) break;
      if (await this.#mayRead(hit)) out.push(hit);
    }
    return out;
  }

  /** Whether the signed-in actor may read the record behind one hit. */
  async #mayRead(hit) {
    let permitted;
    try {
      permitted = rowFilter(this.#actor, hit.entity);
    } catch {
      // An index row for an entity the schema no longer has. Refused rather
      // than shown: nothing can say who it belongs to.
      return false;
    }
    const record = await this.adapter.read(hit.entity, hit.recordId).catch(() => null);
    // Deleted rows are dropped from the index on write and skipped by
    // `reindex`, so this is belt and braces rather than the main defence.
    if (!record || record.deletedAt) return false;
    return permitted(record);
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
   *
   * ## Why this delegates rather than walks
   *
   * It used to be its own walk, and it **disagreed with the write path about
   * what "exists" means.**
   *
   *     the write path   Boolean(row) && !row.deletedAt   a deleted row is gone
   *     this walk        Boolean(row)                     a deleted row is here
   *
   * A deletion in this application is a *marker that replicates* — Settings
   * says so on the same screen as this button. So the case is not exotic: a
   * person deleted on another device arrives here as a soft-deleted row, and
   * every document filed under them now points at something the write path
   * would refuse. Measured, exactly that:
   *
   *     the button on Settings reports : 0 broken references
   *     the write path would refuse it : true
   *
   * The household was told *"Every reference points at a record that exists"*
   * about a document whose owner had been deleted — a false reassurance on
   * precisely the scenario this audit exists for, since local writes are
   * checked and sync is not.
   *
   * `integrity.js#danglingIn` is the audit half of the same module the write
   * path uses, and it was written for this and had **no caller**. Delegating
   * to it with the write path's own predicate leaves one definition of a
   * broken reference instead of two.
   */
  async danglingReferences() {
    return danglingIn(this.#everyRow, this.#pointsAtSomething, this.#absenceMeansSomething);
  }

  /**
   * The same audit, over a named set of rows rather than the whole database.
   *
   * For the end of a pull. Scanning every row after every sync would make the
   * cost of the check grow with the household's history while the thing it is
   * looking for grows with the size of the pull, and a check that gets slower
   * forever is a check somebody eventually turns off.
   *
   * The predicate is the database's, not the pull's: a reference is satisfied
   * by any row this device holds, whether it arrived in this batch or was
   * already here. Only the rows *examined* are narrowed.
   *
   * @param {Map<string, object[]>} rows what a pull applied, by entity
   */
  async danglingAmong(rows) {
    return danglingIn(
      (entityName) => rows.get(entityName) ?? [],
      this.#pointsAtSomething,
      this.#absenceMeansSomething,
    );
  }

  #everyRow = (entityName) => this.adapter.query(entityName, {});

  /**
   * Whether a missing row of this entity is news, for whoever is signed in.
   *
   * The predicate below reads through the adapter rather than the repository,
   * deliberately — an audit that could not see a row would report every
   * restricted record as broken. But the rows that were never *sent* are not
   * here to be seen at any level, because a pull is filtered by role, and to
   * this device they are indistinguishable from rows that do not exist.
   *
   * So the audit reports on the entities the actor reads in full and stays
   * quiet about the rest. It is the difference between *your records are
   * damaged* and *you are not shown that one*, and only one of those is true.
   */
  #absenceMeansSomething = (entityName) => readScope(this.#actor, entityName) === 'all';

  /** A reference is satisfied by a row that exists and is not deleted. */
  #pointsAtSomething = async (entityName, id) => {
    const row = await this.adapter.read(entityName, id);
    return Boolean(row) && !row.deletedAt;
  };

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
