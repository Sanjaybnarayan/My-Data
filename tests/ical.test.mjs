/**
 * The calendar as a file.
 *
 * Not Google Calendar sync — that is still genuinely absent. This is the part
 * that can be built honestly without credentials and checked byte for byte:
 * RFC 5545 text, which Google Calendar, Apple Calendar and Outlook all read.
 *
 * The UID is why the identity work came first. Before it, calendar entries
 * carried no id at all — 0 of 31 measured — so an export would have had to
 * invent one, and an invented id changes between runs, which is how a
 * household ends up with twelve copies of their rent.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { toICalendar, icalProblems, icalFilename } from '../js/domain/ical.js';
import { entryId } from '../js/modules/calendar.js';

setSuite('ical');

const NOW = Date.UTC(2026, 7, 15, 10, 0, 0);
const ENTRY = {
  id: 'recurringPayment:r1:2026-09-01',
  source: 'money',
  date: '2026-09-01',
  title: 'Rent',
  subtitle: '₹35,000.00',
};

const ics = (entries, options) => toICalendar(entries, { now: NOW, ...options });
const lines = (text) => text.split('\r\n');
const octets = (line) => new TextEncoder().encode(line).length;

describe('a file a calendar will actually read', () => {
  test('every line ends CRLF, including the last', () => {
    // §3.1. Some parsers drop a final line with no terminator, which would
    // silently cost whoever imports it their END:VCALENDAR.
    const text = ics([ENTRY]);
    assert.ok(text.endsWith('\r\n'), JSON.stringify(text.slice(-20)));
    assert.not(/[^\r]\n/.test(text), 'a bare LF appears somewhere');
  });

  test('it opens and closes as one calendar', () => {
    const out = lines(ics([ENTRY]));
    assert.equal(out[0], 'BEGIN:VCALENDAR');
    assert.equal(out.filter((l) => l === 'END:VCALENDAR').length, 1);
    assert.ok(out.includes('VERSION:2.0'), out.join('|'));
  });

  test('an entry is an all-day event, with an exclusive end', () => {
    // §3.6.1: DTEND is the day *after*, or a one-day event reads as zero-day.
    const out = lines(ics([ENTRY]));
    assert.ok(out.includes('DTSTART;VALUE=DATE:20260901'), out.join('|'));
    assert.ok(out.includes('DTEND;VALUE=DATE:20260902'), out.join('|'));
  });

  test('a date is never given a fabricated time of day', () => {
    // A policy renews *on the third*. Inventing 9am for it would put an
    // insurance renewal in somebody's morning meeting slot.
    const text = ics([{ ...ENTRY, time: '09:00' }]);
    assert.not(/DTSTART(?!;VALUE=DATE)/.test(text), text);
    // The time is not lost, it is just not the start.
    assert.ok(text.includes('at 09:00'), text);
  });
});

describe('the UID, which is what makes a second import an update', () => {
  test('it carries the entry id, qualified with a domain', () => {
    const text = ics([ENTRY], { domain: 'example.test' });
    assert.ok(text.includes('recurringPayment:r1:2026-09-01@example.test'),
      text.replace(/\r\n /g, ''));
  });

  test('the same entry exported twice produces the same UID', () => {
    // The whole point. A UID that moved between runs would duplicate rather
    // than update, which is exactly what having no id at all would have done.
    const first = ics([ENTRY], { now: NOW });
    const second = ics([ENTRY], { now: NOW + 86_400_000 });
    const uid = (t) => lines(t).find((l) => l.startsWith('UID:'));
    assert.equal(uid(first), uid(second));
  });

  test('two entries on one day are two events, not one', () => {
    // Measured: two events called Standup, at nine and at five, are told apart
    // by nothing else a calendar can see.
    const text = ics([
      { id: entryId('event', 'v1'), date: '2026-09-10', title: 'Standup' },
      { id: entryId('event', 'v2'), date: '2026-09-10', title: 'Standup' },
    ]);
    assert.equal(lines(text).filter((l) => l.startsWith('UID:')).length, 2);
    assert.equal(new Set(lines(text).filter((l) => l.startsWith('UID:'))).size, 2);
  });
});

describe('text that would otherwise break the file', () => {
  test('semicolons, commas and backslashes are escaped', () => {
    // §3.3.11. An unescaped semicolon in a summary ends the value and turns
    // the rest of the title into a parameter.
    const text = ics([{ ...ENTRY, title: 'Rent; big, and \\ odd' }]);
    assert.ok(text.includes('SUMMARY:Rent\\; big\\, and \\\\ odd'),
      text.replace(/\r\n /g, ''));
  });

  test('a newline becomes an escaped one rather than a new line', () => {
    const text = ics([{ ...ENTRY, subtitle: 'first\nsecond' }]);
    assert.ok(text.includes('first\\nsecond'), text.replace(/\r\n /g, ''));
    // And it did not become an actual content line, which would be unparseable.
    assert.not(lines(text).includes('second'), text);
  });

  test('a long line is folded, and every line fits in 75 octets', () => {
    // §3.1, and it is *octets*: a rupee sign is three bytes and one character,
    // so folding by character produces lines that are over the limit.
    const text = ics([{ ...ENTRY, title: `₹${'0'.repeat(200)} a month for the flat` }]);
    for (const line of lines(text)) {
      assert.ok(octets(line) <= 75, `${octets(line)} octets: ${line}`);
    }
  });

  test('folding never splits a character in half', () => {
    // A fold mid-character produces a file that is not valid UTF-8 at all.
    const text = ics([{ ...ENTRY, title: '₹'.repeat(120) }]);
    const rebuilt = text.replace(/\r\n /g, '');
    assert.ok(rebuilt.includes('₹'.repeat(120)), rebuilt.slice(0, 200));
    // A lone replacement character would mean a byte was orphaned.
    assert.not(rebuilt.includes('�'), rebuilt.slice(0, 200));
  });

  test('unfolding restores the id exactly', () => {
    const long = `recurringPayment:${'r'.repeat(90)}:2026-09-01`;
    const text = ics([{ ...ENTRY, id: long }], { domain: 'example.test' });
    assert.ok(text.replace(/\r\n /g, '').includes(`UID:${long}@example.test`), text);
  });
});

describe('what is left out is said, not dropped quietly', () => {
  test('an entry with no date is not written, and is counted', () => {
    const entries = [ENTRY, { id: 'x', title: 'No date' }];
    assert.deep(icalProblems(entries), { undated: 1, unidentified: 0, written: 1 });
    assert.equal(lines(ics(entries)).filter((l) => l.startsWith('UID:')).length, 1);
  });

  test('an entry with no id is not written either', () => {
    // Writing it would mean inventing a UID, and an invented UID duplicates on
    // the next export. Better absent and reported than present and wrong.
    const entries = [ENTRY, { date: '2026-09-02', title: 'No id' }];
    assert.deep(icalProblems(entries), { undated: 0, unidentified: 1, written: 1 });
    assert.equal(lines(ics(entries)).filter((l) => l.startsWith('UID:')).length, 1);
  });

  test('nothing at all is still a valid calendar', () => {
    const out = lines(ics([]));
    assert.equal(out[0], 'BEGIN:VCALENDAR');
    assert.not(out.some((l) => l.startsWith('UID:')), out.join('|'));
    assert.deep(icalProblems([]), { undated: 0, unidentified: 0, written: 0 });
  });

  test('the filename carries the day, so two exports do not collide', () => {
    assert.equal(icalFilename('2026-08-15'), 'household-calendar-2026-08-15.ics');
  });
});

describe('an id identifies the thing, not the day it currently falls on', () => {
  test('a rescheduled event keeps its identity', () => {
    // One record, one square. Putting the date in the id would make moving a
    // dentist appointment add a second one rather than move the first.
    assert.equal(entryId('event', 'v1'), entryId('event', 'v1'));
    assert.equal(entryId('appointment', 'a1'), 'appointment:a1');
  });

  test('but a bill that falls twelve times is twelve entries', () => {
    assert.notEqual(
      entryId('recurringPayment', 'r1', '2026-09-01'),
      entryId('recurringPayment', 'r1', '2026-10-01'),
    );
  });
});
