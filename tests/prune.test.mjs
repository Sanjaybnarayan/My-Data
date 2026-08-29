/**
 * Freeing device storage without losing the household's originals.
 *
 * `DocumentStore.pruneUploaded` deletes the local copy of a document to make
 * room. Its whole justification is that "the original still exists somewhere",
 * and that used to be inferred from `blob.uploaded` — one flag, on the blob.
 *
 * The flag says an upload happened. It does not say the file is still
 * reachable: recovery goes through `fetchFromDrive`, which needs
 * `document.driveFileId`, and that lives on a different record which sync can
 * replace wholesale — `applyRemote` writes the server's copy over the local
 * one rather than merging field by field.
 *
 * Nothing in the application calls `pruneUploaded`; every other method on the
 * class has a caller and this one has none. That is why the claim went
 * untested, and it is the reason to test it now rather than to leave it.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb } from './fixture.mjs';
import { DocumentStore } from '../js/sync/drive.js';

setSuite('prune');

/** A document row and its encrypted blob, as `capture` then `flush` leave them. */
async function uploaded(db, { id, driveFileId, bytes = 4096 }) {
  const document = await db.repo('document').create({
    title: `Passport ${id}`,
    fileName: `${id}.jpg`,
    mimeType: 'image/jpeg',
    category: 'identity',
    ...(driveFileId ? { driveFileId } : {}),
  });
  await db.adapter.write('blobs', {
    id: `blob_${id}`,
    documentId: document.id,
    data: new Uint8Array(bytes),
    iv: new Uint8Array(12),
    uploaded: true,
    driveFileId: driveFileId ?? null,
    createdAt: `2026-01-0${id}T00:00:00.000Z`,
  });
  return document;
}

const store = (db) => new DocumentStore({ db, transport: { configured: false } });

describe('pruning the local copy', () => {
  test('frees a blob whose document can still say where the file is', async () => {
    const db = await makeDb();
    await uploaded(db, { id: '1', driveFileId: 'drive_1' });

    const result = await store(db).pruneUploaded({ keepBytes: 0 });
    assert.equal(result.freed, 4096);
    assert.equal(result.kept, 0);
    assert.equal((await db.adapter.query('blobs', {})).length, 0);
  });

  /*
   * The one that matters. A blob marked uploaded whose document has lost its
   * `driveFileId` has no recovery path: `fetchFromDrive` returns null, so the
   * local copy is the only copy and freeing it is losing the document.
   */
  test('keeps one whose document has lost the pointer', async () => {
    const db = await makeDb();
    await uploaded(db, { id: '2', driveFileId: null });

    const result = await store(db).pruneUploaded({ keepBytes: 0 });
    assert.equal(result.freed, 0);
    assert.equal(result.kept, 1);
    assert.equal((await db.adapter.query('blobs', {})).length, 1,
      'the only copy of a document was deleted to free space');
  });

  test('and keeps one whose document is gone entirely', async () => {
    const db = await makeDb();
    await db.adapter.write('blobs', {
      id: 'blob_orphan',
      documentId: 'doc_that_never_existed',
      data: new Uint8Array(4096),
      iv: new Uint8Array(12),
      uploaded: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await store(db).pruneUploaded({ keepBytes: 0 });
    assert.equal(result.freed, 0);
    assert.equal((await db.adapter.query('blobs', {})).length, 1);
  });

  /*
   * The other direction: a guard that kept everything would also satisfy the
   * two checks above and would make the whole function pointless.
   */
  test('a full device still frees what it safely can', async () => {
    const db = await makeDb();
    await uploaded(db, { id: '3', driveFileId: 'drive_3' });
    await uploaded(db, { id: '4', driveFileId: null });
    await uploaded(db, { id: '5', driveFileId: 'drive_5' });

    const result = await store(db).pruneUploaded({ keepBytes: 0 });
    assert.equal(result.freed, 8192, 'both recoverable blobs should go');
    assert.equal(result.kept, 1, 'and the unrecoverable one should stay');
  });

  test('and nothing is touched while there is room', async () => {
    const db = await makeDb();
    await uploaded(db, { id: '6', driveFileId: 'drive_6' });

    const result = await store(db).pruneUploaded({ keepBytes: 200 * 1024 * 1024 });
    assert.equal(result.freed, 0);
    assert.equal((await db.adapter.query('blobs', {})).length, 1);
  });
});
