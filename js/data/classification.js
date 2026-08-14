/**
 * How sensitive is this field?
 *
 * The schema has carried one boolean — `encrypted` — which answers "is this
 * ciphertext at rest". That is a storage decision, and it turns out to be the
 * wrong question to hang everything else on: a PAN, a medical note and a
 * vault password are all `encrypted: true` and are not remotely alike when it
 * comes to masking, export, search, retention, or what may be handed to a
 * model. Meanwhile a bank balance is `encrypted: false` — because a search
 * index over ciphertext finds nothing — and is plainly not public.
 *
 * So this file adds the axis that was missing, and it is deliberately *not*
 * stored on the record. It is a property of the field, derived once from the
 * schema, and every consumer keys off it.
 *
 * ## Derived, not hand-annotated
 *
 * There are 426 fields. Hand-labelling them would be 426 chances to be wrong
 * and one afternoon before the labels drifted from the schema they describe.
 * Instead the level is derived from signals the schema already carries —
 * field type, `encrypted`, the entity's access list, the module it lives in —
 * with an explicit `classification:` on a field overriding when the derivation
 * is not good enough.
 *
 * The derivation is **conservative**: every rule errs upward. A field that
 * matches nothing lands at PRIVATE, not PUBLIC. `assertSound()` below is the
 * check that keeps it honest — no encrypted field may derive to less than
 * HIGHLY_SENSITIVE, and no CRITICAL_SECRET may be stored in the clear.
 *
 * ## PUBLIC is never assigned, and that is the point
 *
 * Nothing in a household record keeper is public. The level exists so the
 * scale matches the one everybody writes policies against, not because
 * anything here reaches it. Saying that plainly is better than finding a
 * reason to use it.
 */

import { entities } from './schema.js';

/**
 * Least sensitive first. The order *is* the comparison — `atLeast` indexes
 * into it — so inserting a level in the middle changes every comparison, which
 * is correct and is why they are in one place.
 */
export const LEVELS = Object.freeze([
  'PUBLIC',
  'INTERNAL',
  'PRIVATE',
  'SENSITIVE',
  'HIGHLY_SENSITIVE',
  'CRITICAL_SECRET',
]);

/** What each level means, in the terms a person would use. */
export const MEANING = Object.freeze({
  PUBLIC: 'Safe to show anyone. Nothing in FamilyOS is classified this way.',
  INTERNAL: 'Housekeeping the application needs — ids, timestamps, versions.',
  PRIVATE: 'Ordinary household detail. Not secret, not for strangers.',
  SENSITIVE: 'Would embarrass or expose if leaked — balances, addresses, employers.',
  HIGHLY_SENSITIVE: 'Identity and health. A leak here is not recoverable by changing it.',
  CRITICAL_SECRET: 'Grants access to something else. Never displayed, never exported in the clear.',
});

/** Structural fields every record carries. Not household data. */
const STRUCTURAL = new Set([
  'id', 'createdAt', 'updatedAt', 'deletedAt', 'version', 'importKey', 'statement',
]);

/** Modules whose contents are identity or health whatever the field says. */
const ALWAYS_HIGH = new Set(['health', 'identity', 'vault']);

const index = (level) => LEVELS.indexOf(level);

/** Is `level` at least as sensitive as `minimum`? */
export function atLeast(level, minimum) {
  return index(level) >= index(minimum);
}

/**
 * The level for one field.
 *
 * Rules are tried in order and the first match wins. Each is written so that
 * being wrong makes a field *more* protected than it needs to be, never less.
 *
 * @param {object} field a field descriptor from the schema
 * @param {object} [owner] the entity it belongs to
 */
