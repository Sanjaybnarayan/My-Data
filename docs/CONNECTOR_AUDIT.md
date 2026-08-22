# Connector Audit

**Base:** `1c8d97d` · 22 August 2026.

The headline finding: **no fabricated integration exists.** Every connector the
specification names is either really implemented, or absent with the absence
stated in writing. Nothing has a service class and a mock response pretending to
be an API.

| Connector | Status | Evidence |
| --- | --- | --- |
| Google OAuth | **REAL** | `js/auth/google.js`, `js/auth/googlenative.js` — PKCE S256, installed-app client, system browser |
| Gmail | **REAL** | `apps-script/Gmail.gs`, `GmailApp`; optional per deployment (`Code.gs:114-120` returns 501 if absent) |
| Drive | **REAL** | `apps-script/Drive.gs` — `DriveApp`, `UrlFetchApp`, versions, trash, per-person folders |
| Calendar | **REAL** | `js/sync/calsync.js`, `CALENDAR_SCOPE` = `calendar.app.created` |
| Google Sheets | **REAL, BLOCKED** | `apps-script/Sheets.gs` — works, but every call is refused; see `docs/SECURITY_AUDIT.md` P0 |
| SMS | **ABSTRACTION ONLY** | `js/domain/sms.js`, `js/services/sms.js`, `smsMessage` entity. `SOURCE.NATIVE` reports `NOT_SUPPORTED` |
| Android | **REAL shell** | Capacitor 8.5.0; debug APK builds in CI |
| iOS | **PROJECT ONLY** | Generated and synced; never compiled — no macOS |
| Bank / Account Aggregator | **NOT_IMPLEMENTED** | zero code |
| Zerodha / any broker | **NOT_IMPLEMENTED** | the only matches are narration regexes: `categorise.js:341`, `sms.js:133` |
| CKYC / CKYCRR | **NOT_IMPLEMENTED, deliberately** | `js/data/schema.js:159` — *"This is not a CKYCRR integration and must never become one by accident"* |
| DigiLocker | **NOT_IMPLEMENTED** | zero occurrences in `js/`; appears in 7 docs only |
| ABDM | **NOT_IMPLEMENTED** | one occurrence, `js/domain/compliance.js:228`, as a regime not a connector |

## Per-connector controls, for the ones that exist

| Control | Google (OAuth/Gmail/Drive/Calendar/Sheets) |
| --- | --- |
| Authentication | Google token, verified server-side against `oauth2.googleapis.com/tokeninfo` (`Code.gs:396-420`) |
| Authorization | Members list, owner-controlled; role never taken from the request (`Code.gs:450-455`) — **but see the P0** |
| Consent | Scope-gated; `js/core/scopes.js` separates identity, mail, calendar and appdata scopes |
| Token management | In memory on the browser; refresh token encrypted with the household key on native |
| Refresh | `js/auth/pkce.js` `refreshRequest`; native only |
| Revocation | Sign-out revokes the grant and clears the stored token whether or not the revoke call succeeds |
| Sync | `js/sync/engine.js` — outbox, shadow copies, three-way merge, conflict records |
| Retries | Yes, with `retryable` on the transport error |
| Idempotency | Yes — outbox entries keyed by record and revision |
| Provenance | Yes — `js/data/provenance.js`, source links preserved |
| Audit | Yes — `audit` action, and the `audit` store travels into the archive |
| Error handling | Typed `TransportError` with status and retryability; zero silent catches |

## The SMS position

`js/domain/sms.js:1-16` states it directly: a browser cannot read an inbox, and
the specification's own rule 55 says that where native SMS access is not
policy-eligible, the **abstraction and alternative ingestion** should be built
instead. That is what exists — message parsing, sender identification,
classification, extraction, duplicate detection, reconciliation against bank
rows, and `SOURCE_PRIORITY` ranking SMS **below** every statement.

Rule 53 is honoured structurally: the security classification runs **first and
independently**, and a message classified `AUTHENTICATION_SECRET` never reaches
extraction, never reaches a notification, and carries no text forward.

The Android manifest requests **`INTERNET` and nothing else** — no `READ_SMS`,
no `RECEIVE_SMS`. There is no native capture path, and none is implied.

## What a household can actually connect today

Google, and only Google. Everything financial arrives as a file the household
downloads and imports, or as text they paste. That is a real limitation and it
is stated in `docs/STATUS.md` rather than papered over.
