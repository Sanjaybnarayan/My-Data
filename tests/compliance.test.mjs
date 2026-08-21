import { test, describe, assert, setSuite } from './harness.mjs';
import {
  REGIMES, STATUS, APPLIES, EVIDENCED, unevidenced, claimingVerified, summary,
} from '../js/domain/compliance.js';
import { check } from '../tools/compliance.mjs';

setSuite('compliance');

describe('the matrix', () => {
  test('every citation resolves, and every document exists', () => {
    // The check earned itself on its first run: three rows cited files that
    // had not been merged yet.
    const { problems } = check();
    assert.deep(problems, []);
  });

  test('nothing is VERIFIED', () => {
    // Verification means somebody qualified checked the control against the
    // obligation and put their name to it. Nobody has. The day a row says
    // VERIFIED it must be a deliberate act, not an edit nobody noticed.
    assert.deep(claimingVerified(), []);
  });

  test('a status that asserts something about the code must cite it', () => {
    assert.deep(unevidenced(), []);
  });

  test('and that check can actually fail', () => {
    // Asserting the real matrix is clean passes equally against a function
    // that returns nothing.
    const broken = [{
      id: 'MADE_UP',
      controls: [
        { id: 'bare', status: STATUS.IMPLEMENTED, evidence: {} },
        { id: 'untested', status: STATUS.TESTED, evidence: { file: 'js/data/schema.js' } },
      ],
    }];
    const found = unevidenced(broken);
    assert.length(found, 2);
    assert.includes(found.join(' '), 'cites nothing');
    assert.includes(found.join(' '), 'names no test suite');
  });

  test('a VERIFIED row would be caught', () => {
    const claimed = claimingVerified([
      { id: 'MADE_UP', controls: [{ id: 'bold', status: STATUS.VERIFIED }] },
    ]);
    assert.deep(claimed, ['MADE_UP/bold']);
  });
});

describe('what the regimes say', () => {
  test('every regime names a document and says whether it applies', () => {
    const applicabilities = new Set(Object.values(APPLIES));
    for (const regime of REGIMES) {
      assert.ok(regime.doc.endsWith('.md'), `${regime.id} names no document`);
      assert.ok(applicabilities.has(regime.applies), `${regime.id}: ${regime.applies}`);
      assert.ok(regime.why, `${regime.id} does not say why`);
      assert.ok(regime.controls.length, `${regime.id} has no controls`);
    }
  });

  test('a control that is not started says what is missing', () => {
    // "NOT_STARTED" with no gap is a row that tells a reader nothing.
    for (const regime of REGIMES) {
      for (const row of regime.controls) {
        if (row.status !== STATUS.NOT_STARTED) continue;
        assert.ok(row.gap, `${regime.id}/${row.id} is NOT_STARTED and says nothing`);
      }
    }
  });

  test('so does a NOT_APPLICABLE one, or its regime does', () => {
    // Dismissing a rule without a reason is the shape of an unexamined claim.
    for (const regime of REGIMES) {
      for (const row of regime.controls) {
        if (row.status !== STATUS.NOT_APPLICABLE) continue;
        assert.ok(row.gap || regime.applies === APPLIES.NOT_TO_THIS,
          `${regime.id}/${row.id} is NOT_APPLICABLE with no reason anywhere`);
      }
    }
  });

  test('no regime id appears twice', () => {
    const ids = REGIMES.map((r) => r.id);
    assert.equal(ids.length, new Set(ids).size);
  });

  test('the two regimes that apply directly to other people are named', () => {
    // Staff and Aadhaar are where the household exemption stops doing the
    // work. If either ever stops being `DIRECTLY`, somebody has decided
    // something large.
    const direct = REGIMES.filter((r) => r.applies === APPLIES.DIRECTLY).map((r) => r.id);
    assert.includes(direct, 'STAFF');
    assert.includes(direct, 'UIDAI');
  });

  test('the summary counts what is there', () => {
    const counts = summary();
    assert.equal(counts.regimes, REGIMES.length);
    assert.equal(counts.controls, REGIMES.reduce((n, r) => n + r.controls.length, 0));
    assert.equal(counts.gaps.length, counts.byStatus[STATUS.NOT_STARTED]);
    assert.not(STATUS.VERIFIED in counts.byStatus);
  });

  test('EVIDENCED names the statuses that make a claim about code', () => {
    assert.deep(EVIDENCED, [STATUS.IMPLEMENTED, STATUS.TESTED, STATUS.VERIFIED]);
  });
});
