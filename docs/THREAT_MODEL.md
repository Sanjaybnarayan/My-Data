# Threat model

What can go wrong, who has to do it, and what is left standing after the
defence. Section 3 of the hardening brief asks for this shape and it is kept
literally: **THREAT → VECTOR → LIKELIHOOD → IMPACT → MITIGATION → RESIDUAL
RISK**. The last column is the one that matters. A row whose residual risk
reads "none" is either a boundary nobody can cross or a row nobody thought
about hard enough, and this document has very few of the first kind.

## What this is a model *of*

FamilyOS is an offline-first PWA with no server of its own. Records live in
IndexedDB in a browser; a backup lives in the household's **own** Google Sheet
and Drive, reached through an Apps Script web app the household deploys under
its own account. There is no FamilyOS company, no shared multi-tenant
database, and nowhere for a breach to be *central*. That shape removes whole
categories of threat and creates others — chiefly that every security control
is either in a browser the attacker may own, or in a deployment configured by
somebody who is not a security engineer.

Six boundaries, and the rest of this document is organised by them:

| # | Boundary | What is on the far side |
| --- | --- | --- |
| B1 | The device | IndexedDB, the data key in memory, the screen |
| B2 | The installed package | The Android APK and what it will run |
| B3 | The network | Everything between the app and Google |
| B4 | The Apps Script deployment | `doPost`, and the workbook behind it |
| B5 | The Google account | The Sheet, Drive, and the deployment's own permissions |
| B6 | The message channel | SMS and email, where one-time codes arrive |

Likelihood is judged for **this application's actual users** — a household
running its own deployment — not for an enterprise with an attacker budget.
Impact is judged against the worst plausible outcome of the row, not the
average one.

---

## B1 — The device

617<!--live:fields--> fields across 53<!--live:entities--> entities, of which
45<!--live:encryptedFields--> are encrypted:
**7.3<!--live:encryptedPercent-->%**. Everything else is stored as it was
typed. That single number decides most of this section: *reaching the database
is reaching the records*, and the encryption protects the fields somebody
chose to name, not the corpus.

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T1.1** Records read off an unlocked, unattended device | Somebody picks up a phone left on a table while the app is open | **High** — the commonest real-world compromise there is | Total read of everything the signed-in person may see | `sessionTimeoutMinutes` defaults to 15 and re-locks to the PIN screen; `FLAG_SECURE` in `MainActivity` keeps the app out of the recents thumbnail | **Everything, for up to 15 minutes.** The timeout is a comfort setting a household can lengthen, and shortening it is the only control here |
| **T1.2** Offline brute force of the PIN | Device seized; IndexedDB copied off; PBKDF2 run against the wrapped key without the app | Low for an opportunist, **realistic for a determined adversary** | Full decryption of every encrypted field, and the data key | PBKDF2-SHA256 at 600,000 rounds; the floor is 6 digits, enforced in `keyring.js#assertPin` at both call sites | **A six-digit PIN is one million candidates.** 600k rounds makes each guess expensive, not impossible. This is the single largest residual in the document, and the honest fix is a passphrase rather than a PIN |
| **T1.3** The attempt limiter bypassed | `AttemptLimiter` keeps `failures`/`until` in `localStorage`; clear the site data and the counter is zero | High, if T1.2 is being attempted at all | Removes the only online rate limit on PIN guessing | Five attempts, then a lockout that lengthens by round | **The limiter stops a person guessing at the keypad. It does not stop anyone who can reach storage** — which is the same person T1.2 describes. It is a UX guard, not a cryptographic one, and should not be counted twice |
| **T1.4** Another app or a rooted OS reads the database | Malware with storage access, or a rooted device | Low on a maintained device; high on an old or rooted one | Same as T1.1 | The OS sandbox, and nothing else. `allowBackup="false"` keeps it out of Android's own backup | **On a rooted device there is no mitigation.** A browser-based application cannot defend against the platform it runs on, and pretending otherwise would be theatre |
| **T1.5** The screen is captured | Screenshot, screen recorder, or screen-sharing malware | Medium | Whatever is on screen | `FLAG_SECURE` blocks screenshots and recording, and blanks the recents card | **A camera pointed at the screen.** Also: `FLAG_SECURE` is Android-only — the PWA in a browser has no equivalent || **T1.6** A shared file makes the device do unbounded work | A `.docx`, `.xlsx` or PDF whose compressed parts expand enormously, or whose font character map declares a range of four billion codes. Both are *legal* in their formats and a corrupt file asks for them as readily as a hostile one | **Medium** — documents arrive from banks, insurers, landlords and WhatsApp, and nobody inspects one before opening it | The browser process is killed, or the app hangs; on Android the household loses whatever was unsaved and the file is never read | `js/data/inflate.js` caps one stream at 64 MB and `unzip` / `inflateAll` hold that as a budget across a whole archive or PDF, so 65,535 entries cannot each claim a capful; `js/data/pdf-cmap.js` bounds a `bfrange` to the two-byte code space. `capture` refuses a file over 8 MB before any of this. A **backup archive** carries its own PBKDF2 round count so a future version's file still opens on an old client, and `MAX_ITERATIONS` caps what that header may ask for — measured, 60 million rounds held this machine for 26 seconds and the count is a JSON number | **A bounded read is still a truncated one.** A part cut at the cap is indexed as far as it was read and no further, and nothing tells the household that happened — the alternative, filing the whole document as unreadable, was the worse of the two. Recognition (`core/ocr.js`) and the image decoders are the platform's and are not bounded here |

