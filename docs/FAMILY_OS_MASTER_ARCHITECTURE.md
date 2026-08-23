# FamilyOS — Master Architecture

Target architecture, expressed in five layers, with the current position of
each component marked.

> ### This document is checked, not trusted
>
> It was written during Phase 0 and opened with *"nothing here is built yet
> except what is marked **exists**"*. Audited nine phases later, **thirteen rows
> marked `missing` had been built** — consent, provenance, lineage, retention,
> six-level classification, device management, OCR, Google Calendar,
> `EconomicEvent` and more. Anyone trusting it would have planned work that was
> already done, which is exactly what the roadmap has now caught itself doing
> nine times.
>
> So every row carries a **probe**, and `tools/architecture.mjs` runs them in
> CI. A row claiming something exists must cite a file that does; a row claiming
> something is missing must name a term that appears nowhere in the source. The
> second direction is the one that goes stale, because building is what people
> do, and nobody re-reads a table to check whether it is still pessimistic.
>
> **Probes check rows, not sentences.** The prose around these tables went stale
> anyway — it said 34 entities and 426 fields when the schema declared 39 and
> 478 — because no probe reads a paragraph. Numbers describing the program as it
> stands now therefore carry a `<!--live:…-->` marker, and
> `tools/self-description.mjs` checks each one against the schema. Counts
> recorded as history are left unmarked and unchanged on purpose: a dated audit
> saying "28 of 426 fields" was true when it was written, and rewriting it would
> falsify the record rather than correct it.
>
> The gate question in `PROJECT_AUDIT.md` §0 has since been answered — hybrid,
> with a policy-only server — so the conditional branches this document once
> carried have been resolved rather than left open.

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
| **UI → database** | **Not blocked**, and now counted. |

The last edge is the only architectural invariant this project declares and does
not hold. It is not a boolean anybody fixes in one tranche — screens call
`db.repo(...)` **58**<!--live:uiDatabaseCalls--> times — so it is a ratchet
rather than a promise: `tools/architecture-budget.json` holds the count,
`tools/architecture.mjs` fails the build if it rises, and every tranche that
moves a screen onto `js/services/` lowers it permanently.

The service layer exists and is adopted in part:
**22**<!--live:serviceModules--> service modules against those
**58**<!--live:uiDatabaseCalls--> direct calls. Naming the number is what turns
"we should migrate someday" into something with a direction.

---

## Layer 1 — Trust & Governance

| Component | State | Evidence |
| --- | --- | --- |
| Authentication (local) | **exists** | `export:js/auth/lock.js#lockScreen` |
| Authentication (Google) | **exists** | `export:js/auth/google.js#GoogleAuth` |
| MFA | missing | `absent:grep:multi-factor` |
| Session security | **exists** | `export:js/security/session.js#Session` |
| Session revocation, device management | **exists** | `export:apps-script/Code.gs#manageDevices` |
| RBAC | **exists, server-authoritative** | `file:apps-script/Policy.gs` |
| ABAC | **partial — own-record rules only** | `export:apps-script/Policy.gs#ownRecordAllows` |
| Data classification | **exists — six levels** | `export:js/data/classification.js#LEVELS` |
| Documentation counts checked against the schema | **exists** | `export:tools/self-description.mjs#check` |
| Consent engine | **exists** | `file:js/data/consent.js` |
| Provenance | **exists** | `file:js/data/provenance.js` |
| Lineage | **exists** | `file:js/data/lineage.js` |
| Retention / deletion policy | **exists** | `file:js/data/retention.js` |
| Audit | **exists** | `file:js/data/audit.js` |
| Privacy centre | **exists** | `file:js/domain/privacy.js` |
| Local-only switch | **exists** | `export:js/core/config.js#loadLocalOnly` |
| AI governance | **partial — one outbound gate** | `export:js/ai/mcp.js#callTool` |
| Connector permissions | **partial — scope registry** | `file:js/core/scopes.js` |

Eight of these rows said *missing* when this document was written. They were
built across Phases 0.5 and 1 and the document was never updated — which is the
whole reason it now carries probes.

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

25<!--live:modules--> modules exist: dashboard, identity, family, finance, investments,
documents, vehicles, health, insurance, property, education, tasks, calendar,
notes, vault, digital, emergency, reports, settings.

| Component | State | Evidence |
| --- | --- | --- |
| Module registry drives navigation | **exists** | `export:js/data/schema.js#modules` |
| Assistant screen | **exists** | `file:js/modules/assistant-screen.js` |
| Domain-service layer | **exists, barely adopted** | `file:js/services/service.js` |
| Household staff (distinct from family) | **exists — the role, not a second identity** | `wired:js/services/records.js#documentsForStaff` |
| Chat | **exists — real per-device E2EE, with escrow** | `wired:js/services/chat.js#send` |
| Safety | **exists — foreground only, no background capture** | `wired:js/services/safety.js#whereEveryone` |

