/**
 * Migrations, of two kinds.
 *
 * **Structural** — object stores and indexes. Derived from `schema.js`, never
 * written by hand. The database version is not a constant anyone has to
 * remember to bump: `openDatabase` opens what is there, compares it with what
 * the schema asks for, and re-opens one version higher if anything is missing.
 * Adding an entity is therefore a schema edit and nothing else.
 *
 * **Record-level** — a row written by an older client, read by a newer one.
 * Records carry `schemaVersion`; `upgradeRecord` walks it forward one step at
 * a time. This runs on read rather than as a bulk rewrite, so a device holding
 * forty thousand rows does not stall on launch, and a row that is never read
 * is never touched.
 */

import { entities, systemStores } from './schema.js';
import { IdbAdapter, idbAvailable } from './idb.js';
import { MemoryAdapter } from './storage.js';
import { StorageError } from '../core/errors.js';

/** Every store the app needs, with its indexes. */
export function describeStores() {
  const stores = [];

  for (const e of Object.values(entities)) {
    stores.push({
      name: e.name,
      keyPath: 'id',
      indexes: [
        // Present on every entity, because every query the repository makes
        // filters deleted rows and orders by one of these three.
        ['byUpdatedAt', 'updatedAt'],
        ['byDeleted', 'deletedAt'],
        ['bySyncState', 'syncState'],
        ...(e.indexes ?? []),
      ],
    });
  }

  for (const [name, def] of Object.entries(systemStores)) {
    stores.push({ name, keyPath: def.keyPath, indexes: def.indexes });
  }

  return stores;
}

/**
 * Open the database, growing it if the schema has gained stores or indexes
 * since it was last opened.
 *
 * @param {{name?: string, adapter?: object}} [options] `adapter` forces an
 *   implementation; otherwise IndexedDB is used when the browser has it.
 */
export async function openDatabase(options = {}) {
  const stores = describeStores();
  const adapter = options.adapter
    ?? (idbAvailable() ? new IdbAdapter(options.name ?? 'familyos') : new MemoryAdapter());

  if (adapter instanceof MemoryAdapter) {
    await adapter.open({ version: 1, stores });
    return adapter;
  }

  // Open at whatever version exists, then check. `databases()` is not
  // universally available, so version 1 is the starting guess and the
  // browser reports the real one through the open request.
  let version = await currentVersion(options.name ?? 'familyos');
  await adapter.open({ version, stores });

  if (needsUpgrade(adapter, stores)) {
    adapter.close();
    version += 1;
    await adapter.open({ version, stores });
  }

  return adapter;
}

/** True when the open database lacks a store or an index the schema wants. */
export function needsUpgrade(adapter, stores = describeStores()) {
  const present = new Set(adapter.storeNames());
  for (const store of stores) {
    if (!present.has(store.name)) return true;
    const have = new Set(adapter.indexNamesOf(store.name));
    for (const [name] of store.indexes ?? []) {
      if (!have.has(name)) return true;
    }
  }
  return false;
}

async function currentVersion(name) {
  if (typeof indexedDB?.databases === 'function') {
    try {
      const found = (await indexedDB.databases()).find((d) => d.name === name);
      if (found?.version) return found.version;
    } catch {
      // Firefox private mode rejects here; fall through to the probe below.
    }
  }
  // Opening with no version returns the existing one, or creates version 1.
  return new Promise((resolve) => {
    const req = indexedDB.open(name);
    req.onsuccess = () => {
      const v = req.result.version;
      req.result.close();
      resolve(v);
    };
    req.onerror = () => resolve(1);
  });
}

/* ------------------------------------------------------- record migrations */

/**
 * `{ entityName: { 2: (record) => record, 3: … } }`
 *
 * The key is the version being migrated *to*. A function must be pure and
 * must tolerate being run on a record it has already seen, because a failed
 * write can retry.
 *
 * Worked example, kept because it documents the shape better than prose:
 *
 *   transaction: {
 *     2: (r) => ({ ...r, tags: r.tags ?? [] }),           // field added
 *     3: (r) => ({ ...r, kind: r.isIncome ? 'income' : 'expense' }),
 *   }
 */
export const recordMigrations = {};

export function upgradeRecord(entityName, record) {
  const def = entities[entityName];
  if (!def) throw new StorageError(`unknown entity "${entityName}"`);

  let from = record.schemaVersion ?? 1;
  if (from === def.version) return record;
  if (from > def.version) {
    // Written by a newer client than this one. Leave it alone: dropping the
    // fields we do not understand would delete another device's data on the
    // next push.
    return record;
  }

  let out = record;
  const steps = recordMigrations[entityName] ?? {};
  while (from < def.version) {
    from += 1;
    const step = steps[from];
    if (step) out = step(out);
  }
  return { ...out, schemaVersion: def.version };
}

/** Highest entity version in the schema, for the sync handshake. */
export function schemaFingerprint() {
  return Object.values(entities)
    .map((e) => `${e.name}@${e.version}`)
    .sort()
    .join(',');
}
