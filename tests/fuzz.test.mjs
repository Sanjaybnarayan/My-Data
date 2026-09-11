/**
 * Hostile input through the real `doPost`.
 *
 * Phase 12 of the brief asks for security testing, and
 * `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` records it as partial for a reason
 * worth keeping: everything here is static. There is no deployed instance to
 * point a scanner at, no device, and no penetration test — **this file does
 * not change that**, and calling it one would be the security theatre the
 * brief forbids.
 *
 * What it is: the one dynamic thing actually in reach. `tests/appsscript.mjs`
 * loads the deployed `.gs` files character-for-character and drives them
 * through `doPost`, so a malformed body can be pushed through the real entry
 * point rather than through a description of it. That is a genuine test of
 * input handling, and it found a genuine bug on its first run.
 *
 * **The bug, because it is the argument for this file existing.** A request
 * body of the four bytes `null` parses successfully — `JSON.parse('null')`
 * returns `null` — so the parse guard never fired, and reading `.token` off it
 * threw a TypeError into the outer catch, which cannot tell a bug from a bad
 * request. An unauthenticated stranger got back:
 *
 *     {"ok":false,"error":"Cannot read properties of null (reading 'token')",
 *      "status":500,"retryable":true}
 *
 * A V8 internal message, a 500 claiming the deployment broke, and a retryable
 * flag that would have a client's outbox resend a permanently invalid request.
 * Nothing in 3400 checks had ever sent a body that was not an object.
 *
 * The shape of every assertion below is the same: **a malformed request must
 * be refused as malformed** — a 4xx the caller can act on, never a 5xx, never
 * an unhandled throw, and never an internal message.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { backend } from './appsscript.mjs';
// The action list, derived from the backend's own dispatch rather than
// written out here — see the sweep at the foot of this file.
import { served } from '../tools/api-contract.mjs';

setSuite('fuzz');

const OWNER = 'owner@example.com';
const tokens = {
  'owner-token': { email: OWNER, aud: 'client-id', expires_in: '3599' },
};

const start = () => backend({ owner: OWNER, tokens });

/** Push a raw body through `doPost` and read the reply, whatever happened. */
function post(api, contents) {
  const out = api.doPost({ postData: { contents } });
  return JSON.parse(out.getContent());
}

/**
 * Bodies that are valid JSON and are not requests.
 *
 * JSON's top level may be a string, a number, a boolean, an array or null.
 * Exactly one of those shapes is a request, and the other five reached code
 * that assumed otherwise.
 */
const NOT_OBJECTS = [
  ['null', 'null'],
  ['a bare string', '"hello"'],
  ['a number', '42'],
  ['a boolean', 'true'],
  ['an array', '[1,2,3]'],
  ['an array of objects', '[{"action":"ping"}]'],
];

describe('a body that is not a request object', () => {
  for (const [what, body] of NOT_OBJECTS) {
    test(`${what} is refused as malformed, not as a server fault`, () => {
      const said = post(start(), body);

      assert.equal(said.ok, false, `${what} was accepted`);
      assert.not(said.retryable,
        `${what} was marked retryable, so a client would resend it forever`);

      /*
       * 400 exactly, not merely "some 4xx", and the tightening is worth the
       * note. The first version of this asserted `>= 400 && < 500`, and a
       * mutation that weakened the guard to `if (!request)` survived it: an
       * array or a number then falls through to `verifyToken(undefined)` and
       * comes back 401 *no access token was supplied* — which is 4xx, not
       * retryable, and a lie. The body was the problem, not the token, and a
       * caller told to look at their token will look in the wrong place.
       */
      assert.equal(said.status, 400,
        `${what} answered ${said.status}: ${said.error}`);
      assert.includes(said.error, 'was not a JSON object',
        `${what} was refused for the wrong reason`);
    });
  }

  test('and the reason never quotes the runtime', () => {
    /*
     * The disclosure half, kept separate because it can regress on its own:
     * a future refactor could restore a 500 without the message, or the
     * message without the 500, and each is worth failing for.
     *
     * Matched against the shapes a JavaScript engine produces rather than
     * against one literal, so the check does not depend on V8's exact wording.
     */
    const runtime = /Cannot read propert|undefined is not|is not a function|TypeError|at Object\./;
    for (const [what, body] of NOT_OBJECTS) {
      const said = post(start(), body);
      assert.not(runtime.test(String(said.error)),
        `${what} leaked an internal message: ${said.error}`);
    }
  });
});

