/**
 * Documents, and where they live.
 *
 * A file is captured on the device, stored in IndexedDB immediately, and
 * uploaded to Drive when there is a network. That order is the point: a
 * photograph of an insurance policy taken in a car park is saved before
 * anything is asked of the network, and the upload is a background concern.
 *
 * The Drive tree is created by the Apps Script side: one folder per person,
 * categories inside, so a family that stops using FamilyOS still has a
 * sensibly organised folder of their own paperwork rather than a bucket of
 * hashes — and one person's folder can be shared with them, or handed over,
 * without unpicking anyone else's.
 *
 *   FamilyOS/
 *     Documents/
 *       Asha Narayan/   Identity/  Health/  Education/ …
 *       Household/      Property/  Insurance/ …
 *
 * Blobs held on the device are encrypted with the same data key as the
 * sensitive fields. A phone's IndexedDB is readable by anything with the
 * device unlocked and root; a scan of a passport should not be sitting there
 * in the clear.
 */

import { newId } from '../core/ids.js';
import { encryptBytes, decryptBytes, toBase64 } from '../security/crypto.js';
import { AppError, TransportError } from '../core/errors.js';
import { safeFileName } from '../security/sanitize.js';
import { bus, TOPIC } from '../core/bus.js';
import { canReadText, indexableText } from '../domain/filing.js';

/** Drive rejects nothing on size, but a base64 body through Apps Script does. */
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const PREVIEWABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

export class DocumentStore {
  #db;
  #transport;

  constructor({ db, transport }) {
    this.#db = db;
    this.#transport = transport;
  }

  /**
   * Take a file from an input or a camera, store it locally, and create the
   * document record. The upload is deliberately *not* awaited by the caller's
   * happy path — see `flush`.
   */
  async capture(file, { title, category = 'other', person, tags = [], expiresOn } = {}) {
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new AppError(
        `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is `
        + `${MAX_UPLOAD_BYTES / 1024 / 1024} MB — Apps Script cannot carry more in one request.`,
        { code: 'too-large' },
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const blobId = newId('blb');

    const document = await this.#db.repo('document').create({
      title: title || safeFileName(file.name, 'Document'),
      category,
      person,
      tags,
      expiresOn,
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      versionCount: 1,
    });

