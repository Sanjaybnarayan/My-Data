/**
 * An example household: six invented people and the records around them.
 *
 * ## Why this exists, and what it is not
 *
 * The application is empty until a household types their life into it, and an
 * empty application cannot be judged — a screen with no records looks the same
 * whether it works or not. This is a family to look at while deciding whether
 * the thing is any good.
 *
 * It is **not** a fabricated integration, and that distinction is the whole
 * licence for this file. Nothing here connects to a bank, a broker, a
 * government register or a Google account; nothing here produces an API
 * response; nothing claims to have been fetched from anywhere. These are
 * records of the kind a person types in, written through the same repository,
 * the same validation, the same encryption and the same audit chain as records
 * a person does type in. The one thing that would make this dishonest —
 * inventing a *connection* or a *derived figure* and presenting it as real —
 * is the one thing it does not do.
 *
 * ## The rules it is held to
 *
 *   - **It is refused on a household that has people in it.** Invented records
 *     mixed into real ones cannot be separated again by hand, and the brief's
 *     first rule is that existing data stays usable. `services/example.js`
 *     enforces this; `tests/example.test.mjs` holds it.
 *   - **Every record says so.** `notes` carries the sentence on each one, so a
 *     row read in a list, in an export or on a shared screen carries its own
 *     provenance rather than depending on the reader remembering.
 *   - **It comes out again.** The ids written are recorded together, so
 *     removal is derived from what was written rather than from a guess about
 *     what looks invented.
 *
 * ## The identifiers
 *
 * Every number here is built to be **structurally impossible** as the real
 * thing, which is a stronger guarantee than being merely unused:
 *
 *   - **PAN** uses the `ZZZ` series, which is not issued.
 *   - **Passport** uses `Z`, which is not a regular Indian passport series.
 *   - **Driving licence** uses RTO code `KA00`, which does not exist.
 *   - **Voter ID** uses the `ZZZ` series, likewise not issued.
 *
 * ## There is no Aadhaar here, and that is deliberate
 *
 * The example household has **no Aadhaar numbers**, and it is the one identity
 * document it does not carry.
 *
 * Every other identifier above has an unissued series to hide in. Aadhaar has
 * none. `data/formats.js` enforces the real rule — a leading digit of 2 to 9
 * and a valid Verhoeff check digit — so the set of numbers this application
 * will accept *is* the set of numbers UIDAI can issue. About 1.4 billion of
 * roughly 8 x 10^10 valid numbers have been issued, so each invented one has
 * near enough a one in fifty chance of already belonging to somebody, and six
 * of them carry about a one in ten chance that one of these is a living
 * person's Aadhaar, written into a repository, in a file that says it is fake.
 *
 * Weakening the validator to admit a safe number would be worse: it would make
 * the application accept a mistyped Aadhaar from a real household, to make a
 * demonstration tidier.
 *
 * So the demonstration is uneven here, and that is honest rather than a gap.
 * A household whose Aadhaar is not on file is an ordinary household, and the
 * screens that ask for one have something real to show.
 *
 * The account, policy and chassis numbers are invented but carry no format
 * anybody validates, so they are simply fictional. All of them are stored in
 * encrypted fields and shown masked, exactly as a real one would be.
 */

import { exampleStrings } from '../locale/en-example.js';
import { entity } from '../data/schema.js';

/**
 * An enum option, quoted from the schema rather than retyped here.
 *
 * `'parent of'` written in this file would be a second copy of a list
 * `js/data/schema.js` already holds — the shape of drift this repository has
 * found more times than any other — and it would be a copy that fails
 * *silently*, because an unknown enum value is a validation error at write
 * time and this file is only exercised when somebody loads the example.
 *
 * The key is the option with its spaces hyphenated, so nothing here carries
 * the option's English. A schema that renames an option makes this throw by
 * name, which is the loud failure the copy would not have given.
 */
function option(entityName, field, key) {
  const options = entity(entityName)?.fieldMap?.[field]?.options ?? [];
  const found = options.find((o) => o.replace(/\s+/g, '-').toLowerCase() === key);
  // The identifier, not a sentence: what a developer needs is which option
  // went missing, and a sentence around it would be user-facing English in a
  // file whose English all belongs in the catalogue.
  if (!found) throw new Error(`no-such-option:${entityName}.${field}:${key}`);
  return found;
}

/**
 * Text for the example household, read straight from its own catalogue.
 *
 * Not `t()`, and `js/locale/en-example.js` says why at length: these keys are
 * deliberately outside the UI catalogue, because counting a demonstration
 * family's names as translated interface moves a measurement of how much of
 * the interface is translated.
 */
