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
| **Status** | **Not fixed.** Reported here first, per the brief's instruction to inspect before changing. |

This is the repository's own recurring shape: a value present, a second value
that could check it, and nothing joining them.

### CHAT-02 · MEDIUM · the server has the sender's identity and does not use it

| | |
| --- | --- |
| **File** | `apps-script/Policy.gs`, `apps-script/Sheets.gs:132` |
| **Vulnerability** | `admit()` resolves an authoritative `personId` from the owner-controlled member list and `dispatch` passes it in `context`. The push path checks only `policyAllows(role, 'write', 'message')`, which is true for every role. `message` is not in `OWN_RECORD`, and `ownRecordAllows` is only ever a *widening* — never a refusal. So `payload.sender` is never compared to `context.personId`. |
| **Impact** | The brief's §26 — "server determines sender_user_id" — is not met. |
| **Backend required** | **Yes.** `apps-script/` is source somebody pastes into script.google.com; a fix here does nothing until redeployed. |
| **Status** | **Not fixed.** |

Honest severity note: every household member already shares one data key and
can read every message. This is an **integrity** defect, not a confidentiality
escalation. Calling it CRITICAL would overstate it.

### TOK-01 · HIGH (currently unreachable) · refresh token stored in plaintext

| | |
| --- | --- |
| **File** | `js/auth/googlenative.js:54,218` — `REFRESH_KEY = 'auth.googleRefreshToken'` |
| **Vulnerability** | The Google **refresh token** is written with `db.setMeta`, which writes straight to the adapter with no encryption (`js/data/database.js:113`). On Android that is IndexedDB inside the WebView, plaintext at rest. |
| **Impact** | A refresh token grants long-lived Drive / Sheets / Gmail access to the household's Google account. The brief's §17 forbids plaintext token storage. |
| **Mitigations that are real** | `android:allowBackup="false"`, sandboxed app data. |
| **Why not CRITICAL** | `tools/native-scheme.mjs` reports *"no googleNativeClientId configured"* — this path is dormant in the shipping build. The code exists and would activate the moment a native client id is set. |
| **Backend required** | No. Needs a Keystore-backed native storage bridge, or the existing keyring. |
| **Status** | **Not fixed.** |

### PRIV-01 · MEDIUM · the phone number is the one contact field left in the clear

| | |
| --- | --- |
| **File** | `js/data/schema.js:96` |
| **Vulnerability** | `{ key: 'phone', type: 'phone', list: true, search: true }` — plaintext, listed, searchable. Two lines below, `emergencyContactPhone` is `encrypted: true`. |
| **Impact** | The household member's own number is plaintext in IndexedDB **and in the backup Google Sheet**, where the emergency contact's is not. The brief's §6 treats the phone number as sensitive personal information. |
| **The inconsistency is the finding** | One of the two decisions is wrong, and nothing in the repository says which. |
| **Caveat** | `list: true` and `search: true` are what make a person findable in this household's own UI. Encrypting it has a real cost, and that is a decision rather than a bug fix. |
| **Status** | **Not fixed. Needs a decision, not a patch.** |

### ID-01 · LOW · ids leak creation time

ULIDs are timestamp-prefixed. A `person` id discloses when the record was
created. The randomness is 80 CSPRNG bits, so ids are not guessable, and the
brief's actual prohibitions (phone, email, sequential) are all met. Recorded
because §4 says "no timestamp-based predictable IDs" and half of that sentence
applies.

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
| Chat impersonation | Medium | Medium | None today | **CHAT-01 / CHAT-02** |
| Refresh-token theft from device | Low | High | Dormant code path | **TOK-01** |
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
2. Consider adding `message` to `OWN_RECORD`, which today is a widening
   mechanism only and would need a narrowing counterpart.

---

## 9. Proposed order

Following the brief's phase structure, restricted to what exists here:

| Phase | Work | State |
| --- | --- | --- |
| 1 | This audit | **Done** |
| 2 | Threat model | **Done** (§7) |
| 3 | OTP security | Already met (§6); the escrow is documented in `docs/SIGN_IN_BY_CODE.md` |
| 4 | Session / token | **TOK-01** |
| 5 | Android secure storage | **TOK-01** |
| 6 | Network security | Already met |
| 7 | Chat identity separation | Already met — chat uses person ids, not phone numbers |
| 8 | Chat authorisation | **CHAT-01, CHAT-02** |
| 9 | Privacy / minimisation | **PRIV-01** |
| 10 | Play compliance | **PLAY-01** — needs a human decision |

**Recommended first: CHAT-01.** It is the highest severity that can be fixed
entirely in this repository, needs no redeployment, needs no new data, and is a
defect of exactly the kind this codebase already has a name for.

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
