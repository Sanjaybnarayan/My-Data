/**
 * PDF, written by hand.
 *
 * A PDF is a handful of objects, a cross-reference table and a trailer. The
 * fourteen core fonts are guaranteed present in every reader, so nothing has
 * to be embedded — which is what makes a dependency-free writer practical.
 *
 * The layout engine is deliberately narrow: a title block, headings,
 * paragraphs, key–value pairs, and tables that paginate with their header
 * repeated. That covers every report FamilyOS produces. Anything richer would
 * be a typesetting system, and a typesetting system is a library.
 *
 * Text is measured with real Helvetica advance widths, not a fixed
 * approximation, because a column of rupee figures that overflows its cell by
 * three characters looks broken in a way an estimate cannot fix.
 */

const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 48;

/* ------------------------------------------------------------- text width */

/**
 * Helvetica advance widths, in 1/1000 em, for the printable ASCII range.
 * From the Adobe Font Metrics for the core font — the same numbers every
 * reader uses to lay the text out.
 */
const HELVETICA = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD_FACTOR = 1.06; // Helvetica-Bold is fractionally wider

export function textWidth(text, size, { bold = false } = {}) {
  let total = 0;
  for (const char of String(text ?? '')) {
    const code = char.codePointAt(0);
    // Anything outside Latin-1 is rendered by the reader from a substitute;
    // 556 is Helvetica's average and keeps the layout sane.
    const advance = code >= 32 && code <= 126 ? HELVETICA[code - 32] : 556;
    total += advance;
  }
  return (total / 1000) * size * (bold ? BOLD_FACTOR : 1);
}

/** Break text into lines that fit `width`, breaking a too-long word if needed. */
export function wrap(text, width, size, options = {}) {
  const paragraphs = String(text ?? '').split('\n');
  const lines = [];

  for (const paragraph of paragraphs) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (textWidth(candidate, size, options) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);

      if (textWidth(word, size, options) <= width) {
        line = word;
      } else {
        // A registration number or a URL with no spaces still has to fit.
        let chunk = '';
        for (const char of word) {
          if (textWidth(chunk + char, size, options) > width) {
            lines.push(chunk);
            chunk = char;
          } else {
            chunk += char;
          }
        }
        line = chunk;
      }
    }
    lines.push(line);
  }
  return lines;
}

/* ----------------------------------------------------------------- escape */

function escapeText(text) {
  // Backslash first, or the escapes inserted after it get escaped again.
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // WinAnsi has no code point for these; a reader shows a blank box or a
    // wrong glyph, so they are transliterated rather than emitted raw.
    .replace(/₹/g, 'Rs.')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/[·•]/g, '-')
    // eslint-disable-next-line no-control-regex -- control characters break the stream
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[^\x20-\xff]/g, '?');
}

/* ------------------------------------------------------------------ pages */

class Page {
  constructor() {
    this.ops = [];
  }

  text(content, x, y, { size = 10, bold = false, colour = [0.09, 0.11, 0.13] } = {}) {
    this.ops.push(
      'BT',
      `/${bold ? 'F2' : 'F1'} ${size} Tf`,
      `${colour.map((c) => c.toFixed(3)).join(' ')} rg`,
      `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm`,
      `(${escapeText(content)}) Tj`,
      'ET',
    );
  }

  line(x1, y1, x2, y2, { width = 0.5, colour = [0.86, 0.88, 0.9] } = {}) {
    this.ops.push(
      `${colour.map((c) => c.toFixed(3)).join(' ')} RG`,
      `${width} w`,
      `${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`,
    );
  }

  rect(x, y, width, height, { fill = [0.96, 0.96, 0.97] } = {}) {
    this.ops.push(
      `${fill.map((c) => c.toFixed(3)).join(' ')} rg`,
      `${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`,
    );
  }

  get content() {
    return this.ops.join('\n');
  }
}

export class PdfDocument {
  #pages = [];
  #page = null;
  #y = 0;
  #title;
  #subtitle;
  #footer;

  constructor({ title = 'FamilyOS report', subtitle = '', footer = '' } = {}) {
    this.#title = title;
    this.#subtitle = subtitle;
    this.#footer = footer;
    this.#newPage();
  }

  get contentWidth() {
    return A4.width - MARGIN * 2;
  }

  #newPage() {
    this.#page = new Page();
    this.#pages.push(this.#page);
    this.#y = A4.height - MARGIN;

