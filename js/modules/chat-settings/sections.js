/**
 * The cards on the chat settings screen.
 *
 * Split out of `chat-settings.js` so neither file becomes the 800-line
 * module the size budget exists to prevent. The split is by job, not by
 * length: this file draws, `chat-settings.js` owns the two stored
 * preferences and decides what is on the screen.
 *
 * Every card here obeys one rule. **A row either changes something the
 * service can actually do, or it says plainly that the thing does not
 * exist.** There is no third kind of row — no toggle whose value nothing
 * reads, no greyed control implying "later", no tick implying delivery.
 */

import { h } from '../../ui/dom.js';
import { card, cardHeader, badge, listItem, button, empty } from '../../ui/components/basics.js';
import { toast } from '../../ui/components/toast.js';
import { Router } from '../../ui/router.js';
import { userMessage } from '../../core/errors.js';
import { t } from '../../core/locale.js';
import { formatDay } from '../../core/dates.js';

/* ------------------------------------------------------------- appearance */

/**
 * A row of swatches or sizes, drawn the same way.
 *
 * Both preferences are the same shape — a small closed set, one chosen, the
 * choice applied and stored immediately — so they are one function. Two
 * near-identical ones is how the second would quietly stop announcing its
 * pressed state.
 *
 * @param {{id: string, label: string, style?: object, class?: string}[]} options
 * @param {string} current
 * @param {(id: string) => void} onPick
 */
export function pickRow(options, current, onPick, { name = '' } = {}) {
  return h('div', { class: 'chip-row', role: 'group', 'aria-label': name },
    options.map((one) => {
      const base = one.class ?? 'chip';
      const chosen = `${base}--on`;
      return h('button', {
        type: 'button',
        class: [base, one.id === current && chosen],
        'aria-pressed': String(one.id === current),
        'aria-label': one.label,
        style: one.style,
        onClick: (event) => {
          onPick(one.id);
          for (const el of event.currentTarget.parentElement.children) {
            const on = el === event.currentTarget;
            el.classList.toggle(chosen, on);
            el.setAttribute('aria-pressed', String(on));
          }
        },
      }, h('span', { class: 'bubble-swatch-name' }, one.label));
    }));
}

/* ---------------------------------------------------------------- devices */

/**
 * Linked devices, with the two things the service can do to one.
 *
 * `markVerified` and `revoke` have existed in `ChatService` since the
 * encryption was written and no screen had ever called either. A safety
 * number nobody can see is a safety number nobody compares, and a key that
 * cannot be revoked is a key that is trusted forever — so both are here.
 *
 * The safety number is fetched on demand rather than drawn for every device
 * at once: it is a hash of two public keys, and computing eight of them to
 * show one is work nobody asked for.
 */
export function devicesCard(identity, devices, nameOf, chat, repaint) {
  const live = devices.filter((one) => !one.revokedAt);
  const revoked = devices.filter((one) => one.revokedAt);
  const thisDevice = live.find((one) => one.deviceId === chat.db.deviceId) ?? null;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(
      t('chatSettings.devices.title'),
      badge(t('chatSettings.devices.count', { n: live.length }),
        live.length ? 'positive' : 'warning'),
      { iconName: 'shield' },
    )),

    h('p', { class: 'small muted attention-head' }, t('chatSettings.devices.body')),

    live.length
      ? h('div', { class: 'list' },
        live.map((device) => deviceRow(device, {
          mine: device.deviceId === chat.db.deviceId,
          nameOf, chat, repaint,
        })))
      : h('div', { class: 'attention-head' },
        empty({ title: t('chatSettings.devices.none'), iconName: 'shield' })),

    // Revoked devices are listed, not hidden. A key that was trusted and is
    // not any more is a thing a household should be able to see it did.
    revoked.length
      ? h('details', { class: 'chat-manage attention-head' }, [
        h('summary', {}, t('chatSettings.devices.revokedCount', { n: revoked.length })),
        h('div', { class: 'list' }, revoked.map((device) => listItem({
          title: device.label || device.deviceId,
          subtitle: t('chatSettings.devices.revokedOn', { day: formatDay(device.revokedAt) }),
          trailing: badge(t('chatSettings.devices.revokedBadge'), 'muted'),
        }))),
      ])
      : null,

    h('div', { class: 'attention-foot row', style: { gap: 'var(--space-2)' } }, [
      thisDevice && identity
        ? h('p', { class: ['small', 'faint'], style: { margin: 0 } },
          t('chatSettings.devices.alreadyHere'))
        : h('a', { class: 'btn btn--primary btn--small', href: Router.href({ module: 'chat' }) },
          t('chatSettings.devices.enrolHere')),
    ]),
  ]);
}

