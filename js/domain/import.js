/**
 * Turning statements into records.
 *
 * The workflow this is built for is the one people actually have: once a
 * month, download every statement for every account in the household and drop
 * the whole pile in at once. Everything here follows from that.
 *
 * **Which account is this?** Nobody wants to tell the application, for the
 * ninth file in a row, which of a family's accounts it is looking at. The
 * statement says so — account number, IFSC, bank, holder — so the file is
 * matched against the accounts already on record and only asks when it is not
 * sure. The match is scored rather than exact, because a statement may print
 * `XXXXXX8963` where the account record holds the full number.
 *
 * **Was this month already loaded?** A monthly habit means re-uploading the
 * same PDF sooner or later, and overlapping periods when a statement is
 * re-downloaded with a wider range. Every transaction therefore carries a
 * fingerprint of the things a bank cannot change about it, and a row whose
 * fingerprint is already present is skipped rather than duplicated. Getting
 * this wrong does not produce an error — it produces a household that thinks
 * it spent twice what it did.
 *
 * **Nothing is written until it adds up.** A statement whose arithmetic does
 * not close, or which has rows the parser could not read, is reported and left
 * to the person to decide about. Silently importing 96% of a statement is the
 * failure mode that destroys trust in the numbers months later.
 */

import { categorise, resolveAliases, categoryKind } from './categorise.js';
import { parseStatement, reconcile } from './statement.js';

/* ------------------------------------------------------------- fingerprint */

/**
 * A stable identity for one line of one statement.
 *
 * Built only from things the bank cannot restate: the account, the date, the
 * amount, the direction and the bank's own reference. Where there is no
 * reference — cash, charges, sweeps — the narration stands in, normalised so
 * that a change of spacing between two downloads does not look like a
 * different transaction.
 *
 * The serial number is deliberately *not* part of it: it restarts at 1 in
 * every statement, so including it would make the same transaction look new in
 * every overlapping download.
 */
