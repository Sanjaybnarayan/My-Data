/**
 * The assistant screen.
 *
 * A question box, an answer, and the records the answer was computed from.
 * That last part is the design: an answer nobody can check is worse than no
 * answer, particularly about money.
 *
 * The panel says plainly what this is — a fixed set of questions answered from
 * local data, with nothing sent anywhere — rather than implying a model that
 * is not there.
 */

import { h, focus } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, badge, pageHeader, listItem, empty, money,
} from '../ui/components/basics.js';
import { donutChart } from '../ui/components/charts.js';
import { entityTable } from '../ui/components/table.js';
import { app } from '../context.js';
import { exampleQuestions } from '../ai/assistant.js';
import { Router } from '../ui/router.js';
import { entity } from '../data/schema.js';
import { formatDay } from '../core/dates.js';
import { format } from '../core/money.js';

export async function render(route) {
  const { assistant, router } = app();
  const answers = h('div', { class: 'stack' });

  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder: 'Ask about spending, net worth, renewals, bills…',
    'aria-label': 'Ask a question',
    autocomplete: 'off',
    onKeydown: (event) => {
      if (event.key === 'Enter') ask(event.target.value);
    },
  });

  async function ask(question) {
    const text = question.trim();
    if (!text) return;

    const pending = card({ class: 'card--quiet' }, h('p', { class: 'small muted' }, 'Working it out…'));
    answers.prepend(pending);

    const answer = await assistant.answer(text);
    pending.replaceWith(renderAnswer(text, answer, router));
    input.value = '';
  }

  const host = h('div', {}, [
    pageHeader('Ask FamilyOS', {
      subtitle: 'Answered from the records on this device',
    }),

    card({}, [
      h('div', { class: 'search-box', style: { maxWidth: 'none' } },
        [icon('sparkle', { size: 18 }), input]),
      h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Example questions', style: { marginTop: 'var(--space-3)' } },
        exampleQuestions().slice(0, 6).map((example) => h('button', {
          class: 'chip',
          type: 'button',
          onClick: () => { input.value = example; ask(example); },
        }, example))),
    ]),

    card({ class: 'card--quiet' }, [
      h('p', { class: 'small muted' }, [
        icon('info', { size: 15 }),
        ' This is not a language model. It understands a fixed set of questions and '
        + 'answers them from your own records — nothing is sent anywhere, and every '
        + 'answer shows the rows it was worked out from. If it does not understand '
        + 'a question it will say so rather than guess.',
      ]),
    ]),

    answers,
  ]);

  if (route.query?.q) {
    setTimeout(() => { input.value = route.query.q; ask(route.query.q); }, 0);
  } else {
    setTimeout(() => focus(input), 0);
  }

  return { node: host };
}

function renderAnswer(question, answer, router) {
  const body = [
    h('div', { class: 'row row--between' }, [
      h('span', { class: 'small faint' }, question),
      answer.period && !answer.period.assumed
        ? badge(`${formatDay(answer.period.from)} – ${formatDay(answer.period.to)}`)
        : answer.period?.assumed
          ? badge('assumed this month', 'warning')
          : null,
    ]),
    h('p', { style: { fontSize: 'var(--text-lg)', lineHeight: '1.6' } }, answer.text),
  ];

  if (answer.suggestions?.length) {
    body.push(h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Follow-up questions' }, answer.suggestions.map((suggestion) => h('button', {
      class: 'chip',
      type: 'button',
      onClick: () => router.navigate({ module: 'assistant', query: { q: suggestion } }),
    }, suggestion))));
  }

  if (answer.chart?.data?.length) {
    body.push(donutChart(answer.chart.data, { label: 'Breakdown', size: 150 }));
  }

  if (answer.breakdown?.length) {
    body.push(h('div', { class: 'list' }, answer.breakdown.map((row) => listItem({
      title: row.label,
      value: format(row.value),
      tone: row.value < 0 ? 'negative' : null,
    }))));
  }

  if (answer.bills?.length) {
    body.push(h('div', { class: 'list' }, answer.bills.slice(0, 10).map((bill) => listItem({
      title: bill.name,
      subtitle: formatDay(bill.dueOn),
      value: format(bill.amount),
      trailing: bill.overdue ? badge('overdue', 'danger') : null,
    }))));
  }

  if (answer.reminders?.length) {
    body.push(h('div', { class: 'list' }, answer.reminders.slice(0, 10).map((reminder) => listItem({
      title: reminder.title,
      subtitle: `${reminder.label ?? ''} · ${formatDay(reminder.date)}`,
      trailing: badge(`${reminder.days} days`, reminder.days < 0 ? 'danger' : ''),
      href: reminder.recordId
        ? Router.href({ module: reminder.module, entity: reminder.entity, id: reminder.recordId })
        : null,
    }))));
  }

  if (answer.accounts?.length) {
    body.push(h('div', { class: 'list' }, answer.accounts.map((account) => listItem({
      title: account.name,
      subtitle: account.kind,
      value: format(account.balance),
      href: Router.href({ module: 'finance', entity: 'account', id: account.id }),
    }))));
  }

  if (answer.hits?.length) {
    body.push(h('div', { class: 'list' }, answer.hits.map((hit) => listItem({
      title: hit.title || '(untitled)',
      subtitle: `${hit.module} · ${hit.subtitle || hit.entity}`,
      href: `#/${hit.module}/${hit.entity}/${hit.recordId}`,
    }))));
  }

  // The rows behind the number, so the figure can be audited rather than
  // trusted. Collapsed by default: the answer is the point, this is the proof.
  if (answer.records?.rows?.length) {
    const def = entity(answer.records.entity);
    const table = entityTable(answer.records.entity, answer.records.rows.slice(0, 200), {
      currency: app().currency,
    });
    body.push(h('details', {}, [
      h('summary', { class: 'small muted', style: { cursor: 'pointer' } },
        `Show the ${answer.records.rows.length} ${def.labels.many.toLowerCase()} behind this`),
      h('div', { style: { marginTop: 'var(--space-3)' } }, table.node),
    ]));
  }

  if (answer.error) {
    body.push(h('p', { class: 'small faint mono' }, answer.error));
  }

  return card({}, [cardHeader('Answer', null, { iconName: 'sparkle' }), ...body]);
}

export { empty, money };
