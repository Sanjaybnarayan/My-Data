# What a Loan Actually Owes

Phase 5, third tranche. `js/domain/amortise.js`, tested in
`tests/amortise.test.mjs` and in the browser suite, surfaced on Finance.

## The bug

`loan.outstanding` is a number somebody typed once. Nothing updates it. Net
worth reads it as the liability, so paying an EMI does this:

| | |
| --- | --- |
| The bank balance falls by the whole EMI | net worth **down** |
| The loan's outstanding does not move | net worth **unchanged** |

**Net worth falls by the full EMI every month**, when most of that money did not
leave the household at all — it converted cash into a smaller debt. And after
five years of paying, the application still shows the debt as it was on the day
it was entered.

Measured before building anything: three ₹20,000 EMIs took ₹60,000 off net
worth.

This is the same shape as the credit-card double count, and it was found the
same way — by checking whether the roadmap's *"partial"* was accurate. It was
not. The EMI split I expected to find (interest is a cost, principal is not) is
real but smaller than this: the stored balance never moving is the headline.

## What this is

A **model**. Given a starting balance, a rate and an EMI, ordinary amortisation
says how much of each payment was interest and how much repaid the debt. That
arithmetic is exact, and it is anchored to a textbook case rather than to
itself:

> ₹50,00,000 at 8.5% over 20 years, EMI ₹43,391.
> Month one: **₹35,417 interest, ₹7,974 principal.**

Any amortisation table will say the same. A test that only agreed with this
implementation would prove nothing about whether the implementation is right.

## What this is not

**The lender's ledger.** The difference matters:

- Floating rates move. A home loan repriced twice in three years has a curve
  this cannot know about.
- Prepayments, part-payments and moratoria change the balance without changing
  the EMI.
- Lenders round, charge fees, and apply payments on their own value dates.

So **nothing is written back**. The estimate sits next to the stored figure and
every sentence ends by saying whose number counts: *"The lender's statement is
the figure that counts; this is only a check that yours has not gone stale."*

A household arguing with their bank using a number this application made up
would be worse off than one with a stale figure they know is stale.

## Three refusals

**Negative amortisation is reported, not modelled.** If the EMI does not cover
the interest — real, when a floating rate rises without the EMI being revised —
the balance grows. The projection stops and says what to check, rather than
producing a confident number on the wrong side of the truth.

**Nothing is said without payments.** A household that has not imported a
statement should not be told their loan figure is wrong.

**Nothing is said without terms.** No rate, no EMI, no start date — no estimate.

## A tolerance, so it does not quibble

Rounding, value dates and a part-payment all move a balance by amounts nobody
can act on. Below ₹100 the report stays silent.

Relatedly: after all 240 payments the model leaves **₹102** outstanding, because
the EMI is the rounded figure a bank quotes rather than the exact one the
formula wants. `cleared` stays strict about that — a rupee outstanding is a
rupee outstanding — and the tolerance is what stops it being noise.

## A prepayment is not an error

When the stored figure is *lower* than the model, that is usually a prepayment.
It is reported the other way round and named as such, rather than as a mistake.

## What mutation testing found

Seven mutations, all seven caught. The one worth naming:

| Mutation | Caught by |
| --- | --- |
| **Interest charged on the balance *after* the payment** | *month one matches the table* |

That is the single most plausible way to get amortisation subtly wrong, and it
understates the interest in every row of every year.

## Two arithmetic errors of my own

Both in the tests, both caught by them failing:

- A paise-to-lakh divisor — ₹49 lakh asserted as `4,900`. Everything here is in
  paise, so a lakh is 10,000,000 of them.
- The end-of-term residue mis-sized, which is what turned up the ₹102 above.

## How much of an EMI was actually a cost

The other half of the same question, and **it is not the same kind of finding
as the card bill.**

| | Card bill | EMI |
| --- | --- | --- |
| The reported figure is | **wrong** — counted twice | **right** — the money did leave |
| What is missing | that the purchase and the bill are one outflow | that one outflow is two different things |
| How it renders | a warning | faint, alongside |

An EMI is a cost *and* a transfer into equity:

> ₹43,391 went on loan payments, and ₹8,088 of it repaid the debt rather than
> being spent — that money is still yours, as a smaller liability. The cost was
> the interest, ₹35,303.

A household deciding whether they can afford something wants the interest
figure. One reconciling their bank account wants the whole EMI. Both are true,
which is why this reports alongside rather than replacing — and a test asserts
the sentence contains no *wrong*, *incorrect* or *double*.

### The split follows the schedule, not the balance

An early EMI is nearly all interest and a late one nearly all principal, so the
whole payment history is walked and only the rows landing inside the period are
counted. A flat share of the outstanding would be wrong at both ends of a loan.
Mutating it to score every payment as if it were the first fails three tests.

### Three things that cannot be split are counted anyway, and named

A loan with incomplete terms, one whose EMI does not cover its interest, and
payments running past the end of the schedule. The money left the account in
every case, so a figure that quietly excluded them would be smaller than the
truth and impossible to reconcile against a bank statement.

### One more error of my own

The fixture for *the split follows the schedule* generated 119 monthly dates
that ran **past** the payment under test, so sorting moved it out of last place
and it was scored against the wrong row. Caught by the test failing.

## Not done
- **Net worth still reads the stored figure.** Deliberately: the estimate is a
  model, and quietly substituting it would make net worth disagree with the loan
  record for reasons nobody could see.
- **Payments are matched by category and payee**, not by a link to the loan.
  Two loans with the same lender would share payments between them. A `recurring`
  reference is honoured where present, which is the narrow path that is exact.