Privacy is reachable through Settings rather than as a top-level entry, and the
assistant is routed at `#/assistant`. Staff was
absent when this was written and is not any more, and so is safety — with a
qualification that matters more than the row above can carry.

**Chat exists, and the phase document that used to be called "Phase 14 Cannot
Deliver E2EE" was right about the key model it measured.** One household key
cannot give end-to-end encryption, so per-device ECDH keypairs were added
beside it and messages are sealed to those. The claim is now real and narrow:
Google cannot read a conversation and neither can a household member outside
it — but whoever holds the recovery phrase can read every one, there is no
forward secrecy, and no cryptographer has reviewed any of it.
`docs/CHAT_AND_E2EE.md` leads with all three.

**Safety exists, and the reason it was once recorded as "deliberately not
scheduled" has not gone away.** A PWA still cannot deliver background location
or send an SOS. What Phase 15 built is what a foreground application honestly
can: a position read while somebody is looking at the screen, zones compared
against it in arithmetic rather than registered with the operating system, and
an SOS that composes a message for a person to send. Crossing a zone with the
app closed still produces nothing, and `docs/LOCATION.md` opens with that
rather than burying it.

**The architectural debt here is the missing domain-service layer.** Screens
call the repository directly, so every module added before the layer exists is
another caller to migrate.

> ### Correction, made at the start of Phase 1
>
> This paragraph originally continued: *"so authorization, provenance and audit
> are applied by whichever screen remembers to."*
>
> **That was wrong.** `data/repository.js` calls `assertCan` on every `get`,
> `create`, `update`, `remove` and `restore`, applies `rowFilter` to every
> `list`, and writes the audit entry **in the same transaction as the change**.
> A screen cannot forget any of it, because a screen never gets the chance.
> Traced across the whole codebase: outside `data/` and `sync/` there are three
> direct `adapter` calls, all in Settings, all on system stores with no ACL.
>
> The real gap is narrower and different, and it is what the service layer is
> actually for:
>
> - **Assembly has no home.** A screen loads eight entities, feeds them to pure
>   functions in `domain/`, and builds a view model inline — so the assembly can
>   only be tested through a browser, and the list of records an answer needs is
>   re-derived by every screen that wants it.
> - **Cross-entity operations have no home.** `Repository.referencedBy` throws
>   `wrong-layer` on purpose. Anything spanning entities — what deleting a
>   person would break — has nowhere to live but a screen.
>
> Neither is an authorization hole. Both are testability and duplication.

---

## Layer 3 — Intelligence

| Component | State | Evidence |
| --- | --- | --- |
| Categorisation | **exists** | `export:js/domain/categorise.js#categorise` |
| Statement extraction (PDF) | **exists** | `export:js/domain/statement.js#parseStatement` |
| Statement extraction (CSV/card) | **exists** | `export:js/domain/tabular.js#detectHeader` |
| Duplicate detection | **exists** | `export:js/domain/import.js#fingerprint` |
| Reconciliation | **exists** | `export:js/domain/statement.js#reconcile` |
| Receipt reading | **exists** | `export:js/domain/extract.js#readReceipt` |
| Agreement reading — the e-stamp header only; a deed's body is prose | **partial** | `export:js/domain/extract.js#readAgreement` |
| Registration certificate reading | **exists** | `export:js/domain/extract.js#readVehicle` |
| A chassis or engine number never reaches searchable text | **exists** | `wired:js/domain/extract.js#Chassis` |
| A document that gave two expiry dates says so on screen | **exists** | `wired:js/modules/documents.js#expiryConflict` |
| A staff record shows the person's documents, without a second reference | **exists** | `wired:js/modules/family.js#documentsForStaff` |
| Unpaid leave stops a month being judged rather than pro-rating it | **exists** | `export:js/domain/staffpay.js#reconcile` |
| Local assistant | **exists** | `export:js/ai/assistant.js#Assistant` |
| OCR | **exists — Drive's own converter** | `file:apps-script/Drive.gs` |
| DOCX template engine | **exists** | `export:js/domain/docxtemplate.js#readTemplate` |
| A generated document is filed, not only downloaded | **exists** | `wired:js/modules/reports.js#documentStore` |
| Entity resolution | **partial** | `export:js/domain/categorise.js#resolveAliases` |
| Knowledge graph | missing | `absent:grep:knowledgeGraph` |
| Anomaly detection | **exists** | `export:js/domain/unusual.js#unusualSpending` |
| Forecasting | **exists** — cash against known outgoings, never predicting income | `export:js/domain/runway.js#cashRunway` |
| AI privacy gate | **partial — outbound only** | `export:js/ai/mcp.js#describeSurface` |

