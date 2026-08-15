/**
 * The CKYC conflict engine — Phase 2, and the prompt's identity tests.
 *
 * ## What existed, and what could not run
 *
 * `domain/kyc.js` compares **one person** across the institutions holding their
 * KYC, and does it well. Every one of its functions takes a person.
 *
 * The prompt's sharpest identity test is not about one person:
 *
 * > Same CKYC assigned to two people: **CRITICAL IDENTITY CONFLICT**
 *
 * That is a question about the whole household at once, and nothing here could
 * ask it. A KIN appearing against a husband and a wife is either a bank's error
 * or somebody's identity being used twice, and both matter more than any
 * single-person drift.
 *
 * ## Why nothing is ever merged
 *
 * The prompt says *"never automatically merge"*, and the reason is worth
 * stating rather than obeying blindly: a conflict between two identity records
 * is evidence that **something is wrong somewhere else** — at a bank, in a
 * registry, or in what somebody was told. Merging them makes the application's
 * copy tidy and destroys the only signal that the disagreement existed.
 *
 * So every function here reports. None writes, none picks a winner, and the
 * severities exist to say how loudly to report — never to license an action.
 *
 * ## The four answers
 *
 * `MATCH`, `POSSIBLE_MATCH`, `CONFLICT`, `UNKNOWN` — the prompt's vocabulary.
 * `UNKNOWN` is not a soft `CONFLICT`: a field nobody recorded is a gap, and
 * calling it a disagreement would fill the screen with noise that no household
 * can act on.
 */

export const AGREEMENT = Object.freeze({
  MATCH: 'MATCH',
  POSSIBLE_MATCH: 'POSSIBLE_MATCH',
  CONFLICT: 'CONFLICT',
  UNKNOWN: 'UNKNOWN',
});

export const SEVERITY = Object.freeze({
  /** One identifier, two people. Nothing else here outranks it. */
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  NORMAL: 'NORMAL',
});

/**
 * What *kind* of thing is wrong — which is not the same question as how loudly
 * to say it.
 *
 * The first version of `describeConflict` below read the fields of a shared
 * identifier whenever the severity was `CRITICAL`, which happened to work only
 * because nothing else is ever critical today. The moment a field disagreement
 * earns that severity — a mismatched PAN, say — that sentence would reach for
 * `people` on a record that has none and print `undefined` at a household.
 *
 * So the shape is carried explicitly and the severity is left to mean only what
 * it says.
 */
export const KIND = Object.freeze({
  SHARED_IDENTIFIER: 'SHARED_IDENTIFIER',
  FIELD: 'FIELD',
});

/**
 * One identifier held against more than one person.
 *
 * @typedef {object} SharedIdentifierConflict
 * @property {'SHARED_IDENTIFIER'} kind
 * @property {string} identifier The *field name*, never the value. See below.
 * @property {string} field
 * @property {string[]} people
 * @property {string[]} records
 * @property {string} severity
 * @property {string} why
 */

/**
 * One field, where an institution's copy and the household's disagree.
 *
 * @typedef {object} FieldConflict
 * @property {'FIELD'} kind
 * @property {string} person
 * @property {string} record
 * @property {string} institution
 * @property {string} field
 * @property {string} label
 * @property {string} agreement
 * @property {string} ours
 * @property {string} theirs
 * @property {string} severity
 */

/** @typedef {SharedIdentifierConflict | FieldConflict} Conflict */

const plain = (value) => String(value ?? '').trim();

