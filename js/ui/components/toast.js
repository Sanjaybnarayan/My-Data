/**
 * Transient messages.
 *
 * Bound to the bus, so any layer can report something without a reference to
 * the view. Errors stay until dismissed; confirmations do not, because
 * "Saved" that needs a click is worse than no message at all.
 */

import { h, announce } from '../dom.js';
import { icon } from '../icons.js';
import { bus, TOPIC } from '../../core/bus.js';

let host = null;

function ensureHost() {
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'region', 'aria-label': 'Notifications' });
    document.body.append(host);
  }
  return host;
}

const ICONS = { info: 'info', success: 'check', error: 'alert', warning: 'alert' };

/**
 * @param {string} message
 * @param {{kind?: 'info'|'success'|'error'|'warning', ms?: number,
 *          action?: {label: string, onClick: Function}}} [options]
 */
export function toast(message, { kind = 'info', ms, action } = {}) {
  const parent = ensureHost();
  // An error the user has to read gets no timer; anything else clears itself.
  const duration = ms ?? (kind === 'error' ? 0 : 4000);

  let timer = null;
  const node = h('div', { class: ['toast', kind !== 'info' && `toast--${kind}`] }, [
    icon(ICONS[kind] ?? 'info', { size: 18 }),
    h('span', { class: 'spacer' }, message),
    action
      ? h('button', {
        type: 'button',
        onClick: () => { action.onClick(); dismiss(); },
      }, action.label)
      : null,
    duration === 0
      ? h('button', { type: 'button', 'aria-label': 'Dismiss', onClick: () => dismiss() }, '✕')
      : null,
  ]);

  function dismiss() {
    clearTimeout(timer);
    node.remove();
  }

  parent.append(node);
  // Screen readers do not see a toast appear; the live region tells them.
  announce(message, kind === 'error');

  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

/** Wire the bus once, at boot. */
export function mountToasts() {
  return bus.on(TOPIC.toast, (payload) => {
    if (typeof payload === 'string') return toast(payload);
    toast(payload.message, payload);
  });
}
