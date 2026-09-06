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
/** @type {[RegExp, string][]} */
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

/**
 * What a person calls a file: its name without the extension.
 *
 * Written out at three call sites — `\.[^.]+$` stripped by hand in
 * `modules/documents.js` twice and in `services/intake.js` — while a fourth,
 * `modules/reports.js`, passed the whole file name through. So a generated rent
 * receipt was filed as **"Rent receipt 2026-09.docx"** and everything a
 * household uploaded was filed without its extension, in the same list.
 *
 * `sync/drive.js` had a fifth behaviour: its fallback for a caller that passes
 * no title at all keeps the extension too.
 *
 * Four copies of a rule and one exception is the shape this repository keeps
 * finding. One definition, used by all of them.
 *
 * The extension is matched without path separators in it, so a name with a dot
 * in a folder and none in the file — `2026.tax/receipt` — is left alone rather
 * than losing half of itself.
 *
 * @param {string} [name]
 * @param {string} [fallback] for a name that is all extension, or nothing
 */
export function titleFromFileName(name, fallback = 'Document') {
  const bare = String(name ?? '').replace(/\.[^./\\]+$/, '').trim();
  return bare || fallback;
}

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
 * How a document's text is read, or that it cannot be.
 *
 * ## What this used to say
 *
 * `application/pdf`, and nothing else. Meanwhile the file picker on the
 * Documents screen offers `image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt`
 * — so the screen invited five kinds of file it would then refuse to look
 * inside, and a `.txt` was treated exactly like a photograph.
 *
 * The `.docx` case was the sharpest: `domain/docxtemplate.js` has unzipped
 * Word files and lifted their text runs since Phase 3, for report templates.
 * The machinery was in the repository, exported, tested, and used — and a
 * household uploading a Word bill got nothing read out of it.
 *
 * ## Pictures of text are their own answer
 *
 * A **scanned** PDF and any **image** carry pictures of text, which is why
 * `READER.IMAGE` exists rather than folding them into `NONE`. Reading one
 * means *recognising* it — a different capability from parsing a file, and one
 * not present in every build.
 *
 * This paragraph used to say there was no OCR engine here and that adding one
 * meant either a dependency that could not be verified offline or a network
 * call the CSP forbids. `js/core/ocr.js` and `OcrPlugin` are that engine: ML
 * Kit's Latin recogniser, bundled into the APK, with `PdfRenderer` for a scan.
 * In a browser there is still no recogniser and an image still waits for
 * Drive, which `identifiers.js#textState` says on the screen — in different
 * words depending on which build a household is holding.
 *
 * ## Why the file name matters
 *
 * A file arriving through Android's share sheet frequently carries
 * `application/octet-stream` or nothing at all, because the sending app never
 * set one. Judging only by the declared type would refuse to read a `.docx`
 * shared from Gmail while reading the identical file picked from storage.
 */
export const READER = Object.freeze({
  PDF: 'pdf',
  OOXML: 'ooxml',
  PLAIN: 'plain',
  /**
   * Pictures of text. Nothing can be lifted out of these without recognising
   * them, which is a different capability from parsing a file and is not
   * present in every build — `core/ocr.js` answers whether it is.
   */
  IMAGE: 'image',
  NONE: 'none',
});

/** Extension to reader, for the files whose type does not survive a share. */
const BY_EXTENSION = Object.freeze({
  pdf: READER.PDF,
  docx: READER.OOXML,
  xlsx: READER.OOXML,
  txt: READER.PLAIN,
  csv: READER.PLAIN,
  md: READER.PLAIN,
  json: READER.PLAIN,
});

/** Declared type to reader, for the files whose type does. */
const BY_MIME = Object.freeze({
  'application/pdf': READER.PDF,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': READER.OOXML,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': READER.OOXML,
  'text/plain': READER.PLAIN,
  'text/csv': READER.PLAIN,
  'text/markdown': READER.PLAIN,
  'application/json': READER.PLAIN,
});

/**
 * Which reader a file needs, from its declared type and its name.
 *
 * The declared type wins where it says something. `.doc` and `.xls` — the old
 * binary formats — are deliberately absent: they are not zip archives and
 * nothing here can open them, and claiming otherwise would file a document as
 * read with nothing in it.
 *
 * @param {string} [mimeType]
 * @param {string} [fileName]
 */
export function readerFor(mimeType, fileName = '') {
  const declared = String(mimeType ?? '').toLowerCase().split(';')[0].trim();
  if (Object.prototype.hasOwnProperty.call(BY_MIME, declared)) return BY_MIME[declared];

  // An image says what it is and is never a zip; deciding by extension after
  // that would let `photo.txt` through.
  if (declared.startsWith('image/')) return READER.IMAGE;

  const extension = String(fileName ?? '').toLowerCase().split('.').pop() ?? '';
  if (Object.prototype.hasOwnProperty.call(BY_EXTENSION, extension)) return BY_EXTENSION[extension];

  return READER.NONE;
}

/**
 * Whether a document's text can be lifted out **without recognising it**.
 *
 * Deliberately still false for an image. A PDF carries its text as text and
 * that is exact; a photograph carries pixels, and reading those is a guess
 * made by a model — a good one, and still a different kind of answer. Keeping
 * the two apart is what lets a screen say which it is looking at.
 */
export function canReadText(mimeType, fileName = '') {
  const reader = readerFor(mimeType, fileName);
  return reader !== READER.NONE && reader !== READER.IMAGE;
}

/**
 * Whether anything on this device might get text out of a file at all.
 *
 * The wider question, and the one the read paths ask before they bother
 * decrypting a blob. True for an image — whether recognition is actually
 * *available* is a fact about the build rather than about the file, so it is
 * answered where that is known and not guessed at here.
 */
export function mayRead(mimeType, fileName = '') {
  return readerFor(mimeType, fileName) !== READER.NONE;
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
