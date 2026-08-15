/**
 * The architecture document, checked against the code it describes.
 *
 * Written after an audit found **thirteen rows** of
 * `docs/FAMILY_OS_MASTER_ARCHITECTURE.md` still saying `missing` about things
 * built phases earlier. The document is not the problem — going stale silently
 * is — so every row now carries a probe and these pin the probing.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { probesIn, checkProbe, uiDatabaseCalls, budgetProblem } from '../tools/architecture.mjs';

setSuite('architecture');

describe('reading the claims out of the document', () => {
  test('an evidence cell in a table row is a claim', () => {
    const probes = probesIn([
      '| Component | State | Evidence |',
      '| --- | --- | --- |',
      '| Consent engine | **exists** | `file:js/data/consent.js` |',
    ].join('\n'));

    assert.length(probes, 1);
    assert.equal(probes[0].component, 'Consent engine');
    assert.equal(probes[0].state, 'exists');
    assert.equal(probes[0].kind, 'file');
    assert.equal(probes[0].target, 'js/data/consent.js');
  });

  test('prose mentioning a file is prose, not a claim', () => {
    // Without this the document could not describe itself: every sentence
    // naming a module would become a claim somebody has to maintain.
    assert.length(probesIn('See `file:js/data/consent.js` for the details.'), 0);
  });

  test('a row with no evidence cell is not a claim either', () => {
    assert.length(probesIn('| Something | **exists** | no probe here |'), 0);
  });

  test('a cell that looks like a probe and does not parse is reported, not skipped', () => {
    // The worst failure this tool can have: a row that reads like a claim,
    // parses as nothing, and therefore can never fail. `absent:grep:a|b` sat in
    // the document doing exactly that — a pipe splits the markdown cell.
    const [probe] = probesIn('| Forecasting | missing | `absent:grep:forecast|projection` |');
    assert.equal(probe.kind, 'malformed');
    assert.includes(checkProbe(probe), 'silently not a claim');
  });

  test('several terms are separated by commas, which markdown leaves alone', () => {
    const [probe] = probesIn('| Thing | missing | `absent:grep:alpha,beta` |');
    assert.equal(probe.kind, 'absent');
    assert.equal(probe.target, 'grep:alpha,beta');
  });

  test('a prose line containing pipes is still prose', () => {
    // Markdown prose can carry a pipe — in a code sample, or a table drawn
    // inside a fence. Without the leading-pipe guard the cell arithmetic below
    // would read the tail of such a line as a claim.
    assert.length(probesIn(
      'Run `a | b`, then see | Consent engine | exists | `file:js/data/consent.js` |',
    ), 0);
  });
});

describe('running a claim against the repository', () => {
  const read = (path) => {
    if (String(path).endsWith('present.js')) return 'export function here() {}\n';
    if (String(path).endsWith('mentions.js')) return 'const anomalyScore = 1;\n';
    return '';
  };

  test('a file that exists satisfies its claim', () => {
    assert.equal(checkProbe({ kind: 'file', target: 'js/data/consent.js', state: 'exists' }), null);
  });

  test('a file that does not exist fails it', () => {
    const problem = checkProbe({ kind: 'file', target: 'js/data/nothing.js', state: 'exists' });
    assert.ok(problem);
    assert.includes(problem, 'does not exist');
  });

  test('an export that is not exported fails, even though the file is there', () => {
    // A module can survive a rename with its contents gutted, and a path check
    // alone would still pass.
    const problem = checkProbe({
      kind: 'export', target: 'js/data/consent.js#noSuchExport', state: 'exists',
    });
    assert.ok(problem);
    assert.includes(problem, 'does not export');
  });

  test('a real export satisfies its claim', () => {
    assert.equal(checkProbe({
      kind: 'export', target: 'js/data/classification.js#LEVELS', state: 'exists',
    }), null);
  });

  /*
   * The direction that actually goes stale. A document drifts by understating
   * what has been built, because building is what people do — and nobody
   * re-reads a table to check whether it is still pessimistic.
   */
  test('a "missing" row fails once the thing it denies appears', () => {
    const problem = checkProbe(
      { kind: 'absent', target: 'grep:anomal', state: 'missing' },
      { sources: ['/x/mentions.js'], read },
    );
    assert.ok(problem, 'a row saying "missing" about code that exists is the stale case');
    assert.includes(problem, 'stale in the direction that matters');
  });

  test('and holds while it genuinely is absent', () => {
    assert.equal(checkProbe(
      { kind: 'absent', target: 'grep:anomal', state: 'missing' },
      { sources: ['/x/present.js'], read },
    ), null);
  });

  test('any one of several comma-separated terms is enough to fail the row', () => {
    assert.ok(checkProbe(
      { kind: 'absent', target: 'grep:nothing,anomal', state: 'missing' },
      { sources: ['/x/mentions.js'], read },
    ), 'the second term matches, so the row is stale');
    assert.equal(checkProbe(
      { kind: 'absent', target: 'grep:nothing,neither', state: 'missing' },
      { sources: ['/x/mentions.js'], read },
    ), null);
  });
});

describe('the one forbidden edge that is open', () => {
  test('screens reaching the repository directly are counted', () => {
    const { count, byFile } = uiDatabaseCalls();
    assert.ok(count > 0, 'the edge is open, and pretending otherwise helps nobody');
    assert.ok(Object.keys(byFile).length > 0);
  });

  test('every call site counts, including one inside a comment', () => {
    const { count, byFile } = uiDatabaseCalls({
      files: ['/x/one.js', '/x/two.js'],
      read: () => 'db.repo("a").list();\n// db.repo("b") is called below\ndb.repo("b").get();',
    });
    // A commented-out call is counted too. It is a call site somebody has to
    // migrate either way, and a parser that told the two apart would be a
    // parser to maintain for no gain.
    assert.equal(count, 6);
    assert.equal(Object.values(byFile).join(), '3,3');
  });

  test('the budget fails when the edge widens, and only then', () => {
    // The half of this tool that has to fail. A ratchet nothing exercises is a
    // ratchet that quietly stops turning.
    assert.equal(budgetProblem(71, 71), null);
    assert.equal(budgetProblem(70, 71), null, 'narrowing is the point');
    const problem = budgetProblem(72, 71);
    assert.ok(problem);
    assert.includes(problem, 'may only narrow');
  });

  test('a screen with no direct calls is not listed at all', () => {
    const { count, byFile } = uiDatabaseCalls({
      files: ['/x/clean.js'], read: () => 'import { thing } from "./service.js";',
    });
    assert.equal(count, 0);
    assert.equal(Object.keys(byFile).length, 0);
  });
});
