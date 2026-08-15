/**
 * The schema registry.
 *
 * This file is the single description of what FamilyOS stores. Object stores,
 * indexes, forms, list columns, validation, encryption, Sheets tabs and column
 * order, reminders, report columns and the assistant's vocabulary are all
 * derived from it. Nothing else in the codebase enumerates entities or fields.
 *
 * Changing a field here changes every one of those at once, which is the whole
 * point — sixteen modules hand-wired would be sixteen places to forget.
 *
 * ## Field shape
 *
 *   key        property name on the record
 *   type       drives the input control, the validator and the formatter
 *   label      shown to the user; defaults to a humanised key
 *   required   refuses to save when empty
 *   list       appears as a column in the list view
 *   search     included in the local search index
 *   encrypted  ciphertext at rest and in the sheet (see security/fieldcrypto)
 *   expiry     a date that produces a renewal reminder
 *   ref        the entity this id points at
 *   options    allowed values for `enum` / `multienum`
 *   group      form section heading
 *
 * ## Versioning
 *
 * Bump an entity's `version` whenever a field is added, removed or retyped.
 * Records carry the version they were written at and are upgraded on read by
 * `migrations.js`, so an old device's rows are never rejected.
 */

// The one thing this file takes from elsewhere. `domain/categorise.js` imports
// nothing at all, so there is no cycle, and a receipt read out of an email ends
// up carrying the same category keys as a row read off a bank statement —
// structurally, rather than by two lists agreeing until one of them changes.
import { CATEGORIES } from '../domain/categorise.js';

/** Roles, most privileged first. `rbac.js` reads the order. */
export const ROLES = ['owner', 'spouse', 'adult', 'child', 'guest'];

const ALL_ADULTS = ['owner', 'spouse', 'adult'];
const HOUSEHOLD = ['owner', 'spouse', 'adult', 'child'];
const OWNERS = ['owner', 'spouse'];

/** Read by everyone in the family, written by adults. */
const shared = { read: HOUSEHOLD, write: ALL_ADULTS };
/** Money and identity: adults read, the two heads of household write. */
const restricted = { read: ALL_ADULTS, write: OWNERS };
/** Vault and identity documents: owners only, both ways. */
const secret = { read: OWNERS, write: OWNERS };

/* ---------------------------------------------------------------- helpers */

const text = (key, o = {}) => ({ key, type: 'text', ...o });
const money = (key, o = {}) => ({ key, type: 'currency', ...o });
const day = (key, o = {}) => ({ key, type: 'date', ...o });
const num = (key, o = {}) => ({ key, type: 'number', ...o });
const pick = (key, options, o = {}) => ({ key, type: 'enum', options, ...o });
const ref = (key, entity, o = {}) => ({ key, type: 'ref', ref: entity, ...o });
const note = (key = 'notes') => ({ key, type: 'textarea', label: 'Notes', search: true });
const tags = () => ({ key: 'tags', type: 'tags', label: 'Tags', search: true });
const attach = () => ({ key: 'documents', type: 'files', label: 'Documents', ref: 'document' });

/* ------------------------------------------------------------- 1. Identity */

const person = {
  name: 'person', module: 'identity', sheet: 'People', version: 1,
  labels: { one: 'Person', many: 'People' }, icon: 'user',
  acl: restricted,
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => r.relationship || r.role,
  fields: [
    text('name', { label: 'Full name', required: true, list: true, search: true }),
    text('nickname', { search: true }),
    pick('role', ROLES, { label: 'Access role', required: true, list: true, default: 'adult' }),
    pick('relationship', ['self', 'spouse', 'son', 'daughter', 'father', 'mother',
      'brother', 'sister', 'grandfather', 'grandmother', 'grandson', 'granddaughter',
      'father-in-law', 'mother-in-law', 'other'], { list: true }),
    day('birthday', { list: true, anniversary: true }),
    pick('gender', ['female', 'male', 'other', 'prefer not to say']),
    pick('bloodGroup', ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'], { list: true }),
    { key: 'email', type: 'email', search: true },
    { key: 'phone', type: 'phone', list: true, search: true },
    { key: 'photo', type: 'image', label: 'Photograph' },
    text('occupation', { search: true, group: 'Work' }),
    text('employer', { search: true, group: 'Work' }),
    money('annualIncome', { group: 'Work' }),
    { key: 'skills', type: 'tags', group: 'Work' },
    { key: 'address', type: 'textarea', group: 'Contact', search: true },
    text('emergencyContactName', { group: 'Emergency' }),
    { key: 'emergencyContactPhone', type: 'phone', group: 'Emergency', encrypted: true },
    { key: 'allergies', type: 'textarea', group: 'Emergency', search: true },
    { key: 'chronicConditions', type: 'textarea', group: 'Emergency' },
    { key: 'isDependent', type: 'boolean', label: 'Dependent' },
    { key: 'deceasedOn', type: 'date', label: 'Date of death' },
    note(),
  ],
};

const relationship = {
  name: 'relationship', module: 'family', sheet: 'Relationships', version: 1,
  labels: { one: 'Relationship', many: 'Relationships' }, icon: 'link',
  acl: shared,
  title: (r) => r.type,
  fields: [
    ref('fromPerson', 'person', { required: true, list: true }),
    pick('type', ['parent of', 'child of', 'spouse of', 'sibling of', 'guardian of',
      'grandparent of', 'grandchild of'], { required: true, list: true }),
    ref('toPerson', 'person', { required: true, list: true }),
    day('since'),
    note(),
  ],
};

const identityDocument = {
  name: 'identityDocument', module: 'identity', sheet: 'IdentityDocuments', version: 1,
  labels: { one: 'Identity document', many: 'Identity documents' }, icon: 'badge',
  acl: secret,
  sort: '-updatedAt',
  title: (r) => r.kind,
  // Deliberately not the number. A title or subtitle is a *projection*: it
  // reaches the screen through record headers, list subtitles, search results
  // and reference pickers, none of which pass through the field renderer that
  // masks an identifier. Printing the passport number here put it in full on
  // every one of those surfaces while the field itself was carefully covered.
  // A test probes every projection in the schema for exactly this.
  subtitle: (r) => r.issuedBy,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    pick('kind', ['PAN', 'Aadhaar', 'Passport', 'Driving licence', 'Voter ID',
      'Ration card', 'Birth certificate', 'Marriage certificate', 'NRE/NRO', 'Other'],
    { required: true, list: true }),
    text('number', { required: true, list: true, encrypted: true, label: 'Number' }),
    text('issuedBy'),
    day('issuedOn'),
    day('expiresOn', { list: true, expiry: true, expiryLead: 180 }),
    text('placeOfIssue'),
    attach(),
    note(),
  ],
};

