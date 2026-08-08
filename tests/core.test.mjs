import { test, describe, assert, setSuite, fakeClock, fakeStorage } from './harness.mjs';
import { newId, idTime, isId, deviceId } from '../js/core/ids.js';
import { Bus } from '../js/core/bus.js';
import * as d from '../js/core/dates.js';
import * as m from '../js/core/money.js';
import { ValidationError, TransportError, PermissionError, isRetryable } from '../js/core/errors.js';

setSuite('core');

describe('ids', () => {
  test('sort in creation order', () => {
    const ids = Array.from({ length: 200 }, () => newId('txn'));
    assert.deep([...ids].sort(), ids, 'ids minted in a loop must already be sorted');
  });

  test('carry their timestamp', () => {
    const at = Date.parse('2025-03-09T04:15:00Z');
    assert.equal(idTime(newId('txn', at)), at);
  });

  test('reject anything that is not one of ours', () => {
    assert.not(isId('hello'));
    assert.not(isId('txn_short'));
    assert.ok(isId(newId('txn')));
    assert.ok(isId(newId()));
  });

  test('are unique across a large batch', () => {
    const seen = new Set(Array.from({ length: 5000 }, () => newId('x')));
    assert.equal(seen.size, 5000);
  });

  test('device id is minted once and then reused', () => {
    const storage = fakeStorage();
    const first = deviceId(storage);
    assert.equal(deviceId(storage), first);
    assert.notEqual(deviceId(fakeStorage()), first);
  });
});

describe('bus', () => {
  test('reaches a parent topic', () => {
    const bus = new Bus();
    const seen = [];
    bus.on('data:changed', (p) => seen.push(['parent', p]));
    bus.on('data:changed:finance', (p) => seen.push(['child', p]));
    bus.emit('data:changed:finance', 1);
    assert.length(seen, 2);
  });

  test('does not reach a sibling', () => {
    const bus = new Bus();
    let hits = 0;
    bus.on('data:changed:health', () => hits++);
    bus.emit('data:changed:finance', 1);
    assert.equal(hits, 0);
  });

  test('one throwing handler does not stop the rest', () => {
    const errors = [];
    const bus = new Bus((err) => errors.push(err));
    let reached = false;
    bus.on('t', () => { throw new Error('boom'); });
    bus.on('t', () => { reached = true; });
    bus.emit('t');
    assert.ok(reached, 'the second handler must still run');
    assert.length(errors, 1);
  });

  test('a handler may unsubscribe during its own emit', () => {
    const bus = new Bus();
    let calls = 0;
    const off = bus.on('t', () => { calls++; off(); });
    bus.emit('t');
    bus.emit('t');
    assert.equal(calls, 1);
  });
});

describe('dates', () => {
  test('reject a day that does not exist', () => {
    assert.equal(d.fromDay('2025-02-30'), null);
    assert.equal(d.fromDay('2025-13-01'), null);
    assert.ok(d.fromDay('2024-02-29'), 'a leap day is real');
  });

  test('month arithmetic clamps rather than overflowing', () => {
    assert.equal(d.addMonths('2025-01-31', 1), '2025-02-28');
    assert.equal(d.addMonths('2024-01-31', 1), '2024-02-29');
    assert.equal(d.addMonths('2025-03-31', -1), '2025-02-28');
    assert.equal(d.addMonths('2025-01-15', 12), '2026-01-15');
  });

  test('days between is exact across a DST boundary', () => {
    // 30 March 2025 is when most of Europe springs forward. Any implementation
    // dividing elapsed milliseconds without normalising gets 30.958 here.
    assert.equal(d.daysBetween('2025-03-01', '2025-03-31'), 30);
    assert.equal(d.daysBetween('2025-03-31', '2025-03-01'), -30);
    assert.equal(d.daysBetween('2025-03-01', '2025-03-01'), 0);
  });

  test('age counts birthdays, not 365-day blocks', () => {
    assert.equal(d.ageOn('2000-06-15', '2025-06-14'), 24, 'the day before counts as the year before');
    assert.equal(d.ageOn('2000-06-15', '2025-06-15'), 25);
    assert.equal(d.ageOn('2000-02-29', '2025-02-28'), 24);
  });

  test('the next anniversary rolls into the following year', () => {
    assert.equal(d.nextAnniversary('1990-03-09', '2025-06-15'), '2026-03-09');
    assert.equal(d.nextAnniversary('1990-09-03', '2025-06-15'), '2025-09-03');
    assert.equal(d.nextAnniversary('1990-06-15', '2025-06-15'), '2025-06-15', 'today counts');
  });

  test('29 February falls back to the 28th in a common year', () => {
    assert.equal(d.nextAnniversary('2000-02-29', '2025-01-01'), '2025-02-28');
  });

  test('the financial year runs April to March', () => {
    assert.equal(d.startOfFinancialYear('2025-03-31'), '2024-04-01');
    assert.equal(d.startOfFinancialYear('2025-04-01'), '2025-04-01');
    assert.equal(d.endOfFinancialYear('2025-04-01'), '2026-03-31');
  });

  test('named ranges are inclusive at both ends', () => {
    const clock = fakeClock(Date.parse('2025-06-15T10:00:00'));
    const lastMonth = d.range('last-month', clock);
    assert.equal(lastMonth.from, '2025-05-01');
    assert.equal(lastMonth.to, '2025-05-31');
    assert.ok(d.withinRange('2025-05-31', lastMonth));
    assert.not(d.withinRange('2025-06-01', lastMonth));
  });
});

