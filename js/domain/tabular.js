/**
 * Statements that arrive as a table instead of a page.
 *
 * ## Why bother, when the PDF reader works
 *
 * Because a PDF is a picture of a table and a CSV is the table. The PDF
 * reader has to find the columns by where the ink landed, decide which
 * fragments continue the line above, and check its arithmetic against the
 * printed balance because any of that could be wrong. None of those failure
 * modes exist here: the bank has already told you which value is the
 * withdrawal. Every bank that gives a PDF also offers CSV or XLS, and for a
 * household with several accounts that is the difference between an import
 * that works and one that needs a look every month.
 *
 * ## And why credit cards need it
 *
 * A card statement has no running balance — there is no account balance to
 * run. It has a purchase column and a payment column, and the sign convention
 * is the opposite of a bank's: a purchase *increases* what you owe. Every
 * assumption the bank-statement parser makes about balances is wrong here,
 * which is why card statements were not supported at all.
 *
 * So the direction comes from the header the bank wrote, not from arithmetic:
 * whichever column a figure is under is what it is. That is the same principle
 * the column-geometry PDF parser uses, with the geometry step removed because
 * a table does not need it.
 *
 * The output is the shape `domain/import.js` already expects, so a CSV import
 * is the same categorisation, the same fingerprint deduplication and the same
 * review step as a PDF.
 */

/**
 * Header words, per field. First match wins, so put the specific ones first.
 *
 * @type {[string, RegExp][]}
 */
const HEADERS = [
  ['date', /^(?:transaction |txn |value |posting |post )?date\b|^date of transaction/i],
  ['valueDate', /^value date/i],
  ['description', /^(?:transaction |txn )?(?:description|narration|particulars|details|remarks|merchant)/i],
  ['reference', /^(?:chq|cheque|ref(?:erence)?|utr|transaction id|txn id)\b/i],
  // Before the single-direction columns, and deliberately: a "Debit/Credit"
  // heading begins with the word "debit", so a withdrawal pattern checked
  // first would claim it and the direction would be read out of a column
  // holding the letters DR and CR.
  ['type', /^(?:type|transaction type|(?:dr|debit)\s*[/|]\s*(?:cr|credit)|(?:cr|credit)\s*[/|]\s*(?:dr|debit)|indicator)\b/i],
  ['withdrawal', /^(?:withdrawal|debit|dr|paid out|money out|purchase|spends?)\b|\(dr\.?\)/i],
  ['deposit', /^(?:deposit|credit|cr|paid in|money in|payment|receipts?)\b|\(cr\.?\)/i],
  ['amount', /^(?:amount|transaction amount|amt)\b/i],
  ['balance', /^(?:balance|closing balance|running balance|available balance)\b/i],
];

/** A row that could be a heading needs at least this much of one. */
const ENOUGH = ['date', 'description'];

/**
 * Split a delimited file into rows of cells.
 *
 * Written out rather than split on commas because a narration containing a
 * comma inside quotes is not two fields, and "MERCHANT, MUMBAI" is how half of
 * them are written.
 */
export function parseDelimited(text, delimiter = '') {
  const source = String(text ?? '').replace(/^﻿/, '');
  const sep = delimiter || sniff(source);

  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const character = source[i];

    if (quoted) {
      if (character !== '"') { field += character; continue; }
      // A doubled quote inside a quoted field is one literal quote.
      if (source[i + 1] === '"') { field += '"'; i += 1; continue; }
      quoted = false;
      continue;
    }

    if (character === '"') { quoted = true; continue; }
    if (character === sep) { row.push(field.trim()); field = ''; continue; }

    if (character === '\n' || character === '\r') {
      if (character === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field.trim());
      field = '';
      // Blank lines separate the header block from the table in most exports.
      if (row.some(Boolean)) rows.push(row);
      row = [];
      continue;
    }

    field += character;
  }

  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

/**
 * Which delimiter this file uses.
 *
 * Counted outside quotes on the busiest line rather than the first, because
 * the first line of a bank export is usually a title with no delimiters at all.
 */
function sniff(source) {
  const lines = source.split(/\r?\n/).slice(0, 40);
  let best = ',';
  let most = 0;

  for (const candidate of [',', '\t', ';', '|']) {
    const count = Math.max(...lines.map((line) => outsideQuotes(line, candidate)), 0);
    if (count > most) { most = count; best = candidate; }
  }
  return best;
}

function outsideQuotes(line, character) {
  let quoted = false;
  let count = 0;
  for (const c of line) {
    if (c === '"') quoted = !quoted;
    else if (c === character && !quoted) count += 1;
  }
  return count;
}

