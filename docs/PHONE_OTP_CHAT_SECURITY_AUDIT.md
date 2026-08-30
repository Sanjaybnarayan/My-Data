# Phone / OTP / chat identity: audit against the production brief

*An audit requested against a brief for a production Android application built
on `phone number → OTP → account → chat`. Inspection first, no code changed.
Everything below was measured in this repository; nothing is assumed.*

---

## 0. The finding that reframes the rest

**The application in this repository is not the application the brief
describes.** The gap is not a defect list. It is a different product, and
grading one against the other would produce a page of green ticks that mean
nothing.

| The brief assumes | This repository has |
| --- | --- |
| Phone number is the authentication identity | **Google account** (OAuth 2.0 + PKCE) is |
| `phone → OTP → account` creates users | Accounts are Google accounts; no user is created by a code |
| A multi-tenant chat service | One household, one shared data key |
| Server authorises conversation membership | The "server" is the household's **own** Apps Script, bound to their own Google account |
| JWT access + rotating refresh tokens | Google's own tokens; no JWT anywhere |
| WebSockets | None. Sync is batched POST |
| Public chat identity, user search, contact discovery, blocking, groups | None of these exist |
| Native Kotlin/Compose | HTML + JS in a Capacitor WebView |

Marking §14–16 (JWT/refresh rotation), §28 (user search), §29 (contact
discovery), §30 (blocking), §32 (groups) or §33 (WebSockets) as PASS would be
fake security for features that do not exist. They are **N/A**, and the reason
is architecture rather than omission.

**Where the brief's principles do apply, they were applied honestly, and four
real findings came out of it.** Those are §5 below.

---

## 1. Project architecture

```
Capacitor 14.0.1 WebView  ·  AGP 8.13.0  ·  Gradle 8.14.3
minSdk 24  ·  compileSdk 36  ·  targetSdk 36  ·  versionCode 1

HTML + vanilla ES modules (no framework, no bundler)
  ↓ IndexedDB, field-level AES-256-GCM
  ↓ Apps Script web app (16 actions, one POST endpoint)
  ↓ the household's own Google Sheets + Drive

Native plugins (Java): SmsInboxPlugin, ScreenTimePlugin,
                       BackgroundLocationPlugin, LocationTrailService
```

Two product flavours. `standard` ships to Play; `sms` adds `READ_SMS` and is
for sideloading only, because `READ_SMS` is a Play restricted permission.

---

## 2. Authentication flow, as it actually is

```
Google account  ──OAuth 2.0 + PKCE──▶  access token (memory only)
                                              │
                                              ▼
                                   Apps Script verifyToken
                                   → tokeninfo + owner/member list
                                   → role + personId, server-side
                                              │
Device PIN ─┐                                 ▼
Fingerprint ─┼─ unwraps ──▶ one household data key ──▶ records readable
Recovery phrase ─┤
Drive escrow  ───┤   (optional, off by default)
Backend escrow ──┘   (optional, off by default — see docs/SIGN_IN_BY_CODE.md)
```

The one-time code sits **beside** this, not in front of it. It confirms which
household member is holding the device, and — only where an owner turned it on
— releases an escrowed key so a new device can join. It has never been the
thing that authenticates a person to the backend.

---

## 3. Chat flow

```
sender device key ──ECDH P-256──▶ shared secret ──▶ AES-GCM envelope
                                                          │
                             one wrapped copy per recipient device
                                                          ▼
                                      message row: conversation, sender,
                                      sentAt, sealed body, readBy
```

`js/security/e2ee.js` states the property it relies on: only the sender's
private key can produce that shared secret, so *a wrapped key that opens is
evidence the message came from the sender's device*. There is no separate
signing key, deliberately.

**Chat already identifies people by internal id, not phone number** —
`message.sender` is `ref('person')` and `message.conversation` is
`ref('conversation')`. The brief's §23, §24 and §26 are satisfied at the schema
level, and were before this audit.

---

## 4. Identifiers

`js/core/ids.js` mints ULIDs: 48 bits of timestamp, then **80 bits from
`crypto.getRandomValues`**, Crockford base32.

