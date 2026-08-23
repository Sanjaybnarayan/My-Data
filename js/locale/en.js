/**
 * English.
 *
 * The authoritative catalogue: every key the application asks for is defined
 * here, and `coverage()` measures every other language against it. There are
 * no schema labels in this file, because English labels already live in
 * js/data/schema.js and a second copy of 345 of them is the drift this
 * repository keeps finding.
 *
 * Two conventions worth keeping when a second language arrives.
 *
 * **A sentence is one key.** `dates.inDays` is `in {n} days`, not `in` +
 * number + `days`. Assembling a sentence from fragments bakes English word
 * order into the code: Hindi puts the verb last, German splits it, and
 * "Add {noun}" is not "Add" followed by a noun in any of them. Every key here
 * that carries a variable carries the whole sentence around it.
 *
 * **Nothing is case-converted at the point of use.** `No {many} yet` takes the
 * label as it is given rather than lowercasing it, because German capitalises
 * every noun and a language without letter case has nothing to convert.
 */

export const strings = {
  // Dates. Abbreviated month names, because a table column has no room for
  // the full ones and a household reading its own records knows which is which.
  'month.1': 'Jan',
  'month.2': 'Feb',
  'month.3': 'Mar',
  'month.4': 'Apr',
  'month.5': 'May',
  'month.6': 'Jun',
  'month.7': 'Jul',
  'month.8': 'Aug',
  'month.9': 'Sep',
  'month.10': 'Oct',
  'month.11': 'Nov',
  'month.12': 'Dec',

  // Day and instant. The order of the parts is inside the string so a language
  // that writes the year first can move it.
  'date.day': '{d} {month}',
  'date.dayWithYear': '{d} {month} {year}',
  'date.instant': '{day}, {hh}:{mm}',

  // Relative days. Singular and plural are separate keys rather than an `s`
  // appended, which is a rule that holds in English and almost nowhere else.
  'date.today': 'today',
  'date.tomorrow': 'tomorrow',
  'date.yesterday': 'yesterday',
  'date.inDays': 'in {n} days',
  'date.daysAgo': '{n} days ago',

  // Generic record screens. `{one}` and `{many}` are schema labels, already
  // translated by the time they arrive here.
  'record.add': 'Add {one}',
  'record.save': 'Save changes',
  'record.emptyTitle': 'No {many} yet',
  'record.search': 'Search {many}',
  'record.allOf': 'All {many}',
  'record.addFirst': 'Add the first {one}',
  'record.added': '{One} added',
  'record.deleted': '{One} deleted',
  'record.saved': 'Saved',
  'record.editTitle': 'Edit {one}',
  'record.newTitle': 'New {one}',
  'record.deleteTitle': 'Delete this {one}?',
  'record.deleteBlockedTitle': 'This {one} cannot be deleted yet',

  // Safety. The first module written after this catalogue existed, and the
  // reason the unrouted count did not go up when Phase 15 landed.
  'safety.title': 'Safety',
  'safety.subtitle': 'Where people were, and the places that matter',
  'safety.limits.title': 'What this does not do',
  'safety.limits.background': 'FamilyOS can record where this phone is while it is closed, but only after somebody switches it on and Android is set to allow location "all the time". While it runs there is a notification you cannot dismiss, so a phone that is recording always says so. It is off until you turn it on, and nothing starts it by itself.',
  'safety.trail.warning': 'A phone that is recording shows a notification the whole time. If you do not see one, it is not recording.',
  'identity.provenanceNote': 'These are your own notes on what each institution holds, taken from statements, portals and letters. Nothing here is fetched from the Central KYC Records Registry, and nothing here is verified \u2014 only compared.',
  'finance.subtitle': 'Where the money is, and where it went',
  'finance.addTransaction': 'Add transaction',
  'crud.add': 'Add',
  'identity.title': 'Identity',
  'identity.subtitle': 'Who everyone is, and what each institution holds',
  'finance.title': 'Finance',
  'consent.screenTime.title': 'See how long someone used the applications on this phone',
  'consent.screenTime.what': 'Which applications were opened on this device and for how long. Not what was typed, read, or sent \u2014 Android does not offer that and this does not ask for it.',
  'consent.screenTime.moment': 'Before anything is read, from the person\u2019s record.',
  'consent.screenTime.without': 'Nothing is read. This is the one thing in this list that a \u201cno\u201d actually switches off, rather than only recording that nobody was asked.',
  'trail.blocked.unsupported': 'this device has no FamilyOS location service — a browser cannot record a position while it is closed',
  'trail.blocked.foreground': 'FamilyOS has not been allowed to read this phone\u2019s location at all',
  'trail.blocked.background': 'FamilyOS may read the location only while it is open. Recording a trail needs "Allow all the time", which Android only offers in settings',
  'trail.blocked.notifications': 'Android will not let a recording run without a notification saying so, and notifications are switched off for FamilyOS',
  'screentime.unsupported': 'this device has no FamilyOS screen-time service — a browser cannot see which applications were used',
  'screentime.notPermitted': 'FamilyOS has not been given usage access. Android only offers it in settings, not as a prompt',
  'screentime.withheld.noPerson': 'nobody has said whose phone this is, so there is no one to ask',
  'screentime.withheld.unasked': 'this person has not been asked whether their screen time may be read',
  'screentime.withheld.refused': 'this person was asked and said no',
  'safety.trail.title': 'Recording where this phone is',
  'safety.trail.off': 'Off. Nothing is recorded while FamilyOS is closed.',
  'safety.trail.on': 'On. This phone is recording its position, and says so in a notification.',
  'safety.trail.start': 'Start recording',
  'safety.trail.stop': 'Stop recording',
  'safety.trail.settings': 'Open Android settings',
  'safety.trail.pending': '{n} readings taken and not yet saved',
  'safety.trail.untested': 'This has never been run on a real phone. It compiles, which is a different thing.',
  'safety.limits.geofence': 'Zones are circles this app measures against a reading it already has. They are not registered with the phone, so crossing one does not wake anything.',
  'safety.where.title': 'Where everyone was',
  'safety.where.count': '{n} of {total} with a reading',
  'safety.where.nobody': 'Nobody is on file yet',
  'safety.where.readMine': 'Record where I am',
  'safety.where.recorded': 'Position recorded',
  'safety.where.noPerson': 'This sign-in is not linked to a person, so there is nobody to record a position for.',
  'safety.fresh': 'just now',
  'safety.ageing': 'a while ago',
  'safety.stale': 'old',
  'safety.crossings.title': 'Zone crossings',
  'safety.crossings.arrived': 'Arrived at {zone}',
  'safety.crossings.left': 'Left {zone}',
  'safety.crossings.unsure': 'Noticed at {at}, but {hours} hours passed since the previous reading — the crossing happened somewhere in between',
  'safety.crossings.approx': 'when is a guess',

  // Whereabouts, in words. Sentences rather than fragments, so a language that
  // orders them differently can say so.
  'safety.none': '{name} has no location on this device.',
  'safety.seen': '{name} was {place} {when}.',
  'safety.seenStale': '{name} was {place} {when}. That is the last reading on this device, and it is old enough that it says nothing about now.',
  'safety.atZone': 'at {zone}',
  'safety.awayFromZones': 'away from every saved zone',
  'safety.justNow': 'just now',
  'safety.minutesAgo': '{n} minutes ago',
  'safety.hoursAgo': '{n} hours ago',

  // Why a position could not be read. Separate keys because "you said no" and
  // "the device could not get a fix" want different answers from the reader.
  'position.denied': 'This device has not been given permission to share its location. It can be granted in the browser or system settings for this app.',
  'position.unavailable': 'The device could not work out where it is. Indoors and underground are the usual reasons.',
  'position.timedOut': 'The device took too long to find a position.',
  'position.unsupported': 'This device has no location service available to the app.',
  'position.unknown': 'The location could not be read.',

  // The SOS message itself, which somebody sends from their own phone.
  'sos.needsHelp': '{name} needs help.',
  'sos.near': 'Near {zone}.',
  'sos.map': 'Map: {url}',
  'sos.accuracy': 'Accurate to about {n} m.',
  'sos.noPosition': 'No position could be read on this device.',
  'safety.somebody': 'This person',

  // How coarse a fix is, said in the units a person thinks in.
  'accuracy.unstated': 'the device did not say how accurate this is',
  'accuracy.metres': 'accurate to about {n} m',
  'accuracy.kilometres': 'accurate to about {n} km, so this is a neighbourhood and not a place',

  // Chat. The honesty lines are above the conversations on purpose: somebody
  // deciding whether to type something sensitive decides before they scroll.
  /* ------------------------------------------------------- notifications */
  'notifications.title': 'Notifications',
  'notifications.subtitle': 'Dates this household has recorded, and what is coming',
  'notifications.group.overdue': 'Already past',
  'notifications.group.urgent': 'This week',
  'notifications.group.soon': 'Soon',
  'notifications.group.upcoming': 'Later',
  'notifications.overdueBlurb': 'These dates have gone by.',
  'notifications.empty.title': 'Nothing is due',
  'notifications.empty.message': 'Nothing recorded here expires or falls due in the next 45 days. Add a policy, a document or a bill and its dates appear here.',
  'notifications.reach.title': 'How you find out',
  'notifications.reach.body': 'This list is here when you open it. The application does not send anything to your phone’s notification tray, so nothing here will interrupt you.',
  'notifications.reach.elsewhere': 'Dates also appear on the calendar and on the dashboard.',
  'notifications.dateFallback': 'Date',

  /* ------------------------------------------------------------- profile */
  'profile.title': 'Profile',
  'profile.subtitle': 'You, your household, and the controls',
  'profile.signedInAs': 'Signed in as {role}',
  'profile.signedIn': 'Signed in',
  'profile.recorded': 'Recorded',
  'profile.openRecord': 'Open your record',
  'profile.noPerson': 'No person record is linked to this sign-in yet, so there is nothing to measure. Add yourself under Identity and it appears here.',
  'profile.household': 'Household',
  'profile.people': '{n} people',
  'profile.person': '1 person',
  'profile.recordedAcross': 'Recorded across everyone',
  'profile.notEnough': 'Not enough recorded yet to measure.',
  'profile.averagedAll': 'Averaged across all {n} people',
  'profile.averagedSome': 'Averaged across {scored} of {n} people — the rest have nothing recorded yet',
  'profile.openFamily': 'Open the family',
  'profile.empty.title': 'No people recorded yet',
  'profile.empty.message': 'Add the people in your household and their records gather here.',
  'profile.group.you': 'You and the household',
  'profile.group.owned': 'What you own and owe',
  'profile.group.life': 'Life',
  'profile.group.records': 'Safety and records',
  'profile.settings': 'Settings',
  'profile.settingsHint': 'Security, privacy, connections, display, data',

  'chat.title': 'Chat',
  'chat.subtitle': 'Messages between people in this household',
  'chat.honesty.title': 'What this encryption covers',
  'chat.honesty.badge': 'end-to-end, with one exception',
  'chat.honesty.covered': 'A message is sealed to each participant\u2019s devices. Google cannot read it, and neither can anyone in this household who is not in the conversation.',
  'chat.honesty.escrow': 'Except the recovery phrase. Every message is also sealed to a key that phrase opens, so a restored backup can still read old conversations \u2014 which means whoever holds the phrase can read every conversation, including ones they were never part of.',
  'chat.honesty.unaudited': 'This uses standard Web Crypto and has been tested, but it has not been reviewed by a cryptographer. There is no forward secrecy: somebody who takes a device\u2019s key can read everything ever sent to it.',
  'chat.devices.title': 'Devices that can read messages',
  'chat.devices.count': '{n} enrolled',
  'chat.devices.none': 'No device has been enrolled yet',
  'chat.devices.notEnrolled': 'This device has no chat key yet, so it cannot read or send messages. Enrolling makes one and keeps the private half on this device only.',
  'chat.devices.enrol': 'Enrol this device',
  'chat.devices.enrolled': 'This device is enrolled',
  'chat.say': 'Say something',
  'chat.send': 'Send',
  'chat.someone': 'Someone',
  'chat.empty': 'Nothing has been said yet',
  'chat.file.choose': 'Choose a file',
  'chat.file.send': 'Send the file',
  'chat.file.open': 'Open',
  'chat.file.chosen': 'Ready to send: {name}',
  'chat.file.gone': 'That file is no longer on this device.',
  'chat.why.withdrawn': 'This message was withdrawn.',
  'chat.why.sentBefore': 'Sent before this device joined, so it was never sealed to it.',
  'chat.why.keyChanged': 'Sealed to a key this device no longer has.',
  'chat.why.notEnrolled': 'This device has no chat identity yet.',
  'chat.why.unreadable': 'This message could not be opened.',
  'chat.devices.thisDevice': 'This device',
  'chat.devices.done': 'This device can now read messages sent to it',
  'chat.devices.noPerson': 'This sign-in is not linked to a person, so there is nobody to enrol a device for.',
  'chat.devices.verified': 'The safety number was compared and matched',
  'chat.devices.unverified': 'Nobody has compared this device\u2019s safety number yet',
  'chat.devices.verifiedBadge': 'verified',
  'chat.devices.unverifiedBadge': 'unverified',

  // Every place the household's own records disagree about money. A whole
  // sentence per key, because each of these ends with what the application
  // deliberately did *not* do, and a translator handed the halves separately
  // would have no way to keep the refusal attached to the finding.
  'conflict.title': 'Disagreements',
  'conflict.none.title': 'Nothing disagrees',
  'conflict.none.body': 'Every payment with more than one source states the same figure on every one of them, and the wages recorded match the wages agreed. That is the records agreeing with each other \u2014 not a person having checked that any of them is true.',
  'conflict.heading.amount': 'Sources that name different amounts',
  'conflict.heading.date': 'Sources that name different days',
  'conflict.heading.missing-row': 'Paid, and not in the ledger',
  'conflict.heading.wages': 'Wages that are not the wages agreed',
  'conflict.why.amount': 'Two things that describe the same payment do not state the same figure. Every figure is kept exactly as it was recorded \u2014 correcting one means opening that record and changing it.',
  'conflict.why.date': 'These were matched on a reference both sources copied from the same rail, so they are one payment described twice. A gap of a day is a posting delay and is not listed; a wider one is worth a look.',
  'conflict.why.missing-row': 'An email receipt and a bank alert agree about a payment, and no imported statement row matches it. Nothing has been added \u2014 import the statement it belongs to, or record the payment yourself.',
  'conflict.why.wages': 'A whole month where what is recorded as paid is not what was agreed. Months that cannot honestly be judged \u2014 a part month, or one touched by unpaid leave \u2014 are left out rather than guessed at.',
  'conflict.said.amount': 'the sources for this payment do not state the same amount. Every figure is kept as it was recorded; nothing here decides which is right.',
  'conflict.said.date': 'the sources for this payment name days {n} apart. They were matched on a shared reference rather than a date, so this is one payment described twice \u2014 a delay between the alert and the posting is the usual reason. Neither date is changed.',
  'conflict.said.missing-row': '{finding}. Nothing has been added to the ledger.',
  'conflict.said.wages': 'wages recorded for {month} are not the wages agreed. Both figures are kept; nothing here decides which is right.',
  'conflict.said.wagesNone': 'nothing is recorded as paid for {month}, and this month was not one of the ones left unjudged.',
  'conflict.figure.noAmount': 'no figure',
  'conflict.figure.date': '{source} {date}',
  'conflict.figure.amount': '{source} {amount}',
  'conflict.sentence': '{figures} \u2014 {why}',
  'conflict.banner.title': 'Records that disagree',
  'conflict.banner.body': '{n} things the household\u2019s own records do not agree about, including payments the ledger has never seen. They are all on one screen, with every figure named beside whatever stated it.',
  'conflict.banner.go': 'Open Disagreements',
  'evidence.corroborated': '{n} of {total} payments have more than one thing saying they happened. That is corroboration, not verification \u2014 none of these sources is a person having checked it.',
  'conflict.row.payment': 'A payment',
  'conflict.row.staff': 'A staff member',
  'conflict.more': '{n} more, not listed here.',
  'conflict.nothingDecided': 'Nothing on this screen has been decided. Every figure is still recorded as whatever stated it, and this list disappears when the record that is wrong is corrected \u2014 there is nothing here to tick off.',

  // A tab that does not exist. Reachable by editing the address bar, so it
  // is a sentence a person can actually see.
  'finance.unknownSection': 'Unknown section',

  // The language picker itself.
  'locale.title': 'Language',
  'locale.english': 'English',
  'locale.partial': '{name} — {percent}% translated, the rest appears in English',
  'locale.complete': '{name} — complete',
  'locale.refused': '{n} lines in {name} were left in English because a number or name was missing from the translation',
  'locale.only': 'FamilyOS is available in English only. docs/LOCALISATION.md says what a second language needs.',
};
