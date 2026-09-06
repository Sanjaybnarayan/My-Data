/**
 * Files handed to FamilyOS by another app's share sheet.
 *
 * ## What was measured before this was written
 *
 * `android/app/src/main/AndroidManifest.xml` carried exactly one
 * intent-filter, `MAIN` / `LAUNCHER`. So FamilyOS did not appear in the share
 * sheet at all: a household could not send it a bill from Gmail, a policy from
 * WhatsApp or a scan from Files, and the only way in was the picker on the
 * Documents screen — while `sync/drive.js` could already read a PDF, a Word
 * file, a spreadsheet or a text file and fill in a due date from it.
 *
 * ## This has never run on a phone
 *
 * Stated plainly, as `tests/trail.test.mjs` states it for the location trail
 * and `tests/smsinbox.test.mjs` for the inbox. There is no device and no
 * emulator here. What is driven below is the JavaScript, against a fake
 * plugin: the intent arriving, the URI resolving and the bytes crossing the
 * bridge are asserted by nothing, and `docs/PHASE_STATUS.md` says so on the
 * row rather than in a comment.
 *
 * What that leaves genuinely checked is everything after the bridge — which is
 * where all the judgement lives, deliberately: `ShareTargetPlugin` decides
 * nothing, it resolves a URI to a name, a type and bytes.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { available, take, asFile, UNSUPPORTED } from '../js/core/sharetarget.js';
import { intakeShared, intakeMessage } from '../js/services/intake.js';
import { zip } from '../js/reports/xlsx.js';

setSuite('share target');

const enc = (text) => new TextEncoder().encode(text);

/** Base64 the way the plugin sends it. */
function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

const paragraphs = (...lines) => lines
  .map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');

const billDocx = () => zip([
  { name: '[Content_Types].xml', data: enc('<Types/>') },
  {
    name: 'word/document.xml',
    data: enc(`<w:document><w:body>${paragraphs(
      'BESCOM Electricity Bill',
      'Amount Payable: Rs. 2,340.00',
      'Due Date: 18/10/2026',
    )}</w:body></w:document>`),
  },
]);

/** A stand-in for `ShareTargetPlugin`, holding one share until it is taken. */
function fakePlugin(files, { throws = false } = {}) {
  let held = files;
  const calls = [];
  return {
    calls,
    plugin: (name) => (name === 'ShareTarget' ? {
      take: async () => {
        calls.push('take');
        if (throws) throw new Error('the provider closed the stream');
        const out = held;
        // Drained, not peeked. The real plugin clears its pending intent.
        held = [];
        return { files: out };
      },
    } : null),
  };
}

describe('whether this build can be shared to', () => {
  test('a browser cannot, and says so rather than throwing', async () => {
    assert.equal(available({ plugin: () => null }), false);
    const nothing = await take({ plugin: () => null });
    assert.equal(nothing.ok, false);
    assert.equal(nothing.why, UNSUPPORTED);
    assert.length(nothing.files, 0);
  });

  test('an Android build with the plugin can', () => {
    const { plugin } = fakePlugin([]);
    assert.equal(available({ plugin }), true);
  });
});

describe('what crosses the bridge', () => {
  test('base64 becomes the same bytes that went in', async () => {
    const bytes = enc('BESCOM Rs. 2,340.00');
    const file = asFile({ name: 'bill.txt', type: 'text/plain', bytes: base64(bytes) });
    assert.equal(file.size, bytes.length);
    assert.equal(new TextDecoder().decode(new Uint8Array(await file.arrayBuffer())),
      'BESCOM Rs. 2,340.00');
  });

  test('a declared type of nothing is kept as nothing, not invented', async () => {
    // `domain/filing.js#readerFor` falls back to the file name for exactly
    // this case, and can only do that if the empty type reaches it.
    const file = asFile({ name: 'bill.docx', type: '', bytes: base64(enc('x')) });
    assert.equal(file.type, '');
    assert.equal(file.name, 'bill.docx');
  });

  test('a file with no name at all still has one', () => {
    assert.equal(asFile({ bytes: base64(enc('x')) }).name, 'shared');
  });

  test('a share is drained, so the same file is not filed twice', async () => {
    const { plugin, calls } = fakePlugin([
      { name: 'a.txt', type: 'text/plain', bytes: base64(enc('hello there')), tooLarge: false },
    ]);
    assert.length((await take({ plugin })).files, 1);
    assert.length((await take({ plugin })).files, 0);
    assert.deep(calls, ['take', 'take']);
  });

  test('a file the plugin refused for size is reported, not dropped', async () => {
    const { plugin } = fakePlugin([
      { name: 'huge.pdf', type: 'application/pdf', size: 40_000_000, tooLarge: true },
    ]);
    const shared = await take({ plugin });
    assert.length(shared.files, 0);
    assert.length(shared.tooLarge, 1);
    assert.equal(shared.tooLarge[0].name, 'huge.pdf');
  });

  test('and a plugin that throws is an answer, not a crash', async () => {
    const { plugin } = fakePlugin([], { throws: true });
    const shared = await take({ plugin });
    assert.equal(shared.ok, false);
    assert.includes(shared.why, 'closed the stream');
  });
});