/** Case, spacing and punctuation off — the way a person compares two names. */
const loose = (value) => plain(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Initials and honorifics dropped, so `S N Rao` and `Sanjay Rao` can be near. */
const words = (value) => loose(value)
  .replace(/^(mr|mrs|ms|dr|shri|smt)\s+/, '')
  .split(' ')
  .filter((word) => word.length > 1);

/**
 * How two values for one field agree.
 *
 * A missing value on either side is `UNKNOWN`, never `CONFLICT`. The prompt
 * lists them as separate answers and the difference is the whole usefulness of
 * the screen: a household can act on a disagreement and cannot act on a blank.
 */
export function compareValue(field, a, b) {
  if (!plain(a) || !plain(b)) return AGREEMENT.UNKNOWN;
  if (loose(a) === loose(b)) return AGREEMENT.MATCH;

  if (field === 'name') {
    const left = words(a);
    const right = words(b);
    const shared = left.filter((word) => right.includes(word));
    // A shared surname and a different given name is not a match, and it is
    // not nothing either — it is exactly the pair a person should look at.
    if (shared.length && shared.length < Math.max(left.length, right.length)) {
      return AGREEMENT.POSSIBLE_MATCH;
    }
    return AGREEMENT.CONFLICT;
  }

  if (field === 'address') {
    const left = words(a);
    const right = words(b);
    const shared = left.filter((word) => right.includes(word));
    // Addresses are written a dozen ways. Half the words in common is somebody
    // abbreviating, not somebody living elsewhere.
    if (shared.length >= Math.ceil(Math.min(left.length, right.length) / 2)) {
      return AGREEMENT.POSSIBLE_MATCH;
    }
    return AGREEMENT.CONFLICT;
  }

  // A date, a PAN, a mobile number: these are exact or they disagree. There is
  // no near-miss reading of a date of birth.
  return AGREEMENT.CONFLICT;
}

/**
 * One identifier held against more than one person.
 *
 * The prompt's CRITICAL case. Deliberately checked over the *records* rather
 * than the people, because it is the records that carry the identifier and a
 * person with no KYC record cannot be part of the conflict.
 *
 * @returns {SharedIdentifierConflict[]}
 */
export function sharedIdentifiers(records, { fields = ['kin', 'pan'] } = {}) {
  const out = [];

  for (const field of fields) {
    const byValue = new Map();

    for (const record of records ?? []) {
      if (!record || record.deletedAt) continue;
      const value = loose(record[field]);
      if (!value || !record.person) continue;
      if (!byValue.has(value)) byValue.set(value, []);
      byValue.get(value).push(record);
    }

    for (const [value, held] of byValue) {
      const people = [...new Set(held.map((record) => record.person))];
      if (people.length < 2) continue;

      out.push({
        kind: KIND.SHARED_IDENTIFIER,
        // The identifier itself is *not* returned. It is encrypted at rest and
        // masked on screen, and a conflict report is not a reason to put it in
        // a new place — the record ids are enough to find it.
        identifier: field,
        field,
        people,
        records: held.map((record) => record.id),
        severity: SEVERITY.CRITICAL,
        why: field === 'kin'
          ? `one CKYC identifier is recorded against ${people.length} different people. `
            + 'That is either an institution\'s error or somebody\'s identity being '
            + 'used twice, and nothing here will merge them.'
          : `one ${field.toUpperCase()} is recorded against ${people.length} different `
            + 'people. A PAN belongs to one person.',
      });
      // `value` is deliberately unused beyond grouping — see above.
      void value;
    }
  }

  return out;
}

/** What a KYC record and the household's own record are compared on. */
const COMPARED = Object.freeze([
  { field: 'name', held: 'heldName', own: 'name', label: 'Name' },
  { field: 'birthday', held: 'heldBirthday', own: 'birthday', label: 'Date of birth' },
  { field: 'gender', held: 'heldGender', own: 'gender', label: 'Gender' },
  { field: 'address', held: 'heldAddress', own: 'address', label: 'Address' },
  { field: 'mobile', held: 'heldMobile', own: 'mobile', label: 'Mobile' },
  { field: 'email', held: 'heldEmail', own: 'email', label: 'Email' },
]);

/**
 * Where an institution's copy of a person disagrees with the household's.
 *
 * The prompt's *"different DOB → KYC CONFLICT"*. Reported per institution, so a
 * household can see **which** bank holds the wrong date rather than being told
 * that somewhere, something differs.
 *
 * @returns {FieldConflict[]}
 */
export function personConflicts(person, records) {
  if (!person) return [];
  const out = [];

  for (const record of records ?? []) {
    if (!record || record.deletedAt || record.person !== person.id) continue;

    for (const { field, held, own, label } of COMPARED) {
      const agreement = compareValue(field, person[own], record[held]);
      if (agreement === AGREEMENT.MATCH || agreement === AGREEMENT.UNKNOWN) continue;

      out.push({
        kind: KIND.FIELD,
        person: person.id,
        record: record.id,
        institution: plain(record.institution),
        field,
        label,
        agreement,
        // Both values, because the whole point is that a person decides which
        // is right — and neither this file nor the institution is presumed to
        // be the correct one.
        ours: plain(person[own]),
        theirs: plain(record[held]),
        severity: agreement === AGREEMENT.CONFLICT ? SEVERITY.HIGH : SEVERITY.NORMAL,
      });
    }
  }

  return out;
}

/**
 * Everything wrong with the household's identity records, worst first.
 *
 * @param {object[]} people
 * @param {object[]} records
 * @returns {Conflict[]}
 */
export function identityConflicts(people, records) {
  const shared = sharedIdentifiers(records);
  const perPerson = (people ?? []).flatMap((person) => personConflicts(person, records));

  const rank = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
  return [...shared, ...perPerson]
    .sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * A sentence for the screen. Never an instruction.
 *
 * Branches on `kind` rather than on severity — see the note on `KIND`.
 *
 * @param {Conflict|null} conflict
 * @param {(id: string) => string} [nameOf]
 */
export function describeConflict(conflict, nameOf = (id) => id) {
  if (!conflict) return null;

  if (conflict.kind === KIND.SHARED_IDENTIFIER) {
    return `${conflict.why} It is held against ${conflict.people.map(nameOf).join(' and ')}.`;
  }

  const strength = conflict.agreement === AGREEMENT.CONFLICT ? 'does not match' : 'may not match';
  const label = conflict.label.toLowerCase();
  // `a address` and `a email` were both on screen until this was measured.
  const article = /^[aeiou]/.test(label) ? 'an' : 'a';
  return `${conflict.institution} holds ${article} ${label} that `
    + `${strength} your own record: theirs is “${conflict.theirs}”, yours is `
    + `“${conflict.ours}”. Nothing here changes either.`;
}
