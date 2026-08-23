import { test, describe, assert, setSuite } from './harness.mjs';
import {
  SECTIONS, APPLIES, completion, familyCompletion, describeCompletion, unknownReferences,
} from '../js/domain/profile.js';
import { grouped } from '../js/modules/profile.js';
import { PRIMARY } from '../js/ui/shell.js';
import { modules } from '../js/data/schema.js';

setSuite('profile');

/** Somebody who rents, drives nothing, owes nothing and runs no websites. */
const RENTER = Object.freeze({
  name: 'Asha', birthday: '1980-01-01', gender: 'female', photo: null,
  email: 'asha@example.com', phone: '9999999999', address: '',
  emergencyContactName: 'Ravi', emergencyContactPhone: '8888888888', bloodGroup: 'O+',
});

const RENTER_COUNTS = Object.freeze({
  identityDocument: 2, kycRecord: 1, document: 9, account: 2,
  holding: 3, policy: 1, healthRecord: 1, education: 1, employment: 1,
});

describe('sections', () => {
  test('every section names something the schema actually has', () => {
    // The failure this prevents is silent: a section pointing at a renamed
    // entity reports itself empty forever, and the household is told to fill
    // in something with nowhere to go.
    assert.deep(unknownReferences(), []);
  });

  test('and the check that says so can actually fail', () => {
    // Asserting the real list is clean passes equally against a function that
    // returns nothing at all. This hands it a broken list.
    assert.deep(
      unknownReferences([
        { id: 'gone', label: 'Gone', entities: ['hovercraft'] },
        { id: 'typo', label: 'Typo', fields: ['brithday'] },
      ]),
      ['gone → entity hovercraft', 'typo → person.brithday'],
    );
  });

  test('no section is declared twice, and none is empty', () => {
    const ids = SECTIONS.map((s) => s.id);
    assert.equal(ids.length, new Set(ids).size);
    for (const s of SECTIONS) {
      assert.ok((s.fields ?? s.entities ?? []).length > 0, `${s.id} asks for nothing`);
    }
  });
});

describe('one person', () => {
  test('a life without a car or a mortgage is capped, and that is the problem', () => {
    // The measurement this design exists for. Four sections cannot be filled
    // by any amount of typing, so the naive number sits here permanently.
    const naive = completion(RENTER, RENTER_COUNTS);
    assert.equal(naive.percent, 75);
    assert.deep(naive.waitingOn, ['Loans', 'Vehicles', 'Property', 'Digital life']);
  });

  test('saying a section does not apply takes it out of the total, not off the score', () => {
    const said = completion(RENTER, RENTER_COUNTS, {
      notApplicable: ['vehicles', 'property', 'loans', 'digital'],
    });
    assert.equal(said.percent, 100);
    assert.equal(said.applicable, 12);
    assert.equal(said.dismissed, 4);
    assert.deep(said.waitingOn, []);
  });

  test('a part-filled section counts as recorded and still says what is missing', () => {
    // Somebody with a name and no photograph is not in the same state as
    // somebody with nothing, and one number for both would say they are.
    const result = completion(RENTER, RENTER_COUNTS);
    const basics = result.sections.find((s) => s.id === 'basics');
    assert.equal(basics.state, APPLIES.RECORDED);
    assert.ok(basics.partial);
    assert.deep(basics.missing, ['photo']);

    const contact = result.sections.find((s) => s.id === 'contact');
    assert.deep(contact.missing, ['address']);
  });

  test('an empty string is not an answer', () => {
    const blank = completion({ name: '   ', birthday: '', gender: null, photo: null }, {});
    assert.equal(blank.sections.find((s) => s.id === 'basics').state, APPLIES.EMPTY);
  });

  test('a person with nothing recorded is zero, not null', () => {
    const nothing = completion({}, {});
    assert.equal(nothing.percent, 0);
    assert.equal(nothing.recorded, 0);
  });

  test('a person for whom nothing applies has no percentage at all', () => {
    // Zero would say the record is bare and a hundred would say it is done.
    // Both are inventions; there is no question to answer.
    const all = SECTIONS.map((s) => s.id);
    const none = completion(RENTER, RENTER_COUNTS, { notApplicable: all });
    assert.equal(none.percent, null);
    assert.equal(describeCompletion(none), 'Nothing applies to this person yet.');
  });

  test('the sentence under the number names the sections, not just the count', () => {
    const said = completion(RENTER, RENTER_COUNTS, { notApplicable: ['vehicles'] });
    const text = describeCompletion(said);
    assert.includes(text, '1 marked not applicable');
    assert.includes(text, 'Loans');
  });
});

describe('the household', () => {
  test('one bare profile is not averaged away by three full ones', () => {
    // The ratio of all recorded sections to all applicable ones reports 69%
    // here (36 of 52) and the mean reports 75%. The mean is chosen not because
    // it is higher but because the ratio weights each person by how many
    // sections apply to them, which measures their assets rather than their
    // record.
    const full = completion(RENTER, RENTER_COUNTS, {
      notApplicable: ['vehicles', 'property', 'loans', 'digital'],
    });
    const bare = completion({}, {});
    const family = familyCompletion([full, full, full, bare]);
    assert.equal(family.percent, 75);
    assert.equal(family.scored, 4);
    assert.equal(family.lowest.percent, 0);
  });

  test('a person with no percentage is left out rather than counted as zero', () => {
    const all = SECTIONS.map((s) => s.id);
    const full = completion(RENTER, RENTER_COUNTS, {
      notApplicable: ['vehicles', 'property', 'loans', 'digital'],
    });
    const nothingApplies = completion(RENTER, RENTER_COUNTS, { notApplicable: all });
    const family = familyCompletion([full, nothingApplies]);
    assert.equal(family.percent, 100);
    assert.equal(family.people, 2);
    assert.equal(family.scored, 1);
  });

  test('an empty household has no figure', () => {
    assert.equal(familyCompletion([]).percent, null);
  });
});

/**
 * Can every module be reached?
 *
 * The brief allows five bottom tabs and no sixth, so everything else has to be
 * reachable from Profile. That made the screen's four groups a hand-written
 * list of twenty ids beside a schema declaring twenty-five — the eleventh time
 * this repository has found a maintained list next to a derivable one, and the
 * first time the cost would have been a screen nobody could open.
 */
describe('every module is reachable', () => {
  test('nothing in the schema is left off Profile', () => {
    const reachable = new Set([
      ...grouped().flatMap((group) => group.items),
      ...PRIMARY,
      'settings',
    ]);

    const stranded = modules.map((one) => one.id).filter((id) => !reachable.has(id));
    assert.deep(stranded, [], 'reachable only by typing a URL');
  });

  test('a module nobody grouped still gets a home', () => {
    // The mechanism, not today's data. With every module claimed there is no
    // catch-all group at all, so asserting on the real schema would pass
    // whether the derivation worked or not.
    const groups = grouped([{ id: 'identity' }, { id: 'brandnew' }], ['dashboard']);
    const last = groups.at(-1);

    assert.equal(last.title, 'profile.group.rest');
    assert.deep(last.items, ['brandnew']);
  });

  test('and a module that is already grouped is not repeated', () => {
    const groups = grouped([{ id: 'identity' }, { id: 'settings' }], ['dashboard']);
    assert.equal(groups.length, 4, 'a catch-all group appeared with nothing to catch');
  });

  test('the five tabs are five, and Settings is not one of them', () => {
    // The brief is explicit on both halves.
    assert.equal(PRIMARY.length, 5);
    assert.equal(PRIMARY.includes('settings'), false);
  });
});
