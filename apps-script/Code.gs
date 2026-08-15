/**
 * FamilyOS — Apps Script backend.
 *
 * One web app, deployed as "execute as the user accessing", so every read and
 * write happens under the signed-in family member's own Google account. There
 * is no service account, no shared secret and nothing here that can act on a
 * family's data when nobody is asking it to.
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
 * ## Why the token is verified even though the script runs as the user
 *
 * "Execute as user accessing" authenticates the *browser session*, not the
 * request. Verifying the bearer token proves the caller holds a credential
 * this deployment was actually granted, and pins the request to one Google
 * account — without it, any page the user visits could POST here from their
 * browser and the script would happily serve their spreadsheet.
 *
 * ## Concurrency
 *
 * Sheets has no transactions. A `LockService` script lock serialises writes,
 * so two devices pushing at once cannot interleave into a half-written row.
 * Reads are unlocked; a pull that misses a row in flight gets it next time,
 * because the cursor only advances past what was actually returned.
 */

/* eslint-env googleappsscript */
/* global SpreadsheetApp, DriveApp, PropertiesService, LockService, CacheService,
          ContentService, UrlFetchApp, Utilities, Session, schemaEnsure,
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

  try {
    var caller = verifyToken(request.token);
    enforceRateLimit(caller.email);

    var deviceId = String(request.deviceId || '');
    // Checked before the action runs, not after. A revoked device that got its
    // write in and was refused the reply would still have written.
    noteDevice(caller.email, deviceId, String(request.clientVersion || ''));

    var data = dispatch(request.action, request.payload || {}, {
      email: caller.email,
      owner: caller.owner,
      isOwner: caller.isOwner,
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
    case 'members':   return manageMembers(payload, context);
    case 'devices':   return manageDevices(payload, context);
    case 'verify':    return { counts: sheetCounts(workbook()) };
    case 'ping':      return { ok: true, user: context.email, role: context.role, at: new Date().toISOString() };
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
function noteDevice(email, deviceId, clientVersion) {
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
  } else {
    // Bounded: a client that minted a fresh id per request would otherwise
    // grow this without limit. The oldest are dropped, because the newest are
    // the ones somebody is holding.
    devices.push({
      id: deviceId,
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
 * List, revoke and restore devices.
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

  if (action !== 'revoke' && action !== 'restore') {
    throw fail('unknown device action: ' + action, 400);
  }

  var id = String(payload.deviceId || '');
  if (!id) throw fail('which device?', 400);

  // Revoking the device you are asking from would lock you out of the reply to
  // your own request. Refused, rather than half-applied.
  if (action === 'revoke' && id === context.deviceId) {
    throw fail('that is the device you are using — sign out from it instead', 400);
  }

  var devices = readDevices(subject);
  var changed = false;

  for (var i = 0; i < devices.length; i++) {
    if (devices[i].id !== id) continue;
    devices[i].revokedAt = action === 'revoke' ? new Date().toISOString() : '';
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
    return { email: email, owner: owner, isOwner: true, role: 'owner', personId: '' };
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

      // The owner is admitted by identity, never by list. Storing it would
      // invite somebody to remove it and lock the household out — and it would
      // also be the one entry through which the owner's own role could be
      // downgraded by editing a list.
      if (email && email.indexOf('@') > 0 && email !== context.owner && !seen[email]) {
        seen[email] = true;
        clean.push({ email: email, role: role });
      }
    }

    PROP.setProperty('members', JSON.stringify(clean));
    log('members', context.email, clean.length + ' accounts', 0);
    return { owner: context.owner, members: clean };
  }

  return { owner: context.owner, members: members(), isOwner: context.isOwner,
    role: context.role };
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
 */
function withLock(fn) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw fail('another device is writing — try again shortly', 429);
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
