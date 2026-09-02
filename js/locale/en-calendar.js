/**
 * English, for the calendar.
 *
 * A separate file for the same reason as `en-instalments.js` and
 * `en-settings-data.js`: `en.js` is the catalogue, this is a screen's worth of
 * one idea, and the module-size ratchet holds `en.js` under 800 lines.
 *
 * Two strings in `js/modules/calendar.js` are deliberately left where they
 * are. One is a CSS value that only looks like a sentence to the string
 * counter, and one composes a schema label with a field value — neither is
 * English a translator could do anything with.
 */

export const calendarStrings = {
  'calendar.moneyDue': 'Money due',
  'calendar.subtitle': 'Events, tasks, appointments, money due and every renewal date',
  'calendar.syncGoogle': 'Sync to Google',
  'calendar.exportIcs': 'Export .ics',
  'calendar.addEvent': 'Add event',
  'calendar.prevMonth': 'Previous month',
  'calendar.nextMonth': 'Next month',
  'calendar.sources': 'Calendar sources',

  // One key, not the two source lines it was written across: the placeholder
  // check can only guard a whole sentence, and a translator needs the whole
  // one rather than the halves English happened to break it into.
  'calendar.cardsNote': 'Credit card bills are not shown this far ahead — a bill is the balance on a statement, and these cycles have not closed yet. Everything else is here.',

  'calendar.nothingToExport': 'Nothing dated in the next twelve months to export',
  'calendar.exported': '{written} entries exported, {dropped} skipped',
  'calendar.exportedClean': '{written} entries exported — importing again updates them rather than duplicating',
  'calendar.nothingToSync': 'Nothing dated in the next twelve months to sync',
  'calendar.synced': '{written} sent to your calendar, {left} could not be',
  'calendar.syncedClean': '{written} sent to a calendar of its own — sync again to update them',
  'calendar.dayLabel': '{day}, {n} entries',
  'calendar.more': '+{n} more',
  'calendar.nothingToday': 'Nothing on this day',
  'calendar.amountUnknown': 'amount not known',
  'calendar.turning': 'turning {age}',
};
