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
    // with the counts that decided it. Five patterns a type checker cannot see,
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
