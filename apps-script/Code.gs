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
    var email = verifyToken(request.token);
    enforceRateLimit(email);

    var data = dispatch(request.action, request.payload || {}, {
      email: email,
      deviceId: String(request.deviceId || ''),
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
    case 'pull':      return sheetPull(payload.cursors || {}, payload.limit || 500, workbook());
    case 'audit':     return withLock(function () { return auditAppend(payload.entries, workbook(), context); });
    case 'upload':    return driveUpload(payload, context);
    case 'download':  return driveDownload(payload.fileId);
    case 'versions':  return driveVersions(payload.fileId);
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
    case 'verify':    return { counts: sheetCounts(workbook()) };
    case 'ping':      return { ok: true, user: context.email, at: new Date().toISOString() };
    default:
      throw fail('unknown action: ' + action, 400);
  }
}

/* --------------------------------------------------------------- identity */

/**
 * Verify the bearer token with Google's tokeninfo endpoint and confirm it was
 * issued for the account running this script. Results are cached for five
 * minutes: a sync run makes several calls, and a network round trip per call
 * would double the latency of every one of them.
 */
function verifyToken(token) {
  if (!token) throw fail('no access token was supplied', 401);

  var cache = CacheService.getUserCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));

  var cached = cache.get(key);
  if (cached) return cached;

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

  var current = Session.getEffectiveUser().getEmail();
  if (current && info.email && info.email.toLowerCase() !== current.toLowerCase()) {
    // The script is running as one account and the token belongs to another.
    // Serving this would let one Google account read another's workbook.
    throw fail('this token belongs to a different Google account', 403);
  }

  cache.put(key, info.email || current, 300);
  return info.email || current;
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
