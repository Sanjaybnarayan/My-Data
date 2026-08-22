/**
 * Family chat: enrolling a device, sealing a message, opening one.
 *
 * The crypto is in `security/e2ee.js` and decides nothing about the household.
 * This is the only place that knows a recipient is a `person` with `deviceKey`
 * rows, that a revoked device must be left out, and that a message that cannot
 * be opened is a sentence rather than a crash.
 *
 * ## The private key never goes near a table
 *
 * A device's private half lives in the `meta` store, which is local and never
 * syncs. It is *not* in `deviceKey`: that table syncs through the household's
 * Google Sheet, and a private key in a spreadsheet is not a private key. The
 * public half goes in the table, which is what a table is for.
 *
 * ## Every send answers three questions before it seals
 *
 * Who is in this conversation, which of their devices are still valid, and is
 * there anything to seal to at all. The third is not paranoia: a conversation
 * whose only other participant has never opened the app has no devices, and
 * sealing to nobody produces a message the sender cannot read back either.
 * `security/e2ee.js` refuses it, and this reports why.
 */

import { Service } from './service.js';
import {
  createIdentity, seal, open, sealBytes, openBytes, safetyNumber, sealedTo, ESCROW_ID,
} from '../security/e2ee.js';
import { AppError } from '../core/errors.js';
import { newId } from '../core/ids.js';

const DEVICE_KEY = 'chat.deviceIdentity';
const ESCROW_KEY = 'chat.escrowIdentity';

export class ChatService extends Service {
  /* ------------------------------------------------------------- identity */

  /**
   * This device's identity, made on first use.
   *
   * Idempotent: enrolling twice would leave a second public key in the table
   * and half the household sealing to a key this device no longer has.
   */
  async enrol(personId, { label = '' } = {}) {
    const deviceId = this.db.deviceId;
    const existing = await this.identity();
    const rows = await this.repo('deviceKey').list({ limit: 500 });
    const mine = rows.find((r) => r.deviceId === deviceId && !r.deletedAt && !r.revokedAt);

    if (existing && mine) return { device: mine, created: false };

    const identity = existing ?? await createIdentity();
    if (!existing) await this.db.setMeta(DEVICE_KEY, identity);

    const device = mine ?? await this.repo('deviceKey').create({
      person: personId,
      deviceId,
      label,
      publicKey: identity.publicKey,
      fingerprint: await safetyNumber(identity.publicKey, identity.publicKey),
      addedAt: new Date().toISOString(),
    });

    return { device, created: true };
  }

  /** This device's keypair, or null before it has been enrolled. */
  async identity() {
    const stored = await this.db.meta(DEVICE_KEY);
    return stored?.publicKey && stored?.privateKey ? stored : null;
  }

  /**
   * The escrow keypair, made once for the household.
   *
   * Only the public half is returned here. The private half is handed to the
   * caller exactly once, at creation, so it can be wrapped under the recovery
   * phrase and never stored anywhere this service can reach — which is the
   * entire point of it.
   */
  async escrowPublicKey() {
    const stored = await this.db.meta(ESCROW_KEY);
    return stored?.publicKey ?? null;
  }

  async createEscrow() {
    const existing = await this.db.meta(ESCROW_KEY);
    if (existing?.publicKey) return { publicKey: existing.publicKey, privateKey: null };

    const identity = await createIdentity();
    // Public half only. Storing the private half here would make escrow
    // readable by anything that can read `meta` — which is anything that can
    // unlock the app, and that is precisely who escrow is meant to exclude.
    await this.db.setMeta(ESCROW_KEY, { publicKey: identity.publicKey });
    return identity;
  }

  /* ------------------------------------------------------------- devices */

  /** Every enrolled device, for a screen that lists them. */
  async devices() {
    const rows = await this.repo('deviceKey').list({ limit: 200 });
    return rows.filter((r) => !r.deletedAt);
  }

  /** Devices that may still be sealed to, for a set of people. */
  async devicesFor(personIds) {
    const wanted = new Set(personIds ?? []);
    const rows = await this.repo('deviceKey').list({ limit: 500 });
    return rows.filter((r) => !r.deletedAt && !r.revokedAt && wanted.has(r.person));
  }

  /**
   * Stop sealing to a device.
   *
   * Revocation is forward-only and says so. The messages already sealed to
   * that device stay sealed to it: a key that has been used cannot be
   * un-used, and pretending otherwise would be the most dangerous sentence
   * this screen could contain.
   */
  async revoke(deviceRowId) {
    return this.repo('deviceKey').update(deviceRowId, { revokedAt: new Date().toISOString() });
  }

