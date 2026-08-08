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
import {
  portfolioSummary, allocation, holdingGain, xirr, cashFlows, maturingSoon, dividendIncome,
} from '../domain/portfolio.js';
import { netWorth } from '../domain/networth.js';
import { format, formatCompact } from '../core/money.js';
import { formatDay, startOfFinancialYear, endOfFinancialYear, today } from '../core/dates.js';

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'holding', label: 'Holdings' },
  { id: 'investmentTransaction', label: 'Transactions' },
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
      actions: active !== 'portfolio'
        ? [button('Add', { variant: 'primary', iconName: 'plus', onClick: () => section?.openForm() })]
        : [button('Add holding', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'investments', entity: 'holding', id: 'new' }),
        })],
    }),
    h('div', { class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' } },
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

  section = await listSection(active, { autoOpenNew: route.id === 'new' });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

async function portfolioView() {
  const { db } = app();
  const host = h('div', {});

  async function paint() {
    const [holdings, transactions, accounts, moneyTxns, properties, vehicles, loans, people] =
      await Promise.all([
        db.repo('holding').list({ decrypt: false, limit: 2000 }),
        db.repo('investmentTransaction').list({ decrypt: false, limit: 20_000 }),
        db.repo('account').list({ decrypt: false }),
        db.repo('transaction').list({ decrypt: false, limit: 20_000 }),
        db.repo('property').list({ decrypt: false }),
        db.repo('vehicle').list({ decrypt: false }),
        db.repo('loan').list({ decrypt: false }),
        db.repo('person').list({ decrypt: false }),
      ]);

    if (!holdings.length) {
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

    const summary = portfolioSummary(holdings);
    const pooled = xirr(holdings
      .flatMap((holding) => cashFlows(holding, transactions))
      .sort((a, b) => a.date.localeCompare(b.date)));

    const rows = holdings
      .filter((holding) => holding.active !== false)
      .map((holding) => {
        const gain = holdingGain(holding);
        const flows = cashFlows(holding, transactions);
        return {
          ...holding,
          ...gain,
          // Null rather than zero: "no rate could be computed" and "it
          // returned nothing" are different facts.
          rate: flows.length >= 2 ? xirr(flows) : null,
          ownerName: people.find((p) => p.id === holding.owner)?.name ?? '',
        };
      })
      .sort((a, b) => b.value - a.value);

    const fyFrom = startOfFinancialYear(today());
    const dividends = dividendIncome(transactions, { from: fyFrom, to: endOfFinancialYear(today()) });
    const maturing = maturingSoon(holdings, 180);

    const worth = netWorth({
      accounts, transactions: moneyTxns, holdings, properties, vehicles, loans,
    });

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
          + `Investments are ${worth.assets ? Math.round((summary.value / worth.assets) * 100) : 0}% of assets.`),
      ]),

      card({}, [
        cardHeader('Asset allocation'),
        donutChart(allocation(holdings), { label: 'Allocation by asset class', size: 170 }),
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

      card({ class: 'card--flush' }, [
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
            row.rate !== null ? badge(`${row.rate}% XIRR`) : null,
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
