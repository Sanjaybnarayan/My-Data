/**
 * Extract positioned text from a PDF.
 *
 * FamilyOS already writes PDFs without a library; reading one is the same
 * problem backwards, and it is what makes "import a bank statement" possible
 * without uploading a family's finances to a conversion service. That
 * constraint is the whole reason this exists rather than a dependency.
 *
 * ## What it does
 *
 * Objects are found by scanning rather than by walking the cross-reference
 * table, because a statement produced by a bank's reporting tool frequently
 * has a broken or incremental xref and every reader recovers the same way.
 * Compressed object streams are expanded, because that is where a modern
 * writer puts the page tree and the fonts — without it the text comes out as
 * plausible-looking gibberish, which is worse than failing.
 *
 * Content streams are inflated, then the text operators are interpreted with
 * enough of the graphics state to know where each run landed:
 *
 *   Tm / Td / TD / T*   move the text cursor
 *   Tj / TJ / ' / "     draw a run
 *   Tf                  select a font, which decides how bytes become text
 *
 * Rows are reassembled from the Y coordinate, because a table in a PDF is not
 * a table — it is a few hundred independent runs that happen to line up.
 *
 * Finding the fonts is most of the work of `Tf`, and a page can hide them in
 * several places: written into the page, referred to by object number, or
 * both at once with the font dictionary itself inline. All of those are
 * followed, because the difference between them is the difference between a
 * scanned bill and 2,718 characters of mojibake — see
 * `docs/DOCUMENT_FORMATS.md`.
 *
 * ## What it does not do
 *
 * No shaping, no ligature resolution, no right-to-left. Encrypted PDFs are
 * refused rather than half-read. A font with a custom encoding and no
 * ToUnicode map produces the raw bytes, and the caller can see that it did.
 */

/*
 * ## Why inflation is a separate pass
 *
 * A browser can only decompress asynchronously, through `DecompressionStream`.
 * Threading `await` down into a character-level scanner would make every layer
 * async for one leaf call, so instead every compressed stream is inflated up
 * front — `scan` finds them, `inflateAll` decompresses them, and `build` walks
 * the result synchronously. That also lets the same code run under Node with
 * zlib, which is what the command-line tool and the tests use.
 */

/** PDF byte strings are latin-1: every byte is one character, and stays one. */
function latin1(bytes) {
  let out = '';
  // Chunked because `String.fromCharCode(...millionBytes)` overflows the stack.
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return out;
}

/* --------------------------------------------------------------- objects */

/** Every `N G obj … endobj` in the file, by object number. */
function findObjects(bytes) {
  const text = latin1(bytes);
  const objects = new Map();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let match;

  while ((match = re.exec(text))) {
    const number = Number(match[1]);
    const start = match.index + match[0].length;
    const end = text.indexOf('endobj', start);
    if (end < 0) continue;
    // A later generation of the same object wins, which is how an
    // incrementally-updated PDF is meant to be read.
    objects.set(number, { start, end, body: text.slice(start, end) });
  }
  return { objects, text };
}

/** Where a stream object's bytes live, and whether they are compressed. */
function locate(text, object) {
  const marker = text.indexOf('stream', object.start);
  if (marker < 0 || marker > object.end) return null;

  // `stream` is followed by CRLF or LF, and the data begins after it.
  let from = marker + 'stream'.length;
  if (text[from] === '\r') from++;
  if (text[from] === '\n') from++;

  const dict = text.slice(object.start, marker);
  const lengthMatch = /\/Length\s+(\d+)/.exec(dict);
  let to = lengthMatch ? from + Number(lengthMatch[1]) : text.indexOf('endstream', from);

  // An indirect /Length, or a wrong one, is common in generated files; fall
  // back to the marker, which is always right.
  const endstream = text.indexOf('endstream', from);
  if (!lengthMatch || to > endstream || to < from) to = endstream;
  if (to < from) return null;

  return { from, to, flate: /\/FlateDecode/.test(dict) };
}

