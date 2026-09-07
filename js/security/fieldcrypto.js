/**
 * Field-level encryption.
 *
 * Only fields marked `encrypted` in the schema are protected. That is a
 * deliberate line, not laziness: a record whose every field is ciphertext
 * cannot be indexed, sorted, filtered or searched without decrypting the whole
 * store on every keystroke. So the searchable shape of a record stays clear —
 * that a policy exists, who it covers, when it renews — and the parts that
 * would actually hurt in someone else's hands do not.
 *
 * What is protected: identity document numbers, account numbers, PF and UAN,
 * chassis and engine numbers, diagnoses and prescriptions, every vault field,
 * licence keys.
 *
 * What is not: names, dates, categories, amounts. Someone with the Google
 * Sheet can see that the family spent ₹40,000 in March. They cannot see the
 * Aadhaar number, the passwords, or the medical notes.
 */

import { entity } from '../data/schema.js';
import { encryptText, decryptText, isEncrypted } from './crypto.js';

/**
 * Bind a ciphertext to its exact location. A value lifted out of one cell and
 * pasted into another fails its authentication tag rather than decrypting.
 */
function contextFor(entityName, recordId, fieldKey) {
  return `familyos:${entityName}:${recordId}:${fieldKey}`;
}

/** Encrypt every `encrypted` field in place, returning a new record. */
export async function encryptRecord(entityName, record, key) {
  const fields = entity(entityName).fields.filter((f) => f.encrypted);
  if (!fields.length) return record;

  const out = { ...record };
  for (const f of fields) {
    const value = out[f.key];
    if (value === undefined || value === null || value === '') continue;
    if (isEncrypted(value)) continue; // already sealed; re-sealing would double-wrap
    out[f.key] = await encryptText(key, String(value), contextFor(entityName, record.id, f.key));
  }
  return out;
}

/**
 * Decrypt in place. A field that will not decrypt is replaced with a marker
 * rather than throwing: one corrupt cell in a spreadsheet must not make the
 * whole list view unreachable.
 */
export async function decryptRecord(entityName, record, key) {
  const fields = entity(entityName).fields.filter((f) => f.encrypted);
  if (!fields.length) return record;

  const out = { ...record };
  for (const f of fields) {
    const value = out[f.key];
    if (!isEncrypted(value)) continue;
    try {
      out[f.key] = await decryptText(key, value, contextFor(entityName, record.id, f.key));
    } catch {
      out[f.key] = '';
      out._undecryptable = [...(out._undecryptable ?? []), f.key];
    }
  }
  return out;
}

export async function decryptMany(entityName, records, key) {
  const out = [];
  for (const r of records) out.push(await decryptRecord(entityName, r, key));
  return out;
}

/*
 * `hasSealedFields` was here, and its comment said it gated a report export.
 *
 * It gated nothing. It had **no caller** — not in `js/`, not in `tests/`, not
 * in `tools/` or `docs/` — and it could not have fired if it had one:
 * `repository.js` decrypts on the read path, and the report writers take
 * their rows from `db.repo(name).list(...)`, so every record that could reach
 * it was already plaintext. Making it return `false` unconditionally changed
 * nothing and was caught by nothing, which is how it was found.
 *
 * Removed rather than wired up. A function whose comment claims it gates a
 * security decision, which nothing calls, is worse than no function: it makes
 * a reviewer believe a control exists. If a report ever needs that gate, the
 * decrypt path is where it belongs.
 */

/**
 * Values safe to put in the local search index. Ciphertext is excluded
 * outright — indexing it would leak nothing useful and cost a decrypt per
 * keystroke to search.
 */
export function searchableValues(entityName, record) {
  return entity(entityName).fields
    .filter((f) => f.search && !f.encrypted)
    .map((f) => record[f.key])
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map((v) => (Array.isArray(v) ? v.join(' ') : String(v)));
}
