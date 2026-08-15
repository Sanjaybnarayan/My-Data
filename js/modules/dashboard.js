/**
 * The dashboard.
 *
 * What a household actually needs to see on opening the app: what it is
 * worth, what is about to expire, what is due, and what changed. Every figure
 * is computed from stored records by the `domain/` functions — nothing on this
 * screen is a number somebody typed into a "dashboard settings" page.
 *
 * Widgets are individually toggleable and reorderable, and the arrangement is
 * stored in `meta`, so it syncs with everything else and a second device shows
 * the same dashboard.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, metric, money, badge, button, empty, progress, listItem,
  pageHeader, avatar, dueBadge,
} from '../ui/components/basics.js';
import { donutChart, barChart, seriesColour } from '../ui/components/charts.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { netWorth } from '../domain/networth.js';
import * as fin from '../domain/finance.js';
import { portfolioSummary, allocation } from '../domain/portfolio.js';
import { allReminders } from '../domain/reminders.js';
import { recentActivity, describe as describeAudit } from '../data/audit.js';
import { formatCompact, format } from '../core/money.js';
import { formatDay, relativeDays, today } from '../core/dates.js';
import { summarise } from '../ai/summary.js';
import { TRANSACTION_LIMIT, transactionsTruncated } from '../services/service.js';
import { EstateService } from '../services/estate.js';

const WIDGET_KEY = 'dashboard.widgets';

const ALL_WIDGETS = [
  'summary', 'networth', 'spending', 'reminders', 'bills', 'budgets',
  'portfolio', 'nominations', 'dates', 'tasks', 'activity',
];

export async function render() {
  const { db } = app();
  const host = h('div', {});

  const enabled = (await db.meta(WIDGET_KEY)) ?? ALL_WIDGETS;

  async function paint() {
    const data = await loadAll(db);
    replace(host, [
      pageHeader(greeting(db.actor), {
        subtitle: formatDay(today()),
        actions: [button('Customise', {
          variant: 'subtle', iconName: 'settings', onClick: () => customise(enabled, paint),
        })],
      }),
      h('div', { class: 'grid grid--wide' },
        enabled.map((id) => WIDGETS[id]?.(data)).filter(Boolean)),
    ]);
  }

  await paint();
  const off = bus.on(TOPIC.dataChanged, () => paint());

  return { node: host, destroy: off };
}

/* -------------------------------------------------------------- data load */

/**
 * One read of everything the dashboard needs, rather than a read per widget.
 * Nine widgets each fetching transactions is nine passes over the same store.
 */
async function loadAll(db) {
  const names = ['account', 'transaction', 'holding', 'investmentTransaction', 'property',
    'vehicle', 'loan', 'policy', 'recurringPayment', 'budget', 'task', 'person',
    'importantDate', 'document', 'subscription', 'healthRecord', 'appointment',
    'education', 'certificate', 'digitalAsset', 'medication', 'vaccination'];

  const byEntity = {};
  for (const name of names) {
    try {
      byEntity[name] = await db.repo(name).list({ decrypt: false, limit: TRANSACTION_LIMIT });
    } catch {
      // A role without read access simply has no data for that widget.
      byEntity[name] = [];
    }
  }

  const accounts = fin.accountBalances(byEntity.account, byEntity.transaction);

  return {
    ...byEntity,
    accounts,
    // The same signal the Finance screen carries. Net worth is built on these
    // balances, so a partial history makes the headline figure partial too, and
    // this is the screen a household looks at first.
    truncated: transactionsTruncated(byEntity.transaction),
    net: netWorth({
      accounts: byEntity.account,
      transactions: byEntity.transaction,
      holdings: byEntity.holding,
      properties: byEntity.property,
      vehicles: byEntity.vehicle,
      loans: byEntity.loan,
    }),
    compare: fin.comparePeriods(byEntity.transaction),
    reminders: allReminders(byEntity, { horizonDays: 45 }),
    bills: fin.upcomingBills(byEntity.recurringPayment, byEntity.loan, {
      days: 30,
      accounts: byEntity.account,
      transactions: byEntity.transaction,
      // Both were already producing a date reminder here with no money
      // attached to it, which is the half that costs nothing to know.
      subscriptions: byEntity.subscription,
      digitalAssets: byEntity.digitalAsset,
    }),
    activity: await recentActivity(db.adapter, { limit: 8 }),
    // Assembled by its own service rather than from `byEntity` above, and the
    // reason is not tidiness: the three nominee fields are encrypted, this
    // loader reads everything with `decrypt: false`, and a nominations widget
    // built from ciphertext would report **no gaps at all** — every record
    // would look as though it carried a nominee. The one screen built to say
    // "these have nobody named on them" would say nothing.
    estate: await new EstateService(db).review(),
    people: Object.fromEntries(byEntity.person.map((p) => [p.id, p.name])),
  };
}

