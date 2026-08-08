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

import { sum } from '../core/money.js';
import { today, daysBetween, daysUntil } from '../core/dates.js';

/* --------------------------------------------------------------- holdings */

export function holdingValue(holding) {
  if (holding.currentValue) return holding.currentValue;
  if (holding.units && holding.averageCost) return Math.round(holding.units * holding.averageCost);
  return holding.invested ?? 0;
}

export function holdingGain(holding) {
  const invested = holding.invested ?? 0;
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
    if (holding.deletedAt || holding.active === false) continue;
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
  const live = holdings.filter((h) => !h.deletedAt && h.active !== false);
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
 */
export function cashFlows(holding, transactions, { asOf = today() } = {}) {
  const flows = transactions
    .filter((t) => t.holding === holding.id && !t.deletedAt)
    .map((t) => {
      const amount = t.amount ?? 0;
      const outward = t.kind === 'buy' || t.kind === 'contribution' || t.kind === 'charge';
      return { date: t.date, amount: outward ? -amount : amount };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const value = holdingValue(holding);
  if (value) flows.push({ date: asOf, amount: value });
  return flows;
}

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
    .filter((t) => !t.deletedAt)
    .filter((t) => t.kind === 'dividend' || t.kind === 'interest')
    .filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .map((t) => t.amount ?? 0));
}

/** Deposits and bonds coming due, so a maturity is not discovered late. */
export function maturingSoon(holdings, days = 90) {
  return holdings
    .filter((h) => !h.deletedAt && h.maturesOn)
    .map((h) => ({ ...h, daysAway: daysUntil(h.maturesOn) }))
    .filter((h) => h.daysAway >= 0 && h.daysAway <= days)
    .sort((a, b) => a.daysAway - b.daysAway);
}
