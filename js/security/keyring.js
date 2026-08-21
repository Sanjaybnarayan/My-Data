/**
 * The keyring — the only object that ever holds the unwrapped data key.
 *
 * It is deliberately small and deliberately boring. Everything that needs to
 * encrypt asks the keyring for the key; nothing stores a reference to it, so
 * `lock()` genuinely takes the ability away rather than leaving copies behind
 * in half the modules.
 *
 * Wrapped keys live in the `meta` store as one record per unlock method. A
 * method is added by unwrapping with an existing one and re-wrapping with the
 * new one, which is why enrolling a fingerprint requires the PIN first.
 */

import {
  generateDataKey, deriveKeyEncryptionKey, importKeyEncryptionKey,
  wrapDataKey, unwrapDataKey, newSalt, toBase64, fromBase64,
} from './crypto.js';
import { LockedError, AppError } from '../core/errors.js';
import { bus, TOPIC } from '../core/bus.js';

const META_KEY = 'keyring';

/** @typedef {{method: 'pin'|'webauthn'|'recovery', salt?: string,
 *             iterations?: number, iv: string, key: string, label?: string,
 *             createdAt: string}} WrappedKey */

export class Keyring {
  #meta;
  #iterations;
  #dataKey = null;
  #methods = null;

  /**
   * @param {{get(key: string): Promise<any>, set(key: string, value: any): Promise<void>}} meta
   * @param {number} iterations PBKDF2 rounds for PIN-derived keys
   */
  constructor(meta, iterations = 600_000) {
    this.#meta = meta;
    this.#iterations = iterations;
  }

  get isUnlocked() {
    return this.#dataKey !== null;
  }

  /** Throws rather than returning null, so a caller cannot forget to check. */
  get key() {
    if (!this.#dataKey) throw new LockedError();
    return this.#dataKey;
  }

  async #load() {
    if (!this.#methods) this.#methods = (await this.#meta.get(META_KEY))?.methods ?? [];
    return this.#methods;
  }

  async #save() {
    await this.#meta.set(META_KEY, { methods: this.#methods });
  }

