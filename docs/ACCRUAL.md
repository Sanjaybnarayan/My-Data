# A Deposit That Never Grew

Phase 6, tranches one and two. `js/domain/accrual.js`, tested in
`tests/accrual.test.mjs`, `tests/services.test.mjs` and in the browser suite,
surfaced on Investments.

> **Tranche two corrects tranche one.** The first version refused every
> recurring deposit because "its value needs the payment schedule, which is not
> recorded here". That was false, and the correction is at the bottom of this
> file under *The refusal that was wrong*.

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
| **Recurring deposit — as a lump sum** | each instalment has to be accrued from its own date; the lump-sum formula roughly **doubles** the interest. It is valued properly by `recurringValue`, below |
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

---

# The Refusal That Was Wrong

Phase 6, second tranche.

## What the first tranche said, and why it was false

> *"a recurring deposit grows by instalments, not as a lump sum — its value
> needs the payment schedule, **which is not recorded here**"*

The second half is untrue. An RD's instalments are ordinary
`investmentTransaction` records — `holding`, `date`, `amount` — and
`domain/portfolio.js` has been reading them to build cash flows since long
before any of this. The schedule was recorded. Nothing had looked.

Measured before writing anything, on ₹5,000 a month for two years at 6.8% with
all 24 instalments recorded:

```
instalments recorded  : 24, dated, linked to the holding

value the app reports : ₹1,20,000
value that is true    : ₹1,28,724
gain the app reports  : ₹0
gain that is true     : ₹8,724

XIRR the app reports  : 0%
the rate on the deposit: 6.8%
```

**Worse than the fixed-deposit case in one respect.** The FD reported a gain of
zero, which is an omission. The RD reports **0% XIRR on a deposit paying 6.8%**,
which is an assertion — a rate, stated, and wrong.

## What it does now

Every instalment accrues from **its own date**, quarterly, to today or to
maturity. That is the whole difference from a lump sum: on a two-year RD the
first instalment has been earning for two years and the last for a month.

The anchor is a single-instalment case, because one instalment reduces to
ordinary compound interest and is hand-computable: ₹10,000 at 6.8% compounded
quarterly for two years is 10000 × 1.017⁸ ≈ **₹11,444**. If the per-instalment
arithmetic were wrong it would be wrong there too.

The error the old refusal was avoiding is real and is now measured rather than
assumed. Treating the ₹1,20,000 total as though it went in on day one gives
₹17,324 of interest against a true ₹8,724 — **roughly double**. A test asserts
the lump-sum route stays refused for exactly that reason.

## What is still refused, and now for true reasons

| Refused | Why |
| --- | --- |
| **No instalments recorded** | an RD *is* its instalments. Not "this cannot be done" but "there is nothing here to do it with" — and the sentence says *add them and this can be valued* |
| **Interest already recorded as a transaction** | the household is already counting it; estimating it again would report it twice. The credit-card double count wearing a different hat |
| **A withdrawal or a charge against the holding** | the deposit was broken into or penalised, so its terms are not the ones it started with |
| **No rate, or not an RD at all** | nothing to accrue with |

An instalment dated after the end of the run counts as **paid but not earning**.
The money went in; quietly dropping it would make the total disagree with the
household's own list.

## What mutation testing found

Fifteen mutations. Fourteen caught, one survived — and it was the same shape of
blindness as the survivor in tranche one.

| Mutation | Caught by |
| --- | --- |
| **The whole total accrues from the first instalment** (the lump-sum error) | *earns nothing like the same total as a lump sum* |
| **It compounds once a year, not quarterly** | the hand-computed single-instalment anchor |
| **A future instalment accrues backwards** | *counts as paid but has earned nothing* |
| **A broken deposit is modelled as untouched** | *a withdrawal or a charge* |
| **Interest already recorded is estimated again** | *would double it* |
| **Another holding's instalments count** | *only money going in counts* |
| **The sentence dates it from the holding, not the first instalment** | **survived** — now caught |

The survivor is worth naming twice, because it is a repeat: the fixture had
`RD.valuedOn` and the first instalment's date set to the same day, so a mutation
swapping one for the other changed nothing. Tranche one's survivor was
`currentValue` and `invested` set equal. **Two fields that happen to agree in a
fixture hide every bug that confuses them.** The fixture now sets them
deliberately apart, and the browser check asserts the screen names the
instalment date and *not* the holding's.

## The seam a domain test cannot see

`accrualReport` is correct whether or not anybody passes it transactions — an RD
with none comes back `unchecked`, which is quiet, plausible, and exactly what
the screen showed before. So the service dropping `{ transactions }` would look
like nothing at all.

`tests/services.test.mjs` builds an RD with twelve instalments through the real
repository and asserts `unchecked` is empty. Removing the argument fails there
and nowhere else.

## Not done

- **Net worth still reads the stored figure**, exactly as with the loan and FD
  estimates, and for the same reason: quietly substituting a model would make
  net worth disagree with the holding record for reasons nobody could see.
- **XIRR still reports 0%** on a stale deposit. It is computed from
  `holdingValue`, which is the stored figure, and substituting the estimate
  would make the portfolio's headline rate a model output without saying so.
  The card carries the correction instead, and the fix is the one it already
  asks for: update the value from the bank. Worth revisiting — a rate stated
  wrongly is louder than a gain omitted.
- **TDS is not modelled.** The estimate is gross interest, and says so.
- **A monthly instalment is assumed to be all there is.** An RD whose
  instalments were never imported still cannot be valued, and this reports that
  rather than guessing a schedule from the holding's own dates.
