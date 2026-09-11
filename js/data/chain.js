/**
 * Tamper-evidence for the audit trail.
 *
 * ## What was measured before this was written
 *
 *     audit entries      : 2
 *     after tampering    : 1 entries
 *     altered entry actor: somebody-else
 *     anything notices?  : NO VERIFIER EXISTS
 *
 * One entry rewritten to name a different person, another deleted outright,
 * and nothing anywhere could tell. The audit trail established *history* and
 * not *tamper-evidence*, which is what `docs/COMPLIANCE/ELECTRONIC_RECORDS.md`
 * has said about it all along.
 *
 * ## What a hash chain does and does not prove
 *
 * This is the part that must not be overstated, so it is first.
 *
 * Each entry carries the hash of the one before it from the same device. Alter
 * an entry and its hash stops matching. Delete one and the chain breaks where
 * it used to be. Insert one and it has no place in the links.
 *
 * **Except at the end, where the links say nothing.** Delete the last few
 * entries and what remains still adds up from the beginning — the chain has no
 * opinion about how far it should have reached. That is the cheapest tamper
 * there is, and it is the shape a dropped sync or a half-finished restore
 * takes; the verifier called it intact and reported the count it was left
 * with. So the head each device records in `meta`, in the same transaction as
 * the entry, is compared with where the walk stops. It is in a different store
 * from the rows it is about, which is what makes it worth anything here.
 *
 * **It does not stop anybody doing any of those things.** It makes them
 * visible afterwards. That is the whole of the claim, and the word is
 * *evidence*, never *proof*.
 *
 * And it is defeated by one specific attacker: somebody who can write to this
 * database *and* recompute the chain. That is anybody who can unlock the
 * application, because nothing here is signed with a key they would not also
 * have. Against a careless edit, a buggy migration, a sync that drops rows, or
 * somebody quietly deleting the line that says what they did, this works.
 * Against a determined person with the passphrase, it does not, and no amount
 * of hashing inside the same database would change that.
 *
 * Closing that needs an anchor outside this device — the head hash written
 * somewhere the same person cannot rewrite. `docs/AUDIT_CHAIN.md` sets out
 * what that would take. It is not built, and this file does not pretend the
 * chain alone is worth more than it is.
 *
 * ## One chain per device, not one chain
 *
 * Audit entries are written on every device and synced. A single global chain
 * would need a global write order, and two phones appending offline do not
 * have one — the chain would "break" every time somebody used a second device,
 * which is a verifier that cries wolf and therefore a verifier nobody reads.
 *
 * So each device chains its own entries. `deviceId` was already on every row.
 */

import { t } from '../core/locale.js';

const GENESIS = 'genesis';

/** Fields that are hashed. Deliberately a list, and deliberately explicit. */
const SIGNED = [
  'id', 'at', 'action', 'entity', 'recordId',
  'actorId', 'actorRole', 'fields', 'detail', 'deviceId',
];

/**
 * The bytes an entry's hash is taken over.
 *
 * `synced` is excluded because it flips from false to true after the entry is
 * written — hashing it would break every chain the first time it synced, which
 * is the same cry-wolf failure as one global chain.
 *
 * `hash` and `prev` are excluded because an entry cannot contain its own hash.
 *
 * Key order is fixed by `SIGNED` rather than by `Object.keys`, which follows
 * insertion order and would produce a different string for two entries that
 * are the same record.
 */
export function canonical(entry) {
  return JSON.stringify(SIGNED.map((key) => {
    const value = entry?.[key];
    // `detail` is an object of anything, so its keys are sorted too. Without
    // this, the same detail built in two orders hashes two ways and an honest
    // entry reads as tampered.
    if (key === 'detail') return stable(value ?? {});
    if (key === 'fields') return [...(value ?? [])];
    return value ?? '';
  }));
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().map((k) => [k, stable(value[k])]);
  }
  return value ?? null;
}

const hex = (buffer) => [...new Uint8Array(buffer)]
  .map((b) => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 over an entry's signed content and the hash before it. */
export async function hashEntry(entry, prev = GENESIS) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('no Web Crypto — an audit chain cannot be built without it');
  const bytes = new TextEncoder().encode(`${prev}\n${canonical(entry)}`);
  return hex(await subtle.digest('SHA-256', bytes));
}

/** An entry with its place in the chain. */
export async function link(entry, prev = GENESIS) {
  return { ...entry, prev, hash: await hashEntry(entry, prev) };
}

/**
 * Walk a device's chain and say where, if anywhere, it stops adding up.
 *
 * Reports the *first* break rather than every one, because after a break
 * everything downstream is unverifiable and listing it all would bury the one
 * fact that matters.
 *
 * `head` is where this device last recorded itself — see `Chain`, which writes
 * it to `meta` in the same transaction as the entry. Walking the links catches
 * a row altered or removed from the **middle**, and cannot catch one removed
 * from the **end**: the chain from the beginning still adds up, and nothing in
 * the entries says how far it should have reached. The head does, it is in a
 * different store, and until now nothing compared them.
 *
 * @param {object[]} entries every audit entry for one device, any order
 * @param {string|null} [head] the hash this device last committed, if known
 * @returns {Promise<{ok: boolean, checked: number, why: string|null,
 *                    at: string|null, kind: string|null}>}
 */
