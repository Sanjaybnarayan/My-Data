# How long the money lasts

`js/domain/runway.js`, tested in `tests/runway.test.mjs`. Layer 3's
*forecasting*, which the architecture document probed as missing.

## The question nothing answered

Every input already existed. `liquidCash` says what is in the account,
`upcomingBills` says what is dated and due, and the history says what a month
usually costs. Nothing combined them, so the one question a household actually
asks between pay days — **will this last?** — had no answer anywhere.

Measured on one household with ₹1,40,500 in the account:

```
cash                       ₹1,40,500
bills dated in 30 days      ₹53,500
naive answer                ₹87,000 "left"
```

That naive answer is the reason this file is careful. Their own history says a
usual day costs ₹3,383 — groceries, fuel, a meal — and once that is counted the
account goes short on **9 September**, three weeks before the naive figure runs
out. A bills-only forecast is not merely imprecise; it is comfortable, and wrong
in the direction that costs money.

## Why this is the most dangerous file in `domain/`

Everything else here describes what happened. This describes what has **not
happened yet**, and its failure mode is not a wrong number but a reassuring one.

**It never predicts income.** Salary is not a record — it is a pattern in the
transactions — and a forecast assuming the next one arrives says *you are fine*
on the strength of something nobody promised. The next expected credit is
reported **beside** the figure and never added to it. A household with ₹5,000
and a ₹50,000 bill is short, whatever their salary usually does.

**It counts ordinary spending, not just bills.** The trap above, closed. The
daily rate is the median of complete months, excluding the categories already
counted as dated bills — counting rent twice would make the whole thing useless.

**It never says the household is fine.** A shortfall is a fact: on a given day,
known outgoings exceed known cash. Sufficiency is not, because unrecorded
spending happens daily. The absence of a shortfall reads *"nothing recorded here
runs the account out"* — a statement about the calculation, not about the month.

**It refuses without history.** Under two complete months there is no basis for
a daily rate; it says so and forecasts on dated bills alone, labelled.

**A month in progress is not divided by a whole month of days**, and **an
overdue bill counts from today** rather than being dropped — that money has not
left yet, and dropping it would make this cheerier than the household's own
bank.

## Mutation testing

**10 of 10 caught**, including *expected income added to the forecast*,
*ordinary spending ignored*, *bills counted twice*, and *the sentence promising
the household is fine*.

Three survived the first pass and **all three were my tests, not the code** —
the same lesson as the previous tranche, arriving again:

- the partial-month test used three *equal* months, and a fourth value cannot
  move a median of equal numbers, so it could not tell the guard from its
  absence;
- the transfer test used category `self-transfer`, which the skip list already
  excludes, so it exercised the category guard and left the `kind` guard
  untouched;
- the missing-amount test asserted the balance stayed finite. It does — but with
  `NaN` in the running balance every comparison is false, so `lowest` silently
  freezes on the day before the bill and the forecast stops half way while
  *looking* fine. The assertion is now on the date of the lowest point.

That third one is the shape worth remembering: **an assertion can be true and
still not be the assertion that catches the bug.**

## What this found in the tool built last tranche

The architecture document carried:

```
| Forecasting | missing | `absent:grep:forecast|projection` |
```

**It had never parsed.** A pipe inside a markdown table cell splits the cell, so
`probesIn` found no probe there at all — the row was silently not a claim and
could never fail. It was added one tranche earlier, in the commit that
introduced alternatives, and the count stayed at 48 because the row was never
counted.

Two fixes: alternatives now use **commas**, which markdown leaves alone; and a
cell that *looks* like a probe and does not parse is now **reported as
malformed** rather than skipped. A silent non-claim is the one failure this tool
exists to prevent, and it had one of its own.

A smaller lesson from the same row: `projection` was too generic a term — the
schema uses the word for field projections — so that probe would have failed
falsely even before forecasting existed.

## Verification

- `npm test` **1506**, browser **248**, typecheck **181/181**
- architecture **49 claims** (48 before: the malformed row now parses and counts)
- field-coverage 83, policy, lint, UI→database 61/61 — clean

## On the screen, in the same tranche

*"The domain function exists and no screen calls it"* is the finding this
repository keeps making — the receipt-match panel went a whole tranche that way,
and the unusual-spending wiring failed silently three times. So this one was
wired in the same tranche that built it, assembled in `services/finance.js`
rather than in the screen, and driven by five browser checks.

The rendering carries the refusals rather than only the figure:

- a shortfall reads as a **negative** figure; the absence of one stays `faint`
  rather than becoming a green tick, because it is not reassurance;
- the **assumptions are printed beside the number**, not hidden in a tooltip. A
  forecast whose assumptions are hidden is a forecast presenting itself as an
  answer.

**The wiring was mutated too.** Handing the screen an empty forecast fails the
browser suite (252/253) — so the panel is genuinely exercised rather than merely
present, which is the distinction that took a whole tranche to learn.

## Accounts are not one pot

Recorded here as a limitation, then measured — and it was the comfortable-wrong
answer this file exists to avoid, sitting in this file.

A household who sweep their salary to savings:

```
Salary a/c    ₹3,000     <- the rent leaves here
Savings       ₹3,45,000
pooled cash   ₹3,48,000  -> forecast: no shortfall
```

The rent bounces on the 20th. The forecast said nothing, because ₹3,48,000
covers ₹35,000 — and no single account did.

So where a bill records which account it leaves from, that account is now
checked on its own, and the sentence leads with it:

> Rent leaves Salary a/c on 2026-08-20, and that account is ₹32,000 short of it
> — money in your other accounts will not move itself.

It is said **first**, before the pooled figure, because a failed payment costs a
fee and a phone call and *"you have the money elsewhere"* does not stop it
happening. Money elsewhere is not a defence; it is the reason the household can
fix it, which is exactly why they need telling.

**Bills that name no account are left to the pooled figure.** Most do not record
one, and inventing an account for them would be a guess producing a confident
wrong warning.

**6 of 6 mutations caught.** Two survived the first pass:

- nothing exercised the seam where `upcomingBills` reads
  `recurringPayment.account` — my tests built bill objects by hand, and the
  whole check rests on that field arriving;
- and testing a hole in the bill list found that the **pooled loop crashed on a
  null**, which predates this change. The per-account loop tolerated one through
  `bill?.account` — an optional chain doing more work than its name suggested —
  and writing the test for that found the older loop did not.

## Still not done
- **One currency.** Every amount is assumed to be INR minor units, as
  everywhere else in this repository.
- **No seasonality**, so a December of gifts reads as an ordinary month until it
  arrives.