- Not the phone number. Not the email. Not sequential. Not guessable.
- Timestamp-prefixed, so an id does leak when the record was created — see
  ID-01 below.

---

## 5. Findings

### CHAT-01 · HIGH · two answers to one question

| | |
| --- | --- |
| **File** | `js/services/chat.js`, `js/modules/chat.js`, `js/security/e2ee.js` |
| **Vulnerability** | Every message carries two independent claims about who sent it: the plaintext `sender` column, which the UI displays, and the envelope's `from` public key, which is cryptographically proven by the fact that the envelope opened. **Nothing compares them.** |
| **Impact** | A row written with `sender` set to another household member displays as that member. The seal proves otherwise and nobody asks. |
| **Attack scenario** | Any household member — or anyone with a member's Google session — pushes a `message` row naming somebody else as sender. The recipient's screen attributes it to that person. |
| **Why it is fixable now** | `deviceKey` already maps `publicKey → person` (`js/data/schema.js`, `indexes: [['byPerson','person'],['byDevice','deviceId']]`). The comparison needs no new data. |
| **Backend required** | No — client-side at open time. CHAT-02 is the server half. |
| **Status** | **Fixed.** `js/domain/attribution.js` compares them; `ChatService.read` asks on every message that opens; the bubble says so when they disagree. 8 of 8 mutations caught. |

This is the repository's own recurring shape: a value present, a second value
that could check it, and nothing joining them.

### CHAT-02 · MEDIUM · the server has the sender's identity and does not use it

| | |
| --- | --- |
| **File** | `apps-script/Policy.gs`, `apps-script/Sheets.gs:132` |
| **Vulnerability** | `admit()` resolves an authoritative `personId` from the owner-controlled member list and `dispatch` passes it in `context`. The push path checks only `policyAllows(role, 'write', 'message')`, which is true for every role. `message` is not in `OWN_RECORD`, and `ownRecordAllows` is only ever a *widening* — never a refusal. So `payload.sender` is never compared to `context.personId`. |
| **Impact** | The brief's §26 — "server determines sender_user_id" — is not met. |
| **Backend required** | **Yes**, and more than a comparison — see below. |
| **Status** | **Fixed**, after the blocker turned out to be a defect of its own. |

Honest severity note: every household member already shares one data key and
can read every message. This is an **integrity** defect, not a confidentiality
escalation. Calling it CRITICAL would overstate it.

#### The correction: this is not the two-line fix this entry first implied

The first version of this audit said the server "has the sender's identity and
does not use it", and implied a comparison of `payload.sender` against
`context.personId`. Measuring it before writing it showed that is wrong.

`admit()` returns **`personId: ''` for the owner** (`apps-script/Code.gs:492`),
and the legacy string-only member format returns `''` too (line 413). The
server does not know which *person* the owner is — only that they are the
owner. So the obvious rule would reject every message the household's owner
ever sends, and every message from a member added before the list carried
person ids.

It also runs against the grain of the push path, whose own comment reads
*"Only ever a widening: nothing here can refuse what the policy allowed."*
A narrowing rule there is a new kind of rule, not a new instance of an
existing one.

**Prerequisite:** the owner needs a server-side `personId`, which means
deciding how the owner is bound to a person record and what happens to a
deployment where that binding does not exist yet.

#### And measuring that prerequisite found something worse

Not "the owner has no `personId`". **Nobody had one, ever.**

Settings → Household has had a **person picker** since `ownRecordAllows`
existed. The choice travels to the backend in the `members` payload.
`manageMembers` built `clean.push({ email: email, role: role })` and **dropped
it**. `members()` then read `entry.personId` behind a comment explaining that it
is what lets a child reach their own health record, and noting it is *"absent on
every entry written before this existed"* — which was true of **every** entry,
because nothing had ever written one.

So `ownRecordAllows` could not fire on the server for anybody, and the
own-record access this repository believes it has did not exist. The same shape
as `otpDirectory`, inverted: there a value was read and never written, here a UI
writes one the server throws away. Second instance in one audit.

`tests/policy.test.mjs` could not see it: it builds its own context with a
`personId` already in it. Both ends covered, the wiring between them not —
which is the sentence `doPost` already carries about `role` and `personId`
going missing on the way in. This was the other half of that same bug.