  async isEnrolled() {
    return (await this.#load()).length > 0;
  }

  async methods() {
    return (await this.#load()).map(({ method, label, createdAt }) => ({ method, label, createdAt }));
  }

  /**
   * First run: mint the data key and wrap it under a PIN. Refuses to run a
   * second time — a second enrolment would orphan every record encrypted
   * under the first key, which looks exactly like data loss.
   */
  async enrolPin(pin) {
    if (await this.isEnrolled()) {
      throw new AppError('this device already has a data key', { code: 'already-enrolled' });
    }
    assertPin(pin);
    const dataKey = await generateDataKey();
    const salt = newSalt();
    const kek = await deriveKeyEncryptionKey(pin, salt, this.#iterations);
    const wrapped = await wrapDataKey(dataKey, kek);

    this.#methods = [{
      method: 'pin',
      salt: toBase64(salt),
      iterations: this.#iterations,
      ...wrapped,
      createdAt: new Date().toISOString(),
    }];
    await this.#save();
    this.#dataKey = dataKey;
    bus.emit(TOPIC.unlocked, { method: 'pin' });
    return dataKey;
  }

  /**
   * First run, without a PIN: mint the data key and wrap it under 32 bytes
   * somebody else is holding for us.
   *
   * The counterpart to `enrolPin` for the sign-in-with-Google path, where the
   * wrapping key lives in the household's own Drive rather than in their head.
   * Identical in every other respect — same data key, same wrapping, same
   * refusal to run twice — because the difference between the two is *where
   * the key that unwraps it is kept*, and nothing else.
   *
   * @param {Uint8Array} rawKey 32 bytes
   */
  async enrolRawKey(rawKey, method = 'google', label = '') {
    if (await this.isEnrolled()) {
      throw new AppError('this device already has a data key', { code: 'already-enrolled' });
    }
    if (!(rawKey?.length === 32)) {
      throw new AppError('an unlock key must be 32 bytes', { code: 'bad-key' });
    }

    const dataKey = await generateDataKey();
    const kek = await importKeyEncryptionKey(rawKey);
    const wrapped = await wrapDataKey(dataKey, kek);

    this.#methods = [{
      method, ...wrapped, label, createdAt: new Date().toISOString(),
    }];
    await this.#save();
    this.#dataKey = dataKey;
    bus.emit(TOPIC.unlocked, { method });
    return dataKey;
  }

  /**
   * The stored wrapping for one method, so it can be published somewhere a
   * second device will find it. Ciphertext, and useless without the key that
   * opens it — which is why handing this out is safe and handing out
   * `this.key` would not be.
   */
  async wrappedFor(method) {
    const entry = (await this.#load()).find((m) => m.method === method);
    return entry ? { iv: entry.iv, key: entry.key } : null;
  }

  /**
   * Install a wrapping made somewhere else — the second-device case.
   *
   * The only way a keyring acquires a data key it did not mint, and
   * deliberately restricted to a device that has none of its own. Adopting
   * onto an enrolled device would leave two entries wrapping two *different*
   * data keys, and whichever one you unlocked with would silently fail to
   * decrypt half the records.
   *
   * Nothing is verified here because nothing can be: a wrapping that does not
   * open is indistinguishable from a wrong key until it is tried. The unlock
   * that follows is the check.
   *
   * @param {{iv: string, key: string}} wrapped
   */
  async adoptWrapped(method, wrapped, label = '') {
    if (await this.isEnrolled()) {
      throw new AppError('this device already has a data key', { code: 'already-enrolled' });
    }
    if (!wrapped?.iv || !wrapped?.key) {
      throw new AppError('there is no wrapped key to adopt', { code: 'bad-wrap' });
    }
    this.#methods = [{
      method, iv: wrapped.iv, key: wrapped.key, label,
      createdAt: new Date().toISOString(),
    }];
    await this.#save();
  }

  async unlockWithPin(pin) {
    const entry = (await this.#load()).find((m) => m.method === 'pin');
    if (!entry) throw new LockedError('no PIN is enrolled on this device');
    const kek = await deriveKeyEncryptionKey(pin, fromBase64(entry.salt), entry.iterations);
    try {
      this.#dataKey = await unwrapDataKey(entry, kek);
    } catch {
      // Any failure here is a wrong PIN; GCM does not distinguish.
      throw new LockedError('that PIN is not right');
    }
    bus.emit(TOPIC.unlocked, { method: 'pin' });
    return this.#dataKey;
  }

  /** @param {Uint8Array} rawKey 32 bytes from the authenticator's PRF output */
  async unlockWithRawKey(rawKey, method = 'webauthn') {
    const entry = (await this.#load()).find((m) => m.method === method);
    if (!entry) throw new LockedError(`no ${method} key is enrolled on this device`);
    const kek = await importKeyEncryptionKey(rawKey);
    try {
      this.#dataKey = await unwrapDataKey(entry, kek);
    } catch {
      throw new LockedError('that credential did not unlock this device');
    }
    bus.emit(TOPIC.unlocked, { method });
    return this.#dataKey;
  }

  /** Wrap the current data key under another method. Requires being unlocked. */
  async addMethod(method, { rawKey, label } = {}) {
    const dataKey = this.key;
    const kek = await importKeyEncryptionKey(rawKey);
    const wrapped = await wrapDataKey(dataKey, kek);
    this.#methods = [
      ...(await this.#load()).filter((m) => m.method !== method),
      { method, ...wrapped, label, createdAt: new Date().toISOString() },
    ];
    await this.#save();
  }

  async removeMethod(method) {
    const remaining = (await this.#load()).filter((m) => m.method !== method);
    if (remaining.length === 0) {
      throw new AppError('removing the last unlock method would lock the data away for good',
        { code: 'last-method' });
    }
    this.#methods = remaining;
    await this.#save();
  }

  /**
   * Change the PIN by re-wrapping the same data key. Nothing stored is
   * re-encrypted, which is the point of the two-level hierarchy.
   */
  async changePin(currentPin, nextPin) {
    assertPin(nextPin);
    await this.unlockWithPin(currentPin);
    const salt = newSalt();
    const kek = await deriveKeyEncryptionKey(nextPin, salt, this.#iterations);
    const wrapped = await wrapDataKey(this.key, kek);
    this.#methods = [
      ...(await this.#load()).filter((m) => m.method !== 'pin'),
      {
        method: 'pin',
        salt: toBase64(salt),
        iterations: this.#iterations,
        ...wrapped,
        createdAt: new Date().toISOString(),
      },
    ];
    await this.#save();
  }

  /**
   * A recovery phrase is a third wrapping of the same key. Printed once,
   * stored off the device; without it, a forgotten PIN on a device that has
   * never synced is unrecoverable, and no amount of support can change that.
   */
  async createRecoveryKey(phrase) {
    const dataKey = this.key;
    const salt = newSalt();
    const kek = await deriveKeyEncryptionKey(phrase, salt, this.#iterations);
    const wrapped = await wrapDataKey(dataKey, kek);
    this.#methods = [
      ...(await this.#load()).filter((m) => m.method !== 'recovery'),
      {
        method: 'recovery',
        salt: toBase64(salt),
        iterations: this.#iterations,
        ...wrapped,
        createdAt: new Date().toISOString(),
      },
    ];
    await this.#save();
    return phrase;
  }

  async unlockWithRecoveryPhrase(phrase) {
    const entry = (await this.#load()).find((m) => m.method === 'recovery');
    if (!entry) throw new LockedError('no recovery phrase was ever created');
    const kek = await deriveKeyEncryptionKey(phrase, fromBase64(entry.salt), entry.iterations);
    try {
      this.#dataKey = await unwrapDataKey(entry, kek);
    } catch {
      throw new LockedError('that recovery phrase is not right');
    }
    bus.emit(TOPIC.unlocked, { method: 'recovery' });
    return this.#dataKey;
  }

  lock() {
    // Dropping the reference is all a page can do: `CryptoKey` is opaque and
    // its bytes are not reachable from script to overwrite.
    this.#dataKey = null;
    bus.emit(TOPIC.locked, {});
  }

  /**
   * Forget what is cached, and read the store again next time.
   *
   * `#methods` is held in memory because unlocking should not re-read the
   * store on every attempt. That is right until something replaces the wrapped
   * keys underneath it — which is exactly what restoring an archive does. The
   * keyring would then unlock, successfully, to *this* device's old data key,
   * and every envelope that arrived with the archive would be ciphertext it
   * could not open. A restore that appears to work and leaves a household's
   * document numbers permanently unreadable is the worst outcome this feature
   * has, and it is indistinguishable from success without this.
   *
   * The application reloads after a restore, and a fresh page would have read
   * the new rows anyway. This exists so that correctness does not depend on
   * the caller remembering to.
   */
  forget() {
    this.#methods = null;
    this.#dataKey = null;
  }

  /** Wipe every wrapped key. The data becomes unreadable — that is the point. */
  async reset() {
    this.#methods = [];
    this.#dataKey = null;
    await this.#save();
  }
}

function assertPin(pin) {
  if (typeof pin !== 'string' || !/^\d{4,12}$/.test(pin)) {
    throw new AppError('a PIN must be 4 to 12 digits', { code: 'weak-pin' });
  }
  if (/^(\d)\1+$/.test(pin)) {
    throw new AppError('a PIN of one repeated digit is guessed first', { code: 'weak-pin' });
  }
  const ascending = '01234567890';
  const descending = '09876543210';
  if (ascending.includes(pin) || descending.includes(pin)) {
    throw new AppError('a run of consecutive digits is guessed second', { code: 'weak-pin' });
  }
}

export const _assertPin = assertPin;
