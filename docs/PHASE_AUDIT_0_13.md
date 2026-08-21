# Phases 0–13, Audited Against Build Prompt v6.0

Checked against the **MASTER CLAUDE CODE BUILD PROMPT, VERSION 6.0** — the
pasted text itself, not a summary of it. Every status below was measured
against the source tree, not read off `docs/IMPLEMENTATION_ROADMAP.md`, because
the point of an audit is to disagree with the plan where the plan is wrong.

Measured at `91a7d34`. 1,808 checks pass with no browser; 283 more in Chromium.

## First, the thing that nearly went wrong

There are two prompts in this project's history. An earlier
**"MASTER CLAUDE CODE PROMPT"** with no version number and no SMS content, whose
non-negotiable rules stop at 50; and **"MASTER CLAUDE CODE BUILD PROMPT,
VERSION 6.0"**, whose rules run to 57 and whose Phase 6 is SMS Intelligence.

Searching for the obvious title finds the *wrong* one. Audited against it, the
numbering comes out one lower from Phase 6 onward, `IMPLEMENTATION_ROADMAP.md`
looks wrong where it is right, and `CHAT_AND_E2EE.md` looks mislabelled when it
is correct. The version line is the only thing that separates them.

**v6.0 numbering, which is what this file uses:** Phase 6 is SMS, Phase 13 is
Household Staff, Phase 14 is Family Chat.

## Summary

| | Phases |
| --- | --- |
| **Complete and working** | 0, 5, 7, 8, 13 |
| **Complete except for documents** | 4 (Calendar never run live), 11 |
| **Partial — named gaps** | 0.5, 1, 2, 3, 6, 9, 10, 12 |
| **Not started** | none in 0–13 |

Nothing in 0–13 is *built and broken*. The honest failure mode here is
different and worth naming: several phases have **entities without the
intelligence that was supposed to read them**, and one has **a capability that
a PWA cannot have at all**.

---

## Phase 0 — Repository Audit

**Complete.** `docs/PROJECT_AUDIT.md`, pinned to commit `68b9b65`, dated 13
August 2026. Its numbers are stale relative to today and **deliberately left
that way** — it is a dated measurement, and `tools/self-description.mjs`
excludes it for that reason.

## Phase 0.5 — Trust, Security, Privacy, Governance, Consent, Compliance