function text(key) {
  const found = exampleStrings[key];
  if (found === undefined) throw new Error(`no-such-example-string:${key}`);
  return found;
}

const relation = (key) => option('relationship', 'type', key);
const idKind = (key) => option('identityDocument', 'kind', key);

/** The meta key under which the written ids are kept, so they can come out. */
export const META_KEY = 'example.household';

/** Keys used to join the records below before any of them have real ids. */
export const PEOPLE_KEYS = ['ramesh', 'lakshmi', 'anand', 'priya', 'vikram', 'ananya'];

const note = () => text('example.note');

/**
 * The six people.
 *
 * `relationship` is stated from the household's own person outward, which is
 * what the schema's enum means: Anand is `self`, so his parents are `father`
 * and `mother` rather than `grandfather` and `grandmother`. The grandparent
 * relation to the children is carried in `relationships` below, where it
 * belongs — a person row cannot hold two relationships at once, and writing
 * `grandfather` here would have made the tree disagree with itself.
 */
export function people() {
  return [
    {
      key: 'ramesh',
      name: text('example.person.ramesh'),
      role: 'adult',
      relationship: 'father',
      birthday: '1948-06-14',
      gender: 'male',
      bloodGroup: 'B+',
      occupation: text('example.occupation.retired'),
      isDependent: true,
      address: text('example.address'),
      chronicConditions: '',
      notes: note(),
    },
    {
      key: 'lakshmi',
      name: text('example.person.lakshmi'),
      role: 'adult',
      relationship: 'mother',
      birthday: '1952-11-02',
      gender: 'female',
      bloodGroup: 'O+',
      occupation: text('example.occupation.homemaker'),
      isDependent: true,
      address: text('example.address'),
      notes: note(),
    },
    {
      key: 'anand',
      name: text('example.person.anand'),
      role: 'owner',
      relationship: 'self',
      birthday: '1978-03-21',
      gender: 'male',
      bloodGroup: 'O+',
      occupation: text('example.occupation.engineer'),
      employer: text('example.employer.tech'),
      isDependent: false,
      address: text('example.address'),
      notes: note(),
    },
    {
      key: 'priya',
      name: text('example.person.priya'),
      role: 'spouse',
      relationship: 'spouse',
      birthday: '1981-09-08',
      gender: 'female',
      bloodGroup: 'A+',
      occupation: text('example.occupation.teacher'),
      employer: text('example.employer.school'),
      isDependent: false,
      address: text('example.address'),
      notes: note(),
    },
    {
      key: 'vikram',
      name: text('example.person.vikram'),
      role: 'child',
      relationship: 'son',
      birthday: '2011-01-17',
      gender: 'male',
      bloodGroup: 'O+',
      occupation: text('example.occupation.student'),
      isDependent: true,
      address: text('example.address'),
      notes: note(),
    },
    {
      key: 'ananya',
      name: text('example.person.ananya'),
      role: 'child',
      relationship: 'daughter',
      birthday: '2014-07-25',
      gender: 'female',
      bloodGroup: 'A+',
      occupation: text('example.occupation.student'),
      isDependent: true,
      address: text('example.address'),
      notes: note(),
    },
  ];
}

/**
 * The tree, stated once in each direction the schema offers.
 *
 * Only the relations that are not derivable are written: `parent of` and
 * `spouse of` and `sibling of` and `grandparent of`. The inverses (`child of`,
 * `grandchild of`) are not written, because `domain/tree.js` reads a relation
 * from either end and a second row saying the same thing backwards is a copy
 * that can disagree with its original.
 */
export function relationships() {
  return [
    { fromPerson: 'ramesh', type: relation('spouse-of'), toPerson: 'lakshmi' },
    { fromPerson: 'anand', type: relation('spouse-of'), toPerson: 'priya' },

    { fromPerson: 'ramesh', type: relation('parent-of'), toPerson: 'anand' },
    { fromPerson: 'lakshmi', type: relation('parent-of'), toPerson: 'anand' },
    { fromPerson: 'anand', type: relation('parent-of'), toPerson: 'vikram' },
    { fromPerson: 'anand', type: relation('parent-of'), toPerson: 'ananya' },
    { fromPerson: 'priya', type: relation('parent-of'), toPerson: 'vikram' },
    { fromPerson: 'priya', type: relation('parent-of'), toPerson: 'ananya' },

    { fromPerson: 'ramesh', type: relation('grandparent-of'), toPerson: 'vikram' },
    { fromPerson: 'ramesh', type: relation('grandparent-of'), toPerson: 'ananya' },
    { fromPerson: 'lakshmi', type: relation('grandparent-of'), toPerson: 'vikram' },
    { fromPerson: 'lakshmi', type: relation('grandparent-of'), toPerson: 'ananya' },

    { fromPerson: 'vikram', type: relation('sibling-of'), toPerson: 'ananya' },
  ].map((row) => ({ ...row, notes: note() }));
}

