# Security

State as audited at `68b9b65`. Findings only — nothing was changed.

## What is sound

- **WebCrypto throughout.** AES-256-GCM, PBKDF2 at 600,000 rounds, WebAuthn
  PRF. No homemade cryptography anywhere.
- **Two-level key hierarchy.** A random data key, wrapped separately by PIN,
  fingerprint, recovery phrase and — each optional, each off by default — a
  Drive-escrowed key and a backend-escrowed one. Changing a PIN re-wraps and
  re-encrypts nothing.
- **The OAuth token is never persisted.** Memory only, renewed silently.
- **Backend verifies every request** against Google's `tokeninfo` and an
  owner/member list.
- **No `eval`, no `innerHTML` assignment, no hard-coded credentials, no
  `process.env`, no mock APIs in shipping code.** All verified by scan.
- **A parse check compiles every module**, catching syntax errors in screens
  no test imports.

## Weaknesses, in severity order

1. **Authorization is client-side only.** `js/security/rbac.js` decides what a
   `child` may see, inside the child's browser. The backend checks membership,
   not role. **A role is a UI convenience here, not a security boundary**, and
   must not be described as one until mirrored server-side.
2. **Google unlock makes the Google account sufficient to decrypt.** Opt-in,
   stated on the button and in `escrow.js`.
3. **Signing in by code makes the Apps Script deployment sufficient to
   decrypt.** Opt-in, owner-only, off by default, and stated on the Settings
   row, in `codeescrow.js`, in `Otp.gs` and in `docs/SIGN_IN_BY_CODE.md`. It is
   the joint-largest exposure a household can choose, and the household that
   asked for it was told so before choosing. Unlike the Google escrow it is
   also reachable by whoever controls the enrolled inbox or SIM, because a code
   sent there is the whole of the credential.
4. **93% of fields are plaintext** in IndexedDB and in the backup Sheet.
5. **No rate limiting** on the Apps Script deployment, except on `otp.request`.
6. **No CSP on `index.html`.** `oauth-callback.html` has a strict one.
7. **No MFA, no session revocation, no device management.**

## Tests that exist

`tests/security.test.mjs` covers crypto round-trips, key wrapping, PIN
strength, RBAC rules, sanitisation and session limits.
`tests/escrow.test.mjs` covers the Drive escrow and the three device cases.
`tests/codeescrow.test.mjs` covers the backend escrow, and `tests/otp.test.mjs`
covers what the backend will and will not release.

Not covered: XSS, CSRF, injection, upload safety, rate limits, API security
under a hostile client — several of which are only meaningful once a server
exists.

## The deployment setting three places disagreed about

`docs/ARCHITECTURE.md` said the Apps Script web app is *"deployed as execute as
user accessing"*, and drew a conclusion from it: **"Sheets and Drive access
uses the signed-in family member's own Google account."** The manifest said the
same. `docs/SETUP.md` — the only page that tells a household what to click —
says **Execute as: Me**.

The setup page is right, and it is not close. `PropertiesService
.getUserProperties()` holds `sheetMap` and the Drive tree. Under *user
accessing* every member would read their own empty copy, so sync would work for
nobody but the owner. **A deployment that functions at all is one deployed as
Me.**

So the security sentence in the architecture document was false for every real
deployment. What actually stands between a caller and the owner's Drive is
`verifyToken` plus `Policy.gs` — a genuine boundary, and a different one from
the sentence that was there.

`tests/backend.test.mjs` now asserts the manifest and the setup page agree, and
that the architecture document does not claim the opposite. A security claim
with nothing checking it is exactly how this survived.

## One-time codes: what they are for, and what they are not

`apps-script/Otp.gs` sends a code to an address already recorded against a
person, so a household member can confirm which of the household they are
instead of picking from a list anybody could change.

**Until a household turns signing in by code on, it is not what protects the
records.** The PIN protects them and the encryption keys protect them.
Verification tells a *browser* that an address answered, and a browser is not a
place an authorisation decision can be enforced — anybody who can open a
developer console can set the same flag. The sign-in screen says so, the file
says so, and the response itself carries `grants: 'identity-only'` so a second
client built against this cannot quietly treat it as more.

### The trade this document used to say had not been made

It said: *"Wiring a code to release the escrow key would mean whoever takes over
a phone number reads every conversation ever sent, and that trade has not been
made."*

**It has now been made, deliberately, at the household's request**, and the
sentence above was corrected here rather than left to be discovered. It is
opt-in, owner-only, per person, and off until somebody turns it on — and for a
person it is on for, the consequence is exactly the one that sentence named.
`docs/SIGN_IN_BY_CODE.md` is the whole account: what it buys, what it costs,
and who can read what afterwards.