  /** Somebody says they compared the number aloud and it matched. */
  async markVerified(deviceRowId) {
    return this.repo('deviceKey').update(deviceRowId, { verifiedAt: new Date().toISOString() });
  }

  /** The number two people read to each other. */
  async safetyNumberWith(publicKey) {
    const mine = await this.identity();
    if (!mine) throw new AppError('this device has no chat identity yet', { code: 'notEnrolled' });
    return safetyNumber(mine.publicKey, publicKey);
  }

  /* ------------------------------------------------------------ messages */

  async send(conversationId, senderPersonId, text) {
    const identity = await this.identity();
    if (!identity) throw new AppError('this device has no chat identity yet', { code: 'notEnrolled' });

    const conversation = await this.repo('conversation').get(conversationId);
    if (!conversation) throw new AppError('that conversation no longer exists', { code: 'noConversation' });

    const devices = await this.devicesFor(conversation.participants ?? []);
    if (!devices.length) {
      throw new AppError(
        'nobody in this conversation has a device that can read a message yet — '
        + 'each person opens FamilyOS once on their own phone to enrol one',
        { code: 'noRecipients' },
      );
    }

    const sealed = await seal(text, identity,
      devices.map((d) => ({ id: d.deviceId, publicKey: d.publicKey })),
      { escrowPublicKey: await this.escrowPublicKey() });

    return this.repo('message').create({
      conversation: conversationId,
      sender: senderPersonId,
      sentAt: new Date().toISOString(),
      body: JSON.stringify(sealed),
    });
  }

  /**
   * Everything one conversation screen needs, in one call.
   *
   * The screen asked for the conversation and the people itself and took the
   * UI→database count from 58 to 60 — a budget that may only fall. It belongs
   * here anyway: a conversation view needs three entities joined, which is
   * the cross-entity question this layer exists for.
   */
  async view(conversationId, { escrow = null } = {}) {
    const [conversation, messages, people] = await Promise.all([
      this.repo('conversation').get(conversationId),
      this.read(conversationId, { escrow }),
      this.repo('person').list({ limit: 200 }),
    ]);

    const names = new Map(people.map((p) => [p.id, p.name]));
    return {
      conversation,
      messages,
      // Resolved here rather than handing the screen a list to search: the
      // screen would do it once per message.
      nameOf: (id) => names.get(id) ?? null,
    };
  }

  /* --------------------------------------------------------- attachments */

  /**
   * Send a file.
   *
   * ## Why this does not reuse how a document is stored
   *
   * A document's bytes are encrypted with the **household key** — the one
   * every member shares — and uploaded to Drive. That is right for a passport
   * scan the household keeps together, and it is exactly wrong here: an
   * attachment encrypted that way is readable by anyone who can unlock the
   * app, while the screen above it says the conversation is end-to-end
   * encrypted. That sentence would become false the day attachments shipped.
   *
   * So the bytes are sealed to the same devices as the message, with the same
   * code — `sealBytes` is what `seal` is built on, not a sibling of it.
   *
   * ## The filename is sealed too
   *
   * It is inside the sealed envelope, not a column beside it.
   * `divorce-papers.pdf` tells you the thing the file was meant to keep
   * private, and a field-encrypted name would be readable by the household
   * key that the body deliberately is not.
   *
   * @param {{name?: string, type?: string, bytes: Uint8Array}} file
   */
  async attach(conversationId, senderPersonId, file) {
    const identity = await this.identity();
    if (!identity) throw new AppError('this device has no chat identity yet', { code: 'notEnrolled' });

    const bytes = file?.bytes;
    if (!bytes?.length) throw new AppError('there is nothing to send', { code: 'emptyFile' });

    const conversation = await this.repo('conversation').get(conversationId);
    if (!conversation) throw new AppError('that conversation no longer exists', { code: 'noConversation' });

    const devices = await this.devicesFor(conversation.participants ?? []);
    if (!devices.length) {
      throw new AppError(
        'nobody in this conversation has a device that can read a file yet — '
        + 'each person opens FamilyOS once on their own phone to enrol one',
        { code: 'noRecipients' },
      );
    }

    const to = devices.map((d) => ({ id: d.deviceId, publicKey: d.publicKey }));
    const escrowPublicKey = await this.escrowPublicKey();

    const sealedFile = await sealBytes(bytes, identity, to, { escrowPublicKey });
    const attachmentId = newId('att');

    // The envelope carries the file's own content key, wrapped per device. The
    // message below carries a second, separate seal for the name and size —
    // two envelopes rather than one, so a device that may read the message may
    // read the file and nothing is inferable from the pair.
    const meta = {
      kind: 'file',
      name: String(file.name ?? 'file'),
      type: String(file.type ?? 'application/octet-stream'),
      size: bytes.length,
      attachment: attachmentId,
    };
    const sealedMeta = await seal(JSON.stringify(meta), identity, to, { escrowPublicKey });

    const row = await this.repo('message').create({
      conversation: conversationId,
      sender: senderPersonId,
      sentAt: new Date().toISOString(),
      body: JSON.stringify(sealedMeta),
    });

    // Written after the message, and pointing at it. The other order leaves an
    // attachment nothing references if the message write is refused — bytes
    // on the device that nobody can find or delete.
    await this.db.putAttachment({
      id: attachmentId,
      message: row.id,
      conversation: conversationId,
      envelope: JSON.stringify(sealedFile),
      bytes: bytes.length,
      createdAt: new Date().toISOString(),
    });

    return row;
  }

