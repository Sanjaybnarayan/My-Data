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
  async throws(fn, match, message = 'expected a throw') {
    let thrown = null;
    try {
      await fn();
    } catch (err) {
      thrown = err;
    }
    if (!thrown) fail(message, 'no error thrown');
    if (match) {
      const text = `${thrown.name}: ${thrown.message} ${thrown.code ?? ''}`;
      const ok = match instanceof RegExp ? match.test(text) : text.includes(match);
      if (!ok) fail(`${message} — wrong error`, text, String(match));
    }
    return thrown;
  },
  async resolves(promise, message = 'expected no throw') {
    try {
      return await promise;
    } catch (err) {
      fail(`${message}: ${err.message}`, err);
      return undefined;
    }
  },
};

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

export async function run(files) {
  const started = Date.now();
  for (const file of files) {
    registry.length = 0;
    currentSuite = '';
    const module = await import(file);
    if (typeof module.default === 'function') module.default();

    for (const item of registry) {
      const label = item.suite ? `${item.suite} › ${item.name}` : item.name;
      try {
        await item.fn();
        results.push({ label, ok: true });
      } catch (err) {
        results.push({ label, ok: false, err });
      }
    }
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
