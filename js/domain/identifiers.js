/**
 * What the identifier in a document means for the household's records.
 *
 * ## The gap
 *
 * `domain/extract.js` opens by saying identifiers are "found, removed from the
 * indexable text, and handed back separately **for the caller to put somewhere
 * encrypted**". Measured: that caller does not exist.
 *
 * `sync/drive.js` sets `document.identifiers` on the object it returns and
 * nothing reads it; the Drive OCR path does not even do that much. So a
 * household photographs their PAN card and the application:
 *
 *   1. reads the number — correctly,
 *   2. keeps it out of the searchable field — correctly,
 *   3. throws it away.
 *
 * The half that works is the half that protects. The number the household
 * actually wanted recorded is the one thing that does not get recorded, and
 * `identityDocument.number` — encrypted, exactly where it belongs — stays
 * empty while a photograph of it sits in the document library.
 *
 * ## Why this offers rather than writes
 *
 * Creating an identity record from a scan means asserting whose it is. A
 * document is filed under a person or under the household, and a household
 * document has no owner to give an identity number to. Guessing one would
 * write a PAN against the wrong member of a family — worse than not writing it
 * at all, and invisible afterwards because the field is masked on every screen
 * that shows it.
 *
 * So this derives an *offer*, and a person confirms it. Same rule as the
 * transfer pairing: where the answer is uncertain the deciding stays with the
 * household rather than moving into the click.
 *
 * ## A number that disagrees is a question, never an overwrite
 *
 * If an identity record already exists and holds a different number, that is
 * either a typo in one of them or a document belonging to somebody else. Both
 * need a person to look. Neither is a reason for a scan to silently replace a
 * value somebody typed.
 */

/**
 * Which identity record each extracted identifier belongs in.
 *
 * `Card` is deliberately absent. A payment card number is redacted out of the
 * searchable text because there is no benign reason for it to be there — but
 * this schema has nowhere to *keep* one, and inventing a home for a card
 * number is not a decision a scan should make.
 */
// Which formats can be read is one answer, in `filing.js`. This file used to
// carry a second copy of it as a run of mime-type branches — see `textState`.
import { readerFor, READER } from './filing.js';
import { readLabelledDate } from './extract-values.js';
import { fieldLabel } from '../core/labels.js';
import { entity } from '../data/schema.js';
import { t } from '../core/locale.js';

export const IDENTIFIER_KINDS = {
  PAN: 'PAN',
  Aadhaar: 'Aadhaar',
  Passport: 'Passport',
};

/** Comparable form: an Aadhaar written with spaces is the same Aadhaar. */
const normalise = (value) => String(value ?? '').replace(/[\s-]/g, '').toUpperCase();

/**
 * What could be recorded from a document, and what is already recorded.
 *
 * @param {Array<{kind: string, value: string}>} identifiers from `readIdentifiers`
 * @param {object} document the record the file is attached to
 * @param {Array<object>} identityDocuments existing identity records
 * @returns {Array<{kind, value, masked, state, personId, existingId, why}>}
 *   `state` is one of:
 *     `offer`     — nothing recorded; this could be filed
 *     `recorded`  — the same number is already on file, nothing to do
 *     `differs`   — a different number is on file, which is a question
 *     `no-person` — the document is the household's, so there is nobody to
 *                   file an identity number against
 *     `no-home`   — found and redacted, but this schema has nowhere to keep it
 */
export function identifierOffers(identifiers, document, identityDocuments = []) {
  const out = [];
  const personId = document?.person ?? null;

  for (const { kind, value } of identifiers ?? []) {
    const target = IDENTIFIER_KINDS[kind];

    if (!target) {
      out.push({
        kind, value, masked: mask(value), state: 'no-home', personId: null, existingId: null,
        why: 'this was kept out of the searchable text, and there is nowhere in '
          + 'these records to keep it',
      });
      continue;
    }

    if (!personId) {
      out.push({
        kind, value, masked: mask(value), state: 'no-person', personId: null, existingId: null,
        why: 'this document is filed under the household rather than a person, '
          + 'and an identity number has to belong to somebody',
      });
      continue;
    }

    const existing = (identityDocuments ?? []).find((r) => !r.deletedAt
      && r.person === personId && r.kind === target);

    if (!existing) {
      out.push({
        kind, value, masked: mask(value), state: 'offer', personId, existingId: null,
        why: null,
      });
      continue;
    }

    // A record whose number could not be decrypted for this reader is not a
    // record that disagrees. Saying "this differs" on the strength of a value
    // nobody could read would send somebody looking for a problem that is not
    // there.
    if (existing.number === undefined || existing.number === null || existing.number === '') {
      out.push({
        kind, value, masked: mask(value), state: 'differs', personId, existingId: existing.id,
        why: `a ${target} is already recorded for this person, but its number is `
          + 'not readable here, so the two cannot be compared',
      });
      continue;
    }

    const same = normalise(existing.number) === normalise(value);
    out.push({
      kind,
      value,
      masked: mask(value),
      state: same ? 'recorded' : 'differs',
      personId,
      existingId: existing.id,
      why: same ? null
        : `the ${target} already recorded for this person is a different number — `
          + 'one of the two is wrong, or this document is somebody else’s',
    });
  }

  return out;
}

