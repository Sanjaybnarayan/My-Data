/**
 * The architecture document, checked against the code it describes.
 *
 * Written after an audit found **thirteen rows** of
 * `docs/FAMILY_OS_MASTER_ARCHITECTURE.md` still saying `missing` about things
 * built phases earlier. The document is not the problem — going stale silently
 * is — so every row now carries a probe and these pin the probing.
 */

import { test, describe, assert, setSuite } from './harness.mjs';
import { readFileSync } from 'node:fs';
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

  test('a wired probe fails when the screen does not call the thing', () => {
    // The claim `file:` and `export:` cannot make. "The engine exists and no
    // screen calls it" is the finding this codebase makes most often, and a
    // row asserting only the engine stays green through it.
    const drawn = checkProbe(
      { kind: 'wired', target: 'js/modules/finance.js#ExplainService', state: 'exists' },
      { read: () => 'import { ExplainService } from "../services/explain.js";' },
    );
    assert.equal(drawn, null);

    const headless = checkProbe(
      { kind: 'wired', target: 'js/modules/finance.js#ExplainService', state: 'exists' },
      { read: () => 'import { FinanceService } from "../services/finance.js";' },
    );
    assert.ok(headless);
    assert.includes(headless, 'the wiring this row claims is not there');
  });

  test('and a wired probe pointing at nothing says so', () => {
    assert.includes(
      checkProbe({ kind: 'wired', target: 'js/modules/gone.js#Thing', state: 'exists' }),
      'does not exist',
    );
  });

  test('a name that only appears as part of a longer one does not count', () => {
    // `\b` on both sides: `ExplainServiceOld` is not `ExplainService`, and a
    // probe that matched loosely would go green on a rename it should catch.
    const problem = checkProbe(
      { kind: 'wired', target: 'js/modules/finance.js#ExplainService', state: 'exists' },
      { read: () => 'import { ExplainServiceOld } from "./old.js";' },
    );
    assert.ok(problem, 'a substring passed as a match');
  });

  test('a term carrying regex punctuation is matched literally', () => {
    // `options.extra` has a dot in it, and an unescaped dot matches anything.
    // A probe that goes green on `optionsXextra` is a probe with a hole in it.
    assert.ok(checkProbe(
      { kind: 'wired', target: 'js/modules/crud.js#options.extra', state: 'exists' },
      { read: () => 'optionsXextra' },
    ));
  });

  test('a screen with no direct calls is not listed at all', () => {
    const { count, byFile } = uiDatabaseCalls({
      files: ['/x/clean.js'], read: () => 'import { thing } from "./service.js";',
    });
    assert.equal(count, 0);
    assert.equal(Object.keys(byFile).length, 0);
  });
});

/* ------------------------------------------------ the scorecard's own totals */

describe('the phase scorecard counts itself', () => {
  // The recurring fault in this repository, found for the seventh time: a
  // hand-maintained list beside a derivable one. `docs/PHASE_STATUS.md` has a
  // table of 27 phases and, below it, a distribution block someone types by
  // hand. The first time this was refreshed the block said 10 where the table
  // said 9, and nothing could have noticed.

  const doc = readFileSync(new URL('../docs/PHASE_STATUS.md', import.meta.url), 'utf8');

  /** Status of every phase, read out of the table rather than the summary. */
  const fromTable = () => {
    const counts = new Map();
    for (const line of doc.split('\n')) {
      // A phase row: `| 15 ↑ | Name | **STATUS** | 70 | …`
      const row = /^\|\s*([\d.]+)\s*↑?\s*\|[^|]*\|\s*\*\*([A-Z_]+)\*\*\s*\|/.exec(line);
      if (!row) continue;
      counts.set(row[2], (counts.get(row[2]) ?? 0) + 1);
    }
    return counts;
  };

  /** What the distribution block claims. */
  const fromSummary = () => {
    const block = /```\n([\s\S]*?)```/.exec(doc.split('## Distribution')[1] ?? '');
    const counts = new Map();
    for (const line of (block?.[1] ?? '').split('\n')) {
      const row = /^([A-Z_]+)\s+(\d+)/.exec(line.trim());
      if (row) counts.set(row[1], Number(row[2]));
    }
    return counts;
  };

  test('the table has every phase exactly once', () => {
    const seen = [...doc.matchAll(/^\|\s*([\d.]+)\s*↑?\s*\|/gm)].map((m) => m[1]);
    const expected = ['0', '0.5', ...Array.from({ length: 25 }, (_, i) => String(i + 1))];
    assert.equal(seen.join(','), expected.join(','));
  });

  test('and the distribution block agrees with it, status by status', () => {
    const table = fromTable();
    const summary = fromSummary();

    const statuses = new Set([...table.keys(), ...summary.keys()]);
    for (const status of statuses) {
      assert.equal(summary.get(status) ?? 0, table.get(status) ?? 0,
        `${status}: the summary says ${summary.get(status) ?? 0}, the table has ${table.get(status) ?? 0}`);
    }
  });

  test('and they add up to the number of phases there are', () => {
    const total = [...fromTable().values()].reduce((a, b) => a + b, 0);
    assert.equal(total, 27, 'phases 0 and 0.5 through 25');
  });
});
