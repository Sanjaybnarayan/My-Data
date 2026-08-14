/**
 * A payment-app statement, which is not an account statement.
 *
 * ## What this file is for
 *
 * A PhonePe, GPay or Paytm export lists what somebody *did* — the merchant,
 * the biller, the loan instalment — across **every bank account the app is
 * linked to**. A bank statement lists what happened on **one** account, and
 * names the counterparty in whatever the payment rail wrote into the
 * narration.
 *
 * They are two records of the same movements, and this is the crux:
 *
 * > **A payment-app row is not a new economic event.** It is a bank row seen
 * > from the other side.
 *
 * Import both without linking them and the household's spending doubles.
 * `domain/settlement.js` names the same hazard for a card bill paid from a
 * bank account; this is that hazard again, across a thousand rows at once.
 *
 * ## Measured
 *
 * One real PhonePe export, April to August:
 *
 *     rows                       : 1,047
 *     distinct UTRs              : 1,046
 *     accounts it spans          : 4
 *       Paid by XXXXXXXX8177     :   693      Credited to XXXXXXXXXX84 : 16
 *       Paid by XXXXXXXXXX84     :   268      Credited to XXXXXXXX8963 :  8
 *       Paid by XXXXXXXX8963     :    55      Credited to XXXXXXXX8177 :  5
 *       Paid by XXXX005391       :     1
 *
 * Every one of those four is an account whose own bank statement the household
 * also has. Where both records cover the same payment, **the UTR appears
 * verbatim inside the bank's narration**:
 *
 *     PhonePe : Paid to ZOMATO LIMITED   ₹30   UTR 876987316943
 *     bank    : UPI/ZOMATO LIM/zomato-order@p/Zomato Pay/YES BANK L/876987316943
 *
 * That is an exact identity, not a resemblance — no amount tolerance, no date
 * window, no name matching. It is the one link this file will assert.
 */

/** `Paid by XXXXXXXX8177` / `Credited to XXXXXXXXXX84`. */
const INSTRUMENT = /^\s*(paid by|credited to|debited from|refunded to)\s+(.+?)\s*$/i;

/**
 * Which account a row moved on, and which way.
 *
 * @returns {{masked: string, digits: string, direction: 'in'|'out'}|null}
 */
export function readInstrument(cell) {
  const match = INSTRUMENT.exec(String(cell ?? ''));
  if (!match) return null;

  const masked = match[2].trim();
  return {
    masked,
    // The visible tail, which is all a mask leaves. `XXXXXXXX8177` gives
    // `8177`, and that is what an account on record has to end with.
    digits: masked.replace(/\D/g, ''),
    direction: /^paid by|^debited from$/i.test(match[1]) ? 'out' : 'in',
  };
}

/**
 * What kind of thing a payment app says this was.
 *
 * The app knows things the bank never writes down — that a debit was a loan
 * instalment rather than a transfer, that a recharge was a phone and not a
 * FASTag. Ordered, and matched against the start of the detail line, because
 * that is where every one of these labels sits.
 */
/** @type {Array<[string, RegExp]>} */
const KINDS = [
  ['loan-repayment', /^loan (?:installment|instalment|repayment|emi)/i],
  ['insurance', /^insurance\b/i],
  ['electricity', /^electricity bill/i],
  ['water', /^water bill/i],
  ['gas', /^(?:cylinder booking|gas bill|lpg)/i],
  ['recharge', /^(?:mobile recharged|recharge|dth)/i],
  ['fastag', /^fastag/i],
  ['self-transfer', /^(?:transfer to|withdrawn from)/i],
  ['received', /^(?:received from|refund from|cashback)/i],
  ['bill', /^(?:payment to|bill payment)/i],
  ['paid', /^paid to/i],
];

/** @returns {string} one of the kinds above, or `other`. */
export function kindOf(details) {
  const text = String(details ?? '').trim();
  return KINDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other';
}

/**
 * Who or what was on the other end, with the app's own verb removed.
 *
 * `Paid to ZOMATO LIMITED` is a payment to Zomato; the words *paid to* are the
 * app's, not the merchant's, and leaving them in the narration puts them in
 * front of every categorisation rule and every payee name.
 */
