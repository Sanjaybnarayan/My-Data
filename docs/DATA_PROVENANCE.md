# Data Provenance

Phase 0.5, third tranche. `js/data/provenance.js`, tested in
`tests/provenance.test.mjs`.

## The problem

The answer to "where did this figure come from" existed in pieces: a
transaction carries `statement`, a receipt carries `mailbox` and `messageId`, a
document carries `driveFileId`. Each is shaped differently and read by
different code, so nothing could answer the question generically — and
therefore nothing could *report* on it.

"Every important value is traceable to its source" is not a property you have
until you can count the ones that are not.

## Read, not stored

No field added, no record migrated. Like classification, this is a *reading* of
information the records already carry, interpreted through one vocabulary.

A stored provenance column can drift from the record it describes. A derived
one cannot.

The limit that follows is real and is stated rather than hidden: **this is only
as precise as what the record already carries.** A transaction knows which
statement it came from. It does not know which *page*, and this module will not
invent one.

## Confidence is not verification

Kept apart deliberately, and never collapsed into one number.

- **Confidence** — how sure the machine is.
- **Verification** — whether a *person* confirmed it.

A statement that reconciles against the printed closing balance is
`confidence: high`. It is **still `UNVERIFIED`**, because arithmetic agreeing
with arithmetic is not somebody having looked.

`verification` is currently constant at `UNVERIFIED` for every record, and that
is deliberate: **nothing in the schema records a human sign-off, so nothing may
claim one.** When a verification field exists, this is where it will be read
from. Until then, returning anything else would be exactly the confusion this
module was built to prevent.

## What it can read

| Entity | Source | Confidence |
| --- | --- | --- |
| `transaction` with `statement` | the import | `high` reconciled, `medium` not |
| `transaction` without | typed by a person | `high` |
| `receipt` with `messageId` | that email, in that mailbox | `medium` — prose, not a column |
| `document` with `driveFileId` | the file | `medium` if OCR'd |
| `bankStatement` | the file | `high` reconciled, `low` not |

**Hand-entered is a provenance, not a missing one.** It is counted separately
from parsed, because lumping them together would overstate how much of a ledger
came off a bank's own paper.

An entity with no reader returns `UNKNOWN` rather than guessing. Guessing
`MANUAL` would assert that a person typed something nobody typed, and would
hide the gap instead of counting it. `isUnderstood()` distinguishes "this row
is missing its source" from "nothing here knows how to read a source for this
kind of record" — different problems, different fixes.

## A bug caught while writing it

`explain()` first derived its reason from the confidence level alone, so an
unreconciled *statement* row was told it had been "read from wording rather
than a labelled column" — which is why a *receipt* is uncertain and had nothing
to do with that row.

A wrong explanation attached to a real figure is worse than no explanation. The
reason now comes from whichever reader produced it, and a test asserts the
statement row is told it "did not add up" and never sees the word "wording".

## Not done

- `verification` has no field behind it, so no record can be marked checked
- Field-level provenance — this is record-level; a single mis-read *cell*
  cannot yet be traced
- Lineage — the chain (email → attachment → invoice → purchase → warranty) is
  a separate structure and is not built