/**
 * What one institution holds as this person's KYC, as the household knows it.
 *
 * ## This is not a CKYCRR integration and must never become one by accident
 *
 * Nothing here contacts the Central KYC Records Registry, and no field on this
 * record comes from it. Every value is typed in by the household from
 * something they were shown — a statement, a portal page, an account-opening
 * form, a letter. `source` records which, because "my bank told me on the
 * phone" and "printed on my statement" are different kinds of evidence, and
 * the household is the only one who can say which this was.
 *
 * So this is a **filing record**, in exactly the sense the rest of this module
 * files identity documents. It is worth having for a reason that needs no
 * connectivity at all: a household's address changes once and their eight
 * institutions find out at eight different times, or never. Recording what
 * each one holds is the only way to see that — and `domain/kyc.js` reports
 * where the copies disagree, without ever deciding which is right.
 *
 * ## Versions and conflicts are not entities
 *
 * The prompt's model names `IndividualCKYC`, `KYCVersion` and `KYCConflict`.
 * Only the first is a record here. A *version* is what you get by recording
 * the same institution again on a later date — the history is the rows. A
 * *conflict* is derived at read time from those rows, like classification,
 * provenance and accrual before it, so correcting one record fixes every
 * comparison it takes part in rather than leaving stored findings behind.
 */
const kycRecord = {
  name: 'kycRecord', module: 'identity', sheet: 'KYCRecords', version: 1,
  labels: { one: 'KYC record', many: 'KYC records' }, icon: 'badge',
  acl: secret,
  sort: '-recordedOn',
  indexes: [['byPerson', 'person'], ['byInstitution', 'institution']],
  title: (r) => r.institution,
  // Not the KIN and not the held PAN. A projection reaches record headers,
  // list subtitles, search results and reference pickers, none of which pass
  // through the field renderer that masks an identifier — the same trap that
  // once printed a passport number in full on every one of those surfaces.
  subtitle: (r) => r.recordedOn,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('institution', {
      required: true, list: true, search: true, label: 'Institution',
    }),
    day('recordedOn', {
      required: true, list: true, default: 'today', label: 'As known on',
    }),
    pick('source', ['account statement', 'their portal', 'account opening form',
      'a letter from them', 'told verbally', 'other'],
    { required: true, label: 'Where this came from', default: 'their portal' }),

    // `kin` and `pan` are bare on purpose: `data/classification.js` decides
    // masking from the shape of the key, and a prefixed `heldPan` would slip
    // straight past it. The `held` prefix is used only where the field is not
    // an identifier and the prefix is what carries the meaning.
    text('kin', {
      label: 'CKYC identifier (KIN)', encrypted: true, group: 'As they hold it',
    }),
    text('pan', { label: 'PAN', encrypted: true, group: 'As they hold it' }),
    text('heldName', { label: 'Name', search: true, group: 'As they hold it' }),
    { key: 'heldAddress', type: 'textarea', label: 'Address', group: 'As they hold it' },
    day('heldBirthday', { label: 'Date of birth', group: 'As they hold it' }),
    { key: 'heldMobile', type: 'phone', label: 'Mobile', group: 'As they hold it' },
    { key: 'heldEmail', type: 'email', label: 'Email', group: 'As they hold it' },

    pick('status', ['active', 'update pending', 'rejected', 'not known'],
      { list: true, default: 'not known', label: 'Status they show' }),
    attach(),
    note(),
  ],
};

const employment = {
  name: 'employment', module: 'identity', sheet: 'Employment', version: 1,
  labels: { one: 'Employment', many: 'Employment history' }, icon: 'briefcase',
  acl: restricted,
  sort: '-startedOn',
  title: (r) => r.employer,
  subtitle: (r) => r.designation,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('employer', { required: true, list: true, search: true }),
    text('designation', { list: true, search: true }),
    day('startedOn', { required: true, list: true }),
    day('endedOn', { list: true }),
    money('ctc', { label: 'Annual CTC' }),
    text('employeeId', { encrypted: true }),
    text('pfNumber', { label: 'PF number', encrypted: true }),
    text('uan', { label: 'UAN', encrypted: true }),
    { key: 'location', type: 'text' },
    note(),
  ],
};

/* --------------------------------------------------------------- 2. Family */

const importantDate = {
  name: 'importantDate', module: 'family', sheet: 'ImportantDates', version: 1,
  labels: { one: 'Important date', many: 'Important dates' }, icon: 'cake',
  acl: shared,
  sort: 'date',
  title: (r) => r.title,
  fields: [
    text('title', { required: true, list: true, search: true }),
    pick('kind', ['birthday', 'anniversary', 'death anniversary', 'festival',
      'milestone', 'other'], { required: true, list: true, default: 'birthday' }),
    day('date', { required: true, list: true, anniversary: true }),
    ref('person', 'person', { list: true }),
    { key: 'recurring', type: 'boolean', default: true, label: 'Repeats yearly' },
    num('remindDaysBefore', { default: 7, min: 0, max: 365 }),
    note(),
  ],
};

/* -------------------------------------------------------------- 3. Finance */

const account = {
  name: 'account', module: 'finance', sheet: 'Accounts', version: 1,
  labels: { one: 'Account', many: 'Accounts' }, icon: 'bank',
  acl: restricted,
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => r.institution,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['savings', 'current', 'cash', 'wallet', 'credit card', 'debit card',
      'UPI', 'demat', 'PPF', 'EPF', 'NPS', 'fixed deposit', 'recurring deposit', 'loan'],
    { required: true, list: true, default: 'savings' }),
    text('institution', { label: 'Bank / provider', list: true, search: true }),
    text('accountNumber', { encrypted: true, label: 'Account number' }),
    text('ifsc', { label: 'IFSC' }),
    text('upiId', { label: 'UPI ID', search: true }),
    ref('holder', 'person', { list: true }),
    money('openingBalance', { label: 'Opening balance' }),
    day('openedOn'),
    money('creditLimit', { group: 'Card' }),
    num('statementDay', { group: 'Card', min: 1, max: 31, label: 'Statement day' }),
    num('dueDay', { group: 'Card', min: 1, max: 31, label: 'Payment due day' }),
    { key: 'includeInNetWorth', type: 'boolean', default: true },
    { key: 'archived', type: 'boolean', default: false, list: true },
    text('nominee', { encrypted: true }),
    note(),
  ],
};

