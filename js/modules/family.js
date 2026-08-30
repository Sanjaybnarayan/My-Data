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
import { RecordsService } from '../services/records.js';
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import {
  buildTree, generationLabel, describeRelation, impliedEdges, relationshipConflicts,
} from '../domain/tree.js';
import { upcomingDates } from '../domain/reminders.js';
import { formatDay, ageOn, today, relativeDays } from '../core/dates.js';
import { format as formatMoney } from '../core/money.js';
import { reconcile, disagreements } from '../domain/staffpay.js';

const TABS = [
  { id: 'tree', label: 'Tree' },
  { id: 'relationship', label: 'Relationships' },
  { id: 'importantDate', label: 'Important dates' },
  // Staff are people the household employs, and the record is the role — the
  // person it points at is an ordinary person record, not a second identity.
  { id: 'staff', label: 'Staff' },
  // Absences, not attendance — an empty list means nothing interrupted the
  // arrangement, which is the truthful default.
  { id: 'staffLeave', label: 'Absences' },
];

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) {
    return recordDetail(route.entity, route.id, route.entity === 'staff'
      ? { extra: staffDocuments }
      : {});
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
    h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Family', style: { marginBottom: 'var(--space-4)' } },
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

  // `staff.endedOn` is what makes a record history rather than a deletion, and
  // a list that does not use it shows a cook who left in 2019 beside the one
  // who comes tomorrow. This is the whole of what the field is for.
  const line = active === 'staff' ? await staffStanding() : null;
  replace(body, line ? h('div', {}, [line, section.node]) : section.node);
  return { node: host, destroy: section.destroy };
}



/**
 * The documents belonging to the person this staff record points at.
 *
 * A view over `document.person`, not a new reference. Somebody the household
 * employs has their papers filed against them like anybody else, and the
 * staff record is where a person looks for them.
 */
async function staffDocuments(record) {
  // The record, not its id. `recordDetail` calls `extra(record)` and this took
  // the argument as an id from the day it was written, so `repo('staff').get`
  // was handed a whole object: IndexedDB refused it as "not a valid key", the
  // route threw, and clicking a staff member left you on the screen you were
  // already looking at. Pay, their copy and their documents have never drawn.
  const id = record?.id;
  if (!id) return null;

  const service = new RecordsService(app().db);
  const { documents, person } = await service.documentsForStaff(id);
  if (!person) return null;

  const pay = await service.paymentsForStaff(id);

  const held = await service.whatIsHeldAbout(person.id);

  return h('div', {}, [staffPay(pay), theirCopy(person, held), card({}, [
    cardHeader('Their documents', badge(String(documents.length), 'muted')),
    documents.length
      ? h('div', { class: 'list' }, documents.slice(0, 10).map((document) => listItem({
        title: document.title || document.fileName || 'Untitled',
        subtitle: document.category ?? null,
        href: Router.href({ module: 'documents', entity: 'document', id: document.id }),
      })))
      : h('p', { class: 'small muted' },
        'Nothing filed against them yet. Documents are attached to the person, '
        + 'not to the job, so they follow them between roles.'),
  ])]);
}

/**
 * What this person can be shown about themselves.
 *
 * The other half of asking whether they agreed: somebody who is told what is
 * kept about them is entitled to see it, and before this there was no way to
 * show them without handing over the household's records.
 *
 * ## It is supervised, and says so
 *
 * There is no per-person credential anywhere in this application — the role
 * follows a stored choice of who is using the device, so anybody who can
 * unlock it can be anybody. A role switch would be reversible by whoever it
 * was meant to restrict, and would strand a household who handed their phone
 * over and could not get back.
 *
 * So this is the household opening it in their own session and showing it.
 * The rows are the ones a `staff` role would be permitted, filtered through
 * the same `rowFilter` the role uses, so the screen cannot claim more or less
 * than the rule does.
 */
function theirCopy(person, held) {
  return card({ class: 'card--quiet' }, [
    cardHeader(`What ${person.name || 'they'} can be shown`, null, { iconName: 'shield' }),

    held.held.length
      ? h('div', { class: 'list' }, held.held.map((group) => listItem({
        title: group.label,
        subtitle: `${group.rows.length} ${group.rows.length === 1 ? 'record' : 'records'}`,
      })))
      : h('p', { class: 'small muted' }, 'Nothing is filed against them yet.'),

    // Named rather than omitted. A list of what somebody may see is only half
    // an answer to "what do you hold about me".
    held.notShown.length
      ? h('p', { class: 'small' },
        `Also held about them, and not in this list: ${held.notShown.join(', ')}. `
        + 'Those records name the job rather than the person, so the rule that '
        + 'shows somebody their own records cannot reach them.')
      : null,

    h('p', { class: 'small faint', style: { marginBottom: 0 } },
      'This is you showing them, not them signing in. FamilyOS has no separate '
      + 'password for anybody, so there is no account they could use to see '
      + 'this on their own.'),
  ].filter(Boolean));
}

/**
 * What has actually been paid, beside what was agreed.
 *
 * The agreed figure is never shown *instead of* the payments. A staff record
 * that displayed `monthlyPay` alone would be telling a household what it
 * expected to happen and calling it what happened — the parallel money path
 * `docs/HOUSEHOLD_STAFF.md` forbids.
 */

