/**
 * The threat model says numbers. This checks the code still says the same ones.
 *
 * `docs/THREAT_MODEL.md` is a risk register, and a risk register whose figures
 * have drifted is worse than none: it reads as measurement and is memory. The
 * residual-risk column in particular turns on arithmetic — *a six-digit PIN is
 * one million candidates*, *five guesses per code*, *fifteen minutes before it
 * re-locks* — and every one of those is a constant somebody can change in a
 * line without ever opening the document that quotes it.
 *
 * This is the same discipline `tools/self-description.mjs` applies to the
 * schema counts, narrowed to the constants a threat model is *about*. It does
 * not check the prose and cannot: what it refuses is the specific failure of
 * a number moving in the code and standing still in the document.
 *
 * Deliberately not a budget. There is no ratchet to loosen here — a change to
 * any of these is a change to the security posture, and the right response is
 * to argue it in the document rather than to bump a JSON file.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, describe, assert, setSuite } from './harness.mjs';
import { defaults } from '../js/core/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

setSuite('threat model');

const doc = read('docs/THREAT_MODEL.md');
const otp = read('apps-script/Otp.gs');
const code = read('apps-script/Code.gs');
const keyring = read('js/security/keyring.js');
const session = read('js/security/session.js');

/** The value of a `var NAME = 123;` in an Apps Script file. */
const gsNumber = (source, name) => Number(
  new RegExp(`var ${name} = (\\d+)`).exec(source)?.[1] ?? NaN);

describe('the numbers the document quotes are the numbers in the code', () => {
  /*
   * Each row: what the document says, and where the code says it.
   *
   * The phrase is matched literally against the prose. That is the point — a
   * constant changed without the sentence changing fails here, and a sentence
   * reworded without the constant changing fails here too, which is the
   * cheaper of the two mistakes to make and the easier to miss.
   */
  /**
   * Annotated, because destructuring `[phrase, holds]` out of a bare array
   * literal gives each element the union of both — so `holds()` is a call on
   * `string | (() => boolean)`, which `tsc` rejects. The tuple type is the
   * shape the loop below actually relies on.
   *
   * @type {Array<[string, () => boolean]>}
   */
  const bound = [
    // The arithmetic the residual-risk cell rests on, done rather than quoted.
    ['one million candidates', () => 10 ** pinFloor() === 1_000_000],
    ['600,000 rounds', () => defaults.pbkdf2Iterations === 600_000],
    ['floor is 6 digits', () => pinFloor() === 6],
    ['defaults to 15', () => defaults.sessionTimeoutMinutes === 15],
    ['Five attempts', () => defaults.maxUnlockAttempts === 5 && attemptMax() === 5],
    ['10-minute TTL', () => gsNumber(otp, 'OTP_TTL_SECONDS') === 600],
    ['5 guesses per code', () => gsNumber(otp, 'OTP_MAX_ATTEMPTS') === 5],
    ['5 sends per address per hour', () => gsNumber(otp, 'OTP_PER_ADDRESS') === 5],
    ['60 per deployment', () => gsNumber(otp, 'OTP_PER_DEPLOYMENT') === 60],
    ['120 requests per user per minute', () => gsNumber(code, 'RATE_LIMIT') === 120],
  ];

  /** The PIN floor, read out of the file that enforces it rather than the UI. */
  const pinFloor = () => Number(/const PIN_DIGITS_MIN = (\d+)/.exec(keyring)?.[1] ?? NaN);

  /** `AttemptLimiter`'s default, read from its own parameter list. */
  const attemptMax = () => Number(/max = (\d+)/.exec(session)?.[1] ?? NaN);

  for (const [phrase, holds] of bound) {
    test(`"${phrase}" is still true`, () => {
      assert.includes(doc, phrase, `docs/THREAT_MODEL.md no longer says "${phrase}"`);
      assert.ok(holds(), `the code no longer agrees with "${phrase}"`);
    });
  }
});

describe('the shape of the document', () => {
  /*
   * Section 3 of the brief asks for six named columns and this keeps them.
   * A register that quietly loses its residual-risk column becomes a list of
   * things somebody thought about, which is not the same document.
   */
  test('every table carries the six columns the brief asks for', () => {
    for (const column of
      ['Threat', 'Vector', 'Likelihood', 'Impact', 'Mitigation', 'Residual risk']) {
      assert.includes(doc, `| ${column} |`, `the ${column} column is gone`);
    }
  });

  test('no row claims there is nothing left over', () => {
    /*
     * The rule the document states about itself, enforced.
     *
     * A residual-risk cell reading "none" is the failure mode a register of
     * this kind has: the row stops being an assessment and becomes a claim of
     * completeness. Matched with the cell delimiters so a sentence *about*
     * having no mitigation — "**None.** No lockfile audit" in T2.4, which is
     * an honest statement in the Mitigation column — is not caught by it.
     */
    for (const empty of ['| None |', '| none |', '| N/A |', '| Nothing |']) {
      assert.not(doc.includes(empty), `a table cell reads ${empty}`);
    }
  });

  test('the boundaries the document is organised by are all present', () => {
    for (const id of ['B1', 'B2', 'B3', 'B4', 'B5', 'B6']) {
      assert.includes(doc, `## ${id} —`, `boundary ${id} has no section`);
    }
  });
});
