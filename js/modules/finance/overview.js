/**
 * The finance overview.
 *
 * The screen a household actually looks at: where the money went this month,
 * what is due next, whether the accounts still add up. It lives apart from
 * `finance.js` because that file is the module's router and its tab bar, and
 * this is a screen — the two grew together until the file was at the size
 * limit and neither could be read without the other.
 *
 * Everything here is read through `FinanceService`, which assembles the view
 * model where it can be tested without a browser.
 */

import { h, replace } from '../../ui/dom.js';
import {
  card, cardHeader, metric, badge, progress, listItem, empty, avatar,
} from '../../ui/components/basics.js';
import {
  barChart, chartCaption, donutChart, lineChart, seriesColour,
} from '../../ui/components/charts.js';
import { app } from '../../context.js';
import { bus, TOPIC } from '../../core/bus.js';
import { Router } from '../../ui/router.js';
import * as fin from '../../domain/finance.js';
import { format, formatCompact } from '../../core/money.js';
import { formatDay, relativeDays } from '../../core/dates.js';
import { FinanceService } from '../../services/finance.js';
import { transfersCard } from '../finance-transfers.js';
import { describeSettlement } from '../../domain/settlement.js';
import { staleness, describeStaleness, describeEmi } from '../../domain/amortise.js';
import { describeSpendByMember, settleable } from '../../domain/household.js';
import { describeCommitments } from '../../domain/commitments.js';
import { describeRunway } from '../../domain/runway.js';
import { TRANSACTION_LIMIT } from '../../services/service.js';
import { t } from '../../core/locale.js';

/**
 * What to say under an account's name that the name has not said already.
 *
 * The subtitle was `{kind} · {institution}` unconditionally, and a household
 * names its accounts after the bank. So every row on the overview read:
 *
 *     Harbour National Bank savings          <- the name
 *     savings · Harbour National Bank        <- the subtitle
 *
 * Word for word the same, twice, and both truncated with an ellipsis because
 * two long strings do not fit a phone. Seven rows of that on the example
 * household: a line each spent repeating what the line above it said, and the
 * repetition is what made the first line too narrow to finish.
 *
 * So each part is dropped when the name already carries it, and the row falls
 * back to nothing rather than inventing filler — a second line that says
 * nothing is worse than no second line.
 */
function accountSubtitle({ name, kind, institution }) {
  const said = String(name ?? '').toLowerCase();
  const parts = [kind, institution]
    .filter(Boolean)
    .filter((part) => !said.includes(String(part).toLowerCase()));
  return parts.length ? parts.join(' · ') : null;
}

/* --------------------------------------------------------------- overview */


/**
 * Loans, and whether the figure recorded against them still holds.
 *
 * `loan.outstanding` is typed once and nothing updates it. Net worth reads it
 * as the liability, so every EMI takes its full amount off net worth while the
 * debt it repaid stays exactly where it was — and after five years of paying,
 * the application still shows the debt as it was on the day it was entered.
 *
 * The estimate is never written back. A model built from a rate and an EMI
 * cannot know about a reprice, a prepayment or a moratorium, and a household
 * arguing with their bank using a number this application made up would be
 * worse off than one with a stale figure they know is stale.
 */
function loansCard(loans, transactions, held) {
  const live = (loans ?? []).filter((loan) => !loan.deletedAt);
  if (!live.length) return null;

  const rows = live.map((loan) => ({
    loan,
    note: describeStaleness(staleness(loan, transactions), format),
  }));

  return card({}, [
    cardHeader(t('finance.loans.title'), [], {
      subtitle: t('finance.loans.outstanding', {
        amount: format(live.reduce((n, l) => n + (l.outstanding ?? 0), 0)),
      }),
      iconName: 'bank',
    }),

    h('div', { class: 'list' }, rows.map(({ loan, note }) => listItem({
      title: loan.name,
      subtitle: note ?? t('finance.loans.terms', {
        rate: loan.interestRate ?? '—', emi: format(loan.emiAmount ?? 0),
      }),
      value: format(loan.outstanding ?? 0),
      leading: badge(loan.kind ?? 'loan', note ? 'warning' : ''),
    }))),

    rows.some((r) => r.note)
      ? h('p', { class: 'small faint' }, t('finance.loans.estimates'))
      : null,

    // A held repayment makes the estimate above look further from the stored
    // balance than it is. Said here rather than left to the runway line, which
    // counts every held row and not the ones these figures read.
    held ? h('p', { class: 'small faint' }, held) : null,
  ].filter(Boolean));
}

/**
 * Who in the household paid for things this month.
 *
 * Hidden entirely when nothing carries a person, because a card reading "no
 * data" every month teaches somebody to stop looking at it.
 *
 * The coverage line is not a caveat bolted on. `transaction.person` is optional
 * and no importer sets it, so the percentages are shares of what is *tagged*;
 * a household reading them as shares of their spending would be wrong by
 * whatever fraction nobody filled in — and wronger the more they import.
 */
