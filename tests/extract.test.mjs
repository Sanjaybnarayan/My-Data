import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import {
  readDate, readAmount, readBill, readPolicy, readIdentifiers, redact, detectKind, readDocument, suggestions, readReceipt, stopAtLabel, readAgreement, readVehicle,
} from '../js/domain/extract.js';
import { DocumentStore } from '../js/sync/drive.js';
import { PdfDocument } from '../js/reports/pdf.js';

setSuite('extract');

/* ------------------------------------------------------------------ dates */

describe('dates in documents', () => {
  test('a spelled month is unambiguous and wins', () => {
    assert.equal(readDate('03 Apr 2025'), '2025-04-03');
    assert.equal(readDate('3 April 2025'), '2025-04-03');
    assert.equal(readDate('15-Jan-2026'), '2026-01-15');
  });

  test('a numeric date is read day-first', () => {
    // 03/04/2025 is the third of April. Reading it month-first would move a
    // due date by a month for eleven days out of every twelve.
    assert.equal(readDate('03/04/2025'), '2025-04-03');
    assert.equal(readDate('15/01/2026'), '2026-01-15');
  });

  test('an ISO date is taken as written', () => {
    assert.equal(readDate('2026-01-15'), '2026-01-15');
  });

  test('an impossible date is refused rather than coerced', () => {
    assert.equal(readDate('45/45/2025'), null);
    assert.equal(readDate('not a date'), null);
    assert.equal(readDate(''), null);
  });
});

/* ---------------------------------------------------------------- amounts */

describe('amounts', () => {
  test('an amount is taken from its label, not from the page', () => {
    const text = 'Previous balance 5,000.00 Amount payable ₹ 1,234.50 Late fee 50.00';
    assert.equal(readAmount(text, ['amount payable']), 123_450);
  });

  test('labels are tried in order, so the specific one wins', () => {
    const text = 'Total 9,999.00 Amount due Rs. 450.00';
    assert.equal(readAmount(text, ['amount due', 'total']), 45_000);
  });

  test('a missing label is null, not zero', () => {
    // Zero would total up as though the bill were free.
    assert.equal(readAmount('nothing relevant here', ['amount due']), null);
  });
});

/* ----------------------------------------------------------- the redaction */

describe('identifiers never reach a searchable field', () => {
  const pan = 'Permanent Account Number ABCDE1234F issued by the Income Tax Department';
  const aadhaar = 'UIDAI Aadhaar 1234 5678 9012 Government of India';

  test('a PAN is found only where something names it', () => {
    assert.deep(readIdentifiers(pan), [{ kind: 'PAN', value: 'ABCDE1234F' }]);
    // The same shape with no label nearby is some other code, and gutting
    // every such string would wreck the text while missing the real one.
    assert.length(readIdentifiers('Order code ABCDE1234F shipped'), 0);
  });

  test('an Aadhaar is found spaced or unspaced', () => {
    assert.equal(readIdentifiers(aadhaar)[0].kind, 'Aadhaar');
    assert.equal(readIdentifiers('aadhaar 123456789012')[0].value, '123456789012');
  });

  test('a card number needs no label', () => {
    // There is no benign reason for sixteen digits in that shape to sit in a
    // field that syncs to a spreadsheet.
    const found = readIdentifiers('Paid with 4111 1111 1111 1111 on Tuesday');
    assert.equal(found[0].kind, 'Card');
  });

  test('redacting removes the value and says something was removed', () => {
    const out = redact(pan);
    assert.not(out.includes('ABCDE1234F'), 'the number survived redaction');
    assert.includes(out, '[PAN removed]');
    assert.includes(out, 'Income Tax Department', 'the rest of the text should survive');
  });

  test('a document with nothing sensitive is returned unchanged', () => {
    const text = 'BESCOM electricity bill for June 2026, amount payable 1,240.00';
    assert.equal(redact(text), text);
  });

  test('readDocument only ever offers redacted text for indexing', () => {
    const read = readDocument(`${pan} ${aadhaar}`);
    assert.not(read.indexable.includes('ABCDE1234F'));
    assert.not(read.indexable.includes('1234 5678 9012'));
    assert.length(read.identifiers, 2, 'both are still reported to the caller');
  });
});

/* ------------------------------------------------------------------ kinds */

describe('what kind of document it is', () => {
  test('each kind is recognised by what only it says', () => {
    assert.equal(detectKind('Account Statement 01 Apr 2025 - 31 Mar 2026'), 'statement');
    assert.equal(detectKind('Policy Number 12345 Sum Assured 500000'), 'policy');
    assert.equal(detectKind('Permanent Account Number ABCDE1234F'), 'identity');
    assert.equal(detectKind('Consumer No 1234 Units consumed 210 Due date 15/07/2026'), 'bill');
  });

  test('an unrecognised document says so rather than picking one', () => {
    assert.equal(detectKind('Dear Sir, thank you for your letter.'), 'unknown');
    assert.equal(detectKind(''), 'unknown');
  });
});

