# Data inventory

Section 51 of the hardening brief asks what data exists, in the shape **DATA /
PURPOSE / SOURCE / STORAGE / RETENTION / ACCESS / SHARING / ENCRYPTION /
DELETION**, and this answers it for everything FamilyOS holds.

## What was already answered, and what was not

Three documents already cover the household's *records*:

- `docs/DATA_CLASSIFICATION.md` grades every field on six levels, derived from
  the schema rather than annotated by hand.
- `docs/DATA_RETENTION.md` gives the four retention policies and which
  entities take which.
- `docs/DATA_CONSENT.md` covers purpose and lawful basis.

Repeating them here would create a second copy to drift. So the record rows
below are a summary that points at those, and **the substance of this document
is everything else** — the token, the device id, the queue, the log, the index,
the diagnostics, the keyring, the browser storage keys. That plumbing is where
this inventory found things nothing had written down, and one of them is a
finding rather than a description.

---

## 1. Household records

The 617<!--live:fields--> fields across 53<!--live:entities--> entities.

| Data | Purpose | Source | Storage | Retention | Access | Sharing | Encryption | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Record fields, encrypted | The 45<!--live:encryptedFields--> fields marked `encrypted` — account numbers, PAN, diagnoses, chassis numbers | Typed by a household member, or extracted from a document they supplied | IndexedDB on each device; the household's own Google Sheet | Per `docs/DATA_RETENTION.md`: 7 days (`secret`), 90 (`standard`), 2555 (`financial`), or never (`keep`) | The roles in `Policy.gs` for that entity, enforced server-side | Google, as ciphertext | AES-256-GCM under the household data key | Soft delete propagates to the index, the Sheet and Drive in the same transaction; aged out by policy |
| Record fields, plaintext | The other **92.7%** — names, dates, amounts, institutions, addresses | Same | Same | Same | Same | **Google, as plain text** | None | Same |
| Attachments and documents | Scans, statements, photographs of documents | Uploaded or captured by a household member | `blobs` in IndexedDB; the file in the household's Drive | Follows its record | Same as the record | Google Drive | Encrypted with the household key before upload | The Drive file is trashed with the record |
| Chat messages and their attachments | Household conversation | Written on a device | `conversation` records; sealed attachments in `attachments` | `standard` | The conversation's participants | Ciphertext only, via the Sheet | ECDH P-256 per recipient device, end-to-end | With the conversation |

The single most important line in this table is the second one. **Reading the
Sheet is reading most of the records, with no key involved** — that is the
consequence of 7.3<!--live:encryptedPercent-->% encryption coverage, and it is
why `docs/THREAT_MODEL.md` puts the Google account at the top of its list.

## 2. Credentials and key material

| Data | Purpose | Source | Storage | Retention | Access | Sharing | Encryption | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The data key (DEK) | Encrypts every encrypted field | Generated on this device at enrolment | **Memory only, while unlocked** | Dropped after `sessionTimeoutMinutes` (15) of inactivity | The unlocked app | Never | It *is* the key | Gone on lock, reload, or erase |
| Wrapped copies of the DEK | Let a PIN, a fingerprint, a phrase or an escrow open the same key | Derived when each method is enrolled | `meta.keyring` in IndexedDB | Until the method is removed | The unlock screen | Only the escrow copies leave: Drive (`familyos.keywrap.json`, appDataFolder) or the Apps Script property store | AES-GCM wrapped by a KEK; PBKDF2-SHA256 at 600,000 rounds for the PIN | Removed with the method; all of it on erase |
| Google OAuth **access** token | Authorises every backend and Drive call | Google, at sign-in | **Memory only** | The token's own lifetime, renewed silently | The sync engine | Sent to Google and to the household's own deployment | n/a — never written down | Discarded on sign-out or reload |
| Google OAuth **refresh** token — *native only* | Lets the Android app renew without a browser tab every hour | Google, via the PKCE flow | `meta` under `auth.googleRefreshToken` | Until sign-out | The unlocked app | Sent to Google to refresh | Encrypted with the household data key, so readable only while unlocked | Sign-out revokes at Google **and** clears it locally, whether or not the revoke call succeeds |
| Chat device keypairs | End-to-end encryption between devices | Generated per device | Public half in `deviceKey` records; private half in `meta` under `chat.deviceIdentity`, on this device only | While the device is enrolled | The household | Public halves only | Private half sealed with the household data key, AES-GCM, bound to its own `meta` key. **This row used to read "`deviceKey` records" and "wrapped like any field", and both halves of that were wrong: the private key was in `meta`, in the clear** | With the device |
| One-time codes | Prove which member is at a new device | Generated in the deployment | Apps Script `CacheService`, **hashed** | 600 seconds | Nobody — the code is never returned by the endpoint | Sent to the member's own recorded address only | Stored as a SHA-256 digest, never in the clear | Expires, or is consumed |

## 3. Device and session plumbing

Seven `localStorage` keys, and this is where the inventory earned its keep.

