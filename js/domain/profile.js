/**
 * How much of a person's record has actually been filled in.
 *
 * The prompt asks for an "Individual Completion %" and a "Family Completion %"
 * over configurable sections. A percentage is the easy part; making one that
 * does not lie is the whole job, and there are two ways this number goes bad.
 *
 * ## A percentage nobody can reach is a percentage nobody reads
 *
 * The obvious rule — count the sections that have a record — punishes people
 * for facts about their lives. Somebody who owns no car and rents their home
 * is missing Vehicles and Property permanently. No amount of typing fixes it,
 * the number sits below eighty forever, and within a week it is furniture.
 *
 * So a section can be marked **not applicable**, and the percentage is over
 * the sections that apply. "No vehicles, and that is correct" is a complete
 * answer to Vehicles, and it is a different state from "nobody has looked".
 *
 * ## A percentage without its reasons is a scold
 *
 * Rule 57 — every figure must be explainable — applies to this one too. So
 * `completion` returns the sections behind the number, each with what it is
 * waiting for, and the screen shows those rather than the bare figure.
 *
 * ## What it deliberately does not do
 *
 * **It does not weight sections.** Deciding that Identity is worth three times
 * Notes would be this file inventing a household's priorities. Every applicable
 * section counts once, and the list is right there to be read.
 *
 * **It does not treat an encrypted field as missing.** A sealed value that is
 * present is present; reading it to check is neither necessary nor allowed.
 */

import { entityNames, entity } from '../data/schema.js';

/**
 * The sections of a profile, in the order the prompt lists them.
 *
 * `fields` sections are answered by the person record itself. `entity`
 * sections are answered by whether any record of that entity names the person
 * — which is why the section list is checked against the schema below rather
 * than trusted: an entity renamed in the schema and not here would be a
 * section that can never be filled, and nothing would say so.
 */
export const SECTIONS = Object.freeze([
  { id: 'basics', label: 'Basics', fields: ['name', 'birthday', 'gender', 'photo'] },
  { id: 'contact', label: 'Contact', fields: ['email', 'phone', 'address'] },
  { id: 'identity', label: 'Identity', entities: ['identityDocument'] },
  { id: 'kyc', label: 'KYC', entities: ['kycRecord'] },
  { id: 'documents', label: 'Documents', entities: ['document'] },
  { id: 'accounts', label: 'Bank accounts', entities: ['account'] },
  { id: 'loans', label: 'Loans', entities: ['loan'] },
  { id: 'investments', label: 'Investments', entities: ['holding'] },
  { id: 'insurance', label: 'Insurance', entities: ['policy'] },
  { id: 'health', label: 'Health', entities: ['healthRecord', 'medication', 'vaccination'] },
  { id: 'vehicles', label: 'Vehicles', entities: ['vehicle'] },
  { id: 'property', label: 'Property', entities: ['property'] },
  { id: 'education', label: 'Education', entities: ['education', 'certificate'] },
  { id: 'employment', label: 'Employment', entities: ['employment'] },
  { id: 'digital', label: 'Digital life', entities: ['digitalAsset'] },
  { id: 'emergency', label: 'Emergency', fields: ['emergencyContactName', 'emergencyContactPhone', 'bloodGroup'] },
]);

/**
 * Every section names something the schema has.
 *
 * Exported so a test can assert it, because the failure it prevents is silent:
 * a section pointing at an entity that no longer exists would report itself
 * empty forever, and a household would be told to fill in something that has
 * nowhere to go.
 *
 * It takes the list rather than closing over `SECTIONS` so that a test can
 * hand it a deliberately broken one. Asserting only that today's list is
 * clean would pass just as well against a function that returned nothing at
 * all, which is a check that cannot fail.
 */
export function unknownReferences(sections = SECTIONS) {
  const known = new Set(entityNames());
  const personFields = new Set(entity('person').fields.map((f) => f.key));
  const wrong = [];
  for (const section of sections) {
    for (const name of section.entities ?? []) {
      if (!known.has(name)) wrong.push(`${section.id} → entity ${name}`);
    }
    for (const key of section.fields ?? []) {
      if (!personFields.has(key)) wrong.push(`${section.id} → person.${key}`);
    }
  }
  return wrong;
}

/**
 * Every entity a section asks about, once.
 *
 * The screen loads these; nothing here does I/O.
 */
export function sectionEntities() {
  return [...new Set(SECTIONS.flatMap((s) => s.entities ?? []))];
}

/**
 * Which field on an entity names the person it belongs to.
 *
 * Derived from the schema rather than written out here, because a second copy
 * of that mapping is the exact fault this project has already found twice —
 * `modules[].entities` written beside `entity.module`, and a store walk that
 * named four of seven stores.
 *
 * An entity with more than one reference to a person is refused rather than
 * guessed at: `relationship` has `fromPerson` and `toPerson`, and picking one
 * would be this function deciding whose relationship it is.
 */
export function personKey(entityName, entityDef = entity(entityName)) {
  const refs = entityDef.fields.filter((f) => f.type === 'ref' && f.ref === 'person');
  if (refs.length !== 1) return null;
  return refs[0].key;
}

/**
 * The sections that ask about any of these entities.
 *
 * Used to dismiss the sections a reader has no permission to see. A section
 * that mixes readable and unreadable entities is *not* dismissed — Health asks
 * about three, and losing one of them is not a reason to stop asking about the
 * other two.
 */
