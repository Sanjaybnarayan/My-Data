/**
 * How a date that has come round is said.
 *
 * ## The sentence that read "expires on expires today"
 *
 * `describeReminder` built its line by pasting the schema's field *label* in
 * front of a verb: `${title}: ${label.toLowerCase()} expires today`. The label
 * of an expiry field is already a phrase — "Expires on", "Next due on", "Next
 * dose on" — so every one of the nineteen dated entities produced at least one
 * sentence like these, on the Notifications tab, which is one of five tabs:
 *
 *     X: expires on expires today
 *     X: next due on expired 3 days ago
 *     X: matures on expires today
 *
 * Two of them were not merely ungrammatical, they were false. A follow-up date
 * passing is not something *expiring*, and a vaccination's next dose does not
 * *expire* — the appointment for it may be missed, which is a different claim
 * and not one this application is in a position to make.
 *
 * ## A phrase per field, not a verb per tense
 *
 * The fix is that each expiry field says how it should be spoken, in all three
 * tenses, and the sentence is built from that rather than conjugated onto a
 * label. `nextDueOn` reads "next due" ahead, "due today" on the day and "was
 * due" behind — which no rule could derive from the words "Next due on".
 *
 * ## Why this list cannot go stale
 *
 * A hand-written list beside a derivable one is the fault this repository has
 * now found more times than any other. This one is hand-written because
 * English cannot be derived from a field key — but it is *checked* against the
 * schema: `tests/duewords.test.mjs` fails if any field marked `expiry: true`
 * has no phrases here, so a new dated field cannot quietly start rendering as
 * "whatever on expires today".
 *
 * Keys, not sentences, so every line goes through the catalogue.
 *
 * ## Keyed by field, and where that is safe
 *
 * The phrases are keyed by field key alone rather than `entity.field`, which
 * is only sound while a key means the same thing everywhere it appears.
 * `SHARED` below declares which keys are used by more than one entity, and a
 * test compares it against the schema: a key that becomes shared by a new
 * entity fails the suite, so somebody has to decide whether one phrase still
 * fits both rather than finding out from a sentence on a screen.
 *
 * The labels are not the test. `expiresOn` reads "Expires On" on three
 * entities and "Expires on" on `warranty`, and `renewsOn` is "Renewal date" on
 * a policy and "Renews On" on a subscription — cosmetic differences in the
 * schema, not differences in meaning, and comparing labels would have flagged
 * them as conflicts while missing an actual one.
 */

/** Every expiry field key in the schema, and how each is spoken. */
export const PHRASES = Object.freeze({
  expiresOn: 'due.expiresOn',
  nextDueOn: 'due.nextDueOn',
  maturesOn: 'due.maturesOn',
  rcExpiresOn: 'due.rcExpiresOn',
  insuranceExpiresOn: 'due.insuranceExpiresOn',
  pucExpiresOn: 'due.pucExpiresOn',
  nextServiceOn: 'due.nextServiceOn',
  followUpOn: 'due.followUpOn',
  endsOn: 'due.endsOn',
  nextDoseOn: 'due.nextDoseOn',
  date: 'due.date',
  renewsOn: 'due.renewsOn',
  leaseEndsOn: 'due.leaseEndsOn',
  taxPaidTill: 'due.taxPaidTill',
  nextFeeDueOn: 'due.nextFeeDueOn',
  agreementEndsOn: 'due.agreementEndsOn',
  dueOn: 'due.dueOn',
});

/**
 * Expiry keys used by more than one entity, and by which.
 *
 * Declared so that sharing is a decision somebody made rather than something
 * that happened. One phrase has to be right for every entity listed against a
 * key: "expires" suits a passport, a warranty and a certificate alike.
 */
export const SHARED = Object.freeze({
  expiresOn: Object.freeze(['identityDocument', 'document', 'certificate', 'warranty']),
  nextDueOn: Object.freeze(['recurringPayment', 'vehicleService']),
  renewsOn: Object.freeze(['policy', 'digitalAsset', 'subscription']),
});

/** The three tenses a date can be in, relative to today. */
export const TENSE = Object.freeze({ ahead: 'ahead', today: 'today', past: 'past' });

/**
 * The locale key for one field in one tense, or `null` for a field nobody has
 * written words for.
 *
 * `null` rather than a guess. A field with no phrase is a gap the test names,
 * and inventing "expires" for it would put a word on the Notifications tab
 * that nobody chose — which is how "next dose on expires today" happened.
 */
export function phraseKey(field, tense) {
  const base = Object.prototype.hasOwnProperty.call(PHRASES, String(field))
    ? PHRASES[String(field)]
    : null;
  if (!base) return null;
  return Object.prototype.hasOwnProperty.call(TENSE, String(tense))
    ? `${base}.${tense}`
    : null;
}

/** Which tense a number of days puts a date in. */
export function tenseFor(days) {
  if (!Number.isFinite(days)) return null;
  if (days < 0) return TENSE.past;
  if (days === 0) return TENSE.today;
  return TENSE.ahead;
}
