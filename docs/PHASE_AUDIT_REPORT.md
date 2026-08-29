# Family OS — Master Specification Compliance and Phase Status Audit

**Audit base commit:** `1c8d97d` (main) · **Date:** 22 August 2026
**Method:** repository inspection, command execution, and direct experiment. Every
status below is supported by a file path, a command output, or a script that was
run. Where something could not be executed, it says so.

> **In flight and not included:** PR #99 (`claude/phase-25-locale`, commit
> `4e8e235`) adds the localisation layer and is not merged. Phase 25 is audited
> against `main`, where it does not exist. The one place this matters is called
> out in that phase's row.

---

## 1. Executive summary

This is not a prototype. It is a working, offline-first, encrypted household
record keeper with 2,049 passing tests, 325 browser checks, a real Google Apps
Script backend, real Drive/Gmail/Sheets integration, and an unusually honest
documentation culture — zero `TODO`, `MOCK`, `FAKE`, `DEMO` or `PLACEHOLDER`
markers exist anywhere in shipped `js/`, and zero silent `catch {}` blocks.

It also has **one confirmed P0 defect that stops server-side sync working at
all**, found during this audit and reproduced from the repository's own test
harness. See §8.1.

The largest structural gap against the v6.0 specification is not a missing
feature. It is that the specification assumes **PostgreSQL, a relational model,
foreign keys, server-side domain services and API endpoints**, and this
repository is a **browser-native IndexedDB application with a Google Sheets
sync target**. That is a deliberate, documented architecture — but measured
against the spec as written, Phase 1 cannot be marked complete, and several
later phases inherit that.

---

## 2. Current project status

| Dimension | Reading | Basis |
| --- | --- | --- |
| Specification coverage | **~62%** | 23 of 26 phases have real implementation; 3 have none |
| Functional coverage | **~68%** | what a household can actually do on-device |
| Architectural completion | **~45%** | against the spec's relational/server architecture |
| Security readiness | **~55%** | strong crypto and client RBAC; P0 in server authorization wiring |
| Data-integrity readiness | **~70%** | versioning, audit, provenance, conflicts, archive round-trip all real |
| Privacy readiness | **~72%** | classification, masking, consent, retention all implemented |
| **Production readiness** | **~40%** | gated by §8.1, by sync, and by the absence of a relational backend |

These are deliberately not one number. **UI completion is high** (21 modules, 47
entities, every screen real). **Functional completion is high on-device**.
**Architectural completion against v6.0 is low**, because the target
architecture is a different shape. **Production readiness is lowest**, because a
household cannot currently sync.

---

## 3. Current true phase

> **The repository is functionally at Phase 21, with Phase 1 unresolved beneath it.**

This is unusual and worth stating plainly: the project did **not** proceed in
phase order. Phases 2, 3, 5, 7, 9, 10, 12, 13, 16, 17, 18, 19, 20, 21, 22 and 23
have substantial real implementation, while **Phase 1 — the relational database,
API and server-side authorization the spec describes — was never built in the
form the spec assumes**, and Phase 6 (SMS) was explicitly deferred as
policy-ineligible.

Determining a single "current phase" from folder names would give the wrong
answer. From evidence, the honest statement is:

- deepest *completed* work: Phase 21 (backup/restore, verified round-trip)
- deepest *incomplete dependency*: Phase 1 (server architecture, §8.1)

---

## 4. Technology stack

| Technology | Version | Purpose | Location | Status | Risk |
| --- | --- | --- | --- | --- | --- |
| Vanilla ES modules | — | The entire frontend. No framework | `js/` (158 files, 45,747 lines) | Working | Low |
| No bundler | — | Ships source directly | `index.html`, `sw.js` | Working | Low |
| IndexedDB | — | **Primary datastore** | `js/data/idb.js` | Working | See §19 |
| localStorage | — | Theme + device id **only** | `js/ui/theme.js`, `js/data/database.js:47` | Working | Low |
| Web Crypto | — | AES-GCM + PBKDF2-SHA256 | `js/security/crypto.js` | Working | Low |
| Google Apps Script | — | The backend | `apps-script/*.gs` | **P0, §8.1** | Critical |
| Google Sheets | — | Sync target (not relational) | `apps-script/Sheets.gs` | Blocked by §8.1 | High |
| Capacitor | 8.5.0 | Android + iOS shells | `capacitor.config.ts`, `android/`, `ios/` | Working | Low |
| Playwright | 1.62.1 | Browser checks (dev only) | `tests/browser.mjs` | Working | Low |
| TypeScript | 5.9.3 | Type checking of JS via JSDoc | `tsconfig.json` | Working | Low |
| GitHub Actions | — | suite, types, browser, apk | `.github/workflows/` | Working | Low |

