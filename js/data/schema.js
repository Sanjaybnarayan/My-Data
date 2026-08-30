/**
 * The schema registry.
 *
 * This file is the single description of what FamilyOS stores. Object stores,
 * indexes, forms, list columns, validation, encryption, Sheets tabs and column
 * order, reminders, report columns and the assistant's vocabulary are all
 * derived from it. Nothing else in the codebase enumerates entities or fields.
 *
 * Changing a field here changes every one of those at once, which is the whole
 * point — nineteen modules hand-wired would be nineteen places to forget.
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
import { withEntities } from './modules.js';

/** Roles, most privileged first. `rbac.js` reads the order. */
/**
 * Access roles, most privileged first — `rbac.js` ranks them by this order.
 *
 * `staff` is last, below `guest`, and is on **no entity's ACL**. That is the
 * design rather than an omission: `can()` falls through to the own-record
 * branch for a role it does not recognise on a list, so a staff member sees
 * the rows that are about them and nothing else, without a special case
 * anybody has to remember to write.
 */
export const ROLES = ['owner', 'spouse', 'adult', 'child', 'guest', 'staff'];

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
    /**
     * Profile sections this person has said do not apply to them.
     *
     * Hidden from the form because it is answered by dismissing a section on
     * the profile, not by typing section ids into a box. It exists so that
     * "no vehicles, and that is correct" is a recordable answer — without it
     * the completion figure is capped for anybody who rents and takes the
     * bus, and a number nobody can move is a number nobody reads.
     */
    { key: 'notApplicableSections', type: 'tags', label: 'Not applicable', hidden: true },
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
    { key: 'heldMobile', type: 'phone', label: 'Mobile', group: 'As they hold it', encrypted: true },
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
    ['byImportKey', 'importKey'],
    // The legs of one movement. `transaction.movement` points at the event, so
    // asking an event for its own legs is a reverse lookup — and without this
    // it is a scan of every transaction the household has, to find two.
    ['byMovement', 'movement']],
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

/**
 * Something a household is saving toward.
 *
 * The funding is named here — which accounts and which holdings hold the money
 * — because a target with no source is a note, and a progress bar over a
 * hand-typed "saved so far" is a number that agrees with itself.
 *
 * Two goals naming the same account is not prevented by the schema, because a
 * household may well be mid-decision about which one that money is for.
 * `domain/goals.js` refuses to report progress for either until they say,
 * rather than showing both as funded by the same rupees.
 */
const goal = {
  name: 'goal', module: 'finance', sheet: 'Goals', version: 1,
  labels: { one: 'Goal', many: 'Goals' }, icon: 'target',
  acl: restricted,
  title: (r) => r.name,
  fields: [
    { key: 'name', type: 'text', required: true, list: true, search: true },
    pick('kind', [
      'emergency fund', 'purchase', 'education', 'retirement',
      'vehicle', 'property', 'travel', 'repayment', 'other',
    ], { default: 'purchase', list: true }),
    money('targetAmount', { list: true }),
    /** Emergency funds only: a target in months of spending rather than rupees. */
    num('targetMonths', { label: 'Target (months of spending)', min: 1, max: 60 }),
    day('targetDate', { list: true }),
    { key: 'accounts', type: 'multiref', ref: 'account', label: 'Funded by' },
    { key: 'holdings', type: 'multiref', ref: 'holding', label: 'And by holdings' },
    ref('owner', 'person'),
    day('achievedOn', { label: 'Reached on' }),
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
    text('nominee', { encrypted: true }),
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
    // The expiry dates a document gave when it gave more than one.
    //
    // A motor policy schedule states `Date of Expiry` twice — once for its own
    // cover and once for the third-party policy it sits beside — and nothing
    // in the text says which is which. `domain/extract.js` refuses to choose,
    // which leaves `expiresOn` empty and the document invisible to the
    // Expiring list. This is what stops that silence: the dates it did give,
    // so somebody can open it and set one.
    text('expiryConflict', { label: 'Expiry stated more than once', hidden: true }),
    tags(),
    text('driveFileId', { hidden: true }),
    text('driveFolderId', { hidden: true }),
    text('fileName', { list: true }),
    text('mimeType', { hidden: true }),
    num('sizeBytes', { hidden: true }),
    num('versionCount', { default: 1, hidden: true }),
    // The template this was produced from, by file name.
    //
    // Not a reference: a template is a `.docx` the household uploads each
    // time, and there is no template record to point at. Naming the file is
    // the whole of what can honestly be recorded, and it is worth recording —
    // a generated document that cannot say what it was generated from is a
    // document nobody can reproduce or check.
    text('generatedFrom', { label: 'Generated from', list: true }),
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
    day('endsOn', { list: true, expiry: true, expiryLead: 7 }),
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
    text('nominee', { encrypted: true }),
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
    /**
     * The account this property's rent arrives in.
     *
     * Optional, and the thing that makes a payment attributable. Without it,
     * rent is matched by amount alone — and two flats let at the same rent
     * both claimed the same credit, which produced two signed receipts for
     * one payment. See `js/domain/rentreceipt.js`.
     */
    ref('rentAccount', 'account', { label: 'Rent arrives in', group: 'Rental' }),
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
  // Pinned first, then newest. `pinned` was on the form and read by nothing —
  // a pin that moved nothing is a lie a screen tells — and it was invisible to
  // the field-coverage ratchet because one unrelated comment used the word.
  sort: '-pinned,-updatedAt',
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
      'recovery phrase', 'software licence'], { required: true, default: 'login', list: true }),
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

