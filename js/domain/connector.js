/**
 * Whether a connector is still working, and what to do when it is not.
 *
 * ## What was measured before this was written
 *
 *     grant revoked (no token)   status=401 retryable=false :: not signed in to this mailbox
 *     token rejected by Gmail    status=401 retryable=false :: Gmail refused the request (401)
 *     rate limited               status=429 retryable=true  :: Gmail refused the request (429)
 *
 *     is any of this recorded? connectors never call diagnostics: NO
 *
 * The clients already tell the failures apart correctly — that part was never
 * the gap. What was missing is that **nothing remembered**. A scan that failed
 * because Google had revoked the grant produced a toast, and the moment
 * somebody dismissed it the mailbox looked exactly like one nobody had scanned
 * yet. There was no way to answer "why have no receipts appeared this month".
 *
 * ## The vocabulary is the prompt's, and it was already here
 *
 * `CONNECTOR_STATUS` was written for Phase 6 and lived in `domain/sms.js`,
 * where only SMS could reach it. It is the specification's list and it applies
 * to every connector, so it moved here and `domain/sms.js` re-exports it.
 * One vocabulary, one meaning of `EXPIRED`.
 *
 * ## The distinction that matters most
 *
 * **`EXPIRED` is not `ERROR`.** A revoked or expired grant needs a person to
 * sign in again and will never fix itself; a 500 or a rate limit will. Filing
 * both as "something went wrong" leaves somebody waiting for a connector that
 * is never coming back, which is the failure this whole module exists to
 * prevent.
 *
 * So the status is decided from the *status code*, not from the message, and
 * a single retryable failure does not condemn a connector — `ERROR` needs a
 * run of them, because one bad minute is not a broken mailbox.
 *
 * ## Nothing here stores a message as it arrived
 *
 * A connector error can carry an address or a query. `redact` from
 * `data/diagnostics.js` is used for the same reason it exists there: this is
 * kept in `meta`, which is not encrypted, and a mailbox error quietly
 * accumulating somebody's email address would be a leak with a helpful face.
 */

import { redact } from '../data/diagnostics.js';

/** Where per-connector health is kept. Beside the mailboxes, not inside them. */
export const HEALTH_KEY = 'connector.health';

/**
 * The prompt's statuses. Moved here from `domain/sms.js`, which re-exports it.
 *
 * Kept in the prompt's order rather than alphabetised, because the order is
 * roughly the life of a connector and reading it that way is how somebody
 * checks nothing is missing.
 */
export const CONNECTOR_STATUS = Object.freeze({
  NOT_CONNECTED: 'NOT_CONNECTED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  CONNECTED: 'CONNECTED',
  SYNCING: 'SYNCING',
  SYNCED: 'SYNCED',
  EXPIRED: 'EXPIRED',
  ERROR: 'ERROR',
  NOT_SUPPORTED: 'NOT_SUPPORTED',
  LEGAL_REVIEW_REQUIRED: 'LEGAL_REVIEW_REQUIRED',
});

/**
 * How many consecutive retryable failures before a connector is called broken.
 *
 * Two, not one. A single 429 or 503 is a bad minute and saying so on a screen
 * would train somebody to ignore the screen.
 */
export const PATIENCE = 2;

/** A connector nobody has used yet. */
export const unknown = () => ({
  lastOkAt: null, lastFailAt: null, failures: 0, status: null, message: null,
});

const entryOf = (health, id) => ({ ...unknown(), ...((health ?? {})[id] ?? {}) });

/** A scan that worked. Clears whatever was wrong, because it is no longer wrong. */
export function noteSuccess(health, id, { at = new Date().toISOString() } = {}) {
  return { ...(health ?? {}), [id]: { ...unknown(), lastOkAt: at } };
}

/**
 * A scan that did not.
 *
 * `status` is the HTTP status the client reported. It decides everything, and
 * the message decides nothing — a message is prose that changes when somebody
 * rewords it, and this has to keep meaning the same thing.
 */