/* ---------------------------------------------------------------- widgets */

/** Which record sits behind a bill, so tapping one opens something. */
/**
 * The record behind a bill, so tapping one opens something.
 *
 * Card and subscription bills are derived rather than stored, so their own ids
 * open nothing — the account, or the subscription, is the record they came
 * from. Subscriptions live under Digital, not Finance.
 */
const DIGITAL = new Set(['subscription', 'digitalAsset']);

/** Where each nominated entity's record lives, so a gap opens the thing itself. */
const MODULE_OF = { account: 'finance', holding: 'investments', policy: 'insurance' };

function billHref(bill) {
  return Router.href({
    module: DIGITAL.has(bill.entity) ? 'digital' : 'finance',
    entity: bill.entity,
    id: bill.recordId,
  });
}

/**
 * The total under a bill list, saying so when a bill was left out of it.
 *
 * A card with no statement day has a date and no amount. Adding it in as zero
 * would print a total that is quietly short with nothing on screen to explain
 * why, which is worse than the missing figure itself.
 */
function billsFooter({ total, unknown }) {
  return h('div', { class: 'card-footer', style: { padding: 'var(--space-3) var(--space-5)' } }, [
    h('span', { class: 'small muted' }, unknown
      ? `Total due · ${unknown} without an amount`
      : 'Total due'),
    h('span', { class: 'spacer' }),
    money(total),
  ]);
}

