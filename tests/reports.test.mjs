import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson, makeAccount } from './fixture.mjs';
import { toCsv, fromCsv, columnsFor } from '../js/reports/csv.js';
import { toXlsx, zip, excelSerialDate, safeSheetName } from '../js/reports/xlsx.js';
import { PdfDocument, textWidth, wrap } from '../js/reports/pdf.js';
import {
  reports, reportById, produce, gather, renderCsv, unreadableSummary,
} from '../js/reports/build.js';
import { toMinor } from '../js/core/money.js';

setSuite('reports');

const text = (bytes) => Buffer.from(bytes).toString('latin1');

describe('CSV', () => {
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', type: 'currency' },
  ];

  test('a formula in a value cannot execute when the file is opened', () => {
    const csv = toCsv(columns, [{ name: '=cmd|/c calc', amount: 100 }], { bom: false });
    assert.includes(csv, "'=cmd");
  });

  test('money leaves as a number a spreadsheet can sum', () => {
    const csv = toCsv(columns, [{ name: 'Rent', amount: toMinor('12500.50') }], { bom: false });
    assert.includes(csv, '12500.5');
    assert.not(csv.includes('₹'), 'a formatted string cannot be summed');
  });

  test('and a negative one too, which is the half that was not summable', () => {
    /*
     * The test above passes `12500.50`, and a positive number is the one input
     * that cannot show this fault.
     *
     * `escapeForSheet` guards anything starting with `= + - @`, which is right
     * for a payee called `=HYPERLINK(...)` and caught every debt on the way
     * past. `'-3258000` is *text* in a spreadsheet and `SUM()` skips text, so a
     * household exporting their accounts to see where they stood got a total
     * with the liabilities missing — no error, no blank cell, a plausible
     * number that was too big.
     *
     * Measured on three accounts, one positive and two overdrawn: the column
     * summed to the positive one alone.
     */
    const csv = toCsv(columns, [
      { name: 'Savings', amount: 5_00_000_00 },
      { name: 'Credit card', amount: -32_58_000_00 },
    ], { bom: false });

    assert.includes(csv, ',-3258000');
    assert.not(csv.includes("'-"), `a debt exported as text: ${csv}`);

    // The figures a spreadsheet would actually add, added.
    const summed = csv.trim().split('\r\n').slice(1)
      .map((line) => Number(line.split(',')[1]))
      .reduce((a, b) => a + b, 0);
    assert.equal(summed, 500000 - 3258000, 'the column has to add up to the truth');
  });

  test('but a formula in a money column is still guarded, because it is not a number', () => {
    // The exemption is tested at the cell, not assumed from the column: a
    // `currency` column carrying something that is not a number gets the guard
    // exactly as a text column would.
    const csv = toCsv(columns, [{ name: 'Odd', amount: '=1+1' }], { bom: false });
    assert.includes(csv, "'=1+1");
  });

  test('an amount nobody can read leaves as what it says, not as NaN', () => {
    /*
     * `toMajor` returns NaN for the hand-edited cell `domain/amounts.js` is
     * written about. `NaN` in a household's own export tells them nothing;
     * the text that is actually in their sheet tells them what to go and fix.
     */
    const csv = toCsv(columns, [{ name: 'Hand-edited', amount: 'twenty thousand' }], { bom: false });
    assert.includes(csv, 'twenty thousand');
    assert.not(csv.includes('NaN'), csv);
  });

  test('a byte-order mark is written so Excel reads UTF-8', () => {
    assert.ok(toCsv(columns, []).startsWith('﻿'));
  });

  test('an export round-trips through the parser', () => {
    const rows = [
      { name: 'Comma, inside', amount: 100 },
      { name: 'Quote "inside"', amount: 200 },
      { name: 'Line\nbreak', amount: 300 },
    ];
    const parsed = fromCsv(toCsv(columns, rows, { bom: false }));
    assert.equal(parsed[0][0], 'Name');
    assert.equal(parsed[1][0], 'Comma, inside');
    assert.equal(parsed[2][0], 'Quote "inside"');
    assert.equal(parsed[3][0], 'Line\nbreak');
  });

  test('encrypted columns are excluded unless asked for', () => {
    const plain = columnsFor('account').map((c) => c.key);
    assert.not(plain.includes('accountNumber'), 'a sealed field must not leave in the clear by default');
    assert.includes(columnsFor('account', { includeEncrypted: true }).map((c) => c.key), 'accountNumber');
  });
});

