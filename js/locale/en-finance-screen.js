/**
 * English, for the finance screen.
 *
 * A separate file for the same reason as `en-instalments.js`: `en.js` is held
 * under 800 lines by the module-size ratchet, and this is one screen's worth of
 * sentences that change together.
 *
 * Whole sentences, not halves. The finance module wrote its English as template
 * literals assembled from fragments — `'${n} '` + `'movements'` — which reads
 * correctly in English and cannot be translated at all: word order is the first
 * thing a second language changes. Each key below is a complete statement with
 * named placeholders, so a translator moves `{amount}` where their grammar puts
 * it rather than being handed the pieces in English order.
 *
 * Plurals follow the `(s)` convention already used by `en-instalments.js`. It
 * is a compromise and worth naming as one: English has two forms, and a
 * language with three or six cannot express itself through this key. Fixing
 * that is a plural-rule mechanism in `core/locale.js`, not a different string
 * here, and until it exists no catalogue can claim more than this one does.
 */

export const financeScreenStrings = {
  'finance.tab.imported': 'Imported files',

  // Where the money stands — the CFO position, and the part-month beneath it.
  'finance.position.title': 'Where the money stands',
  'finance.position.subtitle': 'Figures for {month}, the last complete month · every one names where it came from',
  'finance.position.partial': '{month}, so far',
  'finance.position.upTo': 'Up to {day}',
  'finance.position.flow': 'In: {income} · Out: {expense} · Net: {net}',

  'finance.goals.title': 'Where each goal stands',
  'finance.goals.subtitle': 'Read from the accounts and holdings that fund it, not from a figure anybody typed',
  'finance.goals.emergency': 'An emergency fund is sized in months of spending, and {history}.',

  'finance.explain.problems': 'Movements with something wrong behind them',
  'finance.explain.unchanged': 'Nothing here has been changed. A figure recorded on a movement is what somebody confirmed; the rows are what they say now, and both are kept.',
  'finance.explain.origin': 'Where this came from',
  'finance.explain.recordedHere': 'Recorded here',
  'finance.explain.rowsSay': 'The rows now say',

  // Transfers between the household's own accounts.
  'finance.transfers.title': 'Money you moved between your own accounts',
  'finance.transfers.why': 'A transfer between your own accounts appears twice, once on each statement. These are the pairs that look like one movement. Confirming keeps both rows.',
  'finance.transfers.moved': '{amount} across {n} movement(s)',
  'finance.transfers.none': 'Nothing confirmed yet',
  'finance.transfers.pair': '{from} → {to}',
  'finance.transfers.line': '{day} · {why}',
  'finance.transfers.one': 'One movement',
  'finance.transfers.acceptFee': 'Accept with the charge',
  'finance.transfers.confirmedFee': 'Recorded as one movement, less the charge — every row is kept',
  'finance.transfers.confirmedSet': 'Recorded as one movement — every statement row is kept',
  'finance.transfers.confirmedPair': 'Recorded as one movement — both statement rows are kept',
  'finance.transfers.undecidedSummary': '{n} that nobody can decide from the figures',
  'finance.transfers.splitWhy': 'These moved in more than one piece — one row on one side, several on the other. The amount is counted once, not once per row.',
  'finance.transfers.setsMoved': '{amount} across {n} movement(s) in pieces',
  'finance.transfers.tooMany': '{n} row(s) have too many possible partners to work out — {why}',
  'finance.transfers.noPartner': '{n} transfer row(s) have no partner at all — usually the other account’s statement has not been imported.',

  'finance.loans.title': 'Loans',
  'finance.loans.outstanding': '{amount} recorded as outstanding',
  'finance.loans.terms': '{rate}% · EMI {emi}',
  'finance.loans.estimates': 'Estimates come from the rate and EMI recorded here, so they cannot know about a rate change, a prepayment or a payment holiday. Update the figure from the lender’s statement, not from this.',

  'finance.members.title': 'Who paid, this month',
  'finance.members.complete': 'Every payment has somebody recorded against it',
  'finance.members.coverage': '{percent}% of this month’s spending has somebody recorded against it',
  'finance.members.payments': '{n} payment(s)',
  'finance.members.topCategory': '{payments} · mostly {category}',

  // The line under a due bill. `when` is itself a translated fragment, which
  // is the one place this catalogue nests: the date and how far off it is
  // appear on their own as well as with a reason after them.
  'finance.bills.when': '{day} · {relative}',
  'finance.bills.whenWhy': '{when} · {why}',
  'finance.bills.fromStatement': '{when} · from the statement of {day}',

  'finance.overview.thisMonth': 'This month',
  'finance.overview.spent': 'Spent',
  'finance.overview.received': 'Received',
  'finance.overview.net': 'Net',
  'finance.overview.assuming': 'Assuming: {list}.',
  'finance.overview.cash': 'Cash & accounts',
  'finance.overview.truncated': 'Only the most recent {n} transactions were read, so these balances are computed from part of your history rather than all of it.',
  'finance.overview.liquid': 'Liquid cash',
  'finance.overview.accountAt': '{kind} · {institution}',
  'finance.overview.utilisation': '{percent}% used',
  'finance.overview.year': 'Twelve months',
  'finance.overview.yearChart': 'Spending by month over a year',
  'finance.overview.netChart': 'Cumulative net position',
  'finance.overview.categories': 'Where it went this month',
  'finance.overview.categoryChart': 'Spending by category',
  'finance.overview.budgets': 'Budgets',
  'finance.overview.overBudget': '{n} over',
  'finance.overview.left': '{amount} left',
  'finance.overview.over': '{amount} over',
  'finance.overview.due': 'Due in the next 30 days',
  'finance.overview.nothingDue': 'Nothing due',

  /* One category, opened from the breakdown. */
  'finance.category.back': 'Back to Finance',
  'finance.category.spending': 'Spending',
  'finance.category.income': 'Income',
  'finance.category.thisMonth': 'This month',
  'finance.category.soFar': 'So far this month',
  'finance.category.lastMonth': 'vs {amount} last month',
  'finance.category.noneLastMonth': 'Nothing last month',
  'finance.category.typical': 'Typical',
  'finance.category.largest': 'Largest',
  'finance.category.recordedSince': '{n} recorded since {day} · {total} in all',
  'finance.category.nothingSpent': 'Nothing has been spent under this yet',
  'finance.category.partialNote': 'This month is not over. The change is measured against the same days of last month.',
  'finance.category.trend': 'Over twelve months',
  'finance.category.trendChart': '{category} by month over a year',
  'finance.category.payees': 'Who it went to',
  'finance.category.payeesIn': 'Who it came from',
  'finance.category.unnamed': 'No payee recorded',
  'finance.category.timesAmount': '{share}% of it · {n} times · last {day}',
  'finance.category.onceAmount': '{share}% of it · once, {day}',
  'finance.category.bills': 'Bills filed under this',
  'finance.category.noBills': 'Nothing recurring is filed under this category',
  'finance.category.due': 'Due {day} · {relative}',
  'finance.category.autoDebit': 'auto',
  'finance.category.recent': 'Recent',
  'finance.category.seeAll': 'See all {n} in the ledger',
  'finance.category.empty': 'Nothing has been recorded under this category yet',
  'finance.category.budget': 'Budget',
  'finance.category.budgetUsed': '{spent} of {limit}',

  /* The two rows above every Finance screen. Read out, not drawn. */
  'finance.nav.groups': 'Parts of Finance',
  'finance.nav.sections': 'Sections',

  /* The ledger's filters, which fill a phone before a row is reached. */
  'finance.ledger.filters': 'Filters',
  'finance.ledger.filtersOn': 'Filters · {n} on',
  'finance.ledger.narrowedByLink': 'Opened with a filter already applied.',
};
