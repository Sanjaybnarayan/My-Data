import { test, describe, assert, setSuite } from './harness.mjs';
import { DriveEscrow, mintRawKey, APPDATA_SCOPE } from '../js/security/escrow.js';
import { Keyring } from '../js/security/keyring.js';
import { toBase64, exportKeyBytes } from '../js/security/crypto.js';
import { missingScopes, completeOAuthRedirect } from '../js/auth/google.js';
import {
  unlockFreshDevice, linkExistingDevice, unlinkGoogleUnlock,
} from '../js/auth/google-unlock.js';

setSuite('escrow');

/**
 * A Drive that is a Map.
 *
 * Deliberately literal about the two-step write the real API needs — metadata
 * first, bytes second — because a stub that accepted the bytes in one call
 * would pass while the shipped code failed.
 */
function fakeDrive({ files = new Map(), status = 200 } = {}) {
  const calls = [];
  const state = { lastBody: null };
  let next = 1;

  const respond = (body, code = status) => ({
    ok: code >= 200 && code < 300,
    status: code,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? 'GET' });
    if (status !== 200) return respond({ error: 'nope' }, status);

    if (options.method === 'DELETE') {
      files.delete(url.split('/files/')[1]);
      return respond({});
    }

    if (url.includes('/upload/drive/v3/files/')) {
      const id = url.split('/files/')[1].split('?')[0];
      files.set(id, options.body);
      return respond({ id });
    }

    if (options.method === 'POST') {
      state.lastBody = options.body;
      const id = `file${next++}`;
      files.set(id, null);
      return respond({ id });
    }

    if (url.includes('alt=media')) {
      const id = url.split('/files/')[1].split('?')[0];
      return respond(JSON.parse(files.get(id)));
    }

    // A search of the app folder.
    const found = [...files.keys()].filter((id) => files.get(id));
    return respond({ files: found.length ? [{ id: found[0] }] : [] });
  };

  return {
    files,
    calls,
    get lastBody() { return state.lastBody; },
    escrow: (token = 'tok', hidden = false) => new DriveEscrow({
      getToken: async () => token, fetchImpl, hidden,
    }),
    /**
     * Mint and store in one step, which is what `create()` used to do.
     *
     * It is a test helper now and not an API, because doing both in one call
     * is exactly how a second device came to write over the first one's key —
     * see `unlockFreshDevice`. Here the ordering is not in question, so the
     * shorthand is fine.
     */
    seed: async (token = 'tok', hidden = false, wrapped = { iv: 'aXY=', key: 'a2V5' }) => {
      const escrow = new DriveEscrow({ getToken: async () => token, fetchImpl, hidden });
      const bytes = mintRawKey();
      await escrow.put(bytes, wrapped);
      return bytes;
    },
  };
}

/* ---------------------------------------------------------------- the key */

