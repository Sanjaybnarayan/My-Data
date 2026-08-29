/**
 * Safety.
 *
 * Where the household was, and the zones those readings are measured against.
 *
 * **There is no SOS here, and this comment used to say there was.**
 * `SafetyService.raise` and `domain/safety.js#sosMessage` compose an alert and
 * record it, they are tested, and nothing on any screen calls them — measured,
 * zero callers. A household cannot raise an alarm from this application. The
 * architecture document carries the row as `unwired:`, so wiring it up will
 * fail the build until somebody comes back and says so.
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
import {
  status as trailStatus, start as trailStart, stop as trailStop,
  openSettings as trailSettings, requestForeground,
} from '../core/backgroundlocation.js';

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const safety = new SafetyService(db);

  // Built once, outside `paint`. Two bugs met here: the object was being put
  // into the children array instead of its `node`, so the screen rendered the
  // literal text `[object Object]`; and building it inside `paint` would add a
  // fresh bus subscription and a fresh table on every repaint.
  const section = await listSection('safeZone', { autoOpenNew: route.id === 'new' });

  async function paint() {
    const [everyone, crossings] = await Promise.all([
      safety.whereEveryone(),
      safety.crossings({ limit: 20 }),
    ]);

    replace(host, [
      pageHeader(t('safety.title'), { subtitle: t('safety.subtitle') }),
      limitsCard(),
      trailCard(await trailStatus(), paint),
      whereCard(everyone, safety, paint),
      crossingsCard(crossings),
      section.node,
    ]);
  }

  await paint();
  return { node: host, destroy: section.destroy };
}

/**
 * Recording where this phone is while nobody is looking.
 *
 * Drawn immediately under the card that says what the application will not
 * do, because this is the thing that card used to promise. A person reading
 * downwards meets the limit and the exception to it in that order.
 *
 * The switch shows what is actually granted rather than what was asked for.
 * Android 11+ will not hand over background location from a prompt at all, so
 * when that is what is missing this offers the settings page and says why —
 * a button labelled "Allow" that silently cannot is worse than no button.
 */
function trailCard(state, repaint) {
  if (!state.supported) return null;

  const controls = [];
  if (state.running) {
    controls.push(button(t('safety.trail.stop'), {
      variant: 'subtle',
      onClick: async () => { await trailStop(); await repaint(); },
    }));
  } else if (state.canRun) {
    controls.push(button(t('safety.trail.start'), {
      variant: 'primary',
      onClick: async () => {
        const out = await trailStart();
        if (!out.ok) toast(out.why);
        await repaint();
      },
    }));
  } else if (!state.foreground) {
    controls.push(button(t('safety.where.readMine'), {
      variant: 'primary',
      onClick: async () => { await requestForeground(); await repaint(); },
    }));
  } else {
    // The background grant, or notifications. Neither can be obtained from a
    // prompt this application is allowed to raise.
    controls.push(button(t('safety.trail.settings'), {
      variant: 'primary',
      onClick: async () => { await trailSettings(); },
    }));
  }

  return card({ class: 'trail-card' }, [
    cardHeader(t('safety.trail.title'),
      badge(state.running ? 'on' : 'off', state.running ? 'warning' : 'muted'),
      { iconName: 'alert' }),
    h('p', { class: 'small' },
      state.running ? t('safety.trail.on') : t('safety.trail.off')),
    state.blocked ? h('p', { class: 'small muted' }, state.blocked) : null,
    state.pending
      ? h('p', { class: 'small muted' }, t('safety.trail.pending', { n: state.pending }))
      : null,
    h('div', { class: 'row' }, controls),
    // Said on the screen, not only in a document. Somebody deciding whether
    // to switch this on should know it has never run on a phone.
    state.running
      ? h('p', { class: 'small muted' }, t('safety.trail.warning'))
      : null,
    h('p', { class: 'small faint', style: { marginBottom: 0 } },
      t('safety.trail.untested')),
  ].filter(Boolean));
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
