/**
 * FamilyOS — Apps Script backend.
 *
 * One web app, deployed as **"execute as me"** — the household member who
 * pasted this in. `appsscript.json` says `USER_DEPLOYING` and `docs/SETUP.md`
 * tells you to pick *Execute as: Me*, and it has to be that way: `sheetMap`,
 * the Drive tree and the one-time-code directory all live in
 * `PropertiesService.getUserProperties()`, so under the other setting every
 * member would read their own empty copy and sync would work for nobody.
 *
 * This paragraph asserted the opposite for as long as the file existed.
 * `docs/ARCHITECTURE.md` asserted it too, was corrected, and got a test — and
 * the test named that one document, so the same claim went on standing here,
 * one directory away from the check written to stop it. The test now derives
 * the file list instead of naming one, which is why this comment may not
 * restate the wrong model even to disown it; that account is in
 * `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md`.
 *
 * The correction is not cosmetic, because the wrong version was load-bearing.
 * Under "execute as me" **every request runs with the owner's full Sheets and
 * Drive authority**, whoever sent it. Google separates nobody here. What
 * separates callers is `verifyToken`, `admit` and `Policy.gs` — not a second
 * line behind Google's own isolation, but the only line there is.
 *
 * ## The contract
 *
 *   POST /exec   { action, token, deviceId, clientVersion, payload }
 *   →            { ok: true, data: … } | { ok: false, error, retryable }
 *
 * The body arrives as `text/plain` because Apps Script does not answer the
 * CORS preflight that a JSON content type would trigger. That is the client's
 * constraint too — see `js/sync/transport.js`.
 *
 * ## Why the token is verified, and why nothing else would do
 *
 * A web app deployed to "anyone" answers whoever posts to the URL, and this
 * one answers it holding the owner's credentials. Apps Script tells the script
 * nothing about who called: there is no session, no caller identity, nothing
 * to key an authorisation decision on. `verifyToken` supplies it, by spending
 * the bearer token against Google's tokeninfo endpoint and reading back the
 * address it was issued to.
 *
 * So the check is not a supplement to something Google is already doing. It is
 * the step that turns an anonymous POST into a named caller, and every
 * decision after it — `admit`, the role, `Policy.gs`, the row filter — is
 * downstream of the address it returns. Remove it and the deployment serves
 * the household's spreadsheet to anybody who has the URL.
 *
 * The two one-time-code actions run *before* it, which is the one exception
 * and the reason `Otp.gs` carries its own limits and its own lock.
 *
 * ## Concurrency
 *
 * Sheets has no transactions, so both write paths are serialised by
 * `LockService.getScriptLock()` — documented as preventing *any* user from
 * running the guarded section concurrently. `withLock` guards the
 * authenticated actions, `withScriptLock` the pre-auth one-time-code path;
 * they differ only in the message a refused caller gets.
 *
 * `withLock` used to take `getUserLock()`, documented as "only once per user",
 * while this paragraph claimed a script lock serialised writes. Which of the
 * two was right mattered: `getUserLock` keys on the **active** user, and a web
 * app deployed as `USER_DEPLOYING` does not generally expose the caller as the
 * active user, so whether two devices excluded each other at all was a
 * question nothing here could answer. `Otp.gs` records the analogous behaviour
 * for `CacheService.getUserCache()` and reaches for `getScriptCache()` because
 * of it.
 *
 * `sheetPush` reads `getLastRow()` and writes at `lastRow + 1`. Two pushes
 * that both read the same last row write the same range, and the second
 * silently replaces the first — records accepted, acknowledged and gone. That
 * is not a risk worth carrying to keep an exclusion nobody could describe, so
 * the lock is now the one whose exclusion is documented.
 *
 * What it costs: two members pushing at the same moment serialise instead of
 * running side by side, and a caller that cannot get the lock inside
 * `LOCK_TIMEOUT_MS` is refused with a retryable 429 its outbox retries. A
 * script lock is scoped to the deployment, and a deployment is one household.
 *
 * Reads are unlocked; a pull that misses a row in flight gets it next time,
 * because the cursor only advances past what was actually returned.
 */

