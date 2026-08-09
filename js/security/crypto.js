/**
 * Cryptographic primitives. WebCrypto only — no bundled implementation of
 * anything a browser already ships and audits.
 *
 * ## The key hierarchy
 *
 *   PIN ──PBKDF2-SHA256──▶ KEK ──AES-GCM wrap──▶ DEK ──AES-GCM──▶ field data
 *   WebAuthn PRF ─────────▶ KEK ──────────────▶ (the same DEK)
 *
 * The data encryption key is random and never leaves memory unwrapped. Every
 * unlock method wraps a copy of it. That is what lets the PIN change, or a
 * fingerprint be enrolled, without re-encrypting a single record — and it is
 * why losing every unlock method means losing the data, which the recovery
 * kit in `docs/SETUP.md` exists to prevent.
 *
 * ## Associated data
 *
 * Every ciphertext is bound to where it lives: `entity/id/field`. Moving a
 * ciphertext from one cell of the spreadsheet to another — swapping one
 * person's Aadhaar onto another's row — fails to decrypt instead of silently
 * succeeding. GCM gives this for free through its AAD parameter; not using it
 * would be leaving integrity on the table.
 */

const subtle = () => {
  const c = globalThis.crypto?.subtle;
  if (!c) throw new Error('WebCrypto is unavailable — FamilyOS needs a secure context (https or localhost)');
  return c;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const ENVELOPE_PREFIX = 'enc:v1:';
const IV_BYTES = 12;   // 96 bits, the size GCM is defined for
const SALT_BYTES = 16;
const KEY_BITS = 256;

/* ------------------------------------------------------------- encodings */

export function randomBytes(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  // Chunked: `String.fromCharCode(...huge)` blows the argument limit.
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text) {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/* ------------------------------------------------------------------ keys */

/** A fresh 256-bit data key. Extractable so it can be wrapped for storage. */
export async function generateDataKey() {
  return subtle().generateKey({ name: 'AES-GCM', length: KEY_BITS }, true, ['encrypt', 'decrypt']);
}

export function newSalt() {
  return randomBytes(SALT_BYTES);
}

/**
 * Stretch a PIN or passphrase into a key-encryption key.
 *
 * A four-digit PIN has fourteen bits of entropy; no iteration count fixes
 * that against an attacker who has the wrapped key. What the iterations buy
 * is time against an attacker who has *the device*, which is the realistic
 * case, and it is why `unlock.js` also enforces an attempt limit — the two
 * together are the defence, neither alone.
 */
export async function deriveKeyEncryptionKey(secret, salt, iterations) {
  const material = await subtle().importKey(
    'raw', encoder.encode(secret), 'PBKDF2', false, ['deriveKey'],
  );
  return subtle().deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
}

/**
 * The raw bytes of a data key.
 *
 * Only used to answer "are these two the same key?", which cannot be asked of
 * two `CryptoKey` objects directly — they are opaque and never equal. Keep the
 * answer, not the bytes.
 */
export async function exportKeyBytes(key) {
  return new Uint8Array(await subtle().exportKey('raw', key));
}

/** Import raw key bytes — used by the WebAuthn PRF path, which supplies 32. */
export async function importKeyEncryptionKey(rawBytes) {
  return subtle().importKey(
    'raw', rawBytes, { name: 'AES-GCM', length: KEY_BITS }, false,
    ['wrapKey', 'unwrapKey', 'encrypt', 'decrypt'],
  );
}

/** @returns {{iv: string, key: string}} both base64, safe to persist */
export async function wrapDataKey(dataKey, kek) {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey('raw', dataKey, kek, { name: 'AES-GCM', iv });
  return { iv: toBase64(iv), key: toBase64(wrapped) };
}

/** Throws if the PIN is wrong — GCM's tag is the check, so there is no
 *  separate "verifier" value to store or to leak. */
export async function unwrapDataKey({ iv, key }, kek) {
  return subtle().unwrapKey(
    'raw', fromBase64(key), kek, { name: 'AES-GCM', iv: fromBase64(iv) },
    { name: 'AES-GCM', length: KEY_BITS }, true, ['encrypt', 'decrypt'],
  );
}

/* ------------------------------------------------------------ encryption */

/**
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @param {string} [aad] context this ciphertext is valid in
 * @returns {Promise<string>} `enc:v1:<iv>:<ciphertext>`
 */
export async function encryptText(key, plaintext, aad = '') {
  const iv = randomBytes(IV_BYTES);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = encoder.encode(aad);
  const ct = await subtle().encrypt(params, key, encoder.encode(plaintext));
  return `${ENVELOPE_PREFIX}${toBase64(iv)}:${toBase64(ct)}`;
}

export async function decryptText(key, envelope, aad = '') {
  if (!isEncrypted(envelope)) return envelope;
  const [iv, ct] = envelope.slice(ENVELOPE_PREFIX.length).split(':');
  const params = { name: 'AES-GCM', iv: fromBase64(iv) };
  if (aad) params.additionalData = encoder.encode(aad);
  const plain = await subtle().decrypt(params, key, fromBase64(ct));
  return decoder.decode(plain);
}

export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);
}

