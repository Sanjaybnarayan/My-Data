# Household Staff

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Directly**, and this is the sharpest case in the whole review.

Everywhere else, the household is keeping its own records. Here it is keeping
records **about somebody who is not a member of it**, and is that person's
employer besides. Both the data-protection question and the employment question
are live, and the answers point in an uncomfortable direction.

## What is held

`staff` and `staffLeave`: name, role, start and end dates, agreed monthly pay,
how often they are paid, and every absence with whether it was paid. Identity
documents and payments can be filed against them.

| Requirement | Status | Evidence |
| --- | --- | --- |
| What was agreed never conflated with what was paid | `TESTED` | `js/domain/staffpay.js` |
| Paid and unpaid leave distinguished | `TESTED` | `js/data/schema.js` |
| The staff member's consent | `NOT_STARTED` | — |
| The staff member seeing what is held | `NOT_STARTED` | — |

## What is done well

**An agreed figure is not a payment.** `js/domain/staffpay.js` compares
`staff.monthlyPay` against the transactions that actually left an account, and
refuses the comparison where it cannot be made honestly — a weekly agreement
against a monthly figure, a joining month, a month containing unpaid leave.
Each refusal names its reason rather than producing a number that looks
authoritative. `docs/HOUSEHOLD_STAFF.md` records the reasoning.

For an employment record that matters: a computed shortfall presented as fact
is an accusation, and the arithmetic behind it is often wrong.

## What is not done at all

**Nothing asks the staff member.** The consent engine exists — 32 checks, a real
record of purposes and withdrawal — and is not wired to staff records in any
way. A person's name, phone number, identity documents and pay history are
entered by their employer, and no part of this application records that they
know, still less that they agreed.

**There is no way for them to see it.** RBAC has five roles — owner, spouse,
adult, child, guest — and none of them is *the person this record is about*. A
staff member has no account, no access path, and no means to correct an error
in their own attendance.

## Why this is the honest headline

The rest of this review is mostly a household holding its own data, where the
domestic exemption does the work. **That argument does not reach here.** Under
DPDP the household looks like a Data Fiduciary for these records, and the two
missing controls above are the two the Act would care most about.

Nothing in this document says the application is unlawful — that is not a
programmer's call. It says the two mechanisms a lawful answer would need do not
exist, and that building them is a decision somebody should take deliberately
rather than discover later.
