/**
 * What has been happening, as things rather than log lines.
 *
 * The grouping is pure and lives in `domain/timeline.js`. What needs a service
 * is the part that makes the sentences worth reading: **naming the record**.
 *
 * `data/audit.js`'s `describe` has always said *"changed name on an account"*,
 * because an audit entry carries an entity name and a record id and the label
 * is all it can reach. Turning that id into "HDFC Savings" means loading a
 * record of whatever entity the entry names — a cross-entity read, which is
 * the second of the two things `services/service.js` says this layer is for.
 */

import { Service } from './service.js';
import { entity as entityDef } from '../data/schema.js';
import { stories, since as entriesSince, describeStory } from '../domain/timeline.js';

/** Where the "since you last looked" mark is kept. */
export const SEEN_KEY = 'activity.seenAt';

export class TimelineService extends Service {
  /**
   * Recent activity, grouped, named, and marked against the last visit.
   *
   * The mark is **read here and written by the caller**, after it has drawn
   * what it read. Writing it here would clear the answer in the act of asking
   * for it — a household would open the screen and be told nothing had
   * happened, every time.
   *
   * @param {{limit?: number}} [options]
   */
  async recent({ limit = 200 } = {}) {
    const mark = await this.db.meta(SEEN_KEY);
    const entries = await this.db.activity({ limit });

    const fresh = entriesSince(entries, mark);
    const grouped = stories(fresh.length ? fresh : entries);

    const people = await this.repo('person').list({ decrypt: false, limit: 500 })
      .catch(() => []);
    const byId = new Map(people.map((person) => [person.id, person.name]));

    const titles = await this.#titles(grouped);

    return {
      // Whether these are things the household has not seen, or simply the
      // latest. A screen saying "since you last looked" over a first run would
      // be claiming something about a visit that never happened.
      unseen: Boolean(mark) && fresh.length > 0,
      mark,
      stories: grouped,
      describe: (story) => describeStory(story, {
        nameOf: (id) => byId.get(id) ?? id,
        titleOf: (name, id) => titles.get(`${name}:${id}`) ?? null,
        labelOf: (name) => (name ? entityDef(name).labels.one.toLowerCase() : 'record'),
      }),
    };
  }

  /**
   * The whole log, rather than the part nobody has seen.
   *
   * `recent()` answers "what has happened since I last looked", and collapses
   * to the latest when the answer is nothing — which is the right answer for a
   * dashboard card and the wrong one for a history. Asking it for a timeline
   * gives a household their unseen changes and hides everything before them.
   *
   * It is also what makes the dashboard's eight the ceiling. The service builds
   * every story in the window and the card slices the first eight off the
   * front; on a store with 34 entries that is 26 built and dropped, and on a
   * household that has used this for a year it is nearly all of them.
   *
   * @param {{limit?: number, entityName?: string, since?: string}} [options]
   */
  async history({ limit = 500, entityName, since } = {}) {
    const entries = await this.db.activity({ limit, entityName, since });
    const grouped = stories(entries);

    const people = await this.repo('person').list({ decrypt: false, limit: 500 })
      .catch(() => []);
    const byId = new Map(people.map((person) => [person.id, person.name]));
    const titles = await this.#titles(grouped);

    return {
      stories: grouped,
      entries: entries.length,
      // The entities that actually appear, so a filter offers what a household
      // has rather than all forty-three of them — most of which they have never
      // touched, and every one of which would return nothing.
      present: [...new Set(entries.map((e) => e.entity).filter(Boolean))].sort(),
      truncated: entries.length >= limit,
      describe: (story) => describeStory(story, {
        nameOf: (id) => byId.get(id) ?? id,
        titleOf: (name, id) => titles.get(`${name}:${id}`) ?? null,
        labelOf: (name) => (name ? entityDef(name).labels.one.toLowerCase() : 'record'),
      }),
    };
  }

  /** Mark everything up to now as seen. Called after drawing, never before. */
  async markSeen(at = new Date().toISOString()) {
    return this.db.setMeta(SEEN_KEY, at);
  }

  /**
   * The title of each record a story is about.
   *
   * One read per distinct record rather than one per entry, and a record the
   * household has since deleted simply has no title — the entity's own label
   * stands in, because "an account" is still true.
   */
  async #titles(grouped) {
    const wanted = new Map();
    for (const story of grouped) {
      if (!story.entity || !story.recordId) continue;
      wanted.set(`${story.entity}:${story.recordId}`, story);
    }

    const titles = new Map();
    for (const [key, story] of wanted) {
      const record = await this.repo(story.entity).get(story.recordId).catch(() => null);
      if (!record) continue;
      const title = entityDef(story.entity).title(record);
      if (title) titles.set(key, String(title));
    }
    return titles;
  }
}
