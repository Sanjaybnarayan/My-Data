/**
 * Money.
 *
 * Amounts are integers in the currency's minor unit — paise for INR, cents for
 * USD. Never floats. `0.1 + 0.2` is the reason: a budget that is over by
 * ₹0.000000000004 renders as over, and a reconciliation that should balance
 * does not. Every amount entering the system is converted at the boundary and
 * every amount leaving it is formatted at the boundary; in between it is a
 * plain integer and ordinary arithmetic is exact.
 *
 * Division and percentage are the only operations that can lose value, and
 * both round half away from zero, then `allocate` exists for the cases where
 * the rounded parts must still add back to the whole.
 */

export const CURRENCIES = {
  INR: { code: 'INR', symbol: '₹', minor: 2, locale: 'en-IN' },
  USD: { code: 'USD', symbol: '$', minor: 2, locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', minor: 2, locale: 'de-DE' },
  GBP: { code: 'GBP', symbol: '£', minor: 2, locale: 'en-GB' },
  AED: { code: 'AED', symbol: 'د.إ', minor: 2, locale: 'ar-AE' },
  SGD: { code: 'SGD', symbol: 'S$', minor: 2, locale: 'en-SG' },
};

export const DEFAULT_CURRENCY = 'INR';

function meta(code) {
  return CURRENCIES[code] ?? CURRENCIES[DEFAULT_CURRENCY];
}

function factor(code) {
  return 10 ** meta(code).minor;
}

function roundHalfUp(n) {
  // Math.round(-0.5) is -0, i.e. towards +∞. Money should round away from
  // zero so a debit and a credit of the same size round to the same size.
  return n < 0 ? -Math.round(-n) : Math.round(n);
}

/**
 * Parse user input into minor units. Accepts `1,23,456.78`, `₹1234`, `-45`,
 * `(45)` for negative, and bare numbers. Returns null for anything else, so a
 * caller can tell "empty" from "zero".
 */
export function toMinor(input, code = DEFAULT_CURRENCY) {
  if (typeof input === 'number') {
    return Number.isFinite(input) ? roundHalfUp(input * factor(code)) : null;
  }
  if (typeof input !== 'string') return null;

  let text = input.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/[₹$€£\s]/g, '').replace(/[a-zA-Z؀-ۿ]/g, '').replace(/,/g, '');
  if (text.startsWith('-')) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith('+')) {
    text = text.slice(1);
  }

  if (!/^\d*(\.\d*)?$/.test(text) || text === '' || text === '.') return null;

  const [whole, fraction = ''] = text.split('.');
  const digits = meta(code).minor;
  // Take one extra digit so 1.005 rounds up rather than truncating to 1.00.
  const padded = (fraction + '0'.repeat(digits + 1)).slice(0, digits + 1);
  const scaled = Number(whole || '0') * factor(code) + Number(padded) / 10;
  const value = roundHalfUp(scaled);
  return negative ? -value : value;
}

/** Minor units back to a plain number, for charts and exports. */
export function toMajor(minor, code = DEFAULT_CURRENCY) {
  return (minor ?? 0) / factor(code);
}

export const add = (a, b) => (a ?? 0) + (b ?? 0);
export const sub = (a, b) => (a ?? 0) - (b ?? 0);
export const negate = (a) => -(a ?? 0);
export const abs = (a) => Math.abs(a ?? 0);
/**
 * Add money, skipping anything that is not a number to add.
 *
 * The `?? 0` this replaced treated a missing amount as zero and a *string*
 * amount as a string: `t + 'twenty thousand'` concatenates, so one hand-edited
 * row in the household's own Sheet turned a month's spending into
 * `'2500000twenty thousand'` — formatted, shown, and not an error anywhere.
 *
 * `domain/amounts.js` was written about exactly that string and says a total
 * "adds only finite numbers". That was true of one private helper in
 * `domain/categorise.js` and of nothing else: `totals()`, `byCategory()` and
 * every other caller here still concatenated, while the sentence beside them
 * told the household the row was **not** in these totals. A disclosure that is
 * false is worse than none, because it is believed.
 *
 * Skipping is safe to do quietly *only* because it is not quiet:
 * `unreadableAmounts()` counts these rows and `describeUnreadable()` is what
 * the screens say. Nothing here guesses at what the amount was meant to be —
 * the row is in the household's spreadsheet and they are the only ones who
 * know.
 */
/**
 * The part of a value that can be added to money.
 *
 * `sum` is not the only place money is added up — sixteen functions across the
 * domain keep their own running totals in a `Map` or a `reduce`, and each
 * spelled the guard as `?? 0`, which admits a string. Fixing `sum` alone left
 * `byCategory` still reporting `'2500000twenty thousand'` while the total
 * beside it had been corrected: two figures about one month, disagreeing on
 * one screen.
 *
 * Zero, not null: the caller is building a total, and `null` would spread
 * through it and make the whole figure unavailable because one row could not
 * be read. The row is not silently dropped — `unreadableAmounts()` counts
 * exactly these and `describeUnreadable()` is what the screen says.
 */
export const addable = (value) => (Number.isFinite(value) ? value : 0);

/** Add a list of money figures, skipping anything that is not one. */
export const sum = (list) => list.reduce((t, n) => t + addable(n), 0);