/**
 * Two savings accounts for each of the six, which is twelve.
 *
 * Balances are in **paise**, as everything in this application is. They are
 * openingBalance figures and nothing else: no transactions are written, so no
 * screen here will claim a trend, a category or a reconciliation that was
 * never derived from anything.
 */
export function accounts() {
  const rows = [
    ['ramesh', 'sapphire', 'SPHB0000411', '4110029773641', 8_42_500_00],
    ['ramesh', 'kaveri', 'KVRG0000228', '2280071144092', 1_16_400_00],
    ['lakshmi', 'sapphire', 'SPHB0000411', '4110038820517', 3_74_900_00],
    ['lakshmi', 'deccan', 'DCCB0000173', '1730044596218', 62_300_00],
    ['anand', 'harbour', 'HRBN0000902', '9020116473358', 11_08_600_00],
    ['anand', 'sapphire', 'SPHB0000411', '4110052237704', 2_95_100_00],
    ['priya', 'harbour', 'HRBN0000902', '9020127590163', 6_31_750_00],
    ['priya', 'deccan', 'DCCB0000173', '1730058812470', 1_48_200_00],
    ['vikram', 'sapphire', 'SPHB0000411', '4110066903285', 41_800_00],
    ['vikram', 'kaveri', 'KVRG0000228', '2280089337516', 12_650_00],
    ['ananya', 'sapphire', 'SPHB0000411', '4110073318849', 38_950_00],
    ['ananya', 'kaveri', 'KVRG0000228', '2280094460731', 9_400_00],
  ];

  return rows.map(([holder, bank, ifsc, accountNumber, openingBalance], i) => ({
    key: `account-${i}`,
    name: `${text(`example.bank.${bank}`)} savings`,
    kind: 'savings',
    institution: text(`example.bank.${bank}`),
    accountNumber,
    ifsc,
    holder,
    openingBalance,
    includeInNetWorth: true,
    archived: false,
    notes: note(),
  }));
}

/** Two cars. */
export function vehicles() {
  return [
    {
      key: 'estate',
      registration: 'KA03MJ4417',
      make: text('example.make.estate'),
      model: 'Ertiga',
      kind: 'car',
      year: 2019,
      fuel: 'petrol',
      owner: 'anand',
      chassisNumber: 'MA0EX00000EX00417',
      engineNumber: 'K15BX0000417',
      registeredOn: '2019-08-12',
      rcExpiresOn: '2034-08-11',
      purchasePrice: 9_84_000_00,
      purchasedOn: '2019-08-10',
      currentValue: 5_60_000_00,
      insuranceExpiresOn: '2027-08-09',
      pucExpiresOn: '2026-11-30',
      odometer: 78_400,
      notes: note(),
    },
    {
      key: 'hatchback',
      registration: 'KA51NH8802',
      make: text('example.make.hatchback'),
      model: 'i20',
      kind: 'car',
      year: 2022,
      fuel: 'petrol',
      owner: 'priya',
      chassisNumber: 'MALBX00000BX08802',
      engineNumber: 'G4LAX0008802',
      registeredOn: '2022-02-26',
      rcExpiresOn: '2037-02-25',
      purchasePrice: 8_47_000_00,
      purchasedOn: '2022-02-24',
      currentValue: 6_20_000_00,
      insuranceExpiresOn: '2027-02-23',
      pucExpiresOn: '2026-10-15',
      odometer: 31_250,
      notes: note(),
    },
  ];
}

/**
 * Four policies: two health, two motor.
 *
 * The floater names all six as `insured` and Anand as `holder`, which is the
 * distinction the schema draws and the one that matters at claim time. The
 * senior top-up covers the grandparents only, which is why it exists — a
 * floater and a top-up are two records because they are two policies, not one
 * policy with a note about the parents.
 */