/**
 * Expand `/Type /ObjStm` containers into the object map.
 *
 * A PDF 1.5 writer packs most non-stream objects into one compressed stream
 * with a header of `objectNumber offset` pairs. A reader that only scans for
 * `N 0 obj` finds the pages and the fonts missing, decodes the text with no
 * encoding, and produces something that looks like text and is not.
 */
function expandObjectStreams(objects, streams) {
  for (const [number, object] of [...objects]) {
    if (!/\/Type\s*\/ObjStm/.test(object.body)) continue;

    const data = streams.get(number);
    if (!data) continue;

    const inner = latin1(data);
    const count = Number(/\/N\s+(\d+)/.exec(object.body)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(object.body)?.[1] ?? 0);
    if (!count || !first) continue;

    const header = inner.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i++) {
      const number = header[i * 2];
      const offset = header[i * 2 + 1];
      const nextOffset = i + 1 < count ? header[i * 2 + 3] : inner.length - first;
      if (!Number.isFinite(number) || !Number.isFinite(offset)) continue;
      // A packed object is never a stream, so it has no data of its own —
      // only a dictionary, which is all the page tree and the fonts need.
      objects.set(number, {
        start: -1,
        end: -1,
        body: inner.slice(first + offset, first + nextOffset),
        packed: true,
      });
    }
  }
  return objects;
}

/* ----------------------------------------------------------- ToUnicode */

/**
 * A font's ToUnicode CMap: which character code maps to which text.
 * Subset fonts renumber their glyphs, so without this a statement comes out
 * as plausible-looking gibberish rather than as obviously broken.
 */
function parseToUnicode(cmap) {
  const map = new Map();
  const text = latin1(cmap);

  // `<0000> <FFFF>` in the codespace range means codes are two bytes wide.
  // Everything downstream has to read them in pairs.
  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  const width = codespace ? (/<([0-9A-Fa-f]+)>/.exec(codespace[1])?.[1].length ?? 2) / 2 : 1;

  const single = /beginbfchar([\s\S]*?)endbfchar/g;
  let block;
  while ((block = single.exec(text))) {
    const pairs = block[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? [];
    for (const pair of pairs) {
      const [, from, to] = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(pair);
      map.set(parseInt(from, 16), utf16beToString(to));
    }
  }

  const ranges = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((block = ranges.exec(text))) {
    const rows = block[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? [];
    for (const row of rows) {
      const [, low, high, start] = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(row);
      const first = parseInt(low, 16);
      const last = parseInt(high, 16);
      const base = parseInt(start, 16);
      for (let i = 0; i <= last - first; i++) {
        map.set(first + i, String.fromCodePoint(base + i));
      }
    }
  }

  return { map, twoByte: width >= 2 };
}

function utf16beToString(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 4) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16));
  }
  return out;
}

/* ------------------------------------------------------ content streams */

/** Split a PDF string literal, honouring escapes and nested parentheses. */
function readLiteral(source, start) {
  let depth = 1;
  let out = '';
  let i = start;

  while (i < source.length && depth > 0) {
    const char = source[i];
    if (char === '\\') {
      const next = source[i + 1];
      const octal = /^[0-7]{1,3}/.exec(source.slice(i + 1, i + 4));
      if (octal) {
        out += String.fromCharCode(parseInt(octal[0], 8));
        i += 1 + octal[0].length;
        continue;
      }
      out += { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[next] ?? next;
      i += 2;
      continue;
    }
    if (char === '(') depth++;
    if (char === ')') {
      depth--;
      if (depth === 0) break;
    }
    out += char;
    i++;
  }
  return { text: out, end: i + 1 };
}

function decodeHex(hex) {
  const clean = hex.replace(/[^0-9A-Fa-f]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 2) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 2).padEnd(2, '0'), 16));
  }
  return out;
}

