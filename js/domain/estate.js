/**
 * Nominations, and what a family would actually need — Phase 12.
 *
 * ## The claim this was written to test
 *
 * Two documents in this repository say the same thing, in the same words:
 *
 * > *most of them should be unread — a nominee needs no derivation*
 *
 * `docs/IMPLEMENTATION_ROADMAP.md` and `docs/FIELD_COVERAGE.md`, both listing
 * `account.nominee`, `holding.nominee` and `policy.nominee` among the fields
 * nothing reads and saying that is fine.
 *
 * It is not fine, and measuring it says so in one line. A household with three
 * accounts, two investments and two policies can be asked three questions, and
 * before this file the application could answer none of them:
 *
 *   - **Which of these have no nominee?**
 *   - **What is nominated to Meera?**
 *   - **Is "meera" the same person as "M Narayan"?**
 *
 * Every one of those is a derivation, and the nominee field is the input to all
 * three. A field being reference data on a form does not make it reference data
 * to the household.
 *
 * ## The thing this must never say
 *
 * **A nominee is not an heir.** A nomination says who an institution may pay;
 * it does not say who is entitled to keep the money. Who inherits is settled by
 * a will or by succession law, and the two answers routinely differ — a
 * nomination made at account opening twenty years ago against a will written
 * last year, for instance.
 *
 * So nothing here says "this goes to X". Every sentence says who is *nominated*,
 * and `NOMINEE_IS_NOT_HEIR` is on the screen rather than in this comment, the
 * same way `docs/KYC.md`'s registry refusal is. This application does not
 * adjudicate succession and must not look as though it does.
 *
 * ## What it refuses
 *
 * **It never resolves a nominee to a person.** `Meera Narayan`, `meera` and
 * `M Narayan` may be one person or three, and the household knows which. A
 * `POSSIBLE_MATCH` is offered and never applied — the same refusal, and
 * literally the same comparison, as `domain/kycconflict.js`.
 *
 * **It never ranks gaps by money.** An unnominated account becomes an
 * unclaimed deposit whatever its balance, and sorting the list by size would
 * tell a household that the small ones matter less. The total at stake is
 * reported separately, and so is the number of records whose value is not
 * known here — because an unknown amount is a gap, not a zero.
 */

import { compareValue, AGREEMENT } from './kycconflict.js';
import { ENVELOPE_PREFIX } from '../security/crypto.js';

/**
 * On screen, above everything else. Asserted by a test, so removing it fails
 * the suite rather than quietly changing what the application claims.
 */
export const NOMINEE_IS_NOT_HEIR =
  'A nominee is who an institution may pay, not who inherits. That is settled '
  + 'by a will or by succession law, and the two often differ. Nothing here '
  + 'decides who is entitled to anything.';

/**
 * The entities carrying a nominee, and where the value at stake is written.
 *
 * Three of thirty-six. That number is itself a finding — see `unnominable`.
 */
export const NOMINATED = Object.freeze([
  {
    collection: 'accounts', entity: 'account', label: 'Account',
    where: (row) => row.institution, amount: (row) => row.balance ?? null,
  },
  {
    collection: 'holdings', entity: 'holding', label: 'Investment',
    where: (row) => row.kind, amount: (row) => row.currentValue ?? row.invested ?? null,
  },
  {
    collection: 'policies', entity: 'policy', label: 'Policy',
    where: (row) => row.insurer, amount: (row) => row.sumAssured ?? null,
  },
]);

const plain = (value) => String(value ?? '').trim();
const live = (rows) => (rows ?? []).filter((row) => row && !row.deletedAt);

/**
 * A nominee that is still sealed.
 *
 * All three nominee fields are `encrypted: true`, and the dashboard's bulk
 * loader reads every entity with `decrypt: false` because nine widgets sharing
 * one pass is the whole point of it. A caller wiring this in there would get
 * ciphertext where a name should be — and the failure would be **silent in the
 * worst direction**: every record would look like it *had* a nominee, so the
 * gap list would be empty and a household would be told there was nothing to
 * fix.
 *
 * So a sealed value is neither a nominee nor a gap. It is counted as
 * unreadable and named as such, which is a bug report rather than a finding.
 */
