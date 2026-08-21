/**
 * CSV.
 *
 * The simplest export and the one most likely to be opened in a spreadsheet,
 * which is exactly why the formula guard in `escapeCsv` matters: a payee
 * called `=HYPERLINK(...)` typed by anyone with access becomes a live formula
 * the moment the file is double-clicked.
 *
 * A byte-order mark is written by default. Without it Excel on Windows reads
 * UTF-8 as the local code page, and every ₹ and every name with an accent
 * comes out as mojibake.
 */

import { escapeCsv } from '../security/sanitize.js';
import { entity } from '../data/schema.js';
import { toMajor } from '../core/money.js';

const BOM = '﻿';

/**
 * @param {Array<{key: string, label: string, type?: string}>} columns
 * @param {object[]} rows
 * @param {{bom?: boolean, delimiter?: string}} [options]
 */
export function toCsv(columns, rows, { bom = true, delimiter = ',' } = {}) {
  const lines = [columns.map((c) => escapeCsv(c.label)).join(delimiter)];

  for (const row of rows) {
    lines.push(columns
      .map((column) => escapeCsv(formatCell(row[column.key], column)))
      .join(delimiter));
  }

  // CRLF: the line ending every spreadsheet application agrees on.
  return (bom ? BOM : '') + lines.join('\r\n') + '\r\n';
}

function formatCell(value, column) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  // Money leaves as a plain decimal number, not a formatted string: a column
  // of "₹1,200.00" cannot be summed in the spreadsheet it lands in.
  if (column.type === 'currency') return String(toMajor(value, column.currency ?? 'INR'));
  return String(value);
}

/** Columns for an entity, from the schema, excluding what should not leave. */
export function columnsFor(entityName, { includeEncrypted = false, only } = {}) {
  return entity(entityName).fields
    .filter((f) => !f.hidden)
    .filter((f) => includeEncrypted || !f.encrypted)
    .filter((f) => !only || only.includes(f.key))
    .map((f) => ({ key: f.key, label: f.label, type: f.type }));
}

/**
 * Parse a CSV back.
 *
 * Nothing in the application calls this. The comment here used to say it was
 * "used by the import path in Settings" — there is no import path in Settings,
 * and there never was. One test calls it, to check that what `toCsv` writes
 * can be read; no screen does.
 *
 * The rest of that comment was right, and was describing the application it
 * sat in without anyone noticing: an export nobody can read back is a backup
 * nobody has. FamilyOS can export forty-three files and restore none of them.
 * docs/PORTABILITY.md says so plainly, with what it would take to fix.
 *
 * It stays because the round-trip test is the only thing proving the writer
 * emits a CSV a spreadsheet will open, and because the restore that should
 * exist will need a reader.
 */
export function fromCsv(text, { delimiter = ',' } = {}) {
  const input = text.replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(field); field = ''; }
    else if (char === '\r') { /* handled by the \n that follows */ }
    else if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += char;
  }

  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
