/**
 * What must never reach a searchable field, and how it is recognised.
 *
 * Split out of `extract.js` when `tools/module-size.mjs` refused to let that
 * file grow past eight hundred lines — the same seam that sent the scalar
 * readers to `extract-values.js` and the identity-document readers to
 * `identifiers.js`. Imported from here rather than re-exported through its old
 * home, so the seam is visible at every call site.
 *
 * The division is a real one rather than a line count. Everything else in
 * `extract.js` answers *what does this document say*; this answers *what must
 * be taken out of it before the text is stored*, and it is the only half where
 * being wrong costs a household a secret rather than a filled-in field.
 */

/* ------------------------------------------------------------ identifiers */

/** How far either side of a match counts as "beside" it. */
const CONTEXT = 40;

/** Words that mean the digits beside them are a card, whatever they add to. */
const CARD_WORD = /\b(card|debit|credit|visa|mastercard|rupay|amex)\b/i;
/** What names a Virtual ID beside the digits. UIDAI prints it as `VID`. */
const VID_WORD = /\bVID\b|virtual\s*id/i;

/**
 * Twelve digits that are **not part of a longer run** — an Aadhaar's shape.
 *
 * Named because two rules below need exactly it: the one gated on the words
 * UIDAI prints, and the one gated on the `UID` abbreviation a KYC form uses.
 * Written twice they could drift, and the lookarounds are the half that took
 * two goes to get right — see the rule that carries the explanation.
 *
 * A regex with `g` carries `lastIndex`, so the two rules cannot share one
 * object: this is the source, and each rule builds its own from it.
 */
