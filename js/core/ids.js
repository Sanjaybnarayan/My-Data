/**
 * Identifiers.
 *
 * Record ids are lexicographically sortable by creation time, which is what
 * lets IndexedDB range-scan "newest first" off the primary key with no
 * secondary index, and lets the sync engine order two writes that share a
 * millisecond. The encoding is ULID: 48 bits of timestamp then 80 bits of
 * randomness, both in Crockford base32.
 *
 * Within a single millisecond the random half is incremented rather than
 * redrawn, so ids minted in a tight loop still sort in creation order.
 */

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford: no I, L, O, U
const TIME_LEN = 10;
const RANDOM_LEN = 16;

let lastTime = -1;
/** @type {number[]} the previous random half, as base32 digit values */
let lastRandom = [];

function randomDigits() {
  const bytes = new Uint8Array(RANDOM_LEN);
  globalThis.crypto.getRandomValues(bytes);
  // Each byte becomes one base32 digit. Taking the low 5 bits of a uniform
  // byte is itself uniform over 0..31, so there is no modulo bias.
  return Array.from(bytes, (b) => b & 0x1f);
}

/** Add one to the base32 digit array, carrying leftwards. */
function increment(digits) {
  for (let i = digits.length - 1; i >= 0; i--) {
    if (digits[i] < 31) {
      digits[i]++;
      return digits;
    }
    digits[i] = 0;
  }
  // Overflowed all 80 bits inside one millisecond, which cannot happen from
  // any real call site. Redraw rather than emit a duplicate.
  return randomDigits();
}

function encodeTime(ms) {
  let out = '';
  let n = ms;
  for (let i = 0; i < TIME_LEN; i++) {
    out = ALPHABET[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/**
 * @param {string} [prefix] short entity tag, e.g. `txn`. Kept out of the
 *   sortable portion so `id.slice(prefix.length + 1)` is still a ULID.
 * @param {number} [now] injectable clock, for tests
 */
export function newId(prefix = '', now = Date.now()) {
  if (now === lastTime) {
    lastRandom = increment(lastRandom);
  } else {
    lastTime = now;
    lastRandom = randomDigits();
  }
  const body = encodeTime(now) + lastRandom.map((d) => ALPHABET[d]).join('');
  return prefix ? `${prefix}_${body}` : body;
}

/** Milliseconds encoded in an id, or NaN if it is not one of ours. */
export function idTime(id) {
  const body = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id;
  if (body.length !== TIME_LEN + RANDOM_LEN) return NaN;
  let n = 0;
  for (let i = 0; i < TIME_LEN; i++) {
    const d = ALPHABET.indexOf(body[i]);
    if (d < 0) return NaN;
    n = n * 32 + d;
  }
  return n;
}

export function isId(value) {
  return typeof value === 'string' && Number.isFinite(idTime(value));
}

/**
 * A stable per-installation device id. Two devices must never share one:
 * conflict resolution uses it as the final tie-break, and a collision would
 * let two devices disagree forever.
 */
export function deviceId(storage) {
  const KEY = 'familyos.deviceId';
  let id = storage.getItem(KEY);
  if (!id) {
    id = newId('dev');
    storage.setItem(KEY, id);
  }
  return id;
}
