import { test, describe, assert, setSuite } from './harness.mjs';
import {
  namesAgree, NAMES, bequestConflicts, willCoverage, inForce,
  willsInConflict, currentLegalDocuments,
  A_NOTE_IS_NOT_THE_WILL, NOMINEE_IS_NOT_HEIR,
} from '../js/domain/estate.js';
import { compareValue, AGREEMENT } from '../js/domain/kycconflict.js';

setSuite('legal');

const DATA = Object.freeze({
  people: [{ id: 'p1', name: 'Meera Narayan' }, { id: 'p2', name: 'Ravi Narayan' }],
  accounts: [
    { id: 'a1', name: 'HDFC Savings', institution: 'HDFC', nominee: 'Meera Narayan', balance: 500000 },
    { id: 'a2', name: 'ICICI Savings', institution: 'ICICI', nominee: 'Meera Narayan', balance: 200000 },
    { id: 'a3', name: 'Axis Savings', institution: 'Axis', balance: 90000 },
  ],
  holdings: [],
  policies: [],
  wills: [{ id: 'w1', title: 'Will of 2026', testator: 'p1' }],
  beneficiaries: [
    { id: 'b1', will: 'w1', name: 'Ravi Narayan', assetId: 'a1', share: 'one half' },
    { id: 'b2', will: 'w1', name: 'M Narayan', assetId: 'a2' },
    { id: 'b3', will: 'w1', name: 'A charity', share: 'the residue' },
    { id: 'b4', will: 'w1', name: 'Ravi Narayan', assetId: 'a3' },
  ],
});

describe('two names, one question', () => {
  test('a different given name is a different person', () => {
    assert.equal(namesAgree('Meera Narayan', 'Ravi Narayan'), NAMES.DIFFERENT);
    assert.equal(namesAgree('Meera Narayan', 'Meera Iyer'), NAMES.DIFFERENT);
    assert.equal(namesAgree('Ravi Narayan', 'A charity'), NAMES.DIFFERENT);
  });

  test('an initial standing for a first name is an abbreviation', () => {
    assert.equal(namesAgree('Meera Narayan', 'M Narayan'), NAMES.ABBREVIATED);
    assert.equal(namesAgree('M. Narayan', 'Meera Narayan'), NAMES.ABBREVIATED);
    assert.equal(namesAgree('Ravi', 'Ravi Narayan'), NAMES.ABBREVIATED);
    assert.equal(namesAgree('Meera Narayan', 'Meera Devi Narayan'), NAMES.ABBREVIATED);
  });

  test('case and punctuation do not make two people', () => {
    assert.equal(namesAgree('Meera Narayan', 'meera  narayan'), NAMES.SAME);
  });

  test('an empty name agrees with nothing', () => {
    assert.equal(namesAgree('', 'Meera Narayan'), NAMES.DIFFERENT);
    assert.equal(namesAgree('Meera Narayan', null), NAMES.DIFFERENT);
  });

  test('and this is deliberately not what compareValue says', () => {
    // The measurement that forced a second comparison. `compareValue` exists
    // to spot one person recorded differently across institutions, so it reads
    // a shared surname as evidence. Everyone in a household shares a surname,
    // so reusing it here would call every real disagreement "unclear" and the
    // feature would report nothing worth acting on.
    assert.equal(
      compareValue('name', 'Meera Narayan', 'Ravi Narayan'),
      AGREEMENT.POSSIBLE_MATCH,
    );
    assert.equal(namesAgree('Meera Narayan', 'Ravi Narayan'), NAMES.DIFFERENT);
  });
});

describe('a nomination against a bequest', () => {
  test('different people is a conflict, with both names and no verdict', () => {
    const conflicts = bequestConflicts(DATA);
    const hdfc = conflicts.find((row) => row.id === 'a1');

    assert.equal(hdfc.nominee, 'Meera Narayan');
    assert.equal(hdfc.beneficiary, 'Ravi Narayan');
    assert.equal(hdfc.share, 'one half');
    assert.not(hdfc.unclear);
    // Neither side is marked correct anywhere in the row.
    assert.not('correct' in hdfc);
    assert.not('winner' in hdfc);
  });

  test('an abbreviation is unclear, not a conflict', () => {
    // Sending a household to a solicitor over an initial would be worse than
    // saying nothing.
    const icici = bequestConflicts(DATA).find((row) => row.id === 'a2');
    assert.ok(icici.unclear);
  });

  test('agreement is not reported at all', () => {
    const agreed = {
      ...DATA,
      beneficiaries: [{ id: 'b', will: 'w1', name: 'Meera Narayan', assetId: 'a1' }],
    };
    assert.length(bequestConflicts(agreed), 0);
  });

  test('a revoked will decides nothing and is not compared', () => {
    // A superseded instruction is not a disagreement with the current one.
    const revoked = { ...DATA, wills: [{ ...DATA.wills[0], revokedOn: '2026-01-01' }] };
    assert.length(bequestConflicts(revoked), 0);
    assert.not(inForce({ id: 'x', revokedOn: '2020-01-01' }));
    assert.not(inForce({ id: 'x', deletedAt: '2020-01-01' }));
    assert.ok(inForce(DATA.wills[0]));
  });

  test('a beneficiary naming no record here is kept, not compared', () => {
    const conflicts = bequestConflicts(DATA);
    assert.not(conflicts.some((row) => row.beneficiary === 'A charity'));
    assert.equal(willCoverage(DATA).unmatched, 1);
  });

  test('a beneficiary of a will that is not in the data is skipped', () => {
    const orphan = {
      ...DATA,
      beneficiaries: [{ id: 'b', will: 'w-missing', name: 'Ravi Narayan', assetId: 'a1' }],
    };
    assert.length(bequestConflicts(orphan), 0);
  });
});

