/**
 * English, for what Settings says when Google withheld a permission.
 *
 * `GoogleAuth.missingScopes()` existed and had no caller anywhere in `js/`.
 * Its own header says why it exists:
 *
 *     Google returns a perfectly good token after somebody unticks a
 *     permission on the consent screen, and after a Cloud project that never
 *     listed a scope drops it. Both then surface as a refusal from whichever
 *     API call needed it — which names the wrong problem, and sends people
 *     looking at their Drive rather than at their consent screen.
 *
 * Nothing asked it, so it named nothing, and that misdiagnosis went on
 * happening. These are the sentences that make it name the right one.
 *
 * A file of its own because `js/locale/en.js` is at its 800-line ceiling and
 * the module-size ratchet refuses the growth — the fourth time that has
 * happened, after `en-chain.js`, `en-settings-security.js` and
 * `en-household.js`.
 */

export const settingsConnectionStrings = {
  'settings.google.scopeGap.one': 'Google did not grant one permission this app asked for: {names}.',
  'settings.google.scopeGap.many': 'Google did not grant {count} permissions this app asked for: {names}.',
  /*
   * What actually breaks, in the scope catalogue's own words — `without` on
   * each entry in `js/core/scopes.js`. Naming the consequence is the whole
   * point: "sync failed" sends somebody to their network, and the answer is
   * on a consent screen in a different console.
   */
  'settings.google.scopeGap.effect': '{effects}',
  'settings.google.scopeGap.fix': 'Add it on your OAuth consent screen in the Google Cloud Console, then sign out and in again — a token already issued does not gain a permission you add later.',
  'settings.google.scopeGap.badge': 'permission missing',
};