const WIDGETS = {
  summary: (data) => card({}, [
    cardHeader('At a glance', null, { iconName: 'sparkle' }),
    h('p', { style: { lineHeight: '1.7' } }, summarise(data)),
  ]),

  networth: (data) => card({}, [
    cardHeader('Family net worth', h('a', {
      class: 'btn btn--small', href: Router.href({ module: 'investments' }),
    }, 'Details')),
    metric({
      label: 'Assets minus liabilities',
      value: formatCompact(data.net.total),
      hint: `${format(data.net.assets)} assets · ${format(data.net.liabilities)} owed`,
    }),
    data.net.breakdown.length
      ? donutChart(
        data.net.breakdown.filter((b) => b.value > 0),
        { label: 'Net worth breakdown', size: 150 },
      )
      : h('p', { class: 'small faint' }, 'Add an account or an investment to see this.'),
    data.truncated
      ? h('p', { class: 'small money--negative' },
        `Only the most recent ${TRANSACTION_LIMIT.toLocaleString('en-IN')} transactions `
        + 'were read, so the balances behind this figure are computed from part '
        + 'of your history rather than all of it.')
      : null,
    data.net.staleValuations.length
      ? h('p', { class: 'small faint' }, [
        icon('info', { size: 14 }),
        ` ${data.net.staleValuations.length} item${data.net.staleValuations.length === 1 ? '' : 's'} `
        + 'valued at cost or excluded — update the valuations for a truer figure.',
      ])
      : null,
  ]),

  spending: (data) => {
    const series = fin.monthlySeries(data.transaction, 6);
    const categories = fin.byCategory(fin.inPeriod(data.transaction, 'month')).slice(0, 6);

    return card({}, [
      cardHeader('This month', h('a', {
        class: 'btn btn--small', href: Router.href({ module: 'finance', entity: 'transaction' }),
      }, 'All')),
      h('div', { class: 'row', style: { gap: 'var(--space-6)' } }, [
        metric({
          label: 'Spent',
          value: formatCompact(data.compare.current.expense),
          delta: data.compare.expenseChange,
          goodWhen: 'down',
          hint: 'vs last month',
        }),
        metric({
          label: 'Received',
          value: formatCompact(data.compare.current.income),
          delta: data.compare.incomeChange,
          hint: 'vs last month',
        }),
      ]),
      barChart(series.map((m) => ({ label: m.label, value: m.expense })), {
        height: 110,
        label: 'Monthly spending over six months',
        tone: () => seriesColour(1),
      }),
      categories.length
        ? h('div', { class: 'stack stack--tight', style: { marginTop: 'var(--space-4)' } },
          categories.map((c, i) => h('div', { class: 'row row--between small' }, [
            h('span', { class: 'legend-item' }, [
              h('span', { class: 'legend-swatch', style: { background: seriesColour(i) } }),
              c.label,
            ]),
            money(c.value),
          ])))
        : null,
    ]);
  },

  reminders: (data) => {
    const rows = data.reminders.filter((r) => r.group === 'expiry').slice(0, 8);
    return card({ class: 'card--flush' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader('Expiring & due', badge(String(rows.length), rows.some((r) => r.days < 0) ? 'danger' : ''), { iconName: 'alert' })),
      rows.length
        ? h('div', { class: 'list' }, rows.map((r) => listItem({
          title: r.title,
          subtitle: `${r.label} · ${formatDay(r.date)}`,
          trailing: dueBadge(r.date, { leadDays: 30 }),
          href: Router.href({ module: r.module, entity: r.entity, id: r.recordId }),
        })))
        : empty({ title: 'Nothing expiring', message: 'Everything is in date.', iconName: 'check' }),
    ]);
  },

  bills: (data) => card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      cardHeader('Bills in the next 30 days', null, { iconName: 'repeat' })),
    data.bills.length
      ? h('div', { class: 'list' }, data.bills.slice(0, 8).map((bill) => listItem({
        title: bill.name,
        // A subscription that does not renew itself lapses on that date. It is
        // not auto-debit and it is not silence either.
        subtitle: `${formatDay(bill.dueOn)}${bill.autoDebit ? ' · auto-debit'
          : bill.source === 'subscription' ? ' · lapses unless renewed' : ''}`,
        // A card with no statement day knows the date and not the figure, and
        // an invented number here would be on the dearest bill in the list.
        value: bill.amount === null ? '—' : format(bill.amount),
        trailing: bill.overdue ? badge('overdue', 'danger') : null,
        href: billHref(bill),
      })))
      : empty({ title: 'No bills due', iconName: 'check' }),
    data.bills.length
      ? billsFooter(fin.billsTotal(data.bills))
      : null,
  ]),

  budgets: (data) => {
    const rows = fin.budgetStatus(data.budget, data.transaction);
    if (!rows.length) return null;
    return card({}, [
      cardHeader('Budgets', null, { iconName: 'target' }),
      h('div', { class: 'stack' }, rows.slice(0, 6).map((b) => h('div', { class: 'stack stack--tight' }, [
        h('div', { class: 'row row--between small' }, [
          h('span', {}, b.category),
          h('span', { class: 'numeric muted' }, `${format(b.spent)} of ${format(b.limit)}`),
        ]),
        progress(b.spent, b.limit, { warnAt: (b.alertAtPercent ?? 80) / 100 }),
      ]))),
    ]);
  },

  portfolio: (data) => {
    const summary = portfolioSummary(data.holding);
    if (!summary.count) return null;
    return card({}, [
      cardHeader('Investments', h('a', {
        class: 'btn btn--small', href: Router.href({ module: 'investments' }),
      }, 'Open')),
      h('div', { class: 'row', style: { gap: 'var(--space-6)' } }, [
        metric({ label: 'Value', value: formatCompact(summary.value) }),
        metric({
          label: 'Gain',
          value: formatCompact(summary.gain),
          delta: summary.gainPercent,
          compact: true,
        }),
      ]),
      donutChart(allocation(data.holding), { label: 'Asset allocation', size: 140 }),
    ]);
  },

  /**
   * Which accounts, investments and policies have nobody named on them.
   *
   * Not ranked by money, and the total is deliberately beside the count rather
   * than in place of it: an unnominated account becomes an unclaimed deposit
   * whatever its balance, and a list sorted by size tells a household the small
   * ones matter less.
   */
  nominations: (data) => {
    const { gaps, atStake, valueUnknown, unreadable, notice } = data.estate;
    if (!gaps.length && !unreadable) return null;

    return card({ class: 'card--flush nominations' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader('Nobody nominated', badge(String(gaps.length), 'warning'),
          { iconName: 'alert' })),

      h('p', { class: 'small muted', style: { padding: '0 var(--space-5)' } }, notice),

      h('div', { class: 'list' }, gaps.slice(0, 8).map((gap) => listItem({
        title: gap.name,
        subtitle: gap.where,
        // Never a zero. A record whose value this screen does not know shows a
        // dash, the same way a card bill with no statement day does.
        value: gap.amount === null ? '—' : format(gap.amount),
        href: Router.href({ module: MODULE_OF[gap.entity], entity: gap.entity, id: gap.id }),
      }))),

      h('div', { class: 'card-footer', style: { padding: 'var(--space-3) var(--space-5)' } }, [
        h('span', { class: 'small muted' }, valueUnknown
          ? `Known value at stake · ${valueUnknown} without one recorded`
          : 'Value at stake'),
        h('span', { class: 'spacer' }),
        money(atStake),
      ]),

      // A bug report, not a finding. It means this widget was handed records it
      // could not read, and saying nothing would look like good news.
      unreadable
        ? h('p', { class: 'small faint', style: { padding: '0 var(--space-5) var(--space-4)' } },
          `${unreadable} record${unreadable === 1 ? '' : 's'} could not be read here, `
          + 'so they are counted in neither list.')
        : null,
    ]);
  },

  dates: (data) => {
    const rows = data.reminders.filter((r) => r.group === 'date').slice(0, 6);
    if (!rows.length) return null;
    return card({ class: 'card--flush' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader('Coming up', null, { iconName: 'cake' })),
      h('div', { class: 'list' }, rows.map((d) => listItem({
        leading: avatar(data.people[d.personId] ?? d.title),
        title: d.title,
        subtitle: `${formatDay(d.date)} · ${relativeDays(d.date)}`,
        trailing: d.turning ? badge(`turns ${d.turning}`) : null,
      }))),
    ]);
  },

  tasks: (data) => {
    const open = data.task
      .filter((t) => t.status !== 'done')
      .sort((a, b) => (a.dueOn || '9999').localeCompare(b.dueOn || '9999'))
      .slice(0, 6);
    return card({ class: 'card--flush' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader('Tasks', h('a', {
          class: 'btn btn--small', href: Router.href({ module: 'tasks' }),
        }, 'All'), { iconName: 'check' })),
      open.length
        ? h('div', { class: 'list' }, open.map((t) => listItem({
          title: t.title,
          subtitle: t.dueOn ? relativeDays(t.dueOn) : 'no due date',
          trailing: t.priority === 'urgent' ? badge('urgent', 'danger') : null,
          href: Router.href({ module: 'tasks', entity: 'task', id: t.id }),
        })))
        : empty({ title: 'Nothing outstanding', iconName: 'check' }),
    ]);
  },

  activity: (data) => card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      cardHeader('Recent activity', null, { iconName: 'clock' })),
    data.activity.length
      ? h('div', { class: 'list' }, data.activity.map((entry) => listItem({
        title: describeAudit(entry, (id) => data.people[id] ?? 'Someone'),
        subtitle: relativeDays(entry.at.slice(0, 10)),
      })))
      : empty({ title: 'Nothing yet', iconName: 'clock' }),
  ]),
};

