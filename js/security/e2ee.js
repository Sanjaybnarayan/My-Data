/**
 * End-to-end encryption for family chat.
 *
 * ## What this provides, exactly
 *
 * A message is encrypted with a fresh random content key. That key is then
 * wrapped once per recipient *device*, using a secret only that device and the
 * sender can derive. Nothing else in the system can read it: not the Google
 * Sheet the row syncs through, not a household member outside the
 * conversation, not the household data key that protects every other table.
 *
 * The shared secret is ECDH on P-256 between the sender's device key and the
 * recipient's, run through HKDF-SHA-256 into an AES-GCM wrapping key. Because
 * only the sender's private key can produce that secret, a wrapped key that
 * opens is also evidence the message came from the sender's device — so there
 * is no separate signing key. Fewer keys is fewer things to get wrong, and
 * this is not a system that needs to prove authorship to a third party.
 *
 * ## What this does NOT provide, and none of it is hedging
 *
 * **No forward secrecy.** Device keys are long-lived. Somebody who takes a
 * device's private key can read every message ever sent to it, past included.
 * A Double Ratchet is what fixes that, and an unaudited hand-rolled ratchet is
 * worse than not having one — so it is absent and said so rather than
 * approximated.
 *
 * **No post-compromise security.** Following from the same fact: a compromised
 * device stays compromised until its key is revoked and a new one enrolled.
 *
 * **No external audit.** This is standard Web Crypto composed carefully and
 * tested hard. It has not been reviewed by a cryptographer, and
 * `docs/CHAT_AND_E2EE.md` says so where somebody deciding whether to trust it
 * will read it.
 *
 * **The recovery phrase reads everything.** The household chose escrow, so
 * every message is sealed to one extra recipient: an escrow keypair whose
 * private half is wrapped under a key derived from the recovery phrase and
 * nothing else. A restored archive can therefore open old conversations. That
 * is a deliberate trade and it is the largest hole in the property above —
 * whoever holds the phrase holds every conversation, including ones they were
 * never part of. It is stated on the screen, not only here.
 *
 * What escrow is *not* wrapped under matters as much: not the PIN, and not the
 * household data key. A member who can unlock the application still cannot
 * read a conversation they are not in.
 *
 * ## Why the wrapping is per device and not per person
 *
 * A person is not a key. A person has phones, and a phone is what holds a
 * private key. Wrapping to a person would mean one key shared between their
 * devices, which is a key that has to be copied between devices — and a key
 * that gets copied is a key that leaks.
 */

import { randomBytes, toBase64, fromBase64 } from './crypto.js';
import { AppError } from '../core/errors.js';

const subtle = () => globalThis.crypto?.subtle;

const CURVE = 'P-256';
const IV_BYTES = 12;
const KEY_BITS = 256;

/** Bumped when the envelope shape changes in a way an old reader cannot parse. */
export const SEALED_VERSION = 1;

/**
 * The escrow recipient's id.
 *
 * Escrow is an ECDH keypair like any device, listed like any device, and
 * unwrapped by exactly the same code — the only difference is where its
 * private key lives. It is wrapped under a key derived from the recovery
 * phrase **and nothing else**: not the PIN, not the household data key. So a
 * household member who can unlock the app cannot read a conversation they are
 * not in; somebody holding the recovery phrase can read all of them.
 *
 * That is the trade the household chose, and putting escrow through the same
 * path as a device is what stops it becoming a second, subtly different one.
 */
export const ESCROW_ID = 'escrow:recovery';

/** Binds a wrap to its purpose, so a key wrapped for one thing cannot open another. */
const INFO = new TextEncoder().encode('familyos/chat/v1');

/* ------------------------------------------------------------- identities */

/**
 * A new device identity.
 *
 * `privateKey` is extractable on purpose: it has to be exported to be stored,
 * and it is stored wrapped in the household's own encrypted `meta` store — so
 * it is protected at rest by the PIN like everything else. Non-extractable
 * would mean a key that cannot survive a page reload, which is not a stronger
 * system, only a broken one.
 */
