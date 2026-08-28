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
import {
  completion, familyCompletion, sectionEntities, personKey, sectionsCovering,
} from '../domain/profile.js';
import { visibleEntities } from '../security/rbac.js';
import { kycDrift, stale, kinNote, latestPerInstitution } from '../domain/kyc.js';
import { today } from '../core/dates.js';
import { entities } from '../data/schema.js';
import { classify, mask } from '../data/classification.js';
import { wallet, DEFAULT_LEAD } from '../domain/wallet.js';
import { leadFor } from '../domain/reminders.js';

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
  /**
   * The identity documents, as wallet cards.
   *
   * The masking is applied here, not in the screen. `identityDocument.number`
   * is one of the fields the browser suite's sweep watches, and a wallet card
   * is exactly the sort of hand-built surface that bypasses the field renderer
   * — the trap `data/schema.js` names for record headers, list subtitles,
   * search results and reference pickers.
   */
  async wallet({ clock = Date.now } = {}) {
    const loaded = await this.load({
      documents: ['identityDocument', { limit: 500 }],
      people: ['person', { limit: 500 }],
    });

    const names = new Map((loaded.people ?? []).map((one) => [one.id, one.name]));
    const field = entities.identityDocument?.fieldMap?.number ?? null;
    const level = classify(field, entities.identityDocument);

    return wallet(
      loaded.documents,
      (value) => mask(value, level),
      (id) => names.get(id) ?? null,
      { lead: leadFor('identityDocument', 'expiresOn', DEFAULT_LEAD), clock },
    );
  }

  /** @param {{clock?: () => number}} [options] */
  async review({ clock = Date.now } = {}) {
    return assembleIdentityReview(await this.load(IDENTITY_REVIEW_LOAD), { clock });
  }

  /**
   * How complete each person's profile is, and the household's figure.
   *
   * ## Presence, not a count
   *
   * `completion` only ever asks whether a section has anything in it, so this
   * loads each entity once and records **whether** a person appears in it. The
   * alternative — an exact count per person — would need either an unbounded
   * read or a limit, and a limit would make a displayed count quietly wrong
   * for a household with a lot of documents. Presence has no such edge.
   *
   * No test can tell the two apart, and that is worth saying rather than
   * implying otherwise: mutating this to a running total leaves the whole
   * suite green, because nothing downstream reads the number. It is written
   * this way so that nothing downstream ever can.
   *
   * ## An entity a role cannot read is not an empty section
   *
   * `load` returns an empty list where permission is refused, which would
   * otherwise tell a child that their parent's Loans section is unfilled. The
   * sections a role cannot see are dismissed for them instead, so the figure
   * is over what that reader can actually account for.
   */
  async profiles() {
    const names = sectionEntities();
    /** @type {Record<string, [string, object]>} */
    const spec = { people: ['person', { limit: 500 }] };
    for (const name of names) spec[name] = [name, { limit: 2000 }];
    const loaded = await this.load(spec);

    const readable = new Set(visibleEntities(this.db.actor));
    const unreadable = names.filter((name) => !readable.has(name));

    const present = new Map();
    for (const name of names) {
      const key = personKey(name);
      if (!key) continue;
      for (const row of loaded[name] ?? []) {
        const id = row?.[key];
        if (!id) continue;
        if (!present.has(id)) present.set(id, {});
        present.get(id)[name] = 1;
      }
    }

    const people = (loaded.people ?? []).map((person) => {
      const dismissed = [
        ...(person.notApplicableSections ?? []),
        ...sectionsCovering(unreadable),
      ];
      return {
        person,
        ...completion(person, present.get(person.id) ?? {}, { notApplicable: dismissed }),
      };
    });

    return { people, family: familyCompletion(people), unreadable };
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
