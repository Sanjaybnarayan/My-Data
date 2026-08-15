/**
 * Google Calendar, written from the browser.
 *
 * ## What this is, and what the .ics export was
 *
 * `domain/ical.js` produces a file a household saves and imports themselves.
 * It is honest and it works everywhere, and it is a **snapshot**: nothing
 * removes an entry deleted here since, and importing again is a manual act.
 *
 * This is the sync the roadmap has recorded as genuinely absent since Phase 4
 * opened — a real Google API, reached with a real token, keeping a calendar up
 * to date without anybody exporting anything.
 *
 * ## The narrowest scope that does the job
 *
 * `calendar.app.created`, not `calendar` or `calendar.events`.
 *
 * That scope grants access **only to calendars this application itself
 * created**, and to nothing else in the account. A household's work calendar,
 * their family calendar, the birthdays Google generates for them — none of it
 * is readable or writable with this token. The application makes one secondary
 * calendar of its own, writes into that, and cannot see past it.
 *
 * The alternative, `calendar.events`, would grant read and write over *every*
 * calendar the person owns, to do a job that only ever touches one. That is the
 * plainest possible breach of "request the narrowest scope that does the job",
 * and `core/scopes.js` already carries a note about the last time this
 * application asked for more than it used.
 *
 * The cost is real and worth stating: entries land on a **separate calendar**
 * that a household has to leave switched on, rather than merging into the one
 * they already read. That is the price of not asking for their whole diary.
 *
 * ## Idempotent by construction
 *
 * Google accepts a client-supplied event id, and the id this sends is the one
 * `modules/calendar.js` already mints for every entry. So pushing twice updates
 * rather than duplicates — the same property the `.ics` UID gives, for the same
 * reason, and the reason the identity work came first.
 *
 * Google's ids are **base32hex**: lowercase `a`–`v` and `0`–`9` only, five to
 * 1024 characters. `expiry:policy:plc_01ABC:renewsOn` is none of those things,
 * so it is encoded rather than sent — see `googleEventId`.
 *
 * ## Nothing here decides what to send
 *
 * This is a transport. It takes entries, writes them, and reports what
 * happened. Which entries exist, and what they mean, stays in
 * `modules/calendar.js` and `domain/` where it can be tested without a network.
 */

import { TransportError } from '../core/errors.js';

export { CALENDAR_SCOPE, CALENDAR_SCOPES } from '../core/scopes.js';

const API = 'https://www.googleapis.com/calendar/v3';

/** What the application's own calendar is called in a household's list. */
export const CALENDAR_NAME = 'My Data — household';

/**
 * An entry id, as an id Google will accept.
 *
 * Base32hex, per the Calendar API: `a`–`v` and `0`–`9`, at least five
 * characters. Our ids contain colons, underscores and capitals, so they are
 * encoded byte by byte rather than sanitised — sanitising would map
 * `event:abc` and `event-abc` onto the same id, and two different entries
 * sharing an id is precisely the duplicate-or-overwrite bug this exists to
 * avoid.
 *
 * The encoding is plain hex over the UTF-8 bytes, which is a subset of
 * base32hex's alphabet and reversible. Long ids stay inside the 1024 limit for
 * anything this application produces; `googleEventId` reports rather than
 * truncates if that ever stops being true, because a truncated id collides.
 */
export function googleEventId(entryId) {
  const bytes = new TextEncoder().encode(String(entryId ?? ''));
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Prefixed with a letter: an id is allowed to start with a digit, but one
  // that does is easy to mistake for a number in a log.
  const id = `e${hex}`;
  if (id.length > 1024) return null;
  if (id.length < 5) return null;
  return id;
}

