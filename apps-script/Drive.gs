/**
 * Drive: the document tree, uploads, downloads and versions.
 *
 * The folder layout is human-readable on purpose. A family that stops using
 * FamilyOS tomorrow should find their own paperwork in folders that make
 * sense, not a flat bucket of identifiers only this application understands:
 *
 *   FamilyOS/
 *     FamilyOS Data          (the workbook)
 *     Documents/
 *       Asha Narayan/        Identity/ Health/ Education/ …
 *       Ravi Narayan/        Identity/ Vehicle/ …
 *       Household/           Property/ Insurance/ …
 *
 * One folder per person, categories inside, because that is how a family
 * looks for paperwork — "Asha's documents", not "every identity document
 * belonging to any of the six of us". It also means one person's folder can
 * be shared with them, or handed over, without unpicking anyone else's.
 * Anything not about one individual goes to `Household`.
 *
 * Category folders are created lazily, when something is first filed in one.
 * Twelve empty folders per person is a tree nobody can read.
 *
 * Uploading the same document again adds a **revision** to the existing Drive
 * file rather than creating a second one, so version history is Drive's own
 * and works in Drive's own interface.
 */

/* eslint-env googleappsscript */
/* global DriveApp, Utilities, PropertiesService, fail, log */

var CATEGORY_FOLDERS = ['Identity', 'Financial', 'Property', 'Vehicle', 'Insurance',
  'Health', 'Education', 'Legal', 'Tax', 'Employment', 'Warranty', 'Other'];

var ROOT_NAME = 'FamilyOS';
var DOCUMENTS_NAME = 'Documents';
var HOUSEHOLD_NAME = 'Household';

/** Create the top of the tree if it is not there. Idempotent. */
function driveEnsureTree() {
  var root = folderNamed(DriveApp.getRootFolder(), ROOT_NAME);
  var documents = folderNamed(root, DOCUMENTS_NAME);

  PropertiesService.getUserProperties().setProperties({
    rootFolderId: root.getId(),
    documentsFolderId: documents.getId(),
  });

  return { root: root, documents: documents };
}

/**
 * The folder a document belongs in: `Documents/<Person>/<Category>`.
 *
 * The person's own record id is written into the folder's description, so a
 * later rename can move the same folder rather than stranding the old one and
 * creating a second. Matching on the id first and the name second is what
 * makes "Asha" becoming "Asha Narayan" a rename instead of a split.
 */
function driveFolderFor(person, category) {
  var tree = driveEnsureTree();
  var name = (person && person.name) ? String(person.name) : HOUSEHOLD_NAME;
  var marker = person && person.id ? 'familyos-person:' + person.id : '';

  var personFolder = marker ? findFolderByMarker(tree.documents, marker) : null;

  if (personFolder) {
    // Renamed in the app since the last upload: follow it.
    if (personFolder.getName() !== name) personFolder.setName(name);
  } else {
    personFolder = folderNamed(tree.documents, name);
    if (marker) personFolder.setDescription(marker);
  }

  return folderNamed(personFolder, categoryFolderName(category));
}

/** A child folder carrying a specific marker in its description. */
function findFolderByMarker(parent, marker) {
  var folders = parent.getFolders();
  while (folders.hasNext()) {
    var folder = folders.next();
    if (folder.getDescription() === marker) return folder;
  }
  return null;
}

/**
 * Find or create a child folder by name.
 *
 * Drive allows two folders with the same name in the same parent, so this
 * takes the first match rather than assuming uniqueness — creating a second
 * "Identity" folder each time would scatter a family's documents across
 * duplicates that all look right.
 */
function folderNamed(parent, name) {
  var matches = parent.getFoldersByName(name);
  return matches.hasNext() ? matches.next() : parent.createFolder(name);
}

function categoryFolderName(category) {
  var normalised = String(category || 'other').toLowerCase();
  for (var i = 0; i < CATEGORY_FOLDERS.length; i++) {
    if (CATEGORY_FOLDERS[i].toLowerCase() === normalised) return CATEGORY_FOLDERS[i];
  }
  return 'Other';
}

