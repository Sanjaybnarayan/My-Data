/**
 * Reading a Word file, a spreadsheet and a plain text file.
 *
 * The file picker on the Documents screen has offered
 * `image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt` since it was written,
 * and `canReadText` answered `application/pdf` and nothing else — so the
 * screen invited five kinds of file it would then refuse to look inside.
 *
 * The `.docx` case is the one worth naming. `domain/docxtemplate.js` has
 * unzipped Word files and lifted their text runs since Phase 3, for report
 * templates: the machinery was in the repository, exported and tested, while a
 * household uploading a Word bill had its due date read by nothing.
 *
 * The fixtures are built with the repository's own `zip`, so a change to how
 * this application writes an OOXML file is a change these read.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { readOoxml, readPlain } from '../js/data/office-read.js';
import {
  readerFor, canReadText, mayRead, READER, indexableText, titleFromFileName,
} from '../js/domain/filing.js';
import { zip } from '../js/reports/xlsx.js';
import { DocumentStore } from '../js/sync/drive.js';

setSuite('office read');

const enc = (text) => new TextEncoder().encode(text);

/** Entries written uncompressed, so no `inflate` is needed to read them back. */
const stored = async (bytes) => null;

const paragraphs = (...lines) => lines
  .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');

function docxOf(...lines) {
  return zip([
    { name: '[Content_Types].xml', data: enc('<Types/>') },
    {
      name: 'word/document.xml',
      data: enc(`<w:document><w:body>${paragraphs(...lines)}</w:body></w:document>`),
    },
  ]);
}

function xlsxOf(...cells) {
  return zip([
    { name: '[Content_Types].xml', data: enc('<Types/>') },
    {
      name: 'xl/sharedStrings.xml',
      data: enc(`<sst>${cells.map((one) => `<si><t>${one}</t></si>`).join('')}</sst>`),
    },
    { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet/>') },
  ]);
}

/** A `File` the way a browser hands one to `capture`. */
function fileOf(bytes, name, type) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
    ),
  };
}

describe('which reader a file needs', () => {
  test('a PDF, a Word file, a spreadsheet and a text file each say so', () => {
    assert.equal(readerFor('application/pdf', 'bill.pdf'), READER.PDF);
    assert.equal(readerFor(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a.docx',
    ), READER.OOXML);
    assert.equal(readerFor(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'a.xlsx',
    ), READER.OOXML);
    assert.equal(readerFor('text/plain', 'note.txt'), READER.PLAIN);
  });

  /*
   * The share-sheet case. An app sending a file through Android's share sheet
   * frequently sets no type at all, so judging by the declared type alone
   * would read a `.docx` picked from storage and refuse the identical file
   * shared from Gmail.
   */
  test('a file whose sender declared no type is read by its name', () => {
    assert.equal(readerFor('application/octet-stream', 'bill.docx'), READER.OOXML);
    assert.equal(readerFor('', 'policy.xlsx'), READER.OOXML);
    assert.equal(readerFor(undefined, 'ledger.csv'), READER.PLAIN);
  });

  test('but a declared image is never read by its name', () => {
    // Otherwise `photo.txt` is opened as text and filed as read-and-empty.
    assert.equal(readerFor('image/png', 'photo.txt'), READER.IMAGE);
    assert.equal(readerFor('image/jpeg', 'scan.jpg'), READER.IMAGE);
  });

  /*
   * An image is its own answer, not "no answer".
   *
   * `IMAGE` says pictures of text: something might read it, and only by
   * recognising it. `canReadText` stays **false** for one, because text lifted
   * out of a PDF is what the document says and text recognised from a
   * photograph is a model's reading of some pixels — usually right, and a
   * different kind of answer. A screen that could not tell those apart would
   * have nothing to say about which it was showing.
   */
  test('an image can be recognised but not read, and the two are not the same', () => {
    assert.equal(canReadText('image/jpeg', 'scan.jpg'), false);
    assert.equal(mayRead('image/jpeg', 'scan.jpg'), true);
    // The counterpart, or the pair above is true of everything.
    assert.equal(canReadText('application/pdf', 'a.pdf'), true);
    assert.equal(mayRead('application/msword', 'a.doc'), false);
  });

  test('the old binary Office formats are refused rather than half-read', () => {
    // `.doc` and `.xls` are not zip archives. Nothing here can open them, and
    // a document filed as read with nothing in it is worse than one filed as
    // unread.
    assert.equal(readerFor('application/msword', 'old.doc'), READER.NONE);
    assert.equal(readerFor('application/vnd.ms-excel', 'old.xls'), READER.NONE);
    assert.equal(canReadText('application/msword', 'old.doc'), false);
  });

  test('and a file that says nothing about itself is refused', () => {
    assert.equal(readerFor('', ''), READER.NONE);
    assert.equal(readerFor(undefined, undefined), READER.NONE);
  });
});

