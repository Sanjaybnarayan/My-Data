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
