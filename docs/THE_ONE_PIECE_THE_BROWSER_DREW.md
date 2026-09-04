# The One Piece The Browser Drew

`css/tokens.css`, `css/base.css`, `css/components.css`, `tests/browser.mjs`.

## What was found

Nothing in this repository had ever styled a scrollbar. Every scrolling
surface — the sidebar, a modal body, a tall table, the chat thread, a wide
table on a phone, the page itself — drew whatever the browser drew: a trench
with a square thumb and a track painted a different grey from the panel it was
cut into. The spacing, the radii, the greys, the focus ring and the tap
targets are all chosen and measured here. The scrollbar was the one piece left
to somebody else.

Four rows went the other way and hid theirs outright — the chip rows, the tab
strip, and Finance's two nav rows. On a phone that is right: you swipe, and a
bar under a 44px row is noise. On a desktop it left a row that is simply
**cut**, with a word chopped at the edge and nothing on screen saying whether
that is the end of the row or the middle of it.

## The scrollbar

Two decisions.

**A thumb, and no track.** `scrollbar-color` takes the thumb and the track in
that order, and the track here is `transparent`. The track *is* the surface it
sits on, so a panel keeps its own colour to its own edge and the thumb floats
over the content. The default's second grey was the thing that read as a
trench cut into the page.

**Legible at rest, in both themes.** `--grey-400` on light. On dark it is
`--grey-600` — *lighter* than the ground, because on a near-black panel a dark
thumb is not a subtle scrollbar, it is an invisible one. A single palette gets
exactly this half wrong.

The rules are hung off the universal selector on purpose. A scrollbar appears
on anything that overflows, and listing the elements that do is how half of
them keep the default — the sidebar is easy to remember and `.query-preview`
is not. The four rows that hide their bar still do; a class beats `*`.

## Fifty lines that would have done nothing

The first version of this shipped `scrollbar-width`/`scrollbar-color` **and**
a full set of `::-webkit-scrollbar` rules, on the reasoning that one covers
Firefox and the other covers Chromium and Safari.

The pair is not additive. Once `scrollbar-width` or `scrollbar-color` is
anything but `auto`, **Chromium ignores every `::-webkit-scrollbar` rule on
that element.** The `width: 14px`, the `border-radius: 999px`, the
`background-clip: content-box` inset, the `:hover` — all of it would have sat
in `base.css` doing nothing in every browser this application runs in, and
looking for all the world like the thing doing the work.

It is now inside `@supports not (scrollbar-width: thin)`, which is the only
place it can do anything. That block is also where the `:hover` lives, because
the standard property genuinely cannot express one — which is why the resting
colour had to get stronger rather than relying on a hover to find it.

## What this environment cannot see

**Headless Chromium paints no scrollbar at all.** Not a styled one, not a
default one. A four-box test page — standard properties only, webkit
pseudo-elements only, both, and untouched — reserved zero gutter pixels in
every box and rendered a bare panel in every box, including the untouched
control.

So no screenshot in this repository shows a scrollbar, and none ever will
while the checks run headless. Saying otherwise would be the easiest thing in
this document to get wrong.

What *is* checkable is the declaration, and that is what
`tests/browser.mjs` holds: that every surface which scrolls resolves
`scrollbar-width` to `thin` or `none` and never to the `auto` this replaced;
that the track is transparent on every one of them; that the thumb is a single
colour across the app; and that light and dark do not resolve to the same
thumb — a token that never changes between themes being the way a half-done
palette ships. The rendering belongs to the engine. The declaration is the
whole of what the stylesheet controls, and it is fully measured.

## A gutter reserved on the wrong element

`.app-content` carried `scrollbar-gutter: stable` with a comment saying two
navigations away and back should not creep the content column. The property
applies to a **scroll container**, and `.app-content` is `overflow: visible` —
measured: `visible/visible`, `scrollHeight` equal to `clientHeight` on every
screen tried. It had never done anything.

The element that scrolls is the page. So a short screen released the gutter
and the column jumped by the width of a scrollbar on the way to a long one,
which is the exact thing the rule was written to stop, sitting one element
away from where it could stop it. It is on `html` now.

The check asserts the pair rather than the property: the gutter is `stable` on
the page *and* the page scrolls, and `.app-content` is back to `auto` *and*
does not scroll. Either half alone passes while the pair is broken — which is
how it survived this long.

## The rows that hide theirs

The cut becomes a fade, and only on the side there is actually more.

The mask is driven by the row's own scroll position through a scroll-driven
animation over two registered `@property` lengths. Against the left, the left
edge is hard and the right fades; scrolled to the end, the reverse. **A row
that fits shows neither** — not by a rule saying so, but because a scroll
timeline with nothing to scroll never starts, and the two lengths stay at the
`0px` their `@property` declarations give them.

Measured on Finance's group row at 390px: at rest, `--fade-start: 0px` and
`--fade-end: 32px`; scrolled to the end, `32px` and `0px`. On Planned's
section row, which fits exactly, `0px` and `0px`.

`.carousel` is deliberately excluded. It sets `grid-auto-columns: 86%` so the
next card always peeks past the edge, which is a better cue than a gradient
and is the stated reason its own bar is hidden.

`@supports (animation-timeline: scroll(self inline))` wraps the whole thing.
The honest fallback is the row exactly as it was — clipped, with no fade. A
gradient that could not move would be worse than none: it would fade the first
item while you were looking straight at it.

## Two checks of mine that measured nothing

Both were caught here rather than shipped, and both are the same mistake in
different clothes:

**A row that fits, which didn't.** The check labelled "a row that fits must
show no fade" read Finance's section row on the hub — four wide pills that
overflow 366px. It reported `overflows: true` and passed anyway, because at
that moment the row it was standing on had a fade and the assertion never
looked at the overflow. It now reads the row on Planned, whose four fit
exactly, and asserts `overflows === false` before asserting the fades are
zero.

**A count that could not be zero.** The scrollbar walk pushed `the page` into
its own results and then checked the list was non-empty — which it always is.
The walked elements are now counted apart from the page, so a walk that found
nothing fails instead of waving through every check below it.

## The structural guard

The fade is applied by naming four selectors in `css/components.css`. A fifth
sliding row added later would get a hidden scrollbar from its own class and no
fade from anything, and would be a hard-clipped row that nothing complains
about.

So across nine screens the suite walks for any element that scrolls sideways
with `scrollbar-width: none` and no mask, and fails naming it. `.carousel` is
the one exception and is excluded by name, with its reason recorded above —
an exception that has to be written down is cheaper than a rule that quietly
does not apply.