describe('money', () => {
  test('parses what people actually type', () => {
    assert.equal(m.toMinor('1,23,456.78'), 12345678);
    assert.equal(m.toMinor('₹ 1200'), 120000);
    assert.equal(m.toMinor('(45)'), -4500, 'accounting parentheses mean negative');
    assert.equal(m.toMinor('-45'), -4500);
    assert.equal(m.toMinor('.5'), 50);
    assert.equal(m.toMinor(''), null, 'empty is not zero');
    assert.equal(m.toMinor('abc'), null);
    assert.equal(m.toMinor('1.2.3'), null);
  });

  test('rounds half away from zero, symmetrically', () => {
    assert.equal(m.toMinor('1.005'), 101);
    assert.equal(m.toMinor('-1.005'), -101);
    assert.equal(m.mul(100, 0.5), 50);
    assert.equal(m.mul(101, 0.5), 51);
    assert.equal(m.mul(-101, 0.5), -51);
  });

  test('addition is exact where floats are not', () => {
    // 0.1 + 0.2 in rupees is the canonical float failure.
    assert.equal(m.add(m.toMinor('0.1'), m.toMinor('0.2')), m.toMinor('0.3'));
    const hundredth = Array.from({ length: 100 }, () => m.toMinor('0.01'));
    assert.equal(m.sum(hundredth), m.toMinor('1'));
  });

  test('an allocation adds back to the whole', () => {
    const parts = m.allocate(10000, 3);
    assert.equal(m.sum(parts), 10000, 'no paisa may be lost');
    assert.deep(parts, [3334, 3333, 3333]);
  });

  test('a weighted allocation also adds back', () => {
    const parts = m.allocate(10000, 0, [1, 1, 1, 1, 1, 1, 1]);
    assert.equal(m.sum(parts), 10000);
    assert.length(parts, 7);
  });

  test('a negative allocation adds back too', () => {
    const parts = m.allocate(-10000, 3);
    assert.equal(m.sum(parts), -10000);
  });

  test('compact form uses lakh and crore for rupees', () => {
    assert.equal(m.formatCompact(m.toMinor('150000')), '₹1.5 L');
    assert.equal(m.formatCompact(m.toMinor('25000000')), '₹2.5 Cr');
    assert.equal(m.formatCompact(m.toMinor('4500')), '₹4.5 K');
  });

  test('percentage change guards a zero base', () => {
    assert.equal(m.changePercent(0, 100), null);
    assert.equal(m.changePercent(0, 0), 0);
    assert.equal(m.changePercent(10000, 12500), 25);
    assert.equal(m.changePercent(-10000, -5000), 50);
  });
});

describe('errors', () => {
  test('a validation failure is never retried', () => {
    assert.not(isRetryable(new ValidationError([{ field: 'a', message: 'bad' }])));
    assert.not(isRetryable(new PermissionError('write', 'vaultItem', 'child')));
  });

  test('a server error is retried but a rejection is not', () => {
    assert.ok(isRetryable(new TransportError('down', { status: 503 })));
    assert.ok(isRetryable(new TransportError('offline', { status: 0 })));
    assert.ok(isRetryable(new TransportError('slow down', { status: 429 })));
    assert.not(isRetryable(new TransportError('no', { status: 400 })));
    assert.not(isRetryable(new TransportError('gone', { status: 404 })));
  });

  test('a validation error summarises for a person', () => {
    const one = new ValidationError([{ field: 'name', message: 'Name is required.' }]);
    assert.equal(one.userMessage, 'Name is required.');
    const many = new ValidationError([
      { field: 'a', message: 'x' }, { field: 'b', message: 'y' },
    ]);
    assert.includes(many.userMessage, '2 fields');
  });
});