/* ----------------------------------------------------- 15b. Belongings */

/**
 * Something the household bought and still owns.
 *
 * Not a transaction. `transaction` is money leaving an account and
 * `economicEvent` is what that money meant; this is the **object** — the
 * washing machine, the laptop, the fridge — which outlives both and is the
 * thing a warranty, a service call or an insurance claim is actually about.
 * The three are linked rather than merged, because a purchase paid in four
 * instalments is one object and four transactions, and collapsing them would
 * make the household own four washing machines.
 *
 * `serialNumber` is encrypted. It is the number an insurer asks for and a
 * thief would like, and it is exactly the shape of identifier this application
 * encrypts everywhere else.
 */
const purchase = {
  name: 'purchase', module: 'belongings', sheet: 'Purchases', version: 1,
  labels: { one: 'Purchase', many: 'Belongings' }, icon: 'box',
  acl: restricted,
  sort: '-boughtOn',
  title: (r) => r.item,
  subtitle: (r) => r.seller,
  fields: [
    text('item', { label: 'What it is', required: true, list: true, search: true }),
    pick('category', ['appliance', 'electronics', 'furniture', 'jewellery',
      'tools', 'sports', 'clothing', 'other'], { default: 'other', list: true }),
    day('boughtOn', { label: 'Bought on', required: true, list: true }),
    money('amount', { label: 'Price paid', list: true }),
    text('seller', { label: 'Bought from', list: true, search: true }),
    text('model', { search: true }),
    { key: 'serialNumber', type: 'text', label: 'Serial number', encrypted: true },
    ref('person', 'person', { label: 'Belongs to' }),
    ref('property', 'property', { label: 'Kept at' }),
    ref('transaction', 'transaction', { label: 'Paid by' }),
    { key: 'receipts', type: 'files', label: 'Receipt or invoice' },
    // A thing that has left the household is still a fact about it: a warranty
    // claim, an insurance question and a tax computation all outlive the sale.
    day('disposedOn', { label: 'Sold or disposed of' }),
    note(),
  ],
};

/**
 * A promise somebody made about something bought.
 *
 * Its own entity rather than two fields on `purchase`, for two reasons that
 * both happen in ordinary households. A thing can carry more than one — the
 * manufacturer's year and the shop's extended three — and they expire on
 * different days from different people. And a thing can carry a warranty with
 * no purchase record at all, because it was a gift or was inherited, and a
 * design that cannot record that would push somebody to invent a purchase.
 *
 * `expiresOn` is marked `expiry`, which is the whole point: `domain/
 * reminders.js` walks the schema for expiry fields, so this produces reminders
 * the day it exists without a line of code being written for it. Sixty days of
 * lead, because a claim needs the receipt found, the shop called and the item
 * carried in — which is not a fortnight's work.
 */
const warranty = {
  name: 'warranty', module: 'belongings', sheet: 'Warranties', version: 1,
  labels: { one: 'Warranty', many: 'Warranties' }, icon: 'shield',
  acl: restricted,
  sort: 'expiresOn',
  title: (r) => r.cover,
  fields: [
    text('cover', { label: 'What it covers', required: true, list: true, search: true }),
    ref('purchase', 'purchase', { label: 'On', list: true }),
    text('provider', { label: 'Given by', list: true, search: true }),
    pick('kind', ['manufacturer', 'extended', 'shop', 'insurance-backed'],
      { default: 'manufacturer', list: true }),
    day('startsOn'),
    day('expiresOn', { label: 'Expires on', required: true, list: true, expiry: true, expiryLead: 60 }),
    { key: 'claimPhone', type: 'phone', label: 'Claim on', encrypted: true },
    { key: 'claimUrl', type: 'url', label: 'Claim online' },
    { key: 'documents', type: 'files', label: 'Warranty card' },
    note(),
  ],
};

/* --------------------------------------------------------- 15c. Travel */