**Absent by design:** React/Vue/Next, PostgreSQL, Prisma/Drizzle, an ORM, REST
or GraphQL endpoints, Redis, a queue, a vector database, an OCR service, an LLM
provider, Sentry/observability.

**Dependency audit:** `npm audit` reports **3 moderate** advisories, all
transitively under `@capacitor/cli` → `xcode`, a devDependency that never ships
to a browser or a phone. `npm outdated` shows `@types/node` (22 → 26) and
`typescript` (5.9 → 7.0), both dev-only. **No production dependency is
vulnerable, because there are no production dependencies.**

---

## 5. Current architecture

```
                       ┌──────────────────────────────┐
   Browser / Capacitor │  js/modules/*  (21 screens)  │  Experience
                       └──────────────┬───────────────┘
                                      │  58 direct db.repo() calls (budgeted)
                       ┌──────────────▼───────────────┐
                       │  js/services/*  (17)         │  Service layer
                       └──────────────┬───────────────┘
                       ┌──────────────▼───────────────┐
                       │  js/domain/*  (51)           │  Domain logic
                       └──────────────┬───────────────┘
                       ┌──────────────▼───────────────┐
                       │  js/data/repository.js       │  RBAC + audit + validate
                       │  → js/data/idb.js            │  IndexedDB
                       └──────────────┬───────────────┘
                       ┌──────────────▼───────────────┐
                       │  js/sync/engine.js           │  outbox, shadow, 3-way merge
                       └──────────────┬───────────────┘
                                      │  16 actions, one POST endpoint
                       ┌──────────────▼───────────────┐
                       │  apps-script/Code.gs doPost  │  token verify, rate limit
                       │  → Sheets.gs / Drive.gs      │  ⚠ role dropped here (§8.1)
                       │  → Gmail.gs (optional)       │
                       └──────────────────────────────┘
```

**A service never touches `db.adapter`** — this is enforced by
`tests/services.test.mjs`, which greps `js/services/*.js`. The UI→database
budget is held at **58/58** by `tools/architecture.mjs` and has never been
raised.

### Against the spec's required pipeline

```
EXTERNAL SOURCE → CONNECTOR → RAW INGESTION → TRUST/CONSENT
   → INTELLIGENCE → DATA/ECONOMIC EVENT → EXPERIENCE → USER
```

| Stage | Implemented? | Evidence |
| --- | --- | --- |
| External source | **Partial** | Gmail, Drive, Calendar real; banks/brokers/CKYC/ABDM absent |
| Connector | **Partial** | `js/sync/drive.js`, `apps-script/Gmail.gs`, `Drive.gs` |
| Raw ingestion | **Yes** | `bankStatement`, `receipt`, `smsMessage`, `document` all preserve source |
| Trust / consent | **Yes** | `js/data/consent.js`, `js/data/classification.js`, `js/data/provenance.js` |
| Intelligence | **Yes** | `js/domain/categorise.js`, `extract.js`, `events.js`, `evidence.js` |
| Economic event | **Yes** | `economicEvent` entity + `js/domain/events.js` (§10) |
| Experience | **Yes** | 21 modules |

**The pipeline exists.** It is genuinely the shape the spec asks for. What it
lacks is external sources beyond Google.

---

## 6. Five-layer architecture

| Layer | State | Notes |
| --- | --- | --- |
| **1 · Trust & governance** | Partially implemented | Client RBAC real and tested; **server-side authorization wired wrong (§8.1)**; consent, classification, provenance, lineage, retention, audit and device registry all present |
| **2 · Experience** | Implemented | 21 modules, one generic schema-driven form and table, dark mode, masking |
| **3 · Intelligence** | Implemented | Deterministic. No language model — see §14 |
| **4 · Data & economic events** | Implemented | `economicEvent`, transfer proposals, evidence correlation, settlement report |
| **5 · Connectors & ingestion** | Partially implemented | Google only. Everything else absent or explicitly refused |

---

## 7. Phase 0–25 status

See `docs/PHASE_STATUS.md` for the full scorecard with completion percentages,
evidence and critical gaps. Summary:

- **COMPLETE / MOSTLY_COMPLETE (14):** 0, 2, 3, 5, 7, 9, 10, 12, 13, 16, 17, 19, 21, 22
- **PARTIALLY_COMPLETE (7):** 0.5, 4, 6, 8, 18, 20, 23
- **REQUIRES_REWORK (1):** 1
- **NOT_STARTED (3):** 14, 15, 25
- **BLOCKED (1):** 11

---

## 8. Security findings

### 8.1 · P0 — server-side authorization never receives the caller's role — **FIXED**

> **Resolved after this audit was written.** The context now carries `role` and
> `personId`, and five tests drive push and pull through `doPost`. Percentages
> and readiness figures in §2 and in `docs/PHASE_STATUS.md` are as measured at
> the time of the audit and are **not** restated here — the audit is a
> snapshot, and rewriting its numbers to flatter a later fix is how a report
> stops being one. What changed is recorded in `docs/SECURITY_AUDIT.md`.