/**
 * Walk a content stream and return every text run with where it landed.
 *
 * A character-level scanner rather than a regex tokeniser. A regex cannot
 * know that a `(` inside a string literal is not the start of one, and the
 * first unbalanced parenthesis in a bank's logo path sends a tokeniser out of
 * sync — after which it "reads" the rest of the stream as one enormous run of
 * text. That failure looks like data, which is the worst kind.
 *
 * @returns {Array<{x: number, y: number, text: string, size: number}>}
 */
function extractRuns(content, fonts) {
  const source = latin1(content);
  const items = [];

  // Text state. Only the parts that decide position and encoding are tracked;
  // colour, clipping and the rest cannot move a character.
  let tm = [1, 0, 0, 1, 0, 0];
  let tlm = [1, 0, 0, 1, 0, 0];
  let leading = 0;
  let size = 10;
  let font = null;

  let operands = [];
  let i = 0;

  const decode = (raw) => {
    if (!font?.toUnicode) return raw;

    // A CID font addresses glyphs with two bytes. Reading it one byte at a
    // time yields a NUL and a letter for every character — text that looks
    // almost right and is not.
    if (font.twoByte) {
      let out = '';
      for (let k = 0; k + 1 < raw.length; k += 2) {
        const code = (raw.charCodeAt(k) << 8) | raw.charCodeAt(k + 1);
        out += font.toUnicode.get(code) ?? '';
      }
      return out;
    }
    return [...raw].map((ch) => font.toUnicode.get(ch.charCodeAt(0)) ?? ch).join('');
  };

  const draw = (raw) => {
    const text = decode(raw);
    if (!text) return;
    items.push({ x: tm[4], y: tm[5], text, size: size * Math.abs(tm[3] || 1) });
  };

  const numbers = (n) => operands.slice(-n).map((value) => Number(value) || 0);

  while (i < source.length) {
    const char = source[i];

    if (char === '(') {
      const { text, end } = readLiteral(source, i + 1);
      operands.push({ string: text });
      i = end;
      continue;
    }

    if (char === '<' && source[i + 1] !== '<') {
      const close = source.indexOf('>', i);
      if (close < 0) break;
      operands.push({ string: decodeHex(source.slice(i + 1, close)) });
      i = close + 1;
      continue;
    }

    if (char === '<' && source[i + 1] === '<') {
      // An inline dictionary is an operand nothing here reads; skip it whole
      // rather than letting its contents look like operators.
      const close = source.indexOf('>>', i);
      i = close < 0 ? source.length : close + 2;
      continue;
    }

    if (char === '[' || char === ']') {
      operands.push(char);
      i++;
      continue;
    }

    if (char === '/') {
      const match = /^\/[^\s/<>[\]()]*/.exec(source.slice(i));
      operands.push(match[0]);
      i += match[0].length;
      continue;
    }

    if (/[-+.\d]/.test(char)) {
      const match = /^[-+]?[\d.]+/.exec(source.slice(i));
      if (match) {
        operands.push(match[0]);
        i += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z'"*]/.test(char)) {
      const match = /^[A-Za-z*]+|^['"]/.exec(source.slice(i));
      const operator = match[0];
      i += operator.length;

      switch (operator) {
        case 'Tf': {
          const name = String(operands.at(-2) ?? '').replace(/^\//, '');
          size = Number(operands.at(-1)) || size;
          font = fonts.get(name) ?? null;
          break;
        }
        case 'Tm': {
          tm = numbers(6);
          tlm = [...tm];
          break;
        }
        case 'Td': {
          const [tx, ty] = numbers(2);
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx, tlm[5] + ty];
          tm = [...tlm];
          break;
        }
        case 'TD': {
          const [tx, ty] = numbers(2);
          leading = -ty;
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4] + tx, tlm[5] + ty];
          tm = [...tlm];
          break;
        }
        case 'TL':
          leading = numbers(1)[0];
          break;
        case 'T*':
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - leading];
          tm = [...tlm];
          break;
        case 'BT':
          tm = [1, 0, 0, 1, 0, 0];
          tlm = [...tm];
          break;
        case 'Tj':
          draw(operands.at(-1)?.string ?? '');
          break;
        case "'":
        case '"':
          tlm = [tlm[0], tlm[1], tlm[2], tlm[3], tlm[4], tlm[5] - leading];
          tm = [...tlm];
          draw(operands.at(-1)?.string ?? '');
          break;
        case 'TJ': {
          // An array of strings and kerning numbers. The numbers only nudge
          // spacing, but a large negative one is a space the writer chose not
          // to emit — and in a statement that gap separates two columns.
          const open = operands.lastIndexOf('[');
          let raw = '';
          for (const entry of operands.slice(open + 1)) {
            if (entry?.string !== undefined) raw += entry.string;
            else if (typeof entry === 'string' && Number(entry) < -180) {
              raw += font?.twoByte ? '\u0000 ' : ' ';
            }
          }
          draw(raw);
          break;
        }
        default:
          break;
      }

      operands = [];
      continue;
    }

    i++;
  }

  return items;
}


