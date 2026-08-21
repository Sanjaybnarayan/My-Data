# GDPR, UK GDPR and US State Privacy Law

**Not a compliance claim.** An applicability review by a programmer. **Legal
review required — more than for any other document here.** See
[MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Uncertain, and a programmer should not be the one to decide.**

The straightforward reading is that a household in India, running an application
on its own devices for its own records, is outside all of these. GDPR Article
2(2)(c) excludes processing by a natural person in the course of a purely
personal or household activity, and the UK GDPR follows it.

Three things make that less straightforward, and none of them is resolved here:

**A member living in the EU or the UK.** Whether the household exemption
survives one member's records being processed while they are resident elsewhere
is not a question this file can answer.

**Data at rest in a Google account.** Documents upload to Drive and a backup
Sheet lives in the household's Google account. Which region Google places that
data in is Google's to determine and is not chosen here.

**Household staff.** The household exemption is about *personal or household
activity*. Employing somebody and keeping employment records may not be that.
The same doubt is recorded, for DPDP, in [STAFF.md](STAFF.md), and it is the one
place where several regimes point the same way at once.

| Requirement | Status | Note |
| --- | --- | --- |
| A lawful basis for each purpose | `LEGAL_REVIEW_REQUIRED` | The household exemption is the obvious answer and its edges are not for this file to draw |
| Where the data rests | `IMPLEMENTED` | Device, plus the household's own Google account |
| Erasure, portability, access | `IMPLEMENTED` | As household operations, not as rights requests |

## The distinction that matters

Deletion and export **exist**, and they are not the same thing as the rights
they resemble.

A rights request has a requester, an identity check, a deadline and a response.
What exists here is a household deleting its own record and exporting its own
data. If the exemption ever failed to apply, those mechanisms would be the raw
material for a rights process and not a rights process — and there is currently
no requester other than the owner, which is precisely the gap
[ISO_27701.md](ISO_27701.md) and [STAFF.md](STAFF.md) both arrive at from
different directions.

## US state law

CCPA and its successors bind businesses meeting revenue or volume thresholds.
A household meets none of them. Named here only so the answer is written down
rather than assumed.

## What would change all of this

Operating this for anybody other than the household running it. That single
change moves nearly every "not to this application" in this review, and it is
the same hinge [CERT_IN.md](CERT_IN.md) turns on.
