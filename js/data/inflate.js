/**
 * The browser's own decompressor, with a bound on what comes out of it.
 *
 * ## Why this is its own file
 *
 * `pdf-read.js` wrote this for a PDF's compressed streams, and `docxtemplate.js`
 * then borrowed it for zip entries — the two formats agree on DEFLATE, so one
 * implementation was right. What was not right was where it lived: the zip
 * reader had to take it as an injected argument with a comment apologising
 * that *"`data/pdf-read.js` owns the browser's decompression and this file
 * should not decide where that comes from"*. Neither of them owns it. It is
 * the platform's, and this is where it is reached.
 *
 * The injection stays, because the tests use it to run a zip reader with no
 * decompressor at all and get the stored entries back.
 */

/**
 * The most one compressed stream is allowed to expand to.
 *
 * ## Why there has to be a number here at all
 *
 * DEFLATE reaches about 1032:1, and the file this decompresses came from
 * somebody's phone. Measured: **204 KB of `.docx` expands to 200 MB and holds
 * a gigabyte of memory** while it does. `capture` refuses anything over 8 MB,
 * so the ceiling without a bound here is roughly **8 GB** — not a slow read
 * but the browser process being killed, on a file a household was invited to
 * upload. It does not take a hostile producer either; a truncated size field
 * in a corrupt zip asks for the same thing.
 *
 * 64 MB is eight times the entire upload limit. Nothing honest inside an 8 MB
 * file reaches it: that would be a single part compressing better than 8:1
 * *and* holding more text than the rest of the file put together.
 */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

/**
 * A stream's bytes, stopping at `limit`.
 *
 * Read chunk by chunk rather than `new Response(stream).arrayBuffer()`, which
 * is the whole point: that call has no bound and cannot be given one, so the
 * allocation is already made by the time any check could look at it. **A
 * `try/catch` around it does not help** — the memory is spent before it throws,
 * and on a phone the process is gone before that.
 *
 * Truncating rather than refusing is deliberate. A document whose text runs
 * past the cap still yields the text up to it, and `wordLines` splits on
 * `</w:p>`, so a half-written paragraph at the end simply does not match. The
 * alternative — returning null — files the whole document as unreadable with
 * nothing said, which is the failure this repository has already been bitten
 * by twice.
 *
 * Exported because the assertion that matters is not what comes back but that
 * **it stopped reading** — trimming the answer at the end still decompresses
 * the whole bomb first, and a check on the returned length cannot tell the two
 * apart. It could not: reverting the break below passed fifteen out of fifteen
 * checks written against `inflate`'s output.
 *
 * @param {ReadableStream<Uint8Array>} stream
 * @param {number} limit
 */
export async function takeUpTo(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    // After the push, not before: a chunk arrives whole and there is nothing
    // to gain by throwing away one already in hand. The overshoot is one
    // chunk, and the copy below clamps it.
    if (total >= limit) {
      await reader.cancel().catch(() => {});
      break;
    }
  }

  const out = new Uint8Array(Math.min(total, limit));
  let at = 0;
  for (const chunk of chunks) {
    if (at >= out.length) break;
    out.set(chunk.subarray(0, out.length - at), at);
    at += chunk.length;
  }
  return out;
}

/**
 * Inflate with the platform's own decompressor.
 *
 * Both wrappings are tried because PDF writers disagree about whether the
 * two-byte zlib header belongs there, and a stray leading byte before it is
 * common enough that every reader retries past one.
 *
 * @param {Uint8Array} raw
 * @param {number} [limit] bytes of output to keep; the rest is dropped.
 *   Callers holding a budget across many streams pass what is left of it.
 */
export async function inflate(raw, limit = MAX_INFLATED_BYTES) {
  for (const format of /** @type {CompressionFormat[]} */ (['deflate', 'deflate-raw'])) {
    for (const offset of [0, 1]) {
      // The cast is the DOM lib's parameterised `Uint8Array<ArrayBufferLike>`
      // not matching its own `BlobPart`, not a doubt about the value.
      const part = /** @type {BlobPart} */ (/** @type {unknown} */ (raw.subarray(offset)));
      try {
        const stream = new Blob([part]).stream()
          .pipeThrough(new DecompressionStream(format));
        return await takeUpTo(stream, Math.max(0, limit));
      } catch { /* try the next wrapping */ }
    }
  }
  return null;
}