const sealed = (value) => typeof value === 'string' && value.startsWith(ENVELOPE_PREFIX);

/** A holding or policy that has been closed is not a gap anybody can fix. */
const open = (row) => row.active !== false && row.archived !== true;

/**
 * Every record that carries a nominee, with who in the household it might be.
 *
 * The match is offered, never applied: `person` is set only on an exact
 * agreement, and a `POSSIBLE_MATCH` names the candidate while leaving `person`
 * null. Forcing it is how `Meera Narayan` and `M Narayan` silently become one
 * person who was never asked.
 */
export function nominations(data) {
  const people = live(data?.people ?? []);
  const out = [];

  for (const spec of NOMINATED) {
    for (const row of live(data?.[spec.collection] ?? []).filter(open)) {
      if (sealed(row.nominee)) continue;
      const nominee = plain(row.nominee);
      if (!nominee) continue;

      let person = null;
      const possible = [];
      for (const candidate of people) {
        const agreement = compareValue('name', nominee, candidate.name);
        if (agreement === AGREEMENT.MATCH) person = candidate.id;
        else if (agreement === AGREEMENT.POSSIBLE_MATCH) possible.push(candidate.id);
      }

      out.push({
        entity: spec.entity,
        label: spec.label,
        id: row.id,
        name: plain(row.name),
        where: plain(spec.where(row)),
        nominee,
        person,
        // Only when nothing matched outright. A near match beside a certain one
        // is noise, not a question.
        possible: person ? [] : possible,
        amount: spec.amount(row),
      });
    }
  }

  return out;
}

/**
 * Every record that could carry a nominee and does not.
 *
 * Deliberately unsorted by value — see the note at the top of this file.
 */
export function nominationGaps(data) {
  const out = [];

  for (const spec of NOMINATED) {
    for (const row of live(data?.[spec.collection] ?? []).filter(open)) {
      // A sealed nominee is not a missing one, and needs no check of its own
      // here: ciphertext is a non-empty string, so `plain` already excludes it.
      // The guard was written twice and mutation testing said so — the second
      // copy could not fail. `unreadable` is where a sealed value is counted.
      if (plain(row.nominee)) continue;
      const amount = spec.amount(row);
      out.push({
        entity: spec.entity,
        label: spec.label,
        id: row.id,
        name: plain(row.name),
        where: plain(spec.where(row)),
        amount: typeof amount === 'number' ? amount : null,
      });
    }
  }

  return out;
}

/**
 * The nominee names, grouped as written.
 *
 * Grouped on a normalised form so `Meera Narayan` and `meera narayan` are one
 * row, and **not** grouped across `meera` and `M Narayan`, which are a question
 * for the household. Each group says which people it might be.
 */
export function nomineeGroups(data) {
  const rows = nominations(data);
  const groups = new Map();

  for (const row of rows) {
    const key = row.nominee.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!groups.has(key)) {
      groups.set(key, {
        nominee: row.nominee, person: row.person, possible: row.possible, records: [],
      });
    }
    const group = groups.get(key);
    group.records.push(row);
    // A group is resolved if any spelling of it matched outright.
    if (!group.person && row.person) { group.person = row.person; group.possible = []; }
  }

  return [...groups.values()];
}

/**
 * What holds value here and carries no nominee field at all.
 *
 * The honest answer to *"what happens to the flat?"*: a nomination is not how a
 * property passes, and this application has no will, no executor and no
 * beneficiary. Saying so is the whole of what it can offer, and it beats a
 * screen that lists three nominated accounts and implies that is the estate.
 */