export function fingerprint(accountId, transaction) {
  // The narration, whole. Not a prefix of it: three ATM withdrawals of the
  // same amount at the same machine on the same day differ only in a trailing
  // reference number, and truncating the narration merges them into one — a
  // silent loss of two real withdrawals, which is far worse than a duplicate.
  const narration = String(transaction.description ?? transaction.raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  return [
    accountId,
    transaction.date,
    transaction.amount,
    transaction.direction,
    transaction.reference || '',
    narration,
    // The balance after the row. The bank restates it identically in every
    // download, and it is the last thing separating two rows a statement
    // otherwise prints the same way twice.
    transaction.printedBalance ?? '',
  ].join('|');
}

/* ---------------------------------------------------------- which account */

const digits = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * How well a statement's header matches an account already on record.
 *
 * Scored, not exact. A statement often prints a masked number, and an account
 * record may hold it with spaces or dashes — so the test is that one number's
 * digits end with the other's, which is true for `XXXXXX8963` against
 * `1234568963` and false for two unrelated accounts.
 *
 * @returns {number} 0 for no evidence, higher for better
 */
export function scoreAccount(header, account) {
  let score = 0;

  const theirs = digits(header.number);
  const ours = digits(account.accountNumber);
  if (theirs && ours) {
    if (theirs === ours) score += 100;
    else if (theirs.length >= 4 && (ours.endsWith(theirs) || theirs.endsWith(ours))) score += 60;
    // Two different numbers at the same bank are two different accounts, and
    // no amount of matching IFSC or bank name changes that. Without this a
    // household's second Kotak account collects the first one's statements.
    else return 0;
  }

  if (header.ifsc && account.ifsc
    && header.ifsc.toUpperCase() === String(account.ifsc).toUpperCase()) score += 25;

  const bank = String(header.bank ?? '').toLowerCase();
  const institution = String(account.institution ?? '').toLowerCase();
  if (bank && institution && (bank.includes(institution) || institution.includes(bank))) score += 10;

  // An archived account still matches, but never beats a live one — a closed
  // account and its replacement often share a bank and a holder.
  if (account.archived) score -= 5;

  return score;
}

/**
 * Pick the account a statement belongs to.
 *
 * A weak best match is reported as `sure: false` rather than used. Filing a
 * year of transactions against the wrong account is far more work to undo than
 * answering one question at import time.
 *
 * @param {{number, ifsc, bank, holder}} header from `readAccount`
 * @param {object[]} accounts
 * @returns {{account: object|null, sure: boolean, score: number, alternatives: object[]}}
 */
export function matchAccount(header, accounts) {
  const scored = (accounts ?? [])
    .map((account) => ({ account, score: scoreAccount(header, account) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  const runnerUp = scored[1];

  return {
    account: best?.account ?? null,
    score: best?.score ?? 0,
    // Sure means the number itself matched and nothing else came close.
    sure: Boolean(best && best.score >= 60 && (!runnerUp || best.score - runnerUp.score >= 25)),
    alternatives: scored.slice(1, 4).map((row) => row.account),
  };
}

/**
 * The account record a statement describes, for when there is nothing to match
 * against yet. The number is left as the statement printed it — masked if that
 * is how it came — so nobody is invited to invent the missing digits.
 */
export function accountFromStatement(header, personId = '') {
  return {
    name: `${header.bank || 'Bank'} ${String(header.number ?? '').slice(-4)}`.trim(),
    kind: /current/i.test(header.type ?? '') ? 'current' : 'savings',
    institution: header.bank || '',
    accountNumber: header.number || '',
    ifsc: header.ifsc || '',
    holder: personId,
    includeInNetWorth: true,
    archived: false,
  };
}

/* ------------------------------------------------------- the record shapes */

/** Our fine-grained category → the one the schema stores. */
const CATEGORY = {
  restaurant: 'restaurant',
  'food-delivery': 'food delivery',
  'quick-commerce': 'quick commerce',
  groceries: 'groceries',
  'e-commerce': 'e-commerce',
  retail: 'retail',
  hotel: 'hotel',
  travel: 'travel',
  fuel: 'fuel',
  entertainment: 'entertainment',
  subscription: 'subscription',
  bills: 'bills',
  healthcare: 'health',
  insurance: 'insurance',
  emi: 'EMI',
  'loan-repayment': 'loan repayment',
  'credit-card': 'credit card',
  tax: 'tax',
  charges: 'bank charges',
  cash: 'cash',
  education: 'education',
  payments: 'payment app',
  'other-spend': 'other',
  'p2p-out': 'sent to person',
  'p2p-in': 'received from person',
  salary: 'salary',
  'business-income': 'business income',
  'business-outlay': 'into business',
  refund: 'refund',
  interest: 'interest',
  'loan-disbursal': 'loan received',
  'other-income': 'other',
  'investment-out': 'invested',
  'investment-in': 'investment proceeds',
  'self-transfer': 'own account',
  sweep: 'sweep',
};

/** The rail the money took → the method the schema records. */
const METHOD = {
  upi: 'UPI',
  card: 'card',
  atm: 'cash',
  cash: 'cash',
  imps: 'net banking',
  neft: 'net banking',
  rtgs: 'net banking',
  mobile: 'net banking',
  nach: 'auto-debit',
  cheque: 'cheque',
};

export const categoryFor = (category) => CATEGORY[category] ?? 'other';
export const methodFor = (channel) => METHOD[channel] ?? 'other';

/**
 * Income, expense or transfer.
 *
 * Anything internal is a transfer whichever way it moved, and so is money
 * between people: a friend paying you back is not income, and treating it as
 * income inflates a year's earnings by whatever the household lends out.
 */
export function kindFor(category, direction) {
  const kind = categoryKind(category);
  if (kind === 'internal' || kind === 'transfer') return 'transfer';
  return direction === 'in' ? 'income' : 'expense';
}

/** One categorised statement line as a `transaction` record. */
export function toRecord(row, { accountId, statementId = '', personId = '' }) {
  return {
    date: row.date,
    kind: kindFor(row.category, row.direction),
    amount: row.amount,
    account: accountId,
    category: categoryFor(row.category),
    payee: row.counterparty,
    direction: row.direction,
    method: methodFor(row.channel),
    person: personId,
    reference: row.reference || '',
    narration: row.raw || row.description || '',
    balance: row.balance ?? null,
    statement: statementId,
    importKey: fingerprint(accountId, row),
    reconciled: true,
    tags: [],
  };
}

/* ------------------------------------------------------------- the plan */

/**
 * Read one statement and work out exactly what importing it would do —
 * without doing any of it.
 *
 * Separating the plan from the write is what makes the screen honest: it can
 * show "412 new, 88 already here, 2 rows unreadable" and let somebody decide,
 * instead of reporting it afterwards.
 *
 * @param {object[]} rows positioned rows from the PDF reader
 * @param {{file?: string, accounts?: object[], existingKeys?: Set<string>,
 *          account?: object, holder?: string, businesses?: string[],
 *          overrides?: object, personId?: string}} options
 */
export function planStatement(rows, options = {}) {
  const {
    file = '', accounts = [], existingKeys = new Set(),
    account = null, overrides = {}, businesses = [], personId = '',
  } = options;

  // A caller that has already read the statement — a CSV or a card export,
  // which is a table rather than a page — hands the parse in. Everything after
  // this line is identical either way, which is the point: one importer, one
  // categorisation, one fingerprint, one review step, whatever the file was.
  const parsed = options.parsed ?? parseStatement(rows);
  const match = account ? { account, sure: true, score: 100, alternatives: [] }
    : matchAccount(parsed.account, accounts);

  const holder = options.holder ?? parsed.account.holder ?? '';
  const categorised = resolveAliases(
    categorise(parsed.transactions, { holder, businesses, overrides, aliases: false }),
  );

  const check = reconcile(parsed);
  const accountId = match.account?.id ?? '';

  const fresh = [];
  const duplicates = [];
  const seen = new Set();

  const stamped = [];

  for (const row of categorised) {
    const key = fingerprint(accountId, row);
    // Stamped onto the row, not merely computed and dropped. The screen uses
    // it to stop the *second* file in a batch re-importing rows the first one
    // already claimed — which is the normal case when somebody re-downloads a
    // wider date range — and without it on the row that check compared every
    // row against the empty string and passed everything through.
    const carried = { ...row, importKey: key };
    stamped.push(carried);

    // A statement can legitimately contain the same amount to the same payee
    // twice in a day; the second one is only a duplicate of the *first in this
    // file* if the bank gave both the same reference, which it does not.
    if (existingKeys.has(key) || seen.has(key)) duplicates.push(carried);
    else {
      seen.add(key);
      fresh.push(carried);
    }
  }

  return {
    file,
    parsed,
    match,
    check,
    transactions: stamped,
    fresh,
    duplicates,
    problems: parsed.problems,
    // Everything must be true before this is safe to write without a person
    // looking at it: a known account, arithmetic that closes, and no row the
    // parser gave up on.
    ready: Boolean(match.account) && match.sure && check.balanced && parsed.problems.length === 0,
    period: {
      from: categorised.at(0)?.date ?? null,
      to: categorised.at(-1)?.date ?? null,
    },
    personId: personId || match.account?.holder || '',
  };
}

/** The `bankStatement` record for a plan that has been written. */
export function toStatementRecord(plan, { accountId, importedCount, today }) {
  return {
    account: accountId,
    periodFrom: plan.period.from,
    periodTo: plan.period.to,
    fileName: plan.file,
    rowCount: plan.transactions.length,
    importedCount,
    duplicateCount: plan.duplicates.length,
    openingBalance: plan.parsed.openingBalance,
    closingBalance: plan.parsed.closingBalance,
    reconciled: plan.check.balanced,
    problems: plan.problems.length
      ? plan.problems.map((p) => `Row ${p.serial} (${p.date}): ${p.reason}`).join('\n')
      : '',
    importedOn: today,
  };
}

/* ------------------------------------------------------------ the whole pile */

/**
 * What a month's upload looks like taken together.
 *
 * The gap check is the reason this exists rather than a loop in the view. A
 * household uploading monthly will eventually miss one, and a missing month is
 * invisible in any single statement — it only shows up when one statement's
 * opening balance does not match the last one's close.
 */
export function reviewBatch(plans) {
  const byAccount = new Map();

  for (const plan of plans) {
    const id = plan.match.account?.id ?? `unmatched:${plan.file}`;
    const bucket = byAccount.get(id) ?? { account: plan.match.account, plans: [], gaps: [] };
    bucket.plans.push(plan);
    byAccount.set(id, bucket);
  }

  for (const bucket of byAccount.values()) {
    bucket.plans.sort((a, b) => String(a.period.from).localeCompare(String(b.period.from)));

    for (const [index, plan] of bucket.plans.entries()) {
      const previous = bucket.plans[index - 1];
      if (!previous || previous.parsed.closingBalance === null) continue;
      if (plan.parsed.openingBalance === null) continue;

      const difference = plan.parsed.openingBalance - previous.parsed.closingBalance;
      if (Math.abs(difference) > 100) {
        bucket.gaps.push({
          after: previous.period.to,
          before: plan.period.from,
          difference,
          reason: 'the opening balance does not follow the previous statement — a month is missing',
        });
      }
    }
  }

  const all = plans.flatMap((plan) => plan.fresh);

  return {
    accounts: [...byAccount.values()],
    total: plans.reduce((sum, plan) => sum + plan.transactions.length, 0),
    fresh: all.length,
    duplicates: plans.reduce((sum, plan) => sum + plan.duplicates.length, 0),
    unmatched: plans.filter((plan) => !plan.match.account).length,
    unready: plans.filter((plan) => !plan.ready).length,
    gaps: [...byAccount.values()].flatMap((bucket) => bucket.gaps),
  };
}