#### What was built

1. **`manageMembers` keeps `personId`**, validated as a record id, because a
   personId is what widens access.
2. **The owner gets `ownerPersonId`**, its own property — they are deliberately
   never in the member list, which is why theirs needed somewhere else to live —
   settable from the same screen, and left alone by a call that does not mention
   it.
3. **`sheetPush` refuses a message whose `sender` is not the caller**
   (`impersonation` in `apps-script/Sheets.gs`). This is the **first rule there
   that narrows**; every other one widens, and `ownRecordAllows` says in its own
   comment that it is "never a way to refuse something the blanket policy
   allowed".

**An unbound caller is refused, not waved through.** The tempting shape —
"check it only where we can" — stops applying to exactly the accounts nobody
has bound yet, the owner included. The refusal names where the fix is made, and
Settings → Household says so in red until the owner answers.

**This requires a redeploy.** `apps-script/` is source somebody pastes into
script.google.com; until it is pasted, none of the above is running.

### TOK-01 · HIGH (currently unreachable) · refresh token stored in plaintext, behind a comment saying otherwise

| | |
| --- | --- |
| **File** | `js/auth/googlenative.js` — `REFRESH_KEY = 'auth.googleRefreshToken'` |
| **Vulnerability** | The Google **refresh token** was written with `db.setMeta`, which writes straight to the adapter with no encryption (`js/data/database.js:113`). On Android that is IndexedDB inside the WebView, plaintext at rest. |
| **What makes it worse than first recorded** | The line declaring the key read: *"Where the refresh token lives. **Encrypted; see `data/schema.js` meta rules**."* There are no such rules. `meta` is declared `{ keyPath: 'key', indexes: [] }` and nothing encrypts it. A security claim with nothing checking it — the fault this repository has found most often — and this was its most expensive instance, because anybody auditing the file would have read that line and moved on. |
| **Impact** | A refresh token grants long-lived Drive / Sheets / Gmail access to the household's Google account. The brief's §17 forbids plaintext token storage. |
| **Mitigations that are real** | `android:allowBackup="false"`, sandboxed app data. |
| **Why not CRITICAL** | `tools/native-scheme.mjs` reports *"no googleNativeClientId configured"* — the path is dormant in the shipping build, and would activate the moment a native client id is set. |
| **Backend required** | No. |
| **Status** | **Fixed.** Sealed with `encryptText` under the household data key, bound by AAD to its own meta key. A device that cannot seal it **refuses to store it** rather than falling back to plaintext; a token written before this is used once and re-sealed rather than discarded, so an upgrade does not sign the household out. 4 of 4 mutations caught. |

### PRIV-01 · MEDIUM · there is no rule about phone numbers, only nine separate decisions

*This entry was first written as "`person.phone` is the odd one out". Measuring
it properly showed both halves of that were wrong — the scope was larger and
the cost was smaller.*

| | |
| --- | --- |
| **Files** | `js/data/schema.js`, nine `type: 'phone'` fields |
| **What is actually there** | **Three of nine phone fields are encrypted**: `person.emergencyContactPhone`, `property.agentPhone`, `tenantPhone`. **Six are not**: `person.phone`, `kycRecord.heldMobile`, `warranty.claimPhone`, `tenant.phone`, `emergencyContact.phone`, `emergencyContact.altPhone`. |
| **The sharpest pair** | `person.emergencyContactPhone` is `encrypted: true`. `emergencyContact.phone` — the same kind of number, in the entity built for exactly that purpose — is `required: true, list: true` and in the clear. Two representations of one thing, classified oppositely. |
| **The finding** | Not that one field is wrong. That **no rule exists**: the schema has accreted nine independent decisions and the pattern between them does not resolve into a policy anybody could state. |
| **Impact** | Six phone numbers are plaintext in IndexedDB **and in the backup Google Sheet**. The brief's §6 treats a phone number as sensitive personal information. |
| **Status** | **Fixed.** The rule — every `type: 'phone'` field sealed except `person.phone` — was applied, and `tests/privacy.test.mjs` now holds it against the schema rather than against a list, so a tenth phone field cannot arrive in the clear. What that cost is set out below. *(This row said "Not fixed" for longer than it was true, twenty lines above the section describing the fix.)* |

