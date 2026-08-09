/**
 * Finance.
 *
 * The one module that needs more than a list, because money is the thing
 * people look at rather than search. The overview answers "where does it go"
 * before any table is opened; the tabs below it are the generic CRUD screens,
 * so a transaction looks and validates the same here as anywhere else.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, metric, money, badge, button, pageHeader, progress, listItem, chip, empty,
} from '../ui/components/basics.js';
import { barChart, donutChart, lineChart, seriesColour } from '../ui/components/charts.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import * as fin from '../domain/finance.js';
import { format, formatCompact } from '../core/money.js';
import { formatDay, relativeDays } from '../core/dates.js';
import { entitiesOfModule } from '../data/schema.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'transaction', label: 'Transactions' },
  { id: 'account', label: 'Accounts' },
  { id: 'import', label: 'Import' },
  { id: 'bankStatement', label: 'Statements' },
  { id: 'shops', label: 'Shops' },
  { id: 'budget', label: 'Budgets' },
  { id: 'recurringPayment', label: 'Recurring' },
  { id: 'loan', label: 'Loans' },
];

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const active = route.entity ?? 'overview';
  const host = h('div', {});
  let section = null;

  const body = h('div', {});

  const tabs = h('div', {
    class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' },
  }, TABS.map((tab) => chip(tab.label, {
    pressed: tab.id === active,
    onClick: () => app().router.navigate(
      tab.id === 'overview'
        ? { module: 'finance' }
        : { module: 'finance', entity: tab.id },
    ),
  })));

  replace(host, [
    pageHeader('Finance', {
      subtitle: 'Where the money is, and where it went',
      actions: active === 'import' || active === 'shops' ? []
        : active !== 'overview'
        ? [button('Add', { variant: 'primary', iconName: 'plus', onClick: () => section?.openForm() })]
        : [button('Add transaction', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'finance', entity: 'transaction', id: 'new' }),
        })],
    }),
    tabs,
    body,
  ]);

  if (active === 'overview') {
    const overview = await financeOverview();
    replace(body, overview.node);
    return { node: host, destroy: overview.destroy };
  }

  // Not entities — screens that produce them. Loaded on demand: one pulls in
  // the PDF reader, the other the merchant registry, and neither is needed
  // until somebody opens the tab.
  if (active === 'import') {
    const screen = await (await import('./statements.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  if (active === 'shops') {
    const screen = await (await import('./receipts.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  const known = entitiesOfModule('finance').some((e) => e.name === active);
  if (!known) {
    replace(body, empty({ title: 'Unknown section', iconName: 'info' }));
    return { node: host };
  }

  section = await listSection(active, { autoOpenNew: route.id === 'new' });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/* --------------------------------------------------------------- overview */

async function financeOverview() {
  const { db } = app();
  const host = h('div', {});

  async function paint() {
    const [accounts, transactions, budgets, recurring, loans] = await Promise.all([
      db.repo('account').list({ decrypt: false, limit: 500 }),
      db.repo('transaction').list({ decrypt: false, limit: 20_000 }),
      db.repo('budget').list({ decrypt: false }),
      db.repo('recurringPayment').list({ decrypt: false }),
      db.repo('loan').list({ decrypt: false }),
    ]);

    const balances = fin.accountBalances(accounts, transactions);
    const compare = fin.comparePeriods(transactions);
    const series = fin.monthlySeries(transactions, 12);
    const categories = fin.byCategory(fin.inPeriod(transactions, 'month'));
    const bills = fin.upcomingBills(recurring, loans, { days: 30 });
    const budgetRows = fin.budgetStatus(budgets, transactions);
    const committed = fin.committedMonthlyOutflow(recurring, loans);

    // Running balance across the year, so a downward drift is visible before
    // it becomes a problem.
    let running = 0;
    const balanceSeries = series.map((month) => {
      running += month.net;
      return { label: month.label, value: running };
    });

    replace(host, h('div', { class: 'grid grid--wide' }, [
      card({}, [
        cardHeader('This month'),
        h('div', { class: 'row', style: { gap: 'var(--space-6)' } }, [
          metric({
            label: 'Spent',
            value: formatCompact(compare.current.expense),
            delta: compare.expenseChange,
            goodWhen: 'down',
            hint: 'vs last month',
          }),
          metric({
            label: 'Received',
            value: formatCompact(compare.current.income),
            delta: compare.incomeChange,
            hint: 'vs last month',
          }),
          metric({
            label: 'Net',
            value: formatCompact(compare.current.net),
            compact: true,
          }),
        ]),
        h('p', { class: 'small faint' },
          `${format(committed)} a month is already committed to bills, EMIs and subscriptions.`),
      ]),

      card({}, [
        cardHeader('Cash & accounts'),
        metric({
          label: 'Liquid cash',
          value: formatCompact(fin.liquidCash(balances)),
        }),
        h('div', { class: 'list' }, balances
          .filter((a) => !a.archived)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 8)
          .map((account) => listItem({
            title: account.name,
            subtitle: `${account.kind}${account.institution ? ` · ${account.institution}` : ''}`,
            value: format(account.balance),
            tone: account.balance < 0 ? 'negative' : null,
            trailing: account.utilisation !== null && account.utilisation > 0.3
              ? badge(`${Math.round(account.utilisation * 100)}% used`,
                account.utilisation > 0.7 ? 'danger' : 'warning')
              : null,
            href: Router.href({ module: 'finance', entity: 'account', id: account.id }),
          }))),
      ]),

      card({}, [
        cardHeader('Twelve months'),
        barChart(series.map((m) => ({ label: m.label, value: m.expense })), {
          height: 140,
          label: 'Spending by month over a year',
          tone: () => seriesColour(1),
        }),
        lineChart(balanceSeries, { height: 120, label: 'Cumulative net position' }),
      ]),

      categories.length
        ? card({}, [
          cardHeader('Where it went this month'),
          donutChart(categories, { label: 'Spending by category', size: 160 }),
        ])
        : null,

      budgetRows.length
        ? card({}, [
          cardHeader('Budgets', badge(
            `${budgetRows.filter((b) => b.state === 'over').length} over`,
            budgetRows.some((b) => b.state === 'over') ? 'danger' : 'positive',
          )),
          h('div', { class: 'stack' }, budgetRows.map((b) => h('div', { class: 'stack stack--tight' }, [
            h('div', { class: 'row row--between small' }, [
              h('span', {}, b.category),
              h('span', { class: 'numeric muted' },
                b.remaining >= 0 ? `${format(b.remaining)} left` : `${format(-b.remaining)} over`),
            ]),
            progress(b.spent, b.limit, { warnAt: (b.alertAtPercent ?? 80) / 100 }),
          ]))),
        ])
        : null,

      card({ class: 'card--flush' }, [
        h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
          cardHeader('Due in the next 30 days')),
        bills.length
          ? h('div', { class: 'list' }, bills.map((bill) => listItem({
            title: bill.name,
            subtitle: `${formatDay(bill.dueOn)} · ${relativeDays(bill.dueOn)}`,
            value: format(bill.amount),
            trailing: bill.overdue ? badge('overdue', 'danger')
              : bill.autoDebit ? badge('auto') : null,
          })))
          : empty({ title: 'Nothing due', iconName: 'check' }),
      ]),
    ].filter(Boolean)));
  }

  await paint();
  const off = bus.on(`${TOPIC.dataChanged}:finance`, () => paint());
  return { node: host, destroy: off };
}

export { money };
