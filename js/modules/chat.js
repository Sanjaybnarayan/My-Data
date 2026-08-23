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
import { bus, TOPIC } from '../core/bus.js';
import { Router } from '../ui/router.js';
import { ChatService } from '../services/chat.js';
import { userMessage } from '../core/errors.js';
import { t } from '../core/locale.js';
import { icon } from '../ui/icons.js';
import { formatDay } from '../core/dates.js';

export async function render(route) {
  // A conversation opens into its own view rather than the generic record
  // screen. `recordDetail` shows fields, and a conversation's field is a list
  // of sealed bodies — which is exactly what nobody wants to look at.
  if (route.id && route.id !== 'new' && route.entity === 'conversation') {
    return conversationView(route.id);
  }
  // `#/chat/settings` is a screen, not an entity list — checked before the
  // generic entity handling below, which would otherwise look for an entity
  // called "settings" and throw.
  if (route.entity === 'settings') {
    const view = await import('./chat-settings.js');
    return view.render();
  }

  if (route.id && route.id !== 'new' && route.entity) return recordDetail(route.entity, route.id);

  const host = h('div', {});
  const { db } = app();
  const chat = new ChatService(db);

  // Built once, outside `paint`. Two bugs met here: the object was being put
  // into the children array instead of its `node`, so the screen rendered the
  // literal text `[object Object]`; and building it inside `paint` would add a
  // fresh bus subscription and a fresh table on every repaint.
  const section = await listSection('conversation', { autoOpenNew: route.id === 'new' });

  async function paint() {
    const [identity, devices, threads] = await Promise.all([
      chat.identity(),
      chat.devices(),
      chat.threads(),
    ]);

    replace(host, [
      pageHeader(t('chat.title'), {
        subtitle: t('chat.subtitle'),
        actions: [h('a', {
          class: 'btn btn--subtle btn--small',
          href: Router.href({ module: 'chat', entity: 'settings' }),
        }, t('chat.settings.open'))],
      }),

      threadList(threads, section),

      // The generic list stays: it is how a conversation is created, renamed
      // or has its participants changed, and none of that is worth
      // reimplementing to make a prettier list above it.
      /*
       * Open when there is nothing yet.
       *
       * Folding the conversation list away is right once there are threads to
       * read — but with none, this disclosure held the only way to make one,
       * and the empty state above pointed at a control nobody could see.
       */
      h('details', { class: 'chat-manage', open: threads.length === 0 }, [
        h('summary', {}, t('chat.manage')),
        section.node,
      ]),

      honestyCard(),
      deviceCard(identity, devices, chat, paint),
    ]);
  }

  await paint();

  /*
   * Repaint when anything changes.
   *
   * `listSection` subscribes for itself, so creating a conversation refreshed
   * the management list below and left the thread list above showing "no
   * conversations yet" — the screen disagreeing with itself about whether the
   * thing had been created.
   */
  const off = bus.on(`${TOPIC.dataChanged}:chat`, () => void paint());

  return {
    node: host,
    destroy: () => {
      off();
      section.destroy();
    },
  };
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

  async function withdrawMessage(messageId) {
    try {
      await chat.withdraw(messageId);
      toast(t('chat.withdrawn'), { kind: 'success' });
      await paint();
    } catch (error) {
      toast(userMessage(error), { kind: 'error' });
    }
  }

  async function paint() {
    /*
     * The identity is loaded with the conversation, not checked on Send.
     *
     * Without it `chat.send` throws, and the only way to find that out was to
     * type a message and press Send: the composer looked ready, took the
     * typing, and failed afterwards. What a device cannot do it should not
     * offer.
     */
    const [{ conversation, messages, nameOf: named }, identity] = await Promise.all([
      chat.view(conversationId),
      chat.identity(),
    ]);
    const nameOf = (id) => named(id) ?? t('chat.someone');

    replace(host, [
      pageHeader(conversation?.title || t('chat.title'), {
        subtitle: t('chat.subtitle'),
      }),
      honestyCard(),

      card({ class: 'card--flush thread' }, [
        messages.length
          ? h('div', { class: 'thread-scroll' },
            messages.map((m) => messageItem(
              m, nameOf, saveFile, db.actor?.personId ?? null, withdrawMessage,
            )))
          : h('div', { class: 'thread-empty' },
            empty({ title: t('chat.empty'), iconName: 'chat' })),
      ]),

      identity
        ? card({ class: 'composer' }, [
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
        ])
        : card({ class: 'composer composer--blocked' }, [
          h('p', { class: 'small' }, t('chat.devices.notEnrolled')),
          enrolButton(chat, paint),
        ]),
    ]);
  }

  await paint();
  return { node: host };
}

/**
 * The conversations, most recently spoken in first.
 *
 * Each row is who it is with, the last thing said, and when. No unread count:
 * `message.readBy` is declared in the schema and written by nothing, so a
 * number there would be read off a field that has never held a value.
 */
