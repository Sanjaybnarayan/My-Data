/**
 * Family net worth.
 *
 * Assets minus liabilities, from records that already exist elsewhere in the
 * app. Nothing is entered twice, which is the point: a net worth that has to
 * be maintained by hand is a net worth that is wrong within a month.
 *
 * What counts, and what does not:
 *
 *   - Bank and cash balances, computed from transactions, not typed in.
 *   - Investments at their current value where one is recorded, at cost
 *     otherwise — and the difference is reported, because a portfolio valued
 *     entirely at cost is not a valuation.
 *   - Property at market value where recorded, purchase price otherwise.
 *   - Vehicles only when a current value is set. A car with no valuation is
 *     left out rather than counted at what it cost five years ago.
 *   - Loans at their outstanding balance.
 *   - Credit-card balances, as a liability.
 *
 * Insurance sum assured is deliberately excluded. It is not an asset; it is a
 * contingent payout, and adding it inflates the figure by an amount that only
 * exists if somebody dies.
 */

import { sum } from '../core/money.js';
import { settled } from '../data/integrity.js';
import { accountBalances } from './finance.js';
import { holdingValue } from './portfolio.js';
import { monthsBetween, today } from '../core/dates.js';
import { t } from '../core/locale.js';

const CREDIT_KINDS = new Set(['credit card', 'loan']);

/**
 * How old a valuation may be before this says so.
 *
 * `staleValuations` used to mean one thing only: **no `currentValue` at all**.
 * A holding valued at cost, a property falling back to its purchase price, a
 * vehicle with no figure. All three are honest gaps, and all three were
 * reported.
 *
 * What was not reported is the opposite case, and it is the more misleading of
 * the two. A property carrying a `currentValue` from three years ago
 * contributed its full figure to net worth and was flagged as nothing, while
 * the same property with the figure deleted was flagged. The unknown was
 * surfaced and the confidently-stale was silent — and a precise-looking number
 * that is three years old misleads a household further than a missing one,
 * because a missing one asks to be filled in.
 *
 * `valuedOn` was already recorded on both holdings and properties, and already
 * read by `domain/accrual.js` to compound a deposit from the day its figure
 * was true. Nothing judged its age.
 *
 * Twelve months, because that is the cadence at which a household actually
 * revisits what a flat or a fund is worth, and because a figure that has been
 * through a full year of whatever moves it is no longer evidence of anything.
 * The number is a judgement and is named here rather than buried; the *age* is
 * carried on each row, so a household can disagree with the threshold and
 * still see what it is disagreeing about.
 *
 * This changes no figure. It adds a sentence beside one.
 */
export const STALE_AFTER_MONTHS = 12;

/**
 * @param {{accounts, transactions, holdings, properties, vehicles, loans}} data
 * @param {{clock?: () => number}} [options]
 * @returns {{total, assets, liabilities, breakdown, staleValuations}}
 */
