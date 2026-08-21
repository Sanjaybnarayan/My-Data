# Electronic Signatures

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application, because nothing here signs anything** — and that is
a decision rather than an omission.

| Requirement | Status | Evidence |
| --- | --- | --- |
| No signing, and no appearance of it | `TESTED` | `js/domain/estate.js` |
| A recorded will is a note, and says so | `TESTED` | `js/modules/vault.js` |

## Why this is a refusal and not a gap

The IT Act recognises specific forms of electronic signature — a digital
signature backed by a Certifying Authority's certificate, and Aadhaar eSign.
Anything else is a picture of a signature.

A family record keeper holds exactly the documents where that distinction is
expensive: a will, a power of attorney, a deed, a tenancy agreement. **A
homemade signature mechanism on any of them would be the most damaging thing
this application could offer** — not because it would fail to be a signature,
but because it would look like one to the household relying on it.

So there is no signing. There is no "sign here" control, no signature image
field, no certificate handling, and no integration with an eSign provider.

## What is offered instead

A record that an instrument exists, and where the original is kept.
`legalDocument` and `will` hold the title, who it concerns, when it was
executed, whether it was registered, and where to find it — plus a scan, filed
like any other document.

The screen says what that is, above everything else, and a test asserts the
words are present:

> These are your notes on what the will says, kept so a family can find the
> original and see it beside what each institution was told. The will itself
> decides, and nothing here is a substitute for reading it.

`docs/LEGAL_AND_ESTATE.md` covers the design, including why `share` is free text
and why no succession arithmetic is attempted.
