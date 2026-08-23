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
import { card, cardHeader, badge, listItem, empty, pageHeader } from '../ui/components/basics.js';
import { Router } from '../ui/router.js';
import { app } from '../context.js';
import { AttentionService } from '../services/attention.js';
import { formatDay } from '../core/dates.js';
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

export async function render() {
  const host = h('div', {});
  const { db } = app();

  const attention = await new AttentionService(db).everything({ horizonDays: 45 });

  replace(host, [
    pageHeader(t('notifications.title'), { subtitle: t('notifications.subtitle') }),

    attention.items.length
      ? h('div', {}, GROUPS.map((group) => section(group, attention)))
      : card({}, empty({
        title: t('notifications.empty.title'),
        message: t('notifications.empty.message'),
        iconName: 'check',
      })),

    reachCard(),
  ]);

  return { node: host };
}

function section(group, attention) {
  const rows = attention.items.filter((one) => one.severity === group.id);
  if (!rows.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'notifications-head' },
      cardHeader(t(`notifications.group.${group.id}`), badge(String(rows.length), group.tone))),

    group.blurb
      ? h('p', { class: 'small muted notifications-blurb' }, t(group.blurb))
      : null,

    h('div', { class: 'list' }, rows.map((one) => listItem({
      title: one.line,
      // Where it came from and when, so the item can be judged without opening
      // it — which is the whole point of a list like this.
      subtitle: `${one.label ?? t('notifications.dateFallback')} · ${formatDay(one.date)}`,
      href: one.module && one.entity && one.recordId
        ? Router.href({ module: one.module, entity: one.entity, id: one.recordId })
        : undefined,
    }))),
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
    h('p', { class: 'small muted', style: { marginBottom: 0 } },
      t('notifications.reach.elsewhere')),
  ]);
}