describe('a key kept in the household own Drive', () => {
  test('it is minted, stored, and comes back the same', async () => {
    const drive = fakeDrive();
    const made = await drive.seed();

    assert.equal(made.length, 32, 'a wrapping key must be 32 bytes');
    const read = await drive.escrow().read();
    assert.equal(toBase64(read.rawKey), toBase64(made));
  });

  test('a household that has never escrowed one gets null, not an error', async () => {
    // This is the ordinary case for somebody who set up with a PIN, and it
    // must read as "no key here" rather than as a failure.
    assert.equal(await fakeDrive().escrow().read(), null);
  });

  test('two mints do not leave two keys behind', async () => {
    // A second file in the folder would be a coin flip over which key a new
    // device found, and half the time it would be the wrong one.
    const drive = fakeDrive();
    await drive.seed();
    await drive.seed();
    assert.length([...drive.files.keys()], 1);
  });

  test('by default it needs no permission beyond the one already granted', async () => {
    // `drive.appdata` has to be added to a household's OAuth consent screen
    // before Google will grant it, and Google grants the rest of the request
    // either way — so requiring it meant a successful sign-in followed by a
    // refusal, for a reason living in a different console. `drive.file`
    // covers a file this application created, and is enough.
    const drive = fakeDrive();
    await drive.seed();

    const create = drive.calls.find((call) => call.method === 'POST');
    assert.ok(create, 'no file was created');
    assert.not(JSON.parse(drive.lastBody ?? '{}').parents,
      'the default path asked for the app folder it may not have');
  });

  test('given the app folder, it uses it', async () => {
    const drive = fakeDrive();
    await drive.seed('tok', true);
    assert.ok(drive.calls.some((call) => call.url.includes('spaces=appDataFolder')));
  });

  test('a key put in one place is found from the other', async () => {
    // A household that adds `drive.appdata` later, or removes it, must not
    // lose the key they already have.
    const drive = fakeDrive();
    const made = await drive.seed('tok', false);
    const read = await drive.escrow('tok', true).read();
    assert.equal(toBase64(read.rawKey), toBase64(made));
  });

  test('what is stored is the wrapping key, never the data key', async () => {
    // The distinction the whole design rests on: Drive holds something that
    // *unwraps* the data, so revoking it leaves the ciphertext as unreadable
    // as it was before.
    const drive = fakeDrive();
    await drive.seed();
    const stored = JSON.parse([...drive.files.values()].find(Boolean));

    assert.ok(stored.key, 'nothing was stored');
    assert.includes(stored.note, 'PIN and recovery phrase are unaffected');
  });

  test('turning it off takes the key out of Drive rather than forgetting it', async () => {
    // Leaving it there would mean a household that decided against this still
    // had their key in their Google account, which is the thing they decided
    // against.
    const drive = fakeDrive();
    await drive.seed();
    assert.ok(await drive.escrow().drop());
    assert.length([...drive.files.keys()], 0);
  });

  test('dropping a key that is not there is not an error', async () => {
    assert.not(await fakeDrive().escrow().drop());
  });
});

/* ------------------------------------------------------------- refusals */

describe('when Google says no', () => {
  test('a revoked permission is reported as one', async () => {
    const drive = fakeDrive({ status: 403 });
    await assert.throws(() => drive.escrow().read(), /permission may have been revoked/i);
  });

  test('being signed out is not mistaken for having no key', async () => {
    // Returning null here would tell a household their key was gone, which is
    // the most alarming possible way to say "sign in again".
    const drive = fakeDrive();
    await assert.throws(() => drive.escrow('').read(), /not signed in/i);
  });

  test('the scope is the app folder alone', () => {
    assert.equal(APPDATA_SCOPE, 'https://www.googleapis.com/auth/drive.appdata');
    assert.not(/drive\.file|drive\.readonly|auth\/drive$/.test(APPDATA_SCOPE));
  });
});

/* ------------------------------------------------- what Google granted */

describe('a token is not proof the permission was given', () => {
  // Google hands back a working token whether or not it granted everything
  // asked for — somebody unticks a permission on the consent screen, or a
  // Cloud project that never listed a scope drops it. Both then surface two
  // calls later as "Drive refused", which names the wrong problem and sends
  // people to look at their Drive instead of their consent screen.
  test('a scope asked for and not granted is reported', () => {
    assert.deep(missingScopes(['openid', APPDATA_SCOPE], ['openid']), [APPDATA_SCOPE]);
  });

  test('a grant wider than the request is not a problem', () => {
    // `include_granted_scopes` means earlier consents come back too, and
    // treating that as an error would refuse a perfectly good sign-in.
    assert.length(missingScopes(['openid'], ['openid', APPDATA_SCOPE]), 0);
  });

  test('a response that says nothing about scopes claims nothing', () => {
    // Reporting every scope as missing would be worse than reporting none.
    assert.length(missingScopes(['openid', APPDATA_SCOPE], []), 0);
    assert.length(missingScopes(['openid'], undefined), 0);
  });

  test('the callback carries the granted scopes back, or none of this works', () => {
    const posted = [];
    completeOAuthRedirect({
      location: { hash: '#access_token=t&expires_in=3599&state=s&scope=openid%20' + encodeURIComponent(APPDATA_SCOPE), pathname: '/cb' },
      history: { replaceState() {} },
      opener: null,
      parent: { postMessage: (message) => posted.push(message) },
    });

    assert.includes(posted[0].scope, APPDATA_SCOPE);
    assert.equal(posted[0].accessToken, 't');
  });
});

