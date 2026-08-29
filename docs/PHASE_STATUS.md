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
| 0 ↑ | Repository audit | **COMPLETE** | 93 | 147<!--live:docs--> docs; `PROJECT_AUDIT.md`, `ARCHITECTURE.md`, `DATA_GOVERNANCE.md`, `SECURITY.md`; 11 ratchet tools in `tools/`; **`OBSERVABILITY_AUDIT.md`** — the diagnostics store reaches **3 of 207 catch sites**, and the audit found a `KIND.storage` that nothing could ever emit | The other 204 catch sites are uninstrumented, deliberately: the ones worth recording are the six where a failed read changes what a household is told, and that is named rather than done quietly | Low |
| 0.5 ↑ | Trust & governance | **MOSTLY_COMPLETE** | 80 | `security/rbac.js`, `data/consent.js`, `classification.js`, `provenance.js`, `lineage.js`, `retention.js`, `audit` store, device registry; §8.1 fixed in `76b946f`; **consent for staff and children** — recorded per person, surfaced as a gap until answered, and gating nothing | Parental consent is not *verifiable* — nothing checks the adult is the guardian. A staff member can now be shown their own record (`#111`), but cannot sign in to see it themselves — there is no per-person credential | Medium |
| 1 ↑ | Database / API / auth / authz | **REQUIRES_REWORK** | 60 | IndexedDB + 16-action Apps Script API; OAuth + PKCE; RBAC client and server; **referential integrity enforced on local writes**, RESTRICT deletes, deferred constraints in a unit of work; **a one-time code now gates access** — `signin` escrows the data key per person, owner-only, off by default, and `otpVerify` releases it only after the code matched · `wired:js/auth/lock.js#CODE_METHOD` | No PostgreSQL, no relational model; the store enforces nothing itself; **sync is exempt**. Signing in by code is a **deliberate downgrade**, asked for and granted: it makes the household's Apps Script deployment able to decrypt their records, which the recovery phrase it replaces never did. `docs/SIGN_IN_BY_CODE.md` is the whole account | **Critical** |
| 2 ↑ | Family / people / identity / CKYC | **MOSTLY_COMPLETE** | 88 | `person`, `relationship`, `identityDocument`, `kycRecord`, `employment`; `person_id` is the master key; CKYC conflicts modelled; **a family tree** (`domain/tree.js`, the default tab on Family, browser-checked) and **per-person completion** (`domain/profile.js`, drawn on Identity) | No CKYCRR, correctly refused and now checked · `absent:grep:cersai,ckycindia,ckyc.*fetch,download.*ckyc` | Low |
| 3 | Document AI / OCR / DOCX | **MOSTLY_COMPLETE** | 78 | `pdf-read.js` (816 lines), `docx.js`, `xlsx`, `extract.js`, `classification`, confidence, versioning, duplicate detection | Image OCR requires the Drive round-trip; no on-device OCR | Low |
| 4 ↑ | Gmail / Drive / Calendar | **MOSTLY_COMPLETE** | 78 | `apps-script/Gmail.gs`, `Drive.gs`, `js/sync/calsync.js`, real scopes, optional Gmail; **connector health for Gmail, Drive and Calendar** through one recorder — `EXPIRED` told apart from `ERROR`, persisted, in diagnostics, and surfaced in Settings only when something needs a person | Scanning is date-windowed, not `historyId`-based; the sync engine is not in the model; the backend is still one deployment for one account | Medium |
| 5 ↑ | Financial foundation | **MOSTLY_COMPLETE** | 89 | `categorise.js` (927), `events.js`, `evidence.js`, `settlement.js`, `ledger.js`; statements, CSV/XLS/PDF; **Cases 1–6 pass**; **Case 3 closed** — `domain/conflict.js` joins four findings that lived in three shapes on two screens into one derived record type, and detects a fifth nothing looked for: two sources naming different *days* | Headline not corrected for settlements (deliberate, and stated); Booking and maturity are one category, not the two events they are (Case 6's `ASSET_ALLOCATION` split, deliberately not done) | Medium |
| 6 ↑ | SMS intelligence | **MOSTLY_COMPLETE** | 72 | `domain/sms.js`, `services/sms.js`, `smsMessage` entity, OTP refusal, `SOURCE_PRIORITY`; **native inbox capture** via `SmsInboxPlugin.java` + `js/core/smsinbox.js`, watermarked sweeps, every count reported | **Never run on a device** — compiles in CI, all JS tested against a fake plugin; `READ_SMS` is a Play restricted permission, so this build is for sideloading; no `SMSEvent`/`SMSSource` entities | Medium |
| 7 ↑ | Cards / loans / EMI / FD / RD / ledger | **MOSTLY_COMPLETE** | 88 | `loan`, `card bills`, `amortise.js`, `accrual.js`, `settlement.js`, family ledger, splits; **FD/RD read as deposits on all three axes** and `accrual.js` values both, refusing the months it cannot judge | **The connection is offered, never made** — `domain/instalments.js` reports, per RD instalment, the ledger rows that could be the same payment: one is MATCHED, several are AMBIGUOUS with every candidate kept and none chosen, none is UNMATCHED. Nothing writes a link, because a stored judgement is a second copy of one the rows can make again. **No figure moves**: `categorise.js#DEPOSIT` already files RD debits as `sweep`/internal, so an instalment was never counted as spending. A missed instalment is still not detected — a `holding` records no instalment amount, frequency or start date, so there is no schedule to be missing from | Low |
| 8 ↑ | Investments / broker | **PARTIALLY_COMPLETE** | 58 | `holding`, `investmentTransaction`, `costbasis.js`, `portfolio.js`, P&L, fees; **a tradebook can now be imported as a file** — `domain/tradebook.js` maps a broker's own CSV export onto trades, generic and column-mapped rather than per-broker, because nobody here has a real tradebook to verify a parser against · `wired:js/modules/investments.js#tradeimport` | **Still no broker connector, and there will not be one.** The engines existed and nothing but typing could feed them; a downloaded file closes that without an integration. It does not fetch prices, and an unmatched symbol is reported rather than turned into a holding · `absent:grep:kite.zerodha,api.zerodha,kiteconnect,groww.*api` | Low |
| 9 | Financial intelligence | **MOSTLY_COMPLETE** | 74 | `cfo.js`, `goals.js`, `commitments.js`, `explain.js`, forecasting, anomalies; provenance on figures | No ML; forecasts are rule-based | Low |
| 10 | Insurance / vehicles / property / tenants / purchases | **COMPLETE** | 85 | `policy`, `vehicle`, `vehicleService`, `fuelLog`, `property`, `tenant`, `purchase`, `warranty`, `trip`, `subscription`; schema-driven expiry reminders | No grace-period assumptions (correct) | Low |
| 11 | Health / ABDM | **BLOCKED** | 42 | `healthRecord`, `medication`, `vaccination`, `appointment` all real and encrypted; **the four lists now say where they disagree** — a course marked ongoing whose end date passed, an appointment still marked scheduled after the day, a next dose with nothing later recorded, a follow-up date gone by — each phrased as a question rather than a verdict, and a course running out now reaches the reminders, which it never did (`docs/HEALTH.md`) | **ABDM is architecture only** — correctly classified, needs participant status · `absent:grep:abdm.gov,healthid.*fetch,abha.*api,ndhm` | Low |
| 12 | Legal / estate / digital life | **MOSTLY_COMPLETE** | 75 | `will`, `beneficiary`, `legalDocument`, `digitalAsset`, `subscription`, `vaultItem`; secrets encrypted, never plaintext | No crypto-wallet metadata model | Low |
| 13 ↑ | Household staff | **MOSTLY_COMPLETE** | 82 | `staff`, `staffLeave`, wages, contracts, documents; **a `staff` role that sees only the record about them**, consent recorded per person, and a screen to show it to them | Not a login — no per-person credential exists, so it is supervised. Their leave is held and not shown | Medium |
| 14 ↑ | Family chat / media / E2EE | **MOSTLY_COMPLETE** | 76 | `js/security/e2ee.js` — ECDH P-256 + HKDF-SHA-256, per-device keypairs, safety numbers, forward-only revocation, escrow; **files sealed to the same devices**, filename inside the seal, own store; **a conversation view that can actually send and read** | **No external cryptographic review**, so it may not be called COMPLETE; no thumbnails or previews; attachments do not sync and are never pruned; escrow opens everything and the screen says so | Medium |
| 15 ↑ | Location / safe zones / SOS | **MOSTLY_COMPLETE** | 74 | `js/domain/geo.js`, `js/core/position.js`, `js/services/safety.js`; native Geolocation preferred over the WebView, accuracy-aware INSIDE/OUTSIDE/**UNCERTAIN**, position history with retention | **Nothing sends the SOS** — the button composes, records and opens the phone's share sheet, and `sentVia` stays `not sent` because this application cannot know whether a person sent it; **background location is built and unverified** — an Android foreground service records a trail, never run on a phone; still no OS geofencing, so a zone crossing is noticed when the trail is next read rather than at the moment it happens | Medium |
| 16 ↑ | Notifications / tasks / reminders / automation | **MOSTLY_COMPLETE** | 78 | `project`, `task`, `event`, `reminders.js` (schema-driven), automation rules, outbox retries, idempotency | No push (no server); background jobs are client-side. **The gap here read "only the location service posts one — reminders still do not", and it was backwards**: `js/domain/automation.js:273` is the only `new Notification(` in the tree and it is the reminders path, while the location service posts an Android foreground-service notification from Java. A reminder notification now says how many and how urgent and never what, because it is read off a lock screen | Medium |
| 17 | Knowledge graph / search / timeline | **MOSTLY_COMPLETE** | 76 | `search` store, `connections.js`, `timeline.js` + screen, "what changed", authorization-aware search | Graph is derived, not stored | Low |
| 18 | AI family assistant | **PARTIALLY_COMPLETE** | 55 | `ai/assistant.js`, `intents.js`, `mcp.js`, `summary.js`; **read-only, no model, no network** | No language model by design; capability is narrow | Low |
| 19 | Advanced analytics | **MOSTLY_COMPLETE** | 70 | `charts.js`, forecasting, anomaly detection, trends, actual/projected labels | No ML | Low |
| 20 ↑ | Security / privacy / compliance hardening | **MOSTLY_COMPLETE** | 80 | AES-GCM + PBKDF2, 36 encrypted fields, sanitiser, rate limiting, device trust; **audit trail hash-chained per device** with a verifier a person can run; **local diagnostics**, redacted and never transmitted; 68 compliance controls — **45 TESTED, 0 VERIFIED**, none `NOT_STARTED`, and every one held below TESTED now has to state why; breach readiness that refuses to call itself detection | No external cryptographic review; the chain is tamper-*evidence* only and has no anchor outside the device; no control has been verified, and none may be called compliant until one is | Medium |
| 21 | Backup / restore / portability | **COMPLETE** | 88 | `domain/archive.js` + `services/archive.js`; encrypted archive, verified read-back, restore refuses to merge, keyring travels, deleted rows preserved | No scheduling; on-disk bytes unverifiable from a page | Low |
| 22 | PWA optimisation | **COMPLETE** | 84 | Manifest, 167-entry precache, offline shell, IndexedDB, sync queue, update mechanism, `tools/webroot.mjs` two-way check | No push, no background sync | Low |
| 23 ↑ | Android companion | **MOSTLY_COMPLETE** | 84 | Capacitor 8.5.0; **debug APK builds in CI**; back button, Filesystem, Share; `allowBackup` off; coarse and fine location; a first-party SMS plugin; **a background location trail** — foreground service, undismissable notification, off until switched on, `START_NOT_STICKY`, writes nothing itself; **screen time gated by consent**, the first purpose where a refusal stops the read rather than being noted, and now **drawn on a screen** at `#/wellbeing` reached from Profile, which never says "unavailable" — it names which of six states it is and offers only the control that state can act on (`docs/SCREEN_TIME.md`); camera capture works through the file input, and `CAMERA` is deliberately **not** declared because declaring it forces a prompt for something that already works | **It has now run on a real device, and this row used to say it never had.** The household installed the APK and reported back from it: the app installs, launches, renders and is interactive — the soft keyboard behaves, the bottom bar hides while typing, the sync pill and lock control were visible enough to be criticised, and search was reachable and not working. Each of those became a fix in this repository, which is the evidence: they could not have been reported from CI. **What ran is the shell.** The native plugin paths — SMS inbox capture, the background location trail, screen time — were not exercised and remain unverified on hardware, which is why Phase 6 still says so. No OS geofencing, so a crossing is noticed when the trail is next read rather than as it happens; **Play Protect refused to install the build** — `READ_SMS` is a Play *restricted permission* and Android blocks a sideloaded app that asks for one, with no way past the dialog. Split into two flavours: `standard` installs, `sms` needs Play Protect switched off. `docs/INSTALLABLE_BUILD.md` |
| 24 ↓ | iOS companion | **DESCOPED** | 58 | Project generated and synced; RGB icons; **all five plugins linked** after the package sat two behind Android; `NSLocationWhenInUseUsageDescription` added, and the always-on variant deliberately absent; a `macos-latest` workflow that compiles for the simulator | **Descoped by the household on 29 August 2026 — Android only from here.** The score is left at 58 as the reading when work stopped, and it is a **historical** figure: the workflow that earned it is deleted, so nothing checks the iOS project any more and it will rot from this commit onward. What it had reached, verified over 90 runs on `macos-latest`: a real `xcodebuild` against `ios/App/App.xcodeproj` after `npx cap sync ios`, all five plugins linked, unsigned simulator build. What it never reached: a signed build, and running on a device. **The `ios/` project files are kept, unbuilt** — deleting a platform target is more than dropping its build, and reviving this means restoring the workflow and expecting a Capacitor version gap | — |
| 25 ↑ | Internationalisation | **PARTIALLY_COMPLETE** | 48 | `js/core/locale.js` merged in `e5b45df`; schema labels and dates route through it; a translation that drops a placeholder is **refused**; `tools/strings.mjs` measures the rest | **One language.** 3,276<!--live:unroutedStrings--> strings are still written into the source, and nothing has been translated. **The figure was 3,474 and 198 of those were CSS class attributes** — `small muted`, `mono small`, 11 distinct lists — counted as translatable English because `tools/strings.mjs` excluded class lists by shape and required a hyphen. They are now excluded by position, which no sentence can trip and no class list can escape. Translation still needs translators: machine-translating Indian financial and legal vocabulary is what `docs/LOCALISATION.md` argues against | Low |

## What checks this table

`tools/architecture.mjs` reads the rows below as well as those in
`docs/FAMILY_OS_MASTER_ARCHITECTURE.md`. A gap cell may carry a probe after a
`·`, and the probes here are the **refusals** — no CKYCRR, no broker
connector, ABDM architecture only — because those are the rows where this
document going stale would be a safety claim going stale.

It was added after four rows were found asserting that built things were
unbuilt, which is the fault the note above says this table exists to avoid.
`docs/SCORECARD_DRIFT.md` has the list and what it cost.

Nothing checks a **percentage**, and nothing can: the weighting is a
judgement, and a tool that scored it would be inventing certainty.

## Distribution

```
COMPLETE              4   (10, 21, 22, and 0)
MOSTLY_COMPLETE      17   (0.5, 2, 3, 4, 5, 6, 7, 9, 12, 13, 14, 15, 16, 17, 19, 20, 23)
PARTIALLY_COMPLETE    3   (8, 18, 25)
DESCOPED              1   (24)
REQUIRES_REWORK       1   (1)
BLOCKED               1   (11)
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
- **Phase 0.5 and 20** — no longer capped by §8.1, which was fixed in
  `76b946f` and which the Phase 0.5 row already said. This paragraph went on
  asserting an open critical defect after the row above it recorded the fix —
  the exact fault this table exists to catch, inside the table's own summary.
  Both are still held below COMPLETE, for reasons that are current: there has
  been **no external cryptographic review**, and no compliance control has
  been verified by anybody.
- **Phase 11** — BLOCKED rather than incomplete. It is not waiting on code; it
  waits on ABDM participant status.
- **Phase 24 is DESCOPED, and was briefly un-blocked before it was.** This
  note once read *"the other on a macOS machine"*, and CI had provided one 90
  times — `macos-latest` ran `xcodebuild` on every pull request and it
  succeeded, so the phase moved BLOCKED/38 → PARTIALLY_COMPLETE/58. The
  household then chose Android only, and the workflow is deleted. The 58 is
  kept as the reading when work stopped rather than reset to zero: the work
  was done and the runs happened. It is not a current claim, and the row says
  so.
