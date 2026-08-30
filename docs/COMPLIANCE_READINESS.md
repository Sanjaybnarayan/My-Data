# Compliance Readiness

**Base:** `1c8d97d` · 22 August 2026.

> **No compliance claim is made in this repository, and none is made here.**
> This document records *implementation readiness* only. Determining legal
> compliance is not something an audit of source code can do, and
> `tools/compliance.mjs` is built so that nothing can quietly start claiming it.

## The mechanism

`node tools/compliance.mjs` reads `js/domain/compliance.js` and reports:

<!--counts:begin-->

```
19 regimes · 68 controls
TESTED 45 · IMPLEMENTED 9 · DESIGNED 5 · NOT_APPLICABLE 8 · LEGAL_REVIEW_REQUIRED 1
0 NOT_STARTED · 0 VERIFIED
```

## Per regime

| Regime | Controls | Status breakdown |
| --- | --- | --- |
| Digital Personal Data Protection Act, 2023 | 6 | TESTED 2 · IMPLEMENTED 2 · DESIGNED 2 |
| Information Technology Act, 2000 and the SPDI Rules, 2011 | 4 | TESTED 3 · NOT_APPLICABLE 1 |
| CERT-In Directions, 2022 | 3 | NOT_APPLICABLE 3 |
| Aadhaar Act and UIDAI regulations | 5 | TESTED 5 |
| CKYCRR and the CKYC 2.0 framework | 3 | TESTED 3 |
| RBI directions on customer data and Account Aggregators | 3 | TESTED 3 |
| Prevention of Money Laundering Act and Rules | 2 | NOT_APPLICABLE 2 |
| Ayushman Bharat Digital Mission | 3 | TESTED 3 |
| SEBI regulations on investment records and advice | 3 | TESTED 3 |
| Income Tax Act and GST, as they touch record keeping | 4 | TESTED 2 · IMPLEMENTED 1 · DESIGNED 1 |
| Motor Vehicles Act, as it touches vehicle records | 3 | TESTED 3 |
| Property and tenancy law, as it touches records | 5 | TESTED 4 · IMPLEMENTED 1 |
| Household staff: wages, hours and record keeping | 4 | TESTED 2 · IMPLEMENTED 2 |
| Electronic records: retention, integrity and admissibility | 4 | TESTED 4 |
| Electronic signatures | 2 | TESTED 2 |
| ISO/IEC 27001 information security management | 5 | TESTED 3 · DESIGNED 1 · NOT_APPLICABLE 1 |
| ISO/IEC 27701 privacy information management | 3 | TESTED 1 · IMPLEMENTED 1 · DESIGNED 1 |
| SOC 2 trust services criteria | 3 | TESTED 2 · NOT_APPLICABLE 1 |
| GDPR, UK GDPR and US state privacy law | 3 | IMPLEMENTED 2 · LEGAL_REVIEW_REQUIRED 1 |

<!--counts:end-->

**The block above is generated, and it did not used to be.** These numbers were
hand-typed, and an audit found seven of the nineteen rows stale — every one
understating what had been built, including seven controls this document called
NOT_STARTED that were finished. A hand-maintained count beside a derivable one
is the fault this repository has found more often than any other, and it had
reached the document that summarises the checks against it.
`node tools/compliance.mjs` now fails when the two disagree, and `--update`
rewrites the block. See `docs/A_COUNT_THAT_STOPPED_COUNTING.md`.

Three properties make the table worth reading:

1. **Nothing claims VERIFIED**, and the number 0 is a ratchet.
2. **A control may cite only a test the runner actually executes.** Citing a
   real file that `tests/run.mjs` never runs is refused — `tests/fixture.mjs`
   was used to demonstrate that the check can fail. The existence check is also
   real: renaming `tests/security.test.mjs` fails three controls immediately.
3. **The numbers are the register's own.** They are read from
   `js/domain/compliance.js` at check time, so a control that moves shows up
   here or the build fails.

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

### The sweep those two controls rest on could read nothing

Written after the fact, because it is a correction to the paragraph above.

*"`tests/refusals.test.mjs` now reads everything that ships"* was the sentence
that moved `UIDAI/no-authentication` and `PROPERTY/no-legal-effect-claim` to
**TESTED**. It read everything that ships, and it would also have said the same
thing having read nothing.

The sweep walked `js/` and `apps-script/` through
`readdir(dir).catch(() => [])`. A directory that could not be read became a
directory with nothing in it — a rename, a permission, a wrong root — and the
walk returned fewer files, or none, with no error anywhere. Nothing checked the
count. Making the helper return `[]` outright left the whole suite green at
2991: five refusal tests certifying regulatory absences over zero source files.

The paragraph above names this failure exactly — *"the easiest to let rot,
because nothing breaks the day it stops being true"* — and the mechanism built
to stop it had the same shape as the thing it was stopping.

Fixed: the walk no longer catches, so an unreadable source tree fails the test
rather than emptying it, and a floor is asserted inside the helper so every
call site is covered rather than one test that a later call site could forget.
The floor is deliberately well under the real count — it is a tripwire for a
broken walk, not a number to maintain.

**The controls stay `TESTED` and the count stays 45.** The tests were passing
for the right reason — the sweep really did read 226 files, and the refusals
really do hold. What was missing is any reason to believe that tomorrow. No
score moves on this; a scorecard that went up because a test got harder to
fool would be measuring the wrong thing.

Two more of the same shape were found alongside it and fixed in the same
change: the certificate-validation sweep in `tests/native.test.mjs`, written
the same day, returned quietly from any unreadable source set including the one
that must exist; and in `tests/portability.test.mjs` a `.catch(() => '')` on
`js/services/archive.js` did not silence its check but **inverted** it, sending
the assertion down the branch that demands the documentation say a restore does
not exist. That one is caught today only because the document happens to sit in
the disagreeing branch — flip the document and it passes while asserting the
opposite of the truth.

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
