/**
 * Investments.
 *
 * The portfolio view exists because a list of holdings does not answer the
 * question people actually have, which is "is this working". Gain, allocation
 * and XIRR are on the first screen; the rows are underneath.
 *
 * XIRR is computed per holding from its own transactions, and for the
 * portfolio from all of them pooled. Where a holding has no transaction
 * history the cell says so rather than showing a rate derived from one point.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, metric, badge, button, pageHeader, chip, empty, listItem,
} from '../ui/components/basics.js';
import { donutChart, barChart, seriesColour } from '../ui/components/charts.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { PortfolioService } from '../services/portfolio.js';
import { format, formatCompact } from '../core/money.js';
import { formatDay, startOfFinancialYear, today } from '../core/dates.js';
import { describeAccrual } from '../domain/accrual.js';
import { t } from '../core/locale.js';

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'holding', label: 'Holdings' },
  { id: 'investmentTransaction', label: 'Transactions' },
  // Not an entity, so it is not a `listSection` — it is the one tab that
  // writes rows rather than listing them. See `modules/tradeimport.js`.
  { id: 'import', label: 'Import' },
];

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const active = route.entity ?? 'portfolio';
  const body = h('div', {});
  let section = null;

  const host = h('div', {}, [
    pageHeader('Investments', {
      subtitle: 'What is invested, and what it has done',
      actions: active !== 'portfolio' && active !== 'import'
        ? [button('Add', { variant: 'primary', iconName: 'plus', onClick: () => section?.openForm() })]
        : [button('Add holding', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'investments', entity: 'holding', id: 'new' }),
        })],
    }),
    h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Investments', style: { marginBottom: 'var(--space-4)' } },
      TABS.map((tab) => chip(tab.label, {
        pressed: tab.id === active,
        onClick: () => app().router.navigate(tab.id === 'portfolio'
          ? { module: 'investments' }
          : { module: 'investments', entity: tab.id }),
      }))),
    body,
  ]);

  if (active === 'portfolio') {
    const view = await portfolioView();
    replace(body, view.node);
    return { node: host, destroy: view.destroy };
  }

  if (active === 'import') {
    const { render: renderImport } = await import('./tradeimport.js');
    const view = await renderImport();
    replace(body, view.node);
    return { node: host, destroy: view.destroy };
  }

  section = await listSection(active, { autoOpenNew: route.id === 'new' });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * Deposits whose recorded value has not moved since somebody typed it.
 *
 * The mirror of the loan bug. `holding.currentValue` is a figure entered once;
 * a fixed deposit earns interest every quarter and nothing here moves it, so
 * two years into a ₹5,00,000 deposit at 7.1% the gain above reads zero when it
 * is nearer ₹75,000. Both bugs push net worth the same way — down.
 *
 * Nothing is written back. Rates change on renewal, TDS comes off interest at
 * source, and a premature withdrawal is penalised, so the estimate sits beside
 * the stored figure and the bank's statement stays the authority.
 */
/**
 * Which bank row paid each RD instalment.
 *
 * Shown only when there is something to say. A household whose instalments all
 * match wants no card at all — the connection existing is not news, and the
 * two states worth a person's attention are *"nothing in the ledger looks like
 * this payment"* and *"two rows could be, and this application will not pick
 * one for you."*
 *
 * `ambiguous` is deliberately not phrased as a problem to fix. Instalments are
 * the same amount every month, so two debits a day apart are genuinely
 * indistinguishable, and the honest sentence names both rather than choosing.
 */
function instalmentCard(counts) {
  if (!counts?.total || (!counts.unmatched && !counts.ambiguous)) return null;

  return card({ class: 'card--quiet' }, [
    cardHeader(t('instalments.title'), [], {
      subtitle: t('instalments.subtitle', { matched: counts.matched, total: counts.total }),
      iconName: 'bank',
    }),
    counts.unmatched
      ? h('p', { class: 'small' }, t('instalments.unmatched', { n: counts.unmatched }))
      : null,
    counts.ambiguous
      ? h('p', { class: 'small muted', style: { marginBottom: 0 } },
        t('instalments.ambiguous', { n: counts.ambiguous }))
      : null,
  ].filter(Boolean));
}

function accrualCard(report) {
  if (!report?.drifted.length && !report?.unchecked.length) return null;

  return card({ class: 'accrual-card' }, [
    cardHeader('Deposits worth more than recorded', [], {
      subtitle: report.understated
        ? `About ${format(report.understated)} of interest is not being counted`
        : 'Some deposits could not be checked',
      iconName: 'bank',
    }),

    report.drifted.length
      ? h('div', { class: 'list' }, report.drifted.map((entry) => listItem({
        title: entry.holding.name,
        subtitle: describeAccrual(entry, format),
        value: format(entry.value),
        leading: badge(entry.matured ? 'matured' : 'estimate', 'warning'),
        href: Router.href({ module: 'investments', entity: 'holding', id: entry.holding.id }),
      })))
      : null,

    report.unchecked.length
      ? h('div', { class: 'list' }, report.unchecked.map(({ holding, why }) => listItem({
        title: holding.name,
        subtitle: why,
        leading: badge('not checked'),
        href: Router.href({ module: 'investments', entity: 'holding', id: holding.id }),
      })))
      : null,

    h('p', { class: 'small faint' },
      'These are estimates from the rate recorded here, before TDS and before any '
      + 'change on renewal. Update the value from the bank’s statement, not from this.'),
  ].filter(Boolean));
}

