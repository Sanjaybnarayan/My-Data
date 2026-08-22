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

  // Safety. The first module written after this catalogue existed, and the
  // reason the unrouted count did not go up when Phase 15 landed.
  'safety.title': 'Safety',
  'safety.subtitle': 'Where people were, and the places that matter',
  'safety.limits.title': 'What this does not do',
  'safety.limits.background': 'FamilyOS reads a position only while somebody has the app open and asks it to. There is no background tracking: nothing is recorded while the phone is in a pocket, and no alert can reach you from a zone crossed while the app was closed.',
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

  // The language picker itself.
  'locale.title': 'Language',
  'locale.english': 'English',
  'locale.partial': '{name} — {percent}% translated, the rest appears in English',
  'locale.complete': '{name} — complete',
  'locale.refused': '{n} lines in {name} were left in English because a number or name was missing from the translation',
  'locale.only': 'FamilyOS is available in English only. docs/LOCALISATION.md says what a second language needs.',
};