export function netWorth(data, { clock = Date.now } = {}) {
  const {
    accounts = [], transactions = [], holdings = [],
    properties = [], vehicles = [], loans = [],
  } = data;

  const live = (rows) => rows.filter(settled);

  /**
   * Rows whose valuation is real but old, with the age said on each.
   *
   * Only rows that *have* a figure: one without is already reported above for
   * the better reason, and saying both about the same row would be two
   * findings where there is one.
   */
  const aged = (rows, entity, nameOf) => live(rows)
    .filter((r) => r.currentValue && r.valuedOn)
    .map((r) => ({ row: r, months: monthsBetween(r.valuedOn, today(clock)) }))
    .filter(({ months }) => Number.isFinite(months) && months >= STALE_AFTER_MONTHS)
    .map(({ row, months }) => ({
      entity,
      id: row.id,
      name: nameOf(row),
      reason: t(months === 1 ? 'networth.aged.one' : 'networth.aged.many', { months }),
      months,
    }));

  const withBalances = accountBalances(live(accounts), live(transactions));
  const counted = withBalances.filter((a) => a.includeInNetWorth !== false && !a.archived);

  const cash = sum(counted
    .filter((a) => !CREDIT_KINDS.has(a.kind))
    .map((a) => a.balance));

  // A credit card in credit is not an asset worth counting; a card in debt is
  // a real liability. Only the negative side is taken.
  const cardDebt = sum(counted
    .filter((a) => a.kind === 'credit card')
    .map((a) => Math.max(0, -a.balance)));

  const activeHoldings = live(holdings).filter((h) => h.active !== false);
  const investments = sum(activeHoldings.map(holdingValue));

  const propertyValue = sum(live(properties)
    .map((p) => p.currentValue || p.purchasePrice || 0));

  const vehicleValue = sum(live(vehicles)
    .map((v) => v.currentValue || 0));

  const loanOutstanding = sum(live(loans)
    .map((l) => l.outstanding ?? 0));

  const assets = cash + investments + propertyValue + vehicleValue;
  const liabilities = loanOutstanding + cardDebt;

  return {
    total: assets - liabilities,
    assets,
    liabilities,
    breakdown: [
      { label: 'Cash & bank', value: cash, kind: 'asset' },
      { label: 'Investments', value: investments, kind: 'asset' },
      { label: 'Property', value: propertyValue, kind: 'asset' },
      { label: 'Vehicles', value: vehicleValue, kind: 'asset' },
      { label: 'Loans', value: -loanOutstanding, kind: 'liability' },
      { label: 'Card debt', value: -cardDebt, kind: 'liability' },
    ].filter((row) => row.value !== 0),

    // Surfaced rather than hidden: a figure resting on stale numbers should
    // say so next to itself.
    staleValuations: [
      ...activeHoldings
        .filter((h) => !h.currentValue && (h.invested ?? 0) > 0)
        .map((h) => ({ entity: 'holding', id: h.id, name: h.name, reason: 'valued at cost' })),
      ...live(properties)
        .filter((p) => !p.currentValue && p.purchasePrice)
        .map((p) => ({ entity: 'property', id: p.id, name: p.name, reason: 'valued at purchase price' })),
      ...live(vehicles)
        .filter((v) => !v.currentValue)
        .map((v) => ({ entity: 'vehicle', id: v.id, name: v.registration, reason: 'not valued — excluded' })),

      // A vehicle carries no `valuedOn`, so its figure cannot be aged and is
      // not pretended to be. Said here rather than left as an omission a
      // reader has to notice.
      ...aged(holdings, 'holding', (h) => h.name),
      ...aged(properties, 'property', (p) => p.name),
    ],
  };
}

/**
 * Net worth per owner, where records name one. Anything unattributed is
 * reported as such rather than silently allocated to the head of the family.
 */
export function netWorthByPerson(data, people) {
  const byPerson = new Map(people.map((p) => [p.id, { person: p, assets: 0, liabilities: 0 }]));
  const unattributed = { person: null, assets: 0, liabilities: 0 };

  const bucket = (id) => byPerson.get(id) ?? unattributed;

  const withBalances = accountBalances(
    data.accounts.filter(settled),
    data.transactions.filter(settled),
  );

  for (const account of withBalances) {
    if (account.archived || account.includeInNetWorth === false) continue;
    const target = bucket(account.holder);
    if (account.kind === 'credit card') target.liabilities += Math.max(0, -account.balance);
    else target.assets += account.balance;
  }

  for (const holding of data.holdings.filter((h) => settled(h) && h.active !== false)) {
    bucket(holding.owner).assets += holdingValue(holding);
  }
  for (const property of data.properties.filter(settled)) {
    bucket(property.owner).assets += property.currentValue || property.purchasePrice || 0;
  }
  for (const loan of data.loans.filter(settled)) {
    bucket(loan.borrower).liabilities += loan.outstanding ?? 0;
  }

  const rows = [...byPerson.values()].map((row) => ({
    ...row,
    total: row.assets - row.liabilities,
  }));

  if (unattributed.assets || unattributed.liabilities) {
    rows.push({ ...unattributed, total: unattributed.assets - unattributed.liabilities });
  }

  return rows.sort((a, b) => b.total - a.total);
}
