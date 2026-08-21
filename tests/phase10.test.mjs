import { test, describe, assert, setSuite } from './harness.mjs';
import { passportReadiness, describeReadiness, upcoming, WHY, FINDING } from '../js/domain/travel.js';
import { stateOf, cover, unwarranted, describeCover, STATE } from '../js/domain/warranty.js';
import { entity, entityNames } from '../js/data/schema.js';

setSuite('travel');

const people = [{ id: 'per_1', name: 'Asha' }, { id: 'per_2', name: 'Ravi' }];
const passport = (person, expiresOn) => ({ id: `doc_${person}`, person, kind: 'Passport', expiresOn });

describe('what it refuses to check', () => {
  test('a domestic trip needs no passport, and says so', () => {
    // Asking an Indian household about passport validity before a train to
    // Pune would teach them to ignore the warning that matters.
    const out = passportReadiness({ international: false, travellers: ['per_1'] }, { people });
    assert.not(out.checked);
    assert.equal(out.why, WHY.DOMESTIC);
  });

  test('a trip with nobody named on it cannot be checked', () => {
    const out = passportReadiness({ international: true, travellers: [], returnsOn: '2027-01-10' }, { people });
    assert.not(out.checked);
    assert.equal(out.why, WHY.NO_TRAVELLERS);
  });

  test('and a trip with no return date has no window to check against', () => {
    // A passport valid on the day you fly and expired on the day you return is
    // not a valid passport, so the return date is the one that matters.
    const out = passportReadiness({ international: true, travellers: ['per_1'] }, { people });
    assert.not(out.checked);
    assert.equal(out.why, WHY.NO_RETURN);
  });
});

describe('what it finds', () => {
  const trip = { international: true, travellers: ['per_1', 'per_2'], returnsOn: '2027-01-10' };

  test('a traveller with no passport is a gap, not a pass', () => {
    const out = passportReadiness(trip, { people, documents: [passport('per_1', '2030-01-01')] });
    assert.ok(out.checked);
    assert.length(out.findings, 1);
    assert.equal(out.findings[0].finding, FINDING.MISSING);
    assert.equal(out.findings[0].who, 'Ravi');
  });

  test('a passport expiring before the return date is named as expiring', () => {
    const out = passportReadiness(trip, {
      people,
      documents: [passport('per_1', '2030-01-01'), passport('per_2', '2027-01-05')],
    });
    assert.equal(out.findings[0].finding, FINDING.EXPIRED);
    assert.equal(out.findings[0].needed, '2027-01-10');
  });

  test('and one inside the six-month margin is a separate, softer finding', () => {
    // Most destinations require validity six months beyond entry. That is a
    // default, not a law, and the finding says which rule it applied.
    const out = passportReadiness(trip, {
      people,
      documents: [passport('per_1', '2030-01-01'), passport('per_2', '2027-03-01')],
    });
    assert.equal(out.findings[0].finding, FINDING.MARGIN);
    assert.equal(out.findings[0].needed, '2027-07-10');
  });

  test('a renewed passport is judged on the newer one', () => {
    // Somebody who renewed early holds two. The old one expiring says nothing
    // about whether they can travel.
    const out = passportReadiness({ ...trip, travellers: ['per_1'] }, {
      people,
      documents: [passport('per_1', '2026-01-01'), { ...passport('per_1', '2035-01-01'), id: 'doc_new' }],
    });
    assert.length(out.findings, 0, JSON.stringify(out.findings));
  });

  test('everyone ready says so with the date it checked against', () => {
    const out = passportReadiness(trip, {
      people,
      documents: [passport('per_1', '2030-01-01'), passport('per_2', '2030-01-01')],
    });
    assert.length(out.findings, 0);
    assert.includes(describeReadiness(out), '2027-07-10');
  });
});

describe('which trips are worth showing', () => {
  test('a returned trip drops off, one under way is current', () => {
    const trips = [
      { id: 't1', destination: 'Goa', departsOn: '2026-01-01', returnsOn: '2026-01-05' },
      { id: 't2', destination: 'Tokyo', departsOn: '2026-08-01', returnsOn: '2026-09-01' },
      { id: 't3', destination: 'Dubai', departsOn: '2026-12-01', returnsOn: '2026-12-10' },
    ];
    const rows = upcoming(trips, '2026-08-21');

    assert.deep(rows.map((r) => r.trip.id), ['t2', 't3']);
    assert.ok(rows[0].current, 'a trip already under way was not marked current');
    assert.not(rows[1].current);
  });
});

