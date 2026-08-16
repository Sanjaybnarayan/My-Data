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

/**
 * A labelled value where the label may sit on either side of it — and
 * **nothing when the two readings disagree**.
 *
 * Two of the formats measured in `docs/DOCUMENT_FORMATS.md` put the value
 * first: the Karnataka e-stamp header does it in three of four files and not
 * in the fourth, and a registration certificate prints `SELTOS …` above the
 * word `MODEL`.
 *
 * The first version of this preferred the label-first reading, and that is
 * worse than useless. In a value-first document the label is followed by the
 * *next* field's value, so preferring it does not fail — it answers
 * confidently and wrongly. Measured on a real partnership deed it returned the
 * two partners **the wrong way round**, and on a rental agreement it returned
 * the string `"Second Party"` as the name of the first party.
 *
 * Orientation cannot be settled per document either: one deed measured here
 * writes `Certificate No.` label-first, `Purchased by` value-first and
 * `First Party` label-first, in the same header.
 *
 * So when both readings find a value and the values differ, the honest answer
 * is that this document does not say — which is this file's rule, applied to
 * its own new helper. It costs real fields: a party this reader could have
 * named is left blank rather than guessed at. That is the trade named in the
 * header, and it is the one worth making on a legal agreement.
 */
function readEitherSide(text, labels, { pattern = '[A-Za-z0-9/\\-]{3,40}' } = {}) {
  for (const label of labels) {
    const after = new RegExp(`${label}[^A-Za-z0-9]{0,12}(${pattern})`, 'i').exec(text);
    const before = new RegExp(`(${pattern})[^A-Za-z0-9]{0,4}${label}`, 'i').exec(text);

    const one = after?.[1].trim() ?? null;
    const other = before?.[1].trim() ?? null;

    if (one && other) {
      if (one === other) return one;
      continue; // Ambiguous: this label cannot say which is the value.
    }
    if (one || other) return one ?? other;
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

/** How far either side of a match counts as "beside" it. */
const CONTEXT = 40;

/** Words that mean the digits beside them are a card, whatever they add to. */
const CARD_WORD = /\b(card|debit|credit|visa|mastercard|rupay|amex)\b/i;

/**
 * The check digit every payment card carries.
 *
 * Doubling every second digit from the right and summing must give a multiple
 * of ten. This is not a security property and is not treated as one — it is
 * how a card number tells itself apart from sixteen digits that are not one.
 */
function luhn(value) {
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 12) return false;

  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

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
    // A card number needs no label — but sixteen digits alone are not a card.
    // Measured on a real statement, a Google Workspace payment reference
    // inside a UPI narration matched this, was redacted out of the household's
    // own searchable text, and was handed back as though it were a card.
    //
    // So: if something *beside* the digits names a card, they go, whatever they
    // add up to — a mis-scanned card number is still a card number, and that is
    // not the case to be clever about. Otherwise they must pass Luhn, which
    // every real card satisfies by construction and which roughly nine in ten
    // arbitrary sixteen-digit strings fail.
    //
    // `nearby`, not the whole document: the first version of this asked
    // whether the word "card" appeared anywhere in the text, and a bank
    // statement always says it somewhere, so the Luhn check never ran and the
    // false positive survived unchanged. Presence is not proximity — the same
    // lesson the `at` rules below are built on.
    near: /.?/,
    pattern: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
    keep: (value, nearby) => CARD_WORD.test(nearby) || luhn(value),
  },

  // The two below are anchored on their label rather than on their shape,
  // through `at` rather than `near`+`pattern`. A chassis number is seventeen
  // alphanumerics and an engine number is a dozen; so is a reference number, an
  // order number and a policy number, and redacting every such token would do
  // to a document what the note above warns about — only worse, because these
  // appear on invoices full of part numbers.
  //
  // They are here because `vehicle.chassisNumber` and `vehicle.engineNumber`
  // are `encrypted: true` in the schema. The application had decided these were
  // sensitive and was writing them, in the clear, into `ocrText` — which is
  // searchable, and therefore syncs to a cell in the household's Sheet. That is
  // the failure this file's own header describes for a PAN card, on fields it
  // had already made the decision about.
  {
    kind: 'Chassis',
    at: /chassis[.\s]*(?:no|number)?[:.\s]+([A-Z0-9]{9,20})\b/gi,
  },
  {
    kind: 'Engine',
    at: /engine[.\s]*(?:no|number)?[:.\s]+([A-Z0-9]{6,20})\b/gi,
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

  const add = (kind, value) => {
    if (value && !found.some((f) => f.value === value)) found.push({ kind, value });
  };

  for (const rule of SENSITIVE) {
    // `at` matches the label and its value together and keeps the value. A
    // rule that gates on a nearby word and then matches on shape alone would
    // redact every token of that shape in the document, which on a vehicle
    // invoice is most of the part numbers.
    if (rule.at) {
      for (const match of source.matchAll(rule.at)) add(rule.kind, match[1]);
      continue;
    }
    if (!rule.near.test(source)) continue;
    for (const match of source.matchAll(rule.pattern)) {
      // A window around the match, so a `keep` rule reads what sits *beside*
      // the digits rather than anywhere in the document.
      const from = Math.max(0, match.index - CONTEXT);
      const nearby = source.slice(from, match.index + match[0].length + CONTEXT);
      if (rule.keep && !rule.keep(match[0], nearby)) continue;
      add(rule.kind, match[0]);
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

  // Before `receipt` and `bill`, and measured rather than guessed: a lease was
  // read as a **bill** and a rent agreement as a **receipt**, because there was
  // no agreement kind and an agreement falls through to whichever money-word
  // appears in it first. A lease says "payable" and a rent agreement says
  // "received", and that was the whole of the reasoning behind the answer.
  //
  // A bill classification is not inert — it is the kind whose due date feeds
  // the reminder machinery, so a lease was one step from generating a bill
  // reminder for itself.
  {
    kind: 'agreement',
    match: /\b(deed of|this deed|lease deed|rental agreement|rent agreement|partnership deed)\b|witnesseth|hereinafter (called|referred)|india non[-\s]?judicial/i,
  },

  // Deliberately narrow: the two things only a registration certificate says.
  // Matching on `chassis` instead would take the dealer's tax invoice with it,
  // and an invoice for a car is a purchase, not a registration.
  { kind: 'vehicle', match: /certificate of registration|\bFORM[-\s]?23A?\b/i },

  // A registration certificate is a certificate and is not this kind. What
  // keeps them apart is **not** the ordering — mutation testing moved this
  // rule above `vehicle` and every test still passed, because the two are
  // disjoint: the rule pairs `certificate` with `presented to`, and a
  // certificate that *registers* something never says that. It sits after
  // `vehicle` as belt and braces, not as the mechanism.
  //
  // Measured across twenty-two real documents: this matches the one award
  // certificate among them and nothing else. Both of its tokens survived OCR
  // in a file where `Appreciation` came out `Apyreciation` and `donating` came
  // out `ddnating` — which is why the rule is built on them rather than on the
  // words a certificate is nominally about.
  {
    kind: 'certificate',
    match: /\bcertificate\b[\s\S]{0,80}\bpresented to\b|\b(awarded to|conferred upon|in recognition of)\b/i,
  },
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
/**
 * Words that begin the *next* thing on a receipt.
 *
 * A PDF's text layer often arrives with the line breaks gone, so
 * "Received with thanks from Mr Sanjay Narayan" and "Towards: Term II Tuition
 * Fee" become one run — and a capture bounded only by length swallows the
 * label after it. Measured across four flattened layouts, three produced a
 * wrong name, the worst being `"Sanjay Narayan Being donation towards Ann"`.
 *
 * A wrong name is a claim, not a gap, so the capture stops where the next
 * label starts. The list is receipt vocabulary rather than anything clever:
 * these are the words that follow a payer on an Indian receipt.
 */
const NEXT_LABEL = /\b(towards?|being|amount|sum|date[d]?|mode|payment|paid|receipt|student|class|adm|on account of|in respect of|for the month|vide|cheque|ref)\b/i;

/**
 * Cut a captured value where the next label begins.
 *
 * Returns null rather than a fragment when nothing is left: half a name is not
 * a better answer than none, and the whole point of this reader is that a
 * missing value is a gap while a wrong one is a claim.
 */
export function stopAtLabel(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  const at = text.search(NEXT_LABEL);
  // `at > 0`, not `>= 0`: a value that *starts* with one of these words was
  // never a name to begin with, and cutting it to nothing is the right answer.
  const cut = (at > 0 ? text.slice(0, at) : at === 0 ? '' : text)
    // Trailing punctuation left behind by the cut.
    .replace(/[\s,;:.\-]+$/, '')
    .trim();

  return cut.length >= 2 ? cut : null;
}

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
    payer: stopAtLabel(readField(source, [
      'received with thanks from', 'received from', 'paid by',
    ], { pattern: '[A-Za-z][A-Za-z .]{2,40}' })),

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
    // Bounded the same way. On flattened text this ran into "Amount", so a
    // school fee receipt said the payment was towards
    // "Term II Tuition Fee Amount".
    towards: stopAtLabel(readField(source, ['towards', 'being', 'on account of'],
      { pattern: '[A-Za-z][A-Za-z .&-]{2,60}' })),
  });
}

/** An insurance policy: who insures what, for how much, until when. */
/** A date, as `readLabelledDate` matches one. */
const DATE_PATTERN = '(\\d{1,2}[\\s\\-/.][A-Za-z0-9]{2,9}[\\s\\-/.,]*\\d{2,4}|\\d{4}[\\-/.]\\d{1,2}[\\-/.]\\d{1,2})';

/** Labels whose value *is* the expiry. */
const EXPIRY_LABELS = [
  'date of expiry', 'expiry date', 'expires on', 'valid (?:up ?to|till|until)',
  'policy end date', 'renewal date',
];

/**
 * Labels whose value is a *range*, where the expiry is the second date.
 *
 * `Period of Insurance: 18 May 25 to 17 May 26` is how a motor policy states
 * it, and `readLabelledDate` returns the first date of a range — the day cover
 * *started*. Filing that as the expiry would put a renewal reminder a year in
 * the past.
 */
const PERIOD_LABELS = ['period of insurance', 'policy period', '(?:od |tp )?cover period'];

/**
 * When a policy expires — or nothing, when it says more than one thing.
 *
 * Measured on two real motor policies:
 *
 *  - One states `Date of Expiry` **twice, with different dates**: a standalone
 *    own-damage policy that also prints the third-party cover it sits beside.
 *    One of those two is not this policy's expiry, and nothing in the text
 *    says which without understanding what OD and TP mean.
 *  - The other's period reads `18 May 25 12:00 AM to 17` — the end date lost
 *    to column interleaving in the PDF. A range with no second date is not a
 *    range, and the start is not an expiry.
 *
 * So a single agreed date is returned, and two different ones are returned as
 * a conflict for a person to settle. This is the rule `readEitherSide` already
 * follows, on the field where guessing costs the most: a renewal reminder that
 * fires on the wrong date stops anybody looking for the right one.
 */
function expiryOf(source) {
  const found = new Set();

  for (const label of EXPIRY_LABELS) {
    const re = new RegExp(`${label}[^0-9]{0,20}${DATE_PATTERN}`, 'gi');
    for (const m of source.matchAll(re)) {
      const date = readDate(m[1]);
      if (date) found.add(date);
    }
  }

  for (const label of PERIOD_LABELS) {
    // The second date only. A range missing its end is skipped rather than
    // read as a point.
    const re = new RegExp(
      `${label}[^0-9]{0,20}${DATE_PATTERN}[^0-9]{0,24}(?:to|until|–|—)[^0-9]{0,24}${DATE_PATTERN}`,
      'gi',
    );
    for (const m of source.matchAll(re)) {
      const date = readDate(m[2]);
      if (date) found.add(date);
    }
  }

  const dates = [...found].sort();
  if (dates.length === 1) return { expiresOn: dates[0] };
  // Absent rather than guessed, and the disagreement is handed back so a
  // screen can say *which* dates the document gave rather than going quiet.
  if (dates.length > 1) return { expiresOn: null, expiryConflict: dates };
  return {};
}

export function readPolicy(text) {
  const source = String(text ?? '');

  return prune({
    policyNumber: readField(source, ['policy (?:no|number)', 'certificate (?:no|number)']),
    insurer: readField(source, ['insurer', 'insurance company', 'issued by'], { pattern: '[A-Za-z][A-Za-z .&-]{2,50}' }),
    premium: readAmount(source, ['premium amount', 'total premium', 'premium payable', 'premium']),
    sumAssured: readAmount(source, ['sum assured', 'sum insured', 'coverage amount', 'cover amount']),
    ...expiryOf(source),
    startsOn: readLabelledDate(source, ['policy start date', 'commencement date', 'valid from', 'date of commencement']),
  });
}

/**
 * An agreement, read from the one part of it that is structured.
 *
 * The body of a deed is prose and is not parsed — a lease's rent, term and
 * notice period are sentences, and reading them with patterns would produce
 * exactly the confident wrong number this file exists to avoid. What *is*
 * structured is the Karnataka e-stamp header, which is identical across
 * leases, rental agreements and partnership deeds, and which is where the
 * money is: the stamp duty is a real payment.
 *
 * The parties are read and the consideration is not. A consideration of zero
 * is printed on every one of these as `(Zero)` beside a `0`, and a document
 * that says what it is worth is not the same as a document that says nothing;
 * telling those apart needs the body, which is prose.
 */
export function readAgreement(text) {
  const source = String(text ?? '');

  return prune({
    // `IN-KA…` — the certificate's own number, and the thing that can be
    // checked against the issuer's site. Either side of its label.
    certificateNumber: readEitherSide(source, ['certificate\\s*(?:no|number)'], {
      pattern: 'IN-[A-Z]{2}[0-9A-Z]{8,30}',
    }),

    issuedOn: readLabelledDate(source, ['certificate issued date', 'issued date', 'issued on']),

    // `Article 40(A) Partnership` / `Article 5(J) Agreement` — what the state
    // thinks this document is, which is more reliable than what the body of it
    // calls itself.
    documentType: readEitherSide(source, ['description of document'], {
      pattern: 'Article[^\\n]{3,60}',
    }),

    stampDuty: readAmount(source, ['stamp duty amount', 'stamp duty paid']),

    firstParty: stopAtLabel(readEitherSide(source, ['first party'], {
      pattern: '[A-Za-z][A-Za-z .]{2,50}',
    })),
    secondParty: stopAtLabel(readEitherSide(source, ['second party'], {
      pattern: '[A-Za-z][A-Za-z .]{2,50}',
    })),
  });
}

/**
 * A registration certificate.
 *
 * Every field here already exists on the `vehicle` entity — this is a document
 * the schema was ready for and the reader could not name. What is *not* here
 * is the chassis and engine numbers: the schema holds both `encrypted: true`,
 * so they belong in `identifiers`, where the caller puts them somewhere
 * encrypted, rather than in `fields` beside the colour.
 */
export function readVehicle(text) {
  const source = String(text ?? '');

  return prune({
    registrationNumber: readEitherSide(source, ['reg(?:n|istration)?[.\\s]*(?:no|number)'], {
      pattern: '[A-Z]{2}[\\s-]?[0-9]{1,2}[\\s-]?[A-Z]{1,3}[\\s-]?[0-9]{1,4}',
    }),
    make: readEitherSide(source, ['\\bMFR\\b', 'manufacturer', '\\bmake\\b'], {
      pattern: '[A-Za-z][A-Za-z .&-]{2,50}',
    }),
    model: readEitherSide(source, ['\\bmodel\\b'], { pattern: '[A-Z][A-Za-z0-9 ./-]{2,40}' }),
    kind: readEitherSide(source, ['\\bclass\\b', 'vehicle class'], {
      pattern: '[A-Za-z][A-Za-z ]{2,30}',
    }),
    // Enumerated rather than "the word beside FUEL". The card prints
    // `PETROL STDG/SLPR` on one line and `FUEL` on the next, so the nearest
    // word to the label is `SLPR` — seating type, read as a fuel. A fuel on an
    // RC is a closed set, so it is written as one.
    fuel: readEitherSide(source, ['\\bfuel\\b'], {
      pattern: '(?:PETROL|DIESEL|CNG|LPG|ELECTRIC|HYBRID|PETROL/CNG|PETROL/LPG)',
    }),
    colour: readEitherSide(source, ['colou?r'], { pattern: '[A-Za-z][A-Za-z ]{2,30}' }),

    registeredOn: readLabelledDate(source, ['reg[.\\s]*date', 'registration date', 'date of registration']),
    // `REGFC UPTO` is what the card prints — fitness, and the date the
    // registration stops being valid.
    validTill: readLabelledDate(source, ['reg\\s*fc\\s*upto', 'valid (?:up ?to|till|until)', 'fitness upto']),
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

  const READERS = {
    policy: readPolicy,
    receipt: readReceipt,
    bill: readBill,
    agreement: readAgreement,
    vehicle: readVehicle,
  };
  const fields = READERS[kind]?.(source) ?? {};

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
  // `validTill` is a registration certificate's own expiry, and routing it
  // here is the point of reading one: an RC that lapses unnoticed is a
  // vehicle that cannot legally be driven.
  const expiry = read.fields.expiresOn ?? read.fields.dueDate ?? read.fields.validTill ?? null;

  if (expiry && !existing.expiresOn) out.expiresOn = expiry;

  // `document.issuedOn` exists on the schema and nothing had ever written it.
  // An e-stamp's issue date is exactly that field: the date the state issued
  // the paper, which is not the date the parties signed it and not the date it
  // was filed here.
  if (read.fields.issuedOn && !existing.issuedOn) out.issuedOn = read.fields.issuedOn;

  // Where the document gave more than one expiry, the dates it gave are
  // carried onto the record rather than dropped. Without this, a policy whose
  // expiry is ambiguous is simply absent from the Expiring list — which reads
  // exactly like a policy with nothing to renew.
  //
  // Not written over a date a person already set: once somebody has decided,
  // the disagreement is settled and saying so again is noise.
  if (read.fields.expiryConflict?.length && !existing.expiresOn) {
    out.expiryConflict = read.fields.expiryConflict.join(', ');
  }

  const CATEGORY = {
    policy: 'insurance',
    bill: 'financial',
    agreement: 'legal',
    vehicle: 'vehicle',
  };
  const category = CATEGORY[read.kind];
  if (category && !existing.category) out.category = category;

  // Not the parties to an agreement: naming a document after one side of it is
  // a judgement about whose document it is, and a deed belongs to both.
  const name = read.fields.biller ?? read.fields.insurer ?? read.fields.registrationNumber;
  if (name && !existing.title) out.title = name;

  return out;
}

function prune(object) {
  return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== null && v !== undefined && v !== ''));
}