/**
 * Round a money figure that was worked out some other way.
 *
 * The three helpers below cover multiply, divide and percent. This is for the
 * arithmetic they do not express — compound interest, a median, a running
 * balance — where the result is money and the rounding rule still has to be
 * this module's rather than `Math.round`'s.
 *
 * It exists because the rule above was stated and not followed. `roundHalfUp`
 * was private, the three helpers that used it had no callers at all, and
 * sixty-seven `Math.round` calls across the domain did money arithmetic with
 * the rounding this module exists to avoid — so a debit and a credit of the
 * same size did **not** round to the same size anywhere in the application.
 */
export function roundMoney(value) {
  return Number.isFinite(value) ? roundHalfUp(value) : 0;
}

/** Multiply by a plain rate (quantity, tax rate, unit price). */
export function mul(minor, rate) {
  return roundHalfUp((minor ?? 0) * rate);
}

export function divide(minor, divisor) {
  if (!divisor) return 0;
  return roundHalfUp((minor ?? 0) / divisor);
}

export function percent(minor, pct) {
  return roundHalfUp(((minor ?? 0) * pct) / 100);
}

/**
 * Split `minor` into `parts` whole minor units that sum back to `minor`
 * exactly. Weights are optional. The remainder goes one unit at a time to the
 * largest fractional shortfall, so a ₹100 bill split three ways is
 * 33.34 / 33.33 / 33.33 and not 33.33 / 33.33 / 33.33 with a paisa lost.
 */
export function allocate(minor, parts, weights = null) {
  const n = weights ? weights.length : parts;
  if (n <= 0) return [];
  const w = weights ?? Array(n).fill(1);
  const totalWeight = w.reduce((t, x) => t + x, 0);
  if (totalWeight === 0) return Array(n).fill(0);

  const exact = w.map((x) => ((minor ?? 0) * x) / totalWeight);
  const floors = exact.map((x) => (x < 0 ? Math.ceil(x) : Math.floor(x)));
  let remainder = (minor ?? 0) - floors.reduce((t, x) => t + x, 0);

  const order = exact
    .map((x, i) => ({ i, frac: Math.abs(x - floors[i]) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const step = remainder < 0 ? -1 : 1;
  for (let k = 0; remainder !== 0; k++) {
    floors[order[k % n].i] += step;
    remainder -= step;
  }
  return floors;
}

/**
 * Compact Indian-style abbreviation: 1_50_00_000 paise → "₹1.5 L".
 * Dashboards need the magnitude at a glance; the exact figure is one tap away.
 */
export function formatCompact(minor, code = DEFAULT_CURRENCY) {
  const { symbol } = meta(code);
  const value = toMajor(minor, code);
  // Same reason as `format`, and reached first: a dashboard tile abbreviates
  // before it formats, so the guard below it would never have been asked.
  if (!Number.isFinite(value)) return String(minor);
  const sign = value < 0 ? '-' : '';
  const n = Math.abs(value);

  const scale = (divisor, suffix) => {
    const scaled = n / divisor;
    const text = scaled >= 100 ? scaled.toFixed(0)
      : scaled >= 10 ? scaled.toFixed(1)
        : scaled.toFixed(2);
    return `${sign}${symbol}${text.replace(/\.?0+$/, '')} ${suffix}`;
  };

  if (code === 'INR') {
    if (n >= 1e7) return scale(1e7, 'Cr');
    if (n >= 1e5) return scale(1e5, 'L');
    if (n >= 1e3) return scale(1e3, 'K');
  } else {
    if (n >= 1e9) return scale(1e9, 'B');
    if (n >= 1e6) return scale(1e6, 'M');
    if (n >= 1e3) return scale(1e3, 'K');
  }
  return format(minor, code, { decimals: n % 1 === 0 ? 0 : 2 });
}

const formatters = new Map();

export function format(minor, code = DEFAULT_CURRENCY, { decimals, sign = false } = {}) {
  // An amount that is not a number is printed as what it says.
  //
  // `Intl.NumberFormat` renders NaN as the three characters `NaN`, so a row a
  // household hand-edited to `twenty thousand` in their own sheet came back to
  // them as `₹NaN` — worse than a wrong figure, because nothing on the screen
  // says which row it was or that their sheet is where the fix is. The text
  // they typed says both.
  //
  // This was fixed four times before it was fixed here: once for CSV, once for
  // the spreadsheet cell, once for the PDF, once for the money component. Each
  // of those is a route out of this function, and each guard was written where
  // the bug was seen rather than where it came from.
  //
  // `toMajor` sends null and undefined to zero, deliberately and separately: a
  // blank cell means zero. Only a value that is present and unreadable reaches
  // this line, so `String(minor)` is always the household's own text.
  const major = toMajor(minor, code);
  if (!Number.isFinite(major)) return String(minor);

  const { locale, minor: digits } = meta(code);
  const places = decimals ?? digits;
  const key = `${code}:${places}:${sign}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: places,
      maximumFractionDigits: places,
      signDisplay: sign ? 'exceptZero' : 'auto',
    });
    formatters.set(key, fmt);
  }
  return fmt.format(toMajor(minor, code));
}

/** Percentage change, in basis-point precision, guarding a zero base. */
export function changePercent(from, to) {
  if (!from) return to ? null : 0; // null means "no meaningful base"
  return Math.round(((to - from) / Math.abs(from)) * 10_000) / 100;
}