/* ----------------------------------------------------------------- bills */

describe('reading a bill', () => {
  const bill = `BESCOM Bangalore Electricity Supply Company
    Consumer No 4412345678
    Bill Date 01/07/2026
    Units consumed 210
    Amount Payable ₹ 2,340.00
    Due Date 18/07/2026
    Pay online at bescom.org`;

  test('the biller names itself where it is known', () => {
    const read = readBill(bill);
    assert.equal(read.biller, 'BESCOM');
    assert.equal(read.category, 'utilities');
  });

  test('the due date is read, which is the field this exists for', () => {
    assert.equal(readBill(bill).dueDate, '2026-07-18');
    assert.equal(readBill(bill).billDate, '2026-07-01');
  });

  test('the amount comes from its own label', () => {
    assert.equal(readBill(bill).amount, 234_000);
  });

  test('the account number is read', () => {
    assert.equal(readBill(bill).accountNumber, '4412345678');
  });

  test('a field that is not there is absent rather than guessed', () => {
    // A wrong due date is worse than no due date: it fires a reminder on the
    // wrong day and stops anybody looking for the right one.
    const read = readBill('A short note with no bill fields in it at all.');
    assert.equal(read.dueDate, undefined);
    assert.equal(read.amount, undefined);
  });
});

/* --------------------------------------------------------------- policies */

describe('reading a policy', () => {
  const policy = `Policy Number: P/123/456789
    Sum Assured Rs. 5,00,000
    Total Premium 12,450.00
    Valid upto 31/03/2027
    Date of commencement 01/04/2026`;

  test('the numbers and the dates come out', () => {
    const read = readPolicy(policy);
    assert.equal(read.policyNumber, 'P/123/456789');
    assert.equal(read.sumAssured, 50_000_000);
    assert.equal(read.premium, 1_245_000);
    assert.equal(read.expiresOn, '2027-03-31');
    assert.equal(read.startsOn, '2026-04-01');
  });
});

/* ------------------------------------------------------------ suggestions */

describe('what a document suggests about its record', () => {
  test("a bill's due date becomes the expiry the reminders already watch", () => {
    // Reusing `expiresOn` means no second reminder mechanism has to exist.
    const read = readDocument('Consumer No 99 Amount payable 100.00 Due date 18/07/2026');
    assert.equal(suggestions(read).expiresOn, '2026-07-18');
  });

  test('nothing a person typed is overwritten', () => {
    const read = readDocument('Policy Number X Sum assured 1,00,000 Valid upto 31/03/2027');
    const out = suggestions(read, { expiresOn: '2030-01-01', title: 'My policy' });
    assert.equal(out.expiresOn, undefined);
    assert.equal(out.title, undefined);
  });
});

/* ------------------------------------------------------------ end to end */

describe('an uploaded document', () => {
  const asFile = (bytes, { name, type }) => ({
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });

  test('a bill fills in its own due date', async () => {
    const bytes = new PdfDocument({ title: 'Electricity bill' })
      .paragraph('BESCOM Consumer No 4412345678')
      .paragraph('Amount Payable 2,340.00')
      .paragraph('Due Date 18/07/2026')
      .build();

    const db = await makeDb();
    const { document } = await new DocumentStore({ db, transport: null }).capture(
      asFile(bytes, { name: 'bill.pdf', type: 'application/pdf' }), { category: 'other' },
    );

    const saved = await db.repo('document').get(document.id);
    assert.equal(saved.expiresOn, '2026-07-18', 'the due date did not reach the record');
    assert.includes(saved.ocrText, 'BESCOM');
  });

  test('a PAN card is searchable by everything except the PAN', async () => {
    // The whole point. Getting better at reading must not make the
    // application worse at keeping a secret.
    const bytes = new PdfDocument({ title: 'PAN' })
      .paragraph('INCOME TAX DEPARTMENT GOVT OF INDIA')
      .paragraph('Permanent Account Number ABCDE1234F')
      .build();

    const db = await makeDb();
    const { document } = await new DocumentStore({ db, transport: null }).capture(
      asFile(bytes, { name: 'pan.pdf', type: 'application/pdf' }), { category: 'identity' },
    );

    const saved = await db.repo('document').get(document.id);
    assert.includes(saved.ocrText, 'INCOME TAX DEPARTMENT');
    assert.not(saved.ocrText.includes('ABCDE1234F'), 'the PAN reached a searchable field');
    assert.equal(document.identifiers[0].kind, 'PAN', 'it should still be offered to the caller');
  });
});

