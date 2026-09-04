/**
 * Money, derived.
 *
 * Pure functions over arrays of records. No storage, no DOM, no clock except
 * the one passed in — so the dashboard, the reports and the assistant all read
 * the same numbers from the same code, and the numbers can be checked without
 * a browser.
 *
 * Everything is in minor units throughout. A function here that returned
 * rupees would put a float back into a chain of exact integers.
 */

import { sum, changePercent, divide, addable } from '../core/money.js';
import { settled, onlySettled } from '../data/integrity.js';
import { t } from '../core/locale.js';
import { cardBills, isBillableCard } from './cards.js';
import { subscriptionBills, commitmentSummary } from './commitments.js';
import {
  today, range, withinRange, startOfMonth, addMonths, endOfMonth, addDays,
  daysUntil, daysBetween, formatDay,
} from '../core/dates.js';

/** Transactions inside an inclusive day range, deleted ones excluded. */
export function inPeriod(transactions, period, clock = Date.now) {
  const bounds = typeof period === 'string' ? range(period, clock) : period;
  if (!bounds) return [];
  return transactions.filter((t) => settled(t) && withinRange(t.date, bounds));
}

/**
 * A transfer is not income and not expense — it is the same money in a
 * different pocket. Counting it as either is the single most common way a
 * household budget ends up double the truth.
 */
export const isSpending = (t) => t.kind === 'expense';
export const isIncome = (t) => t.kind === 'income';

/*
 * Both of these filter, rather than trusting the caller to have done it.
 *
 * They took whatever array they were handed and added it up. In practice
 * `inPeriod` was always upstream and did the filtering, so nothing was wrong —
 * but that made the guarantee a property of the call sites rather than of the
 * two functions that actually add money, and a deleted row reached a total the
 * moment somebody called either one directly. A held row did too, which is how
 * this was found.
 */
export function totals(transactions) {
  const live = onlySettled(transactions);
  const expense = sum(live.filter(isSpending).map((t) => t.amount));
  const income = sum(live.filter(isIncome).map((t) => t.amount));
  return { income, expense, net: income - expense };
}

