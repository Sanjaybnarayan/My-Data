/**
 * The pieces the dashboard's cards share.
 *
 * Moved out of `js/modules/dashboard.js` when that file crossed the 800-line
 * mark `tools/module-size.mjs` holds it to — the ratchet's own instruction is
 * to move code out rather than raise the number, and a footer is not the part
 * of a widget worth reading next to the figures it draws.
 */

import { h } from '../ui/dom.js';
import { money } from '../ui/components/basics.js';
import { Router } from '../ui/router.js';
import { t } from '../core/locale.js';

/**
 * How many rows a dashboard list draws.
 *
 * Three, which is what the attention card had already settled on: *"this card
 * exists to say whether something needs doing; the tab is where the list
 * lives."* The same sentence is true of every list on this screen, and the
 * rest were drawing five, six and eight of them — the dashboard was 5,680px,
 * six and a half screens on a 390px phone, with eleven of its thirteen cards
 * below the fold.
 */
export const ROWS = 3;

/** A subscription lives in Digital; every other bill in Finance. */
const DIGITAL = new Set(['subscription', 'digitalAsset']);

export function billHref(bill) {
  return Router.href({
    module: DIGITAL.has(bill.entity) ? 'digital' : 'finance',
    entity: bill.entity,
    id: bill.recordId,
  });
}

/**
 * The total under a bill list, saying so when a bill was left out of it.
 *
 * A card with no statement day has a date and no amount. Adding it in as zero
 * would print a total that is quietly short with nothing on screen to explain
 * why, which is worse than the missing figure itself.
 */
export function billsFooter({ total, unknown }) {
  return h('div', { class: 'card-footer', style: { padding: 'var(--space-3) var(--space-5)' } }, [
    h('span', { class: 'small muted' }, unknown
      ? `Total due · ${unknown} without an amount`
      : 'Total due'),
    h('span', { class: 'spacer' }),
    money(total),
  ]);
}

/**
 * The value-at-stake footer under the nominations list.
 *
 * Here rather than in `dashboard.js` because it writes `.card-footer`, and
 * `billsFooter` above writes it too — `tools/class-names.mjs` counts a class
 * name written by more than one file, and two files styling one name is how
 * the two collisions earlier in this repository's history began.
 */
export function stakeFooter(valueUnknown, atStake) {
  return h('div', { class: 'card-footer', style: { padding: 'var(--space-3) var(--space-5)' } }, [
    h('span', { class: 'small muted' }, valueUnknown
      ? `Known value at stake · ${valueUnknown} without one recorded`
      : 'Value at stake'),
    h('span', { class: 'spacer' }),
    money(atStake),
  ]);
}

/**
 * The footer under a shortened list: how many there really are, and the way to
 * them.
 *
 * Both halves were missing, in different places. `bills`, `reminders` and
 * `nominations` had **no link at all** — the rows past the cut were
 * unreachable from here, which the activity card's own comment had already
 * named as a fault in itself: *"the rest were dropped on the floor, so the
 * link is not decoration — it is the only way to reach a history the
 * application already had."*
 *
 * And `total` is the count of the whole list, never `rows.length`. That is not
 * a nicety: `documents` badged the sliced array, so a household with nine
 * papers running out was shown a warning badge reading **5**. Measured on the
 * example household, where the true figure is 9 and the attention card
 * directly above it — which counts the real total — says 9.
 */
export function moreFooter(total, href) {
  return h('div', { class: 'attention-foot' }, [
    h('a', { class: 'btn btn--subtle btn--small', href },
      total > ROWS ? t('list.seeAll', { n: total }) : t('dash.seeAllOpen')),
  ]);
}
