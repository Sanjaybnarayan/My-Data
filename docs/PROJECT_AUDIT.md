# Phase 0 — Repository Audit

Audit only. No features were built, no functionality removed, no data migrated.

Commit audited: `68b9b65` (main), plus open PR #18.
Date: 13 August 2026.

---

## 0. The finding that governs every other one

**This repository has no server.**

FamilyOS today is a browser application. Records live in IndexedDB on the
device; the only backend is a Google Apps Script web app that the household
deploys into *their own* Google account, which writes a Sheet and files in
their Drive. There is no application server, no relational database, no
server-side session, and no place where the application's own authorization
code runs outside the user's browser.

That is a deliberate design — it is what lets the project promise that nobody,
including its author, holds the data. It is also **incompatible with several of
the master prompt's non-negotiable rules as written**:

| Rule | Status against this repository |
| --- | --- |
| 44 — database constraints for financial integrity | **Cannot hold.** IndexedDB has no constraints, no foreign keys, no `CHECK`. |
| 45 — database transactions for financial operations | **Partial.** IndexedDB gives atomic multi-store transactions on one device; there is no cross-device transaction. |
| 46/47 — never trust client-side authorization; server-side is authoritative | **Does not hold.** All RBAC is in `js/security/rbac.js`, in the browser. |
| 42 — do not use localStorage as the primary database | **Holds.** Primary store is IndexedDB (§3). |

This is the central architectural decision of the whole programme, and it is
not mine to make. Three coherent answers exist and they lead to very different
roadmaps:

1. **Keep it serverless.** Accept that authorization is advisory, that the
   device owner can read their own database, and that "roles" are a
   presentation concern rather than a security boundary. Cheapest, most
   private, and honest — but rules 46/47 must be struck, and a `CHILD` role
   can never be a real access control.
2. **Add a server.** PostgreSQL, an API, server-side authorization. Satisfies
   the rules as written, and changes the product's core promise: someone would
   then operate a database containing many families' records.
3. **Hybrid.** Keep local-first storage, add a server only for what genuinely
   needs a trusted third party — cross-member sharing, chat, staff, tenants.

**Nothing further should be built until this is decided**, because Phase 1
("Database, API, Authentication, Authorization, Core Infrastructure") means
entirely different work under each. This is the single question Phase 0 exists
to surface, and it is put to you rather than answered here.

---

## 1. Current architecture

Five directories under `js/`, 88 modules, 24,838 lines, no runtime
dependencies.

```
index.html ──> js/app.js ──> lock screen ──> shell + router
                  │
                  ├── js/data/       schema, IndexedDB, repository, validation, search
                  ├── js/security/   crypto, keyring, escrow, RBAC, sanitise, session
                  ├── js/domain/     categorise, import, statement, tabular, ledger, …
                  ├── js/modules/    one screen per module (15)
                  ├── js/sync/       transport, engine, outbox, drive, gmail, conflict
                  ├── js/ai/         assistant, intents, summary (local, rule-based)
                  ├── js/reports/    csv, xlsx, pdf, build
                  └── js/ui/         dom, router, shell, theme, components
```

**The schema is the program.** `js/data/schema.js` declares 34 entities and 426
fields; from it are derived the object stores, indexes, validators, forms, list
columns, Sheets tabs, reminder fields, report columns and the assistant's
vocabulary. Adding an entity is a schema edit, not fifteen file edits. This is
the strongest asset in the codebase and should survive any re-platforming —
it is a domain model, not a storage detail.

## 2. Technology stack

| Layer | Today |
| --- | --- |
| Language | Vanilla ES2023 modules, no framework, no build step |
| UI | Hand-rolled DOM helpers (`js/ui/dom.js`), hash router |
| Storage | IndexedDB via `js/data/idb.js` |
| Crypto | WebCrypto — AES-GCM, PBKDF2, WebAuthn PRF |
| Backend | Google Apps Script (1,277 lines) in the household's account |
| Transport | `AppsScriptTransport` over `fetch` |
| Build | `tools/bundle.mjs` — optional single-file bundle |
| Tests | Own harness; 637 unit checks, 142 browser checks (Playwright) |
| Deploy | GitHub Pages workflow; `netlify.toml` also present |

## 3. Data storage — what is where

| Store | Holds | Assessment |
| --- | --- | --- |
| **IndexedDB** | All records, documents, outbox, audit, search index | Primary database. Correct choice for local-first. |
| **localStorage** | Device id, theme, unlock-attempt counter | 6 references, all non-record. **Rule 42 satisfied.** |
| **sessionStorage** | — | Unused. |
| **In memory** | Data key, OAuth access token | Correct. Token never persisted (`js/auth/google.js`). |
| **Google Sheets** | Backup of every record, one tab per entity | In the household's own account. |
| **Google Drive** | Uploaded documents; the escrowed unlock key | Same. |