/**
 * @param {{name, mimeType, content, category, documentId}} payload
 *   `content` is base64 — Apps Script cannot receive a stream, and a JSON
 *   body cannot carry raw bytes.
 */
/** What Drive's OCR can usefully read. Anything else is returned untouched. */
var OCR_TYPES = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'image/gif': true,
  'application/pdf': true,
};

/** A scan larger than this risks the six-minute execution limit. */
var MAX_OCR_BYTES = 8 * 1024 * 1024;

/** The same cap the browser applies, for the same Sheets-cell reason. */
var MAX_OCR_CHARS = 20000;

function driveUpload(payload, context) {
  if (!payload.content) throw fail('no file content was supplied', 400);
  if (!payload.documentId) throw fail('no document id was supplied', 400);

  var folder = driveFolderFor(payload.person, payload.category);

  var bytes = Utilities.base64Decode(payload.content);
  var blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream',
    payload.name || 'document');

  // The document id is kept in the file's description so a re-upload finds
  // the same file and adds a revision, rather than making a second copy.
  // Searched across the whole tree, not just the destination: a document
  // reassigned from one person to another has to move rather than be uploaded
  // a second time under the new name.
  var existing = findByDocumentId(driveEnsureTree().documents, payload.documentId);
  var file;

  if (existing && existing.getParents().next().getId() !== folder.getId()) {
    folder.addFile(existing);
    existing.getParents().next().removeFile(existing);
  }

  if (existing) {
    // Replacing the bytes of the existing file creates a Drive revision,
    // which is what version history means to the person looking at it. A new
    // file each time would give them twelve copies and no history at all.
    try {
      file = replaceContent(existing, blob);
    } catch (err) {
      // If the REST call is refused — a revoked scope, a shared drive quirk —
      // a second file is better than a lost upload. It is marked so the two
      // are distinguishable.
      file = folder.createFile(blob);
      file.setDescription('familyos:' + payload.documentId);
      log('upload', 'fallback', 'revision failed, created a new file: ' + err.message, 0);
    }
  } else {
    file = folder.createFile(blob);
    file.setDescription('familyos:' + payload.documentId);
  }

  if (context && context.email) {
    log('upload', context.email, payload.name + ' → ' + folder.getName(), 0);
  }

  return {
    fileId: file.getId(),
    folderId: folder.getId(),
    url: file.getUrl(),
    versionCount: countRevisions(file.getId()),
    size: file.getSize(),
    // Empty unless this is a scan the browser could not read for itself.
    text: payload.ocr ? readScan(file, payload.mimeType) : '',
  };
}

/**
 * The text in a scan, read by Drive's own OCR.
 *
 * A photograph of a bill is pixels, and the browser cannot read pixels — it
 * can only lift out a text layer that a scan does not have. Drive can, and
 * doing it here means the file never leaves the household's own Google
 * account: no third-party OCR service, no new dependency, and no key shared
 * with anybody. The alternative was bundling fifteen megabytes of WASM into an
 * application whose whole premise is that it has no runtime dependencies.
 *
 * The mechanism is a *copy* of the file already uploaded, converted to a
 * Google Doc — conversion is what triggers OCR — then exported as plain text
 * and thrown away. Copying rather than re-uploading means the bytes cross the
 * wire once. The temporary Doc is always trashed, including when the export
 * fails, or a household's Drive slowly fills with copies of its own paperwork.
 *
 * Everything here is best effort. A scan that cannot be read is a scan you can
 * still open and still find by its title; an upload that failed because the
 * OCR did would be a worse outcome than the one it was avoiding.
 */
