# Remediation report

Section 80 of the hardening brief asks for a statement of the state **after**
remediation. `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` is phase 1 — the audit —
and recorded this row as *"Not written. §80 asks for a statement of the state
after remediation, and nothing produces one."* There is now remediation to
report on, so this is that statement.

**It is not a certificate.** The brief's own rule is that nothing may be called
secure and that a perfect score requires every category to genuinely satisfy
its acceptance criteria. Several do not. What follows is what changed, what did
not, and what could not be checked from here.

## What was fixed

Nine pull requests, each with the reasoning in its commit message and each
held by a test that fails when the fix is reverted.

| # | What was wrong | What holds it now |
| --- | --- | --- |
| **#235** | The PIN floor was four digits — ten thousand candidates against a wrapped key. | Six at enrolment, via `pinFloor(mode)`. Split by mode deliberately: raising one shared constant would have permanently locked out every household enrolled before the change. |
| **#236** | **Every APK this repository had ever handed anybody was a debug build**, so `adb run-as` could read the database and wrapped key material off an unrooted device. | Release build types, a signing config read from configuration, and a CI step that reads `debuggable` back out of *both* built APKs with `aapt2` and fails if it appears. |
| **#237** | My own #236 signing bug: the workflow passed a *path* to a file nothing ever created. CI passed because only the no-secret fallback branch had ever executed. | The secret is base64, decoded to disk, and opened with `keytool` before the build trusts it. Three distinct failures now fail loudly instead of falling back silently. |
| **#238** | #235 raised the floor **on the lock screen and not on the door**. `changePin` validated through `keyring.assertPin`, which still read four — so for one release a household could set a four-digit PIN through the very screen they would use to lengthen it. | The floor moved to `assertPin`, the actual enforcement boundary, covering both `enrolPin` and `changePin`. A test reads the constant out of the keyring and asserts the lock screen agrees. |
| **#239** | The erase screen named Sheets and Drive and stopped. With sign-in by code enabled, the deployment also holds a key that decrypts what survives the wipe. | The warning names the escrow, and only when there is one. |
| **#240** | `otpEnforceLimits` was charged on send and nowhere else, so the only thing bounding guesses was the per-code attempt cap. | A verify-side limit whose ceiling is **derived** — `OTP_PER_ADDRESS × OTP_MAX_ATTEMPTS` — so it cannot refuse anything honest use can produce. |
| **#241** | `verifyToken` proved *whose* a token was and never that it was **issued to this application**. Any other app a member had signed into with Google held one that reached `push` and `pull`. | `aud` compared against the `OAUTH_CLIENT_ID` property — a **list**, because the browser and the Android shell are separately registered clients. |
| **#242** | No threat model, no data inventory, and §37 recorded only as "not started". | `docs/THREAT_MODEL.md` and `docs/DATA_INVENTORY.md`, each with a ratchet that fails when the document stops describing the code. |
| **#244** | A request body of the four bytes `null` parsed, then threw reading `.token` — answering an unauthenticated caller with a V8 internal message, a 500, and `retryable: true`. An unknown action was echoed back at whatever length it arrived, 100,000 characters included. | A shape check on the parsed body, and a bound on the echo. Found by **fuzzing `doPost`**, not by reading it — `tests/fuzz.test.mjs`. |

Checks went from **3339 to 3434** across the run — 95 new ones, every one of
them written to fail against a specific reverted behaviour rather than to
raise a count.

## What is still open

Not a backlog. Each of these is a decision somebody has to make, and the
threat model gives each a row with its residual risk stated.