/* ------------------------------------------------------------------ main */

/**
 * Find every object and every compressed stream, without decompressing any.
 *
 * @param {Uint8Array} bytes
 * @returns {{objects: Map, text: string, encrypted: boolean, streams: Map<number, {from, to, flate}>}}
 */
export function scan(bytes) {
  const { objects, text } = findObjects(bytes);
  const streams = new Map();

  for (const [number, object] of objects) {
    const found = locate(text, object);
    if (found) streams.set(number, found);
  }

  return {
    objects,
    text,
    streams,
    encrypted: /\/Encrypt\s+\d+\s+\d+\s+R/.test(text),
  };
}

/**
 * Turn scanned objects and their inflated streams into pages.
 *
 * @param {ReturnType<scan>} scanned
 * @param {Map<number, Uint8Array>} inflated stream data by object number
 */
/**
 * The stream numbers a page's `/Contents` really points at.
 *
 * `/Contents` can be a stream, an inline array of streams, **or a reference to
 * an object that is itself an array of streams** — and the third form is why a
 * real bank statement produced nothing at all. Its pages said
 * `/Contents 141 0 R`, and object 141 was `[ 139 0 R  10 0 R  140 0 R ]`. The
 * reader looked for a stream numbered 141, found none, and dropped the page.
 * Thirty pages and 4,314 text-drawing operators came back as an empty document.
 *
 * One level of indirection is enough: an array of arrays is not a shape the
 * specification produces, and following references without a bound is how a
 * malformed file becomes an infinite loop.
 */
function contentStreams(number, objects) {
  const body = objects.get(number)?.body ?? '';
  const inner = /^\s*\[([\s\S]*)\]\s*$/.exec(body);
  if (!inner) return [number];

  const nested = (inner[1].match(/(\d+)\s+\d+\s+R/g) ?? [])
    .map((reference) => Number(/(\d+)/.exec(reference)[1]));
  return nested.length ? nested : [number];
}

/**
 * The `<< … >>` starting at `open`, counting nesting.
 *
 * A dictionary cannot be found with `<<([^>]*)>>`: the first `>` inside it
 * ends the match, so `/Font<</Ft0<</BaseFont/Times-Roman>>>>` reads as far as
 * the inner font and stops. Depth-counting is the only way to get the whole
 * of a dictionary that contains one.
 */
function balancedDict(source, open) {
  let depth = 0;
  for (let i = open; i < source.length - 1; i++) {
    if (source[i] === '<' && source[i + 1] === '<') { depth++; i++; continue; }
    if (source[i] === '>' && source[i + 1] === '>') {
      depth--;
      if (!depth) return source.slice(open, i + 2);
      i++;
    }
  }
  return null;
}

/**
 * The dictionary at `/key`, whether it is written out or referred to.
 *
 * `/Resources << /Font … >>` and `/Resources 3620 0 R` are the same thing
 * said two ways, and a page is free to use either. Adobe Scan uses the
 * second — so does most of what a household will actually scan a bill with —
 * and a reader that only knows the first finds no fonts on the page at all.
 */
