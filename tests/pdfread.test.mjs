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
