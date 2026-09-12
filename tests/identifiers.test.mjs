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
import { readIdentifiers, redact } from '../js/domain/extract-sensitive.js';

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

  /*
   * The sentence above, said about a locked file, is false twice.
   *
   * An eAadhaar is downloaded password-protected — UIDAI's default, not an
   * unusual choice — and behind the password is a perfect text layer. The
   * reader saw `/Encrypt`, stopped, and said so; every layer above it turned
   * that into "no text", and the screen reached for the only explanation it
   * had left and told the household their document was a scan.
   *
   * It then promised the one thing that cannot happen: *"it will be read when
   * it reaches Drive"*. No recogniser reads a locked file, there or here.
   */
  test('but a locked PDF is not a scan, and is not waiting on Drive', () => {
    const state = textState({ mimeType: 'application/pdf', ocrText: '' }, { locked: true });

    assert.equal(state.state, 'locked');
    assert.includes(state.why, 'password-protected');
    assert.not(state.why.includes('scan'), 'a locked file was called a scan');
    assert.not(state.why.includes('Drive'), 'a locked file was left waiting on Drive');
  });

  test('and being locked outranks what the build can recognise', () => {
    // `canRecognise` decides between the two PDF sentences, and both are
    // wrong here. A phone with a recogniser cannot read a locked file either.
    const state = textState(
      { mimeType: 'application/pdf', ocrText: '' }, { canRecognise: true, locked: true },
    );
    assert.equal(state.state, 'locked');
  });

  test('and a file nothing can read says the dates have to be typed', () => {
    const state = textState({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    assert.equal(state.state, 'empty');
    assert.includes(state.why, 'have to be typed in');
  });

  /*
   * The list this file used to keep, beside the one in `filing.js`.
   *
   * `textState` branched on `image/*` and `application/pdf` and called
   * everything else unreadable. Once `filing.js` learned `.docx`, `.xlsx` and
   * plain text, that last sentence was false about three formats and nothing
   * compared the two lists.
   */
  test('a format this device does read is not called unreadable', () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const state = textState({ mimeType: docx, fileName: 'bill.docx', ocrText: '' });
    assert.equal(state.state, 'empty');
    // The distinction: the reader works, the file had nothing in it.
    assert.includes(state.why, 'nothing was found in this file');
    assert.equal(/nothing here can read text/.test(state.why), false);
  });

  test('and one nothing can open still says the dates have to be typed', () => {
    const state = textState({ mimeType: 'application/msword', fileName: 'old.doc' });
    assert.equal(state.state, 'empty');
    assert.includes(state.why, 'nothing here can read text out of this kind of file');
  });

  /*
   * The same photograph is a different sentence on a phone and in a browser.
   * A build that recognises has already tried, so pointing somebody at Drive
   * would send them to connect an account that would not have helped.
   */
  test('a build that recognises says it tried, rather than promising Drive', () => {
    const state = textState({ mimeType: 'image/jpeg', ocrText: '' }, { canRecognise: true });
    assert.equal(state.state, 'unreadable');
    assert.includes(state.why, 'no text could be recognised');
    assert.equal(/Drive/.test(state.why), false);
  });

  test('and a scanned PDF on such a build says the same about its pictures', () => {
    const state = textState({ mimeType: 'application/pdf', ocrText: '' }, { canRecognise: true });
    assert.equal(state.state, 'unreadable');
    assert.includes(state.why, 'recognised in the pictures it holds');
  });

  test('while a browser is still told Drive will read it', () => {
    // The counterpart. Both branches above are true of a function that ignored
    // the option entirely.
    const state = textState({ mimeType: 'image/jpeg', ocrText: '' }, { canRecognise: false });
    assert.equal(state.state, 'pending-upload');
    assert.includes(state.why, 'read when they reach Drive');
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

/**
 * A bank account number is a value the schema has already decided about.
 *
 * `extract-sensitive.js` states its own rule for what belongs in its table:
 * a value the schema marks `encrypted: true` must not reach `ocrText`, which
 * is searchable and therefore syncs to a cell in the household's Sheet. That
 * is the whole argument its chassis and engine rules are built on —
 * "`vehicle.chassisNumber` and `vehicle.engineNumber` are `encrypted: true` in
 * the schema. The application had decided these were sensitive and was
 * writing them, in the clear, into `ocrText`."
 *
 * Measured against that rule, a bank statement was not covered:
 *
 *     Account No: 501000123456789      → survived whole
 *
 * `account.accountNumber` is `encrypted: true`, and a bank statement is
 * exactly the paper a household scans.
 */
describe('an account number on a statement', () => {
  test('does not reach the searchable text', () => {
    const text = 'Account No: 501000123456789   IFSC HDFC0000123';
    assert.not(redact(text).includes('501000123456789'),
      'a number the schema encrypts was left in the text that syncs');
    assert.includes(redact(text), '[Account removed]');
  });

  test('in the short form a statement actually prints', () => {
    assert.not(redact('A/c No. 123456789012345 held at branch 0021')
      .includes('123456789012345'));
  });

  test('and nothing else on the page goes with it', () => {
    /*
     * The reason this is anchored on its label rather than on nine-to-eighteen
     * digits: a statement is full of runs that shape matches and that a
     * household needs to keep. A UPI narration one line below the account
     * number is a transaction reference, not an account.
     */
    const page = [
      'HDFC BANK LTD — Statement of Account, period Apr 2026',
      'Account No: 501000123456789',
      'UPI/P2A/609812345678/RENT',
      'Order no. 402-7738291-1234567',
    ].join('\n');
    const out = redact(page);

    assert.includes(out, 'Statement of Account');
    assert.includes(out, '609812345678', 'a UPI reference was taken for an account');
    assert.includes(out, '402-7738291-1234567', 'an order number was taken for an account');
    assert.not(out.includes('501000123456789'));
  });
});

/**
 * A payslip, and the Aadhaar label this file did not have.
 *
 * Measured against the same rule the account number was — a value the schema
 * marks `encrypted: true` must not reach `ocrText`:
 *
 *     UAN: 101234567890                   → survived whole
 *     PF No: KN/BNG/0012345/000/0001234   → survived whole
 *     UID 234567890123                    → survived whole
 *
 * `employment.uan` and `employment.pfNumber` are `encrypted: true`. The third
 * is not a missing kind but a missing *label*: `near` on the Aadhaar rule
 * lists `aadhaar`, `aadhar`, `UIDAI` and `unique identification`, and not the
 * abbreviation every bank KYC form prints.
 */
describe('identifiers on a payslip, and an Aadhaar the document calls a UID', () => {
  test('a UAN and a PF number are kept out of the searchable text', () => {
    const out = redact('UAN: 101234567890   PF No: KN/BNG/0012345/000/0001234');
    assert.not(out.includes('101234567890'), 'a UAN reached the text that syncs');
    assert.not(out.includes('KN/BNG/0012345/000/0001234'), 'a PF number reached it');
  });

  test('and the words alone take nothing with them', () => {
    // The label needs a value after it. A payslip that mentions PF in prose is
    // not a payslip with a PF number on that line.
    assert.equal(redact('PF and gratuity are deducted monthly'),
      'PF and gratuity are deducted monthly');
  });

  test('an Aadhaar labelled UID goes', () => {
    assert.not(redact('Customer UID 234567890123 on file').includes('234567890123'));
  });

  test('and a UID somewhere else on the page takes nothing', () => {
    /*
     * The reason the UID rule is a rule of its own with a `keep`, rather than
     * one more alternative in the Aadhaar rule's `near`.
     *
     * `readIdentifiers` tests `near` against the **whole document**. On that
     * path, any page carrying the token — a UPI narration, a footer — would
     * have every Aadhaar-shaped run on it redacted. That is the fault the card
     * rule states in its own words: "presence is not proximity".
     *
     * The separation here is deliberate and has to be wider than `CONTEXT`,
     * which is forty characters either side. A shorter example passes whether
     * or not the gate exists, and the first draft of this check was one.
     */
    const page = 'Ref UID printed in the footer of this statement for support enquiries only.\n'
      + 'Transaction 402773829112 posted on 3 Apr 2026 to a merchant in Bengaluru.';

    assert.includes(redact(page), '402773829112',
      'a UID in the footer redacted a transaction reference on another line');
  });
});

/**
 * A policy number and a FASTag id, removed at the household's request.
 *
 * Both are `encrypted: true` in the schema — `insurance.policyNumber`,
 * `vehicle.insurancePolicy`, `vehicle.fastagId` — and both survived whole into
 * `ocrText`, which is searchable and syncs to a cell in the household's Sheet.
 * Measured before the rules, a policy number sat three lines above a chassis
 * number that was correctly removed.
 *
 * These were raised rather than taken the first time, because redacting a
 * policy number costs findability that `tests/import.test.mjs` names as "the
 * whole reason the text is stored". The household was asked and chose the
 * redaction; that test now asserts the other side of it.
 *
 * Survey and khata numbers are the same shape of fault and are deliberately
 * still readable — the last check here holds that, so the exception cannot be
 * closed by accident.
 */
describe('a policy schedule, and the identifiers left readable on purpose', () => {
  test('a policy number does not reach the searchable text', () => {
    const out = redact('Policy No. 3001/12345678/00/000\nChassis No. MA3ABC12S00123456');
    assert.not(out.includes('3001/12345678/00/000'), 'a policy number reached the text that syncs');
    assert.includes(out, '[Policy removed]');
    // The chassis number beside it still goes. It did before; this is the
    // asymmetry that made the gap visible in the first place.
    assert.includes(out, '[Chassis removed]');
  });

  test('and the word alone takes nothing with it', () => {
    /*
     * `(?:no|number)` is required rather than optional, and the lookahead
     * demands a digit. Without either, "Policy holder: A N Other" comes back
     * with `holder` redacted — a rule that damages the document while removing
     * nothing at all.
     */
    const out = redact('Policy holder: A N Other, Policy Schedule attached');
    assert.equal(out, 'Policy holder: A N Other, Policy Schedule attached');
  });

  test('a FASTag id goes too', () => {
    // Unlike a policy number this is not a handle anybody searches by — it is
    // printed on a statement and read by a gantry — so it cost nothing.
    assert.not(redact('FASTag ID 34161FA820328C6E1234567 balance Rs 500')
      .includes('34161FA820328C6E1234567'));
  });

  test('a survey or khata number stays readable, on purpose', () => {
    /*
     * The exception, held by a check so it cannot be closed by accident.
     *
     * Both are `encrypted: true` and by this file's own rule they belong in
     * the table. A survey number is often the only handle on a deed — unlike a
     * policy number, which arrives on a renewal notice the household already
     * holds — so redacting it can make a fifteen-page scan unfindable in the
     * one way anybody would look for it.
     *
     * If a later change adds them, this fails and asks for the decision to be
     * made again rather than absorbed.
     */
    const deed = 'Survey No. 123/4A   Khata No. 1234/5678 of Bengaluru North';
    assert.equal(redact(deed), deed);
  });
});