function dictValue(body, key, objects) {
  const at = new RegExp(`/${key}\\s*(<<|\\d+\\s+\\d+\\s+R)`).exec(body ?? '');
  if (!at) return null;

  if (at[1] === '<<') return balancedDict(body, at.index + at[0].length - 2);

  const target = objects.get(Number(/(\d+)/.exec(at[1])[1]))?.body;
  const open = target?.indexOf('<<') ?? -1;
  return open === -1 ? null : balancedDict(target, open);
}

/**
 * A PDF name, as written after its slash.
 *
 * `C0_0` is a name a real producer uses, and `[A-Za-z0-9]+` does not match
 * it — it matches `C0` and then fails on the underscore, so the font is
 * skipped and its text comes out undecoded. Everything that is not a
 * delimiter or whitespace is part of the name.
 */
const NAME = '[^\\s/<>\\[\\]()]+';

export function build({ objects, text, encrypted }, inflated) {
  expandObjectStreams(objects, inflated);
  const streamData = (number) => inflated.get(number) ?? null;

  if (encrypted) {
    return { pages: [], encrypted: true, reason: 'the PDF is encrypted' };
  }

  /** What a font dictionary says about turning its bytes into text. */
  const readFont = (body) => {
    const reference = /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(body);
    let toUnicode = null;
    if (reference) {
      const data = streamData(Number(reference[1]));
      if (data) toUnicode = parseToUnicode(data);
    }
    return {
      toUnicode: toUnicode?.map ?? null,
      // A composite font is two-byte even when its CMap forgot to say so.
      twoByte: toUnicode?.twoByte ?? /\/Subtype\s*\/Type0/.test(body),
    };
  };

  // Fonts by object number, each with its ToUnicode map where it has one.
  const fontsByNumber = new Map();
  for (const [number, object] of objects) {
    if (!/\/Type\s*\/Font/.test(object.body)) continue;
    fontsByNumber.set(number, readFont(object.body));
  }

  // Pages, in the order the page tree gives them. Resolving each page's own
  // resource dictionary matters: `/F1` is not a global name, and two pages
  // can bind it to different fonts.
  const pages = [];
  const pageObjects = [...objects.entries()]
    .filter(([, object]) => /\/Type\s*\/Page[^s]/.test(object.body))
    .sort((a, b) => a[0] - b[0]);

  for (const [, page] of pageObjects) {
    const fonts = new Map();
    const resources = dictValue(page.body, 'Resources', objects);
    const fontDict = dictValue(resources, 'Font', objects);

    if (fontDict) {
      // `/F1 5 0 R` — the font is an object of its own.
      for (const entry of fontDict.match(
        new RegExp(`/(${NAME})\\s+(\\d+)\\s+\\d+\\s+R`, 'g')) ?? []) {
        const [, name, number] = new RegExp(`/(${NAME})\\s+(\\d+)\\s+\\d+\\s+R`).exec(entry);
        const font = fontsByNumber.get(Number(number));
        if (font) fonts.set(name, font);
      }

      // `/Ft0 << /BaseFont … >>` — the font is written into the page's own
      // resources. A simple font written this way has no ToUnicode and needs
      // none; reading it matters because a page whose fonts are all inline
      // would otherwise bind nothing and report every run as raw bytes.
      const inline = new RegExp(`/(${NAME})\\s*<<`, 'g');
      for (let m = inline.exec(fontDict); m; m = inline.exec(fontDict)) {
        const body = balancedDict(fontDict, m.index + m[0].length - 2);
        if (!body) continue;
        if (!fonts.has(m[1])) fonts.set(m[1], readFont(body));
        inline.lastIndex = m.index + m[0].length - 2 + body.length;
      }
    }

    // `/Contents` is one reference or an array of them; a page split across
    // several streams is one page, not several.
    const contents = /\/Contents\s*(\[[^\]]*\]|\d+\s+\d+\s+R)/.exec(page.body);
    if (!contents) continue;
    const references = (contents[1].match(/(\d+)\s+\d+\s+R/g) ?? [])
      .map((reference) => Number(/(\d+)/.exec(reference)[1]))
      .flatMap((number) => contentStreams(number, objects));

    const items = [];
    for (const number of references) {
      const data = streamData(number);
      if (!data) continue;
      items.push(...extractRuns(data, fonts));
    }

    if (items.length) pages.push({ items, rows: toRows(items), lines: toLines(items) });
  }

  return { pages, encrypted: false };
}

