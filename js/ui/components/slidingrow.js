/**
 * The behaviour half of the wheel: bringing the chosen item into the middle.
 *
 * `css/components.css` draws the wheel — the item at the centre of the row
 * faces you square-on, the ones either side turn away and stand back. That is
 * a scroll-driven animation and it needs no script at all.
 *
 * What it cannot do is *scroll*. A row arrives at whatever position the
 * browser gives it, which is the start, and the wheel then faithfully draws
 * the chosen item turned away at the left edge — which is the exact opposite
 * of what a wheel is for. `docs/ONE_WHEEL_EVERYWHERE.md` rolled the turn out
 * to seven rows and left this behind in Finance, where it was written:
 *
 *   - Finance imports `reveal` from here now rather than defining it
 *   - every other sliding row gets it for the first time
 *
 * Measured before the change, on a 390px viewport with the first chip chosen —
 * which is the commonest case, because most of these rows open on their first
 * item: the chosen face sat at **0.81 scale**, turned 46° away, permanently,
 * while the chip beside it sat square-on at 0.98.
 */

import { h } from '../dom.js';

/**
 * Borrowed rather than restated. Written out again here — the same
 * `string|number|Node|null|undefined|Child[]` union `basics.js` carries — it is
 * a type alias that references itself, which `tsc` rejects outright rather than
 * budgets.
 *
 * @typedef {import('./basics.js').Child} Child
 */

/**
 * Bring the chosen item into view without moving the page.
 *
 * `scrollIntoView` on a horizontally scrolling row will happily scroll every
 * ancestor as well, which on arrival means the page jumps past the header to
 * put a chip in the middle of the screen. Setting the row's own `scrollLeft`
 * moves the one thing that should move.
 *
 * The wait is not optional. The first paint runs while the row is still being
 * built and is not yet in the document, where `clientWidth` and `offsetLeft`
 * are both zero and the sum below is a confident nought — so a bookmark into
 * Disagreements opened with Review scrolled off the right edge, reading
 * "Rev". Every subsequent paint, from a tap, has a layout already and takes
 * the first branch.
 *
 * @param {Element | null | undefined} row
 * @param {HTMLElement | null | undefined} item
 */
export function reveal(row, item) {
  if (!row || !item) return;
  const put = () => {
    row.scrollLeft = Math.max(0,
      item.offsetLeft - (row.clientWidth - item.offsetWidth) / 2);
  };

  // Every paint after the first is a tap on a row already on screen.
  if (row.clientWidth) {
    put();
    return;
  }

  // The first is not. Guessing at a frame count was the version before this
  // one, and it was wrong twice: three frames guessed too few, and the guard
  // meant to stop the retry looping read `isConnected` on a node that is
  // legitimately detached at that moment, so it never retried at all. This
  // waits for the one event it is actually waiting for.
  const Watch = globalThis.ResizeObserver;
  if (!Watch) return;
  const watch = new Watch(() => {
    if (!row.clientWidth) return;
    watch.disconnect();
    put();
  });
  watch.observe(row);
}

/**
 * The item a row is currently on.
 *
 * Two attributes, because these rows are two different things wearing the same
 * clothes. A row of links to other screens marks its destination with
 * `aria-current="page"` — Settings' sections, Health's entities. A row of
 * filters over the list below it marks its choice with `aria-pressed="true"` —
 * Calendar's sources. Both are "the one you are on"; only the reason differs.
 *
 * Two queries rather than one selector list, which is not a style choice.
 * `tools/strings.mjs` counts a quoted literal containing a space as English
 * somebody might read, and `'[aria-current="page"], [aria-pressed="true"]'`
 * has one after the comma — so the combined form put the unrouted ratchet up
 * by one for a CSS selector. Widening the scanner's `machinery()` rule to
 * exclude anything starting with `[` was the first fix and was wrong: it would
 * also have stopped counting `[${kind} removed]`, which is a real sentence a
 * person reads on the timeline.
 *
 * @param {Element} row
 */
export function chosenIn(row) {
  const current = /** @type {HTMLElement | null} */ (row.querySelector('[aria-current="page"]'));
  if (current) return current;

  /*
   * One pressed chip is a selection. Six are a set of switches.
   *
   * Calendar's source row is six chips, every one of them `aria-pressed="true"`
   * because every source is on by default — `docs/ONE_WHEEL_EVERYWHERE.md`
   * records the row reading 1 – 1 opacity for exactly this reason. Taking the
   * first pressed chip as "where you are" would have scrolled that row back to
   * its first chip every time somebody switched a source off, which is a row
   * yanking itself out from under the finger that just tapped it.
   *
   * There is no "the one you are on" in a row where several are on, so there
   * is nothing to centre and this says so rather than guessing.
   */
  const pressed = row.querySelectorAll('[aria-pressed="true"]');
  return pressed.length === 1 ? /** @type {HTMLElement} */ (pressed[0]) : null;
}

/**
 * Centre whatever the row is currently on.
 *
 * @param {Element} row
 */
export function centreChosen(row) {
  reveal(row, chosenIn(row));
}

/**
 * A row that slides, with its chosen item brought to the middle.
 *
 * Seven screens built this row by hand — `h('div', { class: 'chip-row
 * chip-row--scroll', … }, chips)` — and each got the wheel from the stylesheet
 * and none of them got the scroll. Arriving at `#/settings/privacy` drew the
 * row at its start with Privacy off the right-hand edge: the screen told you
 * where you were everywhere except in the control whose whole job is saying
 * so.
 *
 * The centring is re-run when the row's children change, because most of these
 * rows are repainted in place — `replace(row, …)` swaps the chips when a
 * filter is tapped, and the new chosen chip has to come to the middle the same
 * way the first one did.
 *
 * @param {Record<string, unknown>} props
 * @param {Child} children
 */
export function slidingRow(props, children) {
  const extra = props.class ? [props.class] : [];
  const row = h('div', { ...props, class: ['chip-row', 'chip-row--scroll', ...extra] }, children);

  centreChosen(row);

  /*
   * A repaint swaps the chips out from under us.
   *
   * Most of these rows are rebuilt in place rather than re-created — Finance
   * calls `replace(sections, …)` when a group is tapped, and a filter row
   * re-renders when its list changes. Without this the row keeps the scroll
   * position the *previous* selection earned.
   *
   * `attributeFilter` because a row can also change selection without changing
   * children: tapping a filter flips `aria-pressed` on chips that are already
   * there. Centring only ever sets `scrollLeft`, which mutates nothing, so
   * there is no loop to guard against.
   */
  const Watch = globalThis.MutationObserver;
  if (Watch) {
    new Watch(() => centreChosen(row)).observe(row, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-current', 'aria-pressed'],
    });
  }

  return row;
}