describe('a body that is not JSON at all', () => {
  for (const [what, body] of [
    ['empty', ''],
    ['a fragment', '{"action":'],
    ['plain text', 'hello'],
  ]) {
    test(`${what} is a 400 with a reason worth reading`, () => {
      const said = post(start(), body);
      assert.equal(said.status, 400, what);
      assert.includes(said.error, 'was not JSON');
    });
  }

  test('and a request with no body at all does not throw', () => {
    // `e.postData` is undefined, so the parse itself throws before any field
    // is read. Worth its own case because it takes a different branch from
    // every body above.
    const said = JSON.parse(start().doPost({}).getContent());
    assert.equal(said.status, 400);
  });
});

describe('fields of the wrong type', () => {
  const send = (patch) => post(start(),
    JSON.stringify({ action: 'ping', token: 'owner-token', ...patch }));

  test('an action that is not a string is an unknown action, not a crash', () => {
    for (const action of [{}, [], 42, null, true]) {
      const said = send({ action });
      assert.equal(said.ok, false, `action ${JSON.stringify(action)} was accepted`);
      assert.ok(said.status >= 400 && said.status < 500,
        `action ${JSON.stringify(action)} answered ${said.status}`);
    }
  });

  test('a token that is not a string is refused, and not by throwing', () => {
    for (const token of [{}, [], 42, true]) {
      const said = send({ token });
      assert.equal(said.ok, false, `token ${JSON.stringify(token)} was accepted`);
      assert.equal(said.status, 401, `token ${JSON.stringify(token)} answered ${said.status}`);
    }
  });

  test('a payload that is not an object does not reach a field read', () => {
    for (const payload of ['nope', 42, [], null]) {
      const said = send({ payload });
      assert.not(said.status >= 500, `payload ${JSON.stringify(payload)} answered ${said.status}`);
    }
  });
});

describe('input that is merely enormous', () => {
  test('an unknown action is not echoed back at whatever length it arrived', () => {
    /*
     * It was. A 100,000-character action came back in the error message in
     * full, and went to `log` at that length as well — a small amplification
     * and a cheap way to flood a deployment's own diagnostics with
     * attacker-chosen text. Bounded to forty characters, which is enough to
     * see which action was meant.
     */
    const said = post(start(),
      JSON.stringify({ action: 'x'.repeat(100_000), token: 'owner-token' }));

    assert.equal(said.status, 400);
    assert.ok(said.error.length < 200,
      `the error echoed ${said.error.length} characters of attacker input`);
  });

  test('a deeply nested payload is not a stack overflow', () => {
    // `ping` does not read the payload, so this proves the *plumbing* survives
    // a shape designed to blow a recursive walk — not that every handler does.
    let root = {};
    let leaf = root;
    for (let i = 0; i < 2000; i += 1) { leaf.n = {}; leaf = leaf.n; }

    const said = post(start(),
      JSON.stringify({ action: 'ping', token: 'owner-token', payload: root }));
    assert.ok(said.ok, said.error);
  });
});

describe('a body that tries to reach the prototype', () => {
  test('does not pollute Object.prototype', () => {
    /*
     * Passing today rather than fixed today: `JSON.parse` gives `__proto__` as
     * an ordinary own property, and nothing here deep-merges a payload into an
     * existing object, which is the operation that would turn it into
     * pollution. Written down because "we do not merge" is a property that a
     * later convenience function could quietly take away.
     */
    const said = post(start(),
      '{"__proto__":{"polluted":true},"action":"ping","token":"owner-token"}');

    assert.ok(said.ok, said.error);
    assert.equal(/** @type {any} */ ({}).polluted, undefined,
      'Object.prototype was polluted by a request body');
  });
});

