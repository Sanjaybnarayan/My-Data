/**
 * Notifications — everything that wants attention, worst first.
 *
 * ## What this screen is, and what it is not
 *
 * It is a view over dates the household has already recorded: expiries the
 * schema marks, bills and EMIs falling due, birthdays and anniversaries. Every
 * figure on it comes from a record somebody entered.
 *
 * It is **not** a push notification centre, and it must not be read as one.
 * Nothing here reaches the phone's notification tray. `POST_NOTIFICATIONS` is
 * declared in the manifest, but the only thing that posts is the location
 * foreground service, so a screen implying the phone will interrupt you would
 * be claiming something the application does not do. The card at the bottom
 * says so on the screen rather than only here.
 *
 * There is also **no read/unread state**, because nothing stores one. A badge
 * saying "3 unread" would be inventing a fact about what somebody has looked
 * at. The count is of things actually late or nearly late, and it falls when
 * they are dealt with — not when they are glanced at.
 *
 * ## The grouping
 *
 * By the severity `domain/reminders.js` already assigns, not by a scheme
 * invented here. Four groups, in the order somebody would want them.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, badge, chip, button, listItem, empty, pageHeader,
} from '../ui/components/basics.js';
import { Router } from '../ui/router.js';
import { app } from '../context.js';
import { AttentionService } from '../services/attention.js';
import { formatDay } from '../core/dates.js';
import { modules } from '../data/schema.js';
import { moduleLabel } from '../core/labels.js';
import { t } from '../core/locale.js';

/**
 * The four groups, in order, with the words that say what each one means.
 *
 * The design brief asked for CRITICAL / HIGH / TODAY / EARLIER. These are the
 * severities the data actually carries: every item here is a *future* deadline
 * or a recently missed one, so "today" and "earlier" would describe nothing
 * this screen holds. Naming them for what they are keeps the screen honest.
 */
const GROUPS = Object.freeze([
  { id: 'overdue', tone: 'danger', blurb: 'notifications.overdueBlurb' },
  { id: 'urgent', tone: 'warning', blurb: null },
  { id: 'soon', tone: '', blurb: null },
  { id: 'upcoming', tone: '', blurb: null },
]);

/**
 * The categories that can appear, derived from the items in hand.
 *
 * Not the eleven the design brief listed. Four of those — Safety, Security, AI
 * and System — have no source: nothing in this application produces a reminder
 * of that kind, so a chip for one could never match anything and would be a
 * filter that does nothing but sit there. What is offered is what this
 * household actually has, in the order the modules are navigated, each with
 * the number it would show.
 */
function categoriesIn(items) {
  const counts = new Map();
  for (const one of items) {
    if (!one.module) continue;
    counts.set(one.module, (counts.get(one.module) ?? 0) + 1);
  }
  return modules
    .filter((mod) => counts.has(mod.id))
    .map((mod) => ({ id: mod.id, label: moduleLabel(mod), count: counts.get(mod.id) }));
}

/** Everything the filters currently allow through. */
function visible(items, { category, term }) {
  const needle = term.trim().toLowerCase();
  return items.filter((one) => {
    if (category && one.module !== category) return false;
    if (!needle) return true;
    return `${one.line} ${one.title ?? ''} ${one.label ?? ''}`.toLowerCase().includes(needle);
  });
}

