/**
 * Where the copies of one person's identity disagree.
 *
 * ## What this is
 *
 * A household's address changes once. Their bank, their broker, their insurer
 * and their mutual fund registrar find out at four different times, or never.
 * Nothing tells them which of the four is out of date, and every one of those
 * institutions believes its own copy.
 *
 * `kycRecord` is the household's note of what each institution holds. This
 * compares those notes against each other and against the person's own record,
 * and reports where they differ.
 *
 * ## What this is not
 *
 * **Anything to do with the Central KYC Records Registry.** Nothing here
 * contacts CKYCRR, no value comes from it, and none of this verifies anything.
 * A `kycRecord` is typed in by hand from a statement or a portal page, and its
 * `source` field says which. That is the whole provenance chain and it is
 * short on purpose.
 *
 * **A judgement about which copy is right.** It never is one: the household's
 * own record can be the stale one, and an institution can be holding an
 * address the household moved out of years ago and forgot to update. So every
 * difference is reported as a difference, named on both sides, and left for a
 * person to settle. Picking a winner here would silently pick wrong.
 *
 * ## Comparison is normalised, never corrected
 *
 * `12/A, 4th Cross` and `12/a 4th cross` are the same address written twice.
 * Comparing them raw would report a difference nobody can act on, and reporting
 * noise is how a list stops being read. So values are normalised — case,
 * punctuation and spacing — for the *comparison only*. Nothing is written back
 * and no record is altered.
 */

/** Fields on a KYC record, and where the household's own copy of each lives. */
const COMPARED = [
  { key: 'heldName', label: 'name', personKey: 'name', normalise: words },
  { key: 'heldAddress', label: 'address', personKey: 'address', normalise: words },
  { key: 'heldBirthday', label: 'date of birth', personKey: 'birthday', normalise: plain },
  { key: 'heldMobile', label: 'mobile', personKey: 'phone', normalise: digits },
  { key: 'heldEmail', label: 'email', personKey: 'email', normalise: lower },
  // No `personKey`: a PAN belongs to an identity document, not to the person
  // record, so it is compared institution-to-institution and against the
  // document rather than against a field that does not exist.
  { key: 'pan', label: 'PAN', personKey: null, normalise: upper },
];

function plain(value) { return String(value ?? '').trim(); }
function lower(value) { return plain(value).toLowerCase(); }
function upper(value) { return plain(value).toUpperCase().replace(/\s+/g, ''); }
function digits(value) { return plain(value).replace(/\D/g, '').slice(-10); }

/** Case, punctuation and spacing removed — enough to stop noise, no more. */
function words(value) {
  return plain(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * A CKYC identifier is usually fourteen digits.
 *
 * Reported as a note and **never** as a rejection. Two reasons, and the second
 * is the important one: a household copying a number off a letter should not
 * be blocked by this application's idea of a format, and a number that passes
 * the check is not thereby registered anywhere. Format is not existence, and a
 * validator that implied otherwise would be claiming a lookup that never ran.
 *
 * @returns {string} empty when there is nothing to say
 */
export function kinNote(kin) {
  const value = plain(kin).replace(/\s+/g, '');
  if (!value) return '';
  if (/^\d{14}$/.test(value)) return '';
  if (/\D/.test(value)) {
    return 'A CKYC identifier is usually fourteen digits, and this one has '
      + 'other characters in it. Worth checking against the letter or portal '
      + 'it came from — nothing here can confirm it either way.';
  }
  return `A CKYC identifier is usually fourteen digits, and this one has ${value.length}. `
    + 'Worth checking against the letter or portal it came from — nothing here '
    + 'can confirm it either way.';
}

/** The most recent record from each institution, which is what "held" means. */
export function latestPerInstitution(records) {
  const newest = new Map();

  for (const record of (records ?? []).filter((r) => !r.deletedAt)) {
    const key = words(record.institution);
    if (!key) continue;
    const held = newest.get(key);
    // Same day twice: the later-written record wins, which `updatedAt` knows
    // and a date alone does not.
    const beats = !held
      || String(record.recordedOn) > String(held.recordedOn)
      || (String(record.recordedOn) === String(held.recordedOn)
        && String(record.updatedAt ?? '') > String(held.updatedAt ?? ''));
    if (beats) newest.set(key, record);
  }

  return [...newest.values()];
}

/**
 * Every field where the institutions disagree with each other or with the
 * household's own record.
 *
 * @param {object} person
 * @param {object[]} records `kycRecord` rows for that person
 * @param {object[]} [identityDocuments] used only to compare a held PAN
 * @returns {Array<{field: string, label: string, values: Array<{who: string, value: string}>}>}
 */
export function kycDrift(person, records, identityDocuments = []) {
  if (!person) return [];

  const held = latestPerInstitution(records).filter((r) => r.person === person.id);
  if (!held.length) return [];

  const pan = (identityDocuments ?? [])
    .find((d) => !d.deletedAt && d.person === person.id && d.kind === 'PAN');

  const drift = [];

  for (const field of COMPARED) {
    const seen = [];

    // The household's own copy first, so it reads as the thing being compared
    // against — without being treated as the correct one.
    const ours = field.key === 'pan' ? pan?.number : person[field.personKey];
    if (plain(ours)) {
      seen.push({
        who: field.key === 'pan' ? 'your PAN record' : 'your own record',
        value: plain(ours),
        normal: field.normalise(ours),
      });
    }

    for (const record of held) {
      const value = record[field.key];
      if (!plain(value)) continue;
      seen.push({
        who: plain(record.institution),
        value: plain(value),
        normal: field.normalise(value),
      });
    }

    // One copy is not a disagreement, and neither is two that match.
    const distinct = new Set(seen.map((s) => s.normal));
    if (seen.length < 2 || distinct.size < 2) continue;

    drift.push({
      field: field.key,
      label: field.label,
      values: seen.map(({ who, value }) => ({ who, value })),
    });
  }

  return drift;
}

/**
 * Institutions that have not been checked in a long time.
 *
 * Not a problem in itself — an address that has not changed needs no update.
 * It is context for the drift above: a record from four years ago disagreeing
 * with one from last month is likelier to be the stale one, and saying so is
 * different from deciding it.
 *
 * @param {object[]} records
 * @param {string} asOf
 * @param {number} [months] how long counts as a long time
 */
export function stale(records, asOf, months = 24) {
  const cutoff = new Date(`${asOf}T00:00:00Z`);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const limit = cutoff.toISOString().slice(0, 10);

  return latestPerInstitution(records)
    .filter((record) => String(record.recordedOn) < limit)
    .sort((a, b) => String(a.recordedOn).localeCompare(String(b.recordedOn)));
}

/**
 * One field's disagreement, as a sentence.
 *
 * Names every side and picks none. The closing clause is not decoration: a
 * household reading this needs to know the application has no way of finding
 * out which copy is right, so that they go and ask rather than trusting a
 * screen that cannot know.
 */
export function describeDrift(entry) {
  if (!entry?.values?.length) return null;

  const parts = entry.values.map(({ who, value }) => `${who} has “${value}”`);
  const list = parts.length === 2
    ? parts.join(', while ')
    : `${parts.slice(0, -1).join('; ')}; and ${parts.at(-1)}`;

  return `The ${entry.label} is recorded differently in ${entry.values.length} places — `
    + `${list}. Nothing here can tell which is current: none of this came from `
    + 'the registry, only from what you were shown.';
}