export async function verifyDevice(entries, head = null) {
  const rows = entries ?? [];
  const expectedEnd = head && head !== GENESIS ? head : null;

  if (!rows.length) {
    return expectedEnd
      ? {
        ok: false,
        checked: 0,
        kind: 'truncated',
        at: null,
        why: t('chain.why.truncatedAll'),
      }
      : { ok: true, checked: 0, why: null, at: null, kind: null };
  }

  const byPrev = new Map();
  for (const row of rows) {
    // Two entries claiming the same predecessor is a fork: one of them was
    // inserted, or one was rewritten to point somewhere it did not.
    if (byPrev.has(row.prev)) {
      return {
        ok: false,
        checked: 0,
        kind: 'forked',
        at: row.id,
        why: t('chain.why.forked'),
      };
    }
    byPrev.set(row.prev, row);
  }

  const start = byPrev.get(GENESIS);
  if (!start) {
    return {
      ok: false,
      checked: 0,
      kind: 'noStart',
      at: null,
      why: t('chain.why.noStart'),
    };
  }

  let current = start;
  let checked = 0;
  let end = GENESIS;

  while (current) {
    const expected = await hashEntry(current, current.prev);
    if (expected !== current.hash) {
      return {
        ok: false,
        checked,
        kind: 'altered',
        at: current.id,
        why: t('chain.why.altered'),
      };
    }
    checked += 1;
    end = current.hash;
    current = byPrev.get(current.hash);
  }

  if (checked !== rows.length) {
    return {
      ok: false,
      checked,
      kind: 'orphaned',
      at: null,
      why: rows.length - checked === 1
        ? t('chain.why.orphaned.one')
        : t('chain.why.orphaned.many', { n: rows.length - checked }),
    };
  }

  /*
   * The links add up from the beginning; the head says where they should have
   * stopped. Checked last, because "the log ends early" is a less specific
   * thing to be told than "this entry was altered", and the more specific
   * answer should win when both are true.
   *
   * Which way they disagree matters, because the two mean opposite things and
   * a household reads the sentence. If the entry the head names is nowhere in
   * the log, it was removed. If it is here and the walk went past it, nothing
   * was removed at all — the head is behind what the log holds, which is what
   * restoring an older archive onto a device that has kept working produces:
   * `writeSystemStoreRows` puts the archive's head back while the entries
   * written since it stay where they are.
   *
   * Saying "the most recent entries were removed" there would be exactly
   * backwards, and this check exists because a sentence about somebody's audit
   * trail was not true.
   */
  if (expectedEnd && expectedEnd !== end) {
    const behind = rows.some((row) => row.hash === expectedEnd);
    return {
      ok: false,
      checked,
      kind: behind ? 'behind' : 'truncated',
      at: null,
      why: behind ? t('chain.why.behind') : t('chain.why.truncated'),
    };
  }

  return { ok: true, checked, why: null, at: null, kind: null };
}

/**
 * Every device's chain.
 *
 * An unchained entry — one written before this existed — is counted and
 * reported rather than treated as tampering. A verifier that calls every old
 * database broken tells nobody anything.
 *
 * `heads` maps a device id to the hash it last recorded, as `Chain` wrote it
 * to `meta`. Without it the walk is blind to entries removed from the end —
 * see `verifyDevice`. It is optional so that a caller holding only entries
 * still gets the checks that need nothing else.
 *
 * @param {object[]} entries
 * @param {Record<string, string>} [heads]
 */
export async function verify(entries, heads = {}) {
  const rows = entries ?? [];
  const legacy = rows.filter((r) => !r.hash);
  const chained = rows.filter((r) => r.hash);

  const byDevice = new Map();
  for (const row of chained) {
    const key = row.deviceId ?? '';
    if (!byDevice.has(key)) byDevice.set(key, []);
    byDevice.get(key).push(row);
  }

  // A device with a recorded head and no entries left is the loudest version
  // of the gap the head closes, and grouping by entry alone would skip it
  // entirely — there would be nothing to group.
  for (const deviceId of Object.keys(heads)) {
    if (!byDevice.has(deviceId)) byDevice.set(deviceId, []);
  }

  const devices = [];
  for (const [deviceId, rowsFor] of byDevice) {
    devices.push({ deviceId, ...(await verifyDevice(rowsFor, heads[deviceId] ?? null)) });
  }

  return {
    ok: devices.every((d) => d.ok),
    devices,
    checked: devices.reduce((n, d) => n + d.checked, 0),
    // Named, not hidden. These entries predate the chain and nothing can say
    // whether they were altered — which is a fact about them worth reporting.
    unchained: legacy.length,
  };
}

export { GENESIS };

/* ------------------------------------------------------------- the writer */

export const headKey = (deviceId) => `audit.head.${deviceId || 'local'}`;

/**
 * This device's place in its own chain.
 *
 * The head lives in `meta` and is written **in the same transaction as the
 * entry**. That is the whole reason it is not simply a field on the database
 * object: a transaction that rolls back must not leave the head pointing at an
 * entry that was never written, because the next entry would then chain to
 * nothing and an honest log would read as tampered.
 *
 * `reset()` exists for the other half of that — a failed transaction drops the
 * in-memory head so the next write re-reads the committed one.
 */
export class Chain {
  #adapter;
  #deviceId;
  #head = null;

  constructor(adapter, deviceId) {
    this.#adapter = adapter;
    this.#deviceId = deviceId;
  }

  /** The next entry, linked. Advances the in-memory head. */
  async next(entry) {
    if (this.#head === null) {
      const row = await this.#adapter.read('meta', headKey(this.#deviceId)).catch(() => null);
      this.#head = row?.value ?? GENESIS;
    }
    const linked = await link(entry, this.#head);
    this.#head = linked.hash;
    return linked;
  }

  /** The row to write beside the entry, inside the same transaction. */
  headRow() {
    return {
      key: headKey(this.#deviceId),
      value: this.#head ?? GENESIS,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Forget where we were, after a write that did not land. */
  reset() {
    this.#head = null;
  }
}
