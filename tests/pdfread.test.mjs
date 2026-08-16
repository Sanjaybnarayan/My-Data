/**
 * Reading a PDF's pages.
 *
 * A real bank statement — thirty pages, 4,314 text-drawing operators — came
 * back from the reader as an empty document. Its pages said
 * `/Contents 141 0 R`, and object 141 was not a stream but an *array* of
 * three: `[ 139 0 R  10 0 R  140 0 R ]`. The reader handled an inline array
 * and a direct stream reference and not the indirection between them, so it
 * looked for a stream numbered 141, found none, and dropped every page.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { extract } from '../js/data/pdf-read.js';

setSuite('pdf reader');

/**
 * A minimal uncompressed PDF, so the fixture is readable.
 *
 * `contents` decides the shape under test: `direct` writes
 * `/Contents 4 0 R`; `indirect` writes `/Contents 6 0 R` with object 6 being
 * `[ 4 0 R ]`; `inline` writes `/Contents [ 4 0 R ]`.
 */
function pdf(lines, shape = 'direct') {
  const stream = `BT /F1 12 Tf 50 750 Td 14 TL\n${
    lines.map((l) => `(${l}) Tj T*`).join('\n')}\nET\n`;

  const contents = { direct: '4 0 R', inline: '[ 4 0 R ]', indirect: '6 0 R' }[shape];
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] `
      + `/Resources << /Font << /F1 5 0 R >> >> /Contents ${contents} >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '[ 4 0 R ]',
  ];

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new TextEncoder().encode(out);
}

const textOf = (result) => result.pages.flatMap((page) => page.lines ?? []).join(' ');

describe('where a page keeps its content', () => {
  test('a direct stream reference is read', async () => {
    const result = await extract(pdf(['Account Statement', 'Opening Balance']));
    assert.length(result.pages, 1);
    assert.includes(textOf(result), 'Account Statement');
  });

  test('an inline array of streams is read', async () => {
    const result = await extract(pdf(['Account Statement'], 'inline'));
    assert.length(result.pages, 1);
    assert.includes(textOf(result), 'Account Statement');
  });

  test('and a reference to an array of streams is too', async () => {
    // The shape that produced an empty thirty-page document.
    const result = await extract(pdf(['Account Statement', 'B/F 50087.53'], 'indirect'));

    assert.length(result.pages, 1);
    assert.includes(textOf(result), 'Account Statement');
    assert.includes(textOf(result), '50087.53');
  });
});

describe('when there is nothing to read', () => {
  test('bytes that are not a PDF give no pages rather than throwing', async () => {
    const result = await extract(new TextEncoder().encode('not a pdf at all'));
    assert.length(result.pages, 0);
  });
});

/**
 * How a page reaches its fonts.
 *
 * A scanned electricity bill came back as 2,718 characters of mojibake: the
 * text was there, every font carried a ToUnicode CMap, and the reader never
 * found one of them. Three separate things had to be true for that, and none
 * of them was covered by a test — fixing all three broke nothing.
 *
 *  1. `/Resources 3620 0 R`. The reader read `/Font << … >>` out of the page
 *     dictionary directly, so a page that refers to its resources instead of
 *     writing them out has no fonts at all. Adobe Scan writes the reference,
 *     which is what a household scanning a bill with a phone produces.
 *  2. `/C0_0 40 0 R`. Font names were matched with `[A-Za-z0-9]+`, which
 *     stops at the underscore in a name real producers use.
 *  3. `/Ft0 << /BaseFont … >>`. A font written into the page's own resources
 *     was never bound, and `<<([^>]*)>>` could not have read it if it were.
 *
 * With an Identity-H font, an unbound font is not a blank — it is two-byte
 * glyph indices passed through as though they were characters, which is
 * exactly the "plausible-looking gibberish" this reader's own header warns
 * about. So these assert the text, not merely that something was read.
 */

/** A ToUnicode CMap mapping CID 1, 2, 3… to the characters of `text`. */
function cmapFor(text) {
  const chars = [...text].map((ch, i) => `<${String(i + 1).padStart(4, '0')}> `
    + `<${ch.codePointAt(0).toString(16).padStart(4, '0').toUpperCase()}>`);
  return '/CIDInit /ProcSet findresource begin\n'
    + '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
    + `${chars.length} beginbfchar\n${chars.join('\n')}\nendbfchar\nend\n`;
}

