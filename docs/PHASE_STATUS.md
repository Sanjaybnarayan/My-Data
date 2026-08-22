# Phase Scorecard — Family OS v6.0

**Audit base:** `1c8d97d` · 22 August 2026. Companion to
`docs/PHASE_AUDIT_REPORT.md`, which carries the evidence.

**Rows refreshed to `367f84f`.** Six phases have changed since the audit base
and are marked ↑ below. The evidence in `PHASE_AUDIT_REPORT.md` still describes
`1c8d97d`; where the two disagree, this table is the later reading. Leaving the
audit's numbers standing would have been the exact fault the audit exists to
catch — a document asserting that built things are unbuilt, and that a fixed
critical defect is still open.

Completion is weighted as the audit brief specifies: architecture 20,
implementation 30, integration 15, testing 15, security 10, documentation 5,
observability 5. **Observability scored 0 for every phase** — there was none
anywhere in the repository, which cost every row 5 points and is why nothing
reaches 100.

That is now partly untrue and is corrected here rather than left standing.
`js/data/diagnostics.js` records failures, refusals and failed syncs on the
device, redacted, and Settings shows them — so *the application* has an
operational record where it had none. Individual phases have **not** been
re-scored for it: a general facility is not per-phase instrumentation, and
adding 5 points to twenty-seven rows for one module would be exactly the
unearned inflation this table exists to avoid. Only Phase 20, where the
control lives, moves.

Two caps are applied as instructed: a phase whose core implementation is missing
cannot exceed 50%, and no phase is COMPLETE if it depends on a fabricated
external integration or has an open critical security or data-integrity defect.

