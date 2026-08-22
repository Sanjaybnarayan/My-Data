/**
 * Gathering what `domain/breach.js` reasons about.
 *
 * The domain module is pure — everything is passed in, so it is testable
 * without a database and says nothing about where the facts came from. This is
 * the half that knows: the audit chain, the recent log, the device list, and
 * who the household holds records about.
 *
 * Here rather than on the Settings screen because the screen reading four
 * sources itself took the UI→database count past its budget, and because a
 * second surface wanting the same answer should not have to reassemble it.
 */

import { readiness } from '../domain/breach.js';
import { recentActivity } from './audit.js';
import { peopleWithRecordsAbout } from './consent.js';

/** How much of the log to read. Enough for a day or two of activity. */
const LOG_LIMIT = 200;

export async function readinessFor(db, { now = new Date().toISOString() } = {}) {
  const [chain, audit, devices, people, staffPersonIds] = await Promise.all([
    db.verifyAudit().catch(() => null),
    recentActivity(db.adapter, { limit: LOG_LIMIT }).catch(() => []),
    db.repo('deviceKey').list({ limit: 100 }).catch(() => []),
    db.repo('person').list({ limit: 200, decrypt: false }).catch(() => []),
    peopleWithRecordsAbout(db).catch(() => []),
  ]);

  return readiness({ chain, audit, devices, now }, { people, staffPersonIds });
}
