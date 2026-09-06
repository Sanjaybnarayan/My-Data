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