#### What encrypting actually costs, measured

The first draft of this entry said it costs "list and search". Only one of
those is true.

| | Effect |
| --- | --- |
| **List columns** | **Real cost — and this correction is itself a correction.** A draft of this table said "no cost", reasoning that `Repository.list` calls `decryptMany`. It does, *by default* — but `decrypt: false` is used by eleven list views for speed, on the stated basis that they "only show clear fields", and those would print the envelope. `tests/privacy.test.mjs` already held that rule with a named two-item exception list, and it is what caught the mistake. A sealed field therefore cannot be `list: true`. |
| **Search** | **Real cost.** `searchableValues` filters `!f.encrypted` deliberately — *"indexing it would leak nothing useful and cost a decrypt per keystroke"*. An encrypted number cannot be typed into search to find its owner. |
| **The household's own spreadsheet** | **Real cost, and the first draft did not mention it at all.** The value syncs to Google Sheets as `enc:v1:…`. Somebody opening their own backup sees ciphertext where a phone number was. |
| **Existing rows** | **No loss, and no immediate benefit either.** `decryptRecord` skips a value that is not sealed, so plaintext already stored stays readable; `encryptRecord` seals it on the next write. Old records therefore stay in the clear until edited — the honest cost of not running a migration over every row. |

## What was changed, and the one field where the rule bites hardest

Applying "encrypt everything except `person.phone`":

| Field | Change |
| --- | --- |
| `kycRecord.heldMobile` | sealed |
| `warranty.claimPhone` | sealed |
| `tenant.phone` | sealed; **`list: true` removed** |
| `emergencyContact.phone` | sealed; **`list: true` removed** |
| `emergencyContact.altPhone` | sealed |
| `person.phone` | unchanged — the one searchable number per household member |

**`emergencyContact.phone` is where this costs most, and it is worth saying
rather than softening quietly.** That entity exists to be used in a hurry, it
is the one entity a `guest` may read (`js/security/rbac.js:24`), and the number
no longer appears beside the name in the list. Reversing that single field —
back to `list: true` and unsealed — is a one-line change, and a defensible one:
a number you need under stress is a different kind of value from a tenant's.

`js/services/secondary.js` reads emergency contacts with `decrypt: false` and
`reachability` only tests those numbers for emptiness, so it still answers
correctly — ciphertext is non-empty, and an absent number is never sealed. That
holds by arithmetic rather than by design, and is recorded here because the next
person to touch `reachability` should know it is standing on that.

### OTP-01 · MEDIUM · the pre-auth path ran with no lock, and the wrong lock would not have helped

§10 of the brief asks that *only one verification attempt may successfully
consume an OTP*, and §66 asks that operations claimed to be atomic be atomic on
the server. Neither held.

`doPost` answers `otp.request` and `otp.verify` before `verifyToken`, because a
code has to be requestable by somebody who has not signed in — that is the
whole point of it. Every other action then runs through `withLock`. These two
ran through nothing.

`withLock` was the obvious candidate and is not reused, and the reason is
worth stating exactly rather than approximately — my first write-up of this
finding did the latter, and that needs correcting here.

`withLock` takes `LockService.getUserLock()`, documented as "only once per
user". It keys on the **active** user, and an anonymous caller has none.
Whether that means one anonymous caller would have excluded another is **not
established** — not by any measurement here, and not by Google's documentation,
which does not say what the per-user key is when there is no user. `Otp.gs`
records the analogous behaviour for `CacheService.getUserCache()` — per-session
for such a caller — and reaches for `getScriptCache()` because of it, and that
neighbouring case is what this reasons from. It is an inference, not a
measurement, and the first version of this entry asserted it as one: *"a user
lock excludes a caller from themselves; pre-auth there is no user, so it would
have excluded nobody."* That sentence claims to know something this repository
cannot check.

What needs no inference is the part that made it a finding: **the pre-auth path
took no lock at all.** Not the wrong one — none. And `getScriptLock()` is
documented as preventing *any* user from running the guarded section
concurrently, so taking it settles the question rather than depending on it.

