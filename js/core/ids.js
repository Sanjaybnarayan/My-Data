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

/**
 * A short, human-readable name for the device this is running on.
 *
 * ## Why this exists
 *
 * The device registry gave an owner a list of opaque ids — `dev_01M0…` — and
 * asked them which one was the lost phone. That is not a question anybody can
 * answer, so the capability existed and the feature did not.
 *
 * ## What it is, and what it is not
 *
 * It is a **guess**, from the user-agent string, and it is treated as one
 * everywhere: the owner can rename any device, and the screen says the name
 * was worked out rather than told. User-agent strings are unreliable by design
 * — browsers have spent twenty years lying in them for compatibility — so a
 * name derived from one is a hint, not a fact.
 *
 * It is deliberately **coarse**. Platform and browser family, nothing else: no
 * version, no screen size, no font list, no language. Those are the ingredients
 * of a fingerprint, and this only needs to be enough to tell a phone from a
 * laptop. Two identical phones produce the same label and are told apart by
 * their ids and their first-seen dates, which is the right trade.
 */
export function deviceLabel(agent = globalThis.navigator?.userAgent ?? '') {
  const ua = String(agent);
  if (!ua) return 'Unknown device';

  // Order matters: an iPad reports "Macintosh" in desktop mode, and Edge and
  // Opera both carry "Chrome" in their strings.
  const platform = /iPhone/i.test(ua) ? 'iPhone'
    : /iPad/i.test(ua) ? 'iPad'
      : /Android/i.test(ua) ? 'Android'
        : /Windows/i.test(ua) ? 'Windows'
          : /Mac OS X|Macintosh/i.test(ua) ? 'Mac'
            : /Linux/i.test(ua) ? 'Linux'
              : '';

  const browser = /Edg\//i.test(ua) ? 'Edge'
    : /OPR\//i.test(ua) ? 'Opera'
      : /Firefox\//i.test(ua) ? 'Firefox'
        : /Chrome\//i.test(ua) ? 'Chrome'
          : /Safari\//i.test(ua) ? 'Safari'
            : '';

  const parts = [platform, browser].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Unknown device';
}
