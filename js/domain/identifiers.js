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
 * @param {{canRecognise?: boolean}} [options] whether this build reads
 *   pictures of text on the device. A fact about the build rather than about
 *   the document, so it is passed in rather than guessed at: the same
 *   photograph is a different sentence on a phone and in a browser.
 * @returns {{read: boolean, state: string, why: string|null}}
 *   `state` is `read`, `pending-upload`, `unreadable` or `empty`.
 */
export function textState(document, { canRecognise = false } = {}) {
  if (document?.ocrText) return { read: true, state: 'read', why: null };

  const reader = readerFor(document?.mimeType, document?.fileName);

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
