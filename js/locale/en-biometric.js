/**
 * English, for fingerprint unlock.
 *
 * A separate file for the reason `en-signin.js` gives about codes: these
 * sentences have to change together, and one of them is a claim about what
 * protects a household's records. Saying the wrong one is not a typo.
 *
 * Every string here describes an *absence* except two. That is the shape of
 * the feature: it works on one platform through one mechanism, and everywhere
 * else the honest answer is which mechanism is missing and what still holds
 * the data. The sentence this replaced said "This device has no fingerprint
 * or face unlock available to the browser" on phones with a reader on the
 * back of them.
 */

export const biometricStrings = {
  'biometric.noSensor': 'This phone has no fingerprint or face unlock that FamilyOS can use.',
  'biometric.noneEnrolled': 'No fingerprint is set up on this phone yet. Add one in the phone’s own settings, then come back.',
  'biometric.serviceSilent': 'The fingerprint service on this phone did not answer.',
  'biometric.noBrowserSupport': 'This browser does not offer fingerprint unlock. Your PIN still protects the data. The Android app does offer it.',
  'biometric.noReaderForBrowser': 'This device has no fingerprint or face unlock the browser can reach.',

  // The two that are not absences.
  'biometric.derivesKey': 'Your fingerprint will unlock FamilyOS on its own. The key is derived on this device and never leaves it.',
  'biometric.gestureOnly': 'This device cannot derive an encryption key from your fingerprint, so the fingerprint will confirm who you are but your PIN still unlocks the data. You will be asked for the PIN every time FamilyOS locks — this device cannot do better than that.',

  // Android destroys the key when a fingerprint is added or removed. That is
  // the protection working, not a fault, and it reads as one unless said.
  'biometric.invalidated': 'A fingerprint was added or removed on this phone, so the saved key was destroyed. Unlock with your PIN and set the fingerprint up again.',
};
