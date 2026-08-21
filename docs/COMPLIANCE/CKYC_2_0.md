# CKYCRR and the CKYC 2.0 Framework

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application.** The registry framework binds *reporting entities* —
banks, insurers, intermediaries — who upload KYC records to CERSAI and download
them against a KIN. A household is not a reporting entity, cannot file with the
registry, and cannot fetch from it.

## What is actually stored

Notes. `kycRecord` holds what each institution says it holds about a person:
the name on their file, the address, the date of birth, the KIN they quoted.
Taken from statements, portals and letters, typed by the household.

The value of that is not the record — it is the **comparison**. Read against
each other, those notes answer questions no single institution can:

- which institutions disagree about somebody's address;
- whether two people appear to share one CKYC identifier;
- which record is stale enough to be worth refreshing.

`docs/IDENTITY_CONFLICTS.md` covers the engine and `docs/KYC.md` the record.

## The refusal, and where it lives

| Requirement | Status | Evidence |
| --- | --- | --- |
| Never present local notes as registry data | `TESTED` | `js/modules/identity.js` |
| No CKYCRR connector, real or simulated | `TESTED` | `docs/KYC.md` |
| A KIN is validated in shape only | `TESTED` | `js/domain/kyc.js` |

The first is on the screen, not in a comment, and a test asserts the words are
there:

> These are your own notes on what each institution holds, taken from
> statements, portals and letters. Nothing here is fetched from the Central KYC
> Records Registry, and nothing here is verified — only compared.

A KIN is checked for length and check digit — that a string is *shaped* like a
KIN. It is never checked for existence, because checking would mean querying a
registry this application does not talk to. Shape validation that looked like
verification would be the worst of both.
