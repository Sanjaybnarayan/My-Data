/**
 * Dialogs.
 *
 * Focus is moved in on open and restored on close, focus is trapped while
 * open, Escape closes, and the page behind does not scroll. Those four things
 * are what separate a dialog from a div that looks like one, and each of them
 * is invisible until somebody using a keyboard or a screen reader hits it.
 */

import { h, trapFocus, focus } from '../dom.js';
import { icon } from '../icons.js';
import { button } from './basics.js';

let openCount = 0;

/**
 * @param {{title: string, body: Node, footer?: Node, wide?: boolean,
 *          onClose?: Function, dismissable?: boolean}} options
 * @returns {{node: Node, close: Function}}
 */
export function modal({
  title, body, footer, wide = false, onClose, dismissable = true,
}) {
  const previouslyFocused = document.activeElement;

  const dialog = h('div', {
    class: ['modal', wide && 'modal--wide'],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'modal-title',
  }, [
    h('div', { class: 'modal-header' }, [
      h('h2', { id: 'modal-title' }, title),
      dismissable
        ? h('button', {
          type: 'button',
          class: 'btn btn--icon',
          'aria-label': 'Close',
          onClick: () => close(),
        }, icon('close'))
        : null,
    ]),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-footer' }, footer) : null,
  ]);

  const scrim = h('div', {
    class: 'scrim',
    onClick: (event) => {
      if (dismissable && event.target === scrim) close();
    },
  }, dialog);

  const releaseTrap = trapFocus(dialog);

  const onKeydown = (event) => {
    if (event.key === 'Escape' && dismissable) {
      event.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKeydown);

  function close(result) {
    document.removeEventListener('keydown', onKeydown);
    releaseTrap();
    scrim.remove();
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) document.body.style.removeProperty('overflow');
    // Returning focus to where it came from is what keeps a keyboard user's
    // place in the list they opened the dialog from.
    if (previouslyFocused?.isConnected) focus(previouslyFocused);
    onClose?.(result);
  }

  document.body.append(scrim);
  openCount += 1;
  document.body.style.overflow = 'hidden';

  // First field if there is one, otherwise the dialog itself.
  const firstField = dialog.querySelector('input, select, textarea, button:not([aria-label="Close"])');
  focus(firstField ?? dialog);

  return { node: scrim, close };
}

/**
 * A yes/no question. Resolves true or false — never leaves the caller
 * guessing, and the destructive answer is never the default focus.
 */
export function confirm({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false,
}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const { close } = modal({
      title,
      body: h('p', {}, message),
      footer: [
        button(cancelLabel, { variant: 'subtle', onClick: () => { finish(false); close(); } }),
        button(confirmLabel, {
          variant: danger ? 'danger' : 'primary',
          onClick: () => { finish(true); close(); },
        }),
      ],
      onClose: () => finish(false),
    });
  });
}

/** A single-question prompt, used for renames and quick entry. */
export function prompt({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    const input = h('input', { class: 'input', value, placeholder, id: 'prompt-input' });
    const submit = () => { finish(input.value.trim() || null); close(); };

    const { close } = modal({
      title,
      body: h('div', { class: 'field' }, [
        h('label', { class: 'field-label', for: 'prompt-input' }, label),
        input,
      ]),
      footer: [
        button('Cancel', { variant: 'subtle', onClick: () => { finish(null); close(); } }),
        button(confirmLabel, { variant: 'primary', onClick: submit }),
      ],
      onClose: () => finish(null),
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
  });
}
