/**
 * One category, on a screen.
 *
 * The breakdown on the overview named where the money went; tapping a slice
 * used to reach a filtered ledger, which is a list of dates and amounts and
 * answers only the narrowest form of the question. What a household asks next
 * is *on what, to whom, is it always this much, is there a bill inside it* —
 * so this is the whole of a category in one place: the month against the last,
 * the year behind it, the payees, the commitments filed under it, the budget
 * it is measured against, and the most recent rows with a way through to all
 * of them.
 *
 * The arithmetic is in `domain/category.js` and is tested without a browser.
 * This file is layout.
 */

import { h, replace } from '../../ui/dom.js';
import {
  card, cardHeader, metric, money, badge, button, progress, listItem, empty,
} from '../../ui/components/basics.js';
import { barChart, chartCaption } from '../../ui/components/charts.js';
import { icon } from '../../ui/icons.js';
import { app } from '../../context.js';
import { bus, TOPIC } from '../../core/bus.js';
import { Router } from '../../ui/router.js';
import { format, formatCompact } from '../../core/money.js';
import { formatDay, relativeDays } from '../../core/dates.js';
import { FinanceService } from '../../services/finance.js';
import { categoryTitle } from '../../domain/category.js';
import { t } from '../../core/locale.js';

/** The ledger, filtered to this category — and optionally to one payee in it. */
const ledgerHref = (category, text) => Router.href({
  module: 'finance',
  entity: 'transaction',
  query: text ? { category, text } : { category },
});

/**
 * How often this payee, and when last.
 *
 * A count of one is written as *once* rather than as `1 ×`, because a list
 * where most rows say "3 ×" and one says "1 ×" reads as a rounding fault
 * rather than as a single visit.
 */
const payeeSubtitle = (payee) => (payee.count === 1
  ? t('finance.category.onceAmount', { share: payee.share, day: formatDay(payee.last) })
  : t('finance.category.timesAmount', {
    share: payee.share, n: payee.count, day: formatDay(payee.last),
  }));

