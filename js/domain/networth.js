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
import { accountBalances } from './finance.js';
import { holdingValue } from './portfolio.js';

const CREDIT_KINDS = new Set(['credit card', 'loan']);

/**
 * @param {{accounts, transactions, holdings, properties, vehicles, loans}} data
 * @returns {{total, assets, liabilities, breakdown, staleValuations}}
 */
export function netWorth(data) {
  const {
    accounts = [], transactions = [], holdings = [],
    properties = [], vehicles = [], loans = [],
  } = data;

  const live = (rows) => rows.filter((r) => !r.deletedAt);

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
    data.accounts.filter((a) => !a.deletedAt),
    data.transactions.filter((t) => !t.deletedAt),
  );

  for (const account of withBalances) {
    if (account.archived || account.includeInNetWorth === false) continue;
    const target = bucket(account.holder);
    if (account.kind === 'credit card') target.liabilities += Math.max(0, -account.balance);
    else target.assets += account.balance;
  }

  for (const holding of data.holdings.filter((h) => !h.deletedAt && h.active !== false)) {
    bucket(holding.owner).assets += holdingValue(holding);
  }
  for (const property of data.properties.filter((p) => !p.deletedAt)) {
    bucket(property.owner).assets += property.currentValue || property.purchasePrice || 0;
  }
  for (const loan of data.loans.filter((l) => !l.deletedAt)) {
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