function deviceRow(device, { mine, nameOf, chat, repaint }) {
  const who = nameOf(device.person);
  const number = h('p', { class: 'small mono safety-number', hidden: true });

  const row = listItem({
    title: device.label || device.deviceId,
    subtitle: [
      who,
      mine ? t('chatSettings.devices.thisOne') : null,
      device.addedAt ? t('chatSettings.devices.added', { day: formatDay(device.addedAt) }) : null,
    ].filter(Boolean).join(' · '),
    // Never colour alone: the badge carries the word as well as the tone.
    trailing: badge(
      device.verifiedAt
        ? t('chatSettings.devices.verifiedBadge')
        : t('chatSettings.devices.unverifiedBadge'),
      device.verifiedAt ? 'positive' : 'warning',
    ),
  });

  const actions = h('div', { class: 'row device-actions', style: { gap: 'var(--space-2)' } }, [
    // Comparing a device's number with itself proves nothing, so this device
    // is not offered the control.
    mine ? null : button(t('chatSettings.devices.compare'), {
      variant: 'subtle',
      class: 'btn btn--subtle btn--small',
      onClick: async () => {
        try {
          const value = await chat.safetyNumberWith(device.publicKey);
          number.textContent = value;
          number.hidden = false;
        } catch (error) {
          toast(userMessage(error), { kind: 'error' });
        }
      },
    }),

    device.verifiedAt ? null : button(t('chatSettings.devices.matched'), {
      variant: 'subtle',
      class: 'btn btn--subtle btn--small',
      onClick: async () => {
        try {
          await chat.markVerified(device.id);
          toast(t('chatSettings.devices.markedDone'), { kind: 'success' });
          await repaint();
        } catch (error) {
          toast(userMessage(error), { kind: 'error' });
        }
      },
    }),

    button(t('chatSettings.devices.revoke'), {
      variant: 'subtle',
      class: 'btn btn--subtle btn--small btn--danger',
      onClick: async () => {
        // Said before it happens, because it cannot be undone and does not do
        // what most people assume: the messages already sealed to this key
        // stay readable by it forever.
        if (!globalThis.confirm?.(t('chatSettings.devices.revokeConfirm'))) return;
        try {
          await chat.revoke(device.id);
          toast(t('chatSettings.devices.revokedDone'), { kind: 'success' });
          await repaint();
        } catch (error) {
          toast(userMessage(error), { kind: 'error' });
        }
      },
    }),
  ].filter(Boolean));

  return h('div', { class: 'device-block' }, [row, actions, number]);
}

/* ---------------------------------------------------------------- privacy */

/**
 * What is sealed, what is not, and what withdrawing a message really does.
 *
 * The escrow sentence is repeated here even though the chat screen already
 * carries it. Somebody who opens a privacy page is asking exactly this
 * question, and "we said that on another screen" is not an answer.
 */
export function privacyCard() {
  const ROWS = ['sealed', 'escrow', 'withdraw', 'revoke', 'plaintext'];

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' },
      cardHeader(t('chatSettings.privacy.title'), null, { iconName: 'shield' })),
    h('div', { class: 'list' }, ROWS.map((key) => listItem({
      title: t(`chatSettings.privacy.${key}`),
      subtitle: t(`chatSettings.privacy.${key}Why`),
    }))),
    h('div', { class: 'attention-foot' }, [
      h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'settings' }) },
        t('chatSettings.privacy.more')),
    ]),
  ]);
}

/* ---------------------------------------------------------- notifications */

/**
 * Notifications, which for messages do not exist.
 *
 * `POST_NOTIFICATIONS` is declared in the Android manifest and the only thing
 * that posts is the location foreground service. Nothing about a message
 * reaches the tray, on any platform, and a switch here would be a promise the
 * application cannot keep.
 */
export function notificationsCard() {
  // Read receipts and presence sit here rather than in a card of their own:
  // all three are the same question — *does the other person know?* — and the
  // answer to all three is that nothing records it.
  const ROWS = ['receipts', 'presence'];

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' }, cardHeader(t('chatSettings.notify.title'),
      badge(t('chatSettings.notify.badge'), 'muted'), { iconName: 'bell' })),

    h('p', { class: 'small attention-head' }, t('chatSettings.notify.none')),

    h('div', { class: 'list' }, ROWS.map((key) => listItem({
      title: t(`chatSettings.notify.${key}`),
      subtitle: t(`chatSettings.notify.${key}Why`),
    }))),

    h('p', { class: 'small muted attention-head' }, t('chatSettings.notify.instead')),

    h('div', { class: 'attention-foot' }, [
      h('a', {
        class: 'btn btn--subtle btn--small',
        href: Router.href({ module: 'notifications' }),
      }, t('chatSettings.notify.open')),
    ]),
  ]);
}

