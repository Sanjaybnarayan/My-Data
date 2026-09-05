/**
 * Finance's navigation: groups above, sections below, both sliding.
 *
 * This has been four shapes, and each failed for a reason worth keeping:
 *
 *   - seventeen chips in one row, which wrapped onto four lines on a phone
 *   - two rows of chips, the first governing the second — and drawn
 *     identically, so nothing said so. Tapping a chip in the top row silently
 *     replaced the row beneath it, which is not a thing a household should
 *     have to work out
 *   - a disclosure, which said nothing until it was opened
 *   - two lists side by side, which read well but sat at the foot of the hub
 *     rather than where navigation belongs
 *
 * So: two rows again, and this time they are not the same object twice. The
 * groups are tabs — a word with a rule under the chosen one, no border, no
 * fill. The sections are pills — bordered, and filled when chosen. One reads
 * as a heading, the other as a choice inside it, which is the whole thing the
 * chip pair could never say.
 *
 * Both rows slide. Seventeen sections do not fit across 390px and never will,
 * so the row scrolls sideways with snap points and the chosen item is scrolled
 * into view on arrival — a bookmark into Conflicts opens with Review under the
 * rule and Conflicts on screen, rather than at a row scrolled to its start
 * with the answer somewhere off to the right.
 */

import { h, replace } from '../../ui/dom.js';
import { t } from '../../core/locale.js';

/**
 * Bring the chosen item into view without moving the page.
 *
 * `scrollIntoView` on a horizontally scrolling row will happily scroll every
 * ancestor as well, which on arrival means the page jumps past the header to
 * put a chip in the middle of the screen. Setting the row's own `scrollLeft`
 * moves the one thing that should move.
 *
 * The wait is not optional. The first paint runs while the nav is still being
 * built and is not yet in the document, where `clientWidth` and `offsetLeft`
 * are both zero and the sum below is a confident nought — so a bookmark into
 * Disagreements opened with Review scrolled off the right edge, reading
 * "Rev". Every subsequent paint, from a tap, has a layout already and takes
 * the first branch.
 */
function reveal(row, item) {
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
 * The label, in a box of its own that can be turned without shrinking the
 * control around it.
 *
 * Both rows sit on a wheel: the item in the middle faces you and the ones
 * either side turn away and recede. That is a `rotateY` and a scale, and put
 * on the button itself it would take the *tap target* with it —
 * `getBoundingClientRect` reports the transformed box, so a 44px control
 * scaled to 0.85 measures 37px and is no longer one. The repository checks
 * that floor at 390px and 320px and would have caught it.
 *
 * So the button keeps its full size and does nothing but receive the tap; the
 * face inside it carries every visible thing — the pill, the rule, the turn.
 */
const face = (label) => h('span', { class: 'finance-nav-face' }, label);

/**
 * @param {string} active the section being shown
 * @param {Array<{id: string, label: string,
 *          tabs: Array<{id: string, label: string, href: string}>}>} groups
 */
export function sectionTabs(active, groups) {
  // Read from the section on screen rather than held as state: arriving at
  // `#/finance/loan` from a bookmark has to open Planned, the same as tapping
  // through to it would.
  let open = groups.find((group) => group.tabs.some((one) => one.id === active))
    ?? groups[0];

  const sections = h('div', {
    class: 'finance-nav-sections',
    role: 'group',
    'aria-label': t('finance.nav.sections'),
  });

  const tabs = h('div', {
    class: 'finance-nav-groups',
    role: 'group',
    'aria-label': t('finance.nav.groups'),
  }, groups.map((group) => h('button', {
    type: 'button',
    class: 'finance-nav-group',
    'aria-pressed': String(group.id === open.id),
    onClick: () => { open = group; paint(); },
  }, face(group.label))));

  function paint() {
    for (const [index, button] of [...tabs.children].entries()) {
      button.setAttribute('aria-pressed', String(groups[index].id === open.id));
    }

    // Anchors, with no click handler over the top of them. The hash router
    // already listens for the navigation these produce, and intercepting it
    // would only take away the long-press and middle-click a real link has.
    replace(sections, open.tabs.map((one) => h('a', {
      class: 'finance-nav-section',
      href: one.href,
      ...(one.id === active ? { 'aria-current': 'page' } : {}),
    }, face(one.label))));

    reveal(tabs, tabs.children[groups.indexOf(open)]);
    reveal(sections, sections.querySelector('[aria-current="page"]'));
  }

  paint();
  return h('nav', { class: 'finance-nav', 'aria-label': t('finance.title') }, [tabs, sections]);
}
