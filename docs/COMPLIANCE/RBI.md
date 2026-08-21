# RBI Directions and the Account Aggregator Framework

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application.** RBI's directions on customer data, outsourcing and
digital lending bind regulated entities. The Account Aggregator framework binds
licensed NBFC-AAs, Financial Information Providers and Financial Information
Users. This application is none of them and holds no licence.

## How the financial data gets here, exactly

Two ways, and neither is an integration:

**Statements the household already has.** A PDF or CSV downloaded from the
bank's own portal, opened on the device, parsed locally. `docs/STATEMENT_FORMATS.md`
covers the readers.

**Receipts the household was emailed.** Read through a Gmail connection the
household authorises, scoped to `gmail.readonly`.

| Requirement | Status | Evidence |
| --- | --- | --- |
| No Account Aggregator connector | `TESTED` | architecture probe |
| No bank credential stored or used | `TESTED` | architecture probe |
| Card numbers masked, never stored in the clear | `TESTED` | `js/domain/identifiers.js` |

The second row is a design decision recorded in `docs/STATUS.md` and worth
repeating here: **an application whose premise is that it holds less than you
expect cannot also hold the login to every account a household owns.** Screen
scraping a bank was rejected on those grounds, not on technical ones.

## Where a real obligation could still arise

Nothing here lends, advises on credit, or moves money. If it ever did any of
those — even by generating a payment instruction — the analysis changes.

The one live edge is **reconciliation**: this application computes balances and
compares them to what the bank printed. `docs/BALANCES.md` records that it
refuses to reconcile rather than guess, and `docs/THREE_SOURCES.md` that a
disagreement between a statement, an email receipt and an SMS is reported as a
conflict. A figure this application computed is not a bank record, and nothing
should present it as one.