describe('XLSX', () => {
  const sheet = {
    name: 'Transactions',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'payee', label: 'Payee' },
      { key: 'amount', label: 'Amount', type: 'currency' },
    ],
    rows: [{ date: '2025-06-10', payee: 'Reliance Fresh', amount: toMinor('1250.50') }],
  };

  test('the file is a ZIP with the parts Excel requires', () => {
    const bytes = toXlsx([sheet]);
    assert.equal(text(bytes.subarray(0, 2)), 'PK', 'a .xlsx that is not a ZIP opens nowhere');
    const body = text(bytes);
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/_rels/workbook.xml.rels', '_rels/.rels']) {
      assert.includes(body, part, `missing part: ${part}`);
    }
  });

  test('the central directory agrees with the local headers', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world' }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

    // End-of-central-directory is the last 22 bytes with no comment.
    const eocdAt = bytes.length - 22;
    assert.equal(view.getUint32(eocdAt, true), 0x06054b50, 'no end-of-central-directory record');
    assert.equal(view.getUint16(eocdAt + 10, true), 2, 'wrong entry count');

    const centralAt = view.getUint32(eocdAt + 16, true);
    assert.equal(view.getUint32(centralAt, true), 0x02014b50, 'central directory not where the trailer says');

    const firstLocalAt = view.getUint32(centralAt + 42, true);
    assert.equal(view.getUint32(firstLocalAt, true), 0x04034b50, 'offset does not point at a local header');
  });

  test('the CRC in the header matches the data', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello' }]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Known CRC-32 of "hello".
    assert.equal(view.getUint32(14, true), 0x3610a686);
  });

  test('a date becomes a real date, not a string', () => {
    const body = text(toXlsx([sheet]));
    assert.includes(body, `<v>${excelSerialDate('2025-06-10')}</v>`);
  });

  test('the Excel epoch conversion matches the spreadsheet', () => {
    // Checked against Excel itself: 1 January 2025 is serial 45658.
    assert.equal(excelSerialDate('2025-01-01'), 45658);
    assert.equal(excelSerialDate('1900-03-01'), 61, 'the phantom 1900 leap day is part of the format');
    assert.equal(excelSerialDate('not a date'), null);
  });

  test('money is a number with a currency format, not text', () => {
    const body = text(toXlsx([sheet]));
    assert.includes(body, '<v>1250.5</v>');
    assert.includes(body, 'numFmtId="164"');
  });

  test('a value with an ampersand does not break the XML', () => {
    const body = text(toXlsx([{
      ...sheet,
      rows: [{ date: '2025-06-10', payee: 'Marks & Spencer <Ltd>', amount: 100 }],
    }]));
    assert.includes(body, 'Marks &amp; Spencer &lt;Ltd&gt;');
  });

  test('sheet names are trimmed and deduplicated', () => {
    const taken = new Set();
    assert.equal(safeSheetName('Transactions', taken), 'Transactions');
    assert.equal(safeSheetName('Transactions', taken), 'Transactions (2)');
    assert.ok(safeSheetName('a'.repeat(50), new Set()).length <= 31);
    assert.not(safeSheetName('A/B:C*D', new Set()).includes('/'));
  });

  test('the header row is frozen and filterable', () => {
    const body = text(toXlsx([sheet]));
    assert.includes(body, 'state="frozen"');
    assert.includes(body, '<autoFilter');
  });
});

