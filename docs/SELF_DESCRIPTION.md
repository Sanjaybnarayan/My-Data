# The Program's Account Of Itself

`tools/self-description.mjs`, checked in `tests/modules.test.mjs`. The two
second copies it turned up are fixed in `js/data/schema.js` and
`tests/services.test.mjs`.

## What was measured

Nothing here started as a feature. It started as a count, run against the
documents because they are full of counts and nothing had ever checked one.

| The documents said | The program said |
| --- | --- |
| 34 entities | **39** |
| 426 fields | **478** |
| 28 fields encrypted, 6.6% | **34**, **7.1%** |
| 92 of 369 fields unread | **71** of **478** |
| screens call `db.repo(...)` 71 times | **58** |
| four service modules | **11** |
| "Fifteen of the sixteen modules are this file" | **ten of nineteen** |
| a test walks every store — "audit, outbox, search and meta" | the database has **seven** system stores |

Every one of those sentences was true when it was written. Not one was true
when it was read.

## Why none of it was caught

Prose is not executed. `tools/architecture.mjs` already runs a probe for every
row of the architecture tables, and it works — but it checks **rows, not
sentences**, and the drift was all in the sentences around them. The same
blind spot appeared earlier in this project when the line *"Staff, chat and
safety are genuinely absent"* survived the `staff` entity being built.

## The check

Numbers describing the program **as it stands now** carry a marker:

```markdown
- **47**<!--live:entities--> entities, **566**<!--live:fields--> fields
```

The tool reads the schema, finds every marker, and fails when a marked number
disagrees with what it measured. Nine things are measurable: `entities`,
`fields`, `encryptedFields`, `encryptedPercent`, `modules`, `stores`,
`unreadFields`, `uiDatabaseCalls`, `serviceModules`. Twenty-one sites state
them.

It also fails if a measurement **nothing claims** — a key sitting there
checking nothing is worse than no key at all, because the list of keys reads
like coverage.

## History is left alone, deliberately

`docs/PROJECT_AUDIT.md` opens with *"Commit audited: `68b9b65`. Date: 13 August
2026"* and says 28 of 426 fields are encrypted. That is a dated measurement and
it is **correct as written**. Rewriting it to today's 34 of 478 would not
correct a stale number; it would falsify a record of what was true then.

So the marker is opt-in, and the honest cost of that is stated plainly: **this
cannot find a new stale claim that nobody marked.** It guards the sites that
are marked. Marking is a decision made when the sentence is written, and the
question it forces — *is this a fact about the program now, or a note about
what I measured today?* — is the useful part.

The two test counts in `docs/STATUS.md` are outside it too, because a test
total is not derivable without running the tests, and a tool that runs the
suite to check a document would then be checked by the suite. They are named
in that table as the figures nothing guards.

## Two lists that were written twice

Measuring turned up the same fault in two places, and it is the fault the whole
schema-driven design exists to avoid: **a hand-written copy of something the
program already knows.**

### `modules[].entities`

Each entity declares its `module`. Each module also listed its entities, by
hand. The copies had drifted: `economicEvent`, `staff` and `staffLeave` named a
module that did not name them back.

`visibleModules` in `js/security/rbac.js` reads the **hand-written** copy to
decide which navigation items a role sees. So the shape of the failure is:
*an entity missing from that list cannot keep its own module on screen.*

Measured across all five roles, it changes nothing today — every role that can
read `staff` can also read `relationship`, so Family stayed visible for another
reason. That makes it a hazard rather than a live defect, and it is worth
saying so rather than dressing it up: nobody had lost a screen.

The list is now derived, and an entity naming a module that does not exist
throws at load. Two checks hold it: one that the lists agree, and one that a
role able to read any of a module's entities is shown that module. The second
passes with the drifted lists too — it guards the case where the first stops
being harmless.

### The store walk

`docs/SMS_STORAGE.md` claimed the OTP test *"walks every store in the
database"*. It walked `audit`, `outbox`, `search` and `meta`. There are seven:
`shadow`, `conflicts` and `blobs` were not in it. `shadow` holds the last
server-agreed copy of a record with unpushed edits — precisely where a
redacted-but-retained value would survive unnoticed.

Planted the code in `shadow` and re-ran: **the old test passed, the widened one
fails.** Nothing was leaking there, so this was a gap in the proof rather than
a leak in the application. But the document had been making the stronger claim
for as long as the gap existed, and Rule 53 is about proving a negative — a
walk over four of seven stores cannot prove *nowhere*.

It now iterates `Object.keys(systemStores)`, so a store added later is covered
without anybody remembering.

## What the check cost to trust

The first version took the last number-like token within sixty characters of a
marker. Deleting a number outright then left the marker matching a figure from
the neighbouring table cell, and the check passed — the exact failure this file
exists to prevent, inside the thing preventing it. The number must now be
adjacent, with only markup between.

Five mutations, each verified to actually apply before its result was believed:
a stale number, a schema that grew while the docs did not, a deleted number, a
word in place of a number, and an unknown key. All five fail. One earlier round
of mutations reported "caught" for two cases where the `sed` had silently
matched nothing — a mutation that does not mutate proves the same amount as no
mutation at all.
