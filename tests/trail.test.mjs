/**
 * The location trail, and the screen-time gate.
 *
 * Both are capabilities this application spent its design refusing, added on
 * a deliberate decision. What is checked hardest is the set of properties
 * that made the refusal arguable: off until switched on, refuses rather than
 * half-works, and — for screen time — never reads at all without a recorded
 * consent decision.
 *
 * None of this has run on a phone. These drive the JavaScript against a fake
 * plugin, which is the same footing `tests/smsinbox.test.mjs` stands on and
 * is stated in `docs/PHASE_STATUS.md` rather than glossed.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import {
  status, start, stop, drain, reasonFor, available, BLOCKED,
} from '../js/core/backgroundlocation.js';
import { usage, status as screenStatus, NOT_PERMITTED, UNSUPPORTED }
  from '../js/core/screentime.js';
import { ScreenTimeService, WITHHELD } from '../js/services/screentime.js';
import { grant, withdraw } from '../js/data/consent.js';

setSuite('trail');

/** A fake device. `null` for the plugin means a browser. */
const device = (over = {}) => {
  // `canRun` declared in the literal rather than bolted on afterwards: the
  // checker infers the object's shape from what it is created with, and an
  // assignment to a property that was not there is an error rather than an
  // addition.
  const said = {
    foreground: true, background: true, notifications: true,
    running: false, pending: 0, canRun: true, ...over,
  };
  said.canRun = said.foreground && said.background && said.notifications;
  const calls = [];
  const plugin = (name) => (name === 'BackgroundLocation' ? {
    status: async () => said,
    start: async () => { calls.push('start'); said.running = true; },
    stop: async () => { calls.push('stop'); said.running = false; },
    drain: async () => ({ fixes: over.fixes ?? [] }),
    requestForeground: async () => { calls.push('requestForeground'); },
    openSettings: async () => { calls.push('openSettings'); },
  } : null);
  return { plugin, calls, said };
};

describe('a browser is told it cannot, rather than shown a dead switch', () => {
  test('nothing is available without the plugin', async () => {
    assert.equal(available(() => null), false);
    const state = await status(() => null);
    assert.equal(state.supported, false);
    assert.equal(state.blocked, BLOCKED.UNSUPPORTED);
  });

  test('and starting refuses instead of pretending', async () => {
    const out = await start(() => null);
    assert.equal(out.ok, false);
    assert.equal(out.why, BLOCKED.UNSUPPORTED);
  });
});

describe('what stands in the way is reported one thing at a time', () => {
  test('the foreground grant first, because the other needs it', () => {
    assert.equal(reasonFor({ foreground: false, background: false, notifications: false }),
      BLOCKED.FOREGROUND);
  });

  test('then the background grant, which no prompt can obtain', () => {
    assert.equal(reasonFor({ foreground: true, background: false, notifications: true }),
      BLOCKED.BACKGROUND);
  });

  test('then notifications, without which the recorder would be invisible', () => {
    assert.equal(reasonFor({ foreground: true, background: true, notifications: false }),
      BLOCKED.NOTIFICATIONS);
  });

  test('and nothing when everything is granted', () => {
    assert.equal(reasonFor({ foreground: true, background: true, notifications: true }), null);
  });
});

describe('it refuses to half-start', () => {
  test('no background grant means no recording at all', async () => {
    // The failure that would make the switch a lie: a service running with
    // only the foreground grant records while the app is open, which is what
    // the application already did.
    const { plugin, calls } = device({ background: false });
    const out = await start(plugin);
    assert.equal(out.ok, false);
    assert.equal(out.why, BLOCKED.BACKGROUND);
    assert.equal(calls.includes('start'), false, 'it started anyway');
  });

  test('no notification permission means no recording either', async () => {
    const { plugin, calls } = device({ notifications: false });
    const out = await start(plugin);
    assert.equal(out.ok, false);
    assert.equal(calls.includes('start'), false);
  });

  test('and with everything granted it starts', async () => {
    const { plugin, calls } = device();
    const out = await start(plugin);
    assert.equal(out.ok, true);
    assert.equal(calls.includes('start'), true);
  });

  test('stopping always works, so nobody is stuck being recorded', async () => {
    const { plugin, calls } = device({ running: true });
    const out = await stop(plugin);
    assert.equal(out.ok, true);
    assert.equal(calls.includes('stop'), true);
  });
});