**Finding.** `doPost` builds the dispatch context without `role` or `personId`,
both of which `admit()` had just resolved. Every server-side policy decision
therefore evaluates against a default of `'guest'`, which the policy permits to
read nothing and write nothing.

**Evidence.**

- `apps-script/Code.gs:67–73` — the context literal passed to `dispatch`:
  `{ email, owner, isOwner, deviceId, clientVersion }`. **No `role`. No `personId`.**
- `apps-script/Code.gs:456–460` — `admit()` returns `{ …, role, personId }`,
  with a comment stating the role "travels with the identity".
- `apps-script/Sheets.gs:124` — `var role = (context && context.role) || 'guest';`
- `apps-script/Sheets.gs:236` — the same for the pull path.
- `apps-script/Policy.gs:80` — `policyAllows` returns `false` for `guest` on
  every entity.

**Reproduced.** Using the repository's own harness:

```
admit() says the caller is: {"email":"asha@…","role":"spouse","personId":"p-asha"}
ping through doPost        : {"ok":true,"user":"asha@…"}        ← no role key at all
readableEntities('guest')  : []
sheetPush(context as doPost builds it)  → rejected: "a guest may not write account"
sheetPush(context with role: 'spouse')  → passes authorization
```

**Impact.** Push is refused row by row for every caller including the owner;
pull returns nothing. **Google Sheets sync cannot work against a real
deployment.** It fails *closed*, so this is not a confidentiality breach — no
one gets access they should not. It is an availability and durability failure:
a household believes its records are being backed up and they are not.

It is not silent — `js/sync/engine.js:212–223` surfaces each rejection and marks
the outbox entry — so the failure is visible, which is the one thing that keeps
this out of the "silent data loss" category.

**Why no test caught it.** `tests/policy.test.mjs:157–175` calls `sheetPush`
with a hand-built context that *includes* a role, proving the policy works when
given one. `tests/backend.test.mjs` goes through `doPost` but never calls push
or pull. Both ends are covered; the wiring between them is not. **This is the
third occurrence of that exact pattern in this project** — the same shape as the
archive-verification gap and the `fromCsv` tripwire.

**Required action.** Add `role: caller.role` and `personId: caller.personId` to
the context literal in `Code.gs`, and add a test that pushes through `doPost` as
a non-owner and asserts the row is applied. *Not done in this audit — audit
only.*

### 8.2 · Findings that came back clean

| Check | Result |
| --- | --- |
| `eval(` / `new Function(` in shipped `js/` | **0** |
| `innerHTML` assignment | **0** — the only occurrence is a *read* in `js/security/sanitize.js:60`, serialising an allowlisted fragment built by `DOMParser` |
| Tokens in `localStorage` | **0** — `js/auth/google.js:22` documents that the token is held in memory on purpose |
| `client_secret` in source | **0** — the only match is a comment in `js/auth/pkce.js:175` explaining why an installed-app client has none |
| `api_key`, `private_key`, `service_account` | **0** |
| Silent `catch {}` | **0** across all 158 files |
| `TODO`/`FIXME`/`MOCK`/`FAKE`/`DEMO`/`PLACEHOLDER` in `js/` | **0** |
| `XMLHttpRequest`, `WebSocket` | **0** |
| Rate limiting | Present — `apps-script/Code.gs:507`, per-user token bucket |
| Device registry | Present — checked *before* the action runs (`Code.gs:61–64`) |

**Cryptography.** AES-GCM 256 with PBKDF2-SHA256 key derivation
(`js/security/crypto.js:84–91`), 600,000 iterations for the archive
(`js/domain/archive.js`). 36 schema fields are encrypted at rest. This is real,
standard, and correctly used — **but it has not been independently reviewed, and
this audit does not constitute one.**

### 8.3 · P3 — a temporary file was committed · **fixed**

`mask-check.tmp.mjs` sat at the repository root, tracked since `0aeb46a`:
2,647 bytes of scratch verification. Harmless, untidy.

Deleted, after checking what it verified was not lost with it. It drove a
browser through PIN setup, created an `identityDocument` with number
`Z1234567`, and asserted the number was masked in the list, masked on the
record, and revealed on request. `tests/browser.mjs` runs every one of those
checks against the same document and the same number — so the file was
redundant, not load-bearing, and that was established before deleting rather
than assumed.

---

## 9. Privacy findings

Implemented and tested: data classification (`js/data/classification.js`),
masking by default with 36 encrypted fields, consent records
(`js/data/consent.js`), provenance (`js/data/provenance.js`), lineage
(`js/data/lineage.js`), retention (`js/data/retention.js`), a privacy centre in
Settings, and an audit trail that survives into the encrypted archive.

