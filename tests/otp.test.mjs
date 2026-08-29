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

/* ------------------------------------------------- signing in with a code */

const OWNER = 'owner@example.com';
const TOKENS = {
  'owner-token': { email: OWNER, expires_in: '3599' },
  'member-token': { email: 'asha@example.com', expires_in: '3599' },
};

/** A wrapped data key, in the shape the keyring produces. Opaque here. */
const WRAPPED = { iv: 'aXY=', key: 'a2V5' };

/**
 * Asha is an admitted member, and that detail is the point.
 *
 * Without it every `member-token` request is refused by `admit` with a 403
 * before `otpEscrowManage` is reached — so the three tests below asserting the
 * owner-only rule passed with the rule deleted. A check that cannot fail is
 * the fault this repository has found most often, and it was reintroduced here
 * on the first attempt.
 */
const MEMBERS = JSON.stringify([
  { email: 'asha@example.com', role: 'member', personId: 'p1' },
]);

function withSignIn({ digits = 123456, properties = {} } = {}) {
  const n = digits;
  return backend({
    owner: OWNER,
    tokens: TOKENS,
    files: ['Policy.gs', 'Code.gs', 'Otp.gs'],
    properties: { otpDirectory: DIRECTORY, members: MEMBERS, ...properties },
    randomBytes: () => [
      (n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff,
    ],
  });
}

/** Turn signing in by code on for Asha, as the owner. */
function turnOn(api, extra = {}) {
  return api.post('signin', 'owner-token', {
    op: 'put',
    personId: 'p1',
    name: 'Asha',
    email: 'asha@example.com',
    key: 'MzJieXRlcw==',
    wrapped: WRAPPED,
    ...extra,
  });
}

describe('turning signing in by code on', () => {
  test('only the owner may do it', () => {
    const api = withSignIn();
    const body = api.post('signin', 'member-token', {
      op: 'put', personId: 'p1', email: 'asha@example.com', key: 'k', wrapped: WRAPPED,
    });

    assert.not(body.ok);
    assert.equal(body.status, 403);
    // Refused *and* nothing written. A refusal that stored anyway would put the
    // household's data key in the deployment on the strength of a 403.
    assert.equal(api.props.getProperty('otpEscrow_p1'), null);
  });

  test('and not even the owner may store half of it', () => {
    /*
     * The two halves are useless apart and dangerous apart in different ways.
     * A key with no wrapping is a device adopting nothing; a wrapping with no
     * key is a device adopting a wrapping it can never open, which leaves it
     * enrolled and permanently unopenable.
     */
    const api = withSignIn();

    const noWrap = api.post('signin', 'owner-token', {
      op: 'put', personId: 'p1', email: 'asha@example.com', key: 'k',
    });
    const noKey = api.post('signin', 'owner-token', {
      op: 'put', personId: 'p1', email: 'asha@example.com', wrapped: WRAPPED,
    });

    assert.not(noWrap.ok);
    assert.not(noKey.ok);
    assert.equal(api.props.getProperty('otpEscrow_p1'), null);
  });

  test('and it needs somewhere to send a code', () => {
    const api = withSignIn();
    const body = api.post('signin', 'owner-token', {
      op: 'put', personId: 'p1', key: 'k', wrapped: WRAPPED,
    });

    assert.not(body.ok);
    assert.equal(body.status, 400);
  });

  test('writes the directory as well as the escrow', () => {
    /*
     * Until this existed `otpDirectory` had no writer anywhere in the
     * repository. It was read by `otpPersonFor` and set by nothing, so on a
     * real deployment no address ever matched and no code was ever sent to
     * anybody. A feature configurable only by hand-editing script properties
     * is a feature nobody has.
     */
    const api = withSignIn({ properties: { otpDirectory: '[]' } });
    const body = turnOn(api);

    assert.ok(body.ok);
    const directory = JSON.parse(api.props.getProperty('otpDirectory'));
    assert.equal(directory.length, 1);
    assert.equal(directory[0].personId, 'p1');
    assert.equal(directory[0].email, 'asha@example.com');
  });

  test('replacing one person leaves everybody else alone', () => {
    const api = withSignIn({
      properties: {
        otpDirectory: JSON.stringify([
          { personId: 'p1', name: 'Asha', email: 'old@example.com' },
          { personId: 'p2', name: 'Ravi', email: 'ravi@example.com' },
        ]),
      },
    });
    turnOn(api);

    const directory = JSON.parse(api.props.getProperty('otpDirectory'));
    assert.equal(directory.length, 2);
    assert.equal(directory.find((d) => d.personId === 'p1').email, 'asha@example.com');
    assert.equal(directory.find((d) => d.personId === 'p2').email, 'ravi@example.com');
  });
});

describe('a verified code, once signing in by code is on', () => {
  test('releases the key, and says which of the two things it did', () => {
    const api = withSignIn();
    turnOn(api);
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const out = api.post('otp.verify', '', {
      address: 'asha@example.com', code: codeFor(123456),
    });

    assert.ok(out.ok);
    // The word, not the presence of a field. A client that inferred this from
    // the shape of the reply would be guessing at an authorisation decision.
    assert.equal(out.data.grants, 'identity-and-unlock');
    assert.equal(out.data.unlock.key, 'MzJieXRlcw==');
    assert.deep(out.data.unlock.wrapped, WRAPPED);
  });

  test('and releases nothing for a person it was never turned on for', () => {
    const api = withSignIn({
      properties: {
        otpDirectory: JSON.stringify([
          { personId: 'p2', name: 'Ravi', email: 'ravi@example.com' },
        ]),
      },
    });
    // Asha has an escrow; the code below is Ravi's, and Ravi has none.
    turnOn(api);
    api.post('otp.request', '', { channel: 'email', address: 'ravi@example.com' });

    const out = api.post('otp.verify', '', {
      address: 'ravi@example.com', code: codeFor(123456),
    });

    assert.ok(out.ok);
    assert.equal(out.data.grants, 'identity-only');
    assert.equal(out.data.unlock, null);
  });

  test('a wrong code releases nothing', () => {
    const api = withSignIn();
    turnOn(api);
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const out = api.post('otp.verify', '', { address: 'asha@example.com', code: '000000' });

    assert.not(out.ok);
    assert.not(JSON.stringify(out).includes('MzJieXRlcw=='),
      'a refused code carried the unlock key in its refusal');
  });

  test('and a half-written escrow releases nothing rather than half of it', () => {
    /*
     * A wrapping with no key would be adopted by a fresh device and never
     * open — leaving it enrolled, unopenable, and out of the recovery-phrase
     * path it would otherwise have taken.
     */
    const api = withSignIn({
      properties: { otpEscrow_p1: JSON.stringify({ wrapped: WRAPPED }) },
    });
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const out = api.post('otp.verify', '', {
      address: 'asha@example.com', code: codeFor(123456),
    });

    assert.ok(out.ok);
    assert.equal(out.data.grants, 'identity-only');
    assert.equal(out.data.unlock, null);
  });
});

describe('what the message says', () => {
  test('an ordinary code still says it unlocks nothing', () => {
    const api = withSignIn();
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    assert.ok(api.mailed[0].body.includes('does not unlock anything on its own'));
  });

  test('a code that does unlock says so instead', () => {
    /*
     * The old body told every reader a code unlocks nothing, which is exactly
     * what somebody receiving an unexpected code needs *not* to be told when
     * it does. Somebody deciding whether ignoring a code is enough is deciding
     * on this sentence.
     */
    const api = withSignIn();
    turnOn(api);
    api.post('otp.request', '', { channel: 'email', address: 'asha@example.com' });

    const body = api.mailed[0].body;
    assert.ok(body.includes('opens your FamilyOS records on a new device'));
    assert.not(body.includes('does not unlock anything on its own'));
  });
});

describe('turning it off', () => {
  test('takes the key out of the deployment and the address out of the directory', () => {
    const api = withSignIn();
    turnOn(api);
    const body = api.post('signin', 'owner-token', { op: 'drop', personId: 'p1' });

    assert.ok(body.ok);
    assert.equal(api.props.getProperty('otpEscrow_p1'), null);
    assert.deep(JSON.parse(api.props.getProperty('otpDirectory')), []);
  });

  test('and a member cannot turn somebody else off', () => {
    const api = withSignIn();
    turnOn(api);
    const body = api.post('signin', 'member-token', { op: 'drop', personId: 'p1' });

    assert.not(body.ok);
    assert.equal(body.status, 403);
    assert.ok(api.props.getProperty('otpEscrow_p1'));
  });
});

describe('asking who can sign in by code', () => {
  test('never answers with the key itself', () => {
    const api = withSignIn();
    turnOn(api);
    const body = api.post('signin', 'owner-token', { op: 'status' });

    assert.ok(body.ok);
    assert.equal(body.data.people[0].unlocks, true);
    assert.not(JSON.stringify(body).includes('MzJieXRlcw=='),
      'the status reply carried the unlock key');
  });

  test('and masks the address it reports', () => {
    const api = withSignIn();
    turnOn(api);
    const body = api.post('signin', 'owner-token', { op: 'status' });

    assert.equal(body.data.people[0].email, 'a···@example.com');
  });

  test('and is refused to anybody but the owner', () => {
    const api = withSignIn();
    const body = api.post('signin', 'member-token', { op: 'status' });
    assert.not(body.ok);
    assert.equal(body.status, 403);
  });
});
