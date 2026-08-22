import { test, describe, assert, setSuite } from './harness.mjs';
import {
  WHERE, distanceMetres, isPoint, placeAgainst, zoneFor, placements, describeAccuracy,
} from '../js/domain/geo.js';
import {
  FRESHNESS, CROSSING, RETAIN_DAYS, STALE_MINUTES,
  readingsFor, freshness, lastKnown, transitions, expired, describeLastKnown, sosMessage,
} from '../js/domain/safety.js';
import { read, fromPosition, describeRefusal, DENIED, UNAVAILABLE, TIMED_OUT, UNSUPPORTED } from '../js/core/position.js';
import { policyFor } from '../js/data/retention.js';
import { entity } from '../js/data/schema.js';

setSuite('location');

/* ------------------------------------------------------------------- geo */

// Bengaluru, roughly. Real coordinates so the distances are checkable against
// something other than this file.
const SCHOOL = { latitude: 12.9716, longitude: 77.5946, radiusMetres: 200, name: 'School', id: 'z1' };
const NEIGHBOURHOOD = { latitude: 12.9716, longitude: 77.5946, radiusMetres: 3000, name: 'Indiranagar', id: 'z2' };

/** A fix `metres` north of a point. 1° of latitude is about 111,320 m. */
const north = (point, metres, accuracyMetres) => ({
  latitude: point.latitude + (metres / 111_320),
  longitude: point.longitude,
  accuracyMetres,
});

describe('distance', () => {
  test('a point is no distance from itself', () => {
    assert.equal(Math.round(distanceMetres(SCHOOL, SCHOOL)), 0);
  });

  test('a known offset comes back as that offset', () => {
    // 1,000 m north should measure 1,000 m, within a metre.
    const metres = distanceMetres(SCHOOL, north(SCHOOL, 1000, 10));
    assert.ok(Math.abs(metres - 1000) < 2, `${metres}`);
  });

  test('it is symmetric', () => {
    const a = distanceMetres(SCHOOL, north(SCHOOL, 500, 10));
    const b = distanceMetres(north(SCHOOL, 500, 10), SCHOOL);
    assert.ok(Math.abs(a - b) < 0.001);
  });

  test('an unusable point is null, never NaN', () => {
    // NaN propagates through a comparison and comes out as a decision.
    assert.equal(distanceMetres(SCHOOL, { latitude: 'x', longitude: 1 }), null);
    assert.equal(distanceMetres(SCHOOL, { latitude: 91, longitude: 0 }), null);
    assert.equal(distanceMetres(SCHOOL, null), null);
    assert.not(isPoint({ latitude: 0, longitude: 181 }));
  });
});

describe('a fix too coarse to place', () => {
  test('a precise fix well inside is inside', () => {
    assert.equal(placeAgainst(north(SCHOOL, 50, 10), SCHOOL), WHERE.INSIDE);
  });

  test('a precise fix well outside is outside', () => {
    assert.equal(placeAgainst(north(SCHOOL, 900, 10), SCHOOL), WHERE.OUTSIDE);
  });

  test('a 2 km fix cannot say anything about a 200 m circle', () => {
    // The whole reason this module exists. The centre of the fix is inside the
    // zone, and `distance < radius` would report "arrived at school" — a
    // specific claim about a child from a measurement that cannot support it.
    const coarse = north(SCHOOL, 50, 2000);
    assert.ok(distanceMetres(coarse, SCHOOL) < SCHOOL.radiusMetres, 'centre really is inside');
    assert.equal(placeAgainst(coarse, SCHOOL), WHERE.UNCERTAIN);
  });

  test('a fix straddling the edge is uncertain in both directions', () => {
    assert.equal(placeAgainst(north(SCHOOL, 190, 50), SCHOOL), WHERE.UNCERTAIN);
    assert.equal(placeAgainst(north(SCHOOL, 210, 50), SCHOOL), WHERE.UNCERTAIN);
  });

  test('a device that did not say how sure it is has not said it is certain', () => {
    assert.equal(placeAgainst({ ...north(SCHOOL, 10, 5), accuracyMetres: null }, SCHOOL), WHERE.UNCERTAIN);
    assert.equal(placeAgainst({ ...north(SCHOOL, 10, 5), accuracyMetres: -1 }, SCHOOL), WHERE.UNCERTAIN);
  });

  test('a zone with no radius is not a circle', () => {
    // Treated as zero it would put everybody permanently outside it, which
    // reads as a fact rather than as a misconfigured zone.
    assert.equal(placeAgainst(north(SCHOOL, 1, 5), { ...SCHOOL, radiusMetres: 0 }), WHERE.UNCERTAIN);
    assert.equal(placeAgainst(north(SCHOOL, 1, 5), { ...SCHOOL, radiusMetres: undefined }), WHERE.UNCERTAIN);
  });
});

