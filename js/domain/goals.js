/**
 * How far along is a goal, and can that even be said?
 *
 * ## A target with no source is a note
 *
 * The easy version of this feature is a target amount, a "saved so far" box,
 * and a bar dividing one by the other. That bar agrees with itself no matter
 * what the household's accounts actually hold, which makes it a decoration
 * with a percentage on it.
 *
 * So a goal names the accounts and holdings that fund it, and progress is read
 * from those balances. The figure is then a fact about the records, and rule
 * 57 — every figure must be explainable — is satisfiable: the sources are
 * listed under the number.
 *
 * ## The same rupee must not fund two goals
 *
 * Nothing stops a household naming one savings account under both "house
 * deposit" and "emergency fund". Reporting both as fully funded from the same
 * ₹5,00,000 would tell them they have twice the money they have — the same
 * class of error as counting an internal transfer as income, and the one this
 * project refuses hardest.
 *
 * A shared source is not an error to prevent, though. A household mid-decision
 * about which goal that money is for is in a perfectly ordinary state. So the
 * overlap is **reported and the progress withheld** for every goal involved,
 * naming the others, until they say. `domain/staffpay.js` does the same thing
 * for a wage it cannot check: say why, rather than produce a number that looks
 * authoritative.
 *
 * ## What is not offered
 *
 * **"On track" is not computed.** It would need to know what has been put
 * aside over time, and this application stores transactions rather than a
 * history of balances — a contribution rate would have to be inferred from
 * transfers into the funding accounts, and inferring it wrong produces a
 * confident date. What *is* offered is arithmetic that cannot be wrong: the
 * amount still needed, divided by the months left. That says what reaching the
 * target would take, and claims nothing about whether it will happen.
 */

import { addable } from '../core/money.js';
import { monthsBetween, today } from '../core/dates.js';

export const STATUS = Object.freeze({
  /** Funded to target, or marked reached. */
  REACHED: 'reached',
  /** Progressing, target date still ahead or unset. */
  OPEN: 'open',
  /** The date has passed and the target has not been met. */
  OVERDUE: 'overdue',
  /** Nothing can be said, and `why` says what is missing. */
  UNKNOWN: 'unknown',
});

/**
 * Why a goal's progress cannot be reported.
 *
 * Returns null when it can. Each reason names the thing a household would have
 * to do, because "unknown" on its own is not information.
 */
/**
 * @param {object} goal
 * @param {{target?: number|null, contested?: string[]}} [options]
 */
export function whyNotMeasurable(goal, { target = null, contested = [] } = {}) {
  if (!goal?.accounts?.length && !goal?.holdings?.length) {
    return 'nothing is named as funding it, so there is no balance to read';
  }
  if (contested.length) {
    const names = contested.join(', ');
    return `its funding is also claimed by ${names}, and the same money cannot `
      + 'fund both — say which one owns the account to see either figure';
  }
  if (!(target > 0)) {
    return goal?.kind === 'emergency fund'
      ? 'an emergency fund is a number of months of spending, and there is not '
        + 'enough recorded spending yet to say what a month costs'
      : 'no target amount is set, so there is nothing to be a fraction of';
  }
  return null;
}

/**
 * An emergency fund's target: months of spending, in rupees.
 *
 * Returns null rather than a guess when spending is not known. A fund sized
 * against a made-up monthly figure is worse than one with no target, because
 * it will be declared complete.
 */
export function emergencyTarget(goal, monthlySpend) {
  const months = Number(goal?.targetMonths ?? 0);
  if (!(months > 0) || !(monthlySpend > 0)) return null;
  return months * monthlySpend;
}

/** The target this goal is measured against, whichever way it was set. */
export function targetOf(goal, { monthlySpend = 0 } = {}) {
  if (goal?.kind === 'emergency fund' && !(Number(goal.targetAmount) > 0)) {
    return emergencyTarget(goal, monthlySpend);
  }
  const typed = Number(goal?.targetAmount ?? 0);
  return typed > 0 ? typed : null;
}

/**
 * Which sources more than one goal claims.
 *
 * Keyed by goal id, holding the *names* of the other goals claiming any of the
 * same accounts or holdings — names rather than ids because the sentence a
 * household reads has to say which goal, and an id says nothing.
 */