**Two open questions the project has repeatedly raised and never had answered by
the household owner** — both recorded here because they are product decisions,
not defects:

1. **Child consent.** Records about children are created by adults. Nothing
   captures a child's assent, or what happens at majority.
2. **Staff and tenant access.** `staff` and `tenant` are records about third
   parties who did not consent to being in the database. The schema limits
   exposure to role-appropriate fields and asks for no identity number, and says
   so in place — but no notice or access path exists for the person recorded.

---

## 10. Financial integrity findings

The six conceptual cases from the specification, **executed**, not read:

| Case | Expected | Result | Verdict |
| --- | --- | --- | --- |
| **1** HDFC −₹50,000 / ICICI +₹50,000 | ONE internal transfer | 1 proposal, `probable`, movement total **₹50,000** | **PASS** |
| **2** Same payment from SMS + statement + Gmail | One event, three evidence sources | `js/domain/evidence.js` correlates receipt, message and bank row; 20 tests | **PASS** |
| **3** SMS ₹5,000 vs statement ₹5,500 | `FINANCIAL_DATA_CONFLICT` | Transfer pairing declines to pair (₹500 exceeds the ₹100 near-window) — **no conflict is raised by this path** | **PARTIAL** |
| **4** Bank → credit card | `CREDIT_CARD_SETTLEMENT` | Detected, classified, and explained both ways — see below | **PASS with a caveat** |
| **5** Bank → broker | `BROKER_FUNDING` | `investment-out`, `kind: internal`, **not** an expense | **PASS** |
| **6** Bank → FD | `ASSET_ALLOCATION` | `"FD BOOKING HDFC DEPOSIT"` → `p2p-out`, `kind: transfer` | **PARTIAL** |

**Case 4 in detail.** `js/domain/settlement.js` correctly distinguishes two
households: one that imported both the card statement and the bank statement
(the card bill is a double count) and one that imported only the bank statement
(the bill is the *only* record of the spending). Verified:

```
card + bank imported → doubleCounted=1  "₹10,000 includes ₹5,000 of card bills
                                          … Spending without them is ₹5,000."
bank only            → onlyRecord=1     "…because Amex has no statement imported
                                          — the bill is the only record."
```

