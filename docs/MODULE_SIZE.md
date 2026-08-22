# The File That Grew While It Was Being Complained About

`tools/module-size.mjs`, `tools/module-size.json`, tested in
`tests/modulesize.test.mjs`.

## What happened

The Phase 0 audit read `js/modules/settings.js`, called it a **god component**
at 1,597 lines, and filed it as a P2. It appears twice in the risk register
and once in `docs/UI_UX_AUDIT.md` with a `REFACTOR` verdict beside it.

Measured again:

```
 2099  js/data/schema.js
 1894  js/modules/settings.js     <- the file the audit named
 1008  js/modules/receipts.js
```

**It grew by 297 lines while sitting on a list describing it as too big.**

That is not carelessness. It is the same failure this repository keeps finding
in every other form: a claim written into a document, with nothing that checks
it. `docs/ARCHITECTURE_DRIFT.md` is the version for architecture rows,
`tools/self-description.mjs` for numbers written into prose, and the type and
string budgets for counts nobody would otherwise re-derive. A number in a
sentence is a number that drifts.

## What the ratchet does

Every file over 800 lines has its size written down, and **none of them may
grow**. New files may not join the list either. Both halves are read off the
tree: a file leaves the budget by getting smaller, and there is nowhere to add
one by hand.

## Why per-file and not one number

The biggest file that ships is `js/data/schema.js` at 2,099 lines, and it is
not a god component — it is fifty-three entity declarations, which is what a
schema looks like. A single "largest file" budget would have been pinned to
`schema.js`, and moving three hundred lines out of `settings.js` would not
have moved the number at all.

The obvious alternative was a list of files to exclude. That is the
hand-maintained list beside a derivable one that this repository has now found
**ten** times, and it is not being written an eleventh. Per-file caps need no
exclusions: `schema.js` is simply frozen at its size, which is the honest
thing to say about a declarative file nobody wants growing either.

## What it is not

**Line count is a proxy, and is stated as one.** What actually makes a god
component bad is unrelated concerns sharing mutable state and reloading
together, and no counter sees that. What a counter does see is the thing the
audit itself measured, in the units the audit used — and a proxy that ratchets
beats a judgement nobody re-makes.

Tests and tools are excluded, and that exclusion is a rule rather than a list:
only `js/` is scanned, because only `js/` ships to a browser. A long test file
is a long list of checks, which is the opposite of a problem.

## What the split actually moved

Nothing but code. `settings.js` keeps `render` and `paint`; the nineteen cards
live in seven files under `js/modules/settings/`, grouped by the question
somebody came to the screen to ask.

Two things are worth recording because they were not mechanical:

**`host` became `repaint`.** Three cards took the page node so they could call
`paint(host)` — reaching back into the parent module for a function. That is
precisely the coupling that made one file of all of them, and it would have
made the split impossible to keep. They now take a callback, which is what
`securityCard` already did. A card may ask for a repaint; it does not need to
know how one happens.

**`enrolBiometric` declared three required fields and used two.**
`displayName` is defaulted to `userName` in the body, so every call site that
sensibly omitted it was reported as a type error. Declaring it optional
removed four findings and took the budget from 161 to 160.

The UI-to-database count did not move: **58/58** before and after. `paint` is
the only place that gathers, so splitting the cards moved no reads.

## The check that could not fail

`tests/modulesize.test.mjs` mutates the budget rather than the tree. A file
recorded one line smaller than it is must be reported as grown; a crowded file
missing from the budget must be reported as having joined; and a file recorded
larger than it is must **not** be reported, because shrinking is the point.
