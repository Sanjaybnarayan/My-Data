/**
 * Transient messages.
 *
 * Bound to the bus, so any layer can report something without a reference to
 * the view.
 *
 * Two kinds stay until dismissed: an **error**, because "Saved" that needs a
 * click is worse than no message at all but an error somebody has to read is
 * the opposite; and anything carrying an **action**, because a button on a
 * timer is not an offer — the Undo after deleting a record used to expire in
 * four seconds, which is long enough to read the sentence and not long enough
 * to reach the button beside it.
 *
 * A plain confirmation still clears itself, and that half is checked too. The
 * fix for a timer on the wrong toast is not to stop having timers.
 */

import { h, announce } from '../dom.js';
import { icon } from '../icons.js';
import { t } from '../../core/locale.js';
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
  /*
   * An error the user has to read gets no timer; anything else clears itself.
   *
   * And so does anything offering an action, which used not to be true. A
   * toast with a button is the only way to reach what it offers, so a timer on
   * it is a four-second window to notice the button, decide, and hit it —
   * and for somebody tabbing towards it, or waiting to be told it is there,
   * four seconds is not an offer. Both actionable toasts in `app.js` already
   * passed `ms: 0` by hand; the Undo after deleting a record did not, so the
   * one offer a household is most likely to want back was the one that
   * expired on its own.
   *
   * Decided here rather than at that call site, so the next actionable toast
   * does not have to remember.
   */
  const duration = ms ?? (kind === 'error' || action ? 0 : 4000);

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
  /*
   * Screen readers do not see a toast appear; the live region tells them.
   *
   * Including what it offers, which it did not. `announce(message)` said
   * "Person deleted" and stopped there, so the button beside it was
   * announced to nobody — the one person who cannot see an Undo was also the
   * one never told it existed. The action is the whole point of the toast
   * that carries one.
   */
  announce(
    action ? t('toast.withAction', { message, action: action.label }) : message,
    kind === 'error',
  );

  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

/** Wire the bus once, at boot. */
export function mountToasts() {
  return bus.on(TOPIC.toast, (payload) => {
    // Both paths return nothing. The string branch used to `return toast(...)`,
    // handing back a dismiss function that the bus discards — so one path
    // produced a value and the other did not, for no reason either could act on.
    if (typeof payload === 'string') toast(payload);
    else toast(payload.message, payload);
  });
}
