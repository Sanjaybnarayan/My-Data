/**
 * Reading one value out of a run of text.
 *
 * Split out of `extract.js` when `tools/module-size.mjs` refused to let that
 * file grow — its instruction is "move code out rather than raising the
 * number", and this is the seam it pointed at. What lives here reads a
 * **scalar**: a date, an amount, the value beside a label. What stays there
 * reads a **document**: what kind it is, which of these to ask for, and what
 * to suggest onto a record.
 *
 * Every rule these carry is stated where it is enforced:
 *
 * - `03/04/2025` is the third of April. Indian documents are day-first.
 * - A number inside a date is not an amount.
 * - A labelled value whose two readings disagree is not a value.
 *
 * Nothing here infers from a number's shape alone. A field that cannot be
 * found is absent rather than guessed.
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

/**
 * Date-shaped runs, so a labelled amount cannot be answered with a day.
 *
 * `readAmount` takes the first number within forty characters of its label,
 * and on a policy reading *"Premium due on 04/03/2027. Premium Rs. 12,500"* it
 * returned **₹4.00** — the day of the month. Not a near miss: the document
 * says twelve and a half thousand, and the reader wrote four rupees onto the
 * record, confidently, from a label that was genuinely there.
 *
 * Masked rather than skipped, and with spaces of the same length. Collapsing
 * the date would shorten the gap and let a label reach *further* into the next
 * sentence than the forty characters it is allowed.
 *
 * Only here. `readDate` reads the same text and needs these.
 */
const DATE_SHAPES = [
  // 04/03/2027, 04-03-2027, 2027-03-04
  /\b\d{1,4}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
  // 18 Oct 2026, 18-Oct-26
  /\b\d{1,2}[\s./-]{0,2}(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s./,-]{0,2}\d{2,4}\b/gi,
];

function withoutDates(text) {
  let out = String(text ?? '');
  for (const shape of DATE_SHAPES) {
    out = out.replace(shape, (found) => ' '.repeat(found.length));
  }
  return out;
}

/**
 * The amount following a label, in minor units, or null.
 *
 * A field that cannot be found is absent rather than guessed — this file's own
 * rule, and the reason the dates come out first. A premium whose only nearby
 * number is a due date reads as *no premium*, which is true, rather than as
 * four rupees, which is not.
 */
export function readAmount(text, labels) {
  const searchable = withoutDates(text);
  for (const label of labels) {
    const pattern = new RegExp(
      `${label}[^0-9₹]{0,40}(?:₹|Rs\\.?|INR)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)`,
      'i',
    );
    const match = pattern.exec(searchable);
    if (match) return toMinor(match[1].replace(/,/g, ''));
  }
  return null;
}

/** The value following a label, up to the end of its line. */
export function readField(text, labels, { pattern = '[A-Za-z0-9/\\-]{3,40}' } = {}) {
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
export function readEitherSide(text, labels, { pattern = '[A-Za-z0-9/\\-]{3,40}' } = {}) {
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
export function readLabelledDate(text, labels) {
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
