/**
 * Validation and coercion.
 *
 * One pass does both: a form gives strings, a sync pull gives whatever the
 * sheet had, and both must end up as the same normalised record. Coercion
 * happens first — `"1,200"` becomes 120000 paise — and validation then runs on
 * the coerced value, so a rule never has to consider two representations.
 *
 * `validate` returns `{ record, issues }` rather than throwing, because a form
 * wants every issue at once to mark every bad field, while the repository
 * wants a single throw. The repository does the throwing.
 */

import { entity } from './schema.js';
import { formats, formatForDocumentKind } from './formats.js';
import { toMinor } from '../core/money.js';
import { isDay, today } from '../core/dates.js';
import { ValidationError } from '../core/errors.js';

const EMPTY = (v) => v === undefined || v === null || v === '';

/* -------------------------------------------------------------- coercion */

const coercers = {
  text: (v) => (EMPTY(v) ? '' : String(v).trim()),
  textarea: (v) => (EMPTY(v) ? '' : String(v)),
  richtext: (v) => (EMPTY(v) ? '' : String(v)),
  password: (v) => (EMPTY(v) ? '' : String(v)),
  color: (v) => (EMPTY(v) ? '' : String(v).trim()),
  time: (v) => (EMPTY(v) ? '' : String(v).trim()),
  date: (v) => (EMPTY(v) ? '' : String(v).trim().slice(0, 10)),
  email: (v) => (EMPTY(v) ? '' : formats.email.normalise(v)),
  phone: (v) => (EMPTY(v) ? '' : formats.phone.normalise(v)),
  url: (v) => (EMPTY(v) ? '' : formats.url.normalise(v)),
  ref: (v) => (EMPTY(v) ? '' : String(v).trim()),
  enum: (v) => (EMPTY(v) ? '' : String(v).trim()),
  boolean: (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1',
  number: (v) => {
    if (EMPTY(v)) return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : NaN; // NaN survives to be reported
  },
  currency: (v, _field, currency) => {
    if (EMPTY(v)) return null;
    // A record read back from storage is already in minor units. Only a
    // string needs parsing; a number that is already an integer is trusted.
    if (typeof v === 'number') return Number.isInteger(v) ? v : toMinor(v, currency);
    return toMinor(v, currency);
  },
  tags: (v) => toArray(v).map((x) => String(x).trim().toLowerCase()).filter(Boolean),
  multienum: (v) => toArray(v).map((x) => String(x).trim()).filter(Boolean),
  multiref: (v) => toArray(v).map((x) => String(x).trim()).filter(Boolean),
  files: (v) => toArray(v).map((x) => String(x).trim()).filter(Boolean),
  image: (v) => (EMPTY(v) ? '' : String(v)),
};

function toArray(v) {
  if (Array.isArray(v)) return v;
  if (EMPTY(v)) return [];
  // Sheets round-trips arrays as comma-joined text.
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------ field rules */

function checkField(field, value, currency) {
  const issue = (message) => ({ field: field.key, message });

  const missing = field.type === 'boolean'
    ? false
    : Array.isArray(value) ? value.length === 0 : EMPTY(value);

  if (field.required && missing) return issue(`${field.label} is required.`);
  if (missing) return null;

  switch (field.type) {
    case 'number':
      if (Number.isNaN(value)) return issue(`${field.label} must be a number.`);
      if (field.min !== undefined && value < field.min) {
        return issue(`${field.label} cannot be below ${field.min}.`);
      }
      if (field.max !== undefined && value > field.max) {
        return issue(`${field.label} cannot be above ${field.max}.`);
      }
      break;

    case 'currency':
      if (value === null || !Number.isFinite(value)) {
        return issue(`${field.label} must be an amount.`);
      }
      if (!Number.isInteger(value)) {
        return issue(`${field.label} has more precision than the currency allows.`);
      }
      break;

    case 'date':
      if (!isDay(value)) return issue(`${field.label} must be a real date.`);
      break;

    case 'time':
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        return issue(`${field.label} must be a time like 09:30.`);
      }
      break;

    case 'enum':
      if (field.options && !field.options.includes(value)) {
        return issue(`${field.label} must be one of: ${field.options.join(', ')}.`);
      }
      break;

    case 'multienum':
      if (field.options) {
        const bad = value.find((v) => !field.options.includes(v));
        if (bad) return issue(`${field.label} does not allow "${bad}".`);
      }
      break;

    case 'email':
      if (!formats.email.test(value)) return issue(formats.email.message);
      break;

    case 'phone':
      if (!formats.phone.test(value)) return issue(formats.phone.message);
      break;

    case 'url':
      if (!formats.url.test(value)) return issue(formats.url.message);
      break;

    case 'text':
      if (field.format && formats[field.format] && !formats[field.format].test(value)) {
        return issue(formats[field.format].message);
      }
      if (field.maxLength && value.length > field.maxLength) {
        return issue(`${field.label} is longer than ${field.maxLength} characters.`);
      }
      break;

    default:
      break;
  }

  if (currency) { /* reserved: per-field currency override */ }
  return null;
}

/* ------------------------------------------------------ cross-field rules */

/**
 * Rules that need more than one field. Kept here rather than in the schema so
 * `schema.js` stays a description and this stays the behaviour.
 * Each returns an issue, or null.
 */
export const entityRules = {
  identityDocument: [
    (r) => {
      const format = formatForDocumentKind(r.kind);
      if (!format || EMPTY(r.number)) return null;
      return format.test(r.number)
        ? null
        : { field: 'number', message: format.message };
    },
    (r) => (r.issuedOn && r.expiresOn && r.expiresOn < r.issuedOn
      ? { field: 'expiresOn', message: 'Expiry cannot be before the issue date.' }
      : null),
  ],
  transaction: [
    (r) => (r.amount !== null && r.amount < 0
      ? { field: 'amount', message: 'Enter a positive amount and pick income or expense.' }
      : null),
    // A transfer entered by hand names both ends. One read off a statement
    // cannot: the bank only ever shows its own side, and where the money went
    // — another person, another bank, a deposit — is often not an account this
    // household holds at all. So the destination is required of a transaction
    // somebody typed, and not of one that came from a statement.
    (r) => (r.kind === 'transfer' && !r.toAccount && !r.importKey
      ? { field: 'toAccount', message: 'A transfer needs a destination account.' }
      : null),
    (r) => (r.kind === 'transfer' && r.toAccount && r.toAccount === r.account
      ? { field: 'toAccount', message: 'A transfer must be between two different accounts.' }
      : null),
    (r) => (isDay(r.date) && r.date > addYearsToToday(1)
      ? { field: 'date', message: 'That date is more than a year away.' }
      : null),
  ],
  account: [
    (r) => (r.ifsc && !formats.IFSC.test(r.ifsc)
      ? { field: 'ifsc', message: formats.IFSC.message }
      : null),
    (r) => (r.upiId && !formats.UPI.test(r.upiId)
      ? { field: 'upiId', message: formats.UPI.message }
      : null),
    (r) => (r.kind === 'credit card' && !r.creditLimit
      ? { field: 'creditLimit', message: 'A credit card needs a limit for utilisation to mean anything.' }
      : null),
  ],
  vehicle: [
    (r) => (r.registration && !formats.vehicleRegistration.test(r.registration)
      ? { field: 'registration', message: formats.vehicleRegistration.message }
      : null),
  ],
  person: [
    (r) => (r.birthday && r.birthday > today()
      ? { field: 'birthday', message: 'A birthday cannot be in the future.' }
      : null),
    (r) => (r.deceasedOn && r.birthday && r.deceasedOn < r.birthday
      ? { field: 'deceasedOn', message: 'That is before the date of birth.' }
      : null),
  ],
  relationship: [
    (r) => (r.fromPerson && r.fromPerson === r.toPerson
      ? { field: 'toPerson', message: 'A person cannot be related to themselves.' }
      : null),
  ],
  loan: [
    (r) => (r.outstanding !== null && r.principal !== null && r.outstanding > r.principal
      ? { field: 'outstanding', message: 'Outstanding is more than the sanctioned amount.' }
      : null),
    (r) => (r.interestRate !== null && (r.interestRate < 0 || r.interestRate > 100)
      ? { field: 'interestRate', message: 'Interest rate must be between 0 and 100.' }
      : null),
  ],
  policy: [
    (r) => (r.startedOn && r.renewsOn && r.renewsOn < r.startedOn
      ? { field: 'renewsOn', message: 'Renewal cannot be before the policy started.' }
      : null),
  ],
  holding: [
    (r) => (r.units !== null && r.units < 0
      ? { field: 'units', message: 'Units cannot be negative.' }
      : null),
  ],
  budget: [
    (r) => (r.monthlyLimit !== null && r.monthlyLimit <= 0
      ? { field: 'monthlyLimit', message: 'A budget limit must be more than zero.' }
      : null),
  ],
  task: [
    (r) => (r.status === 'done' && !r.completedOn
      ? { field: 'completedOn', message: 'A completed task needs a completion date.' }
      : null),
  ],
  event: [
    (r) => (r.startTime && r.endTime && r.endTime < r.startTime
      ? { field: 'endTime', message: 'The end time is before the start time.' }
      : null),
  ],
  education: [
    (r) => (r.startedOn && r.endedOn && r.endedOn < r.startedOn
      ? { field: 'endedOn', message: 'The end date is before the start date.' }
      : null),
  ],
  employment: [
    (r) => (r.startedOn && r.endedOn && r.endedOn < r.startedOn
      ? { field: 'endedOn', message: 'The end date is before the start date.' }
      : null),
  ],
};

function addYearsToToday(n) {
  const t = today();
  return `${Number(t.slice(0, 4)) + n}${t.slice(4)}`;
}

/* --------------------------------------------------------------- entry point */

/**
 * @param {string} entityName
 * @param {object} input raw values, from a form or a sync pull
 * @param {{currency?: string, partial?: boolean}} [options]
 *   `partial` skips required checks, for a patch that touches some fields.
 * @returns {{record: object, issues: Array<{field: string, message: string}>}}
 */
export function validate(entityName, input, options = {}) {
  const { currency = 'INR', partial = false } = options;
  const def = entity(entityName);
  const record = {};
  const issues = [];

  for (const f of def.fields) {
    const present = Object.hasOwn(input, f.key);
    if (partial && !present) continue;

    let raw = present ? input[f.key] : undefined;
    if (!present && f.default !== undefined) {
      raw = f.default === 'today' ? today() : f.default;
    }

    const coerce = coercers[f.type] ?? coercers.text;
    const value = coerce(raw, f, currency);
    record[f.key] = value;

    const issue = checkField(partial ? { ...f, required: false } : f, value, null);
    if (issue) issues.push(issue);
  }

  // Cross-field rules only make sense on a whole record.
  if (!partial) {
    for (const rule of entityRules[entityName] ?? []) {
      const issue = rule(record);
      if (issue) issues.push(issue);
    }
  }

  return { record, issues };
}

/** Throws on the first problem. Used by the repository. */
export function validateOrThrow(entityName, input, options) {
  const { record, issues } = validate(entityName, input, options);
  if (issues.length) throw new ValidationError(issues, entityName);
  return record;
}
