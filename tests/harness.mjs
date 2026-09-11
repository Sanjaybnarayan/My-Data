/**
 * Test harness.
 *
 * No dependencies and no browser. The source modules below `js/core`,
 * `js/data`, `js/domain`, `js/security`, `js/sync`, `js/ai` and `js/reports`
 * never touch `document` or `window`, so they are imported and run directly —
 * what the tests exercise is the code that ships, not a re-implementation.
 *
 * The browser surfaces that are unavoidable (`localStorage`) are stubbed here,
 * once, rather than in each suite.
 */

let currentSuite = '';
const results = [];

export function suite(name, fn) {
  currentSuite = name;
  return { name, fn };
}

const registry = [];

/** Register a check. The body may be async. */
export function test(name, fn) {
  registry.push({ suite: currentSuite, name, fn });
}

/** Group tests under a heading; the heading is part of the failure message. */
export function describe(name, fn) {
  const previous = currentSuite;
  currentSuite = previous ? `${previous} › ${name}` : name;
  fn();
  currentSuite = previous;
}

export function setSuite(name) {
  currentSuite = name;
}

/* ------------------------------------------------------------- assertions */

export class AssertionError extends Error {}

function fail(message, actual, expected) {
  const detail = expected === undefined
    ? `\n      got: ${show(actual)}`
    : `\n      got: ${show(actual)}\n expected: ${show(expected)}`;
  throw new AssertionError(message + detail);
}

function show(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value, (_k, v) => (v instanceof Set ? [...v] : v));
  } catch {
    return String(value);
  }
}

export const assert = {
  ok(value, message = 'expected a truthy value') {
    if (!value) fail(message, value);
  },
  not(value, message = 'expected a falsy value') {
    if (value) fail(message, value);
  },
  equal(actual, expected, message = 'values differ') {
    if (!Object.is(actual, expected)) fail(message, actual, expected);
  },
  notEqual(actual, expected, message = 'values should differ') {
    if (Object.is(actual, expected)) fail(message, actual, expected);
  },
  deep(actual, expected, message = 'structures differ') {
    const a = JSON.stringify(sortKeys(actual));
    const b = JSON.stringify(sortKeys(expected));
    if (a !== b) fail(message, actual, expected);
  },
  close(actual, expected, tolerance = 1e-9, message = 'numbers differ') {
    if (!(Math.abs(actual - expected) <= tolerance)) fail(message, actual, expected);
  },
  includes(haystack, needle, message = 'value not found') {
    const found = typeof haystack === 'string'
      ? haystack.includes(needle)
      : Array.from(haystack ?? []).some((x) => Object.is(x, needle));
    if (!found) fail(message, haystack, needle);
  },
  length(list, n, message = 'wrong number of items') {
    if ((list?.length ?? -1) !== n) fail(message, list?.length, n);
  },
  /**
   * Assert that `fn` throws — **synchronously when `fn` is synchronous.**
   *
   * ## Why the shape of this matters more than what it checks
   *
   * This used to be `async` unconditionally, so it always returned a promise.
   * A *synchronous* test body calling it without `await` therefore returned
   * `undefined`, `runAll`'s `await item.fn()` resolved, and the check was
   * recorded **`ok: true`** — after which the rejected promise surfaced
   * unhandled and killed the process before any tally printed.
   *
   * Five checks were in that state, and every one of them asserted that
   * something is *refused*: the keyring handing out a key while locked,
   * `assertCan` on a child's write, the backend admitting a non-member
   * (twice), and the unlock limiter locking out.
   *
   * Measured rather than reasoned about. With `recordFailure`'s lockout
   * disabled and the unhandled rejection swallowed, the suite reported:
   *
   *     [swallowed unhandled rejection] expected a throw
   *     FAIL  security › attempt limiting › the lockout doubles each round
   *     FAIL  security › attempt limiting › the lockout survives a reload
   *
   * The test named *"locks out after the fifth wrong PIN"* — the one written
   * for exactly that break — **passed**. Only its two neighbours, which use
   * `assert.equal`, noticed anything, and the failure that did escape carried
   * no test name at all.
   *
   * The mutation catalogue recorded this as *caught — the runner did not
   * finish*, which is true and is the reason nobody looked: an outcome that
   * reads like success, standing in for a check that cannot fail. This file's
   * sibling `tools/lint.mjs` states the principle being violated — *a control
   * that cannot fail is not held, however carefully it is written.*
   *
   * ## The fix, and why it is here rather than at five call sites
   *
   * Adding `await` five times fixes five tests and nothing about the sixth.
   * So: when `fn` returns a thenable this stays async and must be awaited;
   * when it does not, the whole check happens now and any failure is thrown
   * **synchronously**, where `runAll`'s `try` catches it and attributes it to
   * the test that made the claim. `runAll` covers the async half — see the
   * pending-assertion guard there.
   */
  throws(fn, match, message = 'expected a throw') {
    const check = (thrown) => {
      if (!thrown) fail(message, 'no error thrown');
      if (match) {
        const text = `${thrown.name}: ${thrown.message} ${thrown.code ?? ''}`;
        const ok = match instanceof RegExp ? match.test(text) : text.includes(match);
        if (!ok) fail(`${message} — wrong error`, text, String(match));
      }
      return thrown;
    };

    let returned;
    try {
      returned = fn();
    } catch (err) {
      // A synchronous throw is the answer already, whatever `fn` was declared
      // as: an `async` function that throws before its first `await` still
      // rejects rather than throwing, so this branch only catches real ones.
      return check(err);
    }

    if (!returned || typeof returned.then !== 'function') return check(null);
    return watch(returned.then(() => check(null), (err) => check(err)));
  },
  resolves(promise, message = 'expected no throw') {
    return watch(Promise.resolve(promise).catch((err) => {
      fail(`${message}: ${err.message}`, err);
      return undefined;
    }));
  },
};

