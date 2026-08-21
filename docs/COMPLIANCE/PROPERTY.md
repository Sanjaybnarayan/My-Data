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
| A receipt is issued only for money that arrived | `TESTED` | `js/domain/rentreceipt.js` |
| A payment is attributed to one letting or none | `TESTED` | `js/domain/rentreceipt.js` |
| A tenant record with its own ledger | `NOT_STARTED` | — |

## The receipt

It is filed like a scan: the template that produced it is named on it, and
Drive's own revision history sits behind its version count. That is provenance,
not authority. The receipt says a landlord issued it; this application does not
vouch that the rent was paid.

## A correction to an earlier version of this document

This file previously said the application *"cannot say which months were
actually paid"*. **That was wrong**, and it was wrong in the direction that
matters: `rentReceived` reads the credits, reports each month as received or
not, and produces **no document** for a month with no matching payment.

The error was found by going to build what this document said was missing and
discovering it already existed. It is corrected here rather than quietly
overwritten, because a compliance document that misdescribes a control is worse
than one that omits it — somebody may act on either, and only one of them looks
authoritative.

## What was actually wrong

Not the existence of rent tracking, but its **attribution**. Measured on two
flats let at the same rent:

```
one credit of ₹35,000 · two flats both let at ₹35,000
  Flat A says received: true · txn t1
  Flat B says received: true · txn t1
```

**One payment, two receipts, both signed by the landlord** — the same rupee
acknowledged twice on documents a tenant and a tax officer may both rely on.
The matcher keyed on amount alone and nothing stopped two lettings claiming
the same credit.

A property may now record which account its rent arrives in. Where that is set,
attribution is unambiguous and the receipt states **what arrived** rather than
what was expected — so a part payment is receipted for the part, and a rent
rise the record has not caught up with is no longer invisible. Where it is not
set, a credit two lettings could claim is attributed to **neither**, and the
month says why, because that one is fixable by recording something.

## The gap that remains

**There is still no tenant record worth the name.** `property.tenantName`,
`property.tenantPhone` and `property.deposit` are three fields on the property
row. There is no tenant entity, no lease history, and no arrears figure — only
a count of months where less arrived than the rent on record.

Closing it means deciding what a tenancy is here — a relationship with its own
ledger, or three fields on a flat. The receipt generator implies the first and
the schema provides the second.

## Registration and stamp duty

Out of scope, and worth saying so. Whether a tenancy agreement needs
registration, and what stamp duty applies, is state law and fact-specific.
`legalDocument` can record that an agreement exists, was registered, and where
the original is kept. It does not advise, and `docs/AGREEMENTS_AND_VEHICLES.md`
records that an agreement's parties are read from the document rather than
inferred.