/** Spend per category, largest first. */
export function byCategory(transactions, { kind = 'expense' } = {}) {
  const buckets = new Map();
  for (const t of transactions) {
    if (!settled(t) || t.kind !== kind) continue;
    buckets.set(t.category || 'other',
      (buckets.get(t.category || 'other') ?? 0) + addable(t.amount));
  }
  return [...buckets]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/**
 * What the change from `comparePeriods` was measured against, to caption it.
 *
 * One decision in one place: both screens showing the delta need the same
 * words, and a caption kept twice is the drift this repository keeps finding.
 * It is a caption rather than a footnote because the percentage is unreadable
 * without it — "vs last month" over eleven days of last month makes a correct
 * number mean the wrong thing.
 */
export const comparedWith = (compare) =>
  t(compare.partial ? 'compare.vsSameDays' : 'compare.vsLastMonth');

/**
 * Month-by-month income and expense, oldest first.
 *
 * The last bucket is the month in progress, and until it ends it holds part of
 * a month drawn to the same scale as the whole ones beside it: on the 2nd, a
 * bar a fifteenth the height of its neighbours, for a household spending the
 * same every day. It carries `partial` so a chart can say so — see
 * `spendingBars`, which is where the saying is done.
 */
export function monthlySeries(transactions, monthsBack = 6, clock = Date.now) {
  const now = today(clock);
  const start = startOfMonth(addMonths(now, -(monthsBack - 1)));
  const out = [];

  for (let i = 0; i < monthsBack; i++) {
    const from = addMonths(start, i);
    const bounds = { from, to: endOfMonth(from) };
    const rows = transactions.filter((t) => settled(t) && withinRange(t.date, bounds));
    out.push({
      month: from.slice(0, 7),
      label: formatDay(from, { withYear: false }).replace(/^\d+ /, ''),
      partial: from.slice(0, 7) === now.slice(0, 7) && now < endOfMonth(now),
      ...totals(rows),
    });
  }
  return out;
}

/**
 * A monthly series as chart bars, with the unfinished month marked unfinished.
 *
 * Marked rather than renamed. The qualification used to be written into the
 * label — `Sep so far` — which put a fifty-nine pixel string into a twenty-six
 * pixel axis slot: it was cut to `Se`, and given room it sat on top of the
 * month before it. `barChart` says it in a caption under the chart instead,
 * and in the text equivalent it builds.
 *
 * Still never by colour alone, which the master brief forbids and which is why
 * this carries a flag a chart can read rather than a tone it might paint.
 */
export function spendingBars(series) {
  return series.map((m) => ({ label: m.label, value: m.expense, partial: m.partial }));
}

/**
 * This period against the one before it, for the dashboard's delta.
 *
 * Three days into a month a household has spent three days' money, and last
 * month's whole total sits next to it. The percentage between those two is
 * about minus ninety, `metric()` is given `goodWhen: 'down'` so it renders as
 * an improvement, and `ai/summary.js` writes it into a sentence — for a
 * household that has changed nothing at all.
 *
 * This repository already knew. `unusual.js` states the rule and keeps it —
 * *"a month in progress is reported but never used to claim a fall, because
 * three days in, everything has fallen"* — `runway.js` drops the partial month
 * rather than divide by it, and the CFO screen shows it apart and marked,
 * with the worked example: on the 21st, three missing weeks read as thrift.
 * This function is the one the two screens a household actually opens are
 * built on, and it was the one that did none of it.
 *
 * So the comparison is made like for like. While the month is unfinished, the
 * days elapsed are measured against **the same days of the previous month** —
 * two spans of records that exist, rather than a projection of either. Once
 * the month is over the window is the whole of both, which is what this
 * returned all along and still returns.
 *
 * `previous` stays the whole previous month, because that is a true fact about
 * last month and callers show it as one. What moved is what the *change* is
 * measured against; `partial` says which of the two it was, so a caller can
 * name the span instead of writing "vs last month" over a comparison that is
 * not with last month.
 */
export function comparePeriods(transactions, clock = Date.now) {
  const now = today(clock);
  const partial = now < endOfMonth(now);
  const thisMonth = totals(inPeriod(transactions, 'month', clock));
  const lastMonth = totals(inPeriod(transactions, 'last-month', clock));

  // `addMonths` clamps the day of the month to the target month's length, so
  // the 31st of March asks for the 28th of February and gets it. The clamp can
  // only ever widen the base towards the whole previous month, which is the
  // most that month has to offer.
  const upTo = addMonths(now, -1);
  const soFar = partial
    ? totals(inPeriod(transactions, { from: startOfMonth(upTo), to: upTo }))
    : lastMonth;

  return {
    current: thisMonth,
    previous: lastMonth,

    /** The span the change below is measured against, and how far it runs. */
    previousToDate: soFar,
    partial,
    upTo: partial ? upTo : null,

    expenseChange: changePercent(soFar.expense, thisMonth.expense),
    incomeChange: changePercent(soFar.income, thisMonth.income),
  };
}

/**
 * Running balance per account: the opening balance, plus everything in,
 * minus everything out, with transfers moving between the two sides.
 */
export function accountBalances(accounts, transactions) {
  const balances = new Map(accounts.map((a) => [a.id, a.openingBalance ?? 0]));

  for (const t of transactions) {
    if (!settled(t)) continue;
    // Its own arithmetic rather than `sum`, so it needs the same guard: a
    // balance that met a string amount came back `null`, which reads on the
    // screen as "this account has no balance" rather than "one row could not
    // be read". `unreadableAmounts` is what says the latter.
    if (t.amount !== undefined && t.amount !== null && !Number.isFinite(t.amount)) continue;
    const amount = addable(t.amount);
    if (t.kind === 'income') {
      balances.set(t.account, (balances.get(t.account) ?? 0) + amount);
    } else if (t.kind === 'expense') {
      balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
    } else if (t.kind === 'transfer') {
      // A transfer reaches this function in two shapes, and they need opposite
      // handling.
      //
      // **Two rows, from two statements.** Each bank reports its own side, so
      // each row carries a `direction` and no `toAccount`. The outgoing leg
      // subtracts from its account and the incoming leg *adds* to its own.
      //
      // **One row, entered by hand.** `direction` is hidden from the form, so
      // there is none; the row names both ends and moves the money itself.
      //
      // Until this, every transfer subtracted. An imported credit was taken
      // *off* the account it arrived in — so a ₹1,00,000 transfer left the
      // receiving account ₹2,00,000 short, and every household that imported
      // statements from two of their own accounts had it.
      //
      // `direction` wins where it exists. After a pairing is confirmed the
      // outgoing leg carries both a direction and a `toAccount`, and applying
      // the `toAccount` as well would credit the destination twice — once from
      // this row and once from the incoming leg that is still there.
      if (t.direction === 'in') {
        balances.set(t.account, (balances.get(t.account) ?? 0) + amount);
      } else if (t.direction === 'out') {
        balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
      } else {
        balances.set(t.account, (balances.get(t.account) ?? 0) - amount);
        if (t.toAccount) balances.set(t.toAccount, (balances.get(t.toAccount) ?? 0) + amount);
      }
    }
  }

  return accounts.map((account) => ({
    ...account,
    balance: balances.get(account.id) ?? 0,
    // A credit card's "balance" is what is owed, and its utilisation is what
    // actually matters to a credit score.
    utilisation: account.kind === 'credit card' && account.creditLimit
      ? Math.abs(Math.min(0, balances.get(account.id) ?? 0)) / account.creditLimit
      : null,
  }));
}

/** Cash on hand: liquid accounts only, so a PPF balance is not "cash". */
const LIQUID = new Set(['savings', 'current', 'cash', 'wallet', 'UPI']);

export function liquidCash(accountsWithBalances) {
  return sum(accountsWithBalances
    .filter((a) => LIQUID.has(a.kind) && !a.archived && a.includeInNetWorth !== false)
    .map((a) => a.balance));
}

/**
 * Budget performance for a month. `alertAtPercent` decides amber; over 100%
 * is red. Reported per budget, not aggregated, because "you are 4% over
 * overall" hides that groceries doubled and travel went to nothing.
 */
export function budgetStatus(budgets, transactions, { month = today() } = {}) {
  const bounds = { from: startOfMonth(month), to: endOfMonth(month) };
  const spent = new Map();

  for (const t of transactions) {
    if (!settled(t) || !isSpending(t) || !withinRange(t.date, bounds)) continue;
    spent.set(t.category, (spent.get(t.category) ?? 0) + addable(t.amount));
  }

  return budgets
    .filter(settled)
    .map((b) => {
      const used = spent.get(b.category) ?? 0;
      const limit = perMonth(b);
      const ratio = limit > 0 ? used / limit : 0;
      return {
        ...b,
        spent: used,
        limit,
        remaining: limit - used,
        ratio,
        state: ratio >= 1 ? 'over' : ratio >= (b.alertAtPercent ?? 80) / 100 ? 'close' : 'ok',
      };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

function perMonth(budget) {
  const limit = budget.monthlyLimit ?? 0;
  if (budget.period === 'quarterly') return divide(limit, 3);
  if (budget.period === 'yearly') return divide(limit, 12);
  return limit;
}

/**
 * One shape for every bill, whatever it came from.
 *
 * Four sources feed this list and each knows different things — a card knows
 * its statement date, a subscription knows whether it renews itself, a
 * recurring payment knows neither. Filling the gaps with nulls rather than
 * leaving the keys off means a caller can read `bill.account` on any row
 * without checking which kind it is first, which is how the four branches got
 * read wrongly the first time.
 *
 * @returns {{id, source, entity, recordId, name, kind, amount, dueOn, days,
 *            overdue, autoDebit, account, statement, cancelUrl, why}}
 */
const asBill = (bill) => ({
  entity: null,
  recordId: null,
  account: null,
  statement: null,
  cancelUrl: null,
  why: null,
  days: null,
  ...bill,
});

/**
 * Bills due in the next `days`.
 *
 * Four sources. Recurring payments carry their own next-due date; EMIs come
 * from loans, which do not; card bills come from the account's statement and
 * due days and the rows sitting on the card; subscription renewals come from
 * the Digital screens, where a date was already being shown with no money
 * attached to it.
 *
 * The last two are opt-in on the call rather than always on, because working a
 * card bill out needs the whole transaction history and several callers of
 * this function have only the recurring payments to hand.
 */
export function upcomingBills(recurring, loans, {
  days = 30, from = today(), accounts = null, transactions = null,
  subscriptions = null, digitalAssets = null,
} = {}) {
  const horizon = addDays(from, days);
  const out = [];

  for (const r of recurring) {
    if (!settled(r) || r.active === false) continue;
    if (!r.nextDueOn || r.nextDueOn > horizon) continue;
    out.push(asBill({
      id: r.id,
      source: 'recurringPayment',
      entity: 'recurringPayment',
      recordId: r.id,
      name: r.name,
      kind: r.kind,
      amount: r.amount ?? 0,
      dueOn: r.nextDueOn,
      overdue: r.nextDueOn < from,
      autoDebit: Boolean(r.autoDebit),
      // Which account it leaves from, where the household recorded one. A
      // forecast that pools every account will happily report no shortfall
      // while the rent bounces out of an empty current account.
      account: r.account ?? null,
    }));
  }

  for (const loan of loans) {
    if (!settled(loan) || !loan.emiAmount || !loan.emiDay) continue;
    if (loan.endsOn && loan.endsOn < from) continue;
    const due = nextEmiDate(loan.emiDay, from);
    if (due > horizon) continue;
    out.push(asBill({
      id: loan.id,
      source: 'loan',
      entity: 'loan',
      recordId: loan.id,
      name: `${loan.name} EMI`,
      kind: 'EMI',
      amount: loan.emiAmount,
      dueOn: due,
      overdue: false,
      autoDebit: true,
    }));
  }

  // A card bill is the most expensive thing on this list to miss — interest
  // near forty per cent a year, backdated to the purchase date so the
  // interest-free period goes too. `amount` may be null, which is the card
  // saying *when* without claiming to know *how much*; `why` says so, and
  // callers must not print a figure in its place.
  for (const bill of cardBills(accounts, transactions, { from, days })) {
    out.push(asBill({
      id: bill.id,
      source: 'card',
      entity: 'account',
      recordId: bill.account,
      name: `${bill.name} bill`,
      kind: 'credit card',
      amount: bill.amount,
      dueOn: bill.dueOn,
      days: bill.days,
      overdue: bill.overdue,
      // Nothing pays a card automatically unless the household set that up on
      // the bank's side, which is not recorded here. Claiming otherwise is the
      // one wrong answer that would stop somebody looking.
      autoDebit: false,
      account: bill.account,
      statement: bill.statement,
      why: bill.why,
    }));
  }

  // A renewal is a bill: a known amount leaving on a known date. Subscriptions
  // already produced a date reminder with no money attached, which is the half
  // of the fact that costs nothing to know.
  for (const bill of subscriptionBills(subscriptions, digitalAssets, { from, days })) {
    out.push(asBill(bill));
  }

  return out.sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** How many months one step of each frequency is worth. Weekly is not months. */
const MONTHS_PER_STEP = {
  monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12,
};

/**
 * The `n`th occurrence after an anchor date, counted **from the anchor**.
 *
 * Indexed rather than iterated, and that is the whole point. `addMonths`
 * clamps to the end of a short month, so stepping one result into the next
 * walks a rent due on the 31st down to the 28th in February and leaves it
 * there for ever after — every later month reads 28, because the 31 has been
 * thrown away. Going back to the anchor each time keeps the intended day and
 * clamps only where the month is genuinely short, which is what `nextEmiDate`
 * and the card cycle already do by recomputing from the day number.
 */
function occurrence(anchor, frequency, n) {
  if (frequency === 'weekly') return addDays(anchor, n * 7);
  const months = MONTHS_PER_STEP[frequency];
  return months ? addMonths(anchor, n * months) : null;
}

/**
 * Every bill falling inside a window, not merely the next one of each.
 *
 * ## Why this is not `upcomingBills`
 *
 * The same distinction `datesInRange` drew against `expiryReminders`, and for
 * the same reason. `upcomingBills` answers *"what is due soon?"*, so one
 * occurrence per bill is exactly right: a household does not want the next
 * twelve rents on the dashboard. A calendar asks *"what falls in November?"*,
 * and there the answer is different — the rent is due in November whether or
 * not it is the next one.
 *
 * Measured on a household paying ₹80,239 every month — rent, a home loan EMI,
 * broadband and one subscription — the calendar drew all four in September and
 * **eleven of the twelve months read as nothing due**. Every one of those
 * squares was wrong, and the grid's own subtitle promises money due.
 *
 * ## What recurs, and what deliberately does not
 *
 * **Recurring payments and EMIs recur.** Both carry the schedule that says so
 * — a frequency and a next-due date, an EMI day and an end date.
 *
 * **A subscription recurs only if it renews itself.** `autoRenew` is the
 * field that distinguishes a Netflix that will charge again next month from a
 * domain that simply stops on its date, and drawing twelve renewals for
 * something that lapses after the first would invent eleven charges nobody is
 * going to be asked for. A `digitalAsset` has no `autoRenew` at all, so it
 * lapses — the same reading `commitments.js` already takes of the same absence.
 *
 * **A card bill does not recur, and this is a refusal rather than an
 * omission.** A card bill is the statement balance, derived from the rows that
 * landed inside a cycle that has closed. Next month's cycle has not happened,
 * so there is no balance to state; projecting one would put a figure on a
 * calendar square that nothing supports. The next bill appears, the ones after
 * it do not, and `cardBillsStopAt` says where that boundary falls so a caller
 * can tell a household why rather than leaving a silent hole.
 *
 * @param {object[]} recurring
 * @param {object[]} loans
 * `now` is the day the card horizon is measured from, and it is a parameter
 * rather than a call to the clock so a test can page a calendar forward
 * without waiting for the calendar to arrive. It is not the window: the window
 * is what is being drawn, and `now` is what is knowable.
 *
 * @param {{from: string, to: string, accounts?: object[]|null,
 *          transactions?: object[]|null, subscriptions?: object[]|null,
 *          digitalAssets?: object[]|null, now?: string}} window
 *   inclusive, in calendar days
 * @returns {{bills: object[], cardBillsStopAt: string|null}}
 */
/**
 * How far past today to look for the one card bill that can be stated.
 *
 * A due day recurs monthly, so the next occurrence is at most 31 days out; 62
 * is two of those, which covers a card whose cycle has just rolled without
 * inviting a second bill into the answer.
 */
const CARD_HORIZON_DAYS = 62;

// No default for the window: `from` and `to` are the question, and a bill
// range with no bounds is not a smaller version of one.
export function billsInRange(recurring, loans, {
  from, to, accounts = null, transactions = null,
  subscriptions = null, digitalAssets = null, now = today(),
}) {
  const out = [];
  // 500 steps is a weekly bill running for nine years; a window that long is
  // not a calendar. The guard exists so a frequency this does not understand
  // cannot spin, not because any real schedule approaches it.
  const LIMIT = 500;

  const emit = (bill) => out.push(asBill({
    ...bill,
    // Keyed on the occurrence rather than the record, because a calendar draws
    // twelve of these and a screen that de-duplicates by id would keep one.
    id: `${bill.entity}:${bill.recordId}:${bill.dueOn}`,
  }));

  for (const r of recurring ?? []) {
    if (!settled(r) || r.active === false || !r.nextDueOn) continue;

    for (let n = 0; n < LIMIT; n += 1) {
      const dueOn = occurrence(r.nextDueOn, r.frequency, n);
      // A frequency with no step is a one-off: it is due on its date and never
      // again, so it belongs in the window once rather than not at all.
      if (!dueOn) {
        if (n === 0 && r.nextDueOn >= from && r.nextDueOn <= to) {
          emit({
            source: 'recurringPayment',
            entity: 'recurringPayment',
            recordId: r.id,
            name: r.name,
            kind: r.kind,
            amount: r.amount ?? 0,
            dueOn: r.nextDueOn,
            overdue: r.nextDueOn < from,
            autoDebit: Boolean(r.autoDebit),
          });
        }
        break;
      }
      if (dueOn > to) break;
      // A payment that has ended stops being due, however far the window runs.
      if (r.endsOn && dueOn > r.endsOn) break;
      if (dueOn < from) continue;

      emit({
        source: 'recurringPayment',
        entity: 'recurringPayment',
        recordId: r.id,
        name: r.name,
        kind: r.kind,
        amount: r.amount ?? 0,
        dueOn,
        overdue: dueOn < today(),
        autoDebit: Boolean(r.autoDebit),
      });
    }
  }

  for (const loan of loans ?? []) {
    if (!settled(loan) || !loan.emiAmount || !loan.emiDay) continue;

    let due = nextEmiDate(loan.emiDay, from);
    for (let n = 0; n < LIMIT && due <= to; n += 1) {
      if (loan.endsOn && due > loan.endsOn) break;
      emit({
        source: 'loan',
        entity: 'loan',
        recordId: loan.id,
        name: `${loan.name} EMI`,
        kind: 'EMI',
        amount: loan.emiAmount,
        dueOn: due,
        overdue: false,
        autoDebit: true,
      });
      // Recomputed from the day number, not stepped off the last result, so a
      // 31st clamped to February does not stay clamped in March.
      due = nextEmiDate(loan.emiDay, addDays(due, 1));
    }
  }

  // Subscriptions, from the same rows the committed figure is built on, so the
  // calendar and that figure cannot disagree about what renews.
  const renewals = subscriptionBills(subscriptions, digitalAssets, {
    from,
    days: Math.max(0, daysBetween(from, to)),
  });

  for (const bill of renewals) {
    // The first renewal is a fact on the record either way.
    emit({ ...bill, source: 'subscription' });
    if (!bill.autoDebit) continue;

    const row = (subscriptions ?? []).find((s) => s.id === bill.recordId);
    for (let n = 1; n < LIMIT; n += 1) {
      const dueOn = occurrence(bill.dueOn, row?.frequency ?? 'monthly', n);
      if (!dueOn || dueOn > to) break;
      if (row?.endsOn && dueOn > row.endsOn) break;
      emit({ ...bill, source: 'subscription', dueOn, days: null, overdue: false });
    }
  }

  // Only the next one — see the refusal above.
  //
  // "Next" means next from *today*, and that is the whole of this. It used to
  // mean next from `from`, which is the start of whichever month the calendar
  // happens to be drawing — so paging forward re-asked the question from
  // February and got February's answer. One ₹3,000 purchase in August was
  // reported as a ₹3,000 bill due on the first of every month to the horizon,
  // each one claiming to be the balance of a cycle that had not closed. The
  // refusal above was written and never implemented.
  //
  // So the horizon is computed once, from today, and does not move when the
  // reader pages. Past months keep their bills, because those cycles really
  // did close; it is only the future that cannot be stated.
  const stateable = cardBills(accounts, transactions, { from: now, days: CARD_HORIZON_DAYS });

  // The last due date that can honestly be stated. With nothing owed on the
  // closed cycle there is no bill at all, and the horizon is today — which
  // still refuses the future rather than falling open.
  const horizon = stateable.length
    ? stateable.reduce((last, b) => (b.dueOn > last ? b.dueOn : last), stateable[0].dueOn)
    : now;

  const cards = cardBills(accounts, transactions, {
    from,
    days: Math.max(0, daysBetween(from, to)),
  }).filter((bill) => bill.dueOn <= horizon);

  for (const bill of cards) {
    emit({
      source: 'card',
      entity: 'account',
      recordId: bill.account,
      name: `${bill.name} bill`,
      kind: 'credit card',
      amount: bill.amount,
      dueOn: bill.dueOn,
      days: bill.days,
      overdue: bill.overdue,
      autoDebit: false,
      account: bill.account,
      statement: bill.statement,
      why: bill.why,
    });
  }

  return {
    bills: out.sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    // The day after the last card bill this can honestly state. Null when
    // there are no cards to be silent about.
    //
    // Derived from the horizon rather than from what landed in this window,
    // because the two are different questions and only the first survives
    // paging. Taken from the window, a month with no card bill in it reported
    // `null` — and a null reads as "no cards here" rather than "no cycle has
    // closed", which is the distinction the caption exists to draw.
    cardBillsStopAt: (accounts ?? []).some(isBillableCard) ? addDays(horizon, 1) : null,
  };
}

/**
 * What a list of bills adds up to, and how many of them would not say.
 *
 * A card with no statement day reports a due date and a null amount. Adding
 * that to a total gives the right sum of the wrong list: `null` coerces to
 * zero, so the figure comes out smaller than the truth with nothing on screen
 * to say a bill was left out of it. Callers get the count and are expected to
 * print it.
 *
 * @returns {{total: number, unknown: number}}
 */
export function billsTotal(bills) {
  let total = 0;
  let unknown = 0;
  for (const bill of bills) {
    if (bill.amount === null || bill.amount === undefined) unknown += 1;
    else total += addable(bill.amount);
  }
  return { total, unknown };
}

/** The next occurrence of a day-of-month, clamped to short months. */
export function nextEmiDate(day, from = today()) {
  const [year, month] = from.split('-').map(Number);
  const inMonth = (y, m) => {
    const last = new Date(y, m, 0).getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
  };
  const thisMonth = inMonth(year, month);
  if (thisMonth >= from) return thisMonth;
  return month === 12 ? inMonth(year + 1, 1) : inMonth(year, month + 1);
}

/**
 * Advance a recurring payment to its next due date, as many times as it takes
 * to catch up. A phone that has been off for two months should not show two
 * months of "overdue" for a standing instruction that paid itself.
 */
export function advanceRecurring(recurring, from = today()) {
  const step = {
    weekly: (d) => addDays(d, 7),
    monthly: (d) => addMonths(d, 1),
    quarterly: (d) => addMonths(d, 3),
    'half-yearly': (d) => addMonths(d, 6),
    yearly: (d) => addMonths(d, 12),
  }[recurring.frequency];

  if (!step || !recurring.nextDueOn) return recurring.nextDueOn;

  let next = recurring.nextDueOn;
  let guard = 0;
  while (next < from && guard++ < 500) {
    const advanced = step(next);
    if (recurring.endsOn && advanced > recurring.endsOn) return next;
    next = advanced;
  }
  return next;
}

/**
 * Bills and EMIs out of the door each month.
 *
 * This is **not** the whole floor — subscriptions and digital assets are not
 * in it, and for a while the screen above it claimed they were. Use
 * `committed()` for the figure a household should be shown; this stays as the
 * bills-and-EMIs half it has always been.
 */
export function committedMonthlyOutflow(recurring, loans) {
  const perMonthAmount = (r) => {
    const amount = addable(r.amount);
    switch (r.frequency) {
      case 'weekly': return divide(amount * 52, 12);
      case 'quarterly': return divide(amount, 3);
      case 'half-yearly': return divide(amount, 6);
      case 'yearly': return divide(amount, 12);
      default: return amount;
    }
  };

  const recurringTotal = sum(recurring
    .filter((r) => settled(r) && r.active !== false && r.kind !== 'salary')
    .map(perMonthAmount));

  const emiTotal = sum(loans
    .filter((l) => settled(l) && l.emiAmount && (!l.endsOn || daysUntil(l.endsOn) > 0))
    .map((l) => l.emiAmount));

  return recurringTotal + emiTotal;
}

/**
 * The household's actual monthly floor, and what is uncertain about it.
 *
 * Bills and EMIs, plus subscriptions that renew themselves — with what only
 * lapses, and what may be recorded twice, reported alongside rather than
 * folded in. See `domain/commitments.js`.
 */
export function committed({
  recurring = [], loans = [], subscriptions = [], digitalAssets = [], detected = [],
} = {}) {
  return commitmentSummary({
    recurring,
    loans,
    subscriptions,
    digitalAssets,
    // What the statements show repeating. Passed through rather than computed
    // here: this module knows nothing about narrations, and the detector wants
    // categorised rows that only the ledger builds.
    detected,
    base: committedMonthlyOutflow(recurring, loans),
  });
}