**The caveat:** the headline expense figure on the finance screen is **not**
corrected — it remains the cash-flow number, with the explanation printed beside
it (`js/modules/finance.js:665–676`). This is a documented, deliberate choice
("a total that quietly shrank because a second file was imported would be worse
than the double count, because nobody would know why"). It is defensible. It is
also a divergence from a literal reading of the spec, and is recorded as one.

**Case 6 in detail.** The safety-critical invariant **holds**: `summarise`
(`js/domain/categorise.js:616`) counts only `categoryKind === 'spending'`, and
`p2p-out` is `kind: 'transfer'`. **An FD booking is never reported as an
expense.** What fails is *precision*: the `sweep` pattern
(`categorise.js:336`) matches `^sweep|FD PREMAT|term deposit` but not
`FD BOOKING`, so a new fixed deposit reads as "Sent to people" rather than an
asset allocation. Wrong label, safe number. **P2.**

> **Closed after this report, and it was worse than "wrong label".** Measuring
> found the deposit listed **in the people ledger** with
> `counterpartyKind: 'person'` beside it, a field the CSV export dumps. The
> cause was three tables in `categorise.js` each carrying their own pattern
> for a deposit: for `FD BOOKING` the rail table recognised it and the
> category table called it a person anyway, and every `sweep` was anchored to
> the start of the narration so `AUTO SWEEP` matched none of the three. Eight
> of twelve deposit narrations read as "Sent to people". One `DEPOSIT` pattern
> now, read by all three. `docs/DEPOSITS.md`.

**Case 3 in detail.** The transfer-pairing path is *correct* to decline: two
amounts ₹500 apart may be two unrelated payments, and
`js/domain/events.js` documents that unequal amounts never match automatically.
But the spec's case is about *the same transaction seen by two sources*, which
is the evidence path, not the pairing path. `js/domain/evidence.js` does compare
amounts across sources and reports disagreement. The gap is that no single
`FINANCIAL_DATA_CONFLICT` record type unifies the two. **P2.**

> **Closed after this report.** `js/domain/conflict.js` is that record type.
> Measuring first found the gap was wider than stated — four findings in three
> shapes across two screens, plus a fifth kind nothing detected at all, where
> two sources matched on a shared reference named days apart and the evidence
> path reported them as agreeing because it compared only amounts.
> `docs/FINANCIAL_CONFLICTS.md`.

**Ambiguity handling — checked because the spec demands it.** One debit that
could pair with either of two credits produced **two `possible` proposals and
zero `probable`**, and `movementTotal` counts only `probable`. An ambiguous
match is offered, never taken. Correct.

---

## 11. Identity / CKYC findings

`person` **is** the master identity. Verified: `personId` is the reference
target throughout the schema, and `js/data/schema.js:159` states in place:

> *"This is not a CKYCRR integration and must never become one by accident."*

PAN, Aadhaar, CKYC KIN and passport are **fields on `identityDocument` and
`kycRecord`**, encrypted, and are **not** primary keys. `kycRecord` models CKYC
conflicts explicitly. There is no CKYCRR connector and the repository refuses to
imply one. **This is exactly right and is the strongest compliance posture in
the project.**

---

## 12. Document AI findings

Real: PDF text extraction (`js/data/pdf-read.js`, 816 lines, hand-rolled), DOCX
read and generate, XLSX, CSV, classification, extraction with confidence,
provenance, versioning, duplicate detection, template field detection.

**Original files are never overwritten** — `js/domain/archive.js` includes the
`blobs` store, and document versioning is in `apps-script/Drive.gs:214–243`
(`driveVersions`, and a copy-then-export path that trashes only the copy).

**OCR of images is not done on-device** — a browser cannot read pixels. The
Apps Script backend copies the file to Drive and uses Google's own conversion.
That is a real integration, and `docs/STATUS.md` states it plainly.

---

## 13. Connector findings

| Connector | Status | Evidence |
| --- | --- | --- |
| Google OAuth | **REAL** | `js/auth/google.js`, `js/auth/googlenative.js`, PKCE S256 |
| Gmail | **REAL** | `apps-script/Gmail.gs`, optional by deployment (`Code.gs:114–120`) |
| Drive | **REAL** | `apps-script/Drive.gs`, `DriveApp` + `UrlFetchApp` |
| Calendar | **REAL** | `js/sync/calsync.js`, `CALENDAR_SCOPE` |
| Sheets | **REAL but blocked** | `apps-script/Sheets.gs` — see §8.1 |
| SMS | **ABSTRACTION ONLY** | `js/domain/sms.js`; `SOURCE.NATIVE` returns `NOT_SUPPORTED` |
| Android | **REAL shell** | Capacitor; APK builds in CI |
| iOS | **PROJECT ONLY** | Generated, never compiled — no macOS available |
| Bank / Account Aggregator | **NOT_IMPLEMENTED** | zero code |
| Zerodha / broker | **NOT_IMPLEMENTED** | the only matches are narration regexes in `categorise.js:341` and `sms.js:133` |
| CKYC / CKYCRR | **NOT_IMPLEMENTED, deliberately** | §11 |
| DigiLocker | **NOT_IMPLEMENTED** | zero occurrences in `js/`; docs only |
| ABDM | **NOT_IMPLEMENTED** | one occurrence, in `js/domain/compliance.js:228`, as a regime |

**No fabricated integration was found.** Every absent connector is either
silent or explicitly refused in writing. This is rare and worth recording as a
positive finding.

---

## 14. AI findings

- **Model provider: none.** `js/ai/` contains no `fetch`, no HTTP, no model
  call. It is a deterministic intent parser over local records.
- **AI never writes.** The only repository call in `js/ai/` is
  `assistant.js:68` — `.list({ limit: 10_000 })`. There is no `.create`,
  `.update` or `.remove` anywhere under `js/ai/`. The path
  `AI → DIRECT DATABASE WRITE` **does not exist**.
- **No data leaves the device**, because nothing is sent anywhere.
- **Prompt injection** is not applicable in the usual sense — there is no prompt.
- `js/ai/mcp.js` exposes intents as MCP tools; still read-only.

The specification's rule *"AI confidence ≠ verification"* is honoured
structurally: confidence values exist on extraction
(`js/domain/extract.js`) and are never treated as verification.

---

## 15. PWA findings

Manifest, service worker with a 167-entry precache list, offline shell,
IndexedDB, an outbox sync queue with three-way merge and conflict records, and
an update mechanism. `tools/webroot.mjs` fails the build if the shipped file
list and the worker's precache list disagree **in either direction**.

Not implemented: push notifications, background sync (both need a server that
does not exist).

---

## 16. Android readiness

Capacitor 8.5.0, real project, **debug APK builds in CI on every push**
(`.github/workflows/android.yml`) — the strongest evidence in the repository,
because it is the one check that runs against a real Android toolchain. Hardware
back button handled; Filesystem + Share used so exports actually save;
`allowBackup` off with a written justification; `INTERNET` is the **only**
permission requested.

**No SMS, location, geofencing, SOS, screen-time or camera permission is
requested or implemented.** Phases 6, 15 and most of 23 are therefore not
deliverable on this build.

---

## 17. iOS readiness

The Xcode project is generated and synced. **It has never been compiled** —
there is no macOS in the build environment, and `docs/CAPACITOR_SETUP.md` says
so rather than implying otherwise. Icons are written as RGB (not RGBA), which is
what App Store Connect checks. Status: **BLOCKED on hardware**, not on code.

---

## 18. UI/UX audit

**Design system:** real and token-driven — `css/tokens.css` carries 176 custom
properties across 1,562 lines of CSS in three files. Dark mode via
`prefers-color-scheme` and `data-theme`. 81 `aria-*` attributes across the UI
and modules. One generic form and one generic table drive all 47 entities.

**Against the target direction** (modern Android-native, Wallet-inspired,
card-based, profile-centric):

| Component | Verdict |
| --- | --- |
| `js/ui/components/basics.js` (card, badge, empty, money) | **KEEP** — already card-based |
| `js/ui/components/form.js` | **KEEP** — schema-driven, 47 entities from one implementation |
| `js/ui/components/table.js` | **REFINE** — responsive already; needs a card-list mode for mobile |
| `js/ui/shell.js` | **REFINE** — navigation exists; bottom nav for mobile not yet |
| `js/ui/components/charts.js` | **KEEP** |
| `css/tokens.css` | **KEEP** — the token layer the target design needs |
| Profile screen | **BUILD_NEW** — no per-person profile page with completion % exists |
| Entity cards (identity/vehicle/insurance as Wallet-style cards) | **BUILD_NEW** |
| `js/modules/settings.js` (110 lines) | **DONE** — the cards moved to `js/modules/settings/`; `tools/module-size.mjs` holds it there |
| `js/data/schema.js` (1,852 lines) | **REFINE** — large but it is a declarative table, not logic |

**Can the existing UI evolve toward the target?** **Yes.** The token layer,
the card primitives and the schema-driven rendering are exactly the right
foundation. The profile-centric layout is additive, not a rewrite.

**Present:** loading states, empty states, error states, confirmation dialogs,
destructive-action guards, sensitive-data masking, search, filters, charts.
**Absent:** skeleton states, family-member switching, per-person profile pages.

---

## 19. Database audit

**Actual database: IndexedDB**, in the browser, on the device
(`js/data/idb.js`). 54 stores — 47 entity stores plus `meta`, `audit`, `blobs`,
`search`, `outbox`, `shadow`, `conflicts`.

| Spec expectation | Reality |
| --- | --- |
| PostgreSQL | **No.** IndexedDB |
| Relational model, foreign keys | **No.** `ref` / `multiref` fields, enforced in `js/data/validate.js`, not by the store |
| Indexes | **Yes** — declared per store in `idb.js` |
| Unique constraints | **Application-level** |
| Cascading behaviour | **Application-level** — `RecordsService.impactOfDeleting` |
| Transactions | **Yes** — IndexedDB transactions |
| Migrations | **Yes** — `js/data/migrations.js` |
| Soft deletes | **Yes** — `deletedAt`, and deleted rows survive into the archive |
| Audit table | **Yes** — `audit` store |
| Provenance / consent / retention / lineage tables | **Yes** — all four exist |
| Financial integrity enforced at database level | **No** — enforced in `js/domain/` |

**ARCHITECTURAL RISK — recorded as the spec requires.** IndexedDB *is* the
primary data store. Per the audit brief this must be marked as an architectural
risk against a specification that requires relational architecture. Two honest
qualifications: the risk is *mitigated* by real versioning, an audit trail,
conflict records and a verified encrypted archive round-trip; and the choice is
**deliberate and documented**, not an accident — the product premise is
"encrypted, on this device".

---

## 20. API audit

One endpoint (`doPost`), 16 actions, verified against the client by
`tools/api-contract.mjs` in both directions.

| Action | Auth | Authz | Validation | Audit | Errors | Rate limit | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bootstrap` | token | owner path | yes | yes | typed | yes | OK |
| `schema` | token | — | manifest | yes | typed | yes | OK |
| `push` | token | **broken (§8.1)** | per row | yes | per row | yes | **P0** |
| `pull` | token | **broken (§8.1)** | — | yes | typed | yes | **P0** |
| `audit` | token | — | yes | — | typed | yes | OK |
| `upload`/`download`/`versions`/`trash`/`folders` | token | owner/member | yes | yes | typed | yes | OK |
| `mail` | token | scope-gated, optional | yes | yes | 501 if absent | yes | OK |
| `members` | token | owner only | yes | yes | typed | yes | OK |
| `devices` | token | identity | yes | yes | typed | yes | OK |
| `verify`, `ping` | token | — | — | — | typed | yes | OK |

Authentication precedes dispatch (`Code.gs:57–71`) — token verified, rate limit
enforced, device recorded, *then* the action runs. **No `UI → DATABASE`,
`AI → DATABASE` or `CONNECTOR → DATABASE` path bypasses the domain layer**: the
UI budget is 58 and enforced, AI is read-only, and connectors go through
`js/sync/engine.js`.

---

## 21. Data integrity audit

Verified present: optimistic concurrency (`version` per record), idempotency in
the outbox, duplicate detection for statements and documents, three-way merge
with `shadow` copies, `conflicts` records, soft delete with restore, full audit
trail, source preservation, and an encrypted archive whose round-trip is tested
including **restore → relock → unlock → read an encrypted field back**.

**Paths that could silently lose or overwrite data — searched for, and the
result:**

- `catch {}` — **zero**.
- Unhandled promises — none found.
- Sync rejection swallowed — **no**, surfaced (`engine.js:212–223`).
- Archive restore over a populated device — **refused**, not merged.
- Original documents overwritten — **no**.
- The one real exposure is **§8.1**: records queue in the outbox and never
  reach the backend. Visible, not silent, but it is the integrity risk that
  matters most today.

---

## 22. Compliance readiness

`node tools/compliance.mjs` — **19 regimes, 68 controls**:

```
41 TESTED · 8 NOT_APPLICABLE · 7 IMPLEMENTED · 7 NOT_STARTED
 4 DESIGNED · 1 LEGAL_REVIEW_REQUIRED · 0 VERIFIED
```

**Nothing claims VERIFIED, and the tool refuses to let it.** A control may cite
only a test file that `tests/run.mjs` actually executes. No compliance claim is
made anywhere in this repository, and none is made here.

Full per-regime table: `docs/COMPLIANCE_READINESS.md`.

---

## 23. Critical risks

This register was itself a source of drift. Five of its twelve entries went on
describing fixed problems, and one described a problem that had grown by 297
lines while listed here — a risk register nobody re-measures is the same fault
as an architecture document nobody checks. Each row now says which it is, and
`tools/module-size.mjs` exists because item 8 proved that writing a number in
prose does not hold it.

**P0**

1. ~~**Server-side authorization receives no role (§8.1).**~~ **Fixed** in
   `76b946f`. The caller's identity now reaches the server.

**P1** — all three are open, and none of them is code this repository can write.

2. **No relational backend.** The spec's Phase 1 is unbuilt in the form it
   describes. Everything downstream inherits this. **A hosting decision, not a
   coding task** — it is waiting on the owner.
3. **iOS never compiled.** Unknown unknowns until a macOS build runs.
4. **Sheets as a sync target enforces no financial constraints.** Integrity is
   entirely application-side. Same decision as 2.

**P2**

5. Credit-card settlement is explained but the headline figure is uncorrected
   (§10). **Open, and deliberate** — `docs/CARD_BILLS.md` argues a total that
   quietly shrank because a second file was imported would be worse than the
   double count. Recorded as a divergence from a literal reading of the spec,
   not as a defect to fix.
6. ~~`FD BOOKING` misclassifies as `p2p-out`.~~ **Fixed.** It was worse than
   the label: the deposit was listed in the people ledger as somebody money
   had been sent to. `docs/DEPOSITS.md`.
7. ~~No unified `FINANCIAL_DATA_CONFLICT` record.~~ **Fixed** — and it joined
   four findings rather than the two named here, plus a fifth nothing had ever
   detected. `docs/FINANCIAL_CONFLICTS.md`.
8. ~~`js/modules/settings.js` is 1,597 lines — a god component.~~ **Fixed**,
   at 1,894 lines — it grew 297 while listed here, because nothing measured
   it. Now an assembly of ~110 lines over seven card files, with
   `tools/module-size.mjs` refusing any crowded file the room to grow again.
9. ~~No observability of any kind.~~ **Fixed** — `js/data/diagnostics.js`
   keeps a bounded, redacted, local-only record of failures and refusals, and
   Settings shows it. It is not per-phase instrumentation and `PHASE_STATUS.md`
   declines to score it as such.

**P3**

10. ~~`mask-check.tmp.mjs` committed at the repository root.~~ **Fixed** —
    deleted after confirming `tests/browser.mjs` makes every check it made.
11. 3 moderate dev-only advisories under `@capacitor/cli`. **Open**, and never
    shipped to a browser or a device.
12. ~~165 type findings held at budget.~~ Still debt, but the ratchet has only
    tightened: **160**, from 169 → 167 → 165 → 161 → 160.

---

## 24. Technical debt

- 160 typecheck findings (budgeted, only ever lowered: 169 → 167 → 165 → 161
  → 160).
- 83 schema fields stored and never read by name (inventoried, deliberate).
- 24 fields no export carries at any setting, 3 of them references.
- `schema.js` 2,099 lines. `settings.js` is now 110 — the cards moved to
  `js/modules/settings/`, and `tools/module-size.mjs` records every file over
  800 lines and refuses to let any of them grow. `schema.js` is frozen at its
  size rather than excused: it is fifty-three entity declarations, which is
  what a schema looks like, and it should not get bigger either.
- 3,282 English strings unreachable by any translation catalogue (measured on
  the PR #99 branch; not present on `main`).

---

## 25. Reusable existing components

`js/data/repository.js` (RBAC + audit + validation in one door),
`js/data/schema.js` (declarative, drives everything), `js/ui/components/form.js`
and `table.js` (47 entities, one implementation), `js/security/crypto.js` and
`keyring.js`, `js/domain/archive.js`, `js/sync/engine.js`, `css/tokens.css`,
and the entire `tools/` ratchet suite. **All keepable under any future
architecture.**

## 26. Requiring refactor

`js/modules/settings.js` (split by concern); `js/ui/components/table.js` (card
mode for mobile); `js/ui/shell.js` (bottom navigation).

## 27. Requiring replacement

`apps-script/Sheets.gs` as the durable store, **if** the spec's relational
requirement is to be met. Nothing else.

## 28. Missing components

Per-person profile screens; Wallet-style entity cards; family-member switching;
skeleton states; observability; push notifications; background sync; Phases 14,
15, 25.

---

## 29. Recommended architecture

Keep the offline-first, encrypted, device-primary design — it is the product's
premise and it works. **Do not replace IndexedDB with PostgreSQL on the
device.** If the spec's relational requirement must be met, meet it *at the
sync target*: replace Google Sheets with a real relational backend behind the
same 16-action contract that `tools/api-contract.mjs` already checks. The client
would not have to change, because the contract is already the seam.

---

## 30. Recommended next phase

> **Phase 1 — repair and complete the server tier. Nothing else.**

**Why this and not another feature phase.** Every phase from 5 onward writes
data that currently cannot leave the device. Building Phase 14, 15 or 25 on top
of a sync layer that rejects every write adds more data to the pile that is not
being backed up. §8.1 is a four-line fix; the architecture question behind it is
not, and both belong to Phase 1.

**Dependencies to fix first**

1. Add `role` and `personId` to the dispatch context (§8.1).
2. Add a test that pushes through `doPost` as a non-owner and asserts the row
   is applied — the missing wiring test, not another end test.
3. Then decide the durable-store question: stay on Sheets knowingly, or move
   behind the existing action contract.

**What must NOT be implemented yet**

Phase 14 (chat/E2EE) — needs per-person keypairs and a real cryptographic
review; the repository correctly refuses to claim E2EE today. Phase 15
(location) — needs a device permission and a privacy decision. Phase 8 (broker)
— needs a legitimate API agreement. Phase 11 (ABDM) — needs participant status.

**Acceptance criteria**

- A non-owner push through `doPost` applies a permitted row and rejects a
  forbidden one, both asserted through the HTTP entry point.
- `pull` returns rows for a spouse and none for a guest, asserted the same way.
- The `role` reaching `Sheets.gs` is the role `admit()` resolved, proven by a
  mutation that removes it and fails a test.
- Sync round-trip: write on device A, pull on device B, byte-identical.
- Every existing ratchet holds: typecheck ≤ 165, UI→database 58, architecture
  61, compliance 0 VERIFIED.

---

## 31. Test execution record

| Command | Result | Duration |
| --- | --- | --- |
| `npm test` | **2049/2049 passed** | 11.3 s |
| `npm run typecheck` | **165 findings (budget 165)** — pass | ~13 s |
| `node tools/lint.mjs` | **no findings across 5 rules** | <1 s |
| `npm run build` | **158 modules, 857 exports, 1.75 MB** | ~2 s |
| `node tests/browser.mjs` | **325/325 browser checks passed** | ~5 min |
| `npm audit` | 3 moderate, dev-only | — |
| `node tools/compliance.mjs` | 68 controls, 0 VERIFIED | — |
| `node tools/architecture.mjs` | 61 claims hold, UI→database 58/58 | — |
| `node tools/field-coverage.mjs` | 82 fields, all accounted for | — |
| `node tools/self-description.mjs` | 32 live numbers match | — |

**No source was altered to make anything pass.**

---

## 32. Roadmap

1. **Phase 1 repair** — §8.1, the wiring test, the durable-store decision.
2. **Phase 20 completion** — server-side authorization tests as first-class.
3. **Phase 4 completion** — incremental sync, revocation handling.
4. **UI evolution** — profile screens and Wallet-style cards on the existing tokens.
5. **Phase 25** — merge PR #99, then translate.
6. **Phase 15** — only after a household privacy decision.
7. **Phase 14** — only with per-person keypairs and an external cryptographic review.
8. **Phases 8 and 11** — only with legitimate API access. Never fabricated.
