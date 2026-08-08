/**
 * The assistant.
 *
 * Matches a question against the intent registry, runs the winning handler
 * against local records, and returns a structured answer. It never guesses:
 * when nothing matches, it says so and offers the questions it does
 * understand.
 *
 * Two properties matter more than cleverness here, and both are deliberate:
 *
 *   - **It is offline.** No request leaves the device. A household's medical
 *     and financial records are not sent anywhere to answer "when does the
 *     insurance expire".
 *   - **It is auditable.** Every answer carries the records it was computed
 *     from, so a figure can be opened and checked rather than trusted.
 *
 * The seam for a hosted model is `answer()`: an implementation that called one
 * would slot in beside `matchIntent`, with the same contract. That is a
 * deliberate future, not a claim about today.
 */

import { intents, parsePeriod, exampleQuestions } from './intents.js';
import { entities } from '../data/schema.js';

/** @typedef {{text: string, intent?: string, [extra: string]: unknown}} Answer */

export function matchIntent(question) {
  const text = question.trim();
  if (!text) return null;

  const scored = [];
  for (const intent of intents) {
    for (const pattern of intent.patterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      // Longer matches win: "net worth" beats a bare "worth", and a specific
      // intent beats a generic one that happened to share a word.
      scored.push({ intent, match, weight: match[0].length });
      break;
    }
  }

  if (!scored.length) return null;
  scored.sort((a, b) => b.weight - a.weight);
  return scored[0];
}

export class Assistant {
  #db;
  #clock;
  #cache = new Map();

  constructor({ db, clock = Date.now }) {
    this.#db = db;
    this.#clock = clock;
  }

  /**
   * Records the signed-in role may read, decrypted, cached for the life of
   * one question — an intent that reads transactions three times should not
   * decrypt them three times.
   */
  async load(entityName) {
    if (!entities[entityName]) return [];
    if (this.#cache.has(entityName)) return this.#cache.get(entityName);
    let rows = [];
    try {
      rows = await this.#db.repo(entityName).list({ limit: 10_000 });
    } catch {
      rows = []; // no permission: the answer is computed without it
    }
    this.#cache.set(entityName, rows);
    return rows;
  }

  search(term, options) {
    return this.#db.search(term, options);
  }

  /** @returns {Promise<Answer>} */
  async answer(question) {
    this.#cache.clear();

    const hit = matchIntent(question);
    if (!hit) return this.#unknown(question);

    const ctx = {
      text: question.trim(),
      match: hit.match,
      period: parsePeriod(question, this.#clock),
      clock: this.#clock,
      load: (name) => this.load(name),
      search: (term, options) => this.search(term, options),
      db: this.#db,
    };

    try {
      const result = await hit.intent.handle(ctx);
      if (!result) return this.#unknown(question);
      return {
        ...result,
        intent: hit.intent.id,
        // Stated so an answer about "last month" cannot be misread as
        // "all time" when the question did not say.
        period: ctx.period.assumed ? { ...ctx.period, note: 'assumed this month' } : ctx.period,
      };
    } catch (err) {
      return {
        text: 'I could not work that out from the records on this device.',
        error: err.message,
        intent: hit.intent.id,
      };
    }
  }

  #unknown(question) {
    // Offer the two closest questions rather than the whole list.
    const words = new Set(question.toLowerCase().split(/\W+/).filter((w) => w.length > 3));
    const suggestions = exampleQuestions()
      .map((example) => ({
        example,
        overlap: example.toLowerCase().split(/\W+/).filter((w) => words.has(w)).length,
      }))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 3)
      .map((s) => s.example);

    return {
      text: 'I do not understand that one. I answer questions about spending, income, '
        + 'net worth, investments, bills, budgets, expiries, tasks and where documents are.',
      suggestions,
      unmatched: true,
    };
  }
}

export { exampleQuestions };
