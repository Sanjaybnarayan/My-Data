# A Wheel Seen Edge-On

`js/modules/finance/sections.js`, `css/components.css`, `tests/browser.mjs`.

## What was asked for

> "redesigning of scrollbar to horizontal circle...so its looks elegant and
> professional"

Finance's two navigation rows — the groups above, the sections of the open
group below — rebuilt as a wheel: the item in the middle faces you square and
full size, the ones either side turned away and standing back, further the
closer they get to the edge. Sliding the row turns the wheel.

## How it turns

`animation-timeline: view(inline)`. Each face runs a keyframe whose progress is
its own position in the scrollport — 0% as it enters, 50% at the middle of the
row, 100% as it leaves — so the turn is a function of where the item is, with
no scroll handler and nothing to keep in step by hand. Under a 20rem
`perspective` the keyframe is a `rotateY` from +46° through 0 to −46°, with a
little scale to match.

`@supports (animation-timeline: view(inline))` wraps it. The fallback is a flat
row that still centres and still marks what is chosen: the design one dimension
down rather than a broken version of it.

## Three things it could have cost, and did not

### The tap target

A transform moves the measured box. `getBoundingClientRect` reports the
*transformed* size, so a 44px control scaled to 0.82 measures 36px and is no
longer a tap target — and this repository checks that floor on twelve screens
at 390px and at 320px.

So the control and its face are two different things. The button keeps its own
untransformed box and does nothing but receive the tap; an inner
`.finance-nav-face` carries every visible thing — the pill, the rule beneath a
group, the turn, the fade. Measured at 44px on every item on every screen after
the change.

### The contrast floor

"The others fade" written the obvious way is `opacity: 0.4`, and it looks right
immediately.

Until this change the contrast walk in `tests/browser.mjs` **could not see
it**. It read the alpha inside `color` and skipped only a flat `opacity: 0`,
ignoring the property entirely — so text faded with `opacity` was measured at
its unfaded contrast and passed while being half as readable as the number
claimed. A check that cannot see the thing it is checking is worse than no
check, because it gets quoted.

It now multiplies effective opacity down the ancestor chain (a 0.5 row holding
a 0.5 chip renders at 0.25) and exempts disabled controls, which is WCAG's own
rule — 1.4.3 excludes inactive components, and `.btn:disabled` is `opacity:
0.45` here.

**The fix immediately failed the fade it was built to police**, which is the
whole point:

    span.finance-nav-face  2.84:1 (needs 4.5)  in light
    span.finance-nav-face  3.36:1 (needs 4.5)  in light
    span.finance-nav-face  4.09:1 (needs 4.5)  in light
    span.finance-nav-face  3.88:1 (needs 4.5)  in dark

### The double-dip behind those numbers

The fade was coming off a colour that had nothing left to give:

| | at full strength | at the 0.72 floor |
| --- | --- | --- |
| `--text` | 17.19:1 | **6.91:1** |
| `--text-muted` | 6.33:1 | 3.36:1 |
| `--text-faint` | 4.83:1 | 2.84:1 |
| white on `--accent` | 4.51:1 | 3.09:1 |

`--text-faint` is *already at the floor by design* — `css/tokens.css` says so
in as many words: *"faint, not unreadable… readable wins."* Fading it as well
took a token chosen to be barely readable and made it less so. Two effects
stacked past the point either had been checked for.

So the faces fade from `--text`, and the wheel's fade is the only de-emphasis
there is. Same recede, landing at 6.91:1 on light and 9.08:1 on dark.

And **the chosen face never dims at all.** White on `--accent` measures 4.51:1,
which is the floor itself; a single percent of fade puts the selection under
the bar. It turns with the wheel on separate keyframes that carry the geometry
without the opacity — which is also what was asked for: *the selected one
highlighted, the others faded.*

## Centred, but not at any price

The literal reading of "the selection sits in the middle" is
`padding-inline: 50%`, which lets even the first and last item reach the exact
centre. It was built that way and measured at `offCentre: 0` on every screen,
both rows.

It is wrong. Centring the *first* item leaves the entire left half of the row
blank — and Money is the first group, so the commonest view of the whole screen
was a navigation that looked half missing. The same happens at the other end
with Review.

These rows barely overflow to begin with: five groups across 366px have 47px of
travel between them. Strict centring either does nothing (no padding) or blanks
half the row (full padding).

At a 4.5rem gutter:

| chosen | off centre |
| --- | --- |
| Planned (middle) | −13px |
| Loans (middle) | −6px |
| Money (first) | −70px, from −142px |
| Review (last) | +68px, from +142px |

A middle choice lands within about ten pixels of the centre, the two ends come
half way, and there is no void at either edge.

## What the checks hold

- **The wheel never shrinks a tap target below 44px**, which is the trap the
  face split exists to avoid.
- **Every face is actually turned by it** — without this the block passes on a
  flat row.
- **The fade is a gradient across the row, not one flat step.** "The others
  fade" written as a single alternative state gives two values; a wheel gives
  each item a little more setback than the last. Measured 0.72 → 0.98.
- **Nothing fades past the readable floor**, which only means something because
  the contrast walk can now see opacity at all.
- **The chosen one is exactly opacity 1**, having no contrast to spare.

Two existing checks moved rather than being deleted. "The rest are faded rather
than hidden" compared `color`, which no longer differs now that both chosen and
unchosen faces are `--text`; it reads opacity, which is where the de-emphasis
actually lives. And "a row that fits is not faded at either end" was reading a
Finance row — the centring gutter means those always overflow now, so it moved
to a chip row that genuinely fits, with a guard that such a row was found at
all.
