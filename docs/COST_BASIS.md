# What a holding actually cost

Phase 7. The roadmap said *"investments exist; brokers architecture-only"*. The
investments module does exist and its hardest arithmetic — XIRR — is correct.
The figure everything else rests on was not.

## What was measured

`holding.invested`, `holding.units` and `holding.averageCost` are typed on the
holding form. `investmentTransaction` records every buy and sell with units, a
price per unit, an amount and the charges. **Nothing re-read them.**

A fund bought once and then fed a ₹5,000 monthly SIP for eleven months, with
all twelve purchases recorded:

```
  invested, as the app reported it : ₹50,000.00
  invested, per the transactions   : ₹1,05,000.00
  ...plus charges actually paid    :       ₹132.00
  the truth                        : ₹1,05,132.00
  understated by                   :   ₹55,132.00

  units, as the holding said       : 100
  units, per the transactions      : 200.579

  gain, as the app reported it     : ₹81,000.00  (162%)
  gain, against what really went in: ₹25,868.00  (24.61%)
```

**162% against 24.61%** — and the same screen showed an **XIRR of 34%**, worked
out from those very transactions. Two numbers about one holding, side by side,
disagreeing because only one of them was reading the records.

This is the fourth instance of the shape the roadmap names: *a figure with a
date attached that nothing ever re-reads.* `loan.outstanding` never falls,
`holding.currentValue` never rises, `holding.invested` never grows.

## Average cost, and what that is not

A sale removes cost at the **average** paid so far — the only method the
recorded fields support, and how a unitised holding is normally understood.

It is **not a tax computation.** Indian capital gains are FIFO, with
grandfathering, indexation and holding-period rules this knows nothing about. A
realised figure here must never be copied onto a return. It answers *"what did
this cost me and what came back"*, and the module says so at the top.

| Kind | Effect |
| --- | --- |
| `buy`, `contribution` | units up, cost up by amount **+ charges** |
| `sell`, `withdrawal` | units down, cost down at the running average; the excess is realised |
| `dividend`, `interest` | income, **cost untouched** |
| `bonus`, `split` | units up, cost untouched, so the average falls out of the arithmetic |
| `charge` | cost up, nothing acquired |

**A dividend is a return, not a disposal.** Reducing the cost basis every time a
stock pays out would eventually report it as having cost nothing.

**Bonus units cost nothing** even when the record carries a notional amount — as
they often do. The test for that first passed with `amount: null`, making the
rule vacuous; mutation testing caught it.

**`pricePerUnit` was recorded on every buy and read by nothing.** Where the
amount is missing it is the only thing that can say what was paid, so it is now
the fallback.

## It offers; it does not overwrite

The stored figure stays exactly where it is, and where the two disagree the
difference is **named on screen**:

> This is what the recorded buys and sells add up to, including charges. The
> holding forms say ₹8,00,000.00, which is ₹15,036.00 less.

The dangerous direction is the other one. A transaction history that begins
halfway through a holding's life derives a figure that is **too low**, and
silently replacing a right number with a wrong one is worse than the gap this
exists to close. That case gets its own sentence — *"usually because the
earliest purchases were never recorded as transactions"* — and the screen also
says how many holdings the correction never reached at all:

> 1 of 4 holdings have no transactions recorded, so their figures are still the
> ones typed on the form.

## A design error the existing tests caught

The first version passed the accrual estimate into the row's **value** as well
as correcting the invested side. The browser check *"and the recorded value is
left exactly as it was"* failed, and it was right to: substituting an estimate
for the household's own recorded figure is exactly what the accrual card beside
that row exists to avoid.

The estimate is right for the **rate** — a stale closing value makes XIRR
meaningless rather than slightly wrong — and it is marked *"est."* where it is
used. Only the invested side is corrected here.

A sign error in the new sentence was caught the same way: it printed *"which is
-₹15,036.00 less"* until the browser check read it back.

## Verification

- 1134/1134 unit tests, 25 in `tests/costbasis.test.mjs`.
- **14 mutations, all caught**, including *charges left out of the cost*, *a sale
  removing cost at the sale price*, *a dividend reducing the basis*, *bonus units
  charged for*, *transactions not sorted*, *a short history trusted without a
  word*, and *realised money left out of the gain*.
- 220/220 browser checks. Four of them fail when the service is reverted to
  `holdingGain`.

## Recorded, not done

- **FIFO, for tax.** Needs a lot recorder and the grandfathering rules; this
  refuses the question rather than answering it approximately.
- **`holding.averageCost`** is still whatever was typed. `basis.units` and
  `basis.invested` imply one, but nothing writes it back — by design.
- **Brokers.** Still architecture-only. Nothing here connects to one.
