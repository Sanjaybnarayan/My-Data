/**
 * Reading text out of pictures of text.
 *
 * ## What this replaces
 *
 * A photograph and a scanned PDF were filed unread, and the answer was "Drive
 * reads them when they sync" — a network round trip and a connected Drive, in
 * an application whose first claim is that it works offline. The **Scan**
 * button produced nothing at all until the phone had signal.
 *
 * ## This has never run on a phone
 *
 * Said plainly, the way `tests/trail.test.mjs` says it for the location trail.
 * There is no device and no emulator here. **ML Kit itself is asserted by
 * nothing**: not the recognition, not `PdfRenderer`, not the bitmap the pages
 * are rendered onto. What is driven below is the JavaScript against a fake
 * plugin — the ordering, the fallbacks, the refusals, and every path where
 * recognition is absent.
 *
 * That last one is not a lesser half. Most installs of this application are a
 * browser, where there is no recogniser at all, and a build that quietly broke
 * there would break the common case.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { available, readImage, readPdf } from '../js/core/ocr.js';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readerFor, canReadText, mayRead, READER } from '../js/domain/filing.js';
import { DocumentStore } from '../js/sync/drive.js';

setSuite('ocr');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const enc = (text) => new TextEncoder().encode(text);

/**
 * A stand-in for `OcrPlugin`, recording what it was asked to read.
 *
 * `lines` is what recognition "finds"; `null` stands for a picture with no
 * text in it, which is a different case from a plugin that is not there.
 */
function fakeOcr({ image = [], pdf = [], throws = false } = {}) {
  const calls = [];
  return {
    calls,
    plugin: (name) => (name === 'Ocr' ? {
      available: async () => ({ available: true, scripts: 'latin' }),
      readImage: async ({ bytes }) => {
        calls.push({ what: 'image', bytes });
        if (throws) throw new Error('the recogniser failed');
        return { pages: image.length ? [{ lines: image }] : [] };
      },
      readPdf: async ({ bytes }) => {
        calls.push({ what: 'pdf', bytes });
        if (throws) throw new Error('the recogniser failed');
        return { pages: pdf.length ? [{ lines: pdf }] : [] };
      },
    } : null),
  };
}

/** A `File` the way a browser hands one to `capture`. */
function fileOf(bytes, name, type) {
  return {
    name,
    type,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength,
    ),
  };
}

describe('whether this build can recognise text', () => {
  test('a browser cannot, and says so rather than throwing', async () => {
    assert.equal(available({ plugin: () => null }), false);
    assert.equal(await readImage(enc('anything'), { plugin: () => null }), null);
    assert.equal(await readPdf(enc('anything'), { plugin: () => null }), null);
  });

  test('a build with the plugin can', () => {
    assert.equal(available({ plugin: fakeOcr().plugin }), true);
  });
});

describe('what comes back', () => {
  test('recognised lines arrive in the shape every other reader returns', async () => {
    const { plugin } = fakeOcr({ image: ['BESCOM Electricity Bill', 'Due Date: 18/10/2026'] });
    const pages = await readImage(enc('a photograph'), { plugin });
    assert.deep(pages, [{ lines: ['BESCOM Electricity Bill', 'Due Date: 18/10/2026'] }]);
  });

  test('a picture with no text in it is nothing, not an empty page', async () => {
    // `[{ lines: [] }]` would flatten to an empty string and be indexed as a
    // document that was read and said nothing — which is not what happened.
    const { plugin } = fakeOcr({ image: [] });
    assert.equal(await readImage(enc('a wall'), { plugin }), null);
  });

  test('blank lines are dropped rather than stored', async () => {
    const { plugin } = fakeOcr({ image: ['  ', 'Total Rs. 1,880.00', ''] });
    assert.deep(await readImage(enc('x'), { plugin }), [{ lines: ['Total Rs. 1,880.00'] }]);
  });

  test('a recogniser that throws is an answer, not a crash', async () => {
    const { plugin } = fakeOcr({ throws: true });
    assert.equal(await readImage(enc('x'), { plugin }), null);
    assert.equal(await readPdf(enc('x'), { plugin }), null);
  });

  /*
   * `String.fromCharCode(...bytes)` spreads one argument per byte. On the
   * two-megabyte photographs this exists for it throws `RangeError: Maximum
   * call stack size exceeded` — and never on the small buffers every other
   * test here uses, which is what makes it worth its own check.
   */
  test('a photograph large enough to blow the argument limit still encodes', async () => {
    const big = new Uint8Array(2 * 1024 * 1024).fill(65);
    const { plugin, calls } = fakeOcr({ image: ['read'] });
    const pages = await readImage(big, { plugin });
    assert.deep(pages, [{ lines: ['read'] }]);
    assert.equal(calls[0].bytes.length > 2_000_000, true, 'the whole image crossed the bridge');
  });
});

