# Two Answers To One Question

`js/data/database.js`, `js/data/integrity.js`, `js/modules/settings/data.js`,
`tests/data.test.mjs`.

## The rule this breaks

v8.0: **do not claim a feature works if the backend does not actually support
it.** Here the claim is a sentence on a screen — *"Every reference points at a
record that exists"* — and it was not true.

## What was found

Phase 1's gaps name it: **referential integrity is enforced on local writes,
and sync is exempt.** `integrity.js` was written with both halves — a write
guard and an audit — and the audit's own comment says why:

> Integrity is enforced on new writes, so a database that has been synced from
> an older device can still contain rows that would be refused today, and a
> household is better told than left to meet one on a screen that says
> "unknown".

**`danglingIn`, that audit, had zero callers.**

Settings does have a *Check for broken links* button. It calls
`database.js#danglingReferences()` — **a second, independent walk** over the
same question, sharing no logic with the write path. And the two disagreed
about what "exists" means:

```
the write path   Boolean(row) && !row.deletedAt     a deleted row is gone
that walk        Boolean(row)                       a deleted row is here
```

A deletion in this application is **a marker that replicates** — the same
Settings screen says so, four lines above the button. So this is not an exotic
case, it is the ordinary one: a person deleted on another device arrives as a
soft-deleted row, and every document filed under them now points at something
a write would refuse.

Measured, on exactly that:

```
the button on Settings reports : 0 broken references
the write path would refuse it : true

→ the screen says: "Every reference points at a record that exists."
```

**A false reassurance, on the one scenario the audit exists for.** Local
writes are checked; sync is not; and the check that was supposed to cover the
gap answered a different question from the one the writes ask.

## What changed

`danglingReferences()` delegates to `integrity.js#danglingIn` with the write
path's own predicate. One definition of a broken reference instead of two, and
the one that survives is the one a write is refused by — so a row listed on
that screen is a row a write would reject, which is what makes the list worth
acting on.

The screen shows more as a result: `label` is the field's own name — *"Filed
under"* rather than `person` — and `points` names what it cannot find.

## How it is checked

`tests/data.test.mjs`, three cases, mutation-tested both ways:

```
M1  a soft-deleted target counts as present (the original walk)
      FAIL  and so is one whose target was deleted rather than removed
M2  everything is dangling
      FAIL  and a reference the write path accepts is not reported
```

M2 is why the third test exists. Reporting everything as broken satisfies the
first two and is worse than the bug it replaces — it tells a household their
records are damaged when they are not.

## What this does not do

**Sync is still exempt.** This is the audit half working correctly; it is not
the write guard applied to `applyRemote`. Making sync refuse a dangling
reference is a different and larger decision: a device that refuses replicated
rows diverges silently from the household's other devices, which may be worse
than holding a row that points at nothing and saying so. That belongs with the
hosting decision Phase 1 is waiting on.

**Nothing is repaired.** The button reports; the right repair for a broken
reference is a judgement — reattach, clear the field, or restore what was
deleted — and the comment above the method has always said so.

**No claim is made that this has happened to this household.** The scenario is
reachable and now demonstrated in a test; no real database has been inspected.