setSuite('warranties');

describe('what is covered', () => {
  test('a warranty is covered until the day it expires, inclusive', () => {
    assert.equal(stateOf({ expiresOn: '2026-08-21' }, '2026-08-21'), STATE.COVERED);
    assert.equal(stateOf({ expiresOn: '2026-08-20' }, '2026-08-21'), STATE.EXPIRED);
  });

  test('one that has not started is neither covered nor expired', () => {
    // An extended warranty often begins when the manufacturer's ends.
    assert.equal(stateOf({ startsOn: '2027-01-01', expiresOn: '2028-01-01' }, '2026-08-21'),
      STATE.NOT_STARTED);
  });

  test('and one with no expiry says so rather than being assumed live', () => {
    assert.equal(stateOf({ }, '2026-08-21'), STATE.UNDATED);
  });

  test('a warranty whose purchase was deleted keeps its own row', () => {
    // The promise was made. Losing the record of the object does not unmake it.
    const rows = cover([{ id: 'w1', purchase: 'gone', expiresOn: '2030-01-01' }], [], '2026-08-21');
    assert.length(rows, 1);
    assert.equal(rows[0].purchase, null);
    assert.equal(rows[0].state, STATE.COVERED);
  });
});

describe('what has no cover', () => {
  const purchases = [
    { id: 'p1', item: 'Washing machine' },
    { id: 'p2', item: 'Laptop' },
    { id: 'p3', item: 'Old fridge', disposedOn: '2026-02-01' },
  ];

  test('something sold or disposed of is not a gap', () => {
    // Listing it would teach somebody to skim the list, which is how the real
    // gaps get missed.
    const gaps = unwarranted(purchases, [{ id: 'w1', purchase: 'p1', expiresOn: '2030-01-01' }]);
    assert.deep(gaps.items.map((p) => p.id), ['p2']);
    assert.equal(gaps.disposed, 1);
    assert.equal(gaps.owned, 2);
  });

  test('and the sentence says it may mean nobody typed it in', () => {
    // Eleven purchases and three warranties is far more likely a household
    // that stopped typing than eight uncovered things.
    const gaps = unwarranted(purchases, []);
    const said = describeCover(cover([], purchases, '2026-08-21'), gaps);
    assert.includes(said, 'nobody typed it in');
  });

  test('with nothing recorded it refuses to describe a house', () => {
    const said = describeCover([], unwarranted([], []));
    assert.includes(said, 'nothing to say');
  });
});

setSuite('phase 10 · what the schema now carries');

describe('the entities Phase 10 names', () => {
  test('all four exist', () => {
    for (const name of ['purchase', 'warranty', 'trip', 'tenant']) {
      assert.includes(entityNames(), name);
    }
  });

  test('the two deadlines produce reminders without any code asking them to', () => {
    // `domain/reminders.js` walks the schema for fields marked `expiry`, so
    // this is what makes a warranty useful rather than a table.
    const expiry = (e, f) => entity(e).fields.find((x) => x.key === f)?.expiry;
    assert.ok(expiry('warranty', 'expiresOn'), 'a warranty expiring fires no reminder');
    assert.ok(expiry('tenant', 'agreementEndsOn'), 'a tenancy ending fires no reminder');
  });

  test('a serial number is encrypted, like every other identifier here', () => {
    const field = entity('purchase').fields.find((f) => f.key === 'serialNumber');
    assert.ok(field?.encrypted, 'the number an insurer asks for is stored in the clear');
  });

  test('a tenant is not given household access', () => {
    // The exposure is limited by the role, not by the entity. Nothing here
    // grants a tenant anything.
    const acl = entity('tenant').acl;
    assert.not(acl.read.includes('guest'), 'a guest can read tenancies');
    assert.not(acl.write.includes('adult'), 'any adult can rewrite a tenancy');
  });
});