describe('which files are recognised, and which are read', () => {
  test('an image is its own kind of readable', () => {
    assert.equal(readerFor('image/jpeg', 'scan.jpg'), READER.IMAGE);
    // Recognising is not reading. A screen has to be able to tell somebody
    // which of the two it is showing them.
    assert.equal(canReadText('image/jpeg', 'scan.jpg'), false);
    assert.equal(mayRead('image/jpeg', 'scan.jpg'), true);
  });

  test('and a format nothing can open is still nothing', () => {
    assert.equal(mayRead('application/msword', 'old.doc'), false);
  });
});

describe('a photograph captured on a build that can recognise it', () => {
  test('is read, and its due date filled in', async () => {
    const db = await makeDb();
    const { plugin } = fakeOcr({
      image: ['BESCOM Electricity Bill', 'Amount Payable: Rs. 2,340.00', 'Due Date: 18/10/2026'],
    });
    const store = new DocumentStore({ db, transport: null, plugin });

    const { document, read } = await store.capture(
      fileOf(enc('jpeg bytes'), 'bill.jpg', 'image/jpeg'), { title: 'bill' },
    );

    assert.equal(read?.kind, 'bill');
    assert.equal(document.expiresOn, '2026-10-18');
    assert.includes(document.ocrText, 'BESCOM');
  });

  test('and on a build that cannot, it is filed unread exactly as before', async () => {
    const db = await makeDb();
    const store = new DocumentStore({ db, transport: null, plugin: () => null });
    const { document, read } = await store.capture(
      fileOf(enc('jpeg bytes'), 'bill.jpg', 'image/jpeg'), { title: 'bill' },
    );
    assert.equal(read, null);
    assert.equal(document.ocrText ?? '', '');
    assert.equal(document.expiresOn ?? '', '');
  });
});

