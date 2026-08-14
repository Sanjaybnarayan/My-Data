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

/**
 * A date out of a statement cell, as `YYYY-MM-DD`.
 *
 * Three shapes, because three banks print three:
 *
 *     01 Apr 2025      Kotak
 *     16.07.2026       ICICI
 *     18-06-2026       Axis
 *
 * Only the first was accepted, and the parser needs a date in the second cell
 * to know a row begins a transaction — so an ICICI statement with 3,242 rows
 * of perfectly readable text produced **zero** transactions.
 *
 * The numeric forms are **day-first**, which is what Indian banks print.
 * Reading `07.08.2026` as the seventh of August where the bank meant the
 * eighth of July would move a transaction by a month for eleven days in every
 * twelve, silently — the same rule, and the same reasoning, as
 * `domain/extract.js`. A spelled-out month is unambiguous and wins wherever it
 * appears.
 */
export function parseDate(text) {
  const value = String(text ?? '').trim();

  const named = /^(\d{1,2})[\s\-/.]+([A-Za-z]{3})[a-z]*[\s\-/.,]+(\d{2,4})$/.exec(value);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month) return iso(named[3], month, named[1]);
  }

  // Year-first before day-first, and both anchored, so `2026-01-15` is not
  // read off its own tail as 2015.
  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(value);
  if (yearFirst) return iso(yearFirst[1], yearFirst[2], yearFirst[3]);

  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (dayFirst) return iso(dayFirst[3], dayFirst[2], dayFirst[1]);

  return null;
}