describe('the pre-auth path, which is the only code a stranger reaches', () => {
  /*
   * `otp.request` and `otp.verify` run before `verifyToken` — they have to,
   * because a code is what somebody asks for when they cannot yet sign in.
   * That makes them the whole of the unauthenticated attack surface, so
   * hostile input goes through them rather than only through the front door.
   *
   * Nothing here is a bug found. It is the opposite: `otpRequest` answers
   * identically whether or not an address is known, deliberately, so that the
   * endpoint cannot be asked which addresses belong to the household one guess
   * at a time. That property survives being fed rubbish, and this is what says
   * so — because it is a property a later "helpful" error message would take
   * away without anybody noticing.
   */
  /*
   * A directory with somebody real in it, and that detail is the whole test.
   *
   * The first version of this seeded nothing and compared a hostile address
   * against `nobody@example.com` — two addresses that are *both* unknown. A
   * mutation adding `if (!person) throw fail('no such address…', 404)` — a
   * textbook enumeration oracle — answered both identically and **passed**.
   * The check looked like an anti-enumeration test and measured nothing.
   *
   * The property is known versus unknown, so the directory has to have a known
   * one in it.
   */
  const KNOWN = 'asha@example.com';
  const DIRECTORY = JSON.stringify([
    { personId: 'p-asha', name: 'Asha', email: KNOWN },
  ]);

  const publicApi = () => backend({
    owner: OWNER,
    tokens,
    properties: { otpDirectory: DIRECTORY },
    files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Otp.gs'],
  });

  const request = (api, payload) => post(api,
    JSON.stringify({ action: 'otp.request', payload }));

  test('a known address and an unknown one are answered identically', () => {
    // The anti-enumeration property itself. Saying "no such person" would turn
    // this endpoint into a way to ask which addresses belong to the household,
    // one guess at a time — and the rate limit is charged either way, so
    // guessing is slow as well as uninformative.
    const known = request(publicApi(), { address: KNOWN });
    const unknown = request(publicApi(), { address: 'nobody@example.com' });

    assert.ok(known.ok, known.error);
    assert.deep(unknown, known,
      'an unknown address is distinguishable from a known one');
  });

  test('and a hostile address is answered the same way too', () => {
    const known = request(publicApi(), { address: KNOWN });

    for (const [what, address] of [
      ['an object', {}],
      ['fifty thousand characters', 'a'.repeat(50_000)],
    ]) {
      const said = request(publicApi(), { address });
      assert.deep(said, known,
        `${what} produced a different answer from a known address`);
    }
  });

  test('a code sent to a known address is never in the reply', () => {
    // The rule the brief states twice: never return the OTP. Asserted against
    // the whole serialised response rather than a named field, so a code that
    // arrived somewhere unexpected is still caught.
    const said = request(publicApi(), { address: KNOWN });
    assert.not(/\b\d{6}\b/.test(JSON.stringify(said)),
      `a six-digit code appeared in the reply: ${JSON.stringify(said)}`);
  });

  test('an address that is missing or empty is refused, and says so', () => {
    for (const payload of [undefined, null, {}, { address: null }, { address: [] }]) {
      const said = request(publicApi(), payload);
      assert.equal(said.ok, false, `payload ${JSON.stringify(payload)} was accepted`);
      assert.equal(said.status, 400);
    }
  });

  test('a code of the wrong type never reaches the comparison as a match', () => {
    for (const code of [{}, [], null, true, 0]) {
      const said = post(publicApi(), JSON.stringify({
        action: 'otp.verify', payload: { address: 'nobody@example.com', code },
      }));
      assert.equal(said.ok, false, `code ${JSON.stringify(code)} was accepted`);
      assert.ok(said.status === 400 || said.status === 401,
        `code ${JSON.stringify(code)} answered ${said.status}`);
      assert.not(said.retryable, `code ${JSON.stringify(code)} was marked retryable`);
    }
  });

  test('and no pre-auth refusal ever quotes the runtime', () => {
    const runtime = /Cannot read propert|undefined is not|is not a function|TypeError/;
    for (const action of ['otp.request', 'otp.verify']) {
      for (const payload of [null, 'string', 42, [], { address: {} }, { code: {} }]) {
        const said = post(publicApi(), JSON.stringify({ action, payload }));
        assert.not(runtime.test(String(said.error ?? '')),
          `${action} with ${JSON.stringify(payload)} leaked: ${said.error}`);
      }
    }
  });
});

