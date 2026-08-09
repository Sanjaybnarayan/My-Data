/**
 * Bank statement parsing.
 *
 * A statement is a table, and the interesting information is in the *columns*.
 * Flatten it to text and you throw away the one thing that decides whether
 * money came in or went out: which of the withdrawal and deposit columns the
 * number sat in. So this parser works on positioned rows — each cell keeping
 * the x it was drawn at — and finds the column boundaries from the statement's
 * own heading row. It falls back to reading flat text when that is all there
 * is, but says so, because the fallback is guesswork and the column read is not.
 *
 * Three things make real statements harder than they look:
 *
 * **Descriptions wrap.** A narration too wide for its column continues on the
 * next row with no serial and no date. Those continuations carry the merchant
 * name, which is the only thing that makes a row categorisable, so they are
 * folded back into the row above.
 *
 * **The printed balance has no sign.** Kotak prints an overdrawn balance as a
 * bare number — a balance of minus 1,775.54 appears as "1,775.54". Trusting it
 * turns one overdraft into a fictional ten-thousand-rupee swing. So the running
 * balance is computed here from the opening balance and the signed amounts, and
 * the printed figure is used only to check that computation.
 *
 * **The parse checks itself.** Every row's computed balance must match the
 * printed one in magnitude. A row where it does not is reported rather than
 * quietly accepted: a mis-parsed statement produces confident, wrong totals,
 * which is worse than a parse that admits it failed.
 */

