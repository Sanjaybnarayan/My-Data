/**
 * The few things a type checker structurally cannot see.
 *
 * ## Why this is thirty rules short of a linter
 *
 * The roadmap carried *"25,000 untyped lines with no linter"* from Phase 0
 * onward as though it were a live risk. Measured, before writing any of this:
 *
 *     noImplicitReturns findings   :  1
 *     loose == / != comparisons    :  3   (all `!= null`, which is the idiom)
 *     var declarations             :  0
 *     console.log in shipped code  :  0
 *     debugger / eval / innerHTML  :  0
 *
 * That is the **sixth** line in that document to go stale on being measured. A
 * generic linter would arrive with a large dependency tree — this repository
 * has three devDependencies and no build step — in exchange for findings that
 * have already been counted and are nearly all zero. `tsconfig.json` already
 * carries `noUnusedLocals` and `noFallthroughCasesInSwitch` for the same
 * reason, and this tranche adds `noImplicitReturns` to it.
 *
 * So the decision is: **no linter, stated rather than omitted.** What is left
 * are a handful of patterns that are not type errors, that `tsc` will never
 * report, and that would each be a real problem in *this* application rather
 * than a style preference.
 *
 * ## Why a ratchet at zero is worth having
 *
 * Every count below is zero today. A check that reports zero forever looks
 * pointless right up until somebody pastes a `console.log` into a screen that
 * renders a PAN, and then it is the only thing standing between a debug
 * statement and a household's identity number in a browser console. Same shape
 * as `tools/field-coverage.mjs`: the value is in the direction it fails.
 *
 * Usage:
 *   node tools/lint.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each rule is a regex and a reason, and the reason is the point — a finding
 * with no explanation is a finding somebody works around.
 */