/**
 * The other half, and the file said so before it existed.
 *
 * Everything above drives the front door — `doPost`'s parsing and dispatch —
 * and one payload check that the block itself qualifies: *"`ping` does not
 * read the payload, so this proves the **plumbing** survives a shape designed
 * to blow a recursive walk — not that every handler does."*
 *
 * It did not. Three of them read a list straight out of the payload and walked
 * it taking fields off each element, having never asked whether it was a list
 * or whether the elements were objects. `{"action":"push","payload":
 * {"changes":[null]}}` from an ordinary household member reproduced, one level
 * in, all three faults the `null`-body finding above names: a V8 internal
 * message handed back, a 500 saying the deployment had broken when the request
 * was malformed, and `retryable: true`, so the sender's outbox would resend a
 * permanently invalid request.
 *
 * `{"length":3}` reached the same place by a different door — an array-like
 * object passes a `.length` test and hands back `undefined` at every index —
 * which is why `requestList` tests `Array.isArray` rather than truthiness.
 *
 * Found by sweeping every authenticated action against a battery of malformed
 * payloads, the same way the `null` body was found. Seven of 288 were
 * mishandled, across `schema`, `push` and `audit`; the rest of the surface
 * held.
 */
describe('hostile payloads through the authenticated actions', () => {
  const HEADERS = ['_id', '_rev', '_updatedAt', '_deletedAt', 'name'];

  /** A workbook that records what reached it, and grows tabs like the real one. */
  const book = () => {
    const appended = [];
    const written = [];
    const make = (name) => ({
      getName: () => name,
      getLastRow: () => 1,
      getLastColumn: () => HEADERS.length,
      getMaxRows: () => 100,
      setFrozenRows: () => {},
      getRange: () => ({
        getValues: () => [HEADERS],
        setValues: (rows) => written.push({ sheet: name, rows }),
        setValue: () => {},
        setFontWeight: () => {},
        setNumberFormat: () => {},
      }),
      appendRow: (row) => appended.push({ sheet: name, row }),
    });
    const tabs = new Map([['Accounts', make('Accounts')]]);
    return {
      appended,
      written,
      getSheets: () => [...tabs.values()],
      getSheetByName: (name) => tabs.get(String(name)) || null,
      insertSheet: (name) => {
        const made = make(String(name));
        tabs.set(String(name), made);
        return made;
      },
    };
  };

  const household = () => {
    const workbook = book();
    return {
      workbook,
      api: backend({
        owner: OWNER,
        tokens,
        workbook,
        files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Sheets.gs'],
        properties: {
          members: JSON.stringify([{ email: OWNER, role: 'owner', personId: 'p1' }]),
          workbookId: 'book-1',
          sheetMap: JSON.stringify({ account: 'Accounts' }),
          ownerPersonId: 'p1',
        },
      }),
    };
  };

  const send = (api, action, payload) => post(api,
    JSON.stringify({ action, token: 'owner-token', payload, deviceId: 'device-1' }));

  /** The list each write action takes, and the field it arrives under. */
  const LISTS = [
    ['schema', 'manifest'],
    ['push', 'changes'],
    ['audit', 'entries'],
  ];

  /*
   * Shapes that are not a list of records. `{length: n}` is the one worth
   * keeping separate: it is what defeats a `.length` guard, and a `.length`
   * guard is what all three of these had.
   */
  const NOT_LISTS = [
    ['a string', 'nope'],
    ['a number', 42],
    ['a boolean', true],
    ['an object', { a: 1 }],
    ['an array-like object', { length: 3 }],
  ];

  const NOT_RECORDS = [
    ['null', null],
    ['a string', 'nope'],
    ['a number', 42],
    ['a list', []],
  ];

  const RUNTIME = /Cannot read propert|Cannot convert|undefined is not|is not a function|is not iterable|TypeError|RangeError|Maximum call stack/;

  test('a list field that is not a list is refused as malformed', () => {
    for (const [action, field] of LISTS) {
      for (const [what, value] of NOT_LISTS) {
        const said = send(household().api, action, { [field]: value });
        assert.equal(said.ok, false, `${action} accepted ${field} as ${what}`);
        assert.ok(said.status >= 400 && said.status < 500,
          `${action} answered ${said.status} for ${field} as ${what}`);
        assert.not(said.retryable,
          `${action} told the outbox to resend ${field} as ${what}`);
      }
    }
  });

  test('and no refusal quotes the runtime back at the caller', () => {
    for (const [action, field] of LISTS) {
      for (const [what, value] of [...NOT_LISTS, ...NOT_RECORDS.map(
        ([label, one]) => [`a list holding ${label}`, [one]])]) {
        const said = send(household().api, action, { [field]: value });
        assert.not(RUNTIME.test(String(said.error ?? '')),
          `${action} leaked for ${field} as ${what}: ${said.error}`);
      }
    }
  });

  /*
   * The one place the answer is *not* a refusal of the batch, and it is
   * `sheetPush`'s own rule rather than a new one: "one change a child may not
   * make should not throw away the fourteen they may." A change that is not an
   * object is unusable for the same reason an unauthorised one is, so it goes
   * down the same channel — `rejected`, beside the ones that applied.
   */
  test('a malformed change is rejected as a row, and its neighbours still apply', () => {
    const { api } = household();
    const said = send(api, 'push', {
      changes: [
        null,
        { store: 'account', op: 'put', recordId: 'a1', rev: 1, payload: { id: 'a1', name: 'Savings' } },
        'not an object',
      ],
    });

    assert.ok(said.ok, said.error);
    assert.equal(said.data.applied.length, 1, 'the good change did not apply');
    assert.equal(said.data.rejected.length, 2,
      `expected two rejections, got ${JSON.stringify(said.data.rejected)}`);
  });

  /*
   * Audit goes the other way, deliberately. Filtering a malformed entry out
   * would leave a hole in an append-only record with nothing saying an entry
   * was ever there — so the batch is refused and the client keeps it.
   */
  test('a malformed audit entry refuses the batch and writes nothing', () => {
    const { api, workbook } = household();
    const said = send(api, 'audit', {
      entries: [{ at: '2026-09-01T00:00:00Z', action: 'read' }, null],
    });

    assert.equal(said.ok, false, 'a batch with a malformed entry was accepted');
    assert.equal(said.status, 400);
    // Named, not counted: a refusal still creates the deployment's own `_Log`
    // tab, and asserting "nothing was written anywhere" fails on that instead
    // of on the thing at stake.
    assert.not(workbook.written.some((one) => one.sheet === '_Audit'),
      'a refused audit batch still wrote to the audit log');
    assert.not(workbook.getSheetByName('_Audit'),
      'a refused audit batch created the audit log');
  });

  test('a whole batch of good audit entries is still appended', () => {
    // The other side of the check above: a guard that refused everything would
    // satisfy it, and would take the audit log with it.
    const { api, workbook } = household();
    const said = send(api, 'audit', {
      entries: [{ at: '2026-09-01T00:00:00Z', action: 'read', entity: 'account' }],
    });

    assert.ok(said.ok, said.error);
    assert.equal(said.data.appended, 1);
    assert.ok(workbook.written.length > 0, 'nothing reached the sheet');
  });

  test('a schema manifest entry that is not an object is a 400, not a 500', () => {
    const said = send(household().api, 'schema', { manifest: [null] });
    assert.equal(said.ok, false);
    assert.equal(said.status, 400);
  });

  test('and a manifest of real specs still creates the tab', () => {
    const { api, workbook } = household();
    const said = send(api, 'schema', {
      manifest: [{ entity: 'vehicle', sheet: 'Vehicles', version: 1, columns: ['plate'] }],
    });

    assert.ok(said.ok, said.error);
    assert.deep(said.data.created, ['Vehicles']);
    assert.ok(workbook.getSheetByName('Vehicles'), 'the tab was not created');
  });
});

