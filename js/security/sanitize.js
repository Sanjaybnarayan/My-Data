/**
 * Output safety.
 *
 * The main defence against injection in FamilyOS is structural: `ui/dom.js`
 * never assigns `innerHTML`, so a stored string cannot become markup. This
 * file covers the three places where that guarantee does not reach.
 *
 * 1. **Links.** A stored `javascript:` URL is a click away from running.
 *    `safeUrl` is wired, in `js/modules/crud.js`.
 * 2. **CSV export.** `escapeCsv`, wired in `js/reports/csv.js`.
 * 3. **File names.** `safeFileName`, wired in `js/sync/drive.js` and
 *    `js/reports/build.js`.
 *
 * ## What is here and is *not* wired, said plainly
 *
 * This header used to list rich text and spreadsheet cells as things "this
 * file covers". Neither was true, and a security file describing a defence
 * that does not run is worse than one that admits a gap.
 *
 *   - `sanitizeHtml` and `stripTags` have **no caller**. Nothing renders
 *     stored HTML: `richtext` is edited in a plain `<textarea>` and drawn as a
 *     text node, and `tools/lint.mjs` refuses any assignment to `innerHTML` in
 *     what ships, which `tests/modules.test.mjs` proves fires. That structural
 *     rule is the real defence and it is stronger than sanitising. These stay
 *     for the day something does render markup — unwired, and now labelled.
 *
 *     They are also not interchangeable, which is how the no-DOM branch of
 *     `sanitizeHtml` came to return live markup: `stripTags` **decodes**
 *     entities on the way out, so `&lt;script&gt;` became `<script>`. That is
 *     right for extraction and wrong for a sanitiser, and it is the reason
 *     `escapeHtml` exists below.
 *   - `escapeForSheet` and `unescapeFromSheet` have **no caller either**. The
 *     formula-injection defence that actually runs is `defuse()` in
 *     `apps-script/Sheets.gs`, on the server, whose own comment used to call
 *     itself "the second line" of a defence whose first line was never built.
 *     It is the only line, and `tests/backend.test.mjs` now tests it through
 *     the deployed `.gs` rather than through these functions.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'DIV', 'SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'CODE', 'PRE',
  'BLOCKQUOTE', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'H4', 'A', 'HR', 'TABLE',
  'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'MARK', 'SUB', 'SUP',
]);

const ALLOWED_ATTRS = {
  A: new Set(['href', 'title']),
  TD: new Set(['colspan', 'rowspan']),
  TH: new Set(['colspan', 'rowspan']),
};

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

export function safeUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text, 'https://familyos.invalid');
    return SAFE_PROTOCOLS.has(url.protocol) ? text : '';
  } catch {
    return '';
  }
}

/**
 * Rebuild HTML from an allow-list of tags and attributes.
 *
 * Rebuilt, not filtered: the parser produces a tree, and only nodes that pass
 * are copied into a fresh one. A blocklist would have to anticipate every
 * evasion; an allow-list only has to know what notes are permitted to contain.
 */
export function sanitizeHtml(html, doc = globalThis.document) {
  // Without a DOM there is no parser, so there is no way to do the job this
  // function's name promises. It used to fall back to `stripTags`, which is a
  // *text extractor*: it removes tags and then decodes entities, so
  // `&lt;script&gt;` came back out as `<script>` — live markup, returned by a
  // sanitiser, in the one context where nothing had parsed it. `stripTags` is
  // right for what it is for; this was the wrong caller for it. Escaped
  // instead, because every return of this function has to be safe to treat as
  // HTML or the name is a lie.
  if (!doc) return escapeHtml(html);

  const parsed = new DOMParser().parseFromString(String(html ?? ''), 'text/html');
  const out = doc.createDocumentFragment();
  for (const node of parsed.body.childNodes) {
    const clean = cleanNode(node, doc);
    if (clean) out.append(clean);
  }
  const holder = doc.createElement('div');
  holder.append(out);
  return holder.innerHTML;
}

function cleanNode(node, doc) {
  if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  if (!ALLOWED_TAGS.has(node.tagName)) {
    // Keep the words, drop the tag: a pasted <font> should not lose its text.
    const fragment = doc.createDocumentFragment();
    for (const child of node.childNodes) {
      const clean = cleanNode(child, doc);
      if (clean) fragment.append(clean);
    }
    return fragment.childNodes.length ? fragment : null;
  }

  const el = doc.createElement(node.tagName.toLowerCase());
  const allowed = ALLOWED_ATTRS[node.tagName];
  if (allowed) {
    for (const attr of node.attributes) {
      if (!allowed.has(attr.name.toLowerCase())) continue;
      if (attr.name.toLowerCase() === 'href') {
        const href = safeUrl(attr.value);
        if (!href) continue;
        el.setAttribute('href', href);
        el.setAttribute('rel', 'noopener noreferrer');
        el.setAttribute('target', '_blank');
      } else {
        el.setAttribute(attr.name, attr.value);
      }
    }
  }
  for (const child of node.childNodes) {
    const clean = cleanNode(child, doc);
    if (clean) el.append(clean);
  }
  return el;
}

/** The five characters that turn text into markup. */
export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Readable text out of markup, for reports — **not** a sanitiser.
 *
 * It decodes entities on the way out, which is right when the result is
 * destined for a PDF or a spreadsheet cell and wrong every other way: the
 * output can contain `<` and `>` and is not safe to treat as HTML. Named and
 * documented as extraction so nothing reaches for it as a defence again.
 */
export function stripTags(html) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Defuse a value bound for a spreadsheet cell.
 *
 * A leading apostrophe tells Sheets "this is text". Applied on the way out and
 * stripped on the way back in, so a round trip is lossless.
 */
export function escapeForSheet(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

export function unescapeFromSheet(value) {
  if (typeof value !== 'string') return value;
  return /^'[=+\-@\t\r]/.test(value) ? value.slice(1) : value;
}

/** Escape for a CSV field, including the same formula guard. */
export function escapeCsv(value) {
  const text = escapeForSheet(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Escape for XML/HTML text content, for the report writers. */
export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Trim a filename to something every filesystem and Drive will accept.
 * Path separators and control characters removed, not replaced with lookalikes
 * that would collide.
 */
export function safeFileName(name, fallback = 'file') {
  const cleaned = String(name ?? '')
    // eslint-disable-next-line no-control-regex -- control characters are the point
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}
