/**
 * More than one mailbox.
 *
 * Most households do not keep their receipts in one place. Food and shopping
 * arrive at a personal address, bills and business orders at another, and a
 * spending total drawn from only one of them is not wrong so much as
 * misleading — which is worse.
 *
 * ## Three ways to attach one, because they trade differently
 *
 * **`google`** — sign in with the account, read its mail from the browser.
 * One click. Costs a `gmail.readonly` token living in the page for an hour,
 * which a script injected into this application could reach. That is a real
 * escalation over the Drive and Sheets tokens it already holds, and it is why
 * the other two still exist.
 *
 * **`backend`** — the Apps Script deployment this application already syncs
 * through, if `Gmail.gs` was deployed with it. Also one click, and no mail
 * token ever enters the page. Reads exactly one mailbox: the account that
 * deployed it.
 *
 * **`script`** — another account's own Apps Script deployment. The most setup
 * by a distance, and the only way to read a *second* mailbox without the
 * browser ever holding a Gmail token.
 *
 * A household picks per mailbox. Nothing here assumes the answer is the same
 * for all of them, because it often is not: the account that already holds the
 * backup can use `backend` for free, while a second address is a sign-in.
 *
 * ## None of these is a backup target
 *
 * A mailbox answers mail searches and nothing else. The workbook, the Drive
 * folders and the sync outbox stay with the one primary account — a `script`
 * mailbox never has `bootstrap` called on it, so it never creates a workbook
 * of its own, and a `google` mailbox has no backend at all. Receipts read
 * through any of them are ordinary local records, backed up on the primary's
 * ordinary schedule.
 */

/** An Apps Script web app URL, consumer or Workspace form. */
const EXEC = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/([A-Za-z0-9_-]+)\/exec$/;

/** A deliberately boring address check: this is a label, not an authorisation. */
const ADDRESS = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const KINDS = Object.freeze(['google', 'backend', 'script']);

/**
 * Where the attached mailboxes are kept.
 *
 * Here rather than in the screen that manages them, because two screens now
 * read it — Shops to scan, and Settings to ask whether reading each one was
 * ever agreed to — and a key spelled out twice is a key that will be renamed
 * once.
 */
export const MAILBOXES_KEY = 'inbox.mailboxes';

/**
 * The deployment this application already syncs through.
 *
 * Its id is `primary` for the same reason old receipts say `primary`: changing
 * it would orphan every receipt already read through it.
 */
export const BACKEND = Object.freeze({
  id: 'primary',
  kind: 'backend',
  url: '',
  email: '',
  label: 'This deployment',
});

/**
 * A Google account signed in here.
 *
 * Keyed by address, so signing the same account in twice is one mailbox.
 */
export function googleMailbox({ email = '', label = '' } = {}) {
  const address = String(email).trim().toLowerCase();
  if (!ADDRESS.test(address)) return null;

  return {
    id: `gm_${address}`,
    kind: 'google',
    url: '',
    email: address,
    label: String(label).trim() || address,
  };
}

/**
 * Another account's Apps Script deployment.
 *
 * The id is derived from the deployment rather than generated, so pasting the
 * same URL twice is recognised as the same mailbox instead of quietly
 * doubling every receipt it returns.
 */
export function scriptMailbox({ url = '', email = '', label = '' } = {}) {
  const clean = String(url).trim();
  const match = EXEC.exec(clean);
  if (!match) return null;

  const address = String(email).trim().toLowerCase();

  return {
    id: `mb_${match[1].slice(-12)}`,
    kind: 'script',
    url: clean,
    email: address,
    label: String(label).trim() || address || 'Another mailbox',
  };
}

/**
 * Rehydrate a stored entry.
 *
 * A stored mailbox that predates `kind` is a deployment, because that was the
 * only sort there was. Reading it back rather than trusting the stored shape
 * means a corrupted or hand-edited entry is dropped instead of producing a
 * mailbox that fails on every scan.
 */
export function readMailbox(stored = {}) {
  const kind = stored.kind ?? (stored.url ? 'script' : '');

  if (kind === 'backend') return { ...BACKEND, label: stored.label || BACKEND.label };
  if (kind === 'google') return googleMailbox(stored);
  if (kind === 'script') return scriptMailbox(stored);
  return null;
}

/**
 * Add a mailbox to a list, replacing any entry for the same one.
 *
 * Re-adding is how somebody corrects a label or re-attaches an account after
 * signing in again, so it updates rather than refuses.
 */
export function addMailbox(list, mailbox) {
  if (!mailbox) return [...(list ?? [])];
  const rest = (list ?? []).filter((entry) => entry.id !== mailbox.id);
  return [...rest, mailbox];
}

export function removeMailbox(list, id) {
  return (list ?? []).filter((entry) => entry.id !== id);
}

/**
 * What makes a receipt unique.
 *
 * A Gmail message id is unique within one mailbox, not across several, so the
 * mailbox has to be part of the key. Without it, two accounts that happened to
 * agree on an id would silently lose one of the two receipts — the kind of
 * loss that never announces itself.
 */
export function receiptKey(mailboxId, messageId) {
  return `${mailboxId || BACKEND.id}:${messageId}`;
}
