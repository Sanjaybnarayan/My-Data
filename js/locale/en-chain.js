/**
 * English, for what the audit-log check says when it does not add up.
 *
 * These six sentences were written into `js/data/chain.js`, where no catalogue
 * could reach them — the Settings card prints `why` straight onto the screen,
 * so they are the whole of what a household is told about their own audit
 * trail. Four were concatenated across two source lines each; they are one key
 * apiece here, because a translator needs the sentence rather than the halves
 * English happened to break it into.
 *
 * They moved on the commit that added the last two, when the unrouted-strings
 * ratchet refused the growth — which is the ratchet doing exactly its job: the
 * file went from nine unrouted strings to thirteen, and comes out of it with
 * one, the developer-facing throw that no household ever sees.
 */

export const chainStrings = {
  'chain.why.forked': 'two entries claim the same place in the log, so one of them was inserted or altered',
  'chain.why.noStart': 'the log has no beginning, so the entries before these were removed',
  'chain.why.altered': 'an entry does not match its own fingerprint, so it was changed after it was written',

  // One key per number, per the convention `settings.data.deletedCount` sets:
  // "1 entry is" and "3 entries are" are not one sentence with a plural on the
  // end in every language, and assembling them from parts bakes English in.
  'chain.why.orphaned.one': '1 entry is not attached to the log, so something between them was removed',
  'chain.why.orphaned.many': '{n} entries are not attached to the log, so something between them was removed',

  // The two the head closes. The links alone have no opinion about the end of
  // a log; these are what a household reads when the head says it should have
  // reached further.
  'chain.why.truncated': 'the log stops before the last entry this device recorded writing, so the most recent entries were removed',
  'chain.why.truncatedAll': 'this device recorded writing to the log and none of them are here, so every entry it wrote was removed',
};