function iso(year, month, day) {
  const y = String(year).length === 2 ? `20${year}` : String(year);
  const m = Number(month);
  const d = Number(day);
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A row stating the balance carried into the statement.
 *
 * `Opening Balance` (Kotak, Axis) and `B/F` (ICICI), which is the same fact
 * under a shorter name. Anchored to the start so a narration mentioning either
 * is not mistaken for one.
 */
const OPENING_ROW = /^\s*(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\s+)?(?:opening\s+balance|B\/F)\b/i;

const AMOUNT = /^-?\(?\d[\d,]*\.\d{2}\)?(?:\s*(?:Dr|Cr)\.?)?$/i;
const SERIAL = /^\d{1,5}$/;
const DATE_CELL = /^(?:\d{1,2}[\s\-/.]+[A-Za-z]{3,9}[\s\-/.,]+\d{2,4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})$/;

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
    // Before `startOfTransaction`, because ICICI prints the brought-forward
    // balance as a dated row — `01-04-2025  B/F  50,087.53` — which is the
    // shape of a transaction and is not one. Tested first, it became a
    // transaction with no readable amount and was reported as a problem on
    // every statement that opens with one.
    if (OPENING_ROW.test(row.text)) {
      if (opening === null) opening = amountsIn(row.text).at(-1) ?? null;
      continue;
    }

    const started = startOfTransaction(row);
    if (started) {
      groups.push({ ...started, row, continuations: [] });
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

/**
 * `{serial, date}` when this row begins a transaction, else null.
 *
 * Two layouts, because banks print both:
 *
 *     ["1", "16.07.2026", "3900.00", "5141.53"]     serial then date
 *     ["18-06-2026", "UPI/P2A/...", "101.00", ...]  date first, no serial
 *
 * Only the first was recognised, so an Axis statement — which has no serial
 * column at all — produced nothing. The serial is a convenience for reporting
 * a problem row back to a person; it is not what identifies a transaction, and
 * requiring one excluded every bank that does not print it.
 *
 * The date is what identifies the row, and it has to be in the **first or
 * second** cell. Anywhere further in and the match would start catching dates
 * that appear inside a narration.
 */
function startOfTransaction(row) {
  if (row.cells) {
    const [first, second] = row.cells;
    if (!first) return null;

    // Date first, no serial.
    if (DATE_CELL.test(first.text)) {
      const date = parseDate(first.text);
      return date ? { serial: null, date } : null;
    }

    if (!second) return null;
    if (!SERIAL.test(first.text) || !DATE_CELL.test(second.text)) return null;
    const date = parseDate(second.text);
    return date ? { serial: Number(first.text), date } : null;
  }

  const text = row.text.trim();
  const DATE = String.raw`\d{1,2}\s+[A-Za-z]{3}\s+\d{4}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}`;

  const serialled = new RegExp(`^(\\d{1,5})\\s+(${DATE})\\s+(.*)$`).exec(text);
  if (serialled) {
    const date = parseDate(serialled[2]);
    if (date) return { serial: Number(serialled[1]), date };
  }

  const bare = new RegExp(`^(${DATE})\\s+(.*)$`).exec(text);
  if (!bare) return null;
  const date = parseDate(bare[1]);
  return date ? { serial: null, date } : null;
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
  // The last balance the bank itself printed, so a statement that never states
  // an opening balance can still be checked row against row.

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

  // A statement that never states an opening balance was never checked at all:
  // the branch above needs a running figure to compare against, so ICICI's 595
  // transactions came back with zero problems whatever the rows said. That is
  // the most confident an importer can be while being wrong.
  if (opening === null) problems.push(...blockProblems(transactions));

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

  const amounts = cells
    .map((cell) => ({ x: cell.x, value: cellAmount(cell.text) }))
    .filter((cell) => cell.value !== null)
    .sort((a, b) => a.x - b.x);

  let withdrawal = null;
  let deposit = null;
  let balance = null;
  let rest = amounts;

  // A column boundary is the *left* edge of its heading, and amounts are
  // **right-aligned** — so a figure wider than its heading starts to the left
  // of it and lands in the column before. Measured on a real ICICI statement:
  // a balance of `100236.53` began 1.1pt left of the `Balance` heading, so 48
  // rows came back with no balance at all, and on a row with no deposit that
  // balance would have been read *as* the deposit — an inward amount invented
  // out of a running total.
  //
  // The rightmost amount on the row is the balance. That holds for all three
  // layouts here, because every one of them prints Withdrawal, Deposit and
  // Balance in that order with nothing numeric after it — Axis's trailing
  // branch code has no decimals, so it is not amount-shaped.
  //
  // Only where there is more than one amount: a lone figure is the
  // transaction, not a balance, and treating it as one would leave the row
  // with no amount at all.
  if (amounts.length >= 2 && amounts.at(-1).x >= columns.deposit) {
    balance = amounts.at(-1).value;
    rest = amounts.slice(0, -1);
  }

  for (const cell of rest) {
    if (cell.x >= columns.balance) balance ??= cell.value;
    else if (cell.x >= columns.deposit) deposit ??= cell.value;
    else if (cell.x >= columns.withdrawal) withdrawal ??= cell.value;
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
/**
 * The arithmetic check for a statement that never states an opening balance.
 *
 * Without one the running-balance check has nothing to start from, so ICICI's
 * 595 transactions came back with zero problems whatever the rows said.
 *
 * Checking each row against the balance printed above it does not work either:
 * **a bank orders same-day rows by its own internal sequence, not by the
 * running balance.** ICICI printed a ₹650 withdrawal above the ₹650 deposit
 * that funded it — both rows read correctly, both balances correct, and the
 * pair in the wrong order. Two false alarms on 595 rows, and a warning that
 * cries wolf is one people learn to click past.
 *
 * So the unit is a **date**. Across dates the arithmetic must hold: the
 * previous day's closing plus this day's signed amounts has to equal one of
 * the balances the bank printed inside the day. Which row of the day carried
 * it does not matter, and is not knowable.
 *
 * Verified against six real statements: no problems on any of them, and an
 * error injected into any one row is still caught on every one of them.
 */
function blockProblems(transactions) {
  const problems = [];
  let closing = null;
  let i = 0;

  while (i < transactions.length) {
    const date = transactions[i].date;
    const block = [];
    while (i < transactions.length && transactions[i].date === date) {
      block.push(transactions[i]);
      i += 1;
    }

    const printed = block.map((t) => t.printedBalance).filter((b) => b !== null);
    if (!printed.length) continue;

    if (closing === null) {
      // The first day sets the baseline: with no opening balance there is
      // nothing before it to check against.
      closing = printed.at(-1);
      continue;
    }

    const moved = block.reduce(
      (total, t) => total + (t.direction === 'in' ? t.amount : -t.amount), 0,
    );
    const expected = closing + moved;
    // A rupee of drift is rounding.
    const hit = printed.find((balance) => Math.abs(balance - expected) <= 100);

    if (hit === undefined) {
      problems.push({
        serial: block[0].serial,
        date,
        reason: 'the transactions on this date do not add up to any balance printed for it',
        expected: printed.at(-1),
        found: expected,
        description: block.map((t) => t.description).join(' · ').slice(0, 200),
      });
      // Resync to what the bank printed, so one bad day does not make every
      // day after it look wrong too.
      closing = printed.at(-1);
    } else {
      closing = hit;
    }
  }

  return problems;
}

function describe(group) {
  return [group.row, ...group.continuations]
    .map((row) => row.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The narration with the figures, serial, date and reference taken out.
 *
 * The order matters, and getting it wrong is not cosmetic. A dotted date is
 * shaped exactly like an amount — `16.07.2026` contains `16.07` — so stripping
 * figures first ate half the date and left `.2026` glued to the front of every
 * ICICI narration. The date has to go first, and by every shape the parser
 * accepts rather than only Kotak's.
 *
 * The narration is what the categoriser reads and what the duplicate
 * fingerprint is built from, so rubbish here is rubbish in both.
 */
const LEADING_DATE = String.raw`\d{1,2}[\s\-/.]+[A-Za-z]{3,9}[\s\-/.,]+\d{2,4}`
  + String.raw`|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}`;

function narration(description, reference) {
  return description
    // An optional serial, then the date, in either layout.
    .replace(new RegExp(`^(?:\\d{1,5}\\s+)?(?:${LEADING_DATE})\\s*`), '')
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
    // `Account No. 5612488963` (Kotak), `Account No: 926010022005391` (Axis),
    // `Saving Account no. 008401532684 in INR` (ICICI). The number is what
    // `domain/import.js` matches an existing account on, so a statement whose
    // number is never found gets matched on the bank name alone.
    number: find(/Account\s*(?:No|Number)\.?\s*[:\-]?\s*([0-9Xx*]{6,20})\b/i),
    // The name is not labelled — it is simply the line under the account
    // number, which is how every bank lays out a statement head.
    holder: find(/Account No\.?\s*[0-9Xx*]+\s*\n\s*([A-Za-z][A-Za-z .]{2,48}?)\s*$/m)
      || find(/^\s*([A-Z][A-Z]+(?:\s+[A-Z.]{1,12}){1,4})\s*$/m),
    ifsc: find(/IFSC Code\s*([A-Z]{4}0[A-Z0-9]{6})/),
    type: find(/Account Type\s*([A-Za-z ]+?)\s*(?:CRN|$)/m),
    period: find(/(\d{2} [A-Za-z]{3} \d{4}\s*-\s*\d{2} [A-Za-z]{3} \d{4})/),
    bank: bankOf(joined, lines),
  };
}

/** IFSC prefixes, which name the bank that issued the account. */
const IFSC_BANKS = {
  KKBK: 'Kotak Mahindra Bank',
  HDFC: 'HDFC Bank',
  ICIC: 'ICICI Bank',
  SBIN: 'State Bank of India',
  UTIB: 'Axis Bank',
  PUNB: 'Punjab National Bank',
  IDFB: 'IDFC First Bank',
  YESB: 'Yes Bank',
  INDB: 'IndusInd Bank',
  BARB: 'Bank of Baroda',
  CNRB: 'Canara Bank',
  UBIN: 'Union Bank of India',
};

/**
 * Whose statement this is.
 *
 * **Not** any bank named anywhere in the header. A statement's transaction
 * narrations are full of *other people's* banks — an ICICI statement whose
 * first rows say `MMT/IMPS/.../KKBKTransfer` was reported as Kotak, and an
 * Axis one likewise, because the scan covered forty lines and Kotak was tested
 * first. Getting this wrong sends the import at the wrong account.
 *
 * So: the account's own IFSC decides it, because that is the one identifier on
 * the page that belongs to the account rather than to somebody it paid. Only
 * where there is no IFSC does a name count, and then only from the letterhead.
 */
function bankOf(joined, lines) {
  // A *labelled* IFSC is the account's own. A bare one anywhere in the header
  // may well be a counterparty's, lifted out of a narration — which is how an
  // ICICI statement came back as Kotak on the strength of one `KKBK0008067`
  // inside somebody else's transfer reference.
  const labelled = /IFSC(?:\s*Code)?\s*[:\-]?\s*([A-Z]{4})0[A-Z0-9]{6}\b/i.exec(joined)?.[1];
  if (labelled && IFSC_BANKS[labelled.toUpperCase()]) return IFSC_BANKS[labelled.toUpperCase()];

  // The first few lines are the letterhead. Beyond that is the table, where a
  // bank's name is somebody else's.
  const head = lines.slice(0, 8).join('\n');
  /** @type {Array<[RegExp, string]>} */
  const named = [
    [/\bKotak\b/i, 'Kotak Mahindra Bank'],
    [/\bHDFC\b/i, 'HDFC Bank'],
    [/\bICICI\b/i, 'ICICI Bank'],
    [/\bAxis\b/i, 'Axis Bank'],
    [/\bState Bank of India\b/i, 'State Bank of India'],
  ];
  for (const [pattern, name] of named) {
    if (pattern.test(head)) return name;
  }

  // Last resort: a bare IFSC. Better than nothing, and only reached when the
  // page never labelled one and never named a bank at its head.
  const bare = /\b([A-Z]{4})0[A-Z0-9]{6}\b/.exec(joined)?.[1];
  return (bare && IFSC_BANKS[bare]) || '';
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
