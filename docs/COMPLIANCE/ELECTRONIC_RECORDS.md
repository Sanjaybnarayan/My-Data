# Electronic Records: Retention, Integrity and Admissibility

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Directly.** Everything here is an electronic record, and some of it — a
receipt, a will's location, a staff member's attendance — may one day be
produced as evidence of what was held and when.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Every change recorded: who, when, what | `TESTED` | `js/data/audit.js` |
| Where each value came from | `TESTED` | `js/data/provenance.js` |
| The source file kept unmodified | `TESTED` | `js/services/documents.js` |
| Tamper evidence | `NOT_STARTED` | — |

## What exists

**An audit trail written in the same transaction as the change.** Not a
best-effort log written afterwards by whichever screen remembered — the
repository writes the audit entry and the record together, so a change without
an entry is not a state the database can reach. `docs/RECORD_HISTORY.md` shows
what that produces: every record can say what has happened to it.

**Provenance kept with the value.** A field extracted from a document records
which document and which extraction produced it. A figure on a movement can be
traced to the statement row behind it — `docs/EXPLAINABILITY.md` and
`docs/DATA_LINEAGE.md`.

**The original is never overwritten.** An uploaded file is stored as uploaded;
extraction produces new records beside it. `docs/DATA_PROVENANCE.md` records the
rule.

## The gap, and it is a real one

**Nothing makes the audit trail tamper-evident.**

It is a log in the same database as the records it describes, written by the
same code, unlocked by the same key. Somebody who can edit a record can edit its
history. Nothing signs an entry, nothing chains one entry to the next, and
nothing would notice a gap.

That is enough to establish *history* — what this household's own application
believes happened — and not enough to establish *integrity* against somebody
with access. The distinction is exactly the one that matters if a record is ever
disputed, and it should not be discovered at that moment.

A hash chain over audit entries is the obvious shape of a fix and is not
implemented. It is listed as a Phase 20 gap in
[MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md) rather than described
here as though it existed.

## Retention

`js/data/retention.js` supports per-entity periods and deletion propagation —
deleting a document takes its local copy and its Drive file with it. What it
does not do is prune the household's backup Sheet, which is recorded in
[DPDP.md](DPDP.md) as an erasure gap.
