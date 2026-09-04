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
      .map((column) => cell(row[column.key], column))
      .join(delimiter));
  }

  // CRLF: the line ending every spreadsheet application agrees on.
  return (bom ? BOM : '') + lines.join('\r\n') + '\r\n';
}

/** A value that is a number and nothing else — no sign of a formula in it. */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One cell, guarded unless it is a number.
 *
 * `escapeForSheet` prefixes an apostrophe onto anything starting with an
 * equals, a plus, a minus or an at-sign — written out because a bare `@` in a
 * JSDoc block is read as a tag and the type checker stops on it. That is what
 * stops a payee called `=HYPERLINK(...)` becoming a live formula. It also caught every negative amount, and that quietly cost
 * more than it protected: `'-3258000` is *text* in a spreadsheet, `SUM()`
 * skips text, and a household exporting their accounts to see where they stood
 * got a total with every debt missing from it. No error, no empty cell — a
 * plausible number that was too big.
 *
 * Measured on three accounts, one positive and two overdrawn: the column
 * summed to the positive one alone.
 *
 * So a column the schema types `currency` or `number` skips the guard — but
 * only when the value really is one, tested here rather than assumed from the
 * column. A leading minus in a number is a sign, not an operator, and there is
 * no formula to be had from digits. Anything else in a numeric column, and
 * every text column, is guarded exactly as before: that is where the attack
 * lives, and this file's own reason for existing says the money must still add
 * up when it gets there.
 */
function cell(value, column) {
  const text = formatCell(value, column);
  const numeric = column.type === 'currency' || column.type === 'number';
  return numeric && PLAIN_NUMBER.test(text) ? text : escapeCsv(text);
}

function formatCell(value, column) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join('; ');
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  // Money leaves as a plain decimal number, not a formatted string: a column
  // of "₹1,200.00" cannot be summed in the spreadsheet it lands in.
  //
  // An amount that is not a number leaves as *itself*. `toMajor` returns NaN
  // for the hand-edited cell `domain/amounts.js` is written about, and `NaN`
  // in a household's export tells them nothing about what is in their sheet —
  // where the actual text, "twenty thousand", tells them exactly what to go
  // and fix. It gets the formula guard on the way out like any other text.
  if (column.type === 'currency') {
    const major = toMajor(value, column.currency ?? 'INR');
    return Number.isFinite(major) ? String(major) : String(value);
  }
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
