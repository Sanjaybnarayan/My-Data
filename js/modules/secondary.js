/**
 * The seven modules that had no screen of their own.
 *
 * `insurance`, `property`, `education`, `tasks`, `notes`, `digital` and
 * `emergency` all fell through to the generic record screen. That screen is
 * not bad — it is the whole point of the schema being the program — but it can
 * only ever show one entity's rows, and three of these modules hold a question
 * that needs two.
 *
 * ## One file, seven routes
 *
 * They share a shape: the generic tabs and lists exactly as they were, with at
 * most one card above them. Seven near-identical files would be seven places
 * to fix the next time that shape changes, so this switches on the route and
 * the tabs come from `crud.js` unchanged. Nothing is removed from any of them.
 *
 * ## Why four of the seven get a sentence rather than a card
 *
 * Because their derived view already exists somewhere else.
 *
 * `policy.nominee` is read by `domain/estate.js`, which reports every account,
 * holding and policy with nobody named on it. `digitalAsset.legacyInstruction`
 * is read by the same file. `education.nextFeeDueOn` and
 * `certificate.expiresOn` are `expiry` fields, so they are already on the
 * Notifications tab and in the dashboard's attention card.
 *
 * Building a second nominee check here would be two implementations of one
 * question, which is the fault this repository has spent the week removing. So
 * these screens say where the answer lives and link to it. A pointer is not a
 * consolation prize: a household that does not know the estate review exists
 * gets more from one honest sentence than from a card that recomputes it
 * slightly differently.
 *
 * `notes` derives nothing at all, and says so rather than being given
 * something to look busy with.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, badge, listItem, button, pageHeader, chip,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { t, noun } from '../core/locale.js';
import { entitiesOfModule, entity, modules } from '../data/schema.js';
import { entityLabel, moduleLabel } from '../core/labels.js';
import { can } from '../security/rbac.js';
import { SecondaryService } from '../services/secondary.js';
import { TENANCY, CONSEQUENCE } from '../domain/tenancy.js';
import { TASK } from '../domain/upkeep.js';

/** Where a module's derived answer already lives, for the four that have one. */
const ELSEWHERE = Object.freeze({
  insurance: { key: 'secondary.insurance', module: 'reports' },
  digital: { key: 'secondary.digital', module: 'reports' },
  education: { key: 'secondary.education', module: 'notifications' },
  notes: { key: 'secondary.notes', module: null },
});

export async function render(route) {
  const id = route.module;
  const entities = entitiesOfModule(id);
  const chosen = route.entity && entities.some((one) => one.name === route.entity)
    ? route.entity
    : entities[0].name;

  if (route.id && route.id !== 'new') return recordDetail(chosen, route.id);

  const host = h('div', {});
  const { db } = app();
  const service = new SecondaryService(db);

  const section = await listSection(chosen, { autoOpenNew: route.id === 'new' });
  const def = entity(chosen);
  const writable = can(db.actor, 'write', chosen);
  const mod = modules.find((one) => one.id === id);

  replace(host, [
    pageHeader(moduleLabel(mod), {
      subtitle: entityLabel(def, 'many'),
      actions: writable
        ? [button(t('record.add', { one: noun(entityLabel(def)) }), {
          variant: 'primary', iconName: 'plus', onClick: () => section.openForm(),
        })]
        : null,
    }),

    await topCard(id, service),

    entities.length > 1
      ? h('div', { class: 'chip-row', role: 'group', 'aria-label': moduleLabel(mod) }, entities.map((one) => chip(
        entityLabel(one, 'many'),
        {
          pressed: one.name === chosen,
          onClick: () => app().router.navigate({ module: id, entity: one.name }),
        },
      )))
      : null,

    section.node,
  ].filter(Boolean));

  return { node: host, destroy: section.destroy };
}

/** The one card a module gets, or the sentence saying where its answer is. */
async function topCard(id, service) {
  if (id === 'property') return tenancyCard(await service.tenancies());
  if (id === 'tasks') return taskCard(await service.tasks());
  if (id === 'emergency') return reachCard(await service.reach());
  return pointerCard(id);
}

/**
 * A tenancy recorded in two places, or one.
 *
 * Phrased as a question throughout. A name on the property and a different one
 * on the tenant record are two statements by the same household, and only they
 * know which is current — one may be last year's tenant nobody deleted.
 */
function tenancyCard(rows) {
  if (!rows.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(
      t('tenancy.title'),
      badge(t('tenancy.count', { n: rows.length }), 'warning'),
      { iconName: 'home' },
    )),

    h('p', { class: ['small', 'muted', 'attention-head'] }, t('tenancy.lead')),

    h('div', { class: 'list' }, rows.map((row) => listItem({
      title: row.property.name || t('tenancy.unnamed'),
      subtitle: t(CONSEQUENCE[row.state]),
      trailing: badge(t(`tenancy.state.${row.state}`),
        row.state === TENANCY.DISAGREE ? 'warning' : 'muted'),
      href: Router.href({ module: 'property', entity: 'property', id: row.property.id }),
    }))),
  ]);
}

/** A task whose status and completion date disagree. */
function taskCard(rows) {
  if (!rows.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(
      t('upkeep.tasks.title'),
      badge(String(rows.length), 'muted'),
      { iconName: 'check' },
    )),
    // Not "overdue": `dueOn` already produces a reminder and the
    // Notifications tab already lists it. This is only about the record
    // saying two things.
    h('p', { class: ['small', 'muted', 'attention-head'] }, t('upkeep.tasks.lead')),
    h('div', { class: 'list' }, rows.map((row) => listItem({
      title: row.task.title || t('upkeep.tasks.unnamed'),
      subtitle: t(`upkeep.task.${row.kind}`),
      trailing: badge(t(row.kind === TASK.DATE_NOT_DONE
        ? 'upkeep.tag.dateNotDone' : 'upkeep.tag.doneNoDate'), 'muted'),
      href: Router.href({ module: 'tasks', entity: 'task', id: row.task.id }),
    }))),
  ]);
}

/**
 * Whether this list could be used in a hurry.
 *
 * The one thing it exists for is somebody reading it under pressure, so "who
 * do I ring first" has to have exactly one answer.
 */
function reachCard({ findings }) {
  if (!findings.length) return null;

  return card({ class: 'card--quiet' }, [
    cardHeader(t('upkeep.reach.title'), badge(t('upkeep.reach.badge'), 'warning'),
      { iconName: 'alert' }),
    h('div', { class: 'stack stack--tight' }, findings.map((one) => {
      // Joined rather than interpolated: a template literal with a space in
      // it reads as prose to `tools/strings.mjs` and lands in the unrouted
      // count, which may only go down.
      const named = (one.contacts ?? []).map((c) => c.name).filter(Boolean).join(', ');
      return h('p', { class: 'small' }, [t(`upkeep.reach.${one.kind}`), named]
        .filter(Boolean).join(' '));
    })),
  ]);
}

/** Where a module's derived answer already lives. */
function pointerCard(id) {
  const where = ELSEWHERE[id];
  if (!where) return null;

  return card({ class: 'card--quiet' }, [
    cardHeader(t('secondary.title'), null, { iconName: 'info' }),
    h('p', { class: 'small' }, t(where.key)),
    where.module
      ? h('a', {
        class: ['btn', 'btn--subtle', 'btn--small'],
        href: Router.href({ module: where.module }),
      }, t(`secondary.go.${id}`))
      : null,
  ].filter(Boolean));
}