describe('a PDF is recognised only when it has no text of its own', () => {
  /**
   * A PDF with a real text layer, built the way `tests/browser.mjs` builds one.
   * Five objects and a content stream of `Tj` runs.
   */
  function textPdf(lines) {
    const content = `BT /F1 12 Tf 50 750 Td 14 TL\n${
      lines.map((l) => `(${l}) Tj T*`).join('\n')}\nET\n`;
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] '
        + '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${content.length} >>\nstream\n${content}endstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((bodyText, i) => {
      offsets.push(pdf.length);
      pdf += `${i + 1} 0 obj\n${bodyText}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
      + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
      + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new Uint8Array([...pdf].map((c) => c.charCodeAt(0) & 0xff));
  }

  test('a scanned PDF is recognised', async () => {
    const db = await makeDb();
    const { plugin, calls } = fakeOcr({ pdf: ['TATA POWER', 'Due Date: 02/11/2026'] });
    const store = new DocumentStore({ db, transport: null, plugin });

    // A PDF with no content stream at all — pictures of text, to a reader.
    const { document } = await store.capture(
      fileOf(enc('%PDF-1.4\nnothing readable here\n%%EOF\n'), 'scan.pdf', 'application/pdf'),
      { title: 'scan' },
    );

    assert.includes(document.ocrText, 'TATA POWER');
    assert.equal(document.expiresOn, '2026-11-02');
    assert.deep(calls.map((one) => one.what), ['pdf']);
  });

  /*
   * The half that matters most. Text lifted out of a PDF is what the document
   * says; text recognised from a rendering of it is a model's reading of a
   * picture of that. Recognising a PDF that already carries its text would
   * replace an exact answer with a guess — and would do it silently.
   */
  test('but a PDF that carries its own text is never rasterised', async () => {
    const db = await makeDb();
    const { plugin, calls } = fakeOcr({ pdf: ['THIS SHOULD NEVER BE READ'] });
    const store = new DocumentStore({ db, transport: null, plugin });

    const { document } = await store.capture(
      fileOf(textPdf(['BESCOM Electricity Bill', 'Due Date: 18/10/2026']),
        'bill.pdf', 'application/pdf'),
      { title: 'bill' },
    );

    assert.includes(document.ocrText, 'BESCOM');
    assert.equal(/THIS SHOULD NEVER BE READ/.test(document.ocrText), false);
    assert.length(calls, 0, 'the recogniser was asked for a PDF it had no business reading');
  });
});

/**
 * A household in Karnataka photographs a Kannada electricity bill.
 *
 * The bundled model reads Latin script only, so nothing comes back — and the
 * first version of this said *"no text could be recognised in this image, so
 * nothing was filled in from it"*, which reads as **the photograph was poor**.
 * It was not: the picture was fine and the script is not one this build reads.
 * A household would have retaken it, in better light, to the same result.
 */
describe('what a household is told when nothing was recognised', () => {
  test('the sentence names the limit rather than implying a bad photograph', async () => {
    const { textState } = await import('../js/domain/identifiers.js');
    const said = textState({ mimeType: 'image/jpeg', ocrText: '' }, { canRecognise: true }).why;
    assert.includes(said, 'Latin script only');
    assert.includes(said, 'another script');
  });

  test('and so does the one about a scan', async () => {
    const { textState } = await import('../js/domain/identifiers.js');
    const said = textState({ mimeType: 'application/pdf', ocrText: '' }, { canRecognise: true }).why;
    assert.includes(said, 'Latin script only');
  });

  test('but a browser is told about Drive, not about scripts it never tried', async () => {
    // The counterpart. A build with no recogniser has no business explaining
    // which scripts its recogniser reads.
    const { textState } = await import('../js/domain/identifiers.js');
    const said = textState({ mimeType: 'image/jpeg', ocrText: '' }, { canRecognise: false }).why;
    assert.equal(/Latin/.test(said), false);
    assert.includes(said, 'Drive');
  });
});

/**
 * A plugin method the JavaScript never calls.
 *
 * `OcrPlugin` was written with an `available()` returning
 * `{ available: true, scripts: "latin" }`, and nothing invoked it —
 * `core/ocr.js` answers availability from whether Capacitor hands back a
 * proxy, synchronously. It was the defect this repository finds most often,
 * committed while fixing an instance of it, and the `scripts` fact it reported
 * went nowhere for the whole time it existed.
 *
 * Swept rather than remembered, and across all the first-party plugins: the
 * next one written is covered without anybody adding a line here.
 */
describe('every plugin method exists because something calls it', () => {
  test('no first-party plugin declares a method the JavaScript never invokes', async () => {
    const dir = join(ROOT, 'android/app/src/main/java/com/familyos/app');
    const { readdir } = await import('node:fs/promises');
    const files = (await readdir(dir)).filter((one) => one.endsWith('Plugin.java'));

    // The sweep is worth what it read.
    assert.ok(files.length >= 5, `only ${files.length} plugin classes were read`);

    const js = [];
    const walk = async (at) => {
      for (const entry of await readdir(at, { withFileTypes: true })) {
        const full = join(at, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.js')) js.push(await readFile(full, 'utf8'));
      }
    };
    await walk(join(ROOT, 'js'));
    const source = js.join('\n');

    const orphans = [];
    for (const file of files) {
      const java = await readFile(join(dir, file), 'utf8');
      // `@PluginMethod` immediately above `public void name(PluginCall …)`.
      for (const [, name] of java.matchAll(
        /@PluginMethod[\s\S]{0,120}?public\s+void\s+(\w+)\s*\(\s*PluginCall/g)) {
        // Capacitor calls these itself from its permission machinery.
        if (name === 'checkPermissions' || name === 'requestPermissions') continue;
        if (!new RegExp(`\\b${name}\\s*\\(`).test(source)) orphans.push(`${file}#${name}`);
      }
    }
    assert.deep(orphans, []);
  });
});
