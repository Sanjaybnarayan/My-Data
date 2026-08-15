/**
 * Reading what a document *is*, not just what it says.
 *
 * `pdf-read.js` turns a file into text. This turns that text into fields: what
 * kind of document it is, who issued it, what is owed, when it is due, what it
 * is numbered. A bill that arrives with its due date already filled in is the
 * difference between a reminder that fires and a folder nobody opens.
 *
 * ## The most important thing here is the redaction
 *
 * A document's text is stored in `ocrText`, which is *searchable* — and in this
 * schema a field cannot be both searchable and encrypted, because a search
 * index over ciphertext finds nothing. So `ocrText` is stored in the clear, and
 * it syncs to a cell in the household's Google Sheet.
 *
 * That is fine for the words on a bill. It is not fine for a PAN, an Aadhaar
 * number or a passport number, which the schema deliberately holds encrypted on
 * `identityDocument.number`. Extracting text from a scanned PAN card and
 * dropping it into a searchable field would quietly undo that decision — the
 * application would have *worsened* its own security posture by getting better
 * at reading.
 *
 * So identifiers are found, removed from the indexable text, and handed back
 * separately for the caller to put somewhere encrypted. `redact` is not an
 * afterthought on top of extraction; it is the reason extraction is safe.
 *
 * ## What this is not
 *
 * Not a model, and not a general document understander. Ordered patterns over
 * text, in the same spirit as the statement categoriser: every field carries
 * the pattern that found it, nothing is inferred from a number's mere shape
 * without a label near it, and a field that cannot be found is absent rather
 * than guessed. A wrong due date is worse than no due date.
 */

import { toMinor } from '../core/money.js';

/* ------------------------------------------------------------------ dates */

const MONTHS = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * A date out of a document, as `YYYY-MM-DD`.
 *
 * `03/04/2025` is the third of April, not the fourth of March. Indian
 * documents are day-first and this application is used in India; the
 * alternative reading would silently move a due date by a month for eleven
 * days of every twelve. Where a month is spelled out there is no ambiguity and
 * the spelling wins.
 */
export function readDate(text) {
  const value = String(text ?? '').trim();

  const named = /(\d{1,2})[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{2,4})/.exec(value);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return iso(named[3], month, named[1]);
  }

  // Year-first is checked before day-first and both are anchored on a word
  // boundary. Without that, `2026-01-15` matches the day-first pattern on its
  // own substring `26-01-15` and comes back as 2015 — a date that is wrong by
  // eleven years and looks entirely plausible.
  const yearFirst = /\b(\d{4})[\-/.](\d{1,2})[\-/.](\d{1,2})\b/.exec(value);
  if (yearFirst) return iso(yearFirst[1], yearFirst[2], yearFirst[3]);

  const dayFirst = /\b(\d{1,2})[\-/.](\d{1,2})[\-/.](\d{2,4})\b/.exec(value);
  if (dayFirst) {
    const [, day, month, year] = dayFirst;
    if (Number(month) >= 1 && Number(month) <= 12) return iso(year, month, day);
  }

  return null;
}

function iso(year, month, day) {
  const y = String(year).length === 2 ? `20${year}` : String(year);
  const d = String(day).padStart(2, '0');
  const m = String(month).padStart(2, '0');
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

/* ---------------------------------------------------------------- amounts */

/** The amount following a label, in minor units, or null. */
export function readAmount(text, labels) {
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}[^0-9₹]{0,40}(?:₹|Rs\\.?|INR)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
      'i',
    );
    const match = pattern.exec(text);
    if (match) return toMinor(match[1].replace(/,/g, ''));
  }
  return null;
}

/** The value following a label, up to the end of its line. */
function readField(text, labels, { pattern = '[A-Za-z0-9/\\-]{3,40}' } = {}) {
  for (const label of labels) {
    const match = new RegExp(`${label}[^A-Za-z0-9]{0,12}(${pattern})`, 'i').exec(text);
    if (match) return match[1].trim();
  }
  return null;
}

/** The date following a label. */
function readLabelledDate(text, labels) {
  for (const label of labels) {
    const match = new RegExp(
      `${label}[^0-9]{0,20}(\\d{1,2}[\\s\\-/.][A-Za-z0-9]{2,9}[\\s\\-/.,]*\\d{2,4}|\\d{4}[\\-/.]\\d{1,2}[\\-/.]\\d{1,2})`,
      'i',
    ).exec(text);
    const date = match && readDate(match[1]);
    if (date) return date;
  }
  return null;
}

/* ------------------------------------------------------------ identifiers */

/**
 * Identifiers that must never reach a searchable field.
 *
 * Each is matched by its own shape *and* required to sit near a word that names
 * it. Shape alone is not enough: a twelve-digit number is an Aadhaar, a
 * customer reference or an invoice number depending entirely on what it is
 * labelled, and redacting every twelve-digit number would gut the text while
 * still missing the one that mattered.
 */
