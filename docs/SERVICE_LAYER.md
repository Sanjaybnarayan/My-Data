# The Domain-Service Layer

Phase 1, first tranche. `js/services/`, tested in `tests/services.test.mjs`,
consumed by `js/modules/investments.js` and `js/modules/crud.js`.

## A correction, first

The Phase 0 audit said screens calling the repository directly meant
*"authorization, provenance and audit are applied by whichever screen remembers
to."*

**That was wrong**, and it was the second claim in that audit I made without
tracing the code. `data/repository.js` calls `assertCan` on every `get`,
`create`, `update`, `remove` and `restore`, applies `rowFilter` to every
`list`, and writes the audit entry **in the same transaction as the change**. A
screen cannot forget, because a screen never gets the chance.

Traced across the whole codebase: outside `data/` and `sync/` there are exactly
three direct `adapter` calls, all in Settings, all on system stores that have no
ACL (`conflicts`, and a full `destroy`).

So the service layer is not plugging an authorization hole. It is doing two
narrower things.

## What it is actually for

**1. Assembly had no home.** The investments screen loaded eight entities, fed
them to pure functions in `domain/`, and built a view model inline. The
arithmetic was already extracted and well tested; the part that decides *which
records an answer needs* and *how they combine* could only be exercised by
opening a browser.

**2. Cross-entity operations had no home.** `Repository.referencedBy` throws
`wrong-layer` on purpose — a repository owns one entity. Anything spanning
entities had nowhere to live but a screen.

## The rule that makes this the right seam

> **A service reads through `db.repo(...)` and never through `db.adapter`.**

Not tidiness. The repository is where `assertCan` and `rowFilter` live, so a
service reaching past it would return rows its caller may not see — silently,
because a view model has nowhere to put a permission error.
`tests/services.test.mjs` scans every file in `js/services/` and fails on a bare
`.adapter`.

Under the hybrid decision — **a policy server that holds roles and answers
authorization questions, and never holds records** — this is where an
authoritative remote decision gets consulted for an *operation*, as against the
per-row checks the repository already makes locally. Nothing calls a server
yet, and the code says so.

## What shipped

| Service | Question it answers |
| --- | --- |
| `PortfolioService.overview()` | Everything the investments screen shows, as plain data |
| `RecordsService.impactOfDeleting()` | What deleting this record would leave pointing at nothing |

`NET_WORTH_LOAD` declares the six entities net worth is assembled from, **once**.
Before this the investments screen and the dashboard each listed them inline and
neither knew about the other — so adding a seventh would have produced two
different net worths in one application, with nothing to catch it.

## Three bugs the migration surfaced

**`0%` where the answer was "nothing to compare against".** The screen computed
`worth.assets ? … : 0`, so a household with a holding and no other assets was
told their investments were `0% of assets`. That reads as *a negligible part*,
not *there is nothing to be a part of*. Now `null`, and the screen says so.

**A rate of `0` where nothing could be computed.** Already handled correctly in
the old screen — and now locked down by a test, because `0` reads as "this
investment is flat" and `null` as "nothing here can say", and no rendering test
distinguishes them.

**"1 records refer to this one."** The delete dialog pluralised unconditionally,
in a sentence somebody reads immediately before a destructive act.

## The distinction the delete dialog could not make

It said *N records refer to this one and will be left pointing at nothing*, for
every N and every kind of reference. But:

- A transaction's `account` is `required: true`. Delete the account and the
  transaction cannot pass its own validation.
- A transaction's `person` is optional. Delete the person and the transaction is
  merely untidy.

`impactOfDeleting` separates `breaking` from `total`, sorts breaking references
first, and names the entities. It still does **not block** the delete: a
spreadsheet has no foreign keys, the delete is soft and restorable, and refusing
would strand a household that genuinely wants a record gone.

## What mutation testing found

Eight mutations. Five were caught by the named test that should catch them.
**Three were not**, and all three were tests of mine that agreed with
themselves:

| Mutation | First result | Fix |
| --- | --- | --- |
| Drop the `flows.length >= 2` guard | nothing failed | `xirr` already returns `null` for one flow, so the guard is **unreachable**. Kept, annotated as belt-and-braces, and a test now locks xirr's half so the two cannot drift apart. Mutating `xirr` to return `0` for one flow fails two tests. |
| Skip the unknown-entity check | nothing failed | The test asserted only that *something* threw — and `db.repo()` throws on an unknown entity by itself. It now checks the message names the service and the entity, which is what the guard actually adds. |
| Make the service always return empty | the browser suite **crashed** | `innerText()` on a locator matching nothing waits thirty seconds and throws, aborting every check after it. The row is counted before it is read, so a missing row is now a named failure. |

The third is the one worth keeping in mind: a detection that takes the suite
down is barely better than no detection, because the output says "crashed"
rather than which invariant broke.

## Migrated, not added

Both services replaced code rather than sitting beside it. `investments.js` lost
its eight-call `Promise.all` and its inline assembly; `crud.js` lost its
hand-rolled reference sentence. That is deliberate — the first five Phase 0.5
tranches produced engines with no callers, which was this project's own recorded
known issue.

## Verification

| Check | Before | After |
| --- | --- | --- |
| Unit | 738 | **755** |
| Browser | 155 | **159** |
| Build | 93 modules | **96 modules, 528 exports** |

The four new browser checks exist because the old one did not cover this.
`investments renders something` asserts a non-empty body and no console error —
which **passes on the empty state**, so it would have kept passing if the
service returned nothing at all. The new checks drive a real holding through
the form and read the numbers back off the screen.

## Not done

- **13 screens still call `db.repo(...)` directly.** This tranche built the
  layer and migrated the two that demonstrate its two shapes. The rest is
  mechanical and should follow module by module.
- **No service calls a server.** The hybrid's policy server does not exist yet.
- **No write-side service.** Both services here are reads. Cross-entity *writes*
  — the transaction-plus-economic-event shape Phase 5 needs — are the next
  interesting case, and are not built.
