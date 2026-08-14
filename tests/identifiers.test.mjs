/**
 * What the identifier in a document means for the household's records.
 *
 * `domain/extract.js` says identifiers are handed back "for the caller to put
 * somewhere encrypted". Measured: no such caller existed. A photographed PAN
 * card had its number read, correctly kept out of the searchable field, and
 * then dropped — while `identityDocument.number`, encrypted and exactly where
 * it belongs, stayed empty.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  identifierOffers, identityRecordFor, mask, textState, IDENTIFIER_KINDS,
} from '../js/domain/identifiers.js';
import { readIdentifiers } from '../js/domain/extract.js';

setSuite('identifiers');

const PAN = { kind: 'PAN', value: 'ABCDE1234F' };
const AADHAAR = { kind: 'Aadhaar', value: '1234 5678 9012' };

const doc = (over = {}) => ({
  id: 'doc1', title: 'PAN card', person: 'p1', mimeType: 'image/jpeg', ...over,
});

const identity = (over = {}) => ({
  id: 'id1', person: 'p1', kind: 'PAN', number: 'ABCDE1234F', deletedAt: null, ...over,
});

describe('what could be recorded', () => {
  test('an identifier with no matching record is an offer', () => {
    const [offer] = identifierOffers([PAN], doc(), []);

    assert.equal(offer.state, 'offer');
    assert.equal(offer.personId, 'p1');
    assert.equal(offer.existingId, null);
  });

  test('one already on file is not offered again', () => {
    const [offer] = identifierOffers([PAN], doc(), [identity()]);

    assert.equal(offer.state, 'recorded');
    assert.equal(offer.existingId, 'id1');
  });

  test('spacing does not make the same Aadhaar a different one', () => {
    // The document says "1234 5678 9012"; somebody typed "123456789012".
    const [offer] = identifierOffers([AADHAAR], doc(),
      [identity({ kind: 'Aadhaar', number: '123456789012' })]);

    assert.equal(offer.state, 'recorded');
  });

  test('a different number is a question, never an overwrite', () => {
    // Either one of the two is a typo or this document is somebody else's.
    // Both need a person to look at it.
    const [offer] = identifierOffers([PAN], doc(),
      [identity({ number: 'ZZZZZ9999Z' })]);

    assert.equal(offer.state, 'differs');
    assert.includes(offer.why, 'one of the two is wrong');
    // And nothing is offered to write over it.
    assert.equal(identityRecordFor(offer, doc()), null);
  });

  test('a record whose number cannot be read here does not "differ"', () => {
    // `number` is encrypted. A reader without the key sees nothing, and
    // announcing a disagreement on the strength of a value nobody could read
    // would send somebody hunting a problem that is not there.
    const [offer] = identifierOffers([PAN], doc(), [identity({ number: undefined })]);

    assert.equal(offer.state, 'differs');
    assert.includes(offer.why, 'not readable here');
    assert.not(/different number/.test(offer.why), offer.why);
  });

  test('another person’s record is not this person’s', () => {
    const [offer] = identifierOffers([PAN], doc(), [identity({ person: 'p2' })]);
    assert.equal(offer.state, 'offer');
  });

  test('a deleted record does not count as recorded', () => {
    const [offer] = identifierOffers([PAN], doc(),
      [identity({ deletedAt: '2026-01-01T00:00:00.000Z' })]);
    assert.equal(offer.state, 'offer');
  });
});

describe('where it refuses', () => {
  test('a household document has nobody to file an identity against', () => {
    // Guessing an owner would write a PAN against the wrong member of a
    // family, and the field is masked on every screen afterwards, so nobody
    // would see it.
    const [offer] = identifierOffers([PAN], doc({ person: null }), []);

    assert.equal(offer.state, 'no-person');
    assert.includes(offer.why, 'has to belong to somebody');
    assert.equal(identityRecordFor(offer, doc()), null);
  });

  test('a card number is redacted but never filed', () => {
    // There is no benign reason for sixteen digits to sit in a searchable
    // field, and no place in this schema to keep one either. Inventing a home
    // for it is not a decision a scan should make.
    const [offer] = identifierOffers([{ kind: 'Card', value: '4111 1111 1111 1111' }],
      doc(), []);

    assert.equal(offer.state, 'no-home');
    assert.includes(offer.why, 'nowhere in these records to keep it');
    assert.not(IDENTIFIER_KINDS.Card);
  });

  test('nothing found is not an error', () => {
    assert.length(identifierOffers([], doc(), []), 0);
    assert.length(identifierOffers(undefined, undefined, undefined), 0);
    assert.equal(identityRecordFor(null, null), null);
  });
});

describe('the record an accepted offer would create', () => {
  test('carries the number, the person and the document it came off', () => {
    const [offer] = identifierOffers([PAN], doc(), []);
    const record = identityRecordFor(offer, doc());

    assert.equal(record.person, 'p1');
    assert.equal(record.kind, 'PAN');
    assert.equal(record.number, 'ABCDE1234F');
    assert.equal(record.document, 'doc1');
    // Traceable to the scan rather than looking like something somebody typed.
    assert.includes(record.notes, 'PAN card');
  });

  test('and the Aadhaar keeps the form the document used', () => {
    // Normalising for comparison is not the same as rewriting what the
    // document said. The source value is what gets stored.
    const [offer] = identifierOffers([AADHAAR], doc(), []);
    assert.equal(identityRecordFor(offer, doc()).number, '1234 5678 9012');
  });
});

describe('what reaches a screen', () => {
  test('an identifier is shown by its last four and no more', () => {
    assert.equal(mask('ABCDE1234F'), '••••••234F');
    assert.equal(mask('1234 5678 9012'), '••••••••••9012');
  });

  test('and a short value gives nothing away at all', () => {
    assert.equal(mask('12'), '••••');
    assert.equal(mask(''), '••••');
    assert.equal(mask(null), '••••');
  });

  test('the offer carries the masked form, ready to render', () => {
    const [offer] = identifierOffers([PAN], doc(), []);
    assert.equal(offer.masked, '••••••234F');
  });
});

describe('whether a document’s text was read', () => {
  test('one with extracted text has been read', () => {
    assert.deep(textState({ ocrText: 'BESCOM bill due 18-08-2026' }),
      { read: true, state: 'read', why: null });
  });

  test('a photograph not yet in Drive says why nothing was filled in', () => {
    // The screen said "on device only", which is about Drive. It never said
    // anything about the text, so a photographed bill produced no due date and
    // no reminder and nothing explained it.
    const state = textState({ mimeType: 'image/jpeg', ocrText: '' });

    assert.not(state.read);
    assert.equal(state.state, 'pending-upload');
    assert.includes(state.why, 'read when they reach Drive');
  });

  test('and one that did reach Drive with nothing found says that instead', () => {
    const state = textState({ mimeType: 'image/png', driveFileId: 'f1', ocrText: '' });

    assert.equal(state.state, 'unreadable');
    assert.includes(state.why, 'no text could be read');
  });

  test('a PDF with no text layer is a scan, and says so', () => {
    const state = textState({ mimeType: 'application/pdf', ocrText: '' });
    assert.equal(state.state, 'unreadable');
    assert.includes(state.why, 'no text layer');
  });

  test('and a file nothing can read says the dates have to be typed', () => {
    const state = textState({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    assert.equal(state.state, 'empty');
    assert.includes(state.why, 'have to be typed in');
  });

  test('nothing at all does not throw', () => {
    assert.equal(textState(undefined).read, false);
    assert.equal(textState({}).state, 'empty');
  });
});

describe('end to end, from the text of a scan', () => {
  test('a photographed PAN card becomes an offer to record it', () => {
    // The whole point, in one test: the number the household wanted stored is
    // the one thing that used to get thrown away.
    const text = `INCOME TAX DEPARTMENT GOVT. OF INDIA
      Permanent Account Number Card
      ABCDE1234F   Name A CITIZEN`;

    const offers = identifierOffers(readIdentifiers(text), doc(), []);

    assert.length(offers, 1);
    assert.equal(offers[0].state, 'offer');
    assert.equal(identityRecordFor(offers[0], doc()).number, 'ABCDE1234F');
  });

  test('and an Aadhaar letter the same way', () => {
    const text = `Unique Identification Authority of India
      Aadhaar 1234 5678 9012  Name: A Citizen`;

    const offers = identifierOffers(readIdentifiers(text), doc({ title: 'Aadhaar' }), []);
    assert.equal(offers[0].kind, 'Aadhaar');
    assert.equal(offers[0].state, 'offer');
  });
});
