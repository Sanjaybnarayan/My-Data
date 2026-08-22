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
  // A conversation opens into its own view rather than the generic record
  // screen. `recordDetail` shows fields, and a conversation's field is a list
  // of sealed bodies — which is exactly what nobody wants to look at.
  if (route.id && route.id !== 'new' && route.entity === 'conversation') {
    return conversationView(route.id);
  }
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

/* ------------------------------------------------------ one conversation */

/**
 * Reading and writing one conversation.
 *
 * Until this existed `ChatService.send` had no caller: the encryption was
 * built, tested, and unreachable from any screen. A phase scored for code a
 * household cannot use is the inflation this repository's scorecard exists to
 * refuse, so the view came before the score.
 *
 * Every message that cannot be opened says **why** in place. A gap where a
 * line should be reads as a message that was never sent, and the reasons are
 * genuinely different: one arrived before this device enrolled, one was
 * withdrawn, one was sealed to a key this device no longer has.
 */
async function conversationView(conversationId) {
  const host = h('div', {});
  const { db } = app();
  const chat = new ChatService(db);

  /** The file waiting to be sent, if somebody has chosen one. */
  let pending = null;

  const box = h('textarea', {
    id: 'chat-text', rows: 2, class: 'input', placeholder: t('chat.say'),
  });

  const picker = h('input', {
    type: 'file', class: 'sr-only',
    onChange: (event) => {
      pending = event.target.files?.[0] ?? null;
      event.target.value = '';
      void paint();
    },
  });

  async function sendText() {
    const text = String(box.value ?? '').trim();
    if (!text) return;
    try {
      await chat.send(conversationId, db.actor?.personId ?? '', text);
      box.value = '';
      await paint();
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    }
  }

  async function sendFile() {
    if (!pending) return;
    try {
      const bytes = new Uint8Array(await pending.arrayBuffer());
      await chat.attach(conversationId, db.actor?.personId ?? '', {
        name: pending.name, type: pending.type, bytes,
      });
      pending = null;
      await paint();
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    }
  }

  /**
   * Hand a file back to the person who can read it.
   *
   * Built from the decrypted bytes in memory and released immediately. The
   * plaintext never touches the disk, which is the point of having sealed it.
   */
  async function saveFile(file) {
    try {
      const bytes = await chat.openAttachment(file.attachment);
      if (!bytes) {
        toast(t('chat.file.gone'), { kind: 'error' });
        return;
      }
      const url = URL.createObjectURL(new Blob([bytes], { type: file.type }));
      const link = h('a', { href: url, download: file.name });
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    }
  }

  async function paint() {
    const { conversation, messages, nameOf: named } = await chat.view(conversationId);
    const nameOf = (id) => named(id) ?? t('chat.someone');

    replace(host, [
      pageHeader(conversation?.title || t('chat.title'), {
        subtitle: t('chat.subtitle'),
      }),
      honestyCard(),

      card({}, [
        messages.length
          ? h('div', { class: 'list' }, messages.map((m) => messageItem(m, nameOf, saveFile)))
          : empty({ title: t('chat.empty'), iconName: 'message' }),
      ]),

      card({}, [
        box,
        pending
          ? h('p', { class: 'small' }, t('chat.file.chosen', { name: pending.name }))
          : null,
        picker,
        h('div', { class: 'row', style: { gap: 'var(--space-2)', marginTop: 'var(--space-3)' } }, [
          button(t('chat.send'), { variant: 'primary', onClick: () => void sendText() }),
          button(t('chat.file.choose'), { variant: 'subtle', onClick: () => picker.click() }),
          pending
            ? button(t('chat.file.send'), { variant: 'subtle', onClick: () => void sendFile() })
            : null,
        ].filter(Boolean)),
      ]),
    ]);
  }

  await paint();
  return { node: host };
}

/** One line of a conversation, including the ones this device cannot read. */
function messageItem(message, nameOf, saveFile) {
  const who = nameOf(message.row.sender);

  // Said in place, and each reason differently. "Could not decrypt" would send
  // somebody looking for damage in three situations where there is none.
  const REASONS = {
    withdrawn: t('chat.why.withdrawn'),
    sentBefore: t('chat.why.sentBefore'),
    keyChanged: t('chat.why.keyChanged'),
    notEnrolled: t('chat.why.notEnrolled'),
    unreadable: t('chat.why.unreadable'),
  };

  if (message.why) {
    return listItem({
      title: h('em', { class: 'muted' }, REASONS[message.why] ?? REASONS.unreadable),
      subtitle: who,
    });
  }

  if (message.file) {
    return listItem({
      title: message.file.name,
      subtitle: `${who} · ${Math.max(1, Math.round(message.file.size / 1024))} KB`,
      trailing: button(t('chat.file.open'), {
        variant: 'subtle',
        onClick: () => void saveFile(message.file),
      }),
    });
  }

  return listItem({ title: message.text, subtitle: who });
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