/* eslint-env googleappsscript */
/* global SpreadsheetApp, DriveApp, PropertiesService, LockService, CacheService,
          ContentService, UrlFetchApp, Utilities, Session, schemaEnsure,
          otpIsPublic, otpRequest, otpVerify,
          sheetPull, sheetPush, sheetCounts, driveEnsureTree, driveUpload,
          driveDownload, driveVersions, auditAppend */

var PROP = PropertiesService.getUserProperties();
var LOCK_TIMEOUT_MS = 30 * 1000;

/** Requests per user per minute. A runaway client should not exhaust quota. */
var RATE_LIMIT = 120;

function doPost(e) {
  var started = Date.now();
  var request;

  try {
    request = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply(false, null, 'the request body was not JSON', 400, false);
  }

  /*
   * The one path that runs before `verifyToken`, and the only one.
   *
   * A one-time code has to be requestable by somebody who has not signed in —
   * that is what it is for — so these two actions are answered here. They
   * carry their own limits (see Otp.gs), because `enforceRateLimit` keys on
   * the verified email and uses a per-session cache, and neither of those
   * means anything to a caller who has not authenticated.
   *
   * `otpIsPublic` reads a list rather than testing a prefix, so naming a new
   * action `otp.anything` does not make it public by accident.
   */
  try {
    if (typeof otpIsPublic === 'function' && otpIsPublic(request.action)) {
      var payload = request.payload || {};
      // Serialised: both actions read a counter, change it and write it back.
      var result = withScriptLock(function () {
        return request.action === 'otp.request' ? otpRequest(payload) : otpVerify(payload);
      });
      return reply(true, result);
    }
  } catch (err) {
    var otpStatus = err.status || 500;
    log('error', request.action, err.message, Date.now() - started);
    /*
     * Same rule as the authenticated catch below, which this had drifted from:
     * `otpStatus >= 500` alone marked every 429 here not worth retrying.
     *
     * Three of them mean "later", not "never" — the two hourly caps and the
     * script lock — and the client is told as much in words while the flag
     * said the opposite. `TransportError` in `js/core/errors.js` calls 408 and
     * 429 retryable by default and then defers to whatever the body says, so
     * the body saying `false` is what decided it.
     */
    return reply(false, null, err.message, otpStatus, otpStatus >= 500 || otpStatus === 429);
  }

  try {
    var caller = verifyToken(request.token);
    enforceRateLimit(caller.email);

    var deviceId = String(request.deviceId || '');
    // Checked before the action runs, not after. A revoked device that got its
    // write in and was refused the reply would still have written.
    noteDevice(caller.email, deviceId, String(request.clientVersion || ''),
      String(request.deviceLabel || ''));

    // Everything `admit` resolved, not a subset of it.
    //
    // `role` and `personId` were missing here, and Sheets.gs reads both:
    // `(context && context.role) || 'guest'`. A guest may write nothing and
    // read nothing, so every push was refused row by row for every caller
    // including the owner, and every pull came back empty — the whole
    // server-side policy evaluated against a constant instead of against the
    // person making the request.
    //
    // It failed closed, so nobody got access they should not have. What it
    // cost was the off-device copy a household believed it had.
    //
    // The tests could not see it: policy.test.mjs calls `sheetPush` with a
    // context it builds itself, including a role, and backend.test.mjs goes
    // through `doPost` but never pushed. Both ends covered, the wiring between
    // them not. `pushes what the caller's role permits` now goes end to end.
    var data = dispatch(request.action, request.payload || {}, {
      email: caller.email,
      owner: caller.owner,
      isOwner: caller.isOwner,
      role: caller.role,
      personId: caller.personId,
      deviceId: deviceId,
      clientVersion: String(request.clientVersion || ''),
    });

    return reply(true, data);
  } catch (err) {
    var status = err.status || 500;
    log('error', request && request.action, err.message, Date.now() - started);
    return reply(false, null, err.message, status, status >= 500 || status === 429);
  }
}

