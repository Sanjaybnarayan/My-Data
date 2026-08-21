# Income Tax and GST, As They Touch Record Keeping

**Not a compliance claim.** An applicability review by a programmer. Legal
review required. See [MASTER_COMPLIANCE_MATRIX.md](MASTER_COMPLIANCE_MATRIX.md).

## Does it apply?

**Conditionally.** Nothing here files a return or computes a liability. But
records kept here may end up *supporting* one — a rent receipt, an interest
certificate, a capital-gains statement — and that makes their accuracy,
provenance and retention a real concern rather than a filing obligation.

| Requirement | Status | Evidence |
| --- | --- | --- |
| The original document is never overwritten | `TESTED` | `js/services/documents.js` |
| Indian financial year, not calendar | `TESTED` | `js/core/dates.js` |
| No tax liability computed or implied | `IMPLEMENTED` | `docs/STATUS.md` |
| Retention long enough for assessment | `DESIGNED` | `js/data/retention.js` |

## The financial year

`startOfFinancialYear` and `endOfFinancialYear` in `js/core/dates.js` run April
to March. This is the sort of thing that is either right everywhere or wrong
somewhere expensive, so it is a shared helper rather than arithmetic repeated
per screen.

## Provenance, and why it belongs in a tax document

A figure that might support a return needs to say where it came from. This
application keeps the source file unmodified, records what was extracted from
it, and can show the two together — `docs/DATA_PROVENANCE.md` and
`docs/EXPLAINABILITY.md` cover the mechanism.

The rule underneath it is the build prompt's 57th: **every financial event must
be explainable.** For tax that stops being a design principle and becomes the
difference between a record and an assertion.

## The gap

**No retention default is set from tax law.** `js/data/retention.js` supports
per-entity periods and the household can configure them, but nothing says "keep
this for as long as an assessment could be reopened". That is a real gap, and
closing it needs a number a programmer should not pick.

## Generated documents

A rent receipt produced here records the template that produced it and the
records it drew on. It is a document the household created, not evidence this
application vouches for. `docs/GENERATED_DOCUMENTS.md` records that distinction;
[PROPERTY.md](PROPERTY.md) covers the receipt specifically.
