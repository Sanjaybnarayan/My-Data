/**
 * Every disagreement about money, gathered from wherever it was found.
 *
 * `domain/conflict.js` joins four findings that lived in three shapes on two
 * screens. This is the part that goes and gets them, and it is a service for
 * the usual reason: the assembly decides what a household is told, and an
 * assembly only a browser can reach is an assembly nothing tests.
 *
 * ## Wages need a second read
 *
 * Wages paid are ordinary transactions carrying a `person`, which is the
 * design `docs/HOUSEHOLD_STAFF.md` insists on — a `monthlyPay` figure that
 * nothing reconciles would be a parallel money path. So the bundle handed to
 * the domain is built here by grouping the transactions already loaded, not
 * by a second query per staff member.
 */

import { Service, TRANSACTION_LIMIT } from './service.js';
import { conflicts, countByKind } from '../domain/conflict.js';

/** @type {Record<string, import('./service.js').Load>} */
export const CONFLICT_LOAD = Object.freeze({
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  // Decrypted for the same reason `EVIDENCE_LOAD` decrypts it: a screen
  // naming which message disagrees needs the sender, and a sealed value read
  // undecrypted is the trap `docs/SEALED_VALUES.md` records.
  messages: ['smsMessage', { decrypt: true, limit: 5000 }],
  receipts: ['receipt', { decrypt: false, limit: 5000 }],
  staff: ['staff', { decrypt: false, limit: 500 }],
  leave: ['staffLeave', { decrypt: false, limit: 2000 }],
});

export class ConflictService extends Service {
  /**
   * @param {{today?: string}} [options]
   * @returns {Promise<{found: object[], byKind: Record<string, number>,
   *                    total: number}>}
   */
  async review({ today } = {}) {
    const {
      transactions = [], messages = [], receipts = [], staff = [], leave = [],
    } = await this.load(CONFLICT_LOAD);

    const wages = staff
      .filter((row) => row && !row.deletedAt && row.person)
      .map((row) => ({
        staff: row,
        payments: transactions.filter((txn) => txn.person === row.person),
        leave: leave.filter((row2) => row2?.staff === row.id),
        today,
      }));

    const found = conflicts({ transactions, receipts, messages, wages });
    return { found, byKind: countByKind(found), total: found.length };
  }
}
