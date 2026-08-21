/**
 * The small components.
 *
 * Each is a function returning a DOM node. No base class, no lifecycle, no
 * virtual tree — a component that needs to change returns an `update` handle
 * alongside its node, and one that does not is just a node.
 */

import { h, replace } from '../dom.js';
import { icon } from '../icons.js';
import { format, formatCompact } from '../../core/money.js';
import { formatDay, relativeDays, daysUntil } from '../../core/dates.js';

/**
 * Anything these components will accept where content goes.
 *
 * Written down because the type checker infers a destructured parameter's shape
 * from whichever properties happen to carry a default — so `{ variant, type =
 * 'button' }` was read as "an object with an optional `type`, and nothing
 * else", and **every caller passing `variant` was reported as an error.** Four
 * hundred of the five hundred findings on the first run were that, across nine
 * components: not a fault in the calls, a gap in what the components said about
 * themselves.
 *
 * @typedef {string|number|Node|null|undefined|Child[]} Child
 */

/**
 * A DOM handler.
 *
 * `Event` rather than a narrower type, and `any` for the argument, because the
 * same option carries click handlers and key handlers — typing it as `Event`
 * alone reported every `event.key` in the application as an error.
 *
 * @typedef {(event: any) => unknown} Handler
 */

export function card(props = {}, children) {
  const { variant, ...rest } = props;
  return h('div', {
    ...rest,
    class: ['card', variant && `card--${variant}`, rest.class],
  }, children);
}

/**
 * @param {Child} title
 * @param {Child} [actions]
 * @param {{subtitle?: Child, iconName?: string}} [options]
 */
export function cardHeader(title, actions = null, { subtitle, iconName } = {}) {
  return h('div', { class: 'card-header' }, [
    iconName ? icon(iconName, { size: 18, class: 'faint' }) : null,
    h('div', { class: 'spacer' }, [
      h('h3', {}, title),
      subtitle ? h('p', { class: 'small muted' }, subtitle) : null,
    ]),
    actions,
  ]);
}

/**
 * @param {Child} label
 * @param {{variant?: string, iconName?: string, onClick?: Handler,
 *          type?: string, class?: string, disabled?: boolean,
 *          [attr: string]: unknown}} [options]
 */
export function button(label, { variant, iconName, onClick, type = 'button', ...rest } = {}) {
  return h('button', {
    type,
    class: ['btn', variant && `btn--${variant}`, rest.class],
    onClick,
    ...rest,
  }, [
    iconName ? icon(iconName, { size: 18 }) : null,
    label ? h('span', {}, label) : null,
  ]);
}

/**
 * @param {string} name
 * @param {{label?: string, onClick?: Handler, variant?: string,
 *          class?: string, [attr: string]: unknown}} [options]
 */
export function iconButton(name, { label, onClick, variant, ...rest } = {}) {
  return h('button', {
    type: 'button',
    class: ['btn', 'btn--icon', variant && `btn--${variant}`, rest.class],
    // An icon-only control is unlabelled to a screen reader without this.
    'aria-label': label,
    title: label,
    onClick,
    ...rest,
  }, icon(name, { size: 20 }));
}

export function badge(label, tone = '') {
  return h('span', { class: ['badge', tone && `badge--${tone}`] }, label);
}

/**
 * @param {Child} label
 * @param {{pressed?: boolean, onClick?: Handler, iconName?: string}} [options]
 */
export function chip(label, { pressed = false, onClick, iconName } = {}) {
  return h('button', {
    type: 'button',
    class: 'chip',
    'aria-pressed': String(Boolean(pressed)),
    onClick,
  }, [iconName ? icon(iconName, { size: 16 }) : null, label]);
}

/**
 * Initials, because a photo is optional and a blank circle says nothing.
 *
 * @param {string} name
 * @param {{size?: string, photo?: string}} [options]
 */
