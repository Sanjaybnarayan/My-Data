# Motor Vehicles Act, As It Touches Vehicle Records

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally.** The obligations — valid insurance, a current PUC certificate,
fitness where required — are on the vehicle's owner, not on an application. What
an application affects is whether the owner is reminded before the date rather
than after it.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Expiry surfaced before the date | `TESTED` | `js/domain/reminders.js` |
| Chassis and engine numbers encrypted, not indexed | `TESTED` | `js/domain/extract.js` |
| No RTO or VAHAN connector | `TESTED` | architecture probe |

## The identifiers

A registration certificate carries a chassis number and an engine number, and
both are marked `encrypted: true` in the schema.

That flag was being defeated. Text read out of an uploaded RC went into
`ocrText`, which is searchable and therefore unencrypted — so the numbers were
written in the clear into a searchable index while the form field beside them
was sealed. `docs/AGREEMENTS_AND_VEHICLES.md` records the finding; the fix is in
`js/domain/extract.js`, which now recognises both and redacts them before
anything is indexed.

It is worth naming as a pattern rather than an incident: **getting better at
reading documents must not make an application worse at keeping a secret.** The
same fix protects Aadhaar, PAN, passport and card numbers.

## Renewal dates

Insurance, PUC and fitness expiry all reach the reminder engine through
`expiryFields` in the schema, which is why adding a date to an entity is enough
to make it remind. `docs/POLICY_EXPIRY_AND_CARDS.md` records a case where two
dates on one document disagreed: the document is marked as having an unclear
expiry rather than one being chosen.

## No RTO integration

There is none, and there should not be. VAHAN and SARATHI publish no consumer
API for this, and a fabricated one is exactly what the build prompt forbids.
