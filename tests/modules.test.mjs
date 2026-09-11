import { test, describe, assert, setSuite } from './harness.mjs';
import { standing } from '../js/modules/family.js';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

setSuite('modules');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every module parses, and every import in it points at a file that exists.
 *
 * Both of these had exactly one thing standing between them and production: a
 * Chromium run that takes ninety seconds and needs a browser installed. A
 * screen module declaring `function body()` beside `const body = h('div')`
 * is a syntax error that no unit test touched, because no unit test imports a
 * file that reaches for the DOM — and the bundler reads these files as text,
 * so it did not notice either.
 *
 * This costs milliseconds and covers the whole tree, view layer included.
 */

async function walk(directory) {
  const found = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) found.push(...await walk(path));
    else if (item.name.endsWith('.js')) found.push(path);
  }
  return found;
}

const files = await walk(join(ROOT, 'js'));

describe('every module', () => {
  test('there are modules to check at all', () => {
    // A walk that silently found nothing would make every check below pass.
    assert.ok(files.length > 40, `found ${files.length}`);
  });

  test('parses as JavaScript', () => {
    // One child process for the whole tree, not one per file. `node --check`
    // takes a single path, and eighty spawns turned a half-second suite into
    // a six-second one — which is how a fast check stops being run.
    //
    // `SourceTextModule` compiles without evaluating, so a module that
    // reaches for `document` at import time is still parsed rather than run.
    const script = `
      const vm = require('node:vm');
      const { readFileSync } = require('node:fs');
      const broken = [];
      for (const file of process.argv.slice(1)) {
        try { new vm.SourceTextModule(readFileSync(file, 'utf8'), { identifier: file }); }
        catch (err) { broken.push(file + ': ' + err.message); }
      }
      process.stdout.write(JSON.stringify(broken));
    `;

    const out = execFileSync(
      process.execPath,
      ['--experimental-vm-modules', '--no-warnings', '-e', script, '--', ...files],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );

    const broken = JSON.parse(out).map((line) => line.replace(`${ROOT}/`, ''));
    assert.length(broken, 0, broken.join(' | '));
  });

  test('imports only files that exist', async () => {
    // A renamed file leaves a dangling import that a browser reports as a
    // blank screen and a 404 in the console, which is the worst way to find
    // out about it.
    const missing = [];

    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const specifiers = [...source.matchAll(/(?:^|[^\w.])(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g),
        ...source.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)]
        .map((match) => match[1]);

      for (const specifier of specifiers) {
        const target = join(dirname(file), specifier);
        try {
          await readFile(target, 'utf8');
        } catch {
          missing.push(`${relative(ROOT, file)} → ${specifier}`);
        }
      }
    }

    assert.length(missing, 0, missing.join(' | '));
  });

  test('does not add a field that nothing reads', async () => {
    // Four times a field has been collected on a form and read by nothing —
    // `transaction.category`, `person.relationship`, `transaction.person`,
    // `importantDate.remindDaysBefore` — and each was found by tripping over
    // it. The inventory holds the current set still, so a *new* one has to be
    // a deliberate act.
    //
    // Most entries are reference data and perfectly fine. This is not a list
    // of bugs; it is a list of everything that could quietly become one.
    const { unreadFields } = await import('../tools/field-coverage.mjs');
    const { fields: known } = JSON.parse(
      await readFile(join(ROOT, 'tools', 'field-coverage.json'), 'utf8'),
    );
    const current = unreadFields();

    assert.ok(current.length > 20, `only ${current.length} — the scan found nothing`);

    const added = current.filter((f) => !known.includes(f));
    assert.length(added, 0,
      `${added.join(', ')} — wire it up, or run node tools/field-coverage.mjs --update`);

    // The other direction, so the list cannot rot: a field that has since been
    // wired up must come off it, or the inventory stops meaning anything.
    const wired = known.filter((f) => !current.includes(f));
    assert.length(wired, 0,
      `${wired.join(', ')} are read now — run node tools/field-coverage.mjs --update`);
  });

  test('does not describe itself in numbers that have gone stale', async () => {
    // The documents said 34 entities and 426 fields when the schema declared
    // 39 and 478, said 28 fields were encrypted when 34 were, and said a test
    // walked every store when it walked four of seven. None of it was caught
    // by anything, because prose is not executed.
    //
    // Numbers that describe the program as it is now carry a `<!--live:key-->`
    // marker; this reads the schema and checks them. Counts written down as
    // history — a dated audit's "28 of 426 fields" — are unmarked and stay as
    // written, because rewriting them would falsify the record.
    const { check } = await import('../tools/self-description.mjs');
    const { sites, problems } = await check();

    assert.length(problems, 0, problems.join('; '));
    assert.ok(sites > 10, `only ${sites} live numbers — the check has little to check`);
  });

  test('and every file a comment names is a file that is there', async () => {
    /*
     * The other half, and the half that tool's own header says it cannot do:
     * *"it cannot find a new stale claim that nobody marked."*
     *
     * A claim's **reference** needs no marking to be checkable. TOK-01 was a
     * line reading "Encrypted; see `data/schema.js` meta rules" when there
     * were no such rules — the most expensive instance this repository had,
     * because anybody auditing that file read the claim and moved on. The
     * same shape turned up in `js/security/crypto.js`, which explains that
     * PBKDF2 iterations are only half the defence against somebody holding
     * the device and pointed at a file for the other half that has never
     * existed in this repository. The limiter is real; the pointer was not.
     */
    const { references, DELIBERATELY_ABSENT } = await import('../tools/self-description.mjs');
    const { checked, problems } = references();

    assert.length(problems, 0, problems.join('; '));
    assert.ok(checked > 1500, `only ${checked} references — the check has little to check`);
    assert.ok(Object.keys(DELIBERATELY_ABSENT).length > 0,
      'the allowlist is empty, so its own rot checks can never fire');
  });

  test('a document citing a source file that is not there is reported too', async () => {
    /*
     * Where this actually bit. Three documents — including a dated audit whose
     * method line reads "every status below is supported by a file path" —
     * cited a js/sync/calsync.js as the evidence that Calendar is REAL. No such
     * file has ever been in this repository; the implementation is
     * `js/sync/calendar.js`, so the verdict was right and the evidence was not.
     *
     * Scoped to source citations: a document naming a document nobody has
     * written yet is the audit's own business, and a build output is absent
     * because it has not been built.
     */
    const { references } = await import('../tools/self-description.mjs');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const root = mkdtempSync(join(tmpdir(), 'docrefs-'));
    try {
      mkdirSync(join(root, 'docs'));
      mkdirSync(join(root, 'js'));
      writeFileSync(join(root, 'js', 'real.js'), '// here\n');
      writeFileSync(join(root, 'docs', 'CLAIMS.md'),
        '| Calendar | **REAL** | `js/sync/gone.js` |\n'
        + '| Other | **REAL** | `js/real.js` |\n'
        + 'And `BACKUP.md`, which nobody has written, is not this check\'s business.\n');

      const { problems } = references(root, {});
      assert.length(problems, 1, problems.join('; '));
      assert.ok(problems[0].includes('js/sync/gone.js'), problems[0]);
      assert.ok(problems[0].includes('docs/CLAIMS.md:1'), problems[0]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a comment naming a file that is not there is reported', async () => {
    /*
     * Driven against a tree built for the purpose, because the real one is
     * clean — so deleting the line that reports a bad reference changed
     * nothing, and the mutation ratchet correctly refused to call it held.
     * A check that cannot fail on the code as it stands has to be shown
     * failing on code that should fail it.
     */
    const { references } = await import('../tools/self-description.mjs');
    const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');

    const root = mkdtempSync(join(tmpdir(), 'refs-'));
    try {
      mkdirSync(join(root, 'js'));
      writeFileSync(join(root, 'js', 'real.js'), '// nothing to see\n');
      writeFileSync(join(root, 'js', 'claims.js'),
        '/**\n * The key is sealed — see `never-written.js` for the rules.\n'
        + ' * And `real.js` is right here, which must not be reported.\n */\n');

      // No allowlist: this tree is not the repository, so its deliberate
      // absences do not apply and would otherwise all report as orphaned.
      const { checked, problems } = references(root, {});
      assert.equal(checked, 2, 'both references should have been examined');
      assert.length(problems, 1, problems.join('; '));
      assert.ok(problems[0].includes('never-written.js'), problems[0]);
      assert.ok(problems[0].includes('js/claims.js:2'), problems[0]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('and the list of deliberate absences cannot quietly rot', async () => {
    /*
     * An allowlist nobody maintains becomes a list of things nobody checks —
     * the fault this whole area exists to catch, one level up. Both ways it
     * can go wrong are driven here rather than asserted about, because the
     * mutation ratchet showed the real-tree version could not fail: disabling
     * the "it exists now" branch broke nothing, since in this repository none
     * of them exists.
     */
    const { rot } = await import('../tools/self-description.mjs');
    const absent = { 'ghost.js': 'named to explain something that is not there' };

    assert.length(rot([], new Set(['ghost.js']), absent), 0, 'a live entry was called rot');

    const appeared = rot(['js/core/ghost.js'], new Set(['ghost.js']), absent);
    assert.length(appeared, 1);
    assert.ok(appeared[0].includes('is in the tree now'), appeared[0]);

    const orphaned = rot([], new Set(), absent);
    assert.length(orphaned, 1);
    assert.ok(orphaned[0].includes('nothing names'), orphaned[0]);
  });

  test('is precached by the service worker', async () => {
    // The deploy workflow already checks one direction — that nothing
    // precached was left unpublished. Nothing checked the other, and the
    // difference matters: a module missing from `SHELL` is fetched from the
    // network, so the app works everywhere except offline, on whichever
    // screen imports it. Nobody finds that on a laptop with wifi.
    //
    // Written after adding a module and nearly forgetting the list. It found
    // `domain/privacy.js` already absent, which meant Settings had been
    // broken offline since it was added.
    const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
    const listed = new Set([...sw.matchAll(/'\.\/(js\/[^']+)'/g)].map((m) => m[1]));

    assert.ok(listed.size > 40, `only ${listed.size} modules precached`);

    const absent = files
      .map((file) => relative(ROOT, file))
      .filter((path) => !listed.has(path));

    assert.length(absent, 0, absent.join(' | '));
  });
});

describe('what ships to a browser', () => {
  test('contains nothing that can leak a record or execute a string', async () => {
    // Not a linter — `tools/lint.mjs` explains why there deliberately is none,
    // with the counts that decided it. Six patterns a type checker cannot see,
    // every one at zero, and the value is entirely in the direction this fails:
    // a `console.log` pasted into a screen that renders a PAN prints a
    // household's identity number into a console anybody can open.
    const { lint } = await import('../tools/lint.mjs');
    const findings = lint();

    assert.length(findings, 0,
      findings.map((f) => `${f.file}:${f.line} [${f.rule.id}] ${f.text}`).join(' | '));
  });

  test('and the rules still fire on the things they name', async () => {
    // A ratchet reporting zero forever is indistinguishable from a regex that
    // stopped matching. Each rule is shown a line it must catch.
    const { findingsIn } = await import('../tools/lint.mjs');
    const fires = (code, rule) => assert.ok(
      findingsIn(code).some((f) => f.rule === rule), `${rule} missed: ${code}`);

    fires('const a = () => { console.log("pan", x); };', 'no-console-log');
    fires('const b = () => { debugger; };', 'no-debugger');
    fires('const c = (s) => eval(s);', 'no-eval');
    fires('const c2 = (s) => new Function(s);', 'no-eval');
    fires('const d = (el, t) => { el.innerHTML = t; };', 'no-innerhtml');
    fires('const d2 = (el, t) => el.insertAdjacentHTML("beforeend", t);', 'no-innerhtml');
    fires('const e = () => window.prompt("pin");', 'no-browser-dialogs');
    fires('const e2 = () => alert("hi");', 'no-browser-dialogs');
    fires('const f1 = (def) => def.labels.one;', 'labels-through-the-door');
    fires('const f2 = (def) => def.labels.many;', 'labels-through-the-door');
    fires('const f3 = (d) => d?.labels?.one ?? d.name;', 'labels-through-the-door');
    fires("const f4 = (d, n) => d.labels[n ? 'many' : 'one'];", 'labels-through-the-door');
    fires('const f5 = (field) => field.label;', 'labels-through-the-door');
    fires('const f6 = (f) => f.fields.label;', 'labels-through-the-door');
    fires('const f7 = (ref) => ref.field?.label ?? ref.key;', 'labels-through-the-door');
    fires('const g1 = (db) => db.adapter.query("audit", {});', 'screens-read-through-the-repository');
    fires('const g2 = (db) => recentActivity(db?.adapter, { limit: 12 });', 'screens-read-through-the-repository');
  });

  test('and a scoped rule is applied where its name says and nowhere else', async () => {
    // `screens-read-through-the-repository` is about screens and the services
    // behind them. `js/sync/engine.js` reaches the adapter eleven times doing
    // exactly its job, and a scope is how that is said — listing it as an
    // allowance would be claiming it does something it should not, and would
    // be re-read by whoever prunes that list next.
    const { matches, rules } = await import('../tools/lint.mjs');
    const rule = rules().find((one) => one.id === 'screens-read-through-the-repository');

    assert.ok(rule.only?.length, 'the rule lost the scope its name promises');

    const hit = matches().filter((one) => one.rule === rule);
    assert.ok(hit.length, 'a scope that matches nothing is a rule that cannot fire');
    assert.ok(hit.every((one) => rule.only.some((prefix) => one.file.startsWith(prefix))),
      hit.map((one) => one.file).join(' | '));

    // The layer the scope exists to leave alone. If this ever comes back
    // empty the rule can be widened; while it does not, widening it would
    // report eleven lines that are not findings.
    const sync = matches().some((one) => one.file.startsWith('js/sync/'));
    assert.not(sync, 'the sync engine is inside a scope that was meant to exclude it');
  });

  test('and stay quiet on the things they must not flag', async () => {
    // The half that matters more. On its first run `no-browser-dialogs`
    // reported four of this application's own `prompt` and `confirm` calls —
    // and a rule whose every finding is wrong is worse than no rule, because
    // people learn to skip the output.
    const { findingsIn } = await import('../tools/lint.mjs');
    const quiet = (code) => assert.length(findingsIn(code), 0, `false positive: ${code}`);

    quiet('const f = (err) => console.error("boot failed", err);');
    quiet('const g = async () => { const v = await prompt({ title: "x" }); return v; };');
    quiet('const h = async () => { const v = await confirm({ title: "x" }); return v; };');
    // This file's own prose, and `domain/paymentapp.js`'s, contain every
    // pattern here. A rule that fires on its own explanation is unusable.
    quiet('// never use eval( or innerHTML = here');
    quiet('/*\n * console.log is banned, see below\n */');
    // The door itself, and the local variable that is not a schema label.
    quiet("const i = (def) => entityLabel(def, 'many');");
    quiet('const j = (row) => row.label;');
    quiet("const j2 = (name, field) => fieldLabel(name, field);");
    quiet('const k = (def) => ({ labels: def.labels });');
  });

  test('and an allowance excuses only the file it names', async () => {
    // Every allowance currently matches, so there is no unexcused finding
    // anywhere in `js/` — which means a filter that excused every file would
    // behave identically against the real tree. The mutation ratchet reported
    // that before this test existed. Synthetic findings, so the filter can be
    // shown a case the tree does not contain.
    const { unallowed, rules } = await import('../tools/lint.mjs');
    const rule = rules().find((one) => one.id === 'labels-through-the-door');
    const at = (file) => ({ rule, file, line: 1, text: 'def.labels.one' });

    assert.length(unallowed([at('js/core/labels.js')]), 0);
    assert.length(unallowed([at('js/modules/somewhere-new.js')]), 1);
  });

  test('and an allowance that stopped being needed is a finding of its own', async () => {
    // Three files read a schema label deliberately and say why. A list nobody
    // prunes is how an exception outlives its reason, so the allowance is
    // checked in both directions: today every listed file still matches, and
    // shown a run in which none of them did, each one is reported.
    const { matches, staleAllowances } = await import('../tools/lint.mjs');

    assert.length(staleAllowances(matches()), 0,
      staleAllowances(matches()).map((s) => `${s.file} [${s.rule.id}]`).join(' | '));

    const orphaned = staleAllowances([]);
    assert.ok(orphaned.length >= 3, `expected every allowance reported, got ${orphaned.length}`);
    assert.ok(orphaned.some((s) => s.file === 'js/core/labels.js'));
    assert.ok(orphaned.every((s) => s.rule && s.rule.id));
  });
});

/**
 * Who works here now, and who used to.
 *
 * `staff.endedOn` is what makes a record history rather than a deletion, and
 * a list that ignores it shows a cook who left in 2019 beside the one who
 * starts tomorrow.
 */
describe('household staff standing', () => {
  const TODAY = '2026-08-16';

  test('nobody with a leaving date is working here now', () => {
    assert.deep(standing([{}, {}], TODAY), { current: 2, former: 0, onNotice: false });
  });

  test('somebody who left is counted apart', () => {
    const out = standing([{}, { endedOn: '2019-01-01' }], TODAY);
    assert.equal(out.current, 1);
    assert.equal(out.former, 1);
  });

  test('a leaving date in the future is somebody still working here', () => {
    // The rule worth stating. Counting them as former drops a person off the
    // list while they are still turning up.
    const out = standing([{ endedOn: '2026-09-01' }], TODAY);
    assert.equal(out.current, 1);
    assert.equal(out.former, 0);
    assert.ok(out.onNotice);
  });

  test('the day they leave, they have left', () => {
    assert.equal(standing([{ endedOn: TODAY }], TODAY).former, 1);
  });
});