/** The same text as the two-byte glyph indices the CMap above decodes. */
const cidsFor = (text) => [...text]
  .map((_, i) => String(i + 1).padStart(4, '0')).join('');

/**
 * A page drawn in a subset Identity-H font, reached the way the producer
 * under test reaches it.
 *
 * @param {string} text
 * @param {{resources?: 'inline'|'indirect', font?: 'indirect'|'inline',
 *          name?: string}} [shape]
 */
function scanned(text, { resources = 'indirect', font = 'indirect', name = 'C0_0' } = {}) {
  const stream = `BT /${name} 12 Tf 50 750 Td <${cidsFor(text)}> Tj ET\n`;
  const cmap = cmapFor(text);

  const fontBody = '<< /Type /Font /Subtype /Type0 /BaseFont /HWJOVJ+AcuminPro '
    + '/Encoding /Identity-H /ToUnicode 6 0 R >>';

  // The font is either an object of its own, or written into the resources.
  const fontDict = font === 'inline' ? `<< /${name} ${fontBody} >>` : `<< /${name} 5 0 R >>`;
  // A real producer puts an /XObject beside the /Font, and it nests — which
  // is what makes reading the dictionary by depth rather than by regex the
  // only thing that works.
  const resourceDict = `<< /XObject << /Im0 9 0 R >> /Font ${fontDict} /ProcSet [/PDF /Text] >>`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R '
      + `/Resources ${resources === 'inline' ? resourceDict : '7 0 R'} >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
    fontBody,
    `<< /Length ${cmap.length} >>\nstream\n${cmap}endstream`,
    resourceDict,
    '<< /Unused true >>',
    '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>',
  ];

  let out = '%PDF-1.5\n';
  objects.forEach((body, i) => { out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe('how a page reaches its fonts', () => {
  test('the fixture would show the failure: unbound, these are not characters', () => {
    // Guards the fixture itself. If the CIDs happened to be readable text,
    // every test below would pass with the fonts still unread.
    assert.equal(cidsFor('Net Payable').includes('Net'), false);
  });

  test('resources written into the page are read', async () => {
    const result = await extract(scanned('Net Payable', { resources: 'inline' }));
    assert.includes(textOf(result), 'Net Payable');
  });

  test('and resources the page only refers to are read too', async () => {
    // The shape that produced 2,718 characters of mojibake.
    const result = await extract(scanned('Due Date', { resources: 'indirect' }));
    assert.includes(textOf(result), 'Due Date');
  });

  test('a font dictionary the resources only refer to is followed', async () => {
    const bytes = scanned('Bill Period', { resources: 'indirect' })
      // `/Font << … >>` becomes `/Font 10 0 R`, the shape Adobe Scan writes.
      ;
    const source = new TextDecoder().decode(bytes)
      .replace('/Font << /C0_0 5 0 R >>', '/Font 10 0 R')
      .replace('trailer', '10 0 obj\n<< /C0_0 5 0 R >>\nendobj\ntrailer');
    const result = await extract(new TextEncoder().encode(source));
    assert.includes(textOf(result), 'Bill Period');
  });

  test('an underscore is part of a font name', async () => {
    // Isolated from the resources question: these are written into the page,
    // so only the name can be what fails.
    const result = await extract(scanned('Meter Reading', { resources: 'inline', name: 'C0_11' }));
    assert.includes(textOf(result), 'Meter Reading');
  });

  test('a font written into the page rather than referred to is bound', async () => {
    const result = await extract(scanned('Sanctioned Load', { font: 'inline' }));
    assert.includes(textOf(result), 'Sanctioned Load');
  });

  test('a nested dictionary does not truncate the one holding it', async () => {
    // `/Font << /Ft0 << … >> >>` — reading to the first `>>` stops inside the
    // font and loses the rest of the resources.
    const result = await extract(scanned('Arrears', { resources: 'inline', font: 'inline' }));
    assert.includes(textOf(result), 'Arrears');
  });
});
