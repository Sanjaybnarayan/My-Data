# The split the ratchet asked for

Two capped lists were left unfixed in `docs/A_LIST_THAT_STOPS.md`, and the
reason was stated there rather than hidden:

> `tools/module-size.mjs` reported them at 1020 and 838 lines against recorded
> budgets of 1008 and 827, and its instruction is not advisory: *"No crowded
> file may grow and none may join. Move code out rather than raising the
> number."*

This is that move, and then the two fixes.

## What came out, and why those pieces

Neither file was refactored. Both are one `render()` with the whole screen
inside it — `receipts.js` has twenty-six closures in a single function — and
rewriting that was not the job. What left are the pieces that could leave
**without being rewritten**: pure functions of their arguments, closing over
none of `render`'s state.

| | before | after | |
| --- | --- | --- | --- |
| `js/modules/receipts.js` | 1,008 | **975** | |
| `js/modules/statements.js` | 827 | **779** | left the list entirely |

`statements.js` is now under 800, so `tools/module-size.mjs` tracks **five**
files rather than six.

What remains in both still wants breaking up, and neither file is now a
well-shaped module. This bought the room to make one fix each, which is what
it was for.

## The two fixes

**Receipts.** The reconciliation card's own subtitle reads *"31 of 40 receipts
found the payment that settled them"* — the total stated in a sentence,
directly above a list that stopped at twelve. It was the worst instance of
that fault in the application, and the only reason it survived
`docs/A_LIST_THAT_STOPS.md` was the budget.

**Statements.** A badge reading *"12 unreadable"* above a list of five. What is
hidden there is the reason a statement did not import cleanly, so the count is
the difference between *a few odd rows* and *this file did not parse*.

Both use `restOfList` from `ui/components/basics.js` — the same primitive as
the other nine — through a named wrapper in each parts file, so the cap and
the footer cannot drift apart.

## What the tests measure

In `tests/composition.test.mjs`, against the DOM stub already there, rather
than in the browser: the condition needs more receipts than the example
household holds, and what is worth checking is the arithmetic either side of
the cap rather than the pixels.

Three points each — at the cap, below it, and above it — and the number in the
footer is compared against `total - cap` computed from the exported constant,
so a change to either moves both sides.

Mutation-proven: making both wrappers return `null`, which is what the screens
did before, fails both tests and no others.

## A note on the service worker

`js/modules/receipts-parts.js` and `js/modules/statements-parts.js` are both in
`sw.js`. A new module that ships and is not precached is a screen that works
until the household goes offline, and `tests/run.mjs` has a check for exactly
that — it caught the first of the two before this was written down.
