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
import { TransfersService } from '../services/transfers.js';
import { CONFIDENCE } from '../domain/events.js';
import { toast } from '../ui/components/toast.js';
import { userMessage } from '../core/errors.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'transaction', label: 'Transactions' },
  { id: 'account', label: 'Accounts' },
  { id: 'import', label: 'Import' },
  { id: 'bankStatement', label: 'Imported files' },
  { id: 'shops', label: 'Shops' },
  { id: 'people', label: 'People' },
  { id: 'lending', label: 'Lending' },
  { id: 'insights', label: 'Insights' },
  { id: 'budget', label: 'Budgets' },
  { id: 'recurringPayment', label: 'Recurring' },
  { id: 'loan', label: 'Loans' },
];

/** Screens that produce records rather than listing one entity. */
const NO_ADD = new Set(['import', 'shops', 'people', 'lending', 'insights', 'transaction', 'bankStatement']);

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
      actions: NO_ADD.has(active) ? []
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

  // Transactions get a ledger rather than the schema's generic table: money in
  // and money out need separate columns, and one row needs to open in place.
  if (active === 'transaction' && !route.id) {
    const screen = await (await import('./transactions.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  // Imported files, not the raw records: an import is a statement *and* the
  // transactions it created, and removing one has to remove both.
  if (active === 'bankStatement' && !route.id) {
    const screen = await (await import('./imports.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  if (active === 'shops') {
    const screen = await (await import('./receipts.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  // The ledgers: who money moved between, who owes whom, and what is worth
  // saying about it. All three read the same categorised history, so they are
  // one module with a view argument rather than three that load it three times.
  if (active === 'people' || active === 'lending' || active === 'insights') {
    const screen = await (await import('./ledgers.js')).render(active);
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

/**
 * The two ends of one movement, offered for joining up.
 *
 * Hidden entirely when there is nothing to join, because a card that is empty
 * most months teaches somebody to stop looking at it.
 *
 * The two confidences are rendered differently on purpose. A probable pairing
 * gets a button; a possible one gets a sentence saying why nobody can tell,
 * and no button at all. Offering a confirm control for an uncertain pairing
 * would move the deciding from the person to the click.
 */
function transfersCard(db, transfers, repaint) {
  const { proposals, total, unmatched } = transfers;
  if (!proposals.length && !unmatched.length) return null;

  const probable = proposals.filter((p) => p.confidence === CONFIDENCE.PROBABLE);
  const questions = proposals.filter((p) => p.confidence === CONFIDENCE.POSSIBLE);

  async function confirm(proposal) {
    try {
      await new TransfersService(db).confirm(proposal);
      toast('Recorded as one movement — both statement rows are kept', { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  const line = (p) => listItem({
    title: `${p.fromName} → ${p.toName}`,
    subtitle: `${formatDay(p.out.date)} · ${p.why}`,
    value: format(p.amount),
    leading: badge(p.confidence, p.confidence === CONFIDENCE.PROBABLE ? 'info' : 'warning'),
    trailing: p.confidence === CONFIDENCE.PROBABLE
      ? button('One movement', { variant: 'subtle', onClick: () => confirm(p) })
      : null,
  });

  return card({}, [
    cardHeader('Money you moved between your own accounts', [], {
      subtitle: total.movements
        ? `${format(total.moved)} across ${total.movements} ${total.movements === 1 ? 'movement' : 'movements'}`
        : 'Nothing confirmed yet',
      iconName: 'refresh',
    }),

    // The sentence the per-account figures cannot say. Each of them carries
    // the full amount — right for one account, and twice for one movement.
    h('p', { class: 'small muted' },
      'A transfer between your own accounts appears twice, once on each statement. '
      + 'These are the pairs that look like one movement. Confirming keeps both rows.'),

    probable.length ? h('div', { class: 'list' }, probable.map(line)) : null,

    questions.length
      ? h('details', { class: 'small' }, [
        h('summary', {}, `${questions.length} that nobody can decide from the figures`),
        h('div', { class: 'list' }, questions.map(line)),
      ])
      : null,

    unmatched.length
      ? h('p', { class: 'small faint' },
        `${unmatched.length} transfer ${unmatched.length === 1 ? 'row has' : 'rows have'} no `
        + 'partner at all — usually the other account\u2019s statement has not been imported.')
      : null,
  ].filter(Boolean));
}

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

    const transfers = await new TransfersService(db).pending();

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
      transfersCard(db, transfers, paint),

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