    if (this.#pages.length === 1) {
      this.#page.text(this.#title, MARGIN, this.#y, { size: 18, bold: true, colour: [0.1, 0.45, 0.91] });
      this.#y -= 20;
      if (this.#subtitle) {
        this.#page.text(this.#subtitle, MARGIN, this.#y, { size: 9, colour: [0.45, 0.48, 0.53] });
        this.#y -= 14;
      }
      this.#page.line(MARGIN, this.#y, A4.width - MARGIN, this.#y);
      this.#y -= 20;
    }
    return this.#page;
  }

  /** Reserve vertical space, starting a page when it will not fit. */
  #space(height) {
    if (this.#y - height < MARGIN + 28) this.#newPage();
    return this.#y;
  }

  heading(text, level = 1) {
    const size = level === 1 ? 13 : 11;
    this.#space(size + 14);
    this.#y -= level === 1 ? 6 : 2;
    this.#page.text(text, MARGIN, this.#y, { size, bold: true });
    this.#y -= size + 6;
    return this;
  }

  paragraph(text, { size = 10, gap = 6 } = {}) {
    for (const line of wrap(text, this.contentWidth, size)) {
      this.#space(size + 4);
      this.#page.text(line, MARGIN, this.#y, { size });
      this.#y -= size + 3;
    }
    this.#y -= gap;
    return this;
  }

  /** Label on the left, value right-aligned — the shape of every summary. */
  keyValue(pairs, { size = 10 } = {}) {
    for (const [label, value] of pairs) {
      this.#space(size + 6);
      this.#page.text(label, MARGIN, this.#y, { size, colour: [0.45, 0.48, 0.53] });
      const text = String(value ?? '');
      this.#page.text(text, A4.width - MARGIN - textWidth(text, size), this.#y, { size });
      this.#y -= size + 6;
    }
    this.#y -= 4;
    return this;
  }

  /**
   * @param {Array<{label: string, key: string, align?: 'left'|'right', width?: number}>} columns
   * @param {object[]} rows values already formatted as strings
   */
  table(columns, rows, { size = 9, rowHeight = 16 } = {}) {
    const total = columns.reduce((t, c) => t + (c.width ?? 1), 0);
    const widths = columns.map((c) => ((c.width ?? 1) / total) * this.contentWidth);

    const header = () => {
      this.#space(rowHeight * 2);
      this.#page.rect(MARGIN, this.#y - 4, this.contentWidth, rowHeight, { fill: [0.92, 0.95, 1] });
      let x = MARGIN;
      columns.forEach((column, i) => {
        const text = column.label;
        const at = column.align === 'right'
          ? x + widths[i] - textWidth(text, size, { bold: true }) - 6
          : x + 6;
        this.#page.text(text, at, this.#y, { size, bold: true, colour: [0.1, 0.38, 0.64] });
        x += widths[i];
      });
      this.#y -= rowHeight + 2;
    };

    header();

    for (const row of rows) {
      // A page break inside a table repeats the header; a continuation page
      // of unlabelled columns is unreadable.
      if (this.#y - rowHeight < MARGIN + 28) {
        this.#newPage();
        header();
      }

      let x = MARGIN;
      columns.forEach((column, i) => {
        let text = String(row[column.key] ?? '');
        const available = widths[i] - 12;
        if (textWidth(text, size) > available) {
          while (text.length > 1 && textWidth(`${text}...`, size) > available) {
            text = text.slice(0, -1);
          }
          text += '...';
        }
        const at = column.align === 'right'
          ? x + widths[i] - textWidth(text, size) - 6
          : x + 6;
        this.#page.text(text, at, this.#y, { size });
        x += widths[i];
      });

      this.#y -= rowHeight;
      this.#page.line(MARGIN, this.#y + rowHeight - 4, A4.width - MARGIN, this.#y + rowHeight - 4,
        { colour: [0.92, 0.93, 0.94] });
    }

    this.#y -= 10;
    return this;
  }

  spacer(height = 10) {
    this.#y -= height;
    return this;
  }

  /** @returns {Uint8Array} */
  build() {
    // Footers last, so every page knows the total.
    this.#pages.forEach((page, i) => {
      const label = `${this.#footer ? `${this.#footer}  ·  ` : ''}Page ${i + 1} of ${this.#pages.length}`;
      page.text(label, MARGIN, MARGIN - 14, { size: 8, colour: [0.6, 0.63, 0.67] });
      page.line(MARGIN, MARGIN - 4, A4.width - MARGIN, MARGIN - 4);
    });

    const objects = [];
    const add = (body) => {
      objects.push(body);
      return objects.length; // object numbers are 1-based
    };

    const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

    // The pages object needs its children's numbers, and they need its — so
    // its slot is reserved now and filled once they exist.
    const pagesId = add(null);

    const pageIds = this.#pages.map((page) => {
      const content = page.content;
      const streamId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesId} 0 R `
        + `/MediaBox [0 0 ${A4.width} ${A4.height}] `
        + `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> `
        + `/Contents ${streamId} 0 R >>`);
    });

    objects[pagesId - 1] = `<< /Type /Pages /Count ${pageIds.length} `
      + `/Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`;

    const catalogId = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const infoId = add(`<< /Title (${escapeText(this.#title)}) /Producer (FamilyOS) `
      + `/CreationDate (D:${pdfDate(new Date())}) >>`);

    let pdf = '%PDF-1.4\n';
    // A binary comment marks the file as binary for transfer agents that
    // would otherwise mangle line endings.
    pdf += '%\xE2\xE3\xCF\xD3\n';

    const offsets = [];
    for (const [i, body] of objects.entries()) {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    }

    const xrefAt = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\n`;
    pdf += `startxref\n${xrefAt}\n%%EOF\n`;

    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }
}

function pdfDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