**Encryption reality: 28 of 426 fields (6.6%) are ciphertext.** The rest is
plaintext in IndexedDB and plaintext in the Sheet. This is a deliberate
trade — a field must be readable to be searchable, and a search index over
ciphertext finds nothing — and the application states it on the Privacy screen
rather than implying more. Measured, not claimed. It is nonetheless the
number to look hardest at against the prompt's data-classification
requirements: `HIGHLY_SENSITIVE` and `CRITICAL_SECRET` are not currently
distinguishable in the schema, which has one boolean (`encrypted`) where the
prompt asks for six levels.

## 4. Existing integrations

| Connector | State | Honest? |
| --- | --- | --- |
| Google OAuth | Implemented, hand-rolled implicit flow, no SDK | Yes |
| Google Sheets | Via Apps Script backend | Yes |
| Google Drive | Documents + unlock-key escrow | Yes |
| Gmail | `js/sync/gmail.js` + `js/domain/inbox.js`, receipts only | Yes |
| Google Calendar | **Not implemented** | — |
| DigiLocker / CKYCRR / ABDM / AA / brokers | **Not present** | Nothing fabricated |

Against the prompt's "no fake integrations" rules (18–23): **the repository
contains no fabricated connectivity.** Nothing claims a government, bank or
broker link it does not have. `js/modules/receipts.js` goes further and
explains on screen *why* there is no "Connect Zomato" button.

## 5. Authentication

- **Local unlock** — PIN (PBKDF2, 600k rounds) / WebAuthn PRF / recovery
  phrase / Google. Two-level key hierarchy: a random AES-256-GCM data key,
  wrapped separately by each method. Changing a PIN re-wraps; it re-encrypts
  nothing.
- **Google sign-in** — OAuth 2.0 implicit flow, token in memory, silent renew
  by hidden iframe. Scopes declared once in `js/core/scopes.js`.
- **Backend** — `apps-script/Code.gs:165` verifies the bearer token against
  Google's `tokeninfo` endpoint and checks the caller against an owner/member
  list on every request.

**MFA does not exist** as the prompt describes it. There is no session
revocation across devices and no device management.

## 6. Security findings

Scanned for every pattern the prompt names:

| Pattern | Count | Note |
| --- | --- | --- |
| `eval(` | **0** | |
| `innerHTML` assignment | **0** | The one occurrence (`sanitize.js:60`) *reads* it after `textContent`, the standard escape idiom |
| Hard-coded credentials / API keys | **0** | `familyos.config.json` is gitignored |
| `process.env` | **0** | |
| `TODO` / `FIXME` | **0** | |
| Mock or fake APIs in shipping code | **0** | `FakeTransport` is test-only |

**Real weaknesses, in order of severity:**

1. **Authorization is client-side only.** `rbac.js` decides what a `child` may
   see, in the child's own browser. Anyone with devtools defeats it. The
   backend checks *membership*, not *role* — so every member is effectively an
   owner at the data layer. **A role is currently a UI convenience, not a
   security boundary, and should not be described as one.**
2. **Google unlock makes the Google account sufficient to decrypt.** Stated
   plainly in `escrow.js` and on the button. Correctly opt-in, but it is the
   largest single exposure a household can choose.
3. **No rate limiting at the backend.** The Apps Script deployment is
   `Anyone`-accessible and validates a token per request; there is no throttle.
4. **The Sheet is plaintext for 93% of fields.** Anyone with the household's
   Google account reads everything.
5. **No Content-Security-Policy on `index.html`.** `oauth-callback.html` has a
   strict one; the application page does not.

## 7. Privacy findings

Strong relative to the prompt's asks:

- A **Privacy screen** (`js/domain/privacy.js`) reports, per entity and field,
  what is encrypted and what is not, and why.
- A **local-only switch** enforced at four separate egress points — sync,
  document upload, mail, key escrow.
- **Scopes declared once** and checked against the setup document by a test.

Gaps against the prompt: no consent records, no purpose limitation, no
retention policies, no data-lineage or provenance model, no processor
registry, no deletion propagation, no grievance mechanism. Deletion is a soft
delete (`deletedAt`) with no propagation to Sheets, Drive, or the search index.

## 8. Financial-data risks

The financial layer is the most mature part of the codebase — and the master
prompt's **central financial distinction is already implemented**:

- `js/domain/categorise.js` classifies into four kinds: `spending` / `income` /
  `transfer` / `internal`. `kindFor()` maps transfer and internal to
  `transfer`, so **an internal transfer is neither income nor expense**
  (rule 5 ✓).
- Statement reconciliation compares opening + credits − debits against the
  printed closing balance and **refuses to call a statement ready when it does
  not close** (`planStatement.ready`).
- Duplicate detection by fingerprint over account, date, amount, direction,
  reference, full narration and printed balance.

**Not yet present:** the `EconomicEvent` entity as a first-class record.
Today the *categorisation* distinguishes a transfer, but there is no
cross-account matching engine — the HDFC-debit/ICICI-credit pair in TEST 1 is
categorised as two transfers, not resolved into **one** economic event. That
is the single largest gap between this repository and the prompt's financial
architecture, and it is squarely Phase 5 work.

Also absent: `LedgerEntry`, double-entry, multi-currency (INR is assumed
throughout), and credit-card settlement as a distinct event type.

