# UI Accessibility

What is implemented, what is measured, and what is missing. Nothing here is
claimed on the strength of an attribute being present in the source — where a
line says *measured*, a check measures it.

## Measured

**Touch targets — 44×44 CSS pixels, every control.** `tests/browser.mjs` drives
a real Chromium at 390×844 across eleven screens, reads the rendered box of
every button, link, input and select, and fails the build on anything under
44px in either dimension. It also asserts the sweep saw at least fifteen kinds
of control, because a sweep that measures nothing reports no failures.

This is the standard the application states, and it is stricter than WCAG 2.2
AA (2.5.8 asks 24×24). It matches AAA 2.5.5.

Before the sweep existed, 18 of 23 kinds of control were under it and three
were under 24px. The rule that was supposed to enforce it sat in `css/base.css`
and lost the cascade to `css/components.css`, so it applied to nothing. The
comment above it had been true of nothing since it was written — which is the
argument for measuring rather than declaring.

**No horizontal overflow on a phone.** Also measured in `tests/browser.mjs`,
and it names the widest offending element rather than reporting that
"something" is too wide.

## Implemented

**Reduced motion.** `prefers-reduced-motion: reduce` sets every duration token
to `0.01ms` — none, not less. Vestibular triggers are not a matter of degree.
The sync-pill spinner is stopped explicitly.

**Forced colours.** Under `forced-colors: active` the shadows are removed and
`--border` becomes `CanvasText`, so Windows high-contrast supplies its own
palette instead of fighting the app's.

**Colour is never the only signal.**

| Meaning | Colour | Also |
| --- | --- | --- |
| Today, in the calendar | accent | a border, and a bolder number |
| A selected tab | accent | weight, and a rule under it |
| A due or overdue item | warning / danger | the `dueBadge` text |
| A sync problem | danger | the pill's own words |
| A chart series | 8 series tokens | a legend with labels |

**Focus is visible.** `:focus-visible` in `css/base.css` draws the ring, and it
is `:focus-visible` rather than `:focus` so a mouse user does not see one on
every click.

**Dialogs trap focus.** `trapFocus` in `js/ui/dom.js` keeps Tab inside an open
modal and releases it on close. Without it, tabbing walks into the page behind,
which for a screen-reader user means the dialog silently ceases to exist.

**The drawer returns focus.** Closing it moves focus back to the button that
opened it, when focus was still inside.

**Toasts reach a live region.** A screen reader does not see a toast appear, so
`announce()` says it. Errors are announced assertively; everything else
politely.

**Icon-only controls are labelled.** `iconButton` sets `aria-label` and `title`
from one argument, so an unlabelled icon button is not a thing a caller can
accidentally build.

**An error toast has no timer.** It stays until dismissed, because a message
somebody has to read must not disappear while they are reading it. Its ✕ is a
real target — 32×32, and 44×44 on touch.

**16 distinct `aria-*` attributes** are in use: `atomic`, `busy`, `current`,
`describedby`, `expanded`, `hidden`, `invalid`, `label`, `labelledby`, `live`,
`modal`, `pressed`, `sort`, `valuemax`, `valuemin`, `valuenow`.

**A skip link** is the first focusable element on the page.

**Masked values are not hidden by colour.** A masked identifier renders as
`XXXX 1234` or `••••••••` — an actual change of characters, not a low-contrast
treatment — and its title says how to see it in full.

## Not implemented

**No screen-reader run has ever happened.** No TalkBack, no NVDA, no VoiceOver.
Every accessibility claim above is either measured mechanically or read from
the source. Mechanical checks cannot tell you whether a screen is *usable*,
only whether particular defects are absent, and the difference between those
two is exactly where real accessibility problems live.

**No automated contrast check.** The token file states every text pair meets
WCAG AA in both themes. Nothing verifies it, and one pair is already suspect:
`js/ui/components/basics.js` paints `#fff` on a gradient built from `--accent`,
which is the light `blue-300` in dark mode.

**Tables scroll horizontally on a narrow screen** rather than becoming a card
list.

**No keyboard shortcuts and no roving tabindex** in the bottom navigation or
the tab strips; both are plain link lists, which works but is not the pattern a
screen-reader user expects from a tab set. The tab strip in
`js/modules/belongings.js` uses links rather than `role="tablist"`, which is
honest — they are navigation, not tabs over one panel — but it means the
`.tab--active` state is carried by `aria-current` alone.

**No reduced-transparency handling** (`prefers-reduced-transparency`).

## If you are adding a screen

1. Interactive things must be `<button>` or `<a>`. A `<div>` with an `onClick`
   is not reachable by keyboard, and the tap-target sweep will not see it
   either — it looks for real controls.
2. An icon-only control goes through `iconButton`, which forces a label.
3. Anything that appears without a navigation — a toast, an inline error —
   goes through `announce()`.
4. Do not encode a state in colour alone. Add the word, the border or the
   weight.
5. Add your control's selector to the touch block at the end of
   `css/components.css`, then let `tests/browser.mjs` confirm the size rather
   than assuming it.
