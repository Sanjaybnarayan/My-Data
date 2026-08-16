/**
 * Reading a `.docx`, and filling it in — Phase 3's actual deliverable.
 *
 * ## What was already here, and what was not
 *
 * `reports/docx.js` **writes** a document. Nothing has ever **read** one, which
 * is the whole of what the prompt asks for: *"user uploads a DOCX template;
 * system reads DOCX, detects editable fields, creates template, displays
 * fields, allows editing, generates new DOCX, preserves original"*.
 *
 * Both halves it needs already existed: `reports/xlsx.js` has `zip`, and
 * `data/pdf-read.js` has `inflate` — written for a PDF's compressed streams and
 * exactly what a `.docx` entry needs, since both are DEFLATE. So this costs no
 * dependency, the same way the DOCX writer did.
 *
 * ## The problem that makes a naive version silently wrong
 *
 * Word does not store `{{Name}}` as a single piece of text. It stores *runs*,
 * and it splits them wherever formatting, spell-check state or an editing
 * session happened to change:
 *
 *     <w:r><w:t>{{Na</w:t></w:r><w:r><w:t>me}}</w:t></w:r>
 *
 * That is the *same placeholder*, and it is extremely common — a template that
 * has been edited by a person almost always has some. A reader that searches
 * each `<w:t>` on its own finds **none of them**, reports "no fields", and looks
 * like it worked.
 *
 * So the text is joined across runs before anything looks for a placeholder,
 * and a filled value is written back into the **first** run of the group with
 * the remainder emptied — which preserves the formatting of the run the
 * placeholder started in, and never leaves half a placeholder behind.
 *
 * ## What it refuses
 *
 * **The original is never modified.** The prompt says so twice and this returns
 * new bytes, leaving the input untouched — the same rule the document store
 * already follows.
 *
 * **An unknown field is left alone, not blanked.** A template naming a field
 * the household did not fill keeps its placeholder, visibly, rather than
 * producing a document with a silent hole where a name should be.
 */

import { zip } from '../reports/xlsx.js';

/** `{{ Anything }}`, tolerant of spacing. */
const FIELD = /\{\{\s*([^{}]+?)\s*\}\}/g;

/* ------------------------------------------------------------------ zip */

const u16 = (bytes, at) => bytes[at] | (bytes[at + 1] << 8);
const u32 = (bytes, at) => (
  bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)
) + (bytes[at + 3] * 0x1000000);

/**
 * The entries in a zip, read from the central directory.
 *
 * From the end backwards, which is how a zip is meant to be read: the central
 * directory is authoritative and the local headers are a copy that can disagree
 * after an edit.
 */
export function entriesIn(bytes) {
  if (!bytes || bytes.length < 22) return [];

  // End-of-central-directory, searched backwards for its signature.
  let end = -1;
  for (let at = bytes.length - 22; at >= 0 && at > bytes.length - 66_000; at--) {
    if (u32(bytes, at) === 0x06054b50) { end = at; break; }
  }
  if (end < 0) return [];

  const count = u16(bytes, end + 10);
  let at = u32(bytes, end + 16);
  const out = [];

  for (let i = 0; i < count && at + 46 <= bytes.length; i++) {
    if (u32(bytes, at) !== 0x02014b50) break;
    const method = u16(bytes, at + 10);
    const compressedSize = u32(bytes, at + 20);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localAt = u32(bytes, at + 42);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));

    // The local header's own name and extra lengths, which need not match the
    // central directory's — reading them from the wrong one is the classic way
    // a zip reader lands a few bytes into the data.
    const localNameLength = u16(bytes, localAt + 26);
    const localExtraLength = u16(bytes, localAt + 28);
    const from = localAt + 30 + localNameLength + localExtraLength;

    out.push({ name, method, data: bytes.subarray(from, from + compressedSize) });
    at += 46 + nameLength + extraLength + commentLength;
  }

  return out;
}

/**
 * Every entry's bytes, decompressed.
 *
 * @param {Uint8Array} bytes
 * @param {(raw: Uint8Array) => Promise<Uint8Array|null>} inflate
 *   Injected rather than imported: `data/pdf-read.js` owns the browser's
 *   decompression and this file should not decide where that comes from.
 */
export async function unzip(bytes, inflate) {
  /** @type {Record<string, Uint8Array>} */
  const out = {};
  for (const entry of entriesIn(bytes)) {
    if (entry.method === 0) {
      out[entry.name] = entry.data;
      continue;
    }
    const inflated = await inflate(entry.data);
    // A part that will not decompress is left out rather than stored as
    // rubbish. `readTemplate` says which parts it could not read.
    if (inflated) out[entry.name] = inflated;
  }
  return out;
}

/* ------------------------------------------------- runs, and their splits */