/**
 * An identifier as it is safe to put on a screen.
 *
 * The last four characters, which is enough for a person to recognise their
 * own and not enough to be the number. Everything in this application that
 * shows an identifier shows it this way.
 */
export function mask(value) {
  const text = String(value ?? '').trim();
  if (text.length <= 4) return '••••';
  return `${'•'.repeat(Math.max(4, text.length - 4))}${text.slice(-4)}`;
}

/**
 * The identity record an accepted offer would create.
 *
 * Returned rather than written, so the caller does the writing through the
 * repository that enforces encryption on `number` and permission on the write.
 * Nothing here reaches storage.
 */
export function identityRecordFor(offer, document) {
  if (!offer || offer.state !== 'offer') return null;
  return {
    person: offer.personId,
    kind: IDENTIFIER_KINDS[offer.kind],
    number: offer.value,
    // The document this came off, so the record can be traced back to the scan
    // rather than looking like something somebody typed.
    document: document?.id ?? null,
    notes: `Read from “${document?.title ?? 'a document'}”.`,
  };
}

/**
 * Whether a document's text has been read, and if not, why not.
 *
 * The screen said "on device only" — which is about Drive — and never said
 * anything about the text. A photograph of a bill filed before Drive was
 * connected has no due date, produces no reminder, and nothing explained it.
 *
 * ## Which formats are readable is asked, not restated
 *
 * This used to carry its own list — `image/*` here, `application/pdf` there,
 * everything else "nothing here can read text out of this kind of file". Once
 * `domain/filing.js` learned to read `.docx`, `.xlsx` and plain text, that
 * last sentence became false about three formats and nothing compared the two
 * lists. `readerFor` is the single answer and this asks it.
 *
 * @param {object} [document]
 * @param {{canRecognise?: boolean, locked?: boolean}} [options]
 *   `canRecognise` is whether this build reads pictures of text on the device.
 *   A fact about the build rather than about the document, so it is passed in
 *   rather than guessed at: the same photograph is a different sentence on a
 *   phone and in a browser.
 *
 *   `locked` is whether the file refused to open because it is encrypted. A
 *   fact about *this file*, which only reading it can establish, so like
 *   `canRecognise` it is passed in rather than guessed at —
 *   `sync/drive.js#identifiersIn` asks `pdf-read.js` and hands the answer
 *   down. See the locked case below for why it outranks everything else.
 * @returns {{read: boolean, state: string, why: string|null}}
 *   `state` is `read`, `pending-upload`, `unreadable`, `locked` or `empty`.
 */
export function textState(document, { canRecognise = false, locked = false } = {}) {
  if (document?.ocrText) return { read: true, state: 'read', why: null };

  const reader = readerFor(document?.mimeType, document?.fileName);

  /*
   * Locked is checked before anything else, because everything else here
   * would be a **false claim** about a locked file rather than a vaguer one.
   *
   * An eAadhaar is downloaded password-protected — that is UIDAI's default,
   * not an unusual choice — and it carries a perfect text layer behind the
   * password. `pdf-read.js` sees `/Encrypt`, gives up, and says exactly why:
   * `reason: 'the PDF is encrypted'`. Every layer above it then turned that
   * into `null`, and this function, reaching the PDF branch with no text and
   * no reason, told the household:
   *
   *     this PDF has no text layer — it is a scan rather than a document
   *
   * which is untrue twice over, and points at the one fix that cannot work:
   * neither Drive's recogniser nor this build's can read a locked file, so
   * "it will be read when it reaches Drive" is a promise nothing will keep.
   *
   * The person holds the password. That is the whole difference between this
   * state and the four around it: every other reason the text was not read is
   * something they can do nothing about.
   */
  if (locked) {
    return { read: false, state: 'locked', why: t('doc.read.locked') };
  }

  if (reader === READER.IMAGE) {
    // A build that recognises has already tried, so Drive is not the
    // explanation — and offering it would send somebody to connect an account
    // that would not have helped.
    if (canRecognise) {
      return {
        read: false,
        state: 'unreadable',
        why: t('doc.read.imageNotRecognised'),
      };
    }
    return document?.driveFileId
      ? {
        read: false,
        state: 'unreadable',
        why: t('doc.read.imageNotRead'),
      }
      : {
        read: false,
        state: 'pending-upload',
        why: t('doc.read.imagePending'),
      };
  }

  if (reader === READER.PDF) {
    return canRecognise
      ? {
        read: false,
        state: 'unreadable',
        why: t('doc.read.pdfNotRecognised'),
      }
      : {
        read: false,
        state: 'unreadable',
        why: t('doc.read.pdfNoTextLayer'),
      };
  }

  if (reader === READER.NONE) {
    return {
      read: false,
      state: 'empty',
      why: t('doc.read.unsupported'),
    };
  }

  // A format this device does read — a Word file, a spreadsheet, plain text —
  // that gave up nothing. Saying it cannot be read would be false about the
  // reader; the file had nothing in it to find.
  return {
    read: false,
    state: 'empty',
    why: t('doc.read.nothingFound'),
  };
}