export const SENSITIVE = [
  {
    kind: 'PAN',
    near: /\bPAN\b|permanent account number/i,
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
  },
  {
    kind: 'Aadhaar',
    near: /aadhaar|aadhar|\bUIDAI\b|unique identification/i,
    pattern: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,
  },
  {
    kind: 'Passport',
    near: /passport/i,
    pattern: /\b[A-PR-WYa-pr-wy][0-9]{7}\b/g,
  },
  {
    kind: 'Card',
    // A card number needs no label: there is no benign reason for sixteen
    // digits in that shape to sit in a searchable field.
    near: /.?/,
    pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
  },
];

/**
 * Find the identifiers in a document without returning the document's text.
 *
 * @returns {Array<{kind: string, value: string}>}
 */
export function readIdentifiers(text) {
  const source = String(text ?? '');
  const found = [];

  for (const rule of SENSITIVE) {
    if (!rule.near.test(source)) continue;
    for (const match of source.match(rule.pattern) ?? []) {
      if (!found.some((f) => f.value === match)) found.push({ kind: rule.kind, value: match });
    }
  }
  return found;
}

/**
 * The same text with those identifiers removed.
 *
 * The marker is left in place of the number so a person reading the extracted
 * text can see that something was taken out rather than wondering whether the
 * document was misread.
 */
export function redact(text) {
  let out = String(text ?? '');
  for (const { kind, value } of readIdentifiers(out)) {
    out = out.split(value).join(`[${kind} removed]`);
  }
  return out;
}

/* ------------------------------------------------------------------ kinds */

const KIND_RULES = [
  { kind: 'statement', match: /account statement|statement of account|opening balance.{0,40}closing balance/i },
  { kind: 'policy', match: /policy (no|number)|sum assured|policy schedule|premium (due|paid|amount)/i },
  { kind: 'identity', match: /permanent account number|\bUIDAI\b|aadhaar|passport no|driving licence|voter/i },
  // Before `bill`, and the order is the whole point: a hospital receipt says
  // "Bill No: IP/2026/77812" at the top and was being read as a bill, so its
  // amount was looked for under "amount payable" — a phrase a receipt never
  // uses, because the money has already been paid.
  { kind: 'receipt', match: /\breceipt\b|paid successfully|payment received|thank you for your payment|received with thanks|received the sum of/i },
  { kind: 'bill', match: /\b(bill|invoice)\b|amount (payable|due)|due date|consumer (no|number)|units consumed|tax invoice/i },
];

/** What sort of document this is, or `unknown`. */
export function detectKind(text) {
  const source = String(text ?? '');
  return KIND_RULES.find((rule) => rule.match.test(source))?.kind ?? 'unknown';
}

/* --------------------------------------------------------------- readers */

/** Well-known billers, so a bill can name itself rather than saying "unknown". */
const BILLERS = [
  { name: 'BESCOM', match: /bescom|bangalore electricity/i, category: 'utilities' },
  { name: 'BWSSB', match: /bwssb|water supply/i, category: 'utilities' },
  { name: 'Airtel', match: /\bairtel\b/i, category: 'telecom' },
  { name: 'Jio', match: /reliance jio|\bjio\b/i, category: 'telecom' },
  { name: 'Vodafone Idea', match: /vodafone|\bvi\b limited/i, category: 'telecom' },
  { name: 'ACT Fibernet', match: /act fibernet|atria convergence/i, category: 'telecom' },
  { name: 'Indane', match: /indane|indian oil/i, category: 'utilities' },
  { name: 'Tata Play', match: /tata play|tata sky/i, category: 'telecom' },
];

/**
 * A bill: who wants money, how much, and by when.
 *
 * The due date is the field this exists for. Everything else is convenience;
 * a due date is what turns a filed PDF into a reminder that fires.
 */
export function readBill(text) {
  const source = String(text ?? '');
  const biller = BILLERS.find((b) => b.match.test(source));

  return prune({
    biller: biller?.name ?? readField(source, ['billed by', 'from', 'issued by'], { pattern: '[A-Za-z][A-Za-z .&-]{2,40}' }),
    category: biller?.category ?? null,
    amount: readAmount(source, ['amount payable', 'total amount due', 'amount due', 'total payable', 'bill amount', 'grand total', 'total']),
    dueDate: readLabelledDate(source, ['due date', 'pay by', 'payment due', 'last date of payment', 'last date']),
    billDate: readLabelledDate(source, ['bill date', 'invoice date', 'date of issue', 'statement date']),
    accountNumber: readField(source, ['consumer (?:no|number|id)', 'account (?:no|number)', 'customer (?:no|number|id)', 'invoice (?:no|number)']),
  });
}

/**
 * A receipt: money that has already moved.
 *
 * ## Why this is not `readBill`
 *
 * Receipts were routed through the bill reader, and measured across four real
 * layouts — a school fee receipt, a temple donation, a rent receipt and a
 * hospital payment — it found **nothing at all**: no amount and no date, eight
 * fields out of eight missing.
 *
 * The reason is that a bill and a receipt describe the same money in opposite
 * tenses. A bill says *amount payable* and *due date*; a receipt says
 * **"received the sum of"** and *receipt date*, because the paying has already
 * happened. Looking for one set of words in a document written with the other
 * finds nothing, which is what it did.
 *
 * ## The wrong value, which was worse than the missing ones
 *
 * `biller` came back filled in on three of the four — with the name of the
 * person who **paid**. A receipt's "from" is the payer; a bill's is the
 * company. The rent receipt produced `"Sanjay Narayan towards rent for the
 * month"`, which is not anybody's name.
 *
 * So a receipt names a `payer` and a `receivedBy`, and never a `biller`. The
 * fields are different because the facts are different, and reusing the bill's
 * shape is what made a payer look like a biller.
 */
