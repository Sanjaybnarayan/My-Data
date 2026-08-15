/**
 * What a document *does* to the records around it.
 *
 * ## The second gap, not the first
 *
 * `services/finance.js` closed the first thing the service layer is for —
 * assembly with no home. This closes the second, which `services/service.js`
 * states in the same breath:
 *
 * > **Cross-entity operations have no home.** `Repository.referencedBy` throws
 * > `wrong-layer` on purpose. Anything spanning entities has nowhere to live
 * > but a screen.
 *
 * Two such operations were living in `modules/documents.js`. Both begin with a
 * document and end by changing a *different* entity:
 *
 *   - **filing a receipt** against the payment it records — a `transaction`
 *     write, decided by `domain/receiptmatch.js`;
 *   - **recording an identifier** a scan found — an `identityDocument` write,
 *     decided by `domain/identifiers.js`.
 *
 * Neither could be tested without a browser, and both are the kind of write
 * where being wrong matters: one files evidence against a payment, the other
 * creates a record holding a document number.
 *
 * ## What has not moved, and why
 *
 * The **refusals stay in the domain**. `attachmentFor` returns null for
 * anything but a probable match, and this service asks it rather than
 * re-deciding — a second place deciding what counts as a match is a second
 * place to get it wrong. What moves here is only the *writing*, and the
 * cross-entity knowledge of which repository the write lands in.
 */

import { Service } from './service.js';
import { attachmentFor } from '../domain/receiptmatch.js';

export class DocumentsService extends Service {
  /**
   * File a receipt against the payment it records.
   *
   * @param {object} proposal from `matchReceipt`
   * @param {string} documentId the receipt being filed
   * @returns {Promise<{filed: boolean, transactionId?: string, why?: string}>}
   *   Never throws for an uncertain match — that is an answer, not a fault, and
   *   the screen shows it as a sentence rather than an error.
   */
  async fileReceipt(proposal, documentId) {
    const link = attachmentFor(proposal, documentId);
    if (!link) {
      return {
        filed: false,
        why: 'only a clear match can be filed automatically',
      };
    }

    // Through the repository, never the adapter: that is where the permission
    // check and the audit entry live, and this write appends to a list rather
    // than replacing it — a transaction may have a receipt and an invoice and a
    // warranty, and filing one by losing the others would be worse than not
    // filing at all.
    await this.repo('transaction').update(link.transactionId, link.patch);
    return { filed: true, transactionId: link.transactionId };
  }

  /**
   * Record an identifier a scan offered, as its own encrypted record.
   *
   * @param {object} record the `identityDocument` shape to write
   * @returns {Promise<object>} the created record
   *
   * Written through the repository, which is what encrypts `number` and checks
   * the permission. Nothing about the value passes through a searchable field
   * on the way.
   */
  async recordIdentifier(record) {
    return this.repo('identityDocument').create(record);
  }
}
