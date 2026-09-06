/**
 * Files handed to FamilyOS by another app's share sheet.
 *
 * ## What was measured before this was written
 *
 * `AndroidManifest.xml` carried one intent-filter: `MAIN` / `LAUNCHER`. So
 * FamilyOS did not appear in the share sheet at all, and the only way a
 * document got in was the picker on the Documents screen — while
 * `sync/drive.js` could already read a PDF, a Word file, a spreadsheet and a
 * text file and fill in a due date from it. The reading was never the gap; the
 * getting was, which is the same sentence `core/smsinbox.js` opens with.
 *
 * ## Nothing is decided in Java
 *
 * `ShareTargetPlugin` resolves a content URI to a name, a declared type and
 * bytes. Which reader a file needs, whether it can be read, and what to fill
 * in from it are all decided here and below, where the tests are. A second
 * copy of that judgement in the language with no tests over it — going first —
 * is the argument `smsinbox.js` makes about message filtering, and it applies
 * unchanged.
 *
 * ## Drained, not listened for
 *
 * On a cold share Android starts the app *because of* the share, so the intent
 * is delivered before the WebView has any listener. An event would be lost and
 * the file silently dropped. The plugin holds the share and this takes it,
 * which behaves the same whether the app was already open or not.
 *
 * ## What a share is allowed to do
 *
 * Capture a document and open its naming form. Nothing else — no automatic
 * filing under a person, no record created in another module, no navigation
 * away from where the household ends up. A share is somebody handing over a
 * file, not authorising the application to act on its contents.
 */

import { plugin as nativePlugin } from './native.js';

export const UNSUPPORTED = 'unsupported';

/** Whether this build can be shared to at all. False in a browser. */
export function available({ plugin = nativePlugin } = {}) {
  return Boolean(plugin?.('ShareTarget'));
}

/**
 * Base64 back to bytes.
 *
 * `atob` gives a string of char codes; anything above 0xFF would mean the
 * transport corrupted it, and `charCodeAt` truncating silently is how a PDF
 * arrives one byte short of readable.
 */
function bytesOf(base64) {
  const binary = atob(String(base64 ?? ''));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i) & 0xff;
  return out;
}

/**
 * A shared file as the thing `DocumentStore.capture` takes.
 *
 * Deliberately not a real `File`. `capture` reads `name`, `type`, `size` and
 * `arrayBuffer()`, and constructing a `File` would need a `Blob` copy of bytes
 * already in memory — on an 8 MB upload that is a second 8 MB for nothing.
 */
export function asFile(one) {
  const bytes = bytesOf(one?.bytes);
  return {
    name: String(one?.name || 'shared'),
    // The sender's declared type, kept exactly as given — including empty.
    // `domain/filing.js#readerFor` falls back to the name, which is the whole
    // reason it takes one.
    type: String(one?.type ?? ''),
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
    ),
  };
}

/**
 * Whatever has been shared since this was last asked, and then nothing.
 *
 * Returns `{ files, tooLarge }`. A file the plugin refused for size arrives
 * named but without bytes, and is reported rather than dropped: a household
 * who shared a 40 MB scan and saw nothing happen would reasonably conclude the
 * share sheet was broken.
 *
 * `plugin` is injected for the same reason `smsinbox.js` injects it — this
 * path has to be exercised without a phone, and it never has run on one.
 *
 * @param {{plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<{ok: boolean, files: object[], tooLarge: object[], why?: string}>}
 */
export async function take({ plugin = nativePlugin } = {}) {
  const native = plugin?.('ShareTarget');
  if (!native?.take) return { ok: false, files: [], tooLarge: [], why: UNSUPPORTED };

  try {
    const result = await native.take();
    const all = Array.isArray(result?.files) ? result.files : [];
    return {
      ok: true,
      files: all.filter((one) => one && !one.tooLarge && one.bytes).map(asFile),
      // Kept as they came: there is nothing to read, only something to say.
      tooLarge: all.filter((one) => one?.tooLarge),
    };
  } catch (err) {
    return {
      ok: false, files: [], tooLarge: [], why: String(err?.message ?? err),
    };
  }
}