/**
 * A GET is not part of the protocol. It exists so that opening the deployment
 * URL in a browser says something useful instead of an Apps Script error page,
 * which is what people do first when a setup does not work.
 */
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({
      ok: true,
      service: 'FamilyOS',
      version: '1.0.0',
      message: 'This endpoint answers POST requests from the FamilyOS app. '
        + 'Seeing this means the deployment is reachable and the URL is correct.',
    }, null, 2))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch(action, payload, context) {
  switch (action) {
    case 'bootstrap': return withLock(function () { return bootstrap(payload, context); });
    case 'schema':    return withLock(function () { return schemaEnsure(payload.manifest, workbook()); });
    case 'push':      return withLock(function () { return sheetPush(payload.changes, workbook(), context); });
    case 'pull':      return sheetPull(payload.cursors || {}, payload.limit || 500, workbook(), context);
    case 'audit':     return withLock(function () { return auditAppend(payload.entries, workbook(), context); });
    case 'upload':    return driveUpload(payload, context);
    case 'download':  return driveDownload(payload.fileId);
    case 'versions':  return driveVersions(payload.fileId);
    case 'trash':     return driveTrash(payload.fileId);
    case 'folders':   return { folders: drivePersonFolders() };
    // Reading mail is opt-in: a household that would rather not grant the
    // Gmail scope deletes Gmail.gs and its line in the manifest, and this
    // says so rather than failing with a reference error. See Gmail.gs for
    // why the query, not the scope, is what limits this.
    case 'mail':
      if (typeof gmailSearch !== 'function') {
        throw fail('this deployment does not read mail — Gmail.gs is not installed', 501);
      }
      return gmailSearch(payload, context);
    // Sign-in by code, which is off until an owner turns it on. Guarded the
    // same way as `mail`: a household that removed Otp.gs from the project gets
    // a refusal that names the reason rather than a reference error.
    case 'signin':
      if (typeof otpEscrowManage !== 'function') {
        throw fail('this deployment does not offer sign-in by code — Otp.gs is not installed', 501);
      }
      return otpEscrowManage(payload, context);
    case 'members':   return manageMembers(payload, context);
    case 'devices':   return manageDevices(payload, context);
    case 'verify':    return { counts: sheetCounts(workbook()) };
    case 'ping':      return {
      ok: true, user: context.email, role: context.role, at: new Date().toISOString(),
      // Devices this person has never said they recognise, not counting the one
      // they are holding. Answered here rather than from its own request
      // because `ping` is already made and a household should not have to go
      // looking for this.
      unrecognisedDevices: unrecognisedDevices(context.email, context.deviceId),
    };
    default:
      throw fail('unknown action: ' + action, 400);
  }
}

/* ---------------------------------------------------------------- devices */

/**
 * The device registry the gate asked for, and the field that was collected and
 * never read.
 *
 * `deviceId` arrived on every request from the first version of this backend,
 * was parsed on line 64, and was **never looked at again**. That is the same
 * shape as every other defect this repository has turned up — a value present,
 * structured and ignored — except that this one is in the layer that decides
 * who may reach a household's records.
 *
 * ## What it is for
 *
 * A phone is lost. Today the only remedy is to remove the person from the
 * member list, which also locks out the laptop they still have. A registry
 * lets an owner revoke **one device** and leave the rest working.
 *
 * ## Why the check is here and not in `dispatch`
 *
 * A revoked device that was allowed to run its action and then refused the
 * reply would still have written. The refusal has to come first.
 *
 * ## What it deliberately does not hold
 *
 * No household records, per the gate: an email, an opaque id the client
 * generated, a version string and two timestamps. Nothing here says what the
 * device did, only that it called.
 */
function deviceKey(email) {
  return 'devices:' + String(email || '').toLowerCase();
}

