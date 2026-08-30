/**
 * A message, against the statements already imported.
 *
 * ## Why this is a service and not two lines in the screen
 *
 * It was two lines in the screen, and the architecture ratchet caught it: the
 * Import screen reached for `db.repo('transaction')` directly and took the
 * forbidden-edge count from 61 to 62. That number may only fall, so the read
 * moved here rather than the budget moving up.
 *
 * It belongs here anyway. Reading a message is `domain/sms.js`'s job and needs
 * nothing; *reconciling* one needs every transaction the household has, which
 * is a cross-entity question — the second of the two things
 * `services/service.js` says this layer exists for.
 */

import { Service, TRANSACTION_LIMIT } from './service.js';
import { read, reconcileWithStatement, fingerprint, SOURCE } from '../domain/sms.js';
import { today } from '../core/dates.js';
import * as inbox from '../core/smsinbox.js';

/** The newest arrival already handled, so an inbox is not re-read whole. */
const WATERMARK = 'sms.lastReadMillis';

export class MessagesService extends Service {
  /**
   * Read a pasted message and say whether the statements agree with it.
   *
   * @param {{text: string, sender?: string, receivedAt?: string}} message
   * @returns {Promise<{reading: object, result: object}>}
   *
   * A credential never reaches the database call at all — not because the query
   * would leak it, but because there is no reason to run one, and the shortest
   * path a secret can travel is the safest.
   */
  /** @param {{source?: string}} [options] */
  async readAndReconcile(message, options = {}) {
    const { source = SOURCE.IMPORTED } = options;
    const reading = read(message, { source });
    if (reading.secret) {
      return { reading, result: { agreement: 'none', transaction: null, why: null } };
    }

    const transactions = await this.repo('transaction')
      .list({ decrypt: false, limit: TRANSACTION_LIMIT })
      .catch(() => []);

    return { reading, result: reconcileWithStatement(reading, transactions) };
  }

  /**
   * Read a message, reconcile it, and **keep it** — unless it is a credential.
   *
   * ## Rule 53, enforced by the shape of the code rather than by care
   *
   * The write is refused before the repository is reached, on the same check
   * that already stops a credential being parsed. `smsMessage` has no field a
   * one-time code could live in, so there is no redacted-but-stored middle
   * ground to get wrong: a secret produces `stored: null` and nothing else.
   *
   * A test walks every store in the database afterwards and fails if the code
   * appears anywhere at all, which is the only version of this claim worth
   * making.
   *
   * ## Rule 52, which is why this stores anything
   *
   * A message and a statement row are two pieces of evidence for one event.
   * The message is written with `transaction` pointing at the row it matched —
   * **linked, not duplicated** — and the reconciliation's verdict beside it. A
   * conflict is stored as a conflict; the statement figure is never copied over
   * the message's, and the message's is never copied over the statement's.
   *
   * ## The same message twice
   *
   * A resend carries a second timestamp and the same fingerprint. The existing
   * record is returned rather than a second one written, because two rows for
   * one alert would make the evidence look like two events — the failure rule
   * 52 exists to prevent, arriving by a different door.
   */
  /** @param {{clock?: () => number, source?: string}} [options] */
  async ingest(message, options = {}) {
    const { clock = Date.now, source = SOURCE.IMPORTED } = options;
    const { reading, result } = await this.readAndReconcile(message, { source });

    if (reading.secret) {
      return {
        reading,
        result,
        stored: null,
        why: 'this message carries a one-time code or a security instruction, so '
          + 'nothing about it is kept',
      };
    }

    const print = fingerprint(reading);

    // Looked up and written in one transaction, not two.
    //
    // This was a `list` by fingerprint followed by a `create`, and the gap
    // between them was a window: two tabs sweeping the inbox together both
    // found nothing and both wrote, so one alert became two rows — which is
    // the very thing the paragraph above says must not happen. Measured, with
    // the two captures genuinely interleaved: `smsMessage rows: 2`.
    //
    // `createUnlessPresent` does the lookup inside the writing transaction.
    const { record: stored, created } = await this.repo('smsMessage').createUnlessPresent({
      sender: reading.sender || 'unknown',
      // A message pasted by hand carries no arrival time, and the browser
      // check found it: every Node fixture here supplied one, so the required
      // field was never missing until a person typed into the real box.
      //
      // The day it was brought in is recorded rather than invented as the day
      // it was sent. `transactionDate` — the date printed *in* the message —
      // is stored separately and is the one that means anything.
      receivedAt: (reading.receivedAt ?? '').slice(0, 10) || today(clock),
      text: reading.text ?? '',
      category: reading.category ?? 'OTHER',
      amount: reading.amount ?? undefined,
      direction: reading.direction ?? undefined,
      accountTail: reading.accountTail ?? undefined,
      reference: reading.utr ?? reading.upiReference ?? reading.rrn ?? undefined,
      balance: reading.balance ?? undefined,
      transactionDate: reading.transactionDate ?? undefined,
      fingerprint: print,
      source: reading.source ?? 'imported',
      // The link. Absent when nothing matched, and never invented — an
      // unmatched message is evidence of something this application has not
      // seen a statement for, which is worth knowing.
      //
      // No `agreement === NONE` guard: the reconciler already returns a null
      // transaction in that case, so the guard could not fail and mutation
      // testing said so. That is the second unreachable belt-and-braces check
      // in two tranches — see `docs/SEALED_VALUES.md`.
      transaction: result.transaction?.id,
      agreement: result.agreement,
    }, { index: 'byFingerprint', only: print });

    if (!created) {
      return { reading, result, stored, why: 'this message is already recorded' };
    }

    return { reading, result, stored, why: null };
  }

