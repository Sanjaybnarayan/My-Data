/**
 * Assembling the passport question.
 *
 * The domain decides what counts as a problem; this is the only place that
 * knows a trip's travellers are `person` ids and that a passport is an
 * `identityDocument` with `kind` of Passport. A screen doing that join inline
 * is a screen that can disagree with another screen about what a passport is.
 */

import { Service } from './service.js';
import { passportReadiness, describeReadiness, upcoming } from '../domain/travel.js';

export class TravelService extends Service {
  /** Trips still to come or under way, each with its readiness line. */
  async readiness({ today = new Date().toISOString().slice(0, 10) } = {}) {
    const trips = await this.repo('trip').list({ limit: 200 });
    const rows = upcoming(trips, today);
    if (!rows.length) return [];

    const people = await this.repo('person').list({ decrypt: false, limit: 500 }).catch(() => []);
    const documents = await this.repo('identityDocument').list({ limit: 500 }).catch(() => []);

    return rows.map(({ trip, current }) => {
      const readiness = passportReadiness(trip, { people, documents });
      return { trip, current, readiness, line: describeReadiness(readiness) };
    });
  }
}