function readDevices(email) {
  var raw = PROP.getProperty(deviceKey(email));
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === '[object Array]' ? parsed : [];
  } catch (err) {
    // A corrupt entry is not a reason to refuse everybody. It is a reason to
    // start again from empty, which re-registers on the next request.
    return [];
  }
}

/**
 * Record that a device called, and refuse it if it has been revoked.
 *
 * A request with no device id is allowed through and not registered. Older
 * clients do not send one, and locking them out on an upgrade would be a
 * denial of service dressed as a security improvement — the member list still
 * gates them, exactly as it did before this existed.
 */
function noteDevice(email, deviceId, clientVersion, deviceLabel) {
  if (!deviceId) return;

  var devices = readDevices(email);
  var now = new Date().toISOString();
  var found = null;

  for (var i = 0; i < devices.length; i++) {
    if (devices[i].id === deviceId) { found = devices[i]; break; }
  }

  if (found && found.revokedAt) {
    // 403, not 401: the token is fine and signing in again will not help. The
    // message says what to do rather than leaving somebody retrying.
    throw fail('this device has been signed out by the household owner — '
      + 'ask them to allow it again', 403);
  }

  if (found) {
    found.lastSeenAt = now;
    found.clientVersion = clientVersion || found.clientVersion || '';
    // The reported label refreshes, but never over a name a person typed.
    // Somebody who called their old laptop "the one in the study" should not
    // find it renamed "Mac · Safari" the next time it syncs.
    if (!found.named) found.label = deviceLabel || found.label || '';
  } else {
    // Bounded: a client that minted a fresh id per request would otherwise
    // grow this without limit. The oldest are dropped, because the newest are
    // the ones somebody is holding.
    devices.push({
      id: deviceId,
      // A guess from the user-agent, sent by the client. Worth having because
      // the alternative was asking an owner which of several `dev_01M0…` was
      // the phone they lost.
      label: deviceLabel || '',
      // Whether a person has since said what this device is. Once true, the
      // reported label stops overwriting it.
      named: false,
      // Empty until somebody says they recognise it. A device that appears and
      // is never mentioned is exactly the one worth mentioning: the registry
      // could be read, but nothing ever said "something new signed in", so an
      // unrecognised device sat unnoticed until a person happened to look.
      acknowledgedAt: '',
      firstSeenAt: now,
      lastSeenAt: now,
      clientVersion: clientVersion || '',
      revokedAt: '',
    });
    devices.sort(function (a, b) {
      return String(b.lastSeenAt).localeCompare(String(a.lastSeenAt));
    });
    devices = devices.slice(0, 20);
  }

  PROP.setProperty(deviceKey(email), JSON.stringify(devices));
}

/**
 * How many devices this person has never said they recognise.
 *
 * The one being used is excluded: it acknowledges itself by being the thing in
 * their hand, and counting it would mean every household is warned about
 * themselves on the day they install this.
 *
 * A revoked device is excluded too — it has already been dealt with, and
 * nagging about it afterwards teaches people to dismiss the notice.
 */
function unrecognisedDevices(email, currentDeviceId) {
  var devices = readDevices(email);
  var count = 0;
  for (var i = 0; i < devices.length; i++) {
    if (devices[i].id === currentDeviceId) continue;
    if (devices[i].revokedAt) continue;
    if (devices[i].acknowledgedAt) continue;
    count++;
  }
  return count;
}

/**
 * List, revoke, restore, name and acknowledge devices.
 *
 * Anybody may list **their own**. Only the owner may see or revoke somebody
 * else's, for the same reason only the owner may edit the member list: the
 * ability to sign another person out is the ability to lock them out.
 */