/** An entry, as a Calendar API event. All-day, for the reason `ical.js` gives. */
export function asGoogleEvent(entry) {
  const description = [entry.subtitle, entry.time ? `at ${entry.time}` : null]
    .filter(Boolean).join(' · ');

  return {
    id: googleEventId(entry.id),
    summary: entry.title,
    ...(description ? { description } : {}),
    // A date rather than a dateTime: a policy renews *on the third*, and
    // giving it a fabricated 9am start would put an insurance renewal in
    // somebody's morning meeting slot.
    start: { date: entry.date },
    end: { date: dayAfter(entry.date) },
    // Which of the six sources this came from, so a household can tell a
    // renewal from a birthday.
    ...(entry.source ? { extendedProperties: { private: { source: entry.source } } } : {}),
  };
}

function dayAfter(day) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export class CalendarClient {
  #getToken;
  #fetch;

  /**
   * @param {{getToken?: () => Promise<string>, fetchImpl?: typeof fetch}} [options]
   */
  constructor({ getToken, fetchImpl } = {}) {
    this.#getToken = getToken;
    this.#fetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  }

  get configured() {
    return Boolean(this.#fetch && this.#getToken);
  }

  /**
   * The application's own calendar, made if it is not there yet.
   *
   * Looked for by name in the list this token can see — which, under
   * `calendar.app.created`, is only ever calendars this application made. So
   * this cannot accidentally adopt a household's existing calendar of the same
   * name: it is not visible to look at.
   */
  async ownCalendar() {
    const list = await this.#call('GET', '/users/me/calendarList');
    const found = (list.items ?? []).find((cal) => cal.summary === CALENDAR_NAME);
    if (found) return found.id;

    const made = await this.#call('POST', '/calendars', {
      summary: CALENDAR_NAME,
      description: 'Renewals, bills and dates from the My Data household app. '
        + 'Entries here are written by that app and are safe to delete.',
    });
    return made.id;
  }

  /**
   * Write entries, one request each, and report what happened to every one.
   *
   * `PUT` rather than `POST`: with a client-supplied id, `PUT` creates the
   * event if it is new and updates it if it is not, which is exactly "push
   * twice, change nothing". A `POST` would return 409 on the second run and a
   * household would see errors for entries that are already correct.
   *
   * One failure does not lose the rest. A calendar that stopped at the first
   * refused entry would silently be missing everything after it, which is worse
   * than a partial push that says so.
   *
   * @param {object[]} entries from `modules/calendar.js`
   * @param {{calendarId?: string}} [options]
   */
  async push(entries, { calendarId } = {}) {
    const target = calendarId ?? await this.ownCalendar();

    const written = [];
    const failed = [];
    const skipped = [];

    for (const entry of entries ?? []) {
      // An entry with no id cannot be written idempotently, and one written
      // without an id duplicates on the next push. Reported, never guessed at.
      if (!entry?.id || !entry?.date) {
        skipped.push({ entry, why: entry?.id ? 'no date' : 'no id' });
        continue;
      }

      const event = asGoogleEvent(entry);
      if (!event.id) {
        skipped.push({ entry, why: 'id too long to send' });
        continue;
      }

      try {
        await this.#call('PUT',
          `/calendars/${encodeURIComponent(target)}/events/${event.id}`, event);
        written.push(entry.id);
      } catch (err) {
        failed.push({ entry: entry.id, why: err.message });
      }
    }

    return { calendarId: target, written, failed, skipped };
  }

  async #call(method, path, body) {
    const token = await this.#getToken();
    if (!token) {
      throw new TransportError('not signed in to Google Calendar',
        { status: 401, retryable: false });
    }

    let response;
    try {
      response = await this.#fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new TransportError(`could not reach Google Calendar: ${err.message}`,
        { status: 0, cause: err, retryable: true });
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new TransportError(
        response.status === 403
          ? 'this account has not granted permission to manage the app’s calendar'
          : `Google Calendar refused the request (${response.status})`,
        {
          status: response.status,
          // 429 and 5xx are worth another go; a refusal is not.
          retryable: response.status === 429 || response.status >= 500,
          body: text.slice(0, 300),
        },
      );
    }

    // A `PUT` returns the event; some calls return no body at all.
    const text = await response.text().catch(() => '');
    return text ? JSON.parse(text) : {};
  }
}
