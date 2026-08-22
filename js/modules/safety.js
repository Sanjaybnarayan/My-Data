/**
 * Safety.
 *
 * Where the household was, the zones those readings are measured against, and
 * a way to raise an alarm.
 *
 * Every sentence on this screen goes through the catalogue. That is not a
 * flourish: this is the first module written after the locale layer landed,
 * and a phase that added three hundred lines of untranslatable English would
 * have made `tools/strings.mjs` count upward on its first week.
 *
 * The screen shows an age beside every position and never a position alone.
 * A location with no timestamp reads as *now*, and here it frequently is not —
 * there is no background capture, so a reading exists only because somebody
 * opened the application while it was being taken.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, pageHeader, listItem, empty } from '../ui/components/basics.js';
import { button } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { SafetyService } from '../services/safety.js';
import { FRESHNESS } from '../domain/safety.js';
import { t } from '../core/locale.js';

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const safety = new SafetyService(db);

  async function paint() {
    const [everyone, crossings] = await Promise.all([
      safety.whereEveryone(),
      safety.crossings({ limit: 20 }),
    ]);

    replace(host, [
      pageHeader(t('safety.title'), { subtitle: t('safety.subtitle') }),
      limitsCard(),
      whereCard(everyone, safety, paint),
      crossingsCard(crossings),
      await listSection('safeZone', route),
    ]);
  }

  await paint();
  return { node: host };
}

/**
 * What this cannot do, said before what it can.
 *
 * A safety screen that lists zones and a map invites a household to believe
 * the phone is watching. It is not, and finding that out on the day it
 * mattered would be the worst possible time.
 */
function limitsCard() {
  return card({}, [
    cardHeader(t('safety.limits.title'), null, { iconName: 'info' }),
    h('p', { class: 'small' }, t('safety.limits.background')),
    h('p', { class: 'small muted', style: { marginBottom: 0 } }, t('safety.limits.geofence')),
  ]);
}

function whereCard(rows, safety, repaint) {
  const withPosition = rows.filter((r) => r.known);

  return card({}, [
    cardHeader(t('safety.where.title'),
      badge(t('safety.where.count', { n: withPosition.length, total: rows.length }),
        withPosition.length ? 'positive' : 'muted'),
      { iconName: 'globe' }),

    rows.length
      ? h('div', { class: 'list' }, rows.map((row) => listItem({
        title: row.person.name ?? '',
        subtitle: row.line,
        trailing: row.known ? freshnessBadge(row.known) : null,
      })))
      : empty({ title: t('safety.where.nobody'), iconName: 'user' }),

    h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-4)' } }, [
      button(t('safety.where.readMine'), {
        iconName: 'globe',
        onClick: async () => {
          const me = app().db.actor?.personId;
          if (!me) {
            toast(t('safety.where.noPerson'), { kind: 'error' });
            return;
          }
          const result = await safety.record(me);
          // The refusal is shown as the reason it was, not as a generic
          // failure: "you said no" and "the device could not get a fix" want
          // different answers from the person reading them.
          toast(result.ok ? t('safety.where.recorded') : result.message,
            { kind: result.ok ? 'success' : 'error' });
          if (result.ok) await repaint();
        },
      }),
    ]),
  ]);
}

function freshnessBadge(known) {
  if (known.state === FRESHNESS.FRESH) return badge(t('safety.fresh'), 'positive');
  if (known.state === FRESHNESS.AGEING) return badge(t('safety.ageing'), 'muted');
  return badge(t('safety.stale'), 'warning');
}

function crossingsCard(crossings) {
  if (!crossings.length) return null;

  return card({}, [
    cardHeader(t('safety.crossings.title'), null, { iconName: 'shield' }),
    h('div', { class: 'list' }, crossings.map((crossing) => listItem({
      title: t(crossing.kind === 'arrived' ? 'safety.crossings.arrived' : 'safety.crossings.left',
        { zone: crossing.zone.name }),
      subtitle: crossing.certain
        ? crossing.at
        // The honest half. With hours between two readings, nobody can say
        // when the crossing happened, and a time printed without that caveat
        // is an observation nobody made.
        : t('safety.crossings.unsure', { at: crossing.at, hours: Math.round(crossing.gapMinutes / 60) }),
      trailing: crossing.certain ? null : badge(t('safety.crossings.approx'), 'muted'),
    }))),
  ]);
}
