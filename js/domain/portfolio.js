/**
 * Investment analytics.
 *
 * The number that matters in a household portfolio is not "how much did it
 * grow" but "what did it return, given that money went in and came out at
 * different times". That is XIRR, and it is the only interesting piece of
 * arithmetic in this file — the rest is addition.
 *
 * All amounts in minor units.
 */

import { sum, roundMoney, addable } from '../core/money.js';
import { settled } from '../data/integrity.js';
import { today, daysBetween, daysUntil } from '../core/dates.js';

/* --------------------------------------------------------------- holdings */

export function holdingValue(holding) {
  // `!= null` rather than truthiness: a currentValue of zero means the
  // holding is worth nothing, not that no value has been set. A stock that
  // went bankrupt records 0 explicitly; falling through to units × cost
  // would report a positive value for something the household knows is gone.
  if (holding.currentValue != null) return holding.currentValue;
  if (holding.units && holding.averageCost) return roundMoney(holding.units * holding.averageCost);
  return holding.invested ?? 0;
}

export function holdingGain(holding) {
  const invested = addable(holding.invested);
  const value = holdingValue(holding);
  return {
    invested,
    value,
    gain: value - invested,
    gainPercent: invested ? Math.round(((value - invested) / invested) * 10_000) / 100 : null,
  };
}

/** Asset classes, so twelve mutual funds do not read as twelve asset types. */
const CLASS_OF = {
  stock: 'Equity', ETF: 'Equity', 'mutual fund': 'Equity', REIT: 'Real estate',
  gold: 'Commodity', silver: 'Commodity',
  'fixed deposit': 'Fixed income', 'recurring deposit': 'Fixed income',
  bond: 'Fixed income', PPF: 'Fixed income', EPF: 'Retirement', NPS: 'Retirement',
  crypto: 'Alternative', business: 'Business', other: 'Other',
};

export function assetClass(kind) {
  return CLASS_OF[kind] ?? 'Other';
}