const transaction = {
  name: 'transaction', module: 'finance', sheet: 'Transactions', version: 4,
  labels: { one: 'Transaction', many: 'Transactions' }, icon: 'receipt',
  acl: restricted,
  sort: '-date',
  indexes: [['byDate', 'date'], ['byAccount', 'account'], ['byCategory', 'category'],
    ['byImportKey', 'importKey']],
  title: (r) => r.payee || r.category,
  fields: [
    day('date', { required: true, list: true, default: 'today' }),
    pick('kind', ['expense', 'income', 'transfer'],
      { required: true, list: true, default: 'expense' }),
    money('amount', { required: true, list: true }),
    ref('account', 'account', { required: true, list: true }),
    ref('toAccount', 'account', { label: 'To account', showWhen: { kind: 'transfer' } }),
    // The first block is what a person types in by hand. The second is what a
    // statement import produces: finer, because a bank narration carries more
    // than a person would bother entering, and separate, because "sent to a
    // person" and "moved to my own account" are not spending and totalling
    // them as if they were is how an analysis reports twice the truth.
    pick('category', ['groceries', 'dining', 'fuel', 'transport', 'utilities', 'rent',
      'EMI', 'insurance', 'health', 'education', 'shopping', 'entertainment',
      'travel', 'gifts', 'donation', 'maintenance', 'tax', 'salary', 'business',
      'interest', 'dividend', 'rental income', 'refund', 'other',
      'food delivery', 'quick commerce', 'restaurant', 'hotel', 'e-commerce',
      'retail', 'subscription', 'bills', 'credit card', 'cash', 'bank charges',
      'loan repayment', 'loan received', 'payment app',
      'sent to person', 'received from person', 'own account', 'sweep',
      'business income', 'into business',
      'invested', 'investment proceeds'],
    { list: true, search: true, default: 'other' }),
    text('payee', { list: true, search: true, label: 'Payee / source' }),
    pick('method', ['UPI', 'card', 'cash', 'net banking', 'auto-debit', 'cheque', 'other'],
      { default: 'UPI' }),
    ref('person', 'person', { label: 'Spent by' }),
    tags(),
    { key: 'reconciled', type: 'boolean', default: false },
    ref('recurring', 'recurringPayment', { label: 'From recurring' }),
    attach(),
    note(),

    /* Written by the statement importer, and only by it. */
    // Which way the money went, as the statement's columns said. `kind` cannot
    // stand in for it — a transfer is a transfer in both directions — and
    // every ledger that nets two directions against each other needs to know.
    pick('direction', ['in', 'out'], { hidden: true }),
    text('reference', { label: 'Bank reference', search: true, hidden: true }),
    text('narration', { label: 'As the bank wrote it', search: true, hidden: true }),
    money('balance', { label: 'Balance after', hidden: true }),
    ref('statement', 'bankStatement', { label: 'From statement', hidden: true }),
    // The fingerprint that makes re-uploading the same month harmless. It is
    // indexed and checked before every insert, because the natural way to use
    // this application is to drop in every statement once a month and not
    // remember which ones went in last time.
    text('importKey', { hidden: true }),

    /* Written by a confirmation, and only by one. */
    // Which economic event this row is one leg of.
    //
    // `toAccount` records a movement with exactly two legs, and cannot record
    // anything else: a ₹50,000 debit arriving as ₹30,000 and ₹20,000 has one
    // source and *two* destinations, so there is no single account to name.
    // Those movements were being proposed with nothing a confirmation could
    // write, which is why the split had no confirm control at all.
    //
    // A shared id on every leg records it without inventing a direction: the
    // rows that carry the same one are the same event. Both bank rows survive
    // untouched apart from this, as everywhere else here — each is a bank's own
    // record of one side, and tidying the total by merging them would destroy
    // the evidence for it.
    //
    // Now a real reference. It began as a bare string, deliberately, with the
    // entity's cost measured and declined; two tranches later the fee link had
    // nowhere to live and the kind of a movement could not be said at all, so
    // the entity was built and this points at it.
    ref('movement', 'economicEvent', { label: 'Part of movement', hidden: true }),
    // What this row is *to* that movement. A leg is money that moved; a fee is
    // money that left and did not arrive. Threading a charge onto a movement
    // without saying which it is would make a ₹50 bank charge look like ₹50 of
    // the amount transferred.
    pick('movementRole', ['leg', 'fee'], { hidden: true }),
  ],
};

/**
 * One imported statement.
 *
 * Kept as a record rather than thrown away after the import, for three
 * reasons: it is the evidence that a month was loaded at all, it holds the
 * bank's own opening and closing balances so a later import can be checked
 * against them, and it makes a missing month visible — which is the failure
 * nobody notices until the totals are already wrong.
 */
const bankStatement = {
  name: 'bankStatement', module: 'finance', sheet: 'BankStatements', version: 1,
  labels: { one: 'Statement', many: 'Statements' }, icon: 'receipt',
  acl: restricted,
  sort: '-periodTo',
  indexes: [['byAccount', 'account'], ['byPeriod', 'periodTo']],
  title: (r) => `${r.periodFrom} to ${r.periodTo}`,
  subtitle: (r) => r.fileName,
  fields: [
    ref('account', 'account', { required: true, list: true }),
    day('periodFrom', { label: 'From', required: true, list: true }),
    day('periodTo', { label: 'To', required: true, list: true }),
    text('fileName', { label: 'File' }),
    num('rowCount', { label: 'Rows in the statement', list: true }),
    num('importedCount', { label: 'Rows added' }),
    num('duplicateCount', { label: 'Already present' }),
    money('openingBalance'),
    money('closingBalance'),
    { key: 'reconciled', type: 'boolean', label: 'Arithmetic closes', default: false, list: true },
    { key: 'problems', type: 'textarea', label: 'Rows that could not be read' },
    day('importedOn', { label: 'Imported on' }),
  ],
};

/**
 * One receipt, read out of the household's own mail.
 *
 * A bank statement says ₹645 went to Zomato on a Tuesday. The receipt says
 * what was ordered, which subscription renewed, and when the next one falls
 * due. Kept as a record rather than recomputed on every visit because the mail
 * it came from can be deleted, archived, or fall outside the next search
 * window — and because a scan that had to re-read a year of mail every time
 * the screen opened would be a reason not to open it.
 *
 * The email itself is never stored. `messageId` is a pointer back into Gmail,
 * where the message already lives; it is also the fingerprint that makes
 * scanning the same month twice harmless.
 */
const receipt = {
  name: 'receipt', module: 'finance', sheet: 'Receipts', version: 1,
  labels: { one: 'Receipt', many: 'Receipts' }, icon: 'receipt',
  acl: restricted,
  sort: '-date',
  indexes: [['byDate', 'date'], ['byMerchant', 'merchantKey'], ['byMessage', 'messageId']],
  title: (r) => r.merchant,
  subtitle: (r) => r.subject,
  fields: [
    day('date', { required: true, list: true, default: 'today' }),
    text('merchant', { required: true, list: true, search: true }),
    money('amount', { list: true }),
    // The same keys the statement categoriser uses, so "quick commerce" means
    // one thing whether it was learnt from a bank narration or an email.
    pick('category', CATEGORIES.map((c) => c.key), { list: true, default: 'other-spend' }),
    text('orderId', { label: 'Order number', list: true, search: true }),
    { key: 'subscription', type: 'boolean', label: 'Recurring', default: false, list: true },
    { key: 'refund', type: 'boolean', default: false },
    ref('transaction', 'transaction', { label: 'Paid by', hidden: true }),
    ref('person', 'person', { label: 'Ordered by' }),
    text('subject', { label: 'Subject line', search: true }),
    // Which mailbox it was read from. A household's receipts are rarely all in
    // one account, and a total that silently covers only one of them is worse
    // than one that says which.
    text('mailbox', { label: 'From mailbox', list: true }),
    // Not hidden data — a link. The message is in Gmail either way.
    text('messageId', { label: 'Gmail message', hidden: true }),
    text('merchantKey', { hidden: true }),
    note(),
  ],
};