function memberCard(report) {
  if (!report?.members.length) return null;

  return card({}, [
    cardHeader(t('finance.members.title'), [], {
      subtitle: report.complete
        ? t('finance.members.complete')
        : t('finance.members.coverage', { percent: report.coverage }),
      iconName: 'user',
    }),

    h('div', { class: 'list' }, report.members.map((member) => listItem({
      leading: avatar(member.person.name),
      title: member.person.name,
      subtitle: member.topCategory
        ? t('finance.members.topCategory', {
          payments: t('finance.members.payments', { n: member.count }),
          category: member.topCategory,
        })
        : t('finance.members.payments', { n: member.count }),
      value: format(member.spent),
      trailing: badge(`${member.shareOfTagged}%`),
    }))),

    h('p', { class: 'small faint' }, describeSpendByMember(report, format)),

    // Said plainly rather than left as an absence. Somebody looking at a
    // per-person breakdown is one step from asking who owes whom, and the
    // honest answer is that this application does not record what it would
    // need to know.
    h('p', { class: 'small faint' }, settleable().why),
  ].filter(Boolean));
}

/**
 * The line under a due bill.
 *
 * A card bill names the statement it came from, because the figure is what was
 * outstanding when that statement cut and not what is on the card today —
 * anything spent since belongs to the next cycle, and a household paying the
 * current balance hands the bank an interest-free loan on the difference.
 */
function billSubtitle(bill) {
  const when = t('finance.bills.when', {
    day: formatDay(bill.dueOn), relative: relativeDays(bill.dueOn),
  });
  // A subscription that does not renew itself stops on that date. Left
  // unsaid, the row looks identical to a bill that pays itself.
  if (bill.source === 'subscription') {
    return bill.why ? t('finance.bills.whenWhy', { when, why: bill.why }) : when;
  }
  if (bill.source !== 'card') return when;
  if (!bill.statement) return t('finance.bills.whenWhy', { when, why: bill.why });
  return t('finance.bills.fromStatement', { when, day: formatDay(bill.statement) });
}

