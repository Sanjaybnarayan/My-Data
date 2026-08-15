/**
 * Google Calendar, as far as it can honestly be checked here.
 *
 * The roadmap has recorded this as genuinely absent since Phase 4 opened — no
 * client, no scope, no connection of any kind. It exists now, and what can be
 * verified without credentials is verified: the requests it builds, the ids it
 * sends, the scope it asks for, and what it does when Google says no.
 *
 * **What is not verified, and is not claimed:** that Google accepts any of it.
 * Nothing here has been run against the live API. That is the same position
 * `sync/gmail.js` is in and it is stated rather than glossed.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  CalendarClient, googleEventId, asGoogleEvent, CALENDAR_NAME, CALENDAR_SCOPE,
} from '../js/sync/calendar.js';
import { SCOPES } from '../js/core/scopes.js';

setSuite('calsync');

/** A fetch that records what it was asked, and answers from a script. */
function fakeFetch(script) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({
      url,
      method: options.method ?? 'GET',
      body: options.body ? JSON.parse(options.body) : null,
      auth: options.headers?.Authorization ?? null,
    });
    const reply = typeof script === 'function' ? script(url, options) : script;
    return {
      ok: reply.ok ?? true,
      status: reply.status ?? 200,
      text: async () => JSON.stringify(reply.body ?? {}),
    };
  };
  // The fake answers only what the client asks of it, which is not the whole
  // `fetch` surface — cast rather than stubbed, so the test says what it means.
  return { impl: /** @type {any} */ (impl), calls };
}

const entry = (over = {}) => ({
  id: 'expiry:policy:plc_01ABC:renewsOn',
  date: '2026-10-03',
  title: 'Star Health renewal',
  subtitle: '₹18,644.00',
  source: 'expiry',
  ...over,
});

describe('the permission it asks for', () => {
  test('is the narrowest calendar scope Google offers', () => {
    // `calendar.events` would grant read and write over every calendar the
    // person owns, to do a job that only ever touches one.
    assert.equal(CALENDAR_SCOPE, 'https://www.googleapis.com/auth/calendar.app.created');
  });

  test('and it is declared where every other permission is declared', () => {
    // A scope the code asks for but the consent screen never lists is how
    // somebody spends an afternoon on a sign-in that cannot work.
    const declared = SCOPES.find((s) => s.id === CALENDAR_SCOPE);
    assert.ok(declared, 'the calendar scope is not in core/scopes.js');
    assert.equal(declared.where, 'browser');
    assert.not(declared.required, 'calendar sync must not be required to sign in');
    assert.ok(declared.without.includes('.ics'), declared.without);
  });
});

describe('the id it sends', () => {
  test('is something Google will accept', () => {
    // Base32hex: a-v and 0-9 only, at least five characters. Our own ids carry
    // colons and capitals and would be rejected outright.
    const id = googleEventId('expiry:policy:plc_01ABC:renewsOn');
    assert.ok(/^[a-v0-9]{5,1024}$/.test(id), id);
  });

  test('and is the same every time, which is what stops duplicates', () => {
    assert.equal(googleEventId('event:v1'), googleEventId('event:v1'));
  });

  test('and two different entries never collide', () => {
    // Sanitising rather than encoding would map `event:abc` and `event-abc`
    // onto one id, which is the duplicate-or-overwrite bug this avoids.
    assert.notEqual(googleEventId('event:abc'), googleEventId('event-abc'));
  });

  test('an id too long to send is refused rather than truncated', () => {
    // A truncated id collides, and a collision overwrites somebody's entry.
    assert.equal(googleEventId('x'.repeat(600)), null);
  });
});

describe('the event it builds', () => {
  test('is all-day, with an exclusive end', () => {
    const event = asGoogleEvent(entry());
    assert.deep(event.start, { date: '2026-10-03' });
    assert.deep(event.end, { date: '2026-10-04' });
  });

  test('never invents a time of day', () => {
    // A policy renews *on the third*. A fabricated 9am start would put an
    // insurance renewal in somebody's morning meeting slot.
    const event = asGoogleEvent(entry({ time: '09:00' }));
    assert.equal(event.start.dateTime, undefined);
    assert.ok(event.description.includes('at 09:00'), event.description);
  });

  test('carries which of the six sources it came from', () => {
    assert.equal(asGoogleEvent(entry()).extendedProperties.private.source, 'expiry');
  });
});