describe('which zone', () => {
  test('the smallest containing zone wins, because it says more', () => {
    const fix = north(SCHOOL, 50, 10);
    assert.equal(zoneFor(fix, [NEIGHBOURHOOD, SCHOOL])?.id, 'z1');
    // Order must not decide it.
    assert.equal(zoneFor(fix, [SCHOOL, NEIGHBOURHOOD])?.id, 'z1');
  });

  test('a fix inside only the big one gets the big one', () => {
    assert.equal(zoneFor(north(SCHOOL, 1000, 10), [NEIGHBOURHOOD, SCHOOL])?.id, 'z2');
  });

  test('an uncertain placement is not a zone', () => {
    assert.equal(zoneFor(north(SCHOOL, 50, 2000), [SCHOOL]), null);
  });

  test('placements explain each zone, including the uncertain ones', () => {
    const rows = placements(north(SCHOOL, 50, 2000), [SCHOOL, NEIGHBOURHOOD]);
    assert.length(rows, 2);
    assert.equal(rows[0].where, WHERE.UNCERTAIN);
    assert.ok(Number.isFinite(rows[0].metres));
  });

  test('a coarse fix says so for itself', () => {
    assert.equal(describeAccuracy({ accuracyMetres: 20 }), null);
    assert.ok(/km/.test(describeAccuracy({ accuracyMetres: 2500 }) ?? ''));
    assert.ok(/m/.test(describeAccuracy({ accuracyMetres: 400 }) ?? ''));
    assert.ok(/did not say/.test(describeAccuracy({}) ?? ''));
  });
});

/* ---------------------------------------------------------------- safety */

const NOW = Date.parse('2026-08-22T12:00:00.000Z');
const ago = (minutes) => new Date(NOW - (minutes * 60_000)).toISOString();

// `id` after the spread on purpose: the zone fixtures carry an `id` of their
// own, and a reading that inherited it silently became a different row.
const ping = (id, person, minutesAgo, point) => ({
  person, recordedAt: ago(minutesAgo), ...point, id, deletedAt: null,
});

