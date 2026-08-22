# Phase Scorecard — Family OS v6.0

**Audit base:** `1c8d97d` · 22 August 2026. Companion to
`docs/PHASE_AUDIT_REPORT.md`, which carries the evidence.

Completion is weighted as the audit brief specifies: architecture 20,
implementation 30, integration 15, testing 15, security 10, documentation 5,
observability 5. **Observability scores 0 for every phase** — there is none
anywhere in the repository, which costs every row 5 points and is why nothing
reaches 100.

Two caps are applied as instructed: a phase whose core implementation is missing
cannot exceed 50%, and no phase is COMPLETE if it depends on a fabricated
external integration or has an open critical security or data-integrity defect.

| # | Name | Status | % | Evidence | Critical gaps | Risk |
|---|---|---|---|---|---|---|
| 0 | Repository audit | **COMPLETE** | 90 | 85 docs; `PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `DATA_GOVERNANCE.md`, `SECURITY.md`; 10 ratchet tools in `tools/` | No observability audit | Low |
| 0.5 | Trust & governance | **PARTIALLY_COMPLETE** | 60 | `security/rbac.js`, `data/consent.js`, `classification.js`, `provenance.js`, `lineage.js`, `retention.js`, `audit` store, device registry | **§8.1** — server authz never sees the role; child consent and staff/tenant notice undecided | **Critical** |
| 1 | Database / API / auth / authz | **REQUIRES_REWORK** | 55 | IndexedDB + 15-action Apps Script API; OAuth + PKCE; RBAC client and server; **referential integrity enforced on local writes**, RESTRICT deletes, deferred constraints in a unit of work | No PostgreSQL, no relational model; the store enforces nothing itself; **sync is exempt** | **Critical** |
| 2 | Family / people / identity / CKYC | **MOSTLY_COMPLETE** | 80 | `person`, `relationship`, `identityDocument`, `kycRecord`, `employment`; `person_id` is the master key; CKYC conflicts modelled | No family-tree view; no per-person profile screen; no CKYCRR (correctly refused) | Low |
| 3 | Document AI / OCR / DOCX | **MOSTLY_COMPLETE** | 78 | `pdf-read.js` (816 lines), `docx.js`, `xlsx`, `extract.js`, `classification`, confidence, versioning, duplicate detection | Image OCR requires the Drive round-trip; no on-device OCR | Low |
| 4 | Gmail / Drive / Calendar | **PARTIALLY_COMPLETE** | 62 | `apps-script/Gmail.gs`, `Drive.gs`, `js/sync/calsync.js`, real scopes, optional Gmail | Incremental sync partial; revocation handling thin; multi-account not supported | Medium |
| 5 | Financial foundation | **MOSTLY_COMPLETE** | 82 | `categorise.js` (927), `events.js`, `evidence.js`, `settlement.js`, `ledger.js`; statements, CSV/XLS/PDF; Cases 1, 2, 4, 5 pass | No unified conflict record (Case 3); headline not corrected for settlements | Medium |
| 6 | SMS intelligence | **PARTIALLY_COMPLETE** | 45 | `domain/sms.js`, `services/sms.js`, `smsMessage` entity, OTP refusal, `SOURCE_PRIORITY`, 22 tests | **No native capture.** `SOURCE.NATIVE` → `NOT_SUPPORTED`; manifest has only `INTERNET` | Low |
| 7 | Cards / loans / EMI / FD / RD / ledger | **MOSTLY_COMPLETE** | 76 | `loan`, `card bills`, `amortise.js`, `accrual.js`, `settlement.js`, family ledger, splits | FD/RD classification imprecise (`p2p-out`) | Medium |
| 8 | Investments / broker | **PARTIALLY_COMPLETE** | 42 | `holding`, `investmentTransaction`, `costbasis.js`, `portfolio.js`, P&L, fees | **No broker connector.** Zerodha appears only as a narration regex | Low |
| 9 | Financial intelligence | **MOSTLY_COMPLETE** | 74 | `cfo.js`, `goals.js`, `commitments.js`, `explain.js`, forecasting, anomalies; provenance on figures | No ML; forecasts are rule-based | Low |
| 10 | Insurance / vehicles / property / tenants / purchases | **COMPLETE** | 85 | `policy`, `vehicle`, `vehicleService`, `fuelLog`, `property`, `tenant`, `purchase`, `warranty`, `trip`, `subscription`; schema-driven expiry reminders | No grace-period assumptions (correct) | Low |
| 11 | Health / ABDM | **BLOCKED** | 35 | `healthRecord`, `medication`, `vaccination`, `appointment` all real and encrypted | **ABDM is architecture only** — correctly classified, needs participant status | Low |
| 12 | Legal / estate / digital life | **MOSTLY_COMPLETE** | 75 | `will`, `beneficiary`, `legalDocument`, `digitalAsset`, `subscription`, `vaultItem`; secrets encrypted, never plaintext | No crypto-wallet metadata model | Low |
| 13 | Household staff | **MOSTLY_COMPLETE** | 72 | `staff`, `staffLeave`, wages, agreements, documents; role-limited exposure | No notice or access path for the recorded person | Medium |
| 14 | Family chat / media / E2EE | **NOT_STARTED** | 0 | `docs/CHAT_AND_E2EE.md` records the refusal | One household data key, no per-person keypairs. **Correctly refuses to claim E2EE** | — |
| 15 | Location / safe zones / SOS | **NOT_STARTED** | 0 | Zero references in `js/` | Needs a device permission and a privacy decision | — |
| 16 | Notifications / tasks / reminders / automation | **MOSTLY_COMPLETE** | 73 | `project`, `task`, `event`, `reminders.js` (schema-driven), automation rules, outbox retries, idempotency | No push (no server); background jobs are client-side | Medium |
| 17 | Knowledge graph / search / timeline | **MOSTLY_COMPLETE** | 76 | `search` store, `connections.js`, `timeline.js` + screen, "what changed", authorization-aware search | Graph is derived, not stored | Low |
| 18 | AI family assistant | **PARTIALLY_COMPLETE** | 55 | `ai/assistant.js`, `intents.js`, `mcp.js`, `summary.js`; **read-only, no model, no network** | No language model by design; capability is narrow | Low |
| 19 | Advanced analytics | **MOSTLY_COMPLETE** | 70 | `charts.js`, forecasting, anomaly detection, trends, actual/projected labels | No ML | Low |
| 20 | Security / privacy / compliance hardening | **PARTIALLY_COMPLETE** | 58 | AES-GCM + PBKDF2, 36 encrypted fields, sanitiser, rate limiting, device trust, 68 compliance controls, 0 VERIFIED | **§8.1**; no external cryptographic review | **Critical** |
| 21 | Backup / restore / portability | **COMPLETE** | 88 | `domain/archive.js` + `services/archive.js`; encrypted archive, verified read-back, restore refuses to merge, keyring travels, deleted rows preserved | No scheduling; on-disk bytes unverifiable from a page | Low |
| 22 | PWA optimisation | **COMPLETE** | 84 | Manifest, 167-entry precache, offline shell, IndexedDB, sync queue, update mechanism, `tools/webroot.mjs` two-way check | No push, no background sync | Low |
| 23 | Android companion | **PARTIALLY_COMPLETE** | 52 | Capacitor 8.5.0; **debug APK builds in CI**; back button, Filesystem, Share; `allowBackup` off | No SMS, location, geofencing, SOS, screen time, camera | Medium |
| 24 | iOS companion | **BLOCKED** | 30 | Project generated and synced; RGB icons; no usage descriptions needed | **Never compiled** — no macOS available | Medium |
| 25 | Internationalisation | **NOT_STARTED** | 0 | Nothing on `main` | Locale layer exists on PR #99, unmerged. On `main` there is no layer at all | — |

## Distribution

```
COMPLETE              4   (10, 21, 22, and 0)
MOSTLY_COMPLETE      10   (2, 3, 5, 7, 9, 12, 13, 16, 17, 19)
PARTIALLY_COMPLETE    7   (0.5, 4, 6, 8, 18, 20, 23)
REQUIRES_REWORK       1   (1)
BLOCKED               2   (11, 24)
NOT_STARTED           3   (14, 15, 25)
```

## What the percentages do and do not mean

They measure *implementation against the specification*, not quality. Phase 14
scores 0 and that is the **correct** outcome: building chat without per-person
keypairs and calling it end-to-end encrypted would score higher and be worse.
Phase 8 scores 42 with no broker connector, and fabricating one would score
higher and be worse.

Three phases are held below where their code alone would put them:

- **Phase 1 (55)** — raised from 40 by `js/data/integrity.js`, which gives the
  constraint *behaviour* a foreign key would: references are checked on create
  and update, a delete that would break a required one is refused, and a unit
  of work defers the check the way a relational database does. Still capped,
  because the store enforces none of it and sync bypasses it —
  `docs/REFERENTIAL_INTEGRITY.md` states both limits. The remaining half is a
  hosting decision, not code.
- **Phase 0.5 and 20** — capped by the open critical defect in §8.1 of the
  report. Neither may be COMPLETE while server-side authorization does not
  receive the caller's identity.
- **Phase 11 and 24** — BLOCKED rather than incomplete. Neither is waiting on
  code: one waits on ABDM participant status, the other on a macOS machine.
