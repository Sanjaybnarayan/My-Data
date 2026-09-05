# Four Tenths of a Pixel

`css/base.css`, `tests/browser.mjs`.

## What it looked like

The application's own navigation, on every screen in it:

    Dashboar        Notification
       d                  s

"Dashboard" broken after eight letters, orphaning a `d`. "Notifications"
orphaning an `s`. At 320px, 360px and 390px — which is to say on almost every
phone anybody has.

It was found by taking a screenshot. Eight hundred and eighty-one browser
checks did not see it, including one written specifically to catch labels that
cannot be read.

## Why

A tab is a fifth of the bar. Measured, at each width, against what the word
actually needs:

| width | tab | label box | "Dashboard" needs | short by |
| --- | --- | --- | --- | --- |
| 320px | 55px | 47px | 61.6px | 14.4px |
| 360px | 63px | 55px | 61.6px | 6.4px |
| **390px** | 69px | **61px** | **61.6px** | **0.4px** |
| 430px | 77px | 62px | 61.6px | fits |

At 390px the word was **four tenths of a pixel** too wide, and
`overflow-wrap: anywhere` did the rest.

The horizontal padding was the only room there was to give, and it costs
nothing: a tab is a `1fr` grid column, so its width — and its tap target —
comes from the grid, not from its padding. 4px to 2px gives the label 65px.
Both words fit on one line, at 390px and above.

Below that they still wrap, and still should. At 320px the box is 51px against
61.6px of word; no padding closes an eleven-pixel gap.

## The fix that would have made it worse

`overflow-wrap: anywhere` breaks after whatever character fills the line, which
is what produced the orphans. The obvious improvement is to break at a
syllable — `hyphens: auto`, for "Dash-/board".

Tried, and measured. **This Chromium hyphenates neither word.** It leaves them
on one line, spilling **10.4px** and **12.6px** out of the tab at 320px, where
the tab's `overflow: hidden` cuts them to:

    Dashboa        Notificatio

No ellipsis. No hyphen. The exact truncation the wrap exists to prevent, and
worse than what it replaced — and the comment in `base.css` had said so, in as
many words, before it was tried: *"without it the word simply overflows instead
of breaking."*

A screenshot settled it.

## Three measurements that were wrong first

This is the part worth keeping.

**A line count cannot see it.** An overflowing word is still one line, so
`lines === 1` reported `hyphens: auto` as a clean fix at every width. It was
the first thing measured and it said ship it.

**Comparing the label to itself cannot see it either.** `scrollWidth >
clientWidth` — which is what the existing "no fixed label is cut off" check
uses — asks whether a box clips its own contents. The label was not clipping
its contents; its *parent* was clipping the label.

**Nor can `max-width`.** The span carries `max-width: 100%`, so the natural
assumption is that it cannot exceed its tab. A grid item's automatic minimum
size is its min-content, which is allowed to exceed `max-width` — so the span's
own box measured 61.6px wide and measured as fitting, while hanging out of a
47px tab.

Only one comparison sees either failure: **the label's box against the tab's
content box.** That is what the check does now.

## What the checks hold

At 320, 360, 390 and 430:

- All five labels are found at all — without this, a selector that stopped
  matching would make every `every()` below it true and the block would pass
  measuring nothing.
- No label spills outside its tab.
- Every tab is still 44px, because "the padding cannot have affected it" is how
  a tap target shrinks.

And at 390 and above, where there is room: no label is broken across two lines.
