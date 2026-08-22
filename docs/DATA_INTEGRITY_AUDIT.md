# Data Integrity Audit

**Base:** `1c8d97d` · 22 August 2026.

## What is enforced, and where

| Property | Implemented | Where | Enforced by |
| --- | --- | --- | --- |
| Transactions | Yes | `js/data/idb.js` | IndexedDB |
| Optimistic concurrency | Yes | `version` on every record | `js/data/repository.js` |
| Idempotency | Yes | outbox keyed by record + revision | `js/sync/engine.js` |
| Duplicate detection | Yes | statements, rows, documents | `js/domain/import.js` |
| Unique constraints | Application level | `js/data/validate.js` | not the store |
| Referential integrity | Application level | `ref` / `multiref` validation | not the store |
| Cascading behaviour | Application level | `RecordsService.impactOfDeleting` | shown to the user before deleting |
| Soft delete | Yes | `deletedAt` | deleted rows survive into the archive |
| Versioning | Yes | records and Drive documents | `apps-script/Drive.gs:214-243` |
| Source preservation | Yes | originals never overwritten | `blobs` store + Drive versions |
| Audit trail | Yes | `audit` store, travels into the archive | `js/data/audit.js` |
| Provenance | Yes | `js/data/provenance.js` | |
| Lineage | Yes | `js/data/lineage.js` | |
| Retention | Yes | `js/data/retention.js` | |
| Conflict records | Yes | `conflicts` store, three-way merge with `shadow` | `js/sync/engine.js` |
| Restore | Yes, and it **refuses to merge** | `js/domain/archive.js` | |

## Silent-loss search

The specification asks for every path that can silently lose or overwrite data.
Searched, with results:

| Pattern | Count | Verdict |
| --- | --- | --- |
| `catch {}` / `catch (e) {}` | **0** across 158 files | clean |
| `console.error` as the only handling | none found | clean |
| Ignored promises | none found | clean |
| Sync rejections swallowed | **no** — surfaced at `js/sync/engine.js:212-223` | clean |
| Archive restore over a populated store | **refused**, names what is in the way | clean |
| Original document overwritten | **no** | clean |
| AI writing without review | **no write path exists** | clean |

## The one real integrity exposure

**Records queue in the outbox and never reach the backend**, because every push
is rejected — see `docs/SECURITY_AUDIT.md` P0. Nothing is lost on the device and
the failure is reported in the sync result, so this is not silent data loss. It
is a durability failure: the off-device copy a household believes it has does
not exist.

This is the reason Phase 21 (backup) scores 88 while production readiness scores
40. The **encrypted archive works** and is the real backup; **sync does not**.

## The archive round trip — the strongest integrity evidence here

`tests/archive.test.mjs` does not merely export and count. It restores,
**relocks, unlocks with the PIN the archive was taken under, and reads an
encrypted field back**. That check exists because a mutation which restored the
records but not the keyring passed all 24 earlier tests — producing a restore
that looked successful and left every encrypted field permanently unreadable.
Finding that also exposed a second defect: `Keyring` cached its wrapped keys and
`lock()` did not clear them, so `Keyring.forget()` was added.

`take()` additionally re-opens the sealed archive with the same phrase and
counts it against what went in, through an injectable sealer so a test can seal
through something that truncates and prove the read-back is real.

## What is not enforced at the database level

All of it. IndexedDB has no constraints, no foreign keys, no check constraints
and no triggers. Every rule above is application code. Against the
specification's relational requirement this is the central architectural gap —
recorded in `docs/PHASE_AUDIT_REPORT.md` §19 as an **architectural risk**, with
the qualification that the rules genuinely exist and are genuinely tested, and
that the device-primary design is deliberate rather than accidental.
