/**
 * What a document is allowed to make this device do.
 *
 * ## The bug these were written against
 *
 * `inflate` handed the whole stream to `new Response(stream).arrayBuffer()`,
 * which has no size bound and cannot be given one. DEFLATE reaches 1032:1, so
 * a **204 KB `.docx` measured 200 MB of output and 1.09 GB of resident
 * memory** — and `capture` allows 8 MB, which puts the ceiling near 8 GB. At
 * 700 MB the run here died inside `TextDecoder` with `ERR_STRING_TOO_LONG`; a
 * phone would have lost the browser process before reaching that.
 *
 * `js/sync/drive.js` wraps document reading in `try { … } catch { return null }`,
 * which is why this looked survivable and was not: **the memory is spent
 * before anything throws**, and a `catch` that runs afterwards is a catch that
 * runs too late. This is the same shape as the CMap range that asked for four
 * billion iterations — untrusted numbers deciding how much work to do — and it
 * is why the bound has to be inside the loop rather than around it.
 *
 * ## Why there are two bounds and not one
 *
 * A cap on a single stream does not cap a file. A zip's central directory
 * counts entries in sixteen bits, so an archive may declare 65,535 of them,
 * and a PDF may declare as many objects as it likes. Each one claiming its own
 * capful is terabytes. So `unzip` and `inflateAll` hold a budget across the
 * whole file and offer each stream what is left of it, and there are checks
 * below for both halves — the per-stream cap and the shared budget — because
 * removing either one alone still crashes the device.
 */

import { deflateRawSync } from 'node:zlib';
import { test, describe, assert, setSuite } from './harness.mjs';
import { inflate, takeUpTo, MAX_INFLATED_BYTES } from '../js/data/inflate.js';
import { unzip, entriesIn } from '../js/domain/docxtemplate.js';
import { readOoxml } from '../js/data/office-read.js';
import { inflateAll } from '../js/data/pdf-read.js';

setSuite('inflate');

const MiB = 1024 * 1024;

/**
 * Bytes that inflate to `mb` megabytes of the letter A.
 *
 * Built a megabyte at a time so the fixture never holds the expanded form —
 * the point is that the *reader* is what allocates it, and a test that
 * allocated it first would be measuring its own fixture.
 */
function bomb(mb) {
  const chunk = Buffer.alloc(MiB, 0x41);
  const parts = [];
  for (let i = 0; i < mb; i += 1) parts.push(chunk);
  return new Uint8Array(deflateRawSync(Buffer.concat(parts), { level: 9 }));
}

const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff];
const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

/**
 * A zip built by hand, because `reports/xlsx.js`'s `zip` stores its entries
 * uncompressed and a deflated entry is the whole subject here.
 *
 * The CRC is written as zero: `entriesIn` reads sizes and offsets and never
 * checks it, and pretending otherwise in a fixture would suggest it does.
 */
function zipOf(entries) {
  /** Concatenated as arrays would blow the stack: an entry is megabytes. */
  const join = (parts) => {
    const out = new Uint8Array(parts.reduce((n, one) => n + one.length, 0));
    let at = 0;
    for (const part of parts) { out.set(part, at); at += part.length; }
    return out;
  };

  const local = [];
  const central = [];
  let at = 0;

  for (const { name, data, method } of entries) {
    const nameBytes = new TextEncoder().encode(name);
    const header = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(method), ...u16(0), ...u16(0),
      ...u32(0), ...u32(data.length), ...u32(0),
      ...u16(nameBytes.length), ...u16(0),
    ]);
    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(method),
      ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(0),
      ...u16(nameBytes.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(at), ...nameBytes,
    ]));
    local.push(header, nameBytes, data);
    at += header.length + nameBytes.length + data.length;
  }

  const dir = join(central);
  return join([...local, dir, new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(dir.length), ...u32(at), ...u16(0),
  ])]);
}

const DEFLATED = 8;
const STORED = 0;

