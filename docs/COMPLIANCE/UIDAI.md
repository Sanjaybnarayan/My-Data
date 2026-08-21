# Aadhaar Act and UIDAI Regulations

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Directly.** Not because this application asks for an Aadhaar number, but
because a family record keeper receives one whether it asks or not — typed into
an identity document, printed on a bank letter, sitting in a PDF somebody
uploaded. The rules on storing and displaying it bind whoever holds it.

## What this application does not do

**No authentication, no e-KYC, no Aadhaar-based verification of any kind.**
There is no UIDAI connector, real or simulated. `docs/KYC.md` records this as a
refusal rather than an omission: an application that appeared to verify an
Aadhaar number would be making a claim about a person's identity that it has no
means to make.

Nothing here is an Authentication User Agency, a KYC User Agency, or a requesting
entity. Those are the roles the Act's heaviest obligations attach to.

## What it does do

| Requirement | Status | Evidence |
| --- | --- | --- |
| No authentication or e-KYC | `IMPLEMENTED` | `js/domain/kyc.js` |
| Shown masked by default | `TESTED` | `js/data/classification.js` |
| Not written into searchable plaintext | `TESTED` | `js/domain/identifiers.js` |
| Encrypted at rest | `TESTED` | `js/security/fieldcrypto.js` |
| Never the identifier for a person | `TESTED` | `js/data/schema.js` |

The third row is the one that took work. `ocrText` is searchable, and in this
schema searchable means unencrypted — so text read out of an uploaded document
had to be scrubbed before indexing. `js/domain/identifiers.js` finds Aadhaar,
PAN, passport and card numbers in extracted text, removes them from what gets
indexed, and hands them back separately to be stored encrypted.

The last row matters more than it looks. **An Aadhaar number is not a primary
key.** People share numbers by error, change them, and have records that predate
them; a person here is identified by an internal id and nothing else. The same
rule is applied to PAN and to CKYC identifiers, and `docs/IDENTITY_CONFLICTS.md`
records what happens when two people appear to share one — it is reported as a
conflict, never resolved automatically.

## Masking, precisely

A masked number shows enough to tell two documents apart and no more. A browser
check drives this against a real record: the full number must not appear in a
list, four digits must, and the detail screen must cover it until a person
presses a control to reveal it. A number nobody can read is a number nobody can
use, so the reveal exists — but it is an act, and the audit trail records it.
