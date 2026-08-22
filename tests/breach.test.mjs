import { test, describe, assert, setSuite } from './harness.mjs';
import { SEVERITY, indicators, whoIsAffected, readiness } from '../js/domain/breach.js';

setSuite('breach');

const NOW = '2026-08-22T12:00:00.000Z';
const recent = (h) => new Date(new Date(NOW).getTime() - h * 3_600_000).toISOString();

/* ------------------------------------------------------------- indicators */

describe('facts that would matter afterwards', () => {
  test('a quiet household has none, and that is not an all-clear', () => {
    // The absence of indicators is not evidence that nothing happened, and
    // `readiness` has to keep saying so even when the list is empty.
    const found = indicators({ now: NOW });
    assert.length(found, 0);

    const answer = readiness({ now: NOW });
    assert.ok(answer.cannot.some((line) => /nothing happened/i.test(line)),
      JSON.stringify(answer.cannot));
  });

  test('an audit log that does not add up is the strongest signal there is', () => {
    const found = indicators({ chain: { ok: false }, now: NOW });
    assert.length(found, 1);
    assert.equal(found[0].kind, 'auditAltered');
    assert.equal(found[0].severity, SEVERITY.URGENT);
  });

  test('and it says what it does not mean, because it is defeatable', () => {
    // Somebody who can unlock FamilyOS can also rebuild the chain. Reporting
    // this as proof of tampering by an outsider would overstate it.
    const [found] = indicators({ chain: { ok: false }, now: NOW });
    assert.includes(found.notMeaning, 'rebuild the chain');
  });

  test('a chain that adds up produces nothing', () => {
    assert.length(indicators({ chain: { ok: true }, now: NOW }), 0);
  });

  test('a device that synced after being signed out is urgent', () => {
    const found = indicators({
      now: NOW,
      devices: [{
        deviceId: 'dev_a', label: 'Old phone',
        revokedAt: recent(48), lastSeenAt: recent(2),
      }],
    });
    assert.length(found, 1);
    assert.equal(found[0].kind, 'revokedStillActive');
    assert.equal(found[0].severity, SEVERITY.URGENT);
  });

  test('but one that has not synced since is not', () => {
    const found = indicators({
      now: NOW,
      devices: [{
        deviceId: 'dev_a', label: 'Old phone',
        revokedAt: recent(2), lastSeenAt: recent(48),
      }],
    });
    assert.length(found, 0, JSON.stringify(found));
  });

  test('an unchecked device is notable, not urgent', () => {
    // Most unchecked devices are devices nobody got round to checking, and
    // calling that urgent is how a list stops being read.
    const found = indicators({
      now: NOW, devices: [{ deviceId: 'dev_b', label: 'Laptop' }],
    });
    assert.length(found, 1);
    assert.equal(found[0].severity, SEVERITY.NOTABLE);
  });

  test('a verified device says nothing at all', () => {
    assert.length(indicators({
      now: NOW, devices: [{ deviceId: 'dev_b', verifiedAt: recent(100) }],
    }), 0);
  });

  test('a burst of exports is reported, a normal one is not', () => {
    const exports = (n) => Array.from({ length: n },
      () => ({ action: 'export', at: recent(1) }));

    assert.length(indicators({ now: NOW, audit: exports(2) }), 0);
    const found = indicators({ now: NOW, audit: exports(5) });
    assert.equal(found[0].kind, 'manyExports');
  });

  test('and exports outside the window are not counted', () => {
    const old = Array.from({ length: 9 }, () => ({ action: 'export', at: recent(72) }));
    assert.length(indicators({ now: NOW, audit: old }), 0);
  });

  test('a run of refusals is reported, and admits an innocent cause', () => {
    const refusals = Array.from({ length: 6 },
      () => ({ action: 'permission-denied', at: recent(1) }));
    const [found] = indicators({ now: NOW, audit: refusals });

    assert.equal(found.kind, 'repeatedRefusals');
    assert.includes(found.notMeaning, 'child');
  });

  test('the unambiguous one is listed first', () => {
    // A list that buries the audit chain under four unchecked devices is a
    // list somebody stops reading.
    const found = indicators({
      now: NOW,
      chain: { ok: false },
      devices: [
        { deviceId: 'a', label: 'A' }, { deviceId: 'b', label: 'B' },
        { deviceId: 'c', label: 'C' },
      ],
    });
    assert.equal(found[0].kind, 'auditAltered');
  });

  test('every indicator says what it does not mean', () => {
    // The whole difference between this and a widget that says "all clear".
    const found = indicators({
      now: NOW,
      chain: { ok: false },
      devices: [{ deviceId: 'a', label: 'A' },
        { deviceId: 'b', revokedAt: recent(9), lastSeenAt: recent(1) }],
      audit: [
        ...Array.from({ length: 4 }, () => ({ action: 'export', at: recent(1) })),
        ...Array.from({ length: 5 }, () => ({ action: 'permission-denied', at: recent(1) })),
      ],
    });

    assert.ok(found.length >= 4, `${found.length} indicators`);
    for (const one of found) {
      assert.ok(one.what && one.meaning && one.notMeaning, JSON.stringify(one));
    }
  });
});

/* --------------------------------------------------------- who to tell */

describe('who would have to be told', () => {
  const people = [
    { id: 'p1', name: 'Owner', role: 'owner' },
    { id: 'p2', name: 'Kiran', role: 'child' },
    { id: 'p3', name: 'Cook', role: 'staff' },
  ];

  test('everybody whose records are held is listed', () => {
    const rows = whoIsAffected({ people, staffPersonIds: ['p3'] });
    assert.length(rows, 3);
  });

  test('and the ones whose data is not the household’s own come first', () => {
    // The distinction is the point. A household member finding out is a
    // conversation; a child or somebody who works for you is the person the
    // obligation is actually about.
    const rows = whoIsAffected({ people, staffPersonIds: ['p3'] });
    assert.deep(rows.slice(0, 2).map((r) => r.id).sort(), ['p2', 'p3']);
    assert.ok(rows.slice(0, 2).every((r) => r.othersData));
    assert.not(rows[2].othersData);
  });

  test('each says why they are on the list', () => {
    const rows = whoIsAffected({ people, staffPersonIds: ['p3'] });
    assert.includes(rows.find((r) => r.id === 'p3').why, 'works for you');
    assert.includes(rows.find((r) => r.id === 'p2').why, 'child');
  });

  test('a household of one has one row, not an error', () => {
    assert.length(whoIsAffected({ people: [people[0]] }), 1);
    assert.length(whoIsAffected({}), 0);
  });
});

/* --------------------------------------------------------- the limits */

describe('what it says it cannot do', () => {
  test('it never claims to detect anything', () => {
    const answer = readiness({ now: NOW }, {});
    assert.ok(answer.cannot.some((line) => /Detect that a copy/i.test(line)));
  });

  test('and refuses the regulator half outright', () => {
    // Generating a filing from a household's guess would be worse than none.
    const answer = readiness({ now: NOW }, {});
    assert.ok(answer.cannot.some((line) => /Notify a regulator/i.test(line)),
      JSON.stringify(answer.cannot));
  });

  test('the limits come back even when there is something to report', () => {
    // A screen that drops the caveats the moment it has news is a screen that
    // overstates exactly when it matters most.
    const answer = readiness({ chain: { ok: false }, now: NOW }, {});
    assert.ok(answer.indicators.length);
    assert.length(answer.cannot, 3);
  });
});