Both actions are read-modify-write with nothing in between:

- `otpVerify` reads the record, increments `attempts`, writes it back. Two
  wrong guesses in flight together both read `attempts: 0` and both write `1`,
  so the second guess costs nothing.
- On the **matching** path it reads the record, compares the hash, and only
  then removes the key. Two executions holding the same correct code both match
  and both are handed the escrow that unwraps the data key. This is the
  expensive one, and it is the one the brief names: a code that works once
  working twice.
- `otpRequest` has the same shape through `otpEnforceLimits`, which counts per
  address and per deployment the same way — so both actions are taken inside
  the lock, not only the one that looked dangerous.

**Fixed** by `withScriptLock` in `apps-script/Code.gs`, which takes
`getScriptLock()` — shared across every caller, authenticated or not — and
releases it in a `finally`, so a failing verification (which is most of them)
does not hold the next caller out for the timeout. A caller who arrives while
another holds it is refused with a 429 rather than queued, since an execution
sitting on Apps Script's concurrency budget helps nobody.

Two things this does not claim. The ceiling it raises on wrong guesses is
small — the per-address and per-deployment caps bound the total either way; the
point is that a stated property was not a property. And **it is inert until the
Apps Script is redeployed**, like CHAT-02 and for the same reason (§8).

A related inconsistency, found while testing it: the pre-auth `catch` marked
every failure retryable only at `>= 500`, so all three of its 429s — the two
hourly caps and now the lock — told the client "try again shortly" in words and
"do not try again" in the flag, which is what `js/sync/transport.js` actually
reads. The authenticated `catch` two blocks below had always used
`>= 500 || === 429`. The pre-auth one now does too.

**Tested** in `tests/otp.test.mjs` — that both actions take the script lock and
release it, that it is the script lock and not the user lock, that it is
released when the action throws, that a caller arriving mid-flight is refused
without spending one of the five guesses or sending a message, and that the
refusal says nothing about who else is using the deployment. Node is
single-threaded and Apps Script gives each request its own execution, so no
test here can make two calls overlap in time; what these do is drive the call
the *losing* side of a real overlap makes — one that arrives to find the lock
held. The harness's own script-lock stub had no `tryLock` at all and its
`getUserLock` always granted, so it could not have shown any of this; both are
now a mutex that records which kind was taken.

### SEARCH-01 · HIGH · the one read path that never met the authorisation rule

*Found while continuing this audit, and it belongs to it: the brief's privacy
and authorisation sections are exactly what it breaks. It has nothing to do
with phone numbers or one-time codes, which is why nothing here had looked at
it.*

| | |
| --- | --- |
| **Files** | `js/data/database.js`, `js/data/search.js`, `js/app.js` |
| **What is actually there** | `searchIndex` reads the `search` store through `adapter.query` — the one read path in the application that does not go through `Repository`, and therefore the one that never met `rowFilter`. `Database.search` forwarded to it unchanged, and the box on the app shell rendered `hit.title` and `hit.subtitle` straight out. |
| **Measured** | On one device, one actor swapped: `child repo('healthRecord').list()` → **0 rows**; `child db.search('psychiatry')` → **1 hit, with the title**. |
| **Why it leaks content, not only existence** | `indexEntry` denormalises `title` and `subtitle` into the index "so a result can be shown without a second read". A hit therefore says what the field says. |
| **Who it exposes** | `js/security/rbac.js` names this case in its own header: *"a shared family device does not expose one sibling's records to another."* This is that device. The search box is on the shell, reachable from every screen. |
| **Status** | **Fixed.** Each hit is now checked with the same `rowFilter` the repository uses, against the record itself — not a second copy of the rule. |

The index is over-fetched and trimmed rather than filtered after the caller's
limit: `searchIndex` ranks over every record on the device, so a limit applied
first lets twelve of somebody else's rows fill every slot and leaves the person
searching for their own with nothing. That is a decision, and
`tests/data.test.mjs` pins it with twelve records ranked above one.

Four mutations. The one worth recording is the fourth — dropping the
over-fetch — which **survived twice**: first because the fixture had two
records and no limit could truncate, then because all thirteen records were
created in the same millisecond, so the recency term in `score` was identical
and the child's row did not in fact rank last. The fixture now separates them
by title position, which `score` rates 30 against 60.

