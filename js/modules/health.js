/**
 * Health.
 *
 * The tabs and the lists are the ordinary generic ones, kept exactly as they
 * were — this screen removes nothing. What is added above them is the one
 * thing four separate record lists cannot show you: where they contradict each
 * other, and where a date they set has gone by.
 *
 * ## Why "open questions" rather than a health summary
 *
 * Everything under this module is something a person wrote down after being
 * told it. None of it is measured here and none of it is checked by anybody,
 * so the only findings this screen draws are ones about the *records* — a
 * course of tablets marked ongoing that ended in March, an appointment last
 * Tuesday nobody marked attended. Each is phrased as a question, because the
 * only person who can settle it is the household, and a screen that said
 * "overdue" about somebody's medicine would be making a claim about their
 * treatment out of a tick box nobody remembered to untick.
 *
 * ## What is not here, on purpose
 *
 * No steps, heart rate, sleep, blood oxygen, body composition, hearing or
 * cycle prediction: there are no sensors and no wearable, and every one of
 * those would be invented. No interaction checking between medicines — that
 * needs a drug database this application does not have, and two medicines
 * listed side by side might otherwise look like something had checked them.
 * No adherence figure, because nothing records a dose being taken. And no
 * score: there is no honest way to turn four kinds of record into a number
 * about somebody's health, and a number is what people remember.
 *
 * `CANNOT_SHOW` puts all of that on the screen rather than leaving it in this
 * comment, where the household would never see it.
 */

import { h, replace } from '../ui/dom.js';
import {
  card, cardHeader, badge, listItem, button, pageHeader, chip,
} from '../ui/components/basics.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { Router } from '../ui/router.js';
import { t, noun } from '../core/locale.js';
import { entitiesOfModule, entity } from '../data/schema.js';
import { entityLabel } from '../core/labels.js';
import { can } from '../security/rbac.js';
import { HealthService } from '../services/health.js';
import { CANNOT_SHOW } from '../domain/health.js';

export async function render(route) {
  const entities = entitiesOfModule('health');
  const chosen = route.entity && entities.some((e) => e.name === route.entity)
    ? route.entity
    : entities[0].name;

  if (route.id && route.id !== 'new') return recordDetail(chosen, route.id);

  const host = h('div', {});
  const { db } = app();
  const service = new HealthService(db);

  const [questions, current] = await Promise.all([service.questions(), service.current()]);

  // `listSection` returns { node, openForm, reload, destroy } — not a node.
  const section = await listSection(chosen, { autoOpenNew: route.id === 'new' });
  const def = entity(chosen);
  const writable = can(db.actor, 'write', chosen);

  replace(host, [
    pageHeader(t('health.title'), {
      subtitle: t('health.subtitle'),
      actions: writable
        ? [button(t('record.add', { one: noun(entityLabel(def)) }), {
          variant: 'primary', iconName: 'plus', onClick: () => section.openForm(),
        })]
        : null,
    }),

    questionsCard(questions),
    currentCard(current),

    entities.length > 1
      ? h('div', { class: 'chip-row chip-row--scroll', role: 'group', 'aria-label': t('health.title') }, entities.map((one) => chip(
        entityLabel(one, 'many'),
        {
          pressed: one.name === chosen,
          onClick: () => app().router.navigate({ module: 'health', entity: one.name }),
        },
      )))
      : null,

    section.node,
    limitsCard(),
  ].filter(Boolean));

  return { node: host, destroy: section.destroy };
}

/**
 * What the records disagree about.
 *
 * The empty state says the records do not contradict themselves. It does not
 * say anybody is well, and the wording is deliberate: this screen has no way
 * of knowing that and a household reading a green badge as reassurance about
 * their health would have been misled by it.
 */
function questionsCard(rows) {
  if (!rows.length) {
    return card({ class: 'card--quiet' }, [
      cardHeader(t('health.questions.title'),
        badge(t('health.questions.none'), 'positive'), { iconName: 'health' }),
      h('p', { class: ['small', 'muted'] }, t('health.questions.noneMeans')),
    ]);
  }

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(
      t('health.questions.title'),
      badge(t('health.questions.count', { n: rows.length }), 'warning'),
      { iconName: 'health' },
    )),

    h('p', { class: ['small', 'muted', 'attention-head'] }, t('health.questions.lead')),

    h('div', { class: 'list' }, rows.map((one) => listItem({
      title: t(`health.q.${one.question}`, {
        subject: one.subject || t('health.q.unnamed'),
      }),
      subtitle: [
        one.personName,
        // Negative days, said as a length of time rather than as a number
        // somebody has to work out the sign of.
        Number.isFinite(one.days) && one.days < 0
          ? t('health.q.since', { days: Math.abs(one.days) })
          : null,
      ].filter(Boolean).join(' · '),
      // A badge as well as the position in the list, because ordering is not
      // something a screen reader announces.
      trailing: badge(t(`health.q.${one.question}.tag`), 'warning'),
      href: Router.href({ module: 'health', entity: one.entity, id: one.id }),
    }))),
  ]);
}

/**
 * What is being taken and what is coming up.
 *
 * Both derived, not read from the stored flag. `ongoing` defaults to true and
 * nothing ever unticks it, so a list built from that field alone shows a
 * course that finished months ago as current medication.
 */
function currentCard({ medications, appointments }) {
  if (!medications.length && !appointments.length) return null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' },
      cardHeader(t('health.current.title'), null, { iconName: 'pill' })),

    medications.length
      ? h('div', { class: 'list' }, medications.slice(0, 8).map((one) => listItem({
        title: one.name,
        subtitle: [one.dosage, one.frequency].filter(Boolean).join(' · '),
        href: Router.href({ module: 'health', entity: 'medication', id: one.id }),
      })))
      : null,

    appointments.length
      ? h('div', { class: 'list' }, appointments.slice(0, 5).map((one) => listItem({
        title: one.title,
        subtitle: [one.date, one.time, one.doctor].filter(Boolean).join(' · '),
        trailing: badge(t('health.current.ahead'), 'accent'),
        href: Router.href({ module: 'health', entity: 'appointment', id: one.id }),
      })))
      : null,

    h('p', { class: ['small', 'faint', 'attention-foot'] }, t('health.current.derived')),
  ].filter(Boolean));
}

/**
 * What a health application shows and this one cannot.
 *
 * On the screen, because somebody who has used one will look for these, and
 * the difference between "not built yet" and "cannot be built from what this
 * holds" is the difference between a missing feature and a promise this
 * application must not make.
 */
function limitsCard() {
  return card({ class: 'card--quiet' }, [
    cardHeader(t('health.absent.title'), null, { iconName: 'info' }),
    h('div', { class: 'stack stack--tight' },
      CANNOT_SHOW.map((key) => h('p', { class: ['small', 'muted'] }, t(key)))),
  ]);
}
