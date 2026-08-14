# FamilyOS — Master Architecture

Target architecture, expressed in five layers, with the current position of
each component marked. Written during Phase 0; nothing here is built yet
except what is marked **exists**.

> **This document is conditional.** Layers 1 and 4 depend on the open question
> in `PROJECT_AUDIT.md` §0 — whether FamilyOS gains a server. Where the answer
> changes the design, both branches are given rather than one assumed.

---

## The five layers

```
        ┌──────────────────────────────────────────────┐
        │  LAYER 1 — TRUST & GOVERNANCE                │
        │  gates every arrow below it                  │
        └──────────────────────────────────────────────┘
                            ▲
   EXTERNAL ──> LAYER 5 ──> LAYER 3 ──> LAYER 4 ──> LAYER 2 ──> USER
    SOURCE     connector   intelligence   data      experience
```

Forbidden edges, all of which currently hold except the last:

| Edge | Status |
| --- | --- |
| Gmail → database | Blocked. `sync/gmail.js` returns receipts; `domain/inbox.js` plans; the repository writes. |
| Bank → database | Blocked. Statements go through `domain/import.js`, which produces a *plan* first. |
| AI → database | Blocked. `js/ai/` reads only. |
| **UI → database** | **Not blocked.** Screens call `db.repo(...)` directly. See §2. |

---

## Layer 1 — Trust & Governance

| Component | State | Notes |
| --- | --- | --- |
| Authentication (local) | **exists** | PIN / WebAuthn / recovery phrase / Google, two-level key hierarchy |
| Authentication (Google) | **exists** | `js/auth/google.js`, implicit flow, token in memory |
| MFA | missing | |
| Session security | **exists** | Idle timeout drops the data key |
| Session revocation, device management | missing | |
| RBAC | **exists, advisory** | `js/security/rbac.js` — browser-side |
| ABAC | missing | |
| Data classification | **one boolean** | `encrypted: true` on 28 of 426 fields; the prompt asks for six levels |
| Consent engine | missing | |
| Provenance | missing | |
| Lineage | missing | |
| Retention / deletion policy | missing | Soft delete exists; no propagation |
| Audit | **exists** | `js/data/audit.js` |
| Privacy centre | **exists** | `js/domain/privacy.js` — reports what is and is not encrypted |
| Local-only switch | **exists** | Enforced at four egress points |
| AI governance | missing | |
| Connector permissions | **partial** | Scope registry `js/core/scopes.js` |

**The decision that shapes this layer.** Under a serverless architecture,
Layer 1 can enforce *cryptographic* boundaries (a key you do not have) but not
*policy* boundaries (a role you can edit in devtools). Roles would then be
labelled honestly as household convention, not access control. Under a server
architecture, `rbac.js` is mirrored server-side and becomes real.

Either way, one rule must hold and does not yet: **a family relationship must
not automatically grant data access.** Today the backend admits by membership
and applies no role.

---

## Layer 2 — Experience

19 modules exist: dashboard, identity, family, finance, investments,
documents, vehicles, health, insurance, property, education, tasks, calendar,
notes, vault, digital, emergency, reports, settings.

Missing from the prompt's navigation: **people** (distinct from family),
**staff**, **chat**, **safety**, **AI**, **privacy** as a top-level entry.

**The architectural debt here is the missing domain-service layer.** Screens
call the repository directly, so authorization, provenance and audit are
applied by whichever screen remembers to. The fix is a service per domain that
owns those concerns, with screens calling services. This is contained, testable
work and should precede any new module — every module added before it is another
caller to migrate.

---

## Layer 3 — Intelligence

| Component | State |
| --- | --- |
| Categorisation | **exists** — rule-based, four kinds, override map |
| Statement extraction (PDF) | **exists** — column-geometry parser |
| Statement extraction (CSV/card) | **exists** — `js/domain/tabular.js`, four column layouts |
| Duplicate detection | **exists** — fingerprint over immutable fields |
| Reconciliation | **exists** — refuses to call an unbalanced statement ready |
| Receipt reading | **exists** — `js/domain/inbox.js`, ~25 merchants |
| Local assistant | **exists** — rule-based, no model call |
| OCR | missing |
| Entity resolution | missing |
| Knowledge graph | missing |
| Anomaly detection, forecasting | missing |
| AI privacy gate | missing |

**Principle to preserve:** the categoriser is deterministic and testable.
Whatever model work arrives later, the rule that *AI confidence is not
verification* means the deterministic path must stay the one that writes.

---

## Layer 4 — Data & Economic Events

34 entities, 426 fields, declared once in `js/data/schema.js` and used to
derive stores, indexes, validators, forms, columns, Sheets tabs, reminders and
report fields.

**The gap that matters most.** The prompt separates an *account transaction*
(what the statement says) from an *economic event* (what happened). Today:

- categorisation **does** distinguish transfers from spending and income, so an
  internal transfer is already excluded from both totals;
- but there is **no cross-account matching**, so a ₹50,000 debit at HDFC and a
  ₹50,000 credit at ICICI remain two records, not one event.

Implementing `EconomicEvent` + a transfer-matching engine with explicit
confidence (`VERY_HIGH` … `UNMATCHED`, never forcing a match) is the largest
single piece of Layer 4 work and is what the prompt's financial TEST 1–8 are
written against.

Also missing: `LedgerEntry`, referential integrity, multi-currency, and the
six-level classification.

---

## Layer 5 — Connectors & Ingestion

Contract every connector must meet:

```
CONNECTOR ─> RAW INGESTION ─> VALIDATION ─> NORMALISATION
          ─> ENTITY RESOLUTION ─> TRUST ─> INTELLIGENCE ─> DATA
```

| Connector | State |
| --- | --- |
| Google OAuth (multi-account) | **exists** |
| Gmail | **exists** — receipts, query printed before it runs |
| Google Drive | **exists** — documents + key escrow |
| Google Sheets | **exists** — via Apps Script |
| Google Calendar | missing |
| DigiLocker, CKYCRR, ABDM, Account Aggregator, brokers | **absent, and correctly so** |

**Rule for all of the above:** architecture may be prepared; connectivity may
not be claimed. A connector with no authorised access reports
`NOT_SUPPORTED` or `LEGAL_REVIEW_REQUIRED` and does nothing else. The
repository currently contains **zero** fabricated integrations, and that
property is worth more than any of them would be.

---

## What must not regress

Properties this codebase already has that any re-platforming must preserve:

1. **No fabricated connectivity.** Nothing claims a link it does not have.
2. **Encryption is measured, not claimed.** 6.6% of fields, stated on screen.
3. **Reconciliation refuses to lie.** An unbalanced statement is not "ready".
4. **Duplicate imports are caught** by fingerprint, not by filename.
5. **The schema is the single source of truth** for storage, forms and export.
6. **Deletion is recoverable** — soft delete with a restore screen.
7. **The recovery phrase is honestly described** as unrecoverable if lost.
