# What right-to-left found

`docs/LOCALISATION.md` listed four things a translator would need, and the
fourth carried a warning about itself:

> `dir: 'rtl'` where it applies. The layer sets `lang` and `dir` on the root
> element; the stylesheet has **not** been audited for right-to-left, and
> claiming otherwise without testing it would be the same failure this
> document is about.

This is that audit. `js/core/locale.js:140` already sets `dir` from the
registered catalogue, so the test is simply to set it and look.

## What an overflow check would have reported

Nothing. Every screen measured `scrollWidth === clientWidth` under `dir="rtl"`
**before any fix** — eight screens, zero sideways overflow, and the elements
that sat outside the viewport were the horizontally scrolling rows, whose
children are supposed to.

That reading is true and useless. Both real faults leave the box model
perfect.

## Two faults

### A rule on the wrong edge

`.attention-card` — the one card the dashboard puts first on purpose — drew its
red rule with `border-left`. The screen mirrors and a physical property cannot,
so the mark meant to catch the eye first sat where the eye arrives last.

| | LTR | RTL before | RTL after |
| --- | --- | --- | --- |
| rule | left, 3px | **left, 3px** | right, 3px |

Fifteen other physical declarations went with it — `margin-left: auto`
spacers, `text-align: left/right`, the nav rail's `border-right`, the search
field's icon inset — all now `inline-start` / `inline-end` / `start` / `end`.

**The safe-area insets were deliberately left physical.** `--inset-left` is
`env(safe-area-inset-left)` and a notch is on a physical side of a physical
phone; mirroring those would move the padding away from the cut-out.

### Thirty-four runs reading backwards

| written | rendered in RTL |
| --- | --- |
| `5 Sep 2026` | `Sep 2026 5` |
| `9.4% · EMI ₹13,600.00` | `EMI ₹13,600.00 · 9.4%` |
| `1 to settle` | `to settle 1` |
| `9 things need your attention` | `things need your attention 9` |

A string that begins with a digit has weak directionality, so the paragraph's
own direction claims it and throws it to the visual end. Dates, money and
counts are most of what this application says.

Measured with a `Range` on the first and last character of each run, comparing
their boxes — nothing about the layout is wrong, so only the glyphs can say
it. **34 in RTL, 0 in LTR**, across six screens.

The fix is `unicode-bidi: plaintext` on the content area: each run resolves
against its own first strong character rather than against the page. A Latin
run lays out left-to-right inside an RTL page; an Arabic one would lay out
right-to-left inside it. Afterwards: **0 and 0**.

## What this does not prove

That the application reads well in Arabic or Hebrew. It does not, and it
cannot yet — there is no second catalogue. What was audited is the
**stylesheet**, which is what the warning asked for.

The bidi fix is also honest about being provisional, and the reason is the
other half of Phase 25: `unicode-bidi: plaintext` is the right reading *while
3,031 strings are unrouted English that no locale can translate*. Page
direction and content direction are not the same fact yet. When a real
catalogue exists most of these leaves carry translated text and resolve to the
page's direction from their own content anyway — the same rule reaching a
different answer, which is why it is a rule about content rather than a list
of exceptions.

The two problems turn out to be one problem: **until the strings are routed,
an RTL locale renders the untranslated ones jumbled**, and no amount of
logical properties would fix that.

## What the check measures

It walks four screens in both directions and, for every text leaf beginning
with a digit, compares the box of its first character against the box of its
last. Wrapped runs are skipped — a run that wraps legitimately ends left of
where it began.

The guard is the whole check: **at least eight measurable runs in each
direction**. If nothing on those screens begins with a digit there is nothing
to reorder, and both readings would be true of a walk that measured air.

It also asserts the attention rule is 3px on the left in LTR and 3px on the
right in RTL — not that a border exists, but that it *moved*.
