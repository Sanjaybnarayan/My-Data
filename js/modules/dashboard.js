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
  pageHeader, avatar, dueBadge, carousel, walletCard,
} from '../ui/components/basics.js';
import { donutChart, barChart, seriesColour } from '../ui/components/charts.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { netWorth } from '../domain/networth.js';
import * as fin from '../domain/finance.js';
import { portfolioSummary, allocation } from '../domain/portfolio.js';
import { allReminders } from '../domain/reminders.js';
import { datedEntities, BY_NAME, attentionFrom } from '../services/attention.js';
import { TimelineService } from '../services/timeline.js';
import { entity } from '../data/schema.js';
import { formatCompact, format } from '../core/money.js';
import { formatDay, relativeDays, today } from '../core/dates.js';
import { summarise } from '../ai/summary.js';
import { t } from '../core/locale.js';
import { TRANSACTION_LIMIT, transactionsTruncated } from '../services/service.js';
import { EstateService } from '../services/estate.js';
import { syncCard, syncNow } from '../ui/components/syncstatus.js';
import { customise } from './dashboard-widgets.js';
import { ROWS, billHref, billsFooter, moreFooter, stakeFooter } from './dashboard-parts.js';

const WIDGET_KEY = 'dashboard.widgets';

/*
 * The order the screen is read in, not a list of everything available.
 *
 * What needs doing, then what the household is worth, then who is in it, then
 * today, then money, then papers — and the written summary last, because a
 * paragraph is the slowest thing on a screen to take in and should not be the
 * first thing met.
 *
 * `networth` and `reminders` are not here: `wallet` and `attention` show the
 * same records in a form that fits a phone. Both still exist as widgets, so a
 * household that had chosen them keeps them.
 */
const DEFAULT_WIDGETS = [
  'attention', 'wallet', 'family', 'dates', 'tasks',
  'spending', 'bills', 'budgets', 'documents', 'portfolio',
  'nominations', 'activity', 'summary',
];

/**
 * Every widget that can be shown, in display order — a longer list than the
 * default.
 *
 * The two were one list, and that was a way to lose somebody's arrangement:
 * Customise saves `ALL_WIDGETS.filter(chosen)`, so a widget missing from it
 * could be ticked, saved, and silently dropped. `networth` and `reminders` are
 * off by default because `wallet` and `attention` cover the same records
 * better on a phone — but a household that wants them can still have them, and
 * one that already had them does not lose them by opening this sheet.
 */
const ALL_WIDGETS = [
  'attention', 'wallet', 'networth', 'family', 'dates', 'tasks',
  'spending', 'reminders', 'bills', 'budgets', 'documents', 'portfolio',
  'nominations', 'activity', 'summary',
];

/**
 * What the default used to be, kept so a stored preference can be recognised.
 *
 * Somebody who never opened Customise has the old default written down, and
 * cannot be told apart from somebody who chose exactly those eleven. Treating
 * the untouched default as a choice would freeze them on the old shape
 * forever; treating a real choice as a default would throw their arrangement
 * away. This is the only way to tell the two apart, and it stops being needed
 * the first time each household opens Customise.
 */
const PREVIOUS_DEFAULT = [
  'summary', 'networth', 'spending', 'reminders', 'bills', 'budgets',
  'portfolio', 'nominations', 'dates', 'tasks', 'activity',
];

/**
 * The stored preference, or the default — telling an untouched one apart.
 *
 * Exported so it can be tested without a DOM. What it decides is whether
 * somebody keeps the arrangement they chose, so it is worth checking directly
 * rather than through a browser.
 */
export function chosenWidgets(stored) {
  if (!Array.isArray(stored) || !stored.length) return DEFAULT_WIDGETS;

  const untouched = stored.length === PREVIOUS_DEFAULT.length
    && stored.every((id, i) => id === PREVIOUS_DEFAULT[i]);
  if (untouched) return DEFAULT_WIDGETS;

  // A real arrangement is kept, with anything added since appended rather than
  // withheld — a household should not have to know a section exists to see it.
  const known = new Set(stored);
  return [...stored, ...DEFAULT_WIDGETS.filter((id) => !known.has(id))];
}