describe('what comes back from the service', () => {
  test('fixes arrive in the shape the rest of Phase 15 reads', async () => {
    const { plugin } = device({
      fixes: [{ latitude: 12.97, longitude: 77.59, accuracy: 18, at: 1_756_000_000_000 }],
    });
    const [fix] = await drain(plugin);
    assert.equal(fix.latitude, 12.97);
    assert.equal(fix.accuracy, 18);
    assert.equal(fix.source, 'trail');
    assert.ok(/^\d{4}-\d{2}-\d{2}T/.test(fix.at), 'a trail fix needs a timestamp');
  });

  test('and a reading with no position is dropped rather than stored as zero', async () => {
    // 0,0 is a real coordinate in the Atlantic. A dropped field must not
    // become a place somebody was.
    const { plugin } = device({
      fixes: [{ latitude: null, longitude: 77.59, at: 1 }, { longitude: 1, at: 2 }],
    });
    assert.length(await drain(plugin), 0);
  });

  test('accuracy the device did not give is null, not a number', async () => {
    const { plugin } = device({ fixes: [{ latitude: 1, longitude: 2, at: 3 }] });
    const [fix] = await drain(plugin);
    assert.equal(fix.accuracy, null);
  });
});

describe('screen time is not read without a decision', () => {
  // Faithful to `ScreenTimePlugin`: `usage` REJECTS when the special access
  // is missing, it does not resolve with an empty list. The first version of
  // this fake resolved either way, which made the check below pass for the
  // wrong reason — the fake was lying, not the module.
  const phone = (permitted = true, apps = []) => (name) => (name === 'ScreenTime' ? {
    status: async () => ({ permitted }),
    usage: async () => {
      if (!permitted) throw new Error('not-permitted');
      return { apps, from: 0, to: 1 };
    },
    openSettings: async () => {},
  } : null);

  test('a browser cannot see usage at all', async () => {
    const said = await screenStatus(() => null);
    assert.equal(said.supported, false);
    assert.equal(said.why, UNSUPPORTED);
  });

  test('and without the special access the answer is not an empty list', async () => {
    // "Nobody used anything" and "this phone will not tell you" are different
    // answers, and a screen showing zero for the second invents a finding.
    const out = await usage({ from: 0 }, phone(false));
    assert.equal(out.ok, false);
    assert.equal(out.why, NOT_PERMITTED);
  });

  test('nobody asked means nothing is read', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Ravi', relationship: 'other' });
    const out = await new ScreenTimeService(db).forPerson(person.id);
    assert.equal(out.asked, false);
    assert.equal(out.why, WITHHELD.UNASKED);
    assert.length(out.apps, 0);
  });

  test('a person who said no means nothing is read', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Ravi', relationship: 'other' });
    await withdraw(db, 'screenTime', { subject: person.id });
    const out = await new ScreenTimeService(db).forPerson(person.id);
    assert.equal(out.asked, false);
    assert.equal(out.why, WITHHELD.REFUSED);
  });

  test('and no person at all means nothing is read', async () => {
    const db = await makeDb();
    const out = await new ScreenTimeService(db).forPerson('');
    assert.equal(out.asked, false);
    assert.equal(out.why, WITHHELD.NO_PERSON);
  });

  test('a recorded agreement is what opens it', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Ravi', relationship: 'other' });
    const before = await new ScreenTimeService(db).readiness(person.id);
    assert.equal(before.permitted, false);

    await grant(db, 'screenTime', { subject: person.id });
    const after = await new ScreenTimeService(db).readiness(person.id);
    assert.equal(after.permitted, true);
    assert.equal(after.why, null);
  });

  test('the purpose says a "no" actually stops something', () => {
    // Every other local purpose records whether anybody was asked and keeps
    // the records either way. This one is marked as different, and the
    // service above is where that mark is honoured.
    const purpose = new ScreenTimeService({ repo: () => {} }).purpose();
    assert.equal(purpose.withoutStops, true);
    assert.equal(purpose.aboutAPerson, true);
    assert.includes(purpose.without.toLowerCase(), 'nothing is read');
  });
});
