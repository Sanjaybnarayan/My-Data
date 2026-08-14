import { test, describe, assert, setSuite } from './harness.mjs';
import { backend } from './appsscript.mjs';

setSuite('backend');

/**
 * The Apps Script backend, run in Node against literal stubs.
 *
 * This is the boundary that decides which Google account may reach a
 * household's workbook, and until now it was the only part of this repository
 * with no tests at all — on the grounds that it runs in a different runtime.
 * It runs plain functions over a handful of globals, and a handful of globals
 * is a thing you can supply.
 */

const OWNER = 'owner@example.com';
const SPOUSE = 'spouse@example.com';
const STRANGER = 'someone@elsewhere.com';

const tokens = {
  'owner-token': { email: OWNER, expires_in: '3599' },
  'spouse-token': { email: SPOUSE, expires_in: '3599' },
  'stranger-token': { email: STRANGER, expires_in: '3599' },
  'expired-token': { email: OWNER, expires_in: '0' },
  'anonymous-token': { expires_in: '3599' },
};

const start = (properties) => backend({ owner: OWNER, tokens, properties });

/* ------------------------------------------------------------- admission */

describe('who may reach the backup', () => {
  test('the deploying account is admitted by identity', () => {
    const api = start();
    const caller = api.verifyToken('owner-token');
    assert.equal(caller.email, OWNER);
    assert.ok(caller.isOwner);
  });

  test('an account nobody added is refused, with a reason worth reading', () => {
    const api = start();
    let error;
    try { api.verifyToken('stranger-token'); } catch (err) { error = err; }

    assert.ok(error, 'a stranger was admitted');
    assert.equal(error.status, 403);
    assert.includes(error.message, 'has not been added to this household');
  });

  test('the person an account is is taken from the list, never the request', () => {
    // The identity binding the whole own-record rule rests on. Only the owner
    // can write this list, which is what makes it safe to widen access from —
    // a caller naming the person they are would be a caller claiming somebody
    // else's records.
    const bound = start({
      members: JSON.stringify([{ email: SPOUSE, role: 'spouse', personId: 'p-asha' }]),
    });
    assert.equal(bound.verifyToken('spouse-token').personId, 'p-asha');

    // And an entry written before this existed carries none, which means no
    // own-record access rather than access to everything.
    const older = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    assert.equal(older.verifyToken('spouse-token').personId, '');
  });

  test('an admitted account is let in, and is not an owner', () => {
    // This is the whole bug the list exists to fix: the documented way to add
    // a family member was to sign in with their own Google account, and every
    // sync after that sign-in used to return 403.
    const api = start({ members: JSON.stringify([SPOUSE]) });
    const caller = api.verifyToken('spouse-token');

    assert.equal(caller.email, SPOUSE);
    assert.not(caller.isOwner, 'a member must not be treated as the owner');
  });

  test('the list is matched without regard to case', () => {
    const api = start({ members: JSON.stringify(['Spouse@Example.COM']) });
    assert.equal(api.verifyToken('spouse-token').email, SPOUSE);
  });

  test('a corrupted list refuses everyone but the owner rather than throwing', () => {
    // Failing closed: a properties value somebody hand-edited into nonsense
    // must not become "admit anybody".
    const api = start({ members: 'not json at all' });
    assert.equal(api.verifyToken('owner-token').email, OWNER);
    assert.throws(() => api.verifyToken('spouse-token'), /not been added/);
  });

  test('a request with no token, an expired one, or a rejected one is 401', () => {
    const api = start();
    for (const [token, why] of [['', 'no token'], ['expired-token', 'expired'], ['nonsense', 'rejected']]) {
      let error;
      try { api.verifyToken(token); } catch (err) { error = err; }
      assert.equal(error?.status, 401, why);
    }
  });

  test('a token that does not say whose it is proves nothing', () => {
    let error;
    try { start().verifyToken('anonymous-token'); } catch (err) { error = err; }
    assert.equal(error?.status, 401);
  });
});

/* ----------------------------------------------------------- the cache */

describe('caching an identity must not cache the permission', () => {
  test('a verified token is not re-fetched from Google', () => {
    const api = start({ members: JSON.stringify([SPOUSE]) });
    api.verifyToken('spouse-token');
    const after = api.fetched.length;
    api.verifyToken('spouse-token');

    assert.equal(api.fetched.length, after, 'the token was verified twice over the network');
  });

  test('removing somebody takes effect at once, not when their cache expires', () => {
    // The failure this guards against: a member removed after a sync keeps
    // working for another five minutes because their identity was cached
    // together with the decision to admit them.
    const api = start({ members: JSON.stringify([SPOUSE]) });
    assert.equal(api.verifyToken('spouse-token').email, SPOUSE);

    api.props.setProperty('members', JSON.stringify([]));
    assert.throws(() => api.verifyToken('spouse-token'), /not been added/);
  });
});

/* --------------------------------------------------------- managing it */