| # | Name | Status | % | Evidence | Critical gaps | Risk |
|---|---|---|---|---|---|---|
| 0 | Repository audit | **COMPLETE** | 90 | 85 docs; `PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `DATA_GOVERNANCE.md`, `SECURITY.md`; 10 ratchet tools in `tools/` | No observability audit | Low |
| 0.5 ↑ | Trust & governance | **PARTIALLY_COMPLETE** | 72 | `security/rbac.js`, `data/consent.js`, `classification.js`, `provenance.js`, `lineage.js`, `retention.js`, `audit` store, device registry; **§8.1 fixed in `76b946f`** — the caller's identity now reaches `dispatch` | Child consent and staff/tenant notice still undecided — both are the household's calls, not code | Medium |
| 1 | Database / API / auth / authz | **REQUIRES_REWORK** | 55 | IndexedDB + 15-action Apps Script API; OAuth + PKCE; RBAC client and server; **referential integrity enforced on local writes**, RESTRICT deletes, deferred constraints in a unit of work | No PostgreSQL, no relational model; the store enforces nothing itself; **sync is exempt** | **Critical** |
| 2 | Family / people / identity / CKYC | **MOSTLY_COMPLETE** | 80 | `person`, `relationship`, `identityDocument`, `kycRecord`, `employment`; `person_id` is the master key; CKYC conflicts modelled | No family-tree view; no per-person profile screen; no CKYCRR (correctly refused) | Low |
| 3 | Document AI / OCR / DOCX | **MOSTLY_COMPLETE** | 78 | `pdf-read.js` (816 lines), `docx.js`, `xlsx`, `extract.js`, `classification`, confidence, versioning, duplicate detection | Image OCR requires the Drive round-trip; no on-device OCR | Low |
| 4 ↑ | Gmail / Drive / Calendar | **MOSTLY_COMPLETE** | 78 | `apps-script/Gmail.gs`, `Drive.gs`, `js/sync/calsync.js`, real scopes, optional Gmail; **connector health for Gmail, Drive and Calendar** through one recorder — `EXPIRED` told apart from `ERROR`, persisted, in diagnostics, and surfaced in Settings only when something needs a person | Scanning is date-windowed, not `historyId`-based; the sync engine is not in the model; the backend is still one deployment for one account | Medium |
| 5 | Financial foundation | **MOSTLY_COMPLETE** | 82 | `categorise.js` (927), `events.js`, `evidence.js`, `settlement.js`, `ledger.js`; statements, CSV/XLS/PDF; Cases 1, 2, 4, 5 pass | No unified conflict record (Case 3); headline not corrected for settlements | Medium |
| 6 ↑ | SMS intelligence | **MOSTLY_COMPLETE** | 72 | `domain/sms.js`, `services/sms.js`, `smsMessage` entity, OTP refusal, `SOURCE_PRIORITY`; **native inbox capture** via `SmsInboxPlugin.java` + `js/core/smsinbox.js`, watermarked sweeps, every count reported | **Never run on a device** — compiles in CI, all JS tested against a fake plugin; `READ_SMS` is a Play restricted permission, so this build is for sideloading; no `SMSEvent`/`SMSSource` entities | Medium |
| 7 | Cards / loans / EMI / FD / RD / ledger | **MOSTLY_COMPLETE** | 76 | `loan`, `card bills`, `amortise.js`, `accrual.js`, `settlement.js`, family ledger, splits | FD/RD classification imprecise (`p2p-out`) | Medium |
| 8 | Investments / broker | **PARTIALLY_COMPLETE** | 42 | `holding`, `investmentTransaction`, `costbasis.js`, `portfolio.js`, P&L, fees | **No broker connector.** Zerodha appears only as a narration regex | Low |
| 9 | Financial intelligence | **MOSTLY_COMPLETE** | 74 | `cfo.js`, `goals.js`, `commitments.js`, `explain.js`, forecasting, anomalies; provenance on figures | No ML; forecasts are rule-based | Low |
| 10 | Insurance / vehicles / property / tenants / purchases | **COMPLETE** | 85 | `policy`, `vehicle`, `vehicleService`, `fuelLog`, `property`, `tenant`, `purchase`, `warranty`, `trip`, `subscription`; schema-driven expiry reminders | No grace-period assumptions (correct) | Low |
| 11 | Health / ABDM | **BLOCKED** | 35 | `healthRecord`, `medication`, `vaccination`, `appointment` all real and encrypted | **ABDM is architecture only** — correctly classified, needs participant status | Low |
| 12 | Legal / estate / digital life | **MOSTLY_COMPLETE** | 75 | `will`, `beneficiary`, `legalDocument`, `digitalAsset`, `subscription`, `vaultItem`; secrets encrypted, never plaintext | No crypto-wallet metadata model | Low |
| 13 | Household staff | **MOSTLY_COMPLETE** | 72 | `staff`, `staffLeave`, wages, agreements, documents; role-limited exposure | No notice or access path for the recorded person | Medium |
| 14 ↑ | Family chat / media / E2EE | **MOSTLY_COMPLETE** | 76 | `js/security/e2ee.js` — ECDH P-256 + HKDF-SHA-256, per-device keypairs, safety numbers, forward-only revocation, escrow; **files sealed to the same devices**, filename inside the seal, own store; **a conversation view that can actually send and read** | **No external cryptographic review**, so it may not be called COMPLETE; no thumbnails or previews; attachments do not sync and are never pruned; escrow opens everything and the screen says so | Medium |
| 15 ↑ | Location / safe zones / SOS | **MOSTLY_COMPLETE** | 70 | `js/domain/geo.js`, `js/core/position.js`, `js/services/safety.js`; native Geolocation preferred over the WebView, accuracy-aware INSIDE/OUTSIDE/**UNCERTAIN**, position history with retention | **No background location** — `ACCESS_BACKGROUND_LOCATION` is deliberately absent and a test enforces it, so zones only evaluate with the app open | Low |
| 16 | Notifications / tasks / reminders / automation | **MOSTLY_COMPLETE** | 73 | `project`, `task`, `event`, `reminders.js` (schema-driven), automation rules, outbox retries, idempotency | No push (no server); background jobs are client-side | Medium |
| 17 | Knowledge graph / search / timeline | **MOSTLY_COMPLETE** | 76 | `search` store, `connections.js`, `timeline.js` + screen, "what changed", authorization-aware search | Graph is derived, not stored | Low |
| 18 | AI family assistant | **PARTIALLY_COMPLETE** | 55 | `ai/assistant.js`, `intents.js`, `mcp.js`, `summary.js`; **read-only, no model, no network** | No language model by design; capability is narrow | Low |
| 19 | Advanced analytics | **MOSTLY_COMPLETE** | 70 | `charts.js`, forecasting, anomaly detection, trends, actual/projected labels | No ML | Low |
| 20 ↑ | Security / privacy / compliance hardening | **PARTIALLY_COMPLETE** | 76 | AES-GCM + PBKDF2, 36 encrypted fields, sanitiser, rate limiting, device trust; **audit trail hash-chained per device** with a verifier a person can run; **local diagnostics**, redacted and never transmitted; 68 compliance controls, **0 VERIFIED** | No external cryptographic review; the chain is tamper-*evidence* only and has no anchor outside the device; no control has been verified, and none may be called compliant until one is | Medium |
| 21 | Backup / restore / portability | **COMPLETE** | 88 | `domain/archive.js` + `services/archive.js`; encrypted archive, verified read-back, restore refuses to merge, keyring travels, deleted rows preserved | No scheduling; on-disk bytes unverifiable from a page | Low |
| 22 | PWA optimisation | **COMPLETE** | 84 | Manifest, 167-entry precache, offline shell, IndexedDB, sync queue, update mechanism, `tools/webroot.mjs` two-way check | No push, no background sync | Low |
| 23 ↑ | Android companion | **PARTIALLY_COMPLETE** | 64 | Capacitor 8.5.0; **debug APK builds in CI**; back button, Filesystem, Share; `allowBackup` off; coarse and fine location; **a first-party SMS plugin**, telephony declared non-required | No background location or geofencing, no screen time, no camera; the SMS permission makes this a sideload build | Medium |
| 24 | iOS companion | **BLOCKED** | 30 | Project generated and synced; RGB icons; no usage descriptions needed | **Never compiled** — no macOS available | Medium |
| 25 ↑ | Internationalisation | **PARTIALLY_COMPLETE** | 45 | `js/core/locale.js` merged in `e5b45df`; schema labels and dates route through it; a translation that drops a placeholder is **refused**; `tools/strings.mjs` measures the rest | **One language.** 3,319 strings are still written into the source, and nothing has been translated | Low |

## Distribution

```
COMPLETE              4   (10, 21, 22, and 0)
MOSTLY_COMPLETE      14   (2, 3, 4, 5, 6, 7, 9, 12, 13, 14, 15, 16, 17, 19)
PARTIALLY_COMPLETE    6   (0.5, 8, 18, 20, 23, 25)
REQUIRES_REWORK       1   (1)
BLOCKED               2   (11, 24)
NOT_STARTED           0
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