function manageDevices(payload, context) {
  var action = String(payload.op || 'list');
  var subject = String(payload.email || context.email).toLowerCase();

  if (subject !== String(context.email).toLowerCase() && !context.isOwner) {
    throw fail('only the household owner may manage another person’s devices', 403);
  }

  if (action === 'list') {
    return { email: subject, devices: readDevices(subject) };
  }

  if (action !== 'revoke' && action !== 'restore' && action !== 'name'
      && action !== 'acknowledge') {
    throw fail('unknown device action: ' + action, 400);
  }

  var id = String(payload.deviceId || '');
  if (!id) throw fail('which device?', 400);

  // Revoking the device you are asking from would lock you out of the reply to
  // your own request. Refused, rather than half-applied. Naming it is fine —
  // that is how somebody labels the device in front of them.
  if (action === 'revoke' && id === context.deviceId) {
    throw fail('that is the device you are using — sign out from it instead', 400);
  }

  var devices = readDevices(subject);
  var changed = false;

  for (var i = 0; i < devices.length; i++) {
    if (devices[i].id !== id) continue;
    if (action === 'acknowledge') {
      devices[i].acknowledgedAt = new Date().toISOString();
    } else if (action === 'name') {
      // Trimmed and bounded: this is shown in a list, and a label the length of
      // a paragraph would push everything else off the screen.
      devices[i].label = String(payload.label || '').trim().slice(0, 60);
      // Marked, so the next sync does not overwrite what a person typed.
      devices[i].named = Boolean(devices[i].label);
    } else {
      devices[i].revokedAt = action === 'revoke' ? new Date().toISOString() : '';
    }
    changed = true;
  }

  if (!changed) throw fail('no such device', 404);

  PROP.setProperty(deviceKey(subject), JSON.stringify(devices));
  return { email: subject, devices: devices };
}

/* --------------------------------------------------------------- identity */

/**
 * The Google accounts allowed to use this backend.
 *
 * The account that deployed the script is always one of them and cannot be
 * removed — it is the account the script *runs as*, so a household that
 * removed it would have locked itself out of its own workbook.
 *
 * Everybody else is on this list, which the owner maintains from Settings.
 * Without it the check below would compare every caller against the deployer
 * and refuse the whole family, which is what it used to do: the documented
 * "sign in with their own Google account and sync" was not possible.
 *
 * Membership is not a substitute for encryption. A member can read the rows
 * in the workbook, and the sensitive fields in those rows are ciphertext they
 * cannot decrypt without the household's data key, which never goes near
 * Google. This list decides who may *reach* the backup, not who can read it.
 */
function members() {
  var raw = PROP.getProperty('members');
  if (!raw) return [];
  try {
    var list = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i];
      // Read forward from the old shape. Deployments written before roles
      // existed hold a plain array of addresses, and rewriting them on read
      // would need a write the caller may not be allowed to make. So the old
      // shape is understood in place, and takes the role it always behaved as
      // — every admitted account could read and write everything.
      if (typeof entry === 'string') {
        out.push({ email: String(entry).toLowerCase(), role: 'spouse', personId: '' });
      } else if (entry && entry.email) {
        out.push({
          email: String(entry.email).toLowerCase(),
          role: roleRank(entry.role) >= 0 ? entry.role : 'guest',
          // Which person in the household this account *is*. Only the owner
          // can set it, because only the owner can write this list — which is
          // what makes it safe to widen access from. Absent on every entry
          // written before this existed, and absent means no own-record
          // access rather than access to everything.
          personId: entry.personId ? String(entry.personId) : '',
        });
      }
    }
    return out;
  } catch (err) {
    return [];
  }
}

/**
 * Which person in the household the owner is, or '' if they have not said.
 *
 * A property rather than a list entry, because the owner is never in the list
 * — `manageMembers` refuses to store them, so that nobody can remove the owner
 * or downgrade their role by editing it. That protection is why this needs
 * somewhere else to live.
 */
function ownerPersonId() {
  return String(PROP.getProperty('ownerPersonId') || '');
}

/**
 * A record id and nothing else.
 *
 * Shared by both writers, because two copies of a validation rule is two
 * places for it to drift — and this one decides whose records a caller may
 * reach, so drifting apart would widen access on one path and not the other.
 */
function cleanPersonId(value) {
  var id = String(value || '').trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : '';
}

