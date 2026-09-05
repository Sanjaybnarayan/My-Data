/**
 * English, for the chat settings screen.
 *
 * A separate file for the same reason as `en-signin.js` and `en-tradebook.js`:
 * `en.js` is the catalogue and this is a block that changes with one screen.
 * The split was forced the same way too — `tools/module-size.mjs` reported
 * `en.js` about to join its list, and the answer that tool asks for is to
 * move code out rather than raise the number.
 *
 * Spread into `strings` rather than registered separately, so `coverage()`
 * still measures one object.
 */

export const chatSettingsStrings = {
  'chatSettings.title': 'Chat settings',
  'chatSettings.subtitle': 'How messages look, and who can read them',
  'chatSettings.theme.title': 'Chat theme',
  'chatSettings.theme.body': 'The tint on the messages you send.',
  'chatSettings.theme.note': 'Each tint is a colour already in the design system, so the text on it stays readable in both light and dark. This is kept on this device only.',
  'chatSettings.bubble.accent': 'Blue',
  'chatSettings.bubble.secondary': 'Teal',
  'chatSettings.bubble.positive': 'Green',
  'chatSettings.bubble.info': 'Slate',
  'chatSettings.devices.title': 'Linked devices',
  'chatSettings.devices.count': '{n} active',
  'chatSettings.devices.body': 'A message is sealed to each of these, one by one. A device that is not on this list cannot open anything sent while it was missing.',
  'chatSettings.devices.none': 'No device has been enrolled yet',
  'chatSettings.devices.thisOne': 'this device',
  'chatSettings.devices.added': 'added {day}',
  'chatSettings.devices.verifiedBadge': 'verified',
  'chatSettings.devices.unverifiedBadge': 'unverified',
  'chatSettings.devices.compare': 'Show safety number',
  'chatSettings.devices.matched': 'It matched',
  'chatSettings.devices.markedDone': 'Recorded as compared and matched',
  'chatSettings.devices.revoke': 'Revoke',
  'chatSettings.devices.revokeConfirm': 'Stop sealing new messages to this device?\n\nThis cannot be undone, and it does not reach backwards: everything already sent to this device stays readable by it.',
  'chatSettings.devices.revokedDone': 'No new message will be sealed to that device',
  'chatSettings.devices.revokedCount': '{n} revoked',
  'chatSettings.devices.revokedOn': 'Revoked {day}',
  'chatSettings.devices.revokedBadge': 'revoked',
  'chatSettings.devices.alreadyHere': 'This device is enrolled, so messages sent to it can be read here.',
  'chatSettings.devices.enrolHere': 'Enrol this device',
  'chatSettings.privacy.title': 'Privacy',
  'chatSettings.privacy.sealed': 'Each message is sealed to each device',
  'chatSettings.privacy.sealedWhy': 'Not to a person and not to a server. Google holds the sealed bytes and cannot open them, and neither can anyone in this household who is not in the conversation.',
  'chatSettings.privacy.escrow': 'The recovery phrase opens everything',
  'chatSettings.privacy.escrowWhy': 'Every message is also sealed to a key that phrase opens, so a restored backup can still read old conversations. Whoever holds the phrase can read every conversation, including ones they were never part of.',
  'chatSettings.privacy.withdraw': 'Withdrawing a message removes it here and everywhere it syncs',
  'chatSettings.privacy.withdrawWhy': 'The sealed body and any attached file are deleted and the row is marked withdrawn. A device that had already opened and copied it is beyond this application\u2019s reach.',
  'chatSettings.privacy.revoke': 'Revoking a device only stops new messages',
  'chatSettings.privacy.revokeWhy': 'A key that has been used cannot be un-used. Everything already sealed to that device stays readable by it, and pretending otherwise would be the most dangerous sentence on this screen.',
  'chatSettings.privacy.plaintext': 'An opened file is never written to disk',
  'chatSettings.privacy.plaintextWhy': 'It is decrypted in memory, handed to you, and released immediately \u2014 which is the point of having sealed it.',
  'chatSettings.privacy.more': 'Household privacy settings',
  'chatSettings.notify.title': 'Notifications',
  'chatSettings.notify.badge': 'none, on any platform',
  'chatSettings.notify.none': 'Nothing about a message reaches your notification tray. A new message is seen when you open the chat screen \u2014 there is no background delivery, no sound, and no badge on the app icon.',
  'chatSettings.notify.receipts': 'No read receipts, and no unread counts',
  'chatSettings.notify.receiptsWhy': 'Nothing records whether a message has been read, so neither can be shown without inventing it.',
  'chatSettings.notify.presence': 'No typing indicator, and no online status',
  'chatSettings.notify.presenceWhy': 'Nothing observes either, and a dot claiming somebody is online would be guessing.',
  'chatSettings.notify.instead': 'The Notifications tab is about what is due \u2014 renewals, payments, expiring documents. It has never carried messages.',
};