export async function createIdentity() {
  const pair = await subtle().generateKey(
    { name: 'ECDH', namedCurve: CURVE }, true, ['deriveBits'],
  );
  return {
    publicKey: toBase64(new Uint8Array(await subtle().exportKey('spki', pair.publicKey))),
    privateKey: toBase64(new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey))),
  };
}

export async function importPublic(base64) {
  return subtle().importKey(
    'spki', fromBase64(base64), { name: 'ECDH', namedCurve: CURVE }, true, [],
  );
}

export async function importPrivate(base64) {
  return subtle().importKey(
    'pkcs8', fromBase64(base64), { name: 'ECDH', namedCurve: CURVE }, false, ['deriveBits'],
  );
}

/**
 * The number two people read to each other to check nobody is in the middle.
 *
 * Both public keys, sorted so the two ends produce the same string, hashed,
 * and shown as digits — digits because they are read aloud over a phone call,
 * and hex is miserable to read aloud.
 */
export async function safetyNumber(publicKeyA, publicKeyB) {
  const [first, second] = [String(publicKeyA), String(publicKeyB)].sort();
  const bytes = new TextEncoder().encode(`${first}\n${second}`);
  const digest = new Uint8Array(await subtle().digest('SHA-256', bytes));

  // 60 digits in 12 groups of 5, the shape Signal settled on for the same
  // reason: short enough to read, long enough that a collision is not the
  // weak point.
  const groups = [];
  for (let i = 0; i < 12; i += 1) {
    const chunk = digest.slice(i * 2, (i * 2) + 2);
    groups.push(String((chunk[0] << 8) | chunk[1]).padStart(5, '0'));
  }
  return groups.join(' ');
}

/* ------------------------------------------------------------- the sealing */

async function wrappingKey(privateKey, publicKey, salt) {
  const bits = await subtle().deriveBits(
    { name: 'ECDH', public: publicKey }, privateKey, KEY_BITS,
  );
  const material = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: INFO },
    material,
    { name: 'AES-GCM', length: KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Seal a message to a set of recipient devices.
 *
 * @param {string} plaintext
 * @param {{privateKey: string, publicKey: string}} sender the sending device
 * @param {Array<{id: string, publicKey: string}>} recipients devices, not people
 * @param {{escrowPublicKey?: string|null}} [options] the escrow public key,
 *   when escrow is on. Listed like a device, so a reader can see it is there
 *   rather than discovering it in a spec.
 */
export async function seal(plaintext, sender, recipients, options = {}) {
  return sealBytes(new TextEncoder().encode(plaintext), sender, recipients, options);
}

/**
 * The same thing, for bytes.
 *
 * Text and files travel identically because they are the same problem: a
 * content key, wrapped once per recipient device. `seal` is a wrapper around
 * this rather than a sibling of it, because a second copy of the key-wrapping
 * would be a second copy of the part where being wrong is unrecoverable —
 * and the two would drift the first time either was touched.
 *
 * The wire format is unchanged, so a message sealed before this existed still
 * opens. A test asserts exactly that.
 */
export async function sealBytes(bytes, sender, recipients, { escrowPublicKey = null } = {}) {
  if (!recipients?.length && !escrowPublicKey) {
    // A message nobody can open is not a private message, it is a lost one.
    throw new AppError('a message must be sealed to at least one device', { code: 'noRecipients' });
  }

  const contentKey = await subtle().generateKey(
    { name: 'AES-GCM', length: KEY_BITS }, true, ['encrypt', 'decrypt'],
  );
  const iv = randomBytes(IV_BYTES);
  const ciphertext = new Uint8Array(await subtle().encrypt(
    { name: 'AES-GCM', iv }, contentKey, bytes,
  ));

  const senderPrivate = await importPrivate(sender.privateKey);
  const raw = new Uint8Array(await subtle().exportKey('raw', contentKey));

  // Escrow is appended to the recipient list rather than handled after it.
  const all = [...(recipients ?? [])];
  if (escrowPublicKey) all.push({ id: ESCROW_ID, publicKey: escrowPublicKey });

  const keys = [];
  for (const device of all) {
    const salt = randomBytes(32);
    const wrapper = await wrappingKey(senderPrivate, await importPublic(device.publicKey), salt);
    const wrapIv = randomBytes(IV_BYTES);
    const wrapped = new Uint8Array(await subtle().encrypt(
      { name: 'AES-GCM', iv: wrapIv }, wrapper, raw,
    ));
    keys.push({
      device: device.id,
      salt: toBase64(salt),
      iv: toBase64(wrapIv),
      key: toBase64(wrapped),
    });
  }

  return {
    v: SEALED_VERSION,
    from: sender.publicKey,
    iv: toBase64(iv),
    body: toBase64(ciphertext),
    keys,
  };
}

/**
 * Open a sealed message with this device's key.
 *
 * Throws rather than returning null. A message that cannot be opened is a
 * fact worth surfacing — the usual cause is a device enrolled after the
 * message was sent, and a screen showing a blank line instead of saying so is
 * how somebody concludes the app lost their messages.
 */
export async function openBytes(sealed, device, { escrow = null } = {}) {
  if (Number(sealed?.v) !== SEALED_VERSION) {
    throw new AppError('this message was written by a newer version of FamilyOS',
      { code: 'sealedVersion' });
  }

  const raw = await unwrapContentKey(sealed, device, escrow);
  const contentKey = await subtle().importKey(
    'raw', raw, { name: 'AES-GCM', length: KEY_BITS }, false, ['decrypt'],
  );

  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: fromBase64(sealed.iv) }, contentKey, fromBase64(sealed.body),
  );
  return new Uint8Array(plain);
}

