/**
 * Locale.
 *
 * FamilyOS speaks English. This module is what a second language would have
 * to come through, and — more usefully — what stops a half-finished second
 * language from quietly shipping as if it were finished.
 *
 * Three rules, and the third is the only interesting one.
 *
 * **A missing translation falls back to English, never to a key.** A screen
 * reading `settings.archive.take` in place of a sentence looks broken in a way
 * that makes people distrust the numbers next to it.
 *
 * **Coverage is derived, not declared.** A catalogue cannot say how complete
 * it is; it is measured against the English one every time it is asked. This
 * repository has now found six places where a hand-maintained list sat beside
 * a derivable one and drifted, twice inside checks written to prevent exactly
 * that, so no catalogue gets to describe itself.
 *
 * **A translation that loses a placeholder is refused.** `You spent {amount}
 * on {category}` translated as a sentence with no `{amount}` in it is not a
 * worse translation, it is a different statement — the household is told they
 * spent, and not how much. Rule 57 says every financial event must be
 * explainable, and an explanation with the number missing explains nothing.
 * So the placeholders of a translation are compared against the English, and a
 * translation that has lost one is dropped in favour of the English it was
 * meant to replace. Loudly: `missing()` collects every such refusal, and the
 * language picker shows them, because a translator needs to know which line
 * they broke and a household needs to know the app is not using it.
 *
 * What this module does not do is translate anything. There is one catalogue
 * and it is English. docs/LOCALISATION.md says what a second one would need
 * and why guessing at 3,059 strings of financial and legal vocabulary would
 * have been worse than shipping none.
 */

import { bus, TOPIC } from './bus.js';
import { strings as english } from '../locale/en.js';

const KEY = 'familyos.locale';

export const FALLBACK = 'en';

/** `{name}` — deliberately not `${name}`, which a catalogue file could execute. */
const PLACEHOLDER = /\{(\w+)\}/g;

const catalogues = new Map();
const refusals = new Map();

/**
 * Register a catalogue. `strings` are the UI messages; `labels` override the
 * English that lives in the schema, keyed `entity.<name>.one`,
 * `entity.<name>.many`, `field.<entity>.<field>` and `module.<id>`.
 *
 * Schema labels are not duplicated into the English catalogue. English *is*
 * the schema — copying 345 labels into a second file would create exactly the
 * pair of lists that drift.
 */
export function register(tag, { strings = {}, labels = {}, name = tag, dir = 'ltr', midSentence = 'preserve' } = {}) {
  catalogues.set(tag, { tag, name, dir, strings, labels, midSentence });
  refusals.delete(tag);
  return tag;
}

/**
 * Reset to English alone. English is re-registered rather than dropped: it is
 * the fallback every other lookup goes through, and a `t()` that returned raw
 * keys because a test cleared the catalogues would be a confusing way to fail.
 */
export function forget() {
  catalogues.clear();
  refusals.clear();
  register(FALLBACK, { strings: english, name: 'English', midSentence: 'lower' });
  current = null;
}

/**
 * The tags of every registered catalogue.
 *
 * Named `catalogueTags` rather than the obvious `registered` because
 * `registered` is also a field on `will` and on `legalDocument`, and
 * tools/field-coverage.mjs finds a field by searching for its name in code. An
 * exported function called `registered` moved both of those off the unread
 * list without a line of code reading either — a ratchet loosened by a
 * coincidence of naming. The tool caught it; the name is the fix.
 */
export function catalogueTags() {
  return [...catalogues.keys()];
}

function catalogue(tag) {
  return catalogues.get(tag) ?? null;
}

function placeholders(text) {
  return new Set(String(text).match(PLACEHOLDER) ?? []);
}

/**
 * Does `candidate` say everything `english` says? Only placeholders are
 * compared — meaning cannot be checked here, and pretending otherwise would
 * be the same false confidence this module exists to prevent.
 */
export function keepsPlaceholders(english, candidate) {
  const want = placeholders(english);
  const got = placeholders(candidate);
  for (const p of want) if (!got.has(p)) return false;
  return true;
}

function note(tag, key) {
  if (!refusals.has(tag)) refusals.set(tag, new Set());
  refusals.get(tag).add(key);
}

/** Keys whose translation was refused for dropping a placeholder. */
export function missing(tag = active()) {
  return [...(refusals.get(tag) ?? [])].sort();
}

export function storedLocale(storage = globalThis.localStorage) {
  const value = storage?.getItem(KEY);
  return catalogues.has(value) ? value : FALLBACK;
}

