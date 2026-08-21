/**
 * Nominations, assembled where they can be tested.
 *
 * ## The load is decrypted, and that is the whole reason this file exists
 *
 * All three nominee fields are `encrypted: true`. The dashboard's bulk loader
 * reads every entity with `decrypt: false` — nine widgets sharing one pass is
 * the point of it — so a widget assembled from that data would see ciphertext
 * where a name should be.
 *
 * The failure would be silent in the worst direction. Every record would look
 * like it *had* a nominee, the gap list would come out empty, and a household
 * would be told there was nothing to fix on the one screen built to tell them
 * there was. `domain/estate.js` refuses to read a sealed value at all and
 * counts it; this service makes sure it never has to, by asking for the three
 * entities decrypted and leaving the other nineteen alone.
 *
 * Decrypting three lists is the cost of an answer that is true. The dashboard's
 * single pass is preserved for everything else.
 */

import { Service } from './service.js';
import {
  estate, bequestConflicts, willCoverage, willsInConflict, currentLegalDocuments,
} from '../domain/estate.js';

/** @type {Record<string, import('./service.js').Load>} */
export const ESTATE_LOAD = Object.freeze({
  // Decrypted deliberately — see above. The default is `decrypt: true`, and it
  // is written out here so that changing it is a decision rather than a typo.
  accounts: ['account', { decrypt: true, limit: 500 }],
  holdings: ['holding', { decrypt: true, limit: 1000 }],
  policies: ['policy', { decrypt: true, limit: 500 }],
  people: ['person', { decrypt: false, limit: 500 }],
  // Read only to be counted and named. Nothing here nominates a flat.
  properties: ['property', { decrypt: false, limit: 200 }],
  vehicles: ['vehicle', { decrypt: false, limit: 200 }],
  loans: ['loan', { decrypt: false, limit: 200 }],
  vaultItems: ['vaultItem', { decrypt: false, limit: 500 }],
  digitalAssets: ['digitalAsset', { decrypt: false, limit: 500 }],
  // The three that let a bequest be read against a nomination.
  wills: ['will', { decrypt: false, limit: 200 }],
  beneficiaries: ['beneficiary', { decrypt: false, limit: 1000 }],
  legalDocuments: ['legalDocument', { decrypt: false, limit: 500 }],
});

export class EstateService extends Service {
  /** @returns {Promise<object>} as `estate()` yields */
  async review() {
    return estate(await this.load(ESTATE_LOAD));
  }

  /**
   * What the will says, beside what each institution was told.
   *
   * A separate call rather than folded into `review()`, because the two answer
   * different questions and the dashboard draws only the first. Loading wills
   * for a widget that never shows them would be reading records nobody asked
   * for — and these are among the most sensitive the schema has.
   */
  async wills() {
    const data = await this.load(ESTATE_LOAD);
    const conflicts = bequestConflicts(data);
    return {
      conflicts: conflicts.filter((row) => !row.unclear),
      unclear: conflicts.filter((row) => row.unclear),
      coverage: willCoverage(data),
      duplicates: willsInConflict(data),
      documents: currentLegalDocuments(data),
      people: data.people ?? [],
      any: conflicts.length > 0
        || willsInConflict(data).length > 0
        || (data.wills ?? []).length > 0,
    };
  }
}
