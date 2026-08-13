# Data Governance

Almost all of this is **not built**. Recorded so the gap is explicit rather
than discovered later.

| Capability | State |
| --- | --- |
| Audit log | **exists** — `js/data/audit.js` |
| Privacy centre | **exists** — reports encryption field by field |
| Local-only switch | **exists** — enforced at four egress points |
| Soft delete + restore | **exists** |
| Scope registry | **exists** — declared once, checked against the setup doc |
| Consent records | missing |
| Purpose limitation | missing |
| Data classification (6 levels) | missing — one boolean today |
| Provenance | missing |
| Lineage | missing |
| Retention policies | missing |
| Deletion propagation | missing — soft delete does not reach Sheets, Drive or the search index |
| Processor registry | missing |
| Cross-border record | missing |
| Grievance mechanism | missing |
| Child-data handling | missing — a `child` role exists, with no data rules behind it |

## The one to build first

**Classification.** Adding a `classification` level to each field descriptor
gives masking, search filtering, export rules, AI gating and retention a
single thing to key off. Every other item on this list is easier once it
exists, and most are incoherent without it.

## Deletion, stated honestly

Today "delete" stamps `deletedAt`. The record stays in IndexedDB, stays in the
Sheet, and any uploaded file stays in Drive. That is recoverable-by-design and
is the right default for a household — but it is **not erasure**, and nothing
in the application should imply that it is.