## B2 — The installed package

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T2.1** A modified build is installed | An APK repackaged with the checks removed, sideloaded or passed around | Low for a household app; the payoff is one family's records | The attacker's build does whatever they wrote | `.github/workflows/android.yml` fails the build if either flavour is debuggable, checked with `aapt2` against both manifests. Signing is **conditional**: with `FAMILYOS_KEYSTORE_BASE64` set the release is signed with the household's own key; without it `build.gradle` falls back to `signingConfigs.debug`, and the workflow says so in as many words | **A build signed with the debug key is not signed in any meaningful sense** — that key is standard and public, so anyone can produce an APK it accepts, and an install signed with it will replace one signed with it. A deployment that has not set the keystore secret has no signing mitigation at all, only the debuggable check. On top of that: **no Play Integrity, no attestation, no anti-tamper**, so nothing tells the backend which build is calling it. Section 37 is not implemented, and the appendix below says why it does not simply fit — verification needs a publisher-operated server this architecture deliberately lacks, and the `sms` flavour is sideload-only and cannot be attested at all |
| **T2.2** Data pulled with `adb run-as` | A debuggable build on a machine the attacker has | Low — it needs a debuggable build **and** physical access | Full database extraction with no PIN | `android:debuggable` is absent from release, and CI proves it for both flavours | **A debug build, if one escapes.** The check exists because this is easy to regress and impossible to see by eye |
| **T2.4** A compromised Capacitor dependency | `package.json` declares eight `@capacitor/*` runtime packages, pinned only to `^` ranges; they and their transitive dependencies are compiled into the APK | Low per-package, and there are more than eight of them once transitives are counted | Arbitrary code inside the app's own process, with the data key in scope | **None.** No lockfile audit, no provenance verification, no pinning beyond the caret | **This is an open gap, stated as one.** The PWA genuinely has no dependencies and that fact does not transfer to the Android build — the two are different supply chains and were nearly conflated in this document |
| **T2.3** A malicious Apps Script paste | The setup asks a person to copy six `.gs` files by hand into their own project | Low, but the *consequence* is unusual | A backend that lies to its own household | `tests/docs.test.mjs` checks the file list in `docs/SETUP.md` against the directory, because that list was already wrong once | **Nothing verifies what was pasted.** There is no signature, no checksum, and no way for the app to tell an unmodified `Code.gs` from an edited one |

