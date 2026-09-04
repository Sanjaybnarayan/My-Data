/**
 * Goals, read against the balances that fund them.
 *
 * The assembly is here rather than in the screen for the reason this project
 * has now given several times: an assembly in a screen can only be exercised
 * through a browser, and this one decides whether a household is told it has
 * twice the money it has.
 *
 * `assembleGoals` is pure — records in, view model out — so the arithmetic is
 * tested against a real in-memory database with no DOM near it.
 */

import { Service, TRANSACTION_LIMIT, HOLDING_LIMIT } from './service.js';
import { reviewGoals } from '../domain/goals.js';
import { accountBalances } from '../domain/finance.js';
import { typicalDailySpend } from '../domain/runway.js';
import { holdingValue } from '../domain/portfolio.js';

/** @type {Record<string, import('./service.js').Load>} */
export const GOALS_LOAD = Object.freeze({
  goals: ['goal', { decrypt: false, limit: 500 }],
  accounts: ['account', { decrypt: false }],
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  holdings: ['holding', { decrypt: false, limit: HOLDING_LIMIT }],
});

/**
 * @param {Record<string, object[]>} data as `GOALS_LOAD` yields
 * @param {{clock?: () => number}} [options]
 */
export function assembleGoals(data, { clock = Date.now } = {}) {
  const {
    goals = [], accounts = [], transactions = [], holdings = [],
  } = data ?? {};

  const balances = new Map(
    accountBalances(accounts, transactions).map((a) => [a.id, a.balance]),
  );
  const values = new Map(holdings.map((h) => [h.id, holdingValue(h)]));

  /**
   * A month of ordinary spending, for an emergency fund's target.
   *
   * `typicalDailySpend` reports zero and a reason when there is not enough
   * history, and that zero is passed straight through rather than replaced
   * with an average of what little there is. A fund sized against a made-up
   * month would be declared complete.
   */
  const spend = typicalDailySpend(transactions, { clock });
  const monthlySpend = spend.perDay * 30;

  const rows = reviewGoals(goals, {
    balanceOf: (id) => balances.get(id) ?? 0,
    holdingValueOf: (id) => values.get(id) ?? 0,
    monthlySpend,
    clock: () => new Date(typeof clock === 'function' ? clock() : clock)
      .toISOString().slice(0, 10),
  });

  return {
    rows,
    any: rows.length > 0,
    monthlySpend,
    spendHistory: spend.why,
    /** Goals whose funding another goal also claims — shown above the rest. */
    contested: rows.filter((row) => row.why?.includes('the same money')),
  };
}

export class GoalsService extends Service {
  /** @param {{clock?: () => number}} [options] */
  async review({ clock = Date.now } = {}) {
    return assembleGoals(await this.load(GOALS_LOAD), { clock });
  }
}