describe('the text inside an OOXML file', () => {
  test('a Word document reads one line per paragraph', async () => {
    const pages = await readOoxml(docxOf('BESCOM Electricity Bill', 'Due Date: 18/10/2026'), stored);
    assert.deep(pages[0].lines, ['BESCOM Electricity Bill', 'Due Date: 18/10/2026']);
  });

  /*
   * Word splits a run wherever formatting changes, so `12,500` arrives as
   * three `<w:t>` elements when the thousands separator is styled. Joining
   * every run in the file with spaces puts a gap inside the number and the
   * amount is lost; within a paragraph they are concatenated with nothing.
   */
  test('runs split mid-number are put back together', async () => {
    const split = zip([
      {
        name: 'word/document.xml',
        data: enc('<w:document><w:body><w:p>'
          + '<w:r><w:t>Amount Payable: Rs. 12</w:t></w:r>'
          + '<w:r><w:t>,</w:t></w:r>'
          + '<w:r><w:t>500</w:t></w:r>'
          + '</w:p></w:body></w:document>'),
      },
    ]);
    const pages = await readOoxml(split, stored);
    assert.deep(pages[0].lines, ['Amount Payable: Rs. 12,500']);
  });

  test('XML entities come back as the characters they stand for', async () => {
    // `Rs&#160;12,500` reaching the extractor as a literal `&#160;` spends six
    // of the forty characters `readAmount` may cross.
    const pages = await readOoxml(docxOf('Tata Power &amp; Sons Rs&#160;1,880'), stored);
    assert.equal(pages[0].lines[0], 'Tata Power & Sons Rs 1,880');
  });

  test('a spreadsheet reads its shared string table', async () => {
    const pages = await readOoxml(
      xlsxOf('Policy Number: OG-26-1201', 'Sum Assured Rs. 5,00,000'), stored,
    );
    assert.includes(pages[0].lines, 'Policy Number: OG-26-1201');
    assert.includes(pages[0].lines, 'Sum Assured Rs. 5,00,000');
  });

  test('and a string stored in the cell rather than pooled', async () => {
    const inline = zip([
      { name: 'xl/worksheets/sheet1.xml', data: enc('<worksheet><sheetData><row>'
        + '<c t="inlineStr"><is><t>Premium Rs. 12,500</t></is></c>'
        + '</row></sheetData></worksheet>') },
    ]);
    const pages = await readOoxml(inline, stored);
    assert.deep(pages[0].lines, ['Premium Rs. 12,500']);
  });

  test('a zip that is neither reads as nothing, rather than as its largest part', async () => {
    const other = zip([{ name: 'mimetype', data: enc('application/epub+zip') }]);
    assert.length(await readOoxml(other, stored), 0);
  });

  test('and a Word file with no words is empty rather than a blank line', async () => {
    assert.length(await readOoxml(docxOf(), stored), 0);
  });
});

describe('the text inside a plain file', () => {
  test('lines survive, blank ones do not', () => {
    const pages = readPlain(enc('TATA POWER\n\n  Total Rs. 1,880.00  \n\n'));
    assert.deep(pages[0].lines, ['TATA POWER', 'Total Rs. 1,880.00']);
  });

  test('an empty file reads as nothing', () => {
    assert.length(readPlain(enc('   \n\n')), 0);
  });

  test('and the lines flatten the way every other reader\'s do', () => {
    // The same shape `pdf-read.js` returns, so `drive.js` needs no branch per
    // format and `indexableText` needs no second implementation.
    assert.equal(indexableText(readPlain(enc('one\ntwo'))), 'one two');
  });
});

/*
 * The whole path, through the real `DocumentStore.capture` rather than through
 * the readers directly — because the readers working proves nothing about
 * whether anything calls them, which is this repository's most common finding.
 */
