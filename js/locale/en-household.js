/**
 * English, for what admitting somebody to the household backup gives them.
 *
 * One sentence, in a file of its own because `js/locale/en.js` was at its
 * 800-line ceiling and the module-size ratchet refused the growth — the same
 * refusal that produced `en-chain.js` and `en-settings-security.js`.
 *
 * It is here rather than in `js/modules/settings/household.js` because it used
 * to say "Everything sensitive in it is encrypted with a key Google never
 * sees", and `docs/DATA_INVENTORY.md` contradicts that in the line it calls
 * the most important in its table:
 *
 *     Reading the Sheet is reading most of the records, with no key involved
 *
 * — the consequence of 7.3% encryption coverage, which that document states
 * plainly and at length. So the repository knew, and the one screen where a
 * household is asked to decide said the opposite, in the paragraph whose whole
 * job is to say what admitting somebody means.
 *
 * Both halves are now named, and `tests/locale.test.mjs` holds both: the
 * encrypted one alone is the sentence that was wrong.
 */

export const householdStrings = {
  'settings.household.admitNote': 'They also need to be a test user on your OAuth consent screen, and they need the household\u2019s recovery phrase or their own PIN enrolled on their device — this list decides who may reach the backup, not who can read it. The most sensitive values there — account numbers, PAN, diagnoses, passwords — are encrypted with a key Google never sees. Most other fields, names, dates, amounts and addresses among them, are plain text in the Sheet, so admitting somebody gives them those.',
};
