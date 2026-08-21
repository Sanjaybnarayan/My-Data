/**
 * A household's records, in one file they can keep.
 *
 * FamilyOS could export before this: forty-three CSVs, one per entity, and
 * nothing that could read one back. `docs/PORTABILITY.md` measured what that
 * left out — twenty-two fields no export carried at any setting, three of them
 * references, and the documents themselves never. It was data portability, and
 * it was not a backup, and two documents said otherwise until somebody checked.
 *
 * This is the other thing. One file, everything in it, and a restore that puts
 * it back.
 *
 * ## What is in it, and what is deliberately not
 *
 * The rows go in **exactly as the database holds them** — `list({ decrypt:
 * false })` returns the stored shape, encrypted fields still in their
 * `enc:v1:` envelopes. Nothing is decrypted to be archived and nothing is
 * re-encrypted on the way back, so a restore cannot quietly change what a
 * record says. The keyring rides along in `meta`, which is what lets the
 * envelopes still open on the other side: same wrapped data key, same PIN,
 * same recovery phrase.
 *
 *   entity stores   every record, including soft-deleted ones — a deletion is
 *                   a fact about the household, and a restore that resurrects
 *                   what somebody threw away is not a restore.
 *   meta            the keyring, the device identity, who is signed in.
 *                   Without it the rest is ciphertext nobody can open.
 *   audit           what happened and when. A record's history is part of the
 *                   record for anything a household would use this for.
 *   blobs           the documents themselves. This is the difference between
 *                   a backup and a list of filenames.
 *
 * Left out, each for a reason:
 *
 *   search          derived from the rows, rebuilt as they are written back.
 *   outbox, shadow  a conversation with a backend this device was having.
 *   conflicts       the same. A new device has its own relationship to sync,
 *                   and inheriting half of somebody else's is how you get a
 *                   push that overwrites the wrong thing.
 *
 * ## Why the whole file is encrypted, and with what
 *
 * The rows carry plaintext. That is not a defect — `docs/DATA_CLASSIFICATION`
 * explains why a search index over ciphertext finds nothing and a table cannot
 * sort a column it cannot read — but it means an archive is a payee, an
 * amount and a date for every transaction a family has ever recorded. Written
 * to a phone's Downloads folder, that is the single worst object this
 * application could produce.
 *
 * So the file is encrypted as a whole, with a key derived from the **recovery
 * phrase** rather than from something new. Three reasons, in order:
 *
 *  1. It is the secret a household already has written down, and the one they
 *     will still have when the device is gone.
 *  2. It is generated rather than chosen, so it is not "Password1". The archive
 *     encryption is the only thing standing in front of the plaintext, and a
 *     user-picked passphrase would be the weakest link by a wide margin.
 *  3. It gives the recovery phrase a second real purpose. Until now it restored
 *     a key and not data — Settings says exactly that to the user's face — and
 *     the data it could not restore is now in the file it opens.
 *
 * A fresh salt, unrelated to the keyring's, so the archive and the keyring
 * cannot be attacked as one.
 */

import {
  toBase64, fromBase64, newSalt,
  deriveKeyEncryptionKey, encryptBytes, decryptBytes,
} from '../security/crypto.js';

/** Bumped when the shape changes in a way an older reader would misread. */
export const ARCHIVE_VERSION = 1;

/** In the clear, so a file can be recognised before anybody types a phrase. */
export const MAGIC = 'familyos-archive';

/** Matches the keyring, so the two cost the same to attack. */
export const ITERATIONS = 600_000;

export const STORES = Object.freeze({
  included: Object.freeze(['meta', 'audit', 'blobs']),
  excluded: Object.freeze({
    search: 'derived from the rows, and rebuilt as they are written back',
    outbox: 'a conversation with a backend that this device was having',
    shadow: 'the base of a merge that belongs to one device’s sync, not to the records',
    conflicts: 'unresolved sync disagreements, which a new device has not had yet',
  }),
});

export const WHY = Object.freeze({
  NOT_AN_ARCHIVE: 'that is not a FamilyOS archive',
  FUTURE_VERSION: 'that archive was written by a newer version of FamilyOS',
  WRONG_PHRASE: 'that recovery phrase does not open this archive',
  DAMAGED: 'the archive is damaged and cannot be read',
  NO_KEYRING: 'the archive has no keyring, so nothing in it could be decrypted',
  NOT_EMPTY: 'this device already holds records',
  UNKNOWN_STORE: 'the archive holds a store this version does not know',
  UNVERIFIABLE: 'the file was written but could not be read back, so it was not offered',
});

/* ------------------------------------------------------------------ build */

/**
 * The body of an archive, before it is sealed.
 *
 * @param {{stores: Record<string, object[]>, entities: string[],
 *          createdAt?: string, device?: string}} input
 */
export function buildBody({ stores, entities, createdAt = new Date().toISOString(), device = '' }) {
  const kept = {};
  for (const [name, rows] of Object.entries(stores)) {
    if (name in STORES.excluded) continue;
    kept[name] = rows ?? [];
  }
  return {
    magic: MAGIC,
    version: ARCHIVE_VERSION,
    createdAt,
    device,
    // What the writer believed existed. A reader compares it to its own list
    // rather than assuming the two agree, because an archive outlives the
    // version that wrote it.
    entities: [...entities].sort(),
    stores: kept,
  };
}

