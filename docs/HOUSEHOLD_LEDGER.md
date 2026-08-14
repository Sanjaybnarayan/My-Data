# Who Paid, And A Rate That Said Zero

Two open items closed together. `js/domain/household.js` and
`js/services/portfolio.js`, tested in `tests/household.test.mjs`,
`tests/services.test.mjs`, `tests/domain.test.mjs` and in the browser suite.

---

## 1. The family ledger

### The field nobody read

`transaction.person` — the form calls it **"Spent by"** — has been on every
transaction since the schema was written, and `domain/ledger.js` copies it onto
every ledger row. Nothing downstream ever looked. A household of three tagging
every payment could not see who paid for anything.

That is the fourth field found collected by a form and read by nothing, after
`transaction.category` and `person.relationship`. The pattern is recorded in the
roadmap.

### The trap, which is the whole design

The field is optional and **no importer sets it**, so in a real household most
transactions carry no person. Measured on a realistic month — three entered by
hand, twenty imported:

```
  transactions            : 23
  carrying a person       : 3
  household spending      : ₹1,20,000
  spending with a person  : ₹60,000  (50%)

  a naive per-member report would say:
    Asha   ₹52,000  = 87% of tagged, but 43% of what the household actually spent
    Ravi    ₹8,000  = 13% of tagged, but  7% of what the household actually spent
```

So a per-member percentage is **a share of what is tagged, never a share of
household spending**, and the coverage is reported beside it every time. A
report that quietly divided by the tagged subtotal and called it "your spending"
would be wrong by whatever fraction nobody had filled in — an error that *grows*
as the household imports more, which is exactly backwards.

### What it deliberately does not answer

**Who owes whom.** That needs to know which costs are shared and which are
personal, and nothing here records it. Rent and a pair of shoes are both
"spent by Asha" and only one of them is half Ravi's. Splitting everything
equally would be a guess with arithmetic around it.

`settleable()` returns that refusal as a sentence, and the Finance screen prints
it — because somebody looking at a per-person breakdown is one step from asking
the question, and an absence would read as an oversight rather than an answer.

**Whose expense it was.** `person` records who *made the payment*, not who it
was for. Account transaction is not economic event; every sentence here says
"spent by" rather than "spent on".

### Three exclusions worth naming

Income, transfers between the household's own accounts, and deleted rows. The
transfer one matters most: counting it would make whoever moves money between
accounts look like the household's biggest spender.

---

## 2. XIRR reporting 0% on a deposit that was earning

### The bug

`cashFlows` closed every series with `holdingValue(holding)` — the stored
`currentValue`. That closing flow decides the rate almost single-handedly, so a
deposit whose value was typed once and never revisited has a closing flow equal
to its opening one:

```
  stored value            : ₹5,00,000
  value once accrued      : ₹5,75,516
  XIRR the app reports    : 0%
  XIRR from the estimate  : 7.29%
  the rate on the deposit : 7.1%

  RD XIRR the app reports : 0%
  RD XIRR from the estimate: 6.97%
  the rate on the deposit : 6.8%
```

**Not a missing number — a wrong one.** The accrual work reported the gain as
zero, which is an omission; this states a *rate*, and states it as flat.

### Reversing an earlier call, and why

`docs/ACCRUAL.md` left this open with the reasoning *"substituting the estimate
would make the portfolio's headline rate a model output without saying so"*, and
the rule quoted was **report alongside, never replace**.

That rule is right where it came from. Net worth reads `loan.outstanding`, a
*stored* figure; substituting a model there would make the Finance screen
disagree with the loan record with nothing visible to explain it.

XIRR is not that case. Nobody typed 0% — it is already a derived number, and the
choice is not stored-versus-model but **which input the model is given**.
Feeding it a value known to be stale, when the same screen already displays and
explains a better one, produces a worse derived number for no gain in honesty.

So the rate is now worked out from the accrual estimate where accrual applies,
and **the row says `est.`**. That marker is not decoration: a rate from an
estimate and a rate from a typed figure are different claims, and rendering them
identically would be the silent substitution this is careful not to make.

Where accrual cannot help — a share whose price nobody has updated — the stored
value is still used. That rate is stale too; this does not pretend otherwise,
and does not mark it as an estimate, because nothing re-valued it.

### `??` rather than `||`

`cashFlows` takes `value` and falls back with `??`. A caller that has worked out
the holding is worth nothing has *said something*, and `||` would silently
overrule them — the same class of bug as everything else here. Unreachable
today, because accrual never returns zero, so it is locked by a direct test
rather than left to a future caller to discover.

---

## What mutation testing found

Seventeen mutations, sixteen caught on the first pass.

| Mutation | Caught by |
| --- | --- |
| **A share of household spending passed off as a share of tagged** | *a share of what is tagged, not of what the household spent* |
| **The untagged remainder is dropped** | *the untagged remainder is carried, never dropped* |
| **An unknown person id becomes a member** | the test of that name |
| **Transfers count as spending** | *neither is moving money between your own accounts* |
| **A partly tagged month is called complete** | *a share of what is tagged…* |
| **Who owes whom is answered after all** | *is refused, and the reason is a missing fact* |
| **The stale value is used again** (the XIRR bug) | *a stale deposit does not report 0%* |
| **Every row claims its rate is an estimate** | *a holding nothing can re-value keeps the rate from what was typed* |
| **A supplied zero closing value is overruled** | **survived** — now caught |

## A browser check that passed for the wrong reason

The first version of *"the rate is no longer 0%"* was **vacuous**: the fixture
deposit had no purchase transaction, so it had no rate at all and an absent
badge satisfied a negative assertion. Reverting the fix still passed.

Caught by mutating the service and watching nothing fail. The block now creates
the opening purchase through the form, and the check is positive — the rate must
be *present*, non-zero and marked `est.` — because an absent badge is not a
passing result.

## Not done

- **Net worth still reads stored figures** for loans and holdings. Unchanged and
  deliberate: those are stored numbers, which is the case the original rule was
  written for.
- **Coverage is reported, not improved.** Nothing prompts for a person on a
  hand-entered transaction, and no importer can infer one.
- **`topCategory` is the largest by amount**, which a single large payment can
  dominate.
- **The pooled portfolio XIRR uses the same estimated closing values** but is
  not marked as an estimate on screen — the per-row markers are, and the accrual
  card above explains why.