/* ------------------------------------------------------- with the keyring */

describe('signing in with Google unlocks the same data', () => {
  const meta = () => {
    const store = new Map();
    return {
      get: async (key) => store.get(key),
      set: async (key, value) => store.set(key, value),
    };
  };

  test('a fresh household enrols with the escrowed key and is unlocked', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);

    const { outcome } = await unlockFreshDevice(keyring, drive.escrow(), 'a@example.com');

    assert.equal(outcome, 'found');
    assert.ok(keyring.key, 'the data key is not in memory after enrolling');
    assert.ok(await keyring.isEnrolled());
  });

  test('the first device publishes the wrapping, not only the key', async () => {
    // Without it a second device gets the right bytes and still cannot open
    // anything: its own keyring is empty, and `meta` never syncs.
    const drive = fakeDrive();
    await unlockFreshDevice(new Keyring(meta(), 1000), drive.escrow(), '');

    const stored = JSON.parse([...drive.files.values()].find(Boolean));
    assert.ok(stored.wrapped?.iv && stored.wrapped?.key);
  });

  test('another device signs in and gets the very same data key', async () => {
    // The point of escrowing. The two keyrings get *separate* stores, because
    // that is what a second device is — this test shared one before, so the
    // "second device" was reading the first one's wrapping out of its own
    // keyring and the case was never covered at all.
    const drive = fakeDrive();
    const first = new Keyring(meta(), 1000);
    await unlockFreshDevice(first, drive.escrow(), 'a@example.com');

    const second = new Keyring(meta(), 1000);
    const { outcome } = await unlockFreshDevice(second, drive.escrow(), 'a@example.com');

    assert.equal(outcome, 'adopted');
    assert.equal(
      toBase64(await exportKeyBytes(second.key)),
      toBase64(await exportKeyBytes(first.key)),
    );
  });

  test('a second device does not write over the first one key', async () => {
    // The bug in its own words. A device with no keyring takes the enrolment
    // path, enrolment minted and stored in one call, and storing replaces the
    // file — so setting up a second phone left the first one wrapped under
    // bytes that no longer existed anywhere. Silently, and with no error.
    const drive = fakeDrive();
    await unlockFreshDevice(new Keyring(meta(), 1000), drive.escrow(), '');
    const before = JSON.parse([...drive.files.values()].find(Boolean));

    await unlockFreshDevice(new Keyring(meta(), 1000), drive.escrow(), '');
    const after = JSON.parse([...drive.files.values()].find(Boolean));

    assert.equal(after.key, before.key, 'the household key was replaced');
    assert.deep(after.wrapped, before.wrapped);
  });

  test('an adopted wrapping that will not open leaves the device fresh', async () => {
    // Better unenrolled and able to try again than enrolled with a key that
    // opens nothing, which is indistinguishable from data loss.
    const drive = fakeDrive();
    await drive.seed('tok', false, { iv: 'AAAAAAAAAAAAAAAA', key: 'bm90LWEta2V5' });

    const keyring = new Keyring(meta(), 1000);
    await assert.throws(() => unlockFreshDevice(keyring, drive.escrow(), ''));
    assert.not(await keyring.isEnrolled(), 'a failed adoption must not leave it enrolled');
  });

  test('a key from before wrappings were stored is reported, not written over', async () => {
    // An existing household upgrading. The bytes are real and another device
    // is wrapped under them, so minting over the top is the same destruction
    // by a different route.
    const drive = fakeDrive();
    await drive.seed('tok', false, null);
    const before = JSON.parse([...drive.files.values()].find(Boolean));

    await assert.throws(
      () => unlockFreshDevice(new Keyring(meta(), 1000), drive.escrow(), ''),
      'escrow-legacy',
    );
    assert.equal(JSON.parse([...drive.files.values()].find(Boolean)).key, before.key);
  });

  test('a different key does not open it', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await unlockFreshDevice(keyring, drive.escrow(), '');

    const other = new Uint8Array(32).fill(7);
    await assert.throws(() => keyring.unlockWithRawKey(other, 'google'), /did not unlock/i);
  });

  test('enrolling twice is refused, because it would orphan every record', async () => {
    fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    const rawKey = mintRawKey();
    await keyring.enrolRawKey(rawKey, 'google');
    await assert.throws(() => keyring.enrolRawKey(rawKey, 'google'), /already has a data key/);
  });

  test('a key of the wrong size is refused rather than padded', async () => {
    const keyring = new Keyring(meta(), 1000);
    await assert.throws(() => keyring.enrolRawKey(new Uint8Array(16), 'google'), /32 bytes/);
  });
});

