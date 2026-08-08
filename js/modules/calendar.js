/**
 * Calendar.
 *
 * A month grid that draws from four places at once — events, tasks with a due
 * date, appointments, and everything the schema marks as an expiry — because
 * a household calendar with only "events" on it is a calendar nobody opens.
 * The insurance renewal is the entry that matters.
 *
 * The month is built in local calendar days throughout. Turning a day into an
 * instant to lay out a grid is how a birthday lands on the wrong square for
 * anyone east of Greenwich.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, button, badge, pageHeader, empty, listItem, chip,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { allReminders } from '../domain/reminders.js';
import {
  today, addMonths, startOfMonth, endOfMonth, addDays, formatDay, fromDay, toDay,
} from '../core/dates.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SOURCES = [
  { id: 'event', label: 'Events', colour: 'var(--series-1)' },
  { id: 'task', label: 'Tasks', colour: 'var(--series-2)' },
  { id: 'appointment', label: 'Appointments', colour: 'var(--series-3)' },
  { id: 'expiry', label: 'Renewals', colour: 'var(--series-5)' },
  { id: 'date', label: 'Birthdays', colour: 'var(--series-4)' },
];

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  if (route.entity === 'event' && route.id === 'new') {
    const section = await listSection('event', { autoOpenNew: true });
    return { node: section.node, destroy: section.destroy };
  }

  const { db } = app();
  const host = h('div', {});

  let month = startOfMonth(today());
  let hidden = new Set();
  let selected = today();

  async function paint() {
    const entries = await collect(db);
    const start = startOfMonth(month);
    const end = endOfMonth(month);

    const visible = entries.filter((entry) => !hidden.has(entry.source));
    const byDay = new Map();
    for (const entry of visible) {
      if (entry.date < start || entry.date > end) continue;
      if (!byDay.has(entry.date)) byDay.set(entry.date, []);
      byDay.get(entry.date).push(entry);
    }

    replace(host, [
      pageHeader('Calendar', {
        subtitle: 'Events, tasks, appointments and every renewal date',
        actions: [button('Add event', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'calendar', entity: 'event', id: 'new' }),
        })],
      }),

      card({}, [
        h('div', { class: 'row row--between', style: { marginBottom: 'var(--space-4)' } }, [
          h('div', { class: 'row' }, [
            h('button', {
              class: 'btn btn--icon', type: 'button', 'aria-label': 'Previous month',
              onClick: () => { month = addMonths(month, -1); paint(); },
            }, icon('chevronLeft')),
            h('h2', { style: { minWidth: '11rem', textAlign: 'center' } }, monthName(month)),
            h('button', {
              class: 'btn btn--icon', type: 'button', 'aria-label': 'Next month',
              onClick: () => { month = addMonths(month, 1); paint(); },
            }, icon('chevronRight')),
          ]),
          button('Today', {
            variant: 'subtle',
            onClick: () => { month = startOfMonth(today()); selected = today(); paint(); },
          }),
        ]),

        h('div', { class: 'chip-row', style: { marginBottom: 'var(--space-4)' } },
          SOURCES.map((source) => h('button', {
            class: 'chip',
            type: 'button',
            'aria-pressed': String(!hidden.has(source.id)),
            onClick: () => {
              if (hidden.has(source.id)) hidden.delete(source.id); else hidden.add(source.id);
              paint();
            },
          }, [
            h('span', { class: 'legend-swatch', style: { background: source.colour } }),
            source.label,
          ]))),

        monthGrid(start, end, byDay),
      ]),

      dayPanel(byDay.get(selected) ?? [], selected),
    ]);
  }

  function monthGrid(start, end, byDay) {
    // Monday-first: the week most household calendars are printed with.
    const firstWeekday = (fromDay(start).getDay() + 6) % 7;
    const cells = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push(h('div', { style: { minHeight: '84px' } }));
    }

    for (let day = start; day <= end; day = addDays(day, 1)) {
      const entries = byDay.get(day) ?? [];
      const isToday = day === today();
      const isSelected = day === selected;
      const current = day;

      cells.push(h('button', {
        type: 'button',
        class: 'card',
        'aria-label': `${formatDay(day)}, ${entries.length} entries`,
        'aria-current': isToday ? 'date' : null,
        style: {
          minHeight: '84px',
          padding: 'var(--space-2)',
          textAlign: 'left',
          cursor: 'pointer',
          boxShadow: 'none',
          background: isSelected ? 'var(--accent-subtle)' : 'var(--surface-raised)',
          borderColor: isToday ? 'var(--accent)' : 'var(--border)',
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
        },
        onClick: () => { selected = current; paint(); },
      }, [
        h('span', {
          class: 'small',
          style: {
            fontWeight: isToday ? '700' : '500',
            color: isToday ? 'var(--accent-text)' : 'var(--text-muted)',
          },
        }, String(Number(day.slice(8)))),

        ...entries.slice(0, 3).map((entry) => h('span', {
          class: 'small truncate',
          style: {
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: 'var(--text-xs)', lineHeight: '1.35',
          },
        }, [
          h('span', {
            style: {
              width: '6px', height: '6px', borderRadius: '50%',
              background: colourOf(entry.source), flex: 'none',
            },
          }),
          entry.title,
        ])),

        entries.length > 3
          ? h('span', { class: 'small faint' }, `+${entries.length - 3} more`)
          : null,
      ]));
    }

    return h('div', {}, [
      h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 'var(--space-2)',
          marginBottom: 'var(--space-2)',
        },
      }, WEEKDAYS.map((name) => h('div', {
        class: 'small faint',
        style: { textAlign: 'center', fontWeight: '600' },
      }, name))),

      h('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gap: 'var(--space-2)',
        },
      }, cells),
    ]);
  }

  function dayPanel(entries, day) {
    return card({ class: 'card--flush' }, [
      h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
        cardHeader(formatDay(day), badge(`${entries.length}`))),
      entries.length
        ? h('div', { class: 'list' }, entries.map((entry) => listItem({
          leading: h('span', {
            style: {
              width: '8px', height: '8px', borderRadius: '50%',
              background: colourOf(entry.source), flex: 'none',
            },
          }),
          title: entry.title,
          subtitle: entry.subtitle,
          trailing: entry.time ? badge(entry.time) : null,
          href: entry.href,
        })))
        : empty({ title: 'Nothing on this day', iconName: 'calendar' }),
    ]);
  }

  await paint();
  const off = bus.on(TOPIC.dataChanged, () => paint());
  return { node: host, destroy: off };
}

/* ------------------------------------------------------------- gathering */