const budget = {
  name: 'budget', module: 'finance', sheet: 'Budgets', version: 1,
  labels: { one: 'Budget', many: 'Budgets' }, icon: 'target',
  acl: restricted,
  title: (r) => r.category,
  fields: [
    pick('category', transactionCategories(), { required: true, list: true }),
    money('monthlyLimit', { required: true, list: true }),
    pick('period', ['monthly', 'quarterly', 'yearly'], { default: 'monthly', list: true }),
    day('startsOn'),
    day('endsOn'),
    { key: 'alertAtPercent', type: 'number', default: 80, min: 1, max: 200 },
    note(),
  ],
};

function transactionCategories() {
  return transaction.fields.find((f) => f.key === 'category').options;
}

const recurringPayment = {
  name: 'recurringPayment', module: 'finance', sheet: 'RecurringPayments', version: 1,
  labels: { one: 'Recurring payment', many: 'Recurring payments' }, icon: 'repeat',
  acl: restricted,
  sort: 'nextDueOn',
  title: (r) => r.name,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['bill', 'EMI', 'subscription', 'premium', 'SIP', 'rent', 'salary', 'other'],
      { required: true, list: true, default: 'bill' }),
    money('amount', { required: true, list: true }),
    pick('frequency', ['weekly', 'monthly', 'quarterly', 'half-yearly', 'yearly'],
      { required: true, default: 'monthly', list: true }),
    day('nextDueOn', { required: true, list: true, expiry: true, expiryLead: 7 }),
    day('endsOn'),
    ref('account', 'account', { list: true }),
    pick('category', transactionCategories(), { default: 'other' }),
    { key: 'autoDebit', type: 'boolean', default: false, list: true },
    { key: 'active', type: 'boolean', default: true, list: true },
    note(),
  ],
};

const loan = {
  name: 'loan', module: 'finance', sheet: 'Loans', version: 1,
  labels: { one: 'Loan', many: 'Loans' }, icon: 'loan',
  acl: restricted,
  title: (r) => r.name,
  subtitle: (r) => r.lender,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['home', 'vehicle', 'personal', 'education', 'gold', 'business',
      'credit card', 'other'], { required: true, list: true }),
    text('lender', { list: true, search: true }),
    text('accountNumber', { encrypted: true }),
    ref('borrower', 'person'),
    money('principal', { label: 'Sanctioned amount', required: true, list: true }),
    money('outstanding', { label: 'Outstanding', list: true }),
    num('interestRate', { label: 'Interest rate %', step: 0.01 }),
    num('tenureMonths', { label: 'Tenure (months)' }),
    money('emiAmount', { label: 'EMI' }),
    num('emiDay', { min: 1, max: 31, label: 'EMI day' }),
    day('startedOn'),
    day('endsOn', { list: true }),
    ref('account', 'account', { label: 'Debited from' }),
    text('collateral'),
    attach(),
    note(),
  ],
};

/* ---------------------------------------------------------- 4. Investments */

const holding = {
  name: 'holding', module: 'investments', sheet: 'Holdings', version: 1,
  labels: { one: 'Holding', many: 'Holdings' }, icon: 'chart',
  acl: restricted,
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => r.kind,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['stock', 'mutual fund', 'ETF', 'gold', 'silver', 'fixed deposit',
      'recurring deposit', 'PPF', 'EPF', 'NPS', 'bond', 'crypto', 'REIT',
      'business', 'other'], { required: true, list: true }),
    text('symbol', { label: 'Symbol / folio', search: true }),
    ref('owner', 'person', { list: true }),
    ref('account', 'account', { label: 'Held in' }),
    num('units', { step: 0.0001, list: true }),
    money('averageCost', { label: 'Average cost per unit' }),
    money('invested', { label: 'Total invested', list: true }),
    money('currentValue', { label: 'Current value', list: true }),
    day('valuedOn', { label: 'Value as on' }),
    num('interestRate', { label: 'Interest rate %', step: 0.01, group: 'Fixed income' }),
    day('maturesOn', { group: 'Fixed income', expiry: true, expiryLead: 30 }),
    money('maturityValue', { group: 'Fixed income' }),
    pick('riskLevel', ['low', 'moderate', 'high'], { default: 'moderate' }),
    text('nominee'),
    { key: 'active', type: 'boolean', default: true },
    attach(),
    note(),
  ],
};

const investmentTransaction = {
  name: 'investmentTransaction', module: 'investments', sheet: 'InvestmentTransactions',
  version: 1,
  labels: { one: 'Investment transaction', many: 'Investment transactions' }, icon: 'swap',
  acl: restricted,
  sort: '-date',
  indexes: [['byHolding', 'holding'], ['byDate', 'date']],
  title: (r) => `${r.kind} ${r.units ?? ''}`.trim(),
  fields: [
    ref('holding', 'holding', { required: true, list: true }),
    day('date', { required: true, list: true, default: 'today' }),
    pick('kind', ['buy', 'sell', 'dividend', 'interest', 'bonus', 'split',
      'contribution', 'withdrawal', 'charge'],
    { required: true, list: true, default: 'buy' }),
    num('units', { step: 0.0001, list: true }),
    money('pricePerUnit'),
    money('amount', { required: true, list: true }),
    money('charges', { label: 'Brokerage & charges' }),
    ref('account', 'account', { label: 'Settled through' }),
    note(),
  ],
};

/* ------------------------------------------------------------ 5. Documents */

const document = {
  name: 'document', module: 'documents', sheet: 'Documents', version: 1,
  labels: { one: 'Document', many: 'Documents' }, icon: 'file',
  acl: restricted,
  sort: '-updatedAt',
  indexes: [['byCategory', 'category'], ['byExpiry', 'expiresOn']],
  title: (r) => r.title,
  subtitle: (r) => r.category,
  fields: [
    text('title', { required: true, list: true, search: true }),
    pick('category', ['identity', 'financial', 'property', 'vehicle', 'insurance',
      'health', 'education', 'legal', 'tax', 'employment', 'warranty', 'other'],
    { required: true, list: true, default: 'other' }),
    ref('person', 'person', { list: true }),
    day('issuedOn'),
    day('expiresOn', { list: true, expiry: true, expiryLead: 60 }),
    tags(),
    text('driveFileId', { hidden: true }),
    text('driveFolderId', { hidden: true }),
    text('fileName', { list: true }),
    text('mimeType', { hidden: true }),
    num('sizeBytes', { hidden: true }),
    num('versionCount', { default: 1, hidden: true }),
    { key: 'ocrText', type: 'textarea', label: 'Extracted text', search: true, hidden: true },
    { key: 'confidential', type: 'boolean', default: false },
    note(),
  ],
};

/* ------------------------------------------------------------- 6. Vehicles */

