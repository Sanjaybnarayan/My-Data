/**
 * Who actually sent a message, as opposed to who the row says did.
 *
 * ## Two answers to one question
 *
 * Every message carries the sender twice:
 *
 *   - `message.sender`, a plain reference to a person. It is what the screen
 *     draws, it is in the clear so a list can be attributed without decrypting
 *     anything, and **anything that can write a row can write it**.
 *   - the sealed envelope's `from`, the public half of the device key that
 *     sealed it. Nothing forged it, because `security/e2ee.js` derives the
 *     wrapping key by ECDH between that key and the recipient's — so an
 *     envelope that opens *is* evidence of which private key sealed it. That
 *     file says so, and says it is why there is no separate signing key.
 *
 * The proof was already there and nothing ever asked for it. This module is
 * the asking. `deviceKey` maps a public key to a person, so the join needs no
 * new data, no new field, and nothing from the backend.
 *
 * ## Three answers, and why not two
 *
 * A boolean here would be wrong in the direction that costs somebody
 * something. `unknown` is not `disputed`: a device whose key was never
 * recorded — enrolled on a phone since wiped, or recorded and then deleted —
 * proves nothing either way, and drawing a warning on those messages would
 * train people to ignore the warning that matters. It is also not
 * `confirmed`: nothing was checked.
 *
 * This is the same shape as `WHAT_IS_NOT_KNOWN` in `domain/otp.js`, and for
 * the same reason. An unread value reported as an answer is the fault this
 * repository has found most often.
 *
 * ## What this does not prove
 *
 * That the person is who they say they are — only that the message came from
 * a device recorded against them. A device somebody else is holding is still
 * that device, which is what `safetyNumber` and `verifiedAt` are for and this
 * is not.
 */

/** The three answers. Nothing else is an answer. */
export const ATTRIBUTION = Object.freeze({
  confirmed: 'confirmed',
  disputed: 'disputed',
  unknown: 'unknown',
});

/**
 * Compare the sender the row claims against the one the envelope proves.
 *
 * @param {{sender: string, from: string,
 *          devices: Array<{publicKey?: string, person?: string, [k: string]: any}>,
 *          opened: boolean}} input
 *   `devices` are whole `deviceKey` rows. Only two of their fields are read,
 *   and the index signature says so rather than narrowing the type to a shape
 *   no caller actually has — a caller would then have to build a second object
 *   per row to satisfy a type, which is work done for the typechecker instead
 *   of for the reader.
 *   `opened` is whether the envelope actually decrypted on this device. It is
 *   required and not inferred: a message this device could not open has no
 *   proven sender at all, and reporting `confirmed` because the two strings
 *   happened to agree would be attributing on the strength of the very field
 *   that cannot be trusted.
 * @returns {{verdict: string, claimed: string, proven: string|null}}
 */
export function attributionOf({ sender, from, devices, opened }) {
  const claimed = String(sender ?? '');

  if (!opened || !from) return { verdict: ATTRIBUTION.unknown, claimed, proven: null };

  /*
   * Revoked and deleted device rows count here.
   *
   * Revocation is forward-only — `ChatService.revoke` says a key that has been
   * used cannot be un-used — so a message sealed by a device before it was
   * revoked was still sealed by that device. Excluding those rows would turn
   * every message from a retired phone into a warning about impersonation,
   * which is false and is the fastest way to make the real warning worthless.
   */
  const matches = (devices ?? []).filter((d) => d?.publicKey && d.publicKey === from);
  if (matches.length === 0) return { verdict: ATTRIBUTION.unknown, claimed, proven: null };

  if (matches.some((d) => String(d.person ?? '') === claimed && claimed !== '')) {
    return { verdict: ATTRIBUTION.confirmed, claimed, proven: claimed };
  }

  // The key is known and belongs to somebody else. This is the finding.
  return {
    verdict: ATTRIBUTION.disputed,
    claimed,
    proven: String(matches[0].person ?? '') || null,
  };
}

/** Does this verdict need saying on a screen? Only one of the three does. */
export function worthWarning(verdict) {
  return verdict === ATTRIBUTION.disputed;
}
