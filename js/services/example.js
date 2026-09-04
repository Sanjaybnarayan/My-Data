/**
 * Loading and removing the example household.
 *
 * The records themselves are in `domain/example.js`, with the reasoning about
 * what they are and are not. This is the part that writes them, and the only
 * decisions here are the three that keep the writing safe.
 *
 * **It writes through `repo()`, like everything else.** Not through the
 * adapter. So the example household is validated, encrypted, permission-checked
 * and audit-chained by exactly the code a typed-in record goes through — which
 * is also the only way this is worth having: a demonstration that took a
 * shortcut past the write path would be showing screens fed by data the real
 * write path might have refused.
 *
 * **It refuses a household that has people.** The brief's first rule is that
 * existing data stays usable, and invented records mixed into real ones cannot
 * be told apart again by hand. There is no merge, no "skip duplicates", no
 * force flag — an occupied household is a refusal with a count, and the person
 * is told why.
 *
 * **It records what it wrote.** The ids go into one meta key, so removal is
 * derived from what was actually written rather than from a guess about which
 * rows look invented. A guess would eventually delete something real.
 */

import { Service } from './service.js';
import { META_KEY, plan } from '../domain/example.js';
import { entityNames } from '../data/schema.js';

export { META_KEY };

/** What is on file now, or null if the example household is not loaded. */
export async function loadedExample(db) {
  const meta = await db.meta(META_KEY);
  return meta && Array.isArray(meta.ids) ? meta : null;
}

export class ExampleService extends Service {
  /**
   * Write the example household, or refuse.
   *
   * Named `install` rather than `load` because `Service.load` is the base
   * class's record reader and this is a writer — one letter of convenience
   * against a method that means the opposite of its parent's.
   *
   * @param {{clock?: () => number}} [options] moves the dates, which are all
   *   relative to the day it is loaded — see `domain/example.js`.
   * @returns {Promise<{loaded: boolean, count: number,
   *                    people?: number, present?: boolean}>}
   *   `loaded: false` with `people` set means the household was not empty and
   *   nothing was written; with `present` set, the example was already there.
   */
  async install({ clock = Date.now } = {}) {
    const already = await loadedExample(this.db);
    if (already) return { loaded: false, count: already.ids.length, present: true };

    // The check and the write are not one transaction, and cannot be: this
    // spans six entities and a meta key. What makes that acceptable here is
    // that the failure mode is a *refusal*, not a loss — a second loader
    // arriving mid-write finds people and declines. The window can duplicate
    // nothing, because the only writer that proceeds is one that found none.
    const occupied = await this.#occupied();
    if (occupied) return { loaded: false, count: 0, people: occupied };

    /** @type {Record<string, string>} key from the plan → the id it was given */
    const ids = {};
    /** @type {Array<{entity: string, id: string}>} */
    const written = [];

    for (const step of plan(clock)) {
      for (const row of /** @type {Record<string, any>[]} */ (step.rows)) {
        const { key, ...input } = row;

        for (const field of step.refs ?? []) {
          if (input[field]) input[field] = ids[input[field]] ?? input[field];
        }
        for (const field of step.multi ?? []) {
          if (Array.isArray(input[field])) {
            input[field] = input[field].map((k) => ids[k] ?? k);
          }
        }

        const record = await this.repo(step.entity).create(input);
        ids[key] = record.id;
        written.push({ entity: step.entity, id: record.id });
      }
    }

    await this.db.setMeta(META_KEY, { ids: written, at: new Date().toISOString() });
    return { loaded: true, count: written.length };
  }

  /**
   * Whether this household holds anything a person put there.
   *
   * ## The refusal that refused everything
   *
   * This used to be "are there any people", and it made the feature
   * unreachable. `resolveActor` in `js/app.js` creates a person named *You* on
   * the first unlock — "a family that has to fill in a form before seeing
   * anything has already been asked too much" — so by the time anybody can
   * reach Settings there is always exactly one person, and *Load example
   * household* always answered with the refusal toast.
   *
   * Measured on the real screens: install returned
   * `{loaded: false, people: 1}` immediately after enrolment, and every
   * section of the application stayed empty. 272 records nobody could load.
   *
   * The rule it was protecting is unchanged and is the right rule: invented
   * records mixed into real ones cannot be told apart again by hand. What was
   * wrong is that the owner row is not a record a person put there — the
   * application wrote it, unasked, so that the first screen would have a
   * subject. So occupancy now means what it always meant: **more than that one
   * row.**
   *
   * Deliberately a sweep of every entity rather than a list of the likely
   * ones. A household that had typed in nothing but a single vehicle would
   * have passed a check that only counted people, and had an invented family
   * written in beside their car.
   *
   * @returns {Promise<number>} how many records were found, or 0 for a
   *   household that is empty apart from the row the app made itself.
   */
  async #occupied() {
    const people = await this.repo('person').list({ limit: 500 }).catch(() => []);
    if (people.length > 1) return people.length;

    // Identified by id, not by name. `resolveActor` names the row it creates
    // *You*, and a household that has since typed their own name over it has
    // still not added a record — the row is the same row, and its id is the
    // one `auth.currentPerson` points at. Matching on the name would refuse
    // every household that had introduced itself.
    const own = this.db.actor?.personId ?? '';
    if (people.length === 1 && people[0].id !== own) return people.length;

    for (const name of entityNames()) {
      if (name === 'person') continue;
      const rows = await this.repo(name).list({ limit: 1 }).catch(() => []);
      if (rows.length) return people.length + rows.length;
    }

    return 0;
  }

  /**
   * Take it out again.
   *
   * A row the household has since deleted itself is not an error — `remove`
   * on a missing id is counted as already gone rather than failing the whole
   * removal, because a removal that stops halfway is worse than one that
   * tolerates a row somebody got to first.
   */
  async remove() {
    const meta = await loadedExample(this.db);
    if (!meta) return { removed: 0, present: false };

    let removed = 0;
    for (const { entity, id } of [...meta.ids].reverse()) {
      try {
        await this.repo(entity).remove(id);
        removed += 1;
      } catch {
        // Already gone, or refused by a permission this account does not have.
        // Either way it is not this removal's to force.
      }
    }

    await this.db.setMeta(META_KEY, null);
    return { removed, present: true };
  }
}