const vehicle = {
  name: 'vehicle', module: 'vehicles', sheet: 'Vehicles', version: 1,
  labels: { one: 'Vehicle', many: 'Vehicles' }, icon: 'car',
  acl: shared,
  sort: 'registration',
  title: (r) => `${r.make ?? ''} ${r.model ?? ''}`.trim() || r.registration,
  subtitle: (r) => r.registration,
  fields: [
    text('registration', { label: 'Registration number', required: true, list: true, search: true }),
    text('make', { list: true, search: true }),
    text('model', { list: true, search: true }),
    pick('kind', ['car', 'motorcycle', 'scooter', 'commercial', 'tractor', 'other'],
      { default: 'car', list: true }),
    num('year', { label: 'Model year', min: 1900, max: 2100 }),
    pick('fuel', ['petrol', 'diesel', 'CNG', 'electric', 'hybrid']),
    ref('owner', 'person', { list: true }),
    text('chassisNumber', { encrypted: true, group: 'Registration' }),
    text('engineNumber', { encrypted: true, group: 'Registration' }),
    day('registeredOn', { group: 'Registration' }),
    day('rcExpiresOn', { label: 'RC valid till', group: 'Registration', expiry: true, expiryLead: 90 }),
    money('purchasePrice', { group: 'Purchase' }),
    day('purchasedOn', { group: 'Purchase' }),
    money('currentValue', { group: 'Purchase' }),
    text('insurancePolicy', { group: 'Compliance', encrypted: true }),
    day('insuranceExpiresOn', { label: 'Insurance expiry', list: true, group: 'Compliance', expiry: true, expiryLead: 30 }),
    day('pucExpiresOn', { label: 'PUC expiry', group: 'Compliance', expiry: true, expiryLead: 30 }),
    text('fastagId', { label: 'FASTag ID', group: 'Compliance', encrypted: true }),
    money('fastagBalance', { group: 'Compliance' }),
    ref('loan', 'loan', { group: 'Finance' }),
    num('odometer', { label: 'Odometer (km)' }),
    day('nextServiceOn', { expiry: true, expiryLead: 21 }),
    text('tyreChangedAt', { label: 'Tyres changed at (km)', group: 'Wear' }),
    day('batteryChangedOn', { group: 'Wear' }),
    attach(),
    note(),
  ],
};

const vehicleService = {
  name: 'vehicleService', module: 'vehicles', sheet: 'VehicleServices', version: 1,
  labels: { one: 'Service record', many: 'Service history' }, icon: 'wrench',
  acl: shared,
  sort: '-date',
  indexes: [['byVehicle', 'vehicle']],
  title: (r) => r.kind,
  fields: [
    ref('vehicle', 'vehicle', { required: true, list: true }),
    day('date', { required: true, list: true, default: 'today' }),
    pick('kind', ['periodic service', 'repair', 'tyres', 'battery', 'insurance claim',
      'accident', 'inspection', 'other'], { required: true, list: true }),
    num('odometer', { label: 'Odometer (km)', list: true }),
    text('workshop', { search: true }),
    money('cost', { list: true }),
    { key: 'workDone', type: 'textarea', search: true },
    day('nextDueOn', { expiry: true, expiryLead: 21 }),
    attach(),
    note(),
  ],
};

const fuelLog = {
  name: 'fuelLog', module: 'vehicles', sheet: 'FuelLogs', version: 1,
  labels: { one: 'Fuel entry', many: 'Fuel log' }, icon: 'fuel',
  acl: shared,
  sort: '-date',
  indexes: [['byVehicle', 'vehicle']],
  title: (r) => r.date,
  fields: [
    ref('vehicle', 'vehicle', { required: true, list: true }),
    day('date', { required: true, list: true, default: 'today' }),
    num('litres', { step: 0.01, list: true, required: true }),
    money('amount', { required: true, list: true }),
    num('odometer', { label: 'Odometer (km)', list: true }),
    { key: 'fullTank', type: 'boolean', default: true },
    text('station'),
  ],
};

/* --------------------------------------------------------------- 7. Health */

const healthRecord = {
  name: 'healthRecord', module: 'health', sheet: 'HealthRecords', version: 1,
  labels: { one: 'Health record', many: 'Health records' }, icon: 'health',
  acl: { read: ALL_ADULTS, write: ALL_ADULTS },
  sort: '-date',
  indexes: [['byPerson', 'person'], ['byDate', 'date']],
  title: (r) => r.title,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    day('date', { required: true, list: true, default: 'today' }),
    pick('kind', ['consultation', 'diagnosis', 'surgery', 'lab report', 'imaging',
      'hospitalisation', 'dental', 'vision', 'therapy', 'other'],
    { required: true, list: true, default: 'consultation' }),
    text('title', { required: true, list: true, search: true }),
    text('doctor', { search: true }),
    text('hospital', { search: true }),
    // Not searchable: it is encrypted, and indexing ciphertext would mean
    // decrypting every record on every keystroke to find nothing.
    { key: 'diagnosis', type: 'textarea', encrypted: true },
    { key: 'prescription', type: 'textarea', encrypted: true },
    money('cost'),
    ref('policy', 'policy', { label: 'Claimed under' }),
    day('followUpOn', { expiry: true, expiryLead: 7 }),
    attach(),
    note(),
  ],
};

const medication = {
  name: 'medication', module: 'health', sheet: 'Medications', version: 1,
  labels: { one: 'Medication', many: 'Medications' }, icon: 'pill',
  acl: { read: ALL_ADULTS, write: ALL_ADULTS },
  title: (r) => r.name,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('name', { required: true, list: true, search: true }),
    text('dosage', { list: true }),
    pick('frequency', ['once daily', 'twice daily', 'thrice daily', 'weekly',
      'as needed', 'other'], { default: 'once daily', list: true }),
    day('startedOn'),
    day('endsOn', { list: true }),
    text('prescribedBy', { encrypted: true }),
    text('purpose', { search: true }),
    { key: 'ongoing', type: 'boolean', default: true, list: true },
    note(),
  ],
};

const vaccination = {
  name: 'vaccination', module: 'health', sheet: 'Vaccinations', version: 1,
  labels: { one: 'Vaccination', many: 'Vaccinations' }, icon: 'syringe',
  acl: { read: ALL_ADULTS, write: ALL_ADULTS },
  sort: '-date',
  title: (r) => r.vaccine,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('vaccine', { required: true, list: true, search: true }),
    num('doseNumber', { label: 'Dose', default: 1 }),
    day('date', { required: true, list: true }),
    day('nextDoseOn', { list: true, expiry: true, expiryLead: 21 }),
    text('administeredAt'),
    text('batchNumber', { encrypted: true }),
    attach(),
    note(),
  ],
};

const appointment = {
  name: 'appointment', module: 'health', sheet: 'Appointments', version: 1,
  labels: { one: 'Appointment', many: 'Appointments' }, icon: 'calendar',
  acl: { read: HOUSEHOLD, write: ALL_ADULTS },
  sort: 'date',
  title: (r) => r.title,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('title', { required: true, list: true, search: true }),
    day('date', { required: true, list: true, expiry: true, expiryLead: 3 }),
    { key: 'time', type: 'time' },
    text('doctor', { list: true }),
    text('location', { search: true }),
    pick('status', ['scheduled', 'attended', 'missed', 'cancelled'],
      { default: 'scheduled', list: true }),
    note(),
  ],
};

