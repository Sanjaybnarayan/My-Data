# Compliance Readiness

**Base:** `1c8d97d` · 22 August 2026.

> **No compliance claim is made in this repository, and none is made here.**
> This document records *implementation readiness* only. Determining legal
> compliance is not something an audit of source code can do, and
> `tools/compliance.mjs` is built so that nothing can quietly start claiming it.

## The mechanism

`node tools/compliance.mjs` reads `js/domain/compliance.js` and reports:

```
19 regimes · 68 controls
41 TESTED · 8 NOT_APPLICABLE · 7 IMPLEMENTED · 7 NOT_STARTED
 4 DESIGNED · 1 LEGAL_REVIEW_REQUIRED · 0 VERIFIED
```

Two properties make the table worth reading:

1. **Nothing claims VERIFIED**, and the number 0 is a ratchet.
2. **A control may cite only a test the runner actually executes.** Citing a
   real file that `tests/run.mjs` never runs is refused — `tests/fixture.mjs`
   was used to demonstrate that the check can fail. The existence check is also
   real: renaming `tests/security.test.mjs` fails three controls immediately.

## Per regime

| Regime | Controls | Status breakdown |
| --- | --- | --- |
| DPDP | 6 | TESTED 2 · IMPLEMENTED 1 · DESIGNED 1 · NOT_STARTED 2 |
| IT Act | 4 | TESTED 3 · NOT_APPLICABLE 1 |
| CERT-In | 3 | NOT_APPLICABLE 3 |
| UIDAI | 5 | TESTED 4 · IMPLEMENTED 1 |
| CKYC 2.0 | 3 | TESTED 3 |
| RBI | 3 | TESTED 3 |
| PMLA | 2 | NOT_APPLICABLE 2 |
| ABDM | 3 | TESTED 3 |
| SEBI | 3 | TESTED 3 |
| Income Tax / GST | 4 | TESTED 2 · IMPLEMENTED 1 · DESIGNED 1 |
| Motor Vehicles | 3 | TESTED 3 |
| Property | 5 | TESTED 3 · IMPLEMENTED 1 · NOT_STARTED 1 |
| Staff | 4 | TESTED 2 · NOT_STARTED 2 |
| Electronic Records | 4 | TESTED 3 · NOT_STARTED 1 |
| Electronic Signatures | 2 | TESTED 2 |
| ISO 27001 | 5 | TESTED 3 · DESIGNED 1 · NOT_APPLICABLE 1 |
| ISO 27701 | 3 | TESTED 1 · IMPLEMENTED 1 · DESIGNED 1 |
| SOC 2 | 3 | TESTED 1 · NOT_STARTED 1 · NOT_APPLICABLE 1 |
| International privacy (GDPR / UK GDPR / US) | 3 | IMPLEMENTED 2 · LEGAL_REVIEW_REQUIRED 1 |

Each regime has a document under `docs/COMPLIANCE/`, and
`js/domain/compliance.js` records **why the regime is or is not applicable**
rather than assuming it applies.

## What "TESTED" means here, and what it does not

**Means:** a named test in the suite exercises the control, and the runner
really runs that test.

**Does not mean:** the control satisfies the regulation, that the regulation
applies, or that evidence has been assembled for an assessor. The specification
says *"never claim compliance automatically"*, and the status vocabulary is
built to keep that promise: the highest status any control can reach through
code alone is TESTED. **VERIFIED requires a human, and nothing has one.**

## The one control asking for a lawyer

`INTERNATIONAL_PRIVACY` carries the single `LEGAL_REVIEW_REQUIRED`, concerning
data residency and cross-border transfer. That is the right classification: the
application stores data on the household's own device and in the household's own
Google account, which makes the residency question depend on facts about the
household, not about the code.

## The seven NOT_STARTED

Two under DPDP, two under Staff, one under Property, one under Electronic
Records, one under SOC 2. They are listed as not started rather than hidden, and
`tools/compliance.mjs` reports the count on every run. Two of them are the
open product questions recorded in `docs/PHASE_AUDIT_REPORT.md` §9 — child
consent, and notice to staff and tenants recorded in the database.

## Effect of the P0 on this table

The server-side authorization defect (`docs/SECURITY_AUDIT.md`) does not change
any status above, because every control that touches authorization is tested
against the **client** RBAC and the **policy table**, both of which are correct.
It does mean that any future control claiming "authorization is enforced
server-side" would be citing a mechanism that is currently fed a constant. No
control makes that claim today, and none should until the wiring test exists.

## A control held below TESTED now has to say why

The checks in `js/domain/compliance.js` all ran one way: they stop a control
claiming more than its evidence supports. `unevidenced` refuses a status that
cites nothing, `citingUnrunTests` refuses a TESTED row naming a suite the
runner never executes, and `claimingVerified` refuses `VERIFIED` outright.

Nothing checked the other direction. A control can also sit **below** what it
has done, and a status with no reason beside it is indistinguishable from a
status nobody has revisited — which is precisely how four rows of
`docs/PHASE_STATUS.md` came to assert that built things were unbuilt.

`unexplained()` closes it: a `DESIGNED` or `IMPLEMENTED` control must state a
gap. Fourteen of the sixteen already did.

**A gap is not an admission of failure.** `DPDP/children` states that nothing
verifies the adult is the guardian — which is why it is IMPLEMENTED and not
TESTED, since the requirement is *verifiable* parental consent and this
application has no means to verify. Writing that down is the control working.

### The two that said nothing were refusals

`UIDAI/no-authentication` — *no Aadhaar authentication or e-KYC performed* —
and `PROPERTY/no-legal-effect-claim` — *no generated document claims legal
effect*. Both asserted an absence and cited a file for it, which is somebody's
word.

A refusal is the easiest kind of claim to test and the easiest to let rot,
because nothing breaks the day it stops being true. `tests/refusals.test.mjs`
now reads everything that ships and fails on a UIDAI host, an auth or e-KYC
call, any URL addressed to the authority, or a claim of legal effect anywhere
in `js/` — not only in the report builders, because the same sentence on a
screen is the same claim.

Both are now `TESTED`: **45**, up from 43. Raised by doing the work, not by
relabelling, and neither became `VERIFIED` — a passing suite is evidence the
code does what it says, and verification is a person qualified to judge
signing their name. Nothing here is `VERIFIED` and nothing claims the
application is compliant.

### What mutation testing said about the guard itself

Seven mutations. Six caught. Two conditions survive rather than one, because
each catches what the other cannot: the length floor stops a token, and the
word list stops a *long* excuse — `TODO: come back to this once we have
decided what we want to do here` clears forty characters and explains nothing.
Deleting the word list broke no test until a fixture that long existed.

The one that was not caught is **inert rather than uncaught**, and is recorded
as such: redefining the constructor's `gap = null` default to a placeholder
changes no outcome today, because all fourteen applicable controls pass an
explicit gap and none falls back to the default. Claiming a catch that did not
happen would be the same species of error this file exists to prevent.
