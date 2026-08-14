# The Unit of Work

Phase 1, third tranche. `js/data/unit.js`, tested in `tests/unit.test.mjs`,
used by `js/modules/statements.js`.

## What was already atomic, and what was not

A single write has been atomic since the beginning, and `repository.js` says
why in its own comment: the record, its search entry, its audit row and its
outbox entry go in **one** IndexedDB transaction, so a crash between them cannot
produce a change that never syncs.

What was never atomic is **two writes**. `repo('a').create()` followed by
`repo('b').create()` is two transactions. If the second is refused, the first
stands.

## The bug this found

`modules/statements.js` imported a bank statement like this:

```js
const statement = await db.repo('bankStatement').create(
  toStatementRecord(plan, { importedCount: plan.fresh.length, ... }),
);
for (const row of plan.fresh) {
  await db.repo('transaction').create(...);   // one transaction each
}
```

The statement record **states how many rows came out of the file**, and the rows
are written after it. A failure part way through — a full disk, a closed tab,
one malformed row — left a `bankStatement` saying forty transactions were
imported sitting next to the twelve that were. Nothing anywhere knew the two
were meant to agree, and `reconciled` is derived from that count.

It is now one unit per file.

### Why all-or-nothing rather than keeping what was written

Because the import is safe to re-run. Rows carry a fingerprint and a second
attempt at the same file is recognised as a duplicate rather than doubled —
that is Phase 5's test 9, which this repository already passes. Losing 198 good
rows in order to retry them is cheaper than a statement that lies about its own
contents.

**Per file, not per batch**, so one enormous transaction cannot form out of
several statements at once.

## The order that makes it safe

```
stage every operation  →  open one transaction  →  apply them all
```

Staging does the whole of a write except the writing: permission, validation,
the row-level check on the finished record, encryption, and building the audit
and outbox rows. A refusal therefore happens **before** the transaction opens,
rather than half way through it — an operation that cannot succeed never starts.

Staging also returns the finished record **including its id**, which is what
lets the next operation reference it. That is the shape Phase 5 needs: an
economic event has to point at a transaction that does not exist yet, and both
have to land together.

## The refactor underneath

`Repository.#commit` was split into `plan()` (prepare, touch nothing) and
`#run()` (open a transaction, apply, emit). `create`, `update` and `remove`
each gained a `stage*` twin that stops at the plan.

The split is exact: a single write is now `plan()` followed by `#run()`, which
is what it did before. 755 tests passed unchanged across the refactor, before a
line of `unit.js` existed.

## What it does not do

**It is not a lock.** Nothing stops another tab writing the same record between
staging and commit. IndexedDB gives no way to hold a read across a gap, and
inventing one with a flag in a store would be a lock this code could not release
if the tab closed. What this gives is **atomicity, not isolation**, and the
difference is worth naming rather than hoping nobody asks.

**It is not a queue.** Operations apply in the order they were staged. No
dependency graph, no reordering.

## What mutation testing found

Five mutations. Three caught immediately; **two exposed tests that proved
nothing**, and the first is the more interesting:

| Mutation | First result | Fix |
| --- | --- | --- |
| Give each operation its own transaction | **nothing failed** | The two all-or-nothing tests both fail during *staging*, before `commit` is ever called — so they passed whether or not the commit shared a transaction. They test the early refusal, which is real, but not the thing the class exists for. A third test now makes the write fail *inside* the commit, after the first record's `put` has been issued. |
| Never emit change events | **nothing failed** | Nothing checked that screens are told the data changed. Without it a screen shows stale records until something else repaints it — silent, and the kind of thing nobody reports as a bug; they just refresh. Now asserted on the bus. |
| Emit *before* the write lands | caught by the same new test | |
| Let a committed unit accept more work | caught | |
| Let a committed unit be committed twice | caught | |

The first is the same shape found in the retention and service-layer tranches:
a test that passes for a reason unrelated to the property it claims to check.
The tell each time was that it passed on the first run.

## Not done

- **Only one caller.** Statement import is migrated; nothing else composes
  writes yet, because nothing else needed to. `EconomicEvent` will be the
  second and is not built.
- **Receipt reconciliation is deliberately left incremental.** It updates N
  transactions in a loop and reports how many succeeded. Those updates are
  independent of each other, so partial progress across a long list is better
  than discarding it — converting that to all-or-nothing would be a behaviour
  change for the worse, not a fix.