export function readReceipt(text) {
  const source = String(text ?? '');

  return prune({
    // "Received with thanks from X" and "Received from: X" — the person who
    // paid. Only labels that unambiguously introduce one: a bare "from" appears
    // mid-sentence on most rent receipts and reading it produced `"Sanjay
    // Narayan towards rent for the month"`, filed as a person.
    //
    // The consequence is that some layouts yield no payer at all, and that is
    // the intended trade — a missing name is a gap, a wrong one is a claim.
    // The length bound is belt and braces on top of that: mutation testing
    // shows widening it changes nothing today, because every label here is
    // followed by a name at the end of its line.
    payer: readField(source, [
      'received with thanks from', 'received from', 'paid by',
    ], { pattern: '[A-Za-z][A-Za-z .]{2,40}' }),

    // Who issued it. A receipt rarely labels this, so it is left empty far more
    // often than it is guessed at — an invented payee on a payment record is
    // worse than none.
    //
    // `received by` is deliberately **not** a label here. "Payment received by
    // UPI" is ordinary phrasing on an Indian receipt, and reading it filled
    // this field with `"UPI"` — a payment method presented as a person. That is
    // the wrong-value failure this whole reader exists to stop, so the
    // ambiguous label is dropped rather than patched around.
    receivedBy: readField(source, [
      'issued by', 'in favour of', 'received on behalf of',
    ], { pattern: '[A-Za-z][A-Za-z .&-]{2,50}' }),

    // The tense a receipt is written in. `amount` last, because on its own it
    // is the label most likely to appear beside something that is not the total.
    amount: readAmount(source, [
      'received the sum of rupees[^0-9]{0,80}', 'received a sum of', 'received the sum of',
      'sum of', 'paid amount', 'amount paid', 'total paid', 'amount received',
      'grand total', 'total', 'amount',
    ]),

    receiptDate: readLabelledDate(source, [
      'receipt date', 'date of payment', 'payment date', 'dated', 'date',
    ]),

    receiptNumber: readField(source, [
      'receipt (?:no|number)', 'reference (?:no|number)',
    ]),

    // What it was for, where the document says so plainly. Not inferred.
    towards: readField(source, ['towards', 'being', 'on account of'],
      { pattern: '[A-Za-z][A-Za-z .&-]{2,60}' }),
  });
}

/** An insurance policy: who insures what, for how much, until when. */
export function readPolicy(text) {
  const source = String(text ?? '');

  return prune({
    policyNumber: readField(source, ['policy (?:no|number)', 'certificate (?:no|number)']),
    insurer: readField(source, ['insurer', 'insurance company', 'issued by'], { pattern: '[A-Za-z][A-Za-z .&-]{2,50}' }),
    premium: readAmount(source, ['premium amount', 'total premium', 'premium payable', 'premium']),
    sumAssured: readAmount(source, ['sum assured', 'sum insured', 'coverage amount', 'cover amount']),
    expiresOn: readLabelledDate(source, ['valid (?:up ?to|till|until)', 'expiry date', 'expires on', 'policy end date', 'renewal date']),
    startsOn: readLabelledDate(source, ['policy start date', 'commencement date', 'valid from', 'date of commencement']),
  });
}

/**
 * Everything readable about a document, with the sensitive parts separated
 * from the part that is safe to index.
 *
 * @param {string} text
 * @returns {{kind: string, fields: object, identifiers: Array, indexable: string}}
 */
export function readDocument(text) {
  const source = String(text ?? '');
  const kind = detectKind(source);

  const fields = kind === 'policy' ? readPolicy(source)
    : kind === 'receipt' ? readReceipt(source)
      : kind === 'bill' ? readBill(source)
        : {};

  return {
    kind,
    fields,
    identifiers: readIdentifiers(source),
    // The only string a caller should ever store in a searchable field.
    indexable: redact(source),
  };
}

/**
 * What a document says about the record it is attached to.
 *
 * Deliberately narrow: an expiry date and a title. A bill's due date becomes an
 * expiry so the existing reminder machinery picks it up without a second
 * mechanism, and nothing overwrites a value a person typed.
 */
export function suggestions(read, existing = {}) {
  const out = {};
  const expiry = read.fields.expiresOn ?? read.fields.dueDate ?? null;

  if (expiry && !existing.expiresOn) out.expiresOn = expiry;
  if (read.kind === 'policy' && !existing.category) out.category = 'insurance';
  if (read.kind === 'bill' && !existing.category) out.category = 'financial';

  const name = read.fields.biller ?? read.fields.insurer;
  if (name && !existing.title) out.title = name;

  return out;
}

function prune(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}
