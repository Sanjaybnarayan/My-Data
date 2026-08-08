/**
 * Family.
 *
 * A tree, then the records behind it. The tree is generations in rows with
 * the connections drawn between them — not a decorative graphic, but the
 * fastest way to see that somebody is missing, or attached to the wrong
 * branch.
 *
 * The layout arithmetic is in `domain/tree.js` and tested there. This file
 * only draws.
 */

import { h, replace } from '../ui/dom.js';
import { icon } from '../ui/icons.js';
import {
  card, cardHeader, button, badge, pageHeader, empty, avatar, chip, listItem,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { buildTree, generationLabel, describeRelation } from '../domain/tree.js';
import { upcomingDates } from '../domain/reminders.js';
import { formatDay, ageOn, today, relativeDays } from '../core/dates.js';

const TABS = [
  { id: 'tree', label: 'Tree' },
  { id: 'relationship', label: 'Relationships' },
  { id: 'importantDate', label: 'Important dates' },
];

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id);
  }

  const active = route.entity ?? 'tree';
  const body = h('div', {});
  let section = null;

  const host = h('div', {}, [
    pageHeader('Family', {
      subtitle: 'Who is who, and what is coming up',
      actions: active === 'tree'
        ? [button('Add a person', {
          variant: 'primary',
          iconName: 'plus',
          onClick: () => app().router.navigate({ module: 'identity', entity: 'person', id: 'new' }),
        })]
        : [button('Add', {
          variant: 'primary', iconName: 'plus', onClick: () => section?.openForm(),
        })],
    }),
    h('div', { class: 'chip-row', role: 'tablist', style: { marginBottom: 'var(--space-4)' } },
      TABS.map((tab) => chip(tab.label, {
        pressed: tab.id === active,
        onClick: () => app().router.navigate(tab.id === 'tree'
          ? { module: 'family' }
          : { module: 'family', entity: tab.id }),
      }))),
    body,
  ]);

  if (active === 'tree') {
    const view = await treeView();
    replace(body, view.node);
    return { node: host, destroy: view.destroy };
  }

  section = await listSection(active, { autoOpenNew: route.id === 'new' });
  replace(body, section.node);
  return { node: host, destroy: section.destroy };
}

/* ------------------------------------------------------------------ tree */

async function treeView() {
  const { db } = app();
  const host = h('div', {});

  async function paint() {
    const [people, relationships, importantDates] = await Promise.all([
      db.repo('person').list({ decrypt: false, limit: 500 }),
      db.repo('relationship').list({ decrypt: false, limit: 2000 }),
      db.repo('importantDate').list({ decrypt: false, limit: 500 }),
    ]);

    if (!people.length) {
      replace(host, empty({
        title: 'No people yet',
        message: 'Add yourself first, then the rest of the family. Relationships '
          + 'between them build the tree.',
        iconName: 'family',
        action: button('Add the first person', {
          variant: 'primary',
          onClick: () => app().router.navigate({ module: 'identity', entity: 'person', id: 'new' }),
        }),
      }));
      return;
    }

    const me = db.actor.personId;
    const tree = buildTree(people, relationships, { rootId: me });
    const dates = upcomingDates(people, importantDates, { days: 90 });

    replace(host, [
      card({ class: 'card--flush' }, [
        h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
          cardHeader('Family tree',
            badge(`${people.length} ${people.length === 1 ? 'person' : 'people'}`
              + ` · ${tree.edges.length} ${tree.edges.length === 1 ? 'link' : 'links'}`),
            { iconName: 'tree' })),

        h('div', {
          style: { padding: 'var(--space-4) var(--space-5)', overflowX: 'auto' },
        }, tree.generations.map((generation) => h('div', {
          style: { marginBottom: 'var(--space-5)' },
        }, [
          h('div', {
            class: 'small faint',
            style: { marginBottom: 'var(--space-2)', textTransform: 'uppercase', letterSpacing: '0.05em' },
          }, generationLabel(generation.level)),

          h('div', {
            class: 'row',
            style: { gap: 'var(--space-3)', flexWrap: 'wrap', alignItems: 'stretch' },
          }, generation.people.map((person) => personCard(person, {
            isMe: person.id === me,
            relation: person.id === me ? 'you' : describeRelation(me, person.id, relationships),
          }))),

          // A line under each generation but the last, so the rows read as a
          // sequence rather than as unrelated groups.
          generation.level === tree.generations.at(-1).level
            ? null
            : h('div', {
              style: {
                height: '1px',
                background: 'var(--border)',
                margin: 'var(--space-4) 0 0',
              },
            }),
        ]))),
      ]),

      tree.unplaced.length
        ? card({ class: 'card--quiet' }, [
          cardHeader('Not connected to anyone', badge(String(tree.unplaced.length), 'warning')),
          h('p', { class: 'small muted' },
            'These people are in the family but have no relationship recorded, so '
            + 'the tree cannot place them. Add a relationship to put them where they belong.'),
          h('div', { class: 'chip-row' }, tree.unplaced.map((person) => h('a', {
            class: 'chip',
            href: Router.href({ module: 'identity', entity: 'person', id: person.id }),
          }, person.name))),
        ])
        : null,

      dates.length
        ? card({ class: 'card--flush' }, [
          h('div', { style: { padding: 'var(--space-5) var(--space-5) 0' } },
            cardHeader('The next three months', null, { iconName: 'cake' })),
          h('div', { class: 'list' }, dates.map((date) => listItem({
            leading: avatar(date.title),
            title: date.title,
            subtitle: `${formatDay(date.date)} · ${relativeDays(date.date)}`,
            trailing: date.turning ? badge(`turns ${date.turning}`) : null,
          }))),
        ])
        : null,
    ]);
  }

  function personCard(person, { isMe, relation }) {
    const age = person.birthday
      ? ageOn(person.birthday, person.deceasedOn || today())
      : null;

    return h('a', {
      class: 'card card--interactive',
      href: Router.href({ module: 'identity', entity: 'person', id: person.id }),
      style: {
        padding: 'var(--space-3) var(--space-4)',
        minWidth: '170px',
        textDecoration: 'none',
        color: 'inherit',
        borderColor: isMe ? 'var(--accent)' : null,
      },
    }, [
      h('div', { class: 'row', style: { gap: 'var(--space-3)' } }, [
        avatar(person.name, { photo: person.photo }),
        h('div', { style: { minWidth: 0 } }, [
          h('div', { class: 'list-item-title truncate' }, person.name),
          h('div', { class: 'small muted truncate' }, [
            relation || person.relationship || '',
            age !== null ? ` · ${age}` : '',
            person.deceasedOn ? ' · deceased' : '',
          ].join('')),
        ]),
      ]),
      person.bloodGroup || person.isDependent
        ? h('div', { class: 'chip-row', style: { marginTop: 'var(--space-2)' } }, [
          person.bloodGroup ? badge(person.bloodGroup) : null,
          person.isDependent ? badge('dependent', 'accent') : null,
        ])
        : null,
    ]);
  }

  await paint();
  const off = bus.on(TOPIC.dataChanged, (payload) => {
    if (payload.entity === 'person' || payload.entity === 'relationship'
      || payload.entity === 'importantDate') paint();
  });
  return { node: host, destroy: off };
}

export { icon };