export function counterpartyOf(details) {
  return String(details ?? '')
    .replace(/^\s*(?:paid to|received from|transfer to|payment to|withdrawn from|refund from)\s+/i, '')
    .replace(/^\s*(?:mobile recharged|electricity bill|water bill|fastag recharge|cylinder booking|loan installment|loan instalment|insurance)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A payment-app export, as opposed to a bank's.
 *
 * Recognised by the columns it carries rather than by a brand name: a file
 * that says which instrument each row moved on, row by row, is describing
 * several accounts and cannot be treated as one account's statement.
 */
export function isPaymentApp(parsed) {
  const rows = parsed?.transactions ?? [];
  return rows.length > 0 && rows.some((row) => readInstrument(row.instrument));
}

/**
 * The accounts a statement spans, and how much moved on each.
 *
 * The importer matches a statement to **one** account. A payment-app export
 * has no single account to match, and forcing one would file every payment the
 * household made from any of their banks against whichever account happened to
 * score highest.
 *
 * @returns {Array<{masked, digits, rows, out, in: number}>} busiest first
 */
export function byInstrument(transactions = []) {
  const found = new Map();

  for (const row of transactions) {
    const instrument = readInstrument(row.instrument);
    if (!instrument) continue;

    const entry = found.get(instrument.digits) ?? {
      masked: instrument.masked, digits: instrument.digits, rows: 0, out: 0, in: 0,
    };
    entry.rows += 1;
    entry[row.direction === 'in' ? 'in' : 'out'] += row.amount ?? 0;
    // The longest mask wins as the label: `XXXXXXXX8963` says more than `8963`,
    // and the same account is written both ways in one file.
    if (instrument.masked.length > entry.masked.length) entry.masked = instrument.masked;
    found.set(instrument.digits, entry);
  }

  return [...found.values()].sort((a, b) => b.rows - a.rows);
}

/**
 * Rows that are the same movement as one already imported from a bank.
 *
 * Matched on the UTR alone, and only where the bank's own narration contains
 * it. That is an identity the two records share, so no tolerance is applied
 * and nothing is inferred from an amount or a name being close.
 *
 * @param {Array<object>} transactions payment-app rows
 * @param {Set<string>|Map<string, any>} bankReferences UTRs already on record
 * @returns {{seen: object[], fresh: object[]}}
 */
export function alreadyOnRecord(transactions = [], bankReferences = new Set()) {
  const has = (utr) => (bankReferences instanceof Map
    ? bankReferences.has(utr) : bankReferences.has?.(utr));

  const seen = [];
  const fresh = [];

  for (const row of transactions) {
    const utr = String(row.utr ?? '').trim();
    // No UTR is not evidence of anything. A row the bank never referenced is
    // reported as fresh, because refusing to import it would lose a real
    // payment on the strength of a missing field.
    if (utr && has(utr)) seen.push(row);
    else fresh.push(row);
  }

  return { seen, fresh };
}

/**
 * Every bank reference a set of already-imported transactions mentions.
 *
 * Built from the narration, because that is where the rail writes it: the bank
 * has no column for it. Twelve digits is the UPI/IMPS reference length, and
 * anchoring on word boundaries keeps it from matching the middle of a longer
 * account number.
 */
export function referencesIn(transactions = []) {
  const found = new Set();

  for (const row of transactions) {
    const text = `${row.raw ?? ''} ${row.description ?? ''} ${row.reference ?? ''}`;
    for (const match of text.match(/\b\d{12}\b/g) ?? []) found.add(match);
    if (row.utr) found.add(String(row.utr));
  }

  return found;
}

/**
 * What a payment-app import is about to do, as a sentence.
 *
 * @param {{accounts?: Array<object>, seen?: number, fresh?: number}} summary
 * @param {(n: number) => string} [money]
 */
export function describeImport({ accounts = [], seen = 0, fresh = 0 }, money = (n) => String(n)) {
  if (!accounts.length) return null;

  const spans = accounts.length === 1
    ? `one account (${accounts[0].masked})`
    : `${accounts.length} accounts — ${accounts.map((a) => a.masked).join(', ')}`;

  const moved = accounts.reduce((total, a) => total + a.out, 0);

  const parts = [
    `This is a payment app's record, not an account's: ${fresh + seen} payments `
    + `across ${spans}, ${money(moved)} out.`,
  ];

  if (seen) {
    parts.push(` ${seen} of them are already imported from a bank statement — `
      + 'the same movements, seen from the other side — and are marked as '
      + 'duplicates rather than counted twice.');
  } else {
    parts.push(' None of them matches a transaction already imported. If the '
      + 'bank statements for these accounts are imported later, the same '
      + 'payments will arrive again from the other side.');
  }

  return parts.join('');
}

/* ------------------------------------------------- one file, many accounts */

/**
 * Which account on record each instrument is.
 *
 * A mask leaves only a tail — `XXXXXXXX8177` says the account ends 8177 and
 * nothing else — so the test is that the recorded number ends with those
 * digits. `domain/import.js` scores a whole header; there is nothing here to
 * score, because a payment app prints no IFSC, no holder and no bank.
 *
 * **Four digits is the floor.** `XXXX...84` leaves two, and two digits match
 * one account in every hundred by chance; filing a household's spending
 * against an account picked that way is worse than not filing it. Where the
 * tail is too short to be sure, it is left unmatched rather than guessed.
 *
 * More than one account ending in the same digits is also unmatched: the file
 * cannot say which, and neither can this.
 *
 * @returns {Array<{digits, masked, rows, out, in, account: object|null, why: string|null}>}
 */
export function matchInstruments(instruments = [], accounts = []) {
  const live = (accounts ?? []).filter((a) => !a.deletedAt);

  return (instruments ?? []).map((instrument) => {
    const tail = instrument.digits ?? '';

    if (tail.length < 4) {
      return {
        ...instrument,
        account: null,
        why: `the app masks this one down to “${instrument.masked}”, and `
          + `${tail.length || 'no'} digit${tail.length === 1 ? '' : 's'} is not enough to tell `
          + 'which account it is',
      };
    }

    const hits = live.filter((account) => {
      const ours = String(account.accountNumber ?? '').replace(/\D/g, '');
      return ours.length >= 4 && ours.endsWith(tail);
    });

    if (hits.length === 1) return { ...instrument, account: hits[0], why: null };

    return {
      ...instrument,
      account: null,
      why: hits.length
        ? `${hits.length} accounts on record end in ${tail}, and the file does not say which`
        : `no account on record ends in ${tail}`,
    };
  });
}

/**
 * The rows of a payment-app file, split by the account they moved on.
 *
 * One file, several accounts, and the split is not cosmetic: a transaction's
 * account decides which balance it changes and whose spending it is. A group
 * with no matching account keeps its rows and carries the reason — **they are
 * not filed against a guess**, because a payment put on the wrong account is
 * invisible afterwards and wrong in two places at once.
 *
 * @param {Array<object>} transactions
 * @param {Array<object>} matched from `matchInstruments`
 * @returns {Array<{digits, masked, account, why, rows: object[]}>}
 */
export function splitByAccount(transactions = [], matched = []) {
  const groups = new Map(matched.map((entry) => [entry.digits, { ...entry, rows: [] }]));

  for (const row of transactions) {
    const instrument = readInstrument(row.instrument);
    if (!instrument) continue;
    groups.get(instrument.digits)?.rows.push(row);
  }

  return [...groups.values()];
}

/**
 * What the split is about to do, as a sentence.
 *
 * @param {Array<object>} groups from `splitByAccount`
 */
export function describeSplit(groups = []) {
  const known = groups.filter((group) => group.account);
  const unknown = groups.filter((group) => !group.account);

  if (!groups.length) return null;

  const parts = [];

  if (known.length) {
    parts.push(`${known.map((g) => `${g.rows.length} to ${g.account.name}`).join(', ')}.`);
  }

  for (const group of unknown) {
    parts.push(` ${group.rows.length} rows moved on ${group.masked} and cannot be `
      + `imported: ${group.why}.`);
  }

  return parts.join('').trim();
}