/**
 * A journey, and the papers it needs.
 *
 * The reason this is not a calendar event: an event is a moment, and a trip is
 * a container. Flights, a visa, an insurance policy and four passports all
 * belong to one journey, and the question a household actually asks the night
 * before — *have we got everything* — is a question about the container.
 *
 * `travellers` is a `multiref`, because who is going decides which passports
 * and which visas matter, and a trip with one traveller field would make a
 * family of four record the same journey four times.
 */
const trip = {
  name: 'trip', module: 'travel', sheet: 'Trips', version: 1,
  labels: { one: 'Trip', many: 'Travel' }, icon: 'globe',
  acl: restricted,
  sort: '-departsOn',
  title: (r) => r.destination,
  fields: [
    text('destination', { required: true, list: true, search: true }),
    pick('kind', ['holiday', 'work', 'family', 'medical', 'education', 'other'],
      { default: 'holiday', list: true }),
    day('departsOn', { label: 'Leaves on', required: true, list: true }),
    day('returnsOn', { label: 'Returns on', list: true }),
    { key: 'travellers', type: 'multiref', ref: 'person', label: 'Who is going' },
    { key: 'international', type: 'boolean', label: 'Leaves the country', list: true },
    money('budget', { label: 'Budget' }),
    text('stayingAt', { search: true }),
    ref('policy', 'policy', { label: 'Travel insurance' }),
    { key: 'bookings', type: 'files', label: 'Tickets and bookings' },
    note(),
  ],
};

/* ------------------------------------------------------- 15d. Tenancy */

/**
 * Somebody renting a property the household owns.
 *
 * ## The person record, and the thing worth being honest about
 *
 * A tenant is a `person`, the same way `staff` is, and that is a decision with
 * a cost. It means the household creates a record about somebody who is not in
 * the household, did not ask to be recorded, and has no way to see or correct
 * what is written. `docs/DATA_CONSENT.md` covers what a household consents to
 * about itself; a third party is a different question and this does not
 * pretend to answer it.
 *
 * It is done this way because the alternative is worse. Duplicating name,
 * phone and address onto a tenancy row means the same person recorded twice
 * when they renew, and no way to see that the tenant of flat 1 in 2024 is the
 * tenant of flat 2 now. What limits the exposure is the role: a tenant's
 * person record carries `guest`, which `rowFilter` allows almost nothing.
 *
 * What is stored is what a rent agreement already contains. Nothing here asks
 * for an identity number, and that omission is deliberate.
 *
 * `agreementEndsOn` carries `expiry`, so a tenancy running out produces
 * reminders like everything else with a deadline — ninety days, because
 * renewing or re-letting takes a season rather than a fortnight.
 */
const tenant = {
  name: 'tenant', module: 'property', sheet: 'Tenants', version: 1,
  labels: { one: 'Tenant', many: 'Tenants' }, icon: 'home',
  acl: restricted,
  sort: '-agreementStartsOn',
  title: (r) => r.name,
  fields: [
    text('name', { label: 'Name', required: true, list: true, search: true }),
    ref('property', 'property', { label: 'Renting', required: true, list: true }),
    // Optional on purpose. A person record is the right shape once the same
    // tenant renews or moves between properties, and an unnecessary one for a
    // single short let.
    ref('person', 'person', { label: 'Also recorded as' }),
    { key: 'phone', type: 'phone', encrypted: true }, // sealed ⇒ not a list column
    { key: 'email', type: 'email' },
    day('agreementStartsOn', { label: 'Agreement from', list: true }),
    day('agreementEndsOn', { label: 'Agreement until', list: true, expiry: true, expiryLead: 90 }),
    money('monthlyRent', { label: 'Rent a month', list: true }),
    money('deposit', { label: 'Deposit held' }),
    pick('rentDueOn', ['1st', '5th', '10th', '15th', 'end of month'], { default: '1st' }),
    { key: 'depositReturnedOn', type: 'date', label: 'Deposit returned on' },
    { key: 'agreements', type: 'files', label: 'Rent agreement' },
    note(),
  ],
};

/* ----------------------------------------------------------------- 14. Chat */

/**
 * A device that can read messages.
 *
 * The public half only. The private half never reaches this table, never syncs
 * and never leaves the device that made it — it lives in `meta`, wrapped by
 * the household key, and if that device is lost it is lost with it.
 *
 * `fingerprint` is stored so two people can compare a number without either of
 * them re-deriving it from a key they would have to fetch first. `verifiedAt`
 * is set when somebody says they compared it and it matched, and it is a claim
 * by a person rather than something the application can check — which is what
 * makes it worth recording.
 */
