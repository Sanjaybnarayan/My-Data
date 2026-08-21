# Property and Tenancy, As They Touch Records

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally.** Owning property is not regulated activity. Letting it
involves obligations under state tenancy law that vary by state and that this
document does not attempt to survey.

The reason this file exists is narrower: **this application generates rent
receipts**, and a document it produces is a document somebody may act on. A
tenant may keep it. An employer may accept it for HRA. An assessing officer may
read it.

| Requirement | Status | Evidence |
| --- | --- | --- |
| A generated receipt records what produced it | `TESTED` | `js/domain/rentreceipt.js` |
| No generated document claims legal effect | `IMPLEMENTED` | `docs/GENERATED_DOCUMENTS.md` |
| Tenant records | `NOT_STARTED` | — |

## The receipt

It is filed like a scan: the template that produced it is named on it, and
Drive's own revision history sits behind its version count. That is provenance,
not authority. The receipt says a landlord issued it; this application does not
vouch that the rent was paid.

## The gap, stated plainly

**There is no tenant record worth the name.** `property.tenantName`,
`property.tenantPhone` and `property.deposit` are three fields on the property
row. There is no tenant entity, no rent ledger, no record of what was due
against what arrived, and no arrears.

`docs/PHASE_AUDIT_0_13.md` lists this among the placeholders that read as built
features, and it is the one with a compliance edge: an application that
generates rent receipts but cannot say which months were actually paid is
producing documents it has no records behind.

Closing it means deciding what a tenancy is here — a relationship with its own
ledger, or two fields on a flat. The receipt generator implies the first and the
schema provides the second.

## Registration and stamp duty

Out of scope, and worth saying so. Whether a tenancy agreement needs
registration, and what stamp duty applies, is state law and fact-specific.
`legalDocument` can record that an agreement exists, was registered, and where
the original is kept. It does not advise, and `docs/AGREEMENTS_AND_VEHICLES.md`
records that an agreement's parties are read from the document rather than
inferred.
