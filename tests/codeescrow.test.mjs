import { test, describe, assert, setSuite } from './harness.mjs';
import { CodeEscrow, CODE_METHOD } from '../js/security/codeescrow.js';
import { Keyring } from '../js/security/keyring.js';
import { mintRawKey } from '../js/security/escrow.js';
import { unlockFreshDevice } from '../js/auth/google-unlock.js';
import { wrapDataKey, importKeyEncryptionKey, toBase64 } from '../js/security/crypto.js';
import {
  limitsFor, WHAT_IT_DOES_NOT_DO, WHAT_A_CODE_NOW_DOES, WHAT_IS_NOT_KNOWN,
} from '../js/domain/otp.js';

setSuite('codeescrow');

const meta = () => {
  const store = new Map();
  return {
    /** @param {string} key */
    get: async (key) => store.get(key) ?? null,
    // The braces matter: `store.set` returns the Map, and a `set` that resolves
    // to one does not match what `Keyring` was given.
    /** @param {string} key */
    set: async (key, value) => { store.set(key, value); },
  };
};

/**
 * A transport that answers the two public actions and records the rest.
 *
 * `verify` returns whatever the test hands it, because what is under test is
 * the client's reading of the reply — not the backend, which `tests/otp.test.mjs`
 * covers against the real `Otp.gs`.
 */
function fakeTransport(verifyAnswer = {}) {
  const sent = [];
  return {
    sent,
    configured: true,
    async callPublic(action, payload) {
      sent.push({ action, payload });
      return action === 'otp.verify' ? verifyAnswer : { sent: true };
    },
    async call(action, payload) {
      sent.push({ action, payload });
      return { ok: true, people: [] };
    },
  };
}

/** A real escrow record: 32 bytes, and this household's data key under them. */
async function realRelease() {
  const keyring = new Keyring(meta(), 1000);
  const rawKey = mintRawKey();
  await keyring.enrolRawKey(rawKey, CODE_METHOD);
  return {
    key: toBase64(rawKey),
    wrapped: await keyring.wrappedFor(CODE_METHOD),
  };
}

describe('reading what a verified code released', () => {
  test('nothing is held before a code has been verified', async () => {
    const escrow = new CodeEscrow({ transport: fakeTransport() });
    assert.equal(await escrow.read(), null);
  });

  test('an identity-only code releases nothing', async () => {
    const escrow = new CodeEscrow({
      transport: fakeTransport({ verified: true, personId: 'p1', grants: 'identity-only' }),
    });

    const { personId, unlocks } = await escrow.verify('asha@example.com', '123456');

    assert.equal(personId, 'p1');
    assert.not(unlocks);
    assert.equal(await escrow.read(), null);
  });

  test('and one that grants an unlock is read back in the shape Drive uses', async () => {
    // The same shape on purpose: `unlockFreshDevice` consumes both, so the two
    // escrows are interchangeable there rather than each having its own copy
    // of the adopt-and-roll-back path.
    const unlock = await realRelease();
    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true, personId: 'p1', grants: 'identity-and-unlock', unlock,
      }),
    });

    await escrow.verify('asha@example.com', '123456');
    const record = await escrow.read();

    assert.equal(record.rawKey.length, 32);
    assert.deep(record.wrapped, unlock.wrapped);
  });

  test('the word decides it, not whether a field arrived', async () => {
    /*
     * A backend that sent key material without saying `identity-and-unlock`
     * has not authorised anything, and a client that adopted it because the
     * field was present would be inferring an authorisation from the shape of
     * a reply.
     */
    const unlock = await realRelease();
    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true, personId: 'p1', grants: 'identity-only', unlock,
      }),
    });

    const { unlocks } = await escrow.verify('asha@example.com', '123456');

    assert.not(unlocks);
    assert.equal(await escrow.read(), null);
  });

  test('a promised unlock that arrives half-written is refused, not adopted', async () => {
    // Adopting a wrapping with no key leaves a device enrolled, permanently
    // unopenable, and out of the recovery-phrase path it would have taken.
    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true, personId: 'p1', grants: 'identity-and-unlock',
        unlock: { wrapped: { iv: 'aXY=', key: 'a2V5' } },
      }),
    });

    await assert.throws(() => escrow.verify('asha@example.com', '123456'), /could not use/i);
    assert.equal(await escrow.read(), null);
  });
});

