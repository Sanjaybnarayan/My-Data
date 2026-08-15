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
import { read, reconcileWithStatement } from '../domain/sms.js';

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
  async readAndReconcile(message) {
    const reading = read(message);
    if (reading.secret) {
      return { reading, result: { agreement: 'none', transaction: null, why: null } };
    }

    const transactions = await this.repo('transaction')
      .list({ decrypt: false, limit: TRANSACTION_LIMIT })
      .catch(() => []);

    return { reading, result: reconcileWithStatement(reading, transactions) };
  }
}