describe('PDF', () => {
  test('the file has a header, a trailer and a cross-reference table', () => {
    const bytes = new PdfDocument({ title: 'Test' }).paragraph('hello').build();
    const body = text(bytes);
    assert.ok(body.startsWith('%PDF-1.4'));
    assert.includes(body, 'xref');
    assert.includes(body, 'trailer');
    assert.ok(body.trimEnd().endsWith('%%EOF'));
  });

  test('the cross-reference offsets point at real objects', () => {
    const bytes = new PdfDocument({ title: 'Test' }).paragraph('hello').build();
    const body = text(bytes);

    const startxref = Number(/startxref\s+(\d+)/.exec(body)[1]);
    assert.equal(body.slice(startxref, startxref + 4), 'xref', 'startxref does not point at the table');

    const table = body.slice(startxref);
    const entries = [...table.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    assert.ok(entries.length >= 5, 'too few objects in the table');
    for (const [i, offset] of entries.entries()) {
      assert.equal(body.slice(offset, offset + String(i + 1).length + 6), `${i + 1} 0 obj`,
        `object ${i + 1} is not at the offset the table claims`);
    }
  });

  test('parentheses in text cannot break out of the string', () => {
    const bytes = new PdfDocument({ title: 'T' }).paragraph('a ) Tj bad ( b').build();
    assert.includes(text(bytes), 'a \\) Tj bad \\( b');
  });

  test('a rupee sign is transliterated rather than emitted as a broken glyph', () => {
    const bytes = new PdfDocument({ title: 'T' }).paragraph('₹1,200').build();
    assert.includes(text(bytes), 'Rs.1,200');
  });

  test('long content paginates and every page is counted', () => {
    const doc = new PdfDocument({ title: 'Long' });
    doc.table(
      [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
      Array.from({ length: 200 }, (_, i) => ({ a: `row ${i}`, b: String(i) })),
    );
    const body = text(doc.build());
    const pages = Number(/\/Count (\d+)/.exec(body)[1]);
    assert.ok(pages >= 4, `200 rows should need several pages, got ${pages}`);
    assert.includes(body, `Page 1 of ${pages}`);
  });

  test('a table header repeats on every page', () => {
    const doc = new PdfDocument({ title: 'Long' });
    doc.table(
      [{ key: 'a', label: 'UNIQUEHEADER' }],
      Array.from({ length: 200 }, (_, i) => ({ a: `row ${i}` })),
    );
    const body = text(doc.build());
    const occurrences = body.split('UNIQUEHEADER').length - 1;
    assert.ok(occurrences >= 4, 'a continuation page of unlabelled columns is unreadable');
  });

  test('text measurement uses real font metrics', () => {
    // In Helvetica an 'i' is narrow and a 'W' is wide; a fixed-width estimate
    // would make these equal and overflow every table cell.
    assert.ok(textWidth('iiii', 10) < textWidth('WWWW', 10) / 2);
    assert.equal(textWidth('', 10), 0);
  });

  test('wrapping breaks a word with no spaces rather than overflowing', () => {
    const lines = wrap('KA01AB1234567890ABCDEFGHIJKLMNOP', 40, 10);
    assert.ok(lines.length > 1);
    for (const line of lines) assert.ok(textWidth(line, 10) <= 40);
  });
});

describe('report definitions', () => {
  test('every report names entities that exist and builds from empty data', async () => {
    const db = await makeDb();
    for (const report of reports) {
      const { data } = await gather(db, report);
      const built = report.build(data, {});
      assert.ok(Array.isArray(built.sections), `${report.id} did not return sections`);
      assert.ok(built.summary, `${report.id} has no summary`);
    }
  });

  test('every report produces all three formats from real data', async () => {
    const db = await makeDb();
    const person = await makePerson(db);
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2025-06-10', kind: 'expense', amount: '1250.50',
      account: account.id, category: 'groceries', payee: 'Reliance Fresh',
    });
    await db.repo('holding').create({
      name: 'Nifty Fund', kind: 'mutual fund', owner: person.id,
      invested: '100000', currentValue: '130000', active: true,
    });
    await db.repo('policy').create({
      name: 'Family Floater', kind: 'health', insurer: 'Star',
      policyNumber: 'SH1', premium: '24000', renewsOn: '2026-01-01',
    });

    for (const report of reports) {
      for (const format of ['csv', 'xlsx', 'pdf']) {
        const file = await produce(db, report.id, format);
        assert.ok(file.blobParts.length > 0, `${report.id}/${format} produced nothing`);
        assert.ok(file.filename.endsWith(`.${format}`));
        assert.ok(file.mime.length > 0);
      }
    }
  });

  test('a CSV of a multi-section report keeps the sections apart', async () => {
    const db = await makeDb();
    await makeAccount(db);
    const report = reportById('net-worth');
    const csv = renderCsv(report.build((await gather(db, report)).data));
    assert.includes(csv, 'Summary');
    assert.includes(csv, 'Accounts');
  });

  test('an unknown report or format is refused rather than producing a blank file', async () => {
    const db = await makeDb();
    await assert.throws(() => produce(db, 'not-a-report', 'pdf'), 'unknown report');
    await assert.throws(() => produce(db, 'net-worth', 'docx'), 'unknown format');
  });

  test('a monthly report honours the period it is asked for', async () => {
    const db = await makeDb();
    const account = await makeAccount(db);
    await db.repo('transaction').create({
      date: '2020-01-15', kind: 'expense', amount: '500', account: account.id,
    });
    const report = reportById('monthly-finance');
    const { data } = await gather(db, report);

    const old = report.build(data, { period: { from: '2020-01-01', to: '2020-01-31' } });
    const transactions = old.sections.find((s) => s.title === 'Transactions');
    assert.length(transactions.rows, 1);

    const recent = report.build(data, { period: { from: '2025-01-01', to: '2025-01-31' } });
    assert.not(recent.sections.some((s) => s.title === 'Transactions'),
      'an empty section should be dropped, not printed with no rows');
  });
});