export function unnominable(data) {
  const out = [];
  const count = (collection) => live(data?.[collection] ?? []).length;

  const kinds = [
    { collection: 'properties', label: 'Property',
      why: 'a property passes by will or succession, not by nomination' },
    { collection: 'vehicles', label: 'Vehicle',
      why: 'transfer is a registration matter, and nothing here records one' },
    { collection: 'loans', label: 'Loan',
      why: 'a debt is not nominated — it is settled from the estate' },
    { collection: 'vaultItems', label: 'Vault item',
      why: 'credentials are not property, and nothing here should tell anybody to use them' },
  ];

  for (const kind of kinds) {
    const held = count(kind.collection);
    if (held) out.push({ ...kind, held });
  }

  return out;
}

/**
 * Digital assets and what was said to do with them.
 *
 * `digitalAsset.legacyInstruction` — the form calls it *"On my death, do this"*
 * — has been recorded since the schema was written and read by nothing. It is
 * the only free-text estate instruction in the application, so it is reported
 * as written and never interpreted.
 */
export function legacyInstructions(data) {
  const assets = live(data?.digitalAssets ?? []);
  return {
    recorded: assets
      .filter((row) => plain(row.legacyInstruction))
      .map((row) => ({ id: row.id, name: plain(row.name),
        instruction: plain(row.legacyInstruction) })),
    missing: assets
      .filter((row) => !plain(row.legacyInstruction))
      .map((row) => ({ id: row.id, name: plain(row.name) })),
  };
}

/**
 * Everything the estate screen draws.
 *
 * `atStake` is the total of the amounts that are **known**, and `valueUnknown`
 * counts the gaps whose value is not. Adding the two would be a figure that
 * claims to be a total and is not one.
 */
export function unreadable(data) {
  let count = 0;
  for (const spec of NOMINATED) {
    for (const row of live(data?.[spec.collection] ?? []).filter(open)) {
      if (sealed(row.nominee)) count += 1;
    }
  }
  return count;
}

export function estate(data) {
  const recorded = nominations(data);
  const gaps = nominationGaps(data);

  return {
    notice: NOMINEE_IS_NOT_HEIR,
    nominations: recorded,
    groups: nomineeGroups(data),
    gaps,
    atStake: gaps.reduce((total, gap) => total + (gap.amount ?? 0), 0),
    valueUnknown: gaps.filter((gap) => gap.amount === null).length,
    unresolved: recorded.filter((row) => !row.person).length,
    // Records this could not read at all — see `sealed` above. Never folded
    // into the counts, because "we could not look" is not "nothing is wrong".
    unreadable: unreadable(data),
    unnominable: unnominable(data),
    legacy: legacyInstructions(data),
  };
}

/** A sentence for the screen. Never an instruction, and never an inheritance. */
/**
 * The refusal that governs everything below, and it is not the same as
 * `NOMINEE_IS_NOT_HEIR`.
 *
 * That one says a nomination does not decide who inherits. This one says the
 * application does not know what the will says either — what is recorded is
 * the household's own note of it, and where the note and the instrument
 * disagree, **the instrument governs.** Nothing here is evidence of a bequest.
 */
export const A_NOTE_IS_NOT_THE_WILL =
  'These are your notes on what the will says, kept so a family can find the '
  + 'original and see it beside what each institution was told. The will '
  + 'itself decides, and nothing here is a substitute for reading it.';

/** A will that has been revoked or superseded decides nothing. */
export const inForce = (row) => row && !row.deletedAt && !row.revokedOn;

/**
 * Do two names refer to one person?
 *
 * `compareValue` from `domain/kycconflict.js` answers a different question and
 * is deliberately **not** used here. It exists to spot the same person recorded
 * differently across institutions, so it treats a shared surname as evidence:
 *
 *     compareValue('name', 'Meera Narayan', 'Ravi Narayan')  →  POSSIBLE_MATCH
 *
 * That is right for identity drift and ruinous here. Everyone in a household
 * shares a surname, so every genuine disagreement between two family members —
 * the case this whole comparison exists to catch — would come back as *unclear*
 * and the feature would report nothing worth acting on.
 *
 * The question here is narrower: a difference in the **given** name is
 * decisive. Meera and Ravi are not the same person. What stays unclear is an
 * abbreviation — an initial standing for a first name, or a first name with no
 * surname beside a full one — because those really are the same person written
 * two ways.
 */
