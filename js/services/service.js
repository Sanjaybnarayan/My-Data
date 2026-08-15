/**
 * The domain-service layer.
 *
 * ## What this is for, precisely
 *
 * Not authorization. The Phase 0 audit said screens calling the repository
 * meant "authorization, provenance and audit are applied by whichever screen
 * remembers to", and that was wrong — `data/repository.js` calls `assertCan` on
 * every read and write and writes the audit entry in the same transaction as
 * the change. A screen never gets the chance to forget.
 *
 * The two real gaps are narrower, and neither is a hole:
 *
 *   1. **Assembly has no home.** The investments screen loads eight entities,
 *      feeds them to pure functions in `domain/`, and builds a view model
 *      inline. That assembly can only be exercised through a browser, and the
 *      list of records an answer needs is re-derived by every screen wanting
 *      it — so two screens showing net worth can disagree about what net worth
 *      is made of, and nothing would catch it.
 *   2. **Cross-entity operations have no home.** `Repository.referencedBy`
 *      throws `wrong-layer` on purpose. Anything spanning entities — what
 *      deleting a person would break — has nowhere to live but a screen.
 *
 * So a service answers a domain question with **plain data**, from a **declared**
 * list of records, and is tested against a real in-memory database with no DOM
 * anywhere near it.
 *
 * ## The rule that makes this the right seam for the hybrid
 *
 * **A service reads through `db.repo(...)` and never through `db.adapter`.**
 *
 * That is not tidiness. The repository is where `assertCan` and `rowFilter`
 * live, so a service that reached past it would be a service that returns rows
 * its caller may not see — silently, because a view model has no place to show
 * a permission error. `tests/services.test.mjs` asserts it directly.
 *
 * Under the hybrid decision — a policy server that holds roles and answers
 * authorization questions, and never holds records — this layer is where an
 * authoritative remote decision gets consulted for an *operation*, as opposed
 * to the per-row checks the repository already makes locally. Nothing here
 * calls a server yet, and this file does not pretend otherwise.
 */

import { entities } from '../data/schema.js';

/**
 * @typedef {[entityName: string, query?: object]} Load
 *   An entity to fetch and how. `{ decrypt: false }` is the common one: a view
 *   model built only from clear fields should not pay to decrypt five hundred
 *   rows.
 */

export class Service {
  #db;

  constructor(db) {
    if (!db) throw new Error('a service needs a database');
    this.#db = db;
  }

  /** Deliberately the repository, never the adapter. See the note above. */
  get db() { return this.#db; }

  repo(name) { return this.#db.repo(name); }

  /**
   * Fetch a declared set of entities in parallel, keyed by the name the caller
   * uses for them.
   *
   * @param {Record<string, Load>} spec
   * @returns {Promise<Record<string, object[]>>}
   *
   * A missing permission yields an empty list rather than an exception, which
   * matches what the repository already does for `list` — a child opening a
   * screen that mentions loans should see a screen without loans, not a crash.
   * A *misspelt entity* is a different thing entirely and throws, because that
   * is a bug in this file rather than a fact about the person reading it.
   */
  async load(spec) {
    const names = Object.keys(spec);

    for (const key of names) {
      const [entityName] = spec[key];
      if (!entities[entityName]) {
        throw new Error(`${this.constructor.name} asked for an unknown entity: ${entityName}`);
      }
    }

    const results = await Promise.all(names.map(async (key) => {
      const [entityName, query = {}] = spec[key];
      const rows = await this.repo(entityName).list(query).catch(() => []);
      return [key, rows];
    }));

    return Object.fromEntries(results);
  }
}

/**
 * How many transactions a money figure is computed from.
 *
 * ## Why this is a constant and not a per-screen choice
 *
 * It was a per-screen choice, and the screens disagreed. Measured on a
 * household with 25,000 transactions:
 *
 *     dashboard  (limit 10,000)  ₹2,00,000
 *     finance    (limit 20,000)  ₹4,00,000
 *     ledgers    (limit 50,000)  ₹5,00,000
 *
 * The same account, the same day, three screens of one application, three
 * answers. That is the exact failure this file's own note about `NET_WORTH_LOAD`
 * warns of — *"two screens showing net worth can disagree about what net worth
 * is made of, and nothing would catch it"* — and nothing did catch it, for as
 * long as the limits differed.
 *
 * ## The deeper point, which a shared number does not fix
 *
 * **A balance computed from a truncated list is not a balance.** Summing "the
 * most recent N" gives the right answer only when N is larger than the
 * household's history; past that it silently reports a number that is not the
 * account's. So the limit is shared *and* the truncation is reported — see
 * `transactionsTruncated`, and `docs/ONE_LIMIT.md`.
 */
export const TRANSACTION_LIMIT = 50_000;

/**
 * Whether a money figure was computed from everything, or from a slice.
 *
 * Returned rather than warned about: a screen showing a balance that is not the
 * balance should say so, and only the caller knows where to put that sentence.
 */
export function transactionsTruncated(rows, limit = TRANSACTION_LIMIT) {
  return (rows?.length ?? 0) >= limit;
}

/**
 * What a set of records is made of, declared once and shared.
 *
 * Net worth is assembled from six entities. Before this, the investments screen
 * and the dashboard each listed those six inline, and neither knew about the
 * other — so adding a seventh would have quietly produced two different net
 * worths on two screens of the same application.
 */
export const NET_WORTH_LOAD = Object.freeze({
  accounts: ['account', { decrypt: false }],
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  holdings: ['holding', { decrypt: false, limit: 2000 }],
  properties: ['property', { decrypt: false }],
  vehicles: ['vehicle', { decrypt: false }],
  loans: ['loan', { decrypt: false }],
});
