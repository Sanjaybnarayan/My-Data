/**
 * Where a movement came from, assembled where it can be tested.
 *
 * `domain/explain.js` answers rule 57 for one movement and counts the answers
 * across a household, and nothing asked it either question. That is the fourth
 * time in this run of tranches, and the reason is always the same: the engine
 * is the interesting part to build and the screen is the part that makes it
 * true for anybody.
 *
 * The work here is a database walk rather than a pure function — an event's
 * legs are found by index, and each leg's chain is walked back to the file it
 * was parsed from — so it cannot live in `domain/` and should not live in a
 * screen. This is the seam `services/service.js` describes: a cross-entity
 * question with nowhere else to go.
 */

import { Service } from './service.js';
import { explainEvent, explainability } from '../domain/explain.js';

export class ExplainService extends Service {
  /**
   * How much of the household's ledger of movements can be explained.
   *
   * @param {{limit?: number}} [options]
   */
  async review({ limit = 500 } = {}) {
    return explainability(this.db, { limit });
  }

  /** Everything this application can say about where one movement came from. */
  async forEvent(id) {
    return explainEvent(this.db, id);
  }
}