describe('how old a reading is', () => {
  test('fresh, ageing and stale are separated', () => {
    assert.equal(freshness(ping('p1', 'a', 5, SCHOOL), NOW).state, FRESHNESS.FRESH);
    assert.equal(freshness(ping('p2', 'a', 60, SCHOOL), NOW).state, FRESHNESS.AGEING);
    assert.equal(freshness(ping('p3', 'a', 600, SCHOOL), NOW).state, FRESHNESS.STALE);
  });

  test('an unparseable time is stale, not fresh', () => {
    // Failing open here would date a reading to now and put it on a screen as
    // current, which is the one direction this must never fail.
    assert.equal(freshness({ recordedAt: 'nonsense' }, NOW).state, FRESHNESS.STALE);
    assert.equal(freshness({}, NOW).state, FRESHNESS.STALE);
  });

  test('a stale position is reported in the past tense, and says it says nothing about now', () => {
    const known = lastKnown([ping('p1', 'a', 600, north(SCHOOL, 20, 10))], 'a',
      { now: NOW, zones: [SCHOOL] });
    const line = describeLastKnown(known, 'Asha');
    assert.ok(/says nothing about now/.test(line), line);
  });

  test('a person with no reading is not nowhere', () => {
    assert.equal(lastKnown([], 'a', { now: NOW }), null);
    assert.ok(/no location on this device/.test(describeLastKnown(null, 'Asha')));
  });

  test('the newest reading wins whatever order they arrive in', () => {
    const rows = [ping('old', 'a', 300, SCHOOL), ping('new', 'a', 5, SCHOOL)];
    assert.equal(lastKnown(rows.reverse(), 'a', { now: NOW }).ping.id, 'new');
    assert.equal(readingsFor(rows, 'a').at(-1).id, 'new');
  });

  test('a deleted reading is not a reading', () => {
    const rows = [ping('a1', 'a', 5, SCHOOL)];
    rows[0].deletedAt = new Date().toISOString();
    assert.equal(lastKnown(rows, 'a', { now: NOW }), null);
  });

  test('the zone is recomputed, not taken from the row', () => {
    // A zone can be moved or resized after a reading was stored, and the
    // stored name would then be a claim about a place that is no longer there.
    const row = { ...ping('p1', 'a', 5, north(SCHOOL, 20, 10)), zoneName: 'Old name', zone: 'z9' };
    assert.equal(lastKnown([row], 'a', { now: NOW, zones: [SCHOOL] }).zone.id, 'z1');
  });
});

describe('zone crossings', () => {
  const inside = north(SCHOOL, 20, 10);
  const outside = north(SCHOOL, 900, 10);

  test('going in and coming out are both reported', () => {
    const rows = [
      ping('1', 'kid', 300, outside),
      ping('2', 'kid', 280, inside),
      ping('3', 'kid', 260, outside),
    ];
    const out = transitions(rows, [SCHOOL]);
    assert.deep(out.map((c) => c.kind), [CROSSING.ARRIVED, CROSSING.LEFT]);
  });

  test('a crossing across a long gap is marked as a guess', () => {
    // Nobody watched them go. Printing a time without saying so would be an
    // observation nobody made.
    const rows = [ping('1', 'kid', 900, outside), ping('2', 'kid', 60, inside)];
    const [crossing] = transitions(rows, [SCHOOL]);
    assert.equal(crossing.kind, CROSSING.ARRIVED);
    assert.not(crossing.certain);
    assert.ok(crossing.gapMinutes > STALE_MINUTES);
  });

  test('a crossing between two close readings is not', () => {
    const rows = [ping('1', 'kid', 40, outside), ping('2', 'kid', 30, inside)];
    assert.ok(transitions(rows, [SCHOOL])[0].certain);
  });

  test('an uncertain reading never produces a crossing', () => {
    // The important one. A 2 km fix between two good ones must not invent an
    // arrival and a departure out of its own vagueness.
    const rows = [
      ping('1', 'kid', 300, outside),
      ping('2', 'kid', 280, north(SCHOOL, 50, 2000)),
      ping('3', 'kid', 260, outside),
    ];
    assert.deep(transitions(rows, [SCHOOL]), []);
  });

  test('a coarse reading in the middle does not erase a real crossing', () => {
    // The other half of the rule above, and the one that distinguishes
    // *skipping* an uncertain reading from *resetting* on it. Outside, then a
    // 2 km fix that says nothing, then decidedly inside: somebody did arrive,
    // and treating the vague reading as a break in the run loses that.
    const rows = [
      ping('1', 'kid', 300, outside),
      ping('2', 'kid', 280, north(SCHOOL, 50, 2000)),
      ping('3', 'kid', 260, inside),
    ];
    const out = transitions(rows, [SCHOOL]);
    assert.length(out, 1, out.map((c) => c.kind).join(' | '));
    assert.equal(out[0].kind, CROSSING.ARRIVED);
  });

  test('a zone that names who it watches ignores everybody else', () => {
    const watched = { ...SCHOOL, watch: ['kid'] };
    const rows = [
      ping('1', 'parent', 300, outside),
      ping('2', 'parent', 280, inside),
      ping('3', 'kid', 260, outside),
      ping('4', 'kid', 240, inside),
    ];
    const out = transitions(rows, [watched]);
    assert.length(out, 1, out.map((c) => c.person).join(' | '));
    assert.equal(out[0].person, 'kid');
  });

  test('a zone naming nobody is about the whole household', () => {
    const rows = [ping('1', 'parent', 300, outside), ping('2', 'parent', 280, inside)];
    assert.length(transitions(rows, [SCHOOL]), 1);
  });
});

