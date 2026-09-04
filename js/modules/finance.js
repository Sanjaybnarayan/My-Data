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
  card, cardHeader, money, badge, button, pageHeader, listItem, chip, empty,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { format } from '../core/money.js';
import { formatDay } from '../core/dates.js';
import { entitiesOfModule } from '../data/schema.js';
import { financeOverview } from './finance/overview.js';
import { GoalsService } from '../services/goals.js';
import { CfoService } from '../services/cfo.js';
import { describeLine } from '../domain/cfo.js';
import { describeGoal, STATUS as GOAL_STATUS } from '../domain/goals.js';
import { EvidenceService } from '../services/evidence.js';
import { ConflictService } from '../services/conflict.js';
import { t } from '../core/locale.js';
import { ExplainService } from '../services/explain.js';
import { describeExplainability } from '../domain/explain.js';
import { describeExplanation } from '../domain/explain.js';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'position', label: 'Position' },
  { id: 'transaction', label: 'Transactions' },
  { id: 'account', label: 'Accounts' },
  { id: 'import', label: 'Import' },
  // `labelKey`, not `label`: a `t()` call in this array would run once when
  // the module loads and keep whatever language was active then. The rest of
  // these labels are English written here, which is a separate debt.
  { id: 'bankStatement', labelKey: 'finance.tab.imported' },
  { id: 'shops', label: 'Shops' },
  { id: 'people', label: 'People' },
  { id: 'lending', label: 'Lending' },
  { id: 'insights', label: 'Insights' },
  { id: 'budget', label: 'Budgets' },
  { id: 'recurringPayment', label: 'Recurring' },
  { id: 'loan', label: 'Loans' },
  { id: 'goal', label: 'Goals' },
  { id: 'economicEvent', label: 'Movements' },
  { id: 'smsMessage', label: 'Messages' },
  { id: 'conflicts', label: 'Disagreements' },
];

/**
 * The seventeen sections above, in five groups.
 *
 * Seventeen chips in one row wrapped onto four lines on a phone, which is
 * most of the screen spent on navigation before a single figure appears. The
 * fix is not fewer sections — every one of them is a real place — but saying
 * out loud which of them belong together, which the flat list never did.
 *
 * Grouped rather than hidden. `docs/UI_INFORMATION_ARCHITECTURE.md` draws the
 * line at a module having nowhere to be reached from, and a section behind a
 * "More" menu is two-thirds of the way there. Both rows are on the screen at
 * once: the groups, and the sections of whichever group is open.
 *
 * Routes are untouched. Every section keeps its own URL, so a deep link, a
 * bookmark and both reachability checks still land exactly where they did.
 */
const GROUPS = [
  { id: 'money', label: 'Money', tabs: ['overview', 'position', 'transaction', 'account'] },
  { id: 'incoming', label: 'Incoming', tabs: ['import', 'bankStatement', 'smsMessage'] },
  { id: 'ledgers', label: 'Ledgers', tabs: ['shops', 'people', 'lending'] },
  { id: 'planned', label: 'Planned', tabs: ['budget', 'recurringPayment', 'loan', 'goal'] },
  { id: 'review', label: 'Review', tabs: ['insights', 'economicEvent', 'conflicts'] },
];

/** The group holding a section, so a deep link opens with its own group open. */
function groupOf(tabId) {
  return GROUPS.find((group) => group.tabs.includes(tabId)) ?? GROUPS[0];
}

const labelOf = (tabId) => {
  const tab = TABS.find((one) => one.id === tabId);
  return tab?.labelKey ? t(tab.labelKey) : (tab?.label ?? tabId);
};

const routeTo = (tabId) => (tabId === 'overview'
  ? { module: 'finance' }
  : { module: 'finance', entity: tabId });