Two rows here were *missing* and are not: OCR had been implemented in
`apps-script/Drive.gs` before Phase 3 opened, and the receipt reader arrived in
Phase 3 itself. **Anomaly detection and forecasting are genuinely absent** —
measured, not assumed, and the probe fails the build the day either appears.

**Principle to preserve:** the categoriser is deterministic and testable.
Whatever model work arrives later, the rule that *AI confidence is not
verification* means the deterministic path must stay the one that writes.

---

## Layer 4 — Data & Economic Events

53<!--live:entities--> entities, 614<!--live:fields--> fields, declared once in `js/data/schema.js` and used to
derive stores, indexes, validators, forms, columns, Sheets tabs, reminders and
report fields.

**The gap that mattered most, now closed.** The prompt separates an *account
transaction* (what the statement says) from an *economic event* (what happened).
This document called `EconomicEvent` plus a transfer-matching engine *"the
largest single piece of Layer 4 work"*. Both exist, and all ten of the prompt's
financial tests run in `tests/prompt.test.mjs` rather than being claimed in
prose — see `docs/PROMPT_TESTS.md` and `docs/MULTI_LEG.md`.

| Component | State | Evidence |
| --- | --- | --- |
| Schema as single source of truth | **exists** | `export:js/data/schema.js#entities` |
| Economic events | **exists** | `export:js/domain/events.js#proposeMultiLeg` |
| Economic events, on a screen | **exists** | `wired:js/modules/finance.js#ExplainService` |
| Rule 57 — every financial event explainable | **exists** | `export:js/domain/explain.js#explainEvent` |
| Every disagreement about money, in one list | **exists** | `export:js/domain/conflict.js#conflicts` |
| One pattern for a deposit, read by every table that needs it | **exists** | `export:js/domain/categorise.js#DEPOSIT` |
| That list, on a screen a household can reach | **exists** | `wired:js/modules/finance.js#ConflictService` |
| A conflict that picks the right figure | missing, deliberately | `absent:grep:preferredFigure` |
| A record screen can carry an answer its fields cannot | **exists** | `wired:js/modules/crud.js#options.extra` |
| Transfer matching, explicit confidence | **exists** | `export:js/domain/events.js#proposeTransfers` |
| Six-level classification | **exists** | `export:js/data/classification.js#MEANING` |
| Referential integrity | **partial — checked before delete** | `file:js/services/records.js` |
| Multi-currency | **partial — formatter only, records carry no currency** | `export:js/core/money.js#CURRENCIES` |
| `LedgerEntry` | missing | `absent:grep:ledgerEntry` |

Multi-currency is the row most likely to be misread, so it is spelled out: six
currencies are *formattable*, and no record stores which one it is in. Every
amount in the database is assumed to be INR minor units. That is a real
limitation, not a partial feature.

## Layer 5 — Connectors & Ingestion

Contract every connector must meet:

```
CONNECTOR ─> RAW INGESTION ─> VALIDATION ─> NORMALISATION
          ─> ENTITY RESOLUTION ─> TRUST ─> INTELLIGENCE ─> DATA
```

| Connector | State | Evidence |
| --- | --- | --- |
| Google OAuth (multi-account) | **exists** | `export:js/auth/google.js#GoogleAuth` |
| Gmail | **exists** | `file:js/sync/gmail.js` |
| Google Drive | **exists** | `file:js/sync/drive.js` |
| Google Sheets | **exists** — via Apps Script | `file:apps-script/Sheets.gs` |
| Google Calendar | **exists** — never run against the live API | `export:js/sync/calendar.js#CalendarClient` |
| DigiLocker, CKYCRR, ABDM, Account Aggregator, brokers | **absent, and correctly so** | `absent:grep:digilocker` |

Google Calendar was `missing` here and is not. It writes only to a calendar it
created itself, on the narrowest scope Google offers — and **it has never been
run against the live API**, which is stated on the row rather than left for
somebody to discover.

**Rule for all of the above:** architecture may be prepared; connectivity may
not be claimed. A connector with no authorised access reports
`NOT_SUPPORTED` or `LEGAL_REVIEW_REQUIRED` and does nothing else. The
repository currently contains **zero** fabricated integrations, and that
property is worth more than any of them would be.

The `kycRecord` entity added in Phase 2 does **not** move the CKYCRR row and is
not a connector in any state, not even a stub. It is a record the household
types in themselves from a statement, a portal or a letter, with a `source`
field naming which — and the Identity screen states on the page that nothing
was fetched from the registry and nothing is verified, with a browser check
that fails if that sentence is removed. See `docs/KYC.md`.

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
