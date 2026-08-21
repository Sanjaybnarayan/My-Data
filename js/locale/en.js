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

  // The language picker itself.
  'locale.title': 'Language',
  'locale.english': 'English',
  'locale.partial': '{name} — {percent}% translated, the rest appears in English',
  'locale.complete': '{name} — complete',
  'locale.refused': '{n} lines in {name} were left in English because a number or name was missing from the translation',
  'locale.only': 'FamilyOS is available in English only. docs/LOCALISATION.md says what a second language needs.',
};