const AADHAAR_SHAPE = '(?<!\\d)(?<!\\d[ \\t-])\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b(?![ \\t-]?\\d)';

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
    /*
     * A **VID** — the sixteen-digit Virtual ID printed on every modern
     * eAadhaar, directly beneath the Aadhaar number it substitutes for.
     *
     * It is listed above the Aadhaar rule because it must claim its digits
     * first. `readIdentifiers` dedupes by value and the first rule to claim a
     * run wins, and what happened when nothing claimed this one is the reason
     * both halves of this entry exist. Measured on a real eAadhaar:
     *
     *     found:     Aadhaar 2233 4455 6677     ← the real one
     *                Aadhaar 9123 4567 8901     ← the VID, twelve of sixteen
     *     redacted:  VID : [Aadhaar removed] 2345
     *
     * Two faults from one greedy pattern. The household was **offered a wrong
     * Aadhaar number to file** — the first twelve digits of a VID, belonging
     * to nobody, with nothing on the screen to say which of the two candidates
     * was real. And four digits of the VID were left in `ocrText`, which is
     * unencrypted because it is searchable: a trailing fragment of a
     * credential, which is exactly what the redaction exists to stop.
     *
     * A VID is not filed. `IDENTIFIER_KINDS` has no entry for it, so it comes
     * back through the `no-home` branch — "kept out of the searchable text,
     * and there is nowhere in these records to keep it" — which is the honest
     * answer: UIDAI issues a VID to be *used in place of* the Aadhaar number
     * and lets the holder regenerate it, so a stored one is a number that
     * quietly stops being true.
     *
     * `keep` rather than `near` alone, for the reason the card rule gives:
     * presence is not proximity. An eAadhaar says "VID" somewhere, and a
     * document-wide gate would redact every sixteen-digit run on the page as
     * though it were one.
     */
    kind: 'VID',
    near: /\bVID\b|virtual\s*id/i,
    pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{16}\b/g,
    keep: (value, nearby) => VID_WORD.test(nearby),
  },
  {
    kind: 'Aadhaar',
    near: /aadhaar|aadhar|\bUIDAI\b|unique identification/i,
    /*
     * Twelve digits that are **not part of a longer run**.
     *
     * The lookarounds are the fix for the fault described above, and they
     * matter beyond the VID: without them the first twelve digits of any
     * sixteen-digit number on a page that mentions Aadhaar came back as an
     * Aadhaar, a card number on a KYC form included.
     *
     * They are deliberately narrower than the separator inside the number:
     * `[ \t-]` outside, `[\s-]` within. A newline may sit between two groups
     * of one number when the row reassembly breaks a line, and treating a
     * following line as "more digits" would make this rule *miss* an Aadhaar
     * — and a missed Aadhaar stays in the searchable text, which is the
     * expensive direction to be wrong in.
     *
     * `[\s-]` inside also widens what is caught: `2233-4455-6677` matched
     * nothing before this and was left in the text whole.
     */
    pattern: new RegExp(AADHAAR_SHAPE, 'g'),
  },
  {
    /*
     * The same number, where the document calls it a **UID**.
     *
     * `near` above lists `aadhaar`, `aadhar`, `UIDAI` and `unique
     * identification`, and not the abbreviation every bank KYC form uses.
     * Measured: `UID 234567890123 recorded at branch` came through whole.
     *
     * A separate rule rather than one more alternative in that `near`, and
     * the difference is the one this file has already paid for twice.
     * `readIdentifiers` tests `near` against the **whole document** — so
     * adding `UID` there would mean that any page containing the token,
     * including a UPI narration or a reference in a footer, has every
     * Aadhaar-shaped run on it redacted. That is the fault the card rule
     * describes in its own words: "presence is not proximity".
     *
     * So `keep` gates it on the forty characters around the digits, the way
     * the VID rule does. A document that says UID beside twelve digits loses
     * them; a document that says UID somewhere else does not.
     *
     * Same `kind`, so it dedupes against the rule above and files through
     * `IDENTIFIER_KINDS.Aadhaar` exactly as that one does.
     *
     * It will sometimes take a transaction reference labelled UID, and that
     * is the direction this file says to be wrong in: "a missed Aadhaar stays
     * in the searchable text, which is the expensive direction".
     */
    kind: 'Aadhaar',
    near: /\bUID\b/i,
    pattern: new RegExp(AADHAAR_SHAPE, 'g'),
    keep: (value, nearby) => /\bUID\b/i.test(nearby),
  },
  {
    // An Aadhaar enrolment id — `1234/56789/01234` — printed at the top of
    // every eAadhaar above the word "Enrolment". It survived into the
    // searchable text on a real document while the Aadhaar number three lines
    // below it was correctly removed, which is the whole argument for shape
    // *and* label: nothing about fourteen digits in that grouping is
    // recognisable, and the word beside it is.
    //
    // It is not the Aadhaar number and cannot be turned into one, but it is
    // what UIDAI's own status and reprint services take, so it belongs on the
    // same side of this line.
    kind: 'Enrolment',
    near: /enrolment|enrollment|\bEID\b/i,
    pattern: /\b\d{4}\/\d{5}\/\d{5}\b/g,
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

  /*
   * This is here for the reason the pair above are, applied to the documents
   * this application actually ingests.
   *
   * The rule this file states for itself is that a value the schema has
   * already marked `encrypted: true` must not reach `ocrText`. Measured
   * against that rule, two were missing — and both sit on document categories
   * the schema names:
   *
   *     Account No: 501000123456789      → survived whole
   *
   * `account.accountNumber` and the account a `bankStatement` is for are
   * `encrypted: true`. The application had decided, and was writing them in
   * the clear into a field that is searchable and therefore syncs to a cell in
   * the household's Sheet. A bank statement is exactly the paper a household
   * scans.
   *
   * Anchored on the label through `at`, like the chassis and engine rules and
   * for the same reason: nine to eighteen digits is also a reference number,
   * an invoice number and a UPI narration, and redacting every such run would
   * gut the text. `UPI/P2A/609812345678/RENT` on the line below the account
   * number is left alone by this, which is correct — it is a transaction
   * reference and not an account.
   *
   * ## A policy number is the same fault and is deliberately not fixed here
   *
   * `insurance.policyNumber` and `vehicle.insurancePolicy` are `encrypted:
   * true` too, and a policy number survives into `ocrText` whole — measured,
   * three lines above a chassis number that is correctly removed.
   *
   * The rule is one line and is not written, because removing it costs
   * something a check already names. `tests/import.test.mjs` asserts a
   * document is findable by the policy number inside it and calls that "the
   * whole reason the text is stored". A policy number is the number a
   * household would actually search for, which is not true of a chassis
   * number. Redacting it trades a stated feature for a confidentiality the
   * schema has already asked for, and which of those a household wants is
   * theirs to say rather than a thing to decide inside a regex.
   */
  /*
   * A payslip and a PF passbook, by the same rule as the account number.
   *
   * `employment.uan` and `employment.pfNumber` are `encrypted: true`, and
   * both survived whole — measured:
   *
   *     UAN: 101234567890   PF No: KN/BNG/0012345/000/0001234
   *
   * A UAN is twelve digits and a PF number is an establishment code with
   * slashes; neither shape is recognisable on its own, and both labels are
   * printed on every payslip. So both are anchored on the label, like the
   * chassis and engine rules above.
   */
  {
    kind: 'UAN',
    at: /\bUAN\b[.\s]*(?:no|number)?[:.\s]+(\d{12})\b/gi,
  },
  {
    kind: 'PF',
    at: /\bPF\b[.\s]*(?:a\/c|account|no|number)?[:.\s]+([A-Z0-9][A-Z0-9/-]{6,29})\b/gi,
  },
  {
    kind: 'Account',
    at: /(?:a\/c|acct|account)[.\s]*(?:no|number)?[:.\s]+(\d{9,18})\b/gi,
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