### ID-01 · LOW · ids leak creation time · **accepted**

ULIDs are timestamp-prefixed. A `person` id discloses when the record was
created. The randomness is 80 CSPRNG bits, so ids are not guessable, and the
brief's actual prohibitions (phone, email, sequential) are all met. Recorded
because §4 says "no timestamp-based predictable IDs" and half of that sentence
applies.

**Accepted**, for a reason that had to be corrected before it could be written
down.

The first draft of this disposition was going to say the timestamp is the price
of sortability, and that the sortability is load-bearing — `js/core/ids.js`
opened by saying exactly that:

> *"Record ids are lexicographically sortable by creation time, which is what
> lets IndexedDB range-scan 'newest first' off the primary key with no
> secondary index, and lets the sync engine order two writes that share a
> millisecond."*

Checking it rather than repeating it: **neither half is true of this
codebase.** The application has exactly two directional queries and both go
through an index — `byAt` in `data/audit.js`, `bySeq` in `data/database.js`.
`sync/drive.js` orders by `createdAt`. `idTime`, the function that reads the
timestamp back out, has no caller outside its own test.

So the cost is real and the benefit it was justified by is not being taken.
That still does not make changing it right: ids already minted cannot be
changed, so a new scheme would leak the old dates anyway while churning every
part of the application that mints or stores an identifier — for a LOW finding
about a creation date. **Accepted on that basis**, and `js/core/ids.js` now
says which of its properties are relied on and which merely happen to be true.

Tenth instance of a claim with nothing checking it, and the one that came
closest to being repeated in this document rather than caught by it.

### PLAY-01 · INFORMATIONAL · account deletion needs a human decision

`js/modules/settings/data.js:75` erases the device and **says so**: *"Anything
already synced stays in your Google Sheets and Drive."* There is no
server-side account deletion, because there is no account on a server — the
data is in the household's own Google account.

Whether Google Play's account-deletion policy applies to an app whose only
store is the user's own Drive is a **Play Console and legal question**, not an
engineering one. Flagged, not answered.

---

## 6. What genuinely passes

Measured, not assumed.

| Brief | Evidence |
| --- | --- |
| §7 OTP server-generated, CSPRNG | `Utilities.getSecureRandomBytes`, with a note on why modulo bias is acceptable |
| §8 never stored in plaintext | SHA-256 salted with the address; 10 minutes; single-use |
| §9 request rate limiting | Per address **and** per deployment per hour, on `getScriptCache()` — the file explains why `getUserCache()` limited nothing pre-auth |
| §10 verification limits | 5 attempts, then the code is destroyed rather than left to be guessed |
| §11 enumeration protection | Identical reply for a known and unknown address; the limit is charged either way |
| §12 never returns the OTP | Returns `{ sent, expiresInSeconds }` |
| §39 minimum permissions | Standard flavour: 8 permissions, no SMS / contacts / call log. `READ_SMS` is confined to the `sms` flavour |
| §40 network | `usesCleartextTraffic="false"`, `androidScheme: "https"`, `allowMixedContent: false`. No `TrustManager` or `HostnameVerifier` overrides anywhere |
| §43 backup | `android:allowBackup="false"`, stated as a decision |
| §44 exported components | Only `MainActivity` (launcher). Service and provider both `exported="false"` |
| §46 WebView | `webContentsDebuggingEnabled: false` |
| §47 cryptography | WebCrypto only — AES-256-GCM, PBKDF2 600k, ECDH P-256. No custom crypto, no MD5/SHA-1/ECB for security |
| §48 secrets | Repository-wide scan: no API keys, no secrets, no service-account files. OAuth uses PKCE with **no client secret**, and `js/auth/pkce.js` explains why an installed app is not issued one |
| §50 logging | 5 `console.*` calls in `js/`, none carrying a token, code, phone number or message body |
| §22 admin | No `if phoneNumber == adminNumber` pattern. The owner is decided by `Session.getEffectiveUser()` server-side and is never stored in a list — `manageMembers` explains that storing it would invite somebody to remove it |
| §56 server time | OTP expiry is `CacheService` TTL, server-side |