/** Every `<w:t>` in document order, with where it sits. */
export function textRuns(xml) {
  const out = [];
  const pattern = /<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let found = pattern.exec(xml);
  while (found) {
    out.push({
      at: found.index,
      length: found[0].length,
      attributes: found[1] ?? '',
      text: found[2],
      whole: found[0],
    });
    found = pattern.exec(xml);
  }
  return out;
}

/* --------------------------------------------- what Word's own UI produces */

/**
 * A `{{placeholder}}` is what a person types. It is not what Word's field UI
 * writes, and a template built the way Word documents it carries none.
 *
 * Three shapes, all measured against this file before any of this was written,
 * and all three reported **no fields at all** — honestly, and uselessly:
 *
 *   - `<w:fldSimple w:instr=" MERGEFIELD Tenant ">` — one element.
 *   - The same field in its **complex** form: a run holding a `begin`
 *     `fldChar`, a run holding the `instrText`, a `separate`, the text Word
 *     shows, and an `end`. Five runs for one field.
 *   - A **content control** — `<w:sdt>` — with a `w:tag` naming it and a
 *     `w:sdtContent` holding whatever the author left in the box.
 *
 * ## What filling one produces
 *
 * **Static text.** A filled field is replaced by an ordinary run, so the field
 * is gone from the output and will not re-merge against anything. That is what
 * generating a document means here: the template is untouched — this returns
 * new bytes — and the thing produced is a document rather than another
 * template. A `<w:sdt>` that kept its control would be a document Word offers
 * to edit as a form, which is a different artefact from the one asked for.
 *
 * ## The one structural assumption
 *
 * A complex field's `begin` and `end` `fldChar` elements each sit as the first
 * child of their own run. That is what Word writes, and what every template
 * this has been tested against carries. A field nested some other way is not
 * matched — so it keeps its placeholder and is visible, rather than being
 * half-replaced.
 */
const MERGEFIELD = /MERGEFIELD\s+"?([^"\\\s]+)"?/i;

/** `<w:fldSimple w:instr="…">…</w:fldSimple>`, one element per field. */
function simpleFieldSpans(xml) {
  const out = [];
  const pattern = /<w:fldSimple\b[^>]*w:instr="([^"]*)"[^>]*>[\s\S]*?<\/w:fldSimple>/g;
  let found = pattern.exec(xml);
  while (found) {
    const name = MERGEFIELD.exec(found[1])?.[1];
    if (name) out.push({ from: found.index, to: found.index + found[0].length, name });
    found = pattern.exec(xml);
  }
  return out;
}

/** The five-run form: begin, instruction, separate, shown text, end. */
function complexFieldSpans(xml) {
  const out = [];
  const pattern = /<w:r\b[^>]*>\s*<w:fldChar\b[^>]*fldCharType="begin"[\s\S]*?fldCharType="end"[^>]*\/>\s*<\/w:r>/g;
  let found = pattern.exec(xml);
  while (found) {
    const instruction = /<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/.exec(found[0]);
    const name = instruction ? MERGEFIELD.exec(instruction[1])?.[1] : null;
    if (name) out.push({ from: found.index, to: found.index + found[0].length, name });
    found = pattern.exec(xml);
  }
  return out;
}

/**
 * A content control, named by its tag.
 *
 * `w:tag` is the machine name and `w:alias` is what the author sees in Word.
 * The tag is preferred and the alias is the fallback, because a template whose
 * controls carry only an alias is still a template somebody built on purpose.
 */
function contentControlSpans(xml) {
  const out = [];
  const pattern = /<w:sdt\b[^>]*>[\s\S]*?<\/w:sdt>/g;
  let found = pattern.exec(xml);
  while (found) {
    const tag = /<w:tag\b[^>]*w:val="([^"]*)"/.exec(found[0])?.[1];
    const alias = /<w:alias\b[^>]*w:val="([^"]*)"/.exec(found[0])?.[1];
    const name = tag || alias;
    if (name) out.push({ from: found.index, to: found.index + found[0].length, name });
    found = pattern.exec(xml);
  }
  return out;
}

/** Every field Word's own UI can produce, in document order. */
export function wordFieldSpans(xml) {
  const text = String(xml ?? '');
  return [
    ...simpleFieldSpans(text),
    ...complexFieldSpans(text),
    ...contentControlSpans(text),
  ].sort((a, b) => a.from - b.from);
}

/**
 * The placeholders in a document, however Word split them.
 *
 * The runs are joined first — see the note at the top. Searching each run alone
 * finds nothing in a template a person has edited, and reports it as a template
 * with no fields.
 */
export function fieldsIn(xml) {
  const text = String(xml ?? '');
  const names = [];

  // Word's own fields first, in document order, because a template that has
  // both is a template somebody edited by hand on top of one Word built.
  for (const span of wordFieldSpans(text)) {
    if (!names.includes(span.name)) names.push(span.name);
  }

  const runs = textRuns(text);
  const joined = runs.map((run) => run.text).join('');

  FIELD.lastIndex = 0;
  let found = FIELD.exec(joined);
  while (found) {
    if (!names.includes(found[1])) names.push(found[1]);
    found = FIELD.exec(joined);
  }

  return names;
}

