import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import {
  readDate, readAmount, readBill, readPolicy, readIdentifiers, redact,
  detectKind, readDocument, suggestions,
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
