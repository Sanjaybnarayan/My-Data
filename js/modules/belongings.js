/**
 * Belongings.
 *
 * A sentence about cover above the list, because the useful fact here is not
 * any one purchase — it is how much of what the household owns has a promise
 * attached, and how much of the gap is real rather than untyped.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, pageHeader, listItem } from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { entitiesOfModule } from '../data/schema.js';
import { BelongingsService } from '../services/belongings.js';

const TABS = ['purchase', 'warranty'];

export async function render(route) {
  const active = route.entity && TABS.includes(route.entity) ? route.entity : 'purchase';
  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const state = await new BelongingsService(db).cover();

  // `listSection` returns { node, openForm, reload, destroy } — not a node.
  // Putting the object itself into a children array made `append` stringify it,
  // and this screen rendered the literal text `[object Object]` where its
  // record list should be. `destroy` unsubscribes the list from the data bus;
  // returning it is what stops a listener outliving the screen.
  const section = await listSection(active, { autoOpenNew: route.id === 'new' });

  replace(host, [
    pageHeader('Belongings', { subtitle: 'What the household owns, and what still has cover' }),
    coverCard(state),
    h('div', { class: 'tabs' }, entitiesOfModule('belongings').map((def) => h('a', {
      class: ['tab', def.name === active && 'tab--active'],
      href: Router.href({ module: 'belongings', entity: def.name }),
      // `aria-current="page"` carries the active state for assistive technology.
      // The CSS class conveys it visually; screen readers cannot see CSS.
      'aria-current': def.name === active ? 'page' : null,
    }, def.labels.many))),
    section.node,
  ]);
  return { node: host, destroy: section.destroy };
}

function coverCard(state) {
  const expiring = state.rows.filter((r) => r.state === 'covered').slice(0, 5);

  return card({}, [
    cardHeader('Cover',
      state.gaps.items.length ? badge(`${state.gaps.items.length} with none`, 'warning') : null,
      { iconName: 'shield' }),
    h('p', { class: 'small muted' }, state.line),
    expiring.length
      ? h('div', { class: 'list' }, expiring.map((row) => listItem({
        title: row.warranty.cover,
        subtitle: `${row.purchase ? `${row.purchase.item} · ` : ''}until ${row.warranty.expiresOn}`,
        href: Router.href({ module: 'belongings', entity: 'warranty', id: row.warranty.id }),
      })))
      : null,
  ]);
}
