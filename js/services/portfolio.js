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
  portfolioSummary, allocation, holdingValue, xirr, cashFlows,
  maturingSoon, dividendIncome,
} from '../domain/portfolio.js';
import { costBasis, gainOn } from '../domain/costbasis.js';
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

    // The stored view, kept so the screen can say what the forms add up to
    // beside what the transactions do.
    const asTyped = portfolioSummary(holdings);

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

        // What the holding actually cost, from the transactions rather than
        // the figure typed on the form. A fund fed a monthly SIP reported a
        // 162% gain against the 24.61% its own transactions implied — while
        // the rate beside it, worked out from those very transactions, said
        // 34%. Two numbers about one holding, disagreeing on one screen.
        const basis = costBasis(holding, txns);

        return {
          ...holding,
          // The **stored** value, deliberately, not the accrual estimate. The
          // estimate is right for the rate — a stale closing figure makes XIRR
          // meaningless rather than slightly wrong — but putting it in the
          // value column would substitute an estimate for the household's own
          // recorded figure without saying so, which is what the accrual card
          // beside this row exists to avoid. Only the *invested* side is
          // corrected here. (Written the other way first; the browser check
          // "the recorded value is left exactly as it was" caught it.)
          ...gainOn(basis, holdingValue(holding)),
          basis,
          unitsHeld: basis.units,
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

    // The headline, from the same cost basis the rows use. Built here rather
    // than by `portfolioSummary`, which reads `holding.invested` — the figure
    // that had never moved.
    const summary = rows.reduce((acc, row) => ({
      count: acc.count + 1,
      invested: acc.invested + row.invested,
      value: acc.value + row.value,
      realised: acc.realised + row.realised,
      income: acc.income + row.income,
      // How much of the headline rests on figures nobody has recorded
      // transactions for. A portfolio where most of it does is one where this
      // correction has not reached most of the money.
      fromForms: acc.fromForms + (row.basis.from === 'stored' ? 1 : 0),
    }), { count: 0, invested: 0, value: 0, realised: 0, income: 0, fromForms: 0 });

    summary.gain = (summary.value + summary.realised + summary.income) - summary.invested;
    summary.gainPercent = summary.invested
      ? Math.round((summary.gain / summary.invested) * 10_000) / 100
      : null;
    // What the forms say, so the screen can name the disagreement rather than
    // quietly showing a different number than it did yesterday.
    summary.typedInvested = asTyped.invested;
    summary.difference = summary.invested - asTyped.invested;

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
