# Digital Personal Data Protection Act, 2023

**Not a compliance claim.** An applicability review by a programmer. Legal
review required before any of this is relied on. See
[MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally.** The Act binds a Data Fiduciary — somebody who determines the
purpose and means of processing personal data. A household keeping its own
records is not obviously one, and the Act's carve-out for purely personal or
domestic purposes is the obvious reading.

That reading gets thinner in two places, and they are where this document is
actually about something:

**Household staff.** Their name, phone number, identity documents, pay and
attendance are held here by their employer. That is not the household's own
data, the relationship is not domestic in the relevant sense, and the person it
concerns has no access to it. See [STAFF.md](STAFF.md).

**Children.** A child's records are created by an adult. The Act has specific
requirements for processing a child's data, including verifiable parental
consent, and no part of this application implements any of them.

## What exists

| Requirement | Status | Evidence |
| --- | --- | --- |
| Consent recorded and withdrawable | `TESTED` | `js/data/consent.js`, 32 checks |
| Purpose limitation | `DESIGNED` | `docs/DATA_CONSENT.md` |
| Retention limits | `TESTED` | `js/data/retention.js`, 19 checks |
| Erasure, propagated | `IMPLEMENTED` | `js/data/retention.js` |
| Breach notification | `NOT_STARTED` | — |
| Children | `NOT_STARTED` | — |

The consent engine is real: purposes are recorded, agreement is a dated act,
and withdrawal is offered in Settings. What it is not is *enforced* — nothing
checks a purpose at the point a field is read, so purpose limitation is a
record of intent rather than a control.

## The two gaps that matter

**Nothing detects or reports a breach.** There is no notification path to
anybody. For a local application the realistic breach is a lost device or a
compromised Google account, and the application would not know about either.
`js/security/escrow.js` already states the second one plainly — *"whoever can
sign in as that Google account can read everything"* — but stating a risk is not
detecting an incident.

**A child's record is created by an adult with no consent flow.** The `person`
entity has a `role` of `child` and an `isDependent` flag; the RBAC rules make a
child's data readable by adults. Nothing anywhere asks whether the child agreed,
records that a parent consented on their behalf, or marks the record as
requiring different treatment. This is the largest single gap in the whole
applicability review, and it is one this application's own design makes worse:
`docs/CHAT_AND_E2EE.md` records that a parent can recover a child's records by
design.

## What would close them

Breach notification needs something that can notice — at minimum, the device
registry noticing an unrecognised device, which `apps-script/Code.gs` already
tracks. That is a Phase 20 piece of work, not a document.

Children need a decision before code: whether this application treats a child as
a person whose data is processed with consent, or as a member of a household
whose records the household keeps. The Act points one way and the product points
the other, and `CHAT_AND_E2EE.md` records the same tension in a different form.
It should not be resolved by whoever implements it first.
