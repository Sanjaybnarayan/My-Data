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
import { dirname, join, relative } from 'node:path';

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
];

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

export function lint() {
  const findings = [];

  for (const dir of SHIPPED) {
    for (const path of files(join(ROOT, dir))) {
      const lines = codeLines(readFileSync(path, 'utf8'));
      for (const { number, text } of lines) {
        for (const rule of RULES) {
          if (rule.pattern.test(text)) {
            findings.push({ rule, file: relative(ROOT, path), line: number, text: text.trim() });
          }
        }
      }
    }
  }

  return findings;
}

/** Importable without running: `tests/modules.test.mjs` calls `lint()` itself. */
// `endsWith('lint.mjs')` would also match a `mut-lint.mjs`, which is how this
// module printed its report in the middle of somebody else's script.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const findings = lint();

  if (!findings.length) {
    console.log(`no findings across ${RULES.length} rules, in what ships to a browser`);
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
}