/** Row counts, for something to show a person before and after. */
export function describeBody(body) {
  const counts = {};
  let records = 0;
  for (const [name, rows] of Object.entries(body?.stores ?? {})) {
    counts[name] = rows.length;
    if (!STORES.included.includes(name)) records += rows.length;
  }
  return {
    records,
    documents: counts.blobs ?? 0,
    events: counts.audit ?? 0,
    counts,
    createdAt: body?.createdAt ?? '',
    stores: Object.keys(counts).sort(),
  };
}

/* ------------------------------------------------------------- seal / open */

/**
 * Encrypt a body into the object that gets written to a file.
 *
 * The header is plaintext on purpose: a file has to be recognisable as an
 * archive, and its version readable, before anybody is asked for a phrase they
 * would then be told was wrong for a file that was never an archive at all.
 * Nothing in the header is about the household.
 */
export async function seal(body, phrase, { iterations = ITERATIONS } = {}) {
  const salt = newSalt();
  const key = await deriveKeyEncryptionKey(phrase, salt, iterations);
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const { iv, data } = await encryptBytes(key, bytes, MAGIC);

  return {
    magic: MAGIC,
    version: ARCHIVE_VERSION,
    createdAt: body.createdAt,
    kdf: { salt: toBase64(salt), iterations },
    iv,
    body: toBase64(data),
  };
}

/**
 * Read a sealed archive back.
 *
 * Every refusal names itself. "Could not open the archive" is the message that
 * sends somebody looking for a corrupt file when they typed the wrong phrase,
 * and looking for a typo when the file really is damaged.
 *
 * @returns {Promise<{ok: boolean, why?: string, body?: object}>}
 */
export async function open(file, phrase) {
  if (!file || typeof file !== 'object' || file.magic !== MAGIC) {
    return { ok: false, why: WHY.NOT_AN_ARCHIVE };
  }
  if (Number(file.version) > ARCHIVE_VERSION) {
    return { ok: false, why: WHY.FUTURE_VERSION };
  }
  if (!file.kdf?.salt || !file.iv || !file.body) {
    return { ok: false, why: WHY.DAMAGED };
  }

  let plaintext;
  try {
    const key = await deriveKeyEncryptionKey(
      phrase, fromBase64(file.kdf.salt), Number(file.kdf.iterations) || ITERATIONS,
    );
    plaintext = await decryptBytes(key, { iv: file.iv, data: fromBase64(file.body) }, MAGIC);
  } catch {
    // AES-GCM's tag fails the same way for a wrong key and for a flipped bit,
    // and there is no way to tell them apart from here. The wrong phrase is
    // overwhelmingly the likelier of the two, and saying so is more use than
    // refusing to guess.
    return { ok: false, why: WHY.WRONG_PHRASE };
  }

  let body;
  try {
    body = JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    return { ok: false, why: WHY.DAMAGED };
  }

  if (body?.magic !== MAGIC || !body.stores) return { ok: false, why: WHY.DAMAGED };
  return { ok: true, body };
}

/**
 * Read back what was just written, and check it is all there.
 *
 * A file written and never re-opened is the same mistake as an export with no
 * reader: it looks like a backup, it is treated as one, and whether it is one
 * is discovered on the day it matters. Sealing can go wrong in ways nothing
 * else here would notice — a phrase that verified against the keyring but was
 * typed differently the second time, a truncated write, an encoder that
 * mangled a surrogate pair in somebody's name.
 *
 * So the bytes that would be handed over are decrypted again with the same
 * phrase and counted against what went in. It costs one more PBKDF2
 * derivation, which is the cheapest insurance in this application.
 *
 * @returns {Promise<{ok: boolean, why?: string, found?: number, expected?: number}>}
 */
export async function verify(file, phrase, expected) {
  const opened = await open(file, phrase);
  if (!opened.ok) return { ok: false, why: opened.why };

  const found = describeBody(opened.body);
  if (found.records !== expected.records || found.documents !== expected.documents) {
    return {
      ok: false,
      why: WHY.UNVERIFIABLE,
      found: found.records,
      expected: expected.records,
    };
  }
  return { ok: true };
}

/* ---------------------------------------------------------------- restore */

/**
 * What restoring this archive onto this device would do — worked out before
 * anything is written, and refused rather than merged when it is not obvious.
 *
 * Restoring into a store that already holds records is a reconciliation
 * problem, not a copy: two records with the same id and different contents,
 * two edits of the same field on different devices, a deletion on one side.
 * This codebase has a sync engine that does that work with a shadow copy and a
 * three-way merge, and it has strong opinions about never forcing an uncertain
 * match. An archive restore has none of that context — no common ancestor, no
 * knowing which side is later — so it refuses, and says what is in the way.
 *
 * @param {object} body the opened archive
 * @param {{records: number, entities: string[]}} device what is here already
 * @returns {{ok: boolean, why?: string, unknown?: string[], holding?: number,
 *            writes?: {store: string, row: object}[], summary?: object}}
 */
export function planRestore(body, device) {
  if (!body?.stores?.meta?.length) {
    return { ok: false, why: WHY.NO_KEYRING };
  }

  const unknown = Object.keys(body.stores)
    .filter((name) => !STORES.included.includes(name))
    .filter((name) => !device.entities.includes(name));
  if (unknown.length) {
    return { ok: false, why: WHY.UNKNOWN_STORE, unknown };
  }

  if (device.records > 0) {
    return { ok: false, why: WHY.NOT_EMPTY, holding: device.records };
  }

  const writes = [];
  for (const [name, rows] of Object.entries(body.stores)) {
    for (const row of rows) writes.push({ store: name, row });
  }
  return { ok: true, writes, summary: describeBody(body) };
}