/* ------------------------------------------------- text that came from OCR */

describe('a scan read by the server', () => {
  test('OCR text is redacted on the same terms as text read here', async () => {
    // The rule about what may reach a searchable field does not depend on who
    // did the reading. A scanned PAN card is the case that matters: the
    // browser cannot read pixels, so this is the only path its number takes.
    const db = await makeDb();
    const transport = {
      configured: true,
      async upload(payload) {
        assert.ok(payload.ocr, 'a file this device could not read must ask the server to');
        return {
          fileId: 'drv_1',
          folderId: 'fld_1',
          versionCount: 1,
          text: 'INCOME TAX DEPARTMENT Permanent Account Number ABCDE1234F',
        };
      },
    };

    const store = new DocumentStore({ db, transport });
    const { document } = await store.capture({
      name: 'pan.jpg',
      type: 'image/jpeg',
      size: 3,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }, { title: 'PAN card', category: 'identity' });

    assert.not(document.ocrText, 'an image cannot be read on the device');

    await store.flush();

    const saved = await db.repo('document').get(document.id);
    assert.includes(saved.ocrText, 'INCOME TAX DEPARTMENT');
    assert.not(saved.ocrText.includes('ABCDE1234F'), 'the PAN reached a searchable field');
    assert.equal(saved.driveFileId, 'drv_1');
  });

  test('a document already read here does not ask the server to read it again', async () => {
    const db = await makeDb();
    let asked = null;
    const transport = {
      configured: true,
      async upload(payload) {
        asked = payload.ocr;
        return { fileId: 'drv_2', folderId: 'fld_1', versionCount: 1, text: '' };
      },
    };

    const bytes = new PdfDocument({ title: 'Bill' }).paragraph('Amount payable 100.00').build();
    const store = new DocumentStore({ db, transport });
    await store.capture(
      { name: 'b.pdf', type: 'application/pdf', size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
      { category: 'other' },
    );
    await store.flush();

    assert.equal(asked, false, 'a PDF read on the device must not be OCR-ed again');
  });
});

/**
 * Reading a receipt.
 *
 * Receipts were routed through the bill reader, and the roadmap recorded three
 * missed fields. Measured across four real layouts — a school fee receipt, a
 * temple donation, a rent receipt and a hospital payment — it was worse than
 * three: **nothing at all**, no amount and no date, eight fields of eight.
 *
 * A bill and a receipt describe the same money in opposite tenses. A bill says
 * *amount payable*; a receipt says **"received the sum of"**, because the
 * paying has already happened. Looking for one set of words in a document
 * written with the other finds nothing.
 *
 * Worse than the missing ones: `biller` came back **filled in with the person
 * who paid** on three of the four, and on the rent receipt it was
 * `"Sanjay Narayan towards rent for the month"`, which is not anybody's name.
 */
const SCHOOL_FEE = `
GREENWOOD PUBLIC SCHOOL
Fee Receipt
Receipt No: GPS/2026/04412        Date: 12 Jul 2026
Received with thanks from Mr Sanjay Narayan
Student: Aarav Narayan   Class VII-B   Adm No 20419
Towards: Term II Tuition Fee
Received the sum of Rupees Forty Eight Thousand Five Hundred Only
Amount: Rs. 48,500.00
Mode of Payment: NEFT
`;

const HOSPITAL = `
APOLLO HOSPITALS
PAYMENT RECEIPT
Bill No: IP/2026/77812   Receipt Date: 21 Jun 2026
Patient Name: Meera Narayan   UHID: APL8829111
Payment received towards: Inpatient charges
Paid Amount        : 1,24,380.00
Mode: Credit Card
Thank you for your payment.
`;

const DONATION = `
SHRI VENKATESHWARA TRUST (Regd.)
DONATION RECEIPT
Receipt No. 88231                 Dated: 03/08/2026
Received from: Sanjay Narayan
Being donation towards Annadanam
Sum of Rs 11,000/- (Rupees Eleven Thousand only)
Payment received by UPI
`;

const RENT = `
RENT RECEIPT
Received a sum of Rs. 35,000 (Rupees Thirty Five Thousand Only)
from Sanjay Narayan towards rent for the month of July 2026
for the property at 14/3 Rose Villa, Indiranagar, Bengaluru.
Landlord: R Krishnan
Date: 05-07-2026
`;

/** A receipt whose only amount cue is the phrase itself, with no `Amount:` line. */
const PLAIN = `
PAYMENT RECEIPT
Received the sum of Rs. 12,000 from Sanjay Narayan
Receipt Date: 09 Aug 2026
`;

describe('reading a receipt', () => {
  test('the phrase a receipt is written with is enough on its own', () => {
    // No "Amount:" line anywhere — if the phrasing is not read, nothing is.
    // The first version of these checks used receipts that also carried an
    // `Amount:` line, so dropping the phrase entirely changed nothing.
    assert.equal(readReceipt(PLAIN).amount, 12_000_00);
    assert.equal(readReceipt(RENT).amount, 35_000_00);
  });

  test('a payer this cannot identify is left empty, not guessed at', () => {
    // "from Sanjay Narayan towards rent for the month of July 2026" is one
    // line, and reading a bare "from" as a name produced `"Sanjay Narayan
    // towards rent for the month"` — filed as a person, and not anybody's
    // name. Only labels that unambiguously introduce a payer are read, so this
    // layout yields nothing, and nothing is the right answer.
    //
    // Asserted as absent rather than as "not containing 'towards'": the first
    // version of this checked a value that was already `undefined`, so it
    // passed whatever the reader did.
    assert.equal(readReceipt(RENT).payer, undefined);
    assert.equal(readReceipt(SCHOOL_FEE).payer, 'Mr Sanjay Narayan');
  });

  test('the amount is found in the tense a receipt is written in', () => {
    assert.equal(readReceipt(SCHOOL_FEE).amount, 48_500_00);
    assert.equal(readReceipt(DONATION).amount, 11_000_00);
  });

  test('an Indian-grouped amount is read whole', () => {
    // 1,24,380 — lakh grouping, not thousands. Read as ₹1,24,380 or as
    // ₹1.24, and the second is a bill somebody thinks they have paid.
    assert.equal(readReceipt(HOSPITAL).amount, 1_24_380_00);
  });

  test('the date is the receipt date', () => {
    assert.equal(readReceipt(SCHOOL_FEE).receiptDate, '2026-07-12');
    assert.equal(readReceipt(HOSPITAL).receiptDate, '2026-06-21');
    assert.equal(readReceipt(DONATION).receiptDate, '2026-08-03');
  });

  test('the person who paid is the payer, not the biller', () => {
    // A receipt's "from" is the payer; a bill's is the company. Filing one as
    // the other is a wrong value rather than a missing one.
    assert.equal(readReceipt(SCHOOL_FEE).payer, 'Mr Sanjay Narayan');
    assert.equal(readReceipt(DONATION).payer, 'Sanjay Narayan');
    assert.equal(readReceipt(SCHOOL_FEE).biller, undefined);
  });

  test('a payment method is never read as a person', () => {
    // "Payment received by UPI" is ordinary phrasing, and reading `received
    // by` as a name filled this with "UPI" — a payment method presented as
    // whoever took the money.
    assert.not(readReceipt(DONATION).receivedBy, JSON.stringify(readReceipt(DONATION)));
  });

  test('what it was for is taken only where it is said', () => {
    assert.equal(readReceipt(SCHOOL_FEE).towards, 'Term II Tuition Fee');
    assert.equal(readReceipt(HOSPITAL).towards, 'Inpatient charges');
  });

  test('the receipt number is kept', () => {
    assert.equal(readReceipt(SCHOOL_FEE).receiptNumber, 'GPS/2026/04412');
  });

  test('nothing is invented from an empty document', () => {
    assert.deep(readReceipt(''), {});
    assert.deep(readReceipt('a page with no receipt on it'), {});
  });
});

describe('a receipt is not a bill, even when it says Bill No', () => {
  test('a hospital payment receipt is read as a receipt', () => {
    // "Bill No: IP/2026/77812" at the top had this read as a bill, so its
    // amount was looked for under "amount payable" — a phrase a receipt never
    // uses, because the money has already gone.
    assert.equal(detectKind(HOSPITAL), 'receipt');
  });

  test('and an actual bill still is one', () => {
    // The reordering must not drag bills across with it.
    const bill = `BESCOM ELECTRICITY BILL
      Consumer No: 1234567890
      Bill Date: 01 Jul 2026   Due Date: 18 Jul 2026
      Amount Payable: Rs. 2,340.00`;
    assert.equal(detectKind(bill), 'bill');
    assert.equal(readBill(bill).amount, 2_340_00);
  });

  test('readDocument sends each to its own reader', () => {
    assert.equal(readDocument(HOSPITAL).fields.amount, 1_24_380_00);
    assert.equal(readDocument(HOSPITAL).fields.receiptDate, '2026-06-21');
  });
});

/**
 * A receipt whose lines have run together.
 *
 * A PDF's text layer often arrives with the line breaks gone, and every receipt
 * fixture above is multi-line — so a capture bounded only by length was untested
 * against the shape a real extraction produces. Measured across four flattened
 * layouts, **three returned a wrong name**:
 *
 *     "Mr Sanjay Narayan Towards"
 *     "Sanjay Narayan Being donation towards Ann"
 *     "R Krishnan Amount"
 *
 * A wrong name is a claim, not a gap. This is the bound that stops it.
 */
const FLAT = {
  school: 'GREENWOOD PUBLIC SCHOOL Fee Receipt Received with thanks from '
    + 'Mr Sanjay Narayan Towards: Term II Tuition Fee Amount: Rs. 48,500.00',
  donation: 'DONATION RECEIPT Received from: Sanjay Narayan Being donation '
    + 'towards Annadanam Sum of Rs 11,000',
  rent: 'Received with thanks from R Krishnan Amount: Rs. 35,000 Date: 05-07-2026',
};

describe('a payer’s name when the line breaks are gone', () => {
  test('stops before the label that follows it', () => {
    assert.equal(readReceipt(FLAT.school).payer, 'Mr Sanjay Narayan');
    assert.equal(readReceipt(FLAT.rent).payer, 'R Krishnan');
  });

  test('and before a whole clause that follows it', () => {
    // The worst of the three: the name ran on through "Being donation towards"
    // and stopped mid-word.
    assert.equal(readReceipt(FLAT.donation).payer, 'Sanjay Narayan');
  });

  test('what it was for is bounded the same way', () => {
    // Otherwise a school fee receipt says the payment was towards
    // "Term II Tuition Fee Amount".
    assert.equal(readReceipt(FLAT.school).towards, 'Term II Tuition Fee');
    assert.equal(readReceipt(FLAT.donation).towards, 'Annadanam');
  });

  test('the amount and date are unaffected', () => {
    // The bound must not cost what already worked.
    assert.equal(readReceipt(FLAT.school).amount, 48_500_00);
    assert.equal(readReceipt(FLAT.rent).receiptDate, '2026-07-05');
  });

  test('a multi-line receipt reads exactly as it did', () => {
    assert.equal(readReceipt(SCHOOL_FEE).payer, 'Mr Sanjay Narayan');
    assert.equal(readReceipt(SCHOOL_FEE).towards, 'Term II Tuition Fee');
  });

  test('a value that is only a label becomes nothing', () => {
    // Half a name is not a better answer than none.
    assert.equal(stopAtLabel('Towards'), null);
    assert.equal(stopAtLabel('  '), null);
    assert.equal(stopAtLabel(null), null);
  });

  test('a name with no label after it is left whole', () => {
    assert.equal(stopAtLabel('R Krishnan'), 'R Krishnan');
  });

  test('trailing punctuation from the cut is trimmed', () => {
    assert.equal(stopAtLabel('Sanjay Narayan, Towards'), 'Sanjay Narayan');
  });
});

/**
 * Documents this application could not name, and two numbers it was leaking.
 *
 * Measured against ten real household documents (`docs/DOCUMENT_FORMATS.md`).
 * Every fixture below is a **retyped layout** — the shapes and labels of those
 * documents with invented values, as every fixture in this repository is.
 */

// A Karnataka e-stamp header, label-first. Four documents measured share this
// block; three of them print it the other way round, which is the whole
// difficulty.
const ESTAMP_LABEL_FIRST = [
  'INDIA NON JUDICIAL',
  'Government of Karnataka',
  'e-Stamp',
  'Certificate No. IN-KA11111111111111A',
  'Certificate Issued Date 04-Feb-2021 11:19 AM',
  'Description of Document : Article 5(J) Agreement (in any other cases)',
  'Consideration Price (Rs.) 0',
  '(Zero)',
  'First Party ANAND RAO',
  'Second Party MEERA IYER',
  'Stamp Duty Amount(Rs.) 500',
  '(Five Hundred only)',
  'DEED OF PARTNERSHIP',
  'THIS DEED is made and entered into in the city of Bangalore',
].join('\n');

// The same block as the OCR of a real scan lays it out: value, then label.
const ESTAMP_VALUE_FIRST = [
  'INDIA NON JUDICIAL',
  'Government of Karnataka',
  'IN-KA22222222222222B',
  'Certificate No.',
  '04-Feb-2021 11:19 AM',
  'Certificate Issued Date',
  'ANAND RAO',
  'First Party',
  'MEERA IYER',
  'Second Party',
  'Stamp Duty Amount(Rs.) 500',
  'RENTAL AGREEMENT',
  'hereinafter called the LESSOR',
].join('\n');

const RC_CARD = [
  'KARNATAKA',
  'CERTIFICATE OF REGISTRATION',
  'TRANSPORT DEPARTMENT',
  'REG NO: KA99XX1111',
  'FORM-23A',
  'REG.DATE :09-09-2021',
  'CHASSIS.NO AAAAA111AAA222222',
  'COLOUR: MIDNIGHT BLUE',
  'ENGINE.NO B1CDEF222222 CLASS : Motor Car',
  'MFR',
  'A MOTORS INDIA PRIVATE LIMITED',
  'OWNERNAME: ANAND RAO',
  'REGFC UPTO: 08-09-2036',
  // As the real card lays it out, and the order matters to the test below:
  // the value, the seating type, the label, and then a *number*. Nothing
  // readable follows the label, so there is only one reading — which is why a
  // pattern of "any word near FUEL" answers `SLPR` here and is not saved by
  // the ambiguity rule.
  ': PETROL STDG/SLPR',
  'FUEL',
  ':1497.00',
].join('\n');

describe('a chassis number is as sensitive as a PAN, and the schema said so', () => {
  test('chassis and engine numbers are kept out of searchable text', () => {
    // `vehicle.chassisNumber` and `vehicle.engineNumber` are `encrypted: true`
    // on the schema. They were being written, in the clear, into `ocrText` —
    // which is searchable, and therefore syncs to a cell in the household's
    // Sheet. The application had already decided these were sensitive.
    const read = readDocument(RC_CARD);
    const kinds = read.identifiers.map((i) => i.kind);

    assert.ok(kinds.includes('Chassis'), 'a chassis number was left in the clear');
    assert.ok(kinds.includes('Engine'), 'an engine number was left in the clear');
    assert.equal(read.indexable.includes('AAAAA111AAA222222'), false);
    assert.equal(read.indexable.includes('B1CDEF222222'), false);
  });

  test('they are anchored on their label, not on their shape', () => {
    // Seventeen alphanumerics is also a part number, an order number and a
    // policy number. Redacting every such token would do to an invoice what
    // the Card rule does to a statement.
    assert.length(readIdentifiers('Part AAAAA111AAA222222 fitted at service'), 0);
  });

  test('the marker says something was taken out', () => {
    assert.includes(redact(RC_CARD), '[Chassis removed]');
  });
});

describe('an agreement is not a bill and not a receipt', () => {
  test('a lease is an agreement rather than a bill', () => {
    // Measured: a real house agreement was classified `bill` and a real rent
    // agreement `receipt`, because there was no agreement kind and an
    // agreement falls through to whichever money-word appears first. `bill` is
    // the kind whose due date feeds the reminder machinery.
    assert.equal(detectKind(ESTAMP_VALUE_FIRST), 'agreement');
    assert.equal(detectKind(ESTAMP_LABEL_FIRST), 'agreement');
  });

  test('a registration certificate is a vehicle document', () => {
    assert.equal(detectKind(RC_CARD), 'vehicle');
  });

  test("a dealer's invoice for a car is still a receipt", () => {
    // The vehicle rule is deliberately narrow. Matching on `chassis` would
    // take the tax invoice with it, and buying a car is not registering one.
    assert.equal(detectKind('TAX INVOICE\nCHASSIS NO: AAAAA111AAA222222\nReceipt date 01-Feb-2021'), 'receipt');
  });

  test('an agreement is filed as legal, and a certificate as a vehicle', () => {
    assert.equal(suggestions(readDocument(ESTAMP_LABEL_FIRST)).category, 'legal');
    assert.equal(suggestions(readDocument(RC_CARD)).category, 'vehicle');
  });

  test('an RC expiry becomes the expiry the reminders already watch', () => {
    // The reason to read one: an RC that lapses unnoticed is a vehicle that
    // cannot legally be driven.
    assert.equal(suggestions(readDocument(RC_CARD)).expiresOn, '2036-09-08');
  });

  test('a document is not titled after one party to it', () => {
    // A deed belongs to both sides; naming it after one is a judgement about
    // whose document it is.
    assert.equal(suggestions(readDocument(ESTAMP_LABEL_FIRST)).title, undefined);
  });
});

describe('when the label may be on either side of its value', () => {
  test('the e-stamp header reads label-first', () => {
    const read = readAgreement(ESTAMP_LABEL_FIRST);
    assert.equal(read.certificateNumber, 'IN-KA11111111111111A');
    assert.equal(read.issuedOn, '2021-02-04');
    assert.equal(read.stampDuty, 500_00);
  });

  test('and reads the same header written value-first', () => {
    // Three of four measured documents put the value first. The same issuer's
    // same block, so neither order can be assumed.
    assert.equal(readAgreement(ESTAMP_VALUE_FIRST).certificateNumber, 'IN-KA22222222222222B');
  });

  test('a value that both readings agree on is returned once', () => {
    assert.equal(readVehicle(RC_CARD).registrationNumber, 'KA99XX1111');
  });

  test('two readings that disagree produce nothing at all', () => {
    // The first version preferred label-first, which does not fail in a
    // value-first document — it answers confidently and wrongly. On a real
    // partnership deed it returned the two partners **the wrong way round**,
    // and on a rental agreement it gave `"Second Party"` as the first party's
    // name.
    const swapped = 'ANAND RAO\nFirst Party\nMEERA IYER\nSecond Party\nStamp Duty Amount(Rs.) 500';
    const read = readAgreement(swapped);

    assert.equal(read.firstParty ?? null, null, 'a party was guessed at');
    // Named explicitly: the failure was not a blank, it was the *other* party.
    assert.not(read.firstParty === 'MEERA IYER', 'the parties came back swapped');
  });

  test('a fuel is read from the closed set it belongs to', () => {
    // The card prints `PETROL STDG/SLPR` on one line and `FUEL` on the next,
    // so the nearest word to the label is `SLPR` — a seating type, read as a
    // fuel.
    assert.equal(readVehicle(RC_CARD).fuel ?? null, null);
    assert.equal(readVehicle('FUEL: DIESEL\nCLASS : Motor Car').fuel, 'DIESEL');
  });

  test('an e-stamp issue date reaches the field the schema already had', () => {
    // `document.issuedOn` existed and nothing had ever written it.
    assert.equal(suggestions(readDocument(ESTAMP_LABEL_FIRST)).issuedOn, '2021-02-04');
  });
});

/**
 * Sixteen digits that are not a card, and a policy that states two expiries.
 *
 * Both measured on real documents, and both are the same failure in different
 * clothes: a rule that is confident where the document is not.
 */
describe('sixteen digits are not automatically a card', () => {
  // Passes Luhn. Every real card does, by construction.
  const REAL = '4111 1111 1111 1111';
  // Does not. A payment reference of the shape a UPI narration carries.
  const REFERENCE = '8861975785123456';

  test('a number that passes Luhn is redacted with no label at all', () => {
    assert.equal(readIdentifiers(`Paid with ${REAL} on Tuesday`)[0].kind, 'Card');
  });

  test('a number that fails Luhn and has nothing naming it is left alone', () => {
    // Measured: a Google Workspace payment reference inside a UPI narration
    // was redacted out of the household's own searchable text and handed back
    // as though it were a card.
    assert.length(readIdentifiers(`PCD/1234/GOOGLE WORKSPACE/${REFERENCE}/12:30`), 0);
  });

  test('a word beside it naming a card wins over Luhn', () => {
    // A mis-scanned card number is still a card number. Where the document
    // says card, the digits go whatever they add up to.
    assert.equal(readIdentifiers(`Debit Card ${REFERENCE} used at shop`)[0].kind, 'Card');
  });

  test('the word must be beside it, not merely somewhere in the document', () => {
    // The first version of this asked whether "card" appeared anywhere in the
    // text. A bank statement always says it somewhere, so the Luhn check never
    // ran and the false positive survived unchanged.
    const far = `Card annual fee charged in April.${'\n'.repeat(30)}`
      + `PCD/1234/GOOGLE WORKSPACE/${REFERENCE}/12:30`;
    assert.length(readIdentifiers(far), 0, 'a word thirty lines away is not beside it');
  });
});

describe('when a policy expires, and when it will not say', () => {
  test('"Date of Expiry" is read, which is what an insurer actually writes', () => {
    // Measured: `expiry date` was known and `date of expiry` was not, so two
    // real motor policies yielded no expiry at all — the field the whole
    // reminder machinery turns on.
    assert.equal(readPolicy('Policy no X\nDate of Expiry: 09/07/2026').expiresOn, '2026-07-09');
  });

  test('a period is a range, and the expiry is its second date', () => {
    // `readLabelledDate` returns the first date of a range — the day cover
    // started. Filing that as the expiry puts a renewal reminder a year in the
    // past.
    const read = readPolicy('Policy no X\nPeriod of Insurance: 18 May 25 to 17 May 26');
    assert.equal(read.expiresOn, '2026-05-17');
  });

  test('a range with its end missing is not read as a point', () => {
    // Measured on a real policy, where column interleaving in the PDF left
    // `18 May 25 12:00 AM to 17` — the end date lost to the next column.
    const read = readPolicy('Policy no X\nPeriod of insurance 18 May 25 12:00 AM to 17 Name');
    assert.equal(read.expiresOn ?? null, null, 'a start date was filed as an expiry');
  });

  test('two different expiry dates produce neither, and are handed back', () => {
    // A standalone own-damage policy prints the third-party cover it sits
    // beside, so the document states two. Nothing in the text says which is
    // this policy's without knowing what OD and TP mean.
    const read = readPolicy('Policy no X\nDate of Expiry: 09/07/2026\nDate of Expiry: 05/07/2027');

    assert.equal(read.expiresOn ?? null, null, 'one of two expiry dates was chosen');
    assert.deep(read.expiryConflict, ['2026-07-09', '2027-07-05']);
  });

  test('a conflict never becomes a reminder', () => {
    const read = readDocument('Policy Number X\nSum assured 1,00,000\n'
      + 'Date of Expiry: 09/07/2026\nDate of Expiry: 05/07/2027');
    assert.equal(suggestions(read).expiresOn, undefined);
  });

  test('the same date said twice is not a conflict', () => {
    const read = readPolicy('Policy no X\nDate of Expiry: 09/07/2026\nValid upto 09/07/2026');
    assert.equal(read.expiresOn, '2026-07-09');
    assert.equal(read.expiryConflict, undefined);
  });
});

/**
 * A conflict that reaches the record, and therefore the screen.
 *
 * `expiryConflict` was returned by `readPolicy`, asserted by tests, and read
 * by nothing — the headless-engine pattern this repository has now found five
 * times. A policy whose expiry is ambiguous has no `expiresOn`, so it is
 * absent from the documents screen's Expiring list, which reads exactly like a
 * policy with nothing to renew.
 */
describe('an ambiguous expiry reaches the record', () => {
  const TWO = 'Policy Number X\nSum assured 1,00,000\n'
    + 'Date of Expiry: 09/07/2026\nDate of Expiry: 05/07/2027';

  test('the dates the document gave are carried onto the document', () => {
    const out = suggestions(readDocument(TWO));
    assert.equal(out.expiryConflict, '2026-07-09, 2027-07-05');
    assert.equal(out.expiresOn, undefined, 'one of the two was chosen after all');
  });

  test('an unambiguous policy carries no conflict', () => {
    const out = suggestions(readDocument('Policy Number X\nDate of Expiry: 09/07/2026'));
    assert.equal(out.expiresOn, '2026-07-09');
    assert.equal(out.expiryConflict, undefined);
  });

  test('a date a person already set is not argued with', () => {
    // Once somebody has decided, the disagreement is settled, and repeating it
    // on their own record is noise.
    const out = suggestions(readDocument(TWO), { expiresOn: '2027-07-05' });
    assert.equal(out.expiryConflict, undefined);
  });
});

/**
 * A certificate that awards something, and one that registers something.
 *
 * The rule pairs `certificate` with `presented to` rather than matching what a
 * certificate is nominally about. Measured on the one award certificate among
 * twenty-two real documents, `Appreciation` came out of OCR as `Apyreciation`
 * and `donating` as `ddnating` — a rule built on those words would be fitted
 * to one file's typos, not reading.
 */
describe('a certificate that awards is not one that registers', () => {
  test('an award certificate is named, through the OCR damage', () => {
    assert.equal(detectKind('Certificate of Apyreciation\nPresented to\nMr B N'), 'certificate');
  });

  test('a certificate that attests is named by what it opens with', () => {
    // The first version of this rule paired `certificate` with `presented to`,
    // built against the single award certificate then available. Nine more
    // certificates later it matched **none of them**. `this is to certify
    // that` is what an Indian certificate actually opens with.
    assert.equal(detectKind('STUDY CERTIFICATE\nThis is to certify that A B has studied'), 'certificate');
    assert.equal(detectKind('MIGRATION CERTIFICATE\nThis is to certify that A B\nRoll No. 1'), 'certificate');
  });

  test("a tax invoice's certify boilerplate does not make it a certificate", () => {
    // Measured on a real dealer invoice: *"We hereby certify that our
    // Registration Certificate GST Under Act, 2017 is in force"*. The rule is
    // ordered last precisely so the kinds above win.
    assert.equal(
      detectKind('GST - TAX INVOICE\nReceipt date 01-Feb-2021\n'
        + 'We hereby certify that our Registration Certificate GST is in force'),
      'receipt',
    );
  });

  test('a policy that certifies is still a policy', () => {
    assert.equal(
      detectKind('Policy Number X\nSum Assured 500000\nThis is to certify that cover is in force'),
      'policy',
    );
  });

  test('a registration certificate stays a vehicle document', () => {
    // Ordering is the whole of it: `vehicle` is matched first.
    assert.equal(detectKind('CERTIFICATE OF REGISTRATION\nREG NO: KA99XX1111\nFORM-23A'), 'vehicle');
  });

  test('an e-stamp certificate stays an agreement', () => {
    assert.equal(
      detectKind('INDIA NON JUDICIAL\nStamp Certificate\nDEED OF PARTNERSHIP\nwitnesseth'),
      'agreement',
    );
  });

  test('the word certificate alone is not enough', () => {
    // A bill, an invoice and a policy all say "certificate" somewhere.
    assert.not(detectKind('Certificate No. 12345\nAmount payable 100.00\nDue date 01/02/2026')
      === 'certificate');
  });
});