| Open | Why it is still open |
| --- | --- |
| **A six-digit PIN is a million candidates** | 600,000 PBKDF2 rounds makes each guess expensive, not impossible. The honest fix is a passphrase, which is a product decision rather than a patch. **T1.2** |
| **The attempt limiter is bypassable** | Its counter is in `localStorage`. It stops a person at the keypad, not anyone who can reach storage — who is the same person T1.2 describes. **T1.3** |
| **No certificate pinning** | Pinning Google's endpoints from a hand-deployed application breaks households on a rotation. The trade is named rather than the gap hidden. **T3.1** |
| **No Play Integrity** | Verification needs credentials tied to the Play Console listing, held by the publisher; there is no publisher-operated server, and the `sms` flavour is sideload-only and cannot be attested at all. A decision, not a to-do — `THREAT_MODEL.md`, appendix. |
| **Signing falls back to the debug key** | With no `FAMILYOS_KEYSTORE_BASE64` set, `build.gradle` uses `signingConfigs.debug`. That key is public: as a defence against repackaging it is nothing. The debuggable check holds either way. **T2.1** |
| **R8 is off** | `minifyEnabled false`, argued rather than defaulted: Capacitor resolves plugins by reflection, and nothing here can verify on a device that they still resolve when minified. |
| **The Capacitor dependency surface** | Eight runtime packages compiled into the APK, no lockfile audit, no pinning beyond the caret. The PWA has no dependencies; the Android build is a different supply chain. **T2.4** |
| **92.7% of fields are plaintext** | In IndexedDB and in the backup Sheet. Reading the Sheet is reading the records. This is the largest exposure in the model and it is architectural. **T5.1** |
| **Two Play policy items** | `READ_SMS` in the `sms` flavour, and the background-location declaration. Both need a human decision, not code. |

## What could not be checked from here

Stated because a report that quietly omits its own limits is the thing the
brief's rule 62 exists to prevent.

- **No native code has run on a phone.** ML Kit, `PdfRenderer`, the share
  intent and URI resolution are asserted by CI compilation only. Compiling is
  a different claim from working.
- **Whether Capacitor plugins resolve under a release build** is unverified.
  A release build is a different classpath from the debug build every previous
  install used.
- **Whether signing works with real secrets** is unverified. Only the
  no-secret fallback path has ever executed in CI, which is exactly the blind
  spot that produced the #237 bug.
- **This was not a penetration test.** No instrumented device, no scanning, and
  nothing run against a deployed instance. Source review against call sites,
  dependency audit, CI configuration review, targeted measurement in Chromium,
  and — since #244 — fuzzing the backend's entry point in process. That last is
  genuinely dynamic and is genuinely not the same as testing a running service.

## Method, and the corrections

Three findings were withdrawn or corrected during the audit, and three claims
in the remediation itself were wrong and fixed before landing. They are listed
because a report that shows only its successes cannot be checked.

**Withdrawn or corrected findings:**

| Claimed | Actually |
| --- | --- |
| A HIGH OTP concurrency race | Already fixed by `withScriptLock` at `Code.gs:123`, whose docblock describes both races. I had read `Otp.gs` without grepping for its caller. |
| `ScreenTimePlugin` makes no native permission check | It does — my grep pattern omitted `unsafeCheckOpNoThrow`. |
| "There is no PIN-change screen" | It exists at `js/modules/settings/security.js:292`. **This one was expensive**: the false claim reached five merged places and caused #235 to raise the floor on the lock screen only. Corrected in #238. |

**Wrong claims caught before they landed:**

| I wrote | Actually |
| --- | --- |
| A single-valued `aud` check | Would have admitted every browser and **locked every phone out of its own backup** — FamilyOS registers two OAuth clients. Caught by opening `js/auth/googleauth.js` before pushing. |
| The audit trail is "a second, unencrypted copy" | `js/data/audit.js` records *which fields changed, not what they changed to*, for exactly that reason. Metadata, not values. |
| "No dependencies, no build step" | True of the PWA, false of the Android build. |
| "The release APK is signed" | It falls back to the public debug key when no secret is set. |

The pattern in every one is the same, in both directions: **a conclusion drawn
from one file without opening the file that would have contradicted it.** That
is the finding this report would keep if it could keep only one.

## Verdict

**Not "secure", and deliberately not scored 100.**

The `standard` flavour is ready to sideload on the condition that somebody
installs it and confirms the native plugins resolve under a release build.
Google Play is not ready: the keystore secret decides whether the build is
signed with anything meaningful, and two policy items need a human.

What genuinely improved is narrower than the list of merged pull requests
suggests, and worth saying precisely. #236 and #237 closed a real and serious
exposure — every distributed build being readable over `adb`. #241 closed a
real authentication hole. #238 closed a hole that #235 had opened. The rest
tightened limits, named risks that were already there, or wrote down what
nothing had written down.

Naming a risk is not removing it. `docs/THREAT_MODEL.md` is the register of
what remains.
