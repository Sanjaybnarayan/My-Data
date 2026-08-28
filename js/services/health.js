/**
 * Assembling the health question.
 *
 * The domain decides what counts as a question the records raise; this is the
 * only place that knows those records live in four repositories and that all
 * four hang off a `person`. A screen doing that join inline is a screen that
 * can disagree with another screen about what a household's medicines are.
 *
 * Nothing here decrypts more than it needs. `diagnosis`, `prescription`,
 * `prescribedBy` and `batchNumber` are encrypted fields, and not one of the
 * findings below depends on their contents — so the lists are read with
 * `decrypt: false` where the repository allows it, and a diagnosis somebody
 * wrote down is never held in memory to answer a question about a date.
 */

import { Service } from './service.js';
import { openQuestions, medicationState, appointmentState } from '../domain/health.js';

const LIMIT = 500;

export class HealthService extends Service {
  /**
   * Every question the records raise, and the people they are about.
   *
   * @param {{clock?: () => number}} [options]
   */
  async questions({ clock = Date.now } = {}) {
    const [medications, appointments, vaccinations, records] = await Promise.all([
      this.#list('medication'),
      this.#list('appointment'),
      this.#list('vaccination'),
      this.#list('healthRecord'),
    ]);

    const people = await this.repo('person').list({ decrypt: false, limit: LIMIT })
      .catch(() => []);
    const byId = new Map(people.map((one) => [one.id, one]));

    return openQuestions({ medications, appointments, vaccinations, records }, { clock })
      .map((one) => ({ ...one, personName: byId.get(one.person)?.name ?? '' }));
  }

  /**
   * What is current, for the household: medicines being taken and
   * appointments still ahead.
   *
   * Both are derived by the domain rather than read from the stored flag.
   * `ongoing` is a tick box that defaults to true and nothing ever unticks, so
   * a screen listing "current medications" from that field alone would show a
   * course that finished in March.
   */
  async current({ clock = Date.now } = {}) {
    const [medications, appointments] = await Promise.all([
      this.#list('medication'),
      this.#list('appointment'),
    ]);

    return {
      medications: medications
        .filter((row) => ['open', 'running'].includes(medicationState(row, { clock }).state)),
      appointments: appointments
        .map((row) => ({ row, said: appointmentState(row, { clock }) }))
        .filter(({ said }) => said.state === 'today' || said.state === 'upcoming')
        .sort((a, b) => (a.said.days ?? 0) - (b.said.days ?? 0))
        .map(({ row }) => row),
    };
  }

  /**
   * A list, without the encrypted fields nothing here reads.
   *
   * `decrypt: false` is not available on every repository, and an entity that
   * refuses it must still be readable — so a refusal falls back to the plain
   * read rather than returning an empty list and reporting no questions at
   * all, which would be the silent data loss this repository keeps refusing to
   * ship.
   */
  async #list(entity) {
    return this.repo(entity).list({ decrypt: false, limit: LIMIT })
      .catch(() => this.repo(entity).list({ limit: LIMIT }).catch(() => []));
  }
}