describe('pushing', () => {
  const client = (script) => {
    const fake = fakeFetch(script);
    return {
      fake,
      client: new CalendarClient({ getToken: async () => 'tok', fetchImpl: fake.impl }),
    };
  };

  const withCalendar = (events = []) => (url, options) => {
    if (url.endsWith('/users/me/calendarList')) {
      return { body: { items: events } };
    }
    if (options?.method === 'POST') return { body: { id: 'cal_new' } };
    return { body: {} };
  };

  test('makes its own calendar when there is not one', async () => {
    const { fake, client: c } = client(withCalendar([]));
    const id = await c.ownCalendar();

    assert.equal(id, 'cal_new');
    const made = fake.calls.find((call) => call.method === 'POST');
    assert.equal(made.body.summary, CALENDAR_NAME);
  });

  test('and reuses it on the next run rather than making a second', async () => {
    const { fake, client: c } = client(withCalendar([{ id: 'cal_1', summary: CALENDAR_NAME }]));
    assert.equal(await c.ownCalendar(), 'cal_1');
    assert.not(fake.calls.some((call) => call.method === 'POST'), 'it made a second calendar');
  });

  test('writes with PUT, so pushing twice updates rather than duplicates', async () => {
    // POST would return 409 on the second run, and a household would see
    // errors for entries that are already correct.
    const { fake, client: c } = client(withCalendar([{ id: 'cal_1', summary: CALENDAR_NAME }]));
    const result = await c.push([entry()]);

    assert.length(result.written, 1);
    const write = fake.calls.find((call) => call.method === 'PUT');
    assert.ok(write, 'nothing was written');
    assert.ok(write.url.includes(googleEventId(entry().id)), write.url);
    assert.equal(write.auth, 'Bearer tok');
  });

  test('an entry with no id is skipped and reported, never guessed at', async () => {
    // Written without an id it would duplicate on the next push.
    const { client: c } = client(withCalendar([{ id: 'cal_1', summary: CALENDAR_NAME }]));
    const result = await c.push([entry(), { date: '2026-10-04', title: 'No id' }]);

    assert.length(result.written, 1);
    assert.length(result.skipped, 1);
    assert.equal(result.skipped[0].why, 'no id');
  });

  test('one refused entry does not lose the rest', async () => {
    // A push that stopped at the first failure would silently be missing
    // everything after it.
    let seen = 0;
    const { client: c } = client((url, options) => {
      if (url.endsWith('/users/me/calendarList')) {
        return { body: { items: [{ id: 'cal_1', summary: CALENDAR_NAME }] } };
      }
      seen += 1;
      return seen === 1 ? { ok: false, status: 400, body: {} } : { body: {} };
    });

    const result = await c.push([entry({ id: 'a:1' }), entry({ id: 'b:2' })]);
    assert.length(result.failed, 1);
    assert.length(result.written, 1);
  });

  test('a refusal to see the calendar is said in words a person can act on', async () => {
    const { client: c } = client({ ok: false, status: 403, body: {} });
    let threw = null;
    try { await c.ownCalendar(); } catch (err) { threw = err; }

    assert.ok(threw, 'a 403 was not raised');
    assert.ok(/has not granted permission/.test(threw.message), threw.message);
    // `retryable` is a property on the error, not in `details` — reading the
    // wrong one made this assertion pass on `undefined` whatever the code did.
    assert.not(threw.retryable, 'a refusal is not worth retrying');
  });

  test('a rate limit is retryable and a refusal is not', async () => {
    const { client: c } = client({ ok: false, status: 429, body: {} });
    let threw = null;
    try { await c.ownCalendar(); } catch (err) { threw = err; }
    assert.ok(threw.retryable, 'a 429 should be retryable');
  });

  test('with no token it refuses before reaching the network', async () => {
    const fake = fakeFetch({ body: {} });
    const c = new CalendarClient({ getToken: async () => null, fetchImpl: fake.impl });

    let threw = null;
    try { await c.ownCalendar(); } catch (err) { threw = err; }
    assert.ok(threw, 'it tried without a token');
    assert.length(fake.calls, 0);
  });
});
