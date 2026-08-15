/**
 * The CKYC conflict engine — Phase 2, and the prompt's identity tests.
 *
 * `domain/kyc.js` compares one person across the institutions holding their
 * KYC. Every one of its functions takes a person, so the prompt's sharpest
 * identity test — *the same CKYC assigned to two people* — could not be asked
 * at all.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { makeDb, makePerson } from './fixture.mjs';
import {
  compareValue, sharedIdentifiers, personConflicts, identityConflicts,
  describeConflict, AGREEMENT, SEVERITY, KIND,
} from '../js/domain/kycconflict.js';
import { can } from '../js/security/rbac.js';

setSuite('kyc conflict');

const record = (over) => ({
  id: 'k', person: 'p1', institution: 'HDFC', recordedOn: '2026-01-01', deletedAt: null, ...over,
});

describe("the prompt's identity tests", () => {
  test('the same CKYC against two people is a CRITICAL conflict', () => {
    const [conflict] = sharedIdentifiers([
      record({ id: 'k1', person: 'p1', kin: 'KIN0001' }),
      record({ id: 'k2', person: 'p2', kin: 'KIN0001', institution: 'ICICI' }),
    ]);

    assert.equal(conflict.severity, SEVERITY.CRITICAL);
    assert.equal(conflict.people.sort().join(), 'p1,p2');
    assert.includes(conflict.why, 'nothing here will merge them');
  });

  test('a different date of birth is a KYC conflict, naming which institution', () => {
    const [conflict] = personConflicts(
      { id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04' },
      [record({ heldName: 'Sanjay Narayan', heldBirthday: '1980-04-05' })],
    );

    assert.equal(conflict.agreement, AGREEMENT.CONFLICT);
    assert.equal(conflict.field, 'birthday');
    assert.equal(conflict.institution, 'HDFC');
    // Both figures, because which is right is the household's to decide.
    assert.equal(conflict.ours, '1980-05-04');
    assert.equal(conflict.theirs, '1980-04-05');
  });

  test('a role without permission cannot read a KYC record at all', () => {
    // The prompt's third identity test — ACCESS DENIED. The repository gates
    // every read, and the generated policy is what the server enforces.
    assert.ok(can({ role: 'owner' }, 'read', 'kycRecord'));
    assert.not(can({ role: 'child' }, 'read', 'kycRecord'));
    assert.not(can({ role: 'guest' }, 'read', 'kycRecord'));
  });
});

describe('how two values are compared', () => {
  test('a missing value is UNKNOWN, never a conflict', () => {
    // The difference is the whole usefulness of the screen: a household can act
    // on a disagreement and cannot act on a blank.
    assert.equal(compareValue('name', 'Sanjay', ''), AGREEMENT.UNKNOWN);
    assert.equal(compareValue('name', null, 'Sanjay'), AGREEMENT.UNKNOWN);
  });

  test('spacing, case and punctuation do not make a disagreement', () => {
    assert.equal(compareValue('name', 'Sanjay B. Narayan', 'sanjay b narayan'),
      AGREEMENT.MATCH);
  });

  test('a shared surname with a different given name is POSSIBLE, not either extreme', () => {
    // Exactly the pair a person should look at, and exactly the pair an
    // automatic answer would get wrong in both directions.
    assert.equal(compareValue('name', 'Sanjay Narayan', 'Meera Narayan'),
      AGREEMENT.POSSIBLE_MATCH);
  });

  test('an initial against a full given name is possible too', () => {
    assert.equal(compareValue('name', 'Sanjay Narayan', 'S Narayan'),
      AGREEMENT.POSSIBLE_MATCH);
  });

  test('an address written two ways is possible, not a conflict', () => {
    assert.equal(
      compareValue('address', '12 Residency Road, Bengaluru 560025',
        'No. 12, Residency Rd, Bengaluru'),
      AGREEMENT.POSSIBLE_MATCH,
    );
  });

  test('a date of birth has no near-miss reading', () => {
    assert.equal(compareValue('birthday', '1980-05-04', '1980-04-05'), AGREEMENT.CONFLICT);
  });
});

describe('what it refuses to do', () => {
  test('the identifier itself is never put into the report', () => {
    // It is encrypted at rest and masked on screen. A conflict is not a reason
    // to copy it somewhere new — the record ids are enough to find it.
    const [conflict] = sharedIdentifiers([
      record({ id: 'k1', person: 'p1', kin: 'KIN-SECRET-0001' }),
      record({ id: 'k2', person: 'p2', kin: 'KIN-SECRET-0001' }),
    ]);
    // Case-insensitively, and on the digits too: the leaked form would be
    // normalised to lower case, so an exact-case check misses it entirely —
    // which is how the first version of this test passed while a mutation put
    // the identifier straight into the report.
    const json = JSON.stringify(conflict).toLowerCase();
    assert.not(json.includes('secret'), json);
    assert.not(json.includes('0001'), json);
  });

  test('one person holding the same identifier twice is not a conflict', () => {
    // Two institutions holding one person's KIN is the ordinary case.
    assert.length(sharedIdentifiers([
      record({ id: 'k1', person: 'p1', kin: 'KIN0001' }),
      record({ id: 'k2', person: 'p1', kin: 'KIN0001', institution: 'ICICI' }),
    ]), 0);
  });

  test('a deleted record is not part of a conflict', () => {
    assert.length(sharedIdentifiers([
      record({ id: 'k1', person: 'p1', kin: 'KIN0001' }),
      record({ id: 'k2', person: 'p2', kin: 'KIN0001', deletedAt: '2026-01-02' }),
    ]), 0);
  });

  test('a PAN against two people is critical as well', () => {
    const [conflict] = sharedIdentifiers([
      record({ id: 'k1', person: 'p1', pan: 'ABCDE1234F' }),
      record({ id: 'k2', person: 'p2', pan: 'ABCDE1234F' }),
    ]);
    assert.equal(conflict.severity, SEVERITY.CRITICAL);
    assert.includes(conflict.why, 'belongs to one person');
  });

  test('nothing is merged, and the sentence says so', () => {
    const [conflict] = sharedIdentifiers([
      record({ id: 'k1', person: 'p1', kin: 'KIN0001' }),
      record({ id: 'k2', person: 'p2', kin: 'KIN0001' }),
    ]);
    assert.includes(describeConflict(conflict, (id) => id), 'nothing here will merge them');
  });

  test("another person's record is not compared against this one", () => {
    // A survivor found this. Every fixture above happened to give the record
    // the same person as the person passed in, so deleting the ownership check
    // altogether changed no assertion — while in a real household it would
    // report a wife's bank record as a disagreement about her husband.
    assert.length(personConflicts(
      { id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04' },
      [record({ person: 'p2', heldName: 'Meera Narayan', heldBirthday: '1984-11-19' })],
    ), 0);
  });

  test('a matching record produces nothing at all', () => {
    assert.length(personConflicts(
      { id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04' },
      [record({ heldName: 'Sanjay Narayan', heldBirthday: '1980-05-04' })],
    ), 0);
  });
});

describe('everything at once', () => {
  test('the critical conflict is listed before the field disagreements', () => {
    const people = [
      { id: 'p1', name: 'Sanjay Narayan', birthday: '1980-05-04' },
      { id: 'p2', name: 'Meera Narayan', birthday: '1984-11-19' },
    ];
    const records = [
      record({ id: 'k1', person: 'p1', kin: 'KIN0001', heldName: 'Sanjay Narayan', heldBirthday: '1980-05-04' }),
      record({ id: 'k2', person: 'p2', kin: 'KIN0001', institution: 'ICICI', heldName: 'Meera Narayan', heldBirthday: '1984-11-19' }),
      record({ id: 'k3', person: 'p1', institution: 'Axis', heldBirthday: '1980-04-05' }),
    ];
    const all = identityConflicts(people, records);

    assert.equal(all[0].severity, SEVERITY.CRITICAL);
    assert.ok(all.some((one) => one.kind === KIND.FIELD
      && one.field === 'birthday' && one.institution === 'Axis'));
  });

  test('a sentence is chosen by what the conflict is, not by how loud it is', () => {
    // The first version branched on `severity === CRITICAL`, which works only
    // while nothing but a shared identifier is ever critical. Raise a field
    // disagreement to that severity and the old branch reads `people` on a
    // record that has none — printing `undefined` at a household.
    const [field] = personConflicts(
      { id: 'p1', birthday: '1980-05-04' },
      [record({ heldBirthday: '1980-04-05' })],
    );
    const loud = { ...field, severity: SEVERITY.CRITICAL };

    assert.includes(describeConflict(loud), 'HDFC holds a date of birth');
    assert.not(String(describeConflict(loud)).includes('undefined'));
  });

  test('the sentence reads as English in front of a vowel', () => {
    // `a address` and `a email` were both on screen until this was printed.
    const [conflict] = personConflicts(
      { id: 'p1', address: '12 Residency Road, Bengaluru' },
      [record({ heldAddress: '9 Lavelle Road, Bengaluru' })],
    );
    assert.includes(describeConflict(conflict), 'holds an address');
  });

  test('a household with nothing wrong gets an empty list', async () => {
    const db = await makeDb();
    const person = await makePerson(db, { name: 'Sanjay Narayan', birthday: '1980-05-04' });
    assert.length(identityConflicts([person], []), 0);
  });
});
