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
  createIdentity, seal, open, safetyNumber, sealedTo, ESCROW_ID,
} from '../security/e2ee.js';
import { AppError } from '../core/errors.js';

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
      return { row, text, why: null, to };
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

  /** Withdraw a message. The copy already on other devices is not recalled. */
  async withdraw(messageId) {
    return this.repo('message').update(messageId, { deletedForEveryone: true, body: '{}' });
  }
}

export { ESCROW_ID };
