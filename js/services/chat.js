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
import { readFlags, setFlag } from '../domain/chatstate.js';
import { attributionOf } from '../domain/attribution.js';

const DEVICE_KEY = 'chat.deviceIdentity';
const ESCROW_KEY = 'chat.escrowIdentity';

/** Where per-device chat state lives. Never reaches the outbox. */
const FLAGS_KEY = 'chat.flags';

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
    // Loaded once for the whole conversation rather than per message. Every
    // row, including revoked and deleted ones — `attributionOf` explains why a
    // retired phone must still be able to account for what it sent.
    const devices = await this.repo('deviceKey').list({ limit: 500 });

    const mine = rows
      .filter((r) => r.conversation === conversationId && !r.deletedAt)
      .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));

    const out = [];
    for (const row of mine) {
      out.push(await this.#openRow(row, identity, deviceId, escrow, devices));
    }
    return out;
  }

  /**
   * `devices` is passed in rather than read here so one conversation costs one
   * query. An empty list is not an error and is not a warning: it makes every
   * message `unknown`, which is what "this device knows of no keys" honestly
   * means.
   */
  async #openRow(row, identity, deviceId, escrow, devices = []) {
    if (row.deletedForEveryone) {
      return { row, text: null, why: 'withdrawn', attribution: null };
    }

    let sealed;
    try {
      sealed = JSON.parse(row.body);
    } catch {
      return { row, text: null, why: 'unreadable', attribution: null };
    }

    const to = sealedTo(sealed);
    // Not opened, so nothing is proven. Stated rather than left undefined: a
    // screen reading `undefined` as "fine" is the failure this is here to stop.
    const unproven = attributionOf({
      sender: row.sender, from: sealed.from, devices, opened: false,
    });
    if (!identity) return { row, text: null, why: 'notEnrolled', to, attribution: unproven };

    try {
      const text = await open(sealed, { id: deviceId, ...identity }, { escrow });

      /*
       * The envelope opened, so the key that sealed it is proven. Ask whether
       * it belongs to the person the row names — the check that was missing.
       * Only reachable here: before `open` succeeds there is nothing to check
       * against, and after it fails there still is not.
       */
      const attribution = attributionOf({
        sender: row.sender, from: sealed.from, devices, opened: true,
      });

      // A file arrives as a sealed envelope holding its own description. The
      // caller gets the name and size, never the raw JSON — a screen printing
      // `{"kind":"file",...}` is how somebody learns not to trust the screen.
      const file = readFileMeta(text);
      if (file) return { row, text: null, file, why: null, to, attribution };

      return { row, text, file: null, why: null, to, attribution };
    } catch (error) {
      // The common one, and worth its own word: a device enrolled after the
      // message was sent was never a recipient and never will be. That is not
      // damage and not a bug, and a screen saying "could not decrypt" would
      // send somebody looking for both.
      const why = error?.code === 'notARecipient' ? 'sentBefore'
        : error?.code === 'keyChanged' ? 'keyChanged'
          : 'unreadable';
      return { row, text: null, why, to, attribution: unproven };
    }
  }

  /**
   * Withdraw a message. The copy already on other devices is not recalled.
   *
   * The attachment goes with it. Blanking the body and leaving the bytes would
   * be the worst of both: the message reads as withdrawn while the photograph
   * is still on the device, and nothing on any screen would say so.
   */
  /**
   * Every conversation with the last thing said in it.
   *
   * One pass over the messages rather than one read per conversation. The last
   * line is decrypted like any other, so a conversation this device cannot
   * open shows the same honest reason a message in it would — not a blank row
   * that looks like an empty conversation.
   *
   * There is no unread count, and there cannot be one: `message.readBy` is
   * declared in the schema and written by nothing in this application. A count
   * would be read off a field that has never held a value.
   */
  async threads({ escrow = null } = {}) {
    const [conversations, rows] = await Promise.all([
      this.repo('conversation').list({ limit: 500 }),
      this.repo('message').list({ limit: 2000 }),
    ]);

    const identity = await this.identity();
    const deviceId = this.db.deviceId;

    const latest = new Map();
    for (const row of rows) {
      if (row.deletedAt) continue;
      const held = latest.get(row.conversation);
      if (!held || String(row.sentAt) > String(held.sentAt)) latest.set(row.conversation, row);
    }

    const out = [];
    for (const conversation of conversations) {
      if (conversation.deletedAt) continue;
      const row = latest.get(conversation.id);
      out.push({
        conversation,
        /*
         * No devices, so every preview here is `unknown`, and that is correct
         * rather than a shortcut. This list draws a conversation title and the
         * last line of text; it names no sender, so there is no attribution to
         * confirm or dispute, and a warning would be noise where no claim was
         * made.
         *
         * If a sender name is ever added to this row, pass `devices` — see
         * `read` — or the name will be drawn from the untrusted field with the
         * check silently answering `unknown`.
         */
        last: row ? await this.#openRow(row, identity, deviceId, escrow) : null,
        at: row?.sentAt ?? null,
      });
    }

    // Most recently spoken in first; conversations with nothing said sink to
    // the bottom rather than being hidden — an empty one is still a place to
    // start talking.
    return out.sort((a, b) => String(b.at ?? '').localeCompare(String(a.at ?? '')));
  }

  /* --------------------------------------------- per-device chat state */

  /**
   * Starred, archived and pinned — read from `meta`, so on this device only.
   *
   * Not schema fields. `message.readBy` is what a schema field written by
   * nothing looks like, and syncing a bookmark would mean writing a merge rule
   * for two devices disagreeing about which lines mattered.
   */
  async flags() {
    return readFlags(await this.db.meta(FLAGS_KEY, null));
  }

  /**
   * @param {'starred'|'archived'|'pinned'} kind
   * @param {string} id
   * @param {boolean} [on] omit to toggle
   */
  async setFlag(kind, id, on = undefined) {
    const next = setFlag(await this.flags(), kind, id, on);
    await this.db.setMeta(FLAGS_KEY, next);
    return next;
  }

  /**
   * Every starred message, opened as far as this device can open it.
   *
   * Reads only the conversations that actually hold a starred message rather
   * than the whole household — a bookmark list should not cost a full decrypt.
   */
  async starred({ escrow = null } = {}) {
    const { starred } = await this.flags();
    if (!starred.length) return [];

    const wanted = new Set(starred);
    const rows = await this.repo('message').list({ limit: 5000, decrypt: false });
    const holding = [...new Set(rows.filter((one) => wanted.has(one.id))
      .map((one) => one.conversation))];

    const out = [];
    for (const conversationId of holding) {
      const view = await this.view(conversationId, { escrow });
      for (const message of view.messages) {
        if (!wanted.has(message.row?.id)) continue;
        out.push({ ...message, conversation: view.conversation, nameOf: view.nameOf });
      }
    }

    return out.sort((a, b) =>
      String(b.row?.sentAt ?? '').localeCompare(String(a.row?.sentAt ?? '')));
  }

  /**
   * Everything the chat settings screen needs, in one call.
   *
   * The screen was reading `person` itself to turn a device's owner id into a
   * name, which is the UI→database edge the architecture budget exists to
   * close. Joining a device to the person who owns it is a cross-entity
   * question, and this is the layer for those.
   */
  async settingsView() {
    const [identity, devices, people, usage] = await Promise.all([
      this.identity(),
      this.devices(),
      this.repo('person').list({ limit: 200 }),
      this.storage(),
    ]);

    const names = new Map(people.map((one) => [one.id, one.name]));
    return {
      identity,
      devices,
      usage,
      nameOf: (id) => names.get(id) ?? null,
    };
  }

  /**
   * What this device is actually holding, for the storage card.
   *
   * Counted, not estimated. `withdrawn` is separated from `messages` because
   * the two are genuinely different: a withdrawn message still occupies a row
   * — the row is how every device learns it was withdrawn — and a storage
   * screen that folded the two together would be telling somebody who deleted
   * a message that the space came back when it did not.
   */
  async storage() {
    const [conversations, messages, attachments] = await Promise.all([
      this.repo('conversation').list({ limit: 500, decrypt: false }),
      this.repo('message').list({ limit: 5000, decrypt: false }),
      this.db.attachmentUsage(),
    ]);

    const withdrawn = messages.filter((one) => one.deletedForEveryone).length;
    return {
      conversations: conversations.filter((one) => !one.deletedAt).length,
      messages: messages.length - withdrawn,
      withdrawn,
      attachments: attachments.count,
      bytes: attachments.bytes,
    };
  }

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