describe('a report that could not read everything', () => {
  /** A db whose `list` fails for one entity, with the code the caller decides on. */
  const brokenFor = (db, entityName, code) => ({
    ...db,
    repo: (name) => (name === entityName
      ? { list: async () => { throw Object.assign(new Error('nope'), code ? { code } : {}); } }
      : db.repo(name)),
  });

  test('a read failure is carried out of gather, not turned into no records', async () => {
    const db = await makeDb();
    const report = reportById('net-worth');
    const { data, unreadable } = await gather(brokenFor(db, 'account', 'decrypt'), report);

    assert.includes(unreadable, 'account');
    // The empty list is still produced — a report that throws is worse than a
    // short one. What changed is that the shortfall travels with it.
    assert.deep(data.account, []);
  });

  test('a permission refusal is not a read failure', async () => {
    // A role that may not read accounts contributes none, and that is the
    // design. Reporting it as unreadable would put a warning on every report a
    // restricted household member exports.
    const db = await makeDb();
    const report = reportById('net-worth');
    const { unreadable } = await gather(brokenFor(db, 'account', 'permission'), report);
    assert.deep(unreadable, []);
  });

  test('and a report that read everything carries no warning', async () => {
    const db = await makeDb();
    const report = reportById('net-worth');
    const { unreadable } = await gather(db, report);
    assert.deep(unreadable, []);
    assert.equal(unreadableSummary(unreadable), null);
  });

  test('the warning says it is not a statement that there are none', () => {
    const [label, text] = unreadableSummary(['account', 'asset']);
    assert.equal(label, 'Incomplete');
    assert.includes(text, 'account, asset');
    assert.includes(text, 'not a statement that there are none');
  });

  test('a CSV missing a record type does not say no records fall in the period', () => {
    // The sentence this whole change exists to stop printing into a file a
    // household keeps.
    const built = {
      sections: [],
      summary: [unreadableSummary(['transaction'])],
    };
    const csv = renderCsv(built);
    assert.not(csv.includes('No records fall in this period'),
      'a failed read was reported as an empty period');
    assert.includes(csv, 'Incomplete');
  });

  test('but a genuinely empty period still says so', () => {
    // Without this, suppressing the sentence altogether would pass the test
    // above and leave a household with a file that explains nothing.
    assert.includes(renderCsv({ sections: [], summary: [] }),
      'No records fall in this period');
  });
});
