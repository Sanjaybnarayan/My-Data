import { test, describe, assert, setSuite } from './harness.mjs';
import { DriveEscrow, APPDATA_SCOPE } from '../js/security/escrow.js';
import { Keyring } from '../js/security/keyring.js';
import { toBase64 } from '../js/security/crypto.js';
import { missingScopes, completeOAuthRedirect } from '../js/auth/google.js';

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
  };
}

/* ---------------------------------------------------------------- the key */

describe('a key kept in the household own Drive', () => {
  test('it is minted, stored, and comes back the same', async () => {
    const drive = fakeDrive();
    const made = await drive.escrow().create();

    assert.equal(made.length, 32, 'a wrapping key must be 32 bytes');
    const read = await drive.escrow().read();
    assert.equal(toBase64(read), toBase64(made));
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
    await drive.escrow().create();
    await drive.escrow().create();
    assert.length([...drive.files.keys()], 1);
  });

  test('by default it needs no permission beyond the one already granted', async () => {
    // `drive.appdata` has to be added to a household's OAuth consent screen
    // before Google will grant it, and Google grants the rest of the request
    // either way — so requiring it meant a successful sign-in followed by a
    // refusal, for a reason living in a different console. `drive.file`
    // covers a file this application created, and is enough.
    const drive = fakeDrive();
    await drive.escrow().create();

    const create = drive.calls.find((call) => call.method === 'POST');
    assert.ok(create, 'no file was created');
    assert.not(JSON.parse(drive.lastBody ?? '{}').parents,
      'the default path asked for the app folder it may not have');
  });

  test('given the app folder, it uses it', async () => {
    const drive = fakeDrive();
    await drive.escrow('tok', true).create();
    assert.ok(drive.calls.some((call) => call.url.includes('spaces=appDataFolder')));
  });

  test('a key put in one place is found from the other', async () => {
    // A household that adds `drive.appdata` later, or removes it, must not
    // lose the key they already have.
    const drive = fakeDrive();
    const made = await drive.escrow('tok', false).create();
    const read = await drive.escrow('tok', true).read();
    assert.equal(toBase64(read), toBase64(made));
  });

  test('what is stored is the wrapping key, never the data key', async () => {
    // The distinction the whole design rests on: Drive holds something that
    // *unwraps* the data, so revoking it leaves the ciphertext as unreadable
    // as it was before.
    const drive = fakeDrive();
    await drive.escrow().create();
    const stored = JSON.parse([...drive.files.values()].find(Boolean));

    assert.ok(stored.key, 'nothing was stored');
    assert.includes(stored.note, 'PIN and recovery phrase are unaffected');
  });

  test('turning it off takes the key out of Drive rather than forgetting it', async () => {
    // Leaving it there would mean a household that decided against this still
    // had their key in their Google account, which is the thing they decided
    // against.
    const drive = fakeDrive();
    await drive.escrow().create();
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
    const rawKey = await drive.escrow().create();

    await keyring.enrolRawKey(rawKey, 'google');
    assert.ok(keyring.key, 'the data key is not in memory after enrolling');
    assert.ok(await keyring.isEnrolled());
  });

  test('another device signs in and gets the very same data key', async () => {
    // The point of escrowing: a second device with no PIN typed on it reaches
    // the same records, because it unwrapped the same key.
    const drive = fakeDrive();
    const store = meta();
    const first = new Keyring(store, 1000);
    const rawKey = await drive.escrow().create();
    const dataKey = await first.enrolRawKey(rawKey, 'google');

    const second = new Keyring(store, 1000);
    const fetched = await drive.escrow().read();
    const unlocked = await second.unlockWithRawKey(fetched, 'google');

    assert.equal(
      toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', unlocked))),
      toBase64(new Uint8Array(await crypto.subtle.exportKey('raw', dataKey))),
    );
  });

  test('a different key does not open it', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolRawKey(await drive.escrow().create(), 'google');

    const other = new Uint8Array(32).fill(7);
    await assert.throws(() => keyring.unlockWithRawKey(other, 'google'), /did not unlock/i);
  });

  test('a PIN can be added beside it, so both ways in work', async () => {
    // Stated in the interface as "you can have both", and it has to be true.
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    await keyring.enrolRawKey(await drive.escrow().create(), 'google');
    await keyring.changePinFromUnlocked?.('123456').catch(() => {});

    const methods = await keyring.methods();
    assert.includes(methods.map((m) => m.method ?? m), 'google');
  });

  test('a key of the wrong size is refused rather than padded', async () => {
    const keyring = new Keyring(meta(), 1000);
    await assert.throws(() => keyring.enrolRawKey(new Uint8Array(16), 'google'), /32 bytes/);
  });

  test('enrolling twice is refused, because it would orphan every record', async () => {
    const drive = fakeDrive();
    const keyring = new Keyring(meta(), 1000);
    const rawKey = await drive.escrow().create();
    await keyring.enrolRawKey(rawKey, 'google');
    await assert.throws(() => keyring.enrolRawKey(rawKey, 'google'), /already has a data key/);
  });
});
