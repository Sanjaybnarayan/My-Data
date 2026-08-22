/**
 * Family chat.
 *
 * The screen's job is mostly to be honest about what the encryption does and
 * does not cover, because a padlock and the word "encrypted" are the easiest
 * false claim in this application to make.
 *
 * Two sentences sit above the conversations and neither is optional: the
 * recovery phrase opens every conversation, and this has not been reviewed by
 * a cryptographer. A household deciding what to say in here is entitled to
 * both before they say it, not in a document they will never open.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, badge, pageHeader, listItem, empty, button } from '../ui/components/basics.js';
import { toast } from '../ui/components/toast.js';
import { listSection, recordDetail } from './crud.js';
import { app } from '../context.js';
import { ChatService } from '../services/chat.js';
import { userMessage } from '../core/errors.js';
import { t } from '../core/locale.js';

export async function render(route) {
  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const chat = new ChatService(db);

  async function paint() {
    const [identity, devices] = await Promise.all([
      chat.identity(),
      chat.devices(),
    ]);

    replace(host, [
      pageHeader(t('chat.title'), { subtitle: t('chat.subtitle') }),
      honestyCard(),
      deviceCard(identity, devices, chat, paint),
      await listSection('conversation', route),
    ]);
  }

  await paint();
  return { node: host };
}

/**
 * What the encryption covers, and the two things it does not.
 *
 * Above the conversations rather than below them, because somebody deciding
 * whether to type something sensitive decides before they scroll.
 */
function honestyCard() {
  return card({}, [
    cardHeader(t('chat.honesty.title'), badge(t('chat.honesty.badge'), 'muted'), { iconName: 'shield' }),
    h('p', { class: 'small' }, t('chat.honesty.covered')),
    h('p', { class: 'small money--negative' }, t('chat.honesty.escrow')),
    h('p', { class: 'small muted', style: { marginBottom: 0 } }, t('chat.honesty.unaudited')),
  ]);
}

function deviceCard(identity, devices, chat, repaint) {
  const live = devices.filter((d) => !d.deletedAt && !d.revokedAt);

  return card({}, [
    cardHeader(t('chat.devices.title'),
      badge(t('chat.devices.count', { n: live.length }), live.length ? 'positive' : 'warning'),
      { iconName: 'shield' }),

    identity
      ? null
      : h('p', { class: 'small' }, t('chat.devices.notEnrolled')),

    live.length
      ? h('div', { class: 'list' }, live.map((device) => listItem({
        title: device.label || device.deviceId,
        // A device nobody has checked is not a device anybody should trust,
        // and the difference is shown rather than left to a settings page.
        subtitle: device.verifiedAt
          ? t('chat.devices.verified')
          : t('chat.devices.unverified'),
        trailing: device.verifiedAt
          ? badge(t('chat.devices.verifiedBadge'), 'positive')
          : badge(t('chat.devices.unverifiedBadge'), 'warning'),
      })))
      : empty({ title: t('chat.devices.none'), iconName: 'shield' }),

    h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-4)' } }, [
      button(identity ? t('chat.devices.enrolled') : t('chat.devices.enrol'), {
        variant: identity ? 'subtle' : 'primary',
        iconName: 'shield',
        disabled: Boolean(identity),
        onClick: async () => {
          const me = app().db.actor?.personId;
          if (!me) {
            toast(t('chat.devices.noPerson'), { kind: 'error' });
            return;
          }
          try {
            await chat.enrol(me, { label: t('chat.devices.thisDevice') });
            toast(t('chat.devices.done'), { kind: 'success' });
            await repaint();
          } catch (error) {
            toast(userMessage(error), { kind: 'error' });
          }
        },
      }),
    ]),
  ]);
}