## 9. Data integrity risks

- **No referential integrity.** `ref()` fields hold ids that nothing enforces.
  `js/domain/imports.js` already reports transactions naming a statement that
  no longer exists — evidence the risk is real and recognised.
- **No schema versioning per record** beyond entity `version` and migrations.
- **Sync conflicts** are handled (`js/sync/conflict.js`) by last-write-wins
  with a conflict record — acceptable, but not a merge.

## 10. Scalability risks

Everything is loaded into memory to render: the ledger reads up to 50,000
transactions and sorts in JS. Fine for one household; it will not survive a
decade of statements without windowing. `virtualListThreshold` exists but is
not applied on the ledger path.

## 11. PWA state

**Sound.** Manifest with four icons and shortcuts, a service worker precaching
95 files, installable, and verified to work with the server killed outright.
Registration was moved to boot (PR #17) so a first-time visitor is offered
installation.

Limits, honestly: no background sync, no push notifications, no background
geolocation. The prompt's Phase 14 (location, geofencing, SOS) and Phase 22
(native companion) **cannot be met by a PWA** and correctly belong to a native
companion — the prompt already says so, and nothing here should claim
otherwise.

## 12–13. Component classification

| Area | Verdict | Reason |
| --- | --- | --- |
| `js/data/schema.js` | **KEEP** | The best asset here. Portable to any store. |
| `js/security/crypto.js`, `keyring.js` | **KEEP** | WebCrypto, no homemade cryptography. |
| `js/domain/*` (categorise, statement, tabular, import) | **KEEP** | Well-tested domain logic, storage-agnostic. |
| `js/ui/*`, `js/modules/*` | **KEEP** | Works; re-skin later if a framework is adopted. |
| `js/data/idb.js`, `repository.js` | **REFACTOR** | Keep the repository interface, allow a second backend. |
| `js/security/rbac.js` | **REFACTOR** | Sound rules; must be *mirrored* server-side to mean anything. |
| `js/sync/*` | **REFACTOR** | Assumes one backend shape; Layer 5 needs a connector interface. |
| `apps-script/*` | **KEEP for now** | Honest and working. Revisit if a server is introduced. |
| Consent / provenance / lineage / retention | **BUILD_NEW** | Nothing exists. |
| `EconomicEvent` + transfer matching | **BUILD_NEW** | The main financial gap. |
| Data classification (6 levels) | **BUILD_NEW** | One boolean today. |
| CKYC subsystem | **BUILD_NEW** | Nothing exists. |
| Chat, location, SOS, staff, tenants, screen time | **BUILD_NEW** | Nothing exists. |

## 14. Migration strategy

Deliberately **not proposed**, because it depends entirely on the §0 decision.
Sketching a PostgreSQL migration now would be inventing a plan for an
architecture nobody has chosen.

What is safe to say: the schema is declarative and already emits a Sheets
manifest, so emitting DDL from the same source is a small piece of work
whenever a relational store is chosen. Records carry `id`, `updatedAt` and
`deletedAt`, which is enough to export and reconcile.

## 15–24. Target architecture

The five layers map onto what exists as follows.

| Layer | Exists | Missing |
| --- | --- | --- |
| **1 Trust** | Keyring, RBAC rules, audit log, local-only switch, scope registry | Consent, classification levels, provenance, lineage, retention, deletion propagation, device trust, AI governance, **server-side enforcement** |
| **2 Experience** | 19 modules, shell, router, dashboard | Command centre prioritisation, profile completion, family tree UI |
| **3 Intelligence** | Rule-based categoriser, OCR-free PDF/CSV extraction, local assistant | Knowledge graph, entity resolution, anomaly detection, forecasting, AI privacy gate |
| **4 Data** | 34 entities, IndexedDB, repository, migrations | EconomicEvent, LedgerEntry, referential integrity, multi-currency |
| **5 Connectors** | Google OAuth/Sheets/Drive/Gmail | Calendar, DigiLocker, ABDM, CKYCRR, AA, brokers — **all as architecture only until authorised access exists** |

The prompt's rule that **no connector writes directly to the core database**
is already honoured: `sync/` hands to `data/repository.js`, never to `idb.js`.
The rule that **the UI must not touch the database** is *not* — screens call
`db.repo(...)` directly. Introducing a domain-service layer between them is
real, contained work and a sensible early phase.

---

## Verification run

| Check | Result |
| --- | --- |
| `npm test` | **637/637 passed** |
| `node tests/browser.mjs` | **142/142 passed** |
| `npm run build` | **88 modules, 476 exports, 0.93 MB** |
| Lint | **No lint script exists.** Nothing was run. |
| Typecheck | **No `tsconfig`/`jsconfig`; plain ES2023.** Nothing was run. |

The absence of lint and typecheck is itself a finding, not an omission in this
report. A 25,000-line untyped codebase with no linter relies entirely on its
test suite and on `tests/modules.test.mjs`, which compiles every module to
catch syntax errors the tests would otherwise miss. Adding both is cheap and
belongs in the first implementation phase, whatever §0 decides.
