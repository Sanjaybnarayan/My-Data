# Ten Figures And Where Each Came From

`js/domain/cfo.js`, `js/services/cfo.js`, drawn under Finance → Position.
Tested in `tests/cfo.test.mjs` and in the browser.

Build prompt v6.0, Phase 9: *income, expenses, savings, investments, debt, net
worth, emergency fund, upcoming obligations, financial risks, goals* — and, in
its own words, **"every figure must be explainable."**

## This invents no arithmetic, and that is the point

Every line was already computed somewhere: `domain/finance.js`,
`domain/networth.js`, `domain/runway.js`, `domain/commitments.js`,
`domain/unusual.js`, `domain/goals.js`. Saying so plainly matters, because a
screen called *Family CFO* is exactly the kind of thing that grows a
proprietary score nobody can check. What this adds is assembly and the naming
of sources — which is the whole of what was asked for.

**Financial risks is a list, never a score.** A number between 0 and 100
summarising "risk" would be this file inventing a weighting nobody agreed to,
and it would be the one figure on the page that could not be explained. Each
finding names the module that found it.

## The month in progress is not a month

Measured on a household before any of this was written:

```
July, complete       income ₹1,50,000 · expense ₹66,000 · saved ₹84,000
August, 21 days in   income ₹1,50,000 · expense ₹45,000 · saved ₹1,05,000
```

August looks like the better month by **₹21,000**, entirely because it has not
finished. The salary landed on the 1st and three weeks of groceries have not
been recorded. A page reporting *"saved this month: ₹1,05,000"* on the 21st
tells a household it is doing better than last month on evidence that says
nothing of the kind.

`typicalDailySpend` already refuses to use the month in progress for exactly
this reason — the rule existed in the codebase and a naive assembly would have
broken it. So the period figures are the **last complete month**, named on the
card. The month in progress is shown in its own card, marked unfinished, and
the two are never listed together.

## Twenty-seven months of cover, against eight

The first version sized the emergency fund with `typicalDailySpend × 30`. On
the same household that reported:

```
27.0 months of cover     ← what it printed
 8.2 months of cover     ← against its own recorded outgoings
```

`typicalDailySpend` **deliberately excludes** rent, EMIs, insurance and bills,
because `cashRunway` counts those separately as dated obligations. It measures
discretionary spending; multiplying it by thirty answers *"what do the
groceries cost"*. An emergency fund covers the rent too.

`typicalMonthlyOutgoings` is new, sits beside its neighbour in
`domain/runway.js`, and follows the same rules: complete months only, median
rather than mean so one hospital bill does not become the new normal, and a
reason instead of a number when the history is too short.

The screen prints the denominator — *"8.2 months of cover — liquid accounts
against everything a month costs, bills included"* — because months-of-cover
means nothing without saying against what. That sentence exists because the
first browser check asserted text the interface never rendered, which is how
the omission was found.

## A line with no answer says so

Where a figure cannot be had, the line carries `why` and no value.

```
Income          Not available — nothing is recorded for Jul 2026.
Emergency fund  Not available — months of cover needs a usual month's
                outgoings, and there is only 1 complete month recorded.
Goals           Not available — none are recorded.
```

A zero would be a claim, and the wrong one. *"No debt recorded"* and *"no
debt"* are different states, and only one is a fact about the household's
money.

## Two clocks that were not

The type checker found both, and they were real:

- `upcomingBills(recurring, loans, { clock })` — that function takes a **date**,
  not a clock. `clock` type-checked as an unknown property and was dropped, so
  bills were counted against the real today rather than the one the caller
  asked for. It takes `from: today(clock)` now.
- `unusualSpending(transactions, { month, complete, clock })` — it is told
  which month to judge and needs no clock. Passing one implied it did.

Neither would have failed a test, because both silently fell back to the real
date and every test that mattered used a real-ish one.

## What was checked

Four mutations, all caught: period figures taken from the month in progress,
months-of-cover back on the daily figure, an empty month reported as zero, and
the outgoings median including the unfinished month. Three browser checks, all
verified to fail when the screen is not reachable.
