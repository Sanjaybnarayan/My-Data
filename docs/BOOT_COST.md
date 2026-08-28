# What One Boot Costs

Measured in `tests/browser.mjs`, in the fresh browser context the native-shell
section creates — the only deterministic place to ask, since by any later point
in the run the database holds whatever the checks before it created.

## The numbers

| | empty household | 2,000 transactions |
| --- | --- | --- |
| cursor opens | 65 | 63 |
| rows walked | 6 | 2,213 |
| to a drawn shell | — | 186ms |
| to the first card | — | 372ms |

Cursor opens, not `getAll` calls. `js/data/idb.js` walks a cursor on purpose so
that a windowed list of fifty does not materialise forty thousand rows, and the
first version of the probe hooked `getAll` and measured **zero** while the
application was reading sixty-three times. An instrument that reads nothing
reports no problem.

## There is no performance defect here

372ms to the first card with two thousand transactions on the books is not
something a household would feel. The one large store is walked once.

## What the number is made of, and why it is not being fixed

Sixty-five reads on an *empty* database is not small because the stores are —
it is that several consumers each ask the database separately rather than
asking each other:

- `person` is opened **five times** on one boot.
- `holding`, `vehicle`, `policy`, `property`, `digitalAsset` and `loan` are
  each opened **three times**.

The dashboard's loader, `runAutomations`, and the estate, timeline and identity
services all read the same entities independently. The dashboard already knows
this matters — its own comment says it hands `byEntity` to `attentionFrom`
"from the records already in hand rather than a second read of eighteen
entities" — and the lesson stopped at its own boundary.

It is deliberately left alone. A shared cache across services would risk a
stale read, and a screen showing a record that has since changed is a worse
failure than a boot that takes 372ms instead of 300ms. The cost scales with the
number of *consumers*, not with the size of the household, so it does not get
worse as records pile up.

## So it is a budget, not a refactor

Two checks: one boot opens no more than 90 cursors, and no single store is read
more than six times. Both are counts rather than stopwatches, because a count
is the same on a loaded CI runner and a fast laptop.

They exist so that if this stops being little — a change that turns sixty reads
into six hundred, or adds a seventh consumer of `person` — somebody finds out
from a check rather than from a phone.
