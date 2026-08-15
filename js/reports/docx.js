/**
 * Word documents, written the same way the spreadsheets are.
 *
 * ## Why this is fifty lines and not a library
 *
 * A `.docx` is a ZIP of XML parts, exactly as an `.xlsx` is, and
 * `reports/xlsx.js` already carries a store-only ZIP writer for that reason.
 * So the whole of this file is: assemble four small XML parts, hand them to
 * `zip`, and be careful about escaping. No dependency, no build step, and
 * nothing a browser has to download before it can produce a document.
 *
 * It writes a deliberately small subset — headings, paragraphs, bold runs and a
 * two-column table of label and value. That is what a household document is:
 * a title, some facts, and somewhere to sign. Anything richer would be a word
 * processor, and this is a form filler.
 *
 * ## The escaping is the whole risk
 *
 * A tenant called *Ram & Co.* or an address containing `<` produces XML that
 * Word refuses to open — not a mangled document, a **corrupt** one, which is
 * the same class of bug the iCalendar writer had and is guarded the same way:
 * escape once, at the boundary, and test the characters that break it.
 */

import { zip } from './xlsx.js';

/** XML text. Ampersand first, or the escapes this adds are escaped again. */
function xml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * A run of text.
 *
 * `xml:space="preserve"` is not decoration: without it Word drops leading and
 * trailing spaces, so a label and its value run together.
 */
function run(text, { bold = false } = {}) {
  const properties = bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:r>${properties}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
}

function paragraph(runs, { style = '', align = '' } = {}) {
  const properties = style || align
    ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${align ? `<w:jc w:val="${align}"/>` : ''}</w:pPr>`
    : '';
  return `<w:p>${properties}${runs}</w:p>`;
}

/**
 * A document, from a small list of blocks.
 *
 * @param {Array<{type: string, text?: string, rows?: string[][]}>} blocks
 *   A table row is a label and a value; only the first two cells are read, and
 *   the looser type is what callers building rows inline actually produce.
 * @param {{title?: string, at?: Date}} [options]
 */
export function docx(blocks, { title = 'Document', at = new Date() } = {}) {
  const body = (blocks ?? []).map((block) => {
    if (block.type === 'heading') {
      return paragraph(run(block.text, { bold: true }), { style: 'Heading1', align: 'center' });
    }
    if (block.type === 'subheading') {
      return paragraph(run(block.text, { bold: true }), { style: 'Heading2' });
    }
    if (block.type === 'table') {
      const rows = (block.rows ?? []).map(([label, value]) => `<w:tr>
        <w:tc><w:tcPr><w:tcW w:w="3200" w:type="dxa"/></w:tcPr>${paragraph(run(label, { bold: true }))}</w:tc>
        <w:tc><w:tcPr><w:tcW w:w="5800" w:type="dxa"/></w:tcPr>${paragraph(run(value))}</w:tc>
      </w:tr>`).join('');
      return `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>
        <w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((side) => `<w:${side} w:val="single" w:sz="4" w:color="999999"/>`).join('')}
        </w:tblBorders></w:tblPr>${rows}</w:tbl>`;
    }
    // A blank paragraph is how a Word document leaves room to sign. There is no
    // other way to say "space here" in this subset, and a signature line that
    // is not there is the one thing this kind of document needs most.
    if (block.type === 'space') return paragraph('');
    return paragraph(run(block.text ?? ''));
  }).join('');

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;

  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/"
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xml(title)}</dc:title>
<dcterms:created xsi:type="dcterms:W3CDTF">${at.toISOString().replace(/\.\d{3}/, '')}</dcterms:created>
</cp:coreProperties>`;

  return zip([
    // `[Content_Types].xml` must be the first entry: some readers, Word among
    // them, look for it at the start rather than through the central directory.
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: 'word/document.xml', data: document },
    { name: 'docProps/core.xml', data: core },
  ], { at });
}
