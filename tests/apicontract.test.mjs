import { test, describe, assert, setSuite } from './harness.mjs';
import { served, called, drift, reads, sends, fieldDrift, objectKeys, problems } from '../tools/api-contract.mjs';

setSuite('the backend contract');

describe('what each side knows about the other', () => {
  test('every action the application calls is one the backend serves', () => {
    // The failure this prevents is not subtle: the client and the Apps Script
    // backend deploy separately, so a call the deployed backend has never heard
    // of comes back as `unknown action` and a 400, once, in a household's face.
    const { unserved } = drift();
    assert.length(unserved, 0,
      `called but not served: ${unserved.join(', ')}`);
  });

  test('and every action the backend serves is one something calls', () => {
    // The other direction is dead weight rather than a failure, but a backend
    // growing endpoints nobody uses is how a surface stops being reviewable.
    const { uncalled } = drift();
    assert.length(uncalled, 0,
      `served but never called: ${uncalled.join(', ')}`);
  });

  test('the backend really does serve a list, not an empty one', () => {
    // If the dispatch function were renamed, `served()` would return nothing
    // and both checks above would pass vacuously — every call would be
    // "unserved" only if the client list were also empty. This is what stops
    // the pair of them agreeing about nothing.
    assert.ok(served().length > 10, `only ${served().length} actions parsed from Code.gs`);
    assert.includes(served(), 'push');
    assert.includes(served(), 'pull');
  });

  test('and the application really does call them', () => {
    const client = called();
    assert.ok(client.size > 10, `only ${client.size} actions found in the client`);
    assert.ok(client.get('push')?.size > 0, 'nothing was found calling push');
  });

  test('drift is reported in both directions when it exists', () => {
    // Produced on purpose, because a check that cannot fail is worse than none.
    const fake = new Map([['push', new Set(['js/sync/engine.js'])],
      ['invented', new Set(['js/sync/engine.js'])]]);
    const both = drift(['push', 'forgotten'], fake);

    assert.deep(both.unserved, ['invented']);
    assert.deep(both.uncalled, ['forgotten']);
  });
});

/**
 * The payload fields, which this tool said for a long time it did not check.
 *
 * Its own header carried the reason: *"a payload that has grown a field fails
 * somewhere further in, and pretending otherwise would be the overclaiming this
 * codebase spends its time avoiding."* Honest about what it did, and wrong
 * about what it could do — both sides' field names are as derivable as the
 * action names already were.
 */
describe('the fields inside the payloads, not only the action names', () => {
  test('the two sides agree about every field, both directions', () => {
    assert.deep(fieldDrift(), [],
      'the application and the backend disagree about a payload field');
  });

  test('the command CI runs consults the field check, not only the action names', () => {
    /*
     * The gap the ratchet found in this file's first version. Every check here
     * called `fieldDrift` directly, so deleting it from the list the CLI
     * assembles broke nothing — the tool would have gone back to checking
     * action names while the tests went on proving a function nobody called.
     */
    const backend = ['pull'];
    const client = new Map([['pull', new Set(['js/sync/transport.js'])]]);
    const backendReads = new Map([['pull', new Set(['cursors', 'limit'])]]);
    const payloads = { fields: new Map([['pull', new Set(['cursors'])]]), unreadable: new Set() };

    assert.deep(problems(backend, client, backendReads, payloads),
      ["'pull' reads 'limit', which the application never sends"]);
  });

  test('and a field on one side only is reported', () => {
    // Produced on purpose. A check that cannot fail is worse than none, and
    // this one guards a comparison that would otherwise be silently vacuous.
    const backend = new Map([['pull', new Set(['cursors', 'limit'])]]);

    const grew = { fields: new Map([['pull', new Set(['cursors', 'limit', 'since'])]]), unreadable: new Set() };
    assert.deep(fieldDrift(backend, grew),
      ["'pull' sends 'since', which the backend never reads"]);

    const shrank = { fields: new Map([['pull', new Set(['cursors'])]]), unreadable: new Set() };
    assert.deep(fieldDrift(backend, shrank),
      ["'pull' reads 'limit', which the application never sends"]);
  });

  test('an action whose payload cannot be read is skipped, not called drift', () => {
    /*
     * `transport.js` has `upload(file) { return this.call('upload', file); }` —
     * a variable, not a literal. Reading that as "sends nothing" would report
     * every field the backend reads as missing, which is a tool crying wolf
     * about code that is correct. The mutation ratchet learned the same lesson
     * from a typo'd suite name: what you cannot measure, you must not score.
     */
    const backend = new Map([['upload', new Set(['content', 'documentId'])]]);
    const blind = { fields: new Map([['upload', new Set()]]), unreadable: new Set(['upload']) };
    assert.deep(fieldDrift(backend, blind), []);

    // And it is genuinely unreadable in this repository, not hypothetically.
    assert.ok(sends().unreadable.has('upload'),
      'upload is no longer built from a variable — this check has gone stale');
  });

  test('the backend reads are taken from the handler, not from every payload in the file', () => {
    /*
     * `push` hands `payload.changes` to `sheetPush`, and `sheetPush` reads
     * `payload.x` off each *change* — a different payload entirely. Following
     * the handler there reported `_origin` as a field the application fails to
     * send. Only a case that passes the whole payload is followed.
     */
    const perAction = reads();
    assert.deep([...perAction.get('push')].sort(), ['changes']);
    assert.ok([...perAction.get('upload')].includes('ocr'),
      'upload should pick up driveUpload\'s reads, which do include ocr');
  });

  test('object keys are read at a token boundary and never after a dot', () => {
    // `{ op: 'enrol', personId }` yielded `ersonId` when this advanced by hand,
    // and `key: wrapped.key` must contribute `key` once, not `key` twice.
    assert.deep(objectKeys("{ op: 'enrol', personId }", 0), ['op', 'personId']);
    assert.deep(objectKeys('{ key: wrapped.key }', 0), ['key']);
    assert.equal(objectKeys('file)', 0), null, 'a variable is not an object literal');
  });
});