---

## 7. Threat model — the entries that actually apply

| Threat | Likelihood | Impact | Mitigation | Residual |
| --- | --- | --- | --- | --- |
| SIM swap | Low | **High, and new** | Only where sign-in by code is on; owner-only, off by default | **Accepted, deliberately** — see `docs/SIGN_IN_BY_CODE.md` |
| Apps Script project compromise | Low | **Total, where the escrow is on** | Owner's Google account security | **Accepted, deliberately** |
| Chat impersonation | Medium | Medium | Refused by the backend (CHAT-02) and shown on the message if it ever appears (CHAT-01) | A device that never syncs can still show itself a forged row; nothing reaches anybody else's device |
| Refresh-token theft from device | Low | High | Sealed under the household data key; dormant path besides | Reading it now requires the data key, so it is as strong as the PIN — and no stronger. A Keystore-backed store is the remaining improvement |
| Reverse-engineered APK | Certain | Low | No secrets in the APK | Accepted — the client is presentation |
| OTP brute force | Low | Low | 5 attempts, then destroyed | Mitigated |
| OTP flooding / SMS cost abuse | Medium | Medium | Per-address and per-deployment ceilings | Mitigated |
| Phone-number enumeration | Low | Low | Identical replies, rate-limited | Mitigated |
| Stolen unlocked device | Medium | High | Session timeout, PIN on resume | Partially mitigated |
| Backup extraction | Low | Low | `allowBackup="false"` | Mitigated |

Threats from the brief that have **no attack surface here**: IDOR/BOLA on other
users' conversations, chat scraping, WebSocket abuse, malicious upload to a
shared service, deep-link abuse (no deep links declared), push-notification
leakage (no push service).

---

## 8. Backend work required

`apps-script/` is source that a person pastes into script.google.com. Nothing
in this repository can reach a deployment, and no change here takes effect
until it is redeployed.

1. **CHAT-02** — compare `payload.sender` to `context.personId` on push.
2. **OTP-01** — take the script lock around the pre-auth one-time-code path.
   Written and tested here; inert everywhere until the same redeploy.
3. **LOCK-01** — `withLock` now takes `getScriptLock()` too. Same redeploy.

---

### LOCK-01 · MEDIUM · the write path's lock excluded nobody it could name

Found while writing OTP-01's tests, raised there as an open question, and
resolved by the household's owner choosing the stronger lock.

`Code.gs`'s header promised *"a `LockService` script lock serialises writes"*.
`withLock` took `getUserLock()` — documented as "only once per user", keying on
the **active** user. A web app deployed as `USER_DEPLOYING` does not generally
expose the caller as the active user, so what that lock excluded was not
something this repository could describe, let alone test.

What sat behind it is the part that made it worth resolving rather than noting:

> `sheetPush` reads `getLastRow()` and writes at `lastRow + 1`.

Two pushes that both read the same last row write the same range, and the
second silently replaces the first. Records accepted, acknowledged to the
device that sent them, and gone — the failure mode the brief names as never
silently losing data.

`getScriptLock()` is documented as preventing *any* user from running the
guarded section concurrently, and a script lock is scoped to the deployment,
which here is one household. The cost is that two members pushing at the same
moment serialise instead of running side by side, and a caller that cannot take
the lock within `LOCK_TIMEOUT_MS` gets a retryable 429 its outbox retries.

**Tested**: a push takes and releases the script lock; a second device arriving
mid-write is refused with a retryable 429; the lock is released when the action
throws.

That last test took three attempts and is worth recording. Nothing had ever
checked which lock the write path took, so changing it broke no test — which is
how the code and the comment above it disagreed for as long as they did. Then
the release-on-throw mutation escaped twice: the first version drove a push at
an unknown store, which `sheetPush` *rejects* rather than throws over, so it
passed against the mutation and proved nothing. `dispatch` evaluates
`workbook()` inside the lock callback, so a workbook that cannot be opened
throws where it counts; the test now asserts the request actually failed before
asserting the lock was released, so it cannot go vacuous again unnoticed.

---

## 9. Proposed order

Following the brief's phase structure, restricted to what exists here:

