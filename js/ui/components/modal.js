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

/**
 * Every dialog currently on screen, oldest first.
 *
 * A count would do for the scroll lock, but two other things need the dialogs
 * themselves. Android's back button has to close the top one — a WebView has
 * no Escape key, so back *is* the dismiss gesture there — and the router has
 * to close all of them when it leaves, because the scrim is appended to
 * `document.body` and nothing in a route change would otherwise remove it.
 */
const openDialogs = [];

/**
 * Ids for the parts of a dialog that another element has to point at.
 *
 * They cannot be constants, because this module stacks dialogs on purpose and
 * an id is a promise to be the only one. `aria-labelledby="modal-title"`
 * resolves through `getElementById`, which returns the **first** match in the
 * document — so with two dialogs open the one on top was announced with the
 * name of the one underneath it.
 *
 * Settings → Connection → *Changes that could not be sent* → **Discard**
 * reaches it in three clicks: the confirmation asking whether to throw a
 * pending change away announced itself as "Changes that could not be sent".
 * A destructive confirmation is the worst thing in the application to
 * mislabel, and nothing said so, because every check on these dialogs read
 * their text and none asked what they are called.
 *
 * `prompt` had the same fault in `for="prompt-input"`, where two stacked
 * prompts would put the label on the first one's field. No path reaches that
 * today — every `prompt` in the tree is awaited before the next opens — so it
 * is fixed as the same construction rather than as a demonstrated fault.
 */
let dialogSeq = 0;
// The increment is a statement rather than part of the template because
// `${dialogSeq += 1}` reads to `tools/strings.mjs` as a sentence — two words
// and a space — and an id template is not English anybody can translate.
function nextId(prefix) {
  dialogSeq += 1;
  return `${prefix}-${dialogSeq}`;
}

/**
 * `body` and `footer` take what `h()` takes: a node, or a list of them. Every
 * caller in the tree passes a list of buttons for the footer, and typing it as
 * a single node meant each of them carried a type finding for doing the
 * ordinary thing.
 *
 * @param {{title: string, body: Node|Node[], footer?: Node|Node[],
 *          wide?: boolean, onClose?: Function, dismissable?: boolean}} options
 * @returns {{node: Node, close: Function}}
 */
export function modal({
  title, body, footer, wide = false, onClose, dismissable = true,
}) {
  const previouslyFocused = document.activeElement;
  const titleId = nextId('modal-title');

  const dialog = h('div', {
    class: ['modal', wide && 'modal--wide'],
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': titleId,
    /*
     * So the fallback below can actually land. `focus(firstField ?? dialog)`
     * says plainly what it means to do when a dialog has no field in it, and
     * a `div` with no `tabindex` is not focusable — `.focus()` on one is a
     * silent no-op, so focus stayed on whatever was behind the dialog while
     * an `aria-modal` element covered the page.
     *
     * Reachable wherever a dialog's only control is its own Close button,
     * which the `firstField` selector excludes on purpose: Settings → Data →
     * *Check for broken links* on a database with none, and every dialog
     * whose body is an `empty()` — "Nothing stuck", "Nothing deleted",
     * "Nothing has conflicted".
     *
     * `-1` rather than `0`: reachable by script, never a stop in the Tab
     * order. `trapFocus` excludes `[tabindex="-1"]` from its cycle for the
     * same reason.
     *
     * This is the router fault in `docs/KEYBOARD_NAVIGATION.md` with the
     * halves swapped. There, `tabindex="-1"` was set and nothing ever focused
     * it. Here, something focuses it and the attribute was never set.
     */
    tabindex: '-1',
  }, [
    h('div', { class: 'modal-header' }, [
      h('h2', { id: titleId }, title),
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
    // Idempotent, because `close` now has more than one caller: the dialog's
    // own buttons, and `closeAllModals` from the router. Without the guard a
    // button that navigates and then closes itself would fire `onClose` twice
    // and take a second dialog's entry off the stack with it.
    const at = openDialogs.indexOf(handle);
    if (at === -1) return;
    openDialogs.splice(at, 1);

    document.removeEventListener('keydown', onKeydown);
    releaseTrap();
    scrim.remove();
    if (openDialogs.length === 0) document.body.style.removeProperty('overflow');
    // Returning focus to where it came from is what keeps a keyboard user's
    // place in the list they opened the dialog from.
    if (previouslyFocused?.isConnected) focus(previouslyFocused);
    onClose?.(result);
  }

  const handle = { node: scrim, close, dismissable };

  document.body.append(scrim);
  openDialogs.push(handle);
  document.body.style.overflow = 'hidden';

  // First field if there is one, otherwise the dialog itself.
  const firstField = dialog.querySelector('input, select, textarea, button:not([aria-label="Close"])');
  focus(firstField ?? dialog);

  return handle;
}

/**
 * Close the dialog on top, the way Escape does. Returns false when there was
 * nothing to close, or when the top dialog refuses to be dismissed — the
 * caller then does whatever it would have done anyway.
 */
export function closeTopModal() {
  const top = openDialogs.at(-1);
  if (!top || !top.dismissable) return false;
  top.close();
  return true;
}

/**
 * Close every dialog, dismissable or not.
 *
 * For leaving the screen underneath. A dialog that outlives the screen it was
 * opened from sits over a page it was never about, with the scroll lock still
 * on and focus still trapped inside it — and if it was a confirmation, its
 * buttons still act. Closing without a result is the safe answer: `confirm`
 * resolves false and `prompt` resolves null.
 */
export function closeAllModals() {
  // Copied, and from the end: `close` splices the live array.
  for (const dialog of [...openDialogs].reverse()) dialog.close();
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

/**
 * A statement, with one way out.
 *
 * Separate from `confirm` because a dialog offering a choice that does not
 * exist is worse than no dialog: a Delete button on a delete that will be
 * refused teaches somebody that the button lies. Used where a rule has already
 * decided, and the screen's job is to say what it decided and why.
 */
export function inform({ title, message, dismissLabel = 'Close' }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    const { close } = modal({
      title,
      body: h('p', {}, message),
      footer: [button(dismissLabel, { variant: 'primary', onClick: () => { finish(); close(); } })],
      onClose: finish,
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

    const inputId = nextId('prompt-input');
    const input = h('input', { class: 'input', value, placeholder, id: inputId });
    const submit = () => { finish(input.value.trim() || null); close(); };

    const { close } = modal({
      title,
      body: h('div', { class: 'field' }, [
        h('label', { class: 'field-label', for: inputId }, label),
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
