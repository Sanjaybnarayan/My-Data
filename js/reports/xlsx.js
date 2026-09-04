/**
 * XLSX, written by hand.
 *
 * An .xlsx file is a ZIP of XML parts. Both halves are small enough to write
 * directly, and a spreadsheet library is one of the largest dependencies a web
 * application can take on — for an app whose whole premise is that it works
 * offline with nothing fetched, that trade is not close.
 *
 * The ZIP is stored, not deflated. The XML compresses well, but `DeflateRaw`
 * is not available synchronously in a browser and the alternative is either a
 * bundled compressor or an async API threaded through every caller. A
 * ten-thousand-row export is a few megabytes uncompressed, which is a file
 * that opens instantly from local disk.
 *
 * What is produced: one sheet per section, a bold frozen header row, real
 * numbers and real dates (not text that looks like them), currency formatted
 * in the workbook rather than baked into strings, and column widths that fit.
 */

import { escapeXml } from '../security/sanitize.js';
import { toMajor } from '../core/money.js';

/* --------------------------------------------------------------- ZIP part */

function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

const encoder = new TextEncoder();

function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

/**
 * Minimal store-only ZIP. Local headers, then a central directory, then the
 * end-of-central-directory record — the three structures every reader needs.
 */
export function zip(files, { at = new Date() } = {}) {
  const { time, day } = dosDateTime(at);
  const locals = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = typeof file.data === 'string' ? encoder.encode(file.data) : file.data;
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);      // version needed
    local.setUint16(6, 0, true);       // flags
    local.setUint16(8, 0, true);       // method 0 = stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);      // extra field length

    locals.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);        // version made by
    dir.setUint16(6, 20, true);        // version needed
    dir.setUint16(8, 0, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint32(42, offset, true);

    central.push(new Uint8Array(dir.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  const parts = [...locals, ...central, new Uint8Array(end.buffer)];
  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

/* ------------------------------------------------------------ spreadsheet */

/** Excel counts days from 1900, and believes 1900 was a leap year. */
export function excelSerialDate(day) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''));
  if (!match) return null;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  // 25569 = days between 1900-01-01 (serial 1, with the phantom leap day) and
  // the Unix epoch. Subtracting it is the whole conversion.
  return utc / 86_400_000 + 25569;
}

function columnName(index) {
  let name = '';
  let n = index;
  while (n >= 0) {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  }
  return name;
}

/** Number formats, indexed by the order they appear in `styles.xml`. */
const STYLE = { plain: 0, header: 1, currency: 2, date: 3, percent: 4 };

function styleFor(column) {
  if (column.type === 'currency') return STYLE.currency;
  if (column.type === 'date') return STYLE.date;
  if (column.type === 'percent') return STYLE.percent;
  return STYLE.plain;
}

function cellXml(reference, value, column) {
  const style = styleFor(column);

  if (value === null || value === undefined || value === '') {
    return `<c r="${reference}" s="${style}"/>`;
  }

  if (column.type === 'currency') {
    // A numeric cell whose `<v>` is not a number is not a valid sheet. The
    // hand-edited amount `domain/amounts.js` is written about makes `toMajor`
    // return NaN, and `<v>NaN</v>` was written straight into the archive —
    // measured: one such row put `NaN` in the sheet XML of a 4,708-byte file.
    //
    // So it falls through to the text branch below, exactly as the CSV export
    // does, and the household sees what is actually in their sheet instead of
    // an export they cannot open.
    const major = toMajor(value, column.currency ?? 'INR');
    if (Number.isFinite(major)) {
      return `<c r="${reference}" s="${style}"><v>${major}</v></c>`;
    }
  }
  if (column.type === 'date') {
    const serial = excelSerialDate(value);
    return serial === null
      ? `<c r="${reference}" s="${STYLE.plain}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`
      : `<c r="${reference}" s="${style}"><v>${serial}</v></c>`;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${style}"><v>${value}</v></c>`;
  }
  if (typeof value === 'boolean') {
    return `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${value ? 'yes' : 'no'}</t></is></c>`;
  }

  const text = Array.isArray(value) ? value.join('; ') : String(value);
  // Inline strings rather than a shared-string table: one less part to keep
  // consistent, and the size difference only matters when values repeat.
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function sheetXml(sheet) {
  const { columns, rows } = sheet;

  const widths = columns.map((column, i) => {
    const longest = rows.reduce((max, row) => {
      const value = row[column.key];
      const length = value === null || value === undefined ? 0 : String(value).length;
      return Math.max(max, length);
    }, column.label.length);
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(48, Math.max(10, longest + 3))}" customWidth="1"/>`;
  }).join('');

  const header = `<row r="1">${columns
    .map((column, i) => `<c r="${columnName(i)}1" s="${STYLE.header}" t="inlineStr">`
      + `<is><t>${escapeXml(column.label)}</t></is></c>`)
    .join('')}</row>`;

  const body = rows.map((row, r) => `<row r="${r + 2}">${columns
    .map((column, i) => cellXml(`${columnName(i)}${r + 2}`, row[column.key], column))
    .join('')}</row>`).join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0">`
    // Freezing the header is the difference between a usable export and a
    // thousand rows with no idea which column is which.
    + `<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>`
    + `</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${widths}</cols>
<sheetData>${header}${body}</sheetData>
<autoFilter ref="A1:${columnName(columns.length - 1)}${rows.length + 1}"/>
</worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2">
<numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="dd\\ mmm\\ yyyy"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF1A73E8"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFEAF2FE"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
</styleSheet>`;

/** Sheet names Excel will accept: 31 characters, none of `[]:*?/\`. */
export function safeSheetName(name, taken = new Set()) {
  let clean = String(name ?? 'Sheet').replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Sheet';
  let candidate = clean;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = clean.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * @param {Array<{name: string, columns: Array<{key,label,type}>, rows: object[]}>} sheets
 * @param {{title?: string, at?: Date}} [meta]
 * @returns {Uint8Array}
 */
export function toXlsx(sheets, meta = {}) {
  if (!sheets.length) throw new Error('a workbook needs at least one sheet');

  const taken = new Set();
  const named = sheets.map((sheet) => ({ ...sheet, name: safeSheetName(sheet.name, taken) }));

  const files = [
    {
      name: '[Content_Types].xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${named.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`,
    },
    {
      name: '_rels/.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${named.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${named.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${named.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...named.map((sheet, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: sheetXml(sheet),
    })),
  ];

  return zip(files, { at: meta.at });
}
