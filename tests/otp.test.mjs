import { test, describe, assert, setSuite } from './harness.mjs';
import { backend } from './appsscript.mjs';

setSuite('otp');

const DIRECTORY = JSON.stringify([
  { personId: 'p1', name: 'Asha', email: 'asha@example.com', phone: '+919876500000' },
]);

/**
 * A backend with `Otp.gs` loaded and a known code.
 *
 * The bytes are fixed so a test knows what the code will be. The endpoint
 * never returns it — that is the property under test — so a test that could
 * not choose it could only assert the shape of something it never sees.
 */
function withOtp({ digits = 123456, properties = {} } = {}) {
  const n = digits;
  return backend({
    files: ['Policy.gs', 'Code.gs', 'Otp.gs'],
    properties: { otpDirectory: DIRECTORY, ...properties },
    randomBytes: () => [
      (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff,
    ],
  });
}

/** What `otpCode` will produce from those bytes, by the same arithmetic. */
const codeFor = (digits) => String(digits % 1000000).padStart(6, '0');

describe('which actions may be called without a token', () => {
  test('exactly the two that have to be', () => {
    const api = withOtp();
    assert.deep(api.otpPublicActions(), ['otp.request', 'otp.verify']);
  });

  test('and nothing else, however it is named', () => {
    /*
     * The reason this is a list and not a prefix test. `otp.` as a prefix
     * would make the next action somebody names `otp.wipeEverything` public
     * the moment they wrote it, and nothing would have said so.
     */
    const api = withOtp();
    assert.equal(api.otpIsPublic('otp.somethingElse'), false);
    assert.equal(api.otpIsPublic('push'), false);
    assert.equal(api.otpIsPublic('otp.request'), true);
  });

  test('every other action still refuses a caller with no token', () => {
    const api = withOtp();
    const refused = api.post('ping', '');
    assert.equal(refused.ok, false);
    assert.equal(/access token/.test(refused.error), true, refused.error);
  });
});

describe('asking for a code', () => {
  test('sends one to an address the household has recorded', () => {
    const api = withOtp();
    const out = api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    assert.equal(out.ok, true);
    assert.equal(out.data.sent, true);
    assert.length(api.mailed, 1);
    assert.equal(api.mailed[0].to, 'asha@example.com');
  });

  test('and never puts the code in the reply', () => {
    // The whole mechanism rests on the code travelling by a second channel.
    const api = withOtp();
    const out = api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
    assert.equal(JSON.stringify(out).includes(codeFor(123456)), false);
  });

  test('says the same thing for an address it has never heard of', () => {
    /*
     * Otherwise this endpoint answers "does this address belong to your
     * household?" for anybody who asks, one guess at a time.
     */
    const api = withOtp();
    const known = api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
    const stranger = api.post('otp.request', '', { channel: 'email', address: 'nobody@example.com' });

    assert.deep(stranger.data, known.data);
    assert.length(api.mailed, 1, 'a message was sent to an address nobody recorded');
  });

  test('and refuses a channel it does not have', () => {
    // No gateway configured, so SMS says so rather than pretending to send.
    const api = withOtp();
    const out = api.post('otp.request', '', { channel: 'sms', address: '+919876500000' });
    assert.equal(out.ok, false);
    assert.equal(/no SMS gateway configured/.test(out.error), true, out.error);
  });

  test('and refuses a channel that does not exist at all', () => {
    const api = withOtp();
    const out = api.post('otp.request', '', { channel: 'carrier pigeon', address: 'asha@example.com' });
    assert.equal(out.ok, false);
  });
});

describe('using a code', () => {
  test('the right one verifies, and says what it does not grant', () => {
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const out = api.post('otp.verify', '', {
      address: 'asha@example.com', code: codeFor(123456),
    });

    assert.equal(out.ok, true);
    assert.equal(out.data.verified, true);
    assert.equal(out.data.personId, 'p1');
    // Said in the response, not only on a screen, so a second client built
    // against this cannot quietly treat it as an authorisation.
    assert.equal(out.data.grants, 'identity-only');
  });

  test('and works once', () => {
    // A code that still works after it worked is one somebody replays from a
    // message that stayed in an inbox.
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const first = api.post('otp.verify', '', { address: 'asha@example.com', code: codeFor(123456) });
    const again = api.post('otp.verify', '', { address: 'asha@example.com', code: codeFor(123456) });

    assert.equal(first.ok, true);
    assert.equal(again.ok, false);
  });

  test('a wrong one is refused, and five wrong ones destroy it', () => {
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    for (let i = 0; i < 4; i += 1) {
      const wrong = api.post('otp.verify', '', { address: 'asha@example.com', code: '000000' });
      assert.equal(wrong.ok, false, `attempt ${i + 1}`);
    }

    const fifth = api.post('otp.verify', '', { address: 'asha@example.com', code: '000000' });
    assert.equal(/too many wrong codes/.test(fifth.error), true, fifth.error);

    // And the real code is gone, rather than left to be guessed at leisure.
    const real = api.post('otp.verify', '', { address: 'asha@example.com', code: codeFor(123456) });
    assert.equal(real.ok, false, 'the code survived being brute-forced at');
  });

  test('a code for one address does not verify another', () => {
    // The stored hash is salted with the address for exactly this.
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
    const out = api.post('otp.verify', '', { address: 'nobody@example.com', code: codeFor(123456) });
    assert.equal(out.ok, false);
  });
});

describe('what is kept', () => {
  test('the cache never holds the code itself', () => {
    /*
     * The check that matters most and is easiest to skip. A code stored in
     * the clear is readable by anything that can read the cache, and the
     * whole point of hashing it is that the store is not a place a secret
     * belongs.
     */
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const everything = JSON.stringify([...api.cache._map.entries()]);
    assert.equal(everything.includes(codeFor(123456)), false,
      'the one-time code was stored in the clear');
  });

  test('nor the address it was sent to', () => {
    const api = withOtp();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
    const keys = [...api.cache._map.keys()].join(' ');
    assert.equal(keys.includes('asha@example.com'), false);
  });
});

describe('the limits, which are the whole reason this is safe to expose', () => {
  test('an address is cut off after five codes in an hour', () => {
    const api = withOtp();
    for (let i = 0; i < 5; i += 1) {
      const ok = api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
      assert.equal(ok.ok, true, `send ${i + 1}`);
    }
    const sixth = api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });
    assert.equal(sixth.ok, false);
    assert.equal(/too many codes/.test(sixth.error), true, sixth.error);
  });

  test('and the deployment is cut off across all addresses', () => {
    /*
     * The limit that actually stops the attack worth stopping. Spreading
     * requests across many addresses defeats a per-address limit completely,
     * and with an SMS gateway attached that is somebody's credit being
     * drained — an established fraud, not a hypothetical.
     */
    const api = withOtp();
    let refusals = 0;

    for (let i = 0; i < 70; i += 1) {
      const out = api.post('otp.request', '', {
        channel: 'email', address: `person${i}@example.com`,
      });
      if (!out.ok && /deployment has sent too many/.test(out.error)) refusals += 1;
    }

    assert.equal(refusals > 0, true, 'a deployment-wide ceiling never bit');
  });
});
