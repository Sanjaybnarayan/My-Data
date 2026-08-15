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

/**
 * The device registry — the gate's last unbuilt piece, and a field that was
 * collected and never read.
 *
 * `deviceId` has arrived on every request since the first version of this
 * backend. It was parsed, put on the context, and **never looked at again** —
 * the same shape as every other defect this repository has found, except that
 * this one sits in the layer deciding who may reach a household's records.
 *
 * What it buys: a phone is lost, and today the only remedy is to remove the
 * person from the member list, which also locks out the laptop they still have.
 */
describe('the devices a household has signed in from', () => {
  const PHONE = 'dev_phone';
  const LAPTOP = 'dev_laptop';

  test('a device that calls is registered, with when it was first seen', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE, clientVersion: '4.1' });

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.length(data.devices, 1);
    assert.equal(data.devices[0].id, PHONE);
    assert.equal(data.devices[0].clientVersion, '4.1');
    assert.ok(data.devices[0].firstSeenAt, 'no first-seen stamp');
  });

  test('calling again updates it rather than adding a second', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE, clientVersion: '4.1' });
    api.post('ping', 'owner-token', {}, { deviceId: PHONE, clientVersion: '4.2' });

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.length(data.devices, 1);
    assert.equal(data.devices[0].clientVersion, '4.2');
  });

  test('a revoked device is refused, and told what to do about it', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });

    api.post('devices', 'owner-token', { op: 'revoke', deviceId: PHONE }, { deviceId: LAPTOP });

    const refused = api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    assert.not(refused.ok, 'a revoked device was served');
    assert.includes(refused.error, 'signed out by the household owner');
  });

  test('and the other device keeps working, which is the whole point', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });
    api.post('devices', 'owner-token', { op: 'revoke', deviceId: PHONE }, { deviceId: LAPTOP });

    assert.ok(api.post('ping', 'owner-token', {}, { deviceId: LAPTOP }).ok,
      'revoking one device locked out the other');
  });

  test('a revoked device is refused before its action runs, not after', () => {
    // A revoked device allowed to write and then refused the reply would still
    // have written.
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });
    api.post('devices', 'owner-token', { op: 'revoke', deviceId: PHONE }, { deviceId: LAPTOP });

    const before = api.props.getProperty('members');
    const refused = api.post('members', 'owner-token',
      { members: [{ email: SPOUSE, role: 'spouse' }] }, { deviceId: PHONE });

    assert.not(refused.ok, 'a revoked device wrote');
    assert.equal(api.props.getProperty('members'), before, 'the member list changed');
  });

  test('it can be restored', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });
    api.post('devices', 'owner-token', { op: 'revoke', deviceId: PHONE }, { deviceId: LAPTOP });
    api.post('devices', 'owner-token', { op: 'restore', deviceId: PHONE }, { deviceId: LAPTOP });

    assert.ok(api.post('ping', 'owner-token', {}, { deviceId: PHONE }).ok, 'restore did nothing');
  });

  test('you cannot revoke the device you are asking from', () => {
    // It would lock you out of the reply to your own request.
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    const refused = api.post('devices', 'owner-token',
      { op: 'revoke', deviceId: PHONE }, { deviceId: PHONE });

    assert.not(refused.ok, 'it revoked the calling device');
    assert.includes(refused.error, 'sign out from it instead');
  });

  test('a person sees their own devices and not somebody else’s', () => {
    const api = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });
    api.post('ping', 'spouse-token', {}, { deviceId: PHONE });

    const mine = api.post('devices', 'spouse-token', { op: 'list' }, { deviceId: PHONE });
    assert.length(mine.data.devices, 1);
    assert.equal(mine.data.devices[0].id, PHONE);

    const theirs = api.post('devices', 'spouse-token',
      { op: 'list', email: OWNER }, { deviceId: PHONE });
    assert.not(theirs.ok, 'a spouse read the owner’s devices');
    assert.equal(theirs.status, 403);
  });

  test('only the owner may sign somebody else out', () => {
    // The ability to sign another person out is the ability to lock them out.
    const api = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });

    const refused = api.post('devices', 'spouse-token',
      { op: 'revoke', email: OWNER, deviceId: LAPTOP }, { deviceId: PHONE });
    assert.not(refused.ok, 'a spouse revoked the owner’s device');

    assert.ok(api.post('ping', 'owner-token', {}, { deviceId: LAPTOP }).ok);
  });

  test('revoking a device that does not exist says so', () => {
    // Silence would read as "done" and leave somebody believing they had
    // signed out a phone they had not.
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: LAPTOP });
    const refused = api.post('devices', 'owner-token',
      { op: 'revoke', deviceId: 'dev_never_seen' }, { deviceId: LAPTOP });

    assert.not(refused.ok, 'revoking an unknown device reported success');
    assert.equal(refused.status, 404);
  });

  test('a client that sends no device id still works', () => {
    // Older clients do not send one, and locking them out on an upgrade would
    // be a denial of service dressed as a security improvement.
    const api = start();
    assert.ok(api.post('ping', 'owner-token').ok, 'a client with no device id was refused');
    assert.length(api.post('devices', 'owner-token', { op: 'list' }).data.devices, 0);
  });

  test('the registry cannot grow without limit', () => {
    // A client minting a fresh id per request would otherwise fill the store.
    const api = start();
    for (let i = 0; i < 30; i += 1) {
      api.post('ping', 'owner-token', {}, { deviceId: `dev_${i}` });
    }
    const { data } = api.post('devices', 'owner-token', { op: 'list' });
    assert.ok(data.devices.length <= 20, `${data.devices.length} devices kept`);
  });

  test('it holds nothing about what the device did', () => {
    // The gate: the policy server never holds household records.
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE, clientVersion: '4.1' });
    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });

    // Updated deliberately when `label` and `named` were added — the point of
    // asserting the exact list is that widening it is a decision somebody makes
    // rather than something that happens. A label is a name for a device, not a
    // record of what it did.
    assert.deep(Object.keys(data.devices[0]).sort(),
      ['clientVersion', 'firstSeenAt', 'id', 'label', 'lastSeenAt', 'named', 'revokedAt']);
  });
});