export const NAMES = Object.freeze({
  SAME: 'same',
  ABBREVIATED: 'abbreviated',
  DIFFERENT: 'different',
});

const tokens = (value) => plain(value).toLowerCase()
  .replace(/[.,]/g, ' ')
  .split(/\s+/)
  .filter(Boolean);

export function namesAgree(a, b) {
  const left = tokens(a);
  const right = tokens(b);
  if (!left.length || !right.length) return NAMES.DIFFERENT;
  if (left.join(' ') === right.join(' ')) return NAMES.SAME;

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];

  // "Ravi" against "Ravi Narayan": the same given name, one without a surname.
  if (shorter.length === 1) {
    return shorter[0] === longer[0] || shorter[0] === longer[longer.length - 1]
      ? NAMES.ABBREVIATED
      : NAMES.DIFFERENT;
  }

  // Surnames must agree at all. "Meera Narayan" and "Meera Iyer" are two
  // people, whatever they share at the front.
  if (shorter[shorter.length - 1] !== longer[longer.length - 1]) return NAMES.DIFFERENT;

  // Then the given name decides. An initial standing for it is an
  // abbreviation; a different name is a different person.
  const [givenA] = shorter;
  const [givenB] = longer;
  if (givenA === givenB) return NAMES.ABBREVIATED;
  if (givenA.length === 1 && givenB.startsWith(givenA)) return NAMES.ABBREVIATED;
  if (givenB.length === 1 && givenA.startsWith(givenB)) return NAMES.ABBREVIATED;
  return NAMES.DIFFERENT;
}

/**
 * More than one will in force for the same person.
 *
 * Ordinary and worth saying: a household keeps the 2015 will in the bank
 * locker, writes a new one in 2026, and never marks the first revoked. Both
 * sit here in force, and every bequest in both is compared against the
 * nominations as though it still stood.
 *
 * **This does not decide which governs.** A later will usually supersedes an
 * earlier one, and there are enough exceptions — a codicil, a will covering
 * different property, one that was never validly executed — that a rule here
 * would be this file practising law. It reports that more than one exists,
 * newest first, and says the household should settle it.
 *
 * A will with no execution date is listed last and marked, because "which is
 * later" cannot be answered for it at all.
 */
export function willsInConflict(data) {
  const byTestator = new Map();
  for (const row of live(data?.wills ?? []).filter(inForce)) {
    const key = plain(row.testator);
    if (!key) continue;
    if (!byTestator.has(key)) byTestator.set(key, []);
    byTestator.get(key).push(row);
  }

  const out = [];
  for (const [testator, wills] of byTestator) {
    if (wills.length < 2) continue;
    const dated = wills.filter((w) => plain(w.executedOn));
    const undated = wills.filter((w) => !plain(w.executedOn));
    dated.sort((a, b) => (a.executedOn < b.executedOn ? 1 : -1));
    out.push({
      testator,
      wills: [...dated, ...undated].map((w) => ({
        id: w.id,
        title: plain(w.title),
        executedOn: plain(w.executedOn) || null,
        whereKept: plain(w.whereKept) || null,
        executor: plain(w.executor) || null,
      })),
      undated: undated.length,
    });
  }
  return out;
}

/**
 * Legal documents that have not been superseded.
 *
 * A power of attorney replaced three years ago is a record worth keeping and a
 * terrible thing to act on. `supersededOn` is why the field exists, and reading
 * it here is what stops the list being a pile of everything ever signed.
 */
export function currentLegalDocuments(data) {
  return live(data?.legalDocuments ?? []).filter((row) => !plain(row.supersededOn));
}

