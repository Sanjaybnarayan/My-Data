/**
 * Identity documents, as cards a household can read at a glance.
 *
 * ## What a card may say
 *
 * The kind, whose it is, the number **masked**, whether it is still valid, and
 * when the record was last changed. That is everything this application knows
 * about an identity document, and each of those five comes from a stored field.
 *
 * ## What a card must never say
 *
 * **Verified.** Nothing here contacts an issuing authority — there is no
 * CKYCRR, no DigiLocker, no ABDM, no passport office. Every number on every
 * card was typed in by somebody in the household from a document they were
 * holding. A tick would tell a household that a registry had confirmed it, and
 * they would stop checking.
 *
 * So the status a card carries is about **the expiry date they typed**, and
 * nothing else. `unknown` is a real answer and appears as one: a document with
 * no expiry recorded is not "valid", it is a document nobody has said when it
 * runs out.
 */

import { daysUntil } from '../core/dates.js';

/**
 * How long before a document expires this starts saying so.
 *
 * A passport renewal takes months and cannot be done in the week it lapses, so
 * the warning is long.
 *
 * The schema already carries this figure, as `expiryLead` on
 * `identityDocument.expiresOn`. Callers pass it in — `IdentityService.wallet`
 * reads it off the field — and this constant is only the fallback for a caller
 * that has no schema in hand. A test asserts the two agree, because two
 * numbers that mean one thing drift and the drift would be silent: the cards
 * would simply start warning at a different time from everything else.
 */
export const DEFAULT_LEAD = 180;

/**
 * The state of one document's expiry.
 *
 * @param {string|null|undefined} expiresOn
 * @param {{lead?: number, clock?: () => number}} [options]
 * @returns {{state: 'expired'|'soon'|'valid'|'unknown', days: number|null}}
 */
export function expiryState(expiresOn, { lead = DEFAULT_LEAD, clock = Date.now } = {}) {
  if (!expiresOn) return { state: 'unknown', days: null };

  const days = daysUntil(expiresOn, clock);
  if (!Number.isFinite(days)) return { state: 'unknown', days: null };

  if (days < 0) return { state: 'expired', days };
  if (days <= lead) return { state: 'soon', days };
  return { state: 'valid', days };
}

/**
 * One card's worth of facts, with the number already masked.
 *
 * Masking happens here rather than in the screen so that a second screen
 * cannot get it wrong. `maskNumber` is passed in because the mask depends on
 * the field's classification, which is a data-layer question — and because a
 * domain function that imported the schema to mask one string would be
 * reaching a long way for it.
 *
 * @param {object} row an `identityDocument`
 * @param {(value: string) => string} maskNumber
 * @param {(personId: string) => string|null} nameOf
 * @param {{lead?: number, clock?: () => number}} [options]
 */
export function cardFor(row, maskNumber, nameOf, options = {}) {
  const { state, days } = expiryState(row?.expiresOn, options);

  return {
    id: row?.id ?? null,
    kind: row?.kind ?? '',
    holder: nameOf(row?.person) ?? null,
    // Never the raw value, on any path. A card with no number recorded shows
    // nothing rather than an empty mask, which would look like a hidden value.
    number: row?.number ? maskNumber(String(row.number)) : null,
    expiresOn: row?.expiresOn || null,
    state,
    days,
    // Required, not optional: a card that does not say when it was last
    // touched invites a household to read it as current.
    updatedAt: row?.updatedAt ?? row?.createdAt ?? null,
  };
}

/**
 * The cards, worst first.
 *
 * Expired before expiring before unknown before valid. A household opening
 * this screen is looking for what has lapsed, and a wallet that led with the
 * documents that are fine would bury it.
 */
const ORDER = Object.freeze(['expired', 'soon', 'unknown', 'valid']);

export function wallet(rows, maskNumber, nameOf, options = {}) {
  return (rows ?? [])
    .filter((row) => row && !row.deletedAt)
    .map((row) => cardFor(row, maskNumber, nameOf, options))
    .sort((a, b) => {
      const by = ORDER.indexOf(a.state) - ORDER.indexOf(b.state);
      if (by !== 0) return by;
      // Within a state, the soonest date first; a card with no date last.
      if (a.days === null) return b.days === null ? 0 : 1;
      if (b.days === null) return -1;
      return a.days - b.days;
    });
}

/**
 * How many of each state, for a line above the cards.
 *
 * @param {{state: string}[]} cards
 */
export function summarise(cards) {
  const counts = { expired: 0, soon: 0, unknown: 0, valid: 0 };
  for (const one of cards ?? []) {
    if (counts[one.state] !== undefined) counts[one.state] += 1;
  }
  return counts;
}