/**
 * The months deliberately left out of the comparison, and why.
 *
 * Without this a household sees a total that looks short and has no way to
 * learn that two months were skipped on purpose.
 */
function notJudged(check) {
  const skipped = (check.months ?? []).filter((row) => row.status === 'not judged');
  if (!skipped.length) return null;

  return h('p', { class: 'small muted' },
    `${skipped.length} month${skipped.length === 1 ? '' : 's'} not judged: `
    + [...new Set(skipped.map((row) => row.why).filter(Boolean))].join('; ') + '.');
}

function staffPay({ payments, agreed, staff, leave }) {
  const check = reconcile(staff ?? {}, payments, undefined, leave);
  const wrong = disagreements(check);

  return card({ class: 'card--quiet' }, [
    cardHeader('What has been paid', badge(String(payments.length), 'muted')),

    // The comparison, where one can honestly be made. `domain/staffpay.js`
    // refuses part months and the month in progress, and says why when the
    // agreement is not one a monthly figure can be checked against.
    check.comparable === false
      ? h('p', { class: 'small muted' }, `Not compared against what was agreed: ${check.why}.`)
      : wrong.length
        ? h('div', {}, [
          h('p', { class: 'small' }, `${wrong.length} month${wrong.length === 1 ? '' : 's'} `
            + 'do not match what was agreed:'),
          h('ul', { class: 'small' }, wrong.slice(0, 6).map((row) => h('li', {},
            row.status === 'nothing recorded'
              ? `${row.month} — nothing recorded`
              : `${row.month} — ${formatMoney(row.paid)} against ${formatMoney(row.agreed)}`))),
          notJudged(check),
        ])
        : check.months.length
          ? h('p', { class: 'small muted' }, 'Every completed month matches what was agreed.')
          : null,

    payments.length
      ? h('div', { class: 'list' }, payments.slice(0, 6).map((row) => listItem({
        title: formatMoney(Math.abs(row.amount ?? 0)),
        subtitle: formatDay(row.date),
      })))
      : h('p', { class: 'small muted' },
        agreed
          ? `Nothing recorded yet. ${formatMoney(agreed)} a month is what was agreed, `
            + 'which is not the same as what was paid.'
          : 'Nothing recorded yet. Wages show here once a transaction names them.'),
  ]);
}

/**
 * Who works here now, and who used to.
 *
 * The only rule worth stating: **a leaving date in the future is somebody
 * still working here**, on notice. Counting them as former would drop a
 * person off the list while they are still turning up.
 *
 * @param {Array<{endedOn?: string}>} rows
 * @param {string} [today] injectable, so the boundary can be tested
 */
export function standing(rows, today = new Date().toISOString().slice(0, 10)) {
  const left = rows.filter((row) => row.endedOn && row.endedOn <= today);
  return {
    current: rows.length - left.length,
    former: left.length,
    onNotice: rows.some((row) => row.endedOn && row.endedOn > today),
  };
}

/** How many people work here now, and how many used to. */
async function staffStanding() {
  const rows = await new RecordsService(app().db).staff();
  if (!rows.length) return null;

  const { current, former, onNotice } = standing(rows);

  return card({ class: 'card--quiet' }, h('div', { class: 'row' }, [
    icon('users', { size: 18 }),
    h('span', { class: 'small' },
      `${current} working here now`
      + (former ? `, ${former} who used to` : '')
      + (onNotice ? ' — including somebody on notice' : '')),
  ]));
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

    // The `relationship` field on each person record is an edge too, and the
    // tree now reads it. `describeRelation` has to see the same set, or a
    // person the tree just placed would sit in the right generation with no
    // label under their name.
    const known = [...relationships, ...impliedEdges(people).edges];
    const conflicts = relationshipConflicts(people, relationships);

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
            relation: person.id === me ? 'you' : describeRelation(me, person.id, known),
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

      // What stopped the person form being read at all. Silence here would
      // leave a household staring at a flat tree with no idea why, when the
      // fix is usually one field on one record.
      tree.why
        ? card({ class: 'card--quiet relationship-note' }, [
          cardHeader('Some relationships could not be placed', null, { iconName: 'info' }),
          h('p', { class: 'small muted' }, tree.why),
        ])
        : null,

      // Two ways to record one fact means two ways to record it differently.
      // Neither side is picked: a tree that quietly chose one would be wrong
      // in a way nobody could see.
      conflicts.length
        ? card({ class: 'card--quiet relationship-conflicts' }, [
          cardHeader('Recorded two different ways',
            badge(String(conflicts.length), 'warning'), { iconName: 'info' }),
          h('p', { class: 'small muted' },
            'These people have one relationship on their own record and a different '
            + 'one under Relationships. Nothing here picks between them — open the '
            + 'record and correct whichever is wrong.'),
          h('div', { class: 'list' }, conflicts.map(({ person, said, recorded }) => listItem({
            leading: avatar(person.name),
            title: person.name,
            subtitle: `Their record says “${said}”, but a relationship says ${recorded}.`,
            href: Router.href({ module: 'identity', entity: 'person', id: person.id }),
          }))),
        ])
        : null,

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
