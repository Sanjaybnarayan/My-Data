/**
 * Reading the SMS inbox off the device.
 *
 * Named `smsinbox` rather than `inbox` because `js/domain/inbox.js` already
 * means an email inbox — receipts from Gmail. Two modules called `inbox` that
 * mean different mailboxes is the kind of collision that gets the wrong one
 * imported at three in the morning.
 *
 * ## What was measured before this was written
 *
 * `domain/sms.js` has been able to read a bank alert since Phase 6 was first
 * built, and `SOURCE.NATIVE` reported `NOT_SUPPORTED` because nothing could
 * hand it a message. Every alert had to be pasted in one at a time. The
 * reading was never the gap; the getting was.
 *
 * ## The permission decides where this app can go, and that was checked first
 *
 * Rule 55: *a permission is never requested without checking platform policy.*
 * `READ_SMS` is a Play restricted permission, available to the default SMS
 * handler or under a case-by-case declaration that finance apps are routinely
 * refused. FamilyOS is not and will not be a default SMS handler.
 *
 * So this path is **for a sideloaded build** — which is what the CI debug APK
 * is. `AndroidManifest.xml` says the same thing at the permission itself, and
 * `docs/SMS_INTELLIGENCE.md` says it where somebody deciding how to distribute
 * this would look. It is not hidden behind an optimistic sentence about
 * applying for an exception.
 *
 * ## A one-time code does cross this bridge
 *
 * Worth stating rather than implying. The inbox is read whole — the provider
 * has no "financial messages only" filter — so an OTP arrives here in memory
 * like anything else. It is then classified by `domain/sms.js` and dropped:
 * never written, never sent, never shown to a model.
 *
 * Filtering in Java instead would have meant a second copy of the patterns
 * rule 53 depends on, in the language with no tests over it, deciding whether
 * somebody's one-time code got read. One tested copy is safer than two copies
 * where the untested one goes first.
 *
 * ## There is no listener
 *
 * Nothing wakes on an arriving message. The inbox is read when somebody opens
 * the screen and asks, which is why `RECEIVE_SMS` is not in the manifest.
 */

import { plugin as nativePlugin } from './native.js';

export const DENIED = 'denied';
export const UNSUPPORTED = 'unsupported';
export const FAILED = 'failed';

/** How many messages one read may return. */
export const PAGE = 200;

/**
 * Whether this build can read an inbox at all.
 *
 * False in a browser, false in the iOS shell — iOS has no inbox API for a
 * third-party app and never has — and false on an Android build without the
 * plugin compiled in.
 */
export function available({ plugin = nativePlugin } = {}) {
  return Boolean(plugin?.('SmsInbox'));
}

/** Whether the grant is already there, without asking for it. */
export async function permission({ plugin = nativePlugin } = {}) {
  const native = plugin?.('SmsInbox');
  if (!native?.checkPermissions) return UNSUPPORTED;
  try {
    const state = await native.checkPermissions();
    return state?.sms ?? 'prompt';
  } catch {
    return UNSUPPORTED;
  }
}

/**
 * Ask for the grant.
 *
 * Separate from `read` on purpose. Android shows this dialog once and a person
 * who says no is never asked again by the system, so it is worth being a
 * deliberate act on a screen that has already explained why — rather than
 * something that happens the first time somebody taps a button labelled
 * something else.
 */
export async function request({ plugin = nativePlugin } = {}) {
  const native = plugin?.('SmsInbox');
  if (!native?.requestPermissions) return UNSUPPORTED;
  try {
    const state = await native.requestPermissions();
    return state?.sms ?? DENIED;
  } catch {
    return DENIED;
  }
}

/**
 * Messages newer than `since`, newest first.
 *
 * `since` is a millisecond epoch and is exclusive, so a caller that remembers
 * the newest arrival it has already handled asks only for what came after —
 * an inbox holding years of messages is not re-read on every visit.
 *
 * `plugin` is injected for the same reason `position.js` injects it: the
 * native path has to be exercised without a phone.
 *
 * @param {{since?: number, limit?: number,
 *          plugin?: (name: string) => object|null}} [options]
 * @returns {Promise<{ok: boolean, messages?: object[], why?: string,
 *                    detail?: string|null}>}
 */
export async function read({ since = 0, limit = PAGE, plugin = nativePlugin } = {}) {
  const native = plugin?.('SmsInbox');
  if (!native?.read) return { ok: false, why: UNSUPPORTED };

  try {
    const result = await native.read({ since, limit });
    return { ok: true, messages: (result?.messages ?? []).map(normalise) };
  } catch (error) {
    // "You said no" and "the provider failed" need different sentences on a
    // screen, so they are different answers here rather than one `false`.
    const why = error?.code === 'DENIED' ? DENIED : FAILED;
    return { ok: false, why, detail: error?.message ?? null };
  }
}

/**
 * One provider row, in the shape `domain/sms.js` reads.
 *
 * The timestamp is the one thing that needs converting: Android hands over
 * milliseconds, and everything downstream — `receivedAt`, the fingerprint, the
 * date a figure is filed under — speaks ISO.
 */
function normalise(row) {
  const millis = Number(row?.receivedAt);
  return {
    deviceId: row?.id != null ? String(row.id) : null,
    sender: row?.sender ?? null,
    text: row?.text ?? '',
    receivedAt: Number.isFinite(millis) && millis > 0
      ? new Date(millis).toISOString()
      : null,
    receivedAtMillis: Number.isFinite(millis) ? millis : null,
  };
}