export async function render(route) {
  const category = route.id;
  const { db } = app();
  const host = h('div', {});

  async function paint() {
    // Read through the service, on the same transaction limit as every other
    // money figure here: a category total computed from more history than the
    // slice it was opened from would disagree with it.
    const it = await new FinanceService(db).category(category);
    const label = categoryTitle(category);
    const incoming = it.kind === 'income';

    if (!it.count && !it.commitments.length) {
      replace(host, h('div', { class: 'stack' }, [
        backLink(),
        empty({ title: label, message: t('finance.category.empty'), iconName: 'chart' }),
      ]));
      return;
    }

    replace(host, h('div', { class: 'grid grid--wide' }, [
      card({}, [
        backLink(),
        h('div', { class: 'row row--between' }, [
          cardHeader(label),
          badge(incoming ? t('finance.category.income') : t('finance.category.spending')),
        ]),
        // A category can exist with a bill filed under it and nothing spent —
        // insurance, before the first premium leaves. Drawing the figures
        // anyway gives a row of zeros, a year of empty bars and a note about
        // comparing a month in progress, all of it furniture around an absence
        // it never names. So the arithmetic appears when there is arithmetic.
        //
        // The headline gets a row of its own. Three metrics across a 390px
        // phone leaves each about 110px, and `metric-value` is large enough
        // that "₹4.65 K" broke across two lines with the K stranded under the
        // rupees — a figure a household cannot read at a glance is not a
        // headline. One answer, then the two that support it.
        it.count ? h('div', {}, [
          metric({
            label: it.partial ? t('finance.category.soFar') : t('finance.category.thisMonth'),
            value: formatCompact(it.thisMonth),
            // `goodWhen` follows the direction the category runs in: more
            // salary is not the same news as more spending, and one delta
            // component cannot know which it is holding.
            delta: it.change,
            goodWhen: incoming ? 'up' : 'down',
            // The hint names the figure, not just the period. `metric` shows
            // it alone when there is no delta, and a lone "Last month" under a
            // number is a label with nothing to label.
            hint: it.lastMonth
              ? t('finance.category.lastMonth', { amount: formatCompact(it.lastMonth) })
              : t('finance.category.noneLastMonth'),
          }),
        ]) : null,
        it.count ? h('div', { class: 'metric-row spacer' }, [
          metric({
            label: t('finance.category.typical'),
            value: formatCompact(it.average),
            compact: true,
          }),
          metric({
            label: t('finance.category.largest'),
            value: formatCompact(it.largest),
            compact: true,
          }),
        ]) : null,
        // A month in progress compared with a whole month is the reading this
        // repository has already been caught inviting. Said, not corrected.
        it.count && it.partial
          ? h('p', { class: 'small faint' }, t('finance.category.partialNote'))
          : null,
        // One sentence with named placeholders rather than three fragments
        // joined with a separator: word order is the first thing a second
        // language changes, and a `·` glued between `t()` calls cannot move.
        h('p', { class: 'small muted' }, it.since
          ? t('finance.category.recordedSince', {
            n: it.count, day: formatDay(it.since), total: format(it.total),
          })
          : t('finance.category.nothingSpent')),
      ].filter(Boolean)),

      it.budget
        ? card({}, [
          cardHeader(t('finance.category.budget')),
          progress(it.budget.spent, it.budget.limit, {
            warnAt: (it.budget.alertAtPercent ?? 80) / 100,
            label: t('finance.category.budgetUsed', {
              spent: format(it.budget.spent), limit: format(it.budget.limit),
            }),
          }),
        ])
        : null,

      it.count ? card({}, [
        cardHeader(t('finance.category.trend')),
        chartCaption(t('finance.category.trendChart', { category: label })),
        // The unfinished month named in the label rather than in the colour,
        // the same way `spendingBars` does it — a bar a fifth the height of
        // its neighbours is not a fall, and the text axis is what a screen
        // reader is given.
        barChart(it.series.map((month) => ({
          label: month.partial ? t('chart.monthSoFar', { month: month.label }) : month.label,
          value: month.value,
        })), {
          height: 150,
          label: t('finance.category.trendChart', { category: label }),
        }),
      ]) : null,

      it.payees.length
        ? card({}, [
          cardHeader(incoming
            ? t('finance.category.payeesIn') : t('finance.category.payees')),
          h('div', { class: 'list' }, it.payees.slice(0, 8).map((payee) => listItem({
            title: payee.name || t('finance.category.unnamed'),
            subtitle: payeeSubtitle(payee),
            value: money(payee.total),
            // A named payee opens the rows that are its own; an unnamed
            // bucket has no search term that would find only itself, so it
            // stays a row rather than becoming a link to the wrong list.
            href: payee.name ? ledgerHref(category, payee.name) : undefined,
          }))),
        ])
        : null,

      card({}, [
        cardHeader(t('finance.category.bills')),
        it.commitments.length
          ? h('div', { class: 'list' }, it.commitments.map((bill) => listItem({
            title: bill.name,
            subtitle: t('finance.category.due', {
              day: formatDay(bill.nextDueOn), relative: relativeDays(bill.nextDueOn),
            }),
            value: money(bill.amount),
            trailing: bill.autoDebit ? badge(t('finance.category.autoDebit')) : null,
            href: Router.href({
              module: 'finance', entity: 'recurringPayment', id: bill.id,
            }),
          })))
          : h('p', { class: 'small muted' }, t('finance.category.noBills')),
      ]),

      it.rows.length
        ? card({}, [
          cardHeader(t('finance.category.recent')),
          h('div', { class: 'list' }, it.rows.slice(0, 6).map((row) => listItem({
            title: row.payee || label,
            subtitle: formatDay(row.date),
            value: money(row.amount),
            href: Router.href({
              module: 'finance', entity: 'transaction', id: row.id,
            }),
          }))),
          h('div', { class: 'row row--end' }, [
            button(t('finance.category.seeAll', { n: it.count }), {
              iconName: 'chevronRight',
              onClick: () => app().router.navigate({
                module: 'finance', entity: 'transaction', query: { category },
              }),
            }),
          ]),
        ])
        : null,
    ].filter(Boolean)));
  }

  /** Back to the breakdown this was opened from. */
  function backLink() {
    return h('a', {
      class: 'row small back-link',
      href: Router.href({ module: 'finance' }),
    }, [icon('chevronLeft', { size: 16 }), t('finance.category.back')]);
  }

  await paint();
  const off = bus.on(`${TOPIC.dataChanged}:finance`, () => paint());
  return { node: host, destroy: off };
}