/**
 * Everything with a date, from every module, in one list. Exported so the
 * dashboard and the reports can use the same definition of "what is on the
 * calendar" rather than inventing a second one.
 */
export async function collect(db) {
  const read = async (name) => {
    try {
      return await db.repo(name).list({ decrypt: false, limit: 5000 });
    } catch {
      return [];
    }
  };

  const [events, tasks, appointments] = await Promise.all([
    read('event'), read('task'), read('appointment'),
  ]);

  const entries = [];

  for (const event of events) {
    entries.push({
      source: 'event',
      date: event.date,
      time: event.allDay ? null : event.startTime,
      title: event.title,
      subtitle: [event.kind, event.location].filter(Boolean).join(' · '),
      href: Router.href({ module: 'calendar', entity: 'event', id: event.id }),
    });
  }

  for (const task of tasks) {
    if (!task.dueOn || task.status === 'done') continue;
    entries.push({
      source: 'task',
      date: task.dueOn,
      time: task.dueTime,
      title: task.title,
      subtitle: `task · ${task.priority}`,
      href: Router.href({ module: 'tasks', entity: 'task', id: task.id }),
    });
  }

  for (const appointment of appointments) {
    if (appointment.status === 'cancelled') continue;
    entries.push({
      source: 'appointment',
      date: appointment.date,
      time: appointment.time,
      title: appointment.title,
      subtitle: [appointment.doctor, appointment.location].filter(Boolean).join(' · '),
      href: Router.href({ module: 'health', entity: 'appointment', id: appointment.id }),
    });
  }

  // Renewals and birthdays come from the same schema-driven reminder engine
  // the dashboard uses, over a wide horizon so paging back and forth works.
  const data = {};
  for (const name of ['policy', 'vehicle', 'document', 'identityDocument',
    'subscription', 'digitalAsset', 'holding', 'property', 'certificate',
    'person', 'importantDate', 'loan', 'education', 'recurringPayment']) {
    data[name] = await read(name);
  }

  for (const reminder of allReminders(data, { horizonDays: 400 })) {
    entries.push({
      source: reminder.group === 'date' ? 'date' : 'expiry',
      date: reminder.date,
      title: reminder.title,
      subtitle: reminder.label ?? reminder.kind ?? '',
      href: reminder.recordId
        ? Router.href({ module: reminder.module, entity: reminder.entity, id: reminder.recordId })
        : null,
    });
  }

  return entries.filter((entry) => entry.date).sort((a, b) => a.date.localeCompare(b.date));
}

function colourOf(source) {
  return SOURCES.find((s) => s.id === source)?.colour ?? 'var(--series-6)';
}

function monthName(day) {
  const date = fromDay(day);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export { toDay };
