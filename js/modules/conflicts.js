/**
 * One screen for every place the household's records disagree about money.
 *
 * Before this, a household with a wrong figure had to already know which
 * screen the application had chosen to mention it on: an amount two sources
 * disagreed about appeared above the *Messages* tab, a payment two
 * notifications corroborated with no ledger row appeared on the same card,
 * and a month of wages paid short appeared on one staff member's record. The
 * fourth kind — two sources naming days a week apart — appeared nowhere,
 * because nothing looked.
 *
 * The screen deliberately does nothing but show them. There is no button
 * here that picks a figure, because `domain/conflict.js` has no field to put
 * the answer in and should not grow one: which figure is right is a question
 * about the world, and answering it means correcting the record that is
 * wrong, on the screen that record lives on.
 *
 * ## No table of headings here
 *
 * The first version of this file kept two objects keyed by conflict kind — a
 * heading and a reason — which is the hand-maintained list beside a derivable
 * one that this repository has now found nine times. The copy lives in the
 * catalogue under `conflict.heading.<kind>` and `conflict.why.<kind>`, the
 * key is built from the kind, and `tests/locale.test.mjs` already asserts
 * every key the application asks for exists. A kind added to the domain with
 * no copy written for it fails there rather than rendering an untitled card.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, listItem, empty, skeletonList } from '../ui/components/basics.js';
import { app } from '../context.js';
import { format } from '../core/money.js';
import { t } from '../core/locale.js';
import { ConflictService } from '../services/conflict.js';
import { describeConflict, CONFLICT_KINDS } from '../domain/conflict.js';

export async function render() {
  const host = h('div', {});
  replace(host, skeletonList(3));

  const review = await new ConflictService(app().db).review();

  if (!review.total) {
    replace(host, empty({
      title: t('conflict.none.title'),
      message: t('conflict.none.body'),
      iconName: 'info',
    }));
    return { node: host };
  }

  const groups = [];
  for (const kind of CONFLICT_KINDS) {
    const rows = review.found.filter((conflict) => conflict.kind === kind);
    if (!rows.length) continue;

    groups.push(card({ class: `conflict-group conflict-${kind}` }, [
      cardHeader(t(`conflict.heading.${kind}`), badge(String(rows.length), 'warning'),
        { iconName: 'alert' }),
      h('p', { class: 'small muted' }, t(`conflict.why.${kind}`)),
      h('div', { class: 'list' }, rows.slice(0, SHOWN).map((conflict) => listItem({
        title: t(conflict.entity === 'staff' ? 'conflict.row.staff' : 'conflict.row.payment'),
        subtitle: describeConflict(conflict, format),
        onClick: () => app().router.navigate({
          module: conflict.entity === 'staff' ? 'family' : 'finance',
          entity: conflict.entity,
          id: conflict.id,
        }),
      }))),
      rows.length > SHOWN
        ? h('p', { class: 'small faint' }, t('conflict.more', { n: rows.length - SHOWN }))
        : null,
    ].filter(Boolean)));
  }

  groups.push(card({ class: 'card--quiet conflict-nothing-decided' }, [
    h('p', { class: 'small muted', style: { margin: 0 } }, t('conflict.nothingDecided')),
  ]));

  replace(host, groups);
  return { node: host };
}

/** How many of one kind are listed before the rest are counted instead. */
const SHOWN = 20;
