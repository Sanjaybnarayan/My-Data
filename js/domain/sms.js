/**
 * SMS intelligence — Phase 6, the phase that was skipped.
 *
 * ## What a browser can and cannot do, decided first
 *
 * The prompt is explicit: *"SMS is an OPTIONAL Android-native capability. The
 * PWA must NOT depend on direct SMS access."* A browser cannot read an inbox,
 * and no amount of work here changes that.
 *
 * So this is **rule 55** in the prompt's own words — *"if Android SMS access is
 * not policy-eligible, implement the SMS abstraction and alternative ingestion
 * methods instead"*. Everything below works on message **text**, from wherever
 * it came: pasted in, imported from a backup, or one day handed over by a
 * native companion. The reading is the same; only the source differs, and the
 * source says which it was.
 *
 * `SOURCE.NATIVE` was `NOT_SUPPORTED` for exactly as long as that was true. It
 * is now real on the Android companion build — `js/core/smsinbox.js` reads the
 * inbox through a plugin — and still `NOT_SUPPORTED` in a browser and on iOS,
 * which has no inbox API for a third-party app and is not going to get one.
 *
 * The permission that makes it work is a Play restricted permission, so the
 * companion build is for sideloading. `AndroidManifest.xml` and
 * `docs/SMS_INTELLIGENCE.md` both say so at the point where somebody would
 * need to know.
 *
 * ## The rule that mattered most while writing this
 *
 * **Rule 53: an OTP must not be retained unnecessarily or sent to AI.** A bank
 * message carrying a one-time code looks, to every pattern here, exactly like a
 * bank message carrying a debit — same sender, same shape, often the same
 * amount. So the security check runs **first and independently**, and a message
 * classified `AUTHENTICATION_SECRET` never reaches extraction, never reaches a
 * notification, and carries no text forward at all.
 *
 * That ordering is the whole of the protection. A gate that runs after
 * extraction has already copied the code into a field.
 *
 * ## And rule 51: this is never authoritative
 *
 * An SMS is a *notification about* a transaction, not the transaction. It says
 * so on every reading: `authoritative: false`, and `SOURCE_PRIORITY` places it
 * below every statement. `reconcileWithStatement` links the two rather than
 * choosing, and a disagreement is a conflict for a person to settle — never a
 * silent pick.
 */

/** The prompt's categories, in its order. */
export const CATEGORY = Object.freeze([
  'BANK_DEBIT', 'BANK_CREDIT', 'UPI_PAYMENT', 'UPI_RECEIPT', 'CREDIT_CARD',
  'LOAN', 'EMI', 'FD', 'RD', 'SALARY', 'INVESTMENT', 'BROKER', 'INSURANCE',
  'REFUND', 'REVERSAL', 'FAILED_TRANSACTION', 'FASTAG', 'UTILITY',
  'SUBSCRIPTION', 'TRAVEL', 'DELIVERY', 'GOVERNMENT', 'OTP', 'SECURITY',
  'OTHER',
]);

/**
 * What a connector may report.
 *
 * Defined in `domain/connector.js` and re-exported here. It was written in
 * this file for Phase 6, where only SMS could reach it — and then Phase 4
 * needed the same words for Gmail, so it moved somewhere both can see. One
 * vocabulary, one meaning of `EXPIRED`.
 */
// Imported as well as re-exported: a bare `export ... from` forwards the name
// without binding it in this module, and `nativeStatus` below reads it.
import { CONNECTOR_STATUS } from './connector.js';

export { CONNECTOR_STATUS };

export const SOURCE = Object.freeze({
  /** Read from this device's inbox by the Android companion build. */
  NATIVE: 'native',
  /** Text a person pasted or a file they imported. Works everywhere. */
  IMPORTED: 'imported',
});

/**
 * The prompt's source priority, lowest number wins.
 *
 * SMS sits below every statement deliberately: rule 51. It is above nothing
 * except an AI inference, which is the point of both.
 */
export const SOURCE_PRIORITY = Object.freeze({
  'authorized-feed': 1,
  'bank-statement': 2,
  'card-statement': 3,
  'broker-statement': 4,
  sms: 5,
  'ai-inference': 6,
});

/* ------------------------------------------------------- security, first */

/**
 * Anything that is a credential rather than a record of money moving.
 *
 * Deliberately generous. A false positive costs a message being classified
 * `AUTHENTICATION_SECRET` and dropped, which loses a notification nobody needed;
 * a false negative copies somebody's one-time code into a database and possibly
 * into a model. Those are not comparable, so this errs hard.
 */
