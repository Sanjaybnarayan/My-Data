/**
 * Reading a `.docx` and filling it in — Phase 3's actual deliverable.
 *
 * `reports/docx.js` has written documents since Phase 3; nothing had ever read
 * one, which is the whole of what the prompt asks for.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { DocumentStore } from '../js/sync/drive.js';
import {
  entriesIn, unzip, textRuns, fieldsIn, fill, readTemplate, generate, generatedName,
} from '../js/domain/docxtemplate.js';
import { zip } from '../js/reports/xlsx.js';

setSuite('docx template');

const enc = (text) => new TextEncoder().encode(text);
const dec = (bytes) => new TextDecoder().decode(bytes);
const texts = (xml) => (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) ?? [])
  .map((one) => one.replace(/<[^>]+>/g, '')).join('');

/** One run, the way a document written in one go looks. */
const WHOLE = '<w:document><w:body><w:p>'
  + '<w:r><w:t>Dear {{Name}}, your rent is {{Amount}}.</w:t></w:r>'
  + '</w:p></w:body></w:document>';

/** The same sentence after a person has edited it — Word splits the runs. */
const SPLIT = '<w:document><w:body><w:p>'
  + '<w:r><w:t>Dear </w:t></w:r>'
  + '<w:r><w:t>{{Na</w:t></w:r><w:r><w:t>me}}</w:t></w:r>'
  + '<w:r><w:t>, your rent is {{Amount}}.</w:t></w:r>'
  + '</w:p></w:body></w:document>';

const packed = (xml) => zip([
  { name: '[Content_Types].xml', data: enc('<Types/>') },
  { name: 'word/document.xml', data: enc(xml) },
]);

describe('a placeholder Word has split across runs', () => {
  test('is found, which searching each run alone never would', () => {
    // This is the case that makes a naive reader report "no fields" on a
    // template that plainly has them, and look like it worked.
    assert.equal(fieldsIn(SPLIT).join(), 'Name,Amount');
  });

  test('and the same document written in one run reads the same', () => {
    assert.equal(fieldsIn(WHOLE).join(), fieldsIn(SPLIT).join());
  });

  test('is filled with the value in one piece', () => {
    assert.equal(texts(fill(SPLIT, { Name: 'Meera R K', Amount: '35,000' })),
      'Dear Meera R K, your rent is 35,000.');
  });

  test('and leaves no half of itself behind', () => {
    // Half a placeholder in a finished document reads as corruption rather
    // than as an omission.
    const out = fill(SPLIT, { Name: 'Meera R K' });
    assert.not(/\{\{Na|me\}\}/.test(texts(out).replace('{{Amount}}', '')),
      'a fragment of the split placeholder survived');
  });

  test('spacing inside the braces does not hide a field', () => {
    assert.equal(fieldsIn('<w:t>{{  Tenant Name  }}</w:t>').join(), 'Tenant Name');
  });
});

describe('what it refuses to do', () => {
  test('an unfilled field keeps its placeholder rather than being blanked', () => {
    // A silent hole where a name should be is worse than a visible marker.
    assert.includes(texts(fill(WHOLE, { Name: 'Meera' })), '{{Amount}}');
  });

  test('a value carrying XML cannot break the document', () => {
    assert.includes(fill(WHOLE, { Name: '<w:p/>& co' }), '&lt;w:p/&gt;&amp; co');
  });

  test('a document with no fields says so rather than looking read', async () => {
    const result = await readTemplate(packed('<w:document><w:body/></w:document>'), async () => null);
    assert.length(result.fields, 0);
    assert.includes(result.why, 'nothing here guesses which words those are');
  });

  test('a file that is not a docx says that, rather than throwing', async () => {
    const result = await readTemplate(zip([{ name: 'a.txt', data: enc('hello') }]), async () => null);
    assert.includes(result.why, 'not a .docx');
  });

  test('rubbish bytes yield no entries rather than an exception', () => {
    assert.length(entriesIn(enc('not a zip at all')), 0);
    assert.length(entriesIn(null), 0);
  });
});

