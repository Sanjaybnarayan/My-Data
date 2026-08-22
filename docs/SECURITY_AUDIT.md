# Security Audit — Family OS

**Base:** `1c8d97d` · 22 August 2026 · forensic search plus execution.
Companion to `docs/PHASE_AUDIT_REPORT.md` §8.

## P0 · Server-side authorization never receives the caller's role

`doPost` resolves the caller's identity and then drops half of it before
dispatch.

| Where | What |
| --- | --- |
| `apps-script/Code.gs:456-460` | `admit()` returns `{ email, owner, isOwner, role, personId }` |
| `apps-script/Code.gs:67-73` | the dispatch context is `{ email, owner, isOwner, deviceId, clientVersion }` — **`role` and `personId` are not copied** |
| `apps-script/Sheets.gs:124` | `var role = (context && context.role) \|\| 'guest';` |
| `apps-script/Sheets.gs:236` | the same on the pull path |
| `apps-script/Policy.gs:80` | `policyAllows` returns `false` for `guest` on every entity |

**Reproduced** with the repository's own harness (`tests/appsscript.mjs`):

```
admit('asha@example.com')  → {"role":"spouse","personId":"p-asha", …}
ping through doPost        → {"ok":true,"user":"asha@example.com"}     ← no role key
readableEntities('guest')  → []
sheetPush(ctx as doPost builds it)   → rejected: "a guest may not write account"
sheetPush(ctx with role:'spouse')    → authorization passes
```

**Impact.** Every push is refused row by row for every caller including the
owner; every pull returns nothing. Sheets sync is non-functional against a real
deployment.

**Direction of failure: closed.** Nobody gains access they should not have. This
is an availability and durability defect, not a confidentiality one — but a
household that believes it has an off-device backup does not have one.

**Not silent.** `js/sync/engine.js:212-223` records each rejection and marks the
outbox entry with a `TransportError`, so the failure is visible in the sync
report.

**Why the suite is blind to it.** `tests/policy.test.mjs:157-175` calls
`sheetPush` with a context it builds by hand, *including* a role — proving the
policy is correct when handed one. `tests/backend.test.mjs` goes through
`doPost` but never calls `push` or `pull`. Both ends covered, the wiring
between them not. **Third occurrence of this pattern in this project**, after
the archive-verification gap and the `fromCsv` tripwire.

**Fix (not applied — this is an audit).** Copy `role` and `personId` into the
context literal, and add a test that pushes through `doPost` as a non-owner and
asserts the row is applied. The test matters more than the fix: without it the
same class of defect returns.

## P3 · A scratch file is committed

`mask-check.tmp.mjs`, 2,647 bytes at the repository root, tracked since
`0aeb46a`. No functional risk.

## P3 · Dev-only advisories

`npm audit`: 3 moderate, all under `@capacitor/cli` → `xcode`. Never shipped to
a browser or a device. No production dependency is affected because the
application has **no production dependencies**.

## Forensic search — what came back clean

| Pattern | Occurrences in shipped `js/` | Note |
| --- | --- | --- |
| `eval(` | 0 | |
| `new Function(` | 0 | |
| `innerHTML` assignment | 0 | the sole match is a **read** at `js/security/sanitize.js:60`, serialising an allowlisted `DOMParser` fragment |
| `document.cookie` | 0 | |
| `sessionStorage` | 0 | |
| `XMLHttpRequest` / `WebSocket` | 0 | |
| `access_token` / `refresh_token` in storage | 0 | `js/auth/google.js:22` documents that the token is held in memory deliberately |
| `client_secret` | 0 | one comment at `js/auth/pkce.js:175` explaining why an installed-app client has none |
| `api_key`, `private_key`, `service_account` | 0 | |
| `catch {}` | **0** across 158 files | |
| `TODO`/`FIXME`/`HACK`/`MOCK`/`FAKE`/`DEMO`/`SAMPLE`/`PLACEHOLDER`/`HARDCODED` | **0** | |

`localStorage` appears 6 times and holds exactly two things: the theme
preference (`js/ui/theme.js:15`) and the device id
(`js/data/database.js:47`). **No tokens, no financial data, no identity data.**

## Cryptography

| Property | Value | Location |
| --- | --- | --- |
| Cipher | AES-GCM, 256-bit | `js/security/crypto.js:68` |
| Key derivation | PBKDF2-SHA256 | `js/security/crypto.js:84-91` |
| Archive iterations | 600,000 | `js/domain/archive.js` |
| Randomness | `crypto.getRandomValues` | `js/security/crypto.js:43` |
| Envelope | PIN → KEK → wrapped DEK → field data | `js/security/crypto.js:7` |
| Encrypted schema fields | 36 | `tools/self-description.mjs` |

Standard primitives, correctly composed, with the key hierarchy documented in
place. **This audit is not a cryptographic review and does not substitute for
one.** No external review has been performed.

## Transport and API

Authentication precedes dispatch: token verified → rate limit enforced → device
recorded → action run (`apps-script/Code.gs:57-71`). A revoked device is checked
*before* the action, with a comment saying why. Rate limiting is a per-user
per-minute token bucket (`Code.gs:507`). The role is taken from the members list
the owner controls and **never from the request** — `Code.gs:450-455` states
this explicitly, and it is the right design. §P0 above is a wiring failure of
that design, not a flaw in it.

## Client-side vs server-side authorization

Both exist. `js/security/rbac.js` refuses writes on the device; `Policy.gs`
refuses them on Google's servers. The server copy is generated from the schema
by `tools/policy.mjs` and `tests/policy.test.mjs` fails if the generated file
drifts.

**Which is authoritative?** By design, the server. **In fact, today, neither** —
the client enforces correctly and the server evaluates a constant. That is the
finding.