| Data | Purpose | Source | Storage | Retention | Access | Sharing | Encryption | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `familyos.deviceId` | Names this device to the backend so a household can recognise or refuse it | Generated on first run | `localStorage` | Until the site data is cleared | Anything running on the origin | **Sent to the backend with every request**, and stored there in the device list | None | Cleared by erase |
| `familyos.unlockAttempts` | The failed-PIN counter and lockout | Written by `AttemptLimiter` | `localStorage` | Until it expires or is cleared | Anything running on the origin | Never | None | Cleared by erase — **and by anybody who clears site data**, which is the residual risk `docs/THREAT_MODEL.md` records as T1.3 |
| `familyos.theme`, `familyos.locale` | Appearance and language | The person's choice | `localStorage` | Until changed | The app | Never | None | Cleared by erase |
| `familyos.chat.bubble`, `familyos.chat.size`, `familyos.chat.enter` | Chat display preferences | The person's choice | `localStorage` | Until changed | The app | Never | None | Cleared by erase |

## 4. Operational stores

Not records, not synced in the same way, and not previously inventoried
anywhere.

| Data | Purpose | Source | Storage | Retention | Access | Sharing | Encryption | Deletion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `outbox` | Changes made offline, waiting to be pushed | The app, on every local edit | IndexedDB | Until pushed, or discarded by the person | The unlocked app | Its contents become the push payload | Field encryption is already applied to the payload | Erase drops it, **and its contents are the one thing erase says are "gone for good"** |
| `shadow` | The base of the three-way merge for a record with unpushed edits | The last server-agreed version | IndexedDB | Between the first local edit and a successful push | The sync engine | Never | As the record | With the queued change |
| `audit` | What anybody did, per record and per entity | Written by the repository on every change, in the same transaction | IndexedDB, and appended to an append-only `_Audit` tab | Not aged out | Shown in Settings → Activity | Google, via the `audit` action | **Not encrypted — but it holds field *names*, never values**, deliberately, so that it is not a second plaintext copy of the records | Erase drops the local copy; the Sheet's copy stays |
| `search` | Makes records findable by typing | Derived from the record on write | IndexedDB | With the record | The app | Never | **Not encrypted, by construction** — `searchableValues` takes only fields that are `search` and **not** `encrypted`, so no `CRITICAL_SECRET` is ever indexed | Dropped in the same transaction as the record |
| `diagnostics` | What went wrong on this device | The 5<!--live:recordedFailures--> instrumented catch sites | IndexedDB | Bounded at 200 entries — oldest dropped, and the count reported | Shown in Settings → Diagnostics | Never — it does not sync | **Not encrypted, deliberately**: the redaction in `js/data/diagnostics.js` is the safety argument, and fields are truncated to 40–300 characters | Erase drops it |
| `conflicts` | Divergences a person has to resolve | Detected on pull | IndexedDB | Until resolved | The app | Never | As the record | With the resolution |

## 5. What leaves the device, and to whom

| Destination | What reaches it | Under whose account |
| --- | --- | --- |
| The household's Google Sheet | Every record — 92.7% of fields in plain text — plus the audit trail | The household's own |
| The household's Google Drive | Documents and attachments, encrypted; the escrow key file, if enrolled | The household's own |
| The household's Apps Script deployment | Everything above passes through it; it holds the device list, the member list, and — if sign-in by code is on — a key that decrypts the records | The household's own |
| Google (as a company) | All of the above, being the host of all of it | The household's own |
| An SMS gateway | A one-time code and a phone number, **only** if the household configured one. No default gateway and no credentials exist in this repository | The household's chosen provider |
| Anybody else | **Nothing.** Swept for it: no analytics, no telemetry, no crash reporter, no advertising identifier, no Firebase, and no FamilyOS-operated server for anything to be sent to. The only matches in the tree are `js/data/diagnostics.js` explaining that it is *not* telemetry, and an investment screen that computes analytics locally | — |

## Findings

Writing this produced two things that are not descriptions.

1. **The audit trail leaves the device unencrypted, and what that does and does
   not expose is worth stating exactly.**

   The first version of this paragraph said it was "a second, unencrypted copy"
   of the data and that its encryption had never been argued. Both halves were
   wrong, and `js/data/audit.js` says so in its own opening lines: what is
   recorded is *which fields changed*, **not what they changed to**, and the
   reason given is precisely that a before-and-after log "would be a second,
   unencrypted copy of every sensitive field in the system". The trade was
   made deliberately and written down. I had read the store and not the module.

   What is genuinely exposed is **metadata**: a timestamp, an action, an entity
   name, a record id, the actor and their role, and the names of the fields
   touched. Not values. For most entities that is unremarkable. For
   `healthRecord` it is not nothing — *this person opened that health record at
   that time* is readable from the Sheet with no key involved, and the `read`
   action is recorded for entities marked sensitive, which is exactly the set
   where the metadata is most telling.

   So: a narrower point than the one I first wrote, and still a real one. It
   belongs in the inventory because `docs/DATA_CLASSIFICATION.md` grades
   entities, the audit store is not an entity, and nothing else grades it.

2. **`familyos.deviceId` is stable, unencrypted, and sent with every
   request.** That is what makes device management work and it is not a defect.
   It is worth stating plainly that the identifier exists, persists across
   sessions, and is held by the deployment, because "no tracking identifiers"
   is a claim somebody could otherwise make about this application and it
   would be false.

Neither is changed here. This document's job is to say what is true.