  /**
   * The bytes back, if this device is one of the recipients.
   *
   * Returns `null` rather than throwing when there is nothing to open: an
   * attachment withdrawn on another device is a fact about that message, and
   * a list should say so rather than fall over.
   */
  async openAttachment(attachmentId, { escrow = null } = {}) {
    const stored = await this.db.attachment(attachmentId);
    if (!stored?.envelope) return null;

    const identity = await this.identity();
    if (!identity) throw new AppError('this device has no chat identity yet', { code: 'notEnrolled' });

    return openBytes(JSON.parse(stored.envelope), { id: this.db.deviceId, ...identity }, { escrow });
  }

  /**
   * A conversation, opened as far as this device can open it.
   *
   * Never throws for an unreadable message. A conversation is a list, and one
   * line this device cannot read is a fact about that line — reported in
   * place, with the reason, rather than taking the screen down or silently
   * leaving a gap that reads as a message that was never sent.
   */
  async read(conversationId, { escrow = null } = {}) {
    const identity = await this.identity();
    const deviceId = this.db.deviceId;
    const rows = await this.repo('message').list({ limit: 1000 });

    const mine = rows
      .filter((r) => r.conversation === conversationId && !r.deletedAt)
      .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));

    const out = [];
    for (const row of mine) {
      out.push(await this.#openRow(row, identity, deviceId, escrow));
    }
    return out;
  }

  async #openRow(row, identity, deviceId, escrow) {
    if (row.deletedForEveryone) {
      return { row, text: null, why: 'withdrawn' };
    }

    let sealed;
    try {
      sealed = JSON.parse(row.body);
    } catch {
      return { row, text: null, why: 'unreadable' };
    }

    const to = sealedTo(sealed);
    if (!identity) return { row, text: null, why: 'notEnrolled', to };

    try {
      const text = await open(sealed, { id: deviceId, ...identity }, { escrow });

      // A file arrives as a sealed envelope holding its own description. The
      // caller gets the name and size, never the raw JSON — a screen printing
      // `{"kind":"file",...}` is how somebody learns not to trust the screen.
      const file = readFileMeta(text);
      if (file) return { row, text: null, file, why: null, to };

      return { row, text, file: null, why: null, to };
    } catch (error) {
      // The common one, and worth its own word: a device enrolled after the
      // message was sent was never a recipient and never will be. That is not
      // damage and not a bug, and a screen saying "could not decrypt" would
      // send somebody looking for both.
      const why = error?.code === 'notARecipient' ? 'sentBefore'
        : error?.code === 'keyChanged' ? 'keyChanged'
          : 'unreadable';
      return { row, text: null, why, to };
    }
  }

  /**
   * Withdraw a message. The copy already on other devices is not recalled.
   *
   * The attachment goes with it. Blanking the body and leaving the bytes would
   * be the worst of both: the message reads as withdrawn while the photograph
   * is still on the device, and nothing on any screen would say so.
   */
  async withdraw(messageId) {
    for (const attachment of await this.db.attachmentsFor(messageId)) {
      await this.db.removeAttachment(attachment.id);
    }
    return this.repo('message').update(messageId, { deletedForEveryone: true, body: '{}' });
  }
}

/**
 * A decrypted body that describes a file, or null for an ordinary message.
 *
 * Parsed defensively. A body that is not JSON is simply a message whose text
 * happens to start with a brace, and treating that as a broken attachment
 * would lose it.
 */
function readFileMeta(text) {
  if (!text?.startsWith('{')) return null;
  try {
    const meta = JSON.parse(text);
    return meta?.kind === 'file' && meta.attachment ? meta : null;
  } catch {
    return null;
  }
}

export { ESCROW_ID };
