# Data Retention and Erasure

Phase 0.5, fifth tranche. `js/data/retention.js`, tested in
`tests/retention.test.mjs`.

Two questions, and they are not the same one:

1. How long is a deletion held open for second thoughts?
2. When something is finally erased, **what does erasing actually reach?**

The second is the one that gets glossed in most applications, so it is stated
in the plan itself rather than buried here.

## A correction to the Phase 0 audit

The Phase 0 audit said deletion does not propagate. **That was wrong**, and
`docs/PROJECT_AUDIT.md` now carries the correction. Verified by reading the
code:

| Surface | What a soft delete does | Where |
| --- | --- | --- |
| Search index | entry dropped in the same transaction | `js/data/repository.js` |
| Backup spreadsheet | `op: 'delete'` queued and sent | `js/sync/engine.js` |
| Drive document | the file is trashed | `js/modules/documents.js` |

The real gap was different, and worse: **nothing was ever hard-deleted.** Every
delete stamps `deletedAt` and keeps every value. A household that deleted a
vault entry two years ago still had that password sitting in IndexedDB. That is
a defensible *default* — a soft delete is recoverable, and deleting the wrong
thing is far more likely than needing erasure — but it is not a defensible
*only option*.

## Which policy applies

Derived from the module and the classification already in the schema, for the
same reason those are derived: 34 hand-assigned policies would drift.

| Policy | Window | Entities | Why |
| --- | --- | --- | --- |
| `secret` | 7 days | 2 — `vaultItem`, `digitalAsset` | Every extra day a deleted password sits in IndexedDB is a day it can be read off a stolen laptop. |
| `standard` | 90 days | 15 | Long enough to notice a mistake, short enough to mean it. |
| `financial` | 2555 days (7 years) | 10 | Money may be asked about for years. |
| `keep` | never | 7 — identity and health | Not aged out. Can still be erased deliberately. |

A secret is erased **soonest, not latest** — the one place where the intuition
"important things are kept longer" points the wrong way.

## The guard that matters

> A record that is not deleted is never eligible, whatever its age.

Retention governs how long a *deletion* is held open. It is not a licence to
remove things somebody still has. A retention policy that could reach a live
record would be a scheduled data-loss bug with a respectable name — so
`eligible()` returns false before it looks at anything else if `deletedAt` is
absent, and the test for it asserts a four-thousand-day-old live record is
still untouchable.

An unparseable `deletedAt` is treated as **not eligible**, rather than relying
on `NaN` comparisons being false by accident.

## What erasure cannot reach

Returned with **every plan**, not documented and forgotten:

- **Other devices.** Each holds its own IndexedDB. A purge is not a sync
  operation, and making it one would let any device order every other to
  destroy data — a far worse failure than keeping a row too long.
- **The backup spreadsheet's revision history**, which Google keeps.
- **Anything already exported** to a file.
- **Drive's bin**, for thirty days, and any Google backup after that.

So "erased" here means **erased from this device**. Claiming more would be the
kind of promise only discovered to be false when it matters.

## Read before write

`purgeable()` reports what would go, per entity, with counts and the oldest
deletion — and erases nothing. `purge()` takes that plan. Same shape as every
other destructive path in this codebase.

Each row and its search entry go in **one transaction**, so an interrupted
purge cannot leave the index pointing at a record that no longer exists.

## What mutation testing found

Three mutations, and the third is the useful one.

1. *Eligibility ignores `deletedAt`* → 2 tests failed. Good.
2. *Secrets get the standard window* → 1 test failed. Good.
3. *Remove the search-index delete from `purge()`* → **nothing failed.**

The third was not a missing test; it was a test that proved nothing. It
asserted the search entry was absent after purging — which was true whether or
not `purge` touched the index, because the soft delete had already removed it.
The test now asserts the thing that has content: that a **soft delete** clears
the index, which is why a deleted record stops being findable long before it
stops existing.

The line in `purge()` stays, annotated as defensive. It is unreachable today,
and the invariant it protects — no search entry outlives its row — currently
rests on one line in `repository.remove`.

## Not done

- **No UI.** Nothing calls `purgeable` or `purge` yet. This tranche is the
  engine and its guards; the screen that offers it belongs with the rest of
  Settings.
- **No automatic purge.** Nothing runs on a schedule. Given that erasure is
  irreversible and reaches only this device, a household should press the
  button.
- **Documents.** A purged record's encrypted Drive blob is trashed at soft
  delete; the purge does not separately confirm it is gone.