  /* --------------------------------------------------- off the device */

  /**
   * Read what has arrived since last time, and keep what is worth keeping.
   *
   * ## Why this counts everything it drops
   *
   * Rule 57: every financial event must be explainable. The inverse matters
   * just as much — a person who taps this and sees "7 messages" needs to know
   * what happened to the other five, or the number is a mystery that reads as
   * data loss. So the result names each outcome, including the credentials,
   * which are the ones somebody is most entitled to be told were discarded.
   *
   * ## The watermark is only advanced past what was actually handled
   *
   * If ingesting throws half way through a page, the watermark stays at the
   * last message that really landed. The next read repeats a few and the
   * fingerprint makes the repeats free — which is the right way round. The
   * other way loses messages silently, and silence is the one outcome this
   * whole phase is built to avoid.
   */
  /**
   * @param {{plugin?: (name: string) => object|null, limit?: number,
   *          clock?: () => number}} [options]
   * @returns {Promise<{ok: boolean, why: string|null, read: number,
   *                    kept: number, secrets: number, already: number}>}
   */
  async ingestFromDevice({ plugin, limit = inbox.PAGE, clock = Date.now } = {}) {
    const options = plugin ? { plugin } : {};

    if (!inbox.available(options)) {
      return { ok: false, why: inbox.UNSUPPORTED, read: 0, kept: 0, secrets: 0, already: 0 };
    }

    const since = Number(await this.db.meta(WATERMARK)) || 0;
    const result = await inbox.read({ ...options, since, limit });
    if (!result.ok) {
      return { ok: false, why: result.why, read: 0, kept: 0, secrets: 0, already: 0 };
    }

    const messages = result.messages ?? [];
    // Oldest first, so the watermark only ever moves forward and a failure
    // part way through leaves it on a real boundary rather than past a gap.
    const ordered = [...messages].sort(
      (a, b) => (a.receivedAtMillis ?? 0) - (b.receivedAtMillis ?? 0),
    );

    let kept = 0;
    let secrets = 0;
    let already = 0;
    let watermark = since;

    for (const message of ordered) {
      const outcome = await this.ingest(message, { clock, source: SOURCE.NATIVE });

      if (outcome.reading.secret) secrets += 1;
      else if (outcome.why === 'this message is already recorded') already += 1;
      else if (outcome.stored) kept += 1;

      if (Number.isFinite(message.receivedAtMillis) && message.receivedAtMillis > watermark) {
        watermark = message.receivedAtMillis;
      }
    }

    if (watermark > since) await this.db.setMeta(WATERMARK, watermark);

    return { ok: true, why: null, read: ordered.length, kept, secrets, already };
  }
}