describe('what each side covers', () => {
  test('the will names it and the institution was never told', () => {
    const cover = willCoverage(DATA);
    assert.deep(cover.willOnly.map((row) => row.name), ['Axis Savings']);
  });

  test('the institution was told and the will is silent', () => {
    const quiet = { ...DATA, beneficiaries: [] };
    const cover = willCoverage(quiet);
    assert.deep(cover.nomineeOnly.map((row) => row.name).sort(),
      ['HDFC Savings', 'ICICI Savings']);
  });

  test('the two are kept apart rather than summed', () => {
    // "The will covers this and the bank was never told" and "the bank was
    // told and the will is silent" need different actions.
    const cover = willCoverage(DATA);
    assert.ok(Array.isArray(cover.willOnly));
    assert.ok(Array.isArray(cover.nomineeOnly));
    assert.not('total' in cover);
  });
});

describe('more than one will', () => {
  const WILLS = {
    wills: [
      { id: 'w1', title: 'Will of 2015', testator: 'p1', executedOn: '2015-04-02' },
      { id: 'w2', title: 'Will of 2026', testator: 'p1', executedOn: '2026-01-11' },
      { id: 'w3', title: 'Undated draft', testator: 'p1' },
      { id: 'w4', title: 'Ravi will', testator: 'p2', executedOn: '2020-01-01' },
      { id: 'w5', title: 'Revoked', testator: 'p1', executedOn: '2010-01-01', revokedOn: '2015-04-02' },
    ],
  };

  test('two in force for one person is reported, newest first', () => {
    // The ordinary case: a 2015 will in the bank locker, a new one in 2026,
    // and nobody marked the first revoked.
    const found = willsInConflict(WILLS);
    assert.length(found, 1);
    assert.equal(found[0].testator, 'p1');
    assert.deep(found[0].wills.map((w) => w.title),
      ['Will of 2026', 'Will of 2015', 'Undated draft']);
  });

  test('an undated will goes last and is counted', () => {
    // "Which is later" cannot be answered for it at all.
    const found = willsInConflict(WILLS);
    assert.equal(found[0].undated, 1);
    assert.equal(found[0].wills[2].executedOn, null);
  });

  test('a revoked one is not one of them', () => {
    assert.not(willsInConflict(WILLS)[0].wills.some((w) => w.title === 'Revoked'));
  });

  test('one will each is not a conflict', () => {
    assert.length(willsInConflict({ wills: [WILLS.wills[3]] }), 0);
  });

  test('and it does not say which governs', () => {
    // A later will usually supersedes an earlier one, with enough exceptions
    // that deciding here would be this file practising law.
    const [found] = willsInConflict(WILLS);
    assert.not('governs' in found);
    for (const one of found.wills) assert.not('governs' in one);
  });
});

describe('a document that has been replaced', () => {
  test('a superseded power of attorney is not offered as current', () => {
    const docs = currentLegalDocuments({
      legalDocuments: [
        { id: 'l1', title: 'PoA 2019', supersededOn: '2023-06-01' },
        { id: 'l2', title: 'PoA 2023' },
      ],
    });
    assert.deep(docs.map((d) => d.title), ['PoA 2023']);
  });

  test('a deleted one is gone too', () => {
    const docs = currentLegalDocuments({
      legalDocuments: [{ id: 'l1', title: 'Gone', deletedAt: '2026-01-01' }],
    });
    assert.length(docs, 0);
  });
});

describe('what the application refuses to be', () => {
  test('it says a note is not the will, in words a household reads', () => {
    assert.includes(A_NOTE_IS_NOT_THE_WILL, 'The will itself decides');
    assert.includes(A_NOTE_IS_NOT_THE_WILL, 'notes');
  });

  test('and keeps that separate from the nominee refusal', () => {
    // Two different claims. One says a nomination does not decide who
    // inherits; the other says the application does not know what the will
    // says either.
    assert.notEqual(A_NOTE_IS_NOT_THE_WILL, NOMINEE_IS_NOT_HEIR);
  });
});