export function allocation(holdings) {
  const buckets = new Map();
  for (const holding of holdings) {
    if (!settled(holding) || holding.active === false) continue;
    const key = assetClass(holding.kind);
    buckets.set(key, (buckets.get(key) ?? 0) + holdingValue(holding));
  }
  const total = sum([...buckets.values()]);
  return [...buckets]
    .map(([label, value]) => ({
      label,
      value,
      share: total ? Math.round((value / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);
}

export function portfolioSummary(holdings) {
  const live = holdings.filter((h) => settled(h) && h.active !== false);
  const invested = sum(live.map((h) => h.invested ?? 0));
  const value = sum(live.map(holdingValue));
  return {
    count: live.length,
    invested,
    value,
    gain: value - invested,
    gainPercent: invested ? Math.round(((value - invested) / invested) * 10_000) / 100 : null,
  };
}

/* ------------------------------------------------------------------- XIRR */

/**
 * Cash flows for a holding, in the sign convention XIRR needs: money leaving
 * the household is negative, money returning is positive. The current value is
 * a final positive flow today, because an unsold holding is money you could
 * have back.
 *
 * ## Why the closing value can be passed in
 *
 * That final flow decides the rate almost single-handedly, so a stale
 * `currentValue` does not make the answer slightly wrong — it makes it
 * meaningless. A fixed deposit whose value was typed once and never revisited
 * has a closing flow equal to its opening one, and XIRR dutifully reports
 * **0% on a deposit paying 7.1%**.
 *
 * `value` lets a caller supply the closing figure it has better grounds for —
 * in practice the accrual estimate, which the Investments screen already shows
 * and labels beside the stored figure. Nothing is substituted silently: the
 * caller that passes it also marks the row as an estimate.
 */
export function cashFlows(holding, transactions, { asOf = today(), value: closing = null } = {}) {
  const flows = transactions
    .filter((t) => t.holding === holding.id && settled(t))
    .map((t) => {
      const amount = addable(t.amount);
      const outward = t.kind === 'buy' || t.kind === 'contribution' || t.kind === 'charge';
      return { date: t.date, amount: outward ? -amount : amount };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  // `?? ` rather than `||`: a caller that has worked out the closing value is
  // zero has said something, and falling back to the stored figure would
  // overrule them.
  const value = closing ?? holdingValue(holding);
  if (value) flows.push({ date: asOf, amount: value });
  return flows;
}

/**
 * How many days the flows span, first to last.
 *
 * Exported because whether a rate may be *annualised* is a question about the
 * flows rather than about the solver, and the caller is the one that knows
 * what it is going to claim. Zero for fewer than two flows.
 */
export function spanDays(flows) {
  if (flows.length < 2) return 0;
  const dates = flows.map((f) => f.date).sort();
  const first = Date.parse(dates[0]);
  const last = Date.parse(dates[dates.length - 1]);
  if (Number.isNaN(first) || Number.isNaN(last)) return 0;
  return Math.round((last - first) / 86_400_000);
}

/** A year, as the shortest span a rate may honestly be annualised over. */
export const YEAR = 365;

/**
 * Internal rate of return for irregularly-timed flows, as an annual
 * percentage.
 *
 * Newton–Raphson from a 10% guess, falling back to bisection when the
 * derivative sends it somewhere useless. The fallback is not defensive
 * padding: Newton diverges reliably on a portfolio that lost most of its
 * value, which is exactly when somebody wants the number.
 *
 * Returns null when there is nothing to solve — fewer than two flows, or all
 * flows the same sign, where no rate exists at all.
 */
export function xirr(flows, { guess = 0.1, tolerance = 1e-7, maxIterations = 100 } = {}) {
  if (flows.length < 2) return null;
  const hasPositive = flows.some((f) => f.amount > 0);
  const hasNegative = flows.some((f) => f.amount < 0);
  if (!hasPositive || !hasNegative) return null;

  const start = flows[0].date;
  const years = flows.map((f) => daysBetween(start, f.date) / 365);
  const amounts = flows.map((f) => f.amount);

  const npv = (rate) => {
    let total = 0;
    for (let i = 0; i < amounts.length; i++) {
      // A rate at or below -100% makes the discount factor undefined; the
      // caller gets null rather than NaN leaking into a report.
      const base = 1 + rate;
      if (base <= 0) return NaN;
      total += amounts[i] / base ** years[i];
    }
    return total;
  };

  const derivative = (rate) => {
    let total = 0;
    for (let i = 0; i < amounts.length; i++) {
      const base = 1 + rate;
      if (base <= 0) return NaN;
      total -= (years[i] * amounts[i]) / base ** (years[i] + 1);
    }
    return total;
  };

  let rate = guess;
  for (let i = 0; i < maxIterations; i++) {
    const value = npv(rate);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) < tolerance) return round(rate);
    const slope = derivative(rate);
    if (!Number.isFinite(slope) || Math.abs(slope) < 1e-12) break;
    const next = rate - value / slope;
    if (!Number.isFinite(next) || next <= -0.9999) break;
    if (Math.abs(next - rate) < tolerance) return round(next);
    rate = next;
  }

  return round(bisect(npv));
}

/** Bracket the sign change between -99% and +1000%, then halve. */
function bisect(npv, low = -0.9999, high = 10) {
  let lowValue = npv(low);
  let highValue = npv(high);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue)) return null;
  if (lowValue * highValue > 0) return null; // no root in range

  for (let i = 0; i < 200; i++) {
    const mid = (low + high) / 2;
    const midValue = npv(mid);
    if (!Number.isFinite(midValue)) return null;
    if (Math.abs(midValue) < 1e-9 || (high - low) / 2 < 1e-9) return mid;
    if (lowValue * midValue < 0) {
      high = mid;
      highValue = midValue;
    } else {
      low = mid;
      lowValue = midValue;
    }
  }
  return (low + high) / 2;
}

function round(rate) {
  return rate === null ? null : Math.round(rate * 10_000) / 100;
}

/** Simple annualised return, for a holding with no transaction history. */
export function cagr(invested, value, years) {
  if (!invested || !value || years <= 0) return null;
  if (value <= 0) return null;
  return Math.round(((value / invested) ** (1 / years) - 1) * 10_000) / 100;
}

/* -------------------------------------------------------------- dividends */

export function dividendIncome(transactions, { from, to } = {}) {
  return sum(transactions
    .filter(settled)
    .filter((t) => t.kind === 'dividend' || t.kind === 'interest')
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .map((t) => t.amount ?? 0));
}

/** Deposits and bonds coming due, so a maturity is not discovered late. */
export function maturingSoon(holdings, days = 90) {
  return holdings
    .filter((h) => settled(h) && h.maturesOn)
    .map((h) => ({ ...h, daysAway: daysUntil(h.maturesOn) }))
    .filter((h) => h.daysAway >= 0 && h.daysAway <= days)
    .sort((a, b) => a.daysAway - b.daysAway);
}
