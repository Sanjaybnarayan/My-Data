/**
 * The storage contract, and the in-memory implementation of it.
 *
 * Everything above this file talks to a `StorageAdapter`. There are two:
 * `IdbAdapter` in the browser and `MemoryAdapter` here. They are not "the real
 * one and a test double" — the repository, the outbox, migrations and conflict
 * resolution are exercised against this one in Node, so a bug in any of them
 * fails a test rather than a phone.
 *
 * ## Ranges
 *
 * Queries take a plain range descriptor rather than an `IDBKeyRange`, so no
 * caller needs the browser type:
 *
 *   { only: 'x' }                       exactly x
 *   { lower: 'a', upper: 'b' }          inclusive both ends
 *   { lower: 'a', lowerOpen: true }     exclusive lower bound
 *
 * ## Transactions
 *
 * `tx(stores, mode, fn)` runs `fn` with a handle whose operations all belong
 * to one atomic unit. The callback may await the handle's own operations and
 * nothing else — an `await` on an unrelated promise lets a real IndexedDB
 * transaction auto-commit underneath you, and the write that follows is lost
 * with no error. Read the data you need before you open the transaction.
 */

import { StorageError } from '../core/errors.js';

/** Does a key fall inside a range descriptor? */
export function inRange(key, range) {
  if (!range) return true;
  if (Object.hasOwn(range, 'only')) return compareKeys(key, range.only) === 0;
  if (range.lower !== undefined) {
    const c = compareKeys(key, range.lower);
    if (c < 0 || (c === 0 && range.lowerOpen)) return false;
  }
  if (range.upper !== undefined) {
    const c = compareKeys(key, range.upper);
    if (c > 0 || (c === 0 && range.upperOpen)) return false;
  }
  return true;
}

/** IndexedDB's key ordering, reproduced for the memory adapter. */
export function compareKeys(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : [a];
    const y = Array.isArray(b) ? b : [b];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if (x[i] === undefined) return -1;
      if (y[i] === undefined) return 1;
      const c = compareKeys(x[i], y[i]);
      if (c !== 0) return c;
    }
    return 0;
  }
  const rank = (v) => (typeof v === 'number' ? 0 : v instanceof Date ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === 'number') return a - b;
  return a < b ? -1 : a > b ? 1 : 0;
}

function readPath(record, path) {
  if (!path) return undefined;
  if (Array.isArray(path)) return path.map((p) => readPath(record, p));
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), record);
}

/* ------------------------------------------------------------------ memory */

class MemoryTx {
  #db;
  #stores;
  #mode;
  /** @type {Array<() => void>} applied on commit, so a throw leaves nothing behind */
  #pending = [];
  #staged = new Map();
  aborted = false;

  constructor(db, stores, mode) {
    this.#db = db;
    this.#stores = new Set(stores);
    this.#mode = mode;
  }

