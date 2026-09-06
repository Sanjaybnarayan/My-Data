# The Chosen One Faced Away

`css/components.css`, `js/ui/components/slidingrow.js`, the seven screens that
build a sliding row, and `tools/typecheck.mjs`.

## What was asked for

> "continue to work on horizontal circle slider scrollbar…it needs more design
> detailing…redesign it professionally…work on ui and ux…fix it neatly and
> implement it where all possible in all screens of app. may be horizontal or
> vertical…decide it neatly and implement it"

The wheel already existed. `docs/A_WHEEL_SEEN_EDGE_ON.md` built it for Finance's
two navigation rows and `docs/ONE_WHEEL_EVERYWHERE.md` rolled the turn out to
six more. So the work was to look at what shipped rather than to build it
again — and what shipped had the effect pointing the wrong way on the commonest
view of six screens.

## The wheel was turning the selection away from the reader

The wheel's entire stated purpose, in the file that draws it:

> The item in the middle faces you square and full size; the ones either side
> are turned away from you and stand back.

An item can only reach the middle if the row can scroll it there. The first
item never can. Measured at 390px with an 84px chip:

    centring the first chip wants   scrollLeft = -108px
    scroll offsets go negative at    never

So the first item sits at the left edge, where the wheel draws it turned
furthest away. Measured, at rest, with the first chip marked
`aria-current="page"`:

| chip | scale | opacity |
| --- | --- | --- |
| **1st — the chosen one** | **0.81** | 1 |
| 2nd | 0.98 | 0.97 |
| 3rd | 0.90 | 0.90 |
| 4th | 0.68 | 0.77 |

And most of these rows open on their first item: Settings on General, Health on
its first entity, every filter row in `js/modules/crud.js` on All. The
selection was drawn smaller and turned away from the reader, permanently, by
the effect whose job is to say which one is selected.

Finance never showed it because Finance has a 4.5rem gutter that lets its first
group reach the middle. The six rows the turn was rolled out to have no gutter,
and it went straight through.

### It was written down, and half-fixed

`css/components.css` already said this, in the comment above the `@media`
gate:

> the leftmost chip is drawn at the start of the timeline, smallest and turned
> furthest away, and the leftmost chip is usually the selected one. Identity
> showed "People" chosen and shrunken while "Employment history" sat square-on
> beside it, which is the opposite of what the wheel is for.

The fix applied was `@media (max-width: 900px)` — above 900px the rows do not
overflow, so the wheel is switched off and the defect goes with it. Below
900px the row really does slide, the gate lets the wheel through, and the
chosen chip is still turned away. Identity's "People" was fixed on a desktop
and left exactly as it was on a phone, which is the screen it was reported on.

### The fix

The chosen face does not turn. `nav-wheel-chosen` holds an identity transform
instead of carrying the geometry, so the selection stays square-on and full
size wherever it sits in the row, at every width, with no gutter and no script.

It reads as the selection standing out of the wheel toward you rather than
riding it, and the turn still belongs to everything you have *not* chosen —
which is the whole of what the effect was ever asked to say.

## The half of it that was never rolled out

Finance scrolls its chosen item to the middle on arrival, and has since the
wheel was written:

> a bookmark into Conflicts opens with Review under the rule and Conflicts on
> screen, rather than at a row scrolled to its start with the answer somewhere
> off to the right.

That is `reveal`, and it was a private function in
`js/modules/finance/sections.js`. The rollout copied the *turn* to six rows and
left it behind, so arriving at `#/settings/about` drew the row at position 0
with About off the right-hand edge: the screen said where you were everywhere
except in the control whose job is saying so.

`js/ui/components/slidingrow.js` is that function, moved out and given the two
things it needed to serve more than one caller — a way to find the chosen item
(`aria-current="page"` for a row of links, `aria-pressed="true"` for a row of
filters) and a `MutationObserver`, because most of these rows are repainted in
place and a row rebuilt under you keeps the scroll position the *previous*
selection earned.

Finance imports it now rather than defining it. Seven screens build their row
through `slidingRow` instead of by hand.

## The row the rollout missed

`docs/ONE_WHEEL_EVERYWHERE.md` counts seven sliding rows and treats six.

`.tabs` — Belongings' entity strip — is in the edge-fade list beside the chip
rows and Finance's pair, so it faded at its edges exactly like its neighbours,
and it was the only sliding row in the application never given the turn. Not
argued against anywhere: simply absent from the one `@supports` block that
grants it. A difference no amount of reading the rollout would surface and no
amount of looking at the two screens side by side would miss.

It joins on the same terms as the rest. The link keeps an untransformed 44px
box and a new `.tab-face` carries the rule, the colour and the turn, because
`getBoundingClientRect` reports the *transformed* size and a 44px control at
0.82 measures 36px and stops being a tap target.

## Horizontal or vertical

Asked, so: **horizontal only, and only on rows where the items are peers
competing for one selection.**

The wheel says *this is the one you have chosen and these are the ones you have
not*. That is a statement about a set of alternatives. Every horizontal slider
in this application is exactly that — entity tabs, section links, source
filters — and every vertical scroller is not:

| scroller | holds | wheel |
| --- | --- | --- |
| `.app-nav` | the module list, a set of destinations | no |
| `.modal-body` | the contents of one dialog | no |
| `.table-wrap--tall` | a household's own rows | no |
| `.virtual-viewport` | a long record list | no |
| `.carousel` | dashboard cards | no — see below |
| `.bottom-nav` | five fixed tabs | no — it never scrolls |

Turning a household's ledger rows in 3D as they scroll past would be motion
applied to their data, which is a different thing from motion applied to a
choice, and worse. The sidebar is a list of places to go rather than a set of
alternatives, and it is fully visible without scrolling at every width the
application is checked at.

`.carousel` stays excluded for the reason already recorded: it sets
`grid-auto-columns: 86%` so the next card always peeks past the edge, which is
a better cue than any gradient and is already why its bar is hidden.

`.bottom-nav` is a five-column grid with `grid-auto-columns: 1fr`. Nothing
slides, so there is no wheel to turn.

## Nobody who asked for less motion was getting less

`css/tokens.css` answers `prefers-reduced-motion: reduce` by collapsing the
duration tokens, under a comment that is unambiguous:

> A person who has asked for less motion gets none of it. Not "less" — none,
> because vestibular triggers are not a matter of degree.

That covers every `transition` in the application and nothing else. The wheel
is not a transition: it is a scroll-driven `animation`, and a scroll-driven
animation takes its progress from the scrollport rather than from
`animation-duration`, so zeroing the token never touched it.

Measured, the same eight-chip row at 390px under both settings:

    prefers-reduced-motion: no-preference   scales 0.57 – 0.98, opacity 0.72 – 0.97
    prefers-reduced-motion: reduce          scales 0.57 – 0.98, opacity 0.72 – 0.97

Byte-identical. Eight chips rotating in 3D as the row is dragged is exactly the
motion that sentence promises not to show, and it was showing on every sliding
row in the application.

The turn is gated on the preference now. The edge mask deliberately is not: it
moves no content, it says which side of the row has more, and a row silently
cut with no cue is a worse answer for everybody — including the person who
asked for less.

## A budget that could not see the failure that mattered

Making these changes broke `js/modules/calendar.js`: an import line inserted
into the middle of a multi-line `import { … }`. `tsc` stops semantic analysis
on a file it cannot parse, so the run went from 156 findings to **five**, all
of them parse errors on that one file, and `tools/typecheck.mjs` printed:

    5 type findings (budget 155)
    150 fewer than the budget — run with --update to lock it in

and exited 0. The application was broken — Calendar would not have loaded at
all — and the check that exists to catch that reported a pass with 150 to
spare. It was caught by the number being *too good*, which is not a method.

A budget compares against a ceiling, so the one failure it cannot see is the
one that makes the number smaller. `tools/typecheck.mjs` now exits 2 on any
TS1xxx, the syntax range, ahead of the budget comparison — the same way it
already refused to budget a configuration error.

`TS1064` is excluded by name and the exclusion is the interesting part. It is
the JSDoc complaint that an `async` function's `@returns` should be written
`Promise<T>`: filed in the syntax range, stops no parse, and this repository
carries two. Without the exclusion the guard fails on a clean tree, which is
how it was first written and how it was caught.

Both directions were run: a deliberate syntax error exits 2, the clean tree
exits 0.

## A scanner change that would have hidden a real sentence

`chosenIn` began as one selector list:

    row.querySelector('[aria-current="page"], [aria-pressed="true"]')

`tools/strings.mjs` counts a quoted literal containing a space as English
somebody might read, and that one has a space after the comma — so the unrouted
ratchet went up by one for a CSS selector.

The first fix was to widen the scanner's `machinery()` rule, which excludes
paths and selectors by their first character, to cover `[` as well. Checking
what that would stop counting found three literals, one of them:

    [${kind} removed]

which is a real sentence a person reads on the timeline. Widening the rule
would have quietly dropped it from the count of English that still needs
routing — a ratchet loosened to make one number go down.

So the code changed instead: two `querySelector` calls, neither literal
containing a space. The scanner is untouched and still counts what it should.

## Measured

| | before | after |
| --- | --- | --- |
| sliding rows with the turn | 6 of 7 | 7 of 7 |
| rows that centre their selection | 1 of 7 | 7 of 7 |
| chosen face, first position, 390px | 0.81 scale, turned 46° | 1.0, square-on |
| wheel under `reduced-motion: reduce` | full turn | none |
| copies of `reveal` | 1, private to Finance | 1, shared |
| typecheck passes with an unparseable file | yes | no |

## What is not fixed

The first item still cannot be scrolled to the geometric centre of its row —
that is arithmetic, not a bug, and `centreChosen` brings it as near as the row
allows. It no longer matters visually, because the chosen face no longer turns.

The wheel remains gated above 900px for the chip rows, where they do not
overflow and there is nothing to express. Finance's two rows are ungated
because their gutter makes them overflow at every width.
