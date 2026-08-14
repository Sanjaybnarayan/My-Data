# Paying a Credit Card Is Not Spending

Phase 5, second tranche. `js/domain/settlement.js`, tested in
`tests/settlement.test.mjs` and in the browser suite, surfaced on Finance.

## A live bug, not a missing feature

The roadmap listed prompt test 4 — *bank → credit card = settlement* — as
**partial: categorised, not evented**. It is worse than that. `credit-card` is
categorised with kind `spending`, so a card bill is counted as money leaving the
household **on top of** every purchase on that card's own statement:

```
groceries on the card       ₹3,000   spending
a café on the card          ₹2,000   spending
the card bill from the bank ₹5,000   spending
─────────────────────────────────────────────
reported spending          ₹10,000
actually spent              ₹5,000
```

Exactly double. Verified in both paths that produce a spending figure —
`summarise` (statement review) and `fin.totals` (the *Spent* metric on Finance).

The household this hits is the one the importer was built for: *"once a month,
download every statement for every account and drop the whole pile in."*

## Why it is not a one-line fix

The obvious repair is to give `credit-card` kind `internal`. That is right for
the household above and **wrong** for a different one:

> A household that imports **only** their bank statement has no record of what
> the card was used for. The bill is the only evidence that ₹5,000 was spent.
> Calling it internal reports their spending as zero.

So the answer depends on **what has been imported** — a fact about the
household's whole set of records, not about a row. A category is a property of a
row, which is why this could never live in one.

## What it does instead

For each card bill, ask whether that card has purchases of its own recorded:

| | |
| --- | --- |
| Card statement imported | the bill is a **double count** — offer the figure without it |
| Card statement absent | the bill is the **only record** — it must stay counted |

Where a bill names its destination account the question is answered exactly.
Where it does not — an imported bill names a payee, not an account — it falls
back to *is any card statement here at all*, which is coarser and coarse in the
safe direction: with no card statement anywhere, the bill is certainly the only
record.

**Nothing is rewritten or recategorised.** The screen shows both figures and
says which is which. A total that silently shrank because a second file was
imported would be worse than the double count, because nobody would know why.
For the uncovered household it says what would fix it: import the card
statement.

## What must not be counted as card spending

Three things arrive on a card statement that are not purchases, and each would
break the test above in a different direction:

- **A refund** onto the card reduces the debt. Counting it as spending would
  make the card look used when it was repaid.
- **The payment itself** appears on the card's own statement as a credit.
  Reading it as a purchase would make every card look used exactly as much as
  it was paid off — so every bill would always look double-counted.
- **A deleted row** counts for nothing, like everywhere else.

## What mutation testing found

Six mutations, all six caught. The one worth naming:

| Mutation | Caught by |
| --- | --- |
| **Every bill treated as a double count** | *with no card statement imported, the bill is the only record* |

That is the mutation that would report the second household's spending as zero
— the exact failure the design exists to avoid.

## Two things caught by tooling rather than by me

**The type ratchet caught this tranche's own code**, at 205 against a budget of
203. `money = String` made the checker infer `StringConstructor` for the
formatter parameter. Fixed at the cause rather than by raising the budget, which
is what the ratchet is for — including on its author.

**The first draft formatted by string surgery.** It rendered the sentence and
then replaced number substrings with formatted ones, which picks the wrong
occurrence the moment two of the figures are equal — and in the worked example
they are: ₹5,000 corrected, ₹5,000 remaining. A formatter is now passed in, with
a test that fails on the old approach.

## Covered end to end

Unlike the transfer pairing, this one is reachable through the form — a card
account and two ordinary expenses, no hidden fields — so the browser suite
drives it and reads the sentence back off the Finance screen.

Getting there took three failures, each of which was the application being right
and the test being wrong:

| Failure | What it actually was |
| --- | --- |
| The account modal never closed | *"A credit card needs a limit for utilisation to mean anything."* A cross-field rule, so the form simply stays open with no obvious cause. |
| The transaction modal never closed | `date` is required and the form does not default it. |
| Four **existing** checks broke | The ledger checks index `.ledger-row` by position, so records created earlier shift them. This block now runs after them, with a note saying why. |

The first two were found by printing the validation errors instead of guessing a
third time.

## Not done

- **EMIs and loan repayments have the same shape and are not addressed.** An EMI
  is part interest — genuinely an expense — and part principal, which repays a
  liability and is not consumption. Both are counted whole as `spending` today.
  Splitting them needs the loan's schedule, which is a larger piece of work than
  this one and is not started.
- **No `EconomicEvent` entity.** This tranche derives its answer rather than
  storing one, so no migration was needed. An entity is still wanted for events
  with more than two legs and for kinds beyond transfer and settlement.
- **Per-period coverage is not checked.** A card whose statement was imported
  for June but not July is treated as covered for both. Narrowing that needs the
  statement period, which `bankStatement` records — a real next step.