  #check(store, write) {
    if (this.aborted) throw new StorageError('transaction already aborted');
    if (!this.#stores.has(store)) {
      throw new StorageError(`store "${store}" is not in this transaction`);
    }
    if (write && this.#mode !== 'readwrite') {
      throw new StorageError(`transaction over ${[...this.#stores]} is read-only`);
    }
  }

  #stage(store) {
    let map = this.#staged.get(store);
    if (!map) this.#staged.set(store, (map = new Map()));
    return map;
  }

  async get(store, key) {
    this.#check(store, false);
    const staged = this.#staged.get(store);
    if (staged?.has(key)) {
      const value = staged.get(key);
      return value === undefined ? undefined : clone(value);
    }
    const value = this.#db.get(store).get(key);
    return value === undefined ? undefined : clone(value);
  }

  async put(store, record) {
    this.#check(store, true);
    const key = readPath(record, this.#db.keyPath(store));
    if (key === undefined) {
      throw new StorageError(`record for "${store}" has no ${this.#db.keyPath(store)}`);
    }
    const copy = clone(record);
    this.#stage(store).set(key, copy);
    this.#pending.push(() => this.#db.get(store).set(key, copy));
    return key;
  }

  async delete(store, key) {
    this.#check(store, true);
    this.#stage(store).set(key, undefined);
    this.#pending.push(() => this.#db.get(store).delete(key));
  }

  async getAll(store, query) {
    this.#check(store, false);
    // Staged writes must be visible to a read later in the same transaction.
    const base = new Map(this.#db.get(store));
    for (const [k, v] of this.#staged.get(store) ?? []) {
      if (v === undefined) base.delete(k); else base.set(k, v);
    }
    return runQuery([...base.values()], this.#db.indexes(store), query);
  }

  async count(store, query = {}) {
    const rows = await this.getAll(store, { ...query, limit: Infinity, offset: 0 });
    return rows.length;
  }

  async clear(store) {
    this.#check(store, true);
    for (const key of this.#db.get(store).keys()) await this.delete(store, key);
  }

  abort() {
    this.aborted = true;
    this.#pending = [];
  }

  commit() {
    if (this.aborted) return;
    for (const apply of this.#pending) apply();
    this.#pending = [];
  }
}

function clone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/**
 * Apply an index, a range, a filter, ordering and a window — the same query
 * shape both adapters accept.
 */
export function runQuery(records, indexes, query = {}) {
  const {
    index, range, direction = 'next', limit = Infinity, offset = 0, filter,
  } = query;

  const primary = indexes.__key.path;
  const meta = index ? indexes[index] : indexes.__key;
  if (index && !meta) throw new StorageError(`no index "${index}"`);

  /**
   * A multiEntry index has one entry per array element, so a record matches
   * when *any* element does, and sorts by its smallest matching element —
   * which is how IndexedDB walks a multiEntry cursor.
   */
  const keysOf = (r) => {
    const value = readPath(r, meta.path);
    if (meta.multiEntry && Array.isArray(value)) return value;
    return [value];
  };

  let rows = records;
  if (range) rows = rows.filter((r) => keysOf(r).some((k) => inRange(k, range)));

  const sortKey = (r) => {
    const keys = range ? keysOf(r).filter((k) => inRange(k, range)) : keysOf(r);
    return keys.length ? keys.reduce((a, b) => (compareKeys(a, b) <= 0 ? a : b)) : undefined;
  };

  rows = [...rows].sort((a, b) => {
    const c = compareKeys(sortKey(a), sortKey(b));
    // Ties break on primary key so paging is stable, exactly as IndexedDB does.
    return c !== 0 ? c : compareKeys(readPath(a, primary), readPath(b, primary));
  });
  if (direction === 'prev') rows.reverse();

  if (filter) rows = rows.filter(filter);
  return rows.slice(offset, offset + limit).map(clone);
}

export class MemoryAdapter {
  #stores = new Map();
  #meta = new Map();
  open_ = false;

  async open(descriptor) {
    for (const store of descriptor.stores) {
      if (!this.#stores.has(store.name)) this.#stores.set(store.name, new Map());
      this.#meta.set(store.name, {
        keyPath: store.keyPath,
        indexes: {
          __key: { path: store.keyPath, multiEntry: false },
          ...Object.fromEntries((store.indexes ?? []).map(([name, path, options]) => [
            name, { path, multiEntry: Boolean(options?.multiEntry) },
          ])),
        },
      });
    }
    this.open_ = true;
    return this;
  }

  get(store) {
    const map = this.#stores.get(store);
    if (!map) throw new StorageError(`unknown store "${store}"`);
    return map;
  }

  keyPath(store) {
    return this.#meta.get(store).keyPath;
  }

  indexes(store) {
    return this.#meta.get(store).indexes;
  }

  storeNames() {
    return [...this.#stores.keys()];
  }

  indexNamesOf(store) {
    return Object.keys(this.#meta.get(store).indexes).filter((n) => n !== '__key');
  }

  async read(store, key) {
    const value = this.get(store).get(key);
    return value === undefined ? undefined : clone(value);
  }

  async query(store, q) {
    return runQuery([...this.get(store).values()], this.indexes(store), q);
  }

  async count(store, q = {}) {
    return (await this.query(store, { ...q, limit: Infinity, offset: 0 })).length;
  }

  async write(store, record) {
    return this.tx([store], 'readwrite', (t) => t.put(store, record));
  }

  async remove(store, key) {
    return this.tx([store], 'readwrite', (t) => t.delete(store, key));
  }

  /**
   * Run a transaction — and, for a writing one, run it alone.
   *
   * IndexedDB serialises `readwrite` transactions whose scopes overlap: a
   * second one over the same store does not start until the first has
   * finished. This did not, so two overlapping writers interleaved at every
   * `await` and each saw the state the other was about to replace.
   *
   * That made the harness *more permissive than the browser*, which is the
   * worse direction for a stub to be wrong in. It hid a class of bug —
   * read-decide-write inside one transaction — and, having hidden it, it also
   * could not demonstrate the fix: `database.js#claimMeta` was written to
   * close exactly such a window and the race survived it here, not because the
   * claim was wrong but because nothing was enforcing what the claim relies
   * on.
   *
   * Scope-based, like the real thing, rather than one queue for everything:
   * a stub stricter than the browser would pass tests the browser fails, which
   * is the same mistake pointing the other way.
   *
   * Readers are not serialised, matching IndexedDB, and nothing here opens a
   * transaction from inside another — every call site uses the handle — so the
   * chain cannot wait on itself.
   */
  async tx(stores, mode, fn) {
    if (mode !== 'readwrite') return this.#runTx(stores, mode, fn);

    const waitingOn = stores.map((name) => this.#tails.get(name)).filter(Boolean);
    // Assigned by the executor, which runs synchronously — the default is
    // unreachable and is here because a type checker cannot know that.
    /** @type {(value?: unknown) => void} */
    let release = () => {};
    const mine = new Promise((resolve) => { release = resolve; });
    for (const name of stores) this.#tails.set(name, mine);

    // `allSettled`: a transaction that threw still ends, and the next one is
    // not owed its failure.
    await Promise.allSettled(waitingOn);
    try {
      return await this.#runTx(stores, mode, fn);
    } finally {
      release();
      for (const name of stores) if (this.#tails.get(name) === mine) this.#tails.delete(name);
    }
  }

  /** The tail of the queue for each store, so scopes that overlap wait. */
  #tails = new Map();

  async #runTx(stores, mode, fn) {
    const t = new MemoryTx(this, stores, mode);
    try {
      const result = await fn(t);
      t.commit();
      return result;
    } catch (err) {
      t.abort();
      throw err;
    }
  }

  async clear(store) {
    this.get(store).clear();
  }

  async destroy() {
    this.#stores.clear();
    this.#meta.clear();
  }

  close() {
    this.open_ = false;
  }
}