export function contestedSources(goals = []) {
  const claims = new Map();
  for (const goal of goals) {
    // Deduplicated per goal: a form that let somebody pick the same account
    // twice would otherwise put a goal in conflict with itself, and the
    // sentence it produced would name the goal you were already reading.
    for (const id of new Set([...(goal.accounts ?? []), ...(goal.holdings ?? [])])) {
      if (!claims.has(id)) claims.set(id, []);
      claims.get(id).push(goal);
    }
  }

  const contested = new Map();
  for (const claimants of claims.values()) {
    if (claimants.length < 2) continue;
    for (const goal of claimants) {
      const others = claimants
        .filter((other) => other.id !== goal.id)
        .map((other) => other.name);
      const set = contested.get(goal.id) ?? new Set();
      for (const name of others) set.add(name);
      contested.set(goal.id, set);
    }
  }

  return new Map([...contested].map(([id, set]) => [id, [...set]]));
}

/**
 * One goal, read against the balances that fund it.
 *
 * `balanceOf` and `holdingValueOf` are passed in rather than computed here, so
 * this stays a pure function over whatever the caller has already loaded — and
 * so a test can drive it without a database.
 *
 * The second is not called `valueOf`, which reads better and cannot be used:
 * every object literal inherits `Object.prototype.valueOf`, so an option by
 * that name conflicts with the one every object already has.
 */
/**
 * @typedef {{
 *   balanceOf?: (id: string) => number,
 *   holdingValueOf?: (id: string) => number,
 *   monthlySpend?: number,
 *   contested?: string[],
 *   clock?: () => string,
 * }} ProgressOptions
 */

/**
 * @param {object} goal
 * @param {ProgressOptions} [options]
 */
export function progressOf(goal, {
  balanceOf = (id) => 0,
  holdingValueOf = (id) => 0,
  monthlySpend = 0,
  contested = [],
  clock = () => today(),
} = /** @type {ProgressOptions} */ ({})) {
  const target = targetOf(goal, { monthlySpend });
  const why = whyNotMeasurable(goal, { target, contested });

  const sources = [
    ...(goal.accounts ?? []).map((id) => ({ kind: 'account', id, amount: balanceOf(id) })),
    ...(goal.holdings ?? []).map((id) => ({ kind: 'holding', id, amount: holdingValueOf(id) })),
  ];
  const funded = sources.reduce((total, source) => total + addable(source.amount), 0);

  if (why) {
    return {
      goal, status: STATUS.UNKNOWN, why, target, funded: null, percent: null,
      remaining: null, sources, monthlyNeeded: null, monthsLeft: null,
    };
  }

  const remaining = Math.max(0, target - funded);
  const reached = Boolean(goal.achievedOn) || funded >= target;
  const now = typeof clock === 'function' ? clock() : clock;
  const monthsLeft = goal.targetDate ? monthsBetween(now, goal.targetDate) : null;
  const overdue = !reached && monthsLeft !== null && monthsLeft < 0;

  return {
    goal,
    status: reached ? STATUS.REACHED : overdue ? STATUS.OVERDUE : STATUS.OPEN,
    why: null,
    target,
    funded,
    percent: Math.min(100, Math.round((funded / target) * 100)),
    remaining,
    sources,
    monthsLeft,
    /**
     * What reaching the target by the date would take, per month.
     *
     * Arithmetic, not a projection: it divides what is left by the months
     * left. No claim is made that the household will or will not manage it,
     * because nothing here knows what they put aside last month.
     *
     * Null once the date has passed — dividing by a negative number of months
     * produces a negative "needed", which reads as though the goal funds
     * itself.
     */
    monthlyNeeded: !reached && monthsLeft !== null && monthsLeft > 0
      ? Math.ceil(remaining / monthsLeft)
      : null,
  };
}

/** Every goal, worst news first: unknown, then overdue, then open, then reached. */
const ORDER = [STATUS.UNKNOWN, STATUS.OVERDUE, STATUS.OPEN, STATUS.REACHED];

/**
 * @param {object[]} goals
 * @param {ProgressOptions} [options]
 */
export function reviewGoals(goals = [], options = /** @type {ProgressOptions} */ ({})) {
  const contested = contestedSources(goals);
  const rows = goals.map((goal) => progressOf(goal, {
    ...options,
    contested: contested.get(goal.id) ?? [],
  }));
  return rows.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
}

/** The sentence under a goal. */
export function describeGoal(row, money = (n) => String(n)) {
  if (row.status === STATUS.UNKNOWN) return `Cannot be measured — ${row.why}.`;
  if (row.status === STATUS.REACHED) return `Reached — ${money(row.funded)} of ${money(row.target)}.`;

  const parts = [`${money(row.funded)} of ${money(row.target)}`, `${row.percent}%`];
  if (row.status === STATUS.OVERDUE) {
    parts.push(`${money(row.remaining)} short, and the date has passed`);
  } else if (row.monthlyNeeded !== null) {
    parts.push(`${money(row.monthlyNeeded)} a month to reach it by then`);
  } else {
    parts.push(`${money(row.remaining)} to go`);
  }
  return parts.join(' · ');
}
