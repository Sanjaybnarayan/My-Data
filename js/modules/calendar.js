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
  card, cardHeader, button, badge, pageHeader, empty, listItem,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { datesInRange, upcomingDates } from '../domain/reminders.js';
import { billsInRange } from '../domain/finance.js';
import { toICalendar, icalProblems, icalFilename } from '../domain/ical.js';
import { CalendarClient, CALENDAR_SCOPES } from '../sync/calendar.js';
import { GoogleAuth } from '../auth/google.js';
import { download } from './reports.js';
import { toast } from '../ui/components/toast.js';
import { userMessage } from '../core/errors.js';
import { format } from '../core/money.js';
import {
  today, addMonths, startOfMonth, endOfMonth, addDays, formatDay,
  fromDay, toDay,
} from '../core/dates.js';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const SOURCES = [
  { id: 'event', label: 'Events', colour: 'var(--series-1)' },
  { id: 'task', label: 'Tasks', colour: 'var(--series-2)' },
  { id: 'appointment', label: 'Appointments', colour: 'var(--series-3)' },
  { id: 'money', label: 'Money due', colour: 'var(--series-6)' },
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
    const start = startOfMonth(month);
    const end = endOfMonth(month);
    // The window the grid is about to draw, so a month reached by paging is
    // gathered as fully as the one the screen opened on.
    const { entries, cardBillsStopAt } = await collect(db, { from: start, to: end });

    // A month drawn entirely past the last cycle a card bill can be worked out
    // from. The squares are not empty because nothing is due — they are empty
    // because the statement has not happened yet, and those are different
    // facts to be looking at.
    const cardsUnknown = Boolean(cardBillsStopAt) && start >= cardBillsStopAt;

    const visible = entries.filter((entry) => !hidden.has(entry.source));
    const byDay = new Map();
    for (const entry of visible) {
      if (entry.date < start || entry.date > end) continue;
      if (!byDay.has(entry.date)) byDay.set(entry.date, []);
      byDay.get(entry.date).push(entry);
    }

    replace(host, [
      pageHeader('Calendar', {
        subtitle: 'Events, tasks, appointments, money due and every renewal date',
        actions: [
          // Its own sign-in, for its own permission, asked for only when
          // somebody presses this — never at ordinary sign-in. The scope
          // reaches only calendars this application made; see `sync/calendar.js`.
          button('Sync to Google', {
            variant: 'subtle',
            iconName: 'refresh',
            onClick: () => syncCalendar(),
          }),
          // A year, not the month on screen: a household exporting their
          // calendar wants their renewals, not the four squares they happen to
          // be looking at.
          button('Export .ics', {
            variant: 'subtle',
            iconName: 'download',
            onClick: () => exportCalendar(),
          }),
          button('Add event', {
            variant: 'primary',
            iconName: 'plus',
            onClick: () => app().router.navigate({ module: 'calendar', entity: 'event', id: 'new' }),
          }),
        ],
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

        // Said before the grid rather than after it, because it changes how
        // the empty squares below should be read.
        cardsUnknown
          ? h('p', { class: 'small faint', style: { marginBottom: 'var(--space-4)' } },
            'Credit card bills are not shown this far ahead — a bill is the balance on a '
            + 'statement, and these cycles have not closed yet. Everything else is here.')
          : null,

        monthGrid(start, end, byDay),
      ]),

      dayPanel(byDay.get(selected) ?? [], selected),
    ]);
  }

  /**
   * The next twelve months as a file.
   *
   * A snapshot and not a sync, and the toast says so. Every entry carries a
   * stable UID, so importing this twice updates what is already there rather
   * than doubling it — but nothing here removes an entry deleted since, and
   * nothing comes back the other way.
   */
  async function exportCalendar() {
    const from = today();
    const { entries } = await collect(db, { from, to: addMonths(from, 12) });
    const problems = icalProblems(entries);

    if (!problems.written) {
      toast('Nothing dated in the next twelve months to export', { kind: 'info' });
      return;
    }

    await download({
      blobParts: toICalendar(entries),
      mime: 'text/calendar',
      filename: icalFilename(from),
    });

    // Anything left out is said, rather than the file quietly being short.
    const dropped = problems.undated + problems.unidentified;
    toast(dropped
      ? `${problems.written} entries exported, ${dropped} skipped`
      : `${problems.written} entries exported — importing again updates them rather than duplicating`,
    { kind: 'success' });
  }

  /**
   * Push the next twelve months to a calendar of this application's own.
   *
   * A real sync rather than the file above: pushing twice updates what is
   * there, because every entry carries the id the identity tranche gave it.
   * What it still is not is two-way — nothing here reads a household's own
   * calendar, and nothing removes an entry deleted since.
   */
  async function syncCalendar() {
    const from = today();
    const { entries } = await collect(db, { from, to: addMonths(from, 12) });
    if (!entries.length) {
      toast('Nothing dated in the next twelve months to sync', { kind: 'info' });
      return;
    }

    try {
      const auth = new GoogleAuth({ scopes: CALENDAR_SCOPES });
      const client = new CalendarClient({ getToken: () => auth.getToken() });
      const { written, failed, skipped } = await client.push(entries);

      const left = failed.length + skipped.length;
      toast(left
        ? `${written.length} sent to your calendar, ${left} could not be`
        : `${written.length} sent to a calendar of its own — sync again to update them`,
      { kind: left ? 'info' : 'success' });
    } catch (err) {
      toast(userMessage(err), { kind: 'error' });
    }
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
 *
 * The window is a real window. This used to ask `allReminders` for a 400-day
 * horizon, which quietly did nothing: a reminder lead is a ceiling, so a
 * recurring payment left the grid eight days out and paging one month forward
 * showed almost nothing. `datesInRange` answers the question a calendar is
 * actually asking — see `domain/reminders.js`.
 *
 * `cardBillsStopAt` comes back beside the entries rather than being dropped
 * here. Past that day the grid genuinely cannot say what a card bill will be —
 * the cycle has not closed — and a household looking at an empty December
 * square deserves to be told which of the two it is: nothing due, or nothing
 * knowable.
 *
 * @param {{from?: string, to?: string}} [window]
 * @returns {Promise<{entries: object[], cardBillsStopAt: string|null}>}
 */
export async function collect(db, { from = addMonths(today(), -13), to = addMonths(today(), 13) } = {}) {
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
      id: entryId('event', event.id),
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
      id: entryId('task', task.id),
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
      id: entryId('appointment', appointment.id),
      date: appointment.date,
      time: appointment.time,
      title: appointment.title,
      subtitle: [appointment.doctor, appointment.location].filter(Boolean).join(' · '),
      href: Router.href({ module: 'health', entity: 'appointment', id: appointment.id }),
    });
  }

  // Renewals come from the schema, so a new expiry date on any entity is on
  // the calendar the same day without anybody registering it here.
  const data = {};
  for (const name of ['policy', 'vehicle', 'document', 'identityDocument',
    'subscription', 'digitalAsset', 'holding', 'property', 'certificate',
    'person', 'importantDate', 'loan', 'education', 'recurringPayment',
    'account', 'transaction']) {
    data[name] = await read(name);
  }

  // What money is due, which is mostly *derived* rather than stored — a card
  // bill comes off the statement day and the rows on the card, an EMI off the
  // loan's payment day. Neither has a date field, so neither had ever appeared
  // on a calendar square. The home loan EMI is usually the largest single
  // amount a household pays.
  //
  // `billsInRange` rather than `upcomingBills`, because the two answer
  // different questions and only one of them is the calendar's. `upcomingBills`
  // gives the *next* rent, which is right for a dashboard and wrong here:
  // measured on a household paying ₹80,239 a month, this grid drew all of it in
  // September and left the other eleven months of the year empty.
  const { bills, cardBillsStopAt } = billsInRange(data.recurringPayment, data.loan, {
    from,
    to,
    accounts: data.account,
    transactions: data.transaction,
    subscriptions: data.subscription,
    digitalAssets: data.digitalAsset,
  });

  // A recurring payment is both a dated record and a bill. Keyed exactly, on
  // the record and the day, so the two never draw the same thing twice — and
  // the bill wins, because it is the one carrying the amount.
  const billed = new Set(bills.map((b) => `${b.entity}:${b.recordId}:${b.dueOn}`));

  for (const bill of bills) {
    entries.push({
      source: 'money',
      // Already unique per occurrence — `billsInRange` keys it that way so a
      // rent due twelve times is twelve entries, not one.
      id: bill.id,
      date: bill.dueOn,
      title: bill.name,
      subtitle: bill.amount === null
        // A card with no statement day knows the date and not the figure.
        ? bill.why ?? 'amount not known'
        : format(bill.amount),
      amount: bill.amount,
      href: bill.recordId
        ? Router.href({ module: moduleOf(bill.entity), entity: bill.entity, id: bill.recordId })
        : null,
    });
  }

  for (const dated of datesInRange(data, { from, to })) {
    if (billed.has(`${dated.entity}:${dated.recordId}:${dated.date}`)) continue;
    entries.push({
      source: 'expiry',
      id: dated.id,
      date: dated.date,
      title: dated.title,
      subtitle: dated.label ?? '',
      href: Router.href({ module: dated.module, entity: dated.entity, id: dated.recordId }),
    });
  }

  // Birthdays and anniversaries repeat yearly, so they are generated rather
  // than filtered — a window of a year either way covers the grid.
  for (const date of upcomingDates(data.person, data.importantDate, { days: 400, from })) {
    entries.push({
      source: 'date',
      // `upcomingDates` ids the *record*, not the occurrence: a birthday
      // recurs yearly under one id, so two years of it would collapse into a
      // single entry. The **year**, not the whole date — a corrected birthday
      // should move the entry it already has rather than orphan it and add a
      // second.
      id: entryId('date', date.id, date.date.slice(0, 4)),
      date: date.date,
      title: date.title,
      subtitle: date.turning ? `turning ${date.turning}` : (date.kind ?? ''),
      href: null,
    });
  }

  return {
    entries: entries.filter((entry) => entry.date).sort((a, b) => a.date.localeCompare(b.date)),
    cardBillsStopAt,
  };
}

