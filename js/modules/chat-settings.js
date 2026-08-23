/**
 * Chat settings.
 *
 * ## What this screen is for
 *
 * The sections a messenger normally carries — appearance, linked devices,
 * privacy, notifications, storage and data, accessibility, adding somebody —
 * gathered in one place instead of scattered across a drawer of twenty-five
 * modules.
 *
 * ## What it deliberately does not do
 *
 * Every row here either changes something real or says plainly that it
 * cannot. There are no toggles that store a preference nothing reads, and no
 * rows that imply a capability the service does not have.
 *
 * Three of the things a messenger usually offers do not exist in this
 * application, and the screen says so rather than drawing a dead control:
 *
 *   - **Read receipts and unread counts.** `message.readBy` is declared in the
 *     schema and written by nothing — it appears in exactly one file, the
 *     schema itself. A tick or a badge would be read off a field that has
 *     never held a value.
 *   - **Push notifications.** `POST_NOTIFICATIONS` is declared in the Android
 *     manifest, and the only thing that posts is the location foreground
 *     service. Nothing about a message reaches the notification tray.
 *   - **Typing and online status.** Nothing observes either.
 *
 * Invitations are the fourth of that shape but a different answer: adding
 * somebody is real, it is simply two deliberate steps rather than a link, and
 * `inviteCard` describes the steps that actually happen.
 *
 * ## The two stored preferences
 *
 * Both live here rather than in the cards, because both are applied at boot —
 * before any chat module has loaded — and a preference whose default lives in
 * the screen that displays it flashes the wrong value on every cold start.
 */

import { h, replace } from '../ui/dom.js';
import { card, cardHeader, pageHeader } from '../ui/components/basics.js';
import { Router } from '../ui/router.js';
import { app } from '../context.js';
import { ChatService } from '../services/chat.js';
import { t } from '../core/locale.js';
import {
  pickRow, devicesCard, privacyCard, notificationsCard,
  storageCard, accessibilityCard, inviteCard,
} from './chat-settings/sections.js';

/** Where a chat bubble's tint comes from. A real, stored preference. */
export const BUBBLE_KEY = 'familyos.chat.bubble';

/** How large the text in a conversation is. Also real, also stored. */
export const SIZE_KEY = 'familyos.chat.size';

/**
 * The tints on offer.
 *
 * Every one is an existing role token, so each has a measured contrast against
 * the text that sits on it in both themes — the browser suite re-measures them
 * on every run. A free colour picker would let somebody choose a tint their
 * own messages become unreadable on.
 */
export const BUBBLES = Object.freeze([
  { id: 'accent', token: 'accent' },
  { id: 'secondary', token: 'secondary' },
  { id: 'positive', token: 'positive' },
  { id: 'info', token: 'info' },
]);

/**
 * The message sizes on offer.
 *
 * Three steps, not a slider. Each one is a fixed multiplier the layout has
 * been measured at — the browser suite runs its overflow and tap-target
 * sweeps with the largest applied — and a continuous control would produce
 * sizes nothing has ever been checked at.
 */
export const SIZES = Object.freeze([
  { id: 'normal', scale: 1 },
  { id: 'large', scale: 1.15 },
  { id: 'largest', scale: 1.3 },
]);

/** @param {Storage} [storage] */
export function storedBubble(storage = globalThis.localStorage) {
  const value = storage?.getItem(BUBBLE_KEY);
  return BUBBLES.some((one) => one.id === value) ? value : 'accent';
}

/** @param {Storage} [storage] */
export function storedSize(storage = globalThis.localStorage) {
  const value = storage?.getItem(SIZE_KEY);
  return SIZES.some((one) => one.id === value) ? value : 'normal';
}

/**
 * @param {string} id
 * @param {{storage?: Storage, root?: HTMLElement}} [options]
 */
export function applyBubble(id, { storage = globalThis.localStorage, root } = {}) {
  const chosen = BUBBLES.some((one) => one.id === id) ? id : 'accent';
  storage?.setItem(BUBBLE_KEY, chosen);
  (root ?? document.documentElement).setAttribute('data-bubble', chosen);
  return chosen;
}

/**
 * @param {string} id
 * @param {{storage?: Storage, root?: HTMLElement}} [options]
 */
export function applySize(id, { storage = globalThis.localStorage, root } = {}) {
  const chosen = SIZES.some((one) => one.id === id) ? id : 'normal';
  storage?.setItem(SIZE_KEY, chosen);
  (root ?? document.documentElement).setAttribute('data-chat-size', chosen);
  return chosen;
}

/** Both preferences, for the one caller at boot that wants them together. */
export function applyChatPreferences(options = {}) {
  return {
    bubble: applyBubble(storedBubble(options.storage), options),
    size: applySize(storedSize(options.storage), options),
  };
}

export async function render() {
  const host = h('div', {});
  const { db } = app();  // handed to the service; not read here
  const chat = new ChatService(db);

  async function paint() {
    const { identity, devices, usage, nameOf: named } = await chat.settingsView();
    const nameOf = (id) => named(id) ?? t('chat.someone');

    replace(host, [
      pageHeader(t('chatSettings.title'), { subtitle: t('chatSettings.subtitle') }),

      // Order is the order somebody looks for these. Appearance first because
      // it is the one most people came for; devices second because it is the
      // one that decides who can read anything.
      themeCard(),
      devicesCard(identity, devices, nameOf, chat, paint),
      privacyCard(),
      notificationsCard(),
      storageCard(usage),
      accessibilityCard(
        SIZES.map((one) => ({ id: one.id, label: t(`chatSettings.size.${one.id}`) })),
        storedSize(),
        (id) => applySize(id),
      ),
      inviteCard(),
    ]);
  }

  await paint();
  return { node: host };
}

/** Chat theme — a stored preference the thread actually reads. */
function themeCard() {
  return card({}, [
    cardHeader(t('chatSettings.theme.title'), null, { iconName: 'sun' }),
    h('p', { class: 'small muted' }, t('chatSettings.theme.body')),
    pickRow(
      BUBBLES.map((one) => ({
        id: one.id,
        label: t(`chatSettings.bubble.${one.id}`),
        class: 'bubble-swatch',
        style: { background: `var(--${one.token}-subtle)`, borderColor: `var(--${one.token})` },
      })),
      storedBubble(),
      (id) => applyBubble(id),
      { name: t('chatSettings.theme.title') },
    ),
    h('p', { class: 'small faint' }, t('chatSettings.theme.note')),
    h('a', { class: 'btn btn--subtle btn--small', href: Router.href({ module: 'settings' }) },
      t('chatSettings.theme.system')),
  ]);
}