/* ------------------------------------------------------------ 8. Insurance */

const policy = {
  name: 'policy', module: 'insurance', sheet: 'Policies', version: 1,
  labels: { one: 'Policy', many: 'Policies' }, icon: 'shield',
  acl: restricted,
  sort: 'renewsOn',
  title: (r) => r.name,
  subtitle: (r) => r.insurer,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['health', 'life', 'term life', 'vehicle', 'property', 'travel',
      'personal accident', 'critical illness', 'other'],
    { required: true, list: true }),
    text('insurer', { required: true, list: true, search: true }),
    text('policyNumber', { required: true, encrypted: true, list: true }),
    ref('holder', 'person', { list: true }),
    { key: 'insured', type: 'multiref', ref: 'person', label: 'Persons covered' },
    money('sumAssured', { list: true }),
    money('premium', { required: true }),
    pick('premiumFrequency', ['monthly', 'quarterly', 'half-yearly', 'yearly', 'single'],
      { default: 'yearly' }),
    day('startedOn'),
    day('renewsOn', { label: 'Renewal date', required: true, list: true, expiry: true, expiryLead: 45 }),
    day('maturesOn'),
    text('nominee'),
    text('agentName', { group: 'Contact' }),
    { key: 'agentPhone', type: 'phone', group: 'Contact', encrypted: true },
    { key: 'claimProcess', type: 'textarea', group: 'Claims' },
    text('tpaHelpline', { label: 'TPA / helpline', group: 'Claims' }),
    ref('vehicle', 'vehicle', { showWhen: { kind: 'vehicle' } }),
    ref('property', 'property', { showWhen: { kind: 'property' } }),
    attach(),
    note(),
  ],
};

/* ------------------------------------------------------------- 9. Property */

const property = {
  name: 'property', module: 'property', sheet: 'Properties', version: 1,
  labels: { one: 'Property', many: 'Properties' }, icon: 'home',
  acl: restricted,
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => r.address,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['land', 'house', 'apartment', 'plot', 'commercial', 'agricultural',
      'parking', 'other'], { required: true, list: true }),
    { key: 'address', type: 'textarea', search: true, list: true },
    ref('owner', 'person', { list: true }),
    num('area', { label: 'Area' }),
    pick('areaUnit', ['sq ft', 'sq m', 'sq yd', 'acre', 'guntha', 'cent'],
      { default: 'sq ft' }),
    money('purchasePrice', { group: 'Purchase' }),
    day('purchasedOn', { group: 'Purchase' }),
    money('registrationCost', { group: 'Purchase' }),
    money('currentValue', { label: 'Market value', list: true, group: 'Valuation' }),
    day('valuedOn', { group: 'Valuation' }),
    { key: 'rented', type: 'boolean', default: false, list: true, group: 'Rental' },
    money('monthlyRent', { group: 'Rental' }),
    text('tenantName', { group: 'Rental' }),
    { key: 'tenantPhone', type: 'phone', group: 'Rental', encrypted: true },
    day('leaseEndsOn', { group: 'Rental', expiry: true, expiryLead: 60 }),
    money('deposit', { group: 'Rental' }),
    text('surveyNumber', { group: 'Records', encrypted: true }),
    text('khataNumber', { group: 'Records', encrypted: true }),
    money('annualPropertyTax', { group: 'Records' }),
    day('taxPaidTill', { group: 'Records', expiry: true, expiryLead: 30 }),
    ref('loan', 'loan'),
    attach(),
    note(),
  ],
};

/* ------------------------------------------------------------ 10. Education */

const education = {
  name: 'education', module: 'education', sheet: 'Education', version: 1,
  labels: { one: 'Education record', many: 'Education' }, icon: 'school',
  acl: shared,
  sort: '-startedOn',
  title: (r) => r.institution,
  subtitle: (r) => r.qualification,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('institution', { required: true, list: true, search: true }),
    pick('level', ['pre-school', 'school', 'higher secondary', 'diploma',
      'undergraduate', 'postgraduate', 'doctorate', 'certification', 'other'],
    { required: true, list: true }),
    text('qualification', { list: true, search: true }),
    text('specialisation'),
    day('startedOn', { list: true }),
    day('endedOn'),
    text('grade', { label: 'Grade / percentage' }),
    text('registrationNumber', { encrypted: true }),
    money('annualFee', { group: 'Fees' }),
    day('nextFeeDueOn', { group: 'Fees', expiry: true, expiryLead: 21 }),
    { key: 'achievements', type: 'textarea', search: true },
    attach(),
    note(),
  ],
};

const certificate = {
  name: 'certificate', module: 'education', sheet: 'Certificates', version: 1,
  labels: { one: 'Certificate', many: 'Certificates' }, icon: 'award',
  acl: shared,
  sort: '-issuedOn',
  title: (r) => r.title,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('title', { required: true, list: true, search: true }),
    text('issuedBy', { list: true, search: true }),
    day('issuedOn', { list: true }),
    day('expiresOn', { expiry: true, expiryLead: 60 }),
    text('credentialId', { encrypted: true }),
    { key: 'credentialUrl', type: 'url' },
    { key: 'skills', type: 'tags' },
    attach(),
    note(),
  ],
};

/* ---------------------------------------------------------------- 11. Tasks */

const project = {
  name: 'project', module: 'tasks', sheet: 'Projects', version: 1,
  labels: { one: 'Project', many: 'Projects' }, icon: 'folder',
  acl: shared,
  title: (r) => r.name,
  fields: [
    text('name', { required: true, list: true, search: true }),
    { key: 'description', type: 'textarea', search: true },
    pick('status', ['planned', 'active', 'on hold', 'done', 'abandoned'],
      { default: 'active', list: true }),
    ref('owner', 'person', { list: true }),
    day('dueOn', { list: true }),
    text('colour', { type: 'color', hidden: true }),
  ],
};

const task = {
  name: 'task', module: 'tasks', sheet: 'Tasks', version: 1,
  labels: { one: 'Task', many: 'Tasks' }, icon: 'check',
  acl: shared,
  sort: 'dueOn',
  indexes: [['byStatus', 'status'], ['byDue', 'dueOn'], ['byAssignee', 'assignee']],
  title: (r) => r.title,
  fields: [
    text('title', { required: true, list: true, search: true }),
    { key: 'description', type: 'textarea', search: true },
    pick('status', ['todo', 'doing', 'blocked', 'done'],
      { required: true, default: 'todo', list: true }),
    pick('priority', ['urgent', 'high', 'normal', 'low'],
      { default: 'normal', list: true }),
    day('dueOn', { list: true, expiry: true, expiryLead: 3 }),
    { key: 'dueTime', type: 'time' },
    ref('assignee', 'person', { list: true }),
    ref('project', 'project', { list: true }),
    pick('repeat', ['none', 'daily', 'weekdays', 'weekly', 'monthly', 'yearly'],
      { default: 'none' }),
    day('completedOn'),
    tags(),
    attach(),
    note(),
  ],
};