/** The member entry for an address, or null. */
function memberFor(email, list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].email === email) return list[i];
  }
  return null;
}

/**
 * Verify the bearer token with Google's tokeninfo endpoint and confirm it
 * belongs to an account this household has admitted. Results are cached for
 * five minutes: a sync run makes several calls, and a network round trip per
 * call would double the latency of every one of them.
 */
function verifyToken(token) {
  if (!token) throw fail('no access token was supplied', 401);

  var cache = CacheService.getUserCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));

  var cached = cache.get(key);
  // Re-checked against the list on every call rather than cached with it, so
  // removing somebody takes effect at once instead of up to five minutes later.
  if (cached) return admit(cached);

  var response = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?access_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true },
  );

  if (response.getResponseCode() !== 200) {
    throw fail('the access token was rejected by Google', 401);
  }

  var info = JSON.parse(response.getContentText());
  if (info.expires_in && Number(info.expires_in) <= 0) {
    throw fail('the access token has expired', 401);
  }

  var email = String(info.email || '').toLowerCase();
  if (!email) throw fail('the access token does not say which account it is for', 401);

  cache.put(key, email, 300);
  return admit(email);
}

/**
 * Decide whether an already-identified account may use this backend.
 *
 * Separate from the token check so that a cached token is still measured
 * against the current membership list — the whole point of removing somebody
 * is that it takes effect now.
 */
function admit(email) {
  var owner = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var isOwner = Boolean(owner) && email === owner;

  if (isOwner) {
    /*
     * The owner is admitted by identity and is deliberately not in the member
     * list, so the personId that travels with every other caller has nowhere
     * to come from. It gets its own property.
     *
     * Empty until the owner says which person they are, and empty means the
     * same thing here as anywhere else: no own-record access, and — since
     * `sheetPush` began checking it — no sending chat as anybody. That is a
     * refusal the owner can act on, and it is the safe direction: the
     * alternative is a rule that does not apply to the one account that can
     * do the most.
     */
    return {
      email: email, owner: owner, isOwner: true, role: 'owner',
      personId: ownerPersonId(),
    };
  }

  var entry = memberFor(email, members());
  if (!entry) {
    throw fail('this Google account has not been added to this household — '
      + 'the owner can add it in Settings', 403);
  }

  // The role travels with the identity, from here, and is never taken from
  // the request. A caller telling the backend what role it has would be a
  // caller granting itself one.
  // `personId` travels with the identity for the same reason the role does:
  // taken from the list the owner controls, never from the request. A caller
  // naming the person they are would be a caller claiming somebody else's
  // records.
  return {
    email: email, owner: owner, isOwner: false,
    role: entry.role, personId: entry.personId || '',
  };
}

/**
 * Read or replace the list of accounts allowed to reach this backend.
 *
 * Only the owner may change it, and only the owner because that is the one
 * identity this script can establish without consulting a list it is being
 * asked to rewrite. A member who could add members would be an owner.
 *
 * Reading is open to any admitted account: somebody ought to be able to see
 * who else is in the household they are already syncing with.
 */