/**
 * Telling one device from another.
 *
 * The registry worked and was unusable: it asked an owner which of several
 * `dev_01M0…` was the phone they lost. A capability nobody can act on is not a
 * feature.
 */
describe('naming the devices', () => {
  const PHONE = 'dev_phone';
  const LAPTOP = 'dev_laptop';
  const seen = (api, id, label) =>
    api.post('ping', 'owner-token', {}, { deviceId: id, deviceLabel: label });

  test('a device is listed under the name it reported', () => {
    const api = start();
    seen(api, PHONE, 'iPhone · Safari');

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.equal(data.devices[0].label, 'iPhone · Safari');
    assert.not(data.devices[0].named, 'a reported label is not a chosen one');
  });

  test('the reported name refreshes while nobody has chosen one', () => {
    const api = start();
    seen(api, PHONE, 'iPhone · Safari');
    seen(api, PHONE, 'iPhone · Chrome');

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.equal(data.devices[0].label, 'iPhone · Chrome');
  });

  test('but never over a name a person typed', () => {
    // Somebody who called their old laptop "the one in the study" should not
    // find it renamed "Mac · Safari" the next time it syncs.
    const api = start();
    seen(api, LAPTOP, 'Mac · Safari');
    api.post('devices', 'owner-token',
      { op: 'name', deviceId: LAPTOP, label: 'the one in the study' }, { deviceId: PHONE });
    seen(api, LAPTOP, 'Mac · Safari');

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    const laptop = data.devices.find((d) => d.id === LAPTOP);
    assert.equal(laptop.label, 'the one in the study');
    assert.ok(laptop.named);
  });

  test('you may name the device you are using', () => {
    // Unlike revoking it, which would lock you out of your own reply.
    const api = start();
    seen(api, PHONE, 'iPhone · Safari');
    const named = api.post('devices', 'owner-token',
      { op: 'name', deviceId: PHONE, label: 'my phone' }, { deviceId: PHONE });

    assert.ok(named.ok, named.error);
    assert.equal(named.data.devices[0].label, 'my phone');
  });

  test('a name is trimmed and bounded', () => {
    // This is shown in a list; a label the length of a paragraph would push
    // everything else off the screen.
    const api = start();
    seen(api, PHONE, 'iPhone · Safari');
    const named = api.post('devices', 'owner-token',
      { op: 'name', deviceId: PHONE, label: `  ${'x'.repeat(200)}  ` }, { deviceId: PHONE });

    assert.equal(named.data.devices[0].label.length, 60);
  });

  test('clearing the name lets the reported one come back', () => {
    const api = start();
    seen(api, PHONE, 'iPhone · Safari');
    api.post('devices', 'owner-token',
      { op: 'name', deviceId: PHONE, label: 'mine' }, { deviceId: PHONE });
    api.post('devices', 'owner-token',
      { op: 'name', deviceId: PHONE, label: '' }, { deviceId: PHONE });
    seen(api, PHONE, 'iPhone · Chrome');

    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.equal(data.devices[0].label, 'iPhone · Chrome');
  });

  test('only the owner may rename somebody else’s device', () => {
    const api = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    seen(api, LAPTOP, 'Mac · Safari');

    const refused = api.post('devices', 'spouse-token',
      { op: 'name', email: OWNER, deviceId: LAPTOP, label: 'nope' }, { deviceId: PHONE });
    assert.not(refused.ok, 'a spouse renamed the owner’s device');
  });

  test('a device that reports no name is still listed', () => {
    const api = start();
    api.post('ping', 'owner-token', {}, { deviceId: PHONE });
    const { data } = api.post('devices', 'owner-token', { op: 'list' }, { deviceId: PHONE });
    assert.length(data.devices, 1);
    assert.equal(data.devices[0].label, '');
  });
});