    const sealed = await encryptBytes(
      this.#db.keyring.key, bytes, `familyos:blob:${document.id}`,
    );
    await this.#db.adapter.write('blobs', {
      id: blobId,
      documentId: document.id,
      iv: sealed.iv,
      data: sealed.data,
      mimeType: file.type,
      uploaded: false,
      createdAt: new Date().toISOString(),
    });

    // The file is safe from here on. Reading its text is a best-effort extra
    // and is deliberately attempted *after* the record and the blob exist, so
    // a PDF this cannot parse costs a search index entry and never the file.
    const ocrText = await this.#readText(bytes, file.type);
    if (ocrText) {
      await this.#db.repo('document').update(document.id, { ocrText });
      document.ocrText = ocrText;
    }

    return { document, blobId };
  }

  /**
   * The text inside a document, where there is any to be had.
   *
   * The reader is imported on demand rather than at the top of this file: it is
   * six hundred lines that nobody needs until they upload a PDF, and this class
   * is constructed at boot.
   *
   * Every failure is swallowed on purpose. A document whose text could not be
   * read is a document you can still open, still file and still find by its
   * title — an upload that failed because of it would be a worse outcome than
   * the one it was protecting against.
   */
  async #readText(bytes, mimeType) {
    if (!canReadText(mimeType)) return '';

    try {
      const { extract } = await import('../data/pdf-read.js');
      const result = await extract(bytes);
      if (result.encrypted) return '';
      return indexableText(result.pages);
    } catch {
      return '';
    }
  }

  /**
   * The person a document is filed under, as `{ id, name }`. Null for
   * household papers — a property deed belongs to the household, and
   * inventing an owner for it would put it in the wrong folder.
   */
  async #personFor(document) {
    if (!document.person) return null;
    try {
      const person = await this.#db.repo('person').get(document.person);
      return person ? { id: person.id, name: person.name } : null;
    } catch {
      // A role that cannot read people can still upload; the file goes to
      // Household rather than failing.
      return null;
    }
  }

  /** Which folder each person's documents are in, for Settings. */
  async personFolders() {
    if (!this.#transport?.configured) return [];
    const result = await this.#transport.call('folders', {});
    return result.folders ?? [];
  }

  /** Read a stored blob back, decrypted. */
  async read(documentId) {
    const rows = await this.#db.adapter.query('blobs', {
      filter: (b) => b.documentId === documentId,
    });
    const blob = rows.at(-1);
    if (!blob) return null;

    const bytes = await decryptBytes(
      this.#db.keyring.key,
      { iv: blob.iv, data: blob.data },
      `familyos:blob:${documentId}`,
    );
    return new Blob([bytes], { type: blob.mimeType || 'application/octet-stream' });
  }

  /**
   * Upload everything not yet in Drive. Called by the sync engine, and safe to
   * interrupt — a blob whose upload did not complete stays marked unuploaded
   * and is retried, which at worst produces a duplicate Drive revision rather
   * than a lost file.
   */
  async flush({ limit = 5 } = {}) {
    if (!this.#transport?.configured) return { uploaded: 0, skipped: 'not-configured' };

    const pending = await this.#db.adapter.query('blobs', {
      filter: (b) => !b.uploaded,
      limit,
    });

    let uploaded = 0;
    for (const blob of pending) {
      const document = await this.#db.repo('document').get(blob.documentId);
      if (!document) {
        // The record was deleted before the blob went up; drop the orphan
        // rather than uploading a file nothing points at.
        await this.#db.adapter.remove('blobs', blob.id);
        continue;
      }

      try {
        const bytes = await decryptBytes(
          this.#db.keyring.key,
          { iv: blob.iv, data: blob.data },
          `familyos:blob:${document.id}`,
        );

        const result = await this.#transport.upload({
          name: safeFileName(document.fileName || document.title),
          mimeType: document.mimeType || 'application/octet-stream',
          content: toBase64(bytes),
          category: document.category,
          documentId: document.id,
          // The name travels with the file so the server can name the folder
          // something a human can read; the id travels so a later rename moves
          // that folder rather than orphaning it.
          person: await this.#personFor(document),
        });

        await this.#db.repo('document').update(document.id, {
          driveFileId: result.fileId,
          driveFolderId: result.folderId,
          versionCount: result.versionCount ?? document.versionCount ?? 1,
        });
        await this.#db.adapter.write('blobs', { ...blob, uploaded: true, driveFileId: result.fileId });
        uploaded++;
      } catch (err) {
        bus.emit(TOPIC.toast, {
          kind: 'error',
          message: err instanceof TransportError && err.retryable
            ? `“${document.title}” will upload when the network returns.`
            : `“${document.title}” could not be uploaded: ${err.message}`,
        });
        if (!(err instanceof TransportError) || !err.retryable) {
          await this.#db.adapter.write('blobs', { ...blob, lastError: err.message });
        }
        break; // one failure usually means the network; stop rather than thrash
      }
    }

    return { uploaded, pending: pending.length - uploaded };
  }

  /**
   * Free device storage by dropping the local copy of files already in Drive.
   * Only ever removes a blob whose upload is confirmed — the point of the
   * cache is that the original still exists somewhere.
   */
  async pruneUploaded({ keepBytes = 200 * 1024 * 1024 } = {}) {
    const blobs = await this.#db.adapter.query('blobs', {});
    const total = blobs.reduce((n, b) => n + (b.data?.length ?? 0), 0);
    if (total <= keepBytes) return { freed: 0 };

    let freed = 0;
    // Oldest uploaded first: the recently captured are the ones still being
    // looked at.
    const candidates = blobs
      .filter((b) => b.uploaded)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

    for (const blob of candidates) {
      if (total - freed <= keepBytes) break;
      freed += blob.data?.length ?? 0;
      await this.#db.adapter.remove('blobs', blob.id);
    }
    return { freed };
  }

  /** Pull a file back from Drive when the local copy has been pruned. */
  async fetchFromDrive(documentId) {
    const document = await this.#db.repo('document').get(documentId);
    if (!document?.driveFileId) return null;

    const { content, mimeType } = await this.#transport.download(document.driveFileId);
    const binary = atob(content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || document.mimeType });
  }

  static canPreview(mimeType) {
    return PREVIEWABLE.has(mimeType);
  }

  async storageUsed() {
    const blobs = await this.#db.adapter.query('blobs', {});
    return {
      count: blobs.length,
      bytes: blobs.reduce((n, b) => n + (b.data?.length ?? 0), 0),
      pending: blobs.filter((b) => !b.uploaded).length,
    };
  }
}
