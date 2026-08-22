/**
 * Recording how a connector's last attempt went.
 *
 * ## Why this exists rather than three copies of four lines
 *
 * `js/domain/connector.js` decides *what a state means* and touches no
 * database — that is what makes it testable without one. This is the other
 * half: loading the stored health, recording an outcome, and writing the
 * diagnostic beside it.
 *
 * The Gmail scan did all of that inline. Adding Drive and Calendar would have
 * made three copies of the same four steps, and the last time this repository
 * had two copies of one decision — `noteSuccess` on one branch, `noteFailure`
 * on another — mutation testing found that one of them could be deleted with
 * nothing noticing. Three copies is that problem with more places to hide.
 *
 * ## What was measured before this was written
 *
 *     Gmail scan (receipts)    health: yes | diagnostics: yes
 *     Drive (documents)        health: NO  | diagnostics: NO
 *     Calendar                 health: NO  | diagnostics: NO
 *
 * A Drive upload or a calendar push whose authorisation had gone produced a
 * toast and nothing else — exactly the state Gmail was in before Phase 4.
 */

import { HEALTH_KEY, afterScan, needingAttention } from '../domain/connector.js';
import { record as recordDiagnostic, KIND } from './diagnostics.js';

/** Every connector's stored health. */
export async function health(db) {
  return db.meta(HEALTH_KEY, {});
}

/**
 * Record one attempt, and return the updated health.
 *
 * `error` is null when the attempt worked. One argument decides both
 * outcomes, for the reason set out in `afterScan`: two call sites meant the
 * success one could be removed and no test could see it.
 *
 * `where` is what the diagnostic is filed under — `drive.upload`,
 * `calendar.push`, `gmail.scan`. It is written by this codebase and is never
 * redacted, which is what makes a run of failures groupable.
 */
export async function attempted(db, id, { error = null, where = '' } = {}) {
  const updated = afterScan(await health(db), id, error);
  await db.setMeta(HEALTH_KEY, updated);

  if (error) {
    await recordDiagnostic(db.adapter, {
      kind: KIND.connector,
      where,
      // Status first. Every transport failure carries `code: 'transport'`,
      // which groups a backend that is down with one that rejected the
      // request — and grouping is the point of recording these.
      code: error?.status != null ? `http-${error.status}` : (error?.code ?? ''),
      message: error?.message ?? '',
    });
  }

  return updated;
}

/**
 * The connectors a person has to do something about.
 *
 * Re-exported here so a screen needs one import rather than two, and so the
 * decision about *which* states need attention stays in the domain module
 * with the tests that cover it.
 */
export async function attention(db) {
  return needingAttention(await health(db));
}

/** Stable ids for the connectors that are not mailboxes. */
export const DRIVE = 'google:drive';
export const CALENDAR = 'google:calendar';
