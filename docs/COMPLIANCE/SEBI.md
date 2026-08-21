# SEBI Regulations on Investment Records and Advice

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally**, and the condition is the interesting part.

Keeping a record of your own investments is not regulated activity. **Giving
investment advice is.** The Investment Advisers Regulations bind a person who
advises others for consideration, and the Research Analysts Regulations bind
whoever publishes a recommendation.

An application that computes XIRR, allocation and gain is one design decision
away from appearing to advise. "Your equity allocation is high" is a
description; "you should rebalance" is not, and a screen can slide from one to
the other without anybody noticing.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Nothing recommends buying, selling or holding | `TESTED` | `js/domain/portfolio.js` |
| No broker connector, real or simulated | `TESTED` | `docs/MCP.md` |
| Every computed return shows its inputs | `TESTED` | `js/domain/costbasis.js` |

## Brokers

**Architecture only, correctly.** No consumer API exists for the brokers a
household actually uses, and inventing one is forbidden. "Zerodha" appears in
this repository twice, both times as a name the SMS reader and the categoriser
recognise — not as an integration. `docs/MCP.md` records what was measured and
what was refused.

## Where the line is drawn in the code

Every figure the investments screen shows is a *description of records the
household entered*, and `docs/COST_BASIS.md` records how each is derived. XIRR
shows its cash flows. Allocation shows the holdings behind each slice. A gain
shows what it was bought for.

Nothing ranks a holding, suggests an action, or projects a return. The absence
is deliberate and worth a test, which is why `js/domain/portfolio.js` carries an
architecture claim rather than only a comment.
