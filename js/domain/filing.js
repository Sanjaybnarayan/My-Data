/**
 * Filing: where a document goes and how it is found again.
 *
 * Pure functions, deliberately below the view layer. The Documents screen uses
 * them, but so does the import path and so could a future OCR pass — and none
 * of them should have to load a rendering module to decide that
 * `HDFC statement.pdf` is a financial document.
 */

import { entity } from '../data/schema.js';

const CATEGORIES = entity('document').fieldMap.category.options;

/**
 * A first guess at the category, from words people actually put in filenames.
 * Ordered most specific first: "insurance policy for KA01AB1234" is insurance,
 * not vehicle, because that is how somebody would look for it.
 */
const RULES = [
  [/aadhaar|\bpan\b|passport|licence|license|voter|birth certificate|marriage/, 'identity'],
  [/insurance|policy|premium|mediclaim/, 'insurance'],
  [/\brc\b|registration|puc|fastag|vehicle|odometer/, 'vehicle'],
  [/sale ?deed|khata|property|land|flat|lease|rent agreement/, 'property'],
  [/salary|payslip|form ?16|offer letter|appointment|relieving/, 'employment'],
  [/\bitr\b|\btax\b|\bgst\b|\btds\b/, 'tax'],
  [/report|prescription|scan|x-?ray|blood|\blab\b|discharge/, 'health'],
  [/degree|marksheet|certificate|transcript|diploma|admit card/, 'education'],
  [/bank|statement|loan|\bemi\b|invoice|receipt|demat/, 'financial'],
  [/warranty|guarantee|bill of sale/, 'warranty'],
  [/agreement|contract|\bwill\b|affidavit|notice|power of attorney/, 'legal'],
];

export function guessCategory(fileName) {
  const name = String(fileName ?? '').toLowerCase();
  for (const [pattern, category] of RULES) {
    if (pattern.test(name)) return category;
  }
  return 'other';
}

/** Which folder an attachment on another kind of record belongs in. */
export function categoryForEntity(entityName) {
  return {
    vehicle: 'vehicle', vehicleService: 'vehicle', fuelLog: 'vehicle',
    policy: 'insurance',
    property: 'property',
    healthRecord: 'health', vaccination: 'health', medication: 'health',
    education: 'education', certificate: 'education',
    identityDocument: 'identity', person: 'identity',
    employment: 'employment',
    loan: 'financial', account: 'financial', transaction: 'financial', holding: 'financial',
  }[entityName] ?? 'other';
}

/* ----------------------------------------------------------------- folders */

/**
 * Where a document lives in Drive: one folder per person, categories inside.
 *
 *   FamilyOS/Documents/Asha Narayan/Identity/passport.pdf
 *   FamilyOS/Documents/Household/Property/sale-deed.pdf
 *
 * Per person rather than per category because that is how a family actually
 * looks for paperwork — "Asha's documents", not "all the identity documents
 * belonging to any of the six of us". It also means one person's folder can be
 * shared with them, or handed over, without unpicking everything else.
 *
 * Anything not about one individual — the property deed, the family floater —
 * goes to `Household`, which is a real answer rather than a null.
 */
export const HOUSEHOLD_FOLDER = 'Household';

/**
 * A person's folder name. Their own name, because a folder called `prs_01J8…`
 * defeats the point of the tree being readable without this application.
 * Two people with the same name are disambiguated rather than merged.
 */
export function personFolderName(person, allPeople = []) {
  if (!person?.name) return HOUSEHOLD_FOLDER;

  const clean = String(person.name).replace(/[/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return HOUSEHOLD_FOLDER;

  const sameName = allPeople.filter(
    (other) => String(other.name).trim().toLowerCase() === clean.toLowerCase(),
  );
  if (sameName.length <= 1) return clean;

  // Stable: the older record keeps the plain name, so adding a second
  // "Ravi Kumar" does not rename the first one's folder out from under them.
  const ordered = [...sameName].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const position = ordered.findIndex((other) => other.id === person.id);
  return position <= 0 ? clean : `${clean} (${position + 1})`;
}

/** The full path a document belongs at, as folder segments. */
export function documentPath(person, category, allPeople = []) {
  return [personFolderName(person, allPeople), categoryFolderName(category)];
}

/** Drive's folder for a category, in the casing the tree uses. */
export function categoryFolderName(category) {
  const wanted = String(category ?? 'other').toLowerCase();
  const match = CATEGORIES.find((name) => name.toLowerCase() === wanted);
  return title(match ?? 'other');
}

function title(value) {
  return String(value).charAt(0).toUpperCase() + String(value).slice(1);
}

/** Free-text match over the fields a document is actually remembered by. */
export function matches(document, text) {
  if (!text) return true;
  const haystack = [
    document.title, document.category, document.fileName,
    document.ocrText, (document.tags ?? []).join(' '), document.notes,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(String(text).toLowerCase());
}

export function iconForMime(mimeType) {
  const type = String(mimeType ?? '');
  if (type.startsWith('image/')) return 'eye';
  if (type === 'application/pdf') return 'file';
  if (/sheet|excel|csv/.test(type)) return 'report';
  return 'file';
}

export function formatSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/* -------------------------------------------------- reading what is inside */

/**
 * Whether a document's text can be read without OCR.
 *
 * A PDF made by a computer — a statement, a policy, a bill — carries its text
 * as text, and that can be lifted out exactly. A *scanned* PDF carries pictures
 * of text and cannot, which is a different problem and still an unsolved one
 * here. Both arrive as `application/pdf`, so this says what is worth trying,
 * not what will succeed.
 */
export function canReadText(mimeType) {
  return String(mimeType ?? '') === 'application/pdf';
}

/**
 * A document's text, trimmed to something worth storing.
 *
 * The cap is not arbitrary. This text lands in `ocrText`, which is searchable,
 * which means it is also a column in the household's Google Sheet — and a
 * Sheets cell holds fifty thousand characters. A two-hundred-page policy would
 * exceed that and break the sync for the whole row, so it is cut here, where
 * the reason is visible, rather than at the boundary where the failure would be
 * a rejected write nobody could explain.
 *
 * Twenty thousand characters is roughly eight pages of prose: enough to hold
 * the policy number, the account number and the names, which is what anybody is
 * actually searching a document for.
 *
 * @param {Array<{lines: string[]}>} pages from the PDF reader
 * @param {{limit?: number}} [options]
 */
export function indexableText(pages, { limit = 20_000 } = {}) {
  const text = (pages ?? [])
    .flatMap((page) => page?.lines ?? [])
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= limit) return text;

  // Cut at a word boundary, so the tail is not half an account number — which
  // would match nothing and read like corruption.
  const cut = text.slice(0, limit);
  const boundary = cut.lastIndexOf(' ');
  return (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
}

/** Every category the schema allows, so a caller never invents one. */
export { CATEGORIES };
