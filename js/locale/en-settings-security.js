/**
 * English, for Settings → Security, and for the Google setup it depends on.
 *
 * A separate file for the same reason as `en-settings-data.js`: `en.js` is the
 * catalogue, this is a block that changes with one idea, and the module-size
 * ratchet holds `en.js` under 800 lines — which is what sent these here, on
 * the commit that added the last two.
 *
 * What is here is the part of Settings that is about Google: where this copy
 * is served from, which permissions were asked for, and what turning "sign in
 * with Google" off actually managed to delete.
 */

export const settingsSecurityStrings = {
  // The two strings a broken Google sign-in actually needs. Not folded: the
  // commonest sign-in failure has nothing to do with scopes.
  'settings.origin.title': 'Where this copy is served from',
  'settings.origin.why': 'On the OAuth client — not the consent screen — these two must be listed exactly, or Google refuses the sign-in before it asks you anything.',

  // The OAuth scope list, folded away: setup reference rather than a control.
  'settings.scopes.title': 'Google permissions',
  'settings.scopes.where': 'Cloud Console → APIs & Services → OAuth consent screen → Scopes',

  // What turning "sign in with Google" off managed to delete. Two sentences
  // because there are two outcomes and they are not the same news: where the
  // key lives follows what Google granted at sign-in, so a household can hold
  // a copy in the app's hidden folder that this application can no longer see
  // or remove. The second says the one thing that does remove it.
  'settings.security.keyDropped': 'The key file is gone from Drive.',
  'settings.security.keyPartlyDropped': 'The key file in your Drive is deleted. A copy may remain in the app’s hidden folder, which FamilyOS can no longer reach — disconnecting FamilyOS from your Google account removes it.',
};
