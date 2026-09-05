# A Badge That Counted Its Own Rows

`js/modules/dashboard.js`, `js/modules/dashboard-parts.js`, `tests/browser.mjs`.

## The bug

"Papers running out" is a warning card on the screen the application opens on.
It said **5**. There were **9**.

    const rows = data.attention.items
      .filter((one) => PAPERS.has(one.entity))
      .slice(0, 5);
    …
    cardHeader(t('dash.papers.running'), badge(String(rows.length)), …)

`rows` is the sliced array, so the badge counted the rows it had drawn rather
than the papers it had found. The cap was five, so the badge could never say
more than five however many there were.

`reminders` had the same shape at eight, against a true fifteen.

Measured on the example household, both before and after:

| card | badge before | badge after | truth |
| --- | --- | --- | --- |
| Papers running out | **5** | 9 | 9 |
| Expiring & due | **8** | 15 | 15 |
| …things need your attention | 9 | 9 | 9 |

The attention card, directly above them, counted the real total and always
had — which is what makes this a slip rather than a policy.

## Three lists that could not be got past

`bills`, `reminders` and `nominations` drew eight rows and offered **no link
out at all**. The rows past the cut were unreachable from the dashboard.

The activity card's own comment had already named this as a fault — and fixed
it only for itself:

> The card shows eight. The service built every story in the window and the
> rest were dropped on the floor, so the link is not decoration — it is the
> only way to reach a history the application already had.

All three now carry the same footer, and it says how many there are.

## Three rows

The attention card had settled the question already:

> Three rows, not all of them. This card exists to say *whether* something
> needs doing; the tab is where the list lives.

That sentence is true of every list on the screen. The rest drew five, six and
eight.

| card | before | after |
| --- | --- | --- |
| Nobody nominated | 784px | 522px |
| Since you last looked | 665px | 323px |
| Bills in the next 30 days | 537px | 412px |
| Papers running out | 477px | 341px |
| Tasks | 427px | 290px |
| **the whole screen** | **5,680px** | **4,678px** |

"Coming up" was the sixth and last, found afterwards by grepping the tree for
the shape of the badge bug — `.slice(0, n)` and then a `.length` off the
sliced binding. It was not the bug (its `length` is only an emptiness test)
but it was the last list still drawing six, and the last with no way to the
rest. A birthday nobody can scroll to is a birthday missed.

The same sweep turned up the pattern done right, already in the tree.
`js/domain/timeline.js` takes its remainder from the array it did *not* cut:

    const named = story.fields.slice(0, 3);
    const rest = story.fields.length - named.length;

— which is exactly what `documents` should have been doing all along.

At 390×844 that was six and a half screens with eleven of thirteen cards below
the fold. It is not short now — the remaining height is a spending chart, the
greeting and the wallet, which are a different question — but the lists no
longer set it.

The bills total still counts every bill, not the three shown. It always did;
that is *why* the list needed a way through to the rest rather than a shorter
total.

## Two ratchets, taken as instructions

**`tools/module-size.mjs`** stopped the change: `dashboard.js` reached 806
lines and `en.js` 801, and both had never been over 800. Its message is not
advisory — *"Move code out rather than raising the number"* — so the shared
card pieces went to `js/modules/dashboard-parts.js` and the locale comment came
down to nothing.

**`tools/class-names.mjs`** then caught the half-move: `.card-footer` was
suddenly written by two files, because `billsFooter` had gone and the
nominations footer had stayed. Two files styling one name is how both of this
repository's earlier collisions began, so the second footer followed the first.

And the unit suite caught a third thing neither ratchet would have: **a new
module has to be added to the service worker's precache list.** In an
offline-first application that omission surfaces on an aeroplane, not in
development.

## The check, and the guard that saved it

The block asserts the badges against the truth — computed with `loadAll`, the
same function the screen uses, because counting the rows on screen is exactly
the mistake being checked for.

It failed on its first run, and correctly:

    FAIL  the counting cards are all on the dashboard — ["papers","attention"]
    FAIL  and this run has more of them than a card can show — papers 0, expiring 0

The block had been calibrated against the example household, which this suite
does not install. The run reached it with nothing expiring, both cards drew
their "nothing to see" variants, and all four badge assertions would have
compared `undefined` against `undefined` and passed.

They did not, because the two guards were written before the mistake was made:
one requiring every counting card to be *found*, one requiring the run to hold
more records than a card can show. A block added to catch a counting bug would
otherwise have shipped counting nothing — which is the same fault as the bug it
was written for, one level up.

It seeds five documents of its own now: two already past, so something is
pressing and the attention card draws its counting form rather than its quiet
one; `document` needs a title and nothing else, so the fixture cannot fail on a
required field. They are removed at the end, because a later check asserts this
copy has nothing expiring in it.