/**
 * Group runs into rows by Y, then order each row by X.
 *
 * The tolerance matters: too tight and a row splits because one cell is
 * rendered half a point higher; too loose and two table rows merge into one
 * transaction. Two points is about a quarter of a line at statement sizes.
 */
export function toRows(items, tolerance = 2.2) {
  const rows = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  return rows.map((row) => ({
    y: row.y,
    cells: row.items.sort((a, b) => a.x - b.x)
      .map((item) => ({ x: item.x, text: item.text.trim() }))
      .filter((cell) => cell.text),
  })).filter((row) => row.cells.length);
}

export function toLines(items, tolerance = 2.2) {
  const rows = [];

  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= tolerance);
    if (row) row.items.push(item);
    else rows.push({ y: item.y, items: [item] });
  }

  return rows.map((row) => row.items
    .sort((a, b) => a.x - b.x)
    .reduce((line, item, index, all) => {
      const previous = all[index - 1];
      // A visible gap between runs is a column boundary, and joining them
      // without a separator merges a date into an amount.
      const gap = previous ? item.x - previous.x - previous.text.length * item.size * 0.5 : 0;
      return line + (previous && gap > item.size * 0.35 ? '  ' : '') + item.text;
    }, '')
    .replace(/\s+/g, ' ')
    .trim())
    .filter(Boolean);
}

/* --------------------------------------------------- inflating the streams */

/**
 * Inflate with the platform's own decompressor.
 *
 * Both wrappings are tried because PDF writers disagree about whether the
 * two-byte zlib header belongs there, and a stray leading byte before it is
 * common enough that every reader retries past one.
 */
export async function inflate(raw) {
  for (const format of ['deflate', 'deflate-raw']) {
    for (const offset of [0, 1]) {
      try {
        const stream = new Blob([raw.subarray(offset)]).stream()
          .pipeThrough(new DecompressionStream(format));
        return new Uint8Array(await new Response(stream).arrayBuffer());
      } catch { /* try the next wrapping */ }
    }
  }
  return null;
}

/**
 * Inflate every compressed stream a scan found.
 *
 * @param {Uint8Array} bytes the whole file
 * @param {ReturnType<scan>} scanned
 * @param {(raw: Uint8Array) => Promise<Uint8Array|null>} [decompress]
 */
export async function inflateAll(bytes, { streams }, decompress = inflate) {
  const out = new Map();

  for (const [number, { from, to, flate }] of streams) {
    const raw = bytes.subarray(from, to);
    if (!flate) {
      out.set(number, raw);
      continue;
    }
    const data = await decompress(raw);
    // A stream that will not inflate is one object, not a broken file: a
    // corrupt thumbnail must not stop a statement being read.
    if (data) out.set(number, data);
  }

  return out;
}

/* ------------------------------------------------------------ the front door */

/**
 * Read a PDF.
 *
 * @param {Uint8Array|ArrayBuffer} input
 * @param {{decompress?: (raw: Uint8Array) => Promise<Uint8Array|null>}} [options]
 * @returns {Promise<{pages: Array<{items, rows, lines}>, encrypted: boolean, reason?: string}>}
 */
export async function extract(input, { decompress = inflate } = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const scanned = scan(bytes);
  if (scanned.encrypted) return { pages: [], encrypted: true, reason: 'the PDF is encrypted' };
  return build(scanned, await inflateAll(bytes, scanned, decompress));
}

/** All pages as one text block, in reading order. */
export async function extractText(bytes, options) {
  const result = await extract(bytes, options);
  if (result.encrypted) throw new Error(result.reason);
  return result.pages.map((page) => page.lines.join('\n')).join('\n');
}