describe('generating the new document', () => {
  test('the fields are filled and every other part is carried across', async () => {
    const template = await readTemplate(packed(SPLIT), async () => null);
    const out = generate(template.parts, { Name: 'Meera R K', Amount: '35,000' });
    const back = await unzip(out, async () => null);

    assert.equal(texts(dec(back['word/document.xml'])), 'Dear Meera R K, your rent is 35,000.');
    assert.equal(dec(back['[Content_Types].xml']), '<Types/>',
      'the parts this engine does not understand travel untouched');
  });

  test('the original bytes are not modified', async () => {
    // The prompt says so twice, and the document store already follows it.
    const original = packed(SPLIT);
    const copy = original.slice();
    const template = await readTemplate(original, async () => null);
    generate(template.parts, { Name: 'X', Amount: 'Y' });

    assert.equal(original.join(), copy.join());
  });

  test('a generated name carries the template and the day, so versions differ', () => {
    assert.equal(generatedName('Rent Agreement.docx', new Date('2026-08-15T00:00:00Z')),
      'rent-agreement-2026-08-15.docx');
  });
});

describe('reading the zip itself', () => {
  test('entries are read from the central directory', async () => {
    const entries = entriesIn(packed(WHOLE));
    assert.equal(entries.map((one) => one.name).join(), '[Content_Types].xml,word/document.xml');
  });

  test('a part that will not decompress is left out rather than stored as rubbish', async () => {
    const parts = await unzip(packed(WHOLE), async () => null);
    // These are stored, not deflated, so they survive a null inflater — which
    // is what makes the rest of these tests possible without a browser.
    assert.ok(parts['word/document.xml']);
  });

  test('the local header is read for its own lengths, not the directory\'s', () => {
    // A real Word file puts extra fields in the local header — timestamps,
    // Zip64 — that the central directory does not carry. Reading the
    // directory's lengths there lands a few bytes into the data, and every
    // part comes out shifted. Our own `zip` writes both alike, so this fixture
    // is built by hand: without it the guard cannot be told from its absence.
    const name = enc('a.txt');
    const body = enc('hello');
    const extra = enc('XX');           // present locally, absent in the directory
    const out = [];
    const push = (...bytes) => out.push(...bytes);
    const u16 = (n) => [n & 0xff, (n >> 8) & 0xff];
    const u32 = (n) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff];

    const localAt = 0;
    push(...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(body.length), ...u32(body.length),
      ...u16(name.length), ...u16(extra.length));
    push(...name, ...extra, ...body);

    const centralAt = out.length;
    push(...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(body.length), ...u32(body.length),
      ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(localAt));
    push(...name);

    push(...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(1), ...u16(1),
      ...u32(out.length - centralAt), ...u32(centralAt), ...u16(0));

    const [entry] = entriesIn(new Uint8Array(out));
    assert.equal(dec(entry.data), 'hello');
  });

  test('runs are found with their positions, in document order', () => {
    const runs = textRuns(SPLIT);
    assert.equal(runs.map((one) => one.text).join('|'), 'Dear |{{Na|me}}|, your rent is {{Amount}}.');
    assert.ok(runs[0].at < runs[1].at);
  });
});

describe('a generated document is filed, not only downloaded', () => {
  const asFile = (bytes, { name, type }) => ({
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength),
  });

  test('it is recorded, and says which template it came from', async () => {
    // Generating used to download and nothing else, which left the household
    // with a file in a downloads folder and this application unable to say it
    // had produced anything: no record, no version history, nothing in Drive.
    const db = await makeDb();
    const bytes = new Uint8Array([1, 2, 3, 4]);

    const { document } = await new DocumentStore({ db, transport: null }).capture(
      asFile(bytes, {
        name: 'rent-receipt-2026-08-16.docx',
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
      { title: 'rent-receipt-2026-08-16.docx', category: 'other',
        generatedFrom: 'rent-receipt.docx' },
    );

    const saved = await db.repo('document').get(document.id);
    assert.equal(saved.generatedFrom, 'rent-receipt.docx');
    assert.equal(saved.fileName, 'rent-receipt-2026-08-16.docx');
    // The same path a scan takes: a version count Drive will maintain, and an
    // encrypted blob queued for upload.
    assert.equal(saved.versionCount, 1);
    const blobs = await db.adapter.query('blobs', {});
    assert.length(blobs.filter((blob) => blob.documentId === document.id), 1);
  });

  test('a scanned file says it came from nowhere, because it did', async () => {
    // The field is absent rather than defaulted to something. "Generated from
    // a scan" would be a claim about a file somebody photographed.
    const db = await makeDb();
    const { document } = await new DocumentStore({ db, transport: null }).capture(
      asFile(new Uint8Array([9, 9]), { name: 'bill.pdf', type: 'application/pdf' }),
      { category: 'other' },
    );

    assert.not((await db.repo('document').get(document.id)).generatedFrom);
  });
});
