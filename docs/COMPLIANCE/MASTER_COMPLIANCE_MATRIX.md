# Regulatory Applicability — The Matrix

**This is not a compliance claim.** It is an applicability review: a list of
rules that might bear on this application, what each would want, and what the
code actually does. Written by a programmer reading a schema, not by a lawyer
reading a statute. **Every regime here requires legal review before any of it
is relied on.**

The build prompt says it twice, in different words:

> DO NOT claim regulatory compliance without implementation, testing, evidence
> and applicability review.

> Never claim compliance automatically.

Source of truth is `js/domain/compliance.js`; `tools/compliance.mjs` checks it
on every run, and `tests/compliance.test.mjs` fails the build if it drifts.

## What this application is, for the purposes below

An **offline-first record keeper a household runs for itself.** It stores data
on the household's own devices and in the household's own Google account. It
operates no service, holds no licence, files nothing with anybody, and has no
customers. Most of the list below turns on that sentence, so it is stated once
here rather than repeated twenty times.

The two places it stops being true are worth naming up front:

- **Household staff** — records about somebody who is not a member of the
  household, kept by their employer. See `STAFF.md` and `DPDP.md`.
- **Children** — records about a person who cannot consent, created by an
  adult. See `DPDP.md`.

## The statuses

The prompt's own, used with the meanings it implies:

| Status | Means |
| --- | --- |
| `NOT_STARTED` | Nothing exists. |
| `DESIGNED` | Decided and written down; no code enforces it. |
| `IMPLEMENTED` | Code exists, and is named. |
| `TESTED` | A named suite exercises it. |
| `VERIFIED` | Somebody qualified checked the control against the obligation. |
| `NOT_APPLICABLE` | With the reason, always. |
| `LEGAL_REVIEW_REQUIRED` | A programmer should not answer this. |

**Nothing in this repository is `VERIFIED`, and the checker refuses to let
anything be.** Verification is a person putting their name to a judgement. The
day a row says `VERIFIED` it must be a deliberate act, not an edit that slipped
past a reviewer.

`IMPLEMENTED` and `TESTED` must cite something that exists on disk —
`tools/compliance.mjs` resolves every path. That check earned itself on its
first run: three citations pointed at files that had not been merged yet.

## The regimes

| Regime | Applies | Document |
| --- | --- | --- |
| DPDP Act, 2023 | conditionally | [DPDP.md](DPDP.md) |
| IT Act & SPDI Rules | conditionally | [IT_ACT.md](IT_ACT.md) |
| CERT-In Directions | not to this application | [CERT_IN.md](CERT_IN.md) |
| Aadhaar / UIDAI | **directly** | [UIDAI.md](UIDAI.md) |
| CKYCRR / CKYC 2.0 | not to this application | [CKYC_2_0.md](CKYC_2_0.md) |
| RBI & Account Aggregator | not to this application | [RBI.md](RBI.md) |
| PMLA | not to this application | [PMLA.md](PMLA.md) |
| ABDM | not to this application | [ABDM.md](ABDM.md) |
| SEBI | conditionally | [SEBI.md](SEBI.md) |
| Income Tax & GST | conditionally | [TAX.md](TAX.md) |
| Motor Vehicles Act | conditionally | [MOTOR_VEHICLES.md](MOTOR_VEHICLES.md) |
| Property & tenancy | conditionally | [PROPERTY.md](PROPERTY.md) |
| Household staff | **directly** | [STAFF.md](STAFF.md) |
| Electronic records | **directly** | [ELECTRONIC_RECORDS.md](ELECTRONIC_RECORDS.md) |
| Electronic signatures | not to this application | [ELECTRONIC_SIGNATURES.md](ELECTRONIC_SIGNATURES.md) |
| ISO/IEC 27001 | not to this application | [ISO_27001.md](ISO_27001.md) |
| ISO/IEC 27701 | not to this application | [ISO_27701.md](ISO_27701.md) |
| SOC 2 | not to this application | [SOC2.md](SOC2.md) |
| GDPR / UK GDPR / US state law | **uncertain** | [INTERNATIONAL_PRIVACY.md](INTERNATIONAL_PRIVACY.md) |

"Not to this application" is a claim about *this* application and nothing else.
It rests entirely on the paragraph above, and if that stops being true — if this
is ever operated as a service, for anybody — most of these answers change.

## What is not started, in one place

Seven controls have nothing behind them. They are the honest summary of this
review, and they are listed here rather than left to be found one document at a
time.

| Regime | Control | What is missing |
| --- | --- | --- |
| DPDP | breach notice | No breach detection or notification path of any kind. |
| DPDP | children | **A child's record is created by an adult with no consent flow.** The largest gap in the list. |
| STAFF | staff consent | Nothing asks a staff member. The consent engine exists and is not wired to their records. |
| STAFF | staff access | No role for a staff member, and no way for them to see what is held. |
| PROPERTY | tenant records | Two fields on `property`. No tenant entity, no rent ledger, no arrears. |
| ELECTRONIC_RECORDS | tamper evidence | The audit trail is a log in the same database as the records. Nothing signs or chains it. |
| SOC2 | monitoring | No observability at all, and no `OBSERVABILITY.md`. |

## What this review does not do

It does not read the statutes. It does not consider case law, state amendments,
or any obligation arising from a household's own circumstances. It does not
cover Phase 20's "compliance evidence" work, which is where controls would be
tested *against the obligation* rather than against their own description.

It is the applicability review the build prompt asks for at step 12 of every
phase, written down once so that later phases have something to argue with.
