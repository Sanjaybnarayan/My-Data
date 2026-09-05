# One Wheel, Everywhere

`js/ui/components/basics.js`, `css/components.css`, and the two hand-built
chips that live in sliding rows.

## What was asked for

> "implementation of horizontal circle slide scrollbar where all possible so it
> will be same in all screens"

Finance's two navigation rows turned like a wheel seen edge-on — the item in
the middle square-on and full size, the ones either side turned away and
standing back. Every other sliding row in the application was flat.

There are seven of them, and every one of them genuinely slides:

| row | items | overflow at 390px |
| --- | --- | --- |
| identity | 4 | 468 → 356 |
| health | 4 | 441 → 356 |
| family | 5 | 441 → 356 |
| vault | 4 | 424 → 356 |
| calendar | 6 | 658 → 306 |
| settings | 6 | 834 → 356 |
| finance | 5 | 547 → 356 |

Plus every entity list's filter row, through `js/modules/crud.js`.

## The constraint that shapes it

A transform moves the measured box. `getBoundingClientRect` reports the
**transformed** size, so a 44px chip turned and set back by the wheel measures
36px and is no longer a tap target — and this repository checks that floor on
twelve screens at 390px and at 320px rather than claiming it.

So the control and its face are two different things, which is what Finance
already did and what makes one treatment across all of them possible at all:

- `chip()` emits a `span.chip-face` around its contents.
- Inside `.chip-row--scroll` the button keeps an untransformed 44px box and
  does nothing but receive the tap; the face carries the pill, the turn and
  the fade.
- **Outside** a sliding row the face is inert — the pill stays on `.chip` and
  an ordinary wrapping chip row is unchanged. That is what lets `chip()` emit
  the face unconditionally without touching the rows that wrap.

Two chips were built by hand rather than through the component and live in
sliding rows — Calendar's source toggles and Settings' section row. Both get
the same face; every other hand-built chip is in a wrapping row and is left
alone.

## One deliberate difference from Finance

Finance uses a 4.5rem `padding-inline` gutter so the *first* group can reach
the middle of the row. These rows get `scroll-padding-inline` instead.

Finance's rows are a hierarchy being read from the centre. These are filters
sitting under a heading, and 4.5rem of blank before the first chip reads as a
missing control rather than as a centred one. `scroll-padding` moves where
snapping lands without moving where the row starts.

## Measured

| row | faces | tap target | faces turned | opacity |
| --- | --- | --- | --- | --- |
| identity | 4 | 44px | 4/4 | 0.75 – 1 |
| health | 4 | 44px | 4/4 | 0.75 – 1 |
| family | 5 | 44px | 5/5 | 0.72 – 1 |
| vault | 4 | 44px | 4/4 | 0.79 – 1 |
| calendar | 6 | 44px | 6/6 | 1 – 1 |
| settings | 6 | 44px | 6/6 | 0.72 – 1 |
| finance | 5 | 44px | 5/5 | 0.72 – 1 |

Calendar reads 1 – 1 and that is correct: all six sources are on by default, so
all six chips are *chosen*, and a chosen face never dims. `--accent-text` on
`--accent-subtle` has no headroom to give — the same reason Finance's chosen
face turns on separate keyframes that carry the geometry without the opacity.

The 0.72 floor is not a taste. The contrast walk in `tests/browser.mjs` reads
**effective** opacity down the ancestor chain, so a face faded past the
readable floor fails it — which is exactly what happened the first time the
wheel was built, at 2.84:1.

## And a card header found in the same sweep

Eight card headers across eight screens drew their icon on a line of its own,
above the heading it belongs to, reading as a stray glyph. `.card-header` is
`flex-wrap: wrap` so a badge can drop below a long title, but `.spacer`
carrying the title is `flex: 1 1 auto` — and an `auto` basis is the title's
*max-content* width. Wrapping is decided before shrinking, so any title too
wide for the room beside an 18px icon took a whole line.

Worst was Reports at 148px of header for "Fill in a document template"; the
same "Where the answer to this already is" card was affected on four screens.
A zero basis fixes it: the title shrinks and wraps inside its own box, which is
what should have been happening. Eight → none.

### The first version of that fix was wrong

It also set `min-width: 0`, reasoning that a flex item's automatic minimum size
would otherwise hold the box at min-content. It would — and that is the point.
Released, the box goes narrower than its longest word, and the suite caught two
headings cut off at Android's largest text setting:

    FAIL  and no fixed label is cut off at 24px — H2: Household | H2: Recent activity

