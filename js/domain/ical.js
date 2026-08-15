/**
 * The calendar, as a file a household can actually take somewhere.
 *
 * ## Why a file and not the Google Calendar API
 *
 * Phase 4 wants Calendar alongside Gmail and Drive, and Google Calendar sync is
 * genuinely absent — no client, no Apps Script, no scope. This is **not** that,
 * and does not pretend to be: no connection is opened, no permission is asked
 * for, and nothing leaves the device that the household did not press a button
 * to save.
 *
 * What it is instead is the part that can be built honestly today and checked
 * without credentials. iCalendar is a *format*, published as RFC 5545 and read
 * by Google Calendar, Apple Calendar, Outlook and every phone — so a household
 * gets their renewals and their EMIs onto the calendar they already use,
 * and this file can be verified byte for byte in a test rather than asserted to
 * work against a service nobody here can reach.
 *
 * The cost, stated plainly: a file is a **snapshot, not a sync**. Exported
 * twice, a well-behaved calendar updates the entries it already has rather than
 * doubling them — because every entry carries a stable `UID` — but nothing
 * removes an entry that has since been deleted here, and nothing flows back.
 * `docs/CALENDAR.md` says so, and so does the screen.
 *
 * ## UID is the whole reason the identity work came first
 *
 * RFC 5545 §3.8.4.7: the UID is what makes a second import an *update* rather
 * than a duplicate. Before this, calendar entries carried no id at all — 0 of
 * 31 measured — so an export would have had to invent one, and any invented id
 * changes between runs, which is precisely how a household ends up with twelve
 * copies of their rent.
 */

/** RFC 5545 §3.1: CRLF, always, whatever the platform. */
const CRLF = '\r\n';

/**
 * Escape a text value. §3.3.11: backslash, semicolon, comma and newline.
 *
 * The order matters — backslash first, or the backslashes this adds are
 * escaped again by the later replacements.
 */
function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Fold a content line to 75 octets. §3.1.
 *
 * Octets, not characters, and that distinction is the whole difficulty: a
 * rupee sign is three bytes in UTF-8 and one character, so folding by character
 * produces lines that are over the limit, and folding mid-character produces a
 * file that is not valid UTF-8 at all. This measures in bytes and only ever
 * breaks between whole characters.
 */
function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out = [];
  let current = '';
  let bytes = 0;
  // A continuation line begins with one space, which counts toward its own 75.
  let limit = 75;

  // `Array.from` iterates by code point, so a surrogate pair is never split.
  for (const char of Array.from(line)) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      out.push(current);
      current = char;
      bytes = size + 1;
      limit = 75;
    } else {
      current += char;
      bytes += size;
    }
  }
  out.push(current);

  return out.join(`${CRLF} `);
}

/** `2026-09-01` → `20260901`. The DATE value type, §3.3.4. */
function asDate(day) {
  return String(day ?? '').slice(0, 10).replace(/-/g, '');
}

/** The day after, so an all-day DTEND stays exclusive. §3.6.1. */
function dayAfter(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** A UTC timestamp in the DATE-TIME form, §3.3.5. */
function asTimestamp(ms) {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * One calendar entry as a VEVENT.
 *
 * Entries are written as **all-day** events. Most of what this calendar holds
 * is a day and not a moment — a policy renews on the third, an EMI leaves on
 * the fifth — and giving those a fabricated 9am start would put a household's
 * insurance renewal in their morning meeting slot. Where an entry does carry a
 * time it goes in the description rather than the start, because this file has
 * no timezone to state one in and guessing UTC would shift it.
 */
function vevent(entry, { stamp, domain }) {
  const lines = [
    'BEGIN:VEVENT',
    // The UID must be globally unique, so the household's own id is qualified
    // with a domain this application owns the shape of. §3.8.4.7.
    `UID:${escapeText(`${entry.id}@${domain}`)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${asDate(entry.date)}`,
    `DTEND;VALUE=DATE:${asDate(dayAfter(entry.date))}`,
    `SUMMARY:${escapeText(entry.title)}`,
  ];

  // The subtitle is what the screen shows beneath the title — an amount, a
  // policy's label, the time an appointment is at. Worth carrying; not worth
  // inventing when it is empty.
  const description = [entry.subtitle, entry.time ? `at ${entry.time}` : null]
    .filter(Boolean).join(' · ');
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);

  // Which of the six sources this came from, so a household can tell a renewal
  // from a birthday in a calendar that has lost this file's colours.
  if (entry.source) lines.push(`CATEGORIES:${escapeText(entry.source)}`);

  lines.push('END:VEVENT');
  return lines;
}

/**
 * A whole calendar, as RFC 5545 text.
 *
 * @param {Array<{id: string, date: string, title: string, subtitle?: string,
 *                time?: string|null, source?: string}>} entries
 * @param {{now?: number, domain?: string, name?: string}} [options]
 */
export function toICalendar(entries, { now = Date.now(), domain = 'my-data.local', name = 'Household' } = {}) {
  const stamp = asTimestamp(now);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//My Data//Household calendar//EN`,
    // Entries are dates rather than moments, so the file states no timezone
    // and every event is all-day. See `vevent`.
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];

  for (const entry of entries) {
    // An entry with no date is not an event, and one with no id cannot be
    // re-imported without duplicating. Neither is written rather than written
    // wrong; `icalProblems` reports both so the screen can say so.
    if (!entry?.date || !entry?.id) continue;
    lines.push(...vevent(entry, { stamp, domain }));
  }

  lines.push('END:VCALENDAR');

  // Trailing CRLF: §3.1 makes every content line end with one, including the
  // last, and some parsers drop a final line that has no terminator.
  return `${lines.map(fold).join(CRLF)}${CRLF}`;
}

/**
 * What could not be written, and why — so the screen can say it rather than
 * exporting quietly short.
 *
 * A count of what was dropped is the difference between "your calendar is in
 * this file" and "most of it is". The application has been wrong in that exact
 * way often enough to check for it.
 */
export function icalProblems(entries) {
  const undated = (entries ?? []).filter((entry) => entry && !entry.date).length;
  const unidentified = (entries ?? []).filter((entry) => entry?.date && !entry.id).length;
  return {
    undated,
    unidentified,
    written: (entries ?? []).length - undated - unidentified,
  };
}

/** A filename with the day in it, so two exports do not overwrite each other. */
export function icalFilename(day) {
  return `household-calendar-${String(day ?? '').slice(0, 10)}.ics`;
}
