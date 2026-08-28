# One Rounding Rule, Actually Applied

`js/core/money.js`, and the domain files that do money arithmetic. Tested in
`tests/rounding.test.mjs`.

## The rule that was stated and not followed

`js/core/money.js` has carried this comment for a long time:

> `Math.round(-0.5)` is `-0`, i.e. towards +∞. Money should round away from
> zero so a debit and a credit of the same size round to the same size.

It is correct, and nothing in the application did it.

`roundHalfUp` — the function implementing it — was private. The three helpers
that used it, `mul`, `divide` and `percent`, had **no callers at all**: not one
line outside `money.js` imported any of them. Meanwhile **sixty-seven**
`Math.round(...)` calls across the domain and service layers did money
arithmetic directly, with exactly the rounding the comment says money must not
use.

So a debit and a credit of the same size did not round to the same size
anywhere in this application.

## How much it was worth

Small, and worth being accurate about: the two rules differ only at an exact
half of a minor unit on a negative value, and then by one paisa.

    -₹1.50 a year, as a month:   divide(-150, 12) = -13
                                 Math.round(-150 / 12) = -12

Where negatives genuinely occur, the notable ones are a realised **loss** in
`costbasis.js` — a figure that feeds a capital-gains report — and a recurring
credit such as rent received or a salary, entered as a negative recurring
payment, whose monthly equivalent came out a paisa different from the same
amount entered as a debit.

Nobody has reported this. It is being fixed because a codebase with two
rounding rules, one of them written down and unused, will eventually apply the
wrong one somewhere that matters.

## What changed

Twenty-four call sites, in eleven files. `divide`, `mul` and `percent` now have
callers; `roundMoney` is exported for the arithmetic they do not express —
compound interest, a running balance, a median.

| file | what was rounded |
| --- | --- |
| `accrual.js` | an accrued value, and interest, which can be negative |
| `amortise.js` | interest on a balance, and the balance |
| `commitments.js` | weekly, quarterly, half-yearly and yearly, as a month |
| `costbasis.js` | cost, a realised gain **or loss**, income |
| `finance.js` | a budget window, and a recurring amount as a month |
| `inbox.js` | an average order, a yearly figure from a cadence |
| `portfolio.js` | what a holding cost |
| `runway.js` | a median of amounts, and a per-day figure |
| `unusual.js` | a median of amounts |
| `sms.js`, `tabular.js` | rupees parsed into paise |

The last two never hit the bug — both parse an unsigned digit string and apply
the sign afterwards. They were converted anyway, to `toMinor`, so that the
scale comes from the currency rather than a hard-coded `* 100`, and so that
"no money path calls `Math.round`" is a sentence that can be said truthfully.

## What did **not** change

Forty-three `Math.round` calls remain in the domain and services, and every one
of them is correct: days between two dates, a percentage, litres, kilometres
per litre, minutes, metres, units to three decimal places. None is money, and a
check that flagged them would be noise — and noise gets switched off.

## The checks

The strong ones are properties, not call sites:

- `roundMoney`, `divide`, `mul`, `percent` and `toMinor` are each symmetric
  about zero.
- `monthlyCost` is symmetric for every billing frequency — the recurring-credit
  case above.
- Interest on a balance is symmetric.
- A payment still splits into interest and principal exactly, to the paisa:
  the rounding changed and the arithmetic must not have.

There is also a test asserting `Math.round` **is** asymmetric, so that if the
platform ever changes underneath this, the rule stops buying anything and
somebody hears about it from a test rather than assuming it still holds.

A narrow backstop names the three files where every rounding was money —
`accrual.js`, `amortise.js`, `runway.js` — and fails if `Math.round` returns to
one of them.

Mutations run: reverting a monthly equivalent, removing the sign handling from
`roundHalfUp`, and reverting the amortisation interest each fail at least one
check.

## Not reviewed by an accountant

This makes the application consistent with its own stated rule. Whether
round-half-away-from-zero is the right rule for Indian tax reporting is a
question for somebody qualified, and nobody qualified has been asked.