describe('a document uploaded is a document read', () => {
  const bill = () => docxOf(
    'BESCOM Electricity Bill',
    'Bill Number: 40021998',
    'Amount Payable: Rs. 2,340.00',
    'Due Date: 18/10/2026',
  );

  test('a Word bill arrives with its due date already filled in', async () => {
    const db = await makeDb();
    const store = new DocumentStore({ db, transport: null });
    const { document, read } = await store.capture(
      fileOf(bill(), 'bescom.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      { title: 'bescom' },
    );

    assert.equal(read.kind, 'bill');
    assert.equal(document.expiresOn, '2026-10-18');
    assert.equal(read.fields.amount, 234000);
    assert.includes(document.ocrText, 'BESCOM');
  });

  test('and the same file shared with no declared type reads identically', async () => {
    const db = await makeDb();
    const store = new DocumentStore({ db, transport: null });
    const { document, read } = await store.capture(
      fileOf(bill(), 'bescom.docx', 'application/octet-stream'),
      { title: 'bescom' },
    );
    assert.equal(read.kind, 'bill');
    assert.equal(document.expiresOn, '2026-10-18');
  });

  test('a plain text bill does too', async () => {
    const db = await makeDb();
    const store = new DocumentStore({ db, transport: null });
    const { document, read } = await store.capture(
      fileOf(enc('TATA POWER\nTotal Amount Rs. 1,880.00\nDue Date: 02/11/2026\n'),
        'tatapower.txt', 'text/plain'),
      { title: 'tata' },
    );
    assert.equal(read.kind, 'bill');
    assert.equal(document.expiresOn, '2026-11-02');
  });

  /*
   * The counterpart. Everything above would pass on a build that filed every
   * upload as read with invented fields.
   */
  test('a photograph is filed unread, and says nothing it does not know', async () => {
    const db = await makeDb();
    const store = new DocumentStore({ db, transport: null });
    const { document, read } = await store.capture(
      fileOf(enc('not really a jpeg'), 'scan.jpg', 'image/jpeg'),
      { title: 'scan' },
    );
    assert.equal(read, null);
    assert.equal(document.ocrText ?? '', '');
    assert.equal(document.expiresOn ?? '', '');
  });
});

/**
 * What a person calls a file.
 *
 * The rule — strip the extension — was written out at three call sites, while
 * a fourth passed the whole name through and a fifth had a different fallback
 * again. So a generated rent receipt was filed as **"Rent receipt
 * 2026-09.docx"** and everything a household uploaded was filed without its
 * extension, in the same list.
 *
 * Four copies of a rule and an exception is the shape this repository keeps
 * finding. These check the one definition, and the sweep below checks that it
 * stayed one.
 */
describe('a file name becomes a title', () => {
  test('the extension goes', () => {
    assert.equal(titleFromFileName('tatapower.txt'), 'tatapower');
    assert.equal(titleFromFileName('Rent receipt 2026-09.docx'), 'Rent receipt 2026-09');
  });

  test('a name without one is left alone', () => {
    assert.equal(titleFromFileName('bill'), 'bill');
  });

  test('a dot in a folder is not an extension', () => {
    // `\.[^.]+$` without the separator class turns `2026.tax/receipt` into
    // `2026`, losing the part that names the document.
    assert.equal(titleFromFileName('2026.tax/receipt'), '2026.tax/receipt');
  });

  test('a name that is all extension falls back rather than going blank', () => {
    assert.equal(titleFromFileName('.gitignore'), 'Document');
    assert.equal(titleFromFileName(''), 'Document');
    assert.equal(titleFromFileName(undefined), 'Document');
    // The caller chooses the words: a share says "Shared file", not "Document".
    assert.equal(titleFromFileName('', 'Shared file'), 'Shared file');
  });

  test('and nothing hand-writes the rule a second time', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const root = new URL('../js/', import.meta.url).pathname;

    const files = [];
    const walk = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    await walk(root);

    // The sweep is worth what it read.
    assert.ok(files.length >= 100, `only ${files.length} modules were swept`);

    const copies = [];
    for (const file of files) {
      if (file.endsWith(join('domain', 'filing.js'))) continue;
      /*
       * Read raw, comments and all.
       *
       * This stripped block comments first, with `\/\*[\s\S]*?\*\/` — and a
       * regex literal containing `*/`, which plenty do, closes a comment that
       * a real `/*` opened. The stripper swallowed the very line this looks
       * for, so the sweep searched a mangled file and reported nothing.
       *
       * It passed the mutation that re-added a hand-written strip, and was
       * caught only because that mutation was run. A comment writing the
       * pattern out is a restatement of the rule too, so counting one is not
       * a false positive worth mangling the source to avoid.
       */
      const text = await readFile(file, 'utf8');
      if (/replace\(\s*\/\\\.\[\^\.\]\+\$\//.test(text)) copies.push(file.slice(root.length));
    }
    assert.deep(copies, []);
  });
});
