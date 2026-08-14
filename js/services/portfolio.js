/**
 * The portfolio question, answered as data.
 *
 * Everything here was previously assembled inline inside `modules/investments.js`
 * between a `Promise.all` of eight `db.repo(...)` calls and a tree of DOM
 * nodes. The arithmetic was already extracted into `domain/portfolio.js` as
 * pure functions and well tested; what had no home was the part that decides
 * *which records the answer needs* and *how they combine* — and that part could
 * only be exercised by opening a browser.
 *
 * It matters more than it sounds. Two of these numbers are easy to get subtly
 * wrong in ways a rendering test cannot see:
 *
 *   - **XIRR needs two dated flows.** With fewer it is not zero, it is
 *     unanswerable, and the difference between `0` and `null` is the difference
 *     between "this investment returned nothing" and "nothing here can say".
 *   - **Investments as a share of assets** divides by a net worth assembled
 *     from six other entities. Which six is now declared once, in
 *     `NET_WORTH_LOAD`, rather than listed inline by every screen that wants
 *     the figure.
 */

import { Service, NET_WORTH_LOAD } from './service.js';
import {
  portfolioSummary, allocation, holdingGain, xirr, cashFlows,
  maturingSoon, dividendIncome,
} from '../domain/portfolio.js';
import { netWorth } from '../domain/networth.js';
import { accrualReport } from '../domain/accrual.js';
import { startOfFinancialYear, endOfFinancialYear, today } from '../core/dates.js';

export class PortfolioService extends Service {
  /**
   * Everything the portfolio screen shows, as plain data.
   *
   * @param {{asOf?: string}} [options]
   */
  async overview({ asOf = today() } = {}) {
    const data = await this.load({
      ...NET_WORTH_LOAD,
      investmentTransactions: ['investmentTransaction', { decrypt: false, limit: 20_000 }],
      people: ['person', { decrypt: false }],
    });

    const { holdings, investmentTransactions: txns, people } = data;

    // An empty portfolio is a real answer, not an error and not zeroes. The
    // screen shows a different thing entirely for it, and saying so here keeps
    // that decision out of the rendering.
    if (!holdings.length) return { empty: true, holdings: [], rows: [] };

    const summary = portfolioSummary(holdings);

    /**
     * The closing value a rate should be worked out from.
     *
     * A stale `currentValue` does not make XIRR slightly wrong, it makes it
     * meaningless: the closing flow decides the rate almost single-handedly, so
     * a deposit whose value was typed once and never revisited reports **0% on
     * a deposit paying 7.1%**. That is not a missing number, it is a wrong one.
     *
     * Where `domain/accrual.js` can say what the deposit is actually worth, the
     * rate is worked out from that instead, and the row is marked so the screen
     * can say it is an estimate. Nothing is substituted silently.
     *
     * Where accrual cannot help — a share whose price nobody has updated — the
     * stored figure is still used, because there is nothing better to use. That
     * rate is stale too, and this does not pretend otherwise; it is simply not
     * a thing this can fix.
     */
    const closingValue = (holding) => accrued.get(holding.id)?.value ?? null;
    const accrued = new Map(
      accrualReport(holdings, asOf, { transactions: txns }).drifted
        .map((entry) => [entry.holding.id, entry]),
    );

    const rows = holdings
      .filter((holding) => holding.active !== false)
      .map((holding) => {
        const closing = closingValue(holding);
        const flows = cashFlows(holding, txns, { asOf, value: closing });
        return {
          ...holding,
          ...holdingGain(holding),
          // Whether the rate beside this row came from a figure somebody typed
          // or from an estimate of what it has grown to since. The screen says
          // which; a rate presented identically either way would be the
          // silent substitution this is careful not to make.
          rateEstimated: closing !== null,
          // Null rather than zero: "no rate could be computed" and "it returned
          // nothing" are different facts, and a screen that renders both as
          // "0%" tells somebody their investment is flat when in truth it has
          // never been dated.
          // Belt and braces, and worth naming as such: `xirr` already returns
          // null for a single flow, so mutation-testing showed removing this
          // clause breaks nothing today. It stays because the rule it states —
          // a rate needs two dated flows — is a property of the *answer* rather
          // than of the solver, and the test below locks xirr's half so the two
          // cannot quietly disagree.
          rate: flows.length >= 2 ? xirr(flows) : null,
          ownerName: people.find((p) => p.id === holding.owner)?.name ?? '',
        };
      })
      .sort((a, b) => b.value - a.value);

    const pooled = xirr(holdings
      .flatMap((holding) => cashFlows(holding, txns, { asOf, value: closingValue(holding) }))
      .sort((a, b) => a.date.localeCompare(b.date)));

    const worth = netWorth({
      accounts: data.accounts,
      transactions: data.transactions,
      holdings,
      properties: data.properties,
      vehicles: data.vehicles,
      loans: data.loans,
    });

    return {
      empty: false,
      summary,
      rows,
      pooled,
      allocation: allocation(holdings),
      dividends: dividendIncome(txns, {
        from: startOfFinancialYear(asOf),
        to: endOfFinancialYear(asOf),
      }),
      maturing: maturingSoon(holdings, 180),
      // Deposits whose recorded value has not moved since it was typed. The
      // gain above reads `currentValue`, so an FD left alone reports a gain of
      // zero for as long as nobody revisits it — see `domain/accrual.js`.
      // Reported beside the figure and never written back over it.
      //
      // The transactions are what a recurring deposit is valued *from*: each
      // instalment accrues from its own date. Passing them is not optional
      // dressing — without them every RD comes back unchecked.
      accrual: accrualReport(holdings, asOf, { transactions: txns }),
      netWorth: worth,
      // A percentage, or null when there is nothing to be a percentage of.
      // Dividing by zero assets produced `0%` before, which reads as "your
      // investments are a negligible part of your assets" rather than "there
      // are no assets recorded".
      shareOfAssets: worth.assets ? Math.round((summary.value / worth.assets) * 100) : null,
    };
  }
}
