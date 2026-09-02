/**
 * What the assistant may be asked about, and what it may not.
 *
 * ## Why a list of refusals is the point
 *
 * `docs/PHASE_STATUS.md` recorded the assistant's reach as a fraction — "32 of
 * 53 entity kinds" — which reads as a shortfall and says nothing about the
 * other twenty-one. Some of them are work nobody has done. Ten are things this
 * application must **never** answer questions about, and the difference
 * between those two mattered enough that a number could not carry it.
 *
 * So the fraction is retired. Every entity in the schema is either reachable
 * by a question or named here with the reason it is not, and
 * `tests/ai.test.mjs` fails when one is neither. An entity added tomorrow
 * cannot be silently unreachable: it either gets an intent or it gets a line
 * in this file, and both are a decision somebody made on purpose.
 *
 * ## The two kinds of refusal, and why they are not the same
 *
 * **Rule 53 and end-to-end encryption.** An OTP, a password vault, a chat
 * message, a device key. These are not "not covered yet" — routing them to the
 * assistant would be a defect however carefully it was done, and the fact that
 * this parser is offline does not change it. `tests/ai.test.mjs` already
 * checks that the first two are unreachable by all three routes an entity can
 * arrive through; this widens that guard to the rest.
 *
 * **The `secret` ACL.** A will, a nominee, an identity record. RBAC would gate
 * these anyway, so nothing leaks if the assistant loads them. They are here
 * because a summary is the wrong shape for the question: somebody asking who
 * inherits should be reading the document on its own screen, where the
 * provenance and the caveats are, not a sentence assembled from it.
 */

/**
 * Entities no question reaches, and why. Keys must be real entity names and
 * every reason must say something — an empty string would turn this file from
 * a decision into a place to put things.
 */
export const NOT_ASKABLE = Object.freeze({
  smsMessage: 'rule 53 — a one-time code or a security message must not be sent to AI, '
    + 'and the gate runs before any field is parsed',
  vaultItem: 'a password vault reaching a model is the same mistake as an OTP with a worse '
    + 'ending, and the assistant is offline precisely so neither can happen',
  message: 'end-to-end encrypted — answering about it would need the plaintext this device '
    + 'holds only for the people in the conversation',
  conversation: 'the thread a message belongs to, held to the same rule as the message',
  deviceKey: 'key material, which is not a subject any question should have',
  locationPing: 'where a person has been is shown on Safety under recorded consent, and is '
    + 'not a thing to summarise on request',

  will: 'secret — who inherits is read on the estate screen, with its provenance beside it, '
    + 'rather than as a sentence assembled from it',
  beneficiary: 'secret — a nomination is named where it can be checked against the policy '
    + 'or the account it belongs to',
  legalDocument: 'secret — a legal document is read, not summarised',
  kycRecord: 'secret — what an institution holds is compared on the Identity screen, where '
    + 'the disagreements are visible',
});
