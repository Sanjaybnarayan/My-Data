/**
 * English, for signing in: one-time codes, and the sentences a screen may say
 * about what a code can do.
 *
 * A separate file because `en.js` is the catalogue and this is the part of it
 * that has to change together. `limitsFor` in `js/domain/otp.js` picks between
 * three sets of these keys depending on whether the household escrowed their
 * data key with their own backend, and getting the wrong set on a screen means
 * telling somebody their records are protected in a way they are not. Keeping
 * the three sets adjacent, and away from six hundred unrelated strings, is
 * worth one more import.
 *
 * Spread into `strings` rather than registered separately: two catalogues for
 * one language would be two things to keep in step, and `coverage()` measures
 * against one object.
 */

export const signinStrings = {
  'otp.title': 'Confirm who you are',
  'otp.body': 'FamilyOS asks which of the people in this household is using this device. Sending a code to an address already on your record makes that answer harder to get wrong.',
  'otp.channel': 'Where the code goes',
  'otp.channel.email': 'Email',
  'otp.channel.sms': 'Text message',
  'otp.emailLabel': 'Your email address',
  'otp.numberLabel': 'Your mobile number',
  'otp.send': 'Send a code',
  'otp.sentTo': 'If {address} is on somebody\u2019s record, a code is on its way. It is good for ten minutes and can be used once.',
  'otp.codeLabel': 'The six digits',
  'otp.verify': 'Confirm',
  'otp.startAgain': 'Start again',
  'otp.confirmed': 'Confirmed \u2014 this device knows who you are',
  'otp.done': 'Confirmed. This device now knows which household member you are.',
  'otp.unavailable': 'not available',
  'otp.noBackend': 'This copy has no Google backend configured, and a code has to be sent and checked by one \u2014 a browser cannot check its own. Choose who you are on this screen instead.',
  'otp.limit.notALock': 'A code confirms which household member you are. It is not what protects these records \u2014 the device PIN is, and it does not unlock anything on its own.',
  'otp.limit.notAKey': 'It is not a key either. Signing in this way decrypts nothing that was not already readable on this device.',
  'otp.limit.enrolStill': 'A new phone still sees no messages until it is enrolled, and only the recovery phrase reaches conversations from before then.',
  'otp.unlock.opensDevices': 'Your household turned on signing in by code. A code sent to your address now opens these records on a device that has never been set up.',
  'otp.unlock.backendHolds': 'That works because the key which unlocks your records is kept in your household\u2019s own backend. Anyone who can open that Apps Script project can read them.',
  'signin.code.title': 'Sign in with a code',
  'signin.code.intro': 'A code goes to an address already on your record, and opens your records on this device. Your household turned this on; it works instead of the recovery phrase, and it is weaker than the phrase \u2014 the unlock key is kept in your household\u2019s own backend rather than only on paper.',
  'signin.code.addressLabel': 'Email or mobile number',
  'signin.code.codeLabel': 'The six-digit code',
  'signin.code.send': 'Send me a code',
  'signin.code.unlock': 'Unlock',
  'signin.code.cancel': 'Cancel',
  'signin.code.offer': 'I already use FamilyOS \u2014 send me a code',
  'signin.code.badAddress': 'That does not look like an email address or a mobile number.',
  'signin.code.onItsWay': 'If that address is on somebody\u2019s record, a code is on its way. It lasts ten minutes.',
  'signin.code.sixDigits': 'A code is six digits.',
  'signin.code.notEnrolled': 'That code was right, but signing in by code is not turned on for you. Use your recovery phrase, or ask whoever set up this household to turn it on in Settings \u2192 Security.',
  'signin.code.halfEscrow': 'The code was right, but this household\u2019s backend sent an unlock key it could not use. Sign in with your PIN or recovery phrase, and turn signing in by code off and on again in Settings \u2192 Security.',

  'security.code.onBody': 'A code sent to your address opens FamilyOS on a new device, in place of your recovery phrase. The key that does the opening is held by this household\u2019s own backend, so whoever can open that Apps Script project can read these records.',
  'security.code.offBody': 'Signing in by code lets a new device in with a code sent to your email or phone, instead of your recovery phrase. It works by keeping the unlock key in your household\u2019s own backend \u2014 so anyone who can open that Apps Script project can read your records. Your recovery phrase is kept nowhere and has no such weakness. Off by default, for that reason.',
  'security.code.turnOn': 'Turn on signing in by code',
  'security.code.turnOff': 'Stop signing in by code',
  'security.code.noPerson': 'Say which household member you are first, on your profile.',
  'security.code.whereTitle': 'Where should codes go?',
  'security.code.whereLabel': 'Email address or mobile number',
  'security.code.whereConfirm': 'Turn it on',
  'security.code.warnTitle': 'This is weaker than your recovery phrase',
  'security.code.warnBody': 'Anyone who can read that inbox or that phone \u2014 and anyone who can open your household\u2019s Apps Script project \u2014 will be able to read these records on a device of their own. Your recovery phrase is stored nowhere and cannot be taken this way.',
  'security.code.warnConfirm': 'I understand \u2014 turn it on',
  'security.code.onToast': 'On. A code sent to that address now opens FamilyOS on a new device.',
  'security.code.offTitle': 'Stop signing in by code?',
  'security.code.offMessage': 'The unlock key is deleted from your household\u2019s backend, and a new device will need your recovery phrase again. Nothing on this device changes and no records are affected.',
  'security.code.offConfirm': 'Turn it off',
  'security.code.offToast': 'Off. The unlock key is gone from your backend.',
  'security.code.method': 'One-time code',

  'signin.code.wouldOverwrite': 'This device signed in with a code, so it must not publish a new unlock key \u2014 doing so would lock every other device in your household out of these records. Nothing has been changed.',
  'otp.limit.unknown': 'This device cannot tell whether your household turned on signing in by code, so it will not say what a code does or does not open. Settings \u2192 Security has the answer.',
  'otp.unlock.insteadOfPhrase': 'It replaces the recovery phrase for a new device. The phrase is stored nowhere and cannot be taken this way; this can.',
};