/** Binary payloads — document blobs held on the device before upload. */
export async function encryptBytes(key, bytes, aad = '') {
  const iv = randomBytes(IV_BYTES);
  const params = { name: 'AES-GCM', iv };
  if (aad) params.additionalData = encoder.encode(aad);
  const ct = await subtle().encrypt(params, key, bytes);
  return { iv: toBase64(iv), data: new Uint8Array(ct) };
}

export async function decryptBytes(key, { iv, data }, aad = '') {
  const params = { name: 'AES-GCM', iv: fromBase64(iv) };
  if (aad) params.additionalData = encoder.encode(aad);
  return new Uint8Array(await subtle().decrypt(params, key, data));
}

/* ---------------------------------------------------------------- digests */

export async function sha256(text) {
  const digest = await subtle().digest('SHA-256', encoder.encode(text));
  return toBase64(digest);
}

/**
 * Constant-time comparison. Used on backup checksums and TOTP codes, where a
 * short-circuiting `===` leaks how much of the value was right.
 */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // Length is not secret here; content is.
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/* ------------------------------------------------------- password strength */

/**
 * Entropy in bits, from the character classes actually used. Deliberately
 * conservative — it measures the search space, not whether the password is in
 * a breach list, and the UI says so.
 */
export function passwordEntropy(password) {
  if (!password) return 0;
  let space = 0;
  if (/[a-z]/.test(password)) space += 26;
  if (/[A-Z]/.test(password)) space += 26;
  if (/[0-9]/.test(password)) space += 10;
  if (/[^a-zA-Z0-9]/.test(password)) space += 33;
  const unique = new Set(password).size;
  // A long run of one character is not long: "aaaaaaaaaaaa" scores as ~3.
  const effectiveLength = Math.min(password.length, unique * 2);
  return Math.round(effectiveLength * Math.log2(space || 1));
}

export function passwordStrength(password) {
  const bits = passwordEntropy(password);
  if (bits < 28) return { bits, label: 'very weak', score: 0 };
  if (bits < 40) return { bits, label: 'weak', score: 1 };
  if (bits < 60) return { bits, label: 'fair', score: 2 };
  if (bits < 90) return { bits, label: 'strong', score: 3 };
  return { bits, label: 'very strong', score: 4 };
}

const AMBIGUOUS = /[Il1O0]/g;

/**
 * Generate a password. Rejection sampling on a byte, not modulo, so every
 * character in the set is equally likely — a biased generator is a weaker
 * password than its length suggests.
 */
export function generatePassword({
  length = 20, lower = true, upper = true, digits = true, symbols = true,
  avoidAmbiguous = true,
} = {}) {
  let set = '';
  if (lower) set += 'abcdefghijklmnopqrstuvwxyz';
  if (upper) set += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (digits) set += '0123456789';
  if (symbols) set += '!@#$%^&*()-_=+[]{};:,.?';
  if (avoidAmbiguous) set = set.replace(AMBIGUOUS, '');
  if (!set) throw new Error('a password needs at least one character set');

  const limit = 256 - (256 % set.length);
  const out = [];
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte >= limit) continue;
      out.push(set[byte % set.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

/** A memorable alternative, for a PIN-protected device the family shares. */
const WORDS = ['amber', 'anchor', 'basil', 'bridge', 'cactus', 'candle', 'cedar',
  'copper', 'coral', 'delta', 'ember', 'falcon', 'garnet', 'harbour', 'indigo',
  'ivory', 'jasmine', 'jupiter', 'kettle', 'lantern', 'lotus', 'marble', 'meadow',
  'nectar', 'olive', 'onyx', 'pepper', 'quartz', 'raven', 'saffron', 'sierra',
  'tamarind', 'umbra', 'velvet', 'walnut', 'willow', 'yarrow', 'zephyr'];

export function generatePassphrase(words = 5, separator = '-') {
  const limit = 256 - (256 % WORDS.length);
  const chosen = [];
  while (chosen.length < words) {
    for (const byte of randomBytes(words * 2)) {
      if (byte >= limit) continue;
      chosen.push(WORDS[byte % WORDS.length]);
      if (chosen.length === words) break;
    }
  }
  return chosen.join(separator);
}