/**
 * Where a nomination and a bequest name different people.
 *
 * This is the concrete form of the principle this file already asserts. A
 * nomination made at account opening twenty years ago against a will written
 * last year is the textbook case, and until there was somewhere to record what
 * the will says, the application could state the principle and check nothing.
 *
 * **Neither side is declared correct.** A nomination decides who the
 * institution may pay; a will decides who is entitled to keep it; and which
 * matters depends on the asset, the statute and facts this application does not
 * have. So a disagreement is reported with both names and no verdict.
 *
 * Beneficiaries of a revoked will are skipped. A superseded instruction is not
 * a disagreement with the current one — it is a decision already replaced, and
 * reporting it would send a household to argue about a will that no longer
 * operates.
 */
export function bequestConflicts(data) {
  const wills = new Map(live(data?.wills ?? []).filter(inForce).map((w) => [w.id, w]));
  const nominated = nominations(data);
  const byRecord = new Map(nominated.map((row) => [row.id, row]));
  const out = [];

  for (const row of live(data?.beneficiaries ?? [])) {
    const will = wills.get(row.will);
    if (!will) continue;
    if (!row.assetId) continue;

    const nomination = byRecord.get(row.assetId);
    if (!nomination) continue;

    const bequest = plain(row.name);
    if (!bequest) continue;

    const agreement = namesAgree(nomination.nominee, bequest);
    if (agreement === NAMES.SAME) continue;

    out.push({
      entity: nomination.entity,
      label: nomination.label,
      id: nomination.id,
      name: nomination.name,
      where: nomination.where,
      nominee: nomination.nominee,
      beneficiary: bequest,
      share: plain(row.share) || null,
      will: will.id,
      willTitle: plain(will.title),
      // An abbreviation is reported as *unclear* rather than as a
      // disagreement. "M Narayan" against "Meera Narayan" is a spelling
      // question, and calling it a conflict would send a household to a
      // solicitor over an initial.
      unclear: agreement === NAMES.ABBREVIATED,
    });
  }

  return out;
}

/**
 * Assets a will speaks to that carry no nominee, and the reverse.
 *
 * Reported as two lists rather than one score. "The will covers this and the
 * bank was never told" and "the bank was told and the will is silent" are
 * different situations needing different actions, and merging them would lose
 * which one a household is looking at.
 */
export function willCoverage(data) {
  const wills = new Map(live(data?.wills ?? []).filter(inForce).map((w) => [w.id, w]));
  const beneficiaries = live(data?.beneficiaries ?? []).filter((row) => wills.has(row.will));
  const spokenFor = new Set(beneficiaries.map((row) => row.assetId).filter(Boolean));

  const nominated = nominations(data);
  const gaps = nominationGaps(data);

  return {
    /** The will names them; no nominee is recorded with the institution. */
    willOnly: gaps.filter((row) => spokenFor.has(row.id)),
    /** A nominee is recorded; no will in force mentions the asset. */
    nomineeOnly: nominated.filter((row) => !spokenFor.has(row.id)),
    /** Beneficiaries naming no record here — recorded, not matched. */
    unmatched: beneficiaries.filter((row) => !row.assetId).length,
    wills: wills.size,
  };
}

export function describeNomination(row, nameOf = (id) => id) {
  if (!row) return null;

  const what = row.where ? `${row.name} (${row.where})` : row.name;
  if (row.person) return `${what} is nominated to ${nameOf(row.person)}.`;

  if (row.possible.length) {
    const who = row.possible.map(nameOf).join(' or ');
    return `${what} is nominated to “${row.nominee}”, which may be ${who}. `
      + 'Nothing here decides that.';
  }

  return `${what} is nominated to “${row.nominee}”, who is not somebody `
    + 'recorded in this household.';
}

/** A gap, said without a number the application does not have. */
export function describeGap(row) {
  if (!row) return null;
  const what = row.where ? `${row.name} (${row.where})` : row.name;
  return row.amount === null
    ? `${what} has no nominee recorded, and its value is not recorded here either.`
    : `${what} has no nominee recorded.`;
}