const SECRET_PATTERNS = [
  /\bOTP\b/i,
  /\bone[\s-]?time\s+(pass(word|code)?|code|pin)\b/i,
  /\bverification\s+code\b/i,
  /\bsecurity\s+code\b/i,
  /\bauth(entication)?\s+code\b/i,
  /\bCVV\b/i,
  /\bMPIN\b|\bUPI\s*PIN\b|\bATM\s*PIN\b/i,
  /\bdo\s*not\s*share\b/i,
  /\bpassword\s+is\b/i,
];

/**
 * Whether a message carries a credential.
 *
 * Runs before anything else touches the text — see the note at the top of this
 * file. Nothing calls this after extraction, because by then it is too late to
 * matter.
 */
export function isAuthenticationSecret(text) {
  const body = String(text ?? '');
  return SECRET_PATTERNS.some((pattern) => pattern.test(body));
}

/* ----------------------------------------------------------- classifying */

const CATEGORY_RULES = [
  // Ordered: a message can be several things and the first is the one that
  // decides, exactly as `domain/categorise.js` does for narrations.
  { category: 'FAILED_TRANSACTION', match: /\b(failed|declined|unsuccessful|could not be processed)\b/i },
  { category: 'REVERSAL', match: /\b(reversed|reversal|charge ?back)\b/i },
  { category: 'REFUND', match: /\brefund(ed)?\b/i },
  { category: 'EMI', match: /\bEMI\b/i },
  { category: 'LOAN', match: /\bloan\b/i },
  { category: 'FD', match: /\bfixed deposit\b|\bFD\b/i },
  { category: 'RD', match: /\brecurring deposit\b|\bRD\b/i },
  { category: 'SALARY', match: /\bsalary\b/i },
  { category: 'INSURANCE', match: /\b(premium|policy)\b/i },
  { category: 'BROKER', match: /\b(zerodha|groww|upstox|angel one|broker)\b/i },
  { category: 'INVESTMENT', match: /\b(mutual fund|SIP|folio|NAV|units? (allotted|purchased))\b/i },
  { category: 'FASTAG', match: /\bfastag\b/i },
  { category: 'CREDIT_CARD', match: /\bcredit card\b|\bcard ending\b|\bstatement\b/i },
  { category: 'UTILITY', match: /\b(electricity|water bill|gas bill|broadband|postpaid)\b/i },
  { category: 'SUBSCRIPTION', match: /\b(subscription|auto[- ]?renew|renewed for)\b/i },
  { category: 'TRAVEL', match: /\b(PNR|boarding|flight|train|IRCTC)\b/i },
  { category: 'DELIVERY', match: /\b(out for delivery|delivered|shipment|order)\b/i },
  { category: 'GOVERNMENT', match: /\b(income tax|GST|challan|RTO|passport)\b/i },
  { category: 'UPI_RECEIPT', match: /\bUPI\b[\s\S]*\b(credited|received)\b|\breceived\b[\s\S]*\bUPI\b/i },
  { category: 'UPI_PAYMENT', match: /\bUPI\b/i },
  { category: 'BANK_CREDIT', match: /\b(credited|deposited|received)\b/i },
  { category: 'BANK_DEBIT', match: /\b(debited|withdrawn|spent|paid)\b/i },
];

/** What a message is about. `OTP` and `SECURITY` come from the gate, not here. */
export function classify(text) {
  const body = String(text ?? '');
  if (!body.trim()) return 'OTHER';
  return CATEGORY_RULES.find((rule) => rule.match.test(body))?.category ?? 'OTHER';
}

/* ----------------------------------------------------------- extraction */

