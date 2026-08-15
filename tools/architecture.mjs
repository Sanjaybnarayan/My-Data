/**
 * The architecture document, checked against the code it describes.
 *
 * ## Why this exists
 *
 * `docs/FAMILY_OS_MASTER_ARCHITECTURE.md` was written during Phase 0 and opens
 * with *"nothing here is built yet except what is marked exists"*. Audited nine
 * phases later, **thirteen rows marked `missing` had been built** — consent,
 * provenance, lineage, retention, six-level classification, device management,
 * OCR, Google Calendar, `EconomicEvent` and more.
 *
 * That is the same failure this repository has now found nine times in its own
 * roadmap: a claim about the codebase goes stale silently, and the next person
 * to read it plans work that is already done. The roadmap's answer was
 * *"measure before building"*, which relies on somebody remembering. This is the
 * answer that does not: **every state in that document carries a probe, and a
 * probe that disagrees with the repository fails the build.**
 *
 * ## How a row is checked
 *
 * Each row of each component table ends with an evidence cell:
 *
 *     | Consent engine | exists  | `file:js/data/consent.js`     |
 *     | MFA            | missing | `absent:grep:multi-factor`    |
 *
 *   - `file:<path>` — the path must exist. A row claiming something exists,
 *     pointing at a file that does not, is the stale direction everyone expects.
 *   - `export:<path>#<name>` — the file must export that name. Catches a module
 *     that survived a rename with its contents gutted.
 *   - `absent:grep:<term>` — the term must appear **nowhere** in `js/` or
 *     `apps-script/`. This is the direction nobody checks: a row still saying
 *     *missing* about something that now exists.
 *
 * The last is the whole point. A document only drifts in the direction of
 * understating what is built, because building is what people do.
 *
 * ## What this cannot check, said plainly
 *
 * It verifies that a claim is **backed by evidence of the kind it names** — not
 * that the words in the component column are true of the code. Rewriting a row
 * to say *exists* and pointing `file:` at any file that happens to exist will
 * pass, and mutation testing confirmed it does.
 *
 * That is inherent to a probe rather than a defect in one: deciding whether
 * "anomaly detection" describes a module is a judgement, and a tool that tried
 * would be a worse judge than the reviewer looking at the diff. What the tool
 * removes is the *silent* drift — the row nobody edited, which is how all
 * thirteen of the stale ones got that way.
 *
 * ## The budget
 *
 * One row of the forbidden-edges table is a count rather than a state. The
 * document declares four edges that must not exist and admits one does:
 * screens calling the repository directly. That is not a boolean anybody can
 * fix in a tranche — it is 71 call sites — so it is a ratchet like the typecheck
 * budget. It may go down and never up, and the number lives in version control
 * where a rise is a diff somebody has to justify.
 *
 *   node tools/architecture.mjs           check
 *   node tools/architecture.mjs --update  write the current count as the budget
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOC = join(ROOT, 'docs', 'FAMILY_OS_MASTER_ARCHITECTURE.md');
const BUDGET_FILE = join(ROOT, 'tools', 'architecture-budget.json');

/** Every `.js` file under a directory, recursively. */
function filesUnder(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) filesUnder(path, out);
    else if (/\.(js|gs|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/** The sources a probe may look at: what actually ships, plus the backend. */
export function sourceFiles() {
  return [...filesUnder(join(ROOT, 'js')), ...filesUnder(join(ROOT, 'apps-script'))];
}

/** Every evidence probe in the document, with the line it sits on. */
export function probesIn(markdown) {
  const out = [];
  const lines = String(markdown ?? '').split('\n');

  lines.forEach((line, index) => {
    // Only table rows, and only the evidence cell — a probe mentioned in prose
    // is prose, and treating it as a claim would make the document unwritable.
    if (!line.startsWith('|')) return;
    const cells = line.split('|').map((cell) => cell.trim());
    const evidence = cells.at(-2) ?? '';
    const match = /^`(file|export|absent):(.+)`$/.exec(evidence);
    if (!match) return;

    out.push({
      line: index + 1,
      component: cells[1] ?? '',
      state: (cells[2] ?? '').replace(/\*/g, '').trim(),
      kind: match[1],
      target: match[2],
    });
  });

  return out;
}

/**
 * Run one probe. Returns null when it holds, or a sentence when it does not.
 *
 * @param {{kind: string, target: string, state?: string}} probe
 * @param {{sources?: string[]|null, read?: (path: any, encoding?: any) => any}} [options]
 *   `read` and `sources` are injected by the tests. A checker that can only be
 *   run against the real repository can only be tested by breaking it.
 */
export function checkProbe(probe, { sources = null, read = readFileSync } = {}) {
  if (probe.kind === 'file') {
    return existsSync(join(ROOT, probe.target))
      ? null
      : `says "${probe.state}" and cites ${probe.target}, which does not exist`;
  }

  if (probe.kind === 'export') {
    const [path, name] = probe.target.split('#');
    if (!existsSync(join(ROOT, path))) {
      return `cites ${path}, which does not exist`;
    }
    const text = String(read(join(ROOT, path), 'utf8'));
    // Deliberately a text search rather than an import: this tool must be able
    // to check a file it cannot execute, and `apps-script/*.gs` is not a module.
    const exported = new RegExp(`(export\\s+(async\\s+)?(function|const|class)\\s+${name}\\b`
      + `|export\\s*\\{[^}]*\\b${name}\\b|function\\s+${name}\\s*\\()`);
    return exported.test(text) ? null : `cites ${path}#${name}, which it does not export`;
  }

  if (probe.kind === 'absent') {
    const term = probe.target.replace(/^grep:/, '');
    const found = (sources ?? sourceFiles()).find((path) => {
      const text = String(read(path, 'utf8'));
      return new RegExp(term, 'i').test(text);
    });
    return found
      ? `says "${probe.state}", but ${relative(ROOT, found)} mentions "${term}" — `
        + 'this row has gone stale in the direction that matters'
      : null;
  }

  return `has an unknown probe kind: ${probe.kind}`;
}

/**
 * Screens reaching past the service layer to the repository.
 *
 * @param {{files?: string[]|null, read?: (path: any, encoding?: any) => any}} [options]
 */
export function uiDatabaseCalls({ files = null, read = readFileSync } = {}) {
  const modules = files ?? filesUnder(join(ROOT, 'js', 'modules'));
  let count = 0;
  const byFile = {};
  for (const path of modules) {
    const hits = String(read(path, 'utf8')).match(/db\.repo\(/g)?.length ?? 0;
    if (!hits) continue;
    byFile[relative(ROOT, path)] = hits;
    count += hits;
  }
  return { count, byFile };
}

/**
 * Whether the forbidden edge has widened.
 *
 * Exported because it is the half of this tool that has to *fail*, and a check
 * that only ever runs inside `main` is a check nothing can pin.
 */
export function budgetProblem(count, budget) {
  return count > budget
    ? `the UI reaches the repository directly ${count} times, budget ${budget} — `
      + 'the one forbidden edge the architecture document admits is open, and it '
      + 'may only narrow'
    : null;
}

function main() {
  const update = process.argv.includes('--update');
  const markdown = readFileSync(DOC, 'utf8');
  const probes = probesIn(markdown);
  const sources = sourceFiles();

  const failures = [];
  for (const probe of probes) {
    const problem = checkProbe(probe, { sources });
    if (problem) failures.push(`  ${DOC.replace(`${ROOT}/`, '')}:${probe.line}  ${probe.component} ${problem}`);
  }

  const { count, byFile } = uiDatabaseCalls();
  const budget = JSON.parse(readFileSync(BUDGET_FILE, 'utf8'));

  if (update) {
    writeFileSync(BUDGET_FILE, `${JSON.stringify({ ...budget, uiDatabaseCalls: count }, null, 2)}\n`);
    console.log(`budget updated: ${budget.uiDatabaseCalls} → ${count}`);
    return;
  }

  const widened = budgetProblem(count, budget.uiDatabaseCalls);
  if (widened) {
    failures.push(`  ${widened}`);
    for (const [file, n] of Object.entries(byFile).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      failures.push(`      ${n.toString().padStart(3)}  ${file}`);
    }
  }

  if (failures.length) {
    console.error(`${failures.length} architecture claim${failures.length === 1 ? '' : 's'} `
      + 'disagree with the repository:\n');
    console.error(failures.join('\n'));
    console.error('\nFix the code, or fix the document. A stale architecture document is '
      + 'how work already done gets planned again.');
    process.exit(1);
  }

  const lower = count < budget.uiDatabaseCalls;
  console.log(`${probes.length} architecture claims hold`
    + `, UI→database ${count}/${budget.uiDatabaseCalls}`
    + (lower ? ' — fewer than the budget, run with --update to lock it in' : ''));
}

if (process.argv[1] && process.argv[1].endsWith('architecture.mjs')) main();
