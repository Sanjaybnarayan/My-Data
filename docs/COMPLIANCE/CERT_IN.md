# CERT-In Directions, 2022

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application**, and the reason is the whole document.

The Directions bind service providers, intermediaries, data centres, body
corporates and VPN providers. Their obligations — six-hour incident reporting,
180 days of logs held in Indian jurisdiction, NTP synchronisation, five years of
subscriber records — are obligations of somebody who *operates a service for
other people*.

This application operates no service. It runs on the household's own devices.
Its backend is an Apps Script deployment inside the household's own Google
account, serving that household and nobody else. There is no subscriber, no
customer, and no operator distinct from the user.

| Requirement | Status | Why |
| --- | --- | --- |
| 180-day log retention in India | `NOT_APPLICABLE` | No service is operated |
| Six-hour incident reporting | `NOT_APPLICABLE` | No service, and no operator to report |
| NTP synchronisation | `NOT_APPLICABLE` | The device's own clock is used |

## What would change this

If this were ever hosted for households other than the one running it — a shared
deployment, a hosted sync service, anything with a subscriber — the analysis
inverts completely and this document becomes wrong rather than merely
inapplicable.

That is not a hypothetical worth ignoring: the Apps Script backend is a
deployment, and a deployment can be shared. `docs/SERVER_AUTHORIZATION.md`
records that it admits members by email against a list. One household's list is
a household. Several households' lists would be a service.
