/**
 * More than one mailbox.
 *
 * Most households do not keep their receipts in one place. Food and shopping
 * arrive at a personal address, bills and business orders at another, and a
 * spending total drawn from only one of them is not wrong so much as
 * misleading — which is worse.
 *
 * ## Why a second *deployment*, not a second sign-in
 *
 * Apps Script's `GmailApp` reads exactly one mailbox: the one the script is
 * authorised against. There is no account parameter and no delegation to lend
 * it another. So a second mailbox needs a second script, deployed by the
 * account that owns that mailbox, and this file is the list of them.
 *
 * That has a property worth keeping rather than working around. Each mailbox's
 * Gmail scope is granted by, and revocable by, the person whose mail it is. No
 * account ends up holding a key to another's inbox; revoking one leaves the
 * others untouched. A single super-account with access to everything would be
 * less code and a worse idea.
 *
 * ## These are not backup targets
 *
 * A mailbox here answers `mail` and nothing else. The workbook, the Drive
 * folders and the sync outbox all stay with the one primary account — a second
 * deployment never has `bootstrap` called on it, so it never creates a
 * workbook of its own. Receipts read through it are ordinary local records and
 * are backed up on the primary's ordinary schedule.
 */

/** An Apps Script web app URL, consumer or Workspace form. */
const EXEC = /^https:\/\/script\.google\.com\/(?:a\/macros\/[^/]+|macros)\/s\/([A-Za-z0-9_-]+)\/exec$/;

/** The mailbox of the account already signed in. Always present, never stored. */
export const PRIMARY = Object.freeze({
  id: 'primary',
  url: '',
  email: '',
  label: 'This account',
  primary: true,
});

/**
 * Validate and normalise one added mailbox.
 *
 * The id is derived from the deployment rather than generated, so pasting the
 * same URL twice is recognised as the same mailbox instead of quietly
 * doubling every receipt it returns.
 *
 * @param {{url?: string, email?: string, label?: string}} input
 * @returns {object|null} null when the URL is not an Apps Script deployment
 */
export function readMailbox({ url = '', email = '', label = '' } = {}) {
  const clean = String(url).trim();
  const match = EXEC.exec(clean);
  if (!match) return null;

  const address = String(email).trim().toLowerCase();

  return {
    id: `mb_${match[1].slice(-12)}`,
    url: clean,
    email: address,
    label: String(label).trim() || address || 'Another mailbox',
    primary: false,
  };
}

/**
 * Add a mailbox to a list, replacing any entry for the same deployment.
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

/** The primary first, then the added ones. Order is what the scan follows. */
export function allMailboxes(list) {
  return [PRIMARY, ...(list ?? [])];
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
  return `${mailboxId || PRIMARY.id}:${messageId}`;
}