async function portfolioView() {
  const { db } = app();
  const host = h('div', {});

  const service = new PortfolioService(db);

  async function paint() {
    // Which records this answer needs, and how they combine, is the service's
    // business — and is tested without a browser. What is left here is what a
    // screen is for: turning an answer into something to look at.
    const view = await service.overview();

    if (view.empty) {
      replace(host, empty({
        title: 'No investments yet',
        message: 'Add a holding and its transactions to see gain, allocation and XIRR.',
        iconName: 'chart',
        action: button('Add a holding', {
          variant: 'primary',
          onClick: () => app().router.navigate({ module: 'investments', entity: 'holding', id: 'new' }),
        }),
      }));
      return;
    }

    const {
      summary, rows, pooled, dividends, maturing, shareOfAssets, accrual, instalments,
    } = view;
    const fyFrom = startOfFinancialYear(today());

    replace(host, h('div', { class: 'grid grid--wide' }, [
      card({}, [
        cardHeader('Portfolio'),
        h('div', { class: 'row', style: { gap: 'var(--space-6)' } }, [
          metric({ label: 'Current value', value: formatCompact(summary.value) }),
          metric({
            label: 'Gain',
            value: formatCompact(summary.gain),
            delta: summary.gainPercent,
            compact: true,
          }),
          metric({
            label: 'XIRR',
            value: pooled === null ? '—' : `${pooled}%`,
            hint: pooled === null ? 'needs dated transactions' : 'annualised',
            compact: true,
          }),
        ]),
        h('p', { class: 'small faint' },
          `${format(summary.invested)} invested across ${summary.count} holdings. `
          + (shareOfAssets === null
            // Was `0% of assets`, which reads as "a negligible part" rather
            // than "there are no assets recorded to be a part of".
            ? 'No other assets are recorded, so there is nothing to compare against.'
            : `Investments are ${shareOfAssets}% of assets.`)),

        // The invested figure now comes from the recorded buys and sells
        // rather than the number typed on each holding form. Where the two
        // disagree the screen says so: a household that typed one of them is
        // entitled to know which it is looking at, and a transaction history
        // that starts halfway through derives a figure that is too *low*.
        summary.difference
          ? h('p', { class: 'small muted' },
            'This is what the recorded buys and sells add up to, including charges. '
            + `The holding forms say ${format(summary.typedInvested)}`
            // `difference` is derived minus typed. Positive means the forms
            // understate; negative means the transaction history is short.
            + (summary.difference < 0
              ? ', which is more — usually because the earliest purchases were '
                + 'never recorded as transactions.'
              : `, which is ${format(summary.difference)} less.`))
          : null,

        // How much of the headline this correction never reached. A portfolio
        // where most holdings have no transactions is one where the invested
        // figure is still whatever somebody typed.
        summary.fromForms
          ? h('p', { class: 'small faint' },
            `${summary.fromForms} of ${summary.count} holdings have no transactions `
            + 'recorded, so their figures are still the ones typed on the form.')
          : null,
      ].filter(Boolean)),

      // Directly under the summary, because it qualifies the gain figure in it.
      accrualCard(accrual),
      instalmentCard(instalments),

      card({}, [
        cardHeader('Asset allocation'),
        donutChart(view.allocation, { label: 'Allocation by asset class', size: 170 }),
      ]),

      card({}, [
        cardHeader('Gain by holding'),
        barChart(
          rows.slice(0, 8).map((r) => ({ label: r.name.slice(0, 10), value: r.gain })),
          {
            height: 150,
            label: 'Gain per holding',
            tone: (d) => (d.value >= 0 ? seriesColour(6) : seriesColour(4)),
          },
        ),
      ]),

      card({ class: 'card--flush holdings-card' }, [
        h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
          cardHeader('Holdings')),
        h('div', { class: 'list' }, rows.map((row) => listItem({
          title: row.name,
          subtitle: `${row.kind}${row.ownerName ? ` · ${row.ownerName}` : ''}`,
          value: format(row.value),
          trailing: h('div', { class: 'row', style: { gap: 'var(--space-2)' } }, [
            row.gainPercent !== null
              ? badge(`${row.gainPercent > 0 ? '+' : ''}${row.gainPercent}%`,
                row.gainPercent >= 0 ? 'positive' : 'danger')
              : null,
            // "est." is not decoration. A rate worked out from an accrual
            // estimate and one worked out from a figure somebody typed are
            // different claims, and rendering them identically would be the
            // silent substitution the service is careful not to make.
            row.rate !== null
              ? badge(`${row.rate}% XIRR${row.rateEstimated ? ' est.' : ''}`)
              : null,
          ]),
          href: Router.href({ module: 'investments', entity: 'holding', id: row.id }),
        }))),
      ]),

      maturing.length
        ? card({ class: 'card--flush' }, [
          h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
            cardHeader('Maturing within six months')),
          h('div', { class: 'list' }, maturing.map((holding) => listItem({
            title: holding.name,
            subtitle: `${formatDay(holding.maturesOn)} · in ${holding.daysAway} days`,
            value: format(holding.maturityValue || holding.currentValue || 0),
            href: Router.href({ module: 'investments', entity: 'holding', id: holding.id }),
          }))),
        ])
        : null,

      dividends
        ? card({}, [
          cardHeader('Income from investments'),
          metric({
            label: `Dividends and interest since ${formatDay(fyFrom)}`,
            value: format(dividends),
          }),
        ])
        : null,
    ].filter(Boolean)));
  }

  await paint();
  const off = bus.on(`${TOPIC.dataChanged}:investments`, () => paint());
  return { node: host, destroy: off };
}