/**
 * What identifies one square on the calendar.
 *
 * Measured before it was written: **0 of 31 entries carried an id**, though
 * three of the six sources already produce one and `collect` dropped it on the
 * way past. The identity existed and was being thrown away — the same shape as
 * most of the other defects found in this codebase.
 *
 * The date alone is not enough. Two events called *Standup* on the same day, at
 * nine and at five, are told apart by nothing else a calendar can see — that
 * was the one collision in the measured fixture, and the record id resolves it.
 *
 * **The occurrence part is only added where one record yields more than one
 * square, and getting that backwards is a real bug rather than an
 * inconsistency.** An event, a task and an appointment are each one record and
 * one date, so their id is the record alone: put the date in it and moving a
 * dentist appointment changes its identity, so anything syncing these would
 * add a second appointment rather than move the one that exists. A bill is the
 * opposite — one record, twelve dates — so `billsInRange` keys each occurrence
 * by its own date. A birthday sits between the two and is keyed by **year**,
 * because it recurs annually but a corrected date of birth should move the
 * entry rather than orphan it.
 *
 * A renewal keeps `datesInRange`'s `entity:record:field`, with no date at all,
 * for the same reason: `renewsOn` moving a year forward is the same renewal
 * falling due again, not a new one.
 *
 * @param {string} source
 * @param {string} recordId
 * @param {string} [occurrence] only where one record produces several squares
 */
export function entryId(source, recordId, occurrence) {
  return occurrence ? `${source}:${recordId}:${occurrence}` : `${source}:${recordId}`;
}

/** Which screen a bill's record lives on. Subscriptions are filed under Digital. */
function moduleOf(entity) {
  return entity === 'subscription' || entity === 'digitalAsset' ? 'digital' : 'finance';
}

function colourOf(source) {
  return SOURCES.find((s) => s.id === source)?.colour ?? 'var(--series-6)';
}

function monthName(day) {
  const date = fromDay(day);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export { toDay };