/* ------------------------------------------------- turning it on later */

describe('turning Continue with Google on from Settings', () => {
  const meta = () => {
    const store = new Map();
    return {
      get: async (key) => store.get(key) ?? null,
      set: async (key, value) => store.set(key, value),
    };
  };

  test('a household that started with a PIN can add it', async () => {
    // Impossible before this: enrolment ran only on a device with no data key,
    // so there was no path from "set up with a PIN" to "also use Google".
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolPin('4913');

    const { outcome } = await linkExistingDevice(keyring, drive.escrow(), 'a@example.com');

    assert.equal(outcome, 'published');
    assert.deep((await keyring.methods()).map((m) => m.method).sort(), ['google', 'pin']);
  });

  test('and a new phone can then join that household', async () => {
    const drive = fakeDrive();
    const desktop = new Keyring(meta(), 1000);
    await desktop.enrolPin('4913');
    await linkExistingDevice(desktop, drive.escrow(), '');

    const phone = new Keyring(meta(), 1000);
    await unlockFreshDevice(phone, drive.escrow(), '');

    assert.equal(
      toBase64(await exportKeyBytes(phone.key)),
      toBase64(await exportKeyBytes(desktop.key)),
    );
  });

  test('an account holding a different household key is refused', async () => {
    // Publishing over it would lock those records away, and nobody would find
    // out until somebody else could not get in.
    const drive = fakeDrive();
    await unlockFreshDevice(new Keyring(meta(), 1000), drive.escrow(), 'other@example.com');
    const before = JSON.parse([...drive.files.values()].find(Boolean));

    const mine = new Keyring(meta(), 1000);
    await mine.enrolPin('4913');

    await assert.throws(
      () => linkExistingDevice(mine, drive.escrow(), 'me@example.com'),
      'escrow-conflict',
    );
    assert.deep(JSON.parse([...drive.files.values()].find(Boolean)).wrapped, before.wrapped);
  });

  test('a legacy key is replaced from a device that is unlocked', async () => {
    // Safe here and not in `unlockFreshDevice`: this device holds the data key,
    // so what it publishes is known to open the household records — which is
    // exactly what the old file could not promise.
    const drive = fakeDrive();
    await drive.seed('tok', false, null);

    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolPin('4913');
    const { outcome } = await linkExistingDevice(keyring, drive.escrow(), '');

    assert.equal(outcome, 'published');
    assert.ok(JSON.parse([...drive.files.values()].find(Boolean)).wrapped);
  });

  test('turning it off locally leaves every other device working', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolPin('4913');
    await linkExistingDevice(keyring, drive.escrow(), '');

    await unlinkGoogleUnlock(keyring, null);

    assert.deep((await keyring.methods()).map((m) => m.method), ['pin']);
    assert.ok((await drive.escrow().read()).wrapped, 'the file is not this device to delete');
  });

  test('removing the only way in is refused', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await unlockFreshDevice(keyring, drive.escrow(), '');
    await assert.throws(() => unlinkGoogleUnlock(keyring, null), 'last-method');
  });
});
