/**
 * KYC records the household keeps themselves.
 *
 * Nothing here contacts the Central KYC Records Registry, and the tests are as
 * concerned with that staying true as with the arithmetic. A `kycRecord` is a
 * note of what one institution was seen to hold, typed in by hand, and the
 * only thing derived from it is where the copies disagree.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  kycDrift, latestPerInstitution, stale, kinNote, describeDrift,
} from '../js/domain/kyc.js';
import { entity } from '../js/data/schema.js';
import { maskableField } from '../js/data/classification.js';

setSuite('kyc');

const PERSON = {
  id: 'p1',
  name: 'Sanjay Iyer',
  address: '12/A, 4th Cross, Indiranagar, Bengaluru 560038',
  phone: '+91 98450 12345',
  email: 'sanjay@example.com',
  birthday: '1979-04-11',
};

const held = (over = {}) => ({
  id: `k${Math.random().toString(36).slice(2, 8)}`,
  person: 'p1',
  institution: 'HDFC Bank',
  recordedOn: '2026-01-15',
  source: 'their portal',
  deletedAt: null,
  ...over,
});

describe('where the copies disagree', () => {
  test('an address one institution never updated is reported', () => {
    // The reason any of this exists. An address changes once and eight
    // institutions find out at eight different times, or never.
    const drift = kycDrift(PERSON, [
      held({ institution: 'HDFC Bank', heldAddress: '12/A, 4th Cross, Indiranagar, Bengaluru 560038' }),
      held({ institution: 'Zerodha', heldAddress: '7 Palm Grove, Koramangala, Bengaluru 560034' }),
    ]);

    assert.length(drift, 1);
    assert.equal(drift[0].label, 'address');
    // Every side named, and the household's own copy is one of the sides
    // rather than the answer.
    assert.length(drift[0].values, 3);
    assert.ok(drift[0].values.some((v) => v.who === 'your own record'));
    assert.ok(drift[0].values.some((v) => v.who === 'Zerodha'));
  });

  test('the same address written two ways is not a disagreement', () => {
    // Case, punctuation and spacing differ on every form anyone ever fills in.
    // Reporting that would be noise, and noise trains people to stop reading.
    const drift = kycDrift(PERSON, [
      held({ institution: 'HDFC Bank', heldAddress: '12/a  4TH cross, indiranagar bengaluru 560038' }),
    ]);
    assert.length(drift, 0);
  });

  test('a mobile is compared on its digits, not its punctuation', () => {
    const same = kycDrift(PERSON, [held({ heldMobile: '098450-12345' })]);
    assert.length(same, 0);

    const different = kycDrift(PERSON, [held({ heldMobile: '+91 99000 11111' })]);
    assert.length(different, 1);
    assert.equal(different[0].label, 'mobile');
  });

  test('one copy is not a disagreement', () => {
    // Nothing to compare it against. Reporting it would say "your bank holds
    // an address", which is not news.
    assert.length(kycDrift({ id: 'p1', name: 'A' }, [held({ heldAddress: 'Somewhere' })]), 0);
  });

  test('a PAN is compared against the identity document, not the person record', () => {
    // A PAN lives on an identity document; the person record has no such field
    // and comparing against an absent one would report nothing at all.
    const drift = kycDrift(PERSON, [held({ pan: 'ABCDE1234Z' })], [
      { id: 'd1', person: 'p1', kind: 'PAN', number: 'ABCDE9999Q', deletedAt: null },
    ]);

    assert.length(drift, 1);
    assert.equal(drift[0].label, 'PAN');
    assert.ok(drift[0].values.some((v) => v.who === 'your PAN record'));
  });

  test('and a PAN differing only by case or spacing is the same PAN', () => {
    const drift = kycDrift(PERSON, [held({ pan: ' abcde1234z ' })], [
      { id: 'd1', person: 'p1', kind: 'PAN', number: 'ABCDE1234Z', deletedAt: null },
    ]);
    assert.length(drift, 0);
  });

  test('another person’s records are not compared with this one’s', () => {
    const drift = kycDrift(PERSON, [
      held({ heldAddress: PERSON.address }),
      held({ person: 'p2', institution: 'Someone Else Bank', heldAddress: 'Elsewhere entirely' }),
    ]);
    assert.length(drift, 0);
  });

  test('a deleted record is not a source of truth', () => {
    const drift = kycDrift(PERSON, [
      held({ heldAddress: PERSON.address }),
      held({ institution: 'Old Bank', heldAddress: 'Long gone', deletedAt: '2026-02-01T00:00:00.000Z' }),
    ]);
    assert.length(drift, 0);
  });

  test('nothing recorded is not an error', () => {
    assert.length(kycDrift(PERSON, []), 0);
    assert.length(kycDrift(null, [held()]), 0);
    assert.equal(describeDrift(null), null);
  });
});

describe('only the most recent record from each institution counts', () => {
  test('an old snapshot does not argue with the one that replaced it', () => {
    // Two records from the same bank are a history, not a disagreement. The
    // whole point of recording a date is that the newer one is what they hold.
    const drift = kycDrift(PERSON, [
      held({ institution: 'HDFC Bank', recordedOn: '2022-03-01', heldAddress: 'An address from four years ago' }),
      held({ institution: 'HDFC Bank', recordedOn: '2026-01-15', heldAddress: PERSON.address }),
    ]);
    assert.length(drift, 0);
  });

  test('two records on the same day fall back to which was written later', () => {
    const [latest] = latestPerInstitution([
      held({ recordedOn: '2026-01-15', heldName: 'first', updatedAt: '2026-01-15T09:00:00.000Z' }),
      held({ recordedOn: '2026-01-15', heldName: 'second', updatedAt: '2026-01-15T17:00:00.000Z' }),
    ]);
    assert.equal(latest.heldName, 'second');
  });

  test('the same institution named two ways is one institution', () => {
    // "HDFC Bank" and "hdfc bank" on two records are not two banks
    // disagreeing with each other.
    assert.length(latestPerInstitution([
      held({ institution: 'HDFC Bank', recordedOn: '2026-01-15' }),
      held({ institution: 'hdfc  bank', recordedOn: '2025-01-15' }),
    ]), 1);
  });

  test('a record with no institution named is not counted', () => {
    assert.length(latestPerInstitution([held({ institution: '' })]), 0);
  });
});

describe('records nobody has checked in years', () => {
  test('are listed, oldest first', () => {
    const old = stale([
      held({ institution: 'HDFC Bank', recordedOn: '2026-01-15' }),
      held({ institution: 'Zerodha', recordedOn: '2021-06-01' }),
      held({ institution: 'LIC', recordedOn: '2019-02-20' }),
    ], '2026-08-14');

    assert.deep(old.map((r) => r.institution), ['LIC', 'Zerodha']);
  });

  test('and a recent one is not', () => {
    assert.length(stale([held({ recordedOn: '2026-01-15' })], '2026-08-14'), 0);
  });
});

describe('the CKYC identifier', () => {
  test('fourteen digits passes without comment', () => {
    assert.equal(kinNote('12345678901234'), '');
    assert.equal(kinNote('1234 5678 9012 34'), '');
  });

  test('a different length is a note, never a rejection', () => {
    // A household copying a number off a letter must not be blocked by this
    // application's idea of a format.
    const note = kinNote('1234567890');
    assert.includes(note, 'fourteen digits');
    assert.includes(note, '10');
    assert.includes(note, 'nothing here can confirm it');
  });

  test('and letters in it are worth mentioning too', () => {
    assert.includes(kinNote('12345678901A34'), 'other characters');
  });

  test('nothing entered is not a complaint', () => {
    assert.equal(kinNote(''), '');
    assert.equal(kinNote(null), '');
  });

  test('a well-formed identifier is never called verified', () => {
    // Format is not existence. A validator implying otherwise would be
    // claiming a registry lookup that never ran.
    const said = `${kinNote('12345678901234')}${kinNote('123')}`;
    assert.not(/valid|verified|confirmed|registered/i.test(said), said);
  });
});

describe('the sentence', () => {
  test('names every side and picks none', () => {
    const [entry] = kycDrift(PERSON, [
      held({ institution: 'Zerodha', heldAddress: '7 Palm Grove, Koramangala' }),
    ]);
    const said = describeDrift(entry);

    assert.includes(said, 'your own record');
    assert.includes(said, 'Zerodha');
    assert.includes(said, 'Nothing here can tell which is current');
    // The one claim this must never make.
    assert.not(/should be|is correct|is wrong|out of date/i.test(said), said);
  });

  test('and says the registry was never involved', () => {
    const [entry] = kycDrift(PERSON, [held({ heldMobile: '+91 99000 11111' })]);
    assert.includes(describeDrift(entry), 'only from what you were shown');
  });
});

describe('what the record itself promises', () => {
  test('the KIN and the PAN are masked on screen by default', () => {
    // Measured when the entity was added: `kin` was rendered in full, because
    // the identifier shape test knew nothing about it.
    assert.ok(maskableField('kycRecord', 'kin'), 'a CKYC identifier is an identifier');
    assert.ok(maskableField('kycRecord', 'pan'));
  });

  test('and neither reaches a projection', () => {
    // A title or subtitle bypasses the field renderer that does the masking,
    // which is how a passport number once reached every list and picker.
    const record = held({ kin: '12345678901234', pan: 'ABCDE1234Z' });
    const spec = entity('kycRecord');

    for (const projection of [spec.title, spec.subtitle]) {
      const shown = String(projection?.(record) ?? '');
      assert.not(shown.includes('12345678901234'), shown);
      assert.not(shown.includes('ABCDE1234Z'), shown);
    }
  });

  test('it is owners-only, both ways', () => {
    // Somebody else's identity record is the last thing that should widen.
    assert.deep(entity('kycRecord').acl, { read: ['owner', 'spouse'], write: ['owner', 'spouse'] });
  });

  test('where the value came from is recorded and required', () => {
    // "Their portal said so" and "somebody told me on the phone" are different
    // kinds of evidence, and only the household can say which this was.
    const source = entity('kycRecord').fieldMap.source;
    assert.ok(source.required);
    assert.ok(source.options.includes('told verbally'));
  });

  test('and no field claims the registry was consulted', () => {
    // The property worth guarding above all the arithmetic: this entity must
    // never acquire a field that implies connectivity nobody has.
    const keys = entity('kycRecord').fields.map((f) => f.key).join(' ');
    assert.not(/verified|fetched|synced|registry|ckycrr/i.test(keys), keys);
  });
});
