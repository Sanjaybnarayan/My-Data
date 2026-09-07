/**
 * A PDF font's ToUnicode CMap: which glyph number means which character.
 *
 * Split out of `pdf-read.js`, which was already over the size this
 * repository lets a file reach and so could not grow. It is a clean seam
 * rather than a convenient one: scanning a PDF's objects and decoding one
 * font's character map are different jobs, and only this half is reached
 * with numbers the document itself chose.
 *
 * It takes decoded text rather than bytes, which is what keeps the import
 * going one way: `pdf-read.js` owns `latin1` and several other things use
 * it, so asking for the string it has already made avoids a cycle.
 */

/**
 * Typographic ligatures, as the letters a person typed.
 *
 * A subset font maps its `ﬁ` glyph to U+FB01, which is correct and unhelpful:
 * `beneﬁts` does not match a search for `benefits`, and no label pattern in
 * `domain/extract.js` containing `fi` will ever match a document that uses
 * them. Measured on a real motor policy, which is full of them.
 *
 * This is the one place a reader is allowed to change what the document said,
 * because it is not changing it — U+FB01 *is* `fi`, written as one glyph for
 * the typesetter's benefit.
 */
const LIGATURES = new Map(Object.entries({
  'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl',
  'ﬃ': 'ffi', 'ﬄ': 'ffl', 'ﬅ': 'st', 'ﬆ': 'st',
}));

const unligature = (text) => (/[ﬀ-ﬆ]/.test(text)
  ? [...text].map((ch) => LIGATURES.get(ch) ?? ch).join('')
  : text);

function utf16beToString(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 4) {
    const code = parseInt(hex.slice(i, i + 4).padEnd(4, '0'), 16);
    // A CMap entry of U+0000 is a font saying *this glyph has no Unicode* —
    // subset fonts write it for ligatures and ornaments they could not map.
    // Emitting it puts a NUL inside a word: measured on a real policy, the
    // reader produced `Certi<NUL>cate`, which is invisible on screen, does
    // not match a search for `certificate`, and would be written into a cell
    // in the household's Sheet. Dropping it leaves `Certicate` — wrong, but
    // wrong in a way somebody can see.
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return unligature(out);
}

/** The whole two-byte code space: no honest bfrange spans more than this. */
const CODE_SPACE = 0x10000;

/** The last code point Unicode has; `String.fromCodePoint` throws above it. */
const MAX_CODE_POINT = 0x10FFFF;

export function parseToUnicode(text) {
  const map = new Map();

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

      /*
       * The bounds of this loop came out of the file, and the file is not
       * ours. `<0000> <FFFFFFFF> <0041>` is eight valid hex digits and legal
       * to write in a PDF; it asked for 4,294,967,296 iterations of
       * `Map.set` — a hang, then an out-of-memory, on a document a household
       * was invited to upload. `sync/drive.js` wraps this read in a
       * try/catch, which is why the `fromCodePoint` throw was survivable; a
       * catch cannot interrupt a running loop, so nothing there helped here.
       *
       * A code is at most two bytes wide, so a range spanning more than
       * `CODE_SPACE` is malformed by definition rather than merely large, and
       * no honest CMap is refused. Stopping at `MAX_CODE_POINT` costs the
       * rest of one range instead of the whole document's text.
       *
       * A reversed range needs no guard and has none: `stop` goes negative
       * and `i <= stop` is false at once. One was written, and mutation
       * testing removed it without a check noticing.
       */
      const stop = Math.min(last - first, CODE_SPACE - 1);
      for (let i = 0; i <= stop; i++) {
        const point = base + i;
        if (point > MAX_CODE_POINT) break;
        map.set(first + i, String.fromCodePoint(point));
      }
    }
  }

  return { map, twoByte: width >= 2 };
}