export function classify(field, owner = null) {
  // A field nobody can find is a caller asking about something that does not
  // exist — a typo, or a key that was renamed and not chased down. Answering
  // with a mild level would let that mistake through as "safe to display",
  // which is the one direction this file must never fail in. So the unknown
  // case is the *most* protected, and `classificationOf` says so out loud.
  if (!field) return 'CRITICAL_SECRET';

  // 1. Declared beats derived, always. This is the escape hatch for the cases
  //    the rules below get wrong, and the only one that should ever be needed.
  if (field.classification) return field.classification;

  // 2. A password, a licence key, a TOTP seed. These do not identify anybody —
  //    they open something, which is a different and worse kind of loss.
  if (field.type === 'password') return 'CRITICAL_SECRET';

  // 3. Somebody already decided this was worth the cost of ciphertext. That
  //    decision is evidence, and this rule is what `assertSound` enforces:
  //    encryption can raise a classification but must never contradict one.
  if (field.encrypted) return 'HIGHLY_SENSITIVE';

  // 4. Identity, health and the vault, whatever the individual field holds. A
  //    prescription's *date* is not sensitive in isolation; attached to a
  //    named person and a medicine it is.
  if (owner && ALWAYS_HIGH.has(owner.module)) return 'HIGHLY_SENSITIVE';

  // 5. Housekeeping. Deliberately after the rules above, so an id that is also
  //    encrypted does not get demoted by being called structural.
  if (STRUCTURAL.has(field.key)) return 'INTERNAL';

  // 6. An entity only the heads of household may read was already judged
  //    sensitive by whoever set that access list.
  if (owner && isOwnersOnly(owner)) return 'HIGHLY_SENSITIVE';
  if (owner && isAdultsOnly(owner)) return 'SENSITIVE';

  // 7. Money is sensitive wherever it appears, including on entities the whole
  //    household can read.
  if (field.type === 'currency') return 'SENSITIVE';

  // 8. Everything else. Not public — see the note at the top.
  return 'PRIVATE';
}

const readers = (owner) => owner?.acl?.read ?? [];
const isOwnersOnly = (owner) => readers(owner).length > 0
  && readers(owner).every((role) => role === 'owner' || role === 'spouse');
const isAdultsOnly = (owner) => readers(owner).length > 0
  && !readers(owner).includes('child') && !readers(owner).includes('guest');

/**
 * The level for a field named by entity and key.
 *
 * An unknown entity or key comes back `CRITICAL_SECRET` — see `classify`. That
 * is deliberately inconvenient: masking everything is a visible bug, and
 * revealing something because a key was misspelt is an invisible one.
 */
export function classificationOf(entityName, key) {
  const owner = entities[entityName] ?? null;
  return classify(owner?.fieldMap?.[key] ?? null, owner);
}

/** Whether a field exists at all, so callers can tell "secret" from "typo". */
export function isKnownField(entityName, key) {
  return Boolean(entities[entityName]?.fieldMap?.[key]);
}

/**
 * Every field, with its level. The basis of the privacy report and of the
 * checks below.
 */
export function classified() {
  const rows = [];
  for (const owner of Object.values(entities)) {
    for (const f of owner.fields) {
      rows.push({
        entity: owner.name,
        module: owner.module,
        key: f.key,
        label: f.label ?? f.key,
        type: f.type,
        encrypted: Boolean(f.encrypted),
        searchable: Boolean(f.search),
        level: classify(f, owner),
      });
    }
  }
  return rows;
}

/** How many fields sit at each level. */
export function census() {
  const counts = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  for (const row of classified()) counts[row.level] += 1;
  return counts;
}

/**
 * Identifier-shaped keys: a value that *proves or grants* something.
 *
 * `Number` and `no` at the end, `id` at the end, and the handful of Indian
 * identifiers whose names carry no such suffix. Deliberately a shape test on
 * the key rather than a list of 426 decisions — a new `policyNumber` on a new
 * entity is caught the day it is added.
 *
 * **It is positional, and that is a hazard worth naming.** `pan` matches and
 * `heldPan` does not, so an identifier can be hidden from this test by
 * prefixing it. `kin` was added to the explicit list when `kycRecord` arrived,
 * after measuring that it was rendered in full; the fields on that entity are
 * named bare for the same reason. A test in `tests/security.test.mjs` sweeps
 * every entity for identifier words in a key that this misses.
 */
const IDENTIFIER_KEY =
  /(number|no|id|code)$|^(uan|pan|ifsc|upiId|kin)$|chassis|engine|fastag|khata|survey|credential|registration/i;