function manageMembers(payload, context) {
  if (payload && payload.emails) {
    if (!context.isOwner) {
      throw fail('only the account that deployed this backend can change who may use it', 403);
    }

    var clean = [];
    var seen = {};
    for (var i = 0; i < payload.emails.length && i < 50; i++) {
      var given = payload.emails[i];
      var email = String((given && given.email) || given || '').trim().toLowerCase();
      // An unnamed or unknown role is `guest`, never the most privileged one.
      // A typo in a role should narrow what somebody may do, not widen it.
      var role = given && given.role;
      if (roleRank(role) < 0 || role === 'owner') role = 'guest';

      /*
       * `personId` is kept, and until now it was not.
       *
       * `members()` reads it, with a comment explaining that it is what lets a
       * child reach their own health record, and says it is "absent on every
       * entry written before this existed". That was true of **every** entry:
       * this loop built `{ email, role }` and dropped the field, so nothing
       * ever wrote one. Settings → Household has had a person picker the whole
       * time; the choice travelled here and was discarded.
       *
       * So `ownRecordAllows` could never fire on the server for anybody, and
       * `tests/policy.test.mjs` could not see it because it builds its own
       * context with a `personId` already in it — both ends covered, the wiring
       * between them not. That is the same sentence `doPost` carries about
       * `role` and `personId` going missing on the way in; this is the other
       * half of it.
       */
      // A record id, not an address or a sentence. The owner picks this from a
      // list, so anything else arrived from a client that built its own
      // request — and a personId is what widens access.
      var personId = cleanPersonId(given && given.personId);

      // The owner is admitted by identity, never by list. Storing it would
      // invite somebody to remove it and lock the household out — and it would
      // also be the one entry through which the owner's own role could be
      // downgraded by editing a list.
      if (email && email.indexOf('@') > 0 && email !== context.owner && !seen[email]) {
        seen[email] = true;
        clean.push({ email: email, role: role, personId: personId });
      }
    }

    PROP.setProperty('members', JSON.stringify(clean));

    /*
     * The owner's own binding travels with the same call, because it is the
     * same screen and the same decision — "which person is each account".
     * Only ever set from a request the owner made; `isOwner` was checked at
     * the top of this branch.
     *
     * Absent means leave it alone rather than clear it: a client that sends
     * only `emails` must not silently unbind the owner and lock them out of
     * sending chat.
     */
    if (payload.ownerPersonId !== undefined) {
      PROP.setProperty('ownerPersonId', cleanPersonId(payload.ownerPersonId));
    }

    log('members', context.email, clean.length + ' accounts', 0);
    return { owner: context.owner, members: clean, ownerPersonId: ownerPersonId() };
  }

  return { owner: context.owner, members: members(), isOwner: context.isOwner,
    role: context.role, ownerPersonId: ownerPersonId() };
}

/** A token bucket in the per-user cache. Cheap, and enough to stop a loop. */
function enforceRateLimit(email) {
  var cache = CacheService.getUserCache();
  var key = 'rate_' + email + '_' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  if (count > RATE_LIMIT) {
    throw fail('too many requests — slow down', 429);
  }
}

/* ------------------------------------------------------------- workbook */

function workbook() {
  var id = PROP.getProperty('workbookId');
  if (!id) throw fail('this account has no FamilyOS workbook yet — run bootstrap', 409);
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw fail('the FamilyOS workbook could not be opened; it may have been deleted', 410);
  }
}

/**
 * Create the workbook, the tabs and the Drive tree. Idempotent by design: a
 * second call finds what the first created and returns the same ids, so a
 * retry after a timeout cannot leave a family with two workbooks.
 */
function bootstrap(payload, context) {
  var existingId = PROP.getProperty('workbookId');
  var book;

  if (existingId) {
    try {
      book = SpreadsheetApp.openById(existingId);
    } catch (err) {
      book = null; // deleted from Drive; fall through and make another
    }
  }

  if (!book) {
    book = SpreadsheetApp.create('FamilyOS Data');
    PROP.setProperty('workbookId', book.getId());
    // The default sheet has no place in the schema and confuses the migration.
    var first = book.getSheets()[0];
    if (first.getName() === 'Sheet1') first.setName('_Meta');
  }

  var tree = driveEnsureTree();
  schemaEnsure(payload.manifest, book);

  // The workbook belongs in the FamilyOS folder, not loose in My Drive.
  try {
    var file = DriveApp.getFileById(book.getId());
    tree.root.addFile(file);
    DriveApp.getRootFolder().removeFile(file);
  } catch (err) {
    // Moving is a convenience; failing it must not fail the bootstrap.
  }

  log('bootstrap', context.email, book.getId(), 0);

  return {
    workbookId: book.getId(),
    workbookUrl: book.getUrl(),
    rootFolderId: tree.root.getId(),
    documentsFolderId: tree.documents.getId(),
  };
}