export function sectionsCovering(entityNames = []) {
  const wanted = new Set(entityNames);
  return SECTIONS
    .filter((s) => s.entities?.length && s.entities.every((n) => wanted.has(n)))
    .map((s) => s.id);
}

/** A value counts as given when somebody typed something into it. */
function filled(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const APPLIES = Object.freeze({
  /** Something is recorded here. */
  RECORDED: 'recorded',
  /** Applicable and empty — this is what the number is asking for. */
  EMPTY: 'empty',
  /** Said not to apply. Counted out of the total rather than against it. */
  NOT_APPLICABLE: 'not applicable',
});

export { APPLIES };

/**
 * One person's completion.
 *
 * `counts` maps an entity name to how many of its records name this person.
 * The caller does that query; this function does no I/O, so it can be tested
 * against any shape of household without a database.
 *
 * `notApplicable` is the set of section ids this person has said do not apply.
 */
export function completion(person, counts = {}, { notApplicable = [] } = {}) {
  const dismissed = new Set(notApplicable);
  const sections = SECTIONS.map((section) => {
    if (dismissed.has(section.id)) {
      return { id: section.id, label: section.label, state: APPLIES.NOT_APPLICABLE, missing: [] };
    }

    if (section.fields) {
      const missing = section.fields.filter((key) => !filled(person?.[key]));
      return {
        id: section.id,
        label: section.label,
        state: missing.length === section.fields.length ? APPLIES.EMPTY : APPLIES.RECORDED,
        missing,
        // A part-filled section still counts as recorded; the missing keys are
        // what the screen shows. Counting it as empty would make a person with
        // a name and no photo indistinguishable from one with nothing at all.
        partial: missing.length > 0 && missing.length < section.fields.length,
      };
    }

    const found = section.entities.reduce((total, name) => total + (counts[name] ?? 0), 0);
    return {
      id: section.id,
      label: section.label,
      state: found > 0 ? APPLIES.RECORDED : APPLIES.EMPTY,
      missing: found > 0 ? [] : section.entities.slice(),
      partial: false,
    };
  });

  const applicable = sections.filter((s) => s.state !== APPLIES.NOT_APPLICABLE);
  const recorded = applicable.filter((s) => s.state === APPLIES.RECORDED);

  return {
    percent: applicable.length === 0 ? null : Math.round((recorded.length / applicable.length) * 100),
    recorded: recorded.length,
    applicable: applicable.length,
    dismissed: sections.length - applicable.length,
    sections,
    /** Applicable, empty, and therefore what the percentage is short of. */
    waitingOn: applicable.filter((s) => s.state === APPLIES.EMPTY).map((s) => s.label),
  };
}

/**
 * The household's figure.
 *
 * The mean of the members' percentages, not the ratio of all recorded sections
 * to all applicable ones.
 *
 * The ratio weights a person by how many sections apply to them, so somebody
 * with a car, a house and a loan counts for more of the household's figure
 * than somebody who rents — which is a statement about their assets, not
 * about how well either record is filled in. On a household of three full
 * profiles and one bare one the two rules give 75% and 69%; the gap is not
 * the point, the reason for it is.
 *
 * A person with no applicable sections at all — everything dismissed — has no
 * percentage, and is left out of the mean rather than counted as zero or as a
 * hundred. Both would be inventing an answer.
 */
export function familyCompletion(perPerson = []) {
  const scored = perPerson.filter((p) => typeof p?.percent === 'number');
  if (!scored.length) return { percent: null, people: perPerson.length, scored: 0 };
  const total = scored.reduce((sum, p) => sum + p.percent, 0);
  return {
    percent: Math.round(total / scored.length),
    people: perPerson.length,
    scored: scored.length,
    lowest: scored.reduce((low, p) => (p.percent < low.percent ? p : low)),
  };
}

/**
 * How many sections to name before counting the rest.
 *
 * Three, which is what `js/domain/timeline.js` settled on for the same
 * problem — *"a list of eleven field names is a list nobody reads, and the
 * count is the part that says a lot happened"*. This joined **every** section
 * it was waiting on, and on the Identity screen, where a row is drawn per
 * person, that put ten comma-separated names into one subtitle and wrapped it
 * over four lines:
 *
 *     6 of 16 sections · waiting on Identity, KYC, Documents, Loans,
 *     Investments, Insurance, Vehicles, Property, Employment, Digital life
 *
 * Naming them is still the point — `js/modules/profile.js` says so, and a
 * test holds it — so the fix is to name fewer, not to stop naming.
 */
const NAMED = 3;

/** The sentence under the number. */
export function describeCompletion(result) {
  if (result.percent === null) return 'Nothing applies to this person yet.';
  const parts = [`${result.recorded} of ${result.applicable} sections`];
  if (result.dismissed) parts.push(`${result.dismissed} marked not applicable`);
  if (result.waitingOn.length) {
    // The remainder comes off the full list, not off what was drawn — the
    // mistake `js/modules/dashboard.js` had made with a badge.
    const named = result.waitingOn.slice(0, NAMED);
    const rest = result.waitingOn.length - named.length;
    parts.push(`waiting on ${named.join(', ')}${rest ? ` and ${rest} more` : ''}`);
  }
  return parts.join(' · ');
}