function readScan(file, mimeType) {
  if (!OCR_TYPES[mimeType]) return '';
  if (file.getSize() > MAX_OCR_BYTES) return '';

  var token = ScriptApp.getOAuthToken();
  var copyId = null;

  try {
    var copy = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + file.getId() + '/copy?ocrLanguage=en',
      {
        method: 'post',
        contentType: 'application/json',
        payload: JSON.stringify({
          name: 'familyos-ocr-' + file.getId(),
          mimeType: 'application/vnd.google-apps.document',
        }),
        headers: { Authorization: 'Bearer ' + token },
        muteHttpExceptions: true,
      },
    );
    if (copy.getResponseCode() >= 300) return '';
    copyId = JSON.parse(copy.getContentText()).id;

    var exported = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + copyId + '/export?mimeType=text/plain',
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true },
    );
    if (exported.getResponseCode() >= 300) return '';

    return exported.getContentText().slice(0, MAX_OCR_CHARS);
  } catch (err) {
    log('ocr', 'failed', err.message, 0);
    return '';
  } finally {
    if (copyId) {
      try {
        DriveApp.getFileById(copyId).setTrashed(true);
      } catch (err) {
        // A copy that cannot be trashed is litter, not a failure worth
        // surfacing — but it is worth being able to find later.
        log('ocr', 'orphan', 'could not trash ' + copyId, 0);
      }
    }
  }
}

/**
 * Apps Script's `File` has no binary content setter, so replacing bytes means
 * going through the Drive REST API with the script's own token. Kept in one
 * place and used only here.
 */
function replaceContent(file, blob) {
  var url = 'https://www.googleapis.com/upload/drive/v3/files/' + file.getId()
    + '?uploadType=media&supportsAllDrives=true';
  var response = UrlFetchApp.fetch(url, {
    method: 'patch',
    contentType: blob.getContentType(),
    payload: blob.getBytes(),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() >= 300) {
    throw fail('Drive refused the upload: ' + response.getContentText().slice(0, 200), 502);
  }
  return file;
}

/** The file carrying this document's marker, anywhere under `root`. */
function findByDocumentId(root, documentId) {
  var marker = 'familyos:' + documentId;

  var files = root.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    if (file.getDescription() === marker) return file;
  }

  var folders = root.getFolders();
  while (folders.hasNext()) {
    var found = findByDocumentId(folders.next(), documentId);
    if (found) return found;
  }
  return null;
}

/** Every person folder that exists, for the setup screen and for reporting. */
function drivePersonFolders() {
  var tree = driveEnsureTree();
  var folders = tree.documents.getFolders();
  var out = [];
  while (folders.hasNext()) {
    var folder = folders.next();
    out.push({
      id: folder.getId(),
      name: folder.getName(),
      personId: String(folder.getDescription() || '').replace('familyos-person:', ''),
      url: folder.getUrl(),
    });
  }
  return out;
}

function driveDownload(fileId) {
  if (!fileId) throw fail('no file id was supplied', 400);
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    throw fail('that file is not in Drive any more', 404);
  }

  var blob = file.getBlob();
  // A 50 MB file base64-encodes to about 67 MB, well past what Apps Script
  // will return. Refusing with a clear reason beats a timeout.
  if (blob.getBytes().length > 20 * 1024 * 1024) {
    throw fail('that file is too large to fetch through Apps Script — open it in Drive', 413);
  }

  return {
    content: Utilities.base64Encode(blob.getBytes()),
    mimeType: blob.getContentType(),
    name: file.getName(),
    url: file.getUrl(),
  };
}

/**
 * Move a file to the owner's Drive bin.
 *
 * Trashed, not destroyed. A deletion in this application is a soft one that
 * Settings can undo, and a Drive file erased outright would be the one half of
 * that pair which does not come back. Google keeps a binned file for thirty
 * days, which is the same promise, and emptying the bin stays the owner's
 * decision to make in their own Drive.
 *
 * A file that is already gone is a success, not an error: the caller wanted it
 * absent and it is absent.
 */
function driveTrash(fileId) {
  if (!fileId) throw fail('no file id was supplied', 400);

  try {
    var file = DriveApp.getFileById(fileId);
    file.setTrashed(true);
    return { trashed: true, name: file.getName() };
  } catch (err) {
    return { trashed: false, missing: true };
  }
}

function driveVersions(fileId) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId
    + '/revisions?fields=revisions(id,modifiedTime,size)';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) return { revisions: [] };
  return JSON.parse(response.getContentText());
}

function countRevisions(fileId) {
  try {
    var result = driveVersions(fileId);
    return (result.revisions || []).length || 1;
  } catch (err) {
    return 1;
  }
}
