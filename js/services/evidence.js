/**
 * What the household's sources say, assembled where it can be tested.
 *
 * `domain/evidence.js` answers the question and nothing asked it. This is the
 * third time in this stack that a tranche has ended with *"no screen"*, and the
 * third time the answer has been a service rather than an inline read: the
 * assembly here decides whether a household is told about **a payment missing
 * from its ledger**, and that decision should not live somewhere only a browser
 * can reach.
 */

import { Service, TRANSACTION_LIMIT } from './service.js';
import { evidenceSummary, evidenceFor } from '../domain/evidence.js';

/** @type {Record<string, import('./service.js').Load>} */
export const EVIDENCE_LOAD = Object.freeze({
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  // Decrypted: a message's text is sealed, and while the summary reads only
  // amounts and dates, a screen showing *which* message is meant needs the
  // sender at least. Loading it undecrypted would be the trap
  // `docs/SEALED_VALUES.md` records, waiting to be walked into again.
  messages: ['smsMessage', { decrypt: true, limit: 5000 }],
  receipts: ['receipt', { decrypt: false, limit: 5000 }],
});

export class EvidenceService extends Service {
  /** @returns {Promise<object>} as `evidenceSummary()` yields */
  async review() {
    const { transactions = [], messages = [], receipts = [] } = await this.load(EVIDENCE_LOAD);
    return evidenceSummary(transactions, { receipts, messages });
  }

  /** Everything that says one row happened, for a record screen. */
  async forTransaction(id) {
    const { transactions = [], messages = [], receipts = [] } = await this.load(EVIDENCE_LOAD);
    const transaction = transactions.find((row) => row.id === id);
    return transaction ? evidenceFor(transaction, { receipts, messages }) : null;
  }
}