export function noteFailure(health, id, {
  at = new Date().toISOString(), status = null, message = '',
} = {}) {
  const before = entryOf(health, id);
  return {
    ...(health ?? {}),
    [id]: {
      ...before,
      lastFailAt: at,
      // A grant that is gone is gone: the count is irrelevant and resets, so a
      // later success is what clears it rather than a quieter failure.
      failures: status === 401 || status === 403 ? 0 : before.failures + 1,
      status,
      message: redact(message),
    },
  };
}

/**
 * One scan's outcome, whichever way it went.
 *
 * A single entry point rather than a `noteSuccess` on one branch and a
 * `noteFailure` on another. Two call sites meant the success one could be
 * removed without any test noticing — a browser check can drive a failing
 * scan but not a succeeding one, because succeeding needs a real Google
 * token. One call site cannot be half-removed.
 *
 * @param {object|null} error the error a scan threw, or null if it worked
 */
export function afterScan(health, id, error = null) {
  return error
    ? noteFailure(health, id, {
      status: error?.status ?? null,
      message: error?.message ?? '',
    })
    : noteSuccess(health, id);
}

/**
 * What state a connector is in.
 *
 * @param {object} entry one connector's stored health
 * @returns {string} one of `CONNECTOR_STATUS`
 */
export function statusOf(entry) {
  const e = { ...unknown(), ...(entry ?? {}) };

  if (!e.lastOkAt && !e.lastFailAt) return CONNECTOR_STATUS.NOT_CONNECTED;

  // Authorisation first, and regardless of how long ago. A 401 does not age
  // into a transient problem — nothing about waiting fixes a revoked grant.
  if (e.lastFailAt && (e.status === 401 || e.status === 403)) {
    return CONNECTOR_STATUS.EXPIRED;
  }

  // A failure that has not been followed by a success.
  if (e.lastFailAt && (!e.lastOkAt || e.lastFailAt > e.lastOkAt)) {
    return e.failures >= PATIENCE ? CONNECTOR_STATUS.ERROR : CONNECTOR_STATUS.CONNECTED;
  }

  return CONNECTOR_STATUS.SYNCED;
}

/** The status of one connector by id. */
export const healthOf = (health, id) => statusOf(entryOf(health, id));

/**
 * The sentence a person reads, and what it asks them to do.
 *
 * Every unhappy state names an action. A status with no next step is a status
 * that makes somebody feel bad and leaves them where they were.
 */
export function describe(entry) {
  const e = { ...unknown(), ...(entry ?? {}) };
  const status = statusOf(e);

  switch (status) {
    case CONNECTOR_STATUS.NOT_CONNECTED:
      return { status, why: 'Not scanned yet.', action: null };
    case CONNECTOR_STATUS.EXPIRED:
      return {
        status,
        why: 'Google is no longer letting FamilyOS read this mailbox. This '
          + 'happens when the account signs out everywhere, the password '
          + 'changes, or access is withdrawn from the Google account page.',
        action: 'Sign in to this mailbox again',
      };
    case CONNECTOR_STATUS.ERROR:
      return {
        status,
        why: `${e.failures} scans in a row have failed${e.message ? ` — ${e.message}` : ''}.`,
        action: 'Try again, and check the connection',
      };
    case CONNECTOR_STATUS.CONNECTED:
      return {
        status,
        // Deliberately mild. One failure is one failure.
        why: 'The last scan did not finish. This is usually temporary.',
        action: 'Try again',
      };
    default:
      return { status, why: 'Working.', action: null };
  }
}

/**
 * Which connectors need a person to do something.
 *
 * The reason this is derived rather than a flag somebody sets: a flag would
 * have to be cleared, and the thing that clears it is a successful scan —
 * which already updates the health. One source, no second list.
 */
export function needingAttention(health) {
  return Object.entries(health ?? {})
    .map(([id, entry]) => ({ id, ...describe(entry) }))
    .filter((c) => c.status === CONNECTOR_STATUS.EXPIRED || c.status === CONNECTOR_STATUS.ERROR);
}