/** A sealed message as text. See `openBytes` for why this is the wrapper. */
export async function open(sealed, device, options = {}) {
  return new TextDecoder().decode(await openBytes(sealed, device, options));
}

async function unwrapContentKey(sealed, device, escrow) {
  // The device's own wrap first, then escrow. Identical code either way,
  // because escrow *is* a device as far as this is concerned.
  const candidates = [
    device?.id ? { id: device.id, key: device.privateKey } : null,
    escrow?.privateKey ? { id: ESCROW_ID, key: escrow.privateKey } : null,
  ].filter(Boolean);

  let attempted = false;
  for (const candidate of candidates) {
    const wrap = (sealed.keys ?? []).find((k) => k.device === candidate.id);
    if (!wrap) continue;
    attempted = true;
    try {
      const wrapper = await wrappingKey(
        await importPrivate(candidate.key),
        await importPublic(sealed.from),
        fromBase64(wrap.salt),
      );
      return new Uint8Array(await subtle().decrypt(
        { name: 'AES-GCM', iv: fromBase64(wrap.iv) }, wrapper, fromBase64(wrap.key),
      ));
    } catch {
      // Keep going. A wrap addressed to this device id that will not open is
      // the re-installed-device case: same id, new keypair. Escrow can still
      // read it, and stopping at the first failure would hide a message that
      // is genuinely recoverable.
      continue;
    }
  }

  throw new AppError(
    attempted
      ? 'this message was sealed to this device before its key changed'
      : 'this device was not one of the recipients of this message',
    { code: attempted ? 'keyChanged' : 'notARecipient' },
  );
}

/** Can this device open this message at all, without trying? */
export function addressedTo(sealed, deviceId) {
  return (sealed?.keys ?? []).some((k) => k.device === deviceId);
}

/**
 * Who a message was sealed to, for a screen that explains an absence.
 *
 * Escrow is reported separately rather than counted as a device, because "this
 * went to two phones and the recovery phrase" and "this went to three phones"
 * are different sentences and only one of them is true.
 */
export function sealedTo(sealed) {
  const ids = (sealed?.keys ?? []).map((k) => k.device);
  return {
    devices: ids.filter((id) => id !== ESCROW_ID),
    escrowed: ids.includes(ESCROW_ID),
  };
}