const deviceKey = {
  name: 'deviceKey', module: 'chat', sheet: 'DeviceKeys', version: 1,
  labels: { one: 'Device key', many: 'Device keys' }, icon: 'shield',
  acl: { read: HOUSEHOLD, write: HOUSEHOLD },
  sort: '-addedAt',
  indexes: [['byPerson', 'person'], ['byDevice', 'deviceId']],
  title: (r) => r.label || r.deviceId,
  subtitle: (r) => (r.revokedAt ? 'revoked' : r.verifiedAt ? 'verified' : 'not verified'),
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('deviceId', { label: 'Device', required: true, list: true }),
    text('label', { label: 'Called', list: true, search: true }),
    // Public. Deliberately not encrypted: it is a public key, and encrypting
    // it would only make it harder to reach for the thing it exists for.
    text('publicKey', { label: 'Public key', required: true, hidden: true }),
    text('fingerprint', { label: 'Safety number' }),
    { key: 'addedAt', type: 'text', label: 'Added', required: true, list: true },
    { key: 'verifiedAt', type: 'text', label: 'Verified' },
    { key: 'revokedAt', type: 'text', label: 'Revoked', list: true },
    note(),
  ],
};

/**
 * A conversation between named people.
 *
 * The participant list is not a secret and is not encrypted — the household
 * can see that a conversation exists and who is in it. What it cannot see is
 * what was said. Hiding the existence of a conversation from the household
 * that owns the database would need a different design and would be a claim
 * this cannot support, so it is not made.
 */
const conversation = {
  name: 'conversation', module: 'chat', sheet: 'Conversations', version: 1,
  labels: { one: 'Conversation', many: 'Conversations' }, icon: 'chat',
  acl: { read: HOUSEHOLD, write: HOUSEHOLD },
  sort: '-startedAt',
  title: (r) => r.title,
  fields: [
    text('title', { required: true, list: true, search: true }),
    { key: 'participants', type: 'multiref', ref: 'person', label: 'Between', required: true },
    { key: 'startedAt', type: 'text', label: 'Started', required: true, list: true },
    { key: 'closedAt', type: 'text', label: 'Closed' },
    note(),
  ],
};

/**
 * One message, already sealed.
 *
 * `body` holds the sealed envelope from `security/e2ee.js` as JSON, and is
 * **not** marked `encrypted: true`. That is not an oversight. `encrypted: true`
 * means "encrypt this with the household data key", and a message the
 * household key can open is not end-to-end encrypted — the whole property is
 * that this row is unreadable to everything except the devices it was sealed
 * to. Adding household encryption on top would change nothing about who can
 * read it and would suggest to a reader of this schema that the household key
 * is what protects it.
 *
 * `sentAt` and `sender` are in the clear, so a list of conversations can be
 * ordered and attributed without opening anything. That is metadata this
 * design does not hide, and `docs/CHAT_AND_E2EE.md` says so.
 */
const message = {
  name: 'message', module: 'chat', sheet: 'ChatMessages', version: 1,
  labels: { one: 'Message', many: 'Messages' }, icon: 'chat',
  acl: { read: HOUSEHOLD, write: HOUSEHOLD },
  sort: 'sentAt',
  indexes: [['byConversation', 'conversation'], ['bySentAt', 'sentAt']],
  title: (r) => `Message ${r.sentAt ?? ''}`.trim(),
  fields: [
    ref('conversation', 'conversation', { required: true, list: true }),
    ref('sender', 'person', { required: true, list: true }),
    { key: 'sentAt', type: 'text', label: 'Sent', required: true, list: true },
    { key: 'body', type: 'textarea', label: 'Sealed body', required: true, hidden: true },
    { key: 'readBy', type: 'multiref', ref: 'person', label: 'Read by' },
    { key: 'deletedForEveryone', type: 'boolean', label: 'Withdrawn' },
  ],
};

/* --------------------------------------------------------------- 15. Safety */

/**
 * A circle on the map with a name.
 *
 * Not a geofence. A real geofence is registered with the operating system and
 * wakes the application when it is crossed; this is a centre and a radius that
 * `domain/geo.js` compares a position against when the application happens to
 * have one. The arithmetic is the same and the wake-ups do not exist, and
 * `docs/LOCATION.md` says which is which.
 *
 * The radius is in metres and required, because a zone without one is not a
 * circle. Fifty metres is about a house; five hundred is about a school and
 * its grounds.
 */
const safeZone = {
  name: 'safeZone', module: 'safety', sheet: 'SafeZones', version: 1,
  labels: { one: 'Safe zone', many: 'Safe zones' }, icon: 'shield',
  acl: { read: HOUSEHOLD, write: ALL_ADULTS },
  sort: 'name',
  title: (r) => r.name,
  subtitle: (r) => (r.radiusMetres ? `${r.radiusMetres} m` : ''),
  fields: [
    text('name', { required: true, list: true, search: true }),
    pick('kind', ['home', 'school', 'work', 'family', 'clinic', 'other'],
      { default: 'home', list: true }),
    num('latitude', { required: true, min: -90, max: 90 }),
    num('longitude', { required: true, min: -180, max: 180 }),
    num('radiusMetres', { label: 'Radius in metres', required: true, min: 10, max: 50_000, list: true, default: 150 }),
    // Optional: a zone is often a property already on file, and naming it
    // saves recording the same place twice.
    ref('property', 'property', { label: 'Same place as' }),
    { key: 'watch', type: 'multiref', ref: 'person', label: 'Tell me about' },
    note(),
  ],
};