/* ------------------------------------------------------------- 12. Calendar */

const event = {
  name: 'event', module: 'calendar', sheet: 'Events', version: 1,
  labels: { one: 'Event', many: 'Events' }, icon: 'calendar',
  acl: shared,
  sort: 'date',
  indexes: [['byDate', 'date']],
  title: (r) => r.title,
  fields: [
    text('title', { required: true, list: true, search: true }),
    day('date', { required: true, list: true, default: 'today' }),
    { key: 'startTime', type: 'time' },
    { key: 'endTime', type: 'time' },
    { key: 'allDay', type: 'boolean', default: false },
    pick('kind', ['family', 'medical', 'financial', 'school', 'travel', 'work',
      'festival', 'other'], { default: 'family', list: true }),
    text('location', { search: true }),
    { key: 'attendees', type: 'multiref', ref: 'person' },
    pick('repeat', ['none', 'daily', 'weekly', 'monthly', 'yearly'], { default: 'none' }),
    num('remindMinutesBefore', { default: 60 }),
    note('description'),
  ],
};

/* ---------------------------------------------------------------- 13. Notes */

const noteEntity = {
  name: 'note', module: 'notes', sheet: 'Notes', version: 1,
  labels: { one: 'Note', many: 'Notes' }, icon: 'note',
  acl: shared,
  sort: '-updatedAt',
  title: (r) => r.title,
  fields: [
    text('title', { required: true, list: true, search: true }),
    { key: 'body', type: 'richtext', label: 'Note', search: true },
    pick('kind', ['text', 'checklist', 'voice', 'drawing', 'link'],
      { default: 'text', list: true }),
    tags(),
    { key: 'pinned', type: 'boolean', default: false, list: true },
    { key: 'shared', type: 'boolean', default: true, label: 'Visible to family' },
    { key: 'colour', type: 'color' },
    { key: 'url', type: 'url', showWhen: { kind: 'link' } },
    attach(),
  ],
};

/* ---------------------------------------------------------------- 14. Vault */

const vaultItem = {
  name: 'vaultItem', module: 'vault', sheet: 'Vault', version: 1,
  labels: { one: 'Vault item', many: 'Password vault' }, icon: 'lock',
  acl: secret,
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => r.username,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['login', 'card', 'bank', 'secure note', 'wifi', 'recovery codes',
      'software licence'], { required: true, default: 'login', list: true }),
    text('username', { list: true, search: true }),
    { key: 'password', type: 'password', encrypted: true },
    { key: 'url', type: 'url', search: true },
    { key: 'totpSecret', type: 'password', label: '2FA secret', encrypted: true },
    { key: 'recoveryCodes', type: 'textarea', encrypted: true },
    { key: 'secureNote', type: 'textarea', encrypted: true, label: 'Secure note' },
    ref('person', 'person', { label: 'Belongs to' }),
    day('passwordChangedOn'),
    tags(),
  ],
};

/* -------------------------------------------------------- 15. Digital assets */

const digitalAsset = {
  name: 'digitalAsset', module: 'digital', sheet: 'DigitalAssets', version: 1,
  labels: { one: 'Digital asset', many: 'Digital assets' }, icon: 'globe',
  acl: restricted,
  sort: 'name',
  title: (r) => r.name,
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['domain', 'hosting', 'email', 'cloud storage', 'social account',
      'licence key', 'crypto wallet', 'website', 'other'],
    { required: true, list: true }),
    text('provider', { list: true, search: true }),
    { key: 'url', type: 'url' },
    text('accountIdentifier', { label: 'Account / handle', search: true }),
    day('renewsOn', { list: true, expiry: true, expiryLead: 30 }),
    money('annualCost'),
    { key: 'licenceKey', type: 'password', encrypted: true, label: 'Licence key' },
    ref('vaultItem', 'vaultItem', { label: 'Credentials' }),
    ref('owner', 'person'),
    { key: 'legacyInstruction', type: 'textarea', label: 'On my death, do this' },
    note(),
  ],
};

const subscription = {
  name: 'subscription', module: 'digital', sheet: 'Subscriptions', version: 1,
  labels: { one: 'Subscription', many: 'Subscriptions' }, icon: 'refresh',
  acl: restricted,
  sort: 'renewsOn',
  title: (r) => r.name,
  fields: [
    text('name', { required: true, list: true, search: true }),
    text('provider', { list: true }),
    money('amount', { required: true, list: true }),
    pick('frequency', ['monthly', 'quarterly', 'yearly'], { default: 'monthly', list: true }),
    day('renewsOn', { required: true, list: true, expiry: true, expiryLead: 14 }),
    ref('account', 'account', { label: 'Billed to' }),
    { key: 'autoRenew', type: 'boolean', default: true },
    { key: 'active', type: 'boolean', default: true, list: true },
    { key: 'cancelUrl', type: 'url' },
    note(),
  ],
};

/* ------------------------------------------------------------ 16. Emergency */

const emergencyContact = {
  name: 'emergencyContact', module: 'emergency', sheet: 'EmergencyContacts', version: 1,
  labels: { one: 'Emergency contact', many: 'Emergency contacts' }, icon: 'phone',
  acl: { read: HOUSEHOLD, write: ALL_ADULTS },
  sort: 'priority',
  title: (r) => r.name,
  subtitle: (r) => r.relationship,
  fields: [
    text('name', { required: true, list: true, search: true }),
    { key: 'phone', type: 'phone', required: true, list: true },
    { key: 'altPhone', type: 'phone' },
    text('relationship', { list: true }),
    pick('kind', ['family', 'doctor', 'hospital', 'police', 'lawyer', 'insurance',
      'neighbour', 'employer', 'other'], { default: 'family', list: true }),
    num('priority', { default: 1, min: 1, max: 99, list: true }),
    { key: 'address', type: 'textarea' },
    { key: 'email', type: 'email' },
    note(),
  ],
};


/**
 * One movement of money, as the household's economy saw it.
 *
 * ## Why an entity, after a tranche that deliberately did not build one
 *
 * The previous tranche threaded a shared id through the legs and said plainly
 * that this was **not** the `EconomicEvent` the prompt asks for, listing what an
 * entity would additionally buy. Two of those things have since become the
 * blocking gap rather than a nicety:
 *
 *   - **A kind.** A split, a sweep and a transfer that lost a fee on the way
 *     are different events, and a bare thread cannot say which.
 *   - **Somewhere for the fee to live.** `domain/events.js` finds the charge
 *     that accounts for a near-match exactly, names it in a sentence, and has
 *     nowhere to record it. A fee row is not a leg of the movement — it is
 *     money that left and did not arrive — so threading it onto the same id
 *     without saying what it is would make it look like one.
 *
 * ## What it is not
 *
 * It is **not a replacement for the rows**. Every statement line survives, with
 * its own narration, reference and running balance; this sits beside them and
 * says what they add up to. Deleting a leg leaves the event standing, reported
 * short rather than silently rewritten.
 *
 * It holds no amount that is not derivable from its legs. `amount` is written
 * once, at confirmation, as the figure the person agreed to — and
 * `domain/events.js` re-derives the same number from the rows on every read, so
 * a disagreement between the two is visible rather than authoritative. That is
 * the same "offer, never overwrite" rule the rest of this application follows.
 */