A truncated heading is worse than a stranded icon, and this repository refuses
truncation of fixed labels in as many words elsewhere. The zero basis alone
fixes what was actually wrong. `min-width: 0` must not come back, and the rule
says so where somebody would add it.

## The same double-dip, arriving by inheritance

The first full run failed twice, in both themes, and only in Settings:

    span.chip-face  4.06:1 (needs 4.5)  in light
    span.chip-face  4.4:1  (needs 4.5)  in dark

A chip can be an anchor — Settings' section row is six of them — and
`a { color: var(--accent-text) }` therefore gives an **unchosen** chip the link
blue. The wheel fades unchosen faces to 0.72, the contrast walk reads effective
opacity, and that blue lands under the floor.

It is exactly what `docs/A_WHEEL_SEEN_EDGE_ON.md` records from the first wheel:
fading a colour that has nothing left to give. There it was `--text-faint`,
already at the floor by design. Here it is a link colour arriving by
inheritance, which is harder to see coming and lands in the same place.

So the faces take `--text` explicitly, as Finance's do and for the same reason:

| | before | after |
| --- | --- | --- |
| worst face, light | 4.06:1 | **7.05:1** |
| worst face, dark | 4.4:1 | **8.2:1** |

Same 0.72 floor, same wheel; only the colour being faded changed.

## Only where the row actually slides

`view(inline)` maps an item's progress across the scrollport whether or not
there is anything to scroll. These rows all overflow on a phone — that is why
they slide — but on a desktop the column is about 960px and the widest of them
is 834px, so they **fit**. The wheel then became arbitrary size by horizontal
position: the leftmost chip drawn at the start of the timeline, smallest and
turned furthest away, and the leftmost chip is usually the selected one.

Identity showed **"People" chosen and shrunken** while "Employment history" sat
square-on beside it. The opposite of what the wheel is for, and it shipped in
the first version of this change.

It was found by taking a screenshot at 1280px — the first time in this whole
sweep that anything had been looked at anywhere but a 390px phone.

So the wheel is gated to 900px, this application's own phone-and-desktop
breakpoint, for the same reason it is the right line there:

| | identity, settings | finance |
| --- | --- | --- |
| at 390px | turned 4/4 and 6/6, opacity 0.72 – 1 | turned 5/5 |
| at 1280px | **turned 0**, opacity 1 – 1 | turned 5/5, 0.84 – 1 |

Finance is deliberately not gated: its centring gutter means those two rows
overflow at every width, so the wheel always has something to express.

## And half the Family screen going unused

The person cards in the family tree carried `minWidth: 170px` in a wrapping
row. Two of them plus the gap need 352px and the row has less than that on a
390px phone, so **exactly one person fitted per line** and about 147px beside
each one went unused — half the width of the screen the module is named after.

The obvious repair is a smaller minimum so two share the line. It is the wrong
one. At 150px the name has roughly 70px left after the avatar and the padding,
and "Lakshmi Iyer" needs about 86 — and because the name carries `.truncate`
it would not have overflowed and been caught. It would have quietly become
"Lakshmi I…", and a person's own name is the last thing here that should be
cut to save room.

So the cards grow instead of shrinking: `flex: 1 1 170px`.

| | before | after |
| --- | --- | --- |
| card width at 390px | 170px | **306px** |
| unused beside each | ~147px | none |
| at 1280px | 170px | 173px where a generation fills the row, wider where it does not |

Growing costs nothing. One per line fills the width; a wider screen fits two or
three, which then share it evenly — the 173px measured on a desktop row is a
generation packing properly at close to the basis.

## And a hole beside the card that matters most

The dashboard is a two-column grid above 900px — 473px each at 1280px. The
attention card is drawn first and the wallet section after it spans both
columns, so **the attention card came out half width with the other 473px of
its row empty**, on the screen the application opens on, beside the one card
the design puts first on purpose.

| | before | after |
| --- | --- | --- |
| attention card at 1280px | 473px of a 962px row | **962px** |
| empty beside it | 473px | none |

`grid-column: 1 / -1`, the same span the wallet below it already uses. Every
other card on the screen pairs off correctly and is left alone, and on a phone
the grid is one column so nothing changes there.

Found the same way as everything else here: by looking at a screenshot, this
one at 1280px — a width nothing in this sweep had been looked at until the
wheel had already shipped a bug there.