const RULES = [
  {
    id: 'no-console-log',
    pattern: /(^|[^.\w])console\s*\.\s*log\s*\(/,
    why: 'This application holds PANs, account numbers and health records. A '
      + 'debug statement that survives into a release prints them into a '
      + 'console anybody with the device can open. `console.error` for a '
      + 'genuine failure is fine and is why this names `log` only.',
  },
  {
    id: 'no-debugger',
    pattern: /(^|[^.\w])debugger\s*(;|$)/,
    why: 'A shipped `debugger` freezes the application for anybody with dev '
      + 'tools open.',
  },
  {
    id: 'no-eval',
    pattern: /(^|[^.\w])eval\s*\(|new\s+Function\s*\(/,
    why: 'Executing constructed strings is the one thing the content security '
      + 'policy is there to prevent. If this ever appears, the CSP is about to '
      + 'be loosened to accommodate it.',
  },
  {
    id: 'no-innerhtml',
    pattern: /\.\s*(innerHTML|outerHTML)\s*=|insertAdjacentHTML\s*\(/,
    why: 'Every node in this application is built by `ui/dom.js`, which sets '
      + 'text rather than markup. Assigning HTML puts a bank narration — text '
      + 'this application did not write — on a path where it can be parsed as '
      + 'markup.',
  },
  {
    id: 'no-browser-dialogs',
    // `window.`-qualified only for `prompt` and `confirm`, and that is not
    // fussiness: this application defines components of both names, and the
    // first run of this rule reported four of its own calls as findings. A
    // rule whose every finding is wrong is worse than no rule — people learn
    // to skip the output. `alert` is matched bare because nothing here defines
    // one, so any call is the global.
    pattern: /window\s*\.\s*(alert|prompt|confirm)\s*\(|(^|[^.\w])alert\s*\(/,
    why: 'The application has its own confirm, prompt and toast components. A '
      + 'native dialog blocks the thread and cannot be styled, tested or '
      + 'translated.',
  },
  {
    id: 'labels-through-the-door',
    pattern: /\.labels\s*\??\s*[.[]|\b(?:field|fields)\s*\??\s*\.\s*label\b/,
    why: '`js/core/labels.js` calls itself "the one door" the schema\'s English '
      + 'passes through on the way to a screen, and that is what makes a '
      + 'catalogue able to replace it. Reading `def.labels.one` directly walks '
      + 'around the door: the label reaches the screen in English however '
      + 'completely the locale is translated, and `coverage()` still reports '
      + '1.0 because the key was translated — it was just never asked for. Use '
      + '`entityLabel(def)` / `entityLabel(def, \'many\')`, `fieldLabel(entity, '
      + 'field)` for a field\'s label, and `noun()` rather than '
      + '`.toLowerCase()` for one going mid-sentence.',
    allowed: {
      'js/core/labels.js':
        'The door itself. This is the file that reads the schema label so '
        + 'nothing else has to.',
      'js/core/locale.js':
        'A catalogue\'s own `labels` map — the translations, not the schema '
        + 'English. Same property name, opposite side of the door.',
      'js/domain/kyc.js':
        'Its `field` is a local list of KYC comparisons with hand-written '
        + 'English labels, not a schema field — the one place the shape of '
        + 'this rule cannot tell apart from the thing it is looking for. That '
        + 'English is counted by tools/strings.mjs like any other.',
      'js/modules/reports.js':
        'One call: the entity label written into the export audit entry. That '
        + 'row is read back months later, possibly in another language, and a '
        + 'record of what the exporter\'s screen said that afternoon is a '
        + 'record of the screen rather than of the export.',
    },
  },
  {
    id: 'screens-read-through-the-repository',
    only: ['js/modules/', 'js/ui/', 'js/services/'],
    pattern: /\bdb\s*\??\s*\.\s*adapter\b/,
    why: '`js/services/service.js` states the rule in its own words — "a '
      + 'service reads through `db.repo(...)` and never through `db.adapter`" '
      + '— because the repository is where `rowFilter` is applied and the '
      + 'adapter is the layer underneath it, which knows nothing about who is '
      + 'signed in. Nothing checked it. The Settings screen read the audit log '
      + 'as `recentActivity(db.adapter, …)` and printed a line naming every '
      + 'entity in the household to a child who may read twelve of the '
      + 'fifty-three. Go through `Database` — it has a method for every system '
      + 'store worth reaching, and adding one is cheaper than a leak.',
    allowed: {
      'js/modules/settings.js':
        'Two system stores with no per-row ACL: `adapter.usage()`, which is a '
        + 'figure about the browser rather than about the household, and the '
        + 'diagnostics log, whose every string has already been through '
        + '`data/diagnostics.js#redact`.',
      'js/modules/settings/connection.js':
        'The outbox — this device\'s own unsent writes. `Outbox` takes the '
        + 'adapter by construction, and a queue entry is not a record anybody '
        + 'else\'s role has a view on.',
      'js/modules/settings/data.js':
        'The conflicts store and `destroy()`. A conflict is two versions of a '
        + 'row this device already holds, and the screen that shows them is '
        + 'the restore screen; `destroy()` empties the database rather than '
        + 'reading it.',
    },
  },
];

/** The rules, for a test that needs one by name. */
export const rules = () => RULES;

/** Only what ships to a browser. Tools and tests are not shipped. */
const SHIPPED = ['js'];

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (name.endsWith('.js')) yield path;
  }
}

/**
 * A line that is inside a block comment or is a line comment.
 *
 * Crude on purpose, and the crudeness is in the safe direction: this file's own
 * prose contains every pattern it looks for, and so does the documentation in
 * `domain/paymentapp.js`. Missing a real finding because somebody hid it in a
 * comment is not a failure mode worth guarding against — a rule that fires on
 * its own explanation is.
 */
function codeLines(text) {
  const out = [];
  let inBlock = false;

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false;
      return;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlock = true;
      return;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    out.push({ number: index + 1, text: line });
  });

  return out;
}

/**
 * The rules applied to a string, so they can be tested without writing files.
 *
 * A ratchet that reports zero forever is indistinguishable from a regex that
 * stopped matching. This is what lets the suite prove each rule still fires on
 * the thing it names — and stays quiet on the things it must not, which is the
 * half that caught `no-browser-dialogs` flagging this application's own
 * `prompt` component on its first run.
 */
export function findingsIn(text) {
  const out = [];
  for (const { number, text: line } of codeLines(text)) {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) out.push({ rule: rule.id, line: number });
    }
  }
  return out;
}

/**
 * Whether a rule has anything to say about this file.
 *
 * Most rules are about everything that ships. `only` is for a rule whose
 * *name* already narrows it — `screens-read-through-the-repository` is about
 * screens and the services behind them, and the sync engine reaching the
 * adapter is that layer doing its job rather than an exception to be excused.
 *
 * A scope, not an allowance: an allowance is a file that matches and is
 * forgiven, and `staleAllowances` checks each one still matches. Listing the
 * sync engine there would be claiming it does something it should not, and
 * would have to be re-read by whoever prunes that list next.
 */
function applies(rule, file) {
  return !rule.only || rule.only.some((prefix) => file.startsWith(prefix));
}

/**
 * Every line of shipped code that matches a rule, allowed or not.
 *
 * Separate from `lint()` because the allowlist has to be checked in both
 * directions and the second direction needs the raw matches: a file listed as
 * a deliberate exception that no longer matches is a stale exception, and a
 * list nobody prunes is how an exception outlives its reason. The pattern has
 * shown up six times in this repository — a hand-maintained list beside a
 * derivable one — and the answer each time is to derive the disagreement.
 *
 * @returns {{ rule: typeof RULES[number], file: string, line: number, text: string }[]}
 */
export function matches() {
  const out = [];

  for (const dir of SHIPPED) {
    for (const path of files(join(ROOT, dir))) {
      const file = relative(ROOT, path).split(sep).join('/');
      for (const { number, text } of codeLines(readFileSync(path, 'utf8'))) {
        for (const rule of RULES) {
          if (!applies(rule, file)) continue;
          if (rule.pattern.test(text)) out.push({ rule, file, line: number, text: text.trim() });
        }
      }
    }
  }

  return out;
}

/**
 * Allowed files that no longer match the rule they are excused from.
 *
 * Reported as findings of their own rather than ignored, because an exception
 * that has stopped being needed is a line of documentation asserting something
 * untrue about the code.
 *
 * @param {ReturnType<typeof matches>} found
 */
export function staleAllowances(found) {
  const out = [];
  for (const rule of RULES) {
    for (const file of Object.keys(rule.allowed ?? {})) {
      if (found.some((one) => one.rule === rule && one.file === file)) continue;
      out.push({ rule, file });
    }
  }
  return out;
}

/**
 * The matches a rule has not excused, given where they are.
 *
 * Separate from `lint()` and taking its input rather than reading the tree,
 * because with every allowance currently matching there is no unexcused
 * finding anywhere in `js/` — so a filter that excused *every* file would
 * behave identically against the real tree and nothing would say so. The
 * mutation ratchet reported exactly that before this was extracted. A control
 * that cannot fail is not held, however carefully it is written.
 *
 * @param {ReturnType<typeof matches>} found
 */
export function unallowed(found) {
  return found.filter(({ rule, file }) => !(rule.allowed && file in rule.allowed));
}

export function lint() {
  return unallowed(matches());
}

/** Importable without running: `tests/modules.test.mjs` calls `lint()` itself. */
// `endsWith('lint.mjs')` would also match a `mut-lint.mjs`, which is how this
// module printed its report in the middle of somebody else's script.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const findings = lint();
  const stale = staleAllowances(matches());

  for (const { rule, file } of stale) {
    console.error(`  ${file}  [${rule.id}] is allowed but no longer matches — remove the allowance`);
  }

  if (!findings.length && !stale.length) {
    const allowed = RULES.reduce((n, rule) => n + Object.keys(rule.allowed ?? {}).length, 0);
    console.log(`no findings across ${RULES.length} rules, in what ships to a browser`
      + ` (${allowed} allowed by name, each still matching)`);
  } else if (!findings.length) {
    process.exit(1);
  } else {
    console.error(`${findings.length} finding${findings.length === 1 ? '' : 's'}:\n`);
    const seen = new Set();
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line}  [${finding.rule.id}]`);
      console.error(`    ${finding.text.slice(0, 100)}`);
      if (!seen.has(finding.rule.id)) {
        seen.add(finding.rule.id);
        console.error(`    ${finding.rule.why}\n`);
      }
    }
    process.exit(1);
  }

  if (stale.length) process.exit(1);
}