/* --------------------------------------------------------------- plumbing */

/**
 * Serialise writers. Sheets applies each `setValues` atomically but nothing
 * co-ordinates two scripts appending at once, and two devices pushing
 * simultaneously would otherwise both compute the same "next empty row".
 *
 * The script lock, not the user lock this took until now. See "Concurrency" at
 * the top of the file: a user lock keys on the active user, and this
 * deployment does not reliably have one, so what it excluded was undefined.
 * The comment above described a script lock the whole time.
 */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw fail('another device is writing — try again shortly', 429);
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Serialise the pre-auth one-time-code path.
 *
 * This exists apart from `withLock` for the message, not the lock: both now
 * take `getScriptLock()`, and a caller refused here must not be told "another
 * device is writing". This endpoint answers strangers, and that sentence would
 * tell one that somebody else is using the deployment right now.
 *
 * The pre-auth path took no lock at all before this — not the wrong one, none.
 * `withLock` was the obvious candidate and was not reused, because at the time
 * it took `getUserLock()`, documented as "only once per user", which keys on
 * the active user, and an anonymous caller has none. **Whether that would have
 * excluded one anonymous caller from another was never established** — not
 * here, and not in Google's documentation. `Otp.gs` records the analogous
 * behaviour for `getUserCache()`, which is per-session for such a caller, and
 * that is the shape the reasoning rested on: an inference from a neighbouring
 * service, not a measurement.
 *
 * `getScriptLock()` needs no such inference — it is documented as preventing
 * *any* user from running the guarded section concurrently — so it was taken
 * here rather than waiting on the question. `withLock` has since been moved to
 * it for the same reason, which is why the two are now the same lock.
 *
 * Without it, both actions were a read, a change and a write with nothing in
 * between:
 *
 *   - `otpVerify` reads the stored record, increments `attempts` and writes
 *     it back. Two wrong guesses in flight together both read `attempts: 0`
 *     and both write `1`, so the second guess costs nothing.
 *   - Worse, on the matching path it reads the record, matches the hash and
 *     only then removes the key. Two executions holding the same correct code
 *     both match and both are handed the escrow that unwraps the data key —
 *     a code that is supposed to work once working twice.
 *   - `otpRequest` has the same shape through `otpEnforceLimits`, which counts
 *     codes per address and per deployment the same way.
 *
 * So both actions are taken inside the lock rather than only the one that
 * looked dangerous. The ceiling this raises on wrong guesses is small — the
 * per-address and per-deployment caps bound the total either way — but "only
 * one verification attempt may consume a code" is a property, not an
 * approximation, and it was not one.
 *
 * A caller who arrives while another holds the lock is refused rather than
 * queued: `tryLock` bounds the wait, and a 429 the client retries is better
 * than an execution sitting on Apps Script's concurrent-execution budget.
 */
function withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw fail('the service is busy — try again shortly', 429);
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function fail(message, status) {
  var error = new Error(message);
  error.status = status || 500;
  return error;
}

function reply(ok, data, error, status, retryable) {
  var body = ok
    ? { ok: true, data: data }
    : { ok: false, error: error, status: status || 500, retryable: Boolean(retryable) };

  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * A short operational log in the workbook itself. Stackdriver is invisible to
 * the family who owns this deployment; a `_Log` tab they can open is not.
 */
function log(kind, action, detail, ms) {
  try {
    var book = SpreadsheetApp.openById(PROP.getProperty('workbookId'));
    var sheet = book.getSheetByName('_Log') || book.insertSheet('_Log');
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['at', 'kind', 'action', 'detail', 'ms']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([new Date(), kind, action || '', String(detail).slice(0, 500), ms || 0]);

    // Keep the log to the last thousand lines; an unbounded log eventually
    // makes the workbook slow to open for everyone.
    var excess = sheet.getLastRow() - 1001;
    if (excess > 0) sheet.deleteRows(2, excess);
  } catch (err) {
    // Logging must never be the reason a request fails.
  }
}