/**
 * Assertion promises created during the test now running.
 *
 * An async assertion a test forgets to `await` has nowhere to report to. Left
 * alone it becomes an unhandled rejection, which ends the process — losing the
 * tally, every test after it, and the name of the one that failed.
 *
 * `runAll` settles these after each body, so a forgotten `await` fails the
 * test that forgot it instead of taking down the run.
 */
const pending = [];

function watch(promise) {
  pending.push(promise);
  return promise;
}

/** Whatever an un-awaited assertion decided, or null. Clears the list. */
export async function settlePending() {
  const outstanding = pending.splice(0);
  for (const result of await Promise.allSettled(outstanding)) {
    if (result.status === 'rejected') return result.reason;
  }
  return null;
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

/* ------------------------------------------------------------------ stubs */

/** A localStorage that behaves like the real one, including string coercion. */
export function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? String(map.get(k)) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
  };
}

/** A clock the tests move by hand, so nothing waits on real time. */
export function fakeClock(start = Date.parse('2025-06-15T10:00:00Z')) {
  let now = start;
  const fn = () => now;
  fn.advance = (ms) => { now += ms; return now; };
  fn.set = (value) => { now = typeof value === 'number' ? value : Date.parse(value); return now; };
  return fn;
}

if (!globalThis.localStorage) globalThis.localStorage = fakeStorage();

/* -------------------------------------------------------------- execution */

/**
 * One registered check, run, as `{ label, ok, err }`.
 *
 * Extracted from the loop in `run` for the reason `tools/lint.mjs#unallowed`
 * was: a control nothing can drive is a control nothing holds. The forgotten-
 * assertion guard below is the whole point of this seam — a test can call
 * `settlePending()` for itself and prove the *function* works, and prove
 * nothing at all about the runner remembering to ask.
 */
export async function runCheck(item) {
  const label = item.suite ? `${item.suite} › ${item.name}` : item.name;
  try {
    await item.fn();
    // A test that forgot to `await` an async assertion has finished without
    // hearing its answer. Asking here turns that into a failure of the test
    // that forgot rather than an unhandled rejection that ends the run.
    const forgotten = await settlePending();
    if (forgotten) throw forgotten;
    return { label, ok: true };
  } catch (err) {
    await settlePending();
    return { label, ok: false, err };
  }
}

export async function run(files) {
  const started = Date.now();
  for (const file of files) {
    registry.length = 0;
    currentSuite = '';
    const module = await import(file);
    if (typeof module.default === 'function') module.default();

    for (const item of registry) results.push(await runCheck(item));
  }

  const failed = results.filter((r) => !r.ok);
  const width = 60;

  for (const r of failed) {
    console.error(`\n  FAIL  ${r.label}`);
    console.error(`        ${String(r.err?.message ?? r.err).split('\n').join('\n        ')}`);
    if (!(r.err instanceof AssertionError) && r.err?.stack) {
      const frame = r.err.stack.split('\n').slice(1, 3).join('\n');
      console.error(`        ${frame.trim()}`);
    }
  }

  console.log(`\n${'-'.repeat(width)}`);
  console.log(`  ${results.length - failed.length}/${results.length} passed`
    + `  ·  ${Date.now() - started}ms`);
  console.log('-'.repeat(width));

  return failed.length;
}

export function reset() {
  registry.length = 0;
  results.length = 0;
}
