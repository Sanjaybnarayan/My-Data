# A Fixed Deposit That Never Grew

Phase 6, first tranche. `js/domain/accrual.js`, tested in `tests/accrual.test.mjs`
and in the browser suite, surfaced on Investments.

## The bug

`holding.currentValue` is a number somebody typed once. Nothing updates it. The
portfolio reads it as the value and computes gain against `invested`, so a fixed
deposit left alone reports this:

```
value the app reports  : ₹5,00,000
value two years later  : ₹5,75,571
gain the app reports   : ₹0
valuedOn was           : 2024-08-01 (never revisited)
```

Measured before anything was built, on a ₹5,00,000 deposit at 7.1%. The
application already records `valuedOn`, so it knows exactly when the figure was
last true. It simply never looked.

## The loan bug in a mirror

This is the same defect as `loan.outstanding`, pointing the other way:

| | Loan | Deposit |
| --- | --- | --- |
| The stored number | never falls | never rises |
| What it does to net worth | holds a liability up | holds an asset down |
| Net worth is therefore | **understated** | **understated** |

Two independent screens, two independent entities, one shape of mistake: a
figure with a date on it that nothing ever re-reads. Worth naming, because the
next one will look like this too.

## What this is

Compound interest, which is exact arithmetic, applied from `valuedOn` to today
at the rate the household recorded. Anchored to a figure worked out
independently rather than to the implementation:

> ₹5,00,000 at 7.1% compounded quarterly for two years is
> 500000 × (1 + 0.071/4)^8 ≈ **₹5,75,571**.

The test asserts within ₹100 of that. The residue is a day count, not an error:
the worked figure takes exactly eight quarters while the code measures elapsed
time in years of 365.25 days, which makes two calendar years 1.9986 of them.
₹100 is far tighter than the gap to any of the ways this could be got wrong —
compounding annually lands ₹2,208 away and simple interest ₹4,620 away.

## What this is not

**The bank's own figure**, and the difference is not small:

- TDS comes off interest at source above a threshold.
- A deposit that matures may auto-renew at a rate nobody here knows.
- A premature withdrawal is penalised.
- Rates on new deposits change.

So **nothing is written back**. The estimate sits beside the stored figure, the
recorded value is left exactly as it was, and every sentence ends with *"The
bank's figure is the one that counts."* A household arguing with their bank
using a number this application made up would be worse off than one with a stale
figure they know is stale. A browser check asserts both halves — that the
sentence says it, and that the stored figure is untouched.

## Where it refuses

Guessing would be worse than silence, so the refusals are the design.

| Refused | Why |
| --- | --- |
| **Recurring deposit** | grows by instalments, not as a lump sum — the lump-sum formula would overstate it substantially, because most instalments have not been in for the full term |
| **Stock, fund, ETF, gold, silver, crypto, NPS** | value is a price, not an accrual, and a rate field on one of those means something else |
| **Bond** | pays coupons and its price moves; neither is compound accrual |
| **A kind absent from the table** | a kind nobody has thought about is a kind nobody has checked |
| **No `valuedOn`** | nothing to accrue *from*; assuming the start date would silently claim the figure was never updated |
| **No rate, or no amount** | nothing to accrue with |

Interest also **stops at maturity**. What happened after — a withdrawal, or a
renewal at a rate nobody recorded — is not knowable from here, so the estimate
stops there and says so rather than projecting through a date the household
needs to look at anyway.

## Two things the report deliberately leaves out

**A share is not a deposit that could not be valued.** `unchecked` lists only
deposit-like kinds. A fixed deposit missing its rate is worth naming because
somebody could fix it; a stock is not, because it never could have been accrued.
Noise trains people to stop reading the list.

**A drift under ₹100 is not mentioned.** Rounding, a value date and a credit
landing a day late all move a figure by more than a household can act on.

## What it accrues *from*

`currentValue` where there is one, falling back to `invested`. The two differ
the moment anybody updates the figure from a statement, and `valuedOn` dates the
recorded value — accruing from `invested` instead would count every year already
reflected in that figure twice. This was the one mutation that survived the first
pass, because every fixture had the two equal. Two tests now pin it.

## What mutation testing found

Fourteen mutations. Thirteen caught on the first pass; the fourteenth is the one
above, and is caught now.

| Mutation | Caught by |
| --- | --- |
| **Interest runs past maturity** | *interest stops at maturity* |
| **Everything compounds quarterly** | *a PPF compounds yearly, not quarterly* |
| **Unknown kinds accrue at the FD convention** | *a kind nobody has thought about* |
| **A value dated in the future accrues backwards** | *a value dated today has not accrued anything yet* |
| **A share is listed among the deposits that could not be valued** | the test of that name |
| **The compounding assumption is not stated** | *says how often it assumed the interest compounds* |
| **Accrue from what was invested, not what it is worth** | **survived** — now caught |

The screen wiring was mutated too: removing the card from the grid fails three
browser checks. Arithmetic being right in a unit test says nothing about whether
a household ever sees it.

## A gap found on the way out

Adding a module means adding it to the service worker's `SHELL` list, and
nothing checked that. The deploy workflow checks the opposite direction — that
nothing precached was left unpublished — so a module missing from the list is
fetched from the network and the app works everywhere except offline, on
whichever screen imports it. Nobody finds that on a laptop with wifi.

The check now runs in `tests/modules.test.mjs`, and it found
**`js/domain/privacy.js` already absent**: Settings has been broken offline
since it was added. Both entries are in the list now.

## Not done

- **Net worth still reads the stored figure**, exactly as with the loan
  estimate, and for the same reason: quietly substituting a model would make net
  worth disagree with the holding record for reasons nobody could see.
- **A recurring deposit is still not valued.** Doing it properly needs the
  instalment schedule, which this application does not record. Listing it as
  unchecked, with the reason, is the honest position until it does.
- **TDS is not modelled.** The estimate is gross interest, and says so.
