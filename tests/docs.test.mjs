/**
 * Documents that tell somebody what to do, checked against what is there.
 *
 * `docs/SETUP.md` is the one file in this repository whose readers are not
 * developers: a household follows it once, by hand, and cannot tell a
 * complete instruction from an incomplete one. It said "copy in the five
 * files from `apps-script/`" and then named four of the six scripts. The two
 * it left out were `Policy.gs` — which `Sheets.gs` calls with no guard, so a
 * deployment without it throws on every push and pull — and `Otp.gs`.
 *
 * A hand-maintained list beside a derivable one. This derives it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

setSuite('docs');

describe('the setup instructions name every file they tell somebody to copy', () => {
  const scripts = readdirSync(join(ROOT, 'apps-script'))
    .filter((f) => f.endsWith('.gs'))
    .sort();
  const setup = readFileSync(join(ROOT, 'docs/SETUP.md'), 'utf8');

  /*
   * The bullet listing the scripts, and nothing else.
   *
   * Checking the whole document was a check that could not fail: the prose
   * beneath the list explains why `Policy.gs` matters, so deleting it *from
   * the list* left it named on the page and the test stayed green. Only the
   * line somebody copies from counts.
   */
  const listLine = setup.split('\n').find((l) => /^\s*-\s+`\w+\.gs`/.test(l)) ?? '';

  test('every script in apps-script/ is named on the line somebody copies from', () => {
    assert.ok(scripts.length > 0, 'the directory is empty, which cannot be right');
    assert.ok(listLine, 'docs/SETUP.md no longer has a bullet listing the scripts');
    for (const file of scripts) {
      assert.includes(listLine, `\`${file}\``, `${file} is not on the list in docs/SETUP.md`);
    }
  });

  test('and the list names nothing that is not there', () => {
    // The other direction: a file removed from `apps-script/` but left in the
    // instructions sends somebody looking for a file that does not exist.
    for (const named of listLine.match(/`(\w+\.gs)`/g) ?? []) {
      const file = named.replace(/`/g, '');
      assert.includes(scripts, file, `docs/SETUP.md names ${file}, which is not in apps-script/`);
    }
  });

  test('and the manifest, which is a separate step in the editor', () => {
    assert.includes(setup, '`appsscript.json`');
  });

  test('the count it states matches the count there is', () => {
    // The original said "five files" beside a list of four scripts plus the
    // manifest. Both halves have to move together or the sentence misleads
    // exactly the reader who is counting along.
    const written = /all (two|three|four|five|six|seven|eight|nine|ten) scripts/.exec(setup);
    assert.ok(written, 'docs/SETUP.md no longer states how many scripts there are');
    const words = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    assert.equal(words[words.indexOf(written[1])], words[scripts.length - 2],
      `docs/SETUP.md says ${written[1]} scripts, apps-script/ has ${scripts.length}`);
  });
});

describe('and they say how to update a deployment, not only how to make one', () => {
  const setup = readFileSync(join(ROOT, 'docs/SETUP.md'), 'utf8');

  test('the update path is Manage deployments, not New deployment', () => {
    /*
     * "New deployment" mints a second web app on a different `/exec` URL and
     * leaves the old one serving the old code, so the change appears not to
     * take effect and nothing reports an error. Every `.gs` fix in this
     * repository depends on somebody doing this correctly.
     */
    assert.includes(setup, 'Manage deployments');
    assert.includes(setup, 'New version');
    assert.includes(setup, 'Do not use "New deployment" for an update');
  });
});


/* --------------------------------------------------- the phase scorecards */

describe('the phase scorecard says what the rows say', () => {
  /*
   * Every number in this file was hand-maintained beside a derivable one, and
   * five of them had drifted: the header said six phases had changed when
   * eighteen had, the prose said Phase 14 scored 0 and Phase 8 scored 42 when
   * the rows said 76 and 58, Phase 1 was quoted at 55 when the row said 66,
   * and "three phases are held below" was followed by four bullets.
   *
   * In a document whose own summary already reads: "This paragraph went on
   * asserting an open critical defect after the row above it recorded the fix
   * — the exact fault this table exists to catch, inside the table's own
   * summary."
   */
  const status = readFileSync(join(ROOT, 'docs/PHASE_STATUS.md'), 'utf8');
  const rowRe = /^\| ([0-9.]+) ?([↑↓]?) \| ([^|]+) \| \*\*(\w+)\*\* \| *(\d+) *\|/gm;
  const rows = [...status.matchAll(rowRe)]
    .map(([, num, arrow, name, state, pct]) =>
      ({ num, arrow, name: name.trim(), state, pct: Number(pct) }));

  /*
   * Serial order, no duplicates, and the distribution block are **not** here.
   * `tests/architecture.test.mjs` has held all three since before this file
   * existed — a first draft of these tests re-checked them, which is the two
   * lists that must agree, written into the tests meant to catch it.
   */

  test('the arrow count in the header is the arrow count in the table', () => {
    const up = rows.filter((r) => r.arrow === '↑').length;
    const down = rows.filter((r) => r.arrow === '↓').length;
    const words = { 6: 'Six', 17: 'Seventeen', 18: 'Eighteen', 19: 'Nineteen', 20: 'Twenty' };
    assert.ok(words[up], `no word for ${up} — add it rather than loosening this`);
    assert.includes(status, `${words[up]} phases have changed`);
    assert.equal(down, 1, 'the header says one phase is marked ↓');
  });

  test('a line count quoted for a file is that file\'s line count', () => {
    // `categorise.js (927)` against a file of 972 — a digit transposition,
    // sitting in the scorecard unchecked.
    const quoted = [...status.matchAll(/`([a-zA-Z0-9_/.-]+\.js)` \((\d+)(?: lines)?\)/g)];
    assert.ok(quoted.length >= 2, 'the line-count claims are no longer written that way');
    for (const [, file, count] of quoted) {
      const full = ['js/domain', 'js/data', 'js/core', 'js/services', 'js/security']
        .map((dir) => join(ROOT, dir, file))
        .find((candidate) => { try { readFileSync(candidate); return true; } catch { return false; } });
      assert.ok(full, `${file} is quoted with a line count and cannot be found`);
      const actual = readFileSync(full, 'utf8').split('\n').length - 1;
      assert.equal(Number(count), actual, `${file}: the scorecard says ${count}, the file is ${actual}`);
    }
  });

  test('the UI phases are serial and complete in their own file', () => {
    const ui = readFileSync(join(ROOT, 'docs/UI_PHASE_STATUS.md'), 'utf8');
    for (let i = 0; i <= 17; i += 1) {
      assert.includes(ui, `UI-${i}`, `UI-${i} is missing from docs/UI_PHASE_STATUS.md`);
    }
    // The build scorecard points at it rather than repeating it: one table
    // per fact, so the two cannot disagree.
    assert.includes(status, 'docs/UI_PHASE_STATUS.md');
    assert.not(/\| UI-\d/.test(status), 'the UI table has been copied into the build scorecard');
  });
});

describe('the security audit covers every phase its brief has', () => {
  /*
   * The failure this catches is a table that ends early.
   *
   * §9 of `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` follows a thirteen-phase
   * brief and listed ten. Three rows absent reads exactly like three rows
   * passing — the reader has no way to tell "we did not get there" from "there
   * was nothing to say", and the missing three were the weakest of the set.
   *
   * The count is a constant here because the brief is not in the repository;
   * it is the one number in this file taken from outside it, so it is stated
   * once, next to the reason, rather than assumed by whoever next extends the
   * table.
   */
  const PHASES = 13;
  const audit = readFileSync(join(ROOT, 'docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md'), 'utf8');

  /** The rows of the §9 table that carry a phase number, in the order given. */
  const numbered = audit
    .slice(audit.indexOf('## 9.'))
    .split('\n')
    .map((line) => /^\|\s*(\d+)\s*\|/.exec(line))
    .filter(Boolean)
    .map((match) => Number(match[1]));

  test('every phase of the brief has a row', () => {
    const missing = [];
    for (let n = 1; n <= PHASES; n += 1) if (!numbered.includes(n)) missing.push(n);
    assert.deep(missing, [], `phases with no row: ${missing.join(', ')}`);
  });

  test('and they are in order, with none repeated', () => {
    assert.deep(numbered, [...numbered].sort((a, b) => a - b));
    assert.equal(new Set(numbered).size, numbered.length);
  });

  test('every finding in the body is accounted for in the table', () => {
    /*
     * The other half of the same fault. SEARCH-01 was written up in §5 and
     * never added to §9, so the ordered view of the work did not contain a
     * finding the document itself called HIGH.
     */
    const findings = new Set(
      [...audit.matchAll(/^### ([A-Z]+-\d+)\b/gm)].map((m) => m[1]),
    );
    /*
     * The rows, not the section. Searching the whole of §9 was a check that
     * could not fail: the prose under the table names the findings too, so
     * deleting one *from the table* left it on the page and the test stayed
     * green — the same shape as the SETUP.md list two blocks up, caught the
     * same way, by mutating it.
     */
    const rows = audit
      .slice(audit.indexOf('## 9.'), audit.indexOf('## 10.'))
      .split('\n')
      .filter((line) => line.trimStart().startsWith('|'))
      .join('\n');
    const absent = [...findings].filter((id) => !rows.includes(id));

    assert.ok(findings.size > 0, 'no findings parsed, so this proves nothing');
    assert.deep(absent, [], `findings with no row in §9: ${absent.join(', ')}`);
  });
});
