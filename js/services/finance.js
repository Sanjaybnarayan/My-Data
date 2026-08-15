/**
 * The Finance overview, assembled where it can be tested.
 *
 * ## Why this exists
 *
 * The overview screen loaded eight entities and built its whole view model
 * inline — balances, this month's totals, the settlement report, the EMI split,
 * spend by member, upcoming bills, budgets, the commitment figure and the
 * running balance series. `services/service.js` names that as the first of the
 * two things a service layer is actually for:
 *
 * > **Assembly has no home.** A screen loads eight entities, feeds them to pure
 * > functions in `domain/`, and builds a view model inline — so the assembly
 * > can only be tested through a browser.
 *
 * That is not a theoretical cost. Wiring the unusual-spending findings into
 * this very screen family failed **three times in a row, silently**: a month
 * key read from a field that does not exist, an array that is grouped rather
 * than sorted taken as sorted, and an import added by a replacement that
 * matched nothing. Each produced no error and no output, and the whole suite
 * stayed green, because nothing could reach the assembly without a browser.
 *
 * ## The split
 *
 * `overview()` fetches. `assembleOverview()` is **pure** — records in, view
 * model out, no database, no clock unless you pass one. The tests exercise the
 * second directly, which is the entire point of moving it here.
 */

import { Service, TRANSACTION_LIMIT, transactionsTruncated } from './service.js';
import { TransfersService } from './transfers.js';
import * as fin from '../domain/finance.js';
import { settlementReport } from '../domain/settlement.js';
import { emiBreakdown } from '../domain/amortise.js';
import { spendByMember } from '../domain/household.js';
import { fromRecords } from '../domain/ledger.js';
import { recurring as recurringCharges } from '../domain/categorise.js';
import { today } from '../core/dates.js';
import { cashRunway } from '../domain/runway.js';

/**
 * Declared once, here, rather than inline in the screen.
 *
 * Two screens listing the same entities inline is how two screens come to
 * disagree about what a figure is made of — the reason `NET_WORTH_LOAD` exists
 * beside this one.
 */
/** @type {Record<string, import('./service.js').Load>} */
export const FINANCE_OVERVIEW_LOAD = Object.freeze({
  accounts: ['account', { decrypt: false, limit: 500 }],
  transactions: ['transaction', { decrypt: false, limit: TRANSACTION_LIMIT }],
  budgets: ['budget', { decrypt: false }],
  recurring: ['recurringPayment', { decrypt: false }],
  loans: ['loan', { decrypt: false }],
  // Recorded under Digital, spent out of Finance. A subscription renewing is
  // money leaving on a date, and neither screen was saying so.
  subscriptions: ['subscription', { decrypt: false }],
  digitalAssets: ['digitalAsset', { decrypt: false }],
  // `transaction.person` — the form calls it "Spent by" — has been recorded on
  // every transaction since the schema was written, and read by nothing.
  people: ['person', { decrypt: false, limit: 500 }],
});

/**
 * Everything the overview draws, from records alone.
 *
 * @param {Record<string, object[]>} data as `FINANCE_OVERVIEW_LOAD` yields
 * @param {{clock?: () => number}} [options]
 */
export function assembleOverview(data, { clock = Date.now } = {}) {
  const {
    accounts = [], transactions = [], budgets = [], recurring = [],
    loans = [], subscriptions = [], digitalAssets = [], people = [],
  } = data ?? {};

  const inMonth = fin.inPeriod(transactions, 'month', clock);
  const thisMonth = new Set(inMonth.map((t) => t.id));
  const isThisMonth = (t) => thisMonth.has(t.id);

  // Paying a credit card is not spending — the spending happened when the card
  // was used. Both rows are counted as expenses today, so a household that
  // imports the card statement *and* the bank statement sees every rupee that
  // went through the card twice.
  const settlement = settlementReport(inMonth, accounts);

  // The other half of the same question. A card bill is counted twice and is
  // simply wrong; an EMI is counted once and is correct — it just conflates a
  // cost with money that moved from cash into a smaller debt. The whole history
  // is passed, because where a payment falls in the schedule decides the split,
  // and only this month's rows are counted.
  const emi = emiBreakdown(loans, transactions, isThisMonth);
  const byMember = spendByMember(people, transactions, isThisMonth);

  const series = fin.monthlySeries(transactions, 12, clock);

  // The records say what the household meant to commit to. The statements say
  // what actually leaves. Both are read so the sentence can name the difference
  // — a subscription nobody wrote down is the kind a household most wants to be
  // told about, because it is the kind they forgot.
  const detected = recurringCharges(
    fromRecords(transactions, { holder: '' }), { asOf: today(clock) },
  );

  // Running balance across the year, so a downward drift is visible before it
  // becomes a problem.
  let running = 0;
  const balanceSeries = series.map((month) => {
    running += month.net;
    return { label: month.label, value: running };
  });

  const bills = fin.upcomingBills(recurring, loans, {
    days: 30, from: today(clock), accounts, transactions, subscriptions, digitalAssets,
  });

  return {
    accounts,
    transactions,
    // Whether every figure below was computed from the whole history or from a
    // slice of it. A balance summed from the most recent N is not the account's
    // balance once a household has more than N, and a screen showing one should
    // say so rather than let it pass as the figure.
    truncated: transactionsTruncated(transactions),
    // Passed through because the screen draws them directly. A view model that
    // withheld them would have the screen reach for the repository again,
    // which is the edge this whole layer exists to narrow.
    loans,
    balances: fin.accountBalances(accounts, transactions),
    compare: fin.comparePeriods(transactions, clock),
    series,
    balanceSeries,
    categories: fin.byCategory(inMonth),
    settlement,
    emi,
    byMember,
    // `account.statementDay` and `account.dueDay` are on the account form and
    // were read by nothing, so a card with money owed on it produced no warning
    // at all. Passing the accounts and the rows brings them in.
    bills,
    // Cash against what is known to be leaving it. Assembled here rather than
    // in the screen for the reason this whole module exists — and wired in the
    // same tranche that built it, because "the domain function exists and no
    // screen calls it" is the finding this repository keeps making.
    runway: cashRunway(accounts, transactions, bills, { from: today(clock), clock }),
    budgetRows: fin.budgetStatus(budgets, transactions),
    commitment: fin.committed({
      recurring, loans, subscriptions, digitalAssets, detected,
    }),
    detected,
  };
}

export class FinanceService extends Service {
  /**
   * @param {{clock?: () => number}} [options]
   * @returns {Promise<object>} the view model, plus the pending transfers the
   *   screen offers for joining up. Those come from `TransfersService` rather
   *   than being re-derived here — one question, one owner.
   */
  async overview({ clock = Date.now } = {}) {
    const data = await this.load(FINANCE_OVERVIEW_LOAD);
    const transfers = await new TransfersService(this.db).pending();
    return { ...assembleOverview(data, { clock }), transfers };
  }
}
