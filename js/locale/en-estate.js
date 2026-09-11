/**
 * English, for wills and legal documents.
 *
 * A separate file for the same reason as `en-calendar.js`: `en.js` is the
 * catalogue, this is one idea's worth of one, and the module-size ratchet
 * holds `en.js` under 800 lines. Seven keys took it to 808, and the ratchet
 * says move code out rather than raise the number.
 *
 * `estate.registration.notice` is the third of this feature's refusals and the
 * only one that lives in a catalogue. `NOMINEE_IS_NOT_HEIR` and
 * `A_NOTE_IS_NOT_THE_WILL` are sentences in `js/domain/estate.js`, written
 * before there was anywhere else to put them; a third written there would have
 * raised a count that may only fall. It is no less binding for being here, and
 * unlike its two siblings it can be translated.
 */

export const estateStrings = {
  // What an identity document says about the person it is filed under. Whole
  // sentences, and `{field}` is a schema label that arrives already
  // translated — the same shape as the `validate.*` keys.
  'identity.person.intro': '{who} has no answer recorded for these, and a scan only ever fills a blank one.',
  'identity.person.record': 'Record it',
  'identity.person.recorded': '{field} recorded',
  'identity.person.thatPerson': 'That person',
  'identity.person.needsPerson': 'An identity detail has to belong to somebody.',
  'identity.person.notOffered': '{field} is not something a document offers.',
  'identity.person.alreadySet': 'That is already recorded, and a scan does not overwrite it.',

  // Registration of wills and deeds. Whole sentences, and the heading says
  // "not recorded as registered" rather than "unregistered" because the field
  // is a boolean and a form nobody opened answers no in the same voice as a
  // person who did.
  'estate.registration.notice': 'Whether a document has to be registered depends on what it is and on the law that governs it, and this application does not decide either. An unregistered will is still a will. This is your own record of which instruments were registered \u2014 not advice, and not a list of problems.',
  'estate.registration.title': 'Registration',
  'estate.registration.recorded': '{n} recorded as registered',
  'estate.registration.notRecorded': 'Not recorded as registered',
  'estate.registration.disagrees': 'Your record disagrees with itself',
  'estate.registration.noNumber': 'Marked registered, with no registration number recorded',
  'estate.registration.numberOnly': 'A registration number is recorded, and this is not marked registered',
};
