/**
 * Reading text out of pictures of text.
 *
 * ## What this replaces
 *
 * A photograph and a scanned PDF were filed unread, and the honest answer was
 * "Google Drive reads them when they sync". That is a network round trip and a
 * connected Drive, in an application whose first claim is that it works
 * offline — and it made the **Scan** button, the obvious thing to press while
 * standing over a bill, produce nothing at all until the phone had signal.
 *
 * ## What does the recognising
 *
 * ML Kit's Latin text recognition, **bundled into the APK** rather than
 * downloaded on first use. `tesseract.js` was the alternative and was
 * rejected: `package.json` says this application has no dependencies and no
 * build step, there is no bundler to load a WASM module through, and the CSP
 * is `script-src 'self'` with no `wasm-unsafe-eval`. Not on size — bundling
 * ML Kit takes the APK from 5.4 MB to 23.9 MB, which is more than the fifteen
 * megabytes of vendored engine and language data `tesseract.js` would have
 * cost. An earlier version of this docblock made the size argument off a
 * four-megabyte estimate, and had it backwards.
 *
 * Scanned PDFs go through the same plugin by a different route: `pdf-read.js`
 * is a text extractor with no rasteriser, and Android has had one since API 21
 * — the plugin renders each page and recognises the bitmap.
 *
 * ## What it will not do, said here rather than found out
 *
 * **Latin script only.** A Kannada or Devanagari document comes back empty
 * rather than wrong, which is the right failure and is still a failure.
 *
 * **No handwriting**, and **no layout** — a table is read as the lines it
 * looks like. Enough for "Due Date: 18/10/2026"; not a spreadsheet.
 *
 * **Android only.** In a browser this is unavailable and says so, and an image
 * there still waits for Drive. Every function below takes an injected plugin
 * for the same reason `smsinbox.js` does: none of this has run on a phone.
 *
 * ## Recognition is a guess, and the difference is kept
 *
 * Text lifted out of a PDF is exactly what the document says. Text recognised
 * from a photograph is a model's reading of some pixels — usually right, and a
 * different kind of answer. `domain/filing.js` keeps `canReadText` false for
 * an image for that reason, so a screen can tell the two apart.
 */

import { plugin as nativePlugin } from './native.js';

/** Whether this build can recognise text at all. False in a browser. */
export function available({ plugin = nativePlugin } = {}) {
  return Boolean(plugin?.('Ocr'));
}

/**
 * Bytes to base64, in chunks.
 *
 * `String.fromCharCode(...bytes)` on a two-megabyte photograph spreads two
 * million arguments into one call and throws `RangeError: Maximum call stack
 * size exceeded` — on the large files this exists for, and never on the small
 * ones a test would reach for.
 */
function base64Of(bytes) {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** Pages the way `pdf-read.js` returns them, or `null` when nothing read. */
function pagesOf(result) {
  const pages = Array.isArray(result?.pages) ? result.pages : [];
  const kept = pages
    .map((page) => ({
      lines: (Array.isArray(page?.lines) ? page.lines : [])
        .map((line) => String(line).trim())
        .filter(Boolean),
    }))
    .filter((page) => page.lines.length);
  return kept.length ? kept : null;
}

/**
 * The text in an image.
 *
 * `null` for every failure and for a picture with no text in it — those are
 * the same outcome to a caller, and a document that could not be read is still
 * a document worth keeping.
 *
 * @param {Uint8Array} bytes
 * @param {{plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<Array<{lines: string[]}>|null>}
 */
export async function readImage(bytes, { plugin = nativePlugin } = {}) {
  const native = plugin?.('Ocr');
  if (!native?.readImage) return null;
  try {
    return pagesOf(await native.readImage({ bytes: base64Of(bytes) }));
  } catch {
    return null;
  }
}

/**
 * The text in a PDF that carries no text layer.
 *
 * Only called once `pdf-read.js` has found nothing, so a PDF written by a
 * computer is never rasterised and never recognised — its text is exact and
 * this would replace it with a reading of a picture of it.
 *
 * @param {Uint8Array} bytes
 * @param {{plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<Array<{lines: string[]}>|null>}
 */
export async function readPdf(bytes, { plugin = nativePlugin } = {}) {
  const native = plugin?.('Ocr');
  if (!native?.readPdf) return null;
  try {
    return pagesOf(await native.readPdf({ bytes: base64Of(bytes) }));
  } catch {
    return null;
  }
}
