/**
 * IndexedDB adapter.
 *
 * Implements the same contract as `MemoryAdapter`, so nothing above it knows
 * which one it has. Two rules govern everything here:
 *
 * 1. **Never await anything but an IndexedDB request inside a transaction.**
 *    A transaction commits as soon as the microtask queue drains with no
 *    request outstanding. An `await fetch()` in the middle of one does not
 *    throw — the later writes simply never happen. Every promise this file
 *    hands to a caller inside `tx` is chained straight off a request event.
 *
 * 2. **Version upgrades are additive.** `migrations.js` decides the store and
 *    index set; this file only applies it. Nothing is ever dropped, because a
 *    dropped store on a device that has not synced is data loss.
 */

import { StorageError } from '../core/errors.js';

const idb = () => globalThis.indexedDB;

export function idbAvailable() {
  return Boolean(idb());
}

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError(req.error?.message ?? 'request failed', req.error));
  });
}

function toKeyRange(range) {
  if (!range) return null;
  const R = globalThis.IDBKeyRange;
  if (Object.hasOwn(range, 'only')) return R.only(range.only);
  if (range.lower !== undefined && range.upper !== undefined) {
    return R.bound(range.lower, range.upper, Boolean(range.lowerOpen), Boolean(range.upperOpen));
  }
  if (range.lower !== undefined) return R.lowerBound(range.lower, Boolean(range.lowerOpen));
  if (range.upper !== undefined) return R.upperBound(range.upper, Boolean(range.upperOpen));
  return null;
}

/**
 * Walk a cursor rather than calling `getAll`, because a windowed list wants
 * fifty rows out of forty thousand and `getAll` would materialise all of them
 * before the filter ran.
 */
function collect(source, query) {
  const { range, direction = 'next', limit = Infinity, offset = 0, filter } = query;
  return new Promise((resolve, reject) => {
    const out = [];
    let skipped = 0;
    const req = source.openCursor(toKeyRange(range), direction);
    req.onerror = () => reject(new StorageError(req.error?.message ?? 'cursor failed', req.error));
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return resolve(out);
      const value = cursor.value;
      if (!filter || filter(value)) {
        if (skipped < offset) {
          skipped++;
          // `advance` past a filtered set would skip the wrong rows, so the
          // offset is consumed one row at a time whenever a filter is present.
          cursor.continue();
          return;
        }
        out.push(value);
        if (out.length >= limit) return resolve(out);
      }
      cursor.continue();
    };
  });
}

class IdbTx {
  #tx;
  #done;

