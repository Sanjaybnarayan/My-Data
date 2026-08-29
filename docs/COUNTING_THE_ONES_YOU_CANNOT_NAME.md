# Counting The Ones You Cannot Name

`js/domain/explain.js`, `js/modules/finance.js`, `js/locale/en.js`,
`tests/explain.test.mjs`.

## The rule this breaks

v6.0 rule 57: **every financial event must be explainable.**

## What was found

`explainability()` is the function that answers rule 57 across a household, and
its own docstring states the standard it is held to:

> *"every financial event is explainable"* is not a property you have until you
> can name the ones that are not.

That is exactly right, and the function had **two ways of failing to name
them.**

### 1. The sample was reported as the household

```js
const events = await db.repo('economicEvent').list({ limit });   // limit = 500
const out = { total: events.length, ... };
```

`total` was the size of the page it fetched. The screen then said:

> "{documented} of {total} movements are made only of rows parsed from a
> statement…"

— *movements*, not *the five hundred most recent movements*. A household with
nine hundred economic events was told about five hundred and given no way to
know it.

Measured, seven events and a limit of three:

```
no cap : {"total":7,"unexplained":7}
limit 3: {"total":3,"unexplained":3}
→ the screen would say "0 of 3 movements" for a household with 7
→ true count via repo.count(): 7
```

The true number was one call away the whole time. `repository.count()` exists
and walks the store without decrypting.

### 2. A movement that could not be read vanished

```js
const explanation = await explainEvent(db, event.id);
if (!explanation) continue;
```

`explainEvent` returns null when the row cannot be fetched — its own first line
is `.get(id).catch(() => null)`, one of the 31 swallowed reads surveyed in
`docs/A_REPORT_IS_KEPT.md`, and here it is squarely subject-shaped. So the
three categories stopped adding up to the total printed beside them, while
still reading as exhaustive.

Measured, two of five unreadable:

```
{"total":5,"documented":0,"partlyTyped":0,"unexplained":3}
→ buckets sum to 3, total says 5 — 2 events vanished
```

**A ledger whose parts do not add up to its whole is the thing this report
exists to find, and it was true of the report's own arithmetic.**

## What changed

`total` is now the repository's own count; `examined` is what was walked; and
`unreadable` counts what could not be read. The counts satisfy an identity,
and a test holds it:

```
documented + partlyTyped + unexplained + unreadable === examined
```

`unreadable` is deliberately **not** folded into `unexplained`. "Nothing is
recorded behind this movement" is a statement about a household's bookkeeping;
"this movement could not be read" is a statement about this device. Only one of
them is a finding about the ledger.

The wording moved into `describeExplainability(review)` beside
`describeExplanation`, for the reason that one is there: these sentences are
the answer to rule 57, and an answer that can only be checked by opening a
browser is not being checked. The screen now says *"the 3 most recent of 7
movements"* when the limit bit, and plainly *"7 movements"* when it did not.

## How it is checked

`tests/explain.test.mjs`, four new cases, mutation-tested four ways:

```
M1  total is the sample again (the original)
      FAIL  the sample is not reported as the household
M2  an unreadable movement vanishes again
      FAIL  a movement that could not be read is counted, not dropped
M3  unreadable folded into unexplained
      FAIL  a movement that could not be read is counted, not dropped
M4  always claim the count was capped
      FAIL  and an uncapped count says so plainly
```

M4 is why the second test exists: always claiming a cap satisfies the first and
puts a needless qualification on every household small enough not to need one.

One note on the fixture, because it nearly produced a false pass. The stub for
an unreadable row was first written as `{ ...real, get }` — and a repository is
a class instance, so spreading copies its own fields and drops every method on
the prototype. It failed on `list`, loudly. A stub that quietly loses a method
is how a test ends up exercising something other than the code, so the
delegation is written out by hand and a comment says why.

## What this does not do

**It does not raise the limit.** Walking every movement means a lineage walk
per event, and five hundred is a deliberate ceiling on a screen that renders
while somebody waits. What changed is that the screen now says which number it
is talking about. Whether the report should page through the whole ledger is a
performance decision, not a correctness one.

**It does not say why a movement could not be read.** The count is stated; the
cause is not. `explainEvent` collapses every failure into null, and separating
them would mean changing what that function returns to every caller.

**It does not establish that any movement has ever been unreadable** on a
household's device. No such failure has been observed. What was wrong was that
if one happened, the report's own totals would have disagreed with themselves
and said nothing about it.
