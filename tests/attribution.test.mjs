import { test, describe, assert, setSuite } from './harness.mjs';
import { ATTRIBUTION, attributionOf, worthWarning } from '../js/domain/attribution.js';

setSuite('attribution');

const ASHA = { publicKey: 'key-asha', person: 'p_asha' };
const RAVI = { publicKey: 'key-ravi', person: 'p_ravi' };
const DEVICES = [ASHA, RAVI];

const ask = (over = {}) => attributionOf({
  sender: 'p_asha', from: 'key-asha', devices: DEVICES, opened: true, ...over,
});

describe('the sender the row claims, against the one the envelope proves', () => {
  test('agreeing is confirmed', () => {
    const out = ask();
    assert.equal(out.verdict, ATTRIBUTION.confirmed);
    assert.equal(out.proven, 'p_asha');
  });

  test('and disagreeing is the finding this exists for', () => {
    /*
     * A row naming Asha, sealed by Ravi's device. Before this the screen drew
     * "Asha" and nothing anywhere asked the envelope, which had known the
     * answer since the message was sealed.
     */
    const out = ask({ from: 'key-ravi' });
    assert.equal(out.verdict, ATTRIBUTION.disputed);
    assert.equal(out.claimed, 'p_asha');
    assert.equal(out.proven, 'p_ravi');
  });
});

describe('what is not known is not an accusation', () => {
  test('a key this household has no record of proves nothing either way', () => {
    // A phone since wiped, or a record deleted. Reporting `disputed` here
    // would put a warning on honest messages, and a warning that cries wolf
    // is worse than none — the real one gets scrolled past.
    const out = ask({ from: 'key-nobody-has' });
    assert.equal(out.verdict, ATTRIBUTION.unknown);
    assert.equal(out.proven, null);
  });

  test('and neither is an empty device list', () => {
    assert.equal(ask({ devices: [] }).verdict, ATTRIBUTION.unknown);
    assert.equal(ask({ devices: undefined }).verdict, ATTRIBUTION.unknown);
  });

  test('an envelope with no sender key is unknown, not confirmed', () => {
    assert.equal(ask({ from: '' }).verdict, ATTRIBUTION.unknown);
    assert.equal(ask({ from: undefined }).verdict, ATTRIBUTION.unknown);
  });
});

describe('nothing is proven by a message that did not open', () => {
  test('an unopened envelope is unknown even when the two strings agree', () => {
    /*
     * The important one. Without `opened`, this function would compare
     * `row.sender` against a key nothing verified and call it confirmed —
     * attributing on the strength of the very field that cannot be trusted.
     */
    const out = ask({ opened: false });
    assert.equal(out.verdict, ATTRIBUTION.unknown);
    assert.equal(out.proven, null);
  });

  test('and unknown even when they disagree', () => {
    assert.equal(ask({ opened: false, from: 'key-ravi' }).verdict, ATTRIBUTION.unknown);
  });
});

describe('a retired phone still accounts for what it sent', () => {
  test('a revoked device confirms its own past messages', () => {
    // Revocation is forward-only — `ChatService.revoke` says a key that has
    // been used cannot be un-used. Excluding revoked rows would turn every
    // message from an old phone into a warning about impersonation.
    const out = attributionOf({
      sender: 'p_asha',
      from: 'key-asha',
      devices: [{ ...ASHA, revokedAt: '2026-01-01T00:00:00.000Z' }],
      opened: true,
    });
    assert.equal(out.verdict, ATTRIBUTION.confirmed);
  });

  test('and so does a deleted device row', () => {
    const out = attributionOf({
      sender: 'p_asha',
      from: 'key-asha',
      devices: [{ ...ASHA, deletedAt: '2026-01-01T00:00:00.000Z' }],
      opened: true,
    });
    assert.equal(out.verdict, ATTRIBUTION.confirmed);
  });

  test('one of a person’s several devices is enough', () => {
    const out = attributionOf({
      sender: 'p_asha',
      from: 'key-asha-tablet',
      devices: [ASHA, { publicKey: 'key-asha-tablet', person: 'p_asha' }],
      opened: true,
    });
    assert.equal(out.verdict, ATTRIBUTION.confirmed);
  });
});

describe('a row that names nobody', () => {
  test('an empty sender is disputed when the key belongs to somebody', () => {
    const out = ask({ sender: '' });
    assert.equal(out.verdict, ATTRIBUTION.disputed);
    assert.equal(out.proven, 'p_asha');
  });

  test('and a device recorded against nobody confirms nothing', () => {
    /*
     * Both sides empty. `'' === ''` is true, so without the guard this reads
     * as agreement and reports `confirmed` — two absences agreeing that a
     * message came from nobody in particular.
     *
     * The first version of this file tested the case above and claimed it
     * covered this one. It does not: there the device names a person, so the
     * comparison fails for an ordinary reason and the guard is never reached.
     * Deleting the guard broke no test. This is the test that breaks.
     */
    const out = attributionOf({
      sender: '',
      from: 'key-orphan',
      devices: [{ publicKey: 'key-orphan', person: '' }],
      opened: true,
    });
    assert.equal(out.verdict, ATTRIBUTION.disputed);
    assert.equal(out.proven, null);
  });
});

describe('only one of the three verdicts is worth a warning', () => {
  test('disputed alone', () => {
    assert.ok(worthWarning(ATTRIBUTION.disputed));
    assert.not(worthWarning(ATTRIBUTION.confirmed));
    assert.not(worthWarning(ATTRIBUTION.unknown));
    assert.not(worthWarning(undefined));
  });
});