function threadList(threads, section) {
  if (!threads.length) {
    return card({}, empty({
      title: t('chat.none.title'),
      message: t('chat.none.message'),
      iconName: 'chat',
      // The action, not a sentence pointing at one. `listSection` hands back
      // `openForm` precisely so a screen can offer its own way in.
      action: button(t('chat.none.action'), {
        variant: 'primary',
        iconName: 'plus',
        onClick: () => section.openForm(),
      }),
    }));
  }

  return card({ class: 'card--flush' }, [
    h('div', { class: 'list' }, threads.map(({ conversation, last, at }) => listItem({
      title: conversation.title || t('chat.untitled'),
      subtitle: last
        ? (last.why ? t('chat.lastSealed') : (last.file ? last.file.name : last.text))
        : t('chat.nothingSaid'),
      trailing: at
        ? h('span', { class: 'small faint' }, formatDay(String(at).slice(0, 10)))
        : null,
      href: Router.href({ module: 'chat', entity: 'conversation', id: conversation.id }),
    }))),
  ]);
}

/**
 * One message, as a bubble.
 *
 * ## What a bubble can and cannot say here
 *
 * Mine or theirs, when it was sent, and — for the ones this device cannot open
 * — why. That is everything the store knows about a message.
 *
 * It does **not** say delivered, read, or seen. `message.readBy` is declared in
 * the schema and written by nothing: it appears in exactly one file, the schema
 * itself. A tick claiming somebody read this would be drawn from a field that
 * has never held a value, which is worse than no tick at all — somebody would
 * act on it.
 *
 * Nor is there a reaction, a reply, a forward or a voice note. None of them
 * exist in the service, and drawing a control that cannot work is how a screen
 * teaches somebody to distrust the whole application.
 *
 * @param {object} message
 * @param {(id: string) => string} nameOf
 * @param {(file: object) => void} saveFile
 * @param {string|null} me the signed-in person, or null — decides which side
 * @param {((id: string) => void)|null} withdraw offered on my own messages only
 */
function messageItem(message, nameOf, saveFile, me = null, withdraw = null) {
  const who = nameOf(message.row.sender);
  const mine = Boolean(me) && message.row.sender === me;

  const stamp = String(message.row.sentAt ?? '');
  const at = stamp.length >= 16 ? stamp.slice(11, 16) : '';

  /*
   * Withdrawing is offered on my own messages and nobody else's.
   *
   * `ChatService.withdraw` has existed since the encryption was written and
   * no screen had ever called it — the same fault as `send` before the
   * conversation view. It is a real capability: the sealed body and any
   * attached file are deleted, and the row stays behind marked withdrawn so
   * every other device learns what happened rather than watching a message
   * silently vanish.
   *
   * What it cannot do is said before it happens, not after. A device that had
   * already opened the message is beyond this application's reach, and
   * somebody deleting something they regret is entitled to know that while
   * they can still change their mind.
   */
  const canWithdraw = mine && withdraw && !message.why;

  /** The shell every bubble shares: side, who said it, and when. */
  const bubble = (body, { tone = '' } = {}) => h('div', {
    class: ['bubble-row', mine ? 'bubble-row--mine' : 'bubble-row--theirs'],
  }, h('div', { class: ['bubble', tone && `bubble--${tone}`] }, [
    // Their name, not mine — on my own messages it is noise.
    mine ? null : h('p', { class: 'bubble-who' }, who),
    body,
    h('p', { class: 'bubble-meta' }, at || formatDay(stamp.slice(0, 10))),
    canWithdraw
      ? button(t('chat.withdraw'), {
        variant: 'subtle',
        class: 'btn btn--subtle btn--small bubble-withdraw',
        onClick: () => {
          if (!globalThis.confirm?.(t('chat.withdrawConfirm'))) return;
          withdraw(message.row.id);
        },
      })
      : null,
  ]));

  const REASONS_BUBBLE = {
    withdrawn: t('chat.why.withdrawn'),
    sentBefore: t('chat.why.sentBefore'),
    keyChanged: t('chat.why.keyChanged'),
    notEnrolled: t('chat.why.notEnrolled'),
    unreadable: t('chat.why.unreadable'),
  };

  if (message.why) {
    return bubble(h('p', { class: 'bubble-text' },
      h('em', { class: 'muted' }, REASONS_BUBBLE[message.why] ?? REASONS_BUBBLE.unreadable)),
    { tone: 'quiet' });
  }

  if (message.file) {
    return bubble(h('div', { class: 'bubble-file' }, [
      icon('file', { size: 18 }),
      h('div', { class: 'spacer' }, [
        h('p', { class: 'bubble-text' }, message.file.name),
        h('p', { class: 'bubble-size' },
          `${Math.max(1, Math.round(message.file.size / 1024))} KB`),
      ]),
      button(t('chat.file.open'), {
        variant: 'subtle',
        class: 'btn--small',
        onClick: () => void saveFile(message.file),
      }),
    ]));
  }

  return bubble(h('p', { class: 'bubble-text' }, message.text));
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
      enrolButton(chat, repaint, { done: Boolean(identity) }),
    ]),
  ]);
}

/**
 * Give this device a chat key.
 *
 * Shared between the settings card and the composer because both need the
 * same three outcomes: no linked person, enrolment failed, enrolled. Writing
 * it twice is how the two would come to disagree about which of those the
 * person is told about.
 */
function enrolButton(chat, repaint, { done = false } = {}) {
  return button(done ? t('chat.devices.enrolled') : t('chat.devices.enrol'), {
    variant: done ? 'subtle' : 'primary',
    iconName: 'shield',
    disabled: done,
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
  });
}