describe('a new device joining on a code', () => {
  test('adopts the household key and unlocks with it', async () => {
    const unlock = await realRelease();
    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true, personId: 'p1', grants: 'identity-and-unlock', unlock,
      }),
    });
    await escrow.verify('asha@example.com', '123456');

    const keyring = new Keyring(meta(), 1000);
    const { outcome } = await unlockFreshDevice(keyring, escrow, 'asha@example.com', CODE_METHOD);

    assert.equal(outcome, 'adopted');
    assert.deep((await keyring.methods()).map((m) => m.method), [CODE_METHOD]);
    assert.ok(keyring.key, 'the device adopted a key it could not then unlock with');
  });

  test('and a wrapping that does not open leaves the device fresh, not half-enrolled', async () => {
    /*
     * The rollback, exercised through the code path rather than assumed from
     * the Google one. A device left adopted-and-unopenable would claim to be
     * enrolled — so the lock screen would stop offering the recovery phrase
     * that is the only remaining way in.
     */
    const stranger = new Uint8Array(32).fill(9);
    const wrapped = await wrapDataKey(
      await (await import('../js/security/crypto.js')).generateDataKey(),
      await importKeyEncryptionKey(stranger),
    );

    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true,
        personId: 'p1',
        grants: 'identity-and-unlock',
        // Bytes that are not the ones this wrapping was made under.
        unlock: { key: toBase64(new Uint8Array(32).fill(1)), wrapped },
      }),
    });
    await escrow.verify('asha@example.com', '123456');

    const keyring = new Keyring(meta(), 1000);
    await assert.throws(
      () => unlockFreshDevice(keyring, escrow, '', CODE_METHOD),
      /did not unlock/i,
    );
    assert.not(await keyring.isEnrolled(), 'the device was left enrolled and unopenable');
  });

  test('the Google path is unchanged by the method now being an argument', async () => {
    // The default is what every existing caller relied on. A parameter that
    // silently changed the entry a Google sign-in writes would lock those
    // households out of the wrapping they already have.
    const unlock = await realRelease();
    const escrow = {
      read: async () => ({
        rawKey: (await import('../js/security/crypto.js')).fromBase64(unlock.key),
        wrapped: unlock.wrapped,
      }),
    };

    const keyring = new Keyring(meta(), 1000);
    await unlockFreshDevice(keyring, escrow, '');

    assert.deep((await keyring.methods()).map((m) => m.method), ['google']);
  });
});

describe('turning it on and off, from an unlocked device', () => {
  test('publishing sends both halves and names the person', async () => {
    const transport = fakeTransport();
    const escrow = new CodeEscrow({ transport });
    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolPin('4913');

    const rawKey = mintRawKey();
    await keyring.addMethod(CODE_METHOD, { rawKey, label: 'asha@example.com' });
    await escrow.put(rawKey, await keyring.wrappedFor(CODE_METHOD), {
      personId: 'p1', name: 'Asha', email: 'asha@example.com',
    });

    const call = transport.sent.at(-1);
    assert.equal(call.action, 'signin');
    assert.equal(call.payload.op, 'put');
    assert.equal(call.payload.personId, 'p1');
    assert.ok(call.payload.key, 'no unlock key was sent, so a code could open nothing');
    assert.ok(call.payload.wrapped?.iv, 'no wrapping was sent, so the key opens nothing');
  });

  test('dropping names the person and asks for nothing else', async () => {
    const transport = fakeTransport();
    await new CodeEscrow({ transport }).drop('p1');

    assert.deep(transport.sent.at(-1), { action: 'signin', payload: { op: 'drop', personId: 'p1' } });
  });

  test('an unconfigured backend is not offered', () => {
    assert.not(new CodeEscrow({ transport: { configured: false } }).configured);
    assert.not(new CodeEscrow({}).configured);
  });
});

describe('what a screen is allowed to say about a code', () => {
  test('the three situations get three different answers', () => {
    assert.deep(limitsFor(false), WHAT_IT_DOES_NOT_DO);
    assert.deep(limitsFor(true), WHAT_A_CODE_NOW_DOES);
    assert.deep(limitsFor(null), WHAT_IS_NOT_KNOWN);
    assert.deep(limitsFor(undefined), WHAT_IS_NOT_KNOWN);
  });

  test('and no sentence appears in two of them', () => {
    /*
     * The sets contradict each other — one says a code unlocks nothing and the
     * other says it opens everything. A key in both would be a sentence that
     * stayed true whichever situation the household is in, which for these
     * sentences is impossible, so it would mean one of them says nothing.
     */
    const all = [...WHAT_IT_DOES_NOT_DO, ...WHAT_A_CODE_NOW_DOES, ...WHAT_IS_NOT_KNOWN];
    assert.equal(new Set(all).size, all.length);
  });

  test('not knowing is never answered with a guess', () => {
    // Both guesses are wrong in a way that matters: "it does not unlock" is a
    // false reassurance, "it does" is an alarm about nothing. An unread value
    // reported as an answer is the fault this repository keeps finding.
    assert.not(limitsFor(null).some((key) => WHAT_IT_DOES_NOT_DO.includes(key)));
    assert.not(limitsFor(null).some((key) => WHAT_A_CODE_NOW_DOES.includes(key)));
  });
});

describe('the branch that would write over a household key', () => {
  test('a device that arrived on a code refuses to publish one', async () => {
    /*
     * `unlockFreshDevice` mints and publishes when the escrow holds nothing,
     * which is right for a first device and destroys a second one. `verify`
     * makes that unreachable, but the invariant lives in another method for
     * another reason and the failure it would allow is silent and permanent.
     */
    const unlock = await realRelease();
    const escrow = new CodeEscrow({
      transport: fakeTransport({
        verified: true, personId: 'p1', grants: 'identity-and-unlock', unlock,
      }),
    });
    await escrow.verify('asha@example.com', '123456');

    await assert.throws(
      () => escrow.put(new Uint8Array(32), { iv: 'aXY=', key: 'a2V5' }, { personId: 'p1' }),
      /lock every other device/i,
    );
  });

  test('and a device that did not may publish freely', async () => {
    const transport = fakeTransport();
    const escrow = new CodeEscrow({ transport });
    await escrow.put(new Uint8Array(32), { iv: 'aXY=', key: 'a2V5' }, { personId: 'p1' });

    assert.equal(transport.sent.at(-1).action, 'signin');
  });
});