For every person it has *not* been turned on for, the paragraph above still
holds and `otpVerify` still answers `grants: 'identity-only'` and releases
nothing.

### The first unauthenticated endpoint, and why the existing protections were useless

Every other action runs `verifyToken` first. A code has to be requestable
before sign-in, so these two are answered before that check — which broke both
existing protections:

| | Why it does not work pre-auth |
| --- | --- |
| `enforceRateLimit` keys on the **verified** email | pre-auth the caller supplies the address, so the key is attacker-chosen |
| it uses `CacheService.getUserCache()` | for an anonymous caller that is **per session** — a fresh bucket every request |

`getScriptCache()` is shared across all callers, so the replacements bite: five
codes per address per hour, and **sixty per deployment per hour across all
addresses**. The second is the one that matters — spreading requests over many
addresses defeats a per-address limit completely, and with an SMS gateway
attached that is somebody's credit being drained, which is an established fraud
rather than a hypothetical.

### The rest of it

- **Hashed, salted with the address, never stored in the clear.** Ten minutes,
  one use, five wrong attempts and the code is destroyed rather than left to be
  guessed at leisure.
- **`Math.random` is not used.** `getSecureRandomBytes` is; a code from a
  non-cryptographic generator is predictable from a few observed ones.
- **An unknown address gets the same answer as a known one**, and is charged
  the same rate limit. Otherwise this endpoint answers *"does this address
  belong to your household?"* for anybody who asks.
- **A code is only ever sent to an address already on a person's record.**
  Sending to anything a caller types would make the deployment an open relay in
  the household's name, on the household's Gmail quota.
- **Public actions are a list, not a prefix.** `otp.` as a prefix would make
  the next action somebody names `otp.anything` public the day they wrote it.
- **SMS is inert until configured.** No gateway, no credentials, no default. In
  India a transactional message also needs the sender id and template
  registered under DLT; the refusal says so rather than failing with a gateway
  error nobody can act on.

**16 tests, 5 of 5 mutations caught**: the deployment-wide ceiling removed, the
code returned in the reply, the code stored in the clear, the public-action
list turned into a prefix test, and an unknown address made distinguishable
from a known one. A sixth mutation — restoring `USER_ACCESSING` to the
manifest — fails the deployment-agreement check.

### The client half

`js/sync/transport.js` grew one method, `callPublic`, and it is deliberately a
separate method rather than a flag on `call`: a flag can be passed by accident,
and an ordinary action sent without a token would be a client inviting the
server to be wrong about which ones are safe. It refuses anything not in
`PUBLIC_ACTIONS` — the same two names the server has in `otpPublicActions()`,
listed in both places on purpose, with a test asserting the client's list.

`js/domain/otp.js` is the flow as a pure reducer, so every step including every
refusal is testable without a network or a DOM. Two behaviours in it are there
because of how sign-ins fail in practice:

- **A wrong code does not send you back to the start.** Doing so would throw
  away a code that is still valid and charge the rate limit for another, which
  is the failure that makes people give up.
- **The person comes from the server's answer, never from the address on
  screen.** A screen that filled it in from what it already had would be
  trusting itself about the one fact the exchange exists to establish.

`limitsFor` picks the sentences a sign-in screen must show, from the catalogue,
rather than leaving each screen to write something shorter and warmer that
implies a code is protecting something. There are three sets and no default:
one for a household that has not turned signing in by code on, one for a
household that has — where the first set has become false and reciting it would
be a false reassurance — and one for a screen that could not find out which. A
test asserts the three sets share no key, because they contradict each other and
a sentence true in both would be a sentence saying nothing.

**2 of 2 mutations caught**: a failure dropping back to the address step, and a
person invented from the address instead of read from the answer.

### The card

`js/modules/signin.js`, on Profile. Two things about it are the point.

**It offers nothing that cannot work.** With no Apps Script URL configured
there is no server to send or check a code — a browser cannot check its own —
so the card says that and draws no form at all. That is the fault the chat
composer had before UI-6: a form that takes your typing and fails afterwards.

**The sentences are always on it**, in every state including the unavailable
one, and they come from `limitsFor` rather than being written in the screen. A
sign-in card is exactly where somebody would assume a code is protecting
something — or, once signing in by code is on, exactly where they would assume
it is not.

Confirming reloads rather than repainting one card. `resolveActor` runs at
boot and half the shell is drawn from it, so repainting locally would leave the
rest of the application disagreeing about who is here.

`Flow` is a declared typedef rather than an inferred one. Without it TypeScript
reads `start()` as returning the literal `'address'`, and every screen would
carry a cast — a lie repeated per file instead of a type written once.

**2 of 2 mutations caught**: the form offered with nothing to answer it, and
the limitations left off.