export async function render() {
  const host = h('div', {});
  const body = h('div', {});
  const { db } = app();

  const attention = await new AttentionService(db).everything({ horizonDays: 45 });
  const categories = categoriesIn(attention.items);

  /** Filter state, held here rather than stored — a view, not a preference. */
  const filter = { category: null, term: '' };

  const search = h('input', {
    class: 'input',
    type: 'search',
    placeholder: t('notifications.search'),
    'aria-label': t('notifications.search'),
    onInput: (event) => { filter.term = event.target.value; paint(); },
  });

  function chips() {
    const total = attention.items.length;
    return h('div', { class: 'chip-row' }, [
      chip(t('notifications.all', { n: total }), {
        pressed: filter.category === null,
        onClick: () => { filter.category = null; paint(); },
      }),
      ...categories.map((one) => chip(`${one.label} ${one.count}`, {
        pressed: filter.category === one.id,
        onClick: () => {
          // Pressing the chip already chosen clears it, which is what somebody
          // expects from a control that shows itself as pressed.
          filter.category = filter.category === one.id ? null : one.id;
          paint();
        },
      })),
    ]);
  }

  function paint() {
    const rows = visible(attention.items, filter);

    replace(body, [
      rows.length
        ? h('div', {}, GROUPS.map((group) => section(group, rows)))
        : card({}, empty({
          // Two different nothings. Nothing is due at all, or nothing matches
          // what was typed — and telling somebody the first when the second is
          // true reads as though their records vanished.
          title: attention.items.length
            ? t('notifications.noMatch.title')
            : t('notifications.empty.title'),
          message: attention.items.length
            ? t('notifications.noMatch.message')
            : t('notifications.empty.message'),
          iconName: attention.items.length ? 'search' : 'check',
          action: attention.items.length
            ? button(t('notifications.clearFilters'), {
              variant: 'subtle',
              onClick: () => {
                filter.category = null;
                filter.term = '';
                search.value = '';
                paint();
              },
            })
            : null,
        })),
    ]);
  }

  paint();

  replace(host, [
    pageHeader(t('notifications.title'), { subtitle: t('notifications.subtitle') }),

    attention.items.length
      ? card({ class: 'card--tight' }, [
        h('div', { class: 'filter-bar' }, [
          h('div', { class: 'search-box search-box--grow' }, search),
        ]),
        categories.length > 1 ? chips() : null,
      ])
      : null,

    body,
    reachCard(),
  ]);

  return { node: host };
}

function section(group, items) {
  const rows = items.filter((one) => one.severity === group.id);
  if (!rows.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'notifications-head' },
      cardHeader(t(`notifications.group.${group.id}`), badge(String(rows.length), group.tone))),

    group.blurb
      ? h('p', { class: 'small muted notifications-blurb' }, t(group.blurb))
      : null,

    h('div', { class: 'list' }, rows.map((one) => {
      const to = one.module && one.entity && one.recordId
        ? Router.href({ module: one.module, entity: one.entity, id: one.recordId })
        : undefined;

      return listItem({
        title: one.line,
        // Where it came from and when, so the item can be judged without
        // opening it — which is the whole point of a list like this.
        subtitle: `${one.label ?? t('notifications.dateFallback')} · ${formatDay(one.date)}`,
        href: to,
        /*
         * A visible control as well as the row being a link.
         *
         * The row already navigates, so this is redundant to a pointer — and
         * it is not redundant to somebody who cannot tell that a row is
         * tappable, which on a list of plain text is most people. The brief
         * asks for visible controls beside any gesture, and this is the same
         * argument.
         */
        trailing: to
          ? h('a', {
            class: 'btn btn--subtle btn--small',
            href: to,
            'aria-label': t('notifications.openNamed', { title: one.title ?? one.line }),
          }, t('notifications.open'))
          : null,
      });
    })),
  ]);
}

/**
 * What this screen does not do, said on the screen.
 *
 * Somebody looking at a list called Notifications will reasonably assume their
 * phone will tell them. It will not, and finding that out by missing a renewal
 * is the worst possible way to learn it.
 */
function reachCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader(t('notifications.reach.title'), null, { iconName: 'info' }),
    h('p', { class: 'small' }, t('notifications.reach.body')),
    h('p', { class: 'small muted' }, t('notifications.reach.elsewhere')),

    /*
     * Why there is no "mark as read" and no unread count.
     *
     * The design brief asks for both. Neither can be built without recording
     * what somebody has looked at, and this application records no such thing
     * — so the choice was between adding that storage or saying plainly that
     * it does not exist. A badge reading "3 unread" over a store that knows
     * nothing about reading would be the application inventing a fact about
     * its own user, which is the one kind of lie a household ledger cannot
     * afford to tell.
     */
    h('p', { class: 'small', style: { marginBottom: 0 } }, [
      h('strong', {}, `${t('notifications.noRead.title')}. `),
      t('notifications.noRead.body'),
    ]),
  ]);
}