## B3 — The network

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T3.1** Traffic intercepted | Hostile Wi-Fi, or an attacker-installed CA (corporate MDM, malware) | Low with a clean device; **certain** with an installed CA | Every pushed and pulled record, in the clear for the 92.7% that is not encrypted | TLS to Google only; `usesCleartextTraffic="false"` stated rather than inherited; `index.html` carries a CSP whose `connect-src` names five Google origins and nothing else | **No certificate pinning.** A device whose trust store the attacker controls sees everything. Pinning Google's endpoints from a hand-deployed app is a rotation hazard that would break households on a certificate change — the trade is named, not silently taken |
| **T3.2** Cross-site injection into the app | A malicious record field rendered into the DOM | Low — no `innerHTML` assignment anywhere, verified by scan | Script execution with the data key in scope | CSP with `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; `tools/lint.mjs` and the security suite | `script-src` still needs `'unsafe-inline'`, which weakens the CSP's XSS value considerably. It buys the connect/frame/form restrictions, which are real |

## B4 — The Apps Script deployment

This is the only network endpoint the household owns, and until recently the
only thing standing between it and a stranger was a Google token belonging to
*anybody* the household had added.

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T4.1** A token issued to a different application is accepted | `tokeninfo` names the account, not the client; any other app the member signed into holds a qualifying token | Medium — it needs the deployment URL **and** a token, but neither is a secret in the way a password is | `push` and `pull` over the whole workbook | `verifyToken` compares `aud` against the `OAUTH_CLIENT_ID` property, which is a **list** because the browser and the Android shell are separately registered clients | **Deployments that have not set the property are unprotected**, deliberately: failing closed would strand existing households. `ping` reports `audienceChecked: false` so the state is visible rather than silent |
| **T4.2** A stranger reaches the endpoint | "Who has access: Anyone" is required for the protocol to work at all | High that it is *reached*; low that it succeeds | Nothing, if the token check holds | Every action but two runs after `verifyToken`; `admit` re-checks the member list on every call rather than caching the decision | **Removal takes effect at once; addition is only as careful as the owner.** The member list is the whole authorisation root |
| **T4.3** A role reads or writes beyond its grant | A modified client sending whatever it likes | Low | Records outside the caller's role | `Policy.gs` is generated from the schema by `tools/policy.mjs` and is the **authoritative** copy — `js/security/rbac.js` in the browser is advisory and says so in its own header. `sheetPush` and `sheetPull` evaluate the caller's real role | This one is genuinely closed server-side. **`docs/SECURITY.md` still says otherwise** — see *Stale claims* below |
| **T4.4** One-time codes brute-forced | `otp.request` and `otp.verify` run before any authentication, because they must | Medium | With an escrow enrolled, decryption of the household's records | `otpIsPublic` is an allowlist, not a prefix test; both actions are serialised under `withScriptLock`; 10-minute TTL; 5 guesses per code; 5 sends per address per hour and 60 per deployment; verify capped at the arithmetic product of the two | **An address in the directory can still be sent 5 codes an hour**, which is a nuisance channel against a known family member. A code is only ever sent to an address already recorded against a person, so it is not an open relay |
| **T4.6** A household member reaches a conversation they are not in | `message` read and write are blanket-granted to owner, spouse, adult and child in `Policy.gs`, and `message` is **not** in `OWN_RECORD` — which only ever widens, never refuses. Nothing server-side knows who is in a conversation | Certain, for anybody with one of those four roles | **Not the contents.** Every message is sealed per recipient *device* by ECDH, and `js/security/e2ee.js` states the property in its own opening: not readable by "a household member outside the conversation". What a non-participant gets is **metadata** — conversation ids, sender person ids, timestamps, row counts: who talks to whom, when, and how much. They can also **write** rows into any conversation | The E2EE, and only the E2EE. `sheetPush` narrows exactly one thing about a message — the `sender` field must match the caller's own `personId`, so a row cannot be attributed to somebody else | **Membership is not a server-side boundary here, and the audit was wrong to call this "not applicable — no backend".** There is a backend and it does authorise; it just does not model conversations. Closing it needs the backend to know who is in one, which is a schema change rather than a patch — recorded as a decision, not done quietly |
| **T4.5** Quota exhaustion or denial of service | A runaway or hostile client | Medium | The household's backup stops working | `RATE_LIMIT` of 120 requests per user per minute, keyed on the verified email | **Pre-auth traffic is bounded only by the OTP caps**, and Apps Script's own quotas are the real ceiling. A household under this attack loses sync and keeps its device |

## B5 — The Google account

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T5.1** The owner's Google account is compromised | Phishing, password reuse, session theft | Medium — it is the single most attacked credential most people own | The Sheet and Drive directly, plus the deployment's own permissions | Nothing in this application. Google's own 2FA is the control, and `docs/SETUP.md` is where a household is told so | **This is the largest exposure in the model and FamilyOS cannot reduce it.** The backup holds 92.7% of every field in plain text; reading the Sheet is reading the records, no key required |
| **T5.2** Google unlock turns the account into a decryption key | Opt-in escrow wrapping the data key against the Google identity | Only for households that chose it | T5.1 becomes total: the *encrypted* fields fall too | Off by default, opt-in, stated on the button and in `escrow.js` | **Chosen, and stated at the moment of choosing.** The residual is exactly what the household agreed to |
| **T5.3** The deployment can decrypt | Sign-in by code stores the wrapped data key **and** the secret that unwraps it in the same property store | Only for households that turned it on | Anyone who reaches the Apps Script project reads everything | Owner-only, off by default, stated on the Settings row, in `codeescrow.js`, in `Otp.gs` and in `docs/SIGN_IN_BY_CODE.md`; the erase screen now names it too | **The joint-largest exposure a household can choose**, and unlike T5.2 it is also reachable through B6 |

## B6 — The message channel

| Threat | Vector | Likelihood | Impact | Mitigation | Residual risk |
| --- | --- | --- | --- | --- | --- |
| **T6.1** SIM swap | The carrier reassigns the number; codes arrive at the attacker's SIM | **Low frequency, high success rate where attempted**, and a well-documented attack in India | With sign-in by code enrolled, full decryption on a new device | Nothing in this application can prevent it. The code's own email text says, in words, that the code opens the records and what to do if it was not asked for | **A phone number is not an authentication factor and is not treated as one here** — except by households that enable the escrow, who are told so first |
| **T6.2** The enrolled inbox is compromised | Password reuse on the email account codes are sent to | Medium | As T6.1 | As T6.1 | Same. The channel is exactly as strong as the account behind it |
| **T6.3** SMS sent through a third party | `otpSendSms` posts to whatever gateway the household configured | Only if configured | The gateway operator sees the code and the number | Inert until `otpSmsEndpoint` and `otpSmsToken` are set; **no default gateway and no credentials in this repository** | **The gateway is trusted absolutely.** That is inherent to SMS, and the alternative offered is email |

---

## Threats deliberately out of scope

Named so their absence is a decision rather than an oversight.

- **A hostile household member with the device PIN.** Roles bound what the
  backend will serve, but somebody who can unlock the device is inside B1 and
  the model does not pretend otherwise.
- **Coercion.** There is no duress PIN and no plausible-deniability store.
- **Traffic analysis against Google.** A household that backs up to Google has
  told Google it has a backup.
- **Supply chain through the web app's dependencies.** The PWA has none: no
  `node_modules` in what is served, no build step, native ES modules. What
  ships to a browser is what is in the repository.

  This is **not** true of the Android build, and the distinction was nearly
  lost when this document was written. `package.json` declares eight
  `@capacitor/*` runtime packages, and they and their transitive dependencies
  are compiled into the APK. Every one is a supply-chain surface the PWA does
  not have. That belongs in the model rather than outside it, and it is
  **T2.4** above.

## Appendix — why T2.1 has no mitigation (section 37)

The residual-risk cell on T2.1 says there is no Play Integrity and no
attestation. `docs/PHONE_OTP_CHAT_SECURITY_AUDIT.md` already records phase 11
as not started and declines to put a date on it. What neither says is *why the
usual fix does not fit this architecture*, and that is worth writing down
before somebody reads "not started" as "nobody got round to it".

**Play Integrity produces a verdict that somebody else has to check.** The app
asks Google for a signed token; the token is meaningless until a party holding
credentials tied to the Play Console listing verifies it. That party is the
app's *publisher*.

FamilyOS has no publisher-operated server. The only backend is the Apps Script
web app **each household deploys under its own Google account**, and that
household does not hold the Play Console listing — so it cannot verify a
verdict about the build it is running. Wiring one up would mean introducing a
central service that every household's app reports to, which is precisely the
thing this architecture exists without, and it would be a larger change to the
privacy posture than the integrity check is worth.

**And one of the two flavours cannot be attested at all.** `standard` is the
build intended for Play; `sms` adds `READ_SMS`, which is a Play restricted
permission, so it is sideload-only by construction —
`docs/INSTALLABLE_BUILD.md` is about installing it past Play Protect. A build
that is not distributed by Play has no Play-recognised installation to attest
to, so an integrity check on it would fail structurally rather than detect
anything.

So section 37 is **not implemented, and it is not merely pending**. Doing it
would require either a service this project does not have and has reasons not
to want, or accepting that it protects one flavour and not the other. That is
a decision for whoever owns the distribution, and it is recorded here as a
decision rather than as a to-do.

## Stale claims found while writing this

`docs/SECURITY.md` is dated *"State as audited at `68b9b65`"* and three of its
seven numbered weaknesses have since been fixed:

| It says | Actually |
| --- | --- |
| "Authorization is client-side only… the backend checks membership, not role" | `Policy.gs` is generated from the schema and enforced in `sheetPush`/`sheetPull` against the caller's real role — T4.3 |
| "No rate limiting on the Apps Script deployment, except on `otp.request`" | `RATE_LIMIT` per authenticated user, and verify-side OTP caps — T4.4, T4.5 |
| "No CSP on `index.html`" | `index.html` carries one — T3.2 |

A dated snapshot is entitled to stay as written; the hazard is its filename.
`SECURITY.md` is what somebody opens to learn the current posture, and three
of its headline weaknesses are historical. **This document is the current
one.** Reconciling the two is not done here, because rewriting a dated audit
in place destroys the record of what was true when.