describe('one stream', () => {
  test('an ordinary stream still comes back whole', async () => {
    const text = 'column x, column y, balance';
    const packed = new Uint8Array(deflateRawSync(Buffer.from(text)));
    const out = await inflate(packed);
    assert.equal(new TextDecoder().decode(out), text);
  });

  test('bytes that will not inflate at all are still null', async () => {
    assert.equal(await inflate(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
  });

  test('a stream is cut at the limit it was given', async () => {
    const out = await inflate(bomb(8), 1024);
    assert.equal(out.length, 1024);
  });

  test('what it kept is the real prefix, not a buffer of zeroes', async () => {
    const out = await inflate(bomb(4), 16);
    assert.equal(new TextDecoder().decode(out), 'A'.repeat(16));
  });

  test('a limit of zero keeps nothing rather than everything', async () => {
    const out = await inflate(bomb(8), 0);
    assert.equal(out.length, 0);
  });

  /*
   * The one check at the real default. Sixty-eight megabytes is the smallest
   * fixture that clears a 64 MiB cap — anything larger only makes the suite
   * slower. The assertion is an exact count, not a stopwatch, because a timing
   * budget loose enough not to be flaky is loose enough to pass with the bound
   * removed, which is exactly what happened to the CMap check before it was
   * rewritten to count.
   */
  test('with no limit named, a bomb stops at the default', async () => {
    const out = await inflate(bomb(68));
    assert.equal(out.length, MAX_INFLATED_BYTES);
  });

  test('the default is the number the comment claims', () => {
    assert.equal(MAX_INFLATED_BYTES, 64 * 1024 * 1024);
  });
});

describe('it stops reading, rather than trimming afterwards', () => {
  /*
   * This is the check the first draft of this file did not have, and the
   * mutation run is what said so: removing the break that ends the read passed
   * every assertion above, because trimming the answer at the end looks
   * identical from the outside while the whole bomb has already been
   * decompressed into memory. The memory is the bug. So count the pulls.
   */
  const counted = (chunks, size) => {
    const state = { pulled: 0, cancelled: false };
    let left = chunks;
    return {
      state,
      stream: new ReadableStream({
        pull(controller) {
          state.pulled += 1;
          if (left > 0) { left -= 1; controller.enqueue(new Uint8Array(size).fill(0x41)); }
          else controller.close();
        },
        cancel() { state.cancelled = true; },
      }),
    };
  };

  test('the reader is let go once the limit is reached', async () => {
    const { stream, state } = counted(10_000, 100);
    const out = await takeUpTo(stream, 250);
    assert.equal(out.length, 250);
    assert.ok(state.pulled <= 5, `pulled ${state.pulled} chunks for 250 bytes`);
  });

  test('and the stream is cancelled rather than left running', async () => {
    const { stream, state } = counted(10_000, 100);
    await takeUpTo(stream, 250);
    assert.ok(state.cancelled, 'the stream was never cancelled');
  });

  test('a stream that ends before the limit is read to its end', async () => {
    const { stream, state } = counted(3, 100);
    const out = await takeUpTo(stream, 10_000);
    assert.equal(out.length, 300);
    assert.equal(state.cancelled, false);
  });
});

describe('a whole archive', () => {
  test('the fixture really is a bomb, or nothing below means anything', () => {
    const packed = bomb(16);
    assert.ok(packed.length < 32 * 1024,
      `16 MB compressed to ${packed.length} bytes, which is not a bomb`);
  });

  test('many bombed entries share one budget', async () => {
    const packed = bomb(4);
    const parts = await unzip(
      zipOf(Array.from({ length: 40 }, (_, i) => (
        { name: `part${i}.xml`, data: packed, method: DEFLATED }
      ))),
      inflate,
      1000,
    );
    const total = Object.values(parts).reduce((n, one) => n + one.length, 0);
    assert.ok(total <= 1000, `kept ${total} bytes of a 160 MB archive`);
  });

  test('the archive it refused really did declare all forty entries', () => {
    const packed = bomb(1);
    const entries = entriesIn(zipOf(Array.from({ length: 40 }, (_, i) => (
      { name: `part${i}.xml`, data: packed, method: DEFLATED }
    ))));
    assert.equal(entries.length, 40);
  });

  test('stored entries are counted against the budget too', async () => {
    const data = new Uint8Array(4096).fill(0x41);
    const parts = await unzip(
      zipOf([
        { name: 'a.xml', data, method: STORED },
        { name: 'b.xml', data, method: STORED },
      ]),
      inflate,
      5000,
    );
    const total = Object.values(parts).reduce((n, one) => n + one.length, 0);
    assert.ok(total <= 5000, `kept ${total} bytes`);
  });

  test('an ordinary archive is untouched by any of this', async () => {
    const enc = (t) => new TextEncoder().encode(t);
    const parts = await unzip(
      zipOf([{ name: 'word/document.xml', data: enc('<w:p/>'), method: STORED }]),
      inflate,
    );
    assert.equal(new TextDecoder().decode(parts['word/document.xml']), '<w:p/>');
  });
});

describe('through the reader a household reaches', () => {
  /*
   * The end of the path `drive.js` runs: a file small enough to upload, read
   * the way an uploaded `.docx` is read. Before the bound this returned two
   * hundred megabytes of text in five seconds and held a gigabyte to do it.
   */
  /*
   * Sixty-eight megabytes of ordinary paragraphs, not one enormous one: a
   * document cut at the cap should still be read down to where it was cut,
   * and a single-paragraph fixture cannot tell "bounded" from "lost".
   *
   * Level 1, not 9: the text repeats, so the ratio barely moves and the
   * fixture stops being the slow part. Both assertions share one read for
   * the same reason — sixty-four megabytes of `</w:p>` splitting is not
   * something to do twice for one fact.
   */
  test('a .docx bomb is read, bounded, and is still the document', async () => {
    const paragraph = '<w:p><w:r><w:t>Premium due 12,500</w:t></w:r></w:p>';
    const xml = Buffer.concat([
      Buffer.from('<?xml version="1.0"?><w:document xmlns:w="x"><w:body>'),
      Buffer.from(paragraph.repeat(Math.ceil((68 * MiB) / paragraph.length))),
      Buffer.from('</w:body></w:document>'),
    ]);
    const docx = zipOf([{
      name: 'word/document.xml',
      data: new Uint8Array(deflateRawSync(xml, { level: 1 })),
      method: DEFLATED,
    }]);
    assert.ok(docx.length < 8 * MiB, `the .docx is ${docx.length} bytes`);

    const pages = await readOoxml(docx, inflate);
    const characters = pages.reduce((n, page) => n + page.lines.join('').length, 0);

    // Bounded...
    assert.ok(characters <= MAX_INFLATED_BYTES,
      `read ${characters} characters out of a ${docx.length}-byte file`);
    // ...and still read, which the bound on its own does not say. An earlier
    // draft asserted only the first line and would have passed on nothing.
    assert.equal(pages.length, 1);
    assert.ok(pages[0].lines.length > 1000, `got ${pages[0].lines.length} lines`);
    assert.equal(pages[0].lines[0], 'Premium due 12,500');
  });
});

describe('a PDF full of streams', () => {
  /** What `scan` returns, of which only `streams` matters here. */
  const scanned = (streams) => ({
    objects: new Map(), text: '', encrypted: false, streams,
  });

  test('the budget is shared across the file, not granted per object', async () => {
    const streams = new Map();
    for (let i = 0; i < 20; i += 1) streams.set(i, { from: 0, to: 4, flate: true });

    // A decompressor that honours its limit the way the real one does, so the
    // subject is `inflateAll`'s accounting rather than the platform's.
    const fake = async (raw, limit = Infinity) => new Uint8Array(Math.min(1000, limit));

    const out = await inflateAll(new Uint8Array(8), scanned(streams), fake, 2500);
    const total = [...out.values()].reduce((n, one) => n + one.length, 0);
    assert.ok(total <= 2500, `kept ${total} bytes across ${out.size} objects`);
  });

  test('a file within the budget keeps every stream', async () => {
    const streams = new Map([[1, { from: 0, to: 4, flate: true }]]);
    const fake = async () => new Uint8Array(100);
    const out = await inflateAll(new Uint8Array(8), scanned(streams), fake, 2500);
    assert.equal(out.size, 1);
  });
});
