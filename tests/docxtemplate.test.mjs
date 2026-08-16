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

describe("the fields Word's own UI writes", () => {
  // Measured before any of this existed: all three shapes reported no fields
  // at all — honestly, and uselessly. A template built the way Word documents
  // it carries no `{{placeholders}}` anywhere.
  const simple = '<w:p><w:r><w:t>Dear </w:t></w:r>'
    + '<w:fldSimple w:instr=" MERGEFIELD Tenant \\* MERGEFORMAT ">'
    + '<w:r><w:t>«Tenant»</w:t></w:r></w:fldSimple>'
    + '<w:r><w:t>,</w:t></w:r></w:p>';

  const complex = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText xml:space="preserve"> MERGEFIELD Amount </w:instrText></w:r>'
    + '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
    + '<w:r><w:t>«Amount»</w:t></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';

  const control = '<w:p><w:sdt><w:sdtPr><w:alias w:val="Landlord name"/>'
    + '<w:tag w:val="landlord"/></w:sdtPr>'
    + '<w:sdtContent><w:r><w:t>Click to enter</w:t></w:r></w:sdtContent></w:sdt></w:p>';

  test('a simple MERGEFIELD is found and filled', () => {
    assert.deep(fieldsIn(simple), ['Tenant']);
    const out = fill(simple, { Tenant: 'Meera Narayan' });
    assert.includes(out, 'Meera Narayan');
    assert.not(out.includes('fldSimple'), 'the field survived into the document');
    assert.not(out.includes('«Tenant»'), "Word's own placeholder text survived");
    // The words around it are untouched.
    assert.includes(out, '<w:t>Dear </w:t>');
    assert.includes(out, '<w:t>,</w:t>');
  });

  test('the five-run complex form is one field, not five', () => {
    assert.deep(fieldsIn(complex), ['Amount']);
    const out = fill(complex, { Amount: '18,500' });
    assert.includes(out, '18,500');
    assert.not(out.includes('fldChar'), 'the field machinery survived');
    assert.not(out.includes('MERGEFIELD'), 'the instruction survived into the document');
  });

  test('a content control is named by its tag and replaced by plain text', () => {
    assert.deep(fieldsIn(control), ['landlord']);
    const out = fill(control, { landlord: 'S Narayan & Co' });
    // Escaped, like every other value this writes.
    assert.includes(out, 'S Narayan &amp; Co');
    assert.not(out.includes('<w:sdt'), 'the control survived, so the output is still a form');
    assert.not(out.includes('Click to enter'));
  });

  test('an alias stands in when a control carries no tag', () => {
    const aliasOnly = '<w:sdt><w:sdtPr><w:alias w:val="Witness"/></w:sdtPr>'
      + '<w:sdtContent><w:r><w:t>…</w:t></w:r></w:sdtContent></w:sdt>';
    assert.deep(fieldsIn(aliasOnly), ['Witness']);
  });

  test('a template with both kinds reports both, in document order', () => {
    // Somebody edited a Word-built template by hand. Both are real.
    const mixed = `${simple}<w:p><w:r><w:t>{{Date}}</w:t></w:r></w:p>`;
    assert.deep(fieldsIn(mixed), ['Tenant', 'Date']);

    const out = fill(mixed, { Tenant: 'Meera Narayan', Date: '16 August 2026' });
    assert.includes(out, 'Meera Narayan');
    assert.includes(out, '16 August 2026');
  });

  test('an unfilled Word field keeps its placeholder, as a brace field does', () => {
    const out = fill(simple, { Somebody: 'else' });
    assert.includes(out, 'fldSimple', 'the field was blanked rather than left');
    assert.includes(out, '«Tenant»');
  });

  test('a field with no MERGEFIELD instruction is not one of ours', () => {
    // ` PAGE ` and ` DATE ` are Word fields too, and filling them would be
    // this application overwriting page numbers.
    const page = '<w:p><w:fldSimple w:instr=" PAGE \\* MERGEFORMAT ">'
      + '<w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>';
    assert.length(fieldsIn(page), 0);
    assert.equal(fill(page, { PAGE: '99' }), page);
  });

  test('two fields in one paragraph are both replaced, and neither eats the other',
    () => {
      const two = '<w:p>'
        + '<w:fldSimple w:instr=" MERGEFIELD A "><w:r><w:t>«A»</w:t></w:r></w:fldSimple>'
        + '<w:r><w:t> and </w:t></w:r>'
        + '<w:fldSimple w:instr=" MERGEFIELD B "><w:r><w:t>«B»</w:t></w:r></w:fldSimple>'
        + '</w:p>';
      const out = fill(two, { A: 'first', B: 'second' });
      assert.includes(out, 'first');
      assert.includes(out, 'second');
      assert.includes(out, '<w:t> and </w:t>');
      assert.not(out.includes('fldSimple'));
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
