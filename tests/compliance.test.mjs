import { test, describe, assert, setSuite } from './harness.mjs';
import {
  REGIMES, STATUS, APPLIES, EVIDENCED, unevidenced, claimingVerified, summary, citingUnrunTests
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
    // `?? 0` because a status with no rows is absent from the tally, not
    // zero — and the day the last NOT_STARTED control was filled in, this
    // compared 0 against undefined and failed for the happiest reason it
    // could have.
    assert.equal(counts.gaps.length, counts.byStatus[STATUS.NOT_STARTED] ?? 0);
    assert.not(STATUS.VERIFIED in counts.byStatus);
  });

  test('no control is VERIFIED, whatever else has been filled in', () => {
    // The number that matters, and the one that must not drift upward
    // quietly. Every other status is a claim about this codebase; VERIFIED is
    // a claim that somebody qualified checked it against the obligation and
    // signed their name. Nobody has.
    //
    // This is asserted separately from the tally above because the tally
    // could be rewritten, and because zero NOT_STARTED controls is exactly
    // the moment somebody would read the list as "compliant".
    const verified = REGIMES.flatMap((r) => r.controls)
      .filter((c) => c.status === STATUS.VERIFIED);
    assert.length(verified, 0, JSON.stringify(verified.map((c) => c.id)));
  });

  test('and no regime claims the application is compliant', () => {
    // Never claim compliance automatically. A regime that applies is a regime
    // whose obligations were read by a programmer, not assessed by a lawyer,
    // and every one of them says so.
    for (const regime of REGIMES) {
      assert.not(/\bis compliant\b|\bfully complies\b|\bcertified\b/i.test(regime.why ?? ''),
        `${regime.id}: ${regime.why}`);
    }
  });

  test('EVIDENCED names the statuses that make a claim about code', () => {
    assert.deep(EVIDENCED, [STATUS.IMPLEMENTED, STATUS.TESTED, STATUS.VERIFIED]);
  });
});


describe('a cited suite is one that runs', () => {
  test('every TESTED control names a suite the runner would execute', async () => {
    // Existing is not running. `tests/run.mjs` executes `*.test.mjs` and
    // nothing else, so a suite renamed to `security.mjs` stays on disk, keeps
    // resolving, and quietly stops being evidence of anything.
    const { readdir } = await import('node:fs/promises');
    const here = new URL('.', import.meta.url).pathname;
    const runnable = new Set((await readdir(here))
      .filter((name) => name.endsWith('.test.mjs'))
      .map((name) => `tests/${name}`));

    const problems = citingUnrunTests(REGIMES, (path) => runnable.has(path));
    assert.length(problems, 0, problems.join(' | '));
  });

  test('and the check notices when one is not', () => {
    // The failure it exists for, produced on purpose. A check that cannot fail
    // is worse than no check.
    const problems = citingUnrunTests(REGIMES, () => false);
    assert.ok(problems.length > 30,
      `only ${problems.length} of the forty-one TESTED controls were flagged`);
    assert.ok(problems[0].includes('which the suite does not run'), problems[0]);
  });

  test('and says nothing about controls that do not claim to be tested', () => {
    const problems = citingUnrunTests(REGIMES, () => false);
    const tested = REGIMES.flatMap((r) => r.controls.filter((c) => c.status === STATUS.TESTED));
    assert.equal(problems.length, tested.filter((c) => c.evidence?.test).length);
  });
});