/** Screens that produce records rather than listing one entity. */
// `smsMessage` is here because a message record comes from a message. Offering
// a blank form for one would invite a household to type what a bank said,
// which is the opposite of evidence.
//
// `economicEvent` is here for the same shape of reason. A movement is made of
// the rows it is made of, and it is created by confirming a match between
// them. A blank form would produce a movement with no legs — which
// `domain/explain.js` reports as the worst thing it can find, and which this
// screen would then have invited.
//
// `conflicts` is here because it lists nothing that can be created. A
// disagreement is derived from the records that disagree; a form offering to
// add one would be offering to write down that two things do not match,
// which is not a record a household has.
const NO_ADD = new Set(['import', 'shops', 'people', 'lending', 'insights', 'transaction',
  'bankStatement', 'smsMessage', 'economicEvent', 'conflicts']);

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id, route.entity === 'economicEvent'
      ? { extra: movementEvidence }
      : {});
  }

  const active = route.entity ?? 'overview';
  const host = h('div', {});
  let section = null;

  const body = h('div', {});

  // Which group is open is read from the section being shown, not held as
  // state: arriving at `#/finance/loan` from a bookmark has to open Planned
  // with Loans marked, the same as tapping through to it would.
  const openGroup = groupOf(active);

  const groupRow = h('div', {
    class: 'chip-row chip-row--scroll', role: 'group', 'aria-label': t('finance.title'),
  }, GROUPS.map((group) => chip(group.label, {
    pressed: group.id === openGroup.id,
    // The group's first section, because a group is not itself a screen.
    onClick: () => app().router.navigate(routeTo(group.tabs[0])),
  })));

  const sectionRow = h('div', {
    class: 'chip-row chip-row--sections',
    role: 'group',
    'aria-label': openGroup.label,
    style: { marginBottom: 'var(--space-4)' },
  }, openGroup.tabs.map((id) => chip(labelOf(id), {
    pressed: id === active,
    onClick: () => app().router.navigate(routeTo(id)),
  })));

  const tabs = h('div', {}, [groupRow, sectionRow]);

  replace(host, [
    pageHeader(t('finance.title'), {
      subtitle: t('finance.subtitle'),
      actions: NO_ADD.has(active) ? []
        : active !== 'overview'
        ? [button(t('crud.add'), { variant: 'primary', iconName: 'plus', onClick: () => section?.openForm() })]
        : [button(t('finance.addTransaction'), {
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
  if (active === 'position') {
    replace(body, await positionScreen());
    return { node: host };
  }

  if (active === 'conflicts') {
    const screen = await (await import('./conflicts.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  if (active === 'import') {
    const screen = await (await import('./statements.js')).render();
    replace(body, screen.node);
    return { node: host, destroy: screen.destroy };
  }

  // Transactions get a ledger rather than the schema's generic table: money in
  // and money out need separate columns, and one row needs to open in place.
  if (active === 'transaction' && !route.id) {
    const screen = await (await import('./transactions.js')).render(route);
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
    replace(body, empty({ title: t('finance.unknownSection'), iconName: 'info' }));
    return { node: host };
  }

  section = await listSection(active, {
    autoOpenNew: route.id === 'new',
    banner: active === 'smsMessage' ? evidenceBanner
      : active === 'economicEvent' ? explainBanner
      : active === 'goal' ? goalsBanner
      : undefined,
  });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/**
 * What the household's sources say when read against each other.
 *
 * Two findings, and neither is a list of messages — which is why this sits
 * above the table rather than in it. A payment the ledger never saw is not a
 * property of any one row; it is the absence of one.
 */
async function evidenceBanner() {
  const cards = [];

  // Counted here rather than restated. The orphans and the amount
  // disagreements this card used to print are two of the four kinds
  // `domain/conflict.js` now gathers, and printing two of four beside a
  // screen that holds all four is how a household learns to distrust both
  // numbers. So this says how many there are and where they are.
  const conflicts = await new ConflictService(app().db).review();
  if (conflicts.total) {
    cards.push(card({ class: 'evidence-conflicts' }, [
      cardHeader(t('conflict.banner.title'),
        badge(String(conflicts.total), 'warning'), { iconName: 'alert' }),
      h('p', { class: 'small muted' }, t('conflict.banner.body', { n: conflicts.total })),
      button(t('conflict.banner.go'), {
        onClick: () => app().router.navigate({ module: 'finance', entity: 'conflicts' }),
      }),
    ]));
  }

  const review = await new EvidenceService(app().db).review();
  if (review.corroborated) {
    cards.push(card({ class: 'card--quiet evidence-count' }, [
      h('p', { class: 'small muted', style: { margin: 0 } },
        t('evidence.corroborated', { n: review.corroborated, total: review.total })),
    ]));
  }

  return cards.length ? cards : null;
}

/**
 * How much of the ledger of movements can be explained at all.
 *
 * The count is the point, the way provenance coverage is: *"every financial
 * event is explainable"* is not a property a household has until the ones that
 * are not can be named.
 */
/**
 * Each goal against the balances that fund it.
 *
 * Contested goals come first and carry no figure at all. Showing a percentage
 * beside "this money is also claimed by your house deposit" would be inviting
 * a household to read the number and ignore the sentence — and the number is
 * the part that is wrong.
 */
/**
 * Ten figures and where each came from.
 *
 * The period figures are the last **complete** month, named on the card, with
 * the month in progress shown apart from them and marked as unfinished. They
 * are never put in the same list: on the 21st, a partial month showed ₹1,05,000
 * saved against the previous month's ₹84,000, and side by side that reads as
 * an improvement rather than as three missing weeks.
 */
async function positionScreen() {
  const out = await new CfoService(app().db).position();
  const partial = out.monthInProgress;

  return h('div', { class: 'stack' }, [
    card({ class: 'cfo-position' }, [
      cardHeader(t('finance.position.title'), null, {
        subtitle: t('finance.position.subtitle', { month: out.monthLabel }),
      }),
      h('div', { class: 'list' }, out.lines.map((row) => listItem({
        title: row.label,
        subtitle: describeLine(row, (n) => format(n)),
        trailing: row.why ? badge('—', 'warning') : null,
      }))),
    ]),

    card({ class: 'card--quiet cfo-partial' }, [
      cardHeader(t('finance.position.partial', { month: partial.month }), null, {
        subtitle: t('finance.position.upTo', { day: formatDay(partial.upTo) }),
      }),
      h('p', { class: 'small' }, t('finance.position.flow', {
        income: format(partial.income),
        expense: format(partial.expense),
        net: format(partial.net),
      })),
      h('p', { class: 'small faint' }, partial.note),
    ]),
  ]);
}

async function goalsBanner() {
  const review = await new GoalsService(app().db).review();
  if (!review.any) return null;

  return [card({ class: 'goals-progress' }, [
    cardHeader(t('finance.goals.title'), null, {
      subtitle: t('finance.goals.subtitle'),
    }),
    h('div', { class: 'list' }, review.rows.map((row) => listItem({
      title: row.goal.name,
      subtitle: describeGoal(row, (n) => format(n)),
      trailing: row.percent === null
        ? badge('—', 'warning')
        : badge(`${row.percent}%`, row.status === GOAL_STATUS.REACHED ? 'positive'
          : row.status === GOAL_STATUS.OVERDUE ? 'danger' : ''),
      href: Router.href({ module: 'finance', entity: 'goal', id: row.goal.id }),
    }))),
    review.spendHistory
      ? h('p', { class: 'small faint' },
        t('finance.goals.emergency', { history: review.spendHistory }))
      : null,
  ])];
}

async function explainBanner() {
  const review = await new ExplainService(app().db).review();
  if (!review.total) return null;

  const cards = [];

  if (review.problems.length) {
    cards.push(card({ class: 'explain-problems' }, [
      cardHeader(t('finance.explain.problems'),
        badge(String(review.problems.length), 'warning'), { iconName: 'alert' }),
      h('div', { class: 'list' }, review.problems.slice(0, 8).map((row) => listItem({
        title: row.title,
        subtitle: `${row.problem[0].toUpperCase()}${row.problem.slice(1)}.`,
        href: Router.href({ module: 'finance', entity: 'economicEvent', id: row.event }),
      }))),
      h('p', { class: 'small faint' }, t('finance.explain.unchanged')),
    ]));
  }

  const said = describeExplainability(review);
  cards.push(card({ class: 'card--quiet explain-count' }, [
    h('p', { class: 'small muted', style: { margin: 0 } }, said.counts),
    said.unreadable
      ? h('p', { class: 'small money--negative', style: { marginBottom: 0 } }, said.unreadable)
      : null,
  ].filter(Boolean)));

  return cards;
}

/**
 * Where one movement came from, under its own fields.
 *
 * The fields say what the movement is. This says what it is made of, and how
 * far back each piece can be followed — which is rule 57 and is not a column.
 */
async function movementEvidence(record) {
  const explanation = await new ExplainService(app().db).forEvent(record.id);
  if (!explanation) return null;

  const { amount, chains, problems } = explanation;

  return card({ class: 'explain-detail' }, [
    cardHeader(t('finance.explain.origin'), null, { iconName: 'info' }),

    h('p', { class: 'small' }, describeExplanation(explanation)),

    // Both figures, side by side, when the rows no longer add up to the one on
    // the record. Neither is corrected and neither is hidden.
    amount.agrees === false
      ? h('div', { class: 'row row--between' }, [
        h('span', { class: 'small muted' }, t('finance.explain.recordedHere')),
        money(amount.recorded),
        h('span', { class: 'small muted' }, t('finance.explain.rowsSay')),
        money(amount.fromLegs),
      ])
      : null,

    chains.length
      ? h('div', { class: 'list' }, chains.map((chain) => listItem({
        title: chain.direction === 'out' ? 'Out' : chain.direction === 'in' ? 'In' : 'A leg',
        subtitle: chain.story,
        value: chain.amount === null ? '—' : format(chain.amount),
        href: Router.href({ module: 'finance', entity: 'transaction', id: chain.transaction }),
      })))
      : null,

    problems.length
      ? h('ul', { class: 'small faint' }, problems.map((problem) => h('li', {}, problem)))
      : null,
  ]);
}


export { money };