export function policies() {
  return [
    {
      key: 'floater',
      name: text('example.policy.floater'),
      kind: 'health',
      insurer: text('example.insurer.health'),
      policyNumber: 'AGI/HLT/0000/4471902',
      holder: 'anand',
      insured: ['ramesh', 'lakshmi', 'anand', 'priya', 'vikram', 'ananya'],
      sumAssured: 15_00_000_00,
      premium: 42_600_00,
      premiumFrequency: 'yearly',
      startedOn: '2021-04-01',
      renewsOn: '2027-03-31',
      tpaHelpline: '1800 000 0000',
      notes: note(),
    },
    {
      key: 'senior',
      name: text('example.policy.senior'),
      kind: 'health',
      insurer: text('example.insurer.health'),
      policyNumber: 'AGI/SRC/0000/4471915',
      holder: 'anand',
      insured: ['ramesh', 'lakshmi'],
      sumAssured: 10_00_000_00,
      premium: 38_900_00,
      premiumFrequency: 'yearly',
      startedOn: '2023-04-01',
      renewsOn: '2027-03-31',
      tpaHelpline: '1800 000 0000',
      notes: note(),
    },
    {
      key: 'motor-estate',
      name: text('example.policy.motorErtiga'),
      kind: 'vehicle',
      insurer: text('example.insurer.motor'),
      policyNumber: 'PMI/MOT/0000/2288417',
      holder: 'anand',
      insured: ['anand'],
      vehicle: 'estate',
      sumAssured: 5_60_000_00,
      premium: 18_450_00,
      premiumFrequency: 'yearly',
      startedOn: '2019-08-10',
      renewsOn: '2027-08-09',
      notes: note(),
    },
    {
      key: 'motor-hatchback',
      name: text('example.policy.motorHatch'),
      kind: 'vehicle',
      insurer: text('example.insurer.motor'),
      policyNumber: 'PMI/MOT/0000/2288802',
      holder: 'priya',
      insured: ['priya'],
      vehicle: 'hatchback',
      sumAssured: 6_20_000_00,
      premium: 15_780_00,
      premiumFrequency: 'yearly',
      startedOn: '2022-02-24',
      renewsOn: '2027-02-23',
      notes: note(),
    },
  ];
}

/**
 * The identity documents. See the header for why each number cannot be real.
 *
 * PAN, Voter ID and Passport for the four adults; no Aadhaar for anybody, for
 * the reason set out in the header. Driving licences for the three who drive — Lakshmi has
 * none, which is not an omission but the point: a household's records are
 * uneven, and a demonstration where everybody has everything teaches a screen
 * nothing about the gap it is supposed to show.
 */
export function identityDocuments() {
  // No Aadhaar. The header says why, at length, because it is the one
  // omission here that looks like carelessness and is not.
  const rows = [
    ['ramesh', idKind('pan'), 'ZZZPR0001A', '', ''],
    ['lakshmi', idKind('pan'), 'ZZZPL0002B', '', ''],
    ['anand', idKind('pan'), 'ZZZPA0003C', '', ''],
    ['priya', idKind('pan'), 'ZZZPP0004D', '', ''],

    ['ramesh', idKind('voter-id'), 'ZZZ0000011', '', ''],
    ['lakshmi', idKind('voter-id'), 'ZZZ0000012', '', ''],
    ['anand', idKind('voter-id'), 'ZZZ0000013', '', ''],
    ['priya', idKind('voter-id'), 'ZZZ0000014', '', ''],

    ['ramesh', idKind('passport'), 'Z0000021', '2019-05-14', '2029-05-13'],
    ['lakshmi', idKind('passport'), 'Z0000022', '2019-05-14', '2029-05-13'],
    ['anand', idKind('passport'), 'Z0000023', '2021-11-08', '2031-11-07'],
    ['priya', idKind('passport'), 'Z0000024', '2021-11-08', '2031-11-07'],

    ['ramesh', idKind('driving-licence'), 'KA00 19700000031', '2016-07-19', '2036-07-18'],
    ['anand', idKind('driving-licence'), 'KA00 19990000032', '2018-03-02', '2038-03-01'],
    ['priya', idKind('driving-licence'), 'KA00 20030000033', '2020-09-15', '2040-09-14'],
  ];

  return rows.map(([person, kind, number, issuedOn, expiresOn], i) => ({
    key: `identity-${i}`,
    person,
    kind,
    number,
    issuedOn,
    expiresOn,
    notes: note(),
  }));
}

/** Everything, in the order it has to be written for the refs to resolve. */
export function plan() {
  return [
    { entity: 'person', rows: people() },
    { entity: 'relationship', rows: relationships(), refs: ['fromPerson', 'toPerson'] },
    { entity: 'account', rows: accounts(), refs: ['holder'] },
    { entity: 'vehicle', rows: vehicles(), refs: ['owner'] },
    { entity: 'policy', rows: policies(), refs: ['holder', 'vehicle'], multi: ['insured'] },
    { entity: 'identityDocument', rows: identityDocuments(), refs: ['person'] },
  ];
}
