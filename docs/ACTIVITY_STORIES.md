# Eight Lines, None Of Which Said Which Account

Phase 17's *what changed*. `js/domain/timeline.js`, `js/services/timeline.js`,
the dashboard's activity widget, and two fixes to `tools/field-coverage.mjs`
that the work uncovered.

## What the feed said

Measured against six edits to one account and one to another — an ordinary
afternoon of tidying:

```
Sanjay changed name on an account
Sanjay added an account
Sanjay changed notes on an account
Sanjay changed dueDay on an account
Sanjay changed statementDay on an account
Sanjay changed upiId on an account
Sanjay changed ifsc on an account
Sanjay changed name on an account
```

Eight lines, seven of them the same person and the same record — and **not one
of them says which account**. An audit entry carries an entity name and a
record id; `describe` can reach the entity's *label* and nothing else. Both
screens showing the feed have said this since Phase 0.5.

## A story is one person, one record, one sitting

Six edits between 11:02 and 11:09 are one thing that happened, and the fields
they touched are the detail. Splitting them into six lines is not more
information; it is the same information spread until it stops being readable.

Three things are never merged, each because merging would assert something
false:

- **Two people.** *"Sanjay and Meera changed it"* is a sentence this cannot
  support, and merging would attribute one person's edit to the other.
- **Two records.** Obvious, and the reason `recordId` is part of the key.
- **A create and an update.** *"Added, then changed six things"* and *"changed
  six things"* are different events, and the first says where a record came
  from.

Three field names are listed and the rest are counted: a list of eleven field
names is a list nobody reads.

## It still never says what a value became

The log records **which** fields changed and never their values — deliberately,
because a before-and-after log is a second, unencrypted copy of every sensitive
field in the system. A story names fields and stops. A test fills an entry's
`detail` with an account number and asserts the sentence does not contain it.

## "Since you last looked" is read before it is written

The mark lives in `meta`, is **read** by the service, and is **written by the
screen after it has drawn**. Writing it while answering would clear the answer
in the act of asking for it: a household would open the dashboard and be told
nothing had happened, every time. A test asserts that reading leaves the mark
untouched.

Where there is no mark — a first run — the widget says *Recent activity* rather
than *Since you last looked*, because claiming otherwise would be a statement
about a visit that never happened.

## Two holes in the field-coverage ratchet, found by walking into them

**A comment could silence it.** The tool text-searches source for a field name,
comments included. A doc comment in this tranche quoted the feed above —
*"changed upiId on an account"* — and `account.upiId` came off the unread list
without a line of code touching it. A field name in a comment is a field name
in a sentence; only code counts, so comments are stripped before the search.

**And the first stripper ate real code.** It matched block comments with a
regex, so a file-picker `accept` string containing an image wildcard opened a
comment as far as that regex was concerned — pairing with a close two hundred
lines later and swallowing the only line that reads `document.confidential`.
Replaced with a left-to-right scanner that tracks strings and comments
together. The failure it can still produce — a comment opener inside a regex
literal — reports a field as unread when code names it, which is loud, unlike
the one it replaces.

With comments stripped, the tool found exactly one field that had only ever
been "read" by prose: **`note.pinned`**.

## A pin that moved nothing

`note.pinned` is on the note form. Nothing read it, so pinning a note left it
exactly where it was — a lie a screen tells.

`sortBy` gained comma-separated keys and the note entity sorts
`-pinned,-updatedAt`. One key was enough until a flag had to survive a date
sort, and a list sorted by pin alone would put a note pinned in March above one
edited this morning. Empty values still sort last whichever direction the key
runs: *no date* is not *the earliest date*.

The tool then had to learn that a `sort` spec is a read — the same shape as the
`expiry` and `anniversary` exemptions already there, since `sortBy` reads those
keys generically. That took `certificate.issuedOn` off the inventory too, which
had been on it while ordering the certificates list all along. **77 fields**,
down from 78.

## What mutation testing found

Six mutations, all six caught:

| Mutation | Caught by |
| --- | --- |
| **A create is folded into an update** | *adding is never folded into changing* |
| **Two people's edits merge** | *two people editing the same record are two stories* |
| **The sitting window is ignored** | *the same record a day later is a second story* |
| **A title is never resolved** | *the story names the record, through the real database* |
| **The mark is written while reading** | *the mark is read, and never written by the reading* |
| **`unseen` is always true** | *a first run claimed to know what had been seen* |

## A mistake I made twice in one day

The browser check asserting the feed names a record first asserted `HDFC
Savings` — a record created early, before a CSV import of a hundred rows. The
feed correctly showed the newest stories, which were transactions. Asserting
that record was asserting that nothing had happened since.

Then the replacement check used `/kin|heldAddress|recordedOn/` without word
boundaries and failed on the word **Investments**. The `wired:` probe was given
`\b` on both sides that same day, for exactly this reason, in
`docs/MOVEMENTS_SCREEN.md`.

## What is still not built

A **household timeline** as a screen of its own — this is the dashboard widget,
eight stories deep. Nothing filters by person or by module, nothing spans more
than the most recent 200 entries, and the knowledge-graph and universal-search
half of Phase 17 is untouched.