describe('what happens to a file somebody shared', () => {
  test('a shared Word bill is filed with its due date already in', async () => {
    const db = await makeDb();
    const { plugin } = fakePlugin([{
      name: 'bescom-bill.docx',
      // The share-sheet case: the sending app declared nothing useful.
      type: 'application/octet-stream',
      bytes: base64(billDocx()),
      tooLarge: false,
    }]);

    const outcome = await intakeShared(db, { plugin });
    assert.length(outcome.filed, 1);
    assert.equal(outcome.filed[0].expiresOn, '2026-10-18');
    assert.includes(outcome.filed[0].ocrText, 'BESCOM');
    assert.length(outcome.unread, 0);
  });

  test('the document is really in the database, not just in the answer', async () => {
    const db = await makeDb();
    const { plugin } = fakePlugin([{
      name: 'bescom-bill.docx', type: '', bytes: base64(billDocx()), tooLarge: false,
    }]);
    await intakeShared(db, { plugin });

    const rows = await db.repo('document').list({ limit: 10 });
    assert.length(rows, 1);
    assert.equal(rows[0].title, 'bescom-bill');
    assert.equal(rows[0].expiresOn, '2026-10-18');
  });

  test('a shared photograph is filed, and named as one nothing could read', async () => {
    const db = await makeDb();
    const { plugin } = fakePlugin([{
      name: 'scan.jpg', type: 'image/jpeg', bytes: base64(enc('not really a jpeg')),
      tooLarge: false,
    }]);
    const outcome = await intakeShared(db, { plugin });

    assert.length(outcome.filed, 1, 'the file is kept — it is still a document');
    assert.length(outcome.unread, 1, 'and the household is told nothing was read from it');
    assert.equal(outcome.filed[0].expiresOn ?? '', '');
  });

  test('several files at once are all filed', async () => {
    const db = await makeDb();
    const { plugin } = fakePlugin([
      { name: 'one.docx', type: '', bytes: base64(billDocx()), tooLarge: false },
      { name: 'two.txt', type: 'text/plain', bytes: base64(enc('TATA POWER\nDue Date: 02/11/2026')), tooLarge: false },
      { name: 'three.jpg', type: 'image/jpeg', bytes: base64(enc('picture')), tooLarge: false },
    ]);
    const outcome = await intakeShared(db, { plugin });
    assert.length(outcome.filed, 3);
    assert.length(outcome.unread, 1);
  });

  /*
   * A share carries no folder. Filing it under whoever was last looked at
   * would invent an owner for a document nobody assigned one to, and the
   * Documents screen files an unassigned document under Household.
   */
  test('and none of them is filed under a person', async () => {
    const db = await makeDb();
    const { plugin } = fakePlugin([{
      name: 'bill.docx', type: '', bytes: base64(billDocx()), tooLarge: false,
    }]);
    const outcome = await intakeShared(db, { plugin });
    assert.equal(outcome.filed[0].person ?? '', '');
  });

  test('a browser is not an error, just nothing to collect', async () => {
    const db = await makeDb();
    const outcome = await intakeShared(db, { plugin: () => null });
    assert.length(outcome.filed, 0);
    assert.equal(outcome.why, 'unsupported');
  });
});

describe('what somebody is told', () => {
  test('nothing shared says nothing at all', () => {
    assert.equal(intakeMessage({}), null);
    assert.equal(intakeMessage({ filed: [], tooLarge: [], unread: [], failed: [] }), null);
  });

  test('one document filed says one', () => {
    assert.equal(intakeMessage({ filed: [{}] }), '1 document filed');
    assert.equal(intakeMessage({ filed: [{}, {}] }), '2 documents filed');
  });

  test('a single unreadable file says so about that file', () => {
    assert.equal(intakeMessage({ filed: [{}], unread: [{}] }),
      '1 document filed · nothing could be read from it');
  });

  test('and several say how many, rather than claiming it about all of them', () => {
    // "nothing could be read from it" over three documents would be false
    // about the two that were read.
    assert.equal(intakeMessage({ filed: [{}, {}, {}], unread: [{}] }),
      '3 documents filed · 1 could not be read');
  });

  test('a file too large to carry is said out loud', () => {
    assert.equal(intakeMessage({ tooLarge: [{}] }), '1 too large to share');
  });

  test('and one that could not be saved is not hidden behind the ones that were', () => {
    assert.equal(intakeMessage({ filed: [{}], failed: [{}] }),
      '1 document filed · 1 could not be saved');
  });
});