/**
 * Every action the backend serves, swept with hostile payloads.
 *
 * ## Why this exists rather than the prose that used to stand for it
 *
 * `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` records the sweep that found
 * LIST-01: *"Twelve authenticated actions were driven with 24 malformed
 * payloads each. Seven of 288 were mishandled and they are all above; `pull`,
 * `upload`, `download`, `trash`, `signin`, `members`, `devices` and `verify`
 * held against every one."*
 *
 * The seven faults were fixed and are checked above. **The sweep itself was
 * not kept.** So the negative result — eight actions holding against every
 * hostile shape — became a sentence in a document, measured once, by hand,
 * with nothing holding it since. `tools/secrets.mjs` names that habit in its
 * own header as the shape this repository has found more often than any
 * other, and this is an instance of it inside the very audit that says so.
 *
 * ## Derived, not listed
 *
 * The action list comes from `served()` — the same function
 * `tools/api-contract.mjs` uses to read the backend's `dispatch`. A
 * hand-written list here would be the tenth in this repository to drift from a
 * derivable one, and it would drift in the direction that matters: a new
 * action is exactly the one nobody remembers to sweep.
 *
 * ## What it asserts
 *
 * The invariant this file already states at the top: **a malformed request
 * must be refused as malformed.** Never a 5xx, which claims the deployment
 * broke when the request was at fault; never a runtime message quoted back at
 * the caller; and never `retryable` on a 4xx, which has the sender's outbox
 * repeat a permanently invalid request until it gives up.
 *
 * Succeeding is allowed. Several of these actions take no payload at all, and
 * ignoring a payload that makes no sense is a perfectly good answer — the
 * claim here is about how a refusal is made, not that one must be.
 *
 * ## The fixture gaps this cost
 *
 * That same audit paragraph ends: *"Three apparent failures were my fixture,
 * not the code — an incomplete `DriveApp`, an absent `ScriptApp`, and a
 * workbook stub that did not register the tab it had just inserted."* Both
 * named gaps were still there. Running this found a third, `setProperties`,
 * the same way. All three are stubs now rather than caveats, because a gap
 * named in prose and left in place is one the next sweep pays for again.
 */