/**
 * Fill the placeholders, writing each value into the run its field began in.
 *
 * The remainder of a split placeholder is emptied rather than left, because
 * half a placeholder in a finished document is worse than an unfilled one — it
 * looks like corruption rather than an omission.
 */
export function fill(xml, values = {}) {
  // Word's fields are replaced whole, before anything looks at runs — a
  // complex field *is* five runs, and joining their text would produce a
  // string containing the field's own instruction.
  //
  // Back to front, so an earlier span's offsets stay valid.
  let source = String(xml ?? '');
  for (const span of wordFieldSpans(source).reverse()) {
    // An unknown field keeps its placeholder, as `{{fields}}` do: a household
    // reading the document can see which one was not filled.
    if (!Object.prototype.hasOwnProperty.call(values, span.name)) continue;
    const value = escapeXml(String(values[span.name] ?? ''));
    source = source.slice(0, span.from)
      + `<w:r><w:t xml:space="preserve">${value}</w:t></w:r>`
      + source.slice(span.to);
  }

  const runs = textRuns(source);
  if (!runs.length) return source;

  const joined = runs.map((run) => run.text).join('');

  // Where each run's text begins within the joined string, so a match found in
  // the join can be mapped back to the runs it spans.
  const starts = [];
  let cursor = 0;
  for (const run of runs) { starts.push(cursor); cursor += run.text.length; }

  const replacements = runs.map((run) => run.text);

  FIELD.lastIndex = 0;
  let found = FIELD.exec(joined);
  while (found) {
    const name = found[1];
    const from = found.index;
    const to = found.index + found[0].length;

    // An unknown field is left exactly as it is. A household reading the
    // document can see which one was not filled.
    if (Object.prototype.hasOwnProperty.call(values, name)) {
      const value = escapeXml(String(values[name] ?? ''));
      let written = false;

      for (let i = 0; i < runs.length; i++) {
        const runFrom = starts[i];
        const runTo = runFrom + runs[i].text.length;
        if (runTo <= from || runFrom >= to) continue;

        const before = runs[i].text.slice(0, Math.max(0, from - runFrom));
        const after = runs[i].text.slice(Math.max(0, to - runFrom));
        replacements[i] = written
          ? before + after
          : before + value + after;
        written = true;
      }
    }

    found = FIELD.exec(joined);
  }

  // Rebuilt from the back so earlier offsets stay valid.
  let out = source;
  for (let i = runs.length - 1; i >= 0; i--) {
    if (replacements[i] === runs[i].text) continue;
    const rebuilt = `<w:t${runs[i].attributes || ' xml:space="preserve"'}>`
      + `${replacements[i]}</w:t>`;
    out = out.slice(0, runs[i].at) + rebuilt + out.slice(runs[i].at + runs[i].length);
  }

  return out;
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* -------------------------------------------------------------- template */

const DOCUMENT = 'word/document.xml';

/**
 * A template, read from an uploaded `.docx`.
 *
 * @returns {Promise<{fields: string[], parts: object, why: string|null}>}
 */
export async function readTemplate(bytes, inflate) {
  const parts = await unzip(bytes, inflate);

  if (!parts[DOCUMENT]) {
    return {
      fields: [],
      parts,
      why: 'this file does not contain a Word document part, so it is either not '
        + 'a .docx or it is one this reader could not decompress',
    };
  }

  const xml = new TextDecoder().decode(parts[DOCUMENT]);
  const fields = fieldsIn(xml);

  return {
    fields,
    parts,
    why: fields.length ? null
      : 'no {{fields}} were found in this document. A template needs its editable '
        + 'places marked, and nothing here guesses which words those are',
  };
}

/**
 * A new document, from a template and the values for its fields.
 *
 * Every other part is carried across untouched — styles, numbering, images,
 * relationships. The original bytes are not modified; these are new ones.
 */
export function generate(parts, values = {}) {
  const xml = new TextDecoder().decode(parts[DOCUMENT]);
  const filled = fill(xml, values);

  const files = Object.entries(parts).map(([name, data]) => ({
    name,
    data: name === DOCUMENT ? new TextEncoder().encode(filled) : data,
  }));

  // `[Content_Types].xml` first, as the DOCX writer already knows: Word reads
  // it before anything else and refuses a package where it is not there.
  files.sort((a, b) => (a.name === '[Content_Types].xml' ? -1
    : b.name === '[Content_Types].xml' ? 1 : 0));

  return zip(files);
}

/** A filename that says which template and when, so versions do not collide. */
export function generatedName(templateName, at = new Date()) {
  const base = String(templateName ?? 'document')
    .replace(/\.docx$/i, '').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();
  return `${base}-${at.toISOString().slice(0, 10)}.docx`;
}