  constructor(tx) {
    this.#tx = tx;
    this.#done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(new StorageError(tx.error?.message ?? 'transaction aborted', tx.error));
      tx.onerror = () => reject(new StorageError(tx.error?.message ?? 'transaction failed', tx.error));
    });
  }

  get done() {
    return this.#done;
  }

  #store(name) {
    try {
      return this.#tx.objectStore(name);
    } catch (err) {
      throw new StorageError(`store "${name}" is not in this transaction`, err);
    }
  }

  get(store, key) {
    return request(this.#store(store).get(key));
  }

  put(store, record) {
    return request(this.#store(store).put(record));
  }

  delete(store, key) {
    return request(this.#store(store).delete(key));
  }

  getAll(store, query = {}) {
    const os = this.#store(store);
    const source = query.index ? os.index(query.index) : os;
    return collect(source, query);
  }

  count(store, query = {}) {
    // Without a filter the engine can count from the index without reading
    // any values; with one, every row has to be looked at anyway.
    if (query.filter) return this.getAll(store, { ...query, limit: Infinity }).then((r) => r.length);
    const os = this.#store(store);
    const source = query.index ? os.index(query.index) : os;
    return request(source.count(toKeyRange(query.range) ?? undefined));
  }

  clear(store) {
    return request(this.#store(store).clear());
  }

  abort() {
    this.#tx.abort();
  }
}

export class IdbAdapter {
  #db = null;
  #name;

  constructor(name = 'familyos') {
    this.#name = name;
  }

  /**
   * @param {{version: number, stores: Array<{name, keyPath, indexes}>}} descriptor
   * @param {(db: IDBDatabase, from: number, to: number) => void} [onUpgrade]
   */
  async open(descriptor, onUpgrade) {
    if (!idb()) throw new StorageError('this browser has no IndexedDB');

    this.#db = await new Promise((resolve, reject) => {
      const req = idb().open(this.#name, descriptor.version);

      req.onupgradeneeded = (ev) => {
        const db = req.result;
        for (const store of descriptor.stores) {
          const os = db.objectStoreNames.contains(store.name)
            ? req.transaction.objectStore(store.name)
            : db.createObjectStore(store.name, { keyPath: store.keyPath });
          for (const [name, path, options] of store.indexes ?? []) {
            if (!os.indexNames.contains(name)) os.createIndex(name, path, options ?? {});
          }
        }
        onUpgrade?.(db, ev.oldVersion, ev.newVersion);
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError(req.error?.message ?? 'could not open the database', req.error));
      req.onblocked = () => reject(new StorageError(
        'another tab is holding an older version of the database open'));
    });

    // A second tab upgrading the schema must not be blocked forever by this one.
    this.#db.onversionchange = () => this.close();
    return this;
  }

  #require() {
    if (!this.#db) throw new StorageError('the database is not open');
    return this.#db;
  }

  storeNames() {
    return [...this.#require().objectStoreNames];
  }

  /** Index names present on a store right now, for the upgrade check. */
  indexNamesOf(store) {
    const tx = this.#require().transaction(store, 'readonly');
    const names = [...tx.objectStore(store).indexNames];
    tx.abort();
    return names;
  }

  async read(store, key) {
    return this.tx([store], 'readonly', (t) => t.get(store, key));
  }

  async query(store, q = {}) {
    return this.tx([store], 'readonly', (t) => t.getAll(store, q));
  }

  async count(store, q = {}) {
    return this.tx([store], 'readonly', (t) => t.count(store, q));
  }

  async write(store, record) {
    return this.tx([store], 'readwrite', (t) => t.put(store, record));
  }

  async remove(store, key) {
    return this.tx([store], 'readwrite', (t) => t.delete(store, key));
  }

  /**
   * The result of `fn` is returned only after the transaction has actually
   * committed. Resolving earlier would let a caller report "saved" for a write
   * that a quota error is about to undo.
   */
  async tx(stores, mode, fn) {
    const tx = new IdbTx(this.#require().transaction(stores, mode));
    let result;
    try {
      result = await fn(tx);
    } catch (err) {
      /*
       * The abort below rejects `done`, and on this path nobody awaits it.
       *
       * That unhandled rejection reached the console as `transaction aborted`
       * — a message with no store, no key and no stack past this file — while
       * the error actually being thrown said `The parameter is not a valid
       * key`. The useless message is the one that surfaced, and it hid a
       * screen that had never once opened. Claiming the rejection here leaves
       * the real error as the only thing reported.
       */
      tx.done.catch(() => {});
      try { tx.abort(); } catch { /* already finished */ }
      throw err;
    }
    await tx.done;
    return result;
  }

  async clear(store) {
    return this.tx([store], 'readwrite', (t) => t.clear(store));
  }

  close() {
    this.#db?.close();
    this.#db = null;
  }

  async destroy() {
    this.close();
    await new Promise((resolve, reject) => {
      const req = idb().deleteDatabase(this.#name);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new StorageError('could not delete the database', req.error));
      req.onblocked = () => resolve(); // deletion completes once other tabs close
    });
  }

  /** Bytes used and available, when the browser will say. */
  async usage() {
    if (!navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage, quota, ratio: quota ? usage / quota : 0 };
  }

  /** Ask the browser not to evict us under storage pressure. */
  async persist() {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
  }
}
