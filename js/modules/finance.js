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
  avatar,
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
import { FinanceService } from '../services/finance.js';
import { GoalsService } from '../services/goals.js';
import { describeGoal, STATUS as GOAL_STATUS } from '../domain/goals.js';
import { CONFIDENCE } from '../domain/events.js';
import { describeSettlement } from '../domain/settlement.js';
import { staleness, describeStaleness, describeEmi } from '../domain/amortise.js';
import { describeSpendByMember, settleable } from '../domain/household.js';
import { describeCommitments } from '../domain/commitments.js';
import { describeRunway } from '../domain/runway.js';
import { TRANSACTION_LIMIT } from '../services/service.js';
import { EvidenceService } from '../services/evidence.js';
import { describeOrphan } from '../domain/evidence.js';
import { ExplainService } from '../services/explain.js';
import { describeExplanation } from '../domain/explain.js';
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
  { id: 'goal', label: 'Goals' },
  { id: 'economicEvent', label: 'Movements' },
  { id: 'smsMessage', label: 'Messages' },
];

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
const NO_ADD = new Set(['import', 'shops', 'people', 'lending', 'insights', 'transaction',
  'bankStatement', 'smsMessage', 'economicEvent']);

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
  const review = await new EvidenceService(app().db).review();
  const cards = [];

  if (review.orphans.length) {
    cards.push(card({ class: 'evidence-orphans' }, [
      cardHeader('Paid, and not in the ledger',
        badge(String(review.orphans.length), 'warning'), { iconName: 'alert' }),
      h('div', { class: 'list' }, review.orphans.map((orphan) => listItem({
        title: orphan.merchant || 'A payment',
        subtitle: describeOrphan(orphan, format),
        value: format(orphan.amount),
      }))),
      h('p', { class: 'small faint' },
        'Nothing has been added. Import the statement these belong to, or add '
        + 'the payment yourself if there is no statement for it.'),
    ]));
  }

  if (review.disagreeing) {
    cards.push(card({ class: 'card--quiet evidence-disagreements' }, [
      cardHeader('Sources that disagree', badge(String(review.disagreeing), 'warning'),
        { iconName: 'info' }),
      h('p', { class: 'small muted' },
        `${review.disagreeing} payment${review.disagreeing === 1 ? '' : 's'} where a `
        + 'message, a receipt and the statement do not state the same figure. '
        + 'Every figure is kept as it was recorded; nothing here decides which '
        + 'is right.'),
    ]));
  }

  if (review.corroborated) {
    cards.push(card({ class: 'card--quiet evidence-count' }, [
      h('p', { class: 'small muted', style: { margin: 0 } },
        `${review.corroborated} of ${review.total} payments have more than one `
        + 'thing saying they happened. That is corroboration, not verification — '
        + 'none of these sources is a person having checked it.'),
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
async function goalsBanner() {
  const review = await new GoalsService(app().db).review();
  if (!review.any) return null;

  return [card({ class: 'goals-progress' }, [
    cardHeader('Where each goal stands', null, {
      subtitle: 'Read from the accounts and holdings that fund it, not from a '
        + 'figure anybody typed',
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
        `An emergency fund is sized in months of spending, and ${review.spendHistory}.`)
      : null,
  ])];
}

async function explainBanner() {
  const review = await new ExplainService(app().db).review();
  if (!review.total) return null;

  const cards = [];

  if (review.problems.length) {
    cards.push(card({ class: 'explain-problems' }, [
      cardHeader('Movements with something wrong behind them',
        badge(String(review.problems.length), 'warning'), { iconName: 'alert' }),
      h('div', { class: 'list' }, review.problems.slice(0, 8).map((row) => listItem({
        title: row.title,
        subtitle: `${row.problem[0].toUpperCase()}${row.problem.slice(1)}.`,
        href: Router.href({ module: 'finance', entity: 'economicEvent', id: row.event }),
      }))),
      h('p', { class: 'small faint' },
        'Nothing here has been changed. A figure recorded on a movement is what '
        + 'somebody confirmed; the rows are what they say now, and both are kept.'),
    ]));
  }

  cards.push(card({ class: 'card--quiet explain-count' }, [
    h('p', { class: 'small muted', style: { margin: 0 } },
      `${review.documented} of ${review.total} movements are made only of rows `
      + `parsed from a statement. ${review.partlyTyped} include a row somebody `
      + `typed, and ${review.unexplained} have no rows behind them at all. `
      + 'None of this was checked by a person.'),
  ]));

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
    cardHeader('Where this came from', null, { iconName: 'info' }),

    h('p', { class: 'small' }, describeExplanation(explanation)),

    // Both figures, side by side, when the rows no longer add up to the one on
    // the record. Neither is corrected and neither is hidden.
    amount.agrees === false
      ? h('div', { class: 'row row--between' }, [
        h('span', { class: 'small muted' }, 'Recorded here'),
        money(amount.recorded),
        h('span', { class: 'small muted' }, 'The rows now say'),
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
  const { proposals, total, unmatched, sets = [], setsTotal, undecided = [] } = transfers;
  if (!proposals.length && !unmatched.length && !sets.length && !undecided.length) return null;

  const probable = proposals.filter((p) => p.confidence === CONFIDENCE.PROBABLE);
  const questions = proposals.filter((p) => p.confidence === CONFIDENCE.POSSIBLE);

  async function acceptFee(proposal) {
    try {
      await new TransfersService(db).confirmWithFee(proposal);
      toast('Recorded as one movement, less the charge — every row is kept',
        { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

  async function confirmSet(set) {
    try {
      await new TransfersService(db).confirmSet(set);
      toast('Recorded as one movement — every statement row is kept', { kind: 'success' });
      await repaint();
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
  }

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
      // A near-match with exactly one charge accounting for it can now be
      // accepted by a person. The engine still will not: unequal amounts never
      // match *automatically*, which is not the same as never.
      : p.evidence?.length === 1 && !p.ambiguous
        ? button('Accept with the charge', { variant: 'subtle', onClick: () => acceptFee(p) })
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

    // A movement that landed in more than one piece. Measured: ₹50,000 out of
    // one account arriving as ₹30,000 and ₹20,000 in two others produced no
    // proposal at all, so all three rows sat under the "no partner" line below
    // with nothing to say they add up to something.
    sets.length
      ? h('div', {}, [
        h('p', { class: 'small muted' },
          'These moved in more than one piece — one row on one side, several on the other. '
          + 'The amount is counted once, not once per row.'),
        h('div', { class: 'list' }, sets.map((set) => listItem({
          title: set.shape === 'split'
            ? `${set.anchorName} → ${set.legNames.join(', ')}`
            : `${set.legNames.join(', ')} → ${set.anchorName}`,
          subtitle: `${formatDay(set.anchor.date)} · ${set.why}`,
          value: format(set.amount),
          leading: badge(set.confidence,
            set.confidence === CONFIDENCE.PROBABLE ? 'info' : 'warning'),
          // There is now something a confirmation can write: a shared id on
          // every leg. `linkFor` could not express this — `toAccount` names one
          // destination and a split has several — which is why this row used to
          // carry no control at all.
          trailing: set.confidence === CONFIDENCE.PROBABLE
            ? button('One movement', { variant: 'subtle', onClick: () => confirmSet(set) })
            : null,
        }))),
        setsTotal?.movements
          ? h('p', { class: 'small faint' },
            `${format(setsTotal.moved)} across ${setsTotal.movements} `
            + `${setsTotal.movements === 1 ? 'movement' : 'movements'} in pieces`)
          : null,
      ].filter(Boolean))
      : null,

    // Where the search stopped rather than guessed. Saying nothing here would
    // read as "there is nothing", which is a different claim.
    undecided.length
      ? h('p', { class: 'small faint' },
        `${undecided.length} ${undecided.length === 1 ? 'row has' : 'rows have'} too many `
        + 'possible partners to work out — ' + undecided[0].why)
      : null,

    unmatched.length
      ? h('p', { class: 'small faint' },
        `${unmatched.length} transfer ${unmatched.length === 1 ? 'row has' : 'rows have'} no `
        + 'partner at all — usually the other account\u2019s statement has not been imported.')
      : null,
  ].filter(Boolean));
}

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
function loansCard(loans, transactions) {
  const live = (loans ?? []).filter((loan) => !loan.deletedAt);
  if (!live.length) return null;

  const rows = live.map((loan) => ({
    loan,
    note: describeStaleness(staleness(loan, transactions), format),
  }));

  return card({}, [
    cardHeader('Loans', [], {
      subtitle: `${format(live.reduce((n, l) => n + (l.outstanding ?? 0), 0))} recorded as outstanding`,
      iconName: 'bank',
    }),

    h('div', { class: 'list' }, rows.map(({ loan, note }) => listItem({
      title: loan.name,
      subtitle: note ?? `${loan.interestRate ?? '—'}% · EMI ${format(loan.emiAmount ?? 0)}`,
      value: format(loan.outstanding ?? 0),
      leading: badge(loan.kind ?? 'loan', note ? 'warning' : ''),
    }))),

    rows.some((r) => r.note)
      ? h('p', { class: 'small faint' },
        'Estimates come from the rate and EMI recorded here, so they cannot know '
        + 'about a rate change, a prepayment or a payment holiday. Update the figure '
        + 'from the lender’s statement, not from this.')
      : null,
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
    cardHeader('Who paid, this month', [], {
      subtitle: report.complete
        ? 'Every payment has somebody recorded against it'
        : `${report.coverage}% of this month’s spending has somebody recorded against it`,
      iconName: 'user',
    }),

    h('div', { class: 'list' }, report.members.map((member) => listItem({
      leading: avatar(member.person.name),
      title: member.person.name,
      subtitle: `${member.count} ${member.count === 1 ? 'payment' : 'payments'}`
        + (member.topCategory ? ` · mostly ${member.topCategory}` : ''),
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
  const when = `${formatDay(bill.dueOn)} · ${relativeDays(bill.dueOn)}`;
  // A subscription that does not renew itself stops on that date. Left
  // unsaid, the row looks identical to a bill that pays itself.
  if (bill.source === 'subscription') return bill.why ? `${when} · ${bill.why}` : when;
  if (bill.source !== 'card') return when;
  if (!bill.statement) return `${when} · ${bill.why}`;
  return `${when} · from the statement of ${formatDay(bill.statement)}`;
}

async function financeOverview() {
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
      transfers,
    } = await new FinanceService(db).overview();

    replace(host, h('div', { class: 'grid grid--wide' }, [
      transfersCard(db, transfers, paint),
      memberCard(byMember),

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
        // Said next to the number it is about, and it never changes the number
        // itself. A total that quietly shrank because a second file was
        // imported would be worse than the double count, because nobody would
        // know why.
        settlement.settlements.length
          ? h('p', {
            class: settlement.corrected ? 'small money--negative' : 'small faint',
          }, describeSettlement(settlement, compare.current.expense, format))
          : null,

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

        // Said where the figure is, not in a tooltip. A forecast whose
        // assumptions are hidden is a forecast presenting itself as an answer.
        runway.assumptions.length
          ? h('p', { class: 'small faint' },
            `Assuming: ${runway.assumptions.join('; ')}.`)
          : null,
      ].filter(Boolean)),

      loansCard(loans, transactions),

      card({}, [
        cardHeader('Cash & accounts'),

        // Said where the balances are, not in a log. A balance summed from the
        // most recent rows is not the account's balance once there are more of
        // them than that, and the household is the only one who can tell
        // whether it matters to them.
        truncated
          ? h('p', { class: 'small money--negative' },
            `Only the most recent ${TRANSACTION_LIMIT.toLocaleString('en-IN')} transactions `
            + 'were read, so these balances are computed from part of your history '
            + 'rather than all of it.')
          : null,
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
            subtitle: billSubtitle(bill),
            // A card with no statement day knows the date and not the figure.
            // An em dash says that; a number here would be one this
            // application invented, on the bill where being wrong is dearest.
            value: bill.amount === null ? '—' : format(bill.amount),
            trailing: bill.overdue ? badge('overdue', 'danger')
              : bill.source === 'card' ? badge('statement')
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
