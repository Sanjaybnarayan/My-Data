# What Happened To This One

Phase 17's smallest honest piece. `historyOf` and `summariseHistory` in
`js/data/audit.js`, `Database#history`, `RecordsService#history`, a history card
on every record screen, and a `byRecord` index on the audit store.

## The answer was in the log the whole time

`data/audit.js` has written `recordId` on every entry since Phase 0.5. Two
screens read the log — the dashboard's last eight, Settings' last twelve — and
`recentActivity` filters by entity **name**.

So, measured:

```
What the application can ask today:
  by recency         -> 3 entries
  by entity TYPE     -> 6 entries
  by a single RECORD -> nothing answers it
```

The application could say what had happened to *accounts*, and never what had
happened to **this** account — which is the question somebody looking at a
record actually has. Every record screen showed its fields and its revision
number and nothing about how it got that way.

## What every record screen shows now

```
What has happened to this                                    [2 changes]

  Sanjay changed name on an account          15 Aug 2026, 11:04
  Sanjay added an account                    15 Aug 2026, 10:58

The household's own log. It records which fields changed rather than what
they changed to.
```

That last sentence is the log's own design, said where a person reads it rather
than only in a comment: `changedFields` records **which** fields moved and never
their values, because a before-and-after log would be a second, unencrypted copy
of every sensitive field in the system.

The newest six, with a line saying how many there are in all. A record edited
weekly for a year has a long log, and a record screen is not an audit tool.

## `reads` are counted apart from `changes`

`vaultItem` and `identityDocument` log a **read**, deliberately: knowing that
somebody opened a password is the whole reason that logging exists. Folding
those entries into a change count would overstate the edits and hide the reads,
so `summariseHistory` returns both and the badge counts only changes.

## The seam held, and it cost a method rather than an exception

A service may not touch `db.adapter` — the rule that keeps every row read
through the permission check — and `tests/services.test.mjs` enforces it by
scanning for the text. The audit log has **no repository** to read through: it
is not an entity and carries no per-row ACL.

The easy move was to widen the rule. Instead `Database` gained `history()`, so
the one place system stores are reached stays that class and the rule stays
absolute. A caller has already been permitted to read the record itself, and
these are entries about that record and nothing else.

## A `byRecord` index, not a scan

`historyOf` reads off a new index rather than filtering the log. A household's
log grows for as long as they use the application, and a record screen must not
get slower as it does. Structural migrations derive from the schema, so this
cost one edit.

## The survivor was a vacuous test of mine

Four mutations; one survived: blanking the service's `nameOf` for somebody no
longer in the household changed nothing. My test had built **its own lookup**
and asserted against that — so it covered a lambda in the test file and not the
service at all.

Rewritten to take `nameOf` from the service, it fails. The point it makes is
worth keeping: a record changed by somebody since removed still changed, and a
blank there reads as *"nobody"*, which is the one thing it was not.

The three caught: reading the whole log instead of one record's entries, sorting
oldest-first, and counting reads as changes.

## Typecheck fell again, 171 → 169

`recentActivity` and `historyOf` had untyped option bags. Typing them resolved
two more findings — the second time in two tranches that adding `@param` to a
function four callers share has paid for itself.

## What is still not built

This is one record's history, not a **timeline**: nothing groups a household's
log into "what changed this week", nothing collapses thirty edits to one record
into one story, and nothing answers *what changed since I last looked*. The
knowledge graph and universal search half of Phase 17 is untouched.