export async function financeOverview() {
  const { db } = app();
  const host = h('div', {});

  async function paint() {
    // The whole view model, assembled in `services/finance.js` where it can be
    // tested without a browser. This screen used to build it inline from eight
    // entities, which is the first of the two gaps the service layer exists to
    // close — and the reason three silent wiring failures went unnoticed here.
    const {
      transactions, loans, balances, compare, series, balanceSeries, runway, truncated,
      categories, settlement, emi, byMember, bills, budgetRows, commitment,
      transfers, unreadable, held, runwayHeld, billsHeld, loansHeld,
    } = await new FinanceService(db).overview();

    replace(host, h('div', { class: 'grid grid--wide' }, [
      transfersCard(db, transfers, paint),
      memberCard(byMember),

      card({}, [
        cardHeader(t('finance.overview.thisMonth')),
        h('div', { class: 'metric-row' }, [
          metric({
            label: t('finance.overview.spent'),
            value: formatCompact(compare.current.expense),
            delta: compare.expenseChange,
            goodWhen: 'down',
            hint: fin.comparedWith(compare),
          }),
          metric({
            label: t('finance.overview.received'),
            value: formatCompact(compare.current.income),
            delta: compare.incomeChange,
            hint: fin.comparedWith(compare),
          }),
          metric({
            label: t('finance.overview.net'),
            value: formatCompact(compare.current.net),
            compact: true,
          }),
        ]),
        // Said next to the number it is about, and it never changes the number
        // itself. A total that quietly shrank because a second file was
        // imported would be worse than the double count, because nobody would
        // know why.
        settlement.settlements.length ? h('p', {
          class: settlement.corrected ? 'small money--negative' : 'small faint',
        }, describeSettlement(settlement, compare.current.expense, format)) : null,
        unreadable ? h('p', { class: 'small money--negative' }, unreadable) : null,

        /*
         * `faint`, not `money--negative`, and the difference is the point.
         * An unreadable amount is a row somebody has to go and fix. A held row
         * fixes itself on the next sync that brings what it names, so telling
         * a household their money is wrong would be a false alarm every time.
         * It still has to be said: without it the figure above is quietly
         * about fewer rows than it looks.
         */
        held ? h('p', { class: 'small faint' }, held) : null,

        // Deliberately `faint` rather than a warning: unlike the card bill,
        // nothing here is wrong. The figure above is a correct cash-flow
        // number, and this says which part of it was a cost.
        emi.total
          ? h('p', { class: 'small faint' }, describeEmi(emi, format))
          : null,

        h('p', { class: 'small faint' }, describeCommitments(commitment, format)),

        // A shortfall is a fact and reads as one; the absence of a shortfall is
        // deliberately not reassurance, so it stays `faint` rather than
        // becoming a green tick. See `domain/runway.js`.
        h('p', {
          class: runway.shortfall ? 'small money--negative' : 'small faint',
        }, describeRunway(runway, format)),

        /*
         * Beside the runway figure rather than the month's totals, because it
         * is about a different set of rows. The sentence higher up covers the
         * month; this covers the history runway is built from, and a row held
         * in neither window would otherwise be excluded from a forecast with
         * nothing on the screen to say so.
         */
        runwayHeld ? h('p', { class: 'small faint' }, runwayHeld) : null,

        // Said where the figure is, not in a tooltip. A forecast whose
        // assumptions are hidden is a forecast presenting itself as an answer.
        runway.assumptions.length
          ? h('p', { class: 'small faint' },
            t('finance.overview.assuming', { list: runway.assumptions.join('; ') }))
          : null,
      ].filter(Boolean)),

      loansCard(loans, transactions, loansHeld),

      card({}, [
        cardHeader(t('finance.overview.cash')),

        // Said where the balances are, not in a log. A balance summed from the
        // most recent rows is not the account's balance once there are more of
        // them than that, and the household is the only one who can tell
        // whether it matters to them.
        truncated
          ? h('p', { class: 'small money--negative' }, t('finance.overview.truncated', {
            n: TRANSACTION_LIMIT.toLocaleString('en-IN'),
          }))
          : null,
        metric({
          label: t('finance.overview.liquid'),
          value: formatCompact(fin.liquidCash(balances)),
        }),
        h('div', { class: 'list' }, balances
          .filter((a) => !a.archived)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 8)
          .map((account) => listItem({
            title: account.name,
            subtitle: accountSubtitle(account),
            value: format(account.balance),
            tone: account.balance < 0 ? 'negative' : null,
            trailing: account.utilisation !== null && account.utilisation > 0.3
              ? badge(t('finance.overview.utilisation', {
                percent: Math.round(account.utilisation * 100),
              }),
                account.utilisation > 0.7 ? 'danger' : 'warning')
              : null,
            href: Router.href({ module: 'finance', entity: 'account', id: account.id }),
          }))),
      ]),

      // Two charts under one heading, and nothing on screen said which was
      // which. Captioned from the same string each already carries.
      card({}, [
        cardHeader(t('finance.overview.year')),
        chartCaption(t('finance.overview.yearChart')),
        barChart(fin.spendingBars(series), {
          height: 140,
          label: t('finance.overview.yearChart'),
          tone: () => seriesColour(1),
        }),
        chartCaption(t('finance.overview.netChart')),
        lineChart(balanceSeries, { height: 120, label: t('finance.overview.netChart') }),
      ]),

      categories.length
        ? card({}, [
          cardHeader(t('finance.overview.categories')),
          // Each slice opens the category behind it — not a filtered list of
          // dates, but what that category *is*: the month against the last,
          // the year behind it, who it went to, the bills filed under it.
          //
          // `label` is the category key itself — `byCategory` buckets on
          // `t.category` — so the legend and the screen it opens cannot drift
          // apart into two spellings of one thing.
          donutChart(categories, {
            label: t('finance.overview.categoryChart'),
            size: 160,
            hrefFor: (slice) => Router.href({
              module: 'finance', entity: 'category', id: slice.label,
            }),
          }),
        ])
        : null,

      budgetRows.length
        ? card({}, [
          cardHeader(t('finance.overview.budgets'), badge(
            t('finance.overview.overBudget', {
              n: budgetRows.filter((b) => b.state === 'over').length,
            }),
            budgetRows.some((b) => b.state === 'over') ? 'danger' : 'positive',
          )),
          h('div', { class: 'stack' }, budgetRows.map((b) => h('div', { class: 'stack stack--tight' }, [
            h('div', { class: 'row row--between small' }, [
              h('span', {}, b.category),
              h('span', { class: 'numeric muted' },
                b.remaining >= 0
                  ? t('finance.overview.left', { amount: format(b.remaining) })
                  : t('finance.overview.over', { amount: format(-b.remaining) })),
            ]),
            progress(b.spent, b.limit, { warnAt: (b.alertAtPercent ?? 80) / 100 }),
          ]))),
        ])
        : null,

      card({ class: 'card--flush' }, [
        h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } }, [
          cardHeader(t('finance.overview.due')),

          // A card bill short a held purchase is the one figure here where
          // being wrong is expensive, so it says so rather than presenting a
          // statement balance quietly about fewer rows. Inside the header's
          // own padding rather than in a box of its own: `card--flush` has no
          // body padding, and a second inline style here would be a second
          // place to change the spacing.
          billsHeld ? h('p', { class: 'small faint' }, billsHeld) : null,
        ].filter(Boolean)),
        bills.length
          ? h('div', { class: 'list' }, bills.map((bill) => listItem({
            title: bill.name,
            subtitle: billSubtitle(bill),
            // A card with no statement day knows the date and not the figure.
            // An em dash says that; a number here would be one this
            // application invented, on the bill where being wrong is dearest.
            value: bill.amount === null ? '—' : format(bill.amount),
            trailing: bill.overdue ? badge('overdue', 'danger')
              : bill.source === 'card' ? badge('statement')
                : bill.autoDebit ? badge('auto') : null,
          })))
          : empty({ title: t('finance.overview.nothingDue'), iconName: 'check' }),
      ].filter(Boolean)),
    ].filter(Boolean)));
  }

  await paint();
  const off = bus.on(`${TOPIC.dataChanged}:finance`, () => paint());
  return { node: host, destroy: off };
}