| Phase | Work | State |
| --- | --- | --- |
| 1 | This audit | **Done** |
| 2 | Threat model | **Done** (§7) |
| 3 | OTP security | **OTP-01 done** — this row read *already met* until §10's concurrency requirement was tested rather than read; the escrow is documented in `docs/SIGN_IN_BY_CODE.md` |
| 4 | Session / token | TOK-01 **done** |
| 5 | Android secure storage | TOK-01 **done** in-repo. A Keystore-backed bridge would be stronger still and is not built |
| 6 | Network security | Already met |
| 7 | Chat identity separation | Already met — chat uses person ids, not phone numbers |
| 8 | Chat authorisation | CHAT-01 **done**, CHAT-02 **done** — and the blocker was a defect: nobody had a server-side `personId` at all |
| 9 | Privacy / minimisation | PRIV-01 **done** — the rule is held by a test against the schema |
| 10 | Play compliance | **PLAY-01** — needs a human decision |
| 11 | Play Integrity / anti-abuse | **Not started.** Not partially, not planned — nothing in this repository mentions it |
| 12 | Security testing | **Partial** — see below for exactly which half |
| 13 | Final report (§80) | **Not written.** This document is phase 1, the audit; §80 asks for a statement of the state *after* remediation, and nothing produces one |
| — | SEARCH-01 | **Done** — the read path that never met the authorisation rule |
| — | LOCK-01 | **Done** — the write path's lock, raised as an open question under OTP-01 and settled by the owner |
| — | ID-01 | **Accepted**, with the reason corrected — see above |

The table stopped at 10 for as long as this document existed, and the brief has
thirteen phases. Three rows absent is not the same as three rows passing, and a
table that ends early reads like the latter.

**Phase 11 has not been begun.** A case-insensitive grep for `play integrity`,
`safetynet` and `attestation` across `js/`, `apps-script/`, `tools/` and the
Android sources returns two lines, both in `js/auth/biometric.js`, and both
WebAuthn's `attestation: 'none'` — a request *not* to be told the
authenticator's model, which is a different thing that happens to share a
word. Integrity attestation would need a Play-distributed build and a server
that verifies the token it returns, and neither exists. It is listed here
because leaving it off the table was the misleading part; putting a date on it
would be the next mistake.

**Phase 12 is partial, and the split is worth naming.** What exists is
static: the backend's own `.gs` files are loaded and driven through `doPost` by
`tests/appsscript.mjs`, so the code exercised is character-for-character the
code that deploys, and the one-time-code path now has coverage for two requests
arriving at once (§10 of the brief: *only one verification attempt may
successfully consume an OTP*). That last was **OTP-01**, a real defect and not
a formality —
the pre-auth path ran with no lock at all, and `withLock` takes a user lock,
whose exclusion between two anonymous callers is not something this repository
can establish. Both actions are read-modify-write, and on the matching path
`otpVerify` compares the hash and only then removes the key, so two executions
holding the same correct code would both have matched and both been handed the
escrow that unwraps the data key.

What does **not** exist is everything dynamic: no penetration testing, no
fuzzing, no scanning, and nothing at all run against a deployed instance. A
test that loads a file is not a test of a running service, and the distinction
is the whole of what phase 12 asks for.


**CHAT-01 and CHAT-02 are both done**, and they do different halves of one job.
CHAT-01 makes a forged attribution **visible** on any device that opens the
message; CHAT-02 stops the row reaching the backup at all. Neither alone is
enough: a client that never syncs can still lie to itself, and a row that syncs
before anybody looks at it would otherwise stand unchallenged.

CHAT-02 needs the Apps Script **redeployed** before it is running anywhere.

---

## 10. What this audit does not claim

- **Not a Play approval prediction.** PLAY-01 needs a Play Console and legal
  decision.
- **Nothing about the deployed backend.** Only the two source trees here.
- **No penetration testing was performed.** These are findings from reading
  the code and its tests, not from running attacks against a deployment.
- **No OWASP MASVS verification level is claimed.** A PASS/FAIL matrix against
  MASVS requires testing this audit did not do, and a matrix filled in from
  code reading would be exactly the fake assurance the brief forbids.