/**
 * Find the heading row and what each column means.
 *
 * A bank export begins with a block of account details before the table
 * starts, so the heading is not row zero and cannot be assumed to be. It is
 * the first row that names both a date and a description — anything less is
 * not a table this can read, and guessing at it would produce transactions out
 * of an address.
 */
export function detectHeader(rows, { card = false } = {}) {
  for (let index = 0; index < Math.min(rows.length, 60); index += 1) {
    const columns = {};

    rows[index].forEach((cell, position) => {
      for (const [field, pattern] of HEADERS) {
        if (columns[field] === undefined && pattern.test(cell.trim())) {
          columns[field] = position;
          return;
        }
      }
    });

    if (ENOUGH.every((field) => columns[field] !== undefined)
      // Either separate in/out columns, or one amount column with a direction
      // beside it. One amount column and nothing else cannot be read.
      && (columns.withdrawal !== undefined || columns.deposit !== undefined
        || (columns.amount !== undefined && columns.type !== undefined)
        // On a card, one amount column is enough: there is no balance to run
        // and the sign convention is fixed — a purchase is money out. On a
        // bank statement the same layout is genuinely ambiguous.
        || (card && columns.amount !== undefined))) {
      return { row: index, columns };
    }
  }
  return null;
}

/**
 * An amount as a bank writes it.
 *
 * `1,23,456.78` is the Indian grouping and is the common case here. A trailing
 * or leading `Dr`/`Cr` is a direction, not part of the number, and a figure in
 * brackets is negative — which some exports use instead of a minus sign.
 */
export function readAmount(cell) {
  const text = String(cell ?? '').trim();
  if (!text) return null;

  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  const digits = text.replace(/[()]/g, '').replace(/\b[dc]r\.?\b/gi, '')
    .replace(/[₹$,\s]/g, '').replace(/^-/, '');

  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const minor = Math.round(Number(digits) * 100);
  return negative ? -minor : minor;
}

/** The direction words a `type` column uses, whichever way round it writes them. */
function directionOf(cell) {
  const text = String(cell ?? '').trim().toLowerCase();
  if (/^(dr|debit|withdrawal|w|d)\b|paid out/.test(text)) return 'out';
  if (/^(cr|credit|deposit|c)\b|paid in/.test(text)) return 'in';
  return null;
}

/**
 * A date, in whichever of the four shapes an export uses.
 *
 * Day-first is assumed for the ambiguous `01/02/2026`, because every Indian
 * bank writes day-first and none of them writes month-first. A four-digit
 * leading group is a year and is checked first so an ISO date is not read
 * backwards.
 */
export function readDate(cell) {
  const text = String(cell ?? '').trim();

  const iso = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/.exec(text);
  if (iso) return pad(iso[1], iso[2], iso[3]);

  const named = /\b(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/](\d{2,4})\b/.exec(text);
  if (named) {
    const month = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) + 1;
    if (month) return pad(century(named[3]), month, named[1]);
  }

  const dmy = /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/.exec(text);
  if (dmy) return pad(century(dmy[3]), dmy[2], dmy[1]);

  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const century = (year) => (String(year).length === 2 ? `20${year}` : String(year));
const pad = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/**
 * Read a delimited statement into the shape the importer already takes.
 *
 * @param {string} text the file
 * @param {{card?: boolean}} [options] a card statement has no running balance
 *   and inverts the sign: a purchase increases what is owed
 */
export function parseTable(text, options = {}) {
  const rows = parseDelimited(text);
  const header = detectHeader(rows, options);

  if (!header) {
    return {
      transactions: [], problems: [], account: {}, mode: 'table',
      openingBalance: null, closingBalance: null,
      error: 'No transaction table was found — the file needs a heading row naming '
        + 'at least a date and a description.',
    };
  }

  const { columns } = header;
  const transactions = [];
  const problems = [];
  let serial = 0;

  for (const row of rows.slice(header.row + 1)) {
    const cell = (field) => (columns[field] === undefined ? '' : row[columns[field]] ?? '');

    const date = readDate(cell('date')) ?? readDate(cell('valueDate'));
    if (!date) continue;

    const read = amountAndDirection(cell, options);
    const description = String(cell('description')).replace(/\s+/g, ' ').trim();
    serial += 1;

    if (!read) {
      problems.push({
        serial, date, description,
        reason: 'no amount could be read from this row',
      });
      continue;
    }

    transactions.push({
      serial,
      date,
      description,
      raw: description,
      reference: String(cell('reference')).trim(),
      amount: read.amount,
      direction: read.direction,
      balance: readAmount(cell('balance')),
      printedBalance: readAmount(cell('balance')),
    });
  }

  const balances = transactions.map((row) => row.printedBalance).filter((n) => n !== null);

  return {
    transactions,
    problems,
    account: readTableAccount(rows.slice(0, header.row), options),
    mode: 'table',
    // A card statement has no running balance, and inventing one would make
    // the importer's reconciliation check fail on every file.
    //
    // A bank export does have one, and the opening balance is worked back from
    // it — see `openingFrom`. This used to read `balances.length ? null : null`,
    // a ternary with the same answer in both branches, so it was always null
    // whatever the file contained.
    openingBalance: options.card ? null : openingFrom(transactions),
    closingBalance: options.card ? null : (balances.at(-1) ?? null),
  };
}