export function avatar(name, { size = '', photo } = {}) {
  if (photo) {
    return h('img', {
      class: ['avatar', size && `avatar--${size}`],
      src: photo,
      alt: '',
      loading: 'lazy',
    });
  }
  const initials = String(name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';
  return h('div', {
    class: ['avatar', size && `avatar--${size}`],
    'aria-hidden': 'true',
  }, initials);
}

/**
 * A headline number. `delta` is a signed percentage; its colour follows
 * `goodWhen`, because a fall in expenses is good and a fall in income is not.
 *
 * @param {{label?: Child, value?: Child, delta?: number|null, hint?: Child,
 *          iconName?: string, goodWhen?: 'up'|'down', compact?: boolean}} [options]
 */
export function metric({
  label, value, delta = null, hint, iconName, goodWhen = 'up', compact = false,
} = {}) {
  const good = delta === null ? null
    : (goodWhen === 'up' ? delta >= 0 : delta <= 0);

  return h('div', { class: 'metric' }, [
    h('div', { class: 'metric-label' }, [
      iconName ? icon(iconName, { size: 15 }) : null,
      label,
    ]),
    h('div', { class: ['metric-value', compact && 'metric-value--sm'] }, value),
    delta !== null
      ? h('div', {
        class: ['metric-delta', good ? 'metric-delta--up' : 'metric-delta--down'],
      }, `${delta > 0 ? '+' : ''}${delta}%${hint ? ` ${hint}` : ''}`)
      : hint ? h('div', { class: 'small faint' }, hint) : null,
  ]);
}

/**
 * An amount, coloured only when the sign carries meaning.
 *
 * @param {number} minor
 * @param {{currency?: string, signed?: boolean, compact?: boolean}} [options]
 */
export function money(minor, { currency = 'INR', signed = false, compact = false } = {}) {
  const value = minor ?? 0;
  return h('span', {
    class: ['numeric', signed && (value < 0 ? 'money--negative' : 'money--positive')],
  }, compact ? formatCompact(value, currency) : format(value, currency, { sign: signed }));
}

/**
 * @param {{title?: Child, message?: Child, iconName?: string, action?: Child}} [options]
 */
export function empty({ title, message, iconName = 'info', action } = {}) {
  return h('div', { class: 'empty' }, [
    icon(iconName, { size: 42 }),
    h('h3', {}, title),
    message ? h('p', { class: 'small' }, message) : null,
    action,
  ]);
}

/**
 * @param {{height?: number|string, width?: number|string, radius?: number|string}} [options]
 */
export function skeleton({ height = 16, width = '100%', radius } = {}) {
  return h('div', {
    class: 'skeleton',
    style: { height: `${height}px`, width, borderRadius: radius },
    'aria-hidden': 'true',
  });
}

export function skeletonList(rows = 5) {
  return h('div', { class: 'stack stack--tight', 'aria-busy': 'true' },
    Array.from({ length: rows }, (_, i) => skeleton({ height: 44, width: i % 3 ? '100%' : '80%' })));
}

/**
 * A bar with a threshold: over budget turns amber, then red.
 *
 * @param {number} value
 * @param {number} max
 * @param {{warnAt?: number, label?: Child}} [options]
 */
export function progress(value, max, { warnAt = 0.8, label } = {}) {
  const ratio = max > 0 ? value / max : 0;
  const tone = ratio >= 1 ? 'danger' : ratio >= warnAt ? 'warning' : '';
  return h('div', { class: 'stack stack--tight' }, [
    label ? h('div', { class: 'row row--between small' }, [
      h('span', { class: 'muted' }, label),
      h('span', { class: 'numeric' }, `${Math.round(ratio * 100)}%`),
    ]) : null,
    h('div', {
      class: 'progress',
      role: 'progressbar',
      'aria-valuenow': Math.round(ratio * 100),
      'aria-valuemin': 0,
      'aria-valuemax': 100,
      'aria-label': label ?? 'progress',
    }, h('div', {
      class: ['progress-bar', tone && `progress-bar--${tone}`],
      style: { width: `${Math.min(100, ratio * 100)}%` },
    })),
  ]);
}

/**
 * @param {{title?: Child, subtitle?: Child, value?: Child, leading?: Child,
 *          trailing?: Child, href?: string, onClick?: Handler,
 *          tone?: string}} [options]
 */
export function listItem({ title, subtitle, value, leading, trailing, href, onClick, tone } = {}) {
  const children = [
    leading,
    h('div', { class: 'list-item-body' }, [
      h('div', { class: 'list-item-title' }, title),
      subtitle ? h('div', { class: 'list-item-subtitle' }, subtitle) : null,
    ]),
    value ? h('div', { class: ['list-item-value', tone && `money--${tone}`] }, value) : null,
    trailing,
  ];
  return href
    ? h('a', { class: 'list-item', href }, children)
    : h('div', { class: 'list-item', onClick, ...(onClick ? { role: 'button', tabindex: '0' } : {}) }, children);
}

/**
 * A due date with the urgency already worked out — the same rule everywhere,
 * so "expiring soon" means one thing across nineteen modules.
 */
/**
 * @param {string} day
 * @param {{leadDays?: number}} [options]
 */
export function dueBadge(day, { leadDays = 30 } = {}) {
  if (!day) return null;
  const days = daysUntil(day);
  if (!Number.isFinite(days)) return null;

  const tone = days < 0 ? 'danger'
    : days <= Math.min(7, leadDays) ? 'danger'
      : days <= leadDays ? 'warning'
        : 'positive';

  const label = days < 0 ? `overdue ${relativeDays(day)}` : relativeDays(day);
  return badge(label, tone);
}

/**
 * @param {string} day
 * @param {{relative?: boolean}} [options]
 */
export function dateText(day, { relative = false } = {}) {
  if (!day) return h('span', { class: 'faint' }, '—');
  return h('span', { title: formatDay(day) }, relative ? relativeDays(day) : formatDay(day));
}

/** A value hidden until asked for. Vault fields and document numbers. */
export function reveal(value, { label = 'value', masked = '••••••••' } = {}) {
  let shown = false;
  const code = h('code', {}, masked);
  const toggle = iconButton('eye', {
    label: `Show ${label}`,
    class: 'btn--small',
    onClick: () => {
      shown = !shown;
      code.textContent = shown ? value : masked;
      replace(toggle, icon(shown ? 'eyeOff' : 'eye', { size: 18 }));
      toggle.setAttribute('aria-label', `${shown ? 'Hide' : 'Show'} ${label}`);
    },
  });
  const copy = iconButton('copy', {
    label: `Copy ${label}`,
    class: 'btn--small',
    onClick: async () => {
      await navigator.clipboard?.writeText(value);
      const { toast } = await import('./toast.js');
      // Clipboards on shared machines are a real leak; say how long it lasts.
      toast(`${label} copied — clear your clipboard when you are done`);
    },
  });
  return h('span', { class: 'reveal' }, [code, toggle, copy]);
}

export function divider() {
  return h('hr', { class: 'divider' });
}

/**
 * @param {Child} title
 * @param {{subtitle?: Child, actions?: Child}} [options]
 */
export function pageHeader(title, { subtitle, actions } = {}) {
  return h('header', { class: 'page-header' }, [
    h('div', { class: 'spacer' }, [
      h('h1', {}, title),
      subtitle ? h('p', {}, subtitle) : null,
    ]),
    actions ? h('div', { class: 'row' }, actions) : null,
  ]);
}