export async function render() {
  const { db, sync } = app();
  const host = h('div', {});

  const enabled = chosenWidgets(await db.meta(WIDGET_KEY));

  // Built once, outside `paint`: it holds a subscription. Why it is on this
  // screen at all is in `js/ui/components/syncstatus.js`.
  const syncStatus = syncCard({ state: sync?.state, onSync: () => syncNow(sync) });

  async function paint() {
    const data = await loadAll(db);
    replace(host, [
      pageHeader(greeting(db.actor), {
        subtitle: formatDay(today()),
        actions: [button('Customise', {
          variant: 'subtle', iconName: 'settings', onClick: () => customise(enabled, paint),
        })],
      }),
      syncStatus.node,
      h('div', { class: 'grid grid--wide' },
        enabled.map((id) => WIDGETS[id]?.(data)).filter(Boolean)),
    ]);
  }

  await paint();

  // After the paint, never before. The widget shows what happened since the
  // last visit, and marking it seen while answering would clear the answer in
  // the act of asking for it.
  await new TimelineService(db).markSeen();

  const off = bus.on(TOPIC.dataChanged, () => paint());

  return {
    node: host,
    destroy: () => {
      off();
      syncStatus.destroy();
    },
  };
}

/* -------------------------------------------------------------- data load */

/**
 * One read of everything the dashboard needs, rather than a read per widget.
 * Nine widgets each fetching transactions is nine passes over the same store.
 */
