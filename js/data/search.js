/**
 * Local search.
 *
 * An inverted index kept in its own store and updated inside the same
 * transaction as the record it describes, so the index can never describe a
 * record that was rolled back.
 *
 * Terms are prefixes, not whole words: "pass" has to match "passport" while
 * the user is still typing, and a trailing-wildcard scan over an IndexedDB
 * index is not a thing. Storing every prefix from three characters up costs
 * roughly five entries per word and turns search into an exact lookup.
 *
 * Ciphertext is never indexed. Searching an encrypted field would mean
 * decrypting every record on every keystroke, which is both slow and worse for
 * privacy than not offering it — so vault passwords and Aadhaar numbers are
 * findable by their labels and not by their contents.
 */

import { searchableValues } from '../security/fieldcrypto.js';
import { entity } from './schema.js';

const MIN_PREFIX = 3;
const MAX_TERM = 20;

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    // Keep digits attached to letters: "kA01ab1234" is one useful token.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w.length >= 2)
    .map((w) => w.slice(0, MAX_TERM));
}

/** Every prefix of every word, from MIN_PREFIX characters up. */
export function prefixes(words) {
  const out = new Set();
  for (const word of words) {
    const start = Math.min(MIN_PREFIX, word.length);
    for (let i = start; i <= word.length; i++) out.add(word.slice(0, i));
  }
  return [...out];
}

export function indexKey(entityName, id) {
  return `${entityName}:${id}`;
}

/**
 * The index row for a record. `title` is denormalised so a result can be shown
 * without a second read of the entity store.
 */
export function indexEntry(entityName, record) {
  const def = entity(entityName);
  const values = searchableValues(entityName, record);
  const words = values.flatMap(tokenize);
  return {
    id: indexKey(entityName, record.id),
    entity: entityName,
    recordId: record.id,
    term: prefixes(words),
    title: String(def.title(record) ?? ''),
    subtitle: String(def.subtitle(record) ?? ''),
    module: def.module,
    updatedAt: record.updatedAt,
  };
}

/**
 * Rank matches. A hit on the title beats a hit on a note, an exact word beats
 * a prefix, and a recently touched record beats a stale one — in that order,
 * because "find passport" should not return a five-year-old note first.
 */
export function score(entry, query) {
  const q = query.toLowerCase();
  const title = entry.title.toLowerCase();
  let points = 0;
  if (title === q) points += 100;
  else if (title.startsWith(q)) points += 60;
  else if (title.includes(q)) points += 30;
  if (entry.subtitle?.toLowerCase().includes(q)) points += 10;
  // Recency as a tiebreak only: at most 9 points, so it never outranks a
  // title match.
  const age = Date.now() - Date.parse(entry.updatedAt ?? 0);
  const days = age / 86_400_000;
  points += Math.max(0, 9 - Math.log10(Math.max(days, 1)) * 3);
  return points;
}

/**
 * @param {object} adapter storage adapter
 * @param {string} query raw user text
 * @param {{limit?: number, entities?: string[]}} [options]
 */
export async function searchIndex(adapter, query, options = {}) {
  const { limit = 30, entities: only } = options;
  const words = tokenize(query).filter((w) => w.length >= MIN_PREFIX);
  if (!words.length) return [];

  // Intersect the postings for each word so "hdfc card" needs both.
  let candidates = null;
  for (const word of words) {
    const term = word.slice(0, MAX_TERM);
    const rows = await adapter.query('search', { index: 'byTerm', range: { only: term } });
    const ids = new Map(rows.map((r) => [r.id, r]));
    if (candidates === null) {
      candidates = ids;
    } else {
      for (const id of [...candidates.keys()]) if (!ids.has(id)) candidates.delete(id);
    }
    if (candidates.size === 0) return [];
  }

  let results = [...candidates.values()];
  if (only?.length) results = results.filter((r) => only.includes(r.entity));

  return results
    .map((entry) => ({ ...entry, score: score(entry, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
