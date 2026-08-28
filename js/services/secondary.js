/**
 * The joins the secondary modules' screens need, in one place.
 *
 * Each of these is a question one entity cannot answer on its own — a property
 * against its tenant records, a list of contacts against itself — and the only
 * place that knows which repositories hold them.
 *
 * Nothing here decrypts more than it needs. None of these findings depends on
 * an encrypted field, so every read passes `decrypt: false` and falls back to a
 * plain read where a repository refuses it, rather than returning an empty
 * list and reporting no findings at all.
 */

import { Service } from './service.js';
import { tenancyQuestions } from '../domain/tenancy.js';
import { taskContradictions, reachability } from '../domain/upkeep.js';

const LIMIT = 500;

export class SecondaryService extends Service {
  /** Properties whose tenancy is recorded in two places, or only one. */
  async tenancies() {
    const [properties, tenants] = await Promise.all([
      this.#list('property'), this.#list('tenant'),
    ]);
    return tenancyQuestions(properties, tenants);
  }

  /** Tasks whose status and completion date disagree. */
  async tasks() {
    return taskContradictions(await this.#list('task'));
  }

  /** Whether the emergency list could be used in a hurry. */
  async reach() {
    return reachability(await this.#list('emergencyContact'));
  }

  async #list(entity) {
    return this.repo(entity).list({ decrypt: false, limit: LIMIT })
      .catch(() => this.repo(entity).list({ limit: LIMIT }).catch(() => []));
  }
}