describe('forgetting', () => {
  test('readings past the window are returned for deletion', () => {
    const old = ping('old', 'a', (RETAIN_DAYS + 1) * 24 * 60, SCHOOL);
    const recent = ping('recent', 'a', 60, SCHOOL);
    assert.deep(expired([old, recent], { now: NOW }), ['old']);
  });

  test('a reading exactly at the window is kept', () => {
    // Off-by-one here silently shortens or lengthens how long a family's
    // movements are held.
    const edge = ping('edge', 'a', RETAIN_DAYS * 24 * 60, SCHOOL);
    assert.deep(expired([edge], { now: NOW }), []);
  });

  test('an already-deleted reading is not deleted twice', () => {
    const gone = { ...ping('gone', 'a', 9999 * 60, SCHOOL), deletedAt: '2026-01-01T00:00:00.000Z' };
    assert.deep(expired([gone], { now: NOW }), []);
  });

  test('the window is a parameter, so a household could shorten it', () => {
    const row = ping('r', 'a', 3 * 24 * 60, SCHOOL);
    assert.deep(expired([row], { now: NOW, retainDays: 1 }), ['r']);
    assert.deep(expired([row], { now: NOW, retainDays: 90 }), []);
  });

  test('location records are deleted quickly once deleted', () => {
    // Retention governs deletions; `expired` governs live rows. Both have to
    // be short or the history outlives the intent either way.
    assert.equal(policyFor('locationPing').name, 'location');
    assert.ok(policyFor('locationPing').days <= 7);
  });
});

/* -------------------------------------------------------------- position */

const browserPosition = (coords, timestamp = NOW) => ({ coords, timestamp });

const fakeGeolocation = (behaviour) => ({
  getCurrentPosition(onOk, onErr) { behaviour(onOk, onErr); },
});