/**
 * An identity document — the reader that was missing.
 *
 * `READERS` below had an entry for a policy, a receipt, a bill, an agreement,
 * a vehicle registration, a no-dues letter and a tax certificate. It had none
 * for `identity`, so a document `detectKind` classified as one came back with
 * `fields: {}`. An eAadhaar was read, correctly classified, had its number
 * found and offered — and every other thing printed on it was dropped,
 * including the date it was issued, which the schema has a field for and the
 * expiry machinery already knows how to use.
 *
 * ## What it reads, and what it deliberately does not
 *
 * **The issue date.** Measured against a real eAadhaar, the page carries two
 * dates and only one of them is this: *Aadhaar no. issued* is when UIDAI
 * issued it, and *Details as on* is when this copy was downloaded. Reading the
 * second as an issue date would record the day somebody pressed a button.
 *
 * On that document it reads neither, and the reason is worth recording. The
 * row is a single text run and its year has **three digits** — `Aadhaar no.
 * issued: dd/mm/yyy` — while *Details as on* three points above it has four.
 * The fourth digit is not in the text layer at all: no stray glyph sits on
 * that row, so there is nothing to recover and a reader that produced a date
 * anyway would have invented a year. It returns nothing, which is the honest
 * answer, and the label set below is what reads it on a document whose year
 * survived.
 *
 * **Not the issuer**, though `identityDocument.issuedBy` exists and an
 * eAadhaar is issued by a body with a name. Measured on a real one: `UIDAI`,
 * `Unique Identification Authority of India` and `Government of India` are
 * none of them in the text layer — that header is an image. A reader for a
 * field no document tested here can supply would be a guess with a function
 * around it.
 *
 * **Not the holder's name, date of birth, gender or address.** An eAadhaar
 * carries all four, and they belong to `person` rather than to this record —
 * so writing them would mean choosing which person and whether to overwrite
 * what somebody typed. `identifierOffers` already exists for exactly that
 * shape of decision, and extending it is a separate piece of work with a
 * screen attached. Reading them here and storing them nowhere would be the
 * "collected and read by nothing" fault `tools/field-coverage.mjs` exists to
 * catch.
 */
export function readIdentity(text) {
  const source = String(text ?? '');

  return kept({
    // `issued` alone would also match "Details as on" on a line above it in a
    // row-joined read, so the label carries the word that distinguishes them.
    // One word, and it is not brevity for its own sake: `readLabelledDate`
    // matches the label then skips up to twenty non-digits, so `issue` reaches
    // "date of issue: ", "issue date: " and "Aadhaar no. issued: " alike. A
    // list of whole phrases would also have added six sentences of English to
    // a count that may only fall, for no extra document read.
    issuedOn: readLabelledDate(source, ['issue']),
  });
}

/** The fields that were actually found. Mirrors `prune` in `extract.js`. */
function kept(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== ''),
  );
}