describe('every action the backend serves, against payloads that make no sense', () => {
  const HOSTILE = [
    ['null', null],
    ['a string', 'nope'],
    ['a number', 42],
    ['a boolean', true],
    ['a list', []],
    ['an empty object', {}],
    ['a list of nulls', [null, null]],
    ['an array-like object', { length: 3 }],
    // Not an injection attempt so much as the shape a half-written outbox
    // entry has: keys the handler knows, values it does not expect.
    ['known keys holding nothing', { changes: null, entries: null, manifest: null, fileId: null }],
  ];

  const OWNER_EMAIL = 'owner@example.com';
  const HEADS = ['_id', '_rev', '_updatedAt', '_deletedAt'];

  /** A workbook that registers the tab it inserts — the audit's third gap. */
  const workbookStub = () => {
    const tabs = new Map();
    const make = (name) => ({
      getName: () => name,
      getLastRow: () => 1,
      getLastColumn: () => HEADS.length,
      getMaxRows: () => 100,
      setFrozenRows: () => {},
      getRange: () => ({
        getValues: () => [HEADS],
        setValues: () => {},
        setValue: () => {},
        setFontWeight: () => {},
        setNumberFormat: () => {},
      }),
      appendRow: () => {},
    });
    tabs.set('Accounts', make('Accounts'));
    return {
      getSheets: () => [...tabs.values()],
      getSheetByName: (name) => tabs.get(String(name)) || null,
      insertSheet: (name) => {
        const made = make(String(name));
        tabs.set(String(name), made);
        return made;
      },
    };
  };

  /** A fresh backend per request: a sweep must not let one call poison the next. */
  const drive = () => backend({
    owner: OWNER_EMAIL,
    tokens,
    workbook: workbookStub(),
    files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Sheets.gs', 'Gmail.gs', 'Otp.gs'],
    properties: {
      members: JSON.stringify([{ email: OWNER_EMAIL, role: 'owner', personId: 'p1' }]),
      workbookId: 'book-1',
      sheetMap: JSON.stringify({ account: 'Accounts' }),
    },
  });

  const send = (api, action, payload) => post(api,
    JSON.stringify({ action, token: 'owner-token', payload, deviceId: 'device-1' }));

  const RUNTIME = /Cannot read propert|Cannot convert|undefined is not|is not a function|is not iterable|TypeError|RangeError|Maximum call stack/;

  test('answers a client error, never a server one', () => {
    for (const action of served()) {
      for (const [what, payload] of HOSTILE) {
        const said = send(drive(), action, payload);
        assert.ok(said.status === undefined || said.status < 500,
          `${action} answered ${said.status} for a payload that is ${what}: ${said.error}`);
      }
    }
  });

  test('and never quotes the runtime back at the caller', () => {
    for (const action of served()) {
      for (const [what, payload] of HOSTILE) {
        const said = send(drive(), action, payload);
        assert.not(RUNTIME.test(String(said.error ?? '')),
          `${action} leaked for a payload that is ${what}: ${said.error}`);
      }
    }
  });

  test('and never tells the outbox to resend something permanently invalid', () => {
    for (const action of served()) {
      for (const [what, payload] of HOSTILE) {
        const said = send(drive(), action, payload);
        if (said.ok !== false) continue;
        assert.not(said.retryable,
          `${action} asked for a resend of a payload that is ${what}`);
      }
    }
  });

  /*
   * The fourth list, and what it cost.
   *
   * LIST-01 fixed the three lists in `Sheets.gs`. `manageMembers` is in
   * `Code.gs` and walks `payload.emails` by index, and the sweep that found
   * LIST-01 recorded `members` among the actions that *"held against every
   * one"* — true of the payloads it sent, which were hostile as a whole
   * rather than in one field.
   *
   * This is the whole household's access list, so the check is the outcome
   * rather than the status code: can the spouse still reach the backend.
   */
  describe('the list of accounts', () => {
    const WITH_SPOUSE = [
      { email: OWNER_EMAIL, role: 'owner', personId: 'p1' },
      { email: 'spouse@example.com', role: 'spouse', personId: 'p2' },
    ];

    const household = (members = WITH_SPOUSE) => backend({
      owner: OWNER_EMAIL,
      tokens: {
        ...tokens,
        'spouse-token': { email: 'spouse@example.com', aud: 'client-id', expires_in: '3599' },
      },
      workbook: workbookStub(),
      files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Sheets.gs'],
      properties: { members: JSON.stringify(members), workbookId: 'book-1' },
    });

    const reaches = (api, token) => post(api,
      JSON.stringify({ action: 'ping', token, payload: {}, deviceId: 'd1' })).ok;

    test('is refused when it is not a list, rather than emptied', () => {
      for (const [what, emails] of [
        ['a string', 'a half-written string'],
        ['a number', 42],
        ['an array-like object', { length: 2 }],
      ]) {
        const api = household();
        assert.ok(reaches(api, 'spouse-token'), 'the spouse could not reach it to begin with');

        const said = send(api, 'members', { emails });

        assert.equal(said.ok, false, `emails as ${what} was accepted`);
        assert.equal(said.status, 400, `emails as ${what} answered ${said.status}`);
        assert.ok(reaches(api, 'spouse-token'),
          `emails as ${what} signed the spouse out of the household`);
      }
    });

    test('but an empty list still means what it says', () => {
      // The other half. A guard that refused everything would satisfy the
      // check above and take a real request with it: an owner removing the
      // last member sends exactly this.
      const api = household();
      const said = send(api, 'members', { emails: [] });

      assert.ok(said.ok, said.error);
      assert.length(said.data.members, 0, 'the owner could not remove anybody');
      assert.not(reaches(api, 'spouse-token'), 'a removed member still reached the backend');
    });

    test('and a real list of accounts still goes through', () => {
      const api = household([{ email: OWNER_EMAIL, role: 'owner', personId: 'p1' }]);
      const said = send(api, 'members', {
        emails: [{ email: 'spouse@example.com', role: 'spouse', personId: 'p2' }],
      });

      assert.ok(said.ok, said.error);
      assert.ok(reaches(api, 'spouse-token'), 'a member the owner added could not reach it');
    });
  });

  test('and the sweep covers every action the dispatch names', () => {
    // The half that keeps the three checks above from quietly covering less
    // than they claim. `served()` reads the backend; if it ever returns an
    // empty list — a renamed `dispatch`, a changed `case` shape — the loops
    // above would pass over nothing at all and say so to nobody.
    const actions = served();
    assert.ok(actions.length >= 16, `the dispatch reader found only ${actions.length} actions`);
    assert.includes(actions, 'push');
    assert.includes(actions, 'upload');
    assert.includes(actions, 'bootstrap');
  });
});