/**
 * One reading of where a person's device was, at a moment.
 *
 * ## Why a history exists, and what that means
 *
 * The household chose to keep one rather than only the latest position. That
 * is a real choice with a real cost, and it is written here rather than left
 * in a commit message: this table is a record of where the people in a family
 * have been. It is the most sensitive thing in the database — more than the
 * money, because money says what you bought and this says where you were.
 *
 * So: the coordinates are encrypted, the rows age out on the `location`
 * retention policy rather than being kept, and there is no background capture
 * to fill it in when nobody is looking. A row exists because somebody had the
 * application open and it read a position.
 *
 * `accuracyMetres` is not decoration. Without it no row can be placed against
 * a zone honestly, and `domain/geo.js` refuses to try — see `WHERE.UNCERTAIN`.
 */
const locationPing = {
  name: 'locationPing', module: 'safety', sheet: 'Locations', version: 1,
  labels: { one: 'Location reading', many: 'Location readings' }, icon: 'globe',
  // A child may write their own readings — their device is what produces them
  // — and `ownRecordAllows` on the server widens that to their own rows only.
  // Reading is adults, which is the household's decision recorded in
  // docs/LOCATION.md: a parent sees a child, and a child does not see a
  // sibling.
  acl: { read: ALL_ADULTS, write: HOUSEHOLD },
  sort: '-recordedAt',
  indexes: [['byPerson', 'person'], ['byRecordedAt', 'recordedAt']],
  title: (r) => r.zoneName || 'Location reading',
  fields: [
    ref('person', 'person', { required: true, list: true }),
    { key: 'recordedAt', type: 'text', label: 'Taken at', required: true, list: true },
    num('latitude', { required: true, encrypted: true }),
    num('longitude', { required: true, encrypted: true }),
    num('accuracyMetres', { label: 'Accurate to (m)', list: true }),
    // Resolved when the row is written, so a screen can name the place without
    // decrypting every coordinate in the table to find out.
    text('zoneName', { label: 'Zone', list: true }),
    ref('zone', 'safeZone', { label: 'Inside zone' }),
    pick('source', ['device', 'manual'], { default: 'device', list: true }),
    note(),
  ],
};

/**
 * Somebody said they need help.
 *
 * What this is: a record, with a position attached if one could be read, and a
 * message the household can hand to their phone's own share sheet or dialler.
 *
 * What this is not: an alert that reaches anybody by itself. There is no
 * server in this application to send from, no SMS gateway and no push. An SOS
 * that silently failed to send would be the worst object this repository could
 * produce, so nothing here claims to send: the screen composes, the person
 * sends, and `sentVia` records what they said they did.
 */
