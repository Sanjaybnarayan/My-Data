/**
 * Nominations, and what a family would need — Phase 12.
 *
 * The three questions this was written for are the three the roadmap said did
 * not exist: *"a nominee needs no derivation"*. Each one is a test here.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import {
  estate, nominations, nominationGaps, nomineeGroups, unnominable, unreadable,
  legacyInstructions, describeNomination, describeGap, NOMINEE_IS_NOT_HEIR,
  registrationStatus, REGISTRATION_IS_NOT_VALIDITY,
} from '../js/domain/estate.js';
import { strings as english } from '../js/locale/en.js';
import { ENVELOPE_PREFIX } from '../js/security/crypto.js';

setSuite('estate');

const people = [
  { id: 'p1', name: 'Sanjay Narayan', deletedAt: null },
  { id: 'p2', name: 'Meera Narayan', deletedAt: null },
  { id: 'p3', name: 'Aarav Narayan', deletedAt: null },
];

const household = () => ({
  people,
  accounts: [
    { id: 'a1', name: 'HDFC Savings', institution: 'HDFC',
      nominee: 'Meera Narayan', balance: 3_45_000_00, deletedAt: null },
    { id: 'a2', name: 'ICICI Salary', institution: 'ICICI',
      nominee: '', balance: 62_000_00, deletedAt: null },
    { id: 'a3', name: 'SBI Joint', institution: 'SBI', nominee: 'meera', deletedAt: null },
  ],
  holdings: [
    { id: 'h1', name: 'Nifty index fund', kind: 'mutual fund', nominee: 'M Narayan',
      currentValue: 8_40_000_00, active: true, deletedAt: null },
    { id: 'h2', name: 'SBI FD 2029', kind: 'fixed deposit', nominee: null,
      invested: 5_00_000_00, active: true, deletedAt: null },
  ],
  policies: [
    { id: 'i1', name: 'Term life', insurer: 'LIC', sumAssured: 1_00_00_000_00,
      nominee: 'Meera Narayan', deletedAt: null },
    { id: 'i2', name: 'Family health', insurer: 'Star', nominee: '', deletedAt: null },
  ],
  properties: [{ id: 'r1', name: 'Bengaluru flat', deletedAt: null }],
  vaultItems: [{ id: 'v1', name: 'Email', deletedAt: null }],
  digitalAssets: [
    { id: 'd1', name: 'Domain', legacyInstruction: 'Transfer to Meera', deletedAt: null },
    { id: 'd2', name: 'Photo archive', legacyInstruction: '', deletedAt: null },
  ],
});

describe('the three questions nothing could answer', () => {
  test('which of these have no nominee', () => {
    const gaps = nominationGaps(household()).map((gap) => gap.id);
    assert.deep(gaps.sort(), ['a2', 'h2', 'i2']);
  });

  test('what is nominated to Meera', () => {
    const mine = nominations(household()).filter((row) => row.person === 'p2');
    assert.deep(mine.map((row) => row.id).sort(), ['a1', 'i1']);
  });

  test('and “meera” is offered as her, not recorded as her', () => {
    // The record spelled `meera` shares no surname to match on, so it is a
    // possible match and `person` stays null. Rule: never force one.
    const loose = nominations(household()).find((row) => row.id === 'a3');
    assert.equal(loose.person, null);
    assert.deep(loose.possible, ['p2']);
  });
});

describe('a nominee is not an heir', () => {
  test('the sentence is on the screen, not in a comment', () => {
    assert.equal(estate(household()).notice, NOMINEE_IS_NOT_HEIR);
    assert.includes(NOMINEE_IS_NOT_HEIR, 'not who inherits');
  });

  test('no sentence it produces says anybody inherits anything', () => {
    // The words a household would read as a legal answer. This application
    // does not adjudicate succession and must not look as though it does.
    const said = [
      ...nominations(household()).map((row) => describeNomination(row)),
      ...nominationGaps(household()).map(describeGap),
    ].join(' ').toLowerCase();

    for (const word of ['inherit', 'goes to', 'will receive', 'entitled', 'heir']) {
      assert.not(said.includes(word), word);
    }
  });

  test('a nominee nobody in the household matches is said plainly', () => {
    const [row] = nominations({
      people,
      accounts: [{ id: 'a', name: 'Old NRE', institution: 'HDFC',
        nominee: 'Rajesh Iyer', deletedAt: null }],
    });
    assert.equal(row.person, null);
    assert.length(row.possible, 0);
    assert.includes(describeNomination(row), 'not somebody recorded in this household');
  });
});

describe('what it refuses to do with a number', () => {
  test('gaps are not ranked by money', () => {
    // An unnominated account becomes an unclaimed deposit whatever its size,
    // and sorting by amount tells a household the small ones matter less.
    const gaps = nominationGaps(household());
    const amounts = gaps.map((gap) => gap.amount);
    const descending = [...amounts].sort((a, b) => (b ?? 0) - (a ?? 0));
    assert.notEqual(amounts.join(), descending.join());
  });

  test('an unrecorded value is not counted as zero', () => {
    const out = estate(household());
    // ₹62,000 + ₹5,00,000 known; the health policy has no sum assured here.
    assert.equal(out.atStake, 5_62_000_00);
    assert.equal(out.valueUnknown, 1);
  });

  test('and the sentence says so rather than printing a figure', () => {
    const gap = nominationGaps(household()).find((row) => row.id === 'i2');
    assert.includes(describeGap(gap), 'value is not recorded here either');
    assert.not(describeGap(gap).includes('0'));
  });
});

describe('which records count', () => {
  test('a deleted record is neither a nomination nor a gap', () => {
    const data = { people, accounts: [
      { id: 'a', name: 'Closed', institution: 'HDFC', nominee: '', deletedAt: '2026-01-01' },
    ] };
    assert.length(nominationGaps(data), 0);
    assert.length(nominations(data), 0);
  });

  test('a closed holding is not a gap anybody can fix', () => {
    assert.length(nominationGaps({ holdings: [
      { id: 'h', name: 'Matured FD', kind: 'fixed deposit', active: false, deletedAt: null },
    ] }), 0);
  });

  test('an archived account is not one either', () => {
    assert.length(nominationGaps({ accounts: [
      { id: 'a', name: 'Old', institution: 'HDFC', archived: true, deletedAt: null },
    ] }), 0);
  });

  test('whitespace is not a nominee', () => {
    assert.length(nominationGaps({ accounts: [
      { id: 'a', name: 'HDFC', institution: 'HDFC', nominee: '   ', deletedAt: null },
    ] }), 1);
  });
});

describe('the spellings are grouped, and the people are not', () => {
  test('one name written two ways is one group', () => {
    const groups = nomineeGroups({ people, accounts: [
      { id: 'a1', name: 'One', nominee: 'Meera Narayan', deletedAt: null },
      { id: 'a2', name: 'Two', nominee: 'meera  narayan', deletedAt: null },
    ] });
    assert.length(groups, 1);
    assert.length(groups[0].records, 2);
    assert.equal(groups[0].person, 'p2');
  });

  test('two spellings that may be one person are still two groups', () => {
    // `meera` and `M Narayan` may be the same person. Merging them here would
    // be the merge this file exists to refuse.
    const groups = nomineeGroups({ people, accounts: [
      { id: 'a1', name: 'One', nominee: 'meera', deletedAt: null },
      { id: 'a2', name: 'Two', nominee: 'M Narayan', deletedAt: null },
    ] });
    assert.length(groups, 2);
    assert.not(groups.some((group) => group.person));
  });
});

describe('what carries no nominee field at all', () => {
  test('the flat is reported honestly rather than left out', () => {
    const kinds = unnominable(household());
    const property = kinds.find((kind) => kind.label === 'Property');
    assert.equal(property.held, 1);
    assert.includes(property.why, 'not by nomination');
  });

  test('nothing is reported for a kind the household does not own', () => {
    assert.length(unnominable({ people }), 0);
  });
});

describe('the one instruction the application already had', () => {
  test('a legacy instruction is reported as written', () => {
    const { recorded, missing } = legacyInstructions(household());
    assert.length(recorded, 1);
    assert.equal(recorded[0].instruction, 'Transfer to Meera');
    assert.length(missing, 1);
  });

  test('an empty household produces an answer, not a crash', () => {
    const out = estate({});
    assert.length(out.nominations, 0);
    assert.length(out.gaps, 0);
    assert.equal(out.atStake, 0);
    assert.equal(out.notice, NOMINEE_IS_NOT_HEIR);
  });
});

describe('a sealed nominee is neither a name nor a gap', () => {
  // All three nominee fields are encrypted, and the dashboard's bulk loader
  // reads every entity with `decrypt: false`. A widget built from that data
  // would see ciphertext where a name should be — and would report **no gaps
  // at all**, because every record would look as though it carried a nominee.
  // The screen built to say "nobody is named on these" would say nothing.
  const sealedRow = {
    id: 'a1', name: 'HDFC Savings', institution: 'HDFC', deletedAt: null,
    nominee: 'enc:v1:AAAABBBB:CCCCDDDD',
  };

  test('it is not read as a nominee', () => {
    assert.length(nominations({ people: [], accounts: [sealedRow] }), 0);
  });

  test('and it is not counted as a gap either', () => {
    assert.length(nominationGaps({ accounts: [sealedRow] }), 0);
  });

  test('it is counted and named, because silence would look like good news', () => {
    const out = estate({ accounts: [sealedRow] });
    assert.equal(out.unreadable, 1);
    assert.equal(unreadable({ accounts: [sealedRow] }), 1);
    assert.length(out.gaps, 0);
  });

  test('an ordinary name that merely looks technical is still a nominee', () => {
    // The guard is the envelope prefix, not "contains a colon".
    const [row] = nominations({
      people: [],
      accounts: [{ ...sealedRow, nominee: 'enc: Meera Narayan' }],
    });
    assert.equal(row.nominee, 'enc: Meera Narayan');
  });
});

describe('which instruments are recorded as registered', () => {
  // `will.registered` and `legalDocument.registered` sat on the unread
  // inventory, and the tool that listed them had been reporting them as read
  // for months on the strength of a sentence about geofencing. Once that was
  // corrected they were genuinely unread — collected on a form and touched by
  // nothing — which is the question this answers.

  const data = () => ({
    wills: [
      { id: 'w1', title: 'Will of Ravi', registered: true },
      { id: 'w2', title: 'Will of Meera', registered: false },
      { id: 'w3', title: 'Revoked will', registered: true, revokedOn: '2024-01-01' },
    ],
    legalDocuments: [
      { id: 'd1', title: 'Sale deed', kind: 'deed', registered: true, registrationNumber: 'REG-1' },
      { id: 'd2', title: 'Gift deed', kind: 'deed', registered: true, registrationNumber: '' },
      { id: 'd3', title: 'Power of attorney', kind: 'poa', registered: false, registrationNumber: 'REG-9' },
      { id: 'd4', title: 'Superseded deed', registered: true, supersededOn: '2024-06-01' },
    ],
  });

  test('an instrument no longer in force is not counted either way', () => {
    const out = registrationStatus(data());
    const ids = [...out.registered, ...out.notRecorded].map((one) => one.id);
    assert.not(ids.includes('w3'), 'a revoked will decides nothing');
    assert.not(ids.includes('d4'), 'a superseded deed decides nothing');
  });

  test('it reports the record, not the world', () => {
    const out = registrationStatus(data());
    assert.deep(out.registered.map((one) => one.id).sort(), ['d1', 'd2', 'w1']);
    assert.deep(out.notRecorded.map((one) => one.id).sort(), ['d3', 'w2']);
  });

  test('and the record disagreeing with itself needs no legal opinion', () => {
    const out = registrationStatus(data());
    assert.deep(
      out.disagreeing.map((one) => `${one.id}:${one.why}`).sort(),
      ['d2:noNumber', 'd3:numberOnly'],
    );
  });

  test('a will is never in that half, having no number to disagree with', () => {
    const out = registrationStatus(data());
    assert.not(out.disagreeing.some((one) => one.entity === 'will'));
    assert.ok(out.registered.concat(out.notRecorded)
      .filter((one) => one.entity === 'will')
      .every((one) => one.number === null));
  });

  test('a sealed registration number still counts as one being there', () => {
    // Loaded with `decrypt: false`, so the value is ciphertext. Presence
    // survives sealing and presence is the whole question — unlike `sealed()`
    // above, where reading a ciphertext as a name would have emptied the gap
    // list and told a household there was nothing to fix.
    const out = registrationStatus({
      legalDocuments: [{ id: 'd5', title: 'Lease', registered: true, registrationNumber: `${ENVELOPE_PREFIX}abc:def` }],
    });
    assert.length(out.disagreeing, 0);
  });

  test('the refusal is a catalogue key, and the catalogue has it', () => {
    // Its two siblings are sentences written before the catalogue existed. A
    // third would have raised a count that may only fall.
    assert.equal(typeof REGISTRATION_IS_NOT_VALIDITY, 'string');
    assert.ok(english[REGISTRATION_IS_NOT_VALIDITY], REGISTRATION_IS_NOT_VALIDITY);
    assert.equal(registrationStatus({}).noticeKey, REGISTRATION_IS_NOT_VALIDITY);
  });

  test('and it says an unregistered will is still a will', () => {
    // The one sentence this feature must never lose. Registration of a will is
    // optional in India; a screen implying otherwise would frighten a
    // household about a document that is perfectly good.
    assert.includes(english[REGISTRATION_IS_NOT_VALIDITY], 'unregistered will is still a will');
  });

  test('nothing recorded anywhere reports nothing', () => {
    const out = registrationStatus({});
    assert.length(out.registered, 0);
    assert.length(out.notRecorded, 0);
    assert.length(out.disagreeing, 0);
  });
});