/**
 * Should this field's value be hidden on screen by default?
 *
 * **This is a different question from how sensitive it is, and conflating the
 * two would have made the application unusable.**
 *
 * 105 fields classify `HIGHLY_SENSITIVE`, and they include `person.name`,
 * `healthRecord.kind` and `appointment.status`. Those are genuinely sensitive
 * *as data* — a name attached to a diagnosis is a medical record — and
 * completely unmaskable *as display*: nobody can run a family app where every
 * person is `XXXX ita` and every appointment is `XXXX led`.
 *
 * So classification answers "how bad is a leak of this dataset", and masking
 * answers the narrower "should somebody already authorised to open this record
 * have to ask to see this particular value". Only identifiers and credentials
 * clear that second bar: an account number, a policy number, a passport
 * number, a password. Names, dates, diagnoses and amounts do not — hiding them
 * protects nothing from the person reading the screen and destroys the thing
 * they opened it for.
 *
 * A `number`-typed field is a count, not an identifier — `doseNumber` is "2 of
 * 3" — so the type check is what keeps quantities out.
 *
 * @param {object} field
 * @param {object} [owner]
 */
export function maskable(field, owner = null) {
  if (!field) return true;
  if (typeof field.mask === 'boolean') return field.mask;

  const level = classify(field, owner);
  if (level === 'CRITICAL_SECRET') return true;
  if (!atLeast(level, 'HIGHLY_SENSITIVE')) return false;

  // Text only. A count, a date, an amount or a chosen option is not an
  // identifier however sensitive the record around it is.
  if (field.type !== 'text' && field.type !== 'password') return false;
  return IDENTIFIER_KEY.test(field.key);
}

/** Whether a named field is masked by default. */
export function maskableField(entityName, key) {
  const owner = entities[entityName] ?? null;
  return maskable(owner?.fieldMap?.[key] ?? null, owner);
}

/**
 * Mask a value for display at its level.
 *
 * `CRITICAL_SECRET` has no partial form on purpose — showing the last four
 * characters of a password narrows it for whoever is reading over a shoulder
 * and helps nobody remember which one it is.
 */
export function mask(value, level, { reveal = false } = {}) {
  if (value === null || value === undefined || value === '') return '';
  if (reveal && level !== 'CRITICAL_SECRET') return String(value);

  const text = String(value);
  if (level === 'CRITICAL_SECRET') return '••••••••';
  if (level === 'HIGHLY_SENSITIVE') {
    const tail = text.slice(-4);
    return tail.length ? `${'X'.repeat(Math.max(4, text.length - 4))} ${tail}`.trim() : '••••';
  }
  return text;
}

/**
 * The invariants that keep the derivation from quietly rotting.
 *
 * Called by the test suite rather than at boot: it walks every field, and a
 * schema that violates one of these is a bug to fix at the source, not a
 * condition to handle at run time.
 *
 * @returns {string[]} one message per violation, empty when sound
 */
export function assertSound() {
  const problems = [];

  for (const row of classified()) {
    const where = `${row.entity}.${row.key}`;

    // Encryption is evidence of sensitivity. If a field is ciphertext and the
    // rules put it below HIGHLY_SENSITIVE, the rules are wrong.
    if (row.encrypted && !atLeast(row.level, 'HIGHLY_SENSITIVE')) {
      problems.push(`${where} is encrypted but classified ${row.level}`);
    }

    // A secret that opens something must not be sitting in the clear — in
    // IndexedDB or, worse, in the backup spreadsheet.
    if (row.level === 'CRITICAL_SECRET' && !row.encrypted) {
      problems.push(`${where} is CRITICAL_SECRET but is stored in the clear`);
    }

    // A searchable field is necessarily plaintext, so it must not be claiming
    // a level that implies it is not readable.
    if (row.searchable && row.level === 'CRITICAL_SECRET') {
      problems.push(`${where} is CRITICAL_SECRET but is in the search index`);
    }

    if (!LEVELS.includes(row.level)) {
      problems.push(`${where} has an unknown classification ${row.level}`);
    }
  }

  return problems;
}
