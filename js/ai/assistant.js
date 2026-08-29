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
import { t } from '../core/locale.js';

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
  /** Entities a question needed and could not read. Not the same as empty. */
  #unreadable = new Set();

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
    } catch (err) {
      /*
       * A refusal and a failure are not the same empty list.
       *
       * This used to swallow both and say "no permission" in a comment. A
       * role that may not read transactions legitimately contributes nothing,
       * and the answer is computed without it — that is the design. But a
       * decryption failure, a corrupt row or IndexedDB refusing is not an
       * absence of records; it is an inability to read the ones that exist,
       * and computing an answer from `[]` turns it into a statement about the
       * household's money.
       *
       * Measured: with `list` throwing, "How much did we spend this year?"
       * answered *"No transactions are recorded between 1 Jan 2026 and
       * 31 Dec 2026."* — confidently, and false.
       *
       * `PermissionError` carries `code: 'permission'` from `core/errors.js`,
       * so the two are already distinguishable. Anything else is recorded and
       * `answer` refuses rather than asserts.
       */
      rows = [];
      if (err?.code !== 'permission') this.#unreadable.add(entityName);
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
    this.#unreadable.clear();

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

      /*
       * An answer computed over records that could not be read is not an
       * answer. It is the same sentence a household with no records gets,
       * which is the one thing it must not be mistaken for — so this refuses
       * rather than caveats. A number nobody can trust is worse than no
       * number, and this is the file whose whole premise is that confidence
       * is not verification.
       */
      if (this.#unreadable.size) {
        const names = [...this.#unreadable].sort();
        return {
          text: t('assistant.unreadable', { names: names.join(' or ') }),
          intent: hit.intent.id,
          unreadable: names,
        };
      }

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