describe('managing the list', () => {
  test('the owner can admit somebody', () => {
    const api = start();
    const result = api.manageMembers({ emails: [SPOUSE] },
      { email: OWNER, owner: OWNER, isOwner: true });

    assert.deep(result.members, [{ email: SPOUSE, role: 'guest' }]);
    assert.deep(JSON.parse(api.props.getProperty('members')),
      [{ email: SPOUSE, role: 'guest' }]);
  });

  test('an unnamed role is guest, never the most privileged one', () => {
    // A typo in a role should narrow what somebody may do, not widen it.
    const api = start();
    const result = api.manageMembers(
      { emails: [{ email: SPOUSE, role: 'archduke' }, { email: STRANGER, role: 'owner' }] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );
    assert.deep(result.members.map((m) => m.role), ['guest', 'guest']);
  });

  test('a role the owner gave is the role that is stored', () => {
    const api = start();
    const result = api.manageMembers(
      { emails: [{ email: SPOUSE, role: 'spouse' }, { email: STRANGER, role: 'child' }] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );
    assert.deep(result.members,
      [{ email: SPOUSE, role: 'spouse' }, { email: STRANGER, role: 'child' }]);
  });

  test('a member cannot admit anybody, because that would make them an owner', () => {
    const api = start({ members: JSON.stringify([SPOUSE]) });
    let error;
    try {
      api.manageMembers({ emails: [SPOUSE, STRANGER] },
        { email: SPOUSE, owner: OWNER, isOwner: false });
    } catch (err) { error = err; }

    assert.equal(error?.status, 403);
    assert.deep(JSON.parse(api.props.getProperty('members')), [SPOUSE], 'the list was changed anyway');
    // A deployment written before roles existed still reads, and one written
    // before `personId` existed reads as having none — which means no
    // own-record access rather than access to everything.
    assert.deep(api.members(), [{ email: SPOUSE, role: 'spouse', personId: '' }],
      'and a deployment written before roles existed still reads');
  });

  test('the owner cannot be written into the list', () => {
    // It is admitted by identity. Storing it would invite somebody to remove
    // it, and a household that removed its owner would be locked out of its
    // own workbook with no way back in.
    const api = start();
    const result = api.manageMembers({ emails: [OWNER, SPOUSE] },
      { email: OWNER, owner: OWNER, isOwner: true });

    assert.deep(result.members.map((m) => m.email), [SPOUSE]);
  });

  test('rubbish, duplicates and empties are dropped rather than stored', () => {
    const api = start();
    const result = api.manageMembers(
      { emails: [SPOUSE, SPOUSE, '', 'not-an-address', '  SPOUSE@EXAMPLE.COM '] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );
    assert.deep(result.members.map((m) => m.email), [SPOUSE]);
  });

  test('the list has a ceiling, so one call cannot store a mailing list', () => {
    const api = start();
    const many = Array.from({ length: 200 }, (_, i) => `p${i}@example.com`);
    const result = api.manageMembers({ emails: many },
      { email: OWNER, owner: OWNER, isOwner: true });

    assert.ok(result.members.length <= 50, `stored ${result.members.length}`);
  });

  test('anyone admitted may read the list', () => {
    const api = start({ members: JSON.stringify([SPOUSE]) });
    const result = api.manageMembers({}, { email: SPOUSE, owner: OWNER, isOwner: false });

    assert.deep(result.members, [{ email: SPOUSE, role: 'spouse', personId: '' }]);
    assert.equal(result.owner, OWNER);
    assert.not(result.isOwner);
  });
});

/* ------------------------------------------------------------ the shape */

describe('the request contract', () => {
  test('a rejected request answers with ok:false and a status, not an exception', () => {
    const body = start().post('members', 'stranger-token');
    assert.not(body.ok);
    assert.equal(body.status, 403);
    assert.not(body.retryable, 'a refusal must not be retried forever by the outbox');
  });

  test('an unknown action is a 400 rather than a 500', () => {
    const body = start().post('teleport', 'owner-token');
    assert.not(body.ok);
    assert.equal(body.status, 400);
    assert.includes(body.error, 'unknown action');
  });

  test('a successful call answers with ok:true and the data under `data`', () => {
    const body = start().post('members', 'owner-token');
    assert.ok(body.ok);
    assert.equal(body.data.owner, OWNER);
  });

  test('mail is refused when Gmail.gs was not deployed', () => {
    // A household that would rather not grant the Gmail scope deletes the
    // file. That has to read as a clear refusal, not a reference error.
    const body = start().post('mail', 'owner-token', { query: 'from:zomato.com' });
    assert.not(body.ok);
    assert.equal(body.status, 501);
    assert.includes(body.error, 'Gmail.gs');
  });

  test('opening the deployment in a browser explains itself', () => {
    // What everybody does first when a setup does not work.
    const text = JSON.parse(start().doGet().getContent());
    assert.ok(text.ok);
    assert.includes(text.message, 'POST');
  });
});