async function loadAll(db) {
  /*
   * Two lists, and only one of them is written by hand.
   *
   * The dated entities are derived — every entity the schema marks with an
   * `expiry` field — because this array used to name them itself and had
   * drifted from the schema by four: `identityDocument`, `warranty`,
   * `vehicleService` and `tenant`. The first of those holds passports, driving
   * licences and Aadhaar, so the screen a household looks at first had never
   * once warned that a passport was about to expire, while
   * `domain/reminders.js` was built precisely to find that and was being
   * handed no such records to look at.
   *
   * What stays hand-written is the entities this screen's own widgets need for
   * reasons other than a date — balances, transactions, budgets. That list is
   * about what the widgets show and is legitimately local; the dated one is
   * about what the schema says, and belongs to the schema.
   *
   * Two names have since left it, and both are the same fault this comment is
   * about, pointing the other way. `medication` became dated when a course
   * running out started producing a reminder, so it is derived now and naming
   * it here as well is how the two lists would begin to disagree.
   * `investmentTransaction` was read by nothing at all: not by a widget, not
   * by `allReminders` — it carries no date — and not by `attentionFrom`, so
   * every dashboard paint read up to `TRANSACTION_LIMIT` records and dropped
   * them. A test now requires every name left here to appear somewhere else in
   * this file, which is what would have caught it.
   */
  const WIDGETS_NEED = ['account', 'transaction', 'budget'];
  const names = [...new Set([...datedEntities(), ...BY_NAME, ...WIDGETS_NEED])];

  /** @type {Record<string, any[]>} */
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
    // The same arithmetic the Notifications tab and its badge use, from the
    // records already in hand rather than a second read of eighteen entities.
    attention: attentionFrom(byEntity, { horizonDays: 45 }),
    bills: fin.upcomingBills(byEntity.recurringPayment, byEntity.loan, {
      days: 30,
      accounts: byEntity.account,
      transactions: byEntity.transaction,
      // Both were already producing a date reminder here with no money
      // attached to it, which is the half that costs nothing to know.
      subscriptions: byEntity.subscription,
      digitalAssets: byEntity.digitalAsset,
    }),
    // Grouped, named and marked against the last visit. The mark is written
    // after the paint, never here: writing it while answering would clear the
    // answer in the act of asking for it.
    timeline: await new TimelineService(db).recent(),
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
const MODULE_OF = { account: 'finance', holding: 'investments', policy: 'insurance' };

const WIDGETS = {
  /*
   * What needs doing, above everything else.
   *
   * The count and the arithmetic are `attentionFrom`, shared with the
   * Notifications tab and the badge on its bar — one source, so the dashboard
   * cannot say three things need attention while the tab says four.
   *
   * Three rows, not all of them. This card exists to say *whether* something
   * needs doing; the tab is where the list lives.
   */
  attention: (data) => {
    const { pressing, items } = data.attention;
    const worst = items.filter((one) => one.severity === 'overdue' || one.severity === 'urgent');

    if (!pressing) {
      return card({ class: 'card--quiet' }, [
        cardHeader(t('dash.attention.clear'), null, { iconName: 'check' }),
        h('p', { class: 'small muted', style: { marginBottom: 0 } },
          t('dash.attention.clearBody')),
      ]);
    }

    return card({ class: 'card--flush attention-card' }, [
      h('div', { class: 'attention-head' }, cardHeader(
        pressing === 1 ? t('dash.attention.one') : t('dash.attention.many', { n: pressing }),
        badge(String(pressing), 'danger'),
        { iconName: 'alert' },
      )),

      h('div', { class: 'list' }, worst.slice(0, 3).map((one) => listItem({
        title: one.line,
        subtitle: `${one.label ?? t('dash.dateFallback')} · ${formatDay(one.date)}`,
        href: one.module && one.entity && one.recordId
          ? Router.href({ module: one.module, entity: one.entity, id: one.recordId })
          : Router.href({ module: 'notifications' }),
      }))),

      h('div', { class: 'attention-foot' }, [
        h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'notifications' }) },
          worst.length > 3 ? t('dash.attention.seeAll', { n: pressing })
            : t('dash.attention.open')),
      ]),
    ]);
  },

  /*
   * The wallet: net worth, then what it is made of.
   *
   * Every figure comes from `netWorth`, which is the same calculation the
   * Finance screen uses — this draws it, it does not recompute it. The
   * breakdown rows are only the ones with a value, so a household with no
   * property does not get an empty Property card claiming ₹0.
   *
   * Each card says when it was last true. Nothing here is live: a balance is
   * as recent as the last transaction somebody recorded, and a card that shows
   * a figure without saying so invites it to be read as a bank feed.
   */
  wallet: (data) => {
    const total = data.net.total;
    const stale = data.net.staleValuations?.length ?? 0;

    const cards = [
      walletCard({
        title: t('dash.wallet.netWorth'),
        value: formatCompact(total),
        meta: t('dash.wallet.split', { assets: format(data.net.assets), owed: format(data.net.liabilities) }),
        updated: stale
          ? (stale === 1 ? t('dash.wallet.staleOne') : t('dash.wallet.staleMany', { n: stale }))
          : t('dash.wallet.recorded'),
        status: data.truncated ? { label: t('dash.wallet.partial'), tone: 'warning' } : null,
        href: Router.href({ module: 'finance' }),
        tone: 'accent',
      }),

      ...data.net.breakdown.map((row) => walletCard({
        title: row.label,
        value: formatCompact(Math.abs(row.value)),
        meta: row.kind === 'liability' ? t('dash.wallet.owed') : t('dash.wallet.held'),
        updated: t('dash.wallet.recorded'),
        href: Router.href({ module: row.kind === 'liability' ? 'finance' : 'investments' }),
      })),
    ];

    // Nothing recorded is not a carousel of zeroes — it is one sentence.
    if (!data.net.assets && !data.net.liabilities) {
      return card({}, [
        cardHeader(t('dash.wallet.title'), null, { iconName: 'wallet' }),
        empty({
          title: t('dash.wallet.empty.title'),
          message: t('dash.wallet.empty.message'),
          iconName: 'wallet',
          action: button(t('dash.wallet.empty.action'), {
            variant: 'primary',
            iconName: 'plus',
            onClick: () => app().router.navigate({
              module: 'finance', entity: 'account', id: 'new',
            }),
          }),
        }),
      ]);
    }

    return h('section', { class: 'dash-section' }, [
      h('h2', { class: 'dash-section-title' }, t('dash.wallet.title')),
      carousel(cards, { label: t('dash.wallet.cards') }),
    ]);
  },

  /*
   * Who is in the household.
   *
   * Deliberately not a safety claim. The brief asks for "Everyone safe" here,
   * and this application cannot say that: a safe-zone crossing is noticed when
   * the location trail is next read, not as it happens, so a green tick on the
   * home screen would be asserting something nobody checked. What is shown is
   * what is known — how many people are recorded — and Safety is a tap away.
   */
  family: (data) => {
    // `data.person`, not `data.people`. The latter is an id-to-name lookup
    // built for the widgets that resolve a reference; it is an object, and
    // calling `.filter` on it took the whole dashboard down.
    const people = (data.person ?? []).filter((one) => !one.deletedAt);

    if (!people.length) {
      return card({}, empty({
        title: t('dash.family.empty.title'),
        message: t('dash.family.empty.message'),
        iconName: 'family',
        action: button(t('dash.family.empty.action'), {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'identity', entity: 'person', id: 'new' }),
        }),
      }));
    }

    return card({}, [
      cardHeader(t('dash.family.title'),
        badge(people.length === 1 ? t('dash.family.one')
          : t('dash.family.many', { n: people.length })),
        { iconName: 'family' }),
      h('div', { class: 'dash-avatars' },
        people.slice(0, 8).map((one) => avatar(one.name ?? '?'))),
      h('div', { class: 'row' }, [
        h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'family' }) },
          t('dash.family.open')),
        h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'safety' }) },
          t('dash.family.safety')),
      ]),
    ]);
  },

  /*
   * Papers that run out.
   *
   * The same reminders the attention card counts, narrowed to the entities a
   * household would call a document. Separate because "your passport expires
   * in three weeks" is a different kind of worry from "the rent is due", and
   * putting them in one list makes both easier to miss.
   */
  documents: (data) => {
    const PAPERS = new Set(['identityDocument', 'document', 'policy', 'certificate',
      'vehicle', 'warranty', 'education']);
    // `all` before `rows`, and the badge counts `all`. It counted the sliced
    // array, so nine papers running out were badged as 5.
    const all = data.attention.items.filter((one) => PAPERS.has(one.entity));
    const rows = all.slice(0, ROWS);

    if (!rows.length) {
      return card({ class: 'card--quiet' }, [
        cardHeader(t('dash.papers.title'), null, { iconName: 'file' }),
        h('p', { class: 'small muted', style: { marginBottom: 0 } },
          t('dash.papers.clear')),
      ]);
    }

    return card({ class: 'card--flush' }, [
      h('div', { class: 'attention-head' },
        cardHeader(t('dash.papers.running'), badge(String(all.length)), { iconName: 'file' })),
      h('div', { class: 'list' }, rows.map((one) => listItem({
        title: one.title,
        subtitle: `${one.label} · ${formatDay(one.date)}`,
        // The row's own window, not a flat thirty days. `expiryReminders`
        // already decided this row was worth showing using the field's
        // declared lead; re-deciding here made the badge disagree with the
        // list it sat in.
        trailing: dueBadge(one.date, { leadDays: one.lead }),
        href: Router.href({ module: one.module, entity: one.entity, id: one.recordId }),
      }))),
      moreFooter(all.length, Router.href({ module: 'documents' })),
    ]);
  },

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
        + 'resting on a valuation that is missing or out of date — update them for a truer figure.',
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
          hint: fin.comparedWith(data.compare),
        }),
        metric({
          label: 'Received',
          value: formatCompact(data.compare.current.income),
          delta: data.compare.incomeChange,
          hint: fin.comparedWith(data.compare),
        }),
      ]),
      barChart(fin.spendingBars(series), {
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
    // The badge counted the sliced array here too — fifteen expiring things
    // were badged as 8.
    const all = data.reminders.filter((r) => r.group === 'expiry');
    const rows = all.slice(0, ROWS);
    return card({ class: 'card--flush' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader('Expiring & due', badge(String(all.length), all.some((r) => r.days < 0) ? 'danger' : ''), { iconName: 'alert' })),
      rows.length
        ? h('div', { class: 'list' }, rows.map((r) => listItem({
          title: r.title,
          subtitle: `${r.label} · ${formatDay(r.date)}`,
          trailing: dueBadge(r.date, { leadDays: r.lead }),
          href: Router.href({ module: r.module, entity: r.entity, id: r.recordId }),
        })))
        : empty({ title: 'Nothing expiring', message: 'Everything is in date.', iconName: 'check' }),
      all.length ? moreFooter(all.length, Router.href({ module: 'notifications' })) : null,
    ]);
  },

  bills: (data) => card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      cardHeader('Bills in the next 30 days', null, { iconName: 'repeat' })),
    data.bills.length
      ? h('div', { class: 'list' }, data.bills.slice(0, ROWS).map((bill) => listItem({
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
    // The total is of every bill, not of the three drawn — it always was, and
    // that is why the list needed a way through to the rest rather than a
    // shorter total.
    data.bills.length
      ? billsFooter(fin.billsTotal(data.bills))
      : null,
    data.bills.length
      ? moreFooter(data.bills.length, Router.href({ module: 'finance' }))
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

      h('div', { class: 'list' }, gaps.slice(0, ROWS).map((gap) => listItem({
        title: gap.name,
        subtitle: gap.where,
        // Never a zero. A record whose value this screen does not know shows a
        // dash, the same way a card bill with no statement day does.
        value: gap.amount === null ? '—' : format(gap.amount),
        href: Router.href({ module: MODULE_OF[gap.entity], entity: gap.entity, id: gap.id }),
      }))),

      stakeFooter(valueUnknown, atStake),

      // The badge here always said the true number; the list under it simply
      // stopped, with nowhere to go. The value at stake above is of every gap,
      // so the footer and the rows disagreed about how much was being shown.
      gaps.length ? moreFooter(gaps.length, Router.href({ module: 'finance' })) : null,

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
    const all = data.reminders.filter((r) => r.group === 'date');
    const rows = all.slice(0, ROWS);
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
      // The last list on this screen still drawing six of them, and the last
      // without a way to the rest. A birthday nobody can scroll to is a
      // birthday missed.
      all.length ? moreFooter(all.length, Router.href({ module: 'calendar' })) : null,
    ]);
  },

  tasks: (data) => {
    const openAll = data.task
      .filter((t) => t.status !== 'done')
      .sort((a, b) => (a.dueOn || '9999').localeCompare(b.dueOn || '9999'));
    const open = openAll.slice(0, ROWS);
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

  /**
   * What has been happening, as things rather than log lines.
   *
   * This used to be the last eight audit entries, which on an ordinary
   * afternoon of tidying meant seven lines about one record — none of which
   * said *which* record, because an audit entry carries an id and `describe`
   * could only reach the entity's label.
   */
  activity: (data) => card({ class: 'card--flush' }, [
    h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
      // The card shows eight. The service built every story in the window and
      // the rest were dropped on the floor, so the link is not decoration —
      // it is the only way to reach a history the application already had.
      cardHeader(data.timeline.unseen ? 'Since you last looked' : 'Recent activity',
        h('a', { class: 'btn btn--subtle btn--small', href: '#/timeline' }, 'Show everything'),
        { iconName: 'clock' })),
    data.timeline.stories.length
      ? h('div', { class: 'list' }, data.timeline.stories.slice(0, ROWS).map((story) => listItem({
        title: data.timeline.describe(story),
        subtitle: relativeDays(String(story.at).slice(0, 10)),
        href: story.entity && story.recordId
          ? Router.href({
            module: entity(story.entity).module,
            entity: story.entity,
            id: story.recordId,
          })
          : undefined,
      })))
      : empty({ title: 'Nothing yet', iconName: 'clock' }),
  ]),
};

/* -------------------------------------------------------------- customise */

function greeting(actor) {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  return actor?.name ? `${part}, ${actor.name.split(' ')[0]}` : part;
}

export { ALL_WIDGETS, WIDGET_KEY, loadAll };