import { toMinor } from '../core/money.js';

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** `01 Apr 2025` → `2025-04-01`. */
export function parseDate(text) {
  const match = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{2,4})$/.exec(String(text ?? '').trim());
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${month}-${match[1].padStart(2, '0')}`;
}

const AMOUNT = /^-?\(?\d[\d,]*\.\d{2}\)?(?:\s*(?:Dr|Cr)\.?)?$/i;
const SERIAL = /^\d{1,5}$/;
const DATE_CELL = /^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/;

/** Every number that looks like an amount, in order, as minor units. */
function amountsIn(text) {
  return (String(text).match(/\d[\d,]*\.\d{2}/g) ?? []).map((value) => toMinor(value));
}

/** One cell's number, as minor units, or null when the cell is not a number. */
function cellAmount(text) {
  const trimmed = String(text ?? '').trim();
  return AMOUNT.test(trimmed) ? toMinor(trimmed.replace(/[^\d.]/g, '')) : null;
}

/* --------------------------------------------------------------- the rows */

/**
 * Accepts either flat strings or positioned rows, and normalises both to
 * `{text, cells}` — where `cells` is null for a string, which is what puts the
 * parser into fallback mode.
 *
 * @param {Array<string|{y?: number, cells: Array<{x: number, text: string}>}>} input
 */
function normaliseRows(input) {
  return (input ?? []).map((row) => {
    if (typeof row === 'string') return { text: row, cells: null };
    const cells = (row.cells ?? []).filter((cell) => String(cell.text ?? '').trim())
      .map((cell) => ({ x: Number(cell.x) || 0, text: String(cell.text).trim() }))
      .sort((a, b) => a.x - b.x);
    return { text: cells.map((cell) => cell.text).join(' '), cells, y: row.y };
  }).filter((row) => row.text.trim());
}

/**
 * Column boundaries, read off the statement's own heading row.
 *
 * Amounts are right-aligned under their heading, so every amount falls to the
 * right of its own heading and to the left of the next one. That makes the
 * heading x values the boundaries, with no tuning and no per-bank table.
 *
 * @returns {{withdrawal: number, deposit: number, balance: number}|null}
 */
export function detectColumns(rows) {
  for (const row of rows) {
    if (!row.cells) continue;
    const at = (pattern) => row.cells.find((cell) => pattern.test(cell.text))?.x;
    const description = at(/^(description|particulars|narration)\b/i);
    const withdrawal = at(/^withdrawal\b|^debit\b|\(Dr\.?\)/i);
    const deposit = at(/^deposit\b|^credit\b|\(Cr\.?\)/i);
    const balance = at(/^balance\b/i);

    if (withdrawal != null && deposit != null && balance != null
      && withdrawal < deposit && deposit < balance) {
      return { description: description ?? 0, withdrawal, deposit, balance };
    }
  }
  return null;
}

/**
 * @param {Array<string|{cells: Array<{x, text}>}>} input rows in reading order
 * @param {{openingBalance?: number}} [options]
 * @returns {{transactions: object[], openingBalance: number|null,
 *            closingBalance: number|null, problems: object[], account: object,
 *            mode: 'columns'|'text'}}
 */
export function parseStatement(input, options = {}) {
  const rows = normaliseRows(input);
  const columns = detectColumns(rows);
  const account = readAccount(rows.map((row) => row.text));
  const summary = readSummary(rows.map((row) => row.text));

  const groups = [];
  let opening = options.openingBalance ?? summary.opening ?? null;

  for (const row of rows) {
    const started = startOfTransaction(row);
    if (started) {
      groups.push({ ...started, row, continuations: [] });
      continue;
    }

    if (opening === null && /opening\s+balance/i.test(row.text)) {
      opening = amountsIn(row.text).at(-1) ?? null;
      continue;
    }

    // Everything after the summary block is the bank's small print, and a
    // page of it folded into the last transaction turns its figures into
    // amounts. Stop reading rows at the end of the table.
    if (/^(End of Statement|Account Summary)\b/i.test(row.text.trim())) break;

    // No serial and no date: this continues the row above, unless it is page
    // furniture — the heading row and the footer repeat on every page.
    const last = groups.at(-1);
    if (last && continues(row, columns)) last.continuations.push(row);
  }

  return assemble(groups, { opening, closing: summary.closing, columns, account });
}

/** `{serial, date}` when this row begins a transaction, else null. */
function startOfTransaction(row) {
  if (row.cells) {
    const [first, second] = row.cells;
    if (!first || !second) return null;
    if (!SERIAL.test(first.text) || !DATE_CELL.test(second.text)) return null;
    const date = parseDate(second.text);
    return date ? { serial: Number(first.text), date } : null;
  }

  const match = /^(\d{1,5})\s+(\d{1,2}\s+[A-Za-z]{3}\s+\d{4})\s+(.*)$/.exec(row.text.trim());
  if (!match) return null;
  const date = parseDate(match[2]);
  return date ? { serial: Number(match[1]), date } : null;
}

const FURNITURE = [
  /^#$/, /^Date\b/i, /^Page\b/i, /^Description\b/i, /^Chq\/Ref/i,
  /Withdrawal \(Dr/i, /^Savings Account Transactions/i, /^Account (No|Statement|Summary|Type)/i,
  /^Statement Generated on/i, /^End of Statement/i, /^Particulars\b/i,
  /^Opening Balance/i, /^Closing Balance/i, /^Commonly Used Narrations/i,
  /^[\s\-—_]+$/,
];

function isFurniture(text) {
  const trimmed = text.trim();
  return FURNITURE.some((pattern) => pattern.test(trimmed));
}

/**
 * Whether a row is the wrapped tail of the transaction above it.
 *
 * With columns this is exact: a narration wraps inside the description column,
 * so a continuation is a row whose every cell sits in that column and nowhere
 * near the figures. That one rule keeps the page footer, the summary block and
 * pages of small print out of the last transaction — which is where a
 * text-only parser quietly picks up a stray number and reports a balance that
 * never existed.
 */
function continues(row, columns) {
  if (isFurniture(row.text)) return false;
  if (!columns || !row.cells?.length) return true;

  return row.cells.every((cell) => cell.x >= columns.description - 12
    && cell.x < columns.withdrawal);
}

/* ------------------------------------------------------------- assembling */

function assemble(groups, { opening, closing, columns, account }) {
  const transactions = [];
  const problems = [];
  let running = opening;

  for (const group of groups) {
    const read = columns ? readByColumn(group, columns) : readByBalance(group, running);

    if (!read) {
      problems.push({
        serial: group.serial,
        date: group.date,
        reason: 'no amount could be read from the row',
        description: describe(group),
      });
      continue;
    }

    const { amount, direction, printedBalance } = read;

    if (running !== null) {
      running += direction === 'in' ? amount : -amount;

      // The printed balance carries no sign, so only its magnitude can be
      // compared. A rupee of drift is rounding; more than that means a row
      // was mis-read, and saying so beats reporting a confident wrong total.
      if (printedBalance !== null && Math.abs(Math.abs(running) - printedBalance) > 100) {
        problems.push({
          serial: group.serial,
          date: group.date,
          reason: 'the running balance does not match the printed balance',
          expected: printedBalance,
          found: Math.abs(running),
          description: describe(group),
        });
        // Resync to what the bank printed, so one bad row does not make every
        // row after it look wrong too. The sign is unknowable from the print;
        // positive is right except across an overdraft.
        running = printedBalance;
      }
    }

    const description = describe(group);
    const reference = /\b((?:UPI|IMPS|MB|NEFT|RTGS|NACH[A-Z]{0,4})-?\d{6,})\b/.exec(description)?.[1] ?? '';

    transactions.push({
      serial: group.serial,
      date: group.date,
      description: narration(description, reference),
      raw: description,
      reference,
      amount,
      direction,
      balance: running,
      printedBalance,
    });
  }

  return {
    transactions,
    openingBalance: opening,
    closingBalance: closing ?? running,
    problems,
    account,
    mode: columns ? 'columns' : 'text',
  };
}

/**
 * Column mode: the amount's x says which column it is in, and that is the
 * direction. No inference, no heuristic — it is where the bank printed it.
 */
function readByColumn(group, columns) {
  const cells = [group.row, ...group.continuations].flatMap((row) => row.cells ?? []);

  let withdrawal = null;
  let deposit = null;
  let balance = null;

  for (const cell of cells) {
    const value = cellAmount(cell.text);
    if (value === null) continue;
    if (cell.x >= columns.balance) balance ??= value;
    else if (cell.x >= columns.deposit) deposit ??= value;
    else if (cell.x >= columns.withdrawal) withdrawal ??= value;
  }

  if (withdrawal === null && deposit === null) return null;

  return {
    amount: withdrawal ?? deposit,
    direction: withdrawal !== null ? 'out' : 'in',
    printedBalance: balance,
  };
}

/**
 * Text mode: with the columns gone, the only evidence left is the balance
 * moving. Weaker — it cannot see an overdrawn balance, and it needs the
 * opening balance to start — but it is what a plain text statement allows.
 */
function readByBalance(group, running) {
  const numbers = amountsIn(describe(group));
  if (numbers.length < 2) return null;

  const balance = numbers.at(-1);
  const amount = numbers.at(-2);
  if (running === null) return { amount, direction: 'unknown', printedBalance: balance };

  return {
    amount: Math.abs(balance - running),
    direction: balance >= running ? 'in' : 'out',
    printedBalance: balance,
  };
}

/** The row and its continuations as one string. */
function describe(group) {
  return [group.row, ...group.continuations]
    .map((row) => row.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The narration with the figures, serial, date and reference taken out. */
function narration(description, reference) {
  return description
    .replace(/^\d{1,5}\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}\s+/, '')
    .replace(/\d[\d,]*\.\d{2}/g, ' ')
    .replace(reference ? new RegExp(reference.replace(/-/g, '\\-'), 'g') : /$^/, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ----------------------------------------------------------- the headings */

/** Whatever the header says about the account, for labelling the import. */
export function readAccount(lines) {
  const joined = lines.slice(0, 40).join('\n');
  const find = (pattern) => pattern.exec(joined)?.[1]?.trim() ?? '';

  return {
    number: find(/Account No\.?\s*([0-9Xx*]+)/),
    // The name is not labelled — it is simply the line under the account
    // number, which is how every bank lays out a statement head.
    holder: find(/Account No\.?\s*[0-9Xx*]+\s*\n\s*([A-Za-z][A-Za-z .]{2,48}?)\s*$/m)
      || find(/^\s*([A-Z][A-Z]+(?:\s+[A-Z.]{1,12}){1,4})\s*$/m),
    ifsc: find(/IFSC Code\s*([A-Z]{4}0[A-Z0-9]{6})/),
    type: find(/Account Type\s*([A-Za-z ]+?)\s*(?:CRN|$)/m),
    period: find(/(\d{2} [A-Za-z]{3} \d{4}\s*-\s*\d{2} [A-Za-z]{3} \d{4})/),
    bank: /KKBK|Kotak/i.test(joined) ? 'Kotak Mahindra Bank'
      : /HDFC/.test(joined) ? 'HDFC Bank'
        : /ICIC/.test(joined) ? 'ICICI Bank'
          : /SBIN/.test(joined) ? 'State Bank of India'
            : '',
  };
}

/**
 * The account summary block, which states the opening and closing balances
 * outright. Believing it beats inferring them from the first and last rows.
 */
export function readSummary(lines) {
  for (const line of lines) {
    if (!/Account\s*\(?(SA|CA)\)?:|Savings Account \(SA\)/i.test(line)) continue;
    const numbers = amountsIn(line);
    if (numbers.length >= 2) return { opening: numbers[0], closing: numbers.at(-1) };
  }

  const openingLine = lines.find((line) => /opening\s+balance/i.test(line) && amountsIn(line).length);
  return { opening: openingLine ? amountsIn(openingLine).at(-1) : null, closing: null };
}

/**
 * A statement is only trustworthy if its own arithmetic closes: opening plus
 * everything in, minus everything out, must equal the closing balance.
 */
export function reconcile({ transactions, openingBalance, closingBalance }) {
  const inflow = transactions.filter((t) => t.direction === 'in')
    .reduce((total, t) => total + t.amount, 0);
  const outflow = transactions.filter((t) => t.direction === 'out')
    .reduce((total, t) => total + t.amount, 0);

  const expected = (openingBalance ?? 0) + inflow - outflow;
  const difference = (closingBalance ?? expected) - expected;

  return {
    inflow,
    outflow,
    net: inflow - outflow,
    openingBalance,
    closingBalance,
    expected,
    difference,
    // A rupee of rounding is tolerable; anything more means rows were missed.
    balanced: Math.abs(difference) <= 100,
    // Whether that answer means anything. With no closing balance to compare
    // against, `difference` is the sum of the rows minus the sum of the same
    // rows — zero however wrong they are — so `balanced` would be a confident
    // yes backed by nothing. A credit card export is exactly that case: no
    // running balance per row, and nothing to reconcile against.
    checkable: openingBalance !== null && closingBalance !== null,
  };
}
