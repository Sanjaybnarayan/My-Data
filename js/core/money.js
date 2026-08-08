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
export const sum = (list) => list.reduce((t, n) => t + (n ?? 0), 0);

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