const sosAlert = {
  name: 'sosAlert', module: 'safety', sheet: 'SOSAlerts', version: 1,
  labels: { one: 'SOS', many: 'SOS alerts' }, icon: 'alert',
  acl: { read: HOUSEHOLD, write: HOUSEHOLD },
  sort: '-raisedAt',
  indexes: [['byPerson', 'person'], ['byRaisedAt', 'raisedAt']],
  title: (r) => r.reason || 'SOS',
  fields: [
    ref('person', 'person', { required: true, list: true }),
    { key: 'raisedAt', type: 'text', label: 'Raised at', required: true, list: true },
    text('reason', { list: true, search: true }),
    num('latitude', { encrypted: true }),
    num('longitude', { encrypted: true }),
    num('accuracyMetres', { label: 'Accurate to (m)' }),
    text('whereabouts', { label: 'Where, in words', search: true }),
    { key: 'contacts', type: 'multiref', ref: 'emergencyContact', label: 'Meant for' },
    pick('sentVia', ['not sent', 'phone call', 'message', 'shared'], { default: 'not sent', list: true }),
    { key: 'resolvedAt', type: 'text', label: 'Stood down at' },
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
    { key: 'phone', type: 'phone', required: true, encrypted: true }, // sealed ⇒ no list
    { key: 'altPhone', type: 'phone', encrypted: true },
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

/**
 * A message the household brought in, kept because it is evidence.
 *
 * ## Why it is stored at all
 *
 * `domain/sms.js` reads a message and `services/sms.js` reconciles one, and
 * until now neither kept anything. That made rule 52 — *multiple sources
 * describing one event are linked, not duplicated* — unachievable by
 * construction: there was no second source to link to, only a reading that
 * vanished when the screen closed.
 *
 * A stored message is the **evidence** behind a link. A household asking why a
 * transaction is dated the 15th when the bank statement says the 16th can be
 * shown the alert that arrived on the 15th. Nothing else in the application can
 * answer that.
 *
 * ## What it must never hold
 *
 * **Rule 53.** A message classified `AUTHENTICATION_SECRET` is never written —
 * not with its text redacted, not with its amount kept, not at all. The check
 * runs in `domain/sms.js` before any field is read, and `services/sms.js`
 * refuses the write before the repository is reached. There is no field on this
 * entity that could hold a one-time code, and that is deliberate: a schema with
 * nowhere to put a secret cannot be talked into keeping one.
 *
 * ## It is never authoritative
 *
 * **Rule 51.** `authoritative` is not a field here, because it would be a
 * constant `false` and a stored constant is one edit away from being wrong.
 * `SOURCE_PRIORITY` in `domain/sms.js` says where a message ranks — below every
 * statement, above only an AI inference — and the reconciler reads that rather
 * than a column.
 */
const smsMessage = {
  name: 'smsMessage', module: 'finance', sheet: 'Messages', version: 1,
  labels: { one: 'Message', many: 'Messages' }, icon: 'inbox',
  acl: restricted,
  sort: '-receivedAt',
  indexes: [['byFingerprint', 'fingerprint'], ['byTransaction', 'transaction']],
  title: (r) => r.sender || r.category,
  subtitle: (r) => r.category,
  fields: [
    text('sender', { required: true, list: true, label: 'From' }),
    day('receivedAt', { required: true, list: true, label: 'Received' }),
    // Encrypted: a bank alert names an account tail, a payee and a balance.
    { key: 'text', type: 'textarea', label: 'Message', encrypted: true },
    text('category', { list: true }),
    money('amount', { list: true }),
    pick('direction', ['in', 'out']),
    text('accountTail', { label: 'Account ending', encrypted: true }),
    text('reference', { label: 'Reference' }),
    money('balance', { label: 'Balance stated' }),
    day('transactionDate', { label: 'Date in the message' }),
    // What makes the same message arriving twice one record rather than two.
    text('fingerprint', { hidden: true }),
    pick('source', ['imported', 'native'], { default: 'imported' }),
    // Rule 52: the link, not a copy. A message and a statement row are two
    // pieces of evidence for one event, and this is which row.
    ref('transaction', 'transaction', { label: 'Matched row' }),
    text('agreement', { label: 'Against the statement' }),
    note(),
  ],
};

/* ---------------------------------------------------------------- registry */


/* --------------------------------------------------- 12. Household staff */

/**
 * Somebody the household employs — a cook, a driver, a helper.
 *
 * **This is a role, not a person.** `person` is a reference, and every name,
 * phone number and identity document belongs on that record like anybody
 * else's. Giving staff their own name and ID fields would create a second
 * identity record for a human being, which is the failure the CKYC rules
 * exist to prevent: a person is a person, and what they do for this household
 * is a fact *about* them.
 *
 * It follows that the same person can hold two roles over time — a driver who
 * later cooks is two `staff` records and one `person`, and their history is
 * not split in half.
 *
 * **`monthlyPay` is what was agreed, not what was paid.** Wages actually paid
 * are economic events like any other money leaving the household, recorded
 * through the ledger where they can be reconciled and explained under rule 57.
 * A figure stored here that nothing reconciles would be a second, parallel
 * money path — a household would have wages that never appear in the ledger.
 */
const staff = {
  name: 'staff', module: 'family', sheet: 'Staff', version: 1,
  labels: { one: 'Staff member', many: 'Staff' }, icon: 'users',
  acl: restricted,
  title: (r) => r.role,
  fields: [
    ref('person', 'person', { required: true, list: true }),
    text('role', { required: true, list: true, search: true }),
    day('startedOn', { list: true }),
    // Absent while they still work here. A leaving date is what makes a
    // record history rather than a deletion.
    day('endedOn', { list: true }),
    money('monthlyPay', { label: 'Agreed monthly pay', list: true }),
    pick('paidEvery', ['month', 'week', 'day', 'task'], { default: 'month' }),
    note(),
  ],
};


/**
 * A day a staff member did not work.
 *
 * **Absence is recorded, not presence**, and that is the whole design. A row
 * per working day would be twenty-six rows a month per person that a
 * household will never keep up — and rows nobody enters lie by omission,
 * because an empty month would read as *never came* rather than as *nothing
 * unusual*. Recording only what interrupted the arrangement means an empty
 * record is the truthful default.
 *
 * `paid` is the field that matters beyond the diary. Unpaid leave changes what
 * a month owes, and `domain/staffpay.js` refuses to judge a month containing
 * any — deducting for it needs a daily rate, and dividing a monthly figure by
 * a number of working days is arithmetic this household never agreed to. The
 * same refusal it already makes for a weekly agreement.
 */
const staffLeave = {
  name: 'staffLeave', module: 'family', sheet: 'StaffLeave', version: 1,
  labels: { one: 'Absence', many: 'Absences' }, icon: 'calendar',
  acl: restricted,
  title: (r) => `${r.kind ?? 'away'} from ${r.from ?? ''}`,
  fields: [
    ref('staff', 'staff', { required: true, list: true }),
    day('from', { required: true, list: true }),
    // Absent for a single day. A one-day absence should not require typing the
    // same date twice.
    day('to', { list: true }),
    pick('kind', ['leave', 'sick', 'holiday', 'absent'], { default: 'leave', list: true }),
    { key: 'paid', type: 'boolean', default: true, label: 'Paid', list: true },
    note(),
  ],
};

/* ---------------------------------------------------------------- 12. Legal */

/**
 * A legal instrument that exists, and where the original is.
 *
 * **Not the instrument itself.** This application records that a deed or a
 * power of attorney exists, who it concerns and where to find it. It does not
 * hold the operative text, does not sign anything, and must never look as
 * though a record here has legal effect — the original does.
 */
const legalDocument = {
  name: 'legalDocument', module: 'vault', sheet: 'LegalDocuments', version: 1,
  labels: { one: 'Legal document', many: 'Legal documents' }, icon: 'file',
  acl: secret,
  title: (r) => r.title,
  fields: [
    { key: 'title', type: 'text', required: true, list: true, search: true },
    pick('kind', [
      'power of attorney', 'trust deed', 'gift deed', 'sale deed',
      'partnership deed', 'succession certificate', 'legal heir certificate',
      'affidavit', 'court order', 'agreement', 'other',
    ], { required: true, list: true }),
    ref('concerns', 'person', { label: 'Concerns' }),
    day('executedOn', { list: true }),
    { key: 'registered', type: 'boolean', label: 'Registered' },
    { key: 'registrationNumber', type: 'text', encrypted: true },
    { key: 'whereKept', type: 'text', label: 'Where the original is kept' },
    { key: 'custodian', type: 'text', label: 'Held by' },
    day('supersededOn', { label: 'Superseded on' }),
    attach(),
    note(),
  ],
};

/**
 * That a will exists, whose it is, and where.
 *
 * The same refusal, and it matters more here than anywhere else in the schema:
 * **this is not the will.** A will is a formal instrument with requirements
 * this application does not meet and does not try to — no signature mechanism,
 * no generated text, no claim of validity. What is recorded is that one exists
 * so a family can find it, and what the household understands it to say so the
 * two can be compared with the nominations already on file.
 *
 * `revokedOn` exists because a revoked will must stop being compared against
 * anything. A superseded will's beneficiaries are not a disagreement with the
 * current nominations; they are a record of a decision already replaced.
 */
const will = {
  name: 'will', module: 'vault', sheet: 'Wills', version: 1,
  labels: { one: 'Will', many: 'Wills' }, icon: 'file',
  acl: secret,
  title: (r) => r.title,
  fields: [
    { key: 'title', type: 'text', required: true, list: true, search: true },
    ref('testator', 'person', { required: true, list: true, label: 'Whose will' }),
    day('executedOn', { list: true }),
    { key: 'registered', type: 'boolean', label: 'Registered' },
    { key: 'whereKept', type: 'text', label: 'Where the original is kept' },
    { key: 'executor', type: 'text', label: 'Executor named' },
    ref('executorPerson', 'person', { label: 'Executor, if in the household' }),
    { key: 'witnesses', type: 'number', label: 'Witnesses', min: 0, max: 10 },
    day('revokedOn', { label: 'Revoked or superseded on', list: true }),
    attach(),
    note(),
  ],
};

/**
 * Somebody a will names, and what it leaves them.
 *
 * `share` is free text on purpose. Wills say "one third", "the residue",
 * "equally between my children" and "my share of the Bengaluru flat", and a
 * percentage field would force every one of those into a number the will never
 * stated. Nothing computes with it.
 *
 * `asset` optionally points at a record already in the application, which is
 * what lets a bequest be read against that record's nominee. Where it is left
 * blank the beneficiary is still recorded — a will naming somebody is worth
 * knowing even when nothing here matches it.
 */
const beneficiary = {
  name: 'beneficiary', module: 'vault', sheet: 'Beneficiaries', version: 1,
  labels: { one: 'Beneficiary', many: 'Beneficiaries' }, icon: 'user',
  acl: secret,
  title: (r) => r.name,
  fields: [
    ref('will', 'will', { required: true, list: true }),
    { key: 'name', type: 'text', required: true, list: true, search: true },
    ref('person', 'person', { label: 'Who, if in the household' }),
    { key: 'relationship', type: 'text' },
    { key: 'share', type: 'text', label: 'What the will leaves them', list: true },
    /**
     * The record this bequest speaks to, where one is in the application.
     *
     * There is no companion "kind of asset" field. `nominations()` already
     * knows what each record is, and a hand-set copy beside it is the second
     * source of truth this project has now found three times.
     */
    { key: 'assetId', type: 'text', label: 'Which record, if one matches', hidden: true },
    note(),
  ],
};


export const entities = Object.freeze(Object.fromEntries(
  [person, relationship, identityDocument, kycRecord, employment, importantDate,
    account, transaction, economicEvent, bankStatement, receipt, budget,
    recurringPayment, loan,
    holding, investmentTransaction, document,
    vehicle, vehicleService, fuelLog,
    healthRecord, medication, vaccination, appointment,
    policy, property, education, certificate,
    purchase, warranty, trip, tenant,
    project, task, event, noteEntity, vaultItem,
    digitalAsset, subscription, emergencyContact, smsMessage,
    safeZone, locationPing, sosAlert,
    deviceKey, conversation, message,
    staff, staffLeave, goal,
    legalDocument, will, beneficiary,
  ].map((e) => [e.name, normalise(e)]),
));

/** Modules, in navigation order. Declared in `./modules.js`. */
export const modules = withEntities(entities);

/**
 * Every entity names a module that exists. An entity whose module is misspelt
 * would vanish from navigation without any other symptom, so this is checked
 * once, at load, in the same spirit as `entity()` throwing on an unknown name.
 */
for (const e of Object.values(entities)) {
  if (!modules.some((m) => m.id === e.module)) {
    throw new Error(`entity ${e.name} names a module that does not exist: ${e.module}`);
  }
}

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
  // `byRecord` is what makes a single record's own history answerable. Without
  // it the log can be asked what happened recently and what happened to
  // *accounts*, and never what happened to **this** account — which is the
  // question somebody looking at a record actually has.
  audit: {
    keyPath: 'id',
    indexes: [['byAt', 'at'], ['byEntity', 'entity'], ['byRecord', 'recordId']],
  },
  conflicts: { keyPath: 'id', indexes: [['byStore', 'store']] },
  meta: { keyPath: 'key', indexes: [] },
  blobs: { keyPath: 'id', indexes: [] },
  search: { keyPath: 'id', indexes: [['byTerm', 'term', { multiEntry: true }]] },
  /**
   * Things that went wrong on this device, redacted and bounded.
   *
   * A system store rather than an entity: it does not sync, is not encrypted
   * because it must not contain anything worth encrypting, and nothing points
   * at it. See `js/data/diagnostics.js` for why the redaction is the whole
   * safety argument.
   */
  diagnostics: { keyPath: 'id', indexes: [] },
  /**
   * Sealed chat attachments.
   *
   * Its own store rather than a corner of `blobs`, which holds documents.
   * They look alike and behave differently: a document blob is encrypted with
   * the household key and uploaded to Drive, an attachment is sealed to the
   * recipients' devices and never leaves. Sharing a store meant the document
   * sweep in `js/sync/drive.js` picked attachments up and deleted them as
   * orphans, because they have no `documentId` — measured, and the reason
   * this store exists.
   */
  attachments: { keyPath: 'id', indexes: [['byMessage', 'message']] },
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

/**
 * Every field on an entity that points at another record.
 *
 * **A field is a reference because it carries a `ref`, not because its type is
 * on a list.** `referencedBy` and `danglingReferences` used to test
 * `type === 'ref' || type === 'multiref'`, which quietly excluded the
 * seventeen `files` fields — every document attachment in the schema. A
 * document attached to a transaction reported that nothing referenced it, so
 * deleting it was offered as safe and left the transaction pointing at
 * nothing, and the data-health check written to find exactly that saw none of
 * it.
 *
 * Derived here so a fourth kind of reference cannot be missed the same way.
 *
 * `many` says how to read the value: a list, or a single id.
 */
export function referenceFields(entityName) {
  return entity(entityName).fields
    .filter((f) => Boolean(f.ref))
    .map((f) => ({
      key: f.key,
      label: f.label,
      ref: f.ref,
      type: f.type,
      many: f.type === 'multiref' || f.type === 'files',
    }));
}

/** The ids a reference field points at, however it stores them. */
export function referencedIds(record, field) {
  const value = record?.[field.key];
  if (field.many) return Array.isArray(value) ? value.filter(Boolean) : [];
  return value ? [value] : [];
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