describe('reading a position', () => {
  test('a fix comes back with its accuracy, because everything downstream needs it', async () => {
    const result = await read({
      geolocation: fakeGeolocation((ok) => ok(browserPosition({
        latitude: 12.97, longitude: 77.59, accuracy: 12,
      }))),
    });
    assert.ok(result.ok);
    assert.equal(result.fix.accuracyMetres, 12);
    assert.equal(result.fix.recordedAt, new Date(NOW).toISOString());
  });

  test('an accuracy the device did not give is null, not zero', () => {
    // Zero would mean "perfectly certain", which is the opposite of what a
    // missing value says.
    assert.equal(fromPosition(browserPosition({ latitude: 1, longitude: 2 })).accuracyMetres, null);
  });

  test('each refusal is its own reason', async () => {
    const codes = [[1, DENIED], [2, UNAVAILABLE], [3, TIMED_OUT]];
    for (const [code, why] of codes) {
      const result = await read({ geolocation: fakeGeolocation((_ok, err) => err({ code })) });
      assert.not(result.ok);
      assert.equal(result.why, why);
    }
  });

  test('no geolocation at all is unsupported rather than denied', async () => {
    // Different sentences: one is a setting to change, the other is not.
    const result = await read({ geolocation: undefined });
    assert.equal(result.why, UNSUPPORTED);
    assert.notEqual(describeRefusal(UNSUPPORTED), describeRefusal(DENIED));
  });

  test('every refusal has words for a screen', () => {
    for (const why of [DENIED, UNAVAILABLE, TIMED_OUT, UNSUPPORTED, 'something else']) {
      assert.ok(describeRefusal(why).length > 10, why);
    }
  });

  test('the native plugin is preferred over the WebView, when there is one', async () => {
    // `navigator.geolocation` exists inside a Capacitor WebView and looks like
    // it works. Without an Android runtime grant behind it the prompt is
    // answered no before a person sees it, so the plugin has to win.
    const asked = [];
    const result = await read({
      // The fake WebView answers — with an error, but it answers. A stub that
      // recorded the call and never called back would leave the promise
      // unsettled, and removing the native path would then *hang* this suite
      // rather than fail it. A test that hangs proves less than one that
      // fails, and this project has been caught by that before.
      geolocation: fakeGeolocation((_ok, err) => { asked.push('webview'); err({ code: 2 }); }),
      plugin: () => ({
        checkPermissions: async () => ({ location: 'granted' }),
        getCurrentPosition: async () => {
          asked.push('plugin');
          return browserPosition({ latitude: 12.97, longitude: 77.59, accuracy: 9 });
        },
      }),
    });

    assert.deep(asked, ['plugin']);
    assert.ok(result.ok);
    assert.equal(result.fix.accuracyMetres, 9);
  });

  test('the native permission is asked for when it has not been granted', async () => {
    const calls = [];
    const result = await read({
      plugin: () => ({
        checkPermissions: async () => { calls.push('check'); return { location: 'prompt' }; },
        requestPermissions: async () => { calls.push('request'); return { location: 'granted' }; },
        getCurrentPosition: async () => browserPosition({ latitude: 1, longitude: 2, accuracy: 5 }),
      }),
    });

    assert.deep(calls, ['check', 'request']);
    assert.ok(result.ok);
  });

  test('a native refusal is denied on the permission state, not on a parsed message', async () => {
    const result = await read({
      plugin: () => ({
        checkPermissions: async () => ({ location: 'denied' }),
        requestPermissions: async () => ({ location: 'denied' }),
        getCurrentPosition: async () => { throw new Error('should never be asked'); },
      }),
    });

    assert.not(result.ok);
    assert.equal(result.why, DENIED);
  });

  test('a native failure below that falls back to unavailable rather than to ok', async () => {
    // The direction that matters: a reason this cannot classify puts a
    // slightly wrong sentence on a screen; a wrong `ok` puts a position there
    // that does not exist.
    const result = await read({
      plugin: () => ({
        checkPermissions: async () => ({ location: 'granted' }),
        getCurrentPosition: async () => { throw new Error('location services disabled'); },
      }),
    });

    assert.not(result.ok);
    assert.equal(result.why, UNAVAILABLE);
  });

  test('a callback that fires twice settles once', async () => {
    const result = await read({
      geolocation: fakeGeolocation((ok, err) => {
        ok(browserPosition({ latitude: 1, longitude: 2, accuracy: 5 }));
        err({ code: 1 });
      }),
    });
    assert.ok(result.ok);
  });
});

/* ------------------------------------------------------------------- sos */

describe('the SOS message', () => {
  test('it carries a map link when there is a position', () => {
    const message = sosMessage(
      { latitude: 12.9716, longitude: 77.5946, accuracyMetres: 20, reason: 'Car trouble' },
      { personName: 'Ravi', zone: SCHOOL },
    );
    assert.ok(/Ravi needs help/.test(message), message);
    assert.ok(/Car trouble/.test(message), message);
    assert.ok(/12.9716,77.5946/.test(message), message);
    assert.ok(/School/.test(message), message);
  });

  test('and says plainly when there is not, rather than leaving a hole', () => {
    const message = sosMessage({ reason: 'Help' }, { personName: 'Ravi' });
    assert.ok(/No position could be read/.test(message), message);
    assert.not(/maps\?q=/.test(message));
  });

  test('nothing in the schema claims it was sent', () => {
    // The field records what a person says they did. A default of anything
    // other than "not sent" would be the application claiming delivery it
    // cannot perform.
    const field = entity('sosAlert').fieldMap.sentVia;
    assert.equal(field.default, 'not sent');
    assert.ok(field.options.includes('not sent'));
  });
});