/* ------------------------------------------------------- storage and data */

/**
 * What this device is holding, counted.
 *
 * @param {{conversations: number, messages: number, withdrawn: number,
 *          attachments: number, bytes: number}} usage
 */
export function storageCard(usage) {
  const mb = usage.bytes / 1024 / 1024;

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' },
      cardHeader(t('chatSettings.storage.title'), null, { iconName: 'box' })),

    h('div', { class: 'list' }, [
      listItem({
        title: t('chatSettings.storage.conversations'),
        trailing: badge(String(usage.conversations), 'muted'),
      }),
      listItem({
        title: t('chatSettings.storage.messages'),
        trailing: badge(String(usage.messages), 'muted'),
      }),
      listItem({
        title: t('chatSettings.storage.withdrawn'),
        subtitle: t('chatSettings.storage.withdrawnWhy'),
        trailing: badge(String(usage.withdrawn), 'muted'),
      }),
      listItem({
        title: t('chatSettings.storage.attachments'),
        subtitle: t('chatSettings.storage.attachmentsWhere'),
        trailing: badge(mb >= 0.05
          ? t('chatSettings.storage.mb', { n: mb.toFixed(1), files: usage.attachments })
          : t('chatSettings.storage.files', { files: usage.attachments }), 'muted'),
      }),
    ]),

    h('p', { class: ['small', 'muted', 'attention-head'] }, t('chatSettings.storage.backup')),

    h('div', { class: 'attention-foot' }, [
      h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'settings' }) },
        t('chatSettings.storage.manage')),
    ]),
  ]);
}

/* ---------------------------------------------------------- accessibility */

/**
 * Accessibility.
 *
 * The size control is real and applies to the thread. The paragraph under it
 * is the part that matters more: **no screen reader has ever been run against
 * this application.** The markup was written for one and the roles are
 * checked by the browser suite, but checked markup and a tested experience
 * are different claims and only one of them is true here.
 */
export function accessibilityCard(sizes, current, onPick) {
  return card({}, [
    cardHeader(t('chatSettings.access.title'), null, { iconName: 'eye' }),
    h('p', { class: ['small', 'muted'] }, t('chatSettings.access.body')),
    pickRow(sizes, current, onPick, { name: t('chatSettings.access.title') }),
    h('p', { class: 'small' }, t('chatSettings.access.checked')),
    h('p', { class: 'small money--negative', style: { marginBottom: 0 } },
      t('chatSettings.access.untested')),
  ]);
}

/* ----------------------------------------------------------- invite member */

/**
 * Adding somebody, which is two deliberate steps and not a link.
 *
 * There is no invitation mechanism, and building one that emailed a URL would
 * mean a key arriving over a channel this application does not control. So
 * the screen describes what actually happens: a person record is created
 * here, and that person enrols a device on their own phone. Until the second
 * step, messages cannot be sealed to them — which is why the row says so
 * rather than letting somebody discover it when a send fails.
 */
export function inviteCard() {
  const STEPS = ['one', 'two', 'three'];

  return card({ class: 'card--flush' }, [
    h('div', { class: 'attention-head' },
      cardHeader(t('chatSettings.invite.title'),
        badge(t('chatSettings.invite.badge'), 'muted'), { iconName: 'family' })),

    h('p', { class: 'small muted attention-head' }, t('chatSettings.invite.body')),

    h('div', { class: 'list' }, STEPS.map((key, index) => listItem({
      leading: badge(String(index + 1), 'muted'),
      title: t(`chatSettings.invite.${key}`),
      subtitle: t(`chatSettings.invite.${key}Why`),
    }))),

    h('div', { class: 'attention-foot row', style: { gap: 'var(--space-2)' } }, [
      h('a', {
        class: 'btn btn--primary btn--small',
        href: Router.href({ module: 'identity', entity: 'person', id: 'new' }),
      }, t('chatSettings.invite.addPerson')),
      h('a', {
        class: 'btn btn--subtle btn--small',
        href: Router.href({ module: 'chat', entity: 'conversation', id: 'new' }),
      }, t('chatSettings.invite.startOne')),
    ]),
  ]);
}
