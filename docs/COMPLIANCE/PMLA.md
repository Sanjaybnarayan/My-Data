# Prevention of Money Laundering Act and Rules

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Not to this application.** The record-keeping, verification and reporting
obligations fall on *reporting entities* — banks, financial institutions,
intermediaries, and the designated non-financial businesses the Rules name. A
household keeping its own statements is not one and has nothing to file with
the Financial Intelligence Unit.

| Requirement | Status | Why |
| --- | --- | --- |
| Suspicious transaction reporting | `NOT_APPLICABLE` | No reporting entity, nothing to report |
| Customer risk categorisation | `NOT_APPLICABLE` | No customers |

## The thing worth saying anyway

This application detects unusual spending. `js/domain/unusual.js` compares a
month against a household's own history, with seasonality so December is not an
anomaly every year.

**That is not a risk score and must never be presented as one.** It exists to
tell a household that its own electricity bill tripled. It does not categorise
people, does not persist a judgement about anybody, and produces a finding that
names the category and the two figures behind it.

The distinction matters because the two things look alike from a distance, and
an application that drifted from one to the other would be doing something
nobody asked it to do. `docs/UNUSUAL_SPENDING.md` records the design; the
finding is always about a *category in a month*, never about a person.
