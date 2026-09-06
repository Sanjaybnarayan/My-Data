/**
 * What happens to a file somebody shared into FamilyOS.
 *
 * `core/sharetarget.js` gets the bytes off the share sheet. This decides what
 * becomes of them, and it is a service rather than part of the screen because
 * a share arrives *before* any screen is chosen — on a cold share Android
 * starts the app because of the file, and there is no Documents screen open to
 * receive it.
 *
 * ## What a share is allowed to do
 *
 * Capture each file as a document, and say so. That is all.
 *
 * Not: file it under a person, create a bill from it, or move the household to
 * a different screen than the one they land on. Sharing a file is somebody
 * handing over a document, not authorising this application to act on what is
 * inside it — and the extraction that runs during `capture` only ever
 * *suggests* onto the document's own record, which is the same thing the
 * picker does.
 *
 * The reading is not separate work. `DocumentStore.capture` reads the text and
 * applies its suggestions itself, so a shared PDF, Word file, spreadsheet or
 * text file arrives with its due date already filled in by the same code path
 * as one picked from storage. That is the point of doing this here rather than
 * writing a second capture.
 *
 * ## Nothing is dropped quietly
 *
 * Three outcomes are reported rather than swallowed: what was filed, what was
 * too large for the plugin to carry, and what was filed with nothing read out
 * of it. A household who shared a photograph and saw a document appear with no
 * date should be told the picture could not be read — not left to conclude the
 * application lost it.
 */

import { available, take } from '../core/sharetarget.js';
import { DocumentStore } from '../sync/drive.js';
import { guessCategory, titleFromFileName } from '../domain/filing.js';
import { t } from '../core/locale.js';

/**
 * Take everything the share sheet is holding and file it.
 *
 * @param {object} db
 * @param {{transport?: object|null, plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<{filed: object[], tooLarge: object[], unread: object[],
 *                    failed: object[], why?: string}>}
 */
export async function intakeShared(db, { transport = null, plugin } = {}) {
  const nothing = { filed: [], tooLarge: [], unread: [], failed: [] };

  // A browser, or a build without the plugin. Not an error — most runs of this
  // application are not an Android share.
  if (!available(plugin ? { plugin } : {})) return { ...nothing, why: 'unsupported' };

  const shared = await take(plugin ? { plugin } : {});
  if (!shared.ok) return { ...nothing, why: shared.why };
  if (!shared.files.length && !shared.tooLarge.length) return nothing;

  // The same plugin the share came through reads what is in it: a shared
  // photograph is recognised on the device rather than waiting for Drive.
  const store = new DocumentStore({ db, transport, plugin });
  const filed = [];
  const unread = [];
  const failed = [];

  for (const file of shared.files) {
    try {
      const { document } = await store.capture(file, {
        title: titleFromFileName(file.name, t('intake.untitled')),
        category: guessCategory(file.name),
        // Deliberately no `person`. A share carries no folder, and filing it
        // under whoever was last looked at would be inventing an owner.
      });
      filed.push(document);

      /*
       * Read from what happened, not from the file's type.
       *
       * This asked `readerFor(...) === NONE`, which was true of every image —
       * correct while nothing on the device could read one, and wrong the
       * moment `core/ocr.js` existed: a photographed bill that recognised
       * perfectly would still have been reported as unreadable, because the
       * question being asked was about the format rather than the outcome.
       *
       * `ocrText` empty is the honest test. It covers a build with no
       * recogniser, a picture with no text in it, and a scan too poor to read
       * — which are the same thing to somebody watching for their document.
       */
      if (!document.ocrText) unread.push(document);
    } catch (err) {
      // One bad file out of five must not lose the other four.
      failed.push({ name: file.name, why: String(err?.message ?? err) });
    }
  }

  return { filed, tooLarge: shared.tooLarge, unread, failed };
}

/**
 * What to tell somebody, in one line.
 *
 * Kept beside the work rather than in the screen so the wording is tested with
 * the counting. A message claiming "1 document filed" when the capture threw
 * is the failure this pair exists to make visible.
 */
export function intakeMessage({ filed = [], tooLarge = [], unread = [], failed = [] } = {}) {
  if (!filed.length && !tooLarge.length && !failed.length) return null;

  const parts = [];
  if (filed.length) {
    parts.push(t(filed.length === 1 ? 'intake.filed.one' : 'intake.filed.many',
      { n: filed.length }));
  }
  if (unread.length) {
    // "nothing could be read from it" only when there is one document and it
    // is the one — otherwise the sentence claims more than it knows.
    parts.push(filed.length === 1 && unread.length === 1
      ? t('intake.unread.only')
      : t('intake.unread.some', { n: unread.length }));
  }
  if (tooLarge.length) parts.push(t('intake.tooLarge', { n: tooLarge.length }));
  if (failed.length) parts.push(t('intake.failed', { n: failed.length }));
  return parts.join(' · ');
}
