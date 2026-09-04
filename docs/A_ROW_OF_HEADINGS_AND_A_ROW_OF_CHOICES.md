# A Row Of Headings And A Row Of Choices

`js/modules/finance/sections.js`, `js/modules/finance.js`,
`css/components.css`, `tests/browser.mjs`.

## What was reported

> "Finance two rows at top is quite confusing its not user's friendly"

Finance has seventeen sections. The module had carried them in a row of chips,
which wrapped onto four lines on a phone; then in two rows of chips, the first
governing the second; then behind a disclosure; then as two lists at the foot
of the hub. This is the fifth shape, and it is the second one that is two rows
— so the interesting question is not *how many rows* but what went wrong with
the pair the first time.

## What was actually wrong

Nothing about having two rows. **They were drawn identically.**

Both were `.chip-row`s of `.chip`s: same border, same fill when pressed, same
size, same shape. So the screen said the two rows were two of the same kind of
thing — five destinations above, then some more destinations below — while the
code said something else entirely: tapping in the top row *navigated nowhere*
and silently replaced the contents of the row beneath it.

A household had to discover that by tapping and watching. That is the fault.
A control that changes something elsewhere on the screen, drawn as though it
were a control that takes you somewhere, teaches nothing on sight and has to
be learned by accident.

## What changed

The rows stayed. The drawing did not.

- **Groups are tabs.** A word, and a 2px rule under the open one. No border,
  no fill, no rounded corner — nothing that reads as a thing you land on.
  Faded when not open, so the row reads as *one heading with alternatives*.
- **Sections are pills.** Bordered, rounded to 999px, and filled with the
  accent when it is the section you are on.

One is a heading you are under. The other is where you are. That difference is
the whole change, and it is why the same two rows now say what they do.

Both rows slide sideways with scroll snapping and no visible scrollbar, and
neither wraps: seventeen sections do not fit across 390px and never will.

The rows sit above **every** screen in the module, not just the hub. The
previous shape had put the map at the foot of the Overview, which is a fine
place for a table of contents and the wrong place for navigation — from a
section screen you had to go back to the hub and scroll to the bottom to reach
another section. Two rows above the screen make every section two taps from
every other, which is what the chip rows were for in the first place.

With the rows on every screen, the `back` link added to `pageHeader` for the
previous shape had nothing left to do, and was removed along with the option.

## Two things that passed while measuring nothing

**A class name collision, found by a screenshot.** The rows were `.nav-group`
and `.nav-section` for an afternoon. `.nav-group` is already the class the
shell's sidebar uses for its module list (`js/ui/shell.js`, `css/base.css`),
and `css/components.css` loads after `css/base.css` — so every module link in
the desktop rail quietly acquired a 44px floor, a `white-space: nowrap`, a 2px
transparent bottom border and a `-1px` margin pull. No test failed. Nothing
logged. The rules are now `finance-` prefixed.

**A reveal that revealed nothing.** Arriving at `#/finance/conflicts` has to
open the Review group *and scroll the top row far enough to show it* — Review
is the fifth of five and does not fit. The first version set `scrollLeft`
during the first paint, which runs while the nav is still being assembled and
is not yet in the document: `clientWidth` and `offsetLeft` are both zero
there, and the arithmetic produces a confident nought. The screenshot showed
the open tab as the word "Rev" against the right edge.

The two repairs that did not work are worth keeping:

1. Retrying for a fixed number of animation frames — a guess, and the wrong
   one.
2. Guarding that retry with `row.isConnected !== false`, which reads
   `isConnected` on a node that is *legitimately detached at that exact
   moment*, so the retry never armed at all.

It now waits on a `ResizeObserver` for the row's first non-zero width, which
is the event it was always waiting for. Every later paint comes from a tap on
a row already on screen and takes the immediate branch.

The check that was supposed to catch this measured the **sections** row, which
for Review happens to fit — so it read zero, passed, and said nothing about
the row that had failed. It now measures the groups row, and asserts the row
overflows before asserting it scrolled: a check that the row moved is worth
nothing on a row that never needed to.

## Two things the checks caught

The suite that already existed found both of these before a household could,
and both were mine:

**A 40px pill.** The section pills were `min-height: 40px`, which is a number
I picked because it looked right. The repository measures tap targets rather
than claiming them, and 44 is the floor — the check named the element, the
screen and the size.

**White text on a light blue.** The current pill was `color: var(--on-accent,
#fff)`, a token I invented and then quietly fell back from. `--accent` is a
*light* blue in dark mode, so white on it measures 2.23:1 against the 4.5 this
repository holds itself to. The token for exactly this already existed —
`--accent-contrast`, which `.btn--primary` has used all along and which is
`#ffffff` in light and `--grey-950` in dark. The fallback made the mistake
invisible to CSS and left it to the contrast check to find. It now measures
8.53:1.

The pattern in both: a number or a name chosen by eye where the repository
already had a measured one.

## What the checks hold

In `tests/browser.mjs`, at 390px:

- The two rows are drawn differently, in computed style — an open group is
  transparent, square-cornered and ruled; a current section is filled and
  rounded. If they ever converge again these fail.
- Exactly one group is open, and the others differ from it in colour.
- Both rows have `overflow-x: auto`, and the page itself does not scroll
  sideways.
- The pair fits under 130px of header.
- Both rows carry an `aria-label`, since neither is nameable from its contents.
- **Reachability, driven rather than snapshotted**: only the open group's
  sections are in the DOM, so the check clicks through all five groups and
  collects what appears, then compares that against every Finance entity in
  the schema. A section added later cannot go quietly unreachable.
- Arriving by deep link opens the right group, marks the right section, and
  has scrolled the top row to show it.