/* -------------------------------------------------------------- customise */

async function customise(enabled, repaint) {
  const { modal } = await import('../ui/components/modal.js');
  const { db } = app();
  const selection = new Set(enabled);

  const body = h('div', { class: 'stack' }, ALL_WIDGETS.map((id) => h('label', {
    class: 'checkbox',
  }, [
    h('input', {
      type: 'checkbox',
      checked: selection.has(id),
      onChange: (e) => (e.target.checked ? selection.add(id) : selection.delete(id)),
    }),
    h('span', {}, WIDGET_LABELS[id] ?? id),
  ])));

  const { close } = modal({
    title: 'Dashboard widgets',
    body,
    footer: [
      button('Cancel', { variant: 'subtle', onClick: () => close() }),
      button('Save', {
        variant: 'primary',
        onClick: async () => {
          const next = ALL_WIDGETS.filter((id) => selection.has(id));
          await db.setMeta(WIDGET_KEY, next);
          enabled.length = 0;
          enabled.push(...next);
          close();
          await repaint();
        },
      }),
    ],
  });
}

const WIDGET_LABELS = {
  summary: 'Summary in words',
  networth: 'Family net worth',
  spending: 'This month’s spending',
  reminders: 'Expiring & due',
  bills: 'Upcoming bills',
  budgets: 'Budgets',
  portfolio: 'Investments',
  nominations: 'Nominations',
  dates: 'Birthdays & anniversaries',
  tasks: 'Tasks',
  activity: 'Recent activity',
};

function greeting(actor) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return actor?.name ? `${part}, ${actor.name.split(' ')[0]}` : part;
}

export { ALL_WIDGETS, loadAll };