| Topic | Status |
| --- | --- |
| Trust / Security | **working** — AES-256-GCM per entity+record+field, one data key wrapped by PIN, WebAuthn and recovery phrase; RBAC enforced in the repository, not the UI; session timeout; rate-limited unlock. 46 security checks, 31 escrow |
| Privacy | **working** — six classification levels derived from the schema, masking, and identifiers redacted out of `ocrText` before anything is indexed |
| Governance / Lineage / Provenance / Retention | **working** — `js/data/{classification,lineage,provenance,retention}.js`, one doc each |
| Consent | **working** — `js/data/consent.js`, 32 checks (the doc is `DATA_CONSENT.md`, not the prompt's `CONSENT_MODEL.md`) |
| **Compliance** | **not started — 0 of 20 documents exist** |

**Verdict: partial.** The engineering is done; the compliance half of the phase
has not been begun. This is the largest single documentation gap in the project.

## Phase 1 — Database, API, Authentication, Authorization, RBAC, ABAC

| Topic | Status |
| --- | --- |
| Database | **working** — one storage interface with IndexedDB and in-memory implementations, migrations, single-transaction writes, audit trail. 69 checks |
| API | **exists, undocumented** — `apps-script/Code.gs` serves `doPost`/`doGet` over a `dispatch(action, payload, context)` contract, with 50 backend checks run against literal stubs. There is no `API_CONTRACTS.md`, and no REST surface |
| Authentication | **working** — local PIN, WebAuthn, Google sign-in, recovery phrase. No `AUTHENTICATION.md` |
| Authorization / RBAC | **working, server-authoritative** — `js/security/rbac.js` plus a generated `apps-script/Policy.gs` covering 40<!--live:entities--> entities |
| **ABAC** | **partial — own-record rules only.** No general attribute policy |

**Verdict: partial**, on ABAC and on the undocumented API.

## Phase 2 — Family, People, Identity, Family Tree, CKYC 2.0, Profile Completion

| Topic | Status |
| --- | --- |
| Family / People / Identity | **working** — `person`, `relationship`, `identityDocument`, `kycRecord`, `employment` |
| Family Tree | **working** — `js/domain/tree.js`, 77 checks |
| CKYC 2.0 | **working as a local record** — versioning and a conflict engine including the shared-identifier case, 27 checks. **No CKYCRR registry integration, and correctly so** — there is no consumer API, and inventing one is forbidden |
| **Profile Completion** | **not built.** Nothing in `js/` computes it |

**Verdict: partial.** One named topic of six is absent.

## Phase 3 — Document AI, OCR, Document Management, DOCX Template Engine

| Topic | Status |
| --- | --- |
| Document AI | **working** — 92 extraction checks across statements, policies, agreements, vehicles, receipts, bills, certificates, tax certificates and no-dues letters |
| Document Management | **working** — capture, encrypt on device, per-person Drive folder, preview, search by text found inside the file |
| **OCR** | **built, not necessarily live.** A computer-made PDF is read on the device. A *scan* is pictures of text: it goes to Apps Script, which converts it in the household's own Drive to trigger Google's OCR. **This needs the backend redeployed to take effect** — the code path exists and is not exercised by any check against a real scan |
| DOCX Template Engine | **working** — run-split placeholders, Word's own `MERGEFIELD` and content controls, 27 checks. **No template versioning, and no PDF output from a filled template** |

**Verdict: largely complete**, with OCR the one thing that cannot be called
verified.

## Phase 4 — Gmail, Google Drive, Google Calendar

| Topic | Status |
| --- | --- |
| Gmail | **working** — receipt reading, a merchant registry that builds the query, several mailboxes |
| Google Drive | **working** — document upload, escrowed key wrapping, deletion propagation |
| **Google Calendar** | **built, never run against the live API.** 30 checks, all against stubs |

**Verdict: complete, with one integration unverified against reality.** That is
recorded in the architecture table as a probe-backed row, not as prose.

## Phase 5 — Financial Foundation, Statements, Transactions, Categories, Transfer Matching, Economic Events, Reconciliation

**Complete and working.** 75 statement checks, 35 import, 48 economic-event, 30
transfer. `economicEvent` is a real entity, not a view. Multi-leg movements,
settlement, and a reconciliation that refuses to reconcile rather than guess.
The rules that matter here hold: an account transaction is not an economic
event, an internal transfer is not income or expense, and a card settlement is
not a second expense.

## Phase 6 — SMS Intelligence

| Topic | Status |
| --- | --- |
| SMS Intelligence | **working** — reader, 25 categories, `classify`, `dedupe`, fingerprinting |
| **Android SMS Capability** | **not built, deliberately.** `nativeStatus()` returns `NOT_SUPPORTED` with the reason: a browser cannot read an SMS inbox, an Android companion does not exist, and the permission must not be requested without a current check of Play policy (rule 54) |
| **Real-Time Processing** | **not built** — it depends on native ingestion. Messages arrive by paste or by an exported backup |
| SMS Reconciliation | **working** — linked by UTR/UPI reference first, then account tail and day |
| SMS Security | **working** — the OTP gate runs *before any field is read*, and nothing is stored. Proved across all 47<!--live:stores--> stores, not the one table it would most likely land in |
| SMS Privacy | **working** — the schema has nowhere to put a one-time code |
| SMS Conflict Engine | **working** — ₹5,000 against ₹5,500 is a `CONFLICT` with both figures shown, never a silent choice |

**Verdict: partial, and the missing half is not buildable here.** Five of seven
topics work. The two that do not require an Android application that does not
exist, and the refusal is recorded with its reason rather than left as a to-do.

## Phase 7 — Credit Cards, Loans, EMI, FD, RD, Family Ledger

**Complete and working.** 28 card checks, 28 amortisation, 37 accrual, 33
ledger. FD and RD exist as `account.kind` and `holding.kind` with accrual
behind them. The family ledger runs over the whole imported history with
retroactive correction.

## Phase 8 — Investments, Broker, Zerodha, MCP, P&L, Net Worth

**Complete except brokers, correctly.** XIRR, cost basis, net worth, and MCP
measured and answered. **Zerodha and every other broker remain architecture
only** — no consumer API exists, and fabricating one is forbidden. "Zerodha"
appears in the source only as a name the SMS reader and categoriser recognise.

## Phase 9 — Financial Insights, Forecast, Goals, Family CFO, Anomaly Detection

| Topic | Status |
| --- | --- |
| Financial Insights | **working** |
| Forecast | **working** — cash runway, typical daily spend, next expected income |
| Anomaly Detection | **working** — with seasonality, so December is not an anomaly every year |
| **Goals** | **not built.** No `goal` entity, nothing in `js/` |
| **Family CFO** | **not built.** No screen, no module |

**Verdict: partial.** Three of five.

## Phase 10 — Insurance, Vehicles, Fuel, Property, Tenants, Purchases, Warranty, Subscriptions, Travel

This is the phase where **the entities exist and the intelligence does not.**

| Topic | Status |
| --- | --- |
| Insurance | **working** — `policy`, expiry, renewal reminders, nominee |
| Vehicles | **working** — `vehicle`, `vehicleService`, RC extraction |
| Fuel | **entity only** — `fuelLog` exists; no fuel-bill reading, no mileage |
| Property | **working** — `property`, with rent receipt generation |
| **Tenants** | **two fields, not a feature** — `property.tenantName`, `property.tenantPhone`, `property.deposit`. No tenant entity, no rent ledger, no arrears |
| Purchases | **working via `receipt`** |
| **Warranty** | **an enum value only** — `document.category` includes `warranty`. No warranty extraction, no warranty-specific expiry |
| Subscriptions | **working** — annualised cost, duplicate detection, unrecorded commitments |
| **Travel** | **an enum value only** — a category on transactions, receipts, policies and events. No travel feature |

**Verdict: partial.** Six of nine work; three are placeholders that should not
be counted as built.

## Phase 11 — Health, Medical Records, ABDM Architecture

| Topic | Status |
| --- | --- |
| Health / Medical Records | **working** — `healthRecord`, `medication`, `vaccination`, `appointment`, with diagnoses encrypted |
| ABDM Architecture | **architecture only, correctly** — nothing in `js/` references ABDM. No connector, no fabricated integration. The dedicated `COMPLIANCE/ABDM.md` does not exist |

**Verdict: complete as built**, with the ABDM document outstanding.

## Phase 12 — Legal, Estate, Digital Life, Crypto Metadata

| Topic | Status |
| --- | --- |
| Estate | **working in part** — nominations, nomination gaps, nominee groups, unnominable assets, legacy instructions and unreadable-on-death findings, across accounts, investments and policies. Includes the refusal that a nominee is not an heir |
| Digital Life | **working** — `digitalAsset`, `vaultItem`, `subscription` |
| Crypto Metadata | **working, and metadata only** — `holding.kind` has `crypto`, `digitalAsset.kind` has `crypto wallet`. No keys, no balances, no chain access |
| **Legal** | **not built.** No will, executor or beneficiary entity |

**Verdict: partial.**

## Phase 13 — Household Staff

**Complete and working.** `staff` and `staffLeave` entities, pay reconciliation
that says when a wage does not match what was agreed, absence recording that
distinguishes paid from unpaid leave, Staff and Absences tabs, and per-staff
documents and payments. The rule it enforces: **an agreed figure is not a
payment.** `COMPLIANCE/STAFF.md` does not exist.

---

## Documents required by v6.0

**11 of 44 exist by the required name.**

- Core: 11 of 24. Missing `API_CONTRACTS`, `AUTHENTICATION`, `CONSENT_MODEL`,
  `DATA_DELETION`, `AI_GOVERNANCE`, `AI_PRIVACY`, `FINANCIAL_RECONCILIATION`,
  `CHAT_E2EE`, `LOCATION`, `BACKUP`, `RECOVERY`, `TESTING`, `ROADMAP`.
- Compliance: **0 of 20.**

Missing *by name* is not the same as unaddressed. Several required topics are
covered under a different filename — `CONSENT_MODEL` by `DATA_CONSENT.md`,
`ROADMAP` by `IMPLEMENTATION_ROADMAP.md`, `CHAT_E2EE` by `CHAT_AND_E2EE.md`,
`FINANCIAL_RECONCILIATION` by `SETTLEMENT.md` and `THREE_SOURCES.md`. Others
are genuinely absent: there is no backup, recovery, AI-governance or
API-contract document under any name, and no compliance document at all.

## What an honest next step looks like

Ranked by what is missing rather than by phase number:

1. **The 20 compliance documents** — the only wholly untouched half of a phase
   in 0–13, and the one the prompt is most explicit about.
2. **Phase 10's three placeholders** — tenants, warranty, travel. Each is
   currently a field or an enum value that reads as a built feature.
3. **Profile completion** (Phase 2) and **Goals / Family CFO** (Phase 9) — the
   four named topics with no code at all.
4. **`API_CONTRACTS.md`** — the API exists and is tested; only its contract is
   unwritten.
5. **Legal entities** (Phase 12) — will, executor, beneficiary.

Two things should stay unbuilt: **Android SMS ingestion**, until there is an
Android application and a current reading of Play policy, and **broker,
CKYCRR, DigiLocker and ABDM connectors**, because no consumer API exists and
inventing one is forbidden.