let current = null;

export function active() {
  return current ?? FALLBACK;
}

export function choose(tag, { storage = globalThis.localStorage, root = globalThis.document?.documentElement } = {}) {
  if (!catalogues.has(tag)) tag = FALLBACK;
  current = tag;
  storage?.setItem(KEY, tag);

  const meta = catalogue(tag);
  if (root) {
    root.setAttribute('lang', tag);
    root.setAttribute('dir', meta?.dir ?? 'ltr');
  }
  bus.emit(TOPIC.locale, { tag, dir: meta?.dir ?? 'ltr' });
  return tag;
}

/** Read the stored preference at startup. Separate so tests can skip it. */
export function start(options = {}) {
  return choose(storedLocale(options.storage), options);
}

function interpolate(text, vars) {
  return String(text).replace(PLACEHOLDER, (whole, name) =>
    (Object.hasOwn(vars, name) ? String(vars[name]) : whole));
}

/**
 * Translate. Falls back to English, then to the key itself — which only
 * happens when the code asks for a key no catalogue has, i.e. a bug, and
 * `tests/locale.test.mjs` asserts every key the application uses exists.
 */
export function t(key, vars = {}, { tag = active() } = {}) {
  const english = catalogue(FALLBACK)?.strings?.[key];
  const local = tag === FALLBACK ? undefined : catalogue(tag)?.strings?.[key];

  let text = english ?? key;
  if (local !== undefined) {
    if (english === undefined || keepsPlaceholders(english, local)) {
      text = local;
    } else {
      note(tag, key);
    }
  }
  return interpolate(text, vars);
}

/**
 * A noun about to be dropped into the middle of a sentence.
 *
 * English writes "Add person", not "Add Person", so the label `Person` is
 * lowercased on its way in. That is a fact about English and not about
 * FamilyOS: German capitalises every noun and would be wrong, and Hindi has no
 * letter case for the rule to apply to. So each catalogue declares what its
 * own nouns do — `midSentence: 'lower'` or `'preserve'` — and the call sites
 * stop deciding. They used to call `.toLowerCase()` themselves in nine places,
 * which is nine copies of an assumption about English hidden in the UI layer.
 */
export function noun(text, { tag = active() } = {}) {
  const rule = catalogue(tag)?.midSentence ?? 'preserve';
  return rule === 'lower' ? String(text).toLowerCase() : String(text);
}

/**
 * A schema label, in the active language. `fallback` is the English already in
 * the schema, so a locale that says nothing about an entity still renders.
 */
export function label(key, fallback, { tag = active() } = {}) {
  const local = tag === FALLBACK ? undefined : catalogue(tag)?.labels?.[key];
  return local ?? fallback;
}

/**
 * How much of the application a locale actually says, in [0, 1].
 *
 * Measured against the English catalogue and the schema label inventory
 * passed in, never against anything the catalogue claims about itself. A
 * locale that has never been registered covers nothing, which is the truthful
 * answer rather than an error.
 */
export function coverage(tag, { labelKeys = [] } = {}) {
  if (tag === FALLBACK) return catalogues.has(FALLBACK) ? 1 : 0;
  const meta = catalogue(tag);
  const english = catalogue(FALLBACK)?.strings ?? {};
  const wanted = Object.keys(english);
  const total = wanted.length + labelKeys.length;
  if (total === 0) return 0;
  if (!meta) return 0;

  let have = 0;
  for (const key of wanted) {
    const local = meta.strings?.[key];
    if (local === undefined) continue;
    // A refused translation is not coverage. Counting it would let a
    // catalogue raise its percentage with strings the app will never show.
    if (!keepsPlaceholders(english[key], local)) continue;
    have++;
  }
  for (const key of labelKeys) if (meta.labels?.[key] !== undefined) have++;
  return have / total;
}

/** Every registered locale with its real coverage, English first. */
export function locales({ labelKeys = [] } = {}) {
  return [...catalogues.values()]
    .map(({ tag, name, dir }) => ({ tag, name, dir, coverage: coverage(tag, { labelKeys }) }))
    .sort((a, b) => (a.tag === FALLBACK ? -1 : b.tag === FALLBACK ? 1 : b.coverage - a.coverage));
}

// English is registered at load rather than at startup. `t()` is called from
// domain code that runs in tests with no application around it, and a date
// formatter that returned `month.3` outside the browser would make every
// suite depend on remembering to bootstrap a language.
register(FALLBACK, { strings: english, name: 'English', midSentence: 'lower' });
