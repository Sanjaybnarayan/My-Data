/**
 * The text inside a Word file, a spreadsheet, or a plain text file.
 *
 * `pdf-read.js` does this for PDFs and is six hundred lines of PDF. This is
 * the same job for the other formats a household actually uploads, and it is
 * short because **the hard parts already existed**:
 *
 * - `domain/docxtemplate.js` has unzipped `.docx` files and lifted their text
 *   runs since Phase 3, to fill in report templates.
 * - `data/pdf-read.js` owns the browser's `DecompressionStream`, exported as
 *   `inflate`, because a zip entry and a PDF stream are both deflate.
 *
 * Both were in the repository, exported and tested, while `canReadText` said
 * `application/pdf` and nothing else — so a household uploading a Word bill
 * had its due date read by nothing, and the picker offered `.docx` anyway.
 *
 * ## Pages, not a string
 *
 * Everything returns the shape `pdf-read.js` returns: `[{ lines: [...] }]`.
 * `domain/filing.js#indexableText` already knows how to flatten and cap that,
 * and one shape means `sync/drive.js` does not grow a branch per format.
 *
 * ## What is deliberately not here
 *
 * `.doc` and `.xls`, the pre-2007 binary formats. They are not zip archives
 * and nothing here can open them. `readerFor` returns `none` for both, so a
 * household is told the file was not read rather than having it filed as read
 * and empty.
 *
 * No OCR **here**. An image and a scanned PDF carry pictures of text, which is
 * a different job from parsing a file format — `js/core/ocr.js` does that one,
 * through a native recogniser, and this module never sees those bytes.
 */

import { unzip } from '../domain/docxtemplate.js';

/** `<w:t>` in Word, `<t>` in a spreadsheet's string table. */
function tagText(xml, tag) {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...String(xml).matchAll(pattern)].map((found) => unescapeXml(found[1]));
}

/**
 * The five XML entities, and numeric references.
 *
 * Left encoded, an amount written `Rs&#160;12,500` reaches the extractor with
 * a literal `&#160;` between the label and the number — which is six of the
 * forty characters `readAmount` is allowed to cross, and on a longer label
 * enough to lose the amount entirely.
 */
function unescapeXml(text) {
  return String(text)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Last, or it would turn `&amp;lt;` into `<`.
    .replace(/&amp;/g, '&');
}

const decode = (bytes) => new TextDecoder('utf-8').decode(bytes);

/**
 * A Word document's text, one line per paragraph.
 *
 * Split on `</w:p>` first. Word breaks a run wherever formatting changes, so
 * `Amount Payable` is routinely three `<w:t>` elements and a due date can be
 * split mid-number — joining every run in the file with spaces would put a gap
 * inside `12,500`. Within a paragraph the runs are concatenated with nothing
 * between them, which is what Word means by them.
 */
function wordLines(xml) {
  return String(xml)
    .split(/<\/w:p>/)
    .map((paragraph) => tagText(paragraph, 'w:t').join(''))
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * A spreadsheet's text, from its shared string table and any inline strings.
 *
 * Numbers live in the sheets as bare values with no label attached to them,
 * and a column of figures with no words is not something the extractor can
 * read a due date out of. The strings are where the labels are.
 */
function sheetLines(parts) {
  const lines = [];
  const shared = parts['xl/sharedStrings.xml'];
  if (shared) lines.push(...tagText(decode(shared), 't'));

  for (const [name, bytes] of Object.entries(parts)) {
    if (!/^xl\/worksheets\/.*\.xml$/.test(name)) continue;
    // `<is>` holds a string stored in the cell rather than pooled.
    for (const inline of String(decode(bytes)).matchAll(/<is>([\s\S]*?)<\/is>/g)) {
      lines.push(...tagText(inline[1], 't'));
    }
  }
  return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * The text in a `.docx` or `.xlsx`.
 *
 * @param {Uint8Array} bytes
 * @param {(raw: Uint8Array) => Promise<Uint8Array|null>} inflate injected the
 *   same way `docxtemplate.js` takes it — this file should not decide where
 *   the browser's decompression comes from.
 * @returns {Promise<Array<{lines: string[]}>>} empty when there is nothing to read
 */
export async function readOoxml(bytes, inflate) {
  const parts = await unzip(bytes, inflate);

  const document = parts['word/document.xml'];
  if (document) {
    const lines = wordLines(decode(document));
    return lines.length ? [{ lines }] : [];
  }

  if (parts['xl/sharedStrings.xml'] || Object.keys(parts).some((n) => n.startsWith('xl/worksheets/'))) {
    const lines = sheetLines(parts);
    return lines.length ? [{ lines }] : [];
  }

  // A zip that is neither. Returning nothing is the honest answer; guessing at
  // whichever XML is largest is how a document gets filed as read and empty.
  return [];
}

/**
 * The text in a `.txt`, `.csv`, `.md` or `.json`.
 *
 * @param {Uint8Array} bytes
 * @returns {Array<{lines: string[]}>}
 */
export function readPlain(bytes) {
  const lines = decode(bytes).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length ? [{ lines }] : [];
}
