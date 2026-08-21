# Ayushman Bharat Digital Mission

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application.** ABDM's Health Data Management Policy binds
participants in the ecosystem — Health Information Providers, Health Information
Users, and Health Repository Providers. Joining is voluntary and this
application has not joined.

There is no ABHA linkage, no consent-manager integration, and no health
information exchange. `grep -i abdm js/` returns nothing, and the architecture
probe asserts it stays that way.

## What is held instead

Health notes a household typed for itself: `healthRecord`, `medication`,
`vaccination`, `appointment`. Prescriptions and reports arrive as uploaded
documents like any other file.

| Requirement | Status | Evidence |
| --- | --- | --- |
| No ABHA linkage, real or simulated | `TESTED` | architecture probe |
| Diagnoses encrypted at rest | `TESTED` | `js/data/schema.js` |
| Not readable by every role | `TESTED` | `js/security/rbac.js` |

## The part that is uncomfortable, and true

ABDM's policy is built around **the individual's consent to each disclosure**.
This application is built around a household holding its members' records
together, with adults able to read a child's.

Those are different models, and this one is not a defective version of the
other — it is a record keeper for a family, not a health information exchange.
But the difference should be visible rather than glossed: a person's diagnoses
are readable by the adults in their household, by design, and nothing asks them.

The same tension is recorded in `CHAT_AND_E2EE.md` about messages and in
`DPDP.md` about children. It is one product question wearing three hats, and it
is not settled anywhere in this repository.
