# Three screens that misled, found by walking the rest of them

The sweep that had covered twenty-four modules at 390px had never looked at
Timeline, Chat's empty state, or Investments with a portfolio in it. Each held
a defect, and none of them was a layout fault.

## A heading that had never once stuck

`js/modules/timeline.js` sets its day heading `position: sticky`, deliberately,
with the reason written beside it:

> Grouped by day, because "3 March" above a run of changes is how somebody
> reads a history, and a date repeated on every line is noise.

It had never stuck. `.card--flush` carried `overflow: hidden` — there so a
list's square corners stay inside the card's 22px radius — and `hidden` makes
an element a **scroll container**. `position: sticky` resolves against its
nearest scroll container, so the heading was pinned to a box that does not
itself scroll and rode off the top of the page with everything else.

| after scrolling 4,000px | before | after |
| --- | --- | --- |
| day heading top | **−3,673px** | **60px** |
| covered by the app header | fully hidden | **0px** |

`overflow: clip` clips identically and creates no scroll container. Thirty-eight
cards carry `card--flush` and the clipping is unchanged for every one of them.

The second half was `top: 0` under an app header that is itself sticky and
60px tall: a heading parked behind the header is the same as no heading. It is
now `calc(var(--header-height) + var(--inset-top))`, and it lives in CSS rather
than an inline style — a `calc()` in a style object is an English string as far
as `tools/strings.mjs` is concerned, and that ratchet may only fall.

## The same absence, stated twice

Chat with nothing in it drew **"No conversations yet"** in its own card, and
again 250px below inside the "Manage conversations" disclosure — same icon,
same heading — above two buttons wording one act differently: *Start a
conversation* and *Add the first conversation*.

The disclosure opened itself when there was nothing yet, and the comment saying
why was true when it was written:

> with none, this disclosure held the only way to make one, and the empty state
> above pointed at a control nobody could see.

That was fixed later by giving the empty state its own button, calling
`section.openForm()` — which raises a **modal**, so it works whether the
disclosure is open or shut. The `open` outlived its reason and nobody re-read
it. Two comments in one file, each correct on the day it was written, together
producing a screen that tells a household the same thing twice and asks them to
choose between two doors to one room.

The screen is 228px shorter and says it once.

## Two million percent, as the headline

The Investments screen printed:

    XIRR
    2117610.57%
    annualised

and badged a holding **116801.24% XIRR**. The arithmetic is right: one holding
had gained 576.67% over a short run, and annualising extrapolates that to a
year.

| | gain | XIRR before | after |
| --- | --- | --- | --- |
| Nifty index fund | 576.67% | 116,801.24% | *under a year* |
| Portfolio | +90.75% | **2,117,610.57%** | *not yet a year of transactions* |

What makes it a defect rather than an eccentricity is where it sat. Two lines
below the headline the same card says *"3 of 4 holdings have no transactions
recorded, so their figures are still the ones typed on the form"*, and the card
beneath says *"no interest rate is recorded"* rather than guess one. A screen
this careful about what it will not claim should not lead with a number no
household can use.

**The rule: a rate is annualised over a year, or it is not offered.** That is
the rule this application already applies elsewhere — it refuses to compare a
part-month of staff pay against a monthly agreement, and it measures mileage
only between two full tanks, "the only stretch where the fuel burned is known
exactly".

Not a plausibility band on the output. A threshold like *"hide anything over
1000%"* is a number chosen by hand, and it would still pass a 900% figure built
from eleven months while refusing a real one from a bad year.

Nothing true was withdrawn. The gain is still +576.67% on the holding and
+90.75% on the portfolio; only the extrapolation is gone, and the screen says
which of its two reasons it has for showing nothing — "not yet a year of
transactions" reads very differently from "needs dated transactions" to
somebody who has just started.

## What the checks measure

- **The heading** is read as geometry against the app header's own box rather
  than against a number written into the test, so changing the header's height
  moves both sides of the comparison. Guarded on the page being long enough to
  scroll a heading out of view, which is the only condition under which sticky
  means anything.
- **The empty state** is counted by walking up to the nearest `details` rather
  than by asking whether the node is visible. A closed `details` still reports
  a height and an `offsetParent` in this engine, so both of those measure
  nothing — worth writing down, because measuring nothing is the fault this
  suite keeps finding in itself.
- **The rate** is tested from both sides. A rule that refuses short spans is
  worthless if nothing is left that still earns a rate, and a check for the
  refusal alone would pass just as well on a screen that had stopped computing
  XIRR at all. Mutation-tested: restoring the old predicate fails the first
  test and passes the second.

## And two more, from the screens after those

### A placeholder that did not fit its own field

The assistant's field read *"Ask about spending, net worth, renewals, bills…"* —
four examples naming what it understands, which is the right idea. It needs
**320px** to render. The field offers **182px** at a 320px viewport and 252px
at 390px, the icon inside it taking the rest, so it clipped at every phone
width:

    Ask about spending, net worth, rene

The half that survived promised two topics; the half that did not was the point
of the sentence. It now reads *"Ask about your records…"*, which fits at 320px
with room to spare, and the six example questions below it — each a whole
question somebody can tap — carry what the long version was reaching for.

Measured against the field's own content box rather than by counting
characters, and at 320px, because that is where it fails first: a check written
at 390px would have passed the string that shipped.

### A button that was its own background

`.btn--subtle` paints itself `--surface-sunken`. `.card--quiet` paints its
background `--surface-sunken`. The same token — so a subtle button on a quiet
card was invisible by construction, not by accident.

Insurance's **"Open the estate review"**, measured:

| | before | after |
| --- | --- | --- |
| fill against its own ground | **1:1** | 1:1 |
| edge against its own ground | **none** (alpha 0) | **4.58:1** light, **6.03:1** dark |

A 44px tap target sitting in a paragraph with nothing to say it could be
tapped. Ten rules in `components.css` paint `--surface-sunken` and twenty-six
subtle buttons ship, so this was not one screen's bad luck.

The fix is the argument this repository already made for the navigation bar —
*"colour alone is not a distinction; the filled ground and the bar above the
icon are both shape, neither needs colour to be seen."* A button identifiable
only by a ground colour that can equal its parent's is exactly colour alone, so
it gets an edge instead.

**`--border` was tried first and does not work.** An edge that cannot be seen
is the same as no edge, and a non-text part of a control needs 3:1. Measured
against all three surfaces in both themes:

| token | range | |
| --- | --- | --- |
| `--border` | 1.14 – 1.36 | no |
| `--border-strong` | 1.54 – 1.94 | no |
| `--text-faint` | 4.58 – 6.46 | yes |

The check measures the better of fill and edge against whatever is actually
behind the button — walked up the tree, because the button's own parent is
usually transparent — and it is mutation-proven: removing the border takes the
reading from 4.58 to 1.
