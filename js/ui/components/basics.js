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
      /*
       * `h2`, not `h3`, and the size is held by CSS rather than by the tag.
       *
       * `pageHeader` emits the `h1` and this emitted an `h3`, with no `h2`
       * anywhere — so every screen in the application jumped a heading level.
       * Somebody navigating by heading hears the page title and then level
       * three, with nothing at level two, on all 138 screens a probe walked.
       *
       * A card *is* the second level of a page, so the tag was simply wrong.
       * `.card-header h2` keeps `--text-lg`, the size an `h3` had, so nothing
       * changes visually — the same trick `.modal-header h2` already uses.
       * Sub-headings written inside cards as `h3` become correct by this
       * change rather than needing one of their own.
       */
      h('h2', {}, title),
      subtitle ? h('p', { class: 'small muted' }, subtitle) : null,
    ]),
    actions,
  ]);
}

/**
 * A button.
 *
 * `...rest` is spread **first** and `class` composed after it, and the order is
 * the whole correctness of this function. Written the other way round — the
 * composed class first, the spread last — `rest.class` silently replaces the
 * composed array, and a caller passing `class: 'btn--small'` gets an element
 * with no `btn` class at all: no pill, no background, no minimum height. Half
 * the call sites had learned to write `class: 'btn btn--small'` to compensate,
 * which is what a bug looks like once people have adapted to it.
 *
 * @param {Child} label
 * @param {{variant?: string, iconName?: string, onClick?: Handler,
 *          type?: string, class?: string, disabled?: boolean,
 *          [attr: string]: unknown}} [options]
 */
export function button(label, { variant, iconName, onClick, type = 'button', ...rest } = {}) {
  return h('button', {
    ...rest,
    type,
    class: ['btn', variant && `btn--${variant}`, rest.class],
    onClick,
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
    ...rest,
    type: 'button',
    class: ['btn', 'btn--icon', variant && `btn--${variant}`, rest.class],
    // An icon-only control is unlabelled to a screen reader without this.
    'aria-label': label,
    title: label,
    onClick,
  }, icon(name, { size: 20 }));
}

export function badge(label, tone = '') {
  return h('span', { class: ['badge', tone && `badge--${tone}`] }, label);
}

/**
 * @param {Child} label
 * @param {{pressed?: boolean, onClick?: Handler, iconName?: string}} [options]
 */
export function chip(label, { pressed, onClick, iconName } = {}) {
  return h('button', {
    type: 'button',
    class: 'chip',
    ...(pressed !== undefined ? { 'aria-pressed': String(Boolean(pressed)) } : {}),
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

  // An amount that is not a number is shown as what it says.
  //
  // `?? 0` covers a missing amount and does nothing for a hand-edited one:
  // `format('twenty thousand')` returns the string `₹NaN`, and that is what
  // the transaction list and the record showed. The three exports were fixed
  // one at a time — CSV, sheet, PDF — and this is the same value reached by a
  // fourth route, the one the household actually looks at.
  //
  // `cellFor` already shows an em dash for an amount that is absent. This is
  // the other case: an amount that is present and unreadable, where the text
  // in their sheet is the thing that tells them what to go and fix. Faint,
  // because it is not a figure and must not be read as one.
  if (!Number.isFinite(value)) {
    return h('span', { class: 'numeric faint' }, String(minor));
  }

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
    /*
     * `h2`, for the same reason `cardHeader` uses one.
     *
     * An empty state is often the only thing on a screen — an entity whose
     * list has no records shows the page's `h1` and then this. As an `h3`
     * that jumped a level on every such screen, which is where the browser
     * walk still found skips after the card headings were fixed. Inside a
     * card it now sits at the same level as the card's own heading rather
     * than a level below, which is true: both are sections of the page.
     *
     * `.empty h2` holds `--text-lg`, the size it had.
     */
    h('h2', {}, title),
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
  if (href) return h('a', { class: 'list-item', href }, children);
  if (!onClick) return h('div', { class: 'list-item' }, children);

  /*
   * `role="button"` is a promise to a screen reader that this behaves like a
   * button, and a div does not: it takes a click and ignores Enter and Space.
   * Nine callers were announced as buttons and operable only with a pointer.
   *
   * Space is prevented as well as handled — on a focused element it scrolls
   * the page, so acting *and* scrolling is the wrong pair.
   */
  return h('div', {
    class: 'list-item',
    role: 'button',
    tabindex: '0',
    onClick,
    onKeydown: (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onClick(event);
    },
  }, children);
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

/**
 * A horizontally scrolling row of cards, with snap points.
 *
 * ## Why this is a scroller and not a slider
 *
 * No JavaScript moves it. It is a scroll container with CSS snap points, so
 * the browser handles the drag, the momentum, the snap and the keyboard —
 * meaning it works with a thumb, a trackpad, a mouse wheel, arrow keys and a
 * screen reader's own navigation without any of that being re-implemented
 * badly here. A scripted carousel would have to reproduce all of it and would
 * get the accessibility wrong.
 *
 * `role="list"` and `listitem` because that is what it is: a list that happens
 * to scroll sideways. Without them a screen reader reads a run of links with
 * no sense of how many there are or where it is in them.
 *
 * @param {Child[]} items
 * @param {{label: string, class?: string}} options `label` is required — an
 *   unlabelled scroll region is announced as "region" and nothing else.
 */
export function carousel(items, { label, class: className }) {
  const present = (items ?? []).filter(Boolean);
  if (!present.length) return null;

  return h('div', {
    class: ['carousel', className],
    role: 'list',
    'aria-label': label,
    // Reachable by keyboard: a scroll container that cannot take focus cannot
    // be scrolled with the arrow keys by somebody not using a pointer.
    tabindex: '0',
  }, present.map((item) => h('div', { class: 'carousel-item', role: 'listitem' }, item)));
}

/**
 * One card in a wallet.
 *
 * A thing the household holds — an account, a policy, a document — reduced to
 * what identifies it, what it is worth or when it runs out, and how fresh that
 * is.
 *
 * `updated` is deliberately not optional-with-a-default. A card that shows a
 * figure without saying when it was true invites it to be read as live, and
 * nothing in this application is live: every number is as recent as the last
 * time somebody recorded something. Where there is no date to give, say so
 * rather than leaving the line off.
 *
 * @param {{
 *   title: Child, subtitle?: Child, value?: Child, meta?: Child,
 *   updated: Child, status?: {label: string, tone?: string},
 *   href?: string, tone?: string,
 * }} options
 */
export function walletCard({
  title, subtitle, value, meta, updated, status, href, tone,
}) {
  const body = [
    h('div', { class: 'wallet-card-top' }, [
      h('div', { class: 'spacer' }, [
        h('p', { class: 'wallet-card-title' }, title),
        subtitle ? h('p', { class: 'wallet-card-subtitle' }, subtitle) : null,
      ]),
      // Glyph and word, never colour alone.
      status ? badge(status.label, status.tone ?? '') : null,
    ]),

    value !== undefined && value !== null
      ? h('p', { class: 'wallet-card-value numeric' }, value) : null,
    meta ? h('p', { class: 'wallet-card-meta' }, meta) : null,
    h('p', { class: 'wallet-card-updated' }, updated),
  ];

  return href
    ? h('a', { class: ['wallet-card', tone && `wallet-card--${tone}`], href }, body)
    : h('div', { class: ['wallet-card', tone && `wallet-card--${tone}`] }, body);
}
