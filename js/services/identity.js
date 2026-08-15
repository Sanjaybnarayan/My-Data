/**
 * What the identity records say when read against each other.
 *
 * ## Why this exists at all
 *
 * `domain/kycconflict.js` was built and nothing drew it. That is the finding
 * this repository has made more often than any other — *"the domain function
 * exists and no screen calls it"* — and it had just been made again, in the
 * same tranche's own closing paragraph.
 *
 * The screen could have called the domain directly. It was already calling the
 * repository three times to do the drift banner, and adding conflicts inline
 * would have made it four. Assembly in a screen can only be exercised through a
 * browser, and this assembly is the one that decides whether a household is
 * told two people share a CKYC identifier.
 *
 * So it moves here, where it is tested against a real in-memory database with
 * no DOM anywhere near it, and the screen's direct database calls go from three
 * to none.
 *
 * ## The order is the message
 *
 * A shared identifier outranks everything. `identityConflicts` already sorts
 * worst-first, and this keeps that ordering rather than grouping by person —
 * grouping would put a CRITICAL finding halfway down a screen, under somebody's
 * address drift, on the grounds that the alphabet said so.
 */

import { Service } from './service.js';
import { identityConflicts } from '../domain/kycconflict.js';
import { kycDrift, stale, kinNote, latestPerInstitution } from '../domain/kyc.js';
import { today } from '../core/dates.js';

/** @type {Record<string, import('./service.js').Load>} */
export const IDENTITY_REVIEW_LOAD = Object.freeze({
  people: ['person', { limit: 500 }],
  records: ['kycRecord', { limit: 2000 }],
  documents: ['identityDocument', { limit: 2000 }],
});

/**
 * Everything the KYC banner draws, from records alone.
 *
 * @param {Record<string, object[]>} data as `IDENTITY_REVIEW_LOAD` yields
 * @param {{clock?: () => number}} [options]
 */
export function assembleIdentityReview(data, { clock = Date.now } = {}) {
  const { people = [], records = [], documents = [] } = data ?? {};

  const live = records.filter((record) => record && !record.deletedAt);
  const household = people.filter((person) => person && !person.deletedAt);

  return {
    // Whether there is anything to say at all. A household with no KYC records
    // gets no banner rather than an empty one.
    any: live.length > 0,
    people: household,
    records: live,

    // Worst first, across the whole household. The one answer `domain/kyc.js`
    // could not give, because every function in it takes a single person.
    conflicts: identityConflicts(household, live),

    // Per person, as before: where one person's institutions disagree among
    // themselves. Kept beside the conflicts rather than merged into them —
    // they are different questions with different fixes, and a merged list
    // would need a column to say which was which.
    drift: household
      .map((person) => ({ person, entries: kycDrift(person, live, documents) }))
      .filter(({ entries }) => entries.length),

    stale: stale(live, today(clock)),

    malformed: latestPerInstitution(live)
      .map((record) => ({ record, note: kinNote(record.kin) }))
      .filter(({ note }) => note),
  };
}

export class IdentityService extends Service {
  /** @param {{clock?: () => number}} [options] */
  async review({ clock = Date.now } = {}) {
    return assembleIdentityReview(await this.load(IDENTITY_REVIEW_LOAD), { clock });
  }

  /**
   * A person's name, for the conflict sentences.
   *
   * Returned as a lookup rather than resolved inside the assembler, because
   * `describeConflict` takes a `nameOf` and the screen is where a missing
   * person should read as an id rather than as a blank.
   */
  static nameLookup(people) {
    const byId = new Map((people ?? []).map((person) => [person.id, person.name]));
    return (id) => byId.get(id) ?? id;
  }
}