/**
 * Where the account stood before the first row.
 *
 * A table carries no summary block, so there is nothing to read it from — but
 * the first row prints the balance *after* itself, and undoing what that row
 * did gives the balance before it.
 *
 * Without this `reconcile` measures from zero rather than from where the
 * account started, and every statement that did not happen to open at zero
 * came in flagged as "does not fully add up" — the warning that means rows are
 * missing, on a file with none missing.
 */
function openingFrom(transactions) {
  const first = transactions.find((row) => row.printedBalance !== null);
  if (!first) return null;
  return first.printedBalance - (first.direction === 'in' ? first.amount : -first.amount);
}

/**
 * Which way the money went, from the columns rather than from arithmetic.
 *
 * Three layouts, in the order they are worth trying:
 *
 *  1. Separate withdrawal and deposit columns. Whichever holds a figure is
 *     the answer, and no interpretation is involved.
 *  2. One amount column with a Dr/Cr column beside it.
 *  3. One amount column carrying its own sign.
 *
 * On a card statement the sense is inverted: the "purchase" column is money
 * leaving the household even though it *credits* nothing and increases a
 * balance owed. That is handled by which header matched, not by a sign.
 */
function amountAndDirection(cell, options) {
  const out = readAmount(cell('withdrawal'));
  const into = readAmount(cell('deposit'));

  if (out || into) {
    // Both filled is a malformed row; the larger is the real figure and the
    // other is almost always a zero the export wrote into every cell.
    if (out && into) {
      return Math.abs(out) >= Math.abs(into)
        ? { amount: Math.abs(out), direction: 'out' }
        : { amount: Math.abs(into), direction: 'in' };
    }
    return out
      ? { amount: Math.abs(out), direction: 'out' }
      : { amount: Math.abs(into), direction: 'in' };
  }

  const amount = readAmount(cell('amount'));
  if (amount === null) return null;

  const stated = directionOf(cell('type'));
  if (stated) return { amount: Math.abs(amount), direction: stated };

  // A signed amount column. On a bank statement a negative figure left the
  // account; on a card statement a positive figure is a purchase, which is
  // also money leaving the household.
  if (options.card) {
    return { amount: Math.abs(amount), direction: amount >= 0 ? 'out' : 'in' };
  }
  return { amount: Math.abs(amount), direction: amount < 0 ? 'out' : 'in' };
}

/** Whatever the block above the table says about the account. */
function readTableAccount(rows, options) {
  const joined = rows.map((row) => row.join(' ')).join('\n');
  const find = (pattern) => pattern.exec(joined)?.[1]?.trim() ?? '';

  return {
    number: find(/(?:account|card)\s*(?:no\.?|number)?\s*[:#]?\s*([0-9Xx*]{4,})/i),
    holder: find(/(?:account name|customer name|name)\s*[:#]?\s*([A-Za-z][A-Za-z .]{2,48})/i),
    ifsc: find(/\b([A-Z]{4}0[A-Z0-9]{6})\b/),
    period: find(/(\d{1,2}[-/ ][A-Za-z0-9]{2,}[-/ ]\d{2,4}\s*(?:to|-|–)\s*\d{1,2}[-/ ][A-Za-z0-9]{2,}[-/ ]\d{2,4})/i),
    type: options.card ? 'Credit Card' : find(/account type\s*[:#]?\s*([A-Za-z ]{3,24})/i),
    bank: /kotak|kkbk/i.test(joined) ? 'Kotak Mahindra Bank'
      : /hdfc/i.test(joined) ? 'HDFC Bank'
        : /icici|icic/i.test(joined) ? 'ICICI Bank'
          : /axis|utib/i.test(joined) ? 'Axis Bank'
            : /\bsbi\b|state bank/i.test(joined) ? 'State Bank of India'
              : '',
  };
}

/**
 * Whether a file looks like a card statement rather than a bank one.
 *
 * Worth detecting rather than asking, because somebody dropping twelve files
 * in at once should not have to sort them first. A card statement names a card
 * and has no balance column to run.
 */
export function looksLikeCard(text) {
  const head = String(text ?? '').slice(0, 4000);
  return /credit card|card number|card no|statement of your.*card|total amount due|minimum amount due/i
    .test(head);
}