/**
 * What an identity document says about the **person** it belongs to.
 *
 * `readIdentity` above reads what belongs on the document record. This reads
 * the four things an eAadhaar prints about its holder — name, date of birth,
 * gender and address — which belong on `person` and nowhere else.
 *
 * ## Offered, never written
 *
 * Nothing here writes. `personOffers` below compares what was read against
 * what the person record already holds and proposes only the empty ones, and a
 * human presses the button. Three reasons, and the first is enough on its own:
 *
 * **These are read off a scan and can be wrong.** A name is recovered from a
 * PDF's text layer by position; the same document that carries it also carries
 * a year with a digit missing. Writing a misread name over a correct one is a
 * worse outcome than leaving a field empty.
 *
 * **A value somebody typed is a decision.** `suggestions()` in `extract.js`
 * says the same thing about dates: "nothing overwrites a value a person
 * typed". An empty field is the only safe target.
 *
 * **The household knows which person.** The document is filed under one
 * already, and that is the only person these can be about — but `identifiers`
 * refuses to resolve a nominee to a person for exactly this reason, and this
 * follows it rather than inventing a second answer.
 *
 * ## The anchors, measured on a real eAadhaar
 *
 * The page prints the holder's name twice, once in the local script and once
 * in Latin, then the address, then a bilingual DOB and gender line. The
 * layout is what makes each readable:
 *
 *     To
 *     <name, local script>
 *     <name, Latin>            ← the first Latin line after `To`
 *     C/O …                    ← the address begins, so the name has ended
 *     …
 *     DOB : dd/mm/yyyy
 *     / FEMALE Address:
 *     C/O … 560001             ← to the PIN, which ends it
 */
export function readPersonDetails(text) {
  const source = String(text ?? '');

  return kept({
    name: readHolderName(source),
    birthday: readLabelledDate(source, ['dob', 'birth']),
    gender: readGender(source),
    address: readHolderAddress(source),
  });
}

/** Address markers, which are where a name has stopped. */
const RELATION = /^(C\/O|S\/O|D\/O|W\/O)\b/i;

/**
 * The line after `To` that is written in Latin letters.
 *
 * Anchored on `To` rather than on "the first name-shaped line", because a name
 * has no shape: two words, three, an initial, a single word are all names, and
 * so is half the rest of the page.
 */
function readHolderName(source) {
  const lines = source.split('\n').map((one) => one.trim());
  const start = lines.findIndex((one) => /^to$/i.test(one));
  if (start < 0) return null;

  for (const line of lines.slice(start + 1, start + 6)) {
    if (!line) continue;
    if (RELATION.test(line)) return null;          // the address began first
    if (/\d/.test(line)) return null;              // and so did the numbers
    if (/^[A-Za-z][A-Za-z.\s]*$/.test(line) && line.replace(/[^A-Za-z]/g, '').length >= 2) {
      return line.replace(/\s+/g, ' ');
    }
  }
  return null;
}

/**
 * Gender, mapped onto the four the schema offers.
 *
 * `FEMALE` is checked first and every alternative is bounded, because `MALE`
 * is a substring of it — a rule that read them in the other order would call
 * every woman on every Aadhaar a man.
 *
 * `TRANSGENDER` maps to `other`, which is the closest the schema has. Saying
 * so here rather than silently dropping it: a person whose document says one
 * thing and whose record says another deserves the mapping written down.
 */
function readGender(source) {
  if (/\bFEMALE\b/i.test(source)) return 'female';
  if (/\bTRANSGENDER\b/i.test(source)) return 'other';
  if (/\bMALE\b/i.test(source)) return 'male';
  return null;
}

/** From the `Address:` label to the PIN code, which is where an address ends. */
function readHolderAddress(source) {
  const at = source.search(/\bAddress\s*:/i);
  if (at < 0) return null;

  const after = source.slice(at).replace(/^[^:]*:/, '');
  const end = after.search(/\b\d{6}\b/);
  if (end < 0) return null;

  const block = after.slice(0, end + 6).replace(/\s+/g, ' ').trim();
  return block.length >= 10 ? block : null;
}

/**
 * Which of those a person record has no answer for yet.
 *
 * Only the empty ones, and the value is carried so the screen can show what it
 * proposes to write. A field the person already filled is not offered at all —
 * not offered-and-marked-different, which would invite somebody to overwrite
 * their own correction with a scan.
 */
export function personOffers(details, person) {
  if (!person) return [];

  return [...PERSON_DETAIL_FIELDS]
    .filter((key) => details?.[key])
    .filter((key) => {
      const held = person[key];
      return held === undefined || held === null || String(held).trim() === '';
    })
    .map((key) => ({
      field: key,
      // Through the door, like every other schema label on a screen: the
      // person entity already names these four, and a second copy here would
      // be four more English strings and a fifth place to keep in step.
      label: fieldLabel('person', entity('person').fields.find((f) => f.key === key) ?? { key }),
      value: details[key],
    }));
}

/** The four an identity document can speak to, in the order a form shows them. */
export const PERSON_DETAIL_FIELDS = Object.freeze(['name', 'birthday', 'gender', 'address']);