const AMOUNT = /(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i;
const ACCOUNT_TAIL = /\b(?:a\/c|acct|account|card)\s*(?:no\.?)?\s*(?:x+|\*+)?(\d{3,4})\b/i;
const UPI_REF = /\bUPI(?:\s*Ref(?:erence)?(?:\s*No\.?)?)?[:\s]*(\d{9,18})\b/i;
const UTR = /\bUTR[:\s]*([A-Z0-9]{8,22})\b/i;
const RRN = /\bRRN[:\s]*(\d{6,16})\b/i;
const BALANCE = /\b(?:avl|available|bal(?:ance)?)[^\d₹]{0,12}(?:INR|Rs\.?|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i;
const DATE = /\b(\d{2})[-/](\d{2})[-/](\d{2,4})\b/;

const minor = (text) => {
  if (!text) return null;
  const value = Number(String(text).replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
};

/**
 * What a message actually says, and nothing it does not.
 *
 * Every field is null when absent. The prompt's rule is *"never invent missing
 * values"*, and that is the same rule `domain/extract.js` follows for
 * documents — a wrong value is a claim, a missing one is a gap.
 */
/**
 * @param {{text?: string, sender?: string, receivedAt?: string}} message
 * @param {{source?: string}} [options] which of `SOURCE` this came from.
 *   Typed as a string rather than inferred from the default, because the
 *   default is `'imported'` and inference would make `'native'` — the whole
 *   point of the option — an error at every call site that passes it.
 */
export function read(message, options = {}) {
  const { source = SOURCE.IMPORTED } = options;
  const text = String(message?.text ?? '');

  // First, and before anything reads a field. A message that carries a
  // credential yields no fields at all — not even the ones that would be safe —
  // because the cheapest way to never store an OTP is to never parse the
  // message that contains one.
  if (isAuthenticationSecret(text)) {
    return {
      category: /\bOTP\b|\bone[\s-]?time\b/i.test(text) ? 'OTP' : 'SECURITY',
      classification: 'AUTHENTICATION_SECRET',
      secret: true,
      // Deliberately absent: no text, no amount, no reference. Rule 53.
      text: null,
      amount: null,
      authoritative: false,
      source,
      sender: message?.sender ?? null,
      receivedAt: message?.receivedAt ?? null,
    };
  }

  const category = classify(text);
  const credit = /\b(credited|received|deposited|refund(ed)?)\b/i.test(text);
  const debit = /\b(debited|withdrawn|spent|paid|purchase)\b/i.test(text);

  return {
    category,
    classification: 'SENSITIVE',
    secret: false,
    text,
    source,
    sender: message?.sender ?? null,
    receivedAt: message?.receivedAt ?? null,
    amount: minor(AMOUNT.exec(text)?.[1]),
    // Only where the message says so. A message that names neither is left
    // undecided rather than guessed from the category.
    direction: credit && !debit ? 'in' : debit && !credit ? 'out' : null,
    accountTail: ACCOUNT_TAIL.exec(text)?.[1] ?? null,
    upiReference: UPI_REF.exec(text)?.[1] ?? null,
    utr: UTR.exec(text)?.[1] ?? null,
    rrn: RRN.exec(text)?.[1] ?? null,
    balance: minor(BALANCE.exec(text)?.[1]),
    transactionDate: readDate(text),
    // Rule 51, on every single reading. An SMS is a notification about a
    // transaction, never the transaction.
    authoritative: false,
  };
}

function readDate(text) {
  const found = DATE.exec(String(text ?? ''));
  if (!found) return null;
  const [, d, m, y] = found;
  const year = y.length === 2 ? `20${y}` : y;
  const iso = `${year}-${m}-${d}`;
  return Number.isNaN(Date.parse(`${iso}T00:00:00Z`)) ? null : iso;
}

/* ------------------------------------------------------------ duplicates */

/**
 * A stable fingerprint, so the same message read twice is one event.
 *
 * Over the fields a resend cannot change. Deliberately **not** the received
 * time: the same message arriving twice has two timestamps, and including one
 * would defeat the whole purpose.
 */
export function fingerprint(reading) {
  return [
    reading?.sender ?? '',
    reading?.amount ?? '',
    reading?.direction ?? '',
    reading?.accountTail ?? '',
    reading?.utr ?? reading?.upiReference ?? reading?.rrn ?? '',
    reading?.transactionDate ?? '',
  ].join('|');
}

/** The prompt's test: the same SMS twice is one event. */
export function dedupe(readings) {
  const seen = new Map();
  for (const reading of readings ?? []) {
    if (!reading || reading.secret) continue;
    const key = fingerprint(reading);
    if (!seen.has(key)) seen.set(key, reading);
  }
  return [...seen.values()];
}

/* -------------------------------------------------------------- conflict */

export const AGREEMENT = Object.freeze({
  /** Same money, same account, same day. Two sources for one event. */
  LINKED: 'linked',
  /** Both describe the same event and disagree about the amount. */
  CONFLICT: 'conflict',
  /** Nothing to say. */
  NONE: 'none',
});

/**
 * An SMS against the statement row it probably describes.
 *
 * The prompt's test: SMS ₹5,000 and statement ₹5,500 is a **conflict**, and the
 * two amounts are both shown. Never a silent choice — which is the same rule
 * `domain/events.js` follows for near-matches, for the same reason.
 *
 * Linking is by reference first (a UTR or UPI reference is the strongest thing
 * either source carries), then by account tail and day. Amount is compared
 * *after* the link, never used to make it — otherwise a conflict could never be
 * detected, because the amounts differing would stop them matching at all.
 */
export function reconcileWithStatement(reading, transactions, { days = 1 } = {}) {
  if (!reading || reading.secret || !reading.amount) {
    return { agreement: AGREEMENT.NONE, transaction: null, why: null };
  }

  const sameReference = (txn) => {
    const reference = String(txn?.reference ?? '');
    const narration = String(txn?.narration ?? '');
    return [reading.utr, reading.upiReference, reading.rrn]
      .filter(Boolean)
      .some((ref) => reference.includes(ref) || narration.includes(ref));
  };

  const nearInTime = (txn) => {
    if (!reading.transactionDate || !txn?.date) return false;
    const gap = Math.abs(Date.parse(`${txn.date}T00:00:00Z`)
      - Date.parse(`${reading.transactionDate}T00:00:00Z`)) / 86_400_000;
    return gap <= days;
  };

  const sameAccount = (txn) => reading.accountTail
    && String(txn?.accountNumber ?? '').endsWith(reading.accountTail);

  const candidates = (transactions ?? []).filter((txn) => txn && !txn.deletedAt
    && (sameReference(txn) || (sameAccount(txn) && nearInTime(txn))));

  if (!candidates.length) {
    return { agreement: AGREEMENT.NONE, transaction: null, why: null };
  }

  // A reference match beats a date-and-account match: it is the one thing both
  // sources copy from the same underlying rail.
  const match = candidates.find(sameReference) ?? candidates[0];

  if (match.amount === reading.amount) {
    return {
      agreement: AGREEMENT.LINKED,
      transaction: match,
      why: null,
      // Rule 52: linked, not duplicated. One event, two pieces of evidence.
      evidence: ['sms', 'bank-statement'],
    };
  }

  return {
    agreement: AGREEMENT.CONFLICT,
    transaction: match,
    sms: reading.amount,
    statement: match.amount,
    difference: match.amount - reading.amount,
    // The statement wins on priority, and that is *reported*, not applied.
    // Which figure is right is a question for the household.
    why: 'the message and the statement disagree about the amount. The statement '
      + 'ranks higher, but nothing here changes a figure on its own.',
  };
}

/**
 * What the native capability can honestly report, on this device.
 *
 * Answered from what is actually present rather than from a constant. A
 * browser and the iOS shell get `NOT_SUPPORTED` and always will — iOS has no
 * inbox API for a third-party app. An Android build with the plugin compiled
 * in reports against the permission, because "can read" and "is allowed to
 * read" are different facts and a screen needs to tell them apart.
 *
 * @param {{available?: boolean, permission?: string}} [device] what the
 *   platform reports; `js/core/smsinbox.js` supplies it. Injected rather than
 *   read here so this stays a pure function about a situation.
 */
export function nativeStatus(device = {}) {
  if (!device.available) {
    return {
      status: CONNECTOR_STATUS.NOT_SUPPORTED,
      why: 'this build cannot read an SMS inbox. A browser has no such API, and '
        + 'neither does iOS for an application that is not the messages app. '
        + 'On Android it needs the companion build, which carries a permission '
        + 'that decides where the application can be distributed.',
      alternatives: ['paste a message', 'import an exported backup'],
    };
  }

  if (device.permission !== 'granted') {
    return {
      status: CONNECTOR_STATUS.AUTH_REQUIRED,
      why: 'this device can read the inbox but has not been given permission. '
        + 'Android asks once, and a refusal is final until it is changed in '
        + 'system settings.',
      alternatives: ['paste a message', 'import an exported backup'],
    };
  }

  return {
    status: CONNECTOR_STATUS.CONNECTED,
    // Said here because this is the string a screen shows. A household reading
    // "connected" is entitled to know it means "read when you ask", not
    // "watching", and rule 51 does not stop applying because capture got
    // easier.
    why: 'messages are read from this device when you ask. Nothing runs in the '
      + 'background, no message is intercepted as it arrives, and a message is '
      + 'still never authoritative — it is checked against a statement.',
    alternatives: ['paste a message', 'import an exported backup'],
  };
}