const economicEvent = {
  name: 'economicEvent', module: 'finance', sheet: 'EconomicEvents', version: 1,
  labels: { one: 'Movement', many: 'Movements' }, icon: 'refresh',
  acl: restricted,
  sort: '-date',
  indexes: [['byDate', 'date']],
  title: (r) => r.title || r.kind,
  subtitle: (r) => r.kind,
  fields: [
    day('date', { required: true, list: true, default: 'today' }),
    pick('kind', [
      // Two accounts, one amount. The ordinary case.
      'transfer',
      // One debit, several credits.
      'split',
      // Several debits, one credit.
      'sweep',
      // The amounts differ, and a charge on the statement accounts for the
      // difference exactly. The charge is a leg with `role: 'fee'`.
      'transfer with fee',
    ], { required: true, list: true, default: 'transfer' }),
    money('amount', { required: true, list: true, label: 'Amount moved' }),
    text('title', { list: true, search: true, label: 'What this was' }),
    // What the person was shown when they agreed to it. Kept because a
    // confirmation is a decision, and a decision with no record of what it was
    // based on cannot be revisited.
    text('why', { label: 'Why it was offered', search: true }),
    note(),
  ],
};

/* ---------------------------------------------------------------- registry */

export const entities = Object.freeze(Object.fromEntries(
  [person, relationship, identityDocument, kycRecord, employment, importantDate,
    account, transaction, economicEvent, bankStatement, receipt, budget,
    recurringPayment, loan,
    holding, investmentTransaction, document,
    vehicle, vehicleService, fuelLog,
    healthRecord, medication, vaccination, appointment,
    policy, property, education, certificate,
    project, task, event, noteEntity, vaultItem,
    digitalAsset, subscription, emergencyContact,
  ].map((e) => [e.name, normalise(e)]),
));

/** Modules, in navigation order. */
export const modules = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', icon: 'grid', entities: [] },
  { id: 'identity', label: 'Identity', icon: 'user', entities: ['person', 'identityDocument', 'kycRecord', 'employment'] },
  { id: 'family', label: 'Family', icon: 'family', entities: ['relationship', 'importantDate'] },
  { id: 'finance', label: 'Finance', icon: 'wallet', entities: ['account', 'transaction', 'bankStatement', 'receipt', 'budget', 'recurringPayment', 'loan'] },
  { id: 'investments', label: 'Investments', icon: 'chart', entities: ['holding', 'investmentTransaction'] },
  { id: 'documents', label: 'Documents', icon: 'file', entities: ['document'] },
  { id: 'vehicles', label: 'Vehicles', icon: 'car', entities: ['vehicle', 'vehicleService', 'fuelLog'] },
  { id: 'health', label: 'Health', icon: 'health', entities: ['healthRecord', 'medication', 'vaccination', 'appointment'] },
  { id: 'insurance', label: 'Insurance', icon: 'shield', entities: ['policy'] },
  { id: 'property', label: 'Property', icon: 'home', entities: ['property'] },
  { id: 'education', label: 'Education', icon: 'school', entities: ['education', 'certificate'] },
  { id: 'tasks', label: 'Tasks', icon: 'check', entities: ['task', 'project'] },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', entities: ['event'] },
  { id: 'notes', label: 'Notes', icon: 'note', entities: ['note'] },
  { id: 'vault', label: 'Vault', icon: 'lock', entities: ['vaultItem'] },
  { id: 'digital', label: 'Digital', icon: 'globe', entities: ['digitalAsset', 'subscription'] },
  { id: 'emergency', label: 'Emergency', icon: 'alert', entities: ['emergencyContact'] },
  { id: 'reports', label: 'Reports', icon: 'report', entities: [] },
  { id: 'settings', label: 'Settings', icon: 'settings', entities: [] },
]);

/** Stores the app owns that are not user entities. */
export const systemStores = Object.freeze({
  outbox: { keyPath: 'id', indexes: [['bySeq', 'seq'], ['byState', 'state']] },
  /**
   * The last server-agreed version of a record that has unpushed local edits.
   * It is the *base* of the three-way merge, and it exists only between the
   * first local edit and a successful push — so it costs one extra copy per
   * queued change, not per record.
   */
  shadow: { keyPath: 'id', indexes: [['byStore', 'store']] },
  audit: { keyPath: 'id', indexes: [['byAt', 'at'], ['byEntity', 'entity']] },
  conflicts: { keyPath: 'id', indexes: [['byStore', 'store']] },
  meta: { keyPath: 'key', indexes: [] },
  blobs: { keyPath: 'id', indexes: [] },
  search: { keyPath: 'id', indexes: [['byTerm', 'term', { multiEntry: true }]] },
});

/* ----------------------------------------------------------------- helpers */

function humanise(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())
    .replace(/\bId\b/, 'ID');
}

/** Fill in every default so consumers never have to guard for absence. */
function normalise(entity) {
  const fields = entity.fields.map((f) => Object.freeze({
    label: humanise(f.key),
    required: false,
    list: false,
    search: false,
    encrypted: false,
    hidden: false,
    group: 'Details',
    ...f,
  }));
  return Object.freeze({
    sort: '-createdAt',
    indexes: [],
    icon: 'file',
    title: (r) => r.name ?? r.title ?? r.id,
    subtitle: () => '',
    ...entity,
    fields,
    fieldMap: Object.freeze(Object.fromEntries(fields.map((f) => [f.key, f]))),
  });
}

export function entity(name) {
  const e = entities[name];
  if (!e) throw new Error(`unknown entity: ${name}`);
  return e;
}

export function entityNames() {
  return Object.keys(entities);
}

export function entitiesOfModule(moduleId) {
  return Object.values(entities).filter((e) => e.module === moduleId);
}

export function field(entityName, key) {
  return entity(entityName).fieldMap[key] ?? null;
}

/** Fields that carry a renewal or expiry date, with their lead time. */
export function expiryFields(entityName) {
  return entity(entityName).fields.filter((f) => f.expiry);
}

export function encryptedFields(entityName) {
  return entity(entityName).fields.filter((f) => f.encrypted).map((f) => f.key);
}

export function searchableFields(entityName) {
  return entity(entityName).fields.filter((f) => f.search).map((f) => f.key);
}

export function listFields(entityName) {
  return entity(entityName).fields.filter((f) => f.list && !f.hidden);
}

/**
 * The manifest the server needs to build and migrate its sheets: tab name,
 * column order and version, for every entity. Sent on `schema` sync.
 */
export function sheetManifest() {
  return Object.values(entities).map((e) => ({
    entity: e.name,
    sheet: e.sheet,
    version: e.version,
    columns: e.fields.map((f) => f.key),
  }));
}
